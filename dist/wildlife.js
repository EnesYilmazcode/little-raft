// Wildlife: gulls that circle and perch on the raft, fish schools under the surface, and now and then a
// friendly dolphin or sea turtle circling at a distance. Pure scenery, see docs/features/wildlife.md.
// Everything is a closed-form plan of a shared clock t, so host and guest see the same animals.
// Rendering: 4 draw calls (gull bodies, gull wings, fish, the visible circler). No per-frame allocations.
import { gullBodyGeometry, gullWingGeometry, dolphinGeometry, turtleGeometry, fishGeometry, GULL_SHOULDER } from './wildlife-models.js';

export const WILDLIFE_SEED = 0x5eaf00d;
export const GULL_MAX = 6, SCHOOL_MAX = 2, FISH_PER_SCHOOL = 12;
export const GULL_SLOT = 40, CIRCLER_SLOT = 180;
export const GULL_DESCEND = 4, GULL_LEAVE = 4, SCARE_RADIUS = 2.25, CIRCLER_MIN_R = 7;
const ARRIVE = 10, TAU = Math.PI * 2;
export const SLEW_RATE = 0.5, SNAP_GAP = 10; // guest clock: ease at <= 0.5 s/s, hard-snap only past 10 s
const FLOOR_Y = 0.2, DECOR_Y = 0.22;
const PERCH_TOP = { sail: 3.62, crate: 0.85, bench: 0.47 }; // decor that gives a raised perch (local height above its base)
// Keep-out margins past the raft edge (m). On the starter raft these add nothing; bigger rafts push animals out.
export const GULL_MARGIN = 2.5, FISH_MARGIN = 4, CIRCLER_MARGIN = 5;
const GULL_R0 = 5.5, FISH_R0 = 7, CIRCLER_R0 = 9; // smallest base radius of each path
const pushOut = (ext, margin, r0) => (fin(ext) && ext + margin > r0 ? ext + margin - r0 : 0);
const EYE = 1.6; // eye height above the deck, for a friend pose with no y

// ------------------------------------------------------------------ pure plan (no THREE)

function mb(a) { // mulberry32 step, stateless: output for state a
  a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rnd = (s, n) => mb((s + Math.imul(n, 0x6D2B79F5)) | 0); // nth output of mulberry32(s)
export function mulberry32(a) { let s = a | 0; return () => { const r = mb(s); s = (s + 0x6D2B79F5) | 0; return r; }; }
const smooth = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const gullKey = (seed, i) => (seed ^ Math.imul(i + 1, 0x9e37)) | 0;
const slotKey = (s, slot, k) => (s ^ Math.imul(slot + 1, k)) | 0;
const fin = v => typeof v === 'number' && Number.isFinite(v);

// Raft half-size in metres from the shared tile list: max |tile coord| * 2 + 1 (tiles are 2 m). 0 with no tiles.
export function raftExtent(tiles) {
  if (!Array.isArray(tiles)) return 0;
  let m = -1;
  for (let k = 0; k < tiles.length; k++) {
    const t = tiles[k]; if (!Array.isArray(t) || !fin(t[0]) || !fin(t[1])) continue;
    const a = Math.max(Math.abs(t[0]), Math.abs(t[1])); if (a > m) m = a;
  }
  return m < 0 ? 0 : m * 2 + 1;
}

// Allocation-free hash of the tile and decor layout (type, x, z), so the guest can skip rebuilding perches
// when a state message brings new arrays with the same content.
const hnum = (h, v) => Math.imul(h ^ (Math.round(v * 16) | 0), 0x01000193);
export function layoutHash(tiles, decor) {
  let h = 0x811c9dc5 | 0;
  if (Array.isArray(tiles)) for (let k = 0; k < tiles.length; k++) {
    const t = tiles[k]; if (!Array.isArray(t) || !fin(t[0]) || !fin(t[1])) { h = hnum(h, -9999); continue; }
    h = hnum(hnum(h, t[0]), t[1]);
  }
  h = hnum(h, 77777);
  if (Array.isArray(decor)) for (let k = 0; k < decor.length; k++) {
    const d = decor[k]; if (!d || typeof d !== 'object') { h = hnum(h, -9999); continue; }
    const ty = typeof d.type === 'string' ? d.type : '';
    for (let c = 0; c < ty.length; c++) h = Math.imul(h ^ ty.charCodeAt(c), 0x01000193);
    h = hnum(hnum(hnum(h, ty.length), fin(d.x) ? d.x : -9999), fin(d.z) ? d.z : -9999);
  }
  return h | 0;
}

export function perchesFrom(tiles, decor) {
  const out = [];
  if (!Array.isArray(tiles)) return out;
  const held = new Map();
  if (Array.isArray(decor)) for (const d of decor) if (d && fin(d.x) && fin(d.z)) held.set(d.x + ',' + d.z, d.type);
  const seen = new Set();
  for (const t of tiles) {
    if (!Array.isArray(t) || !fin(t[0]) || !fin(t[1])) continue;
    const key = t[0] + ',' + t[1];
    if (seen.has(key)) continue; seen.add(key);
    const type = held.get(key);
    if (type === undefined) out.push({ x: t[0] * 2, y: FLOOR_Y, z: t[1] * 2, key, tx: t[0], tz: t[1] });
    else if (PERCH_TOP[type] !== undefined) out.push({ x: t[0] * 2, y: DECOR_Y + PERCH_TOP[type], z: t[1] * 2, key, tx: t[0], tz: t[1] });
  }
  out.sort((a, b) => a.tx - b.tx || a.tz - b.tz);
  for (const p of out) { delete p.tx; delete p.tz; }
  return out;
}

function gullSky(seed, i, t, o, ext) { // continuous circling path, raft frame
  const s = gullKey(seed, i);
  const r = 7 + 5 * rnd(s, 0) + pushOut(ext, GULL_MARGIN, GULL_R0), h = 6.5 + 4 * rnd(s, 1), dir = rnd(s, 3) < 0.5 ? -1 : 1;
  const w = (0.17 + 0.1 * rnd(s, 2)) * dir, ph = TAU * rnd(s, 4);
  const a = ph + w * t, rr = r + 1.5 * Math.sin(t * 0.07 + ph);
  o.sx = Math.cos(a) * rr; o.sz = Math.sin(a) * rr; o.sy = h + 0.8 * Math.sin(t * 0.23 + ph * 2);
  o.bank = -dir * 0.32; o.ph = ph;
}

// Fills v with gull i's perch visit for its slot: {on, start, stay, perch, yaw}. Two gulls never share
// a perch in one slot: they take consecutive entries from one slot-wide base index.
export function gullVisit(seed, i, slot, n, v) {
  const s = slotKey(gullKey(seed, i), slot, 0x85ebca6b), c = slotKey(seed, slot, 0x27d4eb2d);
  v.on = n > i && rnd(s, 0) < 0.72;
  v.start = slot * GULL_SLOT + 4 + 10 * rnd(s, 1);
  v.stay = 6 + 9 * rnd(s, 2);
  v.perch = n > 0 ? (Math.floor(rnd(c, 0) * n) + i) % n : -1;
  v.yaw = TAU * rnd(s, 3);
  return v;
}

const _sky = { sx: 0, sy: 0, sz: 0, bank: 0, ph: 0 }, _sky2 = { sx: 0, sy: 0, sz: 0, bank: 0, ph: 0 };
const _visit = { on: false, start: 0, stay: 0, perch: -1, yaw: 0 };

function baseBlend(v, t, leaveAt) {
  if (t < v.start + GULL_DESCEND) return smooth((t - v.start) / GULL_DESCEND);
  if (t < leaveAt) return 1;
  return 1 - smooth((t - leaveAt) / GULL_LEAVE);
}
// A scare during the visit (descending or perched) turns the gull back up from wherever it is then.
const scareValid = (v, scareAt) => scareAt >= v.start && scareAt < v.start + GULL_DESCEND + v.stay;
function gullBlend(v, t, scareAt) { // 0 = in the sky, 1 = on the perch
  if (!v || !v.on || t < v.start) return 0;
  const leaveAt = v.start + GULL_DESCEND + v.stay;
  if (scareValid(v, scareAt) && t >= scareAt) return baseBlend(v, scareAt, leaveAt) * (1 - smooth((t - scareAt) / GULL_LEAVE));
  return baseBlend(v, t, leaveAt);
}

// out: {state, x,y,z (raft frame), yaw, pitch, roll, flap, fold, blend, sx,sy,sz, px,py,pz, perch}
// scareAt: clock time a player spooked this gull (or -1). visit: a visit to use instead of the schedule, or null.
// perch: omitted = perches[visit.perch]; an {x,y,z} = that perch (the module latches one per visit); null = none.
// ext: raft half-size (raftExtent), pushes the sky circle out on big rafts.
export function gullPlan(seed, i, t, perches, out, scareAt = -1, visit = null, perch = undefined, ext = 0) {
  const n = Array.isArray(perches) ? perches.length : 0;
  const v = visit && visit.on ? visit : gullVisit(seed, i, Math.floor(t / GULL_SLOT), n, _visit);
  gullSky(seed, i, t, _sky, ext);
  const p = perch !== undefined ? (v.on && perch ? perch : null) : v.on && v.perch >= 0 && v.perch < n ? perches[v.perch] : null;
  const b = p ? gullBlend(v, t, scareAt) : 0;
  out.sx = _sky.sx; out.sy = _sky.sy; out.sz = _sky.sz; out.blend = b; out.perch = p ? v.perch : -1;
  out.px = p ? p.x : 0; out.py = p ? p.y : 0; out.pz = p ? p.z : 0;
  if (b === 1) { out.x = out.px; out.y = out.py; out.z = out.pz; }
  else { out.x = _sky.sx + (out.px - _sky.sx) * b; out.y = _sky.sy + (out.py - _sky.sy) * b; out.z = _sky.sz + (out.pz - _sky.sz) * b; }
  let leaveAt = p ? v.start + GULL_DESCEND + v.stay : 0;
  if (p && scareValid(v, scareAt)) leaveAt = scareAt;
  const state = !p || t < v.start || t >= leaveAt + GULL_LEAVE ? 'circle' : t >= leaveAt ? 'leave' : t < v.start + GULL_DESCEND ? 'descend' : 'perched';
  out.state = state;
  // heading from the path a moment ahead
  gullSky(seed, i, t + 0.15, _sky2, ext);
  const b2 = p ? gullBlend(v, t + 0.15, scareAt) : 0;
  const dx = _sky2.sx + (out.px - _sky2.sx) * b2 - out.x, dz = _sky2.sz + (out.pz - _sky2.sz) * b2 - out.z;
  const dy = _sky2.sy + (out.py - _sky2.sy) * b2 - out.y;
  const flyYaw = Math.atan2(dx, dz), hz = Math.hypot(dx, dz);
  if (state === 'perched') {
    const k = (t - v.start - GULL_DESCEND) / 2.3, f = k - Math.floor(k);
    out.yaw = v.yaw + Math.floor(k + 0.2) * 0.9; // a little turn with every hop
    const hop = f > 0.7 && f < 0.92 ? Math.sin(Math.PI * (f - 0.7) / 0.22) : 0; // stand still first, then a little hop
    out.y = out.py + 0.09 * hop;
    out.pitch = 0; out.roll = 0; out.fold = 1 - 0.3 * hop;
    out.flap = -0.1 + 0.35 * hop;
  } else {
    const landing = state === 'descend' ? smooth(((t - v.start) / GULL_DESCEND - 0.7) / 0.3) : 0;
    let dyaw = v.yaw - flyYaw; dyaw -= TAU * Math.round(dyaw / TAU);
    out.yaw = flyYaw + dyaw * landing;
    out.pitch = hz > 1e-4 ? Math.max(-0.5, Math.min(0.5, -Math.atan2(dy, hz))) * (1 - landing) : 0;
    out.roll = state === 'circle' ? _sky.bank : _sky.bank * (1 - b);
    const burst = Math.max(0, Math.sin(t * 0.45 + _sky.ph * 3)); // glide most of the time, flap in bursts
    const amp = state === 'circle' ? 0.12 + 0.55 * burst : 0.75;
    out.flap = 0.08 + amp * Math.sin(t * (state === 'circle' ? 8 : 11) + i * 1.7);
    out.fold = landing;
  }
  return out;
}

export function schoolCenter(seed, i, t, out, ext = 0) {
  const s = (seed ^ Math.imul(i + 7, 0x51ed27)) | 0;
  const ph1 = TAU * rnd(s, 0), ph2 = TAU * rnd(s, 1), ph3 = TAU * rnd(s, 2), dir = rnd(s, 3) < 0.5 ? -1 : 1;
  const w = 0.045 * dir, R = 12 + 5 * Math.sin(t * 0.031 + ph1) + pushOut(ext, FISH_MARGIN, FISH_R0), dR = 5 * 0.031 * Math.cos(t * 0.031 + ph1);
  const a = ph2 + w * t, ca = Math.cos(a), sa = Math.sin(a);
  out.x = ca * R; out.z = sa * R;
  out.y = -0.8 + 0.25 * Math.sin(t * 0.11 + ph3);
  out.heading = Math.atan2(-sa * R * w + ca * dR, ca * R * w + sa * dR);
  return out;
}

// Per-fish layout inside a school (seeded, fixed): offset across/along the heading and a phase.
export function fishOffset(seed, i, j, out) {
  const s = (seed ^ Math.imul(i + 3, 0x2c1b3c6d) ^ Math.imul(j + 1, 0x297a2d39)) | 0;
  const a = TAU * rnd(s, 0), r = Math.sqrt(rnd(s, 1));
  out.side = Math.cos(a) * r * 1.2; out.along = Math.sin(a) * r * 2.0; out.ph = TAU * rnd(s, 2); out.size = 1.1 + 0.5 * rnd(s, 3);
  out.depth = 0.2 * (rnd(s, 4) - 0.5);
  return out;
}

const _cv = { kind: null, start: 0, a0: 0, r: 0, speed: 0, dir: 1, laps: 1, dur: 0, arrive: true };
function circlerVisit(seed, slot, v) {
  const s = slotKey(seed, slot, 0x165667b1);
  v.kind = rnd(s, 0) < 0.7 ? 'dolphin' : 'turtle';
  const dolphin = v.kind === 'dolphin';
  v.r = dolphin ? 10 + 4 * rnd(s, 1) : 9 + 3 * rnd(s, 1);
  v.speed = dolphin ? 2.6 : 0.9;
  v.laps = dolphin && rnd(s, 2) < 0.5 ? 2 : 1;
  v.dir = rnd(s, 4) < 0.5 ? -1 : 1;
  v.a0 = TAU * rnd(s, 5);
  v.arrive = true;
  v.dur = v.laps * TAU * v.r / v.speed + 2 * ARRIVE;
  v.start = slot * CIRCLER_SLOT + (CIRCLER_SLOT - v.dur - 2) * rnd(s, 3);
  return v;
}
function circlerPos(v, u, o, push) {
  const lap = v.dur - 2 * ARRIVE;
  const out = v.arrive ? 25 * (1 - smooth(u / ARRIVE)) : 0, back = 25 * smooth((u - ARRIVE - lap) / ARRIVE);
  const rad = v.r + push + out + back, a = v.a0 + v.dir * v.speed * (u - ARRIVE) / v.r;
  o.x = Math.cos(a) * rad; o.z = Math.sin(a) * rad;
}
const _cp = { x: 0, z: 0 }, _cp2 = { x: 0, z: 0 };

// out: {kind:null|'dolphin'|'turtle', x, y (relative to the water surface), z, heading, pitch, roll}
// force: a visit object (debug summon) that replaces the schedule while it lasts. ext: raft half-size.
export function circlerAt(seed, t, out, force = null, ext = 0) {
  let v = force && force.kind && t >= force.start && t < force.start + force.dur ? force : null;
  if (!v) { v = circlerVisit(seed, Math.floor(t / CIRCLER_SLOT), _cv); if (t < v.start || t >= v.start + v.dur) { out.kind = null; return out; } }
  const u = t - v.start;
  const push = pushOut(ext, CIRCLER_MARGIN, CIRCLER_R0);
  circlerPos(v, u, _cp, push); circlerPos(v, u + 0.2, _cp2, push);
  out.kind = v.kind; out.x = _cp.x; out.z = _cp.z;
  out.heading = Math.atan2(_cp2.x - _cp.x, _cp2.z - _cp.z);
  if (v.kind === 'dolphin') { // cruise with the fin showing, then a happy arc out of the water every ~5 s
    const k = u / 5.2, f = k - Math.floor(k), J = 0.32;
    if (f < J) { const q = f / J; out.y = -0.16 + 1.0 * Math.sin(Math.PI * q); out.pitch = -0.9 * Math.cos(Math.PI * q); }
    else { out.y = -0.16 + 0.04 * Math.sin(u * 2); out.pitch = 0; } // back and fin show
    out.roll = 0;
  } else {
    out.y = 0.08 + 0.03 * Math.sin(u * 1.3); out.pitch = 0.04 * Math.sin(u * 0.9); out.roll = 0.06 * Math.sin(u * 0.7);
  }
  return out;
}

// ------------------------------------------------------------------ module

export function createWildlife(ctx) {
  const seed = WILDLIFE_SEED;
  let offset = 0, target = 0, synced = false, clock = 0;
  const net = { t: 0 };
  let perches = [], perchMap = new Map(), ext = 0, tilesRef = null, decorRef = null, tilesLen = -1, decorLen = -1, hash = 0, rebuilds = 0, changed = false;
  const scareAt = new Float64Array(GULL_MAX).fill(-1), scareSlot = new Int32Array(GULL_MAX).fill(-1);
  // Per gull: the scheduled visit of the current slot and the perch latched when it began (kept for the visit).
  const vis = [], lat = [];
  for (let i = 0; i < GULL_MAX; i++) { vis.push({ on: false, start: 0, stay: 0, perch: -1, yaw: 0 }); lat.push({ slot: -1, done: false, on: false, key: '', x: 0, y: 0, z: 0 }); }
  const forced = []; for (let i = 0; i < GULL_MAX; i++) forced.push({ on: false, start: 0, stay: 0, perch: -1, yaw: 0, scare: false, key: '', x: 0, y: 0, z: 0 });
  const forceC = { kind: null, start: 0, a0: 0, r: 10, speed: 2.6, dir: 1, laps: 1, dur: 0, arrive: false };
  const pinned = []; for (let i = 0; i < SCHOOL_MAX; i++) pinned.push({ on: false, x: 0, z: 0, heading: 0 });
  const plan = { state: 'circle', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, flap: 0, fold: 0, blend: 0, sx: 0, sy: 0, sz: 0, px: 0, py: 0, pz: 0, perch: -1 };
  const sc = { x: 0, y: 0, z: 0, heading: 0 }, fo = { side: 0, along: 0, ph: 0, size: 1, depth: 0 };
  const cir = { kind: null, x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 };
  const last = { gx: new Float32Array(GULL_MAX * 3), gs: new Array(GULL_MAX).fill('hidden'), sx: new Float32Array(SCHOOL_MAX * 2), nG: 0, nS: 0 };

  let built = false, disposed = false, group = null, gullBody = null, gullWing = null, fish = null, dolphin = null, turtle = null, material = null, fishMat = null;
  let m4, mA, mB, mC, mD, v3, v3b, sc3, q4, qR, eul, col, zero, UP, fishDark, fishWater;

  function build() {
    const T = ctx.T;
    m4 = new T.Matrix4(); mA = new T.Matrix4(); mB = new T.Matrix4(); mC = new T.Matrix4(); mD = new T.Matrix4();
    v3 = new T.Vector3(); v3b = new T.Vector3(); sc3 = new T.Vector3(1, 1, 1); q4 = new T.Quaternion(); qR = new T.Quaternion();
    eul = new T.Euler(0, 0, 0, 'YXZ'); col = new T.Color(); zero = new T.Matrix4().makeScale(0, 0, 0); UP = new T.Vector3(0, 1, 0);
    fishDark = new T.Color('#0b2f36'); fishWater = new T.Color('#3f8c88');
    material = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: T.DoubleSide });
    fishMat = new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false, side: T.DoubleSide, forceSinglePass: true }); // one pass: transparent DoubleSide would draw twice
    group = new T.Group(); group.name = 'wildlife';
    const inst = (geo, mat, n, name) => {
      const m = new T.InstancedMesh(geo, mat, n); m.name = name; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
      m.instanceMatrix.setUsage(T.DynamicDrawUsage); for (let i = 0; i < n; i++) m.setMatrixAt(i, zero); group.add(m); return m;
    };
    gullBody = inst(gullBodyGeometry(T), material, GULL_MAX, 'gullBody');
    gullWing = inst(gullWingGeometry(T), material, GULL_MAX * 2, 'gullWing');
    fish = inst(fishGeometry(T), fishMat, SCHOOL_MAX * FISH_PER_SCHOOL, 'fish');
    for (let i = 0; i < SCHOOL_MAX * FISH_PER_SCHOOL; i++) fish.setColorAt(i, fishDark);
    fish.instanceColor.setUsage(T.DynamicDrawUsage);
    fish.renderOrder = 1; // after the opaque ocean
    dolphin = new T.Mesh(dolphinGeometry(T), material); dolphin.name = 'dolphin';
    turtle = new T.Mesh(turtleGeometry(T), material); turtle.name = 'turtle';
    dolphin.visible = turtle.visible = false; dolphin.castShadow = turtle.castShadow = false;
    dolphin.matrixAutoUpdate = turtle.matrixAutoUpdate = false;
    group.add(dolphin, turtle);
    ctx.scene.add(group);
    built = true;
  }

  // Rebuilds perches only when the layout really changed. The guest gets fresh tiles/decor arrays with every
  // state message (~8 Hz), so a reference change is checked against an allocation-free content hash first.
  function refreshPerches() {
    const w = ctx.world; if (!w) return;
    const tl = Array.isArray(w.tiles) ? w.tiles.length : 0, dl = Array.isArray(w.decor) ? w.decor.length : 0;
    if (w.tiles === tilesRef && w.decor === decorRef && tl === tilesLen && dl === decorLen) return;
    tilesRef = w.tiles; decorRef = w.decor; tilesLen = tl; decorLen = dl;
    const h = layoutHash(w.tiles, w.decor);
    if (rebuilds > 0 && h === hash) return;
    hash = h; rebuilds++; changed = true;
    perches = perchesFrom(w.tiles, w.decor);
    perchMap = new Map(); for (const p of perches) perchMap.set(p.key, p);
    ext = raftExtent(w.tiles);
  }

  const now = () => (fin(ctx.elapsed) ? ctx.elapsed : 0) + offset;
  const deckEye = () => (typeof ctx.deckY === 'function' && fin(ctx.deckY()) ? ctx.deckY() : FLOOR_Y) + EYE;
  // Is a player pose ({x,y,z}, y may be null for the friend) close enough to v3 to spook a gull?
  function spooks(p) {
    if (!p || !fin(p.x) || !fin(p.z)) return false;
    const y = fin(p.y) ? p.y : deckEye();
    return Math.hypot(p.x - v3.x, p.z - v3.z) < SCARE_RADIUS && Math.abs(y - v3.y) < 3;
  }

  function setWing(index, side, flap, fold) {
    mA.makeTranslation(side * GULL_SHOULDER[0], GULL_SHOULDER[1], GULL_SHOULDER[2]);
    mB.makeScale(side, 1, 1);
    mC.makeRotationY(fold * 1.42);
    mD.makeRotationZ(flap - fold * 0.25);
    mA.multiply(mB).multiply(mC).multiply(mD);
    mB.multiplyMatrices(m4, mA);
    gullWing.setMatrixAt(index, mB);
  }

  // The visit and latched perch gull i uses at t. Returns the perch ({key,x,y,z}) or null; fills vis[i].
  function gullPerch(i, t, slot) {
    const f = forced[i];
    if (f.on) return f;
    const L = lat[i], V = vis[i], n = perches.length;
    if (L.slot !== slot) { L.slot = slot; L.done = false; L.on = false; }
    if (!L.done) {
      gullVisit(seed, i, slot, n, V);
      if (t >= V.start) { // the visit begins: latch its perch and keep it to the end
        L.done = true;
        if (V.on && V.perch >= 0 && V.perch < n) { const p = perches[V.perch]; L.on = true; L.key = p.key; L.x = p.x; L.y = p.y; L.z = p.z; }
      }
    }
    if (L.done && !L.on) V.on = false;
    return L.on ? L : null;
  }

  function updateGulls(t, nG, raft) {
    const slot = Math.floor(t / GULL_SLOT);
    gullBody.count = nG; gullWing.count = nG * 2;
    for (let i = 0; i < GULL_MAX; i++) {
      if (i >= nG) { last.gs[i] = 'hidden'; continue; }
      const f = forced[i];
      if (f.on && t >= f.start + GULL_DESCEND + f.stay + GULL_LEAVE + 1) f.on = false;
      const P = gullPerch(i, t, slot);
      if (changed && P) { // the layout changed: a gull whose perch went away (or moved) takes off
        const q = perchMap.get(P.key);
        if (!q || q.y !== P.y) { scareAt[i] = t; scareSlot[i] = slot; if (f.on) f.scare = true; }
      }
      const sAt = f.on ? (f.scare ? scareAt[i] : -1) : scareSlot[i] === slot ? scareAt[i] : -1;
      gullPlan(seed, i, t, perches, plan, sAt, f.on ? f : vis[i], P, ext);
      // where the perch is in the world (raft bob and tilt)
      v3.set(plan.px, plan.state === 'perched' ? plan.y : plan.py, plan.pz); if (raft) v3.applyMatrix4(raft.matrixWorld);
      // either player walking up spooks it; both clients see both poses, so they agree
      if (plan.state === 'perched' && (!f.on || f.scare) && (spooks(ctx.physics) || spooks(ctx.other))) {
        scareAt[i] = t; scareSlot[i] = slot;
        gullPlan(seed, i, t, perches, plan, t, f.on ? f : vis[i], P, ext);
      }
      const b = plan.blend;
      v3b.set(plan.sx + (v3.x - plan.sx) * b, plan.sy + (v3.y - plan.sy) * b, plan.sz + (v3.z - plan.sz) * b);
      eul.set(plan.pitch, plan.yaw, plan.roll, 'YXZ'); q4.setFromEuler(eul);
      if (raft && b > 0) { qR.identity().slerp(raft.quaternion, b); q4.premultiply(qR); }
      sc3.set(1, 1, 1);
      m4.compose(v3b, q4, sc3);
      gullBody.setMatrixAt(i, m4);
      setWing(i * 2, 1, plan.flap, plan.fold);
      setWing(i * 2 + 1, -1, plan.flap, plan.fold);
      last.gx[i * 3] = v3b.x; last.gx[i * 3 + 1] = v3b.y; last.gx[i * 3 + 2] = v3b.z; last.gs[i] = plan.state;
    }
    changed = false;
    gullBody.instanceMatrix.needsUpdate = true; gullWing.instanceMatrix.needsUpdate = true;
  }

  function updateFish(t, nS, wiggle, ocean) {
    fish.count = nS * FISH_PER_SCHOOL;
    for (let i = 0; i < nS; i++) {
      const p = pinned[i];
      if (p.on) { sc.x = p.x; sc.z = p.z; sc.heading = p.heading; sc.y = -0.7 + 0.2 * Math.sin(t * 0.3); }
      else schoolCenter(seed, i, t, sc, ext);
      // a pinned school holds its place and heading; each fish still drifts around its slot below
      const ch = Math.cos(sc.heading), sh = Math.sin(sc.heading);
      last.sx[i * 2] = sc.x; last.sx[i * 2 + 1] = sc.z;
      for (let j = 0; j < FISH_PER_SCHOOL; j++) {
        const k = i * FISH_PER_SCHOOL + j;
        fishOffset(seed, i, j, fo);
        const along = fo.along + 0.35 * Math.sin(t * 0.5 + fo.ph), side = fo.side + 0.25 * Math.sin(t * 0.37 + fo.ph * 2);
        const x = sc.x + sh * along + ch * side, z = sc.z + ch * along - sh * side;
        const yaw = sc.heading + 0.18 * Math.sin(t * 0.6 + fo.ph) + (wiggle ? 0.22 * Math.sin(t * 7 + fo.ph * 3) : 0);
        const depth = sc.y + fo.depth; // plan depth, about -1.15 .. -0.45 m. Drawn on the surface; it only sets the tint
        const h = ocean ? ocean.getHeight(x, z) : -0.24;
        v3.set(x, h + 0.035, z); q4.setFromAxisAngle(UP, yaw); sc3.set(fo.size, 1, fo.size);
        m4.compose(v3, q4, sc3); fish.setMatrixAt(k, m4);
        col.copy(fishDark).lerp(fishWater, Math.min(0.85, Math.max(0, (-depth - 0.4) / 0.8 * 0.7)));
        fish.setColorAt(k, col);
      }
    }
    fish.instanceMatrix.needsUpdate = true; fish.instanceColor.needsUpdate = true;
  }

  function updateCircler(t, ocean) {
    circlerAt(seed, t, cir, forceC.kind ? forceC : null, ext);
    if (forceC.kind && t >= forceC.start + forceC.dur) forceC.kind = null;
    dolphin.visible = cir.kind === 'dolphin'; turtle.visible = cir.kind === 'turtle';
    if (!cir.kind) return;
    const m = cir.kind === 'dolphin' ? dolphin : turtle;
    const h = ocean ? ocean.getHeight(cir.x, cir.z) : -0.24;
    v3.set(cir.x, h + cir.y, cir.z); eul.set(cir.pitch, cir.heading, cir.roll, 'YXZ'); q4.setFromEuler(eul); sc3.set(1, 1, 1);
    m.matrix.compose(v3, q4, sc3); m.matrixWorldNeedsUpdate = true;
  }

  // Guest clock: ease the offset toward the host's at <= 0.5 s per second, so normal drift never pops.
  function slew(dt) {
    if (!synced || offset === target) return;
    const step = SLEW_RATE * (fin(dt) && dt > 0 ? Math.min(dt, 0.1) : 0), d = target - offset;
    offset = Math.abs(d) <= step ? target : offset + (d > 0 ? step : -step);
  }

  const mod = {
    name: 'wildlife',
    update(dt) {
      if (disposed) return;
      slew(dt);
      refreshPerches();
      if (!built) { if (!ctx.scene || !ctx.ocean || !ctx.T) return; build(); }
      const t = now(); clock = t;
      const g = ctx.options ? ctx.options.graphics : 'medium';
      const nG = g === 'low' ? 3 : g === 'high' ? 6 : 5, nS = g === 'low' ? 1 : 2;
      last.nG = nG; last.nS = nS;
      const raft = ctx.raft, ocean = ctx.ocean;
      if (raft) raft.updateWorldMatrix(true, false); // fresh bob and tilt for perched gulls (raft and parents only, not the deck children)
      updateGulls(t, nG, raft);
      updateFish(t, nS, g !== 'low', ocean);
      updateCircler(t, ocean);
    },
    serialize() {
      if (ctx.role !== 'host') return undefined;
      net.t = Math.round(now() * 10) / 10;
      return net;
    },
    load(data, from) {
      if (from === 'net') {
        if (!data || typeof data !== 'object' || !fin(data.t) || Math.abs(data.t) > 1e9) return;
        const off = data.t - (fin(ctx.elapsed) ? ctx.elapsed : 0);
        target = off;
        if (!synced || Math.abs(off - offset) > SNAP_GAP) { offset = off; synced = true; } // first sync or a host reload
        return;
      }
      offset = target = 0; synced = false; // 'save' and 'restore': our own clock again
    },
    dispose() {
      disposed = true;
      if (!built) return;
      group.removeFromParent();
      for (const m of [gullBody, gullWing, fish, dolphin, turtle]) { m.geometry.dispose(); if (m.dispose) m.dispose(); }
      material.dispose(); fishMat.dispose();
      built = false; group = null;
    },
    get clock() { return now(); },
    get offset() { return offset; },
  };

  // ------------------------------------------------------------------ QA helpers (local only, never serialized)
  function lookPoint(dist) {
    const cam = ctx.camera, T = ctx.T; if (!cam || !T) return null;
    const d = new T.Vector3(); cam.getWorldDirection(d);
    const p = cam.position.clone();
    if (dist === undefined) { // where the view meets the deck plane, else 4 m ahead
      const k = d.y < -0.05 ? (p.y - FLOOR_Y) / -d.y : 4; return p.addScaledVector(d, Math.min(k, 12));
    }
    d.y = 0; if (d.lengthSq() < 1e-6) d.set(0, 0, -1); d.normalize();
    return { p: p.addScaledVector(d, dist), d };
  }
  mod.debug = {
    snapshot() {
      const gulls = [];
      for (let i = 0; i < GULL_MAX; i++) if (last.gs[i] !== 'hidden') gulls.push({ x: last.gx[i * 3], y: last.gx[i * 3 + 1], z: last.gx[i * 3 + 2], state: last.gs[i] });
      const schools = []; for (let i = 0; i < last.nS; i++) schools.push({ x: last.sx[i * 2], z: last.sx[i * 2 + 1] });
      return { t: clock, offset, perches: perches.length, gulls, schools, circler: cir.kind ? { kind: cir.kind, x: cir.x, z: cir.z } : null, built, ext, rebuilds };
    },
    summonCircler(kind = 'dolphin') {
      const k = kind === 'turtle' ? 'turtle' : 'dolphin', L = lookPoint(12), t = now();
      let x = 0, z = -10; if (L) { x = L.p.x; z = L.p.z; }
      const r = Math.max(9, Math.min(14, Math.hypot(x, z)));
      Object.assign(forceC, { kind: k, r, speed: k === 'dolphin' ? 2.6 : 0.9, dir: 1, laps: 1, a0: Math.atan2(z, x), arrive: false });
      forceC.dur = TAU * r / forceC.speed + 2 * ARRIVE; forceC.start = t - ARRIVE;
      const rr = r + pushOut(ext, CIRCLER_MARGIN, CIRCLER_R0); // circlerAt pushes it past a big raft too
      return { kind: k, x: Math.cos(forceC.a0) * rr, z: Math.sin(forceC.a0) * rr };
    },
    landGull(i = 0, opts = {}) {
      i = Math.max(0, Math.min(GULL_MAX - 1, i | 0)); refreshPerches();
      if (!perches.length) return null;
      const L = lookPoint(); let best = 0, bd = Infinity;
      if (L) { if (ctx.raft) ctx.raft.worldToLocal(L); for (let k = 0; k < perches.length; k++) { const d = Math.hypot(perches[k].x - L.x, perches[k].z - L.z); if (d < bd) { bd = d; best = k; } } }
      if (Number.isInteger(opts.perch) && opts.perch >= 0 && opts.perch < perches.length) best = opts.perch;
      const p = perches[best];
      Object.assign(forced[i], { key: p.key, x: p.x, y: p.y, z: p.z, on: true, start: now() - (opts.instant ? GULL_DESCEND : 0), stay: fin(opts.stay) ? opts.stay : 15, perch: best, yaw: fin(opts.yaw) ? opts.yaw : TAU * Math.random(), scare: !!opts.scare });
      scareAt[i] = -1;
      return { ...perches[best] };
    },
    schoolHere(i = 0, dist = 5) {
      i = Math.max(0, Math.min(SCHOOL_MAX - 1, i | 0)); refreshPerches();
      let L = lookPoint(dist); if (!L) return null;
      const onRaft = (x, z) => perches.some(p => Math.abs(p.x - x) < 2.6 && Math.abs(p.z - z) < 2.6); // keep clear of the deck
      for (let k = 0; k < 40 && onRaft(L.p.x, L.p.z); k++) L.p.addScaledVector(L.d, 0.5);
      Object.assign(pinned[i], { on: true, x: L.p.x, z: L.p.z, heading: Math.atan2(L.d.z, -L.d.x) }); // broadside to the view
      return { x: L.p.x, z: L.p.z };
    },
    release() { for (const f of forced) f.on = false; for (const p of pinned) p.on = false; forceC.kind = null; },
    setTime(t) { if (fin(t)) offset = target = t - (fin(ctx.elapsed) ? ctx.elapsed : 0); return now(); },
    get perches() { return perches.map(p => ({ ...p })); },
    setVisible(on) { if (group) group.visible = !!on; return !!group; }, // for draw-call measurements
    renderCalls() { const r = ctx.renderer; return r && r.info ? r.info.render.calls : null; },
  };
  return mod;
}
