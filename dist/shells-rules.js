// Seashells + Shell Book: pure rules (no THREE, no DOM). Beach sparkle spots per island seed, the kind
// roll, save validation, the host take / dive find checks with their Bright Shell payouts, and the book
// view. The 12 kinds are book entries only, never bag items. Spec: docs/specs/shells.md.
// Unit tested in tests/shells.test.mjs.
import { ISLAND, rng, hash3, layoutFor, groundHeight, shape, SHORE_U } from './islands-layout.js?build=v3-survival-ae77fa84ac2b';
import { spotsFor } from './treasure-rules.js?build=v3-survival-ae77fa84ac2b';

export const SHELLS_K = 0x5E11B00C, SEA_K = 0x5EA5E7;
export const SHELL_CFG = Object.freeze({
  MAX_SPOTS: 4, NODE_GAP: 2.2, SPOT_GAP: 3, NODE_GAP_MIN: 1.4, SPOT_GAP_MIN: 2.2,
  MIN_Y: 0.3, BAND: 0.22,   // u in [SHORE_U - BAND, SHORE_U] and sand >= 0.3 m over the island origin (lower spots sit under the waves)
  PICK: 1.6,      // E claims within this many metres (horizontal) of the player
  REACH: 2.0,     // host take check (horizontal metres; the guest gets ISLAND.GUEST_SLACK on top)
  SEA_CHANCE: 0.15, SEA_DAY: 3, SEA_PAY_DAY: 3, DEEP_Y: -6,
  MAX_N: 9999,
});
export const PAY_CAP = 5;

const deepFreeze = o => { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o); };

// Colours copied from the fish journal (fish-species.js RARITY) so both books read the same.
export const RARITY = deepFreeze({
  common:    { label: 'Common',    weight: 60, color: '#cfd8cf', pay: 1 },
  uncommon:  { label: 'Uncommon',  weight: 28, color: '#7fd3a0', pay: 1 },
  rare:      { label: 'Rare',      weight: 10, color: '#6fb6ff', pay: 2 },
  legendary: { label: 'Legendary', weight: 2,  color: '#ffc857', pay: 3 },
});

const sh = (id, name, rarity, where, svg, note) => ({ id, name, rarity, where, svg, note });
export const SHELLS = deepFreeze([
  sh('button', 'Button Cockle', 'common', ['beach'], 'fan', 'Small enough to sew on a coat. Someone probably has.'),
  sh('sunfan', 'Sunfan Scallop', 'common', ['beach'], 'scallop', 'Holds the morning light like a cupped hand.'),
  sh('tiddly', 'Tiddly Whelk', 'common', ['beach', 'sea'], 'cone', 'Hums faintly if you hold it to your ear and wait.'),
  sh('pebble', 'Pebble Limpet', 'common', ['sea'], 'dome', 'Sat on one rock for years and saw everything.'),
  sh('ribbon', 'Ribbon Auger', 'uncommon', ['beach'], 'spike', 'A pencil the sea forgot to sharpen.'),
  sh('moonsnail', 'Moon Snail', 'uncommon', ['beach'], 'coil', 'Only peeks out once the lanterns are lit.'),
  sh('piggy', 'Piggy Cowrie', 'uncommon', ['sea'], 'egg', 'Smooth as a pocket stone, warm as a teacup.'),
  sh('butterfly', 'Butterfly Pair', 'uncommon', ['beach'], 'wings', 'Two halves that refused to drift apart.'),
  sh('crown', 'Coral Crown', 'rare', ['sea'], 'crown', 'Worn by a very small and very proud crab.'),
  sh('lantern', 'Lantern Nautilus', 'rare', ['sea'], 'nautilus', 'Each room is a year; it kept them all.'),
  sh('starry', 'Starry Sand Dollar', 'rare', ['beach'], 'star', 'Spends its pocket money on nothing at all.'),
  sh('pearl', 'Pearl Heart', 'legendary', ['beach', 'sea'], 'heart', 'Found by whoever needed a little luck today.'),
]);
export const SHELL_IDS = Object.freeze(SHELLS.map(s => s.id));
const BY_ID = new Map(SHELLS.map(s => [s.id, s]));
export const shellById = id => BY_ID.get(id) || null;

export const SETS = deepFreeze([
  { id: 'tidepool', name: 'Tidepool Set', ids: ['button', 'tiddly', 'pebble', 'piggy'], gift: [['shell', 3]] },
  { id: 'sunny', name: 'Sunny Beach Set', ids: ['sunfan', 'ribbon', 'butterfly', 'moonsnail'], gift: [['shell', 4], ['glass', 1]] },
  { id: 'deep', name: 'Deep Wonders Set', ids: ['crown', 'lantern', 'starry'], gift: [['shell', 6]] },
  { id: 'full', name: 'Full Shell Book', ids: SHELLS.map(s => s.id), gift: [['shellwreath', 1]] },
]);
const SET_IDS = new Set(SETS.map(s => s.id));

const U32 = 4294967296;
const fin = v => typeof v === 'number' && Number.isFinite(v);
const isSeed = s => Number.isInteger(s) && s >= 0 && s < U32;
// FNV-1a of a string (seafloor node ids are "cx,cz").
export function strHash(s) {
  let h = 0x811C9DC5;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// ---------------------------------------------------------------- sparkles
const sparkCache = new Map();
// Shell sparkles of an island: frozen [{i, x, z, y}] in island-local metres, in the wet sand band near
// the waterline, clear of gather nodes and buried treasure spots. Own RNG stream (layoutFor untouched).
export function sparklesFor(seed) {
  seed = seed >>> 0;
  const hit = sparkCache.get(seed);
  if (hit) return hit;
  const r = rng((seed ^ SHELLS_K) >>> 0), lay = layoutFor(seed), R = lay.R, dig = spotsFor(seed);
  const want = 2 + Math.floor(r() * 3);
  const C = SHELL_CFG, out = [];
  for (let k = 0; k < want; k++) {
    for (let tries = 0; tries < 360; tries++) {
      // small, crowded islands: after 240 tries the gaps relax (nodes 1.4 m, sparkles 2.2 m) so there are always 2-4
      const relax = tries >= 240, NG = relax ? C.NODE_GAP_MIN : C.NODE_GAP, SG = relax ? C.SPOT_GAP_MIN : C.SPOT_GAP;
      const a = r() * Math.PI * 2, u = SHORE_U - C.BAND + C.BAND * r();
      const rad = u * R * shape(a - lay.rot);
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad, y = groundHeight(rad, R, a - lay.rot);
      if (!(y >= C.MIN_Y)) continue;
      let ok = true;
      for (const n of lay.nodes) if ((n.x - x) ** 2 + (n.z - z) ** 2 < NG * NG) { ok = false; break; }
      if (ok) for (const s of dig) if ((s.x - x) ** 2 + (s.z - z) ** 2 < SG * SG) { ok = false; break; }
      if (ok) for (const s of out) if ((s.x - x) ** 2 + (s.z - z) ** 2 < SG * SG) { ok = false; break; }
      if (!ok) continue;
      out.push(Object.freeze({ i: out.length, x, z, y }));
      break;
    }
  }
  const res = Object.freeze(out);
  if (sparkCache.size >= 64) sparkCache.clear();
  sparkCache.set(seed, res);
  return res;
}

// Index of the closest untaken sparkle within reach of island-local (lx, lz), or -1. No allocation.
export function nearestSparkle(spots, taken, lx, lz, reach) {
  let best = -1, bd = reach * reach;
  if (!spots || !fin(lx) || !fin(lz)) return -1;
  for (let k = 0; k < spots.length; k++) {
    if (taken && taken[k]) continue;
    const s = spots[k], d = (s.x - lx) ** 2 + (s.z - lz) ** 2;
    if (d <= bd) { bd = d; best = k; }
  }
  return best;
}

// ---------------------------------------------------------------- kind roll
// Weights per kind for a place and its conditions (tier weight split evenly among the valid kinds).
export function weightsFor(place, cond = {}) {
  const valid = SHELLS.filter(s => s.where.includes(place) && (s.id !== 'crown' || !!cond.deep));
  const per = {};
  for (const t of Object.keys(RARITY)) per[t] = valid.filter(s => s.rarity === t).length;
  return valid.map(s => {
    let w = RARITY[s.rarity].weight / per[s.rarity];
    if (s.id === 'moonsnail' && cond.night) w *= 2;
    if (s.id === 'starry' && cond.storm) w *= 3;
    return [s.id, w];
  });
}
const condBits = c => (c && c.night ? 1 : 0) | (c && c.storm ? 2 : 0) | (c && c.deep ? 4 : 0);
// Deterministic kind for (seed, key) at a place ('beach' | 'sea') under cond {night, storm, deep}.
export function rollKind(seed, key, place, cond = {}) {
  const ws = weightsFor(place === 'sea' ? 'sea' : 'beach', cond);
  let total = 0; for (const [, w] of ws) total += w;
  let pick = hash3(seed >>> 0, key | 0, condBits(cond)) * total;
  for (const [id, w] of ws) { if (pick < w) return id; pick -= w; }
  return ws[ws.length - 1][0];
}

// ---------------------------------------------------------------- save slice
export const DEFAULTS = () => ({ v: 1, seed: null, taken: [], paid: 0, sea: { day: -1, n: 0, p: 0 }, book: {}, sets: [] });
const int = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);

// Validate a save / net slice. Never throws; always a fresh object (never aliases the input).
export function clean(data) {
  const out = DEFAULTS();
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
    if (isSeed(data.seed)) {
      out.seed = data.seed;
      const src = Array.isArray(data.taken) ? data.taken : [];
      const n = sparklesFor(data.seed).length;
      for (let k = 0; k < n; k++) out.taken.push(src[k] === 1 || src[k] === true ? 1 : 0);
      out.paid = int(data.paid, 0, PAY_CAP, 0);
    }
    const s = data.sea;
    if (s && typeof s === 'object' && !Array.isArray(s)) {
      out.sea.day = int(s.day, -1, 1e9, -1);
      out.sea.n = int(s.n, 0, SHELL_CFG.SEA_DAY, 0);
      out.sea.p = int(s.p, 0, SHELL_CFG.SEA_PAY_DAY, 0);
    }
    const b = data.book;
    if (b && typeof b === 'object' && !Array.isArray(b)) {
      for (const id of SHELL_IDS) {
        const e = b[id];
        if (!e || typeof e !== 'object') continue;
        const n = Number.isFinite(e.n) ? Math.min(SHELL_CFG.MAX_N, Math.max(1, Math.floor(e.n))) : 1;
        out.book[id] = { n, day: int(e.day, 0, 1e9, 0), by: e.by === 'guest' ? 'guest' : 'host' };
      }
    }
    if (Array.isArray(data.sets)) for (const id of data.sets) if (SET_IDS.has(id) && !out.sets.includes(id)) out.sets.push(id);
  } catch { return DEFAULTS(); }
  return out;
}

// ---------------------------------------------------------------- host checks
const okBag = bag => !!bag && Array.isArray(bag.slots) && typeof bag.snapshot === 'function';
const scratchOf = bag => { try { return new bag.constructor(bag.snapshot()); } catch { return null; } };
function commit(bag, scratch) {
  for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i];
  if (typeof bag.version === 'number') bag.version++;
}
const addAll = (bag, list) => { for (const [k, n] of list) if (bag.add(k, n) > 0) return false; return true; };

// Record one find of `kind` in st (repeat pays up to `room` Bright Shells), then the set gifts.
// Works on a scratch bag and commits only when the repeat payout fits. Returns the result object.
function record(st, kind, actor, bag, day, room) {
  const sp = BY_ID.get(kind), had = st.book[kind];
  const isNew = !had;
  const want = isNew ? 0 : RARITY[sp.rarity].pay;
  const n = Math.max(0, Math.min(want, room));
  const scratch = scratchOf(bag);
  if (!scratch) return { ok: false, reason: 'bag' };
  if (n > 0 && scratch.add('shell', n) > 0) return { ok: false, reason: 'full' };
  // the find counts; set gifts try one by one on top (a gift that does not fit waits for the next take)
  const pay = {}; if (n > 0) pay.shell = n;
  const sets = [];
  const book = { ...st.book, [kind]: isNew ? { n: 1, day: Number.isInteger(day) && day >= 0 ? day : 0, by: actor === 'guest' ? 'guest' : 'host' } : { ...had, n: Math.min(SHELL_CFG.MAX_N, had.n + 1) } };
  for (const s of SETS) {
    if (st.sets.includes(s.id) || !s.ids.every(id => book[id])) continue;
    const trial = scratchOf(scratch);
    if (!trial || !addAll(trial, s.gift)) continue;
    addAll(scratch, s.gift);
    for (const [k, c] of s.gift) pay[k] = (pay[k] || 0) + c;
    sets.push(s.id);
  }
  commit(bag, scratch);
  st.book = book;
  if (sets.length) st.sets = st.sets.concat(sets);
  return { ok: true, reason: null, kind, isNew, pay, paid: n, capped: !isNew && n < want, sets };
}

// Host beach take. st: the slice (mutated only on ok). a: {kind:'shells.take', seed, spot}.
// pos: the actor's island-local {x, z} (host's view of the actor). cond: {night, storm} at take time.
// Returns {ok, reason, kind, isNew, pay:{kind:n}, sets:[ids], capped}.
export function applyTake(st, a, actor, pos, bag, cond = {}, day = 0) {
  const no = reason => ({ ok: false, reason, kind: null, isNew: false, pay: {}, sets: [] });
  if (!st || !a || a.kind !== 'shells.take') return no('none');
  if (st.seed === null || st.seed === undefined || a.seed !== st.seed) return no('stale');
  const spots = sparklesFor(st.seed), k = a.spot;
  if (!Number.isInteger(k) || k < 0 || k >= spots.length) return no('none');
  if (st.taken[k]) return no('taken');
  if (!pos || !fin(pos.x) || !fin(pos.z)) return no('reach');
  const reach = SHELL_CFG.REACH + (actor === 'guest' ? ISLAND.GUEST_SLACK : 0);
  if ((pos.x - spots[k].x) ** 2 + (pos.z - spots[k].z) ** 2 > reach * reach) return no('reach');
  if (!okBag(bag)) return no('bag');
  const kind = rollKind(st.seed, k, 'beach', { night: !!cond.night, storm: !!cond.storm });
  const paid = Number.isInteger(st.paid) ? st.paid : 0;
  const r = record(st, kind, actor, bag, day, PAY_CAP - paid);
  if (!r.ok) return no(r.reason);
  st.taken[k] = 1;
  st.paid = paid + r.paid;
  return r;
}

// Host dive find after a seafloor gather. node: {id, type, y}. A sand node turns up a shell with a
// deterministic 15% chance per (node, day), at most 3 per game day. Repeats share the island's cap
// (PAY_CAP per seed) when one is in view, else a daily cap of 3. opts: {cond:{night, storm}, force}.
// Returns null (no find) or the applyTake-shaped result.
export function applySeaFind(st, node, actor, bag, day, opts = {}) {
  if (!st || !node || node.type !== 'sand' || typeof node.id !== 'string') return null;
  const d = Number.isInteger(day) && day >= 0 ? day : 0;
  const h = strHash(node.id);
  if (!opts.force && !(hash3(h, d, SEA_K) < SHELL_CFG.SEA_CHANCE)) return null;
  const sea = st.sea && st.sea.day === d ? st.sea : { day: d, n: 0, p: 0 };
  if (sea.n >= SHELL_CFG.SEA_DAY) return null;
  if (!okBag(bag)) return null;
  const deep = fin(node.y) && node.y < SHELL_CFG.DEEP_Y;
  const c = opts.cond || {};
  const kind = rollKind((h ^ SEA_K) >>> 0, d, 'sea', { night: !!c.night, storm: !!c.storm, deep });
  const island = st.seed !== null && st.seed !== undefined;
  const room = island ? PAY_CAP - (st.paid | 0) : SHELL_CFG.SEA_PAY_DAY - (sea.p | 0);
  const r = record(st, kind, actor, bag, d, room);
  if (!r.ok) return { ok: false, reason: r.reason, kind: null, isNew: false, pay: {}, sets: [] };
  if (island) st.paid = (st.paid | 0) + r.paid;
  st.sea = { day: d, n: sea.n + 1, p: (sea.p | 0) + (island ? 0 : r.paid) };
  return r;
}

// ---------------------------------------------------------------- book view
const giftText = gift => gift.map(([k, n]) => (k === 'shell' ? `${n} Bright Shell${n === 1 ? '' : 's'}` : k === 'glass' ? `${n} Glass` : k === 'shellwreath' ? `${n === 1 ? 'a' : n} Shell Wreath` : `${n} ${k}`)).join(' + ');
export function bookView(st) {
  const s = st || DEFAULTS(), book = s.book || {}, got = Array.isArray(s.sets) ? s.sets : [];
  const cards = SHELLS.map(sp => {
    const e = book[sp.id], R = RARITY[sp.rarity];
    return {
      id: sp.id, svg: sp.svg, known: !!e, name: e ? sp.name : '???', rarity: sp.rarity, rarityLabel: R.label, color: R.color,
      note: e ? sp.note : null, n: e ? e.n : 0, day: e ? e.day + 1 : 0, by: e ? e.by : null,
      hint: sp.where.includes('beach') ? 'Found on beaches' : 'Found while diving',
    };
  });
  const sets = SETS.map(st2 => ({ id: st2.id, name: st2.name, have: st2.ids.filter(id => book[id]).length, need: st2.ids.length, gift: giftText(st2.gift), done: got.includes(st2.id) }));
  const found = cards.filter(c => c.known).length;
  const sig = cards.map(c => c.n).join(',') + '|' + got.join(',') + '|' + cards.map(c => (c.by ? c.by[0] : '-')).join('');
  return { sig, badge: `${found}/${SHELLS.length}`, found, total: SHELLS.length, cards, sets };
}
