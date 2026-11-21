// Unit tests for the Tufflet (docs/specs/tufflet.md): species table, saves, graph, wool, shear, items, module, models.
// Run: node --test tests/tufflets.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const C = await import(new URL('animals-core.js', base));
const { createAnimals } = await import(new URL('animals.js', base));
const { Bag, SLOT_COUNT, RECIPES, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const SR = await import(new URL('storage-research.js', base));
const CI = await import(new URL('content-items.js', base));
const CB = await import(new URL('craft-book.js', base));
const T = await import(new URL('vendor/three.module.js', base));
const TM = await import(new URL('tufflet-models.js', base));

const bagFrom = (slots, selected = 0) => { const s = new Array(SLOT_COUNT).fill(null); slots.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected }); };
const grid = (w, h) => { const t = []; for (let x = 0; x < w; x++) for (let z = 0; z < h; z++) t.push([x, z]); return t; };
const hen = (o = {}) => ({ id: 'p1', kind: 'puffhen', name: 'Pip', seed: 12345, home: [0, 0], born: 0, hearts: 0, content: 0, prod: 0, eggs: 0, feather: 0, bondAt: -1e9, featherAt: -1e9, ...o });
const goat = (o = {}) => ({ id: 'g1', kind: 'goat', name: 'Nutmeg', seed: 777, home: [0, 0], born: 0, hearts: 0, content: 0, prod: 0, milk: 0, bondAt: -1e9, ...o });
const tuft = (o = {}) => ({ id: 't1', kind: 'tufflet', name: 'Puffin', seed: 4242, home: [0, 0], born: 0, hearts: 0, content: 0, prod: 0, wool: 0, bondAt: -1e9, ...o });
const stateWith = (list, extra = {}) => C.cleanAnimals({ v: 1, r: 0, t: 0, next: 9, list, lures: [], ...extra }, null);
const fixed = v => () => v;
const full = (except = {}) => Array.from({ length: SLOT_COUNT }, (_, i) => except[i] ?? { kind: 'scrap', count: 20 });
const TUFT_KEYS = ['id', 'kind', 'name', 'seed', 'home', 'born', 'hearts', 'content', 'prod', 'wool', 'bondAt'];

// 1
test('SPECIES: tufflet row, caps, MAX_TOTAL, home tables, names', () => {
  const S = C.SPECIES.tufflet;
  assert.ok(Object.isFrozen(S) && Object.isFrozen(S.foods) && Object.isFrozen(S.lure[0]) && Object.isFrozen(S.stock[0]));
  assert.equal(S.prefix, 't'); assert.equal(S.home, 'tuftnook'); assert.equal(S.code, 3); assert.equal(S.cap, 2);
  assert.equal(C.MAX_TOTAL, 8);
  assert.equal(C.MAX_TOTAL, Object.values(C.SPECIES).reduce((n, s) => n + s.cap, 0));
  assert.equal(C.MAX_SLOTS, 6);
  assert.deepEqual({ ...C.HOME_CODE }, { nestbox: 1, goatpen: 2 });
  assert.deepEqual({ ...C.HOME_TYPES }, { nestbox: 1, goatpen: 2, tuftnook: 3 });
  assert.deepEqual({ ...C.KIND_OF_HOME }, { nestbox: 'puffhen', goatpen: 'goat', tuftnook: 'tufflet' });
  assert.equal(C.TUFT_NAMES.length, 12);
  for (const n of C.TUFT_NAMES) assert.ok([...n].length <= 14, n);
  assert.ok(Math.abs(C.woolPeriod({ content: 0, hearts: 0 }) - 360) < 1e-9);
  assert.ok(Math.abs(C.periodOf({ kind: 'goat', content: 0, hearts: 0 }) - C.milkPeriod({ content: 0, hearts: 0 })) < 1e-9);
});

// 2
test('round trips: hen and hen+goat saves unchanged; tufflet clamps, ids, caps, lures, next', () => {
  const decor = [{ type: 'nestbox', x: 0, z: 0 }, { type: 'nestbox', x: 2, z: 0 }, { type: 'goatpen', x: 3, z: 0 }, { type: 'nestbox', x: 4, z: 0 }, { type: 'goatpen', x: 5, z: 0 }];
  const henOnly = { v: 1, r: 7, t: 123.4, next: 3, list: [hen({ born: 10.5, hearts: 2, content: 40, prod: 12, eggs: 1, bondAt: 60 }), hen({ id: 'p2', home: [2, 0], name: 'Bun' })], lures: [{ home: [4, 0], at: 140 }] };
  const mixed = { v: 1, r: 3, t: 200, next: 6, list: [hen(), goat({ id: 'g2', home: [3, 0], milk: 1, prod: 300, hearts: 4, bondAt: 150 })], lures: [{ home: [4, 0], at: 230 }, { home: [5, 0], at: 240, kind: 'goat' }] };
  for (const fx of [henOnly, mixed]) {
    assert.deepEqual(C.cleanAnimals(JSON.parse(JSON.stringify(fx)), null), fx);
    const m = createAnimals({ T: null, role: 'host', running: false, world: { tiles: grid(6, 1), decor, pieces: [] }, emit() {}, action() {} });
    m.load(JSON.parse(JSON.stringify(fx)), 'save');
    assert.equal(JSON.stringify(m.serialize()), JSON.stringify(fx), 'byte-identical save');
  }
  const t = C.cleanAnimals({ t: 50, list: [tuft({ wool: 9, prod: 9999, content: -2, hearts: 2.5, born: 80, eggs: 2, milk: 1 })] }, null).list[0];
  assert.deepEqual(Object.keys(t), TUFT_KEYS);
  assert.equal(t.wool, 2); assert.equal(t.prod, 360); assert.equal(t.content, 0); assert.equal(t.hearts, 2); assert.equal(t.born, 50);
  assert.equal(C.cleanAnimals({ list: [tuft({ wool: -3, prod: -1 })] }, null).list[0].wool, 0);
  assert.ok(C.TUFT_NAMES.includes(C.cleanAnimals({ list: [tuft({ name: '' })] }, null).list[0].name));
  // a t-id on another kind (and the other way round) is dropped
  const bad = C.cleanAnimals({ list: [hen({ id: 't5', home: [1, 0] }), goat({ id: 't6', home: [2, 0] }), tuft({ id: 'p7', home: [3, 0] }), tuft({ id: 't8', home: [4, 0] })] }, null);
  assert.deepEqual(bad.list.map(a => a.id), ['t8']);
  // 5 + 3 + 3 -> 4 + 2 + 2
  const many = [];
  for (let k = 0; k < 5; k++) many.push(hen({ id: 'p' + (k + 1), home: [k, 0] }));
  for (let k = 0; k < 3; k++) many.push(goat({ id: 'g' + (k + 1), home: [k, 1] }));
  for (let k = 0; k < 3; k++) many.push(tuft({ id: 't' + (k + 1), home: [k, 2] }));
  const capped = C.cleanAnimals({ list: many }, null);
  assert.deepEqual(['puffhen', 'goat', 'tufflet'].map(k => capped.list.filter(a => a.kind === k).length), [4, 2, 2]);
  // lures: tufflet lures keep kind, hen lures have none, unknown dropped; next covers t ids
  const lu = C.cleanAnimals({ t: 10, next: 2, list: [tuft({ id: 't40', home: [9, 9] })], lures: [{ home: [1, 0], at: 60, kind: 'tufflet' }, { home: [2, 0], at: 20 }, { home: [3, 0], at: 20, kind: 'llama' }] }, null);
  assert.deepEqual(lu.lures, [{ home: [1, 0], at: 60, kind: 'tufflet' }, { home: [2, 0], at: 20 }]);
  assert.equal(lu.next, 41);
  // a full tufflet save round-trips through the module
  const ts = { v: 1, r: 1, t: 300, next: 3, list: [tuft({ home: [1, 0], wool: 1, prod: 40, content: 12, hearts: 3, bondAt: 200 })], lures: [{ home: [2, 0], at: 320, kind: 'tufflet' }] };
  const m = createAnimals({ T: null, role: 'host', running: false, world: { tiles: grid(3, 1), decor: [{ type: 'tuftnook', x: 1, z: 0 }, { type: 'tuftnook', x: 2, z: 0 }], pieces: [] }, emit() {}, action() {} });
  m.load(JSON.parse(JSON.stringify(ts)), 'save');
  const out = m.serialize();
  assert.equal(JSON.stringify(out), JSON.stringify(ts));
  assert.deepEqual(Object.keys(out.list[0]), TUFT_KEYS);
});

// 3
test('home pruning across three home types; buildGraph box 3; homeDist never crosses a nook', () => {
  const decor = [{ type: 'nestbox', x: 0, z: 0 }, { type: 'goatpen', x: 1, z: 0 }, { type: 'tuftnook', x: 2, z: 0 }];
  const st = C.cleanAnimals({ list: [tuft({ id: 't1', home: [0, 0] }), tuft({ id: 't2', home: [1, 0] }), tuft({ id: 't3', home: [2, 0] }), hen({ id: 'p4', home: [2, 0] }), goat({ id: 'g5', home: [2, 0] })] }, decor);
  assert.deepEqual(st.list.map(a => a.id), ['t3']);
  const st2 = C.cleanAnimals({ list: [hen({ home: [0, 0] }), goat({ home: [1, 0] })], lures: [{ home: [2, 0], at: 0 }, { home: [2, 0], at: 0, kind: 'goat' }, { home: [2, 0], at: 0, kind: 'tufflet' }] }, decor);
  assert.deepEqual(st2.list.map(a => a.kind), ['puffhen', 'goat']);
  assert.deepEqual(st2.lures, [{ home: [2, 0], at: 0, kind: 'tufflet' }]);
  const g = C.buildGraph([[0, 0], [1, 0], [2, 0], [3, 0]], [{ type: 'nestbox', x: 0, z: 0 }, { type: 'tuftnook', x: 2, z: 0 }, { type: 'blanket', x: 3, z: 1 }], [], null);
  assert.equal(g.n, 4);
  assert.equal(g.box[g.index.get('2,0')], 3);
  const d = C.homeDist(g, g.index.get('0,0'));
  assert.equal(d[g.index.get('1,0')], 1);
  assert.equal(d[g.index.get('2,0')], -1, 'a nook is never walked through');
  assert.equal(d[g.index.get('3,0')], -1);
  const g2 = C.buildGraph([[0, 0], [1, 0]], [{ type: 'tuftrug', x: 1, z: 0 }], [], null);
  assert.equal(g2.n, 1, 'a rug is decor, not a home');
});

// 4
test('tick: wool timing, fed and hearts, second tuft, cap holds, ready ids, hen rng unchanged, tufflet lures', () => {
  let st = stateWith([tuft()]);
  for (let i = 0; i < 359; i++) assert.deepEqual(C.tick(st, 1, fixed(.1)).ready, []);
  assert.deepEqual(C.tick(st, 1, fixed(.1)).ready, ['t1']);
  assert.equal(st.list[0].wool, 1); assert.equal(st.list[0].prod, 0);
  for (let i = 0; i < 359; i++) C.tick(st, 1, fixed(.1));
  assert.equal(st.list[0].wool, 1); C.tick(st, 1, fixed(.1)); assert.equal(st.list[0].wool, 2, 'second tuft');
  for (let i = 0; i < 500; i++) assert.deepEqual(C.tick(st, 1, fixed(.1)).ready, []);
  assert.equal(st.list[0].wool, 2); assert.equal(st.list[0].prod, 360, 'a full coat holds prod at the period');
  st = stateWith([tuft({ content: 360 })]);
  for (let i = 0; i < 149; i++) C.tick(st, 1, fixed(.1));
  assert.equal(st.list[0].wool, 0); C.tick(st, 1, fixed(.1)); assert.equal(st.list[0].wool, 1);
  st = stateWith([tuft({ content: 360, hearts: 10 })]);
  assert.ok(Math.abs(C.woolPeriod(st.list[0]) - 105) < 1e-9);
  for (let i = 0; i < 104; i++) C.tick(st, 1, fixed(.1));
  assert.equal(st.list[0].wool, 0); C.tick(st, 1, fixed(.1)); assert.equal(st.list[0].wool, 1);
  // hens lay with the same rng sequence; a tufflet never calls rng
  const run = list => { const s = stateWith(list); let calls = 0; const rng = () => { calls++; return .2; }; const laid = []; for (let i = 0; i < 1000; i++) laid.push(...C.tick(s, 1, rng).laid); return [calls, laid, s.list.find(a => a.kind === 'puffhen')]; };
  const [c1, l1, h1] = run([hen()]), [c2, l2, h2] = run([tuft({ home: [1, 0] }), hen()]);
  assert.equal(c1, c2); assert.deepEqual(l1, l2); assert.deepEqual(h1, h2);
  // a tufflet lure arrives with a t id and a tufflet name, never a hen
  st = C.cleanAnimals({ t: 10, next: 4, list: [], lures: [{ home: [1, 1], at: 30, kind: 'tufflet' }] }, null);
  st.t = 30; const res = C.tick(st, 1, fixed(.5));
  assert.deepEqual(res.arrived, ['t4']);
  const a = st.list[0];
  assert.deepEqual(Object.keys(a), TUFT_KEYS);
  assert.equal(a.kind, 'tufflet'); assert.equal(a.name, C.TUFT_NAMES[6]); assert.equal(a.seed, 2 ** 31); assert.equal(a.wool, 0); assert.equal(a.born, 30);
  // tufflet cap: a third never arrives
  st = stateWith([tuft({ id: 't1', home: [0, 0] }), tuft({ id: 't2', home: [1, 0] })]);
  st.lures.push({ home: [3, 0], at: 0, kind: 'tufflet' });
  assert.equal(C.tick(st, 1, fixed(.5)).arrived.length, 0); assert.equal(st.lures.length, 0);
});

// 5
test('lure, feed and pet a tufflet; hen and goat texts unchanged', () => {
  const st = stateWith([]);
  const bag = bagFrom([{ kind: 'berries', count: 2 }, { kind: 'seaweed', count: 4 }]);
  let r = C.lure(st, 0, 0, bag, 100, fixed(.5), 'tufflet');
  assert.equal(r.ok, true); assert.equal(r.food, 'berries'); assert.equal(r.text, 'You set out berries… listen for a soft trill'); assert.equal(r.kind, 'build');
  assert.equal(bag.count('berries'), 0);
  assert.deepEqual(st.lures, [{ home: [0, 0], at: 150, kind: 'tufflet' }]);
  r = C.lure(st, 0, 0, bag, 100, fixed(.5), 'tufflet'); assert.equal(r.reason, 'busy'); assert.equal(r.text, 'This tuft nook already has a guest');
  r = C.lure(st, 1, 0, bag, 100, fixed(0), 'tufflet'); assert.equal(r.food, 'seaweed'); assert.equal(bag.count('seaweed'), 0); assert.equal(st.lures[1].at, 140);
  bag.add('berries', 5);
  r = C.lure(st, 2, 0, bag, 100, fixed(0), 'tufflet'); assert.equal(r.reason, 'cap'); assert.equal(r.text, 'The raft has 2 Tufflets');
  const st2 = stateWith([]), b2 = bagFrom([{ kind: 'berries', count: 1 }, { kind: 'seaweed', count: 3 }]);
  const before = JSON.stringify([st2, b2.snapshot()]);
  r = C.lure(st2, 2, 0, b2, 100, fixed(0), 'tufflet'); assert.equal(r.reason, 'nofood'); assert.equal(r.text, 'Needs 2 Island Berries or 4 Seaweed');
  assert.equal(JSON.stringify([st2, b2.snapshot()]), before);
  // hens and goats keep their texts
  assert.equal(C.lure(stateWith([]), 0, 0, bagFrom([{ kind: 'seed', count: 1 }]), 0, fixed(0)).text, 'You scatter seeds… listen for a chirp');
  assert.equal(C.lure(stateWith([]), 0, 0, bagFrom([{ kind: 'seaweed', count: 3 }]), 0, fixed(0), 'goat').text, 'You set out some greens… listen for a bleat');
  assert.equal(C.lure(stateWith([]), 0, 0, bagFrom([]), 0, fixed(0), 'goat').text, 'Needs 3 Seaweed or 4 Leaves');
  // feed
  const fs = stateWith([tuft()]), fb = bagFrom([{ kind: 'seaweed', count: 2 }, { kind: 'berries', count: 2 }, { kind: 'leaf', count: 2 }]);
  r = C.feed(fs, 't1', 'seaweed', fb, 100);
  assert.equal(r.ok, true); assert.equal(r.text, 'Puffin nibbles it up · content'); assert.equal(fs.list[0].content, 180); assert.equal(fs.list[0].hearts, 1);
  r = C.feed(fs, 't1', 'berries', fb, 110); assert.equal(r.ok, true); assert.equal(fs.list[0].content, 360);
  r = C.feed(fs, 't1', 'leaf', fb, 300); assert.equal(r.reason, 'bad'); assert.equal(r.text, 'That is not Tufflet food');
  assert.equal(C.feed(fs, 't1', 'seaweed', fb, 300).reason, 'full');
  assert.equal(C.feed(stateWith([tuft()]), 't1', 'berries', bagFrom([]), 0).text, 'You need Seaweed or Island Berries');
  // pet: a heart, never a feather
  const ps = stateWith([tuft({ hearts: 6 })]);
  r = C.pet(ps, 't1', 0);
  assert.equal(r.heart, true); assert.equal(r.feather, false); assert.equal(r.text, 'Puffin ♥ 7');
  assert.equal('feather' in ps.list[0], false);
  assert.equal(C.gone('t3'), 'That Tufflet wandered off');
  assert.equal(C.gone('g3'), 'That Bramblegoat wandered off'); assert.equal(C.gone('p3'), 'That Puffhen wandered off'); assert.equal(C.gone(7), 'That Puffhen wandered off');
});

// 6
test('shear: notyet, noshears, bad on a goat, success keeps the shears, full bag, partial fit', () => {
  const st = stateWith([tuft({ prod: 30 }), goat({ id: 'g2', home: [1, 0], milk: 1 })]);
  let bag = bagFrom([{ kind: 'shears', count: 1 }]);
  let r = C.shear(st, 't1', bag);
  assert.equal(r.reason, 'notyet'); assert.equal(r.text, 'Puffin’s fluff is still growing · soon'.replace('’', "'"));
  st.list[0].wool = 2;
  r = C.shear(st, 't1', bagFrom([{ kind: 'leaf', count: 1 }]));
  assert.equal(r.reason, 'noshears'); assert.equal(r.text, 'Hold Shell Shears to shear');
  r = C.shear(st, 'g2', bag); assert.equal(r.reason, 'bad'); assert.equal(r.text, 'Only Tufflets can be sheared');
  assert.equal(C.shear(st, 't9', bag).reason, 'notarget');
  assert.equal(st.list[0].wool, 2); assert.equal(st.list[0].prod, 30);
  r = C.shear(st, 't1', bag);
  assert.equal(r.ok, true); assert.equal(r.kind, 'loot'); assert.equal(r.wool, 2); assert.equal(r.text, '+2 Tuft Wool · thank you, Puffin');
  assert.equal(bag.count('wool'), 2); assert.equal(bag.count('shears'), 1, 'shears never wear out');
  assert.equal(st.list[0].wool, 0); assert.equal(st.list[0].prod, 0);
  // full bag: nothing changes
  st.list[0].wool = 2; st.list[0].prod = 360;
  bag = bagFrom(full({ 0: { kind: 'shears', count: 1 } }));
  const before = JSON.stringify([st, bag.snapshot()]);
  r = C.shear(st, 't1', bag);
  assert.equal(r.reason, 'full'); assert.equal(r.text, 'Your bag is full');
  assert.equal(JSON.stringify([st, bag.snapshot()]), before);
  // partial fit: one tuft fits on a stack of 19
  bag = bagFrom(full({ 0: { kind: 'shears', count: 1 }, 1: { kind: 'wool', count: 19 } }));
  r = C.shear(st, 't1', bag);
  assert.equal(r.ok, true); assert.equal(r.wool, 1); assert.equal(st.list[0].wool, 1); assert.equal(bag.count('wool'), 20);
});

// 7
test('items, recipes, decor, craft book and unlocks', () => {
  const names = { tuftnook: 'Tuft Nook', shears: 'Shell Shears', wool: 'Tuft Wool', tuftrug: 'Tuft Rug', blanket: 'Cosy Blanket' };
  for (const [k, n] of Object.entries(names)) {
    assert.equal(ITEM_INFO[k].name, n); assert.equal(ITEM_INFO[k].icon, 'icon-' + k); assert.equal(ITEM_INFO[k].placeholder, false);
    assert.ok(CB.ITEM_TEXT[k]?.desc && CB.ITEM_TEXT[k]?.use, k);
  }
  assert.equal(ITEM_INFO.shears.maxStack, 1); assert.equal(ITEM_INFO.shears.tool, false); assert.equal(ITEM_INFO.wool.maxStack, 20);
  assert.deepEqual({ ...RECIPES.tuftnook.cost }, { wood: 3, leaf: 3, rope: 2 });
  assert.deepEqual({ ...RECIPES.shears.cost }, { scrap: 2, shell: 1, rope: 1 });
  assert.deepEqual({ ...RECIPES.woolrope.output }, { kind: 'rope', count: 2 }); assert.deepEqual({ ...RECIPES.woolrope.cost }, { wool: 1 });
  assert.deepEqual({ ...RECIPES.tuftrug.cost }, { wool: 3, rope: 1 });
  assert.deepEqual({ ...RECIPES.blanket.cost }, { wool: 4, leaf: 1 });
  const ids = Object.keys(RECIPES); assert.ok(ids.indexOf('rope') < ids.indexOf('woolrope'));
  for (const k of ['tuftnook', 'tuftrug', 'blanket']) assert.ok(CI.CONTENT_DECOR.includes(k), k);
  assert.equal(CI.CONTENT_BLOCK_RADIUS.tuftnook, .35); assert.equal(CI.CONTENT_BLOCK_RADIUS.blanket, .25); assert.equal('tuftrug' in CI.CONTENT_BLOCK_RADIUS, false);
  const recipes = Object.values(RECIPES).map(r => ({ id: r.id, name: r.name, out: { ...r.output }, reqs: Object.entries(r.cost).map(([kind, count]) => ({ kind, count })) }));
  assert.equal(CB.sourceOf('rope', recipes, k => ITEM_INFO[k]?.name ?? k).how, 'Craft it from 2 Palm Leaf.');
  assert.equal(CB.sourceOf('wool', recipes).tag, 'tufflet');
  assert.equal(CB.categoryOf('shears'), 'tools'); assert.equal(CB.categoryOf('tuftnook'), 'survival');
  const learned = SR.learnedFrom(['wood', 'leaf', 'rope', 'scrap', 'shell', 'wool']);
  for (const k of ['tuftnook', 'shears', 'woolrope', 'tuftrug', 'blanket']) { assert.ok(learned.includes(k), k); assert.ok(!SR.STARTER.includes(k), k); }
  assert.ok(!SR.learnedFrom(['wood', 'leaf', 'rope', 'scrap']).includes('shears'), 'shears need a shell');
  const bag = bagFrom([{ kind: 'wool', count: 1 }]);
  assert.equal(bag.craft('woolrope').ok, true); assert.equal(bag.count('rope'), 2); assert.equal(bag.count('wool'), 0);
});

// 8
function stub(o = {}) {
  const bag = bagFrom([{ kind: 'shears', count: 1 }, { kind: 'seaweed', count: 5 }, { kind: 'berries', count: 2 }, { kind: 'leaf', count: 1 }], 0);
  return { T, role: 'host', running: true, world: { tiles: [[1, 1]], decor: [{ type: 'tuftnook', x: 1, z: 1 }], pieces: [] }, physics: { x: 2, z: 2 }, other: { x: 2, z: 2 },
    emitted: [], sent: [], emit(e, to) { this.emitted.push([e, to]); }, localBag: () => bag, actorBag: () => bag, action(a) { this.sent.push(a); }, notice() {}, esc: s => String(s), rebuildRaft() {}, ...o, bag };
}
const save = (o = {}) => ({ v: 1, r: 2, t: 100, next: 2, list: [tuft({ home: [1, 1], wool: 2, ...o })], lures: [] });
test('module: guest shear no-op, reach, malformed, success, lure on a nook, undecor veto, decor models', () => {
  const g = stub({ role: 'guest' }), gm = createAnimals(g);
  gm.load(save(), 'net');
  const gBefore = JSON.stringify([gm.debug.state(), g.bag.snapshot()]);
  assert.equal(gm.action({ kind: 'animals.shear', id: 't1' }, 'guest', g.bag), true);
  assert.equal(JSON.stringify([gm.debug.state(), g.bag.snapshot()]), gBefore);

  const far = stub({ physics: { x: 40, z: 40 } }), fm = createAnimals(far);
  fm.load(save(), 'save');
  assert.equal(fm.action({ kind: 'animals.shear', id: 't1' }, 'host', far.bag), true);
  assert.equal(far.emitted.at(-1)[0].text, 'Step a little closer');
  assert.equal(fm.debug.state().list[0].wool, 2);

  const h = stub(), m = createAnimals(h);
  m.load(save(), 'save');
  const s1 = m.serialize();
  for (const a of [{ kind: 'animals.shear', id: 't12345678' }, { kind: 'animals.shear', id: 7 }, { kind: 'animals.shear' }]) assert.equal(m.action(a, 'host', h.bag), true);
  assert.equal(m.serialize(), s1, 'malformed shear actions are swallowed');
  const r0 = m.debug.state().r;
  assert.equal(m.action({ kind: 'animals.shear', id: 't1' }, 'host', h.bag), true);
  assert.equal(m.debug.state().r, r0 + 1);
  assert.equal(h.bag.count('wool'), 2); assert.equal(h.bag.count('shears'), 1); assert.equal(m.debug.state().list[0].wool, 0);
  assert.equal(h.emitted.at(-1)[0].text, '+2 Tuft Wool · thank you, Puffin'); assert.equal(h.emitted.at(-1)[0].kind, 'loot');
  m.action({ kind: 'animals.shear', id: 't1' }, 'host', h.bag);
  assert.equal(h.emitted.at(-1)[0].text, "Puffin's fluff is still growing · soon");
  // undecor: an occupied nook is vetoed, an empty one is not
  assert.equal(m.beforeUndecor({ type: 'tuftnook', x: 1, z: 1 }), 'Your tufflet lives here');
  assert.equal(m.beforeUndecor({ type: 'tuftnook', x: 3, z: 3 }), null);
  for (const k of ['tuftnook', 'tuftrug', 'blanket']) { const o = m.decorModel(k); assert.ok(o.isObject3D); assert.equal(o.name, 'decor_' + k); }
  // lure on a Tuft Nook sends a tufflet lure
  const lh = stub({ world: { tiles: grid(3, 3), decor: [{ type: 'tuftnook', x: 1, z: 1 }], pieces: [] } }), lm = createAnimals(lh);
  lm.load(undefined, 'save');
  lm.action({ kind: 'animals.lure', x: 1, z: 1 }, 'host', lh.bag);
  assert.equal(lm.debug.lures()[0].kind, 'tufflet');
  assert.equal(lm.serialize().lures[0].kind, 'tufflet');
  assert.equal(lh.bag.count('berries'), 0);
  assert.equal(lm.beforeUndecor({ type: 'tuftnook', x: 1, z: 1 }), 'Your tufflet lives here', 'a pending lure keeps the nook');
  assert.equal(lm.action({ kind: 'animals.collect', x: 1, z: 1 }, 'host', lh.bag), true);
  assert.equal(lh.emitted.at(-1)[0].text, 'That spot has no nest box');
  lm.debug.arrive(); lm.update(.016);
  const arrived = lm.debug.list()[0];
  assert.equal(arrived.kind, 'tufflet'); assert.match(arrived.id, /^t\d+$/);
  assert.ok(lh.emitted.some(([e, to]) => to === 'all' && e.text === 'A Tufflet paddled aboard! Say hi to ' + arrived.name));
});

const aimCam = () => { const camera = new T.PerspectiveCamera(60, 1, .1, 100); camera.position.set(2, .9, 3.6); camera.lookAt(2, .45, 2); camera.updateMatrixWorld(); return camera; };
test('prompts and interact: shear, feed, pet tails, nook rows; all fit 48 chars', () => {
  const scene = new T.Scene(), camera = aimCam();
  const s = stub({ scene, camera }), m = createAnimals(s);
  m.load(save({ name: 'Abcdefghijklmn', hearts: 10 }), 'save');
  m.update(.016);
  const labels = [];
  const P = () => { const p = m.prompt({}); labels.push(p.replace(/^<kbd>E<\/kbd>/, '')); return p; };
  assert.equal(P(), '<kbd>E</kbd>Shear Abcdefghijklmn · 2 tufts');
  m.interact({});
  assert.deepEqual(s.sent.at(-1), { kind: 'animals.shear', id: 't1' });
  s.bag.selectedIndex = 1;
  assert.equal(P(), '<kbd>E</kbd>Feed Abcdefghijklmn (Seaweed)');
  s.bag.selectedIndex = 2;
  assert.equal(P(), '<kbd>E</kbd>Feed Abcdefghijklmn (Island Berries)');
  s.bag.selectedIndex = 3; // a leaf: not tufflet food
  assert.equal(P(), '<kbd>E</kbd>Pet Abcdefghijklmn ♥ 10 · fluffy (hold shears)');
  m.interact({});
  assert.deepEqual(s.sent.at(-1), { kind: 'animals.pet', id: 't1' });
  m.dispose();
  // one tuft, shears held but nothing to shear, full and happy
  const s2 = stub({ scene: new T.Scene(), camera }), m2 = createAnimals(s2);
  m2.load(save({ wool: 1 }), 'save'); m2.update(.016);
  assert.equal(m2.prompt({}), '<kbd>E</kbd>Shear Puffin · 1 tuft');
  m2.load(save({ wool: 0, content: 320 }), 'save'); m2.update(.016);
  assert.equal(m2.prompt({}), '<kbd>E</kbd>Pet Puffin ♥ 0 · fluff growing');
  s2.bag.selectedIndex = 1;
  assert.equal(m2.prompt({}), 'Puffin is full and happy');
  m2.dispose();
  // the nook itself (aimed over an empty nook)
  const s3 = stub({ scene: new T.Scene(), camera }), m3 = createAnimals(s3);
  m3.load(undefined, 'save'); m3.update(.016);
  labels.push(m3.prompt({}).replace(/^<kbd>E<\/kbd>/, ''));
  assert.equal(m3.prompt({}), '<kbd>E</kbd>Set out berries to lure a Tufflet (2 berries)');
  s3.bag.slots[2] = null;
  assert.equal(m3.prompt({}), '<kbd>E</kbd>Set out seaweed to lure a Tufflet (4 seaweed)');
  s3.bag.slots[1] = null;
  assert.equal(m3.prompt({}), 'Tuft Nook · needs 2 Berries or 4 Seaweed');
  m3.interact({});
  assert.deepEqual(s3.sent.at(-1), { kind: 'animals.lure', x: 1, z: 1 });
  m3.load({ v: 1, r: 0, t: 0, next: 1, list: [], lures: [{ home: [1, 1], at: 50, kind: 'tufflet' }] }, 'save'); m3.update(.016);
  assert.equal(m3.prompt({}), 'Tuft Nook · a Tufflet is on its way…');
  s3.world.decor.push({ type: 'tuftnook', x: 5, z: 5 }, { type: 'tuftnook', x: 6, z: 6 });
  m3.load({ v: 1, r: 0, t: 0, next: 3, list: [tuft({ id: 't1', home: [5, 5] }), tuft({ id: 't2', home: [6, 6] })], lures: [] }, 'save'); m3.update(.016);
  assert.equal(m3.prompt({}), 'Tuft Nook · the raft has 2 Tufflets');
  m3.dispose();
  for (const l of labels) assert.ok(l.length <= 48, `${l.length}: ${l}`);
  // a resident nook (the tufflet wandered off it): shear, then rename
  const s4 = stub({ scene: new T.Scene(), camera, world: { tiles: grid(3, 3), decor: [{ type: 'tuftnook', x: 1, z: 1 }], pieces: [] } }), m4 = createAnimals(s4);
  m4.load(save({ born: -1000 }), 'save'); m4.update(.016);
  const h = m4.debug.pick({});
  assert.ok(h && (h.type === 'nook' || h.type === 'tuft'));
  if (h.type === 'nook') assert.equal(h.prompt, '<kbd>E</kbd>Shear Puffin · 2 tufts');
  m4.dispose();
});

test('render: tufflet meshes only with a tufflet; coat shrinks; hen eggs keep their instances with a tufflet first', () => {
  const scene = new T.Scene();
  const s = stub({ scene, world: { tiles: grid(3, 2), decor: [{ type: 'tuftnook', x: 0, z: 0 }, { type: 'nestbox', x: 1, z: 0 }], pieces: [] } });
  const m = createAnimals(s);
  m.load({ v: 1, r: 0, t: 1000, next: 9, list: [hen({ home: [1, 0], eggs: 2 })], lures: [] }, 'save');
  m.update(.016);
  const tufts = scene.getObjectByName('tufflets'), fluff = scene.getObjectByName('tuffletFluff'), birds = scene.getObjectByName('puffhens'), eggs = scene.getObjectByName('puffEggs');
  assert.equal(tufts.visible, false); assert.equal(fluff.visible, false); assert.equal(birds.visible, true);
  m.load({ v: 1, r: 0, t: 1000, next: 9, list: [tuft({ home: [0, 0], wool: 2 }), hen({ home: [1, 0], eggs: 2 })], lures: [] }, 'save');
  for (let i = 0; i < 3; i++) m.update(.016);
  assert.equal(tufts.visible, true); assert.equal(fluff.visible, true);
  const mat = (mesh, k) => { const mm = new T.Matrix4(); mesh.getMatrixAt(k, mm); return mm; };
  const on = (mesh, k) => mat(mesh, k).determinant() !== 0;
  assert.deepEqual([on(tufts, 0), on(fluff, 0), on(birds, 0), on(eggs, 0), on(eggs, 1), on(eggs, 2), on(eggs, 3)], [true, true, true, true, true, false, false]);
  const ratio = () => Math.cbrt(mat(fluff, 0).determinant() / mat(tufts, 0).determinant());
  assert.ok(Math.abs(ratio() - 1) < 1e-4, 'full coat');
  m.action({ kind: 'animals.shear', id: 't1' }, 'host', s.bag);
  m.update(.016);
  assert.ok(Math.abs(ratio() - .8) < 1e-4, `trimmed coat ${ratio()}`);
  m.dispose();
});

// 9
test('models: body + fluff merged, finite, coloured, top 0.4-0.5 m, <= 1.4k tris; decor budgets', () => {
  const body = TM.tuffletBodyGeometry(T), fluff = TM.tuffletFluffGeometry(T);
  let tris = 0;
  for (const g of [body, fluff]) {
    assert.ok(g.attributes.position.count > 0); assert.ok(g.attributes.color); assert.ok(g.attributes.normal);
    assert.ok(Array.from(g.attributes.position.array).every(Number.isFinite));
    tris += g.attributes.position.count / 3;
  }
  assert.ok(body.attributes.position.count / 3 <= 500); assert.ok(fluff.attributes.position.count / 3 <= 900);
  assert.ok(tris <= 1400, `${tris} triangles`);
  body.computeBoundingBox(); fluff.computeBoundingBox();
  const top = Math.max(body.boundingBox.max.y, fluff.boundingBox.max.y);
  assert.ok(top >= .4 && top <= .5, `top ${top}`); assert.ok(body.boundingBox.min.y > -.02);
  assert.ok(body.boundingBox.max.z > fluff.boundingBox.max.z + .08, 'the face pokes out of the coat');
  const budgets = { tuftNookModel: [2000, 1.2, .35], tuftRugModel: [600, 1.55, .06], blanketModel: [800, 1.2, .32] };
  for (const [fn, [maxTris, maxW, maxH]] of Object.entries(budgets)) {
    const o = TM[fn](T);
    assert.ok(o.isObject3D); assert.equal(o.children.length, 1);
    const g = o.children[0].geometry; g.computeBoundingBox();
    assert.ok(g.attributes.color);
    assert.ok(g.attributes.position.count / 3 <= maxTris, `${fn} ${g.attributes.position.count / 3} tris`);
    const b = g.boundingBox;
    assert.ok(b.max.x - b.min.x <= maxW && b.max.z - b.min.z <= maxW, fn);
    assert.ok(b.max.y <= maxH && b.min.y > -.01, `${fn} height ${b.max.y}`);
  }
});
