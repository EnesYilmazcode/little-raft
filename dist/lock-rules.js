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
// timeout ms, so a refused or revoked relock always shows the resume hint again. While the relock waits on a
// held Escape (escWaiting: game.js defers it to the key's release), the timeout does not end it: the clock
// restarts, and the release's relock (or its refusal) ends it instead.
export const RELOCK_TIMEOUT = 600;
export function relockPending({ locked = false, event = null, elapsed = 0, timeout = RELOCK_TIMEOUT, escWaiting = false } = {}) {
  if (locked || event === 'unlocked' || event === 'error') return false;
  if (escWaiting && !event) return true;
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
