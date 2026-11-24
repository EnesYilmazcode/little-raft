// Stone Axe + palm chopping: chop count, drops, durability, the coconut food and the module glue.
// Run: node --test tests/axe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const L = await import(new URL('islands-layout.js', base));
const { createIslands } = await import(new URL('islands.js', base));
const { Bag, SLOT_COUNT, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));
const I = await import(new URL('items.js', base));
const V = await import(new URL('vitals.js', base));
const { buildItemModel } = await import(new URL('held-items.js', base));
const { ITEM_ICONS } = await import(new URL('item-svg.js', base));
const { ITEM_TEXT, ITEM_SOURCE, categoryOf } = await import(new URL('craft-book.js', base));
const { CHOP, NODE_MAX, chopLoot, layoutFor, applyGather } = L;

const SEED = 1234;
const axeBag = (durability = 100) => {
  const slots = new Array(SLOT_COUNT).fill(null);
  slots[0] = { kind: 'axe', count: 1, durability };
  return new Bag({ slots, selected: 0 });
};
function chopSetup() {
  const lay = layoutFor(SEED);
  const st = { isl: { seed: SEED, born: 0, dock: 180, side: 1, off: 20, used: lay.nodes.map(() => 0) }, layout: lay, cx: 20, cz: -2, clock: 100, cool: { host: 0, guest: 0 } };
  const p = lay.nodes.findIndex(n => n.kind === 'palm'), pn = lay.nodes[p];
  return { lay, st, p, pos: { x: st.cx + pn.x, z: st.cz + pn.z + 1 } };
}
const chopA = (node, slot = 0) => ({ kind: 'islands.chop', seed: SEED, node, slot });

// ---------------------------------------------------------------- item + food

test('Stone Axe item: recipe, durability, unlock and tool role', () => {
  const a = I.ITEMS.axe;
  assert.equal(a.name, 'Stone Axe');
  assert.equal(a.category, 'tool'); assert.equal(a.tool, true); assert.equal(a.stack, 1);
  assert.equal(a.durability, 50);
  assert.deepEqual(a.recipe.cost, { wood: 6, stone: 3, rope: 2 });
  assert.equal(a.recipe.station, null);
  assert.deepEqual(a.unlock, { type: 'research', items: ['wood', 'stone', 'rope'] });
  assert.equal(I.toolRole('axe'), 'axe'); assert.equal(L.isAxe('axe'), true); assert.equal(L.isAxe('hammer'), false);
  assert.equal(I.wearPerUse('axe'), 2);
  assert.ok(I.repairCost('axe'));
  assert.equal(ITEM_INFO.axe.tool, true);
  assert.ok(ITEM_ICONS.axe && ITEM_ICONS.coconut, 'svg icons');
  assert.ok(ITEM_TEXT.axe && ITEM_TEXT.coconut && ITEM_SOURCE.coconut, 'craft book text');
  assert.equal(categoryOf('axe'), 'tools');
});

test('coconut is food: +5 food, +20 water', () => {
  assert.equal(I.ITEMS.coconut.category, 'food');
  assert.ok(ITEM_INFO.coconut);
  assert.equal(V.isEdible('coconut'), true);
  const v = V.newVitals({ hp: 100, food: 50, water: 50 });
  const e = V.consume(v, 'coconut');
  assert.deepEqual({ food: e.food, water: e.water }, { food: 5, water: 20 });
  assert.equal(v.food, 55); assert.equal(v.water, 70);
  assert.equal(V.eatLabel('coconut'), 'Eat (+5 food, +20 water)');
});

test('held axe model: small, gripped, no shadows', () => {
  const m = buildItemModel(T, 'axe');
  assert.equal(m.userData.kind, 'axe');
  assert.ok(m.userData.size.y > 0.2 && m.userData.size.y < 0.6, `size ${m.userData.size.y}`);
  let meshes = 0, tris = 0;
  m.traverse(o => { if (o.isMesh) { meshes++; assert.equal(o.castShadow, false); const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  assert.ok(meshes <= 8, `${meshes} meshes`); assert.ok(tris < 600, `${tris} tris`);
});

// ---------------------------------------------------------------- chop rules

test('five chops fell a palm; the last gives 5 planks + 2 leaves', () => {
  const { st, p, pos } = chopSetup(), bag = axeBag();
  assert.equal(NODE_MAX.palm, 5); assert.equal(st.layout.nodes[p].max, 5);
  for (let i = 0; i < 5; i++) {
    const r = applyGather(st, chopA(p), 'host', pos, bag);
    assert.equal(r.ok, true, `chop ${i + 1}`);
    assert.equal(r.felled, i === 4);
    st.clock += CHOP.HOST_COOLDOWN;
  }
  assert.equal(st.isl.used[p], 5);
  assert.equal(bag.count('wood'), 5); assert.equal(bag.count('leaf'), 2);
  assert.equal(applyGather(st, chopA(p), 'host', pos, bag).reason, 'drained');
});

test('chop drops: deterministic, felling chop always has the timber, roll rates near 17.6% / 11.8%', () => {
  for (let used = 0; used < 4; used++) assert.ok(chopLoot(7, 2, used).every(([k]) => k === 'coconut' || k === 'seed'));
  assert.deepEqual(chopLoot(7, 2, 4).slice(0, 2), [['wood', 5], ['leaf', 2]]);
  assert.deepEqual(chopLoot(99, 1, 3), chopLoot(99, 1, 3));
  let nuts = 0, seeds = 0, n = 0;
  for (let s = 0; s < 4000; s++) for (let used = 0; used < 5; used++) {
    const l = chopLoot((s * 2654435761) >>> 0, s % 5, used); n++;
    if (l.some(([k]) => k === 'coconut')) nuts++;
    if (l.some(([k]) => k === 'seed')) seeds++;
  }
  assert.ok(Math.abs(nuts / n - 0.176) < 0.015, `coconut rate ${nuts / n}`);
  assert.ok(Math.abs(seeds / n - 0.118) < 0.015, `seed rate ${seeds / n}`);
});

test('each chop wears the axe by one use; 50 chops break it', () => {
  const { st, p, pos } = chopSetup(), bag = axeBag();
  applyGather(st, chopA(p), 'host', pos, bag);
  assert.equal(bag.slots[0].durability, 98);
  // one chop left: the axe breaks on it
  const { st: st2, p: p2, pos: pos2 } = chopSetup(), bag2 = axeBag(2);
  const r = applyGather(st2, chopA(p2), 'host', pos2, bag2);
  assert.equal(r.ok, true); assert.equal(r.broke, true);
  assert.equal(bag2.slots[0], null); assert.equal(bag2.count('axe'), 0);
  // a fresh axe lasts exactly 50 chops (10 palms' worth)
  const bag3 = axeBag();
  let chops = 0;
  for (let palm = 0; palm < 20 && bag3.count('axe'); palm++) {
    const { st: s3, p: p3, pos: q3 } = chopSetup();
    for (let i = 0; i < 5 && bag3.count('axe'); i++) { s3.clock += 1; if (applyGather(s3, chopA(p3), 'host', q3, bag3).ok) chops++; }
    bag3.remove('wood', bag3.count('wood')); bag3.remove('leaf', bag3.count('leaf')); bag3.remove('coconut', bag3.count('coconut')); bag3.remove('seed', bag3.count('seed'));
  }
  assert.equal(chops, 50);
});

test('chop needs the axe in the named slot, on a palm, off cooldown', () => {
  const { st, p, pos, lay } = chopSetup();
  const empty = new Bag({ slots: new Array(SLOT_COUNT).fill(null), selected: 0 });
  assert.equal(applyGather(st, chopA(p), 'host', pos, empty).reason, 'axe');
  assert.equal(applyGather(st, chopA(p, 3), 'host', pos, axeBag()).reason, 'axe');
  assert.equal(applyGather(st, chopA(p, '0'), 'host', pos, axeBag()).reason, 'axe');
  assert.equal(applyGather(st, chopA(p), 'host', pos, axeBag(0)).reason, 'axe');
  assert.equal(applyGather(st, { kind: 'islands.gather', seed: SEED, node: p }, 'host', pos, axeBag()).reason, 'axe', 'E gather on a palm gives nothing');
  const rock = lay.nodes.findIndex(n => n.kind === 'rock'), rn = lay.nodes[rock];
  assert.equal(applyGather(st, chopA(rock), 'host', { x: st.cx + rn.x + 1, z: st.cz + rn.z }, axeBag()).reason, 'node');
  assert.ok(st.isl.used.every(u => u === 0));
  const bag = axeBag();
  assert.equal(applyGather(st, chopA(p), 'guest', pos, bag).ok, true);
  assert.equal(applyGather(st, chopA(p), 'guest', pos, bag).reason, 'cooldown');
  st.clock += CHOP.HOST_COOLDOWN;
  assert.equal(applyGather(st, chopA(p), 'guest', pos, bag).ok, true);
  // bushes stay bare-hand
  const bush = lay.nodes.findIndex(n => n.kind === 'bush'), bn = lay.nodes[bush];
  st.clock += 1;
  assert.equal(applyGather(st, { kind: 'islands.gather', seed: SEED, node: bush }, 'host', { x: st.cx + bn.x + 1, z: st.cz + bn.z }, empty).ok, true);
  assert.ok(empty.count('leaf') >= 1);
});

// ---------------------------------------------------------------- module glue

function stubWorld({ role = 'solo', axe = true } = {}) {
  const physics = new PlayerPhysics({ x: 0, y: 0.2 + PC.EYE_OFFSET, z: 0 });
  const emits = [], actions = [], notices = [], sounds = [];
  const bag = axe ? axeBag() : new Bag({ slots: new Array(SLOT_COUNT).fill(null), selected: 0 });
  const ctx = {
    T, scene: new T.Scene(), camera: new T.PerspectiveCamera(70, 1, 0.05, 200),
    ocean: { mesh: { position: { y: -0.24 } }, getHeight: () => -0.24 },
    world: { tiles: [[0, 0]] }, role, running: true, physics, other: null,
    localBag: () => bag, notice: s => notices.push(s), play: ev => sounds.push(ev),
    emit: (e, to) => emits.push({ e, to }),
    action: a => { actions.push(a); if (role !== 'guest') mod.action(a, 'host', bag); return true; },
  };
  const mod = createIslands(ctx);
  return { ctx, mod, physics, emits, actions, notices, sounds, bag };
}
function aimPalm(w) {
  w.mod.debug.spawnNear(SEED); w.mod.update(0);
  const k = w.mod.debug.nodes().findIndex(n => n.kind === 'palm');
  const n = w.mod.debug.aimAt(k); w.mod.update(0);
  w.ctx.camera.position.set(w.physics.x, w.physics.y, w.physics.z);
  w.ctx.camera.lookAt(n.ax, n.cy, n.az); w.ctx.camera.updateMatrixWorld();
  return k;
}

test('LMB with the axe chops the aimed palm; 0.6 s swing cooldown; felled palm persists', () => {
  const w = stubWorld();
  const k = aimPalm(w);
  assert.equal(w.mod.debug.pick(), k);
  assert.match(w.mod.prompt(null), /<kbd>LMB<\/kbd>Chop palm \(5 left\)/);
  assert.equal(w.mod.use(null, 'axe'), true);
  assert.deepEqual(w.actions.at(-1), { kind: 'islands.chop', seed: SEED, node: k, slot: 0 });
  assert.deepEqual(w.sounds, ['chop']);
  assert.equal(w.mod.serialize().isl.used[k], 1);
  assert.equal(w.mod.use(null, 'axe'), false, 'still swinging');
  assert.equal(w.mod.use(null, 'hammer'), false, 'other tools pass through');
  for (let i = 0; i < 4; i++) { w.mod.update(CHOP.COOLDOWN + 0.01); w.mod.debug.skip(0); assert.equal(w.mod.use(null, 'axe'), true); }
  assert.equal(w.actions.length, 5);
  assert.equal(w.bag.count('wood'), 5); assert.equal(w.bag.count('leaf'), 2);
  assert.equal(w.bag.slots[0].durability, 90);
  assert.ok(w.emits.some(x => x.e.kind === 'loot' && x.e.loot && x.e.loot.wood === 5));
  const save = JSON.parse(JSON.stringify(w.mod.serialize()));
  assert.equal(save.isl.used[k], 5);
  const w2 = stubWorld(); w2.mod.load(save, 'save'); w2.mod.update(0);
  assert.equal(w2.mod.debug.nodes()[k].used, 5, 'felled palm restored from the save');
  assert.notEqual(w2.mod.debug.pick(), k);
});

test('no axe: palm prompt says so, E and LMB give nothing', () => {
  const w = stubWorld({ axe: false });
  const k = aimPalm(w);
  assert.equal(w.mod.prompt(null), 'Need a Stone Axe');
  assert.equal(w.mod.interact(null), true);
  assert.deepEqual(w.notices, ['Need a Stone Axe']);
  assert.equal(w.actions.length, 0);
  assert.equal(w.mod.use(null, 'hook'), false);
  assert.equal(w.mod.serialize().isl.used[k], 0);
});

test('guest chop is only sent; the host applies it to the guest bag', () => {
  const host = stubWorld();
  host.mod.debug.spawnNear(SEED); host.mod.update(0);
  const g = stubWorld({ role: 'guest' });
  g.mod.load(JSON.parse(JSON.stringify(host.mod.serialize())), 'net');
  const k = aimPalm(g);
  assert.equal(g.mod.use(null, 'axe'), true);
  const a = g.actions.at(-1);
  assert.equal(a.kind, 'islands.chop');
  assert.equal(g.mod.serialize().isl.used[k], 0, 'guest does not apply it');
  host.ctx.other = { x: g.physics.x, z: g.physics.z };
  const guestBag = axeBag();
  assert.equal(host.mod.action(a, 'guest', guestBag), true);
  assert.equal(host.mod.serialize().isl.used[k], 1);
  assert.equal(guestBag.slots[0].durability, 98);
});
