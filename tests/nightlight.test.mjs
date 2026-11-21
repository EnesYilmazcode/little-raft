// Night light (Hand Lantern, Glass Jar, Firefly Jar, island fireflies). Spec: docs/specs/nightlight.md.
// Run: node --test tests/nightlight.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const BUILD = '?build=v3-survival-ae77fa84ac2b';
const T = await import(new URL('vendor/three.module.js', base));
const I = await import(new URL('islands.js' + BUILD, base));
const D = await import(new URL('daynight.js' + BUILD, base));
const N = await import(new URL('nightlight.js' + BUILD, base));
const M = await import(new URL('nightlight-models.js' + BUILD, base));
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { ITEMS, PLACEABLE_IDS, BLOCK_RADII } = await import(new URL('items.js', base));
const { PLACEABLE_KINDS } = await import(new URL('held-items.js' + BUILD, base));
const { HELD } = await import(new URL('coop.js' + BUILD, base));
const { planPool, DAYNIGHT_CARRY, DAYNIGHT_LIVE, CARRY_PEAK, POOL_PEAK } = D;
const { canCatch, catchWindow, CATCH_REACH, createNightlight } = N;

const bagWith = (slots, selected = 0) => { const s = new Array(SLOT_COUNT).fill(null); slots.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected }); };
const night = (on = true, phase = 0.8) => { DAYNIGHT_LIVE.ready = on; DAYNIGHT_LIVE.phase = phase; };
const resetCarry = () => { DAYNIGHT_CARRY.want = false; DAYNIGHT_CARRY.local.on = false; DAYNIGHT_CARRY.partner.on = false; };

// ---------------------------------------------------------------- 1. pool plan
test('planPool: carried lights take the first slots, lanterns fill the rest in order', () => {
  const out = new Int32Array(4).fill(99), picks = new Int32Array([5, 2, -1, -1]);
  assert.equal(planPool(1, true, false, picks, out), 1); assert.equal(out[0], -2);
  assert.equal(planPool(1, false, true, picks, out), 1); assert.equal(out[0], -3);
  out.fill(99); assert.equal(planPool(2, true, true, picks, out), 2); assert.deepEqual([...out.slice(0, 2)], [-2, -3]);
  assert.equal(out[2], 99, 'never writes past cap');
  assert.equal(planPool(4, true, false, picks, out), 3); assert.deepEqual([...out], [-2, 5, 2, -1]);
  assert.equal(planPool(4, false, false, new Int32Array([-1, 3, -1, 1]), out), 2); assert.deepEqual([...out], [3, 1, -1, -1], 'skips -1 picks');
  out.fill(99); assert.equal(planPool(0, true, true, picks, out), 0); assert.deepEqual([...out], [99, 99, 99, 99]);
  assert.ok(CARRY_PEAK < POOL_PEAK);
});

// ---------------------------------------------------------------- 2. catch rules
test('canCatch: every reason, success on the shore edge, catchWindow edges', () => {
  const island = { cx: 10, cz: 0, R: 12, phase: 'docked' };
  const ok = { ready: true, phase: 0.8, island, x: 10 + 12 + CATCH_REACH, z: 0, jars: 1, wait: false };
  assert.equal(canCatch(ok), null);
  assert.equal(canCatch({ ...ok, phase: 0.01 }), null);
  assert.equal(canCatch({ ...ok, jars: 0 }), 'nojar');
  assert.equal(canCatch({ ...ok, phase: 0.5 }), 'day');
  assert.equal(canCatch({ ...ok, ready: false }), 'day');
  assert.equal(canCatch({ ...ok, island: null }), 'noisland');
  assert.equal(canCatch({ ...ok, island: { ...island, phase: 'gone' } }), 'noisland');
  assert.equal(canCatch({ ...ok, x: 10 + 12 + CATCH_REACH + 0.01 }), 'far');
  assert.equal(canCatch({ ...ok, x: NaN }), 'far');
  assert.equal(canCatch({ ...ok, wait: true }), 'wait');
  assert.equal(catchWindow(0.639), false); assert.equal(catchWindow(0.64), true);
  assert.equal(catchWindow(0.029), true); assert.equal(catchWindow(0.03), false);
});

// ---------------------------------------------------------------- 3. host action
function world({ role = 'host', bag = bagWith([{ kind: 'jar', count: 2 }]), physics = { x: 0, y: 1.8, z: 0 }, other = null, T: TT = T } = {}) {
  const notices = [], actions = [];
  const ctx = {
    T: TT, scene: new T.Scene(), camera: new T.PerspectiveCamera(70, 1, 0.05, 200), raft: new T.Group(),
    ocean: { mesh: { position: { y: -0.24 } }, getHeight: () => -0.24 },
    world: { tiles: [[0, 0], [1, 0]], decor: [] }, role, running: true, physics, other, options: { graphics: 'high' },
    localBag: () => bag, actorBag: () => bag, notice: s => notices.push(s), emit() {}, deckY: () => 0.2,
    action: a => { actions.push(a); return true; }, rebuildRaft() {},
  };
  const isl = I.createIslands(ctx), nl = createNightlight(ctx);
  return { ctx, isl, nl, bag, notices, actions, dispose() { nl.dispose(); isl.dispose(); } };
}
const nearIsland = w => { w.isl.debug.spawnNear(1234, 30); w.isl.update(0); const now = I.islandNow(); w.ctx.physics.x = now.cx + now.R + 1; w.ctx.physics.z = now.cz; return now; };

test('action: host swaps a jar for a firefly jar; full bag keeps the jar; guest uses ctx.other', () => {
  night(true, 0.8);
  const w = world();
  try {
    const now = nearIsland(w);
    assert.equal(w.nl.action({ kind: 'nightlight.catch' }, 'host', w.bag), true);
    assert.equal(w.bag.count('jar'), 1); assert.equal(w.bag.count('fireflyjar'), 1);
    assert.equal(w.nl.action({ kind: 'nightlight.catch' }, 'host', w.bag), true, 'claimed while cooling down');
    assert.equal(w.bag.count('jar'), 1, 'cooldown refuses the second catch');
    // full bag: every slot taken, jar stack > 1, so the firefly jar has nowhere to go
    const full = bagWith(Array.from({ length: SLOT_COUNT }, (_, i) => (i === 0 ? { kind: 'jar', count: 3 } : { kind: 'handlantern', count: 1 })));
    assert.equal(w.nl.action({ kind: 'nightlight.catch' }, 'guest', full), true);
    assert.equal(full.count('jar'), 3, 'guest far away (ctx.other null) is refused');
    w.ctx.other = { x: now.cx, z: now.cz, y: 1.8, held: 'jar' };
    assert.equal(w.nl.action({ kind: 'nightlight.catch' }, 'guest', full), true);
    assert.equal(full.count('jar'), 3, 'full bag keeps the jar'); assert.equal(full.count('fireflyjar'), 0);
    const gb = bagWith([{ kind: 'jar', count: 1 }]);
    w.ctx.physics.x = 999;
    assert.equal(w.nl.action({ kind: 'nightlight.catch' }, 'guest', gb), true);
    assert.equal(gb.count('fireflyjar'), 1, 'guest pose (ctx.other) decides reach, not the host');
    assert.equal(w.nl.action({ kind: 'other.thing' }, 'host', w.bag), false);
    assert.equal(w.nl.action(null, 'host', w.bag), false);
  } finally { w.dispose(); }
  const g = world({ role: 'guest' });
  try {
    assert.equal(g.nl.action({ kind: 'nightlight.catch' }, 'host', g.bag), true);
    assert.equal(g.bag.count('jar'), 2, 'guest role never runs action logic');
  } finally { g.dispose(); }
});

test('interact / prompt: holding a jar near an island at night catches; by day it hints', () => {
  night(true, 0.8);
  const w = world();
  try {
    assert.equal(w.nl.prompt(), null, 'no island: no prompt');
    nearIsland(w);
    assert.match(w.nl.prompt(), /<kbd>E<\/kbd>Catch fireflies/);
    assert.equal(w.nl.interact(), true);
    assert.deepEqual(w.actions, [{ kind: 'nightlight.catch' }]);
    assert.equal(w.notices.length, 1);
    assert.equal(w.nl.interact(), false, 'local cooldown: E keeps its normal meaning');
    night(true, 0.4);
    assert.equal(w.nl.prompt(), 'Fireflies come out after dusk');
    w.bag.select(1);
    assert.equal(w.nl.prompt(), null, 'not holding the jar');
    assert.equal(w.nl.interact(), false);
  } finally { w.dispose(); }
});

// ---------------------------------------------------------------- 4. item rules
test('items: hand lantern, glass jar and firefly jar rules', () => {
  const hl = ITEMS.handlantern, jar = ITEMS.jar, fj = ITEMS.fireflyjar;
  assert.equal(hl.stack, 1); assert.equal(hl.tool, false); assert.equal(hl.category, 'tool');
  assert.ok(!PLACEABLE_KINDS.includes('handlantern') && !PLACEABLE_IDS.includes('handlantern'));
  assert.equal(fj.placeable, true); assert.ok(PLACEABLE_IDS.includes('fireflyjar')); assert.ok(BLOCK_RADII.fireflyjar > 0);
  assert.equal(fj.recipe, null);
  for (const k of Object.keys(jar.recipe.cost)) assert.ok(ITEMS[k], `${k} is a real item`);
  for (const k of Object.keys(hl.recipe.cost)) assert.ok(ITEMS[k], `${k} is a real item`);
  assert.equal(HELD.at(-1), 'handlantern');
  assert.equal(HELD.indexOf('handlantern'), 21);
  assert.deepEqual(HELD.slice(0, 21), [null, 'hook', 'hammer', 'fishingrod', 'wood', 'leaf', 'scrap', 'plastic', 'sail', 'palm', 'lantern', 'net', 'bench', 'crate',
    'drum', 'pipes', 'bells', 'spade', 'finder', 'spear', 'metalspear'], 'old wire indices unchanged');
});

// ---------------------------------------------------------------- 5. no new lights
test('no new lights: update at night with local + partner lanterns builds no Light; one small swarm', () => {
  let lights = 0;
  const count = C => class extends C { constructor(...a) { super(...a); lights++; } };
  const TT = { ...T, PointLight: count(T.PointLight), SpotLight: count(T.SpotLight), DirectionalLight: count(T.DirectionalLight) };
  night(true, 0.8); resetCarry();
  const w = world({ T: TT, bag: bagWith([{ kind: 'handlantern', count: 1 }]), other: { x: 3, y: 1.8, z: 0, held: 'handlantern' } });
  try {
    nearIsland(w); w.ctx.physics.x = 0;
    for (let i = 0; i < 5; i++) w.nl.update(0.3);
    assert.equal(lights, 0);
    const st = w.nl.debug.state();
    assert.equal(st.local.on, true); assert.equal(st.partner.on, true); assert.equal(st.want, true);
    assert.ok(Math.abs(st.partner.y - 1.35) < 1e-9 && Math.abs(st.partner.z + 0.35) < 1e-9, 'partner light at hand height, a little ahead');
    assert.ok(st.local.y > w.ctx.camera.position.y + 0.2, 'carried light rides above the eye');
    assert.equal(st.swarm.lit, true); assert.ok(st.swarm.opacity > 0.5);
    const pts = []; w.ctx.scene.traverse(o => { if (o.isPoints) pts.push(o); });
    assert.equal(pts.length, 1); assert.ok(pts[0].geometry.attributes.position.count <= 40);
    assert.equal(pts[0].frustumCulled, false);
    w.ctx.other = { x: 80, y: 1.8, z: 0, held: 'handlantern' }; w.nl.update(0.1);
    assert.equal(w.nl.debug.state().partner.on, false, 'partner beyond 40 m');
    w.ctx.running = false; w.nl.update(0.1);
    assert.equal(DAYNIGHT_CARRY.local.on, false);
  } finally { w.dispose(); }
  assert.equal(DAYNIGHT_CARRY.want, false, 'dispose resets the carry registry');
});

test('want: solo without a lantern stays off; a partner joining attaches the pool at once', () => {
  night(true, 0.8); resetCarry();
  const w = world({ bag: bagWith([{ kind: 'wood', count: 1 }]) });
  try {
    for (let i = 0; i < 5; i++) w.nl.update(0.3);
    assert.equal(DAYNIGHT_CARRY.want, false, 'no lantern, no partner');
    w.ctx.other = { x: 50, y: 1.8, z: 0, held: null }; w.nl.update(0.01);
    assert.equal(DAYNIGHT_CARRY.want, true, 'join (even far away, empty-handed) attaches the pool');
  } finally { w.dispose(); }
});

test('daynight pool: a carried lantern takes slot 0 at night; light count only follows the graphics setting', () => {
  resetCarry();
  const scene = new T.Scene(), raft = new T.Group(); scene.add(raft);
  const ctx = { T, scene, raft, camera: new T.PerspectiveCamera(), role: 'host', options: { graphics: 'low' }, world: { decor: [] } };
  const dn = D.createDayNight(ctx);
  const nLights = () => { let n = 0; scene.traverse(o => { if (o.isPointLight) n++; }); return n; };
  try {
    dn.debug.setPhase(0.8); dn.update(1 / 60);
    assert.equal(nLights(), 0, 'no lantern, no carry: no pool');
    DAYNIGHT_CARRY.want = true; dn.update(1 / 60);
    assert.equal(nLights(), 1, 'want attaches the pool (low = 1 light)');
    assert.equal(dn.debug.state().poolCarry, 0);
    Object.assign(DAYNIGHT_CARRY.local, { on: true, x: 1, y: 2, z: 3 }); dn.update(1 / 60);
    assert.equal(nLights(), 1, 'equipping adds no light');
    assert.equal(dn.debug.state().poolCarry, 1);
    const l = scene.children.find(o => o.isPointLight);
    assert.deepEqual([l.position.x, l.position.y, l.position.z], [1, 2, 3]); assert.ok(l.intensity > 0 && l.intensity <= CARRY_PEAK);
    assert.equal(l.castShadow, false);
    dn.debug.setPhase(0.4); dn.update(1 / 60);
    assert.equal(l.intensity, 0, 'off by day'); assert.equal(nLights(), 1);
  } finally { dn.dispose(); resetCarry(); }
});

// ---------------------------------------------------------------- 6. models
const tris = o => { let n = 0; o.traverse(m => { if (m.isMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return n; };
test('models: firefly jar is a lit craft_lantern within budget; hand lantern and swarm', () => {
  const j = M.createFireflyJar(T);
  assert.equal(j.name, 'craft_lantern'); assert.equal(j.userData.craftType, 'fireflyjar');
  const glow = j.children.find(c => c.name === 'lanternGlow');
  assert.ok(glow?.isMesh && 'emissiveIntensity' in glow.material);
  if (!glow.geometry.boundingSphere) glow.geometry.computeBoundingSphere();
  assert.ok(glow.geometry.boundingSphere.center.y >= 0.18, 'pool light lifted off the deck');
  assert.ok(j.children.some(c => c.name === 'jarBugs') && j.children.some(c => c.name === 'jarGlass') && j.children.some(c => c.name === 'jarCork'));
  let meshes = 0; j.traverse(o => { if (o.isMesh) meshes++; });
  assert.ok(meshes <= 4, `${meshes} meshes`); assert.ok(tris(j) <= 400, `${tris(j)} triangles`);
  const j2 = M.createFireflyJar(T);
  assert.notEqual(j2.children.find(c => c.name === 'lanternGlow').material, glow.material, 'glow material per instance');
  const h = M.createHandLantern(T);
  assert.ok(h.userData.grip.isVector3 && h.userData.size.y > 0.25 && h.userData.size.y < 0.31);
  const hg = []; h.traverse(o => { if (o.name === 'handLanternGlow') hg.push(o); });
  assert.equal(hg.length, 1); assert.equal(hg[0].material, M.heldGlowMaterial(T), 'shared held glow');
  const s = M.createSwarm(T);
  assert.ok(s.isPoints && s.name === 'nightlight-swarm' && s.material.opacity === 0 && s.geometry.attributes.position.count === 40);
});

test('decorModel: fireflyjar only', () => {
  const w = world();
  try {
    assert.equal(w.nl.decorModel('fireflyjar').name, 'craft_lantern');
    assert.equal(w.nl.decorModel('lantern'), null);
    assert.equal(w.nl.serialize(), undefined);
    assert.doesNotThrow(() => { w.nl.load(undefined, 'save'); w.nl.load({ junk: 1 }, 'net'); });
    assert.equal(w.nl.debug.placeJar(1, 0), true); assert.equal(w.ctx.world.decor.at(-1).type, 'fireflyjar');
    assert.equal(w.nl.debug.placeJar(1, 0), false, 'tile taken');
  } finally { w.dispose(); }
});

// ---------------------------------------------------------------- 7. daynight off
test('daynight off: nightlight runs without errors and catching says day', () => {
  const off = D.createDayNightOff({ role: 'host' });
  off.load(undefined);
  night(false, 0.8); resetCarry();
  const w = world({ bag: bagWith([{ kind: 'jar', count: 1 }, { kind: 'handlantern', count: 1 }]) });
  try {
    nearIsland(w);
    assert.doesNotThrow(() => { for (let i = 0; i < 3; i++) w.nl.update(0.5); });
    assert.equal(w.nl.debug.state().reason, 'day');
    assert.equal(w.nl.prompt(), 'Fireflies come out after dusk');
    assert.equal(w.nl.interact(), false);
    assert.equal(w.nl.action({ kind: 'nightlight.catch' }, 'host', w.bag), true);
    assert.equal(w.bag.count('jar'), 1);
    assert.equal(w.nl.debug.state().swarm.opacity, 0);
  } finally { w.dispose(); }
});
