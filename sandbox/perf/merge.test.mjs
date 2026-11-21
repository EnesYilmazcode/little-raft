// node --test sandbox/perf/merge.test.mjs  (RAFT_DIST=<dir> to test a patched dist copy's merge.js)
import test from 'node:test';
import assert from 'node:assert/strict';
const T = await import(new URL('../../dist/vendor/three.module.js', import.meta.url));
const { createFloor } = await import(new URL('../../dist/deck.js', import.meta.url));
const { mergeMeshesByMaterial, createStaticBatch } = await import(new URL('./merge.js', import.meta.url));

const cache = new Map(), mat = c => cache.get(c) ?? cache.set(c, new T.MeshStandardMaterial({ color: c })).get(c);
const tile = (x, z) => { const g = createFloor(T, x * 719 + z * 311, mat); g.position.set(x * 2, 0, z * 2); return g; };
const vertsByMat = roots => { const m = new Map(); for (const r of roots) r.traverse(o => { if (o.isMesh) { const n = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count; m.set(o.material, (m.get(o.material) ?? 0) + n); } }); return m; };
const box = roots => { const b = new T.Box3(); for (const r of roots) { r.updateMatrixWorld(true); b.expandByObject(r); } return b; };

test('merge keeps every vertex, bounds and shadow flags', () => {
  const tiles = [tile(0, 0), tile(1, 0), tile(-1, 2)];
  const want = vertsByMat(tiles), bWant = box(tiles);
  const merged = mergeMeshesByMaterial(T, tiles, { name: 'deck' });
  assert.equal(merged.length, want.size);
  for (const m of merged) assert.equal(m.geometry.attributes.position.count, want.get(m.material));
  const bGot = box(merged);
  for (const k of ['x', 'y', 'z']) { assert.ok(Math.abs(bGot.min[k] - bWant.min[k]) < 1e-4); assert.ok(Math.abs(bGot.max[k] - bWant.max[k]) < 1e-4); }
  const nails = merged.find(m => m.material === mat('#4b4844'));
  assert.equal(nails.castShadow, false); // createFloor turns nail shadows off; the bucket must keep that
  for (const m of merged) { const n = m.geometry.attributes.normal.array; for (let i = 0; i < n.length; i += 3) assert.ok(Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1) < 1e-3); }
});

test('static batch grows incrementally and matches a full merge', () => {
  const batch = createStaticBatch(T, 'deck');
  batch.add([tile(0, 0), tile(1, 0)], ['0,0', '1,0']);
  batch.add([tile(-1, 2)], ['-1,2']);
  const ref = vertsByMat([tile(0, 0), tile(1, 0), tile(-1, 2)]);
  assert.equal(batch.group.children.length, ref.size);
  for (const m of batch.group.children) assert.equal(m.geometry.attributes.position.count, ref.get(m.material));
  assert.deepEqual([...batch.keys].sort(), ['-1,2', '0,0', '1,0']);
  batch.clear();
  assert.equal(batch.group.children.length, 0); assert.equal(batch.keys.size, 0);
});

test('mirrored transforms keep front faces', () => {
  const g = new T.Group(), m = new T.Mesh(new T.PlaneGeometry(1, 1), mat('#fff'));
  m.scale.x = -1; g.add(m);
  const [out] = mergeMeshesByMaterial(T, [g]);
  const p = out.geometry.attributes.position, a = new T.Vector3().fromBufferAttribute(p, 0), b = new T.Vector3().fromBufferAttribute(p, 1), c = new T.Vector3().fromBufferAttribute(p, 2);
  const nrm = b.sub(a).cross(c.sub(a)).normalize();
  assert.ok(nrm.z > 0.99, 'winding flipped back so the face still points +z');
});
