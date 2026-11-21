// Unit tests for the Biofuel Refiner + Fuel Tank (docs/specs/biofuel.md). Pure rules plus the content module with a fake ctx.
// Run: node --test tests/biofuel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { Bag, RECIPES, ITEM_INFO, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const CI = await import(new URL('content-items.js', base));
const CB = await import(new URL('craft-book.js', base));
const SR = await import(new URL('storage-research.js', base));
const B = await import(new URL('biofuel-core.js', base));
const { createBiofuel, OLD_HOST } = await import(new URL('biofuel.js', base));
const { createEngine } = await import(new URL('engine.js', base));
const { BIO, ORGANIC, cleanSlice, sliceOf, step, stepAll, progress, applyBioAction, topUp, TEXT } = B;

const bagFrom = (slots, selected = 0) => { const s = new Array(SLOT_COUNT).fill(null); slots.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected }); };
const DECOR = [{ type: 'refiner', x: 1, z: 0 }, { type: 'fueltank', x: 2, z: 0 }, { type: 'crate', x: 3, z: 0 }];
const env = (decor = DECOR, pos = { x: 3, z: 0 }) => ({ decorAt: (x, z) => decor.find(d => d.x === x && d.z === z)?.type ?? null, pos: () => pos });
const fresh = () => cleanSlice(undefined);
const deep = v => JSON.parse(JSON.stringify(v));
const act = (st, a, bag, e = env()) => applyBioAction(st, a, 'host', bag, e);
// A bag with 27 full stacks of rope and one free slot (or none).
const nearlyFull = (free = 1, extra = []) => bagFrom([...extra, ...Array.from({ length: SLOT_COUNT - free - extra.length }, () => ({ kind: 'rope', count: 20 }))]);

test('items, recipes, decor and gating', () => {
  for (const k of ['refiner', 'fueltank', 'biofuel']) { assert.ok(CI.CONTENT_ITEMS[k], k); assert.ok(ITEM_INFO[k], k); }
  assert.equal(ITEM_INFO.biofuel.maxStack, 10); assert.equal(ITEM_INFO.biofuel.name, 'Biofuel Jug');
  assert.deepEqual({ ...RECIPES.refiner.cost }, { copperingot: 2, glass: 1, scrap: 2 });
  assert.deepEqual({ ...RECIPES.fueltank.cost }, { scrap: 4, metalingot: 1, rope: 1 });
  assert.equal(RECIPES.biofuel, undefined);
  assert.ok(!Object.values(RECIPES).some(r => r.output?.kind === 'biofuel'), 'no recipe makes jugs');
  assert.ok(CI.CONTENT_DECOR.includes('refiner') && CI.CONTENT_DECOR.includes('fueltank'));
  assert.equal(CI.CONTENT_BLOCK_RADIUS.refiner, .45); assert.equal(CI.CONTENT_BLOCK_RADIUS.fueltank, .38);
  assert.ok(SR.learnedFrom(['copperingot', 'glass', 'scrap']).includes('refiner'));
  assert.ok(!SR.learnedFrom(['glass', 'scrap']).includes('refiner'));
  assert.ok(SR.learnedFrom(['scrap', 'metalingot', 'rope']).includes('fueltank'));
  for (const k of ['refiner', 'fueltank', 'biofuel']) assert.ok(CB.ITEM_TEXT[k]?.desc, k);
  assert.equal(CB.ITEM_SOURCE.biofuel.tag, 'biofuel refiner');
  assert.match(CB.ITEM_TEXT.motor.desc, /biofuel/);
});

test('FEATURES: biofuel before cookpot, cookpot last', () => {
  const content = readFileSync(new URL('content.js', base), 'utf8');
  const feats = /const FEATURES = \[([^\]]*)\]/.exec(content)[1].split(',').map(s => s.trim()).filter(Boolean);
  assert.equal(feats.at(-1), 'createCookpot');
  assert.equal(feats.at(-2), 'createBiofuel');
});

test('cleanSlice: garbage in, empty slice out; never throws', () => {
  const empty = { v: 1, r: 0, s: '', f: {}, k: {} };
  for (const v of [undefined, null, 0, 'x', [], { f: [] }, { k: 'a' }, { r: -1 }, { r: 1.5, s: 7 }, { s: 'x'.repeat(13) }]) assert.deepEqual(cleanSlice(v), empty);
  const evil = { get f() { throw new Error('boom'); } };
  assert.deepEqual(cleanSlice(evil), empty);
  const c = cleanSlice({ r: 5, s: 'abc', f: {
    '1,0': { q: 9, t: 99, n: 9 }, '2,0': { q: 2, t: NaN, n: 1 }, '3,0': { q: 0, t: 5, n: 0 }, '4,0': { q: 1.5, n: 'x' },
    '30,0': { q: 1 }, 'a,b': { q: 1 }, '1,01': { q: 1 }, '5,0': { q: 1, t: -4, n: 0 }, '6,0': { q: 0, t: 12, n: 2 },
  }, k: { '1,1': 12, '2,1': 0, '3,1': 2.5, '4,1': '3', '5,1': 3, '-1,-2': 1 } });
  assert.equal(c.r, 5); assert.equal(c.s, 'abc');
  assert.deepEqual(c.f, { '1,0': { q: 6, t: 30, n: 4 }, '2,0': { q: 2, t: 0, n: 1 }, '5,0': { q: 1, t: 0, n: 0 }, '6,0': { q: 0, t: 0, n: 2 } });
  assert.deepEqual(c.k, { '1,1': 8, '5,1': 3, '-1,-2': 1 });
});

test('cleanSlice: caps in sorted key order; decorAt filters by type', () => {
  const f = {}, k = {};
  for (let i = 25; i >= -25; i--) for (let j = 0; j < 3; j++) { f[i + ',' + j] = { q: 1 }; k[i + ',' + j] = 1; }
  const c = cleanSlice({ f, k });
  assert.equal(Object.keys(c.f).length, BIO.MAX_REFINERS); assert.equal(Object.keys(c.k).length, BIO.MAX_TANKS);
  const sorted = Object.keys(f).sort();
  assert.deepEqual(Object.keys(c.f).sort(), sorted.slice(0, BIO.MAX_REFINERS));
  assert.deepEqual(Object.keys(c.k).sort(), sorted.slice(0, BIO.MAX_TANKS));
  const e = env();
  const d = cleanSlice({ f: { '1,0': { q: 1 }, '2,0': { q: 1 }, '3,0': { q: 1 } }, k: { '1,0': 2, '2,0': 3, '9,9': 1 } }, e.decorAt);
  assert.deepEqual(d.f, { '1,0': { q: 1, t: 0, n: 0 } }); assert.deepEqual(d.k, { '2,0': 3 });
});

test('sliceOf: idle and empty omitted, t rounded, deep copy, round trip', () => {
  const st = fresh(); st.r = 3; st.s = 'zz';
  st.f['1,0'] = { q: 2, t: 3.14159, n: 1 }; st.f['2,0'] = { q: 0, t: 0, n: 0 }; st.k['2,0'] = 4; st.k['3,0'] = 0;
  const s = sliceOf(st);
  assert.deepEqual(s, { v: 1, r: 3, s: 'zz', f: { '1,0': { q: 2, t: 3.1, n: 1 } }, k: { '2,0': 4 } });
  s.f['1,0'].q = 99; assert.equal(st.f['1,0'].q, 2);
  assert.deepEqual(cleanSlice(deep(sliceOf(st))).f['1,0'], { q: 2, t: 3.1, n: 1 });
});

test('step: 30 s per jug, tray-full stall, dt clamp', () => {
  const e = { q: 2, t: 0, n: 0 };
  for (let i = 0; i < 29; i++) assert.equal(step(e, 1), false);
  assert.equal(progress(e), 29 / 30);
  assert.equal(step(e, 1), true); assert.deepEqual(e, { q: 1, t: 0, n: 1 });
  assert.equal(step(e, 50), false); assert.equal(e.t, 1); // clamped to MAX_DT
  for (const bad of [NaN, -3, undefined]) { step(e, bad); assert.equal(e.t, 1); }
  for (let i = 0; i < 29; i++) step(e, 1);
  assert.deepEqual(e, { q: 0, t: 0, n: 2 }); assert.equal(progress(e), 0);
  const full = { q: 3, t: 10, n: BIO.TRAY };
  for (let i = 0; i < 100; i++) assert.equal(step(full, 1), false);
  assert.deepEqual(full, { q: 3, t: 10, n: 4 }); // waits, nothing lost
  const st = fresh(); st.f['1,0'] = { q: 1, t: 0, n: 0 };
  assert.equal(stepAll(st, .5), false); assert.equal(stepAll(st, .5), true); // whole-second progress counts as a change
  assert.equal(stepAll(fresh(), 1), false);
});

test('bio.load: success, mixing kinds, every refusal changes nothing', () => {
  const st = fresh(), bag = bagFrom([{ kind: 'leaf', count: 7 }, { kind: 'seaweed', count: 2 }, { kind: 'cookedfish', count: 2 }]);
  let r = act(st, { kind: 'bio.load', x: 1, z: 0, item: 'leaf' }, bag);
  assert.deepEqual(r, { ok: true, text: 'Loaded 3 leaf · 1 jug queued', n: 3 });
  assert.equal(bag.count('leaf'), 4); assert.equal(st.r, 1);
  r = act(st, { kind: 'bio.load', x: 1, z: 0, item: 'seaweed' }, bag);
  assert.equal(r.text, 'Loaded 2 seaweed · 2 jugs queued'); assert.equal(st.f['1,0'].q, 2);
  const refusals = [
    [{ kind: 'bio.load', x: 1, z: 0, item: 'seaweed' }, 'Need 2 more seaweed'],
    [{ kind: 'bio.load', x: 1, z: 0, item: 'cookedfish' }, TEXT.refuse],
    [{ kind: 'bio.load', x: 1, z: 0, item: 'toString' }, TEXT.refuse],
    [{ kind: 'bio.load', x: 2, z: 0, item: 'leaf' }, TEXT.missing],
    [{ kind: 'bio.load', x: 1.5, z: 0, item: 'leaf' }, TEXT.bad],
    [{ kind: 'bio.nope', x: 1, z: 0 }, TEXT.bad],
  ];
  for (const [a, text] of refusals) {
    const sb = deep(sliceOf(st)), bb = deep(bag.snapshot());
    const res = act(st, a, bag);
    assert.equal(res.ok, false); assert.equal(res.text, text, a.item);
    assert.deepEqual(deep(sliceOf(st)), sb); assert.deepEqual(deep(bag.snapshot()), bb);
  }
  const far = act(st, { kind: 'bio.load', x: 1, z: 0, item: 'leaf' }, bag, env(DECOR, { x: 10, z: 0 }));
  assert.equal(far.text, TEXT.reach);
  st.f['1,0'].q = BIO.QUEUE; st.r++;
  const sb = deep(sliceOf(st)), bb = deep(bag.snapshot());
  assert.equal(act(st, { kind: 'bio.load', x: 1, z: 0, item: 'leaf' }, bag).text, TEXT.full);
  assert.deepEqual(deep(sliceOf(st)), sb); assert.deepEqual(deep(bag.snapshot()), bb);
  assert.equal(applyBioAction(st, { kind: 'bio.load', x: 1, z: 0, item: 'leaf' }, 'host', { slots: [] }, env()).text, TEXT.bad);
  for (const k of Object.keys(ORGANIC)) assert.ok(ITEM_INFO[k], k);
});

test('bio.take: all or nothing', () => {
  const st = fresh(); st.f['1,0'] = { q: 0, t: 0, n: 3 };
  const bag = bagFrom([]);
  assert.deepEqual(act(st, { kind: 'bio.take', x: 1, z: 0 }, bag), { ok: true, text: '+ 3 Biofuel Jug', n: 3 });
  assert.equal(bag.count('biofuel'), 3); assert.equal(st.f['1,0'], undefined); assert.equal(st.r, 1);
  assert.equal(act(st, { kind: 'bio.take', x: 1, z: 0 }, bag).text, TEXT.empty);
  // 9 jugs in hand + 3 in the tray = 12 > one stack of 10, with no free slot: refused whole
  st.f['1,0'] = { q: 1, t: 4, n: 3 };
  const tight = nearlyFull(0, [{ kind: 'biofuel', count: 9 }]);
  const sb = deep(sliceOf(st)), bb = deep(tight.snapshot()), r0 = st.r;
  const r = act(st, { kind: 'bio.take', x: 1, z: 0 }, tight);
  assert.equal(r.ok, false); assert.equal(r.reason, 'bagfull'); assert.equal(r.text, TEXT.bagfull);
  assert.deepEqual(deep(sliceOf(st)), sb); assert.deepEqual(deep(tight.snapshot()), bb); assert.equal(st.r, r0);
  const ok = nearlyFull(1, [{ kind: 'biofuel', count: 9 }]);
  assert.equal(act(st, { kind: 'bio.take', x: 1, z: 0 }, ok).ok, true);
  assert.equal(ok.count('biofuel'), 12); assert.deepEqual(st.f['1,0'], { q: 1, t: 4, n: 0 }); // still refining
});

test('bio.fill / bio.empty: partial pour to cap, refusals, all-or-nothing empty', () => {
  const st = fresh(), bag = bagFrom([{ kind: 'biofuel', count: 5 }]);
  assert.deepEqual(act(st, { kind: 'bio.fill', x: 2, z: 0 }, bag), { ok: true, text: 'Poured 5 jugs · 5/8', n: 5 });
  assert.equal(bag.count('biofuel'), 0); assert.equal(st.k['2,0'], 5);
  assert.equal(act(st, { kind: 'bio.fill', x: 2, z: 0 }, bag).text, TEXT.nojug);
  const more = bagFrom([{ kind: 'biofuel', count: 7 }]);
  assert.equal(act(st, { kind: 'bio.fill', x: 2, z: 0 }, more).text, 'Poured 3 jugs · 8/8');
  assert.equal(more.count('biofuel'), 4); assert.equal(st.k['2,0'], 8);
  let sb = deep(sliceOf(st)), bb = deep(more.snapshot());
  assert.equal(act(st, { kind: 'bio.fill', x: 2, z: 0 }, more).text, TEXT.tankfull);
  assert.equal(act(st, { kind: 'bio.fill', x: 1, z: 0 }, more).text, TEXT.notank);
  assert.deepEqual(deep(sliceOf(st)), sb); assert.deepEqual(deep(more.snapshot()), bb);
  // empty: 8 jugs need a free slot here
  const tight = nearlyFull(0, [{ kind: 'biofuel', count: 4 }]);
  sb = deep(sliceOf(st)); bb = deep(tight.snapshot());
  assert.equal(act(st, { kind: 'bio.empty', x: 2, z: 0 }, tight).reason, 'bagfull');
  assert.deepEqual(deep(sliceOf(st)), sb); assert.deepEqual(deep(tight.snapshot()), bb);
  const roomy = bagFrom([]);
  assert.equal(act(st, { kind: 'bio.empty', x: 2, z: 0 }, roomy).text, '+ 8 Biofuel Jug');
  assert.equal(roomy.count('biofuel'), 8); assert.equal(st.k['2,0'], undefined);
  assert.equal(act(st, { kind: 'bio.empty', x: 2, z: 0 }, roomy).text, TEXT.tankempty);
  // held stack count wins over the whole bag
  const two = bagFrom([{ kind: 'biofuel', count: 2 }, { kind: 'biofuel', count: 5 }], 0);
  assert.equal(act(st, { kind: 'bio.fill', x: 2, z: 0 }, two).text, 'Poured 2 jugs · 2/8');
  assert.equal(two.count('biofuel'), 5);
});

test('topUp: range, on only, threshold, sorted order, one jug per motor, refused pour keeps the jug', () => {
  const decor = [{ type: 'fueltank', x: 0, z: 0 }, { type: 'motor', x: 1, z: 1 }, { type: 'motor', x: -1, z: 0 }, { type: 'motor', x: 2, z: 0 },
    { type: 'motor', x: 0, z: 1 }, { type: 'motor', x: 1, z: 0 }];
  const motors = { v: 1, motors: { '1,1': { on: true, fuel: 0 }, '-1,0': { on: true, fuel: 150 }, '2,0': { on: true, fuel: 0 }, '0,1': { on: false, fuel: 0 }, '1,0': { on: true, fuel: 150.1 } } };
  const st = fresh(); st.k['0,0'] = 5;
  const calls = [];
  const used = topUp(st, decor, motors, (x, z, s) => { calls.push([x, z, s]); return s; });
  assert.deepEqual(calls, [[-1, 0, 150], [1, 1, 150]]); // sorted keys, Chebyshev 1, on, fuel <= 150
  assert.equal(used, 2); assert.equal(st.k['0,0'], 3); assert.equal(st.r, 1);
  // refused pour keeps the jug, no r bump
  const st2 = fresh(); st2.k['0,0'] = 1;
  assert.equal(topUp(st2, decor, motors, () => 0), 0); assert.equal(st2.k['0,0'], 1); assert.equal(st2.r, 0);
  // two tanks next to one motor: still one jug per motor per call; empty tank deleted
  const d2 = [{ type: 'fueltank', x: 0, z: 0 }, { type: 'fueltank', x: 1, z: 1 }, { type: 'motor', x: 1, z: 0 }];
  const m2 = { motors: { '1,0': { on: true, fuel: 0 } } }, st3 = fresh(); st3.k['0,0'] = 1; st3.k['1,1'] = 2;
  assert.equal(topUp(st3, d2, m2, (x, z, s) => s), 1);
  assert.deepEqual(st3.k, { '1,1': 2 });
  assert.equal(topUp(fresh(), d2, m2, () => 150), 0);
  assert.equal(topUp(st3, d2, undefined, () => 150), 0);
});

// ---- the content module with a fake ctx
function makeCtx(role = 'solo') {
  const world = { tiles: [[0, 0], [1, 0], [2, 0], [3, 0], [1, 1], [2, 1]], decor: [{ type: 'refiner', x: 1, z: 0 }, { type: 'fueltank', x: 2, z: 0 }, { type: 'motor', x: 3, z: 0 }], ext: {} };
  const emits = [], notices = [], sent = [], bags = { host: bagFrom([]), guest: bagFrom([]) };
  const ctx = { T, world, role, running: true, physics: { x: 3, z: 0 }, other: { x: 3, z: 0 }, raft: null, esc: s => s,
    camera: { position: { x: 3, y: 1.6, z: 0 } },
    localBag: () => bags[role === 'guest' ? 'guest' : 'host'], actorBag: a => bags[a], emit: (e, to) => emits.push({ e, to }),
    notice: (s, ms) => notices.push([s, ms]), rebuildRaft() {} };
  ctx.action = a => { sent.push(a); if (role !== 'guest') mod.action(a, 'host'); };
  const engine = createEngine({ ...ctx, T: null, get world() { return world; } });
  const peer = Object.assign(n => (n === 'engine' ? engine : null), { peek: n => (n === 'engine' ? engine.serialize() : undefined) });
  const mod = createBiofuel(ctx, peer);
  return { ctx, mod, engine, emits, notices, sent, bags, world };
}
const aimAt = (x, y, z, from = { x: 3, y: 1.6, z: 0 }) => { const v = [x - from.x, y - from.y, z - from.z], l = Math.hypot(...v); return { dir: { x: v[0] / l, y: v[1] / l, z: v[2] / l } }; };
const REF = aimAt(2, .7, 0), TANK = aimAt(4, .5, 0);

test('module: host refines, pours into the running motor via the engine peer, prompts', () => {
  const { mod, engine, emits, bags } = makeCtx();
  mod.load(undefined, 'save');
  assert.deepEqual(Object.keys(mod.serialize()), ['v', 'r', 's', 'f', 'k']);
  bags.host.add('leaf', 9);
  assert.equal(mod.prompt(REF), '<kbd>E</kbd>Load 3 leaf');
  assert.equal(mod.interact(REF), true);
  assert.equal(emits.at(-1).e.kind, 'build'); assert.equal(emits.at(-1).e.text, 'Loaded 3 leaf · 1 jug queued');
  mod.interact(REF);
  for (let i = 0; i < 12; i++) mod.update(1);
  assert.equal(mod.prompt(REF), '<kbd>E</kbd>Load 3 leaf · 2 queued 40%');
  mod.debug.fast(48);
  assert.deepEqual(mod.debug.state().f['1,0'], { q: 0, t: 0, n: 2 });
  bags.host.slots[0] = null;
  assert.equal(mod.prompt(REF), '<kbd>E</kbd>Take 2 Biofuel Jugs');
  mod.interact(REF);
  assert.equal(bags.host.count('biofuel'), 2); assert.equal(emits.at(-1).e.kind, 'loot');
  assert.equal(mod.prompt(REF), 'Biofuel Refiner · hold leaves or fish');
  // tank
  bags.host.select(5);
  assert.equal(mod.prompt(TANK), 'Fuel Tank · empty');
  bags.host.select(bags.host.slots.findIndex(s => s?.kind === 'biofuel'));
  assert.equal(mod.prompt(TANK), '<kbd>E</kbd>Pour in 2 jugs · 0/8');
  mod.interact(TANK);
  assert.equal(mod.debug.state().k['2,0'], 2);
  assert.equal(mod.prompt(TANK), '<kbd>E</kbd>Take 2 jugs · 2/8 · feeds motors next to it');
  // motor off: never poured
  for (let i = 0; i < 3; i++) mod.update(1);
  assert.equal(mod.debug.state().k['2,0'], 2);
  engine.debug.set(3, 0, true);
  mod.update(1);
  assert.equal(engine.serialize().motors['3,0'].fuel, 150); assert.equal(mod.debug.state().k['2,0'], 1);
  mod.update(1); // 150 + 150 = 300 <= cap, fuel <= 150
  assert.equal(engine.serialize().motors['3,0'].fuel, 300); assert.deepEqual(mod.debug.state().k, {});
  mod.update(1); assert.equal(engine.serialize().motors['3,0'].fuel, 300);
  assert.ok(!emits.some(x => /fuel/.test(x.e.text) && x.to === 'all'), 'no notices per pour');
  // debug.jugs sets the tank count (QA helper)
  mod.debug.jugs(2, 0, 3);
  const w = mod.debug.state(); assert.equal(w.k['2,0'], 3);
});

test('module: guest never steps or pours, net load skips by r+s, OLD_HOST', () => {
  const { mod, engine, notices, sent, bags } = makeCtx('guest');
  engine.load({ v: 1, motors: { '3,0': { on: true, fuel: 0 } } });
  mod.load(undefined, 'net');
  assert.equal(mod.prompt(REF), OLD_HOST);
  bags.guest.add('leaf', 3);
  assert.equal(mod.interact(REF), true);
  assert.deepEqual(notices.at(-1), [OLD_HOST, 2400]); assert.equal(sent.length, 0);
  const data = { v: 1, r: 4, s: 'host1', f: { '1,0': { q: 1, t: 2, n: 0 } }, k: { '2,0': 3 } };
  mod.load(data, 'net');
  assert.equal(mod.prompt(REF), '<kbd>E</kbd>Load 3 leaf · 1 queued 7%');
  mod.load({ v: 1, r: 4, s: 'host1', f: {}, k: {} }, 'net'); // same r+s: ignored
  assert.ok(mod.serialize().f['1,0']);
  for (let i = 0; i < 5; i++) mod.update(1);
  assert.equal(mod.serialize().f['1,0'].t, 2); assert.equal(mod.serialize().k['2,0'], 3);
  assert.equal(engine.serialize().motors['3,0'].fuel, 0);
  mod.interact(REF);
  assert.deepEqual(sent.at(-1), { kind: 'bio.load', x: 1, z: 0, item: 'leaf' });
  assert.equal(bags.guest.count('leaf'), 3); // the host applies it, not the guest
  mod.load({ v: 1, r: 4, s: 'host2', f: {}, k: {} }, 'net'); // new host session, same r
  assert.deepEqual(mod.serialize().f, {});
  assert.equal(mod.debug.fast(10), false); assert.equal(mod.debug.clear(), false); assert.equal(mod.debug.place('refiner', 0, 0), false);
});

test('module: host applies a guest action with the guest bag; serialize round trip; models', () => {
  const { mod, emits, bags, world } = makeCtx('host');
  bags.guest.add('fish', 2);
  assert.equal(mod.action({ kind: 'bio.load', x: 1, z: 0, item: 'fish' }, 'guest'), true);
  assert.equal(bags.guest.count('fish'), 1); assert.equal(emits.at(-1).to, 'guest');
  assert.equal(mod.action({ kind: 'kiln.take' }, 'guest'), false);
  bags.guest.slots.fill(null); for (let i = 0; i < SLOT_COUNT; i++) bags.guest.slots[i] = { kind: 'rope', count: 20 };
  mod.debug.jugs(2, 0, 2);
  mod.action({ kind: 'bio.empty', x: 2, z: 0 }, 'guest');
  assert.equal(emits.at(-1).e.kind, 'full');
  const saved = deep(mod.serialize());
  assert.strictEqual(mod.serialize(), mod.serialize());
  const b = makeCtx('host'); b.mod.load(saved, 'save');
  assert.deepEqual(b.mod.debug.state().f, saved.f); assert.deepEqual(b.mod.debug.state().k, saved.k);
  assert.notEqual(b.mod.debug.state().s, saved.s); // own session
  world.decor.length = 0; mod.update(1.1);
  assert.deepEqual(mod.serialize().f, {}); assert.deepEqual(mod.serialize().k, {});
  const ref = mod.decorModel('refiner'), tank = mod.decorModel('fueltank');
  assert.equal(ref.name, 'bio_refiner'); assert.equal(tank.name, 'bio_tank');
  let n = 0; ref.traverse(o => { if (o.isMesh) n++; }); assert.ok(n <= 12, 'refiner meshes ' + n);
  n = 0; tank.traverse(o => { if (o.isMesh) n++; }); assert.ok(n <= 3, 'tank meshes ' + n);
  assert.equal(ref.userData.bio.bubbles.length, 3); assert.equal(ref.userData.bio.jugs.length, 4);
  assert.ok(tank.userData.bio.level);
  assert.equal(mod.decorModel('crate'), null);
  mod.dispose();
});

test('module: visuals follow the slice (jugs, liquid, tank level)', () => {
  const { ctx, mod } = makeCtx('host');
  const raft = new T.Group(); ctx.raft = raft;
  const r = mod.decorModel('refiner'); r.position.set(2, 0, 0); raft.add(r);
  const t = mod.decorModel('fueltank'); t.position.set(4, 0, 0); raft.add(t);
  mod.load({ f: { '1,0': { q: 2, t: 15, n: 3 } }, k: { '2,0': 4 } }, 'save');
  mod.update(1 / 60);
  assert.deepEqual(r.userData.bio.jugs.map(j => j.visible), [true, true, true, false]);
  assert.ok(Math.abs(r.userData.bio.liquid.scale.y - (.15 + .85 * (15 + 1 / 60) / 30)) < .01);
  assert.ok(r.userData.bio.bubbles[0].visible);
  assert.equal(t.userData.bio.level.scale.y, .5);
  mod.debug.jugs(2, 0, 2);
  mod.update(.1); assert.ok(Math.abs(t.userData.bio.level.scale.y - .3) < 1e-9, 'eases at 2/s');
  for (let i = 0; i < 10; i++) mod.update(.1);
  assert.equal(t.userData.bio.level.scale.y, .25);
  mod.dispose();
});
