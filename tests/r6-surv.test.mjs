// Round-6 survival regressions: fainting blocks input, solo pause stops the shark, spear wear/repair, shader warm-up vs dispose.
// Run: node --test tests/r6-surv.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const game = readFileSync(new URL('game.js', base), 'utf8');
const fnBody = (name, src = game) => {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' exists');
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1); }
  throw new Error('unbalanced ' + name);
};
const head = (src) => src.split("\n").slice(0, 3).join('\n');

test('V1: every input entry point refuses while passed out', () => {
  for (const name of ['beginCharge', 'releaseCharge', 'interact', 'openInventory', 'repair', 'selectSlot', 'pickBuildPiece']) {
    assert.match(head(fnBody(name)), /fainted >= 0/, name + ' checks fainted');
  }
  // releaseCharge still drops the charge before the check, so a press held into the faint never throws later
  assert.match(fnBody('releaseCharge'), /const c = charging; charging = null;\s*\n\s*if \(!c \|\| !running \|\| fainted >= 0/);
  const down = game.slice(game.indexOf("on(canvas, 'pointerdown'"), game.indexOf("on(canvas, 'pointermove'"));
  assert.match(down.split('\n')[1], /fainted >= 0\) return/, 'canvas pointerdown bails first (tool, wheel, fc)');
  assert.match(game, /useDown:\(\) => \{ if \(fainted >= 0\) return;/, 'pad / input-layer use bails');
  assert.match(game, /if \(running && fainted >= 0\) \{[^\n]*return; \}[^\n]*\n\s*if \(running && building\?\.key/, 'legacy keydown acts on nothing while passed out');
});

test('V1: waking clears any hook/charge and re-checks the pointer UI', () => {
  const v = fnBody('updateVitals');
  const wake = v.slice(v.indexOf('if (fainted >= 2.6)'), v.indexOf("notice('You wake up"));
  assert.match(wake, /charging = null/);
  assert.match(wake, /if \(hook\) \{ fishWait = 0; endHook\(\); \}/);
  assert.match(v, /You wake up on the raft[^\n]*refreshPointerUI\(true\)/);
  assert.match(v, /fainted = 0;[^\n]*building\.menu\.close\(false\)/, 'fainting closes the build wheel');
});
