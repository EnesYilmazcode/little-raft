// Little Raft — sailing core (pure JS: no THREE, no DOM).
// "The world moves, the raft stays at the origin": this module owns the shared sailing state
// (wind, sail, anchor, virtual raft velocity and the water/seabed offsets) and steps it.
// Contract: docs/cloud/sailing-spec.md. Unit tests: tests/sailing.test.mjs.

const TAU = Math.PI * 2;

export const SAIL = Object.freeze({
  SAIL_SPEED: 1.3,          // m/s at full wind with one sail facing downwind
  CURRENT_X: 0, CURRENT_Z: 0.30, // constant ocean current (m/s), same as baseline debris drift (+z)
  TAU_UP: 4, TAU_DOWN: 3,   // velocity easing time-constants (s): speeding up / slowing down
  MAX_DT: 0.1,
  WIND_RATE: 0.05,          // max wind direction change (rad/s)
  WIND_SWING: Math.PI / 3,  // re-rolled target = windDir ± up to this ...
  WIND_LIMIT: Math.PI * 100 / 180, // ... then clamped to ±100° of +z so wind and current roughly agree
  WIND_STR_TAU: 20,         // windStr eases toward windStrTarget (s)
  WIND_MIN: 0.55, WIND_MAX: 1,
  WIND_CLOCK_MIN: 70, WIND_CLOCK_MAX: 140, WIND_CLOCK_CAP: 200,
  PADDLE_IMPULSE: 0.25, PADDLE_CAP: 1.1, PADDLE_COOLDOWN: 0.8, // paddling alone never exceeds PADDLE_CAP
  V_CLAMP: 3,               // validator clamp on |vx|,|vz|
  // Offsets wrap per axis into [-W/2, W/2). Water offsets feed a float32 shader (hash noise) so they
  // stay small; seabed offsets only need bounded float64 precision.
  WATER_WRAP: 65536,        // the ocean shader takes mod(uFlow, 512.) for its fine detail
  GROUND_WRAP: 105000,      // 350 * 2*ISLAND_WRAP, so wrapped islands never jump
  ISLAND_WRAP: 150,
  MAX_SAILS: 3,
  TARGET_CAP: 2.0,          // sail + engine target cap (m/s)
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
  num('windTarget', -Infinity, Infinity); s.windTarget = normAngle(s.windTarget);
  num('heading', -Infinity, Infinity); s.heading = normAngle(s.heading);
  num('windStr', SAIL.WIND_MIN, SAIL.WIND_MAX);
  num('windStrTarget', SAIL.WIND_MIN, SAIL.WIND_MAX);
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

/** Diminishing multi-sail bonus: 1, 1.1, 1.2 (capped at 3 sails); 0 with no sails. */
export function sailFactor(n) {
  if (!fin(n) || n < 1) return 0;
  return 1 + 0.1 * (Math.min(Math.floor(n), SAIL.MAX_SAILS) - 1);
}

/** Target water-relative velocity from the sail; writes out.x, out.z. */
export function sailTarget(state, nSails, out) {
  out.x = 0; out.z = 0;
  if (!state.raised || state.anchored) return out;
  const f = sailFactor(nSails);
  if (f <= 0) return out;
  const c = Math.cos(state.heading - state.windDir);
  if (!(c > 0)) return out;
  const m = SAIL.SAIL_SPEED * state.windStr * c * f;
  out.x = Math.sin(state.heading) * m;
  out.z = Math.cos(state.heading) * m;
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
 * Advance the state by dt. opts = {nSails, host, rng, blockers, push}. push = optional {x,z} engine target (m/s)
 * added to the sail target (ignored while anchored; the sum is capped at SAIL.TARGET_CAP). out receives
 * dwx,dwz (water-relative raft displacement) and dgx,dgz (seabed displacement) for this step.
 */
export function stepSailing(state, dt, opts, out) {
  out.dwx = 0; out.dwz = 0; out.dgx = 0; out.dgz = 0;
  if (!fin(dt) || dt <= 0) return;
  if (dt > SAIL.MAX_DT) dt = SAIL.MAX_DT;
  const o = opts || DEFAULTS;
  const CX = SAIL.CURRENT_X, CZ = SAIL.CURRENT_Z;

  if (state.paddleClock > 0) state.paddleClock = Math.max(0, state.paddleClock - dt);

  // Wind wander (authoritative side only).
  if (o.host) {
    const rng = typeof o.rng === 'function' ? o.rng : Math.random;
    state.windClock -= dt;
    if (!(state.windClock > 0)) {
      const L = SAIL.WIND_LIMIT;
      state.windTarget = clamp(normAngle(state.windDir + (rng() * 2 - 1) * SAIL.WIND_SWING), -L, L);
      state.windStrTarget = SAIL.WIND_MIN + rng() * (SAIL.WIND_MAX - SAIL.WIND_MIN);
      state.windClock = SAIL.WIND_CLOCK_MIN + rng() * (SAIL.WIND_CLOCK_MAX - SAIL.WIND_CLOCK_MIN);
    }
    const diff = normAngle(state.windTarget - state.windDir);
    const step = Math.min(Math.abs(diff) * 0.1, SAIL.WIND_RATE) * dt;
    state.windDir = normAngle(state.windDir + clamp(diff, -step, step));
    state.windStr = clamp(state.windStr + (state.windStrTarget - state.windStr) * (1 - Math.exp(-dt / SAIL.WIND_STR_TAU)),
      SAIL.WIND_MIN, SAIL.WIND_MAX);
  }

  // Velocity eases toward the sail target (framerate independent).
  sailTarget(state, o.nSails, _t);
  const p = o.push;
  if (p && !state.anchored && fin(p.x) && fin(p.z) && (p.x || p.z)) {
    _t.x += p.x; _t.z += p.z;
    const m2 = _t.x * _t.x + _t.z * _t.z, C = SAIL.TARGET_CAP;
    if (m2 > C * C) { const s = C / Math.sqrt(m2); _t.x *= s; _t.z *= s; }
  }
  const up = _t.x * _t.x + _t.z * _t.z > state.vx * state.vx + state.vz * state.vz;
  const k = 1 - Math.exp(-dt / (up ? SAIL.TAU_UP : SAIL.TAU_DOWN));
  state.vx += (_t.x - state.vx) * k;
  state.vz += (_t.z - state.vz) * k;

  if (state.anchored) {
    // Anchored: the raft holds still and so does the water around it (dw = dg = 0), so the current no longer
    // carries debris past (Raft: no flotsam while anchored). The ocean shader keeps its own wave motion.
    out.dwx = 0; out.dwz = 0;
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
