// Unit tests for the survival-engine pure modules: Bag, PlayerPhysics, HookCast.
// Run: node --test tests/survival.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const {
  Bag, STACK_SIZE, SLOT_COUNT, HOTBAR_SIZE, TOOL_DURABILITY, ITEM_KINDS,
} = await import(new URL('inventory-state.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));
const { HookCast, WATER_Y } = await import(new URL('hook-physics.js', base));

// ---------------------------------------------------------------- helpers

const emptyBag = () => new Bag({ slots: new Array(SLOT_COUNT).fill(null), selected: 0 });
const bagFrom = (slots, selected = 0) => {
  const s = new Array(SLOT_COUNT).fill(null);
  slots.forEach((v, i) => { s[i] = v; });
  return new Bag({ slots: s, selected });
};
const total = (bag) => Object.values(bag.counts()).reduce((a, b) => a + b, 0);
const assertStacksValid = (bag) => {
  for (const s of bag.slots) {
    if (!s) continue;
    assert.ok(Number.isInteger(s.count) && s.count >= 1, `bad count ${s.count}`);
    const cap = ['hook', 'hammer', 'fishingrod'].includes(s.kind) ? 1 : STACK_SIZE;
    assert.ok(s.count <= cap, `${s.kind} stack ${s.count} exceeds ${cap}`);
  }
};

// =================================================================== Bag

test('Bag: a fresh bag holds only one full-durability hook in hotbar slot 0', () => {
  const bag = new Bag();
  assert.equal(bag.slots.length, SLOT_COUNT);
  assert.deepEqual(bag.slots[0], { kind: 'hook', count: 1, durability: TOOL_DURABILITY });
  for (let i = 1; i < SLOT_COUNT; i++) assert.equal(bag.slots[i], null, `slot ${i}`);
  assert.equal(bag.selectedIndex, 0);
  assert.deepEqual(bag.selected, { kind: 'hook', count: 1, durability: TOOL_DURABILITY });
  const counts = bag.counts();
  assert.deepEqual(Object.keys(counts).sort(), [...ITEM_KINDS].sort());
  for (const k of ITEM_KINDS) assert.equal(counts[k], k === 'hook' ? 1 : 0, k);
});

test('Bag.fromCounts migrates legacy stock without granting an extra hook', () => {
  const none = Bag.fromCounts({ wood: 3 }, { tools: [] });
  assert.equal(none.count('hook'), 0);
  assert.equal(none.count('wood'), 3);
  // Listed tool and legacy count are not added together.
  const one = Bag.fromCounts({ hook: 1, plastic: 25 });
  assert.equal(one.count('hook'), 1);
  assert.equal(one.count('plastic'), 25);
  assert.deepEqual(one.slots[0], { kind: 'hook', count: 1, durability: TOOL_DURABILITY });
  assertStacksValid(one);
});

test('Bag.add caps stacks at 20, tops up existing stacks first, and reports the remainder', () => {
  const bag = new Bag();
  assert.equal(bag.add('wood', 45), 0);
  assert.deepEqual(bag.slots.slice(1, 4), [
    { kind: 'wood', count: 20 }, { kind: 'wood', count: 20 }, { kind: 'wood', count: 5 },
  ]);
  assert.equal(bag.add('wood', 17), 0);
  assert.deepEqual(bag.slots[3], { kind: 'wood', count: 20 });
  assert.deepEqual(bag.slots[4], { kind: 'wood', count: 2 });
  assert.equal(bag.count('wood'), 62);
  assertStacksValid(bag);

  const full = emptyBag();
  assert.equal(full.add('wood', 600), 600 - SLOT_COUNT * STACK_SIZE);
  assert.equal(full.count('wood'), SLOT_COUNT * STACK_SIZE);
  for (const s of full.slots) assert.deepEqual(s, { kind: 'wood', count: STACK_SIZE });
  assert.equal(full.add('wood', 1), 1, 'no room for more wood');
  assert.equal(full.add('leaf', 3), 3, 'no free slot for a new kind');
  assert.equal(full.count('leaf'), 0);

  // Atomic remove: too many -> nothing removed.
  assert.equal(full.remove('wood', SLOT_COUNT * STACK_SIZE + 1), false);
  assert.equal(full.count('wood'), SLOT_COUNT * STACK_SIZE);
  // Remove takes from the back, freeing the last slot.
  assert.equal(full.remove('wood', 25), true);
  assert.equal(full.slots[SLOT_COUNT - 1], null);
  assert.deepEqual(full.slots[SLOT_COUNT - 2], { kind: 'wood', count: 15 });
  // One free slot: leaf fills it to the cap, rest returned.
  assert.equal(full.add('leaf', 30), 10);
  assert.deepEqual(full.slots[SLOT_COUNT - 1], { kind: 'leaf', count: 20 });
  // Wood can only top up its partial stack.
  assert.equal(full.add('wood', 8), 3);
  assert.equal(full.count('wood'), SLOT_COUNT * STACK_SIZE - 25 + 5);
  assertStacksValid(full);
});

test('Bag.add: tools never stack, junk kinds/counts are rejected', () => {
  const bag = emptyBag();
  assert.equal(bag.add('hook', 3), 0);
  for (let i = 0; i < 3; i++) assert.deepEqual(bag.slots[i], { kind: 'hook', count: 1, durability: TOOL_DURABILITY });
  assert.equal(bag.add('hammer', 1, { durability: 42 }), 0);
  assert.deepEqual(bag.slots[3], { kind: 'hammer', count: 1, durability: 42 });
  assert.equal(bag.add('diamond', 4), 4);
  assert.equal(bag.add('wood', -3), 0);
  assert.equal(bag.add('wood', NaN), 0);
  assert.equal(bag.count('wood'), 0);
  assert.equal(bag.add('wood', 2.9), 0);
  assert.equal(bag.count('wood'), 2);
});

test('Bag.move: split, merge, partial merge and swap preserve every item count', () => {
  const bag = emptyBag();
  bag.add('wood', 30); // slot0 = 20, slot1 = 10
  const before = bag.counts();

  // Split 7 off into an empty slot.
  assert.equal(bag.move(0, 5, 7), true);
  assert.deepEqual(bag.slots[0], { kind: 'wood', count: 13 });
  assert.deepEqual(bag.slots[5], { kind: 'wood', count: 7 });
  assert.deepEqual(bag.counts(), before);

  // Whole-stack merge into same kind.
  assert.equal(bag.move(5, 1), true);
  assert.equal(bag.slots[5], null);
  assert.deepEqual(bag.slots[1], { kind: 'wood', count: 17 });
  assert.deepEqual(bag.counts(), before);

  // Partial merge: only 3 fit, the rest stays behind.
  assert.equal(bag.move(0, 1), true);
  assert.deepEqual(bag.slots[1], { kind: 'wood', count: 20 });
  assert.deepEqual(bag.slots[0], { kind: 'wood', count: 10 });
  assert.deepEqual(bag.counts(), before);

  // Splitting onto a full stack of the same kind is refused.
  assert.equal(bag.move(0, 1, 2), false);
  assert.deepEqual(bag.slots[0], { kind: 'wood', count: 10 });

  // Different kinds swap whole stacks; partial onto a different kind is refused.
  assert.equal(bag.add('leaf', 4), 0); // lands in slot 2
  assert.deepEqual(bag.slots[2], { kind: 'leaf', count: 4 });
  const mixed = bag.counts();
  assert.equal(bag.move(0, 2, 2), false);
  assert.deepEqual(bag.slots[0], { kind: 'wood', count: 10 });
  assert.equal(bag.move(2, 0), true);
  assert.deepEqual(bag.slots[0], { kind: 'leaf', count: 4 });
  assert.deepEqual(bag.slots[2], { kind: 'wood', count: 10 });
  assert.deepEqual(bag.counts(), mixed);

  // Invalid moves change nothing.
  const snap = bag.snapshot();
  assert.equal(bag.move(0, 0), false);
  assert.equal(bag.move(9, 0), false, 'empty source');
  assert.equal(bag.move(0, SLOT_COUNT), false);
  assert.equal(bag.move(0, 3, 5), false, 'amount larger than stack');
  assert.equal(bag.move(0, 3, 0), false);
  assert.deepEqual(bag.snapshot(), snap);
  assertStacksValid(bag);
});

test('Bag.move: tools swap whole and keep durability', () => {
  const bag = bagFrom([{ kind: 'hook', count: 1, durability: 37 }, { kind: 'wood', count: 5 }]);
  const before = bag.counts();
  assert.equal(bag.move(0, 1), true);
  assert.deepEqual(bag.slots[0], { kind: 'wood', count: 5 });
  assert.deepEqual(bag.slots[1], { kind: 'hook', count: 1, durability: 37 });
  assert.equal(bag.move(1, 10), true);
  assert.deepEqual(bag.slots[10], { kind: 'hook', count: 1, durability: 37 });
  assert.deepEqual(bag.counts(), before);
});

test('Bag.craft is atomic when resources are missing', () => {
  const bag = new Bag();
  const snap = bag.snapshot();
  assert.deepEqual(bag.craft('rope'), { ok: false, reason: 'missing', missing: [{ kind: 'leaf', count: 2 }] });
  assert.deepEqual(bag.snapshot(), snap);

  bag.add('wood', 3);
  const snap2 = bag.snapshot();
  const r = bag.craft('hammer'); // wood 4 + rope 2
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing');
  assert.deepEqual(r.missing, [{ kind: 'wood', count: 1 }, { kind: 'rope', count: 2 }]);
  assert.deepEqual(bag.snapshot(), snap2, 'no wood consumed on failure');

  assert.deepEqual(bag.craft('not-a-recipe'), { ok: false, reason: 'unknown-recipe' });
  assert.deepEqual(bag.snapshot(), snap2);
});

test('Bag.craft is atomic when there is no room for the output', () => {
  const slots = [{ kind: 'wood', count: 20 }, { kind: 'plastic', count: 20 }];
  for (let i = 2; i < SLOT_COUNT; i++) slots.push({ kind: 'leaf', count: 20 });
  const bag = bagFrom(slots);
  const snap = bag.snapshot();
  assert.deepEqual(bag.canCraft('hook'), { ok: false, missing: [], full: true });
  assert.deepEqual(bag.craft('hook'), { ok: false, reason: 'full' });
  assert.deepEqual(bag.snapshot(), snap);
  assert.equal(bag.count('wood'), 20);
  assert.equal(bag.count('plastic'), 20);
});

test('Bag.craft succeeds when consuming the cost frees a slot, or output merges into a stack', () => {
  const slots = [{ kind: 'wood', count: 1 }, { kind: 'plastic', count: 2 }];
  for (let i = 2; i < SLOT_COUNT; i++) slots.push({ kind: 'leaf', count: 20 });
  const bag = bagFrom(slots);
  const ref = bag.slots;
  assert.equal(bag.canCraft('hook').ok, true);
  assert.deepEqual(bag.craft('hook'), { ok: true, crafted: { kind: 'hook', count: 1 } });
  assert.equal(bag.slots, ref, 'slots array identity is kept');
  assert.equal(bag.count('wood'), 0);
  assert.equal(bag.count('plastic'), 0);
  assert.equal(bag.count('hook'), 1);
  assert.equal(bag.count('leaf'), 26 * 20);
  assert.ok(bag.slots.some(s => s && s.kind === 'hook' && s.durability === TOOL_DURABILITY));

  // Full bag, but rope output tops up an existing partial rope stack.
  const s2 = [{ kind: 'leaf', count: 20 }, { kind: 'rope', count: 5 }];
  for (let i = 2; i < SLOT_COUNT; i++) s2.push({ kind: 'wood', count: 20 });
  const b2 = bagFrom(s2);
  assert.deepEqual(b2.craft('rope'), { ok: true, crafted: { kind: 'rope', count: 1 } });
  assert.equal(b2.count('leaf'), 18);
  assert.equal(b2.count('rope'), 6);
  assertStacksValid(b2);
});

test('Bag: selection, cycling and snapshot round-trips', () => {
  const bag = new Bag();
  bag.add('wood', 25);
  bag.add('hammer', 1, { durability: 55 });
  assert.equal(bag.select(3), true);
  assert.equal(bag.selectedIndex, 3);
  assert.equal(bag.select(HOTBAR_SIZE), false);
  assert.equal(bag.select(-1), false);
  assert.equal(bag.select(1.5), false);
  assert.equal(bag.selectedIndex, 3);
  assert.deepEqual(bag.selected, { kind: 'hammer', count: 1, durability: 55 });
  // `selected` is a copy.
  bag.selected.count = 99;
  assert.equal(bag.slots[3].count, 1);

  assert.equal(bag.cycle(-1), 2);
  assert.equal(bag.cycle(-3), 7);
  assert.equal(bag.cycle(1), 0);
  assert.equal(bag.cycle(HOTBAR_SIZE * 2 + 1), 1);
  bag.select(5);
  assert.equal(bag.selected, null, 'empty hotbar slot');
  bag.select(2);

  const snap = bag.snapshot();
  assert.equal(snap.selected, 2);
  const copy = new Bag(snap);
  assert.deepEqual(copy.snapshot(), snap);
  assert.deepEqual(copy.selected, bag.selected);
  const viaJson = new Bag(JSON.parse(JSON.stringify(snap)));
  assert.deepEqual(viaJson.snapshot(), snap);
  // Snapshot is detached from the live bag.
  snap.slots[1].count = 1;
  assert.equal(bag.slots[1].count, 20);
  assert.equal(copy.slots[1].count, 20);
});

test('Bag rejects malformed snapshots with TypeError', () => {
  const ok = () => new Array(SLOT_COUNT).fill(null);
  const bad = [
    { slots: new Array(SLOT_COUNT - 1).fill(null), selected: 0 },
    { slots: ok(), selected: HOTBAR_SIZE },
    { slots: (() => { const s = ok(); s[0] = { kind: 'wood', count: 21 }; return s; })(), selected: 0 },
    { slots: (() => { const s = ok(); s[0] = { kind: 'hook', count: 2 }; return s; })(), selected: 0 },
    { slots: (() => { const s = ok(); s[0] = { kind: 'wood', count: 1, durability: 5 }; return s; })(), selected: 0 },
    { slots: (() => { const s = ok(); s[0] = { kind: 'gold', count: 1 }; return s; })(), selected: 0 },
    [],
  ];
  for (const b of bad) assert.throws(() => new Bag(b), TypeError);
});

// ========================================================== PlayerPhysics

const DECK_Y = 0.2;
const WATER = -0.24;
const TILES = [[0, 0]]; // covers x,z in [-1, 1]
const EYE_ON_DECK = DECK_Y + PC.EYE_OFFSET;
const DT = 1 / 60;
const frame = (extra = {}) => ({ tiles: TILES, deckY: DECK_Y, waterY: WATER, yaw: 0, ...extra });

test('PlayerPhysics: spawning at deck height over a tile is grounded', () => {
  const p = new PlayerPhysics({ x: 0, y: EYE_ON_DECK, z: 0 });
  const out = p.update(DT, frame());
  assert.equal(out.splashed, false);
  const c = p.capture();
  assert.equal(c.grounded, true);
  assert.equal(c.swimming, false);
  assert.ok(Math.abs(c.y - EYE_ON_DECK) < 1e-9);
  // Non-positive / junk dt is a no-op.
  assert.deepEqual(p.update(0, frame()), { landed: false, splashed: false, leftWater: false });
  assert.deepEqual(p.update(NaN, frame()), { landed: false, splashed: false, leftWater: false });
  assert.deepEqual(p.capture(), c);
});

test('PlayerPhysics: a real jump rises, leaves the ground and lands back on the deck once', () => {
  const p = new PlayerPhysics({ x: 0, y: EYE_ON_DECK, z: 0 });
  p.update(DT, frame());
  assert.equal(p.grounded, true);

  let maxY = p.y, landed = 0, airborne = 0, splashed = 0;
  for (let i = 0; i < 120; i++) { // 2 s, jump held the whole time (edge-triggered)
    const out = p.update(DT, frame({ jump: true }));
    maxY = Math.max(maxY, p.y);
    if (!p.grounded) airborne++;
    if (out.landed) landed++;
    if (out.splashed) splashed++;
  }
  const expectedPeak = PC.JUMP_IMPULSE ** 2 / (2 * PC.GRAVITY);
  assert.ok(maxY - EYE_ON_DECK > expectedPeak * 0.8, `peak ${maxY - EYE_ON_DECK}`);
  assert.ok(maxY - EYE_ON_DECK < expectedPeak * 1.1);
  assert.ok(airborne > 20, 'spent real time in the air');
  assert.equal(landed, 1, 'holding jump does not bunny-hop');
  assert.equal(splashed, 0);
  assert.equal(p.grounded, true);
  assert.equal(p.swimming, false);
  assert.ok(Math.abs(p.y - EYE_ON_DECK) < 1e-9);
  assert.equal(p.vy, 0);
});

test('PlayerPhysics: walking past the raft edge falls into the water and swims', () => {
  const p = new PlayerPhysics({ x: 0, y: EYE_ON_DECK, z: 0 });
  p.update(DT, frame());
  let leftGround = false, splashes = 0, landed = 0;
  for (let i = 0; i < 180; i++) { // 3 s walking toward -Z (yaw 0, forward)
    const out = p.update(DT, frame({ forward: 1 }));
    if (!p.grounded) leftGround = true;
    if (out.splashed) splashes++;
    if (out.landed) landed++;
  }
  assert.equal(leftGround, true);
  assert.equal(splashes, 1);
  assert.equal(landed, 0);
  assert.ok(p.z < -(1 + PC.SUPPORT_MARGIN), `z=${p.z} should be past the edge`);
  assert.equal(p.swimming, true);
  assert.equal(p.grounded, false);
  assert.ok(p.y - PC.EYE_OFFSET < WATER + PC.WATER_ENTER, 'feet are in the water');

  // Idle: buoyancy settles the eye just above the water line.
  for (let i = 0; i < 240; i++) p.update(DT, frame());
  assert.equal(p.swimming, true);
  assert.ok(Math.abs(p.y - (WATER + PC.SWIM_EYE_ABOVE_WATER)) < 0.05, `eye y=${p.y}`);
});

test('PlayerPhysics: holding jump while swimming next to the raft clambers back aboard', () => {
  const p = new PlayerPhysics({ x: 0, y: WATER + PC.SWIM_EYE_ABOVE_WATER, z: -1.6, swimming: true });
  let sawClimb = false, landed = 0;
  for (let i = 0; i < 60; i++) {
    const out = p.update(DT, frame({ jump: true }));
    if (p.capture().climbing) sawClimb = true;
    if (out.landed) landed++;
  }
  assert.equal(sawClimb, true);
  assert.equal(landed, 1);
  assert.equal(p.grounded, true);
  assert.equal(p.swimming, false);
  assert.ok(Math.abs(p.y - EYE_ON_DECK) < 1e-9);
  assert.ok(Math.abs(p.z) < 1 && Math.abs(p.x) < 1, 'ends inside the tile');
});

test('PlayerPhysics: capture() round-trips into an identical simulation', () => {
  const a = new PlayerPhysics({ x: 0, y: EYE_ON_DECK, z: 0 });
  const walk = frame({ forward: 1, strafe: 0.3, yaw: 0.7 });
  a.update(DT, frame());
  for (let i = 0; i < 10; i++) a.update(DT, walk);
  const cap = a.capture();
  assert.equal(cap.grounded, true);
  assert.ok(Math.hypot(cap.vx, cap.vz) > 1, 'actually moving');
  const b = new PlayerPhysics(cap);
  for (let i = 0; i < 10; i++) { a.update(DT, walk); b.update(DT, walk); }
  assert.deepEqual(b.capture(), a.capture());
});

// ================================================================ HookCast

const hand = () => new T.Vector3(0, 1.2, 0);
const elevDir = (deg) => new T.Vector3(0, Math.sin(deg * Math.PI / 180), -Math.cos(deg * Math.PI / 180));
const cast = (opts) => new HookCast(T, { origin: hand(), maxRange: 100, drift: { x: 0, z: 0 }, ...opts });

function flyOut(c, items = []) {
  const events = [];
  for (let i = 0; i < 2000 && c.stage === 'flying'; i++) {
    const e = c.update(0.02, { hand: hand(), items });
    if (e) events.push(e);
  }
  assert.notEqual(c.stage, 'flying', 'hook reached the water');
  return events;
}
function run(c, seconds, items, reeling) {
  const events = [];
  for (let t = 0; t < seconds; t += 0.02) {
    const e = c.update(0.02, { hand: hand(), items, reeling });
    if (e) events.push(e);
  }
  return events;
}
// Closed-form ballistic range from the module's documented launch model.
function analyticRange(deg, charge, y0 = 1.2) {
  const s = 7 + charge * 11, a = deg * Math.PI / 180;
  const vy = Math.sin(a) * s + 1, vh = Math.cos(a) * s, g = 9.8;
  const t = (vy + Math.sqrt(vy * vy + 2 * g * (y0 - WATER_Y))) / g;
  return vh * t;
}
const range = (c) => Math.hypot(c.landing.x, c.landing.z);

test('HookCast: charge increases landing distance along a real ballistic arc', () => {
  const dists = [0, 0.5, 1].map((charge) => {
    const c = cast({ direction: elevDir(15), charge });
    assert.equal(c.landing, null);
    flyOut(c);
    assert.equal(c.stage, 'floating');
    assert.equal(c.landing.y, WATER_Y);
    assert.ok(Math.abs(c.landing.x) < 1e-9, 'no sideways drift in flight');
    assert.ok(c.landing.z < 0, 'lands in the aimed direction');
    assert.ok(Math.abs(range(c) - analyticRange(15, charge)) < 0.05,
      `charge ${charge}: ${range(c)} vs ${analyticRange(15, charge)}`);
    return range(c);
  });
  assert.ok(dists[0] < dists[1] && dists[1] < dists[2], dists.join(' < '));
});

test('HookCast: aim elevation changes range and flight time', () => {
  const results = [-20, 0, 15, 30].map((deg) => {
    const c = cast({ direction: elevDir(deg), charge: 1 });
    flyOut(c);
    assert.ok(Math.abs(range(c) - analyticRange(deg, 1)) < 0.05, `elev ${deg}`);
    return { r: range(c), t: c.flightT };
  });
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i].r > results[i - 1].r, 'higher aim (below 45 deg) flies farther');
    assert.ok(results[i].t > results[i - 1].t, 'higher aim stays airborne longer');
  }
  // A legacy target is only used for direction, never as a snap point.
  const legacy = cast({ target: new T.Vector3(0, 1.2, -3), charge: 1 });
  flyOut(legacy);
  assert.ok(range(legacy) > 5, `not snapped to the target: ${range(legacy)}`);
});

test('HookCast: the rope tethers flight at maxRange', () => {
  const c = cast({ direction: elevDir(30), charge: 1, maxRange: 5 });
  flyOut(c);
  assert.equal(c.tethered, true);
  assert.ok(Math.abs(range(c) - 5) < 1e-6, `landing ${range(c)}`);
});

test('HookCast: a miss reels back with a single "returned" event and no items', () => {
  const items = Object.freeze([Object.freeze({ id: 1, token: 'far', type: 'wood', x: 20, z: 20 })]);
  const c = cast({ direction: elevDir(0), charge: 1 });
  assert.deepEqual(flyOut(c, items), []);
  assert.deepEqual(run(c, 1, items, false), [], 'floating never auto-collects');
  const events = run(c, 5, items, true);
  assert.deepEqual(events, [{ kind: 'returned' }]);
  assert.equal(c.caughtItems.length, 0);
  assert.equal(c.caught, null);
  assert.equal(c.stage, 'done');
  assert.equal(c.update(0.02, { hand: hand(), items, reeling: true }), null);
});

// Flat full-charge throw lands ~10.8 m out on -Z; the flight is only low enough
// to snag things in its last ~1.5 m, so these items are reachable only by the reel sweep.
const reelItems = () => Object.freeze([
  Object.freeze({ id: 'a', token: 'ta', type: 'wood', x: 0.5, z: -5 }),
  Object.freeze({ id: 'b', token: 'tb', type: 'plastic', x: -0.6, z: -7 }),
  Object.freeze({ id: 'c', token: 'tc', type: 'leaf', x: 3, z: -6 }), // off the reel path
]);

test('HookCast: reeling sweeps up multiple items and pays them out exactly once', () => {
  const items = reelItems();
  const c = cast({ direction: elevDir(0), charge: 1 });
  flyOut(c, items);
  assert.ok(range(c) > 9, 'landed beyond the items');
  run(c, 0.5, items, false);
  assert.equal(c.caughtItems.length, 0, 'nothing caught before reeling');

  const events = run(c, 5, items, true);
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.kind, 'collected');
  // Catch order follows the reel path (b is farther out than a), not array order.
  assert.deepEqual(e.items, [
    { id: 'b', token: 'tb', type: 'plastic' },
    { id: 'a', token: 'ta', type: 'wood' },
  ]);
  assert.equal(e.id, 'b');
  assert.equal(e.token, 'tb');
  assert.equal(c.stage, 'done');
  assert.deepEqual(run(c, 1, items, true), [], 'no second payout');
});

test('HookCast: caught items that vanish from the world are not paid out', () => {
  const items = reelItems();
  const c = cast({ direction: elevDir(0), charge: 1 });
  flyOut(c, items);
  let ev = null;
  for (let i = 0; i < 500 && c.caughtItems.length < 2; i++) {
    ev = c.update(0.02, { hand: hand(), items, reeling: true });
    assert.equal(ev, null, 'not home yet');
  }
  assert.equal(c.caughtItems.length, 2);
  const remaining = items.filter(it => it.id !== 'a'); // someone else grabbed 'a'
  const events = run(c, 5, remaining, true);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].items, [{ id: 'b', token: 'tb', type: 'plastic' }]);
});

test('item icons degrade to flat sprites when WebGL is unavailable', async () => {
  const icons = await import(new URL('item-icons.js', base));
  const seen = [];
  const off = icons.onIconReady(k => seen.push(k));
  assert.equal(icons.iconURL('wood'), null);           // queued, nothing cached yet
  await new Promise(r => setTimeout(r, 60));           // queue drains; no document -> no WebGL
  assert.equal(icons.iconURL('wood'), null);
  assert.deepEqual(seen, []);
  icons.setModelProvider(() => null);                  // swapping providers must not throw
  off();
});
