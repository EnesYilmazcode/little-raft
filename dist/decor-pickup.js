// Pick up placed items (hammer, hold X on decor): pure rules, no DOM or THREE. See docs/specs/decor-pickup.md.
// The item comes back whole, everything stored in it comes back too, and nothing is ever spilled: when the
// contents can't come back safely the host refuses with a gentle notice and leaves the world as it was.
import { Bag, ITEM_INFO } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { plantStage } from './watering.js?build=v3-survival-ae77fa84ac2b';

export const UNDECOR_TEXT = Object.freeze({
  full:'Your bag is full', reach:'Move a little closer', hammer:'Hold your hammer to pick things up',
  ripe:'Harvest it first', water:'Take your water first', oldHost:'Your friend’s raft can’t pick items back up yet' });
export const tileKey = (x, z) => x + ',' + z;

const isInt = Number.isInteger;
const plainObj = v => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const isKind = k => typeof k === 'string' && Object.prototype.hasOwnProperty.call(ITEM_INFO, k);

/** Index of the decor entry on tile (x, z), or -1. No allocations. */
export function decorAt(decor, x, z) {
  if (!Array.isArray(decor)) return -1;
  for (let i = 0; i < decor.length; i++) { const d = decor[i]; if (d && d.x === x && d.z === z) return i; }
  return -1;
}

/** Veto from the core per-tile maps (palm, purifier) or null. Rain water is free, so barrels never refuse. */
export function coreUndecorBlock(world, d) {
  if (!world || !d) return null;
  if (d.type === 'palm') return plantStage(world.garden?.[tileKey(d.x, d.z)]) === 2 ? UNDECOR_TEXT.ripe : null;
  if (d.type === 'purifier') return world.purifiers?.[tileKey(d.x, d.z)]?.ready ? UNDECOR_TEXT.water : null;
  return null;
}

/** Contents of the core per-tile maps: a purifier still purifying holds the sea-water cup loadPurifier took. */
export function coreUndecorLoot(world, d) {
  if (!world || !d || d.type !== 'purifier') return null;
  const e = world.purifiers?.[tileKey(d.x, d.z)];
  return e && !e.ready ? [['saltcup', 1]] : null; // a ready one is vetoed (water) by coreUndecorBlock
}

/** Clean loot list: [[kind, n, meta?]...]. Bad kinds and n<1 dropped, n floored, plain duplicates merged in order. */
export function normLoot(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const e of list) {
    if (!Array.isArray(e) || !isKind(e[0])) continue;
    const n = typeof e[1] === 'number' && Number.isFinite(e[1]) ? Math.floor(e[1]) : 0;
    if (n < 1) continue;
    if (plainObj(e[2])) { out.push([e[0], n, { ...e[2] }]); continue; } // meta entries never merge
    const same = out.find(o => o.length === 2 && o[0] === e[0]);
    if (same) same[1] += n; else out.push([e[0], n]);
  }
  return out;
}

/** The item itself first, then every module's contents. */
export function assembleLoot(d, ...lists) {
  const rest = [];
  for (const l of lists) if (Array.isArray(l)) rest.push(...l);
  return [[d.type, 1], ...normLoot(rest)];
}

/** Add every entry to a scratch Bag built from the snapshot. Never touches the live bag. */
export function tryLoot(bagSnapshot, loot) {
  let scratch;
  try { scratch = new Bag(bagSnapshot); } catch { return { ok: false, scratch: null }; }
  if (!Array.isArray(loot)) return { ok: false, scratch: null };
  for (const e of loot) {
    if (!Array.isArray(e) || !isKind(e[0])) return { ok: false, scratch: null }; // an unknown item can't come back: refuse, never drop
    if (scratch.add(e[0], e[1], plainObj(e[2]) ? e[2] : undefined) > 0) return { ok: false, scratch: null };
  }
  return { ok: true, scratch };
}

const CORE_MAPS = ['garden', 'purifiers', 'collectors', 'sprinklers'];
/** Delete key k from the four core per-tile maps. True if anything changed. */
export function clearCoreTile(world, k) {
  let changed = false;
  if (!world) return false;
  for (const m of CORE_MAPS) {
    const map = world[m];
    if (map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, k)) { delete map[k]; changed = true; }
  }
  return changed;
}

// Last parsed hit key, so aiming at the same decor frame after frame allocates nothing.
let lastKey = null, lastX = 0, lastZ = 0;
/** Aimed decor: the ray hit's tile key wins, else the aim point's tile. -> the decor entry or null. */
export function targetFromAim(decor, hitKey, point) {
  if (typeof hitKey === 'string') {
    if (hitKey !== lastKey) {
      const c = hitKey.indexOf(','), x = +hitKey.slice(0, c), z = +hitKey.slice(c + 1);
      if (c > 0 && isInt(x) && isInt(z)) { lastKey = hitKey; lastX = x; lastZ = z; } else lastKey = null;
    }
    if (lastKey === hitKey) { const i = decorAt(decor, lastX, lastZ); if (i >= 0) return decor[i]; }
  }
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
  const i = decorAt(decor, Math.round(point.x / 2), Math.round(point.z / 2));
  return i >= 0 ? decor[i] : null;
}

/** Guest side: did the last host 'state' say it understands {kind:'undecor'}? */
export const hostCanUndecor = state => !!state?.caps?.undecor;
