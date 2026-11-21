// Rain barrel and sprinkler (docs/specs/rain-sprinkler.md). Pure logic: no DOM, no THREE,
// no clocks or randomness. State lives in world.collectors / world.sprinklers, keyed "x,z".
//   collectors[key] = {w:0..BARREL_CAP cups, f:0..TENTHS_PER_CUP-1 tenths of rain-seconds}
//   sprinklers[key] = {w:0..SPRINKLER_CAP tank units, s:0..SPRAY_SECONDS visual spray seconds}
// Missing entry = empty; all-zero entries are deleted; entries off their decor are pruned.
import { swapOne, plantStage, tileKey } from './watering.js?build=v3-survival-ae77fa84ac2b';

export const BARREL_CAP = 4, SPRINKLER_CAP = 3, TENTHS_PER_CUP = 300, DEW_TENTHS = 1, SPRAY_SECONDS = 3, MAX_TICK = 60;
export const RAIN_ACTIONS = Object.freeze(['takeRain', 'fillSprinkler']);

const KEY_RE = /^-?\d+,-?\d+$/;
const TEXT = Object.freeze({
  takeRain:'+ 1 cup of rain water', fillSprinkler:'The sprinkler tank gurgles', empty:'The barrel is empty',
  tankfull:'The sprinkler is full', full:'Your bag is full', nocup:'You need a cup', notarget:'Nothing to use that on',
  freshonlySprinkler:'Fresh water only', freshonlyBarrel:'Use an empty cup',
});
const NEIGHBOURS = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]]);

const isPlain = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const intField = (v, hi) => (Number.isInteger(v) ? Math.min(hi, Math.max(0, v)) : 0); // non-int -> dropped (0)

function decorTypes(decor) {
  const m = new Map();
  if (Array.isArray(decor)) for (const d of decor) if (d && Number.isInteger(d.x) && Number.isInteger(d.z) && typeof d.type === 'string') m.set(tileKey(d.x, d.z), d.type);
  return m;
}
const keysOf = (types, want) => { const out = []; for (const [k, t] of types) if (t === want) out.push(k); return out.sort(); };

function cleanCollector(e) {
  if (!isPlain(e)) return null;
  const w = intField(e.w, BARREL_CAP), f = w >= BARREL_CAP ? 0 : intField(e.f, TENTHS_PER_CUP - 1);
  return w || f ? {w, f} : null;
}
function cleanSprinkler(e) {
  if (!isPlain(e)) return null;
  const w = intField(e.w, SPRINKLER_CAP), s = intField(e.s, SPRAY_SECONDS);
  return w || s ? {w, s} : null;
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

/** Validates v.collectors / v.sprinklers against `decor`. Missing/null/array -> {}. */
export function cleanRain(v, decor) {
  const types = decorTypes(decor), src = isPlain(v) ? v : {};
  return {collectors:cleanMap(src.collectors, types, 'rainbarrel', cleanCollector), sprinklers:cleanMap(src.sprinklers, types, 'sprinkler', cleanSprinkler)};
}

export function copyRain(w) {
  const out = {collectors:{}, sprinklers:{}};
  if (!isPlain(w)) return out;
  for (const m of ['collectors', 'sprinklers']) if (isPlain(w[m])) for (const k of Object.keys(w[m])) if (isPlain(w[m][k])) out[m][k] = {...w[m][k]};
  return out;
}

function prune(world) {
  const c = cleanRain(world, world.decor);
  world.collectors = c.collectors; world.sprinklers = c.sprinklers;
  if (!isPlain(world.garden)) world.garden = {};
}
const tidy = (map, k) => { const e = map[k]; if (e && !(e.w || e.f || e.s)) delete map[k]; };

// A sprinkler's water: its own tank first, else a neighbouring rain barrel (NEIGHBOURS order).
function waterSource(world, types, x, z) {
  const k = tileKey(x, z);
  if (world.sprinklers?.[k]?.w >= 1) return [world.sprinklers, k];
  for (const [dx, dz] of NEIGHBOURS) {
    const nk = tileKey(x + dx, z + dz);
    if (types.get(nk) === 'rainbarrel' && world.collectors?.[nk]?.w >= 1) return [world.collectors, nk];
  }
  return null;
}
const hasWater = (world, types, x, z) => !!waterSource(world, types, x, z);
/** Spends one unit of the sprinkler at (x, z)'s water and starts its spray. -> false when it has none. */
function useWater(world, types, x, z) {
  const src = waterSource(world, types, x, z); if (!src) return false;
  src[0][src[1]].w -= 1; tidy(src[0], src[1]);
  const k = tileKey(x, z), sp = world.sprinklers[k] ?? (world.sprinklers[k] = {w:0, s:0});
  sp.s = SPRAY_SECONDS;
  return true;
}

/**
 * Sprinklers serving other decor (crop plots, crops.js): for each sprinkler with water, `pick(keys)` gets the
 * sorted "x,z" keys of the 8 tiles around it and returns one of them to water (or null); one unit is then spent
 * and `water(key)` is called. Host only, after sprinkle() in the same second. -> keys watered.
 */
export function sprinkleOther(world, pick, water) {
  if (!isPlain(world.collectors)) world.collectors = {};
  if (!isPlain(world.sprinklers)) world.sprinklers = {};
  const types = decorTypes(world.decor), out = [];
  for (const k of keysOf(types, 'sprinkler')) {
    const [x, z] = k.split(',').map(Number);
    if (!hasWater(world, types, x, z)) continue;
    const around = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) around.push(tileKey(x + dx, z + dz));
    around.sort();
    const key = pick(around); if (!key) continue;
    useWater(world, types, x, z); water(key); out.push(key);
  }
  return out;
}

/** One sprinkler pass: each sprinkler waters at most one dry, unripe neighbouring palm. -> palm keys watered. */
export function sprinkle(world) {
  if (!isPlain(world.collectors)) world.collectors = {};
  if (!isPlain(world.sprinklers)) world.sprinklers = {};
  if (!isPlain(world.garden)) world.garden = {};
  const types = decorTypes(world.decor), garden = world.garden, watered = [];
  for (const k of keysOf(types, 'sprinkler')) {
    const [x, z] = k.split(',').map(Number);
    if (!hasWater(world, types, x, z)) continue;
    const palms = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const pk = tileKey(x + dx, z + dz);
      if (types.get(pk) === 'palm') palms.push(pk);
    }
    palms.sort();
    const pk = palms.find(p => plantStage(garden[p]) < 2 && garden[p]?.water !== 1);
    if (!pk) continue;
    garden[pk] = {water:1, grow:garden[pk]?.grow ?? 0};
    useWater(world, types, x, z);
    watered.push(pk);
  }
  return watered;
}

/** Host only. Advances whole seconds (floored, clamped 0..MAX_TICK). rain: 0..1, non-finite = 0. */
export function tickRain(world, dt, rain) {
  prune(world);
  const out = {filled:[], watered:[]};
  const secs = Math.min(MAX_TICK, Math.max(0, Math.floor(Number.isFinite(dt) ? dt : 0)));
  const r = Number.isFinite(rain) ? Math.min(1, Math.max(0, rain)) : 0, add = Math.max(DEW_TENTHS, Math.round(r * 10));
  const barrels = keysOf(decorTypes(world.decor), 'rainbarrel');
  for (let i = 0; i < secs; i++) {
    for (const k of barrels) {
      const e = world.collectors[k] ?? {w:0, f:0};
      if (e.w >= BARREL_CAP) continue;
      e.f += add;
      while (e.f >= TENTHS_PER_CUP && e.w < BARREL_CAP) { e.f -= TENTHS_PER_CUP; e.w += 1; }
      if (e.w >= BARREL_CAP) { e.f = 0; out.filled.push(k); }
      world.collectors[k] = e;
    }
    for (const k of Object.keys(world.sprinklers)) { const e = world.sprinklers[k]; if (e.s > 0) e.s -= 1; tidy(world.sprinklers, k); }
    out.watered.push(...sprinkle(world));
  }
  return out;
}

// ---------------------------------------------------------------- actions

const fail = (reason, text = TEXT[reason]) => ({ok:false, reason, text});
const okLoot = (text) => ({ok:true, kind:'loot', text});
const decorAt = (world, key, type) => Array.isArray(world.decor) && world.decor.some(d => d && d.type === type && tileKey(d.x, d.z) === key);
const selectedKind = (bag) => bag.slots[bag.selectedIndex]?.kind ?? null;

export function takeRain(world, key, bag) {
  if (!decorAt(world, key, 'rainbarrel')) return fail('notarget');
  if (!isPlain(world.collectors)) world.collectors = {};
  const e = world.collectors[key];
  if (!e || !(e.w >= 1)) return fail('empty');
  const sel = selectedKind(bag);
  if (sel === 'saltcup' || sel === 'freshcup') return fail('freshonly', TEXT.freshonlyBarrel);
  if (bag.count('cup') < 1) return bag.count('saltcup') || bag.count('freshcup') ? fail('freshonly', TEXT.freshonlyBarrel) : fail('nocup');
  if (!swapOne(bag, 'cup', 'freshcup')) return fail('full');
  e.w -= 1;
  tidy(world.collectors, key);
  return okLoot(TEXT.takeRain);
}

export function fillSprinkler(world, key, bag) {
  if (!decorAt(world, key, 'sprinkler')) return fail('notarget');
  if (!isPlain(world.sprinklers)) world.sprinklers = {};
  const e = world.sprinklers[key];
  if (e && e.w >= SPRINKLER_CAP) return fail('tankfull');
  const sel = selectedKind(bag);
  if (sel === 'saltcup' || (bag.count('freshcup') < 1 && bag.count('saltcup') > 0)) return fail('freshonly', TEXT.freshonlySprinkler);
  if (bag.count('freshcup') < 1) return fail('nocup');
  if (!swapOne(bag, 'freshcup', 'cup')) return fail('full');
  if (e) e.w += 1; else world.sprinklers[key] = {w:1, s:0};
  return okLoot(TEXT.fillSprinkler);
}

// ---------------------------------------------------------------- prompts

const noop = (t) => ({prompt:t, click:null, e:null, why:t});

/** Prompt + actions for aiming at a barrel / sprinkler. d = {key, type, x, z}; kind = held item kind. */
export function rainTarget(world, d, kind, raining) {
  const at = {x:d.x, z:d.z}, key = d.key ?? tileKey(d.x, d.z);
  if (d.type === 'rainbarrel') {
    const n = world.collectors?.[key]?.w ?? 0;
    if (n >= 1) {
      if (kind === 'cup') return {prompt:`<kbd>E</kbd>Fill cup (${n}/${BARREL_CAP})`, click:{kind:'takeRain', ...at}, e:{kind:'takeRain', ...at}, why:null};
      if (kind === 'saltcup' || kind === 'freshcup') return noop(`Rain barrel: ${n}/${BARREL_CAP} · needs an empty cup`);
      return noop(`Rain barrel: ${n}/${BARREL_CAP} cups · hold a cup`);
    }
    return noop(raining ? 'Rain barrel: filling in the rain…' : 'Rain barrel: empty · fills when it rains');
  }
  if (d.type === 'sprinkler') {
    const n = world.sprinklers?.[key]?.w ?? 0;
    if (n < SPRINKLER_CAP && kind === 'freshcup') return {prompt:`<kbd>E</kbd>Fill sprinkler (${n}/${SPRINKLER_CAP})`, click:{kind:'fillSprinkler', ...at}, e:{kind:'fillSprinkler', ...at}, why:null};
    if (n >= SPRINKLER_CAP) return noop(`Sprinkler: full (${SPRINKLER_CAP}/${SPRINKLER_CAP})`);
    const types = decorTypes(world.decor);
    const fed = NEIGHBOURS.some(([dx, dz]) => { const k = tileKey(d.x + dx, d.z + dz); return types.get(k) === 'rainbarrel' && world.collectors?.[k]?.w >= 1; });
    return noop(fed ? `Sprinkler: ${n}/${SPRINKLER_CAP} · drawing from the rain barrel` : `Sprinkler: ${n}/${SPRINKLER_CAP} · add fresh water`);
  }
  return null;
}
