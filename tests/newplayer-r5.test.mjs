// New-player UX round 5: honest How to play copy, red danger rows for the shark and vitals, low food/water
// guidance, one highlight per menu (pause + title), and no feed hint that repeats the hammer's build prompt.
// Run: node --test tests/newplayer-r5.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(new URL(f, base), 'utf8');

// Minimal DOM for pickup-feed.js under node.
function feedDoc() {
  const mk = tag => {
    const el = {tagName:tag.toUpperCase(), nodeType:1, children:[], parent:null, attrs:{}, textContent:'', className:'', style:{},
      get isConnected() { let e = this; while (e.parent) e = e.parent; return e === body; },
      classList:{s:new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); }},
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(c) { c.remove(); c.parent = this; this.children.push(c); return c; },
      append(...cs) { cs.forEach(c => this.appendChild(c)); },
      remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } },
      querySelector() { return null; },
    };
    return el;
  };
  const body = mk('body');
  return {body, createElement:mk, createElementNS:(_, t) => mk(t),
    getElementById(id) { const walk = e => e.id === id ? e : e.children.map(walk).find(Boolean); return walk(body) ?? null; }};
}

test('How to play no longer says nothing can hurt you; it covers eating, drinking and the shark', () => {
  for (const f of ['game.js', 'index.html']) {
    const s = src(f);
    assert.doesNotMatch(s, /Nothing can hurt you|never sinks/, f);
    assert.match(s, /guide-note/, f);
  }
  const note = /note\.textContent = '([^\n]*?)';/.exec(src('game.js'))?.[1] ?? '';
  assert.match(note, /grill fish to eat/);
  assert.match(note, /purify sea water in a cup to drink/);
  assert.match(note, /shark/i);
  assert.match(src('index.html'), /class="guide-note">[^<]*shark[^<]*</);
});

test('feed danger rows: red class and "!" badge, held 3-4 s, evicted after ordinary rows', async () => {
  const {createFeed, DANGER_MS, HOLD_MS, MAX_ROWS} = await import(new URL('pickup-feed.js', base));
  assert.ok(DANGER_MS >= 3000 && DANGER_MS <= 4000 && DANGER_MS > HOLD_MS);
  const holds = [];
  const doc = feedDoc(), feed = createFeed({doc, now:() => 0, timer:(fn, ms) => { holds.push(ms); return 0; }, clear() {}});
  const row = feed.note('The shark is biting the raft!', {kind:'danger'});
  assert.ok(row.el.classList.contains('pf-danger') && row.el.classList.contains('pf-note'));
  assert.equal(row.el.attrs.role, 'alert');
  assert.equal(row.el.children[0].className, 'pf-warn');
  assert.equal(row.el.children[0].textContent, '!');
  assert.equal(holds.at(-1), DANGER_MS);
  feed.note('plain');
  assert.ok(!doc.getElementById('pickupFeed').children.at(-1).classList.contains('pf-danger'));
  for (let i = 0; i < MAX_ROWS; i++) feed.note('row ' + i); // overflow: the older plain row goes, the danger row stays
  assert.ok(feed.rows.includes('The shark is biting the raft!'));
  assert.ok(!feed.rows.includes('plain'));
  const css = src('style.css');
  assert.match(css, /\.pf-note\.pf-danger\{[^}]*#e5483a/); // red accent
  assert.match(css, /#pickupFeed:has\(>\.pf-danger:not\(\.out\)\)>\.pf-hint\{display:none\}/); // priority over tutorial hints
  assert.match(src('pickup-feed.js'), /danger: \(text, life\) => feed\(\)\.note\(text, \{ kind: 'danger', life \}\)/);
});

test('shark warnings use the danger kind and are not capped to a blink', () => {
  const s = src('game.js');
  assert.match(s, /function notice\(s, ms = 1800, kind\) \{[^\n]*kind === 'danger'\) pickupFeed\.danger\(noticeText, ms\)/);
  assert.match(s, /function sharkEffect\(e\) \{[^\n]*\n\s*if \(typeof e\.text === 'string' && e\.text\) notice\([^\n]*'danger'\)/); // biting + tile lost
  assert.match(s, /notice\('The shark bit you!', \d+, 'danger'\)/);
  assert.match(s, /text:'The shark is biting the raft!'/);
  assert.match(s, /text:'The shark tore a foundation off the raft!'/);
});

test('low food / water: one danger hint below 25, re-armed after recovering above 50', async () => {
  const {createVitalsWarner, VITAL_WARNINGS, WARN_BELOW, REARM_ABOVE} = await import(new URL('vitals-ui.js', base));
  assert.equal(WARN_BELOW, 25); assert.equal(REARM_ABOVE, 50);
  assert.match(VITAL_WARNINGS.water, /Thirsty.*Cup.*Purifier/);
  assert.match(VITAL_WARNINGS.food, /Hungry.*grilled fish.*Grill/);
  const said = [], check = createVitalsWarner(t => said.push(t));
  check({hp:100, food:80, water:30}); assert.deepEqual(said, []);
  check({hp:100, food:80, water:24}); assert.deepEqual(said, [VITAL_WARNINGS.water]);
  check({hp:100, food:80, water:10}); check({hp:100, food:80, water:40}); check({hp:100, food:80, water:20});
  assert.equal(said.length, 1, 'no repeat until water recovers above 50');
  check({hp:100, food:80, water:60}); check({hp:100, food:80, water:20});
  assert.deepEqual(said, [VITAL_WARNINGS.water, VITAL_WARNINGS.water]);
  check({hp:100, food:20, water:60}); assert.equal(said.at(-1), VITAL_WARNINGS.food);
  check({hp:90, food:0, water:60, starving:true}); check({hp:80, food:0, water:60, starving:true});
  assert.equal(said.filter(t => t === VITAL_WARNINGS.starving).length, 1);
});

test('vitals HUD posts its warnings to the feed as danger rows', () => {
  const s = src('vitals-ui.js');
  assert.match(s, /export function createVitalsUI\(doc = document, \{warn = feedDanger\} = \{\}\)/);
  assert.match(s, /const feedDanger = text => \{[^\n]*f\.danger\(text\)/);
  assert.match(s, /if \(!show\) return;\s*if \(!fainted\) checkWarnings\(v\);/);
});

test('pause menu: one highlight at a time, UI font for the items', () => {
  const s = src('settings.js');
  assert.match(s, /#options \.rs-menu button\{[^}]*font:600 [^;]*var\(--ui-font/);
  const hi = /\n([^\n{]*)\{color:var\(--amber-lt,#ffc96b\);padding-left:28px/.exec(s)?.[1] ?? '';
  assert.ok(hi, 'highlight rule found');
  for (const sel of hi.split(',')) if (!/button:hover$/.test(sel)) assert.match(sel, /:not\(:has\(button:hover\)\)/, sel);
  const bar = /\n([^\n{]*)\{opacity:1;transform:translateY\(-50%\) scaleX\(1\)\}/.exec(s)?.[1] ?? '';
  for (const sel of bar.split(',')) if (!/button:hover::before$/.test(sel)) assert.match(sel, /:not\(:has\(button:hover\)\)/, sel);
  assert.match(s, /#options \.rs-menu:has\(button:hover\) button:focus-visible:not\(:hover\)\{outline:0\}/); // beats #options :focus-visible
});

test('title menu: focus styling yields to the hovered item', () => {
  const css = src('onboarding.css');
  const rules = css.split('\n').filter(l => /\.ob-item:focus/.test(l));
  assert.ok(rules.length >= 3);
  assert.match(css, /\.ob-menu:has\(\.ob-item:hover\) \.ob-item:focus-visible:not\(:hover\)\{outline:0\}/); // beats button:focus-visible
  for (const l of rules.filter(r => !/:not\(:hover\)/.test(r))) for (const sel of l.slice(0, l.indexOf('{')).split(',')) if (/:focus/.test(sel)) assert.match(sel, /\.ob-menu:not\(:has\(\.ob-item:hover\)\)/, sel);
});

test('the hammer build hint stays quiet while the build prompt already says it', async () => {
  const {HINTS, nextHint} = await import(new URL('hud.js', base));
  const done = new Set(HINTS.filter(h => h.id !== 'build').map(h => h.id));
  assert.equal(nextHint(done, {heldKind:'hammer'})?.id, 'build');
  assert.equal(nextHint(done, {heldKind:'hammer', buildPrompt:true}), null);
  assert.match(src('game.js'), /nextHint\(hintsDone, \{[^}]*buildPrompt:!!building\}\)/);
});
