// Tusker model: a stocky low-poly island boar in two vertex-coloured geometries that share one flat-shaded
// Lambert material: the body (one mesh) and one leg (drawn as a 4-instance InstancedMesh), so 2 draw calls.
// Conventions: origin at the feet, nose +z, up +y; about 1.15 m long and 0.62 m at the shoulder hump.
// Legs pivot at their top (y = 0 of the leg geometry); LEG_HIPS lists the four hip points on the body.

export const LEG_LEN = 0.36;
// [x, y, z] hips: front-left, front-right, back-left, back-right.
export const LEG_HIPS = Object.freeze([[-0.16, 0.37, 0.24], [0.16, 0.37, 0.24], [-0.15, 0.36, -0.28], [0.15, 0.36, -0.28]]);

const COL = { hide: 0x5a4a3f, hideLo: 0x4a3c33, belly: 0x7a6656, ridge: 0x9a5a2e, ridgeDk: 0x6e3c1e, snout: 0xc98a7c,
  nostril: 0x2a1c18, tusk: 0xf1e6c8, eye: 0x140e0c, ear: 0x6b5446, hoof: 0x2b221d, wart: 0x6d5a4c, tuft: 0x3a2c24 };

const hash = (a, b = 0) => { let h = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b); h ^= h >>> 13; return ((Math.imul(h, 0xc2b2ae35) >>> 0) % 1000) / 1000; };

// One coloured piece. color: hex or fn(face, x, y, z) on the untransformed geometry. place = [x,y,z, rx,ry,rz, sx,sy,sz].
function part(T, geo, color, place) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3), c = new T.Color();
  for (let i = 0; i < n; i++) {
    const f = Math.floor(i / 3), v0 = f * 3; // colour per face (sampled at the face's first corner) keeps the facets crisp
    c.setHex(typeof color === 'function' ? color(f, pos.getX(v0), pos.getY(v0), pos.getZ(v0)) : color);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  if (place) {
    const [x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1] = place;
    g.applyMatrix4(new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz)));
  }
  return g;
}
function merge(T, parts) {
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array, o); col.set(p.attributes.color.array, o); o += p.attributes.position.count * 3; p.dispose(); }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.computeVertexNormals(); // non-indexed: flat face normals
  g.computeBoundingSphere();
  return g;
}
const ball = (T, w = 7, h = 5) => new T.SphereGeometry(1, w, h);
// Mottled hide: a few darker facets, lighter underside.
const hide = (f, x, y) => (y < -0.45 ? COL.belly : hash(f, 11) < 0.22 ? COL.hideLo : COL.hide);

export function boarBodyGeometry(T) {
  const P = [];
  P.push(part(T, ball(T, 8, 6), hide, [0, 0.5, 0.02, 0, 0, 0, 0.3, 0.25, 0.5]));          // barrel torso
  P.push(part(T, ball(T, 7, 5), hide, [0, 0.55, 0.2, -0.15, 0, 0, 0.3, 0.27, 0.3]));      // shoulder hump (front heavy)
  P.push(part(T, ball(T, 7, 5), hide, [0, 0.47, -0.27, 0.1, 0, 0, 0.26, 0.23, 0.25]));    // rump
  P.push(part(T, ball(T, 7, 5), hide, [0, 0.44, 0.52, 0.35, 0, 0, 0.19, 0.18, 0.24]));    // wedge head, nose down
  P.push(part(T, new T.CylinderGeometry(0.085, 0.11, 0.2, 7), COL.hideLo, [0, 0.36, 0.7, Math.PI / 2 + 0.35, 0, 0])); // snout
  P.push(part(T, new T.CylinderGeometry(0.088, 0.088, 0.03, 7), COL.snout, [0, 0.325, 0.795, Math.PI / 2 + 0.35, 0, 0])); // snout disc
  for (const s of [-1, 1]) {
    P.push(part(T, ball(T, 4, 3), COL.nostril, [s * 0.035, 0.322, 0.812, 0, 0, 0, 0.018, 0.022, 0.01]));    // nostril
    P.push(part(T, new T.ConeGeometry(0.026, 0.19, 5), COL.tusk, [s * 0.1, 0.37, 0.72, 0.25, 0, -s * 0.55])); // tusk, curling up and out
    P.push(part(T, ball(T, 5, 4), COL.eye, [s * 0.12, 0.5, 0.6, 0, 0, 0, 0.024, 0.026, 0.022]));            // eye
    P.push(part(T, ball(T, 5, 4), COL.wart, [s * 0.15, 0.42, 0.61, 0, 0, 0, 0.04, 0.035, 0.05]));           // face wart
    P.push(part(T, new T.ConeGeometry(0.06, 0.13, 4), COL.ear, [s * 0.11, 0.62, 0.45, -0.5, 0, s * 0.6]));   // ear
  }
  // Bristly ridge: dark-rust spikes from the crown along the spine to the rump, tallest over the hump.
  for (let k = 0; k < 9; k++) {
    const u = k / 8, z = 0.48 - u * 0.78, y = 0.6 + 0.22 * Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.8) - 0.06 * u, h = 0.12 + 0.1 * Math.sin(u * Math.PI);
    P.push(part(T, new T.ConeGeometry(0.045, h, 4), k % 2 ? COL.ridgeDk : COL.ridge, [0, y + h * 0.3, z, -0.7, 0, 0]));
  }
  for (let k = 0; k < 4; k++) { // cheek whiskers of mane
    const s = k % 2 ? 1 : -1;
    P.push(part(T, new T.ConeGeometry(0.03, 0.12, 3), COL.ridgeDk, [s * 0.17, 0.5 - (k >> 1) * 0.05, 0.42, -1.1, 0, s * 0.9]));
  }
  P.push(part(T, new T.CylinderGeometry(0.012, 0.016, 0.2, 4), COL.hideLo, [0, 0.5, -0.53, -0.45, 0, 0]));    // tail
  P.push(part(T, new T.ConeGeometry(0.035, 0.08, 4), COL.tuft, [0, 0.41, -0.58, Math.PI - 0.45, 0, 0]));        // tail tuft
  return merge(T, P);
}

// One leg, pivot at the top: a tapered shank and a dark split hoof.
export function boarLegGeometry(T) {
  return merge(T, [
    part(T, new T.CylinderGeometry(0.07, 0.045, LEG_LEN - 0.05, 5), COL.hideLo, [0, -(LEG_LEN - 0.05) / 2, 0]),
    part(T, new T.CylinderGeometry(0.048, 0.055, 0.06, 5), COL.hoof, [0, -LEG_LEN + 0.03, 0.005]),
  ]);
}

export const boarMaterial = T => new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });
