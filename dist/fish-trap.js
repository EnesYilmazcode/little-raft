// Fish Trap (see docs/specs/fish-trap.md). A woven basket hangs off an edge tile into the sea and slowly
// catches fish from the species table; seaweed bait makes it faster and luckier. E takes everything inside.
// Cozy: the trap never breaks, fish never spoil or swim off, nothing is lost. Slice: world.ext.fishtrap,
// host-authoritative, actions 'fishtrap.*'. The top half is pure (no DOM, no Date, no Math.random) and exported.
import { rollCatch, speciesById, starsFor } from './fish-species.js?build=v3-survival-ae77fa84ac2b';
import { createFishTrap as createTrapModel, paintTrap, OVERHANG } from './fish-trap-model.js?build=v3-survival-ae77fa84ac2b';

export { OVERHANG };
export const CATCH_SEC = 240, BAIT_SEC = 150, TRAP_MAX = 3, BAIT_PER = 5, MAX_TICK = 60, REACH = 2.6, HOST_SLACK = 2;
export const MAX_TRAPS = 400; // the raft tile cap
export const DEFAULT_SEED = 0x5eed7a9;
export const OLD_HOST = 'Your friend’s raft doesn’t have fish traps yet';
export const NOT_EDGE = 'Fish trap: it needs open water beside it';
export const TEXT = Object.freeze({ full: 'Your bag is full', empty: 'No fish in the trap yet', notarget: 'Nothing to collect' });
const SIDES = [[0, 1], [1, 0], [0, -1], [-1, 0]];

const KEY_RE = /^-?\d+,-?\d+$/;
const isInt = Number.isInteger;
export const tileKey = (x, z) => x + ',' + z;
const isKey = k => typeof k === 'string' && k.length <= 24 && KEY_RE.test(k) && (() => { const [x, z] = k.split(',').map(Number); return tileKey(x, z) === k; })();
const clampInt = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : lo);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const hasTile = (tiles, x, z) => { if (Array.isArray(tiles)) for (const t of tiles) if (t && t[0] === x && t[1] === z) return true; return false; };

function trapList(decor) { // fishtrap decor in decor order, one per tile
  const out = [], seen = new Set();
  if (Array.isArray(decor)) for (const d of decor) {
    if (!d || d.type !== 'fishtrap' || !isInt(d.x) || !isInt(d.z)) continue;
    const k = tileKey(d.x, d.z); if (seen.has(k)) continue;
    seen.add(k); out.push({ k, x: d.x, z: d.z, rot: d.rot });
  }
  return out;
}
const trapAt = (decor, x, z) => { if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'fishtrap' && d.x === x && d.z === z) return d; return null; };

/** A raft tile with at least one of its 4 neighbours not a tile. */
export function isEdgeTile(tiles, x, z) {
  if (!hasTile(tiles, x, z)) return false;
  for (const [dx, dz] of SIDES) if (!hasTile(tiles, x + dx, z + dz)) return true;
  return false;
}

/** [dx, dz] of the open side: the one `rot` faces when open, else the first open in SIDES order; null when none. */
export function openSide(tiles, x, z, rot = 0) {
  const r = Number.isFinite(rot) ? rot : 0;
  const fx = Math.round(Math.sin(r)), fz = Math.round(Math.cos(r));
  if ((fx === 0) !== (fz === 0) && !hasTile(tiles, x + fx, z + fz)) return [fx, fz];
  for (const [dx, dz] of SIDES) if (!hasTile(tiles, x + dx, z + dz)) return [dx, dz];
  return null;
}

/** mulberry32 on st.seed; writes the advanced state back. */
export function nextRand(st) {
  let t = (st.seed = (st.seed + 0x6D2B79F5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function cleanFish(v) {
  if (!isObj(v)) return null;
  const sp = speciesById(v.sp); if (!sp) return null;
  if (typeof v.cm !== 'number' || !Number.isFinite(v.cm)) return null;
  const cm = Math.round(Math.min(sp.maxCm, Math.max(sp.minCm, v.cm)) * 10) / 10;
  return { sp: sp.id, cm, st: starsFor(sp, cm) };
}

/** Validated slice. Junk -> defaults; bad keys, fish and values dropped or clamped; tiles without a trap pruned. */
export function cleanTrap(v, decor) {
  const out = { v: 1, s: '', r: 0, seed: DEFAULT_SEED, t: {} };
  if (!isObj(v)) return out;
  if (typeof v.s === 'string' && v.s.length <= 32) out.s = v.s;
  if (isInt(v.r) && v.r >= 0) out.r = v.r;
  if (isInt(v.seed) && v.seed >= 0 && v.seed < 4294967296) out.seed = v.seed;
  const t = isObj(v.t) ? v.t : {};
  const traps = new Set(trapList(decor).map(e => e.k));
  let n = 0;
  for (const k of Object.keys(t)) {
    if (n >= MAX_TRAPS) break;
    if (!isKey(k) || !traps.has(k)) continue;
    const e = t[k]; if (!isObj(e)) continue;
    const f = Array.isArray(e.f) ? e.f.slice(0, TRAP_MAX).map(cleanFish).filter(Boolean) : [];
    const w = f.length >= TRAP_MAX ? 0 : clampInt(e.w, 0, CATCH_SEC - 1), b = clampInt(e.b, 0, BAIT_PER);
    if (!f.length && w === 0 && b === 0) continue;
    out.t[k] = { f, w, b }; n++;
  }
  return out;
}

const tileSet = tiles => { const s = new Set(); if (Array.isArray(tiles)) for (const t of tiles) if (t) s.add(tileKey(t[0], t[1])); return s; };
const edgeIn = (set, x, z) => set.has(tileKey(x, z)) && SIDES.some(([dx, dz]) => !set.has(tileKey(x + dx, z + dz)));

/** Host tick: whole seconds (dt floored, clamped 0..MAX_TICK), traps in decor order. Bumps st.r on any change. */
export function tickTraps(st, tiles, decor, dt) {
  const caught = [], full = [];
  const list = trapList(decor), keys = new Set(list.map(e => e.k));
  let changed = false;
  for (const k of Object.keys(st.t)) if (!keys.has(k)) { delete st.t[k]; changed = true; } // trap gone: prune
  const n = typeof dt === 'number' && Number.isFinite(dt) ? Math.min(MAX_TICK, Math.max(0, Math.floor(dt))) : 0;
  if (n > 0 && list.length) {
    const set = tileSet(tiles), live = list.filter(e => edgeIn(set, e.x, e.z));
    for (let i = 0; i < n; i++) for (const { k } of live) {
      let e = st.t[k];
      if (e && e.f.length >= TRAP_MAX) { if (e.w !== 0) { e.w = 0; changed = true; } continue; }
      if (!e) { if (Object.keys(st.t).length >= MAX_TRAPS) continue; e = st.t[k] = { f: [], w: 0, b: 0 }; }
      e.w++; changed = true;
      if (e.w >= (e.b > 0 ? BAIT_SEC : CATCH_SEC)) {
        const c = rollCatch(() => nextRand(st), { charge: e.b > 0 ? .8 : .3, night: false });
        e.w = 0; e.f.push({ sp: c.species, cm: c.cm, st: c.stars });
        if (e.b > 0) e.b--;
        caught.push(k);
        if (e.f.length >= TRAP_MAX) full.push(k);
      }
    }
  }
  if (changed) st.r++;
  return { caught, full };
}

/** {n, w, b, need, edge} for the trap on that tile, or null. */
export function trapInfo(st, tiles, decor, x, z) {
  if (!trapAt(decor, x, z)) return null;
  const e = st.t[tileKey(x, z)], b = e ? e.b : 0;
  return { n: e ? e.f.length : 0, w: e ? e.w : 0, b, need: b > 0 ? BAIT_SEC : CATCH_SEC, edge: isEdgeTile(tiles, x, z) };
}

/** All or nothing: every fish fits in the bag, or nothing changes and they all stay in the trap. */
export function collect(st, decor, key, bag) {
  if (!isKey(key)) return { ok: false, reason: 'notarget', text: TEXT.notarget };
  const [x, z] = key.split(',').map(Number);
  if (!trapAt(decor, x, z)) return { ok: false, reason: 'notarget', text: TEXT.notarget };
  const e = st.t[key], n = e ? e.f.length : 0;
  if (n <= 0) return { ok: false, reason: 'empty', text: TEXT.empty };
  if (!bag || typeof bag.snapshot !== 'function') return { ok: false, reason: 'full', text: TEXT.full };
  const s = new bag.constructor(bag.snapshot());
  if (s.add('fish', n) !== 0) return { ok: false, reason: 'full', text: TEXT.full };
  for (let i = 0; i < s.slots.length; i++) bag.slots[i] = s.slots[i];
  if (typeof bag.version === 'number') bag.version++;
  const fish = e.f.map(f => ({ species: f.sp, cm: f.cm, stars: f.st }));
  e.f = []; if (e.w === 0 && e.b === 0) delete st.t[key];
  return { ok: true, fish, n, text: `+ ${n} fish from the trap` };
}

// ------------------------------------------------------------------ the content module

export function createFishTrap(ctx) {
  const T = ctx.T;
  const session = Math.random().toString(36).slice(2, 10);
  const freshSeed = () => (Math.random() * 2 ** 32) >>> 0;
  let st = cleanTrap(undefined, null); st.s = session; st.seed = freshSeed();
  let cache = null, cacheSt = null, cacheR = -1, netR = -1, netS = null, netUndef = false, hostHasTrap = true;
  let clock = 0;
  const traps = []; // {g, k, x, z, phase} for each craft_fishtrap group in ctx.raft
  let scanLen = -1, scanFirst = null, scanRaft = null;
  const scratch = T ? new T.Vector3() : null, camPos = T ? new T.Vector3() : null;

  const oldHost = () => ctx.role === 'guest' && !hostHasTrap;
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);
  const tiles = () => (Array.isArray(ctx.world?.tiles) ? ctx.world.tiles : []);
  // Where the basket hangs: out over the open side, or the tile centre when none is open.
  function spot(d) {
    const s = openSide(tiles(), d.x, d.z, d.rot);
    return s ? [d.x * 2 + s[0] * OVERHANG, d.z * 2 + s[1] * OVERHANG] : [d.x * 2, d.z * 2];
  }

  // Nearest trap basket along the view ray (or the camera forward), within reach of the player.
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else if (scratch) { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    else return null;
    const cy = (ctx.raft?.position.y ?? 0) + .05;
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (!d || d.type !== 'fishtrap') continue;
      if (Math.hypot(p.x - d.x * 2, p.z - d.z * 2) > REACH + OVERHANG + .1) continue;
      const [cx, cz] = spot(d);
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > .85) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best ? { x: best.x, z: best.z, key: tileKey(best.x, best.z) } : null;
  }

  function scanTraps() {
    const raft = ctx.raft; if (!raft) { traps.length = 0; return; }
    const kids = raft.children;
    if (raft === scanRaft && kids.length === scanLen && kids[0] === scanFirst) return;
    scanRaft = raft; scanLen = kids.length; scanFirst = kids[0];
    traps.length = 0;
    for (let i = 0; i < kids.length; i++) {
      const g = kids[i]; if (g.name !== 'craft_fishtrap') continue;
      const x = Math.round(g.position.x / 2), z = Math.round(g.position.z / 2), d = trapAt(decor(), x, z);
      const s = openSide(tiles(), x, z, d?.rot ?? 0);
      g.rotation.y = s ? Math.atan2(s[0], s[1]) : (d?.rot || 0);
      traps.push({ g, k: tileKey(x, z), x, z, phase: (x * 7 + z * 13) % 6.28 });
    }
  }

  function paint() {
    scanTraps(); if (!traps.length) return;
    const cam = ctx.camera, elapsed = ctx.elapsed ?? 0, old = oldHost();
    if (cam && camPos) cam.getWorldPosition(camPos);
    for (let i = 0; i < traps.length; i++) {
      const { g, k, phase } = traps[i];
      if (cam && camPos) { g.getWorldPosition(scratch); if (scratch.distanceToSquared(camPos) > 900) continue; }
      const e = old ? null : st.t[k];
      paintTrap(g, !!e && e.f.length >= TRAP_MAX, elapsed, phase);
    }
  }

  function load(data, from) {
    if (from === 'net') {
      if (data && typeof data === 'object' && data.r === netR && data.s === netS) return; // unchanged host state
      if (data === undefined && netUndef) return;
      netUndef = data === undefined; hostHasTrap = data !== undefined;
      st = cleanTrap(data, ctx.world?.decor);
      netR = isObj(data) ? data.r : -1; netS = isObj(data) ? data.s : null;
      return;
    }
    netR = -1; netS = null; netUndef = false; hostHasTrap = true;
    st = cleanTrap(data, ctx.world?.decor);
    if (!isObj(data)) st.seed = freshSeed(); // brand-new state: a fresh sequence
    st.s = session; st.r++;
  }

  function serialize() {
    if (cache && cacheSt === st && cacheR === st.r) return cache;
    cache = JSON.parse(JSON.stringify(st)); cacheSt = st; cacheR = st.r;
    return cache;
  }

  const hasSeaweed = () => { try { return (ctx.localBag?.()?.count?.('seaweed') ?? 0) > 0; } catch { return false; } };

  return {
    name: 'fishtrap',
    load,
    serialize,
    update(dt) {
      if (T) paint();
      if (!ctx.running || ctx.role === 'guest') return;
      clock += dt > 0 ? dt : 0;
      if (clock >= 1) {
        const n = Math.floor(clock); clock -= n;
        const r = tickTraps(st, ctx.world?.tiles, ctx.world?.decor, n);
        if (r.full.length) ctx.emit?.({ kind: 'notice', text: 'A fish trap is full' }, 'all');
      }
    },
    placeBlock(kind, x, z) {
      return kind === 'fishtrap' && !isEdgeTile(ctx.world?.tiles, x, z) ? 'edge' : null;
    },
    prompt(aim) {
      const t = target(aim); if (!t) return null;
      if (oldHost()) return OLD_HOST;
      const info = trapInfo(st, tiles(), decor(), t.x, t.z); if (!info) return null;
      if (!info.edge) return NOT_EDGE;
      if (info.n > 0) return `<kbd>E</kbd>Collect fish (${info.n})${info.n >= TRAP_MAX ? ' · full' : ''}`;
      const pct = Math.floor(info.w / info.need * 100);
      if (info.b > 0) return `Fish trap (baited): waiting… ${pct}%`;
      if (hasSeaweed()) return '<kbd>E</kbd>Bait with seaweed';
      return `Fish trap: waiting… ${pct}% · seaweed makes good bait`;
    },
    interact(aim) {
      const t = target(aim); if (!t) return false;
      if (oldHost()) { ctx.notice?.(OLD_HOST, 2400); return true; }
      const info = trapInfo(st, tiles(), decor(), t.x, t.z);
      if (!info) { ctx.notice?.(TEXT.notarget); return true; }
      if (!info.edge) { ctx.notice?.(NOT_EDGE, 2400); return true; }
      if (info.n > 0) ctx.action({ kind: 'fishtrap.collect', x: t.x, z: t.z });
      else if (info.b === 0 && hasSeaweed()) ctx.action({ kind: 'fishtrap.bait', x: t.x, z: t.z });
      else ctx.notice?.(TEXT.empty);
      return true;
    },
    action(a, actor, bag) {
      if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('fishtrap.')) return false;
      if (!isInt(a.x) || !isInt(a.z)) return true;
      const d = trapAt(decor(), a.x, a.z); if (!d) return true;
      const pose = actor === 'guest' ? ctx.other : ctx.physics;
      const [cx, cz] = spot(d);
      if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z) || Math.hypot(cx - pose.x, cz - pose.z) > REACH + HOST_SLACK) return true;
      const key = tileKey(a.x, a.z);
      if (a.kind === 'fishtrap.collect') {
        const r = collect(st, decor(), key, bag);
        if (r.ok) {
          st.r++;
          if (ctx.world) ctx.world.fish = (ctx.world.fish | 0) + r.n;
          ctx.emit?.({ kind: 'loot', text: r.text, loot: { fish: r.n }, trapFish: r.fish.slice(0, TRAP_MAX) }, actor);
        } else ctx.emit?.({ kind: r.reason === 'full' ? 'full' : 'notice', text: r.text }, actor);
        return true;
      }
      if (a.kind === 'fishtrap.bait') {
        const e = st.t[key];
        if (e && e.b > 0) { ctx.emit?.({ kind: 'notice', text: 'The trap is already baited' }, actor); return true; }
        if (!bag || !bag.remove('seaweed', 1)) { ctx.emit?.({ kind: 'notice', text: 'You need seaweed for bait' }, actor); return true; }
        if (e) e.b = BAIT_PER; else st.t[key] = { f: [], w: 0, b: BAIT_PER };
        st.r++;
        ctx.emit?.({ kind: 'notice', text: 'Trap baited · 5 catches', sound: 'collect' }, actor);
        return true;
      }
      return true;
    },
    decorModel(type) {
      if (!T || type !== 'fishtrap') return null;
      return createTrapModel(T);
    },
    debug: {
      state: () => JSON.parse(JSON.stringify(st)),
      traps: () => trapList(decor()).map(e => ({ x: e.x, z: e.z, key: e.k, ...trapInfo(st, tiles(), decor(), e.x, e.z) })),
      target: aim => target(aim),
      /** Host QA: put a fish trap on a free raft tile. */
      place(x, z, rot = 0) {
        const w = ctx.world;
        if (ctx.role === 'guest' || !isInt(x) || !isInt(z) || !w) return false;
        if (!hasTile(w.tiles, x, z) || decor().some(d => d.x === x && d.z === z)) return false;
        w.decor.push(rot ? { type: 'fishtrap', x, z, rot } : { type: 'fishtrap', x, z }); ctx.rebuildRaft?.(); return true;
      },
      /** Host QA: run the catch rule for `sec` seconds (in MAX_TICK chunks). */
      fastForward(sec = CATCH_SEC) {
        if (ctx.role === 'guest') return false;
        let left = Math.max(0, Math.floor(sec));
        while (left > 0) { const n = Math.min(MAX_TICK, left); tickTraps(st, ctx.world?.tiles, ctx.world?.decor, n); left -= n; }
        return true;
      },
      /** Host QA: fill one trap with TRAP_MAX fish. */
      fill(key) {
        if (ctx.role === 'guest' || !isKey(key)) return false;
        const [x, z] = key.split(',').map(Number); if (!trapAt(decor(), x, z)) return false;
        const e = st.t[key] ?? (st.t[key] = { f: [], w: 0, b: 0 });
        while (e.f.length < TRAP_MAX) { const c = rollCatch(() => nextRand(st), { charge: .3 }); e.f.push({ sp: c.species, cm: c.cm, st: c.stars }); }
        e.w = 0; st.r++; return true;
      },
    },
    dispose() { traps.length = 0; },
  };
}
