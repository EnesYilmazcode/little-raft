// Original procedural raft foundation tile: hand-cut weathered planks lashed onto two round logs.
// Usage: import { createFloor } from './deck.js?build=v3-survival-ae77fa84ac2b';
//        const g = createFloor(T, index, color => material); g.position.set(x * 2, 0, z * 2);
// Local bounds: x,z in [-1, 1], y in [0, ~0.2]. Walkable top surface FLOOR_TOP = 0.20 (unevenness <= 0.017).
// createFloor builds fresh geometry per call (dispose via g.userData.dispose()). Materials come from getMaterial and are never disposed here.

export const FLOOR_TOP = 0.2;
export const FLOOR_BOUNDS = Object.freeze({minX:-1, maxX:1, minY:0, maxY:0.2, minZ:-1, maxZ:1});

const PLANK_COLORS = ['#bb8a53', '#c69860', '#ad7c4a'];
const BEAM_COLOR = '#5e4029', BEAM_END_COLOR = '#9c7649', ROPE_COLOR = '#a8946c', NAIL_COLOR = '#4b4844';
const BEV = 0.011, BEV_T = 0.01, THICK = 0.052;
const BEAM_R = 0.064, BEAM_Y = 0.072, BEAM_HALF = 0.985;

function makeRng(index) {
  let h = 2166136261 >>> 0; const s = String(index ?? 0);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  let a = (h >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Flatten geometries into one non-indexed set of position/normal/uv arrays. Sources are disposed.
function flatten(geos) {
  let count = 0;
  const parts = geos.map(g => { const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose(); count += n.attributes.position.count; return n; });
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  let o = 0;
  for (const g of parts) {
    const a = g.attributes, c = a.position.count;
    pos.set(a.position.array.subarray(0, c * 3), o * 3);
    if (a.normal) nor.set(a.normal.array.subarray(0, c * 3), o * 3);
    if (a.uv) uv.set(a.uv.array.subarray(0, c * 2), o * 2);
    o += c; g.dispose();
  }
  return {count, pos, nor, uv};
}

function toGeometry(T, attrs) {
  const out = new T.BufferGeometry();
  for (const [k, n] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) if (attrs[k]) out.setAttribute(k, new T.BufferAttribute(attrs[k], n));
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
    let u = 0.5 + (x - xc) / 0.34 + p.uOff, v = 0.03 + (z + 1) * 0.47;
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
  const R = BEAM_R + 0.008, tube = 0.0055;
  const bottomC = BEAM_Y - BEAM_R - 0.006, topC = surf + 0.007;
  const Ry = (topC - bottomC) / 2, yc = (topC + bottomC) / 2, ky = Ry / R;
  const wraps = 2;
  for (let w = 0; w < wraps; w++) {
    const t = new T.TorusGeometry(R, tube, 3, 6);
    t.rotateY(Math.PI / 2); t.scale(1, ky, 1);
    t.rotateZ((rng() - 0.5) * 0.12);
    t.translate(x + (w - (wraps - 1) / 2) * 0.02, yc, zb);
    out.push(t);
  }
  const side = rng() < 0.5 ? -1 : 1;
  const k = new T.IcosahedronGeometry(0.016, 0);
  k.scale(1.3, 0.9, 1); k.translate(x + (rng() - 0.5) * 0.02, yc + 0.012, zb + side * (R + 0.004));
  out.push(k);
}

// Builds one tile's merged parts: [{name, color, castShadow, count, pos, nor, uv}] (flat arrays, tile-local space).
function floorParts(T, index) {
  const rng = makeRng(index);

  // Plank layout: 7 or 8 planks running along Z, uneven widths, gaps <= ~0.022.
  const n = rng() < 0.3 ? 7 : 8, pitch = 2 / n;
  const bounds = [-1];
  for (let k = 1; k < n; k++) bounds.push(-1 + k * pitch + (rng() - 0.5) * 0.05);
  bounds.push(1);
  const beamZ = [-0.78 + (rng() - 0.5) * 0.03, 0.78 + (rng() - 0.5) * 0.03];
  const tileEnd = () => ({slope:0, depth:0.01, chip:false});
  const splits = new Set(); const splitCount = rng() < 0.5 ? 1 : 2;
  while (splits.size < splitCount) splits.add(Math.floor(rng() * n));

  const pieces = [];
  for (let i = 0; i < n; i++) {
    const x0 = bounds[i] + (i === 0 ? 0.003 : 0.005 + rng() * 0.006);
    const x1 = bounds[i + 1] - (i === n - 1 ? 0.003 : 0.005 + rng() * 0.006);
    const base = {i, x0, x1, top:0.197 - rng() * 0.011, roll:(rng() - 0.5) * 0.016, warp:(rng() - 0.5) * 0.004,
      uOff:(rng() - 0.5) * 0.08, flipU:rng() < 0.5, flipV:rng() < 0.5, color:PLANK_COLORS[Math.floor(rng() * PLANK_COLORS.length)]};
    if (splits.has(i)) {
      const seam = (rng() < 0.5 ? -1 : 1) * (0.15 + rng() * 0.4), slope = (rng() - 0.5) * 0.5;
      const seamEnd = () => ({slope, depth:0.008, chip:true});
      pieces.push({...base, za:-0.997, zb:seam - 0.005, endA:tileEnd(), endB:seamEnd()});
      const other = {...base, top:0.197 - rng() * 0.011, roll:(rng() - 0.5) * 0.016, flipV:!base.flipV,
        color:PLANK_COLORS[Math.floor(rng() * PLANK_COLORS.length)]};
      pieces.push({...other, za:seam + 0.005, zb:0.997, endA:seamEnd(), endB:tileEnd()});
    } else pieces.push({...base, za:-0.997, zb:0.997, endA:tileEnd(), endB:tileEnd()});
  }

  const byColor = new Map(), nails = [], ropes = [], beams = [], caps = [];
  for (const p of pieces) {
    if (!byColor.has(p.color)) byColor.set(p.color, []);
    byColor.get(p.color).push(plankGeometry(T, rng, p));
  }

  // Logs underneath, parallel to X.
  for (const z of beamZ) { const b = beamParts(T, rng, z); beams.push(b.beam); caps.push(...b.caps); }

  // Rope lashings: four corners plus one inner plank on each log.
  const lashed = new Set();
  const pieceAt = (i, z) => pieces.find(p => p.i === i && z > p.za + 0.08 && z < p.zb - 0.08);
  for (const [bi, z] of beamZ.entries()) {
    const inner = 1 + Math.floor(rng() * (n - 2));
    for (const i of [0, n - 1, inner]) {
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
      const xs = lashed.has(i + ':' + bi) ? [xc - hw * 0.62, xc + hw * 0.62] : rng() < 0.4 ? [xc + (rng() - 0.5) * hw * 0.5] : [xc - hw * 0.5, xc + hw * 0.5];
      for (const x of xs) {
        const z = z0 + (rng() - 0.5) * 0.03;
        const h = new T.CylinderGeometry(0.0105, 0.012, 0.008, 6);
        h.setIndex(Array.from(h.index.array.slice(0, h.groups[2].start))); // bottom cap is buried in the plank
        h.rotateY(rng() * 1.05); h.translate(x, plankSurface(p, x, z) + 0.0005, z);
        nails.push(h);
      }
    }
  }

  const parts = [];
  const add = (geos, color, name, castShadow = true) => parts.push({name, color, castShadow, ...flatten(geos)});
  for (const [color, list] of byColor) add(list, color, 'floor-planks');
  add(beams, BEAM_COLOR, 'floor-logs');
  add(caps, BEAM_END_COLOR, 'floor-log-ends');
  if (ropes.length) add(ropes, ROPE_COLOR, 'floor-lashings', false); // thin rope: shadow is invisible, skip the shadow pass
  if (nails.length) add(nails, NAIL_COLOR, 'floor-nails', false);
  return parts;
}

const defaultMat = T => c => new T.MeshStandardMaterial({color:c, roughness:0.86});

export function createFloor(T, index = 0, getMaterial) {
  const mat = getMaterial || defaultMat(T);
  const g = new T.Group(); g.name = 'raft-floor';
  for (const p of floorParts(T, index)) {
    const mesh = new T.Mesh(toGeometry(T, {position:p.pos, normal:p.nor, uv:p.uv}), mat(p.color)); mesh.name = p.name;
    mesh.castShadow = p.castShadow; mesh.receiveShadow = true; g.add(mesh);
  }
  g.userData.kind = 'floor';
  g.userData.index = index;
  g.userData.topY = FLOOR_TOP;
  g.userData.bounds = FLOOR_BOUNDS;
  g.userData.dispose = () => g.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  return g;
}

// Tile parts are pure functions of the tile index: build each once and keep the flat tile-local arrays.
// Entries for tiles no longer on the raft are dropped once the cache grows well past the raft.
const partCache = new Map();
function cachedParts(T, index) {
  let p = partCache.get(index);
  if (!p) { p = floorParts(T, index); partCache.set(index, p); }
  return p;
}
const linear = new Map(); // part hex -> [r, g, b] linear, for the vertex-coloured meshes
function linearRGB(T, hex) {
  if (!linear.has(hex)) { const c = new T.Color(hex); linear.set(hex, [c.r, c.g, c.b]); }
  return linear.get(hex);
}

// Rafts above this many tiles are split into CHUNK x CHUNK-tile meshes so the camera and shadow frustums can
// cull them, and placing a tile re-merges only its chunk.
export const CHUNK = 4, CHUNK_MIN_TILES = 26;

const TIMBER_PARTS = new Set(['floor-planks', 'floor-logs', 'floor-log-ends']), TRIM_PARTS = new Set(['floor-lashings', 'floor-nails']);

// One chunk: every part sharing a material and shadow mode merged into one mesh, tile offsets added while copying.
// With opts.timberMaterial / opts.trimMaterial (vertexColors) the part colours become vertex colours instead.
function buildChunk(T, tiles, mat, opts) {
  const buckets = new Map();
  for (const t of tiles) {
    for (const p of cachedParts(T, t.index)) {
      const shared = opts.timberMaterial && TIMBER_PARTS.has(p.name) ? opts.timberMaterial : opts.trimMaterial && TRIM_PARTS.has(p.name) ? opts.trimMaterial : null;
      const key = shared ? shared.uuid : p.color + '|' + p.castShadow;
      let b = buckets.get(key);
      if (!b) buckets.set(key, b = {name:shared ? (shared === opts.timberMaterial ? 'floor-timber' : 'floor-trim') : p.name, color:p.color, castShadow:p.castShadow, shared, count:0, list:[]});
      b.list.push({p, x:t.x, z:t.z}); b.count += p.count;
    }
  }
  const g = new T.Group(); g.name = 'raft-chunk';
  for (const b of buckets.values()) {
    const pos = new Float32Array(b.count * 3), nor = new Float32Array(b.count * 3), uv = new Float32Array(b.count * 2);
    const col = b.shared ? new Float32Array(b.count * 3) : null;
    let o = 0;
    for (const {p, x, z} of b.list) {
      const c = p.count, src = p.pos, base = o * 3;
      for (let i = 0; i < c * 3; i += 3) { pos[base + i] = src[i] + x; pos[base + i + 1] = src[i + 1]; pos[base + i + 2] = src[i + 2] + z; }
      nor.set(p.nor, base); uv.set(p.uv, o * 2);
      if (col) { const [r, gg, bb] = linearRGB(T, p.color); for (let i = 0; i < c * 3; i += 3) { col[base + i] = r; col[base + i + 1] = gg; col[base + i + 2] = bb; } }
      o += c;
    }
    const mesh = new T.Mesh(toGeometry(T, {position:pos, normal:nor, uv, color:col}), b.shared || mat(b.color)); mesh.name = b.name;
    mesh.castShadow = b.castShadow; mesh.receiveShadow = true; g.add(mesh);
  }
  return g;
}

// Whole raft floor in few draw calls. tiles: [{index, x, z}] (x,z = tile origin in raft-local units).
// opts.timberMaterial: a vertexColors timber material for planks, logs and log ends (one shadow-casting mesh per chunk);
// opts.trimMaterial: a vertexColors plain material for rope lashings and nail heads (one mesh per chunk, no shadow).
// opts.prev: the previous createRaftMesh group; chunks whose tiles are unchanged move over instead of being rebuilt
// (call prev.userData.dispose() afterwards to free the rest). Returns a Group; dispose via userData.dispose().
export function createRaftMesh(T, tiles, getMaterial, opts = {}) {
  const mat = getMaterial || defaultMat(T), timberMaterial = opts.timberMaterial || null, trimMaterial = opts.trimMaterial || null, prev = opts.prev || null;
  const chunked = tiles.length >= CHUNK_MIN_TILES, size = 2 * CHUNK, chunks = new Map();
  for (const t of tiles) {
    const k = chunked ? Math.floor(t.x / size) + ',' + Math.floor(t.z / size) : '*';
    if (!chunks.has(k)) chunks.set(k, []);
    chunks.get(k).push(t);
  }
  const old = new Map();
  if (prev) for (const c of prev.children) if (c.userData.timberMaterial === timberMaterial && c.userData.trimMaterial === trimMaterial && c.userData.mat === mat) old.set(c.userData.chunk, c);
  const g = new T.Group(); g.name = 'raft-floors';
  for (const [k, list] of chunks) {
    const sig = list.map(t => t.index + ':' + t.x + ':' + t.z).join(';'), o = old.get(k);
    if (o && o.userData.sig === sig) { g.add(o); continue; } // add() detaches it from prev
    const c = buildChunk(T, list, mat, {timberMaterial, trimMaterial});
    Object.assign(c.userData, {chunk:k, sig, timberMaterial, trimMaterial, mat});
    g.add(c);
  }
  if (partCache.size > tiles.length * 2 + 32) { // drop tiles that left the raft (lazily: other callers share the cache)
    const keep = new Set(tiles.map(t => t.index));
    for (const i of partCache.keys()) if (!keep.has(i)) partCache.delete(i);
  }
  g.userData.kind = 'floors';
  g.userData.topY = FLOOR_TOP;
  g.userData.tiles = tiles.map(t => ({...t}));
  g.userData.dispose = () => g.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  return g;
}
