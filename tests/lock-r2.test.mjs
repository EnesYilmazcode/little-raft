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

test('LOCK-2: body.relock ends on lock loss, lock error and after the timeout', () => {
  assert.equal(rules.relockPending({ elapsed: 0 }), true);
  assert.equal(rules.relockPending({ elapsed: 300 }), true);
  assert.equal(rules.relockPending({ event: 'unlocked', elapsed: 50 }), false, 'granted then revoked');
  assert.equal(rules.relockPending({ event: 'error', elapsed: 50 }), false, 'refused');
  assert.equal(rules.relockPending({ elapsed: rules.RELOCK_TIMEOUT }), false, 'timed out');
  assert.equal(rules.relockPending({ locked: true }), false, 'lock arrived');
  assert.ok(rules.RELOCK_TIMEOUT >= 400 && rules.RELOCK_TIMEOUT <= 1000);
});
