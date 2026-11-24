// Storage chests (see docs/features/storage-research.md).
// The placed Crate decor becomes a 12-slot chest. Slice: world.ext.storage. Host-authoritative actions 'storage.*'.
// The old research half (the 'research' Tinker's Desk) no longer gates any recipe: research-tree.js and
// progression-hooks.js run the one Research Table, and a placed desk opens that. This module still loads
// and saves the desk's seen/learned lists, so recipes a save learned here stay learned (pastLearned()).
// The top half of this file is pure (no DOM, no THREE) and exported for tests.
import { Bag, RECIPES, ITEM_INFO, SLOT_COUNT, HOTBAR_SIZE } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { buildResearchTable } from './storage-research-model.js?build=v3-survival-ae77fa84ac2b';

export const CHEST_SLOTS = 12;
export const MAX_CHESTS = 400;
export const REACH = 3.2;             // metres from the actor to the tile centre
export const STARTER = Object.freeze(['rope', 'hook', 'hammer', 'crate', 'research', 'nestbox']);
export const LOCK_REASON = 'Study it first at a Tinker\u2019s Desk';
export const MAX_SLICE_CHARS = 150000; // a put that would grow the JSON slice past this is refused (content.js caps all of ext at 200k)
export const OLD_HOST = 'Your friend’s raft doesn’t have chests yet';
const NOTHING_NEW = 'That doesn’t teach anything new';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isInt = Number.isInteger;
const isIndex = (i, n) => isInt(i) && i >= 0 && i < n;
const isKind = k => typeof k === 'string' && hasOwn(ITEM_INFO, k);
const maxStack = k => ITEM_INFO[k]?.maxStack ?? 1;
const nameOf = k => ITEM_INFO[k]?.name ?? RECIPES[k]?.name ?? String(k);
const keyOf = (x, z) => x + ',' + z;
const sortedUnique = a => [...new Set(a)].sort();

// ------------------------------------------------------------------ recipe tree

// Recipes another system unlocks (game.js hands in the progression catalogue: items.js owns those unlocks,
// so this table only teaches the rest). Default: none, i.e. the table gates every RECIPES entry.
let ownedElsewhere = () => false;
export function setOwnedElsewhere(fn) { ownedElsewhere = typeof fn === 'function' ? fn : () => false; }
export const recipeIds = () => Object.keys(RECIPES);
/** Every kind that appears in any recipe cost. */
export function ingredientKinds() {
  const out = new Set();
  for (const r of Object.values(RECIPES)) for (const k of Object.keys(r.cost || {})) out.add(k);
  return [...out].sort();
}
/** Learned list (sorted, unique, beyond STARTER): the old list plus every recipe whose cost kinds are all seen. */
export function learnedFrom(seen, learned = []) {
  const s = new Set(seen), out = new Set(learned);
  for (const [id, r] of Object.entries(RECIPES)) {
    if (STARTER.includes(id) || ownedElsewhere(id)) continue;
    if (Object.keys(r.cost || {}).every(k => s.has(k))) out.add(id);
  }
  return [...out].sort();
}
export const isLearned = (state, id) => STARTER.includes(id) || state.all === true || state.learned.includes(id) || !!ownedElsewhere(id);
/** Recipe ids that are still locked for this state. */
export function lockedRecipes(state) {
  return Object.keys(RECIPES).filter(id => !isLearned(state, id));
}
/** Kinds the table accepts right now: ingredients of a locked recipe that are not yet seen. */
export function researchableKinds(state) {
  const out = new Set();
  for (const id of lockedRecipes(state)) for (const k of Object.keys(RECIPES[id].cost || {})) if (!state.seen.includes(k)) out.add(k);
  return [...out].sort();
}

// ------------------------------------------------------------------ validation

const BLANK = new Array(SLOT_COUNT).fill(null);
/** One slot through Bag's own rules (kind, count, maxStack, durability). Bad -> null. */
export function cleanSlot(raw) {
  if (raw === null || raw === undefined) return null;
  try { const snap = BLANK.slice(); snap[0] = raw; return new Bag({ slots: snap, selected: 0 }).slots[0]; } catch { return null; }
}
export function cleanChest(raw) {
  const out = new Array(CHEST_SLOTS).fill(null);
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < CHEST_SLOTS && i < raw.length; i++) out[i] = cleanSlot(raw[i]);
  return out;
}
const chestEmpty = c => c.every(s => !s);
const kindList = v => (Array.isArray(v) && v.every(k => typeof k === 'string' && k.length > 0 && k.length < 40) ? sortedUnique(v) : null);

/** Validate a world.ext.storage slice field by field. Never throws. Bad fields come back as null. */
export function cleanSlice(data) {
  const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const chests = {};
  let n = 0;
  if (d.chests && typeof d.chests === 'object' && !Array.isArray(d.chests)) {
    for (const k of Object.keys(d.chests)) {
      if (n >= MAX_CHESTS) break;
      const m = /^(-?\d{1,2}(?:\.\d{1,3})?),(-?\d{1,2}(?:\.\d{1,3})?)$/.exec(k); if (!m) continue; // free placement: fractional crate spots
      const x = +m[1], z = +m[2]; if (Math.abs(x) > 25 || Math.abs(z) > 25) continue;
      const c = cleanChest(d.chests[k]); if (chestEmpty(c)) continue;
      chests[keyOf(x, z)] = c; n++;
    }
  }
  return {
    chests,
    seen: kindList(d.seen),
    learned: kindList(d.learned),
    legacy: d.legacy === true, // set once when an old save was grandfathered; kept so the save remembers why (QA via debug.state)
    r: isInt(d.r) && d.r >= 0 && d.r < Number.MAX_SAFE_INTEGER ? d.r : 0,
    s: typeof d.s === 'string' && d.s.length <= 24 ? d.s : '',
  };
}

const bagKinds = snap => (snap && Array.isArray(snap.slots) ? snap.slots.map(s => s && s.kind).filter(Boolean) : []);
/** True when the world shows play, matching the built/untouched test in game.js bagsFromWorld(). */
export function isProgressed(w) {
  if (!w || typeof w !== 'object') return false;
  if ((Array.isArray(w.tiles) && w.tiles.length > 9) || (Array.isArray(w.decor) && w.decor.length > 0)) return true;
  if (w.collected > 0 || w.fish > 0) return true;
  const outputs = new Set(Object.values(RECIPES).map(r => r.output.kind)); outputs.delete('hook');
  for (const k of [...bagKinds(w.hostInventory), ...bagKinds(w.guestInventory)]) if (outputs.has(k)) return true;
  if (!w.hostInventory || !Array.isArray(w.hostInventory.slots)) { // legacy stock-only save: anything but the untouched kit counts
    const s = w.stock && typeof w.stock === 'object' ? w.stock : {};
    const n = k => (isInt(s[k]) && s[k] > 0 ? s[k] : 0);
    if (!(n('wood') === 5 && n('leaf') === 3 && n('scrap') === 1 && !n('plastic'))) return true;
  }
  return false;
}

/** Turn a slice (maybe undefined/garbage) into live state, applying the backward-compat rules. */
export function stateFrom(data, from, world) {
  const c = cleanSlice(data);
  const st = { chests: c.chests, seen: [], learned: [], legacy: c.legacy, all: false, r: c.r, s: c.s };
  if (from === 'net') {
    if (data === undefined || c.learned === null) st.all = true; // old host without this module allows every craft
    st.seen = c.seen ?? []; st.learned = c.learned ?? [];
    return st;
  }
  if (c.learned === null) { // old save (or bad list): grandfather progressed worlds
    if (isProgressed(world)) { st.seen = ingredientKinds(); st.learned = learnedFrom(st.seen, recipeIds().filter(id => !STARTER.includes(id))); st.legacy = true; }
    else { st.seen = c.seen ?? []; st.learned = learnedFrom(st.seen); }
    return st;
  }
  st.seen = c.seen ?? [];
  st.learned = learnedFrom(st.seen, c.learned);
  return st;
}

export function sliceOf(st) {
  const chests = {};
  for (const k of Object.keys(st.chests)) chests[k] = st.chests[k].map(s => (s ? { ...s } : null));
  const out = { v: 1, chests, seen: st.seen.slice(), learned: st.learned.slice(), r: st.r, s: st.s };
  if (st.legacy) out.legacy = true;
  return out;
}

// ------------------------------------------------------------------ stack moves (pure, in place)

/**
 * Move up to `amount` items from src[i] into dst. With `to`, only that slot (empty or same stackable kind).
 * Without, merge into partial stacks first, then empty slots (index order). Returns the count moved.
 * Items are moved, never created. Tools travel as whole slots, keeping their durability.
 */
export function moveStack(src, i, dst, to, amount) {
  const s = src[i]; if (!s) return 0;
  const want = amount === undefined || amount === null ? s.count : Math.min(amount, s.count);
  if (!(want >= 1)) return 0;
  const max = maxStack(s.kind);
  let left = want;
  const place = j => {
    const d = dst[j];
    if (!d) {
      if (left === s.count) { dst[j] = s; src[i] = null; left = 0; return; } // whole slot keeps durability / id
      const put = Math.min(max, left); dst[j] = { kind: s.kind, count: put }; s.count -= put; left -= put; return;
    }
    if (d.kind !== s.kind || max <= 1 || d.count >= max) return;
    const put = Math.min(max - d.count, left); d.count += put; s.count -= put; left -= put;
    if (s.count === 0) src[i] = null;
  };
  if (to !== undefined && to !== null) place(to);
  else {
    if (max > 1) for (let j = 0; j < dst.length && left > 0; j++) if (dst[j] && dst[j].kind === s.kind && dst[j].count < max) place(j);
    for (let j = 0; j < dst.length && left > 0 && src[i]; j++) if (!dst[j]) place(j);
  }
  return want - left;
}
/** Every non-hotbar bag stack (HOTBAR_SIZE..27) into the chest while it fits. Returns the count moved. */
export function putAll(bagSlots, chest) {
  let n = 0;
  for (let i = HOTBAR_SIZE; i < bagSlots.length; i++) if (bagSlots[i]) n += moveStack(bagSlots, i, chest, null, null);
  return n;
}

// ------------------------------------------------------------------ actions

const copySlot = s => (s ? { ...s } : null);
const sameSlot = (a, b) => a === b || (!!a && !!b && a.kind === b.kind && a.count === b.count && a.durability === b.durability);
/** JSON length of the slice with chest `key` replaced by `chest` (null = removed). */
export function sliceChars(st, key, chest) {
  const chests = { ...st.chests };
  if (chest && !chestEmpty(chest)) chests[key] = chest; else delete chests[key];
  return JSON.stringify({ v: 1, chests, seen: st.seen, learned: st.learned, r: st.r, s: st.s, legacy: st.legacy }).length;
}
const optIndex = (v, n) => v === undefined || v === null || isIndex(v, n);
const expectOk = (e, s) => !!(e && typeof e === 'object' && s && e.kind === s.kind && e.count === s.count);

/**
 * Apply one 'storage.*' action to `st` and the actor's `bag` (anything with a 28-length .slots array).
 * env: { decorAt(x,z) -> type|null, pos(actor) -> {x,z}|null }. Everything is checked before anything
 * changes, then chest, bag and r change together. Returns {ok, reason?, moved?, learned?, kind?}.
 */
export function applyStorageAction(st, a, actor, bag, env) {
  const no = reason => ({ ok: false, reason });
  if (!a || typeof a !== 'object' || typeof a.kind !== 'string') return no('bad');
  const verb = a.kind.slice(8);
  if (!['put', 'take', 'putAll', 'research'].includes(verb)) return no('bad');
  if (!bag || !Array.isArray(bag.slots) || bag.slots.length !== SLOT_COUNT) return no('bad');
  if (!Number.isFinite(a.x) || !Number.isFinite(a.z) || Math.abs(a.x) > 25 || Math.abs(a.z) > 25) return no('bad'); // free placement: fractional tile units
  const type = env?.decorAt?.(a.x, a.z) ?? null;
  if (type !== (verb === 'research' ? 'research' : 'crate')) return no('missing');
  const p = env?.pos?.(actor);
  if (actor === 'guest' && !p) return no('reach'); // no guest pose yet: we cannot tell where they stand
  if (p && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.hypot(p.x - a.x * 2, p.z - a.z * 2) > REACH) return no('reach');
  const key = keyOf(a.x, a.z), slots = bag.slots;

  if (verb === 'research') {
    if (!isIndex(a.slot, SLOT_COUNT)) return no('bad');
    const s = slots[a.slot];
    if (!s || !a.expect || typeof a.expect !== 'object' || a.expect.kind !== s.kind) return no('expect');
    if (!researchableKinds(st).includes(s.kind)) return no('nothing');
    const before = st.learned;
    s.count -= 1; if (s.count <= 0) slots[a.slot] = null;
    st.seen = sortedUnique([...st.seen, s.kind]);
    st.learned = learnedFrom(st.seen, st.learned);
    st.r++;
    return { ok: true, kind: s.kind, learned: st.learned.filter(id => !before.includes(id)) };
  }

  // Work on copies so a refusal (including the size cap below) changes nothing.
  const old = st.chests[key];
  const chest = old ? old.map(copySlot) : new Array(CHEST_SLOTS).fill(null), bagCopy = slots.map(copySlot);
  let moved = 0;
  if (verb === 'put' || verb === 'take') {
    const [srcArr, srcN, dstArr, dstN] = verb === 'put' ? [bagCopy, SLOT_COUNT, chest, CHEST_SLOTS] : [chest, CHEST_SLOTS, bagCopy, SLOT_COUNT];
    if (!isIndex(a.from, srcN) || !optIndex(a.to, dstN)) return no('bad');
    const s = srcArr[a.from];
    if (!s) return no('empty');
    if (!expectOk(a.expect, s)) return no('expect');
    if (!(a.amount === undefined || a.amount === null || (isInt(a.amount) && a.amount >= 1 && a.amount <= s.count))) return no('bad');
    if (a.to !== undefined && a.to !== null && dstArr[a.to] && dstArr[a.to].kind !== s.kind) return no('slotTaken');
    moved = moveStack(srcArr, a.from, dstArr, a.to, a.amount);
    if (!moved) return no(verb === 'put' ? 'chestFull' : 'bagFull');
  } else {
    moved = putAll(bagCopy, chest);
    if (!moved) return no(slots.slice(HOTBAR_SIZE).some(Boolean) ? 'chestFull' : 'nothingToPut');
  }
  if (verb !== 'take') {
    const after = sliceChars(st, key, chest);
    if (after > MAX_SLICE_CHARS && after > sliceChars(st, key, old ?? null)) return no('tooBig');
  }
  for (let i = 0; i < SLOT_COUNT; i++) if (!sameSlot(slots[i], bagCopy[i])) slots[i] = bagCopy[i]; // untouched slots keep their objects
  if (chestEmpty(chest)) delete st.chests[key]; else st.chests[key] = chest;
  st.r++;
  return { ok: true, moved };
}

const REFUSALS = {
  missing: 'That spot has nothing to open', reach: 'Step a little closer', nothing: NOTHING_NEW,
  chestFull: 'The crate is full', bagFull: 'Your bag is full', nothingToPut: 'Nothing in your backpack to store',
  slotTaken: 'That slot already holds something else', expect: 'Someone moved that — try again', empty: 'Someone moved that — try again',
  tooBig: 'Your crates are stuffed! Try stacking things together first',
};

// ------------------------------------------------------------------ the content module

export function createStorage(ctx) {
  const T = ctx.T;
  const session = Math.random().toString(36).slice(2, 10);
  let st = stateFrom(undefined, 'save', null); st.s = session;
  let cache = null, cacheSt = null, cacheR = -1, netR = -1, netS = null, ver = 0; // ver: local view revision (UI repaint)
  let ui = null, uiLoading = null, uiFailed = false, model = null, flicker = 0;
  let hostHasStorage = true, netUndef = false; // guest aboard an old host: no slice at all
  const fresh = new Set(); // learned this session, glow once in the craft list
  const scratch = T ? new T.Vector3() : null;

  let past = null; // learned list of the last save load (pastLearned); null while on a host's raft
  const decorAt = (x, z) => { const d = ctx.world?.decor; if (!Array.isArray(d)) return null; for (let i = 0; i < d.length; i++) if (d[i].x === x && d[i].z === z) return d[i].type; return null; };
  const posOf = actor => { if (actor === 'guest') return ctx.other ?? null; const p = ctx.physics; return p ? { x: p.x, z: p.z } : null; };
  const bump = () => { st.r++; ver++; };
  const dropKey = k => { if (ctx.role === 'guest' || !st.chests[k]) return false; delete st.chests[k]; bump(); return true; }; // [undecor]

  // Nearest crate/research decor along the view ray (or the camera forward when no aim), within reach.
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (d.type !== 'crate') continue; // a placed desk is a Research Table now (progression-hooks.js)
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      const cy = (ctx.raft?.position.y ?? 0) + .65;
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > .85) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  function loadUI() {
    if (ui || uiLoading || uiFailed || typeof document === 'undefined') return uiLoading;
    uiLoading = import('./storage-research-ui.js?build=v3-survival-ae77fa84ac2b').then(m => { ui = m.createStorageUI(api); return ui; })
      .catch(e => { console.error('storage ui failed', e); uiFailed = true; uiLoading = null; return null; }); // no retry every frame
    return uiLoading;
  }
  // Still worth opening after an async UI load? (nothing else open, decor still there, still in reach)
  function stillThere(type, x, z) {
    if (ctx.uiOpen?.()) return false;
    if (decorAt(x, z) !== type) return false;
    const p = ctx.physics;
    return !p || Math.hypot(p.x - x * 2, p.z - z * 2) <= REACH + .8;
  }
  function open(type, x, z) {
    if (ui) { ctx.releaseLock?.(); ui.open(type, x, z); return true; }
    const p = loadUI(); if (!p) return false;
    p.then(u => { if (!u || !stillThere(type, x, z)) return; ctx.releaseLock?.(); u.open(type, x, z); });
    return true;
  }
  const oldHost = () => ctx.role === 'guest' && !hostHasStorage;

  function run(a, actor, bag) {
    const res = applyStorageAction(st, a, actor, bag, { decorAt, pos: posOf });
    if (res.ok || res.reason === 'expect' || res.reason === 'empty') ver++; // stale click: repaint the panel at once
    if (res.ok && a.kind === 'storage.research') {
      if (res.learned.length) for (const id of res.learned) { fresh.add(id); ctx.emit({ kind: 'craft', text: `New recipe: ${nameOf(id)}!` }, 'all'); }
      else ctx.emit({ kind: 'notice', text: `Researched ${nameOf(res.kind)}! It helps with something new` }, actor);
    } else if (!res.ok && REFUSALS[res.reason]) ctx.emit({ kind: 'notice', text: REFUSALS[res.reason] }, actor);
    return res;
  }

  // Interface used by the UI (kept tiny so the UI never touches engine internals).
  const api = {
    ctx,
    get state() { return st; },
    get rev() { return ver; },
    chestAt: (x, z) => st.chests[keyOf(x, z)] ?? null,
    decorAt,
    bag: () => ctx.localBag(),
    send: a => { ctx.action(a); },
    researchable: () => researchableKinds(st),
    locked: () => [], // the desk gates nothing any more: no lock badges in the craft list
    isLearned: () => true,
    hasTable: () => { // a Research Table placed on the raft or carried in the local bag (no allocations)
      const d = ctx.world?.decor; if (Array.isArray(d)) for (let i = 0; i < d.length; i++) if (d[i].type === 'research') return true;
      const s = ctx.localBag()?.slots; if (s) for (let i = 0; i < s.length; i++) if (s[i] && s[i].kind === 'research') return true;
      return false;
    },
    takeFresh: () => { const out = [...fresh]; fresh.clear(); return out; },
    nameOf,
    reach: REACH,
  };

  function load(data, from) {
    if (from === 'net') {
      if (data && typeof data === 'object' && data.r === netR && data.s === netS) return; // unchanged host state
      if (data === undefined && netUndef) return; // old host, still no slice: nothing to rebuild
      netUndef = data === undefined; hostHasStorage = data !== undefined;
      st = stateFrom(data, 'net', ctx.world); past = null;
      netR = data && typeof data === 'object' ? data.r : -1; netS = data && typeof data === 'object' ? data.s : null;
      ver++;
      return;
    }
    netR = -1; netS = null; netUndef = false; hostHasStorage = true;
    st = stateFrom(data, from, ctx.world);
    st.s = session; bump();
    past = st.learned.slice(); // a new array per load: progression-hooks.js adopts it once
  }

  function serialize() {
    if (cache && cacheSt === st && cacheR === st.r) return cache;
    cache = sliceOf(st); cacheSt = st; cacheR = st.r;
    return cache;
  }

  return {
    name: 'storage',
    serialize,
    load,
    action(a, actor, bag) {
      if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('storage.')) return false;
      run(a, actor, bag);
      return true;
    },
    // A foundation the shark tore off takes its crate's contents with it (game.js calls this on the host).
    dropTile(x, z) { let any = false; for (const k of Object.keys(st.chests)) { const c = k.indexOf(','); if (Math.round(+k.slice(0, c)) === x && Math.round(+k.slice(c + 1)) === z) any = dropKey(k) || any; } return any; }, // [undecor] shares the delete with afterUndecor; free placement: every crate centred on that tile
    undecorLoot(d) { // [undecor] every chest slot comes back, tools keep their wear
      if (d?.type !== 'crate') return null; const c = st.chests[keyOf(d.x, d.z)]; if (!c) return null;
      const out = []; for (const s of c) if (s) out.push(s.durability !== undefined || s.id !== undefined ? [s.kind, s.count, { ...(s.durability !== undefined ? { durability: s.durability } : {}), ...(s.id !== undefined ? { id: s.id } : {}) }] : [s.kind, s.count]);
      return out;
    },
    afterUndecor(d) { if (d?.type !== 'crate') return; const o = ui?.openInfo(); if (o && o.x === d.x && o.z === d.z) ui.close(); dropKey(keyOf(d.x, d.z)); }, // [undecor]
    craftLocked() { return null; }, // research-tree.js gates recipes now
    pastLearned() { return past; }, // recipe ids this save learned at the old desk (all of them for a grandfathered save)
    interact(aim) {
      const d = target(aim); if (!d) return false;
      if (oldHost()) { ctx.notice?.(OLD_HOST, 2400); return true; }
      return open(d.type, d.x, d.z);
    },
    prompt(aim) {
      const d = target(aim); if (!d) return null;
      if (oldHost()) return OLD_HOST;
      return '<kbd>E</kbd>Open crate';
    },
    decorModel(type) {
      if (type !== 'research' || !T) return null;
      model ??= buildResearchTable(T);
      return model.instance();
    },
    update(dt) {
      if (model) { flicker += dt; model.flicker(flicker); }
      if (ui) ui.update(dt);
      else if (!uiFailed && typeof document !== 'undefined' && ctx.running) loadUI(); // craft-list lock badges need the UI module
    },
    debug: {
      openChest(x = 0, z = 0) {
        if (!isInt(x) || !isInt(z)) return false;
        const w = ctx.world;
        if (decorAt(x, z) !== 'crate') {
          if (ctx.role === 'guest' || decorAt(x, z) || !w.tiles.some(t => t[0] === x && t[1] === z)) return false;
          w.decor.push({ type: 'crate', x, z }); ctx.rebuildRaft();
        }
        return open('crate', x, z);
      },
      openResearch(x = 0, z = 0) { return decorAt(x, z) === 'research' ? open('research', x, z) : false; },
      research(kind) {
        if (ctx.role === 'guest' || !researchableKinds(st).includes(kind)) return [];
        const before = st.learned;
        st.seen = sortedUnique([...st.seen, kind]); st.learned = learnedFrom(st.seen, st.learned); bump();
        const out = st.learned.filter(id => !before.includes(id)); for (const id of out) fresh.add(id);
        return out;
      },
      unlockAll() { if (ctx.role === 'guest') return false; st.seen = ingredientKinds(); st.learned = learnedFrom(st.seen, recipeIds().filter(id => !STARTER.includes(id))); bump(); return true; },
      lockAll() { if (ctx.role === 'guest') return false; st.seen = []; st.learned = []; st.legacy = false; st.all = false; bump(); return true; },
      fill(x, z, slots) { if (ctx.role === 'guest') return false; const c = cleanChest(slots); if (chestEmpty(c)) delete st.chests[keyOf(x, z)]; else st.chests[keyOf(x, z)] = c; bump(); return true; },
      close() { ui?.close(); },
      rev() { return ver; },
      state() { return { ...JSON.parse(JSON.stringify(sliceOf(st))), all: st.all, open: ui?.openInfo() ?? null, locked: lockedRecipes(st) }; },
    },
    dispose() { ui?.destroy(); ui = null; model?.dispose(); model = null; },
  };
}
