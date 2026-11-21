// Static batching for Little Raft: bake many meshes into one mesh per (material, shadow flags).
// Drop-in for dist/ (no imports; pass the three namespace like the other dist modules):
//   import { mergeMeshesByMaterial } from './merge.js?build=...';
//   const meshes = mergeMeshesByMaterial(T, [groupA, groupB], {name:'scenery'});
// - Bakes each mesh's transform relative to `relativeTo` (default: world space), so the result is added to
//   `relativeTo` (or the scene) with an identity transform.
// - Output is non-indexed position/normal/uv (+color when every source in the bucket has it); uv is zero-filled
//   where a source has none. Source geometries are NOT disposed (callers own them; dispose when replacing).
// - Only visible meshes are merged; lines/points/skinned meshes are skipped.
export function mergeMeshesByMaterial(T, roots, { name = 'merged', relativeTo = null } = {}) {
  const inv = new T.Matrix4(), m = new T.Matrix4(), nm = new T.Matrix3(), v = new T.Vector3();
  if (relativeTo) { relativeTo.updateMatrixWorld(true); inv.copy(relativeTo.matrixWorld).invert(); }
  const buckets = new Map();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverseVisible(o => {
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
      const key = o.material.uuid + (o.castShadow ? 'C' : '-') + (o.receiveShadow ? 'R' : '-') + (o.renderOrder | 0);
      let b = buckets.get(key);
      if (!b) buckets.set(key, b = { material: o.material, cast: o.castShadow, receive: o.receiveShadow, order: o.renderOrder, list: [], count: 0, color: true });
      const g = o.geometry, n = g.index ? g.index.count : g.attributes.position.count;
      b.list.push({ g, matrix: m.multiplyMatrices(inv, o.matrixWorld).clone() });
      b.count += n; if (!g.attributes.color) b.color = false;
    });
  }
  const out = [];
  for (const b of buckets.values()) {
    const pos = new Float32Array(b.count * 3), nor = new Float32Array(b.count * 3), uv = new Float32Array(b.count * 2);
    const col = b.color ? new Float32Array(b.count * 3) : null;
    let o = 0;
    for (const { g, matrix } of b.list) {
      nm.getNormalMatrix(matrix);
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, C = g.attributes.color, I = g.index;
      const n = I ? I.count : P.count, flip = matrix.determinant() < 0;
      for (let k = 0; k < n; k++) {
        // keep triangle winding when the transform mirrors
        const kk = flip ? k - (k % 3) + [0, 2, 1][k % 3] : k, i = I ? I.getX(kk) : kk, w = o + k;
        v.fromBufferAttribute(P, i).applyMatrix4(matrix); pos[w * 3] = v.x; pos[w * 3 + 1] = v.y; pos[w * 3 + 2] = v.z;
        if (N) { v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor[w * 3] = v.x; nor[w * 3 + 1] = v.y; nor[w * 3 + 2] = v.z; }
        if (U) { uv[w * 2] = U.getX(i); uv[w * 2 + 1] = U.getY(i); }
        if (col) { col[w * 3] = C.getX(i); col[w * 3 + 1] = C.getY(i); col[w * 3 + 2] = C.getZ(i); }
      }
      o += n;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    if (col) geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    const mesh = new T.Mesh(geo, b.material);
    mesh.name = name; mesh.castShadow = b.cast; mesh.receiveShadow = b.receive; mesh.renderOrder = b.order;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    out.push(mesh);
  }
  return out;
}
