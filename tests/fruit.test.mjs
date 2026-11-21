// Unit tests for the Medium Crop Plot, watermelon and pineapple (dist/crops.js plot table, dist/crops-model.js,
// island fruit patches in dist/islands-layout.js, gull pecks in dist/scarecrow.js, two-bite food in dist/vitals.js).
// Run: node --test tests/fruit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const C = await import(new URL('crops.js', base));
const M = await import(new URL('crops-model.js', base));
const L = await import(new URL('islands-layout.js', base));
const S = await import(new URL('scarecrow.js', base));
const W = await import(new URL('wildlife.js', base));
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { ITEMS, PLACEABLE_IDS, BLOCK_RADII } = await import(new URL('items.js', base));
const V = await import(new URL('vitals.js', base));
const { ITEM_ICONS } = await import(new URL('item-svg.js', base));
const { ITEM_TEXT, ITEM_SOURCE, categoryOf } = await import(new URL('craft-book.js', base));
const { PLOTS, CROPS, SEED_OF, SEED_BACK, cleanCrop, applyCrop, tickCrops, slotAt, slotPrompt, harvestLoot, plotGrowing, isPlot, normalizeDecor, createCrops, MAX_TICK, RIPE } = C;

const bagWith = (slots, selected = 0) => { const s = new Array(SLOT_COUNT).fill(null); slots.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected }); };
const med = (x = 0, z = 0, crop) => ({ type: 'cropplot2', x, z, crop: cleanCrop(crop, 'cropplot2') });
const act = (decor, bag, kind, slot, extra = {}, rand) => applyCrop(decor, bag, { kind: 'crops.' + kind, x: 0, z: 0, slot, ...extra }, rand);
const grow = (decor, sec, skip) => { let n = 0; while (sec > 0) { const k = Math.min(MAX_TICK, sec); n += tickCrops(decor, k, skip); sec -= k; } return n; };
const FRUIT_IDS = ['watermelon', 'watermelonslice', 'pineapple', 'melonseed', 'pineseed'];

test('items: Medium Crop Plot recipe and placement; fruit food, seeds, icons, book text and Food tab', () => {
  assert.deepEqual({ ...ITEMS.cropplot2.recipe.cost }, { wood: 8, scrap: 4 });
  assert.ok(ITEMS.cropplot2.placeable && PLACEABLE_IDS.includes('cropplot2') && BLOCK_RADII.cropplot2 > 0);
  for (const k of ['cropplot2', ...FRUIT_IDS]) {
    assert.ok(ITEMS[k], k); assert.ok(typeof ITEM_ICONS[k] === 'string' && ITEM_ICONS[k].includes('<'), k + ' icon');
    assert.ok(ITEM_TEXT[k]?.desc && ITEM_TEXT[k]?.use, k + ' text');
  }
  for (const k of FRUIT_IDS) assert.ok(ITEM_SOURCE[k]?.how, k + ' source');
  assert.equal(categoryOf('cropplot2'), 'food');
  assert.deepEqual([V.FOOD.watermelon, V.FOOD.watermelonslice, V.FOOD.pineapple].map(e => [e.food, e.water]), [[10, 15], [10, 15], [10, 10]]);
  for (const k of ['watermelon', 'watermelonslice', 'pineapple']) { assert.ok(V.isEdible(k)); assert.equal(V.isDrink(k), false, k + ' is eaten'); assert.match(V.eatLabel(k), /^Eat/); }
  assert.ok(!V.isEdible('melonseed') && !V.isEdible('pineseed'));
  assert.equal(V.isDrink('freshcup'), true); assert.equal(V.isDrink('berrycup'), true); assert.equal(V.isDrink('milk'), true); // drinks unchanged
});

test('watermelon is eaten in two bites: the first leaves a slice, the second leaves nothing', () => {
  const v = V.newVitals({ hp: 100, food: 40, water: 40 });
  const e1 = V.consume(v, 'watermelon');
  assert.equal(e1.returns, 'watermelonslice'); assert.deepEqual([v.food, v.water], [50, 55]);
  const e2 = V.consume(v, 'watermelonslice');
  assert.equal(e2.returns, undefined); assert.deepEqual([v.food, v.water], [60, 70]);
  V.consume(v, 'pineapple'); assert.deepEqual([v.food, v.water], [70, 80]);
});

test('plot table: small = 3 slots beet/potato, medium = 2 slots fruit (+ small crops); cleanCrop per type', () => {
  assert.equal(PLOTS.cropplot.slots, 3); assert.deepEqual([...PLOTS.cropplot.crops], ['beet', 'potato']);
  assert.equal(PLOTS.cropplot2.slots, 2); assert.deepEqual([...PLOTS.cropplot2.crops], ['watermelon', 'pineapple', 'beet', 'potato']);
  assert.deepEqual([CROPS.watermelon.grow, CROPS.pineapple.grow], [480, 360]);
  assert.deepEqual({ ...SEED_OF }, { beet: 'beet', potato: 'potato', melonseed: 'watermelon', pineseed: 'pineapple' });
  assert.ok(isPlot({ type: 'cropplot' }) && isPlot({ type: 'cropplot2' }) && !isPlot({ type: 'palm' }));
  assert.deepEqual(cleanCrop(null, 'cropplot2'), [{ c: '', g: 0, w: 0 }, { c: '', g: 0, w: 0 }]);
  assert.deepEqual(cleanCrop([{ c: 'watermelon', g: 9999, w: 5 }, { c: 'pineapple', g: 3, w: 9999 }, { c: 'beet' }], 'cropplot2'),
    [{ c: 'watermelon', g: 480, w: 0 }, { c: 'pineapple', g: 3, w: PLOTS.cropplot2.water }]);
  assert.deepEqual(cleanCrop([{ c: 'watermelon', g: 4, w: 4 }], 'cropplot')[0], { c: '', g: 0, w: 0 }, 'fruit never loads into a small plot');
  const decor = normalizeDecor([{ type: 'cropplot2', x: 0, z: 0 }, { type: 'cropplot', x: 1, z: 0 }]);
  assert.deepEqual(decor.map(d => d.crop.length), [2, 3]);
});

test('medium plot loop: plant from seeds, grows only while watered (2 cups for a melon), harvest 1 fruit', () => {
  const decor = [med()], bag = bagWith([{ kind: 'melonseed', count: 1 }, { kind: 'pineseed', count: 1 }, { kind: 'freshcup', count: 5 }]);
  assert.equal(act(decor, bag, 'plant', 2, { crop: 'watermelon' }).reason, 'notarget', 'only 2 slots');
  assert.ok(act(decor, bag, 'plant', 0, { crop: 'melonseed' }).ok, 'the held seed item names the crop');
  assert.ok(act(decor, bag, 'plant', 1, { crop: 'pineapple' }).ok);
  assert.equal(bag.count('melonseed') + bag.count('pineseed'), 0);
  assert.deepEqual(decor[0].crop.map(s => s.c), ['watermelon', 'pineapple']);
  grow(decor, 120); assert.equal(decor[0].crop[0].g, 0, 'dry soil: no growth');
  assert.ok(act(decor, bag, 'water', 0).ok); assert.ok(act(decor, bag, 'water', 1).ok);
  assert.equal(decor[0].crop[0].w, 240, 'the deeper soil stays wet longer');
  grow(decor, 240);
  assert.equal(decor[0].crop[0].g, 240); assert.equal(act(decor, bag, 'harvest', 0).reason, 'notripe');
  assert.ok(act(decor, bag, 'water', 0).ok); assert.ok(act(decor, bag, 'water', 1).ok);
  assert.equal(grow(decor, 240), 2, 'both ripe after two cups each');
  assert.deepEqual(decor[0].crop.map(C.stageOf), [RIPE, RIPE]);
  const h = act(decor, bag, 'harvest', 0, {}, () => 0.1); assert.ok(h.ok); assert.deepEqual(h.loot, { watermelon: 1, melonseed: 1 });
  assert.match(h.text, /1 watermelon · \+ 1 watermelon seed/);
  const p = act(decor, bag, 'harvest', 1, {}, () => 0.9); assert.deepEqual(p.loot, { pineapple: 1 }, 'no seed this time');
  assert.deepEqual([bag.count('watermelon'), bag.count('melonseed'), bag.count('pineapple'), bag.count('pineseed')], [1, 1, 1, 0]);
  assert.deepEqual(decor[0].crop, cleanCrop(null, 'cropplot2'));
});

test('seed return odds: 2 in 3 for fruit, never for beets and potatoes', () => {
  assert.ok(Math.abs(SEED_BACK - 0.667) < 0.001);
  let r = 7; const rand = () => (r = (r * 16807) % 2147483647) / 2147483647;
  let seeds = 0; const N = 6000;
  for (let i = 0; i < N; i++) seeds += harvestLoot(i % 2 ? 'watermelon' : 'pineapple', rand)[i % 2 ? 'melonseed' : 'pineseed'] ? 1 : 0;
  assert.ok(Math.abs(seeds / N - 2 / 3) < 0.025, `seed rate ${seeds / N}`);
  assert.deepEqual(harvestLoot('beet', () => 0), { beet: 2 }); assert.deepEqual(harvestLoot('potato', () => 0), { potato: 2 });
  assert.deepEqual(harvestLoot('nope'), {});
});

test('plot rules: fruit refused by the small plot, beets fit the medium one; a full bag keeps the fruit', () => {
  const small = [{ type: 'cropplot', x: 0, z: 0, crop: cleanCrop(null) }], bag = bagWith([{ kind: 'melonseed', count: 1 }, { kind: 'beet', count: 1 }]);
  const r = act(small, bag, 'plant', 0, { crop: 'melonseed' }); assert.equal(r.reason, 'toosmall'); assert.equal(bag.count('melonseed'), 1);
  const decor = [med()];
  assert.ok(act(decor, bag, 'plant', 1, { crop: 'beet' }).ok);
  assert.equal(act(decor, bagWith([]), 'plant', 0).reason, 'noseed');
  assert.match(act(decor, bagWith([{ kind: 'beet', count: 1 }]), 'plant', 0, { crop: 'pineseed' }).text, /pineapple seed/);
  const ripe = [med(0, 0, [{ c: 'watermelon', g: 480 }])];
  const full = bagWith(Array.from({ length: SLOT_COUNT }, () => ({ kind: 'scrap', count: 20 })));
  assert.equal(act(ripe, full, 'harvest', 0, {}, () => 0).reason, 'full'); assert.equal(ripe[0].crop[0].c, 'watermelon');
  // prompts
  assert.deepEqual(slotPrompt(C.cleanSlot(null), 'melonseed', 'cropplot2'), ['Click', 'Plant watermelon']);
  assert.deepEqual(slotPrompt(C.cleanSlot(null), 'melonseed', 'cropplot'), [null, C.TEXT.toosmall]);
  assert.match(slotPrompt(C.cleanSlot(null), null, 'cropplot2')[1], /watermelon or pineapple/);
  assert.deepEqual(slotPrompt(C.cleanSlot({ c: 'pineapple', g: 30, w: 0 }, 'cropplot2'), 'freshcup', 'cropplot2')[0], 'Click');
  assert.equal(slotPrompt(C.cleanSlot({ c: 'pineapple', g: 30, w: 200 }, 'cropplot2'), 'freshcup', 'cropplot2')[0], null, 'still wet past half of 240 s');
});

test('slotAt: two slots at +-SLOT_X2/2 that follow the plot rotation', () => {
  const d = { type: 'cropplot2', x: 1, z: 0 }, h = M.SLOT_X2 / 2;
  assert.deepEqual([slotAt(d, 2 - h, 0), slotAt(d, 2 + h, .2), slotAt(d, 2 - 2, 0), slotAt(d, 4, 0)], [0, 1, 0, 1]);
  const r = { ...d, rot: Math.PI / 2 };
  assert.deepEqual([slotAt(r, 2, h), slotAt(r, 2, -h)], [0, 1]);
  assert.deepEqual([C.slotX('cropplot2', 0), C.slotX('cropplot2', 1), C.slotX('cropplot', 0)], [-h, h, -M.SLOT_X]);
});

test('gulls peck growing crop plots: canPeck, scarecrow cover, rim perch, growth pauses', () => {
  const wet = med(0, 0, [{ c: 'watermelon', g: 30, w: 100 }]), dry = med(2, 0, [{ c: 'pineapple', g: 30, w: 0 }]);
  assert.ok(plotGrowing(wet) && !plotGrowing(dry) && !plotGrowing(med(0, 0, [{ c: 'watermelon', g: 480 }])));
  const small = { type: 'cropplot', x: 3, z: 0, crop: cleanCrop([{ c: 'beet', g: 5, w: 9 }]) };
  const decor = [wet, dry, small];
  assert.equal(S.canPeck({}, '0,0', decor), true); assert.equal(S.canPeck({}, '3,0', decor), true, 'small plots too');
  assert.equal(S.canPeck({}, '2,0', decor), false, 'dry soil');
  assert.equal(S.canPeck({}, '0,0', [wet]), false, 'never the only planter');
  assert.equal(S.canPeck({}, '0,0', [wet, { type: 'palm', x: 5, z: 5 }]), true, 'a palm counts as the other planter');
  // scarecrow cover (4.5 m) and rim perches
  const guarded = S.protectedPalms([...decor, { type: 'scarecrow', x: 0, z: 1 }]);
  assert.ok(guarded.has('0,0') && guarded.has('2,0') && !guarded.has('3,0'));
  const tiles = [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1]];
  const per = W.perchesFrom(tiles, decor), rim = per.filter(p => p.kind === 'palm');
  assert.deepEqual(rim.map(p => p.key).sort(), ['0,0', '2,0', '3,0']);
  for (const p of rim) { const [tx, tz] = p.key.split(',').map(Number); assert.ok(Math.hypot(p.x - tx * 2, p.z - tz * 2) < .9, 'on the plot rim'); assert.ok(Math.abs(p.y - (0.22 + S.PLOT_RIM)) < 1e-9); }
  const covered = W.perchesFrom(tiles, [...decor, { type: 'scarecrow', x: 0, z: 1 }]).filter(p => p.kind === 'palm').map(p => p.key);
  assert.deepEqual(covered, ['3,0'], 'a scarecrow keeps gulls off nearby plots');
  const rot = S.plotRimSpot({ type: 'cropplot2', x: 0, z: 0, rot: Math.PI / 2 }), flat = S.plotRimSpot({ type: 'cropplot2', x: 0, z: 0 });
  assert.ok(Math.abs(Math.hypot(rot.dx, rot.dz) - Math.hypot(flat.dx, flat.dz)) < 1e-9 && Math.abs(rot.dx - flat.dx) > .1, 'rim spot turns with the plot');
  // a pecked plot pauses (water kept); the others grow
  const st = { cur: null, cool: {} }, keys = S.pickPecks(st, [{ i: 0, key: '0,0' }], {}, decor, 0);
  assert.deepEqual([...keys], ['0,0']);
  grow(decor, 10, keys);
  assert.deepEqual([wet.crop[0].g, wet.crop[0].w], [30, 100], 'pecked: paused');
  assert.equal(small.crop[0].g, 14, 'unpecked plot grows');
});

test('island fruit patch: seeded node kind, watermelon then pineapple by hand, sometimes a seed', () => {
  assert.ok(L.NODE_KINDS.includes('fruit') && L.NODE_KINDS.at(-1) === 'fruit', 'appended so older nodes keep their spots');
  assert.equal(L.NODE_MAX.fruit, 2);
  let withFruit = 0;
  for (let s = 1; s <= 300; s++) {
    const lay = L.layoutFor(s * 7919), n = lay.nodes.filter(k => k.kind === 'fruit').length;
    assert.ok(n <= 2 && lay.nodes.length <= L.ISLAND.MAX_NODES, `seed ${s}: ${n} fruit, ${lay.nodes.length} nodes`);
    if (n) withFruit++;
    for (const k of lay.nodes) if (k.kind === 'fruit') assert.ok(Number.isFinite(k.y) && k.y > 0, 'on dry sand');
  }
  assert.ok(withFruit > 280, `almost every island has a fruit patch (${withFruit}/300)`);
  assert.deepEqual(L.layoutFor(424242), L.layoutFor(424242));
  // loot: deterministic, fruit order, seed about half the time, nothing past max
  assert.deepEqual(L.lootFor('fruit', 9, 3, 0), L.lootFor('fruit', 9, 3, 0));
  let seeds = 0;
  for (let s = 0; s < 400; s++) {
    const a = L.lootFor('fruit', s, 1, 0), b = L.lootFor('fruit', s, 1, 1);
    assert.equal(a[0][0], 'watermelon'); assert.equal(b[0][0], 'pineapple');
    if (a[1]) { assert.deepEqual(a[1], ['melonseed', 1]); seeds++; }
    if (b[1]) { assert.deepEqual(b[1], ['pineseed', 1]); seeds++; }
  }
  assert.ok(seeds > 320 && seeds < 480, `seed rate ${seeds}/800`);
  assert.deepEqual(L.lootFor('fruit', 1, 1, 2), []);
  // host gather by hand (no axe), into the bag, drained after two picks
  const seed = [...Array(200).keys()].map(i => i * 31 + 5).find(s => L.layoutFor(s).nodes.some(n => n.kind === 'fruit'));
  const lay = L.layoutFor(seed), k = lay.nodes.findIndex(n => n.kind === 'fruit'), n = lay.nodes[k];
  const st = { isl: { seed, used: lay.nodes.map(() => 0) }, layout: lay, cx: 0, cz: 0, clock: 10, cool: {} };
  const bag = bagWith([]), pos = { x: n.x + .5, z: n.z };
  const r1 = L.applyGather(st, { kind: 'islands.gather', seed, node: k }, 'host', pos, bag);
  assert.ok(r1.ok, r1.reason); assert.equal(bag.count('watermelon'), 1);
  st.clock += 1;
  assert.ok(L.applyGather(st, { kind: 'islands.gather', seed, node: k }, 'host', pos, bag).ok); assert.equal(bag.count('pineapple'), 1);
  st.clock += 1;
  assert.equal(L.applyGather(st, { kind: 'islands.gather', seed, node: k }, 'host', pos, bag).reason, 'drained');
  assert.equal(L.clean({ v: 2, clock: 0, next: 0, isl: { seed, born: 0, bx: 0, bz: 0, used: [0, 0] } }).isl.used.length, lay.nodes.length, 'old saves (shorter used) load');
});

test('models: medium plot is one merged no-shadow mesh; content module places it and shows ripe fruit', () => {
  const g = M.createMediumPlot(T);
  let meshes = 0, casters = 0; g.traverse(o => { if (o.isMesh) { meshes++; if (o.castShadow) casters++; } });
  assert.equal(meshes, 1); assert.equal(casters, 0); assert.equal(g.name, 'craft_cropplot2');
  const box = new T.Box3().setFromObject(g); assert.ok(box.max.x - box.min.x < 2 && box.max.z - box.min.z > 1, 'fits a tile, deeper than the small plot');
  const kit = M.cropKit(T);
  for (const k of ['watermelon1', 'watermelon2', 'pineapple1', 'pineapple2']) { assert.ok(kit.geos[k].userData.shared); assert.ok(kit.geos[k].attributes.position.count > 0); }
  assert.ok(kit.wetGeo2.userData.shared);
  // content module: host places a medium plot, ripens fruit, paint shows the ripe meshes; E harvests (with a peer scarecrow)
  const raft = new T.Group(), emits = [], actions = [];
  const world = { tiles: [[0, 0], [1, 0]], decor: [] };
  const bag = bagWith([]), cam = new T.PerspectiveCamera(); cam.position.set(0, 1.7, 1.4); cam.lookAt(-.43, .49, 0); cam.updateMatrixWorld();
  let pecked = new Set();
  const crow = { name: 'scarecrow', get pecked() { return pecked; }, isPecked: k => pecked.has(k), shoo: (x, z) => { actions.push({ kind: 'shoo', x, z }); return true; } };
  const ctx = { T, raft, camera: cam, world, role: 'host', running: true, physics: { x: 0, z: 1.4 }, other: { x: 9, z: 9 }, localBag: () => bag,
    action: a => actions.push(a), emit: (e, to) => emits.push([e, to]), notice: s => emits.push([{ kind: 'notice', text: s }, 'me']), esc: s => s, rebuildRaft() {
      for (const c of [...raft.children]) raft.remove(c);
      for (const d of world.decor) { const m = mod.decorModel(d.type); if (m) { m.position.set(d.x * 2, .22, d.z * 2); raft.add(m); } }
    } };
  const mod = createCrops(ctx, name => (name === 'scarecrow' ? crow : null));
  assert.ok(mod.debug.place(0, 0, 0, 'cropplot2'));
  assert.equal(world.decor[0].crop.length, 2);
  assert.ok(mod.debug.setSlot(0, 0, 0, 'watermelon', 480) && mod.debug.setSlot(0, 0, 1, 'pineapple', 360));
  mod.update(0);
  assert.deepEqual(mod.debug.shown(), [['watermelon2', 'pineapple2']]);
  const aim = { dir: cam.getWorldDirection(new T.Vector3()) };
  assert.deepEqual(mod.debug.target(aim), { x: 0, z: 0, slot: 0 });
  assert.equal(mod.prompt(aim), '<kbd>E</kbd>Harvest watermelon');
  assert.ok(mod.claims('melonseed', aim) && mod.claims('pineseed', aim));
  pecked = new Set(['0,0']); mod.update(0);
  assert.equal(mod.prompt(aim), '<kbd>E</kbd>Shoo the gull');
  assert.ok(mod.interact(aim)); assert.deepEqual(actions.pop(), { kind: 'shoo', x: 0, z: 0 });
  pecked = new Set();
  assert.ok(mod.interact(aim)); assert.deepEqual(actions.pop(), { kind: 'crops.harvest', x: 0, z: 0, slot: 0 });
  assert.ok(mod.action({ kind: 'crops.harvest', x: 0, z: 0, slot: 0 }, 'host', bag));
  assert.equal(bag.count('watermelon'), 1);
  mod.update(0); assert.deepEqual(mod.debug.shown(), [['', 'pineapple2']]);
  mod.dispose();
});
