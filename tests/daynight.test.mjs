// Unit tests for the day/night and weather module (pure functions + module with a stub ctx).
// Run: node --test tests/daynight.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const DN = await import(new URL('daynight.js', base));
const {
  DAY_SECONDS: DAY, NIGHT_FLOOR, WEATHERS, POOL_LIGHTS, N_COLORS, PALETTE_KEYS, RAIN_MIX,
  phaseAt, lightAt, segmentAt, segmentIndexAt, weatherAt, paletteAt, cleanDayNight, driftStep, createDayNight, rainBlend,
} = DN;

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} expected ${b} got ${a}`);

// small deterministic PRNG for simulations
function prng(s) { return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------------------------------------------------------------- phaseAt
test('phaseAt wraps, never returns 1, rejects bad input', () => {
  assert.equal(phaseAt(0), 0);
  near(phaseAt(3 * DAY + 300), 0.25, 1e-12);
  assert.ok(phaseAt(DAY - 1e-9) < 1);
  assert.equal(phaseAt(DAY), 0);
  for (const bad of [NaN, -1, -DAY, Infinity, -Infinity, undefined, null, '5']) assert.equal(phaseAt(bad), 0, String(bad));
});

// ---------------------------------------------------------------- lightAt
test('lightAt keeps the night readable and changes smoothly', () => {
  const out = { sunHeight: 0, nightFactor: 0, light: 0 };
  assert.equal(lightAt(0.3, out), out);
  let prevL = null, prevN = null;
  for (let i = 0; i <= 10000; i++) {
    const p = (i % 10000) / 10000;
    lightAt(p, out);
    assert.ok(out.light >= NIGHT_FLOOR && out.light <= 1);
    assert.ok(out.nightFactor >= 0 && out.nightFactor <= 1);
    assert.ok(out.sunHeight >= -1 && out.sunHeight <= 1);
    if (prevL !== null) { assert.ok(Math.abs(out.light - prevL) < 0.02); assert.ok(Math.abs(out.nightFactor - prevN) < 0.02); }
    prevL = out.light; prevN = out.nightFactor;
  }
  near(lightAt(0.31, out).nightFactor, 0, 1e-9);
  near(lightAt(0.82, out).nightFactor, 1, 1e-9);
  near(out.light, NIGHT_FLOOR, 1e-9);
  assert.ok(lightAt(0.31, out).sunHeight > 0.9, 'sun high at noon');
  assert.ok(lightAt(0.82, out).sunHeight < -0.5, 'sun below at night');
  // wrap 0.999 -> 0 is continuous
  const a = lightAt(0.999, {}), b = lightAt(0, {});
  assert.ok(Math.abs(a.light - b.light) < 0.02 && Math.abs(a.nightFactor - b.nightFactor) < 0.02);
});

// ---------------------------------------------------------------- weather schedule
test('segments are deterministic, 180 to 360 s long, and rain never follows rain', () => {
  const s1 = segmentAt(1234, 7, {}), s2 = segmentAt(1234, 7, {});
  assert.deepEqual(s1, s2);
  let prev = segmentAt(99, -1, {});
  const counts = { calm: 0, breezy: 0, rain: 0 };
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const s = segmentAt(99, i, {});
    assert.ok(s.length >= 180 && s.length <= 360, `length ${s.length}`);
    near(s.start, prev.start + prev.length, 1e-6, 'contiguous');
    assert.ok(!(s.weather === 'rain' && prev.weather === 'rain'), `rain after rain at ${i}`);
    assert.ok(WEATHERS.includes(s.weather));
    counts[s.weather]++;
    prev = s;
  }
  near(counts.calm / N, 0.5, 0.05, 'calm share');
  near(counts.breezy / N, 0.3, 0.05, 'breezy share');
  near(counts.rain / N, 0.2, 0.05, 'rain share');
  // different seeds diverge within 20 segments
  let diff = false;
  for (let i = 0; i < 20 && !diff; i++) diff = segmentAt(1, i, {}).weather !== segmentAt(2, i, {}).weather;
  assert.ok(diff);
});

test('segmentIndexAt finds the segment containing the clock', () => {
  const r = prng(7);
  for (let k = 0; k < 500; k++) {
    const seed = (r() * 2 ** 32) >>> 0, c = r() * 1e7;
    const s = segmentAt(seed, segmentIndexAt(seed, c), {});
    assert.ok(c >= s.start && c < s.start + s.length);
  }
});

test('weatherAt is deterministic across imports and blends monotonically', async () => {
  const fresh = await import(new URL('daynight.js?again=1', base));
  for (const c of [0, 10, 1234.5, 99999, 5e8]) assert.deepEqual(weatherAt(42, c, {}), fresh.weatherAt(42, c, {}));
  const out = {};
  assert.equal(weatherAt(5, 100, out), out);
  // find a transition and walk through it
  for (let i = 1; i < 60; i++) {
    const s = segmentAt(5, i, {}), next = segmentAt(5, i + 1, {});
    if (s.weather === next.weather) continue;
    let last = -1;
    for (let t = s.start + s.length - 25; t < s.start + s.length; t += 0.5) {
      weatherAt(5, t, out);
      assert.ok(out.blend >= last, 'monotonic'); last = out.blend;
      assert.equal(out.weather, s.weather); assert.equal(out.weatherNext, next.weather);
    }
    break;
  }
  for (let c = 0; c < 2e5; c += 37.3) {
    weatherAt(77, c, out);
    for (const k of ['rain', 'wind', 'cloud', 'blend']) assert.ok(out[k] >= 0 && out[k] <= 1, `${k}=${out[k]}`);
  }
});

// ---------------------------------------------------------------- palette
test('paletteAt hits keys, averages midway, stays in range and wraps', () => {
  const out = new Float32Array(N_COLORS * 3);
  assert.equal(paletteAt(0.5, 0, out), out);
  for (const k of PALETTE_KEYS) {
    paletteAt(k.phase, 0, out);
    for (let j = 0; j < out.length; j++) near(out[j], k.c[j], 1e-6, `key ${k.phase}`);
  }
  for (let i = 0; i < PALETTE_KEYS.length; i++) {
    const a = PALETTE_KEYS[i], b = PALETTE_KEYS[(i + 1) % PALETTE_KEYS.length];
    const pb = i + 1 < PALETTE_KEYS.length ? b.phase : 1;
    paletteAt((a.phase + pb) / 2, 0, out);
    for (let j = 0; j < out.length; j++) near(out[j], (a.c[j] + b.c[j]) / 2, 1e-5, `mid ${a.phase}`);
  }
  for (let p = 0; p < 1; p += 0.0013) for (const r of [0, 0.5, 1]) { paletteAt(p, r, out); for (const v of out) assert.ok(v >= 0 && v <= 1); }
  const x = new Float32Array(N_COLORS * 3), y = new Float32Array(N_COLORS * 3);
  paletteAt(0.99999, 0, x); paletteAt(0, 0, y);
  for (let j = 0; j < x.length; j++) near(x[j], y[j], 1e-3, 'wrap');
  // rain 1: horizon equals the rain tint blend of the dry colour
  paletteAt(0.3, 0, x); paletteAt(0.3, 1, y);
  const want = new Float32Array(3); rainBlend(x[0], x[1], x[2], 1, want, 0);
  for (let j = 0; j < 3; j++) near(y[j], want[j], 1e-6);
  assert.ok(RAIN_MIX > 0 && y[0] !== x[0]);
});

test('night palette is a cosy blue, not black', () => {
  const out = new Float32Array(N_COLORS * 3);
  paletteAt(0.82, 0, out);
  const [r, g, b] = out;
  assert.ok(b > r && b > g, 'horizon is blue');
  assert.ok(0.3 * r + 0.59 * g + 0.11 * b > 0.15, 'horizon is not black');
});

// ---------------------------------------------------------------- validation
test('cleanDayNight rejects garbage and never throws', () => {
  const bad = [undefined, null, 'x', 3, [], [1, 2], {}, { clock: NaN, seed: 1 }, { clock: Infinity, seed: 1 }, { clock: -1, seed: 1 }, { clock: 1.3e9, seed: 1 },
    { clock: 10, seed: 1.5 }, { clock: 10, seed: -1 }, { clock: 10, seed: 2 ** 32 }, { clock: '10', seed: 1 }, { clock: 10 }, { seed: 4 }, { v: 2, clock: 1, seed: 1 }];
  for (const v of bad) assert.equal(cleanDayNight(v), null, JSON.stringify(v));
  const good = { v: 1, clock: 123.45, seed: 4000000000, extra: 'drop me' };
  const c = cleanDayNight(good);
  assert.deepEqual(c, { v: 1, clock: 123.45, seed: 4000000000 });
  assert.notEqual(c, good);
  assert.deepEqual(cleanDayNight({ clock: 5, seed: 0 }), { v: 1, clock: 5, seed: 0 });
  assert.deepEqual(cleanDayNight({ v: 0, clock: 5, seed: 0 }), { v: 1, clock: 5, seed: 0 });
});

// ---------------------------------------------------------------- stub ctx
function stubCtx(role = 'solo') {
  const scene = new T.Scene();
  scene.background = new T.Color('#cbd2c0'); scene.fog = new T.Fog('#cbd2c0', 25, 125);
  const camera = new T.PerspectiveCamera(70, 1, 0.05, 200); camera.position.set(0, 1.7, 0); scene.add(camera);
  const hemi = new T.HemisphereLight('#f2ead4', '#3d6b6a', 1.8); scene.add(hemi);
  const sun = new T.DirectionalLight('#fff0c7', 2.5); sun.position.set(-15, 28, 12); scene.add(sun);
  const raft = new T.Group(); scene.add(raft);
  const clouds = [];
  for (let i = 0; i < 3; i++) { const g = new T.Group(); g.add(new T.Mesh(new T.IcosahedronGeometry(1, 1), new T.MeshStandardMaterial())); scene.add(g); clouds.push(g); }
  const ocean = { uniforms: { uSky: { value: new T.Color() }, uZenith: { value: new T.Color() }, uDeep: { value: new T.Color() }, uShallow: { value: new T.Color() }, uSunDir: { value: new T.Vector3(0, 1, 0) }, uSunColor: { value: new T.Color('#fff3d6') }, uFadeFar: { value: 125 } } };
  const world = { decor: [] };
  const ctx = { T, scene, camera, hemi, sun, raft, clouds, ocean, world, role, renderer: { toneMappingExposure: 1 }, localBag: () => null, action: () => {} };
  return ctx;
}
function addLantern(ctx, x, z) {
  const g = new T.Group(); g.name = 'craft_lantern'; g.position.set(x, 0.22, z);
  for (const [name, e] of [['lanternGlow', 1.6], ['flame', 3], ['lanternGlass', 0.6], ['candle', 0.25]]) {
    const m = new T.Mesh(new T.SphereGeometry(0.05), new T.MeshStandardMaterial({ emissive: 0xff9a3c, emissiveIntensity: e })); m.name = name; m.position.set(0, 0, 0);
    m.geometry.translate(0.3, 1.24, 0); g.add(m);
  }
  ctx.raft.add(g); ctx.world.decor.push({ type: 'lantern', x: x / 2, z: z / 2 });
  return g;
}

test('module runs headless without throwing; light and child counts stay fixed', () => {
  const ctx = stubCtx();
  const m = createDayNight(ctx);
  assert.equal(m.name, 'daynight');
  const lights = () => { let n = 0; ctx.scene.traverse(o => { if (o.isLight) n++; }); return n; };
  m.load(undefined, 'save'); m.load('garbage', 'net'); m.load({ clock: 'x' }, 'restore');
  m.update(1 / 60);
  const nLights = lights(), nChildren = ctx.scene.children.length;
  assert.equal(nLights, 2, 'no pool lights before the first lantern');
  m.debug.setPhase(0.31); m.update(1 / 60);
  assert.equal(m.debug.state().poolLit, 0);
  for (const l of ctx.scene.children) if (l.isPointLight) assert.equal(l.intensity, 0, 'pool lights off at noon');
  near(ctx.ocean.uniforms.uSky.value.r, ctx.scene.fog.color.r, 1e-9); // horizon seamless
  assert.ok(ctx.scene.fog.color.equals(ctx.scene.background));
  for (let i = 0; i < 10000; i++) m.update(1 / 60);
  assert.equal(lights(), nLights); assert.equal(ctx.scene.children.length, nChildren);
  m.dispose();
  assert.equal(lights(), 2); assert.equal(ctx.renderer.toneMappingExposure, 1);
  assert.ok(ctx.scene.background.equals(new T.Color('#cbd2c0')));
});

test('night is readable: brightness floors hold and lanterns light up', () => {
  const ctx = stubCtx();
  const m = createDayNight(ctx);
  const g = addLantern(ctx, 2, 0);
  m.debug.setPhase(0.82); m.debug.freeze(true);
  for (let i = 0; i < 40; i++) m.update(1 / 30);
  assert.ok(ctx.hemi.intensity >= 0.75 - 1e-9, `hemi ${ctx.hemi.intensity}`);
  assert.ok(ctx.sun.intensity >= 0.55 - 1e-9, `sun ${ctx.sun.intensity}`);
  assert.ok(ctx.renderer.toneMappingExposure >= 0.85 - 1e-9);
  const st = m.debug.state();
  assert.equal(st.lanterns, 1); assert.equal(st.poolLit, 1);
  near(g.children.find(c => c.name === 'flame').material.emissiveIntensity, 3 * 1.6, 1e-6);
  near(g.children.find(c => c.name === 'lanternGlow').material.emissiveIntensity, 1.6 * 2.4, 1e-6);
  assert.equal(ctx.scene.children.filter(o => o.isPointLight).length, POOL_LIGHTS);
  const lit = ctx.scene.children.filter(o => o.isPointLight && o.intensity > 0);
  assert.equal(lit.length, 1);
  near(lit[0].position.x, 2.3, 1e-3); near(lit[0].position.y, 1.46, 1e-3);
  // removing the lantern (raft rebuilt) restores and drops it within half a second
  ctx.raft.remove(g); ctx.world.decor.length = 0;
  for (let i = 0; i < 20; i++) m.update(1 / 30);
  assert.equal(m.debug.state().lanterns, 0); assert.equal(m.debug.state().poolLit, 0);
  assert.equal(ctx.scene.children.filter(o => o.isPointLight).length, POOL_LIGHTS, 'pool stays once added (no program churn)');
  m.dispose();
  assert.equal(ctx.scene.children.filter(o => o.isPointLight).length, 0);
});

test('a lantern placed later adds the pool after compileAsync warms the new programs', async () => {
  const ctx = stubCtx();
  let compiled = 0, lightsAtCompile = -1;
  ctx.renderer.compileAsync = scene => { compiled++; lightsAtCompile = scene.children.filter(o => o.isPointLight).length; return Promise.resolve(); };
  const m = createDayNight(ctx);
  m.debug.setPhase(0.82); m.debug.freeze(true);
  m.update(1 / 30);
  addLantern(ctx, 2, 0);
  for (let i = 0; i < 20; i++) m.update(1 / 30);
  assert.equal(compiled, 1); assert.equal(lightsAtCompile, POOL_LIGHTS);
  await new Promise(r => setTimeout(r, 0));
  m.update(1 / 30);
  assert.equal(ctx.scene.children.filter(o => o.isPointLight).length, POOL_LIGHTS);
  assert.equal(m.debug.state().poolLit, 1);
  m.dispose();
});

test('debug setWeather pins rain and shows the streaks; invalid names ignored', () => {
  const ctx = stubCtx();
  const m = createDayNight(ctx);
  m.debug.setWeather('rain'); m.update(0.02);
  assert.equal(m.debug.state().weather, 'rain');
  assert.ok(ctx.scene.getObjectByName('daynight-rain').visible);
  assert.ok(ctx.scene.fog.far < 90);
  m.debug.setWeather('hail'); m.update(0.02);
  assert.equal(m.debug.state().weather, 'rain');
  m.debug.setWeather('calm'); m.update(0.02);
  assert.ok(!ctx.scene.getObjectByName('daynight-rain').visible);
  m.debug.setWeather(null); m.update(0.02);
  assert.equal(m.debug.state().pinned.weather, null);
  m.dispose();
});

// ---------------------------------------------------------------- save round trip
test('serialize round trips through JSON and load', () => {
  const ctx = stubCtx();
  const a = createDayNight(ctx);
  for (let i = 0; i < 100; i++) a.update(0.05);
  const s = a.serialize();
  assert.equal(a.serialize(), s, 'reused object');
  const back = cleanDayNight(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back, { v: 1, clock: s.clock, seed: s.seed });
  const b = createDayNight(stubCtx());
  b.load(back, 'save');
  assert.deepEqual({ ...b.serialize() }, { ...s });
  // an old save (undefined) keeps the morning default
  const c = createDayNight(stubCtx()); c.load(undefined, 'save');
  near(phaseAt(c.serialize().clock), 0.1, 1e-3);
  a.dispose(); b.dispose(); c.dispose();
});

// ---------------------------------------------------------------- driftStep
test('driftStep snaps big errors, slews small ones, never runs backwards', () => {
  assert.equal(driftStep(10, 100, 1 / 60), 100);
  assert.equal(driftStep(100, 10, 1 / 60), 10);
  assert.equal(driftStep(50, 50, 0.1), 50.1);
  for (const err of [-4.9, -1, -0.2, 0.3, 1, 4.9]) {
    let local = 1000, target = 1000 + err, t = 0;
    while (Math.abs(target - local) > 0.01 && t < 120) { const dt = 1 / 60; const next = driftStep(local, target, dt); target += dt; assert.ok(next > local); assert.ok(next - local <= dt * 1.1 + 1e-12 && next - local >= dt * 0.9 - 1e-12); local = next; t += dt; }
    assert.ok(t < 15 || Math.abs(err) > 1.5, `err ${err} took ${t}s`);
    assert.ok(Math.abs(target - local) <= 0.01 || t < 120);
  }
  const r = prng(3);
  for (let i = 0; i < 2000; i++) { const l = r() * 1e6, dt = 1e-4 + r() * 0.1; assert.ok(driftStep(l, l + (r() - 0.5) * 9, dt) > l); }
});

// ---------------------------------------------------------------- co-op
test('co-op: guest clock tracks the host smoothly through jittery state messages', () => {
  const hostCtx = stubCtx('host'), guestCtx = stubCtx('guest');
  const host = createDayNight(hostCtx), guest = createDayNight(guestCtx);
  host.load({ v: 1, clock: 700, seed: 31337 }, 'save');
  guest.load({ v: 1, clock: 50, seed: 1 }, 'save'); // guest's own world, far away
  const r = prng(11), dt = 1 / 60;
  const inbox = []; // [deliverAt, json]
  let now = 0, sendClock = 0, prevGuest = null, maxErr = 0, snaps = 0;
  for (let f = 0; f < 60 * 120; f++) { // two minutes
    now += dt; host.update(dt);
    sendClock += dt;
    if (sendClock >= 0.12) { sendClock = 0; inbox.push([now + 0.03 + r() * 0.25, JSON.stringify({ ext: { daynight: host.serialize() } })]); }
    if (r() < 0.02) inbox.length && inbox.shift(); // packet loss
    while (inbox.length && inbox[0][0] <= now) { const msg = JSON.parse(inbox.shift()[1]); guest.load(msg.ext.daynight, 'net'); guest.load(msg.ext.daynight, 'net'); }
    const gFrameStart = guest.debug.state().clock;
    guest.update(dt);
    const g = guest.debug.state().clock;
    if (prevGuest !== null) {
      const step = g - gFrameStart;
      if (Math.abs(g - prevGuest - dt) > 1) snaps++;
      else assert.ok(step > 0 && step <= dt * 1.1 + 1e-9, `step ${step}`);
    }
    prevGuest = g;
    if (now > 15) maxErr = Math.max(maxErr, Math.abs(host.debug.state().clock - g));
  }
  assert.equal(snaps, 1, 'one snap when joining');
  assert.ok(maxErr < 0.4, `guest within 0.4 s of host (got ${maxErr})`);
  assert.equal(guest.debug.state().seed, 31337);
  // both peers agree on the weather
  assert.deepEqual(weatherAt(31337, host.debug.state().clock, {}).weather, guest.debug.state().weather);
  // host debug jump: guest snaps on the next message
  host.debug.setPhase(0.82); host.update(dt);
  guest.load(cleanDayNight(JSON.parse(JSON.stringify(host.serialize()))), 'net'); guest.update(dt);
  near(guest.debug.state().phase, 0.82, 0.01);
  host.dispose(); guest.dispose();
});
