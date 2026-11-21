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

test('inventory slots shrink to fit a 900px window', () => {
  // 10 slots + gaps + 300px crafting column + padding must fit inside 96vw at Electron's minWidth.
  assert.match(read('survival-ui.js'), /#inventory\.sv-inv\{--s:min\(56px,calc\(\(96vw - 380px\) \/ 10 - 6px\)\)/);
  const s = Math.min(56, (0.96 * 900 - 380) / 10 - 6);
  assert.ok(10 * s + 9 * 6 + 24 + 300 + 14 + 28 <= 0.96 * 900);
});

test('water icon differs from the empty cup', () => {
  const s = read('models.js');
  const water = s.slice(s.indexOf('  water(K) {'), s.indexOf('  planter(K) {'));
  assert.match(water, /cupBody\(K\)/);
  assert.match(water, /lathe\(/, 'water has its own surface geometry');
});
