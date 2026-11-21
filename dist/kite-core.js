// Sky Kite pure core (docs/specs/kite.md). No THREE, no DOM: imported by dist/kite.js and tests/kite.test.mjs.
// The kite has no integrator: its pose is a closed-form function of anchor, wind, line, steer, tug and time.

export const LINES = Object.freeze([8, 16, 24]);
export const STEER_MAX = 0.9, MAX_TIED = 6, TUG = 0.25, TUG_T = 1.2, LAUNCH_T = 3, REEL_MPS = 2;
export const SPOT_MIN = 90, SPOT_MAX = 150, SPOT_S = 0.85, PULL_T = 10, PULL_MPS = 2.5, LINE_N = 17, TAIL_N = 8;
export const TIE_TYPES = Object.freeze(Object.assign(Object.create(null), { railing: 1, pillar: 1, gate: 1, halfwall: 1 }));
export const KINDS = Object.freeze(['kite_sunburst', 'kite_gullwing', 'kite_tidestripe']);
export const KEY_RE = /^(railing|pillar|gate|halfwall):(-?\d{1,2}),(-?\d{1,2}),([0-5]),([0-3])$/; // paint PIECE_RE, tie types only
const LEVEL_H = 2.2, MAX_REV = 1e9, DEBRIS = Object.freeze({ wood: 1, leaf: 1, scrap: 1, plastic: 1, barrel: 1 });

const fin = Number.isFinite;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = x => x * x * (3 - 2 * x);
const num = (x, d) => (fin(x) ? x : d);
/** b - a wrapped to -PI..PI. */
export function angDiff(a, b) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
/** Steer quantised to 0.05 for the network. */
export const qSteer = s => (fin(s) ? Math.round(clamp(s, -STEER_MAX, STEER_MAX) * 20) / 20 : 0);
export const pieceKey = rec => rec.t + ':' + rec.i + ',' + rec.j + ',' + rec.l + ',' + rec.r;

/** Apparent wind -> out.{az, s}. sail: world.sailing ({windDir, windStr, vx, vz}); weather: daynight wind 0..1. */
export function windOf(sail, weather, out) {
  const ok = sail && typeof sail === 'object';
  const dir = ok && fin(sail.windDir) ? sail.windDir : 0.6, str = ok && fin(sail.windStr) ? sail.windStr : 0.8;
  const vx = ok && fin(sail.vx) ? sail.vx : 0, vz = ok && fin(sail.vz) ? sail.vz : 0;
  const w = fin(weather) ? weather : 0.5;
  let x = Math.sin(dir) * str - vx, z = Math.cos(dir) * str - vz, m = Math.hypot(x, z);
  if (!(m > 1e-9)) { x = 0; z = 0.3; m = 0.3; } else if (m < 0.3) { x *= 0.3 / m; z *= 0.3 / m; m = 0.3; }
  out.az = Math.atan2(x, z);
  out.s = clamp(m * (0.75 + 0.6 * w), 0.3, 1.25);
  return out;
}

/** Closed-form kite pose. Writes out.{x,y,z,yaw,pitch,roll,e}; reads out.dSteer (the caller's steer rate). */
export function kitePose(ax, ay, az0, W, L, steer, tug, launch, t, phase, waterY, out) {
  ax = num(ax, 0); ay = num(ay, 0); az0 = num(az0, 0);
  const s = clamp(num(W?.s, 0.3), 0.3, 1.25), wa = num(W?.az, 0);
  L = clamp(num(L, 16), 0, 60); steer = clamp(num(steer, 0), -STEER_MAX, STEER_MAX);
  tug = clamp(num(tug, 0), 0, 1); launch = clamp(num(launch, 1), 0, 1);
  t = num(t, 0) % 1e5; phase = num(phase, 0); waterY = num(waterY, 0);
  const a = wa + steer;
  const e = (lerp(0.25, 1.05, smooth(clamp((s - 0.3) / 0.95, 0, 1))) * (0.6 + 0.4 * Math.cos(steer)) + tug) * lerp(0.1, 1, launch);
  const ce = Math.cos(e), sa = Math.sin(a), ca = Math.cos(a), wob = 0.5 * s * Math.sin(1.3 * t + phase);
  let x = ax + L * ce * sa + ca * wob, y = ay + L * Math.sin(e) + 0.35 * Math.sin(0.9 * t + 2 * phase), z = az0 + L * ce * ca - sa * wob;
  if (y < waterY + 2) y = waterY + 2;
  const dx = ax - x, dy = ay - y, dz = az0 - z;
  out.x = x; out.y = y; out.z = z; out.e = e;
  out.yaw = Math.atan2(dx, dz); out.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  out.roll = -steer * 0.6 + clamp(num(out.dSteer, 0), -3, 3) * 0.3;
  return out;
}

/** Ease line, steer, launch and tug (frame-rate independent). True once a landing has finished (launch reached 0). */
export function easeInputs(st, dt) {
  dt = fin(dt) && dt > 0 ? Math.min(dt, 5) : 0;
  const Lt = LINES.includes(st.Lt) ? st.Lt : 16;
  let L = num(st.L, Lt); const step = REEL_MPS * dt;
  L = Math.abs(Lt - L) <= step ? Lt : L + Math.sign(Lt - L) * step;
  st.L = L;
  const prev = clamp(num(st.steer, 0), -STEER_MAX, STEER_MAX), target = clamp(num(st.steerT, prev), -STEER_MAX, STEER_MAX);
  const steer = prev + (target - prev) * (1 - Math.exp(-3 * dt));
  st.steer = steer; st.dSteer = dt > 0 ? (steer - prev) / dt : 0;
  let launch = clamp(num(st.launch, 0), 0, 1);
  launch = st.landing ? Math.max(0, launch - dt) : Math.min(1, launch + dt / LAUNCH_T + 1e-9);
  st.launch = launch;
  st.tug = Math.max(0, clamp(num(st.tug, 0), 0, 1) - (TUG / TUG_T) * dt);
  return !!st.landing && launch <= 0;
}

/** Steer target from the camera yaw: look left of downwind to steer left. Holds prev while looking upwind. */
export function steerFromYaw(camYaw, az, prev) {
  const p = fin(prev) ? clamp(prev, -STEER_MAX, STEER_MAX) : 0;
  if (!fin(camYaw) || !fin(az)) return p;
  const d = angDiff(az, camYaw + Math.PI); // the camera looks down -Z
  if (Math.abs(d) > 1.6) return p;
  return clamp(d, -STEER_MAX, STEER_MAX);
}

/** World tie point {x,y,z} for a piece record, or null for a type that cannot hold a kite. */
export function anchorOf(rec, deckY) {
  if (!rec || TIE_TYPES[rec.t] !== 1 || !fin(rec.i) || !fin(rec.j) || !fin(rec.l)) return null;
  const pillar = rec.t === 'pillar', y = num(deckY, 0) + rec.l * LEVEL_H + (pillar ? 2.0 : rec.t === 'halfwall' ? 1.1 : 0.95);
  if (pillar) return { x: 2 * rec.i - 1, y, z: 2 * rec.j - 1 };
  return rec.r ? { x: 2 * rec.i - 1, y, z: 2 * rec.j } : { x: 2 * rec.i, y, z: 2 * rec.j - 1 };
}

const cleanFly = f => {
  if (!f || typeof f !== 'object') return null;
  const { p, L, s } = f;
  if (!Number.isInteger(p) || p < 0 || p > 2 || !LINES.includes(L) || !fin(s) || Math.abs(s) > STEER_MAX) return null;
  return { p, L, s: qSteer(s) };
};
/** Validated copy of world.ext.kite. Never throws. fly survives only a net load (a save always lands kites). */
export function cleanKite(raw, from) {
  const out = { v: 1, rev: 0, fly: { h: null, g: null }, tied: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (fin(raw.rev)) out.rev = clamp(Math.floor(raw.rev), 0, MAX_REV);
  if (Array.isArray(raw.tied)) {
    const seen = new Set();
    for (const e of raw.tied) {
      if (out.tied.length >= MAX_TIED) break;
      if (!e || typeof e !== 'object' || typeof e.k !== 'string' || !KEY_RE.test(e.k) || seen.has(e.k)) continue;
      const f = cleanFly(e); if (!f) continue;
      seen.add(e.k); out.tied.push({ k: e.k, p: f.p, L: f.L, s: f.s });
    }
  }
  if (from === 'net' && raw.fly && typeof raw.fly === 'object') { out.fly.h = cleanFly(raw.fly.h); out.fly.g = cleanFly(raw.fly.g); }
  return out;
}

/** Spot threshold (s of good flying) for the n-th spot. Deterministic, SPOT_MIN..SPOT_MAX. */
export function spotDue(clock, n, seed) {
  const x = Math.sin(((n | 0) + 1) * 12.9898 + num(seed, 0)) * 43758.5;
  return SPOT_MIN + (x - Math.floor(x)) * (SPOT_MAX - SPOT_MIN);
}

/** Nearest floating debris 14..70 m from (cx,cz), not cache/bottle/unknown, not in held. No allocations. */
export function pickDebris(items, held, cx, cz, out) {
  if (!Array.isArray(items)) return null;
  let best = null, bd = Infinity;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || DEBRIS[it.type] !== 1 || !fin(it.x) || !fin(it.z)) continue;
    if (held && held.has(it.token)) continue;
    const d = Math.hypot(it.x - cx, it.z - cz);
    if (d < 14 || d > 70 || d >= bd) continue;
    best = it; bd = d;
  }
  if (out && typeof out === 'object') out.d = best ? bd : 0;
  return best;
}

/** Sagging kite string from A to K into out (LINE_N*3 floats). */
export function linePoints(A, K, L, s, out) {
  const sag = Math.max(0, num(L, 16) * 0.05 * (1.3 - clamp(num(s, 0.5), 0.3, 1.25))), n = LINE_N - 1;
  for (let i = 0; i <= n; i++) {
    const u = i / n, k = i * 3;
    out[k] = A.x + (K.x - A.x) * u; out[k + 1] = A.y + (K.y - A.y) * u - sag * 4 * u * (1 - u); out[k + 2] = A.z + (K.z - A.z) * u;
  }
  return out;
}

/** Ribbon tail from K (the kite's lower tip) trailing downwind with a travelling wave, into out (TAIL_N*3 floats). */
export function tailPoints(K, W, t, out) {
  const a = num(W?.az, 0), sx = Math.sin(a), sz = Math.cos(a), tt = num(t, 0) % 1e5, n = TAIL_N - 1;
  for (let i = 0; i <= n; i++) {
    const w = Math.sin(tt * 4 - i * 0.9) * 0.2 * (i / n), k = i * 3;
    out[k] = K.x + sx * i * 0.42 + sz * w; out[k + 1] = K.y - i * 0.16; out[k + 2] = K.z + sz * i * 0.42 - sx * w;
  }
  return out;
}
