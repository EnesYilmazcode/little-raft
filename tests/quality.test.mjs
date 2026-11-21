import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuality, buildLevels, QUALITY } from '../dist/quality.js';

// Fake clock: time only advances through the frame times we feed in.
const run = (q, ms, forMs) => { let changes = 0; for (let t = 0; t < forMs; t += ms) if (q.tick(ms)) changes++; return changes; };

test('levels never exceed the cap and stop at the minimum scale', () => {
  assert.deepEqual(buildLevels(1, true).map(l => [l.scale, l.shadowEvery]), [[1, 1], [.9, 1], [.8, 1], [.7, 1], [.6, 1], [.6, 2]]);
  assert.deepEqual(buildLevels(.85, false).map(l => l.scale), [.85, .75, .65, .6]);
  assert.deepEqual(buildLevels(.5, true).map(l => [l.scale, l.shadowEvery]), [[.5, 1], [.5, 2]]);
});

test('steady fast frames never change anything', () => {
  const q = createQuality({ cap: 1 });
  assert.equal(run(q, 10, 60000), 0);
  assert.equal(q.scale, 1); assert.equal(q.shadowEvery, 1);
});

test('sustained slow frames step down one level at a time, after the hold time', () => {
  const seen = []; const q = createQuality({ cap: 1, onChange: i => seen.push(i) });
  run(q, 30, 1900); assert.equal(q.level, 0, 'not before ~2 s');
  run(q, 30, 400); assert.equal(q.level, 1); assert.equal(q.scale, .9);
  run(q, 30, 60000);
  assert.equal(q.scale, QUALITY.MIN_SCALE); assert.equal(q.shadowEvery, 2, 'bottom step halves shadow updates');
  assert.deepEqual(seen.map(s => s.reason), ['down', 'down', 'down', 'down', 'down']);
});

test('a short hitch does not step down', () => {
  const q = createQuality({ cap: 1 });
  run(q, 10, 5000); run(q, 40, 600); run(q, 10, 5000);
  assert.equal(q.level, 0);
});

test('frames in the dead band hold the level (hysteresis)', () => {
  const q = createQuality({ cap: 1 });
  run(q, 30, 2500); assert.equal(q.level, 1);
  assert.equal(run(q, 18, 60000), 0); assert.equal(q.level, 1);
});

test('fast frames step back up after 5 s, and a reverted up-step backs off', () => {
  const q = createQuality({ cap: 1 });
  run(q, 30, 2500); assert.equal(q.level, 1);
  run(q, 10, 4500); assert.equal(q.level, 1, 'not before ~5 s');
  run(q, 10, 1500); assert.equal(q.level, 0);
  run(q, 30, 2500); assert.equal(q.level, 1, 'too slow at the top again');
  assert.equal(q.info.upAfter, QUALITY.UP_AFTER_MS * 2);
  run(q, 10, 8000); assert.equal(q.level, 1, 'waits longer now');
  run(q, 10, 3000); assert.equal(q.level, 0);
});

test('long frames (tab switch) are ignored', () => {
  const q = createQuality({ cap: 1 });
  run(q, 2000, 60000); assert.equal(q.level, 0);
});

test('disabling resets to the cap and stops measuring; setCap restarts at the new top', () => {
  const seen = []; const q = createQuality({ cap: 1, onChange: i => seen.push(i.reason) });
  run(q, 30, 5000); assert.ok(q.level > 0);
  q.setEnabled(false); assert.equal(q.scale, 1);
  run(q, 30, 10000); assert.equal(q.level, 0);
  q.setEnabled(true); q.setCap(.8, false);
  assert.equal(q.scale, .8); assert.deepEqual(q.levels.map(l => l.scale), [.8, .7, .6]);
  run(q, 30, 60000); assert.equal(q.scale, .6); assert.equal(q.shadowEvery, 1, 'no shadow step without shadows');
  assert.ok(seen.includes('disabled') && seen.includes('cap'));
});

test('reset forgets measurements but keeps the level', () => {
  const q = createQuality({ cap: 1 });
  run(q, 30, 1900); q.reset(); run(q, 30, 1900);
  assert.equal(q.level, 0);
});
