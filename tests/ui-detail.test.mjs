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

test('water icon differs from the empty cup', () => {
  const s = read('models.js');
  const water = s.slice(s.indexOf('  water(K) {'), s.indexOf('  planter(K) {'));
  assert.match(water, /cupBody\(K\)/);
  assert.match(water, /lathe\(/, 'water has its own surface geometry');
});
