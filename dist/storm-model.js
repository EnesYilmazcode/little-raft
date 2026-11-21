// Friendly storm models (docs/specs/storm.md §7): Lightning Rod, Storm Shard, Storm Lantern, Storm Glass and the pooled bolt.
// No imports: every builder takes the THREE namespace. Geometry and materials are built ONCE and shared by all
// instances; game.js rebuildRaft() disposes removed children, so shared dispose() calls are no-ops until free().
// Placeables stand on y = 0 (game.js puts the group on the tile top). Vertex colours, chamfered boxes, one merged
// mesh per material. The lantern is emissive only: its group name is not daynight's craft_lantern, so it never takes a pool light.

// Chamfered / rounded box (the models.js rbox trick): segmented box, vertices clamped to an inner box then pushed out.
function rbox(T, w, h, d, r = 0.01, s = 1) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  if (r <= 0.0005) return new T.BoxGeometry(w, h, d);
  const n = 2 * s + 1, g = new T.BoxGeometry(1, 1, 1, n, n, n);
  const p = g.attributes.position, nr = g.attributes.normal, v = new T.Vector3();
  const map = (u, half) => { const k = Math.round((u + 0.5) * n); return k <= s ? -(half - r) - r * (1 - k / s) : (half - r) + r * (1 - (n - k) / s); };
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    const x = map(p.getX(i), w / 2), y = map(p.getY(i), h / 2), z = map(p.getZ(i), d / 2);
    const ix = Math.max(-hx, Math.min(hx, x)), iy = Math.max(-hy, Math.min(hy, y)), iz = Math.max(-hz, Math.min(hz, z));
    v.set(x - ix, y - iy, z - iz);
    const len = v.length();
    if (len > 1e-6) { v.multiplyScalar(1 / len); p.setXYZ(i, ix + v.x * r, iy + v.y * r, iz + v.z * r); nr.setXYZ(i, v.x, v.y, v.z); }
    else p.setXYZ(i, x, y, z);
  }
  return g;
}

function mergeParts(T, parts) {
  let total = 0; for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count; g.dispose();
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
  geo.setAttribute('color', new T.BufferAttribute(col, 3));
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  return geo;
}

// Collects vertex-coloured, transformed, non-indexed parts; bakes a little ground-contact darkening by height.
function painter(T, seed0, aoH = 0) {
  const parts = [];
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), sc = new T.Vector3();
  let seed = seed0;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function add(geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, jitter = 0.05, scale = null) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); sc.set(1, 1, 1); if (scale) sc.set(scale[0], scale[1], scale[2]);
    g.applyMatrix4(m4.compose(p, q, sc));
    const pa = g.attributes.position, n = pa.count, col = new Float32Array(n * 3), base = new T.Color(hex), c = new T.Color();
    for (let i = 0; i < n; i++) {
      const tone = 1 + (rnd() - 0.5) * jitter * 2;
      const ao = aoH > 0 ? 0.72 + 0.28 * Math.min(1, Math.max(0, pa.getY(i) / aoH)) : 1;
      c.copy(base).multiplyScalar(tone * ao);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    if (g.attributes.uv) g.deleteAttribute('uv');
    parts.push(g);
  }
  return { parts, add };
}

// Make shared geometry/material dispose() a no-op; the returned function frees them for real.
function shareable(T, list) {
  const noop = () => {};
  for (const x of list) x.dispose = noop;
  const realGeo = T.BufferGeometry.prototype.dispose, realMat = T.Material.prototype.dispose;
  return () => { for (const x of list) (x.isMaterial ? realMat : realGeo).call(x); };
}

const COPPER = 0xd98a4e, METAL = 0x8e989e, DARKWOOD = 0x6b4529, RUST = 0xa5522a, WOOD = 0xa97d4c, BRASS = 0xd4a94f;

/** Shared storm materials: the shard and lantern-glass glow are driven by storm.js (emissiveIntensity). */
export function stormMaterials(T) {
  const wood = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }); wood.name = 'stormWood';
  const metal = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25 }); metal.name = 'stormMetal';
  const copper = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35 }); copper.name = 'stormCopper';
  const shard = new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.25, metalness: 0, emissive: 0x7fd8ff, emissiveIntensity: 0.6 }); shard.name = 'stormShard';
  const lampGlass = new T.MeshStandardMaterial({ color: 0x5fb8e8, transparent: true, opacity: 0.6, roughness: 0.2, emissive: 0x2f9fff, emissiveIntensity: 0.6, depthWrite: false }); lampGlass.name = 'stormLampGlass';
  const clearGlass = new T.MeshStandardMaterial({ color: 0xe6f6f4, transparent: true, opacity: 0.55, roughness: 0.08, depthWrite: false }); clearGlass.name = 'stormClearGlass';
  const crystal = new T.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.4, emissive: 0xdfefff, emissiveIntensity: 0.45 }); crystal.name = 'stormCrystal';
  const list = [wood, metal, copper, shard, lampGlass, clearGlass, crystal];
  const free = shareable(T, list);
  return { wood, metal, copper, shard, lampGlass, clearGlass, crystal, dispose: free };
}

/** Storm Shard cluster geometry: 3 tapering 5-sided prisms fused at the base, 0.18 tall (60 tris), pale cyan. */
export function shardGeometry(T, hex = 0xbfefff) {
  const { parts, add } = painter(T, 7);
  const prism = (h, r) => { const g = new T.CylinderGeometry(r * 0.25, r, h, 5, 1); g.translate(0, h / 2, 0); return g; };
  add(prism(0.18, 0.04), hex, 0, 0, 0, 0, 0.3, 0.05, 0.04);
  add(prism(0.13, 0.032), hex, 0.03, 0, 0.012, 0.15, 1.1, -0.45, 0.06);
  add(prism(0.11, 0.03), hex, -0.026, 0, -0.016, -0.35, 2.2, 0.3, 0.06);
  return mergeParts(T, parts);
}

/** Lightning Rod 'storm_rod' (0.45 x 2.6 x 0.45). userData.rod = { slots:[m0,m1,m2], tip:[0,2.6,0] }. */
export function buildRod(T, M) {
  const W = painter(T, 3, 0.12);
  W.add(rbox(T, 0.42, 0.12, 0.42, 0.025), DARKWOOD, 0, 0.06, 0, 0, 0, 0, 0.08);
  const woodGeo = mergeParts(T, W.parts);

  const K = painter(T, 5, 0.6);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) K.add(new T.CylinderGeometry(0.022, 0.026, 0.03, 6), RUST, sx * 0.15, 0.13, sz * 0.15, 0, 0, 0, 0.1);
  K.add(new T.CylinderGeometry(0.045, 0.05, 2.18, 10), METAL, 0, 0.12 + 1.09, 0, 0, 0, 0, 0.04);
  K.add(new T.CylinderGeometry(0.08, 0.09, 0.05, 10), 0x3f4448, 0, 0.145, 0, 0, 0, 0, 0.04); // foot flange
  K.add(rbox(T, 0.22, 0.035, 0.035, 0.008), METAL, 0.11, 0.86, 0, 0, 0, 0, 0.04); // cradle arm
  const metalGeo = mergeParts(T, K.parts);

  const C = painter(T, 9);
  for (const y of [1.2, 2.0]) C.add(new T.CylinderGeometry(0.068, 0.068, 0.06, 12), COPPER, 0, y, 0, 0, 0, 0, 0.05);
  C.add(new T.ConeGeometry(0.07, 0.28, 12), COPPER, 0, 2.3 + 0.14, 0, 0, 0, 0, 0.05);
  C.add(new T.SphereGeometry(0.05, 10, 6), 0xf0a66a, 0, 2.6 - 0.05, 0, 0, 0, 0, 0.04);
  C.add(new T.CylinderGeometry(0.12, 0.08, 0.08, 12, 1, true), COPPER, 0.24, 0.9, 0, 0, 0, 0, 0.05); // cradle cup wall
  C.add(new T.CylinderGeometry(0.08, 0.08, 0.015, 12), 0xb86d38, 0.24, 0.865, 0, 0, 0, 0, 0.04);   // cup floor
  const copperGeo = mergeParts(T, C.parts);
  const shardGeo = shardGeometry(T);

  const free = shareable(T, [woodGeo, metalGeo, copperGeo, shardGeo]);
  const SLOTS = [[0.24, 0.872, 0, 0], [0.2, 0.872, 0.045, 0.7], [0.28, 0.872, -0.04, -0.6]];
  return {
    instance() {
      const g = new T.Group(); g.name = 'storm_rod';
      const wood = new T.Mesh(woodGeo, M.wood); wood.name = 'rodWood'; wood.castShadow = true; wood.receiveShadow = true;
      const metal = new T.Mesh(metalGeo, M.metal); metal.name = 'rodMetal'; metal.castShadow = true;
      const copper = new T.Mesh(copperGeo, M.copper); copper.name = 'rodCopper'; copper.castShadow = true;
      g.add(wood, metal, copper);
      const slots = SLOTS.map(([x, y, z, rz], i) => {
        const m = new T.Mesh(shardGeo, M.shard); m.name = 'rodShard' + i; m.position.set(x, y, z); m.rotation.set(0, i * 1.3, rz * 0.3); m.scale.setScalar(0.9); m.visible = false;
        g.add(m); return m;
      });
      g.userData.craftType = 'stormrod'; g.userData.height = 2.6;
      g.userData.rod = { slots, tip: [0, 2.6, 0] };
      return g;
    },
    dispose: free,
  };
}

/** Storm Lantern 'storm_lamp' (.3 x .55 x .3): emissive only, no light. */
export function buildLamp(T, M) {
  const B = painter(T, 13, 0.3);
  B.add(new T.CylinderGeometry(0.15, 0.16, 0.06, 14), WOOD, 0, 0.03, 0, 0, 0, 0, 0.06);
  B.add(new T.CylinderGeometry(0.12, 0.12, 0.02, 14), 0x3f4448, 0, 0.07, 0, 0, 0, 0, 0.03);
  for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2; B.add(rbox(T, 0.026, 0.4, 0.026, 0.006), 0x4a4f52, Math.cos(a) * 0.115, 0.08 + 0.2, Math.sin(a) * 0.115, 0, -a, 0, 0.03); }
  B.add(new T.CylinderGeometry(0.15, 0.15, 0.035, 14), 0x4a4f52, 0, 0.495, 0, 0, 0, 0, 0.03);    // cap ring
  B.add(new T.ConeGeometry(0.11, 0.06, 14), 0x3f4448, 0, 0.54, 0, 0, 0, 0, 0.03);
  B.add(new T.TorusGeometry(0.035, 0.009, 6, 12, Math.PI), 0x4a4f52, 0, 0.565, 0, 0, 0, 0, 0.03); // handle
  const bodyGeo = mergeParts(T, B.parts);
  const glassGeo = new T.CylinderGeometry(0.1, 0.1, 0.4, 16, 1); glassGeo.translate(0, 0.08 + 0.2, 0);
  const shardGeo = shardGeometry(T, 0xd6f6ff);
  const free = shareable(T, [bodyGeo, glassGeo, shardGeo]);
  return {
    instance() {
      const g = new T.Group(); g.name = 'storm_lamp';
      const body = new T.Mesh(bodyGeo, M.metal); body.name = 'lampBody'; body.castShadow = true;
      const shard = new T.Mesh(shardGeo, M.shard); shard.name = 'lampShard'; shard.position.y = 0.09; shard.scale.setScalar(1.3);
      const glass = new T.Mesh(glassGeo, M.lampGlass); glass.name = 'lampGlass'; glass.renderOrder = 2;
      g.add(body, shard, glass);
      g.userData.craftType = 'stormlamp'; g.userData.height = 0.58;
      return g;
    },
    dispose: free,
  };
}

/** Storm Glass 'storm_glass' (.3 x .5 x .3): userData.crystals scale.y eases 0.3 (fair) -> 1 (storm soon). */
export function buildStormGlass(T, M) {
  const B = painter(T, 17, 0.2);
  B.add(new T.CylinderGeometry(0.12, 0.13, 0.06, 14), WOOD, 0, 0.03, 0, 0, 0, 0, 0.06);
  B.add(new T.CylinderGeometry(0.085, 0.085, 0.02, 14), BRASS, 0, 0.07, 0, 0, 0, 0, 0.04);
  B.add(new T.CylinderGeometry(0.08, 0.085, 0.045, 14), BRASS, 0, 0.5, 0, 0, 0, 0, 0.04);
  B.add(new T.SphereGeometry(0.03, 10, 6), BRASS, 0, 0.53, 0, 0, 0, 0, 0.04);
  const bodyGeo = mergeParts(T, B.parts);
  const glassGeo = new T.CylinderGeometry(0.07, 0.07, 0.42, 16, 1); glassGeo.translate(0, 0.08 + 0.21, 0);
  const crystalGeo = shardGeometry(T, 0xffffff);
  const free = shareable(T, [bodyGeo, glassGeo, crystalGeo]);
  return {
    instance() {
      const g = new T.Group(); g.name = 'storm_glass';
      const body = new T.Mesh(bodyGeo, M.metal); body.name = 'glassBody'; body.castShadow = true;
      const crystals = new T.Mesh(crystalGeo, M.crystal); crystals.name = 'glassCrystals'; crystals.position.y = 0.08; crystals.scale.set(0.9, 0.3, 0.9);
      const glass = new T.Mesh(glassGeo, M.clearGlass); glass.name = 'glassTube'; glass.renderOrder = 2;
      g.add(body, crystals, glass);
      g.userData.craftType = 'stormglass'; g.userData.height = 0.55;
      g.userData.crystals = crystals;
      return g;
    },
    dispose: free,
  };
}

// ---------------------------------------------------------------- bolt
export const BOLT_MAIN = 12, BOLT_BRANCH = 5;
const NP = BOLT_MAIN + 1 + BOLT_BRANCH + 1; // 19 path points, 4 verts each (two crossed ribbons)

/** Pooled lightning bolt: 76 verts / 68 tris, rewritten in place once per strike. write() allocates nothing. */
export function buildBolt(T) {
  const pos = new Float32Array(NP * 4 * 3);
  const idx = [];
  const ribbon = (p0, segs) => {
    for (let j = 0; j < segs; j++) {
      const a = (p0 + j) * 4, b = a + 4;
      idx.push(a, a + 1, b + 1, a, b + 1, b);          // ribbon across x
      idx.push(a + 2, a + 3, b + 3, a + 2, b + 3, b + 2); // ribbon across z
    }
  };
  ribbon(0, BOLT_MAIN); ribbon(BOLT_MAIN + 1, BOLT_BRANCH);
  const geo = new T.BufferGeometry();
  const attr = new T.BufferAttribute(pos, 3); attr.setUsage(T.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  geo.setIndex(idx);
  const mat = new T.MeshBasicMaterial({ color: '#e8f4ff', transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: T.DoubleSide, forceSinglePass: true });
  mat.name = 'stormBolt';
  const mesh = new T.Mesh(geo, mat);
  mesh.name = 'storm_bolt'; mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 8;
  mesh.castShadow = false; mesh.receiveShadow = false;
  const P = new Float32Array(NP * 3);

  function put(i, w) {
    const o = i * 12, x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], h = w / 2;
    pos[o] = x - h; pos[o + 1] = y; pos[o + 2] = z;
    pos[o + 3] = x + h; pos[o + 4] = y; pos[o + 5] = z;
    pos[o + 6] = x; pos[o + 7] = y; pos[o + 8] = z - h;
    pos[o + 9] = x; pos[o + 10] = y; pos[o + 11] = z + h;
  }
  // From (x0,y0,z0) down to (x1,y1,z1). Jitter comes from hash(seed, id, 8 + n), so both peers draw the same bolt.
  // endW: ribbon width at the bottom (thin for a rod hit, which ends next to the camera).
  function write(x0, y0, z0, x1, y1, z1, seed, id, hash, endW = 0.32) {
    const H = y0 - y1;
    for (let j = 0; j <= BOLT_MAIN; j++) {
      const t = j / BOLT_MAIN, amp = j === 0 || j === BOLT_MAIN ? 0 : (0.055 * H) * Math.sin(Math.PI * Math.min(1, t * 1.15));
      P[j * 3] = x0 + (x1 - x0) * t + (hash(seed, id, 8 + 2 * j) - 0.5) * 2 * amp;
      P[j * 3 + 1] = y0 - H * t;
      P[j * 3 + 2] = z0 + (z1 - z0) * t + (hash(seed, id, 9 + 2 * j) - 0.5) * 2 * amp;
    }
    const s = 3 + Math.floor(hash(seed, id, 40) * 3); // branch leaves main point 3..5
    const a = 2 * Math.PI * hash(seed, id, 41), L = H * (0.18 + 0.12 * hash(seed, id, 42));
    const b0 = BOLT_MAIN + 1;
    for (let j = 0; j <= BOLT_BRANCH; j++) {
      const t = j / BOLT_BRANCH, k = (b0 + j) * 3, jit = j === 0 ? 0 : (hash(seed, id, 43 + j) - 0.5) * 0.08 * H;
      P[k] = P[s * 3] + Math.cos(a) * L * 0.55 * t + jit;
      P[k + 1] = P[s * 3 + 1] - L * t;
      P[k + 2] = P[s * 3 + 2] + Math.sin(a) * L * 0.55 * t - jit;
    }
    for (let j = 0; j <= BOLT_MAIN; j++) { const t = j / BOLT_MAIN; put(j, 0.5 + (endW - 0.5) * t * Math.sqrt(t)); }
    for (let j = 0; j <= BOLT_BRANCH; j++) put(b0 + j, 0.25 * (1 - 0.6 * j / BOLT_BRANCH));
    attr.needsUpdate = true;
  }
  return { mesh, write, dispose() { geo.dispose(); mat.dispose(); } };
}
