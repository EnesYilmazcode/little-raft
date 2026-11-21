// Bed model: a low plank frame with a headboard, a leafy mattress, a pillow and a folded teal blanket.
// Built ONCE: one merged vertex-coloured geometry with one material. instance() returns a Group with a
// single mesh (1 draw call) that shares them. game.js rebuildRaft() disposes children it removes, so the
// shared dispose() calls are no-ops here; the module's dispose() frees them for real.
// Local origin = centre of the floor tile top (place at y = .22). Head at -z. Footprint 1.15 x 1.9.

export function buildBed(T) {
  const parts = [];
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), s = new T.Vector3(1, 1, 1);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function box(w, h, d, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, jitter = 0.05) {
    const g = new T.BoxGeometry(w, h, d).toNonIndexed();
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); m4.compose(p, q, s); g.applyMatrix4(m4);
    const n = g.attributes.position.count, col = new Float32Array(n * 3), c = new T.Color(hex).multiplyScalar(1 + (rnd() - .5) * jitter * 2);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  }

  // --- frame
  const WOOD = 0x9a6b43, DARK = 0x7a5233;
  box(1.15, .22, 1.9, WOOD, 0, .16, 0, 0, 0, 0, .03);
  for (const sx of [-1, 1]) box(.04, .2, 1.86, DARK, sx * .56, .17, 0, 0, 0, 0, 0);    // side rails (darker trim)
  box(1.15, .55, .08, WOOD, 0, .4, -.95, 0, 0, 0, .03);                                 // headboard
  box(1.2, .06, .12, DARK, 0, .7, -.95);                                                // headboard cap
  box(1.15, .3, .06, DARK, 0, .22, .95);                                                // footboard
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(.1, .08, .1, DARK, sx * .52, .04, sz * .88);
  // --- mattress, pillow, blanket
  box(1.02, .14, 1.78, 0xc9c08a, 0, .34, 0, 0, 0, 0, .02);
  box(.7, .1, .32, 0xefe6d2, 0, .45, -.68, .12, 0, 0, .01);
  box(1.06, .06, 1.0, 0x3f8f8a, 0, .43, .35, 0, 0, 0, .02);
  box(1.08, .08, .14, 0x5aa8a0, 0, .465, -.13, 0, 0, 0, .02);                           // folded lip
  for (const sx of [-1, 1]) box(.03, .16, 1.0, 0x357c77, sx * .54, .37, .35, 0, 0, 0, 0); // blanket drape on the sides

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
  const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: 0 });
  mat.name = 'bed';

  const noop = () => {};
  const realGeo = T.BufferGeometry.prototype.dispose, realMat = T.Material.prototype.dispose;
  geo.dispose = noop; mat.dispose = noop; // shared: rebuildRaft must not free them

  return {
    geometry: geo, material: mat,
    instance() {
      const g = new T.Group(); g.name = 'craft_bed';
      const body = new T.Mesh(geo, mat); body.castShadow = true; body.receiveShadow = true;
      g.add(body); g.userData.craftType = 'bed'; g.userData.height = .95;
      return g;
    },
    dispose() { realGeo.call(geo); realMat.call(mat); },
  };
}
