// Cloth: off-white sail canvas. UV scale: one tile ~ 0.5 m of sail (preset repeat 2x2), 56 threads per tile.
// Plain weave (over/under checker of arched warp/weft threads), slub thickness noise per thread,
// one horizontal stitched seam (folded double layer) and a slightly warmer patch with a stitched border.
// Seamless: integer thread count, periodic noise, seam/patch kept inside the tile.
export const normalStrength = 3;
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const LIGHT = hex('#E9DFC6'), SHADE = hex('#D8CCAE'), PATCH = hex('#DCCDA6'), THREAD = hex('#B9A67E');

export default function generate(S, N) {
  const albedo = new Float32Array(S * S * 3), height = new Float32Array(S * S), rough = new Float32Array(S * S);
  const T = 56, P = S / T;                                    // threads per tile, px per thread (4)
  // Slub: each thread gets a thickness that drifts along its length (periodic 1D-ish noise).
  const slubX = new Float32Array(S * T), slubY = new Float32Array(S * T);
  for (let k = 0; k < T; k++) for (let i = 0; i < S; i++) {
    slubX[k * S + i] = N.vnoise(k * 0.5, i / S * 12, T / 2, 12, 5);
    slubY[k * S + i] = N.vnoise(k * 0.5, i / S * 12, T / 2, 12, 6);
  }
  const C = [0, 0, 0], SEAM = 0.62, PX0 = 0.14, PX1 = 0.46, PY0 = 0.12, PY1 = 0.42;   // seam row (v) and patch rect (u,v)
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S, ty = Math.floor(y / P), fy = (y % P + 0.5) / P;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, tx = Math.floor(x / P), fx = (x % P + 0.5) / P, s = y * S + x;
      const sx = slubX[tx * S + y], sy = slubY[ty * S + x];       // warp (vertical) and weft (horizontal) slub
      const warpUp = (tx + ty) & 1;
      const archW = Math.sin(Math.PI * fx) ** (1.4 - 0.8 * sx), archF = Math.sin(Math.PI * fy) ** (1.4 - 0.8 * sy);
      const along = warpUp ? Math.sin(Math.PI * fy) : Math.sin(Math.PI * fx); // thread dips under at cell ends
      let h = warpUp ? archW * (0.6 + 0.4 * along) : archF * (0.6 + 0.4 * along);
      const slub = warpUp ? sx : sy;
      h = 0.3 + 0.35 * h + 0.12 * (slub - 0.5);
      const low = N.fbm(u * 5, v * 5, 5, 5, 2, 9);
      const k = 0.05 + 0.45 * (low - 0.5) + 0.4 * (1 - h) + 0.25 * (0.5 - slub), c = C;
      for (let i = 0; i < 3; i++) c[i] = LIGHT[i] + (SHADE[i] - LIGHT[i]) * k;
      // Patch: warmer tone, slightly raised, stitched running border.
      const inP = N.smooth(-0.004, 0.004, Math.min(u - PX0, PX1 - u, v - PY0, PY1 - v));
      if (inP > 0) { for (let i = 0; i < 3; i++) c[i] += (PATCH[i] - LIGHT[i]) * inP; h += 0.08 * inP; }
      const bd = Math.min(Math.abs(u - PX0 - 0.022), Math.abs(PX1 - 0.022 - u), Math.abs(v - PY0 - 0.022), Math.abs(PY1 - 0.022 - v));
      const inner = u > PX0 + 0.01 && u < PX1 - 0.01 && v > PY0 + 0.01 && v < PY1 - 0.01;
      const along2 = Math.abs(u - PX0 - 0.022) === bd || Math.abs(PX1 - 0.022 - u) === bd ? v : u;
      let st = inner ? (1 - N.smooth(0.003, 0.007, bd)) * (((along2 * S / 7) % 1) < 0.62 ? 1 : 0) : 0;
      // Seam: folded double layer along v=SEAM with a raised ridge, shadow line and two stitch rows.
      const sd = v - SEAM, ad = Math.abs(sd);
      const fold = 1 - N.smooth(0.03, 0.04, ad);
      h += 0.1 * fold - 0.18 * (1 - N.smooth(0.0, 0.006, Math.abs(sd + 0.035)));
      const dm = (1 - 0.1 * (1 - N.smooth(0, 0.008, Math.abs(sd + 0.036)))) * (1 - 0.04 * fold);
      for (let i = 0; i < 3; i++) c[i] *= dm;
      const sr = Math.min(Math.abs(sd - 0.018), Math.abs(sd + 0.018));
      st = Math.max(st, (1 - N.smooth(0.003, 0.007, sr)) * (((u * S / 7) % 1) < 0.62 ? 1 : 0));
      if (st > 0) { for (let i = 0; i < 3; i++) c[i] += (THREAD[i] - c[i]) * st * 0.85; h += 0.1 * st; }
      albedo[s * 3] = c[0]; albedo[s * 3 + 1] = c[1]; albedo[s * 3 + 2] = c[2];
      height[s] = h; rough[s] = 0.92 - 0.05 * h + 0.03 * (low - 0.5) - 0.06 * st;
    }
  }
  return { albedo, height, rough };
}
