// Procedural building-piece models (ES module; THREE is passed in as T, never imported).
// Usage: import { createPieceGeometry, createPieceMaterial } from './building-models.js';
//        const geo = createPieceGeometry(T, 'wall'), mat = createPieceMaterial(T);
//        new T.InstancedMesh(geo, mat, n)   // one material for every piece type
// Each geometry is ONE merged non-indexed BufferGeometry (position/normal/uv/color), seeded so
// every call for a type returns identical vertices. Conventions (LEVEL_H = 2.2):
//  edge pieces (wall/halfwall/window/door): x in [-1,1], centred on z=0 (~0.14 thick), bottom y=0
//  floor: x,z in [-1,1], top y=0, bottom -0.12   pillar: centred at origin, 0.22 square, 2.2 tall
//  stairs: y=0 at z=-1 rising to 2.2 at z=+1     roof: y=0 at z=-1 (eave -1.1) rising to 1.0 at z=+1
import { createWoodMaterial } from './wood.js';

export const LEVEL_H = 2.2;
const PLANKS = ['#bb8a53', '#c69860', '#ad7c4a'];
const BEAM = '#5e4029', POST = '#6e4a2e', BATTEN = '#946640', ROPE = '#a8946c', NAIL = '#4b4844';
const STRAW = ['#c9a85a', '#b8954a', '#d4b46a'], LEAF = ['#6f8f3a', '#5c7a30', '#86a04a'];
const UNDER = [2.6, 1.05, 1.0]; // per-channel boost for downward faces (offsets the teal hemisphere ground light)
const WALL_T = 0.07, POST_X = 0.15, POST_Z = 0.145, EDGE_IN = 0.925;

function makeRng(key) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let a = (h >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Builder: collects non-indexed parts with a per-vertex colour, then merges them.
function kit(T, type) {
  const rng = makeRng('piece:' + type), parts = [];
  const m4 = new T.Matrix4(), eu = new T.Euler(), col = new T.Color();
  const pick = list => list[Math.floor(rng() * list.length)];
  const jit = s => (rng() - 0.5) * s;
  // Push any geometry, tinted with hex colour (optionally varied by +-vary).
  function add(g, hex, vary = 0.08, rot, pos) {
    const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose();
    if (rot) n.applyMatrix4(m4.makeRotationFromEuler(eu.set(rot[0], rot[1], rot[2], 'YXZ')));
    if (pos) n.translate(pos[0], pos[1], pos[2]);
    n.computeVertexNormals(); // flat faces: low-poly look
    col.set(hex).multiplyScalar(1 + jit(vary * 2));
    const c = new Float32Array(n.attributes.position.count * 3), ny = n.attributes.normal;
    for (let i = 0, v = 0; i < c.length; i += 3, v++) {
      // Downward faces only ever see the hemisphere's sea-teal ground light, which turns timber
      // ceilings green; warm them so floor/roof undersides read as shaded wood.
      const k = Math.max(0, -ny.getY(v));
      c[i] = col.r * (1 + k * (UNDER[0] - 1)); c[i + 1] = col.g * (1 + k * (UNDER[1] - 1)); c[i + 2] = col.b * (1 + k * (UNDER[2] - 1));
    }
    n.setAttribute('color', new T.BufferAttribute(c, 3));
    parts.push(n);
    return n;
  }
  // Box with grain running along its longest axis; uv in local space so equal boxes map equally.
  function box(sx, sy, sz, x, y, z, hex, rot, o = {}) {
    const g = new T.BoxGeometry(sx, sy, sz).toNonIndexed(), d = [sx, sy, sz];
    const L = d.indexOf(Math.max(sx, sy, sz)), p = g.attributes.position, nn = g.attributes.normal, uv = g.attributes.uv;
    const uo = o.fixed ? 0 : rng(), vo = o.fixed ? 0 : rng(), q = [0, 0, 0];
    for (let i = 0; i < p.count; i++) {
      q[0] = p.getX(i); q[1] = p.getY(i); q[2] = p.getZ(i);
      const nx = Math.abs(nn.getX(i)), ny = Math.abs(nn.getY(i)), N = nx > 0.5 ? 0 : ny > 0.5 ? 1 : 2;
      if (N !== L) { const a = 3 - N - L; uv.setXY(i, uo + q[a] / 0.34, vo + q[L] / 2.1); }
      else uv.setXY(i, uo + q[(L + 1) % 3] / 0.34, vo + q[(L + 2) % 3] / 0.34);
    }
    return add(g, hex, o.fixed ? 0 : (o.vary ?? 0.08), rot, [x, y, z]);
  }
  function merge() {
    let count = 0; for (const g of parts) count += g.attributes.position.count;
    const out = new T.BufferGeometry(), A = {position: 3, normal: 3, uv: 2, color: 3};
    for (const [name, k] of Object.entries(A)) {
      const arr = new Float32Array(count * k); let o = 0;
      for (const g of parts) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
      out.setAttribute(name, new T.BufferAttribute(arr, k));
    }
    parts.forEach(g => g.dispose());
    out.computeBoundingBox(); out.computeBoundingSphere();
    out.userData.type = type; out.userData.triangles = count / 3;
    return out;
  }
  return {rng, jit, pick, add, box, merge};
}

// Split [a,b] into n plank intervals with irregular widths and small gaps.
function columns(K, a, b, n) {
  const w = (b - a) / n, cuts = [a];
  for (let k = 1; k < n; k++) cuts.push(a + k * w + K.jit(w * 0.22));
  cuts.push(b);
  const out = [];
  for (let k = 0; k < n; k++) out.push([cuts[k] + (k ? 0.005 : 0), cuts[k + 1] - (k < n - 1 ? 0.005 : 0)]);
  return out;
}

// Nail head: facing +-z on walls, or facing up when up=true.
const nail = (K, x, y, z, up) => up ? K.box(0.022, 0.01, 0.022, x, y, z, NAIL, [0, K.rng(), 0], {vary: 0.02})
  : K.box(0.022, 0.022, 0.012, x, y, z, NAIL, [0, 0, K.rng()], {vary: 0.02});

// Plank wall shared by wall/halfwall/window/door. hole = {x0,x1,y0,y1} cut out of the planks/rails.
function plankWall(K, H, cols, hole, rails) {
  // End posts sit on the edge's end points; fixed (unjittered) so neighbouring edges coincide exactly,
  // and slightly non-square so a perpendicular edge's post never shares a face (no z-fighting).
  for (const s of [-1, 1]) K.box(POST_X, H - 0.01, POST_Z, s, (H - 0.01) / 2, 0, POST, null, {fixed: true});
  cols.forEach(([a, b], k) => {
    // Planks overlap their neighbours a little, alternately stepped in/out, so no daylight shows between them.
    const xc = (a + b) / 2, w = b - a + 0.014, hex = K.pick(PLANKS), zc = (k % 2 ? 0.006 : -0.006), tilt = K.jit(0.01);
    const inHole = hole && xc > hole.x0 && xc < hole.x1;
    const spans = inHole ? [[0, hole.y0], [hole.y1, H]].filter(([s, e]) => e - s > 0.02) : [[0, H]];
    for (const [s, e0] of spans) {
      const e = e0 === H ? H - K.rng() * 0.035 : e0;
      K.box(w, e - s, WALL_T, xc, (s + e) / 2, zc, hex, [0, 0, tilt]);
    }
  });
  for (const y of rails) {
    const blocked = hole && y > hole.y0 - 0.06 && y < hole.y1 + 0.06;
    const segs = blocked ? [[-EDGE_IN, hole.x0 - 0.07], [hole.x1 + 0.07, EDGE_IN]] : [[-EDGE_IN, EDGE_IN]];
    for (const side of [-1, 1]) for (const [a, b] of segs) {
      K.box(b - a, 0.11, 0.035, (a + b) / 2, y + K.jit(0.02), side * (WALL_T / 2 + 0.0175), BATTEN, [0, 0, K.jit(0.02)]);
      for (const [c0, c1] of cols) { const xc = (c0 + c1) / 2; if (xc > a && xc < b) nail(K, xc, y + 0.02, side * (WALL_T / 2 + 0.035)); }
    }
  }
}

function buildWall(K) { plankWall(K, LEVEL_H, columns(K, -EDGE_IN, EDGE_IN, 8), null, [0.35, 1.85]); }

function buildHalfwall(K) {
  const H = 1.1;
  for (const s of [-1, 1]) K.box(POST_X, H + 0.02, POST_Z, s, (H + 0.02) / 2, 0, POST, null, {fixed: true});
  columns(K, -EDGE_IN, EDGE_IN, 8).forEach(([a, b], k) => {
    const top = 1.0 - K.rng() * 0.02;
    K.box(b - a + 0.014, top, WALL_T, (a + b) / 2, top / 2, k % 2 ? 0.006 : -0.006, K.pick(PLANKS), [0, 0, K.jit(0.012)]);
  });
  for (const side of [-1, 1]) K.box(2 * EDGE_IN, 0.1, 0.035, 0, 0.32, side * (WALL_T / 2 + 0.0175), BATTEN, [0, 0, K.jit(0.02)]);
  K.box(2 * EDGE_IN, 0.06, 0.18, 0, 1.03, 0, '#a77846', [0, 0, K.jit(0.006)]); // cap rail
  K.box(2 * EDGE_IN - 0.04, 0.03, 0.12, 0, 1.075, 0, PLANKS[1], null, {vary: 0.04});
  for (const x of [-0.6, 0, 0.6]) for (const s of [-1, 1]) nail(K, x + K.jit(0.1), 1.03, s * 0.096);
}

function buildWindow(K) {
  const o = {x0: -0.45, x1: 0.45, y0: 0.9, y1: 1.7}, F = 0.06;
  const cols = [...columns(K, -EDGE_IN, -0.48, 2), ...columns(K, -0.48, 0.48, 4), ...columns(K, 0.48, EDGE_IN, 2)];
  plankWall(K, LEVEL_H, cols, {x0: o.x0, x1: o.x1, y0: o.y0 - F / 2, y1: o.y1 + F / 2}, [0.35, 1.85]);
  K.box(1.06, F, 0.22, 0, o.y0 - F / 2, 0.01, BEAM, [0, 0, K.jit(0.01)]);       // sill
  K.box(1.02, F, 0.17, 0, o.y1 + F / 2, 0, BEAM, [0, 0, K.jit(0.01)]);          // head
  for (const s of [-1, 1]) K.box(F, o.y1 - o.y0, 0.17, s * (0.45 + F / 2), (o.y0 + o.y1) / 2, 0, BEAM);
  K.box(0.04, o.y1 - o.y0, 0.05, 0, (o.y0 + o.y1) / 2, 0, POST);               // cross mullion
  K.box(0.9, 0.04, 0.05, 0, 1.3, 0, POST);
  K.add(ring(0.034, 0.008), ROPE, 0.04, null, [0, 1.3, 0]); // rope tie at the cross
}

function buildDoor(K) {
  const W = 0.5, OH = 1.95, J = 0.07;
  const cols = [...columns(K, -EDGE_IN, -W - J, 2), ...columns(K, -W, W, 4), ...columns(K, W + J, EDGE_IN, 2)];
  plankWall(K, LEVEL_H, cols, {x0: -W, x1: W, y0: -1, y1: OH + 0.12}, [0.35, 1.85]);
  for (const s of [-1, 1]) K.box(J, OH + 0.12, 0.18, s * (W + J / 2), (OH + 0.12) / 2, 0, BEAM, [0, 0, s * 0.004]);
  K.box(2 * (W + J) + 0.08, 0.12, 0.19, 0, OH + 0.06, 0, BEAM, [0, 0, K.jit(0.01)]); // lintel
  for (const s of [-1, 1]) nail(K, s * 0.42, OH + 0.06, 0.1);
  // Open leaf: built closed along -x from its hinge, then swung ~122 degrees onto the +z side.
  const hinge = [W - 0.03, 0, 0.1], rot = 122 * Math.PI / 180, LW = 0.92, LH = 1.9, c = Math.cos(rot), s = Math.sin(rot);
  const place = (sx, sy, sz, lx, ly, lz, hex, extra = 0) =>
    K.box(sx, sy, sz, hinge[0] + lx * c + lz * s, hinge[1] + ly, hinge[2] - lx * s + lz * c, hex, [0, rot, extra]);
  for (const [a, b] of columns(K, -LW, 0, 4)) place(b - a, LH - K.rng() * 0.02, 0.04, (a + b) / 2, 0.03 + LH / 2, 0.02, K.pick(PLANKS));
  for (const y of [0.35, 1.6]) place(LW - 0.08, 0.1, 0.03, -LW / 2, y, 0.055, BATTEN);
  place(0.06, 1.37, 0.028, -LW / 2, 0.975, 0.055, BATTEN, -Math.atan2(LW - 0.2, 1.25)); // Z brace
  place(0.03, 0.12, 0.05, -LW + 0.1, 1.0, 0.09, BEAM);                                  // handle
}

function buildPillar(K, T) {
  const H = LEVEL_H, R = 0.11 * Math.SQRT2;
  const g = new T.CylinderGeometry(R * 0.96, R, H, 4, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), f = 1 + (Math.abs(y) < H / 2 - 0.01 ? K.jit(0.08) : 0);
    p.setXYZ(i, p.getX(i) * f, y + H / 2, p.getZ(i) * f);
  }
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.6, uv.getY(i) * 1.05);
  K.add(g, POST, 0.03, [0, Math.PI / 4, 0]);
  K.box(0.26, 0.035, 0.26, 0, H - 0.0175, 0, BEAM, [0, K.jit(0.1), 0]); // cap block
  for (let w = 0; w < 3; w++) K.add(ring(0.172, 0.011), ROPE, 0.05, [Math.PI / 2 + K.jit(0.06), K.jit(0.06), Math.PI / 4], [0, 1.88 + w * 0.026, 0]);
  K.add(new T.IcosahedronGeometry(0.02, 0), ROPE, 0.03, null, [0.125, 1.91, 0.02]);
}

function buildFloor(K, T) {
  const top = 0, TH = 0.045;
  columns(K, -1, 1, 8).forEach(([a, b], k) => {
    // Inner plank edges overlap their neighbour (alternately stepped 4 mm) so no light shows through the
    // ceiling below; the outer edges stay inside the cell.
    const a1 = a <= -1 ? a + 0.003 : a - 0.006, b1 = b >= 1 ? b - 0.003 : b + 0.006, xc = (a1 + b1) / 2;
    const t = top - (k % 2 ? 0.004 : 0) - K.rng() * 0.003;
    K.box(b1 - a1, TH, 1.994 - K.rng() * 0.01, xc, t - TH / 2, K.jit(0.004), K.pick(PLANKS), [0, K.jit(0.004), K.jit(0.008)]);
    for (const z of [-0.72, 0.72]) nail(K, xc + K.jit(0.06), t + 0.002, z + K.jit(0.04), true);
  });
  for (const z of [-0.72, 0.72]) {
    const g = new T.CylinderGeometry(0.042, 0.045, 1.98, 7, 1);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.5, uv.getY(i));
    K.add(g, BEAM, 0.05, [0, K.jit(0.02), Math.PI / 2], [0, -0.075, z]);
    for (const x of [-0.82, 0.82]) for (let w = 0; w < 2; w++)
      K.add(ring(0.052, 0.007, 8), ROPE, 0.05, [0, Math.PI / 2, K.jit(0.1)], [x + (w - 0.5) * 0.02, -0.072, z]);
  }
}

function buildStairs(K, T) {
  const rise = LEVEL_H / 8;
  for (const sx of [-1, 1]) {
    const sh = new T.Shape([new T.Vector2(-1, 0), new T.Vector2(1, LEVEL_H), new T.Vector2(1, LEVEL_H - 0.3), new T.Vector2(-1 + 0.3 / 1.1, 0)]);
    const g = new T.ExtrudeGeometry(sh, {depth: 0.07, bevelEnabled: false, curveSegments: 1});
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 2.2, uv.getX(i) * 0.45);
    K.add(g, BEAM, 0.04, [0, -Math.PI / 2, 0], [sx * 0.95 + (sx < 0 ? 0.07 : 0), 0, 0]);
  }
  for (let k = 1; k <= 7; k++) {
    const y = k * rise, z = -1 + y / 1.1;
    K.box(1.77, 0.05, 0.3, 0, y - 0.025, z - 0.02, K.pick(PLANKS), [K.jit(0.01), K.jit(0.015), K.jit(0.012)]);
    for (const s of [-1, 1]) K.box(0.022, 0.012, 0.022, s * 0.85, y + 0.002, z - 0.02, NAIL, null, {vary: 0.02});
  }
}

function buildRoof(K, T) {
  const A = Math.atan2(1, 2), cA = Math.cos(A), sA = Math.sin(A), Z0 = -1.1, Z1 = 1.0;
  const line = z => 0.5 * (z + 1), L = (Z1 - Z0) / cA;
  // Point at slope distance s from the eave, offset h along the roof normal.
  const at = (s, h) => [Z0 + s * cA - h * sA, line(Z0) + s * sA + h * cA];
  for (const x of [-0.9, 0, 0.9]) { const [z, y] = at(L / 2, -0.085); K.box(0.08, 0.09, L - 0.05, x, y, z, BEAM, [-A, 0, 0]); }
  for (const [a, b] of columns(K, -1, 1, 7)) { const [z, y] = at(L / 2, -0.02); K.box(b - a, 0.04, L, (a + b) / 2, y, z, K.pick(PLANKS), [-A, 0, K.jit(0.02)]); }
  // Thatch: overlapping full-width courses, alternating leaf / straw, ragged lower edges lifted so each
  // course casts a line. Colour drifts along x (per vertex) between shades for a hand-laid look.
  const C = 6, CL = (L + 0.4) / C, step = (L - CL) / (C - 1); // ~8 cm overlap per course
  const ca = new T.Color(), cb = new T.Color();
  for (let c = 0; c < C; c++) {
    const fam = c % 2 ? STRAW : LEAF, other = c % 2 ? LEAF : STRAW, ph = K.rng() * 9, ph2 = K.rng() * 9;
    const [z, y] = at(c * step + CL / 2, 0.035);
    const g = new T.BoxGeometry(2, 0.055, CL, 14, 1, 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getZ(i) > 0) continue;
      const wx = p.getX(i); // ragged tufts as a function of x so shared corners stay welded
      p.setZ(i, p.getZ(i) - 0.02 * (1 + Math.sin(wx * 29 + ph) * Math.sin(wx * 9.3 + ph2)));
      p.setY(i, p.getY(i) + 0.03);
    }
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 0.5);
    const n = K.add(g, '#ffffff', 0, [-A - 0.045, 0, 0], [0, y, z]), cl = n.attributes.color, q = n.attributes.position;
    ca.set(K.pick(fam)); cb.set(K.rng() < 0.5 ? K.pick(fam) : K.pick(other));
    for (let i = 0; i < q.count; i++) {
      const x = q.getX(i), t = Math.max(0, Math.min(1, 0.5 + 0.9 * Math.sin(x * 2.3 + ph) * Math.sin(x * 5.1 + ph2)));
      const f = 0.94 + 0.12 * (0.5 + 0.5 * Math.sin(x * 13 + ph2));
      cl.setXYZ(i, (ca.r + (cb.r - ca.r) * t) * f, (ca.g + (cb.g - ca.g) * t) * f, (ca.b + (cb.b - ca.b) * t) * f);
    }
  }
  const g = new T.CylinderGeometry(0.06, 0.065, 2.0, 7, 1); // ridge log
  K.add(g, LEAF[1], 0.04, [0, 0, Math.PI / 2], [0, 1.03, 0.96]);
  for (const x of [-0.7, 0, 0.7]) K.add(ring(0.075, 0.009, 8), ROPE, 0.05, [0, Math.PI / 2, 0], [x, 1.03, 0.96]);
}

let ring; // rope ring factory, bound to T per build
const BUILDERS = {wall: buildWall, halfwall: buildHalfwall, window: buildWindow, door: buildDoor,
  pillar: buildPillar, floor: buildFloor, stairs: buildStairs, roof: buildRoof};
export const PIECE_TYPES = Object.freeze(Object.keys(BUILDERS));

export function createPieceGeometry(T, type) {
  const build = BUILDERS[type];
  if (!build) throw new Error('unknown building piece: ' + type);
  const K = kit(T, type);
  ring = (R, tube, seg = 4) => new T.TorusGeometry(R, tube, 4, seg); // 4 segments = square ring hugging a post
  build(K, T);
  return K.merge();
}

export function createPieceMaterial(T) {
  const m = createWoodMaterial(T, '#ffffff');
  for (const t of [m.map, m.bumpMap]) if (t) t.wrapS = t.wrapT = T.RepeatWrapping;
  m.vertexColors = true; m.color.set('#ffffff'); m.name = 'building-pieces';
  return m;
}

const BOUNDS = {
  wall: [-1.075, 0, -0.1, 1.075, 2.2, 0.1], halfwall: [-1.075, 0, -0.1, 1.075, 1.12, 0.1],
  window: [-1.075, 0, -0.12, 1.075, 2.2, 0.12], door: [-1.075, 0, -0.1, 1.075, 2.2, 0.9],
  pillar: [-0.145, 0, -0.145, 0.145, 2.2, 0.145], floor: [-1, -0.13, -1, 1, 0.008, 1],
  stairs: [-0.95, 0, -1, 0.95, 2.2, 1], roof: [-1.0, -0.16, -1.18, 1.0, 1.12, 1.05],
};
export function pieceBounds(type) {
  const b = BOUNDS[type]; return b ? {minX: b[0], minY: b[1], minZ: b[2], maxX: b[3], maxY: b[4], maxZ: b[5]} : null;
}
