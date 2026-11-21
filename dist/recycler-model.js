// Sorting Tub (station id 'recycler') model. ES module, no imports, no textures.
// Usage: const g = createRecyclerModel(THREE); g.position.set(x, .22, z);  // same origin rule as smelter-model.js
// Local origin = centre of the raft tile top; ~1.0 m footprint, rim at ~0.66 m, crank knob at ~0.8 m.
// Named children: 'recyclerCrank' (Group, pivot on the axle, spins about its local z while sorting)
// and 'recyclerPile' (Group, the little output heap; hidden until the tub has output).
// No child is named 'glow', so setSmelterGlow() is a no-op on it.

const MATS = new WeakMap();
function mats(T) {
  let m = MATS.get(T);
  if (m) return m;
  const std = (o) => new T.MeshStandardMaterial(Object.assign({ color: 0xffffff, roughness: 0.9, metalness: 0, flatShading: true, vertexColors: true }, o));
  m = { wood: std({ roughness: 0.88 }), rope: std({ roughness: 0.95 }), metal: std({ roughness: 0.5, metalness: 0.45 }), soft: std({ roughness: 0.6 }) };
  MATS.set(T, m);
  return m;
}

function kit(T, seed0) {
  let seed = seed0 >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler();
  const paint = (geo, hex, fn) => {
    const p = geo.attributes.position, n = geo.attributes.normal;
    const arr = new Float32Array(p.count * 3), c = new T.Color(), base = new T.Color(hex);
    for (let i = 0; i < p.count; i++) {
      c.copy(base);
      if (fn) fn(p.getX(i), p.getY(i), p.getZ(i), n ? n.getY(i) : 0, c);
      arr.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new T.BufferAttribute(arr, 3));
    return geo;
  };
  const at = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, fn) => {
    paint(geo, new T.Color(hex).multiplyScalar(0.94 + rnd() * 0.12).getHex(), fn || ((px, py, pz, ny, c) => { if (ny < -0.5) c.multiplyScalar(0.75); }));
    _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
    return geo.applyMatrix4(_m.compose(new T.Vector3(x, y, z), _q, new T.Vector3(1, 1, 1)));
  };
  const merge = (list) => {
    const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
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
  const add = (parent, list, mat, name) => {
    if (!list.length) return null;
    const mesh = new T.Mesh(merge(list), mat);
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  return { rnd, at, add };
}

export function createRecyclerModel(T) {
  const M = mats(T), K = kit(T, 0x5eb1ab);
  const g = new T.Group(); g.name = 'recycler';
  const W = [], R = [], MT = [], S = [];
  const H = 0.62, Y0 = 0.05, R0 = 0.34, R1 = 0.4, N = 14;

  // round tub of staves on two little skids, wider at the rim
  for (const x of [-0.2, 0.2]) W.push(K.at(new T.BoxGeometry(0.08, 0.05, 0.78), 0x6f4f31, x, 0.025, 0));
  const lean = Math.atan2(R1 - R0, H);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, r = (R0 + R1) / 2, w = 2 * Math.PI * r / N * 1.04;
    const hx = H * (1 + (i % 3 === 0 ? 0.04 : 0));
    W.push(K.at(new T.BoxGeometry(w, hx, 0.045), [0xa47a4c, 0x94693f, 0xb08452][i % 3], Math.sin(a) * r, Y0 + hx / 2, Math.cos(a) * r, lean, a, 0,
      (px, py, pz, ny, c) => { if (py > hx / 2 - 0.01) c.multiplyScalar(1.12); if (ny < -0.5) c.multiplyScalar(0.72); }));
  }
  W.push(K.at(new T.CylinderGeometry(R0 - 0.01, R0 - 0.01, 0.04, N), 0x7a5634, 0, Y0 + 0.02, 0));
  // dark inside with a sorting grate just under the rim
  W.push(K.at(new T.CylinderGeometry(R1 - 0.05, R1 - 0.05, 0.02, N), 0x3a2716, 0, Y0 + H - 0.16, 0));
  for (let i = -2; i <= 2; i++) MT.push(K.at(new T.BoxGeometry(0.018, 0.018, 0.62 - Math.abs(i) * 0.08), 0x5d666b, i * 0.11, Y0 + H - 0.12, 0));
  MT.push(K.at(new T.BoxGeometry(0.62, 0.018, 0.018), 0x5d666b, 0, Y0 + H - 0.115, 0));
  // two rope hoops
  for (const [y, rr] of [[Y0 + 0.14, R0 + 0.035], [Y0 + H - 0.1, R1 + 0.01]]) R.push(K.at(new T.TorusGeometry(rr, 0.018, 4, 18), 0xcdb07a, 0, y, 0, Math.PI / 2, 0, 0,
    (px, py, pz, ny, c) => c.multiplyScalar(0.85 + 0.25 * Math.max(0, Math.sin(Math.atan2(pz, px) * 30)))));

  // three tiny bins hooked over the back rim: rust (scrap), blue (plastic), sand
  [[-0.24, 0xa5522a, 0x8e989e], [0, 0x3d8fd1, 0x7cc4e0], [0.24, 0xd9b35a, 0xe8d39a]].forEach(([x, box, fill], i) => {
    const z = -R1 - 0.02, y = Y0 + H - 0.05, ry = x * 0.9;
    S.push(K.at(new T.BoxGeometry(0.16, 0.12, 0.11), box, x, y, z, 0.12, ry, 0));
    S.push(K.at(i === 2 ? new T.SphereGeometry(0.06, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2) : new T.BoxGeometry(0.11, 0.03, 0.07), fill, x, y + 0.05, z + 0.01, i === 2 ? 0 : 0.1, ry + i, 0));
  });

  // side axle box + axle along z (front), crank pivots on it
  const AX = 0.12, AY = Y0 + H - 0.2, AZ = R1 + 0.06;
  W.push(K.at(new T.BoxGeometry(0.18, 0.2, 0.12), 0x765434, AX, AY, R1 + 0.0));
  MT.push(K.at(new T.CylinderGeometry(0.022, 0.022, 0.1, 8), 0x5d666b, AX, AY, AZ, Math.PI / 2, 0, 0));
  const crank = new T.Group(); crank.name = 'recyclerCrank'; crank.position.set(AX, AY, AZ + 0.05);
  const CW = [], CM = [];
  CM.push(K.at(new T.CylinderGeometry(0.035, 0.035, 0.03, 8), 0x8e989e, 0, 0, 0, Math.PI / 2, 0, 0));
  CW.push(K.at(new T.BoxGeometry(0.05, 0.2, 0.025), 0x9a6a3c, 0, 0.09, 0.01));
  CW.push(K.at(new T.CylinderGeometry(0.03, 0.026, 0.09, 8), 0xe8792e, 0, 0.17, 0.06, Math.PI / 2, 0, 0));
  K.add(crank, CW, M.wood, 'recyclerCrankWood');
  K.add(crank, CM, M.metal, 'recyclerCrankHub');
  g.add(crank);

  // output pile on the deck in front-left: scrap bits, blue plastic chips, a sand mound
  const pile = new T.Group(); pile.name = 'recyclerPile'; pile.position.set(-0.32, 0, 0.38);
  const PS = [];
  PS.push(K.at(new T.SphereGeometry(0.09, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), 0xe8d39a, 0.02, 0, 0.04));
  PS.push(K.at(new T.BoxGeometry(0.09, 0.02, 0.06), 0x8e989e, -0.07, 0.03, -0.03, 0.2, 0.5, 0.15));
  PS.push(K.at(new T.BoxGeometry(0.07, 0.02, 0.05), 0xa5522a, 0.08, 0.05, -0.02, -0.25, 1.1, 0.1));
  PS.push(K.at(new T.BoxGeometry(0.06, 0.03, 0.05), 0x7cc4e0, -0.02, 0.08, 0.0, 0.3, 0.2, -0.3));
  PS.push(K.at(new T.BoxGeometry(0.05, 0.025, 0.04), 0x3d8fd1, 0.05, 0.02, 0.09, 0, 2.1, 0.2));
  K.add(pile, PS, M.soft, 'recyclerPileBits');
  pile.visible = false;
  g.add(pile);

  K.add(g, W, M.wood, 'recyclerWood');
  K.add(g, R, M.rope, 'recyclerRope');
  K.add(g, MT, M.metal, 'recyclerMetal');
  K.add(g, S, M.soft, 'recyclerBins');

  g.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(g), size = box.getSize(new T.Vector3());
  g.userData.craftType = 'recycler';
  g.userData.size = { x: size.x, y: size.y, z: size.z };
  g.userData.height = box.max.y;
  return g;
}

export default createRecyclerModel;
