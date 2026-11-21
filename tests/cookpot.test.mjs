// Unit tests for the Cooking Pot (docs/specs/cookpot.md §9). Pure logic plus the content module with a fake ctx.
// Run: node --test tests/cookpot.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { Bag, RECIPES: CRAFT, SLOT_COUNT, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const SR = await import(new URL('storage-research.js', base));
const ITEMS_JS = await import(new URL('items.js', base));
const CI = await import(new URL('content-items.js', base));
const P = await import(new URL('cookpot-core.js', base));
const { createCookpot } = await import(new URL('cookpot.js', base));
const BUILD = '?build=v3-survival-ae77fa84ac2b';
const { MOVE_MUL } = await import(new URL('player-physics.js' + BUILD, base));
const { HOOK_MUL } = await import(new URL('hook-physics.js' + BUILD, base));
const { FISHING_TUNING } = await import(new URL('fishing-v2.js', base));
const { POT, INGREDIENTS, RECIPES, MEALS, MEAL_IDS, TEXT, blank, match, cleanEntry, cleanBuff, cleanSlice, sliceOf, step, stepAll, tickBuffs, buffMods, applyPotAction } = P;

const bagFrom = (slots, selected = 0) => { const s = new Array(SLOT_COUNT).fill(null); slots.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected }); };
const potAt = [{ type: 'cookpot', x: 1, z: 0 }, { type: 'crate', x: 2, z: 0 }];
const env = (decor = potAt, pos = { x: 2, z: 0 }) => ({ decorAt: (x, z) => decor.find(d => d.x === x && d.z === z)?.type ?? null, pos: () => pos });
const fresh = () => ({ k: {}, b: { host: null, guest: null }, r: 0, br: 0 });
const act = (st, a, bag, actor = 'host', e = env()) => applyPotAction(st, { x: 1, z: 0, ...a }, actor, bag, e);
const entry = o => ({ ...blank(), ...o });
const fullBag = (kind = 'rope') => bagFrom(new Array(SLOT_COUNT).fill(null).map(() => ({ kind, count: 20 })));
const snap = b => JSON.stringify(b.snapshot());

// 1
test('match: order-free, never mutates, null for wrong sizes and unknown sets; RECIPES keys are sorted', () => {
  const l = ['puffegg', 'leaf', 'puffegg'];
  assert.equal(match(l), 'meal_omelette'); assert.deepEqual(l, ['puffegg', 'leaf', 'puffegg']);
  assert.equal(match(['seaweed', 'fish', 'freshcup']), 'meal_chowder');
  assert.equal(match(['leaf', 'puffegg']), null);
  assert.equal(match(['leaf', 'puffegg', 'puffegg', 'leaf']), null);
  assert.equal(match(['leaf', 'leaf', 'leaf']), null);
  assert.equal(match('leaf+puffegg+puffegg'), null);
  for (const [k, v] of Object.entries(RECIPES)) {
    assert.equal(k.split('+').sort().join('+'), k);
    assert.ok(k.split('+').every(x => INGREDIENTS.includes(x)));
    assert.ok(MEAL_IDS.includes(v));
  }
  assert.equal(new Set(Object.values(RECIPES)).size, MEAL_IDS.length);
  for (const m of MEAL_IDS) assert.ok(Object.isFrozen(MEALS[m]));
});

// 2
test('add: 3 max, busy while cooking, nothing without the kind, fresh water returns the cup', () => {
  const st = fresh(), bag = bagFrom([{ kind: 'puffegg', count: 5 }, { kind: 'freshcup', count: 1 }]);
  assert.equal(act(st, { kind: 'pot.add', item: 'leaf' }, bag).reason, 'nothing');
  assert.equal(act(st, { kind: 'pot.add', item: 'wood' }, bag).reason, 'bad');
  let r = act(st, { kind: 'pot.add', item: 'puffegg' }, bag);
  assert.ok(r.ok); assert.equal(r.text, 'Added puff egg · 1/3'); assert.equal(st.r, 1);
  r = act(st, { kind: 'pot.add', item: 'freshcup' }, bag);
  assert.ok(r.ok); assert.equal(bag.count('freshcup'), 0); assert.equal(bag.count('cup'), 1);
  r = act(st, { kind: 'pot.add', item: 'puffegg' }, bag);
  assert.ok(r.ok); assert.equal(r.text, TEXT.norecipe);
  assert.equal(act(st, { kind: 'pot.add', item: 'puffegg' }, bag).reason, 'full');
  const st2 = fresh(); st2.k['1,0'] = entry({ i: ['leaf', 'puffegg', 'puffegg'], f: 1, h: 1, c: 'meal_omelette' });
  assert.equal(act(st2, { kind: 'pot.add', item: 'puffegg' }, bag).reason, 'busy');
  const st3 = fresh(), b3 = bagFrom([{ kind: 'puffegg', count: 2 }, { kind: 'leaf', count: 1 }]);
  act(st3, { kind: 'pot.add', item: 'puffegg' }, b3); act(st3, { kind: 'pot.add', item: 'puffegg' }, b3);
  assert.equal(act(st3, { kind: 'pot.add', item: 'leaf' }, b3).text, 'Puff Omelette is ready to simmer · add wood');
  // selected slot first
  const b4 = bagFrom([{ kind: 'puffegg', count: 1 }, { kind: 'puffegg', count: 3 }], 1);
  act(fresh(), { kind: 'pot.add', item: 'puffegg' }, b4);
  assert.equal(b4.slots[0].count, 1); assert.equal(b4.slots[1].count, 2);
  // reach / missing / bad
  assert.equal(act(fresh(), { kind: 'pot.add', item: 'puffegg', x: 2 }, b4).reason, 'missing');
  assert.equal(act(fresh(), { kind: 'pot.add', item: 'puffegg' }, b4, 'host', env(potAt, { x: 9, z: 0 })).reason, 'reach');
  assert.equal(act(fresh(), { kind: 'pot.add', item: 'puffegg', x: 1.5 }, b4).reason, 'bad');
  assert.equal(act(fresh(), { kind: 'pot.add', item: 'puffegg' }, b4, 'nobody').reason, 'bad');
  assert.equal(act(fresh(), { kind: 'pot.nope' }, b4).reason, 'bad');
  // a full bag cannot take the cup back
  const fb = fullBag(); fb.slots[0] = { kind: 'freshcup', count: 2 };
  const before = snap(fb), st5 = fresh();
  assert.equal(act(st5, { kind: 'pot.add', item: 'freshcup' }, fb).reason, 'bagfull');
  assert.equal(snap(fb), before); assert.deepEqual(st5.k, {});
});

// 3
test('fuel/step: no fuel never starts, 1 wood = 1 cook, idle keeps fuel, tray cap and different meals wait', () => {
  const e = entry({ i: ['leaf', 'puffegg', 'puffegg'] });
  for (let i = 0; i < 50; i++) assert.equal(step(e, 1), 0);
  assert.equal(e.h, 0);
  const idleFuel = entry({ f: 3 }); for (let i = 0; i < 50; i++) step(idleFuel, 1); assert.equal(idleFuel.f, 3);
  const bad = entry({ i: ['leaf', 'leaf', 'leaf'], f: 2 }); for (let i = 0; i < 50; i++) step(bad, 1); assert.equal(bad.f, 2); assert.equal(bad.h, 0);
  e.f = 1;
  let done = 0; for (let i = 0; i < 19; i++) done += step(e, 1);
  assert.equal(done, 0); assert.equal(e.h, 1); assert.equal(e.f, 0); assert.equal(e.c, 'meal_omelette');
  assert.equal(step(e, NaN), 0); assert.equal(step(e, 99), 1); // dt clamped to 1 → t reaches 20
  assert.deepEqual(e, entry({ o: 'meal_omelette', n: 2 }));
  // tray cap: 3 cooks fill 6, a 4th waits
  const t = entry({ o: 'meal_omelette', n: 6, i: ['leaf', 'puffegg', 'puffegg'], f: 2 });
  for (let i = 0; i < 30; i++) step(t, 1);
  assert.equal(t.h, 0); assert.equal(t.f, 2); assert.equal(t.n, 6);
  const d = entry({ o: 'meal_broth', n: 2, i: ['leaf', 'puffegg', 'puffegg'], f: 2 });
  for (let i = 0; i < 30; i++) step(d, 1);
  assert.equal(d.h, 0); assert.equal(d.f, 2);
  const same = entry({ o: 'meal_omelette', n: 4, i: ['leaf', 'puffegg', 'puffegg'], f: 2 });
  for (let i = 0; i < 25; i++) step(same, 1);
  assert.equal(same.n, 6); assert.equal(same.f, 1);
  // fuel action
  const st = fresh(), bag = bagFrom([{ kind: 'wood', count: 6 }]);
  for (let i = 1; i <= 4; i++) { const r = act(st, { kind: 'pot.fuel' }, bag); assert.ok(r.ok); assert.equal(r.text, `Fire stoked · ${i} cooks of fuel`); }
  assert.equal(act(st, { kind: 'pot.fuel' }, bag).reason, 'fuelfull'); assert.equal(bag.count('wood'), 2);
  assert.equal(act(fresh(), { kind: 'pot.fuel' }, bagFrom([])).reason, 'nowood');
  // stepAll + onDone
  const sa = fresh(); sa.k['1,0'] = entry({ i: ['fish', 'freshcup', 'seaweed'], f: 1 });
  const fin = []; let ch = false;
  for (let i = 0; i < 21; i++) ch = stepAll(sa, 1, (k, x) => fin.push([k, x.o, x.n])) || ch;
  assert.ok(ch); assert.deepEqual(fin, [['1,0', 'meal_chowder', 2]]);
});

// 4
test('take and back', () => {
  const st = fresh(); st.k['1,0'] = entry({ o: 'meal_broth', n: 2 });
  const bag = bagFrom([{ kind: 'wood', count: 1 }]);
  assert.equal(act(st, { kind: 'pot.take' }, bag).reason, 'nobowl');
  bag.add('bowl', 2);
  let r = act(st, { kind: 'pot.take' }, bag);
  assert.ok(r.ok); assert.equal(r.text, '+ 1 Kelp Broth'); assert.equal(bag.count('meal_broth'), 1); assert.equal(bag.count('bowl'), 1);
  act(st, { kind: 'pot.take' }, bag); assert.deepEqual(st.k, {});
  assert.equal(act(st, { kind: 'pot.take' }, bag).reason, 'empty');
  // bagfull leaves everything unchanged
  const fb = fullBag(); fb.slots[0] = { kind: 'bowl', count: 20 };
  const st2 = fresh(); st2.k['1,0'] = entry({ o: 'meal_broth', n: 2 });
  const before = snap(fb);
  assert.equal(act(st2, { kind: 'pot.take' }, fb).reason, 'bagfull'); assert.equal(snap(fb), before); assert.equal(st2.k['1,0'].n, 2);
  // back pops the last
  const st3 = fresh(); st3.k['1,0'] = entry({ i: ['leaf', 'seed'] });
  const b3 = bagFrom([]);
  r = act(st3, { kind: 'pot.back' }, b3); assert.ok(r.ok); assert.equal(b3.count('seed'), 1); assert.deepEqual(st3.k['1,0'].i, ['leaf']);
  act(st3, { kind: 'pot.back' }, b3); assert.deepEqual(st3.k, {});
  assert.equal(act(st3, { kind: 'pot.back' }, b3).reason, 'empty');
  const st4 = fresh(); st4.k['1,0'] = entry({ i: ['leaf', 'puffegg', 'puffegg'], f: 1, h: 1, c: 'meal_omelette' });
  assert.equal(act(st4, { kind: 'pot.back' }, b3).reason, 'busy');
  // fresh water back needs a cup
  const st5 = fresh(); st5.k['1,0'] = entry({ i: ['seaweed', 'freshcup'] });
  assert.equal(act(st5, { kind: 'pot.back' }, b3).reason, 'nocup');
  b3.add('cup', 1);
  assert.ok(act(st5, { kind: 'pot.back' }, b3).ok); assert.equal(b3.count('cup'), 0); assert.equal(b3.count('freshcup'), 1);
});

// 5
test('nothing lost: bag + pot item totals are conserved by add/back/take, refusals included (cups and water together)', () => {
  const inPot = (st, f) => Object.values(st.k).reduce((a, e) => a + e.i.filter(f).length, 0);
  const water = (bag, st) => bag.count('freshcup') + inPot(st, k => k === 'freshcup');
  const vessels = bag => bag.count('cup') + bag.count('freshcup'); // the pot keeps the water, never the cup
  const others = (bag, st) => INGREDIENTS.reduce((a, k) => a + (k === 'freshcup' ? 0 : bag.count(k)), 0) + inPot(st, k => k !== 'freshcup');
  const meals = bag => MEAL_IDS.reduce((a, m) => a + bag.count(m), 0);
  const bowlsMeals = bag => bag.count('bowl') + meals(bag);
  const servings = (bag, st) => meals(bag) + Object.values(st.k).reduce((a, e) => a + e.n, 0);
  const st = fresh(), bag = bagFrom([{ kind: 'freshcup', count: 3 }, { kind: 'seaweed', count: 4 }, { kind: 'fish', count: 2 }, { kind: 'bowl', count: 1 }, { kind: 'cup', count: 1 }]);
  st.k['1,0'] = entry({ o: 'meal_broth', n: 2 });
  const seq = [['pot.add', 'freshcup'], ['pot.add', 'seaweed'], ['pot.add', 'fish'], ['pot.add', 'seaweed'], ['pot.back'], ['pot.back'], ['pot.back'],
    ['pot.back'], ['pot.take'], ['pot.take'], ['pot.add', 'leaf'], ['pot.add', 'freshcup'], ['pot.add', 'freshcup'], ['pot.back'], ['pot.back']];
  const f0 = [water(bag, st), vessels(bag), others(bag, st), bowlsMeals(bag), servings(bag, st)];
  let oks = 0, nos = 0;
  for (const [kind, item] of seq) {
    const r = act(st, { kind, item }, bag); r.ok ? oks++ : nos++;
    assert.deepEqual([water(bag, st), vessels(bag), others(bag, st), bowlsMeals(bag), servings(bag, st)], f0, kind + ' ' + (r.reason ?? 'ok'));
  }
  assert.ok(oks > 5 && nos > 2);
});

// 6
test('eat: meal -> bowl, sets b[actor], replaces and restarts, full bag still eats, bad for a non-meal', () => {
  const st = fresh(), bag = bagFrom([{ kind: 'meal_omelette', count: 2 }, { kind: 'meal_stew', count: 1 }]);
  const r = applyPotAction(st, { kind: 'pot.eat', item: 'meal_omelette' }, 'host', bag, env());
  assert.ok(r.ok); assert.equal(r.text, 'Tummy full of Puff Omelette: Springy Step');
  assert.deepEqual(st.b.host, { m: 'meal_omelette', s: 180 }); assert.equal(st.br, 1); assert.equal(st.r, 0);
  assert.equal(bag.count('meal_omelette'), 1); assert.equal(bag.count('bowl'), 1);
  tickBuffs(st.b, 1); assert.equal(st.b.host.s, 179);
  applyPotAction(st, { kind: 'pot.eat', item: 'meal_omelette' }, 'host', bag, env());
  assert.equal(st.b.host.s, 180);
  applyPotAction(st, { kind: 'pot.eat', item: 'meal_stew' }, 'host', bag, env());
  assert.deepEqual(st.b.host, { m: 'meal_stew', s: 300 });
  assert.equal(applyPotAction(st, { kind: 'pot.eat', item: 'meal_stew' }, 'host', bag, env()).reason, 'nomeal');
  assert.equal(applyPotAction(st, { kind: 'pot.eat', item: 'fish' }, 'host', bag, env()).reason, 'bad');
  const fb = fullBag(); fb.slots[0] = { kind: 'meal_broth', count: 5 };
  assert.ok(applyPotAction(st, { kind: 'pot.eat', item: 'meal_broth' }, 'host', fb, env()).ok);
  assert.equal(fb.count('meal_broth'), 4); assert.equal(fb.count('bowl'), 0);
  const gb = bagFrom([{ kind: 'meal_custard', count: 1 }]), before = JSON.stringify(st.b.host);
  assert.ok(applyPotAction(st, { kind: 'pot.eat', item: 'meal_custard' }, 'guest', gb, env()).ok);
  assert.deepEqual(st.b.guest, { m: 'meal_custard', s: 240 }); assert.equal(JSON.stringify(st.b.host), before);
});

// 7
test('tickBuffs and buffMods', () => {
  const b = { host: { m: 'meal_broth', s: 1.5 }, guest: null };
  assert.equal(tickBuffs(b, 1), false); assert.equal(tickBuffs(b, 1), true); assert.equal(b.host, null); assert.equal(tickBuffs(b, 1), false);
  assert.equal(tickBuffs(b, NaN), false);
  assert.deepEqual(buffMods(null, {}), { swim: 1, walk: 1, jump: 1, oxy: 1, reel: 1, night: 0 });
  assert.deepEqual(buffMods({ m: 'meal_stew', s: 3 }, {}), { swim: 1.1, walk: 1.1, jump: 1, oxy: 1.25, reel: 1.1, night: 0 });
  assert.equal(buffMods({ m: 'meal_custard', s: 3 }, {}).night, 1);
  assert.equal(buffMods({ m: 'nope', s: 3 }, {}).swim, 1);
});

// 8
test('malformed saves are cleaned and never throw; keepGuest; round trip', () => {
  for (const junk of [undefined, null, 5, 'x', [], { k: [] }, { b: 7 }, { r: -1, br: 1.5 }]) {
    const c = cleanSlice(junk); assert.deepEqual(c, { k: {}, b: { host: null, guest: null }, r: 0, br: 0 });
  }
  for (const junk of [undefined, null, 5, [], {}, { f: NaN }, { i: 'leaf' }, { o: 'meal_stew' }, { o: 'meal_stew', n: 9 }]) assert.equal(cleanEntry(junk), null);
  assert.deepEqual(cleanEntry({ i: ['leaf', 'gold'], f: 2 }), entry({ f: 2 }));
  assert.deepEqual(cleanEntry({ i: ['leaf', 'leaf', 'leaf', 'leaf'], f: 9, o: 'meal_x', n: 2 }), null);
  assert.deepEqual(cleanEntry({ i: ['leaf', 'puffegg', 'puffegg'], h: 1, c: 'meal_omelette', t: 500 }), entry({ i: ['leaf', 'puffegg', 'puffegg'], h: 1, c: 'meal_omelette', t: 20 }));
  assert.deepEqual(cleanEntry({ i: ['leaf', 'puffegg', 'puffegg'], h: 1, c: 'meal_broth', t: 5 }), entry({ i: ['leaf', 'puffegg', 'puffegg'] }));
  assert.deepEqual(cleanEntry({ i: ['leaf', 'puffegg', 'puffegg'], h: 1, c: 'meal_omelette', t: NaN, o: 'meal_omelette', n: 6 }), entry({ i: ['leaf', 'puffegg', 'puffegg'], o: 'meal_omelette', n: 6 }));
  assert.deepEqual(cleanBuff({ m: 'meal_broth', s: 1e9 }), { m: 'meal_broth', s: 180 });
  assert.deepEqual(cleanBuff({ m: 'meal_stew', s: 1e9 }), { m: 'meal_stew', s: 300 });
  for (const junk of [null, { m: 'meal_broth', s: NaN }, { m: 'meal_x', s: 5 }, { m: 'meal_broth', s: -3 }, [], 'x']) assert.equal(cleanBuff(junk), null);
  const good = { i: ['leaf'], f: 1 };
  const c = cleanSlice({ r: 4, br: 2, b: { host: { m: 'meal_broth', s: 50 }, guest: { m: 'meal_custard', s: 10 } }, k: { 'a,b': good, '1,0': good, '99,0': good, '2,2': 'x', '001,0': good, '-3,4': good } });
  assert.equal(c.r, 4); assert.equal(c.br, 2); assert.deepEqual(Object.keys(c.k).sort(), ['-3,4', '1,0']);
  assert.deepEqual(c.b.guest, { m: 'meal_custard', s: 10 });
  assert.equal(cleanSlice({ b: { guest: { m: 'meal_custard', s: 10 } } }, undefined, false).b.guest, null);
  assert.deepEqual(Object.keys(cleanSlice({ k: { '1,0': good, '-3,4': good } }, (x, z) => (x === 1 && z === 0 ? 'cookpot' : 'crate')).k), ['1,0']);
  const many = {}; for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) many[x + ',' + z] = good;
  assert.equal(Object.keys(cleanSlice({ k: many }).k).length, POT.MAX_POTS);
  assert.doesNotThrow(() => cleanSlice({ k: { get '1,0'() { throw new Error('x'); } } }));
  const st = { k: { '1,0': entry({ i: ['leaf', 'puffegg', 'puffegg'], f: 1, h: 1, c: 'meal_omelette', t: 3.14159 }), '2,0': entry({}) }, b: { host: { m: 'meal_broth', s: 12.2 }, guest: null }, r: 9, br: 3 };
  const s = sliceOf(st);
  assert.equal(s.v, 1); assert.equal(s.k['1,0'].t, 3.1); assert.equal(s.k['2,0'], undefined); assert.equal(s.b.host.s, 13);
  const back = cleanSlice(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(sliceOf(back), s);
  s.k['1,0'].i.push('x'); assert.equal(st.k['1,0'].i.length, 3);
});

// 9
function makeCtx(role = 'solo') {
  const world = { tiles: [[0, 0], [1, 0], [2, 0]], decor: [{ type: 'cookpot', x: 1, z: 0 }], ext: {} };
  const emits = [], bags = { host: new Bag(), guest: new Bag() }, sent = [], notes = [];
  const renderer = { toneMappingExposure: .6 }, hemi = { intensity: .7 };
  const ctx = { T, world, role, running: true, physics: { x: 2, z: 0 }, other: null, camera: null, raft: null, esc: s => s, renderer, hemi,
    localBag: () => bags[role === 'guest' ? 'guest' : 'host'], actorBag: a => bags[a], emit: (e, to) => emits.push({ e, to }), notice: s => notes.push(s), rebuildRaft() {} };
  ctx.action = a => { sent.push(a); if (role !== 'guest') mod.action(a, 'host', bags.host); };
  const mod = createCookpot(ctx);
  return { ctx, mod, emits, bags, sent, world, notes, renderer, hemi };
}

test('module: serialize cache, update knobs, diveMods, dispose resets, debug flow', () => {
  const { mod, emits, bags, notes, renderer, hemi } = makeCtx();
  mod.load(undefined, 'save');
  assert.deepEqual(mod.serialize(), { v: 1, r: 0, br: 0, k: {}, b: { host: null, guest: null } });
  assert.strictEqual(mod.serialize(), mod.serialize());
  mod.load({ r: 1, k: { '1,0': { i: ['leaf'], f: 1 }, '2,0': { i: ['leaf'], f: 1 } }, b: { guest: { m: 'meal_broth', s: 9 } } }, 'save');
  assert.deepEqual(Object.keys(mod.serialize().k), ['1,0']); assert.equal(mod.serialize().b.guest, null);
  mod.debug.clear();
  bags.host.add('puffegg', 2); bags.host.add('leaf', 1); bags.host.add('wood', 1); bags.host.add('bowl', 1);
  for (const item of ['puffegg', 'puffegg', 'leaf']) mod.action({ kind: 'pot.add', x: 1, z: 0, item }, 'host', bags.host);
  mod.action({ kind: 'pot.fuel', x: 1, z: 0 }, 'host', bags.host);
  mod.update(.5); assert.deepEqual(mod.debug.state().cooking, ['1,0']);
  mod.debug.run(20);
  assert.ok(emits.some(x => x.to === 'all' && x.e.text === 'The pot is ready: 2 Puff Omelette'));
  mod.action({ kind: 'pot.take', x: 1, z: 0 }, 'host', bags.host);
  assert.equal(bags.host.count('meal_omelette'), 1); assert.equal(emits.at(-1).e.kind, 'loot');
  mod.action({ kind: 'pot.eat', item: 'meal_omelette' }, 'host', bags.host);
  mod.update(.1);
  assert.equal(MOVE_MUL.walk, 1.15); assert.equal(MOVE_MUL.jump, 1.15); assert.equal(mod.debug.buff().mods.walk, 1.15);
  const s0 = mod.serialize(); mod.update(.1); assert.strictEqual(mod.serialize(), s0); // same whole second
  mod.debug.feed('meal_chowder');
  mod.update(.1);
  assert.equal(MOVE_MUL.swim, 1.35);
  const m = { swim: 1.3, oxy: 1, fog: 1, gather: 1 }; mod.diveMods(m);
  assert.equal(m.swim, 1.3 * 1.35); assert.equal(m.oxy, 1);
  mod.debug.feed('meal_fishbowl'); mod.update(.1);
  assert.equal(HOOK_MUL.reel, 1.3); assert.ok(Math.abs(FISHING_TUNING.reelTime - 3.5 / 1.3) < 1e-9);
  assert.equal(MOVE_MUL.swim, 1);
  // night floor
  mod.debug.feed('meal_custard'); mod.update(.1);
  assert.equal(renderer.toneMappingExposure, 1); assert.equal(hemi.intensity, 1.25);
  // expiry toast
  for (let i = 0; i < 245; i++) mod.update(1);
  assert.equal(mod.debug.buff().entry, null); assert.ok(notes.includes('Night Owl wore off'));
  mod.debug.feed('meal_stew'); mod.update(.1);
  const pot = mod.decorModel('cookpot');
  assert.equal(pot.name, 'cookpot_station');
  let meshes = 0; pot.traverse(o => { if (o.isMesh) meshes++; }); assert.ok(meshes <= 5);
  assert.ok(pot.userData.cookpot.lid && pot.userData.cookpot.glow && pot.userData.cookpot.steam && pot.userData.cookpot.stew);
  assert.equal(mod.decorModel('kiln'), null);
  mod.dispose();
  assert.equal(MOVE_MUL.walk, 1); assert.equal(MOVE_MUL.swim, 1); assert.equal(MOVE_MUL.jump, 1); assert.equal(HOOK_MUL.reel, 1);
  assert.equal(FISHING_TUNING.reelTime, 3.5);
});

test('module: guest adopts b from net, applies only its own buff, never mutates', () => {
  const { mod, sent, emits } = makeCtx('guest');
  assert.equal(mod.interact(null), false); // nothing aimed, no meal held
  mod.load({ v: 1, r: 2, br: 1, k: { '1,0': { i: ['leaf'], f: 1 } }, b: { host: { m: 'meal_chowder', s: 100 }, guest: null } }, 'net');
  mod.update(.1);
  assert.equal(MOVE_MUL.swim, 1); // host's buff never applies on the guest
  mod.load({ v: 1, r: 2, br: 2, k: {}, b: { host: null, guest: { m: 'meal_omelette', s: 170 } } }, 'net');
  assert.ok(mod.serialize().k['1,0']); // same r: pots unchanged
  mod.update(.1);
  assert.equal(MOVE_MUL.walk, 1.15); assert.equal(mod.debug.buff().entry.m, 'meal_omelette');
  for (let i = 0; i < 5; i++) mod.update(1);
  const s = mod.debug.buff().entry.s;
  mod.load({ v: 1, r: 2, br: 2, k: {}, b: { host: null, guest: { m: 'meal_omelette', s: 164 } } }, 'net'); // within 2 s: keep local
  assert.equal(mod.debug.buff().entry.s, s);
  mod.load({ v: 1, r: 2, br: 2, k: {}, b: { host: null, guest: { m: 'meal_omelette', s: 100 } } }, 'net'); // drifted: resync
  assert.equal(mod.debug.buff().entry.s, 100);
  assert.equal(mod.debug.run(5), false); assert.equal(mod.debug.feed('meal_stew'), false);
  assert.equal(sent.length, 0); assert.equal(emits.length, 0);
  mod.dispose();
  assert.equal(MOVE_MUL.walk, 1);
});

test('engine import specifiers match game.js / fishing-cooking.js (one module instance)', () => {
  const src = readFileSync(new URL('cookpot.js', base), 'utf8');
  const game = readFileSync(new URL('game.js', base), 'utf8'), fc = readFileSync(new URL('fishing-cooking.js', base), 'utf8');
  const spec = (s, f) => { const m = new RegExp(`from '(\\./${f.replace('.', '\\.')}[^']*)'`).exec(s); return m && m[1]; };
  for (const f of ['player-physics.js', 'hook-physics.js']) { assert.ok(spec(src, f)); assert.equal(spec(src, f), spec(game, f), f); }
  assert.ok(spec(src, 'fishing-v2.js')); assert.equal(spec(src, 'fishing-v2.js'), spec(fc, 'fishing-v2.js'));
  const content = readFileSync(new URL('content.js', base), 'utf8');
  const feats = /const FEATURES = \[([^\]]*)\]/.exec(content)[1].split(',').map(s => s.trim()).filter(Boolean);
  assert.equal(feats.at(-1), 'createCookpot');
  assert.ok(content.includes("diveMods(out)"));
});

// 10
test('data and reachability', () => {
  const ids = ['cookpot', 'bowl', ...MEAL_IDS];
  for (const id of ids) {
    assert.ok(CI.CONTENT_ITEMS[id], id); assert.ok(ITEM_INFO[id], id);
    assert.ok(!(id in ITEMS_JS.ITEMS), id); assert.ok(!(id in (ITEMS_JS.LEGACY_ALIASES ?? {})), id);
  }
  for (const m of MEAL_IDS) { assert.equal(CI.CONTENT_ITEMS[m].maxStack, 10); assert.equal(CI.CONTENT_ITEMS[m].name, MEALS[m].name); assert.ok(!CRAFT[m]); }
  for (const k of INGREDIENTS) assert.ok(ITEM_INFO[k], k);
  assert.ok(CI.CONTENT_DECOR.includes('cookpot')); assert.equal(CI.CONTENT_BLOCK_RADIUS.cookpot, .35);
  assert.deepEqual({ ...CRAFT.cookpot.cost }, { clay: 3, stone: 2, scrap: 1 });
  assert.deepEqual({ ...CRAFT.bowl.output }, { kind: 'bowl', count: 2 });
  const kinds = SR.ingredientKinds();
  for (const id of ['cookpot', 'bowl']) for (const k of Object.keys(CRAFT[id].cost)) assert.ok(kinds.includes(k), k);
  assert.ok(SR.learnedFrom(['stone', 'clay', 'scrap']).includes('cookpot'));
  assert.ok(SR.learnedFrom(['wood']).includes('bowl'));
  assert.ok(!SR.STARTER.includes('cookpot') && !SR.STARTER.includes('bowl'));
});
