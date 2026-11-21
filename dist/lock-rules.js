// Pure pointer-lock and Escape rules shared by game.js, settings.js and survival-ui.js (DOM only through arguments, unit tested).
// Usage: import { classifyLockError, lockFailureVerdict, createEscGate, pageLock, exitLock, lockLossAction } from './lock-rules.js?build=v3-survival-ae77fa84ac2b';

// Refusals that only mean "not right now": Escape cooldown after a user exit, window not focused
// (alt-tab), no gesture, a request superseded by another. The next click or focus retries.
const TRANSIENT = new Set(['SecurityError', 'WrongDocumentError', 'NotAllowedError', 'AbortError', 'InvalidStateError', 'InUseAttributeError']);

// 'unsupported' | 'transient' | 'unknown'. A bare pointerlockerror Event (or anything without a DOM name) is 'unknown'.
export function classifyLockError(err) {
  const name = err && typeof err === 'object' && typeof err.name === 'string' ? err.name : '';
  if (name === 'NotSupportedError') return 'unsupported';
  if (TRANSIENT.has(name)) return 'transient';
  return 'unknown';
}

// Decide whether a refusal switches to drag-look. Only a missing API, NotSupportedError, or repeated
// refusals while the window has focus count. Unfocused refusals never count. SecurityError counts when
// focused (a sandbox or permissions-policy denial is permanent) but one alone never switches.
export function lockFailureVerdict({ supported = true, err, focused = true, failures = 0, maxFailures = 3 } = {}) {
  if (!supported) return { fallback: true, failures };
  const kind = classifyLockError(err);
  if (kind === 'unsupported') return { fallback: true, failures };
  if (!focused) return { fallback: false, failures };
  if (kind === 'transient' && err.name !== 'SecurityError') return { fallback: false, failures };
  const n = failures + 1;
  return { fallback: n >= maxFailures, failures: n };
}

// Always ask when playing; never pre-gate on navigator.userActivation. After the page itself released
// the lock (inventory, crafting) Chrome relocks without a gesture; any refusal is handled as above.
export function shouldRequestLock({ running, supported, blocked }) {
  return !!running && !!supported && !blocked;
}

// After a game panel closes: relock unless another panel took over or it hands back to the pause menu.
export function shouldRelockAfterClose({ running, locked, blocked, returnToPause }) {
  return !!running && !locked && !blocked && !returnToPause;
}

// Escape released with a relock waiting on it. A browser keyup (fromShell=false) is preventDefaulted while
// running, because Chrome revokes a lock granted inside an unhandled Escape keyup, and the relock is deferred
// past the keyup. The desktop shell's released() relocks synchronously to keep its user gesture.
// Returns { preventDefault, relock: 'now' | 'defer' | null }.
export function escReleasePlan({ running, pending, fromShell = false } = {}) {
  return { preventDefault: !fromShell && !!running, relock: !pending ? null : fromShell ? 'now' : 'defer' };
}

// Drag-look mode (no pointer lock available): the cursor must stay visible, so body.drag-look excludes body.relock.
export function dragLook({ running, supported = true, fallback = false } = {}) {
  return !!running && (!supported || !!fallback);
}

// body.relock (no cursor, no resume hint) is a short pending state after a panel closes unlocked. It ends
// when the lock arrives, a pointerlockchange leaves the page unlocked, pointerlockerror fires, or after
// timeout ms, so a refused or revoked relock always shows the resume hint again.
export const RELOCK_TIMEOUT = 600;
export function relockPending({ locked = false, event = null, elapsed = 0, timeout = RELOCK_TIMEOUT } = {}) {
  if (locked || event === 'unlocked' || event === 'error') return false;
  return elapsed < timeout;
}

// Escape bookkeeping for the pause menu's keyup fallback (browsers often swallow the keydown that
// ends pointer lock). A press whose keydown was handled never pauses on keyup, however long it is
// held: key-repeat keeps it handled. Lock losses the page caused itself are not recorded.
// Holding an unhandled Escape (the one that ended the lock) keeps its keyup eligible: repeats refresh the
// lock-loss time. An unhandled keyup while the page still holds the lock also pauses: the browser is
// exiting the lock for this Escape but has not reported it yet (it can land after the keyup).
export function createEscGate({ handledWindow = 600, lockWindow = 1500 } = {}) {
  let handledAt = -Infinity, lockLostAt = -Infinity, pressHandled = false;
  return {
    get handledAt() { return handledAt; },
    keydown(now, { repeat = false, handled = false } = {}) {
      if (repeat) {
        if (pressHandled) handledAt = now;
        else if (now - lockLostAt <= lockWindow) lockLostAt = now;
        return;
      }
      pressHandled = !!handled;
      if (handled) handledAt = now;
    },
    lockLost(now, { selfCaused = false } = {}) { if (!selfCaused) lockLostAt = now; },
    keyupOpensPause(now, { locked = false } = {}) {
      const handled = pressHandled; pressHandled = false;
      if (handled || now - handledAt < handledWindow) return false;
      if (!locked && now - lockLostAt > lockWindow) return false;
      lockLostAt = -Infinity;
      return true;
    },
  };
}

// ---------- Lock losses the page did not cause ----------
// Every exitPointerLock the page makes marks the tracker first (pageExit), so a later unlock can tell
// "the page let go" (inventory, pause menu) from "the browser took it" (an Escape Chrome consumed,
// focus loss, or a fresh lock dropped by Chrome's Escape handling). Times are performance.now() ms.
export function createLockTracker({ selfWindow = 1000, earlyWindow = 1500 } = {}) {
  let exitAt = -Infinity, grantedAt = -Infinity;
  return {
    pageExit(now) { exitAt = now; },
    gained(now) { grantedAt = now; exitAt = -Infinity; },
    selfCaused(now) { return now - exitAt < selfWindow; },
    // Lost soon after it was granted: the "granted, then dropped" pattern.
    early(now) { return now - grantedAt < earlyWindow; },
  };
}
// One tracker per page, shared by game.js, settings.js and survival-ui.js (same module URL).
export const pageLock = createLockTracker();

// Release the lock from page code, marking it as page-initiated first.
export function exitLock(doc = globalThis.document, now = globalThis.performance?.now?.() ?? Date.now()) {
  if (!doc?.pointerLockElement) return false;
  pageLock.pageExit(now);
  try { doc.exitPointerLock?.(); } catch { /* ignore */ }
  return true;
}

// ~100 ms after a lock loss the page did not cause, what to do:
//  'none'  still (or again) locked, not playing, or a menu/panel is already up
//  'away'  window blurred or hidden: alt-tab, never pause; focus return may relock
//  'retry' a lock dropped within the early window and not retried yet: ask once more
//  'pause' anything else: an Escape the page never saw, so open the pause menu
export function lockLossAction({ running, locked, blocked, focused = true, hidden = false, early = false, retried = false }) {
  if (!running || locked || blocked) return 'none';
  if (!focused || hidden) return 'away';
  if (early && !retried) return 'retry';
  return 'pause';
}

// Deferred relock after an Escape release (run in a later task, never inside the keyup).
export function shouldDeferredRelock({ running, blocked, locked, escHeld, focused }) {
  return !!running && !blocked && !locked && !escHeld && !!focused;
}

// Focus came back: relock only if the game was locked when focus left and nothing is open.
export function shouldFocusRelock({ lockedAtBlur, running, blocked, locked }) {
  return !!lockedAtBlur && !!running && !blocked && !locked;
}

// A relock refused soon after an Escape-driven unlock (Chrome's 1250 ms user-escape cooldown, seen in
// Electron): ms to wait before one retry, or -1 for no retry.
export function escapeCooldownRetry({ now, escapeUnlockAt, retried = false, cooldown = 1300 }) {
  if (retried || !Number.isFinite(escapeUnlockAt)) return -1;
  const since = now - escapeUnlockAt;
  if (since < 0 || since >= cooldown) return -1;
  return cooldown - since;
}
