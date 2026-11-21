// Foundation repair rules (Raft-style hammer repair). Pure ES module: no DOM, no THREE.
// world.tileHp is an object keyed "x,z" (tile coords) -> 0..100; a missing key means full HP.
// The shark lane writes damage into it; this module only reads it and heals it.

export const TILE_MAX_HP = 100;
export const REPAIR_HP = 50;                       // one hammer click restores half a foundation
export const TILE_REPAIR_COST = Object.freeze({ wood: 1 }); // one plank per click

const hasOwn = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const isInt = (n) => Number.isInteger(n);

export const hpKey = (x, z) => x + ',' + z;

export function hasTileAt(world, x, z) {
  const tiles = world && Array.isArray(world.tiles) ? world.tiles : [];
  for (const t of tiles) if (t && t[0] === x && t[1] === z) return true;
  return false;
}

/** Current HP of tile (x, z), clamped to 0..100. Missing key / junk -> 100. */
export function tileHpOf(world, x, z) {
  const m = world && world.tileHp;
  const k = hpKey(x, z);
  if (!hasOwn(m, k)) return TILE_MAX_HP;
  const v = Number(m[k]);
  return Number.isFinite(v) ? Math.min(TILE_MAX_HP, Math.max(0, v)) : TILE_MAX_HP;
}

/** The damaged tile at (x, z) as {x, z, hp, pct}, or null when it is missing or at full HP. */
export function damagedTile(world, x, z) {
  if (!isInt(x) || !isInt(z) || !hasTileAt(world, x, z)) return null;
  const hp = tileHpOf(world, x, z);
  return hp < TILE_MAX_HP ? { x, z, hp, pct: Math.round(hp) } : null;
}

/** HP after one repair click (capped). */
export const repairedHp = (hp) => Math.min(TILE_MAX_HP, Math.max(0, Number(hp) || 0) + REPAIR_HP);

/**
 * Host-side repair of tile (x, z). bag needs count(kind) and remove(kind, n).
 * Returns {ok:true, hp} or {ok:false, reason:'tile'|'full'|'cost'}.
 * Full HP drops the key so world.tileHp stays sparse.
 */
export function repairTile(world, x, z, bag) {
  const d = damagedTile(world, x, z);
  if (!d) return { ok: false, reason: hasTileAt(world, x, z) ? 'full' : 'tile' };
  for (const [k, n] of Object.entries(TILE_REPAIR_COST)) if (!bag || bag.count(k) < n) return { ok: false, reason: 'cost' };
  for (const [k, n] of Object.entries(TILE_REPAIR_COST)) bag.remove(k, n);
  const hp = repairedHp(d.hp);
  if (!world.tileHp || typeof world.tileHp !== 'object') world.tileHp = {};
  if (hp >= TILE_MAX_HP) delete world.tileHp[hpKey(x, z)];
  else world.tileHp[hpKey(x, z)] = hp;
  return { ok: true, hp };
}

/** Small inline HP bar + percentage for the context prompt (trusted static markup). */
export function hpBarHtml(hp) {
  const pct = Math.round(Math.min(TILE_MAX_HP, Math.max(0, Number(hp) || 0)));
  const col = pct > 60 ? '#8fd18a' : pct > 30 ? '#ffbd66' : '#ee8e75';
  return `<span style="display:inline-block;vertical-align:middle;width:46px;height:6px;margin:0 6px;border-radius:3px;background:rgba(0,0,0,.35);overflow:hidden">`
    + `<span style="display:block;height:100%;width:${pct}%;background:${col}"></span></span>${pct}%`;
}
