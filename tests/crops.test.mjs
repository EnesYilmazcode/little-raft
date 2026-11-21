// Unit tests for dist/crops-rules.js, dist/crops.js and dist/crops-models.js (Garden Bed crops).
// Run: node --test tests/crops.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const R = await import(new URL('crops-rules.js', base));
const { createCrops } = await import(new URL('crops.js', base));
const M = await import(new URL('crops-models.js', base));
const { Bag, SLOT_COUNT, ITEM_INFO, RECIPES } = await import(new URL('inventory-state.js', base));
const { ITEMS, BLOCK_RADII, PLACEABLE_IDS } = await import(new URL('items.js', base));
const { ITEM_TEXT, ITEM_SOURCE } = await import(new URL('craft-book.js', base));
const { ITEM_ICONS } = await import(new URL('item-svg.js', base));
const { buildItemModel } = await import(new URL('held-items.js', base));
const { hasModel } = await import(new URL('models.js', base));
// crops.js registers its foods on the stamped vitals.js instance the game loads (dist imports all carry ?build=)
const STAMP = (await import('node:fs')).readFileSync(new URL('crops.js', base), 'utf8').match(/vitals\.js(\?[^'"]*)/)?.[1] ?? '';
const { isEdible, FOOD } = await import(new URL('vitals.js' + STAMP, base));
const { lootFor } = await import(new URL('islands-layout.js', base));
const { cleanCrops, tickCrops, stage, plant, water, harvest, CROPS, WET_MAX, MAX_TICK, OLD_HOST } = R;

const bagWith = (slots, selected = 0) => {
  const s = new Array(SLOT_COUNT).fill(null);
  slots.forEach((v, i) => { s[i] = v; });
  return new Bag({ slots: s, selected });
};
const fullBag = extra => bagWith([...Array.from({ length: SLOT_COUNT - (extra ? 1 : 0) }, () => ({ kind: 'scrap', count: 20 })), ...(extra ? [extra] : [])]);
const bed = (x = 0, z = 0) => ({ type: 'gardenbed', x, z });
const fresh = () => cleanCrops(undefined, []);
const KINDS = ['flaxseed', 'bellseed', 'tuberseed', 'fibre', 'petal', 'tuber', 'roasttuber', 'gardenbed'];

test('cleanCrops: junk gives defaults; non-bed keys, bad crops and bad numbers dropped or clamped', () => {
  for (const v of [undefined, null, [], 'x', 3, { b: [] }, { b: 'x' }]) assert.deepEqual(cleanCrops(v, [bed()]), { v: 1, r: 0, s: '', b: {} });
  const decor = [bed(0, 0), bed(1, 0), bed(-2, 3), bed(4, 4), bed(5, 5), { type: 'palm', x: 2, z: 2 }];
  const st = cleanCrops({ v: 1, s: 'abc', r: 7, b: {
    '0,0': { c: 'flax', g: 40.7, w: 12.9 }, '1,0': { c: 'tuber', g: 9999, w: 999 }, '-2,3': { c: 'bell', g: -4, w: 'x' },
    '4,4': { c: 'rose', g: 1, w: 1 }, '5,5': 'x', '2,2': { c: 'flax', g: 1, w: 1 }, '9,9': { c: 'flax', g: 1, w: 1 }, 'a,b': { c: 'flax' }, '01,0': { c: 'flax' },
  } }, decor);
  assert.equal(st.s, 'abc'); assert.equal(st.r, 7);
  assert.deepEqual(st.b, { '0,0': { c: 'flax', g: 40, w: 12 }, '1,0': { c: 'tuber', g: 180, w: WET_MAX }, '-2,3': { c: 'bell', g: 0, w: 0 } });
});

test('tick: dry pauses, wet grows and drains, ripe stops, MAX_TICK clamps, rain holds w', () => {
  const decor = [bed()];
  let st = fresh(); st.b['0,0'] = { c: 'flax', g: 10, w: 0 };
  const r0 = st.r;
  for (let i = 0; i < 600; i++) tickCrops(st, decor, 1);
  assert.deepEqual(st.b['0,0'], { c: 'flax', g: 10, w: 0 }); assert.equal(st.r, r0, 'a dry bed does not bump the revision');
  st.b['0,0'].w = WET_MAX;
  tickCrops(st, decor, 1); assert.deepEqual(st.b['0,0'], { c: 'flax', g: 11, w: WET_MAX - 1 }); assert.ok(st.r > r0);
  st.b['0,0'].w = WET_MAX; tickCrops(st, decor, 1e6); assert.deepEqual(st.b['0,0'], { c: 'flax', g: 11 + MAX_TICK, w: 0 }, 'MAX_TICK clamp');
  tickCrops(st, decor, 0.9); tickCrops(st, decor, NaN); tickCrops(st, decor, -5); assert.equal(st.b['0,0'].g, 71);
  // two cups ripen flax
  st = fresh(); st.b['0,0'] = { c: 'flax', g: 0, w: WET_MAX };
  for (let i = 0; i < 60; i++) tickCrops(st, decor, 1);
  assert.equal(stage(st.b['0,0']), 1); st.b['0,0'].w = WET_MAX;
  const ripe = []; for (let i = 0; i < 100; i++) ripe.push(...tickCrops(st, decor, 1));
  assert.deepEqual(ripe, ['0,0']); assert.deepEqual(st.b['0,0'], { c: 'flax', g: 120, w: 0 });
  // ripe: g clamps, w stops draining
  st.b['0,0'].w = 30; const r1 = st.r; tickCrops(st, decor, 10); assert.deepEqual(st.b['0,0'], { c: 'flax', g: 120, w: 30 }); assert.equal(st.r, r1);
  // rain: held at WET_MAX while growing, dry beds turn wet
  st = fresh(); st.b['0,0'] = { c: 'tuber', g: 0, w: 0 };
  tickCrops(st, decor, 1, true); assert.deepEqual(st.b['0,0'], { c: 'tuber', g: 1, w: WET_MAX });
  for (let i = 0; i < 200; i++) tickCrops(st, decor, 1, true);
  assert.deepEqual(st.b['0,0'], { c: 'tuber', g: 180, w: WET_MAX });
  // a picked-up bed loses its crop
  decor.length = 0; const r2 = st.r; tickCrops(st, decor, 0); assert.deepEqual(st.b, {}); assert.ok(st.r > r2);
});

test('stage boundaries for each crop', () => {
  for (const c of Object.keys(CROPS)) {
    const T0 = CROPS[c].T, h = T0 / 2;
    assert.equal(stage({ c, g: 0 }), 0); assert.equal(stage({ c, g: h - 1 }), 0); assert.equal(stage({ c, g: h }), 1);
    assert.equal(stage({ c, g: T0 - 1 }), 1); assert.equal(stage({ c, g: T0 }), 2);
  }
  assert.deepEqual([CROPS.flax.T, CROPS.bell.T, CROPS.tuber.T], [120, 150, 180]);
  assert.equal(stage(null), 0); assert.equal(stage({ c: 'nope', g: 999 }), 0);
});

test('plant / water / harvest rules', () => {
  const decor = [bed(), { type: 'palm', x: 1, z: 0 }];
  const st = fresh();
  const bag = bagWith([{ kind: 'flaxseed', count: 2 }, { kind: 'freshcup', count: 1 }, { kind: 'wood', count: 3 }]);
  assert.equal(plant(st, decor, 0, 0, 'wood', bag).reason, 'noseed');
  assert.equal(plant(st, decor, 1, 0, 'flaxseed', bag).reason, 'notarget');
  assert.equal(plant(st, decor, 0, 0, 'bellseed', bag).reason, 'noseed', 'not in the bag');
  assert.ok(plant(st, decor, 0, 0, 'flaxseed', bag).ok);
  assert.deepEqual(st.b['0,0'], { c: 'flax', g: 0, w: 0 }); assert.equal(bag.count('flaxseed'), 1);
  assert.equal(plant(st, decor, 0, 0, 'flaxseed', bag).reason, 'occupied'); assert.equal(bag.count('flaxseed'), 1);
  // water: no freshcup leaves the bag unchanged
  const dry = bagWith([{ kind: 'cup', count: 1 }]), snap = JSON.stringify(dry.snapshot());
  assert.equal(water(st, decor, 0, 0, dry).reason, 'nocup'); assert.equal(JSON.stringify(dry.snapshot()), snap); assert.equal(st.b['0,0'].w, 0);
  assert.ok(water(st, decor, 0, 0, bag).ok);
  assert.equal(bag.count('freshcup'), 0); assert.equal(bag.count('cup'), 1); assert.equal(st.b['0,0'].w, WET_MAX);
  assert.equal(water(st, decor, 0, 0, bagWith([{ kind: 'freshcup', count: 1 }])).reason, 'notdry');
  assert.equal(harvest(st, decor, 0, 0, bag).reason, 'notripe');
  st.b['0,0'] = { c: 'flax', g: 120, w: 0 };
  assert.equal(water(st, decor, 0, 0, bagWith([{ kind: 'freshcup', count: 1 }])).reason, 'ripe');
  // full bag keeps the crop
  const fb = fullBag(), fsnap = JSON.stringify(fb.snapshot());
  assert.equal(harvest(st, decor, 0, 0, fb).reason, 'full'); assert.equal(JSON.stringify(fb.snapshot()), fsnap); assert.ok(st.b['0,0']);
  const r = harvest(st, decor, 0, 0, bag);
  assert.deepEqual(r, { ok: true, kind: 'loot', loot: { fibre: 2, flaxseed: 1 }, text: '+ 2 flax fibre · 1 sea flax seed' });
  assert.equal(bag.count('fibre'), 2); assert.equal(bag.count('flaxseed'), 2); assert.equal(st.b['0,0'], undefined);
  assert.equal(harvest(st, decor, 0, 0, bag).reason, 'empty');
  // raining: a new plant starts wet
  assert.ok(plant(st, decor, 0, 0, 'tuberseed', bagWith([{ kind: 'tuberseed', count: 1 }]), true).ok);
  assert.deepEqual(st.b['0,0'], { c: 'tuber', g: 0, w: WET_MAX });
});

test('harvest: bee bonus at Chebyshev 2 but not 3', () => {
  for (const [hx, hz, want] of [[2, 2, 3], [-2, 1, 3], [3, 0, 2], [0, -3, 2]]) {
    const decor = [bed(), { type: 'beehive', x: hx, z: hz }], st = fresh();
    st.b['0,0'] = { c: 'bell', g: 150, w: 0 };
    const bag = bagWith([]);
    assert.ok(harvest(st, decor, 0, 0, bag).ok);
    assert.equal(bag.count('petal'), want, `hive at ${hx},${hz}`); assert.equal(bag.count('bellseed'), 1);
  }
});

function modCtx(role = 'solo') {
  const world = { decor: [bed(0, 0)], tiles: [[0, 0], [1, 0]] };
  const emits = [], notices = [], actions = [];
  let bag = bagWith([]);
  const ctx = { T: null, world, role, running: true, physics: { x: 0, z: 0 }, other: { x: 50, z: 50 }, camera: null, raft: null,
    rain: () => 0, localBag: () => bag, emit: (e, to) => emits.push([e, to]), notice: s => notices.push(s), action: a => actions.push(a) };
  return { ctx, emits, notices, actions, setBag: b => { bag = b; } };
}
const AIM = { point: { x: 0.2, y: 0, z: -0.3 } };

test('module: actions, reach, prompts, net load caching, OLD_HOST', () => {
  const { ctx, emits, setBag } = modCtx();
  const m = createCrops(ctx);
  assert.equal(m.name, 'crops');
  m.load(undefined, 'save');
  assert.deepEqual(m.debug.state().b, {});
  const bag = bagWith([{ kind: 'bellseed', count: 1 }]); setBag(bag);
  assert.equal(m.prompt(AIM), '<kbd>E</kbd>Plant Blushbell');
  assert.equal(m.action({ kind: 'storage.put' }, 'host', bag), false);
  assert.equal(m.action({ kind: 'crops.plant', x: 0.5, z: 0, seed: 'bellseed' }, 'host', bag), true);
  assert.equal(m.action({ kind: 'crops.plant', x: 0, z: 0, seed: 'bellseed' }, 'guest', bag), true); // guest far away
  assert.deepEqual(m.debug.state().b, {}); assert.equal(bag.count('bellseed'), 1);
  assert.equal(m.action({ kind: 'crops.plant', x: 0, z: 0, seed: 'bellseed' }, 'host', bag), true);
  assert.deepEqual(m.debug.state().b, { '0,0': { c: 'bell', g: 0, w: 0 } });
  assert.equal(m.prompt(AIM), null); assert.equal(m.debug.promptText(AIM), 'Blushbell 0% · dry, needs fresh water');
  setBag(bagWith([{ kind: 'freshcup', count: 1 }]));
  assert.equal(m.prompt(AIM), '<kbd>E</kbd>Water the bed');
  const s1 = m.serialize(); assert.equal(m.serialize(), s1, 'serialize cached by revision');
  m.debug.setGrow(0, 0, 75, 10);
  assert.notEqual(m.serialize(), s1);
  assert.equal(m.prompt(AIM), null); assert.equal(m.debug.promptText(AIM), 'Blushbell 50% · watered');
  ctx.rain = () => 1; assert.equal(m.prompt(AIM), null); assert.equal(m.debug.promptText(AIM), 'Blushbell 50% · rain'); ctx.rain = () => 0;
  // host update ticks at 1 Hz
  for (let i = 0; i < 40; i++) m.update(1 / 4);
  assert.deepEqual(m.debug.state().b['0,0'], { c: 'bell', g: 85, w: 0 });
  m.debug.setGrow(0, 0, 150, 0);
  assert.equal(m.prompt(AIM), '<kbd>E</kbd>Harvest Blushbell');
  const hb = bagWith([]);
  ctx.other = { x: 1, z: 0 };
  assert.equal(m.action({ kind: 'crops.harvest', x: 0, z: 0 }, 'guest', hb), true);
  assert.deepEqual(emits.at(-1), [{ kind: 'loot', text: '+ 2 blushbell petals · 1 blushbell seed', loot: { petal: 2, bellseed: 1 } }, 'guest']);
  assert.equal(hb.count('petal'), 2);
  assert.equal(m.prompt(AIM), null); assert.equal(m.debug.promptText(AIM), 'Garden Bed: plant a crop seed');
  assert.equal(m.prompt({ point: { x: 20, y: 0, z: 0 } }), null);

  // guest side
  const g = modCtx('guest'); const gm = createCrops(g.ctx);
  const data = { v: 1, s: 'host1', r: 5, b: { '0,0': { c: 'tuber', g: 180, w: 0 } } };
  gm.load(data, 'net');
  const ref = gm.debug.state();
  gm.load(JSON.parse(JSON.stringify(data)), 'net');
  assert.deepEqual(gm.debug.state(), ref);
  assert.equal(gm.prompt(AIM), '<kbd>E</kbd>Harvest Sweet Tuber');
  assert.equal(gm.interact(AIM), true);
  assert.deepEqual(g.actions.at(-1), { kind: 'crops.harvest', x: 0, z: 0 });
  gm.load({ ...data, r: 6, b: { '0,0': { c: 'tuber', g: 9999, w: 0 }, '7,7': { c: 'flax', g: 1, w: 1 } } }, 'net');
  assert.deepEqual(gm.debug.state().b, { '0,0': { c: 'tuber', g: 180, w: 0 } }, 'a changed r re-cleans');
  gm.update(100); assert.deepEqual(gm.debug.state().b, { '0,0': { c: 'tuber', g: 180, w: 0 } }, 'guests never tick');
  gm.load(undefined, 'net');
  assert.equal(gm.prompt(AIM), null); assert.equal(gm.debug.promptText(AIM), OLD_HOST);
  const sent = g.actions.length;
  assert.equal(gm.interact(AIM), true); assert.equal(g.actions.length, sent, 'an old host never gets crops.*');
  assert.deepEqual(g.notices.at(-1), OLD_HOST);
});

test('catalogue: every new kind has items, text, source, icon and a model or held fallback', () => {
  for (const k of KINDS) {
    assert.ok(ITEMS[k] && ITEMS[k].tip.length > 10, `${k} item`);
    assert.ok(ITEM_INFO[k], `${k} ITEM_INFO`);
    assert.equal(ITEMS[k].placeholder, true, `${k} uses an ITEM_ICONS drawing`);
    assert.ok(ITEM_TEXT[k]?.desc && ITEM_TEXT[k]?.use, `${k} text`);
    assert.ok(ITEM_SOURCE[k]?.tag || RECIPES[k], `${k} source`);
    assert.ok(ITEM_ICONS[k], `${k} icon`);
    assert.ok(hasModel(k) || buildItemModel(T, k), `${k} model or held fallback`);
  }
  assert.deepEqual(RECIPES.fibrerope.output, { kind: 'rope', count: 1 }); assert.deepEqual(RECIPES.fibrerope.cost, { fibre: 1 });
  assert.deepEqual(RECIPES.blushpaint.output, { kind: 'paint_coral', count: 4 }); assert.deepEqual(RECIPES.blushpaint.cost, { petal: 2 });
  assert.deepEqual(RECIPES.gardenbed.cost, { wood: 4, sand: 2, leaf: 2 });
  assert.equal(ITEMS.roasttuber.recipe.station, 'grill');
  assert.ok(isEdible('tuber') && isEdible('roasttuber'));
  assert.equal(FOOD.tuber.food, 8); assert.equal(FOOD.roasttuber.food, 25);
  assert.equal(BLOCK_RADII.gardenbed, 0.45); assert.ok(PLACEABLE_IDS.includes('gardenbed'));
  for (const seed of ['flaxseed', 'bellseed', 'tuberseed']) {
    let hit = false;
    for (let s = 0; s < 400 && !hit; s++) hit = lootFor('bush', s, 0, 0).some(([k]) => k === seed);
    assert.ok(hit, `bushes drop ${seed}`);
  }
});

test('model: bed repaints only on a new signature and shares geometry', () => {
  const m = createCrops({ T, world: { decor: [] }, role: 'solo' });
  const a = m.decorModel('gardenbed'), b = m.decorModel('gardenbed');
  assert.equal(a.name, 'craft_gardenbed'); assert.equal(m.decorModel('palm'), null);
  assert.equal(M.paintBed(a, null), true); assert.equal(M.paintBed(a, null), false);
  const soil = a.getObjectByName('bedSoil'), crop = a.getObjectByName('bedCrop');
  const dryMat = soil.material;
  assert.equal(M.paintBed(a, { c: 'flax', stage: 0, wet: true }), true);
  assert.notEqual(soil.material, dryMat); assert.ok(crop.visible);
  assert.equal(M.paintBed(a, { c: 'flax', stage: 0, wet: true }), false);
  M.paintBed(b, { c: 'flax', stage: 0, wet: false });
  assert.equal(b.getObjectByName('bedCrop').geometry, crop.geometry, 'stage geometry is shared');
  assert.equal(b.getObjectByName('bedSoil').material, dryMat);
  const sigs = new Set();
  for (const c of ['flax', 'bell', 'tuber']) for (const s of [0, 1, 2]) { M.paintBed(a, { c, stage: s, wet: false }); sigs.add(crop.geometry); }
  assert.equal(sigs.size, 9, 'every crop and stage has its own mesh');
  const hs = [0, 1, 2].map(s => { M.paintBed(a, { c: 'flax', stage: s, wet: false }); crop.geometry.computeBoundingBox(); return crop.geometry.boundingBox.max.y; });
  assert.ok(hs[0] < hs[1] && hs[1] < hs[2], 'plants grow taller');
});

test('prompt provider: steps aside for pickups and a watering decor in reach, never reads the full debug state', () => {
  const { ctx, setBag } = modCtx();
  let prov = null, stateReads = 0;
  const prevP = globalThis.raftPrompts, prevD = globalThis.raftDebug;
  const hud = { pickup: null, role: 'solo', networkReady: true, swimming: false };
  globalThis.raftPrompts = { provide: o => { prov = o; return () => { prov = null; }; } };
  globalThis.raftDebug = { hud };
  try {
    let aim = AIM; ctx.aim = () => aim;
    const m = createCrops(ctx); m.load(undefined, 'save'); m.update(0);
    assert.equal(prov?.priority, 1);
    const pc = { get state() { stateReads++; return hud; } };
    setBag(bagWith([{ kind: 'flaxseed', count: 1 }]));
    assert.deepEqual(prov.prompt(pc), { key: 'E', label: 'Plant Sea Flax' });
    aim = { point: { x: 20, y: 0, z: 0 } }; assert.equal(prov.prompt(pc), null);
    aim = { ...AIM, decor: { type: 'palm', x: 1, z: 0 } };
    assert.equal(prov.prompt(pc), null, 'a palm in reach takes E (game.js wateringTarget)'); assert.equal(m.prompt(aim), null);
    aim = { ...AIM, decor: { type: 'palm', x: 9, z: 0 } }; assert.deepEqual(prov.prompt(pc), { key: 'E', label: 'Plant Sea Flax' });
    aim = AIM; hud.pickup = { type: 'wood' }; assert.equal(prov.prompt(pc), null);
    assert.equal(stateReads, 0, 'raftDebug.hud is used, not the deep-copied pc.state');
    m.dispose(); assert.equal(prov, null);
  } finally { globalThis.raftPrompts = prevP; globalThis.raftDebug = prevD; }
});

test('model: shared geometry and materials are flagged so rebuildRaft does not dispose them', () => {
  const g = M.createGardenBed(T); M.paintBed(g, { c: 'tuber', stage: 2, wet: true });
  g.traverse(o => { if (!o.isMesh) return; assert.ok(o.geometry.userData.shared, o.name + ' geometry'); assert.ok(o.material.userData.shared, o.name + ' material'); });
  M.paintBed(g, null); assert.ok(g.getObjectByName('bedSoil').material.userData.shared);
});
