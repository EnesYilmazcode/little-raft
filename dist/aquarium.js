// Fish Tank (aquarium decor). See docs/specs/aquarium.md. Cosy and cosmetic: no feeding, no death, nothing lost.
// E while holding a raw `fish` puts a live fish in (max 4); E with an empty hand lets the newest one out as a plain
// `fish`. Bag fish carry no species, so the species is a cosmetic 1:1 swap chosen by the client (journal) and
// clamped by the host. Slice: world.ext.aquarium, host-authoritative, actions 'aquarium.*'.
// The top half of this file is pure (no DOM, no Date, no Math.random) and exported for tests.
import { moveStack } from './storage-research.js?build=v3-survival-ae77fa84ac2b';
import { speciesById } from './fish-species.js?build=v3-survival-ae77fa84ac2b';
import { createFishModel, wiggle } from './fish-models.js?build=v3-survival-ae77fa84ac2b'; // same specifier as display.js: one fish cache
import { createAquariumModel, bubbleTick, disposeAquariumShared } from './aquarium-model.js?build=v3-survival-ae77fa84ac2b';

export const CAP = 4, REACH = 2.6, HOST_SLACK = 2, MAX_FISH = 48, ANIM_R = 10, MAX_TILES = 400;
export const FISH_LEN = 0.18, AIM_LIM = 0.5;
export const OLD_HOST = 'Your friend’s raft doesn’t have fish tanks yet';
export const TEXT = Object.freeze({ stale: 'That tank just changed, try again', full: 'Your bag is full', tankfull: 'The tank is full (4 fish)',
  cooked: 'Only live fish can swim', empty: 'Hold a raw fish to add it', notarget: 'No tank there', bad: 'That fish can’t go in' });

const KEY_RE = /^-?\d{1,3},-?\d{1,3}$/;
const isInt = Number.isInteger;
export const tileKey = (x, z) => x + ',' + z;
const isKey = k => typeof k === 'string' && KEY_RE.test(k) && (() => { const [x, z] = k.split(',').map(Number); return tileKey(x, z) === k; })();
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (reason, text = TEXT[reason]) => ({ ok: false, reason, text });
const round1 = v => Math.round(v * 10) / 10;
export const spName = id => speciesById(id)?.name ?? String(id);

/** {sp, cm} with cm clamped to the species range and rounded to 0.1, or null. */
export function cleanFish(e) {
  if (!isObj(e)) return null;
  const sp = speciesById(e.sp); if (!sp) return null;
  if (typeof e.cm !== 'number' || !Number.isFinite(e.cm)) return null;
  return { sp: sp.id, cm: round1(Math.min(sp.maxCm, Math.max(sp.minCm, e.cm))) };
}

/** Validated slice. Never throws. Orphans (a key with no tank) are kept and hidden; never pruned against decor. */
export function cleanAquarium(v) {
  const out = { v: 1, s: '', r: 0, t: {} };
  if (!isObj(v)) return out;
  if (typeof v.s === 'string' && v.s.length <= 32) out.s = v.s;
  if (isInt(v.r) && v.r >= 0 && v.r < Number.MAX_SAFE_INTEGER) out.r = v.r;
  if (isObj(v.t)) {
    let n = 0;
    for (const k of Object.keys(v.t)) {
      if (n >= MAX_TILES) break;
      if (!isKey(k) || !Array.isArray(v.t[k])) continue;
      const arr = v.t[k].map(cleanFish).filter(Boolean).slice(0, CAP);
      if (!arr.length) continue;
      out.t[k] = arr; n++;
    }
  }
  return out;
}

/** True when decor has an 'aquarium' at (x, z). */
export function tankAt(decor, x, z) {
  if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'aquarium' && d.x === x && d.z === z) return true;
  return false;
}

const okBag = bag => !!bag && typeof bag.snapshot === 'function' && Array.isArray(bag.slots);
function commit(bag, scratch) {
  for (let i = 0; i < scratch.slots.length; i++) bag.slots[i] = scratch.slots[i];
  if (typeof bag.version === 'number') bag.version++;
}
const where = (decor, a) => (a && isInt(a.x) && isInt(a.z) && tankAt(decor, a.x, a.z) ? tileKey(a.x, a.z) : null);

/** Atomic: one raw `fish` from bag slot `from` into the tank as {sp, cm}. a = {x,z,from,species,cm,expect:{have:'fish',n}}. */
export function add(st, decor, a, bag) {
  const key = where(decor, a); if (!key) return fail('notarget');
  if (!okBag(bag) || !isInt(a.from) || a.from < 0 || a.from >= bag.slots.length) return fail('stale');
  const kind = bag.slots[a.from]?.kind;
  if (kind === 'cookedfish') return fail('bad', TEXT.cooked);
  if (kind !== 'fish') return fail('stale');
  const arr = Array.isArray(st.t[key]) ? st.t[key].slice() : [];
  const ex = isObj(a.expect) ? a.expect : null;
  if (!ex || ex.have !== 'fish' || ex.n !== arr.length) return fail('stale');
  if (arr.length >= CAP) return fail('tankfull');
  const f = cleanFish({ sp: a.species, cm: a.cm }); if (!f) return fail('bad');
  const scratch = new bag.constructor(bag.snapshot());
  const s = scratch.slots[a.from];
  if (!s || s.kind !== 'fish') return fail('stale');
  if (s.count <= 1) scratch.slots[a.from] = null; else s.count -= 1;
  commit(bag, scratch);
  arr.push(f); st.t[key] = arr; st.r++;
  return { ok: true, text: `${spName(f.sp)} is swimming in the tank` };
}

/** Atomic: the newest fish (LIFO) back into the bag as 1 plain `fish`. a = {x,z,expect:{n, sp}}. */
export function release(st, decor, a, bag) {
  const key = where(decor, a); if (!key) return fail('notarget');
  const arr = Array.isArray(st.t[key]) ? st.t[key].slice() : [];
  const ex = isObj(a.expect) ? a.expect : null;
  if (!ex || !arr.length || ex.n !== arr.length || arr[arr.length - 1].sp !== ex.sp) return fail('stale');
  if (!okBag(bag)) return fail('full');
  const scratch = new bag.constructor(bag.snapshot());
  const one = [{ kind: 'fish', count: 1 }];
  moveStack(one, 0, scratch.slots);
  if (one[0]) return fail('full');
  commit(bag, scratch);
  const f = arr.pop();
  if (arr.length) st.t[key] = arr; else delete st.t[key];
  st.r++;
  return { ok: true, text: `+1 Raw Fish (${spName(f.sp)} let out)`, loot: { fish: 1 } };
}

/** What picking the tank up returns besides the tank itself: its fish as plain `fish`. */
export function undecorLootFor(st, d) {
  if (!d || !isInt(d.x) || !isInt(d.z)) return [];
  const n = Array.isArray(st?.t?.[tileKey(d.x, d.z)]) ? st.t[tileKey(d.x, d.z)].length : 0;
  return n > 0 ? [['fish', n]] : [];
}

/** Tiny deterministic hash (FNV-1a) for per-fish swim parameters. */
export function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** Swim parameters for fish i in tank `key`: w in [0.25, 0.45], two phases. */
export function swimParams(key, i) {
  const h = hash32(key + '#' + i);
  return { w: .25 + .2 * ((h % 1000) / 999), p1: ((h >>> 10) % 628) / 100, p2: ((h >>> 20) % 628) / 100 };
}

// ------------------------------------------------------------------ the content module

const markShared = o => o.traverse(c => {
  if (c.geometry) c.geometry.userData.shared = true;
  for (const m of [].concat(c.material || [])) m.userData.shared = true;
});

export function createAquarium(ctx) {
  const T = ctx.T;
  const session = Math.random().toString(36).slice(2, 10);
  let st = cleanAquarium(undefined); st.s = session;
  let cache = null, cacheSt = null, cacheR = -1, netR = -1, netS = null, netUndef = false, hostHasTank = true, dirty = true;
  let lastAdded = null, clock = 0, nearT = 0;
  const groups = []; // {g, x, z, key, aim, swim, dist, near, fish: [{o, w, p1, p2}], sig}
  let scanLen = -1, scanFirst = null, scanRaft = null;
  const v = T ? new T.Vector3() : null, dir = T ? new T.Vector3() : null;

  const oldHost = () => ctx.role === 'guest' && !hostHasTank;
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);
  const esc = s => (typeof ctx.esc === 'function' ? ctx.esc(String(s)) : String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`));
  const held = () => { const b = ctx.localBag?.(); return b ? { slot: b.selected, from: b.selectedIndex } : { slot: null, from: -1 }; };
  const journal = () => { try { return globalThis.raftFC?.journal ?? null; } catch { return null; } };
  const seen = () => { try { const s = journal()?.speciesSeen?.(); return Array.isArray(s) ? s : []; } catch { return []; } };
  const bestCm = id => { try { const e = journal()?.entry?.(id); return typeof e?.bestCm === 'number' ? e.bestCm : speciesById(id)?.minCm ?? 0; } catch { return speciesById(id)?.minCm ?? 0; } };

  // The species the next added fish shows as (client-side; the host clamps it). Basket raw fish first (newest first,
  // skipping ones already swimming in a tank so three catches show as three species), then the seen-cycle, then pomfret.
  function pickSpecies() {
    let basket = [];
    try { const b = journal()?.basket; if (Array.isArray(b)) basket = b; } catch { basket = []; }
    let newest = null;
    const used = new Map();
    for (const arr of Object.values(st.t)) for (const f of arr) { const k = f.sp + '|' + f.cm; used.set(k, (used.get(k) || 0) + 1); }
    for (let i = basket.length - 1; i >= 0; i--) {
      const b = basket[i];
      if (!b || b.state !== 'raw' || !speciesById(b.species) || typeof b.cm !== 'number') continue;
      const f = cleanFish({ sp: b.species, cm: b.cm }); if (!f) continue;
      if (!newest) newest = f;
      const k = f.sp + '|' + f.cm, n = used.get(k) || 0;
      if (n > 0) { used.set(k, n - 1); continue; }
      return { species: f.sp, cm: f.cm };
    }
    if (newest) return { species: newest.sp, cm: newest.cm };
    const s = seen().filter(id => speciesById(id));
    if (s.length) { const i = s.indexOf(lastAdded), id = s[(i + 1) % s.length]; return { species: id, cm: round1(bestCm(id)) }; }
    return { species: 'pomfret', cm: speciesById('pomfret').minCm };
  }

  function scanGroups() {
    const raft = ctx.raft; if (!raft) { const had = groups.length > 0; groups.length = 0; scanRaft = null; return had; }
    const kids = raft.children;
    if (raft === scanRaft && kids.length === scanLen && kids[0] === scanFirst) return false;
    scanRaft = raft; scanLen = kids.length; scanFirst = kids[0];
    groups.length = 0;
    for (let i = 0; i < kids.length; i++) {
      const g = kids[i]; if (g.name !== 'craft_aquarium') continue;
      const x = Math.round(g.position.x / 2), z = Math.round(g.position.z / 2);
      const aim = g.children.find(c => c.name === 'aim') ?? null, swim = g.children.find(c => c.name === 'swim') ?? null;
      groups.push({ g, x, z, key: tileKey(x, z), aim, swim, dist: 0, near: false, fish: [], sig: null });
    }
    return true;
  }

  // The tank whose centre is nearest the view ray, within reach.
  function target(aim) {
    const p = ctx.physics, cam = ctx.camera; if (!T || !p || !cam) return null;
    scanGroups(); if (!groups.length) return null;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else if (typeof cam.getWorldDirection === 'function') { cam.getWorldDirection(dir); dx = dir.x; dy = dir.y; dz = dir.z; }
    else return null;
    let best = null, bestScore = Infinity;
    for (const e of groups) {
      if (!e.aim) continue;
      e.g.getWorldPosition(v);
      if (Math.hypot(p.x - v.x, p.z - v.z) > REACH) continue;
      e.aim.getWorldPosition(v);
      const vx = v.x - ox, vy = v.y - oy, vz = v.z - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > AIM_LIM) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best ? { x: best.x, z: best.z, key: best.key } : null;
  }

  // ---------- fish ----------
  function clearFish(e) {
    for (const f of e.fish) f.o.removeFromParent();
    e.fish.length = 0;
  }
  function pose(e, f, t) {
    const b = e.swim.userData.box, a = t * f.w;
    const o = f.o;
    o.position.set(b.x * .85 * Math.sin(a + f.p1), .04 * Math.sin(t * .9 + f.p1), b.z * .7 * Math.sin(a * 1.3 + f.p2));
    const vx = b.x * .85 * f.w * Math.cos(a + f.p1), vz = b.z * .7 * f.w * 1.3 * Math.cos(a * 1.3 + f.p2);
    o.rotation.y = Math.atan2(-vz, vx); // the nose is +X
  }
  function setFish(e, list) {
    const sig = list ? list.map(f => f.sp + '|' + f.cm).join(',') : '';
    if (e.sig === sig) return;
    e.sig = sig;
    clearFish(e);
    if (!list || !e.swim) return;
    list.forEach((f, i) => {
      try {
        const o = createFishModel(T, f.sp, { cm: f.cm, lod: 0 });
        markShared(o);
        o.traverse(c => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; } });
        o.scale.setScalar(Math.min(FISH_LEN, f.cm / 100 * .4) / (o.userData.length || 1));
        o.name = 'aquarium_fish';
        const rec = { o, ...swimParams(e.key, i) };
        e.swim.add(o); e.fish.push(rec);
        pose(e, rec, clock);
      } catch (err) { console.warn('tank fish failed', err); }
    });
  }

  function paint() {
    dirty = false;
    if (!groups.length) return;
    const p = ctx.physics, old = oldHost();
    for (const e of groups) { if (p) { e.g.getWorldPosition(v); e.dist = Math.hypot(v.x - p.x, v.z - p.z); } else e.dist = 0; }
    const order = groups.slice().sort((a, b) => a.dist - b.dist);
    let budget = MAX_FISH;
    for (const e of order) {
      const arr = old ? null : st.t[e.key];
      if (!arr || !arr.length || budget < arr.length) { setFish(e, null); continue; } // past the budget: an empty tank (the prompt still works)
      budget -= arr.length;
      setFish(e, arr);
    }
  }

  function markNear() {
    const p = ctx.physics;
    for (const e of groups) { if (p) { e.g.getWorldPosition(v); e.near = Math.hypot(v.x - p.x, v.z - p.z) <= ANIM_R; } else e.near = false; }
  }

  // ---------- net / save ----------
  function load(data, from) {
    if (from === 'net') {
      if (data && typeof data === 'object' && data.r === netR && data.s === netS) return; // unchanged host state
      if (data === undefined && netUndef) return;
      dirty = true;
      netUndef = data === undefined; hostHasTank = data !== undefined;
      st = cleanAquarium(data);
      netR = data && typeof data === 'object' ? data.r : -1; netS = data && typeof data === 'object' ? data.s : null;
      return;
    }
    netR = -1; netS = null; netUndef = false; hostHasTank = true; dirty = true;
    st = cleanAquarium(data);
    st.s = session; st.r++;
  }

  function serialize() {
    if (cache && cacheSt === st && cacheR === st.r) return cache;
    cache = JSON.parse(JSON.stringify(st)); cacheSt = st; cacheR = st.r;
    return cache;
  }

  // What E does on the aimed tank: {html} for the prompt and the action (or notice) to send.
  function plan(t) {
    if (oldHost()) return { html: OLD_HOST, notice: OLD_HOST, ms: 2400 };
    const arr = st.t[t.key] ?? [], n = arr.length;
    const h = held(), hk = h.slot?.kind ?? null;
    if (hk === 'fish') {
      if (n >= CAP) return { html: `<kbd>E</kbd>Tank is full (${CAP} fish)`, notice: TEXT.tankfull };
      const pick = pickSpecies();
      return { html: `<kbd>E</kbd>Add ${esc(spName(pick.species))} to the tank`,
        act: { kind: 'aquarium.add', x: t.x, z: t.z, from: h.from, species: pick.species, cm: pick.cm, expect: { have: 'fish', n } } };
    }
    if (hk === 'cookedfish') return { html: `<kbd>E</kbd>${TEXT.cooked}`, notice: TEXT.cooked };
    if (!hk && n > 0) {
      const last = arr[n - 1];
      return { html: `<kbd>E</kbd>Let the ${esc(spName(last.sp))} out`, act: { kind: 'aquarium.release', x: t.x, z: t.z, expect: { n, sp: last.sp } } };
    }
    if (!n) return { html: 'Fish tank: hold a raw fish to add it', notice: TEXT.empty };
    return { html: `Fish tank: ${n}/${CAP} fish`, notice: TEXT.empty };
  }

  return {
    name: 'aquarium',
    load,
    serialize,
    update(dt) {
      if (!T) return;
      clock += Number.isFinite(dt) ? dt : 0;
      if (scanGroups() || dirty) { paint(); nearT = 0; }
      nearT -= Number.isFinite(dt) ? dt : 0;
      if (nearT <= 0) { nearT = .5; markNear(); }
      for (let k = 0; k < groups.length; k++) {
        const e = groups[k]; if (!e.near) continue;
        for (let i = 0; i < e.fish.length; i++) { const f = e.fish[i]; pose(e, f, clock); wiggle(f.o, clock, .4); }
        bubbleTick(e.g, clock);
      }
    },
    prompt(aim) {
      const t = target(aim); if (!t) return null;
      return plan(t).html;
    },
    interact(aim) {
      const t = target(aim); if (!t) return false;
      const p = plan(t);
      if (p.act) { if (p.act.kind === 'aquarium.add') lastAdded = p.act.species; ctx.action?.(p.act); }
      else if (p.notice) ctx.notice?.(p.notice, p.ms);
      return true;
    },
    action(a, actor, bag) {
      if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('aquarium.')) return false;
      if (!isInt(a.x) || !isInt(a.z) || (a.kind === 'aquarium.add' && !isInt(a.from))) return true;
      const pose = actor === 'guest' ? ctx.other : ctx.physics;
      if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z) || Math.hypot(a.x * 2 - pose.x, a.z * 2 - pose.z) > REACH + HOST_SLACK) return true;
      const d = decor();
      const r = a.kind === 'aquarium.add' ? add(st, d, a, bag) : a.kind === 'aquarium.release' ? release(st, d, a, bag) : null;
      if (!r) return true;
      if (r.ok) {
        dirty = true;
        ctx.emit?.(r.loot ? { kind: 'loot', text: r.text, loot: r.loot } : { kind: 'build', text: r.text, sound: 'place' }, actor);
      } else {
        if (r.reason === 'stale') { st.r++; dirty = true; }
        ctx.emit?.({ kind: r.reason === 'full' ? 'full' : 'notice', text: r.text }, actor);
      }
      return true;
    },
    undecorLoot(d) { return d?.type === 'aquarium' ? undecorLootFor(st, d) : undefined; }, // [undecor] the fish come back as plain fish
    afterUndecor(d) { // [undecor]
      if (d?.type !== 'aquarium' || !isInt(d.x) || !isInt(d.z)) return;
      const k = tileKey(d.x, d.z);
      if (st.t[k]) { delete st.t[k]; st.r++; dirty = true; }
    },
    decorModel(type) {
      if (!T || type !== 'aquarium') return null;
      return createAquariumModel(T);
    },
    debug: {
      state: () => JSON.parse(JSON.stringify(st)),
      target: aim => target(aim),
      fish: () => { scanGroups(); let n = 0; for (const e of groups) n += e.fish.length; return n; },
      /** Every tank on the raft: tile, attached fish species and the aim point (world). */
      tanks: () => { scanGroups(); return groups.map(e => ({ x: e.x, z: e.z, key: e.key, near: e.near, fish: e.fish.map(f => f.o.userData.speciesId),
        at: T && e.aim ? e.aim.getWorldPosition(new T.Vector3()).toArray() : null })); },
      pick: () => pickSpecies(),
      /** Host QA: put a fish tank on a free raft tile. */
      place(x, z) {
        const w = ctx.world;
        if (ctx.role === 'guest' || !isInt(x) || !isInt(z) || !w) return false;
        if (!w.tiles?.some(t => t[0] === x && t[1] === z) || decor().some(d => d.x === x && d.z === z)) return false;
        w.decor.push({ type: 'aquarium', x, z }); ctx.rebuildRaft?.(); return true;
      },
    },
    dispose() {
      for (const e of groups) clearFish(e);
      groups.length = 0; scanRaft = null;
      disposeAquariumShared();
    },
  };
}
