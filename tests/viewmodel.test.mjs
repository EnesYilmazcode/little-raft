// Viewmodel: every inventory kind has a held model, and the hands swap and pose without leaking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { ITEM_KINDS } = await import(new URL('inventory-state.js', base));
const { createHands, buildItemModel } = await import(new URL('hands.js?build=v3-survival-ae77fa84ac2b', base));

test('buildItemModel makes a small model with a grip for every inventory kind', () => {
  for (const kind of ITEM_KINDS) {
    const m = buildItemModel(T, kind);
    assert.ok(m?.isObject3D, kind);
    assert.equal(m.userData.kind, kind);
    assert.equal(m.userData.grip.length, 3);
    const s = m.userData.size;
    assert.ok(Math.max(s.x, s.y, s.z) < 1, `${kind} fits in a hand`);
  }
  assert.equal(buildItemModel(T, 'nope'), null);
});

test('hands swap held items with a lower/raise and cache one model per kind', () => {
  const h = createHands(T);
  const step = (n = 30) => { for (let i = 0; i < n; i++) h.update({ dt: 1 / 30, yaw: 0, pitch: 0 }); };
  assert.equal(h.group.visible, false);
  h.setHeld('hook'); step();
  assert.equal(h.state.held, 'hook'); assert.ok(Math.abs(h.state.dip) < 0.01);
  h.setHeld('wood'); h.update({ dt: 1 / 30 });
  assert.equal(h.state.held, 'hook', 'old item stays until the arm is down');
  assert.ok(h.state.dip > 0);
  step();
  assert.equal(h.state.held, 'wood'); assert.equal(h.state.pose, 'grip');
  h.setHeld('crate'); step();
  assert.equal(h.state.pose, 'point', 'decorations point');
  h.setPose('open'); step(); assert.equal(h.state.pose, 'open');
  h.setPose(null); h.setHeld('hook'); step(); h.setHeld('wood'); step();
  assert.equal(h.state.models, 3);
  h.setHeld(null); step(); assert.equal(h.group.visible, false);
  h.dispose();
});
