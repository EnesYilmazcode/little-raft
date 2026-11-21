// Unit tests for the swimmer drift and raft leash (dist/swim-drift.js) against the sailing core.
// Run: node --test tests/swim-drift.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { SWIM, adrift, driftSwimmer, raftDistance, leashLevel, bearingTo, markerSpot } = await import(new URL('swim-drift.js', base));
const { SAIL, defaultSailing, stepSailing } = await import(new URL('sailing-core.js', base));
const { PLAYER_CONSTANTS } = await import(new URL('player-physics.js', base));
const { DIVE } = await import(new URL('diving.js', base));

const out = () => ({ dwx: 0, dwz: 0, dgx: 0, dgz: 0 });
// Step the raft for secs; the swimmer drifts each step exactly as sailing-world.js does. Returns the
// swimmer's displacement in raft space and over the seabed (raft-space motion + raft's seabed motion).
function sim(s, secs, opts, p, dt = 1 / 60) {
  const o = out(), x0 = p.x, z0 = p.z; let gx = 0, gz = 0;
  for (let i = 0, n = Math.round(secs / dt); i < n; i++) { stepSailing(s, dt, opts, o); driftSwimmer(p, o.dwx, o.dwz); gx += o.dgx; gz += o.dgz; }
  return { rx: p.x - x0, rz: p.z - z0, sx: p.x - x0 + gx, sz: p.z - z0 + gz };
}
const swimmer = (x = 3, z = 0) => ({ x, z, swimming: true, climbing: false });
const sailing = () => { const s = defaultSailing(); s.raised = true; s.windDir = s.heading = 0; s.windStr = SAIL.WIND_STEADY; return s; };

test('a sailing raft leaves a swimmer behind at the sail speed', () => {
  const s = sailing(), p = swimmer();
  sim(s, 40, { nSails: 1, host: true }, p); // reach cruise speed
  const r = sim(s, 10, { nSails: 1, host: true }, p);
  const v = SAIL.SAIL_SPEED * SAIL.WIND_STEADY; // ~1.17 m/s downwind, 1 sail
  assert.ok(Math.abs(-r.rz / 10 - v) < 0.02, `falls behind at ${-r.rz / 10}`);
  assert.ok(Math.abs(r.rx) < 1e-9);
  // Over the seabed the swimmer only drifts with the current (the water carries them, not the raft).
  assert.ok(Math.abs(r.sz / 10 - SAIL.CURRENT_Z) < 1e-6, `seabed drift ${r.sz / 10}`);
  // ... and can still catch up: swim speed beats the sail.
  assert.ok(PLAYER_CONSTANTS.SWIM_SPEED > v + 0.5);
});

test('current alone never carries the raft away from a swimmer', () => {
  const s = defaultSailing(), p = swimmer(); // sail down, not anchored: the raft drifts with the current
  const r = sim(s, 60, { nSails: 1, host: true }, p);
  assert.equal(r.rx, 0); assert.equal(r.rz, 0);
});

test('anchored: no drift, even with the sail up and an engine pushing', () => {
  const s = sailing(); s.anchored = true; const p = swimmer();
  const r = sim(s, 30, { nSails: 3, host: true, push: { x: 1, z: 1 } }, p);
  assert.equal(r.rx, 0); assert.equal(r.rz, 0);
});

test('engine and paddle motion drift the swimmer too; guest steps match', () => {
  const s = defaultSailing(), p = swimmer();
  const r = sim(s, 30, { nSails: 0, host: true, push: { x: 1, z: 0 } }, p);
  assert.ok(r.rx < -20, `engine leaves swimmer behind ${r.rx}`);
  const g = defaultSailing(), q = swimmer(); // guest: same synced state, host:false, same drift
  const rg = sim(g, 30, { nSails: 0, host: false, push: { x: 1, z: 0 } }, q);
  assert.ok(Math.abs(rg.rx - r.rx) < 1e-9);
});

test('only a free swimmer drifts', () => {
  assert.equal(adrift(null), false);
  assert.equal(adrift({ swimming: false }), false); // on deck / on sand: islands carry sand standers
  assert.equal(adrift({ swimming: true, climbing: true }), false);
  assert.equal(adrift({ swimming: true, mount: 'driftboard' }), false);
  const p = swimmer(1, 2);
  assert.equal(driftSwimmer(p, 0.5, -0.25), true); assert.equal(p.x, 0.5); assert.equal(p.z, 2.25);
  assert.equal(driftSwimmer(p, NaN, 1), false); assert.equal(driftSwimmer(p, 0, 0), false);
  const dry = { x: 1, z: 1, swimming: false };
  assert.equal(driftSwimmer(dry, 1, 1), false); assert.equal(dry.x, 1);
});

test('raft distance and leash thresholds', () => {
  const tiles = [[0, 0], [1, 0]], o = { x: 0, z: 0 };
  assert.equal(raftDistance(tiles, 0.5, 0.5, o), 0);
  assert.equal(raftDistance(tiles, 13, 0, o), 10); assert.equal(o.x, 3); assert.equal(o.z, 0);
  assert.equal(raftDistance([], 3, 4, o), 5);
  assert.equal(raftDistance([null, [NaN, 1], 'x'], 3, 4, o), 5);
  assert.equal(leashLevel(0), 0); assert.equal(leashLevel(SWIM.WARN - 0.01), 0);
  assert.equal(leashLevel(SWIM.WARN), 1); assert.equal(leashLevel(SWIM.LOST - 0.01), 1);
  assert.equal(leashLevel(SWIM.LOST), 2); assert.equal(leashLevel(NaN), 2);
  assert.ok(SWIM.WARN === 120 && SWIM.LOST === 400);
  // No silent snaps before the faint: the physics and dive leashes sit past LOST.
  assert.ok(PLAYER_CONSTANTS.MAX_RAFT_DISTANCE > SWIM.LOST && PLAYER_CONSTANTS.MAX_RAFT_DISTANCE >= SWIM.HARD);
  assert.ok(DIVE.MAX_DISTANCE > SWIM.LOST);
});

test('bearing and marker spot', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);
  near(bearingTo(0, 10, 0, 0, 0), 0);               // yaw 0 faces -z: raft at -z is ahead
  near(bearingTo(0, 0, 0, 5, 0), Math.PI / 2);       // +x is to the right
  near(Math.abs(bearingTo(0, 0, 0, 0, 5)), Math.PI); // behind
  near(bearingTo(0, 0, -Math.PI / 2, 5, 0), 0);      // yaw -pi/2 faces +x
  const m = { x: 0, y: 0, rot: 0 };
  markerSpot(0, 800, 600, m, 50); near(m.x, 400); near(m.y, 50); near(m.rot, 0);
  markerSpot(Math.PI / 2, 800, 600, m, 50); near(m.x, 750); near(m.y, 300); near(m.rot, 90);
  markerSpot(NaN, 800, 600, m, 50); near(m.x, 400);
});

test('swim back: a swimmer heading for the raft at swim speed closes the gap against a full sail', () => {
  const s = sailing(), p = swimmer(0, -30); // heading 0 sails toward +z, so a swimmer left behind is astern at -z
  s.vz = SAIL.SAIL_SPEED * SAIL.WIND_STEADY * 1.2; // cruising with 3 sails
  const o = out();
  for (let i = 0; i < 60 * 60 && p.z < -1; i++) { stepSailing(s, 1 / 60, { nSails: 3, host: true }, o); driftSwimmer(p, o.dwx, o.dwz); p.z += PLAYER_CONSTANTS.SWIM_SPEED / 60; }
  assert.ok(p.z >= -1, `caught up: ${p.z}`);
});
