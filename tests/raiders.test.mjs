// Unit tests for dist/raiders.js (crop-raiding seagulls + scarecrow) and dist/raiders-model.js.
// Run: node --test tests/raiders.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const R = await import(new URL('raiders.js', base));
const M = await import(new URL('raiders-model.js', base));
const { cleanCrop } = await import(new URL('crops.js', base));
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { ITEMS, PLACEABLE_IDS, stationRecipeFor } = await import(new URL('items.js', base));
const { FOOD, isEdible } = await import(new URL('vitals.js', base));
const { EVENTS } = await import(new URL('audio.js', base));
const { createContent } = await import(new URL('content.js', base));
const { newState, cleanState, packState, covered, attracting, raiderCount, tickRaiders, hitRaider, raiderPose, raiderLoot, pickTarget, guardOf,
  WAIT, IN, PECKING, OUT, DEAD, RAID_EVERY, PECK, FLY_IN, FLY_OUT, DIE, SCARE_R, HP, MAX_RAIDERS, SCARECROW_HP, GUARD_R } = R;

const plot = (x, z, crops = ['beet', 'beet', 'potato']) => ({ type: 'cropplot', x, z, crop: cleanCrop(crops.map(c => (c ? { c, g: 1, w: 10 } : null))) });
const world = (decor, pieces = []) => ({ tiles: [[-1, -1], [0, -1], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], decor, pieces });
const fixed = (v = 0.5) => () => v;
// Runs the host tick for `sec` seconds in `dt` steps; returns every event seen.
function run(st, w, sec, players = [], dt = 0.25, rnd = fixed()) {
  const seen = [];
  for (let t = 0; t < sec - 1e-9; t += dt) for (const e of tickRaiders(st, w, dt, players, rnd)) seen.push({ ...e });
  return seen;
}
const toPeck = (st, w) => { const ev = run(st, w, RAID_EVERY + FLY_IN + 0.5); assert.ok(ev.some(e => e.kind === 'landed')); assert.equal(st.r[0].st, PECKING); return ev; };

test('items: scarecrow recipe, drumstick food, grilled drumstick, feather name, squawk sound', () => {
  assert.deepEqual({ ...ITEMS.scarecrow.recipe.cost }, { wood: 5, leaf: 3, nail: 3, plastic: 3 });
  assert.ok(ITEMS.scarecrow.placeable && PLACEABLE_IDS.includes('scarecrow'));
  assert.equal(stationRecipeFor('grill', 'drumstick')?.id, 'cookeddrumstick');
  assert.deepEqual([FOOD.drumstick.food, FOOD.drumstick.water, FOOD.cookeddrumstick.food], [5, -5, 20]);
  assert.ok(isEdible('drumstick') && isEdible('cookeddrumstick'));
  assert.ok(EVENTS.includes('squawk'));
  assert.deepEqual([RAID_EVERY, PECK, SCARE_R, HP, MAX_RAIDERS, SCARECROW_HP, GUARD_R], [240, 15, 2.25, 10, 3, 3, 6]);
});

test('raiderCount: one raider per 1-2 attracting plots, at most 3', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9].map(raiderCount), [0, 1, 1, 2, 2, 3, 3, 3]);
});

test('covered: a roof or an upper floor over the tile; attracting skips those and empty plots', () => {
  assert.equal(covered([{ t: 'roof', i: 0, j: 0, l: 0 }], 0, 0), true);
  assert.equal(covered([{ t: 'floor', i: 0, j: 0, l: 1 }], 0, 0), true);
  assert.equal(covered([{ t: 'floor', i: 0, j: 0, l: 0 }, { t: 'wall', i: 0, j: 0, l: 0 }, { t: 'roof', i: 1, j: 0, l: 0 }], 0, 0), false);
  const w = world([plot(0, 0), plot(1, 0, []), plot(2, 0)], [{ t: 'roof', i: 2, j: 0, l: 0 }]);
  assert.deepEqual(attracting(w).map(d => d.x), [0]);
});

test('first raid ~240 s after planting: swoop, land, peck 15 s, slot back to bare soil, fly off', () => {
  const st = newState(), w = world([plot(0, 0)]);
  assert.deepEqual(run(st, world([]), 600), [], 'nothing planted: no raid, timer held');
  assert.equal(st.r[0].st, WAIT); assert.equal(st.r[0].t, RAID_EVERY);
  run(st, w, RAID_EVERY - 1); assert.equal(st.r[0].st, WAIT, 'still waiting just before 240 s');
  run(st, w, 1.25); assert.equal(st.r[0].st, IN);
  assert.equal(st.r[1].st, WAIT, 'one plot: one raider');
  const r = st.r[0], target = { x: r.x, z: r.z, s: r.s };
  assert.equal(target.x, 0); assert.ok(target.s >= 0 && target.s < 3);
  const ev = run(st, w, FLY_IN + 0.25);
  assert.deepEqual(ev.map(e => e.kind), ['landed']); assert.equal(r.st, PECKING);
  run(st, w, PECK - 1); assert.ok(w.decor[0].crop[target.s].c, 'crop still there while pecking');
  const ate = run(st, w, 1.25);
  assert.equal(ate[0]?.kind, 'ate'); assert.deepEqual(w.decor[0].crop[target.s], { c: '', g: 0, w: 0 }, 'slot is bare soil');
  assert.equal(w.decor.length, 1, 'the plot stays');
  assert.equal(r.st, OUT);
  run(st, w, FLY_OUT + 0.25); assert.equal(r.st, WAIT); assert.ok(r.t >= RAID_EVERY - 1);
});

test('a player within 2.25 m scares a landed raider off and resets its timer', () => {
  const st = newState(), w = world([plot(0, 0)]); toPeck(st, w);
  const r = st.r[0];
  run(st, w, 1, [{ x: r.px + SCARE_R + 0.3, z: r.pz }]); assert.equal(r.st, PECKING, '2.55 m away: keeps pecking');
  const ev = run(st, w, 0.25, [null, { x: r.px + 1.5, z: r.pz + 1 }]);
  assert.equal(ev[0]?.kind, 'scared'); assert.equal(r.st, OUT);
  assert.ok(w.decor[0].crop.every(s => s.c), 'no crop lost');
  run(st, w, FLY_OUT + 0.5); assert.equal(r.st, WAIT); assert.ok(r.t > RAID_EVERY - 1);
});

test('spear hits: wooden 5 (two to kill), metal 10; any hit while landed scares it; loot 1-3 feathers + drumstick', () => {
  const st = newState(), w = world([plot(0, 0)]); toPeck(st, w);
  const r = st.r[0];
  let h = hitRaider(st, 0, 5, 1); assert.deepEqual(h, { ok: true, killed: false, scared: true }); assert.equal(r.hp, 5); assert.equal(r.st, OUT);
  h = hitRaider(st, 0, 5, 1); assert.equal(h.killed, true); assert.equal(r.st, DEAD);
  assert.equal(hitRaider(st, 0, 5).ok, false, 'a falling raider cannot be hit again');
  run(st, w, DIE + 0.25); assert.equal(r.st, WAIT); assert.equal(r.hp, HP);
  const st2 = newState(); toPeck(st2, world([plot(0, 0)]));
  assert.equal(hitRaider(st2, 0, 10).killed, true, 'metal spear: one hit');
  assert.equal(hitRaider(newState(), 0, 10).ok, false, 'a waiting raider is not there to hit');
  for (const v of [0, 0.5, 0.99]) { const l = raiderLoot(fixed(v)); assert.equal(l.drumstick, 1); assert.ok(l.feather >= 1 && l.feather <= 3); }
  assert.deepEqual([0, 0.5, 0.99].map(v => raiderLoot(fixed(v)).feather), [1, 2, 3]);
});

test('scarecrow: plots within 6 m are raided at the scarecrow instead; 3 pecks: arm, arm, gone', () => {
  const crow = { type: 'scarecrow', x: 3, z: 0 }, w = world([plot(0, 0), crow]);
  assert.equal(guardOf(w, w.decor[0]), crow, '6 m tile-centre distance counts');
  assert.equal(guardOf(world([plot(0, 0), { type: 'scarecrow', x: 4, z: 0 }]), plot(0, 0)), null, '8 m is too far');
  const st = newState();
  for (let k = 1; k <= SCARECROW_HP; k++) {
    toPeck(st, w); assert.equal(st.r[0].s, -1); assert.equal(st.r[0].x, 3);
    const ev = run(st, w, PECK + 0.25);
    assert.ok(w.decor[0].crop.every(s => s.c), 'crops untouched');
    if (k < SCARECROW_HP) { assert.equal(ev[0].kind, 'pecked'); assert.equal(st.sc['3,0'], SCARECROW_HP - k); }
    else { assert.equal(ev[0].kind, 'fell'); assert.equal(w.decor.some(d => d.type === 'scarecrow'), false); assert.equal(st.sc['3,0'], undefined); }
    run(st, w, FLY_OUT + 0.5);
  }
  toPeck(st, w); assert.ok(st.r[0].s >= 0, 'with the scarecrow gone the crops are fair game');
});

test('roofed plots are ignored; a raider leaves when its crop is harvested or roofed over mid-raid', () => {
  const st = newState(), w = world([plot(0, 0)], [{ t: 'roof', i: 0, j: 0, l: 0 }]);
  assert.deepEqual(run(st, w, 600), []); assert.equal(st.r[0].st, WAIT);
  const w2 = world([plot(0, 0, ['beet', null, null])]); toPeck(st, w2);
  w2.decor[0].crop[0] = { c: '', g: 0, w: 0 }; // harvested
  run(st, w2, 0.25); assert.equal(st.r[0].st, OUT);
  // mid-swoop abort retraces the arc: no jump in position
  const st3 = newState(), w3 = world([plot(0, 0)]); run(st3, w3, RAID_EVERY + 2);
  const p = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, flap: 0, fold: 0, scale: 1 }, q = { ...p };
  raiderPose(st3.r[0], p); w3.pieces.push({ t: 'roof', i: 0, j: 0, l: 0 });
  tickRaiders(st3, w3, 1e-6, []); raiderPose(st3.r[0], q);
  assert.equal(st3.r[0].st, OUT); assert.ok(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 0.01);
});

test('several plots: up to 3 raiders on distinct slots, staggered', () => {
  const st = newState(), w = world([0, 1, 2, 3, 4].map(x => plot(x, 0)));
  let k = 0; const rnd = () => ((k = (k * 7 + 3) % 11) / 11);
  run(st, w, RAID_EVERY + 2 * R.STAGGER + FLY_IN + 1, [], 0.25, rnd);
  assert.equal(st.r.filter(r => r.st === PECKING).length, 3);
  const keys = st.r.map(r => `${r.x},${r.s}`); assert.equal(new Set(keys).size, 3);
  assert.equal(pickTarget(newState(), 0, world([])), false);
});

test('cleanState / packState: junk -> fresh waiting raiders; a packed state round-trips', () => {
  for (const v of [undefined, null, 3, 'x', { r: 'x' }, { r: [[99, 'a']] }]) assert.deepEqual(cleanState(v), newState());
  const st = newState(), w = world([plot(0, 0), { type: 'scarecrow', x: 9, z: 9 }]); toPeck(st, w); st.sc['1,0'] = 2; st.sc.bad = 1; st.sc['2,0'] = 7;
  const back = cleanState(JSON.parse(JSON.stringify(packState(st))));
  assert.equal(back.r[0].st, PECKING); assert.equal(back.r[0].x, st.r[0].x); assert.equal(back.r[0].s, st.r[0].s);
  assert.ok(Math.abs(back.r[0].px - st.r[0].px) < 1e-3);
  assert.deepEqual(back.sc, { '1,0': 2 });
});

test('raiderPose: comes down from the sky, stands on the soil while pecking, bobs its head', () => {
  const st = newState(), w = world([plot(0, 0)]); run(st, w, RAID_EVERY + 0.25);
  const r = st.r[0], p = {}; raiderPose(r, p);
  assert.ok(p.y > r.py + 6, 'starts high'); assert.ok(Math.hypot(p.x - r.px, p.z - r.pz) > 10, 'and far out');
  run(st, w, FLY_IN + 0.25); raiderPose(r, p);
  assert.equal(p.landed, true); assert.equal(p.y, r.py); assert.ok(Math.abs(r.py - (0.22 + 0.27)) < 1e-9, 'feet on the soil');
  let maxPitch = 0; for (let t = 0; t < 2.4; t += 0.05) { r.t = t; raiderPose(r, p); maxPitch = Math.max(maxPitch, p.pitch); }
  assert.ok(maxPitch > 0.5, 'pecks');
});

test('module: host forces a raid, a guest-range spear hit kills it and pays the hitter; guest sees the state over net', () => {
  const host = { role: 'host', running: true, physics: { x: 0, z: 0 }, other: null, world: world([plot(0, 0)]), emitted: [], emit(e, to) { this.emitted.push([e, to]); }, action(a) { reg.action(a, 'host', bag); } };
  const bag = new Bag({ slots: new Array(SLOT_COUNT).fill(null), selected: 0 });
  const reg = createContent(host, [R.createRaiders]); const mod = reg.mods[0];
  assert.equal(mod.decorModel('scarecrow'), null, 'no THREE: no model');
  const f = mod.debug.force(0, { land: true });
  assert.ok(f); assert.equal(host.emitted[0][0].text, 'A seagull is pecking at your crops!'); assert.equal(host.emitted[0][1], 'all');
  host.physics = { x: f.px + 2.6, z: f.pz }; // just outside the scare radius, inside spear reach
  reg.update(0.1); assert.equal(mod.state.r[0].st, PECKING);
  assert.equal(reg.action({ kind: 'raiders.hit', i: 0, dmg: 5 }, 'host', bag), true);
  assert.equal(mod.state.r[0].hp, 5); assert.equal(mod.state.r[0].st, OUT);
  reg.action({ kind: 'raiders.hit', i: 0, dmg: 5 }, 'host', bag);
  assert.equal(mod.state.r[0].st, DEAD); assert.equal(bag.count('drumstick'), 1); assert.ok(bag.count('feather') >= 1);
  assert.equal(host.emitted.at(-1)[0].kind, 'loot');
  // far away hits are ignored
  mod.debug.force(0, { land: true }); host.physics = { x: 30, z: 30 };
  reg.action({ kind: 'raiders.hit', i: 0, dmg: 10 }, 'host', bag); assert.equal(mod.state.r[0].hp, HP);
  // guest
  const data = JSON.parse(JSON.stringify(reg.serialize().raiders));
  const guest = { role: 'guest', running: true, physics: { x: 0, z: 0 }, world: world([plot(0, 0)]) };
  const g = createContent(guest, [R.createRaiders]);
  assert.equal(g.serialize().raiders, undefined, 'guests never serialize');
  g.load({ raiders: data }, 'net'); assert.equal(g.mods[0].state.r[0].st, PECKING);
  g.update(0.2); assert.ok(g.mods[0].state.r[0].t > 0, 'guest animates between updates');
  assert.equal(reg.action({ kind: 'crops.plant' }, 'host', bag), false, 'not ours');
});

test('module with THREE: scarecrow model parts, raiders render without shadows, scenery gull count hint', () => {
  const g = M.createScarecrow(T);
  assert.equal(g.name, 'craft_scarecrow');
  for (const n of ['body', 'armL', 'armR', 'head']) assert.ok(g.getObjectByName(n), n);
  g.traverse(o => { if (o.isMesh) assert.equal(o.castShadow, false); });
  const scene = new T.Scene(), raft = new T.Group(); scene.add(raft);
  const ctx = { T, scene, raft, role: 'host', running: true, physics: { x: 5, z: 5 }, world: world([plot(0, 0)]), emit() {}, action() {}, rebuildRaft() {} };
  const mod = R.createRaiders(ctx);
  raft.add(mod.decorModel('scarecrow')); mod.update(0.016);
  mod.debug.force(0, { land: true }); mod.update(0.016);
  const grp = scene.getObjectByName('raiders'); assert.ok(grp);
  assert.equal(grp.children.filter(c => c.visible).length, 1); assert.equal(R.raidersShown(), 1);
  grp.traverse(o => { if (o.isMesh) assert.equal(o.castShadow, false); });
  const wp = mod.debug.worldPos(0); assert.ok(Math.abs(wp.y - 0.49) < 1e-6);
  // a spear ray at the landed gull from 2.5 m hits it
  const o = new T.Vector3(wp.x + 2.4, wp.y + 1.0, wp.z), d = new T.Vector3(wp.x, wp.y + 0.24, wp.z).sub(o).normalize();
  let sent = null; ctx.action = a => { sent = a; };
  assert.equal(mod.trySpear(o, d, 2.8, 5), true); assert.deepEqual(sent, { kind: 'raiders.hit', i: 0, dmg: 5 });
  assert.equal(mod.trySpear(o, new T.Vector3(0, 1, 0), 2.8, 5), false);
  // scarecrow arms follow its HP
  mod.state.sc['0,0'] = 1; mod.update(0.016);
  const crow = raft.getObjectByName('craft_scarecrow');
  assert.equal(crow.getObjectByName('armL').visible, false); assert.equal(crow.getObjectByName('armR').visible, false); assert.equal(crow.getObjectByName('head').visible, true);
  mod.dispose(); assert.equal(R.raidersShown(), 0);
});
