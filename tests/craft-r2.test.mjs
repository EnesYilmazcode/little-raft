// Crafting round 2 regressions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const icons = await import(new URL('item-icons.js', base));

test('CRAFT-1: cup, seed and water icons come from models.js; existing procedural icons are unchanged', () => {
  for (const k of ['cup', 'seed', 'water']) {
    const { model, own } = icons.resolveIconModel(k);
    assert.ok(model && model.isObject3D, k + ' has a 3D icon model');
    assert.equal(own, false, k + ' shares cached models.js geometry, so it must not be freed');
  }
  for (const k of ['hook', 'hammer', 'fishingrod', 'net', 'bench', 'crate', 'sail', 'lantern', 'wood']) {
    const { model, own } = icons.resolveIconModel(k);
    assert.ok(model, k);
    assert.equal(own, true, k + ' still uses its procedural icon');
  }
});
