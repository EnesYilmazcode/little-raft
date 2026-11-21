// items.js mirrors the bag sizes from inventory-state.js; a saved selection of hotbar slot 8 or 9 must survive migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateSnapshot, SLOT_COUNT as ISLOTS, HOTBAR_SIZE as IHOT } from '../dist/items.js';
import { Bag, SLOT_COUNT, HOTBAR_SIZE } from '../dist/inventory-state.js';

test('items.js bag sizes match inventory-state.js', () => {
  assert.equal(ISLOTS, SLOT_COUNT);
  assert.equal(IHOT, HOTBAR_SIZE);
});

test('migrateSnapshot keeps a selection on the last hotbar slots', () => {
  for (const sel of [7, 8, 9]) {
    const m = migrateSnapshot({ slots: [{ kind: 'wood', count: 3 }], selected: sel });
    assert.equal(m.selected, sel, 'slot ' + sel);
    const bag = new Bag(m);
    assert.equal(bag.selectedIndex, sel);
  }
  assert.equal(migrateSnapshot({ slots: [], selected: HOTBAR_SIZE }).selected, 0, 'out of range still resets');
  assert.equal(migrateSnapshot({ slots: [], selected: -1 }).selected, 0);
});
