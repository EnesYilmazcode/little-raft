// Unit tests for the farming growth state machine (dist/farming.js).
// Run: node --test tests/farming.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const F = await import(new URL('farming.js', base));
const { Bag, SLOT_COUNT, ITEM_INFO, RECIPES } = await import(new URL('inventory-state.js', base));

const bagWith = (items) => { const s = new Array(SLOT_COUNT).fill(null); items.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected: 0 }); };
const worldWith = (farm) => ({ decor: [{ type: 'palm', x: 0, z: 0, ...(farm === undefined ? {} : { farm }) }] });
const at = { x: 0, z: 0 };

test('a new planter holds a dry seedling, not a grown palm', () => {
  const p = F.newPlant();
  assert.equal(p.s, F.SEEDLING); assert.equal(p.w, 0); assert.equal(F.isWet(p), false);
  assert.equal(F.progress(p), 0);
});

test('a placed planter is empty: a seed makes the seedling, water alone does nothing', () => {
  const p = F.newPlanter();
  assert.equal(p.s, F.EMPTY); assert.equal(F.plotAction(p, 'water'), null);
  const w = worldWith(p), bag = bagWith([{ kind: 'seed', count: 1 }]);
  assert.equal(F.applyFarmAction(w, bag, { op: 'plant', ...at }).ok, true);
  assert.equal(w.decor[0].farm.s, F.SEEDLING); assert.equal(bag.count('seed'), 0);
});

test('a dry plant never grows, however long it waits', () => {
  const p = F.newPlant();
  for (let i = 0; i < 1000; i++) assert.equal(F.tickPlant(p, 1), false);
  assert.deepEqual(p, F.newPlant());
});

test('watered plants grow through every stage and stop at mature', () => {
  const p = F.newPlant(); p.w = 1e9; // test-only: endless water
  const seen = [p.s];
  for (let i = 0; i < F.STAGE_SECONDS * 5; i++) if (F.tickPlant(p, 1)) seen.push(p.s);
  assert.deepEqual([...new Set(seen)], [0, 1, 2, 3]);
  assert.equal(p.s, F.MATURE); assert.equal(p.g, 0); assert.equal(F.progress(p), 1);
});

test('growth pauses when the water runs out and resumes when watered', () => {
  const p = F.newPlant(); p.w = F.WATER_SECONDS;
  let dried = false;
  for (let i = 0; i < F.WATER_SECONDS; i++) dried = F.tickPlant(p, 1) || dried;
  assert.ok(dried, 'reports the soil drying');
  const grown = F.WATER_SECONDS;
  assert.equal(p.s * F.STAGE_SECONDS + p.g, grown);
  F.tickPlant(p, 500);
  assert.equal(p.s * F.STAGE_SECONDS + p.g, grown, 'no growth while dry');
  p.w = F.WATER_SECONDS; F.tickPlant(p, F.WATER_SECONDS);
  assert.equal(p.s, F.MATURE, 'two cups grow a palm');
});

test('a large dt only grows by the water it had', () => {
  const p = F.newPlant(); p.w = 30;
  F.tickPlant(p, 400);
  assert.equal(p.s, 0); assert.equal(p.g, 30); assert.equal(p.w, 0);
});

test('cleanPlant: legacy planters load as mature, bad values are clamped', () => {
  assert.equal(F.cleanPlant(undefined).s, F.MATURE);
  assert.equal(F.cleanPlant({ s: 9 }).s, F.MATURE);
  assert.equal(F.cleanPlant('x').s, F.MATURE);
  assert.deepEqual(F.cleanPlant({ s: 1, g: -4, w: 1e6, h: 2.5 }), { s: 1, g: 0, w: F.WATER_SECONDS, h: 0 });
  assert.deepEqual(F.cleanPlant({ s: -1, g: 3, w: 4, h: 2 }), { s: -1, g: 3, w: 4, h: 2 });
  const decor = F.normalizeDecor([{ type: 'palm', x: 1, z: 0 }, { type: 'sail', x: 0, z: 0 }]);
  assert.equal(decor[0].farm.s, F.MATURE); assert.equal(decor[1].farm, undefined);
});

test('farm state survives a JSON round trip (save and co-op snapshot)', () => {
  const w = worldWith(F.newPlant()); w.decor[0].farm.w = 40; F.tickFarm(w.decor, 12);
  const back = JSON.parse(JSON.stringify(w)).decor[0];
  assert.deepEqual(F.cleanPlant(back.farm), w.decor[0].farm);
});

test('fill turns a Filter Cup into fresh water; water empties back into a cup', () => {
  const w = worldWith(F.newPlant()), bag = bagWith([{ kind: 'cup', count: 1 }]);
  assert.equal(F.applyFarmAction(w, bag, { op: 'fill' }).ok, true);
  assert.equal(bag.count('cup'), 0); assert.equal(bag.count('water'), 1);
  const r = F.applyFarmAction(w, bag, { op: 'water', ...at });
  assert.equal(r.ok, true); assert.equal(r.changed, true);
  assert.equal(bag.count('water'), 0); assert.equal(bag.count('cup'), 1);
  assert.equal(w.decor[0].farm.w, F.WATER_SECONDS);
  bag.slots[1] = { kind: 'water', count: 1 };
  assert.equal(F.applyFarmAction(w, bag, { op: 'water', ...at }).ok, false, 'wet soil refuses more water');
  assert.equal(bag.count('water'), 1);
});

test('harvest only a mature palm; it gives leaves and a seed and empties the planter', () => {
  const w = worldWith(F.newPlant()), bag = bagWith([]);
  assert.equal(F.applyFarmAction(w, bag, { op: 'harvest', ...at }).ok, false);
  w.decor[0].farm.s = F.MATURE;
  const r = F.applyFarmAction(w, bag, { op: 'harvest', ...at });
  assert.equal(r.ok, true); assert.deepEqual(r.items, { ...F.HARVEST });
  assert.equal(bag.count('leaf'), F.HARVEST.leaf); assert.equal(bag.count('seed'), F.HARVEST.seed);
  assert.equal(w.decor[0].farm.s, F.EMPTY); assert.equal(w.decor[0].farm.h, 1);
  assert.equal(F.applyFarmAction(w, bag, { op: 'harvest', ...at }).ok, false);
});

test('replanting needs a seed and an empty planter, and starts a seedling', () => {
  const w = worldWith({ s: F.EMPTY, g: 0, w: 20, h: 1 }), bag = bagWith([{ kind: 'seed', count: 2 }]);
  const r = F.applyFarmAction(w, bag, { op: 'plant', ...at });
  assert.equal(r.ok, true); assert.equal(bag.count('seed'), 1);
  assert.equal(w.decor[0].farm.s, F.SEEDLING); assert.equal(w.decor[0].farm.w, 20, 'keeps soil moisture');
  assert.equal(F.applyFarmAction(w, bag, { op: 'plant', ...at }).ok, false);
  assert.equal(bag.count('seed'), 1);
});

test('a full bag blocks harvest without losing the palm', () => {
  const full = Array.from({ length: SLOT_COUNT }, () => ({ kind: 'wood', count: 20 }));
  const w = worldWith(undefined), bag = bagWith(full);
  const r = F.applyFarmAction(w, bag, { op: 'harvest', ...at });
  assert.equal(r.ok, false); assert.equal(r.effect, 'full');
  assert.equal(w.decor[0].farm.s, F.MATURE);
});

test('legacy planter with no farm field can be harvested', () => {
  const w = worldWith(undefined), bag = bagWith([]);
  assert.equal(F.applyFarmAction(w, bag, { op: 'harvest', ...at }).ok, true);
});

test('plotAction picks the right verb for the held item', () => {
  assert.equal(F.plotAction({ s: -1, w: 0 }, 'seed'), 'plant');
  assert.equal(F.plotAction({ s: -1, w: 0 }, 'water'), null);
  assert.equal(F.plotAction({ s: 1, w: 0 }, 'water'), 'water');
  assert.equal(F.plotAction({ s: 1, w: F.WATER_SECONDS }, 'water'), null);
  assert.equal(F.plotAction({ s: 3, w: 0 }, 'hammer'), null, 'clicking does not harvest');
  assert.equal(F.plotAction({ s: 3, w: 0 }, 'hook', true), 'harvest');
});

test('bag knows the farm items and the cup recipe', () => {
  for (const [k, v] of Object.entries(F.FARM_ITEMS)) assert.equal(ITEM_INFO[k]?.name, v.name, k);
  assert.deepEqual({ ...RECIPES.cup.cost }, { ...F.FARM_RECIPES.cup });
});

test('farmSignature changes on stage and wet, not on growth seconds', () => {
  const w = worldWith(F.newPlant()); w.decor[0].farm.w = 80;
  const a = F.farmSignature(w.decor); F.tickFarm(w.decor, 5);
  assert.equal(F.farmSignature(w.decor), a);
  F.tickFarm(w.decor, F.STAGE_SECONDS);
  assert.notEqual(F.farmSignature(w.decor), a);
});

test('watering with a full bag: the empty cup goes into the water slot or merges, never lost', () => {
  const full = Array.from({ length: SLOT_COUNT }, () => ({ kind: 'wood', count: 20 }));
  const bagOf = () => new Bag({ slots: full.map((s) => ({ ...s })), selected: 3 });
  full[3] = { kind: 'water', count: 1 };
  let w = worldWith(F.newPlant()), bag = bagOf();
  assert.equal(F.applyFarmAction(w, bag, { op: 'water', ...at }).ok, true);
  assert.deepEqual({ ...bag.slots[3] }, { kind: 'cup', count: 1 }, 'cup is back in hand');
  // A partly used stack with no room for the empty cup: refused, nothing is lost.
  full[3] = { kind: 'water', count: 3 };
  w = worldWith(F.newPlant()); bag = bagOf();
  assert.equal(F.applyFarmAction(w, bag, { op: 'water', ...at }).ok, false);
  assert.equal(bag.count('water'), 3); assert.equal(w.decor[0].farm.w, 0);
  // An existing cup stack takes the empty cup.
  full[4] = { kind: 'cup', count: 1 };
  w = worldWith(F.newPlant()); bag = bagOf();
  assert.equal(F.applyFarmAction(w, bag, { op: 'water', ...at }).ok, true);
  assert.equal(bag.count('cup'), 2); assert.equal(bag.count('water'), 2);
});

test('the planter ghost is the empty pot that gets placed, not a grown palm', async () => {
  const T = await import(new URL('vendor/three.module.js', base));
  const { createFarmView } = await import(new URL('farming-view.js', base));
  const view = createFarmView(T), ghost = view.ghostModel();
  const h = new T.Box3().setFromObject(ghost).getSize(new T.Vector3()).y;
  assert.ok(h > .3 && h < .7, `ghost is pot-sized (${h.toFixed(2)} m)`);
  view.sync([{ type: 'palm', x: 0, z: 0 }]);
  const mats = new Set(); view.group.traverse((o) => { if (o.isMesh) mats.add(o.material); });
  assert.ok(mats.size > 0);
  ghost.traverse((o) => { if (o.isMesh) assert.ok(!mats.has(o.material), 'ghost owns its materials'); });
});
