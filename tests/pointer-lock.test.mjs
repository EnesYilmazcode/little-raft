// Regression tests for pointer-lock and Escape rules (cursor must never escape during play).
// Run: node --test tests/pointer-lock.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { classifyLockError, lockFailureVerdict, shouldRequestLock, shouldRelockAfterClose, createEscGate } = await import(new URL('lock-rules.js', base));

const dom = name => ({ name, message: name });

test('classifyLockError: only NotSupportedError is unsupported; Escape cooldown and unfocused refusals are transient', () => {
  assert.equal(classifyLockError(dom('NotSupportedError')), 'unsupported');
  for (const n of ['SecurityError', 'WrongDocumentError', 'NotAllowedError', 'AbortError']) assert.equal(classifyLockError(dom(n)), 'transient', n);
  assert.equal(classifyLockError(null), 'unknown');
  assert.equal(classifyLockError(new Error('x')), 'unknown');
});

test('CUR-2: one SecurityError or WrongDocumentError never switches to drag-look', () => {
  assert.equal(lockFailureVerdict({ err: dom('SecurityError') }).fallback, false);
  assert.equal(lockFailureVerdict({ err: dom('WrongDocumentError') }).fallback, false);
  assert.equal(lockFailureVerdict({ err: dom('NotAllowedError') }).fallback, false);
});

test('CUR-2: refusals while unfocused (alt-tab) never count, however many', () => {
  let failures = 0;
  for (let i = 0; i < 10; i++) {
    for (const err of [dom('SecurityError'), dom('WrongDocumentError'), null]) {
      const v = lockFailureVerdict({ err, focused: false, failures });
      assert.equal(v.fallback, false); failures = v.failures;
    }
  }
  assert.equal(failures, 0);
});

test('CUR-2: WrongDocumentError and NotAllowedError never escalate even when focused', () => {
  let failures = 0;
  for (let i = 0; i < 10; i++) {
    const v = lockFailureVerdict({ err: dom(i % 2 ? 'WrongDocumentError' : 'NotAllowedError'), failures });
    assert.equal(v.fallback, false); failures = v.failures;
  }
});

test('drag-look only for a missing API, NotSupportedError, or repeated focused refusals', () => {
  assert.equal(lockFailureVerdict({ supported: false }).fallback, true);
  assert.equal(lockFailureVerdict({ err: dom('NotSupportedError') }).fallback, true);
  let v = { failures: 0 };
  v = lockFailureVerdict({ err: dom('SecurityError'), failures: v.failures }); assert.equal(v.fallback, false);
  v = lockFailureVerdict({ err: dom('SecurityError'), failures: v.failures }); assert.equal(v.fallback, false);
  v = lockFailureVerdict({ err: dom('SecurityError'), failures: v.failures }); assert.equal(v.fallback, true); // sandbox / policy denial
  v = { failures: 0 };
  for (let i = 0; i < 2; i++) { v = lockFailureVerdict({ err: null, failures: v.failures }); assert.equal(v.fallback, false); }
  assert.equal(lockFailureVerdict({ err: null, failures: v.failures }).fallback, true); // legacy event-only API
});

test('CUR-1: lock is requested whenever playing, with no user-activation pre-gate', () => {
  assert.equal(shouldRequestLock({ running: true, supported: true, blocked: false }), true);
  assert.equal(shouldRequestLock({ running: true, supported: true, blocked: true }), false);
  assert.equal(shouldRequestLock({ running: false, supported: true, blocked: false }), false);
  assert.equal(shouldRequestLock({ running: true, supported: false, blocked: false }), false);
  assert.equal(shouldRequestLock.length, 1); // takes no activation input at all
});

test('CUR-4: closing a panel relocks, unless it hands back to the pause menu or another panel is open', () => {
  assert.equal(shouldRelockAfterClose({ running: true, locked: false, blocked: false, returnToPause: false }), true);
  assert.equal(shouldRelockAfterClose({ running: true, locked: false, blocked: false, returnToPause: true }), false);
  assert.equal(shouldRelockAfterClose({ running: true, locked: false, blocked: true, returnToPause: false }), false);
  assert.equal(shouldRelockAfterClose({ running: true, locked: true, blocked: false, returnToPause: false }), false);
  assert.equal(shouldRelockAfterClose({ running: false, locked: false, blocked: false, returnToPause: false }), false);
});

test('CUR-5: holding Escape after it closed the inventory never opens pause on keyup', () => {
  for (const held of [300, 700, 1000, 1400, 3000]) {
    const g = createEscGate();
    g.lockLost(0, { selfCaused: true }); // inventory open released the lock
    g.keydown(200, { handled: true });   // Esc closes the inventory
    for (let t = 230; t < 200 + held; t += 33) g.keydown(t, { repeat: true });
    assert.equal(g.keyupOpensPause(200 + held), false, `held ${held}ms`);
  }
});

test('CUR-5: a handled press stays handled even if repeats stop arriving', () => {
  const g = createEscGate();
  g.lockLost(0);
  g.keydown(100, { handled: true });
  assert.equal(g.keyupOpensPause(900), false);
});

test('page-caused lock loss is not an Escape: keyup after it does not pause', () => {
  const g = createEscGate();
  g.lockLost(0, { selfCaused: true });
  g.keydown(100, { handled: false });
  assert.equal(g.keyupOpensPause(800), false);
});

test('keyup fallback still pauses for the Escape that released the lock (swallowed keydown)', () => {
  const g = createEscGate();
  g.lockLost(1000);
  assert.equal(g.keyupOpensPause(1100), true);
  assert.equal(g.keyupOpensPause(1200), false); // consumed once
  const late = createEscGate();
  late.lockLost(0);
  assert.equal(late.keyupOpensPause(2000), false); // stale lock loss
});

test('repeats of an unhandled press do not mark it handled', () => {
  const g = createEscGate();
  g.keydown(0, { handled: false });
  g.keydown(40, { repeat: true });
  g.lockLost(700);
  assert.equal(g.keyupOpensPause(800), true);
});
