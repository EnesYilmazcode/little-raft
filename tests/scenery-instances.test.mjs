// Unit tests for scenery-instances.js: proxy groups drive one InstancedMesh per baked material.
// Run: node --test tests/scenery-instances.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { createSceneryInstances } = await import(new URL('scenery-instances.js', base));

test('scenery instances follow proxy position, scale and visibility', () => {
  const proxies = [0, 1, 2].map(i => { const g = new T.Group(); g.position.set(i * 10, 1, 0); return g; });
  const geo = new T.BoxGeometry(1, 1, 1), mats = [new T.MeshStandardMaterial(), new T.MeshStandardMaterial()];
  const s = createSceneryInstances(T, proxies, mats.map(m => new T.Mesh(geo, m)));
  assert.equal(s.meshes.length, 2);
  const m4 = new T.Matrix4(), p = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
  const at = (mesh, i) => { mesh.getMatrixAt(i, m4); m4.decompose(p, q, sc); return [p.x, p.y, p.z, sc.x, sc.y, sc.z]; };
  for (const mesh of s.meshes) { assert.equal(mesh.count, 3); assert.deepEqual(at(mesh, 2), [20, 1, 0, 1, 1, 1]); }
  assert.equal(s.sync(), false, 'nothing moved');
  proxies[1].position.x = -5; proxies[1].scale.x = 2; proxies[2].visible = false;
  assert.equal(s.sync(), true);
  for (const mesh of s.meshes) {
    assert.deepEqual(at(mesh, 1), [-5, 1, 0, 2, 1, 1]);
    assert.deepEqual(at(mesh, 2).slice(3), [0, 0, 0], 'hidden proxy collapses its instance');
    assert.ok(mesh.boundingSphere.containsPoint(new T.Vector3(-5, 1, 0)), 'bounds follow the instances');
  }
  proxies[2].visible = true; s.sync();
  assert.deepEqual(at(s.meshes[0], 2), [20, 1, 0, 1, 1, 1]);
  proxies[0].position.y = 0.1; // not exact in float32: still clean on the next sync
  assert.equal(s.sync(), true); assert.equal(s.sync(), false);
  for (const g of proxies) g.visible = false; s.sync();
  assert.ok(s.meshes.every(m => !m.visible), 'all hidden: no draw');
});
