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
const wrap = (i, p) => ((i % p) + p) % p;

// Mulberry32 sequence RNG.
export function rng(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Periodic value noise in [0,1]. px/py: integer periods in x and y.
export function vnoise(x, y, px, py = px, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), u = fade(x - xi), v = fade(y - yi);
  const x0 = wrap(xi, px), x1 = wrap(xi + 1, px), y0 = wrap(yi, py), y1 = wrap(yi + 1, py);
  return lerp(lerp(hash2(x0, y0, seed), hash2(x1, y0, seed), u), lerp(hash2(x0, y1, seed), hash2(x1, y1, seed), u), v);
}

// Periodic fBm in [0,1]: octaves double frequency and period, so tiling is preserved.
export function fbm(x, y, px, py = px, oct = 4, seed = 0, gain = 0.5) {
  let s = 0, a = 1, n = 0, f = 1;
  for (let o = 0; o < oct; o++) { s += a * vnoise(x * f, y * f, px * f, py * f, seed + o * 17); n += a; a *= gain; f *= 2; }
  return s / n;
}

// Periodic Worley (cellular) noise. Returns {f1, f2, id} distances in cell units, id in [0,1).
const W = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 };
export function worley(x, y, px, py = px, seed = 0, jitter = 1) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0, cx = 0, cy = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const gx = wrap(xi + i, px), gy = wrap(yi + j, py);
    const ox = xi + i + 0.5 + (hash2(gx, gy, seed) - 0.5) * jitter, oy = yi + j + 0.5 + (hash2(gx, gy, seed + 9) - 0.5) * jitter;
    const d = Math.hypot(ox - x, oy - y);
    if (d < f1) { f2 = f1; f1 = d; id = hash2(gx, gy, seed + 3); cx = ox; cy = oy; } else if (d < f2) f2 = d;
  }
  W.f1 = f1; W.f2 = f2; W.id = id; W.cx = cx; W.cy = cy;
  return W; // shared scratch object: copy fields before calling again
}
