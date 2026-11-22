// Crafting UI player feedback: no selectable text, an icon pin, a centred panel, + on a missing
// ingredient instead of jumping to its recipe, count-and-icon requirements, and a drawn icon for every item.
// Run: node --test tests/crafting-ui.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = name => readFileSync(fileURLToPath(new URL(name, base)), 'utf8');
const CB = await import(new URL('craft-book.js', base));
const { RECIPES, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const { ITEMS } = await import(new URL('items.js', base));
globalThis.document ??= { querySelector: () => null }; // iconSVG reads the sprite URL from the page
const UI = await import(new URL('survival-ui.js', base));
const ui = src('survival-ui.js');

// ---------------------------------------------------------------- 6. icons
test('every recipe output and ingredient draws a real icon, never a two-letter tile', () => {
  const kinds = new Set(Object.keys(ITEM_INFO));
  for (const r of Object.values(RECIPES)) { kinds.add(r.output?.kind ?? r.id); for (const k of Object.keys(r.cost || {})) kinds.add(k); }
  for (const [id, it] of Object.entries(ITEMS)) { if (!it?.recipe) continue; kinds.add(id); for (const k of Object.keys(it.recipe.cost || {})) kinds.add(k); }
  const lettered = [...kinds].filter(k => /<text/.test(UI.iconSVG(k)));
  assert.deepEqual(lettered, [], 'items without a drawing (add one to item-svg.js)');
});

// ---------------------------------------------------------------- 5. count + icon
test('reqChips: the count, then the icon; the name only as hover title and aria-label', () => {
  const rows = [{ kind: 'metalingot', need: 1, have: 0, enough: false }, { kind: 'wood', need: 2, have: 5, enough: true }];
  const html = CB.reqChips(rows, { glyph: k => `<svg data-k="${k}"></svg>`, nameOf: k => ({ metalingot: 'Metal Ingot', wood: 'Plank' })[k], cls: 'x' });
  assert.match(html, /^<span class="x x-short" title="Metal Ingot" aria-label="Metal Ingot: have 0, need 1" data-kind="metalingot"><b>0\/1<\/b><svg data-k="metalingot"><\/svg><\/span>/);
  assert.match(html, /<span class="x" title="Plank"[^>]*><b>5\/2<\/b><svg data-k="wood"><\/svg><\/span>$/);
  const text = html.replace(/<[^>]*>/g, '');
  assert.equal(text, '0/15/2', 'no item names or words between the tags');
  assert.doesNotMatch(CB.reqChips(rows, { title: false }), /title=/, 'title can be left to an item tooltip');
  assert.match(CB.reqChips([{ kind: 'rope', need: 2 }]), /<b>2<\/b>/, 'without a count source it shows the needed number');
});

test('reqAmount: digits only (have/need, need, or short)', () => {
  assert.equal(CB.reqAmount({ need: 1, have: 0 }), '0/1');
  assert.equal(CB.reqAmount({ need: 4, have: 1200 }), '999/4');
  assert.equal(CB.reqAmount({ need: 3, have: 1 }, 'need'), '3');
  assert.equal(CB.reqAmount({ need: 3, have: 1 }, 'short'), '2');
  assert.equal(CB.reqAmount({ need: 3 }), '3');
});

test('item glyph registry: survival-ui registers the bag icon; a throwing glyph gives no icon', () => {
  CB.setItemGlyph(() => { throw new Error('x'); });
  assert.equal(CB.itemGlyph('wood'), '');
  CB.setItemGlyph(k => `<i>${k}</i>`);
  assert.equal(CB.itemGlyph('wood'), '<i>wood</i>');
  CB.setItemGlyph(null);
  assert.equal(CB.itemGlyph('wood'), '');
  assert.match(ui, /setItemGlyph\(kind => art\(kind\)\);/);
});

test('requirements are count + icon in the recipe list, detail tiles, tracker, tooltips and build wheel', () => {
  assert.match(ui, /if \(state === 'missing'\) v\.sub\.innerHTML = reqChips\(lacking,/, 'recipe list');
  assert.doesNotMatch(ui, /'Need ' \+ lacking/, 'no "Need 1 Metal Ingot" text');
  assert.match(ui, /<li class="sv-ing" data-tip-kind="\$\{esc\(q\.kind\)\}">\$\{art\(q\.kind\)\}<b class="sv-iamt"><\/b>/, 'detail tile: icon and count, no name');
  assert.match(ui, /<div class="ct-reqs">\$\{reqChips\(tv\.rows,/, 'pinned tracker');
  const tt = src('item-tooltips.js');
  assert.match(tt, /reqChips\(rows, \{ nameOf, cls: 'it-rq' \}\)/, 'item tooltip');
  assert.doesNotMatch(tt, /Needs \$\{parts/, 'no "Needs Plank 2/4" text');
  const bm = src('build-menu.js');
  assert.match(bm, /const icon = itemGlyph\(p\.kind\)/, 'build wheel uses the bag icons');
  assert.match(bm, /\$\{icon \|\| `<em>\$\{esc\(p\.name\)\}<\/em>`\}/, 'the name shows only when there is no icon');
});

// ---------------------------------------------------------------- 4. + instead of navigation, no Craft text
test('a missing ingredient gets a + that crafts it in place; no jump to its recipe', () => {
  assert.doesNotMatch(ui, /jumpTo|sv-ijump|craft it ›/, 'the back-and-forth jump is gone');
  assert.match(ui, /class="sv-iplus" data-make="\$\{esc\(sub\)\}"/);
  assert.match(ui, /const can = !row\.enough && viewOf\(e\.plus\.dataset\.make\)\?\.state === 'ready';/, 'only when it can be made now');
  assert.match(ui, /if \(mk\) \{ makeIngredient\(mk\); return; \}/);
  const fn = ui.match(/function makeIngredient\(btn\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /craftNow\(btn\.dataset\.make\)/);
  assert.doesNotMatch(fn, /setPick|setTab|pickId/, 'crafting the ingredient never changes the open recipe');
  assert.match(ui, /#inventory \.sv-ing:hover>button\.sv-iplus/, 'shown on hover');
});

test('the craft button is an icon and a number, never words', () => {
  assert.match(ui, /<span class="sv-clabel">\$\{uiIcon\('hammer'\)\}<\/span>/);
  assert.doesNotMatch(ui, /'Missing materials'|D\.label\.textContent = /);
  const words = /[a-z]{2,}/i;
  for (const v of [
    CB.craftButtonView('ready', { times: 1 }), CB.craftButtonView('ready', { times: 5 }), CB.craftButtonView('missing'),
    CB.craftButtonView('full'), CB.craftButtonView('gated'), CB.craftButtonView('ready', { holding: true, done: 2, cap: 4 }),
    CB.craftButtonView('', { flash: true, done: 4, out: 3 }),
  ]) assert.doesNotMatch(v.text, words, JSON.stringify(v));
  assert.deepEqual(CB.craftButtonView('ready', { times: 5 }), { icon: 'hammer', text: '×5' });
  assert.deepEqual(CB.craftButtonView('gated'), { icon: 'lock', text: '' });
  assert.deepEqual(CB.craftButtonView('ready', { holding: true, done: 2, cap: 4 }), { icon: 'hammer', text: '2/4' });
  assert.deepEqual(CB.craftButtonView('', { flash: true, done: 4, out: 3 }), { icon: 'check', text: '+12' });
});

// ---------------------------------------------------------------- 2. pin icon
test('the pin is an icon with pinned / unpinned states', () => {
  assert.match(ui, /<button type="button" class="sv-pinbtn" aria-pressed="false" aria-label="Pin recipe">\$\{uiIcon\('pin'\)\}<\/button>/);
  assert.doesNotMatch(ui, /D\.pin\.textContent/);
  assert.match(ui, /D\.pin\.setAttribute\('aria-label', on \? 'Unpin recipe' : 'Pin recipe'\);/);
  assert.match(ui, /#inventory button\.sv-pinbtn\[aria-pressed="true"\] \.sv-uifill\{fill:currentColor\}/, 'pinned fills the pin');
  assert.doesNotMatch(ui, /2022 pinned/, 'no "pinned" text in the list');
});

// ---------------------------------------------------------------- 3. centred
test('the crafting panel is centred by the full-viewport dialog', () => {
  const rule = ui.match(/#inventory\.sv-inv\{[^}]*\}/)[0];
  assert.match(rule, /position:fixed;inset:0;/);
  assert.match(rule, /margin:0;/);
  assert.doesNotMatch(rule, /auto auto/, 'no top-pinned margins');
  assert.match(ui, /#inventory\.sv-inv\[open\]\{display:flex;align-items:center;justify-content:center\}/);
});

// ---------------------------------------------------------------- 1. no text selection / dragging
test('game UI is not selectable or draggable; text fields still are', () => {
  assert.match(ui, /html,body\{-webkit-user-select:none;user-select:none;/);
  assert.match(ui, /const TEXT_FIELD = 'input,textarea,\[contenteditable\]:not\(\[contenteditable="false"\]\)';/);
  assert.match(ui, /\$\{TEXT_FIELD\}\{-webkit-user-select:text;user-select:text\}/);
  assert.match(ui, /const css = CSS \+ BAG_HUD \+ NO_SELECT;/);
  assert.match(ui, /document\.addEventListener\('selectstart', e => \{ if \(!inTextField\(e\.target\)\) e\.preventDefault\(\); \}, opt\);/);
  assert.match(ui, /if \(inTextField\(el\) \|\| el\?\.closest\?\.\('\[draggable="true"\]'\)\) return;\s*e\.preventDefault\(\);/, 'only bag slots drag');
});
