// Plastic: crinkled, crumpled translucent sheet / bag scrap. One tile = one scrap (repeat 1x1).
// Height = large soft folds (periodic fbm, P=3) + faceted crumple from three warped Worley layers
// (P=4, 9, 17): f2-f1 gives tent-shaped facets meeting in sharp crease lines, each facet tilted.
// Colour: near-white #DDE8EE -> pale blue #A9C8DE -> #7FAED0 in fold valleys, whiter on creases.
// Roughness 0.3-0.45 (rougher in creases); alpha 0.75-0.95, more opaque on creases.
export const normalStrength = 10;

const LAYERS = [[4, 11, 0.5, 0.07], [9, 23, 0.3, 0.05], [17, 37, 0.16, 0.04]]; // [period, seed, weight, crease width]
const C0 = [0xDD, 0xE8, 0xEE].map(v => v / 255), C1 = [0xA9, 0xC8, 0xDE].map(v => v / 255), C2 = [0x7F, 0xAE, 0xD0].map(v => v / 255);

// Site table per layer, padded by one wrapped cell on each side (no modulo in the inner loop):
// jittered site offset (ox, oy) and a facet tilt, built once per call.
function sites(N, p, seed) {
  const q = p + 2, t = new Float64Array(q * q * 3);
  for (let k = 0; k < q * q; k++) {
    const gx = (k % q + p - 1) % p, gy = ((k / q | 0) + p - 1) % p;
    t[k * 3] = 0.12 + 0.76 * N.hash2(gx, gy, seed); t[k * 3 + 1] = 0.12 + 0.76 * N.hash2(gx, gy, seed + 9);
    t[k * 3 + 2] = N.hash2(gx, gy, seed + 5) - 0.5;
  }
  return t;
}
// Seamless Worley with squared distances; x, y in [0, p). Writes [f1, f2, tag of nearest, tag of 2nd].
function cell(T, x, y, p, out) {
  const xi = x | 0, yi = y | 0, q = p + 2;
  let d1 = 99, d2 = 99, t1 = 0, t2 = 0;
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const k = ((yi + j) * q + xi + i) * 3, dx = xi + i - 1 + T[k] - x, dy = yi + j - 1 + T[k + 1] - y, d = dx * dx + dy * dy;
    if (d < d1) { d2 = d1; d1 = d; t2 = t1; t1 = T[k + 2]; } else if (d < d2) { d2 = d; t2 = T[k + 2]; }
  }
  out[0] = Math.sqrt(d1); out[1] = Math.sqrt(d2); out[2] = t1; out[3] = t2;
}

export default function generate(S, N) {
  const n = S * S, albedo = new Float32Array(n * 3), height = new Float32Array(n), rough = new Float32Array(n), alpha = new Float32Array(n);
  const crease = new Float32Array(n), facet = new Float32Array(n), w = new Float64Array(4), TB = LAYERS.map(([p, sd]) => sites(N, p, sd));
  let hmin = 9, hmax = -9;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, u = x / S, v = y / S;
    // periodic warp so creases kink instead of being straight Voronoi edges
    const wx = (N.vnoise(u * 5, v * 5, 5, 5, 5) - 0.5) * 0.035, wy = (N.vnoise(u * 5, v * 5, 5, 5, 6) - 0.5) * 0.035;
    const f = N.fbm(u * 3, v * 3, 3, 3, 2, 71);
    let h = f * 0.5, c = 0;
    for (let L = 0; L < 3; L++) {
      const ly = LAYERS[L], p = ly[0], wt = ly[2], q = (p + 1) >> 1;
      cell(TB[L], ((u + wx + 1) % 1) * p, ((v + wy + 1) % 1) * p, p, w);
      const e = w[1] - w[0];                                   // 0 on the crease, grows across the facet
      // tent across each crease; a smooth periodic field flips creases between mountain and valley folds
      const fold = Math.max(-1, Math.min(1, (N.vnoise(u * q, v * q, q, q, 40 + L) - 0.45) * 5));
      h += wt * fold * (1 - Math.min(e, 0.5) * 2) + wt * 0.08 * w[2];
      c = Math.max(c, (1 - N.smooth(0, ly[3], e)) * (L === 0 ? 1 : L === 1 ? 0.7 : 0.45) * (0.3 + 0.7 * Math.max(0, fold))); // mountain creases whiten
      if (L < 2) facet[i] += w[2] * (L ? 0.5 : 1);
    }
    height[i] = h; crease[i] = c;
    if (h < hmin) hmin = h; if (h > hmax) hmax = h;
  }
  for (let i = 0; i < n; i++) {
    const h = (height[i] - hmin) / (hmax - hmin), c = crease[i] * (0.6 + 0.4 * h), s = 1 + 0.12 * facet[i]; // facets catch light differently
    height[i] = h;
    // low parts of the crumple (folded-over, layered plastic) are bluer; high facets near-white
    const t = N.clamp01(1.15 - h * 1.3), a = N.smooth(0.1, 0.65, t), b = N.smooth(0.6, 1, t);
    for (let k = 0; k < 3; k++) albedo[i * 3 + k] = N.clamp01(N.mix(N.mix(N.mix(C0[k], C1[k], a), C2[k], b) * s, 0.97, c * 0.55));
    rough[i] = 0.3 + 0.05 * (1 - h) + 0.1 * c;
    alpha[i] = N.clamp01(0.76 + 0.08 * (1 - h) + 0.12 * c);
  }
  return { albedo, height, rough, alpha };
}
