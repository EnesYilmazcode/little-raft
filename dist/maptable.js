// Map Table content module: a little chart table that remembers the islands you meet, the raft's
// trail and up to 8 shared pins, and can point the sail at any of them. Host-authoritative; saved in
// world.ext.maptable. Spec: docs/specs/maptable.md. The top half is pure (no DOM, no THREE) and
// exported for tests; the dialog lives in maptable-ui.js (lazy) and the mesh in maptable-model.js.
import { SAIL, wrapAxis } from './sailing-core.js';
import { ISLAND, layoutFor, pathAt, hash3 } from './islands-layout.js';
import { createMapTableModel } from './maptable-model.js';

export const HG = SAIL.GROUND_WRAP / 2;
export const TRAIL_STEP = 25, TRAIL_MAX = 240, ISL_MAX = 40, PIN_MAX = 8, PIN_RANGE = 12000;
export const REACH = 2.6, PIN_COOLDOWN = 0.25, SAMPLE = 0.5;
export const SCALES = Object.freeze([150, 600, 2500, 10000]);
export const PIN_ICONS = Object.freeze(['star', 'fish', 'heart', 'flag']);
export const FULL_TEXT = 'The chart holds 8 pins. Tap one to lift it.';

const fin = v => typeof v === 'number' && Number.isFinite(v);
const isInt = Number.isInteger;
const clampHG = v => Math.round(Math.max(-HG, Math.min(HG, v)));
const safe = (f, fb) => { try { return f(); } catch { return fb; } };
const getv = (o, k) => safe(() => o[k], undefined);
const arr = v => (safe(() => Array.isArray(v), false) ? v : null);

// ------------------------------------------------------------------ names

const NAME_A = Object.freeze(['Pebble', 'Mossy', 'Sunny', 'Clover', 'Biscuit', 'Honey', 'Pillow', 'Teacup', 'Puffin', 'Marigold', 'Seaglass', 'Sleepy', 'Butter', 'Dandelion', 'Pocket', 'Whistle']);
const NAME_B = Object.freeze(['Cay', 'Isle', 'Knoll', 'Nook', 'Haven', 'Bank', 'Holm', 'Atoll', 'Shoal', 'Landing', 'Rest', 'Hollow']);
export const NAME_WORDS = Object.freeze({ A: NAME_A, B: NAME_B });
/** Friendly, deterministic name for an island seed (nothing is stored). */
export function islandName(seed) {
  const s = seed >>> 0;
  return NAME_A[Math.floor(hash3(s, 0x4d61, 1) * NAME_A.length)] + ' ' + NAME_B[Math.floor(hash3(s, 0x4d61, 2) * NAME_B.length)];
}

// ------------------------------------------------------------------ validation

export const defaultMap = () => ({ v: 1, rev: 0, seq: 1, isl: [], pins: [], trail: [] });

/** Validate a world.ext.maptable slice. Never throws; always returns a fresh object. */
export function cleanMap(d) {
  const out = defaultMap();
  try {
    if (!d || typeof d !== 'object' || Array.isArray(d) || getv(d, 'v') !== 1) return out;
    const rev = getv(d, 'rev'); if (isInt(rev) && rev >= 0 && rev < Number.MAX_SAFE_INTEGER) out.rev = rev;
    const isl = arr(getv(d, 'isl'));
    if (isl) {
      const bySeed = new Map();
      for (let k = 0; k < isl.length && k < 4000; k++) {
        const e = safe(() => isl[k], null); if (!e || typeof e !== 'object') continue;
        const s = getv(e, 's'), x = getv(e, 'x'), z = getv(e, 'z'), f = getv(e, 'f');
        if (!(isInt(s) && s >= 0 && s < 2 ** 32) || !fin(x) || !fin(z)) continue;
        bySeed.delete(s); // last wins, and takes the newest position in the order
        bySeed.set(s, { s, x: clampHG(x), z: clampHG(z), f: isInt(f) && f >= 0 && f <= 3 ? f : 0 });
      }
      out.isl = [...bySeed.values()].slice(-ISL_MAX);
    }
    const pins = arr(getv(d, 'pins'));
    let maxN = 0;
    if (pins) {
      const ids = new Set(), list = [];
      for (let k = 0; k < pins.length && k < 4000; k++) {
        const e = safe(() => pins[k], null); if (!e || typeof e !== 'object') continue;
        const n = getv(e, 'n'), x = getv(e, 'x'), z = getv(e, 'z'), i = getv(e, 'i');
        if (!(isInt(n) && n >= 0 && n < Number.MAX_SAFE_INTEGER) || ids.has(n) || !fin(x) || !fin(z)) continue;
        ids.add(n); list.push({ n, x: clampHG(x), z: clampHG(z), i: isInt(i) && i >= 0 && i <= 3 ? i : 0 });
      }
      out.pins = list.slice(-PIN_MAX);
      for (const p of list) if (p.n + 1 > maxN) maxN = p.n + 1;
    }
    const seq = getv(d, 'seq');
    out.seq = Math.max(isInt(seq) && seq >= 1 && seq < Number.MAX_SAFE_INTEGER ? seq : 1, maxN);
    const trail = arr(getv(d, 'trail'));
    if (trail) {
      const t = [];
      for (let k = 0; k + 1 < trail.length && k < 20000; k += 2) {
        const x = safe(() => trail[k], NaN), z = safe(() => trail[k + 1], NaN);
        if (fin(x) && fin(z)) t.push(clampHG(x), clampHG(z));
      }
      out.trail = t.slice(-TRAIL_MAX);
    }
  } catch { return defaultMap(); }
  return out;
}

// ------------------------------------------------------------------ trail, islands, course

/**
 * Append (x, z) to a flat trail [x0,z0,x1,z1,...] in place when it is at least TRAIL_STEP from the last
 * point (wrap-aware). Past TRAIL_MAX numbers the older trail is thinned (every other point kept) first.
 * Returns true when the trail changed.
 */
export function pushTrail(t, x, z) {
  if (!Array.isArray(t) || !fin(x) || !fin(z)) return false;
  const n = t.length;
  if (n >= 2 && Math.hypot(wrapAxis(x - t[n - 2], HG), wrapAxis(z - t[n - 1], HG)) < TRAIL_STEP) return false;
  if (n + 2 > TRAIL_MAX) { // keep pairs 0, 2, 4, ... (in place, no allocation)
    let w = 0;
    for (let k = 0; k + 1 < n; k += 2) if (((k >> 1) & 1) === 0) { t[w++] = t[k]; t[w++] = t[k + 1]; }
    t.length = w;
  }
  t.push(clampHG(x), clampHG(z));
  return true;
}

/** Add an island to st.isl unless its seed is already charted (cap ISL_MAX, oldest dropped). */
export function recordIsland(st, seed, x, z, f = 0) {
  if (!st || !Array.isArray(st.isl) || !isInt(seed) || seed < 0 || seed >= 2 ** 32 || !fin(x) || !fin(z)) return false;
  if (st.isl.some(e => e.s === seed)) return false;
  st.isl.push({ s: seed, x: clampHG(x), z: clampHG(z), f: isInt(f) && f >= 0 && f <= 3 ? f : 0 });
  while (st.isl.length > ISL_MAX) st.isl.shift();
  return true;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compassPoint = bearing => POINTS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
/** Heading (sail convention: 0 = +z, PI/2 = +x), compass bearing (0 = north = -z) and distance to a target. */
export function courseTo(gx, gz, tx, tz) {
  const dx = wrapAxis(tx - gx, HG), dz = wrapAxis(tz - gz, HG);
  return { heading: Math.atan2(dx, dz), bearing: ((Math.atan2(dx, -dz) * 180 / Math.PI) + 360) % 360, dist: Math.hypot(dx, dz), dx, dz };
}
export const distText = d => (d < 1000 ? Math.round(d / 10) * 10 + ' m' : (d < 10000 ? (Math.round(d / 100) / 10).toFixed(1) : Math.round(d / 1000)) + ' km');

// ------------------------------------------------------------------ the content module

export function createMapTable(ctx, opts = {}) {
  const T = ctx.T;
  const peek = typeof opts.peek === 'function' ? opts.peek : () => undefined;
  let st = cleanMap(undefined);
  let cache = null, dirty = true, viewRev = 0, netSynced = false;
  let acc = 0, firstTick = true;
  const cool = { host: -Infinity, guest: -Infinity };
  const path = { phase: 'gone', z: 0, left: 0, sink: 0 };
  let ui = null, uiLoading = null, uiFailed = false, unprovide = null;
  const scratch = T ? new T.Vector3() : null;

  const now = () => (fin(ctx.elapsed) ? ctx.elapsed : Date.now() / 1000);
  const host = () => ctx.role !== 'guest';
  const sailing = () => { const g = ctx.world?.sailing; return g && fin(g.gx) && fin(g.gz) ? g : null; };
  const change = () => { st.rev++; dirty = true; viewRev++; };
  const tell = (text, to) => { try { ctx.emit?.({ kind: 'notice', text }, to); } catch {} };

  // Nearest map table along the view ray within reach (same cone test as the storage chest).
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else if (scratch) { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    else return null;
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (!d || d.type !== 'maptable') continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      const cy = (ctx.raft?.position.y ?? 0) + .8;
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > .85) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  // ---------- host: trail + discovery (2 Hz) ----------
  function near(pos, x, z, r) { return !!pos && fin(pos.x) && fin(pos.z) && Math.hypot(pos.x - x, pos.z - z) <= r; }
  function sample() {
    const g = sailing();
    if (g && pushTrail(st.trail, g.gx, g.gz)) change();
    const isl = peek('islands');
    const i = isl && isl.isl;
    if (!i || !g || !isInt(i.seed)) { firstTick = false; return; }
    const lay = layoutFor(i.seed);
    pathAt((fin(isl.clock) ? isl.clock : 0) - i.born, i.dock, lay.dockZ, path);
    if (path.phase === 'gone') { firstTick = false; return; }
    let e = null;
    for (let k = 0; k < st.isl.length; k++) if (st.isl[k].s === i.seed) { e = st.isl[k]; break; }
    if (!e && (path.phase === 'docked' || firstTick)) {
      if (recordIsland(st, i.seed, g.gx + i.side * i.off, g.gz + lay.dockZ)) {
        e = st.isl[st.isl.length - 1]; change();
        tell(`Charted ${islandName(i.seed)}`, 'all');
      }
    }
    firstTick = false;
    if (!e) return;
    let f = e.f;
    const cx = i.side * i.off, r = lay.R * ISLAND.RIM + 1;
    if (near(ctx.physics, cx, path.z, r) || near(ctx.other, cx, path.z, r)) f |= 1;
    if (Array.isArray(i.used) && lay.nodes.length && lay.nodes.every((n, k) => i.used[k] >= n.max)) f |= 2;
    if (f !== e.f) { e.f = f; change(); }
  }

  // ---------- actions ----------
  function action(a, actor = 'host') {
    if (!a || typeof a !== 'object' || a.kind !== 'map') return false;
    if (!host()) return true;
    if (a.op === 'pin') {
      const g = sailing(), gx = g ? g.gx : 0, gz = g ? g.gz : 0;
      if (!fin(a.x) || !fin(a.z) || !isInt(a.i) || a.i < 0 || a.i > 3) return true;
      if (Math.abs(wrapAxis(a.x - gx, HG)) > PIN_RANGE || Math.abs(wrapAxis(a.z - gz, HG)) > PIN_RANGE) return true;
      if (st.pins.length >= PIN_MAX) { tell(FULL_TEXT, actor); return true; }
      const key = actor === 'guest' ? 'guest' : 'host', t = now();
      if (t - cool[key] < PIN_COOLDOWN) return true;
      cool[key] = t;
      st.pins.push({ n: st.seq++, x: clampHG(a.x), z: clampHG(a.z), i: a.i });
      change();
      return true;
    }
    if (a.op === 'unpin') {
      if (!isInt(a.n)) return true;
      const k = st.pins.findIndex(p => p.n === a.n);
      if (k >= 0) { st.pins.splice(k, 1); change(); }
      return true;
    }
    return true;
  }

  // Point the sail at a seabed spot (shared sail action) and say so.
  function course(tx, tz) {
    const g = sailing(); if (!g || !fin(tx) || !fin(tz)) { ctx.notice?.('The chart cannot find the raft right now'); return null; }
    const c = courseTo(g.gx, g.gz, tx, tz);
    ctx.action?.({ kind: 'sail', op: 'heading', heading: c.heading });
    ctx.notice?.(`Course set: ${compassPoint(c.bearing)} · ${distText(c.dist)} (wind still decides the speed)${g.anchored ? ' · Anchor is down' : ''}`, 3200);
    return c;
  }

  // ---------- UI ----------
  const api = {
    ctx,
    get state() { return st; },
    viewRev: () => viewRev,
    sailing,
    send: a => { ctx.action?.(a); },
    course,
    notice: (s, ms) => ctx.notice?.(s, ms),
    releaseLock: () => ctx.releaseLock?.(),
    requestLock: () => { if (ctx.running) ctx.requestLock?.(); },
    running: () => !!ctx.running,
  };
  function loadUI() {
    if (ui || uiLoading || uiFailed || typeof document === 'undefined') return uiLoading;
    uiLoading = import('./maptable-ui.js').then(m => { ui = m.createMapTableUI(api); return ui; })
      .catch(e => { console.error('map table ui failed', e); uiFailed = true; uiLoading = null; return null; });
    return uiLoading;
  }
  function open() {
    if (ui) { ui.open(); return true; }
    const p = loadUI(); if (!p) return false;
    ctx.notice?.('Unrolling the chart…', 1400);
    p.then(u => { if (u && !ctx.uiOpen?.()) u.open(); });
    return true;
  }

  function provide() {
    if (unprovide || typeof window === 'undefined') return;
    const P = safe(() => window.raftPrompts, null);
    if (!P || typeof P.provide !== 'function') return;
    unprovide = P.provide({ id: 'maptable', priority: 1, prompt: c => {
      const s = c?.state;
      if (!s?.running || s.pickup || (s.role === 'guest' && !s.networkReady) || ctx.uiOpen?.() || !target(null)) return null;
      return { key: 'E', label: 'Read the chart' };
    } });
  }
  provide();

  function serialize() {
    if (!dirty && cache) return cache;
    cache = { v: 1, rev: st.rev, seq: st.seq, isl: st.isl.map(e => ({ ...e })), pins: st.pins.map(p => ({ ...p })), trail: st.trail.slice() };
    dirty = false;
    return cache;
  }
  function load(data, from) {
    if (from === 'net') {
      if (netSynced && data && typeof data === 'object' && data.v === 1 && data.rev === st.rev) return; // ~8 Hz cheap path
      st = cleanMap(data); netSynced = true; dirty = true; viewRev++;
      return;
    }
    st = cleanMap(data); netSynced = false; dirty = true; viewRev++; firstTick = true; acc = 0;
  }

  const debug = {
    state: () => JSON.parse(JSON.stringify(st)),
    addIsland(seed, x, z, f = 0) { if (!host()) return false; const ok = recordIsland(st, seed >>> 0, x, z, f); if (ok) change(); return ok; },
    pin(x, z, i = 0) { const before = st.pins.length; cool.host = -Infinity; action({ kind: 'map', op: 'pin', x, z, i }, 'host'); return st.pins.length > before ? st.pins[st.pins.length - 1].n : null; },
    trail(points) {
      if (!host() || !Array.isArray(points)) return false;
      const flat = points.flat ? points.flat() : points;
      st.trail.length = 0;
      for (let k = 0; k + 1 < flat.length; k += 2) pushTrail(st.trail, flat[k], flat[k + 1]);
      change(); return st.trail.length / 2;
    },
    open: () => open(),
    close: () => ui?.close(),
    course(n = 0) { const e = st.isl[n]; return e ? course(e.x, e.z) : null; },
    ui: () => ui?.debug ?? null,
    place(x = 1, z = 0, type = 'maptable') { // QA: put a table (or e.g. a receiver for the wedge) on raft tile (x, z), skipping bag/unlock
      const w = ctx.world; if (!host() || !w || !Array.isArray(w.decor) || !w.tiles?.some(t => t[0] === x && t[1] === z)) return false;
      if (!w.decor.some(d => d.x === x && d.z === z)) { w.decor.push({ type: String(type), x, z }); ctx.rebuildRaft?.(); }
      return w.decor.some(d => d.x === x && d.z === z && d.type === type);
    },
    signalSoon() { const sg = ctx.world?.signal; if (!host() || !sg || sg.cache) return false; sg.cooldown = 0; return true; }, // QA: skip the receiver's first wait (wedge shots)
    aimAt() { // QA: yaw/pitch that look from the player at the nearest table top
      const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam) return null;
      const d = w.decor.filter(e => e.type === 'maptable').sort((a, b) => Math.hypot(a.x * 2 - p.x, a.z * 2 - p.z) - Math.hypot(b.x * 2 - p.x, b.z * 2 - p.z))[0];
      if (!d) return null;
      const dx = d.x * 2 - cam.position.x, dz = d.z * 2 - cam.position.z, dy = (ctx.raft?.position.y ?? 0) + .8 - cam.position.y;
      return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), dist: Math.hypot(d.x * 2 - p.x, d.z * 2 - p.z) };
    },
    target: () => !!target(null),
  };

  return {
    name: 'maptable',
    serialize,
    load,
    action,
    update(dt) {
      if (!unprovide) provide();
      if (ui) ui.update(dt);
      if (!host() || !ctx.running) return;
      if (!(dt > 0)) return;
      acc += dt;
      if (acc < SAMPLE) return;
      acc = acc > SAMPLE * 4 ? 0 : acc - SAMPLE;
      sample();
    },
    interact(aim) { if (!target(aim)) return false; open(); return true; },
    prompt(aim) { return target(aim) ? '<kbd>E</kbd>Read the chart' : null; },
    decorModel(type) {
      if (type !== 'maptable' || !T) return null;
      return createMapTableModel(T);
    },
    dispose() {
      try { unprovide?.(); } catch {} unprovide = null;
      try { ui?.dispose(); } catch {} ui = null;
    },
    debug,
  };
}
