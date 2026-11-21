// Unit tests for dist/animals-core.js and dist/animals.js (raft animals v1, the Puffhen).
// Run: node --test tests/animals.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const C = await import(new URL('animals-core.js', base));
const { createAnimals } = await import(new URL('animals.js', base));
const { Bag, SLOT_COUNT, RECIPES, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const SR = await import(new URL('storage-research.js', base));
const T = await import(new URL('vendor/three.module.js', base));
const M = await import(new URL('animals-models.js', base));

const bagFrom = (slots, selected = 0) => { const s = new Array(SLOT_COUNT).fill(null); slots.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected }); };
const grid = (w, h) => { const t = []; for (let x = 0; x < w; x++) for (let z = 0; z < h; z++) t.push([x, z]); return t; };
const hen = (o = {}) => ({ id: 'p1', kind: 'puffhen', name: 'Pip', seed: 12345, home: [0, 0], born: 0, hearts: 0, content: 0, prod: 0, eggs: 0, feather: 0, bondAt: -1e9, featherAt: -1e9, ...o });
const stateWith = (list = [hen()], extra = {}) => C.cleanAnimals({ v: 1, r: 0, t: 0, next: 9, list, lures: [], ...extra }, null);
const fixed = v => () => v;

// 1
test('cleanName: control, bidi, whitespace, 14 code points, non-string, empty', () => {
  assert.equal(C.cleanName('Pip\u0000\u0007'), 'Pip');
  assert.equal(C.cleanName('‮evil‬'), 'evil');
  assert.equal(C.cleanName('  Big \t\n  Bun  '), 'Big Bun');
  const emoji = '🐣'.repeat(20);
  assert.equal(Array.from(C.cleanName(emoji)).length, 14);
  assert.equal(C.cleanName('abcdefghijklmnopq'), 'abcdefghijklmn');
  assert.equal(C.cleanName(42), '');
  assert.equal(C.cleanName(null), '');
  assert.equal(C.cleanName('   '), '');
  assert.equal(C.cleanName('​‍'), '');
  assert.equal(C.cleanName('<b>x'), '<b>x'); // kept literally; rendering escapes it
  assert.equal(C.cleanName('é'), 'é');
});

// 2
test('cleanAnimals: defaults, junk, clamps, dedupe, cap, pruning, next', () => {
  for (const v of [undefined, null, 5, 'x', []]) assert.deepEqual(C.cleanAnimals(v, null), { v: 1, r: 0, t: 0, next: 1, list: [], lures: [] });
  const st = C.cleanAnimals({
    r: 3, t: 100, next: 2,
    list: [
      null, 7, { kind: 'gull', id: 'p3', home: [1, 1] }, { kind: 'puffhen', id: 'x1', home: [1, 1] }, { kind: 'puffhen', id: 'p2', home: [1.5, 1] },
      hen({ id: 'p7', home: [2, 0], seed: -4, name: '\u0000', born: 500, hearts: 99.7, content: 9999, prod: -5, eggs: 8, feather: 2.6, bondAt: 1e12, featherAt: 'x' }),
      hen({ id: 'p7', home: [3, 0] }), // dup id
      hen({ id: 'p8', home: [2, 0] }), // dup home
      hen({ id: 'p9', home: [4, 0] }), hen({ id: 'p10', home: [5, 0] }),
    ],
    lures: [{ home: [4, 0], at: 1 }, { home: [6, 0], at: 1e9 }, { home: [7, 0], at: 0 }, { home: [8, 0] }],
  }, null);
  assert.equal(st.r, 3); assert.equal(st.t, 100);
  assert.deepEqual(st.list.map(a => a.id), ['p7', 'p9', 'p10']);
  const a = st.list[0];
  assert.ok(Number.isInteger(a.seed) && a.seed >= 0);
  assert.ok(C.NAMES.includes(a.name));
  assert.equal(a.born, 100); assert.equal(a.hearts, 10); assert.equal(a.content, 360); assert.equal(a.prod, 0);
  assert.equal(a.eggs, 3); assert.equal(a.feather, 2); assert.equal(a.bondAt, 100); assert.equal(a.featherAt, -1e9);
  assert.equal(st.lures.length, 1, 'lure on a resident home dropped, then capped at 4 total');
  assert.deepEqual(st.lures[0], { home: [6, 0], at: 140 });
  assert.equal(st.next, 11);
  // pruning against decor
  const pr = C.cleanAnimals({ t: 5, list: [hen({ id: 'p1', home: [0, 0] }), hen({ id: 'p2', home: [1, 0] })], lures: [{ home: [2, 0], at: 3 }, { home: [3, 0], at: 9 }] },
    [{ type: 'nestbox', x: 0, z: 0 }, { type: 'crate', x: 1, z: 0 }, { type: 'nestbox', x: 3, z: 0 }]);
  assert.deepEqual(pr.list.map(a => a.id), ['p1']);
  assert.deepEqual(pr.lures, [{ home: [3, 0], at: 9 }]);
  assert.equal(C.cleanAnimals({ list: [hen({ id: 'p41' })], next: 3 }, null).next, 42);
});

// 3
test('buildGraph: decor, walls, doors, axis mapping, levels, grill and stairs', () => {
  const tiles = grid(3, 3);
  let g = C.buildGraph(tiles, [{ type: 'crate', x: 1, z: 1 }, { type: 'nestbox', x: 0, z: 0 }], [], null);
  assert.equal(g.n, 8);
  assert.equal(g.index.has('1,1'), false);
  const b = g.index.get('0,0'); assert.equal(g.box[b], 1);
  const nb = (g, a, d) => g.nb[g.index.get(a) * 4 + d];
  assert.equal(nb(g, '0,0', 0), g.index.get('1,0')); // +x
  assert.equal(nb(g, '0,0', 2), g.index.get('0,1')); // +z
  assert.equal(nb(g, '0,0', 1), -1); assert.equal(nb(g, '0,0', 3), -1);
  // r:0 edge at (i,j) separates (i,j) and (i,j-1); r:1 separates (i,j) and (i-1,j)
  g = C.buildGraph(tiles, [], [{ t: 'wall', i: 0, j: 1, l: 0, r: 0 }, { t: 'halfwall', i: 2, j: 0, l: 0, r: 1 }], null);
  assert.equal(nb(g, '0,0', 2), -1); assert.equal(nb(g, '0,1', 3), -1);
  assert.equal(nb(g, '1,0', 0), -1); assert.equal(nb(g, '2,0', 1), -1);
  assert.equal(nb(g, '0,0', 0), g.index.get('1,0'));
  g = C.buildGraph(tiles, [], [{ t: 'window', i: 1, j: 1, l: 0, r: 0 }, { t: 'door', i: 1, j: 2, l: 0, r: 0 }, { t: 'wall', i: 2, j: 2, l: 1, r: 0 }], null);
  assert.equal(nb(g, '1,1', 3), -1, 'window blocks');
  assert.equal(nb(g, '1,2', 3), g.index.get('1,1'), 'door passes');
  assert.equal(nb(g, '2,2', 3), g.index.get('2,1'), 'level 1 ignored');
  g = C.buildGraph(tiles, [], [{ t: 'stairs', i: 2, j: 2, l: 0, r: 0 }, { t: 'stairs', i: 0, j: 2, l: 1, r: 0 }], (x, z) => x === 1 && z === 0);
  assert.equal(g.index.has('2,2'), false); assert.equal(g.index.has('1,0'), false); assert.equal(g.index.has('0,2'), true);
  // sorted, duplicates removed
  g = C.buildGraph([[1, 0], [0, 1], [0, 0], [0, 0]], [], [], null);
  assert.deepEqual([...g.x], [0, 0, 1]); assert.deepEqual([...g.z], [0, 1, 0]);
});

// 4
test('homeDist: depth <= RANGE, never through another box', () => {
  const tiles = []; for (let x = 0; x < 8; x++) tiles.push([x, 0]);
  let g = C.buildGraph(tiles, [{ type: 'nestbox', x: 0, z: 0 }], [], null);
  let d = C.homeDist(g, g.index.get('0,0'));
  assert.deepEqual([...d], [0, 1, 2, 3, -1, -1, -1, -1]);
  g = C.buildGraph(tiles, [{ type: 'nestbox', x: 0, z: 0 }, { type: 'nestbox', x: 2, z: 0 }], [], null);
  d = C.homeDist(g, g.index.get('0,0'));
  assert.deepEqual([...d], [0, 1, -1, -1, -1, -1, -1, -1]);
  assert.deepEqual([...C.homeDist(g, -1)], new Array(8).fill(-1));
});

function setup(w = 5, h = 5, decor = [{ type: 'nestbox', x: 2, z: 2 }]) {
  const g = C.buildGraph(grid(w, h), decor, [], null), home = g.index.get('2,2');
  return { g, home, d: C.homeDist(g, home) };
}
const nbOf = (g, c) => [0, 1, 2, 3].map(k => g.nb[c * 4 + k]);

// 5
test('plan: deterministic, neighbours only, home beats, b%8 starts at home, isolated -> idle', () => {
  const { g, home, d } = setup();
  for (const seed of [1, 99, 0xdeadbeef >>> 0, 424242]) {
    for (let b = 0; b < 64; b++) {
      const o1 = C.plan(seed, b, g, d, home, C.newPlan()), o2 = C.plan(seed, b, g, d, home, C.newPlan());
      assert.deepEqual({ ...o1, cells: [...o1.cells] }, { ...o2, cells: [...o2.cells] });
      for (let h = 0; h < o1.n; h++) {
        assert.ok(nbOf(g, o1.cells[h]).includes(o1.cells[h + 1]), 'hop to a neighbour');
        assert.notEqual(d[o1.cells[h + 1]], -1);
      }
      if (b % 8 === 0) assert.equal(o1.cells[0], home);
      if (b % 8 === 7) assert.equal(o1.cells[o1.n], home, 'home beat ends at home');
      if (o1.kind === 'hop') assert.ok(o1.n >= 1 && o1.n <= 3);
    }
  }
  const iso = C.buildGraph([[0, 0]], [{ type: 'nestbox', x: 0, z: 0 }], [], null), id = C.homeDist(iso, 0);
  for (let b = 0; b < 16; b++) { const o = C.plan(7, b, iso, id, 0, C.newPlan()); assert.equal(o.kind, 'idle'); assert.equal(o.n, 0); }
  const o = C.plan(7, 3, g, d, -1, C.newPlan()); assert.equal(o.kind, 'idle');
});

// 6
test('pose: continuous inside and across beats, no NaN', () => {
  const { g, home, d } = setup();
  const p = { x: 0, z: 0, yaw: 0, hop: 0, moving: false, f: 0, lift: 0 }, q = { ...p };
  for (const seed of [5, 1234567]) {
    let px = null, pz = null;
    for (let b = 0; b < 40; b++) {
      const o = C.plan(seed, b, g, d, home, C.newPlan());
      for (let u = 0; u <= C.BEAT + 1e-9; u += .05) {
        C.pose(o, g, seed, b, Math.min(u, C.BEAT), p);
        for (const k of ['x', 'z', 'yaw', 'hop', 'lift']) assert.ok(Number.isFinite(p[k]), k);
        if (px !== null) assert.ok(Math.hypot(p.x - px, p.z - pz) < .2, `jump at beat ${b} u ${u}`);
        px = p.x; pz = p.z;
      }
      const next = C.plan(seed, b + 1, g, d, home, C.newPlan());
      C.pose(o, g, seed, b, C.BEAT, p); C.pose(next, g, seed, b + 1, 0, q);
      assert.ok(Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.z - q.z) < 1e-9, 'beat boundary');
    }
  }
});

// 7
test('tick: egg timing, content, hearts, cap, feathers, lures and cap', () => {
  let st = stateWith();
  for (let i = 0; i < 239; i++) C.tick(st, 1, fixed(.9));
  assert.equal(st.list[0].eggs, 0);
  assert.deepEqual(C.tick(st, 1, fixed(.9)).laid, ['p1']);
  assert.equal(st.list[0].eggs, 1); assert.equal(st.list[0].feather, 0);
  st = stateWith([hen({ content: 360 })]);
  for (let i = 0; i < 80; i++) C.tick(st, 1, fixed(.1));
  assert.equal(st.list[0].eggs, 1); assert.equal(st.list[0].feather, 1);
  assert.equal(st.list[0].content, 280);
  st = stateWith([hen({ hearts: 10 })]);
  assert.equal(C.eggPeriod(st.list[0]), 240 * .7);
  for (let i = 0; i < 167; i++) C.tick(st, 1, fixed(.9));
  assert.equal(st.list[0].eggs, 0); C.tick(st, 1, fixed(.9)); assert.equal(st.list[0].eggs, 1);
  // cap holds prod at the period; emptying lays again at once
  st = stateWith([hen({ eggs: 3 })]);
  for (let i = 0; i < 500; i++) C.tick(st, 1, fixed(.9));
  assert.equal(st.list[0].eggs, 3); assert.equal(st.list[0].prod, 240);
  st.list[0].eggs = 0; C.tick(st, .1, fixed(.9)); assert.equal(st.list[0].eggs, 1);
  // seeded rng: exact feather count
  const run = seed => { const s = stateWith(), r = C.mulberry32(seed); for (let i = 0; i < 240 * 30; i++) { C.tick(s, 1, r); if (s.list[0].eggs >= 3) s.list[0].eggs = 0; if (s.list[0].feather >= 3) s.list[0].feather = 0; } return s.list[0]; };
  assert.deepEqual(run(77), run(77));
  // lures arrive at `at`
  st = C.cleanAnimals({ t: 10, next: 4, list: [], lures: [{ home: [1, 1], at: 30 }] }, null);
  st.t = 29; assert.deepEqual(C.tick(st, 1, fixed(.5)).arrived, []);
  st.t = 30; const res = C.tick(st, 1, fixed(.5));
  assert.deepEqual(res.arrived, ['p4']);
  assert.equal(st.lures.length, 0); assert.equal(st.next, 5);
  const a = st.list[0];
  assert.equal(a.name, C.NAMES[6]); assert.equal(a.seed, 2 ** 31); assert.equal(a.born, 30); assert.deepEqual(a.home, [1, 1]);
  // cap: a lure never makes a fifth animal
  st = stateWith([hen({ id: 'p1', home: [0, 0] }), hen({ id: 'p2', home: [1, 0] }), hen({ id: 'p3', home: [2, 0] }), hen({ id: 'p4', home: [3, 0] })]);
  st.lures.push({ home: [4, 0], at: 0 });
  C.tick(st, 1, fixed(.5)); assert.equal(st.list.length, 4); assert.equal(st.lures.length, 0);
});

// 8
test('actions: lure, feed, pet, collect, rename; failures change nothing', () => {
  let st = stateWith([]);
  let bag = bagFrom([{ kind: 'seed', count: 1 }, { kind: 'leaf', count: 5 }]);
  let r = C.lure(st, 0, 0, bag, 100, fixed(.5));
  assert.equal(r.ok, true); assert.equal(r.food, 'seed'); assert.equal(bag.count('seed'), 0);
  assert.deepEqual(st.lures, [{ home: [0, 0], at: 130 }]);
  assert.equal(C.lure(st, 0, 0, bag, 100, fixed(.5)).reason, 'busy');
  r = C.lure(st, 1, 0, bag, 100, fixed(0)); assert.equal(r.food, 'leaf'); assert.equal(bag.count('leaf'), 2);
  const snap = JSON.stringify([st, bag.snapshot()]);
  assert.equal(C.lure(st, 2, 0, bag, 100, fixed(0)).reason, 'nofood');
  assert.equal(JSON.stringify([st, bag.snapshot()]), snap);
  st.list.push(hen({ id: 'p1', home: [5, 5] }), hen({ id: 'p2', home: [6, 6] }));
  bag.add('seed', 3);
  assert.equal(C.lure(st, 2, 0, bag, 100, fixed(0)).reason, 'cap');
  assert.equal(C.lure(st, 5, 5, bag, 100, fixed(0)).reason, 'busy');

  // feed
  st = stateWith();
  bag = bagFrom([{ kind: 'seed', count: 3 }]);
  r = C.feed(st, 'p1', 'seed', bag, 100);
  assert.equal(r.ok, true); assert.equal(st.list[0].content, 180); assert.equal(st.list[0].hearts, 1); assert.equal(bag.count('seed'), 2);
  r = C.feed(st, 'p1', 'seed', bag, 110); assert.equal(st.list[0].content, 360); assert.equal(st.list[0].hearts, 1, 'heart cooldown');
  const before = JSON.stringify([st, bag.snapshot()]);
  assert.equal(C.feed(st, 'p1', 'seed', bag, 200).reason, 'full');
  assert.equal(C.feed(st, 'p1', 'leaf', bag, 200).reason, 'nofood');
  assert.equal(C.feed(st, 'p1', 'fish', bag, 200).ok, false);
  assert.equal(C.feed(st, 'nope', 'seed', bag, 200).reason, 'notarget');
  assert.equal(JSON.stringify([st, bag.snapshot()]), before);

  // pet
  st = stateWith();
  assert.equal(C.pet(st, 'p1', 0).heart, true); assert.equal(st.list[0].hearts, 1);
  r = C.pet(st, 'p1', 30); assert.equal(r.ok, true); assert.equal(r.heart, false); assert.equal(r.text, ''); assert.equal(st.list[0].hearts, 1);
  st = stateWith([hen({ hearts: 4 })]);
  r = C.pet(st, 'p1', 0); assert.equal(st.list[0].hearts, 5); assert.equal(st.list[0].feather, 1); assert.match(r.text, /feather/);
  C.pet(st, 'p1', 60); assert.equal(st.list[0].feather, 1, 'feather every 120 s');
  C.pet(st, 'p1', 120); assert.equal(st.list[0].feather, 2);

  // collect
  st = stateWith([hen({ eggs: 3, feather: 2 })]);
  bag = bagFrom([]);
  r = C.collect(st, 0, 0, bag);
  assert.equal(r.text, '+3 Puff Egg, +2 Feather'); assert.equal(bag.count('puffegg'), 3); assert.equal(st.list[0].eggs, 0);
  assert.equal(C.collect(st, 0, 0, bag).reason, 'empty');
  st = stateWith([hen({ eggs: 3, feather: 1 })]);
  const slots = Array.from({ length: SLOT_COUNT }, () => ({ kind: 'scrap', count: 20 })); slots[0] = { kind: 'puffegg', count: 19 };
  bag = bagFrom(slots);
  r = C.collect(st, 0, 0, bag);
  assert.equal(r.ok, true); assert.equal(r.eggs, 1); assert.equal(st.list[0].eggs, 2); assert.equal(st.list[0].feather, 1);
  const full = JSON.stringify([st, bag.snapshot()]);
  assert.equal(C.collect(st, 0, 0, bag).reason, 'full');
  assert.equal(JSON.stringify([st, bag.snapshot()]), full);
  assert.equal(C.collect(st, 9, 9, bag).reason, 'notarget');

  // rename
  st = stateWith();
  assert.equal(C.rename(st, 'p1', '\u0000 ').reason, 'badname'); assert.equal(st.list[0].name, 'Pip');
  assert.equal(C.rename(st, 'p1', '  <b>x ').text, 'Renamed to <b>x'); assert.equal(st.list[0].name, '<b>x');
});

// 9
test('recipes: egg lantern, starter nest box, research unlocks', () => {
  assert.equal(RECIPES.egglamp.output.kind, 'lantern');
  assert.equal(RECIPES.nestbox.output.kind, 'nestbox');
  for (const k of ['puffegg', 'feather', 'nestbox', 'cushion']) assert.ok(ITEM_INFO[k], k);
  assert.ok(SR.STARTER.includes('nestbox'));
  const learned = SR.learnedFrom(['leaf', 'wood', 'feather', 'puffegg']);
  assert.ok(learned.includes('cushion')); assert.ok(learned.includes('egglamp'));
  assert.ok(!SR.learnedFrom(['leaf', 'wood']).includes('cushion'));
  const bag = bagFrom([{ kind: 'puffegg', count: 1 }, { kind: 'wood', count: 2 }]);
  assert.equal(bag.craft('egglamp').ok, true); assert.equal(bag.count('lantern'), 1); assert.equal(bag.count('puffegg'), 0);
});

// 10
function stub(o = {}) {
  const bag = bagFrom([{ kind: 'seed', count: 5 }]);
  return { T, role: 'host', running: true, world: { tiles: grid(3, 3), decor: [{ type: 'nestbox', x: 1, z: 1 }], pieces: [] }, physics: { x: 2, z: 2 }, other: { x: 2, z: 2 },
    emitted: [], emit(e, to) { this.emitted.push([e, to]); }, localBag: () => bag, actorBag: () => bag, action() {}, notice() {}, esc: s => String(s), rebuildRaft() {}, ...o, bag };
}
test('module: guest actions are no-ops, serialize cache, load(undefined)', () => {
  const g = stub({ role: 'guest' }), gm = createAnimals(g);
  gm.load({ v: 1, r: 2, t: 10, next: 2, list: [hen({ home: [1, 1] })], lures: [] }, 'net');
  const before = JSON.stringify(gm.debug.state());
  assert.equal(gm.action({ kind: 'animals.pet', id: 'p1' }, 'guest', g.bag), true);
  assert.equal(gm.action({ kind: 'animals.collect', x: 1, z: 1 }, 'guest', g.bag), true);
  assert.equal(gm.action({ kind: 'storage.put' }, 'guest', g.bag), false);
  assert.equal(JSON.stringify(gm.debug.state()), before);
  assert.equal(gm.serialize(), undefined);
  assert.equal(gm.debug.clock, 10);

  const h = stub(), m = createAnimals(h);
  m.load(undefined, 'save');
  const s1 = m.serialize(); assert.deepEqual(s1.list, []);
  assert.equal(m.serialize(), s1, 'cached while r is unchanged');
  m.load({ v: 1, r: 4, t: 50, next: 2, list: [hen({ home: [1, 1] })], lures: [] }, 'save');
  const s2 = m.serialize(); assert.equal(s2.list.length, 1); assert.equal(s2.t, 50);
  assert.equal(m.serialize(), s2);
  m.update(.5); assert.equal(m.serialize(), s2); assert.equal(s2.t, 50.5);
  assert.equal(m.action({ kind: 'animals.pet', id: 'p1' }, 'host', h.bag), true);
  const s3 = m.serialize(); assert.notEqual(s3, s2); assert.equal(s3.list[0].hearts, 1);
  assert.equal(h.emitted.at(-1)[0].text, 'Pip ♥ 1');
  // malformed actions are swallowed and change nothing
  for (const a of [{ kind: 'animals.feed', id: 'p1', food: 'fish' }, { kind: 'animals.lure', x: 1.5, z: 1 }, { kind: 'animals.name', id: 'p1', name: 'x'.repeat(65) }, { kind: 'animals.bogus' }])
    assert.equal(m.action(a, 'host', h.bag), true);
  assert.equal(m.serialize(), s3);
  // a removed nest box sends its Puffhen away (host prunes on decor change)
  h.world.decor = []; m.update(.1); assert.equal(m.debug.list().length, 0);
  assert.equal(m.decorModel('rug'), null);
});

test('models build (geometry merged, finite)', () => {
  for (const g of [M.puffhenGeometry(T), M.eggGeometry(T), M.heartGeometry(T)]) {
    assert.ok(g.attributes.position.count > 0); assert.ok(g.attributes.color);
    assert.ok(Array.from(g.attributes.position.array).every(Number.isFinite));
  }
  const pb = M.puffhenGeometry(T); pb.computeBoundingBox();
  assert.ok(pb.boundingBox.max.y > .3 && pb.boundingBox.max.y < .5 && pb.boundingBox.min.y > -.02);
  assert.ok(M.nestBoxModel(T).isObject3D); assert.ok(M.cushionModel(T).isObject3D);
});
