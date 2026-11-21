// Leaf: glossy palm frond tile. UV scale: one tile = one frond section (u across, v along the stem);
// also tiled densely by the 'foliage' preset (repeat [10,5]) on island canopy domes, so column means are
// kept flat (no dark edges / yellow tip bands) and colour variation is low-frequency and non-columnar.
// Raised pale midrib at u=0.5, leaflets angled off it; left/right leaflets alternate (half-leaflet offset
// at the rib), spacing and sweep angle drift along v, so the chevrons do not tick like a metronome.
// Alpha slits (transparent, not dark-tinted) between some leaflets near u=0/1.
// Seamless: leaflet phase uses integer L, periodic drift in v, and d=|u-0.5| (equal at u=0 and u=1);
// the side offset fades to 0 at the outer edge so both sides share leaflet ids there.
export const normalStrength = 5;
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const RIB = hex('#A2D062'), MID = hex('#62B03C'), DEEP = hex('#4C9A32'), LITE = hex('#86C24A'), TIP = hex('#9CC84C');

export default function generate(S, N) {
  const albedo = new Float32Array(S * S * 3), height = new Float32Array(S * S), rough = new Float32Array(S * S), alpha = new Float32Array(S * S);
  const L = 7, VEINS = 6, TAU = Math.PI * 2;
  const tone = new Float32Array(S * S), cosd = new Float32Array(S), dv = new Float32Array(S), kv = new Float32Array(S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) tone[y * S + x] = N.fbm(x / S * 3, y / S * 3, 3, 3, 3, 41);
  for (let x = 0; x < S; x++) cosd[x] = Math.cos(Math.PI * Math.abs((x + 0.5) / S - 0.5));
  for (let y = 0; y < S; y++) {                                           // per-row spacing drift and sweep angle K(v)
    const v = (y + 0.5) / S;
    dv[y] = 0.16 * Math.sin(TAU * v + 1.3) + 0.08 * Math.sin(TAU * 2 * v + 0.4); // in leaflet units, periodic
    kv[y] = 4.2 + 0.55 * Math.sin(TAU * v + 2.1) + 0.2 * Math.sin(TAU * 3 * v); // kept small so phase stays monotonic
  }
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, d = Math.abs(u - 0.5), s = y * S + x, side = u < 0.5 ? 1 : -1;
      const ph = v * L + dv[y] + kv[y] * d * (1 - 0.5 * d) + 0.25 * side * cosd[x];
      const li = Math.floor(ph), f = ph - li, lw = ((li % L) + L) % L;    // leaflet index and phase across it
      const lid2 = N.hash2(lw, 1, 7);                                    // shared by both sides (used at the u seam)
      const lid = N.mix(N.hash2(lw, side, 9), N.hash2(lw, 0, 7), N.smooth(0.3, 0.48, d)); // per-side shade, shared near the seam
      const edge = Math.min(f, 1 - f);
      const blade = Math.sin(Math.PI * f) ** 0.6;
      const groove = 1 - N.smooth(0, 0.07, edge);
      const vein = Math.abs(Math.sin(Math.PI * f * VEINS)) ** 8 * N.smooth(0.03, 0.08, d);
      const rib = 1 - N.smooth(0.008, 0.02, d), ribSh = 1 - N.smooth(0.02, 0.034, d);
      const t = tone[s];
      // Colour: per-leaflet shade (some lighter, some deeper) + blob tone; light falls on the upper half of each leaflet.
      const sh = (lid - 0.5) * 1.4 + (t - 0.5) * 1.3 + (f - 0.5) * 0.2 * (1 - groove) - 0.2 * groove;
      const cc = sh > 0 ? LITE : DEEP, m = Math.min(1, Math.abs(sh));
      let c0 = MID[0] + (cc[0] - MID[0]) * m, c1 = MID[1] + (cc[1] - MID[1]) * m, c2 = MID[2] + (cc[2] - MID[2]) * m;
      const tip = N.smooth(0.32, 0.5, d) * (0.15 + 0.35 * lid2) * (0.6 + 0.4 * t);   // faint sunny tips, not a band
      c0 += (TIP[0] - c0) * tip; c1 += (TIP[1] - c1) * tip; c2 += (TIP[2] - c2) * tip;
      const vl = vein * 0.06 * (1 - rib);
      c0 += vl; c1 += vl; c2 += vl * 0.5;
      c0 += (RIB[0] - c0) * rib; c1 += (RIB[1] - c1) * rib; c2 += (RIB[2] - c2) * rib;
      const rs = 1 - 0.12 * (ribSh - rib);
      albedo[s * 3] = c0 * rs; albedo[s * 3 + 1] = c1 * rs; albedo[s * 3 + 2] = c2 * rs;
      height[s] = 0.35 + 0.3 * blade - 0.12 * groove + 0.03 * vein + 0.3 * rib * rib;
      rough[s] = 0.42 + 0.1 * groove + 0.05 * rib + 0.06 * tip + 0.06 * (t - 0.5);
      // Alpha slits: narrow cuts along leaflet boundaries near the outer u edges, on most leaflets.
      const slitW = (0.04 * N.smooth(0.24, 0.32, d) + 0.06 * N.smooth(0.32, 0.5, d)) * (lid2 > 0.25 ? 1 : 0);
      alpha[s] = slitW > 0 ? N.smooth(slitW * 0.4, slitW, edge) : 1;
    }
  }
  return { albedo, height, rough, alpha };
}
