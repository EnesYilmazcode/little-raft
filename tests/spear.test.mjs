// Wooden spear + shark meat: recipe, stab timing, hit maths against a fake bus.shark, wear, kill loot, grill.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { ITEMS, recipeTable, stationRecipeFor, wearPerUse, toolRole } = await import(new URL('items.js', base));
const { Bag, RECIPES, ITEM_INFO, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { SPEAR, createStab, startStab, tickStab, stabAmount, rayHit, wearSpear, giveSharkMeat } = await import(new URL('spear.js', base));
const { bus } = await import(new URL('combat-bus.js', base));
const { StationModel } = await import(new URL('smelter.js', base));
const CB = await import(new URL('craft-book.js', base));
const { statePrompt } = await import(new URL('prompts.js', base));
const { createHands, buildItemModel } = await import(new URL('hands.js?build=v3-survival-ae77fa84ac2b', base));

const emptyBag = () => new Bag({ slots: new Array(SLOT_COUNT).fill(null), selected: 0 });
const DT = 1 / 60;

test('spear: Wooden Spear is a 20-use tool crafted from 8 wood + 3 rope in the Tools tab', () => {
  const it = ITEMS.spear;
  assert.equal(it.name, 'Wooden Spear');
  assert.equal(it.category, 'tool');
  assert.equal(it.tool, true);
  assert.equal(it.durability, 20);
  assert.equal(it.stack, 1);
  assert.deepEqual({ ...it.recipe.cost }, { wood: 8, rope: 3 });
  assert.equal(it.recipe.station, null);
  assert.equal(it.unlock.type, 'start');
  assert.deepEqual({ ...recipeTable().spear.cost }, { wood: 8, rope: 3 });
  assert.ok(RECIPES.spear, 'Bag knows the recipe');
  assert.equal(ITEM_INFO.spear.tool, true);
  assert.equal(toolRole('spear'), 'spear');
  assert.equal(wearPerUse('spear'), 5);
  assert.equal(CB.categoryOf('spear', ITEM_INFO.spear), 'tools');
  const bag = emptyBag(); bag.add('wood', 8); bag.add('rope', 3);
  assert.equal(bag.craft('spear').ok, true);
  assert.equal(bag.count('spear'), 1);
  assert.equal(bag.slots.find((s) => s?.kind === 'spear').durability, 100);
  assert.equal(bag.count('wood') + bag.count('rope'), 0);
});

test('spear: shark meat items exist as food', () => {
  assert.equal(ITEMS.sharkmeat.name, 'Raw Shark Meat');
  assert.equal(ITEMS.cookedsharkmeat.name, 'Grilled Shark Meat');
  for (const k of ['sharkmeat', 'cookedsharkmeat']) {
    assert.equal(ITEMS[k].category, 'food');
    assert.ok(ITEM_INFO[k], `${k} known to the bag`);
    assert.ok(ITEMS[k].iconTint, `${k} placeholder tint`);
    assert.ok(CB.ITEM_TEXT[k]?.desc);
  }
});

test('spear: a stab is ~0.35 s out and back, peaks once, and has a 0.6 s cooldown', () => {
  const st = createStab();
  assert.equal(stabAmount(st), 0);
  assert.equal(startStab(st), true);
  assert.equal(startStab(st), false, 'no second stab mid-thrust');
  let fires = 0, peakAt = -1, maxA = 0, t = 0;
  while (st.t >= 0 && t < 1) {
    if (tickStab(st, DT)) { fires++; peakAt = t + DT; }
    maxA = Math.max(maxA, stabAmount(st)); t += DT;
  }
  assert.equal(fires, 1, 'one hit test per stab');
  assert.ok(Math.abs(t - SPEAR.stabTime) < 2 * DT, `stab lasts ${t}`);
  assert.ok(peakAt > 0.1 && peakAt < 0.2, `peak at ${peakAt}`);
  assert.ok(maxA > 0.95, 'arm fully out at the peak');
  assert.equal(stabAmount(st), 0, 'back at rest');
  assert.equal(startStab(st), false, 'still cooling down after the thrust');
  while (t < SPEAR.cooldown - DT) { tickStab(st, DT); t += DT; }
  assert.equal(startStab(st), false, 'cooldown not over just before 0.6 s');
  tickStab(st, 2 * DT);
  assert.equal(startStab(st), true, 'ready again after 0.6 s');
  // junk dt never breaks it
  assert.equal(tickStab(st, NaN), false);
  assert.equal(tickStab(null, DT), false);
});

test('spear: hit maths hits a shark on the stab line and misses one off it', () => {
  const o = { x: 0, y: 1.6, z: 0 }, d = { x: 0, y: -0.5, z: -1 }; // looking down over the raft edge
  const len = Math.hypot(d.x, d.y, d.z), u = { x: d.x / len, y: d.y / len, z: d.z / len };
  const out = { x: 0, y: 0, z: 0 };
  const onRay = { x: u.x * 2, y: 1.6 + u.y * 2, z: u.z * 2 };
  assert.ok(rayHit(o, d, onRay, out) > 1.9);
  assert.ok(Math.hypot(out.x - onRay.x, out.y - onRay.y, out.z - onRay.z) < 1e-9, 'point = closest approach');
  assert.ok(rayHit(o, d, { x: onRay.x + 1.0, y: onRay.y, z: onRay.z }, out) >= 0, 'big shark body: 1 m off still hits');
  assert.equal(rayHit(o, d, { x: onRay.x + 1.5, y: onRay.y, z: onRay.z }, out), -1, '1.5 m off the line misses');
  assert.equal(rayHit(o, d, { x: 0, y: 1.6, z: 5 }, out), -1, 'behind the player misses');
  assert.equal(rayHit(o, d, { x: u.x * 4.5, y: 1.6 + u.y * 4.5, z: u.z * 4.5 }, out), -1, 'beyond 2.6 m + radius misses');
  // swimming: eye just above the water, shark level in front
  assert.ok(rayHit({ x: 10, y: 0.3, z: 4 }, { x: 1, y: 0, z: 0 }, { x: 12, y: 0, z: 4.2 }, out) >= 0);
  assert.equal(rayHit({ x: 10, y: 0.3, z: 4 }, { x: 1, y: 0, z: 0 }, { x: 12, y: -2, z: 4 }, out), -1, 'deep below misses');
  assert.equal(rayHit(o, { x: 0, y: 0, z: 0 }, onRay, out), -1, 'zero direction');
  assert.equal(rayHit(o, d, null, out), -1);
  assert.equal(rayHit(o, d, { x: NaN, y: 0, z: 0 }, out), -1);
});

test('spear: a stab against a fake bus.shark hits once at the peak and wears 1 use', () => {
  const calls = [];
  bus.shark = { position: { x: 0, y: 0.2, z: -2 }, alive: true, onDeath: null,
    hit(dmg, point, dir) { calls.push({ dmg, point: { ...point }, dir: { ...dir } }); return true; } };
  try {
    const bag = emptyBag(); bag.add('spear', 1, { durability: 100 });
    const idx = bag.slots.findIndex((s) => s?.kind === 'spear');
    const st = createStab(), o = { x: 0, y: 1.5, z: 0 }, d = { x: 0, y: -0.55, z: -0.84 }, p = { x: 0, y: 0, z: 0 };
    startStab(st);
    for (let i = 0; i < 40; i++) {
      if (!tickStab(st, DT)) continue;
      const s = bus.shark;
      if (s?.alive !== false && rayHit(o, d, s.position, p) >= 0 && s.hit(SPEAR.damage, p, d)) wearSpear(bag, idx);
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].dmg, 5);
    assert.equal(bag.slots[idx].durability, 95);
  } finally { bus.shark = null; }
});

test('spear: 20 hits use up the spear, then it snaps', () => {
  const bag = emptyBag(); bag.add('spear', 1, { durability: 100 });
  const idx = bag.slots.findIndex((s) => s?.kind === 'spear');
  const v0 = bag.version;
  for (let i = 1; i < 20; i++) {
    const r = wearSpear(bag, idx);
    assert.equal(r.broke, false);
    assert.equal(r.durability, 100 - 5 * i);
  }
  assert.ok(bag.version > v0, 'bag version bumps so the hotbar redraws');
  assert.deepEqual(wearSpear(bag, idx), { durability: 0, broke: true });
  assert.equal(bag.slots[idx], null);
  assert.equal(bag.count('spear'), 0);
  assert.equal(wearSpear(bag, idx), null, 'nothing to wear');
  bag.add('wood', 3);
  assert.equal(wearSpear(bag, bag.slots.findIndex((s) => s?.kind === 'wood')), null, 'only spears wear');
});

test('spear: a shark kill (onDeath) drops 4 raw shark meat into the bag', () => {
  const bag = emptyBag();
  let got = null;
  bus.shark = { position: { x: 1, y: 0, z: 1 }, alive: true, hit: () => true, onDeath: null };
  try {
    // game.js chains onDeath like this
    const prev = bus.shark.onDeath;
    bus.shark.onDeath = (pos) => { prev?.(pos); got = giveSharkMeat(bag, SPEAR.meatDrop); };
    bus.shark.onDeath({ x: 1, y: 0, z: 1 });
  } finally { bus.shark = null; }
  assert.deepEqual(got, { added: 4, lost: 0 });
  assert.equal(SPEAR.meatDrop, 4);
  assert.equal(bag.count('sharkmeat'), 4);
  // full bag: meat that does not fit is reported as lost
  const full = new Bag({ slots: new Array(SLOT_COUNT).fill(null).map(() => ({ kind: 'wood', count: 20 })), selected: 0 });
  assert.deepEqual(giveSharkMeat(full), { added: 0, lost: 4 });
  assert.deepEqual(giveSharkMeat(null), { added: 0, lost: 4 });
});

test('spear: the grill cooks raw shark meat into grilled shark meat, like fish', () => {
  const r = stationRecipeFor('grill', 'sharkmeat');
  assert.equal(r?.id, 'cookedsharkmeat');
  assert.ok(r.recipe.time >= ITEMS.cookedfish.recipe.time && r.recipe.time <= 30, 'cook time near the fish default');
  const g = new StationModel('grill');
  assert.equal(g.accepts('sharkmeat'), true);
  assert.equal(g.accepts('fish'), true, 'fish still cooks');
  assert.equal(g.insert('sharkmeat', 2), 2);
  assert.ok(g.addFuel('wood', 2) > 0);
  for (let i = 0; i < 100; i++) g.tick(1);
  assert.equal(g.output?.kind, 'cookedsharkmeat');
  assert.equal(g.output.count, 2);
  assert.equal(new StationModel('smelter').accepts('sharkmeat'), false);
});

test('spear: held prompt says LMB Stab', () => {
  const p = statePrompt({ running: true, heldKind: 'spear', me: { pitch: 0 } });
  assert.deepEqual(p, { key: 'LMB', label: 'Stab' });
});

test('spear: viewmodel is a long spear held lower right, tip toward the crosshair, and thrusts forward', () => {
  const m = buildItemModel(T, 'spear');
  assert.equal(m.userData.kind, 'spear');
  assert.ok(m.userData.size.y > 0.85 && m.userData.size.y < 1, `length ${m.userData.size.y}`);
  let meshes = 0; m.traverse((o) => { if (o.isMesh) meshes++; });
  assert.ok(meshes <= 3, `merged per material (${meshes} meshes)`);
  const hands = createHands(T);
  hands.setHeld('spear');
  for (let i = 0; i < 40; i++) hands.update({ dt: 0.05, time: i * 0.05 });
  const spear = hands.itemModel('spear');
  const tipAt = (stab) => {
    hands.update({ dt: 0, time: 2, stab });
    hands.group.updateMatrixWorld(true);
    return spear.localToWorld(spear.userData.tip.clone());
  };
  const tip = tipAt(0), out = tipAt(1);
  assert.ok(tip.z < -1.2, `tip ahead (${tip.z})`);
  assert.ok(tip.x > 0 && tip.x / -tip.z < 0.3, `tip right of centre but close (${tip.x})`);
  assert.ok(tip.y < 0 && tip.y / -tip.z > -0.3, `tip just below the crosshair (${tip.y})`);
  assert.ok(out.z < tip.z - 0.25, 'stab pushes the tip forward');
  assert.equal(hands.state.stab, 1);
  hands.dispose();
});
