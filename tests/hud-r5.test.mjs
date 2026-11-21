// HUD round 5: no HUD panel overlaps another at common window sizes, and nothing is centred on the aim point.
// Browser check: python tests/audit/hud5_overlaps.py. Run: node --test tests/hud-r5.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(fileURLToPath(new URL(f, base)), 'utf8');
const rule = (css, sel) => { // the first rule whose selector list is exactly `sel`
  const m = new RegExp('(^|[}\\n`{])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{').exec(css); assert.ok(m, `rule ${sel}`);
  return css.slice(m.index, css.indexOf('}', m.index + m[0].length));
};
const px = (s, re) => { const m = re.exec(s); assert.ok(m, String(re)); return +m[1]; };
const vitalsLift = () => px(src('vitals-ui.js'), /@media\(max-width:(\d+)px\)\{#lrVitals\{bottom:\d+px\}\}/);

test('H1: the feed lifts at the same width as the vitals panel', () => {
  const w = vitalsLift();
  assert.equal(px(src('game.js'), /@media\(max-width:(\d+)px\)\{#pickupFeed\[popover\]\{inset:auto auto calc\(182px/), w, 'game.js popover feed');
  assert.equal(px(src('style.css'), /@media\(max-width:(\d+)px\)\{#pickupFeed\{bottom:calc\(182px/), w, 'style.css feed');
  assert.equal(px(src('prompts.css'), /@media\(max-width:(\d+)px\)\{#lrFeed\{bottom:182px/), w, 'prompts.css fallback feed');
  // no leftover feed rule at another breakpoint between the hotbar gutter and the narrow-phone layout
  for (const f of ['game.js', 'style.css', 'prompts.css'])
    for (const [, n] of src(f).matchAll(/@media\(max-width:(\d+)px\)\{#(?:pickupFeed|lrFeed)/g)) assert.ok(+n === w || +n <= 760, `${f}: feed breakpoint ${n}`);
});

test('H1: the lifted feed starts above the lifted vitals panel', () => {
  const vb = px(src('vitals-ui.js'), /@media\(max-width:\d+px\)\{#lrVitals\{bottom:(\d+)px\}\}/);
  const vitalsH = 77; // measured: 3 rows + padding + border (hud5_overlaps.py)
  assert.ok(vb + vitalsH < 182, `vitals top ${vb + vitalsH} < 182`);
});

test('H2: the faint text keeps the veil but sits bottom-left, not on the crosshair', () => {
  const f = rule(src('vitals-ui.js'), '#lrFaint');
  assert.match(f, /inset:0/); assert.match(f, /background:#0b0604e6/);
  assert.match(f, /place-items:end start/); assert.doesNotMatch(f, /place-items:center/);
  assert.match(f, /padding:0 0 \d+vh \d+vw/);
  assert.match(src('vitals-ui.js'), /#lrFaint small\{[^\n]*text-align:left\}/);
});

test('H3: the pinned tracker lifts above the hotbar when there is no room beside it', () => {
  const css = src('survival-ui.js'), base = rule(css, '#craftTracker');
  const width = px(base, /width:(\d+)px/), right = px(base, /right:(\d+)px/);
  const bp = px(css, /@media\(max-width:(\d+)px\)\{#craftTracker\{bottom:\d+px/);
  const hotbar = 570; // 10 slots, centred
  // above the breakpoint the tracker clears the hotbar's right edge; at it there is no gap left
  for (let w = bp + 1; w <= 3840; w++) assert.ok(w - right - width > w / 2 + hotbar / 2, `tracker clears hotbar at ${w}px`);
  assert.ok(bp - right - width <= bp / 2 + hotbar / 2 + 16, 'the breakpoint is not wider than needed');
  const lifted = px(css, /@media\(max-width:\d+px\)\{#craftTracker\{bottom:(\d+)px/);
  assert.ok(lifted >= 82 + 8, `tracker bottom ${lifted} sits above the hotbar top (82px)`);
  assert.match(css, /#craftTracker\{bottom:\d+px;max-height:150px;overflow:hidden\}/);
  // the Notes rows stop above the tracker's reserve: 184 top + 48 head/padding + rows + 8 gap + 150 + 90
  assert.match(css, /body:has\(#craftTracker:not\(\[hidden\]\)\) \.ob-notes \.ob-rows\{max-height:max\(24px,calc\(100vh - 480px\)\);overflow:hidden\}/);
  assert.equal(px(src('onboarding.css'), /\.ob-notes\{[^}]*top:(\d+)px/), 184);
});

test('H4: the lifted feed rises above the hammer chip while it shows', () => {
  const bm = src('build-menu.js');
  const h = px(bm, /body:has\(\.bm-chip:not\(\[hidden\]\)\)\{--bm-chip-h:(\d+)px\}/);
  const chipBottom = px(rule(bm, '.bm-chip'), /bottom:var\(--bm-chip-bottom,(\d+)px\)/);
  const chipMaxH = 70; // icon row + hint + status line, measured ~54-67px
  assert.ok(182 + h >= chipBottom + chipMaxH + 4, `feed bottom ${182 + h} clears chip top ${chipBottom + chipMaxH}`);
  assert.match(src('game.js'), /#pickupFeed\[popover\]\{inset:auto auto calc\(182px \+ var\(--coop-feed-h, 0px\) \+ var\(--bm-chip-h, 0px\)\) 10px\}/);
  assert.match(src('style.css'), /#pickupFeed\{bottom:calc\(182px \+ var\(--coop-feed-h, 0px\) \+ var\(--bm-chip-h, 0px\)\)/);
});

test('H5: the side prompt wraps before the onboarding Notes', () => {
  const p = rule(src('prompts.css'), '#lrPrompt');
  assert.match(p, /left:calc\(50% \+ 34px\)/); assert.doesNotMatch(p, /white-space:nowrap/);
  const m = /max-width:max\((\d+)px,calc\(50vw - (\d+)px\)\)/.exec(p); assert.ok(m, 'max-width');
  const notes = rule(src('onboarding.css'), '.ob-notes');
  const nr = px(notes, /right:(\d+)px/), nw = px(notes, /width:(\d+)px/);
  // prompt right edge = 50vw + 34 + (50vw - k) must stay >= 8px left of the Notes' left edge (100vw - right - width)
  assert.ok(34 + +m[2] >= nr + nw + 8, `prompt stops ${34 + +m[2] - nr - nw}px before the Notes`);
  assert.ok(+m[1] >= 80, 'sane minimum width');
});
