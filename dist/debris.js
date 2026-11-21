// Procedural floating resource models for Little Raft.
// export createDebris(T, type, getMaterial, opts?) -> THREE.Group
//   type: 'wood' | 'leaf' | 'scrap' | 'barrel'
//   getMaterial(colorString) -> shared MeshStandardMaterial (owned by engine, never disposed here)
//   opts (optional): { seed:number, tilt:number (barrel axis tilt, radians; default ~0.2),
//                      pool:number (share one of `pool` cached, pre-transformed geometry variants picked by seed;
//                      the geometry is marked userData.shared and must not be disposed per item) }
// export createItemBatch(T) -> THREE.Group: draws pooled items instanced (see below).
// Root is untransformed (engine positions/rotates it). Content is centered on the origin.
// Without opts.pool all geometry is created per call and owned by the returned group's meshes.
// Materials created here are cached per T and shared by every item (material.userData.shared = true);
// they must not be disposed when one item is removed. root.userData.localMaterials stays empty.

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
  const uv1 = parts.some((p) => p.attributes.uv1) ? new Float32Array(count * 2) : null;
  let o = 0;
  for (const p of parts) {
    const c = p.attributes.position.count;
    pos.set(p.attributes.position.array.subarray(0, c * 3), o * 3);
    nor.set(p.attributes.normal.array.subarray(0, c * 3), o * 3);
    if (p.attributes.uv) uv.set(p.attributes.uv.array.subarray(0, c * 2), o * 2);
    if (uv1 && p.attributes.uv1) uv1.set(p.attributes.uv1.array.subarray(0, c * 2), o * 2);
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
  if (uv1) g.setAttribute('uv1', new T.BufferAttribute(uv1, 2));
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
const DRIFT_PLANK = '#a88d68'; // driftwood plank colour (getMaterial key)
const SHARED = new WeakMap();
function cacheFor(T) {
  let cache = SHARED.get(T);
  if (!cache) SHARED.set(T, (cache = new Map()));
  return cache;
}
function sharedMat(T, key, opts) {
  const cache = cacheFor(T);
  let m = cache.get(key);
  if (!m) {
    m = new T.MeshStandardMaterial(opts);
    m.userData.shared = true;
    cache.set(key, m);
  }
  return m;
}

// Plain engine-like (roughness .85) material that takes its colors from the geometry.
const paintMat = (T, side) =>
  sharedMat(T, `paint|${side}`, { color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0, side });

// Per-part roughness/metalness lookup (G = roughness, B = metalness), sampled through a constant uv1 per part,
// so parts that used to need their own material share one vertex-coloured mesh and still shade the same.
const PBR = { paint: [0.85, 0], metal: [0.5, 0.55], bolt: [0.45, 0.55], bracket: [0.75, 0.4] };
const PBR_KEYS = Object.keys(PBR);
function pbrTex(T) {
  const cache = cacheFor(T);
  let t = cache.get('tex|pbr');
  if (!t) {
    const d = new Uint8Array(PBR_KEYS.length * 4);
    PBR_KEYS.forEach((k, i) => { d[i * 4 + 1] = Math.round(PBR[k][0] * 255); d[i * 4 + 2] = Math.round(PBR[k][1] * 255); d[i * 4 + 3] = 255; });
    t = new T.DataTexture(d, PBR_KEYS.length, 1);
    t.magFilter = t.minFilter = T.NearestFilter;
    t.channel = 1;
    t.needsUpdate = true;
    cache.set('tex|pbr', t);
  }
  return t;
}
const pbrMat = (T, side) =>
  sharedMat(T, `pbr|${side}`, { color: 0xffffff, vertexColors: true, roughness: 1, metalness: 1, roughnessMap: pbrTex(T), metalnessMap: pbrTex(T), side });
// Tag a geometry with its lookup slot (and optionally a flat colour).
function slot(T, g, key, hex) {
  if (hex != null) tint(T, g, hex);
  const n = g.attributes.position.count, a = new Float32Array(n * 2), u = (PBR_KEYS.indexOf(key) + 0.5) / PBR_KEYS.length;
  for (let i = 0; i < n; i++) { a[i * 2] = u; a[i * 2 + 1] = 0.5; }
  g.setAttribute('uv1', new T.BufferAttribute(a, 2));
  return g;
}
// The engine's plank material plus vertex colours, so small dark parts can ride along in the plank mesh.
const TINTED = new WeakMap();
function tintedMat(base) {
  let m = TINTED.get(base);
  if (!m) {
    m = base.clone(); m.vertexColors = true; m.userData.shared = true;
    if (base.onBeforeCompile !== m.onBeforeCompile) { m.onBeforeCompile = base.onBeforeCompile; m.customProgramCacheKey = base.customProgramCacheKey; } // clone() drops shader patches (wood bump)
    TINTED.set(base, m);
  }
  return m;
}

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
  const plankMat = getMaterial(DRIFT_PLANK); // sea-weathered grey-tan, darker than the fresh deck

  // bent rusty nail near the chipped end, baked into the plank mesh: its vertex colour cancels the plank
  // albedo (the timber texture is filled with the plank colour) and folds in the old 0.55 metalness' darkening
  const nail = merge(T, [
    place(T, new T.CylinderGeometry(0.006, 0.006, 0.07, 6), 0.6, 0.065, 0.06, 0, 0, 0.35),
    place(T, new T.CylinderGeometry(0.005, 0.002, 0.045, 6), 0.627, 0.11, 0.06, 0, 0, 1.25),
    place(T, new T.CylinderGeometry(0.014, 0.014, 0.005, 8), 0.588, 0.034, 0.06),
  ]);
  const base = plankMat.map ? new T.Color(DRIFT_PLANK) : plankMat.color, nc = new T.Color('#6f6964');
  const k = [nc.r / base.r, nc.g / base.g, nc.b / base.b].map((v) => Math.min(1, v * 0.45));
  const nn = nail.attributes.position.count, ncol = new Float32Array(nn * 3);
  for (let i = 0; i < nn; i++) { ncol.set(k, i * 3); nail.attributes.uv.setXY(i, 0.5, 0.5); }
  nail.setAttribute('color', new T.BufferAttribute(ncol, 3));
  mesh(T, merge(T, [tint(T, g, 0xffffff), nail], true), tintedMat(plankMat), inner);
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
  const foldX = 0.1 + (r() - 0.5) * 0.06, foldK = 0.17 + r() * 0.06; // shallow bend: the sheet lies flat on the water
  const dentX = (r() - 0.5) * 0.3, dentZ = (r() - 0.5) * 0.25;
  const height = (x, z) => {
    let y = 0.012 * Math.sin(x * 44);
    if (x > foldX) y += (x - foldX) * foldK;
    const tz = clamp01((z - 0.17) / (hz - 0.17));
    y += 0.045 * tz * tz;
    const tc = clamp01((-x - 0.22) / (hx - 0.22)) * clamp01((-z - 0.08) / (hz - 0.08));
    y += 0.06 * tc;
    y -= 0.03 * Math.exp(-((x - dentX) ** 2 + (z - dentZ) ** 2) / 0.012);
    return y;
  };
  const g = new T.PlaneGeometry(W, D, 22, 14);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, n = p.count;
  const col = new Float32Array(n * 3);
  // rusty sheet: mid rust body (#8a5a3c), dark pitted rust (#5e3520) at edges, orange (#b0652e) streaks, a few dull steel flecks
  const steel = [0.25, 0.1, 0.045], rust = [0.11, 0.035, 0.015], orange = [0.43, 0.13, 0.03], bare = [0.2, 0.195, 0.18]; // linear
  for (let i = 0; i < n; i++) {
    let x = p.getX(i), z = p.getZ(i);
    const y = height(x, z);
    const tz = clamp01((z - 0.17) / (hz - 0.17));
    // torn jagged edge on the -x side and the far +x corner
    if (x < -hx + 0.01) x += 0.02 + r() * 0.05;
    if (z < -hz + 0.01 && x > 0.2) z += r() * 0.04;
    z -= 0.02 * tz * tz * tz; // slight curl
    p.setXYZ(i, x, y, z);
    const edge = Math.min(hx - Math.abs(x), hz - Math.abs(z));
    const noise = 0.5 + 0.5 * Math.sin(x * 23 + z * 17 + r() * 0.8) * Math.cos(x * 9 - z * 31);
    const k = clamp01((1 - edge / 0.13) * 0.85 + tz * 0.6 + (noise - 0.55) * 0.9);
    const mid = k < 0.5 ? k * 2 : 1, mid2 = k < 0.5 ? 0 : (k - 0.5) * 2;
    for (let c = 0; c < 3; c++) {
      const a = steel[c] + (orange[c] - steel[c]) * mid;
      col[i * 3 + c] = (a + (rust[c] - a) * mid2) * (0.9 + r() * 0.16);
    }
    const fleck = Math.sin(x * 61 + 1.3) * Math.sin(z * 53 - 0.7);
    if (fleck > 0.86 && edge > 0.08) for (let c = 0; c < 3; c++) col[i * 3 + c] = bare[c] * (0.9 + r() * 0.1);
  }
  p.needsUpdate = true;
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.computeVertexNormals();
  slot(T, g, 'bracket'); // rough, half-metal: rust, not shiny steel

  // bolts/rivets along the crease and the near edge
  const spots = [[foldX - 0.03, -0.2], [foldX - 0.03, -0.04], [foldX - 0.03, 0.12], [-0.33, -0.05], [-0.33, 0.1], [0.32, 0.02]];
  const bolts = spots.map(([x, z]) => {
    const b = new T.CylinderGeometry(0.017, 0.019, 0.014, 6);
    return slot(T, place(T, b, x, height(x, z) + 0.008, z, 0, r() * 1.0, x > foldX ? foldK * 0.8 : 0), 'bolt', '#6b5546');
  });

  // small bent rusty bracket bolted to the sheet
  const bx = -0.2, bz = 0.02, by = height(bx, bz) + 0.01;
  const bracket = [
    place(T, new T.BoxGeometry(0.2, 0.012, 0.055), bx, by, bz),
    place(T, new T.BoxGeometry(0.012, 0.09, 0.055), bx + 0.104, by + 0.04, bz, 0, 0, -0.25),
    place(T, new T.CylinderGeometry(0.012, 0.012, 0.012, 6), bx - 0.06, by + 0.01, bz),
  ].map((b) => slot(T, b, 'bracket', '#9a5a32'));
  // sheet, bolts and bracket: one mesh, per-part roughness/metalness from the lookup texture
  mesh(T, merge(T, [g, ...bolts, ...bracket], true), pbrMat(T, T.DoubleSide), inner);
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
    wood.push(tint(T, new T.LatheGeometry(prof, 3, phi + gap / 2, (Math.PI * 2) / staves - gap), s % 2 ? '#8e6a45' : '#7d5c3b'));
  }

  // recessed end caps (chime)
  const capR = rEnd - thick + 0.004, capY = hh - 0.045;
  wood.push(
    tint(T, place(T, new T.CylinderGeometry(capR, capR, 0.03, 28), 0, capY, 0), '#6f4e31'),
    tint(T, place(T, new T.CylinderGeometry(capR, capR, 0.03, 28), 0, -capY, 0), '#6f4e31'),
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
  mesh(T, merge(T, [...wood.map((g) => slot(T, g, 'paint')), ...metal.map((g) => slot(T, g, 'metal'))], true), pbrMat(T, T.FrontSide), body);

  // tilt pivot (root stays untransformed for the engine)
  const tilt = opts.tilt != null ? opts.tilt : 0.14 + r() * 0.14;
  const pivot = new T.Group();
  pivot.name = 'barrel-tilt';
  pivot.rotation.set((r() - 0.5) * tilt * 0.6, r() * Math.PI * 2, tilt);
  pivot.add(body);
  inner.add(pivot);
}

// ---------------------------------------------------------------- waterline foam
// Per-type float offset (engine adds it to the ocean height) and foam ring footprint [x, z] (full size).
const FLOAT = { wood: 0, leaf: 0, scrap: 0.06, barrel: -0.16 };
const FOAM = { wood: [2.5, 0.7], scrap: [1.7, 1.5], barrel: [1.45, 1.45] };
// One soft white ring (radial alpha texture on a flat quad) shared by every item: shared geometry + material.
function foamParts(T) {
  const cache = cacheFor(T);
  let f = cache.get('foam');
  if (f) return f;
  const N = 64, data = new Uint8Array(N * N * 4);
  const ss = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1, r = Math.hypot(u, v), a = Math.atan2(v, u);
    const breakup = 0.72 + 0.28 * Math.sin(a * 7 + Math.sin(a * 3) * 2) * Math.cos(a * 4 - 1);
    const k = ss(0.42, 0.66, r) * (1 - ss(0.68, 0.98, r)) * breakup;
    const i = (y * N + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = data[i + 3] = Math.round(255 * clamp01(k));
  }
  const tex = new T.DataTexture(data, N, N, T.RGBAFormat);
  tex.magFilter = tex.minFilter = T.LinearFilter;
  tex.needsUpdate = true;
  const geo = new T.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.userData.shared = true;
  const mat = new T.MeshBasicMaterial({ color: 0xffffff, alphaMap: tex, transparent: true, opacity: 0.55, depthWrite: false });
  mat.userData.shared = true;
  f = { geo, mat };
  cache.set('foam', f);
  return f;
}
function addFoam(T, root, type, batch) {
  const fp = FOAM[type];
  if (!fp) return;
  const { geo, mat } = foamParts(T);
  const ring = new T.Mesh(geo, mat);
  ring.name = 'debris-foam';
  ring.raycast = () => {}; // never a hook/pickup target
  ring.scale.set(fp[0], 1, fp[1]);
  ring.position.y = -FLOAT[type] + 0.025; // just above the waterline (root sits at ocean height + FLOAT)
  ring.renderOrder = 1;
  if (batch) ring.userData.batch = true; // pooled items: createItemBatch draws every ring as one instanced mesh
  root.add(ring);
}

function build(T, type, getMaterial, opts) {
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

// One baked variant: every mesh's transform folded into its geometry, which is then shared (userData.shared).
function variant(T, type, getMaterial, opts, v) {
  const key = `pool|${type}|${opts.pool}|${v}|${opts.tilt}|${type === 'wood' ? getMaterial(DRIFT_PLANK).uuid : ''}`;
  const cache = cacheFor(T);
  let entry = cache.get(key);
  if (!entry) {
    const src = build(T, type, getMaterial, { tilt: opts.tilt, seed: 0x5eed + v * 7919 });
    src.updateMatrixWorld(true);
    const parts = [];
    src.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.applyMatrix4(o.matrixWorld);
      o.geometry.computeBoundingSphere();
      o.geometry.userData.shared = true;
      parts.push({ geometry: o.geometry, material: o.material, castShadow: o.castShadow });
    });
    cache.set(key, (entry = { parts, size: src.userData.size }));
  }
  return entry;
}

export function createDebris(T, type, getMaterial, opts = {}) {
  if (!TYPES.includes(type)) throw new Error(`createDebris: unknown type "${type}"`);
  // opts.foam: waterline foam ring (default: only for pooled items, i.e. ones floating in the sea; never in hand or icons)
  if (!(opts.pool > 0)) return withFoam(T, build(T, type, getMaterial, opts), type, !!opts.foam, false);
  // opts.pool: share one of `pool` cached geometry variants (picked by seed) instead of building a new one
  const seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 2 ** 31);
  const entry = variant(T, type, getMaterial, opts, ((seed % opts.pool) + opts.pool) % opts.pool);
  const root = new T.Group();
  root.name = `debris-${type}`;
  root.userData.type = type;
  root.userData.localMaterials = [];
  root.userData.size = { ...entry.size };
  for (const p of entry.parts) {
    const m = new T.Mesh(p.geometry, p.material);
    m.castShadow = p.castShadow;
    m.receiveShadow = true;
    m.userData.batch = true; // createItemBatch may draw it instanced
    root.add(m);
  }
  return withFoam(T, root, type, opts.foam !== false, true);
}
// Waterline: the engine floats the root at ocean height + userData.float; the foam ring is added after any
// geometry baking (variant() must never fold the shared ring geometry into a pooled variant).
function withFoam(T, root, type, foam, batch) {
  root.userData.float = FLOAT[type];
  if (foam) addFoam(T, root, type, batch);
  return root;
}

// Instanced drawing for items made of shared geometry. Add the returned object to the group that holds the
// item roots: each frame (from the scene's matrix update, after all gameplay moves) it gathers every
// descendant mesh flagged userData.batch with a userData.shared geometry, hides it, and draws all of them as
// InstancedMeshes per geometry+material. The hidden meshes stay in place for raycasting; item roots keep
// their own position/rotation/scale/visible, which the instances follow. Remove an item root as usual.
// Instances inside a shadow-casting light's frustum go to a shadow-casting InstancedMesh and the rest to one
// that casts none, so the shadow pass draws no more items than per-item culling did.
export function createItemBatch(T) {
  const holder = new T.Group();
  holder.name = 'item-batch';
  const adopted = new WeakMap(), slots = new Map(), slotList = [], local = new T.Matrix4(), world = new T.Matrix4(), sphere = new T.Sphere();
  const frustums = [];
  const noRaycast = () => {};
  // Shadow pass: a depth material only ever used instanced, so sharing three's default one with plain meshes
  // doesn't force a program re-lookup on every switch between instanced and non-instanced casters.
  let depthMat = cacheFor(T).get('mat|itemDepth');
  if (!depthMat) {
    depthMat = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
    depthMat.userData.shared = true;
    cacheFor(T).set('mat|itemDepth', depthMat);
  }
  function entries(item) {
    let list = adopted.get(item);
    if (list) return list;
    list = [];
    item.traverse((o) => {
      if (!o.isMesh || !o.userData.batch || !o.geometry.userData.shared || Array.isArray(o.material)) return;
      const m = new T.Matrix4();
      for (let p = o; p && p !== item; p = p.parent) { if (p.matrixAutoUpdate) p.updateMatrix(); m.premultiply(p.matrix); }
      o.visible = false; // drawn by the batch; Raycaster ignores visibility, so picking still hits it
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      list.push({ key: `${o.geometry.id}:${o.material.id}`, mesh: o, local: m });
    });
    adopted.set(item, list);
    return list;
  }
  function grow(s, src, cap) {
    const im = new T.InstancedMesh(src.geometry, src.material, cap);
    im.name = 'item-batch-instances';
    im.castShadow = s.cast;
    im.customDepthMaterial = depthMat;
    im.receiveShadow = src.receiveShadow;
    im.raycast = noRaycast; // picking resolves through the hidden per-item meshes
    im.instanceMatrix.setUsage(T.DynamicDrawUsage);
    if (s.im) { im.instanceMatrix.array.set(s.im.instanceMatrix.array); holder.remove(s.im); s.im.dispose(); }
    s.im = im; s.cap = cap;
    holder.add(im);
    im.updateMatrixWorld(true);
  }
  function put(s, src, m) {
    if (!s.im) grow(s, src, 16);
    else if (s.n >= s.cap) grow(s, src, s.cap * 2);
    s.im.setMatrixAt(s.n++, m);
  }
  // Shadow frustums of the scene's top-level shadow-casting lights (as of their last shadow render).
  function lights() {
    frustums.length = 0;
    let scene = holder;
    while (scene.parent) scene = scene.parent;
    for (let i = 0; i < scene.children.length; i++) {
      const o = scene.children[i];
      if (!o.isLight || !o.castShadow || !o.shadow) continue;
      if (o.isDirectionalLight || o.isSpotLight) frustums.push(o.shadow.getFrustum());
      else return false; // unknown shadow shape: let every instance cast
    }
    return true;
  }
  function casts(m, geo) {
    sphere.copy(geo.boundingSphere).applyMatrix4(world.multiplyMatrices(holder.parent.matrixWorld, m));
    sphere.radius += 0.5;
    for (let i = 0; i < frustums.length; i++) if (frustums[i].intersectsSphere(sphere)) return true;
    return false;
  }
  function sync() {
    const parent = holder.parent;
    if (!parent) return;
    const known = lights();
    for (let i = 0; i < slotList.length; i++) slotList[i].near.n = slotList[i].far.n = 0;
    for (let i = 0; i < parent.children.length; i++) {
      const item = parent.children[i];
      if (item === holder) continue;
      const parts = entries(item);
      if (!parts.length || !item.visible) continue;
      if (item.matrixAutoUpdate) item.updateMatrix();
      for (let j = 0; j < parts.length; j++) {
        const e = parts[j];
        let s = slots.get(e.key);
        if (!s) {
          s = { near: { im: null, cap: 0, n: 0, cast: e.mesh.castShadow }, far: { im: null, cap: 0, n: 0, cast: false } };
          slots.set(e.key, s); slotList.push(s);
        }
        local.multiplyMatrices(item.matrix, e.local);
        put(e.mesh.castShadow && (!known || casts(local, e.mesh.geometry)) ? s.near : s.far, e.mesh, local);
      }
    }
    for (let i = 0; i < slotList.length; i++) { finish(slotList[i].near); finish(slotList[i].far); }
  }
  function finish(b) {
    if (!b.im) return;
    b.im.count = b.n;
    b.im.visible = b.n > 0;
    if (b.n) { b.im.instanceMatrix.needsUpdate = true; b.im.computeBoundingSphere(); }
  }
  holder.updateMatrixWorld = function (force) {
    T.Object3D.prototype.updateMatrixWorld.call(this, force);
    sync();
  };
  return holder;
}

export default createDebris;
