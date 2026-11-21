// Low-poly shark for dist/shark.js: our own faceted grey shark with a tall dorsal fin, pale belly and a
// crescent tail. Two merged, vertex-coloured geometries (body, tail) with per-face normals share one matte material: 2 draw calls.
// Conventions as in wildlife-models.js: nose +z, up +y, origin at the body centre. Built once, never per frame.

export const SHARK_LENGTH = 3.1;            // nose to tail tip, metres (spear capsule length)
export const SHARK_TAIL_PIVOT = [0, 0.02, -1.38]; // where the tail mesh hinges on the body

const BACK = 0x6c7c87, BACK_DARK = 0x56656f, BELLY = 0xe6ebe8, FIN = 0x5b6a75, FIN_TIP = 0x46535c, EYE = 0x101418, GILL = 0x3b464e, MOUTH = 0x2a2226;

// Two-sided flat triangles from a flat [x,y,z,...] list (so thin fins show from both sides with one material).
function fin(T, pts) {
  const both = pts.slice();
  for (let i = 0; i < pts.length; i += 9) both.push(pts[i], pts[i + 1], pts[i + 2], pts[i + 6], pts[i + 7], pts[i + 8], pts[i + 3], pts[i + 4], pts[i + 5]);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(both, 3));
  g.computeVertexNormals();
  return g;
}
// color: hex, or fn(x, y, z) -> hex on the untransformed face centre. place = [x, y, z, rx, ry, rz, sx, sy, sz].
function part(T, geo, color, place) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3), c = new T.Color();
  for (let i = 0; i < n; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    c.setHex(typeof color === 'function' ? color(cx, cy, cz) : color);
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r; col[(i + k) * 3 + 1] = c.g; col[(i + k) * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  if (place) {
    const [x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1] = place;
    g.applyMatrix4(new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz)));
  }
  g.computeVertexNormals();
  return g;
}
function merge(T, parts) {
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o); nor.set(p.attributes.normal.array, o); col.set(p.attributes.color.array, o);
    o += p.attributes.position.count * 3; p.dispose();
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.BufferAttribute(nor, 3));
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}
// countershading: grey back, a darker stripe along the spine, pale belly (unit-sphere / cylinder local coords)
const shade = (x, y) => (y < -0.28 ? BELLY : y > 0.72 ? BACK_DARK : BACK);
const shadeCyl = (x, y, z) => (z > 0.12 ? BELLY : BACK); // rotated +90 deg about x: local +z ends up underneath

export function sharkBodyGeometry(T) {
  const P = [];
  // trunk: a long faceted spindle, widest just behind the head
  P.push(part(T, new T.SphereGeometry(1, 12, 8), shade, [0, 0, 0.12, 0, 0, 0, 0.44, 0.46, 1.28]));
  // head and snout: a squashed cone ahead of the trunk
  P.push(part(T, new T.ConeGeometry(0.33, 0.62, 10), (x, y, z) => (z > 0.1 ? BELLY : BACK), [0, -0.03, 1.48, Math.PI / 2, 0, 0, 1, 1, 0.72]));
  // rear trunk tapering to the tail stock
  P.push(part(T, new T.CylinderGeometry(0.33, 0.12, 0.95, 10), shadeCyl, [0, 0.03, -1.0, Math.PI / 2, 0, 0, 1, 1, 0.92]));
  // tall first dorsal fin, swept back, slightly curved trailing edge
  P.push(part(T, fin(T, [0, 0, 0.42, 0, 0, -0.22, 0, 0.62, -0.34, 0, 0, 0.42, 0, 0.62, -0.34, 0, 0.36, 0.08]), (x, y) => (y > 0.38 ? FIN_TIP : FIN), [0, 0.4, 0.05]));
  P.push(part(T, new T.BoxGeometry(0.06, 0.08, 0.62), FIN, [0, 0.42, 0.12])); // fin root, so the fin has some thickness where it meets the back
  // small second dorsal fin
  P.push(part(T, fin(T, [0, 0, -0.74, 0, 0, -0.98, 0, 0.17, -1.02]), FIN, [0, 0.27, 0]));
  // pectoral fins: long, angled down and back
  for (const s of [-1, 1]) {
    P.push(part(T, fin(T, [0, 0, 0.18, 0, 0, -0.18, s * 0.78, -0.22, -0.52]), FIN, [s * 0.34, -0.2, 0.58]));
    P.push(part(T, fin(T, [0, 0, 0.08, 0, 0, -0.1, s * 0.26, -0.1, -0.28]), FIN, [s * 0.2, -0.26, -0.7])); // pelvic
  }
  // eyes, gill slits, mouth line
  for (const s of [-1, 1]) {
    P.push(part(T, new T.SphereGeometry(1, 6, 4), EYE, [s * 0.235, 0.08, 1.2, 0, 0, 0, 0.04, 0.04, 0.04]));
    for (let g = 0; g < 3; g++) P.push(part(T, new T.BoxGeometry(0.02, 0.22, 0.025), GILL, [s * (0.405 - g * 0.006), -0.02, 0.86 - g * 0.1, 0, 0, s * 0.18]));
  }
  P.push(part(T, new T.BoxGeometry(0.4, 0.03, 0.2), MOUTH, [0, -0.2, 1.33, 0.25, 0, 0]));
  return merge(T, P);
}

// Tail: hinged at SHARK_TAIL_PIVOT, extends to -z. Tail stock plus a tall crescent caudal fin.
export function sharkTailGeometry(T) {
  const P = [];
  P.push(part(T, new T.CylinderGeometry(0.12, 0.06, 0.38, 8), shadeCyl, [0, 0, -0.17, Math.PI / 2, 0, 0]));
  P.push(part(T, fin(T, [
    0, 0.06, -0.26, 0, -0.04, -0.4, 0, 0.78, -0.74, // upper lobe
    0, 0.06, -0.26, 0, 0.78, -0.74, 0, 0.62, -0.58,
    0, -0.04, -0.26, 0, -0.46, -0.62, 0, -0.02, -0.42, // lower lobe
  ]), (x, y) => (y > 0.45 || y < -0.3 ? FIN_TIP : FIN)));
  return merge(T, P);
}
