// Original procedural raft foundation tile: wide hand-cut weathered boards lashed onto two round logs.
// Usage: import { createFloor } from './deck.js?build=v3-survival-ae77fa84ac2b';
//        const g = createFloor(T, index, color => material); g.position.set(x * 2, 0, z * 2);
// Local bounds: x,z in [-1, 1], y in [0, ~0.2]. Walkable top surface FLOOR_TOP = 0.20 (unevenness <= 0.017).
// All geometry is created per tile (dispose via g.userData.dispose()). Materials come from getMaterial and are never disposed here.

export const FLOOR_TOP = 0.2;
export const FLOOR_BOUNDS = Object.freeze({minX:-1, maxX:1, minY:0, maxY:0.2, minZ:-1, maxZ:1});

// Material keys (game.js TIMBER); wood.js draws them as warm weathered driftwood (#a58c66 / #ae9775 / #957d5b).
const PLANK_COLORS = ['#bb8a53', '#c69860', '#ad7c4a'];
const BEAM_COLOR = '#5e4029', BEAM_END_COLOR = '#9c7649', ROPE_COLOR = '#a8946c', NAIL_COLOR = '#4b4844';
const BEV = 0.011, BEV_T = 0.01, THICK = 0.052;
const BEAM_R = 0.064, BEAM_Y = 0.072, BEAM_HALF = 0.985;
// Dark sheet under the boards (drawn with the log material, so no extra draw call) so plank gaps read as shadow, not water.
// Full 2x2 so neighbouring tiles' underlays meet with no seam; up-facing only, so it is invisible from below.
const UNDERLAY_Y = 0.135;
let _underMat = null; // unlit: the underlay only shows through board gaps; lighting it cost a full-screen lit pass
const underlayMat = T => _underMat || (_underMat = new T.MeshBasicMaterial({color:'#24180e'}));

function makeRng(index) {
  let h = 2166136261 >>> 0; const s = String(index ?? 0);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  let a = (h >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Merge geometries into one non-indexed BufferGeometry (position/normal/uv, plus color when the first has one). Sources are disposed.
function merge(T, geos) {
  let count = 0;
  const parts = geos.map(g => { const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose(); count += n.attributes.position.count; return n; });
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const col = parts[0]?.attributes.color ? new Float32Array(count * 3) : null;
  let o = 0;
  for (const g of parts) {
    const c = g.attributes.position.count;
    for (let i = 0; i < c; i++) {
      pos[(o + i) * 3] = g.attributes.position.getX(i); pos[(o + i) * 3 + 1] = g.attributes.position.getY(i); pos[(o + i) * 3 + 2] = g.attributes.position.getZ(i);
      if (g.attributes.normal) { nor[(o + i) * 3] = g.attributes.normal.getX(i); nor[(o + i) * 3 + 1] = g.attributes.normal.getY(i); nor[(o + i) * 3 + 2] = g.attributes.normal.getZ(i); }
      if (g.attributes.uv) { uv[(o + i) * 2] = g.attributes.uv.getX(i); uv[(o + i) * 2 + 1] = g.attributes.uv.getY(i); }
      if (col && g.attributes.color) { col[(o + i) * 3] = g.attributes.color.getX(i); col[(o + i) * 3 + 1] = g.attributes.color.getY(i); col[(o + i) * 3 + 2] = g.attributes.color.getZ(i); }
    }
    o += c; g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setAttribute('uv', new T.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new T.BufferAttribute(col, 3));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

// Jagged plank end from x=s to x=e at nominal zEnd; dir points inward (+1 for the -z end, -1 for the +z end).
function endPoints(rng, s, e, xc, zEnd, dir, end) {
  const K = 4, keep = 1 + Math.floor(rng() * 3), pts = [];
  for (let k = 0; k <= K; k++) {
    const x = s + (e - s) * k / K + (k > 0 && k < K ? (rng() - 0.5) * 0.02 : 0);
    const d = k === keep ? 0 : rng() * end.depth;
    pts.push([x, zEnd + end.slope * (x - xc) + dir * d]);
  }
  const sign = Math.sign(e - s);
  if (end.chip && rng() < 0.6) {
    const c = 0.014 + rng() * 0.008;
    if (rng() < 0.5) { const [x, z] = pts[0]; pts.splice(0, 1, [x, z + dir * c], [x + sign * c, z]); }
    else { const [x, z] = pts[pts.length - 1]; pts.splice(pts.length - 1, 1, [x - sign * c, z], [x, z + dir * c]); }
  }
  return pts;
}

function sideEdge(rng, x, inward, z0, z1) {
  const M = Math.max(2, Math.round(Math.abs(z1 - z0) * 3)), pts = [];
  for (let m = 1; m <= M; m++) pts.push([x + inward * rng() * 0.005, z0 + (z1 - z0) * m / (M + 1) + (rng() - 0.5) * 0.04]);
  return pts;
}

// One plank piece covering [x0,x1] x [za,zb] (outer extents including bevel).
function plankGeometry(T, rng, p) {
  const xa = p.x0 + BEV, xb = p.x1 - BEV, zA = p.za + BEV, zB = p.zb - BEV, xc = (p.x0 + p.x1) / 2;
  const outline = [
    ...endPoints(rng, xa, xb, xc, zA, 1, p.endA),
    ...sideEdge(rng, xb, -1, zA, zB),
    ...endPoints(rng, xb, xa, xc, zB, -1, p.endB),
    ...sideEdge(rng, xa, 1, zB, zA),
  ];
  const shape = new T.Shape(outline.map(([x, z]) => new T.Vector2(x, -z)));
  const depth = THICK - 2 * BEV_T;
  const g = new T.ExtrudeGeometry(shape, {depth, steps:1, curveSegments:1, bevelEnabled:true, bevelThickness:BEV_T, bevelSize:BEV, bevelOffset:0, bevelSegments:1});
  g.rotateX(-Math.PI / 2); // shape y -> -z, extrusion -> +y
  g.translate(-xc, 0, 0); g.rotateZ(p.roll); g.translate(xc, p.top - (depth + BEV_T), 0);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, pos.getY(i) + p.warp * (1 - z * z));
    let u = 0.5 + (x - xc) / ((p.x1 - p.x0) * 1.08) + p.uOff, v = 0.03 + (z + 1) * 0.47;
    if (p.flipU) u = 1 - u; if (p.flipV) v = 1 - v;
    uv.setXY(i, u, v);
  }
  g.clearGroups(); g.computeVertexNormals();
  return g;
}

const plankSurface = (p, x, z) => p.top + p.roll * (x - (p.x0 + p.x1) / 2) + p.warp * (1 - z * z);

function beamParts(T, rng, z) {
  const ph = rng() * 6.28, L = BEAM_HALF * 2;
  const bend = y => 0.007 * Math.sin(y * 1.7 + ph);
  const g = new T.CylinderGeometry(BEAM_R * 0.95, BEAM_R * 1.03, L, 10, 5);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), zz = pos.getZ(i), a = Math.atan2(zz, x);
    const f = 1 + 0.05 * Math.sin(a * 3 + ph + y * 2.1) + 0.03 * Math.sin(y * 5.7 + ph);
    pos.setXYZ(i, x * f, y, zz * f + bend(y));
  }
  g.computeVertexNormals();
  g.rotateZ(Math.PI / 2); g.translate(0, BEAM_Y, z); // local +y -> world -x
  const caps = [];
  for (const s of [-1, 1]) {
    const c = new T.CylinderGeometry(BEAM_R * 0.8, BEAM_R * 0.84, 0.008, 10);
    c.rotateZ(Math.PI / 2); c.translate(-s * (BEAM_HALF + 0.002), BEAM_Y, z + bend(s * BEAM_HALF));
    caps.push(c);
  }
  return {beam:g, caps};
}

function lashing(T, rng, x, zb, surf, out) {
  const R = BEAM_R + 0.008, tube = 0.0075;
  const bottomC = BEAM_Y - BEAM_R - 0.006, topC = surf + 0.007;
  const Ry = (topC - bottomC) / 2, yc = (topC + bottomC) / 2, ky = Ry / R;
  const wraps = rng() < 0.5 ? 2 : 3;
  for (let w = 0; w < wraps; w++) {
    const t = new T.TorusGeometry(R, tube, 3, 8);
    t.rotateY(Math.PI / 2); t.scale(1, ky, 1);
    t.rotateZ((rng() - 0.5) * 0.12);
    t.translate(x + (w - (wraps - 1) / 2) * 0.019, yc, zb);
    out.push(t);
  }
  const side = rng() < 0.5 ? -1 : 1;
  const k = new T.IcosahedronGeometry(0.016, 0);
  k.scale(1.3, 0.9, 1); k.translate(x + (rng() - 0.5) * 0.02, yc + 0.012, zb + side * (R + 0.004));
  out.push(k);
}

// Builds one tile's merged parts: [{name, color, geometry, castShadow}] in tile-local space.
function floorParts(T, index) {
  const rng = makeRng(index);

  // Plank layout: 3 or 4 wide boards running along Z, uneven widths, gaps ~0.016-0.03.
  const n = rng() < 0.35 ? 3 : 4, pitch = 2 / n;
  const bounds = [-1];
  for (let k = 1; k < n; k++) bounds.push(-1 + k * pitch + (rng() - 0.5) * 0.12);
  bounds.push(1);
  const beamZ = [-0.78 + (rng() - 0.5) * 0.03, 0.78 + (rng() - 0.5) * 0.03];
  const tileEnd = () => ({slope:0, depth:0.01, chip:false});
  const splits = new Set(); const splitCount = rng() < 0.6 ? 1 : 2;
  while (splits.size < splitCount) splits.add(Math.floor(rng() * n));

  const pieces = [];
  for (let i = 0; i < n; i++) {
    const x0 = bounds[i] + (i === 0 ? 0.003 : 0.008 + rng() * 0.007);
    const x1 = bounds[i + 1] - (i === n - 1 ? 0.003 : 0.008 + rng() * 0.007);
    const base = {i, x0, x1, top:0.197 - rng() * 0.011, roll:(rng() - 0.5) * 0.016, warp:(rng() - 0.5) * 0.004,
      uOff:(rng() - 0.5) * 0.06, flipU:rng() < 0.5, flipV:rng() < 0.5, color:PLANK_COLORS[Math.floor(rng() * PLANK_COLORS.length)]};
    if (splits.has(i)) {
      const seam = (rng() < 0.5 ? -1 : 1) * (0.15 + rng() * 0.4), slope = (rng() - 0.5) * 0.5;
      const seamEnd = () => ({slope, depth:0.008, chip:true});
      pieces.push({...base, za:-0.997, zb:seam - 0.005, endA:tileEnd(), endB:seamEnd()});
      const other = {...base, top:0.197 - rng() * 0.011, roll:(rng() - 0.5) * 0.016, flipV:!base.flipV,
        color:PLANK_COLORS[Math.floor(rng() * PLANK_COLORS.length)]};
      pieces.push({...other, za:seam + 0.005, zb:0.997, endA:seamEnd(), endB:tileEnd()});
    } else pieces.push({...base, za:-0.997, zb:0.997, endA:tileEnd(), endB:tileEnd()});
  }

  // Every plank is drawn with PLANK_COLORS[0]'s material; each plank's own colour is a vertex-colour multiplier
  // (its colour / the base colour, linear), so the planks cost one draw instead of one per colour.
  const planks = [], nails = [], ropes = [], beams = [], caps = [];
  const shade = makeRng('shade:' + (index ?? 0)); // own stream: per-plank shading never moves the layout
  for (const p of pieces) planks.push(tint(T, plankGeometry(T, rng, p), p, shade));

  // Logs underneath, parallel to X.
  for (const z of beamZ) { const b = beamParts(T, rng, z); beams.push(b.beam); caps.push(...b.caps); }
  const under = new T.PlaneGeometry(2, 2); under.rotateX(-Math.PI / 2); under.translate(0, UNDERLAY_Y, 0); const underlay=[under];

  // Rope lashings: a sparse random few per log (one to two), so the wraps do not repeat as a pattern tile after tile.
  const lashed = new Set();
  const pieceAt = (i, z) => pieces.find(p => p.i === i && z > p.za + 0.08 && z < p.zb - 0.08);
  for (const [bi, z] of beamZ.entries()) {
    const inner = 1 + Math.floor(rng() * (n - 2)), first = Math.floor(rng() * 3);
    for (const [k, i] of [0, n - 1, inner].entries()) {
      if (k !== first && rng() < 0.7) continue;
      const p = pieceAt(i, z); if (!p) continue;
      const x = (p.x0 + p.x1) / 2 + (rng() - 0.5) * 0.03;
      lashing(T, rng, x, z, plankSurface(p, x, z), ropes); lashed.add(i + ':' + bi);
    }
  }

  // Nail heads where planks cross the logs.
  for (const p of pieces) {
    const i = p.i;
    for (const [bi, z0] of beamZ.entries()) {
      if (z0 < p.za + 0.06 || z0 > p.zb - 0.06) continue;
      const hw = (p.x1 - p.x0) / 2, xc = (p.x0 + p.x1) / 2;
      const xs = lashed.has(i + ':' + bi) ? [xc - hw * 0.7, xc + hw * 0.7] : rng() < 0.5 ? [xc - hw * 0.55, xc + hw * 0.55] : [xc - hw * 0.62, xc + (rng() - 0.5) * hw * 0.2, xc + hw * 0.62];
      for (const x of xs) {
        const z = z0 + (rng() - 0.5) * 0.03;
        const h = new T.CylinderGeometry(0.012, 0.0135, 0.007, 10);
        h.setIndex(Array.from(h.index.array.slice(0, h.groups[2].start))); // bottom cap is buried in the plank
        h.rotateY(rng() * 1.05); h.translate(x, plankSurface(p, x, z) + 0.0005, z);
        nails.push(h);
      }
    }
  }

  const parts = [];
  const add = (geos, color, name, castShadow = true) => parts.push({name, color, geometry:merge(T, geos), castShadow});
  add(planks, PLANK_COLORS[0], 'floor-planks');
  add(beams, BEAM_COLOR, 'floor-logs');
  add(caps, BEAM_END_COLOR, 'floor-log-ends');
  add(underlay, BEAM_COLOR, 'floor-underlay', false);
  if (ropes.length) add(ropes, ROPE_COLOR, 'floor-lashings', false); // thin rope: shadow is invisible, skip the shadow pass
  if (nails.length) add(nails, NAIL_COLOR, 'floor-nails', false);
  return parts;
}

const defaultMat = T => c => new T.MeshStandardMaterial({color:c, roughness:0.95});

// Per-vertex plank colour: its colour / the base colour (linear), times a per-plank shade and warmth, a slow
// along-the-grain variation, grime toward the board ends, and baked contact shade (bevels, sides and the
// underside darken with depth below the walking surface, so seams between boards read dark).
function tint(T, g, p, rnd) {
  const c = new T.Color(p.color), b = new T.Color(PLANK_COLORS[0]), pos = g.attributes.position, nor = g.attributes.normal;
  const n = pos.count, a = new Float32Array(n * 3);
  const lum = 0.88 + rnd() * 0.2, warm = (rnd() - 0.35) * 0.08, ph = rnd() * 6.28, fq = 2 + rnd() * 3;
  const r = c.r / b.r * lum * (1 + warm), gg = c.g / b.g * lum, bb = c.b / b.b * lum * (1 - warm * 1.4);
  const xc = (p.x0 + p.x1) / 2;
  const endZ = (e, z0, x) => z0 + e.slope * (x - xc);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ny = nor.getY(i);
    let f = 1 + 0.06 * Math.sin(z * fq + ph);
    if (ny > 0.97) { // walking surface: grime on the end-grain vertices (fades over the first stretch of board)
      const dEnd = Math.min(Math.abs(z - endZ(p.endA, p.za, x)), Math.abs(z - endZ(p.endB, p.zb, x)));
      if (dEnd < 0.035) f *= 0.8;
    } else { // bevel, sides, underside: contact shade by depth below the surface
      const d = Math.max(0, plankSurface(p, x, z) - y);
      f *= Math.max(0.24, 0.86 - d * 32);
    }
    a[i * 3] = r * f; a[i * 3 + 1] = gg * f; a[i * 3 + 2] = bb * f;
  }
  g.setAttribute('color', new T.BufferAttribute(a, 3));
  return g;
}
// The base plank material with vertexColors on (a clone sharing its textures; cached per source material, never disposed here).
const plankMats = new WeakMap();
function partMaterial(mat, p) {
  const m = mat(p.color);
  if (p.name !== 'floor-planks') return m;
  if (!plankMats.has(m)) { // shared: raft rebuilds keep it (and its textures)
    const v = m.clone(); v.vertexColors = true; v.userData.shared = true;
    if (m.onBeforeCompile !== v.onBeforeCompile) { v.onBeforeCompile = m.onBeforeCompile; v.customProgramCacheKey = m.customProgramCacheKey; } // clone() drops shader patches (wood bump)
    plankMats.set(m, v);
  }
  return plankMats.get(m);
}

export function createFloor(T, index = 0, getMaterial) {
  const mat = getMaterial || defaultMat(T);
  const g = new T.Group(); g.name = 'raft-floor';
  for (const p of floorParts(T, index)) {
    const mesh = new T.Mesh(p.geometry, partMaterial(mat, p)); mesh.name = p.name;
    mesh.castShadow = p.castShadow; mesh.receiveShadow = true; g.add(mesh);
    if (p.name === 'floor-planks') mesh.userData.color = p.color; // paint: base colour for tinting
  }
  g.userData.kind = 'floor';
  g.userData.index = index;
  g.userData.topY = FLOOR_TOP;
  g.userData.bounds = FLOOR_BOUNDS;
  g.userData.dispose = () => g.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  return g;
}

// Whole raft floor in as few draw calls as possible: every tile is built, its transform baked in,
// and all parts sharing a material and shadow mode are merged into one mesh.
// tiles: [{index, x, z}] (x,z = tile origin in raft-local units). Returns a Group; dispose via userData.dispose().
// tint(t, plankColor) -> hex|null (optional, paint): painted tiles' planks go in their own bucket, drawn with tintMat(hex).
export function createRaftMesh(T, tiles, getMaterial, tint = null, tintMat = null) {
  const mat = getMaterial || defaultMat(T);
  const buckets = new Map(), m4 = new T.Matrix4();
  for (const t of tiles) {
    m4.makeTranslation(t.x, 0, t.z);
    for (const p of floorParts(T, t.index)) {
      p.geometry.applyMatrix4(m4);
      const hex = tint && p.name === 'floor-planks' ? tint(t, p.color) : null;
      const key = hex ? 'tint|' + hex : p.color + '|' + p.castShadow;
      if (!buckets.has(key)) buckets.set(key, {name:p.name, color:hex || p.color, tinted:!!hex, castShadow:p.castShadow, list:[]});
      buckets.get(key).list.push(p.geometry);
    }
  }
  const g = new T.Group(); g.name = 'raft-floors';
  for (const b of buckets.values()) {
    const mesh = new T.Mesh(merge(T, b.list), b.name === 'floor-underlay' ? underlayMat(T) : partMaterial(b.tinted && tintMat ? tintMat : mat, b)); mesh.name = b.name; // painted planks keep their per-plank vertex shades
    mesh.castShadow = b.castShadow; mesh.receiveShadow = true; g.add(mesh);
  }
  g.userData.kind = 'floors';
  g.userData.topY = FLOOR_TOP;
  g.userData.tiles = tiles.map(t => ({...t}));
  g.userData.dispose = () => g.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  return g;
}
