// Story progression: circuit boards / vine goo, the Receiver's power + antenna rule, and the Old Beacon Mast
// landmark (placement, seabed persistence, crates, keeper's board, standing on it). Run: node --test tests/mast.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const M = await import(new URL('mast.js', base));
const { createPower, CAP } = await import(new URL('power.js', base));
const { ITEMS } = await import(new URL('items.js', base));
const { StationModel } = await import(new URL('smelter.js', base));
const { Bag, RECIPES, SLOT_COUNT, STACK_SIZE } = await import(new URL('inventory-state.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));
const { storyNote, STORY_NOTES } = await import(new URL('logbook.js', base));
const { createMastModel } = await import(new URL('mast-model.js', base));
const { createContent } = await import(new URL('content.js', base));
const { MAST, CRATES, cleanMast, placeRel, mastRel, receiverStatus, clueFor, surfaceAt, openCrate, readBoard, createMast } = M;

const RAFT = []; for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) RAFT.push([x, z]);
const emptyBag = () => new Bag({ slots: new Array(SLOT_COUNT).fill(null), selected: 0 });

// ---------------------------------------------------------------- recipes

test('vine goo: seaweed smelts into it in the smelter', () => {
  assert.equal(ITEMS.vinegoo.recipe.station, 'smelter');
  assert.deepEqual({ ...ITEMS.vinegoo.recipe.cost }, { seaweed: 1 });
  const s = new StationModel('smelter');
  assert.equal(s.insert('seaweed', 2), 2);
  s.addFuel('wood', 4);
  s.tick(ITEMS.vinegoo.recipe.time * 2 + 0.01);
  assert.deepEqual(s.output, { kind: 'vinegoo', count: 2 });
});

test('circuit board, receiver and antenna recipes (Raft costs, copper adapted)', () => {
  assert.deepEqual({ ...RECIPES.circuitboard.cost }, { copperingot: 1, vinegoo: 1, plastic: 2 });
  assert.equal(ITEMS.circuitboard.recipe.station, null);
  assert.deepEqual({ ...RECIPES.receiver.cost }, { wood: 8, plastic: 6, circuitboard: 2, hinge: 1 });
  assert.deepEqual({ ...RECIPES.antenna.cost }, { bolt: 1, scrap: 4, circuitboard: 1 });
  const bag = Bag.fromCounts({ copperingot: 1, vinegoo: 1, plastic: 2 });
  assert.equal(bag.craft('circuitboard').ok, true);
  assert.equal(bag.count('circuitboard'), 1);
  assert.equal(bag.count('copperingot'), 0);
});

// ---------------------------------------------------------------- pure rules

test('receiverStatus: needs a receiver, switched on, 3 antennas and a charged battery', () => {
  assert.equal(receiverStatus(false, true, 3, true), 'none');
  assert.equal(receiverStatus(true, false, 3, true), 'off');
  for (const n of [0, 1, 2]) assert.equal(receiverStatus(true, true, n, true), 'antennas');
  assert.equal(receiverStatus(true, true, 3, false), 'power');
  assert.equal(receiverStatus(true, true, 3, true), 'live');
});

test('antennaCount matches signal.js countAntennas', async () => {
  const { countAntennas } = await import(new URL('signal.js', base));
  for (let k = 0; k < 200; k++) {
    const decor = [{ type: 'receiver', x: (k % 5) - 2, z: ((k >> 2) % 5) - 2 }];
    for (let i = 0; i < k % 7; i++) decor.push({ type: 'antenna', x: ((k * 7 + i * 3) % 7) - 3, z: ((k * 5 + i * 11) % 7) - 3 });
    assert.equal(M.antennaCount(decor, decor[0]), countAntennas(decor));
  }
  assert.equal(M.antennaCount([{ type: 'antenna', x: 5, z: 5 }], null), 0);
});

test('placeRel: 600-800 m along the travel direction (within the spread), deterministic', () => {
  const o = { x: 0, z: 0 };
  for (let s = 1; s < 400; s++) {
    const seed = (s * 2654435761) >>> 0;
    for (const [dx, dz] of [[0, 1], [1, 0], [0.3, -0.2], [0, 0]]) {
      placeRel(seed, dx, dz, o);
      const d = Math.hypot(o.x, o.z);
      assert.ok(d >= MAST.DIST_MIN - 1e-6 && d <= MAST.DIST_MAX + 1e-6, `dist ${d}`);
      const m = Math.hypot(dx, dz) || 1, ux = dx ? dx / m : 0, uz = dx || dz ? dz / m : 1;
      const cos = (o.x * ux + o.z * uz) / d;
      assert.ok(cos >= Math.cos(MAST.SPREAD) - 1e-9, 'ahead, within the spread');
    }
  }
  const a = placeRel(77, 0, 1, {}), b = placeRel(77, 0, 1, {});
  assert.deepEqual(a, b);
});

test('cleanMast: old saves and junk get defaults; valid slices round-trip', () => {
  for (const v of [undefined, null, 3, 'x', [], { v: 2 }]) assert.deepEqual(cleanMast(v), { v: 1, seed: 0, at: null, crates: [0, 0, 0], note: 0, on: 0, live: 0, clue: null });
  const good = { v: 1, seed: 99, at: { bx: 512.5, bz: -640 }, crates: [1, 0, 1], note: 1, on: 1, live: 1, clue: { code: '4821', bearing: 213 } };
  assert.deepEqual(cleanMast(JSON.parse(JSON.stringify(good))), good);
  const bad = cleanMast({ v: 1, seed: -4, at: { bx: NaN, bz: 0 }, crates: [1, 1, 1], note: 1, clue: { code: '12', bearing: 999 } });
  assert.equal(bad.seed, 0); assert.equal(bad.at, null);
  assert.deepEqual(bad.crates, [0, 0, 0], 'no mast yet: nothing looted');
  assert.equal(bad.clue, null);
});

test('mastRel: fixed on the seabed, moved by the ground offset', () => {
  const at = { bx: 100, bz: 700 };
  assert.deepEqual(mastRel(at, 0, 0, {}), { x: 100, z: 700 });
  assert.deepEqual(mastRel(at, 100, 650, {}), { x: 0, z: 50 });
});

test('surfaceAt: flat rock top, sloped rim, deck only for feet up there', () => {
  assert.equal(surfaceAt(0, 0, 1), MAST.PLAT_Y, 'under the deck you stand on the rock');
  assert.equal(surfaceAt(0, 0, MAST.DECK_Y), MAST.DECK_Y);
  assert.equal(surfaceAt(MAST.DECK_HALF + .5, 0, MAST.DECK_Y).toFixed(2), MAST.PLAT_Y.toFixed(2), 'off the deck edge: the rock below');
  assert.ok(Number.isNaN(surfaceAt(MAST.PLAT_R * 1.5, 0, 0)));
  const rim = surfaceAt(MAST.PLAT_R * .99, 0, 0);
  assert.ok(rim < MAST.PLAT_Y && rim > -0.6, 'rim slopes into the water');
});

test('openCrate / readBoard: host checks reach, bag room, loot once; the clue is stored', () => {
  const st = cleanMast({ v: 1, seed: 5, at: { bx: 0, bz: 0 } });
  const c = CRATES[0], top = { x: c.x + .5, y: MAST.DECK_Y + PC.EYE_OFFSET, z: c.z };
  assert.equal(openCrate(st, 0, { x: c.x, y: 2, z: c.z }, 'host', emptyBag()).reason, 'reach', 'from the rock below');
  assert.equal(openCrate(st, 0, { x: c.x + 6, y: top.y, z: c.z }, 'host', emptyBag()).reason, 'reach');
  const full = new Bag({ slots: new Array(SLOT_COUNT).fill(null).map(() => ({ kind: 'plastic', count: STACK_SIZE })), selected: 0 });
  assert.equal(openCrate(st, 0, top, 'host', full).reason, 'full');
  assert.equal(st.crates[0], 0);
  const bag = emptyBag();
  const r = openCrate(st, 0, top, 'host', bag);
  assert.equal(r.ok, true);
  assert.equal(bag.count('copperingot'), 2); assert.equal(bag.count('circuitboard'), 1);
  assert.equal(openCrate(st, 0, top, 'host', bag).reason, 'empty');
  assert.equal(openCrate(st, 7, top, 'host', bag).reason, 'crate');
  const loot = CRATES.flatMap(c => c.loot.map(l => l[0]));
  for (const k of ['copperingot', 'circuitboard', 'battery']) assert.ok(loot.includes(k), k);
  // the keeper's board
  assert.equal(readBoard(st, { x: 9, z: 9, y: top.y }, 'host').ok, false);
  const b = readBoard(st, { x: .5, z: 1.4, y: top.y }, 'host');
  assert.deepEqual(b, { ok: true, first: true });
  assert.deepEqual(st.clue, clueFor(5));
  assert.match(st.clue.code, /^\d{4}$/);
  assert.equal(readBoard(st, { x: .5, z: 1.4, y: top.y }, 'host').first, false);
  const note = storyNote('mast1', st.clue);
  assert.ok(note.text.includes(st.clue.code) && note.text.includes(String(st.clue.bearing).padStart(3, '0')));
  assert.ok(!/Radio Tower|Vasagatan/i.test(JSON.stringify(STORY_NOTES)), 'our own names');
});

// ---------------------------------------------------------------- the module with a stub ctx

function stub({ role = 'host', gx = 0, gz = 0 } = {}) {
  const physics = new PlayerPhysics({ x: 0, y: 0.2 + PC.EYE_OFFSET, z: 0 });
  const emits = [], blockers = [], marks = [];
  const world = { tiles: RAFT.map(t => [...t]), decor: [], sailing: { gx, gz, vx: 0, vz: 0 } };
  const sailing = { addBlocker: b => blockers.push(b), blockerClear: () => 6, groundOffset: o => { o.x = world.sailing.gx; o.z = world.sailing.gz; return o; }, markBeacon: (x, z) => marks.push([x, z]) };
  const ctx = {
    T, scene: new T.Scene(), camera: new T.PerspectiveCamera(70, 1, 0.05, 200), world, role, running: true, physics, other: null, sailing,
    ocean: { mesh: { position: { y: -0.24 } }, getHeight: () => -0.24 },
    emit: (e, to) => emits.push({ e, to }), notice: s => emits.push({ e: { kind: 'notice', text: s }, to: 'local' }),
    action: a => { mods.action(a, 'host', bag); return true; },
    rebuildRaft() {},
  };
  const bag = emptyBag();
  const powerCtx = { T: null, world, role, running: true, emit: ctx.emit };
  const power = createPower(powerCtx);
  const peer = name => (name === 'power' ? power : null);
  const mast = createMast(ctx, peer);
  const mods = { action: (a, actor, b) => mast.action(a, actor, b) || false };
  return { ctx, mast, power, physics, emits, blockers, marks, world, bag };
}
const rig = (w, antennas = 3, charge = CAP) => {
  w.world.decor.push({ type: 'receiver', x: 0, z: 0 }, { type: 'battery', x: 1, z: 0 });
  const spots = [[2, 2], [-2, 2], [2, -2]];
  for (let i = 0; i < antennas; i++) w.world.decor.push({ type: 'antenna', x: spots[i][0], z: spots[i][1] });
  w.power.debug.setCharge(1, 0, charge);
};

test('receiver: no signal until switched on with 3 antennas and a charged battery', () => {
  const w = stub(); rig(w, 2);
  w.mast.update(1 / 60);
  assert.equal(w.mast.debug.state().status, 'off');
  assert.equal(w.mast.beacon(0), null, 'off: no pill');
  w.mast.action({ kind: 'mast.rx' }, 'host', w.bag);
  assert.equal(w.mast.debug.state().status, 'antennas');
  assert.match(w.mast.beacon(0).label, /antennas 2\/3/);
  assert.equal(w.mast.debug.state().at, null, 'no landmark yet');
  w.world.decor.push({ type: 'antenna', x: 2, z: -2 });
  w.power.debug.setCharge(1, 0, 0);
  w.mast.update(1 / 60);
  assert.equal(w.mast.debug.state().status, 'power');
  assert.equal(w.mast.debug.state().at, null);
  w.power.debug.setCharge(1, 0, CAP);
  w.mast.update(1 / 60);
  const s = w.mast.debug.state();
  assert.equal(s.status, 'live'); assert.equal(s.live, 1);
  assert.ok(s.at, 'placed when first heard');
  assert.ok(s.dist >= MAST.DIST_MIN - 1 && s.dist <= MAST.DIST_MAX + 1, `dist ${s.dist}`);
  const b = w.mast.beacon(0);
  assert.equal(b.live, true); assert.match(b.label, /^BEACON MAST (N|NE|E|SE|S|SW|W|NW) · \d+ m$/);
  assert.ok(w.emits.some(e => /Old Beacon Mast/.test(e.e.text)));
  assert.ok(Number.isFinite(w.marks.at(-1)[0]), 'compass marker on');
});

test('receiver: a full battery runs it ~500 s, then the signal drops', () => {
  const w = stub(); rig(w, 3);
  w.mast.action({ kind: 'mast.rx' }, 'host', w.bag);
  for (let t = 0; t < 490; t++) w.mast.update(1);
  assert.equal(w.mast.debug.state().status, 'live');
  for (let t = 0; t < 15; t++) w.mast.update(1);
  assert.equal(w.mast.debug.state().status, 'power');
  assert.equal(w.mast.debug.state().live, 0);
  assert.ok(w.emits.some(e => e.e.text === 'A battery ran out of charge'));
  assert.ok(Number.isNaN(w.marks.at(-1)[0]), 'compass marker off without power');
  assert.ok(w.mast.debug.state().at, 'the landmark stays where it is');
});

test('receiver off: no drain', () => {
  const w = stub(); rig(w, 3);
  for (let t = 0; t < 100; t++) w.mast.update(1);
  assert.equal(w.power.debug.state().b['1,0'], CAP);
});

test('landmark persists: save -> load keeps seed, seabed spot, crates, note; old saves load clean', () => {
  const w = stub({ gx: 30, gz: -12 }); rig(w, 3);
  w.mast.action({ kind: 'mast.rx' }, 'host', w.bag); w.mast.update(1 / 60);
  const saved = JSON.parse(JSON.stringify(w.mast.serialize()));
  assert.ok(saved.at && saved.seed);
  const w2 = stub({ gx: 30, gz: -12 });
  w2.mast.load(saved, 'save'); w2.mast.update(0);
  assert.deepEqual(w2.mast.debug.state().at, saved.at);
  assert.equal(Math.round(w2.mast.debug.state().dist), Math.round(w.mast.debug.state().dist));
  // the world drifting past the raft moves it; the seabed spot does not change
  w2.world.sailing.gz += 100; w2.mast.update(0);
  assert.deepEqual(w2.mast.debug.state().at, saved.at);
  assert.equal(Math.round(w2.mast.debug.state().z), Math.round(w.mast.debug.state().z - 100));
  const w3 = stub(); w3.mast.load(undefined, 'save'); w3.mast.update(0);
  assert.equal(w3.mast.debug.state().at, null);
  assert.ok(w3.mast.debug.state().seed > 0, 'host picks a seed');
});

test('co-op: the guest mirrors the host slice and never places or loots on its own', () => {
  const h = stub(); rig(h, 3);
  h.mast.action({ kind: 'mast.rx' }, 'host', h.bag); h.mast.update(1 / 60);
  const g = stub({ role: 'guest' }); g.world.decor.push(...h.world.decor.map(d => ({ ...d })));
  g.mast.update(1 / 60);
  assert.equal(g.mast.debug.state().at, null, 'guest never places');
  g.mast.load(JSON.parse(JSON.stringify(h.mast.serialize())), 'net'); g.mast.update(0);
  assert.deepEqual(g.mast.debug.state().at, h.mast.debug.state().at);
  assert.equal(g.mast.debug.state().live, 1);
  assert.equal(g.mast.action({ kind: 'mast.crate', i: 0 }, 'guest', g.bag), true, 'claimed but ignored on a guest');
  assert.equal(g.bag.count('copperingot'), 0);
  const before = g.mast.serialize();
  g.mast.load(JSON.parse(JSON.stringify(h.mast.serialize())), 'net');
  assert.equal(g.mast.serialize(), before, 'unchanged host state: no rebuild');
});

test('standing on the rock and the deck, climbing the ladder, looting from the top', () => {
  const w = stub(); w.mast.debug.spawnAt(20, 0); w.mast.update(0);
  assert.ok(w.blockers.length === 1 && w.blockers[0].r > MAST.PLAT_R, 'grounding blocker registered');
  assert.ok(w.mast.debug.teleportFoot());
  const step = (n, input = {}) => { for (let i = 0; i < n; i++) { w.physics.update(1 / 60, { tiles: RAFT, deckY: 0.2, waterY: -0.24, ...input }); w.mast.afterMove(w.physics, 1 / 60); w.mast.update(1 / 60); } };
  step(30);
  assert.equal(w.physics.grounded, true); assert.equal(w.physics.swimming, false);
  assert.ok(Math.abs(w.physics.y - PC.EYE_OFFSET - (-0.24 + MAST.PLAT_Y)) < 0.03, 'feet on the rock');
  assert.ok(w.mast.prompt(null)?.includes('Climb the ladder'));
  assert.ok(w.mast.interact(null));
  step(30, { forward: 1, yaw: 0 });
  assert.ok(Math.abs(w.physics.y - PC.EYE_OFFSET - (-0.24 + MAST.DECK_Y)) < 0.03, 'feet on the deck');
  const s = w.mast.debug.state();
  assert.ok(Math.abs(w.physics.z - s.z) <= MAST.RAIL + 1e-6, 'railings hold you on the deck');
  // loot a crate from up here (host action with the real pose)
  const c = w.mast.debug.crates()[1];
  w.physics.x = c.x + .6; w.physics.z = c.z;
  assert.equal(w.mast.action({ kind: 'mast.crate', i: 1 }, 'host', w.bag), true);
  assert.equal(w.bag.count('circuitboard'), 1);
  assert.equal(w.mast.debug.state().crates[1], 1);
  const bd = w.mast.debug.board(); w.physics.x = bd.x; w.physics.z = bd.z - .6;
  w.mast.action({ kind: 'mast.board' }, 'host', w.bag);
  assert.equal(w.mast.debug.state().note, 1);
  assert.equal(w.mast.storyNotes().length, 1);
  assert.match(w.mast.storyNotes()[0].text, /\d{4}/);
});

test('model: at most 4 draw calls and a single shadow caster', () => {
  const m = createMastModel(T);
  let meshes = 0, casters = 0;
  m.group.traverse(o => { if (o.isMesh) { meshes++; if (o.castShadow) casters++; } });
  assert.ok(meshes <= 4, `draws ${meshes}`);
  assert.equal(casters, 1);
  m.setCrates([1, 0, 1]);
  m.dispose();
});

test('content registry: mast module is registered and answers beacon/storyNotes', () => {
  const w = stub();
  const c = createContent(w.ctx, [ctx => createMast(ctx, null)]);
  assert.equal(c.beacon(0), null);
  assert.deepEqual(c.storyNotes() ?? [], []);
  c.dispose();
});
