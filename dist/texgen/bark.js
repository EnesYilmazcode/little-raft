// Bark: furrowed bark of long vertical ridges split by narrow dark fissures (pine/oak style, stylized).
// UV: CylinderGeometry, u wraps around the log, v runs along it. Authored at its true look in the square
// tile (8 ridges across u, fissures meandering along v): ideal preset repeat [2,4] on the ~0.4 m x 2 m
// deck logs (~25 mm ridges, plates ~150-250 mm long); at the old [2,1] the ridges just get 4x longer.
// Fissures = NC meandering vertical lines (periodic noise in v), free to touch and cross so ridges
// split and merge into a long diamond net. Partial cross-cracks break ridges into long plates.
// Flat dry ridge tops with fibre streaks, rounded shoulders, a little lichen.
export const normalStrength = 5;
const NC = 10, SEED = 5;

export default function generate(S, N) {
  const n = S * S, albedo = new Float32Array(n * 3), height = new Float32Array(n), rough = new Float32Array(n);
  // per row y, per fissure k: centre (in ridge units) and half width (px)
  const X = new Float32Array(S * NC), HW = new Float32Array(S * NC);
  for (let y = 0; y < S; y++) for (let k = 0; k < NC; k++) {
    const v = y / S, m = N.vnoise(v * 3, k * 5, 3, 64, SEED) - 0.5, m2 = N.vnoise(v * 8, k * 5, 8, 64, SEED + 40) - 0.5;
    X[y * NC + k] = k + 1.1 * m + 0.35 * m2;
    HW[y * NC + k] = 0.35 + 1.5 * N.smooth(0.25, 0.85, N.vnoise(v * 5, k * 5, 5, 64, SEED + 80));
  }
  // per ridge (between fissure k and k+1): 2 partial cross-cracks [v, reach 0..1, from left?]
  const CC = [];
  for (let k = 0; k < NC; k++) for (let q = 0; q < 2; q++) CC.push([(q + N.hash2(k, q, SEED + 1)) / 2, 0.35 + 0.6 * N.hash2(k, q, SEED + 2), N.hash2(k, q, SEED + 3) < 0.5]);
  const RW = S / NC;
  const dark = [0.27, 0.19, 0.12], lo = [0.45, 0.34, 0.23], hi = [0.58, 0.46, 0.32], dry = [0.71, 0.61, 0.48], lich = [0.62, 0.66, 0.5];
  for (let y = 0; y < S; y++) {
    const v = y / S, row = y * NC;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x, gx = u * NC, c0 = Math.floor(gx);
      // nearest fissure (check neighbours, wrapped) and the ridge we sit in (last fissure to our left)
      let d = 99, hw = 1, left = -99, rid = 0, right = 99;
      for (let a = -2; a <= 2; a++) {
        const kk = c0 + a, k = ((kk % NC) + NC) % NC, fx = X[row + k] + (kk - k), dd = (gx - fx) * RW;
        const ad = Math.abs(dd) - HW[row + k];
        if (ad < d) { d = ad; hw = HW[row + k]; }
        if (dd >= 0 && fx > left) { left = fx; rid = k; }
        if (dd < 0 && fx < right) right = fx;
      }
      // cross-cracks: short, from one fissure part way across the ridge
      const wid = Math.max(0.2, right - left), t = (gx - left) / wid;
      let cd = 99;
      for (let q = 0; q < 2; q++) {
        const cc = CC[rid * 2 + q]; let dv = v - cc[0] - (t - 0.5) * 0.02; dv -= Math.round(dv);
        const reach = cc[2] ? t : 1 - t;
        if (reach < cc[1]) cd = Math.min(cd, Math.abs(dv * S) + 1.2 * reach / cc[1]);
      }
      const e = Math.min(d, cd + 0.6); // px from the nearest fissure lip (cross-cracks shallower)
      const id = N.hash2(rid, 0, SEED + 4), pr = Math.sqrt(Math.sin(Math.PI * Math.min(1, Math.max(0, t)))); // ridge profile
      // shallow fibrous splits on the ridge faces: short broken vertical dashes
      const sp = N.smooth(0.84, 0.93, N.vnoise(u * 72 + pr, v * 5, 72, 5, SEED + 47)) * pr;
      const fib = N.vnoise(u * 112, v * 3, 112, 3, SEED + 41), str = N.vnoise(u * 32, v * 4, 32, 4, SEED + 43);
      const crack = 1 - N.smooth(-0.6, 0.7, e), crown = N.smooth(-0.3, 4 + hw * 1.5, Math.min(d, cd + 2.5));
      const h = N.clamp01(0.2 + 0.38 * crown + 0.22 * pr - 0.1 * sp + 0.16 * (str - 0.5) + 0.12 * (fib - 0.5) + 0.06 * (id - 0.5) - 0.28 * crack);
      height[i] = h;
      const tone = N.clamp01(0.45 + 0.45 * (id - 0.5) + 0.6 * (str - 0.5) + 0.55 * (fib - 0.5));
      const top = N.smooth(0.5, 0.72, h) * (0.5 + 0.5 * N.vnoise(u * 16, v * 5, 16, 5, SEED + 53));
      const lm = N.smooth(0.58, 0.72, N.vnoise(u * 6, v * 5, 6, 5, SEED + 67)) * N.smooth(0.8, 0.9, N.hash2(x, y >> 1, SEED + 71)) * crown;
      for (let c = 0; c < 3; c++) {
        let col = N.mix(lo[c], hi[c], tone);
        col = N.mix(col, dry[c], top * 0.8);
        col = N.mix(col, dark[c], crack * 0.72 + ((1 - crown) * 0.15 + (1 - pr) * 0.15 + sp * 0.35) * (1 - crack));
        albedo[i * 3 + c] = N.mix(col, lich[c], lm * 0.35);
      }
      rough[i] = N.clamp01(0.92 + 0.06 * crack - 0.06 * top);
    }
  }
  return { albedo, height, rough };
}
