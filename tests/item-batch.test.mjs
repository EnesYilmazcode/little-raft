// Item batch: floating supplies drawn instanced, culled to the view camera and swapped to far-view geometry.
// Run: node --test tests/item-batch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../dist/vendor/three.module.js';
import { createDebris, createItemBatch } from '../dist/debris.js';
import { createPlastic } from '../dist/plastic.js';

const mat = (c) => new T.MeshStandardMaterial({ color: c });
const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

function scene(cam) {
  const sc = new T.Scene(), items = new T.Group();
  sc.add(cam, items);
  const batch = createItemBatch(T, { camera: () => cam });
  items.add(batch);
  return { sc, items, batch };
}
const drawn = (batch) => batch.children.filter((im) => im.visible).reduce((a, im) => a + im.count, 0);
const drawnGeo = (batch) => batch.children.filter((im) => im.visible).map((im) => im.geometry.id); // ids: assert never inspects geometry

test('far-view geometry is lighter, shares the material and stays out of clones', () => {
  for (const type of ['leaf', 'scrap', 'barrel']) {
    const mesh = createDebris(T, type, mat, { seed: 3, pool: 4 }).children[0];
    const lod = mesh.geometry.userData.lod;
    assert.ok(!!lod && lod.isBufferGeometry, type);
    assert.ok(tris(lod) < tris(mesh.geometry) * 0.6, `${type} ${tris(lod)} vs ${tris(mesh.geometry)}`);
    assert.equal(JSON.stringify(mesh.geometry.userData), '{"shared":true}'); // non-enumerable: toJSON skips it
  }
  const jug = createPlastic(T).getObjectByName('jugBody').geometry;
  assert.ok(tris(jug.userData.lod) <= 450 && tris(jug) > 1500);
  // each pooled variant has its own far twin, shared by every item of that variant
  const lod = (s) => createDebris(T, 'barrel', mat, { seed: s, pool: 4 }).children[0].geometry.userData.lod;
  assert.equal(new Set([0, 1, 2, 3].map(lod)).size, 4);
  assert.ok(lod(1) === lod(5));
});

test('items off screen are skipped and far ones draw the far geometry', () => {
  const cam = new T.PerspectiveCamera(70, 16 / 9, 0.05, 200);
  const { sc, items, batch } = scene(cam);
  const add = (x, z) => { const g = createDebris(T, 'barrel', mat, { seed: 1, pool: 4 }); g.position.set(x, 0, z); items.add(g); return g; };
  const near = add(0, -5), far = add(0, -30), behind = add(0, 20);
  sc.updateMatrixWorld();
  assert.equal(drawn(batch), 2);
  const full = near.children[0].geometry, lod = full.userData.lod;
  assert.deepEqual(drawnGeo(batch).sort(), [full.id, lod.id].sort());
  // turning around: only the far item behind draws (coarse); the culled near one still picks
  cam.rotation.y = Math.PI;
  sc.updateMatrixWorld();
  assert.equal(drawn(batch), 1);
  assert.deepEqual(drawnGeo(batch), [lod.id]);
  const ray = new T.Raycaster(new T.Vector3(0, 0, 0), new T.Vector3(0, 0, -1));
  const hit = ray.intersectObjects(items.children, true)[0];
  let o = hit && hit.object; while (o && o.parent !== items) o = o.parent;
  assert.ok(o === near && far !== behind);
});
