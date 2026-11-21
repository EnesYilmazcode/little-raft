import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Same module URLs the game uses (inventory-state registers its kinds into this instance of items.js).
const build = JSON.parse(readFileSync(new URL('../dist/version.json', import.meta.url), 'utf8')).build;
const { ITEM_INFO } = await import(new URL('../dist/inventory-state.js?build=' + build, import.meta.url));
const { migrateSnapshot } = await import(new URL('../dist/items.js?build=' + build, import.meta.url));

test('every ITEM_INFO kind survives migrateSnapshot (save/load, co-op)', () => {
  for (const kind of Object.keys(ITEM_INFO)) {
    const snap = { slots: [{ kind, count: 1, ...(ITEM_INFO[kind].tool ? { durability: 50 } : {}) }], selected: 0 };
    const out = migrateSnapshot(snap);
    assert.equal(out?.slots?.[0]?.kind, kind, `${kind} dropped on load`);
  }
});
