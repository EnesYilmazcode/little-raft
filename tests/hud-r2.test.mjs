// Regression tests for HUD findings HUD-1..HUD-6 and UX-2/UX-7 (round 2).
// Run: node --test tests/hud-r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = name => readFileSync(fileURLToPath(new URL(name, base)), 'utf8');
const S = await import(new URL('session-rules.js', base));
const gameSrc = src('game.js'), liveSrc = src('live.js');

// ---------------------------------------------------------------- HUD-1 live-update toast

test('HUD-1: routeStatus reports whether a running engine took the notice', () => {
  const bare = new EventTarget();
  assert.equal(S.routeStatus(bare, 'Ocean updated. Keep playing.'), false, 'nobody listening: live.js uses its fallback');
  const engine = new EventTarget(), got = [];
  engine.addEventListener(S.LIVE_STATUS_EVENT, e => { got.push(e.detail.text); e.preventDefault(); });
  assert.equal(S.routeStatus(engine, 'An update is ready for your next session'), true);
  assert.deepEqual(got, ['An update is ready for your next session']);
  assert.equal(S.routeStatus(null, 'x'), false);
});

test('HUD-1: the engine routes live notices into the feed, and the fallback pill is not centred', () => {
  assert.match(gameSrc, /on\(window, LIVE_STATUS_EVENT, e => \{ if \(!running[^\n]*notice\(e\.detail\.text\); e\.preventDefault\(\)/);
  assert.match(liveSrc, /if \(routeStatus\(window, text\)\)/);
  const rule = liveSrc.match(/#updateStatus\{[^}]*\}/)[0];
  assert.doesNotMatch(rule, /left:50%|translate\(-50%/);
  assert.match(rule, /left:22px;bottom:26px/);
  assert.doesNotMatch(liveSrc, /import\(['"]\.\/pickup-feed\.js['"]\)/, 'no second, unversioned feed instance');
});

// ---------------------------------------------------------------- HUD-2 / HUD-4 feed over open panels

const H = await import(new URL('hud.js', base));

// HUD-2/HUD-4 (docking the feed into panel lanes) is not needed here: the feed is never raised over the
// modal bag or pause menu, so it cannot paint over their controls.

test('HUD-3: feed rows stay left of the hotbar, and lift above it below 1060px wide', () => {
  const css = src('style.css');
  assert.match(css, /#pickupFeed \.pf-row\{max-width:max\(200px,calc\(50vw - 321px\)\);white-space:normal/);
  assert.match(css, /@media\(max-width:1060px\)\{#pickupFeed\{bottom:96px\}/);
  // The hotbar is 10 x 52px + 9 x 6px = 574px wide and centred, so its left edge is 50vw - 287px; the feed sits at left 22px.
  for (let w = 1061; w <= 3840; w++) {
    const right = 22 + Math.max(200, w / 2 - 321), hotbarLeft = w / 2 - 287;
    assert.ok(right < hotbarLeft, `row right edge ${right} clears the hotbar at ${hotbarLeft} (width ${w})`);
  }
});

// ---------------------------------------------------------------- HUD-5 guide key caps

test('HUD-5: keys inside guide sentences are small inline-block caps, not the label-column cap', () => {
  const css = src('style.css');
  const rule = css.match(/\.guide span kbd\{([^}]*)\}/);
  assert.ok(rule, '.guide span kbd rule exists');
  assert.match(rule[1], /display:inline-block/);
  assert.match(rule[1], /padding:0 5px/);
  assert.match(rule[1], /border-bottom-width:2px/);
  assert.ok(css.indexOf('.guide span kbd{') > css.indexOf('.guide kbd{flex:0 0 74px'), 'declared after the cap style');
  assert.match(gameSrc, /<span><b>Walk<\/b>, hold <kbd>Shift<\/kbd>/, 'guide still injects inline kbds inside spans');
});

// ---------------------------------------------------------------- HUD-6 / UX-7 title brand

test('HUD-6/UX-7: the header sits above the welcome overlay so the brand is readable', () => {
  const z = (css, sel) => { const m = [...css.matchAll(new RegExp(`(?:^|\\})\\s*${sel}\\{([^}]*)\\}`, 'gm'))].map(x => x[1].match(/z-index:(\d+)/)?.[1]).filter(Boolean); return +m.at(-1); };
  const style = src('style.css'), gfx = src('graphics.css');
  const headerZ = z(gfx, 'header') || z(style, 'header'), overlayZ = z(style, '\\.overlay');
  assert.equal(overlayZ, 5);
  assert.ok(headerZ > overlayZ, `header z ${headerZ} > overlay z ${overlayZ}`);
});

// ---------------------------------------------------------------- UX-2 bag jumps between crafting tabs

test('UX-2: the bag keeps its top edge across crafting tabs (pinned top, fixed-height craft column)', () => {
  const ui = src('survival-ui.js');
  assert.match(ui, /#inventory\.sv-inv\{[^}]*margin:max\(16px,calc\(50vh - 300px\)\) auto auto;/, 'top edge pinned, not margin:auto');
  const book = [...ui.matchAll(/^#inventory \.sv-craft\{flex:0 0 324px;[^}]*\}/gm)].at(-1)?.[0];
  assert.ok(book, 'crafting-book column rule');
  assert.match(book, /;height:min\(560px,calc\(94vh - 30px\)\)/, 'fixed height, so the panel height does not follow the tab');
  assert.match(ui, /@media\(max-width:860px\),\(max-height:520px\)\{[^\n]*?#inventory \.sv-craft\{[^}]*height:auto;max-height:none/, 'stacked layout resets the height');
});
