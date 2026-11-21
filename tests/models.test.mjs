// Model library checks: every kind builds, stays in budget, has sane origins and shares cached geometry.
// Run: node --test tests/models.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../dist/vendor/three.module.js';
import { buildModel, getModel, MODEL_KINDS } from '../dist/models.js';

const BUDGET = { seed: 600, plank: 600, scrap: 600, beet: 600, potato: 600, plastic: 1500, leaf: 1500, rope: 1500, barrel: 1500,
  hook: 2500, hammer: 2500, rod: 2500, wateringCan: 2500, sprout: 1200, young: 1200, mature: 1200, harvestable: 1200,
  crate: 3000, bench: 3000, cropPlot: 3000, lantern: 3000, sail: 5000, net: 5000, palmPlanter: 5000, foundation: 5000 };
const TOOLS = ['hook', 'hammer', 'rod'];
const tris = g => { let t = 0; g.traverse(o => { if (o.isMesh) t += o.geometry.index.count / 3; }); return t; };

test('every kind builds within budget at both LODs', () => {
  for (const k of MODEL_KINDS) {
    const m0 = buildModel(k), m1 = buildModel(k, { lod: 1 });
    assert.ok(m0 && m1, k);
    assert.ok(BUDGET[k], 'budget listed for ' + k);
    assert.ok(tris(m0) <= BUDGET[k], `${k} lod0 ${tris(m0)} > ${BUDGET[k]}`);
    assert.ok(tris(m1) <= tris(m0), `${k} lod1 not lighter`);
    assert.ok(m0.children.length <= 6, `${k} uses ${m0.children.length} meshes`);
    m0.traverse(o => { if (o.isMesh) for (const v of o.geometry.attributes.position.array) assert.ok(Number.isFinite(v), k + ' NaN'); });
  }
});

test('origins follow the style guide', () => {
  for (const k of MODEL_KINDS) {
    const box = new T.Box3().setFromObject(buildModel(k));
    if (TOOLS.includes(k)) assert.ok(box.containsPoint(new T.Vector3(0, 0, 0)), k + ' grip not inside model');
    else assert.ok(Math.abs(box.min.y) < 0.2, `${k} base at ${box.min.y}`);
  }
  const f = new T.Box3().setFromObject(buildModel('foundation'));
  assert.ok(Math.abs(f.max.y - 0.2) < 0.01 && f.max.x <= 1.001 && f.min.z >= -1.001, 'foundation matches deck tile');
});

test('getModel shares geometry and aliases resolve', () => {
  const a = getModel('barrel'), b = getModel('barrel');
  assert.notEqual(a, b);
  assert.equal(a.children[0].geometry, b.children[0].geometry);
  assert.equal(getModel('wood').userData.kind, 'plank');
  assert.equal(buildModel('nope'), null);
  assert.equal(getModel('cropPlot').userData.slots.length, 2);
});
