// Beehive, Flower Box, honey and beeswax (see docs/specs/beehive.md).
// Place flower boxes, put a beehive near them and it slowly fills with honeycomb; E collects honey and wax.
// Friendly bees: no stings, nothing wilts, nothing is lost. Slice: world.ext.bees, host-authoritative,
// actions 'bees.*'. The top half of this file is pure (no DOM, no Date, no Math.random) and exported for tests.
import { createHive, createFlowerBox, createCandle, paintHive } from './bees-model.js?build=v3-survival-ae77fa84ac2b';

export const COMB_WORK = 360, COMB_MAX = 3, FLOWER_CAP = 3, FLOWER_RANGE = 2, MAX_TICK = 60, REACH = 2.6, HOST_SLACK = 2;
export const MAX_HIVES = 400; // the raft tile cap
export const OLD_HOST = 'Your friend’s raft doesn’t have bees yet';
export const TEXT = Object.freeze({ full: 'Your bag is full', empty: 'No honeycomb yet', notarget: 'Nothing to collect' });

const KEY_RE = /^-?\d+,-?\d+$/;
const isInt = Number.isInteger;
export const tileKey = (x, z) => x + ',' + z;
const isKey = k => typeof k === 'string' && k.length <= 24 && KEY_RE.test(k) && (() => { const [x, z] = k.split(',').map(Number); return tileKey(x, z) === k; })();
const clampInt = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : lo);

function hiveKeys(decor) {
  const out = new Set();
  if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'beehive' && isInt(d.x) && isInt(d.z)) out.add(tileKey(d.x, d.z));
  return out;
}
const hasHive = (decor, x, z) => { if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'beehive' && d.x === x && d.z === z) return true; return false; };

/** Validated slice. Junk -> defaults; bad keys dropped, c/t clamped to ints in range, non-hive tiles pruned. */
export function cleanBees(v, decor) {
  const out = { v: 1, s: '', r: 0, h: {} };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  if (typeof v.s === 'string' && v.s.length <= 32) out.s = v.s;
  if (isInt(v.r) && v.r >= 0) out.r = v.r;
  const h = v.h && typeof v.h === 'object' && !Array.isArray(v.h) ? v.h : {};
  const hives = hiveKeys(decor);
  let n = 0;
  for (const k of Object.keys(h)) {
    if (n >= MAX_HIVES) break;
    if (!isKey(k) || !hives.has(k)) continue;
    const e = h[k]; if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const c = clampInt(e.c, 0, COMB_MAX), t = c >= COMB_MAX ? 0 : clampInt(e.t, 0, COMB_WORK - 1);
    if (c === 0 && t === 0) continue;
    out.h[k] = { c, t }; n++;
  }
  return out;
}

/** Flower boxes within FLOWER_RANGE tiles (Chebyshev) of the tile. */
export function flowersNear(decor, x, z) {
  let n = 0;
  if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'flowerbox' && Math.max(Math.abs(d.x - x), Math.abs(d.z - z)) <= FLOWER_RANGE) n++;
  return n;
}

/** Host tick: whole seconds only (dt floored, clamped 0..MAX_TICK). Mutates st.h; bumps st.r on any change. */
export function tickBees(st, decor, dt) {
  const filled = [], full = [];
  const hives = hiveKeys(decor);
  let changed = false;
  for (const k of Object.keys(st.h)) if (!hives.has(k)) { delete st.h[k]; changed = true; } // hive gone: prune
  const n = typeof dt === 'number' && Number.isFinite(dt) ? Math.min(MAX_TICK, Math.max(0, Math.floor(dt))) : 0;
  if (n > 0) for (const k of hives) {
    const [x, z] = k.split(',').map(Number);
    const f = Math.min(flowersNear(decor, x, z), FLOWER_CAP);
    const e = st.h[k] ?? { c: 0, t: 0 };
    if (f === 0 || e.c >= COMB_MAX) continue;
    const c0 = e.c;
    for (let i = 0; i < n && e.c < COMB_MAX; i++) {
      e.t += f;
      if (e.t >= COMB_WORK) { e.c += 1; e.t -= COMB_WORK; if (e.c === COMB_MAX) e.t = 0; }
    }
    st.h[k] = e; changed = true;
    if (e.c > c0) filled.push(k);
    if (e.c === COMB_MAX) full.push(k);
  }
  if (changed) st.r++;
  return { filled, full };
}

/** {c, t, flowers} for the hive on that tile, or null. */
export function hiveInfo(st, decor, x, z) {
  if (!hasHive(decor, x, z)) return null;
  const e = st.h[tileKey(x, z)];
  return { c: e ? e.c : 0, t: e ? e.t : 0, flowers: flowersNear(decor, x, z) };
}

/** Atomic: both honey and wax fit, or nothing changes and the comb stays. */
export function harvest(st, decor, key, bag) {
  if (!isKey(key)) return { ok: false, reason: 'notarget', text: TEXT.notarget };
  const [x, z] = key.split(',').map(Number);
  if (!hasHive(decor, x, z)) return { ok: false, reason: 'notarget', text: TEXT.notarget };
  const e = st.h[key], c = e ? e.c : 0;
  if (c <= 0) return { ok: false, reason: 'empty', text: TEXT.empty };
  if (!bag || typeof bag.snapshot !== 'function') return { ok: false, reason: 'full', text: TEXT.full };
  const s = new bag.constructor(bag.snapshot());
  if (!(s.add('honey', c) === 0 && s.add('wax', c) === 0)) return { ok: false, reason: 'full', text: TEXT.full };
  for (let i = 0; i < s.slots.length; i++) bag.slots[i] = s.slots[i];
  if (typeof bag.version === 'number') bag.version++;
  e.c = 0; if (e.t === 0) delete st.h[key];
  return { ok: true, kind: 'loot', count: c, text: `+ ${c} honey · ${c} beeswax` };
}

// ------------------------------------------------------------------ the content module

export function createBees(ctx) {
  const T = ctx.T;
  const session = Math.random().toString(36).slice(2, 10);
  let st = cleanBees(undefined, null); st.s = session;
  let cache = null, cacheSt = null, cacheR = -1, netR = -1, netS = null, netUndef = false, hostHasBees = true;
  let clock = 0;
  const hives = []; // {g, k, x, z} for each craft_beehive group in ctx.raft
  let scanLen = -1, scanFirst = null, scanRaft = null;
  const scratch = T ? new T.Vector3() : null, camPos = T ? new T.Vector3() : null;

  const oldHost = () => ctx.role === 'guest' && !hostHasBees;
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);

  let lastAim = null, unprovide = null;
  const tip = { key: '', label: '', muted: false };
  // What aiming at a hive says: {key:'E'|null, label}. Labels are static text plus numbers (no user input).
  function status(aim) {
    const t = target(aim); if (!t) return null;
    if (oldHost()) return { key: null, label: OLD_HOST };
    const info = hiveInfo(st, decor(), t.x, t.z); if (!info) return null;
    if (info.c > 0) return { key: 'E', label: `Collect honeycomb (${info.c})${info.c >= COMB_MAX ? ' · full' : ''}` };
    if (info.flowers === 0) return { key: null, label: 'Beehive: bees need a flower box nearby' };
    return { key: null, label: `Bees are busy… ${Math.floor(info.t / COMB_WORK * 100)}%` };
  }
  function crosshairPrompt(c) { // dist/prompts.js provider: the muted status line beside the crosshair
    const s0 = c?.state; if (!s0 || !s0.running || s0.pickup || s0.swimming) return null;
    const s = status(lastAim); if (!s || s.key) return null; // actionable lines come through #contextPrompt
    tip.key = ''; tip.label = s.label; tip.muted = true;
    return tip;
  }
  function providePrompt() { // prompts.js may load after us: retried from update() until it exists
    if (unprovide || typeof window === 'undefined') return;
    try { const p = window.raftPrompts; if (p?.provide) unprovide = p.provide({ id: 'bees', priority: 1, prompt: crosshairPrompt }); } catch {}
  }

  // Nearest beehive along the view ray (or the camera forward when no aim), within reach.
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (!d || d.type !== 'beehive') continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      const cy = (ctx.raft?.position.y ?? 0) + .6;
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > .85) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best ? { x: best.x, z: best.z, key: tileKey(best.x, best.z) } : null;
  }

  function scanHives() {
    const raft = ctx.raft; if (!raft) { hives.length = 0; return; }
    const kids = raft.children;
    if (raft === scanRaft && kids.length === scanLen && kids[0] === scanFirst) return;
    scanRaft = raft; scanLen = kids.length; scanFirst = kids[0];
    hives.length = 0;
    for (let i = 0; i < kids.length; i++) {
      const g = kids[i]; if (g.name !== 'craft_beehive') continue;
      const x = Math.round(g.position.x / 2), z = Math.round(g.position.z / 2);
      hives.push({ g, k: tileKey(x, z), x, z });
    }
  }

  function paint() {
    scanHives(); if (!hives.length) return;
    const cam = ctx.camera, elapsed = ctx.elapsed ?? 0, d = decor(), old = oldHost();
    if (cam && camPos) cam.getWorldPosition(camPos);
    for (let i = 0; i < hives.length; i++) {
      const { g, k, x, z } = hives[i];
      if (old) { paintHive(g, 0, false, elapsed, false); continue; }
      const e = st.h[k], c = e ? e.c : 0;
      let near = false;
      if (cam && camPos) { g.getWorldPosition(scratch); near = scratch.distanceToSquared(camPos) < 64; }
      let active = false;
      if (near && c < COMB_MAX) active = flowersNear(d, x, z) > 0;
      paintHive(g, c, active, elapsed, near);
    }
  }

  function load(data, from) {
    if (from === 'net') {
      if (data && typeof data === 'object' && data.r === netR && data.s === netS) return; // unchanged host state
      if (data === undefined && netUndef) return;
      netUndef = data === undefined; hostHasBees = data !== undefined;
      st = cleanBees(data, ctx.world?.decor);
      netR = data && typeof data === 'object' ? data.r : -1; netS = data && typeof data === 'object' ? data.s : null;
      return;
    }
    netR = -1; netS = null; netUndef = false; hostHasBees = true;
    st = cleanBees(data, ctx.world?.decor);
    st.s = session; st.r++;
  }

  function serialize() {
    if (cache && cacheSt === st && cacheR === st.r) return cache;
    cache = JSON.parse(JSON.stringify(st)); cacheSt = st; cacheR = st.r;
    return cache;
  }

  return {
    name: 'bees',
    load,
    serialize,
    update(dt) {
      if (T) paint();
      if (!unprovide) providePrompt();
      if (!ctx.running || ctx.role === 'guest') return;
      clock += dt > 0 ? dt : 0;
      if (clock >= 1) {
        const n = Math.floor(clock); clock -= n;
        const r = tickBees(st, ctx.world?.decor, n);
        if (r.full.length) ctx.emit?.({ kind: 'notice', text: 'A beehive is full of honeycomb' }, 'all');
      }
    },
    // #contextPrompt lines without <kbd> are fed to the bottom-left notice feed (prompts.js), so the changing
    // "busy n%" status goes to the crosshair prompt provider instead; only the actionable line stays here.
    prompt(aim) {
      lastAim = aim;
      const s = status(aim);
      return s && s.key ? `<kbd>E</kbd>${s.label}` : null;
    },
    interact(aim) {
      const t = target(aim); if (!t) return false;
      if (oldHost()) { ctx.notice?.(OLD_HOST, 2400); return true; }
      const info = hiveInfo(st, decor(), t.x, t.z);
      if (!info || info.c === 0) { ctx.notice?.(TEXT.empty); return true; }
      ctx.action({ kind: 'bees.harvest', x: t.x, z: t.z });
      return true;
    },
    action(a, actor, bag) {
      if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('bees.')) return false;
      if (a.kind !== 'bees.harvest' || !isInt(a.x) || !isInt(a.z)) return true;
      const pose = actor === 'guest' ? ctx.other : ctx.physics;
      if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z) || Math.hypot(a.x * 2 - pose.x, a.z * 2 - pose.z) > REACH + HOST_SLACK) return true;
      const r = harvest(st, decor(), tileKey(a.x, a.z), bag);
      ctx.emit?.(r.ok ? { kind: 'loot', text: r.text, loot: { honey: r.count, wax: r.count } } : { kind: r.reason === 'full' ? 'full' : 'notice', text: r.text }, actor);
      st.r++;
      return true;
    },
    decorModel(type) {
      if (!T) return null;
      if (type === 'beehive') return createHive(T);
      if (type === 'flowerbox') return createFlowerBox(T);
      if (type === 'candle') return createCandle(T);
      return null;
    },
    debug: {
      state: () => JSON.parse(JSON.stringify(st)),
      hives: () => decor().filter(d => d && d.type === 'beehive').map(d => ({ x: d.x, z: d.z, key: tileKey(d.x, d.z), ...hiveInfo(st, decor(), d.x, d.z) })),
      target: aim => target(aim),
      status: aim => status(aim), // {key, label} the player sees at the crosshair
      /** Host QA: put a beehive / flowerbox / candle on a free raft tile. */
      place(type, x, z) {
        const w = ctx.world;
        if (ctx.role === 'guest' || !['beehive', 'flowerbox', 'candle'].includes(type) || !isInt(x) || !isInt(z) || !w) return false;
        if (!w.tiles?.some(t => t[0] === x && t[1] === z) || decor().some(d => d.x === x && d.z === z)) return false;
        w.decor.push({ type, x, z }); ctx.rebuildRaft?.(); return true;
      },
      /** Host QA: run the fill rule for `sec` seconds (in MAX_TICK chunks). */
      fastForward(sec = 360) {
        if (ctx.role === 'guest') return false;
        let left = Math.max(0, Math.floor(sec));
        while (left > 0) { const n = Math.min(MAX_TICK, left); tickBees(st, ctx.world?.decor, n); left -= n; }
        return true;
      },
    },
    dispose() { hives.length = 0; try { unprovide?.(); } catch {} unprovide = null; },
  };
}
