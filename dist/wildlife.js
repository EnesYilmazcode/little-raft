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
const FLOOR_Y = 0.2, DECOR_Y = 0.22;
const PERCH_TOP = { sail: 3.62, crate: 0.85, bench: 0.47 }; // decor that gives a raised perch (local height above its base)

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

function gullSky(seed, i, t, o) { // continuous circling path, raft frame
  const s = gullKey(seed, i);
  const r = 7 + 5 * rnd(s, 0), h = 6.5 + 4 * rnd(s, 1), dir = rnd(s, 3) < 0.5 ? -1 : 1;
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

function gullBlend(v, t, scareAt) { // 0 = in the sky, 1 = on the perch
  if (!v || !v.on || v.perch < 0 || t < v.start) return 0;
  let leaveAt = v.start + GULL_DESCEND + v.stay;
  if (scareAt >= v.start + GULL_DESCEND && scareAt < leaveAt) leaveAt = scareAt;
  if (t < v.start + GULL_DESCEND) return smooth((t - v.start) / GULL_DESCEND);
  if (t < leaveAt) return 1;
  return 1 - smooth((t - leaveAt) / GULL_LEAVE);
}

// out: {state, x,y,z (raft frame), yaw, pitch, roll, flap, fold, blend, sx,sy,sz, px,py,pz, perch}
// scareAt: clock time the local player spooked this gull (or -1). visit: forced visit (debug) or null.
export function gullPlan(seed, i, t, perches, out, scareAt = -1, visit = null) {
  const n = Array.isArray(perches) ? perches.length : 0;
  const v = visit && visit.on ? visit : gullVisit(seed, i, Math.floor(t / GULL_SLOT), n, _visit);
  gullSky(seed, i, t, _sky);
  const p = v.on && v.perch >= 0 && v.perch < n ? perches[v.perch] : null;
  const b = p ? gullBlend(v, t, scareAt) : 0;
  out.sx = _sky.sx; out.sy = _sky.sy; out.sz = _sky.sz; out.blend = b; out.perch = p ? v.perch : -1;
  out.px = p ? p.x : 0; out.py = p ? p.y : 0; out.pz = p ? p.z : 0;
  if (b === 1) { out.x = out.px; out.y = out.py; out.z = out.pz; }
  else { out.x = _sky.sx + (out.px - _sky.sx) * b; out.y = _sky.sy + (out.py - _sky.sy) * b; out.z = _sky.sz + (out.pz - _sky.sz) * b; }
  let leaveAt = p ? v.start + GULL_DESCEND + v.stay : 0;
  if (p && scareAt >= v.start + GULL_DESCEND && scareAt < leaveAt) leaveAt = scareAt;
  const state = !p || t < v.start || t >= leaveAt + GULL_LEAVE ? 'circle' : t < v.start + GULL_DESCEND ? 'descend' : t < leaveAt ? 'perched' : 'leave';
  out.state = state;
  // heading from the path a moment ahead
  gullSky(seed, i, t + 0.15, _sky2);
  const b2 = p ? gullBlend(v, t + 0.15, scareAt) : 0;
  const dx = _sky2.sx + (out.px - _sky2.sx) * b2 - out.x, dz = _sky2.sz + (out.pz - _sky2.sz) * b2 - out.z;
  const dy = _sky2.sy + (out.py - _sky2.sy) * b2 - out.y;
  const flyYaw = Math.atan2(dx, dz), hz = Math.hypot(dx, dz);
  if (state === 'perched') {
    const k = (t - v.start - GULL_DESCEND) / 2.3, f = k - Math.floor(k);
    out.yaw = v.yaw + Math.floor(k) * 0.9; // a little turn with every hop
    out.y = out.py + (f < 0.25 ? 0.09 * Math.sin(Math.PI * f / 0.25) : 0);
    out.pitch = 0; out.roll = 0; out.fold = 1;
    out.flap = f < 0.25 ? 0.5 * Math.sin(Math.PI * f / 0.25) : -0.15;
    if (f < 0.25) out.fold = 0.55;
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

export function schoolCenter(seed, i, t, out) {
  const s = (seed ^ Math.imul(i + 7, 0x51ed27)) | 0;
  const ph1 = TAU * rnd(s, 0), ph2 = TAU * rnd(s, 1), ph3 = TAU * rnd(s, 2), dir = rnd(s, 3) < 0.5 ? -1 : 1;
  const w = 0.045 * dir, R = 12 + 5 * Math.sin(t * 0.031 + ph1), dR = 5 * 0.031 * Math.cos(t * 0.031 + ph1);
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
function circlerPos(v, u, o) {
  const lap = v.dur - 2 * ARRIVE;
  const out = v.arrive ? 25 * (1 - smooth(u / ARRIVE)) : 0, back = 25 * smooth((u - ARRIVE - lap) / ARRIVE);
  const rad = v.r + out + back, a = v.a0 + v.dir * v.speed * (u - ARRIVE) / v.r;
  o.x = Math.cos(a) * rad; o.z = Math.sin(a) * rad;
}
const _cp = { x: 0, z: 0 }, _cp2 = { x: 0, z: 0 };

// out: {kind:null|'dolphin'|'turtle', x, y (relative to the water surface), z, heading, pitch, roll}
// force: a visit object (debug summon) that replaces the schedule while it lasts.
export function circlerAt(seed, t, out, force = null) {
  let v = force && force.kind && t >= force.start && t < force.start + force.dur ? force : null;
  if (!v) { v = circlerVisit(seed, Math.floor(t / CIRCLER_SLOT), _cv); if (t < v.start || t >= v.start + v.dur) { out.kind = null; return out; } }
  const u = t - v.start;
  circlerPos(v, u, _cp); circlerPos(v, u + 0.2, _cp2);
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
  let offset = 0, synced = false, clock = 0;
  const net = { t: 0 };
  let perches = [], tilesRef = null, decorRef = null, tilesLen = -1, decorLen = -1;
  const scareAt = new Float64Array(GULL_MAX).fill(-1), scareSlot = new Int32Array(GULL_MAX).fill(-1);
  const forced = []; for (let i = 0; i < GULL_MAX; i++) forced.push({ on: false, start: 0, stay: 0, perch: -1, yaw: 0, scare: false });
  const forceC = { kind: null, start: 0, a0: 0, r: 10, speed: 2.6, dir: 1, laps: 1, dur: 0, arrive: false };
  const pinned = []; for (let i = 0; i < SCHOOL_MAX; i++) pinned.push({ on: false, x: 0, z: 0, heading: 0 });
  const plan = { state: 'circle', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, flap: 0, fold: 0, blend: 0, sx: 0, sy: 0, sz: 0, px: 0, py: 0, pz: 0, perch: -1 };
  const sc = { x: 0, y: 0, z: 0, heading: 0 }, fo = { side: 0, along: 0, ph: 0, size: 1, depth: 0 };
  const cir = { kind: null, x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 };
  const last = { gx: new Float32Array(GULL_MAX * 3), gs: new Array(GULL_MAX).fill('hidden'), sx: new Float32Array(SCHOOL_MAX * 2), nG: 0, nS: 0 };

  let built = false, group = null, gullBody = null, gullWing = null, fish = null, dolphin = null, turtle = null, material = null, fishMat = null;
  let m4, mA, mB, mC, mD, v3, v3b, sc3, q4, qR, eul, col, zero, UP, fishDark, fishWater;

  function build() {
    const T = ctx.T;
    m4 = new T.Matrix4(); mA = new T.Matrix4(); mB = new T.Matrix4(); mC = new T.Matrix4(); mD = new T.Matrix4();
    v3 = new T.Vector3(); v3b = new T.Vector3(); sc3 = new T.Vector3(1, 1, 1); q4 = new T.Quaternion(); qR = new T.Quaternion();
    eul = new T.Euler(0, 0, 0, 'YXZ'); col = new T.Color(); zero = new T.Matrix4().makeScale(0, 0, 0); UP = new T.Vector3(0, 1, 0);
    fishDark = new T.Color('#0b2f36'); fishWater = new T.Color('#3f8c88');
    material = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: T.DoubleSide });
    fishMat = new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false, side: T.DoubleSide });
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

  function refreshPerches() {
    const w = ctx.world; if (!w) return;
    const tl = Array.isArray(w.tiles) ? w.tiles.length : 0, dl = Array.isArray(w.decor) ? w.decor.length : 0;
    if (w.tiles === tilesRef && w.decor === decorRef && tl === tilesLen && dl === decorLen) return;
    tilesRef = w.tiles; decorRef = w.decor; tilesLen = tl; decorLen = dl;
    perches = perchesFrom(w.tiles, w.decor); // only on change, not per frame
  }

  const now = () => (fin(ctx.elapsed) ? ctx.elapsed : 0) + offset;

  function setWing(index, side, flap, fold) {
    mA.makeTranslation(side * GULL_SHOULDER[0], GULL_SHOULDER[1], GULL_SHOULDER[2]);
    mB.makeScale(side, 1, 1);
    mC.makeRotationY(fold * 1.42);
    mD.makeRotationZ(flap - fold * 0.25);
    mA.multiply(mB).multiply(mC).multiply(mD);
    mB.multiplyMatrices(m4, mA);
    gullWing.setMatrixAt(index, mB);
  }

  function updateGulls(t, nG, raft) {
    const slot = Math.floor(t / GULL_SLOT), ph = ctx.physics;
    for (let i = 0; i < GULL_MAX; i++) {
      if (i >= nG) { gullBody.setMatrixAt(i, zero); gullWing.setMatrixAt(i * 2, zero); gullWing.setMatrixAt(i * 2 + 1, zero); last.gs[i] = 'hidden'; continue; }
      const f = forced[i];
      if (f.on && t >= f.start + GULL_DESCEND + f.stay + GULL_LEAVE + 1) f.on = false;
      if (f.on && (f.perch >= perches.length)) f.on = false;
      const sAt = f.on ? (f.scare ? scareAt[i] : -1) : scareSlot[i] === slot ? scareAt[i] : -1;
      gullPlan(seed, i, t, perches, plan, sAt, f.on ? f : null);
      // where the perch is in the world (raft bob and tilt)
      v3.set(plan.px, plan.state === 'perched' ? plan.y : plan.py, plan.pz); if (raft) v3.applyMatrix4(raft.matrixWorld);
      if (plan.state === 'perched' && ph && (!f.on || f.scare) && Math.hypot(ph.x - v3.x, ph.z - v3.z) < SCARE_RADIUS && Math.abs(ph.y - v3.y) < 3) {
        scareAt[i] = t; scareSlot[i] = slot;
        gullPlan(seed, i, t, perches, plan, t, f.on ? f : null);
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
    gullBody.instanceMatrix.needsUpdate = true; gullWing.instanceMatrix.needsUpdate = true;
  }

  function updateFish(t, nS, wiggle, ocean) {
    for (let i = 0; i < SCHOOL_MAX; i++) {
      const p = pinned[i];
      if (p.on) { sc.x = p.x; sc.z = p.z; sc.heading = p.heading; sc.y = -0.7 + 0.2 * Math.sin(t * 0.3); }
      else schoolCenter(seed, i, t, sc);
      // the school drifts its heading a little and swims forward while pinned
      const ch = Math.cos(sc.heading), sh = Math.sin(sc.heading);
      last.sx[i * 2] = sc.x; last.sx[i * 2 + 1] = sc.z;
      for (let j = 0; j < FISH_PER_SCHOOL; j++) {
        const k = i * FISH_PER_SCHOOL + j;
        if (i >= nS) { fish.setMatrixAt(k, zero); continue; }
        fishOffset(seed, i, j, fo);
        const along = fo.along + 0.35 * Math.sin(t * 0.5 + fo.ph), side = fo.side + 0.25 * Math.sin(t * 0.37 + fo.ph * 2);
        const x = sc.x + sh * along + ch * side, z = sc.z + ch * along - sh * side;
        const yaw = sc.heading + 0.18 * Math.sin(t * 0.6 + fo.ph) + (wiggle ? 0.22 * Math.sin(t * 7 + fo.ph * 3) : 0);
        const depth = sc.y + fo.depth; // -1.2 .. -0.4: deeper fish fade into the water colour
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
    circlerAt(seed, t, cir, forceC.kind ? forceC : null);
    if (forceC.kind && t >= forceC.start + forceC.dur) forceC.kind = null;
    dolphin.visible = cir.kind === 'dolphin'; turtle.visible = cir.kind === 'turtle';
    if (!cir.kind) return;
    const m = cir.kind === 'dolphin' ? dolphin : turtle;
    const h = ocean ? ocean.getHeight(cir.x, cir.z) : -0.24;
    v3.set(cir.x, h + cir.y, cir.z); eul.set(cir.pitch, cir.heading, cir.roll, 'YXZ'); q4.setFromEuler(eul); sc3.set(1, 1, 1);
    m.matrix.compose(v3, q4, sc3); m.matrixWorldNeedsUpdate = true;
  }

  const mod = {
    name: 'wildlife',
    update(dt) {
      if (!built) { if (!ctx.scene || !ctx.ocean || !ctx.T) return; build(); }
      const t = now(); clock = t;
      refreshPerches();
      const g = ctx.options ? ctx.options.graphics : 'medium';
      const nG = g === 'low' ? 3 : g === 'high' ? 6 : 5, nS = g === 'low' ? 1 : 2;
      last.nG = nG; last.nS = nS;
      const raft = ctx.raft, ocean = ctx.ocean;
      updateGulls(t, nG, raft);
      updateFish(t, nS, g !== 'low', ocean);
      updateCircler(t, ocean);
    },
    serialize() {
      if (ctx.role !== 'host') return undefined;
      net.t = Math.round((fin(ctx.elapsed) ? ctx.elapsed : 0) * 10) / 10;
      return net;
    },
    load(data, from) {
      if (from === 'net') {
        if (!data || typeof data !== 'object' || !fin(data.t) || Math.abs(data.t) > 1e9) return;
        const off = data.t - (fin(ctx.elapsed) ? ctx.elapsed : 0);
        if (!synced || Math.abs(off - offset) > 2) { offset = off; synced = true; }
        return;
      }
      offset = 0; synced = false; // 'save' and 'restore': our own clock again
    },
    dispose() {
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
      return { t: clock, offset, perches: perches.length, gulls, schools, circler: cir.kind ? { kind: cir.kind, x: cir.x, z: cir.z } : null, built };
    },
    summonCircler(kind = 'dolphin') {
      const k = kind === 'turtle' ? 'turtle' : 'dolphin', L = lookPoint(12), t = now();
      let x = 0, z = -10; if (L) { x = L.p.x; z = L.p.z; }
      const r = Math.max(9, Math.min(14, Math.hypot(x, z)));
      Object.assign(forceC, { kind: k, r, speed: k === 'dolphin' ? 2.6 : 0.9, dir: 1, laps: 1, a0: Math.atan2(z, x), arrive: false });
      forceC.dur = TAU * r / forceC.speed + 2 * ARRIVE; forceC.start = t - ARRIVE;
      return { kind: k, x: Math.cos(forceC.a0) * r, z: Math.sin(forceC.a0) * r };
    },
    landGull(i = 0, opts = {}) {
      i = Math.max(0, Math.min(GULL_MAX - 1, i | 0)); refreshPerches();
      if (!perches.length) return null;
      const L = lookPoint(); let best = 0, bd = Infinity;
      if (L) { if (ctx.raft) ctx.raft.worldToLocal(L); for (let k = 0; k < perches.length; k++) { const d = Math.hypot(perches[k].x - L.x, perches[k].z - L.z); if (d < bd) { bd = d; best = k; } } }
      if (Number.isInteger(opts.perch) && opts.perch >= 0 && opts.perch < perches.length) best = opts.perch;
      Object.assign(forced[i], { on: true, start: now() - (opts.instant ? GULL_DESCEND : 0), stay: fin(opts.stay) ? opts.stay : 15, perch: best, yaw: fin(opts.yaw) ? opts.yaw : TAU * Math.random(), scare: !!opts.scare });
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
    setTime(t) { if (fin(t)) offset = t - (fin(ctx.elapsed) ? ctx.elapsed : 0); return now(); },
    get perches() { return perches.map(p => ({ ...p })); },
    setVisible(on) { if (group) group.visible = !!on; return !!group; }, // for draw-call measurements
    renderCalls() { const r = ctx.renderer; return r && r.info ? r.info.render.calls : null; },
  };
  return mod;
}
