// Procedural floating resource models for Little Raft.
// export createDebris(T, type, getMaterial, opts?) -> THREE.Group
//   type: 'wood' | 'leaf' | 'scrap' | 'barrel'
//   getMaterial(colorString) -> shared MeshStandardMaterial (owned by engine, never disposed here)
//   opts (optional): { seed:number, tilt:number (barrel axis tilt, radians; default ~0.2) }
// Root is untransformed (engine positions/rotates it). Content is centered on the origin.
// Each item is ONE mesh whose geometry and material are shared and cached per engine (flagged
// userData.shared: the engine must not dispose them per item). seed picks one of 3 variants.
// Builder materials (cached per T, userData.shared) only supply colours to the bake.

const TYPES = ['wood', 'leaf', 'scrap', 'barrel'];

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Merge geometries (position/normal/uv[/color]) into one non-indexed geometry. Disposes inputs.
function merge(T, geos, withColor = false) {
  const parts = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    if (!n.attributes.normal) n.computeVertexNormals();
    return n;
  });
  let count = 0;
  for (const p of parts) count += p.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const col = withColor ? new Float32Array(count * 3) : null;
  let o = 0;
  for (const p of parts) {
    const c = p.attributes.position.count;
    pos.set(p.attributes.position.array.subarray(0, c * 3), o * 3);
    nor.set(p.attributes.normal.array.subarray(0, c * 3), o * 3);
    if (p.attributes.uv) uv.set(p.attributes.uv.array.subarray(0, c * 2), o * 2);
    if (col) {
      if (p.attributes.color) col.set(p.attributes.color.array.subarray(0, c * 3), o * 3);
      else col.fill(1, o * 3, (o + c) * 3);
    }
    o += c;
    p.dispose();
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.BufferAttribute(nor, 3));
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

function place(T, g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const m = new T.Matrix4().compose(
    new T.Vector3(x, y, z),
    new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)),
    new T.Vector3(s, s, s)
  );
  g.applyMatrix4(m);
  return g;
}

function mesh(T, geo, mat, parent, castShadow = false) {
  const m = new T.Mesh(geo, mat);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Bake a flat color (sRGB hex -> linear, as three does for material.color) into a color attribute.
function tint(T, g, hex) {
  const c = new T.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new T.BufferAttribute(a, 3));
  return g;
}

// Module-level material cache (one set per THREE namespace). Shared across items: never dispose per item.
const SHARED = new WeakMap();
function sharedMat(T, key, opts) {
  let cache = SHARED.get(T);
  if (!cache) SHARED.set(T, (cache = new Map()));
  let m = cache.get(key);
  if (!m) {
    m = new T.MeshStandardMaterial(opts);
    m.userData.shared = true;
    cache.set(key, m);
  }
  return m;
}

function metalMat(T, color, extra = {}) {
  return sharedMat(T, `metal|${color}|${JSON.stringify(extra)}`, { color, metalness: 0.55, roughness: 0.5, ...extra });
}
// Plain engine-like (roughness .85) material that takes its colors from the geometry.
const paintMat = (T, side) =>
  sharedMat(T, `paint|${side}`, { color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0, side });

// Center content on origin; uniformly shrink if xz footprint exceeds maxXZ.
function fit(T, inner, maxXZ) {
  inner.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(inner);
  const size = box.getSize(new T.Vector3());
  const s = Math.min(1, maxXZ / Math.max(size.x, size.z, 1e-6));
  inner.scale.multiplyScalar(s);
  inner.updateMatrixWorld(true);
  const box2 = new T.Box3().setFromObject(inner);
  const c = box2.getCenter(new T.Vector3());
  inner.position.sub(c);
}

// ---------------------------------------------------------------- wood plank
function buildWood(T, getMaterial, root, inner, r) {
  const j = (a) => (r() - 0.5) * a;
  const pts = [
    [-0.72, -0.14], [-0.3, -0.137 + j(0.006)], [0.2, -0.142 + j(0.006)],
    [0.71, -0.14], [0.738, -0.1 + j(0.01)], [0.726, -0.05], [0.752, 0.0 + j(0.01)],
    [0.74, 0.05], [0.758, 0.085 + j(0.01)], [0.71, 0.14],
    [0.25, 0.143 + j(0.006)], [-0.32, 0.138 + j(0.006)], [-0.69, 0.14],
    [-0.742, 0.105], [-0.73, 0.06],
    // split slit opening at the left end
    [-0.752, 0.034], [-0.43 + j(0.05), 0.021], [-0.756, 0.008],
    [-0.738, -0.03], [-0.762, -0.075 + j(0.01)], [-0.748, -0.115],
  ];
  const shape = new T.Shape();
  pts.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  const depth = 0.065;
  const g = new T.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: 0.009, bevelSize: 0.006, bevelSegments: 1, steps: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -depth / 2, 0);
  // worn warp + slight twist
  const p = g.attributes.position;
  const bow = 0.025 + j(0.02), twist = 0.06 + j(0.05);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), u = x / 0.75;
    p.setY(i, p.getY(i) + bow * u * u + twist * z * u);
  }
  p.needsUpdate = true;
  g.computeBoundingSphere();
  mesh(T, g, getMaterial('#d5a265'), inner);

  // bent rusty nail near the chipped end
  const nailMat = metalMat(T, '#6f6964', { roughness: 0.6 });
  const shaft = place(T, new T.CylinderGeometry(0.006, 0.006, 0.07, 6), 0.6, 0.065, 0.06, 0, 0, 0.35);
  const tip = place(T, new T.CylinderGeometry(0.005, 0.002, 0.045, 6), 0.627, 0.11, 0.06, 0, 0, 1.25);
  const head = place(T, new T.CylinderGeometry(0.014, 0.014, 0.005, 8), 0.588, 0.034, 0.06);
  mesh(T, merge(T, [shaft, tip, head]), nailMat, inner, false);
}

// ---------------------------------------------------------------- palm leaves
function leafletGeo(T, base, dir, len, wid, droop, out) {
  // out = {pos:[], idx:[]} single sheet, rendered with side: DoubleSide
  const up = new T.Vector3(0, 1, 0);
  const perp = new T.Vector3().crossVectors(up, dir).normalize();
  const rows = 3, start = out.pos.length / 3;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const prof = Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.08)), 0.8) * (1 - 0.35 * t);
    const c = base.clone().addScaledVector(dir, len * t);
    c.y -= droop * len * t * t;
    const w = wid * prof;
    const fold = w * 0.45; // V-fold: edges raised over the midrib
    const l = c.clone().addScaledVector(perp, w); l.y += fold;
    const rr = c.clone().addScaledVector(perp, -w); rr.y += fold;
    out.pos.push(l.x, l.y, l.z, c.x, c.y, c.z, rr.x, rr.y, rr.z);
    out.uv.push(0, t, 0.5, t, 1, t);
  }
  for (let i = 0; i < rows; i++) {
    const a = start + i * 3, b = a + 3;
    out.idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
}

function frondGeo(T, r, length, count) {
  const out = { pos: [], uv: [], idx: [] };
  const arch = 0.05 + r() * 0.04, sag = 0.06 + r() * 0.04;
  const P = (s) => new T.Vector3(s * length, arch * Math.sin(Math.PI * s) - sag * s * s, 0);
  for (let i = 0; i < count; i++) {
    const s = 0.1 + 0.88 * (i / (count - 1));
    const base = P(s);
    const len = 0.08 + 0.26 * Math.sin(Math.PI * (0.22 + 0.72 * s));
    for (const side of [1, -1]) {
      const spread = 0.75 + (r() - 0.5) * 0.25;
      const dir = new T.Vector3(Math.cos(spread), 0, side * Math.sin(spread)).normalize();
      leafletGeo(T, base.clone().add(new T.Vector3(0, 0, side * 0.006)), dir, len, 0.022 + 0.018 * (len / 0.34), 0.35 + r() * 0.2, out);
    }
  }
  // single-sided indexed sheet; the material is DoubleSide so no mirrored copy is needed
  const blades = new T.BufferGeometry();
  blades.setAttribute('position', new T.Float32BufferAttribute(out.pos, 3));
  blades.setAttribute('uv', new T.Float32BufferAttribute(out.uv, 2));
  blades.setIndex(out.idx);
  blades.computeVertexNormals();
  // rachis (midrib of the frond)
  const curve = new T.CatmullRomCurve3([0, 0.25, 0.5, 0.75, 1].map(P));
  const rib = new T.TubeGeometry(curve, 8, 0.009, 3, false);
  return merge(T, [blades, rib]);
}

function buildLeaf(T, getMaterial, root, inner, r) {
  const greens = ['#4f9a3a', '#5fae45', '#46893a', '#6bb84c'];
  const fronds = 4;
  const sx = -0.42;
  const parts = [];
  for (let f = 0; f < fronds; f++) {
    const g = frondGeo(T, r, 0.78 + r() * 0.12, 9);
    const yaw = -0.5 + (f / (fronds - 1)) * 1.0 + (r() - 0.5) * 0.15;
    place(T, g, sx, 0.015 * f, 0, (r() - 0.5) * 0.35, yaw, 0.05 + r() * 0.06);
    parts.push(tint(T, g, greens[f % greens.length]));
  }
  // central stem the fronds sprout from
  const stem = new T.CylinderGeometry(0.022, 0.034, 0.36, 8);
  place(T, stem, sx - 0.12, 0.01, 0, 0, 0, Math.PI / 2 - 0.08);
  parts.push(tint(T, stem, '#7d8a3d'));
  // twine tie binding the bundle
  parts.push(
    tint(T, place(T, new T.TorusGeometry(0.037, 0.008, 4, 12), sx - 0.08, 0.012, 0, 0, Math.PI / 2, 0), '#b89a64'),
    tint(T, place(T, new T.TorusGeometry(0.035, 0.008, 4, 12), sx - 0.045, 0.014, 0, 0, Math.PI / 2, 0), '#b89a64'),
  );
  // one vertex-colored, double-sided mesh for the whole bundle
  mesh(T, merge(T, parts, true), paintMat(T, T.DoubleSide), inner);
}

// ---------------------------------------------------------------- scrap metal
function buildScrap(T, getMaterial, root, inner, r) {
  const W = 0.95, D = 0.65, hx = W / 2, hz = D / 2;
  const foldX = 0.1 + (r() - 0.5) * 0.06, foldK = 0.42 + r() * 0.15;
  const dentX = (r() - 0.5) * 0.3, dentZ = (r() - 0.5) * 0.25;
  const height = (x, z) => {
    let y = 0.012 * Math.sin(x * 44);
    if (x > foldX) y += (x - foldX) * foldK;
    const tz = clamp01((z - 0.17) / (hz - 0.17));
    y += 0.12 * tz * tz;
    const tc = clamp01((-x - 0.22) / (hx - 0.22)) * clamp01((-z - 0.08) / (hz - 0.08));
    y += 0.16 * tc;
    y -= 0.03 * Math.exp(-((x - dentX) ** 2 + (z - dentZ) ** 2) / 0.012);
    return y;
  };
  const g = new T.PlaneGeometry(W, D, 22, 14);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, n = p.count;
  const col = new Float32Array(n * 3);
  const steel = [0.63, 0.72, 0.8], rust = [0.5, 0.24, 0.1], orange = [0.74, 0.4, 0.17];
  for (let i = 0; i < n; i++) {
    let x = p.getX(i), z = p.getZ(i);
    const y = height(x, z);
    const tz = clamp01((z - 0.17) / (hz - 0.17));
    // torn jagged edge on the -x side and the far +x corner
    if (x < -hx + 0.01) x += 0.02 + r() * 0.05;
    if (z < -hz + 0.01 && x > 0.2) z += r() * 0.04;
    z -= 0.05 * tz * tz * tz; // curl back over
    p.setXYZ(i, x, y, z);
    const edge = Math.min(hx - Math.abs(x), hz - Math.abs(z));
    const noise = 0.5 + 0.5 * Math.sin(x * 23 + z * 17 + r() * 0.8) * Math.cos(x * 9 - z * 31);
    const k = clamp01((1 - edge / 0.13) * 0.85 + tz * 0.6 + (noise - 0.55) * 0.9);
    const mid = k < 0.5 ? k * 2 : 1, mid2 = k < 0.5 ? 0 : (k - 0.5) * 2;
    for (let c = 0; c < 3; c++) {
      const a = steel[c] + (orange[c] - steel[c]) * mid;
      col[i * 3 + c] = (a + (rust[c] - a) * mid2) * (0.92 + r() * 0.1);
    }
  }
  p.needsUpdate = true;
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const sheetMat = metalMat(T, '#ffffff', { vertexColors: true, side: T.DoubleSide });
  mesh(T, g, sheetMat, inner);

  // bolts/rivets along the crease and the near edge
  const spots = [[foldX - 0.03, -0.2], [foldX - 0.03, -0.04], [foldX - 0.03, 0.12], [-0.33, -0.05], [-0.33, 0.1], [0.32, 0.02]];
  const bolts = spots.map(([x, z]) => {
    const b = new T.CylinderGeometry(0.017, 0.019, 0.014, 6);
    return place(T, b, x, height(x, z) + 0.008, z, 0, r() * 1.0, x > foldX ? foldK * 0.8 : 0);
  });
  mesh(T, merge(T, bolts), metalMat(T, '#8e9aa2', { roughness: 0.45 }), inner);

  // small bent rusty bracket bolted to the sheet
  const bx = -0.2, bz = 0.02, by = height(bx, bz) + 0.01;
  const bracket = merge(T, [
    place(T, new T.BoxGeometry(0.2, 0.012, 0.055), bx, by, bz),
    place(T, new T.BoxGeometry(0.012, 0.09, 0.055), bx + 0.104, by + 0.04, bz, 0, 0, -0.25),
    place(T, new T.CylinderGeometry(0.012, 0.012, 0.012, 6), bx - 0.06, by + 0.01, bz),
  ]);
  mesh(T, bracket, metalMat(T, '#9a5a32', { metalness: 0.4, roughness: 0.75 }), inner);
}

// ---------------------------------------------------------------- barrel
function buildBarrel(T, getMaterial, root, inner, r, opts) {
  const H = 1, hh = H / 2, rMid = 0.435, rEnd = 0.372;
  const rad = (y) => rEnd + (rMid - rEnd) * (1 - (y / hh) ** 2);
  const staves = 14, gap = 0.014, thick = 0.03, rows = 6;
  const body = new T.Group();
  const wood = [], metal = []; // merged into one vertex-colored mesh each
  for (let s = 0; s < staves; s++) {
    const dr = (r() - 0.5) * 0.006, dy = (r() - 0.5) * 0.012;
    const prof = [];
    for (let i = 0; i <= rows; i++) { const y = -hh + (H * i) / rows; prof.push(new T.Vector2(rad(y) + dr, y + (i === 0 || i === rows ? dy : 0))); }
    for (let i = rows; i >= 0; i--) { const y = -hh + (H * i) / rows; prof.push(new T.Vector2(rad(y) + dr - thick, y + (i === 0 || i === rows ? dy : 0))); }
    prof.push(prof[0].clone());
    const phi = (s / staves) * Math.PI * 2;
    wood.push(tint(T, new T.LatheGeometry(prof, 3, phi + gap / 2, (Math.PI * 2) / staves - gap), s % 2 ? '#b98148' : '#a8703f'));
  }

  // recessed end caps (chime)
  const capR = rEnd - thick + 0.004, capY = hh - 0.045;
  wood.push(
    tint(T, place(T, new T.CylinderGeometry(capR, capR, 0.03, 28), 0, capY, 0), '#9a6538'),
    tint(T, place(T, new T.CylinderGeometry(capR, capR, 0.03, 28), 0, -capY, 0), '#9a6538'),
  );
  // board seams on top cap
  for (const z of [-0.18, -0.06, 0.06, 0.18]) {
    const len = 2 * Math.sqrt(capR * capR - z * z) - 0.01;
    wood.push(tint(T, place(T, new T.BoxGeometry(len, 0.006, 0.007), 0, capY + 0.015, z), '#5e3b20'));
  }

  // two dark metal hoops with rivets
  const hoopYs = [-0.3, 0.3];
  for (const y of hoopYs) {
    const R = rad(y), w = 0.038;
    const prof = [
      new T.Vector2(R - 0.004, y - w), new T.Vector2(R + 0.012, y - w + 0.004),
      new T.Vector2(R + 0.015, y), new T.Vector2(R + 0.012, y + w - 0.004),
      new T.Vector2(R - 0.004, y + w), new T.Vector2(R - 0.004, y - w),
    ];
    metal.push(tint(T, new T.LatheGeometry(prof, 32), '#3a3f44'));
  }
  for (const y of hoopYs) {
    const R = rad(y) + 0.014;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.2;
      metal.push(tint(T, place(T, new T.SphereGeometry(0.011, 4, 2), Math.sin(a) * R, y, Math.cos(a) * R), '#6d757b'));
    }
  }

  // bung plug on top
  const bx = 0.17, bz = 0;
  metal.push(tint(T, place(T, new T.TorusGeometry(0.045, 0.01, 4, 12), bx, capY + 0.017, bz, Math.PI / 2, 0, 0), '#3a3f44'));
  wood.push(
    tint(T, place(T, new T.CylinderGeometry(0.036, 0.04, 0.035, 12), bx, capY + 0.03, bz), '#6b4426'),
    tint(T, place(T, new T.BoxGeometry(0.05, 0.012, 0.012), bx, capY + 0.052, bz), '#6b4426'),
  );
  mesh(T, merge(T, wood, true), paintMat(T, T.FrontSide), body);
  mesh(T, merge(T, metal, true), metalMat(T, '#ffffff', { vertexColors: true }), body);

  // tilt pivot (root stays untransformed for the engine)
  const tilt = opts.tilt != null ? opts.tilt : 0.14 + r() * 0.14;
  const pivot = new T.Group();
  pivot.name = 'barrel-tilt';
  pivot.rotation.set((r() - 0.5) * tilt * 0.6, r() * Math.PI * 2, tilt);
  pivot.add(body);
  inner.add(pivot);
}

export function createDebris(T, type, getMaterial, opts = {}) {
  if (!TYPES.includes(type)) throw new Error(`createDebris: unknown type "${type}"`);
  const r = rng(opts.seed != null ? opts.seed : Math.floor(Math.random() * 2 ** 31));
  const root = new T.Group();
  root.name = `debris-${type}`;
  root.userData.type = type;
  root.userData.localMaterials = [];
  const inner = new T.Group();
  inner.name = `debris-${type}-model`;
  root.add(inner);
  if (type === 'wood') { buildWood(T, getMaterial, root, inner, r); fit(T, inner, 1.6); }
  else if (type === 'leaf') { buildLeaf(T, getMaterial, root, inner, r); fit(T, inner, 1.75); }
  else if (type === 'scrap') { buildScrap(T, getMaterial, root, inner, r); fit(T, inner, 1.2); }
  else { buildBarrel(T, getMaterial, root, inner, r, opts); fit(T, inner, 1.25); }
  inner.updateMatrixWorld(true);
  const size = new T.Box3().setFromObject(inner).getSize(new T.Vector3());
  root.userData.size = { x: size.x, y: size.y, z: size.z };
  return root;
}

export default createDebris;
