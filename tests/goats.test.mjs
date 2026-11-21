// Unit tests for the Bramblegoat (docs/specs/goats.md): species table, save cleaning, graph, milk, items, module.
// Run: node --test tests/goats.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const C = await import(new URL('animals-core.js', base));
const { createAnimals } = await import(new URL('animals.js', base));
const { Bag, SLOT_COUNT, RECIPES, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const SR = await import(new URL('storage-research.js', base));
const V = await import(new URL('vitals.js', base));
const CI = await import(new URL('content-items.js', base));
const T = await import(new URL('vendor/three.module.js', base));
const M = await import(new URL('animals-models.js', base));

const bagFrom = (slots, selected = 0) => { const s = new Array(SLOT_COUNT).fill(null); slots.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected }); };
const grid = (w, h) => { const t = []; for (let x = 0; x < w; x++) for (let z = 0; z < h; z++) t.push([x, z]); return t; };
const hen = (o = {}) => ({ id: 'p1', kind: 'puffhen', name: 'Pip', seed: 12345, home: [0, 0], born: 0, hearts: 0, content: 0, prod: 0, eggs: 0, feather: 0, bondAt: -1e9, featherAt: -1e9, ...o });
const goat = (o = {}) => ({ id: 'g1', kind: 'goat', name: 'Nutmeg', seed: 777, home: [0, 0], born: 0, hearts: 0, content: 0, prod: 0, milk: 0, bondAt: -1e9, ...o });
const stateWith = (list, extra = {}) => C.cleanAnimals({ v: 1, r: 0, t: 0, next: 9, list, lures: [], ...extra }, null);
const fixed = v => () => v;
const full = (except = {}) => Array.from({ length: SLOT_COUNT }, (_, i) => except[i] ?? { kind: 'scrap', count: 20 });

// 1
test('SPECIES: frozen table, prefixes, homes, caps, slot sizes', () => {
  assert.ok(Object.isFrozen(C.SPECIES) && Object.isFrozen(C.SPECIES.goat) && Object.isFrozen(C.SPECIES.goat.foods) && Object.isFrozen(C.SPECIES.goat.lure[0]));
  assert.equal(C.SPECIES.puffhen.prefix, 'p'); assert.equal(C.SPECIES.goat.prefix, 'g');
  assert.equal(C.SPECIES.puffhen.home, 'nestbox'); assert.equal(C.SPECIES.goat.home, 'goatpen');
  assert.equal(C.SPECIES.puffhen.cap, 4); assert.equal(C.SPECIES.goat.cap, 2);
  assert.equal(C.MAX_SLOTS, 6); assert.equal(C.MAX_ANIMALS, 4);
  assert.deepEqual({ ...C.HOME_CODE }, { nestbox: 1, goatpen: 2 });
  assert.equal(C.GOAT_NAMES.length, 12);
});

// 2
test('cleanAnimals: hen-only round trip, goat clamps, id/kind mismatch, unknown species, caps, lures, next', () => {
  const fixture = { v: 1, r: 7, t: 123.4, next: 3, list: [hen({ id: 'p1', home: [0, 0], born: 10.5, hearts: 2, content: 40, prod: 12, eggs: 1, feather: 0, bondAt: 60, featherAt: -1e9 }), hen({ id: 'p2', home: [2, 0], name: 'Bun' })], lures: [{ home: [4, 0], at: 140 }] };
  const st = C.cleanAnimals(JSON.parse(JSON.stringify(fixture)), null);
  assert.deepEqual(st, fixture);
  const m = createAnimals({ T: null, role: 'host', running: false, world: { tiles: grid(6, 1), decor: [{ type: 'nestbox', x: 0, z: 0 }, { type: 'nestbox', x: 2, z: 0 }, { type: 'nestbox', x: 4, z: 0 }], pieces: [] }, emit() {}, action() {} });
  m.load(JSON.parse(JSON.stringify(fixture)), 'save');
  assert.equal(JSON.stringify(m.serialize()), JSON.stringify(fixture), 'hen-only save is byte-identical');

  const g = C.cleanAnimals({ t: 50, list: [goat({ milk: 7, prod: 9999, content: -3, hearts: 3.7, born: 99, eggs: 3 })] }, null).list[0];
  assert.equal(g.milk, 1); assert.equal(g.prod, 300); assert.equal(g.content, 0); assert.equal(g.hearts, 3); assert.equal(g.born, 50);
  assert.equal('eggs' in g, false); assert.equal('feather' in g, false);
  assert.equal(C.cleanAnimals({ list: [goat({ milk: -2, prod: -1 })] }, null).list[0].milk, 0);
  assert.ok(C.GOAT_NAMES.includes(C.cleanAnimals({ list: [goat({ name: '' })] }, null).list[0].name));

  const mixed = C.cleanAnimals({ list: [hen({ id: 'g5', home: [1, 0] }), goat({ id: 'p5', home: [2, 0] }), { id: 'l1', kind: 'llama', home: [3, 0] }, { id: 'g9', home: [4, 0] }, goat({ id: 'g2', home: [5, 0] })] }, null);
  assert.deepEqual(mixed.list.map(a => a.id), ['g2']);

  const many = [];
  for (let k = 0; k < 5; k++) many.push(hen({ id: 'p' + (k + 1), home: [k, 0] }));
  for (let k = 0; k < 3; k++) many.push(goat({ id: 'g' + (k + 1), home: [k, 1] }));
  const capped = C.cleanAnimals({ list: many }, null);
  assert.equal(capped.list.filter(a => a.kind === 'puffhen').length, 4);
  assert.equal(capped.list.filter(a => a.kind === 'goat').length, 2);

  const lu = C.cleanAnimals({ t: 10, list: [], lures: [{ home: [0, 0], at: 15 }, { home: [1, 0], at: 1e9, kind: 'goat' }, { home: [2, 0], kind: 'goat' }, { home: [3, 0], kind: 'goat' }, { home: [4, 0], kind: 'yak' }] }, null);
  assert.deepEqual(lu.lures, [{ home: [0, 0], at: 15 }, { home: [1, 0], at: 60, kind: 'goat' }, { home: [2, 0], at: 40, kind: 'goat' }]);
  assert.equal('kind' in lu.lures[0], false);
  assert.equal(C.cleanAnimals({ list: [goat({ id: 'g41' })], next: 3 }, null).next, 42);
});

// 3
test('home pruning: per home type; a hen and a goat never share a home', () => {
  const decor = [{ type: 'nestbox', x: 0, z: 0 }, { type: 'goatpen', x: 1, z: 0 }, { type: 'goatpen', x: 2, z: 0 }, { type: 'nestbox', x: 3, z: 0 }];
  const st = C.cleanAnimals({ t: 5, list: [goat({ id: 'g1', home: [0, 0] }), hen({ id: 'p1', home: [1, 0] }), goat({ id: 'g2', home: [2, 0] }), hen({ id: 'p2', home: [3, 0] })],
    lures: [{ home: [1, 0] }, { home: [1, 0], kind: 'goat', at: 9 }, { home: [3, 0], kind: 'goat' }] }, decor);
  assert.deepEqual(st.list.map(a => a.id), ['g2', 'p2']);
  assert.deepEqual(st.lures, [{ home: [1, 0], at: 9, kind: 'goat' }]);
  const shared = C.cleanAnimals({ list: [hen({ id: 'p1', home: [0, 0] }), goat({ id: 'g1', home: [0, 0] })] }, null);
  assert.deepEqual(shared.list.map(a => a.id), ['p1']);
});

// 4
test('buildGraph/homeDist/pose: goatpen is a box-2 node, never crossed, lift in 0..1, goat steps continuous', () => {
  const tiles = []; for (let x = 0; x < 8; x++) tiles.push([x, 0]);
  const g = C.buildGraph(tiles, [{ type: 'goatpen', x: 0, z: 0 }, { type: 'nestbox', x: 3, z: 0 }, { type: 'crate', x: 6, z: 0 }], [], null);
  assert.equal(g.n, 7);
  assert.equal(g.box[g.index.get('0,0')], 2); assert.equal(g.box[g.index.get('3,0')], 1);
  assert.deepEqual([...C.homeDist(g, g.index.get('0,0'))], [0, 1, 2, -1, -1, -1, -1]);
  assert.deepEqual([...C.homeDist(g, g.index.get('3,0'))], [-1, 2, 1, 0, 1, 2, -1], 'the pen is never entered');
  const big = C.buildGraph(grid(5, 5), [{ type: 'goatpen', x: 2, z: 2 }], [], null), home = big.index.get('2,2'), d = C.homeDist(big, home);
  const p = { x: 0, z: 0, yaw: 0, hop: 0, moving: false, f: 0, lift: 0 }, q = { ...p };
  for (const seed of [3, 98765]) {
    let px = null, pz = null;
    for (let b = 0; b < 30; b++) {
      const o = C.plan(seed, b, big, d, home, C.newPlan());
      for (let u = 0; u <= C.GOAT_BEAT + 1e-9; u += .05) {
        C.pose(o, big, seed, b, Math.min(u, C.GOAT_BEAT), p, C.GOAT_HOP_T);
        for (const k of ['x', 'z', 'yaw', 'hop', 'lift']) assert.ok(Number.isFinite(p[k]), k);
        assert.ok(p.lift >= 0 && p.lift <= 1, 'lift 0..1 on a code-2 home');
        if (px !== null) assert.ok(Math.hypot(p.x - px, p.z - pz) < .2, `jump at beat ${b} u ${u}`);
        px = p.x; pz = p.z;
      }
      const next = C.plan(seed, b + 1, big, d, home, C.newPlan());
      C.pose(o, big, seed, b, C.GOAT_BEAT, p, C.GOAT_HOP_T); C.pose(next, big, seed, b + 1, 0, q, C.GOAT_HOP_T);
      assert.ok(Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.z - q.z) < 1e-9, 'beat boundary');
    }
  }
  const iso = C.buildGraph([[0, 0]], [{ type: 'goatpen', x: 0, z: 0 }], [], null);
  C.pose(C.plan(1, 0, iso, C.homeDist(iso, 0), 0, C.newPlan()), iso, 1, 0, 1, p);
  assert.equal(p.lift, 1);
});

// 5
test('edgeStart: shortest direction, tie order +x,-x,+z,-z, off-raft, deterministic', () => {
  const keys = t => new Set(t.map(([x, z]) => x + ',' + z));
  const g5 = keys(grid(5, 5));
  assert.deepEqual(C.edgeStart(g5, 2, 2), [5, 2], 'tie: +x first');
  assert.deepEqual(C.edgeStart(g5, 1, 2), [-1, 2], '-x is shorter');
  assert.deepEqual(C.edgeStart(g5, 2, 3), [2, 5], '+z is shortest');
  assert.deepEqual(C.edgeStart(g5, 2, 0), [2, -1]);
  assert.deepEqual(C.edgeStart(keys(grid(9, 3)), 4, 1), [4, 3]);
  for (const [x, z] of [[0, 0], [4, 4], [2, 1]]) { const e = C.edgeStart(g5, x, z); assert.equal(g5.has(e[0] + ',' + e[1]), false); assert.deepEqual(C.edgeStart(g5, x, z), e); }
});

// 6
test('tick: milk timing, cap and hold, ready ids, no eggs, goat lures and the goat cap', () => {
  let st = stateWith([goat()]);
  for (let i = 0; i < 299; i++) assert.deepEqual(C.tick(st, 1, fixed(.1)).ready, []);
  assert.deepEqual(C.tick(st, 1, fixed(.1)).ready, ['g1']);
  assert.equal(st.list[0].milk, 1); assert.equal(st.list[0].prod, 0);
  assert.equal('eggs' in st.list[0], false); assert.equal('feather' in st.list[0], false);
  for (let i = 0; i < 500; i++) assert.deepEqual(C.tick(st, 1, fixed(.1)).ready, []);
  assert.equal(st.list[0].milk, 1); assert.equal(st.list[0].prod, 300, 'held at the period');
  st = stateWith([goat({ content: 360 })]);
  for (let i = 0; i < 119; i++) C.tick(st, 1, fixed(.1));
  assert.equal(st.list[0].milk, 0); C.tick(st, 1, fixed(.1)); assert.equal(st.list[0].milk, 1);
  st = stateWith([goat({ hearts: 10 })]);
  assert.ok(Math.abs(C.milkPeriod(st.list[0]) - 210) < 1e-9);
  st = stateWith([goat({ hearts: 10, content: 360 })]);
  assert.ok(Math.abs(C.milkPeriod(st.list[0]) - 84) < 1e-9);
  for (let i = 0; i < 83; i++) C.tick(st, 1, fixed(.1));
  assert.equal(st.list[0].milk, 0); C.tick(st, 1, fixed(.1)); assert.equal(st.list[0].milk, 1);
  // a goat lure arrives with a g id and a goat name
  st = C.cleanAnimals({ t: 10, next: 4, list: [], lures: [{ home: [1, 1], at: 30, kind: 'goat' }] }, null);
  st.t = 30; const res = C.tick(st, 1, fixed(.5));
  assert.deepEqual(res.arrived, ['g4']);
  const a = st.list[0];
  assert.equal(a.kind, 'goat'); assert.equal(a.name, C.GOAT_NAMES[6]); assert.equal(a.seed, 2 ** 31); assert.equal(a.milk, 0); assert.equal(a.born, 30);
  // goat cap: a third goat never arrives, hens still do
  st = stateWith([goat({ id: 'g1', home: [0, 0] }), goat({ id: 'g2', home: [1, 0] }), hen({ id: 'p3', home: [2, 0] })]);
  st.lures.push({ home: [3, 0], at: 0, kind: 'goat' }, { home: [4, 0], at: 0 });
  const r2 = C.tick(st, 1, fixed(.5));
  assert.equal(r2.arrived.length, 1); assert.equal(st.list.filter(x => x.kind === 'goat').length, 2); assert.equal(st.list.filter(x => x.kind === 'puffhen').length, 2);
  assert.equal(st.lures.length, 0);
});

// 7
test('lure goat: seaweed first, then leaves, nofood, busy, cap; hen lure unchanged', () => {
  const st = stateWith([]);
  let bag = bagFrom([{ kind: 'seaweed', count: 3 }, { kind: 'leaf', count: 6 }]);
  let r = C.lure(st, 0, 0, bag, 100, fixed(.5), 'goat');
  assert.equal(r.ok, true); assert.equal(r.food, 'seaweed'); assert.equal(r.text, 'You set out some greens… listen for a bleat'); assert.equal(r.kind, 'build');
  assert.equal(bag.count('seaweed'), 0);
  assert.deepEqual(st.lures, [{ home: [0, 0], at: 140, kind: 'goat' }]);
  assert.equal(C.lure(st, 0, 0, bag, 100, fixed(.5), 'goat').reason, 'busy');
  r = C.lure(st, 1, 0, bag, 100, fixed(0), 'goat'); assert.equal(r.food, 'leaf'); assert.equal(bag.count('leaf'), 2); assert.equal(st.lures[1].at, 130);
  const snap = JSON.stringify([st, bag.snapshot()]);
  r = C.lure(st, 2, 0, bag, 100, fixed(0), 'goat');
  assert.equal(r.reason, 'cap'); assert.equal(r.text, 'The raft has 2 Bramblegoats');
  const st2 = stateWith([]);
  r = C.lure(st2, 2, 0, bagFrom([{ kind: 'leaf', count: 2 }]), 100, fixed(0), 'goat');
  assert.equal(r.reason, 'nofood'); assert.equal(r.text, 'Needs 3 Seaweed or 4 Leaves');
  assert.equal(JSON.stringify([st, bag.snapshot()]), snap);
  // hens are unaffected by goat lures and keep their own cap and texts
  bag = bagFrom([{ kind: 'seed', count: 5 }]);
  r = C.lure(st, 3, 0, bag, 100, fixed(.5));
  assert.equal(r.ok, true); assert.deepEqual(st.lures.at(-1), { home: [3, 0], at: 130 }); assert.equal(r.text, 'You scatter seeds… listen for a chirp');
});

// 8
test('feed and pet goat', () => {
  const st = stateWith([goat()]);
  const bag = bagFrom([{ kind: 'leaf', count: 3 }, { kind: 'seaweed', count: 3 }, { kind: 'seed', count: 3 }]);
  let r = C.feed(st, 'g1', 'leaf', bag, 100);
  assert.equal(r.ok, true); assert.equal(r.text, 'Nutmeg munches happily · content'); assert.equal(st.list[0].content, 180); assert.equal(st.list[0].hearts, 1);
  r = C.feed(st, 'g1', 'seaweed', bag, 110); assert.equal(r.ok, true); assert.equal(st.list[0].content, 360); assert.equal(st.list[0].hearts, 1, 'heart cooldown');
  const before = JSON.stringify([st, bag.snapshot()]);
  r = C.feed(st, 'g1', 'seed', bag, 300); assert.equal(r.reason, 'bad'); assert.equal(r.text, 'That is not Bramblegoat food');
  assert.equal(C.feed(st, 'g1', 'leaf', bag, 300).reason, 'full');
  assert.equal(C.feed(st, 'g9', 'leaf', bag, 300).text, 'That Bramblegoat wandered off');
  assert.equal(JSON.stringify([st, bag.snapshot()]), before);
  const st2 = stateWith([goat({ hearts: 4 })]);
  r = C.pet(st2, 'g1', 0);
  assert.equal(r.heart, true); assert.equal(r.feather, false); assert.equal(st2.list[0].hearts, 5); assert.equal(r.text, 'Nutmeg ♥ 5');
  assert.equal('feather' in st2.list[0], false);
  assert.equal(C.pet(st2, 'g1', 30).heart, false);
});

// 9
test('milk: notyet, nopail, same-slot swap, full bag, bad on a hen, reset', () => {
  let st = stateWith([goat(), hen({ id: 'p1', home: [1, 0] })]);
  let bag = bagFrom([{ kind: 'bucket', count: 1 }]);
  let r = C.milk(st, 'g1', bag);
  assert.equal(r.reason, 'notyet'); assert.equal(r.text, 'Nutmeg has no milk yet · soon');
  st.list[0].milk = 1; st.list[0].prod = 12;
  r = C.milk(st, 'g1', bagFrom([{ kind: 'leaf', count: 1 }]));
  assert.equal(r.reason, 'nopail'); assert.equal(r.text, 'Hold a Wooden Pail to milk');
  assert.equal(C.milk(st, 'p1', bag).reason, 'bad');
  assert.equal(C.milk(st, 'nope', bag).reason, 'notarget');
  assert.equal(st.list[0].milk, 1);
  // a single selected pail becomes milk in the same slot, even in a full bag
  bag = bagFrom(full({ 4: { kind: 'bucket', count: 1 } }), 4);
  r = C.milk(st, 'g1', bag);
  assert.equal(r.ok, true); assert.equal(r.kind, 'loot'); assert.equal(r.text, '+1 Pail of Milk · thank you, Nutmeg');
  assert.deepEqual(bag.slots[4], { kind: 'milk', count: 1 });
  assert.equal(st.list[0].milk, 0); assert.equal(st.list[0].prod, 0);
  // a stack of 2 pails in a full bag: no room for the milk, nothing changes
  st.list[0].milk = 1;
  bag = bagFrom(full({ 0: { kind: 'bucket', count: 2 } }), 0);
  const before = JSON.stringify([st, bag.snapshot()]);
  r = C.milk(st, 'g1', bag);
  assert.equal(r.reason, 'full'); assert.equal(r.text, 'Your bag is full');
  assert.equal(JSON.stringify([st, bag.snapshot()]), before);
  // pail not selected: scratch swap
  bag = bagFrom([{ kind: 'leaf', count: 1 }, { kind: 'bucket', count: 2 }], 0);
  assert.equal(C.milk(st, 'g1', bag).ok, true);
  assert.equal(bag.count('bucket'), 1); assert.equal(bag.count('milk'), 1);
});

// 10
test('items, recipes, vitals, decor and unlocks', () => {
  assert.equal(ITEM_INFO.bucket.maxStack, 5); assert.equal(ITEM_INFO.milk.maxStack, 5); assert.equal(ITEM_INFO.goatpen.maxStack, 20);
  assert.equal(ITEM_INFO.bucket.name, 'Wooden Pail'); assert.equal(ITEM_INFO.milk.name, 'Pail of Milk'); assert.equal(ITEM_INFO.goatpen.name, 'Hay Corner');
  assert.deepEqual({ ...RECIPES.bucket.cost }, { wood: 3, rope: 1 });
  assert.deepEqual({ ...RECIPES.goatpen.cost }, { wood: 4, leaf: 3, rope: 1 });
  assert.equal(V.FOOD.milk.returns, 'bucket');
  assert.match(V.eatLabel('milk'), /^Drink/);
  assert.equal(V.eatLabel('cookedfish').startsWith('Eat'), true);
  assert.ok(CI.CONTENT_DECOR.includes('goatpen')); assert.ok(CI.CONTENT_BLOCK_RADIUS.goatpen > 0);
  const learned = SR.learnedFrom(['wood', 'rope', 'leaf']);
  assert.ok(learned.includes('bucket')); assert.ok(learned.includes('goatpen'));
  assert.ok(!SR.STARTER.includes('bucket') && !SR.STARTER.includes('goatpen'));
  const v = { hp: 100, food: 50, water: 50 };
  assert.equal(V.consume(v, 'milk').returns, 'bucket'); assert.equal(v.food, 60); assert.equal(v.water, 75);
  const bag = bagFrom([{ kind: 'wood', count: 3 }, { kind: 'rope', count: 1 }]);
  assert.equal(bag.craft('bucket').ok, true); assert.equal(bag.count('bucket'), 1);
});

// 11
function stub(o = {}) {
  const bag = bagFrom([{ kind: 'bucket', count: 1 }, { kind: 'leaf', count: 5 }, { kind: 'milk', count: 1 }], 0);
  return { T, role: 'host', running: true, world: { tiles: [[1, 1]], decor: [{ type: 'goatpen', x: 1, z: 1 }], pieces: [] }, physics: { x: 2, z: 2 }, other: { x: 2, z: 2 },
    emitted: [], sent: [], emit(e, to) { this.emitted.push([e, to]); }, localBag: () => bag, actorBag: () => bag, action(a) { this.sent.push(a); }, notice() {}, esc: s => String(s), rebuildRaft() {}, ...o, bag };
}
const save = (o = {}) => ({ v: 1, r: 2, t: 100, next: 2, list: [goat({ home: [1, 1], milk: 1, ...o })], lures: [] });
test('module: guest milk is a no-op, host reach, success, malformed, decor model, prompts', () => {
  const g = stub({ role: 'guest' }), gm = createAnimals(g);
  gm.load(save(), 'net');
  const gBefore = JSON.stringify([gm.debug.state(), g.bag.snapshot()]);
  assert.equal(gm.action({ kind: 'animals.milk', id: 'g1' }, 'guest', g.bag), true);
  assert.equal(JSON.stringify([gm.debug.state(), g.bag.snapshot()]), gBefore);

  const far = stub({ physics: { x: 40, z: 40 } }), fm = createAnimals(far);
  fm.load(save(), 'save');
  assert.equal(fm.action({ kind: 'animals.milk', id: 'g1' }, 'host', far.bag), true);
  assert.equal(far.emitted.at(-1)[0].text, 'Step a little closer');
  assert.equal(fm.debug.state().list[0].milk, 1);

  const h = stub(), m = createAnimals(h);
  m.load(save(), 'save');
  const s1 = m.serialize();
  assert.deepEqual(Object.keys(s1.list[0]), ['id', 'kind', 'name', 'seed', 'home', 'born', 'hearts', 'content', 'prod', 'milk', 'bondAt']);
  for (const a of [{ kind: 'animals.milk', id: 'g12345678' }, { kind: 'animals.milk', id: 7 }, { kind: 'animals.milk' }]) assert.equal(m.action(a, 'host', h.bag), true);
  assert.equal(m.serialize(), s1, 'malformed milk actions are swallowed');
  const r0 = m.debug.state().r;
  assert.equal(m.action({ kind: 'animals.milk', id: 'g1' }, 'host', h.bag), true);
  assert.equal(m.debug.state().r, r0 + 1);
  assert.equal(h.bag.slots[0].kind, 'milk'); assert.equal(m.debug.state().list[0].milk, 0);
  assert.equal(h.emitted.at(-1)[0].text, '+1 Pail of Milk · thank you, Nutmeg');
  m.action({ kind: 'animals.milk', id: 'g1' }, 'host', h.bag);
  assert.equal(h.emitted.at(-1)[0].text, 'Nutmeg has no milk yet · soon');
  // lure on a Hay Corner sends a goat lure; feed checks goat foods
  const lh = stub({ world: { tiles: grid(3, 3), decor: [{ type: 'goatpen', x: 1, z: 1 }], pieces: [] } }), lm = createAnimals(lh);
  lm.load(undefined, 'save');
  lh.bag.add('seaweed', 3);
  lm.action({ kind: 'animals.lure', x: 1, z: 1 }, 'host', lh.bag);
  assert.equal(lm.debug.lures()[0].kind, 'goat');
  assert.equal(lm.serialize().lures[0].kind, 'goat');
  assert.equal(lm.action({ kind: 'animals.collect', x: 1, z: 1 }, 'host', lh.bag), true);
  assert.equal(lh.emitted.at(-1)[0].text, 'That spot has no nest box');
  assert.ok(m.decorModel('goatpen').isObject3D);

  // prompts: aim a camera at the goat standing in its corner
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(60, 1, .1, 100);
  camera.position.set(2, .9, 3.6); camera.lookAt(2, .5, 2); camera.updateMatrixWorld();
  const ph = stub({ scene, camera }), pm = createAnimals(ph);
  pm.load(save(), 'save');
  pm.update(.016);
  assert.equal(pm.prompt({}), '<kbd>E</kbd>Milk Nutmeg');
  ph.bag.selectedIndex = 2; // holding milk is never a second milking
  assert.match(pm.prompt({}), /^<kbd>E<\/kbd>Pet Nutmeg ♥ 0 · has milk/);
  ph.bag.selectedIndex = 1;
  assert.equal(pm.prompt({}), '<kbd>E</kbd>Feed Nutmeg (Palm Leaf)');
  ph.bag.selectedIndex = 0;
  pm.interact({});
  assert.deepEqual(ph.sent.at(-1), { kind: 'animals.milk', id: 'g1' });
  assert.equal(scene.getObjectByName('bramblegoats').visible, true);
  assert.equal(scene.getObjectByName('puffhens').visible, false);
  pm.dispose();
});

// 12
test('models: goat body + head merged, finite, ~0.55 m, <= 1500 triangles; Hay Corner builds', () => {
  const body = M.goatBodyGeometry(T), head = M.goatHeadGeometry(T);
  let tris = 0;
  for (const g of [body, head]) {
    assert.ok(g.attributes.position.count > 0); assert.ok(g.attributes.color);
    assert.ok(Array.from(g.attributes.position.array).every(Number.isFinite));
    tris += g.attributes.position.count / 3;
  }
  assert.ok(tris <= 1500, `${tris} triangles`);
  head.translate(...M.GOAT_NECK);
  body.computeBoundingBox(); head.computeBoundingBox();
  const top = Math.max(body.boundingBox.max.y, head.boundingBox.max.y);
  assert.ok(top > .5 && top < .6, `top ${top}`); assert.ok(body.boundingBox.min.y > -.02);
  const pen = M.goatPenModel(T);
  assert.ok(pen.isObject3D); assert.equal(pen.name, 'decor_goatpen');
  const pg = pen.children[0].geometry; pg.computeBoundingBox();
  assert.ok(pg.attributes.position.count / 3 <= 3000);
  assert.ok(pg.boundingBox.max.x - pg.boundingBox.min.x <= 1.7 && pg.boundingBox.max.z - pg.boundingBox.min.z <= 1.7);
});

// Review regressions
test('picking: an empty Hay Corner in front of another goat keeps the aim (lure prompt)', () => {
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(60, 1, .1, 100);
  camera.position.set(1, .55, 0); camera.lookAt(10, .55, 0); camera.updateMatrixWorld();
  const s = stub({ scene, camera, physics: { x: 1, z: 0 }, world: { tiles: [[1, 0], [2, 0]], decor: [{ type: 'goatpen', x: 1, z: 0 }, { type: 'goatpen', x: 2, z: 0 }], pieces: [] } });
  s.bag.slots[0] = { kind: 'seaweed', count: 5 };
  const m = createAnimals(s);
  m.load({ v: 1, r: 0, t: 1000, next: 2, list: [goat({ home: [2, 0] })], lures: [] }, 'save');
  m.update(.016);
  assert.equal(m.prompt({}), '<kbd>E</kbd>Set out greens to lure a Bramblegoat (3 seaweed)');
  m.interact({});
  assert.deepEqual(s.sent.at(-1), { kind: 'animals.lure', x: 1, z: 0 });
  m.dispose();
});

