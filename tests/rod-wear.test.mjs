// Fishing rod durability at Raft values: 10 catches, then it snaps.
// Run: node --test tests/rod-wear.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { rodSlot, wearRod } = await import(new URL('fishing-rules.js', base));
const { ITEMS, wearPerUse } = await import(new URL('items.js', base));

test('fishing rod lasts 10 catches; the tip says so; the hook is untouched', () => {
  assert.equal(ITEMS.fishingrod.durability, 10);
  assert.equal(wearPerUse('fishingrod'), 10);
  assert.match(ITEMS.fishingrod.tip, /10 catches/);
  assert.deepEqual({ ...ITEMS.fishingrod.recipe.cost }, { wood: 6, rope: 8 });
});

test('rodSlot prefers the selected rod, else the first rod', () => {
  const slots = [{ kind: 'wood', count: 3 }, { kind: 'fishingrod', count: 1, durability: 50 }, null, { kind: 'fishingrod', count: 1, durability: 90 }];
  assert.equal(rodSlot(slots, 3), 3);
  assert.equal(rodSlot(slots, 0), 1);
  assert.equal(rodSlot(slots, undefined), 1);
  assert.equal(rodSlot([{ kind: 'hook', count: 1 }], 0), -1);
  assert.equal(rodSlot(null, 0), -1);
});

test('wearRod: ten catches break a fresh rod, a warning lands at 25%', () => {
  const rod = { kind: 'fishingrod', count: 1, durability: 100 };
  let warned = -1;
  for (let i = 1; i <= 9; i++) {
    const w = wearRod(rod, wearPerUse('fishingrod'));
    assert.equal(w.broke, false, `catch ${i}`);
    if (w.before > 25 && w.after <= 25) warned = i;
  }
  assert.equal(warned, 8);
  const last = wearRod(rod, wearPerUse('fishingrod'));
  assert.equal(last.broke, true); assert.equal(rod.durability, 0);
  assert.equal(wearRod({ kind: 'fishingrod', count: 1 }, 10).after, 90); // missing durability = fresh
  assert.equal(wearRod({ kind: 'hook', count: 1, durability: 100 }, 10), null);
  assert.equal(wearRod(null, 10), null);
  assert.equal(wearRod({ kind: 'fishingrod', count: 1, durability: 0 }, 10).broke, true, 'a rod already at 0 snaps instead of fishing forever');
});

test('game.js wears the rod on every catch and removes it when it breaks', () => {
  const src = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');
  assert.ok(src.includes("rodSlot(bag.slots, bag.selectedIndex)"));
  assert.ok(src.includes("wearRod(bag.slots[ri], wearPerUse('fishingrod'))"));
  assert.ok(src.includes('Your fishing rod broke!'));
});
