// Every craftable output gets a 3D icon model, and recipe-row tooltips fall back to the recipe table
// (name, output, cost) for recipes outside the ITEMS catalogue.
// Run: node --test tests/craft-icons-tips.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { RECIPES, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { CONTENT_RECIPES } = await import(new URL('content-items.js', base));
const { ITEMS } = await import(new URL('items.js', base));
const icons = await import(new URL('item-icons.js', base));
const IM = await import(new URL('icon-models.js', base));

const allRecipes = [...Object.values(RECIPES), ...Object.values(CONTENT_RECIPES)];
const outputKinds = [...new Set(allRecipes.map(r => r.output.kind))];

test('every recipe output kind resolves a non-empty 3D icon model', () => {
  const missing = [], empty = [];
  for (const k of outputKinds) {
    const { model, own } = icons.resolveIconModel(k);
    if (!model) { missing.push(k); continue; }
    let meshes = 0; model.traverse(o => { if (o.isMesh) meshes++; });
    if (!meshes || new T.Box3().setFromObject(model, true).isEmpty()) empty.push(k);
    if (own) model.userData.iconFree?.();
  }
  assert.deepEqual(missing, [], 'kinds with no 3D icon (flat SVG fallback)');
  assert.deepEqual(empty, [], 'kinds whose icon model draws nothing');
});

test('icon-models stand-ins stay small and hidden parts are dropped', () => {
  for (const k of ['paint_seafoam', 'sinker', 'bucket', 'fins', 'airjug', 'goggles', 'scraper', 'bowl', 'armor']) {
    const g = IM.buildIconModel(T, k);
    assert.ok(g, k);
    let n = 0; g.traverse(o => { if (o.isMesh) n++; });
    assert.ok(n >= 2 && n <= 8, `${k}: ${n} meshes`);
  }
  const pot = IM.buildIconModel(T, 'cookpot');
  pot.traverse(o => assert.ok(o.visible, 'no hidden parts left to skew the framing'));
  pot.userData.iconFree?.();
});

test('building every recipe icon model stays fast', () => {
  const t0 = performance.now();
  for (const k of outputKinds) { const { model, own } = icons.resolveIconModel(k); if (own) model?.userData.iconFree?.(); }
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `${outputKinds.length} models took ${ms.toFixed(0)} ms`);
});

// ---- item-tooltips.js with a minimal fake DOM (same shape as craft-fixes.test.mjs) ----
function fakeEl(tag = 'div') {
  const attrs = {};
  const el = {
    tagName: tag, dataset: {}, style: {}, hidden: false, innerHTML: '', textContent: '', id: '', className: '', parentNode: null, isConnected: true,
    offsetWidth: 100, offsetHeight: 60,
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; }, removeAttribute(k) { delete attrs[k]; },
    append(c) { c.parentNode = el; }, remove() { el.parentNode = null; },
    closest() { return null; }, contains(o) { return o === el; }, matches() { return false; },
    getBoundingClientRect: () => ({ left: 10, top: 10, right: 50, bottom: 50, width: 40, height: 40 }),
  };
  return el;
}
function fakeDoc() {
  const listeners = new Map();
  const doc = {
    head: fakeEl('head'), body: fakeEl('body'), ownerDocument: null, defaultView: { addEventListener() {} },
    createElement: t => fakeEl(t), getElementById: () => null, querySelector: () => null,
    addEventListener(t, fn) { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(fn); },
    fire(t, e = {}) { for (const fn of listeners.get(t) || []) fn(e); },
  };
  let tip = null;
  doc.body.append = c => { tip = c; c.parentNode = doc.body; };
  doc.tip = () => tip;
  doc.hover = el => { el.closest = sel => (String(sel).includes('dialog') ? null : el); doc.fire('pointerover', { target: el, clientX: 1, clientY: 1 }); };
  return doc;
}
globalThis.requestAnimationFrame ??= fn => setTimeout(fn, 0);
globalThis.innerWidth ??= 1280; globalThis.innerHeight ??= 720;
const TT = await import(new URL('item-tooltips.js', base));
const rowEl = (id, kind) => { const el = fakeEl('button'); el.dataset.recipe = id; el.dataset.tipKind = kind; return el; };

test('recipe rows whose id differs from the output show the recipe name and its own cost', () => {
  const doc = fakeDoc();
  const slots = new Array(SLOT_COUNT).fill(null);
  slots[0] = { kind: 'glass', count: 5 }; slots[1] = { kind: 'puffegg', count: 1 };
  const tt = TT.installItemTooltips({ getBag: () => ({ slots }), getProgression: () => ({ isUnlocked: () => false }), root: doc });
  const want = { glasscups: 'Glass Cups', brickplanter: 'Brick Planters', egglamp: 'Egg Lantern', coursekit: 'Course Kit' };
  for (const [id, name] of Object.entries(want)) {
    const r = RECIPES[id] || CONTENT_RECIPES[id];
    assert.ok(r && r.output.kind !== id, `premise: ${id} makes something else`);
    doc.hover(rowEl(id, r.output.kind));
    const h = doc.tip().innerHTML;
    assert.match(h, new RegExp(`class="it-name">${name}<`), id);
    assert.match(h, /class="it-cost">Needs /, `${id}: has/need line`);
    for (const k of Object.keys(r.cost)) assert.match(h, new RegExp(`\\b\\d+/${r.cost[k]}<`), `${id}: ${k}`);
    if (r.output.count > 1) assert.match(h, new RegExp(`makes ${r.output.count}`));
    assert.doesNotMatch(h, /it-lock/, `${id}: the output's catalogue lock is not this recipe's`);
  }
  doc.hover(rowEl('glasscups', 'cup'));
  assert.match(doc.tip().innerHTML, /Glass 5\/1/, 'have/need reads the bag');
  doc.hover(rowEl('egglamp', 'lantern'));
  assert.match(doc.tip().innerHTML, /Puff Egg 1\/1|Egg 1\/1/);
  tt.dispose();
});

test('every recipe row gets a Needs have/need line, catalogue or not', () => {
  const doc = fakeDoc();
  const tt = TT.installItemTooltips({ getBag: () => null, getProgression: () => null, root: doc });
  const none = [];
  for (const [id, r] of Object.entries(RECIPES)) {
    doc.hover(rowEl(id, r.output.kind));
    if (!/class="it-cost">/.test(doc.tip().innerHTML)) none.push(id);
  }
  assert.deepEqual(none, []);
  assert.ok(Object.keys(RECIPES).some(id => !ITEMS[id]), 'premise: some recipes are outside the catalogue');
  doc.hover(rowEl('motor', 'motor'));
  assert.match(doc.tip().innerHTML, /class="it-name">Little Motor</);
  tt.dispose();
});

test('recipeById falls back to the content recipe table and rejects junk', () => {
  assert.equal(TT.recipeById('coursekit').output.kind, 'courseflag');
  assert.equal(TT.recipeById('toString'), null);
  assert.equal(TT.recipeById(undefined), null);
});
