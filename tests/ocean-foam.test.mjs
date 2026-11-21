// Foam collars: only items whose collar can be on screen reach the shader, packed first in item order.
// Run: node --test tests/ocean-foam.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { createOcean } = await import(new URL('ocean.js', base));

function setup() {
  const ocean = createOcean(T);
  const items = new T.Group();
  ocean.trackFoam(items);
  const camera = new T.PerspectiveCamera(70, 16 / 9, 0.05, 200);
  camera.position.set(0, 1.7, 0); // looks down -z
  camera.updateMatrixWorld();
  const add = (x, z, extra = {}) => { const o = new T.Object3D(); o.position.set(x, 0, z); Object.assign(o.userData, extra); items.add(o); return o; };
  const live = () => ocean.uniforms.uFoamPts.value.filter((p) => p.z > 0).map((p) => [p.x, p.y]);
  const draw = () => { ocean.update(1, camera); ocean.mesh.onBeforeRender(null, null, camera); };
  return { ocean, camera, add, live, draw };
}

test('offscreen collars are dropped and the rest stay packed in order', () => {
  const { add, live, draw, ocean } = setup();
  add(0, -10); add(0, 10); add(3, -20); add(-40, 0); add(0, -60); add(-2, -5).visible = false; add(1, -4);
  draw();
  assert.deepEqual(live(), [[0, -10], [3, -20], [1, -4]]);
  const pts = ocean.uniforms.uFoamPts.value;
  assert.equal(pts.findIndex((p) => p.z <= 0), 3, 'first empty slot ends the shader loop');
});

test('a collar just behind the near plane but reaching into view is kept', () => {
  const { add, live, draw, camera } = setup();
  camera.rotation.x = -1.2; camera.updateMatrixWorld(); // looking steeply down at the water by the raft
  add(0, 0.5, { foamRadius: 1.2 }); // item centre behind the camera, ring reaches in front
  add(0, 3, { foamRadius: 0.7 }); // fully behind
  draw();
  assert.deepEqual(live(), [[0, 0.5]]);
});

test('turning the camera re-packs on the next draw', () => {
  const { add, live, draw, camera } = setup();
  add(0, -10); add(0, 10);
  draw(); assert.deepEqual(live(), [[0, -10]]);
  camera.rotation.y = Math.PI; camera.updateMatrixWorld();
  draw(); assert.deepEqual(live(), [[0, 10]]);
});
