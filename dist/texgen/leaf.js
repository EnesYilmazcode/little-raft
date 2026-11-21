// Leaf: glossy palm frond tile. UV scale: one tile = one frond section (u across, v along the stem).
// Raised yellow-green midrib at u=0.5, leaflets angled off it (chevron bands), parallel veins,
// darker toward the outer u edges with yellowed tips, a few alpha slits between leaflets near u=0/1.
// Seamless: leaflet phase = frac(L*v + k*|u-0.5|) with integer L; |u-0.5| matches at u=0 and u=1.
export const normalStrength = 5;
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const RIB = hex('#A6CF5A'), MID = hex('#6DB33A'), DEEP = hex('#4E9A2E'), DARK = hex('#3C7F26'), TIP = hex('#B9B04A');

export default function generate(S, N) {
  const albedo = new Float32Array(S * S * 3), height = new Float32Array(S * S), rough = new Float32Array(S * S), alpha = new Float32Array(S * S);
  const L = 6, K = 4.2, VEINS = 7;
  // Per-row tone noise (cheap low-frequency colour variation), precomputed on a coarse periodic grid.
  const tone = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) tone[y * S + x] = N.fbm(x / S * 4, y / S * 4, 4, 4, 2, 41);
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, d = Math.abs(u - 0.5), s = y * S + x;
      const ph = v * L + K * d * (1 - 0.5 * d), li = Math.floor(ph), f = ph - li; // leaflet index and phase across it
      const lid = N.hash2(((li % L) + L) % L, 0, 7);                      // per-leaflet variation (same both sides so u wraps)
      const edge = Math.min(f, 1 - f);                                   // distance to leaflet boundary (0..0.5)
      const blade = Math.sin(Math.PI * f) ** 0.6;                         // convex leaflet profile
      const groove = 1 - N.smooth(0, 0.08, edge);                         // crease between leaflets
      const vein = Math.abs(Math.sin(Math.PI * f * VEINS)) ** 8 * N.smooth(0.03, 0.08, d);
      const rib = 1 - N.smooth(0.012, 0.03, d), ribSh = 1 - N.smooth(0.03, 0.045, d);
      const outer = N.smooth(0.12, 0.5, d), t = tone[s];
      // Colour: mid-green blade, deeper toward edges and in grooves, yellow tips at outer u.
      let c0 = MID[0], c1 = MID[1], c2 = MID[2];
      const dk = Math.min(1, outer * 0.9 + groove * 0.55 + (lid - 0.5) * 0.3 + (t - 0.5) * 0.5);
      const dc = dk > 0 ? (dk < 0.6 ? DEEP : DARK) : MID, dm = Math.abs(dk);
      c0 += (dc[0] - c0) * dm; c1 += (dc[1] - c1) * dm; c2 += (dc[2] - c2) * dm;
      const tip = N.smooth(0.3, 0.5, d) * (0.35 + 0.5 * lid) * (0.75 + 0.25 * t);
      c0 += (TIP[0] - c0) * tip; c1 += (TIP[1] - c1) * tip; c2 += (TIP[2] - c2) * tip;
      const vl = vein * 0.1 * (1 - rib);                                  // veins slightly lighter
      c0 += vl; c1 += vl; c2 += vl * 0.5;
      c0 += (RIB[0] - c0) * rib; c1 += (RIB[1] - c1) * rib; c2 += (RIB[2] - c2) * rib;
      const sh = 1 - 0.18 * (ribSh - rib);                                // soft shadow beside the midrib
      albedo[s * 3] = c0 * sh; albedo[s * 3 + 1] = c1 * sh; albedo[s * 3 + 2] = c2 * sh;
      height[s] = 0.35 + 0.3 * blade - 0.15 * groove + 0.04 * vein + 0.35 * rib * rib;
      rough[s] = 0.4 + 0.12 * groove + 0.06 * rib + 0.08 * tip + 0.05 * (t - 0.5);
      // Alpha slits: narrow cuts along leaflet boundaries, only near the outer u edges, on most leaflets.
      const slitW = (0.05 * N.smooth(0.22, 0.3, d) + 0.07 * N.smooth(0.3, 0.5, d)) * (lid > 0.2 ? 1 : 0);
      alpha[s] = slitW > 0 ? N.smooth(slitW * 0.4, slitW, edge) : 1;
    }
  }
  return { albedo, height, rough, alpha };
}
