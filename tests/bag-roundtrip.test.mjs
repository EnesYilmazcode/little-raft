import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_INFO } from '../dist/inventory-state.js';
import { migrateSnapshot } from '../dist/items.js';

test('every ITEM_INFO kind survives migrateSnapshot (save/load, co-op)', () => {
  for (const kind of Object.keys(ITEM_INFO)) {
    const snap = { slots: [{ kind, count: 1, ...(ITEM_INFO[kind].tool ? { durability: 50 } : {}) }], selected: 0 };
    const out = migrateSnapshot(snap);
    assert.equal(out?.slots?.[0]?.kind, kind, `${kind} dropped on load`);
  }
});
