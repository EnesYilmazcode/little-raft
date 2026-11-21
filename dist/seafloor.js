// Little Raft - seafloor: pure height/node helpers + a light THREE builder.
//
// Pure (node-safe, no THREE): FLOOR, seafloorHeight, NODE_TYPES, NODE_LOOT,
// nodeAt, nodeById. Everything is deterministic hash-based value noise, so the
// host can validate a gather request with nodeById(id) + distance alone.
//
// Usage:
//   import { createSeafloor, nodeById } from './seafloor.js?build=v3-survival-ae77fa84ac2b';
//   const floor = createSeafloor(THREE, { islands });
//   scene.add(floor.group);
//   // every frame: floor.update(dt, camera, time);  floor.uniforms.uCaustic.value = 0..1
//   floor.nodesNear(x, y, z, 2.8)  -> [{id, type, x, y, z}]  (gathered ones skipped)
//   floor.setGathered(id) / floor.setGathered(id, false); floor.isGathered(id);
//   floor.highlight(id | null)  // targeted node: 1.06 scale + gentle emissive pulse
//   floor.dispose();
//
// Art: one camera-following floor patch (vertex-coloured sand, darker patches),
// instanced rocks, instanced swaying seaweed and InstancedMesh(es) per node type.
// Animated caustics are added to emissive in onBeforeCompile (world xz + uTime).
// The patch, decor and node instances are rebuilt only when the RECENTER-snapped
// camera xz changes (patch vertices stay on a fixed world lattice); capacities are fixed.

export const FLOOR = { BASE: -11, MIN_DEPTH_UNDER_RAFT: -7, SHALLOWEST: -0.9, CELL: 4, PATCH: 96, SEGMENTS: 64 };
export const NODE_TYPES = ['sand', 'clay', 'scrap', 'metalore'];
export const NODE_LOOT = { sand: { sand: 1 }, clay: { clay: 1 }, scrap: { scrap: 1 }, metalore: { metalore: 1 } };

const NODE_MAX_Y = -1.5;          // no nodes where the floor is shallower than this
const NODE_CHANCE = 0.22;         // per CELL
const NODE_WEIGHTS = [0.35, 0.25, 0.22, 0.18];
const CELL_LIMIT = 100000;        // reject absurd ids
const RECENTER = 16;              // patch recentre grid (m); 96 m patch keeps >= 40 m around the camera (fog far <= 34 m)

// ---------- deterministic noise ----------
function hash(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, v) => smooth(Math.min(1, Math.max(0, (v - a) / (b - a))));
// Reference value noise; latticeHeights below runs a hand-inlined copy (keep the two in step).
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
const CAP_FAR = FLOOR.MIN_DEPTH_UNDER_RAFT + (FLOOR.SHALLOWEST - FLOOR.MIN_DEPTH_UNDER_RAFT) * smoothstep(9, 20, 20);

// Seafloor heights for `count` points (ox + offs[3i], oz + offs[3i+2]) into out; with sand != null also the
// sand-colour noise vnoise(x/14, z/14, 31) per point. vnoise and hash are hand-inlined (same integer and float
// ops in the same order, so bit-identical to the functions above): this is the patch-rebuild hot loop, and V8
// boxed every double crossing a non-inlined call (~1 MB of garbage per rebuild). seafloorHeight runs it for one point.
function latticeHeights(out, sand, count, ox, oz, offs, islands) {
  const octaves = sand ? 4 : 3;
  for (let i = 0, i3 = 0; i < count; i++, i3 += 3) {
    const x = ox + offs[i3], z = oz + offs[i3 + 2];
    let n = 0;   // 0.6*vnoise(x/23,z/23,11) + 0.3*vnoise(x/9,z/9,12) + 0.1*vnoise(x/3.5,z/3.5,13), left to right
    for (let o = 0; o < octaves; o++) {
      const sc = o === 0 ? 23 : o === 1 ? 9 : o === 2 ? 3.5 : 14, px = x / sc, pz = z / sc;
      const ix = Math.floor(px), iz = Math.floor(pz), fx = smooth(px - ix), fz = smooth(pz - iz);
      const sd = Math.imul(o < 3 ? 11 + o : 31, 1442695041);
      const x0 = Math.imul(ix, 374761393), x1 = Math.imul(ix + 1, 374761393);
      const z0 = Math.imul(iz, 668265263) ^ sd, z1 = Math.imul(iz + 1, 668265263) ^ sd;
      let h = x0 ^ z0; h = Math.imul(h ^ (h >>> 13), 1274126177); const a = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      h = x1 ^ z0; h = Math.imul(h ^ (h >>> 13), 1274126177); const b = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      h = x0 ^ z1; h = Math.imul(h ^ (h >>> 13), 1274126177); const c = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      h = x1 ^ z1; h = Math.imul(h ^ (h >>> 13), 1274126177); const d = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      const v = a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
      if (o < 3) n += (o === 0 ? 0.6 : o === 1 ? 0.3 : 0.1) * v; else sand[i] = v;
    }
    let h = FLOOR.BASE + (n - 0.5) * 5;                    // about -13.5 .. -8.5
    let t = 0;                                             // island shelf influence
    for (let k = 0; k < islands.length; k++) {
      const isl = islands[k], r = isl.r ?? 5, dx = x - isl.x, dz = z - isl.z;
      if (dx * dx + dz * dz >= (r + 40) * (r + 40)) continue;   // outside the shelf: contributes 0
      t = Math.max(t, 1 - smoothstep(r, r + 40, Math.hypot(dx, dz)));
    }
    h += (FLOOR.SHALLOWEST - h) * t;
    // keep the raft area deep: cap rises smoothly from -7 (<= 9 m) to SHALLOWEST (>= 20 m)
    const cap = x * x + z * z >= 400 ? CAP_FAR
      : FLOOR.MIN_DEPTH_UNDER_RAFT + (FLOOR.SHALLOWEST - FLOOR.MIN_DEPTH_UNDER_RAFT) * smoothstep(9, 20, Math.hypot(x, z));
    out[i] = Math.min(h, cap, FLOOR.SHALLOWEST);
  }
}
const ONE = new Float64Array(1), ORIGIN = new Float32Array(3);

/** Deterministic world y of the seafloor. Always <= FLOOR.SHALLOWEST. */
export function seafloorHeight(x, z, islands = []) {
  latticeHeights(ONE, null, 1, x, z, ORIGIN, islands);   // x + 0 === x (bar -0, which gives the same height)
  return ONE[0];
}

/** Gatherable node in integer cell (cx, cz), or null. */
export function nodeAt(cx, cz, islands = []) {
  if (!Number.isInteger(cx) || !Number.isInteger(cz) || Math.abs(cx) > CELL_LIMIT || Math.abs(cz) > CELL_LIMIT) return null;
  if (hash(cx, cz, 21) >= NODE_CHANCE) return null;
  const C = FLOOR.CELL;
  const x = (cx + 0.2 + 0.6 * hash(cx, cz, 22)) * C;
  const z = (cz + 0.2 + 0.6 * hash(cx, cz, 23)) * C;
  const y = seafloorHeight(x, z, islands);
  if (y > NODE_MAX_Y) return null;
  let r = hash(cx, cz, 24), i = 0;
  while (i < NODE_TYPES.length - 1 && r >= NODE_WEIGHTS[i]) r -= NODE_WEIGHTS[i++];
  return { id: `${cx},${cz}`, type: NODE_TYPES[i], x, y, z };
}

/** Parse "cx,cz" -> nodeAt(cx, cz) or null for junk. */
export function nodeById(id, islands = []) {
  const m = typeof id === 'string' && /^(-?\d{1,6}),(-?\d{1,6})$/.exec(id);
  if (!m) return null;
  const node = nodeAt(Number(m[1]), Number(m[2]), islands);
  return node && node.id === id ? node : null;   // rejects "-0,1", "01,2" etc.
}

// Floor patch positions + sand colours from latticeHeights' unrounded heights (ys) and sand noise.
// Closure-free with hash(x/STEP, z/STEP, 32) hand-inlined, for the same reason as latticeHeights.
function fillPatch(pos, col, heights, ys, sand, baseXZ, ox, oz, STEP, SAND, LIGHT, DARK) {
  const s0 = SAND[0], s1 = SAND[1], s2 = SAND[2], d0 = DARK[0], d1 = DARK[1], d2 = DARK[2];
  const l0 = LIGHT[0] - s0, l1 = LIGHT[1] - s1, l2 = LIGHT[2] - s2, seed = Math.imul(32, 1442695041);
  for (let i = 0, i3 = 0; i < ys.length; i++, i3 += 3) {
    const x = ox + baseXZ[i3], z = oz + baseXZ[i3 + 2], y = ys[i], n = sand[i];
    heights[i] = y; pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z;
    const light = smoothstep(0.42, 0.2, n) * 0.7, dark = smoothstep(0.55, 0.78, n) * 0.85;
    let h = Math.imul(Math.round(x / STEP), 374761393) ^ Math.imul(Math.round(z / STEP), 668265263) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const k = 1 - (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 0.06 - Math.min(1, Math.max(0, (-y - 2) / 12)) * 0.15;
    const b0 = s0 + l0 * light, b1 = s1 + l1 * light, b2 = s2 + l2 * light;
    col[i3] = (b0 + (d0 - b0) * dark) * k; col[i3 + 1] = (b1 + (d1 - b1) * dark) * k; col[i3 + 2] = (b2 + (d2 - b2) * dark) * k;
  }
}

// ---------- THREE builder ----------
const CAP = { rocks: 140, weed: 420, node: 128 };
const PAL = {
  sand: 0xd8c28f, sandLight: 0xe6d6a8, sandDark: 0xb39a6a,
  rock: 0x6f7f7a, rockShade: 0x55635f, moss: 0x6f8d5e,
  weed: 0x3f9a5a, weedTip: 0x8fcf6a, kelp: 0x2f7d64,
};

const CAUSTIC_GLSL = /* glsl */`
uniform float uTime;
uniform float uCaustic;
varying vec3 vCausticPos;
float lrCaustic(vec2 p, float t) {
  vec2 q = p * 0.55;
  float a = sin(q.x * 1.7 + sin(q.y * 1.3 + t * 0.9) * 1.5 + t * 0.6);
  float b = sin(q.y * 1.9 + sin(q.x * 1.1 - t * 0.7) * 1.5 - t * 0.5);
  float c = sin((q.x + q.y) * 1.2 + t * 0.8);
  return pow(1.0 - abs(a + b + c) / 3.0, 7.0);
}
`;

// Adds caustics (and optional seaweed sway) to a MeshStandardMaterial.
function addCaustics(mat, uniforms, sway) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uCaustic = uniforms.uCaustic;
    let vs = CAUSTIC_GLSL + shader.vertexShader;
    if (sway) {
      vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
        float lrH = clamp(position.y / 1.6, 0.0, 1.0); lrH *= lrH;
        vec3 lrP = vec3(0.0);
        #ifdef USE_INSTANCING
          lrP = instanceMatrix[3].xyz;
        #endif
        transformed.x += sin(uTime * 1.3 + lrP.x * 0.7 + lrP.z * 0.5) * 0.28 * lrH;
        transformed.z += cos(uTime * 1.05 + lrP.z * 0.6 - lrP.x * 0.3) * 0.2 * lrH;`);
    }
    shader.vertexShader = vs.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 lrW = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        lrW = instanceMatrix * lrW;
      #endif
      vCausticPos = (modelMatrix * lrW).xyz;`);
    // caustic colour #d9fff0 (linear ~0.69, 1.0, 0.87)
    shader.fragmentShader = CAUSTIC_GLSL + shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float lrFade = uCaustic * clamp(1.0 + vCausticPos.y / 18.0, 0.2, 1.0);
      totalEmissiveRadiance += vec3(0.69, 1.0, 0.87) * (lrCaustic(vCausticPos.xz, uTime) * 0.5 * lrFade);`);
  };
  mat.customProgramCacheKey = () => (sway ? 'lr-caustic-sway' : 'lr-caustic');
  return mat;
}

// Concatenate geometries into one non-indexed geometry with position/normal/color.
function merge(T, geos) {
  const pos = [], col = [];
  for (let g of geos) {
    if (g.index) g = g.toNonIndexed();
    const p = g.attributes.position, c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      col.push(c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1);
    }
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

// Jitter a polyhedron by vertex position (keeps faces welded) and colour per face
// via faceColor(color, faceIndex, centroidX, centroidY, centroidZ).
function lump(T, geo, jitter, faceColor) {
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position;
  const col = new Float32Array(p.count * 3), c = new T.Color();
  for (let i = 0; jitter && i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + jitter * (hash(Math.round(x * 97), Math.round(y * 97) * 31 + Math.round(z * 97), 5) - 0.5);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  for (let f = 0; f < p.count; f += 3) {
    const cx = (p.getX(f) + p.getX(f + 1) + p.getX(f + 2)) / 3, cy = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3;
    faceColor(c, f / 3, cx, cy, (p.getZ(f) + p.getZ(f + 1) + p.getZ(f + 2)) / 3);
    for (let j = 0; j < 3; j++) c.toArray(col, (f + j) * 3);
  }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// Node art: list of parts { geo, glow (emissive hex), gi (emissive scale), mat (extra material opts) }.
function nodeParts(T, type) {
  const c0 = new T.Color();
  if (type === 'sand') {   // pale mound: sparkles, a few shells, darker base ring
    const g = new T.SphereGeometry(0.6, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1);
    return [{ glow: 0xf3e6bf, geo: lump(T, g, 0.12, (c, f, x, y) => {
      const r = hash(f, 9, 6);
      c.set(y < 0.07 ? 0xb89f6e : r < 0.1 ? 0xf7d9c9 : r < 0.2 ? 0xfffaf0 : 0xf3e6bf);
    }) }];
  }
  if (type === 'clay') {   // squat orange lump, lit top, dark undersides
    const g = new T.DodecahedronGeometry(0.42, 0).scale(1.15, 0.7, 1).translate(0, 0.18, 0);
    return [{ glow: 0xc8703e, geo: lump(T, g, 0.25, (c, f, x, y) =>
      c.set(y > 0.3 ? 0xe08e55 : y < 0.12 ? 0x8f4a2a : 0xc8703e).lerp(c0.set(0x8f4a2a), hash(f, 1, 6) * 0.25)) }];
  }
  if (type === 'scrap') {  // three bent plates leaning together: rusty edges, one painted stripe
    const plates = [];
    for (let k = 0; k < 3; k++) {
      const g = new T.BoxGeometry(0.85, 0.04, 0.45, 6, 1, 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + 0.18 * Math.sin(p.getX(i) * 3.2 + k));
      plates.push(lump(T, g, 0, (c, f, x, y, z) => c.set(
        Math.abs(x) > 0.3 || Math.abs(z) > 0.16 ? 0xb0714a : k === 1 && Math.abs(x) < 0.1 ? 0xd9a441 : 0x9fb2bb))
        .rotateZ(0.35 + k * 0.4).rotateY(k * 2.1).translate(0.12 * (k - 1), 0.22, 0.08 * k));
    }
    return [{ glow: 0x9fb2bb, geo: merge(T, plates), mat: { metalness: 0.45, roughness: 0.55 } }];
  }
  // metalore: dark rock + glowing pale-blue crystal shards (separate part, brighter emissive)
  const g = new T.IcosahedronGeometry(0.45, 1).scale(1.1, 0.75, 1).translate(0, 0.2, 0);
  const rock = lump(T, g, 0.3, (c, f) => c.set(0x3e4650).lerp(c0.set(0x2c323a), hash(f, 3, 7) * 0.6));
  const shards = [[0.22, 0.42, 0.08, 0.5, 0.3], [-0.2, 0.4, -0.12, -0.45, 1.9], [0.02, 0.48, -0.26, 0.2, 4.1], [-0.08, 0.44, 0.24, -0.3, 2.8]]
    .map(([x, y, z, tilt, yaw]) => lump(T, new T.OctahedronGeometry(0.1, 0).scale(0.8, 2.2, 0.8)
      .rotateZ(tilt).rotateY(yaw).translate(x, y, z), 0, (c) => c.set(0x9fd4ff)));
  return [
    { glow: 0x3e4650, geo: rock, mat: { metalness: 0.35, roughness: 0.5 } },
    { glow: 0x9fd4ff, gi: 0.4, geo: merge(T, shards), mat: { metalness: 0.2, roughness: 0.3 } },
  ];
}

function seaweedGeometry(T) {
  const blades = [0, Math.PI / 2].map((rot) => {
    const g = new T.PlaneGeometry(0.5, 1.6, 1, 4).translate(0, 0.8, 0);
    const p = g.attributes.position, cols = new Float32Array(p.count * 3), c = new T.Color(), tip = new T.Color(PAL.weedTip);
    for (let i = 0; i < p.count; i++) {
      const h = p.getY(i) / 1.6;
      p.setX(i, p.getX(i) * (1 - 0.75 * h));
      c.set(PAL.weed).lerp(tip, h).toArray(cols, i * 3);
    }
    g.setAttribute('color', new T.BufferAttribute(cols, 3));
    return g.rotateY(rot);
  });
  return merge(T, blades);
}

export function createSeafloor(T, { islands = [] } = {}) {
  const { CELL, PATCH, SEGMENTS } = FLOOR;
  const STEP = PATCH / SEGMENTS, ROW = SEGMENTS + 1;
  const heightAt = (x, z) => seafloorHeight(x, z, islands);
  const uniforms = { uTime: { value: 0 }, uCaustic: { value: 0 } };
  const group = Object.assign(new T.Group(), { name: 'Seafloor' });
  const std = (o, sway = false) => addCaustics(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, ...o }), uniforms, sway);
  const lin = (hex) => new T.Color(hex).toArray();   // linear rgb (vertex colours are linear)
  const SAND = lin(PAL.sand), LIGHT = lin(PAL.sandLight), DARK = lin(PAL.sandDark);

  // floor patch: rows along +z, columns along +x (PlaneGeometry rotated -90 deg about x)
  const floorGeo = new T.PlaneGeometry(PATCH, PATCH, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2);
  const baseXZ = Float32Array.from(floorGeo.attributes.position.array);
  const heights = new Float32Array(ROW * ROW), ys = new Float64Array(ROW * ROW), sand = new Float64Array(ROW * ROW);
  floorGeo.setAttribute('color', new T.BufferAttribute(new Float32Array(baseXZ.length), 3));
  group.add(Object.assign(new T.Mesh(floorGeo, std({})), { name: 'SeafloorPatch' }));

  // frustumCulled off: instances span the whole patch around the camera
  const inst = (geo, mat, cap, name) => group.add(Object.assign(new T.InstancedMesh(geo, mat, cap), { name, count: 0, frustumCulled: false })).children.at(-1);
  const shade = new T.Color(PAL.rockShade), moss = new T.Color(PAL.moss);
  const rockGeo = lump(T, new T.IcosahedronGeometry(1, 0), 0.45, (c, f, x, y) =>
    (y > 0.35 && hash(f, 5, 8) < 0.7 ? c.copy(moss) : c.set(PAL.rock).lerp(shade, hash(f, 4, 8))));
  const rocks = inst(rockGeo, std({ flatShading: true }), CAP.rocks, 'SeafloorRocks');
  const weed = inst(seaweedGeometry(T), std({ side: T.DoubleSide, roughness: 0.8 }, true), CAP.weed, 'SeafloorWeed');
  const white = new T.Color(1, 1, 1), kelpTint = new T.Color(PAL.kelp), wb = new T.Color(PAL.weed);
  kelpTint.setRGB(kelpTint.r / wb.r, kelpTint.g / wb.g, kelpTint.b / wb.b);   // instanceColor x base = kelp

  // node meshes (instanced) + one plain highlight copy per type with its own pulsing material
  const nodeMeshes = {}, hl = {};
  for (const type of NODE_TYPES) {
    nodeMeshes[type] = [];
    group.add(hl[type] = Object.assign(new T.Group(), { name: `SeafloorHighlight_${type}`, visible: false }));
    for (const part of nodeParts(T, type)) {
      const mk = () => std({ flatShading: true, emissive: new T.Color(part.glow).multiplyScalar(part.gi ?? 0.1), ...part.mat });
      nodeMeshes[type].push(inst(part.geo, mk(), CAP.node, `SeafloorNode_${type}`));
      hl[type].add(new T.Mesh(part.geo, mk()));
    }
  }

  const gathered = new Set();
  let patchNodes = [], hlId = null, hlType = null, centreX = NaN, centreZ = NaN;
  const m4 = new T.Matrix4(), q = new T.Quaternion(), v = new T.Vector3(), s = new T.Vector3(), up = new T.Vector3(0, 1, 0);
  const place = (mesh, x, y, z, yaw, sx, sy = sx, sz = sx) => {
    if (mesh.count >= mesh.instanceMatrix.count) return -1;
    mesh.setMatrixAt(mesh.count, m4.compose(v.set(x, y, z), q.setFromAxisAngle(up, yaw), s.set(sx, sy, sz)));
    return mesh.count++;
  };
  const nodeYaw = (n) => hash(Math.round(n.x * 10), Math.round(n.z * 10), 90) * 6.283;
  const nodeScale = (n) => 0.95 + 0.25 * hash(Math.round(n.x * 10), Math.round(n.z * 10), 91);

  function refreshNodes() {
    for (const type of NODE_TYPES) for (const m of nodeMeshes[type]) m.count = 0;
    hlType = null;
    for (const n of patchNodes) {
      if (gathered.has(n.id)) continue;
      if (n.id === hlId) {   // drawn by the highlight copy instead
        hlType = n.type;
        hl[n.type].position.set(n.x, n.y - 0.04, n.z);
        hl[n.type].rotation.set(0, nodeYaw(n), 0);
        hl[n.type].scale.setScalar(nodeScale(n) * 1.06);
        continue;
      }
      for (const m of nodeMeshes[n.type]) place(m, n.x, n.y - 0.04, n.z, nodeYaw(n), nodeScale(n));
    }
    for (const type of NODE_TYPES) {
      hl[type].visible = type === hlType;
      for (const m of nodeMeshes[type]) m.instanceMatrix.needsUpdate = true;
    }
  }

  function rebuild(cx, cz) {
    // floor vertices on a world-aligned STEP lattice so recentring never shifts the floor
    const ox = Math.round(cx / STEP) * STEP, oz = Math.round(cz / STEP) * STEP;
    const pos = floorGeo.attributes.position.array, col = floorGeo.attributes.color.array, nor = floorGeo.attributes.normal.array;
    latticeHeights(ys, sand, ys.length, ox, oz, baseXZ, islands);
    fillPatch(pos, col, heights, ys, sand, baseXZ, ox, oz, STEP, SAND, LIGHT, DARK);
    // analytic normals from central differences on the height grid (one-sided at the rim)
    for (let r = 0; r < ROW; r++) {
      const r0 = r > 0 ? r - 1 : r, r1 = r < SEGMENTS ? r + 1 : r;
      for (let c = 0; c < ROW; c++) {
        const c0 = c > 0 ? c - 1 : c, c1 = c < SEGMENTS ? c + 1 : c, i = (r * ROW + c) * 3;
        const gx = (heights[r * ROW + c1] - heights[r * ROW + c0]) / ((c1 - c0) * STEP);
        const gz = (heights[r1 * ROW + c] - heights[r0 * ROW + c]) / ((r1 - r0) * STEP);
        const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
        nor[i] = -gx * inv; nor[i + 1] = inv; nor[i + 2] = -gz * inv;
      }
    }
    floorGeo.attributes.position.needsUpdate = floorGeo.attributes.color.needsUpdate = floorGeo.attributes.normal.needsUpdate = true;
    floorGeo.computeBoundingSphere();

    // decor + nodes per CELL inside the patch
    rocks.count = weed.count = 0;
    patchNodes = [];
    const half = Math.floor(PATCH / 2 / CELL), bx = Math.round(cx / CELL), bz = Math.round(cz / CELL);
    for (let iz = bz - half; iz < bz + half; iz++) {
      for (let ix = bx - half; ix < bx + half; ix++) {
        const node = nodeAt(ix, iz, islands);
        if (node) { patchNodes.push(node); continue; }
        const r = hash(ix, iz, 41);
        const x = (ix + hash(ix, iz, 42)) * CELL, z = (iz + hash(ix, iz, 43)) * CELL, y = seafloorHeight(x, z, islands);
        if (r < 0.12 && y < -1.4) {
          const sc = 0.35 + 0.9 * hash(ix, iz, 44);
          place(rocks, x, y - 0.15 * sc, z, r * 60, sc * 1.2, sc * (0.6 + 0.4 * hash(ix, iz, 45)), sc);
        } else if (r < 0.42 && y < -2.6) {
          const tufts = 1 + Math.floor(hash(ix, iz, 46) * 3), tint = hash(ix, iz, 47) < 0.3 ? kelpTint : white;
          for (let t = 0; t < tufts; t++) {
            const wx = x + (hash(ix, iz, 50 + t) - 0.5) * 1.6, wz = z + (hash(ix, iz, 60 + t) - 0.5) * 1.6;
            const k = place(weed, wx, seafloorHeight(wx, wz, islands) - 0.05, wz, hash(ix, iz, 70 + t) * 6.283, 0.7 + 0.8 * hash(ix, iz, 80 + t));
            if (k >= 0) weed.setColorAt(k, tint);
          }
        }
      }
    }
    rocks.instanceMatrix.needsUpdate = weed.instanceMatrix.needsUpdate = true;
    if (weed.instanceColor) weed.instanceColor.needsUpdate = true;
    refreshNodes();
  }

  // Build the raft-centred patch now, at load, rather than lazily on the first frame the floor shows (the player's
  // first fall into the sea: ~20 ms + 5 MB of garbage, all cold code). Six rebuilds on the surrounding recentre
  // ring first let the JIT optimise rebuild and the noise loops before gameplay. This also creates
  // weed.instanceColor before the host's shader warm-up, so that program variant is compiled up front.
  for (let i = 0; i < 6; i++) rebuild(RECENTER * Math.cos(i * Math.PI / 3), RECENTER * Math.sin(i * Math.PI / 3));
  rebuild(0, 0);
  centreX = centreZ = 0;

  return {
    group,
    uniforms,
    heightAt,
    /** Compile this floor's programs against `scene`'s lights/fog (synchronous part only; nothing is drawn). */
    warm(renderer, camera, scene = group.parent) {
      if (!renderer || !camera) return;
      const done = typeof renderer.compileAsync === 'function' ? renderer.compileAsync(group, camera, scene ?? null) : renderer.compile?.(group, camera, scene ?? null);
      done?.catch?.((e) => console.warn('seafloor shader warm-up failed', e));
    },
    update(dt, camera, time) {
      if (Number.isFinite(time)) uniforms.uTime.value = time;
      if (hlType) {   // gentle emissive pulse on the targeted node
        const pulse = 1 + 1.6 * (0.5 + 0.5 * Math.sin(uniforms.uTime.value * 4));
        for (const m of hl[hlType].children) m.material.emissiveIntensity = pulse;
      }
      const p = camera && camera.position;
      if (!p) return;
      const cx = Math.round(p.x / RECENTER) * RECENTER, cz = Math.round(p.z / RECENTER) * RECENTER;
      if (cx !== centreX || cz !== centreZ) { centreX = cx; centreZ = cz; rebuild(cx, cz); }
    },
    nodesNear(x, y, z, radius) {
      const out = [], r2 = radius * radius;
      const x0 = Math.floor((x - radius) / CELL), x1 = Math.floor((x + radius) / CELL);
      const z0 = Math.floor((z - radius) / CELL), z1 = Math.floor((z + radius) / CELL);
      if ((x1 - x0) * (z1 - z0) > 4096) return out;   // guard against huge radii
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) {
          const n = nodeAt(ix, iz, islands);
          if (n && !gathered.has(n.id) && (n.x - x) ** 2 + (n.y - y) ** 2 + (n.z - z) ** 2 <= r2) out.push(n);
        }
      }
      return out;
    },
    setGathered(id, on = true) {
      const had = gathered.has(id);
      if (on) gathered.add(id); else gathered.delete(id);
      if (had !== !!on && patchNodes.some((n) => n.id === id)) refreshNodes();
    },
    isGathered: (id) => gathered.has(id),
    /** Mark the targeted node (or null). Cheap to call every frame: no-op when unchanged. */
    highlight(id = null) {
      if (id === hlId) return;
      hlId = typeof id === 'string' ? id : null;
      refreshNodes();
    },
    dispose() {
      group.parent?.remove(group);
      group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); if (o.isInstancedMesh) o.dispose(); } });
    },
  };
}
