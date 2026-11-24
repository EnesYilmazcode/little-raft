// Trading posts: pure rules (docs/specs/trader.md). No DOM, no THREE, no Date, no Math.random.
// Like Raft, trading happens at fixed posts on the larger islands, not from a visiting boat. Which islands get a
// post and where its stall stands are pure functions of the island seed, so host and guest agree with no messages.
// The seeded offer list, slice cleaning and atomic trades live here too.
import { layoutFor, groundHeight, shape } from './islands-layout.js?build=v3-survival-ae77fa84ac2b';
import { spotsFor } from './treasure-rules.js?build=v3-survival-ae77fa84ac2b';

export const TRADER = Object.freeze({ POST_MIN_R: 8, POST_K: 0x51a11, POST_U_MIN: .3, POST_U_MAX: .62, POST_GAP: .3,
  POST_FLAT: .25, POST_MIN_Y: .35, POST_DRY: .12, REACH: 4, GUEST_SLACK: 1, CLOSE_DIST: 5, OFFERS: 6, RARE_CHANCE: .4 });
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
  // late rows (added after release; append only): kept out of the shuffle above so every older seed keeps its offers
  // and indices (saved visit stock and co-op trades go by index). On `late` of visits, drawn from a separate stream,
  // one takes the last pool slot instead.
  def('titanium', { shell: 8 }, { titaniumore: 1 }, 1, { late: .3 }), // rare ore: pricier than copper
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
const LATE_K = 0x7a7e5eed;
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
  const fixed = live.filter(d => d.fixed), rows = live.filter(d => !d.fixed && !d.rare && !d.late), float = live.find(d => d.rare && d.id === 'float');
  for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = rows[i]; rows[i] = rows[j]; rows[j] = t; }
  const out = fixed.slice(0, TRADER.OFFERS), room = TRADER.OFFERS - (rare && float ? 1 : 0);
  for (let i = 0; i < rows.length && out.length < room; i++) out.push(rows[i]);
  const lr = rng((s ^ LATE_K) >>> 0); // late rows never touch the main stream
  for (const d of live) {
    if (!d.late || !(lr() < d.late)) continue;
    if (out.length < room) out.push(d);
    else if (out.length > fixed.length && !out[out.length - 1].late) out[out.length - 1] = d;
  }
  if (rare && float && out.length < TRADER.OFFERS) out.push(float);
  const frozen = Object.freeze(out);
  memo = { seed: s, has, pool, out: frozen };
  return frozen;
}

/** Does the island with this seed have a trading post? Only the larger islands (R >= POST_MIN_R) do. */
export function isPostIsland(seed) {
  if (!isUint32(seed)) return false;
  return layoutFor(seed).R >= TRADER.POST_MIN_R;
}

const postCache = new Map();
// Stall footprint half-extents in its own frame (deck with the crates and barrel), and what counts as solid near it.
const FOOT_X = 1.75, FOOT_Z = .8, NODE_R = { palm: .28, rock: .42, bush: .3, sand: .15 }, SPOT_R = .5;
const FOOT_PTS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
/**
 * The stall of the island's trading post, frozen {x, z, y, yaw} in island-local metres (y = deck height above the
 * island origin: the highest sand under its footprint, so no edge is buried; the footing hides the downhill gap;
 * yaw turns the model's +z, its counter, to face out to sea), or null when the island has none.
 * Its own RNG stream; prefers a spot whose whole footprint stays POST_GAP clear of every resource node and buried
 * treasure spot, on dry and fairly flat sand.
 */
export function postFor(seed) {
  if (!isPostIsland(seed)) return null;
  const hit = postCache.get(seed);
  if (hit) return hit;
  const lay = layoutFor(seed), spots = spotsFor(seed), r = rng((seed ^ TRADER.POST_K) >>> 0);
  const ground = (x, z) => groundHeight(Math.hypot(x, z), lay.R, Math.atan2(z, x) - lay.rot);
  const gapTo = (x, z, c, s, px, pz, rad) => { // clearance between a disc and the footprint rectangle
    const dx = px - x, dz = pz - z, lx = dx * c - dz * s, lz = dx * s + dz * c;
    return Math.hypot(Math.max(0, Math.abs(lx) - FOOT_X), Math.max(0, Math.abs(lz) - FOOT_Z)) - rad;
  };
  let best = null, bestScore = -Infinity;
  for (let tries = 0; tries < 96; tries++) {
    const a = r() * Math.PI * 2, u = TRADER.POST_U_MIN + (TRADER.POST_U_MAX - TRADER.POST_U_MIN) * r();
    const rad = u * lay.R * shape(a - lay.rot), x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (!(ground(x, z) >= TRADER.POST_MIN_Y)) continue;
    const yaw = Math.atan2(x, z), c = Math.cos(yaw), s = Math.sin(yaw);
    let lo = Infinity, hi = -Infinity;
    for (const [fx, fz] of FOOT_PTS) {
      const mx = fx * FOOT_X, mz = fz * FOOT_Z, g = ground(x + mx * c + mz * s, z - mx * s + mz * c);
      if (!(g === g)) { lo = -Infinity; break; }
      if (g < lo) lo = g; if (g > hi) hi = g;
    }
    if (!(lo >= TRADER.POST_DRY)) continue;
    let gap = Infinity;
    for (const n of lay.nodes) gap = Math.min(gap, gapTo(x, z, c, s, n.x, n.z, NODE_R[n.kind] ?? .3));
    for (const t of spots) gap = Math.min(gap, gapTo(x, z, c, s, t.x, t.z, SPOT_R));
    const spread = hi - lo, score = Math.min(gap, TRADER.POST_GAP) * 4 - Math.max(0, spread - TRADER.POST_FLAT);
    if (score > bestScore) { bestScore = score; best = { x, z, y: hi, yaw }; }
    if (gap >= TRADER.POST_GAP && spread <= TRADER.POST_FLAT) break;
  }
  if (!best) best = { x: 0, z: 0, y: ground(0, 0), yaw: 0 };
  const out = Object.freeze(best);
  if (postCache.size > 64) postCache.clear();
  postCache.set(seed, out);
  return out;
}

const defaults = () => ({ v: 1, r: 0, plans: [], visit: null });

/**
 * A fresh, valid world.ext.trader slice from anything. Never throws.
 * Older saves carry the visiting barge's clock, next, visit.born and visit.hold: those are dropped. The learned
 * plans and the revision are kept; a leftover visit keeps its seed and stock, and the module replaces it with the
 * post of whatever island is in view (or clears it) on its first running frame.
 */
export function cleanTrader(v, has = allKinds) {
  try {
    if (!v || typeof v !== 'object' || Array.isArray(v) || v.v !== 1) return defaults();
    const out = defaults();
    out.r = Number.isSafeInteger(v.r) && v.r >= 0 ? v.r : 0;
    if (Array.isArray(v.plans)) for (const p of v.plans) if (TRADER_PLANS.includes(p) && !out.plans.includes(p)) out.plans.push(p);
    const w = v.visit;
    if (w && typeof w === 'object' && !Array.isArray(w) && isUint32(w.seed)) {
      const offers = offersFor(w.seed, has), src = Array.isArray(w.stock) ? w.stock : [];
      out.visit = { seed: w.seed, stock: offers.map((o, i) => (fin(src[i]) ? clamp(Math.floor(src[i]), 0, o.stock) : o.stock)) };
    }
    return out;
  } catch { return defaults(); }
}

/** A fresh visit (full stock) for the post on the island with this seed. */
export function openVisit(seed, has = allKinds) {
  const s = seed >>> 0;
  return { seed: s, stock: offersFor(s, has).map(o => o.stock) };
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
  if (!v) return fail('closed', 'No trading post here');
  if (!a || a.visit !== v.seed) return fail('stale', 'The stock changed, take another look');
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
