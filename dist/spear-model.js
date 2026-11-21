// Held spear model (first-person). Original procedural meshes, no textures. ES module.
// Usage: import { createSpear } from './spear-model.js?build=v3-survival-ae77fa84ac2b'; const g = createSpear(THREE, {metal:false});
// Orientation: shaft along +Y, butt at -Y, point at +Y. Length ~1.9.
// Wooden: knotty driftwood shaft, chipped flint/scrap point lashed with rope.
// Metal: smooth darker shaft, leaf-shaped steel point on a bolted collar.
// userData.grip  Vector3: where the right hand holds it (rear third), in root space.
// userData.tip   Vector3: point tip, in root space.
// No mesh casts shadows (viewmodel only).

export function createSpear(T, { metal = false } = {}) {
  const root = new T.Group();
  root.name = metal ? 'metalSpear' : 'woodSpear';
  const mats = [], geos = [];
  const mat = (color, roughness, metalness = 0) => { const m = new T.MeshStandardMaterial({ color, roughness, metalness }); mats.push(m); return m; };
  const add = (geo, m, x = 0, y = 0, z = 0) => {
    geos.push(geo);
    const mesh = new T.Mesh(geo, m); mesh.position.set(x, y, z);
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false;
    root.add(mesh); return mesh;
  };

  const L = 1.9, shaftR = 0.026;
  const shaftMat = mat(metal ? 0x7a5634 : 0xa87a4c, 0.88);
  const lashMat = mat(metal ? 0x5d6b78 : 0xcdb27a, metal ? 0.45 : 0.95, metal ? 0.6 : 0);

  // Shaft: slightly tapered and, for wood, a gentle bend from a lathe profile.
  const shaft = add(new T.CylinderGeometry(shaftR * 0.85, shaftR * 1.1, L, 9, 6), shaftMat, 0, 0, 0);
  if (!metal) {
    const pos = shaft.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / L; pos.setX(i, pos.getX(i) + Math.sin(y * Math.PI) * 0.012); }
    pos.needsUpdate = true; shaft.geometry.computeVertexNormals();
    // two knots
    add(new T.SphereGeometry(shaftR * 1.25, 7, 5), shaftMat, 0.008, -0.35, 0.012);
    add(new T.SphereGeometry(shaftR * 1.15, 7, 5), shaftMat, -0.01, 0.28, -0.01);
  }
  // Grip wrap (rear third)
  const gripY = -0.42;
  add(new T.CylinderGeometry(shaftR * 1.35, shaftR * 1.35, 0.26, 9, 1), lashMat, 0, gripY, 0);

  // Point
  const top = L / 2;
  let tipY;
  if (metal) {
    const collar = mat(0x8d96a3, 0.4, 0.7);
    add(new T.CylinderGeometry(shaftR * 1.5, shaftR * 1.3, 0.1, 10, 1), collar, 0, top - 0.02, 0);
    add(new T.SphereGeometry(0.012, 6, 4), collar, shaftR * 1.5, top - 0.02, 0);
    add(new T.SphereGeometry(0.012, 6, 4), collar, -shaftR * 1.5, top - 0.02, 0);
    const blade = add(new T.OctahedronGeometry(1, 0), mat(0xc6d6e0, 0.25, 0.85), 0, top + 0.17, 0);
    blade.scale.set(0.055, 0.2, 0.016);
    tipY = top + 0.37;
  } else {
    const flint = add(new T.OctahedronGeometry(1, 0), mat(0x6f6b66, 0.6, 0.1), 0, top + 0.12, 0);
    flint.scale.set(0.05, 0.16, 0.02); flint.rotation.y = 0.3;
    // rope lashing binding the point
    const lash = new T.TorusGeometry(shaftR * 1.25, 0.008, 5, 10);
    for (let i = 0; i < 3; i++) { const m = add(lash, lashMat, 0, top - 0.03 - i * 0.025, 0); m.rotation.x = Math.PI / 2 + (i - 1) * 0.18; }
    tipY = top + 0.28;
  }

  root.userData.grip = new T.Vector3(0, gripY, 0);
  root.userData.tip = new T.Vector3(0, tipY, 0);
  root.userData.dispose = () => { for (const g of new Set(geos)) g.dispose(); for (const m of mats) m.dispose(); };
  return root;
}
