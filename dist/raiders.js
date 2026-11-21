// Crop raiders: seagulls that dive onto crop plots and eat the crops, and the scarecrow that keeps them off
// (Raft's seagull raids, our own art, names and code; numbers in docs/loop/research/fidelity-r3-seagull-bed-fuel.md).
//
// Loop: every planted, unroofed crop plot attracts raiders: one per 1-2 such plots, at most MAX_RAIDERS. Each
// raider waits RAID_EVERY seconds, then swoops in on an arc from the sky (FLY_IN), lands on a planted slot and
// pecks for PECK seconds; the slot then goes back to bare soil (the plot stays) and the gull flies off (FLY_OUT).
// A player within SCARE_R of a landed raider scares it off (its timer starts over). A spear hit deals the spear's
// damage (HP 10: wooden 5, metal 10) and also scares a landed raider; at 0 HP it drops 1-3 feathers + 1 drumstick.
// A Scarecrow guards every plot within GUARD_R: raiders peck the scarecrow instead, and each finished peck costs it
// 1 of its SCARECROW_HP (left arm, right arm, then the whole thing falls apart). A roof or an upper floor piece over
// the plot's tile keeps raiders away.
//
// Host-authoritative content module: the host ticks raiders and applies 'raiders.hit'. Raider and scarecrow state
// travel in world.ext.raiders (serialize/load, like every content module); crop slots live on the decor entries
// (dist/crops.js), so a pecked slot reaches the guest with the decor. The top half of this file is pure.
import { isPlot, emptySlot, CROPS, SLOTS } from './crops.js?build=v3-survival-ae77fa84ac2b';
import { SLOT_X, SOIL_Y } from './crops-model.js?build=v3-survival-ae77fa84ac2b';
import { createScarecrow, raiderKit, SCARECROW_TOP, GULL_SHOULDER } from './raiders-model.js?build=v3-survival-ae77fa84ac2b';

export const SCARECROW = 'scarecrow';
export const RAID_EVERY = 240, PECK = 15, FLY_IN = 4, FLY_OUT = 3.5, DIE = 0.9, RETRY = 60, STAGGER = 5;
export const SCARE_R = 2.25, GUARD_R = 6, HP = 10, MAX_RAIDERS = 3, SCARECROW_HP = 3, HIT_R = 0.42;
export const WAIT = 0, IN = 1, PECKING = 2, OUT = 3, DEAD = 4;
export const STATE_NAMES = Object.freeze(['wait', 'in', 'peck', 'out', 'dead']);
const DECK_Y = 0.22; // decor base above the raft origin (game.js)
const NOTICE_GAP = 60; // seconds between two "pecking" notices
export const TEXT = Object.freeze({
  landed: 'A seagull is pecking at your crops!',
  scarecrow: 'A seagull is pecking at your scarecrow',
  fell: 'The scarecrow fell apart',
  full: 'Your bag is full',
});
const fin = Number.isFinite, isInt = Number.isInteger;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, lo, hi, d) => (typeof v === 'number' && fin(v) ? clamp(v, lo, hi) : d);
const keyOf = (x, z) => x + ',' + z;

/** A fresh raider: waiting, staggered by index so several do not arrive together. */
export const newRaider = (i = 0) => ({ st: WAIT, t: RAID_EVERY + i * STAGGER, hp: HP, a: 0, px: 0, py: 0, pz: 0, x: 0, z: 0, s: -1 });
export const newState = () => ({ r: Array.from({ length: MAX_RAIDERS }, (_, i) => newRaider(i)), sc: {} });

/** Validated raider list + scarecrow HP map from a save or the network. Junk -> fresh. */
export function cleanState(v) {
  const out = newState();
  if (!v || typeof v !== 'object') return out;
  const list = Array.isArray(v.r) ? v.r : [];
  for (let i = 0; i < MAX_RAIDERS; i++) {
    const a = list[i], r = out.r[i];
    if (!Array.isArray(a) || a.length < 10) continue;
    const st = isInt(a[0]) && a[0] >= WAIT && a[0] <= DEAD ? a[0] : WAIT;
    r.st = st; r.t = num(a[1], 0, RAID_EVERY + MAX_RAIDERS * STAGGER, r.t); r.hp = num(a[2], 0, HP, HP);
    r.a = num(a[3], -10, 10, 0); r.px = num(a[4], -80, 80, 0); r.py = num(a[5], -5, 20, 0); r.pz = num(a[6], -80, 80, 0);
    r.x = isInt(a[7]) && Math.abs(a[7]) <= 40 ? a[7] : 0; r.z = isInt(a[8]) && Math.abs(a[8]) <= 40 ? a[8] : 0;
    r.s = isInt(a[9]) && a[9] >= -1 && a[9] < SLOTS ? a[9] : -1;
    if (r.st !== WAIT && r.hp <= 0 && r.st !== DEAD) r.st = WAIT;
  }
  if (v.sc && typeof v.sc === 'object' && !Array.isArray(v.sc)) {
    for (const [k, hp] of Object.entries(v.sc)) if (/^-?\d{1,2},-?\d{1,2}$/.test(k) && isInt(hp) && hp >= 1 && hp < SCARECROW_HP) out.sc[k] = hp;
  }
  return out;
}
/** Compact JSON form (arrays of numbers; times to 0.1 s). `out` is reused when given. */
export function packState(state, out = { r: [], sc: null }) {
  for (let i = 0; i < MAX_RAIDERS; i++) {
    const r = state.r[i], q = 10;
    const a = out.r[i] || (out.r[i] = new Array(10));
    a[0] = r.st; a[1] = Math.round(r.t * q) / q; a[2] = r.hp; a[3] = Math.round(r.a * 1000) / 1000;
    a[4] = Math.round(r.px * 1000) / 1000; a[5] = Math.round(r.py * 1000) / 1000; a[6] = Math.round(r.pz * 1000) / 1000; a[7] = r.x; a[8] = r.z; a[9] = r.s;
  }
  out.r.length = MAX_RAIDERS; out.sc = state.sc;
  return out;
}

/** A roof piece (any level) or an upper floor piece over tile (x, z): the plot is indoors. */
export function covered(pieces, x, z) {
  if (!Array.isArray(pieces)) return false;
  for (const p of pieces) if (p && p.i === x && p.j === z && (p.t === 'roof' || (p.t === 'floor' && p.l >= 1))) return true;
  return false;
}
const planted = (d) => isPlot(d) && Array.isArray(d.crop) && d.crop.some(s => s && s.c && Object.prototype.hasOwnProperty.call(CROPS, s.c));
/** Crop plots that attract raiders: at least one planted slot, not under a roof. */
export function attracting(world) {
  const out = [], decor = Array.isArray(world?.decor) ? world.decor : [];
  for (const d of decor) if (planted(d) && !covered(world.pieces, d.x, d.z)) out.push(d);
  return out;
}
/** Allocation-free count of attracting plots. */
export function attractingCount(world) {
  let n = 0; const decor = Array.isArray(world?.decor) ? world.decor : [];
  for (let i = 0; i < decor.length; i++) { const d = decor[i]; if (planted(d) && !covered(world.pieces, d.x, d.z)) n++; }
  return n;
}
/** Raiders that hunt `plots` attracting plots: one per 1-2 plots, at most MAX_RAIDERS. */
export const raiderCount = (plots) => Math.min(MAX_RAIDERS, Math.ceil(Math.max(0, plots | 0) / 2));
export const scarecrowHp = (state, x, z) => state.sc[keyOf(x, z)] ?? SCARECROW_HP;
/** The nearest scarecrow within GUARD_R (tile-centre metres) of plot d, or null. */
export function guardOf(world, d) {
  let best = null, bd = Infinity;
  for (const e of Array.isArray(world?.decor) ? world.decor : []) {
    if (!e || e.type !== SCARECROW) continue;
    const q = Math.hypot((e.x - d.x) * 2, (e.z - d.z) * 2);
    if (q <= GUARD_R + 1e-9 && q < bd) { bd = q; best = e; }
  }
  return best;
}
const decorAt = (decor, x, z, type) => { if (Array.isArray(decor)) for (const d of decor) if (d && d.x === x && d.z === z && (type ? d.type === type : true)) return d; return null; };

/** Raft-local landing point of slot s on plot d (soil top), or of a scarecrow (s = -1, hat top). Writes out. */
export function landPoint(d, s, out) {
  if (s < 0) { out.x = d.x * 2; out.y = DECK_Y + SCARECROW_TOP; out.z = d.z * 2; return out; }
  const r = d.rot || 0, lx = SLOT_X * (s - 1);
  out.x = d.x * 2 + Math.cos(r) * lx; out.y = DECK_Y + SOIL_Y; out.z = d.z * 2 - Math.sin(r) * lx;
  return out;
}

/**
 * Host: picks raider i's target. Candidates: the guarding scarecrow of each attracting plot, else each planted
 * slot of it; targets other flying raiders hold are skipped. Sets x, z, s and the landing point. -> boolean.
 */
export function pickTarget(state, i, world, rnd = Math.random) {
  const cands = [], taken = (x, z, s) => state.r.some((o, j) => j !== i && o.st !== WAIT && o.st !== DEAD && o.x === x && o.z === z && o.s === s);
  for (const d of attracting(world)) {
    const g = guardOf(world, d);
    if (g) { if (!taken(g.x, g.z, -1) && !cands.some(c => c.d === g)) cands.push({ d: g, s: -1 }); continue; }
    for (let s = 0; s < SLOTS; s++) { const c = d.crop[s]; if (c && c.c && !taken(d.x, d.z, s)) cands.push({ d, s }); }
  }
  if (!cands.length) return false;
  const c = cands[Math.min(cands.length - 1, Math.floor(clamp(rnd(), 0, 0.999999) * cands.length))], r = state.r[i];
  r.x = c.d.x; r.z = c.d.z; r.s = c.s; landPoint(c.d, c.s, P); r.px = P.x; r.py = P.y; r.pz = P.z;
  return true;
}
const P = { x: 0, y: 0, z: 0 };

/** Is raider r's target still there (planted slot / standing scarecrow, plot not roofed)? */
export function targetValid(world, r) {
  const decor = world?.decor;
  if (r.s < 0) return !!decorAt(decor, r.x, r.z, SCARECROW);
  const d = decorAt(decor, r.x, r.z, 'cropplot');
  return !!d && Array.isArray(d.crop) && !!d.crop[r.s]?.c && !covered(world.pieces, d.x, d.z);
}

// Leave from wherever the raider is: from the ground any heading works; mid-swoop it retraces its arc.
function leave(r, awayA) {
  if (r.st === IN) { const x = Math.min(1, r.t / FLY_IN); r.t = (1 - x) * FLY_OUT; }
  else { r.t = 0; if (fin(awayA)) r.a = awayA; }
  r.st = OUT;
}
const rest = (r, i, extra = 0) => { r.st = WAIT; r.t = RAID_EVERY + extra; r.hp = HP; r.s = -1; };

/**
 * Host tick. world = {decor, pieces}; players = [{x, y?, z}|null...] (raft-local, == world XZ); rnd() in [0, 1).
 * Pushes events into `ev` (cleared first): {kind:'landed'|'ate'|'pecked'|'fell'|'scared', i, ...}. Returns ev.
 * Steady frames allocate nothing; `n` (raiders wanted) may be passed in so the plot count need not run every frame.
 */
export function tickRaiders(state, world, dt, players, rnd = Math.random, ev = [], n = raiderCount(attractingCount(world))) {
  ev.length = 0;
  const step = fin(dt) && dt > 0 ? Math.min(dt, 1) : 0;
  for (let i = 0; i < MAX_RAIDERS; i++) {
    const r = state.r[i];
    if (r.st === WAIT) {
      if (i >= n) { r.t = Math.max(r.t, RAID_EVERY + i * STAGGER); continue; } // not hunting: the clock starts when crops attract it
      r.t -= step; if (r.t > 0) continue;
      if (!pickTarget(state, i, world, rnd)) { r.t = RETRY; continue; }
      r.st = IN; r.t = 0; r.hp = HP; r.a = rnd() * Math.PI * 2;
      continue;
    }
    r.t += step;
    if (r.st === DEAD) { if (r.t >= DIE) rest(r, i); continue; }
    if (r.st === OUT) { if (r.t >= FLY_OUT) rest(r, i); continue; }
    if (!targetValid(world, r)) { leave(r); continue; } // harvested, pecked by another, removed or roofed over
    if (r.st === IN) {
      if (r.t >= FLY_IN) { r.st = PECKING; r.t = 0; ev.push({ kind: 'landed', i, scarecrow: r.s < 0 }); }
      continue;
    }
    // PECKING: either player walking up scares it off
    for (let k = 0; k < players.length; k++) {
      const p = players[k]; if (!p || !fin(p.x) || !fin(p.z)) continue;
      const dx = r.px - p.x, dz = r.pz - p.z;
      if (fin(p.y) && Math.abs(p.y - r.py) > 3) continue;
      if (dx * dx + dz * dz < SCARE_R * SCARE_R) { leave(r, Math.atan2(dx, dz)); ev.push({ kind: 'scared', i }); break; }
    }
    if (r.st !== PECKING || r.t < PECK) continue;
    if (r.s >= 0) {
      const d = decorAt(world.decor, r.x, r.z, 'cropplot'), crop = d.crop[r.s].c;
      d.crop[r.s] = emptySlot(); ev.push({ kind: 'ate', i, crop, x: r.x, z: r.z, s: r.s });
    } else {
      const k = keyOf(r.x, r.z), hp = (state.sc[k] ?? SCARECROW_HP) - 1;
      if (hp <= 0) {
        delete state.sc[k];
        const j = world.decor.indexOf(decorAt(world.decor, r.x, r.z, SCARECROW)); if (j >= 0) world.decor.splice(j, 1);
        ev.push({ kind: 'fell', i, x: r.x, z: r.z });
      } else { state.sc[k] = hp; ev.push({ kind: 'pecked', i, hp, x: r.x, z: r.z }); }
    }
    leave(r, r.a + Math.PI * (0.6 + 0.8 * rnd()));
  }
  return ev;
}
/** Drops scarecrow HP entries whose scarecrow is gone (removed or never placed). */
export function pruneScarecrows(state, decor) {
  for (const k of Object.keys(state.sc)) { const [x, z] = k.split(',').map(Number); if (!decorAt(decor, x, z, SCARECROW)) delete state.sc[k]; }
}

/** One spear hit on raider i (host). -> {ok, killed, scared}. Only a flying or landed raider can be hit. */
export function hitRaider(state, i, dmg, awayA) {
  const r = state.r[i];
  if (!r || (r.st !== IN && r.st !== PECKING && r.st !== OUT) || !fin(dmg) || dmg <= 0) return { ok: false, killed: false, scared: false };
  r.hp = Math.max(0, r.hp - clamp(dmg, 0, HP));
  if (r.hp <= 0) {
    raiderPose(r, Q); r.px = Q.x; r.py = Q.y; r.pz = Q.z; r.st = DEAD; r.t = 0; // falls from where it was hit
    return { ok: true, killed: true, scared: false };
  }
  const scared = r.st === PECKING || r.st === IN;
  if (scared) leave(r, awayA);
  return { ok: true, killed: false, scared };
}
const Q = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, flap: 0, fold: 0, scale: 1, landed: false };
/** Loot of one downed raider: 1-3 feathers and a raw drumstick. */
export const raiderLoot = (rnd = Math.random) => ({ feather: 1 + Math.min(2, Math.floor(clamp(rnd(), 0, 0.999999) * 3)), drumstick: 1 });

// Quadratic swoop from the sky point (a: approach heading) down to the landing point P.
const SKY_R = 16, SKY_H = 10, CTRL_R = 6, CTRL_H = 1.2;
function arc(r, u, out) {
  const sa = Math.sin(r.a), ca = Math.cos(r.a), w0 = (1 - u) * (1 - u), w1 = 2 * (1 - u) * u, w2 = u * u;
  out.x = r.px + sa * (SKY_R * w0 + CTRL_R * w1); out.y = r.py + SKY_H * w0 + CTRL_H * w1; out.z = r.pz + ca * (SKY_R * w0 + CTRL_R * w1);
  // heading: the arc's tangent (toward P while coming in)
  const dh = -2 * (1 - u) * SKY_R + (2 - 4 * u) * CTRL_R, dy = -2 * (1 - u) * SKY_H + (2 - 4 * u) * CTRL_H; // d/du of the radial and height terms
  out.pitch = Math.atan2(dy, Math.abs(dh) + 1e-6) * 0.6;
}
/**
 * Raft-local pose of raider r for its state and t (pure; no allocations). out: {x,y,z,yaw,pitch,roll,flap,fold,scale,landed}.
 * Feet at (x, y, z); yaw 0 faces +z. `clock` adds idle motion (flap phase, head turns).
 */
export function raiderPose(r, out, clock = 0) {
  out.roll = 0; out.scale = 1; out.landed = false;
  if (r.st === IN) {
    const x = Math.min(1, r.t / FLY_IN), u = 1 - (1 - x) * (1 - x);
    arc(r, u, out); out.pitch = -out.pitch; out.yaw = r.a + Math.PI; // faces the landing point
    out.fold = clamp((u - 0.82) / 0.18, 0, 1); out.flap = (1 - out.fold) * (u < 0.6 ? 0.6 * Math.sin(clock * 11) : 0.25 * Math.sin(clock * 6));
    out.roll = 0.25 * Math.sin(u * Math.PI) * Math.sin(r.a * 3);
    return out;
  }
  if (r.st === OUT) {
    const x = Math.min(1, r.t / FLY_OUT), u = 1 - x * x;
    arc(r, u, out); out.yaw = r.a; // faces away, climbing
    out.fold = clamp(1 - x * 6, 0, 1); out.flap = (1 - out.fold) * 0.75 * Math.sin(clock * 13);
    return out;
  }
  out.x = r.px; out.y = r.py; out.z = r.pz; out.fold = 1; out.flap = 0;
  if (r.st === DEAD) {
    const k = Math.min(1, r.t / DIE);
    out.y = r.py - 0.5 * k * k; out.yaw = r.a; out.pitch = 0; out.roll = 1.6 * k; out.scale = Math.max(0.001, 1 - k); out.fold = 0.5;
    return out;
  }
  out.landed = r.st === PECKING;
  // pecking: bursts of quick jabs, head turns between them
  const ph = r.t % 2.4, jab = ph < 1.2 ? Math.max(0, Math.sin(ph * 10.5)) : 0;
  out.yaw = r.a + Math.PI + (ph < 1.2 ? 0 : 0.45 * Math.sin(r.t * 1.7 + r.a));
  out.pitch = 0.7 * jab * jab;
  return out;
}
const visible = (r) => r.st === IN || r.st === PECKING || r.st === OUT || r.st === DEAD;

// Scenery gulls (dist/wildlife.js) read this to fly fewer while raiders are out, so the sky does not double up.
let shownRaiders = 0;
export const raidersShown = () => shownRaiders;

// ------------------------------------------------------------------ the content module

export function createRaiders(ctx) {
  const T = ctx.T;
  let state = newState(), net = { r: [], sc: null }, countClock = 1, wanted = 0, lastNotice = -Infinity, pruneClock = 0;
  const ev = [], players = [null, null];
  const pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, flap: 0, fold: 0, scale: 1, landed: false };
  const hitAt = { host: -Infinity, guest: -Infinity };
  const nextSquawk = new Float64Array(MAX_RAIDERS), wasSt = new Int8Array(MAX_RAIDERS);
  const wpos = new Float32Array(MAX_RAIDERS * 3); // rendered world position (feet) of each raider
  let built = false, kit = null, group = null; const views = [];
  let v3, q4, qY, eul, sc3;
  let scanRaft = null, scanLen = -1, scanFirst = null; const crows = []; // craft_scarecrow groups on the raft
  let clock = 0;
  const UP = T ? new T.Vector3(0, 1, 0) : null;

  function build() {
    kit = raiderKit(T);
    v3 = new T.Vector3(); q4 = new T.Quaternion(); qY = new T.Quaternion(); eul = new T.Euler(0, 0, 0, 'YXZ'); sc3 = new T.Vector3(1, 1, 1);
    group = new T.Group(); group.name = 'raiders';
    for (let i = 0; i < MAX_RAIDERS; i++) {
      const g = new T.Group(); g.visible = false;
      const body = new T.Mesh(kit.body, kit.mat); body.castShadow = false; body.receiveShadow = false; g.add(body);
      const wings = [];
      for (const side of [1, -1]) { const w = new T.Mesh(kit.wing, kit.mat); w.castShadow = false; w.rotation.order = 'YXZ'; w.userData.side = side; body.add(w); wings.push(w); }
      group.add(g); views.push({ g, body, wings });
    }
    ctx.scene.add(group); built = true;
  }
  // Same fold/flap rig as the scenery gulls: fold swings the wing back along the flank.
  function setWing(w, flap, fold) {
    const side = w.userData.side;
    w.position.set(side * (GULL_SHOULDER[0] + 0.035 * fold), GULL_SHOULDER[1] - 0.09 * fold, GULL_SHOULDER[2]);
    w.rotation.set(fold * 1.4, side * fold * 1.55, side * flap * (1 - 0.8 * fold));
    w.scale.set(side * (1 - 0.3 * fold), 1, 1);
  }
  function render(dt) {
    const raft = ctx.raft; if (raft) raft.updateWorldMatrix(true, false);
    let shown = 0;
    for (let i = 0; i < MAX_RAIDERS; i++) {
      const r = state.r[i], v = views[i];
      if (!visible(r)) { if (v.g.visible) v.g.visible = false; continue; }
      shown++;
      raiderPose(r, pose, clock + i * 1.3);
      v3.set(pose.x, pose.y, pose.z); if (raft) v3.applyMatrix4(raft.matrixWorld);
      v.g.position.copy(v3); wpos[i * 3] = v3.x; wpos[i * 3 + 1] = v3.y; wpos[i * 3 + 2] = v3.z;
      qY.setFromAxisAngle(UP, pose.yaw); if (raft) q4.copy(raft.quaternion).multiply(qY); else q4.copy(qY);
      v.g.quaternion.copy(q4);
      eul.set(pose.pitch, 0, pose.roll, 'YXZ'); v.body.rotation.copy(eul);
      v.g.scale.setScalar(pose.scale);
      setWing(v.wings[0], pose.flap, pose.fold); setWing(v.wings[1], pose.flap, pose.fold);
      if (!v.g.visible) v.g.visible = true;
      squawks(i, r, dt);
    }
    shownRaiders = shown;
  }
  // Local sound only: a squawk on landing and now and then while pecking, louder close by.
  function squawks(i, r, dt) {
    if (r.st !== wasSt[i]) { if (r.st === PECKING || (r.st === OUT && wasSt[i] === PECKING) || r.st === DEAD) nextSquawk[i] = 0; wasSt[i] = r.st; }
    if (r.st !== PECKING && !(r.st === OUT && r.t < 0.5) && r.st !== DEAD) return;
    nextSquawk[i] -= dt; if (nextSquawk[i] > 0) return;
    nextSquawk[i] = r.st === PECKING ? 3.5 + Math.random() * 3 : 99;
    const p = ctx.physics, d = p ? Math.hypot(p.x - r.px, p.z - r.pz) : 0, s = clamp(1 - d / 30, 0, 1);
    if (s > 0.05) try { ctx.play?.('squawk', 0.35 + 0.55 * s); } catch {}
  }
  // Scarecrow models lose an arm per peck: armL below SCARECROW_HP, armR below SCARECROW_HP - 1.
  function paintScarecrows() {
    const raft = ctx.raft; if (!raft) return;
    const kids = raft.children;
    if (raft !== scanRaft || kids.length !== scanLen || kids[0] !== scanFirst) {
      scanRaft = raft; scanLen = kids.length; scanFirst = kids[0]; crows.length = 0;
      for (let i = 0; i < kids.length; i++) { const g = kids[i]; if (g.name === 'craft_scarecrow') { const u = g.userData; u.armL ??= g.getObjectByName('armL'); u.armR ??= g.getObjectByName('armR'); u.hpKey = keyOf(Math.round(g.position.x / 2), Math.round(g.position.z / 2)); crows.push(g); } }
    }
    for (let i = 0; i < crows.length; i++) {
      const g = crows[i], hp = state.sc[g.userData.hpKey] ?? SCARECROW_HP; // key cached at scan time: no per-frame strings
      const l = g.userData.armL, rr = g.userData.armR;
      if (l && l.visible !== hp >= SCARECROW_HP) l.visible = hp >= SCARECROW_HP;
      if (rr && rr.visible !== hp >= SCARECROW_HP - 1) rr.visible = hp >= SCARECROW_HP - 1;
    }
  }
  function hostTick(dt) {
    const w = ctx.world; if (!w) return;
    countClock += dt;
    if (countClock >= 1) { countClock = 0; wanted = raiderCount(attractingCount(w)); if (++pruneClock >= 5) { pruneClock = 0; pruneScarecrows(state, w.decor); } }
    players[0] = ctx.physics; players[1] = ctx.other ?? null;
    tickRaiders(state, w, dt, players, Math.random, ev, wanted);
    for (let k = 0; k < ev.length; k++) handle(ev[k]);
  }
  function handle(e) {
    if (e.kind === 'landed') {
      if (clock - lastNotice >= NOTICE_GAP) { lastNotice = clock; ctx.emit?.({ kind: 'notice', text: e.scarecrow ? TEXT.scarecrow : TEXT.landed, sound: 'squawk' }, 'all'); }
    } else if (e.kind === 'ate') {
      ctx.emit?.({ kind: 'notice', text: `A seagull ate your ${CROPS[e.crop]?.name.toLowerCase() ?? 'crop'}`, sound: 'squawk' }, 'all');
    } else if (e.kind === 'fell') {
      ctx.emit?.({ kind: 'notice', text: TEXT.fell }, 'all'); ctx.rebuildRaft?.();
    }
  }

  // Ray (spear) against each visible raider's body: nearest hit within reach. -> index or -1.
  function rayHit(o, d, reach) {
    let best = -1, bt = Infinity;
    for (let i = 0; i < MAX_RAIDERS; i++) {
      const r = state.r[i]; if (r.st !== IN && r.st !== PECKING && r.st !== OUT) continue;
      const cx = wpos[i * 3] - o.x, cy = wpos[i * 3 + 1] + 0.24 - o.y, cz = wpos[i * 3 + 2] - o.z;
      const t = cx * d.x + cy * d.y + cz * d.z; if (t < 0 || t > reach + HIT_R) continue;
      const qx = cx - d.x * t, qy = cy - d.y * t, qz = cz - d.z * t;
      if (qx * qx + qy * qy + qz * qz <= HIT_R * HIT_R && t < bt) { bt = t; best = i; }
    }
    return best;
  }

  const mod = {
    name: 'raiders',
    update(dt) {
      const step = fin(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
      clock += step;
      if (ctx.running && ctx.role !== 'guest') hostTick(step);
      else if (ctx.role === 'guest') for (let i = 0; i < MAX_RAIDERS; i++) if (state.r[i].st !== WAIT) state.r[i].t += step; // guest: animate between host updates
      if (!T || !ctx.scene) return;
      if (!built) build();
      render(step); paintScarecrows();
    },
    serialize() { return ctx.role === 'guest' ? undefined : packState(state, net); },
    load(data, from) {
      const s = cleanState(data);
      if (from !== 'net') { state = s; return; }
      for (let i = 0; i < MAX_RAIDERS; i++) { // keep the local animation clock unless it drifted
        const a = state.r[i], b = s.r[i];
        const t = a.st === b.st && Math.abs(a.t - b.t) < 0.4 ? a.t : b.t;
        Object.assign(a, b); a.t = t;
      }
      state.sc = s.sc;
    },
    /** Spear thrust (spear-repair-hooks.js): origin/dir in world space. Sends 'raiders.hit' on a hit. */
    trySpear(origin, dir, reach = 2.8, dmg = 5) {
      if (!built || !origin || !dir) return false;
      const i = rayHit(origin, dir, reach); if (i < 0) return false;
      ctx.action?.({ kind: 'raiders.hit', i, dmg });
      try { ctx.play?.('squawk', 0.9); } catch {}
      return true;
    },
    action(a, actor, bag) {
      if (!a || a.kind !== 'raiders.hit') return false;
      if (!isInt(a.i) || a.i < 0 || a.i >= MAX_RAIDERS || !fin(a.dmg)) return true;
      const p = actor === 'guest' ? ctx.other : ctx.physics, r = state.r[a.i], now = clock;
      if (actor === 'guest' && now - hitAt.guest < 0.25) return true;
      if (!p || !fin(p.x) || !fin(p.z)) return true;
      raiderPose(r, pose, clock);
      if (Math.hypot(pose.x - p.x, pose.z - p.z) > 2.8 + HIT_R + (actor === 'guest' ? 2 : 0.6)) return true;
      hitAt[actor === 'guest' ? 'guest' : 'host'] = now;
      const res = hitRaider(state, a.i, a.dmg, Math.atan2(pose.x - p.x, pose.z - p.z));
      if (res.killed && bag) {
        const loot = raiderLoot(), got = {};
        for (const [k, n] of Object.entries(loot)) { const put = n - bag.add(k, n); if (put > 0) got[k] = put; }
        const parts = Object.entries(got).map(([k, n]) => `${n} ${k === 'feather' ? (n > 1 ? 'Feathers' : 'Feather') : 'Raw Drumstick'}`);
        ctx.emit?.(parts.length ? { kind: 'loot', text: '+ ' + parts.join(' · '), loot: got } : { kind: 'full', text: TEXT.full }, actor);
      }
      return true;
    },
    decorModel(type) { return T && type === SCARECROW ? createScarecrow(T) : null; },
    get state() { return state; },
    debug: {
      state: () => ({ wanted, shown: shownRaiders, raiders: state.r.map(r => ({ ...r, state: STATE_NAMES[r.st] })), scarecrows: { ...state.sc } }),
      /** Host QA: raider i picks a target now and starts its swoop (land: skip straight to pecking). */
      force(i = 0, opts = {}) {
        if (ctx.role === 'guest' || !ctx.world) return null;
        const r = state.r[i]; if (!r) return null;
        if (!pickTarget(state, i, ctx.world)) return null;
        r.st = opts.land ? PECKING : IN; r.t = 0; r.hp = HP; r.a = fin(opts.a) ? opts.a : Math.random() * Math.PI * 2;
        if (opts.land) handle({ kind: 'landed', i, scarecrow: r.s < 0 });
        return { x: r.x, z: r.z, s: r.s, px: r.px, py: r.py, pz: r.pz };
      },
      /** Host QA: let raider i's peck run `left` seconds before it finishes. */
      peckLeft(i = 0, left = 0.05) { const r = state.r[i]; if (!r || r.st !== PECKING) return false; r.t = PECK - left; return true; },
      setTimer(i = 0, sec = 1) { const r = state.r[i]; if (!r || r.st !== WAIT) return false; r.t = sec; countClock = 1; return true; },
      hit(i = 0, dmg = 5) { return hitRaider(state, i, dmg, 0); },
      /** QA: move the local player to raft-local (x, z) (screenshots, scare checks). */
      standAt(x, z) { const p = ctx.physics; if (!p || !fin(x) || !fin(z)) return false; p.x = x; p.z = z; if ('vx' in p) p.vx = 0; if ('vz' in p) p.vz = 0; return true; },
      worldPos(i = 0) { return { x: wpos[i * 3], y: wpos[i * 3 + 1], z: wpos[i * 3 + 2] }; },
      /** Host QA: put a scarecrow on a free raft tile. */
      placeScarecrow(x, z) {
        const w = ctx.world;
        if (ctx.role === 'guest' || !isInt(x) || !isInt(z) || !w) return false;
        if (!w.tiles?.some(t => t[0] === x && t[1] === z) || w.decor.some(d => d.x === x && d.z === z)) return false;
        w.decor.push({ type: SCARECROW, x, z }); delete state.sc[keyOf(x, z)]; ctx.rebuildRaft?.(); return true;
      },
    },
    dispose() {
      shownRaiders = 0;
      if (!built) return;
      group.removeFromParent(); kit.body.dispose(); kit.wing.dispose(); kit.mat.dispose(); built = false; views.length = 0;
    },
  };
  return mod;
}
