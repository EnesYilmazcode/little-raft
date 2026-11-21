// Draws many copies of one baked scenery model (drifting islands, clouds) as InstancedMeshes, one per
// material of the model. The original groups stay as empty proxies: sailing, day/night and diving keep
// moving, scaling and hiding them, and sync() copies their transform and visibility into the instances.
export function createSceneryInstances(T, proxies, meshes) {
  const n = proxies.length, last = new Float64Array(n * 10).fill(NaN);
  const m4 = new T.Matrix4(), ZERO = new T.Matrix4().makeScale(0, 0, 0);
  const out = meshes.map(src => {
    const m = new T.InstancedMesh(src.geometry, src.material, n);
    m.name = src.name || 'scenery'; m.castShadow = src.castShadow; m.receiveShadow = src.receiveShadow;
    m.instanceMatrix.setUsage(T.DynamicDrawUsage); m.userData.scenery = true;
    return m;
  });
  function sync() {
    let dirty = false, any = false;
    for (let i = 0; i < n; i++) {
      const g = proxies[i], p = g.position, s = g.scale, q = g.quaternion, o = i * 10, vis = g.visible ? 1 : 0;
      if (vis) any = true;
      if (last[o] === p.x && last[o + 1] === p.y && last[o + 2] === p.z && last[o + 3] === s.x && last[o + 4] === s.y && last[o + 5] === s.z
        && last[o + 6] === q.x && last[o + 7] === q.y && last[o + 8] === q.z && last[o + 9] === vis) continue;
      last[o] = p.x; last[o + 1] = p.y; last[o + 2] = p.z; last[o + 3] = s.x; last[o + 4] = s.y; last[o + 5] = s.z;
      last[o + 6] = q.x; last[o + 7] = q.y; last[o + 8] = q.z; last[o + 9] = vis; dirty = true;
      const mat = vis ? m4.compose(p, q, s) : ZERO;
      for (const m of out) m.setMatrixAt(i, mat);
    }
    if (dirty) for (const m of out) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
    for (const m of out) m.visible = any; // all hidden (underwater): skip the draw
    return dirty;
  }
  sync();
  return { meshes: out, sync };
}
