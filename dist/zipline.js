// Glide Posts, glide lines and the Glide Handle (see docs/specs/zipline.md).
// Put up two posts, hold the Glide Handle, press E on one post and then the other: a rope line is strung between
// their wheels. Hold the handle and press E at a post (or aim at the line) to hang on and glide. Downhill speeds up,
// flat or uphill crawls gently, the end gives a little hop, Space lets go. Friendly: no damage, a drop is a swim.
// Slice: world.ext.zipline, host-authoritative links (actions 'zip.*'); the ride is local to each player.
// The top half of this file is pure (no DOM, no Date, no Math.random) and exported for tests.
import { createGlidePost, createRopeLines } from './zipline-model.js?build=v3-survival-ae77fa84ac2b';
import { LEVEL_H, FLOOR_THICK, PIECES } from './building-pieces.js?build=v3-survival-ae77fa84ac2b';

export const POSTS = Object.freeze({ glidepost: 3.4, glidestep: 2.4 }); // wheel height above deckY()
export const MIN_LEN = 4, MAX_LEN = 16, ROPE_PER = 4, MAX_PER_POST = 2, MAX_LINES = 64; // horizontal metres (tile = 2 m)
export const G = 9.8, DRAG = 0.35, PUSH = 1.0, V_MIN = 1.2, V_MAX = 9, V_START = 2;
// ENDPAD: how close to a wheel a ride may start; END_STOP: the ride ends (hop) this far before the wheel it heads to,
// so the rider's face never slides into the mast.
export const END_STOP = 1.3;
export const HANG = 0.55, ENDPAD = 0.6, HOP_VY = 2.2, DROP_VY = 0.3, END_CARRY = 0.25, REACH = 2.6, LINE_REACH = 3, HOST_SLACK = 2;
export const OLD_HOST = 'Your friend’s raft doesn’t have glide lines yet';
export const TEXT = Object.freeze({
  same: 'Pick a different post', post: 'That needs two glide posts', short: 'Too close: posts must be 2 tiles apart',
  long: 'Too far: lines reach 16 m', full: 'That post already has two lines', blocked: 'A wall or roof is in the way',
  inway: 'Something is in the way of this line', bagfull: 'Your bag is full', next: 'Now press E on the other post',
  cancel: 'Glide line cancelled', letgo: 'Space to let go', nohandle: 'Glide Post: hold a Glide Handle to link or ride',
});
const PENDING_S = 30, SUB = .05, MAX_DT = .25, PAD = .2, BODY_DROPS = [0, 1, 2];
const isInt = Number.isInteger;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const ropeCost = len => Math.ceil(len / ROPE_PER);
const tileLen = (ax, az, bx, bz) => 2 * Math.hypot(bx - ax, bz - az);

/** 'glidepost' | 'glidestep' | null for the decor on that tile. */
export function postAt(decor, x, z) {
  if (Array.isArray(decor)) for (let i = 0; i < decor.length; i++) {
    const d = decor[i];
    if (d && d.x === x && d.z === z && (d.type === 'glidepost' || d.type === 'glidestep')) return d.type;
  }
  return null;
}

/** Indices of the lines that touch the post at (x, z). */
export function linesAt(st, x, z) {
  const out = [];
  const l = st && Array.isArray(st.l) ? st.l : [];
  for (let i = 0; i < l.length; i++) { const e = l[i]; if ((e[0] === x && e[1] === z) || (e[2] === x && e[3] === z)) out.push(i); }
  return out;
}
function countAt(l, x, z) { let n = 0; for (let i = 0; i < l.length; i++) { const e = l[i]; if ((e[0] === x && e[1] === z) || (e[2] === x && e[3] === z)) n++; } return n; }
function pairIndex(l, ax, az, bx, bz) {
  for (let i = 0; i < l.length; i++) { const e = l[i]; if (e[0] === ax && e[1] === az && e[2] === bx && e[3] === bz) return i; }
  return -1;
}
// Canonical order: (ax,az) < (bx,bz) lexicographically. Writes into `out` (4 numbers).
function canon(out, ax, az, bx, bz) {
  if (ax > bx || (ax === bx && az > bz)) { out[0] = bx; out[1] = bz; out[2] = ax; out[3] = az; } else { out[0] = ax; out[1] = az; out[2] = bx; out[3] = bz; }
  return out;
}
const CAN = new Int32Array(4);

/** Validated slice {v:1, s, r, l}. Junk -> defaults; bad, short, long, self, duplicate, over-full and orphan lines dropped. */
export function cleanZip(v, decor) {
  const out = { v: 1, s: '', r: 0, l: [] };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  if (typeof v.s === 'string' && v.s.length <= 32) out.s = v.s;
  if (isInt(v.r) && v.r >= 0) out.r = v.r;
  const list = Array.isArray(v.l) ? v.l : [];
  for (let i = 0; i < list.length && out.l.length < MAX_LINES; i++) {
    const e = list[i];
    if (!Array.isArray(e) || e.length !== 4 || !e.every(isInt)) continue;
    const [ax, az, bx, bz] = canon(CAN, e[0], e[1], e[2], e[3]);
    if (ax === bx && az === bz) continue;
    if (!postAt(decor, ax, az) || !postAt(decor, bx, bz)) continue;
    const len = tileLen(ax, az, bx, bz);
    if (len < MIN_LEN || len > MAX_LEN) continue;
    if (pairIndex(out.l, ax, az, bx, bz) >= 0) continue;
    if (countAt(out.l, ax, az) >= MAX_PER_POST || countAt(out.l, bx, bz) >= MAX_PER_POST) continue;
    out.l.push([ax, az, bx, bz]);
  }
  return out;
}

// ---- segment vs building pieces (raft-local metres, y relative to the deck) ----
const BOX = new Float64Array(6), SLAB = new Float64Array(2); // module scratch: no allocation per test
function pieceBox(p) {
  if (!p || typeof p.t !== 'string' || !isInt(p.i) || !isInt(p.j) || !isInt(p.l)) return false;
  const def = Object.prototype.hasOwnProperty.call(PIECES, p.t) ? PIECES[p.t] : null; if (!def || p.t === 'foundation') return false;
  const y0 = p.l * LEVEL_H, cx = 2 * p.i, cz = 2 * p.j;
  if (def.slot === 'cell') { BOX[0] = cx - 1; BOX[1] = cx + 1; BOX[2] = y0 - FLOOR_THICK; BOX[3] = y0 + def.height; BOX[4] = cz - 1; BOX[5] = cz + 1; }
  else if (def.slot === 'edge') {
    if (p.r) { BOX[0] = cx - 1 - .07; BOX[1] = cx - 1 + .07; BOX[4] = cz - 1; BOX[5] = cz + 1; }
    else { BOX[0] = cx - 1; BOX[1] = cx + 1; BOX[4] = cz - 1 - .07; BOX[5] = cz - 1 + .07; }
    BOX[2] = y0; BOX[3] = y0 + def.height;
  } else if (def.slot === 'corner') { BOX[0] = cx - 1.11; BOX[1] = cx - .89; BOX[2] = y0; BOX[3] = y0 + def.height; BOX[4] = cz - 1.11; BOX[5] = cz - .89; }
  else return false;
  BOX[0] -= PAD; BOX[2] -= PAD; BOX[4] -= PAD; BOX[1] += PAD; BOX[3] += PAD; BOX[5] += PAD;
  return true;
}
function slab(o, d, lo, hi) { // narrows SLAB [t0, t1]; false when empty
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  let a = (lo - o) / d, b = (hi - o) / d; if (a > b) { const s = a; a = b; b = s; }
  if (a > SLAB[0]) SLAB[0] = a; if (b < SLAB[1]) SLAB[1] = b;
  return SLAB[0] <= SLAB[1];
}
function segHits(ax, ay, az, bx, by, bz) {
  SLAB[0] = 0; SLAB[1] = 1;
  return slab(ax, bx - ax, BOX[0], BOX[1]) && slab(ay, by - ay, BOX[2], BOX[3]) && slab(az, bz - az, BOX[4], BOX[5]);
}
function blockedXYZ(pieces, ax, ay, az, bx, by, bz) {
  if (!Array.isArray(pieces)) return false;
  for (let i = 0; i < pieces.length; i++) {
    if (!pieceBox(pieces[i])) continue;
    for (let k = 0; k < BODY_DROPS.length; k++) { const dy = BODY_DROPS[k]; if (segHits(ax, ay - dy, az, bx, by - dy, bz)) return true; }
  }
  return false;
}
/** A, B = {x, y, z} wheel points, y relative to the deck. True if a piece box (padded) crosses the wheel line or the body below it. */
export function lineBlocked(pieces, A, B) { return blockedXYZ(pieces, A.x, A.y, A.z, B.x, B.y, B.z); }

/** Link check in order: same, post, short/long, full, blocked. An existing pair is ok (linked:true): zip.link unlinks it. */
export function canLink(st, decor, pieces, ax, az, bx, bz) {
  if (ax === bx && az === bz) return { ok: false, reason: 'same' };
  const ta = postAt(decor, ax, az), tb = postAt(decor, bx, bz);
  if (!ta || !tb) return { ok: false, reason: 'post' };
  const len = tileLen(ax, az, bx, bz);
  if (len < MIN_LEN) return { ok: false, reason: 'short' };
  if (len > MAX_LEN) return { ok: false, reason: 'long' };
  const l = st && Array.isArray(st.l) ? st.l : [];
  const [cax, caz, cbx, cbz] = canon(CAN, ax, az, bx, bz);
  if (pairIndex(l, cax, caz, cbx, cbz) >= 0) return { ok: true, len, cost: ropeCost(len), linked: true };
  if (countAt(l, ax, az) >= MAX_PER_POST || countAt(l, bx, bz) >= MAX_PER_POST || l.length >= MAX_LINES) return { ok: false, reason: 'full' };
  if (blockedXYZ(pieces, ax * 2, POSTS[ta], az * 2, bx * 2, POSTS[tb], bz * 2)) return { ok: false, reason: 'blocked' };
  return { ok: true, len, cost: ropeCost(len) };
}

/** World wheel points of line i (deckY recomputed by the caller every frame) -> out {ax,ay,az,bx,by,bz,l3} or null. */
export function lineWorld(st, i, decor, deckY, out) {
  const e = st && Array.isArray(st.l) ? st.l[i] : null; if (!e) return null;
  const ta = postAt(decor, e[0], e[1]), tb = postAt(decor, e[2], e[3]); if (!ta || !tb) return null;
  const y = Number.isFinite(deckY) ? deckY : 0;
  out.ax = e[0] * 2; out.ay = y + POSTS[ta]; out.az = e[1] * 2;
  out.bx = e[2] * 2; out.by = y + POSTS[tb]; out.bz = e[3] * 2;
  const dx = out.bx - out.ax, dy = out.by - out.ay, dz = out.bz - out.az; out.l3 = Math.sqrt(dx * dx + dy * dy + dz * dz); // no Math.hypot: it allocates per call
  return out;
}
const l3Of = ln => (Number.isFinite(ln.l3) ? ln.l3 : Math.sqrt((ln.bx - ln.ax) ** 2 + (ln.by - ln.ay) ** 2 + (ln.bz - ln.az) ** 2));

/** Advance the rider r = {t, v, dir} along ln by dt (clamped to .25, substeps <= .05). -> 'ride' | 'end'.
 *  The ride ends END_STOP before the wheel ahead (ENDPAD before the one behind). */
export function stepRide(r, ln, dt, inp) {
  const dir = r.dir < 0 ? -1 : 1, L3 = l3Of(ln), lo = dir < 0 ? END_STOP : ENDPAD, hi = L3 - (dir > 0 ? END_STOP : ENDPAD);
  if (!(hi > lo)) { r.t = clamp(r.t, 0, L3); return 'end'; }
  const d = Number.isFinite(dt) ? clamp(dt, 0, MAX_DT) : 0;
  const n = Math.max(1, Math.ceil(d / SUB - 1e-9)), h = d / n;
  const uy = (ln.by - ln.ay) / L3 * dir;
  const fw = inp && Number.isFinite(inp.forward) ? clamp(inp.forward, -1, 1) : 0;
  for (let i = 0; i < n; i++) {
    const a = -G * uy - DRAG * r.v + PUSH * fw;
    r.v = clamp(r.v + a * h, V_MIN, V_MAX);
    r.t += dir * r.v * h;
    if (r.t < lo) { r.t = lo; return 'end'; }
    if (r.t > hi) { r.t = hi; return 'end'; }
  }
  return 'ride';
}

/** Eye pose of the rider -> out {x,y,z,vx,vy,vz}: point at t on the line, HANG below it; velocity along the line. */
export function riderPose(r, ln, out) {
  const L3 = l3Of(ln), f = L3 > 0 ? r.t / L3 : 0, dir = r.dir < 0 ? -1 : 1, k = L3 > 0 ? dir * r.v / L3 : 0;
  out.x = ln.ax + (ln.bx - ln.ax) * f; out.y = ln.ay + (ln.by - ln.ay) * f - HANG; out.z = ln.az + (ln.bz - ln.az) * f;
  out.vx = (ln.bx - ln.ax) * k; out.vy = (ln.by - ln.ay) * k; out.vz = (ln.bz - ln.az) * k;
  return out;
}

const NEAR = { s: 0, off: Infinity, along: 0 };
/** Closest approach of the ray o + d*s (s >= 0) to segment A-B -> {s: metres from A, off: gap, along: ray distance}. Reuses `out`. */
export function nearestOnLine(ln, ox, oy, oz, dx, dy, dz, out = NEAR) {
  const ex = ln.bx - ln.ax, ey = ln.by - ln.ay, ez = ln.bz - ln.az;
  const rx = ox - ln.ax, ry = oy - ln.ay, rz = oz - ln.az;
  const a = dx * dx + dy * dy + dz * dz, e = ex * ex + ey * ey + ez * ez;
  if (a < 1e-12 || e < 1e-12) { out.s = 0; out.off = Infinity; out.along = 0; return out; }
  const b = dx * ex + dy * ey + dz * ez, c = dx * rx + dy * ry + dz * rz, f = ex * rx + ey * ry + ez * rz;
  const den = a * e - b * b;
  let s = den > 1e-12 ? Math.max(0, (b * f - c * e) / den) : 0;
  let u = (b * s + f) / e;
  if (u < 0) { u = 0; s = Math.max(0, -c / a); } else if (u > 1) { u = 1; s = Math.max(0, (b - c) / a); }
  const px = ox + dx * s - (ln.ax + ex * u), py = oy + dy * s - (ln.ay + ey * u), pz = oz + dz * s - (ln.az + ez * u);
  out.s = u * Math.sqrt(e); out.off = Math.sqrt(px * px + py * py + pz * pz); out.along = s * Math.sqrt(a);
  return out;
}

// ------------------------------------------------------------------ the content module

export function createZipline(ctx) {
  const T = ctx.T;
  const session = Math.random().toString(36).slice(2, 10);
  let st = cleanZip(undefined, null); st.s = session;
  let cache = null, cacheSt = null, cacheR = -1, netR = -1, netS = null, netUndef = false, hostHasZip = true;
  let pending = null; // {x, z, at} first post picked for a link (local, never saved)
  let pruneDecor = null, pruneLen = -1;
  let ropes = null, ropeScene = null, hSt = null, hR = -1, hDecor = null, hLen = -1;
  const hA = new Float32Array(MAX_LINES), hB = new Float32Array(MAX_LINES);
  const R = { on: false, k0: 0, k1: 0, k2: 0, k3: 0, t: 0, v: 0, dir: 1, prevJump: false, phys: null, lx: 0, ly: 0, lz: 0, fresh: true, debug: false, pc: null, pn: -1 };
  const ln = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, l3: 0 }, pose = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  const inp = { forward: 0, jump: false, crouch: false }, ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: -1 }, near = { s: 0, off: 0, along: 0 };
  const scratch = T ? new T.Vector3() : null;

  const oldHost = () => ctx.role === 'guest' && !hostHasZip;
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);
  const pieces = () => (Array.isArray(ctx.world?.pieces) ? ctx.world.pieces : []);
  const holding = () => ctx.heldKind?.() === 'glidehandle';
  const deckY = () => { const y = ctx.deckY?.(); return Number.isFinite(y) ? y : 0; };
  const num = n => (ctx.esc ? ctx.esc(String(n)) : String(n));
  const say = (s, ms) => ctx.notice?.(s, ms);

  function setRay(aim) {
    const cam = ctx.camera; if (!cam) return false;
    ray.ox = cam.position.x; ray.oy = cam.position.y; ray.oz = cam.position.z;
    if (aim && aim.dir) { ray.dx = aim.dir.x; ray.dy = aim.dir.y; ray.dz = aim.dir.z; }
    else if (scratch && cam.getWorldDirection) { cam.getWorldDirection(scratch); ray.dx = scratch.x; ray.dy = scratch.y; ray.dz = scratch.z; }
    else return false;
    return true;
  }

  // Nearest glide post along the view ray within reach; aim point at mid-mast (deckY + 1.4).
  function target(aim) {
    const w = ctx.world, p = ctx.physics; if (!w || !p || !Array.isArray(w.decor) || !setRay(aim)) return null;
    let best = null, bestScore = Infinity;
    const cy = deckY() + 1.4;
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (!d || (d.type !== 'glidepost' && d.type !== 'glidestep')) continue;
      const cx = d.x * 2, cz = d.z * 2;
      const qx = p.x - cx, qz = p.z - cz; if (qx * qx + qz * qz > REACH * REACH) continue;
      const vx = cx - ray.ox, vy = cy - ray.oy, vz = cz - ray.oz, along = vx * ray.dx + vy * ray.dy + vz * ray.dz;
      if (along <= 0) continue;
      const ex = vx - ray.dx * along, ey = vy - ray.dy * along, ez = vz - ray.dz * along;
      const off = Math.sqrt(ex * ex + ez * ez) + Math.max(0, Math.abs(ey) - 1.6); // a tall thin mast: forgiving up and down
      if (off > .85) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  // Line under the aim ray: index, with `near` filled; -1 if none.
  function lineTarget(aim) {
    if (!st.l.length || !setRay(aim)) return -1;
    const d = decor(), y = deckY();
    let best = -1, bestOff = Infinity;
    for (let i = 0; i < st.l.length; i++) {
      if (!lineWorld(st, i, d, y, ln)) continue;
      nearestOnLine(ln, ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, NEAR);
      if (NEAR.off >= .6 || NEAR.off >= bestOff) continue;
      const u = ln.l3 > 0 ? NEAR.s / ln.l3 : 0;
      const px = ln.ax + (ln.bx - ln.ax) * u - ray.ox, py = ln.ay + (ln.by - ln.ay) * u - ray.oy, pz = ln.az + (ln.bz - ln.az) * u - ray.oz;
      if (px * px + py * py + pz * pz > LINE_REACH * LINE_REACH) continue;
      best = i; bestOff = NEAR.off; near.s = NEAR.s; near.off = NEAR.off; near.along = NEAR.along;
    }
    return best;
  }

  const findRide = () => pairIndex(st.l, R.k0, R.k1, R.k2, R.k3);

  function dismount(physics, end) {
    R.on = false;
    if (!physics) return;
    if (end) { physics.vx = pose.vx * END_CARRY; physics.vz = pose.vz * END_CARRY; physics.vy = HOP_VY; }
    else { physics.vx = pose.vx; physics.vz = pose.vz; physics.vy = DROP_VY; }
    physics.grounded = false;
    if ('verticalSpeed' in physics) physics.verticalSpeed = physics.vy;
    if ('_prevJump' in physics) physics._prevJump = inp.jump; // Space that let go must not queue a jump
    if ('_jumpBuffer' in physics) physics._jumpBuffer = 0;
  }

  // Hook onto line i at metres t with direction dir. Checks pieces built since the link.
  function mount(i, t, dir, physics, debug = false) {
    if (!physics || !lineWorld(st, i, decor(), deckY(), ln)) return false;
    const e = st.l[i];
    if (!debug && blockedXYZ(pieces(), ln.ax, ln.ay - deckY(), ln.az, ln.bx, ln.by - deckY(), ln.bz)) { say(TEXT.inway); return false; }
    R.on = true; R.k0 = e[0]; R.k1 = e[1]; R.k2 = e[2]; R.k3 = e[3];
    R.t = clamp(t, ENDPAD, Math.max(ENDPAD, ln.l3 - ENDPAD)); R.dir = dir < 0 ? -1 : 1;
    const ux = (ln.bx - ln.ax) / ln.l3, uz = (ln.bz - ln.az) / ln.l3;
    const hv = Math.abs((Number(physics.vx) || 0) * ux + (Number(physics.vz) || 0) * uz);
    R.v = clamp(Math.max(V_START, hv), V_MIN, V_MAX);
    R.prevJump = inp.jump; R.phys = physics; R.fresh = true; R.debug = !!debug; R.pc = pieces(); R.pn = R.pc.length;
    riderPose(R, ln, pose);
    pending = null;
    say(TEXT.letgo, 2400);
    return true;
  }

  function mountFromPost(d, physics) {
    const idx = linesAt(st, d.x, d.z); if (!idx.length) return false;
    let hx = ray.dx, hz = ray.dz; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    let best = -1, bestDot = -Infinity, fromA = true;
    for (const i of idx) {
      const e = st.l[i], a = e[0] === d.x && e[1] === d.z;
      const ox = (a ? e[2] - e[0] : e[0] - e[2]), oz = (a ? e[3] - e[1] : e[1] - e[3]), ol = Math.hypot(ox, oz) || 1;
      const dot = (ox * hx + oz * hz) / ol;
      if (dot > bestDot) { bestDot = dot; best = i; fromA = a; }
    }
    if (best < 0 || !lineWorld(st, best, decor(), deckY(), ln)) return false;
    return mount(best, fromA ? ENDPAD : ln.l3 - ENDPAD, fromA ? 1 : -1, physics);
  }

  function canMount(physics) {
    return !!physics && !physics.swimming && !physics.climbing && !physics._climb && !ctx.uiOpen?.() && !oldHost(); // mid-clamber: the climb would resume after dismount
  }

  // Per-frame ride hook (game.js movePlayer). Returns true while riding so PlayerPhysics is skipped.
  function ride(dt, physics, input) {
    if (input) { inp.forward = Number(input.forward) || 0; inp.jump = !!input.jump; inp.crouch = !!input.crouch; }
    if (!R.on) return false;
    if (!physics || physics !== R.phys) { R.on = false; return false; }
    if (!R.debug && !holding()) { dismount(physics, false); return false; }
    const i = findRide();
    if (i < 0 || !lineWorld(st, i, decor(), deckY(), ln)) { dismount(physics, false); return false; }
    const mx = physics.x - R.lx, my = physics.y - R.ly, mz = physics.z - R.lz;
    if (!R.fresh && mx * mx + my * my + mz * mz > 1) { dismount(physics, false); return false; }
    const pc = pieces();
    if (pc !== R.pc || pc.length !== R.pn) { // a piece built (or a host state) while riding: a wall across the line lets go
      R.pc = pc; R.pn = pc.length;
      if (!R.debug && blockedXYZ(pc, ln.ax, ln.ay - deckY(), ln.az, ln.bx, ln.by - deckY(), ln.bz)) { say(TEXT.inway); dismount(physics, false); return false; }
    }
    if (inp.jump && !R.prevJump) { R.prevJump = true; dismount(physics, false); return false; }
    R.prevJump = inp.jump;
    const res = stepRide(R, ln, dt, inp);
    riderPose(R, ln, pose);
    physics.x = pose.x; physics.y = pose.y; physics.z = pose.z;
    physics.vx = pose.vx; physics.vz = pose.vz; physics.vy = 0;
    physics.grounded = false; physics.swimming = false;
    R.lx = pose.x; R.ly = pose.y; R.lz = pose.z; R.fresh = false;
    if (res === 'end') { dismount(physics, true); return false; }
    return true;
  }

  // ---- visuals: one InstancedMesh of rope cylinders for every line, rewritten in place each frame ----
  function refreshHeights() {
    const d = decor();
    if (hSt === st && hR === st.r && hDecor === d && hLen === d.length) return;
    hSt = st; hR = st.r; hDecor = d; hLen = d.length;
    for (let i = 0; i < st.l.length && i < MAX_LINES; i++) {
      const e = st.l[i], a = postAt(d, e[0], e[1]), b = postAt(d, e[2], e[3]);
      hA[i] = a && b ? POSTS[a] : NaN; hB[i] = a && b ? POSTS[b] : NaN;
    }
  }
  function paint() {
    const scene = ctx.scene; if (!scene) return;
    if (!ropes) ropes = createRopeLines(T, MAX_LINES);
    if (ropeScene !== scene) { ropes.removeFromParent?.(); scene.add(ropes); ropeScene = scene; }
    refreshHeights();
    const raft = ctx.raft; let y = deckY();
    if (raft && raft.position && raft.quaternion) { ropes.position.copy(raft.position); ropes.quaternion.copy(raft.quaternion); y -= raft.position.y; } // posts tilt with the raft: so do the ropes
    let n = 0;
    for (let i = 0; i < st.l.length && i < MAX_LINES; i++) {
      if (!Number.isFinite(hA[i])) continue;
      const e = st.l[i];
      ropes.userData.set(n++, e[0] * 2, y + hA[i], e[1] * 2, e[2] * 2, y + hB[i], e[3] * 2);
    }
    ropes.count = n;
    ropes.instanceMatrix.needsUpdate = true;
    ropes.visible = n > 0;
  }

  function hostPrune() {
    if (ctx.role === 'guest') return;
    const d = ctx.world?.decor; if (!Array.isArray(d)) return;
    if (d === pruneDecor && d.length === pruneLen) return;
    pruneDecor = d; pruneLen = d.length;
    const c = cleanZip(st, d);
    if (c.l.length !== st.l.length) { st.l = c.l; st.r++; }
  }

  function load(data, from) {
    if (from === 'net') {
      if (data && typeof data === 'object' && data.r === netR && data.s === netS) return; // unchanged host state
      if (data === undefined && netUndef) return;
      netUndef = data === undefined; hostHasZip = data !== undefined;
      st = cleanZip(data, ctx.world?.decor);
      netR = data && typeof data === 'object' ? data.r : -1; netS = data && typeof data === 'object' ? data.s : null;
      return;
    }
    netR = -1; netS = null; netUndef = false; hostHasZip = true; pending = null; R.on = false;
    st = cleanZip(data, ctx.world?.decor);
    st.s = session; st.r++;
    pruneDecor = null;
  }

  function serialize() {
    if (cache && cacheSt === st && cacheR === st.r) return cache;
    cache = JSON.parse(JSON.stringify(st)); cacheSt = st; cacheR = st.r;
    return cache;
  }

  // Cached canLink for the prompt (it runs every frame while a link is pending).
  const memo = { r: null, p: null, pn: -1, d: null, dn: -1, st: null, sr: -1, ax: 0, az: 0, bx: 0, bz: 0 };
  function linkCheck(ax, az, bx, bz) {
    const p = pieces(), d = decor(), m = memo;
    if (m.r && m.p === p && m.pn === p.length && m.d === d && m.dn === d.length && m.st === st && m.sr === st.r && m.ax === ax && m.az === az && m.bx === bx && m.bz === bz) return m.r;
    m.r = canLink(st, d, p, ax, az, bx, bz); m.p = p; m.pn = p.length; m.d = d; m.dn = d.length; m.st = st; m.sr = st.r; m.ax = ax; m.az = az; m.bx = bx; m.bz = bz;
    return m.r;
  }

  function prompt(aim) {
    if (R.on || ctx.physics?.mount) return null; // on another ride (driftboard): its own E prompt applies
    const t = target(aim);
    if (!holding()) return t ? TEXT.nohandle : null;
    if (oldHost()) return t ? OLD_HOST : null;
    if (t && pending) {
      if (t.x === pending.x && t.z === pending.z) return '<kbd>E</kbd>Cancel';
      const c = linkCheck(pending.x, pending.z, t.x, t.z);
      if (!c.ok) return TEXT[c.reason] ?? null;
      if (c.linked) return `<kbd>E</kbd>Unlink (get ${num(c.cost)} rope back)`;
      const have = ctx.localBag?.()?.count?.('rope') ?? 0;
      if (have < c.cost) return `Needs ${num(c.cost)} rope`;
      return `<kbd>E</kbd>Link line here (${num(c.cost)} rope)`;
    }
    if (t) return countAt(st.l, t.x, t.z) ? '<kbd>E</kbd>Glide · <kbd>C</kbd>+<kbd>E</kbd> new line' : '<kbd>E</kbd>Start a glide line';
    if (!pending && lineTarget(aim) >= 0) return '<kbd>E</kbd>Hook on';
    return null;
  }

  function interact(aim) {
    if (R.on) return true; // E does nothing on the line (Space lets go)
    if (!holding() || ctx.physics?.mount) return false; // riding a driftboard: E is the board's (hooking on dragged the board along the line)
    const t = target(aim);
    if (oldHost()) { if (t) { say(OLD_HOST, 2400); return true; } return false; }
    const physics = ctx.physics;
    if (t) {
      if (pending) {
        if (t.x === pending.x && t.z === pending.z) { pending = null; say(TEXT.cancel); return true; }
        const a = pending; pending = null;
        ctx.action?.({ kind: 'zip.link', ax: a.x, az: a.z, bx: t.x, bz: t.z });
        return true;
      }
      if (countAt(st.l, t.x, t.z) && !inp.crouch) {
        if (canMount(physics)) mountFromPost(t, physics);
        return true;
      }
      pending = { x: t.x, z: t.z, at: ctx.elapsed ?? 0 };
      say(TEXT.next);
      return true;
    }
    if (pending) return false;
    const i = lineTarget(aim); if (i < 0) return false;
    if (!canMount(physics) || !lineWorld(st, i, decor(), deckY(), ln)) return true;
    const dir = (ray.dx * (ln.bx - ln.ax) + ray.dz * (ln.bz - ln.az)) < 0 ? -1 : 1;
    mount(i, near.s, dir, physics);
    return true;
  }

  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('zip.')) return false;
    if (a.kind !== 'zip.link' || !isInt(a.ax) || !isInt(a.az) || !isInt(a.bx) || !isInt(a.bz)) return true;
    const pose = actor === 'guest' ? ctx.other : ctx.physics;
    if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z) || Math.hypot(a.bx * 2 - pose.x, a.bz * 2 - pose.z) > REACH + HOST_SLACK) return true;
    if (!bag || typeof bag.count !== 'function' || !(bag.count('glidehandle') > 0)) return true;
    const [ax, az, bx, bz] = canon(CAN, a.ax, a.az, a.bx, a.bz);
    const idx = pairIndex(st.l, ax, az, bx, bz);
    if (idx >= 0) { // unlink: atomic refund or nothing
      const n = ropeCost(tileLen(ax, az, bx, bz));
      if (typeof bag.snapshot !== 'function') return true;
      const s = new bag.constructor(bag.snapshot());
      if (s.add('rope', n) !== 0) { ctx.emit?.({ kind: 'full', text: TEXT.bagfull }, actor); return true; }
      for (let i = 0; i < s.slots.length; i++) bag.slots[i] = s.slots[i];
      if (typeof bag.version === 'number') bag.version++;
      st.l.splice(idx, 1); st.r++;
      ctx.emit?.({ kind: 'loot', text: `Line taken down · + ${n} rope`, loot: { rope: n } }, actor);
      return true;
    }
    const c = canLink(st, decor(), pieces(), ax, az, bx, bz);
    if (!c.ok) { ctx.emit?.({ kind: 'notice', text: TEXT[c.reason] }, actor); return true; }
    if (bag.count('rope') < c.cost) { ctx.emit?.({ kind: 'notice', text: `Needs ${c.cost} rope` }, actor); return true; }
    if (!bag.remove('rope', c.cost)) return true;
    st.l.push([ax, az, bx, bz]); st.r++;
    ctx.emit?.({ kind: 'build', text: `Glide line strung · − ${c.cost} rope` }, actor);
    return true;
  }

  return {
    name: 'zipline',
    load,
    serialize,
    ride,
    riding: () => R.on,
    update(dt) {
      hostPrune();
      if (pending && (!holding() || (ctx.elapsed ?? 0) - pending.at > PENDING_S)) pending = null;
      if (T) paint();
      if (R.on && ctx.running !== false && ctx.camera) { // gentle hang sway on top of game.js' camera
        const k = (Number(ctx.options?.cameraMotion) || 0) * Math.min(1, R.v / 4), el = ctx.elapsed ?? 0;
        ctx.camera.rotation.z += Math.sin(el * 1.8) * .025 * k;
        ctx.camera.position.y += Math.sin(el * 3.1) * .015 * k;
      }
    },
    prompt,
    interact,
    action,
    decorModel(type) {
      if (!T) return null;
      if (type === 'glidepost') return createGlidePost(T, POSTS.glidepost, 'craft_glidepost');
      if (type === 'glidestep') return createGlidePost(T, POSTS.glidestep, 'craft_glidestep');
      return null;
    },
    debug: {
      state: () => JSON.parse(JSON.stringify(st)),
      lines: () => st.l.map((e, i) => { const w = lineWorld(st, i, decor(), deckY(), {}); return { i, a: [e[0], e[1]], b: [e[2], e[3]], len: tileLen(e[0], e[1], e[2], e[3]), ln: w }; }),
      target: aim => target(aim),
      /** Host QA: put a glide post on a free raft tile. */
      place(type, x, z) {
        const w = ctx.world;
        if (ctx.role === 'guest' || !(type in POSTS) || !isInt(x) || !isInt(z) || !w) return false;
        if (!w.tiles?.some(t => t[0] === x && t[1] === z) || decor().some(d => d.x === x && d.z === z)) return false;
        w.decor.push({ type, x, z }); ctx.rebuildRaft?.(); return true;
      },
      /** Host QA: link two posts without a bag (canLink still applies). */
      link(ax, az, bx, bz) {
        if (ctx.role === 'guest') return { ok: false, reason: 'guest' };
        hostPrune();
        const c = canLink(st, decor(), pieces(), ax, az, bx, bz);
        if (c.ok && !c.linked) { const k = canon(CAN, ax, az, bx, bz); st.l.push([k[0], k[1], k[2], k[3]]); st.r++; }
        return c;
      },
      /** Mount the local player on line i at fraction t of its span (screenshots); stop() lets go. */
      ride(i = 0, t = 0.1, dir = 1) {
        const p = ctx.physics; if (!p || !lineWorld(st, i, decor(), deckY(), ln)) return false;
        const span = Math.max(0, ln.l3 - ENDPAD - END_STOP);
        return mount(i, (dir < 0 ? END_STOP : ENDPAD) + clamp(Number(t) || 0, 0, 1) * span, dir, p, true);
      },
      stop() { if (!R.on) return false; dismount(R.phys, false); return true; },
      pose: () => ({ riding: R.on, t: R.t, v: R.v, dir: R.dir, line: R.on ? findRide() : -1 }),
    },
    dispose() { if (ropes) { ropes.removeFromParent?.(); ropes.geometry.dispose(); ropes.material.dispose(); ropes = null; ropeScene = null; } R.on = false; },
  };
}

