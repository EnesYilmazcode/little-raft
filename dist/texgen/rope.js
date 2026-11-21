// Rope: three-strand twisted rope for torus lashings and tube lines. NEEDS preset repeat [3, 3].
// UV: Torus/TubeGeometry, u runs along the rope path, v around the rope; demo boxes use 1 UV = 1 m.
// Strands are helical bands ph = fract(A*u + B*v) (integer A, B: seamless). A = 9, B = 1 at repeat [3,3]
// = 27 strand crossings per deck ring (~0.49 m) and 3 strands around the 11 mm tube: ~32 deg lay.
// Each strand is itself twisted: yarn ridges ph2 = fract(A2*u - B2*v) run nearly along the rope on the
// tori and at 45 deg on world-UV boxes (strands 37 mm apart), so boxes read as columns of twisted strands.
// Rounded crowns with soft shading, dark narrow grooves, pale loose fibres. Warm hemp, groove #75603D.
export const normalStrength = 5;

export default function generate(S, N) {
  const n = S * S, albedo = new Float32Array(n * 3), height = new Float32Array(n), rough = new Float32Array(n);
  const A = 9, B = 1, A2 = 18, B2 = 18;
  const groove = [0.36, 0.28, 0.17], lo = [0.70, 0.58, 0.38], hi = [0.88, 0.77, 0.55], fleck = [0.93, 0.86, 0.68];
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x;
      const p = A * u + B * v, ph = p - Math.floor(p);
      const sn = Math.sin(Math.PI * ph), prof = Math.sqrt(sn), ao = 0.74 + 0.26 * sn; // rounded crown, narrow groove, soft shading
      const q = A2 * u - B2 * v, ph2 = q - Math.floor(q);
      const yarn = Math.sin(Math.PI * ph2);                                 // twisted yarn ridges inside the strand
      const fn = N.vnoise(u * 36, v * 9, 36, 9, 7), tone = N.vnoise(u * 3, v * 2, 3, 2, 13); // fibre streaks, slow tone drift
      const fl = N.smooth(0.78, 0.92, N.vnoise(u * 27, v * 12, 27, 12, 19)) * N.smooth(0.6, 0.95, yarn) * prof; // loose pale fibres
      const h = N.clamp01(0.04 + 0.78 * prof + 0.22 * (yarn - 0.6) * prof + 0.04 * fl);
      height[i] = h;
      const t = N.clamp01(0.45 + 0.7 * (yarn - 0.5) * prof + 0.35 * (tone - 0.5) + 0.25 * (prof - 0.7) + 0.1 * (fn - 0.5));
      const g = 1 - N.smooth(0.0, 0.5, prof);
      for (let c = 0; c < 3; c++) {
        let col = N.mix(lo[c], hi[c], t);
        col = N.mix(col, groove[c], g * 0.9);
        albedo[i * 3 + c] = N.mix(col * ao, fleck[c], fl * 0.6);
      }
      rough[i] = N.clamp01(0.86 + 0.08 * g - 0.04 * fl);
    }
  }
  return { albedo, height, rough };
}
