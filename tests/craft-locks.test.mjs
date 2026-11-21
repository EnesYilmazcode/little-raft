// Crafting fixes, round 3: Tinker's Desk locks reach the bag, hold-to-craft notices refusals, the
// storage-research annotation no longer fights the bag, every item has a picture, tracker lock state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = name => readFileSync(new URL(name, base), 'utf8');
const { ITEM_INFO, RECIPES } = await import(new URL('inventory-state.js', base));
const SR = await import(new URL('storage-research.js', base));
const CB = await import(new URL('craft-book.js', base));
globalThis.document ??= { querySelector: () => null, getElementById: () => null }; // survival-ui's flat icons read the page's sprite URL
const SU = await import(new URL('survival-ui.js', base));

// Same split game.js wires: the progression catalogue owns its own unlocks, the desk teaches the rest.
const TABLE_TREE = new Set(['rope', 'hook', 'hammer', 'fishingrod', 'sail', 'palm', 'lantern', 'net', 'bench', 'crate', 'research', 'receiver', 'antenna', 'cup', 'purifier']);
SR.setOwnedElsewhere(id => !TABLE_TREE.has(id));
const fresh = () => ({ seen: [], learned: [], chests: {}, r: 0 });

test('CRA3-1: lockGate reports a desk-locked recipe with what is left to study', () => {
  const g = SR.lockGate(fresh(), 'cup');
  assert.deepEqual(g, { locked: true, reason: 'Research Plastic at a Tinker’s Desk' });
  const u = CB.unlockInfo(g);
  assert.match(u.line, /^Unlock: Research Plastic/);
  assert.match(u.how, /Tinker’s Desk/, 'the how-to names the desk: ' + u.how);
  const two = SR.lockGate(fresh(), 'purifier');
  assert.ok(two.locked); assert.match(two.reason, /^Research .+ and .+ at a Tinker/, 'several kinds join with "and"');
});

test('CRA3-1: starters, learned recipes, catalogue recipes and unknown ids are not desk-locked', () => {
  for (const id of SR.STARTER) assert.equal(SR.lockGate(fresh(), id), null, id);
  assert.equal(SR.lockGate({ ...fresh(), learned: ['cup'] }, 'cup'), null);
  assert.equal(SR.lockGate(fresh(), 'nope'), null);
  const owned = Object.keys(RECIPES).find(id => !TABLE_TREE.has(id));
  if (owned) assert.equal(SR.lockGate(fresh(), owned), null, owned);
  // studying a kind drops it from the reason
  const st = { ...fresh(), seen: ['plastic'] }, r = RECIPES.purifier && Object.keys(RECIPES.purifier.cost);
  if (r && r.length > 1) assert.doesNotMatch(SR.lockGate(st, 'purifier')?.reason ?? '', /Plastic/);
});

test('CRA3-1: the storage module and content layer expose craftGate; the bag gate merges both systems', () => {
  assert.match(src('storage-research.js'), /craftGate: recipe => lockGate\(st, recipe\)/);
  assert.match(src('content.js'), /craftGate: recipe => first\('craftGate', recipe\)/);
  const g = src('game.js');
  assert.match(g, /recipeGate:id => prog\?\.recipeGate\(id\) \|\| content\?\.craftGate\?\.\(id\) \|\|[^\n]*content\?\.craftLocked\(/);
});

test('CRA3-1: locked recipes are never the opening pick, sort last and are not counted ready', () => {
  const items = [
    { id: 'cup', cat: 'survival', state: 'gated', owned: 0 },
    { id: 'palm', cat: 'survival', state: 'ready', owned: 0 },
    { id: 'lantern', cat: 'survival', state: 'missing', owned: 0 },
  ];
  assert.equal(CB.openingPick(items).id, 'palm');
  assert.deepEqual(CB.sortByCraftable(items), ['palm', 'lantern', 'cup']);
  const ui = src('survival-ui.js');
  assert.match(ui, /if \(g\?\.locked\) return \{ rows, state: 'gated'/, 'evaluate: the gate wins over materials');
  assert.match(ui, /if \(state === 'ready'\) readyPer\.set/, 'tab badges count only ready rows');
});

test('CRA3-1: a refused craft stops the hold (host/solo at once, guest after a round trip)', () => {
  const g = src('game.js');
  assert.match(g, /function craft\(recipe\) \{[\s\S]{0,500}if \(role === 'guest'\) return sent \? undefined : false;\s*return !!kind && !!bag && bag\.count\(kind\) > before;/);
  const ui = src('survival-ui.js');
  assert.match(ui, /if \(r === false\) return false;/);
  assert.match(ui, /hold\.sent = \{ kind, had, t: performance\.now\(\) \}/);
  assert.match(ui, /function unconfirmed\(now\)[\s\S]{0,200}countOf\(bag, s\.kind\) <= s\.had/);
  assert.match(ui, /if \(unconfirmed\(now\)\) \{[^\n]*stopHold\(\)/);
  // the first press of a hold that crafts nothing shows no "x1"
  assert.match(ui, /if \(!craftNow\(pickId\)\) \{ hold = null; denyBtn\(\);/);
});

test('CRA3-2: storage-research no longer restyles, reorders or disables bag rows', () => {
  const css = src('storage-research-ui.js');
  assert.doesNotMatch(css, /\.sv-recipe\[data-locked\]/);
  assert.doesNotMatch(css, /[;{]order:\s*\d/, 'no CSS reordering: keyboard order = visual order');
  assert.doesNotMatch(css, /lr-sr-first::before/, '::before belongs to survival-ui (ready bar)');
  assert.match(css, /lr-sr-first::after\{[^}]*bottom:auto[^}]*width:auto/);
  assert.doesNotMatch(css, /dataset\.locked = '1'/);
  assert.doesNotMatch(css, /setAttr\(el, 'tabindex', '-1'\)/);
});

test('CRA3-2: the locked header and the "N more" banner follow the rows on screen', () => {
  const ui = src('storage-research-ui.js');
  assert.match(ui, /const shownRows = \(\) => \[\.\.\.\(inv\?\.querySelectorAll\('\.sv-rlist>\.sv-recipe\[data-recipe\]:not\(\[hidden\]\)'\)/);
  assert.match(ui, /gated = shown\.filter\(isGated\), first = gated\[0\]/);
  assert.match(ui, /const n = gated\.length/);
  assert.match(ui, /shownRows\(\)\.find\(isGated\)\?\.scrollIntoView/);
  // re-annotates when the tab, the search or the order changes, not only on storage revisions
  assert.match(ui, /key \+= shown\[i\]\.dataset\.recipe/);
});

test('CRA3-3: every item kind has a real flat drawing (no blank tile)', () => {
  for (const k of Object.keys(ITEM_INFO)) {
    const svg = SU.iconSVG(k);
    assert.doesNotMatch(svg, /sv-blank/, k + ' is blank');
    assert.ok(/<use href="[^"]*#icon-/.test(svg) || svg.length > 200, k + ' has a drawing');
  }
  // their own drawing (or their own icons.svg symbol), never a borrowed sprite
  for (const k of ['seed', 'water']) assert.doesNotMatch(SU.iconSVG(k), /<use/, k);
  assert.match(SU.iconSVG('receiver'), /#icon-receiver"|<g /, 'receiver');
});

test('CRA3-3: station and instrument models are cached per kind and bag kinds render first', async () => {
  const I = await import(new URL('item-icons.js', base));
  for (const k of ['receiver', 'antenna', 'purifier', 'rainbarrel', 'sprinkler', 'smelter', 'researchtable', 'grill', 'beehive', 'flowerbox', 'candle', 'drum', 'pipes', 'bells', 'research']) {
    assert.ok(I.STATION_KINDS.includes(k), k);
    const a = I.stationModel(k);
    assert.ok(a && a.isObject3D, k + ' builds');
    assert.equal(I.stationModel(k), a, k + ' is built once (shared, never freed)');
    const r = I.resolveIconModel(k);
    assert.equal(r.own, false, k + ' is not disposed by the icon renderer');
  }
  assert.equal(I.stationModel('wood'), null);
  I.warmIcons(['sand', 'stone', 'clay']);
  I.warmIcons(['clay'], true);
  assert.equal(I.queuedIcons()[0], 'clay', 'a bag kind jumps the queue');
  assert.match(src('survival-ui.js'), /warmBag\(\);\s*warmIcons\(Object\.keys\(ITEM_INFO/);
});

test('CRA3-4: the pin tracker checks the lock, repaints on lock changes and wraps long names', () => {
  const ui = src('survival-ui.js');
  assert.match(ui, /const g = gate\(r\.id\);/);
  assert.match(ui, /\(g \? \(g\.hidden \? 'h' : 'l'\) \+ \(g\.reason \|\| ''\) : ''\)/, 'the tracker key carries the lock');
  assert.match(ui, /trackerView\(r, k => countOf\(bag, k\), check, g\)/, 'a locked recipe is never "Ready"');
  assert.match(ui, /: locked \? 'Locked'/);
  assert.match(ui, /class="ct-why"/);
  assert.match(ui, /#craftTracker li span\{min-width:0;[^\n]*-webkit-line-clamp:2/);
  assert.doesNotMatch(ui, /#craftTracker li span\{[^\n]*text-overflow:ellipsis/);
  const CBt = CB.trackerView({ id: 'cup', name: 'Cup', out: { kind: 'cup', count: 1 }, reqs: [{ kind: 'plastic', count: 1 }] }, () => 5, null, { locked: true, reason: 'Research Plastic at a Tinker’s Desk' });
  assert.equal(CBt.state, 'gated');
});

test('CRA3-5: item text has one seed entry and no stale Filter Cup', () => {
  const cb = src('craft-book.js');
  assert.equal((cb.match(/^\s*seed:\s*\{/gm) || []).length, 1);
  assert.doesNotMatch(cb, /Filter Cup/);
  assert.doesNotMatch(src('farming.js'), /Filter Cup/);
  assert.match(CB.ITEM_TEXT.researchtable.desc, /not the Tinker/);
});
