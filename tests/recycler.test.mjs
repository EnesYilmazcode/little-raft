// Sorting Tub (recycler) + floating junk: items, StationModel extra recipes, game.js hooks, models.
// Run: node --test tests/recycler.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from '../dist/vendor/three.module.js';
import { ITEMS, RECYCLE_YIELDS, JUNK_IDS, stationExtraRecipes, stationRecipeFor, BLOCK_RADII, recipeTable, fuelValue } from '../dist/items.js';
import { StationModel } from '../dist/smelter.js';
import { hasModel, buildModel } from '../dist/models.js';
import { createRecyclerModel } from '../dist/recycler-model.js';
import { ITEM_ICONS } from '../dist/item-svg.js';
import { ITEM_TEXT, ITEM_SOURCE } from '../dist/craft-book.js';

const JUNK = ['oldboot', 'tincan', 'seajar'];
const GAME = readFileSync(new URL('../dist/game.js', import.meta.url), 'utf8');

test('recycler: junk items are START materials with stack 20 and real tips', () => {
  for (const id of JUNK) {
    const it = ITEMS[id];
    assert.ok(it, id);
    assert.equal(it.category, 'material');
    assert.equal(it.unlock.type, 'start');
    assert.equal(it.stack, 20);
    assert.equal(it.recipe, null);
    assert.ok(it.tip.length > 10, id + ' tip');
    assert.ok(ITEM_ICONS[id], id + ' icon');
    assert.ok(ITEM_TEXT[id]?.desc && ITEM_TEXT[id]?.use, id + ' text');
    assert.equal(ITEM_SOURCE[id]?.tag, 'found floating');
  }
  assert.ok(!ITEMS.bottle && !ITEMS.can && !ITEMS.junk);
});

test('recycler: station row, unlock, recipe and radius', () => {
  const r = ITEMS.recycler;
  assert.equal(r.name, 'Sorting Tub');
  assert.equal(r.category, 'station');
  assert.ok(r.placeable);
  assert.deepEqual(r.unlock, { type: 'discover', items: ['nail'] });
  assert.deepEqual({ ...r.recipe.cost }, { wood: 6, rope: 2, nail: 3 });
  assert.equal(r.recipe.station, null);
  assert.ok(recipeTable().recycler);
  assert.equal(BLOCK_RADII.recycler, 0.45);
  assert.ok(ITEM_ICONS.recycler && ITEM_TEXT.recycler);
});

test('recycler: yields are frozen, fixed and give gathered materials', () => {
  assert.ok(Object.isFrozen(RECYCLE_YIELDS) && Object.isFrozen(JUNK_IDS));
  assert.deepEqual([...JUNK_IDS].sort(), [...JUNK].sort());
  assert.deepEqual(RECYCLE_YIELDS.tincan, { kind: 'scrap', count: 2, time: 12 });
  assert.deepEqual(RECYCLE_YIELDS.oldboot, { kind: 'plastic', count: 2, time: 10 });
  assert.deepEqual(RECYCLE_YIELDS.seajar, { kind: 'sand', count: 2, time: 10 });
  for (const y of Object.values(RECYCLE_YIELDS)) {
    assert.ok(ITEMS[y.kind], y.kind);
    assert.equal(ITEMS[y.kind].recipe, null, y.kind + ' stays gathered');
  }
  const x = stationExtraRecipes('recycler');
  assert.ok(Object.isFrozen(x));
  assert.deepEqual(x.tincan, { kind: 'scrap', in: 1, count: 2, time: 12, fuel: 0 });
  for (const s of ['smelter', 'grill', 'purifier', 'researchtable', 'nope', undefined]) assert.equal(stationExtraRecipes(s), null);
  assert.equal(stationRecipeFor('recycler', 'tincan'), null, 'stationRecipeFor stays ITEMS-only');
});

test('recycler: StationModel accepts junk only and sorts without fuel', () => {
  const st = new StationModel('recycler');
  for (const k of JUNK) assert.ok(st.accepts(k), k);
  assert.ok(!st.accepts('wood') && !st.accepts('fish') && !st.accepts('sand'));
  assert.equal(st.usesFuel, false);
  assert.equal(st.addFuel('wood', 3), 0);
  assert.equal(st.fuelUnits, 0);
  assert.equal(st.insert('wood', 1), 0);
  assert.equal(st.insert('tincan', 1), 1);
  assert.ok(st.cooking);
  const ev = st.tick(12);
  assert.deepEqual(ev, [{ type: 'done', kind: 'scrap', count: 2 }]);
  assert.deepEqual(st.output, { kind: 'scrap', count: 2 });
  assert.equal(st.input, null);
  assert.equal(st.fuelUnits, 0);
  assert.ok(!st.cooking);
  // three boots, 30 s -> 6 plastic
  const b = new StationModel('recycler');
  b.insert('oldboot', 3);
  b.tick(10); b.tick(10); b.tick(9.5);
  assert.deepEqual(b.output, { kind: 'plastic', count: 4 });
  b.tick(0.5);
  assert.deepEqual(b.output, { kind: 'plastic', count: 6 });
});

test('recycler: snapshot round trip keeps output and progress; bad kinds dropped', () => {
  const st = new StationModel('recycler');
  st.insert('tincan', 2); st.tick(12); st.tick(5);
  const snap = JSON.parse(JSON.stringify(st.snapshot()));
  assert.deepEqual(Object.keys(snap).sort(), ['fuel', 'input', 'output', 'progress', 'station']);
  const r = new StationModel('recycler', snap);
  assert.deepEqual(r.output, { kind: 'scrap', count: 2 });
  assert.deepEqual(r.input, { kind: 'tincan', count: 1 });
  assert.ok(Math.abs(r.progress - 5) < 1e-6);
  const bad = new StationModel('recycler', { station: 'recycler', input: { kind: 'metalore', count: 2 }, output: { kind: 'glass', count: 3 }, fuel: 'x', progress: 99 });
  assert.equal(bad.input, null); assert.equal(bad.output, null); assert.equal(bad.fuelUnits, 0); assert.equal(bad.progress, 0);
  const weird = new StationModel('recycler', { input: { kind: 'zzz', count: 1 }, output: { kind: '__proto__', count: 1 } });
  assert.equal(weird.input, null); assert.equal(weird.output, null);
  assert.doesNotThrow(() => new StationModel('recycler', 'junk'));
});

test('recycler: smelter and grill are unchanged', () => {
  for (const id of ['smelter', 'grill']) {
    const st = new StationModel(id);
    assert.equal(st.recipes, null);
    assert.equal(st.usesFuel, true);
    for (const k of JUNK) assert.equal(st.recipeFor(k), null, `${id} ${k}`);
    assert.equal(st.addFuel('wood', 1), 1);
    assert.equal(fuelValue('wood'), 1);
  }
  const sm = new StationModel('smelter');
  assert.equal(sm.recipeFor('sand').kind, 'glass');
  // a smelter snapshot holding scrap output (not a smelter recipe) is still dropped
  const s2 = new StationModel('smelter', { station: 'smelter', output: { kind: 'scrap', count: 2 } });
  assert.equal(s2.output, null);
});

test('recycler: game.js floats, collects and draws junk', () => {
  const types = GAME.match(/const ITEM_TYPES = Object\.freeze\(\[([^\]]*)\]/)[1];
  const loot = GAME.match(/const LOOT = Object\.freeze\((\{.*\})\);/)[1];
  for (const id of JUNK) {
    assert.ok(types.includes(`'${id}'`), 'ITEM_TYPES ' + id);
    assert.ok(loot.includes(`${id}:{${id}:1}`), 'LOOT ' + id);
  }
  const chance = GAME.match(/JUNK_CHANCE = ([^;,]+)/)[1];
  assert.ok(Math.abs(Function(`return ${chance}`)() - 1 / 11) < 1e-9);
  const fn = GAME.slice(GAME.indexOf('function itemModel('));
  const junk = fn.indexOf('JUNK_TYPES.includes(item.type)'), debris = fn.indexOf('createDebris(');
  assert.ok(junk > 0 && debris > junk, 'junk branch before createDebris');
  assert.ok(/it\.type !== 'bottle' && Math\.random\(\) < JUNK_CHANCE/.test(GAME), 'makeItem re-roll keeps bottle odds');
});

test('recycler: models exist; tub has crank and pile, no glow', () => {
  for (const id of JUNK) {
    assert.ok(hasModel(id), id);
    const m = buildModel(id);
    const big = Math.max(...m.userData.size);
    assert.ok(big > 0.15 && big < 0.45, `${id} size ${big}`);
  }
  const g = createRecyclerModel(T);
  assert.equal(g.name, 'recycler');
  assert.ok(g.getObjectByName('recyclerCrank'));
  const pile = g.getObjectByName('recyclerPile');
  assert.ok(pile && pile.visible === false);
  assert.equal(g.getObjectByName('glow'), undefined);
  let meshes = 0; g.traverse((o) => { if (o.isMesh) meshes++; });
  assert.ok(meshes <= 12, 'meshes ' + meshes);
  assert.ok(g.userData.size.x < 1.3 && g.userData.size.z < 1.3 && g.userData.height < 1);
});

test('recycler: progression wiring and panel copy hooks', () => {
  const hooks = readFileSync(new URL('../dist/progression-hooks.js', import.meta.url), 'utf8');
  assert.ok(hooks.includes('recycler: createRecyclerModel'));
  assert.ok(/stationExtraRecipes\(id\)/.test(hooks), 'COOKERS includes fuel-free stations');
  assert.ok(hooks.includes("getObjectByName('recyclerCrank')"));
  const ui = readFileSync(new URL('../dist/smelter-ui.js', import.meta.url), 'utf8');
  assert.ok(ui.includes('st-nofuel'));
  assert.ok(ui.includes("'Pick something from your bag to cook, then add fuel.'"), 'smelter copy unchanged');
});

test('recycler: pickup feed rows fall back to the hotbar drawing while the 3D icon renders', () => {
  assert.match(GAME, /pickupFeed\.setIconProvider\(k => iconURL\(k\) \|\| feedSprite\(k\)\)/);
  assert.match(GAME, /function feedSprite\(k\) \{[^\n]*iconSVG\(k\)/);
});
