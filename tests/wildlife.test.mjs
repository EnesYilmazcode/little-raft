// Unit tests for dist/wildlife.js pure plan and module (no scene). Run: node --test tests/wildlife.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const W = await import(new URL('wildlife.js', base));
const { WILDLIFE_SEED: SEED, mulberry32, perchesFrom, gullPlan, gullVisit, schoolCenter, fishOffset, circlerAt, createWildlife, GULL_MAX, GULL_SLOT, CIRCLER_MIN_R } = W;

const TILES = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [-1, 1], [1, -1]];
const DECOR = [{ type: 'sail', x: 1, z: 0 }, { type: 'palm', x: 0, z: 1 }, { type: 'crate', x: 1, z: 1 }];
const fresh = () => ({});

test('mulberry32 is deterministic and in [0,1)', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 100; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
});

test('perchesFrom: free tiles plus raised sail/crate/bench tops, sorted, order independent', () => {
  const p = perchesFrom(TILES, DECOR);
  assert.equal(p.length, 8); // palm tile dropped
  assert.ok(!p.some(q => q.key === '0,1'));
  const sail = p.find(q => q.key === '1,0'), crate = p.find(q => q.key === '1,1'), free = p.find(q => q.key === '0,0');
  assert.ok(sail.y > 3.5 && crate.y > 0.9 && crate.y < 1.2 && free.y === 0.2);
  assert.deepEqual(p.map(q => q.key), ['-1,-1', '-1,0', '-1,1', '0,-1', '0,0', '1,-1', '1,0', '1,1']);
  const shuffled = [...TILES].reverse(), d2 = [...DECOR].reverse();
  assert.deepEqual(perchesFrom(shuffled, d2), p);
  assert.deepEqual(perchesFrom([], []), []);
  assert.deepEqual(perchesFrom(undefined, undefined), []);
  assert.deepEqual(perchesFrom([[0, 0], 'junk', [NaN, 1], null], [null, { x: 'a' }]).length, 1);
});

test('plans are deterministic for equal inputs and change with the seed', () => {
  const per = perchesFrom(TILES, DECOR);
  let differ = 0;
  for (let k = 0; k < 50; k++) {
    const t = k * 13.7;
    for (let i = 0; i < GULL_MAX; i++) assert.deepEqual(gullPlan(SEED, i, t, per, fresh()), gullPlan(SEED, i, t, per, fresh()));
    assert.deepEqual(schoolCenter(SEED, 1, t, fresh()), schoolCenter(SEED, 1, t, fresh()));
    assert.deepEqual(circlerAt(SEED, t, fresh()), circlerAt(SEED, t, fresh()));
    const a = gullPlan(SEED, 0, t, per, fresh()), b = gullPlan(SEED + 1, 0, t, per, fresh());
    if (a.x !== b.x || a.z !== b.z) differ++;
  }
  assert.ok(differ > 0);
});

test('gulls move smoothly, stay above water, and both circle and perch', () => {
  const per = perchesFrom(TILES, DECOR);
  for (let i = 0; i < GULL_MAX; i++) {
    const seen = new Set(); let prev = null;
    for (let s = 0; s < 6000; s++) {
      const o = gullPlan(SEED, i, s / 10, per, fresh());
      seen.add(o.state);
      assert.ok(o.y >= 0, `gull ${i} y ${o.y}`);
      assert.ok(Number.isFinite(o.yaw) && Number.isFinite(o.flap));
      if (prev) assert.ok(Math.hypot(o.x - prev.x, o.y - prev.y, o.z - prev.z) < 2, `gull ${i} jumped at ${s / 10}`);
      prev = o;
    }
    assert.ok(seen.has('circle') && seen.has('perched'), `gull ${i} states ${[...seen]}`);
  }
});

test('a perched gull sits on its perch, and two gulls never share a perch', () => {
  const per = perchesFrom(TILES, DECOR);
  let perchedSamples = 0;
  for (let s = 0; s < 3000; s++) {
    const t = s / 5, used = new Set();
    for (let i = 0; i < GULL_MAX; i++) {
      const o = gullPlan(SEED, i, t, per, fresh());
      if (o.state !== 'perched') continue;
      perchedSamples++;
      const p = per[o.perch];
      assert.equal(o.x, p.x); assert.equal(o.z, p.z); assert.ok(o.y >= p.y && o.y < p.y + 0.1);
      assert.ok(!used.has(o.perch), `perch ${o.perch} shared at t=${t}`); used.add(o.perch);
    }
  }
  assert.ok(perchedSamples > 100);
});

test('gulls follow perch changes and keep circling with no perches', () => {
  const per = perchesFrom(TILES, DECOR), fewer = perchesFrom([[0, 0]], []);
  for (let s = 0; s < 2000; s++) {
    const t = s / 2;
    for (let i = 0; i < GULL_MAX; i++) {
      assert.equal(gullPlan(SEED, i, t, [], fresh()).state, 'circle');
      const o = gullPlan(SEED, i, t, fewer, fresh());
      if (o.perch >= 0) { assert.equal(o.px, 0); assert.equal(o.pz, 0); assert.equal(i, 0); }
    }
  }
  const v = gullVisit(SEED, 0, 3, per.length, {});
  assert.ok(v.start >= 3 * GULL_SLOT && v.start + 4 + v.stay + 4 < 4 * GULL_SLOT);
});

test('a scare makes a perched gull leave early', () => {
  const per = perchesFrom(TILES, DECOR);
  for (let t = 0; t < 2000; t += 0.5) {
    const o = gullPlan(SEED, 0, t, per, fresh());
    if (o.state !== 'perched') continue;
    assert.equal(gullPlan(SEED, 0, t + 0.5, per, fresh(), t).state, 'leave');
    assert.ok(gullPlan(SEED, 0, t + 1.5, per, fresh(), t).y > o.y);
    return;
  }
  assert.fail('gull 0 never perched');
});

test('fish schools stay 6-18 m out and 0.4-1.2 m deep', () => {
  for (let i = 0; i < 2; i++) for (let s = 0; s < 6000; s++) {
    const o = schoolCenter(SEED, i, s / 10, fresh());
    const r = Math.hypot(o.x, o.z);
    assert.ok(r >= 6 && r <= 18, `school r ${r}`);
    for (let j = 0; j < 12; j++) { const f = fishOffset(SEED, i, j, fresh()); const y = o.y + f.depth; assert.ok(y >= -1.2 && y <= -0.4, `fish y ${y}`); }
  }
});

test('the circler is absent most of the time, keeps its distance, and is ~70% dolphin', () => {
  let present = 0, dolphins = 0, kinds = 0;
  for (let s = 0; s < 20000; s++) {
    const o = circlerAt(SEED, s * 1.7, fresh());
    if (!o.kind) continue;
    present++;
    assert.ok(Math.hypot(o.x, o.z) >= CIRCLER_MIN_R);
  }
  assert.ok(present / 20000 < 0.5, `present ${present / 20000}`);
  for (let w = 0; w < 2000; w++) { // one sample in the middle of each window's visit
    for (let k = 0; k < 40; k++) { const o = circlerAt(SEED, w * 180 + k * 4.5, fresh()); if (o.kind) { kinds++; if (o.kind === 'dolphin') dolphins++; break; } }
  }
  assert.ok(Math.abs(dolphins / kinds - 0.7) < 0.05, `dolphin share ${dolphins / kinds}`);
});

// ---------------------------------------------------------------- module with a stub ctx

const stub = (over = {}) => ({ role: 'solo', elapsed: 0, options: { graphics: 'medium' }, world: { tiles: TILES, decor: DECOR }, ...over });

test('module: load never throws on garbage, solo serialize is undefined', () => {
  const ctx = stub(), m = createWildlife(ctx);
  assert.equal(m.name, 'wildlife');
  for (const d of [undefined, null, 'junk', 7, [], { t: NaN }, { t: 1e308 }, { t: 'x' }]) for (const f of ['save', 'net', 'restore', undefined]) m.load(d, f);
  assert.equal(m.serialize(), undefined);
  m.update(0.016); // no scene: must not throw or build
  assert.equal(m.debug.snapshot().built, false);
});

test('module: host serialize reuses one object; guest syncs to the host clock', () => {
  const host = stub({ role: 'host', elapsed: 123.456 }), h = createWildlife(host);
  const a = h.serialize(), b = h.serialize();
  assert.equal(a, b); assert.equal(a.t, 123.5);
  const guestCtx = stub({ role: 'guest', elapsed: 5 }), g = createWildlife(guestCtx);
  g.load(JSON.parse(JSON.stringify(a)), 'net');
  assert.equal(g.clock, 123.5);
  const per = perchesFrom(TILES, DECOR);
  assert.deepEqual(gullPlan(SEED, 2, g.clock, per, {}), gullPlan(SEED, 2, a.t, per, {}));
  // small jitter is ignored, a big jump snaps
  guestCtx.elapsed = 6; g.load({ t: 124.0 }, 'net'); assert.equal(g.offset, 118.5);
  g.load({ t: 500 }, 'net'); assert.equal(g.clock, 500);
  g.load(undefined, 'restore'); assert.equal(g.offset, 0);
});

test('module: setTime and release are safe without a scene', () => {
  const ctx = stub({ elapsed: 10 }), m = createWildlife(ctx);
  assert.equal(m.debug.setTime(77), 77);
  m.debug.release();
  assert.equal(m.debug.summonCircler('turtle').kind, 'turtle');
  m.dispose();
});
