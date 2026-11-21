// Regression tests for crafting / bag fixes (CRAFT-1..6).
// Run: node --test tests/craft-fixes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(fileURLToPath(new URL(f, base)), 'utf8');
const ITEMS_MOD = await import(new URL('items.js', base));
const INV = await import(new URL('inventory-state.js', base));

test('CRAFT-5: migrateSnapshot keeps bag kinds that are not in ITEMS', () => {
  const extra = INV.ITEM_KINDS.filter(k => !ITEMS_MOD.isItem(k));
  assert.ok(extra.includes('cup') && extra.includes('receiver'), 'test premise: bag knows kinds ITEMS does not');
  const slots = new Array(INV.SLOT_COUNT).fill(null);
  extra.forEach((k, i) => { slots[i] = { kind: k, count: 1 }; });
  slots[extra.length] = { kind: 'cup', count: 9 }; // over the cup stack of 5
  const m = ITEMS_MOD.migrateSnapshot({ slots, selected: 0 }, INV.ITEM_INFO);
  const bag = new INV.Bag(m);
  for (const k of extra) assert.ok(bag.count(k) >= 1, `${k} kept`);
  assert.equal(bag.count('cup'), 10, 'overflowing cups top up / spill, none lost');
  for (const s of bag.snapshot().slots) if (s) assert.ok(s.count <= INV.ITEM_INFO[s.kind].maxStack, `${s.kind} stack clamped`);
  // Without the table the old behaviour stands (unknown kinds dropped), and junk is still dropped with it.
  assert.equal(ITEMS_MOD.migrateSnapshot({ slots }).slots.filter(Boolean).length, 0);
  assert.equal(ITEMS_MOD.migrateSnapshot({ slots: [{ kind: 'nope', count: 3 }, { kind: 'toString', count: 1 }] }, INV.ITEM_INFO).slots.filter(Boolean).length, 0);
  assert.match(src('game.js'), /migrateSnapshot\(s, ITEM_INFO\)/, 'snapBag passes the bag info table');
});
