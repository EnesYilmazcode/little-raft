// Diving gear: pure core, item/recipe data, reachability, diving.js multipliers, registry hook.
// Run: node --test tests/diving-gear.test.mjs   (docs/specs/diving-gear.md)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const G = await import(new URL('diving-gear-core.js', base));
const { CONTENT_ITEMS, CONTENT_RECIPES, CONTENT_DECOR } = await import(new URL('content-items.js', base));
const { ITEM_INFO, RECIPES } = await import(new URL('inventory-state.js', base));
const { ITEMS, LEGACY_ALIASES } = await import(new URL('items.js', base));
const SR = await import(new URL('storage-research.js', base));
const { DIVE, DiveBody, stepOxygen } = await import(new URL('diving.js', base));
const { createContent } = await import(new URL('content.js', base));

const IDS = ['fins', 'airjug', 'goggles', 'scraper'];
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const only = id => k => (k === id ? 1 : 0);
const modsOf = count => G.applyGear(G.gearMask(count), G.blankMods());

test('no gear: mask 0 and neutral mods; bad counts give 0', () => {
  assert.equal(G.gearMask(() => 0), 0);
  assert.deepEqual(G.applyGear(0, G.blankMods()), { swim: 1, oxy: 1, fog: 1, gather: 1 });
  assert.equal(G.gearMask(null), 0);
  assert.equal(G.gearMask(undefined), 0);
  assert.equal(G.gearMask(() => { throw new Error('x'); }), 0);
  assert.equal(G.gearMask(() => NaN), 0);
  assert.equal(G.gearMask(() => null), 0);
  assert.equal(G.gearMask(() => -3), 0);
  const m = G.blankMods();
  for (const bad of [NaN, -1, 1.5, 'x', null]) assert.deepEqual(G.applyGear(bad, m), { swim: 1, oxy: 1, fog: 1, gather: 1 });
});

test('each item sets only its own field; all four set all four', () => {
  assert.deepEqual(modsOf(only('fins')), { swim: 1.3, oxy: 1, fog: 1, gather: 1 });
  assert.deepEqual(modsOf(only('airjug')), { swim: 1, oxy: 75 / 45, fog: 1, gather: 1 });
  assert.deepEqual(modsOf(only('goggles')), { swim: 1, oxy: 1, fog: 46 / 30, gather: 1 });
  assert.deepEqual(modsOf(only('scraper')), { swim: 1, oxy: 1, fog: 1, gather: 0.6 });
  assert.deepEqual(modsOf(() => 1), { swim: 1.3, oxy: 75 / 45, fog: 46 / 30, gather: 0.6 });
  assert.equal(G.gearMask(() => 1), 0b1111);
});

test('a stack of 5 equals 1; applyGear returns its argument and is repeatable', () => {
  assert.equal(G.gearMask(() => 5), G.gearMask(() => 1));
  const m = G.blankMods(), r = G.applyGear(0b1111, m);
  assert.equal(r, m);
  assert.deepEqual(G.applyGear(0b1111, G.blankMods()), m);
});

test('gear multiplies onto other contributors', () => {
  const m = G.blankMods(); m.swim = 1.15; // a meal
  G.applyGear(G.gearMask(only('fins')), m);
  assert.ok(near(m.swim, 1.3 * 1.15));
  const n = G.blankMods(); n.oxy = 2; n.gather = 0.5;
  G.applyGear(G.gearMask(only('fins')), n);
  assert.equal(n.oxy, 2); assert.equal(n.gather, 0.5);
});

test('maskIds reuses and clears the passed array', () => {
  const list = ['old', 'stuff', 'here'];
  const r = G.maskIds(0b0101, list);
  assert.equal(r, list);
  assert.deepEqual(list, ['fins', 'goggles']);
  assert.deepEqual(G.maskIds(0, list), []);
  assert.deepEqual(G.maskIds(0b1111, []), IDS);
});

test('data: items, recipes, not decor, not progression ids', () => {
  for (const id of IDS) {
    assert.equal(CONTENT_ITEMS[id]?.maxStack, 1, id);
    assert.equal(CONTENT_ITEMS[id].tool, false, id);
    assert.equal(CONTENT_RECIPES[id]?.output.kind, id);
    assert.equal(CONTENT_RECIPES[id].output.count, 1);
    assert.ok(!CONTENT_DECOR.includes(id), id);
    assert.ok(!Object.prototype.hasOwnProperty.call(ITEMS, id), id);
    assert.ok(!Object.prototype.hasOwnProperty.call(LEGACY_ALIASES, id), id);
    assert.equal(ITEM_INFO[id]?.maxStack, 1, id);
    assert.ok(RECIPES[id], id);
    for (const k of Object.keys(CONTENT_RECIPES[id].cost)) assert.ok(ITEM_INFO[k], `${id} cost ${k} is a real kind`);
  }
  assert.deepEqual([...G.GEAR_IDS], IDS);
});

test('reachability: every cost kind is researchable, and studying it teaches the gear', () => {
  const ing = new Set(SR.ingredientKinds()); for (const id of IDS) ing.delete(id);
  for (const id of IDS) for (const k of Object.keys(CONTENT_RECIPES[id].cost)) assert.ok(ing.has(k), `${id}: ${k}`);
  for (const id of IDS) assert.ok(SR.learnedFrom(Object.keys(CONTENT_RECIPES[id].cost)).includes(id), id);
});

test('diving.js: oxygen length and swim speed follow the multipliers', () => {
  assert.equal(stepOxygen(1, 45, true).empty, true);
  assert.ok(near(stepOxygen(1, 45, true, 75).oxygen, 0.4, 1e-9));
  assert.equal(stepOxygen(1, 75, true, 75).empty, true);
  assert.equal(stepOxygen(0, 2, false).oxygen, stepOxygen(0, 2, false, 75).oxygen);
  const speed = env => {
    const b = new DiveBody({ x: 0, y: -5, z: 0 });
    for (let i = 0; i < 240; i++) b.step(1 / 60, { forward: 1, fast: true, gather: true, yaw: 0, pitch: 0 }, env);
    return Math.hypot(b.vx, b.vy, b.vz);
  };
  const env = { waterY: -0.24, floorY: -11, tiles: [], deckY: 0.2 };
  assert.ok(near(speed(env), DIVE.FAST, 0.01));
  assert.ok(near(speed({ ...env, swimMul: 1.3 }), DIVE.FAST * 1.3, 0.02));
  const b = new DiveBody({ x: 0, y: -5, z: 0 });
  for (let i = 0; i < 60; i++) b.step(1 / 60, {}, { ...env, oxyMul: 75 / 45 });
  assert.ok(near(b.oxygen, 1 - 1 / (DIVE.OXY_SECONDS * 75 / 45), 1e-6)); // the gear multiplies the (Raft 33 s) base breath
});

test('registry: diveMods multiplies, and a throwing module is disabled', () => {
  const errors = console.error; console.error = () => {};
  try {
    const c = createContent({}, [() => ({ name: 'x', diveMods(m) { m.oxy *= 2; } })]);
    assert.deepEqual(c.diveMods({}), { swim: 1, oxy: 2, fog: 1, gather: 1 });
    const d = createContent({}, [() => ({ name: 'bad', diveMods(m) { m.swim *= 3; throw new Error('boom'); } }), () => ({ name: 'ok' })]);
    const out = {}; d.diveMods(out);
    assert.equal(d.mods[0].dead, true);
    assert.deepEqual(d.diveMods(out), { swim: 1, oxy: 1, fog: 1, gather: 1 });
  } finally { console.error = errors; }
});

test('module: reads the local bag and contributes through the registry', async () => {
  const { createDivingGear } = await import(new URL('diving-gear.js', base));
  const have = new Map([['fins', 1], ['goggles', 3]]);
  const ctx = { role: 'host', localBag: () => ({ count: k => have.get(k) ?? 0, add: (k, n) => { have.set(k, (have.get(k) ?? 0) + n); return 0; } }) };
  const c = createContent(ctx, [createDivingGear]);
  c.update(0.016);
  const gear = c.debug.divegear;
  assert.deepEqual(gear.worn(), ['fins', 'goggles']);
  assert.deepEqual(c.diveMods({}), { swim: 1.3, oxy: 1, fog: 46 / 30, gather: 1 });
  assert.equal(gear.give(), 4);
  c.update(0.016);
  assert.equal(gear.mask(), 0b1111);
  assert.deepEqual(gear.mods(), { swim: 1.3, oxy: 75 / 45, fog: 46 / 30, gather: 0.6 });
  const guest = createContent({ role: 'guest', localBag: () => null }, [createDivingGear]);
  guest.update(0.016);
  assert.equal(guest.debug.divegear.give(), 0);
  assert.deepEqual(guest.diveMods({}), { swim: 1, oxy: 1, fog: 1, gather: 1 });
  c.dispose(); guest.dispose();
});
