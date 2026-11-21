// Raft craft models (ES module, no imports, no textures).
// Usage: import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b'; const g = createCraft(THREE, 'sail');
// Returns a THREE.Group (or null for an unknown type). Local origin = centre of the 2x2 raft
// floor top surface; place the group at the floor (y = .22). Everything builds upward from y = 0
// inside a ~1.7 x 1.7 footprint. Every call creates its own geometries and materials, so the
// caller may dispose them freely. Meshes are merged per material to keep draw calls low.
//
// Types: sail (~3.76 tall), palm (~2.25), lantern (~1.2), net (~0.21), bench (~0.9), crate (~0.84).

export function createCraft(T, type) {
  const key = String(type || '').toLowerCase();
  const builders = { sail: buildSail, palm: buildPalm, lantern: buildLantern, net: buildNet, bench: buildBench, crate: buildCrate };
  const build = builders[key];
  if (!build) return null;
  const K = makeKit(T);
  const g = new T.Group();
  g.name = 'craft_' + key;
  build(T, K, g);
  g.traverse(o => {
    if (!o.isMesh) return;
    const glass = !!o.userData.glass;
    o.castShadow = !glass;
    o.receiveShadow = !glass;
  });
  g.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(g);
  const size = box.getSize(new T.Vector3());
  g.userData.craftType = key;
  g.userData.size = { x: size.x, y: size.y, z: size.z };
  g.userData.height = box.max.y;
  return g;
}

// ---------------------------------------------------------------- shared kit (per instance)
function makeKit(T) {
  let seed = 0x2f6e2b1;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  const UP = V(0, 1, 0);
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _s = new T.Vector3(), _p = new T.Vector3();
  const sg = d => Math.max(2, Math.min(16, Math.round(d / 0.06)));

  const bake = (geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    return geo.applyMatrix4(_m);
  };
  // geometry built along +Y and centred at origin -> spans a..b
  const along = (geo, a, b) => {
    const d = new T.Vector3().subVectors(b, a);
    const len = d.length() || 1;
    _q.setFromUnitVectors(UP, d.divideScalar(len));
    _m.compose(new T.Vector3().addVectors(a, b).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
    return geo.applyMatrix4(_m);
  };
  const paint = (geo, fn) => {
    const p = geo.attributes.position;
    const arr = new Float32Array(p.count * 3);
    const c = new T.Color();
    for (let i = 0; i < p.count; i++) {
      c.setRGB(1, 1, 1);
      fn(p.getX(i), p.getY(i), p.getZ(i), c, i);
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new T.BufferAttribute(arr, 3));
    return geo;
  };
  // worn timber: grain streaks along the long axis, knots, sun-greyed patches
  const woodify = (geo, hex, weather = 0.3) => {
    geo.computeBoundingBox();
    const sz = geo.boundingBox.getSize(new T.Vector3());
    const ax = sz.x >= sz.y && sz.x >= sz.z ? 0 : (sz.y >= sz.z ? 1 : 2);
    const base = new T.Color(hex).multiplyScalar(0.9 + rnd() * 0.2);
    const dark = new T.Color(hex).multiplyScalar(0.56);
    const grey = new T.Color(0x9b9486);
    const ph = rnd() * 50, wk = weather * (0.6 + rnd() * 0.8);
    return paint(geo, (x, y, z, c) => {
      const L = ax === 0 ? x : ax === 1 ? y : z;
      const A = ax === 0 ? y * 0.7 + z : ax === 1 ? x + z * 0.7 : x + y * 0.7;
      const grain = 0.5 + 0.5 * Math.sin(A * 70 + Math.sin(L * 5 + ph) * 2.2 + ph);
      const knot = Math.pow(Math.max(0, Math.sin(L * 6.1 + ph * 1.3) * Math.sin(A * 20 + ph)), 6);
      const wx = 0.5 + 0.5 * Math.sin(L * 2.3 + ph * 0.7 + A * 3);
      c.copy(base).lerp(dark, grain * 0.32 + knot * 0.5).lerp(grey, wk * wx * 0.5);
    });
  };
  const plank = (w, h, d, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, weather) =>
    bake(woodify(new T.BoxGeometry(w, h, d, sg(w), sg(h), sg(d)), hex, weather), x, y, z, rx, ry, rz);
  const beam = (a, b, w, d, hex, weather) => {
    const len = a.distanceTo(b);
    return along(woodify(new T.BoxGeometry(w, len, d, 2, sg(len), 2), hex, weather), a, b);
  };
  const rod = (a, b, r1, r2 = r1, radial = 8, hex = null) => {
    const len = a.distanceTo(b);
    const geo = new T.CylinderGeometry(r2, r1, len, radial, hex ? sg(len) : 1);
    if (hex) woodify(geo, hex);
    return along(geo, a, b);
  };
  const tube = (pts, r, segs = 24, radial = 6) => {
    const curve = pts.length === 2 ? new T.LineCurve3(pts[0], pts[1]) : new T.CatmullRomCurve3(pts);
    return new T.TubeGeometry(curve, pts.length === 2 ? 1 : segs, r, radial, false);
  };
  const helix = (c, axis, r, len, turns, tr) => {
    const n = Math.ceil(turns * 12);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = t * turns * Math.PI * 2, h = (t - 0.5) * len;
      const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
      pts.push(axis === 'y' ? V(c.x + ca, c.y + h, c.z + sa)
        : axis === 'x' ? V(c.x + h, c.y + ca, c.z + sa) : V(c.x + ca, c.y + sa, c.z + h));
    }
    return new T.TubeGeometry(new T.CatmullRomCurve3(pts), n * 3, tr, 5, false);
  };
  const torus = (r, tr, x, y, z, rx = 0, ry = 0, rz = 0, arc = Math.PI * 2) =>
    bake(new T.TorusGeometry(r, tr, 6, 18, arc), x, y, z, rx, ry, rz);
  const nail = (x, y, z, axis = 'y') =>
    bake(new T.CylinderGeometry(0.012, 0.012, 0.01, 6), x, y, z, axis === 'z' ? Math.PI / 2 : 0, 0, axis === 'x' ? Math.PI / 2 : 0);
  const box = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => bake(new T.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);

  const merge = list => {
    const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
    const names = ['position', 'normal', 'uv', 'color'].filter(n => parts.every(p => p.attributes[n]));
    const out = new T.BufferGeometry();
    for (const n of names) {
      const size = parts[0].attributes[n].itemSize;
      let total = 0;
      for (const p of parts) total += p.attributes[n].count * size;
      const arr = new Float32Array(total);
      let off = 0;
      for (const p of parts) {
        const a = p.attributes[n];
        arr.set(a.array.subarray(0, a.count * size), off);
        off += a.count * size;
      }
      out.setAttribute(n, new T.BufferAttribute(arr, size));
    }
    const seen = new Set();
    for (const g of list.concat(parts)) if (!seen.has(g)) { seen.add(g); g.dispose(); }
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  };
  const std = (hex, rough = 0.8, metal = 0, extra = {}) =>
    new T.MeshStandardMaterial(Object.assign({ color: hex, roughness: rough, metalness: metal }, extra));
  const woodMat = () => std(0xffffff, 0.88, 0, { vertexColors: true });
  const addTo = (parent, geos, mat, name, glass = false) => {
    const list = Array.isArray(geos) ? geos : [geos];
    if (!list.length) { mat.dispose(); return null; }
    const m = new T.Mesh(merge(list), mat);
    m.name = name;
    if (glass) m.userData.glass = true;
    parent.add(m);
    return m;
  };

  return { rnd, V, UP, bake, along, paint, woodify, plank, beam, rod, tube, helix, torus, nail, box, merge, std, woodMat, addTo };
}

// ---------------------------------------------------------------- SAIL (~1.64 x 1.3, 3.76 tall)
function buildSail(T, K, g) {
  const { V } = K;
  const W = [], R = [], RD = [], ST = [], SEAM = [], TH = [];

  // footing: two crossed timbers, mast step block, four braces
  W.push(K.plank(1.5, 0.08, 0.2, 0x86613d, 0, 0.04, 0));
  W.push(K.plank(0.2, 0.08, 1.5, 0x97744c, 0, 0.12, 0));
  W.push(K.plank(0.3, 0.12, 0.3, 0x6f4f31, 0, 0.22, 0));
  const MB = 0.28, MT = 3.56, MR0 = 0.07, MR1 = 0.05;
  const mastR = y => MR0 + (MR1 - MR0) * (y - MB) / (MT - MB);
  for (const [fx, fy, fz] of [[0.6, 0.1, 0], [-0.6, 0.1, 0], [0, 0.18, 0.6], [0, 0.18, -0.6]]) {
    const d = Math.hypot(fx, fz);
    W.push(K.beam(V(fx, fy, fz), V(fx / d * 0.07, 0.78, fz / d * 0.07), 0.06, 0.05, 0x7d5a38));
  }
  // mast + truck cap
  W.push(K.bake(K.woodify(new T.CylinderGeometry(MR1, MR0, MT - MB, 12, 16), 0x8a6642, 0.35), 0, (MB + MT) / 2, 0));
  W.push(K.bake(K.woodify(new T.CylinderGeometry(0.058, 0.062, 0.06, 12), 0x6a4b2f), 0, MT + 0.02, 0));

  // yard (top) and boom (bottom) spars, tapered toward the ends
  const CZ = 0.115, YARD_Y = 3.2, BOOM_Y = 1.05;
  const spar = (len, r, y, hex) => {
    const geo = new T.CylinderGeometry(r, r, len, 10, 12);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getY(i) / (len / 2), k = 1 - 0.38 * u * u;
      p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
    }
    geo.computeVertexNormals();
    K.woodify(geo, hex);
    return K.bake(geo, 0, y, CZ, 0, 0, Math.PI / 2);
  };
  W.push(spar(1.64, 0.045, YARD_Y, 0x8d6a43));
  W.push(spar(1.56, 0.047, BOOM_Y, 0x80603d));
  for (const [len, y] of [[1.64, YARD_Y], [1.56, BOOM_Y]]) {
    for (const s of [-1, 1]) ST.push(K.bake(new T.CylinderGeometry(0.031, 0.031, 0.03, 10), s * (len / 2 - 0.015), y, CZ, 0, 0, Math.PI / 2));
  }

  // bowed canvas: subdivided plane, z pushed out as if filled with wind (+Z)
  const SW = 1.44, Y0 = 1.085, Y1 = 3.175, SH = Y1 - Y0, BOW = 0.3, YM = (Y0 + Y1) / 2;
  const bow = (x, y) => {
    const u = x / (SW / 2), v = Math.min(1, Math.max(0, (y - Y0) / SH));
    const sv = Math.sin(Math.PI * v);
    return BOW * (1 - 0.55 * u * u) * Math.pow(sv, 0.8) + 0.01 * Math.sin(u * 8 + v * 6) * sv;
  };
  const conform = (geo, dz) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, CZ + bow(p.getX(i), p.getY(i)) + dz);
    geo.computeVertexNormals();
    return geo;
  };
  const cloth = conform(K.bake(new T.PlaneGeometry(SW, SH, 20, 26), 0, YM, 0), 0);
  const cream = new T.Color(0xece2c8), stain = new T.Color(0xb7a47f);
  K.paint(cloth, (x, y, z, c) => {
    const u = x / (SW / 2), v = (y - Y0) / SH;
    const k = 0.32 * Math.pow(1 - v, 3) + 0.12 * Math.pow(Math.abs(u), 6) + 0.07 * (0.5 + 0.5 * Math.sin(x * 13 + y * 7) * Math.sin(y * 5 - x * 3));
    c.copy(cream).lerp(stain, k);
  });
  K.addTo(g, cloth, K.std(0xffffff, 0.92, 0, { vertexColors: true, side: T.DoubleSide }), 'sailCloth');

  // panel seams (front + back) and top/bottom hems
  const seams = [-0.36, 0, 0.36];
  for (const sx of seams) for (const dz of [0.005, -0.005]) SEAM.push(conform(K.bake(new T.PlaneGeometry(0.04, SH - 0.02, 1, 26), sx, YM, 0), dz));
  for (const hy of [Y1 - 0.055, Y0 + 0.055]) for (const dz of [0.007, -0.007]) SEAM.push(conform(K.bake(new T.PlaneGeometry(SW, 0.08, 20, 1), 0, hy, 0), dz));
  K.addTo(g, SEAM, K.std(0xd2c29d, 0.95, 0, { side: T.DoubleSide }), 'sailSeams');

  // repair patch, lower right
  const PX = 0.55, PY = 1.62;
  K.addTo(g, conform(K.bake(new T.PlaneGeometry(0.26, 0.24, 4, 4), PX, PY, 0), 0.0035), K.std(0xc5ad84, 0.95, 0, { side: T.DoubleSide }), 'sailPatch');

  // stitches (modest count)
  const stitch = (x, y, rz, len = 0.05) => TH.push(K.bake(new T.BoxGeometry(len, 0.008, 0.004), x, y, CZ + bow(x, y) + 0.009, 0, 0, rz));
  for (const sx of seams) for (let y = Y0 + 0.17; y < Y1 - 0.14; y += 0.14) stitch(sx, y, 0.6);
  for (let i = 0; i < 4; i++) {
    const t = -0.09 + i * 0.06;
    stitch(PX + t, PY + 0.12, Math.PI / 2, 0.03); stitch(PX + t, PY - 0.12, Math.PI / 2, 0.03);
    stitch(PX - 0.13, PY + t, 0, 0.03); stitch(PX + 0.13, PY + t, 0, 0.03);
  }
  K.addTo(g, TH, K.std(0x6f5f45, 1), 'sailStitches');

  // bolt ropes along the side edges of the sail
  for (const sx of [-SW / 2, SW / 2]) {
    const pts = [];
    for (let k = 0; k <= 12; k++) { const y = Y0 + SH * k / 12; pts.push(V(sx, y, CZ + bow(sx, y))); }
    R.push(K.tube(pts, 0.011, 48, 6));
  }
  // lashing loops tying the cloth to yard and boom
  for (const x of [-0.62, -0.42, -0.2, 0.2, 0.42, 0.62]) {
    RD.push(K.torus(0.054, 0.0075, x, YARD_Y, CZ, 0, Math.PI / 2, 0));
    RD.push(K.torus(0.056, 0.0075, x, BOOM_Y, CZ, 0, Math.PI / 2, 0));
  }
  // lashings at mast/spar crossings and brace tops
  for (const y of [YARD_Y, BOOM_Y]) {
    RD.push(K.helix(V(0, y, 0), 'y', mastR(y) + 0.008, 0.16, 5, 0.008));
    RD.push(K.helix(V(0, y, CZ), 'x', 0.054, 0.15, 4, 0.008));
  }
  RD.push(K.helix(V(0, 0.76, 0), 'y', mastR(0.76) + 0.012, 0.1, 4, 0.009));

  // standing rigging: three stays to steel eye rings on the footing
  ST.push(K.bake(new T.CylinderGeometry(mastR(3.42) + 0.007, mastR(3.42) + 0.007, 0.05, 12), 0, 3.42, 0));
  ST.push(K.bake(new T.CylinderGeometry(mastR(0.34) + 0.006, mastR(0.34) + 0.006, 0.04, 12), 0, 0.34, 0));
  R.push(K.tube([V(0, 3.42, -0.05), V(0, 0.205, -0.64)], 0.01));
  ST.push(K.torus(0.025, 0.007, 0, 0.183, -0.64, 0, Math.PI / 2, 0));
  for (const s of [-1, 1]) {
    R.push(K.tube([V(s * 0.05, 3.42, 0), V(s * 0.64, 0.125, 0)], 0.01));
    ST.push(K.torus(0.025, 0.007, s * 0.64, 0.103, 0));
    // sheet line: boom end down to the same eye, with a little slack
    R.push(K.tube([V(s * 0.74, BOOM_Y, CZ), V(s * 0.79, 0.7, 0.12), V(s * 0.72, 0.35, 0.06), V(s * 0.65, 0.13, 0.01)], 0.009, 30));
    RD.push(K.helix(V(s * 0.72, BOOM_Y, CZ), 'x', 0.042, 0.05, 3, 0.007));
  }
  // halyard: from yard over a sheave at the masthead, down to a cleat
  R.push(K.tube([V(0.03, YARD_Y + 0.05, CZ + 0.02), V(0.06, 3.4, 0.07), V(0.065, 3.5, 0.03), V(0.07, 3.46, -0.03),
    V(0.075, 3.2, -0.04), V(0.075, 1.5, -0.035), V(0.08, 1.42, -0.03)], 0.009, 70));
  ST.push(K.bake(new T.CylinderGeometry(0.035, 0.035, 0.025, 12), 0.06, 3.49, 0, Math.PI / 2, 0, 0));
  ST.push(K.box(0.025, 0.13, 0.03, 0.078, 1.42, -0.03));
  R.push(K.torus(0.06, 0.01, 0.1, 1.33, -0.05, 0, Math.PI / 2 - 0.4, 0));
  // coiled spare rope on the floor
  [[0.1, 0.012], [0.085, 0.034], [0.068, 0.054]].forEach(([r, y]) => R.push(K.torus(r, 0.012, -0.42, y, -0.42, Math.PI / 2, 0, 0)));
  // nails on the step block and footing
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ST.push(K.nail(sx * 0.11, 0.282, sz * 0.11));
    ST.push(K.nail(sx * 0.05, 0.162, sz * 0.27));
  }
  // pennant pole + triangular pennant rippling in the wind
  ST.push(K.rod(V(0, MT + 0.04, 0), V(0, 3.76, 0), 0.009, 0.007, 6));
  {
    const N = 12, L = 0.4, fy = 3.68, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N, x = 0.01 + s * L, half = (1 - s) * 0.06 + 0.002, cy = fy - s * 0.025, z = 0.04 * Math.sin(s * 5.5 + 0.3) * s;
      pos.push(x, cy + half, z, x, cy - half, z);
    }
    for (let i = 0; i < N; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const flag = new T.BufferGeometry();
    flag.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    flag.setIndex(idx);
    flag.computeVertexNormals();
    K.addTo(g, flag, K.std(0xc2432e, 0.8, 0, { side: T.DoubleSide }), 'pennant');
  }

  K.addTo(g, W, K.woodMat(), 'sailTimber');
  K.addTo(g, R, K.std(0xb99a62, 0.95), 'sailRope');
  K.addTo(g, RD, K.std(0x87683f, 1), 'sailLashing');
  K.addTo(g, ST, K.std(0x76838a, 0.42, 0.75), 'sailSteel');
}

// ---------------------------------------------------------------- PALM (~1.6 x 1.6, 2.25 tall)
function buildPalm(T, K, g) {
  const { V, UP } = K;
  const W = [], ST = [], R = [];
  const B = 0.05;

  // slatted base board
  for (const z of [-0.3, 0, 0.3]) {
    W.push(K.plank(0.92, 0.05, 0.27, 0x8b6943, 0, 0.025, z));
    for (const x of [-0.4, 0.4]) for (const dz of [-0.07, 0.07]) ST.push(K.nail(x, 0.052, z + dz));
  }

  // terracotta pot + rolled rim (lathe), vertex-tinted water stains
  const body = new T.LatheGeometry([[0, 0], [0.25, 0], [0.28, 0.02], [0.3, 0.08], [0.35, 0.42]].map(([r, y]) => new T.Vector2(r, y + B)), 28);
  const clay = new T.Color(0xb8653d), clayDark = new T.Color(0x7f4127), clayLight = new T.Color(0xd59a72);
  K.paint(body, (x, y, z, c) => {
    const h = Math.min(1, Math.max(0, (y - B) / 0.42)), ang = Math.atan2(z, x);
    const streak = Math.pow(Math.max(0, Math.sin(ang * 7 + 1)), 14) * 0.2 * (1 - h);
    c.copy(clay).lerp(clayDark, 0.45 * Math.pow(1 - h, 3) + streak);
  });
  const rim = new T.LatheGeometry([[0.34, 0.4], [0.41, 0.415], [0.435, 0.45], [0.435, 0.52], [0.415, 0.545], [0.37, 0.55], [0.345, 0.53], [0.335, 0.47]]
    .map(([r, y]) => new T.Vector2(r, y + B)), 28);
  K.paint(rim, (x, y, z, c) => { c.copy(clay).lerp(clayLight, Math.min(1, Math.max(0, (y - B - 0.42) / 0.13)) * 0.45); });
  K.addTo(g, [body, rim], K.std(0xffffff, 0.85, 0, { vertexColors: true, side: T.DoubleSide }), 'pot');

  // mounded soil + pebbles
  {
    const soil = new T.CylinderGeometry(0.338, 0.33, 0.05, 24, 1);
    const p = soil.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0.02) {
        const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
        p.setY(i, p.getY(i) + 0.03 * (1 - r / 0.338) + 0.006 * Math.sin(x * 40) * Math.cos(z * 40));
      }
    }
    soil.computeVertexNormals();
    K.addTo(g, K.bake(soil, 0, B + 0.455, 0), K.std(0x4a3322, 1), 'soil');
    const peb = [];
    for (let i = 0; i < 6; i++) {
      const a = i * 1.07 + 0.4, r = 0.17 + 0.12 * K.rnd();
      peb.push(K.bake(new T.IcosahedronGeometry(0.028, 0), Math.cos(a) * r, B + 0.488, Math.sin(a) * r, K.rnd(), K.rnd(), 0, 1 + K.rnd() * 0.4, 0.6, 1));
    }
    K.addTo(g, peb, K.std(0x8a8478, 0.9), 'pebbles');
  }

  // rope bands tied around the pot
  const potR = y => 0.3 + 0.05 * (y - 0.08) / 0.34;
  for (const y of [0.2, 0.25]) R.push(K.bake(new T.TorusGeometry(potR(y) + 0.008, 0.013, 6, 36), 0, B + y, 0, Math.PI / 2, 0, 0));
  const kr = potR(0.225) + 0.02;
  R.push(K.bake(new T.SphereGeometry(0.024, 8, 6), 0, B + 0.225, kr));
  R.push(K.tube([V(0.005, B + 0.22, kr), V(0.03, B + 0.16, kr + 0.012), V(0.04, B + 0.1, kr - 0.005)], 0.009, 12));
  R.push(K.tube([V(-0.005, B + 0.22, kr), V(-0.025, B + 0.15, kr + 0.01), V(-0.02, B + 0.12, kr - 0.01)], 0.009, 12));

  // curved, ringed trunk built from overlapping flared segments
  const curve = new T.CatmullRomCurve3([V(0, B + 0.44, 0), V(0.015, B + 0.85, 0.01), V(0.05, B + 1.25, 0.025), V(0.09, B + 1.6, 0.04), V(0.11, B + 1.86, 0.045)]);
  {
    const NS = 10, TR = [];
    const barkA = new T.Color(0x8b6c4a), barkB = new T.Color(0x7a5d3e), barkDark = new T.Color(0x4e3a26), barkLight = new T.Color(0xa88d68);
    for (let i = 0; i < NS; i++) {
      const t0 = i / NS, t1 = (i + 1) / NS;
      const p0 = curve.getPointAt(t0), p1 = curve.getPointAt(t1);
      const len = p0.distanceTo(p1) * 1.1;
      const r0 = 0.09 - 0.032 * t0, r1 = 0.09 - 0.032 * t1;
      const geo = new T.CylinderGeometry(r1 * 0.92, r0 * 1.12, len, 12, 3);
      const base = i % 2 ? barkA : barkB;
      K.paint(geo, (x, y, z, c) => {
        const h = y / len + 0.5, ang = Math.atan2(z, x);
        c.copy(base).lerp(barkDark, Math.pow(1 - h, 3) * 0.7).lerp(barkLight, 0.15 * (0.5 + 0.5 * Math.sin(ang * 6 + i)) * h);
      });
      TR.push(K.along(geo, p0, p1));
    }
    K.addTo(g, TR, K.std(0xffffff, 0.95, 0, { vertexColors: true }), 'trunk');
  }
  const top = curve.getPointAt(1);
  K.addTo(g, K.bake(new T.SphereGeometry(0.1, 12, 8), top.x, top.y + 0.02, top.z, 0, 0, 0, 1, 0.75, 1), K.std(0x6a5130, 1), 'crown');
  {
    const nuts = [];
    for (let k = 0; k < 3; k++) {
      const a = 0.4 + k * 2.1;
      nuts.push(K.bake(new T.SphereGeometry(0.068, 12, 10), top.x + Math.cos(a) * 0.085, top.y - 0.07, top.z + Math.sin(a) * 0.085));
    }
    K.addTo(g, nuts, K.std(0x5c3f24, 0.75), 'coconuts');
  }

  // fronds: arching midrib + many folded leaflets (pinnate), custom BufferGeometry
  {
    const C = top.clone().add(V(0, 0.04, 0));
    const RB = [], lp = [], lc = [];
    const leafBase = new T.Color(0x3f6e2a), leafMid = new T.Color(0x5e9438), leafTip = new T.Color(0x9fb54d);
    const push = (v, col) => { lp.push(v.x, v.y, v.z); lc.push(col.r, col.g, col.b); };
    const NF = 8, NL = 17;
    for (let f = 0; f < NF; f++) {
      const ang = (f / NF) * Math.PI * 2 + 0.3 + (K.rnd() - 0.5) * 0.25;
      const upper = f % 2 === 0;
      const peak = upper ? 0.26 : 0.1, drop = upper ? 0.18 : 0.48, L = upper ? 0.68 : 0.76;
      const a = 2 * peak + 2 * Math.sqrt(peak * peak + peak * drop), b = a + drop;
      const dir = V(Math.cos(ang), 0, Math.sin(ang));
      const P = t => C.clone().addScaledVector(dir, L * t + 0.03).add(V(0, a * t - b * t * t, 0));
      const rpts = [];
      for (let k = 0; k <= 10; k++) rpts.push(P(k / 10));
      RB.push(K.tube(rpts, 0.011, 30, 5));
      const tone = 0.85 + K.rnd() * 0.25;
      const cb = leafBase.clone().multiplyScalar(tone), cm = leafMid.clone().multiplyScalar(tone), ct = leafTip.clone().lerp(cm, 0.4);
      for (let j = 1; j <= NL; j++) {
        const t = 0.1 + 0.88 * j / NL;
        const p = P(t);
        const tan = P(Math.min(1, t + 0.01)).sub(P(t - 0.01)).normalize();
        const side = new T.Vector3().crossVectors(tan, UP).normalize();
        const nrm = new T.Vector3().crossVectors(side, tan).normalize();
        const ll = (0.06 + 0.3 * Math.pow(Math.sin(Math.PI * Math.min(1, t - 0.02)), 0.6)) * (1 - 0.3 * t);
        const lw = 0.03 + 0.025 * (1 - t);
        for (const sgn of [-1, 1]) {
          const dl = side.clone().multiplyScalar(sgn * 0.78).addScaledVector(tan, 0.5).addScaledVector(nrm, -(0.25 + 0.55 * t)).normalize();
          const wv = new T.Vector3().crossVectors(dl, nrm).normalize().multiplyScalar(lw);
          const tip = p.clone().addScaledVector(dl, ll);
          const mid = p.clone().addScaledVector(dl, ll * 0.42);
          const mA = mid.clone().add(wv), mB = mid.clone().sub(wv), mC = mid.clone().addScaledVector(nrm, 0.012);
          push(p, cb); push(mA, cm); push(mC, cm);
          push(mC, cm); push(mA, cm); push(tip, ct);
          push(p, cb); push(mC, cm); push(mB, cm);
          push(mC, cm); push(tip, ct); push(mB, cm);
        }
      }
    }
    const leaves = new T.BufferGeometry();
    leaves.setAttribute('position', new T.Float32BufferAttribute(lp, 3));
    leaves.setAttribute('color', new T.Float32BufferAttribute(lc, 3));
    leaves.computeVertexNormals();
    K.addTo(g, leaves, K.std(0xffffff, 0.75, 0, { vertexColors: true, side: T.DoubleSide }), 'fronds');
    K.addTo(g, RB, K.std(0x7d8c44, 0.85), 'frondRibs');
  }

  K.addTo(g, W, K.woodMat(), 'palmBase');
  K.addTo(g, ST, K.std(0x76838a, 0.42, 0.75), 'palmNails');
  K.addTo(g, R, K.std(0xb99a62, 0.95), 'palmRope');
}

// ---------------------------------------------------------------- LANTERN (~1.17 x 0.74, 1.9 tall, centred)
function buildLantern(T, K, g) {
  const { V } = K;
  const W = [], ST = [], BR = [], R = [];
  const PX = -0.3, AY = 1.72, LX = 0.3;

  // crossed feet, square post, braces, cap
  W.push(K.plank(0.74, 0.07, 0.15, 0x7f5c3a, PX, 0.035, 0));
  W.push(K.plank(0.15, 0.07, 0.74, 0x8e6b45, PX, 0.105, 0));
  W.push(K.plank(0.11, 1.66, 0.11, 0x7a5636, PX, 0.97, 0, 0, 0, 0, 0.4));
  W.push(K.plank(0.145, 0.04, 0.145, 0x6a4a2e, PX, 1.82, 0));
  W.push(K.bake(K.woodify(new T.ConeGeometry(0.1, 0.06, 4), 0x6a4a2e), PX, 1.87, 0, 0, Math.PI / 4, 0));
  for (const [fx, fy, fz] of [[PX + 0.33, 0.07, 0], [PX - 0.33, 0.07, 0], [PX, 0.14, 0.33], [PX, 0.14, -0.33]]) {
    const dx = fx - PX, d = Math.hypot(dx, fz);
    W.push(K.beam(V(fx, fy, fz), V(PX + dx / d * 0.05, 0.52, fz / d * 0.05), 0.05, 0.04, 0x765434));
    ST.push(K.nail(fx - dx / d * 0.03, fy + 0.002, fz - fz / d * 0.03));
  }
  // arm through the post, knee brace, curled crook at the tip
  W.push(K.plank(0.73, 0.085, 0.085, 0x82603c, 0.015, AY, 0));
  W.push(K.beam(V(PX + 0.055, AY - 0.34, 0), V(PX + 0.32, AY - 0.04, 0), 0.05, 0.05, 0x765434));
  W.push(K.woodify(K.tube([V(0.36, AY, 0), V(0.44, AY + 0.02, 0), V(0.475, AY + 0.08, 0), V(0.445, AY + 0.125, 0), V(0.4, AY + 0.105, 0)], 0.03, 20, 8), 0x82603c));
  // steel gusset plates + nails at the knee
  for (const s of [-1, 1]) {
    ST.push(K.box(0.13, 0.11, 0.008, PX + 0.12, AY - 0.035, s * 0.047));
    for (const [dx, dy] of [[-0.04, 0.02], [0.04, 0.02], [0, -0.04]]) ST.push(K.nail(PX + 0.12 + dx, AY - 0.035 + dy, s * 0.053, 'z'));
  }
  // rope lashing at arm/post joint
  R.push(K.helix(V(PX, AY - 0.08, 0), 'y', 0.074, 0.09, 4, 0.008));
  // peg with a hanging coil of rope
  W.push(K.rod(V(PX + 0.05, 1.05, 0), V(PX + 0.14, 1.075, 0), 0.016, 0.014, 8, 0x6a4a2e));
  R.push(K.torus(0.07, 0.012, PX + 0.115, 1.0, 0, 0, Math.PI / 2, 0));
  R.push(K.torus(0.018, 0.009, PX + 0.115, 0.935, 0, Math.PI / 2, 0, 0));

  // hanger: eye bolt, chain links, bail
  const AB = AY - 0.0425;
  ST.push(K.rod(V(LX, AB + 0.01, 0), V(LX, 1.652, 0), 0.007));
  ST.push(K.torus(0.022, 0.006, LX, 1.63, 0));
  ST.push(K.torus(0.02, 0.005, LX, 1.595, 0, 0, Math.PI / 2, 0));
  ST.push(K.torus(0.02, 0.005, LX, 1.56, 0));
  ST.push(K.torus(0.125, 0.006, LX, 1.415, 0, 0, 0, 0, Math.PI));
  for (const s of [-1, 1]) ST.push(K.box(0.02, 0.03, 0.02, LX + s * 0.118, 1.415, 0));

  // lantern body: plates, corner posts, wire guards, pyramid cap
  ST.push(K.box(0.2, 0.03, 0.2, LX, 1.115, 0));
  ST.push(K.box(0.2, 0.025, 0.2, LX, 1.3825, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ST.push(K.box(0.022, 0.27, 0.022, LX + sx * 0.085, 1.25, sz * 0.085));
  for (const s of [-1, 1]) {
    ST.push(K.rod(V(LX + s * 0.087, 1.135, 0), V(LX + s * 0.087, 1.365, 0), 0.005, 0.005, 6));
    ST.push(K.rod(V(LX, 1.135, s * 0.087), V(LX, 1.365, s * 0.087), 0.005, 0.005, 6));
    ST.push(K.box(0.17, 0.012, 0.006, LX, 1.25, s * 0.087));
    ST.push(K.box(0.006, 0.012, 0.17, LX + s * 0.087, 1.25, 0));
  }
  ST.push(K.bake(new T.ConeGeometry(0.15, 0.09, 4, 1), LX, 1.44, 0, 0, Math.PI / 4, 0));
  ST.push(K.bake(new T.CylinderGeometry(0.0035, 0.0035, 0.015, 5), LX, 1.207, 0));
  BR.push(K.bake(new T.CylinderGeometry(0.028, 0.028, 0.04, 12), LX, 1.49, 0));
  BR.push(K.bake(new T.CylinderGeometry(0.042, 0.042, 0.012, 12), LX, 1.516, 0));
  BR.push(K.bake(new T.CylinderGeometry(0.06, 0.05, 0.02, 12), LX, 1.09, 0));

  // amber glass (translucent, no shadows) and warm emissive core (no real light)
  K.addTo(g, K.box(0.16, 0.24, 0.16, LX, 1.25, 0), new T.MeshStandardMaterial({
    color: 0xffc56e, transparent: true, opacity: 0.36, roughness: 0.08, metalness: 0,
    emissive: 0xff9a3c, emissiveIntensity: 0.6, depthWrite: false, side: T.DoubleSide, forceSinglePass: true,
  }), 'lanternGlass', true);
  K.addTo(g, K.bake(new T.SphereGeometry(0.055, 12, 10), LX, 1.24, 0), new T.MeshStandardMaterial({
    color: 0xffb04a, transparent: true, opacity: 0.4, roughness: 1, emissive: 0xff8c2a, emissiveIntensity: 1.6, depthWrite: false,
  }), 'lanternGlow', true);
  K.addTo(g, K.bake(new T.CylinderGeometry(0.028, 0.03, 0.07, 12), LX, 1.165, 0), K.std(0xefe3c4, 0.7, 0, { emissive: 0x6b3a10, emissiveIntensity: 0.25 }), 'candle');
  K.addTo(g, K.bake(new T.SphereGeometry(0.02, 10, 8), LX, 1.232, 0, 0, 0, 0, 1, 1.8, 1), K.std(0xffe2a0, 0.4, 0, { emissive: 0xffa53a, emissiveIntensity: 3 }), 'flame');

  K.addTo(g, W, K.woodMat(), 'lanternTimber');
  K.addTo(g, ST, K.std(0x3e4548, 0.5, 0.7), 'lanternSteel');
  K.addTo(g, BR, K.std(0xb48b3c, 0.35, 0.8), 'lanternBrass');
  K.addTo(g, R, K.std(0xb99a62, 0.95), 'lanternRope');
  for (const m of g.children) m.position.x += 0.085; // centre the feet-to-crook span on the origin (the footprint and collider centre)
  g.scale.setScalar(0.65); // a waist-high post lantern (~1.2 m), well below eye level
}

// ---------------------------------------------------------------- NET (1.62 x 1.62, ~0.21 tall)
function buildNet(T, K, g) {
  const { V } = K;
  const W = [], R = [], RD = [], ST = [], FL = [];
  const E = 0.76, IN = 0.71;

  // frame: lower beams along X, upper beams along Z, lapped at the corners
  for (const s of [-1, 1]) {
    W.push(K.plank(1.62, 0.08, 0.1, s > 0 ? 0x86613d : 0x7c5a38, 0, 0.04, s * E));
    W.push(K.plank(0.1, 0.075, 1.62, s > 0 ? 0x93704a : 0x8a6842, s * E, 0.1175, 0));
  }
  // sagging rope lattice (shared surface so the ropes meet at knots)
  const S = (x, z) => 0.11 - 0.08 * (1 - (x / IN) ** 2) * (1 - (z / IN) ** 2);
  const lines = [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6];
  for (const c of lines) {
    const px = [], pz = [];
    pz.push(V(c, 0.088, -E - 0.01));
    for (let k = 0; k <= 10; k++) {
      const u = -IN + (2 * IN * k) / 10;
      px.push(V(u, S(u, c), c));
      pz.push(V(c, S(c, u), u));
    }
    pz.push(V(c, 0.088, E + 0.01));
    R.push(K.tube(px, 0.011, 28, 5));
    R.push(K.tube(pz, 0.011, 30, 5));
    for (const s of [-1, 1]) {
      RD.push(K.torus(0.066, 0.008, s * E, 0.1175, c));           // tie around upper beam
      RD.push(K.torus(0.068, 0.008, c, 0.04, s * E, 0, Math.PI / 2, 0)); // tie around lower beam
    }
  }
  for (const x of lines) for (const z of lines) RD.push(K.bake(new T.SphereGeometry(0.02, 8, 6), x, S(x, z), z));

  // corner floats, steel straps and nails
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    FL.push(K.bake(new T.SphereGeometry(0.075, 14, 10), sx * E, 0.17, sz * E, 0, 0, 0, 1, 0.6, 1));
    R.push(K.bake(new T.TorusGeometry(0.076, 0.008, 6, 24), sx * E, 0.17, sz * E, Math.PI / 2, 0, 0));
    ST.push(K.box(0.12, 0.07, 0.006, sx * 0.72, 0.04, sz * 0.813));
    ST.push(K.box(0.006, 0.065, 0.12, sx * 0.813, 0.1175, sz * 0.72));
    ST.push(K.nail(sx * 0.68, 0.04, sz * 0.818, 'z'));
    ST.push(K.nail(sx * 0.76, 0.04, sz * 0.818, 'z'));
    ST.push(K.nail(sx * 0.818, 0.1175, sz * 0.68, 'x'));
  }

  K.addTo(g, W, K.woodMat(), 'netFrame');
  K.addTo(g, R, K.std(0xc2a36b, 0.95), 'netRope');
  K.addTo(g, RD, K.std(0x8b6c42, 1), 'netKnots');
  K.addTo(g, ST, K.std(0x76838a, 0.42, 0.75), 'netSteel');
  K.addTo(g, FL, K.std(0xd9643a, 0.6), 'netFloats');
}

// ---------------------------------------------------------------- BENCH (1.44 x 0.4, 0.9 tall)
function buildBench(T, K, g) {
  const { V } = K;
  const W = [], ST = [], R = [];
  const LX = 0.6, LZ = 0.15, SY = 0.445;
  for (const sx of [-1, 1]) {
    W.push(K.plank(0.07, 0.42, 0.07, 0x7a5737, sx * LX, 0.21, LZ));
    W.push(K.plank(0.07, 0.9, 0.07, 0x74532f, sx * LX, 0.45, -LZ));
    W.push(K.plank(0.035, 0.07, 0.3, 0x80603d, sx * LX, 0.365, 0));
    W.push(K.plank(0.04, 0.05, 0.3, 0x80603d, sx * LX, 0.12, 0));
  }
  [-0.135, 0, 0.135].forEach((z, i) => {
    W.push(K.plank(1.44, 0.045, 0.12, [0x9a7650, 0x8c6a45, 0xa07c55][i], 0, SY, z));
    for (const sx of [-1, 1]) for (const d of [-0.017, 0.017]) ST.push(K.nail(sx * LX + d, SY + 0.025, z));
  });
  for (const s of [-1, 1]) W.push(K.plank(1.2, 0.07, 0.035, 0x7d5c3a, 0, 0.365, s * LZ));
  W.push(K.plank(1.2, 0.05, 0.05, 0x7d5c3a, 0, 0.12, 0));
  for (const y of [0.64, 0.8]) {
    W.push(K.plank(1.36, 0.1, 0.03, 0x93704a, 0, y, -LZ + 0.05));
    for (const sx of [-1, 1]) for (const d of [-0.025, 0.025]) ST.push(K.nail(sx * LX, y + d, -LZ + 0.067, 'z'));
  }
  R.push(K.helix(V(-LX, 0.22, LZ), 'y', 0.05, 0.08, 4, 0.008));
  K.addTo(g, W, K.woodMat(), 'benchTimber');
  K.addTo(g, ST, K.std(0x76838a, 0.42, 0.75), 'benchNails');
  K.addTo(g, R, K.std(0x8b6c42, 1), 'benchRope');
}

// ---------------------------------------------------------------- CRATE (~0.96 x 0.84, 0.84 tall)
function buildCrate(T, K, g) {
  const { V } = K;
  const W = [], ST = [], R = [];
  const tones = [0x8b6943, 0x9a7650, 0x7f5e3b];
  for (const s of [-1, 1]) W.push(K.plank(0.09, 0.06, 0.84, 0x6c4c2f, s * 0.28, 0.03, 0));
  W.push(K.plank(0.8, 0.03, 0.8, 0x7a5838, 0, 0.075, 0));
  [0.1975, 0.4325, 0.6675].forEach((y, i) => {
    for (const s of [-1, 1]) {
      W.push(K.plank(0.8, 0.215, 0.03, tones[(i + (s > 0 ? 0 : 1)) % 3], 0, y, s * 0.385));
      W.push(K.plank(0.03, 0.215, 0.74, tones[(i + 2) % 3], s * 0.385, y, 0));
      for (const t of [-1, 1]) {
        ST.push(K.nail(t * 0.34, y, s * 0.402, 'z'));
        ST.push(K.nail(s * 0.402, y, t * 0.3, 'x'));
      }
    }
  });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) W.push(K.plank(0.06, 0.69, 0.06, 0x6a4a2e, sx * 0.34, 0.435, sz * 0.34));
  for (const s of [-1, 1]) W.push(K.beam(V(-0.33 * s, 0.12, s * 0.41), V(0.33 * s, 0.75, s * 0.41), 0.09, 0.025, 0x86643f));
  [-0.3, -0.1, 0.1, 0.3].forEach((z, i) => {
    W.push(K.plank(0.82, 0.035, 0.19, tones[i % 3], 0, 0.7925, z));
    for (const sx of [-1, 1]) ST.push(K.nail(sx * 0.3, 0.841, z));
  });
  for (const sx of [-1, 1]) W.push(K.plank(0.08, 0.03, 0.78, 0x6a4a2e, sx * 0.3, 0.825, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0.72, 0.14]) {
    ST.push(K.box(0.1, 0.1, 0.006, sx * 0.35, y, sz * 0.403));
    ST.push(K.box(0.006, 0.1, 0.1, sx * 0.403, y, sz * 0.35));
  }
  for (const sx of [-1, 1]) {
    R.push(K.tube([V(sx * 0.4, 0.56, -0.13), V(sx * 0.46, 0.5, -0.08), V(sx * 0.48, 0.47, 0), V(sx * 0.46, 0.5, 0.08), V(sx * 0.4, 0.56, 0.13)], 0.014, 24));
    for (const sz of [-1, 1]) {
      ST.push(K.box(0.012, 0.05, 0.05, sx * 0.405, 0.56, sz * 0.13));
      R.push(K.bake(new T.SphereGeometry(0.022, 8, 6), sx * 0.415, 0.56, sz * 0.13));
    }
  }
  K.addTo(g, W, K.woodMat(), 'crateTimber');
  K.addTo(g, ST, K.std(0x76838a, 0.42, 0.75), 'crateSteel');
  K.addTo(g, R, K.std(0xb99a62, 0.95), 'crateRope');
}
