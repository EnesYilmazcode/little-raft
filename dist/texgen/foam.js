// Foam: sea-foam patches for ocean crests, raft-edge foam and the demo (repeat 2x2 => ~half a tile
// per metre of water). Bubbly lace = walls between Worley cells (f2-f1 rims) at P=8, 16, 32, masked by
// warped low-frequency fbm coverage: dense creamy cores, lacy fringes, clear holes (alpha 0 = water).
// White #F4FAFA, thin film between walls tinted faint cyan. Roughness ~0.5.
export const normalStrength = 3;

const LAYERS = [[8, 3, 0.10, 1], [16, 7, 0.12, 0.8], [32, 13, 0.16, 0.6]]; // [period, seed, wall width, weight]
const WHITE = [0xF4 / 255, 0xFA / 255, 0xFA / 255], CYAN = [0.72, 0.9, 0.92];

// Site table padded by one wrapped cell per side, so the inner loop needs no modulo.
function sites(N, p, seed) {
  const q = p + 2, t = new Float64Array(q * q * 2);
  for (let k = 0; k < q * q; k++) {
    const gx = (k % q + p - 1) % p, gy = ((k / q | 0) + p - 1) % p;
    t[k * 2] = 0.1 + 0.8 * N.hash2(gx, gy, seed); t[k * 2 + 1] = 0.1 + 0.8 * N.hash2(gx, gy, seed + 9);
  }
  return t;
}
// Seamless Worley f2-f1 (distance to the nearest cell wall, roughly), x, y in [0, p).
function edge(T, x, y, p) {
  const xi = x | 0, yi = y | 0, q = p + 2;
  let d1 = 99, d2 = 99;
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const k = ((yi + j) * q + xi + i) * 2, dx = xi + i - 1 + T[k] - x, dy = yi + j - 1 + T[k + 1] - y, d = dx * dx + dy * dy;
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return Math.sqrt(d2) - Math.sqrt(d1);
}

export default function generate(S, N) {
  const n = S * S, albedo = new Float32Array(n * 3), height = new Float32Array(n), rough = new Float32Array(n), alpha = new Float32Array(n);
  const TB = LAYERS.map(([p, sd]) => sites(N, p, sd));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, u = x / S, v = y / S;
    // coverage: fbm with a periodic warp so patches stream into ragged fingers
    const wu = (N.vnoise(u * 4, v * 4, 4, 4, 21) - 0.5) * 0.12;
    const cov = N.fbm(u * 3 + wu * 3, v * 3, 3, 3, 3, 31);
    const core = N.smooth(0.56, 0.72, cov), fringe = N.smooth(0.4, 0.56, cov);
    let lace = 0;
    for (let L = 0; L < 3; L++) {
      const ly = LAYERS[L], p = ly[0];
      const e = edge(TB[L], ((u + 1) % 1) * p, ((v + 1) % 1) * p, p);
      // finer bubbles show inside the patch, big bubbles open up near its fringe
      lace = Math.max(lace, (1 - N.smooth(ly[2] * 0.3, ly[2], e)) * ly[3] * (L === 0 ? 1 - core * 0.5 : N.mix(0.5, 1, core)));
    }
    const a = N.clamp01(fringe * (lace * 0.95 + core * 0.55));  // walls in the fringe, creamy film in cores
    const thin = 1 - N.clamp01(a * 1.4);                        // thin film -> faint cyan
    for (let k = 0; k < 3; k++) albedo[i * 3 + k] = N.mix(WHITE[k], CYAN[k], thin * 0.6);
    height[i] = N.clamp01(a * 0.7 + lace * fringe * 0.3);
    rough[i] = 0.46 + 0.08 * lace * fringe;
    alpha[i] = a;
  }
  return { albedo, height, rough, alpha };
}
