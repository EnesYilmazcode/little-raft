// Crafting UI review round 3: one live check at a time, one tooltip instance, crafting cards kept out of the
// screen centre, and the equipment row as a view over the bag.
// Run: node --test tests/crafting-v3.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(fileURLToPath(new URL(f, base)), 'utf8');
const CB = await import(new URL('craft-book.js', base));
const INV = await import(new URL('inventory-state.js', base));
const GEARC = await import(new URL('diving-gear-core.js', base));

// ---------------------------------------------------------------- 1. live swap race
test('live.js runs one update check at a time; overlapping callers share it', () => {
  const live = src('live.js');
  assert.match(live, /let inflight = null;\s*function check\(\) \{\s*if \(inflight\) return inflight;\s*inflight = checkOnce\(\)\.finally\(\(\) => \{ inflight = null; \}\);/);
  // the guard is set before the manifest fetch (state.updating is only set inside swap())
  const once = live.slice(live.indexOf('async function checkOnce()'));
  assert.ok(once.indexOf('state.updating || state.booting') < once.indexOf('await fetchManifest()'));
  assert.match(live, /async function boot\(\) \{\s*state\.booting = true;\s*try \{ await bootOnce\(\); \} finally \{ state\.booting = false; \}/, 'no swap while the first engine is still booting');
  assert.match(live, /check: \{ value: \(\) => check\(\)/, 'raftLive.check() goes through the guard');
  assert.match(live, /try \{ await check\(\); \}/, 'the poll goes through the guard');
});

// ---------------------------------------------------------------- 1b. one tooltip instance
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
  const listeners = [];
  const sheets = [], tips = [];
  const doc = {
    head: fakeEl('head'), body: fakeEl('body'), ownerDocument: null, defaultView: { addEventListener() {} },
    createElement: t => fakeEl(t), getElementById: () => null, querySelector: () => null,
    addEventListener(t, fn, o) { listeners.push({ t, fn, signal: o?.signal }); },
    fire(t, e = {}) { for (const l of listeners) if (l.t === t && !l.signal?.aborted) l.fn(e); },
  };
  doc.head.append = c => { c.parentNode = doc.head; sheets.push(c); };
  doc.body.append = c => { c.parentNode = doc.body; if (!tips.includes(c)) tips.push(c); };
  doc.liveSheets = () => sheets.filter(s => s.parentNode);
  doc.liveTips = () => tips.filter(t => t.parentNode);
  doc.hover = el => { el.closest = sel => (String(sel).includes('dialog') || String(sel).includes('sv-craft') ? null : el); doc.fire('pointerover', { target: el, clientX: 1, clientY: 1 }); };
  return doc;
}
globalThis.requestAnimationFrame ??= fn => setTimeout(fn, 0);
globalThis.innerWidth ??= 1280; globalThis.innerHeight ??= 720;
const TT = await import(new URL('item-tooltips.js', base));
const kindEl = kind => { const el = fakeEl(); el.dataset.itemKind = kind; return el; };

test('item-tooltips: installing again disposes the previous instance (a live swap that never disposes leaves one card)', () => {
  const doc = fakeDoc();
  const a = TT.installItemTooltips({ getBag: () => null, getProgression: () => null, root: doc });
  doc.hover(kindEl('wood'));
  assert.equal(doc.liveTips().length, 1);
  const b = TT.installItemTooltips({ getBag: () => null, getProgression: () => null, root: doc }); // new engine mounts first
  assert.equal(doc.liveSheets().length, 1, 'one item-tooltips style');
  assert.equal(doc.liveTips().length, 0, 'the old card is gone');
  doc.hover(kindEl('leaf'));
  assert.equal(doc.liveTips().length, 1, 'one card: the old listeners were released');
  a.dispose(); // the old engine's late dispose touches only its own sheet
  assert.equal(doc.liveSheets().length, 1);
  assert.equal(doc.liveSheets()[0].dataset.owner, doc.liveTips()[0].id, 'the sheet that is left belongs to the live card');
  b.dispose();
  assert.equal(doc.liveSheets().length, 0);
  assert.equal(doc.defaultView.__littleRaftItemTooltips, null);
});

test('item-tooltips: a backpack slot whose gear shows in the equipment row has no card', () => {
  const doc = fakeDoc();
  const slots = new Array(INV.SLOT_COUNT).fill(null);
  slots[12] = { kind: 'fins', count: 1 };
  const tt = TT.installItemTooltips({ getBag: () => ({ slots }), getProgression: () => null, root: doc });
  const grid = fakeEl(); grid.dataset.index = '12'; grid.dataset.worn = '';
  doc.hover(grid);
  assert.equal(doc.liveTips().length, 0, 'the empty-looking slot shows nothing');
  const eq = fakeEl(); eq.dataset.slot = '12';
  doc.hover(eq);
  assert.equal(doc.liveTips().length, 1, 'the equipment slot shows the gear');
  tt.dispose();
});

// ---------------------------------------------------------------- 3. crafting cards out of the centre
const R = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
const centred = (p, w, h, vw, vh) => p.x < vw / 2 && p.x + w > vw / 2 && p.y < vh / 2 && p.y + h > vh / 2;

test('craftTip: under the open recipe card at 1536x864, in its column, above the bag', () => {
  const vw = 1536, vh = 864, list = R(14, 14, 314, 772), detail = R(336, 14, 256, 270), bag = R(453, 578, 631, 272);
  const chip = R(348, 150, 52, 64), w = 270, h = 230;
  const p = CB.craftTip(chip, w, h, vw, vh, { list, detail, bag });
  assert.equal(p.side, 'below');
  assert.equal(p.x, detail.left);
  assert.ok(p.y >= detail.bottom && p.y + h <= bag.top, 'between the card and the backpack');
  assert.ok(!centred(p, w, h, vw, vh), 'not over the screen centre');
  const row = R(24, 500, 300, 46);
  assert.deepEqual(CB.craftTip(row, w, 150, vw, vh, { list, detail, bag }), { x: 336, y: 292, side: 'below' }, 'rows use the same spot');
});

test('craftTip: no room under the card at 1229x691 -> chips over the list, rows over the card column; never the centre', () => {
  const vw = 1229, vh = 691, list = R(10, 10, 288, 600), detail = R(306, 10, 240, 330), bag = R(308, 410, 631, 271);
  const chip = R(318, 150, 52, 64), w = 270, h = 230;
  const p = CB.craftTip(chip, w, h, vw, vh, { list, detail, bag });
  assert.equal(p.side, 'list');
  assert.ok(p.x + w <= list.right, 'over the list, clear of the recipe card');
  assert.ok(!centred(p, w, h, vw, vh));
  const row = R(70, 300, 220, 46);
  const q = CB.craftTip(row, w, 150, vw, vh, { list, detail, bag });
  assert.equal(q.side, 'over');
  assert.equal(q.x, detail.left);
  assert.ok(q.x + w < vw / 2 + 1, 'left of the centre');
});

test('craftTip: with no recipe open, level with the hovered row in the card column', () => {
  const vw = 1920, vh = 1080, list = R(17, 17, 377, 800), bag = R(585, 740, 757, 326);
  const row = R(80, 200, 300, 55);
  const p = CB.craftTip(row, 324, 180, vw, vh, { list, detail: null, bag });
  assert.deepEqual(p, { x: list.right + 8, y: 200, side: 'right' });
  assert.equal(CB.craftTip(R(0, 0, 0, 0), 100, 100, vw, vh, { list }), null, 'no box: hide');
});

// ---------------------------------------------------------------- 4. equipment row
const HB = INV.HOTBAR_SIZE, GEAR = new Set(GEARC.GEAR_IDS);
const bagWith = entries => { const b = new INV.Bag(); for (const [i, kind, count = 1] of entries) b.slots[i] = { kind, count }; return b; };

test('equipView: the first gear stacks in the backpack grid, packed from the left; hotbar gear stays on the hotbar', () => {
  const b = bagWith([[2, 'goggles'], [HB + 4, 'fins'], [HB + 1, 'wood', 5], [HB + 9, 'airjug']]);
  assert.deepEqual(CB.equipView(b.slots, GEAR, HB, 5), [HB + 4, HB + 9, -1, -1, -1]);
  assert.deepEqual(CB.equipView(new Array(INV.SLOT_COUNT).fill(null), GEAR, HB, 5), [-1, -1, -1, -1, -1], 'an old save without gear');
  // gear works while carried, wherever it is: the equipment row does not change what is active
  const mask = GEARC.gearMask(k => b.count(k));
  assert.deepEqual(GEARC.maskIds(mask), ['fins', 'airjug', 'goggles']);
});

test('equipTarget / gridTarget: wear from the hotbar, refuse non-gear, keep a dropped stack where it was dropped', () => {
  const b = bagWith([[0, 'fins'], [1, 'wood', 5], [HB, 'goggles'], [HB + 1, 'leaf', 3]]);
  const eq = CB.equipView(b.slots, GEAR, HB, 5); // [HB, -1, ...]
  assert.deepEqual(CB.equipTarget(b.slots, 0, -1, GEAR, HB), { to: HB + 2 }, 'hotbar fins go to the first free backpack slot');
  assert.deepEqual(CB.equipTarget(b.slots, 0, eq[0], GEAR, HB), { to: HB }, 'onto worn goggles: a swap');
  assert.deepEqual(CB.equipTarget(b.slots, 1, -1, GEAR, HB), { refuse: 'Only gear goes there' });
  assert.deepEqual(CB.equipTarget(b.slots, HB, -1, GEAR, HB), { none: true }, 'already worn');
  const worn = new Set(eq.filter(i => i >= 0));
  assert.deepEqual(CB.gridTarget(b.slots, HB + 5, worn, HB), { to: HB + 5 });
  const d = CB.gridTarget(b.slots, HB, worn, HB);
  assert.deepEqual(d, { to: HB, pre: [HB, HB + 2] });
  // what survival-ui sends: the gear steps aside, then the planks land where they were dropped (hotbar source)
  assert.ok(b.move(d.pre[0], d.pre[1]) && b.move(1, d.to));
  assert.equal(b.slots[HB].kind, 'wood');
  assert.equal(b.slots[HB + 2].kind, 'goggles');
  assert.deepEqual(CB.equipView(b.slots, GEAR, HB, 5), [HB + 2, -1, -1, -1, -1], 'still worn');
  // a full backpack: no free slot, so wearing from the hotbar is refused
  const full = new INV.Bag(); for (let i = HB; i < INV.SLOT_COUNT; i++) full.slots[i] = { kind: 'wood', count: 1 }; full.slots[0] = { kind: 'fins', count: 1 };
  assert.deepEqual(CB.equipTarget(full.slots, 0, -1, GEAR, HB), { refuse: 'Backpack full' });
  // the bag snapshot is unchanged in shape: saves and co-op stay compatible
  assert.equal(new INV.Bag(b.snapshot()).slots.length, INV.SLOT_COUNT);
});

test('survival-ui: equipment slots are real drop targets over the bag; worn grid slots read as taken', () => {
  const ui = src('survival-ui.js');
  assert.match(ui, /<button type="button" class="sv-slot sv-eslot sv-empty" data-equip="\$\{i\}"/);
  assert.match(ui, /const slotFrom = e => e\.target\?\.closest\?\.\('#inventory \.sv-slot\[data-index\],#inventory \.sv-eslot'\)/);
  assert.match(ui, /const dropPlan = \(from, el\) => \(isEq\(el\) \? equipTarget\(curSlots, from, idxOf\(el\), GEAR, HB\) : gridTarget\(curSlots, \+el\.dataset\.index, worn, HB\)\);/);
  assert.match(ui, /if \(d\.pre && !sendMove\(d\.pre\[0\], d\.pre\[1\], undefined, el\)\) return;/);
  assert.match(ui, /const changed = paintSlot\(el, w \? null : slots\[i\], w \? '' : sigs\[i\], label\);/, 'worn gear is not painted in the grid');
  assert.match(ui, /if \(i >= 0\) el\.dataset\.slot = String\(i\); else delete el\.dataset\.slot;/);
});
