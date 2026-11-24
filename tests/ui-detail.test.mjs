import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL('../dist/' + f, import.meta.url), 'utf8');

test('stylesheets load no external fonts (works offline)', () => {
  for (const f of ['style.css', 'graphics.css', 'index.html']) {
    assert.doesNotMatch(read(f), /fonts\.googleapis|@import\s+url\(\s*['"]?https?:/, f);
    assert.doesNotMatch(read(f), /'DM Sans'|'Outfit'/, f);
  }
});

test('title menu hides Resume and Quit when no game is running', () => {
  const s = read('settings.js');
  assert.match(s, /\.rs-title \[data-act=resume\],#options \.rs-title \[data-act=quit\]\{display:none\}/);
  assert.match(s, /classList\.toggle\('rs-title', title\)/);
});

test('controls list the 10-slot hotbar keys', () => {
  assert.match(read('settings.js'), /\['1 - 0 \/ Wheel', 'Pick hotbar slot'\]/);
});

test('help opened from the title menu returns to the menu', () => {
  assert.match(read('settings.js'), /returnToPause = null; if \(gameActive\(\) \|\| d\.id === 'help'\) \{ open\(\);/);
});

test('inventory slots shrink so crafting and the bag fit side by side from 1000px wide', () => {
  const ui = read('survival-ui.js');
  assert.match(ui, /--s:clamp\(36px,calc\(\(100cqw - var\(--cw\) - 3 \* var\(--e\) - 26px - \$\{HB - 1\} \* var\(--g\)\) \/ \$\{HB\}\),56px\)/);
  // crafting column (tabs 50 + list + detail + 36) + bag (10 slots + 9 gaps + 26) + 3 edges fit the width
  const fits = (w, lw, dw, e) => { const cw = 50 + lw + dw + 36, s = Math.max(36, Math.min(56, (w - cw - 3 * e - 26 - 9 * 5) / 10)); return e + cw + e + 10 * s + 45 + 26 + e <= w; };
  assert.ok(fits(1536, 236, 256, 14), '1536');
  assert.ok(fits(1229, 210, 236, 10), '1229');
  assert.ok(fits(1000, 210, 236, 10), '1000');
  // Electron's 900px minimum width and phones use the stacked, scrolling column.
  assert.match(ui, /@container \(max-width:999px\) or \(max-height:519px\)\{/);
});

test('water icon differs from the empty cup', () => {
  const s = read('models.js');
  const water = s.slice(s.indexOf('  water(K) {'), s.indexOf('  planter(K) {'));
  assert.match(water, /cupBody\(K\)/);
  assert.match(water, /lathe\(/, 'water has its own surface geometry');
});
