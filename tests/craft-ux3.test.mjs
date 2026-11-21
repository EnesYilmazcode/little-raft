// Crafting UX round 3: hold-to-craft ring maths, and a 3D icon model for every item kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const book = await import(new URL('craft-book.js', base));
const icons = await import(new URL('item-icons.js', base));
const T = await import(new URL('vendor/three.module.js', base));
const { buildIconModel, ICON_MODEL_KINDS } = await import(new URL('icon-models.js', base));
const { ITEMS } = await import(new URL('items.js', base));
const { ITEM_INFO, RECIPES } = await import(new URL('inventory-state.js', base));
const { ITEM_ICONS } = await import(new URL('item-svg.js', base));

test('ring offset: empty at 0, closed at 1, linear between, clamped', () => {
  assert.equal(book.ringOffset(0), book.RING_LEN);
  assert.equal(book.ringOffset(1), 0);
  assert.equal(book.ringOffset(0.25), book.RING_LEN * 0.75);
  assert.equal(book.ringOffset(-3), book.RING_LEN);
  assert.equal(book.ringOffset(7), 0);
  assert.equal(book.ringOffset(NaN), book.RING_LEN);
  assert.equal(book.ringOffset(0.5, 40), 20);
});

test('ring count label', () => {
  assert.equal(book.ringCount(0), '');
  assert.equal(book.ringCount(-2), '');
  assert.equal(book.ringCount(undefined), '');
  assert.equal(book.ringCount(1), '1');
  assert.equal(book.ringCount(12.9), '12');
  assert.equal(book.ringCount(99), '99');
  assert.equal(book.ringCount(150), '99+');
});

const meshCount = g => { let n = 0; g.traverse(o => { if (o.isMesh) n++; }); return n; };
const allKinds = [...new Set([...Object.keys(ITEMS), ...Object.keys(ITEM_INFO)])];

test('every item kind resolves to a 3D icon model (no flat-only items)', () => {
  const missing = [];
  for (const k of allKinds) {
    const { model } = icons.resolveIconModel(k);
    if (!model || !model.isObject3D || meshCount(model) === 0) missing.push(k);
  }
  assert.deepEqual(missing, [], 'kinds without a 3D icon: ' + missing.join(', '));
});

test('icon-models builds a framed, finite model for each of its kinds and nothing else', () => {
  for (const k of ICON_MODEL_KINDS) {
    const g = buildIconModel(T, k);
    assert.ok(g && meshCount(g) > 0, k);
    let bad = false; g.traverse(o => { if (o.isPoints || o.isSprite || o.isLine) bad = true; });
    assert.equal(bad, false, k + ': spray points and sprites are removed so the icon is framed on the item');
    const box = new T.Box3().setFromObject(g, true);
    assert.ok(!box.isEmpty() && Number.isFinite(box.max.x + box.min.y), k + ' has finite bounds');
    const own = icons.resolveIconModel(k);
    if (own.model && !['cup', 'seed', 'water'].includes(k)) assert.equal(own.own, true, k + ' icon model is freed after rendering');
  }
  assert.equal(buildIconModel(T, 'not-an-item'), null);
});

test('the receiver has a drawn flat icon while its 3D one renders (no blank tile)', () => {
  assert.match(ITEM_ICONS.receiver, /<rect/);
  for (const [k, info] of Object.entries(ITEM_INFO)) {
    if (!info.placeholder) continue;
    // Placeholders without a drawing show a blank tile until the 3D icon is ready; each must have a model.
    if (!ITEM_ICONS[k]) assert.ok(icons.resolveIconModel(k).model, k + ' has a 3D icon to replace its blank tile');
  }
});

test('every item has a description and a source line', () => {
  const recipes = Object.values(RECIPES).map(r => ({ id: r.id, out: { kind: r.id }, reqs: Object.entries(r.cost || {}).map(([kind, count]) => ({ kind, count })) }));
  const noText = [], noSource = [];
  for (const k of allKinds) {
    if (!book.ITEM_TEXT[k]) noText.push(k);
    if (!book.sourceOf(k, recipes)) noSource.push(k);
  }
  assert.deepEqual(noText, [], 'no description: ' + noText.join(', '));
  assert.deepEqual(noSource, [], 'no source line: ' + noSource.join(', '));
});
