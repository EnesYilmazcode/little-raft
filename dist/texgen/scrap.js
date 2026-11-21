// Scrap metal sheet: grey steel (#7D8288) with soft-haloed, pitted rust patches (#8A4A24-#A85D2E),
// faded chipped paint (mostly blue #4F7EA0, some red #A23A2A), fine diagonal scratches that brighten the
// bare metal, a riveted overlap strip (v 0..0.15) with a panel line, and one shallow dent.
// UV scale: one tile ~ 1 m of sheet (8 rivets, ~12 cm apart). Seamless on S; deterministic.
// Roughness: steel ~0.42-0.52, scratches ~0.38, rust 0.88-0.94, paint ~0.86.
export const normalStrength = 7;

const STEEL = [0.49, 0.51, 0.533], RUST_D = [0.541, 0.29, 0.141], RUST_L = [0.659, 0.365, 0.18];
const BLUE = [0.36, 0.53, 0.66], RED = [0.66, 0.27, 0.2], PIT = [0.43, 0.22, 0.11], HALO = [0.58, 0.46, 0.37];

export default function generate(S, N) {
  const { hash2, smooth, clamp01 } = N;
  // Fast periodic value noise: lattice tables built once, so the per-pixel loop does no hashing.
  const tab = (px, py, seed) => { const t = new Float32Array(px * py); for (let j = 0; j < py; j++) for (let i = 0; i < px; i++) t[j * px + i] = hash2(i, j, seed); return { t, px, py }; };
  const vn = ({ t, px, py }, x, y) => {
    let xi = Math.floor(x), yi = Math.floor(y); const fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
    xi %= px; if (xi < 0) xi += px; yi %= py; if (yi < 0) yi += py;
    const x1 = xi + 1 === px ? 0 : xi + 1, r0 = yi * px, r1 = (yi + 1 === py ? 0 : yi + 1) * px;
    const a = t[r0 + xi] + (t[r0 + x1] - t[r0 + xi]) * u, b = t[r1 + xi] + (t[r1 + x1] - t[r1 + xi]) * u;
    return a + (b - a) * w;
  };
  const oct = (p, n, seed) => Array.from({ length: n }, (_, o) => tab(p << o, p << o, seed + o * 17));
  const fb = (T, u, v) => { let s = 0, a = 1, n = 0; for (let o = 0; o < T.length; o++) { s += a * vn(T[o], u * T[o].px, v * T[o].py); n += a; a *= 0.5; } return s / n; };
  const RUST = oct(3, 3, 11), PAINT = oct(3, 3, 23), TONE = oct(5, 2, 61);
  const FINE = tab(24, 24, 7), PIT_N = tab(40, 40, 5), CHIP = tab(28, 28, 29), HUE = tab(2, 2, 41), SMASK = tab(3, 3, 57);
  const BR = tab(2, 96, 67), S1 = tab(4, 70, 51), S2 = tab(3, 50, 53);
  // Low-frequency fields at half resolution, bilinearly upsampled (wrapped) in the main loop.
  const L = S >> 1, LO = [0, 1, 2, 3, 4, 5].map(() => new Float32Array(L * L));
  for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) {
    const u = x / L, v = y / L, k = y * L + x;
    LO[0][k] = fb(RUST, u, v); LO[1][k] = fb(PAINT, u, v); LO[2][k] = fb(TONE, u, v); LO[3][k] = vn(HUE, u * 2, v * 2); LO[4][k] = vn(SMASK, u * 3, v * 3); LO[5][k] = vn(CHIP, u * 28, v * 28);
  }
  const lo = new Float32Array(6);
  const albedo = new Float32Array(S * S * 3), height = new Float32Array(S * S), rough = new Float32Array(S * S);
  const RIV = 8, RIV_V = 0.075, RIV_R = 0.026, SEAM = 0.15; // rivets per tile, rivet row v, radius, panel line v
  const DU = 0.62, DV = 0.62, DR2 = 0.018;                   // dent centre and size (wrapped gaussian)
  const gw = (t, c) => { const e = Math.min(Math.abs(t - c), 1 - Math.abs(t - c)); return Math.exp(-e * e / DR2); }; // wrapped gaussian (separable)
  const DX = Float32Array.from({ length: S }, (_, x) => gw(x / S, DU));
  for (let y = 0; y < S; y++) {
    const v = y / S, dy = gw(v, DV), strip = v < SEAM ? 1 : 0, seamD = Math.abs(v - SEAM) * S, seam = seamD < 2 ? 1 - seamD / 2 : 0;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x, fine = vn(FINE, u * 24, v * 24);
      { const gx = x / 2, gy = y / 2, x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0, x1 = (x0 + 1) % L, r0 = y0 * L, r1 = ((y0 + 1) % L) * L;
        for (let f = 0; f < 6; f++) { const A = LO[f], a = A[r0 + x0] + (A[r0 + x1] - A[r0 + x0]) * fx; lo[f] = a + (A[r1 + x0] + (A[r1 + x1] - A[r1 + x0]) * fx - a) * fy; } }
      // rust: thresholded fbm with a soft halo, lumpy and pitted inside
      const rn = lo[0] + (fine - 0.5) * 0.06;
      const rust = smooth(0.565, 0.595, rn), halo = smooth(0.48, 0.565, rn) * (1 - rust);
      const deep = smooth(0.6, 0.68, rn), pit = rust < 0.01 ? 0 : rust * smooth(0.68, 0.8, vn(PIT_N, u * 40, v * 40));
      // paint: faded patches with ragged chipped edges, kept off the rivet strip; rust eats through it
      const pn = lo[1] + (lo[5] - 0.5) * 0.14 + (fine - 0.5) * 0.05;
      const paint = smooth(0.635, 0.645, pn) * (1 - smooth(0.55, 0.57, rn)) * (1 - strip);
      const chip = smooth(0.6, 0.635, pn) * (1 - paint) * (1 - rust) * (1 - strip);
      const red = smooth(0.58, 0.6, lo[3]), sm = smooth(0.4, 0.6, lo[4]) * (1 - rust) * (1 - paint);
      // diagonal scratches (integer slopes and periods keep them seamless), clustered by a low-frequency mask
      const scr = sm < 0.01 ? 0 : sm * Math.max(smooth(0.82, 0.9, vn(S1, (u + v) * 4, (v - u) * 70)), smooth(0.86, 0.93, vn(S2, (u - 2 * v) * 3, (v + 2 * u) * 50)));
      // rivet domes with a shallow ring, dent
      const du = ((u * RIV) % 1 - 0.5) / RIV, dv = v - RIV_V, rd2 = (du * du + dv * dv) / (RIV_R * RIV_R);
      const dome = rd2 < 1 ? Math.sqrt(1 - rd2) : 0, ring = rd2 >= 1 && rd2 < 1.8 ? 1 : 0;
      const dent = DX[x] * dy;
      // colour
      const tone = (0.9 + 0.16 * lo[2] + 0.07 * vn(BR, u * 2, v * 96)) * (1 - dent * 0.06) * (1 + strip * 0.04), o = i * 3;
      for (let c = 0; c < 3; c++) {
        let a = STEEL[c] * tone + scr * 0.2;
        a += (HALO[c] - a) * halo * 0.65;
        a += (RUST_L[c] + (RUST_D[c] - RUST_L[c]) * clamp01(deep + (0.5 - fine) * 0.6) - a) * rust;
        a += (PIT[c] - a) * pit * 0.6;
        a += ((BLUE[c] + (RED[c] - BLUE[c]) * red) * (0.94 + 0.12 * fine) - a) * paint;
        a += (0.66 - a) * chip * 0.35;
        a *= 1 - seam * 0.35 - ring * 0.1;
        a += (0.72 - a) * dome * dome * 0.55;
        albedo[o + c] = clamp01(a);
      }
      // height (0.5 base): paint sits proud, rust is lumpy with pits, strip overlaps, rivets dome up
      height[i] = 0.5 + paint * 0.06 + rust * (fine - 0.5) * 0.12 - pit * 0.1 + strip * 0.06
        - seam * 0.08 + dome * 0.35 - dent * 0.35 - scr * 0.015;
      // roughness (absolute)
      let r = 0.43 + 0.1 * fine - scr * 0.07;
      r += (0.88 + 0.06 * fine - r) * Math.max(rust, halo * 0.5);
      r += (0.86 - r) * paint;
      rough[i] = clamp01(r + (0.38 - r) * dome * 0.8);
    }
  }
  return { albedo, height, rough };
}
