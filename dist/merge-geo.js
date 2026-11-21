// Tiny geometry merge helpers (examples/jsm BufferGeometryUtils is not vendored). ES module.
// Usage:
//   import { mergeGeometries, mergeChildMeshes } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';

// Concatenate geometries into one indexed BufferGeometry. Every input must carry the same attribute
// names (itemSize taken from the first); non-indexed inputs get a sequential index.
export function mergeGeometries(T, list) {
  const names = Object.keys(list[0].attributes);
  for (const g of list) {
    for (const n of names) if (!g.attributes[n]) throw new Error('mergeGeometries: missing attribute ' + n);
  }
  let vCount = 0, iCount = 0;
  for (const g of list) { vCount += g.attributes.position.count; iCount += g.index ? g.index.count : g.attributes.position.count; }
  const attrs = {};
  for (const n of names) attrs[n] = new Float32Array(vCount * list[0].attributes[n].itemSize);
  const index = new (vCount > 65535 ? Uint32Array : Uint16Array)(iCount);
  let vOff = 0, iOff = 0;
  for (const g of list) {
    const count = g.attributes.position.count;
    for (const n of names) {
      const a = g.attributes[n], size = a.itemSize, dst = attrs[n];
      if (!a.isInterleavedBufferAttribute && a.array.length === count * size) dst.set(a.array, vOff * size);
      else for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) dst[(vOff + i) * size + k] = a.getComponent ? a.getComponent(i, k) : a.array[i * size + k];
    }
    if (g.index) { const src = g.index.array; for (let i = 0; i < src.length; i++) index[iOff + i] = src[i] + vOff; iOff += src.length; }
    else { for (let i = 0; i < count; i++) index[iOff + i] = vOff + i; iOff += count; }
    vOff += count;
  }
  const out = new T.BufferGeometry();
  for (const n of names) out.setAttribute(n, new T.BufferAttribute(attrs[n], list[0].attributes[n].itemSize));
  out.setIndex(new T.BufferAttribute(index, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// Merge the static, childless mesh children of `parent` into one mesh per output material, baking
// each child's local transform into a cloned geometry. Groups, nodes with children, instanced meshes
// and anything rejected by `opts.skip(mesh)` stay as they are.
// opts.material(mesh) -> optional replacement material; meshes mapped to the same returned material
// merge together. When given and `opts.colorize` is true, each source mesh's material color is baked
// into a vertex `color` attribute (use with a vertexColors material whose color is white).
// Returns the new meshes (added to `parent`); source geometries are left for the caller to dispose.
export function mergeChildMeshes(T, parent, opts = {}) {
  const groups = new Map();
  for (const c of [...parent.children]) {
    if (!c.isMesh || c.isInstancedMesh || c.isSkinnedMesh || c.children.length || Array.isArray(c.material)) continue;
    if (opts.skip && opts.skip(c)) continue;
    const m = (opts.material && opts.material(c)) || c.material;
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(c);
  }
  const made = [];
  for (const [material, meshes] of groups) {
    if (meshes.length < 2 && material === meshes[0].material) continue;
    const parts = meshes.map((mesh) => {
      mesh.updateMatrix();
      const g = mesh.geometry.clone().applyMatrix4(mesh.matrix);
      if (opts.colorize && !g.attributes.color) {
        const c = mesh.material.color, n = g.attributes.position.count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
        g.setAttribute('color', new T.BufferAttribute(col, 3));
      }
      return g;
    });
    const geo = mergeGeometries(T, parts);
    parts.forEach((g) => g.dispose());
    const first = meshes[0];
    const merged = new T.Mesh(geo, material);
    merged.castShadow = first.castShadow; merged.receiveShadow = first.receiveShadow;
    merged.frustumCulled = first.frustumCulled; merged.renderOrder = first.renderOrder;
    for (const m of meshes) parent.remove(m);
    parent.add(merged);
    made.push(merged);
  }
  return made;
}
