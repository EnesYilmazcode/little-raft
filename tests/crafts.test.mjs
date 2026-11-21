// Raft decor batch: placed copies share one template per type and draw through InstancedMeshes.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../dist/vendor/three.module.js';
import { createCraft, createCraftBatch } from '../dist/crafts.js';

const insts = b => b.root.children.filter(o => o.isInstancedMesh);

test('batch instances follow the live handles and share template resources', () => {
  const b = createCraftBatch(T), raft = new T.Group();
  raft.add(b.root);
  assert.equal(b.place('nope'), null);
  const hs = [];
  for (let i = 0; i < 6; i++) { const h = b.place(i % 2 ? 'crate' : 'sail'); h.position.set(i, .22, -i); h.rotation.y = i * .7; raft.add(h); hs.push(h); }
  assert.equal(hs[1].userData.craftType, 'crate');
  assert.equal(hs[1].children.length, 0, 'handles hold no meshes');
  b.sync(hs);
  const crate = createCraft(T, 'crate');
  const crateParts = insts(b).filter(o => o.name.startsWith('crate'));
  assert.equal(crateParts.length, crate.children.length);
  for (const m of crateParts) assert.equal(m.count, 3);
  // instance 1 of crate = handle 3's local matrix (the parts are at the template origin)
  const m = new T.Matrix4(); crateParts[0].getMatrixAt(1, m);
  hs[3].updateMatrix(); m.elements.forEach((v, i) => assert.ok(Math.abs(v - hs[3].matrix.elements[i]) < 1e-6));
  // one material/geometry per part regardless of copies; growth keeps them
  const geo = crateParts[0].geometry, mat = crateParts[0].material;
  for (let i = 0; i < 10; i++) { const h = b.place('crate'); h.position.x = 20 + i; hs.push(h); }
  b.sync(hs);
  const grown = insts(b).find(o => o.name === crateParts[0].name);
  assert.equal(grown.count, 13); assert.equal(grown.geometry, geo); assert.equal(grown.material, mat);
  b.sync(hs.filter(h => h.userData.craftType !== 'sail'));
  for (const o of insts(b).filter(o => o.name.startsWith('sail'))) { assert.equal(o.count, 0); assert.equal(o.visible, false); }
  b.dispose();
  assert.equal(b.root.children.length, 0);
});

test('thin parts do not cast shadows', () => {
  const g = createCraft(T, 'sail'), cast = {};
  g.traverse(o => { if (o.isMesh) cast[o.name] = o.castShadow; });
  assert.equal(cast.sailTimber, true); assert.equal(cast.sailCloth, true);
  assert.equal(cast.sailRope, false); assert.equal(cast.sailLashing, false); assert.equal(cast.pennant, false);
});
