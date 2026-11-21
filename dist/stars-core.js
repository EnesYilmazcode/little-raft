// Shooting-star nights, pure core (docs/specs/stars.md). No THREE, no DOM: runs under node:test.
// Everything is a pure function of the daynight {seed, clock}, so host and guest see the same sky with no net
// traffic beyond the wish action and the small world.ext.stars slice. Salts 61-72 (daynight/storm use 1-7).
import { DAY_SECONDS, hash01, weatherAt } from './daynight.js?build=v3-survival-ae77fa84ac2b';

export const SHOWER = Object.freeze({ P: 0.45, FROM: 0.70, TO: 0.95, GAP: 4, JIT: 3, SLOTS: 75, CAP: 5, SLACK: 2 });
export const GAP_P = 0.07;          // share of slots with no meteor
export const LIFE_MIN = 0.6, LIFE_SPAN = 0.5;
export const TINTS = Object.freeze([0xffffff, 0xffe9a8, 0xbff5e6]); // white, pale gold, seafoam
export const GIFTS = Object.freeze([['flowerseed', 3], ['berries', 3], ['coconut', 2], ['honey', 2], ['rope', 2], ['glass', 2], ['candle', 1], ['skyrocket', 1]]);
export const NOTICE_PHASE = 0.64;   // dusk notice, before beds allow sleep (.66)
export const COUNT_MAX = 1e6;
const START = SHOWER.FROM * DAY_SECONDS; // 840 s into the day
const D2R = Math.PI / 180;
const clamp01 = u => (u < 0 ? 0 : u > 1 ? 1 : u);
const isInt = v => Number.isInteger(v);

// ---------------------------------------------------------------- night choice
const RAIN_F = [0.70, 0.82, 0.95];
const WX = { weather: 'calm', weatherNext: 'calm', blend: 0, rain: 0, wind: 0, cloud: 0 };
let memoSeed = NaN, memoDay = NaN, memoOn = false;
function rainyNight(seed, day) {
  const base = day * DAY_SECONDS;
  for (let i = 0; i < RAIN_F.length; i++) if (weatherAt(seed, base + RAIN_F[i] * DAY_SECONDS, WX).weather === 'rain') return true;
  return false;
}
// force: optional Set of day indexes (QA override, never saved) that always count as shower nights.
export function isShowerNight(seed, day, force = null) {
  if (force && force.size && force.has(day)) return true;
  if (!(day >= 1) || !isInt(day) || !Number.isFinite(seed)) return false;
  if (seed === memoSeed && day === memoDay) return memoOn;
  const on = (day === 1 || hash01(seed, day, 61) < SHOWER.P) && !rainyNight(seed, day);
  memoSeed = seed; memoDay = day; memoOn = on;
  return on;
}
// Days until the next shower night after `day` (1..max), or -1 when none within max days.
export function nextShowerIn(seed, day, max = 10, force = null) {
  for (let d = 1; d <= max; d++) if (isShowerNight(seed, day + d, force)) return d;
  return -1;
}

// ---------------------------------------------------------------- meteor schedule
export function makeMeteor() { return { ok: false, day: 0, k: 0, t0: 0, life: 0, tint: 0, a: { x: 0, y: 1, z: 0 }, b: { x: 0, y: 1, z: 0 } }; }
function setDir(o, az, el) { const c = Math.cos(el); o.x = c * Math.cos(az); o.y = Math.sin(el); o.z = c * Math.sin(az); return o; }
function clampEl(o, minEl) { // keep the azimuth, lift the elevation to at least minEl (radians)
  const el = Math.asin(Math.max(-1, Math.min(1, o.y)));
  if (el >= minEl) return o;
  return setDir(o, Math.atan2(o.z, o.x), minEl);
}
// Meteor k (0..74) of night `day`. Writes out and returns it; out.ok is false for a gap slot or a bad k.
export function meteorAt(seed, day, k, out = makeMeteor()) {
  out.day = day; out.k = k;
  if (!isInt(k) || k < 0 || k >= SHOWER.SLOTS || !isInt(day) || day < 0) { out.ok = false; return out; }
  const id = day * 128 + k;
  if (hash01(seed, id, 62) < GAP_P) { out.ok = false; return out; }
  out.ok = true;
  out.t0 = day * DAY_SECONDS + START + k * SHOWER.GAP + SHOWER.JIT * hash01(seed, id, 63);
  out.life = LIFE_MIN + LIFE_SPAN * hash01(seed, id, 64);
  out.tint = Math.min(2, Math.floor(3 * hash01(seed, id, 68)));
  // radiant of the night, then a start 8-30 deg from it, travelling away from it by 12-25 deg
  const raz = 2 * Math.PI * hash01(seed, day, 65), rel = (50 + 20 * hash01(seed, day, 71)) * D2R;
  const d0 = (8 + 22 * hash01(seed, id, 72)) * D2R, len = (12 + 13 * hash01(seed, id, 67)) * D2R, phi = 2 * Math.PI * hash01(seed, id, 66);
  const ce = Math.cos(rel), se = Math.sin(rel), ca = Math.cos(raz), sa = Math.sin(raz);
  // radiant R, east E, north N (orthonormal); the path runs in the plane of R and w = cos(phi) E + sin(phi) N
  const Rx = ce * ca, Ry = se, Rz = ce * sa;
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const wx = cp * -sa + sp * (-se * ca), wy = sp * ce, wz = cp * ca + sp * (-se * sa);
  const c0 = Math.cos(d0), s0 = Math.sin(d0), c1 = Math.cos(d0 + len), s1 = Math.sin(d0 + len);
  out.a.x = c0 * Rx + s0 * wx; out.a.y = c0 * Ry + s0 * wy; out.a.z = c0 * Rz + s0 * wz;
  out.b.x = c1 * Rx + s1 * wx; out.b.y = c1 * Ry + s1 * wy; out.b.z = c1 * Rz + s1 * wz;
  clampEl(out.a, 20 * D2R); clampEl(out.b, 12 * D2R);
  return out;
}
// Normalised lerp of a -> b at u = clamp((t - t0) / life). out gets {x, y, z}; returns u.
export function headDir(m, t, out) {
  const u = clamp01((t - m.t0) / m.life);
  const x = m.a.x + (m.b.x - m.a.x) * u, y = m.a.y + (m.b.y - m.a.y) * u, z = m.a.z + (m.b.z - m.a.z) * u;
  const l = Math.hypot(x, y, z) || 1;
  out.x = x / l; out.y = y / l; out.z = z / l;
  return u;
}
// Caller-owned list of up to 3 alive meteors: {n, m:[meteor x3]}.
export function makeAlive() { return { n: 0, day: -1, m: [makeMeteor(), makeMeteor(), makeMeteor()] }; }
// Fill `list` with the meteors alive at `clock` (t0 <= clock < t0 + life). O(1), no allocation.
export function aliveAt(seed, clock, list, force = null) {
  list.n = 0;
  if (!Number.isFinite(clock) || clock < 0) return list;
  const day = Math.floor(clock / DAY_SECONDS); list.day = day;
  if (!isShowerNight(seed, day, force)) return list;
  const k = Math.floor((clock - day * DAY_SECONDS - START) / SHOWER.GAP);
  for (let j = k - 1; j <= k + 1 && list.n < 3; j++) {
    if (j < 0 || j >= SHOWER.SLOTS) continue;
    const m = meteorAt(seed, day, j, list.m[list.n]);
    if (m.ok && clock >= m.t0 && clock < m.t0 + m.life) list.n++;
  }
  return list;
}
const LAST = { seed: NaN, day: NaN, k: -1 };
// The night's last scheduled (non-gap) slot.
export function lastSlot(seed, day) {
  if (LAST.seed === seed && LAST.day === day) return LAST.k;
  let k = SHOWER.SLOTS - 1; const id0 = day * 128;
  while (k >= 0 && hash01(seed, id0 + k, 62) < GAP_P) k--;
  LAST.seed = seed; LAST.day = day; LAST.k = k;
  return k;
}

// ---------------------------------------------------------------- wishes (host)
export function giftFor(seed, day, k, actor) {
  const h = hash01(seed, day * 128 + k, actor === 'guest' ? 70 : 69);
  let total = 0; for (const [, w] of GIFTS) total += w;
  let x = h * total;
  for (const [id, w] of GIFTS) { if (x < w) return id; x -= w; }
  return GIFTS[GIFTS.length - 1][0];
}
const CHECK_M = makeMeteor();
// Validate a wish {day, k} by actor at the host clock. On ok, slice.night is reset to a.day first (a new night).
// Returns {ok:true, m} or {ok:false, why}. Never mutates anything on a refusal except that night reset.
export function checkWish(slice, actor, seed, clock, a, force = null) {
  if (!a || typeof a !== 'object' || !isInt(a.day) || !isInt(a.k)) return { ok: false, why: 'bad' };
  if (actor !== 'host' && actor !== 'guest') return { ok: false, why: 'bad' };
  if (!isShowerNight(seed, a.day, force)) return { ok: false, why: 'night' };
  const m = meteorAt(seed, a.day, a.k, CHECK_M);
  if (!m.ok) return { ok: false, why: 'gap' };
  if (!(clock >= m.t0 - SHOWER.SLACK && clock <= m.t0 + m.life + SHOWER.SLACK)) return { ok: false, why: 'time' };
  if (slice.night.day !== a.day) { slice.night.day = a.day; slice.night.host = []; slice.night.guest = []; }
  const list = slice.night[actor];
  if (list.includes(a.k)) return { ok: false, why: 'repeat' };
  if (list.length >= SHOWER.CAP) return { ok: false, why: 'cap' };
  return { ok: true, m };
}

// ---------------------------------------------------------------- slice
export function defaultStars() { return { v: 1, wishes: { host: 0, guest: 0 }, night: { day: -1, host: [], guest: [] } }; }
const count = v => (Number.isFinite(v) ? Math.max(0, Math.min(COUNT_MAX, Math.floor(v))) : 0);
function cleanList(v) {
  const out = [];
  if (Array.isArray(v)) for (const k of v) { if (out.length >= SHOWER.CAP) break; if (isInt(k) && k >= 0 && k < SHOWER.SLOTS && !out.includes(k)) out.push(k); }
  return out;
}
export function cleanStars(d) {
  const s = defaultStars();
  if (!d || typeof d !== 'object' || Array.isArray(d)) return s;
  const w = d.wishes && typeof d.wishes === 'object' ? d.wishes : {};
  s.wishes.host = count(w.host); s.wishes.guest = count(w.guest);
  const n = d.night && typeof d.night === 'object' ? d.night : {};
  if (isInt(n.day) && n.day >= 0 && n.day <= COUNT_MAX * 10) { s.night.day = n.day; s.night.host = cleanList(n.host); s.night.guest = cleanList(n.guest); }
  return s;
}
export function serializeStars(s) {
  return { v: 1, wishes: { host: s.wishes.host, guest: s.wishes.guest }, night: { day: s.night.day, host: s.night.host.slice(), guest: s.night.guest.slice() } };
}
// Copy a clean slice into an existing one in place (cheap net load). Returns true when anything changed.
export function copyStars(dst, src) {
  let ch = false;
  if (dst.wishes.host !== src.wishes.host) { dst.wishes.host = src.wishes.host; ch = true; }
  if (dst.wishes.guest !== src.wishes.guest) { dst.wishes.guest = src.wishes.guest; ch = true; }
  if (dst.night.day !== src.night.day) { dst.night.day = src.night.day; ch = true; }
  for (const who of ['host', 'guest']) {
    const a = dst.night[who], b = src.night[who];
    let same = a.length === b.length;
    for (let i = 0; same && i < a.length; i++) if (a[i] !== b[i]) same = false;
    if (!same) { a.length = 0; for (let i = 0; i < b.length; i++) a.push(b[i]); ch = true; }
  }
  return ch;
}
