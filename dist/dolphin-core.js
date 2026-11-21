// Dolphin friend, pure logic (docs/specs/dolphin.md). No DOM, no THREE, no Date, no Math.random.
// State rules (befriend with 3 raw fish, pats, the Conch Call), behaviour choice and closed-form poses in the raft
// frame (world XZ, y relative to the water surface). Every pose function writes into `out` and allocates nothing.
import { cleanName, rnd } from './animals-core.js?build=v3-survival-ae77fa84ac2b';
import { dolphinMotion, pushOut, CIRCLER_MARGIN, DOLPHIN_LEAP } from './wildlife.js?build=v3-survival-ae77fa84ac2b';

export const FISH_NEED = 3, TOSS_CD = 8, TOSS_REACH = 18, PAT_REACH = 4, PAT_CD = 60, MAX_HEARTS = 10, HOST_SLACK = 2;
export const BEAT = 12, BLEND = 1.5, CALL_DUR = 20, CALL_CD = 30, ESC_RANGE = 25, ESC_SIDE = 1.8, ESC_AHEAD = 0.5;
export const BOOST = 1.15, BOOST_R = 4;
export const NUDGE_EVERY = 120, NUDGE_JIT = 20, NUDGE_DUR = 12, NUDGE_SPEED = 0.6, NUDGE_MIN = 8, NUDGE_MAX = 25, NUDGE_PLAYER = 6, NUDGE_NET = 3;
export const POINT_MAX = 14, SHOW_LEAP = 1.4;
export const OLD_HOST = 'Your friend’s raft doesn’t know any dolphins yet';
export const DOLPHIN_NAMES = Object.freeze(['Splash', 'Marina', 'Ripple', 'Nori', 'Skipper', 'Coral', 'Breeze', 'Pippa', 'Finn', 'Lumi', 'Tango', 'Wavelet']);
export const NUDGE_TYPES = Object.freeze(['wood', 'plastic', 'leaf', 'scrap', 'barrel']); // whitelist: never a cache, bottle or future type

const TAU = Math.PI * 2, FAR = -1e9, T_MAX = 1e9;
const WHO = ['host', 'guest'];
const fin = v => typeof v === 'number' && Number.isFinite(v);
const clampInt = (v, lo, hi, d) => (fin(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : d);
const smooth = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const who = v => (WHO.includes(v) ? v : '');
export const lerpAngle = (a, b, s) => { let d = b - a; d -= TAU * Math.round(d / TAU); return a + d * s; };

export const emptyState = () => ({ v: 1, r: 0, t: 0, seed: 0, pts: 0, tossAt: FAR, by: '', friend: false, name: '', hearts: 0,
  patAt: FAR, callAt: FAR, callWho: '', esc: '', nudge: null, nextNudge: NUDGE_EVERY, pops: 0 });

export const defaultName = seed => DOLPHIN_NAMES[(seed >>> 0) % DOLPHIN_NAMES.length];

/** Validated slice: junk -> emptyState(); numbers clamped, stamps <= t, names cleaned, nudge dropped (transient). */
export function cleanDolphin(v) {
  const out = emptyState();
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  out.r = clampInt(v.r, 0, T_MAX, 0);
  out.t = fin(v.t) ? Math.min(T_MAX, Math.max(0, v.t)) : 0;
  out.seed = fin(v.seed) ? v.seed >>> 0 : 0;
  out.friend = v.friend === true;
  out.pts = clampInt(v.pts, 0, FISH_NEED, 0);
  if (!out.friend && out.pts >= FISH_NEED) out.pts = FISH_NEED - 1;
  const stamp = x => (fin(x) ? Math.min(out.t, Math.max(FAR, x)) : FAR);
  out.tossAt = stamp(v.tossAt); out.patAt = stamp(v.patAt); out.callAt = stamp(v.callAt);
  out.by = who(v.by); out.callWho = who(v.callWho); out.esc = who(v.esc);
  out.name = out.friend ? cleanName(v.name) : '';
  if (out.friend && !out.name) out.name = defaultName(out.seed);
  out.hearts = clampInt(v.hearts, 0, MAX_HEARTS, 0);
  out.pops = clampInt(v.pops, 0, T_MAX, 0);
  const nn = fin(v.nextNudge) ? v.nextNudge : NUDGE_EVERY;
  out.nextNudge = Math.min(out.t + 600, Math.max(out.t, nn));
  out.nudge = null;
  return out;
}

/** Toss a raw fish to the wild dolphin (host). The caller sets seed, name and by on a bond. */
export function toss(st, bag, t, wildNear) {
  if (st.friend || !wildNear) return { ok: false, text: '', bonded: false };
  if (t < st.tossAt + TOSS_CD) return { ok: false, text: 'It’s still munching…', bonded: false };
  if (!bag || typeof bag.count !== 'function' || bag.count('fish') < 1) return { ok: false, text: 'Bring a raw fish', bonded: false };
  bag.remove('fish', 1);
  st.pts++; st.pops++; st.tossAt = t;
  if (st.pts >= FISH_NEED) { st.pts = FISH_NEED; st.friend = true; st.hearts = 1; return { ok: true, text: '', bonded: true }; }
  return { ok: true, text: `♥ ${st.pts}/${FISH_NEED}`, bonded: false };
}

/** Pat the friend. A heart at most once per PAT_CD; a pat on cooldown is still ok, just no heart. */
export function pat(st, t) {
  if (!st.friend) return { ok: false, heart: false };
  if (t < st.patAt + PAT_CD) return { ok: true, heart: false };
  st.hearts = Math.min(MAX_HEARTS, st.hearts + 1); st.patAt = t; st.pops++;
  return { ok: true, heart: true };
}

export function rename(st, name) {
  const n = cleanName(name);
  if (!n) return { ok: false, text: 'That name will not fit' };
  st.name = n;
  return { ok: true, text: `Your dolphin is now called ${n}` };
}

/** Blow the Conch Call. */
export function call(st, actor, t) {
  if (!st.friend) return { ok: false, text: 'No dolphin friend yet' };
  if (t < st.callAt + CALL_CD) return { ok: false, text: 'Still echoing… try again soon' };
  st.callAt = t; st.callWho = who(actor) || 'host';
  return { ok: true, text: '' };
}
export const calling = (st, t) => (st.callWho && t < st.callAt + CALL_DUR ? st.callWho : '');

/** Idle mode for the beat holding t: 'loop' | 'show' | 'point'. Beat 0 always loops. */
export function modeAt(seed, t, hasPoint) {
  const b = Math.floor(t / BEAT);
  if (b <= 0) return 'loop';
  if (hasPoint && rnd(seed, b) < 0.2) return 'point';
  if (b % 4 === 3) return 'show';
  return 'loop';
}
/** call > nudge > escort > point > show > loop */
export function behaviour(st, t, hasPoint) {
  if (calling(st, t)) return 'call';
  if (st.nudge) return 'nudge';
  if (st.esc) return 'escort';
  return modeAt(st.seed, t, hasPoint);
}

const escOk = (c, centre) => !!c && c.inWater === true && fin(c.x) && fin(c.z) && Math.hypot(c.x - centre.x, c.z - centre.z) <= ESC_RANGE;
/** Who the friend swims beside: keeps cur while valid, else host before guest, else ''. */
export function pickEscort(cands, centre, cur) {
  if (!Array.isArray(cands) || !centre) return '';
  if (cur) for (let i = 0; i < cands.length; i++) if (cands[i] && cands[i].who === cur && escOk(cands[i], centre)) return cur;
  for (const w of WHO) for (let i = 0; i < cands.length; i++) if (cands[i] && cands[i].who === w && escOk(cands[i], centre)) return w;
  return '';
}

const nearAny = (list, x, z, r) => {
  if (Array.isArray(list)) for (let i = 0; i < list.length; i++) { const p = list[i]; if (p && fin(p.x) && fin(p.z) && Math.hypot(p.x - x, p.z - z) <= r) return true; }
  return false;
};
/** The floating item to nose toward the deck, or null. held: optional Set of hooked tokens to skip. */
export function pickNudge(items, centre, players, nets, held = null) {
  if (!Array.isArray(items) || !centre) return null;
  const lo = Math.max(NUDGE_MIN, (fin(centre.r) ? centre.r : 0) + 3);
  let best = null, bd = Infinity;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || !NUDGE_TYPES.includes(it.type) || !fin(it.x) || !fin(it.z)) continue;
    if (held && typeof held.has === 'function' && held.has(it.token)) continue;
    const d = Math.hypot(it.x - centre.x, it.z - centre.z);
    if (d < lo || d > NUDGE_MAX || d >= bd) continue;
    if (nearAny(players, it.x, it.z, NUDGE_PLAYER) || nearAny(nets, it.x, it.z, NUDGE_NET)) continue;
    best = it; bd = d;
  }
  return best;
}

/** Move it toward the centre at NUDGE_SPEED. False once it is within centre.r + 3 (done). */
export function stepNudge(it, centre, dt) {
  const stop = (fin(centre.r) ? centre.r : 0) + 3, dx = centre.x - it.x, dz = centre.z - it.z, d = Math.hypot(dx, dz);
  if (!(d > stop)) return false;
  const s = Math.min(NUDGE_SPEED * (fin(dt) && dt > 0 ? dt : 0), d - stop);
  it.x += dx / d * s; it.z += dz / d * s;
  return d - s > stop + 1e-9;
}

export function nudgeAbort(st, it, t, players, nets) {
  if (!st || !st.nudge || !it || !fin(it.x) || !fin(it.z)) return true;
  if (t > st.nudge.at + NUDGE_DUR) return true;
  return nearAny(players, it.x, it.z, NUDGE_PLAYER) || nearAny(nets, it.x, it.z, NUDGE_NET);
}

export const nextNudgeAt = (seed, t, k) => t + NUDGE_EVERY + (rnd(seed, 1000 + k) * 2 - 1) * NUDGE_JIT;

// ------------------------------------------------------------------ poses (raft frame, y above the water surface)

export const newPose = () => ({ kind: 'dolphin', x: 0.5, y: 0.5, z: 0.5, heading: 0.5, pitch: 0.5, roll: 0.5 });
const safeExt = ext => (fin(ext) ? ext : 0);

/** Circling close to the raft with the wild dolphin's leap rhythm. */
export function loopPose(seed, t, ext, out) {
  const dir = rnd(seed, 1) < 0.5 ? -1 : 1, a = rnd(seed, 2) * TAU + dir * 0.32 * t;
  const R = 7 + 1.5 * Math.sin(0.07 * t) + pushOut(safeExt(ext), CIRCLER_MARGIN, 7);
  const c = Math.cos(a), s = Math.sin(a);
  out.x = R * c; out.z = R * s;
  out.heading = Math.atan2(-s * dir, c * dir); // tangent
  out.kind = 'dolphin';
  dolphinMotion(t, out);
  return out;
}

/** A leap show off the bow (-z): three leaps across a ±0.6 rad arc, back and forth. */
export function showPose(seed, t, ext, out) {
  const R = Math.max(0, safeExt(ext)) + 4, span = 3 * SHOW_LEAP, p = (t % (2 * span) + 2 * span) % (2 * span) / span;
  const fwd = p < 1, w = fwd ? p : 2 - p, a = -Math.PI / 2 - 0.6 + 1.2 * w;
  const c = Math.cos(a), s = Math.sin(a), dir = fwd ? 1 : -1;
  out.x = R * c; out.z = R * s;
  out.heading = Math.atan2(-s * dir, c * dir);
  out.kind = 'dolphin';
  dolphinMotion(((t % SHOW_LEAP) + SHOW_LEAP) % SHOW_LEAP / SHOW_LEAP * DOLPHIN_LEAP, out);
  return out;
}

const _loop = newPose();
/** Swim out toward target (signal cache or docked wreck), leap three times there, come back. ext: raft half-size. */
export function pointPose(seed, t, centre, target, out, ext = centre && fin(centre.r) ? centre.r : 0) {
  loopPose(seed, t, ext, _loop);
  const u = ((t % BEAT) + BEAT) % BEAT;
  let dx = target.x - centre.x, dz = target.z - centre.z;
  const d = Math.hypot(dx, dz);
  if (d > 1e-6) { dx /= d; dz /= d; } else { dx = 0; dz = -1; }
  const L = Math.min(POINT_MAX, d), px = centre.x + dx * L, pz = centre.z + dz * L, toward = Math.atan2(dx, dz);
  out.kind = 'dolphin';
  if (u >= 4 && u < 8) { // three leaps at P, nosing toward the target
    const q = (u - 4) / (4 / 3), f = q - Math.floor(q);
    out.x = px + dx * (f - 0.5) * 1.2; out.z = pz + dz * (f - 0.5) * 1.2; out.heading = toward;
    dolphinMotion(f * DOLPHIN_LEAP, out);
    return out;
  }
  const s = u < 4 ? smooth(u / 4) : 1 - smooth((u - 8) / 4);
  out.x = _loop.x + (px - _loop.x) * s; out.z = _loop.z + (pz - _loop.z) * s;
  out.heading = lerpAngle(_loop.heading, u < 4 ? toward : toward + Math.PI, Math.min(1, s * 3));
  out.y = _loop.y; out.pitch = _loop.pitch; out.roll = _loop.roll;
  return out;
}

/** ESC_SIDE to the right of and ESC_AHEAD in front of a player looking along yaw (camera YXZ: forward = (-sin, -cos)). */
export function followPose(target, yaw, out) {
  const y = fin(yaw) ? yaw : 0, rx = Math.cos(y), rz = -Math.sin(y), fx = -Math.sin(y), fz = -Math.cos(y);
  out.x = target.x + rx * ESC_SIDE + fx * ESC_AHEAD; out.z = target.z + rz * ESC_SIDE + fz * ESC_AHEAD;
  out.heading = Math.atan2(fx, fz);
  out.kind = 'dolphin';
  return out;
}

/** Behind the item on the far side from the centre, pushing it in, porpoising low. t drives the bob. */
export function nudgePose(it, centre, out, t = 0) {
  let dx = it.x - centre.x, dz = it.z - centre.z;
  const d = Math.hypot(dx, dz);
  if (d > 1e-6) { dx /= d; dz /= d; } else { dx = 0; dz = -1; }
  out.x = it.x + dx * 0.9; out.z = it.z + dz * 0.9;
  out.heading = Math.atan2(-dx, -dz);
  out.y = -0.18 + 0.14 * Math.sin(t * 2.4); out.pitch = -0.25 * Math.cos(t * 2.4); out.roll = 0;
  out.kind = 'dolphin';
  return out;
}
