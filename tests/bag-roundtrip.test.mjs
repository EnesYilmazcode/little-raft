import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_INFO } from '../dist/inventory-state.js';
import { readFileSync } from 'node:fs';
// Import items.js through the same specifier inventory-state.js uses (build-stamped),
// so registerBagKinds() and migrateSnapshot() share one module instance.
const dist = new URL('../dist/', import.meta.url);
const itemsSpec = readFileSync(new URL('inventory-state.js', dist), 'utf8').match(/['"](\.\/items\.js[^'"]*)['"]/)[1];
const { migrateSnapshot, LOAD_RENAMES } = await import(new URL(itemsSpec, dist));

test('every ITEM_INFO kind survives migrateSnapshot (save/load, co-op)', () => {
  for (const kind of Object.keys(ITEM_INFO)) {
    const snap = { slots: [{ kind, count: 1, ...(ITEM_INFO[kind].tool ? { durability: 50 } : {}) }], selected: 0 };
    const out = migrateSnapshot(snap);
    assert.equal(out?.slots?.[0]?.kind, LOAD_RENAMES[kind] ?? kind, `${kind} dropped on load`); // legacy kinds load renamed
  }
});
