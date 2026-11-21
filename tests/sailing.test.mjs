// Unit tests for the pure sailing core (dist/sailing-core.js).
// Run: node --test tests/sailing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const {
  SAIL, defaultSailing, cleanSailing, sailFactor, sailTarget, stepSailing, applySailAction,
  wrapAxis, placeUpstream, driftedOut, windVector,
} = await import(new URL('sailing-core.js', base));

const KEYS = ['v', 'windDir', 'windStr', 'windTarget', 'windStrTarget', 'windClock', 'heading', 'raised', 'anchored', 'vx', 'vz', 'wx', 'wz', 'gx', 'gz'].sort();
const near = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, msg || `${a} !~ ${b}`);
const out = () => ({ dwx: 0, dwz: 0, dgx: 0, dgz: 0 });
const run = (s, secs, opts, dt = 1 / 60) => { const o = out(); const n = Math.round(secs / dt); for (let i = 0; i < n; i++) stepSailing(s, dt, opts, o); return o; };
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('defaults and cleanSailing on garbage', () => {
  const d = defaultSailing();
  assert.deepEqual(Object.keys(d).sort(), KEYS);
  assert.equal(d.raised, false); assert.equal(d.anchored, false);
  assert.equal(d.heading, 0); near(d.windDir, 0.6); near(d.windStr, 0.8);
  for (const g of [null, undefined, 'x', 42, NaN, [], [1, 2], () => 1, true]) assert.deepEqual(cleanSailing(g), d);
  const c = cleanSailing({
    windDir: NaN, windStr: 99, windClock: -5, heading: 1e300, raised: 'yes', anchored: 1,
    vx: 1e9, vz: -Infinity, wx: 5e7, gz: -3e9, junk: 7, paddleClock: 0.5,
  });
  assert.deepEqual(Object.keys(c).sort(), KEYS);
  for (const k of KEYS) if (typeof d[k] === 'number') assert.ok(Number.isFinite(c[k]), k);
  near(c.windDir, 0.6); assert.equal(c.windStr, 1); assert.equal(c.windClock, 0);
  assert.equal(c.raised, false); assert.equal(c.anchored, false);
  assert.equal(c.vx, 3); assert.equal(c.vz, 0);
  assert.ok(c.heading > -Math.PI && c.heading <= Math.PI);
  assert.ok(Math.abs(c.wx) <= SAIL.WATER_WRAP / 2 && Math.abs(c.gz) <= SAIL.GROUND_WRAP / 2);
  assert.equal(cleanSailing({ windStr: 0.1, windClock: 1e6 }).windStr, 0.55);
  assert.equal(cleanSailing({ windClock: 1e6 }).windClock, 200);
  // fresh copy
  const src = { ...d, raised: true }; const cc = cleanSailing(src);
  assert.notEqual(cc, src); assert.equal(cc.raised, true);
});

test('cleanSailing round-trips through JSON', () => {
  const s = defaultSailing();
  Object.assign(s, { raised: true, anchored: true, heading: -2, vx: 1.2, vz: -0.4, wx: 12.5, gz: -900 });
  applySailAction(s, { kind: 'sail', op: 'unanchor' });
  applySailAction(s, { kind: 'sail', op: 'paddle', angle: 1 }); // adds runtime paddleClock
  const back = cleanSailing(JSON.parse(JSON.stringify(s)));
  assert.equal('paddleClock' in back, false);
  const { paddleClock, ...rest } = s;
  assert.deepEqual(back, rest);
  assert.deepEqual(cleanSailing(back), back);
});

test('sailFactor is diminishing and capped', () => {
  assert.equal(sailFactor(0), 0); assert.equal(sailFactor(NaN), 0);
  near(sailFactor(1), 1); near(sailFactor(2), 1.1); near(sailFactor(3), 1.2);
  assert.equal(sailFactor(4), sailFactor(3)); assert.equal(sailFactor(10), sailFactor(3));
  for (let n = 1; n < 4; n++) assert.ok(sailFactor(n + 1) / (n + 1) < sailFactor(n) / n, 'per-sail value drops');
});

test('sail push: zero when lowered / anchored / no sails / facing upwind; max downwind', () => {
  const t = { x: 9, z: 9 };
  const s = defaultSailing(); s.windDir = 0.6; s.heading = 0.6;
  sailTarget(s, 1, t); assert.deepEqual(t, { x: 0, z: 0 }, 'lowered');
  s.raised = true;
  sailTarget(s, 0, t); assert.deepEqual(t, { x: 0, z: 0 }, 'no sails');
  s.anchored = true; sailTarget(s, 1, t); assert.deepEqual(t, { x: 0, z: 0 }, 'anchored');
  s.anchored = false;
  s.heading = 0.6 + Math.PI; sailTarget(s, 1, t); near(Math.hypot(t.x, t.z), 0, 1e-12, 'against wind');
  s.heading = 0.6 + Math.PI / 2 + 0.01; sailTarget(s, 1, t); near(Math.hypot(t.x, t.z), 0, 1e-12, 'just past abeam');
  s.heading = 0.6; sailTarget(s, 1, t);
  const max = Math.hypot(t.x, t.z);
  near(max, SAIL.SAIL_SPEED * s.windStr);
  near(Math.atan2(t.x, t.z), 0.6, 1e-9, 'along heading');
  for (const h of [0.2, 1.0, -0.5, 2]) { s.heading = h; sailTarget(s, 1, t); assert.ok(Math.hypot(t.x, t.z) < max); }
  s.heading = 0.6; sailTarget(s, 3, t); near(Math.hypot(t.x, t.z), max * sailFactor(3));
});

test('windVector', () => {
  const s = defaultSailing(); const w = {};
  windVector(s, w);
  near(w.x, Math.sin(0.6) * 0.8); near(w.z, Math.cos(0.6) * 0.8);
});

test('velocity converges to sail target (framerate independent)', () => {
  const a = defaultSailing(); a.raised = true; a.heading = a.windDir;
  const b = cleanSailing(a);
  const t = {}; sailTarget(a, 2, t);
  run(a, SAIL.TAU_UP, { nSails: 2, host: false }, 1 / 60);
  run(b, SAIL.TAU_UP, { nSails: 2, host: false }, 1 / 20);
  near(Math.hypot(a.vx, a.vz) / Math.hypot(t.x, t.z), 1 - Math.exp(-1), 0.01, 'one tau');
  near(a.vx, b.vx, 1e-3); near(a.vz, b.vz, 1e-3);
  run(a, 40, { nSails: 2, host: false });
  near(a.vx, t.x, 1e-4); near(a.vz, t.z, 1e-4);
  // slowing down uses the shorter TAU_DOWN
  const v0 = Math.hypot(a.vx, a.vz); a.raised = false;
  run(a, SAIL.TAU_DOWN, { nSails: 2, host: false }, 1 / 60);
  near(Math.hypot(a.vx, a.vz) / v0, Math.exp(-1), 1e-6, 'one tau down');
  assert.ok(SAIL.TAU_DOWN < SAIL.TAU_UP);
});

test('free: dw = v*dt, dg = (v+current)*dt; anchored: dg = 0, dw = -current*dt', () => {
  const s = defaultSailing(); s.vx = 1; s.vz = 0.5;
  const o = out(); stepSailing(s, 0.05, { nSails: 0, host: false }, o);
  near(o.dgx - o.dwx, SAIL.CURRENT_X * 0.05); near(o.dgz - o.dwz, SAIL.CURRENT_Z * 0.05);
  near(s.wx, o.dwx); near(s.gz, o.dgz);
  s.anchored = true; s.raised = true; s.heading = s.windDir;
  const g = [s.gx, s.gz];
  stepSailing(s, 0.05, { nSails: 1, host: true }, o);
  assert.equal(o.dgx, 0); assert.equal(o.dgz, 0);
  near(o.dwx, -SAIL.CURRENT_X * 0.05); near(o.dwz, -SAIL.CURRENT_Z * 0.05);
  assert.deepEqual([s.gx, s.gz], g);
  run(s, 30, { nSails: 1, host: false });
  near(Math.hypot(s.vx, s.vz), 0, 1e-3, 'anchored raft comes to rest');
});

test('dt guard: NaN / negative / huge', () => {
  const s = defaultSailing(); s.vx = 1; const o = out();
  for (const dt of [NaN, -1, Infinity, -Infinity, undefined, '1']) {
    assert.doesNotThrow(() => stepSailing(s, dt, { nSails: 1, host: true }, o));
    assert.equal(o.dwx, 0); assert.equal(o.dgz, 0);
  }
  assert.doesNotThrow(() => stepSailing(s, 0.016, undefined, o));
  stepSailing(s, 1000, { nSails: 0 }, o);
  assert.ok(Math.abs(o.dwx) <= 1 * SAIL.MAX_DT + 1e-9, 'dt clamped');
});

test('offsets stay finite and bounded over 1e6 seconds; deltas are raw', () => {
  const s = defaultSailing(); s.raised = true;
  const rng = seeded(7); const o = out(); const t = {};
  let sum = 0;
  for (let i = 0; i < 1e7; i++) {
    if (i % 5000 === 0) s.heading = s.windDir; // keep sailing downwind
    stepSailing(s, 0.1, { nSails: 4, host: true, rng }, o);
    if (i < 1000) sum += o.dgz;
  }
  for (const k of ['wx', 'wz', 'gx', 'gz', 'vx', 'vz', 'windDir', 'windStr', 'windClock']) assert.ok(Number.isFinite(s[k]), k);
  for (const k of ['wx', 'wz']) assert.ok(s[k] >= -SAIL.WATER_WRAP / 2 && s[k] < SAIL.WATER_WRAP / 2, k);
  for (const k of ['gx', 'gz']) assert.ok(s[k] >= -SAIL.GROUND_WRAP / 2 && s[k] < SAIL.GROUND_WRAP / 2, k);
  assert.ok(s.windStr >= 0.55 && s.windStr <= 1);
  sailTarget(s, 4, t);
  assert.ok(Math.abs(o.dwx) < 1 && Math.abs(o.dgz) < 1, 'per-step deltas are raw, not wrapped');
  assert.equal(SAIL.GROUND_WRAP % (2 * SAIL.ISLAND_WRAP), 0);
  assert.ok(sum !== 0);
});

test('wind wanders only on host, slowly, and stays near target', () => {
  const g = defaultSailing(); run(g, 500, { nSails: 0, host: false });
  near(g.windDir, 0.6); near(g.windStr, 0.8);
  const s = defaultSailing(); const rng = seeded(3); const o = out();
  let prev = s.windDir, prevStr = s.windStr, maxRate = 0, maxStrStep = 0, rolls = 0, lastT = s.windTarget;
  for (let i = 0; i < 20000; i++) {
    const dirAtRoll = s.windDir;
    stepSailing(s, 0.1, { nSails: 0, host: true, rng }, o);
    if (s.windTarget !== lastT) {
      const d = Math.abs(Math.atan2(Math.sin(s.windTarget - dirAtRoll), Math.cos(s.windTarget - dirAtRoll)));
      assert.ok(d <= Math.PI / 3 + 1e-9, `swing ${d}`);
      assert.ok(Math.abs(s.windTarget) <= SAIL.WIND_LIMIT + 1e-9, 'target near +z');
    }
    assert.ok(Math.abs(s.windDir) <= SAIL.WIND_LIMIT + 1e-9, `windDir ${s.windDir}`);
    maxStrStep = Math.max(maxStrStep, Math.abs(s.windStr - prevStr)); prevStr = s.windStr;
    assert.ok(s.windStrTarget >= 0.55 && s.windStrTarget <= 1);
    const d = Math.abs(Math.atan2(Math.sin(s.windDir - prev), Math.cos(s.windDir - prev)));
    maxRate = Math.max(maxRate, d / 0.1); prev = s.windDir;
    if (s.windTarget !== lastT) { rolls++; lastT = s.windTarget; }
    assert.ok(s.windClock <= 140 && s.windStr >= 0.55 && s.windStr <= 1);
  }
  assert.ok(maxRate <= SAIL.WIND_RATE + 1e-9, `rate ${maxRate}`);
  assert.ok(maxStrStep < 0.005, `windStr eases (step ${maxStrStep})`);
  assert.ok(rolls >= 2000 / 140 - 1 && rolls <= 2000 / 70 + 1, `rolls ${rolls}`);
});

test('grounding stops approach to a blocker but allows leaving', () => {
  const s = defaultSailing(); s.raised = true; s.heading = s.windDir = 0; s.windStr = 1; // sail toward +z
  // island ahead at +z: relative position = base - g. Raft approaches as g grows.
  const base = { x: 0, z: 40 }, r = 10;
  const bl = [{ x: 0, z: 0, r }]; const o = out();
  let minD = Infinity;
  for (let i = 0; i < 6000; i++) {
    bl[0].x = base.x - s.gx; bl[0].z = base.z - s.gz;
    stepSailing(s, 1 / 30, { nSails: 4, host: false, blockers: bl }, o);
    minD = Math.min(minD, Math.hypot(base.x - s.gx, base.z - s.gz));
  }
  assert.ok(minD >= r - 0.3, `got within ${minD}`); // b.r is the full stop distance (no extra pad)
  assert.ok(minD < r + 0.5, 'did approach');
  assert.equal('GROUND_PAD' in SAIL, false);
  // turning away (heading -z, wind -z) lets the raft leave
  s.heading = s.windDir = Math.PI;
  const before = Math.hypot(base.x - s.gx, base.z - s.gz);
  for (let i = 0; i < 600; i++) {
    bl[0].x = base.x - s.gx; bl[0].z = base.z - s.gz;
    stepSailing(s, 1 / 30, { nSails: 4, host: false, blockers: bl }, o);
  }
  assert.ok(Math.hypot(base.x - s.gx, base.z - s.gz) > before + 1);
  // empty / garbage blockers are fine
  assert.doesNotThrow(() => stepSailing(s, 0.1, { nSails: 1, blockers: [] }, o));
  assert.doesNotThrow(() => stepSailing(s, 0.1, { nSails: 1, blockers: [null, { x: NaN }, { x: 0, z: 0, r: 5 }] }, o));
});

test('placeUpstream and driftedOut geometry', () => {
  // spawned for +z flow: upstream at negative z
  const it = { x: 3, z: -20 };
  placeUpstream(it, 0, 1); near(it.x, 3); near(it.z, -20);
  const spawn = () => ({ x: 0, z: -20 });
  let a = placeUpstream(spawn(), 1, 0); near(a.x, -20); near(a.z, 0, 1e-9);   // flow +x → upstream -x
  a = placeUpstream(spawn(), 0, -1); near(a.x, 0, 1e-9); near(a.z, 20);       // flow -z → upstream +z
  a = placeUpstream(spawn(), -0.3, -0.3); near(a.x, 20 / Math.SQRT2); near(a.z, 20 / Math.SQRT2);
  const side = placeUpstream({ x: 5, z: -10 }, 2, 0);
  near(Math.hypot(side.x, side.z), Math.hypot(5, 10)); assert.ok(side.x * 2 < 0, 'still upstream');
  a = placeUpstream({ x: 1, z: -2 }, 0.01, 0.02); near(a.x, 1); near(a.z, -2);  // tiny flow: untouched
  assert.equal(driftedOut({ x: 0, z: 50 }, 0, 1, 40), true);
  assert.equal(driftedOut({ x: 0, z: -50 }, 0, 1, 40), false, 'upstream, still arriving');
  assert.equal(driftedOut({ x: 0, z: 30 }, 0, 1, 40), false, 'inside R');
  assert.equal(driftedOut({ x: 50, z: 0 }, 1, 0, 40), true);
  // centre-aware variants
  a = placeUpstream({ x: 10, z: -20 }, 1, 0, 10, 0); near(a.x, -10); near(a.z, 0, 1e-9);
  assert.equal(driftedOut({ x: 10, z: 50 }, 0, 1, 40, 10, 20), false, 'within R of the centre');
  assert.equal(driftedOut({ x: 10, z: 61 }, 0, 1, 40, 10, 20), true);
});

test('fresh spawns rotated about the raft centre are never instantly out of range', () => {
  // Mirrors game.js makeItem + sailing-world respawned/outOfRange (R = half diagonal + 26).
  const shapes = {
    small: [[0, 0]],
    square: [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]],
    long: [], wide: [], offset: [[4, 3], [5, 3], [6, 4], [9, 5]],
  };
  for (let z = -14; z <= 1; z++) for (let x = -1; x <= 1; x++) shapes.long.push([x, z]);
  for (let x = 0; x <= 10; x++) shapes.wide.push([x, 0], [x, 1]);
  const rng = seeded(11);
  for (const [name, tiles] of Object.entries(shapes)) {
    const xs = tiles.map(t => t[0]), zs = tiles.map(t => t[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const cx = x0 + x1, cz = z0 + z1, R = Math.hypot(x1 - x0 + 1, z1 - z0 + 1) + 26;
    const spread = Math.max(11, Math.max(...xs.map(Math.abs)) * 2 + 6), edge = z0 * 2 - 1;
    for (let k = 0; k < 24; k++) {
      const ang = k * Math.PI / 12, mag = k % 3 === 0 ? 0.06 : 0.5 + k * 0.1;
      const fx = Math.sin(ang) * mag, fz = Math.cos(ang) * mag;
      for (let i = 0; i < 200; i++) {
        const it = { x: (rng() - 0.5) * spread * 2, z: edge - 3 - rng() * 17 };
        placeUpstream(it, fx, fz, cx, cz);
        assert.equal(driftedOut(it, fx, fz, R, cx, cz), false, `${name} flow ${ang.toFixed(2)} at ${it.x.toFixed(1)},${it.z.toFixed(1)}`);
        assert.ok((it.x - cx) * fx + (it.z - cz) * fz < 0, `${name}: spawn is upstream of the centre`);
      }
    }
  }
});

test('applySailAction ops and garbage', () => {
  const s = defaultSailing();
  assert.equal(applySailAction(s, { kind: 'sail', op: 'raise' }), 'Sail raised'); assert.equal(s.raised, true);
  assert.equal(applySailAction(s, { kind: 'sail', op: 'lower' }), 'Sail lowered'); assert.equal(s.raised, false);
  assert.equal(applySailAction(s, { kind: 'sail', op: 'toggle' }), 'Sail raised'); assert.equal(s.raised, true);
  assert.equal(applySailAction(s, { kind: 'sail', op: 'anchor' }), 'Anchor dropped'); assert.equal(s.anchored, true);
  assert.equal(applySailAction(s, { kind: 'sail', op: 'unanchor' }), 'Anchor raised'); assert.equal(s.anchored, false);
  assert.equal(applySailAction(s, { kind: 'sail', op: 'toggleAnchor' }), 'Anchor dropped'); assert.equal(s.anchored, true);
  assert.equal(applySailAction(s, { kind: 'sail', op: 'toggleAnchor' }), 'Anchor raised');
  assert.equal(applySailAction(s, { kind: 'sail', op: 'heading', heading: 7 }), '');
  near(s.heading, 7 - 2 * Math.PI);
  applySailAction(s, { kind: 'sail', op: 'heading', heading: -Math.PI }); near(s.heading, Math.PI);
  applySailAction(s, { kind: 'sail', op: 'heading', heading: NaN }); near(s.heading, Math.PI);
  applySailAction(s, { kind: 'sail', op: 'heading' }); near(s.heading, Math.PI);
  // paddle: impulse, cooldown, clamp, ignored when anchored
  s.vx = s.vz = 0;
  applySailAction(s, { kind: 'sail', op: 'paddle', angle: Math.PI / 2 });
  near(s.vx, 0.25); near(s.vz, 0, 1e-12);
  applySailAction(s, { kind: 'sail', op: 'paddle', angle: Math.PI / 2 }); near(s.vx, 0.25, 1e-12, 'cooldown');
  for (let i = 0; i < 7; i++) stepSailing(s, 0.1, { nSails: 0 }, out());
  let v1 = s.vx; applySailAction(s, { kind: 'sail', op: 'paddle', angle: Math.PI / 2 }); near(s.vx, v1, 1e-12, 'still cooling at 0.7 s');
  for (let i = 0; i < 2; i++) stepSailing(s, 0.1, { nSails: 0 }, out());
  v1 = s.vx; applySailAction(s, { kind: 'sail', op: 'paddle', angle: Math.PI / 2 }); near(s.vx, v1 + 0.25, 1e-12, 'after cooldown');
  for (let i = 0; i < 20; i++) { s.paddleClock = 0; applySailAction(s, { kind: 'sail', op: 'paddle', angle: 0 }); }
  assert.ok(Math.hypot(s.vx, s.vz) <= SAIL.PADDLE_CAP + 1e-9, 'paddle alone capped');
  // a fast (sailing) raft: paddling along can't add speed, paddling against slows it
  s.vx = 2; s.vz = 0; s.paddleClock = 0;
  applySailAction(s, { kind: 'sail', op: 'paddle', angle: Math.PI / 2 }); near(Math.hypot(s.vx, s.vz), 2, 1e-12);
  s.paddleClock = 0; applySailAction(s, { kind: 'sail', op: 'paddle', angle: -Math.PI / 2 }); near(s.vx, 1.75, 1e-12);
  s.anchored = true; s.paddleClock = 0; const vz = s.vz;
  applySailAction(s, { kind: 'sail', op: 'paddle', angle: 0 }); assert.equal(s.vz, vz, 'anchored');
  s.anchored = false; s.paddleClock = 0;
  applySailAction(s, { kind: 'sail', op: 'paddle', angle: 'x' }); assert.equal(s.vz, vz, 'bad angle');
  // garbage
  const snap = JSON.stringify(s);
  for (const a of [null, undefined, 5, 'raise', {}, { op: 'explode' }, { op: 'constructor' }, { op: '__proto__' }, []]) {
    assert.equal(applySailAction(s, a), '');
  }
  assert.equal(JSON.stringify(s), snap);
  assert.equal(applySailAction(null, { op: 'raise' }), '');
});

test('wrapAxis', () => {
  assert.equal(wrapAxis(0, 130), 0);
  near(wrapAxis(131, 130), -129); near(wrapAxis(-131, 130), 129);
  assert.equal(wrapAxis(130, 130), -130);
  assert.equal(SAIL.GROUND_WRAP % (2 * SAIL.ISLAND_WRAP), 0);
  assert.equal(SAIL.ISLAND_WRAP, 150); assert.equal(SAIL.WATER_WRAP, 65536);
  assert.equal(SAIL.WATER_WRAP % 512, 0, 'shader fine detail uses mod(uFlow, 512.)');
  assert.equal(wrapAxis(NaN, 130), 0);
});

test('engine push: absent = old result; push alone converges; sail + push capped; anchored ignores push', () => {
  const mk = () => { const s = defaultSailing(); s.raised = true; s.heading = s.windDir; return s; };
  // no push (and a zero push) give byte-identical results to the old path
  const a = mk(), b = mk(), c = mk();
  run(a, 5, { nSails: 1, host: true, rng: seeded(3) });
  run(b, 5, { nSails: 1, host: true, rng: seeded(3), push: undefined });
  run(c, 5, { nSails: 1, host: true, rng: seeded(3), push: { x: 0, z: 0 } });
  assert.deepEqual(b, a); assert.deepEqual(c, a);
  run(c, .1, { nSails: 1, host: false, push: { x: NaN, z: 1 } }); run(a, .1, { nSails: 1, host: false });
  assert.deepEqual(c, a, 'non-finite push ignored');
  // push alone (no sail) converges to |push| along the push
  const p = defaultSailing();
  run(p, 60, { nSails: 0, host: false, push: { x: .42, z: .56 } });
  near(p.vx, .42, 1e-4); near(p.vz, .56, 1e-4);
  // sail + push clamps at TARGET_CAP
  const q = mk(); q.windStr = 1;
  run(q, 80, { nSails: 3, host: false, push: { x: Math.sin(q.heading) * 1.4, z: Math.cos(q.heading) * 1.4 } });
  near(Math.hypot(q.vx, q.vz), SAIL.TARGET_CAP, 1e-3);
  assert.ok(SAIL.TARGET_CAP < SAIL.V_CLAMP);
  // anchored: push ignored, raft comes to rest, seabed offset frozen
  const r = defaultSailing(); r.anchored = true; const g = [r.gx, r.gz];
  run(r, 30, { nSails: 0, host: false, push: { x: 0, z: 1.4 } });
  near(Math.hypot(r.vx, r.vz), 0, 1e-12); assert.deepEqual([r.gx, r.gz], g);
});
