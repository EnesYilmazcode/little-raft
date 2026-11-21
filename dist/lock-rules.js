// Pure pointer-lock and Escape rules shared by game.js and settings.js (no DOM access, unit tested).
// Usage: import { classifyLockError, lockFailureVerdict, createEscGate } from './lock-rules.js?build=v3-survival-ae77fa84ac2b';

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

// Escape bookkeeping for the pause menu's keyup fallback (browsers often swallow the keydown that
// ends pointer lock). A press whose keydown was handled never pauses on keyup, however long it is
// held: key-repeat keeps it handled. Lock losses the page caused itself are not recorded.
export function createEscGate({ handledWindow = 600, lockWindow = 1500 } = {}) {
  let handledAt = -Infinity, lockLostAt = -Infinity, pressHandled = false;
  return {
    get handledAt() { return handledAt; },
    keydown(now, { repeat = false, handled = false } = {}) {
      if (repeat) { if (pressHandled) handledAt = now; return; }
      pressHandled = !!handled;
      if (handled) handledAt = now;
    },
    lockLost(now, { selfCaused = false } = {}) { if (!selfCaused) lockLostAt = now; },
    keyupOpensPause(now) {
      const handled = pressHandled; pressHandled = false;
      if (handled || now - handledAt < handledWindow) return false;
      if (now - lockLostAt > lockWindow) return false;
      lockLostAt = -Infinity;
      return true;
    },
  };
}

// Alt-tab: was play locked as the window lost focus? Chromium may drop the lock just before 'blur' fires,
// so a lock lost within `graceMs` of the blur still counts.
export function lockedAtBlur({ running, locked, now, lockLostAt = -Infinity, graceMs = 300 }) {
  return !!running && (!!locked || now - lockLostAt < graceMs);
}

// Back from alt-tab: 'relock' | 'done' (forget the blur) | 'wait' (keep it for a later focus with a gesture).
export function refocusAction({ lockedAtBlur, focused, running, blocked, locked }) {
  if (!lockedAtBlur || !focused) return 'wait';
  if (!running || blocked || locked) return 'done';
  return 'relock';
}

// Escape while the hammer's build wheel is (or was, until the lock loss of this very press) open: it belongs to
// the wheel. The wheel closes, the lock comes back and the pause menu stays shut.
export function escapeIsForBuild({ running, blocked, wheelOpen, now, closedByLockAt = -Infinity, windowMs = 1000 }) {
  if (!running || blocked) return false;
  return !!wheelOpen || now - closedByLockAt <= windowMs;
}

// After a menu closes during play and before the lock is back: hide the cursor and the click hint (body.relock).
// Never in drag-look, where the cursor is how you aim, and never while another menu is still open.
export function shouldMarkRelock({ playing, fallback, locked, dialogOpen }) {
  return !!playing && !fallback && !locked && !dialogOpen;
}
