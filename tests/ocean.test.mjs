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

test('inlined sample() is bit-identical to the getHeight-based version (with flow and mesh offset)', () => {
  const ocean = createOcean(T, { segments: 4 });
  // Reference: the previous sample() body, built on getHeight.
  const ref = (x, z, t, e = 0.6) => ({
    h: ocean.getHeight(x, z, t),
    sx: (ocean.getHeight(x + e, z, t) - ocean.getHeight(x - e, z, t)) / (2 * e),
    sz: (ocean.getHeight(x, z + e, t) - ocean.getHeight(x, z - e, t)) / (2 * e),
  });
  let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const out = { h: 0, sx: 0, sz: 0 };
  const flows = [[0, 0], [123.456, -78.9], [-0.3, 1e4 / 3]];
  for (const [fx, fy] of flows) {
    ocean.uniforms.uFlow.value.set(fx, fy);
    ocean.mesh.position.y = fx ? -0.15 : 0;
    for (let n = 0; n < 2000; n++) {
      const x = (rnd() - .5) * 2000, z = (rnd() - .5) * 2000, t = rnd() * 20000, e = n % 3 ? 0.6 : .1 + rnd() * 2;
      const r = ref(x, z, t, e);
      ocean.sample(x, z, out, t, e);
      assert.ok(Object.is(out.h, r.h) && Object.is(out.sx, r.sx) && Object.is(out.sz, r.sz), `mismatch at ${x},${z},${t},${e}`);
    }
    for (const [x, z] of [[0, 0], [-0, -0], [1e-300, -1e-300]]) {
      ocean.update(7.25);
      const r = ref(x, z, 7.25); const s = ocean.sample(x, z);
      assert.ok(Object.is(s.h, r.h) && Object.is(s.sx, r.sx) && Object.is(s.sz, r.sz));
    }
  }
  ocean.dispose();
});
