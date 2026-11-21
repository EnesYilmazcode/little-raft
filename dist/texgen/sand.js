// Sand: tropical beach sand for islands. UV scale: one tile ~= 1/3 of a UV unit (preset repeat [3,3]).
// Draws soft wind ripples (gentle windward rise, steep lee face, darker troughs) running across u,
// fine per-pixel grain with a few darker / lighter grains and tiny shell-white specks, and a very
// low-frequency warm/pale tone drift so the 3x3 repeat is not obvious. Seamless: integer periods only.
export const normalStrength = 3;

export default function generate(S, N) {
  const n = S * S, albedo = new Float32Array(n * 3), height = new Float32Array(n), rough = new Float32Array(n);
  const RIP = 5; // whole ripples across v
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x;
      // periodic warp bends the ripple crests; integer u coefficient adds a slight diagonal
      const w = N.fbm(u * 2, v * 3, 2, 3, 2, 11) - 0.5, w2 = N.vnoise(u * 2, v * 2, 2, 2, 5) - 0.5;
      let ph = RIP * v + u + 2.2 * w + 0.5 * w2; ph -= Math.floor(ph);
      // asymmetric profile: long windward slope (0..0.72), short steep lee face
      const r = ph < 0.72 ? N.smooth(0, 0.72, ph) : 1 - N.smooth(0.72, 1, ph);
      const amp = 0.4 + 0.6 * N.smooth(0.3, 0.7, N.fbm(u * 3, v * 3, 3, 3, 2, 21)); // ripples fade in and out
      const trough = (1 - r) * amp;
      // grain: per-pixel hash plus a 2px clump noise
      const g = N.hash2(x, y, 7), g2 = N.hash2(x, y, 8), clump = N.vnoise(u * 56, v * 56, 56, 56, 3);
      const tone = N.fbm(u * 2, v * 2, 2, 2, 3, 31); // very low-frequency drift
      height[i] = 0.25 + 0.55 * r * amp + 0.12 * clump + 0.08 * g;
      // base colour between pale #F0DFB0 and warm #E8D3A0 (sRGB)
      const t = N.clamp01(tone * 1.1 - 0.05);
      let R = N.mix(0.910, 0.941, t), G = N.mix(0.827, 0.875, t), B = N.mix(0.627, 0.690, t);
      let k = 1 - 0.09 * trough - 0.05 * (1 - clump) + 0.05 * (g - 0.5); // trough + grain shading
      if (g2 > 0.99) k *= 0.78;           // dark mineral grains
      else if (g2 > 0.97) k *= 0.9; 
      else if (g2 < 0.02) k *= 1.08;      // light quartz grains
      R *= k; G *= k; B *= k * (1 - 0.03 * trough); // troughs slightly warmer
      if (g2 < 0.006 && clump > 0.4) { R = 0.98; G = 0.96; B = 0.92; } // shell-white specks
      albedo[i * 3] = N.clamp01(R); albedo[i * 3 + 1] = N.clamp01(G); albedo[i * 3 + 2] = N.clamp01(B);
      rough[i] = 0.93 + 0.04 * trough + 0.02 * g;
    }
  }
  return { albedo, height, rough };
}
