// Snack Float (docs/specs/snack-float.md section 9, cases 13-16): item wiring, the float model, and the shark view's
// co-op pose (3 bait numbers appended after the 7 pose numbers, never a new state code).
import test from 'node:test';
import assert from 'node:assert/strict';

const T = await import('../dist/vendor/three.module.js');
const { ITEM_INFO, RECIPES } = await import('../dist/inventory-state.js');
const { isEdible } = await import('../dist/vitals.js');
const { categoryOf, ITEM_TEXT } = await import('../dist/craft-book.js');
const { ITEM_ICONS } = await import('../dist/item-svg.js');
const { createSnackFloat, disposeSnackFloat } = await import('../dist/snack-float-model.js');
const { createShark, STATE_CODE, BAIT, SHARK } = await import('../dist/shark.js');

const grid = (n = 3) => { const t = []; for (let z = -1; z < n - 1; z++) for (let x = -1; x < n - 1; x++) t.push([x, z]); return t; };
const makeHost = (role = 'host') => {
  const w = { tiles: grid(3), decor: [], tileHp: {}, pieces: [], garden: {}, purifiers: {} };
  const h = { scene: new T.Scene(), ocean: null, raft: () => null, world: () => w, role: () => h.r, preys() {}, r: role };
  return h;
};

test('snack float: item, recipe, category, craft book text and icon', () => {
  assert.equal(ITEM_INFO.snackfloat.maxStack, 10);
  assert.equal(ITEM_INFO.snackfloat.name, 'Snack Float');
  assert.deepEqual(RECIPES.snackfloat.cost, { fish: 2, seaweed: 1, rope: 1 });
  assert.equal(RECIPES.snackfloat.output.count, 1);
  assert.equal(isEdible('snackfloat'), false);
  assert.equal(categoryOf('snackfloat'), 'survival');
  assert.ok(ITEM_TEXT.snackfloat.desc && ITEM_TEXT.snackfloat.use);
  const svg = ITEM_ICONS.snackfloat;
  assert.equal(typeof svg, 'string');
  assert.ok(!svg.includes('<script') && !svg.includes(' id=') && !svg.includes('href'));
});

test('snack float: model is one small merged vertex-coloured mesh', () => {
  const g = createSnackFloat(T);
  assert.equal(g.name, 'snackFloat');
  const meshes = []; g.traverse(o => { if (o.isMesh) meshes.push(o); });
  assert.equal(meshes.length, 1);
  const geo = meshes[0].geometry;
  assert.ok(geo.attributes.color);
  assert.equal(meshes[0].castShadow, false);
  const box = new T.Box3().setFromObject(g), size = box.getSize(new T.Vector3());
  for (const v of [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]) assert.ok(Number.isFinite(v));
  const wide = Math.max(size.x, size.z);
  assert.ok(wide >= 0.2 && wide <= 0.4, 'width ' + wide);
  const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
  assert.ok(tris <= 400, 'tris ' + tris);
  assert.doesNotThrow(() => disposeSnackFloat(g));
});

test('snack float: host pose carries the float in 7-9, the state code stays 0..6', () => {
  const h = makeHost('host'), sh = createShark(T, h);
  let p = sh.net(); assert.equal(p.length, 10); assert.deepEqual(p.slice(7), [0, 0, 0]);
  assert.equal(sh.bait, null); assert.equal(sh.hostBait, true);
  assert.equal(sh.toss(8, 0), 'ok');
  assert.deepEqual(sh.net().slice(7), [8, 0, 120]);
  assert.equal(sh.toss(-8, 0), 'busy');
  let snacking = 0, ate = 0; h.onAte = () => ate++;
  for (let t = 0; t < 200; t += 0.05) {
    sh.update(0.05, t);
    p = sh.net();
    assert.ok(Number.isInteger(p[3]) && p[3] >= 0 && p[3] <= 6, 'code ' + p[3]);
    if (sh.sim.state === 'snack') { snacking++; assert.ok(p[3] === STATE_CODE.approach || p[3] === STATE_CODE.bite); }
  }
  assert.ok(snacking > 100);
  assert.equal(sh.bait, null); assert.deepEqual(sh.net().slice(7), [0, 0, 0]);
  assert.equal(ate, 1, 'onAte once when the float is eaten');
  sh.dispose();
});

test('snack float: guest reads the float from the host pose, old hosts send none', () => {
  const h = makeHost('guest'), sh = createShark(T, h);
  const float = () => h.scene.getObjectByName('snackFloat');
  sh.applyNet([5, 5, 0, 0, -0.55, 0, 150]);
  assert.equal(sh.hostBait, false); assert.equal(sh.bait, null);
  sh.update(0.05, 0); assert.equal(float().visible, false);
  sh.applyNet([5, 5, 0, 2, -0.32, 0, 150, 8, -1, 50]);
  assert.equal(sh.hostBait, true); assert.deepEqual({ ...sh.bait }, { x: 8, z: -1, t: 50 });
  sh.update(0.05, 0.05); assert.equal(float().visible, true);
  assert.equal(sh.toss(8, 0), null, 'the guest never runs the sim');
  sh.applyNet([5, 5, 0, 2, -0.32, 0, 150, 1e6, -1e6, 999]);
  assert.deepEqual({ ...sh.bait }, { x: BAIT.LIM, z: -BAIT.LIM, t: BAIT.MAX });
  sh.clearNet(); assert.equal(sh.hostBait, false); assert.equal(sh.bait, null);
  assert.equal(SHARK.HP, 150);
  sh.dispose();
});
