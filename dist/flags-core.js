// Raft flag: pure logic and data (no DOM, no THREE, no imports). See docs/specs/raft-flag.md.
// Slice world.ext.flags = { v, r, s, f: { 'x,z': [bg, pat, patCol, emb, embCol] } }, small ints only.
// A design is 5 palette/list indices, so the palette and emblem list can grow by appending.

export const PALETTE = ['#fff4dc', '#f1c84d', '#e0694e', '#6fc3a8', '#4f93c9', '#24456b', '#33383d', '#8a5a8f']; // Cream, Sunshell, Coral, Seafoam, Lagoon, Navy, Charcoal, Plum
export const COLOR_NAMES = ['Cream', 'Sunshell', 'Coral', 'Seafoam', 'Lagoon', 'Navy', 'Charcoal', 'Plum'];
export const PATTERNS = ['plain', 'stripes', 'halves', 'cross', 'border', 'diagonal'];
export const EMBLEMS = ['none', 'shell', 'fish', 'star', 'gull', 'palm', 'anchor', 'sun', 'wave'];
// Original emblem art: filled closed shapes, viewBox 0 0 64 64, centred on (32,32), nonzero fill rule.
// Only M L H V C Q Z commands (no arcs), so the same strings feed Path2D, inline <svg> and tests.
export const EMBLEM_PATHS = Object.freeze({
  shell: 'M9.1 31.8 Q7.3 25.4 13.9 25.6 L20.8 31.6 L16.1 23.8 Q16.3 17.7 21.6 20.6 L26 28.6 L24.3 19.7 Q26.5 14 30.6 18.5 L32 27.5 L33.4 18.5 Q37.5 14 39.7 19.7 L38 28.6 L42.4 20.6 Q47.8 17.7 47.9 23.8 L43.2 31.6 L50.1 25.6 Q56.7 25.4 54.9 31.8 L40 50 L43 55 H21 L24 50 Z',
  fish: 'M10 32 C10 25 18 21 27 21 C36 21 41 27 43 32 C41 37 36 43 27 43 C18 43 10 39 10 32 Z M40 32 L54 20 L50 32 L54 44 Z M19 26.9 C17.6 26.9 16.4 28.1 16.4 29.5 C16.4 30.9 17.6 32.1 19 32.1 C20.4 32.1 21.6 30.9 21.6 29.5 C21.6 28.1 20.4 26.9 19 26.9 Z',
  star: 'M32 10 L37.9 25.9 L54.8 26.6 L41.5 37.1 L46.1 53.4 L32 44 L17.9 53.4 L22.5 37.1 L9.2 26.6 L26.1 25.9 Z',
  gull: 'M6 32 Q13 21 23 24 Q29 26 32 33 Q35 26 41 24 Q51 21 58 32 Q50 28 43 31 Q36 35 32 42 Q28 35 21 31 Q14 28 6 32 Z',
  palm: 'M26 57 C29 47 31 37 31 24 L35 24 C35 37 34 47 32 57 Z M33 23 Q18.9 15.6 7 28 Q20.2 26.7 33 26 Z M33 23 Q29.6 6.7 17 9 Q24.1 17.1 33 26 Z M33 23 Q35.7 6.9 48 9 Q41.5 17 33 26 Z M33 23 Q46.9 16.2 58 29 Q45.2 27.2 33 26 Z',
  anchor: 'M32 7.5 C35 7.5 37.5 10 37.5 13 C37.5 16 35 18.5 32 18.5 C29 18.5 26.5 16 26.5 13 C26.5 10 29 7.5 32 7.5 Z M32 10.4 C30.6 10.4 29.4 11.6 29.4 13 C29.4 14.4 30.6 15.6 32 15.6 C33.4 15.6 34.6 14.4 34.6 13 C34.6 11.6 33.4 10.4 32 10.4 Z M30 18 H34 V51 H30 Z M21 22 H43 V26 H21 Z M8 37 L17 33 L18 39 Q24 49 32 49 Q40 49 46 39 L47 33 L56 37 L50 40 Q44 56 32 56 Q20 56 14 40 Z',
  sun: 'M32 21 C38.1 21 43 25.9 43 32 C43 38.1 38.1 43 32 43 C25.9 43 21 38.1 21 32 C21 25.9 25.9 21 32 21 Z M44.7 29.3 L57 32 L44.7 34.7 Z M42.9 39.1 L49.7 49.7 L39.1 42.9 Z M34.7 44.7 L32 57 L29.3 44.7 Z M24.9 42.9 L14.3 49.7 L21.1 39.1 Z M19.3 34.7 L7 32 L19.3 29.3 Z M21.1 24.9 L14.3 14.3 L24.9 21.1 Z M29.3 19.3 L32 7 L34.7 19.3 Z M39.1 21.1 L49.7 14.3 L42.9 24.9 Z',
  wave: 'M7 28 C10 18 20 10 32 11 C42 12 47 19 44 23 C42 26 37 25 37 21 C37 18 32 17 28 20 C25 22 26 26 31 26 C40 26 48 25 57 23 L57 29 C44 32 20 30 7 28 Z M7 49 C10 39 20 31 32 32 C42 33 47 40 44 44 C42 47 37 46 37 42 C37 39 32 38 28 41 C25 43 26 47 31 47 C40 47 48 46 57 44 L57 50 C44 53 20 51 7 49 Z',
});
export const RANGES = [8, 6, 8, 9, 8]; // bg, pat, patCol, emb, embCol
export const DEFAULT = Object.freeze([1, 0, 5, 1, 5]); // sunshell, plain, navy, shell, navy
export const MAX_FLAGS = 24, REACH = 3.2, HOST_SLACK = .8;
export const keyOf = (x, z) => x + ',' + z;
export const designKey = d => d.join('.');

const isInt = Number.isInteger;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const KEY = /^(-?\d{1,3}),(-?\d{1,3})$/;
const canonKey = k => { const m = KEY.exec(k); return m ? keyOf(+m[1], +m[2]) : null; };
const okIdx = (v, i) => isInt(v) && v >= 0 && v < RANGES[i];

/** A fresh array of 5 ints. Lenient: each bad index takes DEFAULT[i]. Strict: anything off -> null. Never throws. */
export function cleanDesign(v, strict = false) {
  if (!Array.isArray(v)) return strict ? null : DEFAULT.slice();
  if (strict && v.length !== RANGES.length) return null;
  const out = new Array(RANGES.length);
  for (let i = 0; i < RANGES.length; i++) {
    const x = v[i];
    if (okIdx(x, i)) out[i] = x;
    else if (strict) return null;
    else out[i] = DEFAULT[i];
  }
  return out;
}

const tileTypes = decor => {
  const types = new Map();
  for (const d of decor) if (d && isInt(d.x) && isInt(d.z)) types.set(keyOf(d.x, d.z), d.type);
  return types;
};

/** Validate a slice -> { r, s, f }. With a decor array, keys whose tile is not a flagpole are dropped. */
export function cleanSlice(data, decor) {
  const out = { r: 0, s: null, f: {} };
  if (!isObj(data)) return out;
  if (isInt(data.r) && data.r >= 0 && data.r < Number.MAX_SAFE_INTEGER) out.r = data.r;
  if (typeof data.s === 'string' && data.s.length <= 16) out.s = data.s;
  const types = Array.isArray(decor) ? tileTypes(decor) : null;
  if (isObj(data.f)) {
    let n = 0;
    for (const k of Object.keys(data.f)) {
      if (n >= MAX_FLAGS) break;
      const key = canonKey(k); if (!key || key in out.f) continue;
      if (types && types.get(key) !== 'flagpole') continue;
      out.f[key] = cleanDesign(data.f[k]); n++;
    }
  }
  return out;
}

/** Delete entries whose tile is no longer a flagpole. Returns how many went; the caller bumps r. */
export function pruneSlice(st, decor) {
  if (!st || !isObj(st.f)) return 0;
  const types = tileTypes(Array.isArray(decor) ? decor : []);
  let n = 0;
  for (const k of Object.keys(st.f)) if (types.get(k) !== 'flagpole') { delete st.f[k]; n++; }
  return n;
}

/**
 * Apply one 'flag.set' action. env: { decorAt(x,z) -> type|null, pos(actor) -> {x,z}|null }.
 * Checks everything before changing anything. Returns {ok, reason?, key?, d?, same?}.
 */
export function applyFlagAction(st, a, actor, env) {
  const no = reason => ({ ok: false, reason });
  if (!st || !isObj(st.f) || !a || typeof a !== 'object' || a.kind !== 'flag.set') return no('bad');
  if (!isInt(a.x) || !isInt(a.z)) return no('notarget');
  let type = null;
  try { type = env?.decorAt?.(a.x, a.z) ?? null; } catch { type = null; }
  if (type !== 'flagpole') return no('notarget');
  let p = null;
  try { p = env?.pos?.(actor) ?? null; } catch { p = null; }
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || Math.hypot(p.x - a.x * 2, p.z - a.z * 2) > REACH + HOST_SLACK) return no('far');
  const d = cleanDesign(a.d, true);
  if (!d) return no('bad');
  const key = keyOf(a.x, a.z), cur = st.f[key];
  if (cur && designKey(cur) === designKey(d)) return { ok: true, same: true, key, d };
  if (!cur && Object.keys(st.f).length >= MAX_FLAGS) return no('full');
  st.f[key] = d;
  st.r++;
  return { ok: true, key, d };
}
