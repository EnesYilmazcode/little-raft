// Research Table model: a little scholar's desk with an open book, ink and quill, a globe,
// a candle and blueprints pinned to a backboard. Built ONCE: one merged vertex-coloured geometry
// with one material, plus a tiny emissive flame. instance() returns a cheap Group that shares them.
// game.js rebuildRaft() disposes children it removes, so the shared geometry/material dispose()
// calls are no-ops here; the module's dispose() frees them for real.
// Local origin = centre of the floor tile top (place at y = .22). Footprint ~1.45 x 0.95, ~1.3 tall.

export function buildResearchTable(T) {
  const parts = [];
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), s = new T.Vector3(1, 1, 1);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // add(geometry, colour, x,y,z, rx,ry,rz, jitter): bakes the transform and a vertex colour.
  function add(geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, jitter = 0.06, paint = null) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); m4.compose(p, q, s); g.applyMatrix4(m4);
    const n = g.attributes.position.count, col = new Float32Array(n * 3), base = new T.Color(hex), c = new T.Color();
    const tone = 1 + (rnd() - .5) * jitter * 2;
    for (let i = 0; i < n; i++) {
      c.copy(base).multiplyScalar(tone);
      if (paint) paint(g.attributes.position.getX(i) - x, g.attributes.position.getY(i) - y, g.attributes.position.getZ(i) - z, c);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    if (g.attributes.uv) g.deleteAttribute('uv');
    parts.push(g);
  }
  const box = (w, h, d, hex, x, y, z, rx, ry, rz, j) => add(new T.BoxGeometry(w, h, d), hex, x, y, z, rx, ry, rz, j);
  const cyl = (rt, rb, h, seg, hex, x, y, z, rx, ry, rz, j) => add(new T.CylinderGeometry(rt, rb, h, seg), hex, x, y, z, rx, ry, rz, j);

  // --- desk frame
  const TOP = 0.78;
  [-0.29, 0, 0.29].forEach((z, i) => box(1.44, 0.055, 0.28, [0xa0794c, 0x93703f, 0xa9824f][i], 0, TOP, z, 0, 0, 0, 0.03));
  for (const sx of [-1, 1]) {
    box(0.06, 0.06, 0.86, 0x6f4d2c, sx * 0.62, TOP - 0.055, 0);                 // apron sides
    for (const sz of [-1, 1]) box(0.085, TOP - 0.03, 0.085, 0x6a4a2b, sx * 0.62, (TOP - 0.03) / 2, sz * 0.36);
  }
  box(1.18, 0.06, 0.05, 0x6f4d2c, 0, TOP - 0.055, 0.4);
  box(1.18, 0.06, 0.05, 0x6f4d2c, 0, TOP - 0.055, -0.4);
  box(1.24, 0.035, 0.66, 0x86633c, 0, 0.2, 0);                                  // lower shelf
  // shelf clutter: two lying books and a seed jar
  box(0.32, 0.06, 0.22, 0x4f7a8c, -0.34, 0.25, 0.08, 0, 0.18);
  box(0.28, 0.05, 0.2, 0xb35d3e, -0.32, 0.305, 0.06, 0, -0.12);
  cyl(0.075, 0.075, 0.16, 12, 0xbfe0d4, 0.32, 0.3, -0.05);                       // glass-ish jar
  cyl(0.08, 0.08, 0.03, 12, 0x7a5838, 0.32, 0.395, -0.05);
  add(new T.SphereGeometry(0.05, 8, 6), 0x7cae58, 0.32, 0.29, -0.05);           // a sprout inside

  // --- backboard with pinned blueprints
  for (const sx of [-1, 1]) box(0.06, 0.55, 0.06, 0x6a4a2b, sx * 0.6, TOP + 0.27, -0.4);
  box(1.26, 0.42, 0.035, 0x8c6a42, 0, TOP + 0.33, -0.41, 0, 0, 0, 0.02);
  box(1.3, 0.05, 0.06, 0x6f4d2c, 0, TOP + 0.56, -0.4);
  box(0.34, 0.26, 0.01, 0x4b82b8, -0.36, TOP + 0.34, -0.39, 0, 0, 0.05, 0.02);   // blueprint
  box(0.26, 0.2, 0.012, 0xf1e3bf, 0.02, TOP + 0.36, -0.389, 0, 0, -0.06, 0.02);  // parchment note
  box(0.24, 0.24, 0.01, 0x5b93c4, 0.36, TOP + 0.33, -0.39, 0, 0, 0.03, 0.02);    // second blueprint
  for (const [x, y] of [[-0.36, TOP + 0.46], [0.02, TOP + 0.45], [0.36, TOP + 0.44]]) add(new T.SphereGeometry(0.018, 6, 4), 0xd9643a, x, y, -0.38);
  // white sketch lines on the blueprints
  box(0.22, 0.012, 0.004, 0xe8f3ff, -0.36, TOP + 0.36, -0.383, 0, 0, 0.05, 0);
  box(0.012, 0.16, 0.004, 0xe8f3ff, -0.42, TOP + 0.33, -0.383, 0, 0, 0.05, 0);
  add(new T.TorusGeometry(0.06, 0.008, 4, 16), 0xe8f3ff, 0.36, TOP + 0.33, -0.383);
  box(0.16, 0.01, 0.004, 0x7d6a50, 0.02, TOP + 0.39, -0.381, 0, 0, -0.06, 0);
  box(0.12, 0.01, 0.004, 0x7d6a50, 0.02, TOP + 0.35, -0.381, 0, 0, -0.06, 0);

  // --- open book (centre front)
  const BY = TOP + 0.04;
  box(0.62, 0.02, 0.3, 0x8e3b2e, 0, BY, 0.1, 0, 0.08, 0);                        // cover
  for (const sx of [-1, 1]) box(0.29, 0.03, 0.27, 0xf6ead0, sx * 0.15, BY + 0.025, 0.1, 0, 0.08, -sx * 0.1, 0.01);
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) box(0.2, 0.004, 0.012, 0x9a8a6c, sx * 0.15 + 0.01 * sx, BY + 0.044, 0.02 + k * 0.045, 0, 0.08, -sx * 0.1, 0);
  // ribbon bookmark
  box(0.02, 0.003, 0.16, 0xd9643a, 0.02, BY + 0.02, 0.27, 0, 0.08, 0);

  // --- ink pot and quill
  cyl(0.045, 0.055, 0.07, 10, 0x2b3e5c, 0.38, TOP + 0.06, 0.18);
  cyl(0.025, 0.03, 0.02, 10, 0x1a2638, 0.38, TOP + 0.105, 0.18);
  add(new T.ConeGeometry(0.03, 0.3, 6), 0xf7f1e3, 0.41, TOP + 0.22, 0.16, 0.25, 0, -0.35, 0.02);
  box(0.004, 0.24, 0.005, 0xb9aa8c, 0.41, TOP + 0.22, 0.163, 0.25, 0, -0.35, 0);

  // --- globe on a brass stand (left)
  const GX = -0.48, GZ = -0.12, GY = TOP + 0.2;
  cyl(0.08, 0.1, 0.025, 12, 0xc09a4a, GX, TOP + 0.04, GZ);
  cyl(0.012, 0.012, 0.1, 6, 0xc09a4a, GX, TOP + 0.08, GZ);
  add(new T.SphereGeometry(0.12, 18, 12), 0x3f8fc0, GX, GY, GZ, 0.4, 0, 0.35, 0, (x, y, z, c) => {
    const n = Math.sin(x * 31 + 1.3) * Math.cos(z * 27) + Math.sin(y * 23 + x * 9);
    if (n > 0.55) c.setHex(0x6fae5a);
    else if (n > 0.38) c.setHex(0xe3d59c);
  });
  add(new T.TorusGeometry(0.135, 0.007, 4, 28, Math.PI * 1.25), 0xc09a4a, GX, GY, GZ, 0, Math.PI / 2, 0.35 - 0.6);

  // --- candle on a dish (right back)
  const CX = 0.5, CZ = -0.2;
  cyl(0.08, 0.07, 0.02, 14, 0xc09a4a, CX, TOP + 0.04, CZ);
  cyl(0.032, 0.035, 0.14, 10, 0xfbefd2, CX, TOP + 0.12, CZ);
  cyl(0.003, 0.003, 0.025, 4, 0x3a2a1a, CX, TOP + 0.2, CZ);
  // rolled map + spyglass
  add(new T.CylinderGeometry(0.035, 0.035, 0.42, 10), 0xe7d3a6, -0.12, TOP + 0.065, -0.2, 0, 0.3, Math.PI / 2);
  add(new T.CylinderGeometry(0.02, 0.028, 0.26, 10), 0xc09a4a, 0.2, TOP + 0.055, -0.17, 0, -0.5, Math.PI / 2);
  // stacked books (back left on top)
  box(0.2, 0.05, 0.14, 0x5d8c4e, -0.22, TOP + 0.055, -0.26, 0, 0.1);

  // merge into one geometry
  let total = 0; for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count; g.dispose();
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
  geo.setAttribute('color', new T.BufferAttribute(col, 3));
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  mat.name = 'researchTable';
  const flameGeo = new T.ConeGeometry(0.018, 0.06, 8); flameGeo.translate(CX, TOP + 0.24, CZ);
  const flameMat = new T.MeshStandardMaterial({ color: 0xffc46b, emissive: 0xffa53a, emissiveIntensity: 1.6, roughness: 1 });
  flameMat.name = 'researchFlame';

  const noop = () => {};
  const realGeo = T.BufferGeometry.prototype.dispose, realMat = T.Material.prototype.dispose;
  for (const x of [geo, flameGeo, mat, flameMat]) x.dispose = noop; // shared: rebuildRaft must not free them

  return {
    geometry: geo, material: mat,
    instance() {
      const g = new T.Group(); g.name = 'craft_research';
      const body = new T.Mesh(geo, mat); body.castShadow = true; body.receiveShadow = true;
      const flame = new T.Mesh(flameGeo, flameMat); flame.castShadow = false;
      g.add(body, flame); g.userData.craftType = 'research'; g.userData.height = 1.36;
      return g;
    },
    flicker(t) { flameMat.emissiveIntensity = 1.4 + Math.sin(t * 9.1) * 0.25 + Math.sin(t * 23.7) * 0.15; },
    dispose() { realGeo.call(geo); realGeo.call(flameGeo); realMat.call(mat); realMat.call(flameMat); },
  };
}
