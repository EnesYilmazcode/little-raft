// Viewmodel: every inventory kind has a held model, and the hands swap and pose without leaking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { ITEM_KINDS } = await import(new URL('inventory-state.js', base));
const { createHands, buildItemModel, isPlaceable } = await import(new URL('hands.js?build=v3-survival-ae77fa84ac2b', base));

const fits = (m, kind) => {
  assert.ok(m?.isObject3D, kind);
  assert.equal(m.userData.kind, kind);
  assert.equal(m.userData.grip.length, 3);
  const s = m.userData.size;
  assert.ok(Math.max(s.x, s.y, s.z) < 1, `${kind} fits in a hand`);
};

test('buildItemModel makes a small model with a grip for every kind, known or not', () => {
  for (const kind of [...ITEM_KINDS, 'seed', 'cup', 'water', 'planter', 'mystery']) fits(buildItemModel(T, kind), kind);
  assert.equal(buildItemModel(T, null), null);
});

test('a model factory is used for carried kinds, tools keep their own models', () => {
  const asked = [];
  const factory = (k) => { asked.push(k); return k === 'crate' ? new T.Mesh(new T.BoxGeometry(1, 1, 1)) : null; };
  const crate = buildItemModel(T, 'crate', factory);
  fits(crate, 'crate'); assert.equal(crate.userData.shared, true);
  fits(buildItemModel(T, 'lantern', factory), 'lantern');                // factory miss -> own mesh
  fits(buildItemModel(T, 'hook', factory), 'hook');
  assert.deepEqual(asked, ['crate', 'lantern']);
});

test('placeables are the build hammer, decorations, planters and seeds', () => {
  for (const k of ['hammer', 'crate', 'sail', 'palm', 'seed', 'planter']) assert.ok(isPlaceable(k), k);
  for (const k of ['hook', 'wood', 'fish', 'fishingrod']) assert.ok(!isPlaceable(k), k);
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
  assert.equal(h.state.pointHand, 'R', 'crate rides the left fist, right hand points');
  h.setPose('open'); step(); assert.equal(h.state.pose, 'open');
  h.setPose('idle'); h.setHeld('hook'); step(); h.setHeld('wood'); step();
  assert.equal(h.state.models, 3);
  h.setHeld(null); step(); assert.equal(h.group.visible, false);
  h.dispose();
});

test('pointing blends without a lower/raise; the hammer points with the left hand', () => {
  const h = createHands(T);
  const step = (n = 30) => { for (let i = 0; i < n; i++) h.update({ dt: 1 / 30 }); };
  h.setHeld('hammer'); step();
  assert.equal(h.state.pose, 'grip'); assert.equal(h.state.pointHand, null);
  h.setPose('point'); h.update({ dt: 1 / 30 });
  assert.equal(h.state.pose, 'point'); assert.equal(h.state.pointHand, 'L');
  assert.ok(h.state.dip < 0.01, 'no swap dip for a pose change');
  step();
  h.setPose('throw'); step(); assert.ok(h.state.chargeEased > 0.9, 'throw winds up');
  h.setPose(null); step(); assert.equal(h.state.pose, 'grip');
  h.setModelFactory(() => null); step(); assert.equal(h.state.models, 1);
  h.dispose();
});
