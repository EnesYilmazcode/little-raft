// Raft decor models: thin parts skip the shadow pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../dist/vendor/three.module.js';
import { createCraft } from '../dist/crafts.js';

test('thin parts do not cast shadows', () => {
  const g = createCraft(T, 'sail'), cast = {};
  g.traverse(o => { if (o.isMesh) cast[o.name] = o.castShadow; });
  assert.equal(cast.sailTimber, true); assert.equal(cast.sailCloth, true);
  assert.equal(cast.sailRope, false); assert.equal(cast.sailLashing, false); assert.equal(cast.pennant, false);
});
