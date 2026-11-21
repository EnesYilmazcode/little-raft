// Progression station models (ES module, no imports, no textures).
// Usage: import { createSmelterModel, setSmelterGlow } from './smelter-model.js';
//        const g = createSmelterModel(THREE); g.position.set(x, .22, z);  // same origin rule as crafts.js
// Local origin = centre of the 2x2 raft floor top surface; everything builds upward from y = 0 inside a
// ~1.3 x 1.3 footprint. Meshes are merged per material (flat-shaded, vertex coloured, low poly).
// Opaque materials are shared per THREE instance (module cache): disposing them is harmless because
// three re-uploads a disposed material on next use. Each glow material is per instance so it can flicker.
//
// Exports: createSmelterModel(T) (child 'glow' + group 'ingotTray' with a hidden child 'ingot'),
//          createResearchTableModel(T), createGrillModel(T) (child 'glow' too),
//          setSmelterGlow(group, amount0to1, timeSec) for either glowing model.

const MATS = new WeakMap();
function mats(T) {
  let m = MATS.get(T);
  if (m) return m;
  const std = (o) => new T.MeshStandardMaterial(Object.assign({ color: 0xffffff, roughness: 0.9, metalness: 0, flatShading: true, vertexColors: true }, o));
  m = {
    wood: std({ roughness: 0.88 }),
    clay: std({ roughness: 0.96 }),
    stone: std({ roughness: 0.92 }),
    metal: std({ roughness: 0.45, metalness: 0.7 }),
    paper: std({ roughness: 0.95, side: T.DoubleSide }),
    brass: std({ roughness: 0.35, metalness: 0.8 }),
    glass: new T.MeshStandardMaterial({ color: 0xcfe8ff, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.38, depthWrite: false }),
  };
  MATS.set(T, m);
  return m;
}
const glowMaterial = T => new T.MeshStandardMaterial({ color: 0x2a1810, emissive: 0xff6a1c, emissiveIntensity: 0, roughness: 1, flatShading: true });

function kit(T, seed0) {
  let seed = seed0 >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler();
  const bake = (geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    _e.set(rx, ry, rz); _q.setFromEuler(_e);
    _m.compose(new T.Vector3(x, y, z), _q, new T.Vector3(sx, sy, sz));
    return geo.applyMatrix4(_m);
  };
  // per-vertex colour; fn(x,y,z,nx,ny,nz,c) receives local coords before baking
  const paint = (geo, hex, fn) => {
    const p = geo.attributes.position, n = geo.attributes.normal;
    const arr = new Float32Array(p.count * 3), c = new T.Color(), base = new T.Color(hex);
    for (let i = 0; i < p.count; i++) {
      c.copy(base);
      if (fn) fn(p.getX(i), p.getY(i), p.getZ(i), n ? n.getX(i) : 0, n ? n.getY(i) : 0, n ? n.getZ(i) : 0, c);
      arr.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new T.BufferAttribute(arr, 3));
    return geo;
  };
  const tint = (hex, spread = 0.12) => new T.Color(hex).multiplyScalar(1 - spread / 2 + rnd() * spread).getHex();
  // timber: slightly varied tone per piece, darker underside and end grain
  const wood = (geo, hex) => paint(geo, tint(hex), (x, y, z, nx, ny, nz, c) => {
    if (ny < -0.5) c.multiplyScalar(0.72);
    c.multiplyScalar(0.94 + 0.12 * Math.sin(x * 23 + z * 17 + y * 5));
  });
  const plank = (w, h, d, hex, x, y, z, rx = 0, ry = 0, rz = 0) => bake(wood(new T.BoxGeometry(w, h, d), hex), x, y, z, rx, ry, rz);
  const solid = (geo, hex, x, y, z, rx, ry, rz, sx, sy, sz) => bake(paint(geo, hex), x, y, z, rx, ry, rz, sx, sy, sz);
  // rough pebble: icosahedron with seeded vertex jitter (shared corners stay welded via position hash)
  const pebble = (r, hex, x, y, z, sy = 0.7) => {
    const geo = new T.IcosahedronGeometry(r, 0);
    roughen(geo, r * 0.28);
    return bake(paint(geo, tint(hex, 0.2), (px, py, pz, nx, ny, nz, c) => { if (ny > 0.4) c.multiplyScalar(1.12); }), x, y, z, 0, rnd() * 6, 0, 1, sy, 1);
  };
  const roughen = (geo, amt, skip) => {
    const p = geo.attributes.position, h = new Map();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (skip && skip(x, y, z)) continue;
      const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      if (!h.has(k)) h.set(k, [(rnd() - 0.5) * amt, (rnd() - 0.5) * amt, (rnd() - 0.5) * amt]);
      const d = h.get(k);
      p.setXYZ(i, x + d[0], y + d[1], z + d[2]);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const merge = list => {
    const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
    const out = new T.BufferGeometry();
    for (const n of ['position', 'normal', 'color']) {
      let total = 0;
      for (const p of parts) total += p.attributes[n].count * 3;
      const arr = new Float32Array(total);
      let off = 0;
      for (const p of parts) { arr.set(p.attributes[n].array.subarray(0, p.attributes[n].count * 3), off); off += p.attributes[n].count * 3; }
      out.setAttribute(n, new T.BufferAttribute(arr, 3));
    }
    for (const g of new Set(list.concat(parts))) g.dispose();
    out.computeBoundingBox(); out.computeBoundingSphere();
    return out;
  };
  const add = (parent, list, mat, name, shadow = true) => {
    if (!list.length) return null;
    for (const g of list) if (!g.attributes.color) paint(g, 0xffffff);
    const mesh = new T.Mesh(merge(list), mat);
    mesh.name = name; mesh.castShadow = shadow; mesh.receiveShadow = shadow;
    parent.add(mesh);
    return mesh;
  };
  return { rnd, bake, paint, tint, wood, plank, solid, pebble, roughen, merge, add };
}

function finish(T, g, type) {
  g.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(g), size = box.getSize(new T.Vector3());
  g.userData.craftType = type;
  g.userData.size = { x: size.x, y: size.y, z: size.z };
  g.userData.height = box.max.y;
  return g;
}

// ---------------------------------------------------------------- SMELTER (~1.24 x 1.24, ~1.3 tall)
export function createSmelterModel(T) {
  const M = mats(T), K = kit(T, 0x5e17e2);
  const g = new T.Group(); g.name = 'smelter';
  const W = [], C = [], S = [], GL = [], MT = [];

  // wooden pallet: two runners, four deck planks
  for (const x of [-0.46, 0.46]) W.push(K.plank(0.12, 0.08, 1.22, 0x6f4f31, x, 0.04, 0));
  [-0.45, -0.15, 0.15, 0.45].forEach((z, i) => W.push(K.plank(1.24, 0.05, 0.27, i % 2 ? 0x8e6b45 : 0x9a774c, 0, 0.105, z, 0, (K.rnd() - 0.5) * 0.04, 0)));
  const B = 0.13, BZ = -0.12;

  // beehive body: rough lathe with coiled-clay colour bands and soot creeping up the top
  const prof = [[0, 0], [0.47, 0], [0.52, 0.1], [0.53, 0.3], [0.49, 0.5], [0.39, 0.66], [0.24, 0.78], [0.1, 0.83], [0, 0.84]]
    .map(([r, y]) => new T.Vector2(r, y));
  const body = K.roughen(new T.LatheGeometry(prof, 9), 0.05, (x, y, z) => Math.hypot(x, z) < 0.01);
  K.paint(body, 0xc0764a, (x, y, z, nx, ny, nz, c) => {
    const band = Math.floor(y / 0.13) % 2;
    c.multiplyScalar(band ? 1.06 : 0.9);
    c.lerp(new T.Color(0x4a3428), Math.max(0, (y - 0.5) / 0.34) * 0.45);
    if (y < 0.03) c.multiplyScalar(0.7);
  });
  C.push(K.bake(body, 0, B, BZ, 0, 0.3, 0));

  // front mouth collar: arch-shaped hole, extruded, sooty inside
  const MW = 0.3, MH = 0.46, HW = 0.16, HS = 0.04, HC = 0.2;
  const outer = new T.Shape();
  outer.moveTo(-MW, 0); outer.lineTo(MW, 0); outer.lineTo(MW, MH - MW); outer.absarc(0, MH - MW, MW, 0, Math.PI, false); outer.lineTo(-MW, 0);
  const hole = new T.Path();
  hole.moveTo(-HW, HS); hole.lineTo(-HW, HC); hole.absarc(0, HC, HW, Math.PI, 0, true); hole.lineTo(HW, HS); hole.lineTo(-HW, HS);
  outer.holes.push(hole);
  const collar = new T.ExtrudeGeometry(outer, { depth: 0.2, bevelEnabled: false, curveSegments: 4 });
  K.roughen(collar, 0.018);
  K.paint(collar, 0xb06a42, (x, y, z, nx, ny, nz, c) => {
    const inHole = Math.abs(x) < HW + 0.03 && y < HC + HW + 0.03 && y > HS - 0.03;
    if (inHole && z < 0.19) c.setHex(0x3a2a22);
    else if (inHole) c.lerp(new T.Color(0x3a2a22), 0.5);
    if (y > MH - 0.06) c.multiplyScalar(0.85);
  });
  C.push(K.bake(collar, 0, B, BZ + 0.44));
  // stone sill under the mouth + a couple of loose stones and a chimney
  S.push(K.solid(new T.BoxGeometry(0.44, 0.05, 0.1), 0x8a857c, 0, B + 0.025, BZ + 0.68));
  S.push(K.pebble(0.09, 0x8c877d, -0.47, B + 0.05, 0.42));
  S.push(K.pebble(0.07, 0x7d786f, 0.5, B + 0.04, -0.46));
  S.push(K.pebble(0.06, 0x938d82, -0.42, B + 0.035, -0.48));

  const CX = 0.12, CZ = BZ - 0.1, CY0 = B + 0.62, CY1 = B + 1.12;
  const chim = K.roughen(new T.CylinderGeometry(0.095, 0.12, CY1 - CY0, 7, 1), 0.015);
  K.paint(chim, 0x8f8a80, (x, y, z, nx, ny, nz, c) => { if (ny > 0.9) c.setHex(0x1e1714); else c.lerp(new T.Color(0x3b3430), Math.max(0, y / (CY1 - CY0) + 0.2)); });
  S.push(K.bake(chim, CX, (CY0 + CY1) / 2, CZ));
  const lip = new T.CylinderGeometry(0.135, 0.135, 0.05, 7, 1);
  K.paint(lip, 0x6e6861, (x, y, z, nx, ny, nz, c) => { if (ny > 0.9 && Math.hypot(x, z) < 0.1) c.setHex(0x1e1714); });
  S.push(K.bake(lip, CX, CY1, CZ, 0, 0.4, 0));

  // glow: the back of the mouth plus a little ember heap, one emissive mesh
  const glowShape = new T.Shape();
  glowShape.moveTo(-HW, HS); glowShape.lineTo(HW, HS); glowShape.lineTo(HW, HC); glowShape.absarc(0, HC, HW, 0, Math.PI, false); glowShape.lineTo(-HW, HS);
  GL.push(K.bake(new T.ShapeGeometry(glowShape, 4), 0, B, BZ + 0.56));
  for (const [x, s] of [[-0.07, 0.06], [0.05, 0.07], [0, 0.05]]) GL.push(K.bake(new T.IcosahedronGeometry(s, 0), x, B + HS + 0.02, BZ + 0.6, K.rnd(), K.rnd(), 0, 1, 0.6, 1));

  K.add(g, W, M.wood, 'smelterPallet');
  K.add(g, C, M.clay, 'smelterClay');
  K.add(g, S, M.stone, 'smelterStone');
  const glow = K.add(g, GL, glowMaterial(T), 'glow', false);
  glow.receiveShadow = true;

  // output tray on the front-right of the pallet; 'ingotTray' origin sits on the tray floor
  const tray = new T.Group(); tray.name = 'ingotTray'; tray.position.set(0.46, B + 0.03, 0.43); tray.rotation.y = -0.35;
  const TW = [K.plank(0.28, 0.02, 0.22, 0x7a5636, 0, -0.01, 0)];
  for (const s of [-1, 1]) { TW.push(K.plank(0.28, 0.04, 0.02, 0x6a4a2e, 0, 0.01, s * 0.1)); TW.push(K.plank(0.02, 0.04, 0.18, 0x6a4a2e, s * 0.13, 0.01, 0)); }
  K.add(tray, TW, M.wood, 'ingotTrayWood');
  MT.push(K.solid(new T.CylinderGeometry(0.06, 0.085, 0.045, 4, 1), 0xc3c8cc, 0, 0.0225, 0, 0, Math.PI / 4, 0, 1.5, 1, 0.8));
  const ingot = K.add(tray, MT, M.metal, 'ingot');
  ingot.visible = false;
  g.add(tray);

  g.userData.glow = glow;
  return finish(T, g, 'smelter');
}

// amount 0..1 (0 = cold); timeSec drives a soft irregular flicker. Works on smelter and grill.
export function setSmelterGlow(group, amount = 0, timeSec = 0) {
  if (!group) return;
  let glow = group.userData && group.userData.glow;
  if (!glow) { glow = group.getObjectByName('glow'); if (group.userData) group.userData.glow = glow; }
  if (!glow || !glow.material) return;
  const a = Math.max(0, Math.min(1, Number(amount) || 0)), t = Number(timeSec) || 0;
  const flicker = 0.82 + 0.1 * Math.sin(t * 7.3) + 0.06 * Math.sin(t * 13.1 + 1.7) + 0.05 * Math.sin(t * 23.7 + 0.4);
  glow.material.emissiveIntensity = a * 2.2 * flicker;
  // hot = orange-yellow, dying = deep red
  glow.material.emissive.setRGB(1, 0.22 + 0.28 * a * flicker, 0.05 + 0.05 * a);
}

// ---------------------------------------------------------------- RESEARCH TABLE (~1.12 x 0.7, ~0.95 tall)
export function createResearchTableModel(T) {
  const M = mats(T), K = kit(T, 0x7ab1e5);
  const g = new T.Group(); g.name = 'researchTable';
  const W = [], P = [], BR = [], GS = [], ST = [];
  const H = 0.78;

  // top: three planks with a little overhang, legs, side and back stretchers
  [-0.23, 0, 0.23].forEach((z, i) => W.push(K.plank(1.12, 0.05, 0.22, [0x9a774c, 0x8e6b45, 0xa07b4f][i], 0, H - 0.025, z, 0, (K.rnd() - 0.5) * 0.02, 0)));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) W.push(K.plank(0.075, H - 0.05, 0.075, 0x6f4f31, sx * 0.47, (H - 0.05) / 2, sz * 0.26, sx * sz * 0.03, 0, sz * sx * 0.02));
  for (const sx of [-1, 1]) W.push(K.plank(0.05, 0.06, 0.5, 0x765434, sx * 0.47, 0.2, 0));
  W.push(K.plank(0.9, 0.06, 0.05, 0x765434, 0, 0.2, -0.26));
  W.push(K.plank(0.98, 0.07, 0.04, 0x6a4a2e, 0, H - 0.085, 0.27));

  // open blueprint sheet with white draft lines, held by a stone
  const sx0 = -0.12, sz0 = 0.03, sr = 0.18, top = H + 0.003;
  P.push(K.bake(K.paint(new T.BoxGeometry(0.46, 0.006, 0.34), 0x3f74b5), sx0, top, sz0, 0, sr, 0));
  const line = (w, d, x, z) => {
    const c = Math.cos(sr), s = Math.sin(sr);
    P.push(K.bake(K.paint(new T.BoxGeometry(w, 0.004, d), 0xe8f1ff), sx0 + x * c + z * s, top + 0.004, sz0 - x * s + z * c, 0, sr, 0));
  };
  line(0.3, 0.012, -0.02, -0.08); line(0.012, 0.2, 0.12, 0.01); line(0.2, 0.012, -0.07, 0.06); line(0.012, 0.12, -0.17, 0.0);
  ST.push(K.pebble(0.04, 0x8a857c, sx0 + 0.2, top + 0.02, sz0 - 0.18));

  // rolled blueprint lying at the back, with a red tie
  const roll = new T.CylinderGeometry(0.045, 0.045, 0.52, 8, 1);
  K.paint(roll, 0x4a80c0, (x, y, z, nx, ny, nz, c) => { if (Math.abs(ny) > 0.9) c.setHex(Math.hypot(x, z) < 0.02 ? 0x2a4f80 : 0xdbe7f5); });
  P.push(K.bake(roll, 0.06, H + 0.045, -0.24, 0, 0.12, Math.PI / 2));
  P.push(K.bake(K.paint(new T.CylinderGeometry(0.049, 0.049, 0.025, 8, 1), 0xc0392b), 0.08, H + 0.045, -0.242, 0, 0.12, Math.PI / 2));

  // magnifier resting on the sheet
  const MX = 0.08, MZ = 0.12, MR = -0.6;
  BR.push(K.bake(K.paint(new T.TorusGeometry(0.07, 0.013, 4, 10), 0xc59a45), MX, H + 0.016, MZ, Math.PI / 2, 0, MR));
  const hx = MX + Math.cos(MR) * 0.15, hz = MZ - Math.sin(MR) * 0.15;
  W.push(K.bake(K.wood(new T.CylinderGeometry(0.014, 0.018, 0.16, 6, 1), 0x5a3b22), hx, H + 0.018, hz, 0, MR, Math.PI / 2));
  GS.push(K.bake(new T.CircleGeometry(0.062, 10), MX, H + 0.018, MZ, -Math.PI / 2, 0, 0));

  // little specimen jar with a cork
  const jar = new T.CylinderGeometry(0.055, 0.06, 0.13, 8, 1, true);
  GS.push(K.bake(jar, 0.4, H + 0.065, 0.06));
  W.push(K.bake(K.paint(new T.CylinderGeometry(0.045, 0.04, 0.04, 8, 1), 0xb58a5a), 0.4, H + 0.145, 0.06));
  ST.push(K.pebble(0.03, 0x6fb0a0, 0.39, H + 0.03, 0.07, 0.9));
  ST.push(K.pebble(0.025, 0xc9b27a, 0.42, H + 0.025, 0.04, 0.9));

  K.add(g, W, M.wood, 'tableWood');
  K.add(g, P, M.paper, 'tablePaper');
  K.add(g, BR, M.brass, 'tableBrass');
  K.add(g, ST, M.stone, 'tableStones');
  const glass = K.add(g, GS, M.glass, 'tableGlass', false);
  glass.renderOrder = 1;
  return finish(T, g, 'researchTable');
}

// ---------------------------------------------------------------- GRILL (~0.8 x 0.8, ~0.75 tall)
export function createGrillModel(T) {
  const M = mats(T), K = kit(T, 0x96111e);
  const g = new T.Group(); g.name = 'grill';
  const MT = [], S = [], GL = [], FS = [];
  const Y = 0.5;

  // iron bowl on three splayed legs
  const bowl = new T.LatheGeometry([[0.12, 0], [0.3, 0.06], [0.36, 0.16], [0.34, 0.17]].map(([r, y]) => new T.Vector2(r, y)), 8);
  K.paint(bowl, 0x4a4f52, (x, y, z, nx, ny, nz, c) => { if (y > 0.15) c.setHex(0x6c7175); });
  MT.push(K.bake(bowl, 0, Y - 0.12, 0));
  MT.push(K.bake(K.paint(new T.CircleGeometry(0.12, 8), 0x2a2d2f), 0, Y - 0.118, 0, -Math.PI / 2, 0, 0));
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + 0.3;
    MT.push(K.bake(K.paint(new T.BoxGeometry(0.04, 0.46, 0.04), 0x3e4245), Math.cos(a) * 0.24, 0.22, Math.sin(a) * 0.24, Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22));
  }
  // grate bars
  for (let i = -2; i <= 2; i++) MT.push(K.bake(K.paint(new T.BoxGeometry(0.66, 0.018, 0.018), 0x2f3335), 0, Y + 0.06, i * 0.11));
  for (const s of [-1, 1]) MT.push(K.bake(K.paint(new T.BoxGeometry(0.018, 0.018, 0.5), 0x2f3335), s * 0.24, Y + 0.05, 0));

  // coals (glow) and a few charred stones
  for (const [x, z, s] of [[-0.1, 0.05, 0.07], [0.08, -0.06, 0.08], [0.02, 0.1, 0.06], [-0.04, -0.1, 0.06], [0.14, 0.08, 0.05]]) GL.push(K.bake(new T.IcosahedronGeometry(s, 0), x, Y - 0.04, z, K.rnd() * 3, K.rnd() * 3, 0, 1, 0.65, 1));
  S.push(K.pebble(0.05, 0x3c3633, -0.18, Y - 0.04, -0.03));

  // fish on the grate
  const fish = new T.SphereGeometry(0.06, 6, 4);
  K.paint(fish, 0x8fa3a8, (x, y, z, nx, ny, nz, c) => { if (ny > 0.3) c.setHex(0x9a6a3e); if (ny < -0.3) c.setHex(0xd8d2c0); });
  FS.push(K.bake(fish, 0, Y + 0.105, 0.0, 0, 0.3, 0, 2.6, 0.7, 1));
  const tail = new T.ConeGeometry(0.06, 0.1, 3);
  K.paint(tail, 0x7b6346);
  FS.push(K.bake(tail, -0.19, Y + 0.105, 0.06, 0, 0.3, Math.PI / 2, 1, 1, 0.35));
  FS.push(K.bake(K.paint(new T.SphereGeometry(0.012, 4, 3), 0x111111), 0.12, Y + 0.12, -0.02));

  K.add(g, MT, M.metal, 'grillIron');
  K.add(g, S, M.stone, 'grillStones');
  K.add(g, FS, M.clay, 'grillFish');
  const glow = K.add(g, GL, glowMaterial(T), 'glow', false);
  glow.receiveShadow = true;
  g.userData.glow = glow;
  return finish(T, g, 'grill');
}
