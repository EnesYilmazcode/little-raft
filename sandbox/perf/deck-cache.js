// Incremental raft deck for dist/game.js rebuildRaft(). ES module, no imports (takes T like every dist module).
//
// createRaftMesh (deck.js) regenerates every tile's procedural planks, logs and lashings on every call, and game.js
// calls it from rebuildRaft() on every floor, decoration, world sync and save load. This keeps each tile's
// generated, translated geometry (CPU only, never uploaded) and only generates tiles that are new:
//  - tiles unchanged (a decoration placed, a guest's world update): build() returns the SAME group, no work at all;
//  - tiles added or removed: new tiles are generated, then all tiles are concatenated per material (typed-array copies).
// The merged deck is vertex-for-vertex what createRaftMesh(T, tiles, mat) returns for the same list (same bucket
// order, same tile order inside each bucket), so it renders identically.
//
//   const deck = createDeckCache(T, createRaftMesh, mat);
//   const g = deck.build(tiles);      // tiles: [{index, x, z}] as for createRaftMesh
//   if (g !== deck.previous) { ...old group out, g in... }
//   deck.dispose();                   // frees the cached tile geometry
export function createDeckCache(T, createRaftMesh, getMaterial) {
  const tiles = new Map(); // key -> [{bucket, name, castShadow, material, geometry}] in createRaftMesh part order
  let last = null, lastSig = '', previous = null;
  const keyOf = t => t.index + '|' + t.x + '|' + t.z;

  function tileParts(t) {
    const k = keyOf(t);
    let parts = tiles.get(k);
    if (!parts) {
      const g = createRaftMesh(T, [t], getMaterial); // one tile: one mesh per bucket, geometry already translated
      parts = g.children.filter(m => m.isMesh).map(m => ({ bucket: m.material.uuid + '|' + m.castShadow, name: m.name, castShadow: m.castShadow, receiveShadow: m.receiveShadow, material: m.material, geometry: m.geometry }));
      tiles.set(k, parts);
    }
    return parts;
  }

  function concat(list) {
    const names = Object.keys(list[0].attributes), out = new T.BufferGeometry();
    for (const n of names) {
      const size = list[0].attributes[n].itemSize; let len = 0;
      for (const g of list) len += g.attributes[n].array.length;
      const arr = new Float32Array(len); let o = 0;
      for (const g of list) { arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; }
      out.setAttribute(n, new T.BufferAttribute(arr, size));
    }
    out.computeBoundingBox(); out.computeBoundingSphere();
    return out;
  }

  function build(list) {
    previous = last;
    const sig = list.map(keyOf).join(',');
    if (last && sig === lastSig) return last;
    const want = new Set(list.map(keyOf));
    for (const [k, parts] of tiles) if (!want.has(k)) { for (const p of parts) p.geometry.dispose(); tiles.delete(k); }
    const buckets = new Map();
    for (const t of list) for (const p of tileParts(t)) {
      if (!buckets.has(p.bucket)) buckets.set(p.bucket, { ...p, list: [] });
      buckets.get(p.bucket).list.push(p.geometry);
    }
    const g = new T.Group(); g.name = 'raft-floors';
    for (const b of buckets.values()) {
      const mesh = new T.Mesh(concat(b.list), b.material); mesh.name = b.name;
      mesh.castShadow = b.castShadow; mesh.receiveShadow = b.receiveShadow; g.add(mesh);
    }
    g.userData.kind = 'floors';
    g.userData.topY = 0.2;
    g.userData.tiles = list.map(t => ({ ...t }));
    g.userData.dispose = () => g.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    last = g; lastSig = sig;
    return g;
  }

  function dispose() {
    for (const parts of tiles.values()) for (const p of parts) p.geometry.dispose();
    tiles.clear(); last = null; lastSig = ''; previous = null;
  }

  return { build, dispose, get last() { return last; }, get previous() { return previous; }, get size() { return tiles.size; } };
}
