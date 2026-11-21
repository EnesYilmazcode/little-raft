// Crew tasks rules (see docs/specs/tasks.md). Pure: no DOM, no THREE, no Date, no Math.random.
// Three small cozy tasks per in-game day, shared by the crew; each crew member claims their own reward.
// Bits: 1 = host (or solo), 2 = guest.
import { DAY_SECONDS, hash01 as dnHash } from './daynight.js?build=v3-survival-ae77fa84ac2b';

export { DAY_SECONDS };
export const TASK_COUNT = 3;
export const BONUS = Object.freeze({ rope: 1, wood: 2 });
export const OWED_KINDS = 8, OWED_MAX = 99;
// Friendly names for reward kinds (rewards only ever use these).
export const NAMES = Object.freeze({ wood: 'plank', leaf: 'leaf', rope: 'rope', plastic: 'plastic', scrap: 'scrap' });

const n0 = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const T = (id, label, target, reward, count, need) => Object.freeze({ id, label, target, reward: Object.freeze(reward), count, need: need ?? null });

// ids are save keys: never rename, only append.
export const POOL = Object.freeze([
  T('planks', 'Hook 6 planks', 6, { leaf: 2 }, e => (e.kind === 'collect' ? n0(e.loot?.wood) : 0)),
  T('leaves', 'Gather 4 leaf bundles', 4, { wood: 2 }, e => (e.kind === 'collect' ? n0(e.loot?.leaf) : 0)),
  T('barrels', 'Open 2 barrels', 2, { rope: 1 }, e => (e.kind === 'collect' && e.type === 'barrel' ? 1 : 0)),
  T('jugs', 'Fish out 2 plastic jugs', 2, { wood: 2 }, e => (e.kind === 'collect' ? n0(e.loot?.plastic) : 0)),
  T('net', 'Let a net catch 3 things', 3, { scrap: 2 }, e => (e.kind === 'collect' && e.net ? 1 : 0), 'net'),
  T('fish', 'Catch 2 fish', 2, { leaf: 2, wood: 1 }, e => (e.kind === 'fish' ? 1 : 0), 'rod'),
  T('fish4', 'Catch 4 fish', 4, { rope: 1, scrap: 1 }, e => (e.kind === 'fish' ? 1 : 0), 'rod'),
  T('cook', 'Cook a tasty meal', 1, { wood: 2, leaf: 1 }, e => (e.kind === 'cook' ? 1 : 0), 'grill'),
  T('craft3', 'Craft 3 things', 3, { scrap: 1, wood: 1 }, e => (e.kind === 'craft' ? 1 : 0)),
  T('rope', 'Twist a rope', 1, { leaf: 2 }, e => (e.kind === 'craft' && e.item === 'rope' ? 1 : 0)),
  T('floor', 'Add 2 floor tiles', 2, { wood: 2 }, e => (e.kind === 'build' && e.recipe === 'floor' ? 1 : 0), 'hammer'),
  T('decor', 'Place a decoration', 1, { plastic: 1 }, e => (e.kind === 'build' && typeof e.recipe === 'string' && e.recipe !== 'floor' ? 1 : 0)),
  T('water', 'Water a palm', 1, { leaf: 2 }, e => (e.kind === 'water' ? 1 : 0), 'palm'),
  T('harvest', 'Harvest a palm', 1, { wood: 2 }, e => (e.kind === 'harvest' ? 1 : 0), 'palm'),
  T('island', 'Gather on an island', 1, { rope: 1 }, e => (e.kind === 'gather' ? 1 : 0)),
  T('bottle', 'Find a message in a bottle', 1, { scrap: 2 }, e => (e.kind === 'bottle' ? 1 : 0), 'notesLeft'),
]);
export const BY_ID = Object.freeze(Object.fromEntries(POOL.map(t => [t.id, t])));

/** Same mixer as daynight.js hash01; (seed, day, index) -> [0, 1). */
export const hash01 = (seed, day, index) => dnHash(seed, day, index);

/** 3 distinct ids for (seed, day), skipping tasks whose `need` is not true in `needs`. */
export function pick(seed, day, needs) {
  const nd = needs && typeof needs === 'object' ? needs : {};
  const scored = POOL.map((t, i) => [hash01(seed >>> 0, day | 0, i), t]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [, t] of scored) {
    if (out.length >= TASK_COUNT) break;
    if (t.need && nd[t.need] !== true) continue;
    out.push(t.id);
  }
  return out;
}

const clampInt = (v, lo, hi, d = lo) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : d);
const isPlain = v => !!v && typeof v === 'object' && !Array.isArray(v);

function cleanBundle(v) {
  const out = {};
  if (!isPlain(v)) return out;
  let n = 0;
  for (const k of Object.keys(v)) {
    if (n >= OWED_KINDS) break;
    if (!Object.prototype.hasOwnProperty.call(NAMES, k)) continue;
    const c = clampInt(v[k], 0, OWED_MAX, 0); if (c < 1) continue;
    out[k] = c; n++;
  }
  return out;
}

export function freshTasks(seed, needs, day = 0) {
  const s = (typeof seed === 'number' && Number.isFinite(seed) ? seed : 0) >>> 0;
  return { v: 1, seed: s, day, ids: pick(s, day, needs), prog: [0, 0, 0], claimed: [0, 0, 0], bonus: 0, streak: 0, best: 0, playT: 0, owed: [{}, {}], seen: 1 };
}

/** Validated slice. Non-object -> fresh (seed given, day 0). Never retro-completes anything. */
export function cleanTasks(v, needs, seed = 0) {
  if (!isPlain(v)) return freshTasks(seed, needs);
  const s = typeof v.seed === 'number' && Number.isFinite(v.seed) ? v.seed >>> 0 : seed >>> 0;
  const day = clampInt(v.day, 0, 1e9, 0);
  const raw = Array.isArray(v.ids) ? v.ids : [];
  const okIds = raw.length === TASK_COUNT && raw.every(id => typeof id === 'string' && BY_ID[id]) && new Set(raw).size === TASK_COUNT;
  const ids = okIds ? raw.slice() : pick(s, day, needs);
  const arr = (a, i, hi) => (Array.isArray(a) ? clampInt(a[i], 0, hi, 0) : 0);
  const prog = ids.map((id, i) => (okIds ? arr(v.prog, i, BY_ID[id].target) : 0));
  const claimed = ids.map((_, i) => (okIds ? arr(v.claimed, i, 3) : 0));
  const best = clampInt(v.best, 0, 1e6, 0), streak = clampInt(v.streak, 0, 1e6, 0);
  const owed = Array.isArray(v.owed) ? [cleanBundle(v.owed[0]), cleanBundle(v.owed[1])] : [{}, {}];
  return {
    v: 1, seed: s, day, ids, prog, claimed, bonus: okIds ? clampInt(v.bonus, 0, 3, 0) : 0,
    seen: clampInt(v.seen, 0, 3, 1) | 1,
    streak, best: Math.max(best, streak), playT: typeof v.playT === 'number' && Number.isFinite(v.playT) ? Math.min(DAY_SECONDS, Math.max(0, v.playT)) : 0, owed,
  };
}

export const isDone = (st, i) => !!BY_ID[st.ids[i]] && st.prog[i] >= BY_ID[st.ids[i]].target;
export const allDone = st => st.ids.every((_, i) => isDone(st, i));

/** Count a host event toward today's unfinished tasks. Returns the indices that just finished. */
export function observeTasks(st, ev) {
  const fin = [];
  if (!ev || typeof ev !== 'object' || typeof ev.kind !== 'string') return fin;
  const wasAll = allDone(st);
  for (let i = 0; i < st.ids.length; i++) {
    const t = BY_ID[st.ids[i]]; if (!t || st.prog[i] >= t.target) continue;
    let n = 0; try { n = n0(t.count(ev)); } catch { n = 0; }
    if (!n) continue;
    st.prog[i] = Math.min(t.target, st.prog[i] + n);
    if (st.prog[i] >= t.target) fin.push(i);
  }
  if (fin.length && !wasAll && allDone(st)) { st.streak++; st.best = Math.max(st.best, st.streak); }
  return fin;
}

function addOwed(st, slot, bundle) {
  const o = st.owed[slot];
  for (const [k, c] of Object.entries(bundle)) {
    if (!(k in o) && Object.keys(o).length >= OWED_KINDS) continue;
    o[k] = Math.min(OWED_MAX, (o[k] ?? 0) + c);
  }
}

/**
 * Advance `k` days: unclaimed rewards move to owed (only for seats in `st.seen`, the crew members aboard
 * that day; a missing mask owes both), streak breaks unless all 3 were done (k === 1).
 */
export function rollTasks(st, k, needs) {
  const n = Math.floor(k);
  if (!(n >= 1)) return false;
  const all = allDone(st), seen = Number.isInteger(st.seen) ? st.seen | 1 : 3;
  const bits = [1, 2].filter(b => seen & b);
  for (let i = 0; i < st.ids.length; i++) {
    if (!isDone(st, i)) continue;
    for (const bit of bits) if (!(st.claimed[i] & bit)) addOwed(st, bit - 1, BY_ID[st.ids[i]].reward);
  }
  if (all) for (const bit of bits) if (!(st.bonus & bit)) addOwed(st, bit - 1, BONUS);
  if (!all || n > 1) st.streak = 0;
  st.day += n;
  st.ids = pick(st.seed, st.day, needs);
  st.prog = [0, 0, 0]; st.claimed = [0, 0, 0]; st.bonus = 0; st.seen = 1;
  return true;
}

export const bitOf = actor => (actor === 'guest' ? 2 : 1);

/**
 * Claim one reward for `actor`. a.i = 0..2 | 'bonus' | 'owed'. addAll(bundle) -> bool must add every
 * kind or nothing. Returns {ok, loot} or {ok:false, reason:'bad'|'notdone'|'claimed'|'empty'|'full'}.
 */
export function claimTasks(st, a, actor, addAll) {
  const bit = bitOf(actor), i = a?.i;
  let bundle, commit;
  if (i === 'owed') {
    bundle = st.owed[bit - 1];
    if (!Object.keys(bundle).length) return { ok: false, reason: 'empty' };
    bundle = { ...bundle }; commit = () => { st.owed[bit - 1] = {}; };
  } else if (i === 'bonus') {
    if (!allDone(st)) return { ok: false, reason: 'notdone' };
    if (st.bonus & bit) return { ok: false, reason: 'claimed' };
    bundle = { ...BONUS }; commit = () => { st.bonus |= bit; };
  } else if (Number.isInteger(i) && i >= 0 && i < st.ids.length) {
    if (!isDone(st, i)) return { ok: false, reason: 'notdone' };
    if (st.claimed[i] & bit) return { ok: false, reason: 'claimed' };
    bundle = { ...BY_ID[st.ids[i]].reward }; commit = () => { st.claimed[i] |= bit; };
  } else return { ok: false, reason: 'bad' };
  if (typeof addAll !== 'function' || !addAll(bundle)) return { ok: false, reason: 'full' };
  commit(); st.seen = (Number.isInteger(st.seen) ? st.seen : 1) | bit;
  return { ok: true, loot: bundle };
}

export const bundleText = b => Object.entries(b || {}).map(([k, c]) => `${c} ${NAMES[k] ?? k}`).join(' · ');

/** Plain view for the logbook Tasks tab, from the point of view of `bit` (1 host, 2 guest). */
export function taskView(st, bit) {
  const b = bit === 2 ? 2 : 1;
  const rows = st.ids.map((id, i) => {
    const t = BY_ID[id], done = isDone(st, i), claimed = !!(st.claimed[i] & b);
    return { id, label: t.label, n: st.prog[i], target: t.target, done, reward: bundleText(t.reward), canClaim: done && !claimed, claimed };
  });
  const all = allDone(st), bc = !!(st.bonus & b);
  const owed = bundleText(st.owed[b - 1]);
  const v = { day: st.day + 1, rows, bonus: { done: all, canClaim: all && !bc, claimed: bc, reward: bundleText(BONUS) }, owed, streak: st.streak, best: st.best };
  v.claimable = rows.filter(r => r.canClaim).length + (v.bonus.canClaim ? 1 : 0) + (owed ? 1 : 0);
  v.doneCount = rows.filter(r => r.done).length;
  v.sig = JSON.stringify([v.day, rows.map(r => [r.id, r.n, r.claimed]), all, bc, owed, v.streak, v.best]);
  return v;
}

/** QA helper: finish task i outright (streak handled like observeTasks). Returns true if it just finished. */
export function completeTask(st, i) {
  const t = BY_ID[st.ids[i]]; if (!t || st.prog[i] >= t.target) return false;
  const wasAll = allDone(st);
  st.prog[i] = t.target;
  if (!wasAll && allDone(st)) { st.streak++; st.best = Math.max(st.best, st.streak); }
  return true;
}
