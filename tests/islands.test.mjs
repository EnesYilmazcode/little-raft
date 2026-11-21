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
const { ISLAND, layoutFor, sinkAt, relPos, spawnSpot, travelOf, driftState, clean, lootFor, groundHeight, nextDelay, dockOffset, applyGather, standOnSand, SHORE_U } = L;
const { SAIL, defaultSailing, stepSailing } = await import(new URL('sailing-core.js', base));

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

// ---------------------------------------------------------------- world placement

test('sinkAt: rises at birth, adrift, sinks, gone', () => {
  const order = [];
  let last = sinkAt(0, -1).sink;
  assert.equal(last, ISLAND.SINK);
  for (let t = 0; t <= 20; t += 0.05) {
    const p = sinkAt(t, t > 12 ? t - 12 : -1);
    if (order.at(-1) !== p.phase) order.push(p.phase);
    assert.ok(Math.abs(p.sink - last) < 0.2, `sink jump at t=${t}`);
    last = p.sink;
  }
  assert.deepEqual(order, ['rising', 'adrift', 'sinking', 'gone']);
  assert.equal(sinkAt(100, -1).sink, 0);
  assert.equal(sinkAt(NaN, NaN).phase, 'rising');
});

test('spawnSpot: 120-160 m ahead along the travel, seeded 0-40 m to the side', () => {
  const o = {}, sides = new Set();
  for (const seed of SEEDS) {
    for (const [fx, fz] of [[0, 1], [1, 0], [-0.6, -0.8], [0, 0]]) {
      spawnSpot(seed, fx, fz, o);
      const l = Math.hypot(fx, fz) || 1, ux = l > 0 && (fx || fz) ? fx / l : 0, uz = l > 0 && (fx || fz) ? fz / l : 1;
      const along = o.x * ux + o.z * uz, side = o.x * uz - o.z * ux;
      assert.ok(along >= ISLAND.SPAWN_MIN - 1e-9 && along <= ISLAND.SPAWN_MAX + 1e-9, `along ${along}`);
      assert.ok(Math.abs(side) <= ISLAND.SIDE_MAX + 1e-9, `side ${side}`);
      assert.equal(driftState(o.x, o.z, ux, uz), 'ok', 'a fresh spawn is never behind or out');
      if (fx === 0 && fz === 1) sides.add(Math.sign(side));
    }
    const a = spawnSpot(seed, 0, 1, {}), b = spawnSpot(seed, 0, 1, {});
    assert.deepEqual(a, b, 'deterministic');
  }
  assert.ok(sides.has(1) && sides.has(-1), 'both sides');
});

test('travelOf and driftState', () => {
  const t = {};
  assert.deepEqual(travelOf({ vx: 0, vz: 0, anchored: false }, t), { x: SAIL.CURRENT_X, z: SAIL.CURRENT_Z });
  assert.deepEqual(travelOf({ vx: 1, vz: -2, anchored: true }, t), { x: 0, z: 0 });
  assert.deepEqual(travelOf(null, t), { x: 0, z: 0 });
  assert.equal(driftState(0, 100, 0, 1), 'ok');
  assert.equal(driftState(0, -59, 0, 1), 'ok');
  assert.equal(driftState(0, -61, 0, 1), 'behind');
  assert.equal(driftState(0, -151, 0, 1), 'out');
  assert.equal(driftState(0, 155, 0, 1), 'ok', 'far ahead stays');
  assert.equal(driftState(ISLAND.FAR + 1, 0, 0, 1), 'out', 'very far in any direction');
  const r = relPos(10, 20, 4, -5, {});
  assert.deepEqual(r, { x: 6, z: 25 });
  const w = relPos(SAIL.GROUND_WRAP / 2 - 1, 0, -SAIL.GROUND_WRAP / 2 + 1, 0, {});
  assert.ok(Math.abs(w.x + 2) < 1e-6, 'wraps across the seabed seam');
});

test('spawnNear (QA) island sits a short swim from a 3x3 raft', () => {
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
  for (const bad of [undefined, null, 'x', 7, [], { v: 3 }, { v: '1' }]) assert.deepEqual(clean(bad), { v: 2, clock: 0, next: 90, isl: null });
});

test('clean fixes or drops bad fields', () => {
  assert.equal(clean({ v: 2, clock: NaN, next: 50, isl: null }).clock, 0);
  assert.equal(clean({ v: 2, clock: 10, next: 5000, isl: null }).next, 10 + ISLAND.CALM_MAX);
  const good = { seed: 1234, bx: 20, bz: 130, born: 0, sink: -1, used: [] };
  const n = layoutFor(1234).nodes.length;
  assert.deepEqual(clean({ v: 2, clock: 30, next: 0, isl: good }).isl, { ...good, used: new Array(n).fill(0) });
  assert.equal(clean({ v: 2, clock: 30, next: 0, isl: { ...good, bx: NaN } }).isl, null);
  assert.equal(clean({ v: 2, clock: 30, next: 0, isl: { ...good, bz: '1' } }).isl, null);
  assert.equal(clean({ v: 2, clock: 30, next: 0, isl: { ...good, seed: 1.5 } }).isl, null);
  assert.equal(clean({ v: 2, clock: 30, next: 0, isl: { ...good, seed: -1 } }).isl, null);
  assert.equal(clean({ v: 2, clock: 30, next: 0, isl: { ...good, used: 'no' } }).isl, null);
  const fixed = clean({ v: 2, clock: 30, next: 0, isl: { ...good, used: [99, -4, 1.5, 2, ...new Array(40).fill(1)] } }).isl;
  assert.equal(fixed.used.length, n);
  assert.equal(fixed.used[0], layoutFor(1234).nodes[0].max);
  assert.equal(fixed.used[1], 0);
  assert.equal(fixed.used[2], 0);
  assert.equal(fixed.used[3], Math.min(2, layoutFor(1234).nodes[3].max));
  assert.equal(clean({ v: 2, clock: 30, next: 0, isl: { ...good, bx: 1e9 } }).isl.bx, L.relPos(1e9, 0, 0, 0, {}).x, 'wrapped onto the seabed');
  // sinking: kept while it sinks, dropped once it has sunk
  assert.equal(clean({ v: 2, clock: 30, next: 0, isl: { ...good, sink: 28 } }).isl.sink, 28);
  assert.equal(clean({ v: 2, clock: 30, next: 0, isl: { ...good, sink: 20 } }).isl, null);
});

test('clean migrates a v1 (timeline) save onto the seabed at its current spot', () => {
  const lay = layoutFor(1234), used = lay.nodes.map((_, k) => (k === 1 ? 1 : 0));
  const old = { v: 1, clock: 1000, next: 0, isl: { seed: 1234, born: 900, dock: 180, side: -1, off: 20, used } };
  // docked (t = 100 s): centre was at (side * off, dockZ) beside the raft
  const c = clean(old, layoutFor, { gx: 500, gz: -300 });
  assert.equal(c.v, 2);
  assert.deepEqual(c.isl, { seed: 1234, bx: 480, bz: -300 + lay.dockZ, born: 900, sink: -1, used });
  // approaching (t = 5 s): between START_Z and the dock z
  const a = clean({ ...old, isl: { ...old.isl, born: 995 } }).isl;
  assert.ok(a.bz < lay.dockZ && a.bz > ISLAND.START_Z && a.bx === -20);
  // gone under the old timeline: dropped, next island on its normal calm
  assert.equal(clean({ ...old, isl: { ...old.isl, born: 0 } }).isl, null);
  assert.equal(clean({ ...old, isl: { ...old.isl, side: 0 } }).isl, null);
  // the live module loads it and keeps playing
  const w = stubWorld(); w.ctx.world.sailing = { gx: 500, gz: -300, vx: 0, vz: 0, anchored: false };
  w.mod.load(JSON.parse(JSON.stringify(old)), 'save'); w.mod.update(0);
  const ph = w.mod.debug.phase();
  assert.equal(ph.seed, 1234); assert.equal(ph.phase, 'adrift');
  assert.ok(Math.abs(ph.x + 20) < 1e-9 && Math.abs(ph.z - lay.dockZ) < 1e-9);
  assert.equal(w.mod.serialize().isl.used[1], 1);
  assert.equal(w.mod.serialize().v, 2);
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
  const flowers = Array.from({ length: 400 }, (_, s) => lootFor('bush', s, 0, 0).some(([k]) => k === 'flowerseed') ? 1 : 0).reduce((a, b) => a + b); // [bees]
  assert.ok(flowers > 40 && flowers < 130, `bush flower seed rate ${flowers}/400`);
  const berries = Array.from({ length: 400 }, (_, s) => { const r = lootFor('bush', s, 0, 0); return r.length === 1 && r[0][0] === 'berries' && r[0][1] === 2 ? 1 : 0; }).reduce((a, b) => a + b); // [juicer]
  assert.ok(berries > 60 && berries < 140, `bush berry rate ${berries}/400`); // [juicer]
  for (let s = 0; s < 400; s++) { const r = lootFor('bush', s, 0, 0); if (r.some(([k]) => k === 'berries')) assert.deepEqual(r, [['berries', 2]], 'berries never come with a seed'); } // [juicer]
});

function gatherSetup() {
  const lay = layoutFor(1234);
  const st = { isl: { seed: 1234, bx: 20, bz: -2, born: 0, sink: -1, used: lay.nodes.map(() => 0) }, layout: lay, cx: 20, cz: -2, clock: 100, cool: { host: 0, guest: 0 } };
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
    world: { tiles: RAFT3, sailing: defaultSailing() }, role, running: true, physics, other: null,
    emit: (e, to) => emits.push({ e, to }),
    action: a => { actions.push(a); if (role !== 'guest') mod.action(a, 'host', bag); return true; },
  };
  const bag = emptyBag();
  const mod = createIslands(ctx);
  return { ctx, mod, physics, emits, actions, bag };
}
// Advance the real sailing core (the seabed offset the module reads) by n steps of dt.
const sailOut = { dwx: 0, dwz: 0, dgx: 0, dgz: 0 };
const sail = (w, n, dt = 0.1, opts = { nSails: 1, host: true, rng: () => 0.5 }, each = null) => {
  for (let i = 0; i < n; i++) { stepSailing(w.ctx.world.sailing, dt, opts, sailOut); if (each) each(); else w.mod.update(dt); }
};
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

test('drift: the island moves by the seabed delta, stops at anchor, steers with the sail', () => {
  const w = stubWorld();
  w.mod.load(undefined, 'save');
  w.mod.debug.spawnAhead(77); w.mod.update(0);
  const p0 = w.mod.debug.phase();
  assert.ok(p0.dist >= ISLAND.SPAWN_MIN && p0.dist <= Math.hypot(ISLAND.SPAWN_MAX, ISLAND.SIDE_MAX), `spawned ${p0.dist.toFixed(1)} m away`);
  assert.ok(p0.z >= ISLAND.SPAWN_MIN - 1e-9, 'ahead of a raft riding the +z current');
  assert.ok(w.emits.some(x => x.e.text === 'An island on the horizon' && x.to === 'all'));
  assert.ok(!w.emits.some(x => /drifting this way/.test(x.e.text)));
  // drifting on the current: every step the island moves by exactly -dg (it is fixed on the seabed)
  const s = w.ctx.world.sailing;
  let prev = w.mod.debug.state();
  sail(w, 50, 0.1, undefined, () => {
    w.mod.update(0.1);
    const now = w.mod.debug.state();
    assert.ok(Math.abs(now.cx - (prev.cx - sailOut.dgx)) < 1e-9 && Math.abs(now.cz - (prev.cz - sailOut.dgz)) < 1e-9, 'follows the seabed delta');
    prev = now;
  });
  assert.ok(p0.z - prev.cz > 1, 'it came closer');
  // anchored: the island stays put
  s.anchored = true;
  sail(w, 50);
  const a = w.mod.debug.state(); sail(w, 50);
  assert.equal(w.mod.debug.state().cx, a.cx); assert.equal(w.mod.debug.state().cz, a.cz);
  // sail raised toward +x: the island now slides toward -x too
  s.anchored = false; s.raised = true; s.heading = Math.PI / 2; s.windDir = Math.PI / 2;
  const b = w.mod.debug.state(); sail(w, 100);
  const c = w.mod.debug.state();
  assert.ok(b.cx - c.cx > 3, `sailing east moves the island west (${(b.cx - c.cx).toFixed(1)} m)`);
  assert.equal(w.mod.debug.phase().phase, 'adrift', 'no timer: it is still there');
});

test('drift: passing the island warns at 60 m behind, sinks past 150 m, then the calm delay', () => {
  const w = stubWorld();
  w.mod.load(undefined, 'save');
  w.mod.debug.spawnAhead(5); w.mod.update(0);
  const s = w.ctx.world.sailing, seed = w.mod.debug.phase().seed;
  s.raised = true; s.heading = 0; s.windDir = 0; // run before the wind along +z
  let warnAt = null, sinkAt_ = null;
  for (let i = 0; i < 20000 && w.mod.debug.phase().phase !== 'calm'; i++) {
    sail(w, 1);
    const ph = w.mod.debug.phase();
    if (warnAt === null && w.emits.some(x => x.e.text === 'The island is falling behind')) warnAt = ph.z;
    if (sinkAt_ === null && ph.phase === 'sinking') sinkAt_ = ph.dist;
  }
  assert.ok(warnAt !== null && warnAt < -ISLAND.BEHIND && warnAt > -ISLAND.BEHIND - 5, `warned at z=${warnAt}`);
  assert.equal(w.emits.filter(x => x.e.text === 'The island is falling behind').length, 1, 'once');
  assert.ok(!w.emits.some(x => /drift away/.test(x.e.text)), 'no old timer warning');
  assert.ok(sinkAt_ > ISLAND.DESPAWN && sinkAt_ < ISLAND.DESPAWN + 5, `sank at ${sinkAt_}`);
  const ph = w.mod.debug.phase();
  assert.equal(ph.phase, 'calm');
  assert.ok(Math.abs(ph.next - ph.clock - nextDelay(seed)) < 0.2, 'calm delay before the next one');
});

test('drift: an anchored raft keeps its island forever; it never sinks under a player', () => {
  const w = stubWorld();
  w.mod.debug.spawnNear(1234); w.mod.update(0);
  w.ctx.world.sailing.anchored = true;
  sail(w, 20000, 0.1); // 2000 s
  assert.equal(w.mod.debug.phase().phase, 'adrift');
  // a player stays on the island while the raft drifts off: it waits for them
  w.ctx.world.sailing.anchored = false;
  w.mod.debug.teleportAshore();
  for (let i = 0; i < 12000; i++) { stepSailing(w.ctx.world.sailing, 0.1, { nSails: 0, host: true }, sailOut); w.mod.afterMove(w.physics, 0.1); w.mod.update(0.1); }
  const ph = w.mod.debug.phase();
  assert.ok(ph.dist > ISLAND.DESPAWN, `raft is ${ph.dist.toFixed(0)} m away`);
  assert.equal(ph.phase, 'adrift', 'still there under the player');
  assert.ok(Math.hypot(w.physics.x - ph.x, w.physics.z - ph.z) < ph.R, 'carried with the island');
});

test('full cycle: calm, first island at 90 s on the horizon, passed, calm again', () => {
  const w = stubWorld();
  w.mod.load(undefined, 'save');
  for (let i = 0; i < 89 * 10; i++) w.mod.update(0.1);
  assert.equal(w.mod.debug.phase().phase, 'calm');
  for (let i = 0; i < 2 * 10; i++) w.mod.update(0.1);
  assert.equal(w.mod.debug.phase().phase, 'rising');
  const seen = new Set();
  let calm = null;
  // the current alone carries the raft past it (0.3 m/s: ~300 m in ~17 min)
  sail(w, 1300 * 10, 0.1, { nSails: 0, host: true }, () => {
    w.mod.update(0.1); const ph = w.mod.debug.phase(); seen.add(ph.phase);
    if (ph.phase === 'calm' && !calm) calm = ph;
  });
  assert.ok(seen.has('adrift') && seen.has('sinking') && calm, [...seen].join());
  assert.ok(calm.next - calm.clock >= ISLAND.CALM_MIN - 1 && calm.next - calm.clock <= ISLAND.CALM_MAX);
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

test('rider moves with the island in the same frame as the world drifts', () => {
  const w = stubWorld();
  w.mod.debug.spawnNear(1234); w.mod.update(0);
  assert.equal(w.mod.debug.teleportAshore(1, 1), true);
  const off = () => w.physics.z - w.mod.debug.state().cz;
  step(w, 1); // settle (a palm or rock may nudge us on the first frame)
  const o0 = off(), z0 = w.mod.debug.state().cz;
  for (let i = 0; i < 600; i++) {
    stepSailing(w.ctx.world.sailing, 1 / 60, { nSails: 0, host: true }, sailOut); // sailing.update runs first in game.js
    w.physics.update(1 / 60, { tiles: RAFT3, deckY: 0.2, waterY: -0.24 });
    w.mod.afterMove(w.physics, 1 / 60); // game.js sets the camera here...
    w.mod.update(1 / 60);               // ...and the island is drawn where update leaves it
    assert.ok(Math.abs(off() - o0) < 1e-6, 'no lag between the camera and the island');
  }
  assert.ok(z0 - w.mod.debug.state().cz > 2, 'the island did move (by the current)');
  assert.equal(w.physics.swimming, false);
});

test('raft grounding: the island registers one blocker that tracks it', () => {
  const w = stubWorld(), got = [];
  w.ctx.addBlocker = b => { got.push(b); return true; };
  w.ctx.removeBlocker = b => { got.splice(got.indexOf(b), 1); };
  w.mod.update(0); w.mod.update(0);
  assert.equal(got.length, 1);
  assert.equal(got[0].rad, 0, 'no island: no blocker');
  w.mod.debug.spawnNear(1234); w.mod.update(0);
  const st = w.mod.debug.state();
  assert.equal(got[0].x, st.cx); assert.equal(got[0].z, st.cz);
  assert.ok(Math.abs(got[0].rad - layoutFor(1234).R * SHORE_U) < 1e-9);
  w.mod.dispose();
  assert.equal(got.length, 0);
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
