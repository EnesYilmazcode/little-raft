// Regression tests for pointer-lock and Escape rules (cursor must never escape during play).
// Run: node --test tests/pointer-lock.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { classifyLockError, lockFailureVerdict, shouldRequestLock, shouldRelockAfterClose, createEscGate, createLockTracker, exitLock, pageLock, lockLossAction, shouldDeferredRelock, shouldFocusRelock, escapeCooldownRetry } = await import(new URL('lock-rules.js', base));

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

test('CUR2-1: lock tracker tells page exits from browser-taken locks, and early drops', () => {
  const t = createLockTracker();
  t.gained(0);
  assert.equal(t.selfCaused(5000), false); // nothing marked: the browser took it
  assert.equal(t.early(5000), false);
  t.pageExit(6000);
  assert.equal(t.selfCaused(6010), true); // inventory / pause menu released it
  assert.equal(t.selfCaused(7500), false); // stale mark
  t.gained(8000);
  assert.equal(t.selfCaused(8010), false); // a new lock clears the mark
  assert.equal(t.early(8010), true); // granted, then dropped
  assert.equal(t.early(9600), false);
});

test('CUR2-1: exitLock marks the shared tracker before releasing, only when locked', () => {
  let exited = 0;
  const doc = { pointerLockElement: {}, exitPointerLock() { exited++; } };
  pageLock.gained(0);
  assert.equal(exitLock(doc, 100000), true);
  assert.equal(exited, 1);
  assert.equal(pageLock.selfCaused(100050), true);
  pageLock.gained(100100);
  assert.equal(exitLock({ pointerLockElement: null, exitPointerLock() { exited++; } }, 200000), false);
  assert.equal(exited, 1);
  assert.equal(pageLock.selfCaused(200010), false);
});

test('CUR2-1: a lock loss the page did not cause pauses when focused, never when blurred', () => {
  const base = { running: true, locked: false, blocked: false, focused: true };
  assert.equal(lockLossAction(base), 'pause');
  assert.equal(lockLossAction({ ...base, focused: false }), 'away'); // alt-tab
  assert.equal(lockLossAction({ ...base, hidden: true }), 'away');
  assert.equal(lockLossAction({ ...base, blocked: true }), 'none'); // pause menu already up
  assert.equal(lockLossAction({ ...base, locked: true }), 'none');
  assert.equal(lockLossAction({ ...base, running: false }), 'none');
});

test('CUR2-2: a fresh lock dropped by the browser is retried once, then pauses', () => {
  const base = { running: true, locked: false, blocked: false, focused: true, early: true };
  assert.equal(lockLossAction(base), 'retry');
  assert.equal(lockLossAction({ ...base, retried: true }), 'pause');
  assert.equal(lockLossAction({ ...base, focused: false }), 'away');
});

test('CUR2-2: the deferred Escape relock runs only while playing, focused, unblocked and Esc released', () => {
  const ok = { running: true, blocked: false, locked: false, escHeld: false, focused: true };
  assert.equal(shouldDeferredRelock(ok), true);
  for (const k of ['blocked', 'locked', 'escHeld']) assert.equal(shouldDeferredRelock({ ...ok, [k]: true }), false, k);
  for (const k of ['running', 'focused']) assert.equal(shouldDeferredRelock({ ...ok, [k]: false }), false, k);
});

test('CUR2-4: focus return relocks only if play was locked when focus left and nothing is open', () => {
  const ok = { lockedAtBlur: true, running: true, blocked: false, locked: false };
  assert.equal(shouldFocusRelock(ok), true);
  assert.equal(shouldFocusRelock({ ...ok, lockedAtBlur: false }), false); // was in a menu, or already free
  assert.equal(shouldFocusRelock({ ...ok, blocked: true }), false);
  assert.equal(shouldFocusRelock({ ...ok, running: false }), false);
  assert.equal(shouldFocusRelock({ ...ok, locked: true }), false);
});

test('CUR2-3: a refusal inside the Escape cooldown retries once when it ends', () => {
  assert.equal(escapeCooldownRetry({ now: 1400, escapeUnlockAt: 1000 }), 900);
  assert.equal(escapeCooldownRetry({ now: 1400, escapeUnlockAt: 1000, retried: true }), -1);
  assert.equal(escapeCooldownRetry({ now: 2400, escapeUnlockAt: 1000 }), -1); // past the cooldown
  assert.equal(escapeCooldownRetry({ now: 1400, escapeUnlockAt: -Infinity }), -1);
});

test('every page exitPointerLock goes through exitLock', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const f of ['game.js', 'settings.js', 'survival-ui.js', 'fishing-cooking.js', 'logbook-ui.js', 'progression-hooks.js', 'smelter-ui.js']) {
    const src = await readFile(new URL(f, base), 'utf8');
    assert.doesNotMatch(src, /\.exitPointerLock\s*\(|exitPointerLock\?\.\(/, f);
  }
});

test('desktop shell: the Escape relock leaves the key task, and the shell hooks exist', async () => {
  const { readFile } = await import('node:fs/promises');
  const game = await readFile(new URL('game.js', base), 'utf8');
  assert.match(game, /function escReleased\(\)[\s\S]{0,200}later\(/);
  for (const hook of ['escapedLock:', 'focusRelock:', 'relock:']) assert.ok(game.includes(hook), hook);
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /raftShell\.escapedLock\(\)',true\)/);
  assert.match(main, /raftShell\.focusRelock\(\)',true\)/);
  assert.match(main, /keyUp'&&!escClaimed\)refreshPanel/);
});
