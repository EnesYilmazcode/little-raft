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
// focused (a sandbox or permissions-policy denial is permanent) but one alone never switches, and one
// within `cooldown` ms of a lock loss the page did not cause (sinceUserExit) is Chrome's post-Esc cooldown: never counts.
export const USER_EXIT_COOLDOWN = 1500;
export function lockFailureVerdict({ supported = true, err, focused = true, failures = 0, maxFailures = 3, sinceUserExit = Infinity, cooldown = USER_EXIT_COOLDOWN } = {}) {
  if (!supported) return { fallback: true, failures };
  const kind = classifyLockError(err);
  if (kind === 'unsupported') return { fallback: true, failures };
  if (!focused) return { fallback: false, failures };
  if (kind === 'transient' && err.name !== 'SecurityError') return { fallback: false, failures };
  if (kind === 'transient' && sinceUserExit >= 0 && sinceUserExit < cooldown) return { fallback: false, failures };
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
