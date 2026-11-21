// Little Raft - pure input helpers (no DOM, no THREE). Unit-tested in tests/input-r2.test.mjs.

// Keyboard: key state is always tracked (so keys held through a panel still count when it closes),
// but actions only fire when no panel is open. Typing in a form field neither records nor acts.
export function keyDecision({inField = false, blocked = false} = {}) {
  return {record: !inField, act: !inField && !blocked};
}

// Mouse look: a spike filter instead of a hard clamp. A move much larger than the running average
// is held for one event; it is applied together with the next event if that one continues the
// motion (a real flick), and dropped otherwise (an isolated pointer-lock spike).
// reset({dropFirst:true}) also discards the very first move after the lock is gained.
export function createLookFilter({floor = 400, ratio = 4, keep = .25} = {}) {
  let held = null, avg = 0, dropNext = false;
  function filter(dx, dy) {
    dx = Number.isFinite(dx) ? dx : 0; dy = Number.isFinite(dy) ? dy : 0;
    if (dropNext) { dropNext = false; return [0, 0]; }
    const m = Math.hypot(dx, dy);
    if (!held && m > Math.max(floor, ratio * avg)) { held = {dx, dy, m}; return [0, 0]; }
    let ox = dx, oy = dy;
    if (held) { const h = held; held = null; if (dx * h.dx + dy * h.dy > 0 && m >= h.m * keep) { ox += h.dx; oy += h.dy; } }
    avg = avg * .6 + Math.hypot(ox, oy) * .4;
    return [ox, oy];
  }
  function reset({dropFirst = false} = {}) { held = null; avg = 0; dropNext = !!dropFirst; }
  return {filter, reset};
}

// Frame stepping: split a real frame time into n equal steps of at most maxStep seconds,
// after capping the frame at cap seconds (a long stall must not teleport the player).
export function splitSteps(dt, maxStep = .05, cap = .25) {
  dt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, cap) : 0;
  if (dt <= 0) return {n: 0, step: 0};
  const n = Math.ceil(dt / maxStep - 1e-9);
  return {n, step: dt / n};
}
