// Decoration pack + writable signs: pure logic (no DOM, no THREE, no imports).
// Slice world.ext.decorpack = { v, r, s, t: { 'x,z': [line, ...] }, rot: { 'x,z': 0..3 } }.
// Rotation and text never live on world.decor entries (cleanWorld keeps only type, x and z).

export const PACK = Object.freeze(['rug', 'pennant', 'fern', 'chime', 'hammock', 'pots', 'sign']);
export const MAX_LINES = 3, LINE_MAX = 18, MAX_SIGNS = 32, MAX_ROT = 400, REACH = 3.2, HOST_SLACK = .8;
export const keyOf = (x, z) => x + ',' + z;

const isInt = Number.isInteger;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const KEY = /^(-?\d{1,3}),(-?\d{1,3})$/;
const STRIP = /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu; // Cs: lone surrogates
const RAW_MAX = 256; // code units kept before cleaning, so a huge string costs nothing

/** Up to 3 trimmed lines of at most 18 code points, controls/format chars removed. Never throws. */
export function cleanLines(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (let i = 0; i < MAX_LINES && i < v.length; i++) {
    let s = '';
    try { s = String(v[i] ?? ''); } catch { s = ''; }
    if (s.length > RAW_MAX) s = s.slice(0, RAW_MAX); // a split pair at the cut becomes a lone surrogate, stripped below
    try { s = s.normalize('NFC'); } catch { /* lone surrogates are fine for normalize; keep s */ }
    s = s.replace(STRIP, '').replace(/\s+/g, ' ').trim();
    out.push(Array.from(s).slice(0, LINE_MAX).join(''));
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

export function linesKey(lines) { return Array.isArray(lines) ? lines.join('\n') : ''; }

/** Quarter-turn index so a +Z-facing model faces along (dx, dz). */
export function faceRot(dx, dz) {
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return 0;
  const r = ((Math.round(Math.atan2(dx, dz) / (Math.PI / 2)) % 4) + 4) % 4;
  return Number.isFinite(r) ? r : 0;
}

const canonKey = k => { const m = KEY.exec(k); return m ? keyOf(+m[1], +m[2]) : null; };

/** Validate a slice. With a decor array, also drop text on non-sign tiles and rot on non-pack tiles. */
export function cleanSlice(data, decor) {
  const out = { r: 0, s: null, t: {}, rot: {} };
  if (!isObj(data)) return out;
  if (isInt(data.r) && data.r >= 0 && data.r < Number.MAX_SAFE_INTEGER) out.r = data.r;
  if (typeof data.s === 'string' && data.s.length <= 16) out.s = data.s;
  let types = null;
  if (Array.isArray(decor)) {
    types = new Map();
    for (const d of decor) if (d && isInt(d.x) && isInt(d.z)) types.set(keyOf(d.x, d.z), d.type);
  }
  if (isObj(data.rot)) {
    let n = 0;
    for (const k of Object.keys(data.rot)) {
      if (n >= MAX_ROT) break;
      const key = canonKey(k), v = data.rot[k];
      if (!key || !isInt(v) || v < 0 || v > 3) continue;
      if (types && !PACK.includes(types.get(key))) continue;
      out.rot[key] = v; n++;
    }
  }
  if (isObj(data.t)) {
    let n = 0;
    for (const k of Object.keys(data.t)) {
      if (n >= MAX_SIGNS) break;
      const key = canonKey(k); if (!key) continue;
      if (types && types.get(key) !== 'sign') continue;
      const lines = cleanLines(data.t[k]); if (!lines.length) continue;
      out.t[key] = lines; n++;
    }
  }
  return out;
}

/**
 * Apply one 'decor.*' action to st. env: { decorAt(x,z) -> type|null, pos(actor) -> {x,z}|null }.
 * Checks everything before changing anything. Returns {ok, reason?, key?, same?, lines?}.
 */
export function applyDecorAction(st, a, actor, env) {
  const no = reason => ({ ok: false, reason });
  if (!st || !a || typeof a !== 'object' || typeof a.kind !== 'string') return no('bad');
  const verb = a.kind === 'decor.turn' ? 'turn' : a.kind === 'decor.write' ? 'write' : null;
  if (!verb) return no('bad');
  if (!isInt(a.x) || !isInt(a.z)) return no('notarget');
  let type = null;
  try { type = env?.decorAt?.(a.x, a.z) ?? null; } catch { type = null; }
  if (verb === 'turn' ? !PACK.includes(type) : type !== 'sign') return no('notarget');
  let p = null;
  try { p = env?.pos?.(actor) ?? null; } catch { p = null; }
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || Math.hypot(p.x - a.x * 2, p.z - a.z * 2) > REACH + HOST_SLACK) return no('far');
  const key = keyOf(a.x, a.z);
  if (verb === 'turn') {
    if (!(key in st.rot) && Object.keys(st.rot).length >= MAX_ROT) return no('fullrot');
    st.rot[key] = ((st.rot[key] ?? 0) + 1) & 3;
    st.r++;
    return { ok: true, key, rot: st.rot[key] };
  }
  const lines = cleanLines(a.lines);
  if (linesKey(lines) === linesKey(st.t[key] ?? [])) return { ok: true, same: true, key, lines };
  if (!lines.length) delete st.t[key];
  else {
    if (!(key in st.t) && Object.keys(st.t).length >= MAX_SIGNS) return no('full');
    st.t[key] = lines;
  }
  st.r++;
  return { ok: true, key, lines };
}
