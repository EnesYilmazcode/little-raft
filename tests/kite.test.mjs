import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LINES, STEER_MAX, TUG_T, LINE_N, TAIL_N, windOf, kitePose, easeInputs, steerFromYaw, anchorOf, pieceKey, cleanKite,
  spotDue, pickDebris, linePoints, tailPoints } from '../dist/kite-core.js';

const W = (s, az = 0) => ({ s, az });
const pose = (o = {}) => kitePose(o.ax ?? 0, o.ay ?? 3, o.az ?? 0, o.W ?? W(0.9), o.L ?? 16, o.steer ?? 0, o.tug ?? 0, o.launch ?? 1, o.t ?? 0, o.phase ?? 0, o.water ?? 0, { dSteer: 0 });

test('kite windOf: apparent wind, min clamp, bounded strength, fallbacks', () => {
  const still = windOf({ windDir: 0, windStr: 0.8, vx: 0, vz: 0 }, 0.5, {});
  const run = windOf({ windDir: 0, windStr: 0.8, vx: 0.6, vz: 0 }, 0.5, {});
  assert.ok(Math.abs(still.az) < 1e-9);
  assert.ok(run.az < 0, 'raft running +x swings the apparent wind toward -x');
  const tiny = windOf({ windDir: 0, windStr: 0.8, vx: 0, vz: 0.79 }, 0, {});
  assert.ok(Math.abs(tiny.az) < 1e-9 && Math.abs(tiny.s - 0.3) < 1e-9);
  const zero = windOf({ windDir: 0, windStr: 0.8, vx: 0, vz: 0.8 }, 0, {});
  assert.ok(Number.isFinite(zero.az) && zero.s >= 0.3);
  for (const w of [0, 0.15, 0.7, 1, 50]) { const r = windOf({ windDir: 1, windStr: 1, vx: -3, vz: 0 }, w, {}); assert.ok(r.s >= 0.3 && r.s <= 1.25); }
  assert.ok(windOf({ windDir: 0.6, windStr: 0.8 }, 0.15, {}).s < windOf({ windDir: 0.6, windStr: 0.8 }, 0.7, {}).s);
  const fb = windOf({ windDir: NaN, windStr: 'x', vx: NaN }, NaN, {}), ref = windOf({ windDir: 0.6, windStr: 0.8, vx: 0, vz: 0 }, 0.5, {});
  assert.ok(Math.abs(fb.az - ref.az) < 1e-9 && Math.abs(fb.s - ref.s) < 1e-9);
  assert.ok(Number.isFinite(windOf(null, undefined, {}).s));
});

test('kite kitePose: deterministic, line length, elevation, water clamp, finite', () => {
  const a = pose({ t: 3.3, phase: 1 }), b = pose({ t: 3.3, phase: 1 });
  assert.deepEqual(a, b);
  for (const L of LINES) { const p = pose({ L }); assert.ok(Math.abs(Math.hypot(p.x, p.y - 3, p.z) - L) < 1); }
  assert.ok(pose({ W: W(1.2) }).e > pose({ W: W(0.4) }).e);
  assert.ok(pose({ steer: 0.9 }).e < pose({ steer: 0 }).e);
  assert.ok(pose({ steer: -0.9 }).e < pose({ steer: 0 }).e);
  assert.ok(pose({ W: W(0.3), launch: 0, ay: -10, water: 0 }).y >= 2);
  const k = pose({ L: 24 }); assert.ok(k.z > 10, 'downwind of the anchor');
  for (const o of [{ L: NaN, steer: Infinity, t: NaN }, { W: null, launch: NaN }, { ax: NaN, L: 1e9, t: 1e12, tug: 99 }]) {
    const p = pose(o); for (const key of ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'e']) assert.ok(Number.isFinite(p[key]), key);
  }
});

test('kite easeInputs: frame-rate independent, reel speed, launch, landing, tug', () => {
  const mk = () => ({ L: 8, Lt: 24, steer: 0, steerT: 0.8, launch: 0, tug: 0.25 });
  const a = mk(), b = mk();
  easeInputs(a, 1); for (let i = 0; i < 100; i++) easeInputs(b, 0.01);
  for (const k of ['L', 'steer', 'launch', 'tug']) assert.ok(Math.abs(a[k] - b[k]) <= 0.02 * Math.max(1, Math.abs(a[k])), k);
  const c = { L: 8, Lt: 24 }; easeInputs(c, 1); assert.ok(c.L <= 10 + 1e-9);
  const d = { L: 6, Lt: 16, launch: 0 }; for (let i = 0; i < 30; i++) easeInputs(d, 0.1); assert.equal(d.launch, 1);
  const e = { L: 16, Lt: 16, launch: 1, landing: 1 }; let done = false;
  for (let i = 0; i < 9; i++) assert.equal(easeInputs(e, 0.1), false);
  for (let i = 0; i < 3 && !done; i++) done = easeInputs(e, 0.1);
  assert.ok(done && e.launch === 0);
  const f = { Lt: 16, tug: 0.25 }; for (let i = 0; i < 12; i++) easeInputs(f, TUG_T / 12 + 1e-6); assert.equal(f.tug, 0);
});

test('kite steerFromYaw: clamps, holds upwind, left steers left', () => {
  const az = 0; // wind toward +z; the camera looks down -z, so yaw PI looks downwind
  assert.ok(Math.abs(steerFromYaw(Math.PI, az, 0.3)) < 1e-9);
  assert.equal(steerFromYaw(Math.PI + 1.4, az, 0), STEER_MAX);
  assert.equal(steerFromYaw(Math.PI - 1.4, az, 0), -STEER_MAX);
  assert.equal(steerFromYaw(0, az, 0.35), 0.35, 'looking upwind holds');
  // facing +z, left is +x (azimuth +): looking a little to the left steers positive (toward +x)
  const s = steerFromYaw(Math.PI + 0.4, az, 0); assert.ok(s > 0);
  const lookX = -Math.sin(Math.PI + 0.4); assert.ok(lookX > 0, 'that look points toward +x, the left of a viewer facing +z');
});

test('kite anchorOf: edges, pillar, levels, non-tie types', () => {
  assert.deepEqual(anchorOf({ t: 'railing', i: 1, j: 2, l: 0, r: 0 }, 1), { x: 2, y: 1.95, z: 3 });
  assert.deepEqual(anchorOf({ t: 'railing', i: 1, j: 2, l: 0, r: 1 }, 1), { x: 1, y: 1.95, z: 4 });
  const p = anchorOf({ t: 'pillar', i: 0, j: 0, l: 1, r: 0 }, 0); assert.equal(p.x, -1); assert.equal(p.z, -1); assert.ok(Math.abs(p.y - 4.2) < 1e-9);
  assert.ok(Math.abs(anchorOf({ t: 'halfwall', i: 0, j: 0, l: 0, r: 0 }, 0).y - 1.1) < 1e-9);
  assert.equal(anchorOf({ t: 'floor', i: 0, j: 0, l: 0, r: 0 }, 0), null);
  assert.equal(anchorOf(null, 0), null);
  assert.equal(pieceKey({ t: 'gate', i: -1, j: 2, l: 0, r: 1 }), 'gate:-1,2,0,1');
});

test('kite cleanKite: junk, bad entries, dupes, cap, fly only from net, rev', () => {
  const empty = { v: 1, rev: 0, fly: { h: null, g: null }, tied: [] };
  for (const j of [null, 3, 'x', [], { tied: 'no' }]) assert.deepEqual(cleanKite(j), empty);
  const good = { k: 'railing:0,1,0,0', p: 1, L: 24, s: 0.3 };
  const c = cleanKite({ rev: 4, tied: [good, { ...good }, { ...good, k: 'floor:0,0,0,0' }, { ...good, k: 'railing:0,2,0,0', p: 3 }, { ...good, k: 'railing:0,3,0,0', L: 12 },
    { ...good, k: 'railing:0,4,0,0', s: 1.2 }, { ...good, k: 'pillar:9,9,0,0' }, 7] });
  assert.deepEqual(c.tied.map(e => e.k), ['railing:0,1,0,0', 'pillar:9,9,0,0']);
  const many = cleanKite({ tied: Array.from({ length: 9 }, (_, i) => ({ ...good, k: 'pillar:' + i + ',0,0,0' })) });
  assert.equal(many.tied.length, 6);
  const fly = { h: { p: 0, L: 16, s: 0.11 }, g: { p: 9, L: 16, s: 0 } };
  assert.deepEqual(cleanKite({ fly }).fly, { h: null, g: null });
  const n = cleanKite({ fly }, 'net'); assert.deepEqual(n.fly.h, { p: 0, L: 16, s: 0.1 }); assert.equal(n.fly.g, null);
  assert.equal(cleanKite({ rev: 5e9 }).rev, 1e9); assert.equal(cleanKite({ rev: -3 }).rev, 0); assert.equal(cleanKite({ rev: 2.7 }).rev, 2);
});

test('kite spotDue: deterministic, within 90..150', () => {
  for (let n = 0; n < 200; n++) { const a = spotDue(0, n, 7.31); assert.equal(a, spotDue(99, n, 7.31)); assert.ok(a >= 90 && a <= 150); }
  assert.notEqual(spotDue(0, 0, 1), spotDue(0, 1, 1));
});

test('kite pickDebris: types, held tokens, range, nearest', () => {
  const items = [
    { token: 'a', type: 'cache', x: 20, z: 0 }, { token: 'b', type: 'bottle', x: 20, z: 1 }, { token: 'c', type: 'mystery', x: 21, z: 0 },
    { token: 'd', type: 'wood', x: 10, z: 0 }, { token: 'e', type: 'leaf', x: 0, z: 30 }, { token: 'f', type: 'barrel', x: 0, z: -25 },
    { token: 'g', type: 'scrap', x: 80, z: 0 },
  ];
  assert.equal(pickDebris(items, null, 0, 0, {}).token, 'f');
  assert.equal(pickDebris(items, new Set(['f']), 0, 0, null).token, 'e');
  assert.equal(pickDebris(items, new Set(['f', 'e']), 0, 0, null), null);
  assert.equal(pickDebris([], null, 0, 0), null);
  assert.equal(pickDebris(null, null, 0, 0), null);
});

test('kite linePoints and tailPoints: endpoints, sag, finite', () => {
  const A = { x: 0, y: 2, z: 0 }, K = { x: 0, y: 14, z: 20 }, out = new Float32Array(LINE_N * 3);
  linePoints(A, K, 24, 0.5, out);
  assert.deepEqual([...out.slice(0, 3)], [0, 2, 0]);
  assert.deepEqual([...out.slice(-3)], [0, 14, 20]);
  const mid = (LINE_N - 1) / 2; assert.ok(out[mid * 3 + 1] < (A.y + K.y) / 2 - 0.5);
  const t = new Float32Array(TAIL_N * 3); tailPoints(K, { az: 0, s: 1 }, 2, t);
  assert.deepEqual([...t.slice(0, 3)], [0, 14, 20]);
  assert.ok(t[t.length - 1] > 20, 'tail trails downwind');
  for (const x of [...out, ...t]) assert.ok(Number.isFinite(x));
  tailPoints(K, null, NaN, t); for (const x of t) assert.ok(Number.isFinite(x));
});

test('kite coop HELD append keeps the old wire indices', () => {
  const src = readFileSync(new URL('../dist/coop.js', import.meta.url), 'utf8');
  const m = /export const HELD = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(src);
  assert.ok(m);
  const HELD = m[1].replace(/\/\/[^\n]*/g, '').split(',').map(s => s.trim()).filter(Boolean).map(s => (s === 'null' ? null : s.replace(/'/g, '')));
  assert.equal(HELD.indexOf('metalspear'), 20);
  for (const k of ['kite_sunburst', 'kite_gullwing', 'kite_tidestripe']) assert.ok(HELD.includes(k), k);
  assert.ok(HELD.indexOf('kite_tidestripe') === HELD.length - 1 || HELD.indexOf('kite_tidestripe') > 20);
});
