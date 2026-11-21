import test from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, NAMES, MODES, RING, MAX_MS, MIN_SPEED, bbox, clearOf, nearestTile, makeCourse, crossGate, pathLength, minMs, addBest, cleanName, cleanCourse, fmt, gateHash, validFinish } from '../dist/buoycourse-core.js';

const G = [0, 0, 0]; // gate at origin facing +z
const P = (x, y, z) => ({ x, y, z });

test('crossGate: through the centre, reverse, parallel, lateral', () => {
  assert.equal(crossGate(P(0, .45, -1), P(0, .45, 1), G, 0), true);
  assert.equal(crossGate(P(0, .45, 1), P(0, .45, -1), G, 0), false);
  assert.equal(crossGate(P(-1, .45, .5), P(1, .45, .5), G, 0), false);
  assert.equal(crossGate(P(-1, .45, -.5), P(1, .45, -.5), G, 0), false);
  assert.equal(crossGate(P(1.55, .45, -1), P(1.55, .45, 1), G, 0), true);
  assert.equal(crossGate(P(-1.55, .45, -1), P(-1.55, .45, 1), G, 0), true);
  assert.equal(crossGate(P(1.7, .45, -1), P(1.7, .45, 1), G, 0), false);
  // a rotated gate facing +x
  const g = [5, 3, Math.PI / 2];
  assert.equal(crossGate(P(4, 0, 3), P(6, 0, 3), g, 0), true);
  assert.equal(crossGate(P(6, 0, 3), P(4, 0, 3), g, 0), false);
});

test('crossGate: heights, board band, teleport, NaN, plane edges', () => {
  const w = .3;
  assert.equal(crossGate(P(0, w - 1.7, -1), P(0, w - 1.7, 1), G, w), false);
  assert.equal(crossGate(P(0, w - 1.5, -1), P(0, w - 1.5, 1), G, w), true);
  assert.equal(crossGate(P(0, w + 1.6, -1), P(0, w + 1.6, 1), G, w), false);
  assert.equal(crossGate(P(0, w + 1.6, -1), P(0, w + 1.6, 1), G, w, RING.YHI_BOARD), true);
  assert.equal(crossGate(P(0, w + 1.9, -1), P(0, w + 1.9, 1), G, w, RING.YHI_BOARD), true);
  assert.equal(crossGate(P(0, w + 2.1, -1), P(0, w + 2.1, 1), G, w, RING.YHI_BOARD), false);
  assert.equal(crossGate(P(0, .45, -2), P(0, .45, 2), G, 0), false); // 4 m in one frame
  assert.equal(crossGate(P(0, .45, -1.4), P(0, .45, 1.4), G, 0), true);
  assert.equal(crossGate(P(NaN, .45, -1), P(0, .45, 1), G, 0), false);
  assert.equal(crossGate(P(0, .45, -1), P(0, .45, 1), [0, 0, NaN], 0), false);
  assert.equal(crossGate(P(0, .45, -1), P(0, .45, 1), G, NaN), false);
  assert.equal(crossGate(P(0, .45, 0), P(0, .45, 1), G, 0), false); // starts on the plane
  assert.equal(crossGate(P(0, .45, -1), P(0, .45, 0), G, 0), true); // ends on the plane
  assert.equal(crossGate(null, P(0, 0, 0), G, 0), false);
});

const rect = (w, h, ox = 0, oz = 0) => { const t = []; for (let x = 0; x < w; x++) for (let z = 0; z < h; z++) t.push([x + ox, z + oz]); return t; };
const RAFTS = {
  one: [[0, 0]],
  three: rect(3, 3, -1, -1),
  sixTwo: rect(6, 2, -2, 0),
  ell: [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2], [0, 3]],
};
const COUNT = { loop: 7, sprint: 5, zigzag: 6, eight: 9 };
const FLAGS = { one: [0, 0], three: [1, 0], sixTwo: [-2, 1], ell: [0, 3] };

test('makeCourse: counts and bounds for every shape and raft', () => {
  for (const [name, tiles] of Object.entries(RAFTS)) {
    for (const shape of SHAPES) {
      const g = makeCourse(shape, tiles, FLAGS[name]);
      assert.ok(g, `${shape} ${name}`);
      assert.equal(g.length, COUNT[shape], `${shape} ${name}`);
      for (const [x, z, yaw] of g) {
        const d = nearestTile(tiles, x, z);
        assert.ok(d >= 4 && d <= 20, `${shape} ${name} gate ${x},${z} at ${d}`);
        assert.ok(Math.abs(x) <= 40 && Math.abs(z) <= 40);
        assert.ok(Number.isFinite(yaw) && Math.abs(yaw) <= Math.PI + 1e-9);
        assert.equal(Math.round(x * 10) / 10, x); assert.equal(Math.round(yaw * 100) / 100, yaw);
      }
      assert.deepEqual(makeCourse(shape, tiles, FLAGS[name]), g, 'deterministic');
    }
  }
  assert.ok(g0Repeated(makeCourse('loop', RAFTS.three, [0, 0])));
  assert.ok(g0Repeated(makeCourse('eight', RAFTS.three, [0, 0])));
});
function g0Repeated(g) { return g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1] && g[0][2] === g[g.length - 1][2]; }

test('makeCourse: huge raft, unknown shape, empty tiles, sprint finish by the flag', () => {
  const huge = rect(40, 40, -20, -20);
  for (const s of SHAPES) assert.equal(makeCourse(s, huge, [0, 19]), null, s);
  assert.equal(makeCourse('donut', RAFTS.three, [0, 0]), null);
  assert.equal(makeCourse('loop', [], [0, 0]), null);
  assert.equal(makeCourse('loop', undefined, [0, 0]), null);
  for (const [name, tiles] of Object.entries(RAFTS)) {
    const f = FLAGS[name], g = makeCourse('sprint', tiles, f), last = g[g.length - 1];
    assert.ok(Math.hypot(last[0] - f[0] * 2, last[1] - f[1] * 2) <= 7, name);
  }
  const b = bbox(RAFTS.three);
  assert.deepEqual(b, { x0: -3, x1: 3, z0: -3, z1: 3 });
  assert.equal(clearOf(b, 0, 0), 0); assert.equal(clearOf(b, 7, 0), 4); assert.equal(clearOf(b, 6, 7), 5);
  assert.equal(bbox([]), null);
});

test('gate yaw follows the path: a swimmer along the polyline hits every gate in order', () => {
  for (const [name, tiles] of Object.entries(RAFTS)) {
    for (const shape of SHAPES) {
      const f = FLAGS[name], g = makeCourse(shape, tiles, f);
      // start 2 m behind gate 0 (the lead-in from the flag is free swimming)
      let px = g[0][0] - 2 * Math.sin(g[0][2]), pz = g[0][1] - 2 * Math.cos(g[0][2]), next = 0;
      const prev = P(px, .45, pz);
      for (let i = 0; i < g.length; i++) {
        const tx = g[i][0], tz = g[i][1], L = Math.hypot(tx - px, tz - pz), n = Math.max(1, Math.ceil(L / .5));
        for (let k = 1; k <= n; k++) {
          const cur = k === n ? P(tx, .45, tz) : P(px + (tx - px) * k / n, .45, pz + (tz - pz) * k / n);
          if (next < g.length && crossGate(prev, cur, g[next], 0)) next++;
          prev.x = cur.x; prev.z = cur.z;
        }
        px = tx; pz = tz;
      }
      assert.equal(next, g.length, `${shape} ${name}`);
    }
  }
});

test('addBest: sorted, top 5, one row per name, rank and best flags, no mutation', () => {
  const base = [['Ann', 30000], ['Bo', 40000]];
  const frozen = JSON.stringify(base);
  let r = addBest(base, 'Cy', 35000);
  assert.deepEqual(r.list, [['Ann', 30000], ['Cy', 35000], ['Bo', 40000]]); assert.equal(r.rank, 1); assert.equal(r.best, false);
  assert.equal(JSON.stringify(base), frozen);
  r = addBest(r.list, 'Bo', 50000); // slower retry
  assert.deepEqual(r.list.find(x => x[0] === 'Bo'), ['Bo', 40000]); assert.equal(r.rank, -1); assert.equal(r.best, false);
  r = addBest(r.list, 'Bo', 20000); // faster
  assert.deepEqual(r.list[0], ['Bo', 20000]); assert.equal(r.rank, 0); assert.equal(r.best, true);
  assert.equal(r.list.filter(x => x[0] === 'Bo').length, 1);
  let l = r.list;
  for (const [n, ms] of [['D', 60000], ['E', 61000], ['F', 62000], ['G', 10000]]) l = addBest(l, n, ms).list;
  assert.equal(l.length, RING.TOP);
  assert.deepEqual(l.map(x => x[1]), [...l.map(x => x[1])].sort((a, b) => a - b));
  const slow = addBest(l, 'Z', 99000); assert.equal(slow.rank, -1); assert.equal(slow.list.length, 5);
  assert.equal(addBest([], 'Solo', 5000).rank, 0);
  assert.equal(addBest(undefined, 'Solo', 5000).best, true);
});

test('pathLength / minMs and the finish predicate', () => {
  const g = [[10, 0, 0], [10, 10, 0], [0, 10, 0]];
  assert.equal(pathLength(g, 0, 0), 30);
  assert.equal(minMs(g, 0, 0), Math.floor(30 / MIN_SPEED * 1000));
  const st = { shape: 'loop', f: [0, 0], g, best: {}, r: 0 };
  const gk = 'loop:' + gateHash(g), m = minMs(g, 0, 0);
  const a = { kind: 'buoy.finish', shape: 'loop', mode: 'swim', ms: m, name: 'x', gk };
  assert.equal(validFinish(st, a), true);
  assert.equal(validFinish(st, { ...a, ms: m - 1 }), false);
  assert.equal(validFinish(st, { ...a, ms: MAX_MS }), true);
  assert.equal(validFinish(st, { ...a, ms: MAX_MS + 1 }), false);
  assert.equal(validFinish(st, { ...a, ms: m + .5 }), false);
  assert.equal(validFinish(st, { ...a, mode: 'car' }), false);
  assert.equal(validFinish(st, { ...a, mode: 'board' }), true);
  assert.equal(validFinish(st, { ...a, shape: 'sprint' }), false);
  assert.equal(validFinish(st, { ...a, gk: 'loop:1' }), false);
  assert.equal(validFinish({ ...st, g: [] }, { ...a, gk: 'loop:0' }), false);
  assert.equal(validFinish({ ...st, f: null }, a), false);
  assert.equal(validFinish(st, null), false);
});

test('cleanCourse: junk in, clean slice out, stable round trip', () => {
  const def = { v: 1, shape: 'loop', f: null, g: [], best: {}, r: 0 };
  assert.deepEqual(cleanCourse(undefined), def);
  assert.deepEqual(cleanCourse([1, 2]), def);
  assert.deepEqual(cleanCourse('x'), def);
  assert.equal(cleanCourse({ shape: 'donut' }).shape, 'loop');
  assert.equal(cleanCourse({ shape: 'eight' }).shape, 'eight');
  assert.equal(cleanCourse({ f: [1.5, 2] }).f, null);
  assert.equal(cleanCourse({ f: [65, 0] }).f, null);
  assert.deepEqual(cleanCourse({ f: [-64, 3] }).f, [-64, 3]);
  assert.deepEqual(cleanCourse({ g: [[1, 2, 3], [NaN, 0, 0]] }).g, []);
  assert.deepEqual(cleanCourse({ g: Array.from({ length: 11 }, () => [0, 0, 0]) }).g, []);
  const c = cleanCourse({ g: [[100, -100, 7]] }).g[0];
  assert.equal(c[0], 40); assert.equal(c[1], -40); assert.ok(Math.abs(c[2] - (7 - 2 * Math.PI)) < 1e-9);
  const best = cleanCourse({ best: {
    'loop:swim': [['  A very long name with control\u0007 chars  ', 40000], ['B', 30000], ['B', 35000], ['C', -5], ['D', 1e9], ['E', 3.5], [7, 100], 'x', ['F', 20000]],
    'loop:car': [['X', 1000]], 'donut:swim': [['X', 1000]], 'eight:board': 'nope', 'sprint:board': [['', 5000]],
  } }).best;
  assert.deepEqual(Object.keys(best), ['loop:swim']);
  assert.deepEqual(best['loop:swim'], [['F', 20000], ['B', 30000], ['A very long name', 40000]]);
  assert.equal(cleanCourse({ r: -1 }).r, 0); assert.equal(cleanCourse({ r: 2.5 }).r, 0); assert.equal(cleanCourse({ r: 9 }).r, 9);
  const full = { v: 1, shape: 'sprint', f: [1, 0], g: makeCourse('sprint', RAFTS.three, [1, 0]), best: { 'sprint:board': [['Kai', 12000]] }, r: 4 };
  const once = cleanCourse(full);
  assert.deepEqual(once, full);
  assert.deepEqual(cleanCourse(JSON.parse(JSON.stringify(once))), once);
  assert.equal(cleanName('\u0001\u0002', 'Sailor'), 'Sailor');
  assert.equal(cleanName(undefined, 'Crewmate'), 'Crewmate');
  assert.equal(cleanName(' Mo ', 'x'), 'Mo');
});

test('gateHash and fmt', () => {
  const g = makeCourse('loop', RAFTS.three, [1, 0]);
  const h = gateHash(g);
  const moved = g.map(r => r.slice()); moved[2][0] = Math.round((moved[2][0] + .1) * 10) / 10;
  assert.notEqual(gateHash(moved), h);
  const st = cleanCourse({ shape: 'loop', f: [1, 0], g, r: 0 });
  const st2 = cleanCourse({ ...st, best: { 'loop:swim': [['A', 9000]] }, r: 1 });
  assert.equal(gateHash(st2.g), h);
  assert.equal(Number.isInteger(h), true);
  assert.equal(fmt(0), '0:00.0'); assert.equal(fmt(61234), '1:01.2'); assert.equal(fmt(41300), '0:41.3'); assert.equal(fmt(NaN), '0:00.0');
  assert.deepEqual(MODES, ['swim', 'board']); assert.equal(NAMES.eight, 'Figure 8');
});
