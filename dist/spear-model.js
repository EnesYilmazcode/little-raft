// Held wooden spear (own procedural art). ES module, no textures.
// createSpear(T) -> Group in "as held" metres: shaft along +Y, butt at the bottom, tip at the top,
// origin = centre of its bounds. The blade is flat in the local X/Y plane (broad face toward +-Z).
//   userData.grip  Vector3: centre of the rope grip wrap (where the fist closes), root space
//   userData.tip   Vector3: the point of the blade, root space
//   userData.size  {x,y,z}
// Geometry is merged per material: 3 meshes (pale shaft, rope lashings, scrap blade), built once
// per call; hands.js builds held models lazily and caches them.
import { mergeGeometries } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';

const SHAFT = 0.80;      // butt to blade root
const BLADE = 0.15;      // blade length
const GRIP_Y = 0.29;     // grip wrap centre, from the butt

export function createSpear(T) {
  const root = new T.Group(); root.name = 'woodenSpear';
  const inner = new T.Group(); root.add(inner);
  const wood = [], rope = [], blade = [];
  const at = (g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz));
    g.applyMatrix4(m);
    // keep the attribute set identical across parts (mergeGeometries needs it)
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') g.deleteAttribute(n);
    return g;
  };

  // ---- shaft: slightly tapered pale driftwood pole with a rounded butt and a split head
  wood.push(at(new T.CylinderGeometry(0.0145, 0.0175, SHAFT, 9, 4), 0, SHAFT / 2, 0));
  wood.push(at(new T.SphereGeometry(0.0175, 9, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0, 0, 0));
  // two little knots on the shaft so it reads as wood, not a dowel
  wood.push(at(new T.SphereGeometry(0.008, 6, 4), 0.014, 0.52, 0.003, 0, 0, 0, 1, 1.6, 1));
  wood.push(at(new T.SphereGeometry(0.007, 6, 4), -0.013, 0.14, -0.004, 0, 0, 0, 1, 1.5, 1));
  // split cheeks either side of the blade root
  for (const s of [-1, 1]) wood.push(at(new T.BoxGeometry(0.009, 0.05, 0.022), s * 0.0105, SHAFT + 0.012, 0, 0, 0, -s * 0.12));

  // ---- rope: hand grip wrap + head lashing + a short loose tail
  rope.push(at(new T.CylinderGeometry(0.0215, 0.0215, 0.13, 10, 1), 0, GRIP_Y, 0));
  for (let i = 0; i < 5; i++) rope.push(at(new T.TorusGeometry(0.0215, 0.0042, 5, 12), 0, GRIP_Y - 0.06 + i * 0.03, 0, Math.PI / 2 + (i % 2 ? 0.18 : -0.18), 0, 0));
  for (let i = 0; i < 4; i++) rope.push(at(new T.TorusGeometry(0.0178, 0.0042, 5, 12), 0, SHAFT - 0.045 + i * 0.016, 0, Math.PI / 2 + (i % 2 ? 0.25 : -0.25), 0, 0));
  rope.push(at(new T.CylinderGeometry(0.003, 0.0025, 0.07, 5), 0.02, SHAFT - 0.075, 0.006, 0, 0, 0.35));

  // ---- blade: a flattened leaf of sharpened scrap, wedged into the split head
  blade.push(at(new T.ConeGeometry(0.03, BLADE * 0.78, 4, 1), 0, SHAFT + 0.03 + BLADE * 0.39, 0, 0, 0, 0, 1, 1, 0.32));
  blade.push(at(new T.ConeGeometry(0.03, BLADE * 0.22, 4, 1), 0, SHAFT + 0.03 - BLADE * 0.11, 0, Math.PI, 0, 0, 1, 1, 0.32));

  const shaftMat = new T.MeshStandardMaterial({ color: 0xd8c39a, roughness: 0.82, metalness: 0 });
  const ropeMat = new T.MeshStandardMaterial({ color: 0x9c7c4c, roughness: 0.95, metalness: 0 });
  const bladeMat = new T.MeshStandardMaterial({ color: 0xaeb9bf, roughness: 0.38, metalness: 0.55, flatShading: true });
  for (const [list, mat, name] of [[wood, shaftMat, 'spearShaft'], [rope, ropeMat, 'spearRope'], [blade, bladeMat, 'spearBlade']]) {
    const g = mergeGeometries(T, list); for (const p of list) p.dispose();
    g.computeBoundingSphere();
    const m = new T.Mesh(g, mat); m.name = name; inner.add(m);
  }

  inner.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(inner), center = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3());
  inner.position.sub(center);
  root.userData.size = { x: size.x, y: size.y, z: size.z };
  root.userData.grip = new T.Vector3(0, GRIP_Y, 0).sub(center);
  root.userData.tip = new T.Vector3(0, SHAFT + 0.03 + BLADE * 0.78, 0).sub(center);
  return root;
}
