// HUD loop-UX regressions: crosshair prompt during fishing-v2 + #contextPrompt prompts, no centred panels in play,
// one bottom-left feed stack, help text, single-shot toasts with a FIFO queue.
// Run: node --test tests/loop-ux-hud.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(fileURLToPath(new URL(f, base)), 'utf8');
// prompts.js boots its DOM layer only when window+document exist: import it before any fake DOM below.
const P = await import(new URL('prompts.js', base));

// ---------------------------------------------------------------- E1 crosshair prompt
const rod = {running:true, role:'host', networkReady:true, hookStage:'idle', heldKind:'fishingrod', me:{pitch:-0.2}, stock:{}, build:{}};
const one = (s, opt) => P.normalizePrompt(P.statePrompt(s, opt))?.[0] ?? null;

test('E1 rod prompt follows the fishing-v2 session, not game.js hookStage', () => {
  assert.equal(one(rod, {fcStage:'idle'}).label, 'Cast line');
  assert.deepEqual(one(rod, {fcStage:'bite'}), {key:'LMB', label:'Strike!', hold:false, muted:false});
  assert.deepEqual(one(rod, {fcStage:'reeling'}), {key:'LMB', label:'Reel in', hold:true, muted:false});
  for (const st of ['flying', 'waiting', 'nibble']) assert.deepEqual(one(rod, {fcStage:st}), {key:'', label:'Waiting for a bite…', hold:false, muted:true}, st);
  assert.equal(P.statePrompt(rod, {fcStage:'charging'}), null); // the cast-power bar speaks for itself
  assert.equal(one(rod, {fcStage:'done'}).label, 'Cast line');
});

const ctxEl = (html, hidden = false) => { // tiny #contextPrompt stand-in: '<kbd>E</kbd>Label' markup
  const m = /^<kbd>([^<]*)<\/kbd>(.*)$/.exec(html);
  return {hidden, textContent:m ? m[1] + m[2] : html, querySelector:q => (q === 'kbd' && m ? {textContent:m[1]} : null)};
};

test('E1 #contextPrompt markup surfaces in #lrPrompt as {key,label}', () => {
  assert.deepEqual(P.contextPromptOf(ctxEl('<kbd>E</kbd>Take fresh water')), {key:'E', label:'Take fresh water'});
  assert.deepEqual(P.contextPromptOf(ctxEl('<kbd>E</kbd> Add wood · grill')), {key:'E', label:'Add wood · grill'});
  assert.deepEqual(P.contextPromptOf(ctxEl('<kbd>Click</kbd> Strike!')), {key:'LMB', label:'Strike!'});
  assert.deepEqual(P.contextPromptOf(ctxEl('Purifying… 12s')), {label:'Purifying… 12s', muted:true});
  assert.equal(P.contextPromptOf(ctxEl('<kbd>E</kbd>Harvest palm', true)), null);
  assert.equal(P.contextPromptOf(ctxEl('')), null);
  assert.equal(P.contextPromptOf(ctxEl('Floor needs 1 wood')), null); // the hammer prompt covers it
  assert.equal(P.contextPromptOf(null), null);
  assert.ok(P.hasKey({key:'E', label:'x'})); assert.ok(!P.hasKey({label:'x', muted:true})); assert.ok(!P.hasKey(null));
});

test('E1 keyed #contextPrompt beats the built-in prompt; key-less status is a muted fallback', () => {
  // mirrors the tick() candidate order: keyed ctx > keyed state > key-less ctx > key-less state
  const pick = (sp, cp) => P.pickPrompt([P.hasKey(cp) && cp, P.hasKey(sp) && sp, !P.hasKey(cp) && cp, !P.hasKey(sp) && sp]
    .filter(Boolean).map(p => ({prompts:p, priority:0, ray:false})));
  const cast = P.statePrompt(rod, {fcStage:'idle'});
  assert.equal(pick(cast, P.contextPromptOf(ctxEl('<kbd>E</kbd>Add wood')))[0].label, 'Add wood');
  assert.equal(pick(cast, P.contextPromptOf(ctxEl('Purifying… 9s')))[0].label, 'Cast line');
  assert.equal(pick(P.statePrompt(rod, {fcStage:'waiting'}), P.contextPromptOf(ctxEl('Waiting for a bite… (click early and it’ll spook)')))[0].label,
    'Waiting for a bite… (click early and it’ll spook)'); // not cut off
  const hammer = {...rod, heldKind:'hammer', build:{hover:{x:1, z:0, blocked:'reach'}, affordable:true}};
  assert.equal(P.statePrompt(hammer), null); // blocked: game.js's BLOCK_TEXT explains why
  assert.deepEqual(pick(P.statePrompt(hammer), P.contextPromptOf(ctxEl('Too far away: step closer'))), [{key:'', label:'Too far away: step closer', hold:false, muted:true}]);
});

test('E1 state prompts are never posted to the event feed as news', () => {
  const s = src('prompts.js');
  assert.ok(!/MutationObserver/.test(s), 'no #contextPrompt observer feeding #lrFeed');
  assert.match(s, /raftFC\?\.session\?\.stage/);
});

// ---------------------------------------------------------------- tiny fake DOM (shared by the DOM tests below)
class El {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.nodeType = 1; this.ownerDocument = doc; this.children = []; this.parent = null; this.id = '';
    this.style = {}; this.hidden = false; this.attrs = {}; this._text = ''; this._html = ''; this.className = '';
    const cl = this._cl = new Set();
    this.classList = {add: (...c) => c.forEach(x => cl.add(x)), remove: (...c) => c.forEach(x => cl.delete(x)), contains: c => cl.has(c),
      toggle: (c, on = !cl.has(c)) => (on ? cl.add(c) : cl.delete(c), on)};
  }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return e === this.ownerDocument?.body || e === this.ownerDocument?.head; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; this._text = ''; }
  get firstChild() { return this.children[0] ?? null; }
  get firstElementChild() { return this.children[0] ?? null; }
  appendChild(c) { c.remove?.(); c.parent = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(c)); }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener() {} removeEventListener() {}
  getBoundingClientRect() { return this.rect ?? {left:0, top:0, width:0, height:0}; }
  querySelector(sel) { return this._q?.(sel) ?? (this._stub ??= new Map()).get(sel) ?? (this._stub.set(sel, new El('div', this.ownerDocument)), this._stub.get(sel)); }
  querySelectorAll(sel) { return (this._all ??= new Map()).get(sel) ?? (this._all.set(sel, [new El('button', this.ownerDocument), new El('button', this.ownerDocument)]), this._all.get(sel)); }
  removeAttribute(k) { delete this.attrs[k]; }
  focus() {}
}
function fakeDoc() {
  const doc = {};
  doc.head = new El('head', doc); doc.body = new El('body', doc);
  const all = (e, out = []) => { out.push(e); e.children.forEach(c => all(c, out)); return out; };
  doc.createElement = t => new El(t, doc);
  doc.createElementNS = (_, t) => new El(t, doc);
  doc.getElementById = id => [...all(doc.head), ...all(doc.body)].find(e => e.id === id) ?? null;
  doc.querySelector = sel => (sel[0] === '#' ? doc.getElementById(sel.slice(1)) : null);
  doc.addEventListener = () => {};
  doc.defaultView = {addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout};
  return doc;
}

// ---------------------------------------------------------------- E2 no centred panels in play
test('E2 dive gather label sits in the crosshair-side prompt column, not centred under it', async () => {
  const { createDivingUI } = await import(new URL('diving-ui.js', base));
  const doc = fakeDoc(), cross = doc.createElement('div'); cross.id = 'crosshair'; cross.rect = {left:630, top:350, width:20, height:20}; doc.body.appendChild(cross);
  const ui = createDivingUI(doc);
  ui.update({underwater:true, gatherLabel:'Hold E · Kelp', gather01:0.3});
  const label = doc.body.children.find(e => e.className === 'diveRingLabel');
  assert.equal(label.textContent, 'Hold E · Kelp');
  assert.equal(label.style.left, 'calc(640px + 34px)');
  assert.equal(label.style.top, 'calc(360px + 52px)');
  const css = doc.getElementById('divingStyle').textContent, rule = /\.diveRingLabel\{[^}]*\}/.exec(css)[0];
  assert.match(rule, /transform:none/); assert.doesNotMatch(rule, /background|translateX\(-50%\)/);
  ui.dispose();
});

test('E2 binoculars readout and reel HUD join the prompt column (no centred boxes)', () => {
  const bino = /hud\.id = 'binocularsHud'[^\n]*\n[^\n]*/.exec(src('progression-hooks.js'))[0];
  assert.match(bino, /left:calc\(50% \+ 34px\)/); assert.match(bino, /transform:none/);
  assert.doesNotMatch(bino, /left:50%|translateX\(-50%\)|background/);
  const reel = /#fcReelHud\{[^}]*\}/.exec(src('fishing-v2.js'))[0];
  assert.match(reel, /left:calc\(50% \+ 34px\)/); assert.match(reel, /transform:none/); assert.match(reel, /text-align:left/);
  assert.doesNotMatch(reel, /left:50%;|translateX\(-50%\)/);
});

// ---------------------------------------------------------------- E3 one bottom-left feed stack
test('E3 coop lines (solo "You wave." too) join the pickup feed stack instead of a second overlapping box', async () => {
  const PF = await import(new URL('pickup-feed.js', base));
  const CF = await import(new URL('coop-feed.js', base));
  const doc = fakeDoc(), pickup = PF.createFeed({doc, now:() => 0, timer:() => 0, clear() {}});
  doc.defaultView.raftPickupFeed = pickup;
  const coop = CF.createFeed({doc});
  for (const k of ['wood', 'leaf', 'plastic', 'scrap']) pickup.add(k, 2);
  coop.push('You wave.', 'emote');
  coop.push('Your brother joined!', 'join');
  const host = doc.getElementById('pickupFeed');
  assert.equal(doc.getElementById('coopFeed'), null, 'no separate #coopFeed box');
  assert.equal(doc.getElementById('coopFeedStyle'), null);
  const live = host.children.filter(r => !r.classList.contains('out'));
  assert.equal(live.length, PF.MAX_ROWS, 'one shared cap for pickups + coop lines');
  const wave = host.children.find(r => r.textContent === 'You wave.');
  assert.ok(wave.classList.contains('pf-note') && wave.classList.contains('pf-emote'));
  assert.ok(host.children.find(r => r.textContent === 'Your brother joined!').classList.contains('pf-join'));
  assert.equal(live.at(-1).textContent, 'Your brother joined!'); // newest at the bottom
  coop.dispose();
});

test('E3 coop feed still works standalone (no shared stack): own box', async () => {
  const CF = await import(new URL('coop-feed.js', base));
  const doc = fakeDoc(); doc.defaultView.requestAnimationFrame = f => f();
  const coop = CF.createFeed({doc});
  assert.equal(doc.getElementById('coopFeed'), null); // lazy
  coop.push('You point.', 'emote');
  assert.equal(doc.getElementById('coopFeed').textContent, 'You point.');
  coop.dispose();
  assert.equal(doc.getElementById('coopFeed'), null);
});

test('E3 the shared stack is published and the prompt feed posts into it', () => {
  assert.match(src('pickup-feed.js'), /window\.raftPickupFeed = pickupFeed/);
  const p = src('prompts.js');
  assert.match(p, /win\.raftPickupFeed/); assert.match(p, /sink\.note\(t\)/);
  assert.match(src('style.css'), /\.pf-emote i\{/);
  // narrower than ~1180px the 5-row stack lifts above the centred hotbar instead of running into its left end
  assert.match(src('style.css'), /@media\(max-width:1100px\) and \(min-width:761px\)\{#pickupFeed\{bottom:calc\(232px/);
});

// ---------------------------------------------------------------- E4 help text matches the bag's keys
test('E4 help says the bag closes with I, E or Esc (Tab moves focus inside it)', () => {
  const li = /<li><kbd>Tab<\/kbd><span><b>Inventory\.<\/b>[^<]*<\/span><\/li>/.exec(src('index.html'))?.[0];
  assert.ok(li, 'inventory help line');
  assert.match(li, /I, E or Esc closes it/);
  assert.doesNotMatch(li, /Tab or Esc/);
});

// ---------------------------------------------------------------- E5 each unlock shows once; rapid toasts queue FIFO
test('E5 logbook toasts: three rapid celebrations all show, in order', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const doc = fakeDoc();
  globalThis.document = doc; globalThis.window = {}; globalThis.requestAnimationFrame = f => f();
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{getItem:k => mem.get(k) ?? null, setItem:(k, v) => mem.set(k, String(v))}});
  const { createLogbookUI } = await import(new URL('logbook-ui.js', base));
  const ui = createLogbookUI({getProgress:() => ({notes:[], achievements:[]})});
  const toast = doc.getElementById('lb-toast'), shown = [];
  const text = () => toast.querySelector('span').textContent;
  ui.celebrate({kind:'note', text:'Note one'}); shown.push(text());
  ui.celebrate({kind:'achievement', text:'Achievement two'});
  ui.celebrate({kind:'achievement', text:'Achievement three'});
  for (let i = 0; i < 2; i++) { t.mock.timers.tick(3000); t.mock.timers.tick(220); assert.ok(!toast.hidden); shown.push(text()); }
  assert.deepEqual(shown, ['Note one', 'Achievement two', 'Achievement three']);
  t.mock.timers.tick(3000); t.mock.timers.tick(220);
  assert.ok(toast.hidden);
  ui.destroy();
});

test('E5 game.js sends a note/achievement to the logbook toast only, not also the feed', () => {
  const body = /function effect\(e\) \{[\s\S]*?\n  \}\n/.exec(src('game.js'))[0];
  assert.match(body, /const toLog = \(e\.kind === 'note' \|\| e\.kind === 'achievement'\) && typeof logbookUI\?\.celebrate === 'function'/);
  assert.match(body, /e\.text && !toLog\) notice\(/);
  assert.match(body, /if \(toLog\) logbookUI\.celebrate\(e\)/);
});
