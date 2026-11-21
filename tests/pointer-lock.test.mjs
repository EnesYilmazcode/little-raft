// Regression tests for pointer-lock and Escape rules (cursor must never escape during play).
// Run: node --test tests/pointer-lock.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { classifyLockError, lockFailureVerdict, shouldRequestLock, shouldRelockAfterClose, createEscGate, createLockTracker, exitLock, pageLock, lockLossAction, shouldDeferredRelock, shouldFocusRelock, escapeCooldownRetry, resumeNeedsGesture, reopenPauseOnLockFail, menuClickAllowed, quitStep } = await import(new URL('lock-rules.js', base));

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

test('CUR2-1/CUR3-2: lock tracker tells page exits from browser-taken locks, and early drops', () => {
  const t = createLockTracker();
  t.gained(0);
  assert.equal(t.lost(5000), false); // nothing marked: the browser took it
  assert.equal(t.browserReleased, true);
  assert.equal(t.early(5000), false);
  t.gained(5500);
  t.pageExit(6000);
  assert.equal(t.lost(6010), true); // inventory / pause menu released it
  assert.equal(t.browserReleased, false);
  assert.equal(t.lost(6020), false); // the mark is consumed by that one unlock
  t.gained(8000);
  assert.equal(t.browserReleased, false); // a new lock clears it
  assert.equal(t.lost(8010), false); // a new lock clears the mark too
  assert.equal(t.early(8010), true); // granted, then dropped
  assert.equal(t.early(9600), false);
});

test('CUR3-2: a page release stays the page\'s however late its unlock arrives (stalled frame)', () => {
  for (const lag of [20, 800, 1300, 1700, 3000, 4900]) {
    const t = createLockTracker();
    t.gained(0); t.pageExit(10000);
    assert.equal(t.lost(10000 + lag), true, `lag ${lag}`);
    assert.equal(t.browserReleased, false);
  }
  const t = createLockTracker();
  t.gained(0); t.pageExit(10000);
  assert.equal(t.lost(16000), false); // a mark whose unlock never came goes stale
});

test('CUR3-2: an unlock while a panel is open never pauses, but still counts as browser-taken for relocks', () => {
  const t = createLockTracker();
  t.gained(0);
  assert.equal(t.lost(100, { blocked: true }), true);
  assert.equal(t.browserReleased, true);
});

test('CUR2-1: exitLock marks the shared tracker before releasing, only when locked', () => {
  let exited = 0;
  const doc = { pointerLockElement: {}, exitPointerLock() { exited++; } };
  pageLock.gained(0);
  assert.equal(exitLock(doc, 100000), true);
  assert.equal(exited, 1);
  assert.equal(pageLock.lost(100050), true);
  pageLock.gained(100100);
  assert.equal(exitLock({ pointerLockElement: null, exitPointerLock() { exited++; } }, 200000), false);
  assert.equal(exited, 1);
  assert.equal(pageLock.lost(200010), false);
  pageLock.gained(200100);
});

test('CUR3-1: Escape cannot resume play after the browser took the lock, unless shell or a recent gesture', () => {
  assert.equal(resumeNeedsGesture({ browserReleased: true }), true);
  assert.equal(resumeNeedsGesture({ browserReleased: true, activation: true }), false); // a click or key in the last ~5 s
  assert.equal(resumeNeedsGesture({ browserReleased: true, inShell: true }), false); // desktop main relocks with a gesture
  assert.equal(resumeNeedsGesture({ browserReleased: false }), false); // page released it: Chrome relocks without one
  // The real sequence: Chrome eats the Esc (no page mark), the pause menu opens, Esc again.
  const t = createLockTracker();
  t.gained(0); t.lost(4000);
  assert.equal(resumeNeedsGesture({ browserReleased: t.browserReleased }), true);
  // The page saw the Esc: settings.open() released the lock itself.
  t.gained(5000); t.pageExit(9000); t.lost(9010);
  assert.equal(resumeNeedsGesture({ browserReleased: t.browserReleased }), false);
});

test('CUR3-1: a refused relock after closing a menu reopens the pause menu, never a free cursor', () => {
  const ok = { running: true, blocked: false, locked: false, focused: true, resumeAt: 1000, now: 1400 };
  assert.equal(reopenPauseOnLockFail(ok), true);
  assert.equal(reopenPauseOnLockFail({ ...ok, retryPending: true }), false); // cooldown retry first
  assert.equal(reopenPauseOnLockFail({ ...ok, focused: false }), false); // alt-tab: the away hint
  assert.equal(reopenPauseOnLockFail({ ...ok, blocked: true }), false);
  assert.equal(reopenPauseOnLockFail({ ...ok, locked: true }), false);
  assert.equal(reopenPauseOnLockFail({ ...ok, running: false }), false);
  assert.equal(reopenPauseOnLockFail({ ...ok, resumeAt: -Infinity }), false); // not a resume (click on the sea)
  assert.equal(reopenPauseOnLockFail({ ...ok, now: 5000 }), false); // stale
});

test('CUR3-3: pause menu ignores pointer clicks right after opening, and quit needs a second click', () => {
  assert.equal(menuClickAllowed({ now: 1100, openedAt: 1000 }), false);
  assert.equal(menuClickAllowed({ now: 1100, openedAt: 1000, keyboard: true }), true); // Enter on Resume
  assert.equal(menuClickAllowed({ now: 1450, openedAt: 1000 }), true);
  assert.equal(quitStep({ now: 5000 }), 'arm');
  assert.equal(quitStep({ now: 6000, armedAt: 5000 }), 'quit');
  assert.equal(quitStep({ now: 8500, armedAt: 5000 }), 'arm'); // confirmation expired
});

test('CUR3-1/3/4: settings and game wire the gesture gate, quit confirm and logbook return-to-pause', async () => {
  const { readFile } = await import('node:fs/promises');
  const settings = await readFile(new URL('settings.js', base), 'utf8');
  const game = await readFile(new URL('game.js', base), 'utf8');
  assert.match(settings, /gameActive\(\) && gestureNeeded\(\)\) \{[\s\S]{0,200}showHint\(true\); return true; \}/);
  assert.match(settings, /Click Resume or press Enter/);
  assert.match(settings, /Click again to quit/);
  assert.match(settings, /returnToPause = lb; lb\.dataset\.fromPause = '1'/);
  assert.match(game, /dataset\.fromPause\) resumeLock\(\)/);
  assert.match(game, /needsGesture:resumeGestureNeeded/);
  assert.match(game, /pageLock\.lost\(now, \{blocked:uiBlocked\(\)\}\)/);
  assert.match(game, /reopenPauseOnLockFail\(/);
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
  // raft-master's escReleasePlan: a browser keyup defers the relock past the key task; the shell's released() stays synchronous
  assert.match(game, /function escReleased\(fromShell = false\)[\s\S]{0,300}setTimeout\(guard\(requestLock\), 0\)/);
  for (const hook of ['escapedLock:', 'focusRelock:', 'relock:']) assert.ok(game.includes(hook), hook);
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /raftShell\.escapedLock\(\)',true\)/);
  assert.match(main, /raftShell\.focusRelock\(\)',true\)/);
  assert.match(main, /keyUp'&&!escClaimed\)refreshPanel/);
});
