// Regression tests for HUD findings HUD-2..HUD-6 and UX3-1, UX3-3, UX3-8 (round 3).
// Run: node --test tests/hud-r3.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = name => readFileSync(fileURLToPath(new URL(name, base)), 'utf8');
const P = await import(new URL('prompts.js', base));

// ---------------------------------------------------------------- HUD-2 throw charge bar

test('HUD-2: the charge bar draws its fill from --c and drops the old ring mask and margin', () => {
  const rule = src('prompts.css').match(/body #chargeMeter\{[^}]*\}/)[0];
  assert.match(rule, /background:linear-gradient\(90deg,#f6ecd6 calc\(var\(--c,0\) \* 100%\)/, 'fill reads --c');
  for (const reset of ['margin:0!important', '-webkit-mask:none!important', 'mask:none!important', 'filter:none!important']) assert.ok(rule.includes(reset), reset);
  assert.match(rule, /top:calc\(50% \+ 34px\)!important/, 'sits in the prompt row');
});

test('HUD-2: the crosshair prompt steps aside while a throw charges, so bar and prompt never share a row', () => {
  assert.equal(P.promptQuiet({charging:true}), true);
  assert.equal(P.promptQuiet({inventoryOpen:true}), true);
  assert.equal(P.promptQuiet({charging:false, running:true}), false);
  assert.equal(P.promptQuiet(null), false);
  assert.match(src('prompts.js'), /blocked = [^\n]*promptQuiet\(state\)/);
});
