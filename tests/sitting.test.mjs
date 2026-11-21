// Unit tests for sit on seats (dist/sitting.js, dist/sitting-core.js). See docs/specs/sitting.md.
// Run: node --test tests/sitting.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const C = await import(new URL('sitting-core.js', base));
const { createSitting, TEXT } = await import(new URL('sitting.js', base));
const { createContent } = await import(new URL('content.js', base));
const { poseFlags, readFlags } = await import(new URL('coop.js', base));
const { evaluate } = await import(new URL('logbook.js', base));
const { SEATS, EYE, REACH, AWARD_S, YAW_LIM, seatPoint, findDecor, standSpot, getUpSpot, clampYaw, cleanSit } = C;

const near = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b} got ${a}`);
const DEFAULTS = { v: 1, in: { host: null, guest: null }, t: 0 };
const grid3 = () => Array.from({ length: 9 }, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]);

function makeSit({ role = 'solo', decor = [{ type: 'bench', x: 0, z: 0 }], tiles = grid3() } = {}) {
  const calls = [], emits = [], notices = [], awards = [], faces = [];
  const world = { tiles, decor };
  const ctx = {
    world, role, physics: { x: 0, y: 1.8, z: 1, vx: 1, vy: 0, vz: 1, grounded: true, swimming: false }, other: null, camera: null, raft: null,
    deckY: () => .2, uiOpen: () => false, emit: (e, to) => emits.push({ e, to }), notice: s => notices.push(s),
    award: ev => awards.push(ev), faceYaw: y => faces.push(y), vitals: { hp: 100 },
  };
  const mod = createSitting(ctx);
  ctx.action = a => { calls.push(a); if (role !== 'guest' && a.kind.startsWith('sit.')) mod.action(a, 'host'); };
  return { ctx, mod, calls, emits, notices, awards, faces, world };
}
const st = mod => mod.serialize();

// ---------------------------------------------------------------- 1. seatPoint
test('seatPoint: bench at origin, rotated, fractional', () => {
  const o = {};
  seatPoint({ type: 'bench', x: 0, z: 0 }, 0, o); near(o.x, -.36); near(o.z, .04); near(o.yaw, Math.PI);
  seatPoint({ type: 'bench', x: 0, z: 0 }, 1, o); near(o.x, .36); near(o.z, .04);
  seatPoint({ type: 'bench', x: 0, z: 0, rot: Math.PI / 2 }, 1, o); near(o.x, .04); near(o.z, -.36); near(o.yaw, 1.5 * Math.PI);
  seatPoint({ type: 'cushion', x: 1.25, z: -.5 }, 0, o); near(o.x, 2.5); near(o.z, -1);
  assert.equal(seatPoint({ type: 'bench', x: 0, z: 0 }, 0, o), o, 'reuses out');
  assert.deepEqual(Object.keys(SEATS).sort(), ['bench', 'cushion']);
  assert.equal(EYE.bench, 1.25); assert.equal(EYE.cushion, .95); assert.equal(REACH, 2.5); assert.equal(AWARD_S, 30);
});

test('findDecor matches by tolerance, seat types only', () => {
  const w = { decor: [{ type: 'crate', x: 0, z: 0 }, { type: 'bench', x: .3333, z: 0 }] };
  assert.equal(findDecor(w, 0, 0), null);
  assert.equal(findDecor(w, .3335, 0), w.decor[1]);
  assert.equal(findDecor(w, .34, 0), null);
  assert.equal(findDecor(null, 0, 0), null);
});

// ---------------------------------------------------------------- 2. clampYaw
test('clampYaw: inside null, outside clamped, wraps across +-pi', () => {
  assert.equal(clampYaw(Math.PI + .5, Math.PI), null);
  const s = 1, deg = Math.PI / 180;
  near(clampYaw(s + 150 * deg, s), s + YAW_LIM);
  near(clampYaw(s - 150 * deg, s), s - YAW_LIM);
  assert.equal(clampYaw(-3, 3), null);
  assert.equal(clampYaw(s + 2 * Math.PI + 10 * deg, s), null);
  assert.equal(clampYaw(NaN, s), null);
});

// ---------------------------------------------------------------- 3. cleanSit / load
test('cleanSit junk -> defaults; load(save) clears seats, keeps t', () => {
  for (const j of [null, undefined, 5, 'x', [], { in: 3 }, { in: { host: [1, 2, 5] }, t: -1 }, { in: { host: [NaN, 0, 0], guest: [61, 0, 0] }, t: Infinity }]) assert.deepEqual(cleanSit(j), DEFAULTS, JSON.stringify(j));
  assert.deepEqual(cleanSit({ in: { host: [.5, -1, 1], guest: null }, t: 12 }), { v: 1, in: { host: [.5, -1, 1], guest: null }, t: 12 });
  assert.equal(cleanSit({ t: 5e9 }).t, 1e9);
  const { mod } = makeSit();
  mod.load(undefined, 'save'); assert.deepEqual(st(mod), DEFAULTS);
  mod.load({ v: 1, in: { host: [0, 0, 0], guest: [0, 0, 1] }, t: 42 }, 'save');
  assert.deepEqual(st(mod), { v: 1, in: { host: null, guest: null }, t: 42 });
  assert.equal(mod.seated(), false);
});

// ---------------------------------------------------------------- 4. sit.down / sit.up
test('sit.down: refusals, free-seat fallback, accept, sit.up clears', () => {
  const { mod, ctx, emits } = makeSit({ decor: [{ type: 'bench', x: 0, z: 0 }, { type: 'cushion', x: 1, z: 0 }] });
  ctx.other = { x: 0, z: 1, swimming: false };
  mod.action({ kind: 'sit.down', x: 0, z: 1, seat: 0 }, 'guest');
  assert.equal(st(mod).in.guest, null, 'off seat'); assert.equal(emits.at(-1).to, 'guest');
  ctx.other = { x: 0, z: 6 }; mod.action({ kind: 'sit.down', x: 0, z: 0, seat: 0 }, 'guest');
  assert.equal(st(mod).in.guest, null); assert.equal(emits.at(-1).e.text, TEXT.reach);
  ctx.other = { x: 0, z: 1, swimming: true }; mod.action({ kind: 'sit.down', x: 0, z: 0, seat: 0 }, 'guest');
  assert.equal(st(mod).in.guest, null, 'swimming');
  mod.action({ kind: 'sit.down', x: 0, z: 0, seat: 2 }, 'host'); assert.equal(st(mod).in.host, null, 'bad seat index');
  // cushion held by the host -> guest refused
  ctx.physics.x = 2; ctx.physics.z = 1;
  mod.action({ kind: 'sit.down', x: 1, z: 0, seat: 0 }, 'host'); assert.deepEqual(st(mod).in.host, [1, 0, 0]);
  ctx.other = { x: 2, z: 1, swimming: false }; mod.action({ kind: 'sit.down', x: 1, z: 0, seat: 0 }, 'guest');
  assert.equal(st(mod).in.guest, null); assert.equal(emits.at(-1).e.text, TEXT.taken);
  // host moves to bench seat 0; guest asks for seat 0 and gets seat 1
  ctx.physics.x = 0; ctx.physics.z = 1;
  mod.action({ kind: 'sit.down', x: 0, z: 0, seat: 0 }, 'host'); assert.deepEqual(st(mod).in.host, [0, 0, 0], 'moved');
  ctx.other = { x: 0, z: 1, swimming: false }; mod.action({ kind: 'sit.down', x: 0, z: 0, seat: 0 }, 'guest');
  assert.deepEqual(st(mod).in.guest, [0, 0, 1]);
  mod.action({ kind: 'sit.up' }, 'guest'); assert.equal(st(mod).in.guest, null);
  assert.equal(mod.action({ kind: 'other' }, 'host'), false);
});

// ---------------------------------------------------------------- 5. host update
test('host update: decor gone clears seat, no guest clears guest, award once at 30 s', () => {
  const { mod, ctx, world, awards } = makeSit();
  ctx.other = { x: 0, z: 1 };
  mod.action({ kind: 'sit.down', x: 0, z: 0, seat: 0 }, 'host'); mod.action({ kind: 'sit.down', x: 0, z: 0, seat: 1 }, 'guest');
  mod.update(.1); assert.ok(st(mod).in.host && st(mod).in.guest);
  const bench = world.decor.pop(); mod.update(.1);
  assert.equal(st(mod).in.host, null); assert.equal(st(mod).in.guest, null);
  world.decor.push(bench);
  mod.action({ kind: 'sit.down', x: 0, z: 0, seat: 1 }, 'guest'); mod.update(.1); assert.ok(st(mod).in.guest);
  ctx.other = null; mod.update(.1); assert.equal(st(mod).in.guest, null);
  const b = makeSit(); b.mod.load({ t: 0 }, 'save');
  b.mod.action({ kind: 'sit.down', x: 0, z: 0, seat: 0 }, 'host');
  for (let i = 0; i < 30; i++) b.mod.update(1);
  b.mod.update(1); b.mod.update(1);
  assert.deepEqual(b.awards, [{ kind: 'sit' }]); near(st(b.mod).t, 32, 1e-9);
});

// ---------------------------------------------------------------- 6. ride
test('ride: pins to the seat, stands up on input, clamps yaw', () => {
  const { mod, ctx, calls, faces } = makeSit();
  const p = ctx.physics, inp = { forward: 0, strafe: 0, jump: false, yaw: Math.PI };
  assert.equal(mod.ride(p, .016, inp), false, 'not seated');
  assert.equal(mod.interact(null), false, 'no aim, no camera: nothing');
  mod.debug.sit(0, 0, 0); mod.update(.016);
  assert.equal(mod.seated(), true); near(faces.at(-1), Math.PI, 1e-9, 'faced the seat once');
  assert.equal(mod.ride(p, .016, inp), true);
  near(p.x, -.36); near(p.z, .04); near(p.y, .2 + 1.25); assert.equal(p.vx + p.vy + p.vz, 0); assert.equal(p.grounded, true);
  const n = faces.length;
  inp.yaw = Math.PI + 150 * Math.PI / 180; assert.equal(mod.ride(p, .016, inp), true);
  assert.equal(faces.length, n + 1); near(faces.at(-1), Math.PI + YAW_LIM);
  inp.yaw = Math.PI; inp.forward = 1;
  assert.equal(mod.ride(p, .016, inp), false);
  assert.equal(calls.at(-1).kind, 'sit.up');
  const s = standSpot(ctx.world, ctx.world.decor[0], 0, {}); near(p.x, s.x); near(p.z, s.z); near(p.y, .2 + 1.6);
  inp.forward = 0; mod.update(.016);
  assert.equal(mod.ride(p, .016, inp), false, 'next frame: standing'); assert.equal(mod.seated(), false);
  // E while seated stands up too
  mod.debug.sit(0, 0, 0); mod.update(.016); assert.equal(mod.seated(), true);
  assert.equal(mod.interact(null), true); assert.equal(mod.seated(), false); assert.equal(calls.at(-1).kind, 'sit.up');
  // cushion eye height
  const c = makeSit({ decor: [{ type: 'cushion', x: 0, z: 0 }] }); c.mod.debug.sit(0, 0, 0); c.mod.update(.016);
  c.mod.ride(c.ctx.physics, .016, { forward: 0, strafe: 0, jump: false, yaw: Math.PI }); near(c.ctx.physics.y, .2 + .95);
});

test('local: host clears my seat (bench removed) -> I stand at a fallback spot', () => {
  const { mod, ctx, world } = makeSit();
  mod.debug.sit(0, 0, 1); mod.update(.016); assert.equal(mod.seated(), true);
  world.decor.length = 0; world.tiles = world.tiles.filter(t => !(t[0] === 0 && t[1] === 0));
  mod.update(.016);
  assert.equal(mod.seated(), false); assert.ok(Number.isFinite(ctx.physics.x)); near(ctx.physics.y, 1.8);
});

test('guest: net load skips unchanged copies, old host notice, world change forgets the seat', () => {
  const g = makeSit({ role: 'guest' });
  g.mod.load(undefined, 'net');
  g.ctx.camera = { position: { x: 0, y: 1.8, z: 1.2 } };
  const aim = { dir: { x: -.36, y: .5 - 1.8, z: -1.16 } }; const l = Math.hypot(aim.dir.x, aim.dir.y, aim.dir.z); aim.dir.x /= l; aim.dir.y /= l; aim.dir.z /= l;
  assert.equal(g.mod.interact(aim), true); assert.equal(g.notices.at(-1), TEXT.oldHost); assert.equal(g.calls.length, 0);
  const s1 = { v: 1, in: { host: null, guest: [0, 0, 0] }, t: 1 };
  g.mod.load(s1, 'net'); const a = g.mod.serialize(); g.mod.load({ ...s1 }, 'net'); assert.equal(g.mod.serialize(), a, 'unchanged -> same object');
  g.mod.update(.016); assert.equal(g.mod.seated(), true);
  g.mod.load({ v: 1, in: { host: null, guest: [0, 0, 0] }, t: 1 }, 'restore'); assert.equal(g.mod.seated(), false);
  // fresh guest: aim at a free seat -> sit.down
  const h = makeSit({ role: 'guest' }); h.ctx.camera = g.ctx.camera;
  h.mod.load({ v: 1, in: { host: [0, 0, 0], guest: null }, t: 0 }, 'net');
  assert.equal(h.mod.prompt(aim), TEXT.beside);
  assert.equal(h.mod.interact(aim), true); assert.deepEqual(h.calls.at(-1), { kind: 'sit.down', x: 0, z: 0, seat: 1 });
  h.ctx.physics.grounded = false; h.mod.update(1);
  assert.equal(h.mod.interact(aim), true); assert.equal(h.notices.at(-1), TEXT.feet);
});

// ---------------------------------------------------------------- 7. standSpot
test('standSpot: front tile present -> front point; missing -> getUpSpot neighbour', () => {
  const d = { type: 'bench', x: 0, z: 0 }, o = {};
  standSpot({ tiles: grid3(), decor: [d] }, d, 0, o); near(o.x, -.36); near(o.z, .59);
  const tiles = [[0, 0], [1, 0]];
  standSpot({ tiles, decor: [{ type: 'bench', x: 0, z: .5 }] }, { type: 'bench', x: 0, z: .5 }, 0, o);
  assert.deepEqual(o, getUpSpot({ tiles, decor: [] }, 0, 1, {}));
  standSpot({ tiles, decor: [d] }, { type: 'bench', x: 0, z: 0, rot: Math.PI / 2 }, 0, o); near(o.x, .59); near(o.z, .36);
});

// ---------------------------------------------------------------- 8. registry
test('registry: ride is first-wins, seated is exposed', () => {
  const seen = [];
  const a = () => ({ name: 'a', ride: () => { seen.push('a'); return true; }, seated: () => true });
  const b = () => ({ name: 'b', ride: () => { seen.push('b'); return true; } });
  const none = () => ({ name: 'n', ride: () => { seen.push('n'); return false; } });
  const c1 = createContent({}, [a, b]);
  assert.equal(c1.ride({}, .016, {}), true); assert.deepEqual(seen, ['a']); assert.equal(c1.seated(), true);
  seen.length = 0; const c2 = createContent({}, [none, b]);
  assert.equal(c2.ride({}, .016, {}), true); assert.deepEqual(seen, ['n', 'b']); assert.equal(c2.seated(), false);
  seen.length = 0; const c3 = createContent({}, [none]); assert.equal(c3.ride({}, .016, {}), false);
});

test('decor pickup hooks: occupied seat vetoed, afterUndecor clears', () => {
  const { mod, ctx } = makeSit();
  const d = ctx.world.decor[0];
  assert.equal(mod.beforeUndecor(d, 'host'), null);
  mod.action({ kind: 'sit.down', x: 0, z: 0, seat: 0 }, 'host');
  assert.equal(mod.beforeUndecor(d, 'guest'), TEXT.occupied);
  assert.equal(mod.beforeUndecor({ type: 'crate', x: 0, z: 0 }, 'guest'), null);
  mod.afterUndecor(d, 'host'); assert.equal(st(mod).in.host, null);
});

// ---------------------------------------------------------------- 9. coop flags
test('coop pose flags: bit 16 seated, old bits unchanged', () => {
  assert.equal(poseFlags({ seated: true, grounded: true }) & 16, 16);
  assert.equal(poseFlags({ swimming: true, grounded: true, reeling: true }), 7);
  assert.deepEqual(readFlags(16 | 2), { swimming: false, grounded: true, reeling: false, seated: true });
  assert.equal(readFlags(2).seated, false);
});

// ---------------------------------------------------------------- 10. logbook
test('logbook: sit event grants sit1', () => {
  const w = { tiles: [], decor: [], fish: 0, collected: 0, items: [], notes: [], achievements: [] };
  assert.ok(evaluate(w, [], { kind: 'sit' }).includes('sit1'));
  assert.ok(!evaluate(w, [], { kind: 'note' }).includes('sit1'));
});

test('registry: while seated, E and the prompt go to the seated module first (review fix)', () => {
  const seen = [];
  let sat = true;
  const crate = () => ({ name: 'crate', interact: () => { seen.push('crate'); return true; }, prompt: () => '<kbd>E</kbd>Open crate' });
  const sit = () => ({ name: 'sit', seated: () => sat, interact: () => { seen.push('sit'); sat = false; return true; }, prompt: () => (sat ? 'Sitting' : null) });
  const c = createContent({}, [crate, sit]);
  assert.equal(c.prompt({}), 'Sitting');
  assert.equal(c.interact({}), true); assert.deepEqual(seen, ['sit'], 'seated module claims E before an earlier module');
  seen.length = 0;
  assert.equal(c.prompt({}), '<kbd>E</kbd>Open crate');
  assert.equal(c.interact({}), true); assert.deepEqual(seen, ['crate'], 'standing: normal order');
});

test('real module: E while seated stands up through the registry even with an earlier E module', () => {
  const s = makeSit();
  const crate = () => ({ name: 'crate', interact: () => true, prompt: () => '<kbd>E</kbd>Open crate' });
  const c = createContent(s.ctx, [crate, () => s.mod]);
  s.mod.action({ kind: 'sit.down', x: 0, z: 0, seat: 0 }, 'host'); s.mod.update(.016);
  assert.equal(c.seated(), true);
  assert.equal(c.prompt(null), TEXT.seated);
  assert.equal(c.interact(null), true);
  assert.equal(c.seated(), false);
  assert.equal(st(s.mod).in.host, null);
  assert.equal(s.ctx.physics.vx, 0); assert.equal(s.ctx.physics.grounded, true);
});
