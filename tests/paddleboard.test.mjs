// Driftboard (paddleboard) pure logic + registry hook (docs/specs/paddleboard.md, Tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const P = await import(new URL('paddleboard-core.js', base));
const { BOARD: B } = P;

const grid = (n = 3) => { const t = []; const h = (n - 1) / 2; for (let x = -h; x <= h; x++) for (let z = -h; z <= h; z++) t.push([x, z]); return t; };
const near = () => ({ d: 0, tx: 0, tz: 0, px: 0, pz: 0 });
const onAnyTile = (tiles, x, z, pad = 0) => tiles.some(([tx, tz]) => Math.abs(x - tx * 2) < 1 + pad && Math.abs(z - tz * 2) < 1 + pad);
const yawFor = h => h - Math.PI; // camera yaw whose view heading is h
const speedOf = st => Math.hypot(st.v, st.lat);

test('cleanSlice: garbage, cap, duplicates, non-finite, clamps, wrap, s, r and n', () => {
  for (const v of [undefined, null, 3, 'x', [], [1]]) assert.deepEqual(P.cleanSlice(v, 'save'), { v: 1, n: 1, boards: [] });
  const a = P.cleanSlice(undefined), b = P.cleanSlice(undefined);
  assert.notEqual(a, b); assert.notEqual(a.boards, b.boards); // fresh every time
  const boards = [
    { id: 1, x: 2, z: 3, h: 0, s: 'tied', r: null },
    { id: 1, x: 9, z: 9, h: 0, s: 'tied', r: null },        // duplicate id
    'junk', null, [1, 2],
    { id: 2, x: NaN, z: 0, h: 0, s: 'tied' },                 // non-finite
    { id: 3, x: 0, z: Infinity, h: 0, s: 'tied' },
    { id: 4, x: 0, z: 0, h: 'a', s: 'tied' },
    { id: 0, x: 0, z: 0, h: 0, s: 'tied' }, { id: 1.5, x: 0, z: 0, h: 0 }, // bad ids
    { id: 5, x: 100, z: -100, h: 7, s: 'flying', r: null },   // clamp, wrap, unknown s
    { id: 9, x: 1, z: 1, h: -Math.PI, s: 'tied', r: 'guest' }, // ridden
    { id: 7, x: 1, z: 1, h: 0, s: 'adrift', r: 'pirate' },
    { id: 8, x: 1, z: 1, h: 0, s: 'tied', r: null },          // over the cap of 4
  ];
  const s = P.cleanSlice({ v: 1, n: 2, boards }, 'save');
  assert.deepEqual(s.boards.map(b => b.id), [1, 5, 9, 7]);
  assert.equal(s.boards.length, B.MAX_BOARDS);
  const b5 = s.boards[1];
  assert.equal(b5.x, 45); assert.equal(b5.z, -45); assert.equal(b5.s, 'adrift');
  assert.ok(b5.h > -Math.PI && b5.h <= Math.PI); assert.ok(Math.abs(b5.h - (7 - 2 * Math.PI)) < 1e-9);
  assert.equal(s.boards[2].h, Math.PI); // -PI wraps into (-PI, PI]
  assert.equal(s.boards[2].r, null); assert.equal(s.boards[2].s, 'adrift'); // a ridden board is left adrift on save
  assert.equal(s.n, 10); // max(n, maxId + 1)
  const r = P.cleanSlice({ n: 2, boards }, 'restore'); assert.equal(r.boards[2].r, null);
  const net = P.cleanSlice({ n: 50, boards }, 'net');
  assert.equal(net.boards[2].r, 'guest'); assert.equal(net.boards[2].s, 'tied');
  assert.equal(net.boards[3].r, null); // unknown rider dropped
  assert.equal(net.n, 50);
  assert.equal(P.cleanSlice({ n: -3, boards: [] }).n, 1);
  assert.equal(P.cleanSlice({ boards: 'x' }).boards.length, 0);
});

test('wrapAngle / angDiff / headingOf', () => {
  assert.equal(P.wrapAngle(Math.PI), Math.PI); assert.equal(P.wrapAngle(-Math.PI), Math.PI);
  assert.ok(Math.abs(P.wrapAngle(3 * Math.PI) - Math.PI) < 1e-9);
  assert.ok(Math.abs(P.angDiff(3, -3) - (2 * Math.PI - 6)) < 1e-9);
  assert.equal(P.wrapAngle(NaN), 0);
  assert.ok(Math.abs(P.headingOf(Math.PI)) < 1e-9); // camera looking at +z: nose +z
});

test('stepRide: cruise, sprint, reverse, turn rate, coasting, dt clamp', () => {
  const avg = (sprint, secs = 20) => {
    const st = P.rideState(); let sum = 0, n = 0;
    for (let t = 0; t < secs; t += 1 / 60) { P.stepRide(st, { forward: 1, strafe: 0, sprint, yaw: yawFor(0) }, 1 / 60); if (t > 10) { sum += st.v; n++; } }
    return { v: sum / n, st };
  };
  const c = avg(false), s = avg(true);
  assert.ok(Math.abs(c.v - B.CRUISE) <= .2, `cruise ${c.v}`);
  assert.ok(Math.abs(s.v - B.SPRINT) <= .2, `sprint ${s.v}`);
  assert.ok(Math.abs(c.st.x) < 1e-6 && c.st.z > 50, 'moves along the nose');
  assert.ok(c.st.wraps >= 0 && (c.st.side === 1 || c.st.side === -1));
  // S brakes then reverses, never faster than BACK
  const st = c.st; let minV = Infinity;
  for (let i = 0; i < 600; i++) { P.stepRide(st, { forward: -1, yaw: yawFor(st.h) }, 1 / 60); minV = Math.min(minV, st.v); }
  assert.ok(st.v < 0 && minV >= -B.BACK - 1e-9, `reverse ${st.v}`);
  // heading eases toward the view at <= TURN rad/s
  const t = P.rideState(); t.v = 2; let prev = t.h, maxRate = 0;
  for (let i = 0; i < 60; i++) { P.stepRide(t, { forward: 1, yaw: yawFor(Math.PI / 2) }, 1 / 60); maxRate = Math.max(maxRate, Math.abs(P.angDiff(prev, t.h)) * 60); prev = t.h; }
  assert.ok(maxRate <= B.TURN + 1e-6, `turn ${maxRate}`);
  assert.ok(t.h > .9 && t.h < 1.7, `turned ${t.h}`);
  for (let i = 0; i < 120; i++) P.stepRide(t, { forward: 1, yaw: yawFor(Math.PI / 2) }, 1 / 60);
  assert.ok(Math.abs(t.h - Math.PI / 2) < 1e-6);
  // no turning while idle and slow
  const idle = P.rideState(); P.stepRide(idle, { forward: 0, yaw: yawFor(2) }, .2); assert.equal(idle.h, 0);
  // no input coasts to rest
  const co = avg(false).st;
  for (let i = 0; i < 60 * 30; i++) P.stepRide(co, { forward: 0, strafe: 0, yaw: yawFor(co.h) }, 1 / 60);
  assert.equal(co.v, 0); assert.equal(co.lat, 0);
  // A/D scull sideways at about SCULL
  const sc = P.rideState(); for (let i = 0; i < 120; i++) P.stepRide(sc, { forward: 0, strafe: 1, yaw: yawFor(0) }, 1 / 60);
  assert.ok(Math.abs(sc.lat - B.SCULL) < .05 && sc.x < -1, `scull ${sc.lat} ${sc.x}`);
  // dt clamped: a 10 s step does not teleport
  const big = P.rideState(); big.v = B.SPRINT; P.stepRide(big, { forward: 1, sprint: true, yaw: yawFor(0) }, 10);
  assert.ok(Math.hypot(big.x, big.z) < 1.5, `moved ${big.z}`);
  assert.ok([big.x, big.z, big.h, big.v, big.lat, big.ph].every(Number.isFinite));
  P.stepRide(big, { forward: NaN, yaw: NaN }, NaN); assert.ok(Number.isFinite(big.x));
});

test('tether: 0 below the soft limit, rising, 2 at the hard limit; a ride never passes 45 m', () => {
  assert.equal(P.tether(37), 0); assert.equal(P.tether(B.TETHER_SOFT), 0);
  let prev = 0; for (let d = 38.5; d <= 45; d += .5) { const t = P.tether(d); assert.ok(t >= prev); prev = t; }
  assert.equal(P.tether(45), B.TETHER_PUSH); assert.equal(P.tether(80), 2); assert.equal(P.tether(NaN), 0);
  const tiles = grid(3), st = P.rideState(), info = {}; st.x = 0; st.z = 4.6;
  let maxD = 0;
  for (let i = 0; i < 60 * 60; i++) { P.rideTick(st, { forward: 1, sprint: true, yaw: yawFor(0) }, 1 / 60, tiles, info); maxD = Math.max(maxD, info.d); }
  assert.ok(maxD <= B.TETHER_HARD + 1e-9 && maxD > 40, `max ${maxD}`);
  assert.ok(maxD < 50); // under PlayerPhysics MAX_RAFT_DISTANCE
});

test('pushOut: a board driven into the raft stays outside every tile and slides along the side; the nose collides too', () => {
  const tiles = grid(3), out = { x: 0, z: 0, nx: 0, nz: 0 };
  // rider circle overlapping the east side
  assert.equal(P.pushOut(tiles, { x: 3.2, z: 0, h: 0 }, out), true);
  assert.ok(out.x >= 3 + B.R - 1e-6 && Math.abs(out.nx - 1) < 1e-6, `x ${out.x}`);
  // nose circle only: board pointing west, centre 1.4 m out from the east edge
  assert.equal(P.pushOut(tiles, { x: 3 + 1.4, z: 0, h: -Math.PI / 2 }, out), true);
  assert.ok(out.x > 4.4 + .1, 'nose pushed back');
  assert.equal(P.pushOut(tiles, { x: 8, z: 0, h: 0 }, out), false);
  // drive diagonally into the hull from the north east: ends outside and slid along the side
  const st = P.rideState(), info = {}; st.x = 5; st.z = -3; st.h = -Math.PI / 2 + .35; st.v = 3;
  const z0 = st.z;
  for (let i = 0; i < 300; i++) {
    P.rideTick(st, { forward: 1, yaw: yawFor(-Math.PI / 2 + .35) }, 1 / 60, tiles, info);
    for (const k of [-1, 0, 1]) {
      const cx = st.x + Math.sin(st.h) * B.HALF_LEN * k, cz = st.z + Math.cos(st.h) * B.HALF_LEN * k;
      assert.ok(!onAnyTile(tiles, cx, cz, B.R - .02), `circle ${k} inside at step ${i}`);
    }
  }
  assert.ok(st.z - z0 > 1, `slid ${st.z - z0}`);
});

test('tieSpot / deckSpot', () => {
  const tiles = grid(3), out = { x: 0, z: 0, h: 0 };
  assert.equal(P.tieSpot([], 0, 0, [], 0, out), false);
  assert.equal(P.tieSpot(tiles, 5, .3, [], 0, out), true);
  assert.ok(Math.abs(out.x - (3 + B.R + .05)) < 1e-9 && Math.abs(out.z) < 1e-9 && out.h === 0, JSON.stringify(out));
  P.tieSpot(tiles, .4, -6, [], 0, out);
  assert.ok(Math.abs(out.z + 3 + B.R + .05) < 1e-9 && Math.abs(out.h - Math.PI / 2) < 1e-9, 'parallel to an x edge');
  // the chosen edge is an outer edge: stepping inward from the spot lands on a tile, outward does not
  assert.ok(onAnyTile(tiles, out.x, out.z + B.R + .1) && !onAnyTile(tiles, out.x, out.z - .5));
  // a second board picks a slot at least 1.2 m away
  P.tieSpot(tiles, 5, .3, [], 0, out); const first = { id: 1, x: out.x, z: out.z, h: out.h, s: 'tied', r: null };
  const o2 = { x: 0, z: 0, h: 0 }; P.tieSpot(tiles, 5, .3, [first], 2, o2);
  assert.ok(Math.hypot(o2.x - first.x, o2.z - first.z) >= B.TIE_GAP, JSON.stringify(o2));
  assert.ok(Math.abs(o2.x - first.x) < 1e-9, 'same side, next tile');
  P.tieSpot(tiles, 5, .3, [first], 1, o2); assert.ok(Math.hypot(o2.x - first.x, o2.z - first.z) < 1e-9, 'its own slot is free');
  // deckSpot: inside a tile, inset from the edge
  const d = { x: 0, z: 0 };
  assert.equal(P.deckSpot([], 0, 0, d), false);
  assert.equal(P.deckSpot(tiles, 3.6, .2, d), true);
  assert.ok(onAnyTile(tiles, d.x, d.z) && Math.abs(d.x - 2.55) < 1e-9 && Math.abs(d.z - .2) < 1e-9, JSON.stringify(d));
  P.deckSpot(tiles, 3.6, 3.6, d); assert.ok(d.x <= 2.7 + 1e-9 && d.z <= 2.7 + 1e-9, 'clamped like _beginClimb');
});

test('canLaunch', () => {
  const tiles = grid(3);
  assert.notEqual(P.canLaunch(tiles, 0, 0, 1, 1), '');         // on a tile
  assert.notEqual(P.canLaunch(tiles, 2, 0, 6.5, 0), '');       // 3.5 m from the edge
  assert.notEqual(P.canLaunch(tiles, -2, 0, 4, 0), '');        // 6 m from the player
  assert.equal(P.canLaunch(tiles, 2, 0, 4, 0), '');
  assert.notEqual(P.canLaunch([], 0, 0, 1, 0), '');
  assert.notEqual(P.canLaunch(tiles, 2, 0, NaN, 0), '');
});

test('homeStep: an adrift board comes home and ties within ~55 s; no tiles stays adrift', () => {
  const tiles = grid(3), b = { id: 1, x: 0, z: 23, h: 1, s: 'adrift', r: null }, boards = [b];
  let t = 0;
  while (b.s === 'adrift' && t < 120) { P.homeStep(b, tiles, .25, boards); t += .25; }
  assert.equal(b.s, 'tied'); assert.ok(t <= 55, `took ${t}`);
  assert.ok(Math.abs(b.z - (3 + B.R + .05)) < 1e-9, 'tied at the south edge');
  assert.equal(P.homeStep(b, tiles, .25, boards), 'tied');
  const lone = { id: 2, x: 5, z: 5, h: 0, s: 'adrift', r: null };
  for (let i = 0; i < 100; i++) assert.equal(P.homeStep(lone, [], .25, [lone]), 'adrift');
  assert.ok([lone.x, lone.z, lone.h].every(Number.isFinite)); assert.equal(lone.x, 5);
});

test('guard: recipe ingredients, item entry and sprite', async () => {
  const SR = await import(new URL('storage-research.js', base));
  const { CONTENT_ITEMS, CONTENT_RECIPES, CONTENT_DECOR, CONTENT_BLOCK_RADIUS } = await import(new URL('content-items.js', base));
  const r = CONTENT_RECIPES.driftboard;
  assert.deepEqual({ ...r.cost }, { wood: 6, plastic: 3, rope: 2 });
  const ing = SR.ingredientKinds();
  for (const k of Object.keys(r.cost)) assert.ok(ing.includes(k), k);
  assert.ok(!ing.includes('driftboard'));
  assert.equal(CONTENT_ITEMS.driftboard.maxStack, 1); assert.equal(CONTENT_ITEMS.driftboard.icon, 'icon-driftboard');
  assert.ok(!CONTENT_DECOR.includes('driftboard') && !('driftboard' in CONTENT_BLOCK_RADIUS));
  assert.deepEqual(SR.learnedFrom(['wood', 'plastic', 'rope']).includes('driftboard'), true);
  const ui = readFileSync(new URL('survival-ui.js', base), 'utf8');
  assert.match(/const SPRITES = new Set\(\[([\s\S]*?)\]\)/.exec(ui)[1], /'driftboard'/);
  assert.match(readFileSync(new URL('icons.svg', base), 'utf8'), /<symbol id="icon-driftboard"/);
  const content = readFileSync(new URL('content.js', base), 'utf8');
  const order = /const FEATURES = \[([^\]]*)\]/.exec(content)[1].split(',').map(x => x.trim());
  const at = order.indexOf('createPaddleboard');
  assert.ok(at > order.indexOf('createIslands') && at > order.indexOf('createSleep'), 'after the sand and bed snaps');
  assert.equal(order.at(-1), 'createCookpot', 'cookpot stays last');
});

test('registry: ride() and riding() reach the module', async () => {
  const { createContent } = await import(new URL('content.js', base));
  let on = false, got = null;
  const fake = () => ({ name: 'fake', ride(dt, p, inp) { got = [dt, p, inp]; return on ? 1 : 0; }, riding: () => on });
  const c = createContent({}, [fake]);
  const p = {}, inp = { forward: 1 };
  assert.equal(c.ride(.1, p, inp), false); assert.equal(c.riding(), false);
  assert.deepEqual(got, [.1, p, inp]);
  on = true;
  assert.equal(c.ride(.1, p, inp), true); assert.equal(c.riding(), true);
  const empty = createContent({}, []);
  assert.equal(empty.ride(.1, p, inp), false); assert.equal(empty.riding(), false);
});
