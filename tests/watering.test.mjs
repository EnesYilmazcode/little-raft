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
  assert.deepEqual(r.purifiers, { '1,0': { t: 15, ready: 0 } });
  const neg = W.cleanWatering({ garden: { '0,0': { water: 1, grow: -20 } }, purifiers: { '1,0': { t: 'x', ready: 0 } } }, decor);
  assert.deepEqual(neg.garden, { '0,0': { water: 1, grow: 0 } });
  assert.deepEqual(neg.purifiers, { '1,0': { t: 0, ready: 0 } });
});

test('cleanWatering: normalises ripe / ready / empty entries', () => {
  const decor = mkWorld().decor;
  assert.deepEqual(W.cleanWatering({ garden: { '0,0': { water: 1, grow: 500 } } }, decor).garden, { '0,0': { water: 0, grow: 90 } });
  assert.deepEqual(W.cleanWatering({ purifiers: { '1,0': { t: 2, ready: 1 } } }, decor).purifiers, { '1,0': { t: 15, ready: 1 } });
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

test('purifier: load, 15 ticks to ready, take fresh water', () => {
  const w = mkWorld(), bag = bagFrom([{ kind: 'saltcup', count: 1 }]);
  assert.equal(W.loadPurifier(w, U, bag).ok, true);
  assert.equal(bag.count('saltcup'), 0);
  assert.deepEqual(w.purifiers[U], { t: 0, ready: 0 });
  for (let i = 0; i < 14; i++) assert.deepEqual(W.tick(w, 1).done, []);
  assert.equal(w.purifiers[U].ready, 0);
  assert.deepEqual(W.tick(w, 1).done, [U]);
  const r = W.takeWater(w, U, bag);
  assert.equal(r.ok, true); assert.equal(r.text, '+ 1 cup of fresh water');
  assert.equal(bag.count('freshcup'), 1); assert.equal(w.purifiers[U], undefined);
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
  paintPurifier(g, { t: 3, ready: 0 }, 1.2);
  assert.equal(get('embers').visible, true); assert.equal(get('cupWater').visible, false); assert.equal(get('steam0').visible, true);
  paintPurifier(g, { t: 15, ready: 1 }, 2);
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
