// Integration-style tests for the progression lane using the REAL catalogue:
// dist/items.js (data + migration), dist/progression.js (unlocks, crafting),
// dist/smelter.js (station cooking), plus adversarial / exploit cases.
// Run: node --test tests/progression.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const I = await import(new URL('items.js', base));
const { ITEMS, ITEM_IDS, TOOL_IDS, STATION_IDS, PLACEABLE_IDS, BLOCK_RADII, LEGACY_ALIASES, BARREL_LOOT, FUEL_VALUE,
  migrateSnapshot, infoTable, recipeTable, rollBarrel, repairCost, wearPerUse, toolRole, fuelValue, stationRecipeFor } = I;
const { Progression, canCraft, craft } = await import(new URL('progression.js', base));
const { StationModel, FUEL_CAP } = await import(new URL('smelter.js', base));
const Inv = await import(new URL('inventory-state.js', base));
const { Bag, SLOT_COUNT, HOTBAR_SIZE } = Inv;

const LEGACY = ['wood', 'leaf', 'plastic', 'scrap', 'rope', 'fish', 'hook', 'hammer', 'fishingrod', 'sail', 'palm', 'lantern', 'net', 'bench', 'crate'];
const CATEGORIES = new Set(['material', 'refined', 'tool', 'station', 'build', 'food', 'decor']);
const STATIONS_WITH_RECIPES = new Set(['smelter', 'grill', 'purifier']);
const INFO = infoTable();
const BAG_KNOWS_ALL = ITEM_IDS.every((k) => Inv.ITEM_KINDS.includes(k));

// Deterministic PRNG (mulberry32).
const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Mirror of Bag's validateSlot/constructor rules, but against items.js kinds.
function assertBagValid(snap) {
  assert.ok(snap && typeof snap === 'object' && !Array.isArray(snap), 'snapshot object');
  assert.ok(Array.isArray(snap.slots) && snap.slots.length === SLOT_COUNT, 'slots length');
  assert.ok(Number.isInteger(snap.selected) && snap.selected >= 0 && snap.selected < HOTBAR_SIZE, 'selected');
  const ids = new Set();
  snap.slots.forEach((s, i) => {
    if (s === null) return;
    assert.ok(typeof s === 'object' && !Array.isArray(s), `slot ${i} object`);
    assert.ok(Object.hasOwn(ITEMS, s.kind), `slot ${i} kind ${s.kind}`);
    const it = ITEMS[s.kind];
    assert.ok(Number.isInteger(s.count) && s.count >= 1 && s.count <= it.stack, `slot ${i} count ${s.count}`);
    if (it.tool) assert.ok(typeof s.durability === 'number' && Number.isFinite(s.durability) && s.durability >= 0 && s.durability <= 100, `slot ${i} durability ${s.durability}`);
    else assert.equal(s.durability, undefined, `slot ${i} non-tool durability`);
    if (s.id !== undefined) {
      assert.ok(typeof s.id === 'string' && s.id, `slot ${i} id`);
      assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
      ids.add(s.id);
    }
    for (const k of Object.keys(s)) assert.ok(['kind', 'count', 'durability', 'id'].includes(k), `slot ${i} extra key ${k}`);
  });
}
// The real Bag must accept the snapshot (restricted to kinds it currently knows).
function assertRealBagAccepts(snap) {
  const known = BAG_KNOWS_ALL ? snap : { ...snap, slots: snap.slots.map((s) => (s && Inv.ITEM_INFO[s.kind] ? s : null)) };
  assert.doesNotThrow(() => new Bag(known));
}

// Minimal Bag with the real Bag's semantics but the items.js stack table, so the
// full chain runs before inventory-state.js learns the new kinds.
class MiniBag {
  constructor(snap = null) {
    this.slots = snap ? snap.slots.map((s) => (s ? { ...s } : null)) : new Array(SLOT_COUNT).fill(null);
    this.selectedIndex = snap ? snap.selected : 0;
  }
  count(k) { return this.slots.reduce((n, s) => n + (s && s.kind === k ? s.count : 0), 0); }
  add(kind, count, meta = {}) {
    let left = count;
    if (!Object.hasOwn(ITEMS, kind)) return left;
    const max = ITEMS[kind].stack;
    if (max > 1) for (const s of this.slots) if (left && s && s.kind === kind && s.count < max) { const p = Math.min(max - s.count, left); s.count += p; left -= p; }
    for (let i = 0; i < SLOT_COUNT && left; i++) {
      if (this.slots[i]) continue;
      const p = Math.min(max, left);
      this.slots[i] = { kind, count: p, ...(ITEMS[kind].tool ? { durability: meta.durability ?? 100 } : {}) };
      left -= p;
    }
    return left;
  }
  remove(kind, count) {
    if (this.count(kind) < count) return false;
    let left = count;
    for (let i = SLOT_COUNT - 1; i >= 0 && left; i--) {
      const s = this.slots[i];
      if (!s || s.kind !== kind) continue;
      const t = Math.min(s.count, left); s.count -= t; left -= t;
      if (!s.count) this.slots[i] = null;
    }
    return true;
  }
  snapshot() { return { slots: this.slots.map((s) => (s ? { ...s } : null)), selected: this.selectedIndex }; }
}
const ChainBag = BAG_KNOWS_ALL ? Bag : MiniBag;
const emptyChainBag = () => new ChainBag({ slots: new Array(SLOT_COUNT).fill(null), selected: 0 });

// ======================================================= items.js integrity

test('items: every entry is complete and self-consistent', () => {
  const svg = readFileSync(new URL('icons.svg', base), 'utf8');
  for (const id of ITEM_IDS) {
    const it = ITEMS[id];
    assert.equal(it.id, id);
    assert.ok(typeof it.name === 'string' && it.name.length > 0, `${id} name`);
    assert.ok(typeof it.tip === 'string' && it.tip.length > 10, `${id} tip`);
    assert.ok(typeof it.icon === 'string' && it.icon.startsWith('icon-'), `${id} icon`);
    if (!it.placeholder) assert.ok(svg.includes(`id="${it.icon}"`), `${id} non-placeholder icon ${it.icon} must exist in icons.svg`);
    assert.ok(CATEGORIES.has(it.category), `${id} category ${it.category}`);
    assert.ok(Number.isInteger(it.stack) && it.stack >= 1, `${id} stack`);
    assert.equal(typeof it.tool, 'boolean');
    assert.equal(typeof it.placeable, 'boolean');
    if (it.tool) {
      assert.equal(it.stack, 1, `${id} tool stack`);
      assert.ok(Number.isInteger(it.durability) && it.durability > 0, `${id} durability uses`);
      assert.ok(repairCost(id), `${id} tool needs a repair cost`);
    } else {
      assert.equal(it.durability, undefined, `${id} non-tool durability`);
    }
    if (it.placeable) assert.ok(Object.hasOwn(BLOCK_RADII, id) && BLOCK_RADII[id] >= 0, `${id} radius`);
    if (it.actsAs !== undefined) assert.ok(['hook', 'fishingrod', 'hammer', 'spear'].includes(it.actsAs) && it.tool, `${id} actsAs`);
  }
  for (const id of Object.keys(BLOCK_RADII)) assert.ok(ITEMS[id]?.placeable, `radius for non-placeable ${id}`);
});

test('items: every recipe, unlock, repair, alias, loot and fuel reference is a real item', () => {
  const valid = (k) => Object.hasOwn(ITEMS, k);
  for (const id of ITEM_IDS) {
    const { recipe: r, unlock: u } = ITEMS[id];
    if (r) {
      assert.ok(Number.isInteger(r.count) && r.count >= 1, `${id} count`);
      const keys = Object.keys(r.cost);
      assert.ok(keys.length >= 1, `${id} cost`);
      for (const k of keys) {
        assert.ok(valid(k), `${id} cost kind ${k}`);
        assert.ok(Number.isInteger(r.cost[k]) && r.cost[k] >= 1, `${id} cost n`);
        assert.notEqual(k, id, `${id} costs itself`);
      }
      if (r.station === null) {
        assert.equal(r.time, undefined); assert.equal(r.fuel, undefined);
      } else {
        assert.ok(STATIONS_WITH_RECIPES.has(r.station), `${id} station ${r.station}`);
        assert.equal(keys.length, 1, `${id} station recipe single input`);
        assert.ok(r.time > 0 && r.fuel >= 0, `${id} time/fuel`);
        assert.equal(stationRecipeFor(r.station, keys[0]), ITEMS[id]);
      }
    }
    assert.ok(['start', 'discover', 'research', 'station'].includes(u.type), `${id} unlock`);
    if (u.type === 'discover' || u.type === 'research') {
      assert.ok(Array.isArray(u.items) && u.items.length > 0);
      for (const k of u.items) { assert.ok(valid(k), `${id} unlock ref ${k}`); assert.notEqual(k, id); }
    }
    if (u.type === 'station') assert.ok(STATION_IDS.includes(u.station) && ITEMS[u.station].placeable, `${id} station ${u.station}`);
  }
  // every station used by a recipe is a placeable station that can be crafted
  for (const id of ITEM_IDS) {
    const st = ITEMS[id].recipe?.station;
    if (st && st !== 'purifier') assert.ok(STATION_IDS.includes(st) && ITEMS[st].recipe, `station ${st}`);
  }
  for (const t of TOOL_IDS) for (const k of Object.keys(repairCost(t))) assert.ok(valid(k), `repair ${t} ${k}`);
  for (const [a, k] of Object.entries(LEGACY_ALIASES)) { assert.ok(valid(k), `alias ${a}`); assert.ok(!valid(a), `alias shadows item ${a}`); }
  for (const e of BARREL_LOOT) { assert.ok(valid(e.kind)); assert.ok(e.min >= 1 && e.max >= e.min && e.weight > 0); }
  for (const k of Object.keys(FUEL_VALUE)) assert.ok(valid(k) && FUEL_VALUE[k] > 0);
  assert.equal(fuelValue('plastic'), 0);
});

test('items: legacy kinds keep their ids and Bag-compatible stack/tool shape', () => {
  for (const k of LEGACY) {
    assert.ok(ITEMS[k], `legacy ${k}`);
    assert.equal(INFO[k].maxStack, Inv.ITEM_INFO[k].maxStack, `${k} stack matches Bag`);
    assert.equal(INFO[k].tool, Inv.ITEM_INFO[k].tool, `${k} tool flag matches Bag`);
  }
  assert.equal(ITEMS.wood.name, 'Plank');
  assert.deepEqual([...TOOL_IDS].sort(), ['axe', 'fishingrod', 'hammer', 'hook', 'metalhook', 'metalspear', 'paddle', 'spade', 'spear']);
  for (const s of ['smelter', 'researchtable', 'grill']) assert.ok(STATION_IDS.includes(s) && PLACEABLE_IDS.includes(s));
  for (const k of ['sail', 'palm', 'lantern', 'net', 'bench', 'crate', 'juicer' /* [juicer] */]) assert.ok(PLACEABLE_IDS.includes(k));
  assert.ok(!STATION_IDS.includes('juicer')); // [juicer] decor, not a slot-panel station
});

test('items: no unlock/recipe cycles and every item is reachable from the start', () => {
  // Raw sources: floating debris + barrel loot. Fish comes from the fishing rod.
  const have = new Set(['wood', 'leaf', 'plastic', 'scrap', 'sharkmeat', 'sharkhead', 'berries' /* [juicer] island bushes */, ...BARREL_LOOT.map((e) => e.kind)]); // shark loot comes from a dead shark (shark.js)
  const unlocked = (id) => {
    const u = ITEMS[id].unlock;
    if (u.type === 'start') return true;
    if (u.type === 'station') return have.has(u.station);
    return u.items.every((k) => have.has(k)); // discover/research: holding is enough
  };
  for (let changed = true; changed;) {
    changed = false;
    if (have.has('fishingrod') && !have.has('fish')) { have.add('fish'); changed = true; }
    if (have.has('axe') && !have.has('coconut')) { have.add('coconut'); changed = true; } // [axe] chopped island palms
    if (have.has('beehive') && have.has('flowerbox') && !have.has('honey')) { have.add('honey'); have.add('wax'); changed = true; } // [bees] hive harvest
    if (have.has('palm') && !have.has('coconut')) { have.add('coconut'); changed = true; } // [juicer] planter harvest
    if (have.has('juicer') && !have.has('berrycup')) { for (const k of ['berrycup', 'coconutcup', 'mixcup']) have.add(k); changed = true; } // [juicer] blend
    for (const id of ITEM_IDS) {
      const r = ITEMS[id].recipe;
      if (have.has(id) || !r || !unlocked(id)) continue;
      if (r.station && !have.has(r.station)) continue;
      if (Object.keys(r.cost).every((k) => have.has(k))) { have.add(id); changed = true; }
    }
  }
  assert.deepEqual(ITEM_IDS.filter((id) => !have.has(id)), [], 'unreachable items');
});

test('items: infoTable and recipeTable have Bag shapes', () => {
  assert.deepEqual(Object.keys(INFO).sort(), [...ITEM_IDS].sort());
  for (const [k, row] of Object.entries(INFO)) {
    assert.equal(row.kind, k);
    assert.equal(row.name, ITEMS[k].name);
    assert.equal(row.icon, ITEMS[k].icon);
    assert.equal(row.maxStack, ITEMS[k].stack);
    assert.equal(row.tool, ITEMS[k].tool);
    assert.equal(typeof row.placeholder, 'boolean');
    if (row.tool) assert.equal(row.maxDurability, 100); else assert.equal(row.maxDurability, undefined);
    assert.ok(Object.isFrozen(row));
  }
  const RT = recipeTable();
  const hand = ITEM_IDS.filter((id) => ITEMS[id].recipe && ITEMS[id].recipe.station === null);
  assert.deepEqual(Object.keys(RT).sort(), [...hand].sort());
  for (const [id, r] of Object.entries(RT)) {
    assert.deepEqual(Object.keys(r).sort(), ['cost', 'id', 'name', 'output']);
    assert.equal(r.id, id);
    assert.deepEqual(r.output, { kind: id, count: ITEMS[id].recipe.count });
    assert.deepEqual(r.cost, { ...ITEMS[id].recipe.cost });
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.cost) && Object.isFrozen(r.output));
  }
  for (const id of ['brick', 'metalingot', 'glass', 'copperingot', 'cookedfish']) assert.ok(!RT[id], `${id} is station-only`);
  // the legacy RECIPES ids are all still hand-craftable with the same output kind
  // (recipes from other lanes, e.g. content/signal/watering, are not in the progression catalogue)
  for (const id of Object.keys(Inv.RECIPES).filter((k) => ITEMS[k])) assert.equal(RT[id]?.output.kind, Inv.RECIPES[id].output.kind);
});

test('items: exports are deeply frozen and helpers return safe values', () => {
  for (const o of [ITEMS, ITEMS.hook, ITEMS.hook.recipe, ITEMS.hook.recipe.cost, ITEMS.net.unlock, ITEMS.net.unlock.items,
    ITEM_IDS, TOOL_IDS, STATION_IDS, PLACEABLE_IDS, BLOCK_RADII, LEGACY_ALIASES, BARREL_LOOT, BARREL_LOOT[0], FUEL_VALUE,
    I.PROGRESSION_PLAN, I.BARREL_ROLLS, repairCost('hook')]) {
    assert.ok(Object.isFrozen(o));
  }
  assert.throws(() => { 'use strict'; ITEMS.hook.recipe.cost.wood = 0; }, TypeError);
  assert.throws(() => { ITEMS.newthing = {}; }, TypeError);
  assert.throws(() => { repairCost('hook').wood = 0; }, TypeError);
  assert.equal(ITEMS.hook.recipe.cost.wood, 1);
  // non-tools and junk
  for (const k of ['wood', 'binoculars', 'bench', 'smelter', 'nope', '__proto__', 'constructor', 'toString', null, undefined, 3, {}]) {
    assert.equal(wearPerUse(k), 0, `wearPerUse ${String(k)}`);
    assert.equal(repairCost(k), null, `repairCost ${String(k)}`);
  }
  assert.equal(fuelValue('constructor'), 0);
  assert.equal(fuelValue('__proto__'), 0);
  assert.equal(wearPerUse('hook'), 2);
  assert.ok(Math.abs(wearPerUse('metalhook') - 100 / 150) < 1e-12);
  assert.equal(toolRole('metalhook'), 'hook');
  assert.equal(toolRole('hook'), 'hook');
  assert.equal(toolRole('nope'), 'nope');
  assert.equal(stationRecipeFor('smelter', 'constructor'), null);
  assert.equal(stationRecipeFor('smelter', 'wood'), null);
  // migration never hands out references into frozen data
  const m = migrateSnapshot({ slots: [{ kind: 'hook', count: 1 }], selected: 0 });
  assert.ok(!Object.isFrozen(m.slots[0]));
});

// ============================================================ barrels

test('rollBarrel: bounds hold for edge rand values', () => {
  const lootMax = {};
  const R = I.BARREL_ROLLS;
  for (const e of BARREL_LOOT) lootMax[e.kind] = (lootMax[e.kind] || 0) + e.max * (e.pool === 'basic' ? R.max - R.treasure : R.treasure);
  const check = (out) => {
    let n = 0;
    for (const [k, v] of Object.entries(out)) {
      assert.ok(Object.hasOwn(ITEMS, k), k);
      assert.ok(Number.isInteger(v) && v >= 1 && v <= lootMax[k], `${k} ${v}`);
      n += v;
    }
    assert.ok(n >= R.min && n <= R.max, `${R.min}-${R.max} items per barrel (${n})`);
  };
  for (const v of [0, 0.9999999, 1, NaN, -1, 2, Infinity, -Infinity, '0.5', null, undefined, {}]) check(rollBarrel(() => v));
  check(rollBarrel());
  check(rollBarrel('not a function'));
  const r = rng(7);
  for (let i = 0; i < 3000; i++) check(rollBarrel(r));
  // determinism
  const a = rng(42), b = rng(42);
  for (let i = 0; i < 50; i++) assert.deepEqual(rollBarrel(a), rollBarrel(b));
  // rand=0 picks the first row of each pool at its min, 1 picks the last at its max
  assert.deepEqual(rollBarrel(() => 0), { wood: 3, clay: 1 });
  assert.deepEqual(rollBarrel(() => 1), { coconut: 5, scrap: 1 });
});

test('rollBarrel: treasure materials appear at sane rates', () => {
  const r = rng(1), tot = {};
  const N = 4000;
  for (let i = 0; i < N; i++) for (const [k, v] of Object.entries(rollBarrel(r))) tot[k] = (tot[k] || 0) + v;
  for (const k of ['clay', 'stone', 'metalore', 'sand', 'seaweed', 'copperore']) assert.ok(tot[k] / N > 0.03, `${k} rate ${tot[k] / N}`);
});

test('rollBarrel: Raft-like shape, 4-6 single items with the Raft basic odds', () => {
  assert.deepEqual({ ...I.BARREL_ROLLS }, { min: 4, max: 6, treasure: 1 });
  const basic = BARREL_LOOT.filter((e) => e.pool === 'basic'), total = basic.reduce((s, e) => s + e.weight, 0);
  const pct = Object.fromEntries(basic.map((e) => [e.kind, Math.round((e.weight / total) * 1000) / 10]));
  assert.deepEqual(pct, { wood: 37.7, leaf: 18.9, plastic: 14.2, scrap: 9.4, rope: 7.1, stone: 6.1, flowerseed: 3.3, coconut: 3.3 });
  for (const e of BARREL_LOOT) assert.equal(e.max, 1, `${e.kind} one per pick`);
  const r = rng(21), sizes = { 4: 0, 5: 0, 6: 0 }, N = 6000;
  let wood = 0;
  for (let i = 0; i < N; i++) {
    const out = rollBarrel(r), n = Object.values(out).reduce((s, v) => s + v, 0);
    sizes[n]++; wood += out.wood || 0;
  }
  for (const k of [4, 5, 6]) assert.ok(sizes[k] / N > 0.28 && sizes[k] / N < 0.39, `size ${k}: ${sizes[k] / N}`);
  assert.ok(Math.abs(wood / N - 4 * 0.377) < 0.08, `planks per barrel ${wood / N}`);
});

test('rollBarrel luck: null/undefined/junk luck keeps the plain roll', () => {
  const plain = rng(5), a = rng(5), b = rng(5);
  for (let i = 0; i < 300; i++) {
    const want = rollBarrel(plain);
    assert.deepEqual(rollBarrel(a, null), want);
    assert.deepEqual(rollBarrel(b, undefined), want);
  }
  // unusable luck states never throw and roll like null
  for (const junk of [42, 'x', Object.freeze({ misses: {} }), true]) {
    assert.deepEqual(rollBarrel(rng(9), junk), rollBarrel(rng(9)));
  }
});

test('rollBarrel luck: a pity kind is guaranteed after its miss limit', () => {
  const P = I.BARREL_PITY, kinds = Object.keys(P);
  assert.ok(kinds.includes('metalore') && kinds.includes('clay') && kinds.includes('stone'));
  for (const k of kinds) assert.ok(Number.isInteger(P[k]) && P[k] >= 1, k);
  // rand = 1 always rolls the treasure filler (scrap), so only the pity can give mid-game kinds
  const luck = { misses: {}, note: 'kept' }, seen = Object.fromEntries(kinds.map((k) => [k, []]));
  for (let i = 0; i < 400; i++) {
    const out = rollBarrel(() => 1, luck);
    const got = kinds.filter((k) => out[k] > 0);
    assert.ok(got.length <= I.BARREL_ROLLS.treasure, 'one forced pick per treasure roll');
    for (const k of got) seen[k].push(i);
    for (const k of kinds) assert.equal(luck.misses[k], out[k] > 0 ? 0 : luck.misses[k], k);
  }
  assert.equal(luck.note, 'kept', 'other fields of the luck object are left alone');
  for (const k of kinds) {
    assert.ok(seen[k].length > 0, `${k} forced at least once`);
    let prev = -1;
    for (const i of seen[k]) { assert.ok(i - prev - 1 <= P[k] + kinds.length, `${k} gap ${i - prev - 1}`); prev = i; }
  }
  // one overdue kind: the very next barrel has it and its counter resets
  const one = { misses: { metalore: P.metalore } };
  const out = rollBarrel(() => 1, one);
  assert.equal(out.metalore, 1);
  assert.equal(one.misses.metalore, 0);
  assert.equal(one.misses.clay, 1, 'missing counters are created and counted');
  // a natural hit resets the counter too (rand 0 = clay)
  const c = { misses: { clay: P.clay - 1 } };
  rollBarrel(() => 0, c);
  assert.equal(c.misses.clay, 0);
  // junk counters are sanitised in place
  const j = { misses: { metalore: 'x', clay: -5, stone: Infinity } };
  rollBarrel(() => 1, j);
  for (const k of kinds) assert.ok(Number.isInteger(j.misses[k]) && j.misses[k] >= 0, `${k} ${j.misses[k]}`);
  const m = { misses: null };
  rollBarrel(() => 1, m);
  assert.equal(typeof m.misses, 'object');
});

test('rollBarrel luck: deterministic for the same rand and luck state, and real gaps stay short', () => {
  const a = rng(42), b = rng(42), la = { misses: {} }, lb = { misses: {} };
  for (let i = 0; i < 500; i++) {
    assert.deepEqual(rollBarrel(a, la), rollBarrel(b, lb));
    assert.deepEqual(la, lb);
  }
  // round-trips through JSON (the save) without changing the next roll
  const c = rng(3), d = rng(3), lc = { misses: {} };
  for (let i = 0; i < 40; i++) { rollBarrel(c, lc); rollBarrel(d); }
  const ld = JSON.parse(JSON.stringify(lc));
  for (let i = 0; i < 40; i++) assert.deepEqual(rollBarrel(rng(100 + i), lc), rollBarrel(rng(100 + i), ld));
  // with normal odds, no pity kind is ever missing for long
  const r = rng(11), luck = { misses: {} }, last = {}, worst = {};
  for (let i = 0; i < 20000; i++) {
    const out = rollBarrel(r, luck);
    for (const k of Object.keys(I.BARREL_PITY)) if (out[k]) { worst[k] = Math.max(worst[k] ?? 0, i - (last[k] ?? -1) - 1); last[k] = i; }
  }
  // Overdue kinds queue behind each other (one forced pick per barrel), so allow one wait per pity kind.
  const queue = Object.keys(I.BARREL_PITY).length;
  for (const [k, n] of Object.entries(I.BARREL_PITY)) assert.ok(worst[k] <= n + queue, `${k} worst gap ${worst[k]}`);
});

// ============================================================ migration

test('migrate: aliases, unknown kinds, durability, selected', () => {
  const m = migrateSnapshot({
    slots: [
      { kind: 'plank', count: 5 }, { kind: 'PalmLeaf', count: 3 }, { kind: 'rod', count: 1, durability: 150 },
      { kind: 'unobtainium', count: 9 }, { kind: 'hook', count: 1, durability: -20 }, { kind: 'scrap', count: 2, durability: 50 },
      { kind: 'hammer', count: 1 }, { kind: ' Nails ', count: '4' }, { kind: 'metal_hook', count: 1, durability: 'x' },
      { kind: 'toString', count: 1 }, { kind: '__proto__', count: 1 }, { kind: 'wood', count: 0 }, { kind: 'wood', count: -3 },
    ],
    selected: 6,
  });
  assertBagValid(m);
  assertRealBagAccepts(m);
  assert.deepEqual(m.slots[0], { kind: 'wood', count: 5 });
  assert.deepEqual(m.slots[1], { kind: 'leaf', count: 3 });
  assert.deepEqual(m.slots[2], { kind: 'fishingrod', count: 1, durability: 100 });
  assert.equal(m.slots[3], null);
  assert.deepEqual(m.slots[4], { kind: 'hook', count: 1, durability: 0 });
  assert.deepEqual(m.slots[5], { kind: 'scrap', count: 2 });
  assert.deepEqual(m.slots[6], { kind: 'hammer', count: 1, durability: 100 });
  assert.deepEqual(m.slots[7], { kind: 'nail', count: 4 });
  assert.deepEqual(m.slots[8], { kind: 'metalhook', count: 1, durability: 100 });
  for (let i = 9; i < SLOT_COUNT; i++) assert.equal(m.slots[i], null);
  assert.equal(m.selected, 6);
  for (const sel of [10, -1, 2.5, '3', NaN, null]) assert.equal(migrateSnapshot({ slots: [], selected: sel }).selected, 0);
  for (const sel of [8, 9]) assert.equal(migrateSnapshot({ slots: [], selected: sel }).selected, sel); // 10-slot hotbar
  for (const junk of [null, undefined, 0, 'x', [], true]) assert.equal(migrateSnapshot(junk), null);
});

test('migrate: stack splitting tops up, fills free slots, then drops excess', () => {
  const m = migrateSnapshot({ slots: [{ kind: 'wood', count: 45 }, null, { kind: 'wood', count: 7 }, { kind: 'researchtable', count: 12 }, { kind: 'hook', count: 3, durability: 40, id: 'h1' }], selected: 0 });
  assertBagValid(m);
  const total = (k) => m.slots.reduce((n, s) => n + (s && s.kind === k ? s.count : 0), 0);
  assert.equal(total('wood'), 52);
  assert.equal(total('researchtable'), 12);
  assert.deepEqual(m.slots[0], { kind: 'wood', count: 20 });
  assert.equal(m.slots[2].count, 20, 'overflow tops up the existing wood stack first');
  const hooks = m.slots.filter((s) => s && s.kind === 'hook');
  assert.equal(hooks.length, 3);
  for (const h of hooks) assert.equal(h.durability, 40);
  assert.equal(hooks.filter((h) => h.id === 'h1').length, 1, 'id is not duplicated across split stacks');
  // huge counts: bag fills completely, never throws, never exceeds stacks
  const big = migrateSnapshot({ slots: [{ kind: 'wood', count: Number.MAX_SAFE_INTEGER }, { kind: 'leaf', count: 1e300 }], selected: 0 });
  assertBagValid(big);
  assert.ok(big.slots.every((s) => s !== null));
  assert.equal(big.slots[1].kind, 'leaf');
  // entries past slot 27 are kept when there is room
  const long = new Array(40).fill(null); long[35] = { kind: 'scrap', count: 3 };
  const lm = migrateSnapshot({ slots: long, selected: 0 });
  assert.deepEqual(lm.slots[0], { kind: 'scrap', count: 3 });
});

test('migrate: duplicate ids are dropped and output is deterministic', () => {
  const src = { slots: [{ kind: 'hook', count: 1, id: 'a' }, { kind: 'hammer', count: 1, id: 'a' }, { kind: 'wood', count: 1, id: '' }, { kind: 'wood', count: 1, id: 7 }], selected: 1 };
  const a = migrateSnapshot(src), b = migrateSnapshot(JSON.parse(JSON.stringify(src)));
  assert.deepEqual(a, b);
  assertBagValid(a);
  assert.equal(a.slots[0].id, 'a');
  assert.equal(a.slots[1].id, undefined);
  assert.equal(a.slots[2].id, undefined);
  assert.equal(a.slots[3].id, undefined);
  // idempotent
  assert.deepEqual(migrateSnapshot(a), a);
  // a valid legacy Bag snapshot survives unchanged
  const bag = Bag.fromCounts({ wood: 33, rope: 4, hook: 1, sail: 2, fish: 5 });
  const snap = bag.snapshot();
  assert.deepEqual(migrateSnapshot(snap), snap);
});

const JUNK = [null, undefined, 0, -1, 1, 2.5, 1e9, -0, NaN, Infinity, -Infinity, '', 'wood', '12', 'abc', true, false, [], [1], {}, { kind: 'wood' }, () => 1, Symbol.iterator];
function junkValue(r) {
  const p = r();
  if (p < 0.3) return JUNK[Math.floor(r() * JUNK.length)];
  if (p < 0.5) return Math.floor(r() * 200) - 50;
  if (p < 0.6) return r() * 300;
  return undefined;
}
function junkKind(r) {
  const p = r();
  const pool = [...ITEM_IDS, ...Object.keys(LEGACY_ALIASES), 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'WOOD', ' rope ', 'nope', ''];
  return p < 0.85 ? pool[Math.floor(r() * pool.length)] : junkValue(r);
}
function junkSlot(r) {
  const p = r();
  if (p < 0.25) return null;
  if (p < 0.3) return junkValue(r);
  const s = { kind: junkKind(r), count: r() < 0.8 ? Math.floor(r() * 60) : junkValue(r) };
  if (r() < 0.4) s.durability = r() < 0.5 ? r() * 300 - 100 : junkValue(r);
  if (r() < 0.3) s.id = r() < 0.6 ? `id${Math.floor(r() * 5)}` : junkValue(r);
  if (r() < 0.1) s.extra = 'x';
  return s;
}

test('migrate fuzz: 2000 junk snapshots never throw and always yield Bag-valid output', () => {
  const r = rng(1234);
  for (let n = 0; n < 2000; n++) {
    let snap;
    const p = r();
    if (p < 0.05) snap = junkValue(r);
    else {
      const len = r() < 0.7 ? SLOT_COUNT : Math.floor(r() * 50);
      snap = { slots: r() < 0.95 ? Array.from({ length: len }, () => junkSlot(r)) : junkValue(r), selected: r() < 0.7 ? Math.floor(r() * 10) - 1 : junkValue(r) };
    }
    let out;
    assert.doesNotThrow(() => { out = migrateSnapshot(snap); }, `case ${n}`);
    if (out === null) { assert.ok(!snap || typeof snap !== 'object' || Array.isArray(snap)); continue; }
    assertBagValid(out);
    assertRealBagAccepts(out);
    assert.deepEqual(migrateSnapshot(out), out, `idempotent case ${n}`);
    // never creates items: per-kind totals never exceed the sanitized input totals
    if (Array.isArray(snap.slots)) {
      const outT = {};
      for (const s of out.slots) if (s) outT[s.kind] = (outT[s.kind] || 0) + s.count;
      for (const [k, v] of Object.entries(outT)) {
        let inT = 0;
        for (const s of snap.slots) {
          if (!s || typeof s !== 'object') continue;
          const kk = typeof s.kind === 'string' ? (Object.hasOwn(ITEMS, s.kind) ? s.kind : Object.hasOwn(ITEMS, s.kind.trim().toLowerCase()) ? s.kind.trim().toLowerCase() : LEGACY_ALIASES[s.kind.trim().toLowerCase()]) : null;
          const c = typeof s.count === 'symbol' ? NaN : Number(s.count);
          if (kk === k && Number.isFinite(c) && c > 0) inT += Math.floor(c);
        }
        assert.ok(v <= inT, `case ${n}: ${k} out ${v} > in ${inT}`);
      }
    }
  }
});

// ============================================================ progression with real items

test('progression: start state unlocks only start items; snapshot junk is sanitized', () => {
  const p = new Progression();
  for (const id of ITEM_IDS) assert.equal(p.isUnlocked(id), ITEMS[id].unlock.type === 'start', id);
  assert.ok(p.whyLocked('nail').length > 0);
  assert.equal(p.whyLocked('rope'), '');
  assert.equal(p.isUnlocked('constructor'), false);
  assert.equal(p.isUnlocked('__proto__'), false);
  for (const junk of [null, 5, 'x', [], { discovered: 'scrap' }, { discovered: [1, null, {}, 'toString', '__proto__', 'nope'], researched: { a: 1 }, stations: [NaN] }]) {
    const q = new Progression(junk);
    assert.deepEqual(q.snapshot(), { discovered: [], researched: [], learned: [], stations: [] }, JSON.stringify(junk));
  }
  // snapshot round-trips
  const a = new Progression();
  a.noteItems({ scrap: 2, fish: 0, nope: 3, rope: '1' });
  const b = new Progression(JSON.parse(JSON.stringify(a.snapshot())));
  assert.deepEqual(b.snapshot(), a.snapshot());
  assert.ok(b.isUnlocked('nail') && !b.isUnlocked('grill'));
});

test('progression: locked recipes are never reachable through craft()', () => {
  const p = new Progression();
  const bag = emptyChainBag();
  for (const id of ITEM_IDS) if (!ITEMS[id].recipe) bag.add(id, 20);
  for (const id of ITEM_IDS) {
    if (p.isUnlocked(id) || !ITEMS[id].recipe) continue;
    const before = JSON.stringify(bag.snapshot());
    const res = craft(bag, id, p, { near: new Set(STATION_IDS) });
    assert.equal(res.ok, false, id);
    assert.equal(res.locked, true, id);
    assert.equal(JSON.stringify(bag.snapshot()), before, `${id} changed bag`);
    assert.equal(canCraft(bag, id, p).locked, true);
  }
  // non-craftable / junk ids
  for (const id of ['wood', 'nope', 'constructor', '__proto__', null]) assert.equal(craft(bag, id, p).ok, false);
});

test('progression: station recipes need the station; research never consumes items', () => {
  const p = new Progression({ stations: ['smelter'] });
  const bag = emptyChainBag();
  bag.add('metalore', 3);
  assert.ok(p.isUnlocked('metalingot'));
  const r = canCraft(bag, 'metalingot', p);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Smelter/);
  // research
  const q = new Progression();
  bag.add('clay', 1);
  assert.equal(q.research('clay', bag).ok, false, 'no table yet');
  q.notePlaced('researchtable');
  assert.equal(q.research('stone', bag).ok, false, 'not holding stone');
  const before = JSON.stringify(bag.snapshot());
  assert.equal(q.research('clay', bag).ok, true);
  assert.equal(JSON.stringify(bag.snapshot()), before, 'research consumed items');
  assert.equal(q.research('clay', bag).ok, false, 'already researched');
  assert.equal(q.research('constructor', true).ok, false);
  assert.equal(q.research(undefined, true).ok, false);
});

test('progression: full unlock chain with the real catalogue (start -> metal hook)', () => {
  const p = new Progression();
  const bag = new ChainBag(migrateSnapshot({ slots: [{ kind: 'hook', count: 1 }], selected: 0 }));
  const give = (k, n) => { assert.equal(bag.add(k, n), 0, `bag full adding ${k}`); return p.noteItems({ [k]: n }); };
  const make = (id, opts) => {
    const res = craft(bag, id, p, opts);
    assert.ok(res.ok, `${id}: ${res.reason}`);
    return res;
  };
  const station = (id, input, n, fuelKind, fuelN) => {
    const s = new StationModel(id);
    assert.ok(bag.remove(input, n));
    assert.equal(s.insert(input, n), n);
    assert.ok(bag.remove(fuelKind, fuelN));
    assert.equal(s.addFuel(fuelKind, fuelN), fuelN);
    let done = 0;
    for (let t = 0; t < 2000 && s.input; t++) for (const e of s.tick(1)) if (e.type === 'done') done += e.count;
    assert.equal(done, n, `${id} cooked ${done}/${n}`);
    const out = s.takeOutput();
    assert.equal(bag.add(out.kind, out.count), 0);
    p.noteItems([out.kind]);
    return out;
  };

  assert.equal(p.isUnlocked('nail'), false);
  give('wood', 20); give('leaf', 20); give('plastic', 6);
  assert.ok(p.isUnlocked('rope') && !p.isUnlocked('nail'));
  const fresh = give('scrap', 20);
  assert.ok(fresh.includes('nail') && fresh.includes('lantern') && fresh.includes('crate'));
  assert.equal(p.isUnlocked('researchtable'), false, 'table needs a nail first');
  make('nail'); make('nail');
  assert.equal(bag.count('nail'), 6);
  assert.ok(p.isUnlocked('researchtable') && p.isUnlocked('net'));
  for (let i = 0; i < 8; i++) make('rope');
  make('researchtable');
  assert.equal(p.research('scrap', bag).ok, false, 'table not placed yet');
  assert.ok(bag.remove('researchtable', 1));
  p.notePlaced('researchtable');

  // fish -> grill -> bricks
  assert.equal(p.isUnlocked('grill'), false);
  give('fish', 2);
  give('wood', 20);
  make('grill');
  assert.ok(bag.remove('grill', 1));
  const placedGrill = p.notePlaced('grill');
  assert.ok(placedGrill.includes('brick') && placedGrill.includes('cookedfish'));
  const smelterCost = ITEMS.smelter.recipe.cost, hookCost = ITEMS.metalhook.recipe.cost;
  give('clay', smelterCost.brick); give('stone', smelterCost.stone);
  assert.equal(p.isUnlocked('smelter'), false);
  assert.equal(p.research('clay', bag).ok, true);
  assert.equal(p.isUnlocked('smelter'), false, 'needs stone too');
  assert.deepEqual(p.research('stone', bag).unlocked, ['smelter']);
  assert.equal(bag.count('clay'), smelterCost.brick, 'research kept the clay');
  station('grill', 'clay', smelterCost.brick, 'wood', Math.ceil(smelterCost.brick / 2));
  assert.equal(bag.count('brick'), smelterCost.brick);

  // smelter -> ingots -> bolts -> metal hook
  make('nail'); make('nail');
  give('wood', 10);
  assert.equal(canCraft(bag, 'metalingot', p, { near: new Set(['smelter']) }).locked, true, 'ingots locked before smelter placed');
  make('smelter');
  assert.ok(bag.remove('smelter', 1));
  assert.ok(p.notePlaced('smelter').includes('metalingot'));
  const ore = hookCost.metalingot + 1; // + 1 ingot for the bolt craft
  give('metalore', ore);
  station('smelter', 'metalore', ore, 'wood', ore);
  assert.equal(bag.count('metalingot'), ore);
  assert.equal(p.isUnlocked('bolt'), false);
  assert.equal(craft(bag, 'metalhook', p).locked, true);
  assert.ok(p.research('metalingot', bag).unlocked.includes('bolt'));
  make('bolt');
  assert.equal(bag.count('bolt'), 2);
  assert.equal(p.isUnlocked('metalhook'), false);
  assert.ok(p.research('bolt', bag).unlocked.includes('metalhook'));
  const before = { ingot: bag.count('metalingot'), bolt: bag.count('bolt'), rope: bag.count('rope'), wood: bag.count('wood') };
  const res = make('metalhook');
  assert.deepEqual(res.crafted, { kind: 'metalhook', count: 1 });
  assert.equal(bag.count('metalhook'), 1);
  assert.equal(bag.slots.find((s) => s && s.kind === 'metalhook').durability, 100);
  assert.deepEqual({ ingot: bag.count('metalingot'), bolt: bag.count('bolt'), rope: bag.count('rope'), wood: bag.count('wood') },
    { ingot: before.ingot - hookCost.metalingot, bolt: before.bolt - hookCost.bolt, rope: before.rope - hookCost.rope, wood: before.wood - hookCost.wood });
  assert.equal(toolRole('metalhook'), 'hook');
  // progression snapshot survives a reload mid-chain
  assert.ok(new Progression(JSON.parse(JSON.stringify(p.snapshot()))).isUnlocked('metalhook'));
  // nextGoals points at what is left
  const goals = p.nextGoals(10);
  assert.ok(goals.length > 0 && goals.every((g) => !p.isUnlocked(g)));
});

// ============================================================ station exploits (real items)

const bagTotal = (s) => (s.input?.count || 0);
test('station: insert/takeInput never duplicates and junk counts are rejected', () => {
  const s = new StationModel('smelter');
  for (const n of [NaN, -5, 0, Infinity, -Infinity, '5', null, undefined, {}, 0.9]) assert.equal(s.insert('metalore', n), 0, String(n));
  assert.equal(s.input, null);
  assert.equal(s.insert('metalore', 1e300), 20, 'clamped to stack');
  assert.equal(s.insert('metalore', 1), 0, 'full');
  assert.equal(s.insert('sand', 1), 0, 'different kind while loaded');
  for (const k of ['wood', 'hook', 'nope', 'constructor', '__proto__', 'toString', null, 'metalingot']) assert.equal(new StationModel('smelter').insert(k, 1), 0, String(k));
  assert.equal(new StationModel('grill').insert('metalore', 1), 0, 'grill does not smelt');
  const took = s.takeInput();
  assert.deepEqual(took, { kind: 'metalore', count: 20 });
  assert.equal(s.takeInput(), null, 'second take gives nothing');
  assert.equal(bagTotal(s), 0);
  // partial cook then take back: no free output, progress is dropped
  assert.equal(s.insert('metalore', 2), 2);
  s.addFuel('wood', 5);
  s.tick(29);
  assert.equal(s.output, null);
  assert.deepEqual(s.takeInput(), { kind: 'metalore', count: 2 });
  s.insert('metalore', 1);
  s.tick(2);
  assert.equal(s.output, null, 'progress did not carry over to re-inserted input');
});

test('station: fuel cannot overfill and junk fuel is ignored', () => {
  const s = new StationModel('smelter');
  for (const n of [NaN, -1, 0, Infinity, '3', null]) assert.equal(s.addFuel('wood', n), 0);
  for (const k of ['plastic', 'metalore', 'constructor', '__proto__', 'toString', 'hook']) assert.equal(s.addFuel(k, 5), 0, k);
  assert.equal(s.addFuel('wood', 1e300), FUEL_CAP);
  assert.equal(s.fuelUnits, FUEL_CAP);
  assert.equal(s.addFuel('leaf', 1), 0);
  const t = new StationModel('smelter');
  t.addFuel('wood', 9);
  assert.equal(t.addFuel('leaf', 5), 2, 'leaves top up exactly to the cap');
  assert.equal(t.fuelUnits, FUEL_CAP);
  assert.equal(t.addFuel('wood', 1), 0);
});

test('station: takeOutput while cooking and bad dt values', () => {
  const s = new StationModel('smelter');
  s.insert('metalore', 3); s.addFuel('wood', 10);
  s.tick(30);
  assert.deepEqual(s.output, { kind: 'metalingot', count: 1 });
  s.tick(15);
  assert.ok(s.cooking);
  const o = s.takeOutput();
  assert.deepEqual(o, { kind: 'metalingot', count: 1 });
  assert.equal(s.takeOutput(), null, 'no second output');
  assert.ok(s.cooking, 'still cooking after taking output');
  const snap = JSON.stringify(s.snapshot());
  for (const dt of [NaN, -1, -Infinity, Infinity, 0, '10', null, undefined, {}]) {
    assert.deepEqual(s.tick(dt).filter((e) => e.type === 'done'), [], String(dt));
    assert.equal(JSON.stringify(s.snapshot()), snap, `dt ${String(dt)} changed state`);
  }
  s.tick(1e12);
  assert.deepEqual(s.output, { kind: 'metalingot', count: 2 }, 'huge dt cooks only what input+fuel allow');
  assert.equal(s.input, null);
  assert.ok(s.fuelUnits >= 0 && s.fuelUnits <= FUEL_CAP);
  // fuel is conserved: 3 ingots cost exactly 3 units
  assert.ok(Math.abs(s.fuelUnits - 7) < 1e-6, `fuel left ${s.fuelUnits}`);
});

test('station: many small ticks match one big tick (no drift, no free items)', () => {
  const a = new StationModel('smelter'), b = new StationModel('smelter');
  for (const s of [a, b]) { s.insert('sand', 20); s.addFuel('leaf', 13); }
  a.tick(10000);
  for (let i = 0; i < 70000; i++) b.tick(1 / 60);
  assert.deepEqual(a.output, b.output);
  assert.equal(a.output.count, 6, '6.5 fuel units / 1 per glass = 6 glass');
  assert.deepEqual(a.input, b.input);
  assert.ok(Math.abs(a.fuelUnits - b.fuelUnits) < 1e-6);
});

test('station: restore rejects junk, prototype keys and foreign outputs', () => {
  const junk = [null, 1, 'x', [], { input: { kind: 'constructor', count: 3 }, output: { kind: '__proto__', count: 2 } },
    { output: { kind: 'toString', count: 1 } }, { output: { kind: 'metalhook', count: 1 } }, { output: { kind: 'cookedfish', count: 1 } },
    { input: { kind: 'clay', count: 2 } }, { input: { kind: 'metalore', count: -1 }, fuel: -5, progress: NaN },
    { input: { kind: 'metalore', count: 1 }, fuel: Infinity, progress: Infinity }];
  for (const j of junk) {
    const s = new StationModel('smelter', j);
    const snap = s.snapshot();
    assert.ok(snap.output === null, `output from ${JSON.stringify(j)}: ${JSON.stringify(snap.output)}`);
    assert.ok(snap.input === null || snap.input.kind === 'metalore');
    assert.ok(snap.fuel >= 0 && snap.fuel <= FUEL_CAP && Number.isFinite(snap.fuel));
    assert.ok(Number.isFinite(snap.progress) && snap.progress >= 0);
  }
  const g = new StationModel('grill', { output: { kind: 'cookedfish', count: 99 }, input: { kind: 'fish', count: 3 }, fuel: 2 });
  assert.deepEqual(g.output, { kind: 'cookedfish', count: 10 });
  const s = new StationModel('smelter', { input: { kind: 'metalore', count: 5 }, output: { kind: 'metalingot', count: 3 }, fuel: 4, progress: 12 });
  assert.deepEqual(new StationModel('smelter', JSON.parse(JSON.stringify(s.snapshot()))).snapshot(), s.snapshot());
});

// ---------- progression-hooks (node, stub game context) ----------
const H = await import(new URL('progression-hooks.js', base));
function fakeStorage() {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
  return m;
}
function fakeGame({ world, host = new Bag({ slots: Array(SLOT_COUNT).fill(null), selected: 0 }), guest = new Bag({ slots: Array(SLOT_COUNT).fill(null), selected: 0 }) } = {}) {
  world ??= { tiles: [[0, 0], [1, 0], [0, 1]], decor: [], items: [], collected: 0 };
  const bags = { host, guest };
  return { world, bags, ctx: { T: null, role: () => 'solo', ready: () => false, running: () => false, world: () => world, bag: (a) => bags[a],
    localBag: () => bags.host, action() {}, emit() {}, notice() {}, pose: () => ({ x: 50, z: 50, yaw: 0 }) } };
}

test('hooks: an old raft save keeps every legacy recipe; a fresh raft does not and is only judged once', () => {
  fakeStorage();
  const old = fakeGame({ world: { tiles: [[0, 0]], decor: [{ type: 'lantern', x: 0, z: 0 }], items: [], collected: 30 } });
  const a = H.attachProgression(old.ctx);
  for (const id of ['fishingrod', 'sail', 'lantern', 'net', 'crate']) assert.ok(a.progression('host').isUnlocked(id), id);
  assert.equal(a.apply({ kind: 'craft', recipe: 'lantern' }, 'host'), false, 'craft not blocked');
  a.dispose();

  fakeStorage();
  const fresh = fakeGame();
  const b = H.attachProgression(fresh.ctx);
  assert.equal(b.progression('host').isUnlocked('lantern'), false);
  assert.equal(b.apply({ kind: 'craft', recipe: 'lantern' }, 'host'), true, 'locked craft blocked');
  b.dispose();
  fresh.world.collected = 5; // later sessions of a new raft are not grandfathered
  const c = H.attachProgression(fresh.ctx);
  assert.equal(c.progression('host').isUnlocked('lantern'), false);
  c.dispose();
});

test('hooks: hot reload hands over live station contents (no loss, no duplication)', () => {
  const store = fakeStorage();
  const g = fakeGame({ world: { tiles: [[0, 0]], decor: [{ type: 'smelter', x: 0, z: 0 }], items: [], collected: 1 } });
  g.bags.host.add('metalore', 5);
  const a = H.attachProgression(g.ctx);
  a.tick(0.016);
  a.apply({ kind: 'prog:insert', key: '0,0', item: 'metalore', n: 99 }, 'host'); // more than owned
  assert.equal(g.bags.host.count('metalore'), 0);
  // live.js: capture old -> mount new -> dispose old, all before the old autosave runs
  const b = H.attachProgression(g.ctx);
  a.dispose();
  b.tick(0.016);
  assert.equal(b.debug.state().stations['0,0'].input?.count, 5, 'new engine sees the inserted ore');
  b.save();
  assert.equal(JSON.parse(store.get(H.PROGRESSION_KEY)).stations['0,0'].input.count, 5);
  b.dispose();
});

test('hooks: prog take with a full bag keeps the output; partial take returns the rest', () => {
  fakeStorage();
  const g = fakeGame({ world: { tiles: [[0, 0]], decor: [{ type: 'smelter', x: 0, z: 0 }], items: [], collected: 1 } });
  const a = H.attachProgression(g.ctx);
  a.tick(0.016);
  const st = { station: 'smelter', output: { kind: 'metalingot', count: 15 } };
  a.dispose();
  globalThis.localStorage.setItem(H.PROGRESSION_KEY, JSON.stringify({ v: 1, host: {}, guest: {}, stations: { '0,0': st } }));
  for (let i = 0; i < SLOT_COUNT; i++) g.bags.guest.add('wood', 20);
  g.bags.guest.remove('wood', 20); assert.equal(g.bags.guest.add('metalingot', 10), 0); // one slot with room for 10
  const b = H.attachProgression(g.ctx);
  b.tick(0.016);
  b.apply({ kind: 'prog:take', key: '0,0' }, 'guest');
  assert.equal(g.bags.guest.count('metalingot') + (b.debug.state().stations['0,0'].output?.count ?? 0), 25);
  b.apply({ kind: 'prog:take', key: '0,0' }, 'guest');
  assert.equal(g.bags.guest.count('metalingot') + (b.debug.state().stations['0,0'].output?.count ?? 0), 25);
  b.dispose();
});
