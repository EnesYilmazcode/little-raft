// Held instruments (docs/specs/instruments.md): pure helpers, catalogue, audio note(), models, engine half, co-op HELD.
// Run: node --test tests/instruments.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const I = await import(new URL('instruments.js', base));
const { noteFor, cleanNoteMsg, rateGate, windowGate, distanceGain, createInstruments, INSTRUMENT_IDS, SCALE_HZ, HEAR_RANGE } = I;
const T = await import(new URL('vendor/three.module.js', base));
const IDS = ['drum', 'pipes', 'bells'];

test('noteFor maps pitch to 8 monotonic steps, looking up is higher', () => {
  assert.equal(noteFor(-1.35), 0);
  assert.equal(noteFor(1.35), 7);
  assert.equal(noteFor(0), 4);
  assert.equal(noteFor(NaN), 3);
  assert.equal(noteFor(undefined), 3);
  const seen = new Set();
  let prev = -1;
  for (let k = 0; k < 200; k++) {
    const n = noteFor(-1.35 + 2.7 * k / 199);
    assert.ok(n >= prev, 'monotonic'); prev = n; seen.add(n);
  }
  assert.equal(seen.size, 8);
  assert.equal(SCALE_HZ.length, 8);
  assert.deepEqual([...INSTRUMENT_IDS], IDS);
});

test('cleanNoteMsg accepts only well-formed inst messages', () => {
  assert.deepEqual(cleanNoteMsg({ type: 'inst', i: 'drum', n: 3, v: 1 }), { i: 'drum', n: 3, v: 1 });
  assert.deepEqual(cleanNoteMsg({ type: 'inst', i: 'bells', n: 0 }), { i: 'bells', n: 0, v: 1 }, 'v defaults to 1');
  assert.deepEqual(cleanNoteMsg({ type: 'inst', i: 'pipes', n: 7, v: 5, extra: 'x' }), { i: 'pipes', n: 7, v: 1 }, 'clamped, extras ignored');
  assert.equal(cleanNoteMsg({ type: 'inst', i: 'pipes', n: 7, v: -2 }).v, 0);
  for (const bad of [null, undefined, [], 'inst', 3, { type: 'fc', i: 'drum', n: 1 }, { type: 'inst', i: 'hook', n: 1 },
    { type: 'inst', i: 'drum', n: 8 }, { type: 'inst', i: 'drum', n: -1 }, { type: 'inst', i: 'drum', n: 2.5 }, { type: 'inst', i: 'drum', n: '3' },
    { type: 'inst', i: 'drum', n: 1, v: NaN }, { type: 'inst', i: 'drum', n: 1, v: Infinity }, { type: 'inst', i: 'drum', n: 1, v: '1' },
    { type: 'inst', i: 'constructor', n: 1 }, { type: 'inst', i: '__proto__', n: 1 },
    JSON.parse('{"__proto__":{"i":"drum"}}'), JSON.parse('{"type":"inst","n":1,"__proto__":{"i":"drum"}}'),
    Object.assign(Object.create({ type: 'inst', i: 'drum', n: 1 }), {})]) {
    assert.equal(cleanNoteMsg(bad), null, JSON.stringify(bad) ?? String(bad));
  }
});

test('rateGate and windowGate', () => {
  const g = rateGate(80);
  assert.equal(g(0), true); assert.equal(g(50), false); assert.equal(g(80), true); assert.equal(g(NaN), false);
  const w = windowGate(16);
  for (let k = 0; k < 16; k++) assert.equal(w(k * 10), true, 'pass ' + k);
  assert.equal(w(500), false, '17th inside the window');
  assert.equal(w(1001), true, 'passes again once the window slides');
});

test('distanceGain falls off to 0 at HEAR_RANGE', () => {
  assert.equal(distanceGain(0), 1);
  assert.equal(distanceGain(HEAR_RANGE), 0);
  assert.equal(distanceGain(45), 0);
  assert.equal(distanceGain(NaN), 0);
  assert.equal(distanceGain(undefined), 0);
  assert.equal(distanceGain(29.9), 0.15);
  let prev = 2;
  for (let d = 0; d <= 40; d += 0.5) { const s = distanceGain(d); assert.ok(s <= prev && s >= 0 && s <= 1); prev = s; }
});

test('catalogue: three craftable, durability-free tools that bags keep', async () => {
  const { ITEMS } = await import(new URL('items.js', base));
  const { RECIPES, ITEM_INFO, Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
  for (const id of IDS) {
    const e = ITEMS[id];
    assert.ok(e, id);
    assert.equal(e.category, 'tool'); assert.equal(e.tool, false); assert.equal(e.stack, 1);
    assert.ok(e.recipe && e.recipe.station === null);
    assert.notEqual(e.unlock.type, 'start');
    assert.ok(ITEM_INFO[id] && RECIPES[id], id + ' in ITEM_INFO / RECIPES');
    const bag = new Bag({ slots: Array(SLOT_COUNT).fill(null), selected: 0 });
    for (const [k, n] of Object.entries(e.recipe.cost)) bag.add(k, n);
    assert.ok(bag.canCraft(id).ok, 'can craft ' + id);
    bag.craft(id);
    assert.equal(bag.count(id), 1);
  }
  const slots = Array(SLOT_COUNT).fill(null);
  IDS.forEach((k, i) => { slots[i] = { kind: k, count: 1 }; });
  const a = new Bag({ slots, selected: 1 });
  const b = new Bag(JSON.parse(JSON.stringify(a.snapshot())));
  assert.deepEqual(b.snapshot(), a.snapshot());
  for (const k of IDS) assert.equal(b.count(k), 1);
});

function fakeAudioContext() {
  const live = new Set(), sources = new Set();
  const param = v => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
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
  return { ctx, live };
}

test('audio note(): silent without a context, rate-limited and voice-capped with one', async () => {
  const { createOceanAudio } = await import(new URL('audio.js', base));
  const none = createOceanAudio({ ambience: false });
  assert.equal(none.note('drum', 0), false);
  none.destroy();
  const { ctx, live } = fakeAudioContext();
  const a = createOceanAudio({ context: ctx, volume: 0.5, ambience: false });
  assert.equal(await a.resume(), true);
  const base0 = live.size;
  for (const i of IDS) { ctx.currentTime += 0.1; assert.equal(a.note(i, 3), true, i); }
  ctx.currentTime += 0.1;
  assert.equal(a.note('hook', 3), false); assert.equal(a.note('drum', 9), false); assert.equal(a.note('drum', 1.5), false);
  assert.equal(a.note('constructor', 1), false); assert.equal(a.note('drum', 2, 0), false);
  assert.equal(a.note('drum', 2), true);
  ctx.currentTime += 0.01;
  assert.equal(a.note('drum', 2), false, 'second note inside 50 ms');
  ctx.endOneShots();
  assert.equal(live.size, base0, 'instrument voices free themselves');
  let ok = 0;
  for (let k = 0; k < 11; k++) { ctx.currentTime += 0.06; ok += a.note('bells', k % 8) ? 1 : 0; }
  assert.equal(ok, 10, '11th concurrent instrument voice refused');
  assert.equal(a.play('build'), true, 'game SFX still have voices');
  ctx.endOneShots();
  ctx.currentTime += 0.1;
  assert.equal(a.note('bells', 0), true, 'voices free again after ending');
  a.destroy();
});

test('buildInstrument makes small named models', async () => {
  const { buildInstrument } = await import(new URL('instrument-models.js', base));
  const names = { drum: ['drumHead', 'drumLash'], pipes: ['pipe0', 'pipe1', 'pipe2', 'pipe3', 'pipe4'], bells: ['bar0', 'bar1', 'bar2', 'bar3', 'mallet'] };
  for (const k of IDS) {
    const g = buildInstrument(T, k);
    assert.ok(g?.isGroup, k);
    for (const n of names[k]) assert.ok(g.getObjectByName(n), k + ' has ' + n);
    let meshes = 0; g.traverse(o => { if (o.isMesh) meshes++; });
    assert.ok(meshes <= 12, k + ' mesh count ' + meshes);
    const s = new T.Box3().setFromObject(g).getSize(new T.Vector3());
    assert.ok(Math.max(s.x, s.y, s.z) <= 0.3, k + ' size');
  }
  assert.equal(buildInstrument(T, 'wood'), null);
  assert.equal(buildInstrument(T, '__proto__'), null);
  const { buildItemModel, holdFor } = await import(new URL('held-items.js?build=v3-survival-ae77fa84ac2b', base));
  for (const k of IDS) {
    const m = buildItemModel(T, k);
    assert.ok(m.getObjectByName('instrument_' + k), k + ' uses its own held model');
    assert.ok(holdFor(k).pose === 'grip');
  }
});

function stubHost(extra = {}) {
  const sent = [], notes = [], scene = new T.Scene(), camera = new T.PerspectiveCamera();
  let t = 1000;
  const host = { scene, camera, pitch: () => 0, send: m => sent.push(m), netReady: () => true, note: (...a) => { notes.push(a); return true; },
    friendPos: () => null, now: () => t, ...extra };
  return { host, sent, notes, scene, camera, tick: ms => { t += ms; } };
}

test('createInstruments: local play, send gate, remote falloff, dispose', () => {
  const h = stubHost();
  const ins = createInstruments(T, h.host);
  assert.equal(ins.use('hammer'), false);
  assert.equal(ins.use('drum'), true);
  assert.deepEqual(h.notes, [['drum', 4, 1]]);
  assert.deepEqual(h.sent, [{ type: 'inst', i: 'drum', n: 4, v: 1 }]);
  h.tick(10);
  assert.equal(ins.use('drum'), true, 'click consumed');
  assert.equal(h.sent.length, 1, 'two uses 10 ms apart send once');
  assert.equal(h.notes.length, 1);
  assert.ok(h.scene.children.length > 0, 'strike FX shown');
  for (let k = 0; k < 60; k++) ins.update(1 / 60);
  assert.equal(h.scene.children.length, 0, 'FX fade and go');
  for (let k = 0; k < 10; k++) { h.tick(100); ins.use('bells'); }
  assert.ok(h.scene.children.length <= 6, 'at most 6 live FX');
  assert.deepEqual(ins.prompt({ state: { heldKind: 'bells' } }), [{ key: 'LMB', label: 'Play' }], 'teach line gone after 10 notes');
  assert.equal(ins.prompt({ state: { heldKind: 'hook' } }), null);
  assert.equal(ins.prompt({ state: { heldKind: 'drum', pickup: { type: 'wood' } } }), null, 'yields to the pick-up prompt');
  assert.equal(ins.prompt({ state: { heldKind: 'drum', swimming: true } }), null, 'yields to climb / swim prompts');
  for (let k = 0; k < 60; k++) ins.update(1 / 60);
  assert.equal(h.scene.children.length, 0, 'faded FX leave the scene');
  h.tick(100); ins.use('drum');
  assert.equal(h.scene.children.length, 1, 'a pooled sprite comes back');

  // remote
  const friend = new T.Vector3(45, 0, 0);
  const r = stubHost({ friendPos: () => friend });
  const ins2 = createInstruments(T, r.host);
  assert.equal(ins2.prompt({ state: { heldKind: 'drum' } }).length, 2);
  assert.equal(ins2.onNet({ type: 'inst', i: 'pipes', n: 2, v: 1 }), false);
  assert.equal(r.notes.length, 0, 'friend at 45 m is out of earshot');
  friend.set(5, 0, 0);
  assert.equal(ins2.onNet({ type: 'inst', i: 'pipes', n: 2, v: 1 }), true);
  assert.equal(r.notes.length, 1); assert.equal(r.notes[0][0], 'pipes'); assert.equal(r.notes[0][1], 2);
  assert.ok(r.notes[0][2] > 0 && r.notes[0][2] < 1, 'quieter with distance');
  assert.equal(ins2.onNet({ type: 'inst', i: 'hook', n: 2 }), false);
  for (let k = 0; k < 40; k++) ins2.onNet({ type: 'inst', i: 'hook', n: 2 });
  r.tick(1); assert.equal(ins2.onNet({ type: 'inst', i: 'bells', n: 3 }), true, 'junk does not use up the receive window');
  for (let k = 0; k < 30; k++) ins2.onNet({ type: 'inst', i: 'bells', n: 1 });
  assert.ok(r.notes.length <= 16, 'receive window caps notes per second');
  const noFriend = stubHost();
  const ins3 = createInstruments(T, noFriend.host);
  assert.equal(ins3.onNet({ type: 'inst', i: 'drum', n: 1 }), false, 'no friend, nothing plays');
  ins.dispose(); ins2.dispose(); ins3.dispose(); ins.dispose();
  assert.equal(h.scene.children.length, 0); assert.equal(r.scene.children.length, 0);
  assert.equal(ins.use('drum'), false, 'disposed');
});

test('coop HELD keeps old indices and appends the instruments', async () => {
  const { HELD } = await import(new URL('coop.js', base));
  assert.deepEqual(HELD.slice(0, 14), [null, 'hook', 'hammer', 'fishingrod', 'wood', 'leaf', 'scrap', 'plastic', 'sail', 'palm', 'lantern', 'net', 'bench', 'crate']);
  assert.equal(HELD.indexOf('drum'), 14); assert.equal(HELD.indexOf('pipes'), 15); assert.equal(HELD.indexOf('bells'), 16);
});
