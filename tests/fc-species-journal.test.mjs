// Unit tests for fish-species.js and the pure Journal in fish-journal.js.
// Run: node --test tests/fc-species-journal.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { SPECIES, RARITY, speciesById, rollCatch, biteDelay, dishName, starsFor } = await import(new URL('fish-species.js', base));
const { Journal, BASKET_MAX, fishSvg, createJournalPanel } = await import(new URL('fish-journal.js', base));

function seeded(seed = 12345) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const tally = (n, opts, seed) => {
  const r = seeded(seed), byRarity = {};
  for (let i = 0; i < n; i++) { const c = rollCatch(r, opts); const k = speciesById(c.species).rarity; byRarity[k] = (byRarity[k] || 0) + 1; }
  return byRarity;
};

test('species table: 8 unique, valid rarity and ranges', () => {
  assert.equal(SPECIES.length, 8);
  assert.equal(new Set(SPECIES.map((s) => s.id)).size, 8);
  for (const id of ['pomfret', 'herring', 'mackerel', 'tilapia', 'catfish', 'salmon', 'tuna', 'sunscale']) assert.ok(speciesById(id), id);
  for (const s of SPECIES) {
    assert.ok(RARITY[s.rarity]); assert.ok(s.minCm < s.maxCm); assert.ok(s.bite[0] < s.bite[1]);
    assert.match(s.look.body, /^#[0-9a-f]{6}$/i); assert.equal(typeof s.blurb, 'string');
  }
  assert.equal(speciesById('sunscale').name, 'Golden Sunscale');
  assert.equal(speciesById('sunscale').rarity, 'legendary');
  assert.equal(speciesById('nope'), null); assert.equal(speciesById(null), null);
  assert.ok(Object.isFrozen(SPECIES) && Object.isFrozen(SPECIES[0].look));
});

test('rollCatch is deterministic and rarity-weighted', () => {
  assert.deepEqual(rollCatch(seeded(7)), rollCatch(seeded(7)));
  const N = 20000, t = tally(N, { charge: 0.5 }, 1);
  assert.ok(t.common / N > 0.5 && t.common / N < 0.7, `common ${t.common}`);
  assert.ok(t.uncommon / N > 0.15 && t.uncommon / N < 0.35 /* catfish is shy by day */, `uncommon ${t.uncommon}`);
  assert.ok(t.rare / N > 0.06 && t.rare / N < 0.16, `rare ${t.rare}`);
  assert.ok(t.legendary > 0 && t.legendary / N < 0.04, `legendary ${t.legendary}`);
  assert.ok(t.common > t.uncommon && t.uncommon > t.rare && t.rare > t.legendary);
});

test('charge boosts rare odds by at most +50% relative', () => {
  const N = 20000, lo = tally(N, { charge: 0 }, 3), hi = tally(N, { charge: 1 }, 3);
  const rr = (t) => ((t.rare || 0) + (t.legendary || 0)) / N;
  assert.ok(rr(hi) > rr(lo) * 1.2, `${rr(lo)} -> ${rr(hi)}`);
  assert.ok(rr(hi) < rr(lo) * 1.6);
});

test('night favours catfish', () => {
  const count = (night) => { const r = seeded(9); let n = 0; for (let i = 0; i < 5000; i++) if (rollCatch(r, { night }).species === 'catfish') n++; return n; };
  assert.ok(count(true) > count(false) * 2);
});

test('cm within bounds, 1 decimal; stars match size band', () => {
  const r = seeded(42);
  for (let i = 0; i < 3000; i++) {
    const c = rollCatch(r, { charge: Math.random() });
    const s = speciesById(c.species);
    assert.ok(c.cm >= s.minCm && c.cm <= s.maxCm, `${c.species} ${c.cm}`);
    assert.equal(Math.round(c.cm * 10) / 10, c.cm);
    assert.ok([1, 2, 3].includes(c.stars));
    assert.equal(c.stars, starsFor(s, c.cm));
  }
  const p = speciesById('pomfret'); // 18..34
  assert.equal(starsFor(p, 18), 1); assert.equal(starsFor(p, 25.9), 1);
  assert.equal(starsFor(p, 26), 2); assert.equal(starsFor(p, 31.6), 3); assert.equal(starsFor(p, 34), 3);
  assert.doesNotThrow(() => rollCatch(() => NaN, { charge: 'x' }));
  assert.ok(speciesById(rollCatch(() => 0.9999999).species));
});

test('biteDelay within species range', () => {
  const r = seeded(5);
  for (const s of SPECIES) for (let i = 0; i < 50; i++) { const d = biteDelay(r, s.id); assert.ok(d >= s.bite[0] && d <= s.bite[1]); }
  assert.ok(Number.isFinite(biteDelay(r, 'unknown')));
});

test('dishName', () => {
  assert.equal(dishName('pomfret', 'cooked'), 'Grilled Pomfret');
  assert.equal(dishName('sunscale', 'burnt'), 'Charred Golden Sunscale');
  assert.equal(dishName('tuna'), 'Grilled Tuna');
  assert.equal(speciesById('salmon').dish, dishName('salmon', 'cooked'));
  assert.equal(typeof dishName('zzz', 'burnt'), 'string');
});

test('Journal recordCatch: new / record flags, counts, basket', () => {
  const j = new Journal();
  assert.equal(j.totalCaught, 0); assert.deepEqual(j.speciesSeen(), []);
  assert.deepEqual(j.recordCatch({ species: 'herring', cm: 20, stars: 1 }), { isNew: true, isRecord: false, basketed: true });
  assert.deepEqual(j.recordCatch({ species: 'herring', cm: 18, stars: 1 }), { isNew: false, isRecord: false, basketed: true });
  assert.deepEqual(j.recordCatch({ species: 'herring', cm: 27.3, stars: 3 }), { isNew: false, isRecord: true, basketed: true });
  j.recordCatch({ species: 'tuna', cm: 80, stars: 2 });
  const e = j.entry('herring');
  assert.equal(e.count, 3); assert.equal(e.bestCm, 27.3); assert.ok(e.firstAt > 0);
  assert.equal(j.totalCaught, 4); assert.deepEqual(j.speciesSeen(), ['herring', 'tuna']);
  assert.equal(j.entry('salmon'), null);
  assert.equal(j.basket.length, 4); assert.equal(j.basket[0].state, 'raw');
  assert.deepEqual(j.recordCatch({ species: 'kraken', cm: 9 }), { isNew: false, isRecord: false, basketed: false });
  assert.deepEqual(j.recordCatch(null), { isNew: false, isRecord: false, basketed: false });
  assert.equal(j.totalCaught, 4);
  assert.deepEqual(j.takeFromBasket(0), { species: 'herring', cm: 20, stars: 1, state: 'raw' });
  assert.equal(j.takeFromBasket(99), null); assert.equal(j.takeFromBasket('0'), null);
});

test('Journal recordDish', () => {
  const j = new Journal();
  assert.deepEqual(j.recordDish('pomfret', 'cooked'), { isNew: true });
  assert.deepEqual(j.recordDish('pomfret', 'cooked'), { isNew: false });
  assert.deepEqual(j.recordDish('pomfret', 'burnt'), { isNew: true });
  assert.deepEqual(j.recordDish('ghost', 'cooked'), { isNew: false });
  assert.deepEqual(j.dishes, { 'Grilled Pomfret': 2, 'Charred Pomfret': 1 });
});

test('basket caps at 40', () => {
  const j = new Journal();
  for (let i = 0; i < 50; i++) j.recordCatch({ species: 'pomfret', cm: 20, stars: 1 });
  assert.equal(j.basket.length, BASKET_MAX); assert.equal(BASKET_MAX, 40);
  assert.equal(j.recordCatch({ species: 'pomfret', cm: 20 }).basketed, false);
  assert.equal(j.entry('pomfret').count, 51);
  assert.equal(j.addToBasket({ species: 'tuna', cm: 70 }), false);
  const big = new Journal({ basket: Array.from({ length: 99 }, () => ({ species: 'tuna', cm: 70, stars: 2, state: 'cooked' })) });
  assert.equal(big.basket.length, 40);
});

test('snapshot round-trips through JSON', () => {
  const j = new Journal();
  j.recordCatch({ species: 'salmon', cm: 60.4, stars: 2 }); j.recordCatch({ species: 'mackerel', cm: 40, stars: 3 });
  j.recordDish('salmon', 'cooked'); j.basket[1].state = 'cooked';
  const snap = JSON.parse(JSON.stringify(j.snapshot()));
  const k = new Journal(snap);
  assert.deepEqual(k.snapshot(), j.snapshot());
  snap.species.salmon.count = 999; // snapshot is a copy
  assert.equal(j.entry('salmon').count, 1);
});

test('junk snapshots are sanitised, never throw', () => {
  for (const junk of [null, undefined, 0, 'x', [], [1, 2], { species: 5 }, { species: [], dishes: 'a', basket: {} }, NaN]) {
    const j = new Journal(junk);
    assert.deepEqual(j.snapshot(), { species: {}, dishes: {}, basket: [] });
  }
  const j = new Journal({
    species: { pomfret: { count: 3.7, bestCm: 'big', firstAt: -5 }, kraken: { count: 9 }, tuna: { count: -1 }, salmon: 'x', __proto__: null },
    dishes: { 'Grilled Pomfret': 2, bad: -3, worse: 'many', ['x'.repeat(200)]: 1 },
    basket: [null, 7, { species: 'kraken' }, { species: 'tuna', cm: Infinity, stars: 9, state: 'melted' }, { species: 'herring', cm: 22.25, stars: 0 }],
  });
  assert.deepEqual(j.entry('pomfret'), { count: 3, bestCm: 0, firstAt: 0 });
  assert.deepEqual(j.speciesSeen(), ['pomfret']);
  assert.deepEqual(j.dishes, { 'Grilled Pomfret': 2 });
  assert.deepEqual(j.basket, [
    { species: 'tuna', cm: 60, stars: 3, state: 'raw' }, // junk cm -> species minimum (the grill rejects off-range fish)
    { species: 'herring', cm: 22.3, stars: 1, state: 'raw' },
  ]);
});

test('basket fish stay inside the species size range', () => {
  const j = new Journal({ basket: [{ species: 'herring', cm: 500 }, { species: 'tuna', cm: 1 }] });
  assert.deepEqual(j.basket.map((b) => b.cm), [30, 60]);
  j.addToBasket({ species: 'pomfret', cm: -4 }); assert.equal(j.basket.at(-1).cm, 18);
});

test('a full basket makes room by dropping the oldest finished dish, never a raw fish', () => {
  const j = new Journal();
  j.addToBasket({ species: 'tuna', cm: 70, state: 'raw' });
  j.addToBasket({ species: 'salmon', cm: 50, state: 'cooked' });
  for (let i = 0; i < 38; i++) j.addToBasket({ species: 'pomfret', cm: 20, state: 'burnt' });
  assert.equal(j.basket.length, BASKET_MAX);
  assert.equal(j.recordCatch({ species: 'herring', cm: 20 }).basketed, true);
  assert.equal(j.basket.length, BASKET_MAX);
  assert.equal(j.basket[0].species, 'tuna', 'raw fish kept');
  assert.ok(!j.basket.some((b) => b.species === 'salmon'), 'oldest dish made room');
  assert.equal(j.basket.at(-1).species, 'herring');
});

test('panel module is Node-importable; fishSvg escapes colours', () => {
  assert.equal(typeof createJournalPanel, 'function');
  const svg = fishSvg({ shape: 'disc', body: '"><script>', belly: '#fff', fin: '#000', stripes: '#123456' }, 'po<m');
  assert.ok(!svg.includes('<script>')); assert.ok(svg.startsWith('<svg')); assert.ok(svg.includes('#123456'));
  assert.ok(fishSvg(null).includes('#9aa0a3'));
});
