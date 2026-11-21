// Placeholder scrap generator (flat). Contract: see dist/textures.js header.
export default function generate(S, N) {
  const albedo = new Float32Array(S * S * 3).fill(0.7), height = new Float32Array(S * S), rough = new Float32Array(S * S).fill(0.8);
  for (let i = 0; i < S * S; i++) height[i] = N.fbm((i % S) / S * 8, Math.floor(i / S) / S * 8, 8, 8, 3, 1);
  return { albedo, height, rough };
}
