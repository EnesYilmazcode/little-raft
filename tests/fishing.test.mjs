// Regression tests for fishing fixes: release fires only the tool it was pressed with, rod casts can be reeled in.
// Run: node --test tests/fishing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { releaseShouldFire, castInput, castPrompt } = await import(new URL('fishing-rules.js', base));
const { ITEM_INFO } = await import(new URL('inventory-state.js', base));

const press = (tool, extra = {}) => ({ x: 0, y: 0, moved: false, tool, used: false, ...extra });

test('releaseShouldFire: a plain click fires the tool it was pressed with', () => {
  assert.equal(releaseShouldFire(press('hammer'), 'hammer'), true);
  assert.equal(releaseShouldFire(press('fishingrod'), 'fishingrod'), true);
});

test('releaseShouldFire: switching slot mid-press does not fire the new tool', () => {
  assert.equal(releaseShouldFire(press('hook', { used: true }), 'hammer'), false); // aborted hook charge
  assert.equal(releaseShouldFire(press('hook', { used: true }), 'fishingrod'), false);
  assert.equal(releaseShouldFire(press('hammer'), 'fishingrod'), false); // wheel switch during a click
});

test('releaseShouldFire: a press that reeled, charged or dragged never fires', () => {
  assert.equal(releaseShouldFire(press('hammer', { used: true }), 'hammer'), false);
  assert.equal(releaseShouldFire(press('hammer', { moved: true }), 'hammer'), false);
  assert.equal(releaseShouldFire(null, 'hammer'), false);
  assert.equal(releaseShouldFire({ x: 0, y: 0, moved: false }, 'hammer'), false); // no recorded tool
});

test('castInput: clicking while waiting cancels, clicking at the bite catches', () => {
  assert.equal(castInput({ fishing: true, t: 1 }, 4), 'cancel');
  assert.equal(castInput({ fishing: true, t: 4.2 }, 4, 'click'), 'catch');
});

test('castInput: a slot change always reels in empty; no cast means nothing', () => {
  assert.equal(castInput({ fishing: true, t: 4.2 }, 4, 'slot'), 'cancel');
  assert.equal(castInput({ fishing: true, t: 1 }, 4, 'slot'), 'cancel');
  assert.equal(castInput(null, 0, 'click'), 'none');
  assert.equal(castInput({ stage: 'flying' }, 0, 'click'), 'none'); // a hook throw is not a rod cast
});

test('castPrompt: tells the player how to reel in', () => {
  assert.match(castPrompt({ fishing: true, t: 1 }, 4), /Waiting for a bite.*click to reel in/);
  assert.match(castPrompt({ fishing: true, t: 4.5 }, 4), /bite/i);
  assert.equal(castPrompt(null, 0), '');
});

test('fishing rod has its own drawn icon, not the hook or fish sprite', () => {
  const src = readFileSync(fileURLToPath(new URL('survival-ui.js', base)), 'utf8');
  const custom = src.slice(src.indexOf('const CUSTOM = {'), src.indexOf('\n};', src.indexOf('const CUSTOM = {')));
  assert.match(custom, /\n {2}fishingrod: `/);
  assert.equal(ITEM_INFO.fishingrod.placeholder, true); // placeholder makes iconSVG prefer the CUSTOM drawing
});

test('rod cast bobber is not the grappling hook mesh', () => {
  const src = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');
  const branch = src.slice(src.indexOf('if (hook.fishing) {'), src.indexOf('const guestTokens'));
  assert.match(branch, /hookMesh\.visible = false/);
  assert.match(branch, /bobber\.visible = true/);
  assert.match(src, /bobber = createFishingTool\(T\)\.userData\.float/);
});
