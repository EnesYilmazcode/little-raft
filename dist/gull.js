// Companion Gull and Gull Perch (see docs/specs/companion-gull.md). Place a perch, offer grilled fish to the gull
// that visits it, and after a few treats it moves in: it rests, flies short loops, sometimes follows a player,
// brings small finds to the woven tray and can be named and petted. Never bites, never leaves, never needs feeding.
// Slice: world.ext.gull, host-authoritative, actions 'gull.*'. Only the clock t is synced; every pose is a
// closed-form function of (state, t). The top half of this file is pure (no DOM, no THREE, no Date, no Math.random).
import { cleanName, rnd } from './animals-core.js?build=v3-survival-ae77fa84ac2b';
import { heartGeometry } from './animals-models.js?build=v3-survival-ae77fa84ac2b';
import { createPerch, paintPerch, PERCH_Y, companionBodyGeometry, companionWingGeometry, COMPANION_SHOULDER as GULL_SHOULDER, COMPANION_HIP as GULL_HIP } from './gull-models.js?build=v3-survival-ae77fa84ac2b';

export const VISIT = 90, ARRIVE = 20, DESCEND = 4, STAY = 42, LEAVE = 4, TREAT_CD = 15, BOND_CD = 60, MOVE_IN = 3, MAX_HEARTS = 10;
export const FIND_BASE = 240, FIND_CUT = .04, TRAY_MAX = 3, MAX_TICK = 60, BEAT = 10, BLEND = 1.5, REACH = 3.2, HOST_SLACK = 2;
export const TREATS = Object.freeze({ cookedfish: 1, honeyfish: 2 }); // honeyfish is the favourite: counts double
export const LOOT = Object.freeze([['wood', 45], ['plastic', 30], ['rope', 15], ['seed', 10]]);
export const OLD_HOST = 'Your friend’s raft doesn’t have a gull perch yet';
export const GULL_NAMES = Object.freeze(['Skipper', 'Gully', 'Squall', 'Salty', 'Wren', 'Captain', 'Puffin', 'Breeze']);
export const FIND_TEXT = Object.freeze({ wood: 'some driftwood', plastic: 'a scrap of plastic', rope: 'a bit of rope', seed: 'a seed' });
export const TEXT = Object.freeze({ full: 'Your bag is full', empty: 'The tray is empty', other: 'Perch · the gull lives on another perch',
  wait: 'Perch · wait for a gull to visit', munch: 'The gull is still munching', hopeful: 'A visiting gull eyes you hopefully · bring grilled fish' });
export { PERCH_Y };

const TAU = Math.PI * 2, FAR = -1e9, T_MAX = 1e9;
const isInt = Number.isInteger;
const fin = v => typeof v === 'number' && Number.isFinite(v);
const clampInt = (v, lo, hi, d = lo) => (fin(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : d);
const r1 = v => Math.round(v * 10) / 10;
const clampT = (v, lo, d) => (fin(v) ? r1(Math.min(T_MAX, Math.max(lo, v))) : d);
const smooth = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const LOOT_KINDS = new Set(LOOT.map(l => l[0]));
const treatPts = k => (typeof k === 'string' && Object.hasOwn(TREATS, k) ? TREATS[k] : 0); // never 'constructor'/'toString' from the prototype
const LOOT_SUM = LOOT.reduce((s, l) => s + l[1], 0);

export const defaults = () => ({ v: 1, r: 0, t: 0, seed: 0, pts: 0, treatAt: FAR, moved: false, home: null, name: '',
  hearts: 0, bondAt: FAR, finds: [], fw: 0, n: 0, pops: 0 });

const hasPerch = (decor, x, z) => { if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'perch' && d.x === x && d.z === z) return true; return false; };

/** The perch with the lowest x, then z, as [x, z], or null. */
export function firstPerch(decor) {
  let best = null;
  if (Array.isArray(decor)) for (const d of decor) {
    if (!d || d.type !== 'perch' || !Number.isFinite(d.x) || !Number.isFinite(d.z)) continue;
    if (!best || d.x < best[0] || (d.x === best[0] && d.z < best[1])) best = [d.x, d.z];
  }
  return best;
}

/** The perch the gull uses: its home once moved in, else the first perch (the visitor's). */
export function target(st, decor) {
  if (st && Array.isArray(st.home)) return st.home;
  return firstPerch(decor);
}

/** Drop a home whose perch is gone; a moved-in gull without a home takes the first perch. True if changed. */
export function rehome(st, decor) {
  let changed = false;
  if (st.home && !hasPerch(decor, st.home[0], st.home[1])) { st.home = null; changed = true; }
  if (!st.moved && st.home) { st.home = null; changed = true; }
  if (st.moved && !st.home) { const p = firstPerch(decor); if (p) { st.home = p; changed = true; } }
  return changed;
}

const defaultName = seed => GULL_NAMES[Math.floor(rnd(seed, 7) * GULL_NAMES.length)];

/** Validated slice. Junk -> defaults; ints clamped, floats to 0.1, finds filtered, home checked against decor. */
export function cleanGull(v, decor) {
  const out = defaults();
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  out.r = clampInt(v.r, 0, T_MAX, 0);
  out.t = clampT(v.t, 0, 0);
  out.seed = isInt(v.seed) && v.seed >= 0 && v.seed <= 0xffffffff ? v.seed : 0;
  out.moved = v.moved === true;
  out.pts = out.moved ? 0 : clampInt(v.pts, 0, MOVE_IN - 1, 0);
  out.treatAt = Math.min(out.t, clampT(v.treatAt, FAR, FAR)); // a future stamp would lock treats out forever
  out.home = Array.isArray(v.home) && v.home.length === 2 && isInt(v.home[0]) && isInt(v.home[1]) && Math.abs(v.home[0]) <= 1000 && Math.abs(v.home[1]) <= 1000 ? [v.home[0], v.home[1]] : null;
  out.name = cleanName(v.name);
  if (out.moved && !out.name) out.name = defaultName(out.seed);
  out.hearts = clampInt(v.hearts, 0, MAX_HEARTS, 0);
  out.bondAt = Math.min(out.t, clampT(v.bondAt, FAR, FAR));
  out.finds = Array.isArray(v.finds) ? v.finds.filter(k => typeof k === 'string' && LOOT_KINDS.has(k)).slice(0, TRAY_MAX) : [];
  out.fw = out.finds.length >= TRAY_MAX ? 0 : clampInt(v.fw, 0, FIND_BASE, 0);
  out.n = clampInt(v.n, 0, T_MAX, 0);
  out.pops = clampInt(v.pops, 0, T_MAX, 0);
  rehome(out, decor);
  return out;
}

/** Visiting schedule before move-in: 'away' | 'descend' | 'perched' | 'leave'. */
export function visitPhase(t) {
  const p = ((t % VISIT) + VISIT) % VISIT;
  if (p < ARRIVE) return 'away';
  if (p < ARRIVE + DESCEND) return 'descend';
  if (p < ARRIVE + DESCEND + STAY) return 'perched';
  if (p < ARRIVE + DESCEND + STAY + LEAVE) return 'leave';
  return 'away';
}

/** Moved-in mode for the beat holding t: 'rest' 60%, 'loop' 30%, 'follow' 10%. Beat 0 always rests. */
export function modeAt(seed, t) {
  const beat = Math.floor(t / BEAT);
  if (beat <= 0) return 'rest';
  const h = rnd(seed, beat);
  return h < .6 ? 'rest' : h < .9 ? 'loop' : 'follow';
}
/** Who a follow beat follows: 'host' or 'guest'. */
export const followWho = (seed, t) => (rnd(seed, Math.floor(t / BEAT) * 3 + 1) < .5 ? 'host' : 'guest');

const perchedNow = st => visitPhase(st.t) === 'perched' || visitPhase(st.t - HOST_SLACK) === 'perched';
const restingNow = st => modeAt(st.seed, st.t) === 'rest' || modeAt(st.seed, st.t - HOST_SLACK) === 'rest';
const gullName = st => st.name || 'The gull';

/** Offer a treat (host). decor is only used to pick the home perch on move-in. Never touches vitals. */
export function treat(st, food, bag, decor) {
  const pts = treatPts(food);
  if (!pts) return { ok: false, reason: 'notreat', text: 'Gulls only want grilled fish' };
  if (!st.moved) {
    if (!perchedNow(st)) return { ok: false, reason: 'away', text: 'Wait for a gull to visit the perch' };
    if (st.t - st.treatAt < TREAT_CD) return { ok: false, reason: 'cooldown', text: TEXT.munch };
    if (!bag || !bag.remove(food, 1)) return { ok: false, reason: 'nofood', text: 'You need a grilled fish' };
    st.treatAt = st.t; st.pts += pts; st.pops++;
    if (st.pts < MOVE_IN) return { ok: true, moved: false, kind: 'notice', text: `The gull gobbles it up (${st.pts}/${MOVE_IN})` };
    st.moved = true; st.pts = 0; st.home = target(st, decor); st.bondAt = st.t;
    if (!st.name) st.name = defaultName(st.seed);
    return { ok: true, moved: true, kind: 'build', text: `${st.name} moved in! Your gull lives on the perch now` };
  }
  if (!restingNow(st)) return { ok: false, reason: 'away', text: `${gullName(st)} is out flying` };
  if (st.t - st.bondAt < BOND_CD) return { ok: false, reason: 'cooldown', text: `${gullName(st)} is full. Try again soon` };
  if (!bag || !bag.remove(food, 1)) return { ok: false, reason: 'nofood', text: 'You need a grilled fish' };
  st.hearts = Math.min(MAX_HEARTS, st.hearts + pts); st.bondAt = st.t; st.pops++;
  return { ok: true, moved: false, kind: 'notice', text: `${gullName(st)} loves it ♥ ${st.hearts}` };
}

/** Pet the resting gull (host). Always a heart burst; a heart is gained at most once per BOND_CD. */
export function pet(st) {
  if (!st.moved) return { ok: false, gained: false, reason: 'away', text: TEXT.hopeful };
  if (!restingNow(st)) return { ok: false, gained: false, reason: 'away', text: `${gullName(st)} is out flying` };
  st.pops++;
  const gained = st.t - st.bondAt >= BOND_CD && st.hearts < MAX_HEARTS;
  if (gained) { st.hearts++; st.bondAt = st.t; }
  return { ok: true, gained, text: `${gullName(st)} ruffles happily ♥ ${st.hearts}` };
}

const pickLoot = h => { let a = h * LOOT_SUM; for (const [k, w] of LOOT) { if (a < w) return k; a -= w; } return LOOT[LOOT.length - 1][0]; };
export const findTime = hearts => Math.round(FIND_BASE * (1 - FIND_CUT * Math.min(MAX_HEARTS, Math.max(0, hearts))));

/** Host tick: dt floored, clamped 0..MAX_TICK, applied 1 s at a time. Bumps st.r on a find. */
export function tickGull(st, decor, dt) {
  const found = [];
  const n = fin(dt) ? Math.min(MAX_TICK, Math.max(0, Math.floor(dt))) : 0;
  for (let i = 0; i < n; i++) {
    if (!st.moved || !st.home || !hasPerch(decor, st.home[0], st.home[1])) break;
    if (st.finds.length >= TRAY_MAX) { st.fw = 0; break; }
    st.fw++;
    if (st.fw >= findTime(st.hearts)) {
      const k = pickLoot(rnd(st.seed, st.n));
      st.finds.push(k); st.n++; st.fw = 0; found.push(k);
    }
  }
  if (found.length) st.r++;
  return { found };
}

/** Atomic: every find fits in the bag, or nothing changes and the tray stays. */
export function collect(st, bag) {
  if (!st.finds.length) return { ok: false, reason: 'empty', text: TEXT.empty };
  if (!bag || typeof bag.snapshot !== 'function') return { ok: false, reason: 'full', text: TEXT.full };
  const s = new bag.constructor(bag.snapshot()), loot = {};
  for (const k of st.finds) { if (s.add(k, 1) !== 0) return { ok: false, reason: 'full', text: TEXT.full }; loot[k] = (loot[k] || 0) + 1; }
  for (let i = 0; i < s.slots.length; i++) bag.slots[i] = s.slots[i];
  if (typeof bag.version === 'number') bag.version++;
  st.finds = [];
  return { ok: true, kind: 'loot', loot, text: '+ ' + Object.keys(loot).map(k => `${loot[k]} ${k}`).join(' · ') };
}

/** Name the gull. '' after cleanName is refused. */
export function rename(st, name) {
  const n = cleanName(name);
  if (!n) return { ok: false, text: 'That name will not fit' };
  st.name = n;
  return { ok: true, text: `Your gull is called ${n}` };
}

// ------------------------------------------------------------------ pose (pure, raft-local metres)

export const newPose = () => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, flap: 0, fold: 1, tuck: 0, vis: false, mode: 'away' });
const lerpAngle = (a, b, s) => { let d = b - a; d -= TAU * Math.round(d / TAU); return a + d * s; };

function restPose(st, perch, t, out) {
  const k = t / 2.3, f = k - Math.floor(k), step = Math.floor(k + .2);
  const hop = f > .7 && f < .92 ? Math.sin(Math.PI * (f - .7) / .22) : 0;
  out.x = perch.x; out.z = perch.z; out.y = perch.y + .09 * hop;
  out.yaw = rnd(st.seed, 99) * TAU + (rnd(st.seed, step + 1000) - .5) * 1.8;
  out.pitch = 0; out.roll = 0; out.fold = 1 - .1 * hop; out.tuck = 0; out.flap = -.1 + .35 * hop;
}

/**
 * Fills out {x,y,z,yaw,pitch,roll,flap,fold,tuck,vis,mode} for clock t. perch: {x,y,z} where the feet go, or null.
 * follow: the followed player's feet in raft-local metres ({x,y,z}) or null (follow beats then loop).
 */
export function gullPose(st, perch, t, follow, out) {
  out.vis = true; out.pitch = 0; out.roll = 0;
  if (!st.moved) {
    if (!perch) { out.vis = false; out.mode = 'away'; return out; }
    const ph = visitPhase(t); out.mode = ph;
    if (ph === 'away') { out.vis = false; return out; }
    if (ph === 'perched') { restPose(st, perch, t, out); return out; }
    const cyc = Math.floor(t / VISIT), p = t - cyc * VISIT, b = rnd(st.seed, cyc) * TAU;
    const sx = perch.x + 10 * Math.sin(b), sy = perch.y + 6, sz = perch.z + 10 * Math.cos(b);
    const desc = ph === 'descend', k = desc ? (p - ARRIVE) / DESCEND : (p - ARRIVE - DESCEND - STAY) / LEAVE;
    const s = smooth(desc ? k : 1 - k); // 0 = sky, 1 = perch
    out.x = sx + (perch.x - sx) * s; out.y = sy + (perch.y - sy) * s; out.z = sz + (perch.z - sz) * s;
    restPose(st, perch, t, _rest);
    const fly = desc ? Math.atan2(perch.x - sx, perch.z - sz) : Math.atan2(sx - perch.x, sz - perch.z);
    const land = desc ? smooth((k - .7) / .3) : 1 - smooth(k / .3); // wings fold close to the perch
    out.yaw = lerpAngle(fly, _rest.yaw, land);
    out.pitch = (desc ? .25 : -.3) * (1 - land);
    out.fold = land; out.tuck = 1 - land;
    out.flap = .08 + .75 * Math.sin(t * 11) * (1 - land);
    return out;
  }
  if (!perch) { // moved in, perch gone: circle the raft until a new perch is placed
    const a = t * .45 + rnd(st.seed, 3) * TAU;
    out.mode = 'loop';
    out.x = 6 * Math.sin(a); out.y = .22 + 5 + .3 * Math.sin(t * .7); out.z = 6 * Math.cos(a);
    out.yaw = a + Math.PI / 2; out.roll = -.3; out.fold = 0; out.tuck = 1;
    out.flap = .08 + (.12 + .5 * Math.max(0, Math.sin(t * .45))) * Math.sin(t * 8);
    return out;
  }
  let mode = modeAt(st.seed, t);
  const beat = Math.floor(t / BEAT), u = t - beat * BEAT;
  if (mode === 'follow' && (!follow || Math.hypot(follow.x - perch.x, follow.z - perch.z) > 12)) mode = 'loop';
  out.mode = mode;
  restPose(st, perch, t, out);
  if (mode === 'rest') return out;
  const s = smooth(Math.min(1, u / BLEND, (BEAT - u) / BLEND));
  let tx, ty, tz, yaw;
  if (mode === 'loop') {
    const a = rnd(st.seed, beat) * TAU + 1.1 * u;
    tx = perch.x + 3.5 * Math.sin(a); ty = perch.y + 2.5; tz = perch.z + 3.5 * Math.cos(a);
    yaw = Math.atan2(Math.cos(a), -Math.sin(a));
    out.roll = -.35 * s;
  } else {
    tx = follow.x + .35; ty = follow.y + 1.9 + .08 * Math.sin(3 * u); tz = follow.z;
    yaw = Math.atan2(tx - perch.x, tz - perch.z);
  }
  out.x += (tx - out.x) * s; out.y += (ty - out.y) * s; out.z += (tz - out.z) * s;
  out.yaw = lerpAngle(out.yaw, yaw, s);
  out.flap = out.flap * (1 - s) + s * Math.sin(14 * u) * (mode === 'loop' ? 1 : .7);
  out.fold = 1 - s; out.tuck = s;
  return out;
}
const _rest = newPose();

// ------------------------------------------------------------------ the content module

const HEART_T = 1.2, CACHE_EVERY = 5, EYE = 1.6, FLOOR_Y = .2, DECOR_Y = .22;
const PERCH_CY = .7, PERCH_R = .45, GULL_R = .3, GULL_CY = .2;
const tileKey = (x, z) => x + ',' + z;

export function createGull(ctx) {
  const T = ctx.T;
  let st = defaults();
  let clock = 0, acc = 0, gotNet = false, netR = -1, hostHasGull = true, seenPops = -1;
  let cache = null, cacheR = -1, cacheAt = -1e9;
  let built = false, group = null, body = null, wings = null, bodyMat = null, wingMat = null, hearts = null, heartMat = null;
  let heartAge = HEART_T, ui = null, uiLoading = null, disposed = false;
  const tuckU = { value: 0 };
  const pose = newPose(), perchPt = { x: 0, y: 0, z: 0 }, followPt = { x: 0, y: 0, z: 0 };
  const last = { x: 0, y: 0, z: 0, vis: false };
  const perches = new Map(); // tileKey -> craft_perch group
  let scanLen = -1, scanFirst = null, scanRaft = null;
  // scratch (preallocated in build)
  let v3 = null, sc = null, q = null, qY = null, qX = null, m4 = null, mA = null, inv = null, eul = null, camR = null, UP = null, RIGHT = null, FWD = null;
  const hit = { type: null, x: 0, z: 0 };
  const ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
  const wp = { x: 0, y: 0, z: 0 };

  const isHost = () => ctx.role !== 'guest';
  const oldHost = () => ctx.role === 'guest' && !hostHasGull;
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);
  const now = () => (isHost() ? st.t : clock);
  const bump = () => { st.r++; };
  const emit = (e, to) => { try { ctx.emit?.(e, to); } catch (err) { console.warn('gull emit failed', err); } };
  const esc = s => (ctx.esc ? ctx.esc(s) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const heldTreat = () => { const k = ctx.localBag?.()?.selected?.kind; return treatPts(k) ? k : null; };
  const drawSeed = () => { if (isHost() && st.seed === 0) { st.seed = (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0; bump(); } };

  // raft-local -> world (plain numbers, works without THREE)
  function toWorld(x, y, z) {
    const e = ctx.raft?.matrixWorld?.elements;
    if (!e) { wp.x = x; wp.y = y; wp.z = z; return wp; }
    wp.x = e[0] * x + e[4] * y + e[8] * z + e[12]; wp.y = e[1] * x + e[5] * y + e[9] * z + e[13]; wp.z = e[2] * x + e[6] * y + e[10] * z + e[14];
    return wp;
  }

  // ------------------------------------------------------------------ rendering

  function build() {
    v3 = new T.Vector3(); sc = new T.Vector3(1, 1, 1); q = new T.Quaternion(); qY = new T.Quaternion(); qX = new T.Quaternion();
    m4 = new T.Matrix4(); mA = new T.Matrix4(); inv = new T.Matrix4(); eul = new T.Euler(0, 0, 0, 'YXZ'); camR = new T.Vector3();
    UP = new T.Vector3(0, 1, 0); RIGHT = new T.Vector3(1, 0, 0); FWD = new T.Vector3(0, 0, 1);
    group = new T.Group(); group.name = 'gull';
    bodyMat = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: T.DoubleSide });
    const hy = GULL_HIP[0].toFixed(3), hz = GULL_HIP[1].toFixed(3);
    bodyMat.onBeforeCompile = sh => { // legs (legW = 1) swing back under the belly by the tuck uniform
      sh.uniforms.tuck = tuckU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float legW;\nuniform float tuck;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  if (legW > 0.5) { float ph = tuck * 1.45, k = 1.0 - 0.6 * tuck, ly = (transformed.y - ${hy}) * k, lz = (transformed.z - ${hz}) * k;
    transformed.y = ${hy} + ly * cos(ph) - lz * sin(ph); transformed.z = ${hz} + ly * sin(ph) + lz * cos(ph); }`);
    };
    bodyMat.customProgramCacheKey = () => 'gull-companion-legs';
    wingMat = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: T.DoubleSide });
    body = new T.Mesh(companionBodyGeometry(T), bodyMat); body.name = 'gullCompanion';
    const wingGeo = companionWingGeometry(T);
    wings = [new T.Mesh(wingGeo, wingMat), new T.Mesh(wingGeo, wingMat)];
    wings[0].name = 'gullWingR'; wings[1].name = 'gullWingL';
    for (const m of [body, ...wings]) { m.matrixAutoUpdate = false; m.castShadow = true; /* frustum-culled: matrixWorld follows .matrix */ m.visible = false; group.add(m); }
    heartMat = new T.MeshBasicMaterial({ color: 0xff7d9c, transparent: true, opacity: 0, depthWrite: false });
    const hg = heartGeometry(T);
    hearts = [0, 1, 2].map(i => { const h = new T.Mesh(hg, heartMat); h.name = 'gullHeart' + i; h.visible = false; h.renderOrder = 3; group.add(h); return h; });
    ctx.scene.add(group);
    built = true;
  }

  function raftQuat(yaw, pitch, roll) {
    if (ctx.raft) q.copy(ctx.raft.quaternion); else q.identity();
    qY.setFromAxisAngle(UP, yaw); q.multiply(qY);
    if (pitch) { qX.setFromAxisAngle(RIGHT, pitch); q.multiply(qX); }
    if (roll) { qX.setFromAxisAngle(FWD, roll); q.multiply(qX); }
    return q;
  }
  // wildlife setWing math, tuned for the companion's slim wing: folded, it sits high on the flank, tilted so the grey
  // top shows from above, and angles in (Ry > pi/2) so the dark tip tapers onto the tail instead of standing off it.
  function setWing(mesh, side, flap, fold) {
    v3.set(side * (GULL_SHOULDER[0] + .02 * fold), GULL_SHOULDER[1] - .03 * fold, GULL_SHOULDER[2]);
    eul.set(fold * 1.25, side * fold * 1.75, side * flap * (1 - .8 * fold), 'YXZ'); qX.setFromEuler(eul);
    sc.set(side * (1 - .3 * fold), 1, 1);
    mA.compose(v3, qX, sc);
    mesh.matrix.multiplyMatrices(m4, mA);
    mesh.matrixWorldNeedsUpdate = true;
  }

  function scanPerches() {
    const raft = ctx.raft; if (!raft) { perches.clear(); return; }
    const kids = raft.children;
    if (raft === scanRaft && kids.length === scanLen && kids[0] === scanFirst) return;
    scanRaft = raft; scanLen = kids.length; scanFirst = kids[0]; scanGen++;
    perches.clear();
    for (let i = 0; i < kids.length; i++) {
      const g = kids[i]; if (g.name !== 'craft_perch') continue;
      perches.set(tileKey(Math.round(g.position.x * 500) / 1000, Math.round(g.position.z * 500) / 1000), g);
    }
  }

  function followTarget() { // the followed player's feet in raft-local coords, or null
    const who = followWho(st.seed, now()), mine = isHost() ? 'host' : 'guest';
    let p = who === mine ? ctx.physics : ctx.other;
    if (!p || !fin(p.x) || !fin(p.z)) p = ctx.physics;
    if (!p || !fin(p.x) || !fin(p.z)) return null;
    const deck = typeof ctx.deckY === 'function' && fin(ctx.deckY()) ? ctx.deckY() : FLOOR_Y;
    v3.set(p.x, fin(p.y) ? p.y - EYE : deck, p.z);
    if (ctx.raft) { inv.copy(ctx.raft.matrixWorld).invert(); v3.applyMatrix4(inv); }
    followPt.x = v3.x; followPt.y = v3.y; followPt.z = v3.z;
    return followPt;
  }

  // Repaint the trays only when something that shows in them changed (no per-frame key strings or joins).
  let paintSt = null, paintR = -1, paintHx = NaN, paintHz = NaN, paintScan = -1, scanGen = 0;
  function paintTrays(tgt) {
    const hx = tgt && st.moved ? tgt[0] : NaN, hz = tgt && st.moved ? tgt[1] : NaN;
    if (paintSt === st && paintR === st.r && Object.is(paintHx, hx) && Object.is(paintHz, hz) && paintScan === scanGen) return;
    paintSt = st; paintR = st.r; paintHx = hx; paintHz = hz; paintScan = scanGen;
    perches.forEach(g => paintPerch(g, Math.round(g.position.x * 500) / 1000 === hx && Math.round(g.position.z * 500) / 1000 === hz ? st.finds : null));
  }
  function render(dt) {
    scanPerches();
    const tgt = oldHost() ? null : target(st, decor());
    paintTrays(tgt);
    const t = now();
    let perch = null;
    if (tgt) { perchPt.x = tgt[0] * 2; perchPt.y = DECOR_Y + PERCH_Y; perchPt.z = tgt[1] * 2; perch = perchPt; }
    const fol = st.moved && perch && modeAt(st.seed, t) === 'follow' ? followTarget() : null;
    if (oldHost()) pose.vis = false; else gullPose(st, perch, t, fol, pose);
    last.vis = pose.vis;
    body.visible = wings[0].visible = wings[1].visible = pose.vis;
    if (pose.vis) {
      const w = toWorld(pose.x, pose.y, pose.z);
      last.x = w.x; last.y = w.y; last.z = w.z;
      v3.set(w.x, w.y, w.z); sc.set(1, 1, 1);
      m4.compose(v3, raftQuat(pose.yaw, pose.pitch, pose.roll), sc);
      body.matrix.copy(m4); body.matrixWorldNeedsUpdate = true;
      tuckU.value = pose.tuck;
      setWing(wings[0], 1, pose.flap, pose.fold);
      setWing(wings[1], -1, pose.flap, pose.fold);
    }
    renderHearts(dt);
  }

  function renderHearts(dt) {
    if (heartAge >= HEART_T || !last.vis) { if (hearts[0].visible) for (const h of hearts) h.visible = false; heartAge = HEART_T; return; }
    heartAge += dt;
    const k = Math.min(1, heartAge / HEART_T), cam = ctx.camera;
    if (cam) camR.set(1, 0, 0).applyQuaternion(cam.quaternion); else camR.set(1, 0, 0);
    heartMat.opacity = k < .7 ? .95 : .95 * Math.max(0, 1 - (k - .7) / .3);
    for (let i = 0; i < 3; i++) {
      const h = hearts[i], x = (i - 1) * .22 * k;
      h.visible = true;
      h.position.set(last.x + camR.x * x, last.y + .4 + .6 * k + (i === 1 ? .06 : 0), last.z + camR.z * x);
      if (cam) h.quaternion.copy(cam.quaternion);
      h.scale.setScalar(.8 + .4 * Math.min(1, k * 4));
    }
  }
  const burst = () => { heartAge = 0; };

  // ------------------------------------------------------------------ host tick

  function hostTick() {
    if (rehome(st, decor())) bump();
    const r = tickGull(st, decor(), 1);
    for (const k of r.found) emit({ kind: 'notice', text: `${gullName(st)} brought you ${FIND_TEXT[k]}` }, 'all');
  }

  function update(dt) {
    const d = fin(dt) && dt > 0 ? Math.min(dt, 1) : 0;
    if (isHost()) {
      drawSeed();
      if (ctx.running) {
        st.t = Math.min(T_MAX, st.t + d);
        acc += d;
        while (acc >= 1) { acc -= 1; hostTick(); }
      }
      clock = st.t;
    } else clock += d;
    if (seenPops >= 0 && st.pops > seenPops) burst();
    seenPops = st.pops;
    if (!built) { if (disposed || !T || !ctx.scene) return; build(); } // never rebuild into the scene after dispose
    render(d);
  }

  // ------------------------------------------------------------------ picking

  function camRay(aim) {
    const cam = ctx.camera; if (!cam) return false;
    if (T && v3 && typeof cam.getWorldPosition === 'function') { cam.getWorldPosition(v3); ray.ox = v3.x; ray.oy = v3.y; ray.oz = v3.z; }
    else if (cam.position) { ray.ox = cam.position.x; ray.oy = cam.position.y; ray.oz = cam.position.z; }
    else return false;
    if (aim && aim.dir && fin(aim.dir.x)) { ray.dx = aim.dir.x; ray.dy = aim.dir.y; ray.dz = aim.dir.z; }
    else if (T && v3 && typeof cam.getWorldDirection === 'function') { cam.getWorldDirection(v3); ray.dx = v3.x; ray.dy = v3.y; ray.dz = v3.z; }
    else return false;
    const l = Math.hypot(ray.dx, ray.dy, ray.dz); if (!(l > 0)) return false;
    ray.dx /= l; ray.dy /= l; ray.dz /= l;
    return true;
  }
  function sphere(cx, cy, cz, r, best) { // ray distance to a sphere, or Infinity
    const ox = ray.ox - cx, oy = ray.oy - cy, oz = ray.oz - cz;
    const b = ox * ray.dx + oy * ray.dy + oz * ray.dz, c = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - c;
    if (disc < 0) return Infinity;
    let t = -b - Math.sqrt(disc);
    if (t < 0) { if (c > 0) return Infinity; t = 0; }
    return t < best ? t : Infinity;
  }
  function pick(aim) {
    hit.type = null;
    if (!camRay(aim)) return null;
    let best = REACH;
    if (built && last.vis) {
      const t = sphere(last.x, last.y + GULL_CY, last.z, GULL_R, best);
      if (t < best) { best = t; hit.type = 'gull'; }
    }
    if (hit.type) return hit; // the gull beats the perch it sits on
    const dec = decor();
    for (let k = 0; k < dec.length; k++) {
      const d = dec[k]; if (!d || d.type !== 'perch') continue;
      const w = toWorld(d.x * 2, PERCH_CY, d.z * 2);
      const t = sphere(w.x, w.y, w.z, PERCH_R, best);
      if (t < best) { best = t; hit.type = 'perch'; hit.x = d.x; hit.z = d.z; }
    }
    return hit.type ? hit : null;
  }

  // ------------------------------------------------------------------ prompt / interact

  // What E does on this hit: {verb:'treat'|'pet'|'collect'|'name'|null, text}
  const plan = { verb: null, html: '', note: '' };
  function planFor(h) {
    plan.verb = null; plan.html = ''; plan.note = '';
    const d = decor(), tgt = target(st, d), t = now(), name = esc(gullName(st));
    if (h.type === 'perch' && (!tgt || tgt[0] !== h.x || tgt[1] !== h.z)) { plan.html = plan.note = TEXT.other; return plan; }
    if (!tgt) return plan;
    const food = heldTreat();
    if (food) {
      if (!st.moved) {
        if (visitPhase(t) !== 'perched') plan.html = plan.note = TEXT.wait;
        else if (t - st.treatAt < TREAT_CD) plan.html = plan.note = TEXT.munch;
        else { plan.verb = 'treat'; plan.html = `<kbd>E</kbd>Offer fish (${st.pts}/${MOVE_IN})`; }
      } else if (modeAt(st.seed, t) === 'rest') { plan.verb = 'treat'; plan.html = `<kbd>E</kbd>Offer fish to ${name}`; }
      else { plan.html = `${name} is out flying`; plan.note = `${gullName(st)} is out flying`; }
      return plan;
    }
    if (h.type === 'gull' && st.moved) {
      if (modeAt(st.seed, t) === 'rest') { plan.verb = 'pet'; plan.html = `<kbd>E</kbd>Pet ${name} ♥ ${st.hearts}`; }
      else { plan.html = `${name} is out flying`; plan.note = `${gullName(st)} is out flying`; }
      return plan;
    }
    if (st.moved) {
      if (st.finds.length) { plan.verb = 'collect'; plan.html = `<kbd>E</kbd>Collect finds (${st.finds.length})`; }
      else { plan.verb = 'name'; plan.html = `<kbd>E</kbd>Name ${name} · finds 0/${TRAY_MAX}`; }
      return plan;
    }
    plan.html = plan.note = visitPhase(t) === 'perched' ? TEXT.hopeful : TEXT.wait;
    return plan;
  }

  function prompt(aim) {
    const h = pick(aim); if (!h) return null;
    if (oldHost()) return OLD_HOST;
    return planFor(h).html || null;
  }

  function interact(aim) {
    const h = pick(aim); if (!h) return false;
    if (oldHost()) { ctx.notice?.(OLD_HOST, 2400); return true; }
    if (ctx.role === 'guest' && !gotNet) { ctx.notice?.('Wait for your raft to connect'); return true; }
    const p = planFor(h), tgt = target(st, decor());
    if (!p.verb) { if (p.note) ctx.notice?.(p.note); return true; }
    if (p.verb === 'treat') { const food = heldTreat(); if (food) ctx.action({ kind: 'gull.treat', x: tgt[0], z: tgt[1], food }); }
    else if (p.verb === 'pet') ctx.action({ kind: 'gull.pet', x: tgt[0], z: tgt[1] });
    else if (p.verb === 'collect') ctx.action({ kind: 'gull.collect', x: tgt[0], z: tgt[1] });
    else openRename();
    return true;
  }

  function loadUI() {
    if (ui || uiLoading || typeof document === 'undefined') return uiLoading;
    uiLoading = import('./animals-ui.js?build=v3-survival-ae77fa84ac2b')
      .then(m => { if (disposed) return null; ui = m.createAnimalsUI(ctx, { title: 'Name your gull', kind: 'gull.name', label: 'Gull name', domId: 'lrGull' }); return ui; })
      .catch(e => { console.error('gull ui failed', e); uiLoading = null; return null; });
    return uiLoading;
  }
  function openRename() {
    if (!st.moved) return false;
    const go = u => u && u.open('gull', st.name);
    if (ui) go(ui); else loadUI()?.then(go);
    return true;
  }

  // ------------------------------------------------------------------ actions (host)

  function near(actor, x, z) {
    const pos = actor === 'guest' ? ctx.other : ctx.physics;
    if (!pos || !fin(pos.x) || !fin(pos.z)) return actor !== 'guest';
    return Math.hypot(pos.x - x, pos.z - z) <= REACH + HOST_SLACK;
  }
  const fail = (actor, text, kind = 'notice') => { if (text) emit({ kind, text }, actor); return true; };

  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || a.kind.slice(0, 5) !== 'gull.') return false;
    if (!isHost()) return true;
    const verb = a.kind.slice(5);
    if (!['treat', 'pet', 'collect', 'name'].includes(verb)) return true;
    const d = decor(), tgt = target(st, d);
    if (verb === 'name') { if (!st.moved || typeof a.name !== 'string' || a.name.length > 64) return true; }
    else if (!Number.isFinite(a.x) || !Number.isFinite(a.z)) return true;
    if (!tgt) return fail(actor, 'There is no gull perch');
    if (verb !== 'name' && (a.x !== tgt[0] || a.z !== tgt[1])) return fail(actor, TEXT.other);
    const w = toWorld(tgt[0] * 2, FLOOR_Y, tgt[1] * 2);
    if (!near(actor, w.x, w.z)) return fail(actor, 'Step a little closer');
    let res;
    if (verb === 'treat') { if (!treatPts(a.food) || !bag) return true; res = treat(st, a.food, bag, d); }
    else if (verb === 'pet') res = pet(st);
    else if (verb === 'collect') { if (!bag) return true; res = collect(st, bag); }
    else res = rename(st, a.name);
    if (res.ok) { bump(); emit(res.loot ? { kind: 'loot', text: res.text, loot: res.loot } : { kind: res.kind ?? 'notice', text: res.text }, actor); }
    else fail(actor, res.text, res.reason === 'full' ? 'full' : 'notice');
    return true;
  }

  // ------------------------------------------------------------------ save / net

  function serialize() {
    if (!isHost()) return undefined;
    if (!cache || cacheR !== st.r || st.t - cacheAt >= CACHE_EVERY || st.t < cacheAt) {
      cache = { v: 1, r: st.r, t: r1(st.t), seed: st.seed, pts: st.pts, treatAt: r1(st.treatAt), moved: st.moved, home: st.home ? [st.home[0], st.home[1]] : null,
        name: st.name, hearts: st.hearts, bondAt: r1(st.bondAt), finds: st.finds.slice(), fw: st.fw, n: st.n, pops: st.pops };
      cacheR = st.r; cacheAt = st.t;
    }
    cache.t = r1(st.t);
    return cache;
  }
  function snap(data, first) { // guest clock follows the host within 2 s
    if (!data || typeof data !== 'object' || !fin(data.t) || Math.abs(data.t) > T_MAX) return;
    if (first || Math.abs(data.t - clock) > 2) clock = data.t;
    else clock += (data.t - clock) * .15;
  }
  function load(data, from) {
    if (from === 'net') {
      const first = !gotNet; gotNet = true;
      hostHasGull = data !== undefined;
      if (data && typeof data === 'object' && data.r === netR && !first) { snap(data); return; }
      st = cleanGull(data, ctx.world?.decor);
      netR = data && typeof data === 'object' ? data.r : -1;
      if (first) seenPops = st.pops; // no burst for the state we joined into
      snap(data, first);
      return;
    }
    st = cleanGull(data, ctx.world?.decor);
    drawSeed();
    clock = st.t; acc = 0; netR = -1; gotNet = false; hostHasGull = true; cache = null; seenPops = st.pops;
  }

  // ------------------------------------------------------------------ QA helpers

  const debug = {
    state: () => JSON.parse(JSON.stringify(st)),
    get clock() { return now(); },
    pose: () => ({ ...pose, world: { ...last } }),
    target: () => target(st, decor()),
    mode: () => (st.moved ? modeAt(st.seed, now()) : visitPhase(now())),
    pick(aim) { const h = pick(aim); return h ? { type: h.type, x: h.x, z: h.z, prompt: prompt(aim) } : null; },
    /** Host QA: advance the gull clock by sec seconds, running the find rule. */
    fastForward(sec = 60) {
      if (!isHost()) return false;
      let left = Math.max(0, Math.floor(sec));
      while (left > 0) { const n = Math.min(MAX_TICK, left); st.t += n; if (rehome(st, decor())) bump(); const r = tickGull(st, decor(), n); for (const k of r.found) emit({ kind: 'notice', text: `${gullName(st)} brought you ${FIND_TEXT[k]}` }, 'all'); left -= n; }
      bump(); return true;
    },
    /** Host QA: move the gull in on the first perch now. */
    befriend() {
      if (!isHost()) return false;
      const p = target(st, decor()); if (!p) return false;
      drawSeed();
      st.moved = true; st.pts = 0; st.home = p; if (!st.name) st.name = defaultName(st.seed); st.bondAt = st.t - BOND_CD;
      bump(); return true;
    },
    /** Host QA: put a perch on a free raft tile. */
    place(x, z) {
      const w = ctx.world;
      if (!isHost() || !isInt(x) || !isInt(z) || !w) return false;
      if (!w.tiles?.some(t => t[0] === x && t[1] === z) || decor().some(d => d.x === x && d.z === z)) return false;
      w.decor.push({ type: 'perch', x, z }); ctx.rebuildRaft?.(); return true;
    },
    burst,
    openRename: () => openRename(),
    closeRename() { ui?.close(); },
  };

  return {
    name: 'gull',
    update,
    serialize,
    load,
    action,
    interact,
    prompt,
    decorModel(type) { return T && type === 'perch' ? createPerch(T) : null; },
    debug,
    dispose() {
      disposed = true; ui?.destroy(); ui = null; perches.clear();
      if (!built) return;
      group.removeFromParent();
      body.geometry.dispose(); wings[0].geometry.dispose(); hearts[0].geometry.dispose();
      bodyMat.dispose(); wingMat.dispose(); heartMat.dispose();
      built = false; group = null;
    },
  };
}
