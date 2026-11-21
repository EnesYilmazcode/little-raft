// Bark: fissured grey-brown bark plates for the round logs under the raft deck.
// UV: CylinderGeometry, u wraps around the log, v runs along it; preset repeat [2,1] on a ~0.4 m
// circumference x 2 m log, so one tile is ~0.2 m (u) x ~2 m (v). The tile is therefore authored
// squashed in v (~10x): plates are 7 across u and 8 along v (~29 x 250 mm on the log).
// Plates = periodic Voronoi, metric partly squashed in v so fissures form a long diamond net;
// deep dark fissures, lighter dry ridge tops, fine grain along the log, sparse lichen speckle.
export const normalStrength = 5;

export default function generate(S, N) {
  const n = S * S, albedo = new Float32Array(n * 3), height = new Float32Array(n), rough = new Float32Array(n);
  const PX = 7, PY = 8, KY = 1.6; // plate grid; KY = physical cell height / width
  const pts = new Float32Array(PX * PY * 3); // jittered plate centres (cell units) + id
  for (let j = 0; j < PY; j++) for (let i = 0; i < PX; i++) {
    const k = (j * PX + i) * 3;
    pts[k] = i + 0.5 + (N.hash2(i, j, 5) - 0.5) * 0.8; pts[k + 1] = j + 0.5 + (N.hash2(i, j, 6) - 0.5) * 0.95; pts[k + 2] = N.hash2(i, j, 7);
  }
  const dark = [0.2, 0.15, 0.11], lo = [0.37, 0.3, 0.22], hi = [0.5, 0.42, 0.31], dry = [0.62, 0.56, 0.46], lich = [0.55, 0.6, 0.5];
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x;
      // periodic warp so fissures wander sideways along the log
      const gx = u * PX + 1.1 * (N.vnoise(u * 4, v * 10, 4, 10, 11) - 0.5), gy = v * PY;
      const xi = Math.floor(gx), yi = Math.floor(gy);
      let f1 = 9, f2 = 9, id = 0;
      for (let b = -1; b <= 1; b++) for (let a = -2; a <= 2; a++) {
        const cx = ((xi + a) % PX + PX) % PX, cy = ((yi + b) % PY + PY) % PY, k = (cy * PX + cx) * 3;
        const dx = xi + a + pts[k] - cx - gx, dy = (yi + b + pts[k + 1] - cy - gy) * KY;
        const d = dx * dx + dy * dy;
        if (d < f1) { f2 = f1; f1 = d; id = pts[k + 2]; } else if (d < f2) f2 = d;
      }
      const edge = Math.sqrt(f2) - Math.sqrt(f1); // ~distance to plate border, x-cell units
      const cw = 0.07 + 0.13 * N.vnoise(u * 8, v * 16, 8, 16, 31);
      const crack = 1 - N.smooth(0, cw, edge);
      const crown = N.smooth(0.03, 0.5, edge);
      const grain = N.vnoise(u * 64, v * 6, 64, 6, 41) * 0.6 + N.vnoise(u * 28, v * 3, 28, 3, 43) * 0.4;
      const h = N.clamp01(0.22 + 0.55 * crown + 0.16 * (grain - 0.5) + 0.1 * (id - 0.5) - 0.3 * crack);
      height[i] = h;
      const t = N.clamp01(0.4 + 0.55 * (id - 0.5) + 0.6 * (grain - 0.5) + 0.2 * crown);
      const top = N.smooth(0.55, 0.8, h) * (0.4 + 0.6 * N.vnoise(u * 14, v * 20, 14, 20, 53));
      // lichen: patchy mask x sparse speckle (2 px across, 1 px along: round on the log)
      const lm = N.smooth(0.52, 0.66, N.vnoise(u * 6, v * 10, 6, 10, 67)) * N.smooth(0.72, 0.85, N.hash2(x >> 1, y, 71)) * (1 - crack);
      for (let c = 0; c < 3; c++) {
        let col = N.mix(lo[c], hi[c], t);
        col = N.mix(col, dry[c], top * 0.6);
        col = N.mix(col, dark[c], crack * 0.95);
        albedo[i * 3 + c] = N.mix(col, lich[c], lm * 0.6);
      }
      rough[i] = N.clamp01(0.92 + 0.06 * crack - 0.05 * top);
    }
  }
  return { albedo, height, rough };
}
