// HUD round 6: top-corner toasts on narrow screens, pickup rows at phone width, hotkeys while fainted, faint heading.
// Source/CSS checks (the HUD modules inject their CSS as strings). Run: node --test tests/hud-r6.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../dist/${f}`, import.meta.url), 'utf8');
const media = (s, w) => { // bodies of every @media(max-width:<w>px){...} block
  const out = []; const re = new RegExp(`@media\\s*\\(max-width:\\s*${w}px\\)\\s*\\{`, 'g'); let m;
  while ((m = re.exec(s))) { let d = 1, i = re.lastIndex; for (; i < s.length && d; i++) d += s[i] === '{' ? 1 : s[i] === '}' ? -1 : 0; out.push(s.slice(re.lastIndex, i - 1)); }
  return out.join('\n');
};

test('#lb-toast has a usable minimum width and a narrow-screen layout', () => {
  const s = src('logbook-ui.js');
  assert.match(s, /#lb-toast\{[^}]*max-width:max\(220px,/, 'never shrinks to a couple of letters');
  const m = media(s, 760);
  assert.match(m, /#lb-toast\{[^}]*max-width:calc\(100vw - 1\d\dpx\)/, 'narrow: width follows the viewport');
  assert.match(m, /#lb-toast\{[^}]*top:12px/);
});

test('#fcToast sits below #fcChip at <=900px and is width-capped', () => {
  const s = src('fishing-cooking.js');
  const m = media(s, 900);
  assert.match(m, /#fcChip\{[^}]*top:12px/);
  const top = /#fcToast\{[^}]*top:(\d+)px/.exec(m);
  assert.ok(top && +top[1] >= 40, 'toast starts below the chip');
  assert.match(m, /#fcToast\{[^}]*max-width:[^;}]*100vw/, 'width capped to stay clear of the compass');
});

test('#pickupFeed rows are readable at phone width and .pf-hint keeps its own width', () => {
  const s = src('game.js');
  const m = media(s, 760);
  assert.match(m, /#pickupFeed \.pf-row\{max-width:min\(260px,calc\(100vw - 150px\)\)\}/);
  assert.match(s, /#pickupFeed \.pf-row\.pf-hint\{[^}]*max-width:max\(180px/, 'hint rule out-specifies the row media rules');
});

test('fishing hotkeys (J/G) are blocked while fainted', () => {
  const s = src('game.js');
  assert.match(s, /uiBlocked:\s*\(\)\s*=>\s*uiBlocked\(\)\s*\|\|\s*fainted >= 0/);
});

test('faint heading is centred, not just the small line', () => {
  const s = src('vitals-ui.js');
  assert.match(s, /#lrFaint div\{[^}]*text-align:center/);
});
