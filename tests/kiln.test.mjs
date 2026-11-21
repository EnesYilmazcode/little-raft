// Unit tests for the Seaside Kiln (docs/specs/kiln.md). Pure logic plus the content module with a fake ctx.
// Run: node --test tests/kiln.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { Bag, RECIPES, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const SR = await import(new URL('storage-research.js', base));
const K = await import(new URL('kiln-core.js', base));
const { createKiln } = await import(new URL('kiln.js', base));
const { KILN, SMELT, blank, cleanEntry, cleanSlice, sliceOf, canLoad, addFuel, step, stepAll, burning, progress, applyKilnAction, TEXT } = K;

const bagFrom = (slots, selected = 0) => { const s = new Array(SLOT_COUNT).fill(null); slots.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected }); };
const kilnAt = [{ type: 'kiln', x: 1, z: 0 }, { type: 'crate', x: 2, z: 0 }];
const env = (decor = kilnAt, pos = { x: 2, z: 0 }) => ({ decorAt: (x, z) => decor.find(d => d.x === x && d.z === z)?.type ?? null, pos: () => pos });
const fresh = () => ({ k: {}, r: 0 });
const act = (st, a, bag, e = env()) => applyKilnAction(st, { x: 1, z: 0, ...a }, 'host', bag, e);
const entry = o => ({ ...blank(), ...o });

// 1
test('recipes: five new ids, special outputs, kiln is research-gated', () => {
  for (const id of ['kiln', 'glasslamp', 'sinker', 'glasscups', 'brickplanter']) assert.ok(RECIPES[id], id);
  assert.deepEqual({ ...RECIPES.glasscups.output }, { kind: 'cup', count: 3 });
  assert.deepEqual({ ...RECIPES.brickplanter.output }, { kind: 'palm', count: 2 });
  assert.deepEqual({ ...RECIPES.kiln.cost }, { stone: 4, clay: 4, scrap: 1 });
  assert.ok(!SR.STARTER.includes('kiln'));
});

// 2
test('research path: stone and clay are studyable; studying unlocks the kiln tree', () => {
  const st = SR.stateFrom({ v: 1, chests: {}, seen: [], learned: [], r: 0 }, 'save', null);
  const kinds = SR.researchableKinds(st);
  assert.ok(kinds.includes('stone') && kinds.includes('clay'));
  assert.ok(SR.learnedFrom(['stone', 'clay', 'scrap']).includes('kiln'));
  assert.ok(SR.learnedFrom(['glass']).includes('glasscups'));
  assert.ok(SR.learnedFrom(['brick', 'leaf']).includes('brickplanter'));
  assert.ok(SR.learnedFrom(['metalingot', 'stone']).includes('sinker'));
  assert.ok(SR.learnedFrom(['glass', 'metalingot', 'wood']).includes('glasslamp'));
});

// 3
test('cleanEntry: garbage, NaN and out-of-range are rejected or clamped', () => {
  for (const junk of [undefined, null, 5, 'x', [], {}, { q: 'a' }, { f: NaN }, { n: 3 }, { o: 'glass' }]) assert.equal(cleanEntry(junk), null);
  assert.equal(cleanEntry({ r: 'sand', q: 0, f: 0, n: 0 }), null); // idle and empty
  assert.deepEqual(cleanEntry({ r: 'gold', q: 3, f: 2 }), entry({ f: 2 }));
  assert.deepEqual(cleanEntry({ r: 'sand', q: 9, f: 99 }), null);
  assert.deepEqual(cleanEntry({ r: 'sand', q: 2, t: NaN, h: 1 }), entry({ r: 'sand', q: 2, h: 1 }));
  assert.deepEqual(cleanEntry({ r: 'sand', q: 2, t: 500, h: 1 }), entry({ r: 'sand', q: 2, h: 1, t: 12 }));
  assert.deepEqual(cleanEntry({ r: 'sand', q: 2, t: 5, h: 0 }), entry({ r: 'sand', q: 2 })); // t only while burning
  assert.deepEqual(cleanEntry({ r: 'sand', q: 2, t: 5, h: true }), entry({ r: 'sand', q: 2 }));
  assert.deepEqual(cleanEntry({ f: 4, o: 'glass', n: 11 }), entry({ f: 4 }));
  assert.deepEqual(cleanEntry({ f: 3.5, o: 'glass', n: 2 }), entry({ o: 'glass', n: 2 }));
});

test('cleanEntry: tray/queue mismatch drops the queue, q+n capped at TRAY', () => {
  assert.deepEqual(cleanEntry({ r: 'sand', q: 3, h: 1, t: 4, o: 'brick', n: 2 }), entry({ o: 'brick', n: 2 }));
  assert.deepEqual(cleanEntry({ r: 'sand', q: 5, o: 'glass', n: 8 }), entry({ r: 'sand', q: 2, o: 'glass', n: 8 }));
  assert.deepEqual(cleanEntry({ r: 'sand', q: 5, h: 1, t: 3, o: 'glass', n: 10 }), entry({ o: 'glass', n: 10 }));
});

test('cleanSlice: bad keys, far keys, decorAt pruning, MAX_KILNS, undefined', () => {
  assert.deepEqual(cleanSlice(undefined), { k: {}, r: 0 });
  for (const junk of [null, 5, 'x', [], { k: [] }, { k: 'no' }, { r: -1 }, { r: 1.5 }]) {
    const c = cleanSlice(junk); assert.deepEqual(c.k, {}); assert.equal(c.r, 0);
  }
  const good = { r: 'clay', q: 1, f: 2 };
  const c = cleanSlice({ r: 7, k: { 'a,b': good, '1,0': good, '99,0': good, '0,-26': good, '-3,4': good, '2,2': 'x', '001,0': good } });
  assert.equal(c.r, 7);
  assert.deepEqual(Object.keys(c.k).sort(), ['-3,4', '1,0']);
  const pruned = cleanSlice({ k: { '1,0': good, '-3,4': good } }, (x, z) => (x === 1 && z === 0 ? 'kiln' : 'crate'));
  assert.deepEqual(Object.keys(pruned.k), ['1,0']);
  const many = {}; for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) many[x + ',' + z] = good;
  assert.equal(Object.keys(cleanSlice({ k: many }).k).length, KILN.MAX_KILNS);
  assert.doesNotThrow(() => cleanSlice({ k: { get '1,0'() { throw new Error('x'); } } }));
});

// 4
test('step: fuel spent only when a batch starts; idle keeps fuel; no fuel pauses', () => {
  const idle = entry({ f: 4 });
  for (let i = 0; i < 50; i++) step(idle, 1);
  assert.equal(idle.f, 4);
  const e = entry({ r: 'sand', q: 2, f: 1 });
  assert.equal(step(e, .5), 0); assert.equal(e.f, 0); assert.equal(e.h, 1); assert.equal(e.t, .5);
  for (let i = 0; i < 11; i++) step(e, 1);
  assert.equal(step(e, .5), 1);
  assert.equal(e.n, 1); assert.equal(e.o, 'glass'); assert.equal(e.q, 1); assert.equal(e.h, 0);
  step(e, 1); assert.equal(e.h, 0); assert.equal(e.t, 0); // paused: no fuel
  e.f = 2; e.h = 1; e.t = 6; step(e, 0); assert.equal(e.f, 2); // already paid batch keeps going
  e.h = 0; e.t = 6; assert.equal(e.t, 6);
  const p = entry({ r: 'sand', q: 1, h: 1, t: 4, f: 0 });
  step(p, 1); assert.equal(p.t, 5); // a burning batch finishes even without spare fuel
});

test('step: dt clamped, NaN ignored, glass after 12 one-second steps, r resets', () => {
  const e = entry({ r: 'sand', q: 1, f: 2 });
  step(e, 1e6); assert.equal(e.t, 1);
  step(e, NaN); assert.equal(e.t, 1);
  step(e, -5); assert.equal(e.t, 1);
  const g = entry({ r: 'sand', q: 1, f: 2 });
  let done = 0; for (let i = 0; i < 11; i++) done += step(g, 1);
  assert.equal(done, 0);
  assert.equal(step(g, 1), 1);
  assert.deepEqual(g, entry({ f: 1, o: 'glass', n: 1 }));
  assert.equal(progress(g), 0); assert.equal(burning(g), false);
});

test('stepAll: reports changes and calls onDone when a queue empties', () => {
  const st = { k: { '1,0': entry({ r: 'clay', q: 1, f: 2 }), '2,0': entry({ f: 2 }) }, r: 0 };
  const done = [];
  assert.equal(stepAll(st, 1, (k, e) => done.push([k, e.n])), true);
  for (let i = 0; i < 9; i++) stepAll(st, 1, (k, e) => done.push([k, e.n]));
  assert.deepEqual(done, [['1,0', 1]]);
  assert.equal(stepAll(st, 1, () => {}), false);
  assert.equal(st.k['2,0'].f, 2);
});

// 5
test('load: atomic bag change; nothing, kind and full refusals change nothing', () => {
  const st = fresh();
  const bag = bagFrom([{ kind: 'metalore', count: 3 }, { kind: 'sand', count: 20 }, { kind: 'clay', count: 1 }]);
  let r = act(st, { kind: 'kiln.load', item: 'metalore' }, bag);
  assert.equal(r.ok, true); assert.equal(r.text, 'Loaded 2 metal ore · 1 in the kiln');
  assert.equal(bag.count('metalore'), 1); assert.equal(st.r, 1);
  assert.deepEqual(st.k['1,0'], entry({ r: 'metalore', q: 1 }));
  const snap = JSON.stringify(bag.snapshot()), stSnap = JSON.stringify(st);
  r = act(st, { kind: 'kiln.load', item: 'metalore' }, bag);
  assert.equal(r.reason, 'nothing'); assert.equal(r.text, 'Need 1 more metal ore');
  r = act(st, { kind: 'kiln.load', item: 'sand' }, bag); assert.equal(r.reason, 'kind'); assert.equal(r.text, TEXT.kind);
  assert.equal(JSON.stringify(bag.snapshot()), snap); assert.equal(JSON.stringify(st), stSnap);
  const t = { k: { '1,0': entry({ o: 'brick', n: 1 }) }, r: 0 };
  assert.equal(act(t, { kind: 'kiln.load', item: 'sand' }, bag).reason, 'kind');
  const s2 = fresh();
  for (let i = 0; i < KILN.QUEUE; i++) assert.equal(act(s2, { kind: 'kiln.load', item: 'sand' }, bag).ok, true);
  assert.equal(act(s2, { kind: 'kiln.load', item: 'sand' }, bag).reason, 'full');
  assert.equal(bag.count('sand'), 20 - 2 * KILN.QUEUE);
  const s3 = { k: { '1,0': entry({ o: 'glass', n: 9 }) }, r: 0 };
  assert.equal(act(s3, { kind: 'kiln.load', item: 'sand' }, bag).ok, true);
  assert.equal(act(s3, { kind: 'kiln.load', item: 'sand' }, bag).reason, 'full');
  assert.equal(canLoad(undefined, 'clay'), null);
  assert.equal(act(fresh(), { kind: 'kiln.load', item: 'wood' }, bag).reason, 'bad');
});

// 6
test('fuel: +2 per wood, capped at 8, nowood; selected wood slot first', () => {
  const st = fresh();
  const bag = bagFrom([{ kind: 'leaf', count: 1 }, { kind: 'wood', count: 3 }, null, { kind: 'wood', count: 5 }], 3);
  for (let i = 0; i < 4; i++) { const r = act(st, { kind: 'kiln.fuel' }, bag); assert.equal(r.ok, true); }
  assert.equal(st.k['1,0'].f, 8); assert.equal(bag.slots[3].count, 1); assert.equal(bag.slots[1].count, 3);
  const snap = JSON.stringify(bag.snapshot());
  const r = act(st, { kind: 'kiln.fuel' }, bag); assert.equal(r.reason, 'fuelfull'); assert.equal(JSON.stringify(bag.snapshot()), snap);
  assert.equal(act(fresh(), { kind: 'kiln.fuel' }, bagFrom([])).reason, 'nowood');
  const e = entry({ f: 7 }); assert.equal(addFuel(e), false); assert.equal(e.f, 7);
  assert.equal(act(fresh(), { kind: 'kiln.fuel' }, bagFrom([{ kind: 'wood', count: 1 }])).text, 'Fire stoked · 2 batches of fuel');
});

// 7
test('take: full, partial into a nearly full bag, bagfull', () => {
  const st = { k: { '1,0': entry({ o: 'glass', n: 5 }) }, r: 0 };
  const bag = bagFrom([]);
  const r = act(st, { kind: 'kiln.take' }, bag);
  assert.equal(r.ok, true); assert.equal(r.text, '+ 5 Glass'); assert.equal(bag.count('glass'), 5);
  assert.equal(st.k['1,0'], undefined);
  assert.equal(act(st, { kind: 'kiln.take' }, bag).reason, 'empty');
  const full = new Array(SLOT_COUNT).fill(null).map(() => ({ kind: 'wood', count: 20 }));
  full[0] = { kind: 'glass', count: 17 };
  const nearly = bagFrom(full);
  const s2 = { k: { '1,0': entry({ o: 'glass', n: 5, f: 2 }) }, r: 0 };
  assert.equal(act(s2, { kind: 'kiln.take' }, nearly).ok, true);
  assert.equal(nearly.count('glass'), 20); assert.equal(s2.k['1,0'].n, 2); assert.equal(s2.k['1,0'].o, 'glass');
  const snap = JSON.stringify(nearly.snapshot()), r0 = s2.r;
  const rf = act(s2, { kind: 'kiln.take' }, nearly);
  assert.equal(rf.reason, 'bagfull'); assert.equal(rf.text, TEXT.bagfull);
  assert.equal(JSON.stringify(nearly.snapshot()), snap); assert.equal(s2.r, r0); assert.equal(s2.k['1,0'].n, 2);
});

// 8
test('guards: missing, reach, bad kind/coords/bag; every success bumps r', () => {
  const st = fresh(), bag = bagFrom([{ kind: 'wood', count: 5 }]);
  assert.equal(act(st, { kind: 'kiln.fuel', x: 2 }, bag).reason, 'missing');
  assert.equal(act(st, { kind: 'kiln.fuel' }, bag, env(kilnAt, { x: 12, z: 0 })).reason, 'reach');
  assert.equal(act(st, { kind: 'kiln.burn' }, bag).reason, 'bad');
  assert.equal(act(st, { kind: 'kiln.fuel', x: 1.5 }, bag).reason, 'bad');
  assert.equal(act(st, { kind: 'kiln.fuel', x: 30 }, bag).reason, 'bad');
  assert.equal(act(st, { kind: 'kiln.fuel' }, { slots: [] }).reason, 'bad');
  assert.equal(applyKilnAction(st, null, 'host', bag, env()).reason, 'bad');
  assert.equal(st.r, 0); assert.equal(bag.count('wood'), 5);
  act(st, { kind: 'kiln.fuel' }, bag); assert.equal(st.r, 1);
  act(st, { kind: 'kiln.load', item: 'clay' }, bagFrom([{ kind: 'clay', count: 1 }])); assert.equal(st.r, 2);
  st.k['1,0'].o = 'brick'; st.k['1,0'].n = 1;
  act(st, { kind: 'kiln.take' }, bag); assert.equal(st.r, 3);
  assert.equal(TEXT.missing, 'That spot has no kiln'); assert.equal(TEXT.reach, 'Step a little closer');
});

// 9
test('sliceOf rounds t, omits idle entries and survives a JSON round trip', () => {
  const st = { k: { '1,0': entry({ r: 'sand', q: 2, h: 1, t: 3.14159, f: 1 }), '2,0': entry({}), '-1,3': entry({ o: 'metalingot', n: 4 }) }, r: 9 };
  const s = sliceOf(st);
  assert.equal(s.v, 1); assert.equal(s.r, 9);
  assert.equal(s.k['1,0'].t, 3.1); assert.equal(s.k['2,0'], undefined);
  const back = cleanSlice(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back, { r: 9, k: { '1,0': entry({ r: 'sand', q: 2, h: 1, t: 3.1, f: 1 }), '-1,3': entry({ o: 'metalingot', n: 4 }) } });
  s.k['1,0'].q = 99; assert.equal(st.k['1,0'].q, 2); // deep copy
});

// 10
function makeCtx(role = 'solo') {
  const world = { tiles: [[0, 0], [1, 0], [2, 0]], decor: [{ type: 'kiln', x: 1, z: 0 }], ext: {} };
  const emits = [], bags = { host: new Bag(), guest: new Bag() }, sent = [];
  const ctx = { T, world, role, running: true, physics: { x: 2, z: 0 }, other: null, camera: null, raft: null, esc: s => s,
    localBag: () => bags.host, actorBag: a => bags[a], emit: (e, to) => emits.push({ e, to }), notice() {}, rebuildRaft() {} };
  ctx.action = a => { sent.push(a); if (role !== 'guest') mod.action(a, 'host', bags.host); };
  const mod = createKiln(ctx);
  return { ctx, mod, emits, bags, sent, world };
}

test('module: load, net no-op, host/guest update, actions, debug and models', () => {
  const { mod, emits, bags, world } = makeCtx();
  mod.load(undefined, 'save');
  assert.deepEqual(mod.serialize(), { v: 1, r: 0, k: {} });
  mod.load({ r: 3, k: { '1,0': { r: 'clay', q: 1, f: 2 }, '2,0': { r: 'clay', q: 1, f: 2 } } }, 'save');
  assert.deepEqual(Object.keys(mod.serialize().k), ['1,0']); // decorAt prunes on save load
  assert.strictEqual(mod.serialize(), mod.serialize()); // cached
  mod.update(1);
  assert.equal(mod.debug.state().burning[0], '1,0');
  mod.debug.run(10);
  assert.ok(emits.some(x => x.to === 'all' && x.e.kind === 'loot' && x.e.text === 'The kiln is done: 1 Brick ready'));
  assert.equal(mod.action({ kind: 'storage.put' }, 'host', bags.host), false);
  assert.equal(mod.action({ kind: 'kiln.take', x: 1, z: 0 }, 'host', bags.host), true);
  assert.equal(bags.host.count('brick'), 1);
  assert.equal(emits.at(-1).e.kind, 'loot'); assert.equal(emits.at(-1).to, 'host');
  mod.action({ kind: 'kiln.take', x: 1, z: 0 }, 'host', bags.host);
  assert.equal(emits.at(-1).e.kind, 'notice');
  mod.debug.fill(1, 0, { r: 'sand', q: 3, f: 0 });
  assert.equal(mod.debug.finish(1, 0), true);
  assert.deepEqual(mod.debug.state().k['1,0'], { r: null, q: 0, t: 0, h: 0, f: 0, o: 'glass', n: 3 });
  // pruning once a second when the decor is gone
  world.decor.length = 0; mod.update(1.1);
  assert.deepEqual(mod.serialize().k, {});

  const kiln = mod.decorModel('kiln');
  assert.equal(kiln.name, 'kiln_station');
  let meshes = 0; kiln.traverse(o => { if (o.isMesh) meshes++; });
  assert.ok(meshes <= 6);
  assert.ok(kiln.userData.kiln.glow && kiln.userData.kiln.flame && kiln.userData.kiln.tray.glass);
  const lamp = mod.decorModel('glasslamp');
  assert.equal(lamp.name, 'craft_lantern');
  assert.ok(lamp.getObjectByName('lanternGlow'));
  assert.notStrictEqual(lamp.getObjectByName('lanternGlow').material, mod.decorModel('glasslamp').getObjectByName('lanternGlow').material);
  assert.equal(mod.decorModel('crate'), null);
  mod.dispose();
});

test('module: net load with the same r is a no-op; guest never steps or mutates', () => {
  const { mod, emits, sent, bags } = makeCtx('guest');
  const data = { v: 1, r: 4, k: { '1,0': { r: 'sand', q: 1, h: 1, t: 2, f: 0 } } };
  mod.load(data, 'net');
  assert.equal(mod.serialize().k['1,0'].t, 2);
  mod.load({ v: 1, r: 4, k: {} }, 'net'); // same r: ignored
  assert.ok(mod.serialize().k['1,0']);
  for (let i = 0; i < 20; i++) mod.update(1);
  assert.equal(mod.serialize().k['1,0'].t, 2);
  assert.equal(emits.length, 0);
  assert.equal(mod.debug.run(5), false); assert.equal(mod.debug.clear(), false);
  mod.load({ v: 1, r: 5, k: {} }, 'net');
  assert.deepEqual(mod.serialize().k, {});
  assert.equal(sent.length, 0); assert.equal(bags.guest.count('glass'), 0);
});

// 11
test('sinker: game.js halves hook wear when a Line Sinker is in the bag', () => {
  const src = readFileSync(new URL('game.js', base), 'utf8');
  assert.ok(src.includes("(wearPerUse(s.kind) || WEAR_PER_CATCH) * (bag.count('sinker') > 0 ? .5 : 1)")); // halves the catalogue wear too
});
