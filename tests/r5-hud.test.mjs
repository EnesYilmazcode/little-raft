// Round 5 HUD layout: nothing centred in play, nothing overlapping, responsive.
// Tracker above the hotbar (761-1060), Notes stop above the tracker / prompt column, build chip right of the vitals,
// sail prompts in the one prompt column, treasure finder readout in the prompt column, vitals above the hotbar (761-1000).
// Run: node --test tests/r5-hud.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(new URL(f, base), 'utf8');
const O = await import(new URL('onboarding.js', base));
const P = await import(new URL('prompts.js', base));
const px = (re, s) => { const m = re.exec(s); assert.ok(m, `no match for ${re}`); return +m[1]; };

// The hotbar: 52px slots (clamp(52px,3.2vw,68px) up to ~1625px wide), 5px padding, 22px from the bottom.
const HOTBAR_TOP = 22 + 52 + 10; // px from the bottom edge
const hotbarLeft = w => w / 2 - 285, hotbarRight = w => w / 2 + 285;

test('HUD-1: the pinned-recipe tracker stands on the hotbar wherever the hotbar reaches under it', () => {
  const css = src('survival-ui.js');
  const lift = px(/@media\(min-width:761px\) and \(max-width:(\d+)px\)\{#craftTracker\{bottom:\d+px\}\}/, css);
  const bottom = px(/@media\(min-width:761px\) and \(max-width:\d+px\)\{#craftTracker\{bottom:(\d+)px\}\}/, css);
  assert.ok(bottom > HOTBAR_TOP + 6, 'clears the hotbar');
  // tracker: right 16, width 220 -> its left edge is W - 236; above the lift range it must clear the hotbar
  for (let w = 761; w <= 1920; w++) if (w > lift) assert.ok(w - 236 > hotbarRight(w), `tracker over slots 9/0 at ${w}px`);
  assert.ok(lift >= 1042 && lift <= 1100);
});

test('HUD-7: the vitals stand on the hotbar wherever its left end reaches under them; the feed stays above them', () => {
  const css = src('vitals-ui.js');
  const max = px(/@media\(min-width:761px\) and \(max-width:(\d+)px\)\{#lrVitals\{bottom:\d+px\}\}/, css);
  const bottom = px(/@media\(min-width:761px\) and \(max-width:\d+px\)\{#lrVitals\{bottom:(\d+)px\}\}/, css);
  assert.ok(bottom > HOTBAR_TOP + 6);
  const vitalsRight = 12 + px(/#lrVitals\{[^}]*width:(\d+)px/, css);
  for (let w = 761; w <= 1920; w++) if (w > max) assert.ok(hotbarLeft(w) > vitalsRight, `hotbar under the vitals at ${w}px`);
  // vitals ~77px tall: every feed placement in that range starts above them
  const feedRe = new RegExp(`@media\\(min-width:761px\\) and \\(max-width:${max}px\\)\\{#pickupFeed(?:\\[popover\\])?\\{[^}]*?(\\d+)px \\+ var\\(--coop-feed-h`);
  assert.ok(px(feedRe, src('style.css')) >= bottom + 80);
  assert.ok(px(feedRe, src('game.js')) >= bottom + 80);
  assert.match(src('prompts.css'), new RegExp(`@media\\(min-width:761px\\) and \\(max-width:${max}px\\)\\{#lrFeed\\{bottom:184px`));
});

test('HUD-4: the build chip starts right of the vitals panel and stops short of the tracker', () => {
  const css = src('build-menu.js'), vit = src('vitals-ui.js');
  const narrow = css.match(/@media\(max-width:760px\)\{\.bm-chip\{[^}]*\}/)[0];
  const compactRight = 12 + px(/@media\(max-width:760px\)\{#lrVitals\{[^}]*width:(\d+)px/, vit);
  assert.ok(px(/left:(\d+)px/, narrow) >= compactRight + 8);
  assert.match(narrow, /max-width:calc\(100vw - \d+px\)/);
  // <=760: tracker right 10 + width 180 -> chip right edge (left + max-width) must stay left of W - 190
  assert.ok(px(/max-width:calc\(100vw - (\d+)px\)/, narrow) - px(/left:(\d+)px/, narrow) >= 190 + 8);
  const mid = css.match(/@media\(min-width:761px\) and \(max-width:1000px\)\{\.bm-chip\{[^}]*\}/)[0];
  assert.ok(px(/left:(\d+)px/, mid) >= 188 + 8);
  assert.ok(px(/max-width:calc\(100vw - (\d+)px\)/, mid) - px(/left:(\d+)px/, mid) >= 236 + 8); // tracker: right 16 + width 220
  assert.ok(px(/--bm-chip-bottom:(\d+)px/, mid) > HOTBAR_TOP + 6);
  // short windows: the chip rises level with the prompt column, so its right edge stops at the crosshair (50% + 22px)
  assert.equal(152 - px(/@media\(max-width:760px\) and \(max-height:480px\)\{\.bm-chip\{max-width:calc\(50vw - (\d+)px\)/, css), 22);
  assert.equal(200 - px(/@media\(min-width:761px\) and \(max-width:1000px\) and \(max-height:480px\)\{\.bm-chip\{max-width:calc\(50vw - (\d+)px\)/, css), 22);
});

test('HUD-5: sail and anchor prompts go through the one prompt column, not a boxed #sailPrompt', () => {
  const s = src('sailing-world.js');
  assert.doesNotMatch(s, /ui\.setPrompt\(/);
  assert.match(s, /raftPrompts;[^\n]*provide/);
  assert.match(s, /provide\(\{ id: 'sailing', priority: 1/);
  assert.match(s, /unprovide\?\.\(\)/); // dispose drops the provider
  // the rows are plain {key,label} prompts that normalise to the E / Hold R pair the old markup parsed to
  const rows = eval(s.match(/const STEER_R = (Object\.freeze\(\{[^}]*\}\));/)[1]);
  assert.deepEqual(P.normalizePrompt([{ key: 'E', label: 'Raise sail' }, rows]),
    [{ key: 'E', label: 'Raise sail', hold: false, muted: false }, { key: 'R', label: 'Steer', hold: true, muted: false }]);
  assert.doesNotMatch(s, /<kbd>/);
});

test('HUD-6: the treasure finder readout sits in the prompt column, not centred at the top', () => {
  const css = src('treasure.js').match(/hud\.id = 'treasureHud'[\s\S]*?hud\.style\.cssText = '([^']*)'/)[1];
  assert.doesNotMatch(css, /left:50%|translateX\(-50%\)|top:12%/);
  assert.match(css, /left:calc\(50% \+ 34px\)/);
  assert.match(css, /bottom:calc\(50% \+ 20px\)/); // above the crosshair, like #binocularsHud
  assert.match(css, /max-width:calc\(50vw - 50px\)/);
});

test('HUD-2/3: Notes stop above whatever shares their column', () => {
  const notes = {left:536, right:784, top:184, bottom:413};
  assert.equal(O.notesCap(notes, []), null);
  assert.equal(O.notesCap(notes, [null]), null);
  // tracker below the Notes in the same column: stop 8px above it
  assert.equal(O.notesCap(notes, [{left:564, right:784, top:397, bottom:504}]), 397 - 8 - 184);
  // a prompt row reaching in from the crosshair side
  assert.equal(O.notesCap(notes, [{left:434, right:560, top:326, bottom:346}, {left:564, right:784, top:397, bottom:504}]), 326 - 8 - 184);
  // a prompt left of the column (more than the gap away) does not count
  assert.equal(O.notesCap(notes, [{left:434, right:520, top:326, bottom:346}]), null);
  // something above the Notes (the compass) does not count; something covering their top gives a cap below 0
  assert.equal(O.notesCap(notes, [{left:700, right:784, top:64, bottom:170}]), null);
  assert.ok(O.notesCap(notes, [{left:500, right:700, top:150, bottom:200}]) < 0);
  // cut between whole rows, keep at least the header strip
  assert.equal(O.fitRows(150, 36, [80, 140, 210]), 140);
  assert.equal(O.fitRows(60, 36, [80, 140]), 36);
  assert.deepEqual(O.PROMPT_COL.slice(0, 4), ['#lrPrompt.lr-on', '#binocularsHud', '#treasureHud', '#fcReelHud.show']);
  const js = src('onboarding.js'), css = src('onboarding.css');
  assert.match(js, /function layoutColumn\(\)/);
  assert.match(js, /setAttribute\('data-ob-yield'/);
  assert.match(css, /\.ob-notes\.ob-capped\{overflow:hidden\}/);
  assert.match(css, /\.ob-notes\.ob-capped \.ob-cut\{visibility:hidden\}/); // no half row peeking through the padding
  assert.match(js, /innerHeight \+ 1\}/); // short windows: never past the bottom edge
  assert.match(js, /visRect\(\$\('\.tools\.sv-hotbar'\)\)/); // nor over the hotbar
  assert.match(css, /\.ob-notes\.ob-clear\{opacity:0;visibility:hidden\}/);
  assert.match(css, /#craftTracker\[data-ob-yield\]\{opacity:0;visibility:hidden\}/);
});
