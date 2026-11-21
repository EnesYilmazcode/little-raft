// Water Tank and Water Pipe (see docs/specs/water-pipes.md). A placeable tank holds 12 cups; thin pipes laid on deck
// tiles join it to rain barrels (in) and palm planters and sprinklers (out). Cozy rules: nothing wilts, nothing breaks,
// and a lifted pipe always goes back to your bag. Slice: world.ext.pipes, host-authoritative, actions 'pipes.*'.
// The top half of this file is pure (no DOM, no Date, no Math.random) and exported for tests.
import { plantStage, swapOne } from './watering.js?build=v3-survival-ae77fa84ac2b';
import { SPRINKLER_CAP } from './rain.js?build=v3-survival-ae77fa84ac2b';
import { TANK_CAP, createWaterTank, paintTank, createPipeMeshes, createPipeGhost } from './pipes-model.js?build=v3-survival-ae77fa84ac2b';

export { TANK_CAP };
export const MAX_PIPES = 400, MAX_TICK = 60, REACH = 3, HOST_SLACK = 2;
export const OLD_HOST = 'Your friend’s raft doesn’t have pipes yet';
export const TEXT = Object.freeze({
  notile: 'Lay pipes on the deck', haspipe: 'There is already a pipe here', cap: 'That is a lot of pipe', noitem: 'You need a water pipe',
  nopipe: 'No pipe there', full: 'Your bag is full', tankfull: 'The tank is full', tankempty: 'The tank is empty', nocup: 'You need a cup',
  notarget: 'Nothing to use that on', far: 'Try a spot a little closer', fill: '+ 1 cup of fresh water',
});

const KEY_RE = /^-?\d+,-?\d+$/;
const isInt = Number.isInteger;
const isPlain = o => !!o && typeof o === 'object' && !Array.isArray(o);
export const tileKey = (x, z) => x + ',' + z;
const isKey = k => typeof k === 'string' && k.length <= 24 && KEY_RE.test(k) && (() => { const [x, z] = k.split(',').map(Number); return tileKey(x, z) === k; })();
const clampInt = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : lo);
const NB = Object.freeze([[1, 0], [0, 1], [-1, 0], [0, -1]]); // dir 0..3 = mask bits 1:+x 2:+z 4:-x 8:-z

// ------------------------------------------------------------------ tables (so crops can join later)

// SOURCES feed a tank. Rain barrels only for now: a purifier row would delete the ready cup, which a player could lose
// track of (see Build notes in the spec). A future source adds one row here and nothing else.
export const SOURCES = Object.freeze([ // order = priority inside a net
  { type: 'rainbarrel', has: (w, k, res) => (w.collectors?.[k]?.w ?? 0) >= 1 + res, take: (w, k) => { w.collectors[k].w -= 1; } },
]);
export const WATERABLE = Object.freeze([
  { type: 'palm', wants: (w, k) => plantStage(w.garden?.[k]) < 2 && w.garden?.[k]?.water !== 1, give: (w, k) => { (w.garden ??= {})[k] = { water: 1, grow: w.garden[k]?.grow ?? 0 }; } },
  { type: 'sprinkler', wants: (w, k) => (w.sprinklers?.[k]?.w ?? 0) < SPRINKLER_CAP, give: (w, k) => { const m = (w.sprinklers ??= {}); (m[k] ??= { w: 0, s: 0 }).w += 1; } },
]);
const TABLES = Object.freeze({ sources: SOURCES, sinks: WATERABLE });

// ------------------------------------------------------------------ state

function typeMap(decor) { // first decor per tile wins, like cleanWorld
  const m = new Map();
  if (Array.isArray(decor)) for (const d of decor) if (d && typeof d.type === 'string' && isInt(d.x) && isInt(d.z)) { const k = tileKey(d.x, d.z); if (!m.has(k)) m.set(k, d.type); }
  return m;
}
function tileSet(tiles) {
  const s = new Set();
  if (Array.isArray(tiles)) for (const t of tiles) if (Array.isArray(t) && isInt(t[0]) && isInt(t[1])) s.add(tileKey(t[0], t[1]));
  return s;
}

/** Validated slice. Junk -> defaults; bad keys, non-tiles and non-tank cups dropped; w clamped to 1..12. */
export function cleanPipes(v, tiles, decor) {
  const out = { v: 1, s: '', r: 0, g: 0, p: {}, t: {} };
  if (!isPlain(v)) return out;
  if (typeof v.s === 'string' && v.s.length <= 32) out.s = v.s;
  if (isInt(v.r) && v.r >= 0) out.r = v.r;
  if (isInt(v.g) && v.g >= 0) out.g = v.g;
  const ts = tileSet(tiles), types = typeMap(decor);
  let n = 0;
  if (isPlain(v.p)) for (const k of Object.keys(v.p)) {
    if (n >= MAX_PIPES) break;
    if (!isKey(k) || !ts.has(k)) continue;
    out.p[k] = 1; n++;
  }
  if (isPlain(v.t)) for (const k of Object.keys(v.t)) {
    if (!isKey(k) || types.get(k) !== 'watertank') continue;
    const w = clampInt(v.t[k], 0, TANK_CAP);
    if (w > 0) out.t[k] = w;
  }
  return out;
}

/** Host prune against the live world: pipes off a tile (g++) and cups off a tank. -> true if anything changed. */
export function prunePipes(st, world, cache) {
  const ts = cache ? cachedTiles(cache, world?.tiles) : tileSet(world?.tiles), types = cache ? cachedNets(cache, st, world).types : typeMap(world?.decor);
  let gp = false, ch = false;
  for (const k of Object.keys(st.p)) if (!ts.has(k)) { delete st.p[k]; gp = true; }
  for (const k of Object.keys(st.t)) if (types.get(k) !== 'watertank' || !(st.t[k] > 0)) { delete st.t[k]; ch = true; }
  if (gp) st.g++;
  return gp || ch;
}

// ------------------------------------------------------------------ networks

/** Pure. Nets over pipe tiles + tank tiles (4-neighbour). -> {nets:[{tanks, nodes, sources, sinks, src, snk}], netOf, types, devNet} */
export function buildNets(st, world, tables = TABLES) {
  const types = typeMap(world?.decor), rowOf = new Map();
  tables.sources.forEach((r, i) => rowOf.has(r.type) || rowOf.set(r.type, ['src', i, r]));
  tables.sinks.forEach((r, i) => rowOf.has(r.type) || rowOf.set(r.type, ['snk', i, r]));
  const tanks = [], devices = [];
  for (const [k, t] of types) { if (t === 'watertank') tanks.push(k); else if (rowOf.has(t)) devices.push(k); }
  tanks.sort(); devices.sort();
  const isNode = k => st.p[k] === 1 || types.get(k) === 'watertank';
  const netOf = new Map(), nets = [];
  for (const t0 of tanks) {
    if (netOf.has(t0)) continue;
    const idx = nets.length, nodes = new Set([t0]), queue = [t0]; netOf.set(t0, idx);
    while (queue.length) {
      const k = queue.shift(), [x, z] = k.split(',').map(Number);
      for (const [dx, dz] of NB) { const nk = tileKey(x + dx, z + dz); if (!netOf.has(nk) && isNode(nk)) { netOf.set(nk, idx); nodes.add(nk); queue.push(nk); } }
    }
    nets.push({ tanks: [...nodes].filter(k => types.get(k) === 'watertank').sort(), nodes, sources: [], sinks: [], src: [], snk: [] });
  }
  const devNet = new Map();
  for (const k of devices) {
    const [x, z] = k.split(',').map(Number);
    let best = netOf.has(k) ? netOf.get(k) : Infinity;
    for (const [dx, dz] of NB) { const n = netOf.get(tileKey(x + dx, z + dz)); if (n !== undefined && n < best) best = n; }
    if (best === Infinity) continue;
    const [kind, i, row] = rowOf.get(types.get(k)), net = nets[best];
    devNet.set(k, best);
    if (kind === 'src') { net.sources.push(k); net.src.push([i, k, row]); } else { net.sinks.push(k); net.snk.push([i, k, row]); }
  }
  const byRow = (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
  for (const n of nets) { n.sources.sort(); n.sinks.sort(); n.src.sort(byRow); n.snk.sort(byRow); }
  return { nets, netOf, types, devNet };
}

/** Decor signature: `type@x,z` for tanks and device types (string; changes only when the layout can). */
export function decorSig(decor, tables = TABLES) {
  const want = new Set(['watertank']); for (const r of tables.sources) want.add(r.type); for (const r of tables.sinks) want.add(r.type);
  let s = '';
  if (Array.isArray(decor)) for (const d of decor) if (d && want.has(d.type)) s += d.type + '@' + d.x + ',' + d.z + ';';
  return s;
}

/** Cache: {tables}. Rebuilds only when g, the decor signature (recomputed when decor identity/length changes) or the slice changes. */
export function newNetCache(tables = TABLES) { return { tables, decor: null, len: -1, sig: '', g: -1, st: null, nets: null, tiles: null, tlen: -1, tset: null }; }
function cachedNets(c, st, world) {
  const d = world?.decor;
  if (d !== c.decor || (Array.isArray(d) ? d.length : -1) !== c.len) { c.decor = d; c.len = Array.isArray(d) ? d.length : -1; const s = decorSig(d, c.tables); if (s !== c.sig) { c.sig = s; c.nets = null; } }
  if (!c.nets || c.g !== st.g || c.st !== st) { c.nets = buildNets(st, world, c.tables); c.g = st.g; c.st = st; }
  return c.nets;
}
function cachedTiles(c, tiles) {
  if (tiles !== c.tiles || (Array.isArray(tiles) ? tiles.length : -1) !== c.tlen || !c.tset) { c.tiles = tiles; c.tlen = Array.isArray(tiles) ? tiles.length : -1; c.tset = tileSet(tiles); }
  return c.tset;
}
export const netsFor = (cache, st, world) => cachedNets(cache, st, world);

// ------------------------------------------------------------------ host tick

const tankW = (st, k) => st.t[k] ?? 0;
function leastFull(st, tanks) { let best = null, bw = Infinity; for (const k of tanks) { const w = tankW(st, k); if (w < TANK_CAP && w < bw) { bw = w; best = k; } } return best; }
function fullest(st, tanks) { let best = null, bw = 0; for (const k of tanks) { const w = tankW(st, k); if (w >= 1 && w > bw) { bw = w; best = k; } } return best; }
const addCup = (st, k, d) => { const w = tankW(st, k) + d; if (w > 0) st.t[k] = w; else delete st.t[k]; };

/** One second of flow over every net. Mutates the world maps and st.t. -> cups moved. */
function stepOnce(st, world, N) {
  let moved = 0;
  const netted = new Set(); for (const n of N.nets) for (const k of n.sinks) netted.add(k);
  for (const net of N.nets) {
    for (const [, k, row] of net.src) { // 1. inflow, at most 1 cup per source
      const into = leastFull(st, net.tanks); if (!into) break;
      let res = 0;
      if (row.type === 'rainbarrel') { // barrel contention: keep a cup for an un-netted sprinkler beside it
        const [x, z] = k.split(',').map(Number);
        for (const [dx, dz] of NB) { const nk = tileKey(x + dx, z + dz); if (N.types.get(nk) === 'sprinkler' && !netted.has(nk)) { res = 1; break; } }
      }
      if (!row.has(world, k, res)) continue;
      row.take(world, k); addCup(st, into, 1); moved++;
    }
    for (const [, k, row] of net.snk) { // 2. outflow, at most 1 cup per sink, palms before sprinklers
      const from = fullest(st, net.tanks); if (!from) break;
      if (!row.wants(world, k)) continue;
      row.give(world, k); addCup(st, from, -1); moved++;
    }
  }
  return moved;
}

/** Host tick: whole seconds (floored, clamped 0..MAX_TICK). Bumps st.r on any change. No toasts. */
export function tickPipes(st, world, dt, cache = newNetCache()) {
  const n = typeof dt === 'number' && Number.isFinite(dt) ? Math.min(MAX_TICK, Math.max(0, Math.floor(dt))) : 0;
  let changed = false, moved = 0;
  for (let i = 0; i < n; i++) {
    if (prunePipes(st, world, cache)) changed = true;
    const m = stepOnce(st, world, cachedNets(cache, st, world));
    if (m) { moved += m; changed = true; }
  }
  if (changed) st.r++;
  return moved;
}

// ------------------------------------------------------------------ actions (host)

const decorAt = (world, k, type) => Array.isArray(world?.decor) && world.decor.some(d => d && d.type === type && tileKey(d.x, d.z) === k);
const hasTile = (world, x, z) => Array.isArray(world?.tiles) && world.tiles.some(t => t && t[0] === x && t[1] === z);
const fail = reason => ({ ok: false, reason, text: TEXT[reason] });
const bagFits = (bag, kind, n) => { if (!bag || typeof bag.snapshot !== 'function') return false; const s = new bag.constructor(bag.snapshot()); return s.add(kind, n) === 0; };

/** Pure host action. pose = the actor's {x,z}. -> {ok, reason?, text?, kind?} */
export function pipeAction(st, world, a, bag, pose) {
  if (!a || !isInt(a.x) || !isInt(a.z)) return fail('notarget');
  if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z) || Math.hypot(a.x * 2 - pose.x, a.z * 2 - pose.z) > REACH + HOST_SLACK) return fail('far');
  const k = tileKey(a.x, a.z);
  switch (a.kind) {
    case 'pipes.lay': {
      if (!hasTile(world, a.x, a.z)) return fail('notile');
      if (st.p[k] === 1) return fail('haspipe');
      if (Object.keys(st.p).length >= MAX_PIPES) return fail('cap');
      if (!bag || !bag.remove('waterpipe', 1)) return fail('noitem');
      st.p[k] = 1; st.g++; st.r++;
      return { ok: true };
    }
    case 'pipes.lift': {
      if (st.p[k] !== 1) return fail('nopipe');
      if (!bagFits(bag, 'waterpipe', 1)) return fail('full'); // the pipe stays until it fits
      if (bag.add('waterpipe', 1) !== 0) return fail('full');
      delete st.p[k]; st.g++; st.r++;
      return { ok: true };
    }
    case 'pipes.pour': {
      if (!decorAt(world, k, 'watertank')) return fail('notarget');
      if (tankW(st, k) >= TANK_CAP) return fail('tankfull');
      if (!bag || bag.count('freshcup') < 1) return fail('nocup');
      if (!swapOne(bag, 'freshcup', 'cup')) return fail('full');
      addCup(st, k, 1); st.r++;
      return { ok: true };
    }
    case 'pipes.fill': {
      if (!decorAt(world, k, 'watertank')) return fail('notarget');
      if (tankW(st, k) < 1) return fail('tankempty');
      if (!bag || bag.count('cup') < 1) return fail('nocup');
      if (!swapOne(bag, 'cup', 'freshcup')) return fail('full');
      addCup(st, k, -1); st.r++;
      return { ok: true, kind: 'loot', text: TEXT.fill };
    }
  }
  return fail('notarget');
}

// ------------------------------------------------------------------ prompts and layout (pure)

/** view: {old, held, tile:{deck, pipe}|null, left, tank:{w, feeding}|null}. First match wins (spec section 7). */
export function promptText(v) {
  if (!v) return null;
  if (v.held === 'waterpipe') {
    if (v.old) return OLD_HOST;
    if (v.tile?.deck && !v.tile.pipe) return `<kbd>Click</kbd>Lay pipe (${v.left} left) · Right click lifts`;
    if (v.tile?.pipe) return '<kbd>Right click</kbd>Lift pipe';
    return 'Water pipe: point at the deck';
  }
  const t = v.tank; if (!t) return null;
  if (v.old) return OLD_HOST;
  const N = t.w;
  if (v.held === 'freshcup') return N < TANK_CAP ? `<kbd>E</kbd>Pour in fresh water (${N}/${TANK_CAP})` : `Water tank: full (${TANK_CAP}/${TANK_CAP})`;
  if (v.held === 'cup') return N >= 1 ? `<kbd>E</kbd>Fill cup (${N}/${TANK_CAP})` : 'Water tank: empty · pipe in a rain barrel';
  if (v.held === 'saltcup') return `Water tank: ${N}/${TANK_CAP} · fresh water only`;
  return t.feeding > 0 ? `Water tank: ${N}/${TANK_CAP} · feeding ${t.feeding}` : `Water tank: ${N}/${TANK_CAP} · not piped to anything`;
}

const KIND = ['cap', 'cap', 'cap', 'elbow', 'cap', 'straight', 'elbow', 'tee', 'cap', 'elbow', 'straight', 'tee', 'elbow', 'tee', 'tee', 'cross'];
export const jointKind = mask => KIND[mask & 15];

/** Pure: {joints:[[x,z,kind,wet]], arms:[[x,z,dir,start,len,wet]]}. Mask bits 1:+x 2:+z 4:-x 8:-z. */
export function pipeLayout(st, decor, N) {
  const types = N?.types ?? typeMap(decor), netOf = N?.netOf ?? new Map(), devNet = N?.devNet ?? new Map(), nets = N?.nets ?? [];
  const wet = nets.map(n => n.tanks.some(k => tankW(st, k) > 0) ? 1 : 0);
  const joints = [], arms = [];
  const keys = Object.keys(st.p).sort();
  for (const k of keys) {
    const [x, z] = k.split(',').map(Number), net = netOf.get(k), w = net === undefined ? 0 : wet[net];
    let mask = 0;
    NB.forEach(([dx, dz], dir) => {
      const nk = tileKey(x + dx, z + dz);
      const on = st.p[nk] === 1 || (net !== undefined && (types.get(nk) === 'watertank' ? netOf.get(nk) === net : devNet.get(nk) === net));
      if (on) { mask |= 1 << dir; arms.push([x, z, dir, 0, 1, w]); }
    });
    joints.push([x, z, jointKind(mask), w]);
  }
  // tank / device tiles that touch a net pipe get a stub arm from their edge inward so the pipe meets the model
  const ends = [];
  for (const [k, t] of types) if (st.p[k] !== 1 && (t === 'watertank' ? netOf.has(k) : devNet.has(k))) ends.push(k);
  ends.sort();
  for (const k of ends) {
    const [x, z] = k.split(',').map(Number), net = types.get(k) === 'watertank' ? netOf.get(k) : devNet.get(k);
    NB.forEach(([dx, dz], dir) => { const nk = tileKey(x + dx, z + dz); if (st.p[nk] === 1 && netOf.get(nk) === net) arms.push([x, z, dir, 1, .62, wet[net]]); });
  }
  return { joints, arms };
}

// ------------------------------------------------------------------ the content module

export function createPipes(ctx) {
  const T = ctx.T;
  const session = Math.random().toString(36).slice(2, 10);
  let st = cleanPipes(undefined); st.s = session;
  let cache = null, cacheSt = null, cacheR = -1, netR = -1, netS = null, netUndef = false, hostHas = true, clock = 0;
  const nc = newNetCache();
  let meshes = null, ghost = null, meshScene = null, layN = null, layG = -1, laySt = null, layY = NaN;
  const wetNow = [], wetWas = [];
  const tanks = []; let scanLen = -1, scanFirst = null, scanRaft = null;
  const scratch = T ? new T.Vector3() : null;
  let pmRow = -1, pmA = -1, pmB = -1, pmS = null; // prompt memo

  const oldHost = () => ctx.role === 'guest' && !hostHas;
  const world = () => ctx.world;
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);
  const nets = () => cachedNets(nc, st, ctx.world);
  const bag = () => ctx.localBag?.() ?? null;
  const heldKind = () => { if (ctx.heldKind) return ctx.heldKind(); const b = bag(); return b?.slots?.[b.selectedIndex]?.kind ?? null; };
  const tileOf = aim => (aim?.point && Number.isFinite(aim.point.x) && Number.isFinite(aim.point.z) ? [Math.round(aim.point.x / 2), Math.round(aim.point.z / 2)] : null);
  const deckY = () => (ctx.deckY ? ctx.deckY() : (ctx.raft?.position.y ?? 0) + .2);

  // Nearest water tank along the view ray (or the camera forward when no aim), within reach (as bees target()).
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else if (scratch) { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; } else return null;
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (!d || d.type !== 'watertank') continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      const cy = (ctx.raft?.position.y ?? 0) + .7;
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > .85) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best ? { x: best.x, z: best.z, key: tileKey(best.x, best.z) } : null;
  }
  const feeding = k => { const N = nets(), i = N.netOf.get(k); return i === undefined ? 0 : N.nets[i].sinks.length; };
  const hasDeck = (x, z) => hasTile(ctx.world, x, z);

  function memo(row, a, b, f) { if (row !== pmRow || a !== pmA || b !== pmB) { pmRow = row; pmA = a; pmB = b; pmS = f(); } return pmS; }
  function prompt(aim) {
    const held = heldKind();
    if (held === 'waterpipe') {
      if (oldHost()) return OLD_HOST;
      const t = tileOf(aim), deck = !!t && hasDeck(t[0], t[1]), pipe = !!t && st.p[tileKey(t[0], t[1])] === 1, left = bag()?.count?.('waterpipe') ?? 0;
      const row = pipe ? 2 : deck ? 1 : 3;
      return memo(row, left, 0, () => promptText({ held, tile: { deck, pipe }, left }));
    }
    const t = target(aim); if (!t) return null;
    if (oldHost()) return OLD_HOST;
    const w = tankW(st, t.key), f = feeding(t.key), hk = held === 'freshcup' ? 11 : held === 'cup' ? 12 : held === 'saltcup' ? 13 : 14;
    return memo(hk, w, f, () => promptText({ held, tank: { w, feeding: f } }));
  }

  function use(aim, kind) {
    if (kind !== 'waterpipe') return false;
    if (oldHost()) { ctx.notice?.(OLD_HOST, 2400); return true; }
    const t = tileOf(aim); if (!t || !hasDeck(t[0], t[1])) { ctx.notice?.(TEXT.notile); return true; }
    const k = tileKey(t[0], t[1]), p = ctx.physics;
    if (st.p[k] === 1) { ctx.notice?.(TEXT.haspipe); return true; }
    if (p && Math.hypot(t[0] * 2 - p.x, t[1] * 2 - p.z) > REACH + .5) { ctx.notice?.(TEXT.far); return true; }
    if (Object.keys(st.p).length >= MAX_PIPES) { ctx.notice?.(TEXT.cap); return true; }
    if ((bag()?.count?.('waterpipe') ?? 0) < 1) { ctx.notice?.(TEXT.noitem); return true; }
    ctx.action({ kind: 'pipes.lay', x: t[0], z: t[1] });
    return true;
  }
  function alt(aim, kind) {
    if (kind !== 'waterpipe') return false;
    if (oldHost()) { ctx.notice?.(OLD_HOST, 2400); return true; }
    const t = tileOf(aim); if (!t || st.p[tileKey(t[0], t[1])] !== 1) { ctx.notice?.(TEXT.nopipe); return true; }
    const p = ctx.physics;
    if (p && Math.hypot(t[0] * 2 - p.x, t[1] * 2 - p.z) > REACH + .5) { ctx.notice?.(TEXT.far); return true; }
    const b = bag(); if (b && !bagFits(b, 'waterpipe', 1)) { ctx.notice?.(TEXT.full); return true; }
    ctx.action({ kind: 'pipes.lift', x: t[0], z: t[1] });
    return true;
  }
  function interact(aim) {
    const t = target(aim); if (!t) return false;
    if (oldHost()) { ctx.notice?.(OLD_HOST, 2400); return true; }
    const held = heldKind(), w = tankW(st, t.key);
    if (held === 'freshcup') { if (w >= TANK_CAP) ctx.notice?.(TEXT.tankfull); else ctx.action({ kind: 'pipes.pour', x: t.x, z: t.z }); return true; }
    if (held === 'cup') { if (w < 1) ctx.notice?.(TEXT.tankempty); else ctx.action({ kind: 'pipes.fill', x: t.x, z: t.z }); return true; }
    ctx.notice?.(promptText({ held, tank: { w, feeding: feeding(t.key) } }));
    return true;
  }

  // ---- visuals
  function scanTanks() {
    const raft = ctx.raft; if (!raft) { tanks.length = 0; return; }
    const kids = raft.children;
    if (raft === scanRaft && kids.length === scanLen && kids[0] === scanFirst) return;
    scanRaft = raft; scanLen = kids.length; scanFirst = kids[0];
    tanks.length = 0;
    for (let i = 0; i < kids.length; i++) { const g = kids[i]; if (g.name === 'craft_watertank') tanks.push({ g, k: tileKey(Math.round(g.position.x / 2), Math.round(g.position.z / 2)) }); }
  }
  function paint() {
    const scene = ctx.scene, raft = ctx.raft; if (!scene) return;
    if (!meshes) { meshes = createPipeMeshes(T); ghost = createPipeGhost(T); }
    if (meshScene !== scene) { meshes.joints.removeFromParent(); meshes.arms.removeFromParent(); ghost.removeFromParent(); scene.add(meshes.joints, meshes.arms, ghost); meshScene = scene; }
    let y = deckY();
    if (raft) {
      y -= raft.position.y;
      meshes.joints.position.copy(raft.position); meshes.joints.quaternion.copy(raft.quaternion);
      meshes.arms.position.copy(raft.position); meshes.arms.quaternion.copy(raft.quaternion);
    }
    const N = nets();
    let dirty = N !== layN || st.g !== layG || st !== laySt || y !== layY;
    wetNow.length = N.nets.length;
    for (let i = 0; i < N.nets.length; i++) { let w = 0; const ts = N.nets[i].tanks; for (let j = 0; j < ts.length; j++) if (tankW(st, ts[j]) > 0) { w = 1; break; } wetNow[i] = w; }
    if (wetNow.length !== wetWas.length) dirty = true; else for (let i = 0; i < wetNow.length; i++) if (wetNow[i] !== wetWas[i]) { dirty = true; break; }
    if (dirty) {
      layN = N; layG = st.g; laySt = st; layY = y; wetWas.length = wetNow.length; for (let i = 0; i < wetNow.length; i++) wetWas[i] = wetNow[i];
      meshes.write(pipeLayout(st, decor(), N), y);
    }
    // ghost joint at the aimed tile while a pipe is held
    const held = ctx.running ? heldKind() : null, t = held === 'waterpipe' ? tileOf(ctx.aim?.() ?? null) : null;
    if (t && raft && hasDeck(t[0], t[1]) && !oldHost()) {
      const k = tileKey(t[0], t[1]), p = ctx.physics;
      ghost.userData.setOk(st.p[k] !== 1 && (!p || Math.hypot(t[0] * 2 - p.x, t[1] * 2 - p.z) <= REACH + .5));
      ghost.position.set(t[0] * 2, y + .005, t[1] * 2).applyQuaternion(raft.quaternion).add(raft.position); ghost.quaternion.copy(raft.quaternion);
      ghost.visible = true;
    } else ghost.visible = false;
    scanTanks();
    for (let i = 0; i < tanks.length; i++) paintTank(tanks[i].g, oldHost() ? 0 : tankW(st, tanks[i].k));
  }

  function load(data, from) {
    if (from === 'net') {
      if (data && typeof data === 'object' && data.r === netR && data.s === netS) return; // unchanged host state
      if (data === undefined && netUndef) return;
      netUndef = data === undefined; hostHas = data !== undefined;
      st = cleanPipes(data, ctx.world?.tiles, ctx.world?.decor);
      netR = data && typeof data === 'object' ? data.r : -1; netS = data && typeof data === 'object' ? data.s : null;
      return;
    }
    netR = -1; netS = null; netUndef = false; hostHas = true;
    st = cleanPipes(data, ctx.world?.tiles, ctx.world?.decor);
    st.s = session; st.r++; st.g++;
  }
  function serialize() {
    if (cache && cacheSt === st && cacheR === st.r) return cache;
    cache = JSON.parse(JSON.stringify(st)); cacheSt = st; cacheR = st.r;
    return cache;
  }

  return {
    name: 'pipes',
    load,
    serialize,
    update(dt) {
      if (T) paint();
      if (!ctx.running || ctx.role === 'guest') return;
      clock += dt > 0 ? dt : 0;
      if (clock >= 1) { const n = Math.floor(clock); clock -= n; if (ctx.world) tickPipes(st, ctx.world, n, nc); }
    },
    prompt,
    interact,
    use,
    alt,
    action(a, actor, b) {
      if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('pipes.')) return false;
      const pose = actor === 'guest' ? ctx.other : ctx.physics;
      const r = pipeAction(st, ctx.world, a, b, pose);
      if (r.ok) { if (r.text) ctx.emit?.({ kind: r.kind ?? 'notice', text: r.text }, actor); }
      else if (r.text) ctx.emit?.({ kind: r.reason === 'full' ? 'full' : 'notice', text: r.text }, actor);
      return true;
    },
    decorModel(type) { return T && type === 'watertank' ? createWaterTank(T) : null; },
    debug: {
      state: () => JSON.parse(JSON.stringify(st)),
      nets: () => nets().nets.map(n => ({ tanks: [...n.tanks], nodes: [...n.nodes].sort(), sources: [...n.sources], sinks: [...n.sinks] })),
      target: aim => target(aim),
      prompt: aim => prompt(aim ?? ctx.aim?.() ?? null),
      layout: () => pipeLayout(st, decor(), nets()),
      /** Host QA: put a water tank (or a barrel / palm / sprinkler) on a free raft tile. */
      place(type, x, z) {
        const w = ctx.world;
        if (ctx.role === 'guest' || !['watertank', 'rainbarrel', 'palm', 'sprinkler', 'purifier'].includes(type) || !isInt(x) || !isInt(z) || !w) return false;
        if (!hasDeck(x, z) || decor().some(d => d.x === x && d.z === z)) return false;
        w.decor.push({ type, x, z }); ctx.rebuildRaft?.(); return true;
      },
      /** Host QA: lay a pipe without spending one. */
      lay(x, z) {
        if (ctx.role === 'guest' || !isInt(x) || !isInt(z) || !hasDeck(x, z) || st.p[tileKey(x, z)] === 1 || Object.keys(st.p).length >= MAX_PIPES) return false;
        st.p[tileKey(x, z)] = 1; st.g++; st.r++; return true;
      },
      /** Host QA: set a tank's cups. */
      fill(key, w) {
        if (ctx.role === 'guest' || !decorAt(ctx.world, key, 'watertank')) return false;
        addCup(st, key, clampInt(w, 0, TANK_CAP) - tankW(st, key)); st.r++; return true;
      },
      /** Host QA: run the flow for `sec` seconds (in MAX_TICK chunks). */
      fastForward(sec = 10) {
        if (ctx.role === 'guest' || !ctx.world) return false;
        let left = Math.max(0, Math.floor(sec));
        while (left > 0) { const n = Math.min(MAX_TICK, left); tickPipes(st, ctx.world, n, nc); left -= n; }
        return true;
      },
    },
    dispose() {
      meshes?.dispose(); ghost?.userData.dispose(); meshes = null; ghost = null; meshScene = null; tanks.length = 0;
    },
  };
}
