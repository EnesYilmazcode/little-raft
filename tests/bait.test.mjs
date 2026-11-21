// [bait] Shark Bait: recipe, throw/float/expire rules, shark lure override and attack timer reset.
import test from 'node:test';
import assert from 'node:assert/strict';

const { BAIT, BAIT_STAGE, createBaitState, throwBait, stepBait, syncLure, baitNet, baitFloating } = await import('../dist/bait.js');
const { SHARK, createSharkState, step, startAttack, hit, lured } = await import('../dist/shark.js');
const { ITEMS, recipeTable } = await import('../dist/items.js');
const { Bag } = await import('../dist/inventory-state.js');

const grid = () => { const t = []; for (let z = -1; z < 2; z++) for (let x = -1; x < 2; x++) t.push([x, z]); return t; };
const world = () => ({ tiles: grid(), decor: [], tileHp: {}, pieces: [], garden: {}, purifiers: {} });
const floating = (x, z) => { const b = createBaitState(); b.stage = BAIT_STAGE.floating; b.x = x; b.z = z; b.left = BAIT.DURATION; return b; };

test('recipe: Shark Bait = 2 rope + 2 raw fish, hand crafted, stacks to 5', () => {
  const it = ITEMS.sharkbait;
  assert.equal(it.name, 'Shark Bait');
  assert.deepEqual({ ...it.recipe.cost }, { rope: 2, fish: 2 });
  assert.equal(it.recipe.station, null);
  assert.equal(it.recipe.count, 1);
  assert.equal(it.stack, 5);
  assert.ok(!it.tool, 'no durability');
  assert.deepEqual({ ...recipeTable().sharkbait.cost }, { rope: 2, fish: 2 });
  const bag = new Bag(); bag.add('rope', 2); bag.add('fish', 2);
  assert.ok(bag.craft('sharkbait'));
  assert.equal(bag.count('sharkbait'), 1); assert.equal(bag.count('rope'), 0); assert.equal(bag.count('fish'), 0);
});

test('throw: a short arc that lands in the water and floats', () => {
  const b = createBaitState();
  assert.ok(throwBait(b, 0, 1.9, 0, 0, -0.1, 1));
  assert.equal(b.stage, BAIT_STAGE.flying);
  let landed = -1;
  for (let t = 0; t < 5; t += 0.02) if (stepBait(b, 0.02, grid()) === 1) { landed = t; break; }
  assert.ok(landed > 0.3 && landed < 2, 'lands within a couple of seconds: ' + landed);
  assert.ok(baitFloating(b));
  assert.ok(b.z > 3 && b.z < 14, 'a short throw past the raft edge: ' + b.z);
  assert.equal(b.y, 0);
  assert.equal(b.left, BAIT.DURATION);
  assert.equal(throwBait(b, 0, 1, 0, 0, 0, 0), false, 'needs a direction');
  assert.equal(throwBait(b, NaN, 1, 0, 0, 0, 1), false);
});

test('throw onto the deck rolls off the nearest edge into the water', () => {
  const b = createBaitState();
  throwBait(b, 0, 1.9, 0, 0, -1, 0.05); // straight down at the deck
  let ev = 0; for (let i = 0; i < 200 && ev !== 1; i++) ev = stepBait(b, 0.02, grid());
  assert.equal(ev, 1);
  assert.ok(Math.max(Math.abs(b.x), Math.abs(b.z)) > 3, 'off the 3x3 raft: ' + b.x + ',' + b.z);
});

test('duration: floats for 80 s after landing, then is used up', () => {
  const b = floating(0, 8);
  let gone = -1;
  for (let t = 0; t < 100; t += 0.1) if (stepBait(b, 0.1, grid()) === 2) { gone = t + 0.1; break; }
  assert.ok(Math.abs(gone - BAIT.DURATION) < 0.15, 'used up after 80 s: ' + gone);
  assert.equal(b.stage, 0);
  assert.equal(BAIT.DURATION, 80);
  const lure = { active: true, x: 0, z: 0 }; syncLure(b, lure); assert.equal(lure.active, false);
});

test('drifts with the water and is lost far from the raft', () => {
  const b = floating(0, 8);
  stepBait(b, 1, grid(), 0, 2);
  assert.ok(Math.abs(b.z - 10) < 1e-9);
  b.z = BAIT.MAX_RANGE - 0.5;
  assert.equal(stepBait(b, 1, grid(), 0, 2), 2);
});

test('a flying bait does not attract the shark; a floating one does', () => {
  const b = createBaitState(), lure = { active: false, x: 0, z: 0 };
  throwBait(b, 0, 2, 0, 0, 0, 1); syncLure(b, lure); assert.equal(lure.active, false);
  const f = floating(3, 9); syncLure(f, lure); assert.deepEqual(lure, { active: true, x: 3, z: 9 });
  assert.deepEqual(baitNet(f, [0, 0, 0, 0]), [2, 3, 0, 9]);
});

test('shark target override: goes to the bait, circles it and bites it', () => {
  const w = world(), s = createSharkState(null, () => 0.3), bites = [];
  const env = { preys: [], rnd: () => 0.3, lure: { active: true, x: 0, z: 20 }, hooks: { lureBite: (x, z) => bites.push([x, z]) } };
  for (let t = 0; t < 40; t += 0.05) step(s, 0.05, w, env);
  assert.equal(s.state, 'lure'); assert.ok(lured(s));
  const d = Math.hypot(s.x - 0, s.z - 20);
  assert.ok(d < SHARK.LURE_R + 2, 'stays at the bait: ' + d);
  assert.ok(bites.length >= 5, 'bites the bait every few seconds: ' + bites.length);
  assert.ok(bites.every(([x, z]) => x === 0 && z === 20));
  assert.deepEqual(w.tileHp, {}, 'the raft is untouched');
});

test('a raft attack in progress is cancelled by the bait', () => {
  const w = world(), s = createSharkState(null, () => 0.3);
  const env = { preys: [], rnd: () => 0.3, lure: { active: false, x: 0, z: 0 } };
  assert.ok(startAttack(s, w, () => 0.3));
  for (let t = 0; t < 30 && s.state !== 'bite'; t += 0.05) step(s, 0.05, w, env);
  assert.equal(s.state, 'bite');
  for (let t = 0; t < 3; t += 0.05) step(s, 0.05, w, env);
  const hp = { ...w.tileHp };
  assert.ok(Object.keys(hp).length === 1, 'one bite landed');
  env.lure.active = true; env.lure.x = 15; env.lure.z = -15;
  for (let t = 0; t < 30; t += 0.05) step(s, 0.05, w, env);
  assert.equal(s.state, 'lure');
  assert.equal(s.hasTarget, false);
  assert.deepEqual(w.tileHp, hp, 'no more bites on the raft');
});

test('swimmers are ignored while the bait floats', () => {
  const w = world(), s = createSharkState(null, () => 0.3), hurt = [];
  s.x = 8; s.z = 0;
  const env = { preys: [{ x: 9, z: 0, swimming: true }], rnd: () => 0.3, lure: { active: true, x: 0, z: 25 }, hooks: { hurt: (i, n) => hurt.push(n) } };
  for (let t = 0; t < 20; t += 0.05) step(s, 0.05, w, env);
  assert.equal(s.state, 'lure');
  assert.equal(hurt.length, 0);
});

test('attack timer reset: after the bait the next raft attack waits a full interval', () => {
  const w = world(), s = createSharkState({ timer: 5 }, () => 0.3);
  const env = { preys: [], rnd: () => 0.3, lure: { active: true, x: 0, z: 20 } };
  for (let t = 0; t < 20; t += 0.05) step(s, 0.05, w, env); // the bait outlasts the 5 s that were left
  assert.equal(s.state, 'lure');
  env.lure.active = false;
  step(s, 0.05, w, env);
  assert.equal(s.state, 'circle');
  assert.ok(s.timer >= SHARK.ATTACK_EVERY - 0.1, 'a full interval: ' + s.timer);
  let attackAt = -1;
  for (let t = 0; t < SHARK.ATTACK_EVERY + 5; t += 0.05) { step(s, 0.05, w, env); if (s.state === 'approach') { attackAt = t; break; } }
  assert.ok(attackAt >= SHARK.ATTACK_EVERY - 0.5, 'no raft attack sooner than ATTACK_EVERY: ' + attackAt);
});

test('a spear hit while it eats sends it off, but it comes back to the bait', () => {
  const w = world(), s = createSharkState(null, () => 0.3);
  const env = { preys: [], rnd: () => 0.3, lure: { active: true, x: 0, z: 20 } };
  for (let t = 0; t < 20; t += 0.05) step(s, 0.05, w, env);
  hit(s, SHARK.REPEL); assert.equal(s.state, 'flee');
  step(s, 0.05, w, env);
  assert.equal(s.state, 'lure');
});

test('a dead shark ignores the bait', () => {
  const w = world(), s = createSharkState({ dead: true }, () => 0.3);
  step(s, 0.05, w, { preys: [], lure: { active: true, x: 0, z: 20 } });
  assert.equal(s.state, 'dead');
});
