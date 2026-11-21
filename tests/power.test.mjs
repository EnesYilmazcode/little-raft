// Unit tests for dist/power.js (wind turbine, battery, string lights, lamp post) and dist/power-model.js.
// Run: node --test tests/power.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const P = await import(new URL('power.js', base));
const M = await import(new URL('power-model.js', base));
const { ITEMS, BLOCK_RADII, PROGRESSION_PLAN } = await import(new URL('items.js', base));
const { ITEM_INFO } = await import(new URL('inventory-state.js', base));
const { createDayNight } = await import(new URL('daynight.js', base));
const { promptFromHtml } = await import(new URL('prompts.js', base));
const { cleanPower, turbinesNear, servingBattery, tickPower, batteryInfo, CAP, MAX_TICK, OLD_HOST, NIGHT_ON } = P;

const bat = (x = 0, z = 0) => ({ type: 'battery', x, z });
const tur = (x, z) => ({ type: 'turbine', x, z });
const sl = (x, z) => ({ type: 'stringlights', x, z });
const lp = (x, z) => ({ type: 'lamppost', x, z });
const fresh = () => cleanPower(undefined, []);
const ticks = (st, decor, n, wind = .7, night = 0) => { const out = []; for (let i = 0; i < n; i++) out.push(...tickPower(st, decor, 1, wind, night).emptied); return out; };
// camera at (0, 1.7, 3) looking at the battery on tile 0,0 (target y = .22 + .3)
const AIM = { dir: { x: 0, y: -1.18 / Math.hypot(1.18, 3), z: -3 / Math.hypot(1.18, 3) } };

test('cleanPower: junk gives defaults; bad keys, floats, negatives and e > CAP dropped or clamped; non-battery keys pruned', () => {
  for (const v of [undefined, null, [], 'x', 3, { b: [] }, { b: 'x' }]) assert.deepEqual(cleanPower(v, [bat()]), { v: 1, s: '', r: 0, b: {} });
  const decor = [bat(0, 0), bat(1, 0), bat(-2, 3), bat(4, 4), bat(5, 5), tur(2, 2)];
  const st = cleanPower({ v: 1, s: 'abc', r: 7, b: {
    '0,0': 12.6, '1,0': 99999, '-2,3': -5, '4,4': 0, '5,5': 'x', '2,2': 10, '9,9': 10, 'a,b': 1, '01,0': 1, '0.5,0': 1,
  } }, decor);
  assert.equal(st.s, 'abc'); assert.equal(st.r, 7);
  assert.deepEqual(st.b, { '0,0': 13, '1,0': CAP });
  assert.deepEqual(cleanPower({ b: { '0,0': 5 } }, []).b, {}, 'a key with no battery is pruned');
});

test('adjacency: turbines at Chebyshev 1 count (cap 2); servingBattery range 3, skips e = 0, ties by key', () => {
  assert.equal(turbinesNear([bat(), tur(1, 1)], 0, 0), 1);
  assert.equal(turbinesNear([bat(), tur(2, 0)], 0, 0), 0);
  assert.equal(turbinesNear([bat(), tur(1, 0), tur(-1, 0), tur(0, 1)], 0, 0), 2);
  const decor = [bat(0, 0), bat(4, 0), sl(2, 0)];
  const st = { b: { '0,0': 10, '4,0': 10 } };
  assert.equal(servingBattery(st, decor, 2, 0), '0,0', 'tie at distance 2: smallest key string');
  assert.equal(servingBattery(st, decor, 3, 0), '4,0');
  assert.equal(servingBattery(st, decor, 8, 0), null);
  assert.equal(servingBattery(st, decor, 0, 3), '0,0');
  assert.equal(servingBattery(st, decor, 0, 4), null, 'out of range 3');
  assert.equal(servingBattery({ b: { '4,0': 10 } }, decor, 2, 0), '4,0', 'e = 0 is skipped');
  assert.equal(servingBattery({ b: {} }, decor, 2, 0), null);
});

test('charge: 1 turbine at .7 gives 3/s; calm 1/s; no turbine nothing; stops at CAP and r stays', () => {
  let st = fresh(); const one = [bat(), tur(1, 0)];
  tickPower(st, one, 1, .7, 0); assert.equal(st.b['0,0'], 3);
  st = fresh(); ticks(st, one, 60); assert.equal(st.b['0,0'], 180);
  st = fresh(); tickPower(st, one, 60, .7, 0); assert.equal(st.b['0,0'], 180, 'one 60 s call equals 60 one-second calls');
  st = fresh(); const r0 = st.r; ticks(st, [bat()], 100); assert.deepEqual(st.b, {}); assert.equal(st.r, r0);
  st = fresh(); tickPower(st, one, 10, .15, 0); assert.equal(st.b['0,0'], 10);
  st = fresh(); tickPower(st, [bat(), tur(1, 0), tur(0, 1)], 1, .7, 0); assert.equal(st.b['0,0'], 6);
  st = fresh(); for (let i = 0; i < 20; i++) tickPower(st, one, 60, .7, 0);
  assert.equal(st.b['0,0'], CAP);
  const r = st.r; tickPower(st, one, 60, .7, 0); assert.equal(st.r, r, 'a full battery does not bump the revision');
});

test('drain: 2 String Lights + 1 Lamp Post drain 4/s at night, none by day; empty battery hands over; emptied once', () => {
  const decor = [bat(0, 0), sl(1, 0), sl(0, 1), lp(-1, 0)];
  let st = { v: 1, s: '', r: 0, b: { '0,0': 100 } };
  tickPower(st, decor, 1, .7, 1); assert.equal(st.b['0,0'], 96);
  tickPower(st, decor, 10, .7, NIGHT_ON - .01); assert.equal(st.b['0,0'], 96, 'no drain by day');
  const two = [bat(0, 0), bat(3, 0), sl(1, 0)];
  st = { v: 1, s: '', r: 0, b: { '0,0': 3, '3,0': 10 } };
  const em = ticks(st, two, 6, 0, 1);
  assert.deepEqual(em, ['0,0']);
  assert.equal(st.b['0,0'], undefined); assert.equal(st.b['3,0'], 7, 'the next battery took over');
  assert.equal(servingBattery(st, two, 1, 0), '3,0');
  st = { v: 1, s: '', r: 0, b: { '0,0': 2 } };
  const r = tickPower(st, [bat(), sl(1, 0)], 30, 0, 1);
  assert.deepEqual(r.emptied, ['0,0']); assert.deepEqual(st.b, {});
  assert.deepEqual(batteryInfo({ b: {} }, [bat(), sl(1, 0), lp(5, 5), tur(1, 1)], 0, 0), { e: 0, pct: 0, turbines: 1, lights: 1 });
  assert.equal(batteryInfo({ b: {} }, [], 0, 0), null);
});

test('dt: .9 counts as 0, 1e6 clamps to MAX_TICK; identical worlds stay deepEqual', () => {
  const one = [bat(), tur(1, 0)];
  let st = fresh(); tickPower(st, one, .9, .7, 0); assert.deepEqual(st.b, {});
  st = fresh(); tickPower(st, one, 1e6, .7, 0); assert.equal(st.b['0,0'], 3 * MAX_TICK);
  st = fresh(); tickPower(st, one, NaN, .7, 0); assert.deepEqual(st.b, {});
  const decor = [bat(0, 0), bat(2, 2), tur(1, 0), tur(3, 3), sl(1, 1), lp(0, 2), sl(-2, 0)];
  const a = fresh(), b = fresh();
  for (let i = 0; i < 500; i++) { const w = [.15, .7, .5][i % 3], n = (i % 7) / 6; tickPower(a, decor, 1 + (i % 3), w, n); tickPower(b, decor, 1 + (i % 3), w, n); }
  assert.deepEqual(a, b);
});

function modCtx(role = 'solo') {
  const world = { decor: [bat(0, 0), tur(1, 0), sl(0, 1), lp(-1, 0)], tiles: [[0, 0], [1, 0], [0, 1], [-1, 0], [1, 1]] };
  const emits = [], notices = [], actions = [];
  const ctx = { T: null, world, role, running: true, physics: { x: 0, z: 0 }, other: { x: 50, z: 50 }, camera: { position: { x: 0, y: 1.7, z: 3 } }, raft: null, elapsed: 0,
    emit: (e, to) => emits.push([e, to]), notice: s => notices.push(s), action: a => actions.push(a) };
  return { ctx, emits, notices, actions };
}

test('module: net load caching, OLD_HOST, prompts, interact is local', () => {
  const g = modCtx('guest');
  const gm = P.createPower(g.ctx);
  assert.equal(gm.name, 'power');
  gm.link({ wind: () => .7, night: () => 1 });
  const data = { v: 1, s: 'host1', r: 5, b: { '0,0': 1116 } };
  gm.load(data, 'net'); const ref = gm.debug.state();
  gm.load(JSON.parse(JSON.stringify(data)), 'net'); assert.deepEqual(gm.debug.state(), ref);
  assert.equal(gm.prompt(AIM), '<kbd>E</kbd>Check battery · 62%');
  assert.equal(promptFromHtml(gm.prompt(AIM)).key, 'E');
  assert.deepEqual(gm.debug.lit().sort(), ['-1,0', '0,1']);
  assert.equal(gm.interact(AIM), true);
  assert.equal(g.notices.at(-1), 'Battery 62% · 1 turbine · breezy · lights 2 at night');
  assert.equal(g.actions.length, 0, 'interact never sends an action');
  gm.update(100); assert.deepEqual(gm.debug.state().b, data.b, 'guests never tick');
  gm.load(undefined, 'net');
  assert.equal(gm.prompt(AIM), OLD_HOST);
  gm.load(undefined, 'net'); assert.equal(gm.prompt(AIM), OLD_HOST);
  assert.equal(gm.interact(AIM), true); assert.equal(g.notices.at(-1), OLD_HOST);
  assert.deepEqual(gm.debug.lit(), []);
  assert.equal(g.actions.length, 0);
  assert.equal(gm.action, undefined, 'v1 has no power.* actions');
});

test('module: host ticks at 1 Hz with env, emits once per empty battery, daynight-off fallbacks', () => {
  const { ctx, emits } = modCtx();
  const m = P.createPower(ctx); m.load(undefined, 'save');
  let nf = 0;
  m.link({ wind: () => .7, night: () => nf });
  assert.equal(m.prompt(AIM), '<kbd>E</kbd>Check battery · 0%');
  for (let i = 0; i < 60 * 10; i++) m.update(1 / 60);
  assert.equal(m.debug.state().b['0,0'], 30);
  nf = 1; ctx.world.decor.splice(1, 1); // remove the turbine: 1 + 2 drain per second
  for (let i = 0; i < 15; i++) m.update(1);
  assert.equal(m.debug.state().b['0,0'], undefined);
  assert.deepEqual(emits.filter(e => e[0].text === 'A battery ran out of charge'), [[{ kind: 'notice', text: 'A battery ran out of charge' }, 'all']]);
  m.debug.setCharge(0, 0, 2); for (let i = 0; i < 5; i++) m.update(1);
  assert.equal(emits.length, 1, 'at most once per night per battery');
  const s1 = m.serialize(); assert.equal(m.serialize(), s1, 'serialize cached by revision');
  // ?daynight=off: no getters -> wind .15 / night 0
  const o = modCtx(); const off = P.createPower(o.ctx); off.load(undefined, 'save'); off.link(null);
  assert.deepEqual(off.debug.env(), { wind: .15, night: 0 });
  for (let i = 0; i < 5; i++) off.update(1);
  assert.equal(off.debug.state().b['0,0'], 5, 'batteries just fill');
  // old saves load to defaults
  const n = modCtx(); const nm = P.createPower(n.ctx); nm.load(undefined, 'save'); assert.deepEqual(nm.debug.state().b, {});
});

const sizeOf = g => { g.updateMatrixWorld(true); return new T.Box3().setFromObject(g).getSize(new T.Vector3()); };
const mats = g => { const s = new Set(); g.traverse(o => { if (o.isMesh) s.add(o.material); }); return s; };

test('models: names, parts, no shared materials, pips, size and draw calls', () => {
  const tb = M.createTurbine(T), bt = M.createBattery(T), s1 = M.createStringLights(T), s2 = M.createStringLights(T), l = M.createLampPost(T);
  assert.deepEqual([tb, bt, s1, l].map(g => g.name), ['craft_turbine', 'craft_battery', 'craft_stringlights', 'craft_lamppost']);
  assert.ok(tb.userData.blades && tb.userData.blades.castShadow === false);
  const glow = l.children.find(c => c.name === 'lanternGlow'), glass = l.children.find(c => c.name === 'lanternGlass');
  assert.ok(glow && glass && glow.parent === l && glass.parent === l); assert.equal(glow.userData.pool.gain, .8); assert.ok(glass.userData.glass);
  assert.equal(s1.children.filter(c => c.name === 'candle' && c.isMesh).length, 1);
  assert.equal(s1.userData.noPool, true); assert.deepEqual(s1.userData.power, { lit: 0 }); assert.deepEqual(l.userData.power, { lit: 0 });
  for (const m of mats(s1)) assert.ok(!mats(s2).has(m), 'two string lights share no material');
  const l2 = M.createLampPost(T); for (const m of mats(l)) assert.ok(!mats(l2).has(m));
  const b2 = M.createBattery(T); M.paintBattery(bt, 2);
  assert.deepEqual([0, 1, 2, 3].map(i => bt.getObjectByName('pip' + i).material.emissiveIntensity), [.9, .9, 0, 0]);
  assert.equal(b2.getObjectByName('pip0').material.emissiveIntensity, 0, 'pips are per copy');
  assert.deepEqual([0, 1, 1800, 1, 450, 451].map(P.pipsFor), [0, 1, 4, 1, 1, 2]);
  for (const g of [tb, bt, s1, l]) { const s = sizeOf(g); assert.ok(s.x <= .9 && s.z <= .9, `${g.name} ${s.x.toFixed(2)} x ${s.z.toFixed(2)}`); }
  const meshes = g => { let n = 0; g.traverse(o => { if (o.isMesh) n++; }); return n; };
  assert.deepEqual([tb, bt, s1, l].map(meshes), [2, 5, 2, 3]);
  const m = P.createPower({ T, world: { decor: [] }, role: 'solo' });
  for (const t of P.POWER_TYPES) assert.equal(m.decorModel(t).name, 'craft_' + t);
  assert.equal(m.decorModel('palm'), null);
});

test('items: recipes, unlocks, radii, plan row', () => {
  const cases = { turbine: { wood: 4, metalingot: 2, bolt: 2, rope: 2 }, battery: { copperingot: 2, metalingot: 1, plastic: 2 }, stringlights: { glass: 2, copperingot: 1, rope: 2 }, lamppost: { wood: 3, glass: 1, copperingot: 1, nail: 2 } };
  for (const [id, cost] of Object.entries(cases)) {
    assert.ok(ITEMS[id] && ITEM_INFO[id], id); assert.equal(ITEMS[id].placeable, true); assert.equal(ITEMS[id].category, 'decor');
    assert.deepEqual({ ...ITEMS[id].recipe.cost }, cost, id); assert.equal(ITEMS[id].unlock.type, 'research'); assert.ok(BLOCK_RADII[id] > 0);
  }
  assert.ok(PROGRESSION_PLAN.some(r => r.minute === 115 && r.ids.includes('turbine')));
});

function dnRig() {
  const scene = new T.Scene(); scene.background = new T.Color('#cbd2c0'); scene.fog = new T.Fog('#cbd2c0', 25, 125);
  const camera = new T.PerspectiveCamera(70, 1, 0.05, 200); camera.position.set(0, 1.7, 0); scene.add(camera);
  const hemi = new T.HemisphereLight('#f2ead4', '#3d6b6a', 1.8); scene.add(hemi);
  const sun = new T.DirectionalLight('#fff0c7', 2.5); sun.position.set(-15, 28, 12); scene.add(sun);
  const raft = new T.Group(); scene.add(raft); raft.add(new T.Group());
  const ocean = { uniforms: { uSky: { value: new T.Color() }, uZenith: { value: new T.Color() }, uDeep: { value: new T.Color() }, uShallow: { value: new T.Color() }, uSunDir: { value: new T.Vector3(0, 1, 0) }, uSunColor: { value: new T.Color('#fff3d6') }, uFadeFar: { value: 125 } } };
  const world = { decor: [] };
  const ctx = { T, scene, camera, hemi, sun, raft, clouds: [], ocean, world, role: 'solo', renderer: { toneMappingExposure: 1 }, options: { graphics: 'high' }, localBag: () => null, action: () => {} };
  return { ctx, raft, world };
}

test('daynight: unlit lights read base*UNLIT, a lit flip applies next frame, lamp posts take pools, string lights never do', () => {
  const { ctx, raft, world } = dnRig();
  const s = M.createStringLights(T); s.position.set(2, .22, 0); raft.add(s);
  world.decor.push({ type: 'stringlights', x: 1, z: 0 });
  const m = createDayNight(ctx);
  m.debug.setPhase(0.82); m.debug.freeze(true);
  for (let i = 0; i < 40; i++) m.update(1 / 30);
  const bulbs = s.children.find(c => c.name === 'candle').material;
  assert.ok(Math.abs(bulbs.emissiveIntensity - .45 * .15) < 1e-6, `unlit ${bulbs.emissiveIntensity}`);
  assert.equal(m.debug.state().lanterns, 1);
  s.userData.power.lit = 1; m.update(1 / 30);
  assert.ok(Math.abs(bulbs.emissiveIntensity - .45 * 2.0) < 1e-6, `lit ${bulbs.emissiveIntensity}`);
  for (let i = 0; i < 30; i++) m.update(1 / 30);
  assert.equal(m.debug.state().poolLit, 0, 'lit String Lights alone take no pool light');
  const l = M.createLampPost(T); l.position.set(-2, .22, 0); raft.add(l); world.decor.push({ type: 'lamppost', x: -1, z: 0 });
  for (let i = 0; i < 30; i++) m.update(1 / 30);
  assert.equal(m.debug.state().lanterns, 2);
  assert.equal(m.debug.state().poolLit, 0, 'an unlit Lamp Post never takes a pool');
  l.userData.power.lit = 1; m.update(1 / 30);
  assert.equal(m.debug.state().poolLit, 1, 'a lit Lamp Post takes a pool at once');
  const glow = l.children.find(c => c.name === 'lanternGlow').material;
  assert.ok(Math.abs(glow.emissiveIntensity - .5 * 2.4) < 1e-6);
  l.userData.power.lit = 0; m.update(1 / 30);
  assert.equal(m.debug.state().poolLit, 0); assert.ok(Math.abs(glow.emissiveIntensity - .5 * .15) < 1e-6);
  m.dispose();
});

test('name sync: every power light model is accepted by the daynight scan', () => {
  const { ctx, raft } = dnRig();
  const m = createDayNight(ctx); m.debug.setPhase(0.82); m.debug.freeze(true);
  m.update(1 / 30); assert.equal(m.debug.state().lanterns, 0);
  let n = 0;
  for (const make of [M.createStringLights, M.createLampPost]) { const g = make(T); g.position.set(n * 2, .22, 2); raft.add(g); m.update(1 / 30); assert.equal(m.debug.state().lanterns, ++n, g.name); }
  for (const make of [M.createTurbine, M.createBattery]) { raft.add(make(T)); m.update(1 / 30); assert.equal(m.debug.state().lanterns, n, 'turbine and battery are not lanterns'); }
  assert.equal(typeof Object.getOwnPropertyDescriptor(m, 'night').get, 'function');
  m.dispose();
});
