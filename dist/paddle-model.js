// Held paddle model (first-person and icon). Original procedural meshes, no textures. ES module.
// Usage: import { createPaddle } from './paddle-model.js?build=v3-survival-ae77fa84ac2b'; const g = createPaddle(THREE);
// Orientation: shaft along +Y, T-grip at -Y, blade at +Y (working end +Y, like the other tools). Length ~1.5.
// A driftwood shaft lashed with rope, a plank blade with a plastic-jug patch screwed on as a wear plate.
// userData.grip Vector3: where the right hand holds it (upper shaft), root space. userData.blade: blade centre.

export function createPaddle(T) {
  const root = new T.Group();
  root.name = 'paddle';
  const mats = [], geos = [];
  const mat = (color, roughness, metalness = 0) => { const m = new T.MeshStandardMaterial({ color, roughness, metalness }); mats.push(m); return m; };
  const add = (geo, m, x = 0, y = 0, z = 0) => {
    geos.push(geo);
    const mesh = new T.Mesh(geo, m); mesh.position.set(x, y, z);
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false;
    root.add(mesh); return mesh;
  };
  const wood = mat(0xa87a4c, 0.88), plank = mat(0xc29462, 0.85), rope = mat(0xcdb27a, 0.95), jug = mat(0xe9e5d6, 0.6);

  const L = 1.05, r = 0.024;
  add(new T.CylinderGeometry(r * 0.9, r, L, 9, 1), wood, 0, -0.1, 0);                       // shaft
  const grip = add(new T.CylinderGeometry(r * 0.9, r * 0.9, 0.16, 8, 1), wood, 0, -0.1 - L / 2, 0); // T-grip
  grip.rotation.z = Math.PI / 2;
  add(new T.CylinderGeometry(r * 1.3, r * 1.3, 0.2, 9, 1), rope, 0, -0.38, 0);              // hand wrap

  // Blade: a tapered plank (box with the throat narrowed), rounded tip, plastic wear patch.
  const bladeY = 0.42 + 0.22, bw = 0.2, bh = 0.46, bt = 0.026;
  const blade = new T.BoxGeometry(bw, bh, bt, 1, 4, 1), pos = blade.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = pos.getY(i) / bh + 0.5; // 0 throat .. 1 tip
    const w = 0.35 + 0.65 * Math.min(1, v * 2.2);
    pos.setX(i, pos.getX(i) * w * (v > 0.9 ? 0.86 : 1));
  }
  pos.needsUpdate = true; blade.computeVertexNormals();
  add(blade, plank, 0, bladeY, 0);
  add(new T.BoxGeometry(bw * 0.62, bh * 0.36, bt * 1.25), jug, 0, bladeY + bh * 0.16, 0);
  for (let i = 0; i < 3; i++) {                                                                // throat lashing
    const m = add(new T.TorusGeometry(r * 1.35, 0.008, 5, 10), rope, 0, bladeY - bh / 2 - 0.02 - i * 0.025, 0);
    m.rotation.x = Math.PI / 2 + (i - 1) * 0.18;
  }

  root.userData.grip = new T.Vector3(0, -0.38, 0);
  root.userData.blade = new T.Vector3(0, bladeY, 0);
  root.userData.size = { x: 0.2, y: L + bh + 0.1, z: 0.05 };
  root.userData.dispose = () => { for (const g of new Set(geos)) g.dispose(); for (const m of mats) m.dispose(); };
  return root;
}
