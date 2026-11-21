// Rock: island / coastal rock. UV scale: one tile ~= 1/2 UV unit (preset repeat [2,2]).
// Draws big flat facets (warped Worley cells P=4, each a tilted plane with its own grey tone),
// sub-facets (P=9), dark cracks along cell borders, fine fbm grit, and patchy moss #5F7F3A collecting
// on the upper (high-v) part of cells and in crevices. Seamless: integer periods, wrapped Worley.
export const normalStrength = 5;

// Worley with precomputed feature points (much faster than N.worley's per-sample hashing).
function cells(N, P, seed) {
  const fx = new Float32Array(P * P), fy = new Float32Array(P * P), id = new Float32Array(P * P);
  for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
    const k = j * P + i; fx[k] = 0.5 + (N.hash2(i, j, seed) - 0.5) * 0.9; fy[k] = 0.5 + (N.hash2(i, j, seed + 9) - 0.5) * 0.9; id[k] = N.hash2(i, j, seed + 3);
  }
  const r = { f1: 0, e: 0, id: 0, dx: 0, dy: 0 };
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y); let f1 = 99, f2 = 99;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const k = ((yi + j + P) % P) * P + (xi + i + P) % P, ox = xi + i + fx[k] - x, oy = yi + j + fy[k] - y, d = ox * ox + oy * oy;
      if (d < f1) { f2 = f1; f1 = d; r.id = id[k]; r.dx = -ox; r.dy = -oy; } else if (d < f2) f2 = d;
    }
    f1 = Math.sqrt(f1); r.f1 = f1; r.e = Math.sqrt(f2) - f1; return r;
  };
}

export default function generate(S, N) {
  const n = S * S, albedo = new Float32Array(n * 3), height = new Float32Array(n), rough = new Float32Array(n);
  const P = 4, Q = 9, big = cells(N, P, 41), small = cells(N, Q, 57);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x;
      const wx = N.vnoise(u * 5, v * 5, 5, 5, 3) - 0.5, wy = N.vnoise(u * 5, v * 5, 5, 5, 4) - 0.5;
      const c = big(u * P + wx * 0.25, v * P + wy * 0.25), e1 = c.e, id = c.id, dx = c.dx, dy = c.dy, f1 = c.f1;
      const s = small(u * Q + wx * 0.6, v * Q + wy * 0.6), e2 = s.e, id2 = s.id;
      const grit = N.fbm(u * 28, v * 28, 28, 28, 2, 9), crN = N.vnoise(u * 20, v * 20, 20, 20, 13) - 0.5;
      // facet: tilted plane per cell, bevelled down toward its border
      const tx = (N.hash2(id * 1e5 | 0, 1, 2) - 0.5) * 0.7, ty = (N.hash2(id * 1e5 | 0, 2, 2) - 0.5) * 0.7;
      const bevel = N.smooth(0, 0.14, e1);
      const cw = N.smooth(0.25, 0.6, N.vnoise(u * 7, v * 7, 7, 7, 23));  // crack depth varies so some facets merge
      const crack = (1 - N.smooth(0, 0.035 + 0.04 * cw, e1 + 0.05 * crN)) * (0.35 + 0.65 * cw); // big crevices
      const crack2 = (1 - N.smooth(0, 0.03, e2 + 0.03 * crN)) * N.smooth(0.15, 0.3, e1) * (id2 > 0.45 ? 1 : 0); // some sub-cracks
      let h = 0.5 + 0.9 * (tx * dx + ty * dy) + 0.05 * id2 + 0.15 * bevel + 0.06 * grit;
      h = h * (1 - 0.5 * crack) - 0.06 * crack2;
      // grey tone per cell between #7C7F80 and #9A9C98 (stretched slightly), sub-facet and grit variation
      const t = N.clamp01(0.5 + 1.1 * (id - 0.5) + 0.3 * (id2 - 0.5) + 0.4 * (grit - 0.5) + 0.25 * (tx * dx + ty * dy));
      let R = N.mix(0.470, 0.620, t), G = N.mix(0.482, 0.627, t), B = N.mix(0.490, 0.610, t);
      const k = (1 - 0.65 * crack) * (1 - 0.3 * crack2) * (0.9 + 0.1 * bevel) * (0.95 + 0.1 * N.hash2(x, y, 5));
      R *= k; G *= k; B *= k;
      // moss: patchy, on the upper part of cells (dy > 0, near the top edge) and in crevices
      const mossN = N.fbm(u * 6, v * 6, 6, 6, 2, 77);
      const top = N.smooth(0.05, 0.5, dy) * (1 - 0.6 * N.smooth(0.1, 0.45, e1)) * (id > 0.25 ? 1 : 0.3); // upper part of a cell
      const m = N.clamp01(N.smooth(0.5, 0.68, top * 0.65 + mossN * 0.55) + 0.8 * crack * N.smooth(0.45, 0.6, mossN)) * 0.9;
      const mk = 0.75 + 0.45 * grit;
      R = N.mix(R, 0.373 * mk, m); G = N.mix(G, 0.498 * mk, m); B = N.mix(B, 0.227 * mk, m);
      albedo[i * 3] = R; albedo[i * 3 + 1] = G; albedo[i * 3 + 2] = B;
      height[i] = N.clamp01(h + 0.04 * m * grit);
      rough[i] = N.clamp01(0.85 + 0.05 * (1 - bevel) + 0.04 * crack + 0.04 * m);
    }
  }
  return { albedo, height, rough };
}
