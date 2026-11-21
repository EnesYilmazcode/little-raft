// Regression: survival-ui assigned an undeclared `justMade` inside startHold/stopHold.
// ES modules are strict, so the Craft button threw and nothing could be crafted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../dist/survival-ui.js', import.meta.url), 'utf8');

function declared(name) {
  const decl = new RegExp(`(?:\\blet|\\bconst|\\bvar|\\bfunction)\\s+(?:[\\w$,\\s{}=]*?[\\s,{])?${name}\\b`);
  const param = new RegExp(`\\(([^()]*\\b${name}\\b[^()]*)\\)\\s*(?:=>|\\{)`);
  const destr = new RegExp(`(?:let|const|var)\\s*[\\[{][^\\]}]*\\b${name}\\b`);
  return decl.test(src) || param.test(src) || destr.test(src);
}

test('every bare statement-level assignment in survival-ui targets a declared name', () => {
  const names = new Set();
  for (const m of src.matchAll(/^[ \t]*([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\+=|-=|\|\|=|\?\?=)/gm)) names.add(m[1]);
  const missing = [...names].filter(n => !declared(n));
  assert.deepEqual(missing, [], `undeclared assignments: ${missing.join(', ')}`);
});

test('the hold-to-craft path no longer references justMade', () => {
  assert.ok(!/\bjustMade\b/.test(src));
});
