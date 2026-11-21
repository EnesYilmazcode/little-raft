// Water purifier, cups and palm-planter watering. Pure logic: no DOM, no THREE,
// no imports, no clocks or randomness (harvest takes an injected rng).
// State lives in world.garden / world.purifiers, keyed "x,z" (tile ints).

export const PURIFY_SECONDS = 15, GROW_SECONDS = 90, STAGE_SECONDS = 45, MAX_TICK = 60;
export const FILL_REACH = 6, USE_REACH = 3, HOST_SLACK = 2; // metres (horizontal)
export const HARVEST = Object.freeze({leaf:2, coconut:1}) /* [juicer] */, BONUS = Object.freeze({wood:1}), BONUS_CHANCE = .25;
export const WATER_ACTIONS = Object.freeze(['fillCup', 'loadPurifier', 'takeWater', 'waterPlant', 'harvestPlant']);
export const tileKey = (x, z) => x + ',' + z;

const KEY_RE = /^-?\d+,-?\d+$/;
const TEXT = Object.freeze({
  fillCup:'Scooped a cup of sea water', loadPurifier:'The purifier is bubbling away', takeWater:'+ 1 cup of fresh water',
  water:'The planter drinks it up', harvest:'+ 2 palm leaf · 1 coconut', harvestBonus:'+ 2 palm leaf · 1 coconut · 1 wood', // [juicer]
  full:'Your bag is full', nocup:'You need a cup', busy:'It is already purifying', notready:'Almost ready…',
  watered:'Already watered', ripe:'Harvest it first', notripe:'Still growing', notarget:'Nothing to use that on',
});

const isPlain = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const intIn = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : null);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function decorTypes(decor) {
  const m = new Map();
  if (Array.isArray(decor)) for (const d of decor) if (d && Number.isInteger(d.x) && Number.isInteger(d.z) && typeof d.type === 'string') m.set(tileKey(d.x, d.z), d.type);
  return m;
}

function cleanGardenEntry(e) {
  if (!isPlain(e)) return null;
  let water = e.water === 1 || e.water === true ? 1 : 0;
  let grow = intIn(e.grow, 0, GROW_SECONDS);
  if (grow === null) grow = 0;
  if (grow >= GROW_SECONDS) water = 0;
  if (!water && !grow) return null;
  return {water, grow};
}

function cleanPurifierEntry(e) {
  if (!isPlain(e)) return null;
  const ready = e.ready === 1 || e.ready === true ? 1 : 0;
  let t = intIn(e.t, 0, PURIFY_SECONDS);
  if (t === null) t = 0;
  if (ready) t = PURIFY_SECONDS;
  return {t, ready};
}

function cleanMap(src, types, want, entry) {
  const out = {};
  if (!isPlain(src)) return out;
  for (const k of Object.keys(src)) {
    if (!KEY_RE.test(k) || types.get(k) !== want) continue;
    const e = entry(src[k]);
    if (e) out[k] = e;
  }
  return out;
}

/**
 * Validates/prunes v.garden and v.purifiers against `decor`. Missing/invalid -> {}.
 * opts.seedMissing: a save with NO garden field at all (pre-watering save) gets every
 * existing palm seeded ripe, so old palms keep full size and give a welcome harvest.
 */
export function cleanWatering(v, decor, opts = {}) {
  const types = decorTypes(decor), src = isPlain(v) ? v : {};
  let garden = src.garden;
  if (opts && opts.seedMissing && isPlain(v) && !hasOwn(v, 'garden')) {
    garden = {};
    for (const [k, t] of types) if (t === 'palm') garden[k] = {water:0, grow:GROW_SECONDS};
  }
  return {
    garden:cleanMap(garden, types, 'palm', cleanGardenEntry),
    purifiers:cleanMap(src.purifiers, types, 'purifier', cleanPurifierEntry),
  };
}

export function copyWatering(w) {
  const out = {garden:{}, purifiers:{}};
  if (!isPlain(w)) return out;
  if (isPlain(w.garden)) for (const k of Object.keys(w.garden)) if (isPlain(w.garden[k])) out.garden[k] = {...w.garden[k]};
  if (isPlain(w.purifiers)) for (const k of Object.keys(w.purifiers)) if (isPlain(w.purifiers[k])) out.purifiers[k] = {...w.purifiers[k]};
  return out;
}

export function plantStage(entry) {
  const g = entry && typeof entry.grow === 'number' ? entry.grow : 0;
  return g >= GROW_SECONDS ? 2 : g >= STAGE_SECONDS ? 1 : 0;
}

function prune(world) {
  const c = cleanWatering(world, world.decor);
  world.garden = c.garden; world.purifiers = c.purifiers;
}

/** Advances timers by whole seconds (floored, clamped 0..MAX_TICK). Host only. */
export function tick(world, dt) {
  prune(world);
  const s = Math.min(MAX_TICK, Math.max(0, Math.floor(Number.isFinite(dt) ? dt : 0)));
  const out = {grown:[], ripe:[], done:[]};
  if (!s) return out;
  for (const k of Object.keys(world.garden)) {
    const e = world.garden[k];
    if (e.water !== 1 || e.grow >= GROW_SECONDS) continue;
    const before = plantStage(e);
    e.grow = Math.min(GROW_SECONDS, e.grow + s);
    if (e.grow >= GROW_SECONDS) { e.water = 0; out.ripe.push(k); }
    if (plantStage(e) !== before) out.grown.push(k);
  }
  for (const k of Object.keys(world.purifiers)) {
    const e = world.purifiers[k];
    if (e.ready) continue;
    e.t = Math.min(PURIFY_SECONDS, e.t + s);
    if (e.t >= PURIFY_SECONDS) { e.ready = 1; out.done.push(k); }
  }
  return out;
}

// ---------------------------------------------------------------- bag helpers

const fail = (reason) => ({ok:false, reason, text:TEXT[reason]});
const okLoot = (text) => ({ok:true, kind:'loot', text});
const okBuild = (text) => ({ok:true, kind:'build', text});

function commit(bag, s) { for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = s.slots[i]; }

/** Swap one `from` for one `to`, keeping a single held item in the same slot. Atomic. */
export function swapOne(bag, from, to) {
  const sel = bag.slots[bag.selectedIndex];
  if (sel && sel.kind === from && sel.count === 1) { bag.slots[bag.selectedIndex] = {kind:to, count:1}; return true; }
  const s = new bag.constructor(bag.snapshot());
  if (!s.remove(from, 1) || s.add(to, 1) !== 0) return false;
  commit(bag, s);
  return true;
}

/** Applies removals then gains on a scratch copy; commits only when everything fits. */
function trade(bag, take, give) {
  const s = new bag.constructor(bag.snapshot());
  for (const [k, n] of Object.entries(take)) if (!s.remove(k, n)) return false;
  for (const [k, n] of Object.entries(give)) if (s.add(k, n) !== 0) return false;
  commit(bag, s);
  return true;
}

const decorAt = (world, key, type) => Array.isArray(world.decor) && world.decor.some(d => d && d.type === type && tileKey(d.x, d.z) === key);
const ensureMaps = (world) => { if (!isPlain(world.garden)) world.garden = {}; if (!isPlain(world.purifiers)) world.purifiers = {}; };

// ---------------------------------------------------------------- actions

export function fillCup(world, bag) {
  if (bag.count('cup') < 1) return fail('nocup');
  if (!swapOne(bag, 'cup', 'saltcup')) return fail('full');
  return okLoot(TEXT.fillCup);
}

export function loadPurifier(world, key, bag) {
  ensureMaps(world);
  if (!decorAt(world, key, 'purifier')) return fail('notarget');
  if (hasOwn(world.purifiers, key)) return fail('busy');
  if (bag.count('saltcup') < 1) return fail('nocup');
  if (!bag.remove('saltcup', 1)) return fail('nocup');
  world.purifiers[key] = {t:0, ready:0};
  return okBuild(TEXT.loadPurifier);
}

export function takeWater(world, key, bag) {
  ensureMaps(world);
  if (!decorAt(world, key, 'purifier')) return fail('notarget');
  const e = world.purifiers[key];
  if (!e || !e.ready) return fail('notready');
  if (!trade(bag, {}, {freshcup:1})) return fail('full');
  delete world.purifiers[key];
  return okLoot(TEXT.takeWater);
}

export function water(world, key, bag) {
  ensureMaps(world);
  if (!decorAt(world, key, 'palm')) return fail('notarget');
  const e = world.garden[key];
  if (plantStage(e) === 2) return fail('ripe');
  if (e && e.water === 1) return fail('watered');
  if (bag.count('freshcup') < 1) return fail('nocup');
  if (!swapOne(bag, 'freshcup', 'cup')) return fail('full');
  world.garden[key] = {water:1, grow:e ? e.grow : 0};
  return okBuild(TEXT.water);
}

export function harvest(world, key, bag, rng = Math.random) {
  ensureMaps(world);
  if (!decorAt(world, key, 'palm')) return fail('notarget');
  if (plantStage(world.garden[key]) !== 2) return fail('notripe');
  const bonus = rng() < BONUS_CHANCE;
  if (!trade(bag, {}, bonus ? {...HARVEST, ...BONUS} : HARVEST)) return fail('full');
  delete world.garden[key];
  return okLoot(bonus ? TEXT.harvestBonus : TEXT.harvest);
}
