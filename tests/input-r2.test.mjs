// Regression tests for input findings INPUT-1..INPUT-4 (round 2).
// Run: node --test tests/input-r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const R = await import(new URL('input-rules.js', base));
const gameSrc = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');

// ---------------------------------------------------------------- INPUT-1 held keys across panels

test('INPUT-1: keys pressed while a panel is open are recorded but trigger no action', () => {
  assert.deepEqual(R.keyDecision({inField:false, blocked:true}), {record:true, act:false});
  assert.deepEqual(R.keyDecision({inField:false, blocked:false}), {record:true, act:true});
  assert.deepEqual(R.keyDecision({inField:true, blocked:false}), {record:false, act:false});
  assert.deepEqual(R.keyDecision({inField:true, blocked:true}), {record:false, act:false});
});

test('INPUT-1: opening a panel keeps held keys; only window blur wipes them', () => {
  const fn = name => { const line = gameSrc.split('\n').find(l => l.includes(`function ${name}() {`)); assert.ok(line, name); return line; };
  assert.doesNotMatch(fn('pauseInput'), /keys\s*=/);
  assert.match(fn('clearInput'), /keys = \{\}/);
  assert.match(fn('openInventory'), /pauseInput\(\)/);
  assert.doesNotMatch(fn('openInventory'), /clearInput/);
  assert.doesNotMatch(gameSrc, /onPause:\s*(guard\()?clearInput/);
  assert.match(gameSrc, /on\(window, 'blur', \(\) => \{ clearInput\(\)/);
});
