// Viewmodel swap state machine: cancelled swaps rise back, pose overrides wait for their item, rod prompts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { createHands } = await import(new URL('hands.js?build=v3-survival-ae77fa84ac2b', base));
const { getModel } = await import(new URL('models.js', base));
const { castPrompt, castInput } = await import(new URL('fishing-rules.js', base));

const run = (h, n, extra = {}) => { for (let i = 0; i < n; i++) h.update({ dt: 1 / 60, ...extra }); return h.state; };

test('switching away and back mid-lower raises the arms again, smoothly', () => {
  for (const frames of [1, 3, 6, 7]) {
    const h = createHands(T);
    h.setHeld('hook'); run(h, 120);
    assert.equal(h.state.dip, 0);
    h.setHeld('hammer'); run(h, frames);
    const mid = h.state.dip; assert.ok(mid > 0 && mid < 1, `lowering after ${frames}`);
    h.setHeld('hook');
    const first = run(h, 1).dip;
    assert.ok(first <= mid + 1e-9 && mid - first < 0.25, `no snap (${mid} -> ${first})`);
    assert.equal(h.state.held, 'hook');
    run(h, 60);
    assert.equal(h.state.dip, 0, `back at rest after a ${frames}-frame flick`);
    h.setHeld('hammer'); run(h, 60); // a real swap still works afterwards
    assert.equal(h.state.held, 'hammer'); assert.ok(h.state.dip < 1e-6);
    h.dispose();
  }
});

test('a hook -> nothing -> hook flick does not leave the arms lowered', () => {
  const h = createHands(T);
  h.setHeld('hook'); run(h, 120);
  h.setHeld(null); run(h, 2); h.setHeld('hook'); run(h, 60);
  assert.equal(h.state.dip, 0);
  h.dispose();
});

test('a pose override waits for its own item: the outgoing hook keeps its coil hand', () => {
  const h = createHands(T);
  h.setHeld('hook'); run(h, 120);
  h.setHeld('crate'); h.setPose('point');
  const s = run(h, 1);
  assert.equal(s.held, 'hook'); assert.notEqual(s.pose, 'point'); assert.equal(s.pointHand, null);
  let n = 0; while (h.state.held === 'hook' && n++ < 60) run(h, 1);
  assert.equal(h.state.held, 'crate'); assert.equal(h.state.pose, 'point');
  h.dispose();
});

test('the outgoing hammer keeps pointing until it is lowered; the hook comes up without it', () => {
  const h = createHands(T);
  h.setHeld('hammer'); h.setPose('point'); run(h, 120);
  assert.equal(h.state.pose, 'point');
  h.setHeld('hook'); h.setPose(null);
  let n = 0;
  while (h.state.held !== 'hook' && n++ < 60) { const s = run(h, 1); if (s.held === 'hammer') assert.equal(s.pose, 'point'); }
  assert.equal(h.state.held, 'hook'); assert.notEqual(h.state.pose, 'point');
  h.dispose();
});

test("a cancelled swap keeps the shown item's own pose", () => {
  const h = createHands(T);
  h.setHeld('hammer'); h.setPose('point'); run(h, 120);
  h.setHeld('hook'); h.setPose(null); run(h, 3);
  h.setHeld('hammer'); h.setPose('point'); run(h, 60);
  assert.equal(h.state.held, 'hammer'); assert.equal(h.state.pose, 'point'); assert.equal(h.state.dip, 0);
  h.dispose();
});

test('with models.js as the factory every hotbar kind has a held model and the rod rope leaves its tip', () => {
  const h = createHands(T, { modelFactory: (k) => getModel(k) });
  for (const k of ['hook', 'hammer', 'fishingrod', 'crate', 'net', 'lantern', 'wood', 'plastic', 'mystery']) assert.ok(h.itemModel(k), k);
  h.setHeld('fishingrod'); run(h, 60);
  assert.notEqual(h.ropeAnchor(), h.handTip, 'rod anchor is the rod tip');
  h.setHeld('hook'); run(h, 60);
  assert.equal(h.ropeAnchor(), h.handTip);
  h.dispose();
  const broken = createHands(T, { modelFactory: () => null });
  assert.ok(broken.itemModel('crate'), 'a missing shared model falls back to the procedural mesh');
  broken.dispose();
});

test('rod prompts: waiting says a click cancels, the bite does not invite a click', () => {
  assert.match(castPrompt({ fishing: true, t: 1 }, 4), /Waiting for a bite… click to cancel/);
  assert.equal(castInput({ fishing: true, t: 1 }, 4, 'click'), 'cancel');
  const bite = castPrompt({ fishing: true, t: 4.5 }, 4);
  assert.match(bite, /bite/i); assert.doesNotMatch(bite, /click/i);
});
