// HUD layout regressions: one left feed stack, nothing centred on the aim point, kbd prompts reach the side prompt.
// Run: node --test tests/hud-layout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(fileURLToPath(new URL(f, base)), 'utf8');
const P = await import(new URL('prompts.js', base));
const rule = (css, sel) => { // the rule whose selector list is exactly `sel`
  const m = new RegExp('(^|[}\\n`])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{').exec(css); assert.ok(m, `rule ${sel}`);
  return css.slice(m.index, css.indexOf('}', m.index + m[0].length));
};

// ---------------------------------------------------------------- CSS / source

test('HUD-1/2: the left feed is one capped stack that stays left of the hotbar and below the crosshair', () => {
  const css = src('style.css'), pf = rule(css, '#pickupFeed');
  assert.match(pf, /max-height:calc\(50vh - 70px\)/);
  assert.match(pf, /max-width:min\(380px,calc\(50vw - 287px\)\)/); // hotbar is 506px wide, centred
  assert.match(pf, /overflow:hidden/); assert.match(pf, /justify-content:flex-end/);
  assert.match(css, /@media\(max-width:1000px\)\{#pickupFeed\{bottom:96px;max-width:calc\(50vw - 134px\)/);
  assert.match(css, /\.pf-row>b,\.pf-row>span\{min-width:0;overflow:hidden;text-overflow:ellipsis\}/);
  const pop = rule(src('game.js'), '#pickupFeed[popover]'); // the popover override must not lift the caps
  assert.doesNotMatch(pop, /max-(width|height):none/); assert.match(pop, /overflow:hidden/);
  const lr = rule(src('prompts.css'), '#lrFeed'); // fallback sits in the same place, not up by the crosshair
  assert.match(lr, /bottom:44px/); assert.match(lr, /max-height:calc\(50vh - 70px\)/);
  assert.match(src('pickup-feed.js'), /defineProperty\(window, 'raftFeed'/);
});

test('HUD-3/4 + binoculars: nothing is centred under the crosshair', () => {
  const reel = rule(src('fishing-v2.js'), '#fcReelHud');
  assert.match(reel, /left:calc\(50% \+ 34px\)/); assert.doesNotMatch(reel, /translateX/); assert.match(reel, /text-align:left/);
  const dive = rule(src('diving-ui.js'), '.diveRingLabel');
  assert.doesNotMatch(dive, /left:50%/); assert.match(dive, /clip-path:inset\(50%\)/); // shown by prompts.js instead
  assert.doesNotMatch(src('diving-ui.js'), /label\.style\.(left|top)/);
  const bino = /hud\.style\.cssText = '([^']+)'/.exec(src('progression-hooks.js'))[1];
  assert.doesNotMatch(bino, /left:50%|translateX/); assert.match(bino, /left:calc\(50% \+ 34px\)/); assert.match(bino, /bottom:calc\(50% \+ 20px\)/);
});

test('HUD-6: the logbook toast is one line that ends above the sail compass badge', () => {
  const t = rule(src('logbook-ui.js'), '#lb-toast');
  const top = +/top:(\d+)px/.exec(t)[1], h = +/max-height:(\d+)px/.exec(t)[1];
  const badge = +/top:(\d+)px/.exec(rule(src('sailing-ui.js'), '#sailBadge'))[1];
  assert.ok(top + h + 2 < badge, `${top}+${h} < ${badge}`); // +2: the toast's outer ring
  assert.match(t, /white-space:nowrap/); assert.match(t, /overflow:hidden/);
  assert.doesNotMatch(src('logbook-ui.js'), /#lb-toast\{top:52px\}/);
});

// ---------------------------------------------------------------- prompts.js pure logic

test('HUD-5: parseContext turns #contextPrompt markup into side prompts', () => {
  const k = t => ({kbd:true, text:t}), x = t => ({kbd:false, text:t}), n = s => P.normalizePrompt(P.parseContext(s));
  assert.deepEqual(n([k('Click'), x(' Strike!')]), [{key:'LMB', label:'Strike!', hold:false, muted:false}]);
  assert.deepEqual(n([k('E'), x('Pick up plank')]), [{key:'E', label:'Pick up plank', hold:false, muted:false}]);
  assert.deepEqual(n([k('E'), x('Raise sail · hold '), k('R'), x(' to steer')]),
    [{key:'E', label:'Raise sail', hold:false, muted:false}, {key:'R', label:'Steer', hold:true, muted:false}]);
  assert.equal(n([k('E'), x(' Add fuel (wood) · 30s left')])[0].label, 'Add fuel (wood) · 30s left');
  assert.deepEqual(n([x('Hold click to reel it in')]), [{key:'LMB', label:'Reel it in', hold:true, muted:false}]);
  assert.deepEqual(n([x('Purifying… 12s')]), [{key:'', label:'Purifying… 12s', hold:false, muted:true}]); // status, not a feed line
  assert.equal(P.parseContext([]), null); assert.equal(P.parseContext([x('  ')]), null);
  assert.deepEqual(P.labelPrompt('Hold E · Scrap'), {key:'E', hold:true, label:'Scrap'});
  assert.equal(P.labelPrompt(''), null);
});

test('HUD-5: rod prompts follow the fishing session stage', () => {
  const s = {running:true, role:'host', networkReady:true, hookStage:'idle', heldKind:'fishingrod', me:{pitch:0}, build:{}};
  const at = st => P.normalizePrompt(P.statePrompt(s, {fcStage:st}));
  assert.equal(at('idle')[0].label, 'Cast line');
  assert.deepEqual(at('waiting')[0], {key:'', label:'Waiting for a bite…', hold:false, muted:true});
  assert.deepEqual(at('bite')[0], {key:'LMB', label:'Strike!', hold:false, muted:false});
  assert.deepEqual(at('reeling')[0], {key:'LMB', label:'Reel', hold:true, muted:false});
  assert.equal(at('caught'), null);
  assert.equal(P.statePrompt(s).label, 'Cast line'); // no session: old path
});

test('underwater: no "Swim to the raft edge" prompt under the gather label', () => {
  const s = {running:true, role:'host', networkReady:true, swimming:true, tileList:[[0, 0]], me:{x:20, z:0, pitch:0}, build:{}};
  assert.equal(P.statePrompt(s).label, 'Swim to the raft edge');
  assert.equal(P.statePrompt({...s, dive:{underwater:true}}), null);
});

// ---------------------------------------------------------------- prompts.js DOM layer (fake DOM)

function fakeDom() {
  const mk = (tag, text = '') => {
    const el = {nodeName:tag.toUpperCase(), tagName:tag.toUpperCase(), id:'', hidden:false, children:[], childNodes:[], parent:null, attrs:{}, style:{cssText:''},
      _text:text, get textContent() { return this.childNodes.length ? this.childNodes.map(c => c.textContent).join('') : this._text; },
      set textContent(v) { this.childNodes = []; this.children = []; this._text = String(v); },
      get innerHTML() { return this.childNodes.map(c => c.nodeName === '#text' ? c._text : `<${c.nodeName}>${c.textContent}`).join('') || this._text; },
      set innerHTML(v) { this._text = String(v); },
      get isConnected() { let e = this; while (e.parent) e = e.parent; return e === body; },
      get firstElementChild() { return this.children[0] ?? null; },
      classList:{s:new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); }, toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); }},
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(c) { c.parent = this; if (c.nodeName !== '#text') this.children.push(c); this.childNodes.push(c); return c; },
      remove() { const p = this.parent; if (!p) return; p.children = p.children.filter(c => c !== this); p.childNodes = p.childNodes.filter(c => c !== this); this.parent = null; },
      set className(v) { v.split(' ').forEach(c => this.classList.add(c)); },
    };
    return el;
  };
  const body = mk('body'), all = () => { const out = []; const walk = e => { out.push(e); e.children.forEach(walk); }; walk(body); return out; };
  const doc = {body, createElement:mk, createTextNode:t => ({nodeName:'#text', _text:t, get textContent() { return this._text; }}),
    getElementById:id => all().find(e => e.id === id) ?? null,
    querySelector(sel) {
      if (sel === 'dialog[open]') return null;
      const m = /^\.([\w-]+)\.([\w-]+)$/.exec(sel);
      return m ? all().find(e => e.classList.contains(m[1]) && e.classList.contains(m[2])) ?? null : null;
    }};
  const win = {addEventListener() {}, setInterval() { return 0; }, setTimeout() { return 0; }, innerWidth:1280, innerHeight:720,
    localStorage:{getItem:() => null, setItem() {}}};
  return {doc, win, mk};
}

test('prompts DOM: mirrors a visible #contextPrompt (Click -> LMB), the dive label and the rod stage; feed goes to raftFeed', async () => {
  const {doc, win, mk} = fakeDom();
  const notes = [];
  win.raftFeed = {note:t => (notes.push(t), {})};
  win.raftDebug = {state:{running:true, pointerLocked:true, role:'host', networkReady:true, hookStage:'idle', heldKind:null, me:{pitch:0}, build:{}}};
  doc.body.classList.add('playing');
  globalThis.window = win; globalThis.document = doc;
  try {
    const M = await import(new URL('prompts.js?hud-layout-dom', base));
    const api = M.raftPrompts; assert.ok(api);
    api.refresh(); assert.equal(api.current(), null);

    const cp = mk('div'); cp.id = 'contextPrompt'; doc.body.appendChild(cp);
    cp.appendChild(Object.assign(mk('kbd'), {_text:'Click'})); cp.appendChild(doc.createTextNode(' Water the planter'));
    api.refresh();
    assert.deepEqual(api.current(), [{key:'LMB', label:'Water the planter', hold:false, muted:false}]);
    assert.ok(doc.getElementById('lrPrompt').classList.contains('lr-on'));
    cp.hidden = true; api.refresh(); assert.equal(api.current(), null);

    win.raftDebug.state.heldKind = 'fishingrod'; win.raftFC = {state:{stage:'bite'}};
    api.refresh(); assert.equal(api.current()[0].label, 'Strike!');
    win.raftFC.state.stage = 'reeling'; api.refresh();
    assert.deepEqual(api.current()[0], {key:'LMB', label:'Reel', hold:true, muted:false});

    win.raftDebug.state.heldKind = null; win.raftDebug.state.dive = {underwater:true};
    const lab = mk('div'); lab.className = 'diveRingLabel on'; lab.textContent = 'Hold E · Coral'; doc.body.appendChild(lab);
    api.refresh(); assert.deepEqual(api.current()[0], {key:'E', label:'Coral', hold:true, muted:false});

    assert.equal(api.feed('Chapter 1 complete'), true);
    assert.deepEqual(notes, ['Chapter 1 complete']);
    assert.equal(doc.getElementById('lrFeed'), null); // no second left feed
  } finally { delete globalThis.window; delete globalThis.document; }
});

// ---------------------------------------------------------------- pickup feed + coop feed share one stack

function feedDoc() {
  const mk = tag => {
    const el = {tagName:tag.toUpperCase(), nodeType:1, children:[], parent:null, attrs:{}, textContent:'', offsetWidth:0, style:{},
      get isConnected() { let e = this; while (e.parent) e = e.parent; return e === body; },
      classList:{s:new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); }},
      setAttribute(k, v) { this.attrs[k] = v; }, prepend(c) { this.appendChild(c); this.children.unshift(this.children.pop()); },
      appendChild(c) { c.remove(); c.parent = this; this.children.push(c); return c; },
      append(...cs) { cs.forEach(c => this.appendChild(c)); },
      remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } },
      querySelector() { return this.children.find(c => c.classList.contains('out')) ?? null; },
      set className(v) { v.split(' ').forEach(c => this.classList.add(c)); },
    };
    return el;
  };
  const body = mk('body');
  return {body, createElement:mk, createElementNS:(_, t) => mk(t),
    getElementById(id) { const walk = e => e.id === id ? e : e.children.map(walk).find(Boolean); return walk(body) ?? null; }};
}

test('pickup feed: drops the oldest rows at once when the stack overflows its capped height', async () => {
  const {createFeed} = await import(new URL('pickup-feed.js', base));
  const doc = feedDoc(), feed = createFeed({doc, now:() => 0, timer:() => 0, clear() {}});
  feed.note('first');
  const host = doc.getElementById('pickupFeed');
  Object.defineProperty(host, 'clientHeight', {get:() => 100});
  Object.defineProperty(host, 'scrollHeight', {get:() => host.children.length * 45}); // 45px rows, 100px cap -> 2 fit
  feed.note('second'); feed.note('third'); feed.add('wood', 2);
  assert.equal(host.children.length, 2);
  assert.deepEqual(feed.rows, ['third', '+2 ' + (await import(new URL('inventory-state.js', base))).ITEM_INFO.wood.name]);
});

test('pickup feed: note options tag co-op lines; coop-feed routes into the shared stack', async () => {
  const {createFeed} = await import(new URL('pickup-feed.js', base));
  const doc = feedDoc(), feed = createFeed({doc, now:() => 0, timer:() => 0, clear() {}});
  const row = feed.note('Brother joined', {cls:'cf-line cf-join bad"class', color:'#7ee08a', life:6000});
  assert.ok(row.el.classList.contains('cf-line') && row.el.classList.contains('cf-join'));
  assert.ok(!row.el.classList.contains('bad"class'));
  assert.equal(row.el.children[0].style.background, '#7ee08a'); assert.equal(row.life, 6000);
  const C = await import(new URL('coop-feed.js', base));
  const got = [];
  const cdoc = {defaultView:{setTimeout() {}, clearTimeout() {}}, getElementById() { throw new Error('must not build #coopFeed'); }};
  const cf = C.createFeed({doc:cdoc, sink:{note:(t, o) => got.push([t, o.cls])}});
  cf.push('Brother left', 'leave'); cf.push('Ping', 'nope');
  assert.deepEqual(got, [['Brother left', 'cf-line cf-leave'], ['Ping', 'cf-line cf-info']]);
  cf.dispose();
});
