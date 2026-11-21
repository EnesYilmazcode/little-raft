// Procedural low-poly prop models for Little Raft. No assets; see docs/MODEL-STYLE.md.
// buildModel(kind, {lod}) -> new THREE.Group that owns its geometry (userData.dispose() frees it).
// getModel(kind, {lod})   -> clone of a cached template (shared geometry; do not dispose).
// Materials are shared module-wide and never disposed. Placeables/items stand on y = 0,
// handheld tools (hook, hammer, rod) have their grip at the origin, working end +Y, face -Z.
import * as T from './vendor/three.module.js';

// ------------------------------------------------------------------ palette
const C = {
  plank: 0xc48c55, plankLight: 0xd9a86c, darkWood: 0x6b4529, log: 0x7d5535, drift: 0xa39684,
  rope: 0xcdb07a, ropeDark: 0x8f7646,
  white: 0xece9e0, teal: 0x2fa39a, blue: 0x3d8fd1, red: 0xd9483b, yellow: 0xf2c14e, orange: 0xe8792e,
  metal: 0x8e989e, darkMetal: 0x3f4448, rust: 0xa5522a,
  leaf: 0x5fae3a, leafDark: 0x3b7f2a, leafLight: 0xa5d65a, stem: 0x86a84a,
  soil: 0x4a3222, soilLight: 0x6b4a31,
  beet: 0x8e1f3f, beetLight: 0xc23a5c, potato: 0xc9a067, seed: 0xb98d4f,
  cloth: 0xefe6cf, clothPatch: 0xd8c6a0, glow: 0xffcf73, terracotta: 0xc56a3f, cork: 0xb5875a,
};

// ------------------------------------------------------------------ shared materials (lazy, never disposed)
let MATS = null;
function grainTexture() {
  if (typeof document === 'undefined') return null; // node tests
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 128);
  const r = rng(77);
  for (let i = 0; i < 70; i++) {
    const y = r() * 128, a = 0.05 + r() * 0.12, amp = 1 + r() * 3, f = 0.01 + r() * 0.03, ph = r() * 6;
    g.strokeStyle = `rgba(60,35,15,${a})`; g.lineWidth = 0.5 + r() * 1.6; g.beginPath();
    for (let x = 0; x <= 256; x += 8) { const yy = y + Math.sin(x * f + ph) * amp; x ? g.lineTo(x, yy) : g.moveTo(x, yy); }
    g.stroke();
  }
  for (let k = 0; k < 2; k++) {
    const x = 30 + r() * 196, y = 20 + r() * 88;
    for (let s = 1; s < 5; s++) { g.strokeStyle = `rgba(60,30,12,${0.22 - s * 0.04})`; g.beginPath(); g.ellipse(x, y, s * 5, s * 1.6, 0, 0, 7); g.stroke(); }
  }
  const t = new T.CanvasTexture(cv);
  t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function mats() {
  if (MATS) return MATS;
  const S = o => new T.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.8, metalness: 0 }, o));
  const grain = grainTexture();
  MATS = {
    wood: S({ map: grain, roughness: 0.85 }),
    base: S({}),
    flat: S({ roughness: 0.95, flatShading: true }),
    plastic: S({ roughness: 0.42 }),
    metal: S({ roughness: 0.45, metalness: 0.55 }),
    metalFlat: S({ roughness: 0.55, metalness: 0.5, flatShading: true }),
    leaf: S({ roughness: 0.7, side: T.DoubleSide }),
    cloth: S({ roughness: 0.95, side: T.DoubleSide }),
    glass: S({ roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.9 }),
    glow: S({ emissive: C.glow, emissiveIntensity: 1.6, roughness: 0.3 }),
  };
  for (const [k, m] of Object.entries(MATS)) m.name = 'model_' + k;
  return MATS;
}

// ------------------------------------------------------------------ math helpers
function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const hash3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const V = (x, y, z) => new T.Vector3(x, y, z);
const UP = V(0, 1, 0);
const _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _v = new T.Vector3(), _s = new T.Vector3(), _c = new T.Color();

// ------------------------------------------------------------------ primitives
// Rounded (bevelled) box. s = bevel segments: 1 = chamfer, 2 = soft round.
function rbox(w, h, d, r = 0.01, s = 2) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  if (r <= 0.0005 || s < 1) return new T.BoxGeometry(w, h, d);
  const n = 2 * s + 1, g = new T.BoxGeometry(1, 1, 1, n, n, n);
  const p = g.attributes.position, nr = g.attributes.normal;
  const map = (u, half) => { const k = Math.round((u + 0.5) * n); return k <= s ? -(half - r) - r * (1 - k / s) : (half - r) + r * (1 - (n - k) / s); };
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    const x = map(p.getX(i), w / 2), y = map(p.getY(i), h / 2), z = map(p.getZ(i), d / 2);
    const ix = Math.max(-hx, Math.min(hx, x)), iy = Math.max(-hy, Math.min(hy, y)), iz = Math.max(-hz, Math.min(hz, z));
    _v.set(x - ix, y - iy, z - iz);
    const len = _v.length();
    if (len > 1e-6) { _v.multiplyScalar(1 / len); p.setXYZ(i, ix + _v.x * r, iy + _v.y * r, iz + _v.z * r); nr.setXYZ(i, _v.x, _v.y, _v.z); }
    else p.setXYZ(i, x, y, z);
  }
  return g;
}
const cyl = (rt, rb, h, rad = 10, hs = 1, open = false) => new T.CylinderGeometry(rt, rb, h, rad, hs, open);
const lathe = (pts, seg) => new T.LatheGeometry(pts.map(([r, y]) => new T.Vector2(Math.max(r, 0), y)), seg);
const tube = (pts, r, ts, rad, closed = false) => new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(p => V(...p)), closed), ts, r, rad, closed);
// geometry built along +Y and centred -> spans a..b
function along(g, a, b) {
  const A = V(...a), B = V(...b), d = B.clone().sub(A), len = d.length() || 1;
  _q.setFromUnitVectors(UP, d.multiplyScalar(1 / len));
  return g.applyMatrix4(_m.compose(A.add(B).multiplyScalar(0.5), _q, _s.set(1, 1, 1)));
}
const between = (a, b, r1, r2, rad) => along(cyl(r2, r1, V(...a).distanceTo(V(...b)), rad), a, b);
// Leaf blade along +Z: 5 columns (edge, half, midrib, half, edge), V-folded and drooping. uv.x 0..1 across, uv.y 0..1 along.
function blade(len, wid, nl = 6, fold = 0.25, droop = 0.3, shape = t => Math.sin(Math.PI * Math.pow(t, 0.75))) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nl; i++) {
    const t = i / nl, w = shape(t) * wid / 2, bend = droop * t * t * len;
    for (let j = 0; j < 5; j++) {
      const s = (j - 2) / 2;
      pos.push(s * w, Math.abs(s) * w * fold - bend, t * len * (1 - droop * 0.25 * t)); uv.push(j / 4, t);
    }
  }
  for (let i = 0; i < nl; i++) for (let j = 0; j < 4; j++) { const a = i * 5 + j, b = a + 5; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
// Grid sheet in XY (w x h), z = f(u,v). Used for cloth and soil.
function sheet(w, h, nx, ny, f) {
  const g = new T.PlaneGeometry(w, h, nx, ny), p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) p.setZ(i, f(uv.getX(i), uv.getY(i), p.getX(i), p.getY(i)));
  g.computeVertexNormals(); return g;
}

// ------------------------------------------------------------------ builder kit
// add(geo, color, {m, p, r, s, col, jit, perFace, uvSwap}) transforms geo into the model, paints it and buckets it by material.
function kit(kind, lod) {
  const r = rng(hashStr(kind) ^ (lod * 977));
  const buckets = new Map(), stack = [new T.Matrix4()];
  const q = lod ? 0.55 : 1;
  const K = {
    r, lod, seg: n => Math.max(3, Math.round(n * q)), bev: 1, hero: lod ? 1 : 2, ud: {},
    jit: (amt = 0.1) => 1 + (r() - 0.5) * 2 * amt,
    push(p = [0, 0, 0], rot = [0, 0, 0], s = 1) { _e.set(...rot); _q.setFromEuler(_e); const m = new T.Matrix4().compose(V(...p), _q, typeof s === 'number' ? _s.set(s, s, s) : _s.set(...s)); stack.push(stack[stack.length - 1].clone().multiply(m)); },
    pop() { stack.pop(); },
    add(g, color, o = {}) {
      if (o.perFace && g.index) { const n = g.toNonIndexed(); g.dispose(); g = n; }
      if (!g.attributes.uv) g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (o.uvSwap) { const a = g.attributes.uv; for (let i = 0; i < a.count; i++) { const u = a.getX(i); a.setXY(i, a.getY(i), u); } }
      // paint in local space
      const p = g.attributes.position, uv = g.attributes.uv, n = p.count, col = new Float32Array(n * 3);
      const base = new T.Color(color), j = o.jit === undefined ? K.jit(0.06) : 1 + (r() - 0.5) * 2 * o.jit;
      base.multiplyScalar(j);
      const f = o.col;
      if (o.perFace) {
        for (let i = 0; i < n; i += 3) {
          const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
          _c.copy(base); if (f) f(_c, cx, cy, cz, uv.getX(i), uv.getY(i), i / 3);
          for (let k = 0; k < 3; k++) _c.toArray(col, (i + k) * 3);
        }
      } else {
        for (let i = 0; i < n; i++) { _c.copy(base); if (f) f(_c, p.getX(i), p.getY(i), p.getZ(i), uv.getX(i), uv.getY(i), i); _c.toArray(col, i * 3); }
      }
      g.setAttribute('color', new T.BufferAttribute(col, 3));
      if (!g.attributes.normal) g.computeVertexNormals();
      _e.set(...(o.r || [0, 0, 0]), o.order || 'XYZ'); _q.setFromEuler(_e);
      const sc = o.s === undefined ? 1 : o.s;
      _m.compose(_v.set(...(o.p || [0, 0, 0])), _q, typeof sc === 'number' ? _s.set(sc, sc, sc) : _s.set(...sc));
      g.applyMatrix4(_m.premultiply(stack[stack.length - 1]));
      const key = o.m || 'base';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(g);
      return g;
    },
    finish(ao = {}) {
      const M = mats(), root = new T.Group(); root.name = 'model_' + kind;
      const geos = [...buckets.entries()].map(([k, list]) => [k, merge(list)]);
      const box = new T.Box3();
      for (const [, g] of geos) { g.computeBoundingBox(); box.union(g.boundingBox); }
      const minY = box.min.y, H = box.max.y - minY, aoH = ao.h ?? Math.min(0.45, H * 0.4), aoMin = ao.min ?? 0.62;
      for (const [k, g] of geos) {
        const p = g.attributes.position, nr = g.attributes.normal, c = g.attributes.color;
        for (let i = 0; i < p.count; i++) {
          const a = (aoMin + (1 - aoMin) * smooth(0, aoH, p.getY(i) - minY)) * (nr.getY(i) < -0.5 ? 0.82 : 1);
          c.setXYZ(i, c.getX(i) * a, c.getY(i) * a, c.getZ(i) * a);
        }
        g.computeBoundingSphere();
        const mesh = new T.Mesh(g, M[k] || M.base); mesh.name = kind + '_' + k;
        mesh.castShadow = k !== 'glow'; mesh.receiveShadow = true;
        root.add(mesh);
      }
      const size = box.getSize(new T.Vector3());
      Object.assign(root.userData, { kind, lod, size: size.toArray().map(v => +v.toFixed(3)), height: +box.max.y.toFixed(3) }, K.ud);
      root.userData.dispose = () => { for (const [, g] of geos) g.dispose(); };
      return root;
    },
  };
  return K;
}
// Merge indexed/non-indexed geometries with position/normal/uv/color into one indexed geometry. Disposes inputs.
function merge(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let ov = 0, oi = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, c * 3), ov * 3);
    nor.set(g.attributes.normal.array.subarray(0, c * 3), ov * 3);
    uv.set(g.attributes.uv.array.subarray(0, c * 2), ov * 2);
    col.set(g.attributes.color.array.subarray(0, c * 3), ov * 3);
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[oi + i] = a[i] + ov; oi += a.length; }
    else { for (let i = 0; i < c; i++) idx[oi + i] = ov + i; oi += c; }
    ov += c; g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3)); out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setAttribute('uv', new T.BufferAttribute(uv, 2)); out.setAttribute('color', new T.BufferAttribute(col, 3));
  out.setIndex(new T.BufferAttribute(idx, 1));
  return out;
}

// ------------------------------------------------------------------ colour functions
const ropeCol = (len, pitch = 0.035) => (c, x, y, z, u, v) => { const s = ((u * len / pitch + v * 2) % 1 + 1) % 1; c.multiplyScalar(s < 0.5 ? 1.08 : 0.78); };
const endGrain = half => (c, x) => { if (Math.abs(x) > half - 0.003) c.lerp(_c2.set(C.plankLight), 0.6).multiplyScalar(1.05); };
const _c2 = new T.Color();
const leafCol = (rib, tip = C.leafLight, ribAmt = 0.7, tipAmt = 0.45) => (c, x, y, z, u, v) => {
  c.lerp(_c2.set(tip), v * v * tipAmt);
  if (Math.abs(u - 0.5) < 0.01) c.lerp(_c2.set(rib), ribAmt);
  c.multiplyScalar(0.75 + 0.25 * smooth(0, 0.25, v));
};

// ------------------------------------------------------------------ shared sub-assemblies
function ropeWrap(K, x, y0, y1, z, r, turns, rr = 0.007) {
  const pts = [], n = Math.ceil(turns * 10);
  for (let i = 0; i <= n; i++) { const t = i / n, a = t * turns * Math.PI * 2; pts.push([x + Math.cos(a) * r, y0 + (y1 - y0) * t, z + Math.sin(a) * r]); }
  K.add(tube(pts, rr, K.seg(n * 1.2), K.lod ? 4 : 5), C.rope, { m: 'base', col: ropeCol(turns * 2 * Math.PI * r, 0.02) });
}
function lashRing(K, p, r, rot = [Math.PI / 2, 0, 0], tubeR = 0.008) {
  K.add(new T.TorusGeometry(r, tubeR, K.lod ? 4 : 5, K.seg(14)), C.rope, { p, r: rot, col: ropeCol(r * 6.3, 0.02) });
}
function frond(K, len = 0.9, droop = 0.35, pairs = 13) {
  const pts = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([0, Math.sin(t * Math.PI * 0.9) * len * 0.22 - droop * len * t * t, t * len]); }
  K.add(tube(pts, 0.012, K.seg(12), 4), C.stem, { m: 'base' });
  const curve = new T.CatmullRomCurve3(pts.map(p => V(...p)));
  const n = K.lod ? Math.ceil(pairs * 0.6) : pairs;
  for (let i = 0; i < n; i++) {
    const t = 0.12 + 0.86 * (i / (n - 1)), P = curve.getPoint(t), L = len * (0.42 - 0.3 * t * t) + 0.04, tilt = 0.35 + t * 0.5;
    for (const s of [-1, 1]) {
      const g = blade(L, 0.085 * (1 - t * 0.4), 3, 0.15, 0.25, u => Math.sin(Math.PI * Math.pow(u, 0.6)) * (1 - u * 0.5));
      K.add(g, K.r() < 0.25 ? C.leafDark : C.leaf, { m: 'leaf', p: [P.x, P.y, P.z], r: [tilt, s * (1.0 + t * 0.15), 0], col: leafCol(C.stem, C.leafLight, 0.4), jit: 0.1 });
    }
  }
}
function cropLeaf(K, at, len, wid, yaw, pitch, color, rib, droop = 0.3) {
  const stemL = len * 0.35;
  const dir = V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const end = [at[0] + dir.x * stemL, at[1] + dir.y * stemL, at[2] + dir.z * stemL];
  K.add(between(at, end, 0.006 + len * 0.02, 0.004 + len * 0.012, 4), rib, {});
  K.add(blade(len, wid, K.lod ? 3 : 5, 0.35, droop), color, { m: 'leaf', p: end, r: [-pitch * 0.85, yaw, 0], order: 'YXZ', col: leafCol(rib, C.leafLight, 0.35, 0.25), jit: 0.08 });
}
function mound(K, r) {
  K.add(new T.SphereGeometry(r, K.seg(10), 4, 0, Math.PI * 2, 0, Math.PI / 2), C.soilLight, { m: 'flat', perFace: true, s: [1, 0.28, 1], col: (c, x, y, z) => c.multiplyScalar(0.8 + hash3(x * 40, z * 40, 1) * 0.4) });
}
function beetBulb(K, y, s = 1) {
  const prof = [[0, -0.16], [0.008, -0.12], [0.03, -0.07], [0.055, -0.03], [0.062, 0.0], [0.055, 0.03], [0.03, 0.05], [0, 0.055]];
  K.add(lathe(prof.map(([r, yy]) => [r * s, yy * s]), K.seg(12)), C.beet, { m: 'plastic', p: [0, y, 0], col: (c, x, yy) => { if (yy > 0.02 * s) c.lerp(_c2.set(C.beetLight), 0.5); c.multiplyScalar(0.9 + 0.1 * Math.sin(yy * 220)); } });
}

function palmTree(K, base, segs, segH, r0, fronds, len, pairs, nuts) {
  let p = base;
  for (let i = 0; i < segs; i++) {
    const n = [p[0] + (0.03 + i * 0.008) * segH / 0.22, p[1] + segH, p[2] + 0.01 * segH / 0.22], t = r0 / 0.095;
    K.add(between(p, n, (0.095 - i * 0.007) * t, (0.075 - i * 0.007) * t, K.seg(7)), i % 2 ? C.log : C.drift, { m: 'flat', col: (c, x, y) => { if (y > n[1] - segH * 0.3) c.multiplyScalar(1.15); } });
    p = n;
  }
  const nr = 0.055 * Math.min(1, len / 0.9);
  for (let i = 0; i < nuts; i++) K.add(new T.SphereGeometry(nr, K.seg(8), K.seg(6)), 0x6b4a2a, { m: 'base', p: [p[0] + Math.cos(i * 2.1) * nr * 1.1, p[1] - nr, p[2] + Math.sin(i * 2.1) * nr * 1.1] });
  for (let i = 0; i < fronds; i++) { K.push(p, [0, i * (Math.PI * 2 / fronds) + 0.3, 0]); K.push([0, 0, 0], [-0.4 - (i % 2) * 0.3, 0, 0]); frond(K, len, 0.5, pairs); K.pop(); K.pop(); }
  return p;
}
function coconut(K, p, r = 0.07) {
  K.add(new T.IcosahedronGeometry(r, 1), 0x6b4a2a, { m: 'flat', p, s: [1, 0.85, 1.1], perFace: true, col: (c, x, y, z, u, v, f) => c.multiplyScalar(0.85 + hash3(f, 2, 5) * 0.3) });
}
function cupBody(K) {
  const prof = [[0, 0], [0.05, 0], [0.056, 0.006], [0.06, 0.04], [0.064, 0.08], [0.066, 0.1], [0.069, 0.13], [0.071, 0.15], [0.072, 0.16], [0.078, 0.165], [0.078, 0.175], [0.07, 0.175], [0.064, 0.02], [0, 0.02]];
  K.add(lathe(prof, K.seg(14)), C.teal, { m: 'plastic', col: (c, x, y) => { if (y > 0.155) c.set(C.white); else if (y > 0.085 && y < 0.105) c.multiplyScalar(0.8); } });
  // palm-leaf filter tied round the rim
  K.add(new T.TorusGeometry(0.077, 0.007, 4, K.seg(14)), C.rope, { p: [0, 0.15, 0], r: [Math.PI / 2, 0, 0], col: ropeCol(0.48, 0.02) });
}

// ------------------------------------------------------------------ model builders
const B = {
  plank(K) {
    const L = 1.0, W = 0.22, H = 0.06;
    K.add(rbox(L, H, W, 0.014, K.hero), C.plank, { m: 'wood', p: [-0.06, H / 2, 0], col: endGrain(L / 2), jit: 0.08 });
    K.add(rbox(0.2, H * 0.92, W * 0.46, 0.012, 1), C.plank, { m: 'wood', p: [L / 2 - 0.0, H * 0.46, -W * 0.26], r: [0, 0.03, 0], col: endGrain(0.1) });
    K.add(rbox(0.11, H * 0.9, W * 0.42, 0.012, 1), C.plank, { m: 'wood', p: [L / 2 - 0.04, H * 0.45, W * 0.26], r: [0, -0.02, 0], col: endGrain(0.055) });
    for (const x of [-0.48, -0.42]) K.add(cyl(0.014, 0.014, 0.012, 6), C.darkMetal, { m: 'metal', p: [x, H + 0.002, x < -0.45 ? -0.05 : 0.05] });
  },
  plastic(K) {
    // crushed bottle lying on its side
    const prof = [[0, 0], [0.075, 0], [0.092, 0.012], [0.1, 0.04], [0.1, 0.075], [0.1, 0.085], [0.1, 0.165], [0.1, 0.175], [0.1, 0.2], [0.09, 0.245], [0.05, 0.29], [0.034, 0.305], [0.034, 0.33], [0, 0.33]];
    const g = lathe(prof, K.seg(16)), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
      const d = 1 - 0.22 * Math.max(0, Math.sin(a * 3 + y * 20)) * smooth(0.02, 0.08, y) * (1 - smooth(0.2, 0.26, y));
      p.setXYZ(i, x * d, y, z * d * 0.82);
    }
    g.computeVertexNormals();
    K.push([-0.17, 0.085, 0], [0, 0, -Math.PI / 2 + 0.05]);
    K.add(g, 0xcfe4ea, { m: 'plastic', col: (c, x, y) => { if (y > 0.08 && y < 0.17) c.set(C.teal).multiplyScalar(1.05); } });
    K.add(cyl(0.04, 0.04, 0.035, K.seg(12)), C.blue, { m: 'plastic', p: [0, 0.345, 0], col: (c, x, y, z, u) => c.multiplyScalar(0.85 + 0.15 * Math.sin(u * 60)) });
    K.pop();
  },
  leaf(K) { K.push([-0.35, 0.03, 0], [0, Math.PI / 2, 0]); frond(K, 0.95, 0.2); K.pop(); },
  scrap(K) {
    const g = new T.BoxGeometry(0.5, 0.012, 0.34, K.lod ? 5 : 9, 1, K.lod ? 4 : 7), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      y += 0.05 * Math.sin(x * 5 + 0.6) + 0.06 * z * z * 4 + 0.008 * Math.cos(z * 55);
      if (Math.abs(x) > 0.24) x += (hash3(z * 9, 1, 2) - 0.5) * 0.06;
      if (Math.abs(z) > 0.16) z += (hash3(x * 9, 3, 1) - 0.5) * 0.04;
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    K.add(g, C.metal, { m: 'metalFlat', p: [0, 0.06, 0], r: [0, 0.3, 0.05], perFace: true, col: (c, x, y, z) => { const n = Math.sin(x * 13 + z * 7) + Math.sin(x * 5 - z * 17); if (n > 0.7) c.set(C.rust).multiplyScalar(0.8 + hash3(x, y, z) * 0.3); else if (n > 0.45) c.lerp(_c2.set(C.rust), 0.4); else c.multiplyScalar(0.9 + hash3(x, z, y) * 0.2); } });
    K.add(between([-0.12, 0.03, 0.18], [0.24, 0.035, 0.12], 0.03, 0.03, K.seg(8)), C.metal, { m: 'metal', col: (c, x, y, z, u) => { if (u < 0.3) c.lerp(_c2.set(C.rust), 0.7); } });
    for (const [x, z] of [[-0.15, -0.08], [0.1, 0.05]]) K.add(cyl(0.018, 0.018, 0.016, 6), C.darkMetal, { m: 'metalFlat', p: [x, 0.07 + 0.05 * Math.sin(x * 5 + 0.6), z] });
  },
  rope(K) {
    const pts = [], turns = 3.2, n = 64;
    for (let i = 0; i <= n; i++) { const t = i / n, a = t * turns * Math.PI * 2, R = 0.13 - 0.015 * Math.sin(t * 9); pts.push([Math.cos(a) * R, 0.02 + t * 0.06 + 0.012 * Math.sin(a * 2), Math.sin(a) * R]); }
    const e = pts[n]; pts.push([e[0] + 0.06, 0.05, e[2] + 0.08], [e[0] + 0.1, 0.02, e[2] + 0.2], [e[0] + 0.16, 0.018, e[2] + 0.26]);
    K.add(tube(pts, 0.018, K.seg(100), K.lod ? 4 : 6), C.rope, { col: ropeCol(2.7, 0.045) });
    for (const a of [0.4, 3.5]) lashRing(K, [Math.cos(a) * 0.13, 0.055, Math.sin(a) * 0.13], 0.045, [0, -a, 0], 0.009);
  },
  barrel(K) {
    const H = 0.78, rAt = y => 0.25 + 0.05 * Math.sin(Math.PI * y / H), seg = K.seg(14);
    const prof = [[0, 0.01], [rAt(0) - 0.02, 0], [rAt(0), 0.02]];
    for (let i = 1; i < 8; i++) { const y = (i / 8) * H; prof.push([rAt(y), y]); }
    prof.push([rAt(H), H - 0.02], [rAt(H) - 0.025, H], [rAt(H) - 0.03, H - 0.035], [0, H - 0.035]);
    K.add(lathe(prof, seg), C.plank, { m: 'wood', perFace: true, uvSwap: true, col: (c, x, y, z) => {
      const st = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * seg); c.multiplyScalar(0.84 + hash3(st, 2, 7) * 0.3);
      if (y > H - 0.03 && Math.hypot(x, z) < rAt(H) - 0.028) c.multiplyScalar(0.8);
    } });
    for (const y of [0.13, 0.33, 0.45, 0.65]) K.add(new T.TorusGeometry(rAt(y) + 0.004, 0.013, 4, seg), C.darkMetal, { m: 'metal', p: [0, y, 0], r: [Math.PI / 2, 0, 0], s: [1, 1, 1.6] });
    K.add(cyl(0.035, 0.04, 0.02, 8), C.darkWood, { m: 'wood', p: [0.11, H - 0.03, 0.05] });
    K.ud.floatY = 0.3;
  },
  hook(K) {
    // plastic grapple: rope-wrapped handle, coiled rope, 3 plastic prongs
    K.add(rbox(0.05, 0.3, 0.05, 0.02, K.hero), C.white, { m: 'plastic', p: [0, -0.02, 0] });
    ropeWrap(K, 0, -0.14, 0.08, 0, 0.03, 5.5, 0.0105);
    K.add(rbox(0.07, 0.04, 0.07, 0.016, K.bev), C.teal, { m: 'plastic', p: [0, -0.18, 0] });
    K.add(rbox(0.06, 0.04, 0.06, 0.015, K.bev), C.teal, { m: 'plastic', p: [0, 0.14, 0] });
    K.add(cyl(0.024, 0.03, 0.3, K.seg(10)), C.white, { m: 'plastic', p: [0, 0.31, 0] });
    K.add(new T.SphereGeometry(0.048, K.seg(12), K.seg(8)), C.teal, { m: 'plastic', p: [0, 0.37, 0], s: [1, 0.8, 1] });
    K.add(cyl(0.012, 0.03, 0.08, K.seg(10)), C.teal, { m: 'plastic', p: [0, 0.5, 0] });
    K.add(new T.TorusGeometry(0.03, 0.009, 5, K.seg(12)), C.white, { m: 'plastic', p: [0, 0.56, 0] });
    const prong = [[0.02, 0.36], [0.09, 0.35], [0.15, 0.39], [0.172, 0.46], [0.155, 0.525], [0.12, 0.54]];
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI * 2 / 3 + Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
      K.add(tube(prong.map(([r, y]) => [r * ca, y, r * sa]), 0.02, K.seg(12), K.lod ? 5 : 6), C.white, { m: 'plastic' });
      const tip = prong[prong.length - 1];
      K.add(along(cyl(0.004, 0.024, 0.08, K.seg(8)), [tip[0] * ca, tip[1] - 0.01, tip[0] * sa], [(tip[0] - 0.07) * ca, tip[1] - 0.035, (tip[0] - 0.07) * sa]), C.teal, { m: 'plastic' });
    }
    // rope coil hanging off the butt
    K.add(new T.TorusGeometry(0.085, 0.014, 5, K.seg(16)), C.rope, { p: [0.02, -0.29, 0], r: [0, Math.PI / 2, 0.2], col: ropeCol(0.53, 0.03) });
    K.add(new T.TorusGeometry(0.075, 0.014, 5, K.seg(16)), C.rope, { p: [0.0, -0.3, 0.01], r: [0, Math.PI / 2 - 0.3, -0.1], col: ropeCol(0.47, 0.03) });
    K.add(tube([[0, -0.2, 0], [0.01, -0.22, 0], [0.02, -0.215, 0.0]], 0.012, 6, 5), C.rope, {});
    K.ud.grip = [0, 0, 0]; K.ud.tip = [0, 0.58, 0]; K.ud.iconRot = [0, 0, -0.6];
  },
  hammer(K) {
    K.add(cyl(0.02, 0.024, 0.52, K.seg(9)), C.drift, { m: 'wood', p: [0, 0.16, 0], uvSwap: true });
    ropeWrap(K, 0, -0.08, 0.1, 0, 0.026, 8, 0.0075);
    K.add(rbox(0.075, 0.08, 0.2, 0.014, K.hero), C.metal, { m: 'metal', p: [0, 0.44, 0.0] });
    K.add(cyl(0.045, 0.042, 0.04, K.seg(10)), C.darkMetal, { m: 'metal', p: [0, 0.44, -0.11], r: [Math.PI / 2, 0, 0] });
    for (const s of [-1, 1]) K.add(rbox(0.026, 0.03, 0.13, 0.008, 1), C.darkMetal, { m: 'metal', p: [s * 0.018, 0.425, 0.15], r: [-0.45, s * 0.12, 0] });
    for (const z of [-0.035, 0.035]) lashRing(K, [0, 0.44, z], 0.053, [0, 0, 0], 0.009);
    lashRing(K, [0, 0.385, 0], 0.03, [Math.PI / 2, 0, 0], 0.009);
    K.ud.grip = [0, 0, 0]; K.ud.strikeFace = [0, 0.44, -0.13]; K.ud.iconRot = [0, 0.5, -0.7];
  },
  rod(K) {
    K.add(cyl(0.022, 0.027, 0.32, K.seg(10)), C.cork, { m: 'base', p: [0, -0.04, 0], col: (c, x, y) => c.multiplyScalar(Math.abs(Math.sin(y * 70)) > 0.92 ? 0.7 : 1) });
    K.add(new T.SphereGeometry(0.03, K.seg(10), K.seg(6)), C.darkWood, { m: 'wood', p: [0, -0.2, 0] });
    K.add(cyl(0.006, 0.019, 1.0, K.seg(8)), C.plank, { m: 'wood', p: [0, 0.62, 0], uvSwap: true, col: (c, x, y) => { if (Math.abs(y + 0.32) < 0.02 || Math.abs(y - 0.1) < 0.012) c.set(C.red); } });
    // reel
    K.add(cyl(0.045, 0.045, 0.032, K.seg(14)), C.darkMetal, { m: 'metal', p: [0, 0.2, 0.06], r: [0, 0, Math.PI / 2], col: (c, x, y, z, u, v) => { if (v > 0.2 && v < 0.8) c.set(C.teal); } });
    K.add(rbox(0.01, 0.022, 0.05, 0.004, 1), C.darkMetal, { m: 'metal', p: [0.014, 0.2, 0.03] });
    K.add(rbox(0.012, 0.06, 0.012, 0.004, 1), C.darkMetal, { m: 'metal', p: [0.025, 0.22, 0.06] });
    K.add(cyl(0.01, 0.01, 0.025, 6), C.cork, { p: [0.036, 0.245, 0.06], r: [0, 0, Math.PI / 2] });
    for (const [y, r] of [[0.42, 0.016], [0.7, 0.012], [0.95, 0.01], [1.11, 0.008]]) K.add(new T.TorusGeometry(r, 0.0025, 4, 8), C.darkMetal, { m: 'metal', p: [0, y, -0.02 - r], r: [0, Math.PI / 2, 0] });
    const tip = [0, 1.12, -0.012];
    K.add(between(tip, [0, 0.8, -0.012], 0.0018, 0.0018, 4), 0xf4f4f4, {});
    K.add(new T.SphereGeometry(0.032, K.seg(12), K.seg(8)), C.white, { m: 'plastic', p: [0, 0.78, -0.012], col: (c, x, y) => { if (y > 0) c.set(C.red); } });
    K.add(cyl(0.005, 0.005, 0.03, 4), C.white, { m: 'plastic', p: [0, 0.81, -0.012] });
    K.add(new T.TorusGeometry(0.012, 0.0025, 4, K.seg(10), Math.PI * 1.4), C.metal, { m: 'metal', p: [0, 0.72, -0.012], r: [0, 0, Math.PI] });
    K.ud.grip = [0, 0, 0]; K.ud.tip = tip; K.ud.iconRot = [0, 0, -0.75];
  },
  foundation(K) {
    for (const z of [-0.62, 0.62]) {
      K.add(cyl(0.075, 0.075, 1.96, K.seg(9), 1), C.log, { m: 'wood', p: [0, 0.075, z], r: [0, 0, Math.PI / 2], uvSwap: true, col: (c, x, y, z2, u, v) => { if (Math.abs(y) > 0.97) c.set(C.plankLight).multiplyScalar(0.9); } });
    }
    const n = 7, w = 2 / n;
    for (let i = 0; i < n; i++) {
      const x = -1 + w * (i + 0.5), t = 0.05;
      K.add(rbox(w - 0.016, t, 1.98 - K.r() * 0.04, 0.012, K.bev), C.plank, { m: 'wood', p: [x, 0.2 - t / 2 - K.r() * 0.006, (K.r() - 0.5) * 0.02], r: [(K.r() - 0.5) * 0.01, 0, 0], col: (c, xx, yy, zz) => { if (Math.abs(zz) > 0.96) c.lerp(_c2.set(C.plankLight), 0.6); }, jit: 0.12, uvSwap: true });
      for (const z of [-0.62, 0.62]) for (const dx of [-0.05, 0.05]) K.add(cyl(0.011, 0.011, 0.006, 6), C.darkMetal, { m: 'metal', p: [x + dx, 0.2, z] });
    }
    for (const z of [-0.62, 0.62]) for (const x of [-0.98, 0.98]) lashRing(K, [x * 0.97, 0.085, z], 0.085, [0, Math.PI / 2, 0], 0.012);
  },
  cropPlot(K) {
    const L = 1.0, D = 0.6, Hh = 0.3, th = 0.06;
    for (const s of [-1, 1]) {
      K.add(rbox(L, Hh - 0.04, th, 0.012, K.bev), C.plank, { m: 'wood', p: [0, (Hh - 0.04) / 2, s * (D / 2 - th / 2)], col: endGrain(L / 2), jit: 0.1 });
      K.add(rbox(D - 2 * th, Hh - 0.04, th, 0.012, K.bev), C.plank, { m: 'wood', p: [s * (L / 2 - th / 2), (Hh - 0.04) / 2, 0], r: [0, Math.PI / 2, 0], jit: 0.1 });
    }
    for (const x of [-1, 1]) for (const z of [-1, 1]) K.add(rbox(0.08, Hh, 0.08, 0.012, K.bev), C.darkWood, { m: 'wood', p: [x * (L / 2 - 0.02), Hh / 2, z * (D / 2 - 0.02)], uvSwap: true });
    const sw = L - 2 * th, sd = D - 2 * th, soilY = Hh - 0.07;
    const soil = sheet(sw, sd, K.lod ? 8 : 16, K.lod ? 5 : 9, (u, v, x, y) => 0.012 * Math.cos(y * Math.PI * 2 / 0.16) + (hash3(x * 7, y * 7, 1) - 0.5) * 0.018 + 0.012 * (1 - Math.pow(2 * Math.abs(u - 0.5), 4)));
    K.add(soil, C.soil, { m: 'flat', p: [0, soilY, 0], r: [-Math.PI / 2, 0, 0], perFace: true, col: (c, x, y, z) => { c.multiplyScalar(0.8 + hash3(x * 3, y * 3, z) * 0.35); if (z > 0.012) c.lerp(_c2.set(C.soilLight), 0.6); } });
    K.ud.soilY = soilY + 0.01; K.ud.slots = [[-0.22, soilY + 0.01, 0], [0.22, soilY + 0.01, 0]];
  },
  seed(K) {
    // palm seed: a small husked coconut with a pale sprouting eye
    coconut(K, [0, 0.05, 0], 0.06);
    K.add(new T.SphereGeometry(0.012, 6, 4), 0xe8dcc0, { m: 'base', p: [0.03, 0.09, 0.02] });
    K.ud.iconRot = [0.3, 0, 0];
  },
  sprout(K) {
    mound(K, 0.07);
    K.add(cyl(0.005, 0.007, 0.06, 5), C.stem, { p: [0, 0.04, 0] });
    for (const s of [-1, 1]) K.add(blade(0.075, 0.06, 3, 0.45, -0.1, t => Math.sin(Math.PI * Math.pow(t, 0.6))), C.leafLight, { m: 'leaf', p: [0, 0.068, 0], r: [-0.45, s * Math.PI / 2, 0], col: leafCol(C.stem, 0xc8e67a, 0.3) });
  },
  young(K) {
    mound(K, 0.1);
    for (let i = 0; i < 4; i++) cropLeaf(K, [0, 0.02, 0], 0.12 + i * 0.01, 0.085, i * 1.6 + 0.3, 1.15 - i * 0.08, 0x7cc24a, C.beetLight, 0.5);
  },
  mature(K) {
    mound(K, 0.13);
    for (let i = 0; i < 7; i++) cropLeaf(K, [0, 0.025, 0], 0.27 + K.r() * 0.05, 0.17, i * 2.4, 0.8 + K.r() * 0.4, i % 3 ? C.leaf : 0x4c9a35, C.beetLight, 0.5);
  },
  harvestable(K) {
    mound(K, 0.14);
    beetBulb(K, 0.03, 1.25);
    for (let i = 0; i < 8; i++) cropLeaf(K, [0, 0.09, 0], 0.25 + K.r() * 0.05, 0.16, i * 2.4, 0.9 + K.r() * 0.4, i % 4 ? C.leaf : 0xb8b545, C.beetLight, 0.5);
  },
  wateringCan(K) {
    const prof = [[0, 0], [0.11, 0], [0.125, 0.015], [0.125, 0.2], [0.115, 0.225], [0.085, 0.235], [0.085, 0.215], [0, 0.215]];
    K.add(lathe(prof, K.seg(16)), C.teal, { m: 'plastic', col: (c, x, y) => { if (y > 0.05 && y < 0.07) c.multiplyScalar(0.75); if (y > 0.21) c.multiplyScalar(0.8); } });
    K.add(between([-0.09, 0.05, 0], [-0.33, 0.27, 0], 0.024, 0.016, K.seg(8)), C.teal, { m: 'plastic' });
    K.add(along(cyl(0.045, 0.016, 0.06, K.seg(10)), [-0.32, 0.26, 0], [-0.36, 0.3, 0]), C.yellow, { m: 'plastic' });
    K.add(along(cyl(0.046, 0.046, 0.008, K.seg(10)), [-0.36, 0.3, 0], [-0.365, 0.305, 0]), C.yellow, { m: 'plastic', col: (c, x, y, z, u, v) => { if (y > 0.003) c.multiplyScalar(0.7); } });
    K.add(tube([[0.12, 0.17, 0], [0.16, 0.25, 0], [0.08, 0.32, 0], [-0.03, 0.29, 0], [-0.07, 0.23, 0]], 0.016, K.seg(18), K.lod ? 5 : 7), C.yellow, { m: 'plastic' });
    K.ud.grip = [0.08, 0.32, 0]; K.ud.spout = [-0.365, 0.305, 0];
  },
  lantern(K) {
    for (const r of [0, Math.PI / 2]) K.add(rbox(0.7, 0.07, 0.1, 0.015, K.bev), C.darkWood, { m: 'wood', p: [0, 0.035, 0], r: [0, r, 0] });
    K.add(rbox(0.09, 1.7, 0.09, 0.016, K.bev), C.darkWood, { m: 'wood', p: [0, 0.85, 0], uvSwap: true });
    K.add(rbox(0.55, 0.07, 0.07, 0.014, K.bev), C.darkWood, { m: 'wood', p: [0.24, 1.66, 0] });
    K.add(between([0.04, 1.42, 0], [0.24, 1.64, 0], 0.025, 0.025, 5), C.darkWood, { m: 'wood' });
    for (const y of [0.3, 1.5]) lashRing(K, [0, y, 0], 0.062, [Math.PI / 2, 0, 0], 0.012);
    K.add(between([0.44, 1.63, 0], [0.44, 1.48, 0], 0.006, 0.006, 4), C.ropeDark, {});
    K.push([0.44, 1.2, 0]);
    K.add(rbox(0.2, 0.03, 0.2, 0.01, 1), C.darkMetal, { m: 'metal', p: [0, 0, 0] });
    K.add(rbox(0.14, 0.2, 0.14, 0.03, K.bev), C.glow, { m: 'glow', p: [0, 0.12, 0], jit: 0 });
    for (const x of [-1, 1]) for (const z of [-1, 1]) K.add(rbox(0.025, 0.22, 0.025, 0.006, 1), C.darkMetal, { m: 'metal', p: [x * 0.085, 0.12, z * 0.085] });
    K.add(cyl(0.01, 0.15, 0.08, 4), C.darkMetal, { m: 'metalFlat', p: [0, 0.27, 0], r: [0, Math.PI / 4, 0] });
    K.add(new T.TorusGeometry(0.03, 0.006, 4, 10), C.darkMetal, { m: 'metal', p: [0, 0.32, 0] });
    K.pop();
    K.ud.light = [0.44, 1.32, 0];
  },
  net(K) {
    const X = 0.78, Hh = 0.95, lean = -0.3;
    for (const s of [-1, 1]) {
      K.add(rbox(0.09, Hh, 0.09, 0.015, K.bev), C.darkWood, { m: 'wood', p: [s * X, Hh / 2, 0], r: [lean, 0, 0], uvSwap: true });
      K.add(rbox(0.12, 0.06, 0.6, 0.015, K.bev), C.darkWood, { m: 'wood', p: [s * X, 0.03, -0.08] });
      K.add(between([s * X, 0.05, 0.18], [s * X, 0.45, -0.06], 0.022, 0.022, 5), C.darkWood, { m: 'wood' });
    }
    K.push([0, 0, 0], [lean, 0, 0]);
    K.add(rbox(2 * X, 0.06, 0.07, 0.015, K.bev), C.plank, { m: 'wood', p: [0, 0.12, 0] });
    K.add(between([-X, Hh - 0.06, 0], [X, Hh - 0.06, 0], 0.012, 0.012, 5), C.rope, {});
    const cols = K.lod ? 7 : 11, rows = K.lod ? 4 : 6, y0 = 0.15, y1 = Hh - 0.07;
    const pt = (i, j) => { const u = i / cols, v = j / rows; return [-X + 0.04 + u * (2 * X - 0.08), y0 + v * (y1 - y0), 0.07 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v)]; };
    for (let j = 0; j <= rows; j++) for (let i = 0; i < cols; i++) K.add(between(pt(i, j), pt(i + 1, j), 0.006, 0.006, 3), C.rope, { jit: 0.04 });
    for (let i = 0; i <= cols; i++) for (let j = 0; j < rows; j++) K.add(between(pt(i, j), pt(i, j + 1), 0.006, 0.006, 3), C.rope, { jit: 0.04 });
    for (const u of [-0.45, 0, 0.45]) K.add(new T.SphereGeometry(0.04, K.seg(8), K.seg(6)), C.orange, { m: 'plastic', p: [u, Hh - 0.06, 0], s: [1.3, 1, 1] });
    K.pop();
  },
  sail(K) {
    for (const r of [0.4, 0.4 + Math.PI / 2]) K.add(rbox(1.2, 0.08, 0.12, 0.016, K.bev), C.darkWood, { m: 'wood', p: [0, 0.04, 0], r: [0, r, 0] });
    K.add(cyl(0.045, 0.06, 3.5, K.seg(8)), C.log, { m: 'wood', p: [0, 1.75, 0], uvSwap: true });
    const yTop = 3.25, yBot = 0.95, W = 1.6;
    K.add(cyl(0.03, 0.03, W + 0.15, K.seg(7)), C.darkWood, { m: 'wood', p: [0, yTop, 0.06], r: [0, 0, Math.PI / 2] });
    K.add(cyl(0.035, 0.035, W + 0.1, K.seg(7)), C.darkWood, { m: 'wood', p: [0, yBot, 0.07], r: [0, 0, Math.PI / 2] });
    const cloth = sheet(W, yTop - yBot - 0.06, K.lod ? 6 : 12, K.lod ? 8 : 16, (u, v) => 0.32 * Math.sin(Math.PI * u) * Math.sin(Math.PI * (0.15 + 0.85 * v)));
    K.add(cloth, C.cloth, { m: 'cloth', p: [0, (yTop + yBot) / 2, 0.09], jit: 0, col: (c, x, y, z, u, v) => {
      if (Math.abs((u * 5) % 1 - 0.5) > 0.46) c.multiplyScalar(0.86);
      if (u > 0.58 && u < 0.78 && v > 0.32 && v < 0.5) c.set(C.clothPatch);
      if (v > 0.68 && v < 0.78) c.set(C.red).multiplyScalar(1.05);
    } });
    for (const s of [-1, 1]) {
      K.add(between([s * W / 2, yTop, 0.06], [s * 0.55, 0.08, 0.3], 0.006, 0.006, 3), C.ropeDark, {});
      K.add(between([s * W / 2, yBot, 0.07], [s * 0.4, 0.08, -0.3], 0.006, 0.006, 3), C.ropeDark, {});
    }
    const fl = new T.BufferGeometry(); fl.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 0, -0.16, 0, 0.32, -0.07, 0.03], 3)); fl.computeVertexNormals();
    K.add(fl, C.red, { m: 'cloth', p: [0, 3.62, 0] });
  },
  bench(K) {
    const L = 1.35;
    for (const z of [-0.1, 0.1]) K.add(rbox(L, 0.05, 0.18, 0.014, K.bev), C.plank, { m: 'wood', p: [0, 0.47, z], col: endGrain(L / 2), jit: 0.1 });
    for (const x of [-0.5, 0.5]) {
      for (const z of [-0.14, 0.14]) K.add(rbox(0.07, 0.46, 0.07, 0.014, K.bev), C.darkWood, { m: 'wood', p: [x, 0.23, z], r: [z * 0.5, 0, x * -0.06], uvSwap: true });
      K.add(rbox(0.06, 0.05, 0.36, 0.012, K.bev), C.darkWood, { m: 'wood', p: [x, 0.12, 0] });
      K.add(rbox(0.065, 0.46, 0.065, 0.014, K.bev), C.darkWood, { m: 'wood', p: [x, 0.72, 0.19], r: [-0.12, 0, 0], uvSwap: true });
      lashRing(K, [x, 0.44, 0.14], 0.05, [Math.PI / 2, 0, 0], 0.01);
    }
    K.add(rbox(L - 0.1, 0.13, 0.04, 0.014, K.bev), C.plank, { m: 'wood', p: [0, 0.82, 0.225], r: [-0.12, 0, 0], jit: 0.1 });
    K.add(rbox(1.08, 0.05, 0.05, 0.012, K.bev), C.darkWood, { m: 'wood', p: [0, 0.12, 0] });
  },
  crate(K) {
    const W = 0.85, D = 0.62, H = 0.6, ph = H / 3, t = 0.04;
    for (let i = 0; i < 3; i++) {
      const y = ph * (i + 0.5);
      for (const s of [-1, 1]) {
        K.add(rbox(W - 0.1, ph - 0.012, t, 0.01, K.bev), C.plank, { m: 'wood', p: [0, y, s * (D / 2 - t / 2)], jit: 0.12 });
        K.add(rbox(D - 0.1, ph - 0.012, t, 0.01, K.bev), C.plank, { m: 'wood', p: [s * (W / 2 - t / 2), y, 0], r: [0, Math.PI / 2, 0], jit: 0.12 });
      }
    }
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      K.add(rbox(0.075, H, 0.075, 0.012, K.bev), C.darkWood, { m: 'wood', p: [x * (W / 2 - 0.03), H / 2, z * (D / 2 - 0.03)], uvSwap: true });
      for (const y of [0.04, H - 0.04]) K.add(rbox(0.09, 0.05, 0.09, 0.01, 0), C.darkMetal, { m: 'metal', p: [x * (W / 2 - 0.03), y, z * (D / 2 - 0.03)] });
    }
    for (let i = 0; i < 4; i++) K.add(rbox(W + 0.04, 0.05, D / 4 - 0.01, 0.012, K.bev), C.plank, { m: 'wood', p: [0, H + 0.025, -D / 2 + D / 8 + i * D / 4 + 0.005], jit: 0.12, col: endGrain((W + 0.04) / 2) });
    for (const z of [-1, 1]) K.add(rbox(0.06, 0.055, D + 0.04, 0.012, K.bev), C.darkWood, { m: 'wood', p: [z * 0.3, H + 0.055, 0] });
    for (const s of [-1, 1]) K.add(new T.TorusGeometry(0.07, 0.013, 5, K.seg(12), Math.PI), C.rope, { p: [s * (W / 2 + 0.005), H * 0.62, 0], r: [0, Math.PI / 2, Math.PI], col: ropeCol(0.22, 0.02) });
  },
  palmPlanter(K) {
    const pot = [[0, 0.02], [0.2, 0], [0.24, 0.04], [0.3, 0.34], [0.34, 0.36], [0.34, 0.42], [0.3, 0.42], [0.28, 0.38], [0, 0.38]];
    K.add(lathe(pot, K.seg(14)), C.terracotta, { m: 'base', col: (c, x, y) => { if (y > 0.35) c.multiplyScalar(1.12); if (Math.abs(y - 0.2) < 0.015) c.multiplyScalar(0.8); } });
    K.add(new T.CircleGeometry(0.29, K.seg(12)), C.soil, { m: 'flat', p: [0, 0.385, 0], r: [-Math.PI / 2, 0, 0] });
    palmTree(K, [0, 0.38, 0], 6, 0.22, 0.095, 7, 0.95, 10, 3);
  },
  fish(K) {
    const prof = [[0, 0], [0.03, 0.008], [0.058, 0.04], [0.074, 0.1], [0.07, 0.17], [0.05, 0.25], [0.024, 0.31], [0.013, 0.33], [0, 0.335]];
    K.push([-0.17, 0.085, 0], [0, 0, -Math.PI / 2]);
    // after the push, local -x is up: dark back, silver flank, cream belly
    K.add(lathe(prof, K.seg(14)), 0x5f93ab, { m: 'plastic', s: [1, 1, 0.5], col: (c, x, y) => {
      if (x > 0.03) c.set(0xeee4c8); else if (x > -0.02) c.lerp(_c2.set(0xc9dbe0), 0.55); else c.multiplyScalar(0.8);
      if (x < 0 && Math.sin(y * 70) > 0.75) c.multiplyScalar(0.85);
    } });
    for (const z of [-1, 1]) {
      K.add(new T.SphereGeometry(0.014, 6, 4), 0x1b2328, { m: 'plastic', p: [-0.018, 0.045, z * 0.028] });
      K.add(blade(0.06, 0.035, 2, 0, 0), 0x4e7d92, { m: 'leaf', p: [0.03, 0.1, z * 0.03], r: [0, z * 0.5, 0], jit: 0 });
    }
    K.pop();
    const fin = (pts, color, o) => { const sh = new T.Shape(pts.map(([x, y]) => new T.Vector2(x, y))); K.add(new T.ShapeGeometry(sh), color, Object.assign({ m: 'leaf' }, o)); };
    fin([[0, 0], [0.1, 0.075], [0.075, 0], [0.1, -0.075]], 0x4e7d92, { p: [0.155, 0.085, 0], col: (c, x) => c.multiplyScalar(1 - x * 2) });
    fin([[0, 0], [0.04, 0.06], [0.12, 0]], 0x4e7d92, { p: [-0.07, 0.15, 0] });
    fin([[0, 0], [0.03, -0.035], [0.07, 0]], 0x6f9fb4, { p: [0.04, 0.025, 0] });
  },
  nails(K) {
    const at = [[0, 0, 0.3, 0], [0.04, 0.02, -0.5, 1.2], [-0.035, 0.03, 1.4, 0.4], [0.015, -0.04, 2.3, -0.2], [-0.02, -0.01, 0.9, 1.5]];
    at.forEach(([x, z, ry, rz], i) => {
      K.push([x, 0.012 + (i > 2 ? 0.02 : 0), z], [0, ry, Math.PI / 2 + rz * 0.15]);
      K.add(cyl(0.005, 0.005, 0.13, K.seg(6)), C.metal, { m: 'metal', p: [0, 0.01, 0], col: (c, xx, y) => { if (Math.sin(y * 90 + i) > 0.6) c.lerp(_c2.set(C.rust), 0.6); } });
      K.add(cyl(0.004, 0.0002, 0.025, K.seg(6)), C.metal, { m: 'metal', p: [0, -0.067, 0] });
      K.add(cyl(0.011, 0.011, 0.006, K.seg(8)), C.darkMetal, { m: 'metal', p: [0, 0.077, 0] });
      K.pop();
    });
  },
  cup(K) { cupBody(K); },
  water(K) {
    cupBody(K);
    // filled to the brim with a slightly domed, saturated blue surface so it reads apart from the empty cup in icons
    K.add(lathe([[0.0705, 0.166], [0.05, 0.171], [0, 0.173]], K.seg(14)), 0x1f86e6, { m: 'plastic', jit: 0, col: (c, x, y, z) => { const r = Math.hypot(x, z); if (r > 0.06) c.set(0x9fe0ff); else if (Math.hypot(x + 0.022, z + 0.012) < 0.016) c.lerp(_c2.set(0xffffff), 0.55); } });
  },
  planter(K) {
    // terracotta pot sized for farming-view.js (height 0.5, open top r 0.36): the view adds its own soil disc
    const pot = [[0, 0.01], [0.26, 0], [0.28, 0.03], [0.35, 0.44], [0.39, 0.45], [0.4, 0.5], [0.385, 0.52], [0.35, 0.52], [0.335, 0.47], [0, 0.47]];
    K.add(lathe(pot, K.seg(16)), C.terracotta, { m: 'base', col: (c, x, y, z) => { if (y > 0.44) c.multiplyScalar(1.12); if (Math.abs(y - 0.18) < 0.02 || Math.abs(y - 0.3) < 0.012) c.multiplyScalar(0.8); if (y < 0.48 && y > 0.46 && Math.hypot(x, z) < 0.336) c.set(C.soil); } });
    K.add(new T.TorusGeometry(0.33, 0.012, 4, K.seg(16)), C.rope, { p: [0, 0.18, 0], r: [Math.PI / 2, 0, 0], s: [1.05, 1.05, 1], col: ropeCol(2.1, 0.02) });
  },
  palmSeedling(K) {
    coconut(K, [0, 0.03, 0], 0.06);
    for (const [yaw, l] of [[0.4, 0.13], [2.6, 0.11], [4.4, 0.09]]) cropLeaf(K, [0, 0.06, 0], l, 0.05, yaw, 1.0, C.leafLight, C.stem, 0.35);
  },
  palmSprout(K) {
    coconut(K, [0.03, 0.03, 0.02], 0.065);
    K.add(cyl(0.012, 0.018, 0.12, K.seg(6)), C.stem, { p: [0, 0.07, 0] });
    for (let i = 0; i < 3; i++) { K.push([0, 0.13, 0], [0, i * 2.1 + 0.4, 0]); K.push([0, 0, 0], [-0.55 - (i % 2) * 0.25, 0, 0]); frond(K, 0.28, 0.35, 5); K.pop(); K.pop(); }
  },
  palmYoung(K) { palmTree(K, [0, 0, 0], 3, 0.15, 0.06, 5, 0.55, 7, 0); },
  palmMature(K) { palmTree(K, [0, 0, 0], 6, 0.22, 0.095, 7, 0.9, 10, 3); },
  beet(K) {
    K.push([0, 0.065, 0], [0, 0, 1.3]);
    beetBulb(K, 0, 1.15);
    for (let i = 0; i < 3; i++) K.add(between([0, 0.055, 0], [Math.cos(i * 2.1) * 0.02, 0.12, Math.sin(i * 2.1) * 0.02], 0.007, 0.006, 5), i ? C.stem : C.beetLight, {});
    K.pop();
  },
  potato(K) {
    const g = new T.IcosahedronGeometry(0.1, K.lod ? 1 : 2), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), d = 1 + 0.08 * Math.sin(x * 30 + z * 12) * Math.cos(y * 22);
      p.setXYZ(i, x * 1.35 * d, y * 0.78 * d, z * 0.95 * d);
    }
    g.computeVertexNormals();
    K.add(g, C.potato, { m: 'flat', p: [0, 0.075, 0], r: [0, 0.4, 0.1], perFace: true, col: (c, x, y, z, u, v, f) => { c.multiplyScalar(0.92 + hash3(f, 1, 3) * 0.14); if (hash3(f, 7, 2) > 0.93) c.multiplyScalar(0.55); } });
  },
};

// legacy names used by the game / item ids
// Item and farming ids used by the game resolve here, so getModel(itemKind) works for every inventory item.
export const MODEL_ALIASES = Object.freeze({
  wood: 'plank', planks: 'plank', palmLeaf: 'leaf', fishingRod: 'rod', fishingrod: 'rod', crop: 'beet', plot: 'cropPlot',
  palm: 'palmPlanter', can: 'wateringCan', wateringcan: 'wateringCan', nail: 'nails', seeds: 'seed', filterCup: 'cup', pot: 'planter',
  'palm-0': 'palmSeedling', 'palm-1': 'palmSprout', 'palm-2': 'palmYoung', 'palm-3': 'palmMature',
  seedling: 'palmSeedling', growing: 'palmYoung',
});
const ALIAS = MODEL_ALIASES;
export const hasModel = kind => !!B[ALIAS[kind] || kind];
export const MODEL_KINDS = Object.freeze(Object.keys(B));
const AO = { sail: { h: 0.5 }, lantern: { h: 0.4 }, hook: { min: 1 }, hammer: { min: 1 }, rod: { min: 1 }, net: { h: 0.3 }, sprout: { min: 0.8 }, young: { h: 0.08 }, mature: { h: 0.1 }, harvestable: { h: 0.12 }, palmSeedling: { min: 0.8 }, palmSprout: { h: 0.1 }, nails: { min: 0.85 }, cup: { min: 0.8 }, water: { min: 0.8 } };

export function buildModel(kind, { lod = 0 } = {}) {
  const k = ALIAS[kind] || kind, build = B[k];
  if (!build) return null;
  const K = kit(k, lod ? 1 : 0);
  build(K);
  return K.finish(AO[k]);
}
const cache = new Map();
export function getModel(kind, { lod = 0 } = {}) {
  const k = (ALIAS[kind] || kind) + ':' + (lod ? 1 : 0);
  if (!cache.has(k)) { const m = buildModel(kind, { lod }); if (!m) return null; cache.set(k, m); }
  const c = cache.get(k).clone();
  delete c.userData.dispose;
  return c;
}
export default buildModel;
