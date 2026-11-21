// Crafting round 2 regressions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const icons = await import(new URL('item-icons.js', base));

test('CRAFT-1: cup, seed and water icons come from models.js; existing procedural icons are unchanged', () => {
  for (const k of ['cup', 'seed', 'water']) {
    const { model, own } = icons.resolveIconModel(k);
    assert.ok(model && model.isObject3D, k + ' has a 3D icon model');
    assert.equal(own, false, k + ' shares cached models.js geometry, so it must not be freed');
  }
  for (const k of ['hook', 'hammer', 'fishingrod', 'net', 'bench', 'crate', 'sail', 'lantern', 'wood']) {
    const { model, own } = icons.resolveIconModel(k);
    assert.ok(model, k);
    assert.equal(own, true, k + ' still uses its procedural icon');
  }
});

const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const book = await import(new URL('craft-book.js', base));

test('CRAFT-2: craftable count respects bag space, not just materials', () => {
  const slots = new Array(SLOT_COUNT).fill(null);
  slots[0] = { kind: 'wood', count: 20 }; slots[1] = { kind: 'plastic', count: 20 };
  for (let i = 2; i < SLOT_COUNT - 1; i++) slots[i] = { kind: 'fish', count: 20 };
  const bag = new Bag({ slots, selected: 0 });
  const rows = book.ingredientRows([{ kind: 'wood', count: 1 }, { kind: 'plastic', count: 2 }], k => bag.count(k));
  assert.equal(book.craftableTimes(rows), 10, 'materials alone cover 10');
  assert.equal(book.fittingTimes(bag, 'hook', 99), 1, 'only one non-stacking hook fits');
  assert.equal(bag.count('hook'), 0, 'simulation leaves the real bag untouched');
  // Stacking output with room: limited by materials, and by the cap.
  const leafSlots = new Array(SLOT_COUNT).fill(null); leafSlots[0] = { kind: 'leaf', count: 20 };
  const roomy = new Bag({ slots: leafSlots, selected: 0 });
  assert.equal(book.fittingTimes(roomy, 'rope', 99), 10);
  assert.equal(book.fittingTimes(roomy, 'rope', 3), 3);
  assert.equal(book.fittingTimes({ snapshot: () => ({}) }, 'rope'), null, 'uncopyable bag falls back');
});

const { readFileSync } = await import('node:fs');
const uiSrc = readFileSync(new URL('survival-ui.js', base), 'utf8');

test('CRAFT-2: recipe rows repaint when only the fitting count changes', () => {
  assert.match(uiSrc, /const sig = state \+ times \+/);
  assert.match(uiSrc, /fittingTimes\(bag, r\.id/);
});

test('CRAFT-3: opening the bag re-picks an automatic, unready recipe once states are known', () => {
  const open = uiSrc.slice(uiSrc.indexOf('function open()'), uiSrc.indexOf('function close()'));
  const render = open.indexOf('render(true)');
  const clear = open.indexOf("if (!pickedByUser && viewOf(pickId)?.state !== 'ready') pickId = null");
  const tab = open.lastIndexOf('applyTab()');
  assert.ok(render >= 0 && clear > render && tab > clear, 'states are evaluated, then the auto pick is cleared, then applyTab picks first ready');
  assert.match(uiSrc, /function setPick\(id\) \{[^}]*pickedByUser = true/);
  assert.match(uiSrc, /activeTab = id; pickId = null; pickedByUser = false;/);
});
