// Tufflet models (docs/specs/tufflet.md section 6): a small lavender seal-faced wool puff and its decor.
// Same kit as animals-models.js: every creature builder returns ONE merged, vertex-coloured BufferGeometry;
// decor builders return a Group holding one mesh. Origin at the feet, nose +z, up +y. Built once, never per frame.
import { part, merge, ball, hash, vertexMaterial } from './animals-models.js?build=v3-survival-ae77fa84ac2b';

const TUFT = {
  wool: 0xbfb6d6, woolSh: 0xa79fc4, cream: 0xf3ecdf, face: 0x8c7f98, snout: 0xb9a9b8, nose: 0x4a3a48, feet: 0x6b5a6e, eye: 0x22191a,
  kelp: 0x5f8f56, kelpLt: 0x79a86a, weave: 0xc99a62, weaveDk: 0x9a6a3c, drift: 0x9c8466, driftDk: 0x7d6a52,
};
export const FLUFF_CENTER = Object.freeze([0, 0.24, -0.02]);

const decorMesh = (T, geo) => { const m = new T.Mesh(geo, vertexMaterial(T)); m.castShadow = true; m.receiveShadow = true; return m; };
const group = (T, mesh, name) => { const g = new T.Group(); g.name = name; g.add(mesh); return g; };

// Tufflet body: the smooth seal-like face with a blunt snout, dark nose, big glinting eyes, two droopy fluffy ears,
// four stubby paddle feet under a small hidden core. The wool coat is a separate mesh (tuffletFluffGeometry).
export function tuffletBodyGeometry(T) {
  const { wool, woolSh, face, snout, nose, feet, eye } = TUFT;
  const P = [];
  P.push(part(T, ball(T, 6, 4), woolSh, [0, 0.18, -0.02, 0, 0, 0, 0.12, 0.12, 0.12])); // hidden core
  P.push(part(T, ball(T, 9, 7), face, [0, 0.24, 0.15, 0, 0, 0, 0.11, 0.1, 0.1])); // face
  P.push(part(T, ball(T, 6, 4), snout, [0, 0.212, 0.232, 0, 0, 0, 0.055, 0.04, 0.035])); // blunt snout
  P.push(part(T, ball(T, 4, 3), nose, [0, 0.228, 0.266, 0, 0, 0, 0.018, 0.013, 0.01])); // nose
  for (const s of [-1, 1]) {
    P.push(part(T, ball(T, 6, 4), eye, [s * 0.046, 0.266, 0.226, 0, 0, 0, 0.022, 0.026, 0.016])); // big eye
    P.push(part(T, ball(T, 4, 3), 0xffffff, [s * 0.051, 0.277, 0.24, 0, 0, 0, 0.008, 0.008, 0.006])); // glint
    P.push(part(T, ball(T, 5, 4), (f, x, y) => (y > 0.3 ? wool : woolSh), [s * 0.112, 0.25, 0.12, 0.2, 0, s * 0.6, 0.035, 0.065, 0.04])); // droopy ear
  }
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    P.push(part(T, ball(T, 5, 3), feet, [sx * 0.085, 0.02, sz * 0.08 + 0.01, 0, sx * 0.3, 0, 0.05, 0.02, 0.06])); // paddle foot
  }
  return merge(T, P);
}

// The wool coat: a fixed cloud of chunky puffs around FLUFF_CENTER, lavender with cream tips, face left clear.
const PUFFS = [
  [0, 0.355, -0.03, 0.1], [-0.11, 0.3, -0.01, 0.1], [0.11, 0.3, -0.01, 0.1], [-0.14, 0.2, -0.04, 0.09], [0.14, 0.2, -0.04, 0.09],
  [0, 0.24, -0.15, 0.12], [-0.08, 0.15, -0.12, 0.09], [0.08, 0.15, -0.12, 0.09], [-0.07, 0.35, 0.065, 0.075], [0.07, 0.35, 0.065, 0.075],
  [0, 0.13, -0.01, 0.1],
];
export function tuffletFluffGeometry(T) {
  const { wool, woolSh, cream } = TUFT;
  const P = [];
  PUFFS.forEach(([x, y, z, r], k) => {
    const jx = (hash(k, 1) - 0.5) * 0.02, jy = (hash(k, 2) - 0.5) * 0.02, jz = (hash(k, 3) - 0.5) * 0.02, rr = r * (0.94 + hash(k, 4) * 0.08);
    P.push(part(T, ball(T, 7, 5), (f, ux, uy) => (uy > 0.45 ? cream : uy < -0.35 || hash(f, k) < 0.15 ? woolSh : wool), [x + jx, y + jy, z + jz, hash(k, 5), hash(k, 6) * 3, 0, rr, rr * 0.92, rr]));
  });
  return merge(T, P);
}

// Tuft Nook: a low round woven basket (alternating weave bands) with a driftwood rim and a kelp-green pillow.
export function tuftNookModel(T) {
  const { weave, weaveDk, drift, driftDk, kelp, kelpLt } = TUFT;
  const R = 20, H = 4, wall = (f) => { const row = Math.floor(f / (2 * R)), seg = Math.floor((f % (2 * R)) / 2); return (row + seg) % 2 ? weave : weaveDk; };
  const P = [];
  P.push(part(T, new T.CylinderGeometry(0.48, 0.4, 0.22, R, H, true), wall, [0, 0.11, 0])); // outer wall
  P.push(part(T, new T.CylinderGeometry(0.46, 0.38, 0.22, R, H, true), wall, [0, 0.11, 0, 0, 0, 0, -1, 1, 1])); // inner wall (mirrored: faces in)
  P.push(part(T, new T.CylinderGeometry(0.4, 0.4, 0.04, R, 1), weaveDk, [0, 0.02, 0])); // floor
  P.push(part(T, new T.TorusGeometry(0.47, 0.04, 6, 24), f => (hash(f, 8) < 0.3 ? driftDk : drift), [0, 0.22, 0, Math.PI / 2, 0, 0])); // driftwood rim
  P.push(part(T, ball(T, 12, 8), (f, x, y) => (y > 0.4 ? kelpLt : kelp), [0, 0.12, 0, 0, 0, 0, 0.33, 0.08, 0.3])); // kelp pillow
  return group(T, decorMesh(T, merge(T, P)), 'decor_tuftnook');
}

// Tuft Rug: concentric wool rings in lavender and cream with a puffy edge of 12 small balls. 1.5 m round, flat.
export function tuftRugModel(T) {
  const { wool, woolSh, cream } = TUFT;
  const P = [];
  [[0.7, 0.018, wool], [0.54, 0.022, cream], [0.38, 0.026, woolSh], [0.2, 0.03, cream]].forEach(([r, h, c]) => {
    P.push(part(T, new T.CylinderGeometry(r, r, h, 20, 1), c, [0, h / 2, 0]));
  });
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2;
    P.push(part(T, ball(T, 5, 3), k % 2 ? cream : wool, [Math.cos(a) * 0.7, 0.014, Math.sin(a) * 0.7, 0, a, 0, 0.05, 0.016, 0.05]));
  }
  return group(T, decorMesh(T, merge(T, P)), 'decor_tuftrug');
}

// Cosy Blanket: a folded stack of three soft slabs in lavender/cream stripes with a little rolled pillow on top.
function softSlab(T) { // a unit sphere pushed toward a rounded box in x/z
  const geo = new T.SphereGeometry(1, 12, 6), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z), m = Math.max(Math.abs(x), Math.abs(z));
    if (m > 1e-6) { const k = 1 + 0.6 * (r / m - 1); p.setX(i, x * k); p.setZ(i, z * k); }
    p.setY(i, Math.sign(p.getY(i)) * Math.pow(Math.abs(p.getY(i)), 0.6));
  }
  return geo;
}
export function blanketModel(T) {
  const { wool, woolSh, cream } = TUFT;
  const P = [], stripe = (a, b) => (f, x) => (Math.floor((x + 1) * 3) % 2 ? a : b);
  P.push(part(T, softSlab(T), stripe(wool, cream), [0, 0.032, 0, 0, 0, 0, 0.36, 0.032, 0.26]));
  P.push(part(T, softSlab(T), stripe(cream, woolSh), [0.01, 0.094, -0.005, 0, 0.04, 0, 0.34, 0.03, 0.245]));
  P.push(part(T, softSlab(T), stripe(woolSh, cream), [-0.01, 0.152, 0.005, 0, -0.05, 0, 0.32, 0.028, 0.23]));
  P.push(part(T, new T.CylinderGeometry(0.042, 0.042, 0.34, 12, 1), cream, [0, 0.222, -0.06, 0, 0, Math.PI / 2])); // rolled pillow
  for (const s of [-1, 1]) P.push(part(T, ball(T, 6, 4), wool, [s * 0.17, 0.222, -0.06, 0, 0, 0, 0.02, 0.044, 0.044])); // pillow ends
  return group(T, decorMesh(T, merge(T, P)), 'decor_blanket');
}
