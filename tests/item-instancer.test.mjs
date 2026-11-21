// Floating-supply instancing: cached debris shares geometry, adopted meshes hide and draw through
// per-(geometry, material) InstancedMeshes, pending/off-screen items are skipped, picking still hits items.
// Run: node --test tests/item-instancer.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../dist/vendor/three.module.js';
import { createItemInstancer } from '../dist/item-instancer.js';
import { createDebris } from '../dist/debris.js';
import { createPlastic } from '../dist/plastic.js';
import { createBottle } from '../dist/bottle.js';

const mats = new Map();
const mat = c => { if (!mats.has(c)) mats.set(c, new T.MeshStandardMaterial({ color: c })); return mats.get(c); };
const meshes = g => { const out = []; g.traverse(o => { if (o.isMesh) out.push(o); }); return out; };

test('seeded debris is cached: clones share geometry marked shared', () => {
  const a = createDebris(T, 'wood', mat, { seed: 2 }), b = createDebris(T, 'wood', mat, { seed: 2 });
  const [ma, mb] = [meshes(a), meshes(b)];
  assert.equal(ma.length, 1, 'plank and nail are one mesh');
  assert.equal(ma[0].geometry, mb[0].geometry);
  assert.ok(ma[0].geometry.userData.shared);
  assert.equal(meshes(createDebris(T, 'scrap', mat, { seed: 1 })).length, 1, 'scrap sheet, bolts and bracket are one mesh');
  assert.equal(meshes(createPlastic(T)).length, 1, 'jug creases are baked into the body');
  assert.equal(meshes(createBottle(T)).length, 2, 'bottle is glass + one opaque mesh');
});

test('instancer draws visible on-screen items and skips pending and off-screen ones', () => {
  const scene = new T.Scene(), group = new T.Group(); scene.add(group);
  const inst = createItemInstancer(T, scene);
  const cam = new T.PerspectiveCamera(70, 1, 0.05, 200); cam.position.set(0, 2, 10); cam.lookAt(0, 0, 0); scene.add(cam);
  const items = [];
  for (let i = 0; i < 12; i++) {
    const g = createDebris(T, 'wood', mat, { seed: 1 + (i % 3) });
    g.position.set((i % 4) - 2, 0, -Math.floor(i / 4)); group.add(g); inst.adopt(g); items.push(g);
  }
  for (const g of items) for (const m of meshes(g)) assert.equal(m.visible, false, 'source mesh hidden');
  items[0].visible = false;                  // pending
  items[1].position.set(0, 0, 50);           // behind the camera
  scene.updateMatrixWorld(true); cam.updateProjectionMatrix();
  inst.update(group, cam);
  const ims = scene.getObjectByName('itemInstances').children.filter(m => m.isInstancedMesh);
  assert.equal(ims.length, 3, 'one bucket per cached wood shape');
  assert.equal(ims.reduce((n, m) => n + m.count, 0), 10);
  // instance matrices are the items' world matrices (scale from the hook carry included)
  items[2].scale.setScalar(0.5); inst.update(group, cam);
  const src = meshes(items[2])[0], im = ims.find(m => m.geometry === src.geometry);
  const found = [...Array(im.count).keys()].some(k => { const e = im.instanceMatrix.array.subarray(k * 16, k * 16 + 16); return e.every((v, j) => Math.abs(v - src.matrixWorld.elements[j]) < 1e-6); });
  assert.ok(found);
  // picking the hidden source meshes still works; the instanced meshes never intercept rays
  const ray = new T.Raycaster(new T.Vector3(items[5].position.x, 5, items[5].position.z), new T.Vector3(0, -1, 0));
  const hits = ray.intersectObjects(scene.children, true);
  assert.ok(hits.length && !hits.some(h => h.object.isInstancedMesh));
  let o = hits[0].object; while (o && o.parent !== group) o = o.parent;
  assert.equal(o, items[5]);
});

test('instancer grows its buckets past the initial capacity', () => {
  const scene = new T.Scene(), group = new T.Group(); scene.add(group);
  const inst = createItemInstancer(T, scene), cam = new T.PerspectiveCamera(70, 1, 0.05, 200); cam.position.set(0, 20, 30); cam.lookAt(0, 0, 0);
  for (let i = 0; i < 40; i++) { const g = createPlastic(T); g.position.set((i % 8) - 4, 0, -Math.floor(i / 8)); group.add(g); inst.adopt(g); }
  inst.update(group, cam);
  const [im] = scene.getObjectByName('itemInstances').children;
  assert.equal(im.count, 40);
});
