// Raft decor models: thin parts skip the shadow pass; clones share one cached model per type.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../dist/vendor/three.module.js';
import { createCraft } from '../dist/crafts.js';

test('thin parts do not cast shadows', () => {
  const g = createCraft(T, 'sail'), cast = {};
  g.traverse(o => { if (o.isMesh) cast[o.name] = o.castShadow; });
  assert.equal(cast.sailTimber, true); assert.equal(cast.sailCloth, true);
  assert.equal(cast.sailRope, false); assert.equal(cast.pennant, false);
  assert.equal(cast.sailLashing, undefined); // merged into sailRope
});

test('clones share geometry and materials, the palm soil stays per instance, fresh builds are private', () => {
  for (const k of ['sail', 'palm', 'lantern', 'net', 'bench', 'crate']) {
    const a = createCraft(T, k), b = createCraft(T, k), f = createCraft(T, k, { fresh: true });
    const ma = [], mb = [], mf = [];
    a.traverse(o => { if (o.isMesh) ma.push(o); }); b.traverse(o => { if (o.isMesh) mb.push(o); }); f.traverse(o => { if (o.isMesh) mf.push(o); });
    assert.equal(ma.length, mb.length, k); assert.equal(ma.length, mf.length, k);
    for (let i = 0; i < ma.length; i++) {
      assert.equal(ma[i].geometry, mb[i].geometry, k + ' ' + ma[i].name);
      assert.equal(ma[i].geometry.userData.shared, true);
      assert.notEqual(mf[i].geometry, ma[i].geometry); assert.notEqual(mf[i].geometry.userData.shared, true);
      if (ma[i].name === 'soil') { assert.notEqual(ma[i].material, mb[i].material); assert.notEqual(ma[i].material.userData.shared, true); }
      else { assert.equal(ma[i].material, mb[i].material, k + ' ' + ma[i].name); assert.equal(ma[i].material.userData.shared, true); }
    }
    assert.equal(a.userData.craftType, k); assert.ok(a.userData.height > 0);
  }
});
