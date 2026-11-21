// Static batching for Little Raft: bake many meshes into one mesh per (material, shadow flags, renderOrder).
// Drop-in for dist/ (no imports; pass the three namespace like the other dist modules):
//   import { mergeMeshesByMaterial, createStaticBatch } from './merge.js?build=...';
//   scene.add(...mergeMeshesByMaterial(T, [groupA, groupB], {name:'scenery'}));   // one-shot
//   const deck = createStaticBatch(T, 'raft-deck'); raft.add(deck.group);         // growable
//   deck.add([tileGroup], ['x,z']);  deck.keys.has('x,z');  deck.clear();
// - Each mesh's transform is baked relative to `relativeTo` (default: the roots' own world space, i.e. roots that
//   are not in the scene are baked in their local space), so results go under `relativeTo` with identity transform.
// - Output is non-indexed position/normal/uv (+color when every source in the bucket has it); uv is zero-filled
//   where a source has none. mergeMeshesByMaterial leaves sources alone; createStaticBatch.add disposes them.
// - Only visible meshes are merged; skinned/instanced/multi-material meshes are skipped (they stay unmerged).

function bake(T, roots, relativeTo) {
  const inv = new T.Matrix4(), mw = new T.Matrix4(), nm = new T.Matrix3();
  if (relativeTo) { relativeTo.updateMatrixWorld(true); inv.copy(relativeTo.matrixWorld).invert(); }
  const buckets = new Map();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverseVisible(o => {
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
      const key = o.material.uuid + (o.castShadow ? 'C' : '-') + (o.receiveShadow ? 'R' : '-') + (o.renderOrder | 0);
      let b = buckets.get(key);
      if (!b) buckets.set(key, b = { key, material: o.material, cast: o.castShadow, receive: o.receiveShadow, order: o.renderOrder | 0, list: [], count: 0, color: true });
      const g = o.geometry;
      b.list.push({ g, matrix: mw.multiplyMatrices(inv, o.matrixWorld).clone() });
      b.count += g.index ? g.index.count : g.attributes.position.count;
      if (!g.attributes.color) b.color = false;
    });
  }
  const out = [];
  for (const b of buckets.values()) {
    const pos = new Float32Array(b.count * 3), nor = new Float32Array(b.count * 3), uv = new Float32Array(b.count * 2);
    const col = b.color ? new Float32Array(b.count * 3) : null;
    let o = 0;
    for (const { g, matrix } of b.list) {
      nm.getNormalMatrix(matrix);
      const e = matrix.elements, q = nm.elements, flip = matrix.determinant() < 0;
      const A = g.attributes, I = g.index ? g.index.array : null, n = I ? I.length : A.position.count;
      // Plain (non-interleaved) Float32 attributes are read straight from their arrays; anything else via getX.
      const arr = (a, size) => (a && !a.isInterleavedBufferAttribute && !a.normalized && a.itemSize === size && a.array instanceof Float32Array ? a.array : null);
      const P = arr(A.position, 3), N = arr(A.normal, 3), U = arr(A.uv, 2), C = col ? arr(A.color, 3) : null;
      for (let k = 0; k < n; k++) {
        const kk = flip ? k - (k % 3) + (k % 3 === 0 ? 0 : 3 - (k % 3)) : k; // mirrored transform: keep winding
        const i = I ? I[kk] : kk, w = o + k;
        let x, y, z;
        if (P) { x = P[i * 3]; y = P[i * 3 + 1]; z = P[i * 3 + 2]; } else { x = A.position.getX(i); y = A.position.getY(i); z = A.position.getZ(i); }
        pos[w * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        pos[w * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        pos[w * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        if (A.normal) {
          if (N) { x = N[i * 3]; y = N[i * 3 + 1]; z = N[i * 3 + 2]; } else { x = A.normal.getX(i); y = A.normal.getY(i); z = A.normal.getZ(i); }
          const nx = q[0] * x + q[3] * y + q[6] * z, ny = q[1] * x + q[4] * y + q[7] * z, nz = q[2] * x + q[5] * y + q[8] * z;
          const l = Math.hypot(nx, ny, nz) || 1;
          nor[w * 3] = nx / l; nor[w * 3 + 1] = ny / l; nor[w * 3 + 2] = nz / l;
        }
        if (A.uv) { if (U) { uv[w * 2] = U[i * 2]; uv[w * 2 + 1] = U[i * 2 + 1]; } else { uv[w * 2] = A.uv.getX(i); uv[w * 2 + 1] = A.uv.getY(i); } }
        if (col) { if (C) { col[w * 3] = C[i * 3]; col[w * 3 + 1] = C[i * 3 + 1]; col[w * 3 + 2] = C[i * 3 + 2]; } else { col[w * 3] = A.color.getX(i); col[w * 3 + 1] = A.color.getY(i); col[w * 3 + 2] = A.color.getZ(i); } }
      }
      o += n;
    }
    out.push({ key: b.key, material: b.material, cast: b.cast, receive: b.receive, order: b.order, pos, nor, uv, col });
  }
  return out;
}

function toMesh(T, b, name) {
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(b.pos, 3));
  geo.setAttribute('normal', new T.BufferAttribute(b.nor, 3));
  geo.setAttribute('uv', new T.BufferAttribute(b.uv, 2));
  if (b.col) geo.setAttribute('color', new T.BufferAttribute(b.col, 3));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  const mesh = new T.Mesh(geo, b.material);
  mesh.name = name; mesh.castShadow = b.cast; mesh.receiveShadow = b.receive; mesh.renderOrder = b.order;
  mesh.userData.batchKey = b.key;
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  return mesh;
}

export function mergeMeshesByMaterial(T, roots, { name = 'merged', relativeTo = null } = {}) {
  return bake(T, roots, relativeTo).map(b => toMesh(T, b, name));
}

// A growable static batch: add() appends new pieces to the existing per-material meshes (typed-array concat), so
// adding one raft tile costs one tile of work instead of rebuilding every tile.
export function createStaticBatch(T, name = 'batch') {
  const group = new T.Group(); group.name = name;
  const keys = new Set();
  const cat = (a, b) => { if (!a) return b; const r = new Float32Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; };
  function add(roots, rootKeys = []) {
    if (!roots.length) return;
    for (const b of bake(T, roots, null)) {
      const old = group.children.find(m => m.userData.batchKey === b.key);
      if (old) {
        const A = old.geometry.attributes;
        b.pos = cat(A.position.array, b.pos); b.nor = cat(A.normal.array, b.nor); b.uv = cat(A.uv.array, b.uv);
        b.col = b.col && A.color ? cat(A.color.array, b.col) : null;
        group.remove(old); old.geometry.dispose();
      }
      group.add(toMesh(T, b, name));
    }
    for (const r of roots) r.traverse(o => o.geometry?.dispose());
    for (const k of rootKeys) keys.add(k);
  }
  function clear() { for (const m of [...group.children]) { group.remove(m); m.geometry.dispose(); } keys.clear(); }
  return { group, keys, add, clear };
}
