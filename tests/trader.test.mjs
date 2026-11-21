// Unit tests for Pim's Barge pure rules (dist/trader-core.js, docs/specs/trader.md §11).
// Run: node --test tests/trader.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { TRADER, TRADER_PLANS, POOL, rng, offersFor, nextDelay, pathAt, parkAt, deckGap, cleanTrader, tradeCheck, applyTrade } from '../dist/trader-core.js';
import { Bag, ITEM_INFO, RECIPES } from '../dist/inventory-state.js';
import { CONTENT_DECOR, CONTENT_BLOCK_RADIUS } from '../dist/content-items.js';

const has = k => Object.prototype.hasOwnProperty.call(ITEM_INFO, k);
const name = k => ITEM_INFO[k]?.name ?? k;
const emptyBag = () => new Bag({ slots: new Array(28).fill(null), selected: 0 });
const SEED = 12345;
const docked = (seed = SEED) => {
  const offers = offersFor(seed, has);
  return { v: 1, r: 3, clock: 1000, next: 1500, plans: [], visit: { seed, born: 1000 - TRADER.APPROACH - 10, hold: 0, stock: offers.map(o => o.stock) } };
};
const idx = (st, id) => offersFor(st.visit.seed, has).findIndex(o => o.id === id);
const snap = (st, bag) => JSON.stringify([st, bag.snapshot()]);

test('rng is deterministic mulberry32 in [0,1)', () => {
  const a = rng(7), b = rng(7);
  for (let i = 0; i < 50; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
  assert.notEqual(rng(1)(), rng(2)());
});

test('offersFor: deterministic, varies by seed, OFFERS long, fixed rows first, frozen', () => {
  const a = offersFor(42, has), b = offersFor(42, () => true);
  assert.deepEqual(a.map(o => o.id), b.map(o => o.id));
  assert.equal(a.length, TRADER.OFFERS);
  assert.deepEqual(a.slice(0, 3).map(o => o.id), ['fish', 'ore', 'plan']);
  assert.ok(Object.isFrozen(a));
  const sigs = new Set(); for (let s = 0; s < 40; s++) sigs.add(offersFor(s, has).map(o => o.id).join());
  assert.ok(sigs.size > 5);
  for (let s = 0; s < 200; s++) { const ids = offersFor(s, has).map(o => o.id); assert.equal(new Set(ids).size, ids.length); }
});

test('offersFor: a filter without puffegg/feather still fills; unknown kinds are dropped', () => {
  const no = k => has(k) && k !== 'puffegg' && k !== 'feather';
  for (let s = 0; s < 100; s++) {
    const o = offersFor(s, no);
    assert.equal(o.length, TRADER.OFFERS);
    assert.ok(!o.some(d => d.id === 'egg' || d.id === 'feather'));
  }
  const pool = [...POOL, Object.freeze({ id: 'odd', give: { shell: 1 }, get: { unobtainium: 1 }, stock: 1 })];
  for (let s = 0; s < 100; s++) assert.ok(!offersFor(s, has, pool).some(d => d.id === 'odd'));
  // the plan row needs only shell
  assert.ok(offersFor(1, k => k === 'shell').some(d => d.id === 'plan'));
  assert.ok(offersFor(1, k => k === 'shell').length < TRADER.OFFERS);
});

test('the float row shows up in 30-50% of seeds, always last', () => {
  let n = 0;
  for (let s = 0; s < 1000; s++) {
    const o = offersFor(s * 7919 + 3, has), i = o.findIndex(d => d.id === 'float');
    if (i >= 0) { n++; assert.equal(i, o.length - 1); }
  }
  assert.ok(n >= 300 && n <= 500, `float in ${n} of 1000`);
});

test('pathAt boundaries and hold', () => {
  const o = {};
  assert.deepEqual(pathAt(-5, 0, o), { phase: 'approach', u: 0, left: TRADER.APPROACH + TRADER.DOCK + 5 });
  assert.equal(pathAt(0, 0, o).phase, 'approach');
  assert.equal(pathAt(TRADER.APPROACH / 2, 0, o).u, .5);
  assert.equal(pathAt(TRADER.APPROACH, 0, o).phase, 'docked');
  assert.equal(o.left, TRADER.DOCK);
  assert.equal(pathAt(TRADER.APPROACH + TRADER.DOCK - 1, 0, o).phase, 'docked');
  assert.equal(o.left, 1);
  assert.equal(pathAt(TRADER.APPROACH + TRADER.DOCK, 0, o).phase, 'depart');
  assert.equal(pathAt(TRADER.APPROACH + TRADER.DOCK + 30, 60, o).phase, 'docked');
  assert.equal(o.left, 30);
  assert.equal(pathAt(TRADER.APPROACH + TRADER.DOCK + TRADER.DEPART, 0, o).phase, 'gone');
  assert.equal(pathAt(NaN, 0, o).phase, 'gone');
  const same = pathAt(1, 0, o); assert.equal(same, o);
});

test('nextDelay stays in GAP_MIN..GAP_MAX', () => {
  for (let s = 0; s < 500; s++) { const d = nextDelay(s * 104729); assert.ok(d >= TRADER.GAP_MIN && d <= TRADER.GAP_MAX); }
});

test('parkAt: gap <= GAP for 1x1, wide, L and holey rafts; no-tile fallback', () => {
  const rafts = [
    [[0, 0]],
    [[-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [0, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
    [[3, -1], [0, 0], [1, 0], [2, 0], [3, 0]],
    [[-3, 0], [3, 0], [0, 1], [-3, 1], [3, 1]],
  ];
  const o = {};
  for (const t of rafts) {
    parkAt(t, o);
    assert.ok(deckGap(t, o.x, o.z + TRADER.HALF_BEAM) <= TRADER.GAP + 1e-6, JSON.stringify(t));
    const minZ = Math.min(...t.map(q => q[1]));
    assert.ok(o.z + TRADER.HALF_BEAM < minZ * 2 - 1, 'barge sits off the bow');
  }
  parkAt([[0, 0], [1, 0], [0, 1]], o); assert.equal(o.x, 1); // mean of the bow row
  assert.deepEqual(parkAt([], o), { x: 0, z: -3 - TRADER.GAP - TRADER.HALF_BEAM });
  assert.deepEqual(parkAt(null, {}), { x: 0, z: -3 - TRADER.GAP - TRADER.HALF_BEAM });
  assert.deepEqual(parkAt([['a', 1], null], {}), { x: 0, z: -3 - TRADER.GAP - TRADER.HALF_BEAM });
  assert.equal(deckGap([], 5, 5), 0);
});

test('applyTrade ok: shells in, fish out, stock-1, r+1, same slots array', () => {
  const st = docked(), bag = emptyBag(); bag.add('fish', 5);
  const slots = bag.slots, v0 = bag.version, i = idx(st, 'fish');
  const r = applyTrade(st, { kind: 'trader.trade', offer: i, visit: SEED }, bag, has, name);
  assert.equal(r.ok, true);
  assert.equal(r.text, '+ 2 Bright Shell');
  assert.equal(bag.count('fish'), 2); assert.equal(bag.count('shell'), 2);
  assert.equal(bag.slots, slots); assert.ok(bag.version > v0);
  assert.equal(st.visit.stock[i], 3); assert.equal(st.r, 4);
});

test('the plan buy pushes the plan once; a repeat is known', () => {
  const st = docked(), bag = emptyBag(); bag.add('shell', 20);
  const i = idx(st, 'plan'), a = { kind: 'trader.trade', offer: i, visit: SEED };
  const r = applyTrade(st, a, bag, has, name);
  assert.equal(r.ok, true); assert.deepEqual(st.plans, ['shellwreath']); assert.equal(bag.count('shell'), 14);
  assert.match(r.text, /Shell Wreath plan/);
  st.visit.stock[i] = 1; // even with stock left
  const before = snap(st, bag), k = applyTrade(st, a, bag, has, name);
  assert.equal(k.reason, 'known'); assert.equal(k.text, 'You already have this plan'); assert.equal(snap(st, bag), before);
});

test('each failure leaves the bag and the slice untouched', () => {
  const cases = [
    ['missing', (st, bag) => { bag.add('fish', 1); return { offer: idx(st, 'fish'), visit: SEED }; }, /Need 2 more Fish/],
    ['full', (st, bag) => { for (let i = 0; i < 28; i++) bag.add(i === 0 ? 'fish' : 'wood', i === 0 ? 4 : 20); return { offer: idx(st, 'fish'), visit: SEED }; }, /Bag full/],
    ['soldout', (st, bag) => { bag.add('fish', 9); st.visit.stock[idx(st, 'fish')] = 0; return { offer: idx(st, 'fish'), visit: SEED }; }, /Sold out/],
    ['stale', (st, bag) => { bag.add('fish', 9); return { offer: 0, visit: SEED + 1 }; }, /new stock/],
    ['closed', (st, bag) => { bag.add('fish', 9); st.clock = st.visit.born + 1; return { offer: 0, visit: SEED }; }, /isn.t here/],
    ['closed', (st, bag) => { bag.add('fish', 9); st.visit = null; return { offer: 0, visit: SEED }; }, /isn.t here/],
    ['bad', (st, bag) => { bag.add('fish', 9); return { offer: 99, visit: SEED }; }, /./],
    ['bad', (st, bag) => { bag.add('fish', 9); return { offer: '0', visit: SEED }; }, /./],
  ];
  for (const [reason, setup, text] of cases) {
    const st = docked(), bag = emptyBag(), a = { kind: 'trader.trade', ...setup(st, bag) };
    const before = snap(st, bag), v = bag.version;
    const c = tradeCheck(st, a, bag, has, name);
    assert.equal(c.ok, false); assert.equal(c.reason, reason);
    const r = applyTrade(st, a, bag, has, name);
    assert.equal(r.ok, false); assert.equal(r.reason, reason, reason); assert.match(r.text, text);
    assert.equal(snap(st, bag), before, reason); assert.equal(bag.version, v);
  }
});

test('a full bag that frees a slot by paying still trades (atomic scratch)', () => {
  const st = docked(), bag = emptyBag();
  bag.add('fish', 3); for (let i = 1; i < 28; i++) bag.add('wood', 20);
  const r = applyTrade(st, { kind: 'trader.trade', offer: idx(st, 'fish'), visit: SEED }, bag, has, name);
  assert.equal(r.ok, true); assert.equal(bag.count('shell'), 2); assert.equal(bag.count('fish'), 0);
});

test('cleanTrader never throws and repairs junk', () => {
  const D = { v: 1, r: 0, clock: 0, next: TRADER.FIRST, plans: [], visit: null };
  for (const junk of [undefined, null, 0, 'x', [], [1], { v: 2 }, { v: '1' }, () => 1]) assert.deepEqual(cleanTrader(junk, has), D);
  const nan = cleanTrader({ v: 1, clock: NaN, next: NaN, r: -1 }, has);
  assert.equal(nan.clock, 0); assert.equal(nan.next, TRADER.FIRST); assert.equal(nan.r, 0);
  const big = cleanTrader({ v: 1, clock: 5e9, next: 1, r: 2.5 }, has);
  assert.equal(big.clock, TRADER.MAX_CLOCK); assert.equal(big.next, TRADER.MAX_CLOCK); assert.equal(big.r, 0);
  const far = cleanTrader({ v: 1, clock: 100, next: 1e6 }, has); assert.equal(far.next, 100 + TRADER.GAP_MAX);
  assert.deepEqual(cleanTrader({ v: 1, plans: ['shellwreath', 'shellwreath', 'nope', 3] }, has).plans, ['shellwreath']);
  for (const seed of [-1, 1.5, 2 ** 32, '5', null, NaN]) assert.equal(cleanTrader({ v: 1, clock: 50, visit: { seed, born: 40, stock: [] } }, has).visit, null);
  const n = offersFor(77, has).length;
  const v = cleanTrader({ v: 1, clock: 100, visit: { seed: 77, born: 500, hold: 9999, stock: [-3, 99, 'x', 1.7, NaN, null, 1, 1, 1, 1] } }, has).visit;
  assert.equal(v.born, 100); assert.equal(v.hold, TRADER.HOLD_MAX); assert.equal(v.stock.length, n);
  const offers = offersFor(77, has);
  assert.equal(v.stock[0], 0); assert.equal(v.stock[1], offers[1].stock); assert.equal(v.stock[2], offers[2].stock); assert.equal(v.stock[3], Math.min(1, offers[3].stock));
  for (let i = 0; i < n; i++) assert.ok(Number.isInteger(v.stock[i]) && v.stock[i] >= 0 && v.stock[i] <= offers[i].stock);
  assert.equal(cleanTrader({ v: 1, clock: 100, visit: { seed: 77, born: 50, stock: [1] } }, has).visit.stock.length, n); // padded
  const gone = cleanTrader({ v: 1, clock: 5000, next: 5000, visit: { seed: 77, born: 10, hold: 0, stock: [] } }, has);
  assert.equal(gone.visit, null); assert.ok(gone.next > 5000);
  const evil = { v: 1, get clock() { throw new Error('boom'); } };
  assert.deepEqual(cleanTrader(evil, has), D);
  const round = cleanTrader(JSON.parse(JSON.stringify(docked())), has);
  assert.deepEqual(round, docked());
  assert.ok(JSON.stringify(round).length < 1024);
});

test('content wiring: kinds, recipe, decor, plans', () => {
  for (const k of ['shell', 'shellwreath', 'glassfloat']) assert.ok(has(k), k);
  assert.equal(ITEM_INFO.shell.name, 'Bright Shell'); assert.equal(ITEM_INFO.shell.maxStack, 20);
  assert.deepEqual({ ...RECIPES.shellwreath.cost }, { shell: 3, rope: 2, leaf: 2 });
  assert.equal(RECIPES.glassfloat, undefined);
  assert.ok(CONTENT_DECOR.includes('shellwreath') && CONTENT_DECOR.includes('glassfloat'));
  assert.equal(CONTENT_BLOCK_RADIUS.shellwreath, .12); assert.equal(CONTENT_BLOCK_RADIUS.glassfloat, .2);
  assert.deepEqual([...TRADER_PLANS], ['shellwreath']);
  for (const d of POOL) for (const k of [...Object.keys(d.give), ...Object.keys(d.get)]) assert.ok(has(k), `${d.id}: ${k}`);
});

test('createTrader: host spawns, holds, departs; craftLocked; serialize reuse; guest never spawns', async () => {
  const { createTrader } = await import('../dist/trader.js');
  const notes = [], bag = emptyBag();
  const ctx = { T: null, role: 'host', running: true, world: { tiles: [[0, 0]] }, physics: { x: 0, z: 0 }, other: null, emit: (e, to) => notes.push([e.text, to]),
    localBag: () => bag, deckY: () => .2, action: a => m.action(a, 'host', bag), esc: s => s };
  const m = createTrader(ctx);
  m.load(undefined, 'save');
  assert.equal(m.craftLocked('shellwreath'), 'Buy the plan from Pim’s barge');
  assert.equal(m.craftLocked('rope'), null);
  for (let i = 0; i < 241; i++) m.update(1);
  assert.equal(m.debug.phase(), 'approach');
  assert.equal(notes[0][0], 'A little trading barge is bobbing this way!'); assert.equal(notes[0][1], 'all');
  const s1 = m.serialize(), s2 = m.serialize();
  assert.equal(s1, s2); assert.equal(s1.visit.stock, s2.visit.stock);
  for (let i = 0; i < 30; i++) m.update(1);
  assert.equal(m.debug.phase(), 'docked');
  bag.add('fish', 6);
  m.debug.trade(m.debug.offers().findIndex(o => o.id === 'fish'));
  assert.equal(bag.count('shell'), 2);
  // far away: refused
  ctx.physics = { x: 0, z: 50 };
  m.debug.trade(0); assert.equal(bag.count('shell'), 2); assert.equal(notes.at(-1)[0], 'Get a bit closer to Pim');
  // near the stall at the end: hold grows instead of leaving
  ctx.physics = { ...m.debug.state().stall };
  for (let i = 0; i < 460; i++) m.update(1);
  assert.equal(m.debug.state().visit.hold, TRADER.HOLD_MAX);
  assert.ok(notes.some(n => n[0] === 'Pim is getting ready to cast off'));
  m.debug.skip(3600);
  assert.equal(m.debug.phase(), 'gone'); assert.equal(m.serialize().visit, null);
  // the plan unlocks the wreath
  m.debug.summon(5); bag.add('shell', 10);
  m.debug.trade(m.debug.offers().findIndex(o => o.id === 'plan'));
  assert.equal(m.craftLocked('shellwreath'), null);
  // guest: own clock, never spawns or ends a visit
  const g = createTrader({ ...ctx, role: 'guest', emit: () => assert.fail('guest emits') });
  g.load(JSON.parse(JSON.stringify(m.serialize())), 'net');
  assert.equal(g.debug.summon(), false);
  for (let i = 0; i < 2000; i++) g.update(1);
  assert.ok(g.serialize().visit, 'the guest keeps the host visit until told');
  g.load(undefined, 'net'); assert.equal(g.serialize().visit, null);
  m.dispose(); g.dispose();
});
