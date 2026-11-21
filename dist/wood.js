// A small original procedural timber texture, shared by every plank material.
// The incoming colour is only a key: it is weathered (sun-bleached, desaturated toward grey-olive) and
// painted per pixel once with grain streaks, worn dark board edges, dirt/moss blotches and nail stains.
// One canvas per colour, cached; no per-frame cost.
const W = 128, H = 512, cache = new Map();

function weathered(color) {
 const n = parseInt(String(color).replace('#', ''), 16) || 0xbb8a53;
 const r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
 const lum = 0.3 * r + 0.59 * g + 0.11 * b, k = 1, s = 0.8;
 // near-neutral grey-tan with the same luminance (the warm sun adds the yellow), darkened for a strong sun
 return [(r * (1 - k) + lum * 1.03 * k) * s, (g * (1 - k) + lum * 0.99 * k) * s, (b * (1 - k) + lum * 0.96 * k) * s];
}

function paint(color) {
 let h = 2166136261;
 for (const ch of String(color)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
 const seed = h >>> 0;
 const rnd = (() => { let s = seed || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
 const tab = new Float32Array(65536); for (let i = 0; i < 65536; i++) tab[i] = rnd();
 const hash = (x, y) => tab[(x & 255) | (y & 255) << 8];
 const sm = t => t * t * (3 - 2 * t);
 const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = sm(x - xi), fy = sm(y - yi);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a + (a - b + d - c) * fx) * fy; };
 const ph = rnd() * 50, freq = 0.42 + rnd() * 0.25, tone = 0.86 + rnd() * 0.22, grey = rnd() * 0.35;
 // per-colour board tone: some boards greyer, some browner
 const [wr, wg, wb] = weathered(color), wl = (wr + wg + wb) / 3;
 const br = wr + (wl - wr) * grey, bg = wg + (wl - wg) * grey, bb = wb + (wl * 0.97 - wb) * grey;
 const knots = [0, 1].filter(() => rnd() < 0.6).map(() => [30 + rnd() * 68, 90 + rnd() * 330, 2.5 + rnd() * 2]);
 const cracks = [0, 1, 2].map(() => [10 + rnd() * 108, rnd() * 400, 40 + rnd() * 160]);
 const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
 const ctx = canvas.getContext('2d'), img = ctx.createImageData(W, H), px = img.data;
 for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  // mostly straight grain with gentle drift, broken dark streaks and fine fibres
  const warp = (vn(x / 40, y / 160 + ph) - 0.5) * 7 + Math.sin(y * 0.011 + ph) * 1.5;
  let gx = x + warp, knot = 1;
  for (const [kx, ky, kr] of knots) {
   const dx = x - kx, dy = (y - ky) / 2.6;
   if (Math.abs(dx) > 26 || Math.abs(dy) > 26) continue;
   const d2 = dx * dx + dy * dy, d = Math.sqrt(d2);
   gx += dx * kr * kr * 1.6 / (d2 + 4);
   knot *= d < kr ? 0.55 + 0.15 * d / kr : d < kr * 1.7 ? 0.84 : 1;
  }
  const s = Math.sin(gx * freq + vn(gx / 5, y / 90) * 4);
  const streak = (s > 0 ? (s * s) ** 4 : 0) * (0.35 + 0.9 * vn(x / 10 + 50, y / 60));
  const fibre = hash(Math.floor(gx * 1.3), Math.floor(y / 40)) * 0.6 + hash(x, y) * 0.4;
  let v = tone * knot * (1.05 - streak * 0.34 - fibre * 0.13 + (s < -0.5 ? 0.04 : 0));
  // sun-bleached vs dirty patches
  const blot = vn(x / 26 + 7, y / 70);
  v *= 0.9 + blot * 0.2;
  // worn darker board edges (plank top spans roughly u 0.13..0.87) and ends
  const ex = Math.min(Math.abs(x - 17), Math.abs(x - 111), x, W - 1 - x), ey = Math.min(y, H - 1 - y);
  v *= 1 - 0.24 * Math.max(0, 1 - ex / 9) - 0.18 * Math.max(0, 1 - ey / 26);
  // dirt bands where the planks sit on the logs
  const band = Math.min(Math.abs(y - 68), Math.abs(y - 444));
  v *= 1 - 0.1 * Math.max(0, 1 - band / 22) * (0.5 + blot);
  for (const [cx, cy, cl] of cracks) if (y > cy && y < cy + cl && Math.abs(gx - cx) < 0.8) v *= 0.62;
  let r = br * v, g = bg * v, b = bb * v;
  // mossy / algae blotches, strongest near ends and edges
  const moss = Math.max(0, Math.min(1, (vn(x / 18 + 31, y / 40) - 0.62) * 4)) * (0.45 + 0.55 * Math.max(0, 1 - Math.min(ex, ey) / 30));
  if (moss > 0) { const m = moss * 0.5; r += (r * 0.72 - r) * m; g += (g * 0.86 - g) * m; b += (b * 0.55 - b) * m; }
  // rust stains under nail heads
  for (const nx of [36, 92]) { const d = Math.hypot(x - nx, (band) * 0.9); if (d < 9 && hash(nx, y > 256 ? 1 : 0) > 0.3) { const k = (1 - d / 9) * 0.35; r *= 1 - k * 0.35; g *= 1 - k * 0.55; b *= 1 - k * 0.7; } }
  const i = (y * W + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
 }
 ctx.putImageData(img, 0, 0);
 return canvas;
}

export function createWoodMaterial(T, color) {
 if (!cache.has(color)) cache.set(color, paint(color));
 const texture = new T.CanvasTexture(cache.get(color)); texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = 4;
 return new T.MeshStandardMaterial({map:texture, bumpMap:texture, bumpScale:.03, roughness:.95, metalness:0});
}
