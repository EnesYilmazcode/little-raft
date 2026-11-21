// Model library checks: every kind builds, stays in budget, has sane origins and shares cached geometry.
// Run: node --test tests/models.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../dist/vendor/three.module.js';
import { buildModel, getModel, hasModel, MODEL_KINDS, MODEL_ALIASES } from '../dist/models.js';

const BUDGET = { seed: 600, plank: 600, scrap: 600, beet: 600, potato: 600, plastic: 1500, leaf: 1500, rope: 1500, barrel: 1500,
  hook: 2500, hammer: 2500, rod: 2500, wateringCan: 2500, sprout: 1200, young: 1200, mature: 1200, harvestable: 1200,
  fish: 1500, nails: 600, cup: 600, water: 600, palmSeedling: 1200, palmSprout: 1200, palmYoung: 3000, palmMature: 5000, planter: 3000,
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

// Merged with raft-master: lane items (diving, progression, watering, signal...) bring their own world models;
// models.js covers the core set, and every other bag kind still gets a held-item fallback mesh.
test('every game item and farming stage has a model', async () => {
  const { ITEM_KINDS } = await import('../dist/inventory-state.js');
  const { buildItemModel } = await import('../dist/held-items.js');
  const farm = ['seed', 'cup', 'water', 'planter', 'palm-0', 'palm-1', 'palm-2', 'palm-3', 'nails', 'planks', 'fishingrod', 'wateringcan'];
  const core = ['wood', 'leaf', 'scrap', 'plastic', 'rope', 'nail', 'hook', 'hammer', 'fish', 'sail', 'palm', 'lantern', 'net', 'bench', 'crate'];
  for (const k of [...core, ...farm]) {
    assert.ok(hasModel(k), 'no model for ' + k);
    assert.equal(getModel(k).userData.kind, MODEL_ALIASES[k] || k);
  }
  for (const k of ITEM_KINDS) assert.ok(hasModel(k) || buildItemModel(T, k), 'no model or held fallback for ' + k);
  const h = ['palm-0', 'palm-1', 'palm-2', 'palm-3'].map(k => getModel(k).userData.height);
  for (let i = 1; i < h.length; i++) assert.ok(h[i] > h[i - 1], 'palm stages grow taller');
});
