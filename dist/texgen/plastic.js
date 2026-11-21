// Plastic: crinkled, crumpled bag / sheet scrap. One tile = one scrap (repeat 1x1).
// Height = big soft folds (periodic fbm P=3, dominant) + a few long pulled wrinkles (ridged fbm on a sheared
// 3x7 grid) + crumple facets from three warped Worley layers of mixed size (P=5, 11, 23): f2-f1 tents meet in
// straight creases, each facet tilted, mountain/valley flipped by a slow field. Creases are shading, not
// white lines (only the biggest mountain creases whiten faintly), so it reads as a bag, not crackle glass.
// Colour: milky white #E4ECF0 -> pale blue #B4CFE0 -> #93BAD6 in fold valleys. Roughness 0.3-0.4; alpha 0.86-0.98.
export const normalStrength = 6;

const C0 = [0xE4, 0xEC, 0xF0].map(v => v / 255), C1 = [0xB4, 0xCF, 0xE0].map(v => v / 255), C2 = [0x93, 0xBA, 0xD6].map(v => v / 255);

export default function generate(S, N) {
  const n = S * S, albedo = new Float32Array(n * 3), height = new Float32Array(n), rough = new Float32Array(n), alpha = new Float32Array(n);
  const crease = new Float32Array(n), facet = new Float32Array(n);
  // crumple layers [worley, period, weight]: tents across straight creases, sizes mixed so cells are uneven
  const WL = [[N.worleyGrid(5, 5, 11, 0.95), 5, 0.3], [N.worleyGrid(11, 11, 23, 0.95), 11, 0.17], [N.worleyGrid(23, 23, 37, 0.95), 23, 0.07]];
  let hmin = 9, hmax = -9;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, v0 = y / S, u0 = x / S;
    const u = u0 + (N.vnoise(u0 * 5, v0 * 5, 5, 5, 5) - 0.5) * 0.03, v = v0 + (N.vnoise(u0 * 5, v0 * 5, 5, 5, 6) - 0.5) * 0.03;
    let h = N.fbm(u0 * 3, v0 * 3, 3, 3, 2, 71) * 0.8, c = 0, f = 0;
    // a few long pulled wrinkles: ridged noise stretched along a diagonal (integer shear keeps it periodic)
    const r = 1 - Math.abs(2 * N.fbm((u + v) * 3, (v - u) * 7, 3, 7, 2, 51) - 1);
    h += 0.22 * r * r * r; c = N.smooth(0.93, 0.99, r) * 0.2;
    // mountain/valley sign field per scale
    const fs = N.vnoise(u0 * 4, v0 * 4, 4, 4, 40);
    for (let L = 0; L < 3; L++) {
      const [W, p, wt] = WL[L], w = W(u * p, v * p);
      const fold = Math.max(-1, Math.min(1, ((L === 1 ? 1 - fs : fs) - 0.45) * 4));
      h += wt * fold * (1 - Math.min(w.f2 - w.f1, 0.5) * 2) + wt * 0.25 * (w.id - 0.5); // tent + facet tilt
      if (L === 0) c = Math.max(c, (1 - N.smooth(0, 0.05, w.f2 - w.f1)) * 0.25 * Math.max(0, fold)); // faint whitening, big mountain creases only
      f += w.id * (L === 2 ? 0.3 : 1 - L * 0.4);
    }
    facet[i] = f;
    height[i] = h; crease[i] = c;
    if (h < hmin) hmin = h; if (h > hmax) hmax = h;
  }
  for (let i = 0; i < n; i++) {
    const h = (height[i] - hmin) / (hmax - hmin), c = crease[i];
    height[i] = h;
    // low parts of the crumple (folded-over, layered plastic) are bluer; high folds milky white
    const t = N.clamp01(1.1 - h * 1.25), a = N.smooth(0.15, 0.7, t), b = N.smooth(0.7, 1, t);
    for (let k = 0; k < 3; k++) albedo[i * 3 + k] = N.clamp01(N.mix(N.mix(N.mix(C0[k], C1[k], a), C2[k], b) * (0.94 + 0.06 * facet[i]), 0.97, c));
    rough[i] = 0.3 + 0.06 * (1 - h) + 0.15 * c;
    alpha[i] = N.clamp01(0.86 + 0.07 * (1 - h) + 0.2 * c);
  }
  return { albedo, height, rough, alpha };
}
