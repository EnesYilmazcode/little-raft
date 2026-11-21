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
