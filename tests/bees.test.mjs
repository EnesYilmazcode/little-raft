// Unit tests for dist/bees.js (beehive, flower box, honey and wax) and dist/bees-model.js.
// Run: node --test tests/bees.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const B = await import(new URL('bees.js', base));
const M = await import(new URL('bees-model.js', base));
const { Bag, SLOT_COUNT, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const { ITEMS } = await import(new URL('items.js', base));
const { createDayNight } = await import(new URL('daynight.js', base));
const { cleanBees, flowersNear, tickBees, hiveInfo, harvest, COMB_WORK, COMB_MAX, MAX_TICK, OLD_HOST } = B;

const bagWith = (slots, selected = 0) => {
  const s = new Array(SLOT_COUNT).fill(null);
  slots.forEach((v, i) => { s[i] = v; });
  return new Bag({ slots: s, selected });
};
const fullBag = () => bagWith(Array.from({ length: SLOT_COUNT }, () => ({ kind: 'scrap', count: 20 })));
// camera at (0, 1.7, 3) looking at the hive top on tile 0,0
const AIM = { dir: { x: 0, y: -1.1 / Math.hypot(1.1, 3), z: -3 / Math.hypot(1.1, 3) } };
const hive = (x = 0, z = 0) => ({ type: 'beehive', x, z });
const box = (x, z) => ({ type: 'flowerbox', x, z });
const fresh = () => cleanBees(undefined, []);
const ticks = (st, decor, n, dt = 1) => { let full = []; for (let i = 0; i < n; i++) full = full.concat(tickBees(st, decor, dt).full); return full; };

test('cleanBees: junk gives defaults; bad keys and values are dropped or clamped; non-hive tiles pruned', () => {
  for (const v of [undefined, null, [], 'x', 3, { h: [] }, { h: 'x' }]) assert.deepEqual(cleanBees(v, [hive()]), { v: 1, s: '', r: 0, h: {} });
  const decor = [hive(0, 0), hive(1, 0), hive(-2, 3), hive(4, 4), hive(5, 5), box(2, 2)];
  const st = cleanBees({ v: 1, s: 'abc', r: 7, h: {
    '0,0': { c: 1.7, t: 99.9 }, '1,0': { c: 9, t: 50 }, '-2,3': { c: -1, t: 400 }, '4,4': { c: 0, t: 0 }, '5,5': 'x',
    '2,2': { c: 2, t: 3 }, '9,9': { c: 1, t: 1 }, 'a,b': { c: 1, t: 1 }, '01,0': { c: 1, t: 1 }, '0.5,0': { c: 1, t: 1 },
  } }, decor);
  assert.equal(st.s, 'abc'); assert.equal(st.r, 7);
  assert.deepEqual(st.h, { '0,0': { c: 1, t: 99 }, '1,0': { c: 3, t: 0 }, '-2,3': { c: 0, t: COMB_WORK - 1 } });
});

test('flowersNear: Chebyshev range 2; other decor ignored', () => {
  const decor = [hive(), box(2, 2), box(-2, 1), box(3, 0), box(0, -3), { type: 'palm', x: 1, z: 1 }, { type: 'lantern', x: 0, z: 1 }];
  assert.equal(flowersNear(decor, 0, 0), 2);
  assert.equal(flowersNear([], 0, 0), 0);
});

test('fill rule: 0, 1, 3 and 5 flowers; stops at COMB_MAX with t = 0; full once', () => {
  let st = fresh(); const none = [hive()];
  ticks(st, none, 600); assert.deepEqual(st.h, {});
  st = fresh(); const three = [hive(), box(1, 0), box(0, 1), box(-1, 0)];
  ticks(st, three, 119); assert.equal(hiveInfo(st, three, 0, 0).c, 0);
  ticks(st, three, 1); assert.deepEqual(hiveInfo(st, three, 0, 0), { c: 1, t: 0, flowers: 3 });
  st = fresh(); const one = [hive(), box(2, 2)];
  ticks(st, one, 359); assert.equal(hiveInfo(st, one, 0, 0).c, 0);
  ticks(st, one, 1); assert.equal(hiveInfo(st, one, 0, 0).c, 1);
  st = fresh(); const five = [hive(), box(1, 0), box(0, 1), box(-1, 0), box(0, -1), box(1, 1)];
  ticks(st, five, 120); assert.deepEqual(st.h['0,0'], { c: 1, t: 0 });
  const full = ticks(st, five, 1000);
  assert.deepEqual(st.h['0,0'], { c: COMB_MAX, t: 0 });
  assert.deepEqual(full, ['0,0']);
  const r = st.r; tickBees(st, five, 5); assert.equal(st.r, r, 'a full hive does not bump the revision');
});

test('dt is floored and clamped; removing the hive prunes its entry', () => {
  const decor = [hive(), box(1, 0)];
  const st = fresh();
  tickBees(st, decor, 0.9); assert.deepEqual(st.h, {});
  tickBees(st, decor, NaN); tickBees(st, decor, -5); assert.deepEqual(st.h, {});
  tickBees(st, decor, 1e6); assert.deepEqual(st.h['0,0'], { c: 0, t: MAX_TICK });
  decor.splice(0, 1);
  const r = st.r; tickBees(st, decor, 0); assert.deepEqual(st.h, {}); assert.ok(st.r > r);
});

test('harvest: yields, atomic full bag, empty, no target', () => {
  const decor = [hive(), box(1, 0)];
  const st = fresh(); st.h['0,0'] = { c: 2, t: 40 };
  const bag = bagWith([{ kind: 'wood', count: 1 }]);
  const r = harvest(st, decor, '0,0', bag);
  assert.deepEqual(r, { ok: true, kind: 'loot', count: 2, text: '+ 2 honey · 2 beeswax' });
  assert.equal(bag.count('honey'), 2); assert.equal(bag.count('wax'), 2);
  assert.deepEqual(st.h['0,0'], { c: 0, t: 40 });
  st.h['0,0'] = { c: 3, t: 0 };
  const fb = fullBag(), snap = JSON.stringify(fb.snapshot());
  assert.equal(harvest(st, decor, '0,0', fb).reason, 'full');
  assert.equal(JSON.stringify(fb.snapshot()), snap); assert.equal(st.h['0,0'].c, 3);
  // room for honey but not wax: still nothing changes
  const almost = bagWith([...Array.from({ length: SLOT_COUNT - 1 }, () => ({ kind: 'scrap', count: 20 })), { kind: 'honey', count: 17 }]);
  const snap2 = JSON.stringify(almost.snapshot());
  assert.equal(harvest(st, decor, '0,0', almost).reason, 'full'); assert.equal(JSON.stringify(almost.snapshot()), snap2);
  st.h['0,0'] = { c: 0, t: 5 };
  assert.equal(harvest(st, decor, '0,0', bag).reason, 'empty');
  assert.equal(harvest(st, decor, '1,0', bag).reason, 'notarget');
  assert.equal(harvest(st, decor, '5,5', bag).text, 'Nothing to collect');
  // a full harvest with t = 0 removes the entry
  st.h['0,0'] = { c: 3, t: 0 };
  assert.ok(harvest(st, decor, '0,0', bagWith([])).ok); assert.equal(st.h['0,0'], undefined);
});

function modCtx(role = 'solo') {
  const world = { decor: [hive(0, 0), box(1, 0)], tiles: [[0, 0], [1, 0]] };
  const emits = [], notices = [], actions = [];
  const ctx = { T: null, world, role, running: true, physics: { x: 0, z: 0 }, other: { x: 50, z: 50 }, camera: null, raft: null, elapsed: 0,
    emit: (e, to) => emits.push([e, to]), notice: s => notices.push(s), action: a => actions.push(a) };
  return { ctx, emits, notices, actions };
}

test('module: action validation, net load caching, OLD_HOST guard', () => {
  const { ctx, emits } = modCtx();
  const m = B.createBees(ctx);
  assert.equal(m.name, 'bees');
  m.load({ v: 1, s: 'x', r: 1, h: { '0,0': { c: 2, t: 3 } } }, 'save');
  const bag = bagWith([]), snap = JSON.stringify(bag.snapshot());
  const st0 = JSON.stringify(m.debug.state().h);
  assert.equal(m.action({ kind: 'bees.harvest', x: 0.5, z: 0 }, 'host', bag), true);
  assert.equal(m.action({ kind: 'bees.harvest', x: '0', z: 0 }, 'host', bag), true);
  assert.equal(m.action({ kind: 'bees.harvest', x: 0, z: 0 }, 'guest', bag), true); // guest is far away
  assert.equal(JSON.stringify(bag.snapshot()), snap); assert.equal(JSON.stringify(m.debug.state().h), st0);
  assert.equal(m.action({ kind: 'storage.put' }, 'host', bag), false);
  assert.equal(m.action({ kind: 'bees.harvest', x: 0, z: 0 }, 'host', bag), true);
  assert.equal(bag.count('honey'), 2);
  assert.deepEqual(emits.at(-1), [{ kind: 'loot', text: '+ 2 honey · 2 beeswax', loot: { honey: 2, wax: 2 } }, 'host']);
  ctx.other = { x: 1, z: 0 };
  assert.equal(m.action({ kind: 'bees.harvest', x: 0, z: 0 }, 'guest', bag), true);
  assert.deepEqual(emits.at(-1), [{ kind: 'notice', text: 'No honeycomb yet' }, 'guest']);
  // serialize is cached by revision
  const s1 = m.serialize(); assert.equal(m.serialize(), s1);

  // guest side
  const g = modCtx('guest'); g.ctx.camera = { position: { x: 0, y: 1.7, z: 3 } };
  const gm = B.createBees(g.ctx);
  const data = { v: 1, s: 'host1', r: 5, h: { '0,0': { c: 1, t: 0 } } };
  gm.load(data, 'net');
  const ref = gm.debug.state();
  gm.load(JSON.parse(JSON.stringify(data)), 'net');
  assert.deepEqual(gm.debug.state(), ref);
  assert.equal(gm.prompt(AIM), '<kbd>E</kbd>Collect honeycomb (1)');
  assert.equal(gm.interact(AIM), true);
  assert.deepEqual(g.actions.at(-1), { kind: 'bees.harvest', x: 0, z: 0 });
  gm.load(undefined, 'net');
  assert.equal(gm.prompt(AIM), OLD_HOST);
  const sent = g.actions.length;
  assert.equal(gm.interact(AIM), true);
  assert.equal(g.actions.length, sent, 'an old host never gets bees.harvest');
  assert.deepEqual(g.notices.at(-1), OLD_HOST);
  // guests never tick
  gm.load(data, 'net'); gm.update(100); assert.deepEqual(gm.debug.state().h, data.h);
});

test('module: host ticks at 1 Hz and prompts follow the hive', () => {
  const { ctx, emits } = modCtx();
  ctx.camera = { position: { x: 0, y: 1.7, z: 3 } };
  const m = B.createBees(ctx); m.load(undefined, 'save');
  const aim = AIM;
  assert.equal(m.prompt(aim), 'Bees are busy… 0%');
  for (let i = 0; i < 180 * 60; i++) m.update(1 / 60);
  assert.equal(m.prompt(aim), 'Bees are busy… 50%');
  m.debug.fastForward(10000);
  assert.equal(m.prompt(aim), '<kbd>E</kbd>Collect honeycomb (3) · full');
  ctx.world.decor.splice(1, 1); m.load(undefined, 'save');
  assert.equal(m.prompt(aim), 'Beehive: bees need a flower box nearby');
  for (let i = 0; i < 10; i++) m.update(1);
  assert.equal(emits.length, 0);
  ctx.world.decor.push(box(0, 1), box(1, 1), box(-1, 1));
  for (let i = 0; i < 6 * 60; i++) m.update(1);
  assert.deepEqual(emits.map(e => e[0].text), ['A beehive is full of honeycomb']);
});

test('determinism: identical worlds and tick sequences end up equal', () => {
  const mk = () => [hive(0, 0), hive(3, 3), box(1, 1), box(2, 2), box(4, 4), box(5, 5)];
  const a = fresh(), b = fresh(), da = mk(), db = mk();
  const seq = [0.5, 1, 7.3, 60, 120, 3, 0, 59.99, 33];
  for (let k = 0; k < 20; k++) for (const dt of seq) { tickBees(a, da, dt); tickBees(b, db, dt); }
  assert.deepEqual(a, b);
});

const sizeOf = g => { g.updateMatrixWorld(true); const s = new T.Box3().setFromObject(g).getSize(new T.Vector3()); return s; };

test('models: hive combs and bees, candle parts, sizes', () => {
  const h = M.createHive(T);
  assert.equal(h.name, 'craft_beehive');
  for (const n of ['comb0', 'comb1', 'comb2', 'bees']) assert.ok(h.getObjectByName(n), n);
  M.paintHive(h, 2, true, 1.5, true);
  assert.deepEqual([0, 1, 2].map(i => h.getObjectByName('comb' + i).visible), [true, true, false]);
  assert.equal(h.getObjectByName('bees').visible, true);
  M.paintHive(h, 2, true, 1.6, false); assert.equal(h.getObjectByName('bees').visible, false);
  M.paintHive(h, 0, false, 0, true); assert.deepEqual([0, 1, 2].map(i => h.getObjectByName('comb' + i).visible), [false, false, false]);
  const c = M.createCandle(T);
  assert.equal(c.name, 'craft_candle');
  for (const n of ['candle', 'flame', 'lanternGlow']) assert.ok(c.children.some(k => k.name === n && k.isMesh), n);
  assert.ok(c.children.some(k => k.userData.glass));
  { const gl = c.children.find(k => k.name === 'lanternGlow').geometry, bs = gl.boundingSphere, bb = new T.Box3().setFromBufferAttribute(gl.attributes.position);
    assert.ok(bs.center.y >= 0.5, 'night pool light anchor sits well above the deck');
    for (const p of [bb.min, bb.max]) assert.ok(bs.containsPoint(p), 'glow bounding sphere still encloses the glow'); }
  const f = M.createFlowerBox(T); assert.equal(f.name, 'craft_flowerbox');
  for (const g of [h, f, c]) {
    const bees = g.getObjectByName('bees'); if (bees) bees.visible = false;
    const s = sizeOf(g);
    assert.ok(s.x <= 0.7 + 1e-6 && s.y <= 0.9 && s.z <= 0.7 + 1e-6, `${g.name} ${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)}`);
  }
  const m = B.createBees({ T, world: { decor: [] }, role: 'solo' });
  assert.equal(m.decorModel('beehive').name, 'craft_beehive');
  assert.equal(m.decorModel('candle').name, 'craft_candle');
  assert.equal(m.decorModel('palm'), null);
});

test('items: recipes, unlocks, barrel row and the bag accepts all seven kinds', () => {
  const kinds = ['flowerseed', 'flowerbox', 'beehive', 'honey', 'wax', 'candle', 'honeyfish'];
  for (const k of kinds) { assert.ok(ITEMS[k], k); assert.ok(ITEM_INFO[k], k); assert.ok(ITEMS[k].tip.length > 10); }
  const cases = { flowerbox: { wood: 2, flowerseed: 1 }, beehive: { wood: 4, rope: 2, leaf: 2 }, candle: { wax: 2, rope: 1 }, honeyfish: { cookedfish: 1, honey: 1 } };
  for (const [id, cost] of Object.entries(cases)) {
    assert.deepEqual({ ...ITEMS[id].recipe.cost }, cost, id);
    const bag = bagWith(Object.entries(cost).map(([kind, count]) => ({ kind, count })));
    assert.equal(bag.canCraft(id).ok, true, id); assert.ok(bag.craft(id), id); assert.equal(bag.count(id), 1, id);
  }
  for (const id of ['flowerbox', 'beehive', 'candle']) assert.equal(ITEMS[id].placeable, true);
  const snap = bagWith(kinds.map(kind => ({ kind, count: 1 }))).snapshot();
  const back = new Bag(snap);
  for (const k of kinds) assert.equal(back.count(k), 1, k);
});

test('daynight: a craft_candle lanternGlow gets the night multiplier', () => {
  const scene = new T.Scene(); scene.background = new T.Color('#cbd2c0'); scene.fog = new T.Fog('#cbd2c0', 25, 125);
  const camera = new T.PerspectiveCamera(70, 1, 0.05, 200); camera.position.set(0, 1.7, 0); scene.add(camera);
  const hemi = new T.HemisphereLight('#f2ead4', '#3d6b6a', 1.8); scene.add(hemi);
  const sun = new T.DirectionalLight('#fff0c7', 2.5); sun.position.set(-15, 28, 12); scene.add(sun);
  const raft = new T.Group(); scene.add(raft); raft.add(new T.Group());
  const ocean = { uniforms: { uSky: { value: new T.Color() }, uZenith: { value: new T.Color() }, uDeep: { value: new T.Color() }, uShallow: { value: new T.Color() }, uSunDir: { value: new T.Vector3(0, 1, 0) }, uSunColor: { value: new T.Color('#fff3d6') }, uFadeFar: { value: 125 } } };
  const world = { decor: [{ type: 'candle', x: 1, z: 0 }] };
  const ctx = { T, scene, camera, hemi, sun, raft, clouds: [], ocean, world, role: 'solo', renderer: { toneMappingExposure: 1 }, localBag: () => null, action: () => {} };
  const g = M.createCandle(T); g.position.set(2, .22, 0); raft.add(g);
  const m = createDayNight(ctx);
  m.debug.setPhase(0.82); m.debug.freeze(true);
  for (let i = 0; i < 40; i++) m.update(1 / 30);
  const glow = g.children.find(c => c.name === 'lanternGlow').material.emissiveIntensity;
  assert.ok(Math.abs(glow - 0.5 * 2.4) < 1e-6, `glow ${glow}`);
  assert.equal(m.debug.state().lanterns, 1);
  m.dispose();
});
