// Raft animals v1 (the Puffhen): pure logic, see docs/specs/raft-animals.md.
// No DOM, no THREE, no imports. Randomness only through rnd(seed, n) or an rng passed in.
// Coordinates are raft-local tiles (x, z); a tile centre is (TILE*x, TILE*z) metres.

export const MAX_ANIMALS = 4, BEAT = 7, HOME_EVERY = 8, RANGE = 3, HOP_T = 1.8, HOP_START = .4, JITTER = .5, TILE = 2;
export const EGG_BASE = 240, EGG_CONTENT = 80, HEART_CUT = .03, MAX_HEARTS = 10, EGG_CAP = 3, FEATHER_CAP = 3, FEATHER_CHANCE = .35;
export const CONTENT_ADD = 180, CONTENT_MAX = 360, FULL_AT = 300, BOND_CD = 60, PET_FEATHER_CD = 120, PET_FEATHER_HEARTS = 5;
export const LURE_MIN = 20, LURE_MAX = 40, LURE_COST = [['seed', 1], ['leaf', 3]], NAME_MAX = 14, REACH = 3.2;
export const NAMES = Object.freeze(['Biscuit', 'Dumpling', 'Pip', 'Marlo', 'Sprout', 'Tuffet', 'Nib', 'Clover', 'Bun', 'Pebble', 'Waffle', 'Moppet']);
export const FOODS = Object.freeze(['seed', 'leaf']);
// Bramblegoat (docs/specs/goats.md): a second species sharing the graph, clock and save slice.
export const MAX_SLOTS = 6; // all species; sizes the module's preallocated arrays (MAX_ANIMALS stays the Puffhen cap)
export const MILK_BASE = 300, MILK_CONTENT = 120, MILK_CAP = 1, GOAT_BEAT = 9, GOAT_HOP_T = 2.4, ARRIVE_GOAT_T = 4;
export const GOAT_NAMES = Object.freeze(['Bramble', 'Nutmeg', 'Tansy', 'Barley', 'Hazel', 'Mallow', 'Thistle', 'Pudding', 'Juniper', 'Oats', 'Fennel', 'Clove']);
const deepFreeze = o => { for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); return Object.freeze(o); };
export const SPECIES = deepFreeze({
  puffhen: { prefix: 'p', home: 'nestbox', code: 1, cap: 4, label: 'Puffhen', plural: 'Puffhens', names: NAMES, foods: ['seed', 'leaf'], lure: [['seed', 1], ['leaf', 3]], lureMin: 20, lureMax: 40, beat: BEAT, hopT: HOP_T },
  goat: { prefix: 'g', home: 'goatpen', code: 2, cap: 2, label: 'Bramblegoat', plural: 'Bramblegoats', names: GOAT_NAMES, foods: ['leaf', 'seaweed'], lure: [['seaweed', 3], ['leaf', 4]], lureMin: 30, lureMax: 50, beat: GOAT_BEAT, hopT: GOAT_HOP_T },
});
export const HOME_CODE = Object.freeze({ nestbox: 1, goatpen: 2 });
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const speciesOf = k => (own(SPECIES, k) ? SPECIES[k] : null);
const ID_RE = { puffhen: /^p\d{1,6}$/, goat: /^g\d{1,6}$/ };
const TAU = Math.PI * 2;
const T_MAX = 1e9, FAR_PAST = -1e9;

// ------------------------------------------------------------------ random (copied from wildlife.js)

function mb(a) { // mulberry32 step, stateless: output for state a
  a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const rnd = (seed, n) => mb((seed + Math.imul(n, 0x6D2B79F5)) | 0); // nth output of mulberry32(seed)
export function mulberry32(a) { let s = a | 0; return () => { const r = mb(s); s = (s + 0x6D2B79F5) | 0; return r; }; }
const smooth = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

// ------------------------------------------------------------------ validation

const fin = v => typeof v === 'number' && Number.isFinite(v);
const isInt = Number.isInteger;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, lo, hi, dflt) => (fin(v) ? clamp(v, lo, hi) : dflt);
const int = (v, lo, hi, dflt) => (fin(v) ? clamp(Math.floor(v), lo, hi) : dflt);
const keyOf = (x, z) => x + ',' + z;
const cleanHome = h => (Array.isArray(h) && h.length === 2 && isInt(h[0]) && isInt(h[1]) && Math.abs(h[0]) <= 25 && Math.abs(h[1]) <= 25 ? [h[0], h[1]] : null);
const idSeed = id => { let h = 0x811c9dc5; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193); return h >>> 0; };

/** A player-given name: NFC, no control/format chars, single spaces, at most NAME_MAX code points. '' = invalid. */
export function cleanName(v) {
  if (typeof v !== 'string') return '';
  let s = v.normalize('NFC').replace(/\s/gu, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/ +/g, ' ').trim();
  s = Array.from(s).slice(0, NAME_MAX).join('').trim();
  return s;
}

export const emptyState = () => ({ v: 1, r: 0, t: 0, next: 1, list: [], lures: [] });

/** Turn a world.ext.animals slice (maybe undefined/garbage) into clean state. decor: world.decor, or null to skip home pruning. */
export function cleanAnimals(v, decor) {
  const st = emptyState();
  if (!v || typeof v !== 'object' || Array.isArray(v)) return st;
  st.r = isInt(v.r) && v.r >= 0 && v.r < Number.MAX_SAFE_INTEGER ? v.r : 0;
  st.t = num(v.t, 0, T_MAX, 0);
  const t = st.t;
  let boxes = null; // "x,z" -> home decor type
  if (Array.isArray(decor)) { boxes = new Map(); for (const d of decor) if (d && own(HOME_CODE, d.type) && isInt(d.x) && isInt(d.z)) boxes.set(keyOf(d.x, d.z), d.type); }
  const ids = new Set(), homes = new Set(), per = { puffhen: 0, goat: 0 };
  let maxId = 0;
  if (Array.isArray(v.list)) for (const e of v.list) {
    if (!e || typeof e !== 'object') continue;
    const S = speciesOf(e.kind);
    if (!S || per[e.kind] >= S.cap || typeof e.id !== 'string' || !ID_RE[e.kind].test(e.id)) continue;
    const home = cleanHome(e.home); if (!home) continue;
    const hk = keyOf(home[0], home[1]);
    if (ids.has(e.id) || homes.has(hk) || (boxes && boxes.get(hk) !== S.home)) continue;
    const seed = isInt(e.seed) && e.seed >= 0 && e.seed <= 0xffffffff ? e.seed : idSeed(e.id);
    const name = cleanName(e.name) || S.names[seed % S.names.length];
    ids.add(e.id); homes.add(hk); per[e.kind]++; maxId = Math.max(maxId, +e.id.slice(1));
    if (e.kind === 'goat') {
      st.list.push({
        id: e.id, kind: 'goat', name, seed, home, born: num(e.born, 0, t, t),
        hearts: int(e.hearts, 0, MAX_HEARTS, 0), content: num(e.content, 0, CONTENT_MAX, 0), prod: num(e.prod, 0, MILK_BASE, 0),
        milk: int(e.milk, 0, MILK_CAP, 0), bondAt: num(e.bondAt, FAR_PAST, t, FAR_PAST),
      });
      continue;
    }
    st.list.push({
      id: e.id, kind: 'puffhen', name, seed, home, born: num(e.born, 0, t, t),
      hearts: int(e.hearts, 0, MAX_HEARTS, 0), content: num(e.content, 0, CONTENT_MAX, 0), prod: num(e.prod, 0, EGG_BASE, 0),
      eggs: int(e.eggs, 0, EGG_CAP, 0), feather: int(e.feather, 0, FEATHER_CAP, 0),
      bondAt: num(e.bondAt, FAR_PAST, t, FAR_PAST), featherAt: num(e.featherAt, FAR_PAST, t, FAR_PAST),
    });
  }
  if (Array.isArray(v.lures)) for (const l of v.lures) {
    if (!l || typeof l !== 'object') continue;
    const kind = l.kind === undefined ? 'puffhen' : l.kind, S = speciesOf(kind);
    if (!S || per[kind] >= S.cap) continue;
    const home = cleanHome(l.home); if (!home) continue;
    const hk = keyOf(home[0], home[1]);
    if (homes.has(hk) || (boxes && boxes.get(hk) !== S.home)) continue;
    homes.add(hk); per[kind]++;
    const lu = { home, at: num(l.at, t, t + S.lureMax, t + S.lureMin) };
    if (kind === 'goat') lu.kind = 'goat';
    st.lures.push(lu);
  }
  st.next = Math.max(isInt(v.next) && v.next > 0 && v.next < 1e7 ? v.next : 1, maxId + 1);
  return st;
}

// ------------------------------------------------------------------ walk graph

const WALLS = new Set(['wall', 'halfwall', 'window']);
// Neighbour order: +x, -x, +z, -z. Edge (i,j,r:0) lies between (i,j) and (i,j-1); r:1 between (i,j) and (i-1,j).
const DX = [1, -1, 0, 0], DZ = [0, 0, 1, -1];
const edgeOf = (x, z, d) => (d === 0 ? (x + 1) + ',' + z + ',1' : d === 1 ? x + ',' + z + ',1' : d === 2 ? x + ',' + (z + 1) + ',0' : x + ',' + z + ',0');

/** Walkable deck cells: tiles with no decor (or a home: nest box box=1, hay corner box=2), minus grill and level-0 stairs cells. */
export function buildGraph(tiles, decor, pieces, hasGrill) {
  const held = new Map();
  if (Array.isArray(decor)) for (const d of decor) if (d && isInt(d.x) && isInt(d.z)) held.set(keyOf(d.x, d.z), d.type);
  const stairs = new Set(), walls = new Set();
  if (Array.isArray(pieces)) for (const p of pieces) {
    if (!p || p.l !== 0 || !isInt(p.i) || !isInt(p.j)) continue;
    if (p.t === 'stairs') stairs.add(keyOf(p.i, p.j));
    else if (WALLS.has(p.t)) walls.add(p.i + ',' + p.j + ',' + (p.r & 1));
  }
  const cells = [], seen = new Set();
  if (Array.isArray(tiles)) for (const tl of tiles) {
    if (!Array.isArray(tl) || !isInt(tl[0]) || !isInt(tl[1])) continue;
    const x = tl[0], z = tl[1], k = keyOf(x, z);
    if (seen.has(k)) continue; seen.add(k);
    const type = held.get(k);
    if (type !== undefined && !own(HOME_CODE, type)) continue;
    if (stairs.has(k) || (hasGrill && hasGrill(x, z))) continue;
    cells.push([x, z, type === undefined ? 0 : HOME_CODE[type]]);
  }
  cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = cells.length;
  const g = { n, x: new Int16Array(n), z: new Int16Array(n), box: new Uint8Array(n), nb: new Int16Array(n * 4).fill(-1), index: new Map() };
  cells.forEach((c, i) => { g.x[i] = c[0]; g.z[i] = c[1]; g.box[i] = c[2]; g.index.set(keyOf(c[0], c[1]), i); });
  for (let i = 0; i < n; i++) for (let d = 0; d < 4; d++) {
    const j = g.index.get(keyOf(g.x[i] + DX[d], g.z[i] + DZ[d]));
    if (j !== undefined && !walls.has(edgeOf(g.x[i], g.z[i], d))) g.nb[i * 4 + d] = j;
  }
  return g;
}

let queue = new Int16Array(64);
/** BFS from home through free cells only, up to RANGE steps. out[i] = steps, -1 = unreachable or too far. */
export function homeDist(graph, homeIdx, out) {
  const n = graph ? graph.n : 0;
  if (!out || out.length !== n) out = new Int8Array(n);
  out.fill(-1);
  if (!(homeIdx >= 0 && homeIdx < n)) return out;
  if (queue.length < n) queue = new Int16Array(n * 2);
  let head = 0, tail = 0;
  out[homeIdx] = 0; queue[tail++] = homeIdx;
  while (head < tail) {
    const c = queue[head++], d = out[c];
    if (d >= RANGE) continue;
    for (let k = 0; k < 4; k++) {
      const j = graph.nb[c * 4 + k];
      if (j < 0 || graph.box[j] || out[j] !== -1) continue;
      out[j] = d + 1; queue[tail++] = j;
    }
  }
  return out;
}

// ------------------------------------------------------------------ wander plan

export const newPlan = () => ({ kind: 'idle', idle: 0, n: 0, cells: new Int16Array(4), yaw0: 0, beat: -1, sx: 0, sz: 0, sh: 0 });

function pointX(graph, seed, k, h, c) { return graph.box[c] ? TILE * graph.x[c] : TILE * graph.x[c] + (rnd(seed, k * 8 + 4 + h) - .5) * 2 * JITTER; }
function pointZ(graph, seed, k, h, c) { return graph.box[c] ? TILE * graph.z[c] : TILE * graph.z[c] + (rnd(seed ^ 0x5bd1e995, k * 8 + 4 + h) - .5) * 2 * JITTER; }

function beatOnce(seed, k, c, graph, dist, out) { // fills out for beat k starting in cell c; returns the end cell
  const cells = out.cells, nb = graph.nb;
  cells[0] = c; out.n = 0; out.idle = 0;
  out.yaw0 = rnd(seed, k * 8 + 7) * TAU;
  if (k % HOME_EVERY === HOME_EVERY - 1) {
    out.kind = 'home';
    let cur = c;
    while (out.n < 3 && dist[cur] > 0) {
      let next = -1;
      for (let d = 0; d < 4; d++) { const j = nb[cur * 4 + d]; if (j >= 0 && dist[j] === dist[cur] - 1) { next = j; break; } }
      if (next < 0) break;
      cells[++out.n] = cur = next;
    }
    if (!out.n) { out.kind = 'idle'; out.idle = Math.floor(rnd(seed, k * 8 + 1) * 3); }
    return cur;
  }
  if (rnd(seed, k * 8) < .35) { out.kind = 'idle'; out.idle = Math.floor(rnd(seed, k * 8 + 1) * 3); return c; }
  out.kind = 'hop';
  const hops = 1 + Math.floor(rnd(seed, k * 8 + 2) * 3);
  let cur = c;
  for (let h = 0; h < hops; h++) {
    const base = Math.floor(rnd(seed, k * 8 + 3 + h) * 4) % 4;
    let next = -1;
    for (let t = 0; t < 4; t++) {
      const j = nb[cur * 4 + (base + t) % 4];
      if (j >= 0 && !graph.box[j] && dist[j] !== -1) { next = j; break; }
    }
    if (next < 0) break;
    cells[++out.n] = cur = next;
  }
  if (!out.n) { out.kind = 'idle'; out.idle = Math.floor(rnd(seed, k * 8 + 1) * 3); }
  return cur;
}

/**
 * The plan for beat `beat`: replays from the last home beat boundary (b - b%8, which starts at home).
 * out gets {kind:'idle'|'hop'|'home', idle, n, cells, yaw0, beat, sx, sz} (sx/sz: start point, raft metres).
 * No allocations.
 */
export function plan(seed, beat, graph, dist, homeIdx, out) {
  const b = beat > 0 ? Math.floor(beat) : 0;
  out.beat = b;
  if (!graph || !(homeIdx >= 0 && homeIdx < graph.n)) { out.kind = 'idle'; out.idle = 0; out.n = 0; out.cells[0] = -1; out.yaw0 = rnd(seed, b * 8 + 7) * TAU; return out; }
  let c = homeIdx, px = TILE * graph.x[c], pz = TILE * graph.z[c];
  for (let k = b - b % HOME_EVERY; k < b; k++) {
    c = beatOnce(seed, k, c, graph, dist, out);
    if (out.n) { px = pointX(graph, seed, k, out.n - 1, c); pz = pointZ(graph, seed, k, out.n - 1, c); }
  }
  beatOnce(seed, b, c, graph, dist, out);
  out.beat = b; out.sx = px; out.sz = pz;
  return out;
}

/** Pose u seconds into the planned beat: p.{x,z,yaw,hop,moving,f,lift} in raft-local metres. lift 1 = on the home tile. ht: seconds per step. */
export function pose(out, graph, seed, beat, u, p, ht = HOP_T) {
  const k = out.beat >= 0 ? out.beat : beat;
  if (!graph || out.cells[0] < 0) { p.x = out.sx; p.z = out.sz; p.yaw = out.yaw0; p.hop = 0; p.moving = false; p.f = 0; p.lift = 1; return p; }
  const cells = out.cells;
  if (!out.n) { p.x = out.sx; p.z = out.sz; p.yaw = out.yaw0; p.hop = 0; p.moving = false; p.f = 0; p.lift = graph.box[cells[0]] ? 1 : 0; return p; }
  let h = Math.floor((u - HOP_START) / ht);
  if (h < 0) h = 0;
  let f = (u - HOP_START - h * ht) / ht;
  if (h >= out.n) { h = out.n - 1; f = 1; }
  if (f < 0) f = 0;
  const a = cells[h], b = cells[h + 1];
  const ax = h === 0 ? out.sx : pointX(graph, seed, k, h - 1, a), az = h === 0 ? out.sz : pointZ(graph, seed, k, h - 1, a);
  const bx = pointX(graph, seed, k, h, b), bz = pointZ(graph, seed, k, h, b);
  const s = smooth(f);
  p.x = ax + (bx - ax) * s; p.z = az + (bz - az) * s;
  p.moving = f > 0 && f < 1;
  p.hop = p.moving ? Math.abs(Math.sin(Math.PI * 3 * f)) : 0;
  p.f = f;
  const la = graph.box[a] ? 1 : 0, lb = graph.box[b] ? 1 : 0;
  p.lift = la + (lb - la) * s;
  const dx = bx - ax, dz = bz - az;
  p.yaw = dx * dx + dz * dz > 1e-8 ? Math.atan2(dx, dz) : out.yaw0;
  return p;
}

/** First off-raft cell from home along +x,-x,+z,-z (fewest steps, first in order on ties): where a goat wades in. */
export function edgeStart(tileKeys, hx, hz) {
  let best = null, bestN = Infinity;
  for (let d = 0; d < 4; d++) {
    for (let n = 1; n <= 25 && n < bestN; n++) {
      const x = hx + DX[d] * n, z = hz + DZ[d] * n;
      if (!tileKeys || !tileKeys.has(keyOf(x, z))) { best = [x, z]; bestN = n; break; }
    }
  }
  return best || [hx + 1, hz];
}

// ------------------------------------------------------------------ production

export const eggPeriod = a => (a.content > 0 ? EGG_CONTENT : EGG_BASE) * (1 - HEART_CUT * a.hearts);
export const milkPeriod = a => (a.content > 0 ? MILK_CONTENT : MILK_BASE) * (1 - HEART_CUT * a.hearts);
export const gone = id => `That ${typeof id === 'string' && id[0] === 'g' ? 'Bramblegoat' : 'Puffhen'} wandered off`;
const labelOf = a => (a && a.kind === 'goat' ? SPECIES.goat.label : SPECIES.puffhen.label);
const kindCount = (st, kind, lures) => { let n = 0; for (const a of st.list) if (a.kind === kind) n++; if (lures) for (const l of st.lures) if ((l.kind || 'puffhen') === kind) n++; return n; };
const homeKey = h => h[0] + ',' + h[1];
const findId = (st, id) => { for (const a of st.list) if (a.id === id) return a; return null; };
const findHome = (st, x, z) => { for (const a of st.list) if (a.home[0] === x && a.home[1] === z) return a; return null; };
const lureAt = (st, x, z) => { for (const l of st.lures) if (l.home[0] === x && l.home[1] === z) return l; return null; };

const RES = { laid: [], arrived: [], ready: [] };
/** Host tick: content wears off, eggs are laid, milk gets ready, lures arrive. Returns a reused {laid, arrived, ready} (ids). */
export function tick(state, dt, rng) {
  RES.laid.length = 0; RES.arrived.length = 0; RES.ready.length = 0;
  const d = fin(dt) ? clamp(dt, 0, 60) : 0;
  for (const a of state.list) {
    a.content = Math.max(0, a.content - d);
    if (a.kind === 'goat') {
      const period = milkPeriod(a);
      if (a.milk < MILK_CAP) { a.prod += d; if (a.prod >= period) { a.milk = MILK_CAP; a.prod = 0; RES.ready.push(a.id); } }
      else a.prod = period;
      continue;
    }
    const period = eggPeriod(a);
    if (a.eggs < EGG_CAP) {
      a.prod += d;
      if (a.prod >= period) {
        a.eggs++; a.prod = 0;
        if (rng() < FEATHER_CHANCE) a.feather = Math.min(FEATHER_CAP, a.feather + 1);
        RES.laid.push(a.id);
      }
    } else a.prod = period;
  }
  for (let i = 0; i < state.lures.length; i++) {
    const l = state.lures[i];
    if (state.t < l.at) continue;
    state.lures.splice(i--, 1);
    const kind = l.kind === 'goat' ? 'goat' : 'puffhen', S = SPECIES[kind];
    if (kindCount(state, kind, false) >= S.cap || findHome(state, l.home[0], l.home[1])) continue;
    const name = S.names[Math.floor(rng() * S.names.length) % S.names.length];
    const seed = Math.floor(rng() * 2 ** 32) >>> 0;
    const a = kind === 'goat'
      ? { id: 'g' + state.next++, kind: 'goat', name, seed, home: [l.home[0], l.home[1]], born: state.t, hearts: 0, content: 0, prod: 0, milk: 0, bondAt: FAR_PAST }
      : { id: 'p' + state.next++, kind: 'puffhen', name, seed, home: [l.home[0], l.home[1]], born: state.t, hearts: 0, content: 0, prod: 0, eggs: 0, feather: 0, bondAt: FAR_PAST, featherAt: FAR_PAST };
    state.list.push(a);
    RES.arrived.push(a.id);
  }
  return RES;
}

// ------------------------------------------------------------------ actions (host). A failure changes nothing.

const no = (reason, text) => ({ ok: false, reason, text });
const commit = (bag, scratch) => { for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i]; };
const count = (bag, k) => (bag && typeof bag.count === 'function' ? bag.count(k) : 0);

export function lure(state, x, z, bag, t, rng, kind = 'puffhen') {
  const S = speciesOf(kind); if (!S) return no('bad', 'Nothing wants to live here');
  const goat = kind === 'goat';
  if (findHome(state, x, z) || lureAt(state, x, z)) return no('busy', goat ? 'This hay corner already has a guest' : 'This nest box already has a guest');
  if (kindCount(state, kind, true) >= S.cap) return no('cap', `The raft has ${S.cap} ${S.plural}`);
  let food = null;
  for (const [k, n] of S.lure) if (count(bag, k) >= n) { food = [k, n]; break; }
  if (!food || !bag.remove(food[0], food[1])) return no('nofood', goat ? 'Needs 3 Seaweed or 4 Leaves' : 'Needs 1 Palm Seed or 3 Leaves');
  const lu = { home: [x, z], at: t + S.lureMin + rng() * (S.lureMax - S.lureMin) };
  if (goat) lu.kind = 'goat';
  state.lures.push(lu);
  return { ok: true, kind: 'build', food: food[0], text: goat ? 'You set out some greens… listen for a bleat' : 'You scatter seeds… listen for a chirp' };
}

export function feed(state, id, food, bag, t) {
  const a = findId(state, id); if (!a) return no('notarget', gone(id));
  const goat = a.kind === 'goat', S = SPECIES[a.kind];
  if (!S.foods.includes(food)) return no('bad', `That is not ${S.label} food`);
  const needs = goat ? 'You need Seaweed or a Leaf' : 'You need a Palm Seed or a Leaf';
  if (count(bag, food) < 1) return no('nofood', needs);
  if (a.content >= FULL_AT) return no('full', `${a.name} is full and happy`);
  if (!bag.remove(food, 1)) return no('nofood', needs);
  a.content = Math.min(CONTENT_MAX, a.content + CONTENT_ADD);
  let heart = false;
  if (t - a.bondAt >= BOND_CD) { a.hearts = Math.min(MAX_HEARTS, a.hearts + 1); a.bondAt = t; heart = true; }
  return { ok: true, kind: 'loot', heart, text: goat ? `${a.name} munches happily · content` : `${a.name} gobbles it up · content` };
}

export function pet(state, id, t) {
  const a = findId(state, id); if (!a) return no('notarget', gone(id));
  if (t - a.bondAt < BOND_CD) return { ok: true, kind: 'notice', heart: false, text: '' };
  a.hearts = Math.min(MAX_HEARTS, a.hearts + 1); a.bondAt = t;
  let text = `${a.name} ♥ ${a.hearts}`, feather = false;
  if (a.kind === 'goat') return { ok: true, kind: 'notice', heart: true, feather, text };
  if (a.hearts >= PET_FEATHER_HEARTS && t - a.featherAt >= PET_FEATHER_CD && a.feather < FEATHER_CAP) {
    a.feather = Math.min(FEATHER_CAP, a.feather + 1); a.featherAt = t; feather = true;
    text += ' · a feather drifts into the nest';
  }
  return { ok: true, kind: 'notice', heart: true, feather, text };
}

export function collect(state, x, z, bag) {
  const a = findHome(state, x, z); if (!a) return no('notarget', 'This nest box is empty');
  if (!a.eggs && !a.feather) return no('empty', 'Nothing in the nest yet');
  const scratch = new bag.constructor(bag.snapshot());
  const eggs = a.eggs - scratch.add('puffegg', a.eggs);
  const feathers = a.feather - scratch.add('feather', a.feather);
  if (!eggs && !feathers) return no('full', 'Your bag is full');
  commit(bag, scratch);
  a.eggs -= eggs; a.feather -= feathers;
  const parts = [];
  if (eggs) parts.push(`+${eggs} Puff Egg`);
  if (feathers) parts.push(`+${feathers} Puff Feather`);
  return { ok: true, kind: 'loot', eggs, feathers, text: parts.join(', ') };
}

export function rename(state, id, name) {
  const n = cleanName(name); if (!n) return no('badname', 'Try another name');
  const a = findId(state, id); if (!a) return no('notarget', gone(id));
  a.name = n;
  return { ok: true, kind: 'notice', text: `Renamed to ${n}` };
}

/** Host: swap one held Wooden Pail for a Pail of Milk from a ready goat. A failure changes nothing. */
export function milk(state, id, bag) {
  const a = findId(state, id); if (!a) return no('notarget', gone(id));
  if (a.kind !== 'goat') return no('bad', 'Only goats give milk');
  if (!(a.milk >= 1)) return no('notyet', `${a.name} has no milk yet · soon`);
  if (count(bag, 'bucket') < 1) return no('nopail', 'Hold a Wooden Pail to milk');
  const sel = bag.slots[bag.selectedIndex];
  if (sel && sel.kind === 'bucket' && sel.count === 1) bag.slots[bag.selectedIndex] = { kind: 'milk', count: 1 };
  else {
    const scratch = new bag.constructor(bag.snapshot());
    if (!scratch.remove('bucket', 1) || scratch.add('milk', 1) !== 0) return no('full', 'Your bag is full');
    commit(bag, scratch);
  }
  a.milk = 0; a.prod = 0;
  return { ok: true, kind: 'loot', text: `+1 Pail of Milk · thank you, ${a.name}` };
}

export { homeKey, findId, findHome, lureAt, labelOf };
