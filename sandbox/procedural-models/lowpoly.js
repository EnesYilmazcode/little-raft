// Procedural low-poly helpers for Little Raft. No addons: three core only.
// chamferBox      - 44-triangle bevelled box, flat normals, box-projected UVs, optional corner jitter.
// mergeColored    - merge {geometry, color, matrix} parts into one non-indexed mesh with a color attribute.
// groupToParts    - flatten an existing Group (e.g. dist/deck.js createFloor) into mergeColored parts.
// bakeGridAO      - bake ambient occlusion into vertex colours with a voxel occupancy grid + short rays.
// greyWoodTexture - one shared grayscale grain map; vertex colour supplies the tint.
// boxLOD          - cheap far level: one coloured box per part bounding box.
import * as T from '../../dist/vendor/three.module.js';

export function makeRng(seed = 1) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Bevelled box: 6 inset faces, 12 chamfer strips, 8 corner triangles (44 tris).
// Corner points are shared, so jitter keeps the solid watertight.
export function chamferBox(w, h, d, c = 0.01, {jitter = 0, rand = Math.random, uvScale = 1} = {}) {
  const H = [w / 2, h / 2, d / 2];
  c = Math.min(c, H[0] * 0.9, H[1] * 0.9, H[2] * 0.9);
  const V = new Map();
  const P = (s, a) => {
    const k = s.join() + a;
    if (!V.has(k)) V.set(k, s.map((sv, i) => sv * (i === a ? H[i] : H[i] - c) + (jitter ? (rand() - 0.5) * jitter : 0)));
    return V.get(k);
  };
  const tris = [], quad = (a, b, c2, e) => tris.push([a, b, c2], [a, c2, e]);
  const S = [-1, 1], sgn = (a, va, b, vb, c2, vc) => { const s = [0, 0, 0]; s[a] = va; s[b] = vb; s[c2] = vc; return s; };
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, e = (a + 2) % 3;
    for (const sa of S) quad(P(sgn(a, sa, b, -1, e, -1), a), P(sgn(a, sa, b, 1, e, -1), a), P(sgn(a, sa, b, 1, e, 1), a), P(sgn(a, sa, b, -1, e, 1), a));
    for (const sb of S) for (const se of S) {
      const s0 = sgn(a, -1, b, sb, e, se), s1 = sgn(a, 1, b, sb, e, se);
      quad(P(s0, b), P(s1, b), P(s1, e), P(s0, e));
    }
  }
  for (const x of S) for (const y of S) for (const z of S) tris.push([P([x, y, z], 0), P([x, y, z], 1), P([x, y, z], 2)]);

  const pos = new Float32Array(tris.length * 9), nor = new Float32Array(tris.length * 9), uv = new Float32Array(tris.length * 6);
  const A = new T.Vector3(), B = new T.Vector3(), C = new T.Vector3(), N = new T.Vector3(), M = new T.Vector3();
  tris.forEach((t, i) => {
    A.fromArray(t[0]); B.fromArray(t[1]); C.fromArray(t[2]);
    N.subVectors(C, B).cross(M.subVectors(A, B)).normalize();
    M.copy(A).add(B).add(C);
    if (N.dot(M) < 0) { const tmp = t[1]; t[1] = t[2]; t[2] = tmp; N.negate(); } // convex: face away from centre
    const ax = Math.abs(N.x) > Math.abs(N.y) ? (Math.abs(N.x) > Math.abs(N.z) ? 0 : 2) : (Math.abs(N.y) > Math.abs(N.z) ? 1 : 2);
    for (let k = 0; k < 3; k++) {
      pos.set(t[k], i * 9 + k * 3); N.toArray(nor, i * 9 + k * 3);
      const p = t[k], u = ax === 0 ? p[2] : p[0], v = ax === 1 ? p[2] : p[1];
      uv[i * 6 + k * 2] = u * uvScale; uv[i * 6 + k * 2 + 1] = v * uvScale;
    }
  });
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.BufferAttribute(nor, 3));
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  return g;
}

// parts: [{geometry, color: THREE.Color (linear), matrix?: Matrix4}] -> one non-indexed geometry.
export function mergeColored(parts) {
  const flat = parts.map(p => {
    let g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone();
    if (p.matrix) g.applyMatrix4(p.matrix);
    return {g, color: p.color};
  });
  const count = flat.reduce((n, f) => n + f.g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2), col = new Float32Array(count * 3);
  let o = 0;
  for (const {g, color} of flat) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    const src = g.attributes.color;
    for (let i = 0; i < n; i++) {
      const m = src ? [src.getX(i), src.getY(i), src.getZ(i)] : [1, 1, 1];
      col[(o + i) * 3] = color.r * m[0]; col[(o + i) * 3 + 1] = color.g * m[1]; col[(o + i) * 3 + 2] = color.b * m[2];
    }
    o += n; g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setAttribute('uv', new T.BufferAttribute(uv, 2));
  out.setAttribute('color', new T.BufferAttribute(col, 3));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

// Flatten every mesh under root into parts expressed in root's local space.
export function groupToParts(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), parts = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    parts.push({geometry: o.geometry, color: m.color.clone(), matrix: inv.clone().multiply(o.matrixWorld)});
  });
  return parts;
}

// Fibonacci hemisphere, cosine weighted, around +Z.
function hemisphere(n) {
  const dirs = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n), phi = i * 2.399963;
    dirs.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - r * r)]);
  }
  return dirs;
}

// Bake AO into geometry.attributes.color (multiplies existing colours).
// The occupancy grid is built from surface samples, so it works on any triangle soup,
// including merged geometry where per-part bounding boxes would be useless.
export function bakeGridAO(geo, {cell = 0.012, radius = 0.14, rays = 14, strength = 0.8, floorY = null, floorWeight = 0.5} = {}) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, n = pos.count;
  geo.computeBoundingBox();
  const bb = geo.boundingBox.clone().expandByScalar(radius + cell);
  const nx = Math.ceil((bb.max.x - bb.min.x) / cell), ny = Math.ceil((bb.max.y - bb.min.y) / cell), nz = Math.ceil((bb.max.z - bb.min.z) / cell);
  const grid = new Uint8Array(nx * ny * nz);
  const idx = (x, y, z) => {
    const i = Math.floor((x - bb.min.x) / cell), j = Math.floor((y - bb.min.y) / cell), k = Math.floor((z - bb.min.z) / cell);
    return (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? -1 : i + nx * (j + ny * k);
  };
  // Rasterise triangles by barycentric sampling at half-cell spacing.
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), p = new T.Vector3();
  for (let t = 0; t < n; t += 3) {
    a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); c.fromBufferAttribute(pos, t + 2);
    const s = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (cell * 0.5)));
    for (let i = 0; i <= s; i++) for (let j = 0; j <= s - i; j++) {
      const u = i / s, v = j / s;
      p.set(0, 0, 0).addScaledVector(a, 1 - u - v).addScaledVector(b, u).addScaledVector(c, v);
      const g = idx(p.x, p.y, p.z); if (g >= 0) grid[g] = 1;
    }
  }
  const dirs = hemisphere(rays), steps = Math.ceil(radius / (cell * 0.75));
  if (!geo.attributes.color) geo.setAttribute('color', new T.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  const col = geo.attributes.color, cache = new Map();
  const N = new T.Vector3(), U = new T.Vector3(), W = new T.Vector3(), D = new T.Vector3(), O = new T.Vector3();
  for (let v = 0; v < n; v++) {
    p.fromBufferAttribute(pos, v); N.fromBufferAttribute(nor, v);
    const key = `${Math.round(p.x * 2000)},${Math.round(p.y * 2000)},${Math.round(p.z * 2000)},${Math.round(N.x * 8)},${Math.round(N.y * 8)},${Math.round(N.z * 8)}`;
    let ao = cache.get(key);
    if (ao === undefined) {
      U.set(Math.abs(N.x) < 0.9 ? 1 : 0, Math.abs(N.x) < 0.9 ? 0 : 1, 0).cross(N).normalize(); W.crossVectors(N, U);
      O.copy(p).addScaledVector(N, cell * 1.75); // leave our own surface cell
      let occ = 0;
      for (const [dx, dy, dz] of dirs) {
        D.set(0, 0, 0).addScaledVector(U, dx).addScaledVector(W, dy).addScaledVector(N, dz);
        for (let s = 1; s <= steps; s++) {
          const t = s * cell * 0.75, x = O.x + D.x * t, y = O.y + D.y * t, z = O.z + D.z * t;
          if (floorY !== null && y < floorY) { occ += floorWeight * (1 - t / radius); break; }
          const g = idx(x, y, z);
          if (g >= 0 && grid[g]) { occ += 1 - 0.5 * t / radius; break; }
        }
      }
      ao = 1 - strength * occ / rays;
      cache.set(key, ao);
    }
    col.setXYZ(v, col.getX(v) * ao, col.getY(v) * ao, col.getZ(v) * ao);
  }
  col.needsUpdate = true;
  return {cells: nx * ny * nz, vertices: n, unique: cache.size};
}

// One grayscale grain map for all timber; mean ~0.9 so the vertex tint stays readable.
let woodTex = null;
export function greyWoodTexture() {
  if (woodTex) return woodTex;
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 512;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#f2f2f2'; ctx.fillRect(0, 0, 128, 512);
  const r = makeRng(1947);
  for (let i = 0; i < 110; i++) {
    const x = r() * 128, y = r() * 512, len = 30 + r() * 430;
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(255,255,255,.35)' : 'rgba(40,40,40,.14)'; ctx.lineWidth = 0.35 + r() * 1.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + r() * 6 - 3, y + len * 0.3, x + r() * 9 - 4, y + len * 0.7, x + r() * 5 - 2, y + len); ctx.stroke();
  }
  for (let k = 0; k < 3; k++) {
    const x = 20 + r() * 88, y = 40 + r() * 430;
    for (let q = 1; q < 6; q++) { ctx.beginPath(); ctx.ellipse(x, y, q * 1.4, q * 4.7, 0.1, 0, Math.PI * 2); ctx.strokeStyle = `rgba(40,40,40,${0.2 - q * 0.025})`; ctx.lineWidth = 0.7; ctx.stroke(); }
  }
  woodTex = new T.CanvasTexture(cv); woodTex.colorSpace = T.SRGBColorSpace; woodTex.anisotropy = 4;
  woodTex.wrapS = woodTex.wrapT = T.RepeatWrapping;
  return woodTex;
}

// Far LOD: one coloured box per part's bounding box (12 tris each), merged.
export function boxLOD(parts) {
  const box = new T.BoxGeometry(1, 1, 1), bb = new T.Box3(), size = new T.Vector3(), ctr = new T.Vector3(), out = [];
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    bb.copy(p.geometry.boundingBox).applyMatrix4(p.matrix || new T.Matrix4());
    bb.getSize(size); bb.getCenter(ctr);
    out.push({geometry: box, color: p.color, matrix: new T.Matrix4().compose(ctr, new T.Quaternion(), size.max(new T.Vector3(0.002, 0.002, 0.002)))});
  }
  const g = mergeColored(out); box.dispose(); return g;
}
