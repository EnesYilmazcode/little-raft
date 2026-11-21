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

// ---------------------------------------------------------------- INPUT-2 look spike filter

const sum = (f, seq) => seq.reduce((s, d) => s + f.filter(d, 0)[0], 0);
// A 180-degree turn (~1428 counts at sensitivity 1) over 100 ms, coalesced into one event per frame.
const flick = fps => { const n = Math.max(2, Math.round(fps * .1)); const w = [...Array(n)].map((_, i) => Math.sin(Math.PI * (i + .5) / n)); const t = w.reduce((a, b) => a + b); return w.map(x => Math.round(1428 * x / t)); };

test('INPUT-2: a fast flick turns by the full amount at 60, 30 and 20 fps', () => {
  for (const fps of [60, 30, 20, 10]) {
    const seq = [3, 3, ...flick(fps), 2, 1];
    const raw = seq.reduce((a, b) => a + b);
    assert.equal(sum(R.createLookFilter(), seq), raw, `${fps} fps`);
  }
});

test('INPUT-2: one 800-count frame mid-flick turns as far as four 200-count frames', () => {
  assert.equal(sum(R.createLookFilter(), [60, 800, 300, 20]), sum(R.createLookFilter(), [60, 200, 200, 200, 200, 300, 20]));
  assert.equal(sum(R.createLookFilter(), [60, 800, 300, 20]), 1180);
});

test('INPUT-2: isolated pointer-lock spikes are dropped', () => {
  assert.equal(sum(R.createLookFilter(), [2, 2, -1500, 2, 2]), 8);
  assert.equal(sum(R.createLookFilter(), [40, 40, -1800, 40, 40]), 160);
  assert.equal(sum(R.createLookFilter(), [2, 2, 1500, 2, 2]), 8); // same direction but nothing follows it
  const [x, y] = R.createLookFilter().filter(NaN, 5);
  assert.deepEqual([x, y], [0, 5]);
});

test('INPUT-2: the first move after the lock is gained is discarded', () => {
  const f = R.createLookFilter();
  f.reset({dropFirst:true});
  assert.deepEqual(f.filter(300, -40), [0, 0]);
  assert.deepEqual(f.filter(5, 1), [5, 1]);
  f.reset();
  assert.deepEqual(f.filter(5, 1), [5, 1]);
});

test('INPUT-2: game.js no longer clamps movementX and does not ask for unadjustedMovement', () => {
  assert.doesNotMatch(gameSrc, /clamp\(e\.movement[XY]/);
  assert.match(gameSrc, /lookFilter\.filter\(e\.movementX, e\.movementY\)/);
  assert.doesNotMatch(gameSrc, /unadjustedMovement/);
});
