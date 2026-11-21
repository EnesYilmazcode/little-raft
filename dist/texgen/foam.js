// Foam: sea-foam patches for ocean crests, raft-edge foam and the demo (repeat 2x2 => ~half a tile
// per metre of water). Bubbly lace = round Worley bubbles at P=6, 13, 27 popped open as holes, the
// walls between them left as lace with brighter rims, masked by warped low-frequency fbm coverage:
// denser cores, lacy fringes, clear water between (alpha 0). White #F4FAFA, thin film faint cyan. Rough ~0.5.
export const normalStrength = 3;

const LAYERS = [[6, 3], [13, 7], [27, 13]]; // [period, seed]: big, medium, fine bubbles
const WHITE = [0xF4 / 255, 0xFA / 255, 0xFA / 255], CYAN = [0.70, 0.89, 0.92];

// Site table padded by one wrapped cell per side (no modulo in the inner loop): offset x, y, radius.
function sites(N, p, seed) {
  const q = p + 2, t = new Float64Array(q * q * 3);
  for (let k = 0; k < q * q; k++) {
    const gx = (k % q + p - 1) % p, gy = ((k / q | 0) + p - 1) % p;
    t[k * 3] = 0.1 + 0.8 * N.hash2(gx, gy, seed); t[k * 3 + 1] = 0.1 + 0.8 * N.hash2(gx, gy, seed + 9);
    t[k * 3 + 2] = 0.3 + 0.32 * N.hash2(gx, gy, seed + 5);
  }
  return t;
}
// Seamless round-bubble field, x, y in [0, p): returns f1 / radius of the nearest bubble (<1 = inside).
function bubble(T, x, y, p) {
  const xi = x | 0, yi = y | 0, q = p + 2;
  let best = 99;
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const k = ((yi + j) * q + xi + i) * 3, dx = xi + i - 1 + T[k] - x, dy = yi + j - 1 + T[k + 1] - y, r = T[k + 2];
    const d = (dx * dx + dy * dy) / (r * r);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export default function generate(S, N) {
  const n = S * S, albedo = new Float32Array(n * 3), height = new Float32Array(n), rough = new Float32Array(n), alpha = new Float32Array(n);
  const TB = LAYERS.map(([p, sd]) => sites(N, p, sd));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // half-tile shift: the densest patch sits on the tile centre lines, not the wrap (pattern is periodic either way)
    const i = y * S + x, u = ((x + S / 2) % S) / S, v = ((y + S / 2) % S) / S;
    // coverage: warped periodic fbm -> ragged patches with dense cores and lacy fringes
    const wu = (N.vnoise(u * 4, v * 4, 4, 4, 21) - 0.5) * 0.16, wv = (N.vnoise(u * 4, v * 4, 4, 4, 22) - 0.5) * 0.16;
    const cov = N.fbm((u + wu + 1) % 1 * 4, (v + wv + 1) % 1 * 4, 4, 4, 4, 31);
    const body = N.smooth(0.4, 0.68, cov);                        // 0 outside, 1 in dense cores
    let film = 1, rim = 0;
    for (let L = 0; L < 3; L++) {
      const p = LAYERS[L][0], d = bubble(TB[L], u * p, v * p, p);
      // bubbles pop open (holes) more towards the fringe; big ones only there
      const open = L === 0 ? N.smooth(0.15, 0.6, 1 - body) : N.mix(L === 1 ? 0.25 : 0.5, 1, N.smooth(0, 0.6, 1 - body));
      film *= 1 - open * (1 - N.smooth(0.75, 0.97, d));
      rim = Math.max(rim, N.smooth(0.7, 0.9, d) * (1 - N.smooth(0.95, 1.25, d)) * (L === 2 ? 0.5 : 1));
    }
    const a = 0.92 * N.clamp01(N.smooth(0, 0.3, body) * film * (0.62 + 0.3 * body + 0.25 * rim));
    const thin = 1 - N.clamp01(a * 1.3);                          // thin film -> faint cyan
    for (let k = 0; k < 3; k++) albedo[i * 3 + k] = N.mix(WHITE[k], CYAN[k], thin * 0.7);
    height[i] = N.clamp01(a * 0.7 + rim * a * 0.3);
    rough[i] = 0.46 + 0.08 * a;
    alpha[i] = a;
  }
  return { albedo, height, rough, alpha };
}
