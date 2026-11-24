// Unit tests for the island trading posts (dist/trader-core.js, dist/trader.js, docs/specs/trader.md §11).
// Run: node --test tests/trader.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRADER, TRADER_PLANS, POOL, rng, offersFor, isPostIsland, postFor, openVisit, cleanTrader, tradeCheck, applyTrade } from '../dist/trader-core.js';
import { layoutFor, groundHeight, shape } from '../dist/islands-layout.js';
import { spotsFor } from '../dist/treasure-rules.js';
import { Bag, ITEM_INFO, RECIPES } from '../dist/inventory-state.js';
import { CONTENT_DECOR, CONTENT_BLOCK_RADIUS } from '../dist/content-items.js';

const has = k => Object.prototype.hasOwnProperty.call(ITEM_INFO, k);
const name = k => ITEM_INFO[k]?.name ?? k;
const emptyBag = () => new Bag({ slots: new Array(28).fill(null), selected: 0 });
const SEED = 12345;
const docked = (seed = SEED) => {
  const offers = offersFor(seed, has);
  return { v: 1, r: 3, plans: [], visit: { seed, stock: offers.map(o => o.stock) } };
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

test('posts stand only on the larger islands, about a third of them', () => {
  let n = 0;
  for (let s = 0; s < 1000; s++) {
    const seed = (s * 2654435761) >>> 0, R = layoutFor(seed).R, post = postFor(seed);
    assert.equal(isPostIsland(seed), R >= TRADER.POST_MIN_R);
    if (R < TRADER.POST_MIN_R) { assert.equal(post, null, `small island ${seed} has no post`); continue; }
    n++;
    assert.ok(post && Object.isFrozen(post));
    assert.equal(postFor(seed), post, 'cached'); // deterministic: host and guest get the same post
  }
  assert.ok(n >= 250 && n <= 420, `${n} posts in 1000 islands`);
  for (const bad of [-1, 1.5, 2 ** 32, '5', null, NaN]) { assert.equal(isPostIsland(bad), false); assert.equal(postFor(bad), null); }
});

test('the stall sits on dry, level-enough sand, its whole footprint clear of nodes and treasure, counter facing the sea', () => {
  const SR = { palm: .28, bush: .3, rock: .42, sand: .15 };
  let clear = 0, total = 0;
  for (let s = 0; s < 600; s++) {
    const seed = (s * 40503 + 17) >>> 0, post = postFor(seed); if (!post) continue;
    total++;
    const lay = layoutFor(seed), a = Math.atan2(post.z, post.x), rad = Math.hypot(post.x, post.z);
    const ground = (x, z) => groundHeight(Math.hypot(x, z), lay.R, Math.atan2(z, x) - lay.rot);
    assert.ok(ground(post.x, post.z) >= TRADER.POST_MIN_Y, `dry sand ${seed}`);
    assert.ok(rad <= TRADER.POST_U_MAX * lay.R * shape(a - lay.rot) + 1e-9);
    assert.ok(Math.abs(Math.sin(post.yaw) - post.x / rad) < 1e-9 && Math.abs(Math.cos(post.yaw) - post.z / rad) < 1e-9, 'faces outward');
    const c = Math.cos(post.yaw), sn = Math.sin(post.yaw);
    // the deck (3.5 x 1.6 m) is never buried and its .8 m footing always reaches the sand; every corner is dry
    for (let i = -4; i <= 4; i++) for (let j = -2; j <= 2; j++) {
      const mx = i * 1.75 / 4, mz = j * .8 / 2, g = ground(post.x + mx * c + mz * sn, post.z - mx * sn + mz * c);
      assert.ok(g > 0, `footprint in the sea on ${seed}`);
      assert.ok(g <= post.y + .06, `deck buried ${(g - post.y).toFixed(2)} m on ${seed}`);
      assert.ok(g > post.y - .75, `footing floats ${(post.y - g).toFixed(2)} m on ${seed}`);
    }
    let gap = Infinity;
    const toFoot = (px, pz, r) => { const dx = px - post.x, dz = pz - post.z, lx = dx * c - dz * sn, lz = dx * sn + dz * c;
      return Math.hypot(Math.max(0, Math.abs(lx) - 1.75), Math.max(0, Math.abs(lz) - .8)) - r; };
    for (const n of lay.nodes) gap = Math.min(gap, toFoot(n.x, n.z, SR[n.kind] * n.s));
    for (const t of spotsFor(seed)) gap = Math.min(gap, toFoot(t.x, t.z, .3));
    if (gap >= TRADER.POST_GAP - .2) clear++;
    assert.ok(gap > 0, `stall overlaps a node or treasure on ${seed} (${gap.toFixed(2)} m)`);
  }
  assert.ok(total > 100 && clear / total > .9, `${clear} of ${total} fully clear`);
});

test('openVisit: full seeded stock for the island', () => {
  const v = openVisit(SEED, has);
  assert.equal(v.seed, SEED); assert.deepEqual(v.stock, offersFor(SEED, has).map(o => o.stock));
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
    ['stale', (st, bag) => { bag.add('fish', 9); return { offer: 0, visit: SEED + 1 }; }, /stock changed/],
    ['stale', (st, bag) => { bag.add('fish', 9); return { offer: 0 }; }, /stock changed/],
    ['closed', (st, bag) => { bag.add('fish', 9); st.visit = null; return { offer: 0, visit: SEED }; }, /No trading post/],
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
  const D = { v: 1, r: 0, plans: [], visit: null };
  for (const junk of [undefined, null, 0, 'x', [], [1], { v: 2 }, { v: '1' }, () => 1]) assert.deepEqual(cleanTrader(junk, has), D);
  assert.equal(cleanTrader({ v: 1, r: -1 }, has).r, 0); assert.equal(cleanTrader({ v: 1, r: 2.5 }, has).r, 0);
  assert.deepEqual(cleanTrader({ v: 1, plans: ['shellwreath', 'shellwreath', 'nope', 3] }, has).plans, ['shellwreath']);
  for (const seed of [-1, 1.5, 2 ** 32, '5', null, NaN]) assert.equal(cleanTrader({ v: 1, visit: { seed, stock: [] } }, has).visit, null);
  const n = offersFor(77, has).length, offers = offersFor(77, has);
  const v = cleanTrader({ v: 1, visit: { seed: 77, stock: [-3, 99, 'x', 1.7, NaN, null, 1, 1, 1, 1] } }, has).visit;
  assert.equal(v.stock.length, n);
  assert.equal(v.stock[0], 0); assert.equal(v.stock[1], offers[1].stock); assert.equal(v.stock[2], offers[2].stock); assert.equal(v.stock[3], Math.min(1, offers[3].stock));
  for (let i = 0; i < n; i++) assert.ok(Number.isInteger(v.stock[i]) && v.stock[i] >= 0 && v.stock[i] <= offers[i].stock);
  assert.equal(cleanTrader({ v: 1, visit: { seed: 77, stock: [1] } }, has).visit.stock.length, n); // padded
  const evil = { v: 1, get r() { throw new Error('boom'); } };
  assert.deepEqual(cleanTrader(evil, has), D);
  const round = cleanTrader(JSON.parse(JSON.stringify(docked())), has);
  assert.deepEqual(round, docked());
  assert.ok(JSON.stringify(round).length < 1024);
});

test('an old save with the visiting barge loads: plans kept, barge timing dropped', () => {
  const old = { v: 1, r: 9, clock: 5321.5, next: 5800, plans: ['shellwreath'], visit: { seed: 4242, born: 5300, hold: 12, stock: [1, 0, 1, 2, 2, 1] } };
  const c = cleanTrader(JSON.parse(JSON.stringify(old)), has);
  assert.deepEqual(c.plans, ['shellwreath']); assert.equal(c.r, 9);
  assert.deepEqual(Object.keys(c).sort(), ['plans', 'r', 'v', 'visit']);
  assert.deepEqual(Object.keys(c.visit).sort(), ['seed', 'stock']);
  const gone = cleanTrader({ v: 1, r: 2, clock: 9000, next: 9100, plans: [], visit: null }, has);
  assert.deepEqual(gone, { v: 1, r: 2, plans: [], visit: null });
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

const postSeed = () => { for (let s = 1; ; s++) if (postFor(s)) return s; };
const plainSeed = () => { for (let s = 1; ; s++) if (!postFor(s)) return s; };

test('createTrader: a post opens on a large island only, trades, old barge save, guest mirrors', async () => {
  const { createTrader } = await import('../dist/trader.js');
  const notes = [], bag = emptyBag();
  let island = null;
  const ctx = { T: null, role: 'host', running: true, world: { tiles: [[0, 0]] }, physics: { x: 0, z: 0 }, other: null, emit: (e, to) => notes.push([e.text, to, e.kind]),
    localBag: () => bag, deckY: () => .2, action: a => m.action(a, 'host', bag), esc: s => s, islandNow: () => island };
  const m = createTrader(ctx);
  // an old save from the barge days: the plan survives, the barge does not come back
  m.load({ v: 1, r: 4, clock: 900, next: 950, plans: ['shellwreath'], visit: { seed: 99, born: 880, hold: 0, stock: [4, 2, 1, 3, 3, 2] } }, 'save');
  assert.equal(m.craftLocked('shellwreath'), null);
  for (let i = 0; i < 3000; i++) m.update(1);
  assert.equal(m.serialize().visit, null, 'no island in view: no trader at all');
  assert.deepEqual(m.serialize().plans, ['shellwreath']);
  assert.equal(notes.length, 0, 'no arrival or cast-off popups ever');
  // a fresh world: locked until the plan is bought
  m.load(undefined, 'save');
  assert.equal(m.craftLocked('shellwreath'), 'Buy the plan at a trading post');
  assert.equal(m.craftLocked('rope'), null);
  // a small island: no post
  island = { seed: plainSeed(), cx: 20, cz: -5, gy: 0 };
  m.update(1); assert.equal(m.debug.post(), null); assert.equal(m.serialize().visit, null);
  // a large island: the post opens with full stock at the island's seed
  const seed = postSeed(), post = postFor(seed);
  island = { seed, cx: 20, cz: -5, gy: 0 };
  m.update(1);
  assert.equal(m.debug.post(), seed);
  assert.equal(m.serialize().visit.seed, seed);
  assert.deepEqual(m.debug.stock(), offersFor(seed, has).map(o => o.stock));
  const s1 = m.serialize(), s2 = m.serialize();
  assert.equal(s1, s2); assert.equal(s1.visit.stock, s2.visit.stock);
  // far from the stall: refused
  ctx.physics = { x: 0, z: 0 };
  bag.add('fish', 6);
  const fi = m.debug.offers().findIndex(o => o.id === 'fish');
  m.debug.trade(fi); assert.equal(bag.count('shell'), 0); assert.equal(notes.at(-1)[0], 'Move a little closer to the counter');
  // at the counter: the trade goes through, loot only to the trader
  ctx.physics = { x: 20 + post.x + Math.sin(post.yaw) * 1.5, z: -5 + post.z + Math.cos(post.yaw) * 1.5 };
  m.debug.trade(fi);
  assert.equal(bag.count('shell'), 2); assert.equal(notes.at(-1)[1], 'host');
  // the plan unlocks the wreath; the float row (when stocked) pays out a Glass Float
  bag.add('shell', 20);
  m.debug.trade(m.debug.offers().findIndex(o => o.id === 'plan'));
  assert.equal(m.craftLocked('shellwreath'), null);
  // guest mirrors the host slice and places the same post from the island seed
  const g = createTrader({ ...ctx, role: 'guest', emit: () => assert.fail('guest emits') });
  g.load(JSON.parse(JSON.stringify(m.serialize())), 'net');
  g.update(1);
  assert.equal(g.debug.post(), seed); assert.deepEqual(g.debug.state().stall, m.debug.state().stall);
  assert.deepEqual(g.debug.stock(), m.debug.stock());
  g.load(undefined, 'net'); assert.equal(g.serialize().visit, null);
  // the player cannot walk into the stall: pushed out through the nearest side
  const inside = { x: 20 + post.x + Math.sin(post.yaw) * .3, y: 1.6 + post.y, z: -5 + post.z + Math.cos(post.yaw) * .3 };
  m.afterMove(inside);
  const out = Math.hypot(inside.x - 20 - post.x, inside.z + 5 - post.z);
  assert.ok(out > 1, `pushed out (${out.toFixed(2)} m)`);
  const front = { x: 20 + post.x + Math.sin(post.yaw) * 2, y: 1.6, z: -5 + post.z + Math.cos(post.yaw) * 2 }, fx = front.x, fz = front.z;
  m.afterMove(front); assert.equal(front.x, fx); assert.equal(front.z, fz);
  // the island leaves: the post closes; the plan stays learned
  island = null; m.update(1);
  assert.equal(m.serialize().visit, null); assert.deepEqual(m.serialize().plans, ['shellwreath']);
  assert.ok(!notes.some(n => /barge|cast off|bobbing/i.test(n[0] ?? '')));
  m.dispose(); g.dispose();
});

test('the float trade still pays out a Glass Float', () => {
  let seed = 0; while (!offersFor(seed, has).some(o => o.id === 'float')) seed++;
  const st = docked(seed), bag = emptyBag(); bag.add('shell', 12);
  const r = applyTrade(st, { kind: 'trader.trade', offer: idx(st, 'float'), visit: seed }, bag, has, name);
  assert.equal(r.ok, true); assert.equal(bag.count('glassfloat'), 1); assert.equal(bag.count('shell'), 2);
});

test('no Pim or barge in player-facing strings', () => {
  const files = ['trader.js', 'trader-core.js', 'trader-ui.js', 'craft-book.js', 'content-items.js', 'item-tooltips.js', 'survival-ui.js'];
  for (const f of files) {
    const src = readFileSync(new URL('../dist/' + f, import.meta.url), 'utf8');
    for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) assert.ok(!/\bPim\b|barge/i.test(m[2]), `${f}: ${m[2]}`);
  }
  for (const d of POOL) assert.ok(!/Pim/.test(JSON.stringify(d)));
});

test('late pool rows (titanium) leave older seeds alone: same rows, same shuffles, same indices', () => {
  // POOL as of origin/claude/raft-feedback-all, before titanium: rows are append-only.
  const OLD = ['fish', 'ore', 'plan', 'egg', 'feather', 'brick', 'glass', 'grill', 'copper', 'seeds', 'clay'];
  assert.deepEqual(POOL.slice(0, OLD.length).map(d => d.id), OLD);
  assert.ok(POOL.slice(OLD.length).every(d => d.late || d.rare), 'new rows go after the old ones and are late');
  // offers pinned from origin/claude/raft-feedback-all
  const pinned = {
    1: ['fish', 'ore', 'plan', 'clay', 'brick', 'seeds'],
    7: ['fish', 'ore', 'plan', 'copper', 'clay', 'float'],
    42: ['fish', 'ore', 'plan', 'clay', 'feather', 'seeds'],
    1234: ['fish', 'ore', 'plan', 'brick', 'feather', 'float'],
    99999: ['fish', 'ore', 'plan', 'glass', 'feather', 'brick'],
  };
  for (const s in pinned) assert.deepEqual(offersFor(+s).map(o => o.id), pinned[s], `seed ${s}`);
  // Without late rows the pool is exactly the old one; with them, at most the last pool slot becomes titanium.
  const legacy = POOL.filter(d => !d.late);
  let ti = 0;
  for (let s = 0; s < 2000; s++) {
    const a = offersFor(s, has, legacy).map(o => o.id), b = offersFor(s, has).map(o => o.id);
    assert.equal(a.length, b.length);
    const diff = a.map((x, i) => (x !== b[i] ? i : -1)).filter(i => i >= 0);
    if (!diff.length) continue;
    ti++;
    assert.equal(diff.length, 1, `seed ${s}`);
    assert.equal(b[diff[0]], 'titanium');
    assert.equal(diff[0], b.length - 1 - (b.includes('float') ? 1 : 0), 'titanium only takes the last pool slot');
  }
  assert.ok(ti > 400 && ti < 800, `titanium on ${ti} of 2000 visits`);
});
