// Unit tests for the island tusker: dist/boar-core.js (rules), dist/boar.js (content module) and boar-model.js.
// Run: node --test tests/boar.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const BUILD = '?build=v3-survival-ae77fa84ac2b';
const T = await import(new URL('vendor/three.module.js', base));
const C = await import(new URL('boar-core.js' + BUILD, base));
const I = await import(new URL('islands.js' + BUILD, base)); // the instance boar.js reads islandNow() from
const { createBoar } = await import(new URL('boar.js' + BUILD, base));
const M = await import(new URL('boar-model.js' + BUILD, base));
const { tryMelee } = await import(new URL('melee-targets.js' + BUILD, base));
const { layoutFor } = await import(new URL('islands-layout.js' + BUILD, base));
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { ITEMS, stationRecipeFor } = await import(new URL('items.js', base));
const { FOOD } = await import(new URL('vitals.js', base));
const { ITEM_ICONS } = await import(new URL('item-svg.js', base));
const { ITEM_TEXT, ITEM_SOURCE } = await import(new URL('craft-book.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));
const { BOAR, LIFE, MODE, BOAR_LOOT, defaults, spawnFor, cleanBoar, stepBoar, hitBoar, packBoar, targetOf } = C;

// A seed with a big island whose tusker starts clear of trunks and rocks, and one with a small island.
const SEEDS = Array.from({ length: 400 }, (_, i) => (i * 2654435761 + 99) >>> 0);
const BIG = SEEDS.find(s => layoutFor(s).R >= 8.2);
const SMALL = SEEDS.find(s => layoutFor(s).R < 6.5);
const DT = 1 / 60;

// A tusker standing at the island-local origin facing +z, with the obstacle list empty (seed without nodes near).
function boarAt(x = 0, z = 0, h = 0) {
  const st = spawnFor(defaults(), BIG, layoutFor(BIG).R);
  st.x = x; st.z = z; st.h = h; st.m = MODE.idle; st.t = 1;
  return st;
}
const player = (x, z, extra = {}) => ({ x, z, on: true, feet: 0.5, ground: 0.5, ...extra });
const ev = () => ({ hit: -1, alert: false });
// Run until pred(st, e) or n frames. Returns frames taken (or -1).
function run(st, players, n, pred, e = ev()) {
  for (let i = 0; i < n; i++) { stepBoar(st, DT, players, e); if (pred && pred(st, e, i)) return i + 1; }
  return -1;
}

test('spawn: one tusker on a big island, none on a small one; deterministic', () => {
  assert.ok(BIG !== undefined && SMALL !== undefined);
  const a = spawnFor(defaults(), BIG, layoutFor(BIG).R), b = spawnFor(defaults(), BIG, layoutFor(BIG).R);
  assert.equal(a.a, LIFE.alive); assert.equal(a.hp, BOAR.HP); assert.equal(BOAR.HP, 18);
  assert.deepEqual(packBoar(a), packBoar(b));
  assert.ok(Math.hypot(a.x, a.z) <= BOAR.WALK_U * a.R);
  assert.equal(spawnFor(defaults(), SMALL, layoutFor(SMALL).R).a, LIFE.none);
});

test('wander: never charges a player off the island or out of range; stays on dry sand', () => {
  const st = boarAt();
  const e = ev();
  for (let i = 0; i < 60 * 60; i++) {
    stepBoar(st, DT, [player(3, 0, { on: false }), player(BOAR.AGGRO + 6, 0)], e);
    assert.notEqual(st.m, MODE.charge); assert.equal(e.hit, -1);
    assert.ok(Math.hypot(st.x, st.z) <= BOAR.WALK_U * st.R + 1e-6);
  }
  assert.equal(targetOf(st, [player(st.x, st.z + BOAR.AGGRO - 0.5)]), 0);
  assert.equal(targetOf(st, [player(st.x, st.z + BOAR.AGGRO + 0.5)]), -1);
  assert.equal(targetOf(st, [player(st.x + 30, st.z), player(st.x + 2, st.z), player(st.x + 1, st.z, { on: false })]), 1, 'nearest on the island');
});

test('charge: within 12 m it winds up, then runs fast in a straight line and gores for 20', () => {
  const st = boarAt(-2, -2);
  const p = [player(2.5, 2.5)];
  const e = ev();
  stepBoar(st, DT, p, e);
  assert.equal(st.m, MODE.alert); assert.equal(e.alert, true);
  const windup = run(st, p, 120, s => s.m === MODE.charge);
  assert.ok(windup > 0 && windup * DT <= BOAR.ALERT + 0.05, 'short wind-up');
  const x0 = st.x, z0 = st.z, dx = st.dx, dz = st.dz;
  assert.ok(Math.abs(dx - Math.SQRT1_2) < 1e-6 && Math.abs(dz - Math.SQRT1_2) < 1e-6, 'aimed at the player');
  let frames = 0, hit = -1;
  for (; frames < 120; frames++) {
    stepBoar(st, DT, p, e);
    if (st.m === MODE.charge) { // straight: no sideways drift off the locked line
      const cross = (st.x - x0) * dz - (st.z - z0) * dx; assert.ok(Math.abs(cross) < 1e-6);
    }
    if (e.hit >= 0) { hit = e.hit; break; }
  }
  assert.equal(hit, 0);
  const d = Math.hypot(st.x - x0, st.z - z0), secs = (frames + 1) * DT;
  assert.ok(d / secs > 7, `fast: ${(d / secs).toFixed(1)} m/s`);
  assert.equal(st.m, MODE.trot);
  assert.equal(BOAR.DAMAGE, 20);
});

test('cooldown: after a hit it trots back ~1.5 s and cannot gore again meanwhile', () => {
  const st = boarAt(-2, 0, Math.PI / 2);
  const p = [player(1, 0)];
  run(st, p, 300, (s, e) => e.hit === 0);
  assert.equal(st.m, MODE.trot);
  const xHit = st.x;
  // The player walks along with it: still no second hit during the trot.
  let frames = 0;
  for (; frames < 300; frames++) {
    p[0].x = st.x + 0.3; p[0].z = st.z;
    const e = stepBoar(st, DT, p, ev());
    if (st.m === MODE.trot) assert.equal(e.hit, -1);
    else break;
  }
  assert.ok(Math.abs(frames * DT - BOAR.TROT) < 0.05, `trot ${(frames * DT).toFixed(2)} s`);
  assert.ok(st.x < xHit, 'it trotted back the way it came');
  assert.equal(st.m, MODE.alert, 'then it sizes you up again');
});

test('side-step: a dodge after the wind-up makes it overshoot and miss', () => {
  const st = boarAt(-3, 0, Math.PI / 2);
  const p = [player(2, 0)];
  run(st, p, 120, s => s.m === MODE.charge);
  p[0].z = 1.6; // step sideways out of the line
  let hit = false, past = -Infinity;
  run(st, p, 200, (s, e) => { if (e.hit >= 0) hit = true; past = Math.max(past, s.x); return s.m === MODE.trot; });
  assert.equal(hit, false);
  assert.ok(past > 2 + 1, `ran past where the player stood (x=${past.toFixed(2)})`);
});

test('jumping over the charge also avoids the hit', () => {
  const st = boarAt(-3, 0, Math.PI / 2);
  const p = [player(1, 0, { feet: 1.6, ground: 0.5 })];
  let hit = false;
  run(st, p, 240, (s, e) => { if (e.hit >= 0) hit = true; return s.m === MODE.trot; });
  assert.equal(hit, false);
});

test('spear: 18 HP, four wooden-spear hits kill it; dead stays dead; junk damage ignored', () => {
  const st = boarAt();
  assert.equal(hitBoar(st, NaN), null); assert.equal(hitBoar(st, -5), null);
  assert.equal(hitBoar(st, 5, { x: -1, z: 0 }), 'hit'); assert.equal(st.hp, 13);
  assert.equal(st.m, MODE.alert, 'a hit turns it on you');
  assert.equal(hitBoar(st, 99), 'hit'); assert.equal(st.hp, 3, 'clamped to 10 per hit');
  assert.equal(hitBoar(st, 5), 'killed'); assert.equal(st.a, LIFE.dead);
  assert.equal(hitBoar(st, 5), null);
  const e = stepBoar(st, DT, [player(0.2, 0)], ev());
  assert.equal(e.hit, -1); assert.equal(st.m, MODE.dead);
});

test('cleanBoar: junk -> defaults, values clamped, dead stays dead, round trip', () => {
  assert.deepEqual(cleanBoar(null), defaults());
  assert.deepEqual(cleanBoar({ s: -3 }), defaults());
  const st = boarAt(1, 2); st.hh = 3; st.hg = 4;
  const c = cleanBoar(JSON.parse(JSON.stringify(packBoar(st))));
  assert.equal(c.s, BIG); assert.equal(c.a, LIFE.alive); assert.equal(c.hp, BOAR.HP); assert.equal(c.hg, 4);
  assert.ok(Math.abs(c.x - 1) < 0.01 && Math.abs(c.z - 2) < 0.01);
  const w = cleanBoar({ s: 5, a: 1, R: 999, hp: 1e9, x: 1e9, z: -1e9, m: 77, hg: -2 });
  assert.equal(w.R, 20); assert.equal(w.hp, BOAR.HP); assert.ok(w.x <= BOAR.WALK_U * 20); assert.equal(w.m, MODE.idle); assert.equal(w.hg, 0);
  assert.equal(cleanBoar({ s: 5, a: 2, hp: 10 }).hp, 0);
  assert.equal(JSON.stringify(packBoar(st)).length < 200, true, 'compact pose');
});

test('items: Raw Meat 20 food / -5 water grills into Grilled Meat (35 food); icons and texts', () => {
  assert.equal(ITEMS.rawmeat.name, 'Raw Meat'); assert.equal(ITEMS.rawmeat.category, 'food');
  assert.deepEqual(FOOD.rawmeat, { food: 20, water: -5 }); assert.deepEqual(FOOD.cookedmeat, { food: 35, water: 0 });
  const r = stationRecipeFor('grill', 'rawmeat');
  assert.ok(r, 'grill recipe'); assert.equal(ITEMS.cookedmeat.recipe.station, 'grill'); assert.deepEqual(ITEMS.cookedmeat.recipe.cost, { rawmeat: 1 });
  for (const k of ['rawmeat', 'cookedmeat']) { assert.ok(ITEM_ICONS[k], k + ' icon'); assert.ok(ITEM_TEXT[k], k + ' text'); assert.ok(ITEM_SOURCE[k], k + ' source'); }
  assert.deepEqual(BOAR_LOOT, { rawmeat: 2 });
});

test('model: two geometries, one material, sensible size, no indices (flat facets)', () => {
  const b = M.boarBodyGeometry(T), l = M.boarLegGeometry(T);
  b.computeBoundingBox(); l.computeBoundingBox();
  const s = b.boundingBox.getSize(new T.Vector3());
  assert.ok(s.z > 1 && s.z < 1.6, 'about 1.2-1.5 m snout to tail'); assert.ok(b.boundingBox.max.y > 0.75 && b.boundingBox.max.y < 1, 'ridge on top');
  assert.ok(Math.abs(l.boundingBox.min.y + M.LEG_LEN) < 0.01, 'leg reaches the ground from its hip');
  for (const h of M.LEG_HIPS) assert.ok(Math.abs(h[1] - M.LEG_LEN) < 0.02, 'hips at leg height');
  assert.ok(b.attributes.color && l.attributes.color);
  assert.ok(b.attributes.position.count < 3000, `low poly: ${b.attributes.position.count} verts`);
  b.dispose(); l.dispose();
});

// ---------------------------------------------------------------- module with the real islands module

function stubWorld(role = 'solo') {
  const physics = new PlayerPhysics({ x: 0, y: 0.2 + PC.EYE_OFFSET, z: 0 });
  const emits = [], plays = [], hurts = [], actions = [];
  const bag = new Bag({ slots: new Array(SLOT_COUNT).fill(null), selected: 0 });
  const ctx = {
    T, scene: new T.Scene(), camera: new T.PerspectiveCamera(70, 1, 0.05, 200),
    ocean: { mesh: { position: { y: -0.24 } }, getHeight: () => -0.24 },
    world: { tiles: [[0, 0]] }, role, running: true, physics, other: null, elapsed: 0,
    localBag: () => bag, play: (e, s) => plays.push([e, s]), hurtPlayer: (n, cause) => { hurts.push([n, cause]); return n; },
    emit: (e, to) => emits.push({ e, to }),
    action: a => { actions.push(a); if (role !== 'guest') { isl.action(a, 'host', bag) || boar.action(a, 'host', bag); } return true; },
  };
  const isl = I.createIslands(ctx), boar = createBoar(ctx);
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { ctx.elapsed += DT; isl.afterMove(physics, DT); isl.update(DT); boar.update(DT); } };
  return { ctx, isl, boar, bag, physics, emits, plays, hurts, actions, tick, dispose() { boar.dispose(); isl.dispose(); } };
}

test('wiring: content.js loads boar.js after islands with the same ?build= token; spear asks the melee registry', () => {
  const dist = fileURLToPath(base);
  const con = readFileSync(resolve(dist, 'content.js'), 'utf8'), src = readFileSync(resolve(dist, 'boar.js'), 'utf8');
  const tok = con.match(/'\.\/islands\.js(\?build=[^']+)'/)[1];
  assert.ok(src.includes(`'./islands.js${tok}'`));
  const feats = con.match(/const FEATURES = \[([^\]]+)\]/)[1].split(',').map(s => s.trim());
  assert.ok(feats.indexOf('createBoar') > feats.indexOf('createIslands'));
  assert.ok(readFileSync(resolve(dist, 'spear-repair-hooks.js'), 'utf8').includes('trySpearTargets(camPos, camDir, SPEAR_REACH, dmg)'));
});

test('module: tusker appears on a big island, charges the player ashore, hurts through hurtPlayer', () => {
  const w = stubWorld();
  w.isl.debug.spawnNear(BIG, 30); w.tick();
  const s0 = w.boar.debug.state();
  assert.equal(s0.s, BIG); assert.equal(s0.a, LIFE.alive); assert.equal(s0.visible, true);
  assert.equal(s0.drawCalls, 2);
  // Stand 4 m in front of it on the sand.
  w.boar.debug.set({ x: -2, z: 0, h: Math.PI / 2, m: MODE.idle, t: 1 });
  assert.equal(w.isl.debug.teleportAshore(2, 0), true);
  for (let i = 0; i < 240 && !w.hurts.length; i++) {
    w.tick();
    if (w.hurts.length) break;
    w.isl.debug.teleportAshore(2, 0); // hold still
  }
  assert.deepEqual(w.hurts[0], [20, 'boar']);
  assert.ok(w.emits.some(x => /tusker/i.test(x.e.text || '')), 'an alert notice');
  assert.equal(w.boar.serialize().hh, 1);
  w.dispose();
});

test('module: guest is hurt when the host counts a goring of the guest; guests never simulate', () => {
  const g = stubWorld('guest');
  g.isl.load({ v: 1, clock: 100, next: 999, isl: { seed: BIG, born: 70, dock: 180, side: 1, off: 20, used: layoutFor(BIG).nodes.map(() => 0) } }, 'net');
  const st = packBoar(boarAt(1, 1));
  g.boar.load({ ...st }, 'net'); g.tick();
  assert.equal(g.boar.debug.state().visible, true);
  g.boar.load({ ...st, hg: st.hg + 1 }, 'net');
  assert.deepEqual(g.hurts, [[20, 'boar']]);
  g.boar.load({ ...st, hg: st.hg + 1 }, 'net');
  assert.equal(g.hurts.length, 1, 'once per goring');
  const before = g.boar.debug.state();
  g.tick(30);
  assert.equal(g.boar.debug.state().x, before.x, 'guest only draws the host pose');
  // the next host pose of the same tusker is eased toward, not snapped to
  g.boar.load({ ...st, hg: st.hg + 1, x: st.x + 1 }, 'net'); g.tick();
  const moved = g.boar.debug.state().wx - before.wx;
  assert.ok(moved > 0.05 && moved < 0.5, `eased: ${moved}`);
  g.tick(120);
  assert.ok(Math.abs(g.boar.debug.state().wx - before.wx - 1) < 0.01, 'catches up');
  g.dispose();
});

test('module: spear kills it via the melee registry; E butchers 2 Raw Meat once; no respawn on the same island', () => {
  const w = stubWorld();
  w.isl.debug.spawnNear(BIG, 30); w.tick();
  w.boar.debug.set({ x: 0, z: 0, h: 0, m: MODE.idle, t: 99 });
  w.isl.debug.teleportAshore(0, -2.2); // 2.2 m behind it
  w.tick();
  const b = w.boar.debug.state();
  const origin = new T.Vector3(w.physics.x, w.physics.y, w.physics.z);
  const dir = new T.Vector3(b.wx - origin.x, b.wy + 0.5 - origin.y, b.wz - origin.z).normalize();
  const away = dir.clone().negate();
  assert.equal(tryMelee(origin, away, 2.8, 5), false, 'a miss');
  for (let i = 0; i < 4; i++) { assert.equal(tryMelee(origin, dir, 2.8, 5), true); w.boar.debug.set({ m: MODE.idle, t: 99, x: 0, z: 0 }); }
  assert.equal(w.boar.debug.state().a, LIFE.dead);
  assert.ok(w.emits.some(x => /down/.test(x.e.text || '')));
  assert.equal(tryMelee(origin, dir, 2.8, 5), false, 'no hits on a body');
  // Butcher: aim the camera at the body.
  w.ctx.camera.position.copy(origin); w.ctx.camera.lookAt(b.wx, b.wy + 0.3, b.wz); w.ctx.camera.updateMatrixWorld();
  assert.ok(w.boar.prompt(null)?.includes('Butcher'));
  assert.equal(w.boar.interact(null), true);
  assert.equal(w.bag.count('rawmeat'), 2);
  assert.ok(w.emits.some(x => x.e.kind === 'loot' && x.e.loot.rawmeat === 2));
  assert.equal(w.boar.interact(null), false, 'only once');
  w.tick(60);
  assert.equal(w.boar.debug.state().a, LIFE.looted, 'no respawn on this island visit');
  assert.equal(w.boar.debug.state().visible, false);
  // A save mid-visit keeps it gone.
  w.boar.load(JSON.parse(JSON.stringify(w.boar.serialize())), 'save'); w.tick();
  assert.equal(w.boar.debug.state().a, LIFE.looted);
  // A new island brings a new tusker.
  const NEXT = SEEDS.find(s => s !== BIG && layoutFor(s).R >= BOAR.MIN_R);
  w.isl.debug.spawnNear(NEXT, 30); w.tick();
  assert.equal(w.boar.debug.state().s, NEXT); assert.equal(w.boar.debug.state().a, LIFE.alive);
  w.dispose();
});

test('module: full bag keeps the body; small island has no tusker', () => {
  const w = stubWorld();
  for (let i = 0; i < SLOT_COUNT; i++) w.bag.slots[i] = { kind: 'scrap', count: 20 };
  w.isl.debug.spawnNear(BIG, 30); w.tick();
  w.boar.debug.set({ x: 0, z: 0, m: MODE.idle, t: 99 }); w.boar.debug.kill();
  w.isl.debug.teleportAshore(0, -1.5); w.tick();
  w.boar.action({ kind: 'boar.loot', s: BIG }, 'host', w.bag);
  assert.equal(w.boar.debug.state().a, LIFE.dead); assert.ok(w.emits.some(x => x.e.kind === 'full'));
  w.isl.debug.spawnNear(SMALL, 30); w.tick();
  assert.equal(w.boar.debug.state().a, LIFE.none); assert.equal(w.boar.debug.state().visible, false);
  w.dispose();
});

test('no per-frame allocation in the sim step (smoke: same objects reused)', () => {
  const st = boarAt(), p = [player(3, 3)], e = ev();
  const r = stepBoar(st, DT, p, e);
  assert.equal(r, e);
  const src = readFileSync(resolve(fileURLToPath(base), 'boar-core.js'), 'utf8');
  const body = src.slice(src.indexOf('export function stepBoar'), src.indexOf('export function hitBoar'));
  assert.ok(!/new |\[\]|\{ *\w+ *:/.test(body.replace(/ev\.hit|\/\/.*$/gm, '')), 'stepBoar has no literals or new');
});
