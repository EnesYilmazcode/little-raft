// Low-poly raft animal models for dist/animals.js (wildlife-models style). Every creature builder returns ONE
// merged BufferGeometry with position, normal and color attributes for one vertex-coloured Lambert material.
// Conventions: origin at the feet, nose +z, up +y. Built once, never per frame.

function tri(T, pts) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
  g.computeVertexNormals();
  return g;
}

// One coloured piece. color is a hex number or fn(face, x, y, z) -> hex on the untransformed geometry.
// place = [x, y, z, rx, ry, rz, sx, sy, sz] (Euler XYZ, then translate).
function part(T, geo, color, place) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3), c = new T.Color();
  for (let i = 0; i < n; i++) {
    c.setHex(typeof color === 'function' ? color(Math.floor(i / 3), pos.getX(i), pos.getY(i), pos.getZ(i)) : color);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  if (place) {
    const [x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1] = place;
    const m = new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz));
    g.applyMatrix4(m);
  }
  return g;
}

function merge(T, parts) {
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    if (!p.attributes.normal) p.computeVertexNormals();
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

const ball = (T, w = 8, h = 6) => new T.SphereGeometry(1, w, h);
const hash = (a, b = 0) => { let h = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b); h ^= h >>> 13; return ((Math.imul(h, 0xc2b2ae35) >>> 0) % 1000) / 1000; };

export const vertexMaterial = T => new T.MeshLambertMaterial({ vertexColors: true });

// Puffhen: a round cream hen-puff, ~0.36 m tall. Warm brown back cap, big dark eyes with glints, tiny
// orange beak, a three-feather crest, stubby wings, a fan tail and orange stub feet.
export function puffhenGeometry(T) {
  const cream = 0xfff1d6, creamLo = 0xf3dfbc, brown = 0xb3713e, brownDk = 0x8a5230, orange = 0xf39a3a, dark = 0x22191a, pink = 0xf6a5a0;
  const P = [];
  P.push(part(T, ball(T, 12, 9), (f, x, y) => (y < -0.55 ? creamLo : cream), [0, 0.17, 0, 0, 0, 0, 0.17, 0.15, 0.17])); // body
  P.push(part(T, ball(T, 10, 6), brown, [0, 0.235, -0.035, -0.25, 0, 0, 0.152, 0.095, 0.15])); // back cap
  P.push(part(T, ball(T, 10, 8), cream, [0, 0.285, 0.085, 0, 0, 0, 0.098, 0.092, 0.092])); // head
  P.push(part(T, ball(T, 8, 5), brown, [0, 0.33, 0.055, -0.3, 0, 0, 0.082, 0.045, 0.075])); // head cap
  for (const s of [-1, 1]) {
    P.push(part(T, ball(T, 8, 6), dark, [s * 0.047, 0.296, 0.158, 0, 0, 0, 0.026, 0.03, 0.02])); // eye
    P.push(part(T, ball(T, 5, 4), 0xffffff, [s * 0.052, 0.307, 0.174, 0, 0, 0, 0.009, 0.009, 0.007])); // glint
    P.push(part(T, ball(T, 6, 4), pink, [s * 0.07, 0.262, 0.145, 0, 0, 0, 0.02, 0.012, 0.01])); // cheek
    P.push(part(T, ball(T, 8, 6), f => (f % 3 ? brown : brownDk), [s * 0.158, 0.175, -0.012, 0.25, 0, s * 0.18, 0.035, 0.085, 0.11])); // wing
    P.push(part(T, new T.CylinderGeometry(0.011, 0.013, 0.05, 5), orange, [s * 0.05, 0.035, 0.015])); // leg
    P.push(part(T, ball(T, 6, 4), orange, [s * 0.052, 0.012, 0.04, 0, 0, 0, 0.032, 0.013, 0.045])); // foot
  }
  P.push(part(T, new T.ConeGeometry(0.022, 0.055, 6), orange, [0, 0.27, 0.198, Math.PI / 2, 0, 0])); // beak
  for (let k = -1; k <= 1; k++) { // crest tuft
    P.push(part(T, new T.ConeGeometry(0.012, 0.085, 5), k ? brown : brownDk, [k * 0.018, 0.395, 0.07 - Math.abs(k) * 0.012, -0.35, 0, -k * 0.38]));
  }
  for (let k = -2; k <= 2; k++) { // fan tail, feathers fanned up and back
    const a = k * 0.32;
    P.push(part(T, ball(T, 6, 4), Math.abs(k) % 2 ? brownDk : brown, [Math.sin(a) * 0.05, 0.25 + Math.cos(a) * 0.03, -0.16, -0.75, 0, -a, 0.03, 0.085, 0.014]));
  }
  return merge(T, P);
}

// Egg: origin at the bottom, ~0.11 m tall, cream with a few warm speckles.
export function eggGeometry(T) {
  return merge(T, [part(T, ball(T, 9, 7), (f, x, y, z) => (hash(f, 3) < 0.13 && y > -0.6 ? 0xb88a5e : y > 0.2 ? 0xfff5e0 : 0xf4e5c6), [0, 0.055, 0, 0, 0, 0, 0.042, 0.058, 0.042])]);
}

// Heart: flat two-lobed shape, ~0.16 m wide, centred.
export function heartGeometry(T) {
  const pink = 0xff7d9c;
  return merge(T, [
    part(T, ball(T, 10, 7), pink, [-0.04, 0.03, 0, 0, 0, 0, 0.048, 0.048, 0.02]),
    part(T, ball(T, 10, 7), pink, [0.04, 0.03, 0, 0, 0, 0, 0.048, 0.048, 0.02]),
    part(T, new T.ConeGeometry(0.082, 0.1, 10), pink, [0, -0.028, 0, Math.PI, 0, 0, 1, 1, 0.24]),
  ]);
}

const decorMesh = (T, geo) => {
  const m = new T.Mesh(geo, vertexMaterial(T));
  m.castShadow = true; m.receiveShadow = true;
  return m;
};

// Nest Box: a 0.7 m woven crate with slatted sides, a straw ring on the rim and a little slanted roof on the back.
export function nestBoxModel(T) {
  const wood = 0xb8844f, woodDk = 0x8c6136, woodLt = 0xcf9e65, straw = 0xe8c66a, strawDk = 0xcda54b;
  const P = [], W = 0.7, H = 0.3, half = W / 2;
  for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.push(part(T, new T.BoxGeometry(0.07, H + 0.04, 0.07), woodDk, [cx * (half - 0.035), (H + 0.04) / 2, cz * (half - 0.035)])); // corner posts
  for (let s = 0; s < 3; s++) { // three woven slats per side, alternating shades and offsets
    const y = 0.06 + s * 0.095;
    for (let side = 0; side < 4; side++) {
      const shade = (s + side) % 2 ? wood : woodLt;
      const rot = side % 2 ? Math.PI / 2 : 0, off = ((s + side) % 2 ? 1 : -1) * 0.006;
      const px = side === 1 ? half - 0.02 + off : side === 3 ? -half + 0.02 - off : 0;
      const pz = side === 0 ? half - 0.02 + off : side === 2 ? -half + 0.02 - off : 0;
      P.push(part(T, new T.BoxGeometry(W - 0.1, 0.075, 0.03), shade, [px, y, pz, 0, rot, 0]));
    }
  }
  P.push(part(T, new T.BoxGeometry(W - 0.06, 0.04, W - 0.06), woodDk, [0, 0.02, 0])); // floor
  P.push(part(T, new T.CylinderGeometry(0.29, 0.25, 0.1, 12), straw, [0, 0.21, 0])); // straw bed
  P.push(part(T, new T.TorusGeometry(0.27, 0.05, 6, 16), (f) => (hash(f) < 0.5 ? straw : strawDk), [0, H, 0, Math.PI / 2, 0, 0])); // straw ring
  for (let k = 0; k < 10; k++) { // loose straw tufts poking out of the rim
    const a = k / 10 * Math.PI * 2 + 0.2;
    P.push(part(T, new T.ConeGeometry(0.012, 0.09, 3), k % 2 ? straw : strawDk, [Math.cos(a) * 0.3, H + 0.03, Math.sin(a) * 0.3, Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7]));
  }
  for (const sx of [-1, 1]) P.push(part(T, new T.BoxGeometry(0.05, 0.32, 0.05), woodDk, [sx * (half - 0.035), H + 0.16, -half + 0.035])); // roof posts
  P.push(part(T, new T.BoxGeometry(W + 0.04, 0.03, 0.3), f => (f % 4 < 2 ? woodLt : wood), [0, H + 0.25, -half + 0.1, 0.62, 0, 0])); // slanted roof over the back
  return group(T, decorMesh(T, merge(T, P)), 'decor_nestbox');
}

// Feather Cushion: a 0.6 m plump rounded-square pillow with four corner tufts and a centre button.
export function cushionModel(T) {
  const cloth = 0xe99a8c, clothLt = 0xf6b8a6, tuft = 0xfff1d6, button = 0xb3713e;
  const geo = new T.SphereGeometry(1, 16, 10), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { // squash the sphere toward a rounded square
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z), m = Math.max(Math.abs(x), Math.abs(z));
    if (m > 1e-6) { const k = 1 + 0.55 * (r / m - 1); p.setX(i, x * k); p.setZ(i, z * k); }
  }
  const P = [part(T, geo, (f, x, y) => (y > 0.2 ? clothLt : cloth), [0, 0.075, 0, 0, 0, 0, 0.29, 0.075, 0.29])];
  for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    P.push(part(T, new T.ConeGeometry(0.035, 0.09, 5), tuft, [cx * 0.3, 0.075, cz * 0.3, cz * 1.2, 0, -cx * 1.2]));
  }
  P.push(part(T, new T.CylinderGeometry(0.035, 0.035, 0.03, 10), button, [0, 0.148, 0]));
  return group(T, decorMesh(T, merge(T, P)), 'decor_cushion');
}

function group(T, mesh, name) { const g = new T.Group(); g.name = name; g.add(mesh); return g; }
