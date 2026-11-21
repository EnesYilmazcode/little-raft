// Crafting panel round 2: list ordering, inline amounts, craft counts, pin tracker and slot flash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const CB = await import(new URL('craft-book.js', base));
const { Bag, RECIPES } = await import(new URL('inventory-state.js', base));

test('CUI-1: craftable recipes sort first, stable within each state', () => {
  const items = [
    { id: 'a', state: 'missing' }, { id: 'b', state: 'ready' }, { id: 'c', state: 'missing' },
    { id: 'd', state: 'full' }, { id: 'e', state: 'ready' }, { id: 'f', state: 'weird' },
  ];
  assert.deepEqual(CB.sortByCraftable(items), ['b', 'e', 'd', 'a', 'c', 'f']);
  assert.deepEqual(CB.sortByCraftable([]), []);
  assert.deepEqual(CB.sortByCraftable(null), []);
  // Already sorted input is returned unchanged (no churn on re-render).
  assert.deepEqual(CB.sortByCraftable([{ id: 'x', state: 'ready' }, { id: 'y', state: 'missing' }]), ['x', 'y']);
});

test('CUI-1: inline chip label is owned/needed and compact', () => {
  assert.equal(CB.chipLabel({ have: 3, need: 5 }), '3/5');
  assert.equal(CB.chipLabel({ have: 0, need: 2 }), '0/2');
  assert.equal(CB.chipLabel({ have: 1500, need: 4 }), '999+/4');
});

test('CUI-4: max craftable count and shift-click amount', () => {
  assert.equal(CB.maxCraftable(0), 0);
  assert.equal(CB.maxCraftable(7), 7);
  assert.equal(CB.maxCraftable(7.9), 7);
  assert.equal(CB.maxCraftable(500), CB.HOLD.max);
  assert.equal(CB.maxCraftable(Infinity, 12), 12);
  assert.equal(CB.maxCraftable(-3), 0);
  assert.equal(CB.clickCrafts(5, false), 1);
  assert.equal(CB.clickCrafts(5, true), 5);
  assert.equal(CB.clickCrafts(0, true), 0);
  assert.equal(CB.clickCrafts(0, false), 0);
});

test('CUI-4: shift-crafting max from a real bag uses exactly the materials on hand', () => {
  const bag = new Bag({ slots: new Array(28).fill(null), selected: 0 });
  bag.add('leaf', 9);
  const rows = CB.ingredientRows(Object.entries(RECIPES.rope.cost).map(([kind, count]) => ({ kind, count })), k => bag.count(k));
  const n = CB.clickCrafts(CB.craftableTimes(rows), true);
  assert.equal(n, 4);
  for (let i = 0; i < n; i++) assert.equal(bag.craft('rope').ok, true);
  assert.equal(bag.count('rope'), 4);
  assert.equal(bag.count('leaf'), 1);
  assert.equal(bag.craft('rope').ok, false);
});

test('CUI-3: pins survive only for known recipes', () => {
  const ids = Object.keys(RECIPES);
  assert.equal(CB.cleanPin('hammer', ids), 'hammer');
  assert.equal(CB.cleanPin('nope', ids), null);
  assert.equal(CB.cleanPin('', ids), null);
  assert.equal(CB.cleanPin(42, ids), null);
  assert.equal(CB.cleanPin(null, ids), null);
});

test('CUI-3: tracker model turns ready only when every ingredient is covered', () => {
  const reqs = [{ kind: 'wood', count: 4 }, { kind: 'rope', count: 2 }];
  const have = { wood: 5, rope: 1 };
  let m = CB.trackerModel(reqs, k => have[k] || 0);
  assert.equal(m.ready, false);
  assert.deepEqual(m.rows.map(CB.chipLabel), ['5/4', '1/2']);
  have.rope = 4;
  m = CB.trackerModel(reqs, k => have[k] || 0);
  assert.equal(m.ready, true);
  assert.equal(m.times, 1);
});

test('CUI-3: tracker docks at the right edge below anything already there', () => {
  // Nothing there: sits at the top margin.
  assert.equal(CB.dockTop([], 1280, 200), 14);
  // A header button block in the top-right pushes it below.
  assert.equal(CB.dockTop([{ left: 1100, top: 20, right: 1260, bottom: 68 }], 1280, 200), 76);
  // Something on the left (supplies panel) does not.
  assert.equal(CB.dockTop([{ left: 14, top: 14, right: 300, bottom: 90 }], 1280, 200), 14);
  // Something low on the screen (hotbar) does not.
  assert.equal(CB.dockTop([{ left: 900, top: 640, right: 1270, bottom: 700 }], 1280, 200), 14);
  // Empty / degenerate rects are ignored.
  assert.equal(CB.dockTop([null, { left: 1200, top: 10, right: 1200, bottom: 50 }], 1280, 200), 14);
  // Docked box never spans the centre of the screen.
  const w = 200, vw = 900, x0 = vw - 14 - w;
  assert.ok(x0 > vw / 2);
});

test('CUI-5: gainedSlots finds where a crafted item landed', () => {
  const before = [{ kind: 'hook', count: 1 }, null, { kind: 'rope', count: 3 }, { kind: 'wood', count: 2 }];
  assert.deepEqual(CB.gainedSlots(before, [{ kind: 'hook', count: 1 }, null, { kind: 'rope', count: 4 }, { kind: 'wood', count: 2 }], 'rope'), [2]);
  assert.deepEqual(CB.gainedSlots(before, [{ kind: 'hook', count: 1 }, { kind: 'hammer', count: 1 }, { kind: 'rope', count: 3 }, null], 'hammer'), [1]);
  assert.deepEqual(CB.gainedSlots(before, before, 'rope'), []);
  // A stack of a different kind replaced by the crafted kind counts as arrival.
  assert.deepEqual(CB.gainedSlots(before, [{ kind: 'hook', count: 1 }, null, { kind: 'rope', count: 3 }, { kind: 'rope', count: 1 }], 'rope'), [3]);
  assert.deepEqual(CB.gainedSlots(null, [{ kind: 'rope', count: 1 }], 'rope'), [0]);
});

test('CUI-5: real craft into a bag flashes the slot the output went to', () => {
  const bag = new Bag({ slots: new Array(28).fill(null), selected: 0 });
  bag.add('leaf', 4); bag.add('rope', 1);
  const before = bag.snapshot().slots;
  bag.craft('rope');
  const got = CB.gainedSlots(before, bag.snapshot().slots, 'rope');
  assert.equal(got.length, 1);
  assert.equal(bag.slots[got[0]].kind, 'rope');
});

test('CUI: survival UI wires the new helpers and leaves pointer-lock code alone', () => {
  const src = readFileSync(new URL('survival-ui.js', base), 'utf8');
  for (const name of ['sortByCraftable', 'chipLabel', 'clickCrafts', 'trackerModel', 'dockTop', 'gainedSlots', 'cleanPin']) assert.ok(src.includes(name), name);
  assert.ok(src.includes('sv-pinbtn'), 'pin button in the detail card');
  assert.ok(/#craftPin/.test(src), 'tracker element');
});

test('UX2-1: tools craft one per press; other items up to the materials', async () => {
  const { ITEM_INFO } = await import(new URL('inventory-state.js', base));
  assert.equal(CB.singleCraft(ITEM_INFO.hook), true);
  assert.equal(CB.singleCraft(ITEM_INFO.fishingrod), true);
  assert.equal(CB.singleCraft(ITEM_INFO.rope), false);
  assert.equal(CB.singleCraft(null), false);
  assert.equal(CB.pressCap(6, ITEM_INFO.hook), 1);
  assert.equal(CB.pressCap(0, ITEM_INFO.hook), 0);
  assert.equal(CB.pressCap(6, ITEM_INFO.rope), 6);
});

test('UX2-1: the bag opens on the first ready recipe the player does not own yet', () => {
  const items = [
    { id: 'hook', cat: 'tools', state: 'ready', owned: 1 },
    { id: 'hammer', cat: 'tools', state: 'missing', owned: 0 },
    { id: 'rope', cat: 'materials', state: 'ready', owned: 0 },
  ];
  assert.deepEqual(CB.openingPick(items), { id: 'rope', cat: 'materials' });
  assert.deepEqual(CB.openingPick([items[0], items[1]]), { id: 'hook', cat: 'tools' });
  assert.deepEqual(CB.openingPick([items[1]]), { id: 'hammer', cat: 'tools' });
  assert.equal(CB.openingPick([]), null);
});

test('UX2-4: amounts are labelled and missing ingredients link to their recipe', () => {
  assert.equal(CB.haveNeedLabel({ have: 40, need: 1 }), 'have 40 · need 1');
  const recipes = [{ id: 'rope', out: { kind: 'rope' } }, { id: 'hook', out: { kind: 'hook' } }];
  assert.equal(CB.recipeFor('rope', recipes), 'rope');
  assert.equal(CB.recipeFor('wood', recipes), null);
});

test('CRA2-1: the crafting column has a fixed height so tab switches do not move the panel', () => {
  const src = readFileSync(new URL('survival-ui.js', base), 'utf8');
  assert.match(src, /#inventory \.sv-craft\{[^}]*;height:min\(/);
});
