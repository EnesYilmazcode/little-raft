// Regression tests for the hook / inventory loop: metal hook repair, casts losing their hook, barrel pity rolls.
// Run: node --test tests/loop-ux-inv.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const rules = await import(new URL('coop-rules.js', base));
const items = await import(new URL('items.js', base));
const gameSrc = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');
const isHook = s => items.toolRole(s?.kind) === 'hook';

test('repairHookSlot: a selected metal hook is the one R repairs', () => {
  const slots = [{ kind: 'hook', count: 1, durability: 20 }, { kind: 'metalhook', count: 1, durability: 50 }];
  assert.equal(rules.repairHookSlot(slots, 1, 100, isHook), 1);
  assert.equal(rules.repairHookSlot([null, { kind: 'metalhook', count: 1, durability: 10 }], 0, 100, isHook), 1);
  assert.ok(items.repairCost('metalhook'), 'metal hooks have a repair cost');
});

test('repairHookSlot: default predicate still only matches plain hooks', () => {
  assert.equal(rules.repairHookSlot([{ kind: 'metalhook', count: 1, durability: 10 }], 0, 100), -1);
  assert.equal(rules.repairHookSlot([{ kind: 'hook', count: 1, durability: 10 }], 0, 100, 'bad'), 0);
});

test('game.js passes the toolRole hook check to both repairHookSlot callers', () => {
  const calls = gameSrc.match(/repairHookSlot\([^)]*\)/g) ?? [];
  assert.equal(calls.length, 2, calls.join(' | '));
  for (const c of calls) assert.match(c, /, isHookSlot\)$/);
  assert.match(gameSrc, /const isHookSlot = s => toolRole\(s\?\.kind\) === 'hook'/);
});
