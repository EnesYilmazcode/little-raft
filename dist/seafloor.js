// Little Raft - seafloor: pure height/node helpers + a light THREE builder.
//
// Pure (node-safe, no THREE): FLOOR, seafloorHeight, NODE_TYPES, NODE_LOOT,
// nodeAt, nodeById. Everything is deterministic hash-based value noise, so the
// host can validate a gather request with nodeById(id) + distance alone.
//
// Usage:
//   import { createSeafloor, nodeById } from './seafloor.js';
//   const floor = createSeafloor(THREE, { islands });
//   scene.add(floor.group);
//   // every frame: floor.update(dt, camera, time);  floor.uniforms.uCaustic.value = 0..1
//   floor.nodesNear(x, y, z, 2.8)  -> [{id, type, x, y, z}]  (gathered ones skipped)
//   floor.setGathered(id) / floor.setGathered(id, false); floor.dispose();
//
// Art: one camera-following floor patch (vertex-coloured sand, darker patches),
// instanced rocks, instanced swaying seaweed and one InstancedMesh per node type.
// Animated caustics are added to emissive in onBeforeCompile (world xz + uTime).
// The patch, decor and node instances are rebuilt only when the CELL-snapped
// camera xz changes; capacities are fixed.

export const FLOOR = { BASE: -11, MIN_DEPTH_UNDER_RAFT: -7, SHALLOWEST: -0.9, CELL: 4, PATCH: 96, SEGMENTS: 64 };
export const NODE_TYPES = ['sand', 'clay', 'scrap', 'metalore'];
export const NODE_LOOT = { sand: { sand: 1 }, clay: { clay: 1 }, scrap: { scrap: 1 }, metalore: { metalore: 1 } };

const NODE_MAX_Y = -1.5;          // no nodes where the floor is shallower than this
const NODE_CHANCE = 0.22;         // per CELL
const NODE_WEIGHTS = [0.35, 0.25, 0.22, 0.18];
const CELL_LIMIT = 100000;        // reject absurd ids

// ---------- deterministic noise ----------
function hash(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, v) => smooth(Math.min(1, Math.max(0, (v - a) / (b - a))));
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Deterministic world y of the seafloor. Always <= FLOOR.SHALLOWEST. */
export function seafloorHeight(x, z, islands = []) {
  const n = 0.6 * vnoise(x / 23, z / 23, 11) + 0.3 * vnoise(x / 9, z / 9, 12) + 0.1 * vnoise(x / 3.5, z / 3.5, 13);
  let h = FLOOR.BASE + (n - 0.5) * 5;                    // about -13.5 .. -8.5
  let t = 0;                                             // island shelf influence
  for (const isl of islands) {
    const r = isl.r ?? 5;
    t = Math.max(t, 1 - smoothstep(r, r + 40, Math.hypot(x - isl.x, z - isl.z)));
  }
  h += (FLOOR.SHALLOWEST - h) * t;
  // keep the raft area deep: cap rises smoothly from -7 (<= 9 m) to SHALLOWEST (>= 20 m)
  const cap = FLOOR.MIN_DEPTH_UNDER_RAFT + (FLOOR.SHALLOWEST - FLOOR.MIN_DEPTH_UNDER_RAFT) * smoothstep(9, 20, Math.hypot(x, z));
  return Math.min(h, cap, FLOOR.SHALLOWEST);
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

// ---------- THREE builder ----------
const CAP = { rocks: 140, weed: 420, node: 128 };

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
    shader.fragmentShader = CAUSTIC_GLSL + shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float lrFade = uCaustic * clamp(1.0 + vCausticPos.y / 18.0, 0.2, 1.0);
      totalEmissiveRadiance += vec3(0.5, 0.85, 0.8) * (lrCaustic(vCausticPos.xz, uTime) * 0.55 * lrFade);`);
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

// Jitter a polyhedron by vertex position (keeps faces welded) and colour per face.
function lump(T, geo, jitter, faceColor) {
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position;
  const col = new Float32Array(p.count * 3), c = new T.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + jitter * (hash(Math.round(x * 97), Math.round(y * 97) * 31 + Math.round(z * 97), 5) - 0.5);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  for (let f = 0; f < p.count; f += 3) {
    faceColor(c, f / 3, p.getY(f));
    for (let j = 0; j < 3; j++) c.toArray(col, (f + j) * 3);
  }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function nodeGeometry(T, type) {
  const c0 = new T.Color();
  if (type === 'sand') {   // pale low mound with a lighter crown
    const g = new T.SphereGeometry(0.6, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1);
    return lump(T, g, 0.12, (c, f, y) => c.set(0xe9dcb0).lerp(c0.set(0xfff6d8), Math.min(1, y * 3)));
  }
  if (type === 'clay') {   // squat orange-brown lump
    const g = new T.DodecahedronGeometry(0.42, 0).scale(1.15, 0.7, 1).translate(0, 0.18, 0);
    return lump(T, g, 0.25, (c, f) => c.set(0xb8663a).lerp(c0.set(0x8a4a2a), hash(f, 1, 6) * 0.6));
  }
  if (type === 'scrap') {  // three bent grey plates leaning together
    const plates = [];
    for (let k = 0; k < 3; k++) {
      const g = new T.BoxGeometry(0.85, 0.04, 0.45, 6, 1, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + 0.18 * Math.sin(p.getX(i) * 3.2 + k));
      g.rotateZ(0.35 + k * 0.4).rotateY(k * 2.1).translate(0.12 * (k - 1), 0.22, 0.08 * k);
      const cols = new Float32Array(p.count * 3), c = new T.Color(k === 1 ? 0x9a8170 : 0x8f989d);
      for (let i = 0; i < p.count; i++) c.toArray(cols, i * 3);
      g.setAttribute('color', new T.BufferAttribute(cols, 3));
      plates.push(g);
    }
    return merge(T, plates);
  }
  // metalore: dark rock with silvery-blue flecks
  const g = new T.IcosahedronGeometry(0.45, 1).scale(1.1, 0.75, 1).translate(0, 0.2, 0);
  return lump(T, g, 0.3, (c, f) => (hash(f, 2, 7) < 0.22 ? c.set(0xa8cdf0) : c.set(0x3a3f47).lerp(c0.set(0x2a2e35), hash(f, 3, 7))));
}

function seaweedGeometry(T) {
  const blades = [0, Math.PI / 2].map((rot) => {
    const g = new T.PlaneGeometry(0.5, 1.6, 1, 4).translate(0, 0.8, 0);
    const p = g.attributes.position, cols = new Float32Array(p.count * 3), c = new T.Color(), tip = new T.Color(0x7fb85a);
    for (let i = 0; i < p.count; i++) {
      const h = p.getY(i) / 1.6;
      p.setX(i, p.getX(i) * (1 - 0.75 * h));
      c.set(0x2f6b3a).lerp(tip, h).toArray(cols, i * 3);
    }
    g.setAttribute('color', new T.BufferAttribute(cols, 3));
    return g.rotateY(rot);
  });
  return merge(T, blades);
}

export function createSeafloor(T, { islands = [] } = {}) {
  const { CELL, PATCH, SEGMENTS } = FLOOR;
  const STEP = PATCH / SEGMENTS;
  const heightAt = (x, z) => seafloorHeight(x, z, islands);
  const uniforms = { uTime: { value: 0 }, uCaustic: { value: 0 } };
  const group = new T.Group();
  group.name = 'Seafloor';
  const std = (o, sway = false) => addCaustics(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, ...o }), uniforms, sway);

  // floor patch (positions written in world space on rebuild)
  const floorGeo = new T.PlaneGeometry(PATCH, PATCH, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2);
  const baseXZ = Float32Array.from(floorGeo.attributes.position.array);
  floorGeo.setAttribute('color', new T.BufferAttribute(new Float32Array(baseXZ.length), 3));
  const floor = new T.Mesh(floorGeo, std({}));
  floor.name = 'SeafloorPatch';
  group.add(floor);

  const inst = (geo, mat, cap, name) => {
    const m = new T.InstancedMesh(geo, mat, cap);
    m.name = name;
    m.count = 0;
    m.frustumCulled = false;   // instances span the whole patch around the camera
    group.add(m);
    return m;
  };
  const rockGeo = lump(T, new T.IcosahedronGeometry(1, 0), 0.45, (c, f) => c.set(0x6f7a78).lerp(new T.Color(0x4c5a5c), hash(f, 4, 8)));
  const rocks = inst(rockGeo, std({ flatShading: true }), CAP.rocks, 'SeafloorRocks');
  const weed = inst(seaweedGeometry(T), std({ side: T.DoubleSide, roughness: 0.8 }, true), CAP.weed, 'SeafloorWeed');
  const nodeMeshes = {};
  for (const type of NODE_TYPES) {
    const extra = type === 'scrap' ? { metalness: 0.45, roughness: 0.55 } : type === 'metalore' ? { metalness: 0.35, roughness: 0.5 } : {};
    nodeMeshes[type] = inst(nodeGeometry(T, type), std({ flatShading: true, ...extra }), CAP.node, `SeafloorNode_${type}`);
  }

  const gathered = new Set();
  let patchNodes = [];
  let centreX = NaN, centreZ = NaN;
  const m4 = new T.Matrix4(), q = new T.Quaternion(), v = new T.Vector3(), s = new T.Vector3(), up = new T.Vector3(0, 1, 0);
  const place = (mesh, x, y, z, yaw, sx, sy = sx, sz = sx) => {
    if (mesh.count >= mesh.instanceMatrix.count) return;
    mesh.setMatrixAt(mesh.count++, m4.compose(v.set(x, y, z), q.setFromAxisAngle(up, yaw), s.set(sx, sy, sz)));
  };

  function refreshNodes() {
    for (const type of NODE_TYPES) nodeMeshes[type].count = 0;
    for (const n of patchNodes) {
      if (gathered.has(n.id)) continue;
      const kx = Math.round(n.x * 10), kz = Math.round(n.z * 10);
      place(nodeMeshes[n.type], n.x, n.y - 0.04, n.z, hash(kx, kz, 90) * 6.283, 0.95 + 0.25 * hash(kx, kz, 91));
    }
    for (const type of NODE_TYPES) nodeMeshes[type].instanceMatrix.needsUpdate = true;
  }

  function rebuild(cx, cz) {
    // floor vertices on a world-aligned STEP lattice so recentring never pops
    const ox = Math.round(cx / STEP) * STEP, oz = Math.round(cz / STEP) * STEP;
    const pos = floorGeo.attributes.position, col = floorGeo.attributes.color.array;
    for (let i = 0; i < pos.count; i++) {
      const x = ox + baseXZ[i * 3], z = oz + baseXZ[i * 3 + 2], y = heightAt(x, z);
      pos.setXYZ(i, x, y, z);
      const dark = smoothstep(0.55, 0.75, vnoise(x / 14, z / 14, 31)) * 0.3 + hash(Math.round(x / STEP), Math.round(z / STEP), 32) * 0.06;
      const deep = Math.min(1, Math.max(0, (-y - 2) / 12)) * 0.15;
      const k = 1 - dark - deep;
      col[i * 3] = 0.84 * k; col[i * 3 + 1] = 0.76 * k; col[i * 3 + 2] = 0.56 * k + deep * 0.3;
    }
    pos.needsUpdate = true;
    floorGeo.attributes.color.needsUpdate = true;
    floorGeo.computeVertexNormals();
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
        const x = (ix + hash(ix, iz, 42)) * CELL, z = (iz + hash(ix, iz, 43)) * CELL, y = heightAt(x, z);
        if (r < 0.12 && y < -1.4) {
          const sc = 0.35 + 0.9 * hash(ix, iz, 44);
          place(rocks, x, y - 0.15 * sc, z, r * 60, sc * 1.2, sc * (0.6 + 0.4 * hash(ix, iz, 45)), sc);
        } else if (r < 0.42 && y < -2.6) {
          const tufts = 1 + Math.floor(hash(ix, iz, 46) * 3);
          for (let t = 0; t < tufts; t++) {
            const wx = x + (hash(ix, iz, 50 + t) - 0.5) * 1.6, wz = z + (hash(ix, iz, 60 + t) - 0.5) * 1.6;
            place(weed, wx, heightAt(wx, wz) - 0.05, wz, hash(ix, iz, 70 + t) * 6.283, 0.7 + 0.8 * hash(ix, iz, 80 + t));
          }
        }
      }
    }
    rocks.instanceMatrix.needsUpdate = weed.instanceMatrix.needsUpdate = true;
    refreshNodes();
  }

  return {
    group,
    uniforms,
    heightAt,
    update(dt, camera, time) {
      if (Number.isFinite(time)) uniforms.uTime.value = time;
      const p = camera && camera.position;
      if (!p) return;
      const cx = Math.round(p.x / CELL) * CELL, cz = Math.round(p.z / CELL) * CELL;
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
    dispose() {
      group.parent?.remove(group);
      group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); if (o.isInstancedMesh) o.dispose(); } });
    },
  };
}
