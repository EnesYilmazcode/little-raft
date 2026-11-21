// Procedural floating resource models for Little Raft.
// export createDebris(T, type, getMaterial, opts?) -> THREE.Group
//   type: 'wood' | 'leaf' | 'scrap' | 'barrel'
//   getMaterial(colorString) -> kept for API compatibility; the debris uses its own shared materials.
//   opts (optional): { seed:number, tilt:number (barrel axis tilt, radians; default ~0.2) }
// Root is untransformed (engine positions/rotates it). Content is centered in x/z and sunk in y so
// that, with the engine's ITEM_FLOAT lift, the root's y = -FLOAT_LIFT plane is the waterline: items
// ride partly submerged, with a darker wet band painted at the waterline.
// Geometry is created per call (owned by the returned meshes). Materials are module-wide, built once
// per THREE instance, vertex-coloured, and never disposed (their dispose() is a no-op so engine
// cleanup does not force shader recompiles). One draw call per item (two for a barrel).
// root.userData.localMaterials is kept (always empty) for older callers.
import { createWoodMaterial } from './wood.js?build=v3-survival-ae77fa84ac2b';

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

function mesh(T, geo, mat, parent) {
  const m = new T.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// ---------------------------------------------------------------- shared materials + paint
const FLOAT_LIFT = 0.05; // engine lifts items by ITEM_FLOAT above the wave height
const ABOVE = { wood: 0.56, leaf: 0.6, scrap: 0.78, barrel: 0.46 }; // fraction of height above water
const MATS = new WeakMap();
const keep = (m) => { m.dispose = () => {}; if (m.map) m.map.dispose = () => {}; if (m.bumpMap) m.bumpMap.dispose = () => {}; return m; };
function mats(T) {
  let m = MATS.get(T);
  if (m) return m;
  let wood = null;
  if (typeof document !== 'undefined') { try { wood = createWoodMaterial(T, '#ffffff'); } catch { wood = null; } }
  if (!wood) wood = new T.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  wood.vertexColors = true; wood.roughness = 0.9; wood.name = 'debris_wood';
  m = {
    wood: keep(wood),
    leaf: keep(new T.MeshStandardMaterial({ name: 'debris_leaf', vertexColors: true, roughness: 0.78, metalness: 0 })),
    metal: keep(new T.MeshStandardMaterial({ name: 'debris_metal', vertexColors: true, roughness: 0.68, metalness: 0.12, side: T.DoubleSide })),
  };
  MATS.set(T, m);
  return m;
}

// Linear-space RGB of an sRGB hex (vertex colours are linear in three r152+).
const _cache = new Map();
function lin(T, hex) {
  let c = _cache.get(hex);
  if (!c) { const k = new T.Color(hex); c = [k.r, k.g, k.b]; _cache.set(hex, c); }
  return c;
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// Give a geometry a color attribute: fn(x, y, z, i) -> [r,g,b] (linear) or a constant [r,g,b].
function paint(T, g, fn) {
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = typeof fn === 'function' ? fn(p.getX(i), p.getY(i), p.getZ(i), i) : fn;
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  return g;
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
// Sea-weathered board: grey-tan, sun-bleached on top, darker split ends, one bent rusty nail.
function buildWood(T, M, inner, r) {
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
  // grain runs along the board: texture v follows x, u wraps across width/thickness
  const uv = g.attributes.uv, off = r() * 0.4;
  for (let i = 0; i < p.count; i++) uv.setXY(i, 0.3 + off + p.getZ(i) * 0.9 + p.getY(i) * 0.9, 0.04 + (p.getX(i) + 0.78) / 1.66);
  g.computeVertexNormals();
  const base = mix(lin(T, '#b4a487'), lin(T, '#a39273'), r()), bleach = lin(T, '#c2b59d'), endDark = lin(T, '#6e5f4c');
  paint(T, g, (x, y) => {
    let c = mix(base, bleach, smooth(0, 0.04, y) * 0.45);
    c = mix(c, endDark, smooth(0.6, 0.76, Math.abs(x)) * 0.55);
    return c;
  });

  // bent rusty nail near the chipped end (painted into the same mesh)
  const rust = lin(T, '#5a3a26');
  const nail = [
    place(T, new T.CylinderGeometry(0.006, 0.006, 0.07, 5), 0.6, 0.065, 0.06, 0, 0, 0.35),
    place(T, new T.CylinderGeometry(0.005, 0.002, 0.045, 5), 0.627, 0.11, 0.06, 0, 0, 1.25),
    place(T, new T.CylinderGeometry(0.014, 0.014, 0.005, 6), 0.588, 0.034, 0.06),
  ].map((n) => paint(T, n, rust));
  mesh(T, merge(T, [g, ...nail], true), M.wood, inner);
}

// ---------------------------------------------------------------- palm leaves
function leafletGeo(T, base, dir, len, wid, droop, out, tone) {
  // out = {pos:[], uv:[], col:[], idx:[]} single-sided top; mirrored later
  const up = new T.Vector3(0, 1, 0);
  const perp = new T.Vector3().crossVectors(up, dir).normalize();
  const rows = 6, start = out.pos.length / 3;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const prof = Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.08)), 0.7) * (1 - 0.3 * t);
    const c = base.clone().addScaledVector(dir, len * t);
    c.y -= droop * len * t * t;
    const w = wid * prof;
    const fold = w * 0.22; // shallow V-fold: edges raised over the midrib
    const l = c.clone().addScaledVector(perp, w); l.y += fold;
    const rr = c.clone().addScaledVector(perp, -w); rr.y += fold;
    out.pos.push(l.x, l.y, l.z, c.x, c.y, c.z, rr.x, rr.y, rr.z);
    out.uv.push(0, t, 0.5, t, 1, t);
    const edge = tone(t, false), rib = tone(t, true);
    out.col.push(...edge, ...rib, ...edge);
  }
  for (let i = 0; i < rows; i++) {
    const a = start + i * 3, b = a + 3;
    out.idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
}

function frondGeo(T, r, length, count, palette) {
  const out = { pos: [], uv: [], col: [], idx: [] };
  const arch = 0.03 + r() * 0.03, sag = 0.04 + r() * 0.03;
  const P = (s) => new T.Vector3(s * length, arch * Math.sin(Math.PI * s) - sag * s * s, 0);
  const dry = 0.35 + r() * 0.65; // how far this frond has browned
  const { olive, oliveDark, yellow, brown, rib } = palette;
  for (let i = 0; i < count; i++) {
    const s = 0.1 + 0.88 * (i / (count - 1));
    const base = P(s);
    const len = 0.09 + 0.27 * Math.sin(Math.PI * (0.22 + 0.72 * s));
    for (const side of [1, -1]) {
      const spread = 0.72 + (r() - 0.5) * 0.25;
      const dir = new T.Vector3(Math.cos(spread), 0, side * Math.sin(spread)).normalize();
      const body = mix(mix(olive, oliveDark, r() * 0.6), yellow, smooth(0.5, 1, s) * 0.25);
      const tipDry = dry * (0.6 + r() * 0.4), tipStart = 0.55 + (1 - s) * 0.25;
      const tone = (t, mid) => {
        let c = mid ? mix(body, rib, 0.35) : body;
        return mix(c, brown, smooth(tipStart, 1, t) * tipDry);
      };
      leafletGeo(T, base.clone().add(new T.Vector3(0, 0, side * 0.006)), dir, len, 0.03 + 0.026 * (len / 0.36), 0.18 + r() * 0.15, out, tone);
    }
  }
  // build double-sided indexed geometry (smooth normals per side)
  const n = out.pos.length / 3;
  const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), col = new Float32Array(n * 6);
  pos.set(out.pos, 0); pos.set(out.pos, n * 3);
  uv.set(out.uv, 0); uv.set(out.uv, n * 2);
  col.set(out.col, 0); col.set(out.col.map((v) => v * 0.8), n * 3); // underside a little darker
  const idx = out.idx.slice();
  for (let i = 0; i < out.idx.length; i += 3) idx.push(out.idx[i] + n, out.idx[i + 2] + n, out.idx[i + 1] + n);
  const blades = new T.BufferGeometry();
  blades.setAttribute('position', new T.BufferAttribute(pos, 3));
  blades.setAttribute('uv', new T.BufferAttribute(uv, 2));
  blades.setAttribute('color', new T.BufferAttribute(col, 3));
  blades.setIndex(idx);
  blades.computeVertexNormals();
  // rachis (midrib of the frond): pale yellow-olive, browning toward the tip
  const curve = new T.CatmullRomCurve3([0, 0.25, 0.5, 0.75, 1].map(P));
  const ribGeo = new T.TubeGeometry(curve, 12, 0.009, 4, false);
  paint(T, ribGeo, (x) => mix(rib, brown, smooth(0.6, 1, x / length) * dry * 0.6));
  return merge(T, [blades, ribGeo], true);
}

function buildLeaf(T, M, inner, r) {
  const palette = {
    olive: lin(T, '#7a8a50'), oliveDark: lin(T, '#5f6c3e'), yellow: lin(T, '#959456'),
    brown: lin(T, '#86704a'), rib: lin(T, '#999466'),
  };
  const fronds = 4, sx = -0.42, parts = [];
  for (let f = 0; f < fronds; f++) {
    const g = frondGeo(T, r, 0.78 + r() * 0.12, 9, palette);
    const yaw = -0.55 + (f / (fronds - 1)) * 1.1 + (r() - 0.5) * 0.15;
    place(T, g, sx, 0.012 * f, 0, (r() - 0.5) * 0.25, yaw, 0.02 + r() * 0.04);
    parts.push(g);
  }
  // central stem the fronds sprout from
  const stem = place(T, new T.CylinderGeometry(0.022, 0.034, 0.36, 7), sx - 0.12, 0.01, 0, 0, 0, Math.PI / 2 - 0.08);
  parts.push(paint(T, stem, lin(T, '#8d8650')));
  // twine tie binding the bundle
  const tie = lin(T, '#a48d62');
  parts.push(paint(T, place(T, new T.TorusGeometry(0.037, 0.008, 5, 12), sx - 0.08, 0.012, 0, 0, Math.PI / 2, 0), tie));
  parts.push(paint(T, place(T, new T.TorusGeometry(0.035, 0.008, 5, 12), sx - 0.045, 0.014, 0, 0, Math.PI / 2, 0), tie));
  mesh(T, merge(T, parts, true), M.leaf, inner);
}

// ---------------------------------------------------------------- scrap metal
function buildScrap(T, M, inner, r) {
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
  // dull galvanised grey -> orange rust -> dark brown rust
  const steel = lin(T, '#9aa0a2'), orange = lin(T, '#b0632f'), rust = lin(T, '#6e3e24');
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
    const k = clamp01((1 - edge / 0.16) * 0.85 + tz * 0.6 + (noise - 0.45) * 1.1 + 0.15);
    const mid = k < 0.5 ? k * 2 : 1, mid2 = k < 0.5 ? 0 : (k - 0.5) * 2;
    for (let c = 0; c < 3; c++) {
      const a = steel[c] + (orange[c] - steel[c]) * mid;
      col[i * 3 + c] = (a + (rust[c] - a) * mid2) * (0.88 + r() * 0.14);
    }
  }
  p.needsUpdate = true;
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const parts = [g];

  // bolts/rivets along the crease and the near edge
  const spots = [[foldX - 0.03, -0.2], [foldX - 0.03, -0.04], [foldX - 0.03, 0.12], [-0.33, -0.05], [-0.33, 0.1], [0.32, 0.02]];
  const boltCol = lin(T, '#6a6560');
  for (const [x, z] of spots) {
    const b = new T.CylinderGeometry(0.017, 0.019, 0.014, 6);
    parts.push(paint(T, place(T, b, x, height(x, z) + 0.008, z, 0, r() * 1.0, x > foldX ? foldK * 0.8 : 0), boltCol));
  }

  // small bent rusty bracket bolted to the sheet
  const bx = -0.2, bz = 0.02, by = height(bx, bz) + 0.01, br = lin(T, '#7a4426');
  parts.push(
    paint(T, place(T, new T.BoxGeometry(0.2, 0.012, 0.055), bx, by, bz), br),
    paint(T, place(T, new T.BoxGeometry(0.012, 0.09, 0.055), bx + 0.104, by + 0.04, bz, 0, 0, -0.25), br),
    paint(T, place(T, new T.CylinderGeometry(0.012, 0.012, 0.012, 6), bx - 0.06, by + 0.01, bz), br),
  );
  mesh(T, merge(T, parts, true), M.metal, inner);
}

// ---------------------------------------------------------------- barrel
function buildBarrel(T, M, inner, r, opts) {
  const H = 1, hh = H / 2, rMid = 0.435, rEnd = 0.372;
  const rad = (y) => rEnd + (rMid - rEnd) * (1 - (y / hh) ** 2);
  const staves = 14, gap = 0.014, thick = 0.03;
  const body = new T.Group();
  const wood = [];
  const staveA = lin(T, '#76604c'), staveB = lin(T, '#846c56'), grey = lin(T, '#7d766c');
  for (let s = 0; s < staves; s++) {
    const dr = (r() - 0.5) * 0.006, dy = (r() - 0.5) * 0.012;
    const prof = [];
    for (let i = 0; i <= 8; i++) { const y = -hh + (H * i) / 8; prof.push(new T.Vector2(rad(y) + dr, y + (i === 0 || i === 8 ? dy : 0))); }
    for (let i = 8; i >= 0; i--) { const y = -hh + (H * i) / 8; prof.push(new T.Vector2(rad(y) + dr - thick, y + (i === 0 || i === 8 ? dy : 0))); }
    prof.push(prof[0].clone());
    const phi = (s / staves) * Math.PI * 2;
    const c = mix(s % 2 ? staveA : staveB, grey, r() * 0.45);
    wood.push(paint(T, new T.LatheGeometry(prof, 3, phi + gap / 2, (Math.PI * 2) / staves - gap), c));
  }

  // recessed end caps (chime)
  const capR = rEnd - thick + 0.004, capY = hh - 0.045, capC = lin(T, '#6c5844');
  wood.push(
    paint(T, place(T, new T.CylinderGeometry(capR, capR, 0.03, 20), 0, capY, 0), capC),
    paint(T, place(T, new T.CylinderGeometry(capR, capR, 0.03, 20), 0, -capY, 0), capC),
  );
  // board seams on top cap
  const seamC = lin(T, '#3e2c1e');
  for (const z of [-0.18, -0.06, 0.06, 0.18]) {
    const len = 2 * Math.sqrt(capR * capR - z * z) - 0.01;
    wood.push(paint(T, place(T, new T.BoxGeometry(len, 0.006, 0.007), 0, capY + 0.015, z), seamC));
  }
  // bung plug on top
  const bx = 0.17, bz = 0, plug = lin(T, '#5a4130');
  wood.push(
    paint(T, place(T, new T.CylinderGeometry(0.036, 0.04, 0.035, 10), bx, capY + 0.03, bz), plug),
    paint(T, place(T, new T.BoxGeometry(0.05, 0.012, 0.012), bx, capY + 0.052, bz), plug),
  );
  mesh(T, merge(T, wood, true), M.wood, body);

  // two dark rusty hoops with rivets, plus the bung ring
  const hoopYs = [-0.3, 0.3], hoopC = lin(T, '#3f3a36'), hoopRust = lin(T, '#6b3f26'), rivetC = lin(T, '#5d5650');
  const metal = hoopYs.map((y) => {
    const R = rad(y), w = 0.038;
    const prof = [
      new T.Vector2(R - 0.004, y - w), new T.Vector2(R + 0.012, y - w + 0.004),
      new T.Vector2(R + 0.015, y), new T.Vector2(R + 0.012, y + w - 0.004),
      new T.Vector2(R - 0.004, y + w), new T.Vector2(R - 0.004, y - w),
    ];
    return paint(T, new T.LatheGeometry(prof, 32), (x, yy, z) => mix(hoopC, hoopRust, clamp01(0.5 + 0.5 * Math.sin(Math.atan2(x, z) * 5 + yy * 9))));
  });
  for (const y of hoopYs) {
    const R = rad(y) + 0.014;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.2;
      metal.push(paint(T, place(T, new T.SphereGeometry(0.011, 5, 3), Math.sin(a) * R, y, Math.cos(a) * R), rivetC));
    }
  }
  metal.push(paint(T, place(T, new T.TorusGeometry(0.045, 0.01, 5, 12), bx, capY + 0.017, bz, Math.PI / 2, 0, 0), hoopC));
  mesh(T, merge(T, metal, true), M.metal, body);

  // tilt pivot (root stays untransformed for the engine)
  const tilt = opts.tilt != null ? opts.tilt : 0.14 + r() * 0.14;
  const pivot = new T.Group();
  pivot.name = 'barrel-tilt';
  pivot.rotation.set((r() - 0.5) * tilt * 0.6, r() * Math.PI * 2, tilt);
  pivot.add(body);
  inner.add(pivot);
}

// Sink the model so the root's y = -FLOAT_LIFT plane cuts it at the type's waterline, then darken
// the vertex colours in a band around that line (wet wood/metal; leaves only slightly).
function floatAndWet(T, root, inner, type) {
  inner.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(inner);
  const h = box.max.y - box.min.y, water = -FLOAT_LIFT;
  inner.position.y += water - (box.min.y + h * (1 - ABOVE[type]));
  inner.updateMatrixWorld(true);
  const wetK = type === 'leaf' ? 0.18 : 0.42, band = Math.max(0.035, h * 0.12);
  const tint = type === 'scrap' ? [0.5, 0.42, 0.36] : type === 'leaf' ? [0.82, 0.85, 0.78] : [0.55, 0.55, 0.5];
  const v = new T.Vector3();
  inner.traverse((o) => {
    const col = o.isMesh && o.geometry.attributes.color;
    if (!col) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      const wet = smooth(water + band, water - 0.01, v.y) * wetK / 0.42;
      if (wet <= 0) continue;
      col.setXYZ(i, col.getX(i) * (1 - wet + wet * tint[0]), col.getY(i) * (1 - wet + wet * tint[1]), col.getZ(i) * (1 - wet + wet * tint[2]));
    }
    col.needsUpdate = true;
  });
}

export function createDebris(T, type, getMaterial, opts = {}) {
  if (!TYPES.includes(type)) throw new Error(`createDebris: unknown type "${type}"`);
  const r = rng(opts.seed != null ? opts.seed : Math.floor(Math.random() * 2 ** 31));
  const M = mats(T);
  const root = new T.Group();
  root.name = `debris-${type}`;
  root.userData.type = type;
  root.userData.localMaterials = [];
  const inner = new T.Group();
  inner.name = `debris-${type}-model`;
  root.add(inner);
  if (type === 'wood') { buildWood(T, M, inner, r); fit(T, inner, 1.6); }
  else if (type === 'leaf') { buildLeaf(T, M, inner, r); fit(T, inner, 1.75); }
  else if (type === 'scrap') { buildScrap(T, M, inner, r); fit(T, inner, 1.2); }
  else { buildBarrel(T, M, inner, r, opts); fit(T, inner, 1.25); }
  floatAndWet(T, root, inner, type);
  inner.updateMatrixWorld(true);
  const size = new T.Box3().setFromObject(inner).getSize(new T.Vector3());
  root.userData.size = { x: size.x, y: size.y, z: size.z };
  return root;
}

export default createDebris;
