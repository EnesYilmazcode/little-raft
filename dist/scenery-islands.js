// Distant scenery islands (the 12 drifters around the start). Seen at 65-90 m through fog, so the
// shapes are about silhouette and contrast: an irregular pale sand shelf with a foam rim at the
// waterline, grey rocks (one tall mound on most islands), a lumpy off-centre canopy and leaning palms.
// Everything uses five shared materials (sand, foam, rock/trunk, two leaf greens) so bakeGroup leaves
// about one draw per material per island, as before. Deterministic per seed; never touches game rand().
//
// buildSceneryIsland(T, group, seed, mat) adds meshes to `group` (local space, waterline ~ y .1);
// `mat(color)` is the game's cached material factory. Returns the sand radius.

export const ISLE_COLORS = Object.freeze({sand:'#d8c49a', foam:'#eef3ea', rock:'#8d8a80', leafDark:'#3f8a4e', leafLight:'#5fa456'});

function mulberry(a) {
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Hash of a (rounded) position, so the duplicated corners of non-indexed polyhedra move together.
function hash3(x, y, z, s) {
  const h = Math.sin(Math.round(x * 1000) * 12.9898 + Math.round(y * 1000) * 78.233 + Math.round(z * 1000) * 37.719 + s * 4.137) * 43758.5453;
  return h - Math.floor(h);
}
// Push every vertex out/in along its own direction by up to ±amp (lumpy rocks and bushes, no cracks).
function lumpy(geo, amp, s) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + amp * (hash3(x, y, z, s) * 2 - 1);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}
// Irregular outline: radial scale as a smooth function of angle (cap and side share it, so no seams).
function outline(rng, amp) {
  const w = [1, 2, 3].map(f => [f, rng() * 6.283, amp * (rng() * .6 + .4) / f]);
  return th => { let k = 1; for (const [f, ph, a] of w) k += Math.sin(th * f + ph) * a; return k; };
}
function shaped(geo, shape) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), k = shape(Math.atan2(z, x)); p.setX(i, x * k); p.setZ(i, z * k); }
  geo.computeVertexNormals();
  return geo;
}

function add(parent, geo, material, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) {
  const m = new T_.Mesh(geo, material); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.y = ry; parent.add(m); return m;
}
let T_ = null;

// Leaning palm: three trunk segments bending further each step, crown of seven drooping blades.
function palmTree(parent, rng, x, y, z, H, lean, yaw, M) {
  const root = new T_.Group(); root.position.set(x, y, z); root.rotation.y = yaw; parent.add(root);
  let node = root, r = .2;
  for (let s = 0; s < 3; s++) {
    const seg = new T_.Group(); seg.rotation.z = -lean * (s ? .55 : 1); node.add(seg);
    const h = H / 3; add(seg, new T_.CylinderGeometry(r * .82, r, h, 6, 1, true), M.rock, 0, h / 2, 0);
    const next = new T_.Group(); next.position.y = h; seg.add(next); node = next; r *= .82;
  }
  const L = 2.1 + rng() * .5;
  for (let i = 0; i < 7; i++) {
    const pivot = new T_.Group(); pivot.rotation.y = i * Math.PI * 2 / 7 + rng() * .4; node.add(pivot);
    const d = .25 + rng() * .45, f = new T_.Mesh(new T_.ConeGeometry(.38, L, 4), i % 2 ? M.leafDark : M.leafLight);
    f.scale.z = .3; f.rotation.z = -(Math.PI / 2 + d); f.position.set(Math.cos(d) * L / 2, -Math.sin(d) * L / 2 + .05, 0); pivot.add(f);
  }
}

export function buildSceneryIsland(T, g, seed, mat) {
  T_ = T;
  const rng = mulberry(seed * 7919 + 1013), C = ISLE_COLORS;
  const M = {sand:mat(C.sand), foam:mat(C.foam), rock:mat(C.rock), leafDark:mat(C.leafDark), leafLight:mat(C.leafLight)};
  const R = 5 + rng() * 2, shape = outline(rng, .15);
  // sand shelf (sloped beach) + white foam band where it meets the water
  add(g, shaped(new T.CylinderGeometry(R * .78, R, .75, 10, 1), shape), M.sand, 0, .22, 0);
  add(g, shaped(new T.CylinderGeometry(R * 1.03, R * 1.12, .3, 10, 1, true), shape), M.foam, 0, .1, 0);
  // rock mound for height on most islands, put to one side; a few boulders on the beach
  const side = rng() * 6.283, cx = Math.cos(side), cz = Math.sin(side);
  if (rng() < .8) {
    const h = 2.2 + rng() * 2;
    add(g, lumpy(new T.DodecahedronGeometry(1, 0), .22, seed), M.rock, cx * R * .32, h * .38, cz * R * .32, 1.6 + rng() * .8, h, 1.5 + rng() * .7, rng() * 6.283);
  }
  const nRocks = 2 + (rng() < .5 ? 1 : 0);
  for (let i = 0; i < nRocks; i++) {
    const a = side + (rng() - .5) * 2.4, d = R * (.55 + rng() * .3), s = .55 + rng() * .6;
    add(g, lumpy(new T.DodecahedronGeometry(1, 0), .25, seed * 31 + i), M.rock, Math.cos(a) * d, .4, Math.sin(a) * d, s * 1.3, s * .7, s, rng() * 6.283);
  }
  // canopy: lumpy squashed blobs clustered off-centre, leaning against the mound
  const nBush = 3 + (rng() < .5 ? 1 : 0);
  for (let i = 0; i < nBush; i++) {
    const a = side + Math.PI * .35 + (rng() - .5) * 2.6, d = R * (.08 + rng() * .32), s = 1.3 + rng() * .9;
    add(g, lumpy(new T.IcosahedronGeometry(1, i < 2 ? 1 : 0), .2, seed * 17 + i), i % 2 ? M.leafLight : M.leafDark,
      Math.cos(a) * d, .6 + s * .35, Math.sin(a) * d, s * 1.25, s * (.6 + rng() * .25), s * 1.1, rng() * 6.283);
  }
  // 2-3 palms, near the beach, leaning outward
  const nPalm = 2 + (rng() < .6 ? 1 : 0);
  for (let i = 0; i < nPalm; i++) {
    const a = side + Math.PI + (i - (nPalm - 1) / 2) * (.7 + rng() * .5), d = R * (.35 + rng() * .25);
    palmTree(g, rng, Math.cos(a) * d, .5, Math.sin(a) * d, 3.6 + rng() * 1.4, .16 + rng() * .2, -a, M);
  }
  return R;
}
