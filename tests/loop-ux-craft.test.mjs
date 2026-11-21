// Crafting panel UX regressions (loop-ux craft round): locked recipes the host refuses, lock reasons,
// the receiver icon, stale tooltips, categories, hold-to-craft pacing and build-wheel costs.
// Run: node --test tests/loop-ux-craft.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(new URL(f, base), 'utf8');
const T = await import(new URL('vendor/three.module.js', base));
const CB = await import(new URL('craft-book.js', base));
const { Bag, ITEM_INFO, RECIPES } = await import(new URL('inventory-state.js', base));
const { ITEMS } = await import(new URL('items.js', base));
const SR = await import(new URL('storage-research.js', base));

// The same split game.js makes: items.js unlocks own the catalogue, the Tinker's Desk owns the rest.
SR.setOwnedElsewhere(id => Object.prototype.hasOwnProperty.call(ITEMS, id));
const STUDY = ['cup', 'purifier', 'rainbarrel', 'sprinkler', 'antenna', 'receiver'];

function newPlayerStorage() {
  const world = { tiles: [[0, 0]], decor: [], stock: { wood: 0, leaf: 0, scrap: 0, plastic: 0 }, fish: 0, collected: 0, items: [],
    hostInventory: new Bag().snapshot(), guestInventory: new Bag().snapshot(), ext: {} };
  const bags = { host: new Bag(), guest: new Bag() };
  const ctx = { T, world, role: 'solo', running: true, physics: { x: 0, z: 0 }, other: null, camera: null, raft: null,
    localBag: () => bags.host, actorBag: a => bags[a], emit() {}, notice() {}, rebuildRaft() {}, releaseLock() {}, requestLock() {} };
  const mod = SR.createStorage(ctx);
  ctx.action = a => mod.action(a, 'host', bags.host);
  return mod;
}

// ---------------------------------------------------------------- F1
test('F1: recipes the host refuses (not studied yet) are locked in the panel, with the host reason', () => {
  const storage = newPlayerStorage();
  for (const id of STUDY) {
    assert.ok(RECIPES[id], id + ' is a hand recipe');
    const reason = storage.craftLocked(id, 'host');
    assert.equal(reason, SR.LOCK_REASON, id + ' is refused by the host until studied');
    // progression has no opinion on these (null): the content lock still wins
    assert.deepEqual(CB.mergeGate(null, reason), { locked: true, reason: SR.LOCK_REASON }, id);
  }
  // starter recipes stay craftable
  for (const id of SR.STARTER) assert.equal(CB.mergeGate(null, storage.craftLocked(id, 'host')), null, id);
});

test('F1: mergeGate keeps progression hide/lock, else adds the content lock', () => {
  assert.equal(CB.mergeGate(null, null), null);
  assert.equal(CB.mergeGate(null, ''), null);
  assert.deepEqual(CB.mergeGate({ hidden: true }, 'x'), { hidden: true }, 'hidden recipes stay hidden');
  assert.deepEqual(CB.mergeGate({ locked: true, reason: 'Research Nail' }, 'Study it'), { locked: true, reason: 'Research Nail' });
  assert.deepEqual(CB.mergeGate(undefined, 'Study it'), { locked: true, reason: 'Study it' });
});

test('F1: game.js gates the panel with content locks and craft() reports refusals', () => {
  const g = src('game.js');
  assert.match(g, /recipeGate:id => mergeGate\(prog\?\.recipeGate\(id\), content\?\.craftLocked\(id, myActor\(\)\)\)/);
  const craft = g.slice(g.indexOf('  function craft(recipe) {'), g.indexOf('  function repair()'));
  assert.match(craft, /content\?\.craftLocked\(recipe, myActor\(\)\); if \(locked\) \{[^}]*return false; \}/, 'a locked craft returns false');
  assert.match(craft, /return action\(\{kind:'craft', recipe\}\) !== false;/, 'a refused action returns false too');
  // survival-ui stops the hold when onCraft returns false
  const ui = src('survival-ui.js');
  assert.match(ui.slice(ui.indexOf('function craftNow('), ui.indexOf('function setFill(')), /if \(r === false\) return false;/);
  assert.match(ui.slice(ui.indexOf('function tick('), ui.indexOf('function stopHold(')), /if \(!craftNow\(hold\.id\)\) \{ stopHold\(\); return; \}/);
});

// ---------------------------------------------------------------- F2
test('F2: the lock reason is shown in full: detail state line, two-line row, tooltips', () => {
  const ui = src('survival-ui.js');
  assert.match(ui, /<p class="sv-dstate" hidden><\/p>/, 'detail pane has a state line');
  assert.match(ui, /const why = v\.state === 'gated' \? 'Locked: ' \+ \(v\.reason/, 'it shows the gate reason');
  assert.match(ui, /#inventory \.sv-gated \.sv-rsub\{white-space:normal;[^}]*-webkit-line-clamp:2/, 'gated rows wrap to two lines');
  assert.match(ui, /v\.el\.dataset\.lockReason = v\.reason/, 'rows carry the reason for item tooltips');
  assert.match(ui, /extra = v\.state === 'gated' \? 'Locked: ' \+ \(v\.reason/, 'own recipe tooltip shows it');
  const tt = src('item-tooltips.js');
  assert.match(tt, /else if \(recipe && el\?\.dataset\.lockReason\) out \+= `<div class="it-lock">Locked: \$\{esc\(el\.dataset\.lockReason\)\}/);
  assert.match(tt, /if \(Object\.hasOwn\(table, kind\) && prog && typeof prog\.isUnlocked/, 'non-catalogue kinds no longer read "Locked: Unknown item"');
  // Locked research rows can be hovered and picked (they used to ignore the pointer).
  assert.doesNotMatch(src('storage-research-ui.js'), /\.sv-recipe\[data-locked\]\{[^}]*pointer-events:none/);
});

// ---------------------------------------------------------------- F3
test('F3: the receiver has its own icon: sprite, inline drawing and 3D model', async () => {
  assert.equal(ITEM_INFO.receiver.placeholder, false);
  assert.ok(src('icons.svg').includes(`id="${ITEM_INFO.receiver.icon}"`), 'sprite symbol exists');
  const { ITEM_ICONS } = await import(new URL('item-svg.js', base));
  assert.match(ITEM_ICONS.receiver, /^<path /, 'inline drawing for the receiver');
  const icons = await import(new URL('item-icons.js', base));
  const { model, own } = icons.resolveIconModel('receiver');
  assert.ok(model && model.isObject3D, 'a 3D model to render the icon from');
  assert.equal(own, true, 'built fresh, so the icon renderer frees it');
  assert.match(src('survival-ui.js'), /receiver: 'receiver',/, 'flat fallback uses the receiver sprite, not the compass');
});

// ---------------------------------------------------------------- F4
test('F4: a hidden or detached anchor gives no tooltip position (no jump to the top-left)', () => {
  assert.equal(CB.anchorTip({ left: 0, top: 0, right: 0, bottom: 0 }, 200, 80, 1280, 720), null);
  assert.equal(CB.anchorTip(null, 200, 80, 1280, 720), null);
  assert.equal(CB.anchorTip({ left: NaN, top: 0, right: 1, bottom: 1 }, 200, 80, 1280, 720), null);
  const el = (rect, connected = true) => ({ isConnected: connected, getBoundingClientRect: () => rect });
  assert.equal(CB.anchorVisible(el({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 })), false, 'display:none');
  assert.equal(CB.anchorVisible(el({ left: 10, top: 10, right: 60, bottom: 40 }, false)), false, 'detached');
  assert.equal(CB.anchorVisible(el({ left: 10, top: 10, right: 60, bottom: 40 })), true);
  assert.equal(CB.anchorVisible(null), false);
});

test('F4: tab changes and repaints drop or re-check the tooltip anchor', () => {
  const ui = src('survival-ui.js');
  assert.match(ui, /if \(id !== activeTab\) \{ stopHold\(\); hideTip\(\);/, 'tab switch hides the tooltip');
  assert.match(ui, /if \(tipAnchor === v\.el\) \{ if \(anchorVisible\(v\.el\)\) showTipFor\(v\.el\); else hideTip\(\); \}/);
  assert.match(ui, /if \(!p\) \{ hideTip\(\); return; \}/);
  const tt = src('item-tooltips.js');
  assert.match(tt, /function refresh\(\) \{ if \(cur && anchorVisible\(cur\.el\)\) show/);
  assert.match(tt, /if \(!p\) \{ hide\(\); return; \}/);
  assert.match(tt, /on\(root, 'click', \(\) => \{ if \(cur\) requestAnimationFrame\(refresh\); \}\)/);
});

test('F4: crafting tooltips sit beside the whole column and never over the Craft button', () => {
  const vw = 1280, vh = 720;
  // ingredient row in the detail pane (right of the list): no room on the right -> left of the pane
  const detail = { left: 554, top: 60, right: 1122, bottom: 388 };
  const ing = { left: 564, top: 160, right: 1112, bottom: 190 };
  const p = CB.anchorTip(ing, 270, 150, vw, vh, 8, 6, { beside: detail });
  assert.equal(p.side, 'left');
  assert.ok(p.x + 270 <= detail.left, 'not over the pane (counts, Craft button)');
  // recipe row beside the list: slides off the Craft button
  const list = { left: 262, top: 90, right: 531, bottom: 650 };
  const row = { left: 262, top: 330, right: 531, bottom: 382 };
  const btn = { left: 564, top: 334, right: 1112, bottom: 378 };
  const q = CB.anchorTip(row, 270, 120, vw, vh, 8, 6, { beside: list, avoid: btn });
  assert.equal(q.side, 'right');
  assert.ok(q.y + 120 <= btn.top || q.y >= btn.bottom, 'clear of the Craft button');
  // without options, the old placement is unchanged
  assert.deepEqual(CB.anchorTip({ left: 100, top: 200, right: 150, bottom: 250 }, 200, 80, vw, vh), { x: 158, y: 200, side: 'right' });
});

// ---------------------------------------------------------------- F5
test('F5: water gear sits in Survival; desk, antenna and receiver in Building', () => {
  for (const k of ['cup', 'purifier', 'rainbarrel', 'sprinkler']) assert.equal(CB.categoryOf(k), 'survival', k);
  for (const k of ['research', 'antenna', 'receiver']) assert.equal(CB.categoryOf(k), 'building', k);
});

// ---------------------------------------------------------------- hold to craft
test('hold to craft: a click makes exactly one; repeats start after ~800 ms, then speed up', () => {
  assert.equal(CB.HOLD.first, 800);
  for (const ms of [0, 120, 400, 799]) assert.equal(CB.craftsForHold(ms), 1, ms + ' ms is a click');
  assert.equal(CB.craftsForHold(800), 2);
  const s = CB.holdSchedule(6);
  for (let i = 2; i < s.length; i++) assert.ok(s[i] - s[i - 1] < s[i - 1] - s[i - 2], 'each repeat comes sooner');
  assert.ok(CB.craftsForHold(1600) <= 3, 'a 1.6 s hold no longer runs away');
  const ui = src('survival-ui.js');
  assert.match(ui, /D\.hint\.textContent = n === 1 && hold\.cap > 1 \? 'keep holding for more' : '';/, 'the first press says what holding does');
  assert.match(ui, /const p = clamp01\(\(now - hold\.t0\) \/ hold\.wait\);\s*setFill\(p\);/, 'the button fills toward the next craft');
});

// ---------------------------------------------------------------- layout
test('layout: vertical category column, tall recipe list with a scroll cue, detail beside it, steady height', () => {
  const ui = src('survival-ui.js');
  assert.match(ui, /class="sv-tabs" role="tablist" aria-label="Recipe categories" aria-orientation="vertical"/);
  assert.match(ui, /#inventory \.sv-tabs\{display:flex;flex-direction:column;/);
  assert.match(ui, /e\.code === 'ArrowDown' \|\| e\.code === 'ArrowRight'/, 'up/down (and left/right) move between categories');
  assert.match(ui, /<div class="sv-rcol"><div class="sv-rlist" role="tabpanel"><\/div><\/div>/);
  assert.match(ui, /#inventory \.sv-rcol\.sv-more::after\{opacity:1\}/, 'bottom fade while more rows are below');
  assert.match(ui, /#inventory \.sv-craft\{flex:none;box-sizing:border-box;height:var\(--ph\);/, 'fixed-height crafting column: tabs never resize the panel');
  const order = ['class="sv-craft"', 'class="sv-side"', 'class="sv-detail"', 'class="sv-bag"'].map(k => ui.indexOf(k));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), 'crafting on the left, detail over the backpack on the right');
  assert.match(ui, /Requires <i>have \/ need<\/i>/);
});

test('pin button is dark text on the cream detail pane', () => {
  const ui = src('survival-ui.js');
  const rule = ui.match(/#inventory button\.sv-pinbtn\{[^}]*\}/)[0];
  assert.match(rule, /color:#3e2a17/);
  assert.doesNotMatch(rule, /color:#f4efe2/);
});

// ---------------------------------------------------------------- build wheel / help text
test('build costs: bag names and per-material have/need colouring', async () => {
  const { costParts } = await import(new URL('build-menu.js', base));
  const have = { wood: 12, plastic: 1 };
  const parts = costParts({ wood: 2, plastic: 2 }, k => have[k] ?? 0, k => ITEM_INFO[k]?.name, () => false);
  assert.deepEqual(parts.map(p => [p.kind, p.name, p.have, p.need, p.short]),
    [['wood', ITEM_INFO.wood.name, 12, 2, false], ['plastic', ITEM_INFO.plastic.name, 1, 2, true]]);
  assert.equal(ITEM_INFO.wood.name, 'Plank', 'the bag calls wood Plank, and so does the wheel');
  // without counts it falls back to the all-or-nothing afford check
  assert.ok(costParts({ wood: 2 }, null, null, () => false)[0].short);
  const b = src('building.js');
  assert.match(b, /countOf:k => \(curBag \? curBag\.count\(k\) : 0\), nameOf:k => ITEM_INFO\[k\]\?\.name/);
  assert.match(b, /if \(active\) menu\.refresh\(\);/, 'the chip follows the bag');
  assert.match(src('build-menu.js'), /<kbd>Q<\/kbd> \/ <kbd>Right-click<\/kbd> pieces/);
});

test('help text matches the real hotbar and mentions the build wheel', async () => {
  const { HOTBAR_SIZE } = await import(new URL('inventory-state.js', base));
  const { HINTS } = await import(new URL('hud.js', base));
  const slots = HINTS.find(h => h.id === 'slots').text;
  assert.doesNotMatch(slots, /1–8/);
  assert.match(slots, new RegExp(`1–${Math.min(HOTBAR_SIZE, 9)}`));
  if (HOTBAR_SIZE >= 10) assert.match(slots, /or 0/);
  const set = src('settings.js');
  assert.doesNotMatch(set, /'1 - 8 \/ Wheel'/);
  assert.match(set, /\['Q \/ Right-click', 'Build wheel \(hammer\)'\]/);
});
