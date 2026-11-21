// Unit tests for dist/crops.js (Small Crop Plot, beets and potatoes) and dist/crops-model.js.
// Run: node --test tests/crops.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const C = await import(new URL('crops.js', base));
const M = await import(new URL('crops-model.js', base));
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { ITEMS, BARREL_LOOT, PLACEABLE_IDS, stationRecipeFor, rollBarrel } = await import(new URL('items.js', base));
const { FOOD, isEdible } = await import(new URL('vitals.js', base));
const { createContent } = await import(new URL('content.js', base));
const { cleanCrop, cleanSlot, normalizeDecor, tickCrops, applyCrop, stageOf, slotAt, slotPrompt, withoutCrops, createCrops, CROPS, YIELD, WATER_SECONDS, MAX_TICK, SPROUT, LEAFY, RIPE } = C;

const bagWith = (slots, selected = 0) => { const s = new Array(SLOT_COUNT).fill(null); slots.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected }); };
const fullBag = (extra = []) => bagWith([...extra, ...Array.from({ length: SLOT_COUNT - extra.length }, () => ({ kind: 'scrap', count: 20 }))]);
const plot = (x = 0, z = 0, crop) => ({ type: 'cropplot', x, z, crop: cleanCrop(crop) });
const act = (decor, bag, kind, slot, extra = {}) => applyCrop(decor, bag, { kind: 'crops.' + kind, x: 0, z: 0, slot, ...extra });
const grow = (decor, sec) => { let n = 0; while (sec > 0) { const k = Math.min(MAX_TICK, sec); n += tickCrops(decor, k); sec -= k; } return n; };

test('items: crop plot recipe, beet/potato food + seeds, grill recipes, barrel loot', () => {
  assert.deepEqual({ ...ITEMS.cropplot.recipe.cost }, { wood: 6, rope: 4 });
  assert.ok(ITEMS.cropplot.placeable && PLACEABLE_IDS.includes('cropplot'));
  assert.equal(stationRecipeFor('grill', 'beet')?.id, 'cookedbeet');
  assert.equal(stationRecipeFor('grill', 'potato')?.id, 'cookedpotato');
  assert.deepEqual([FOOD.beet.food, FOOD.potato.food, FOOD.cookedbeet.food, FOOD.cookedpotato.food], [10, 10, 15, 15]);
  for (const k of ['beet', 'potato', 'cookedbeet', 'cookedpotato']) assert.ok(isEdible(k), k);
  for (const k of ['beet', 'potato']) { const row = BARREL_LOOT.find(e => e.kind === k); assert.equal(row?.pool, 'treasure'); assert.ok(row.weight > 0 && row.weight <= 6); }
  let r = 1; const rand = () => (r = (r * 16807) % 2147483647) / 2147483647;
  let crops = 0; for (let i = 0; i < 2000; i++) { const l = rollBarrel(rand); crops += (l.beet ? 1 : 0) + (l.potato ? 1 : 0); }
  assert.ok(crops > 80 && crops < 300, `about 1 barrel in 12 gives a crop (${crops}/2000)`);
  assert.equal(CROPS.beet.grow, 50); assert.equal(CROPS.potato.grow, 300); // real Raft numbers
});

test('cleanCrop / normalizeDecor: junk and old saves become 3 empty slots; values clamped', () => {
  for (const v of [undefined, null, 'x', 3, {}, [null, 'x', 7]]) assert.deepEqual(cleanCrop(v), [{ c: '', g: 0, w: 0 }, { c: '', g: 0, w: 0 }, { c: '', g: 0, w: 0 }]);
  assert.deepEqual(cleanCrop([{ c: 'beet', g: 12.7, w: 999 }, { c: 'carrot', g: 5 }, { c: 'potato', g: 9999, w: 40 }, { c: 'beet' }]),
    [{ c: 'beet', g: 12, w: WATER_SECONDS }, { c: '', g: 0, w: 0 }, { c: 'potato', g: 300, w: 0 }]);
  assert.deepEqual(cleanSlot({ c: 'beet', g: -4, w: -1 }), { c: 'beet', g: 0, w: 0 });
  const decor = normalizeDecor([{ type: 'cropplot', x: 0, z: 0 }, { type: 'bench', x: 1, z: 0, crop: [1] }]);
  assert.equal(decor[0].crop.length, 3); assert.ok(!('crop' in decor[1]));
  assert.equal(JSON.stringify([plot(0, 0, [{ c: 'beet', g: 3, w: 9 }])], withoutCrops), JSON.stringify([{ type: 'cropplot', x: 0, z: 0 }]));
});

test('beet loop: plant from the held stack, grows only while watered, ripe at 50 s, harvest gives 2', () => {
  const decor = [plot()], bag = bagWith([{ kind: 'beet', count: 1 }, { kind: 'freshcup', count: 1 }]);
  assert.equal(act(decor, bag, 'water', 0).reason, 'empty');
  const p = act(decor, bag, 'plant', 0, { crop: 'beet' }); assert.ok(p.ok, p.text);
  assert.equal(bag.count('beet'), 0); assert.equal(decor[0].crop[0].c, 'beet');
  assert.equal(act(decor, bag, 'plant', 0, { crop: 'beet' }).reason, 'taken');
  grow(decor, 200); assert.equal(decor[0].crop[0].g, 0, 'dry soil: no growth');
  const w = act(decor, bag, 'water', 0); assert.ok(w.ok, w.text);
  assert.equal(bag.count('freshcup'), 0); assert.equal(bag.count('cup'), 1, 'the empty cup comes back');
  assert.equal(act(decor, bag, 'water', 0).reason, 'wet');
  assert.equal(stageOf(decor[0].crop[0]), SPROUT);
  grow(decor, 20); assert.equal(stageOf(decor[0].crop[0]), LEAFY);
  assert.equal(act(decor, bag, 'harvest', 0).reason, 'notripe');
  assert.equal(grow(decor, 30), 1, 'one slot ripened');
  assert.equal(stageOf(decor[0].crop[0]), RIPE); assert.equal(decor[0].crop[0].w, 0, 'ripe crops drop their water');
  const h = act(decor, bag, 'harvest', 0); assert.ok(h.ok); assert.deepEqual(h.loot, { beet: YIELD });
  assert.equal(bag.count('beet'), 2); assert.deepEqual(decor[0].crop[0], { c: '', g: 0, w: 0 });
  assert.equal(act(decor, bag, 'harvest', 0).reason, 'nothing');
});

test('potato: 300 s needs two cups; watering is per slot', () => {
  const decor = [plot()], bag = bagWith([{ kind: 'potato', count: 2 }, { kind: 'freshcup', count: 3 }]);
  assert.ok(act(decor, bag, 'plant', 1, { crop: 'potato' }).ok); assert.ok(act(decor, bag, 'plant', 2, { crop: 'potato' }).ok);
  assert.ok(act(decor, bag, 'water', 1).ok);
  grow(decor, WATER_SECONDS + 30);
  assert.equal(decor[0].crop[1].g, WATER_SECONDS); assert.equal(decor[0].crop[2].g, 0, 'the unwatered neighbour stays put');
  assert.ok(act(decor, bag, 'water', 1).ok); grow(decor, WATER_SECONDS);
  assert.equal(stageOf(decor[0].crop[1]), RIPE);
  assert.ok(act(decor, bag, 'harvest', 1).ok); assert.equal(bag.count('potato'), 2);
});

test('actions are atomic: no seed, no cup, full bag, bad targets', () => {
  const decor = [plot(0, 0, [{ c: 'beet', g: 50 }, { c: 'beet', g: 10 }])];
  assert.equal(act(decor, bagWith([]), 'plant', 2).reason, 'noseed');
  assert.equal(act(decor, bagWith([{ kind: 'beet', count: 1 }]), 'plant', 2, { crop: 'potato' }).reason, 'noseed');
  assert.equal(act(decor, bagWith([]), 'water', 1).reason, 'nocup');
  assert.equal(act(decor, bagWith([{ kind: 'freshcup', count: 1 }]), 'water', 0).reason, 'ripe');
  const full = fullBag(); const before = JSON.stringify(full.snapshot());
  assert.equal(act(decor, full, 'harvest', 0).reason, 'full'); assert.equal(JSON.stringify(full.snapshot()), before);
  assert.equal(decor[0].crop[0].c, 'beet', 'a failed harvest keeps the crop');
  for (const a of [{ kind: 'crops.plant', x: 0, z: 0, slot: 3 }, { kind: 'crops.plant', x: 1, z: 0, slot: 0 }, { kind: 'crops.plant', x: 0, z: 0, slot: 1.5 }, null])
    assert.equal(applyCrop(decor, bagWith([{ kind: 'beet', count: 1 }]), a).reason, 'notarget');
  const cupFull = fullBag([{ kind: 'freshcup', count: 2 }]);
  assert.equal(act(decor, cupFull, 'water', 1).reason, 'full', 'no room for the empty cup: nothing used up');
  assert.equal(cupFull.count('freshcup'), 2);
});

test('slotAt follows the plot rotation; slotPrompt reads the state', () => {
  const d = { type: 'cropplot', x: 1, z: 0 };
  assert.deepEqual([slotAt(d, 2 - .55, 0), slotAt(d, 2, 0), slotAt(d, 2.6, .1)], [0, 1, 2]);
  const r = { ...d, rot: Math.PI / 2 }; // local +x points to world -z
  assert.deepEqual([slotAt(r, 2, .55), slotAt(r, 2, -.55)], [0, 2]);
  assert.deepEqual(slotPrompt(cleanSlot(null), 'beet'), ['Click', 'Plant beet']);
  assert.equal(slotPrompt(cleanSlot({ c: 'beet', g: 50 }), null)[0], 'E');
  assert.equal(slotPrompt(cleanSlot({ c: 'potato', g: 30 }), 'freshcup')[0], 'Click');
  assert.match(slotPrompt(cleanSlot({ c: 'potato', g: 30 }), null)[1], /dry soil/);
});

test('models: merged plot body casts no shadow; plant kit is shared and survives rebuild disposal', () => {
  const g = M.createCropPlot(T);
  let meshes = 0, casters = 0; g.traverse(o => { if (o.isMesh) { meshes++; if (o.castShadow) casters++; } });
  assert.equal(meshes, 1); assert.equal(casters, 0); assert.equal(g.name, 'craft_cropplot');
  const kit = M.cropKit(T);
  assert.deepEqual(Object.keys(kit.geos).sort(), ['beet1', 'beet2', 'potato1', 'potato2', 'sprout']);
  for (const geo of [...Object.values(kit.geos), kit.wetGeo]) { assert.ok(geo.userData.shared); assert.ok(geo.attributes.position.count > 0); }
  assert.ok(kit.plantMat.userData.shared && kit.wetMat.userData.shared);
});

test('content module: host action checks reach, applies, emits; paint shows stages; guest only sends', () => {
  const raft = new T.Group(), emits = [], actions = [];
  const world = { tiles: [[0, 0], [1, 0]], decor: [plot(0, 0)] };
  const bag = bagWith([{ kind: 'beet', count: 2 }, { kind: 'freshcup', count: 1 }]);
  const cam = new T.PerspectiveCamera(); cam.position.set(0, 1.7, 1.2); cam.lookAt(-.55, .49, 0); cam.updateMatrixWorld();
  const ctx = { T, raft, camera: cam, world, role: 'host', running: true, physics: { x: 0, z: 1.2 }, other: { x: 9, z: 9 }, localBag: () => bag,
    action: a => actions.push(a), emit: (e, to) => emits.push([e, to]), notice: s => emits.push([{ kind: 'notice', text: s }, 'me']), esc: s => s, rebuildRaft() {
      for (const c of [...raft.children]) raft.remove(c);
      for (const d of world.decor) { const m = mod.decorModel(d.type); if (m) { m.position.set(d.x * 2, .22, d.z * 2); raft.add(m); } }
    } };
  const mod = createCrops(ctx); ctx.rebuildRaft();
  const aim = { dir: cam.getWorldDirection(new T.Vector3()) };
  assert.deepEqual(mod.debug.target(aim), { x: 0, z: 0, slot: 0 });
  assert.ok(mod.claims('beet', aim)); assert.ok(!mod.claims('fish', aim));
  assert.equal(mod.prompt(aim), '<kbd>Click</kbd>Plant beet');
  assert.ok(mod.use('beet', aim)); assert.deepEqual(actions.pop(), { kind: 'crops.plant', x: 0, z: 0, slot: 0, crop: 'beet' });
  assert.ok(mod.action({ kind: 'crops.plant', x: 0, z: 0, slot: 0, crop: 'beet' }, 'host', bag));
  assert.equal(world.decor[0].crop[0].c, 'beet'); assert.equal(emits.pop()[0].kind, 'build');
  assert.ok(mod.action({ kind: 'crops.plant', x: 0, z: 0, slot: 1, crop: 'beet' }, 'guest', bag), 'far guest: handled, ignored');
  assert.equal(world.decor[0].crop[1].c, '');
  assert.ok(!mod.action({ kind: 'bees.harvest', x: 0, z: 0 }, 'host', bag));
  mod.update(0); assert.deepEqual(mod.debug.shown(), [['sprout', '', '']]);
  assert.ok(mod.use('freshcup', aim)); mod.action(actions.pop(), 'host', bag);
  mod.update(0); assert.deepEqual(mod.debug.shown(), [['sprout+wet', '', '']]);
  mod.debug.fastForward(30); mod.update(0); assert.equal(mod.debug.shown()[0][0], 'beet1+wet');
  for (let i = 0; i < 25; i++) mod.update(1);
  assert.equal(mod.debug.shown()[0][0], 'beet2'); assert.ok(emits.some(([e]) => e.text === 'A crop is ripe'));
  assert.equal(mod.prompt(aim), '<kbd>E</kbd>Harvest beet');
  assert.ok(mod.interact(aim)); mod.action(actions.pop(), 'host', bag);
  assert.equal(bag.count('beet'), 1 + YIELD); mod.update(0); assert.deepEqual(mod.debug.shown(), [['', '', '']]);
  ctx.role = 'guest'; world.decor[0].crop[2] = { c: 'potato', g: 0, w: 100 }; mod.update(5); assert.equal(world.decor[0].crop[2].g, 0, 'guests never tick');
  mod.dispose();
});

test('content registry exposes use/claims and lists the crops module', () => {
  const reg = createContent({ T: null, world: { decor: [] } }, [createCrops]);
  assert.ok(reg.debug.crops); assert.equal(reg.use('beet', null), false); assert.equal(reg.claims('beet', null), false);
});
