// Movement dynamics: the stack game.js runs (MoveFeel -> PlayerPhysics substeps -> controls stop brake),
// measured through tests/movement-probe.mjs at 30, 60 and 144 fps, plus RaftRide (raft-local camera).
// Run: node --test tests/movement-dynamics.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { probe } from './movement-probe.mjs';

const dir = process.env.RAFT_DIST ? resolve(process.env.RAFT_DIST) : fileURLToPath(new URL('../dist/', import.meta.url));
const base = pathToFileURL(dir + '/').href;
const { PlayerPhysics, PLAYER_CONSTANTS: PC, RaftRide, tiltOffset, RIDE } = await import(new URL('player-physics.js', base));
const T = await import(new URL('vendor/three.module.js', base));
const M = await probe(dir);
const FPS = [30, 60, 144];
const spread = k => { const v = FPS.map(f => M[f][k]); return (Math.max(...v) - Math.min(...v)) / Math.max(...v.map(Math.abs)); };

test('ground start is quick but not instant, at every frame rate', () => {
  for (const f of FPS) {
    assert.ok(M[f].walkT90 >= 0.08 && M[f].walkT90 <= 0.2, `${f}fps walk t90 ${M[f].walkT90}`);
    assert.ok(M[f].walkT95 <= 0.22, `${f}fps walk t95 ${M[f].walkT95}`);
    assert.ok(Math.abs(M[f].walkTop - PC.WALK_SPEED) < 1e-6 && Math.abs(M[f].sprintTop - PC.SPRINT_SPEED) < 1e-6);
  }
});

test('stopping on the ground is crisp with a little slide', () => {
  for (const f of FPS) {
    assert.ok(M[f].stopDist > 0.03 && M[f].stopDist < 0.12, `${f}fps stop ${M[f].stopDist} m`);
    assert.ok(M[f].stopTime <= 0.15, `${f}fps stop time ${M[f].stopTime}`);
    assert.ok(M[f].sprintStopDist < 0.2, `${f}fps sprint stop ${M[f].sprintStopDist} m`);
  }
});

test('sprint is a clear step up from walking', () => {
  assert.ok(PC.SPRINT_SPEED / PC.WALK_SPEED >= 1.6);
});

test('air control is reduced but present', () => {
  for (const f of FPS) assert.ok(M[f].airLateral > 0.3 && M[f].airLateral < 0.85, `${f}fps air lateral ${M[f].airLateral}`);
});

test('jump height matches v^2/2g and is the same at any frame rate', () => {
  const ideal = PC.JUMP_IMPULSE ** 2 / (2 * PC.GRAVITY);
  for (const f of FPS) assert.ok(Math.abs(M[f].jumpApex - ideal) < 0.01, `${f}fps apex ${M[f].jumpApex}`);
  assert.ok(spread('jumpApex') < 0.01);
});

test('a jump pressed just after walking off the edge still jumps (coyote time)', () => {
  for (const f of FPS) assert.equal(M[f].edgeJumpLate60ms, 1, `${f}fps`);
  // ...but not long after, and never as a second jump in the air.
  const tiles = [[0, 0]], inp = (o = {}) => ({ tiles, deckY: 0.2, waterY: -0.24, ...o });
  const late = new PlayerPhysics({ x: 0, y: 1.8, z: 0 });
  late.update(1 / 60, inp());
  let off = -1;
  for (let k = 0; k < 120; k++) {
    const t = off < 0 ? 0 : (k - off) / 60;
    late.update(1 / 60, inp({ forward: 1, jump: t >= 0.2 && t < 0.3 }));
    if (off < 0 && !late.grounded) off = k;
    if (t >= 0.2 && !late.swimming && !late.climbing) assert.ok(late.vy <= 0, 'no jump 0.2 s after leaving the deck');
  }
  const air = new PlayerPhysics({ x: 0, y: 1.8, z: 0 });
  air.update(1 / 60, inp());
  air.update(1 / 60, inp({ jump: true }));
  for (let k = 0; k < 4; k++) air.update(1 / 60, inp({ jump: false }));
  const vy = air.vy;
  air.update(1 / 60, inp({ jump: true }));
  assert.ok(air.vy < vy, 'a second press in the air does nothing');
});

test('ground reversal is quick: decelerating uses the stronger ground rate', () => {
  const tiles = []; for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) tiles.push([x, z]);
  const p = new PlayerPhysics({ x: 0, y: 1.8, z: 0 });
  for (let k = 0; k < 60; k++) p.update(1 / 60, { tiles, forward: 1 });
  let t = 0;
  while (p.vz < 0 && t < 1) { p.update(1 / 60, { tiles, forward: -1 }); t += 1 / 60; }
  assert.ok(t <= 0.1, `reversed in ${t.toFixed(3)} s`);
});

test('swimming: buoyancy rides the swell, settles fast, and matches across frame rates', () => {
  for (const f of FPS) {
    assert.ok(Math.abs(M[f].swimSpeed - PC.SWIM_SPEED) < 1e-6);
    assert.ok(M[f].swimEyeSd < 0.06, `${f}fps eye sd ${M[f].swimEyeSd}`);
    assert.ok(M[f].splashSettle !== null && M[f].splashSettle < 0.8, `${f}fps settle ${M[f].splashSettle}`);
  }
  assert.ok(spread('splashDunk') < 0.15, 'splash dunk spread');
  assert.ok(spread('splashSettle') < 0.08, 'settle spread');
  assert.ok(spread('swimEyeSd') < 0.1, 'bob spread');
});

test('climbing out: holding Space while swimming at the raft always gets aboard', () => {
  for (const f of FPS) {
    assert.equal(M[f].climbJump, 1, `${f}fps`);
    assert.ok(M[f].climbJumpTime < 1.2, `${f}fps climb time ${M[f].climbJumpTime}`);
  }
});

test('tiltOffset matches three.js raft.localToWorld', () => {
  const g = new T.Group(), v = new T.Vector3(), o = {};
  for (const [rx, rz] of [[0.04, -0.03], [-0.12, 0.08], [0, 0.2], [0.3, 0]]) {
    g.position.set(0, 0.37, 0); g.rotation.set(rx, 0, rz); g.updateMatrixWorld(true);
    for (const [x, y, z] of [[3.2, 0.2, -2.6], [-5, 3.4, 1], [0, 0, 0]]) {
      v.set(x, y, z); g.localToWorld(v);
      tiltOffset(rx, rz, x, y, z, o);
      assert.ok(Math.abs(x + o.x - v.x) < 1e-12 && Math.abs(y + 0.37 + o.y - v.y) < 1e-12 && Math.abs(z + o.z - v.z) < 1e-12);
    }
  }
});

test('standing on a pitching, rolling raft: zero motion in the raft frame at any fps', () => {
  for (const f of FPS) {
    assert.ok(M[f].raftLocalSd < 1e-4, `${f}fps local sd ${M[f].raftLocalSd}`);
    assert.ok(M[f].raftLocalJerk < 1e-5, `${f}fps local jerk ${M[f].raftLocalJerk}`);
  }
});

test('RaftRide: rides only while aboard and blends out smoothly in the water', () => {
  const tiles = [[0, 0], [1, 0]], r = new RaftRide(), o = { x: 0, y: 0, z: 0 };
  const deck = new PlayerPhysics({ x: 2.5, y: 0.3 + 0.2 + PC.EYE_OFFSET, z: 0.5 });
  r.update(1 / 60, deck, 0.3, 0.05, 0.05, tiles, 0.2, o);
  assert.equal(r.weight, 1);
  assert.ok(o.y > 0.08, `deck lifts the player at x=2.5 (${o.y})`);
  const swim = new PlayerPhysics({ x: 2.5, y: -0.1, z: 0.5, swimming: true }); // same spot, now in the water
  let prev = o.y, maxStep = 0;
  for (let k = 0; k < 60; k++) { r.update(1 / 60, swim, 0.3, 0.05, 0.05, tiles, 0.2, o); maxStep = Math.max(maxStep, Math.abs(o.y - prev)); prev = o.y; }
  assert.ok(r.weight < 0.01, 'blended out');
  assert.ok(maxStep < 0.02, `no pop (${maxStep})`);
  const fresh = new RaftRide();
  fresh.update(1 / 60, swim, 0.3, 0.05, 0.05, tiles, 0.2, o);
  assert.deepEqual([fresh.weight, o.x, o.y, o.z], [0, 0, 0, 0]);
  fresh.update(NaN, null, NaN, NaN, NaN, null, NaN, o);
  assert.ok([o.x, o.y, o.z].every(Number.isFinite));
  assert.ok(RIDE.WEIGHT_RATE > 0);
});

test('capture() round-trips with the new state (save/load and coop unchanged)', () => {
  const p = new PlayerPhysics({ x: 0, y: 1.8, z: 0 });
  for (let k = 0; k < 20; k++) p.update(1 / 60, { tiles: [[0, 0]], forward: 1 });
  const keys = Object.keys(p.capture()).sort();
  assert.deepEqual(keys, ['climbProgress', 'climbing', 'grounded', 'swimming', 'verticalSpeed', 'vx', 'vy', 'vz', 'x', 'y', 'z']);
});
