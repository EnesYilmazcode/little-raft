// Planks: generic "board of planks" tile, the Raft signature look. UV 0..1 per box face.
// 4 honey-tan planks side by side across u, grain along v. Each plank has 2 butt joints at hashed v
// (so 2 boards per column), each board gets its own value/hue (+ an occasional grey weathered board).
// Dark narrow gaps with grime, lighter worn edges, a few knots, 2 raised nail heads beside each joint.
export const normalStrength = 5;
const P = 4, SEED = 71;
const BASE = [0.776, 0.612, 0.400], GREY = [0.612, 0.541, 0.439], GAP = [0.29, 0.207, 0.125], NAIL = [0.23, 0.23, 0.235];

export default function generate(S, N) {
  const albedo = new Float32Array(S * S * 3), height = new Float32Array(S * S), rough = new Float32Array(S * S);
  const W = S / P, h = (a, b) => N.hash2(a, b, SEED);
  // per column: two joints (v in 0..1), per board: tint
  const J = [], boards = [];
  for (let p = 0; p < P; p++) {
    const j0 = h(p, 1), j1 = (j0 + 0.38 + 0.24 * h(p, 2)) % 1; J.push([j0, j1]);
    for (let s = 0; s < 2; s++) {
      const r = h(p * 7 + s, 3), g = h(p * 7 + s, 4) < 0.16, k = 1 + (r - 0.5) * 0.16, hue = (h(p * 7 + s, 5) - 0.5) * 0.06;
      const c = [BASE[0] * k * (1 + hue), BASE[1] * k, BASE[2] * k * (1 - hue * 1.5)];
      boards.push(g ? c.map((v, i) => N.mix(v, GREY[i] * k, 0.75)) : c);
    }
  }
  // fine grain profile across u (1D, 160 cells per tile), looked up along the warped grain coordinate
  const FL = 1280, F = new Float32Array(FL);
  for (let k = 0; k < FL; k++) F[k] = N.fbm(k / 8, 0.5, 160, 1, 2, SEED + 3);
  // knots: [u, v, radius px]
  const knots = [[0.62 / P, 0.71, 4.5], [2.35 / P, 0.18, 3.5], [3.7 / P, 0.52, 3]];
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x, p = Math.floor(u * P), lu = u * P - p;
      const j0 = J[p][0], j1 = J[p][1], a = (v - j0 + 1) % 1, seg = a < (j1 - j0 + 1) % 1 ? 0 : 1;
      let dj0 = v - j0; dj0 -= Math.round(dj0); let dj1 = v - j1; dj1 -= Math.round(dj1);
      const dj = Math.abs(Math.abs(dj0) < Math.abs(dj1) ? dj0 : dj1) * S, eu = Math.min(lu, 1 - lu) * W;
      const edge = Math.min(eu, dj);
      // knot field: flow grain around it
      let kd = 99, kx = 0;
      for (let k = 0; k < 3; k++) {
        const ku = knots[k][0], kv = knots[k][1], kr = knots[k][2];
        let dx = u - ku; dx -= Math.round(dx); let dy = v - kv; dy -= Math.round(dy);
        const ax = dx * S, ay = dy * S * 0.45, d = Math.sqrt(ax * ax + ay * ay) / kr; if (d < kd) { kd = d; kx = dx * S; }
      }
      const flow = kd < 4 ? Math.sign(kx) * 2.5 * Math.exp(-kd * kd * 0.25) : 0;
      // grain: stretched noise, warped, offset per board
      const off = seg * 1.7 + p * 0.9, w = N.vnoise(u * 8, v * 2 + off, 8, 2, SEED + 1);
      const gx = u * 64 + (w - 0.5) * 5 + flow;
      const g = N.fbm(gx, v * 4 + off, 64, 4, 2, SEED + 2), fi = gx * 20 + seg * 333, f0 = Math.floor(fi), ft = fi - f0;
      const fine = N.mix(F[((f0 % FL) + FL) % FL], F[(((f0 + 1) % FL) + FL) % FL], ft);
      const lines = N.smooth(0.5, 0.66, g) * 0.75 + fine * 0.25, blotch = w;
      const c = boards[p * 2 + seg];
      let val = 1.1 - lines * 0.2 + (blotch - 0.5) * 0.12, wr = 1;
      const worn = N.smooth(4.5, 1.6, edge) * (0.6 + 0.4 * blotch);
      val += worn * 0.1; wr -= worn * 0.08;
      let ring = 0;
      if (kd < 2.2) { ring = 0.5 + 0.5 * Math.cos(kd * 7); val *= N.mix(0.62, 1 - ring * 0.12, N.smooth(0.55, 1.6, kd)); }
      let R = c[0] * val, G = c[1] * val, B = c[2] * val;
      // bevel height + gap
      let H = 0.82 + (g - 0.5) * 0.06 - lines * 0.03 - (kd < 1 ? 0.05 * (1 - kd) : 0);
      const bev = N.smooth(0.6, 3.2, edge); H *= bev; let rr = 0.82 + lines * 0.06 - worn * 0.05;
      if (edge < 3) {
        const t = 1 - N.smooth(0.3, 1.7, edge), gr = 1 - N.smooth(1, 4, edge);
        R = N.mix(R, GAP[0], t); G = N.mix(G, GAP[1], t); B = N.mix(B, GAP[2], t);
        R *= 1 - gr * 0.12; G *= 1 - gr * 0.14; B *= 1 - gr * 0.16; rr = N.mix(rr, 0.95, t);
      }
      // nails: 2 per joint, on the board just after it, at lu 0.27 / 0.73
      for (let q = 0; q < 2; q++) {
        let dv = v - J[p][q]; dv -= Math.round(dv); const dvp = dv * S - 5;
        if (dvp > -3.2 && dvp < 3.2) for (let m = 0; m < 2; m++) {
          const nu = m ? 0.73 : 0.27;
          const ax = (lu - nu) * W, d = Math.sqrt(ax * ax + dvp * dvp);
          if (d < 3.2) {
            const t = N.smooth(2.6, 1.8, d), dome = Math.sqrt(Math.max(0, 1 - (d / 2.4) ** 2));
            R = N.mix(R * 0.8, NAIL[0] + dome * 0.12, t); G = N.mix(G * 0.8, NAIL[1] + dome * 0.12, t); B = N.mix(B * 0.8, NAIL[2] + dome * 0.12, t);
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
