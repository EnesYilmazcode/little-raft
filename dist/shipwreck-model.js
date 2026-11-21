// Sunken shipwreck models (docs/specs/shipwreck.md §11). Merged, vertex-coloured geometry with one shared
// MeshStandardMaterial; the hull per variant is built lazily once and cached. 8 draw calls underwater
// (hull, bed, closed crates, barrels, open crates, chest, kelp, fish), 2 for the surface marker.
import { mergeGeometries } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';
import { MAX_SLOTS, HULL_HALF } from './shipwreck-core.js?build=v3-survival-ae77fa84ac2b';

const TAU = Math.PI * 2;
const WOOD = [0x86694a, 0x957552, 0x7a5f43, 0x9e7e56]; // weathered planks: lighter than deck wood so the hull reads in deep-water light
const MOSS = 0x4f5c3a, IRON = 0x3d3f42, BRASS = 0xa8873c, SAND = 0xb9a57c, ROCK = 0x6d716f, GOLD = 0xe0b84a;

export function createShipwreckModel(T) {
  const col = new T.Color();
  const tmp = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v = new T.Vector3(), s1 = new T.Vector3(1, 1, 1);
  // Bake transform + one flat colour into a primitive (keeps position/normal/uv/color for mergeGeometries).
  function part(g, hex, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0) {
    e.set(rx, ry, rz); q.setFromEuler(e); v.set(px, py, pz);
    g.applyMatrix4(tmp.compose(v, q, s1));
    col.set(hex);
    const n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    g.setAttribute('color', new T.BufferAttribute(c, 3));
    return g;
  }
  const box = (w, h, d, hex, px, py, pz, rx, ry, rz) => part(new T.BoxGeometry(w, h, d), hex, px, py, pz, rx, ry, rz);
  const cyl = (r0, r1, h, seg, hex, px, py, pz, rx, ry, rz, open = false, t0 = 0, tl = TAU) => part(new T.CylinderGeometry(r0, r1, h, seg, 1, open, t0, tl), hex, px, py, pz, rx, ry, rz);
  const merge = list => { const g = mergeGeometries(T, list); for (const x of list) x.dispose(); return g; };
  const wood = i => WOOD[((i % WOOD.length) + WOOD.length) % WOOD.length];

  // ---------- hull per variant (cached) ----------
  const hulls = new Map();
  function hullParts(L, zEnd, breaks) {
    const z0 = -HULL_HALF + 0.4, clipLen = (a, b) => [a, Math.min(b, zEnd)];
    for (let i = -2; i <= 2; i++) { const [a, b] = clipLen(z0, HULL_HALF - 0.2 - (i & 1) * 0.3); if (b > a) L.push(box(0.35, 0.07, b - a, wood(i), i * 0.37, -0.15, (a + b) / 2)); }
    { const [a, b] = clipLen(-HULL_HALF - 0.2, HULL_HALF + 0.2); L.push(box(0.2, 0.25, b - a, wood(9), 0, -0.3, (a + b) / 2)); }
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
      const segs = (breaks && breaks(s, i)) || [[z0, HULL_HALF - 0.2]];
      for (const [a0, b0] of segs) { const [a, b] = clipLen(a0, b0 - (zEnd < HULL_HALF ? i * 0.35 : 0)); if (b - a > 0.2) L.push(box(0.07, 0.28, b - a, (i === 0 ? MOSS : wood(i + s)), s * (0.95 + 0.1 * i), 0.1 + 0.3 * i, (a + b) / 2, 0, 0, -s * 0.22)); }
    }
    // pointed bow: stem post and two angled panels
    L.push(box(0.18, 1.5, 0.18, wood(2), 0, 0.5, -HULL_HALF - 0.05, -0.35, 0, 0));
    for (const s of [-1, 1]) L.push(box(0.07, 1.1, 1.25, wood(s + 1), s * 0.55, 0.45, -HULL_HALF + 0.1, 0, s * 0.62, 0));
    // ribs (and a few deck beams)
    for (let z = -3.3; z <= 3.31; z += 1.1) {
      if (z > zEnd) break;
      for (const s of [-1, 1]) L.push(box(0.12, 1.3, 0.12, wood(3), s * 1.06, 0.5, z, 0, 0, -s * 0.22));
      if (Math.round(z * 10) % 3 === 0) L.push(box(2.3, 0.1, 0.13, wood(1), 0, 1.15, z));
    }
  }
  function hullGeo(variant) {
    if (hulls.has(variant)) return hulls.get(variant);
    const L = [];
    if (variant === 'bow') {
      hullParts(L, 0.6, null);
      // scattered stern ribs, a plank or two and the rudder half buried
      L.push(box(0.12, 1.3, 0.12, wood(3), -0.9, 0.06, 1.7, 0.2, 0.3, 1.35));
      L.push(box(0.12, 1.3, 0.12, wood(1), 1.1, 0.25, 2.6, 0.6, -0.4, -1.0));
      L.push(box(0.12, 1.3, 0.12, wood(0), -0.3, 0.05, 3.5, 0, 1.1, 1.5));
      L.push(box(0.12, 1.2, 0.12, wood(2), 0.7, 0.35, 4.3, -0.5, 0, 0.5));
      L.push(box(0.35, 0.07, 2.2, wood(2), 1.8, -0.05, 3.2, 0.05, 0.5, 0.1));
      L.push(box(0.1, 1.0, 0.6, wood(1), -1.6, 0.05, 4.5, 0, 0.6, 1.45));
      L.push(cyl(0.12, 0.12, 2.6, 7, wood(0), -1.6, 0.3, -2.2, 0, 0, 1.25)); // mast lying across the bow
    } else {
      const keel = variant === 'keel';
      hullParts(L, HULL_HALF, keel ? (s, i) => (s > 0 && i >= 2 ? [[-4.1, -0.8], [1.4, 4.3]] : s < 0 && i === 3 ? [[-4.1, 2.0]] : null)
        : (s, i) => (s < 0 && i >= 1 ? [[-4.1, -1.2], [0.9, 4.3]] : null));
      L.push(box(2.1, 1.1, 0.1, wood(2), 0, 0.45, HULL_HALF - 0.15)); // transom
      L.push(box(0.1, 1.0, 0.6, wood(1), 0, 0.2, HULL_HALF + 0.3, 0, 0.4, 0)); // rudder
      L.push(cyl(0.12, 0.1, 0.7, 7, wood(0), 0, 0.25, -1.0)); // mast stub
      L.push(cyl(0.11, 0.09, 2.4, 7, wood(0), keel ? 1.5 : -1.3, keel ? 0.75 : 0.9, -1.2, 0.3, 0, keel ? -1.0 : 0.9)); // broken mast
      if (keel) { // stern cabin around the captain's chest
        L.push(box(1.8, 0.12, 1.5, wood(3), 0, 0.24, 3.45));
        for (const s of [-1, 1]) L.push(box(0.08, 0.9, 1.5, wood(s + 2), s * 0.86, 0.7, 3.45));
        L.push(box(1.9, 0.08, 0.6, wood(1), 0.1, 1.18, 3.95, 0, 0, 0.15));
      }
    }
    let g = merge(L);
    if (variant === 'listing') g.applyMatrix4(tmp.compose(v.set(0.5, -0.15, 0), q.setFromEuler(e.set(0, 0, -35 * Math.PI / 180)), s1));
    hulls.set(variant, g);
    return g;
  }

  // ---------- containers (base at y = 0) ----------
  const crateGeo = merge([box(0.7, 0.66, 0.7, wood(1), 0, 0.33, 0), box(0.74, 0.08, 0.74, wood(2), 0, 0.08, 0), box(0.74, 0.08, 0.74, wood(2), 0, 0.6, 0),
    box(0.06, 0.6, 0.72, wood(0), 0, 0.33, 0, 0, 0, 0.78)]);
  const crateOpenGeo = merge([box(0.7, 0.06, 0.7, wood(0), 0, 0.03, 0), box(0.7, 0.62, 0.06, wood(1), 0, 0.33, 0.32), box(0.7, 0.62, 0.06, wood(1), 0, 0.33, -0.32),
    box(0.06, 0.62, 0.58, wood(3), 0.32, 0.33, 0), box(0.06, 0.62, 0.58, wood(3), -0.32, 0.33, 0),
    box(0.72, 0.05, 0.72, wood(2), 0.55, 0.3, 0.05, 0.1, 0, 1.2)]); // lid leaning on its side
  const barrelGeo = merge([cyl(0.28, 0.28, 0.76, 10, wood(1), 0, 0.38, 0), cyl(0.295, 0.295, 0.05, 10, IRON, 0, 0.14, 0), cyl(0.295, 0.295, 0.05, 10, IRON, 0, 0.62, 0)]);
  const chestBase = () => [box(0.8, 0.4, 0.5, wood(2), 0, 0.2, 0), box(0.82, 0.05, 0.52, BRASS, 0, 0.38, 0), box(0.06, 0.42, 0.52, BRASS, 0.25, 0.2, 0), box(0.06, 0.42, 0.52, BRASS, -0.25, 0.2, 0)];
  const lid = (open) => {
    const L = [cyl(0.25, 0.25, 0.8, 8, wood(3), 0, 0, 0, 0, 0, Math.PI / 2, false, 0, Math.PI), box(0.1, 0.12, 0.06, BRASS, 0, -0.02, 0.26)];
    const g = merge(L);
    // hinge along the back edge (z = -0.25 at y = 0.4)
    if (open) g.applyMatrix4(tmp.compose(v.set(0, 0.4, -0.25), q.setFromEuler(e.set(-1.9, 0, 0)), s1).multiply(new T.Matrix4().makeTranslation(0, 0, 0.25)));
    else g.applyMatrix4(tmp.makeTranslation(0, 0.4, 0));
    return g;
  };
  const chestGeo = merge([...chestBase(), lid(false)]);
  const chestOpenGeo = merge([...chestBase(), lid(true), box(0.6, 0.08, 0.36, GOLD, 0, 0.36, 0), box(0.12, 0.12, 0.12, GOLD, 0.15, 0.42, 0.05, 0.4, 0.5, 0)]);

  // ---------- kelp and fish ----------
  const kelpGeo = merge([box(0.12, 1.6, 0.02, 0x2f6d4f, 0, 0.8, 0, 0, 0, 0.05), box(0.1, 1.3, 0.02, 0x3d7f58, 0.05, 0.65, 0.03, 0, 1.1, -0.08), box(0.1, 1.1, 0.02, 0x2a5f4a, -0.05, 0.55, -0.02, 0, 2.2, 0.1)]);
  const fishGeo = merge([box(0.26, 0.11, 0.06, 0xffffff, 0, 0, 0), box(0.02, 0.1, 0.1, 0xffffff, -0.15, 0, 0, Math.PI / 4, 0, 0), box(0.08, 0.05, 0.02, 0xdddddd, 0.02, 0.07, 0)]);

  // ---------- bed (sand skirt with loose planks, an anchor, 2 rocks); vertices dropped in build ----------
  function bedParts() {
    const ring = new T.RingGeometry(0.01, 6, 20, 4); ring.rotateX(-Math.PI / 2);
    const n = ring.attributes.position.count, c = new Float32Array(n * 3), base = new T.Color(SAND);
    for (let i = 0; i < n; i++) { const r = Math.hypot(ring.attributes.position.getX(i), ring.attributes.position.getZ(i)) / 6, k = 0.82 + 0.18 * r; c[i * 3] = base.r * k; c[i * 3 + 1] = base.g * k; c[i * 3 + 2] = base.b * k; }
    ring.setAttribute('color', new T.BufferAttribute(c, 3));
    const extras = [ // [geometry, local x, local z] (y set from the floor)
      [box(0.32, 0.06, 1.8, wood(0), 0, 0.03, 0, 0, 0.4, 0), 2.6, -3.6], [box(0.32, 0.06, 1.4, wood(2), 0, 0.03, 0, 0.05, 1.9, 0), -3.2, -1.4],
      [box(0.3, 0.06, 2.0, wood(3), 0, 0.03, 0, 0, -0.7, 0.06), -2.8, 4.6], [box(0.3, 0.06, 1.2, wood(1), 0, 0.03, 0, 0, 1.2, 0), 4.4, 3.8],
      [merge([cyl(0.05, 0.05, 1.2, 6, IRON, 0, 0.6, 0), box(0.9, 0.08, 0.08, IRON, 0, 0.08, 0), box(0.08, 0.3, 0.08, IRON, 0.43, 0.2, 0, 0, 0, -0.4), box(0.08, 0.3, 0.08, IRON, -0.43, 0.2, 0, 0, 0, 0.4), cyl(0.12, 0.12, 0.04, 8, IRON, 0, 1.22, 0, Math.PI / 2, 0, 0)]).rotateZ(1.35).translate(0, 0.08, 0), -4.2, 1.2],
      [part(new T.DodecahedronGeometry(0.55, 0), ROCK, 0, 0.15, 0).scale(1, 0.6, 1), 4.6, -1.6], [part(new T.DodecahedronGeometry(0.4, 0), ROCK, 0, 0.1, 0).scale(1.2, 0.55, 0.9), -1.8, -5.0],
    ];
    return { ring, extras };
  }
  const bedSrc = bedParts();
  for (const [g] of bedSrc.extras) { if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]); }

  // ---------- materials ----------
  // Vertex colours times a cool, dim tint so the wreck sits in the same deep-water light as the floor.
  const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, color: 0xa9c9d1 });
  const chestMat = mat.clone();
  const uTime = { value: 0 };
  const kelpMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, color: 0x9fc9c0 });
  kelpMat.onBeforeCompile = shader => { // sway copied from seafloor.js addCaustics (own uTime)
    shader.uniforms.uTime = uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float lrH = clamp(position.y / 1.6, 0.0, 1.0); lrH *= lrH;
        vec3 lrP = vec3(0.0);
        #ifdef USE_INSTANCING
          lrP = instanceMatrix[3].xyz;
        #endif
        transformed.x += sin(uTime * 1.3 + lrP.x * 0.7 + lrP.z * 0.5) * 0.28 * lrH;
        transformed.z += cos(uTime * 1.05 + lrP.z * 0.6 - lrP.x * 0.3) * 0.2 * lrH;`);
  };
  kelpMat.customProgramCacheKey = () => 'shipwreck-kelp';
  const markMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const bubbleMat = new T.MeshStandardMaterial({ color: 0xe8fbff, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false });

  const setup = m => { m.castShadow = m.receiveShadow = false; return m; };
  const inst = (g, m, n, name) => {
    const x = setup(new T.InstancedMesh(g, m, n)); x.name = name; x.frustumCulled = false; x.instanceMatrix.setUsage(T.DynamicDrawUsage);
    for (let i = 0; i < n; i++) { x.setMatrixAt(i, ZERO); x.setColorAt(i, WHITE); }
    return x;
  };
  const ZERO = new T.Matrix4().makeScale(0, 0, 0), WHITE = new T.Color(1, 1, 1);

  const group = new T.Group(); group.name = 'shipwreck'; group.visible = false;
  const hull = setup(new T.Mesh(hullGeo('keel'), mat)); hull.name = 'wreckHull';
  const bed = setup(new T.Mesh(new T.BufferGeometry(), mat)); bed.name = 'wreckBed'; bed.frustumCulled = false;
  const crates = inst(crateGeo, mat, 4, 'wreckCrates'), barrels = inst(barrelGeo, mat, 2, 'wreckBarrels'), cratesOpen = inst(crateOpenGeo, mat, 4, 'wreckCratesOpen');
  const chest = setup(new T.Mesh(chestGeo, chestMat)); chest.name = 'wreckChest';
  const kelp = inst(kelpGeo, kelpMat, 16, 'wreckKelp'), fish = inst(fishGeo, mat, 8, 'wreckFish');
  group.add(hull, bed, crates, barrels, cratesOpen, chest, kelp, fish);

  // surface marker: 6 floating planks round a bubble column (positioned by the module each frame)
  const marker = new T.Group(); marker.name = 'shipwreckMarker'; marker.visible = false;
  const plankGeo = box(0.3, 0.07, 1.4, wood(1), 0, 0, 0);
  if (!plankGeo.index) plankGeo.setIndex([...Array(plankGeo.attributes.position.count).keys()]);
  const planks = inst(plankGeo, markMat, 6, 'wreckMarkerPlanks');
  const bubbleList = [];
  for (let i = 0; i < 14; i++) { const a = i * 2.4, r = 0.15 + (i % 3) * 0.12; bubbleList.push(part(new T.IcosahedronGeometry(0.05 + (i % 4) * 0.025, 0), 0xffffff, Math.cos(a) * r, -2.6 + i * 0.2, Math.sin(a) * r)); }
  for (const g of bubbleList) if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  const bubbles = setup(new T.Mesh(merge(bubbleList), bubbleMat)); bubbles.name = 'wreckBubbles'; bubbles.renderOrder = 2;
  marker.add(planks, bubbles);
  const plankA = [0, 1.1, 2.0, 3.3, 4.1, 5.2], plankR = [1.5, 1.9, 1.3, 1.7, 2.1, 1.4], plankY = [0.4, 2.1, 1.0, 2.7, 0.2, 1.6];

  // ---------- per site ----------
  let lay = null, baseY = 0;
  const slotInst = new Int8Array(MAX_SLOTS).fill(-1), opened = new Uint8Array(MAX_SLOTS), slotY = new Float32Array(MAX_SLOTS);
  let hoverK = -1;
  const pos = new T.Vector3(), scl = new T.Vector3(1, 1, 1), qa = new T.Quaternion(), qb = new T.Quaternion(), mtx = new T.Matrix4();
  const AX = new T.Vector3(1, 0, 0), UP = new T.Vector3(0, 1, 0);
  const FISH_COL = [0xffa040, 0xbfd8ff, 0xffe070, 0xff8070].map(h => new T.Color(h));

  function writeSlot(k) {
    if (!lay || k < 0 || k >= lay.slots.length) return;
    const s = lay.slots[k], i = slotInst[k], on = !!opened[k];
    qa.setFromAxisAngle(UP, s.rot); pos.set(s.x, slotY[k], s.z);
    if (s.kind === 'chest') { chest.geometry = on ? chestOpenGeo : chestGeo; chest.position.copy(pos); chest.quaternion.copy(qa); }
    else if (s.kind === 'crate') {
      mtx.compose(pos, qa, scl);
      crates.setMatrixAt(i, on ? ZERO : mtx); cratesOpen.setMatrixAt(i, on ? mtx : ZERO);
      crates.instanceMatrix.needsUpdate = cratesOpen.instanceMatrix.needsUpdate = true;
    } else {
      if (on) { qb.setFromAxisAngle(AX, Math.PI / 2); qa.multiply(qb); pos.y += 0.28; }
      barrels.setMatrixAt(i, mtx.compose(pos, qa, scl)); barrels.instanceMatrix.needsUpdate = true;
    }
    paint(k);
  }
  function paint(k) {
    if (!lay || k < 0 || k >= lay.slots.length) return;
    const s = lay.slots[k], f = k === hoverK && !opened[k] ? 1.35 : 1;
    if (s.kind === 'chest') chestMat.color.copy(mat.color).multiplyScalar(f);
    else { const m = s.kind === 'crate' ? crates : barrels; col.setRGB(f, f, f); m.setColorAt(slotInst[k], col); m.instanceColor.needsUpdate = true; }
  }

  // lay: layoutFor(seed); slotPos: Float32Array world bases; site: {x, y, z}; floorAt(x, z) -> y or NaN.
  function build(l, slotPos, site, floorAt) {
    lay = l; baseY = site.y; hoverK = -1;
    hull.geometry = hullGeo(lay.variant); hull.position.set(0, site.y, 0);
    group.position.set(site.x, 0, site.z); group.rotation.set(0, lay.yaw, 0); group.updateMatrixWorld(true);
    const c = Math.cos(lay.yaw), sn = Math.sin(lay.yaw);
    const floor = (lx, lz) => { const y = typeof floorAt === 'function' ? floorAt(site.x + lx * c + lz * sn, site.z - lx * sn + lz * c) : NaN; return Number.isFinite(y) ? Math.min(site.y + 1.5, Math.max(site.y - 1.5, y)) : site.y; };
    // bed: drop the skirt onto the floor, then merge the extras at their floor heights
    const ring = bedSrc.ring.clone(), p = ring.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z); p.setY(i, floor(x, z) + 0.06 - 0.35 * Math.max(0, (r - 3.5) / 2.5)); } // rim sinks under the floor: no seam
    const parts = [ring];
    for (const [g, x, z] of bedSrc.extras) parts.push(g.clone().translate(x, floor(x, z) + 0.02, z));
    const old = bed.geometry; bed.geometry = mergeGeometries(T, parts); bed.geometry.computeVertexNormals(); for (const g of parts) g.dispose(); old.dispose();
    // containers
    crates.count = 4; cratesOpen.count = 4; barrels.count = 2;
    for (let i = 0; i < 4; i++) { crates.setMatrixAt(i, ZERO); cratesOpen.setMatrixAt(i, ZERO); }
    for (let i = 0; i < 2; i++) barrels.setMatrixAt(i, ZERO);
    let nc = 0, nb = 0;
    slotInst.fill(-1); opened.fill(0);
    for (let k = 0; k < lay.slots.length && k < MAX_SLOTS; k++) {
      const s = lay.slots[k];
      slotInst[k] = s.kind === 'crate' ? nc++ : s.kind === 'barrel' ? nb++ : 0;
      slotY[k] = slotPos[k * 3 + 1];
      writeSlot(k);
    }
    // kelp
    const nk = Math.min(16, lay.kelp.length); kelp.count = nk;
    for (let i = 0; i < nk; i++) { const t = lay.kelp[i]; qa.setFromAxisAngle(UP, t.rot); pos.set(t.x, floor(t.x, t.z) - 0.05, t.z); scl.setScalar(t.s); kelp.setMatrixAt(i, mtx.compose(pos, qa, scl)); }
    scl.set(1, 1, 1); kelp.instanceMatrix.needsUpdate = true;
    fish.count = Math.min(8, lay.fish.length);
    for (let i = 0; i < fish.count; i++) fish.setColorAt(i, FISH_COL[(lay.seed + i) % FISH_COL.length]);
    fish.instanceColor.needsUpdate = true;
    update(0, 0, true);
  }
  function setOpened(k, on) { if (!lay || k < 0 || k >= lay.slots.length) return; on = on ? 1 : 0; if (opened[k] === on) return; opened[k] = on; writeSlot(k); }
  function hover(k) { k = Number.isInteger(k) ? k : -1; if (k === hoverK) return; const o = hoverK; hoverK = k; paint(o); paint(k); }

  function update(time, dt, force = false) {
    if (!lay || !(group.visible || force)) return;
    uTime.value = time;
    for (let i = 0; i < fish.count; i++) {
      const f = lay.fish[i], a = f.phase + f.speed * time;
      pos.set(Math.cos(a) * f.orbitR, baseY + f.orbitH + Math.sin(time * 0.7 + f.phase * 3) * 0.25, Math.sin(a) * f.orbitR);
      qa.setFromAxisAngle(UP, -a - Math.PI / 2 + Math.sin(time * 6 + i) * 0.08);
      fish.setMatrixAt(i, mtx.compose(pos, qa, scl));
    }
    fish.instanceMatrix.needsUpdate = true;
  }
  // Marker bob: planks float on getHeight round (x, z); call only while the marker is visible.
  function updateMarker(x, z, getHeight, time) {
    const base = getHeight(x, z);
    marker.position.set(x, base, z);
    for (let i = 0; i < 6; i++) {
      const a = plankA[i] + time * 0.05, px = Math.cos(a) * plankR[i], pz = Math.sin(a) * plankR[i];
      pos.set(px, getHeight(x + px, z + pz) - base + 0.02, pz);
      e.set(Math.sin(time * 0.9 + i) * 0.08, plankY[i] + a, Math.cos(time * 0.8 + i * 2) * 0.08); qa.setFromEuler(e);
      planks.setMatrixAt(i, mtx.compose(pos, qa, scl));
    }
    planks.instanceMatrix.needsUpdate = true;
    bubbles.position.y = (time * 0.6) % 0.2;
  }
  function clear() { lay = null; group.visible = false; marker.visible = false; }

  function dispose() {
    group.parent?.remove(group); marker.parent?.remove(marker);
    for (const g of hulls.values()) g.dispose();
    for (const g of [bed.geometry, crateGeo, crateOpenGeo, barrelGeo, chestGeo, chestOpenGeo, kelpGeo, fishGeo, plankGeo, bubbles.geometry, bedSrc.ring]) g.dispose();
    for (const [g] of bedSrc.extras) g.dispose();
    for (const m of [mat, chestMat, kelpMat, markMat, bubbleMat]) m.dispose();
    for (const m of [crates, barrels, cratesOpen, kelp, fish, planks]) m.dispose?.();
  }

  return { group, marker, build, setOpened, hover, update, updateMarker, clear, dispose, hullGeo };
}
