// Rock: island / coastal boulder. UV scale: one tile ~= 1/2 UV unit (preset repeat [2,2]).
// Draws a few big rounded, strongly tilted facets (warped Worley P=3), about half of them split again
// by a P=5 Worley into mid-size chunks (mixed sizes, so it reads as fractured boulder, not paving),
// thin dark cracks, fine fbm grit, painted top-light (upward-facing facets lighter), and moss #5F7F3A
// only on the upper (high-v) caps of facets, never in the cracks. Seamless: integer periods, wrapped Worley.
export const normalStrength = 5;

export default function generate(S, N) {
  const n = S * S, albedo = new Float32Array(n * 3), height = new Float32Array(n), rough = new Float32Array(n);
  const P = 3, Q = 5, big = N.worleyGrid(P, P, 41, 0.9), mid = N.worleyGrid(Q, Q, 57, 0.9);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x;
      const wx = N.vnoise(u * 4, v * 4, 4, 4, 3) - 0.5, wy = N.vnoise(u * 4, v * 4, 4, 4, 4) - 0.5;
      const bx = u * P + wx * 0.35, by = v * P + wy * 0.35;
      const c = big(bx, by), id = c.id, e1 = c.f2 - c.f1, dx = bx - c.cx, dy = by - c.cy, f1 = c.f1;
      const split = id > 0.5;                                             // ~half the boulders are split again
      const m = mid(u * Q + wx * 0.5, v * Q + wy * 0.5), e2 = m.f2 - m.f1, id2 = split ? m.id : id;
      const mdx = u * Q + wx * 0.5 - m.cx, mdy = v * Q + wy * 0.5 - m.cy;
      const hp = N.hash2(x, y, 5), grit = 0.75 * N.vnoise(u * 24, v * 24, 24, 24, 9) + 0.25 * hp, crN = N.vnoise(u * 16, v * 16, 16, 16, 13) - 0.5;
      // facet: tilted plane per (sub)cell plus a dome, bevelled toward borders
      const tx = ((id2 * 37.3) % 1 - 0.5) * 1.2, ty = ((id2 * 71.9) % 1 - 0.5) * 1.2 + 0.15; // per-facet tilt from its id
      const fdx = split ? mdx / Q * P : dx, fdy = split ? mdy / Q * P : dy;  // offset in big-cell units
      const tilt = tx * fdx + ty * fdy, dome = -0.35 * f1 * f1;
      const bevel = N.smooth(0, 0.16, e1), bevel2 = split ? N.smooth(0, 0.1, e2) : 1;
      const cw = N.smooth(0.4, 0.8, N.vnoise(u * 5, v * 5, 5, 5, 23));  // crack depth varies: some joints nearly close
      const crack = (1 - N.smooth(0, 0.014 + 0.016 * cw, e1 + 0.03 * crN)) * (0.15 + 0.85 * cw);
      const crack2 = split ? (1 - N.smooth(0, 0.016, e2 + 0.02 * crN)) * N.smooth(0.04, 0.12, e1) : 0;
      let h = 0.5 + 1.4 * tilt + 1.4 * dome + 0.08 * bevel + 0.05 * bevel2 + 0.06 * grit;
      h = h * (1 - 0.45 * crack) - 0.12 * crack2;
      // warm light grey per facet (#8C8880 .. #B8B3A6), lighter where the facet faces up (painted top light)
      const t = N.clamp01(0.5 + 0.7 * (id2 - 0.5) + 0.45 * (grit - 0.5) + 0.8 * tilt + 0.35 * (fdy * 0.5) + 0.15 * (bevel - 1));
      let R = N.mix(0.55, 0.72, t), G = N.mix(0.535, 0.70, t), B = N.mix(0.50, 0.65, t);
      const k = (1 - 0.55 * crack) * (1 - 0.3 * crack2) * (0.92 + 0.08 * bevel * bevel2) * (0.96 + 0.08 * hp);
      R *= k; G *= k; B *= k;
      // moss: patchy caps on the upper part of facets, kept off the cracks
      const mossN = N.vnoise(u * 3, v * 3, 3, 3, 77) * 0.6 + N.vnoise(u * 8, v * 8, 8, 8, 78) * 0.25 + 0.15 * grit;
      const cap = N.smooth(-0.15, 0.4, fdy) * N.smooth(0.03, 0.12, e1) * (0.6 + 0.4 * bevel2) * (id > 0.2 ? 1 : 0);
      const mo = N.smooth(0.56, 0.78, cap * 0.55 + mossN * 0.65) * 0.9;
      const mk = 0.8 + 0.4 * grit;
      R = N.mix(R, (0.36 + 0.1 * mossN) * mk, mo); G = N.mix(G, (0.50 + 0.06 * mossN) * mk, mo); B = N.mix(B, 0.24 * mk, mo);
      albedo[i * 3] = R; albedo[i * 3 + 1] = G; albedo[i * 3 + 2] = B;
      height[i] = N.clamp01(h + 0.04 * mo * grit);
      rough[i] = N.clamp01(0.84 + 0.05 * (1 - bevel) + 0.05 * crack + 0.05 * mo);
    }
  }
  return { albedo, height, rough };
}
