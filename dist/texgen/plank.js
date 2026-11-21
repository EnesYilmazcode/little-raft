// Plank: the interior of ONE raft-deck board (edges, gaps and nails come from geometry).
// UV: u runs ACROSS the board (board covers u ~0.15..0.85), v runs ALONG it; preset repeat [1,3],
// so one tile is ~0.34 m wide x 0.7 m long. Fine grain lines along v, soft sun-bleached streaks,
// small wear scratches and one gentle knot. Neutral-warm honey tan; the game tints the average per plank.
export const normalStrength = 5;
const SEED = 113, BASE = [0.80, 0.64, 0.43];

export default function generate(S, N) {
  const albedo = new Float32Array(S * S * 3), height = new Float32Array(S * S), rough = new Float32Array(S * S);
  // 1D fine-grain profile across u (looked up along the warped grain coordinate)
  const FL = 1024, F = new Float32Array(FL);
  for (let k = 0; k < FL; k++) F[k] = N.fbm(k / 8, 0.5, 128, 1, 2, SEED);
  // scratches: short thin diagonal-ish strokes [u, v, length px, slope]
  const R = N.rng(SEED), SC = [];
  for (let k = 0; k < 4; k++) SC.push([0.18 + R() * 0.64, R(), 6 + R() * 14, (R() - 0.5) * 0.5]);
  const KU = 0.58, KV = 0.62, KR = 3.6; // the knot
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x;
      let dx = u - KU; dx -= Math.round(dx); let dy = v - KV; dy -= Math.round(dy);
      const ax = dx * S, ay = dy * S * 1.1, kd = Math.sqrt(ax * ax + ay * ay) / KR;
      const flow = kd < 5 ? Math.sign(ax) * 2.2 * Math.exp(-kd * kd * 0.18) : 0;
      const w = N.vnoise(u * 4, v * 2, 4, 2, SEED + 1);
      const gx = u * 32 + (w - 0.5) * 1.6 + flow;
      const g = N.fbm(gx, v * 2, 32, 2, 2, SEED + 2);
      const fi = gx * 32, f0 = Math.floor(fi), fine = N.mix(F[((f0 % FL) + FL) % FL], F[(((f0 + 1) % FL) + FL) % FL], fi - f0);
      const lines = N.smooth(0.5, 0.66, g) * 0.6 + N.smooth(0.45, 0.75, fine) * 0.4;
      // sun-bleached streaks: long soft bands along v
      const bleach = N.smooth(0.55, 0.8, N.vnoise(u * 6 + w, v, 6, 1, SEED + 3));
      let val = 1.0 - lines * 0.17 + bleach * 0.09 + (w - 0.5) * 0.06, H = 0.6 + (g - 0.5) * 0.15 - lines * 0.08, rr = 0.84 + lines * 0.05 - bleach * 0.03;
      let sat = 1 - bleach * 0.25;
      if (kd < 2.4) {
        const ring = 0.5 + 0.5 * Math.cos(kd * 6.5), core = 1 - N.smooth(0.5, 1.6, kd);
        val *= 1 - core * 0.3 - ring * 0.06 * (1 - core); H -= core * 0.1;
      }
      for (let k = 0; k < SC.length; k++) {
        const s = SC[k]; let sy = v - s[1]; sy -= Math.round(sy); let sx = u - s[0] - sy * s[3]; sx -= Math.round(sx);
        const along = Math.abs(sy * S), across = Math.abs(sx * S);
        if (along < s[2] && across < 1.4) { const t = (1 - across / 1.4) * (1 - along / s[2]); val += t * 0.08; H -= t * 0.1; rr -= t * 0.04; }
      }
      const m = (BASE[0] + BASE[1] + BASE[2]) / 3;
      for (let c = 0; c < 3; c++) albedo[i * 3 + c] = N.clamp01((m + (BASE[c] - m) * sat) * val);
      height[i] = N.clamp01(H); rough[i] = N.clamp01(rr);
    }
  }
  return { albedo, height, rough, normalStrength };
}
