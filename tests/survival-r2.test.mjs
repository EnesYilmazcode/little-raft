// Round-2 farming regressions: empty planters dry out, farm rewards reach the pickup feed, clean notes.
// Run: node --test tests/survival-r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const F = await import(new URL('farming.js', base));

test('SURV-2: an empty planter dries out like a grown palm', () => {
  const p = { s: F.EMPTY, g: 0, w: 80, h: 1 };
  let dried = false;
  for (let i = 0; i < 80; i++) dried = F.tickPlant(p, 1) || dried;
  assert.equal(p.w, 0);
  assert.equal(dried, true, 'drying is reported as a look change');
  assert.equal(F.isWet(p), false);
  assert.equal(F.farmSignature([{ type: 'palm', x: 0, z: 0, farm: p }]), '0,0:-1d;');
  assert.equal(F.tickPlant(p, 600), false, 'dry and empty stays put');
  assert.deepEqual(p, { s: F.EMPTY, g: 0, w: 0, h: 1 });
});

test('SURV-2: a seed planted in soil that dried gets no free growth', () => {
  const p = { s: F.EMPTY, g: 0, w: 80, h: 1 };
  F.tickPlant(p, 600);
  p.s = F.SEEDLING;
  F.tickPlant(p, 100);
  assert.equal(p.s, F.SEEDLING); assert.equal(p.g, 0);
});

const { Bag, SLOT_COUNT, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const bagWith = (items) => { const s = new Array(SLOT_COUNT).fill(null); items.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected: 0 }); };

test('SURV-3: harvest and cup-fill rewards are emitted as loot for the pickup feed', () => {
  const world = { decor: [{ type: 'palm', x: 0, z: 0, farm: { s: F.MATURE, g: 0, w: 0, h: 0 } }] };
  const harvest = F.farmEffect(F.applyFarmAction(world, bagWith([]), { kind: 'farm', op: 'harvest', x: 0, z: 0 }));
  assert.equal(harvest.kind, 'loot');
  assert.deepEqual(harvest.loot, { leaf: F.HARVEST.leaf, seed: F.HARVEST.seed });
  assert.equal('items' in harvest, false);
  for (const k of Object.keys(harvest.loot)) assert.ok(ITEM_INFO[k], `${k} has an icon entry`);
  const fill = F.farmEffect(F.applyFarmAction(world, bagWith([{ kind: 'cup', count: 1 }]), { kind: 'farm', op: 'fill' }));
  assert.deepEqual(fill.loot, { water: 1 });
  assert.equal(F.farmEffect({ ok: false, text: 'Not ready yet', effect: 'notice' }).loot, undefined);
  assert.equal(F.farmEffect({ ok: false, text: '' }), null);
});
