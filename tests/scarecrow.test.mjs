// Unit tests for dist/scarecrow.js (peckish gulls, scarecrow) and dist/scarecrow-model.js.
// Run: node --test tests/scarecrow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const S = await import(new URL('scarecrow.js', base));
const M = await import(new URL('scarecrow-model.js', base));
const W = await import(new URL('wildlife.js', base));
const { tick } = await import(new URL('watering.js', base));
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { ITEMS, BLOCK_RADII } = await import(new URL('items.js', base));
const { protectedPalms, rimSpot, canPeck, pickPecks, cleanNet, createScarecrow, SCARECROW_RADIUS, RIM_OFFSET, PECK_MAX, COOLDOWN, HAT_TOP } = S;
const { perchesFrom, createWildlife, GULL_SLOT } = W;

const palm = (x, z) => ({ type: 'palm', x, z });
const crow = (x, z) => ({ type: 'scarecrow', x, z });
const growing = (grow = 30) => ({ water: 1, grow });
const TWO = [palm(0, 0), palm(1, 0)];

test('protectedPalms: within 4.5 m of a scarecrow; other decor ignored', () => {
  const decor = [crow(0, 0), palm(2, 0), palm(2, 1), palm(3, 0), palm(-3, 0), { type: 'crate', x: 1, z: 0 }, { type: 'sail', x: 0, z: 1 }];
  const p = protectedPalms(decor);
  assert.ok(p.has('2,0'), '4 m'); assert.ok(p.has('2,1'), '4.47 m');
  assert.ok(!p.has('3,0') && !p.has('-3,0'), '6 m');
  assert.equal(p.size, 2);
  assert.equal(protectedPalms([palm(0, 0), palm(1, 0)]).size, 0);
  assert.equal(protectedPalms(undefined).size, 0);
  assert.equal(SCARECROW_RADIUS, 4.5);
});

test('rimSpot: deterministic, always RIM_OFFSET from the centre', () => {
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) {
    const a = rimSpot(x, z), b = rimSpot(x, z);
    assert.deepEqual(a, b);
    assert.ok(Math.abs(Math.hypot(a.dx, a.dz) - RIM_OFFSET) < 1e-12, `${x},${z}`);
  }
});

test('canPeck: only watered, still-growing planters, never the only planter', () => {
  assert.equal(canPeck({ '0,0': growing() }, '0,0', TWO), true);
  assert.equal(canPeck({ '0,0': { water: 0, grow: 30 } }, '0,0', TWO), false, 'dry');
  assert.equal(canPeck({ '0,0': { water: 0, grow: 0 } }, '0,0', TWO), false, 'empty');
  assert.equal(canPeck({ '0,0': { water: 1, grow: 90 } }, '0,0', TWO), false, 'ripe');
  assert.equal(canPeck({}, '0,0', TWO), false, 'missing');
  assert.equal(canPeck({ '0,0': growing() }, '0,0', [palm(0, 0)]), false, 'only one palm');
  assert.equal(canPeck(null, '0,0', TWO), false);
});

test('pickPecks: one at a time, PECK_MAX, cooldown, gull leaving, garden untouched', () => {
  const garden = { '0,0': growing(), '1,0': growing(40) }, copy = JSON.stringify(garden);
  const st = { cur: null, cool: {} };
  const both = [{ i: 0, key: '0,0' }, { i: 1, key: '1,0' }];
  let p = pickPecks(st, both, garden, TWO, 0);
  assert.equal(p.size, 1); assert.ok(p.has('0,0'));
  for (let t = 1; t < PECK_MAX; t++) assert.deepEqual([...pickPecks(st, both, garden, TWO, t)], ['0,0']);
  p = pickPecks(st, both, garden, TWO, PECK_MAX); // ends; the other gull takes over at once
  assert.equal(st.cool['0,0'], PECK_MAX + COOLDOWN);
  assert.deepEqual([...p], ['1,0']);
  // the same key is refused until its cooldown passes
  const solo = [{ i: 0, key: '0,0' }];
  const st2 = { cur: null, cool: { '0,0': 100 } };
  assert.equal(pickPecks(st2, solo, garden, TWO, 99).size, 0);
  assert.deepEqual([...pickPecks(st2, solo, garden, TWO, 100)], ['0,0']);
  assert.equal(st2.cool['0,0'], undefined, 'passed cooldowns are dropped');
  // a gull that left ends the peck
  const st3 = { cur: null, cool: {} };
  pickPecks(st3, solo, garden, TWO, 5);
  assert.equal(pickPecks(st3, [], garden, TWO, 6).size, 0);
  assert.equal(st3.cur, null); assert.equal(st3.cool['0,0'], 6 + COOLDOWN);
  // a different gull on the same planter does not continue the old peck
  const st4 = { cur: null, cool: {} };
  pickPecks(st4, solo, garden, TWO, 0);
  assert.equal(pickPecks(st4, [{ i: 2, key: '0,0' }], garden, TWO, 1).size, 0);
  assert.equal(JSON.stringify(garden), copy, 'garden never mutated');
});

test('pause: a skipped planter keeps its grow, others grow, nothing goes back', () => {
  const world = { decor: [palm(0, 0), palm(1, 0)], garden: { '0,0': growing(), '1,0': growing() }, purifiers: {} };
  for (let k = 0; k < 30; k++) tick(world, 1, new Set(['0,0']));
  assert.equal(world.garden['0,0'].grow, 30); assert.equal(world.garden['1,0'].grow, 60);
  const a = { decor: [palm(0, 0)], garden: { '0,0': growing(10) }, purifiers: {} }, b = JSON.parse(JSON.stringify(a));
  for (let k = 0; k < 100; k++) { tick(a, 1); tick(b, 1, null); }
  assert.deepEqual(a, b);
  assert.equal(a.garden['0,0'].grow, 90);
  // 600 pseudo-random pick/tick steps: grow never decreases
  const w = { decor: [palm(0, 0), palm(1, 0), palm(0, 1)], garden: { '0,0': growing(0), '1,0': growing(20), '0,1': growing(50) }, purifiers: {} };
  const st = { cur: null, cool: {} }, keys = ['0,0', '1,0', '0,1'];
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const prev = {};
  for (let s = 0; s < 600; s++) {
    const on = []; for (let i = 0; i < 3; i++) if (rnd() < 0.4) on.push({ i, key: keys[Math.floor(rnd() * 3)] });
    const skip = pickPecks(st, on, w.garden, w.decor, s);
    assert.ok(skip.size <= 1);
    tick(w, 1, skip);
    for (const k of keys) { const g = w.garden[k]?.grow ?? 0; assert.ok(g >= (prev[k] ?? 0), `${k} went back`); prev[k] = g; if (g >= 90 && rnd() < 0.2) w.garden[k] = growing(0), prev[k] = 0; }
  }
});

test('cleanNet: junk is null, one valid key kept', () => {
  for (const v of [undefined, null, 3, 'x', [], {}, { p: 'x' }, { p: {} }]) assert.equal(cleanNet(v), null);
  assert.deepEqual(cleanNet({ v: 1, p: [] }), { v: 1, p: [] });
  assert.deepEqual(cleanNet({ v: 1, p: ['1,2', '3,4'] }), { v: 1, p: ['1,2'] });
  assert.deepEqual(cleanNet({ v: 1, p: ['01,2', 'a,b', 5, null, '-1,0'] }), { v: 1, p: ['-1,0'] });
});

// ---------------------------------------------------------------- module with a stub ctx

function stubCtx(over = {}) {
  const camera = new T.PerspectiveCamera(70, 1.5, 0.05, 500); camera.position.set(0, 1.7, 3); camera.lookAt(0, 0.5, 0); camera.updateMatrixWorld(true);
  const actions = [], notices = [];
  const ctx = { T, camera, raft: new T.Group(), role: 'solo', running: true, elapsed: 0, physics: { x: 0, y: 1.7, z: 2.5 }, other: null,
    world: { tiles: [[0, 0], [1, 0], [0, 1]], decor: [palm(0, 0), palm(1, 0)], garden: { '0,0': growing(), '1,0': growing() } },
    notice: s => notices.push(s), actions, notices, ...over };
  ctx.action = a => { actions.push(a); return mod?.action(a, 'host'); };
  let mod = null;
  return { ctx, setMod: m => { mod = m; } };
}
const AIM = { dir: { x: 0, y: -1.2 / Math.hypot(1.2, 3), z: -3 / Math.hypot(1.2, 3) } };
const fakeWild = () => { const w = { name: 'wildlife', list: [], shooed: [], pecking: null, onPalm(out) { out.length = 0; for (const e of w.list) out.push(e); return out; }, shoo(k) { w.shooed.push(k); w.list = w.list.filter(e => e.key !== k); return true; } }; return w; };

test('module: interact only on a pecked planter; action checks; serialize; old host', () => {
  const { ctx, setMod } = stubCtx(), wild = fakeWild();
  const m = createScarecrow(ctx, n => (n === 'wildlife' ? wild : null)); setMod(m);
  assert.equal(m.interact(AIM), false, 'not pecked: harvest and water fall through');
  assert.equal(m.palmPrompt(AIM, '<kbd>E</kbd>Harvest palm'), null);
  wild.list = [{ i: 0, key: '0,0' }];
  m.update(1);
  assert.deepEqual([...m.pecked], ['0,0']);
  assert.equal(wild.pecking, m.pecked);
  assert.equal(m.palmPrompt(AIM, 'Growing… (watered)'), '<kbd>E</kbd>Shoo the gull · Growing… (watered)');
  assert.equal(m.palmPrompt(AIM, '<kbd>Click</kbd>Water the planter'), '<kbd>E</kbd>Shoo the gull · Water the planter');
  assert.equal(m.interact(AIM), true);
  assert.deepEqual(ctx.actions.at(-1), { kind: 'scarecrow.shoo', x: 0, z: 0 });
  assert.ok(ctx.notices.includes('Shoo!'));
  assert.ok(wild.shooed.includes('0,0'));
  assert.equal(m.pecked.size, 0, 'the shoo ends the peck on the host');
  assert.ok(m.debug.state().cool['0,0'] > 1);
  // action: claims scarecrow.*, rejects non-int and far input without changing state
  assert.equal(m.action({ kind: 'bees.harvest', x: 0, z: 0 }, 'host'), false);
  const n = wild.shooed.length;
  assert.equal(m.action({ kind: 'scarecrow.shoo', x: 0.5, z: 0 }, 'host'), true);
  assert.equal(m.action({ kind: 'scarecrow.shoo', x: '0', z: 0 }, 'host'), true);
  assert.equal(m.action({ kind: 'scarecrow.shoo', x: 9, z: 9 }, 'host'), true);
  assert.equal(m.action({ kind: 'scarecrow.shoo', x: 0, z: 0 }, 'guest'), true, 'no friend pose');
  assert.equal(wild.shooed.length, n);
  ctx.other = { x: 0, z: 1 };
  assert.equal(m.action({ kind: 'scarecrow.shoo', x: 0, z: 0 }, 'guest'), true);
  assert.equal(wild.shooed.length, n + 1);
  // serialize: never in a solo save; host sends {v:1,p}
  assert.equal(m.serialize(), undefined);
  ctx.role = 'host'; assert.deepEqual(m.serialize(), { v: 1, p: [] });
  assert.equal(m.serialize(), m.serialize(), 'cached');
  // decorModel
  assert.equal(m.decorModel('scarecrow').name, 'craft_scarecrow');
  assert.equal(m.decorModel('palm'), null);
});

test('module: guest follows ext.scarecrow; old host means no prompt and no actions', () => {
  const { ctx } = stubCtx({ role: 'guest' }), wild = fakeWild();
  const m = createScarecrow(ctx, n => (n === 'wildlife' ? wild : null));
  m.load(undefined, 'net');
  assert.equal(m.palmPrompt(AIM, 'Growing… (watered)'), null);
  assert.equal(m.interact(AIM), false);
  m.update(1); assert.equal(wild.pecking.size, 0);
  assert.equal(ctx.actions.length, 0);
  m.load({ v: 1, p: ['0,0'] }, 'net'); m.update(1);
  assert.ok(wild.pecking.has('0,0'));
  assert.ok(m.palmPrompt(AIM, 'Growing… (watered)').startsWith('<kbd>E</kbd>Shoo the gull'));
  assert.equal(m.interact(AIM), true);
  assert.deepEqual(ctx.actions, [{ kind: 'scarecrow.shoo', x: 0, z: 0 }]);
  assert.equal(m.serialize(), undefined);
  // the guest never runs the peck loop into the garden
  const g = JSON.stringify(ctx.world.garden); wild.list = [{ i: 0, key: '1,0' }]; for (let k = 0; k < 5; k++) m.update(1);
  assert.equal(JSON.stringify(ctx.world.garden), g);
  m.load(undefined, 'save');
  assert.equal(m.debug.state().cur, null);
});

// ---------------------------------------------------------------- wildlife integration

const TILES = []; for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) TILES.push([x, z]);
function wildCtx() {
  const scene = new T.Scene(), raft = new T.Group(); scene.add(raft);
  return { T, scene, raft, ocean: { getHeight: () => 0 }, role: 'solo', elapsed: 0, options: { graphics: 'high' },
    world: { tiles: TILES, decor: [palm(0, 1), palm(-1, -1), { type: 'crate', x: 1, z: 1 }] }, physics: { x: 50, y: 1.8, z: 50 }, other: null, deckY: () => 0.2 };
}

test('wildlife: only gulls 0-2 take a planter rim, on about a quarter of their visits', () => {
  const ctx = wildCtx(), w = createWildlife(ctx), buf = [];
  const visits = new Set(), palmVisits = new Set();
  for (let slot = 0; slot < 200; slot++) for (let s = 0; s < GULL_SLOT; s++) {
    w.debug.setTime(slot * GULL_SLOT + s); w.update(0);
    const g = w.debug.snapshot().gulls;
    for (let i = 0; i < 3; i++) if (g[i].state === 'perched') visits.add(slot * 10 + i);
    w.onPalm(buf);
    for (const e of buf) { assert.ok(e.i < 3, `gull ${e.i} on a palm`); palmVisits.add(slot * 10 + e.i); }
  }
  const share = palmVisits.size / visits.size;
  assert.ok(share >= 0.15 && share <= 0.35, `palm share ${share}`);
  w.dispose();
});

test('wildlife: guarded palms are no perch; the hat is; shoo sends a gull off; pecking bobs', () => {
  const decor = [palm(0, 1), palm(-1, -1), crow(0, 0)];
  const p = perchesFrom(TILES, decor);
  assert.ok(!p.some(q => q.kind === 'palm'), 'both palms are within 4.5 m');
  const hat = p.find(q => q.key === '0,0');
  assert.equal(hat.kind, 'scarecrow'); assert.ok(Math.abs(hat.y - (0.22 + HAT_TOP)) < 1e-9);
  const ctx = wildCtx(), w = createWildlife(ctx), buf = [];
  w.update(0);
  const idx = w.debug.perches.findIndex(q => q.kind === 'palm' && q.key === '0,1');
  assert.ok(idx >= 0);
  w.debug.landGull(0, { perch: idx, instant: true, stay: 30 });
  for (let k = 0; k < 3; k++) { ctx.elapsed += 0.1; w.update(0.1); }
  assert.deepEqual(w.onPalm(buf).map(e => ({ ...e })), [{ i: 0, key: '0,1' }]);
  const r1 = buf[0]; w.onPalm(buf); assert.equal(buf[0], r1, 'onPalm reuses its entries');
  w.pecking = new Set(['0,1']);
  ctx.elapsed += 0.1; w.update(0.1);
  assert.equal(w.shoo('0,1'), true);
  ctx.elapsed += 0.5; w.update(0.5);
  assert.equal(w.debug.snapshot().gulls[0].state, 'leave');
  assert.equal(w.onPalm(buf).length, 0);
  assert.equal(w.shoo('0,1'), false);
  w.dispose();
});

// ---------------------------------------------------------------- model and items

test('model: craft_scarecrow has rags, fits its box, and the rags sway', () => {
  const g = M.createScarecrow3D(T);
  assert.equal(g.name, 'craft_scarecrow');
  const L = g.getObjectByName('ragL'), R = g.getObjectByName('ragR');
  assert.ok(L && R);
  g.updateMatrixWorld(true);
  const s = new T.Box3().setFromObject(g).getSize(new T.Vector3());
  assert.ok(s.x <= 1 && s.y <= 1.9 && s.z <= 0.6, `${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)}`);
  const top = new T.Box3().setFromObject(g).max.y;
  assert.ok(Math.abs(top - HAT_TOP) < 0.03, `hat top ${top}`);
  const meshes = []; g.traverse(o => { if (o.isMesh) meshes.push(o); });
  assert.equal(meshes.length, 3, 'one static mesh plus one per rag group');
  M.swayRags(g, 0.7, 1); const a = [L.rotation.z, R.rotation.z, L.rotation.x];
  M.swayRags(g, 1.4, 1.8);
  assert.notDeepEqual([L.rotation.z, R.rotation.z, L.rotation.x], a);
  assert.ok(a.every(Number.isFinite));
});

test('items: the scarecrow crafts from its cost and has a 0.25 m radius', () => {
  const cost = { wood: 3, leaf: 4, rope: 2, plastic: 1 };
  assert.deepEqual({ ...ITEMS.scarecrow.recipe.cost }, cost);
  assert.equal(ITEMS.scarecrow.placeable, true); assert.equal(ITEMS.scarecrow.category, 'decor');
  const slots = new Array(SLOT_COUNT).fill(null); Object.entries(cost).forEach(([kind, count], i) => { slots[i] = { kind, count }; });
  const bag = new Bag({ slots, selected: 0 });
  assert.equal(bag.canCraft('scarecrow').ok, true); assert.ok(bag.craft('scarecrow')); assert.equal(bag.count('scarecrow'), 1);
  assert.equal(BLOCK_RADII.scarecrow, 0.25);
});
