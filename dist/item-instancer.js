// Draws the floating supplies as instanced meshes: one draw per (geometry, material) instead of one per
// item part. The per-item meshes stay in the scene graph for picking and hooking (the raycaster ignores
// `visible`), but are hidden; every frame update() copies the world matrix of each visible, on-screen
// part into its bucket's InstancedMesh.
//   const inst = createItemInstancer(T, scene);
//   inst.adopt(itemRoot)          // after building an item: takes over its meshes with shared geometry
//   inst.update(itemsGroup, cam)  // right before renderer.render, after items and the hook moved
// Only meshes whose geometry.userData.shared is true are taken (cached models, so buckets stay few);
// anything else (e.g. the signal cache and its beam) keeps drawing itself.

export function createItemInstancer(T, scene) {
  const root = new T.Group();
  root.name = 'itemInstances';
  scene.add(root);
  const parts = new WeakMap(); // item root -> adopted meshes
  const buckets = new Map();   // key -> {mesh, n, src}
  const all = [];              // the same buckets, for allocation-free per-frame loops
  const frustum = new T.Frustum(), pv = new T.Matrix4(), sphere = new T.Sphere();
  const noRaycast = () => {};

  function bucket(m) {
    const key = `${m.geometry.id}|${m.material.id}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.renderOrder}`;
    let b = buckets.get(key);
    if (!b) { b = { mesh: null, n: 0, src: m }; grow(b, 8); buckets.set(key, b); all.push(b); }
    return b;
  }
  function grow(b, cap) {
    const s = b.src, im = new T.InstancedMesh(s.geometry, s.material, cap);
    im.name = 'itemInstanced';
    im.instanceMatrix.setUsage(T.DynamicDrawUsage);
    im.frustumCulled = false; // culled per instance in update()
    im.castShadow = s.castShadow; im.receiveShadow = s.receiveShadow; im.renderOrder = s.renderOrder;
    im.raycast = noRaycast;   // picking goes through the hidden per-item meshes
    im.count = 0; im.visible = false;
    if (b.mesh) { im.instanceMatrix.array.set(b.mesh.instanceMatrix.array); root.remove(b.mesh); b.mesh.dispose(); }
    root.add(im);
    b.mesh = im;
  }

  return {
    adopt(item) {
      const list = [];
      item.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || !o.visible || !o.geometry?.userData.shared || Array.isArray(o.material)) return;
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        o.visible = false;
        list.push({ mesh: o, bucket: bucket(o) });
      });
      if (list.length) parts.set(item, list);
    },
    update(group, camera) {
      for (let i = 0; i < all.length; i++) all[i].n = 0;
      group.updateMatrixWorld();
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const items = group.children;
      for (let i = 0; i < items.length; i++) {
        const item = items[i], list = parts.get(item);
        if (!list || !item.visible) continue;
        for (let j = 0; j < list.length; j++) {
          const mesh = list[j].mesh, b = list[j].bucket;
          let o = mesh.parent, shown = true;
          while (o && o !== item) { if (!o.visible) { shown = false; break; } o = o.parent; }
          if (!shown) continue;
          if (!frustum.intersectsSphere(sphere.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld))) continue;
          if (b.n === b.mesh.instanceMatrix.count) grow(b, b.n * 2);
          b.mesh.instanceMatrix.array.set(mesh.matrixWorld.elements, b.n * 16);
          b.n++;
        }
      }
      for (let i = 0; i < all.length; i++) {
        const b = all[i], im = b.mesh;
        if (b.n) im.instanceMatrix.needsUpdate = true;
        im.count = b.n; im.visible = b.n > 0;
      }
    },
  };
}
