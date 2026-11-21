// node --test sandbox/perf/deck-cache.test.mjs
// The incremental deck must be vertex-for-vertex what deck.js createRaftMesh builds from scratch, whatever order
// tiles arrive and leave in, and must not regenerate tiles it already has.
import test from 'node:test';
import assert from 'node:assert/strict';
const T = await import(new URL('../../dist/vendor/three.module.js', import.meta.url));
const { createRaftMesh } = await import(new URL('../../dist/deck.js', import.meta.url));
const { createDeckCache } = await import(new URL('./deck-cache.js', import.meta.url));

const cache = new Map(), mat = c => cache.get(c) ?? cache.set(c, new T.MeshStandardMaterial({ color: c })).get(c);
const spec = ts => ts.map(([x, z]) => ({ index: x * 719 + z * 311, x: x * 2, z: z * 2 }));
const dump = g => g.children.map(m => ({ name: m.name, mat: m.material.uuid, cast: m.castShadow, recv: m.receiveShadow,
  attrs: Object.fromEntries(Object.entries(m.geometry.attributes).map(([k, a]) => [k, Array.from(a.array)])) }));
const same = (a, b) => assert.deepEqual(dump(a), dump(b));

test('matches createRaftMesh after adds, removals and reorders', () => {
  const dc = createDeckCache(T, createRaftMesh, mat);
  const steps = [[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [1, 0], [0, -1], [-1, 0]], [[1, 0], [0, -1], [-1, 0]], [[-1, 0], [1, 0], [0, -1], [2, 2]]];
  for (const ts of steps) same(dc.build(spec(ts)), createRaftMesh(T, spec(ts), mat));
  assert.equal(dc.size, 4, 'tiles that left the raft are evicted');
});

test('same tile list returns the same group; a new tile generates only that tile', () => {
  let calls = 0; const counting = (T2, tiles, m) => { calls += tiles.length; return createRaftMesh(T2, tiles, m); };
  const dc = createDeckCache(T, counting, mat);
  const a = dc.build(spec([[0, 0], [1, 0]])); assert.equal(calls, 2);
  assert.equal(dc.build(spec([[0, 0], [1, 0]])), a); assert.equal(calls, 2);
  const b = dc.build(spec([[0, 0], [1, 0], [1, 1]])); assert.notEqual(b, a); assert.equal(calls, 3);
  assert.equal(dc.previous, a);
  assert.equal(b.name, 'raft-floors'); assert.equal(b.userData.kind, 'floors'); assert.equal(b.userData.tiles.length, 3);
});

test('dispose frees the cached tiles; the merged deck stays valid until its owner disposes it', () => {
  const dc = createDeckCache(T, createRaftMesh, mat);
  const g = dc.build(spec([[0, 0]])); dc.dispose();
  assert.equal(dc.size, 0); assert.equal(dc.last, null);
  assert.ok(g.children[0].geometry.attributes.position.count > 0);
});

test('painted tiles (tint) match createRaftMesh; repainting one tile regenerates only that tile', () => {
  const paint = new Map([['0,0', '#3366aa']]), wood = new Map();
  const tint = (t, base) => { const c = paint.get(t.x / 2 + ',' + t.z / 2); return c ? '#' + base.slice(1, 4) + c.slice(4) : null; };
  const tintMat = hex => wood.get(hex) ?? wood.set(hex, new T.MeshStandardMaterial({ color: hex })).get(hex);
  let calls = 0; const counting = (T2, tiles, ...r) => { calls += tiles.length; return createRaftMesh(T2, tiles, ...r); };
  const dc = createDeckCache(T, counting, mat), ts = spec([[0, 0], [1, 0], [0, 1]]);
  same(dc.build(ts, tint, tintMat), createRaftMesh(T, ts, mat, tint, tintMat)); assert.equal(calls, 3 + 0);
  paint.set('1,0', '#aa3322'); calls = 0;
  same(dc.build(ts, tint, tintMat), createRaftMesh(T, ts, mat, tint, tintMat)); assert.equal(calls, 1);
  paint.clear(); calls = 0;
  same(dc.build(ts, tint, tintMat), createRaftMesh(T, ts, mat, tint, tintMat)); assert.equal(calls, 2);
});
