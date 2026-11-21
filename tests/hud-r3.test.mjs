// Regression tests for HUD findings HUD-2..HUD-6 and UX3-1, UX3-3, UX3-8 (round 3).
// Run: node --test tests/hud-r3.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = name => readFileSync(fileURLToPath(new URL(name, base)), 'utf8');
const P = await import(new URL('prompts.js', base));

// ---------------------------------------------------------------- HUD-2 throw charge bar

test('HUD-2: the charge bar draws its fill from --c and drops the old ring mask and margin', () => {
  const rule = src('prompts.css').match(/body #chargeMeter\{[^}]*\}/)[0];
  assert.match(rule, /background:linear-gradient\(90deg,#f6ecd6 calc\(var\(--c,0\) \* 100%\)/, 'fill reads --c');
  for (const reset of ['margin:0!important', '-webkit-mask:none!important', 'mask:none!important', 'filter:none!important']) assert.ok(rule.includes(reset), reset);
  assert.match(rule, /top:calc\(50% \+ 34px\)!important/, 'sits in the prompt row');
});

test('HUD-2: the crosshair prompt steps aside while a throw charges, so bar and prompt never share a row', () => {
  assert.equal(P.promptQuiet({charging:true}), true);
  assert.equal(P.promptQuiet({inventoryOpen:true}), true);
  assert.equal(P.promptQuiet({charging:false, running:true}), false);
  assert.equal(P.promptQuiet(null), false);
  assert.match(src('prompts.js'), /blocked = [^\n]*promptQuiet\(state\)/);
});

// ---------------------------------------------------------------- HUD-3 tracker + fish toast

const H = await import(new URL('hud.js', base));
function stubDoc(withHud = true) {
  const byId = new Map();
  const el = tag => ({tagName:tag, id:'', children:[], textContent:'', appendChild(c) { this.children.push(c); if (c.id) byId.set(c.id, c); return c; }});
  const doc = {head:el('head'), body:el('body'), createElement:el, getElementById:id => byId.get(id) ?? null};
  if (withHud) { const hud = el('div'); hud.id = 'hud'; doc.body.appendChild(hud); }
  return doc;
}

test('HUD-3: the tracker and fishing toasts share one top-left column instead of two pinned corners', () => {
  const doc = stubDoc(), col = H.topLeftColumn(doc);
  assert.equal(col.id, H.TOP_LEFT_ID);
  assert.equal(H.topLeftColumn(doc), col, 'one column, created once');
  assert.equal(doc.getElementById('hud').children[0], col, 'lives in #hud, so it hides with the HUD');
  assert.equal(doc.head.children.filter(s => s.id === H.TOP_LEFT_ID + 'Style').length, 1);
  assert.match(H.TOP_LEFT_CSS, /display:flex;flex-direction:column/);
  assert.match(H.TOP_LEFT_CSS, />\*\{position:static!important/, 'children flow in the column');
  assert.match(H.TOP_LEFT_CSS, /#craftTracker\{order:0\}[^\n]*#fcToast\{order:1\}/, 'tracker first, toasts under it');
  assert.equal(H.topLeftColumn(stubDoc(false)).id, H.TOP_LEFT_ID, 'falls back to body');
  assert.match(src('fishing-cooking.js'), /topLeftColumn\(document\)\.appendChild\(toastBox\)/);
  assert.match(src('survival-ui.js'), /topLeftColumn\(document\)\.append\(t\)/);
});

// ---------------------------------------------------------------- HUD-4 two bottom-left feeds

test('HUD-4: #lrFeed moves into the pickup feed column once, so the two stack instead of overlapping', () => {
  const host = {kids:[], prepend(c) { c.parentNode?.kids.splice(c.parentNode.kids.indexOf(c), 1); this.kids.unshift(c); c.parentNode = this; }};
  const body = {kids:[]}, feed = {parentNode:body}; body.kids.push(feed);
  assert.equal(P.dockFeed(feed, null), false, 'no pickup feed yet: stays put');
  assert.equal(P.dockFeed(feed, host), true);
  assert.equal(feed.parentNode, host); assert.equal(host.kids[0], feed, 'above the pickup rows');
  assert.equal(body.kids.length, 0);
  assert.equal(P.dockFeed(feed, host), false, 'idempotent per tick');
  assert.match(src('prompts.js'), /dockFeed\(feedEl, doc\.getElementById\('pickupFeed'\)\)/);
  const css = src('prompts.css');
  assert.match(css, /#pickupFeed>#lrFeed\{position:static/, 'flows in the column');
  assert.match(css, /#pickupFeed\.docked>#lrFeed\{display:none\}/, 'hidden while the feed is docked in the open bag');
});

// ---------------------------------------------------------------- HUD-5 pause menu single highlight

test('HUD-5: hovering a pause item moves focus to it, and :hover is no longer a second highlight', () => {
  const s = src('settings.js');
  assert.match(s, /form\.addEventListener\('pointerover', guard\(\(event\) => \{\s*const b = event\.target\.closest\?\.\('\.rs-menu button'\);\s*if \(b && b !== document\.activeElement\) b\.focus\(\{ preventScroll: true \}\);/);
  assert.doesNotMatch(s, /\.rs-menu button:hover/, 'the selected look follows focus only');
  assert.match(s, /#options \.rs-menu button:focus,#options \.rs-menu button\[aria-expanded=true\]\{/);
});

// ---------------------------------------------------------------- UX3-1 station / crate look-at prompts

test('UX3-1: object prompt HTML becomes crosshair prompt rows', () => {
  assert.deepEqual(P.parseContextPrompt('<kbd>E</kbd>Open crate'), {key:'E', label:'Open crate'});
  assert.deepEqual(P.parseContextPrompt('<kbd>E</kbd>Use tinker’s desk'), {key:'E', label:'Use tinker’s desk'});
  assert.deepEqual(P.parseContextPrompt('<kbd>E</kbd> Grill Pomfret (21.0 cm) · cooking 4s'), [{key:'E', label:'Grill Pomfret (21.0 cm)'}, {label:'cooking 4s', muted:true}]);
  assert.deepEqual(P.parseContextPrompt('<kbd>Click</kbd>Water the planter'), {key:'LMB', label:'Water the planter'});
  assert.deepEqual(P.parseContextPrompt('Bees are busy… 40%'), {label:'Bees are busy… 40%', muted:true});
  assert.deepEqual(P.parseContextPrompt('<kbd>E</kbd>Take Tom &amp; Jerry &lt;3'), {key:'E', label:'Take Tom & Jerry <3'});
  for (const empty of ['', null, undefined, '<kbd></kbd>']) assert.equal(P.parseContextPrompt(empty), null);
  const rows = P.normalizePrompt(P.parseContextPrompt('<kbd>E</kbd>Open crate'));
  assert.deepEqual(rows, [{key:'E', label:'Open crate', hold:false, muted:false}]);
});

test('UX3-1: game.js feeds content, grill, watering and station prompts to raftPrompts above the tool tip', () => {
  const g = src('game.js');
  assert.match(g, /import \{ parseContextPrompt \} from '\.\/prompts\.js';/, 'same URL as the page script: one prompts instance');
  assert.match(g, /rp\.provide\(\{id:'game-objects', priority:2, prompt:\(\) => \(running && objectHtml \? parseContextPrompt\(objectHtml\) : null\)\}\)/);
  assert.match(g, /\(contextHtml = content\?\.prompt\(frameAim\) \?\? null\)\) obj = contextHtml/);
  assert.match(g, /\(stationHtml = prog\?\.prompt\?\.\(frameAim\) \?\? null\)\) obj = stationHtml/);
  assert.match(g, /objectHtml = obj;/);
});

const PH = await import(new URL('progression-hooks.js', base));
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
function stationGame(decor, pose) {
  const m = new Map();
  globalThis.localStorage = {getItem:k => (m.has(k) ? m.get(k) : null), setItem:(k, v) => m.set(k, String(v)), removeItem:k => m.delete(k), clear:() => m.clear()};
  const world = {tiles:[[0, 0], [1, 0], [0, 1], [-1, 1]], decor, items:[], collected:0}, bag = new Bag({slots:Array(SLOT_COUNT).fill(null), selected:0});
  return PH.attachProgression({T:null, role:() => 'solo', ready:() => false, running:() => false, world:() => world, bag:() => bag,
    localBag:() => bag, action() {}, emit() {}, notice() {}, pose:() => pose});
}

test('UX3-1: looking at a station in reach shows "E Use …"; just out of reach says move closer; looking away shows nothing', () => {
  const pose = {x:0, z:0, yaw:0};
  const p = stationGame([{type:'smelter', x:1, z:0}, {type:'researchtable', x:-1, z:1}], pose);
  const at = (x, z) => ({dir:{x, y:-0.3, z}, point:null});
  assert.equal(p.prompt(at(1, 0)), '<kbd>E</kbd>Use Smelter', 'smelter 2 m ahead');
  pose.x = -1.2; pose.z = 1.2;
  assert.equal(p.prompt(at(-1, 1)), '<kbd>E</kbd>Research');
  pose.x = 0; pose.z = 0;
  assert.match(p.prompt(at(-1, 1)), /^Research Table: move closer$/);
  assert.equal(p.prompt(at(0, -1)), null, 'looking away');
  assert.equal(p.prompt({dir:{x:0, y:1, z:0}}), null, 'looking straight up');
  assert.equal(p.prompt(null), null);
  p.dispose();
});
// ---------------------------------------------------------------- UX3-3 selected crafting tab contrast

const lum = hex => { const c = hex.match(/[0-9a-f]{2}/gi).slice(0, 3).map(h => parseInt(h, 16) / 255).map(v => (v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

test('UX3-3: the selected crafting tab reads as light, bold text at >= 4.5:1 over its whole gradient', () => {
  const rule = src('survival-ui.js').match(/#inventory \.sv-tab\[aria-selected="true"\]\{[^}]*\}/)[0];
  const [, top, bottom] = rule.match(/background:linear-gradient\((#[0-9a-f]{6}),(#[0-9a-f]{6})\)/i);
  const color = rule.match(/;color:(#[0-9a-f]{6})/i)[1];
  for (const bg of [top, bottom]) assert.ok(contrast(color, bg) >= 4.5, `${color} on ${bg}: ${contrast(color, bg).toFixed(2)}:1`);
  assert.match(rule, /font-weight:800/);
});

// ---------------------------------------------------------------- HUD-6 shader warm-up page error

test('HUD-6: shader warm-ups use the synchronous compile, so no timer poll can trip over a disposed material', () => {
  const g = src('game.js');
  assert.doesNotMatch(g.replace(/\/\/[^\n]*/g, ''), /compileAsync\(/, 'no async warm-up left in game.js');
  assert.match(g, /function warmKinds\(\) \{[\s\S]*?if \(fresh\) \{ try \{ renderer\.compile\(scene, camera\); \}/);
  assert.match(g, /function warmShaders\(\) \{\s*if \(typeof renderer\.compile !== 'function'\) return;[\s\S]*?renderer\.compile\(scene, camera\);/);
});
