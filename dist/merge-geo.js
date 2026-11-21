// Tiny geometry merge helpers (examples/jsm BufferGeometryUtils is not vendored). ES module.
// Usage:
//   import { mergeGeometries, mergeChildMeshes, mergeChildMeshesPBR } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';

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

// MeshStandardMaterial whose colour, roughness, metalness (and emissive, when `emissive`) come from vertex
// attributes `color`, `pbr` (vec2 roughness, metalness) and `emissive`. All instances share one program.
export function pbrVertexMaterial(T, emissive = false) {
  const m = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 pbr;\nvarying vec2 vPbr;' + (emissive ? '\nattribute vec3 emissive;\nvarying vec3 vEmissive;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = pbr;' + (emissive ? '\nvEmissive = emissive;' : ''));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPbr;' + (emissive ? '\nvarying vec3 vEmissive;' : ''))
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;')
      .replace('#include <emissivemap_fragment>', emissive ? 'totalEmissiveRadiance = vEmissive;' : '#include <emissivemap_fragment>');
  };
  m.customProgramCacheKey = () => 'lr-pbr-vertex' + (emissive ? '-e' : '');
  return m;
}

// Merge the static, childless mesh children of `parent` that use plain opaque MeshStandardMaterials (no texture
// maps, no shader patches) into ONE mesh: each part's colour (times its own vertex colours), roughness, metalness
// and emissive are baked into vertex attributes read by pbrVertexMaterial, so parts with different materials keep
// their exact look in a single draw. opts.skip(mesh) keeps a part out. Returns the new mesh, or null (< 2 parts).
export function mergeChildMeshesPBR(T, parent, opts = {}) {
  const plain = (m) => m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial && !m.transparent && m.opacity >= 1 && m.side === T.FrontSide &&
    m.onBeforeCompile === T.Material.prototype.onBeforeCompile && !Object.keys(m).some((k) => /Map$/.test(k) && m[k]);
  const list = parent.children.filter((c) => c.isMesh && !c.isInstancedMesh && !c.isSkinnedMesh && !c.children.length && !Array.isArray(c.material) &&
    plain(c.material) && !(opts.skip && opts.skip(c)));
  if (list.length < 2) return null;
  const emissive = list.some((c) => c.material.emissive.getHex() !== 0 && c.material.emissiveIntensity > 0);
  const parts = list.map((mesh) => {
    mesh.updateMatrix();
    const src = mesh.geometry.clone().applyMatrix4(mesh.matrix), g = new T.BufferGeometry();
    const m = mesh.material, n = src.attributes.position.count, vc = m.vertexColors ? src.attributes.color : null;
    g.setAttribute('position', src.attributes.position); g.setAttribute('normal', src.attributes.normal);
    if (src.index) g.setIndex(src.index);
    const col = new Float32Array(n * 3), pbr = new Float32Array(n * 2), em = emissive ? new Float32Array(n * 3) : null;
    const e = m.emissive.clone().multiplyScalar(m.emissiveIntensity);
    for (let i = 0; i < n; i++) {
      col[i * 3] = m.color.r * (vc ? vc.getX(i) : 1); col[i * 3 + 1] = m.color.g * (vc ? vc.getY(i) : 1); col[i * 3 + 2] = m.color.b * (vc ? vc.getZ(i) : 1);
      pbr[i * 2] = m.roughness; pbr[i * 2 + 1] = m.metalness;
      if (em) { em[i * 3] = e.r; em[i * 3 + 1] = e.g; em[i * 3 + 2] = e.b; }
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3)); g.setAttribute('pbr', new T.BufferAttribute(pbr, 2));
    if (em) g.setAttribute('emissive', new T.BufferAttribute(em, 3));
    return g;
  });
  const merged = new T.Mesh(mergeGeometries(T, parts), pbrVertexMaterial(T, emissive));
  for (const g of parts) g.dispose();
  const first = list[0];
  merged.castShadow = list.some((c) => c.castShadow); merged.receiveShadow = first.receiveShadow;
  merged.frustumCulled = first.frustumCulled; merged.renderOrder = first.renderOrder;
  for (const c of list) parent.remove(c);
  parent.add(merged);
  return merged;
}
