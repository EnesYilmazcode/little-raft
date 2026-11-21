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

test('Bag: hotbar has 10 slots and an 8-slot era save still loads', () => {
  assert.equal(HOTBAR_SIZE, 10);
  const old = new Bag(); old.select(7);
  const copy = new Bag(old.snapshot());
  assert.equal(copy.selectedIndex, 7);
  assert.equal(Bag.salvage({ slots: old.snapshot().slots, selected: 7 }).selectedIndex, 7);
  assert.equal(copy.select(9), true);
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
  assert.equal(bag.cycle(-3), HOTBAR_SIZE - 1);
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

// =================================================================== Crafting book (pure UI logic)

const CB = await import(new URL('craft-book.js', base));
const { RECIPES, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const normRecipes = () => Object.values(RECIPES).map(r => ({
  id: r.id, name: r.name, out: { ...r.output }, reqs: Object.entries(r.cost).map(([kind, count]) => ({ kind, count })),
}));

test('CraftBook: every recipe lands in exactly one known tab, in CATEGORIES order', () => {
  const recipes = normRecipes();
  const groups = CB.groupRecipes(recipes, ITEM_INFO);
  const ids = CB.CATEGORIES.map(c => c.id);
  assert.deepEqual(groups.map(g => g.id), ids.filter(id => groups.some(g => g.id === id)), 'tab order');
  const seen = groups.flatMap(g => g.recipes.map(r => r.id));
  assert.equal(seen.length, recipes.length);
  assert.deepEqual([...seen].sort(), recipes.map(r => r.id).sort());
  for (const g of groups) assert.ok(g.recipes.length > 0, `${g.id} not empty`);
  assert.deepEqual(groups.find(g => g.id === 'tools').recipes.map(r => r.id), ['hook', 'hammer', 'fishingrod', 'metalhook', 'binoculars', 'spear', 'drum', 'pipes', 'bells']); // [instruments] [spear]
  assert.deepEqual(groups.find(g => g.id === 'materials').recipes.map(r => r.id), ['rope', 'nail', 'bolt', 'hinge']);
});

test('CraftBook: unknown outputs fall back to tools (tool flag) or building', () => {
  assert.equal(CB.categoryOf('spear'), 'tools');
  assert.equal(CB.categoryOf('mystery', { tool: true }), 'tools');
  assert.equal(CB.categoryOf('mystery'), 'building');
  assert.deepEqual(CB.groupRecipes([]), []);
  const g = CB.groupRecipes([{ id: 'x', out: { kind: 'x' } }, null]);
  assert.deepEqual(g.map(c => c.id), ['building']);
});

test('CraftBook: every item kind has description and use text', () => {
  for (const k of Object.keys(ITEM_INFO)) {
    assert.ok(CB.ITEM_TEXT[k]?.desc, `${k} desc`);
    assert.ok(CB.ITEM_TEXT[k]?.use, `${k} use`);
  }
});

test('CraftBook: ingredient rows report owned vs needed and the shortfall', () => {
  const bag = bagFrom([null, null, null, null, null, null, null, null, { kind: 'wood', count: 3 }, { kind: 'rope', count: 5 }]);
  const rows = CB.ingredientRows([{ kind: 'wood', count: 4 }, { kind: 'rope', count: 2 }], k => bag.count(k));
  assert.deepEqual(rows, [
    { kind: 'wood', need: 4, have: 3, enough: false, short: 1 },
    { kind: 'rope', need: 2, have: 5, enough: true, short: 0 },
  ]);
  assert.equal(CB.amountLabel(rows[0]), '3 / 4');
  assert.equal(CB.amountLabel(rows[1]), '5 / 2');
  assert.equal(CB.craftableTimes(rows), 0);
  assert.equal(CB.recipeState(rows, bag.canCraft('hammer')), 'missing');
  // A throwing counter is treated as owning nothing.
  assert.equal(CB.ingredientRows([{ kind: 'wood', count: 1 }], () => { throw new Error('x'); })[0].have, 0);
});

test('CraftBook: craftableTimes and recipeState follow the Bag', () => {
  const bag = bagFrom([null, null, null, null, null, null, null, null, { kind: 'leaf', count: 9 }]);
  const rope = CB.ingredientRows([{ kind: 'leaf', count: 2 }], k => bag.count(k));
  assert.equal(CB.craftableTimes(rope), 4);
  assert.equal(CB.recipeState(rope, bag.canCraft('rope')), 'ready');
  assert.equal(CB.craftableTimes([]), Infinity);
  // Materials present but no room for the output -> 'full'.
  const slots = new Array(SLOT_COUNT).fill(null).map(() => ({ kind: 'fish', count: STACK_SIZE }));
  slots[5] = { kind: 'wood', count: STACK_SIZE };
  slots[6] = { kind: 'scrap', count: STACK_SIZE };
  const full = new Bag({ slots, selected: 0 });
  const lantern = CB.ingredientRows([{ kind: 'wood', count: 2 }, { kind: 'scrap', count: 2 }], k => full.count(k));
  assert.equal(CB.recipeState(lantern, full.canCraft('lantern')), 'full');
  assert.equal(CB.recipeState(lantern, null), 'ready');
});

test('CraftBook: usedIn lists the recipes that consume an item', () => {
  const recipes = normRecipes();
  for (const n of ['Crate', 'Lantern']) assert.ok(CB.usedIn('scrap', recipes).includes(n), n); // other lanes add more scrap recipes
  assert.ok(CB.usedIn('rope', recipes).includes('Hammer'));
  assert.deepEqual(CB.usedIn('fish', recipes), []);
});

test('CraftBook: hold-to-craft interval starts slow, accelerates, and floors at the minimum', () => {
  const H = CB.HOLD;
  assert.equal(CB.holdDelay(1), H.first);
  let prev = Infinity;
  for (let n = 1; n < 40; n++) {
    const d = CB.holdDelay(n);
    assert.ok(d <= prev, `non-increasing at ${n}`);
    assert.ok(d >= H.min, `floor at ${n}`);
    prev = d;
  }
  assert.ok(CB.holdDelay(2) < CB.holdDelay(1));
  assert.equal(CB.holdDelay(100), H.min);
  assert.equal(CB.holdDelay(0), CB.holdDelay(1), 'junk counts clamp to the first step');
  const s = CB.holdSchedule(5);
  assert.equal(s[0], 0, 'press crafts immediately');
  assert.equal(s[1], H.first);
  for (let i = 2; i < s.length; i++) assert.ok(s[i] - s[i - 1] <= s[i - 1] - s[i - 2]);
});

test('CraftBook: a click crafts one; holding crafts more, capped', () => {
  assert.equal(CB.craftsForHold(0), 1);
  assert.equal(CB.craftsForHold(CB.HOLD.first - 1), 1);
  assert.equal(CB.craftsForHold(CB.HOLD.first), 2);
  const sched = CB.holdSchedule(12);
  for (let i = 1; i < sched.length; i++) {
    assert.equal(CB.craftsForHold(sched[i]), i + 1);
    assert.equal(CB.craftsForHold(sched[i] - 1), i);
  }
  assert.equal(CB.craftsForHold(60000, 4), 4);
  assert.ok(CB.craftsForHold(2000) > 6, 'a two second hold crafts plenty');
});

test('CraftBook: tooltip anchors beside the element, never off-screen', () => {
  const vw = 1280, vh = 720;
  const right = CB.anchorTip({ left: 100, top: 200, right: 150, bottom: 250 }, 200, 80, vw, vh);
  assert.deepEqual(right, { x: 158, y: 200, side: 'right' });
  const left = CB.anchorTip({ left: 1100, top: 200, right: 1200, bottom: 250 }, 200, 80, vw, vh);
  assert.equal(left.side, 'left');
  assert.equal(left.x + 200, 1100 - 8);
  const below = CB.anchorTip({ left: 10, top: 100, right: 1270, bottom: 150 }, 200, 80, vw, vh);
  assert.equal(below.side, 'below');
  assert.equal(below.y, 158);
  const above = CB.anchorTip({ left: 10, top: 600, right: 1270, bottom: 700 }, 200, 80, vw, vh);
  assert.equal(above.side, 'above');
  assert.equal(above.y, 600 - 8 - 80);
  // Near the bottom edge the tip is pulled up so it stays inside the viewport.
  const low = CB.anchorTip({ left: 100, top: 690, right: 150, bottom: 715 }, 200, 80, vw, vh);
  assert.ok(low.y + 80 <= vh - 6);
  for (const p of [right, left, below, above, low]) {
    assert.ok(p.x >= 6 && p.x + 200 <= vw - 6 && p.y >= 6 && p.y + 80 <= vh - 6, JSON.stringify(p));
  }
});

test('Bag.version increases on every mutation and never on reads', () => {
  const bag = new Bag();
  let v = bag.version;
  const bumped = (label) => { assert.ok(bag.version > v, `${label} bumps version`); v = bag.version; };
  const same = (label) => { assert.equal(bag.version, v, `${label} leaves version`); };
  bag.count('wood'); bag.counts(); bag.snapshot(); void bag.selected; bag.canCraft('hook'); bag.canCraft('rope');
  same('reads');
  bag.add('wood', 5); bumped('add');
  bag.add('plastic', 4); bumped('add');
  bag.add('nope', 3); bag.add('wood', 0); same('rejected add');
  bag.remove('wood', 1); bumped('remove');
  bag.remove('wood', 999); same('refused remove');
  bag.move(1, 9); bumped('move');
  bag.move(1, 9); same('refused move');
  bag.select(3); bumped('select');
  bag.select(3); bag.select(99); same('no-op select');
  bag.cycle(1); bumped('cycle');
  bag.cycle(0); same('no-op cycle');
  assert.equal(bag.craft('hook').ok, true); bumped('craft');
  assert.equal(bag.craft('fishingrod').ok, false); same('failed craft');
  bag.count('hook'); bag.snapshot(); same('reads after mutations');
  assert.equal('version' in bag.snapshot(), false, 'snapshot stays version-free');
});

test('HookCast: skip(item) behaves exactly like filtering items out of the list', () => {
  const items = reelItems();
  const skipA = (it) => it.id === 'a';
  const filtered = items.filter(it => !skipA(it));
  const a = cast({ direction: elevDir(0), charge: 1 }), b = cast({ direction: elevDir(0), charge: 1 });
  const evA = [], evB = [];
  for (let i = 0; i < 600; i++) {
    const reeling = i > 150;
    const ea = a.update(0.02, { hand: hand(), items: filtered, reeling });
    const eb = b.update(0.02, { hand: hand(), items, skip: skipA, reeling });
    if (ea) evA.push(ea);
    if (eb) evB.push(eb);
    assert.deepEqual(b.position, a.position);
    assert.deepEqual(b.caughtItems, a.caughtItems);
  }
  assert.equal(evB.length, 1);
  assert.deepEqual(evB, evA);
  assert.deepEqual(evB[0].items, [{ id: 'b', token: 'tb', type: 'plastic' }]);

  // A caught item that becomes skipped is dropped, as if it vanished; a non-function skip is ignored.
  const c = cast({ direction: elevDir(0), charge: 1 });
  flyOut(c, items);
  for (let i = 0; i < 500 && c.caughtItems.length < 2; i++) c.update(0.02, { hand: hand(), items, reeling: true, skip: 'nope' });
  assert.equal(c.caughtItems.length, 2);
  c.update(0.02, { hand: hand(), items, reeling: true, skip: skipA });
  assert.deepEqual(c.caughtItems.map(it => it.id), ['b']);
});

test('HookCast: ropePoints(hand, n, out) fills and returns the caller array', () => {
  const c = cast({ direction: elevDir(20), charge: 0.5 });
  flyOut(c);
  run(c, 0.3, [], false);
  const h = new T.Vector3(0.3, 1.2, -0.2);
  const ref = c.ropePoints(h, 8).map(v => v.clone());
  const internal = c.ropePoints(h, 8);

  const kept = new T.Vector3();
  const out = [kept, null, 5];
  assert.equal(c.ropePoints(h, 8, out), out);
  assert.equal(out.length, 9);
  assert.equal(out[0], kept, 'existing vectors are reused');
  for (let i = 0; i < 9; i++) {
    assert.ok(out[i] instanceof T.Vector3);
    assert.deepEqual(out[i], ref[i]);
  }
  // Shrinks to fit, never touches the hook's own array.
  const first = out[0];
  assert.equal(c.ropePoints(h, 4, out), out);
  assert.equal(out.length, 5);
  assert.equal(out[0], first);
  assert.equal(c.ropePoints(h, 8), internal);
  assert.deepEqual(internal, ref);
  // Non-array out falls back to the internal array.
  assert.equal(c.ropePoints(h, 8, {}), internal);
});

// ================================================================= Ocean

test('Ocean: allocation-free getHeight/getSlope/sample match the reference Gerstner sampler exactly', async () => {
  const { createOcean } = await import(new URL('ocean.js', base));
  const ocean = createOcean(T);
  // Reference copy of the original object-based CPU sampler.
  const WAVES = [[1.0, 0.35, 0.10, 31.0, 0.50], [0.7, 0.90, 0.065, 19.0, 0.60],
    [-0.45, 1.0, 0.05, 12.5, 0.60], [0.95, -0.55, 0.04, 9.2, 0.50]];
  const pre = WAVES.map(([dx, dz, a, l, q]) => {
    const len = Math.hypot(dx, dz), k = (Math.PI * 2) / l;
    return { dx: dx / len, dz: dz / len, a, k, c: Math.sqrt(9.8 / k) * 0.6, q };
  });
  const displace = (x, z, t, out) => {
    let ox = 0, oy = 0, oz = 0;
    for (const w of pre) {
      const f = w.k * (w.dx * x + w.dz * z - w.c * t), co = Math.cos(f);
      ox += w.dx * w.q * w.a * co; oz += w.dz * w.q * w.a * co; oy += w.a * Math.sin(f);
    }
    out[0] = ox; out[1] = oy; out[2] = oz;
  };
  const tmp = [0, 0, 0];
  const refH = (x, z, t) => {
    let px = x, pz = z;
    for (let i = 0; i < 2; i++) { displace(px, pz, t, tmp); px = x - tmp[0]; pz = z - tmp[2]; }
    displace(px, pz, t, tmp);
    return ocean.mesh.position.y + tmp[1];
  };
  const refS = (x, z, t, e = 0.6) => ({
    x: (refH(x + e, z, t) - refH(x - e, z, t)) / (2 * e), z: (refH(x, z + e, t) - refH(x, z - e, t)) / (2 * e),
  });
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out = { h: 0, sx: 0, sz: 0 }, so = { x: 0, z: 0 };
  for (let i = 0; i < 2000; i++) {
    const x = (rnd() - 0.5) * 400, z = (rnd() - 0.5) * 400, t = rnd() * 3000;
    ocean.update(t);
    const h = refH(x, z, t), s = refS(x, z, t), s2 = refS(x, z, t, 2.2);
    assert.ok(Math.abs(ocean.getHeight(x, z) - h) <= 1e-9);
    const g = ocean.getSlope(x, z);
    assert.ok(Math.abs(g.x - s.x) <= 1e-9 && Math.abs(g.z - s.z) <= 1e-9);
    assert.equal(ocean.getSlope(x, z, undefined, 2.2, so), so);
    assert.ok(Math.abs(so.x - s2.x) <= 1e-9 && Math.abs(so.z - s2.z) <= 1e-9);
    assert.equal(ocean.sample(x, z, out), out);
    assert.ok(Math.abs(out.h - h) <= 1e-9 && Math.abs(out.sx - s.x) <= 1e-9 && Math.abs(out.sz - s.z) <= 1e-9);
  }
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

test('loadItemIcon resolves null without WebGL and getItemIcon is the sync accessor', async () => {
  const icons = await import(new URL('item-icons.js', base));
  assert.equal(icons.getItemIcon, icons.iconURL);
  assert.equal(await icons.loadItemIcon('hammer'), null);
  assert.equal(await icons.loadItemIcon(''), null);
});

// ---------------------------------------------------------------- pickup feed

const { createFeed, MAX_ROWS, MERGE_MS, HOLD_MS, FADE_MS } = await import(new URL('pickup-feed.js', base));
function fakeDoc() {
  const mk = tag => {
    const el = { tagName: tag.toUpperCase(), nodeType: 1, children: [], parent: null, attrs: {}, textContent: '', offsetWidth: 0,
      get isConnected() { let e = this; while (e.parent) e = e.parent; return e === body; },
      classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); } },
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(c) { c.remove(); c.parent = this; this.children.push(c); return c; },
      append(...cs) { cs.forEach(c => this.appendChild(c)); },
      replaceChildren(...cs) { [...this.children].forEach(c => c.remove()); this.append(...cs); },
      remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } },
      set className(v) { v.split(' ').forEach(c => this.classList.add(c)); },
    };
    return el;
  };
  const body = mk('body');
  return { body, createElement: mk, createElementNS: (_, t) => mk(t),
    getElementById(id) { const walk = e => e.id === id ? e : e.children.map(walk).find(Boolean); return walk(body) ?? null; } };
}
function fakeClock() {
  let t = 0, id = 0; const q = new Map();
  return { now: () => t, timer: (fn, ms) => { q.set(++id, { fn, at: t + ms }); return id; }, clear: i => q.delete(i),
    tick(ms) { t += ms; for (const [i, j] of [...q]) if (j.at <= t && q.delete(i)) j.fn(); } };
}

test('pickup feed: repeats of one kind merge into one row with a summed count', () => {
  const doc = fakeDoc(), c = fakeClock(), feed = createFeed({ doc, ...c });
  feed.add('wood', 2); c.tick(500); feed.add('wood', 1); feed.add('leaf', 1);
  const W = ITEM_INFO.wood.name, L = ITEM_INFO.leaf.name; // merged: progression's items.js names the kinds (wood = 'Plank')
  assert.deepEqual(feed.rows, [`+3 ${W}`, `+1 ${L}`]);
  const host = doc.getElementById('pickupFeed');
  assert.equal(host.children.length, 2);
  c.tick(MERGE_MS + 10); feed.add('wood', 2); // outside the merge window: a fresh row
  assert.deepEqual(feed.rows, [`+1 ${L}`, `+2 ${W}`]);
  c.tick(HOLD_MS + 10); c.tick(FADE_MS + 10);
  assert.deepEqual(feed.rows, []); assert.equal(host.children.length, 0);
});

test('pickup feed: caps visible rows and ignores junk input', () => {
  const doc = fakeDoc(), c = fakeClock(), feed = createFeed({ doc, ...c });
  for (const k of ['wood', 'leaf', 'scrap', 'plastic', 'fish', 'rope', 'sail']) feed.add(k, 1);
  assert.equal(feed.rows.length, MAX_ROWS);
  assert.equal(feed.add('wood', 0), null); assert.equal(feed.add('', 2), null); assert.equal(feed.note('  '), null);
  feed.note('Your bag is full'); feed.note('Your bag is full');
  assert.equal(feed.rows.filter(r => r === 'Your bag is full').length, 1);
});

test('pickup feed: icon provider wins, svg sprite is the fallback', () => {
  const doc = fakeDoc(), c = fakeClock(), feed = createFeed({ doc, ...c });
  feed.add('wood', 1);
  const icon = r => doc.getElementById('pickupFeed').children[r].children[0].children[0];
  assert.equal(icon(0).tagName, 'SVG');
  feed.setIconProvider(k => k === 'scrap' ? 'data:image/png;base64,AA' : null);
  feed.add('scrap', 1);
  assert.equal(icon(1).tagName, 'IMG'); assert.equal(icon(1).src, 'data:image/png;base64,AA');
});

test('pickup feed: no borrowed sprite for placeholder items (water is not a barrel)', () => {
  const doc = fakeDoc(), c = fakeClock(), feed = createFeed({ doc, ...c });
  feed.add('water', 1); feed.add('seed', 1);
  const box = r => doc.getElementById('pickupFeed').children[r].children[0];
  assert.equal(box(0).children.length, 0); assert.equal(box(1).children.length, 0);
});

test('pickup feed: refresh swaps in an icon that finished rendering late', () => {
  const doc = fakeDoc(), c = fakeClock(), feed = createFeed({ doc, ...c });
  let ready = null; feed.setIconProvider(() => ready);
  feed.add('wood', 1);
  const icon = () => doc.getElementById('pickupFeed').children[0].children[0].children;
  assert.equal(icon()[0].tagName, 'SVG'); // sprite placeholder while the 3D icon renders
  ready = 'data:image/png;base64,BB'; feed.refresh('wood'); feed.refresh('leaf');
  assert.equal(icon().length, 1); assert.equal(icon()[0].src, 'data:image/png;base64,BB');
});

test('settings validation clamps ranges, keeps booleans strict and falls back to defaults', async () => {
  const { validateSettings, SETTINGS_DEFAULTS: D } = await import(new URL('settings.js', base));
  assert.deepEqual(validateSettings(null), { ...D });
  const v = validateSettings({ sensitivity: 99, fov: 'x', invertY: 'yes', shadows: false, graphics: 'ultra', renderScale: 0.1, ambience: 0 });
  assert.equal(v.sensitivity, 3); assert.equal(v.fov, D.fov); assert.equal(v.invertY, false);
  assert.equal(v.shadows, false); assert.equal(v.graphics, D.graphics); assert.equal(v.renderScale, 0.5); assert.equal(v.ambience, 0);
});

test('a fresh bag (new game) holds only the hook', () => {
  const kinds = new Bag().slots.filter(Boolean).map(s => s.kind);
  assert.deepEqual(kinds, ['hook']);
});

// ---------------------------------------------------------------- placement

const { floorTarget, decorCheck, normaliseDecor } = await import(new URL('placement.js', base));
const DECOR = ['sail', 'palm', 'lantern', 'net', 'bench', 'crate'];
const tilesOf = list => { const s = new Set(list.map(([x, z]) => x + ',' + z)); return (x, z) => s.has(x + ',' + z); };
const raft2 = tilesOf([[-1, 0], [0, 0], [-1, 1], [0, 1]]);

test('placement: foundations snap next to the raft, aiming near an edge picks the neighbour', () => {
  assert.deepEqual(floorTarget(raft2, 2.1, 0.2), { x: 1, z: 0 }, 'water beside the raft');
  assert.deepEqual(floorTarget(raft2, 0.8, 0.1), { x: 1, z: 0 }, 'near the +x edge of tile 0,0');
  assert.equal(floorTarget(raft2, 0.1, 0.1), null, 'middle of an existing tile');
  assert.equal(floorTarget(raft2, 6, 6), null, 'not adjacent');
});

test('placement: decor sits anywhere on deck, near edges, but not off it or on other decor', () => {
  const crate = (x, z, rot = 0) => ({ type: 'crate', x, z, rot });
  assert.equal(decorCheck(raft2, [], crate(0.37, 0.1)), 'ok', 'off-centre, close to the edge');
  assert.equal(decorCheck(raft2, [], crate(0.95, 0.1)), 'air', 'hangs over the water');
  assert.equal(decorCheck(raft2, [], crate(-1, 1)), 'ok', 'straddling four tiles');
  const placed = [crate(0, 0)];
  assert.equal(decorCheck(raft2, placed, crate(0.5, 0.2)), 'blocked');
  assert.equal(decorCheck(raft2, placed, crate(-1.1, 0)), 'ok', 'side by side');
  const bench = { type: 'bench', x: -1, z: 1, rot: 0 };
  assert.equal(decorCheck(raft2, [bench], crate(-1, 1.75)), 'ok', 'thin bench leaves room in front');
  assert.equal(decorCheck(raft2, [{ ...bench, rot: Math.PI / 2 }], crate(-1, 1.75)), 'blocked', 'rotated bench does not');
  assert.equal(decorCheck(raft2, [], { type: 'net', x: 0.9, z: 0, rot: 0 }), 'ok', 'nets may hang over the side');
});

test('placement: old tile-centred decor still loads, new entries keep floats and rotation', () => {
  assert.deepEqual(normaliseDecor({ type: 'palm', x: 0, z: 1 }, DECOR, raft2), { type: 'palm', x: 0, z: 2, rot: 0 });
  assert.deepEqual(normaliseDecor({ type: 'crate', x: 0.4567, z: 1.2, rot: -Math.PI / 2 }, DECOR, raft2), { type: 'crate', x: 0.457, z: 1.2, rot: 4.712 });
  assert.equal(normaliseDecor({ type: 'crate', x: 9, z: 9 }, DECOR, raft2), null, 'off the raft');
  assert.equal(normaliseDecor({ type: 'crate', x: 0.5, z: 0 }, DECOR, raft2), null, 'float without rot is not a legacy cell');
  assert.equal(normaliseDecor({ type: 'rocket', x: 0, z: 0, rot: 0 }, DECOR, raft2), null);
});

// ============================================================ bug fixes

test('HookCast: a throw aimed at the deck lands on the deck, not in the water under it', () => {
  const DECK = 0.26; // deck surface over a 3x3 raft of 2 m tiles centred on the origin
  const deck = (x, z) => (Math.abs(x) <= 3 && Math.abs(z) <= 3 ? DECK : null);
  const c = cast({ origin: new T.Vector3(0, 1.8, 0), direction: elevDir(-55), charge: 0.15, deck });
  flyOut(c);
  assert.equal(c.stage, 'floating');
  assert.ok(Math.hypot(c.landing.x, c.landing.z) < 3, 'landed within the raft');
  assert.equal(c.landing.y, DECK, 'rests on the planks');
  assert.equal(c.onDeck, true);
  const { x, z } = c.position;
  run(c, 2, [], false);
  assert.equal(c.position.x, x, 'no water drift or bob on the deck');
  assert.equal(c.position.z, z);
  assert.equal(c.position.y, DECK);
  // Reeling home along the deck never sinks below the planks.
  let low = Infinity;
  for (let i = 0; i < 300 && c.stage !== 'done'; i++) {
    c.update(0.02, { hand: new T.Vector3(0, 1.8, 0), items: [], reeling: true });
    low = Math.min(low, c.position.y);
  }
  assert.equal(c.stage, 'done');
  assert.ok(low >= DECK, `dipped to ${low}`);
});

test('HookCast: a throw from beside the raft out to sea still lands in the water', () => {
  const deck = (x, z) => (Math.abs(x) <= 3 && Math.abs(z) <= 3 ? 0.26 : null);
  const c = cast({ origin: new T.Vector3(0, 1.8, 2.5), direction: elevDir(10).negate().setY(0.17), charge: 0.5, deck });
  flyOut(c);
  assert.ok(c.landing.z > 3);
  assert.equal(c.landing.y, WATER_Y);
  assert.equal(c.onDeck, false);
});

test('Bag.salvage keeps every valid slot of a slightly malformed save instead of wiping it', () => {
  const s = new Array(SLOT_COUNT).fill(null);
  s[0] = { kind: 'hook', count: 1, durability: 40 };
  s[1] = { kind: 'wood', count: 35 };             // over the stack cap: clamp
  s[2] = { kind: 'warpdrive', count: 3 };         // kind from another build: drop (merged: 'nail' is a real progression item now)
  s[3] = { kind: 'hammer', count: 1, durability: 250 };
  s[4] = { kind: 'leaf', count: 4, durability: 9 };
  s[5] = 'junk';
  const bag = Bag.salvage({ slots: s.concat([{ kind: 'wood', count: 2 }]), selected: 12 });
  assert.equal(bag.slots[0].durability, 40);
  assert.equal(bag.slots[1].count, STACK_SIZE);
  assert.equal(bag.slots[2], null);
  assert.equal(bag.slots[3].durability, TOOL_DURABILITY);
  assert.deepEqual(bag.slots[4], { kind: 'leaf', count: 4 });
  assert.equal(bag.slots[5], null);
  assert.equal(bag.slots.length, SLOT_COUNT);
  assert.equal(bag.selectedIndex, 0);
  assertStacksValid(bag);
  assert.equal(Bag.salvage(null), null);
  assert.equal(Bag.salvage({ slots: 'x' }), null);
  const good = bagFrom([{ kind: 'wood', count: 3 }], 2).snapshot();
  assert.deepEqual(Bag.salvage(good).snapshot(), good);
});

test('HookCast: drifting water never carries a floating hook in under the raft', () => {
  const deck = (x, z) => (Math.abs(x) <= 3 && Math.abs(z) <= 3 ? 0.26 : null);
  // Floating just off the -Z edge, the current pushes it toward the hull.
  const c = cast({ origin: new T.Vector3(0, 1.2, -3.4), direction: elevDir(-80), charge: 0, drift: { x: 0, z: 0.5 }, deck });
  flyOut(c);
  assert.equal(c.onDeck, false);
  for (let i = 0; i < 300; i++) {
    c.update(0.02, { hand: new T.Vector3(0, 1.2, -3.4), items: [] });
    assert.equal(deck(c.position.x, c.position.z), null, `hook slid under the deck at z=${c.position.z}`);
  }
  assert.equal(c.stage, 'floating');
});

test('HookCast: a player walking across the raft hauls a floating hook onto the planks', () => {
  const DECK = 0.26, deck = (x, z) => (Math.abs(x) <= 3 && Math.abs(z) <= 3 ? DECK : null);
  const c = cast({ origin: new T.Vector3(0, 1.2, -2), direction: elevDir(0), charge: 0, maxRange: 4, deck });
  flyOut(c);
  assert.ok(c.landing.z < -3, 'landed in the water off the edge');
  // Walk to the far side of the raft: the taut rope drags the hook across the deck.
  for (let i = 0; i < 200; i++) c.update(0.02, { hand: new T.Vector3(0, 1.2, -2 + i * 0.02), items: [] });
  assert.equal(c.onDeck, true);
  assert.equal(c.position.y, DECK, 'rests on the deck, not under it');
  const events = run(c, 3, [], true); // and it still reels home
  assert.equal(c.stage, 'done');
  assert.deepEqual(events, [{ kind: 'returned' }]);
});

test('Bag.salvage repairs a snapshot with the wrong slot count or selection', () => {
  const short = { slots: [{ kind: 'wood', count: 5 }, { kind: 'hook', count: 1 }], selected: 1 };
  const bag = Bag.salvage(short);
  assert.equal(bag.slots.length, SLOT_COUNT);
  assert.deepEqual(bag.slots[0], { kind: 'wood', count: 5 });
  assert.equal(bag.slots[1].durability, TOOL_DURABILITY);
  assert.equal(bag.selectedIndex, 1);
  assert.throws(() => new Bag(short), TypeError, 'strict constructor still rejects it');
  assert.equal(Bag.salvage({ slots: [], selected: HOTBAR_SIZE }).selectedIndex, 0);
});

// ---- feel: audio buses + co-op avatar held item ----
test('audio buses clamp, unknown names are rejected, play is silent without a context', async () => {
  const { createOceanAudio, BUSES, EVENTS } = await import(new URL('audio.js', base));
  const a = createOceanAudio({ volume: 2 });
  assert.deepEqual([...BUSES], ['master', 'effects', 'ambience', 'music']);
  assert.equal(a.getBus('master'), 1);
  assert.equal(a.setBus('ambience', -1), 0);
  assert.equal(a.setBus('nope', 1), null);
  assert.equal(a.setMusic(true), true);
  for (const e of EVENTS) assert.equal(a.play(e), false);
  a.tick(0.016, { swimming: true });
  a.destroy();
});

test('avatar shows one held model per kind and animates without NaN', async () => {
  const { createAvatar } = await import(new URL('avatar.js', base));
  const g = createAvatar(T, '#70a7e4'), held = g.getObjectByName('held');
  g.userData.setHeld('hammer'); g.userData.setHeld('hook'); g.userData.setHeld('hammer');
  assert.equal(held.children.length, 2);
  assert.equal(held.children.filter(c => c.visible).length, 1);
  g.userData.setHeld('not-a-thing');
  assert.equal(held.children.filter(c => c.visible).length, 0);
  for (let i = 0; i < 20; i++) g.userData.animate(1 / 60, { speed: 3, swimming: i > 10, pitch: 0.4 });
  const { rightArm, leftLeg } = g.userData.parts;
  assert.ok(Number.isFinite(rightArm.rotation.x) && Number.isFinite(leftLeg.rotation.x));
  g.userData.dispose();
});

// Minimal fake Web Audio graph: counts live connections and lets the test end sources on demand.
function fakeAudioContext() {
  const live = new Set(), sources = new Set();
  const param = v => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = (extra = {}) => {
    const n = { connect(d) { live.add(n); return d; }, disconnect() { live.delete(n); }, ...extra };
    return n;
  };
  const source = extra => {
    const s = node({ stopped: false, onended: null, start() { sources.add(s); }, stop() { s.stopped = true; }, ...extra });
    return s;
  };
  const ctx = {
    state: 'suspended', currentTime: 0, sampleRate: 8000, destination: node(),
    resume() { ctx.state = 'running'; return Promise.resolve(); },
    createGain: () => node({ gain: param(1) }),
    createBiquadFilter: () => node({ frequency: param(350), Q: param(1), type: 'lowpass' }),
    createDynamicsCompressor: () => node({ threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0) }),
    createOscillator: () => source({ frequency: param(440), detune: param(0), type: 'sine' }),
    createBufferSource: () => source({ buffer: null, loop: false }),
    createBuffer: (c, len, rate) => { const d = new Float32Array(len); return { duration: len / rate, getChannelData: () => d }; },
    endOneShots() { for (const s of [...sources]) if (!s.loop && s.stopped) { sources.delete(s); s.onended?.(); } },
  };
  return { ctx, live, sources };
}

test('audio waits for a gesture, starts ambience once and frees every one-shot voice', async () => {
  const { createOceanAudio, EVENTS, ALIASES } = await import(new URL('audio.js', base));
  const { ctx, live, sources } = fakeAudioContext();
  const a = createOceanAudio({ context: ctx, volume: 0.5 });
  assert.equal(a.play('pickup'), false, 'silent before resume()');
  assert.equal(await a.resume(), true);
  const base0 = live.size, loops0 = sources.size;
  assert.ok(loops0 > 0, 'ambience loops started');
  await a.resume(); await a.resume();
  assert.equal(sources.size, loops0, 'ambience created once');
  for (const name of ['pickup', 'throw', 'reel', 'build', 'place', 'plant', 'water', 'catch', 'splash']) {
    assert.ok(EVENTS.includes(name) || ALIASES[name], name);
  }
  for (const e of [...EVENTS, ...Object.keys(ALIASES)]) { ctx.currentTime += 1; assert.equal(a.play(e), true, e); if (e === 'deny') ctx.endOneShots(); }
  ctx.endOneShots();
  assert.equal(live.size, base0, 'effect voices disconnected after ending');
  let capped = 0;
  for (let i = 0; i < 40; i++) capped += a.play(EVENTS[i % EVENTS.length]) ? 0 : 1, ctx.currentTime += 0.5;
  assert.ok(capped > 0, 'voice cap drops excess sounds');
  ctx.endOneShots();
  a.setMusic(true);
  for (let i = 0; i < 400; i++) { ctx.currentTime += 0.05; a.tick(0.05, { swimming: i > 200 }); }
  a.setMusic(false);
  assert.ok(live.size > base0);
  ctx.endOneShots();
  assert.equal(live.size, base0, 'one-shot voices disconnected after ending');
  assert.equal(a.setBus('effects', 0.3), 0.3);
  a.setVolume(0);
  assert.equal(a.play('build'), false, 'muted master skips scheduling');
  a.destroy();
  assert.equal(live.size, 0, 'destroy disconnects the whole graph');
});
