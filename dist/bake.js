// Bake many small meshes into one draw call. ES module.
//   const pal = createPalette({ size: 16, emissiveScale: 1 });   // one material shared by several bakes
//   const geo = bakeGeometry(meshes, space, pal);                // -> BufferGeometry (position/normal/uv/color)
//   new THREE.Mesh(geo, pal.material); ... pal.dispose();
//   bakeMeshes(meshes, space) -> Mesh with its own right-sized palette (mesh.userData.dispose frees it)
// space: Object3D whose local space the baked geometry lives in (default: world space).
// Each part keeps its own look: material colour (x its vertex colours) goes into vertex colours, and
// roughness, metalness and emissive go into a tiny N x 1 look-up texture addressed by a constant per-part
// uv. flatShading parts get flat normals. Source geometries are cloned, never modified.
import * as T from './vendor/three.module.js';
import { mergeGeometries } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';

const KEEP = ['position', 'normal', 'uv', 'color'];
const _m = new T.Matrix4(), _inv = new T.Matrix4(), _e = new T.Color(), WHITE = new T.Color(1, 1, 1);

const emissiveOf = (m) => _e.copy(m.emissive || _e.setRGB(0, 0, 0)).multiplyScalar(m.emissiveIntensity ?? 1);
const keyOf = (m) => { const e = emissiveOf(m); return [m.roughness ?? 1, m.metalness ?? 0, e.r, e.g, e.b].map((v) => v.toFixed(4)).join(); };

export function createPalette({ size = 16, emissiveScale = 1 } = {}) {
  const pbr = new Uint8Array(size * 4), emi = new Uint8Array(size * 4);
  const tex = (d) => {
    const t = new T.DataTexture(d, size, 1, T.RGBAFormat);
    t.magFilter = t.minFilter = T.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  };
  const pbrTex = tex(pbr), emiTex = tex(emi), slots = new Map();
  const material = new T.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 1, metalness: 1, roughnessMap: pbrTex, metalnessMap: pbrTex,
    emissive: new T.Color(emissiveScale, emissiveScale, emissiveScale), emissiveMap: emiTex,
  });
  return {
    material, size,
    slot(m) {
      const key = keyOf(m);
      if (slots.has(key)) return slots.get(key);
      const i = slots.size;
      if (i >= size) throw new Error('bake palette full');
      const e = emissiveOf(m), q = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
      pbr[i * 4 + 1] = q(m.roughness ?? 1); pbr[i * 4 + 2] = q(m.metalness ?? 0); pbr[i * 4 + 3] = 255;
      emi[i * 4] = q(e.r / emissiveScale); emi[i * 4 + 1] = q(e.g / emissiveScale); emi[i * 4 + 2] = q(e.b / emissiveScale); emi[i * 4 + 3] = 255;
      pbrTex.needsUpdate = emiTex.needsUpdate = true;
      slots.set(key, i); return i;
    },
    dispose() { material.dispose(); pbrTex.dispose(); emiTex.dispose(); },
  };
}

// Meshes (visible or not) -> one merged geometry in `space`, addressed into `pal`.
// Instanced meshes contribute one copy per instance.
export function bakeGeometry(meshes, space, pal) {
  if (space) { space.updateWorldMatrix(true, true); _inv.copy(space.matrixWorld).invert(); } else _inv.identity();
  const geos = [];
  const one = (src, geometry, world) => {
    const slot = pal.slot(src);
    let g = geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    if (src.flatShading) { const f = g.index ? g.toNonIndexed() : g; if (f !== g) g.dispose(); g = f; g.deleteAttribute('normal'); }
    if (!g.attributes.normal) g.computeVertexNormals();
    const c = g.attributes.position.count, vc = src.vertexColors ? g.attributes.color : null, base = src.color || WHITE;
    const col = new Float32Array(c * 3), uv = new Float32Array(c * 2), u = (slot + 0.5) / pal.size;
    for (let i = 0; i < c; i++) {
      col[i * 3] = base.r * (vc ? vc.getX(i) : 1); col[i * 3 + 1] = base.g * (vc ? vc.getY(i) : 1); col[i * 3 + 2] = base.b * (vc ? vc.getZ(i) : 1);
      uv[i * 2] = u; uv[i * 2 + 1] = 0.5;
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    _m.multiplyMatrices(_inv, world);
    g.applyMatrix4(_m);
    if (_m.determinant() < 0) {                                   // mirrored part: keep front faces in front
      if (!g.index) { const a = new Uint32Array(c); for (let i = 0; i < c; i++) a[i] = i; g.setIndex(new T.BufferAttribute(a, 1)); }
      const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    }
    geos.push(g);
  };
  const inst = new T.Matrix4();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    if (mesh.isInstancedMesh) {
      for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, inst); one(mesh.material, mesh.geometry, inst.premultiply(mesh.matrixWorld)); }
    } else one(mesh.material, mesh.geometry, mesh.matrixWorld);
  }
  const out = mergeGeometries(T, geos);
  for (const g of geos) g.dispose();
  return out;
}

// Convenience: one mesh with its own palette sized to fit.
export function bakeMeshes(meshes, space = null, name = 'baked') {
  const keys = new Set(meshes.map((m) => keyOf(m.material)));
  let eMax = 0;
  for (const m of meshes) { const e = emissiveOf(m.material); eMax = Math.max(eMax, e.r, e.g, e.b); }
  const pal = createPalette({ size: Math.max(1, keys.size), emissiveScale: eMax || 1 });
  const mesh = new T.Mesh(bakeGeometry(meshes, space, pal), pal.material);
  mesh.name = name;
  mesh.userData.baked = true;
  mesh.userData.dispose = () => { mesh.geometry.dispose(); pal.dispose(); };
  return mesh;
}

// Bake every mesh under `root` into one mesh per render state (side, transparency, depth), added to
// `root`; the source meshes are detached. Meshes with textures, material arrays or non-standard
// materials are left alone. Source geometry and materials are not disposed (they may be shared).
// Returns the baked meshes (each mesh.userData.dispose() frees it).
export function bakeInPlace(root) {
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const m = o.material;
    if (Array.isArray(m) || !m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.map || m.normalMap || m.bumpMap || m.alphaMap ||
      m.roughnessMap || m.metalnessMap || m.emissiveMap || m.aoMap || m.lightMap || m.alphaTest || m.wireframe || o.morphTargetInfluences) return;
    const key = [m.side, m.transparent, m.opacity, m.depthWrite, m.depthTest, m.fog, m.blending].join();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  const out = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const src = list[0].material, mesh = bakeMeshes(list, root, 'baked_' + (root.name || 'part'));
    for (const k of ['side', 'transparent', 'opacity', 'depthWrite', 'depthTest', 'fog', 'blending']) mesh.material[k] = src[k];
    mesh.castShadow = list.some((o) => o.castShadow); mesh.receiveShadow = list.some((o) => o.receiveShadow);
    mesh.renderOrder = list[0].renderOrder; mesh.frustumCulled = list[0].frustumCulled;
    for (const o of list) o.removeFromParent();
    root.add(mesh);
    out.push(mesh);
  }
  return out;
}

// Visible meshes under `root` (all ancestors up to root visible).
export function visibleMeshes(root) {
  const out = [];
  const walk = (o) => { if (!o.visible) return; if (o.isMesh) out.push(o); for (const c of o.children) walk(c); };
  walk(root);
  return out;
}
