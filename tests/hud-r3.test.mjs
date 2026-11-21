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

// ---------------------------------------------------------------- HUD-6 shader warm-up page error

test('HUD-6: shader warm-ups use the synchronous compile, so no timer poll can trip over a disposed material', () => {
  const g = src('game.js');
  assert.doesNotMatch(g.replace(/\/\/[^\n]*/g, ''), /compileAsync\(/, 'no async warm-up left in game.js');
  assert.match(g, /function warmKinds\(\) \{[\s\S]*?if \(fresh\) \{ try \{ renderer\.compile\(scene, camera\); \}/);
  assert.match(g, /function warmShaders\(\) \{\s*if \(typeof renderer\.compile !== 'function'\) return;[\s\S]*?renderer\.compile\(scene, camera\);/);
});
