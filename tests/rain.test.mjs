// Unit tests for dist/rain.js (rain barrel + sprinkler) and dist/rain-model.js. Spec: docs/specs/rain-sprinkler.md.
// Run: node --test tests/rain.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const R = await import(new URL('rain.js', base));
const W = await import(new URL('watering.js', base));
const { Bag, SLOT_COUNT, RECIPES, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const { createRainBarrel, paintRainBarrel, createSprinkler, paintSprinkler } = await import(new URL('rain-model.js', base));

const bagFrom = (slots, selected = 0) => {
  const s = new Array(SLOT_COUNT).fill(null);
  slots.forEach((v, i) => { s[i] = v; });
  return new Bag({ slots: s, selected });
};
const fullBag = (first) => bagFrom([first, ...Array.from({ length: SLOT_COUNT - 1 }, () => ({ kind: 'scrap', count: 20 }))]);
// Barrel at 0,0, sprinkler at 1,0, palms at 2,1 / 2,-1 / 0,1 (diagonal from barrel is irrelevant), bench at 5,5.
const mkWorld = (extra = {}) => ({
  decor: [{ type: 'rainbarrel', x: 0, z: 0 }, { type: 'sprinkler', x: 1, z: 0 }, { type: 'palm', x: 2, z: 1 }, { type: 'palm', x: 2, z: -1 }, { type: 'bench', x: 5, z: 5 }],
  garden: {}, purifiers: {}, collectors: {}, sprinklers: {}, ...extra,
});
const B = '0,0', S = '1,0';
const ticks = (w, n, rain) => { const out = { filled: [], watered: [] }; for (let i = 0; i < n; i++) { const r = R.tickRain(w, 1, rain); out.filled.push(...r.filled); out.watered.push(...r.watered); } return out; };

test('cleanRain: missing / null / array input gives empty maps', () => {
  const decor = mkWorld().decor;
  for (const v of [undefined, null, [], {}, { collectors: null, sprinklers: [] }, { collectors: [1], sprinklers: 'x' }]) {
    assert.deepEqual(R.cleanRain(v, decor), { collectors: {}, sprinklers: {} });
  }
});

test('cleanRain: bad keys, non-int values, clamping, decor checks, all-zero entries', () => {
  const decor = mkWorld().decor;
  const r = R.cleanRain({
    collectors: { '0,0': { w: 2, f: 999 }, 'a,b': { w: 1, f: 0 }, ' 0,0': { w: 1, f: 0 }, '1,0': { w: 1, f: 0 }, '5,5': { w: 1, f: 0 } },
    sprinklers: { '1,0': { w: 9, s: -4 }, '0,0': { w: 1, s: 1 }, '9,9': { w: 1, s: 1 } },
  }, decor);
  assert.deepEqual(r.collectors, { '0,0': { w: 2, f: 299 } });
  assert.deepEqual(r.sprinklers, { '1,0': { w: 3, s: 0 } });
  assert.deepEqual(R.cleanRain({ collectors: { '0,0': { w: 'x', f: 2.5 } }, sprinklers: { '1,0': { w: 1.5, s: null } } }, decor), { collectors: {}, sprinklers: {} });
  assert.deepEqual(R.cleanRain({ collectors: { '0,0': { w: 7, f: 120 } } }, decor).collectors, { '0,0': { w: 4, f: 0 } }, 'cap forces f=0');
  assert.deepEqual(R.cleanRain({ collectors: { '0,0': { w: 0, f: 0 } }, sprinklers: { '1,0': { w: 0, s: 0 } } }, decor), { collectors: {}, sprinklers: {} });
  assert.deepEqual(R.copyRain(undefined), { collectors: {}, sprinklers: {} });
  const src = { collectors: { '0,0': { w: 1, f: 2 } }, sprinklers: {} }, c = R.copyRain(src);
  assert.deepEqual(c, src); assert.notEqual(c.collectors['0,0'], src.collectors['0,0']);
});

test('fill: rain, dew, NaN, cap and dt clamping', () => {
  const w = mkWorld({ decor: [{ type: 'rainbarrel', x: 0, z: 0 }] });
  ticks(w, 29, 1); assert.equal(w.collectors[B].w, 0); assert.equal(w.collectors[B].f, 290);
  ticks(w, 1, 1); assert.deepEqual(w.collectors[B], { w: 1, f: 0 });
  const d = mkWorld({ decor: [{ type: 'rainbarrel', x: 0, z: 0 }] });
  ticks(d, 299, 0); assert.equal(d.collectors[B].w, 0);
  ticks(d, 1, 0); assert.deepEqual(d.collectors[B], { w: 1, f: 0 });
  for (const bad of [NaN, undefined, 'x', Infinity]) {
    const n = mkWorld({ decor: [{ type: 'rainbarrel', x: 0, z: 0 }] });
    R.tickRain(n, 1, bad); assert.deepEqual(n.collectors[B], { w: 0, f: 1 });
  }
  const c = mkWorld({ decor: [{ type: 'rainbarrel', x: 0, z: 0 }] });
  const r = ticks(c, 200, 1);
  assert.deepEqual(c.collectors[B], { w: 4, f: 0 });
  assert.deepEqual(r.filled, [B]);
  const z = mkWorld({ decor: [{ type: 'rainbarrel', x: 0, z: 0 }] });
  R.tickRain(z, .9, 1); assert.deepEqual(z.collectors, {});
  R.tickRain(z, 1e6, 1); assert.deepEqual(z.collectors[B], { w: 2, f: 0 }, '60 s of full rain = 2 cups');
});

test('prune: removing the barrel drops its entry on the next tick', () => {
  const w = mkWorld({ collectors: { [B]: { w: 2, f: 10 } }, sprinklers: { [S]: { w: 1, s: 0 } } });
  w.decor = w.decor.filter(d => d.type !== 'rainbarrel' && d.type !== 'sprinkler');
  R.tickRain(w, 0, 0);
  assert.deepEqual(w.collectors, {}); assert.deepEqual(w.sprinklers, {});
});

test('takeRain: cup -> freshcup in the same slot; refusals change nothing', () => {
  const w = mkWorld({ collectors: { [B]: { w: 2, f: 5 } } });
  const bag = bagFrom([{ kind: 'wood', count: 3 }, { kind: 'cup', count: 1 }], 1);
  const r = R.takeRain(w, B, bag);
  assert.equal(r.ok, true); assert.equal(r.kind, 'loot'); assert.equal(r.text, '+ 1 cup of rain water');
  assert.deepEqual(bag.slots[1], { kind: 'freshcup', count: 1 });
  assert.deepEqual(w.collectors[B], { w: 1, f: 5 });

  const cases = [
    [mkWorld(), bagFrom([{ kind: 'cup', count: 1 }]), 'empty', 'The barrel is empty'],
    [mkWorld({ collectors: { [B]: { w: 1, f: 0 } } }), bagFrom([{ kind: 'wood', count: 1 }]), 'nocup', 'You need a cup'],
    [mkWorld({ collectors: { [B]: { w: 1, f: 0 } } }), bagFrom([{ kind: 'saltcup', count: 1 }]), 'freshonly', 'Use an empty cup'],
    [mkWorld({ collectors: { [B]: { w: 1, f: 0 } } }), fullBag({ kind: 'cup', count: 3 }), 'full', 'Your bag is full'],
  ];
  for (const [world, b, reason, text] of cases) {
    const snap = JSON.stringify(b.snapshot()), ws = JSON.stringify(world);
    const res = R.takeRain(world, B, b);
    assert.equal(res.ok, false); assert.equal(res.reason, reason); assert.equal(res.text, text);
    assert.equal(JSON.stringify(b.snapshot()), snap); assert.equal(JSON.stringify(world), ws);
  }
  const wrong = mkWorld({ collectors: { [B]: { w: 1, f: 0 } } });
  assert.equal(R.takeRain(wrong, S, bagFrom([{ kind: 'cup', count: 1 }])).reason, 'notarget');
});

test('fillSprinkler: freshcup -> cup; refuses full tank and sea water', () => {
  const w = mkWorld();
  const bag = bagFrom([{ kind: 'freshcup', count: 1 }]);
  const r = R.fillSprinkler(w, S, bag);
  assert.equal(r.ok, true); assert.equal(r.text, 'The sprinkler tank gurgles');
  assert.deepEqual(bag.slots[0], { kind: 'cup', count: 1 });
  assert.deepEqual(w.sprinklers[S], { w: 1, s: 0 });
  const full = mkWorld({ sprinklers: { [S]: { w: 3, s: 0 } } }), fb = bagFrom([{ kind: 'freshcup', count: 1 }]), snap = JSON.stringify(fb.snapshot());
  const t = R.fillSprinkler(full, S, fb);
  assert.equal(t.reason, 'tankfull'); assert.equal(t.text, 'The sprinkler is full'); assert.equal(JSON.stringify(fb.snapshot()), snap);
  const salt = R.fillSprinkler(mkWorld(), S, bagFrom([{ kind: 'saltcup', count: 1 }]));
  assert.equal(salt.reason, 'freshonly'); assert.equal(salt.text, 'Fresh water only');
  assert.equal(R.fillSprinkler(mkWorld(), S, bagFrom([{ kind: 'wood', count: 1 }])).reason, 'nocup');
  assert.equal(R.fillSprinkler(mkWorld(), B, bagFrom([{ kind: 'freshcup', count: 1 }])).reason, 'notarget');
});

test('sprinkle: own tank first, one palm per tick in sorted order, spray countdown', () => {
  const w = mkWorld({ sprinklers: { [S]: { w: 2, s: 0 } }, collectors: { [B]: { w: 4, f: 0 } } });
  assert.deepEqual(R.sprinkle(w), ['2,-1']);
  assert.deepEqual(w.garden['2,-1'], { water: 1, grow: 0 });
  assert.deepEqual(w.sprinklers[S], { w: 1, s: 3 });
  assert.equal(w.collectors[B].w, 4, 'own tank used before the barrel');
  assert.deepEqual(R.sprinkle(w), ['2,1']);
  assert.deepEqual(w.sprinklers[S], { w: 0, s: 3 });
  assert.deepEqual(R.sprinkle(w), [], 'both palms wet');
  // spray counts down, all-zero entry is deleted
  const c = mkWorld({ sprinklers: { [S]: { w: 0, s: 3 } } });
  R.tickRain(c, 1, 0); assert.equal(c.sprinklers[S].s, 2);
  R.tickRain(c, 2, 0); assert.equal(c.sprinklers[S], undefined);
});

test('sprinkle: draws from an orthogonal barrel only; skips ripe, wet and far palms', () => {
  const w = mkWorld({ collectors: { [B]: { w: 1, f: 0 } } });
  assert.deepEqual(R.sprinkle(w), ['2,-1']);
  assert.deepEqual(w.collectors, {}, 'barrel emptied (all-zero entry removed)');
  assert.equal(w.sprinklers[S].s, 3);
  // diagonal barrel does not feed
  const diag = { decor: [{ type: 'rainbarrel', x: 0, z: 1 }, { type: 'sprinkler', x: 1, z: 0 }, { type: 'palm', x: 2, z: 0 }], garden: {}, collectors: { '0,1': { w: 2, f: 0 } }, sprinklers: {} };
  assert.deepEqual(R.sprinkle(diag), []); assert.deepEqual(diag.garden, {});
  // ripe + wet palms untouched, 2 tiles away ignored
  const g = { '2,1': { water: 0, grow: 90 }, '2,-1': { water: 1, grow: 10 } };
  const s = { decor: [...mkWorld().decor, { type: 'palm', x: 3, z: 0 }], garden: JSON.parse(JSON.stringify(g)), collectors: {}, sprinklers: { [S]: { w: 3, s: 0 } } };
  assert.deepEqual(R.sprinkle(s), []);
  assert.deepEqual(s.garden, g); assert.deepEqual(s.sprinklers[S], { w: 3, s: 0 });
  // no source: nothing changes
  const none = mkWorld(), before = JSON.stringify(none);
  assert.deepEqual(R.sprinkle(none), []); assert.equal(JSON.stringify(none), before);
});

test('order: a palm that ripens in tickWatering is not re-watered by tickRain', () => {
  const w = mkWorld({ garden: { '2,-1': { water: 1, grow: 89 }, '2,1': { water: 1, grow: 5 } }, sprinklers: { [S]: { w: 3, s: 0 } } });
  W.tick(w, 1);
  const r = R.tickRain(w, 1, 0);
  assert.deepEqual(r.watered, []);
  assert.deepEqual(w.garden['2,-1'], { water: 0, grow: 90 });
  assert.equal(w.sprinklers[S].w, 3);
});

test('determinism: identical worlds and inputs end deepEqual', () => {
  const mk = () => mkWorld({ garden: { '2,1': { water: 0, grow: 30 } }, sprinklers: { [S]: { w: 1, s: 0 } } });
  const a = mk(), b = mk(), seq = [0, .3, 1, 1, NaN, .7, 0, 1, .5, .2];
  for (let i = 0; i < 400; i++) {
    const rain = seq[i % seq.length];
    W.tick(a, 1); R.tickRain(a, 1, rain); W.tick(b, 1); R.tickRain(b, 1, rain);
  }
  assert.deepEqual(a, b);
  assert.ok(Object.keys(a.garden).length >= 1);
});

test('rainTarget: exact prompts and action kinds', () => {
  const at = { x: 0, z: 0 }, st = { x: 1, z: 0 };
  const bd = { key: B, type: 'rainbarrel', x: 0, z: 0 }, sd = { key: S, type: 'sprinkler', x: 1, z: 0 };
  const w2 = mkWorld({ collectors: { [B]: { w: 2, f: 0 } } });
  assert.deepEqual(R.rainTarget(w2, bd, 'cup', false), { prompt: '<kbd>E</kbd>Fill cup (2/4)', click: { kind: 'takeRain', ...at }, e: { kind: 'takeRain', ...at }, why: null });
  const noop = t => ({ prompt: t, click: null, e: null, why: t });
  assert.deepEqual(R.rainTarget(w2, bd, 'saltcup', false), noop('Rain barrel: 2/4 · needs an empty cup'));
  assert.deepEqual(R.rainTarget(w2, bd, 'freshcup', false), noop('Rain barrel: 2/4 · needs an empty cup'));
  assert.deepEqual(R.rainTarget(w2, bd, 'wood', false), noop('Rain barrel: 2/4 cups · hold a cup'));
  assert.deepEqual(R.rainTarget(mkWorld(), bd, 'cup', true), noop('Rain barrel: filling in the rain…'));
  assert.deepEqual(R.rainTarget(mkWorld(), bd, 'cup', false), noop('Rain barrel: empty · fills when it rains'));
  assert.deepEqual(R.rainTarget(mkWorld({ sprinklers: { [S]: { w: 1, s: 0 } } }), sd, 'freshcup', false),
    { prompt: '<kbd>E</kbd>Fill sprinkler (1/3)', click: { kind: 'fillSprinkler', ...st }, e: { kind: 'fillSprinkler', ...st }, why: null });
  assert.deepEqual(R.rainTarget(mkWorld({ sprinklers: { [S]: { w: 3, s: 0 } } }), sd, 'freshcup', false), noop('Sprinkler: full (3/3)'));
  assert.deepEqual(R.rainTarget(w2, sd, 'wood', false), noop('Sprinkler: 0/3 · drawing from the rain barrel'));
  assert.deepEqual(R.rainTarget(mkWorld(), sd, 'cup', false), noop('Sprinkler: 0/3 · add fresh water'));
});

test('items and recipes: craftable, bag-safe, research-gated', async () => {
  for (const k of ['rainbarrel', 'sprinkler']) { assert.ok(ITEM_INFO[k]); assert.equal(ITEM_INFO[k].tool, false); assert.ok(RECIPES[k]); }
  assert.deepEqual({ ...RECIPES.rainbarrel.cost }, { wood: 3, leaf: 2, plastic: 1 });
  assert.deepEqual({ ...RECIPES.sprinkler.cost }, { scrap: 2, plastic: 2, rope: 1 });
  const bag = bagFrom([{ kind: 'wood', count: 3 }, { kind: 'leaf', count: 2 }, { kind: 'plastic', count: 3 }, { kind: 'scrap', count: 2 }, { kind: 'rope', count: 1 }]);
  assert.ok(bag.craft('rainbarrel')); assert.ok(bag.craft('sprinkler'));
  assert.equal(bag.count('rainbarrel'), 1); assert.equal(bag.count('sprinkler'), 1);
  const again = new Bag(bag.snapshot());
  assert.equal(again.count('rainbarrel'), 1); assert.equal(again.count('sprinkler'), 1);
  const SR = await import(new URL('storage-research.js', base));
  const learned = SR.learnedFrom(['wood', 'leaf', 'plastic']);
  assert.ok(learned.includes('rainbarrel')); assert.ok(!learned.includes('sprinkler'));
});

test('content registry rain(): 0 without daynight and for the opt-out module', async () => {
  const { createContent } = await import(new URL('content.js', base));
  const { createDayNightOff } = await import(new URL('daynight.js', base));
  assert.equal(createContent({}, []).rain(), 0);
  assert.equal(createContent({}, [() => createDayNightOff({})]).rain(), 0);
  assert.equal(createContent({}, [() => ({ name: 'daynight', rain: .8 })]).rain(), .8);
  assert.equal(createContent({}, [() => ({ name: 'daynight', rain: NaN })]).rain(), 0);
});

const boxOf = (g, skip = 'spray') => {
  g.updateMatrixWorld(true);
  const b = new T.Box3();
  g.traverse(o => { if (o.isMesh && o.name !== skip) b.expandByObject(o); });
  return b;
};

test('rain-model: named parts, footprints and painting', () => {
  const g = createRainBarrel(T);
  assert.equal(g.name, 'craft_rainbarrel'); assert.equal(g.userData.craftType, 'rainbarrel'); assert.ok(g.userData.height > 0);
  for (const n of ['barrelBody', 'barrelFloor', 'barrelHoops', 'barrelFunnel', 'barrelWater', 'barrelPips', 'barrelRipple']) assert.ok(g.getObjectByName(n), n);
  let s = boxOf(g).getSize(new T.Vector3());
  assert.ok(s.x <= .7 && s.z <= .7 && s.y <= .85, JSON.stringify(s));
  paintRainBarrel(g, { w: 2, f: 0 }, false, 0);
  const pips = g.getObjectByName('barrelPips').children;
  assert.equal(pips.length, 4);
  assert.equal(pips.filter(m => m.material.color.getHex() === 0x9ad7f0).length, 2);
  const water = g.getObjectByName('barrelWater');
  assert.equal(water.visible, true); assert.ok(Math.abs(water.position.y - (.06 + .44 * .5)) < 1e-9);
  assert.equal(g.getObjectByName('barrelRipple').visible, false);
  paintRainBarrel(g, null, true, 1.3);
  assert.equal(water.visible, false); assert.equal(g.getObjectByName('barrelRipple').visible, true);

  const sp = createSprinkler(T);
  assert.equal(sp.name, 'craft_sprinkler'); assert.equal(sp.userData.craftType, 'sprinkler');
  for (const n of ['sprinklerTank', 'sprinklerPips', 'sprinklerPipe', 'sprinklerHead', 'spray']) assert.ok(sp.getObjectByName(n), n);
  s = boxOf(sp).getSize(new T.Vector3());
  assert.ok(s.x <= .4 && s.z <= .4 && s.y <= .65, JSON.stringify(s));
  const spray = sp.getObjectByName('spray');
  assert.ok(spray.isPoints); assert.equal(spray.geometry.attributes.position.count, 24); assert.equal(spray.frustumCulled, false);
  paintSprinkler(sp, { w: 1, s: 0 }, 2, true); assert.equal(spray.visible, false);
  paintSprinkler(sp, { w: 1, s: 2 }, 2, false); assert.equal(spray.visible, false);
  const arr = spray.geometry.attributes.position.array;
  paintSprinkler(sp, { w: 1, s: 2 }, 2, true); assert.equal(spray.visible, true);
  const first = Array.from(arr);
  paintSprinkler(sp, { w: 1, s: 2 }, 2, true);
  assert.equal(spray.geometry.attributes.position.array, arr);
  assert.deepEqual(Array.from(arr), first);
  assert.ok(Math.abs(sp.getObjectByName('sprinklerHead').rotation.y - 12) < 1e-9);
  assert.equal(sp.getObjectByName('sprinklerPips').children.filter(m => m.material.color.getHex() === 0x9ad7f0).length, 1);
});
