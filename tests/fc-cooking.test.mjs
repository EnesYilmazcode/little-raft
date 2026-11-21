// Unit tests for dist/cooking.js: GrillState rules + headless model/smoke construction.
// Run: node --test tests/fc-cooking.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { COOK_TUNING, cookTime, GrillState, createGrillModel, createSmoke } = await import(new URL('cooking.js', base));

const run = (g, secs, step = 0.5) => { const ev = []; for (let t = 0; t < secs - 1e-9; t += step) ev.push(...g.update(step)); return ev; };
const fish = { species: 'pomfret', cm: 25 };

test('fuel is capped at maxFuel wood', () => {
  const g = new GrillState();
  assert.equal(g.lit, false);
  assert.equal(g.addFuel(10), COOK_TUNING.maxFuel);
  assert.equal(g.fuel, COOK_TUNING.maxFuel * COOK_TUNING.fuelPerWood);
  assert.equal(g.addFuel(1), 0);
  assert.equal(g.addFuel(-3), 0);
  assert.equal(g.addFuel(NaN), 0);
  assert.equal(g.lit, true);
});

test('Raft Simple Grill numbers: 50 s per plank, 2 planks, ~40 s for a 30 cm fish, no early charring', () => {
  assert.equal(COOK_TUNING.fuelPerWood, 50); assert.equal(COOK_TUNING.maxFuel, 2);
  assert.equal(cookTime({ cm: 30 }), 40);
  assert.ok(COOK_TUNING.burnAfter >= 120);
  const g = new GrillState(); g.addFuel(2); g.place({ species: 'pomfret', cm: 30 });
  const ev = run(g, 100);
  assert.deepEqual(ev, [{ kind: 'cooked', slot: 0 }, { kind: 'out' }], 'one full grill cooks it and runs out before any charring');
  assert.equal(g.slots[0].state, 'cooked');
});

test('items.js grill recipes agree with cooking.js', async () => {
  const { ITEMS } = await import(new URL('items.js', base));
  assert.equal(ITEMS.cookedfish.recipe.time, cookTime({ cm: 30 }));
  assert.ok(ITEMS.cookedsharkmeat.recipe.time >= ITEMS.cookedfish.recipe.time);
  for (const id of ['cookedfish', 'cookedsharkmeat']) assert.ok(Math.abs(ITEMS[id].recipe.fuel - ITEMS[id].recipe.time / COOK_TUNING.fuelPerWood) < 1e-9, id);
});

test('no cooking without fire', () => {
  const g = new GrillState();
  assert.equal(g.place(fish), 0);
  assert.equal(run(g, 200).length, 0);
  assert.equal(g.slots[0].state, 'raw');
  assert.equal(g.slots[0].t, 0);
});

test('raw -> cooked -> burnt timing', () => {
  const ct = cookTime(fish);
  assert.equal(ct, COOK_TUNING.cookSeconds.default + COOK_TUNING.cookSeconds.perCm * 25);
  const g = new GrillState();
  g.addFuel(4); g.place(fish);
  assert.equal(run(g, ct - 1).length, 0);
  assert.deepEqual(run(g, 1.5), [{ kind: 'cooked', slot: 0 }]);
  assert.equal(g.slots[0].state, 'cooked');
  // charring takes longer than a full grill burns, so keep feeding it planks
  const feed = secs => { const ev = []; for (let t = 0; t < secs - 1e-9; t += 0.5) { if (g.fuel < 10) g.addFuel(1); ev.push(...g.update(0.5)); } return ev; };
  assert.equal(feed(COOK_TUNING.burnAfter - 2).length, 0);
  assert.deepEqual(feed(2), [{ kind: 'burnt', slot: 0 }]);
  assert.deepEqual(g.take(0), { species: 'pomfret', cm: 25, state: 'burnt' });
  assert.equal(g.update(0.1), g.update(0.1), 'no-event result is a shared constant');
});

test('fish stop cooking when fuel runs out', () => {
  const g = new GrillState();
  g.addFuel(1); g.place(fish);
  const ev = run(g, 60);
  assert.deepEqual(ev, [{ kind: 'cooked', slot: 0 }, { kind: 'out' }]);
  assert.equal(g.lit, false);
  const t = g.slots[0].t;
  run(g, 30);
  assert.equal(g.slots[0].t, t);
});

test('empty grill idles out after 10 s and stops using fuel', () => {
  const g = new GrillState();
  g.addFuel(2);
  const full = g.fuel;
  const ev = run(g, 30);
  assert.deepEqual(ev, [{ kind: 'out', idle: true }]);
  assert.equal(g.fuel, full - COOK_TUNING.idleBurn);
  assert.equal(g.burning, false);
  assert.equal(g.lit, true);
  g.place(fish);
  assert.equal(g.burning, true);
  run(g, 5);
  assert.equal(g.fuel, full - COOK_TUNING.idleBurn - 5);
  g.take(0);
  run(g, 30);
  assert.equal(g.fuel, full - 2 * COOK_TUNING.idleBurn - 5);
});

test('take / place slots', () => {
  const g = new GrillState();
  assert.equal(g.place(fish), 0);
  assert.equal(g.place({ species: 'herring', cm: 20 }), 1);
  assert.equal(g.place(fish), -1);
  assert.equal(g.take(5), null);
  assert.deepEqual(g.take(0), { species: 'pomfret', cm: 25, state: 'raw' });
  assert.equal(g.take(0), null);
  assert.equal(g.place({ species: 'tuna', cm: 80 }), 0);
  assert.equal(g.place({ species: 'x', cm: 20, state: 'cooked' }), -1);
  assert.equal(g.place({ species: '', cm: 20 }), -1);
  assert.equal(g.place(null), -1);
});

test('snapshot round trip and junk sanitising', () => {
  const g = new GrillState({ id: 'grill-1', x: 3, z: -2 });
  g.addFuel(2); g.place(fish); run(g, 10);
  const snap = JSON.parse(JSON.stringify(g.snapshot()));
  const h = new GrillState(snap);
  assert.deepEqual(h.snapshot(), g.snapshot());
  assert.deepEqual(h.update(1), g.update(1));

  for (const junk of [undefined, null, 42, 'x', [], { slots: 'no' }, { fuel: Infinity, slots: [1, 2, 3] }]) {
    const s = new GrillState(junk);
    assert.equal(s.slots.length, COOK_TUNING.slots);
    assert.ok(s.fuel >= 0 && s.fuel <= COOK_TUNING.maxFuel * COOK_TUNING.fuelPerWood);
  }
  const s = new GrillState({ id: {}, x: NaN, z: 'q', fuel: 1e9, slots: [
    { species: 'a'.repeat(25), cm: 10 }, { species: 'salmon', cm: 9999, t: -5, state: 'weird' }, { species: 'extra', cm: 5 }] });
  assert.equal(s.id, null); assert.equal(s.x, 0); assert.equal(s.z, 0);
  assert.equal(s.fuel, COOK_TUNING.maxFuel * COOK_TUNING.fuelPerWood);
  assert.equal(s.slots[0], null);
  assert.deepEqual(s.slots[1], { species: 'salmon', cm: 300, t: 0, state: 'raw' });
  assert.equal(new GrillState({ slots: [{ species: 'a', cm: NaN }] }).slots[0], null);
  assert.equal(new GrillState({ slots: [{ species: 'a', cm: 0.2 }] }).slots[0].cm, 1);
});

test('grill model and smoke construct, animate and dispose headless', () => {
  const g = createGrillModel(T, { light: true });
  const ud = g.userData;
  let meshes = 0; g.traverse(o => { if (o.isMesh) meshes++; });
  assert.equal(meshes, ud.meshCount);
  assert.ok(meshes < 15);
  assert.equal(ud.slotPositions.length, 2);
  assert.ok(ud.fireAnchor.isVector3 && ud.smokeAnchor.isVector3);
  ud.setFire(0); ud.update(0.016, 1);
  assert.ok(g.children.filter(o => o.name.startsWith('grillFlame')).every(f => !f.visible));
  ud.setFire(1); ud.update(0.016, 2);
  const box = new T.Box3().setFromObject(g), size = box.getSize(new T.Vector3());
  assert.ok(size.x <= 1.0 && size.z <= 0.8, `footprint ${size.x} x ${size.z}`);
  assert.ok(box.min.y > -0.02 && box.max.y < 1.1);
  ud.dispose();

  const sm = createSmoke(T, { max: 8 });
  assert.ok(sm.points.isPoints);
  sm.emit(0, 1, 0, 20, true);
  for (let i = 0; i < 300; i++) sm.update(1 / 60, { x: 0.3, z: 0 });
  const a = sm.points.geometry.attributes.aAlpha.array;
  assert.ok(Array.from(a).every(v => v === 0), 'all faded after 5 s');
  sm.update(0.1); sm.dispose();
});
