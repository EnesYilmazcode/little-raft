// Little Raft low-poly prop kit + props. ES module, NO imports: pass THREE in as T (dist convention).
// Copy this file verbatim to dist/ (see docs/tech/procedural-models-ADOPT.md).
//
// Style: flat-shaded facets, vertex colours only (no textures), chamfered edges, hash-based
// watertight jitter, one merged geometry per object and per material, a handful of SHARED materials.
//
// Drop-in exports (same signatures / return contracts as the current dist builders):
//   createDebris(T, type, getMaterial?, opts?)  'wood' | 'leaf' | 'scrap' | 'barrel'   (dist/debris.js)
//   createPlastic(T)                                                               (dist/plastic.js)
//   createCraft(T, type)  'sail' | 'palm' | 'lantern' | 'net' | 'bench' | 'crate'      (dist/crafts.js)
//   createFloor(T, index, getMaterial?), FLOOR_TOP, FLOOR_BOUNDS                    (dist/deck.js)
// Extra: lowpoly(T) -> kit, createProp(T, name, opts) for galleries, PALETTE.
//
// Materials are shared module-wide and flagged material.userData.shared = true. Callers must not dispose
// them (game.js disposeGeometry needs a one-line skip, see ADOPT). Geometry is created per call and owned
// by the returned group (dispose freely).

export const PALETTE = Object.freeze({
  woodPale: '#e8b872', woodLight: '#cfa067', woodMid: '#b07e50', woodDark: '#8f5630', woodDeep: '#653d24',
  woodEnd: '#e8c48c', drift: '#c4ad8a', bark: '#7c5a3c', barkDark: '#5d4029', barkLight: '#a07a50',
  rope: '#dcc28a', ropeDark: '#a98c58',
  leafDeep: '#3f7f3a', leaf: '#5fa548', leafLight: '#9cc957', leafTip: '#c4d667', stem: '#8d8a3f',
  steel: '#93a8b1', steelDark: '#5d6d75', iron: '#3f4649', rust: '#a9552b', rustDark: '#74391d', rustLight: '#c27d50',
  jug: '#f2eee2', jugGrime: '#d8d2bb', label: '#8cc6e8', cap: '#3c7fd6', capDark: '#2a5fa8',
  canvas: '#f1e6c8', canvasStain: '#d9c69e', stripe: '#d95a3c', patch: '#cfa56c',
  clay: '#cf7649', clayDark: '#9c4c2e', clayLight: '#e7a274', soil: '#5c3e2b', pebble: '#a39d90',
  brass: '#d8a944', glass: '#ffd890', flame: '#fff1b8', flameCore: '#ffb347', candle: '#f4ead2',
  float: '#e8643a', floatLight: '#f4a06a',
});

const KITS = new WeakMap();

function mulberry(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function seedOf(v) { let h = 2166136261 >>> 0; const s = String(v ?? 0); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
function hash4(a, b, c, d) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1) ^ Math.imul(d | 0, 0x85ebca77);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const TWIST = [1.16, 0.96, 0.74];

// ================================================================== KIT
export function lowpoly(T) {
  if (KITS.has(T)) return KITS.get(T);
  const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  const UP = V(0, 1, 0);
  const C = c => (c && c.isColor ? c : new T.Color(PALETTE[c] ?? c));
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _s = new T.Vector3(), _p = new T.Vector3();

  // positions-only, non-indexed
  const flat = g => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'bev') n.deleteAttribute(k);
    n.clearGroups();
    return n;
  };
  const fromArray = arr => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(arr, 3)); return g; };

  // ---------- primitives (all centred on origin unless noted)
  // Chamfered box: 6 inset faces, 12 bevel strips, 8 corner tris = 44 tris.
  function box(w, h, d, bevel) {
    const c0 = bevel ?? Math.min(0.03, Math.min(w, h, d) * 0.18);
    if (c0 <= 0) return flat(new T.BoxGeometry(w, h, d));
    const H = [w / 2, h / 2, d / 2], c = Math.min(c0, H[0] * 0.9, H[1] * 0.9, H[2] * 0.9);
    const Vm = new Map();
    const P = (s, a) => { const k = s.join() + a; if (!Vm.has(k)) Vm.set(k, s.map((sv, i) => sv * (i === a ? H[i] : H[i] - c))); return Vm.get(k); };
    const tris = [], quad = (a, b, c2, e) => tris.push([a, b, c2], [a, c2, e]);
    const S = [-1, 1], sg = (a, va, b, vb, c2, vc) => { const s = [0, 0, 0]; s[a] = va; s[b] = vb; s[c2] = vc; return s; };
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3, e = (a + 2) % 3;
      for (const sa of S) quad(P(sg(a, sa, b, -1, e, -1), a), P(sg(a, sa, b, 1, e, -1), a), P(sg(a, sa, b, 1, e, 1), a), P(sg(a, sa, b, -1, e, 1), a));
      for (const sb of S) for (const se of S) { const s0 = sg(a, -1, b, sb, e, se), s1 = sg(a, 1, b, sb, e, se); quad(P(s0, b), P(s1, b), P(s1, e), P(s0, e)); }
    }
    for (const x of S) for (const y of S) for (const z of S) tris.push([P([x, y, z], 0), P([x, y, z], 1), P([x, y, z], 2)]);
    const out = [], bev = [];
    tris.forEach((t, ti) => bev.push(...(ti >= 36 || ti % 12 >= 4 ? [1, 1, 1] : [0, 0, 0])));
    for (const t of tris) {
      const [a, b, cc] = t;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = cc[0] - a[0], vy = cc[1] - a[1], vz = cc[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const mx = a[0] + b[0] + cc[0], my = a[1] + b[1] + cc[1], mz = a[2] + b[2] + cc[2];
      if (nx * mx + ny * my + nz * mz < 0) out.push(...a, ...cc, ...b); else out.push(...a, ...b, ...cc);
    }
    const g = fromArray(out); g.setAttribute('bev', new T.Float32BufferAttribute(bev, 1));
    return g;
  }
  // Lathe from [[r,y],...] bottom->top (faces outward). phase rotates so a flat faces +z.
  function lathe(pts, seg = 8, phase = 0.5) {
    return flat(new T.LatheGeometry(pts.map(([r, y]) => new T.Vector2(Math.max(r, 0), y)), seg, Math.PI * 2 * phase / seg));
  }
  // Capped, optionally bevelled, tapered cylinder along Y.
  function cyl(rt, rb, h, seg = 8, bevel = 0) {
    const y0 = -h / 2, y1 = h / 2, b = Math.min(bevel, h * 0.3, Math.min(rt, rb) * 0.5);
    const pts = b > 0 ? [[0, y0], [rb - b, y0], [rb, y0 + b], [rt, y1 - b], [rt - b, y1], [0, y1]] : [[0, y0], [rb, y0], [rt, y1], [0, y1]];
    return lathe(pts, seg);
  }
  const ico = (r, detail = 0) => flat(new T.IcosahedronGeometry(r, detail));
  const octa = r => flat(new T.OctahedronGeometry(r, 0));
  const cone = (r, h, seg = 6) => lathe([[0, -h / 2], [r, -h / 2], [0, h / 2]], seg);
  const torus = (R, r, radial = 4, tubular = 10, arc = Math.PI * 2) => flat(new T.TorusGeometry(R, r, radial, tubular, arc));
  function tube(pts, r, radial = 4, segs) {
    const curve = pts.length === 2 ? new T.LineCurve3(pts[0], pts[1]) : new T.CatmullRomCurve3(pts);
    return flat(new T.TubeGeometry(curve, segs ?? (pts.length === 2 ? 1 : pts.length * 2), r, radial, false));
  }
  // Leaf blade along +x from origin: V-folded strip, optional serrated edge. Single layer (use cloth material).
  function blade(len, wid, { segs = 3, fold = 0.35, droop = 0.25, taper = 1, serrate = 0, curl = 0 } = {}) {
    const out = [], rows = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, w = wid * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.88)), 0.7) * (1 - 0.4 * t * taper) * (i === segs ? 0 : 1);
      const x = len * t, y = -droop * len * t * t, z = curl * len * t * t;
      const s = serrate && i > 0 && i < segs ? (i % 2 ? 1 + serrate : 1 - serrate * 0.5) : 1;
      rows.push([[x, y + fold * w, z + w * s], [x, y, z], [x, y + fold * w, z - w * s]]);
    }
    for (let i = 0; i < segs; i++) {
      const [l0, m0, r0] = rows[i], [l1, m1, r1] = rows[i + 1];
      if (i === segs - 1) { out.push(...l0, ...m0, ...m1, ...m0, ...r0, ...m1); continue; }
      out.push(...l0, ...m0, ...m1, ...l0, ...m1, ...l1, ...m0, ...r0, ...r1, ...m0, ...r1, ...m1);
    }
    return fromArray(out);
  }
  // Grid sheet in XZ (nx x nz quads), fn(x, z, i, j) -> [x, y, z]. Single layer.
  function sheet(w, d, nx, nz, fn) {
    const P = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = -w / 2 + w * i / nx, z = -d / 2 + d * j / nz; P.push(fn ? fn(x, z, i, j) : [x, 0, z]); }
    const out = [], at = (i, j) => P[j * (nx + 1) + i];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), e = at(i, j + 1);
      if ((i + j) % 2) out.push(...a, ...e, ...c, ...a, ...c, ...b); else out.push(...a, ...e, ...b, ...b, ...e, ...c);
    }
    return fromArray(out);
  }

  // ---------- transforms / deformers
  function xf(g, at = [0, 0, 0], rot = [0, 0, 0], scale = 1) {
    const sc = Array.isArray(scale) ? scale : [scale, scale, scale];
    _m.compose(_p.set(at[0], at[1], at[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])), _s.set(sc[0], sc[1], sc[2]));
    return g.applyMatrix4(_m);
  }
  // geometry built along +Y, centred -> spans a..b
  function along(g, a, b) {
    const d = V().subVectors(b, a), len = d.length() || 1;
    _q.setFromUnitVectors(UP, d.divideScalar(len));
    _m.compose(V().addVectors(a, b).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
    return g.applyMatrix4(_m);
  }
  // Watertight jitter: offset is a hash of the (quantised) position, so coincident verts move together.
  function jitter(g, amt, seed = 1, axes = [1, 1, 1]) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const kx = Math.round(x * 4096), ky = Math.round(y * 4096), kz = Math.round(z * 4096);
      p.setXYZ(i, x + (hash4(kx, ky, kz, seed) - 0.5) * amt * axes[0], y + (hash4(ky, kz, kx, seed + 7) - 0.5) * amt * axes[1], z + (hash4(kz, kx, ky, seed + 13) - 0.5) * amt * axes[2]);
    }
    return g;
  }
  // chamfered box spanning a..b (w across x, d across z before orienting)
  const beam = (w, d, a, b, bevel) => along(box(w, a.distanceTo(b), d, bevel), a, b);
  function warp(g, fn) { const p = g.attributes.position, v = V(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v); p.setXYZ(i, v.x, v.y, v.z); } return g; }

  // ---------- parts -> one merged, vertex-coloured, flat-normal geometry
  function parts() {
    const list = [], occl = [];
    let id = 0;
    const A = V(), B = V(), Cc = V(), N = V(), M = V(), col = new T.Color(), base = new T.Color();
    // Cheap baked contact AO: each vertex is darkened by nearby occluder boxes of OTHER parts that lie in front
    // of its normal (cosine-weighted, quadratic falloff over radius R). O(verts x occluders), a few ms per object.
    function contactAO(pos, nor, cl, ranges, K, R) {
      const L = V(), Q = V(), D = V();
      for (let pi = 0; pi < ranges.length - 1; pi++) for (let v = ranges[pi]; v < ranges[pi + 1]; v++) {
        const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
        let acc = 0;
        for (let j = 0; j < occl.length; j++) {
          const ob = occl[j];
          if (!ob || j === pi) continue;
          const w = ob.wb;
          if (px < w.min.x - R || px > w.max.x + R || py < w.min.y - R || py > w.max.y + R || pz < w.min.z - R || pz > w.max.z + R) continue;
          L.set(px, py, pz).applyMatrix4(ob.inv);
          Q.copy(L).clamp(ob.lmin, ob.lmax).applyMatrix4(ob.m);
          D.set(Q.x - px, Q.y - py, Q.z - pz);
          const d = D.length();
          if (d > R) continue;
          const c = d < 1e-4 ? 0.5 : (D.x * nor[v * 3] + D.y * nor[v * 3 + 1] + D.z * nor[v * 3 + 2]) / d;
          if (c <= 0) continue;
          const fall = 1 - d / R;
          acc += c * fall * fall;
        }
        const f = 1 - K * Math.min(1, acc);
        cl[v * 3] *= f; cl[v * 3 + 1] *= f; cl[v * 3 + 2] *= f;
      }
    }
    const api = {
      count: () => list.length,
      // o: at, rot, scale, from/to (along), jitter, seed, tint (facet variance), paint(color, centroid, normal, triIndex)
      add(g, color, o = {}) {
        g = flat(g);
        const seed = o.seed ?? (id * 977 + 31);
        if (o.jitter) jitter(g, o.jitter, seed);
        // Occluder for contact AO: an oriented box (local bbox + the transform applied below). Chamfered boxes
        // occlude by default; anything else opts in with o.occlude.
        const occ = o.occlude ?? !!g.attributes.bev;
        let ob = null;
        if (occ) { g.computeBoundingBox(); ob = { lmin: g.boundingBox.min.clone(), lmax: g.boundingBox.max.clone(), m: new T.Matrix4() }; }
        if (o.from) { along(g, o.from, o.to); if (ob) ob.m.copy(_m); }
        else if (o.at || o.rot || o.scale) { xf(g, o.at, o.rot, o.scale); if (ob) ob.m.copy(_m); }
        const p = g.attributes.position, n = p.count, arr = new Float32Array(n * 3), tint = o.tint ?? 0.06;
        base.copy(C(color));
        // Paint per quad (consecutive triangle pair) so quads never checker; per triangle if the count is odd.
        const tris = n / 3, step = tris % 2 === 0 && o.pairs !== false ? 2 : 1, bev = g.attributes.bev, edge = o.edge ?? 0.1;
        const N2 = V(), D = V();
        for (let t0 = 0; t0 < tris; t0 += step) {
          let best = -1; M.set(0, 0, 0);
          for (let s2 = 0; s2 < step; s2++) {
            const v = (t0 + s2) * 3;
            A.fromBufferAttribute(p, v); B.fromBufferAttribute(p, v + 1); Cc.fromBufferAttribute(p, v + 2);
            N2.subVectors(Cc, B).cross(D.subVectors(A, B));
            const L = N2.length(); if (L > best) { best = L; N.copy(N2).divideScalar(L || 1); }
            M.add(A).add(B).add(Cc);
          }
          M.divideScalar(3 * step);
          col.copy(base);
          if (o.paint) o.paint(col, M, N, t0);
          const k = hash4(Math.round(N.x * 4), Math.round(N.y * 4), Math.round(N.z * 4), seed + (o.facetPos ? Math.round(M.x * 20) * 31 + Math.round(M.y * 20) * 17 + Math.round(M.z * 20) : 0));
          let f = 1 + (k - 0.5) * 2 * tint;
          if (bev && bev.getX(t0 * 3) > 0.5) f *= 1 + edge;
          // rope twist: quads in a ring of o.twist, shaded in a 3-step spiral so the strand reads as laid rope
          if (o.twist) { const q = t0 / step; f *= TWIST[((q % o.twist) + Math.floor(q / o.twist)) % 3]; }
          for (let q = t0 * 3; q < (t0 + step) * 3; q++) { arr[q * 3] = col.r * f; arr[q * 3 + 1] = col.g * f; arr[q * 3 + 2] = col.b * f; }
          // per-vertex paint (smooth gradients across facets, e.g. rust creeping in from edges)
          if (o.vpaint) for (let q = t0 * 3; q < (t0 + step) * 3; q++) {
            A.fromBufferAttribute(p, q); col.setRGB(arr[q * 3], arr[q * 3 + 1], arr[q * 3 + 2]);
            o.vpaint(col, A, N); arr[q * 3] = col.r; arr[q * 3 + 1] = col.g; arr[q * 3 + 2] = col.b;
          }
        }
        g.setAttribute('color', new T.BufferAttribute(arr, 3));
        g.userData.alpha = o.alpha ?? 1; g.userData.smooth = !!o.smooth;
        if (ob) { ob.inv = ob.m.clone().invert(); ob.wb = new T.Box3(ob.lmin, ob.lmax).applyMatrix4(ob.m); }
        list.push(g); occl.push(ob); id++;
        return api;
      },
      // ao: {y0, y1, lo} vertical occlusion gradient + darker down-facing faces
      build(ao) {
        if (!list.length) return null;
        // drop zero-area triangles (lathe/cone caps collapse onto the axis): invisible, but they cost vertices
        const keep = list.map(g => {
          const a = g.attributes.position.array, k = new Uint8Array(a.length / 9);
          for (let t = 0; t < k.length; t++) {
            const o = t * 9, ux = a[o + 3] - a[o], uy = a[o + 4] - a[o + 1], uz = a[o + 5] - a[o + 2], vx = a[o + 6] - a[o], vy = a[o + 7] - a[o + 1], vz = a[o + 8] - a[o + 2];
            const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
            k[t] = cx * cx + cy * cy + cz * cz > 1e-16 ? 1 : 0;
          }
          return k;
        });
        let count = 0; for (const k of keep) for (let t = 0; t < k.length; t++) count += k[t] * 3;
        const pos = new Float32Array(count * 3), cl = new Float32Array(count * 3);
        let off = 0;
        const ranges = [], alphas = list.map(g => g.userData.alpha), smooth = list.map(g => g.userData.smooth);
        list.forEach((g, gi) => {
          ranges.push(off);
          const pa = g.attributes.position.array, ca = g.attributes.color.array, k = keep[gi];
          for (let t = 0; t < k.length; t++) if (k[t]) { pos.set(pa.subarray(t * 9, t * 9 + 9), off * 3); cl.set(ca.subarray(t * 9, t * 9 + 9), off * 3); off += 3; }
          g.dispose();
        });
        ranges.push(off);
        list.length = 0;
        const out = new T.BufferGeometry();
        out.setAttribute('position', new T.BufferAttribute(pos, 3));
        out.setAttribute('normal', new T.BufferAttribute(new Float32Array(count * 3), 3));
        out.setAttribute('color', new T.BufferAttribute(cl, 3));
        out.computeVertexNormals();
        // smooth-shaded parts (sail canvas): average the flat normals of coincident vertices within the part
        for (let pi = 0; pi < smooth.length; pi++) if (smooth[pi]) {
          const nor = out.attributes.normal.array, acc = new Map(), key = v => Math.round(pos[v * 3] * 4096) + ',' + Math.round(pos[v * 3 + 1] * 4096) + ',' + Math.round(pos[v * 3 + 2] * 4096);
          for (let v = ranges[pi]; v < ranges[pi + 1]; v++) { const kk = key(v); let s = acc.get(kk); if (!s) acc.set(kk, s = [0, 0, 0]); s[0] += nor[v * 3]; s[1] += nor[v * 3 + 1]; s[2] += nor[v * 3 + 2]; }
          for (let v = ranges[pi]; v < ranges[pi + 1]; v++) { const s = acc.get(key(v)), l = Math.hypot(s[0], s[1], s[2]) || 1; nor[v * 3] = s[0] / l; nor[v * 3 + 1] = s[1] / l; nor[v * 3 + 2] = s[2] / l; }
        }
        if (ao && ao.contact) contactAO(pos, out.attributes.normal.array, cl, ranges, ao.contact, ao.radius ?? 0.07);
        occl.length = 0;
        if (ao) {
          const nor = out.attributes.normal.array, lo = ao.lo ?? 0.62, y0 = ao.y0 ?? 0, h = Math.max(1e-4, (ao.y1 ?? 1) - y0), down = ao.down ?? 0.8;
          for (let i = 0; i < count; i++) {
            const t = clamp01((pos[i * 3 + 1] - y0) / h);
            let f = lo + (1 - lo) * Math.sqrt(t);
            if (nor[i * 3 + 1] < -0.5) f *= down;
            cl[i * 3] *= f; cl[i * 3 + 1] *= f; cl[i * 3 + 2] *= f;
          }
        }
        if (alphas.some(a => a < 1)) { // RGBA vertex colours (material needs vertexColors + transparent)
          const rgba = new Float32Array(count * 4);
          for (let pi = 0; pi < alphas.length; pi++) for (let v = ranges[pi]; v < ranges[pi + 1]; v++) { rgba[v * 4] = cl[v * 3]; rgba[v * 4 + 1] = cl[v * 3 + 1]; rgba[v * 4 + 2] = cl[v * 3 + 2]; rgba[v * 4 + 3] = alphas[pi]; }
          out.setAttribute('color', new T.BufferAttribute(rgba, 4));
        }
        out.computeBoundingBox(); out.computeBoundingSphere();
        return out;
      },
    };
    return api;
  }

  // ---------- shared materials (never disposed by props; flagged userData.shared)
  const share = m => { m.userData.shared = true; return m; };
  const materials = {
    solid: share(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0 })),
    cloth: share(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: T.DoubleSide })),
    // Unlit, translucent via vertex alpha: candle + flame (alpha 1) are drawn first, then the front faces of the
    // glowing panes blend over them. One draw call for the whole lit part of a lantern.
    glow: share(new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, depthWrite: false })),
  };
  materials.solid.name = 'lp-solid'; materials.cloth.name = 'lp-cloth'; materials.glow.name = 'lp-glow';

  function mesh(parent, geo, matKey, name) {
    if (!geo) return null;
    const m = new T.Mesh(geo, materials[matKey]);
    m.name = name || matKey;
    const glass = matKey === 'glow';
    m.castShadow = !glass; m.receiveShadow = !glass;
    if (glass) m.userData.glass = true;
    parent.add(m);
    return m;
  }

  const kit = { V, UP, C, flat, box, beam, lathe, cyl, ico, octa, cone, torus, tube, blade, sheet, xf, along, jitter, warp, parts, materials, mesh, rng: mulberry, seedOf, hash4 };
  KITS.set(T, kit);
  return kit;
}

// ================================================================== shared painters
const mixInto = (T, c, hex, k) => c.lerp(new T.Color(PALETTE[hex] ?? hex), k);
// End grain lighter, top a touch lighter: reads as "cut timber" at any size.
function timberPaint(T, axis = 'x', endHex = 'woodEnd') {
  const end = new T.Color(PALETTE[endHex]);
  const ai = axis === 'x' ? 'x' : axis === 'y' ? 'y' : 'z';
  return (c, m, n) => { if (Math.abs(n[ai]) > 0.85) c.lerp(end, 0.55); else if (n.y > 0.85) c.multiplyScalar(1.06); };
}
// n plank colours on a narrow woodMid -> woodLight ramp, shuffled deterministically by seed
function calmTones(T, n, seed) {
  const a = new T.Color(PALETTE.woodMid), b = new T.Color(PALETTE.woodLight), r = mulberry(seed);
  return Array.from({ length: n }, (_, i) => a.clone().lerp(b, 0.3 + 0.55 * ((i * 0.618 + r()) % 1)));
}
function nail(K, P, x, y, z, rot = [0, 0, 0]) { P.add(K.box(0.02, 0.01, 0.02, 0), 'iron', { at: [x, y, z], rot, tint: 0, occlude: false }); }

// ================================================================== DEBRIS
function buildPlank(T, K, P, r) {
  const j = a => (r() - 0.5) * a;
  // main board with a broken end at +x: three splinters of different length that touch (no gaps, so it never
  // reads as a fork), each tapering to a point
  const W = 0.25, H = 0.07, L = 1.0;
  const tone = ['woodMid', 'woodLight', 'woodMid'][Math.floor(r() * 3)];
  const tp = timberPaint(T, 'x');
  P.add(K.box(L, H, W, 0.016), tone, { at: [-0.2, 0, 0], jitter: 0.012, paint: tp });
  const fl = [0.07 + j(0.02), 0.16 + j(0.03), 0.04 + j(0.02)], fw = W / 3;
  for (let k = 0; k < 3; k++) {
    const len = fl[k] + 0.05, sp = K.box(len, H * (0.97 - 0.06 * k), fw, 0.01);
    K.warp(sp, v => { const t = clamp01((v.x + len / 2 - 0.035) / (len - 0.035)); v.z *= 1 - 0.7 * t; v.y *= 1 - 0.35 * t; v.z += (k - 1) * 0.012 * t; });
    P.add(sp, tone, { at: [0.3 - 0.02 + len / 2 - 0.03, j(0.004), -W / 2 + fw * (k + 0.5)], rot: [0, (k - 1) * 0.03, j(0.03)], jitter: 0.006, paint: tp, occlude: false });
  }
  // a short cross batten nailed across the other end: reads as "salvaged raft piece"
  P.add(K.box(0.12, 0.05, 0.46, 0.012), 'woodDark', { at: [-0.52, H / 2 + 0.022, 0.02], rot: [0, 0.18, 0.02], jitter: 0.01, paint: timberPaint(T, 'z') });
  nail(K, P, -0.51, H / 2 + 0.05, -0.12); nail(K, P, -0.535, H / 2 + 0.05, 0.14);
  // bent nail poking out
  P.add(K.cyl(0.007, 0.007, 0.06, 4), 'steel', { at: [0.05, H / 2 + 0.025, 0.05], rot: [0, 0, 0.55], tint: 0 });
}

function buildLeaf(T, K, P, r) {
  const tie = V3(K, -0.42, 0.02, 0);
  const fronds = 5;
  for (let f = 0; f < fronds; f++) {
    const yaw = -0.5 + 1.0 * f / (fronds - 1) + (r() - 0.5) * 0.12, len = 0.95 + r() * 0.12;
    const dir = K.V(Math.cos(yaw), 0, Math.sin(yaw));
    const lift = 0.06 + r() * 0.05;
    const at = s => tie.clone().addScaledVector(dir, len * s).add(K.V(0, lift * Math.sin(Math.PI * s * 0.8) - 0.05 * s * s + f * 0.012, 0));
    // midrib
    P.add(K.tube([at(0), at(0.35), at(0.7), at(1)], 0.012, 3, 6), 'stem', { tint: 0.04 });
    const n = 9, hueK = r();
    for (let i = 0; i < n; i++) {
      const s = 0.18 + 0.78 * i / (n - 1), base = at(s);
      const ll = 0.14 + 0.2 * Math.sin(Math.PI * (0.25 + 0.7 * s));
      for (const side of [-1, 1]) {
        const ang = yaw + side * (0.85 + (r() - 0.5) * 0.25);
        P.add(K.blade(ll * 1.1, 0.06, { segs: 3, fold: 0.45, droop: 0.3 }), 'leaf', {
          at: [base.x, base.y, base.z], rot: [side * 0.25, -ang, 0], tint: 0.08,
          paint: (c, m) => { const d = m.distanceTo(tie) / (len * 1.05); c.set(PALETTE.leafDeep).lerp(new T.Color(PALETTE.leaf), clamp01(d * 1.6)).lerp(new T.Color(PALETTE.leafLight), clamp01(d * 1.3 - 0.5)); if (hueK > 0.6) c.lerp(new T.Color(PALETTE.leafTip), 0.15); },
        });
      }
    }
  }
  // stem stubs and twine tie
  P.add(K.cyl(0.03, 0.04, 0.3, 6, 0.008), 'stem', { at: [tie.x - 0.14, tie.y, 0], rot: [0, 0, Math.PI / 2 - 0.1] });
  for (const dx of [0.0, 0.05]) P.add(K.torus(0.05, 0.012, 3, 8), 'rope', { at: [tie.x - 0.08 + dx, tie.y, 0], rot: [0, Math.PI / 2, 0], tint: 0.1 });
}
function V3(K, x, y, z) { return K.V(x, y, z); }

function buildScrap(T, K, P, r) {
  const Wd = 0.9, D = 0.62, nx = 14, nz = 4;
  const foldX = 0.12 + (r() - 0.5) * 0.06, foldK = 0.38 + r() * 0.12;
  const steel = new T.Color(PALETTE.steel), rust = new T.Color(PALETTE.rust), rustD = new T.Color(PALETTE.rustDark), rustL = new T.Color(PALETTE.rustLight);
  const ph = r() * 10;
  const g = K.sheet(Wd, D, nx, nz, (x, z, i, j) => {
    let y = (i % 2 ? 0.024 : -0.004);                     // triangular corrugation (faceted)
    if (x > foldX) y += (x - foldX) * foldK;                 // bent up
    const tz = clamp01((z - 0.12) / (D / 2 - 0.12)); y += 0.1 * tz * tz;   // curled edge
    if (i === 0) x += 0.02 + ((j * 7 + 3) % 5) * 0.012;         // torn edge
    if (j === 0 && i > nx * 0.6) z += ((i * 5) % 3) * 0.02;
    return [x, y, z];
  });
  // Rust is painted per VERTEX so it blends across facets: it creeps in from the edges, collects in the
  // corrugation valleys and along the bend, and breaks up with a soft two-octave noise. Ramp steel -> orange
  // bloom -> rust -> dark scale.
  const nz2 = (x, z) => 0.5 + 0.3 * Math.sin(x * 7.3 + ph) * Math.cos(z * 9.1 - ph * 0.7) + 0.2 * Math.sin(x * 19 + z * 15 + ph * 2);
  P.add(g, 'steel', {
    tint: 0.07, facetPos: true,
    vpaint: (c, v) => {
      const edge = Math.min(Wd / 2 - Math.abs(v.x), D / 2 - Math.abs(v.z));
      const valley = Math.abs(v.y - ((v.x > foldX ? (v.x - foldX) * foldK : 0) + 0.1 * clamp01((v.z - 0.12) / (D / 2 - 0.12)) ** 2)) < 0.006 ? 0.18 : 0;
      const bend = Math.max(0, 1 - Math.abs(v.x - foldX) / 0.06) * 0.25;
      const k = clamp01(Math.pow(clamp01(1 - edge / 0.2), 1.6) * 1.1 + valley + bend + (nz2(v.x, v.z) - 0.55) * 0.9);
      if (k < 0.3) c.lerp(steel, 0);
      else if (k < 0.55) c.lerp(rustL, (k - 0.3) / 0.25 * 0.85);
      else if (k < 0.85) c.copy(rustL).lerp(rust, (k - 0.55) / 0.3);
      else c.copy(rust).lerp(rustD, (k - 0.85) / 0.15);
    },
  });
  // bolts along the bend and a rusty angle bracket
  const hAt = x => (x > foldX ? (x - foldX) * foldK : 0) + 0.03;
  for (const [x, z] of [[foldX - 0.05, -0.18], [foldX - 0.05, 0.0], [foldX - 0.05, 0.16], [-0.3, -0.1]]) P.add(K.cyl(0.02, 0.022, 0.018, 6), 'steelDark', { at: [x, hAt(x), z], tint: 0 });
  P.add(K.box(0.22, 0.016, 0.06, 0.004), 'rust', { at: [-0.18, 0.04, 0.12], vpaint: (c, v) => c.lerp(rustD, clamp01(0.5 + Math.sin(v.x * 40 + ph) * 0.5)) });
  P.add(K.box(0.016, 0.1, 0.06, 0.004), 'rust', { at: [-0.07, 0.085, 0.12], rot: [0, 0, -0.3] });
}

function buildBarrel(T, K, P, r) {
  const H = 0.96, hh = H / 2, rMid = 0.41, rEnd = 0.34, seg = 10;
  const rad = y => rEnd + (rMid - rEnd) * (1 - (y / hh) ** 2);
  const prof = [[0, -hh + 0.05], [rEnd - 0.05, -hh + 0.05], [rEnd - 0.035, -hh], [rEnd, -hh]];
  for (let i = 1; i < 6; i++) { const y = -hh + H * i / 6; prof.push([rad(y), y]); }
  prof.push([rEnd, hh], [rEnd - 0.035, hh], [rEnd - 0.05, hh - 0.05], [0, hh - 0.05]);
  const sA = new T.Color(PALETTE.woodMid), sB = new T.Color(PALETTE.woodLight).lerp(new T.Color(PALETTE.woodPale), 0.3), lid = new T.Color(PALETTE.woodDark);
  P.add(K.lathe(prof, seg, 0.5), 'woodMid', {
    tint: 0,
    paint: (c, m, n) => {
      if (Math.abs(n.y) > 0.9 && Math.hypot(m.x, m.z) < rEnd - 0.04) { c.copy(lid); return; } // recessed lids
      const a = Math.atan2(m.z, m.x), k = Math.floor(((a / (Math.PI * 2)) + 1) * seg) % seg; // column centres sit mid-bin: no float flicker
      c.copy(k % 2 ? sA : sB);
      if (k === 3) c.multiplyScalar(0.86);
    },
  });
  // iron hoops (slightly proud of the staves)
  for (const y of [-0.3, 0.3, -0.43, 0.43]) {
    const R = rad(y) + 0.012, w = Math.abs(y) > 0.4 ? 0.035 : 0.05;
    P.add(K.lathe([[R - 0.02, y - w / 2], [R, y - w / 2], [R + 0.004, y], [R, y + w / 2], [R - 0.02, y + w / 2]], seg, 0.5), 'iron', { tint: 0.04 });
  }
  // lid seams + bung
  for (const z of [-0.14, 0, 0.14]) P.add(K.box(2 * Math.sqrt((rEnd - 0.05) ** 2 - z * z) - 0.02, 0.008, 0.01, 0), 'woodDeep', { at: [0, hh - 0.046, z], tint: 0 });
  P.add(K.cyl(0.045, 0.05, 0.035, 6, 0.008), 'woodDeep', { at: [0.17, hh - 0.035, 0.07] });
}

const DEBRIS = { wood: [buildPlank, 1.6], leaf: [buildLeaf, 1.75], scrap: [buildScrap, 1.2], barrel: [buildBarrel, 1.25] };

function fitInner(T, inner, maxXZ) {
  inner.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(inner), size = box.getSize(new T.Vector3());
  inner.scale.multiplyScalar(Math.min(1, maxXZ / Math.max(size.x, size.z, 1e-6)));
  inner.updateMatrixWorld(true);
  inner.position.sub(new T.Box3().setFromObject(inner).getCenter(new T.Vector3()));
}

export function createDebris(T, type, getMaterial, opts = {}) {
  const def = DEBRIS[type];
  if (!def) throw new Error(`createDebris: unknown type "${type}"`);
  const K = lowpoly(T);
  const r = mulberry(opts.seed != null ? seedOf(opts.seed) : Math.floor(Math.random() * 2 ** 31));
  const root = new T.Group(); root.name = `debris-${type}`;
  root.userData.type = type; root.userData.localMaterials = [];
  const inner = new T.Group(); inner.name = `debris-${type}-model`; root.add(inner);
  const P = K.parts();
  def[0](T, K, P, r);
  const geo = P.build({ y0: -0.25, y1: 0.25, lo: 0.7, contact: 0.45, radius: 0.06 });
  const leafy = type === 'leaf' || type === 'scrap';
  if (type === 'barrel') {
    const tilt = opts.tilt != null ? opts.tilt : 0.14 + r() * 0.14;
    const pivot = new T.Group(); pivot.name = 'barrel-tilt';
    pivot.rotation.set((r() - 0.5) * tilt * 0.6, r() * Math.PI * 2, tilt);
    K.mesh(pivot, geo, 'solid', 'barrel'); inner.add(pivot);
  } else K.mesh(inner, geo, leafy ? 'cloth' : 'solid', type);
  fitInner(T, inner, def[1]);
  inner.updateMatrixWorld(true);
  const size = new T.Box3().setFromObject(inner).getSize(new T.Vector3());
  root.userData.size = { x: size.x, y: size.y, z: size.z };
  return root;
}

// ================================================================== PLASTIC JUG
export function createPlastic(T) {
  const K = lowpoly(T), P = K.parts();
  const root = new T.Group(); root.name = 'plastic';
  const Z = 0.2 / 0.27;
  const prof = [[0, -0.35], [0.21, -0.35], [0.255, -0.33], [0.27, -0.29], [0.272, -0.19], [0.272, -0.03], [0.27, 0.06], [0.255, 0.13], [0.19, 0.2], [0.1, 0.245], [0.078, 0.26], [0.078, 0.285]];
  const label = new T.Color(PALETTE.label), grime = new T.Color(PALETTE.jugGrime);
  const body = K.lathe(prof, 8, 0.5);
  K.warp(body, v => { v.z *= Z; const a = Math.atan2(v.x, v.z); if (v.y > -0.3 && v.y < 0.12) { const d = 0.022 * Math.max(0, Math.cos(a - 2.3)) * Math.max(0, 1 - Math.abs(v.y + 0.08) / 0.16); v.x -= Math.sin(a) * d; v.z -= Math.cos(a) * d; } });
  P.add(body, 'jug', {
    tint: 0.05, jitter: 0.006,
    paint: (c, m) => {
      if (m.y > -0.19 && m.y < -0.03) c.lerp(label, 0.8);          // faded label band
      if (m.y < -0.28) c.lerp(grime, 0.7);
    },
  });
  P.add(K.cyl(0.092, 0.095, 0.075, 8, 0.012), 'cap', { at: [0, 0.32, 0], rot: [0, 0, 0.04], paint: (c, m, n) => { if (n.y > 0.9) c.multiplyScalar(1.12); } });
  P.add(K.cyl(0.096, 0.096, 0.016, 8), 'capDark', { at: [0, 0.282, 0] });
  P.add(K.torus(0.085, 0.026, 4, 6, Math.PI), 'jug', { at: [0.225, 0.05, 0], rot: [0, 0, -Math.PI / 2], scale: [1, 1, 1.2] });
  K.mesh(root, P.build({ y0: -0.35, y1: 0.1, lo: 0.75 }), 'solid', 'jugBody');
  root.userData.type = 'plastic';
  root.userData.size = { x: 0.65, y: 0.7, z: 0.4 };
  root.userData.dispose = () => root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  return root;
}

// ================================================================== DECK TILE
export const FLOOR_TOP = 0.2;
export const FLOOR_BOUNDS = Object.freeze({ minX: -1, maxX: 1, minY: 0, maxY: 0.2, minZ: -1, maxZ: 1 });

export function createFloor(T, index = 0, getMaterial) {
  const K = lowpoly(T), P = K.parts(), r = mulberry(seedOf(index));
  const g = new T.Group(); g.name = 'raft-floor';
  const LOG_R = 0.075, LOG_Y = 0.075;
  const logZ = [-0.72 + (r() - 0.5) * 0.04, 0.72 + (r() - 0.5) * 0.04];
  const end = new T.Color(PALETTE.woodEnd);
  for (const z of logZ) {
    P.add(K.cyl(LOG_R * 0.96, LOG_R, 1.97, 7, 0.012), r() < 0.5 ? 'bark' : 'barkDark', {
      at: [0, LOG_Y, z], rot: [r() * 6, 0, Math.PI / 2], jitter: 0.008, tint: 0.07, occlude: true,
      paint: (c, m, n) => { if (Math.abs(n.x) > 0.8) c.lerp(end, 0.6); },
    });
  }
  const n = r() < 0.35 ? 6 : 7, pitch = 2 / n;
  // Calm tone ramp: every plank is a blend between woodMid and woodLight, with the odd weathered (greyer) or
  // older (darker) board. Keeps the deck one warm colour from first person instead of a light/dark barcode.
  const mid = new T.Color(PALETTE.woodMid), light = new T.Color(PALETTE.woodLight), drift = new T.Color(PALETTE.drift);
  const tp = timberPaint(T, 'z');
  // lashed planks (rope over the plank and round the log) at the edges and one in the middle; the rest are nailed
  const lashed = new Set([0, n - 1, 2 + Math.floor(r() * (n - 4))]);
  for (let i = 0; i < n; i++) {
    const x0 = -1 + i * pitch + 0.009, x1 = -1 + (i + 1) * pitch - 0.009, w = x1 - x0, xc = (x0 + x1) / 2;
    const th = 0.058, top = FLOOR_TOP - r() * 0.007;
    const tone = mid.clone().lerp(light, 0.1 + 0.75 * r()).multiplyScalar(0.9 + 0.14 * r()), kind = r(), ps = seedOf(index) + i * 131;
    if (kind < 0.12) tone.lerp(drift, 0.28); else if (kind > 0.86) tone.multiplyScalar(0.86);
    const len = 1.985 - r() * 0.02, dz = (r() - 0.5) * 0.01;
    // about half the planks are two narrower boards of different tone (a second strip of value at eye level)
    const GAP = 0.008, split = r() < 0.5, boards = split ? [[xc - (w + GAP) / 4, (w - GAP) / 2, tone], [xc + (w + GAP) / 4, (w - GAP) / 2, tone.clone().lerp(r() < 0.5 ? drift : mid, 0.25 + 0.2 * r()).multiplyScalar(0.94 + 0.1 * r())]] : [[xc, w, tone]];
    boards.forEach(([bx, bw, bt], bi) => {
      const bs = ps + bi * 17;
      P.add(K.box(bw, th, len, 0.014), bt, { at: [bx, top - th / 2, dz], rot: [0, (r() - 0.5) * 0.012, (r() - 0.5) * 0.02], jitter: 0.006, paint: tp, tint: 0.05,
        vpaint: (c, v) => c.multiplyScalar(0.92 + 0.16 * hash4(Math.round(v.z * 3), Math.round(v.x * 40), 0, bs)) }); // weathering drift along the board
      // faint grain streaks (slightly darker slivers on the top face)
      for (let k = 0, ns = 1 + Math.floor(r() * (split ? 1.6 : 2.5)); k < ns; k++) { const sl = 0.5 + r() * 0.9, sz = (r() - 0.5) * (1.8 - sl); P.add(K.box(0.012 + r() * 0.008, 0.003, sl, 0), bt.clone().multiplyScalar(0.92), { at: [bx + (r() - 0.5) * bw * 0.6, top + 0.001, sz + dz], tint: 0, occlude: false }); }
    });
    // and the occasional split along the grain
    if (r() < 0.3) { const cx = split ? boards[0][0] : xc + (r() - 0.5) * w * 0.4, cl = 0.35 + r() * 0.4, cz = (r() - 0.5) * (1.6 - cl); P.add(K.box(0.008, 0.004, cl, 0), 'woodDeep', { at: [cx, top + 0.0012, cz], rot: [0, (r() - 0.5) * 0.04, 0], tint: 0, occlude: false }); }
    for (const z of logZ) {
      if (lashed.has(i)) {
        for (const oz of [-0.02, 0.02]) {
          const zz = z + oz, rt = top + 0.004;
          P.add(K.tube([K.V(x0 - 0.01, top - 0.055, zz), K.V(x0 + 0.004, rt, zz), K.V(xc, rt + 0.004, zz + oz * 0.2), K.V(x1 - 0.004, rt, zz), K.V(x1 + 0.01, top - 0.055, zz)], 0.015, 3, 8), 'ropeDark', { tint: 0.05, twist: 3 });
        }
      } else for (const s of [-1, 1]) nail(K, P, xc + s * w * 0.28, top + 0.002, z + (r() - 0.5) * 0.02);
    }
  }
  K.mesh(g, P.build({ y0: 0, y1: FLOOR_TOP, lo: 0.6, contact: 0.5, radius: 0.06 }), 'solid', 'floor');
  g.userData.kind = 'floor'; g.userData.index = index; g.userData.topY = FLOOR_TOP; g.userData.bounds = FLOOR_BOUNDS;
  g.userData.dispose = () => g.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  return g;
}

// ================================================================== CRAFTS
function craftCrate(T, K, S) {
  const P = S.solid, tp = timberPaint(T, 'x'), tz = timberPaint(T, 'z'), ty = timberPaint(T, 'y');
  const B = 0.84, h = 0.06, top = 0.82;
  // skids
  for (const s of [-1, 1]) P.add(K.box(0.1, h, B, 0.014), 'woodDeep', { at: [s * 0.3, h / 2, 0], paint: tz, jitter: 0.006 });
  // corner posts + top/bottom frame
  const F = 0.07, y0 = h, y1 = top, ym = (y0 + y1) / 2, hb = B / 2 - F / 2;
  const frame = new T.Color(PALETTE.woodDeep).lerp(new T.Color(PALETTE.drift), 0.12);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add(K.box(F, y1 - y0, F, 0.014), frame, { at: [sx * hb, ym, sz * hb], paint: ty, jitter: 0.005 });
  for (const y of [y0 + F / 2, y1 - F / 2]) for (const s of [-1, 1]) {
    P.add(K.box(B - 2 * F + 0.01, F, F * 0.8, 0.012), frame, { at: [0, y, s * hb], paint: tp, jitter: 0.005 });
    P.add(K.box(F * 0.8, F, B - 2 * F + 0.01, 0.012), frame, { at: [s * hb, y, 0], paint: tz, jitter: 0.005 });
  }
  // slats on four sides, three each, with a gap. Weathered grey-brown (woodDark -> drift), darker than the deck
  // planks so a crate on the raft separates from the floor.
  const dk = new T.Color(PALETTE.woodDark), dr = new T.Color(PALETTE.drift);
  const tones = [0.5, 0.32, 0.6, 0.42].map(k => dk.clone().lerp(dr, k).multiplyScalar(0.86));
  const slatH = (y1 - y0 - 2 * F) / 3 - 0.02;
  for (let k = 0; k < 3; k++) {
    const y = y0 + F + 0.01 + slatH / 2 + k * (slatH + 0.02);
    for (const s of [-1, 1]) {
      P.add(K.box(B - 2 * F, slatH, 0.035, 0.01), tones[(k + (s > 0 ? 1 : 0)) % 4], { at: [0, y, s * (hb - 0.005)], paint: tp, jitter: 0.006 });
      P.add(K.box(0.035, slatH, B - 2 * F, 0.01), tones[(k + 2) % 4], { at: [s * (hb - 0.005), y, 0], paint: tz, jitter: 0.006 });
    }
  }
  // diagonal braces front/back
  for (const s of [-1, 1]) P.add(K.box(0.07, Math.hypot(B - 2 * F, y1 - y0 - 2 * F) - 0.04, 0.03, 0.01), dk.clone().lerp(dr, 0.2).multiplyScalar(0.8), { at: [0, ym, s * (hb + 0.028)], rot: [0, 0, s * Math.atan2(B - 2 * F, y1 - y0 - 2 * F)], paint: ty });
  // lid planks
  for (let i = 0; i < 4; i++) P.add(K.box(0.2, 0.035, B - 0.02, 0.01), tones[i], { at: [-0.3 + i * 0.2 + (i - 1.5) * 0.004, top + 0.017, 0], rot: [0, (i - 1.5) * 0.01, 0], paint: tz, jitter: 0.006 });
  for (let i = 0; i < 4; i++) for (const z of [-0.33, 0.33]) nail(K, P, -0.3 + i * 0.2, top + 0.036, z);
  // rope handles on the x sides
  for (const s of [-1, 1]) {
    P.add(K.tube([K.V(s * 0.45, 0.6, -0.14), K.V(s * 0.5, 0.52, -0.08), K.V(s * 0.51, 0.5, 0), K.V(s * 0.5, 0.52, 0.08), K.V(s * 0.45, 0.6, 0.14)], 0.016, 4, 8), 'rope', { tint: 0.1 });
    for (const z of [-0.14, 0.14]) P.add(K.ico(0.026, 0), 'ropeDark', { at: [s * 0.45, 0.6, z] });
  }
}

function craftBench(T, K, S) {
  const P = S.solid, tp = timberPaint(T, 'x'), ty = timberPaint(T, 'y');
  const tones = calmTones(T, 3, 5);
  for (let i = 0; i < 3; i++) P.add(K.box(1.4, 0.06, 0.135, 0.014), tones[i], { at: [0, 0.45, -0.14 + i * 0.14], rot: [0, (i - 1) * 0.008, 0], paint: tp, jitter: 0.008 });
  for (const sx of [-0.56, 0.56]) {
    for (const sz of [-0.15, 0.15]) P.add(K.box(0.08, 0.42, 0.08, 0.014), 'woodDark', { at: [sx, 0.21, sz], rot: [sz * 0.25, 0, 0], paint: ty, jitter: 0.008 });
    P.add(K.box(0.07, 0.06, 0.44, 0.012), 'woodDark', { at: [sx, 0.38, 0], paint: timberPaint(T, 'z') });
    P.add(K.box(0.06, 0.05, 0.4, 0.01), 'woodDeep', { at: [sx, 0.1, 0] });
    // back post
    P.add(K.box(0.07, 0.5, 0.07, 0.012), 'woodDark', { at: [sx, 0.72, -0.2], rot: [-0.12, 0, 0], paint: ty });
  }
  for (const [y, t] of [[0.82, 'woodMid'], [0.65, 'woodLight']]) P.add(K.box(1.3, 0.1, 0.04, 0.012), t, { at: [0, y, -0.225 + (0.82 - y) * 0.12], rot: [-0.12, 0, 0], paint: tp, jitter: 0.008 });
  for (const sx of [-0.56, 0.56]) for (const y of [0.45]) P.add(K.torus(0.06, 0.01, 3, 8), 'rope', { at: [sx, y - 0.04, 0.15], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1.4] });
  for (const sx of [-0.56, 0.56]) for (let i = 0; i < 3; i++) nail(K, P, sx, 0.482, -0.14 + i * 0.14);
}

function craftNet(T, K, S) {
  const P = S.solid, end = new T.Color(PALETTE.woodEnd);
  const L = 1.62, h = L / 2;
  // sturdy log frame: barked logs (r 6.5 cm) with light end grain; the z logs lie on top of the x logs
  const FR = 0.065, IN = FR + 0.005, YX = FR, YZ = FR * 2 - 0.012;
  const endGrain = ax => (c, m, n) => { if (Math.abs(n[ax]) > 0.8) c.lerp(end, 0.6); };
  for (const s of [-1, 1]) {
    P.add(K.cyl(FR * 0.95, FR, L, 7, 0.012), s < 0 ? 'bark' : 'barkDark', { at: [0, YX, s * (h - IN)], rot: [0.4 + s, 0, Math.PI / 2], jitter: 0.008, tint: 0.07, paint: endGrain('x'), occlude: true });
    P.add(K.cyl(FR, FR * 0.95, L - 0.04, 7, 0.012), s < 0 ? 'barkDark' : 'bark', { at: [s * (h - IN), YZ, 0], rot: [Math.PI / 2, 1.1 + s, 0], jitter: 0.008, tint: 0.07, paint: endGrain('z'), occlude: true });
  }
  const netRope = new T.Color(PALETTE.ropeDark).lerp(new T.Color(PALETTE.bark), 0.25);
  // rope mesh: thick laid rope (spiral-shaded), sagging into the middle, knotted at every crossing
  const n = 6, sagAt = (a, b) => 0.12 - 0.04 * (1 - a * a) * (1 - b * b), span = h - IN - 0.02;
  for (let k = 1; k < n; k++) {
    const t = -span + 2 * span * k / n, u = t / span;
    const ptsX = [], ptsZ = [];
    // each strand runs over the frame pole and tucks down outside it, so it reads as tied on
    const fx = h - IN, fyX = YZ, fyZ = YX, up = FR + 0.016, o = FR * 0.55; // strands along x cross the z logs and vice versa
    ptsX.push(K.V(-fx - o, fyX + 0.01, t), K.V(-fx, fyX + up, t)); ptsZ.push(K.V(t, fyZ + 0.01, -fx - o), K.V(t, fyZ + up, -fx));
    for (let q = 1; q < n; q++) { const v = -1 + 2 * q / n, sv = v * span; ptsX.push(K.V(sv, sagAt(v, u) + 0.008, t)); ptsZ.push(K.V(t, sagAt(v, u), sv)); } // a point at every knot
    ptsX.push(K.V(fx, fyX + up, t), K.V(fx + o, fyX + 0.01, t)); ptsZ.push(K.V(t, fyZ + up, fx), K.V(t, fyZ + 0.01, fx + o));
    P.add(K.tube(ptsX, 0.02, 3, 11), netRope, { tint: 0.04, twist: 3 });
    P.add(K.tube(ptsZ, 0.02, 3, 11), netRope, { tint: 0.04, twist: 3 });
    for (let q = 1; q < n; q++) { const v = -span + 2 * span * q / n; P.add(K.octa(0.042), 'rope', { at: [v, sagAt(v / span, u) + 0.006, t], rot: [0, 0.6 + k + q, 0], scale: [1, 0.7, 1], tint: 0.12 }); }
  }
  // corner lashings binding the frame
  for (const [x, z] of [[-h + IN, -h + IN], [h - IN, -h + IN], [-h + IN, h - IN], [h - IN, h - IN]]) P.add(K.torus(0.085, 0.018, 3, 6), 'ropeDark', { at: [x, (YX + YZ) / 2, z], rot: [Math.PI / 2, 0, 0.7], scale: [1, 1, 1.3], twist: 6 });
  // cork floats sitting on the corner lashings
  for (const [x, z] of [[-h + IN, -h + IN], [h - IN, -h + IN], [-h + IN, h - IN], [h - IN, h - IN]]) P.add(K.cyl(0.07, 0.078, 0.08, 7, 0.022), 'float', { at: [x, YZ + FR + 0.03, z], paint: (c, m, nn) => { if (nn.y > 0.9) c.set(PALETTE.floatLight); } });
}

function craftLantern(T, K, S) {
  const P = S.solid, ty = timberPaint(T, 'y'), tx = timberPaint(T, 'x');
  const PX = -0.3, AY = 1.72, LX = 0.3;
  P.add(K.box(0.74, 0.07, 0.15, 0.014), 'woodDark', { at: [PX, 0.035, 0], paint: tx, jitter: 0.006 });
  P.add(K.box(0.15, 0.07, 0.74, 0.014), 'woodMid', { at: [PX, 0.105, 0], paint: timberPaint(T, 'z'), jitter: 0.006 });
  P.add(K.box(0.11, 1.68, 0.11, 0.016), 'woodMid', { at: [PX, 0.98, 0], paint: ty, jitter: 0.008 });
  P.add(K.cone(0.1, 0.09, 4), 'woodDeep', { at: [PX, 1.87, 0], rot: [0, Math.PI / 4, 0] });
  for (const [fx, fy, fz] of [[PX + 0.33, 0.07, 0], [PX - 0.33, 0.07, 0], [PX, 0.14, 0.33], [PX, 0.14, -0.33]]) {
    const dx = fx - PX, d = Math.hypot(dx, fz);
    P.add(K.beam(0.05, 0.04, K.V(fx, fy, fz), K.V(PX + dx / d * 0.05, 0.52, fz / d * 0.05), 0.01), 'woodDark');
  }
  // arm, knee brace, curled crook
  P.add(K.box(0.73, 0.085, 0.085, 0.014), 'woodMid', { at: [0.015, AY, 0], paint: tx, jitter: 0.006 });
  P.add(K.box(0.05, Math.hypot(0.265, 0.3), 0.05, 0.01), 'woodDark', { at: [PX + 0.19, AY - 0.19, 0], rot: [0, 0, -Math.atan2(0.265, 0.3)] });
  P.add(K.tube([K.V(0.36, AY, 0), K.V(0.44, AY + 0.02, 0), K.V(0.475, AY + 0.08, 0), K.V(0.445, AY + 0.125, 0), K.V(0.4, AY + 0.105, 0)], 0.03, 5, 8), 'woodMid');
  for (const y of [AY - 0.06, AY - 0.1]) P.add(K.torus(0.075, 0.01, 3, 8), 'rope', { at: [PX, y, 0], rot: [Math.PI / 2, 0, 0] });
  // hanger + lantern frame
  P.add(K.cyl(0.007, 0.007, 0.1, 4), 'iron', { at: [LX, AY - 0.09, 0] });
  P.add(K.torus(0.02, 0.006, 3, 6), 'iron', { at: [LX, 1.6, 0] });
  P.add(K.torus(0.11, 0.007, 3, 8, Math.PI), 'iron', { at: [LX, 1.43, 0] });
  P.add(K.cyl(0.13, 0.13, 0.035, 4, 0.008), 'iron', { at: [LX, 1.105, 0], rot: [0, Math.PI / 4, 0] });
  P.add(K.cyl(0.12, 0.12, 0.03, 4, 0.006), 'iron', { at: [LX, 1.385, 0], rot: [0, Math.PI / 4, 0] });
  P.add(K.cone(0.16, 0.1, 4), 'iron', { at: [LX, 1.45, 0], rot: [0, Math.PI / 4, 0] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add(K.box(0.02, 0.27, 0.02, 0), 'iron', { at: [LX + sx * 0.08, 1.245, sz * 0.08] });
  P.add(K.cyl(0.03, 0.03, 0.035, 6), 'brass', { at: [LX, 1.51, 0] });
  P.add(K.cyl(0.045, 0.045, 0.012, 6), 'brass', { at: [LX, 1.53, 0] });
  P.add(K.cyl(0.05, 0.045, 0.02, 6), 'brass', { at: [LX, 1.13, 0] });
  // lit part: see the glow material (one translucent, unlit, unshadowed mesh)
  // candle + flame, then glowing panes (translucent, warm, brighter low down where the flame is)
  S.glow.add(K.cyl(0.026, 0.028, 0.08, 6), 'candle', { at: [LX, 1.18, 0], tint: 0 });
  S.glow.add(K.cone(0.022, 0.07, 5), 'flame', { at: [LX, 1.255, 0], tint: 0, paint: (c, m) => { if (m.y < 1.245) c.set(PALETTE.flameCore); } });
  const hot = new T.Color(PALETTE.flame);
  S.glow.add(K.box(0.15, 0.24, 0.15, 0.01), 'glass', { at: [LX, 1.25, 0], tint: 0, edge: 0, alpha: 0.55, vpaint: (c, v) => c.lerp(hot, clamp01(1.3 - (v.y - 1.13) / 0.24 * 1.4) * 0.75) });
}

function craftPalm(T, K, S) {
  const P = S.solid, L = S.cloth;
  const B = 0.05;
  for (const z of [-0.3, 0, 0.3]) P.add(K.box(0.92, 0.05, 0.27, 0.012), z ? 'woodMid' : 'woodLight', { at: [0, 0.025, z], paint: timberPaint(T, 'x'), jitter: 0.006 });
  for (const z of [-0.3, 0, 0.3]) for (const x of [-0.38, 0.38]) nail(K, P, x, 0.052, z);
  // terracotta pot with rolled rim
  const clayL = new T.Color(PALETTE.clayLight), clayD = new T.Color(PALETTE.clayDark);
  P.add(K.lathe([[0, B], [0.25, B], [0.285, B + 0.03], [0.3, B + 0.1], [0.35, B + 0.4], [0.42, B + 0.42], [0.44, B + 0.47], [0.43, B + 0.53], [0.4, B + 0.55], [0.3, B + 0.55]], 8, 0.5), 'clay', {
    // plain terracotta body (no cream band: the body is one lathe row, so a band tinted the whole pot grey),
    // lighter rolled rim, darkening toward the foot
    tint: 0.05, paint: (c, m) => { const y = m.y - B; if (y > 0.4) c.lerp(clayL, 0.45); else if (y < 0.1) c.lerp(clayD, 0.4); },
    vpaint: (c, v) => { const y = v.y - B; if (y > 0.05 && y < 0.41) c.lerp(clayD, 0.3 * (1 - clamp01((y - 0.1) / 0.3))); },
  });
  const soil = K.cyl(0.33, 0.33, 0.06, 8);
  K.warp(soil, v => { if (v.y > 0) v.y += 0.03 * (1 - Math.hypot(v.x, v.z) / 0.33); });
  P.add(soil, 'soil', { at: [0, B + 0.5, 0], tint: 0.08 });
  for (let i = 0; i < 5; i++) { const a = i * 1.3 + 0.4, rr = 0.18 + 0.1 * ((i * 7) % 3) / 2; P.add(K.ico(0.03, 0), 'pebble', { at: [Math.cos(a) * rr, B + 0.545, Math.sin(a) * rr], rot: [i, i * 2, 0], scale: [1.2, 0.6, 1] }); }
  // curved, ringed trunk: stacked tapered hexagonal segments
  const curve = new T.CatmullRomCurve3([K.V(0, B + 0.5, 0), K.V(0.02, B + 0.9, 0.01), K.V(0.06, B + 1.3, 0.025), K.V(0.1, B + 1.62, 0.04), K.V(0.12, B + 1.86, 0.045)]);
  const NS = 8;
  for (let i = 0; i < NS; i++) {
    const t0 = i / NS, t1 = (i + 1) / NS, p0 = curve.getPointAt(t0), p1 = curve.getPointAt(t1);
    const r0 = 0.095 - 0.03 * t0, r1 = 0.095 - 0.03 * t1, len = p0.distanceTo(p1) * 1.06;
    const seg = K.lathe([[0, -len / 2], [r0 * 1.12, -len / 2], [r1 * 0.9, len / 2], [0, len / 2]], 6, i * 0.35);
    P.add(seg, i % 2 ? 'bark' : 'barkLight', { from: p0, to: p1, tint: 0.07, paint: (c, m, n) => { if (Math.abs(n.dot(K.V().subVectors(p1, p0).normalize())) > 0.7) c.set(PALETTE.barkDark); } });
  }
  const top = curve.getPointAt(1);
  P.add(K.ico(0.1, 0), 'barkDark', { at: [top.x, top.y + 0.02, top.z], scale: [1, 0.7, 1] });
  for (let k = 0; k < 3; k++) { const a = 0.4 + k * 2.1; P.add(K.ico(0.07, 1), 'woodDeep', { at: [top.x + Math.cos(a) * 0.085, top.y - 0.06, top.z + Math.sin(a) * 0.085], tint: 0.1 }); }
  // fronds: arching midrib + pinnate, V-folded leaflets that droop away from the rib
  const NF = 9, C0 = top.clone().add(K.V(0, 0.04, 0));
  const deep = new T.Color(PALETTE.leafDeep), mid = new T.Color(PALETTE.leaf), lite = new T.Color(PALETTE.leafLight);
  const X = K.V(), Y = K.V(), Z = K.V(), mtx = new T.Matrix4();
  for (let f = 0; f < NF; f++) {
    const upper = f % 3 !== 2, ang = f / NF * Math.PI * 2 + 0.3 + ((f * 37) % 7 - 3) * 0.05;
    const len = upper ? 0.9 : 1.0, droop = upper ? 0.32 : 0.62, pitchUp = upper ? 0.62 : 0.32;
    const dir = K.V(Math.cos(ang), 0, Math.sin(ang)), side = K.V(-dir.z, 0, dir.x);
    const at = t => C0.clone().addScaledVector(dir, len * t).add(K.V(0, len * (pitchUp * t * (1 - t) * 1.2 - droop * t * t), 0));
    const rib = []; for (let k = 0; k <= 6; k++) rib.push(at(k / 6));
    P.add(K.tube(rib, 0.012, 3, 10), 'stem', { tint: 0.04 });
    const NL = 11, shade = upper ? 1 : 0.86;
    for (let i = 0; i < NL; i++) {
      const t = 0.12 + 0.86 * i / (NL - 1), base = at(t), tan = at(Math.min(1, t + 0.02)).sub(at(Math.max(0, t - 0.02))).normalize();
      const ll = (0.12 + 0.24 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.85))) * (1 - 0.25 * t);
      for (const sg of [-1, 1]) {
        X.copy(tan).multiplyScalar(0.55).addScaledVector(side, sg * 0.85).add(K.V(0, -0.35 - 0.3 * t, 0)).normalize();
        Z.crossVectors(X, K.UP).normalize(); Y.crossVectors(Z, X).normalize();
        const g = K.blade(ll, 0.042 + 0.02 * (1 - t), { segs: 2, fold: 0.5, droop: 0.25 });
        g.applyMatrix4(mtx.makeBasis(X, Y, Z).setPosition(base));
        const col = deep.clone().lerp(mid, clamp01(t * 2)).lerp(lite, clamp01(t * 1.7 - 0.7)).multiplyScalar(shade * (0.94 + 0.12 * ((i * 7 + f * 3 + (sg > 0 ? 1 : 0)) % 5) / 4));
        L.add(g, col, { tint: 0.05 });
      }
    }
  }
  // rope band on the pot
  P.add(K.torus(0.345, 0.014, 3, 12), 'rope', { at: [0, B + 0.3, 0], rot: [Math.PI / 2, 0, 0], tint: 0.1 });
}

function craftSail(T, K, S) {
  const P = S.solid, L = S.cloth, V = K.V;
  const tx = timberPaint(T, 'x'), tz = timberPaint(T, 'z'), ty = timberPaint(T, 'y');
  P.add(K.box(1.5, 0.08, 0.2, 0.016), 'woodDark', { at: [0, 0.04, 0], paint: tx, jitter: 0.008 });
  P.add(K.box(0.2, 0.08, 1.5, 0.016), 'woodMid', { at: [0, 0.12, 0], paint: tz, jitter: 0.008 });
  P.add(K.box(0.3, 0.12, 0.3, 0.02), 'woodDeep', { at: [0, 0.22, 0], jitter: 0.008 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) nail(K, P, sx * 0.1, 0.282, sz * 0.1);
  const MB = 0.28, MT = 3.56;
  P.add(K.cyl(0.05, 0.07, MT - MB, 8, 0.012), 'woodMid', { at: [0, (MB + MT) / 2, 0], paint: ty, tint: 0.05 });
  P.add(K.cyl(0.065, 0.065, 0.07, 8, 0.015), 'woodDeep', { at: [0, MT + 0.03, 0] });
  for (const [fx, fy, fz] of [[0.6, 0.1, 0], [-0.6, 0.1, 0], [0, 0.18, 0.6], [0, 0.18, -0.6]]) {
    const d = Math.hypot(fx, fz);
    P.add(K.beam(0.06, 0.05, V(fx, fy, fz), V(fx / d * 0.07, 0.78, fz / d * 0.07), 0.01), 'woodDark');
  }
  // yard / boom: tapered octagonal spars
  const CZ = 0.115, YARD_Y = 3.2, BOOM_Y = 1.05;
  const spar = (len, rr, y) => P.add(K.lathe([[0, -len / 2], [rr * 0.6, -len / 2], [rr, -len * 0.2], [rr, len * 0.2], [rr * 0.6, len / 2], [0, len / 2]], 6), 'woodMid', { at: [0, y, CZ], rot: [0, 0, Math.PI / 2], tint: 0.05, paint: tx });
  spar(1.66, 0.048, YARD_Y); spar(1.58, 0.05, BOOM_Y);
  // canvas: a coarse bowed sheet so the facets catch the light; cream with a red stripe and a patch
  const SW = 1.44, Y0 = 1.09, Y1 = 3.17, SH = Y1 - Y0, BOW = 0.3;
  const bow = (x, y) => { const u = x / (SW / 2), v = clamp01((y - Y0) / SH); return BOW * (1 - 0.55 * u * u) * Math.pow(Math.sin(Math.PI * v), 0.8); };
  const cloth = K.sheet(SW, SH, 7, 12, (x, z) => { const y = Y0 + SH / 2 - z; return [x, y, CZ + bow(x, y)]; });
  const stripe = new T.Color(PALETTE.stripe), stain = new T.Color(PALETTE.canvasStain), patch = new T.Color(PALETTE.patch);
  L.add(cloth, 'canvas', {
    tint: 0, smooth: true, // smooth-shaded, no per-facet tint: reads as one bellied canvas, not grey triangles
    paint: (c, m) => {
      if (Math.abs(m.x) < SW / 14) c.copy(stripe);
      else if (m.x > 0.3 && m.x < 0.52 && m.y > 1.35 && m.y < 1.62) c.copy(patch);
    },
    vpaint: (c, v) => c.lerp(stain, 0.35 * Math.pow(1 - clamp01((v.y - Y0) / SH), 3)),
  });
  // bolt ropes and lashings
  for (const sx of [-SW / 2, SW / 2]) { const pts = []; for (let k = 0; k <= 6; k++) { const y = Y0 + SH * k / 6; pts.push(V(sx, y, CZ + bow(sx, y))); } P.add(K.tube(pts, 0.012, 3, 12), 'rope', { tint: 0.08 }); }
  for (const x of [-0.6, -0.3, 0.3, 0.6]) for (const y of [YARD_Y, BOOM_Y]) P.add(K.torus(0.058, 0.009, 3, 8), 'ropeDark', { at: [x, y, CZ], rot: [0, Math.PI / 2, 0] });
  for (const y of [YARD_Y, BOOM_Y]) P.add(K.torus(0.07, 0.012, 3, 8), 'rope', { at: [0, y, 0.04], rot: [Math.PI / 2, 0, 0] });
  // stays + sheet lines
  P.add(K.tube([V(0, 3.42, -0.05), V(0, 0.2, -0.64)], 0.01, 3), 'rope', { tint: 0 });
  for (const s of [-1, 1]) {
    P.add(K.tube([V(s * 0.05, 3.42, 0), V(s * 0.64, 0.12, 0)], 0.01, 3), 'rope', { tint: 0 });
    P.add(K.tube([V(s * 0.74, BOOM_Y, CZ), V(s * 0.76, 0.6, 0.1), V(s * 0.65, 0.13, 0.01)], 0.009, 3, 6), 'rope', { tint: 0 });
    P.add(K.torus(0.025, 0.008, 3, 6), 'iron', { at: [s * 0.64, 0.1, 0], rot: [Math.PI / 2, 0, 0] });
  }
  P.add(K.torus(0.025, 0.008, 3, 6), 'iron', { at: [0, 0.18, -0.64], rot: [Math.PI / 2, 0, 0] });
  // coiled spare rope
  for (const [rr, y] of [[0.1, 0.014], [0.08, 0.04]]) P.add(K.torus(rr, 0.016, 3, 10), 'rope', { at: [-0.42, y, -0.42], rot: [Math.PI / 2, 0, 0], tint: 0.1 });
  // pennant
  P.add(K.cyl(0.008, 0.008, 0.2, 4), 'iron', { at: [0, 3.68, 0] });
  const flag = K.sheet(0.42, 0.12, 4, 1, (x, z, i) => { const s = i / 4; return [0.01 + s * 0.42, 3.72 - s * 0.02 + z * (1 - s * 0.9), 0.05 * Math.sin(s * 5.5) * s]; });
  L.add(flag, 'stripe', { tint: 0.08 });
}

const CRAFTS = { sail: craftSail, palm: craftPalm, lantern: craftLantern, net: craftNet, bench: craftBench, crate: craftCrate };

export function createCraft(T, type) {
  const key = String(type || '').toLowerCase(), build = CRAFTS[key];
  if (!build) return null;
  const K = lowpoly(T);
  const g = new T.Group(); g.name = 'craft_' + key;
  const S = { solid: K.parts(), cloth: K.parts(), glow: K.parts() };
  build(T, K, S);
  g.updateMatrixWorld(true);
  const ao = { y0: 0, y1: 0.5, lo: 0.68, contact: 0.45, radius: 0.07 };
  K.mesh(g, S.solid.build(ao), 'solid', key + 'Solid');
  K.mesh(g, S.cloth.build(ao), 'cloth', key + 'Cloth');
  K.mesh(g, S.glow.build(), 'glow', key + 'Glow');
  g.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(g), size = box.getSize(new T.Vector3());
  g.userData.craftType = key;
  g.userData.size = { x: size.x, y: size.y, z: size.z };
  g.userData.height = box.max.y;
  return g;
}

// ================================================================== gallery helper
export const PROP_NAMES = ['plank', 'barrel', 'jug', 'leaf', 'scrap', 'crate', 'sail', 'palm', 'lantern', 'deck', 'net', 'bench'];
export function createProp(T, name, opts = {}) {
  const seed = opts.seed ?? 7;
  if (name === 'plank') return createDebris(T, 'wood', null, { seed });
  if (name === 'leaf' || name === 'scrap' || name === 'barrel') return createDebris(T, name, null, { seed, tilt: opts.tilt });
  if (name === 'jug') return createPlastic(T);
  if (name === 'deck') return createFloor(T, seed);
  return createCraft(T, name);
}
