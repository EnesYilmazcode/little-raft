// Pim's Barge: pure rules (docs/specs/trader.md §3). No imports, no DOM, no THREE, no Date, no Math.random.
// The visit clock, the seeded offer list, the barge path, the bow parking spot, slice cleaning and atomic trades.

export const TRADER = Object.freeze({ FIRST: 240, GAP_MIN: 600, GAP_MAX: 840, APPROACH: 25, DOCK: 240, HOLD_MAX: 240,
  DEPART: 20, WARN: 30, NEAR: 6, LANE: 22, RISE: 4, GAP: 1.0, HALF_BEAM: .9, REACH: 4, GUEST_SLACK: 1, CLOSE_DIST: 5,
  OFFERS: 6, RARE_CHANCE: .4, MAX_CLOCK: 1e9 });
export const TRADER_PLANS = Object.freeze(['shellwreath']);

const def = (id, give, get, stock, extra = {}) => Object.freeze({ id, give: Object.freeze(give), get: Object.freeze(get), stock, ...extra });
export const POOL = Object.freeze([
  // fixed rows, always first and in this order
  def('fish', { fish: 3 }, { shell: 2 }, 4, { fixed: true }),
  def('ore', { shell: 4 }, { metalore: 2 }, 2, { fixed: true }),
  def('plan', { shell: 6 }, {}, 1, { fixed: true, plan: 'shellwreath' }),
  // pool rows, shuffled per visit
  def('egg', { puffegg: 2 }, { shell: 2 }, 3),
  def('feather', { feather: 3 }, { shell: 2 }, 3),
  def('brick', { brick: 4 }, { shell: 3 }, 2),
  def('glass', { glass: 2 }, { shell: 3 }, 2),
  def('grill', { cookedfish: 2 }, { shell: 3 }, 2),
  def('copper', { shell: 3 }, { copperore: 1 }, 1),
  def('seeds', { shell: 2 }, { seed: 2 }, 3),
  def('clay', { scrap: 4, rope: 2 }, { clay: 3 }, 1),
  // rare row: the last slot on ~40% of visits
  def('float', { shell: 10 }, { glassfloat: 1 }, 1, { rare: true }),
]);

const isUint32 = v => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fin = v => typeof v === 'number' && Number.isFinite(v);

/** mulberry32: uint32 seed -> () => [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const allKinds = () => true;
let memo = null; // one entry: a pure function of (seed, has, pool), so this is just a cache
/** Frozen offer list for a visit seed: fixed rows, then shuffled pool rows, the rare float last when drawn. */
export function offersFor(seed, has = allKinds, pool = POOL) {
  const s = seed >>> 0;
  if (memo && memo.seed === s && memo.has === has && memo.pool === pool) return memo.out;
  const ok = d => {
    if (!d || typeof d !== 'object') return false;
    for (const k in d.give) if (!has(k)) return false;
    for (const k in d.get) if (!has(k)) return false;
    return true;
  };
  const live = pool.filter(ok), r = rng(s);
  const rare = r() < TRADER.RARE_CHANCE;
  const fixed = live.filter(d => d.fixed), rows = live.filter(d => !d.fixed && !d.rare), float = live.find(d => d.rare && d.id === 'float');
  for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = rows[i]; rows[i] = rows[j]; rows[j] = t; }
  const out = fixed.slice(0, TRADER.OFFERS), room = TRADER.OFFERS - (rare && float ? 1 : 0);
  for (let i = 0; i < rows.length && out.length < room; i++) out.push(rows[i]);
  if (rare && float && out.length < TRADER.OFFERS) out.push(float);
  const frozen = Object.freeze(out);
  memo = { seed: s, has, pool, out: frozen };
  return frozen;
}

/** Seconds from one visit's end to the next visit's arrival. */
export function nextDelay(seed) { return TRADER.GAP_MIN + rng((seed ^ 0x9e37) >>> 0)() * (TRADER.GAP_MAX - TRADER.GAP_MIN); }

/** Barge phase at t seconds since it was born (hold = extra docked seconds). Writes into out, no allocation. */
export function pathAt(t, hold, out) {
  const h = fin(hold) ? clamp(hold, 0, TRADER.HOLD_MAX) : 0, dock = TRADER.DOCK + h, A = TRADER.APPROACH;
  if (!fin(t)) { out.phase = 'gone'; out.u = 1; out.left = 0; return out; }
  if (t < A) { out.phase = 'approach'; out.u = t > 0 ? t / A : 0; out.left = A + dock - t; return out; }
  if (t < A + dock) { out.phase = 'docked'; out.u = (t - A) / dock; out.left = A + dock - t; return out; }
  if (t < A + dock + TRADER.DEPART) { out.phase = 'depart'; out.u = (t - A - dock) / TRADER.DEPART; out.left = 0; return out; }
  out.phase = 'gone'; out.u = 1; out.left = 0; return out;
}

const validTile = t => Array.isArray(t) && Number.isInteger(t[0]) && Number.isInteger(t[1]);
/** Barge centre (raft-local metres) off the bow row (min tile z), GAP metres from the deck edge. No allocation. */
export function parkAt(tiles, out) {
  let minZ = Infinity;
  if (Array.isArray(tiles)) for (let i = 0; i < tiles.length; i++) { const t = tiles[i]; if (validTile(t) && t[1] < minZ) minZ = t[1]; }
  if (minZ === Infinity) { out.x = 0; out.z = -3 - TRADER.GAP - TRADER.HALF_BEAM; return out; }
  let sum = 0, n = 0;
  for (let i = 0; i < tiles.length; i++) { const t = tiles[i]; if (validTile(t) && t[1] === minZ) { sum += t[0] * 2; n++; } }
  let x = sum / n;
  // A bow row with holes can put the mean over open water: use the bow tile nearest the mean instead.
  let onRow = false, best = Infinity, bx = x;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]; if (!validTile(t) || t[1] !== minZ) continue;
    const d = Math.abs(t[0] * 2 - x); if (d <= 1) onRow = true;
    if (d < best) { best = d; bx = t[0] * 2; }
  }
  out.x = onRow ? x : bx;
  out.z = minZ * 2 - 1 - TRADER.GAP - TRADER.HALF_BEAM;
  return out;
}

/** Distance from (x, z) to the nearest deck tile square (copy of signal.js deckGap; no tiles gives 0). */
export function deckGap(tiles, x, z) {
  let best = Infinity;
  if (Array.isArray(tiles)) for (const t of tiles) {
    if (!Array.isArray(t)) continue;
    const g = Math.hypot(Math.max(0, Math.abs(x - t[0] * 2) - 1), Math.max(0, Math.abs(z - t[1] * 2) - 1));
    if (g < best) best = g;
  }
  return best === Infinity ? 0 : best;
}

const defaults = () => ({ v: 1, r: 0, clock: 0, next: TRADER.FIRST, plans: [], visit: null });
const scratchPath = { phase: 'gone', u: 1, left: 0 };

/** A fresh, valid world.ext.trader slice from anything. Never throws. */
export function cleanTrader(v, has = allKinds) {
  try {
    if (!v || typeof v !== 'object' || Array.isArray(v) || v.v !== 1) return defaults();
    const out = defaults();
    out.clock = fin(v.clock) ? clamp(v.clock, 0, TRADER.MAX_CLOCK) : 0;
    out.next = fin(v.next) ? clamp(v.next, out.clock, out.clock + TRADER.GAP_MAX) : out.clock + TRADER.FIRST;
    out.r = Number.isSafeInteger(v.r) && v.r >= 0 ? v.r : 0;
    if (Array.isArray(v.plans)) for (const p of v.plans) if (TRADER_PLANS.includes(p) && !out.plans.includes(p)) out.plans.push(p);
    const w = v.visit;
    if (w && typeof w === 'object' && !Array.isArray(w) && isUint32(w.seed)) {
      const born = fin(w.born) && w.born <= out.clock ? w.born : out.clock;
      const hold = fin(w.hold) ? clamp(w.hold, 0, TRADER.HOLD_MAX) : 0;
      const offers = offersFor(w.seed, has), src = Array.isArray(w.stock) ? w.stock : [];
      const stock = offers.map((o, i) => (fin(src[i]) ? clamp(Math.floor(src[i]), 0, o.stock) : o.stock));
      if (pathAt(out.clock - born, hold, scratchPath).phase === 'gone') out.next = clamp(out.clock + nextDelay(w.seed), out.clock, out.clock + TRADER.GAP_MAX);
      else out.visit = { seed: w.seed, born, hold, stock };
    }
    return out;
  } catch { return defaults(); }
}

function scratchAfter(bag, offer) { // the bag after the trade, or null when it does not fit
  const s = new bag.constructor(bag.snapshot());
  for (const k in offer.give) if (!s.remove(k, offer.give[k])) return null;
  for (const k in offer.get) if (s.add(k, offer.get[k]) > 0) return null;
  return s;
}
const fail = (reason, text) => ({ ok: false, reason, text });

/** Can the bag make trade a.offer right now? {ok:true, offer} | {ok:false, reason, text}. Changes nothing. */
export function tradeCheck(st, a, bag, has = allKinds, name = k => k) {
  const v = st && st.visit;
  if (!v || pathAt(st.clock - v.born, v.hold, scratchPath).phase !== 'docked') return fail('closed', 'Pim isn’t here right now');
  if (!a || a.visit !== v.seed) return fail('stale', 'Pim has new stock, take another look');
  const offers = offersFor(v.seed, has), i = a.offer;
  if (!Number.isInteger(i) || i < 0 || i >= offers.length) return fail('bad', 'That trade isn’t on offer');
  const offer = offers[i];
  if (!((v.stock[i] | 0) > 0)) return fail('soldout', 'Sold out');
  if (offer.plan && st.plans.includes(offer.plan)) return fail('known', 'You already have this plan');
  if (!bag || !Array.isArray(bag.slots)) return fail('full', 'Bag full');
  const need = [];
  for (const k in offer.give) { const have = bag.count(k); if (have < offer.give[k]) need.push(`${offer.give[k] - have} more ${name(k)}`); }
  if (need.length) return fail('missing', 'Need ' + need.join(' and '));
  if (!scratchAfter(bag, offer)) return fail('full', 'Bag full');
  return { ok: true, offer };
}

/** Atomic trade: either everything (bag, stock, r, plans) changes, or nothing does. */
export function applyTrade(st, a, bag, has = allKinds, name = k => k) {
  const c = tradeCheck(st, a, bag, has, name);
  if (!c.ok) return c;
  const offer = c.offer, s = scratchAfter(bag, offer);
  if (!s) return fail('full', 'Bag full');
  for (let i = 0; i < s.slots.length; i++) bag.slots[i] = s.slots[i];
  bag.version++;
  st.visit.stock[a.offer]--;
  st.r++;
  if (offer.plan && !st.plans.includes(offer.plan)) st.plans.push(offer.plan);
  const got = [];
  for (const k in offer.get) got.push(`${offer.get[k]} ${name(k)}`);
  const text = offer.plan ? `${name(offer.plan)} plan learned!` : '+ ' + got.join(' · ');
  return { ok: true, text, offer };
}
