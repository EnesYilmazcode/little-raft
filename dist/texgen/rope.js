// Rope: three-strand twisted rope for torus lashings (and tube-shaped lines), preset repeat [1,3].
// UV: Torus/TubeGeometry, u runs along the rope path, v around the rope (x3 repeats around).
// Strands are helical stripes ph = fract(A*u + B*v) with integer A, B (seamless); B = 1 per tile
// gives 3 strands around the rope with repeat [1,3], A = 18 twists along the lashing ring.
// Each strand: rounded profile, dark grooves #8E7448, fibres along the strand, a few loose flecks.
export const normalStrength = 5;

export default function generate(S, N) {
  const n = S * S, albedo = new Float32Array(n * 3), height = new Float32Array(n), rough = new Float32Array(n);
  const A = 18, B = 1;
  const groove = [0.56, 0.45, 0.28], lo = [0.72, 0.61, 0.41], hi = [0.8, 0.7, 0.51], fleck = [0.9, 0.83, 0.66];
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x;
      const p = A * u + B * v, ph = p - Math.floor(p);
      const s = B * u - A * v; // along-strand coordinate (integer coefficients => periodic)
      const prof = Math.pow(Math.sin(Math.PI * ph), 0.6);
      // fibres: fine lines slanted a little against the strand + streaky noise along it
      const f = 0.5 + 0.5 * Math.sin(2 * Math.PI * (5 * p + s));
      const fn = N.vnoise(p * 9, s * 4, 9, 4, 7);
      const fib = N.mix(f, fn, 0.5);
      const tone = N.vnoise(u * 6, v * 2, 6, 2, 13); // slow tone drift
      // loose fibre flecks: sparse light streaks on strand crowns
      const fl = N.smooth(0.8, 0.9, N.vnoise(p * 3, s * 8, 3, 8, 19)) * N.smooth(0.75, 0.95, f) * prof;
      const h = N.clamp01(0.06 + 0.8 * prof + 0.12 * (fib - 0.5) * prof + 0.06 * fl);
      height[i] = h;
      const t = N.clamp01(0.5 + 0.6 * (fib - 0.5) + 0.4 * (tone - 0.5) + 0.25 * (prof - 0.7));
      const g = 1 - N.smooth(0.05, 0.6, prof);
      for (let c = 0; c < 3; c++) {
        let col = N.mix(lo[c], hi[c], t);
        col = N.mix(col, groove[c] * 0.85, g);
        albedo[i * 3 + c] = N.mix(col, fleck[c], fl * 0.7);
      }
      rough[i] = N.clamp01(0.88 + 0.07 * g - 0.04 * fl);
    }
  }
  return { albedo, height, rough };
}
