// [musicbox] Wind-up Music Box (docs/specs/musicbox.md §8): seeded composer, phase math, slice, model, audio box(),
// the content module's scheduler / hysteresis / double-E / undecor / old-host notice, and the item + settings hooks.
// Run: node --test tests/musicbox.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = name => readFileSync(fileURLToPath(new URL(name, base)), 'utf8');
// musicbox.js imports daynight.js with the build stamp; import the same specifier so STORM_LIVE is the same object.
const STAMP = (/from '\.\/daynight\.js(\?[^']*)?'/.exec(src('musicbox.js')) ?? [])[1] ?? '';
const CORE_STAMP = (/from '\.\/musicbox-core\.js(\?[^']*)?'/.exec(src('musicbox.js')) ?? [])[1] ?? '';
const T = await import(new URL('vendor/three.module.js', base));
const { STORM_LIVE } = await import(new URL('daynight.js' + STAMP, base));
const core = await import(new URL('musicbox-core.js' + CORE_STAMP, base));
const { TUNES, TUNE_COUNT, SCALES, LOOKAHEAD, BOX_CAP, mulberry32, midiHz, compose, phaseAt, windowNotes, boxGain, cleanBoxes, applySet } = core;
const { buildMusicBox } = await import(new URL('musicbox-model.js', base));
const { createMusicBox } = await import(new URL('musicbox.js', base));

const checksum = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h.toString(16); };
const melody = t => t.notes.filter(n => !n.bass);

test('1. determinism: compose is stable across a fresh import; mulberry32 and per-tune checksums are pinned', async () => {
  const fresh = await import(new URL('musicbox-core.js?x=' + Date.now(), base));
  for (let i = 0; i < TUNE_COUNT; i++) assert.deepEqual(fresh.compose(i), compose(i), TUNES[i].name);
  const r = mulberry32(1), seq = Array.from({ length: 5 }, () => r().toFixed(8));
  assert.deepEqual(seq, PIN_RNG);
  const sums = TUNES.map((_, i) => checksum(compose(i).notes.map(n => n.m + ':' + n.t.toFixed(4)).join(',')));
  assert.deepEqual(sums, PIN_SUMS);
  assert.equal(compose(0), compose(0), 'memoised');
  assert.equal(compose(7), compose(0)); assert.equal(compose(1.5), compose(0)); assert.equal(compose('x'), compose(0));
  assert.ok(Object.isFrozen(compose(2).notes) && Object.isFrozen(compose(2).notes[0]));
  assert.equal(Math.round(midiHz(69)), 440);
});
const PIN_RNG = ['0.62707394', '0.00273572', '0.52744704', '0.98105097', '0.96837790']; // the reference mulberry32(1) sequence
const PIN_SUMS = ['a7a154ea', '3a7df5e', 'a1dcc7bf', '2065c0c9', 'b942b77']; // FNV-1a of "m:t" per note, recorded at build

test('2. scales, ranges, loop length, tonic ending, sorted notes', () => {
  for (let i = 0; i < TUNE_COUNT; i++) {
    const d = TUNES[i], t = compose(i), sc = SCALES[d.scale];
    assert.ok(d.bars >= 8 && d.bars <= 16);
    assert.ok(Math.abs(t.loop - d.bars * d.meter * t.step) < 1e-9);
    assert.ok(t.loop >= 8 && t.loop <= 40, d.name + ' loop ' + t.loop);
    for (const n of t.notes) {
      const pc = ((n.m - d.root) % 12 + 12) % 12;
      assert.ok((n.bass ? SCALES.major : sc).includes(pc), `${d.name} ${n.m} pc ${pc}`);
      assert.ok(n.hz >= 80 && n.hz <= 2000);
      assert.ok(n.t >= 0 && n.t < t.loop);
    }
    for (let k = 1; k < t.notes.length; k++) assert.ok(t.notes[k].t >= t.notes[k - 1].t, 'sorted');
    const mel = melody(t), lastBar = (d.bars - 1) * d.meter * t.step, end = mel.filter(n => n.t >= lastBar - 1e-9).at(-1);
    assert.ok(end, 'final bar has a melody note');
    assert.equal(((end.m - d.root) % 12 + 12) % 12, 0, d.name + ' ends on the tonic');
  }
});

test('3. originality: no two tunes share their first 8 melody midis; names distinct', () => {
  const heads = TUNES.map((_, i) => melody(compose(i)).slice(0, 8).map(n => n.m).join(' '));
  assert.equal(new Set(heads).size, TUNE_COUNT, heads.join(' | '));
  assert.equal(new Set(TUNES.map(t => t.name)).size, TUNE_COUNT);
});

test('4. phase math, windowNotes wrap, boxGain', () => {
  assert.equal(phaseAt(10, 4, 6), 0); assert.equal(phaseAt(3, 4, 6), 5);
  assert.equal(phaseAt(NaN, 0, 6), 0); assert.equal(phaseAt(1, NaN, 6), 0); assert.equal(phaseAt(1, 0, NaN), 0);
  const t = compose(1), out = [];
  const p0 = t.notes.at(-1).t - 0.01, n = windowNotes(t, p0, t.loop - p0 + 0.01, out);
  assert.equal(n, out.length); assert.ok(n >= 2);
  assert.ok(out[0].n.t === t.notes.at(-1).t && out.at(-1).n.t === 0, 'end then start');
  for (let k = 1; k < n; k++) assert.ok(out[k].dt > out[k - 1].dt - 1e-12);
  const all = [];
  windowNotes(t, 3.3, t.loop, all);
  assert.equal(all.length, t.notes.length);
  assert.equal(new Set(all.map(c => c.n)).size, t.notes.length, 'each note once');
  assert.equal(boxGain(0), 1); assert.equal(boxGain(1.5), 1); assert.equal(boxGain(14), 0); assert.equal(boxGain(NaN), 0); assert.equal(boxGain(20), 0);
  let prev = 1; for (let d = 1.5; d <= 14; d += 0.25) { const g = boxGain(d); assert.ok(g <= prev + 1e-12); prev = g; }
});

test('5. slice: cleanBoxes and applySet', () => {
  const decor = [];
  for (let i = 0; i < 20; i++) decor.push({ type: 'musicbox', x: i, z: 0 });
  decor.push({ type: 'crate', x: 0, z: 5 });
  const raw = { v: 1, r: 3, b: { 'bad': { on: 1, t: 0, s: 1 }, '1,0': { on: 2, t: 7, s: NaN }, '2,0': { on: 1, t: 1.5, s: 4.567 }, '0,5': { on: 1, t: 1, s: 1 } } };
  Object.defineProperty(raw.b, '__proto__', { value: { on: 1, t: 1, s: 1 }, enumerable: true });
  const c = cleanBoxes(raw, decor);
  assert.deepEqual(c, { v: 1, r: 3, b: { '1,0': { on: 0, t: 0, s: 0 }, '2,0': { on: 1, t: 0, s: 4.57 } } });
  assert.deepEqual(cleanBoxes(JSON.parse(JSON.stringify(c)), decor), c, 'JSON round trip');
  assert.deepEqual(cleanBoxes(undefined), { v: 1, r: 0, b: {} });
  assert.deepEqual(cleanBoxes([1, 2]), { v: 1, r: 0, b: {} });
  const many = { b: {} }; for (let i = 0; i < 20; i++) many.b[i + ',0'] = { on: 1, t: 0, s: 0 };
  assert.equal(Object.keys(cleanBoxes(many).b).length, BOX_CAP);
  assert.deepEqual(Object.keys(cleanBoxes(many, [{ type: 'musicbox', x: 3, z: 0 }]).b), ['3,0'], 'prunes keys without a tile');
  const st = cleanBoxes(undefined);
  assert.equal(applySet(st, decor, { key: '1,0', on: 1, t: 2 }, 123.456), true);
  assert.deepEqual(st.b['1,0'], { on: 1, t: 2, s: 123.46 });
  assert.equal(applySet(st, decor, { key: '1,0', on: 0, t: 2 }, 200), true);
  assert.deepEqual(st.b['1,0'], { on: 0, t: 2, s: 123.46 }, 'stop keeps s');
  assert.equal(applySet(st, decor, { key: '0,5', on: 1, t: 0 }, 1), false, 'no musicbox on the tile');
  assert.equal(applySet(st, decor, { key: '1,0', on: 1, t: 5 }, 1), false);
  assert.equal(applySet(st, decor, { key: '1,0', on: 3, t: 1 }, 1), false);
  for (let i = 2; i < 2 + BOX_CAP - 1; i++) assert.equal(applySet(st, decor, { key: i + ',0', on: 1, t: 0 }, 1), true);
  assert.equal(Object.keys(st.b).length, BOX_CAP);
  assert.equal(applySet(st, decor, { key: '19,0', on: 1, t: 0 }, 1), false, '17th key refused');
});

test('6. model: userData parts, fits a .4 m box, at most 20 meshes', () => {
  const g = buildMusicBox(T);
  assert.ok(g.userData.lidPivot && g.userData.cylinder && g.userData.crank);
  let meshes = 0; g.traverse(o => { if (o.isMesh) meshes++; });
  assert.ok(meshes <= 20, 'meshes ' + meshes);
  for (const lid of [0, -1.75]) {
    g.userData.lidPivot.rotation.x = lid; g.updateMatrixWorld(true);
    const s = new T.Box3().setFromObject(g).getSize(new T.Vector3());
    assert.ok(s.x <= 0.4 && s.y <= 0.4 && s.z <= 0.4, `lid ${lid}: ${s.x.toFixed(3)} ${s.y.toFixed(3)} ${s.z.toFixed(3)}`);
  }
  const rays = []; g.traverse(o => { if (o.isMesh && !Object.prototype.hasOwnProperty.call(o, 'raycast')) rays.push(o.name); });
  assert.deepEqual(rays.sort(), ['body', 'lid']);
});

// Fake Web Audio graph (tests/survival.test.mjs pattern) that records setTargetAtTime targets.
function fakeAudioContext() {
  const live = new Set(), sources = new Set(), targets = [];
  const param = v => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(x, t, k) { targets.push(x); }, cancelScheduledValues() {} });
  const node = (extra = {}) => { const n = { connect(d) { live.add(n); return d; }, disconnect() { live.delete(n); }, ...extra }; return n; };
  const source = extra => { const s = node({ stopped: false, onended: null, start() { sources.add(s); }, stop() { s.stopped = true; }, ...extra }); return s; };
  const ctx = {
    state: 'suspended', currentTime: 0, sampleRate: 8000, destination: node(),
    resume() { ctx.state = 'running'; return Promise.resolve(); },
    createGain: () => node({ gain: param(1) }),
    createBiquadFilter: () => node({ frequency: param(350), Q: param(1), type: 'lowpass' }),
    createDynamicsCompressor: () => node({ threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0) }),
    createOscillator: () => source({ frequency: param(440), detune: param(0), type: 'sine' }),
    createBufferSource: () => source({ buffer: null, loop: false }),
    createBuffer: (c, len, rate) => { const d = new Float32Array(len); return { duration: len / rate, getChannelData: () => d }; },
    endOneShots() { for (const s of [...sources]) if (!s.loop && s.stopped) { sources.delete(s); s.onended?.(); } },
  };
  return { ctx, live, sources, targets };
}

test('7. audio box(): validation, 8-voice cap, duck under effects, now getter', async () => {
  const { createOceanAudio } = await import(new URL('audio.js', base));
  const none = createOceanAudio({ ambience: false });
  assert.equal(none.box(440, 0, 1), false, 'no context');
  assert.equal(none.now, null);
  const { ctx, live, targets } = fakeAudioContext();
  const a = createOceanAudio({ context: ctx, volume: 0.5, ambience: false });
  assert.equal(await a.resume(), true);
  ctx.currentTime = 5;
  assert.equal(a.now, 5);
  const base0 = live.size;
  assert.equal(a.box(50, 5.1, 1), false, 'hz too low');
  assert.equal(a.box(2500, 5.1, 1), false, 'hz too high');
  assert.equal(a.box(440, 4.9, 1), false, 'in the past');
  assert.equal(a.box(440, 6.2, 1), false, 'more than 1 s ahead');
  assert.equal(a.box(440, 5.1, 0), false, 'silent');
  assert.equal(a.box(440, NaN, 1), false);
  for (let i = 0; i < 8; i++) assert.equal(a.box(300 + i * 50, 5.05 + i * 0.01, 0.8), true, 'voice ' + i);
  assert.equal(a.box(440, 5.2, 1), false, '9th live box voice refused');
  ctx.endOneShots();
  assert.equal(live.size, base0, 'box voices disconnect when they end');
  assert.equal(a.box(440, 5.2, 1), true);
  ctx.endOneShots();
  targets.length = 0;
  assert.equal(a.play('build'), true);
  assert.ok(targets.includes(0.45) && targets.includes(1), 'music ducks then recovers');
  a.destroy();
  assert.equal(live.size, 0);
});

// ------------------------------------------------------------------ module with a stub ctx
function makeCtx({ role = 'host', decor = [{ type: 'musicbox', x: 0, z: 0 }] } = {}) {
  const calls = [], sent = [], notices = [];
  const camera = new T.PerspectiveCamera();
  const c = {
    T, role, elapsed: 0, now: 10, options: { music: 0.7 },
    physics: { x: 0, z: 1 }, camera, raft: null, scene: new T.Scene(),
    world: { tiles: [[0, 0], [1, 0], [2, 0], [3, 0]], decor },
    box(hz, when, s) { calls.push({ hz, when, s }); return true; },
    audioNow() { return c.now; },
    notice(s) { notices.push(s); },
    uiOpen: () => false,
  };
  c.action = a => { sent.push(a); if (role !== 'guest') m.action(a, 'host'); };
  const m = createMusicBox(c);
  camera.position.set(0, 1.6, 1);
  return { c, m, calls, sent, notices };
}
const aimAt = (c, x, z) => { const d = new T.Vector3(x * 2 - c.camera.position.x, 0.4 - c.camera.position.y, z * 2 - c.camera.position.z).normalize(); return { dir: d }; };
// advances audio time and the shared clock together and runs update
function run(h, sec, fps = 60) { const dt = 1 / fps; for (let i = 0; i < Math.round(sec * fps); i++) { h.c.now += dt; STORM_LIVE.clock += dt; h.c.elapsed += dt; h.m.update(dt); } }

test('8a. play schedules only notes inside the .15 s window, each once, in time', () => {
  STORM_LIVE.ready = true; STORM_LIVE.clock = 1000;
  const h = makeCtx();
  assert.equal(h.m.interact(aimAt(h.c, 0, 0)), true);
  assert.deepEqual(h.sent[0], { kind: 'musicbox:set', key: '0,0', on: 1, t: 0 });
  const tune = compose(0);
  let checked = 0;
  for (let i = 0; i < 600; i++) {
    const before = h.calls.length; h.c.now += 1 / 60; STORM_LIVE.clock += 1 / 60; h.c.elapsed += 1 / 60; h.m.update(1 / 60);
    for (const k of h.calls.slice(before)) { assert.ok(k.when >= h.c.now - 1e-9 && k.when <= h.c.now + LOOKAHEAD + 1e-9, 'inside the window'); checked++; }
  }
  const s = h.m.debug.state().b['0,0'].s, anchor = h.m.debug.active().anchor;
  // every scheduled time lands on a note of the tune, no duplicates, and the count matches the tune over that span
  assert.equal(new Set(h.calls.map(k => k.when.toFixed(6) + ':' + k.hz)).size, h.calls.length, 'no duplicates');
  for (const k of h.calls) {
    const p = ((k.when - anchor) % tune.loop + tune.loop) % tune.loop;
    assert.ok(tune.notes.some(n => Math.abs(n.t - p) < 1e-6 || Math.abs(n.t + tune.loop - p) < 1e-6), 'on a note');
  }
  assert.ok(checked > 20 && checked === h.calls.length);
  assert.ok(Math.abs(((h.c.now - anchor) % tune.loop) - phaseAt(STORM_LIVE.clock, s, tune.loop)) < 0.02, 'in phase with the clock');
  assert.ok(h.m.debug.notes(4).length > 0);
  assert.equal(h.m.debug.scheduled(), h.calls.length);
});

test('8b. a 3 s clock jump re-anchors to a bar line with no burst', () => {
  STORM_LIVE.ready = true; STORM_LIVE.clock = 500;
  const h = makeCtx();
  h.m.interact(aimAt(h.c, 0, 0));
  run(h, 3);
  const tune = compose(0);
  STORM_LIVE.clock += 3;
  const before = h.calls.length;
  h.c.now += 1 / 60; h.m.update(1 / 60);
  const burst = h.calls.slice(before), a = h.m.debug.active();
  assert.ok(burst.length <= 3, 'no burst: ' + burst.length);
  const s = h.m.debug.state().b['0,0'].s;
  assert.ok(Math.abs(((h.c.now - a.anchor) % tune.loop) - phaseAt(STORM_LIVE.clock, s, tune.loop)) < 1e-6, 're-anchored');
  for (const k of burst) { const inBar = ((k.when - a.anchor) % tune.bar + tune.bar) % tune.bar; assert.ok(inBar < 1e-6 || tune.bar - inBar < 1e-6 || inBar < LOOKAHEAD, 'starts at a bar line'); }
  if (burst.length) { const first = ((burst[0].when - a.anchor) % tune.bar + tune.bar) % tune.bar; assert.ok(first < 1e-6 || tune.bar - first < 1e-6, 'first note on the bar line'); }
  run(h, 2);
  assert.ok(h.calls.length > before, 'keeps playing');
});

test('8c. the nearer box plays; .5 m closer does not take over (hysteresis)', () => {
  STORM_LIVE.ready = true; STORM_LIVE.clock = 100;
  const h = makeCtx({ decor: [{ type: 'musicbox', x: 0, z: 0 }, { type: 'musicbox', x: 3, z: 0 }] });
  h.m.debug.play(0, '0,0'); h.m.debug.play(1, '3,0');
  h.c.physics = { x: 2, z: 0 }; run(h, 0.2);
  assert.equal(h.m.debug.active().key, '0,0');
  h.c.physics = { x: 3.25, z: 0 }; run(h, 0.2);
  assert.equal(h.m.debug.active().key, '0,0', 'hysteresis keeps the current box');
  h.c.physics = { x: 4.5, z: 0 }; run(h, 0.2);
  assert.equal(h.m.debug.active().key, '3,0');
  assert.ok(h.m.debug.active().gain === 1);
  h.c.physics = { x: 40, z: 0 }; run(h, 0.2);
  assert.equal(h.m.debug.active(), null, 'out of range');
});

test('8d. double-E within 1 s goes to the next tune and never stops', () => {
  STORM_LIVE.ready = true; STORM_LIVE.clock = 100;
  const h = makeCtx(), aim = aimAt(h.c, 0, 0);
  h.c.elapsed = 10; h.m.interact(aim);
  h.c.elapsed = 10.4; h.m.interact(aim);
  assert.deepEqual(h.sent.map(a => [a.on, a.t]), [[1, 0], [1, 1]]);
  h.c.elapsed = 20; h.m.interact(aim);              // playing: arms a delayed stop
  h.c.elapsed = 20.5; h.m.interact(aim);            // second E: next tune instead
  h.c.elapsed = 23; h.m.update(1 / 60);
  assert.deepEqual(h.sent.map(a => [a.on, a.t]), [[1, 0], [1, 1], [1, 2]]);
  assert.ok(h.sent.every(a => a.on === 1), 'never on:0');
  h.c.elapsed = 30; h.m.interact(aim);              // a single E stops after 1 s
  h.c.elapsed = 30.5; h.m.update(1 / 60); assert.equal(h.sent.length, 3);
  h.c.elapsed = 31.1; h.m.update(1 / 60);
  assert.deepEqual(h.sent.at(-1), { kind: 'musicbox:set', key: '0,0', on: 0, t: 2 });
  assert.equal(h.m.debug.state().b['0,0'].on, 0);
  assert.equal(h.m.alt(aim, 'hammer'), true);
  assert.deepEqual(h.sent.at(-1), { kind: 'musicbox:set', key: '0,0', on: 1, t: 3 });
  assert.equal(h.m.alt({ dir: new T.Vector3(0, 1, 0) }, 'wood'), false);
});

test('8e. afterUndecor prunes the key; serialize and load', () => {
  STORM_LIVE.ready = true; STORM_LIVE.clock = 100;
  const h = makeCtx();
  h.m.debug.play(2); run(h, 0.3);
  assert.ok(h.m.debug.active());
  const ser = h.m.serialize();
  assert.equal(ser.b['0,0'].t, 2);
  assert.equal(h.m.serialize(), ser, 'cached');
  const d = h.c.world.decor.pop();
  h.m.afterUndecor(d, 'host'); h.m.afterUndecor({ type: 'crate', x: 9, z: 9 }); h.m.afterUndecor(null);
  assert.deepEqual(h.m.debug.state().b, {});
  run(h, 0.1);
  assert.equal(h.m.debug.active(), null);
  h.m.load(undefined, 'save');
  assert.deepEqual(h.m.debug.state(), { v: 1, r: 0, b: {} });
  assert.equal(h.m.action({ kind: 'musicbox:set', key: 'nope' }), true, 'invalid action is consumed');
  assert.equal(h.m.action({ kind: 'other' }), false);
});

test('8f. a guest whose host never sends a slice gets one notice', () => {
  STORM_LIVE.ready = true; STORM_LIVE.clock = 100;
  const h = makeCtx({ role: 'guest' }), aim = aimAt(h.c, 0, 0);
  h.c.elapsed = 5; h.m.interact(aim);
  h.m.load(undefined, 'net');
  h.c.elapsed = 7; h.m.update(1 / 60); assert.equal(h.notices.length, 0);
  h.c.elapsed = 8.5; h.m.update(1 / 60); h.c.elapsed = 9; h.m.update(1 / 60); h.m.interact(aim); h.c.elapsed = 20; h.m.update(1 / 60);
  assert.equal(h.notices.length, 1);
  const g = makeCtx({ role: 'guest' });
  g.c.elapsed = 5; g.m.interact(aim);
  g.m.load({ v: 1, r: 1, b: {} }, 'net');
  g.c.elapsed = 10; g.m.update(1 / 60);
  assert.equal(g.notices.length, 0, 'a new host sends a slice');
});

test('8g. update allocates no per-frame state, lid opens, cylinder turns from the clock', () => {
  STORM_LIVE.ready = true; STORM_LIVE.clock = 100;
  const h = makeCtx(), g = h.m.decorModel('musicbox', { type: 'musicbox', x: 0, z: 0 });
  h.c.scene.add(g);
  assert.equal(h.m.decorModel('crate', {}), null);
  h.m.debug.play(0); run(h, 2);
  assert.ok(g.userData.lidPivot.rotation.x < -1.7);
  const a0 = g.userData.cylinder.rotation.x; run(h, 0.5);
  assert.notEqual(g.userData.cylinder.rotation.x, a0);
  STORM_LIVE.ready = false; const a1 = g.userData.cylinder.rotation.x, n1 = h.calls.length; run(h, 0.5);
  assert.equal(g.userData.cylinder.rotation.x, a1, 'holds without a clock');
  assert.equal(h.calls.length, n1, 'silent without a clock');
  STORM_LIVE.ready = true;
  h.c.options.music = 0; const n2 = h.calls.length; run(h, 0.5); assert.equal(h.calls.length, n2, 'music slider at 0');
  h.c.options.music = 0.7;
  h.m.debug.stop(); run(h, 2);
  assert.ok(g.userData.lidPivot.rotation.x > -0.05, 'lid closes');
  h.m.dispose();
});

test('9. items, craft book, icon, settings and content hooks', async () => {
  const { ITEMS, BLOCK_RADII } = await import(new URL('items.js', base));
  const it = ITEMS.musicbox;
  assert.ok(it && it.category === 'decor' && it.placeable && it.recipe && it.unlock?.type === 'discover');
  assert.equal(BLOCK_RADII.musicbox, 0.2);
  const { ITEM_TEXT, categoryOf } = await import(new URL('craft-book.js', base));
  assert.ok(ITEM_TEXT.musicbox?.desc && ITEM_TEXT.musicbox?.use);
  assert.equal(categoryOf('musicbox'), 'other');
  const { ITEM_ICONS } = await import(new URL('item-svg.js', base));
  assert.ok(ITEM_ICONS.musicbox && ITEM_ICONS.musicbox.includes('#ffbd66'));
  const { validateSettings } = await import(new URL('settings.js', base));
  assert.equal(validateSettings({}).music, 0.7);
  assert.match(src('content.js'), /createMusicBox, createCookpot\]/);
  assert.match(src('game.js'), /sfx\.setBus\('music', options\.music \?\? \.7\)/);
  assert.match(src('game.js'), /audioNow: \(\) => sfx\.now \?\? null/);
});
