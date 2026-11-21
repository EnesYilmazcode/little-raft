// Little Raft texture noise kit: small, seamless (periodic) noise for texgen/*.js generators.
// Every function takes coordinates in "cells" and a period p (integer cells across the tile),
// so sampling x,y in [0,p) tiles perfectly. Pure JS, no DOM: runs in Node, workers and pages.

const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const mix = lerp;

// Integer hash -> [0,1). Seeded so each generator gets its own pattern.
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const wrap = (i, p) => { const r = i % p; return r < 0 ? r + p : r; }; // same as ((i % p) + p) % p, one modulo

// Mulberry32 sequence RNG.
export function rng(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Lattice cache for vnoise: hash2 values of one (px, py, seed) lattice, filled once and then just read.
// Open-addressed table (linear probing, never evicts until clearNoiseCache); a generator uses <= ~10
// lattices of <= a few thousand points. When the table is half full or a lattice is huge, vnoise falls
// back to hashing. Values are the exact hash2 doubles (Float64Array), so output is bit-identical.
const LC_SLOTS = 256, LC_LIMIT = LC_SLOTS >> 1, LC_MAX = 1 << 16;
const lcPx = new Int32Array(LC_SLOTS), lcPy = new Int32Array(LC_SLOTS), lcSeed = new Int32Array(LC_SLOTS), lcTab = new Array(LC_SLOTS).fill(null);
let lcCount = 0;
function lattice(px, py, seed) {
  let slot = (Math.imul(px, 73856093) ^ Math.imul(py, 19349663) ^ Math.imul(seed, 83492791)) >>> 24; // top 8 bits
  for (;;) {
    const t = lcTab[slot];
    if (t === null) break;
    if (lcPx[slot] === px && lcPy[slot] === py && lcSeed[slot] === seed) return t;
    slot = (slot + 1) & (LC_SLOTS - 1);
  }
  if (lcCount >= LC_LIMIT) return null;
  const n = new Float64Array(px * py);
  for (let j = 0; j < py; j++) for (let i = 0; i < px; i++) n[j * px + i] = hash2(i, j, seed);
  lcPx[slot] = px; lcPy[slot] = py; lcSeed[slot] = seed; lcTab[slot] = n; lcCount++;
  return n;
}
// Drop cached lattices (textures.js calls this after the atlas build so the tables can be collected).
export function clearNoiseCache() { lcTab.fill(null); lcCount = 0; }

// Periodic value noise in [0,1]. px/py: integer periods in x and y.
export function vnoise(x, y, px, py = px, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), u = fade(x - xi), v = fade(y - yi);
  const L = (px | 0) === px && (py | 0) === py && (seed | 0) === seed && px > 0 && py > 0 && px * py <= LC_MAX ? lattice(px, py, seed) : null;
  if (L !== null) {
    let x0 = xi % px; if (x0 < 0) x0 += px;
    let y0 = yi % py; if (y0 < 0) y0 += py;
    const x1 = x0 + 1 === px ? 0 : x0 + 1, r0 = y0 * px, r1 = (y0 + 1 === py ? 0 : y0 + 1) * px;
    return lerp(lerp(L[r0 + x0], L[r0 + x1], u), lerp(L[r1 + x0], L[r1 + x1], u), v);
  }
  const x0 = wrap(xi, px), x1 = wrap(xi + 1, px), y0 = wrap(yi, py), y1 = wrap(yi + 1, py);
  return lerp(lerp(hash2(x0, y0, seed), hash2(x1, y0, seed), u), lerp(hash2(x0, y1, seed), hash2(x1, y1, seed), u), v);
}

// Periodic fBm in [0,1]: octaves double frequency and period, so tiling is preserved.
export function fbm(x, y, px, py = px, oct = 4, seed = 0, gain = 0.5) {
  let s = 0, a = 1, n = 0, f = 1;
  for (let o = 0; o < oct; o++) { s += a * vnoise(x * f, y * f, px * f, py * f, seed + o * 17); n += a; a *= gain; f *= 2; }
  return s / n;
}

// Periodic Worley (cellular) noise. Returns {f1, f2, id, cx, cy}: distances in cell units, id in [0,1),
// cx/cy = nearest feature point. Compares squared distances, one sqrt each for f1/f2 at the end.
const W = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 };
export function worley(x, y, px, py = px, seed = 0, jitter = 1) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let d1 = 81, d2 = 81, id = 0, cx = 0, cy = 0, gx1 = 0, gy1 = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const gx = wrap(xi + i, px), gy = wrap(yi + j, py);
    const ox = xi + i + 0.5 + (hash2(gx, gy, seed) - 0.5) * jitter, oy = yi + j + 0.5 + (hash2(gx, gy, seed + 9) - 0.5) * jitter;
    const dx = ox - x, dy = oy - y, d = dx * dx + dy * dy;
    if (d < d1) { d2 = d1; d1 = d; gx1 = gx; gy1 = gy; cx = ox; cy = oy; } else if (d < d2) d2 = d;
  }
  id = hash2(gx1, gy1, seed + 3);
  W.f1 = Math.sqrt(d1); W.f2 = Math.sqrt(d2); W.id = id; W.cx = cx; W.cy = cy;
  return W; // shared scratch object: copy fields before calling again
}

// Table-driven Worley for hot loops: hashes every feature point once (same points/ids as worley() with
// the same px, py, seed, jitter), then each sample is 9 table reads + squared distances, no hashing or
// modulo. Use: const wf = N.worleyGrid(p, p, seed, jitter); ... const w = wf(x, y); w.f1, w.f2, w.id.
// Returns its own scratch object (shared between calls of that wf). x, y may be any value (wrapped).
export function worleyGrid(px, py = px, seed = 0, jitter = 1) {
  const q = px + 2, n = q * (py + 2), T = new Float64Array(n * 3); // padded by one wrapped cell per side
  for (let k = 0; k < n; k++) {
    const gx = wrap((k % q) - 1, px), gy = wrap(((k / q) | 0) - 1, py);
    T[k * 3] = 0.5 + (hash2(gx, gy, seed) - 0.5) * jitter; T[k * 3 + 1] = 0.5 + (hash2(gx, gy, seed + 9) - 0.5) * jitter; T[k * 3 + 2] = hash2(gx, gy, seed + 3);
  }
  const r = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 };
  return (x, y) => {
    const fx = Math.floor(x), fy = Math.floor(y), bx = wrap(fx, px), by = wrap(fy, py), sx = x - fx + bx, sy = y - fy + by;
    let d1 = 81, d2 = 81, k1 = 0;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const k = ((by + j) * q + bx + i) * 3, dx = bx + i - 1 + T[k] - sx, dy = by + j - 1 + T[k + 1] - sy, d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; k1 = k; } else if (d < d2) d2 = d;
    }
    const i1 = (k1 / 3) % q, j1 = ((k1 / 3) / q) | 0;
    r.f1 = Math.sqrt(d1); r.f2 = Math.sqrt(d2); r.id = T[k1 + 2];
    r.cx = fx + i1 - 1 - bx + T[k1]; r.cy = fy + j1 - 1 - by + T[k1 + 1]; // in the caller's coordinates
    return r;
  };
}
