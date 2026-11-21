// Ocean foam collars: only the nearest few floating items reach the shader, so its per-pixel loop stays short.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { createOcean } = await import(new URL('ocean.js?build=v3-survival-ae77fa84ac2b', base));

test('foam points are the nearest 8 visible items within 15 m, nearest first', () => {
  const ocean = createOcean(T, { segments: 4 });
  const group = new T.Group();
  const dists = [20, 3, 14, 7, 1, 9, 30, 5, 11, 2, 13, 6, 8, 4];
  for (const d of dists) { const o = new T.Object3D(); o.position.set(d, 0, 0); group.add(o); }
  group.children[1].visible = false; // the 3 m item is hidden
  ocean.trackFoam(group);
  const camera = new T.PerspectiveCamera();
  const pts = ocean.uniforms.uFoamPts.value;
  const read = () => pts.filter(v => v.z > 0).map(v => v.x);
  ocean.update(0, camera);
  assert.equal(pts.length, 8);
  assert.deepEqual(read(), [1, 2, 4, 5, 6, 7, 8, 9]);
  for (const v of pts) assert.equal(v.w, 1);
  camera.position.set(10, 0, 0); // move: nearest set changes, far ones fade
  ocean.update(0, camera);
  assert.deepEqual(read().map(x => Math.abs(x - 10)), [1, 1, 2, 3, 3, 4, 4, 5]);
  group.clear(); ocean.update(0, camera);
  assert.deepEqual(read(), []);
  const near = new T.Object3D(); near.position.set(10 + 13.5, 0, 0); group.add(near); ocean.update(0, camera);
  assert.ok(Math.abs(pts[0].w - 0.5) < 1e-9, 'fades between 12 and 15 m');
  ocean.dispose();
});

test('ocean grid is dense on the old 2.8 m lattice near the centre and coarser out to the edge', async () => {
  const { oceanGridLines } = await import(new URL('ocean.js?build=v3-survival-ae77fa84ac2b', base));
  const lines = oceanGridLines(140, 2.8, 9, 1.15);
  assert.equal(lines[0], -140); assert.equal(lines.at(-1), 140);
  for (let i = 1; i < lines.length; i++) assert.ok(lines[i] > lines[i - 1]);
  for (const x of lines) assert.ok(lines.includes(-x), 'symmetric');
  const core = lines.filter(x => Math.abs(x) <= 25.2 + 1e-9);
  assert.equal(core.length, 19);
  for (const x of core) assert.ok(Math.abs(x / 2.8 - Math.round(x / 2.8)) < 1e-9, 'core lines sit on the 2.8 m lattice');
  assert.equal(oceanGridLines(140, 70, 9, 1.15).join(), '-140,-70,0,70,140', 'coarse grids clamp the core');
  const ocean = createOcean(T);
  assert.ok(ocean.mesh.geometry.index.count / 3 < 5000, 'far fewer triangles than the old 100x100 plane');
  ocean.dispose();
});

test('ocean grid follows a camera that swims far from the raft, snapped to the lattice', () => {
  const ocean = createOcean(T), camera = new T.PerspectiveCamera();
  camera.position.set(6, 2, -5); ocean.update(0, camera);
  assert.deepEqual([ocean.mesh.position.x, ocean.mesh.position.z], [0, 0], 'stays put near the raft');
  camera.position.set(40, 2, -30); ocean.update(0, camera);
  assert.ok(Math.abs(ocean.mesh.position.x - 39.2) < 1e-9 && Math.abs(ocean.mesh.position.z + 30.8) < 1e-9);
  assert.equal(ocean.mesh.position.y, -0.24);
  ocean.dispose();
});
