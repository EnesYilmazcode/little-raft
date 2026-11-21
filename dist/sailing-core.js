// Little Raft — sailing core (pure JS: no THREE, no DOM).
// "The world moves, the raft stays at the origin": this module owns the shared sailing state
// (wind, sail, anchor, virtual raft velocity and the water/seabed offsets) and steps it.
// Contract: docs/cloud/sailing-spec.md. Unit tests: tests/sailing.test.mjs.

const TAU = Math.PI * 2;

// Raft-like model: the wind never changes direction and the ocean current flows with it, so an unsailed raft
// drifts downwind at DRIFT_SPEED. A raised sail steers up to 90° off the wind (slower when wider; a heading
// further upwind is clamped to 90°: the best it can do is sail sideways); one sail's worth only. Motors (engine.js) ignore the wind entirely.
const DRIFT = 0.30;
export const SAIL = Object.freeze({
  DRIFT_SPEED: DRIFT,       // ocean current (m/s), always along windDir: the unsailed drift
  SAIL_MULT: 1.5,           // sail ground speed straight downwind = 1.5x drift
  SAIL_SPEED: 1.5 * DRIFT,  // m/s, ground speed with the sail raised and heading straight downwind
  SAIL_ABEAM: 0.5,          // at 90° off the wind the sail keeps half its downwind speed (0.225 m/s)
  TAU_UP: 4, TAU_DOWN: 3,   // velocity easing time-constants (s): speeding up / slowing down
  MAX_DT: 0.1,
  WIND_SWING: 0,            // the wind never changes direction (windDir is saved and kept as is)
  WIND_MIN: 0.55, WIND_MAX: 1, // windStr (constant per save; flags/billow only, not speed)
  WIND_CLOCK_CAP: 200,      // legacy key, still validated so old saves round-trip
  PADDLE_IMPULSE: 0.25, PADDLE_CAP: 0.9, PADDLE_COOLDOWN: 0.8, // paddling alone never exceeds PADDLE_CAP
  V_CLAMP: 3,               // validator clamp on |vx|,|vz|
  // Offsets wrap per axis into [-W/2, W/2). Water offsets feed a float32 shader (hash noise) so they
  // stay small; seabed offsets only need bounded float64 precision.
  WATER_WRAP: 65536,        // the ocean shader takes mod(uFlow, 512.) for its fine detail
  GROUND_WRAP: 105000,      // 350 * 2*ISLAND_WRAP, so wrapped islands never jump
  ISLAND_WRAP: 150,
  TARGET_CAP: 2.0,          // ground-speed target cap (m/s)
});

const DEFAULTS = Object.freeze({
  v: 1, windDir: 0.6, windStr: 0.8, windTarget: 0.6, windStrTarget: 0.8, windClock: 100, heading: 0,
  raised: false, anchored: false, vx: 0, vz: 0, wx: 0, wz: 0, gx: 0, gz: 0,
});

const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** Normalize an angle to (-PI, PI]. */
function normAngle(a) {
  a -= TAU * Math.floor((a + Math.PI) / TAU);
  return a <= -Math.PI ? a + TAU : a;
}

/** Wrap v into [-W, W). */
export function wrapAxis(v, W) {
  if (!fin(v) || !(W > 0)) return 0;
  const p = 2 * W;
  return v - p * Math.floor((v + W) / p);
}

export function defaultSailing() { return { ...DEFAULTS }; }

/** Validator / migrator: always returns a fresh object with only the documented keys. Never throws. */
export function cleanSailing(v) {
  const s = defaultSailing();
  if (!v || typeof v !== 'object' || Array.isArray(v)) return s;
  const num = (k, lo, hi) => {
    let x;
    try { x = v[k]; } catch { return; }
    if (fin(x)) s[k] = clamp(x, lo, hi);
  };
  num('windDir', -Infinity, Infinity); s.windDir = normAngle(s.windDir);
  s.windTarget = s.windDir; // constant wind: an old save's mid-swing target is dropped
  num('heading', -Infinity, Infinity); s.heading = normAngle(s.heading);
  num('windStr', SAIL.WIND_MIN, SAIL.WIND_MAX);
  s.windStrTarget = s.windStr;
  num('windClock', 0, SAIL.WIND_CLOCK_CAP);
  num('vx', -SAIL.V_CLAMP, SAIL.V_CLAMP);
  num('vz', -SAIL.V_CLAMP, SAIL.V_CLAMP);
  for (const k of ['wx', 'wz', 'gx', 'gz']) {
    num(k, -Infinity, Infinity);
    s[k] = wrapAxis(s[k], (k[0] === 'w' ? SAIL.WATER_WRAP : SAIL.GROUND_WRAP) / 2);
  }
  try { if (typeof v.raised === 'boolean') s.raised = v.raised; } catch { /* ignore */ }
  try { if (typeof v.anchored === 'boolean') s.anchored = v.anchored; } catch { /* ignore */ }
  return s;
}

/** Extra sails do not stack: 1 with any sail, 0 with none. */
export function sailFactor(n) {
  return fin(n) && n >= 1 ? 1 : 0;
}

/** Sail course: `off` (radians off the wind) clamped to ±90° — the sail cannot point the raft upwind. */
export function sailOff(off) {
  if (!fin(off)) return 0;
  off = normAngle(off);
  const H = Math.PI / 2;
  return off > H ? H : off < -H ? -H : off;
}

/**
 * Sail ground-speed multiplier (x drift) for heading `off` radians off the wind (clamped to ±90°):
 * 1.5 * (0.5 + 0.5 * cos(off)) — 1.5 downwind, 0.75 abeam, never 0.
 */
export function sailMult(off) {
  if (!fin(off)) return 0;
  const c = Math.max(0, Math.cos(sailOff(off)));
  return SAIL.SAIL_MULT * (SAIL.SAIL_ABEAM + (1 - SAIL.SAIL_ABEAM) * c);
}

/** Ocean current (m/s): DRIFT_SPEED along the wind. Writes out.x, out.z. */
export function currentVector(state, out) {
  const d = state && fin(state.windDir) ? state.windDir : DEFAULTS.windDir;
  out.x = Math.sin(d) * SAIL.DRIFT_SPEED;
  out.z = Math.cos(d) * SAIL.DRIFT_SPEED;
  return out;
}

/**
 * Ground velocity the sail aims for (m/s) along the course (heading clamped to ±90° off the wind); zero when the
 * sail is lowered / anchored / absent. Writes out.x, out.z.
 */
export function sailGround(state, nSails, out) {
  out.x = 0; out.z = 0;
  if (!state.raised || state.anchored || sailFactor(nSails) <= 0 || !fin(state.heading) || !fin(state.windDir)) return out;
  const off = sailOff(state.heading - state.windDir), course = state.windDir + off;
  const m = sailMult(off) * SAIL.DRIFT_SPEED;
  out.x = Math.sin(course) * m;
  out.z = Math.cos(course) * m;
  return out;
}

const _c = { x: 0, z: 0 }; // module scratch: no per-call allocation

/** Target water-relative velocity from the sail (sail ground velocity minus the current); writes out.x, out.z. */
export function sailTarget(state, nSails, out) {
  sailGround(state, nSails, out);
  if (out.x === 0 && out.z === 0) return out;
  currentVector(state, _c);
  out.x -= _c.x; out.z -= _c.z;
  return out;
}

/** Wind vector (direction the wind blows toward, scaled by strength). */
export function windVector(state, out) {
  out.x = Math.sin(state.windDir) * state.windStr;
  out.z = Math.cos(state.windDir) * state.windStr;
  return out;
}

const _t = { x: 0, z: 0 }; // module scratch: no per-call allocation

/**
 * Advance the state by dt. opts = {nSails, host, rng, blockers, push}. push = optional {x,z} engine ground velocity
 * (m/s): the motor ignores the wind, so while it is faster than the sail it replaces the sail's ground target (no
 * stacking; ignored while anchored; capped at SAIL.TARGET_CAP). out receives dwx,dwz (water-relative raft
 * displacement) and dgx,dgz (seabed displacement) for this step. The wind never changes (host or guest).
 */
export function stepSailing(state, dt, opts, out) {
  out.dwx = 0; out.dwz = 0; out.dgx = 0; out.dgz = 0;
  if (!fin(dt) || dt <= 0) return;
  if (dt > SAIL.MAX_DT) dt = SAIL.MAX_DT;
  const o = opts || DEFAULTS;
  currentVector(state, _c);
  const CX = _c.x, CZ = _c.z;

  if (state.paddleClock > 0) state.paddleClock = Math.max(0, state.paddleClock - dt);

  // Velocity (water-relative) eases toward the target ground velocity minus the current (framerate independent).
  // No sail target = 0: the raft drifts with the current.
  sailGround(state, o.nSails, _t);
  const p = o.push;
  if (p && !state.anchored && fin(p.x) && fin(p.z) && (p.x || p.z) && p.x * p.x + p.z * p.z > _t.x * _t.x + _t.z * _t.z) {
    _t.x = p.x; _t.z = p.z;
  }
  if (_t.x !== 0 || _t.z !== 0) {
    const m2 = _t.x * _t.x + _t.z * _t.z, C = SAIL.TARGET_CAP;
    if (m2 > C * C) { const s = C / Math.sqrt(m2); _t.x *= s; _t.z *= s; }
    _t.x -= CX; _t.z -= CZ;
  }
  const up = _t.x * _t.x + _t.z * _t.z > state.vx * state.vx + state.vz * state.vz;
  const k = 1 - Math.exp(-dt / (up ? SAIL.TAU_UP : SAIL.TAU_DOWN));
  state.vx += (_t.x - state.vx) * k;
  state.vz += (_t.z - state.vz) * k;

  if (state.anchored) {
    out.dwx = -CX * dt; out.dwz = -CZ * dt;
  } else {
    // Grounding: remove seabed-velocity components pointing toward nearby blockers.
    // b.r is the full stop distance (island radius + clearance + raft radius).
    const bl = o.blockers;
    if (bl && bl.length) {
      for (let i = 0; i < bl.length; i++) {
        const b = bl[i];
        if (!b || !fin(b.x) || !fin(b.z)) continue;
        const r = fin(b.r) ? b.r : 0, d2 = b.x * b.x + b.z * b.z;
        if (!(d2 > 1e-12) || d2 >= r * r) continue;
        const d = Math.sqrt(d2), nx = b.x / d, nz = b.z / d;
        const toward = (state.vx + CX) * nx + (state.vz + CZ) * nz;
        if (toward > 0) { state.vx -= toward * nx; state.vz -= toward * nz; }
      }
    }
    out.dwx = state.vx * dt; out.dwz = state.vz * dt;
    out.dgx = (state.vx + CX) * dt; out.dgz = (state.vz + CZ) * dt;
  }
  const HW = SAIL.WATER_WRAP / 2, HG = SAIL.GROUND_WRAP / 2;
  state.wx = wrapAxis(state.wx + out.dwx, HW); state.wz = wrapAxis(state.wz + out.dwz, HW);
  state.gx = wrapAxis(state.gx + out.dgx, HG); state.gz = wrapAxis(state.gz + out.dgz, HG);
}

/** Apply a validated {kind:'sail', op, heading?, angle?} action. Returns notice text or ''. */
export function applySailAction(state, a) {
  if (!state || !a || typeof a !== 'object') return '';
  switch (a.op) {
    case 'raise': state.raised = true; return 'Sail raised';
    case 'lower': state.raised = false; return 'Sail lowered';
    case 'toggle': state.raised = !state.raised; return state.raised ? 'Sail raised' : 'Sail lowered';
    case 'anchor': state.anchored = true; return 'Anchor dropped';
    case 'unanchor': state.anchored = false; return 'Anchor raised';
    case 'toggleAnchor': state.anchored = !state.anchored; return state.anchored ? 'Anchor dropped' : 'Anchor raised';
    case 'heading':
      if (fin(a.heading)) state.heading = normAngle(a.heading);
      return '';
    case 'paddle': {
      if (!fin(a.angle) || state.anchored || state.paddleClock > 0) return '';
      const s0 = Math.hypot(state.vx, state.vz);
      state.vx += Math.sin(a.angle) * SAIL.PADDLE_IMPULSE;
      state.vz += Math.cos(a.angle) * SAIL.PADDLE_IMPULSE;
      // Paddling may steer/slow a fast raft but never speed it past max(PADDLE_CAP, current speed).
      const cap = Math.max(SAIL.PADDLE_CAP, s0), sp = Math.hypot(state.vx, state.vz);
      if (sp > cap) { state.vx *= cap / sp; state.vz *= cap / sp; }
      state.paddleClock = SAIL.PADDLE_COOLDOWN; // runtime-only; cleanSailing drops it
      return '';
    }
    default: return '';
  }
}

/**
 * Rotate a freshly spawned item (placed upstream of a +z flow) about the centre (cx,cz) so it is upstream of
 * flow (fx,fz). Rotation keeps the distance to the centre and maps the +z axis onto the flow direction.
 */
export function placeUpstream(it, fx, fz, cx = 0, cz = 0) {
  if (!it || !fin(fx) || !fin(fz) || !fin(cx) || !fin(cz) || fx * fx + fz * fz < 0.0025) return it;
  // Angle mapping +z (0,1) onto (fx,fz) in compass convention: dir(a) = (sin a, cos a).
  const a = Math.atan2(fx, fz), s = Math.sin(a), c = Math.cos(a);
  const x = it.x - cx, z = it.z - cz;
  it.x = cx + x * c + z * s;
  it.z = cz - x * s + z * c;
  return it;
}

/** True if the item is beyond R from the centre (cx,cz) and moving away from it along the flow. */
export function driftedOut(it, fx, fz, R, cx = 0, cz = 0) {
  const x = it.x - cx, z = it.z - cz;
  return x * x + z * z > R * R && (x * fx + z * fz) > 0;
}
