// Held paint brush model (first-person). ES module, procedural only, original art.
// Usage: import { createBrush } from './brush-model.js?build=v3-survival-ae77fa84ac2b'; const g = createBrush(THREE);
// Root group is re-centred on its bounding box (origin = box centre). About 0.55 tall along +Y,
// handle butt at -Y, bristles at +Y, bristle block flat across X.
// userData.grip  Vector3: middle of the handle, in root space (put the hand here)
// userData.tip   the paint-tip mesh; it owns its MeshStandardMaterial, so its colour can be set alone
// Meshes: handle, butt cap, ferrule, ferrule crimp, bristles, tip = 6.
export function createBrush(T) {
  const root = new T.Group();
  root.name = 'paintBrush';
  const inner = new T.Group();
  root.add(inner);

  const wood = new T.MeshStandardMaterial({ color: '#b98a58', roughness: .8, metalness: 0 });
  const tin = new T.MeshStandardMaterial({ color: '#b9c2c4', roughness: .45, metalness: .3 });
  const bristle = new T.MeshStandardMaterial({ color: '#e8dcc0', roughness: .95, metalness: 0 });
  const tipMat = new T.MeshStandardMaterial({ color: '#c69860', roughness: .7, metalness: 0 });
  const add = (geo, m, y, name) => { const mesh = new T.Mesh(geo, m); mesh.position.y = y; mesh.name = name; mesh.castShadow = true; inner.add(mesh); return mesh; };

  // Tapered handle: thin at the butt, swelling toward the ferrule.
  const HANDLE = .33;
  add(new T.CylinderGeometry(.021, .014, HANDLE, 8), wood, HANDLE / 2, 'brush-handle');
  add(new T.SphereGeometry(.015, 8, 6), wood, 0, 'brush-butt');
  // Tin ferrule: a flattened sleeve that holds the bristles, plus a crimp ring.
  const ferrule = add(new T.CylinderGeometry(.034, .024, .09, 8), tin, HANDLE + .045, 'brush-ferrule');
  ferrule.scale.z = .55;
  const crimp = add(new T.CylinderGeometry(.026, .026, .014, 8), tin, HANDLE + .012, 'brush-crimp');
  crimp.scale.z = .7;
  // Bristle block and the painted tip at its end.
  const BR = .12, by = HANDLE + .09 + BR / 2;
  add(new T.BoxGeometry(.09, BR, .04), bristle, by, 'brush-bristles');
  const tip = add(new T.BoxGeometry(.094, .05, .044), tipMat, by + BR / 2 - .018, 'brush-tip'); // paint-soaked end, a hair wider than the block

  // Re-centre on the bounding box.
  const box = new T.Box3().setFromObject(inner), center = box.getCenter(new T.Vector3());
  inner.position.sub(center);
  root.userData.grip = new T.Vector3(0, HANDLE / 2, 0).sub(center);
  root.userData.tip = tip;
  return root;
}
