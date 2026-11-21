// Friendly storms + Lightning Rod (docs/specs/storm.md §12). Pure schedule, strike driver, rod rewards, slice, flash and
// the small daynight / ocean / audio / settings hooks. Run: node --test tests/storm.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = name => readFileSync(fileURLToPath(new URL(name, base)), 'utf8');
// storm.js imports daynight.js with the build stamp; import the same specifier so STORM_LIVE is the same object.
const STAMP = (/from '\.\/daynight\.js(\?[^']*)?'/.exec(src('storm.js')) ?? [])[1] ?? '';
const T = await import(new URL('vendor/three.module.js', base));
const DN = await import(new URL('daynight.js' + STAMP, base));
const S = await import(new URL('storm.js' + STAMP, base));
const { createOcean } = await import(new URL('ocean.js', base));
const { EVENTS } = await import(new URL('audio.js', base));
const { validateSettings } = await import(new URL('settings.js', base));
const { STORM_LIVE, stormAt, isStormSegment, weatherAt, segmentAt, segmentStart, segmentIndexAt, STORM_P, createDayNight } = DN;
const { STRIKE, strikeId, strikeTime, strikeList, strikePos, rodFor, makeDriver, stepDriver, flashAt, award, cleanSlice, createStorm, nextStorm } = S;

const SEEDS = [1, 0xdecaf, 3141592653];
const stormSegs = (seed, n, from = 0) => { const out = []; for (let i = from; out.length < n; i++) if (isStormSegment(seed, i)) out.push(i); return out; };
const resetLive = () => Object.assign(STORM_LIVE, { ready: false, level: 0, on: false, index: 0, start: 0, end: 0, clock: 0, seed: 0, nf: 0, pin: -1, flash: 0, dirty: false });

// ---------------------------------------------------------------- 1. schedule determinism
test('stormAt is deterministic per (seed, clock) and storms only land on rain segments', () => {
  const a = {}, b = {};
  for (const seed of SEEDS) for (let c = 0; c < 200000; c += 37.3) {
    assert.deepEqual(stormAt(seed, c, a), stormAt(seed, c, b));
  }
  let diff = 0;
  for (let c = 0; c < 100000; c += 50) if (stormAt(1, c, a).storm !== stormAt(2, c, b).storm) diff++;
  assert.ok(diff > 0, 'different seeds give different storms');
  const seg = {};
  for (const seed of SEEDS) for (let i = 0; i < 5000; i++) if (isStormSegment(seed, i)) assert.equal(segmentAt(seed, i, seg).weather, 'rain');
  const o = { storm: 9, index: 0, start: 0, end: 0, on: false };
  assert.equal(stormAt(1, 100, o), o, 'writes into out');
  for (const bad of [NaN, -5, undefined, Infinity]) { const r = stormAt(1, bad, {}); assert.ok(r.storm >= 0 && r.storm <= 1); }
});

// ---------------------------------------------------------------- 2. shares
test('storms are 7 % of segments (35 % of rain); weather shares unchanged', () => {
  const N = 200000;
  for (const seed of SEEDS) {
    let storm = 0; const w = { calm: 0, breezy: 0, rain: 0 }, seg = {};
    for (let i = 0; i < N; i++) { w[segmentAt(seed, i, seg).weather]++; if (isStormSegment(seed, i)) storm++; }
    assert.ok(Math.abs(storm / N - 0.07) <= 0.005, `storms ${storm / N}`);
    assert.ok(Math.abs(storm / w.rain - STORM_P) <= 0.015, `of rain ${storm / w.rain}`);
    assert.ok(Math.abs(w.calm / N - 0.5) < 0.01 && Math.abs(w.breezy / N - 0.3) < 0.01 && Math.abs(w.rain / N - 0.2) < 0.01);
  }
});

// ---------------------------------------------------------------- 3. ease
test('storm eases in and out, never jumps, and never exceeds the rain', () => {
  const o = {}, w = {};
  for (const seed of SEEDS) for (const i of stormSegs(seed, 30)) {
    const s0 = segmentStart(seed, i), s1 = segmentStart(seed, i + 1);
    assert.equal(stormAt(seed, s0, o).storm, 0);
    assert.ok(stormAt(seed, s1 - 5, o).storm < 1e-12);
    assert.ok(Math.abs(stormAt(seed, (s0 + s1) / 2, o).storm - 1) < 1e-12, 'full mid-segment');
    let prev = stormAt(seed, s0 - 30, o).storm;
    for (let c = s0 - 30; c <= s1 + 30; c += 0.5) {
      const v = stormAt(seed, c, o).storm;
      assert.ok(Math.abs(v - prev) < 0.03, `step ${v - prev}`);
      assert.ok(v <= weatherAt(seed, c, w).rain + 1e-12, `storm ${v} rain ${w.rain} at ${c}`);
      prev = v;
    }
  }
});

// ---------------------------------------------------------------- 4. strike schedule
test('strike schedule: increasing, 6-18 s gaps, inside the window, ring 20-80 m, deterministic', () => {
  let total = 0, pulled = 0, near = 0;
  const p = {}, q = {};
  const rods = ['0,1', '1,0', '-1,0'];
  for (const seed of SEEDS) for (const i of stormSegs(seed, 60)) {
    const list = strikeList(seed, i), s0 = segmentStart(seed, i), s1 = segmentStart(seed, i + 1);
    assert.deepEqual(list, strikeList(seed, i), 'two clients agree');
    assert.ok(list.length >= 6 && list.length <= 30, `count ${list.length}`);
    let prev = s0 + STRIKE.LEAD;
    for (const s of list) {
      assert.ok(s.k <= STRIKE.MAX_K);
      assert.equal(s.id, strikeId(i, s.k));
      assert.ok(Math.abs(s.t - strikeTime(seed, i, s.k)) < 1e-9);
      const gap = s.t - prev;
      assert.ok(gap >= 6 && gap <= 18, `gap ${gap}`);
      assert.ok(s.t >= s0 + 30 && s.t < s1 - 45);
      prev = s.t;
      strikePos(seed, s.id, p); strikePos(seed, s.id, q);
      assert.deepEqual(p, q);
      assert.ok(p.r >= 20 && p.r <= 80 && p.a >= 0 && p.a < 2 * Math.PI);
      assert.equal(rodFor(seed, s.id, p.r, []), null);
      const r = rodFor(seed, s.id, p.r, rods);
      assert.equal(r, rodFor(seed, s.id, p.r, rods));
      if (p.r >= STRIKE.ROD_PULL) assert.equal(r, null); else { near++; assert.ok(rods.includes(r)); }
      if (r) pulled++;
      total++;
    }
  }
  assert.ok(Math.abs(pulled / total - 0.2) < 0.04, `pulled ${pulled / total}`);
  assert.equal(near, pulled);
});

// ---------------------------------------------------------------- 5. driver
test('driver fires each strike exactly once on 1/60 s steps, resyncs on jumps without firing', () => {
  const seed = 0xdecaf;
  const [i] = stormSegs(seed, 1, 10);
  const s0 = segmentStart(seed, i), s1 = segmentStart(seed, i + 1), list = strikeList(seed, i);
  const d = makeDriver(), fired = [];
  const fire = (k, id, t) => fired.push({ k, id, t });
  for (let c = s0; c < s1; c += 1 / 60) stepDriver(d, seed, c, true, segmentIndexAt(seed, c), fire);
  assert.deepEqual(fired.map(f => f.id), list.map(s => s.id), 'every strike once, in order');
  // at most 3 flashes in any 1 s window
  for (let a = 0; a < fired.length; a++) { let n = 0; for (const f of fired) if (f.t >= fired[a].t && f.t < fired[a].t + 1) n++; assert.ok(n <= 3); }
  // jump forward 60 s and backward: nothing fires, then continues from the next strike after the clock
  const d2 = makeDriver(), f2 = [];
  const f2fire = (k, id) => f2.push(id);
  const mid = list[2].t - 0.5;
  stepDriver(d2, seed, mid, true, i, f2fire);
  assert.equal(stepDriver(d2, seed, mid + 60, true, i, f2fire), 0, 'forward jump fires nothing');
  assert.equal(stepDriver(d2, seed, mid - 30, true, i, f2fire), 0, 'backward jump fires nothing');
  assert.equal(f2.length, 0);
  const after = list.find(s => s.t > mid - 30);
  for (let c = mid - 30; c <= after.t + 0.02; c += 1 / 60) stepDriver(d2, seed, c, true, i, f2fire);
  assert.equal(f2[0], after.id);
  // off: nothing
  const d3 = makeDriver(); let n3 = 0;
  for (let c = s0; c < s1; c += 0.5) n3 += stepDriver(d3, seed, c, false, i, () => {});
  assert.equal(n3, 0);
});

// ---------------------------------------------------------------- 6. reward guard
test('award: once per strike id, never backwards, capped at 3', () => {
  const st = { v: 1, r: 0, rods: {} };
  assert.equal(award(st, '0,1', 100), 'grew'); assert.equal(st.rods['0,1'].n, 1); assert.equal(st.r, 1);
  assert.equal(award(st, '0,1', 100), false); assert.equal(st.rods['0,1'].n, 1); assert.equal(st.r, 1, 'no bump on a repeat');
  assert.equal(award(st, '0,1', 50), false); assert.equal(st.r, 1);
  award(st, '0,1', 101); award(st, '0,1', 102);
  assert.equal(st.rods['0,1'].n, 3);
  assert.equal(award(st, '0,1', 103), 'full'); assert.equal(st.rods['0,1'].n, 3); assert.equal(st.rods['0,1'].last, 103);
});

// ---------------------------------------------------------------- module stub
function stubCtx(role = 'solo') {
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(70, 1, 0.05, 200); camera.position.set(0, 1.7, 0); scene.add(camera);
  const raft = new T.Group(); scene.add(raft);
  const world = { tiles: [[0, 0], [0, 1], [1, 0]], decor: [] };
  const emits = [], notices = [], plays = [], actions = [];
  const ctx = {
    T, scene, camera, raft, world, role, physics: { x: 0, z: 1 }, other: { x: 10, z: 10 }, options: { stormFlash: 'full' }, elapsed: 0,
    emit: (e, to) => emits.push({ ...e, to }), notice: s => notices.push(s), play: (e, s) => plays.push([e, s]), action: a => actions.push(a),
    esc: s => String(s), localBag: () => null, rebuildRaft() {}, emits, notices, plays, actions,
  };
  return ctx;
}
const bagOf = (room = 99) => ({ items: {}, add(k, n) { const put = Math.min(n, room); room -= put; this.items[k] = (this.items[k] ?? 0) + put; return n - put; } });

// ---------------------------------------------------------------- 7. storm.collect
test('storm.collect: refuses bad input, out of reach, empty, full bag; moves shards on success', () => {
  resetLive();
  const ctx = stubCtx();
  const m = createStorm(ctx);
  ctx.world.decor.push({ type: 'stormrod', x: 0, z: 1 }, { type: 'kiln', x: 1, z: 0 });
  m.load({ v: 1, r: 4, rods: { '0,1': { n: 2, last: 10 } } }, 'save');
  const n = () => m.debug.slice().rods['0,1'].n;
  assert.equal(m.action({ kind: 'kiln.take' }, 'host', bagOf()), false, 'other kinds are not ours');
  assert.equal(m.action(null, 'host', bagOf()), false);
  assert.equal(m.action({ kind: 'storm.zap' }, 'host', bagOf()), true, 'claims every storm.* kind');
  const b = bagOf();
  assert.equal(m.action({ kind: 'storm.collect', x: 1, z: 0 }, 'host', b), true); assert.equal(n(), 2, 'wrong decor');
  assert.equal(m.action({ kind: 'storm.collect', x: 0.5, z: 1 }, 'host', b), true); assert.equal(n(), 2, 'non-integer');
  assert.equal(m.action({ kind: 'storm.collect', x: 0, z: 1 }, 'guest', b), true); assert.equal(n(), 2, 'guest far away');
  assert.equal(m.action({ kind: 'storm.collect', x: 0, z: 1 }, 'host', bagOf(0)), true); assert.equal(n(), 2, 'bag full keeps shards');
  assert.equal(ctx.emits.at(-1).kind, 'full');
  assert.equal(m.action({ kind: 'storm.collect', x: 0, z: 1 }, 'host', b), true);
  assert.equal(n(), 0); assert.equal(b.items.stormshard, 2); assert.equal(ctx.emits.at(-1).kind, 'loot');
  assert.equal(m.action({ kind: 'storm.collect', x: 0, z: 1 }, 'host', b), true); assert.equal(b.items.stormshard, 2, 'n = 0');
  assert.match(ctx.emits.at(-1).text, /No shards yet/);
  // partial: only room for 1
  m.debug.fill(0, 1, 3);
  const b1 = bagOf(1);
  m.action({ kind: 'storm.collect', x: 0, z: 1 }, 'host', b1);
  assert.equal(b1.items.stormshard, 1); assert.equal(n(), 2);
  // a guest client never applies actions
  const g = createStorm(stubCtx('guest'));
  g.load({ v: 1, r: 1, rods: { '0,1': { n: 2, last: 1 } } }, 'net');
  assert.equal(g.action({ kind: 'storm.collect', x: 0, z: 1 }, 'host', bagOf()), true);
  assert.equal(g.debug.slice().rods['0,1'].n, 2);
  m.dispose(); g.dispose();
});

// ---------------------------------------------------------------- 8. cleanSlice
test('cleanSlice validates, drops, clamps and caps; idempotent', () => {
  for (const bad of [null, undefined, [], 'x', 5, { rods: [] }, { rods: 'x' }]) assert.deepEqual(cleanSlice(bad), { v: 1, r: 0, rods: {} });
  const v = cleanSlice({
    r: 7, rods: {
      '0,1': { n: NaN, last: 3 }, '1,0': { n: 99, last: 4 }, '2,2': { n: -1, last: -1 }, 'a,b': { n: 1, last: 1 }, '1,1,1': { n: 1 },
      '-3,4': { n: 2, last: 1.5 }, '5,5': null, '6,6': { n: 1, last: -9 },
    },
  });
  assert.deepEqual(v, { v: 1, r: 7, rods: { '0,1': { n: 0, last: 3 }, '1,0': { n: 3, last: 4 }, '-3,4': { n: 2, last: -1 }, '6,6': { n: 1, last: -1 } } });
  assert.equal(cleanSlice({ r: -2 }).r, 0); assert.equal(cleanSlice({ r: 1.5 }).r, 0);
  const decorAt = (x, z) => (x === 1 && z === 0 ? 'stormrod' : 'kiln');
  assert.deepEqual(Object.keys(cleanSlice(v, decorAt).rods), ['1,0'], 'save path drops keys without a rod');
  const many = { r: 1, rods: {} };
  for (let i = 0; i < 300; i++) many.rods[`${i},0`] = { n: 1, last: i };
  const c = cleanSlice(many);
  assert.equal(Object.keys(c.rods).length, 256);
  assert.deepEqual(cleanSlice(c), c); assert.deepEqual(cleanSlice(v), v);
});

// ---------------------------------------------------------------- 9. old save / net
test('old saves load calm with no rods; a repeated net revision is a no-op', () => {
  resetLive();
  const m = createStorm(stubCtx());
  m.load(undefined, 'save');
  assert.deepEqual(m.serialize(), { v: 1, r: 0, rods: {} });
  assert.equal(m.serialize(), m.serialize(), 'serialize is cached');
  const g = createStorm(stubCtx('guest'));
  g.load({ v: 1, r: 3, rods: { '0,1': { n: 1, last: 2 } } }, 'net');
  const before = g.debug.slice();
  g.load({ v: 1, r: 3, rods: { '0,1': { n: 3, last: 9 } } }, 'net');
  assert.equal(g.debug.slice(), before, 'same r: kept');
  g.load({ v: 1, r: 4, rods: {} }, 'net');
  assert.notEqual(g.debug.slice(), before);
  m.dispose(); g.dispose();
});

// ---------------------------------------------------------------- 10. flash + settings
test('flashAt stays in bounds per mode; stormFlash setting validates', () => {
  let peak = 0;
  for (let t = -0.1; t < 1; t += 0.001) {
    const f = flashAt(t, 'full'), s = flashAt(t, 'soft');
    assert.ok(f >= 0 && f <= 1 && s >= 0 && s <= 0.25 + 1e-12);
    assert.equal(flashAt(t, 'off'), 0);
    if (t > 0.32) assert.equal(f, 0);
    if (t >= 0.6) assert.equal(s, 0);
    peak = Math.max(peak, f);
  }
  assert.equal(peak, 1);
  assert.ok(Math.abs(flashAt(0.18, 'full') - 0.7) < 1e-9 && Math.abs(flashAt(0.11, 'full') - 0.2) < 1e-9);
  assert.equal(validateSettings({ stormFlash: 'x' }).stormFlash, 'full');
  assert.equal(validateSettings({ stormFlash: 'soft' }).stormFlash, 'soft');
  assert.equal(validateSettings({ stormFlash: 'off' }).stormFlash, 'off');
  assert.equal(validateSettings(null).stormFlash, 'full');
});

// ---------------------------------------------------------------- 11. ocean + audio
test('ocean.setAmp scales waves and returns bit-identical at 1; audio has thunder', () => {
  const fresh = createOcean(T), o = createOcean(T);
  const pts = []; for (let i = 0; i < 50; i++) pts.push([(i * 7.3) % 40 - 20, (i * 3.1) % 30 - 15, i * 0.37]);
  const h0 = pts.map(([x, z, t]) => fresh.getHeight(x, z, t));
  o.setAmp(1.3);
  assert.equal(o.uniforms.uAmp.value, 1.3);
  assert.ok(pts.some(([x, z, t], i) => o.getHeight(x, z, t) !== h0[i]), 'waves changed');
  o.setAmp(1);
  assert.equal(o.uniforms.uAmp.value, 1);
  pts.forEach(([x, z, t], i) => assert.equal(o.getHeight(x, z, t), h0[i]));
  o.setAmp(9); assert.equal(o.uniforms.uAmp.value, 1.6);
  o.setAmp(0.1); assert.equal(o.uniforms.uAmp.value, 0.5);
  o.setAmp(NaN); assert.equal(o.uniforms.uAmp.value, 1);
  assert.match(o.material.vertexShader, /uniform float uAmp/);
  assert.ok(EVENTS.includes('thunder'));
  fresh.dispose(); o.dispose();
});

// ---------------------------------------------------------------- live module: strikes, rewards, guest, daynight hooks
function dnCtx(role = 'solo') {
  const ctx = stubCtx(role);
  ctx.hemi = new T.HemisphereLight('#f2ead4', '#3d6b6a', 1.8); ctx.scene.add(ctx.hemi);
  ctx.sun = new T.DirectionalLight('#fff0c7', 2.5); ctx.scene.add(ctx.sun);
  ctx.scene.background = new T.Color('#cbd2c0'); ctx.scene.fog = new T.Fog('#cbd2c0', 25, 125);
  ctx.renderer = { toneMappingExposure: 1 };
  ctx.clouds = [];
  ctx.ocean = createOcean(T);
  return ctx;
}

test('host and guest see the same strikes; only the host pays the rod, once per strike', () => {
  resetLive();
  const seed = 0xdecaf;
  const [i] = stormSegs(seed, 1, 20);
  const s0 = segmentStart(seed, i), s1 = segmentStart(seed, i + 1);
  const run = role => {
    resetLive();
    const ctx = dnCtx(role);
    ctx.world.decor.push({ type: 'stormrod', x: 0, z: 1 });
    const dn = createDayNight(ctx), m = createStorm(ctx);
    dn.load({ v: 1, clock: s0 - 2, seed }, 'save'); m.load(undefined, 'save');
    let flashes = 0, prevFlash = 0, maxAmp = 1;
    for (let c = 0; c < (s1 - s0) + 4; c += 1 / 30) {
      ctx.elapsed += 1 / 30;
      dn.update(1 / 30); m.update(1 / 30);
      if (STORM_LIVE.flash > 0 && prevFlash === 0) flashes++;
      prevFlash = STORM_LIVE.flash;
      maxAmp = Math.max(maxAmp, ctx.ocean.uniforms.uAmp.value);
    }
    const out = { strikes: m.debug.state().strikes, slice: m.serialize(), emits: ctx.emits.length, plays: ctx.plays.filter(p => p[0] === 'thunder').length, flashes, maxAmp, notices: ctx.notices.slice() };
    dn.dispose(); m.dispose();
    assert.equal(ctx.ocean.uniforms.uAmp.value, 1, 'dispose calms the sea');
    return out;
  };
  const h = run('solo'), g = run('guest');
  const list = strikeList(seed, i), pulled = list.filter(s => rodFor(seed, s.id, strikePos(seed, s.id, {}).r, ['0,1'])).length;
  assert.equal(h.strikes, list.length); assert.equal(g.strikes, list.length);
  assert.ok(h.flashes >= list.length - 1, `flashes ${h.flashes}`);
  assert.ok(h.plays >= list.length - 2, `thunder ${h.plays}`);
  assert.ok(Math.abs(h.maxAmp - 1.3) < 0.01, `amp ${h.maxAmp}`);
  assert.equal(h.slice.rods['0,1']?.n ?? 0, Math.min(3, pulled));
  assert.equal(g.slice.r, 0, 'guest never awards');
  assert.ok(h.notices.includes('A storm is rolling in'));
});

test('a storm never breaks the night floors or the bright noon (existing daynight limits)', () => {
  resetLive();
  const ctx = dnCtx();
  const dn = createDayNight(ctx);
  dn.debug.freeze(true);
  STORM_LIVE.pin = 1; STORM_LIVE.dirty = true;
  dn.debug.setPhase(0.82); for (let i = 0; i < 5; i++) dn.update(1 / 30);
  assert.equal(dn.storm, 1);
  assert.ok(ctx.hemi.intensity >= DN.HEMI_NIGHT - 1e-9 && ctx.sun.intensity >= DN.MOON_I - 1e-9 && ctx.renderer.toneMappingExposure >= 0.85 - 1e-9);
  dn.debug.setPhase(0.31); dn.update(0);
  assert.ok(ctx.sun.intensity > 2);
  const fogFar = ctx.scene.fog.far, exp0 = ctx.renderer.toneMappingExposure, h0 = ctx.hemi.intensity;
  // flash is additive to the cached base and returns exactly
  STORM_LIVE.flash = 1; dn.update(0);
  assert.ok(Math.abs(ctx.hemi.intensity - (h0 + 1.6)) < 1e-9 && Math.abs(ctx.renderer.toneMappingExposure - (exp0 + 0.35)) < 1e-9);
  STORM_LIVE.flash = 0; dn.update(0);
  assert.equal(ctx.hemi.intensity, h0); assert.equal(ctx.renderer.toneMappingExposure, exp0);
  STORM_LIVE.pin = -1; STORM_LIVE.dirty = true; dn.update(0);
  assert.ok(ctx.scene.fog.far >= fogFar, 'calm again');
  dn.dispose();
  assert.equal(STORM_LIVE.ready, false);
});

// ---------------------------------------------------------------- 12. safety
test('safety: no hurtPlayer, registered after daynight, daynight=off stays calm', () => {
  const s = src('storm.js');
  assert.ok(!/hurtPlayer/.test(s.replace(/^\/\/.*$/gm, '')), 'storm.js never hurts anyone');
  assert.ok(!/new T\.(Point|Spot|Directional|Hemisphere)Light/.test(s + src('storm-model.js')), 'no new lights');
  const content = src('content.js');
  const feats = /const FEATURES = \[([^\]]*)\]/.exec(content)[1].split(',').map(x => x.trim());
  assert.equal(feats.indexOf('createStorm'), feats.indexOf('createDayNight') + 1);
  // daynight=off: createDayNightOff never sets ready, so the storm module stays calm and strikes nothing
  resetLive();
  const ctx = stubCtx();
  ctx.ocean = createOcean(T);
  const off = DN.createDayNightOff(ctx), m = createStorm(ctx);
  off.load({ v: 1, clock: 100, seed: 1 }, 'save');
  for (let i = 0; i < 600; i++) { ctx.elapsed += 0.1; off.update?.(0.1); m.update(0.1); }
  assert.equal(STORM_LIVE.level, 0); assert.equal(m.debug.state().strikes, 0); assert.equal(ctx.ocean.uniforms.uAmp.value, 1);
  m.dispose();
});

test('debug helpers: place, fill, force, strike (visual only), next; forecast is pure', () => {
  resetLive();
  const ctx = dnCtx();
  const dn = createDayNight(ctx), m = createStorm(ctx);
  ctx.rebuildRaft = () => { for (const d of ctx.world.decor) { const g = m.decorModel(d.type); if (g) { g.position.set(d.x * 2, 0.22, d.z * 2); ctx.raft.add(g); } } };
  dn.update(1 / 60);
  assert.equal(m.debug.place(0, 1), true);
  assert.equal(m.debug.place(5, 5), false, 'no tile');
  assert.equal(m.debug.place(1, 0, 'stormglass'), true);
  assert.equal(m.debug.fill(0, 1, 2), true);
  m.update(1 / 60);
  const rod = ctx.raft.children.find(g => g.name === 'storm_rod');
  assert.deepEqual(rod.userData.rod.slots.map(s => s.visible), [true, true, false]);
  assert.equal(m.debug.force(1), true); dn.update(1 / 60); m.update(1 / 60);
  assert.equal(dn.storm, 1);
  const r0 = m.debug.slice().r;
  assert.equal(m.debug.strike({ rod: '0,1' }), true);
  assert.equal(m.debug.strike({ a: 1, r: 40 }), false, 'needs 1 s between strikes');
  const bolt = ctx.scene.children.find(o => o.name === 'storm_bolt');
  assert.ok(bolt && bolt.visible);
  assert.equal(bolt.geometry.attributes.position.count, 76); assert.equal(bolt.geometry.index.count / 3, 68);
  for (let i = 0; i < 60; i++) { ctx.elapsed += 1 / 30; dn.update(1 / 30); m.update(1 / 30); }
  assert.equal(bolt.visible, false); assert.equal(STORM_LIVE.flash, 0);
  assert.equal(m.debug.slice().r, r0, 'debug strikes never reward');
  ctx.options.stormFlash = 'off';
  ctx.elapsed += 2; assert.equal(m.debug.strike({ a: 1, r: 40 }), true); m.update(1 / 60);
  assert.equal(bolt.visible, false); assert.equal(STORM_LIVE.flash, 0);
  m.debug.force(null);
  const [si] = stormSegs(0xdecaf, 1, 5);
  dn.load({ v: 1, clock: segmentStart(0xdecaf, si - 3) + 1, seed: 0xdecaf }, 'save'); dn.update(1 / 60);
  const nx = m.debug.next();
  assert.equal(nx.index, si);
  assert.ok(nx && isStormSegment(STORM_LIVE.seed, nx.index) && nx.inSec > 0);
  const fc = nextStorm(STORM_LIVE.seed, STORM_LIVE.clock, {});
  assert.equal(fc.index, nx.index);
  dn.dispose(); m.dispose();
});
