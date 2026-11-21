// Unit tests for the islands content module (pure logic + a stub-ctx run).
// Run: node --test tests/islands.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const L = await import(new URL('islands-layout.js', base));
const { createIslands } = await import(new URL('islands.js', base));
const { Bag, SLOT_COUNT, STACK_SIZE } = await import(new URL('inventory-state.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));
const { ISLAND, layoutFor, pathAt, clean, lootFor, groundHeight, nextDelay, dockOffset, applyGather, standOnSand, SHORE_U } = L;

const RAFT3 = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
const SEEDS = Array.from({ length: 300 }, (_, i) => (i * 2654435761) >>> 0);
const emptyBag = () => new Bag({ slots: new Array(SLOT_COUNT).fill(null), selected: 0 });
const fullBag = () => new Bag({ slots: new Array(SLOT_COUNT).fill(null).map(() => ({ kind: 'plastic', count: STACK_SIZE })), selected: 0 });
const nearestTileDist = (x, z, tiles) => Math.min(...tiles.map(([tx, tz]) => {
  const px = Math.max(tx * 2 - 1, Math.min(x, tx * 2 + 1)), pz = Math.max(tz * 2 - 1, Math.min(z, tz * 2 + 1));
  return Math.hypot(x - px, z - pz);
}));

// ---------------------------------------------------------------- layout

test('layoutFor is deterministic and well formed', () => {
  assert.deepEqual(layoutFor(1234), layoutFor(1234));
  for (const seed of SEEDS) {
    const lay = layoutFor(seed);
    assert.ok(lay.R >= 6 && lay.R <= 9);
    const count = k => lay.nodes.filter(n => n.kind === k).length;
    assert.ok(count('palm') >= 1 && count('palm') <= 3, `palms ${count('palm')}`);
    for (const k of ['bush', 'rock']) assert.ok(count(k) >= 2 && count(k) <= 4, `${k} ${count(k)}`);
    assert.ok(count('sand') >= 2 && count('sand') <= 3);
    assert.ok(lay.nodes.length <= ISLAND.MAX_NODES);
    for (const n of lay.nodes) {
      assert.ok(Math.hypot(n.x, n.z) <= 0.8 * lay.R, 'node inside 0.8 R');
      // on dry sand a player can stand on (above the wave margin)
      assert.ok(n.y > 0.25 + 0.26 - 0.05, `node on dry sand y=${n.y.toFixed(2)}`);
    }
    for (let i = 0; i < lay.nodes.length; i++) for (let j = i + 1; j < lay.nodes.length; j++) {
      const a = lay.nodes[i], b = lay.nodes[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 1, 'nodes at least 1 m apart');
    }
  }
});

test('groundHeight: dome top, shoreline, rim', () => {
  assert.equal(groundHeight(0, 7), ISLAND.TOP);
  assert.ok(Math.abs(groundHeight(SHORE_U * 7 * L.shape(0), 7, 0)) < 1e-9, 'shoreline at SHORE_U');
  assert.ok(Number.isNaN(groundHeight(7 * 2, 7)));
  assert.ok(Number.isNaN(groundHeight(NaN, 7)));
  let prev = Infinity;
  for (let r = 0; r <= 7; r += 0.25) { const g = groundHeight(r, 7, 1); assert.ok(g <= prev); prev = g; }
});

// ---------------------------------------------------------------- timeline

test('pathAt phases in order with continuous z', () => {
  const dock = 180, dz = -3, order = [];
  let lastZ = pathAt(0, dock, dz).z;
  for (let t = 0; t <= 25 + dock + 30 + 2; t += 0.05) {
    const p = pathAt(t, dock, dz);
    if (order.at(-1) !== p.phase) order.push(p.phase);
    assert.ok(Math.abs(p.z - lastZ) < 0.5, `z jump at t=${t}`);
    lastZ = p.z;
  }
  assert.deepEqual(order, ['approach', 'docked', 'depart', 'gone']);
  assert.equal(pathAt(0, dock, dz).z, ISLAND.START_Z);
  assert.equal(pathAt(100, dock, dz).z, dz);
});

test('docked island sits a short swim from a 3x3 raft', () => {
  for (const seed of SEEDS) {
    const lay = layoutFor(seed), { side, off } = dockOffset(RAFT3, lay);
    assert.ok(side === 1 || side === -1);
    const x = side * off, z = lay.dockZ;
    assert.ok(off - 3 >= 10, 'centre gap >= 10 m from the raft box');
    assert.ok(nearestTileDist(x, z, RAFT3) <= 38, 'centre within 38 m of the nearest tile');
    const swim = off - 3 - lay.R * SHORE_U;
    assert.ok(swim > 8 && swim < 15, `swim ${swim}`);
  }
  // picks the clearer side of a lopsided raft
  const lop = [[0, 0], [1, 0], [2, 0], [3, 0]];
  assert.equal(dockOffset(lop, layoutFor(5)).side, -1);
});

test('nextDelay', () => {
  assert.equal(nextDelay(1, true), 90);
  for (const s of SEEDS) { const d = nextDelay(s); assert.ok(d >= 150 && d <= 240); }
});

// ---------------------------------------------------------------- save validation

test('clean: garbage gives defaults', () => {
  for (const bad of [undefined, null, 'x', 7, [], { v: 2 }, { v: '1' }]) assert.deepEqual(clean(bad), { v: 1, clock: 0, next: 90, isl: null });
});

test('clean fixes or drops bad fields', () => {
  assert.equal(clean({ v: 1, clock: NaN, next: 50, isl: null }).clock, 0);
  assert.equal(clean({ v: 1, clock: 10, next: 5000, isl: null }).next, 610);
  const good = { seed: 1234, born: 0, dock: 180, side: 1, off: 20, used: [] };
  const n = layoutFor(1234).nodes.length;
  assert.equal(clean({ v: 1, clock: 30, next: 0, isl: { ...good, side: 0 } }).isl, null);
  assert.equal(clean({ v: 1, clock: 30, next: 0, isl: { ...good, seed: 1.5 } }).isl, null);
  assert.equal(clean({ v: 1, clock: 30, next: 0, isl: { ...good, seed: -1 } }).isl, null);
  assert.equal(clean({ v: 1, clock: 30, next: 0, isl: { ...good, used: 'no' } }).isl, null);
  const fixed = clean({ v: 1, clock: 30, next: 0, isl: { ...good, used: [99, -4, 1.5, 2, ...new Array(40).fill(1)] } }).isl;
  assert.equal(fixed.used.length, n);
  assert.equal(fixed.used[0], layoutFor(1234).nodes[0].max);
  assert.equal(fixed.used[1], 0);
  assert.equal(fixed.used[2], 0);
  assert.equal(fixed.used[3], Math.min(2, layoutFor(1234).nodes[3].max));
  assert.equal(clean({ v: 1, clock: 30, next: 0, isl: { ...good, off: 500 } }).isl.off, ISLAND.OFF_MAX);
  // already gone when loaded: dropped
  assert.equal(clean({ v: 1, clock: 1000, next: 0, isl: { ...good, born: 0 } }).isl, null);
});

// ---------------------------------------------------------------- loot and the host gather check

test('lootFor table', () => {
  assert.deepEqual(lootFor('palm', 1, 0, 0), [['wood', 1], ['leaf', 1]]);
  assert.deepEqual(lootFor('palm', 1, 0, 2), [['wood', 1], ['leaf', 1], ['seed', 1]]);
  assert.deepEqual(lootFor('rock', 1, 0, 0), [['stone', 1]]);
  assert.deepEqual(lootFor('sand', 1, 0, 3), [['sand', 1]]);
  for (let s = 0; s < 50; s++) assert.deepEqual(lootFor('bush', s, 2, 1), lootFor('bush', s, 2, 1));
  const seeds = Array.from({ length: 400 }, (_, s) => lootFor('bush', s, 0, 0).length - 1).reduce((a, b) => a + b);
  assert.ok(seeds > 120 && seeds < 280, `bush seed rate ${seeds}/400`);
});

function gatherSetup() {
  const lay = layoutFor(1234);
  const st = { isl: { seed: 1234, born: 0, dock: 180, side: 1, off: 20, used: lay.nodes.map(() => 0) }, layout: lay, cx: 20, cz: -2, clock: 100, cool: { host: 0, guest: 0 } };
  const k = lay.nodes.findIndex(n => n.kind === 'rock');
  const n = lay.nodes[k];
  const pos = { x: st.cx + n.x + 1, z: st.cz + n.z };
  return { lay, st, k, n, pos };
}

test('applyGather grants loot and counts the gather', () => {
  const { st, k, pos } = gatherSetup(), bag = emptyBag();
  const r = applyGather(st, { kind: 'islands.gather', seed: 1234, node: k }, 'host', pos, bag);
  assert.equal(r.ok, true);
  assert.equal(bag.count('stone'), 1);
  assert.equal(st.isl.used[k], 1);
  // palm on the third gather gives a seed
  const p = st.layout.nodes.findIndex(n => n.kind === 'palm'), pn = st.layout.nodes[p];
  const ppos = { x: st.cx + pn.x, z: st.cz + pn.z + 1 };
  for (let i = 0; i < 3; i++) { st.clock += 1; assert.equal(applyGather(st, { kind: 'islands.gather', seed: 1234, node: p }, 'host', ppos, bag).ok, true); }
  assert.equal(bag.count('wood'), 3); assert.equal(bag.count('leaf'), 3); assert.equal(bag.count('seed'), 1);
});

test('applyGather rejects bad requests without changes', () => {
  const { st, k, n, pos } = gatherSetup();
  const bag = emptyBag(), snap = JSON.stringify(bag.snapshot());
  const tries = [
    [{ kind: 'islands.gather', seed: 999, node: k }, pos, 'stale'],
    [{ kind: 'islands.gather', seed: 1234, node: -1 }, pos, 'node'],
    [{ kind: 'islands.gather', seed: 1234, node: 99 }, pos, 'node'],
    [{ kind: 'islands.gather', seed: 1234, node: '0' }, pos, 'node'],
    [{ kind: 'islands.gather', seed: 1234, node: k }, { x: pos.x + 10, z: pos.z }, 'reach'],
    [{ kind: 'islands.gather', seed: 1234, node: k }, null, 'reach'],
  ];
  for (const [a, p, why] of tries) {
    const r = applyGather(st, a, 'guest', p, bag);
    assert.equal(r.ok, false); assert.equal(r.reason, why);
  }
  assert.equal(JSON.stringify(bag.snapshot()), snap);
  assert.ok(st.isl.used.every(u => u === 0));
  // cooldown
  assert.equal(applyGather(st, { kind: 'islands.gather', seed: 1234, node: k }, 'guest', pos, bag).ok, true);
  assert.equal(applyGather(st, { kind: 'islands.gather', seed: 1234, node: k }, 'guest', pos, bag).reason, 'cooldown');
  assert.equal(st.isl.used[k], 1);
  // host cooldown is separate
  assert.equal(applyGather(st, { kind: 'islands.gather', seed: 1234, node: k }, 'host', pos, bag).ok, true);
  // drained
  st.isl.used[k] = n.max; st.clock += 5;
  assert.equal(applyGather(st, { kind: 'islands.gather', seed: 1234, node: k }, 'host', pos, bag).reason, 'drained');
  assert.equal(st.isl.used[k], n.max);
  // no island
  assert.equal(applyGather({ ...st, isl: null }, { kind: 'islands.gather', seed: 1234, node: k }, 'host', pos, bag).reason, 'none');
});

test('applyGather with a full bag is atomic', () => {
  const { st, pos } = gatherSetup();
  const p = st.layout.nodes.findIndex(n => n.kind === 'palm'), pn = st.layout.nodes[p];
  const bag = fullBag(); bag.slots[0] = { kind: 'wood', count: 1 }; // wood fits, leaf does not
  const before = JSON.stringify(bag.snapshot());
  const r = applyGather(st, { kind: 'islands.gather', seed: 1234, node: p }, 'host', { x: st.cx + pn.x, z: st.cz + pn.z }, bag);
  assert.equal(r.ok, false); assert.equal(r.reason, 'full');
  assert.equal(JSON.stringify(bag.snapshot()), before);
  assert.equal(st.isl.used[p], 0);
  void pos;
});

// ---------------------------------------------------------------- stub ctx: the real module

function stubWorld({ role = 'solo', wave = () => -0.24 } = {}) {
  const physics = new PlayerPhysics({ x: 0, y: 0.2 + PC.EYE_OFFSET, z: 0 });
  const emits = [], actions = [];
  const ctx = {
    T, scene: new T.Scene(), camera: new T.PerspectiveCamera(70, 1, 0.05, 200),
    ocean: { mesh: { position: { y: -0.24 } }, getHeight: (x, z) => wave(x, z) },
    world: { tiles: RAFT3 }, role, running: true, physics, other: null,
    emit: (e, to) => emits.push({ e, to }),
    action: a => { actions.push(a); if (role !== 'guest') mod.action(a, 'host', bag); return true; },
  };
  const bag = emptyBag();
  const mod = createIslands(ctx);
  return { ctx, mod, physics, emits, actions, bag };
}
const step = (w, n, input = {}) => {
  for (let i = 0; i < n; i++) {
    w.physics.update(1 / 60, { tiles: RAFT3, deckY: 0.2, waterY: w.ctx.ocean.getHeight(w.physics.x, w.physics.z), ...input });
    w.mod.afterMove(w.physics, 1 / 60);
    w.mod.update(1 / 60);
  }
};

test('stand on sand: grounded, never swimming, feet on the ground', () => {
  const w = stubWorld();
  w.mod.debug.spawnNear(1234); w.mod.update(0);
  assert.equal(w.mod.debug.teleportAshore(), true);
  let splashes = 0;
  for (let i = 0; i < 120; i++) {
    const ev = w.physics.update(1 / 60, { tiles: RAFT3, deckY: 0.2, waterY: -0.24, forward: i < 60 ? 0.5 : 0, yaw: 1 });
    if (ev.splashed) splashes++;
    w.mod.afterMove(w.physics, 1 / 60); w.mod.update(1 / 60);
    assert.equal(w.physics.grounded, true); assert.equal(w.physics.swimming, false);
    const g = w.mod.debug.groundAt(w.physics.x, w.physics.z);
    assert.ok(Math.abs(w.physics.y - PC.EYE_OFFSET - g) < 0.02, 'feet within 2 cm of the sand');
  }
  assert.equal(splashes, 0);
});

test('stand on sand with waves: the walkable top never splashes', () => {
  const wave = (x, z) => -0.24 + 0.255 * Math.sin(x * 0.7 + z * 0.3 + performance.now() * 0.003);
  const w = stubWorld({ wave });
  w.mod.debug.spawnNear(1234); w.mod.update(0); w.mod.debug.teleportAshore();
  for (let i = 0; i < 240; i++) {
    const ev = w.physics.update(1 / 60, { tiles: RAFT3, deckY: 0.2, waterY: wave(w.physics.x, w.physics.z), forward: 0.6, yaw: (i / 60) * 2 });
    assert.ok(!ev.splashed);
    w.mod.afterMove(w.physics, 1 / 60); w.mod.update(1 / 60);
    assert.equal(w.physics.swimming, false);
  }
});

test('stand on sand: jumping lifts off and lands again', () => {
  const w = stubWorld();
  w.mod.debug.spawnNear(1234); w.mod.update(0); w.mod.debug.teleportAshore();
  step(w, 5);
  const y0 = w.physics.y;
  step(w, 1, { jump: true });
  let top = 0;
  for (let i = 0; i < 40; i++) { step(w, 1, { jump: true }); top = Math.max(top, w.physics.y - y0); }
  assert.ok(top > 0.5, `jumped ${top}`);
  step(w, 60);
  assert.equal(w.physics.grounded, true);
  assert.ok(Math.abs(w.physics.y - y0) < 0.05);
});

test('stand on sand: no _prevJump means no jump, nothing breaks', () => {
  const p = { x: 0, y: 2.4, z: 0, vy: 0, grounded: true, swimming: false, verticalSpeed: 0, climbing: false };
  const s = { onSand: true, lastJump: false };
  standOnSand(p, 0.8, -0.24, s);
  assert.equal(p.grounded, true); assert.ok(Math.abs(p.y - (0.8 + PC.EYE_OFFSET)) < 1e-9);
  standOnSand(p, 0.8, -0.24, s);
  assert.equal(p.vy, 0);
});

test('walking off the rim ends up swimming; swimming in lands on the sand', () => {
  const w = stubWorld();
  w.mod.debug.spawnNear(1234); w.mod.update(0); w.mod.debug.teleportAshore();
  const st = w.mod.debug.state();
  // face away from the raft side (island is on -x): walk toward -x
  const yaw = Math.PI / 2; // forward = (-sin yaw, -cos yaw) = (-1, 0)
  step(w, 60 * 8, { forward: 1, yaw });
  assert.equal(w.physics.swimming, true);
  assert.ok(Math.abs(w.physics.x - st.cx) > 6);
  step(w, 60 * 10, { forward: 1, yaw: -Math.PI / 2 });
  assert.equal(w.physics.swimming, false);
  assert.equal(w.physics.grounded, true);
  assert.equal(w.mod.debug.state().onSand, true);
});

test('timeline: waits while a player is close, departs at the cap', () => {
  const w = stubWorld();
  w.mod.debug.spawnNear(1234); w.mod.update(0); w.mod.debug.teleportAshore();
  // nobody near: departs after the normal dock
  const w2 = stubWorld(); w2.mod.debug.spawnNear(1234); w2.mod.update(0);
  for (let i = 0; i < 200 * 10; i++) w2.mod.update(0.1);
  assert.equal(w2.mod.debug.phase().phase, 'depart');
  assert.ok(w2.emits.some(x => /drift away/.test(x.e.text)));
  // someone standing on it: still docked well past 180 s
  for (let i = 0; i < 400 * 10; i++) { w.mod.afterMove(w.physics, 0.1); w.mod.update(0.1); }
  assert.equal(w.mod.debug.phase().phase, 'docked');
  // ... but the 600 s cap departs anyway
  for (let i = 0; i < 300 * 10; i++) { w.mod.afterMove(w.physics, 0.1); w.mod.update(0.1); }
  assert.notEqual(w.mod.debug.phase().phase, 'docked');
});

test('full cycle: calm, first island at 90 s, gone, calm again', () => {
  const w = stubWorld();
  w.mod.load(undefined, 'save');
  for (let i = 0; i < 89 * 10; i++) w.mod.update(0.1);
  assert.equal(w.mod.debug.phase().phase, 'calm');
  for (let i = 0; i < 2 * 10; i++) w.mod.update(0.1);
  assert.equal(w.mod.debug.phase().phase, 'approach');
  const seen = new Set();
  for (let i = 0; i < 300 * 10; i++) { w.mod.update(0.1); seen.add(w.mod.debug.phase().phase); }
  assert.ok(seen.has('docked') && seen.has('depart') && seen.has('calm'));
  const ph = w.mod.debug.phase();
  assert.ok(ph.next - ph.clock >= 0 && ph.next - ph.clock <= 240);
});

test('module survives garbage loads and round-trips its save', () => {
  const w = stubWorld();
  w.mod.load(undefined, 'save');
  w.mod.load({ v: 1, clock: 'x', isl: { seed: 'nope' } }, 'net');
  w.mod.load([1, 2, 3], 'restore');
  w.mod.debug.spawnNear(4321); w.mod.update(1);
  w.mod.debug.aimAt(0);
  w.mod.interact(null);
  const a = JSON.stringify(w.mod.serialize());
  const w2 = stubWorld();
  w2.mod.load(JSON.parse(a), 'save');
  assert.equal(JSON.stringify(w2.mod.serialize()), a);
  w2.mod.load(JSON.parse(a), 'net'); // idempotent
  assert.equal(JSON.stringify(w2.mod.serialize()), a);
  assert.equal(w.mod.action({ kind: 'islands.bogus' }, 'host', w.bag), true);
  assert.equal(w.mod.action({ kind: 'craft' }, 'host', w.bag), false);
  w.mod.dispose();
});

test('E on a node gathers through ctx.action; guests only send', () => {
  const w = stubWorld();
  w.mod.debug.spawnNear(1234); w.mod.update(0);
  const k = w.mod.debug.nodes().findIndex(n => n.kind === 'rock');
  const n = w.mod.debug.aimAt(k); w.mod.update(0);
  w.ctx.camera.position.set(w.physics.x, w.physics.y, w.physics.z);
  w.ctx.camera.lookAt(n.x, n.cy, n.z); w.ctx.camera.updateMatrixWorld();
  assert.match(w.mod.prompt(null), /Gather stone/);
  assert.equal(w.mod.interact(null), true);
  assert.deepEqual(w.actions.at(-1), { kind: 'islands.gather', seed: 1234, node: k });
  assert.equal(w.bag.count('stone'), 1);
  assert.equal(w.mod.serialize().isl.used[k], 1);
  // looking at the sky: no prompt, E falls through to the inventory
  w.ctx.camera.lookAt(w.physics.x, w.physics.y + 10, w.physics.z); w.ctx.camera.updateMatrixWorld();
  assert.equal(w.mod.prompt(null), null);
  assert.equal(w.mod.interact(null), false);

  const g = stubWorld({ role: 'guest' });
  g.mod.load(JSON.parse(JSON.stringify(w.mod.serialize())), 'net'); g.mod.update(0);
  assert.equal(g.mod.debug.phase().seed, 1234);
  assert.equal(g.mod.debug.spawnNear(), false);
  assert.equal(g.mod.action({ kind: 'islands.gather', seed: 1234, node: k }, 'guest', g.bag), true);
  assert.equal(g.bag.count('stone'), 0);
});
