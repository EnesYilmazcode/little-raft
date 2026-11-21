// Planks: generic "board of planks" tile, the Raft signature look. UV 0..1 per box face (repeat [1,1]).
// 5 honey-tan planks side by side across u, grain along v. Each plank has 2 butt joints at hashed v
// (so 2 boards per column, 10 boards), each board gets its own value/hue (+ rarely a greyer weathered one).
// Warm brown gaps (not black), lighter worn edges, hashed knots, 1-2 nail heads with jittered spots per joint.
export const normalStrength = 5;
const P = 5, SEED = 71;
const BASE = [0.80, 0.63, 0.41], GREY = [0.66, 0.59, 0.48], GAP = [0.353, 0.259, 0.157], NAIL = [0.24, 0.235, 0.23];

export default function generate(S, N) {
  const albedo = new Float32Array(S * S * 3), height = new Float32Array(S * S), rough = new Float32Array(S * S);
  const W = S / P, h = (a, b) => N.hash2(a, b, SEED);
  // per column: two joints; per board: tint + nail layout [nu0, nu1, dv px, count]; knots [u, v, r px]
  const J = [], boards = [], nails = [], knots = [];
  for (let p = 0; p < P; p++) {
    const j0 = h(p, 1), j1 = (j0 + 0.36 + 0.28 * h(p, 2)) % 1; J.push([j0, j1]);
    for (let s = 0; s < 2; s++) {
      const b = p * 7 + s, r = h(b, 3), k = 1 + (r - 0.5) * 0.18, hue = (h(b, 5) - 0.5) * 0.08, grey = h(b, 4) < 0.09;
      const c = [BASE[0] * k * (1 + hue), BASE[1] * k, BASE[2] * k * (1 - hue * 1.6)];
      boards.push(grey ? c.map((v, i) => N.mix(v, GREY[i] * k, 0.65)) : c);
      nails.push([0.2 + 0.14 * h(b, 8), 0.66 + 0.14 * h(b, 9), 3.5 + 4 * h(b, 10), h(b, 11) < 0.25 ? 1 : 2]);
      if (h(b, 12) < 0.55) { const jv = J[p][s], len = (J[p][1 - s] - jv + 1) % 1; knots.push([(p + 0.25 + 0.5 * h(b, 13)) / P, (jv + len * (0.25 + 0.5 * h(b, 14))) % 1, 2.6 + 2.2 * h(b, 15)]); }
    }
  }
  const KN = knots.length;
  // fine grain profile across u (1D), looked up along the warped grain coordinate
  const FL = 1280, F = new Float32Array(FL);
  for (let k = 0; k < FL; k++) F[k] = N.fbm(k / 8, 0.5, 160, 1, 2, SEED + 3);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x, p = Math.floor(u * P), lu = u * P - p;
      const j0 = J[p][0], j1 = J[p][1], seg = (v - j0 + 1) % 1 < (j1 - j0 + 1) % 1 ? 0 : 1;
      let dj0 = v - j0; dj0 -= Math.round(dj0); let dj1 = v - j1; dj1 -= Math.round(dj1);
      const dj = Math.min(Math.abs(dj0), Math.abs(dj1)) * S, eu = Math.min(lu, 1 - lu) * W, edge = Math.min(eu, dj);
      // nearest knot (wrapped); grain flows around it
      let kd = 99, kx = 0;
      for (let k = 0; k < KN; k++) {
        const kn = knots[k]; let dx = u - kn[0]; dx -= Math.round(dx); let dy = v - kn[1]; dy -= Math.round(dy);
        const ax = dx * S, ay = dy * S * 0.45, d = Math.sqrt(ax * ax + ay * ay) / kn[2]; if (d < kd) { kd = d; kx = ax; }
      }
      const flow = kd < 4 ? Math.sign(kx) * 2.5 * Math.exp(-kd * kd * 0.25) : 0;
      const off = seg * 1.7 + p * 0.9, w = N.vnoise(u * 10, v * 2 + off, 10, 2, SEED + 1);
      const gx = u * 64 + (w - 0.5) * 3.2 + flow;
      const g = N.fbm(gx, v * 3 + off, 64, 3, 2, SEED + 2), fi = gx * 20 + seg * 333 + p * 97, f0 = Math.floor(fi), ft = fi - f0;
      const fine = N.mix(F[((f0 % FL) + FL) % FL], F[(((f0 + 1) % FL) + FL) % FL], ft);
      const lines = N.smooth(0.5, 0.66, g) * 0.75 + fine * 0.25;
      const c = boards[p * 2 + seg];
      let val = 1.08 - lines * 0.2 + (w - 0.5) * 0.12, wr = 1;
      const worn = N.smooth(4.5, 1.6, edge) * (0.6 + 0.4 * w);
      val += worn * 0.1; wr -= worn * 0.08;
      if (kd < 2.2) { const ring = 0.5 + 0.5 * Math.cos(kd * 7); val *= N.mix(0.66, 1 - ring * 0.1, N.smooth(0.55, 1.6, kd)); }
      let R = c[0] * val, G = c[1] * val, B = c[2] * val;
      // bevel height + gap (soft warm brown, a little grime just inside the edge)
      let H = 0.82 + (g - 0.5) * 0.06 - lines * 0.06 - (kd < 1 ? 0.05 * (1 - kd) : 0);
      H *= N.smooth(0.6, 3.2, edge); let rr = 0.82 + lines * 0.06 - worn * 0.05;
      if (edge < 4) {
        const t = 1 - N.smooth(0.3, 1.6, edge), gr = 1 - N.smooth(1, 4, edge);
        R = N.mix(R * (1 - gr * 0.1), GAP[0], t); G = N.mix(G * (1 - gr * 0.12), GAP[1], t); B = N.mix(B * (1 - gr * 0.14), GAP[2], t); rr = N.mix(rr, 0.95, t);
      }
      // nails: on the board just after each joint, jittered across and along per board
      for (let q = 0; q < 2; q++) {
        let dv = v - J[p][q]; dv -= Math.round(dv); const nl = nails[p * 2 + q], dvp = dv * S - nl[2];
        if (dvp > -3.2 && dvp < 3.2) for (let m = 0; m < nl[3]; m++) {
          const ax = (lu - nl[m]) * W, d = Math.sqrt(ax * ax + dvp * dvp);
          if (d < 3.2) {
            const t = N.smooth(2.5, 1.7, d), dome = Math.sqrt(Math.max(0, 1 - (d / 2.3) ** 2)), sh = dome * 0.14;
            R = N.mix(R * 0.85, NAIL[0] + sh, t); G = N.mix(G * 0.85, NAIL[1] + sh, t); B = N.mix(B * 0.85, NAIL[2] + sh, t);
            H = Math.max(H, 0.86 + 0.12 * dome); rr = N.mix(rr, 0.5, t);
          }
        }
      }
      albedo[i * 3] = N.clamp01(R); albedo[i * 3 + 1] = N.clamp01(G); albedo[i * 3 + 2] = N.clamp01(B);
      height[i] = N.clamp01(H); rough[i] = N.clamp01(rr * wr);
    }
  }
  return { albedo, height, rough, normalStrength };
}
