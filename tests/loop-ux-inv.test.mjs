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

// ---------------------------------------------------------------- G2: a cast loses its hook
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const SR = await import(new URL('storage-research.js', base));

test('castHookGone: moving the cast hook out of its slot is detected; a metal hook swapped in keeps the cast', () => {
  const bag = new Bag(); // starter bag: hook in slot 0
  assert.equal(rules.castHookGone(bag.slots, 0, isHook), false);
  bag.move(0, 15);
  assert.equal(rules.castHookGone(bag.slots, 0, isHook), true);
  const s = new Array(SLOT_COUNT).fill(null); s[0] = { kind: 'metalhook', count: 1, durability: 100 };
  assert.equal(rules.castHookGone(s, 0, isHook), false);
  assert.equal(rules.castHookGone(s, 0), true, 'default predicate is plain hooks only');
  assert.equal(rules.castHookGone(s, -1, isHook), true);
  assert.equal(rules.castHookGone(null, 0, isHook), true);
});

test('castHookGone: putting the cast hook into a crate is detected', () => {
  const w = { tiles: [[1, 0]], decor: [{ type: 'crate', x: 1, z: 0 }], items: [], ext: {} };
  const st = SR.stateFrom({ v: 1, chests: {}, seen: [], learned: [], r: 0 }, 'save', w), bag = new Bag();
  const env = { decorAt: (x, z) => (x === 1 && z === 0 ? 'crate' : null), pos: () => null };
  const r = SR.applyStorageAction(st, { kind: 'storage.put', x: 1, z: 0, from: 0, expect: { kind: 'hook', count: 1 } }, 'host', bag, env);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(rules.castHookGone(bag.slots, 0, isHook), true);
});

test('game.js retracts a hook cast whose hook left its slot, and the host drops hookless cast collects', () => {
  const upd = gameSrc.slice(gameSrc.indexOf('function updateHook('));
  assert.match(upd.slice(0, 800), /if \(!hook\.fishing && castHookGone\(localBag\(\)\.slots, hookSlot, isHookSlot\)\) \{ hook\.cancel\?\.\(\); endHook\(\); return; \}/);
  const col = gameSrc.slice(gameSrc.indexOf("if (a.kind === 'collect') {"));
  const drop = col.indexOf('a.cast && hookIndex(bag, a.slot) < 0) return;'), roll = col.indexOf('const isCache');
  assert.ok(drop > 0 && drop < roll, 'cast collect without a hook returns before loot is rolled');
});

// ---------------------------------------------------------------- G3: refused barrels keep their pity counters
test('rollBarrelTrial: an untaken roll leaves the pity counters alone; keep() applies them', () => {
  const luck = { misses: { clay: 0, stone: 0, metalore: 0, sand: 0, copperore: items.BARREL_PITY.copperore } }; // copper is due
  const before = JSON.stringify(luck.misses);
  for (let n = 0; n < 20; n++) {
    const t = items.rollBarrelTrial(Math.random, luck);
    assert.ok(t.loot.copperore > 0, 'the overdue kind is still forced on every retry');
  }
  assert.equal(JSON.stringify(luck.misses), before, 'refused rolls changed nothing');
  const t = items.rollBarrelTrial(() => 0, luck); t.keep();
  assert.equal(luck.misses.copperore, 0);
  assert.equal(luck.misses.clay, 1);
  const plain = items.rollBarrelTrial(() => 0, null); plain.keep();
  assert.deepEqual(plain.loot, items.rollBarrel(() => 0));
});

test('game.js commits barrel luck only after the loot fits, and nets back off a refused barrel', () => {
  const col = gameSrc.slice(gameSrc.indexOf("if (a.kind === 'collect') {"), gameSrc.indexOf("if (a.kind === 'build') {"));
  assert.doesNotMatch(col, /rollBarrel\(/);
  assert.match(col, /rollBarrelTrial\(Math\.random, prog\?\.barrelLuck\)/);
  assert.match(col, /commit\(bag, scratch\); barrel\?\.keep\(\);/);
  // Edge nets (dist/nets.js) replaced the old pull-into-bag nets: a refused barrel just stays in the net, and its
  // luck is committed only when its loot fits (same trial/keep as hook pickups).
  assert.match(gameSrc, /emptyNet\(n, bag, type => \{ trial = type === 'barrel' \? rollBarrelTrial\(Math\.random, prog\?\.barrelLuck\)/);
  assert.match(gameSrc, /\(\) => trial\?\.keep\(\)\);/);
});
