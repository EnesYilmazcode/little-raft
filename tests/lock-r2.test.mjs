// Round-2 regression tests for pointer lock and Escape (cursor must never escape during play).
// Run: node --test tests/lock-r2.test.mjs   (browser repro: python tests/e2e/esc-relock.py)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const rules = await import(new URL('lock-rules.js', base));

test('LOCK-1: a browser Escape keyup while running is preventDefaulted and defers the relock', () => {
  assert.deepEqual(rules.escReleasePlan({ running: true, pending: true }), { preventDefault: true, relock: 'defer' });
  assert.deepEqual(rules.escReleasePlan({ running: true, pending: false }), { preventDefault: true, relock: null });
});

test('LOCK-1: the desktop shell release relocks synchronously (keeps its user gesture)', () => {
  assert.deepEqual(rules.escReleasePlan({ running: true, pending: true, fromShell: true }), { preventDefault: false, relock: 'now' });
});

test('LOCK-1: Escape keyups on the title screen are left alone', () => {
  assert.equal(rules.escReleasePlan({ running: false, pending: false }).preventDefault, false);
});
