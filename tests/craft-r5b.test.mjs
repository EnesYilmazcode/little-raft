// Crafting round 5b: the bag works from the keyboard (C1), the backpack stays on screen at 800x600 (C2),
// every recipe has its own tab (C3), counts read as need/have (U5), recipe rows get no covering card (U6)
// and a held craft reports its progress and result (U7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const CB = await import(new URL('craft-book.js', base));
const { RECIPES } = await import(new URL('inventory-state.js', base));
const src = f => readFileSync(new URL(f, base), 'utf8');
const ui = src('survival-ui.js');

// ---- C1 keyboard ----
test('C1: Tab closes the open bag but Shift+Tab does not', () => {
  assert.equal(CB.bagKeyAction('Tab', true), 'close');
  assert.equal(CB.bagKeyAction('Tab', true, false), 'close');
  assert.equal(CB.bagKeyAction('Tab', true, true), null, 'Shift+Tab walks focus backwards inside the bag');
  assert.equal(CB.bagKeyAction('Tab', false, true), 'open');
  assert.equal(CB.bagKeyAction('KeyE', true, true), 'close');
  assert.match(ui, /bagKeyAction\(e\.code, isOpen, e\.shiftKey\)/, 'the game passes the shift state');
});

test('C1: the in-panel hint names the keys that really work', () => {
  const hint = ui.match(/const HINT = '([^']*)'/)?.[1] ?? '';
  assert.ok(hint.endsWith(CB.BAG_KEYS_HINT), 'hint carries the craft-book key help');
  assert.match(CB.BAG_KEYS_HINT, /Arrow keys move between recipes and slots/);
  assert.match(CB.BAG_KEYS_HINT, /Enter crafts/);
  assert.match(CB.BAG_KEYS_HINT, /Tab, E, I or Esc closes/);
});

test('C1: arrows from the panel itself enter the recipe list or the backpack; Enter crafts a recipe', () => {
  const kd = ui.slice(ui.indexOf("const ARROW_CODES"), ui.indexOf("// Keep scroll inside the panel"));
  assert.ok(kd.length > 200, 'found the panel key handler');
  assert.match(kd, /e\.target === wrap \|\| e\.target === dlg/, 'arrows act while the wrap (open() focus) has focus');
  assert.match(kd, /pickedRow\(\) : firstSlot\(\)/, 'Up/Down -> picked recipe, Left/Right -> first slot');
  assert.match(kd, /rec && \(e\.code === 'Enter' \|\| e\.code === 'NumpadEnter' \|\| e\.code === 'Space'\)[\s\S]*?setPick\(rec\.dataset\.recipe\);\s*startHold\(\);/, 'Enter / Space crafts the focused recipe');
  assert.match(kd, /keyup[\s\S]*?stopHold\(\)/, 'releasing the key ends the hold');
  assert.match(ui, /wrap\.focus\(\{ preventScroll: true \}\)/, 'open() still focuses the panel');
});

// ---- C2 layout ----
test('C2: side by side down to 760px wide, stacked (backpack first) below that', () => {
  assert.match(ui, /@media\(min-width:760px\) and \(max-width:1000px\) and \(min-height:521px\)\{#inventory\.sv-inv\{--s:min\(56px,calc\(\(96vw - 374px\) \/ 10 - 1px\)\)/);
  assert.match(ui, /@media\(max-width:759px\),\(max-height:520px\)\{[^\n]*#inventory \.sv-bag\{min-width:0;order:-1\}/);
  assert.doesNotMatch(ui, /@media\(max-width:860px\),\(max-height:520px\)/, 'the old 860px stacking breakpoint is gone');
  // Width budget at 800px: 2*10 padding + 4 border + 10 gap + 280 craft + 24 bag padding + 9*4 gaps + 10 slots.
  const vw = 800, s = Math.min(56, (0.96 * vw - 374) / 10 - 1);
  assert.ok(s >= 36, `slots stay usable at 800px (${s.toFixed(1)}px)`);
  assert.ok(20 + 4 + 10 + 280 + 24 + 36 + 10 * s <= 0.96 * vw, 'fits inside the dialog max-width');
});

// ---- C3 categories ----
test('C3: every hand recipe output has an explicit category', () => {
  const ids = new Set(CB.CATEGORIES.map(c => c.id));
  const missing = Object.values(RECIPES).map(r => r.output.kind).filter(k => !Object.hasOwn(CB.CATEGORY_OF, k));
  assert.deepEqual([...new Set(missing)], [], 'no recipe falls back to Building by accident');
  for (const k of Object.values(CB.CATEGORY_OF)) assert.ok(ids.has(k), k);
});

test('C3: water gear and seeds are Survival; signal gear is Building', () => {
  for (const k of ['cup', 'purifier', 'water', 'freshcup', 'saltcup', 'seed']) assert.equal(CB.categoryOf(k), 'survival', k);
  assert.equal(CB.categoryOf('palm'), 'survival', 'seeds share the farming tab with the planter');
  for (const k of ['receiver', 'antenna']) assert.equal(CB.categoryOf(k), 'building', k);
  const glass = Object.values(RECIPES).find(r => r.id === 'glasscups');
  if (glass) assert.equal(CB.categoryOf(glass.output.kind), 'survival', 'glass cups');
});

// ---- U5 counts, icons, wrapping ----
test('U5: ingredient counts read need then have, not "12 / 1"', () => {
  const [row] = CB.ingredientRows([{ kind: 'wood', count: 1 }], () => 12);
  assert.equal(CB.needHaveLabel(row), 'need 1 · have 12');
  assert.match(ui, /e\.amt\.textContent = needHaveLabel\(row\)/, 'detail card');
  assert.match(ui, /<b>\$\{esc\(needHaveLabel\(x\)\)\}<\/b>/, 'pinned tracker');
  assert.doesNotMatch(ui, /amountLabel\(/, 'the ambiguous label is no longer shown');
});

test('U5: ingredient icons are full opacity on their own tile; locked text wraps to two lines', () => {
  const ing = ui.match(/#inventory \.sv-ing>\.sv-icon\{[^}]*\}/)?.[0] ?? '';
  assert.match(ing, /opacity:1/);
  assert.match(ing, /background:#b89f6e/);
  const wrapRule = ui.match(/#inventory \.sv-locked \.sv-rsub,#inventory \.sv-full \.sv-rsub\{[^}]*\}/)?.[0] ?? '';
  assert.match(wrapRule, /white-space:normal/);
  assert.match(wrapRule, /-webkit-line-clamp:2/);
});

// ---- U6 tooltip ----
test('U6: crafting recipe rows get no hover card over the detail counts', () => {
  const tt = src('item-tooltips.js');
  assert.match(tt, /if \(el\.dataset\.recipe != null && el\.closest\?\.\('#inventory \.sv-craft'\)\) return null;/);
  assert.match(ui, /if \(el\.classList\.contains\('sv-recipe'\)\) \{ hideTip\(\); return; \}/, 'nor the panel’s own card');
});

test('U6: item-tooltips shows nothing for a crafting row but still for other recipe rows', async () => {
  const { installItemTooltips } = await import(new URL('item-tooltips.js', base));
  const listeners = new Map();
  const mk = () => {
    const attrs = {}, cls = new Set();
    const el = { hidden: false, style: {}, dataset: {}, innerHTML: '', offsetWidth: 100, offsetHeight: 50, parentNode: null, id: '',
      classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) },
      setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; }, removeAttribute(k) { delete attrs[k]; },
      append(c) { c.parentNode = el; }, remove() { el.parentNode = null; }, closest() { return null; }, contains(o) { return o === el; }, matches() { return false; },
      getBoundingClientRect: () => ({ left: 10, top: 10, right: 50, bottom: 50, width: 40, height: 40 }) };
    return el;
  };
  const doc = { head: mk(), body: mk(), ownerDocument: null, defaultView: { addEventListener() {} }, createElement: () => mk(), getElementById: () => null, querySelector: () => null,
    addEventListener(t, fn) { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(fn); } };
  const fire = (t, e) => { for (const fn of listeners.get(t) || []) fn(e); };
  let card = null; doc.body.append = c => { card = c; c.parentNode = doc.body; };
  const g = globalThis, saved = { w: g.innerWidth, h: g.innerHeight, raf: g.requestAnimationFrame };
  g.innerWidth = 1280; g.innerHeight = 720; g.requestAnimationFrame = () => 0;
  try {
    const tt = installItemTooltips({ root: doc, getBag: () => null, items: { hook: { name: 'Hook', recipe: { cost: { wood: 1 } } } } });
    const row = (inCraft) => { const el = mk(); el.dataset.recipe = 'hook'; el.dataset.tipKind = 'hook';
      el.closest = sel => (String(sel).includes('.sv-craft') ? (inCraft ? el : null) : String(sel).includes('dialog') ? null : el); return el; };
    fire('pointerover', { target: row(false), clientX: 20, clientY: 20 });
    assert.ok(card && card.hidden === false, 'a recipe row elsewhere still gets its card');
    fire('pointerover', { target: row(true), clientX: 20, clientY: 20 });
    assert.equal(card.hidden, true, 'no card on a crafting-panel row');
    tt.dispose();
  } finally { g.innerWidth = saved.w; g.innerHeight = saved.h; g.requestAnimationFrame = saved.raf; }
});

// ---- U7 hold feedback ----
test('U7: hold wording and running count', () => {
  assert.equal(CB.holdHint(5), 'Hold to craft up to 5');
  assert.doesNotMatch(CB.holdHint(5), /hold:/);
  assert.equal(CB.holdLabel(2, 4), 'Crafting 2/4…');
  assert.equal(CB.holdLabel(4, 0, false), 'Crafted 4 ✓');
});

test('U7: after a batch the button keeps "Crafted N ✓" instead of "Missing materials"', () => {
  const done = { id: 'rope', n: 4 };
  assert.deepEqual(CB.idleButton('missing', 'rope', done), { text: 'Crafted 4 ✓', done: true }, 'materials ran out: success stays');
  assert.deepEqual(CB.idleButton('full', 'rope', done), { text: 'Crafted 4 ✓', done: true });
  assert.deepEqual(CB.idleButton('ready', 'rope', done, true), { text: 'Crafted 4 ✓', done: true }, 'short flash even when more can be made');
  assert.deepEqual(CB.idleButton('ready', 'rope', done, false), { text: 'Craft', done: false }, 'then back to Craft');
  assert.deepEqual(CB.idleButton('missing', 'nail', done), { text: 'Missing materials', done: false }, 'another recipe picked');
  assert.deepEqual(CB.idleButton('missing', 'rope', null), { text: 'Missing materials', done: false });
  assert.deepEqual(CB.idleButton('gated', 'rope', null), { text: 'Locked', done: false });
  assert.match(ui, /lastDone = made > 0 \? \{ id: hold0, n: made \* out \} : null;/, 'stopHold remembers the batch');
  assert.match(ui, /idleButton\(v\.state, pickId, lastDone, performance\.now\(\) < flashUntil\)/, 'paintDetail uses it');
  assert.match(ui, /flashUntil = 0; lastDone = null; pickId = id;/, 'picking another recipe clears it');
});
