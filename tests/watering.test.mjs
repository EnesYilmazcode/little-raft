// Unit tests for dist/watering.js (purifier, cups, palm watering) and dist/purifier-model.js.
// Run: node --test tests/watering.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const W = await import(new URL('watering.js', base));
const { Bag, SLOT_COUNT, RECIPES, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const { createPurifier, paintPurifier, preparePlanter, paintPlanter } = await import(new URL('purifier-model.js', base));
const { createCraft } = await import(new URL('crafts.js', base));

const bagFrom = (slots, selected = 0) => {
  const s = new Array(SLOT_COUNT).fill(null);
  slots.forEach((v, i) => { s[i] = v; });
  return new Bag({ slots: s, selected });
};
const fullBag = (first) => bagFrom([first, ...Array.from({ length: SLOT_COUNT - 1 }, () => ({ kind: 'scrap', count: 20 }))]);
const mkWorld = (extra = {}) => ({
  decor: [{ type: 'palm', x: 0, z: 0 }, { type: 'purifier', x: 1, z: 0 }, { type: 'bench', x: 0, z: 1 }],
  garden: {}, purifiers: {}, ...extra,
});
const P = '0,0', U = '1,0';

test('cleanWatering: missing / null / array input gives empty maps', () => {
  const decor = mkWorld().decor;
  for (const v of [undefined, null, [], {}, { garden: null, purifiers: [] }, { garden: [1], purifiers: 'x' }]) {
    assert.deepEqual(W.cleanWatering(v, decor), { garden: {}, purifiers: {} });
  }
});

test('cleanWatering: bad keys, bad fields, clamping and decor checks', () => {
  const decor = mkWorld().decor;
  const r = W.cleanWatering({
    garden: { '0,0': { water: 1, grow: 30.7 }, 'a,b': { water: 1, grow: 5 }, '0,1': { water: 1, grow: 5 }, '1,0': { water: 1, grow: 5 }, '5,5': { water: 1, grow: 5 } },
    purifiers: { '1,0': { t: 99, ready: 0 }, '0,0': { t: 3, ready: 0 }, ' 1,0': { t: 1, ready: 0 } },
  }, decor);
  assert.deepEqual(r.garden, { '0,0': { water: 1, grow: 30 } });
  assert.deepEqual(r.purifiers, { '1,0': { cup: 1, t: 30, ready: 0, fuel: 1, burn: 0 } }); // legacy entry: cup in, one free plank
  const neg = W.cleanWatering({ garden: { '0,0': { water: 1, grow: -20 } }, purifiers: { '1,0': { t: 'x', ready: 0 } } }, decor);
  assert.deepEqual(neg.garden, { '0,0': { water: 1, grow: 0 } });
  assert.deepEqual(neg.purifiers, { '1,0': { cup: 1, t: 0, ready: 0, fuel: 1, burn: 0 } });
  const nu = W.cleanWatering({ purifiers: { '1,0': { cup: 1, t: 12, ready: 0, fuel: 9, burn: 99 } } }, decor);
  assert.deepEqual(nu.purifiers, { '1,0': { cup: 1, t: 12, ready: 0, fuel: 3, burn: 50 } });
  const fuelOnly = W.cleanWatering({ purifiers: { '1,0': { cup: 0, t: 12, ready: 1, fuel: 2, burn: 'x' } } }, decor);
  assert.deepEqual(fuelOnly.purifiers, { '1,0': { cup: 0, t: 0, ready: 0, fuel: 2, burn: 0 } });
  assert.deepEqual(W.cleanWatering({ purifiers: { '1,0': { cup: 0, fuel: 0, burn: 0 } } }, decor).purifiers, {});
});

test('cleanWatering: normalises ripe / ready / empty entries', () => {
  const decor = mkWorld().decor;
  assert.deepEqual(W.cleanWatering({ garden: { '0,0': { water: 1, grow: 500 } } }, decor).garden, { '0,0': { water: 0, grow: 90 } });
  assert.deepEqual(W.cleanWatering({ purifiers: { '1,0': { t: 2, ready: 1 } } }, decor).purifiers, { '1,0': { cup: 1, t: 30, ready: 1, fuel: 0, burn: 0 } }); // legacy ready cup: no plank needed
  assert.deepEqual(W.cleanWatering({ garden: { '0,0': { water: 0, grow: 0 } } }, decor).garden, {});
});

test('cleanWatering seedMissing: old saves get ripe palms; saves with a garden field are untouched', () => {
  const decor = [{ type: 'palm', x: 0, z: 0 }, { type: 'palm', x: 2, z: -1 }, { type: 'purifier', x: 1, z: 0 }];
  assert.deepEqual(W.cleanWatering({ tiles: [] }, decor, { seedMissing: true }).garden, { '0,0': { water: 0, grow: 90 }, '2,-1': { water: 0, grow: 90 } });
  assert.deepEqual(W.cleanWatering({ garden: {} }, decor, { seedMissing: true }).garden, {});
  assert.deepEqual(W.cleanWatering({ garden: null }, decor, { seedMissing: true }).garden, {});
  assert.deepEqual(W.cleanWatering({ tiles: [] }, decor).garden, {});
});

test('tick: dry planter stays; watered planter ripens at 90 s; dt floored and clamped', () => {
  const w = mkWorld();
  W.tick(w, 30); assert.equal(W.plantStage(w.garden[P]), 0); assert.equal(w.garden[P], undefined);
  w.garden[P] = { water: 1, grow: 0 };
  assert.deepEqual(W.tick(w, .9), { grown: [], ripe: [], done: [] });
  assert.equal(w.garden[P].grow, 0);
  let ripeCount = 0, r;
  for (let i = 0; i < 44; i++) { r = W.tick(w, 1); ripeCount += r.ripe.length; }
  assert.equal(W.plantStage(w.garden[P]), 0);
  r = W.tick(w, 1); assert.deepEqual(r.grown, [P]); assert.equal(W.plantStage(w.garden[P]), 1);
  for (let i = 0; i < 44; i++) { r = W.tick(w, 1); ripeCount += r.ripe.length; }
  r = W.tick(w, 1); ripeCount += r.ripe.length;
  assert.deepEqual(r.ripe, [P]); assert.equal(W.plantStage(w.garden[P]), 2); assert.equal(w.garden[P].water, 0);
  for (let i = 0; i < 5; i++) ripeCount += W.tick(w, 1).ripe.length;
  assert.equal(ripeCount, 1);
  const w2 = mkWorld({ garden: { [P]: { water: 1, grow: 0 } } });
  W.tick(w2, 1e6); assert.equal(w2.garden[P].grow, 60);
});

test('tick prunes entries whose decor was removed', () => {
  const w = mkWorld({ garden: { [P]: { water: 1, grow: 10 } }, purifiers: { [U]: { t: 3, ready: 0 } } });
  w.decor = w.decor.filter(d => d.type === 'bench');
  W.tick(w, 1);
  assert.deepEqual(w.garden, {}); assert.deepEqual(w.purifiers, {});
});

test('purifier: load, add a plank, 30 ticks to ready, take fresh water; leftover fire stays', () => {
  assert.equal(W.PURIFY_SECONDS, 30); assert.equal(W.PLANK_SECONDS, 50); assert.equal(W.PURIFIER_FUEL_MAX, 3);
  const w = mkWorld(), bag = bagFrom([{ kind: 'saltcup', count: 1 }, { kind: 'wood', count: 1 }]);
  const r0 = W.loadPurifier(w, U, bag);
  assert.equal(r0.ok, true); assert.equal(r0.text, 'Sea water in. Add a plank to light the fire');
  assert.equal(bag.count('saltcup'), 0);
  assert.deepEqual(w.purifiers[U], { cup: 1, t: 0, ready: 0, fuel: 0, burn: 0 });
  W.tick(w, 10); assert.equal(w.purifiers[U].t, 0, 'no fuel: no progress');
  assert.equal(W.fuelPurifier(w, U, bag).text, 'Added fuel (1/3)'); assert.equal(bag.count('wood'), 0);
  for (let i = 0; i < 29; i++) assert.deepEqual(W.tick(w, 1).done, []);
  assert.equal(w.purifiers[U].ready, 0); assert.equal(w.purifiers[U].fuel, 0); assert.equal(w.purifiers[U].burn, 21);
  assert.deepEqual(W.tick(w, 1).done, [U]);
  W.tick(w, 20); assert.equal(w.purifiers[U].burn, 20, 'fuel burns only while purifying');
  const r = W.takeWater(w, U, bag);
  assert.equal(r.ok, true); assert.equal(r.text, '+ 1 cup of fresh water');
  assert.equal(bag.count('freshcup'), 1); assert.deepEqual(w.purifiers[U], { cup: 0, t: 0, ready: 0, fuel: 0, burn: 20 });
  // the part-burnt plank carries the next cup 20 s, then pauses
  const b2 = bagFrom([{ kind: 'saltcup', count: 1 }]);
  assert.equal(W.loadPurifier(w, U, b2).text, 'The purifier is bubbling away');
  W.tick(w, 25); assert.equal(w.purifiers[U].t, 20); assert.equal(w.purifiers[U].burn, 0); assert.equal(W.purifierBurning(w.purifiers[U]), false);
  W.tick(w, 60); assert.equal(w.purifiers[U].t, 20, 'paused');
});

test('purifier fuel: one plank per add, max 3, planks feed the fire in turn', () => {
  const w = mkWorld(), bag = bagFrom([{ kind: 'wood', count: 5 }, { kind: 'saltcup', count: 3 }]);
  for (let i = 1; i <= 3; i++) assert.equal(W.fuelPurifier(w, U, bag).text, `Added fuel (${i}/3)`);
  const full = W.fuelPurifier(w, U, bag); assert.equal(full.ok, false); assert.equal(full.reason, 'fuelfull'); assert.equal(bag.count('wood'), 2);
  assert.deepEqual(w.purifiers[U], { cup: 0, t: 0, ready: 0, fuel: 3, burn: 0 });
  W.tick(w, 60); assert.equal(w.purifiers[U].fuel, 3, 'idle: nothing burns');
  // three planks = 150 s of fire = five cups
  let cups = 0;
  for (let n = 0; n < 6; n++) {
    if (!w.purifiers[U]?.cup) { if (!bag.count('saltcup')) bag.add('saltcup', 1); W.loadPurifier(w, U, bag); }
    for (let i = 0; i < 30; i++) W.tick(w, 1);
    if (w.purifiers[U].ready) { cups++; W.takeWater(w, U, bag); }
  }
  assert.equal(cups, 5); assert.equal(w.purifiers[U].cup, 1); assert.equal(w.purifiers[U].t, 0);
  assert.equal(W.fuelPurifier(w, '0,0', bag).reason, 'notarget');
  assert.equal(W.fuelPurifier(mkWorld(), U, bagFrom([])).reason, 'nowood');
});

test('purifierTarget: prompts for fuel, pour, purify, pause and take; repeat answers are reused', () => {
  const at = { x: 1, z: 0 }, T_ = W.purifierTarget;
  assert.equal(T_(null, 'wood', at).prompt, '<kbd>E</kbd>Add fuel (0/3)');
  assert.deepEqual(T_(null, 'wood', at).e, { kind: 'fuelPurifier', x: 1, z: 0 });
  assert.equal(T_(null, 'saltcup', at).prompt, '<kbd>E</kbd>Pour in sea water');
  assert.equal(T_(null, null, at).e, null);
  assert.equal(T_({ cup: 0, t: 0, ready: 0, fuel: 2, burn: 0 }, 'wood', at).prompt, '<kbd>E</kbd>Add fuel (2/3)');
  assert.match(T_({ cup: 0, t: 0, ready: 0, fuel: 3, burn: 0 }, 'wood', at).prompt, /needs a cup of sea water · fuel 3\/3/);
  assert.equal(T_({ cup: 1, t: 10, ready: 0, fuel: 1, burn: 3 }, null, at).prompt, 'Purifying… 20s · fuel 1/3');
  assert.match(T_({ cup: 1, t: 10, ready: 0, fuel: 0, burn: 0 }, null, at).prompt, /out of fuel/);
  assert.equal(T_({ cup: 1, t: 10, ready: 0, fuel: 0, burn: 0 }, 'wood', at).e.kind, 'fuelPurifier');
  const ready = T_({ cup: 1, t: 30, ready: 1, fuel: 0, burn: 5 }, 'wood', at);
  assert.equal(ready.e.kind, 'takeWater'); assert.equal(ready.click, null);
  assert.equal(T_({ cup: 1, t: 30, ready: 1, fuel: 0, burn: 5 }, 'cup', at).click.kind, 'takeWater');
  assert.equal(T_({ cup: 1, t: 11, ready: 0, fuel: 1, burn: 3 }, null, at), T_({ cup: 1, t: 11, ready: 0, fuel: 1, burn: 9 }, null, at), 'cached');
  assert.notEqual(T_({ cup: 1, t: 11, ready: 0, fuel: 1, burn: 3 }, null, at), T_({ cup: 1, t: 11, ready: 0, fuel: 1, burn: 3 }, null, { x: 2, z: 0 }));
});

test('old saves: a cup mid-purify gets one plank and finishes', () => {
  const w = mkWorld({ purifiers: { [U]: { t: 5, ready: 0 } } });
  Object.assign(w, W.cleanWatering(w, w.decor));
  let done = 0; for (let i = 0; i < 40; i++) done += W.tick(w, 1).done.length;
  assert.equal(done, 1); assert.equal(w.purifiers[U].ready, 1); assert.equal(w.purifiers[U].burn, 25);
});

test('refusals leave the bag and world unchanged', () => {
  const check = (fn, reason, world, bag) => {
    const before = JSON.stringify(bag.snapshot()), wBefore = JSON.stringify(world);
    const r = fn();
    assert.equal(r.ok, false); assert.equal(r.reason, reason); assert.equal(typeof r.text, 'string');
    assert.equal(JSON.stringify(bag.snapshot()), before); assert.equal(JSON.stringify(world), wBefore);
  };
  const w = mkWorld({ garden: { [P]: { water: 1, grow: 10 } }, purifiers: { [U]: { t: 3, ready: 0 } } });
  const bag = bagFrom([{ kind: 'saltcup', count: 1 }, { kind: 'freshcup', count: 2 }]);
  check(() => W.fillCup(w, bag), 'nocup', w, bag);
  check(() => W.loadPurifier(w, U, bag), 'busy', w, bag);
  check(() => W.takeWater(w, U, bag), 'notready', w, bag);
  check(() => W.water(w, P, bag), 'watered', w, bag);
  check(() => W.harvest(w, P, bag, () => 0), 'notripe', w, bag);
  check(() => W.water(w, '0,1', bag), 'notarget', w, bag);
  const ripe = mkWorld({ garden: { [P]: { water: 0, grow: 90 } } });
  check(() => W.water(ripe, P, bag), 'ripe', ripe, bag);
});

test('swapOne keeps the item in hand; full bag refuses', () => {
  const w = mkWorld(), bag = bagFrom([null, null, { kind: 'cup', count: 1 }], 2);
  assert.equal(W.fillCup(w, bag).ok, true);
  assert.deepEqual(bag.slots[2], { kind: 'saltcup', count: 1 });
  const full = fullBag({ kind: 'cup', count: 3 }), before = JSON.stringify(full.snapshot());
  const r = W.fillCup(w, full);
  assert.equal(r.reason, 'full'); assert.equal(r.text, 'Your bag is full');
  assert.equal(JSON.stringify(full.snapshot()), before);
  const stack = bagFrom([{ kind: 'cup', count: 3 }]);
  assert.equal(W.fillCup(w, stack).ok, true);
  assert.equal(stack.count('cup'), 2); assert.equal(stack.count('saltcup'), 1);
});

test('water turns a fresh cup back into a cup and starts growth', () => {
  const w = mkWorld(), bag = bagFrom([{ kind: 'freshcup', count: 1 }]);
  const r = W.water(w, P, bag);
  assert.equal(r.ok, true); assert.equal(r.text, 'The planter drinks it up');
  assert.deepEqual(bag.slots[0], { kind: 'cup', count: 1 });
  assert.deepEqual(w.garden[P], { water: 1, grow: 0 });
});

test('harvest: bonus wood by rng, leaves only otherwise, full bag keeps plant ripe', () => {
  const ripe = () => mkWorld({ garden: { [P]: { water: 0, grow: 90 } } });
  let w = ripe(), bag = bagFrom([]), calls = 0;
  let r = W.harvest(w, P, bag, () => { calls++; return .1; });
  assert.equal(r.ok, true); assert.equal(r.text, '+ 2 palm leaf · 1 wood'); assert.equal(calls, 1);
  assert.equal(bag.count('leaf'), 2); assert.equal(bag.count('wood'), 1); assert.equal(w.garden[P], undefined);
  w = ripe(); bag = bagFrom([]);
  r = W.harvest(w, P, bag, () => .9);
  assert.equal(r.text, '+ 2 palm leaf'); assert.equal(bag.count('leaf'), 2); assert.equal(bag.count('wood'), 0);
  w = ripe(); const full = fullBag({ kind: 'cup', count: 1 }), before = JSON.stringify(full.snapshot()); calls = 0;
  r = W.harvest(w, P, full, () => { calls++; return .9; });
  assert.equal(r.reason, 'full'); assert.equal(calls, 1);
  assert.equal(JSON.stringify(full.snapshot()), before); assert.equal(W.plantStage(w.garden[P]), 2);
});

test('determinism: identical worlds and tick sequences end equal', () => {
  const a = mkWorld({ garden: { [P]: { water: 1, grow: 3 } }, purifiers: { [U]: { t: 1, ready: 0 } } });
  const b = JSON.parse(JSON.stringify(a));
  for (const dt of [1, 2.5, .3, 60, 7, 1e9, 1]) { W.tick(a, dt); W.tick(b, dt); }
  assert.deepEqual(a, b);
});

test('copyWatering deep-copies and defaults', () => {
  const w = mkWorld({ garden: { [P]: { water: 1, grow: 3 } } });
  const c = W.copyWatering(w);
  c.garden[P].grow = 50;
  assert.equal(w.garden[P].grow, 3);
  assert.deepEqual(W.copyWatering({}), { garden: {}, purifiers: {} });
  assert.deepEqual(W.copyWatering(null), { garden: {}, purifiers: {} });
});

test('recipes and ITEM_INFO for cups and purifier', () => {
  for (const k of ['cup', 'saltcup', 'freshcup', 'purifier']) assert.ok(ITEM_INFO[k], k);
  assert.deepEqual({ ...RECIPES.cup.cost }, { plastic: 4 });
  assert.deepEqual({ ...RECIPES.purifier.cost }, { wood: 6, leaf: 6, plastic: 4 });
  assert.equal(RECIPES.saltcup, undefined); assert.equal(RECIPES.freshcup, undefined);
  const bag = bagFrom([{ kind: 'plastic', count: 8 }, { kind: 'wood', count: 6 }, { kind: 'leaf', count: 6 }]);
  assert.equal(bag.craft('cup').ok, true); assert.equal(bag.count('cup'), 1);
  assert.equal(bag.craft('purifier').ok, true); assert.equal(bag.count('purifier'), 1);
  const snap = bagFrom([{ kind: 'cup', count: 5 }, { kind: 'saltcup', count: 2 }, { kind: 'freshcup', count: 1 }, { kind: 'purifier', count: 3 }]).snapshot();
  assert.doesNotThrow(() => new Bag(snap));
});

test('purifier-model: named meshes and state painting', () => {
  const g = createPurifier(T);
  assert.equal(g.name, 'craft_purifier'); assert.equal(g.userData.craftType, 'purifier');
  for (const n of ['purifierBase', 'purifierLegs', 'purifierRing', 'fireTray', 'embers', 'pot', 'potWater', 'spout', 'shelf', 'cup', 'cupWater', 'steam0', 'steam1', 'steam2']) assert.ok(g.getObjectByName(n), n);
  const box = new T.Box3().setFromObject(g), size = box.getSize(new T.Vector3());
  assert.ok(size.x <= .9 && size.z <= .6 && size.y <= .85, JSON.stringify(size));
  const get = n => g.getObjectByName(n);
  paintPurifier(g, null, 0);
  assert.equal(get('embers').visible, false); assert.equal(get('cup').visible, false); assert.equal(get('potWater').visible, false);
  paintPurifier(g, { cup: 1, t: 3, ready: 0, fuel: 1, burn: 10 }, 1.2);
  assert.equal(get('embers').visible, true); assert.equal(get('flame').visible, true); assert.equal(get('cupWater').visible, false); assert.equal(get('steam0').visible, true);
  assert.deepEqual(get('fuelPlanks').children.map(m => m.visible), [true, false, false]);
  paintPurifier(g, { cup: 1, t: 3, ready: 0, fuel: 0, burn: 0 }, 1.3); // paused: no fire, cup still in
  assert.equal(get('embers').visible, false); assert.equal(get('flame').visible, false); assert.equal(get('cup').visible, true); assert.equal(get('steam0').visible, false);
  paintPurifier(g, { cup: 0, t: 0, ready: 0, fuel: 3, burn: 0 }, 1.4); // fuel only: planks shown, unlit
  assert.deepEqual(get('fuelPlanks').children.map(m => m.visible), [true, true, true]); assert.equal(get('flame').visible, false); assert.equal(get('cup').visible, false);
  paintPurifier(g, { cup: 1, t: 30, ready: 1, fuel: 0, burn: 4 }, 2);
  assert.equal(get('embers').visible, false); assert.equal(get('cupWater').visible, true); assert.equal(get('cup').visible, true); assert.equal(get('steam1').visible, false);
});

test('purifier-model: planter stages', () => {
  const g = createCraft(T, 'palm');
  preparePlanter(T, g);
  const pivot = g.getObjectByName('plantPivot');
  assert.ok(pivot); assert.ok(pivot.getObjectByName('trunk'));
  paintPlanter(g, 0, false);
  assert.equal(pivot.scale.x, .7); assert.equal(g.getObjectByName('coconuts').visible, false);
  paintPlanter(g, 2, true);
  assert.equal(pivot.scale.x, 1); assert.equal(g.getObjectByName('coconuts').visible, true);
  assert.equal(g.getObjectByName('soil').material.color.getHex(), 0x2e1f14);
  const plain = new T.Group(); assert.doesNotThrow(() => { preparePlanter(T, plain); paintPlanter(plain, 1, false); });
});
