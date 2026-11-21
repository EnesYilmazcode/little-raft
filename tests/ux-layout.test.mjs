// UX layout regressions (round 2): first-run hint order, one wording for bag keys and reel prompts,
// nothing in play pinned to the screen centre, help in the pause panel, one menu palette.
// Run: node --test tests/ux-layout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = (f) => readFileSync(fileURLToPath(new URL(f, base)), 'utf8');
const H = await import(new URL('hud.js', base));

test('UX2-3: the hint chain teaches look and walk before throwing', () => {
  const ids = H.HINTS.map((h) => h.id);
  assert.deepEqual(ids.slice(0, 3), ['look', 'walk', 'throw']);
  assert.ok(ids.indexOf('throw') < ids.indexOf('bag') && ids.indexOf('bag') < ids.indexOf('slots'));
  assert.match(H.HINTS[0].text, /mouse/i);
  assert.match(H.HINTS[1].text, /W A S D/);
  const fresh = new Set();
  assert.equal(H.nextHint(fresh, { heldKind: 'hook' })?.id, 'look');
  fresh.add('look');
  assert.equal(H.nextHint(fresh, { heldKind: 'hook' })?.id, 'walk');
});

test('UX2-3: a save that already threw skips the look and walk hints', () => {
  const m = new Map([[H.HINT_KEY, JSON.stringify(['throw'])]]);
  const done = H.loadHints({ getItem: (k) => m.get(k) ?? null });
  assert.ok(done.has('look') && done.has('walk'));
  assert.notEqual(H.nextHint(done, { heldKind: 'hook', hasLoot: true })?.id, 'look');
});

test('UX2-3: game.js marks look and walk done from real input', () => {
  const g = src('game.js');
  assert.match(g, /hintDone\('look'\)/);
  assert.match(g, /hintDone\('walk'\)/);
  assert.match(g, /LOOK_DONE_RAD/);
  assert.match(g, /WALK_DONE_S/);
});

test('UX2-3: bag keys use one phrasing in the hint, Settings, help and the bag footer', () => {
  assert.equal(H.BAG_OPEN_KEYS, 'Tab, I or E');
  assert.equal(H.BAG_CLOSE_KEYS, 'Tab, E, I or Esc'); // raft-master: Tab toggles the bag closed too
  assert.ok(H.HINTS.find((h) => h.id === 'bag').text.includes(H.BAG_OPEN_KEYS));
  const settings = src('settings.js'), game = src('game.js'), bag = src('survival-ui.js');
  assert.ok(settings.includes(`'${H.BAG_OPEN_KEYS}'`), 'Settings controls list says how to open the bag');
  assert.ok(settings.includes(`'${H.BAG_CLOSE_KEYS}'`), 'Settings controls list says how to close the bag');
  assert.match(game, /\$\{BAG_OPEN_KEYS\} opens the bag/);
  assert.match(game, /\$\{BAG_CLOSE_KEYS\} closes it/);
  assert.ok(bag.includes(`${H.BAG_CLOSE_KEYS} closes`), 'bag footer closes with the same keys');
  // the old competing phrasings are gone
  for (const [name, s] of [['settings.js', settings], ['game.js', game], ['hud.js', src('hud.js')], ['index.html', src('index.html')]]) {
    assert.doesNotMatch(s, /Tab \/ I'|Tab or E\b|'Inventory'\]/, name);
  }
});

test('UX2-3: one reel prompt wording', () => {
  assert.equal(H.REEL_PROMPT, 'Hold click to reel in');
  const g = src('game.js');
  assert.match(g, /html = REEL_PROMPT;/);
  assert.doesNotMatch(g, /'Hold click to reel it in'|'Hold click to reel'/);
});

const ruleFor = (css, selector) => {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let m; (m = re.exec(css));) if (m[1].split(',').some((s) => s.trim() === selector)) out.push(m[2]);
  return out;
};
const allCss = () => [src('style.css'), src('graphics.css'), src('game.js'), src('settings.js'), src('prompts.css'), src('sailing-ui.js')].join('\n');

// Merged into raft-master: prompts stay beside the crosshair and the throw charge is a ring on the reticle
// (raft-master's layout), so the round-2 edge-stack and power-bar checks were dropped here.
test('UX2-2/6: no in-play prompt is centred on the screen', () => {
  const css = allCss();
  for (const sel of ['#lrPrompt', '#sailPrompt', 'body #resumeHint']) {
    for (const body of ruleFor(css, sel)) assert.doesNotMatch(body, /left:\s*50%;[^}]*transform:\s*translateX\(-50%\)[^}]*top:\s*50%/, `${sel} must not sit on the screen centre`);
  }
});

test('UX2-2: How to play opens in the pause panel slot, not a separate centred dialog', () => {
  const s = src('settings.js');
  assert.match(s, /data-panel="help"/);
  assert.match(s, /act === 'settings' \|\| act === 'help'\) \{ setPanel\(/);
  assert.doesNotMatch(s, /act === 'help' \|\| act === 'crew'/);
  // the panel is attached to the rail: full height, no floating frame
  const panel = ruleFor(s, '#options .rs-panel')[0]; // base rule (the phone layout stacks it)
  assert.match(panel, /height:100%/);
  assert.match(panel, /overflow:auto/);
  assert.doesNotMatch(panel, /margin-top:max/);
});

test('UX2-7: one font stack and palette, styled preset control, one rail highlight', () => {
  const g = src('graphics.css'), s = src('settings.js'), bag = src('survival-ui.js');
  assert.match(g, /--display-font:var\(--ui-font\)/);
  assert.doesNotMatch(s, /<select/, 'no native dropdown in settings');
  assert.match(s, /class="rs-seg" role="radiogroup"/);
  assert.match(s, /\.rs-menu:hover button:focus-visible:not\(:hover\)\{background:none/);
  assert.doesNotMatch(s, /Georgia|[^-]serif/);
});

test('UX2-8: title has one co-op button, a labelled menu button and a legible logo', () => {
  const html = src('index.html'), g = src('graphics.css');
  assert.doesNotMatch(html, /id="crewButton"/);
  assert.match(html, /id="welcomeCrew">/);
  assert.match(html, /id="helpButton" aria-label="[^"]+" title="[^"]+"><span class="help-glyph" aria-hidden="true">\?<\/span> Menu</);
  assert.match(g, /header\{inset:20px 28px auto;z-index:6\}/, 'header sits above the title overlay');
});
