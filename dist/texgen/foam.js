// Foam: lacy sea foam for ocean crests, raft-edge foam and the demo (repeat 2x2 => ~half a tile per metre).
// Density = warped periodic fbm at P=6 (several mid-size drifts per tile, no single blob). Foam is a film
// with bubble holes punched at three Worley scales (P=6, 12, 25; radius varies per cell, warped coords):
// big holes only where foam is sparse, so drift fringes become a thin irregular net that breaks up into
// clear water through ever larger holes (alpha 0, no soft smear); dense cores keep just small pores.
// Hole rims catch a little extra white. White #F4FAFA, thin film faint cyan. Rough ~0.46-0.54.
export const normalStrength = 3;

const WHITE = [0xF4 / 255, 0xFA / 255, 0xFA / 255], CYAN = [0.70, 0.89, 0.92];

export default function generate(S, N) {
  const n = S * S, albedo = new Float32Array(n * 3), height = new Float32Array(n), rough = new Float32Array(n), alpha = new Float32Array(n);
  const P = [6, 12, 25], W = [N.worleyGrid(6, 6, 3, 0.9), N.worleyGrid(12, 12, 7, 0.9), N.worleyGrid(25, 25, 13, 0.9)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, u0 = x / S, v0 = y / S;
    // periodic warp: strands meander instead of being straight Voronoi edges
    const wu = (N.vnoise(u0 * 6, v0 * 6, 6, 6, 21) - 0.5) * 0.08, wv = (N.vnoise(u0 * 6, v0 * 6, 6, 6, 22) - 0.5) * 0.08;
    const u = u0 + wu, v = v0 + wv;
    const cov = N.fbm(u * 6, v * 6, 6, 6, 3, 33);
    const dens = N.smooth(0.5, 0.8, cov);                       // 0 sparse lace .. 1 dense drift
    const fade = N.smooth(0.28, 0.42, cov);                     // lace breaks up into clear water
    if (fade <= 0) { albedo[i * 3] = CYAN[0]; albedo[i * 3 + 1] = CYAN[1]; albedo[i * 3 + 2] = CYAN[2]; height[i] = 0; rough[i] = 0.46; alpha[i] = 0; continue; }
    // lace = foam with bubble holes punched out at three scales (warped, varied radius per cell). Big holes
    // only where foam is sparse (so fringes become a thin irregular net), mid holes thin out toward the core,
    // small pores in about half the cells everywhere. Overlapping holes of mixed size give irregular gaps.
    let film = 1, rim = 0;
    for (let L = 0; L < 3; L++) {
      const p = P[L], w = W[L](u * p, v * p);
      const open = L === 0 ? 1.15 * (1 - dens) + 0.9 * (1 - fade) : L === 1 ? 0.45 + 0.55 * (1 - dens) + 0.6 * (1 - fade) : (w.id > 0.3 ? 0.75 : 0);
      if (open <= 0.05) continue;
      const rr = (0.22 + 0.3 * w.id) * open;
      film *= N.smooth(rr - 0.05, rr + 0.015, w.f1);
      rim = Math.max(rim, N.smooth(rr - 0.02, rr + 0.03, w.f1) * (1 - N.smooth(rr + 0.05, rr + 0.16, w.f1)) * (L === 2 ? 0.4 : 1));
    }
    const a = N.clamp01(film * N.smooth(0, 0.4, fade) * (0.74 + 0.16 * dens + 0.16 * rim));
    const thin = 1 - N.clamp01(a * 1.25);                         // thin film -> faint cyan
    for (let k = 0; k < 3; k++) albedo[i * 3 + k] = N.mix(WHITE[k], CYAN[k], thin * 0.7);
    height[i] = N.clamp01(a * 0.75 + 0.25 * rim * a);
    rough[i] = 0.46 + 0.08 * a;
    alpha[i] = a;
  }
  return { albedo, height, rough, alpha };
}
