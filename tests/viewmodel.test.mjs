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

test('hands are baked into a few draw calls and leave shared factory materials alone', () => {
  const shared = new T.MeshStandardMaterial({ color: 0x996633 });
  const factory = (k) => (k === 'crate' ? new T.Group().add(new T.Mesh(new T.BoxGeometry(1, 1, 1), shared), new T.Mesh(new T.BoxGeometry(0.2, 1.2, 0.2), shared)) : null);
  const h = createHands(T, { modelFactory: factory });
  const visibleMeshes = () => { let n = 0; h.group.traverse((c) => { if (!c.isMesh) return; for (let p = c; p; p = p.parent) if (!p.visible) return; n++; }); return n; };
  const step = (n = 30) => { for (let i = 0; i < n; i++) h.update({ dt: 1 / 30 }); };
  h.preload(['hook', 'crate']); h.update({ dt: 0 });
  assert.equal(h.state.models, 2, 'preload builds held models ahead');
  h.setHeld('hook'); step();
  assert.ok(visibleMeshes() <= 16, `hook + hands: ${visibleMeshes()} draws`);
  h.setHeld('crate'); step();
  assert.ok(visibleMeshes() <= 8, `crate + pointing hands: ${visibleMeshes()} draws`);
  assert.equal(shared.transparent, false, 'held copy never edits the cached model material');
  assert.equal(shared.renderOrder ?? 0, 0);
  const lag = h.state.lag; step(2); assert.equal(h.state.lag, lag, 'no per-frame lag array');
  h.dispose();
});

test('hands keep a fixed 60 degree framing whatever the world FOV', () => {
  const h = createHands(T);
  h.setHeld('hook'); h.update({ dt: 1 / 30, fov: 60 });
  assert.ok(Math.abs(h.group.scale.x - 1) < 1e-9);
  h.update({ dt: 1 / 30, fov: 90 });
  const s = Math.tan(Math.PI / 4) / Math.tan(Math.PI / 6);
  assert.ok(Math.abs(h.group.scale.x - s) < 1e-9 && Math.abs(h.group.scale.y - s) < 1e-9 && h.group.scale.z === 1);
  h.dispose();
});

test('the right hand grips the line while the hook is out and pulls hand over hand while reeling', () => {
  const h = createHands(T);
  const step = (n, p = {}) => { for (let i = 0; i < n; i++) h.update({ dt: 1 / 60, ...p }); };
  h.setHeld('hook'); step(40);
  assert.equal(h.state.rightHand, 'grip');
  const left = h.ropeAnchor();
  step(5, { hasHookOut: true });
  assert.equal(h.state.rightHand, 'fist', 'rope grip, not an open palm');
  assert.notEqual(h.ropeAnchor(), left, 'line leaves the right fist');
  const strokes = [];
  for (let i = 0; i < 120; i++) { h.update({ dt: 1 / 60, time: 1 + i / 60, hasHookOut: true, reeling: true }); strokes.push([h.state.pullR, h.state.pull]); }
  const late = strokes.slice(60);
  assert.ok(late.some(([r, l]) => r - l > 0.5) && late.some(([r, l]) => l - r > 0.5), 'hands alternate');
  h.dispose();
});

test('seeds rest in the hand and point only on request; cups use the shared model', () => {
  const h = createHands(T);
  const step = (n = 30) => { for (let i = 0; i < n; i++) h.update({ dt: 1 / 30 }); };
  h.setHeld('seed'); step();
  assert.equal(h.state.pose, 'grip'); assert.equal(h.state.pointHand, null);
  h.setPose('point'); step(); assert.equal(h.state.pointHand, 'R');
  h.dispose();
  const factory = (k) => (k === 'water' ? new T.Mesh(new T.CylinderGeometry(1, 1, 2)) : null);
  assert.equal(buildItemModel(T, 'water', factory).userData.shared, true);
});

test('held placeables stay small, the hammer is compact, rope and fish read in the fist', () => {
  const box = () => new T.Mesh(new T.BoxGeometry(2, 1, 1));
  for (const [k, f] of [['crate', null], ['bench', box], ['lantern', null], ['sail', null], ['seed', null], ['planter', null]]) {
    const s = buildItemModel(T, k, f).userData.size;
    assert.ok(Math.max(s.x, s.y, s.z) <= 0.1101, `${k} capped: ${Math.max(s.x, s.y, s.z)}`);
  }
  assert.ok(buildItemModel(T, 'hammer').userData.size.y < 0.4, 'hammer about 0.7 of its old size');
  assert.ok(Math.max(...Object.values(buildItemModel(T, 'rope').userData.size)) > 0.2, 'rope coil is big enough to read');
  const fish = buildItemModel(T, 'fish').userData.size;
  assert.ok(fish.x > fish.y * 2, 'fish held sideways');
});

test('both fists hold the line while reeling', () => {
  const h = createHands(T);
  h.setHeld('hook'); for (let i = 0; i < 40; i++) h.update({ dt: 1 / 60 });
  for (let i = 0; i < 60; i++) h.update({ dt: 1 / 60, time: i / 60, hasHookOut: true });
  assert.equal(h.state.leftHand, 'grip', 'left keeps the coil while the hook is only out');
  for (let i = 0; i < 60; i++) h.update({ dt: 1 / 60, time: 1 + i / 60, hasHookOut: true, reeling: true });
  assert.equal(h.state.leftHand, 'fist'); assert.ok(h.state.ropeW > 0.9);
  const L = h.group.getObjectByName('leftArm');
  assert.ok(L.visible && L.position.x > 0.1 && L.position.y > -0.33, `left fist up on the line: ${L.position.x.toFixed(2)},${L.position.y.toFixed(2)}`);
  h.dispose();
});
