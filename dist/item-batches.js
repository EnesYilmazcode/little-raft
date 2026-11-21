// Instanced drawing for floating items. Every jug shares one geometry/material pair and every debris
// item one of a few cached variants (userData.shared), so all items using the same pair are drawn by
// one InstancedMesh instead of one draw call each.
//
// createItemBatches(T, source) -> { root, adopt(group), update(camera), dispose() }
//   source: the group holding one child group per item (game.js itemsGroup). It keeps its meshes:
//   adopt() hides the batchable ones, which stay in place as raycast proxies (three's Raycaster
//   ignores `visible`) and as the source of each instance's matrix.
//   root: add to the scene next to `source`, never inside it (foam and picking walk source.children).
//   update(camera): fill the batches from the proxies' world matrices, culled against `camera`.
//   Call it from scene.onBeforeRender, where world matrices are fresh for this frame and the
//   renderer has not yet culled or uploaded anything.
// Items whose material is not shared (art lane swaps, bottles, the signal cache) are left as normal meshes.

const FIRST_CAPACITY = 16;

export function createItemBatches(T, source) {
  const root = new T.Group();
  root.name = 'item-batches';
  const byGeo = new Map(); // geometry -> Map(material -> batch)
  const batches = [];
  const frustum = new T.Frustum(), viewProj = new T.Matrix4(), sphere = new T.Sphere();

  const batchable = (o) => o.isMesh && !o.isInstancedMesh && !Array.isArray(o.material)
    && o.geometry.userData.shared === true && o.material.userData.shared === true;

  function makeMesh(geo, mat, capacity) {
    const m = new T.InstancedMesh(geo, mat, capacity);
    m.name = 'item-batch';
    m.instanceMatrix.setUsage(T.DynamicDrawUsage);
    m.frustumCulled = false; // update() culls each instance itself
    m.castShadow = false; m.receiveShadow = true; // same flags as the per-item meshes had
    m.count = 0;
    return m;
  }
  function batchFor(geo, mat) {
    let byMat = byGeo.get(geo);
    if (!byMat) byGeo.set(geo, (byMat = new Map()));
    let b = byMat.get(mat);
    if (!b) {
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      b = { geo, mat, mesh: makeMesh(geo, mat, FIRST_CAPACITY), count: 0 };
      root.add(b.mesh);
      byMat.set(mat, b);
      batches.push(b);
    }
    return b;
  }
  function grow(b) {
    const old = b.mesh, next = makeMesh(b.geo, b.mat, old.instanceMatrix.count * 2);
    next.instanceMatrix.array.set(old.instanceMatrix.array);
    root.remove(old); old.dispose(); root.add(next);
    b.mesh = next;
  }
  // A proxy is drawn when it and all its ancestors are visible (pending pickups hide their group).
  function shown(o) {
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  return {
    root,
    adopt(group) {
      const list = [];
      group.traverse((o) => { if (batchable(o)) { o.visible = false; list.push(o); batchFor(o.geometry, o.material); } });
      group.userData.batched = list;
    },
    update(camera) {
      for (let i = 0; i < batches.length; i++) batches[i].count = 0;
      if (root.visible && shown(source) && source.visible) {
        viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(viewProj);
        const kids = source.children;
        for (let i = 0; i < kids.length; i++) {
          const g = kids[i], list = g.userData.batched;
          if (!list || !g.visible) continue;
          for (let j = 0; j < list.length; j++) {
            const o = list[j];
            if (!shown(o)) continue;
            // the geometry can change after adopt (debris variants are swapped in once built)
            sphere.copy(o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere)).applyMatrix4(o.matrixWorld);
            if (!frustum.intersectsSphere(sphere)) continue;
            const b = batchFor(o.geometry, o.material);
            if (b.count === b.mesh.instanceMatrix.count) grow(b);
            o.matrixWorld.toArray(b.mesh.instanceMatrix.array, b.count * 16);
            b.count++;
          }
        }
      }
      for (let i = 0; i < batches.length; i++) {
        const b = batches[i], m = b.mesh;
        m.visible = b.count > 0; // an empty batch would still cost a draw call
        if (b.count === 0) continue;
        m.count = b.count;
        m.instanceMatrix.clearUpdateRanges();
        m.instanceMatrix.addUpdateRange(0, b.count * 16);
        m.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      for (const b of batches) b.mesh.dispose();
      batches.length = 0; byGeo.clear(); root.clear();
    },
  };
}
