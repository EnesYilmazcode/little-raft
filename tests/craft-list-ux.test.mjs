// Recipe list clarity: have/need chips per ingredient, recipe search, "can make N" in items,
// hold labels in one unit, recipe-specific detail text, folded study-locked recipes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = new URL('../dist/', import.meta.url);
const CB = await import(new URL('craft-book.js', base));
const { RECIPES } = await import(new URL('inventory-state.js', base));
const src = f => readFileSync(new URL(f, base), 'utf8');

test('recipeChips: one have/need chip per ingredient, in recipe order, short ones flagged', () => {
  const rows = CB.ingredientRows([{ kind: 'wood', count: 4 }, { kind: 'rope', count: 2 }], k => ({ wood: 3, rope: 5 })[k]);
  assert.deepEqual(CB.recipeChips(rows), [
    { kind: 'wood', label: '3/4', enough: false },
    { kind: 'rope', label: '5/2', enough: true },
  ]);
  assert.equal(CB.chipLabel({ have: 12345, need: 2 }), '999+/2', 'a huge stash keeps the chip narrow');
  assert.deepEqual(CB.recipeChips(null), []);
});

test('recipeMatches: every word must hit the name, the output or an ingredient', () => {
  const r = { id: 'hook', name: 'Hook', out: { kind: 'hook', count: 1 }, reqs: [{ kind: 'wood', count: 1 }, { kind: 'plastic', count: 2 }] };
  const nameOf = k => ({ wood: 'Plank', plastic: 'Plastic', hook: 'Hook' })[k] || k;
  assert.equal(CB.recipeMatches(r, '', nameOf), true, 'empty search shows everything');
  assert.equal(CB.recipeMatches(r, '  HOO ', nameOf), true, 'case and spaces do not matter');
  assert.equal(CB.recipeMatches(r, 'plank', nameOf), true, 'by ingredient display name');
  assert.equal(CB.recipeMatches(r, 'hook plast', nameOf), true);
  assert.equal(CB.recipeMatches(r, 'hook rope', nameOf), false, 'all words must match');
  assert.equal(CB.recipeMatches(null, 'x'), false);
  assert.deepEqual(CB.queryWords(' a  B '), ['a', 'b']);
});

test('hold labels count items, not crafts, for multi-output recipes (Glass Cups x3, cap 4)', () => {
  assert.equal(CB.holdHint(4, CB.HOLD.max, 3), 'hold: up to 12');
  assert.equal(CB.holdLabel(1, 0, false, 3), 'Crafted 3');
  assert.equal(CB.holdLabel(2, 4, true, 3), 'Crafting 6 / 12');
  assert.equal(CB.holdLabel(4, 0, false, 3), 'Crafted 12');
  assert.equal(CB.holdHint(1, CB.HOLD.max, 3), '', 'a single craft has no hold hint');
  assert.equal(CB.holdHint(4), 'hold: up to 4', 'single-output recipes unchanged');
  const ui = src('survival-ui.js');
  assert.match(ui, /holdLabel\(n, hold\.cap, true, viewOf\(hold\.id\)\?\.r\.out\.count \|\| 1\)/, 'the running label passes items per craft');
  assert.match(ui, /holdHint\(cap, HOLD\.max, v\.r\.out\.count\)/);
  assert.match(ui, /holdHint\(v\.times, HOLD\.max, v\.r\.out\.count\)/);
  assert.match(ui, /<small>can make<\/small>\$\{Math\.min\(times, 99\) \* Math\.max\(1, r\.out\.count \|\| 1\)\}/, 'list pill is in items too');
});

test('recipeText: a recipe that is not named after its output uses its own words', () => {
  for (const r of Object.values(RECIPES)) {
    if (r.id === r.output.kind) continue;
    const t = CB.recipeText({ id: r.id, out: { kind: r.output.kind } });
    assert.ok(t && t.desc, `${r.id} has a description`);
    assert.notEqual(t, CB.ITEM_TEXT[r.output.kind], `${r.id} does not borrow ${r.output.kind}'s text`);
  }
  assert.equal(CB.recipeText({ id: 'hook', out: { kind: 'hook' } }), CB.ITEM_TEXT.hook);
  assert.equal(CB.recipeText(null), null);
  assert.match(src('survival-ui.js'), /const t = recipeText\(v\.r\);/);
});

test('craft panel wiring: chips, search box, tab badge tooltip, no hover card over the detail', () => {
  const ui = src('survival-ui.js');
  assert.match(ui, /<span class="sv-rchips" aria-hidden="true"><\/span>/);
  assert.match(ui, /recipeChips\(rows\)\.map\(c => `<i class="sv-chip\$\{c\.enough \? ' sv-ok' : ''\}">\$\{art\(c\.kind\)\}/, 'chips use the same 3D icons as the rest of the panel');
  assert.match(ui, /<input type="search" class="sv-rsearch" placeholder="Search recipes"/);
  assert.match(ui, /recipeMatches\(v\.r, q, itemName\)/);
  assert.match(ui, /you can craft now/, 'green tab badges explain themselves');
  assert.match(ui, /\$\{iconHTML\(g\.icon\)\}<span>/, 'category icons are 3D like everything else');
  assert.match(src('item-tooltips.js'), /el\.matches\?\.\('#inventory \.sv-recipe'\) \? null : el/, 'no hover card on crafting list rows');
  assert.doesNotMatch(ui, /aria-describedby\^="it-tip-"/, 'the CSS workaround is gone');
  assert.match(ui, /@media\(max-width:900px\) and \(min-width:761px\)\{[^}]*--s:34px/, 'two columns down to 761px wide');
});

test('study-locked recipes fold to one sample card per tab until a desk exists', async () => {
  const sr = src('storage-research-ui.js');
  const { foldHead } = await import(new URL('storage-research-ui.js', base));
  assert.equal(foldHead(8), '8 locked · build a Tinker’s Desk');
  assert.match(sr, /setClass\(el, 'lr-sr-fold', !head && !table\)/);
  assert.match(sr, /#inventory \.sv-rcol:not\(\.sv-searching\) \.sv-recipe\.lr-sr-fold\{display:none\}/, 'a search still finds folded recipes');
  assert.match(sr, /#inventory \.sv-recipe\[data-locked\] \.sv-rsub\{display:none\}/, 'locked cards are one line plus the study line');
});
