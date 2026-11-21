// Crafting UX round 5: no spare Hook picked or badged for a new player, 3D icons ready before the bag
// shows them, and no tooltip popping over the recipe detail when the bag opens under a resting cursor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const CB = await import(new URL('craft-book.js', base));
const { RECIPES, ITEM_INFO, Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const src = f => readFileSync(new URL(f, base), 'utf8');

const normRecipes = () => Object.values(RECIPES).map(r => ({
  id: r.id, name: r.name, out: { ...r.output }, reqs: Object.entries(r.cost).map(([kind, count]) => ({ kind, count })),
}));
const bagWith = counts => {
  const s = new Array(SLOT_COUNT).fill(null);
  Object.entries(counts).forEach(([kind, count], i) => { s[i] = { kind, count }; });
  return new Bag({ slots: s, selected: 0 });
};
// The same view shape survival-ui builds: state, rows and the spare flag.
const viewsFor = (bag, recipes) => recipes.map(r => {
  const rows = CB.ingredientRows(r.reqs, k => bag.count(k));
  return { id: r.id, rows, state: CB.recipeState(rows, bag.canCraft(r.id)), spare: CB.isSpareTool(r.out.kind, bag.count(r.out.kind), ITEM_INFO[r.out.kind]) };
});
const tab = id => CB.groupRecipes(normRecipes(), ITEM_INFO).find(g => g.id === id).recipes;

test('isSpareTool: only a second copy of a one-per-slot tool you carry', () => {
  assert.equal(CB.isSpareTool('hook', 1, ITEM_INFO.hook), true);
  assert.equal(CB.isSpareTool('hook', 0, ITEM_INFO.hook), false, 'none carried: not a spare');
  assert.equal(CB.isSpareTool('hammer', 1, ITEM_INFO.hammer), true);
  assert.equal(CB.isSpareTool('rope', 5, ITEM_INFO.rope), false, 'stacking materials are never spares');
  assert.equal(CB.isSpareTool('cup', 2, ITEM_INFO.cup), false, 'non-tools are never spares');
  assert.equal(CB.isSpareTool('hook', 1), true, 'tool list fallback without item info');
  assert.equal(CB.isSpareTool('mystery', 3), false);
});

test('new player with a Hook: the tools tab picks the Hammer, not a second Hook', () => {
  const bag = bagWith({ hook: 1 });
  const starter = tab('tools').filter(r => ['hook', 'hammer', 'fishingrod'].includes(r.id)); // others are research-gated in game
  const views = CB.sortCraftableFirst(viewsFor(bag, starter));
  assert.equal(views.find(v => v.id === 'hook').spare, true);
  assert.notEqual(views[0].id, 'hook', 'the spare Hook sinks below the other missing tools');
  assert.equal(CB.autoPick(views), 'hammer');
  assert.equal(CB.usefulReady(views), 0);
});

test('ready spare Hook: no badge, and the bag opens on what is new to craft', () => {
  const bag = bagWith({ hook: 1, wood: 12, leaf: 6, plastic: 4 });
  const tools = CB.sortCraftableFirst(viewsFor(bag, tab('tools')));
  const hook = tools.find(v => v.id === 'hook');
  assert.equal(hook.state, 'ready');
  assert.equal(CB.usefulReady(tools), 0, 'a spare Hook does not badge the tools tab');
  const mats = CB.sortCraftableFirst(viewsFor(bag, tab('materials')));
  assert.ok(CB.usefulReady(mats) >= 1, 'rope is craftable');
  assert.equal(CB.autoPick(mats), 'rope');
  // With no hook in the bag, crafting one is useful again and leads the tab.
  const fresh = CB.sortCraftableFirst(viewsFor(bagWith({ wood: 12, plastic: 4 }), tab('tools')));
  assert.equal(fresh[0].id, 'hook');
  assert.equal(CB.autoPick(fresh), 'hook');
  assert.equal(CB.usefulReady(fresh), 1);
});

test('sortCraftableFirst: a ready spare stays above blocked rows; autoPick falls back in order', () => {
  const row = (need, have) => ({ need, have, enough: have >= need, short: Math.max(0, need - have) });
  const views = [
    { id: 'miss', state: 'missing', rows: [row(2, 0)] },
    { id: 'spareMiss', state: 'missing', rows: [row(1, 0)], spare: true },
    { id: 'full', state: 'full', rows: [row(1, 1)] },
    { id: 'spareReady', state: 'ready', rows: [row(1, 1)], spare: true },
    { id: 'ready', state: 'ready', rows: [row(1, 3)] },
  ];
  assert.deepEqual(CB.sortCraftableFirst(views).map(v => v.id), ['ready', 'spareReady', 'full', 'miss', 'spareMiss']);
  assert.equal(CB.autoPick(views), 'ready');
  assert.equal(CB.autoPick([{ id: 's', state: 'ready', spare: true }, { id: 'g', state: 'gated' }]), 's', 'only a spare left: still picked');
  assert.equal(CB.autoPick([{ id: 'g', state: 'gated' }]), 'g');
  assert.equal(CB.autoPick([{ r: { id: 'x' }, state: 'missing' }]), 'x', 'survival-ui views carry the recipe on r');
  assert.equal(CB.autoPick([]), null);
  assert.equal(CB.usefulReady(null), 0);
});

test('craftKinds lists outputs and ingredients once, in book order', () => {
  const rs = [{ out: { kind: 'hook' }, reqs: [{ kind: 'wood' }, { kind: 'plastic' }] }, null, { out: { kind: 'rope' }, reqs: [{ kind: 'leaf' }, { kind: 'wood' }] }];
  assert.deepEqual(CB.craftKinds(rs), ['hook', 'wood', 'plastic', 'rope', 'leaf']);
  assert.deepEqual(CB.craftKinds(null), []);
  const all = CB.craftKinds(normRecipes());
  for (const k of ['hook', 'hammer', 'rope', 'wood', 'leaf', 'plastic']) assert.ok(all.includes(k), k);
});

test('survival-ui wires spares into badges, rows, the auto pick and the opening tab', () => {
  const s = src('survival-ui.js');
  assert.match(s, /v\.spare = isSpareTool\(r\.out\.kind, countOf\(bag, r\.out\.kind\)/);
  assert.match(s, /if \(state === 'ready' && !v\.spare\) readyPer\.set/, 'tab badge counts useful recipes only');
  assert.match(s, /state === 'ready' && !v\.spare && Number\.isFinite\(times\)/, 'no ×N badge on a spare');
  assert.match(s, /pickId = autoPick\(inTab\)/);
  assert.match(s, /\(v\.spare \? 's' : ''\)/, 'a row repaints when it becomes or stops being a spare');
  const open = s.slice(s.indexOf('function open()'), s.indexOf('function close()'));
  const sw = open.indexOf('if (!pickedByUser && !tabByUser)');
  assert.ok(sw > open.indexOf('reorderRecipes()') && sw < open.lastIndexOf('applyTab()'), 'tab chosen after states are known, before the pick');
  assert.match(open, /groups\.find\(x => usefulReady\(inTab\(x\.id\)\)\)/);
  assert.match(s, /function setTab\(id, focus = false\) \{\n[^\n]*return;\n\s*tabByUser = true;/, 'a tab the player chose is kept');
});

test('icons: the crafting panel is warmed at play start and primed before the bag paints', () => {
  const s = src('survival-ui.js');
  const live = s.slice(s.indexOf('function liveIcons()'), s.indexOf('function warmAll()'));
  assert.match(live, /warmIcons\(craftKinds\(/, 'recipe icons queued on the first play frame, not 5 s later');
  assert.match(s, /if \(isOpen && !opening\) primeTab\(inTab\)/, 'tab icons primed once the final tab is chosen');
  assert.match(s, /pre\.onload = pre\.onerror = swap/, 'flat art stays until the 3D image has loaded');
  assert.match(s, /decoding="sync"/);
  const ic = src('item-icons.js');
  const prime = ic.slice(ic.indexOf('export function primeIcons'), ic.indexOf('export function onIconReady'));
  assert.match(prime, /if \(!hostGL \|\| failed\) return 0/, 'never opens a second WebGL context');
  assert.match(prime, /performance\.now\(\) - t0 >= budgetMs\) \{ request\(k, true\)/, 'over budget: back to the idle queue');
});

test('primeIcons is a no-op without the game renderer', async () => {
  const icons = await import(new URL('item-icons.js', base));
  assert.equal(icons.primeIcons(['hook', 'wood'], 50), 0);
  assert.equal(icons.primeIcons(null), 0);
});

// Tooltip arming, driven through item-tooltips.js with a tiny fake DOM.
function fakeEl(tag) {
  const attrs = {}, cls = new Set();
  const el = {
    tagName: tag, hidden: false, style: {}, dataset: {}, innerHTML: '', textContent: '', offsetWidth: 100, offsetHeight: 50, parentNode: null, id: '',
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle: (c, on) => (on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c) },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; }, removeAttribute(k) { delete attrs[k]; },
    append(c) { c.parentNode = el; }, remove() { el.parentNode = null; },
    closest() { return null; }, contains(o) { return o === el; }, matches() { return false; },
    getBoundingClientRect: () => ({ left: 10, top: 10, right: 50, bottom: 50, width: 40, height: 40 }),
  };
  return el;
}

test('tooltips wait for the mouse to move after a key press (bag opening under a resting cursor)', async () => {
  const { installItemTooltips } = await import(new URL('item-tooltips.js', base));
  const listeners = new Map();
  const doc = {
    head: fakeEl('head'), body: fakeEl('body'), ownerDocument: null, defaultView: { addEventListener() {} },
    createElement: t => fakeEl(t), getElementById: () => null, querySelector: () => null,
    addEventListener(t, fn) { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(fn); },
  };
  const fire = (t, e = {}) => { for (const fn of listeners.get(t) || []) fn(e); };
  const g = globalThis;
  const saved = { innerWidth: g.innerWidth, innerHeight: g.innerHeight, raf: g.requestAnimationFrame };
  g.innerWidth = 1280; g.innerHeight = 720; g.requestAnimationFrame = () => 0;
  try {
    const tt = installItemTooltips({ root: doc, getBag: () => null, items: { hook: { name: 'Hook' } } });
    const slot = fakeEl('div');
    slot.dataset.itemKind = 'hook'; slot.setAttribute('data-item-kind', 'hook');
    slot.closest = sel => (String(sel).includes('dialog') ? null : slot);
    // Find the card through the element it is appended to.
    let card = null;
    const origAppend = doc.body.append;
    doc.body.append = c => { card = c; origAppend(c); };
    fire('pointerover', { target: slot, clientX: 20, clientY: 20 });
    assert.ok(card && card.hidden === false, 'hover shows the card normally');
    fire('pointerout', { target: slot, relatedTarget: null });
    assert.equal(card.hidden, true);
    fire('keydown', { key: 'Tab' });
    fire('pointerover', { target: slot, clientX: 20, clientY: 20 });
    assert.equal(card.hidden, true, 'no card for a resting cursor right after a key press');
    fire('mousemove', { target: slot, movementX: 0, movementY: 0 });
    assert.equal(card.hidden, true, 'a synthetic zero-movement event does not count');
    fire('mousemove', { target: slot, movementX: 3, movementY: 1, clientX: 23, clientY: 21 });
    assert.equal(card.hidden, false, 'the first real move shows the card for what is under the pointer');
    fire('pointerout', { target: slot, relatedTarget: null });
    fire('keydown', { key: 'i' });
    fire('pointerdown', {});
    fire('pointerover', { target: slot, clientX: 20, clientY: 20 });
    assert.equal(card.hidden, false, 'a tap or click re-arms the card');
    tt?.dispose?.();
  } finally {
    g.innerWidth = saved.innerWidth; g.innerHeight = saved.innerHeight; g.requestAnimationFrame = saved.raf;
  }
});
