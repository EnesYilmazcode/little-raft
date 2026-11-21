// Snack Float model (see docs/specs/snack-float.md section 6). Given THREE, imports nothing.
// Origin = waterline centre. Our own cozy design: a cream cork bobber with a teal band and a little stick,
// a squashed seaweed parcel beside it tied with crossed twine, and a silver fish tail poking out.
// One merged vertex-coloured mesh (one draw call), no shadows.

// Merge a list of [geometry, hex, matrix] into one non-indexed geometry with a colour attribute.
function bake(T, parts) {
  const geos = [];
  let n = 0;
  for (const [geo, hex, m4] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    if (m4) g.applyMatrix4(m4);
    const c = new T.Color(hex), cnt = g.attributes.position.count, col = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    geos.push(g); n += cnt;
  }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count; g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setAttribute('color', new T.BufferAttribute(col, 3));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

export function createSnackFloat(T) {
  const g = new T.Group(); g.name = 'snackFloat';
  const parts = [], q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), s = new T.Vector3();
  const add = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    e.set(rx, ry, rz, 'YXZ'); q.setFromEuler(e); p.set(x, y, z); s.set(sx, sy, sz);
    parts.push([geo, hex, new T.Matrix4().compose(p, q, s)]);
  };
  // cork bobber (sits a little proud of the water), teal band, little stick on top
  const cx = .07;
  add(new T.CylinderGeometry(.08, .09, .08, 10), 0xf3e2b8, cx, .03, 0);
  add(new T.CylinderGeometry(.092, .092, .022, 10, 1, true), 0x54a6a4, cx, .03, 0);
  add(new T.CylinderGeometry(.012, .014, .09, 5), 0xbb8650, cx, .115, 0);
  add(new T.SphereGeometry(.018, 6, 4), 0xe36a4f, cx, .165, 0); // red tip so it reads from the deck
  // seaweed parcel, squashed, with crossed twine bands
  const px = -.08, py = -.02;
  add(new T.SphereGeometry(.1, 9, 6), 0x4f9a5c, px, py, 0, 0, 0, 0, 1, .7, 1);
  add(new T.TorusGeometry(.1, .008, 3, 12), 0xd9c38c, px, py, 0, 0, 0, 0, 1.01, .71, 1.01);
  add(new T.TorusGeometry(.1, .008, 3, 12), 0xd9c38c, px, py, 0, 0, Math.PI / 2, 0, 1.01, .71, 1.01);
  // silver fish tail fan: two flat cones poking out of the parcel
  add(new T.ConeGeometry(.045, .09, 4), 0x9fb1bf, px - .1, py + .06, .02, 0, 0, .9, 1, 1, .35);
  add(new T.ConeGeometry(.045, .09, 4), 0x9fb1bf, px - .1, py + .06, -.02, 0, 0, 1.6, 1, 1, .35);
  const mesh = new T.Mesh(bake(T, parts), new T.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'snackFloatMesh'; mesh.castShadow = false; mesh.receiveShadow = false;
  g.add(mesh);
  return g;
}

export function disposeSnackFloat(g) {
  if (!g) return;
  g.traverse(o => { if (o.isMesh) { o.geometry?.dispose(); o.material?.dispose?.(); } });
}
