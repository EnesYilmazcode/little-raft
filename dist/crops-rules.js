// Garden Bed crops: pure rules (see docs/specs/crops.md). No DOM, THREE, clock or rng.
// Cozy rules: crops never wilt or die; a dry bed pauses and keeps its progress; every harvest gives the seed back.
// Slice world.ext.crops = {v:1, r:rev, s:session, b:{"x,z":{c, g, w}}}: c crop id, g watered seconds grown (0..T),
// w seconds of water left (0..WET_MAX). An empty bed has no key.
import { FLOWER_RANGE } from './bees.js?build=v3-survival-ae77fa84ac2b';
import { swapOne } from './watering.js?build=v3-survival-ae77fa84ac2b';

export const WET_MAX = 60, MAX_TICK = 60, REACH = 3, HOST_SLACK = 2, MAX_BEDS = 400;
export const CROPS = Object.freeze({
  flax:  Object.freeze({ id: 'flax',  name: 'Sea Flax',    seed: 'flaxseed',  T: 120, produce: 'fibre' }),
  bell:  Object.freeze({ id: 'bell',  name: 'Blushbell',   seed: 'bellseed',  T: 150, produce: 'petal' }),
  tuber: Object.freeze({ id: 'tuber', name: 'Sweet Tuber', seed: 'tuberseed', T: 180, produce: 'tuber' }),
});
export const CROP_IDS = Object.freeze(Object.keys(CROPS));
export const SEED_TO_CROP = Object.freeze(Object.fromEntries(CROP_IDS.map(id => [CROPS[id].seed, id])));
export const NAMES = Object.freeze({ fibre: 'flax fibre', petal: 'blushbell petals', tuber: 'sweet tuber', flaxseed: 'sea flax seed', bellseed: 'blushbell seed', tuberseed: 'sweet tuber eye' });
export const OLD_HOST = 'Your friend’s raft doesn’t grow crops yet';
export const TEXT = Object.freeze({
  full: 'Your bag is full', notarget: 'Nothing to tend here', occupied: 'Something is already growing here',
  noseed: 'You need a crop seed', nocup: 'You need a cup of fresh water', notdry: 'The soil is still wet',
  notripe: 'Still growing', ripe: 'Harvest it first', empty: 'Garden Bed: plant a crop seed',
  planted: 'Planted', watered: 'The soil soaks it up',
});

const KEY_RE = /^-?\d+,-?\d+$/;
const isInt = Number.isInteger;
const isPlain = o => !!o && typeof o === 'object' && !Array.isArray(o);
export const tileKey = (x, z) => x + ',' + z;
const isKey = k => typeof k === 'string' && k.length <= 24 && KEY_RE.test(k) && (() => { const [x, z] = k.split(',').map(Number); return tileKey(x, z) === k; })();
const clampInt = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : lo);

/** Growth stage: 0 sprout, 1 leafy, 2 ripe. */
export function stage(e) {
  const c = e && CROPS[e.c]; if (!c) return 0;
  return e.g >= c.T ? 2 : e.g >= c.T / 2 ? 1 : 0;
}
export const isRipe = e => stage(e) === 2;

export function bedKeys(decor) {
  const out = new Set();
  if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'gardenbed' && isInt(d.x) && isInt(d.z)) out.add(tileKey(d.x, d.z));
  return out;
}
export const hasBed = (decor, x, z) => { if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'gardenbed' && d.x === x && d.z === z) return true; return false; };

/** One bed entry, or null when it is junk. g/w are clamped to whole seconds. */
function cleanEntry(e) {
  if (!isPlain(e) || typeof e.c !== 'string' || !Object.prototype.hasOwnProperty.call(CROPS, e.c)) return null;
  return { c: e.c, g: clampInt(e.g, 0, CROPS[e.c].T), w: clampInt(e.w, 0, WET_MAX) };
}

/** Validated slice. Junk -> defaults; keys whose decor is not a gardenbed, unknown crops and junk entries dropped. */
export function cleanCrops(v, decor) {
  const out = { v: 1, r: 0, s: '', b: {} };
  if (!isPlain(v)) return out;
  if (typeof v.s === 'string' && v.s.length <= 32) out.s = v.s;
  if (isInt(v.r) && v.r >= 0) out.r = v.r;
  if (!isPlain(v.b)) return out;
  const beds = bedKeys(decor);
  let n = 0;
  for (const k of Object.keys(v.b)) {
    if (n >= MAX_BEDS) break;
    if (!isKey(k) || !beds.has(k)) continue;
    const e = cleanEntry(v.b[k]); if (!e) continue;
    out.b[k] = e; n++;
  }
  return out;
}

/**
 * Host tick: whole seconds (dt floored, clamped 0..MAX_TICK). Prunes beds whose decor is gone (no refund).
 * While raining every bed is held at w = WET_MAX. g grows only while w > 0, and each grown second drains w.
 * A ripe bed stops: g clamps at T and w no longer drains. Bumps st.r only when something changed.
 * Returns the keys that turned ripe this tick.
 */
export function tickCrops(st, decor, dt, raining = false) {
  const ripe = [];
  const beds = bedKeys(decor);
  let changed = false;
  for (const k of Object.keys(st.b)) if (!beds.has(k)) { delete st.b[k]; changed = true; }
  const n = typeof dt === 'number' && Number.isFinite(dt) ? Math.min(MAX_TICK, Math.max(0, Math.floor(dt))) : 0;
  if (n > 0) for (const k of Object.keys(st.b)) {
    const e = st.b[k], T = CROPS[e.c].T, g0 = e.g, w0 = e.w;
    if (raining) e.w = WET_MAX;
    if (e.g < T) {
      const s = raining ? Math.min(n, T - e.g) : Math.min(n, e.w, T - e.g);
      e.g += s; if (!raining) e.w -= s;
      if (e.g >= T) ripe.push(k);
    }
    if (e.g !== g0 || e.w !== w0) changed = true;
  }
  if (changed) st.r++;
  return ripe;
}

/** {c, g, w, stage, T, pct} for the bed on that tile ({c:null} when empty), or null when there is no bed. */
export function bedInfo(st, decor, x, z) {
  if (!hasBed(decor, x, z)) return null;
  const e = st.b[tileKey(x, z)];
  if (!e) return { c: null, g: 0, w: 0, stage: 0, T: 0, pct: 0 };
  const T = CROPS[e.c].T;
  return { c: e.c, g: e.g, w: e.w, stage: stage(e), T, pct: Math.floor(e.g / T * 100) };
}

/** Bee bonus: a beehive within FLOWER_RANGE tiles (Chebyshev) of the bed. */
export function beeNear(decor, x, z) {
  if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'beehive' && Math.max(Math.abs(d.x - x), Math.abs(d.z - z)) <= FLOWER_RANGE) return true;
  return false;
}

/** Harvest loot for crop `c` at tile x,z: 2 produce (+1 with bees) and the seed back. Deterministic. */
export function yieldFor(c, decor, x, z) {
  const crop = CROPS[c]; if (!crop) return null;
  return { [crop.produce]: 2 + (beeNear(decor, x, z) ? 1 : 0), [crop.seed]: 1 };
}

const fail = reason => ({ ok: false, reason, text: TEXT[reason] });
const keyOf = (decor, x, z) => (isInt(x) && isInt(z) && hasBed(decor, x, z) ? tileKey(x, z) : null);

/** Plant `seed` (a seed kind) in the empty bed at x,z. Takes one seed from the bag. */
export function plant(st, decor, x, z, seed, bag, raining = false) {
  const k = keyOf(decor, x, z); if (!k) return fail('notarget');
  const c = typeof seed === 'string' && Object.prototype.hasOwnProperty.call(SEED_TO_CROP, seed) ? SEED_TO_CROP[seed] : null;
  if (!c) return fail('noseed');
  if (st.b[k]) return fail('occupied');
  if (!bag || typeof bag.remove !== 'function' || !bag.remove(seed, 1)) return fail('noseed');
  st.b[k] = { c, g: 0, w: raining ? WET_MAX : 0 };
  st.r++;
  return { ok: true, kind: 'notice', text: `Planted ${CROPS[c].name}` };
}

/** Water the dry, unripe crop at x,z: one freshcup becomes an empty cup and w = WET_MAX. Atomic. */
export function water(st, decor, x, z, bag) {
  const k = keyOf(decor, x, z); if (!k) return fail('notarget');
  const e = st.b[k]; if (!e) return fail('empty');
  if (isRipe(e)) return fail('ripe');
  if (e.w > 0) return fail('notdry');
  if (!bag || typeof bag.snapshot !== 'function' || !swapOne(bag, 'freshcup', 'cup')) return fail('nocup');
  e.w = WET_MAX; st.r++;
  return { ok: true, kind: 'notice', text: TEXT.watered };
}

/** Harvest the ripe crop at x,z. Everything fits in the bag or nothing changes and the crop stays. */
export function harvest(st, decor, x, z, bag) {
  const k = keyOf(decor, x, z); if (!k) return fail('notarget');
  const e = st.b[k]; if (!e) return fail('empty');
  if (!isRipe(e)) return fail('notripe');
  const loot = yieldFor(e.c, decor, x, z);
  if (!bag || typeof bag.snapshot !== 'function') return fail('full');
  const s = new bag.constructor(bag.snapshot());
  for (const [kind, n] of Object.entries(loot)) if (s.add(kind, n) !== 0) return fail('full');
  for (let i = 0; i < s.slots.length; i++) bag.slots[i] = s.slots[i];
  if (typeof bag.version === 'number') bag.version++;
  delete st.b[k]; st.r++;
  const text = '+ ' + Object.entries(loot).map(([kind, n]) => `${n} ${NAMES[kind] ?? kind}`).join(' · ');
  return { ok: true, kind: 'loot', loot, text };
}
