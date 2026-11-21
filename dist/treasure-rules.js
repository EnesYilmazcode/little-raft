// Sandy Secrets: pure rules (no THREE, no DOM). Buried bundle spots per island seed, their loot, the
// Seashell Finder beep curve, save validation and the host dig / spade repair checks.
// Spec: docs/specs/treasure.md. Unit tested in tests/treasure.test.mjs.
import { ISLAND, rng, layoutFor, groundHeight, shape } from './islands-layout.js?build=v3-survival-ae77fa84ac2b';
import { wearPerUse, repairCost } from './items.js?build=v3-survival-ae77fa84ac2b';

export const TREASURE = Object.freeze({
  K: 0x5EA5E11, LOOT_K: 0x7EA5B0, MAX_SPOTS: 2,
  U_MIN: 0.2, U_MAX: 0.65,  // spot radius as a fraction of R (dry sand, inside the dunes)
  MIN_Y: 0.3,               // spot sand height above the island origin (well above the waterline)
  NODE_GAP: 1.2, SPOT_GAP: 2.5,
  DIG_REACH: 2.0,           // a dig finds a spot within this many metres of the digger's feet
  RANGE: 9, LOCK: 1.0,      // finder hears spots inside RANGE; inside LOCK it chimes
  COOLDOWN: 0.6,            // seconds between digs, per actor
  IV_MIN: 0.12, IV_MAX: 1.2, // beep interval at LOCK and at RANGE (s)
});

const U32 = 4294967296;
const fin = v => typeof v === 'number' && Number.isFinite(v);
const isSeed = s => Number.isInteger(s) && s >= 0 && s < U32;
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

const spotCache = new Map();
// Buried spots of an island: frozen [{i, x, z, y, kind}] in island-local metres (cached; read-only).
// Uses its own RNG stream, so layoutFor (node placement) is untouched.
export function spotsFor(seed) {
  seed = seed >>> 0;
  const hit = spotCache.get(seed);
  if (hit) return hit;
  const r = rng((seed ^ TREASURE.K) >>> 0), lay = layoutFor(seed), R = lay.R;
  const want = 1 + (r() < 0.5 ? 1 : 0);
  const out = [];
  for (let k = 0; k < want; k++) {
    for (let tries = 0; tries < 60; tries++) {
      const a = r() * Math.PI * 2, u = TREASURE.U_MIN + (TREASURE.U_MAX - TREASURE.U_MIN) * Math.sqrt(r());
      const rad = u * R * shape(a - lay.rot);
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad, y = groundHeight(rad, R, a - lay.rot);
      if (!(y >= TREASURE.MIN_Y)) continue;
      let ok = true;
      for (const n of lay.nodes) if ((n.x - x) ** 2 + (n.z - z) ** 2 < TREASURE.NODE_GAP ** 2) { ok = false; break; }
      if (ok) for (const s of out) if ((s.x - x) ** 2 + (s.z - z) ** 2 < TREASURE.SPOT_GAP ** 2) { ok = false; break; }
      if (!ok) continue;
      out.push(Object.freeze({ i: out.length, x, z, y, kind: r() < 0.15 ? 'keepsake' : 'bundle' }));
      break;
    }
  }
  const res = Object.freeze(out);
  if (spotCache.size > 64) spotCache.clear();
  spotCache.set(seed, res);
  return res;
}

// [kind, min, max, weight]: existing mid-game materials only (about one barrel's worth per island).
const LOOT = [['rope', 2, 2, 3], ['nail', 3, 3, 3], ['glass', 1, 1, 2], ['copperore', 1, 2, 2], ['metalore', 1, 2, 2], ['clay', 2, 2, 2], ['seaweed', 2, 2, 2]];
const LOOT_TOTAL = LOOT.reduce((s, e) => s + e[3], 0);
// What a dug spot holds: [[kind, n], ...]. Deterministic per (seed, spot, kind). Same kinds add up.
export function lootForSpot(seed, i, kind) {
  const r = rng(((seed >>> 0) ^ TREASURE.LOOT_K ^ Math.imul((i | 0) + 1, 0x9E3779B1)) >>> 0);
  const got = new Map();
  for (let p = 0; p < 2; p++) {
    let pick = r() * LOOT_TOTAL, e = LOOT[LOOT.length - 1];
    for (const c of LOOT) { if (pick < c[3]) { e = c; break; } pick -= c[3]; }
    const n = e[1] + Math.floor(r() * (e[2] - e[1] + 1));
    got.set(e[0], (got.get(e[0]) || 0) + n);
  }
  if (kind === 'keepsake') { const k = r() < 0.5 ? 'copperingot' : 'metalingot'; got.set(k, (got.get(k) || 0) + 1); }
  return [...got];
}

// 0 (near) .. 1 (far) remapped to the finder's closeness 1 (at LOCK) .. 0 (at RANGE).
export function closeness(d) {
  if (!fin(d)) return 0;
  return 1 - clamp01((d - TREASURE.LOCK) / (TREASURE.RANGE - TREASURE.LOCK));
}
// Seconds between finder ticks at distance d: Infinity out of range, 0 = locked on (chime instead).
export function beepInterval(d) {
  if (!(d < TREASURE.RANGE)) return Infinity;
  if (d <= TREASURE.LOCK) return 0;
  const f = (d - TREASURE.LOCK) / (TREASURE.RANGE - TREASURE.LOCK);
  return TREASURE.IV_MIN + (TREASURE.IV_MAX - TREASURE.IV_MIN) * f ** 1.4;
}
export function warmth(d) {
  if (d === null || d === undefined || !(d === d)) return 'Nothing buried nearby';
  if (d >= TREASURE.RANGE) return 'Quiet sand…';
  if (d > 6) return 'Warm…';
  if (d > 3) return 'Warmer…';
  if (d > TREASURE.LOCK) return 'Very warm!';
  return 'Right here! Dig with the spade';
}

export const DEFAULTS = () => ({ v: 1, seed: null, dug: [] });

// Validate a save / net slice. Never throws; always a fresh object (never aliases the input).
export function clean(data) {
  const out = DEFAULTS();
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1) return out;
    if (!isSeed(data.seed)) return out;
    out.seed = data.seed;
    const src = Array.isArray(data.dug) ? data.dug : [];
    const n = spotsFor(data.seed).length;
    for (let k = 0; k < n; k++) out.dug.push(src[k] === 1 || src[k] === true ? 1 : 0);
  } catch { return DEFAULTS(); }
  return out;
}

// Index of the closest undug spot within reach of island-local (lx, lz), or -1. No allocation.
export function nearestSpot(spots, dug, lx, lz, reach) {
  let best = -1, bd = reach * reach;
  if (!spots || !fin(lx) || !fin(lz)) return -1;
  for (let k = 0; k < spots.length; k++) {
    if (dug && dug[k]) continue;
    const s = spots[k], d = (s.x - lx) ** 2 + (s.z - lz) ** 2;
    if (d <= bd) { bd = d; best = k; }
  }
  return best;
}

// Copy a scratch bag's slots back into the real one (all-or-nothing commit).
function commit(bag, scratch) {
  for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i];
  if (typeof bag.version === 'number') bag.version++;
}
const scratchOf = bag => { try { return new bag.constructor(bag.snapshot()); } catch { return null; } };
const okBag = bag => !!bag && Array.isArray(bag.slots) && typeof bag.snapshot === 'function' && Number.isInteger(bag.selectedIndex);

// Host dig check. st: {seed, cx, cz, clock, cool:{host, guest}, dug, spots, groundAt(x, z)}.
// a: {kind:'treasure.dig', seed, spot} (spot -1 = plain sand). pos: the actor's {x, z}.
// Mutates bag, st.dug and st.cool only on success. Returns {ok, reason} or {ok:true, loot, spot, kind}.
export function applyDig(st, a, actor, pos, bag) {
  const no = reason => ({ ok: false, reason });
  if (!a || a.kind !== 'treasure.dig') return no('kind');
  if (!st || st.seed === null || st.seed === undefined || !st.spots) return no('none');
  if (a.seed !== st.seed) return no('stale');
  const k = a.spot;
  if (!Number.isInteger(k) || k < -1 || k >= st.spots.length) return no('spot');
  if (k >= 0 && st.dug[k]) return no('dug');
  if (!pos || !fin(pos.x) || !fin(pos.z)) return no('reach');
  const g = typeof st.groundAt === 'function' ? st.groundAt(pos.x, pos.z) : NaN;
  if (!fin(g)) return no('reach');
  const who = actor === 'guest' ? 'guest' : 'host';
  if (k >= 0) {
    const s = st.spots[k], reach = TREASURE.DIG_REACH + (who === 'guest' ? ISLAND.GUEST_SLACK : 0);
    const dx = pos.x - (st.cx + s.x), dz = pos.z - (st.cz + s.z);
    if (dx * dx + dz * dz > reach * reach) return no('reach');
  }
  if (st.clock < (st.cool[who] || 0)) return no('cooldown');
  if (!okBag(bag)) return no('bag');
  const sel = bag.slots[bag.selectedIndex];
  if (!sel || sel.kind !== 'spade') return no('tool');
  if (!((sel.durability ?? 100) > 0)) return no('worn');
  const kind = k >= 0 ? st.spots[k].kind : 'sand';
  const loot = k >= 0 ? lootForSpot(st.seed, k, kind) : [['sand', 1]];
  const scratch = scratchOf(bag);
  if (!scratch) return no('bag');
  for (const [kk, c] of loot) if (scratch.add(kk, c) > 0) return no('full');
  commit(bag, scratch);
  const tool = bag.slots[bag.selectedIndex];
  tool.durability = Math.max(0, (tool.durability ?? 100) - wearPerUse('spade'));
  if (k >= 0) st.dug[k] = 1;
  st.cool[who] = st.clock + TREASURE.COOLDOWN;
  return { ok: true, loot, spot: k, kind };
}

// Repair the selected spade to 100% for repairCost('spade'). Returns {ok} or {ok:false, reason, cost}.
export function applyRepair(bag) {
  const cost = repairCost('spade');
  if (!okBag(bag)) return { ok: false, reason: 'tool', cost };
  const sel = bag.slots[bag.selectedIndex];
  if (!sel || sel.kind !== 'spade') return { ok: false, reason: 'tool', cost };
  if ((sel.durability ?? 100) >= 100) return { ok: false, reason: 'fine', cost };
  const scratch = scratchOf(bag);
  if (!scratch || !cost) return { ok: false, reason: 'cost', cost };
  for (const [k, n] of Object.entries(cost)) if (!scratch.remove(k, n)) return { ok: false, reason: 'cost', cost };
  commit(bag, scratch);
  const tool = bag.slots[bag.selectedIndex];
  if (!tool || tool.kind !== 'spade') return { ok: false, reason: 'tool', cost }; // cannot happen: costs are not spades
  tool.durability = 100;
  return { ok: true, cost };
}
