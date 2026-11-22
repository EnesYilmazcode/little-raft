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
      assert.ok(n.y > 0.25 + 0.26 - 0.1, `node on dry sand y=${n.y.toFixed(2)}`);
    }
    for (let i = 0; i < lay.nodes.length; i++) for (let j = i + 1; j < lay.nodes.length; j++) {
      const a = lay.nodes[i], b = lay.nodes[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 1, 'nodes at least 1 m apart');
    }
  }
});

test('groundHeight: dome top, shoreline, rim', () => {
  assert.equal(groundHeight(0, 7), ISLAND.TOP);
  assert.ok(Math.abs(groundHeight(SHORE_U * 7 * L.shape(0), 7, 0)) < 0.01, 'shoreline at SHORE_U (dunes fade out)');
  assert.ok(Number.isNaN(groundHeight(7 * 2, 7)));
  assert.ok(Number.isNaN(groundHeight(NaN, 7)));
  let prev = Infinity;
  for (let r = 3.5; r <= 7; r += 0.25) { const g = groundHeight(r, 7, 1); assert.ok(g <= prev); prev = g; }
  for (let th = 0; th < 6.3; th += 0.3) for (let r = 0; r <= 4; r += 0.25) assert.ok(Math.abs(groundHeight(r, 7, th) - (ISLAND.TOP - ISLAND.FALL * (r / 7 / L.shape(th)) ** 4)) < 0.17, 'dunes stay low');
});

// ---------------------------------------------------------------- timeline

test('pathAt phases in order with continuous z', () => {
  const dock = 180, dz = -3, order = [];
  let lastZ = pathAt(0, dock, dz).z;
  for (let t = 0; t <= ISLAND.APPROACH + dock + ISLAND.DEPART + 2; t += 0.05) {
    const p = pathAt(t, dock, dz);
    if (order.at(-1) !== p.phase) order.push(p.phase);
    assert.ok(Math.abs(p.z - lastZ) < 0.5, `z jump at t=${t}`);
    lastZ = p.z;
  }
  assert.deepEqual(order, ['approach', 'docked', 'depart', 'gone']);
  assert.equal(pathAt(0, dock, dz).z, ISLAND.START_Z);
  assert.equal(pathAt(ISLAND.APPROACH, dock, dz).z, dz);
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
  // palms: one chop; the fifth (felling) chop always brings 5 planks + 2 leaves (see tests/axe.test.mjs)
  assert.deepEqual(lootFor('palm', 1, 0, 4).slice(0, 2), [['wood', 5], ['leaf', 2]]);
  assert.ok(lootFor('palm', 1, 0, 0).every(([k]) => k === 'coconut' || k === 'seed'));
  assert.deepEqual(lootFor('rock', 1, 0, 0), [['stone', 1]]);
  assert.deepEqual(lootFor('sand', 1, 0, 3), [['sand', 1]]);
  for (let s = 0; s < 50; s++) assert.deepEqual(lootFor('bush', s, 2, 1), lootFor('bush', s, 2, 1));
  const seeds = Array.from({ length: 400 }, (_, s) => lootFor('bush', s, 0, 0).length - 1).reduce((a, b) => a + b);
  assert.ok(seeds > 120 && seeds < 280, `bush seed rate ${seeds}/400`);
  const flowers = Array.from({ length: 400 }, (_, s) => lootFor('bush', s, 0, 0).some(([k]) => k === 'flowerseed') ? 1 : 0).reduce((a, b) => a + b); // [bees]
  assert.ok(flowers > 40 && flowers < 130, `bush flower seed rate ${flowers}/400`);
  const berries = Array.from({ length: 400 }, (_, s) => { const r = lootFor('bush', s, 0, 0); return r.length === 1 && r[0][0] === 'berries' && r[0][1] === 2 ? 1 : 0; }).reduce((a, b) => a + b); // [juicer]
  assert.ok(berries > 60 && berries < 140, `bush berry rate ${berries}/400`); // [juicer]
  for (let s = 0; s < 400; s++) { const r = lootFor('bush', s, 0, 0); if (r.some(([k]) => k === 'berries')) assert.deepEqual(r, [['berries', 2]], 'berries never come with a seed'); } // [juicer]
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
  // bare hands get nothing from a palm any more
  const p = st.layout.nodes.findIndex(n => n.kind === 'palm'), pn = st.layout.nodes[p];
  const ppos = { x: st.cx + pn.x, z: st.cz + pn.z + 1 };
  st.clock += 1;
  assert.equal(applyGather(st, { kind: 'islands.gather', seed: 1234, node: p }, 'host', ppos, bag).reason, 'axe');
  assert.equal(bag.count('wood'), 0); assert.equal(st.isl.used[p], 0);
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
  const bag = fullBag(); bag.slots[0] = { kind: 'wood', count: 1 }; bag.slots[1] = { kind: 'axe', count: 1, durability: 100 }; // wood fits, leaf does not
  st.isl.used[p] = 4; // the felling chop
  const before = JSON.stringify(bag.snapshot());
  const r = applyGather(st, { kind: 'islands.chop', seed: 1234, node: p, slot: 1 }, 'host', { x: st.cx + pn.x, z: st.cz + pn.z }, bag);
  assert.equal(r.ok, false); assert.equal(r.reason, 'full');
  assert.equal(JSON.stringify(bag.snapshot()), before);
  assert.equal(st.isl.used[p], 4);
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
  for (let i = 0; i < (ISLAND.APPROACH + ISLAND.DOCK + ISLAND.DEPART + 20) * 10; i++) { w.mod.update(0.1); seen.add(w.mod.debug.phase().phase); }
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

// ---------------------------------------------------------------- review fixes

const { createOcean } = await import(new URL('ocean.js', base));
function oceanWorld(seed = 1234) {
  const ocean = createOcean(T, {});
  let t = 0;
  const w = stubWorld();
  w.ctx.ocean = ocean;
  const frame = (input = {}) => {
    t += 1 / 60; ocean.update(t);
    const ev = w.physics.update(1 / 60, { tiles: RAFT3, deckY: 0.2, waterY: ocean.getHeight(w.physics.x, w.physics.z), ...input });
    w.mod.afterMove(w.physics, 1 / 60); w.mod.update(1 / 60);
    return ev;
  };
  w.mod.debug.spawnNear(seed, ISLAND.APPROACH + 1); frame();
  return { ...w, frame, lay: layoutFor(seed) };
}

test('shoreline with real waves: standing at u = 0.75 for 20 s never splashes or flips', () => {
  const w = oceanWorld(1234);
  for (const a of [0, Math.PI / 2, Math.PI, 4.2]) {
    const r = 0.75 * w.lay.R * L.shape(a - w.lay.rot);
    assert.equal(w.mod.debug.teleportAshore(Math.cos(a) * r, Math.sin(a) * r), true);
    let splashes = 0, flips = 0, prev = w.physics.swimming;
    for (let i = 0; i < 60 * 20; i++) {
      if (w.frame().splashed) splashes++;
      if (w.physics.swimming !== prev) flips++; prev = w.physics.swimming;
    }
    assert.equal(splashes, 0, `splashes at angle ${a}`); assert.equal(flips, 0, `swim flips at angle ${a}`);
    assert.equal(w.mod.debug.state().onSand, true);
  }
});

test('shoreline with real waves: walking along the beach for 20 s stays dry', () => {
  const w = oceanWorld(99), U = 0.72;
  w.mod.debug.teleportAshore(U * w.lay.R * L.shape(-w.lay.rot), 0);
  let splashes = 0, flips = 0, prev = w.physics.swimming, lap = 0, lastTh = 0;
  for (let i = 0; i < 60 * 20; i++) {
    const s = w.mod.debug.state(), dx = w.physics.x - s.cx, dz = w.physics.z - s.cz, th = Math.atan2(dz, dx);
    const err = U * w.lay.R * L.shape(th - w.lay.rot) - Math.hypot(dx, dz);
    const mx = -Math.sin(th) + 2 * err * Math.cos(th), mz = Math.cos(th) + 2 * err * Math.sin(th);
    if (w.frame({ forward: 1, yaw: Math.atan2(-mx, -mz) }).splashed) splashes++;
    if (w.physics.swimming !== prev) flips++; prev = w.physics.swimming;
    if (i) lap += Math.abs(Math.atan2(Math.sin(th - lastTh), Math.cos(th - lastTh)));
    lastTh = th;
  }
  assert.ok(lap > Math.PI, `walked ${lap.toFixed(1)} rad round the beach`);
  assert.equal(splashes, 0); assert.equal(flips, 0);
});

test('stand on sand: hysteresis, a lapping wave does not knock you off', () => {
  const p = { x: 0, y: 0.3 + PC.EYE_OFFSET, z: 0, vy: 0, grounded: true, swimming: false, verticalSpeed: 0, climbing: false };
  const s = { onSand: false, lastJump: false };
  assert.equal(standOnSand(p, 0.3, 0.2, s), false, 'too wet to step onto');
  assert.equal(standOnSand(p, 0.3, 0.0, s), true);
  assert.equal(standOnSand(p, 0.3, 0.35, s), true, 'stays on once standing');
  assert.ok(p.y - PC.EYE_OFFSET >= 0.35 + PC.WATER_ENTER, 'feet kept dry above the wave');
  assert.equal(standOnSand(p, 0.3, 0.45, s), false, 'a deep wave lets go');
});

test('departing island slides out from under the player (no 50 m ride)', () => {
  const w = oceanWorld(1234);
  const dock = w.mod.debug.phase();
  w.mod.debug.teleportAshore(0, 0);
  let maxFromDock = 0;
  for (let i = 0; i < 60 * 700; i++) {
    w.frame();
    maxFromDock = Math.max(maxFromDock, Math.hypot(w.physics.x - dock.x, w.physics.z - dock.z));
  }
  assert.equal(w.mod.debug.phase().phase, 'calm');
  assert.ok(maxFromDock < dock.R + 3, `stayed near the dock spot (${maxFromDock.toFixed(1)} m)`);
  assert.equal(w.physics.swimming, true);
});

test('rider moves with the approaching island in the same frame', () => {
  const w = stubWorld();
  w.mod.debug.spawnNear(1234, ISLAND.APPROACH - 20); w.mod.update(0); // still gliding in, inside the 50 m safety radius
  assert.equal(w.mod.debug.teleportAshore(1, 1), true);
  const off = () => w.physics.z - w.mod.debug.state().cz;
  step(w, 1); // settle (a palm or rock may nudge us on the first frame)
  const o0 = off(), z0 = w.mod.debug.state().cz;
  for (let i = 0; i < 60; i++) {
    w.physics.update(1 / 60, { tiles: RAFT3, deckY: 0.2, waterY: -0.24 });
    w.mod.afterMove(w.physics, 1 / 60); // game.js sets the camera here...
    w.mod.update(1 / 60);               // ...and the island is drawn where update leaves it
    assert.ok(Math.abs(off() - o0) < 1e-6, 'no lag between the camera and the island');
  }
  assert.equal(w.mod.debug.phase().phase, 'approach');
  assert.ok(w.mod.debug.state().cz - z0 > 1, 'the island did move');
});

test('guest clock eases small corrections and snaps big ones', () => {
  const h = stubWorld(); h.mod.debug.spawnNear(1234); h.mod.update(1);
  const g = stubWorld({ role: 'guest' });
  const snap = () => JSON.parse(JSON.stringify(h.mod.serialize()));
  g.mod.load(snap(), 'net');
  const c0 = g.mod.debug.phase().clock;
  const s = snap(); s.clock += 0.5;
  g.mod.load(s, 'net');
  assert.ok(Math.abs(g.mod.debug.phase().clock - c0) < 1e-9, 'no pop on load');
  g.mod.update(1 / 60);
  assert.ok(g.mod.debug.phase().clock - c0 < 0.1, 'eases, does not jump');
  for (let i = 0; i < 119; i++) g.mod.update(1 / 60);
  assert.ok(Math.abs(g.mod.debug.phase().clock - (s.clock + 2)) < 0.01, 'caught up');
  const far = snap(); far.clock += 5;
  g.mod.load(far, 'net');
  assert.equal(g.mod.debug.phase().clock, far.clock, 'over 1 s off: snap');
  const back = snap(); back.clock += 0.3;
  g.mod.load(back, 'save');
  assert.equal(g.mod.debug.phase().clock, back.clock, 'saves snap');
});

test('guest gets reach slack and a friendly notice when too far', () => {
  const { st, k, n } = gatherSetup(), bag = emptyBag();
  const at = d => ({ x: st.cx + n.x + d, z: st.cz + n.z });
  const a = { kind: 'islands.gather', seed: 1234, node: k };
  assert.equal(applyGather(st, a, 'host', at(ISLAND.REACH + 0.5), bag).reason, 'reach');
  assert.equal(applyGather(st, a, 'guest', at(ISLAND.REACH + 0.5), bag).ok, true);
  st.clock += 1;
  assert.equal(applyGather(st, a, 'guest', at(ISLAND.REACH + 1.5), bag).reason, 'reach');

  const w = stubWorld(); w.mod.debug.spawnNear(1234); w.mod.update(0);
  w.ctx.other = { x: 1e3, z: 1e3 };
  w.mod.action({ kind: 'islands.gather', seed: 1234, node: 0 }, 'guest', w.bag);
  assert.ok(w.emits.some(x => x.to === 'guest' && x.e.kind === 'notice' && /closer/.test(x.e.text)));
});

test('E that could not be sent starts no cooldown or bounce', () => {
  const w = stubWorld();
  w.mod.debug.spawnNear(1234); w.mod.update(0);
  const k = w.mod.debug.nodes().findIndex(n => n.kind === 'rock');
  const n = w.mod.debug.aimAt(k); w.mod.update(0);
  w.ctx.camera.position.set(w.physics.x, w.physics.y, w.physics.z);
  w.ctx.camera.lookAt(n.x, n.cy, n.z); w.ctx.camera.updateMatrixWorld();
  let sent = 0;
  w.ctx.action = () => { sent++; return false; };
  assert.equal(w.mod.interact(null), true);
  assert.equal(w.mod.interact(null), true);
  assert.equal(sent, 2, 'no local cooldown after an unsent action');
});

test('serialize returns a copy; clean clamps a huge clock', () => {
  const w = stubWorld(); w.mod.debug.spawnNear(1234); w.mod.update(0);
  const s = w.mod.serialize();
  s.isl.used[0] = 99; s.isl.seed = 1;
  assert.equal(w.mod.serialize().isl.used[0], 0);
  assert.equal(w.mod.debug.phase().seed, 1234);
  assert.equal(clean({ v: 1, clock: 1e300 }).clock, 1e9);
});

test('palm pick: trunk and coconuts count, sky above the crown does not', () => {
  const w = stubWorld();
  w.mod.debug.spawnNear(1234); w.mod.update(0);
  const k = w.mod.debug.nodes().findIndex(n => n.kind === 'palm');
  const n = w.mod.debug.aimAt(k, 2.2); w.mod.update(0);
  const cam = w.ctx.camera, look = (x, y, z) => { cam.position.set(w.physics.x, w.physics.y, w.physics.z); cam.lookAt(x, y, z); cam.updateMatrixWorld(); };
  look(n.ax, n.cy, n.az);
  assert.equal(w.mod.debug.pick(), k, 'aiming at the trunk');
  // a hand's width beside the bark (0.35 m off the axis) is not the palm
  { const vx = n.ax - w.physics.x, vz = n.az - w.physics.z, vl = Math.hypot(vx, vz);
    look(n.ax - vz / vl * 0.35, n.cy, n.az + vx / vl * 0.35); assert.equal(w.mod.debug.pick(), -1, 'just beside the trunk'); }
  look(n.x, n.y + 20, n.z);
  assert.equal(w.mod.debug.pick(), -1, 'sky above the palm');
  // beside the trunk, between the fronds: sky, not palm
  const vx = n.x - w.physics.x, vz = n.z - w.physics.z, vl = Math.hypot(vx, vz);
  look(n.x - vz / vl * 0.9, n.y + 2.2, n.z + vx / vl * 0.9);
  assert.equal(w.mod.debug.pick(), -1, 'beside the trunk');
  look(w.physics.x * 2 - n.x, w.physics.y, w.physics.z * 2 - n.z);
  assert.equal(w.mod.debug.pick(), -1, 'facing away');
});

test('pick prefers sand, bush or rock over an overlapping palm', () => {
  // Find a seed with a sand/bush/rock node close to a palm, stand so both are in line, aim between.
  for (let seed = 1; seed < 400; seed++) {
    const lay = layoutFor(seed);
    const p = lay.nodes.findIndex(n => n.kind === 'palm');
    const o = lay.nodes.findIndex(n => n.kind !== 'palm' && Math.hypot(n.x - lay.nodes[p].x, n.z - lay.nodes[p].z) < 2);
    if (o < 0) continue;
    const w = stubWorld(); w.mod.debug.spawnNear(seed); w.mod.update(0);
    const nodes = w.mod.debug.nodes(), np = nodes[p], no = nodes[o];
    // stand just behind the palm and look past it at the other node
    const dx = np.x - no.x, dz = np.z - no.z, d = Math.hypot(dx, dz) || 1;
    if (!w.mod.debug.teleportAshore(np.x - w.mod.debug.state().cx + dx / d * 1.1, np.z - w.mod.debug.state().cz + dz / d * 1.1)) continue;
    w.mod.update(0);
    const cam = w.ctx.camera; cam.position.set(w.physics.x, w.physics.y, w.physics.z); cam.lookAt(no.x, no.cy, no.z); cam.updateMatrixWorld();
    assert.equal(w.mod.debug.pick(), o, `seed ${seed}: ${no.kind} beats the palm behind it`);
    return;
  }
  assert.fail('no seed with a node next to a palm');
});
