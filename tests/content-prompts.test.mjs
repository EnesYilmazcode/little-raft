// Content prompts in main's #lrPrompt (content.js promptParts) and the aim-aware station check (progression-hooks aimMiss).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { promptParts } = await import(new URL('content.js', base));
const { aimMiss } = await import(new URL('progression-hooks.js', base));
const { normalizePrompt } = await import(new URL('prompts.js', base));

test('promptParts turns module HTML into a key + label', () => {
  assert.deepEqual(promptParts('<kbd>E</kbd>Open crate'), { key: 'E', label: 'Open crate' });
  assert.deepEqual(promptParts('<kbd>E</kbd>Use tinker’s desk'), { key: 'E', label: 'Use tinker’s desk' });
  assert.deepEqual(promptParts('<kbd>E</kbd>Gather palm: wood &amp; leaves (3 left)'), { key: 'E', label: 'Gather palm: wood & leaves (3 left)' });
  assert.deepEqual(promptParts('Your friend’s raft doesn’t have chests yet'), { label: 'Your friend’s raft doesn’t have chests yet', muted: true });
  assert.equal(promptParts(''), null); assert.equal(promptParts(null), null); assert.equal(promptParts('<kbd>E</kbd>  '), null);
  assert.deepEqual(normalizePrompt(promptParts('<kbd>E</kbd>Open crate')), [{ key: 'E', label: 'Open crate', hold: false, muted: false }]);
});

test('promptParts returns the cached object for a repeated string', () => {
  const a = promptParts('<kbd>E</kbd>Open crate'); assert.equal(promptParts('<kbd>E</kbd>Open crate'), a);
});

const norm = (x, y, z) => { const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; };
// Eye at (0, 1.6, 0) above a deck at y=0; aim ray hits the deck plane at point.
const aimFrom = (tx, ty, tz) => { const dir = norm(tx, ty - 1.6, tz), t = -1.6 / dir.y; return { dir, point: { x: dir.x * t, y: 0, z: dir.z * t } }; };
const me = { x: 0, z: 0 };

test('aimMiss: looking at the station centre is a hit', () => {
  assert.ok(aimMiss(aimFrom(0, 0.5, -2), 0, -2, me) < 0.05);
  assert.ok(aimMiss(aimFrom(0.4, 0.3, -2), 0, -2, me) < 0.8);
});
test('aimMiss: sky, a crate 2 m to the side, or a station behind are misses', () => {
  assert.equal(aimMiss({ point: null, dir: norm(0, 1, -1) }, 0, -2, me), Infinity);
  assert.ok(aimMiss(aimFrom(2, 0.5, -2), 0, -2, me) > 0.8);
  assert.ok(aimMiss(aimFrom(0, 0.5, 2), 0, -2, me) > 0.8);
  assert.equal(aimMiss(undefined, 0, -2, me), Infinity);
});
