// Regression tests for crafting / bag fixes (CRAFT-1..6).
// Run: node --test tests/craft-fixes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(fileURLToPath(new URL(f, base)), 'utf8');
const ITEMS_MOD = await import(new URL('items.js', base));
const INV = await import(new URL('inventory-state.js', base));

test('CRAFT-5: migrateSnapshot keeps bag kinds that are not in ITEMS', () => {
  const extra = INV.ITEM_KINDS.filter(k => !ITEMS_MOD.isItem(k));
  assert.ok(extra.includes('cup') && extra.includes('receiver'), 'test premise: bag knows kinds ITEMS does not');
  const slots = new Array(INV.SLOT_COUNT).fill(null);
  extra.forEach((k, i) => { slots[i] = { kind: k, count: 1 }; });
  slots[extra.length] = { kind: 'cup', count: 9 }; // over the cup stack of 5
  const m = ITEMS_MOD.migrateSnapshot({ slots, selected: 0 }, INV.ITEM_INFO);
  const bag = new INV.Bag(m);
  for (const k of extra) assert.ok(bag.count(k) >= 1, `${k} kept`);
  assert.equal(bag.count('cup'), 10, 'overflowing cups top up / spill, none lost');
  for (const s of bag.snapshot().slots) if (s) assert.ok(s.count <= INV.ITEM_INFO[s.kind].maxStack, `${s.kind} stack clamped`);
  // Without the table the old behaviour stands (unknown kinds dropped), and junk is still dropped with it.
  assert.equal(ITEMS_MOD.migrateSnapshot({ slots }).slots.filter(Boolean).length, 0);
  assert.equal(ITEMS_MOD.migrateSnapshot({ slots: [{ kind: 'nope', count: 3 }, { kind: 'toString', count: 1 }] }, INV.ITEM_INFO).slots.filter(Boolean).length, 0);
  assert.match(src('game.js'), /migrateSnapshot\(s, ITEM_INFO\)/, 'snapBag passes the bag info table');
});

const CB = await import(new URL('craft-book.js', base));

test('CRAFT-1: the bag UI gate folds in content (research) locks and craft() reports refusals', () => {
  const g = src('game.js');
  assert.match(g, /recipeGate:id => craftGate\(id\)/, 'survival UI asks craftGate');
  const fn = g.slice(g.indexOf('function craftGate('), g.indexOf('function craft(recipe)'));
  assert.match(fn, /prog\?\.recipeGate\(id\)/, 'progression gate first');
  assert.match(fn, /content\?\.craftLocked\(id/, 'then content craftLocked');
  assert.match(fn, /locked:true, reason/, 'content lock becomes {locked, reason}');
  assert.match(g, /function craft\(recipe\) \{[^\n]*return !g; \}/, 'craft() returns false when gated');
  const s = src('survival-ui.js');
  assert.match(s, /if \(g\?\.locked\) return \{ rows, state: 'gated'/, 'evaluate: gated beats ready');
  assert.match(s, /if \(r === false\) return false;/, 'craftNow: a refused craft is not counted');
  assert.match(s, /v\.state !== 'gated' \|\| v\.el === rec/, 'arrow keys skip locked rows');
  assert.match(s, /inTab\.find\(v => v\.state !== 'gated'\)/, 'auto-pick prefers an unlocked row');
});

test('CRAFT-2: the pinned tracker shows a locked recipe as locked', () => {
  const r = { id: 'cup', name: 'Cup', out: { kind: 'cup', count: 1 }, reqs: [{ kind: 'plastic', count: 2 }] };
  const have = () => 10;
  assert.equal(CB.trackerView(r, have).state, 'ready');
  const tv = CB.trackerView(r, have, null, { locked: true, reason: 'Study it first' });
  assert.equal(tv.state, 'gated');
  assert.equal(tv.reason, 'Study it first');
  assert.equal(tv.times, 0);
  assert.equal(CB.trackerView(r, have, null, { hidden: true }).state, 'gated');
  assert.equal(CB.trackerView(r, have, null, null).state, 'ready');
  const s = src('survival-ui.js');
  const fn = s.slice(s.indexOf('function paintTracker('), s.indexOf('function reorderRecipes('));
  assert.match(fn, /trackerView\(r, k => countOf\(bag, k\), check, g\)/, 'tracker passes the gate');
  assert.match(fn, /'Locked: ' \+/, 'tracker says Locked: reason');
  assert.match(fn, /const key = sig \+ '\|' \+ pinId \+ '\|' \+ \(g \?/, 'gate change repaints the tracker');
});

test('CRAFT-6: an open bag rebuilds its recipes when gates change', () => {
  const s = src('survival-ui.js');
  assert.match(s, /function gateSignature\(\)/);
  const sync = s.slice(s.indexOf('function syncGates('), s.indexOf('function render('));
  assert.match(sync, /if \(gs === gateSig\) return false;/);
  assert.match(sync, /buildRecipes\(\);/);
  const render = s.slice(s.indexOf('function render('), s.indexOf('function canOpenNow('));
  assert.match(render, /if \(isOpen && !dragging && syncGates\(performance\.now\(\)\)\) \{ force = true; lastSig = null; \}/, 'checked before the fast path');
  assert.ok(render.indexOf('syncGates(') < render.indexOf('shadowSame(bag.slots, false)'), 'not skipped by the unchanged-bag fast path');
  assert.match(s, /buildRecipes\(\);\n\s*gateSig = gateSignature\(\);/, 'open() records the gates it built with');
});

// ---- item-tooltips.js with a minimal fake DOM ----
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
const kindEl = kind => { const el = fakeEl(); el.dataset.itemKind = kind; return el; };

test('CRAFT-4: no "Locked" line for kinds outside the item catalogue', () => {
  const doc = fakeDoc();
  const prog = { isUnlocked: () => false, whyLocked: k => (ITEMS_MOD.isItem(k) ? 'Research it' : 'Unknown item') };
  const tt = TT.installItemTooltips({ getBag: () => null, getProgression: () => prog, root: doc });
  assert.ok(!ITEMS_MOD.isItem('research'), 'test premise: the Tinker’s Desk is not a catalogue item');
  doc.hover(kindEl('research'));
  assert.ok(doc.tip() && !doc.tip().hidden, 'card shown');
  assert.doesNotMatch(doc.tip().innerHTML, /it-lock|Unknown item/);
  doc.hover(kindEl('bolt'));
  assert.match(doc.tip().innerHTML, /class="it-lock">Locked: Research it/, 'catalogue items still show their lock');
  doc.hover(kindEl('toString'));
  assert.doesNotMatch(doc.tip().innerHTML, /it-lock/, 'prototype keys are not catalogue items');
  tt.dispose();
});

test('CRAFT-3: the open card re-reads the bag when survival-ui reports a change', () => {
  const doc = fakeDoc();
  const slots = new Array(INV.SLOT_COUNT).fill(null);
  slots[3] = { kind: 'leaf', count: 10 };
  const bag = { slots };
  const tt = TT.installItemTooltips({ getBag: () => bag, getProgression: () => null, root: doc });
  const slotEl = fakeEl(); slotEl.dataset.index = '3';
  doc.hover(slotEl);
  assert.match(doc.tip().innerHTML, /10 \/ \d+ in stack/);
  slots[3] = { kind: 'leaf', count: 4 };
  doc.fire('littleraft:bagchange');
  assert.match(doc.tip().innerHTML, /4 \/ \d+ in stack/, 'count updated without moving the pointer');
  slots[3] = null;
  doc.fire('littleraft:bagchange');
  assert.equal(doc.tip().hidden, true, 'an emptied slot hides the card');
  const s = src('survival-ui.js');
  assert.match(s, /export const BAG_EVENT = 'littleraft:bagchange';/);
  assert.match(s, /document\.dispatchEvent\(new CustomEvent\(BAG_EVENT\)\)/);
  tt.dispose();
});
