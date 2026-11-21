// Driftboard (paddleboard) pure logic (docs/specs/paddleboard.md). No THREE, no DOM, no side effects.
// Board pose: x/z raft-local metres, h = heading with the nose along (sin h, cos h) (a THREE rotation.y of h).
// The game's camera yaw looks along (-sin yaw, -cos yaw), so the heading that faces the view is yaw + PI
// (headingOf). stepRide takes the camera yaw in inp.yaw and steers the nose toward the view.
// Tiles are [tx, tz] pairs, each a 2 m square centred on (tx*2, tz*2), like PlayerPhysics.

export const BOARD = Object.freeze({
  REACH: 3, LAUNCH_EDGE: 3, MAX_BOARDS: 4, R: .45, HALF_LEN: 1.1, TOP: .12, EYE: 1.6, CRUISE: 3.6, SPRINT: 4.6, BACK: 1,
  SCULL: .8, TURN: 1.6, STROKE: .55, STROKE_FAST: .42, DRAG: .9, SLIP: 4, TETHER_SOFT: 38, TETHER_HARD: 45, TETHER_PUSH: 2,
  HOME: .4, AUTO_TIE: 1.5, STEP_OFF: 1.2,
  // derived / extra tuning (not in the spec table)
  LAUNCH_PLAYER: 4,  // max launch distance from the player (m)
  CLAMP: 45,         // |x|, |z| clamp for saved poses
  BRAKE: 2.5,        // S deceleration (m/s^2)
  IDLE_FRICTION: .15,// extra coast deceleration so an idle board comes to rest (m/s^2)
  KEEP_LAT: .6,      // share of forward speed that turns into side slip on a heading change
  TIE_GAP: 1.2,      // a second tied board needs this much room
});
const B = BOARD, TILE = 2, HALF = 1, PI = Math.PI, TAU = PI * 2;
// Thrust k*sin(PI*ph) averages 2k/PI over a stroke; with v' = a - DRAG*v the steady speed is 2k/(PI*DRAG).
export const THRUST = Object.freeze({ cruise: B.CRUISE * B.DRAG * PI / 2, sprint: B.SPRINT * B.DRAG * PI / 2 });

const fin = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isTile = t => Array.isArray(t) && fin(t[0]) && fin(t[1]);

/** Wrap into (-PI, PI]. */
export function wrapAngle(a) {
  if (!fin(a)) return 0;
  a = ((a + PI) % TAU + TAU) % TAU - PI; // [-PI, PI)
  return a === -PI ? PI : a;
}
/** Shortest signed turn from a to b. */
export const angDiff = (a, b) => wrapAngle(b - a);
/** Board heading that faces along the camera yaw. */
export const headingOf = yaw => wrapAngle(yaw + PI);

// ------------------------------------------------------------------ save slice

const S_OK = ['tied', 'adrift'], R_OK = ['host', 'guest'];
export function cleanSlice(v, from) {
  const out = { v: 1, n: 1, boards: [] };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  const list = Array.isArray(v.boards) ? v.boards : [], ids = new Set();
  let maxId = 0;
  for (const b of list) {
    if (out.boards.length >= B.MAX_BOARDS) break;
    if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
    if (!Number.isInteger(b.id) || b.id < 1 || ids.has(b.id)) continue;
    if (!fin(b.x) || !fin(b.z) || !fin(b.h)) continue;
    let s = S_OK.includes(b.s) ? b.s : 'adrift', r = from === 'net' && R_OK.includes(b.r) ? b.r : null;
    if (from !== 'net' && R_OK.includes(b.r)) s = 'adrift'; // a ridden board is left adrift where the rider was
    ids.add(b.id); if (b.id > maxId) maxId = b.id;
    out.boards.push({ id: b.id, x: clamp(b.x, -B.CLAMP, B.CLAMP), z: clamp(b.z, -B.CLAMP, B.CLAMP), h: wrapAngle(b.h), s, r });
  }
  out.n = Math.max(Number.isInteger(v.n) && v.n >= 1 ? v.n : 1, maxId + 1);
  return out;
}

// ------------------------------------------------------------------ raft geometry

/** Distance from (x,z) to the closest tile square (0 inside), with that tile and point. Infinity if no tiles. */
export function nearestTile(tiles, x, z, out) {
  out.d = Infinity; out.tx = 0; out.tz = 0; out.px = x; out.pz = z;
  if (!Array.isArray(tiles)) return out;
  let best = Infinity;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]; if (!isTile(t)) continue;
    const cx = t[0] * TILE, cz = t[1] * TILE;
    const px = clamp(x, cx - HALF, cx + HALF), pz = clamp(z, cz - HALF, cz + HALF);
    const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d2 < best) { best = d2; out.tx = t[0]; out.tz = t[1]; out.px = px; out.pz = pz; }
  }
  if (best < Infinity) out.d = Math.sqrt(best);
  return out;
}

function hasTile(tiles, tx, tz) {
  for (let i = 0; i < tiles.length; i++) { const t = tiles[i]; if (isTile(t) && t[0] === tx && t[1] === tz) return true; }
  return false;
}

// Push one circle (cx0,cz0,r) out of every tile square; returns the push (dx,dz) in pc and the last normal.
const pc = { dx: 0, dz: 0, nx: 0, nz: 0, hit: false };
function pushCircle(tiles, x, z, r) {
  pc.dx = 0; pc.dz = 0; pc.hit = false;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i]; if (!isTile(t)) continue;
      const cx = t[0] * TILE, cz = t[1] * TILE, qx = x + pc.dx, qz = z + pc.dz;
      if (Math.abs(qx - cx) >= HALF + r || Math.abs(qz - cz) >= HALF + r) continue;
      const px = clamp(qx, cx - HALF, cx + HALF), pz = clamp(qz, cz - HALF, cz + HALF);
      let dx = qx - px, dz = qz - pz, d = Math.sqrt(dx * dx + dz * dz), ux, uz, push;
      if (d >= r) continue;
      if (d < 1e-6) { // centre inside the square: leave by the nearest outer side (no neighbour tile there)
        const sx = qx >= cx ? 1 : -1, sz = qz >= cz ? 1 : -1;
        let ex = HALF - Math.abs(qx - cx), ez = HALF - Math.abs(qz - cz);
        if (hasTile(tiles, t[0] + sx, t[1])) ex += 2 * TILE; // through a neighbour: a last resort
        if (hasTile(tiles, t[0], t[1] + sz)) ez += 2 * TILE;
        if (ex < ez) { ux = sx; uz = 0; push = Math.min(ex, HALF) + r; } else { ux = 0; uz = sz; push = Math.min(ez, HALF) + r; }
      } else { ux = dx / d; uz = dz / d; push = r - d; }
      pc.dx += ux * push; pc.dz += uz * push; pc.nx = ux; pc.nz = uz; pc.hit = true;
    }
  }
  return pc;
}

/** Push the board (rider circle + nose/tail circles, radius R) out of the tiles. out {x,z,nx,nz}; true if moved. */
export function pushOut(tiles, b, out) {
  out.x = b.x; out.z = b.z; out.nx = 0; out.nz = 0;
  if (!Array.isArray(tiles) || !tiles.length) return false;
  const fx = Math.sin(b.h) * B.HALF_LEN, fz = Math.cos(b.h) * B.HALF_LEN;
  let moved = false, sx = 0, sz = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let k = -1; k <= 1; k++) {
      const p = pushCircle(tiles, out.x + fx * k, out.z + fz * k, B.R);
      if (!p.hit) continue;
      out.x += p.dx; out.z += p.dz; sx += p.dx; sz += p.dz; moved = true;
    }
  }
  if (moved) { const d = Math.sqrt(sx * sx + sz * sz); if (d > 1e-9) { out.nx = sx / d; out.nz = sz / d; } }
  return moved;
}

const SIDES = [1, 0, -1, 0, 0, 1, 0, -1];
/** Tie spot at the nearest free outer tile edge. out {x,z,h}; false if there are no tiles. */
export function tieSpot(tiles, x, z, boards, skipId, out) {
  if (!Array.isArray(tiles)) return false;
  let best = Infinity, any = Infinity, found = false;
  for (let pass = 0; pass < 2 && !found; pass++) { // pass 0: free edges only; pass 1: any edge
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i]; if (!isTile(t)) continue;
      const cx = t[0] * TILE, cz = t[1] * TILE;
      for (let s = 0; s < 8; s += 2) {
        const nx = SIDES[s], nz = SIDES[s + 1];
        if (hasTile(tiles, t[0] + nx, t[1] + nz)) continue;
        // distance from (x,z) to this edge segment
        const ex = cx + nx * HALF, ez = cz + nz * HALF;
        const qx = nx ? ex : clamp(x, cx - HALF, cx + HALF), qz = nz ? ez : clamp(z, cz - HALF, cz + HALF);
        const d2 = (x - qx) * (x - qx) + (z - qz) * (z - qz);
        const px = ex + nx * (B.R + .05), pz = ez + nz * (B.R + .05);
        if (pass === 0 && boards && taken(boards, skipId, px, pz)) continue;
        if (d2 < (pass === 0 ? best : any)) {
          if (pass === 0) best = d2; else any = d2;
          out.x = px; out.z = pz; out.h = nx ? 0 : PI / 2; found = true;
        }
      }
    }
  }
  return found;
}
function taken(boards, skipId, x, z) {
  for (let i = 0; i < boards.length; i++) {
    const o = boards[i];
    if (!o || o.id === skipId || o.s !== 'tied' || o.r) continue;
    const dx = o.x - x, dz = o.z - z;
    if (dx * dx + dz * dz < B.TIE_GAP * B.TIE_GAP) return true;
  }
  return false;
}

/** Standing spot just inside the tile edge nearest (x,z), like PlayerPhysics._beginClimb. out {x,z}. */
const nt = { d: 0, tx: 0, tz: 0, px: 0, pz: 0 };
export function deckSpot(tiles, x, z, out) {
  nearestTile(tiles, x, z, nt);
  if (nt.d === Infinity) return false;
  const cx = nt.tx * TILE, cz = nt.tz * TILE, lim = HALF - .3;
  let dx = nt.px - x, dz = nt.pz - z, d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-6) { dx = cx - x; dz = cz - z; d = Math.sqrt(dx * dx + dz * dz) || 1; }
  out.x = clamp(nt.px + dx / d * .45, cx - lim, cx + lim);
  out.z = clamp(nt.pz + dz / d * .45, cz - lim, cz + lim);
  return true;
}

/** '' when (x,z) is a valid launch point for a player at (px,pz), else a reason. */
export function canLaunch(tiles, px, pz, x, z) {
  if (!fin(x) || !fin(z)) return 'Point at the water beside the raft';
  nearestTile(tiles, x, z, nt);
  if (nt.d === 0) return 'Point at the water beside the raft';
  if (nt.d > B.LAUNCH_EDGE) return 'Launch it closer to the raft';
  if (!fin(px) || !fin(pz) || Math.hypot(x - px, z - pz) > B.LAUNCH_PLAYER) return 'Try a spot a little closer';
  return '';
}

// ------------------------------------------------------------------ ride

/** A fresh ride state (allocate once and reuse). */
export const rideState = () => ({ x: 0, z: 0, h: 0, v: 0, lat: 0, ph: 0, side: 1, wraps: 0 });

/**
 * Advance the stroke model. st {x,z,h,v,lat,ph,side}; inp {forward,strafe,sprint,yaw (camera yaw)}.
 * st.wraps counts stroke wraps this call (for the splash sound). No allocation.
 */
export function stepRide(st, inp, dt) {
  st.wraps = 0;
  if (!(dt > 0)) return st;
  dt = Math.min(dt, .25);
  const n = Math.ceil(dt / .05), h = dt / n;
  const fwd = inp && fin(inp.forward) ? clamp(inp.forward, -1, 1) : 0, strafe = inp && fin(inp.strafe) ? clamp(inp.strafe, -1, 1) : 0;
  const fast = !!(inp && inp.sprint), target = headingOf(inp && fin(inp.yaw) ? inp.yaw : st.h + PI);
  const k = fast ? THRUST.sprint : THRUST.cruise, period = fast ? B.STROKE_FAST : B.STROKE;
  const drag = Math.exp(-B.DRAG * h), slip = Math.exp(-B.SLIP * h);
  for (let i = 0; i < n; i++) {
    if (fwd !== 0) {
      st.ph += h / period;
      if (st.ph >= 1) { st.ph -= 1; st.side = st.side < 0 ? 1 : -1; st.wraps++; }
      if (fwd > 0) st.v += k * fwd * Math.sin(PI * st.ph) * h;
      else st.v = Math.max(-B.BACK, st.v - B.BRAKE * h);
    } else if (st.v !== 0) { // coast: drag plus a little friction so it settles
      const f = B.IDLE_FRICTION * h;
      st.v = Math.abs(st.v) <= f ? 0 : st.v - Math.sign(st.v) * f;
    }
    st.v *= drag;
    if (fwd < 0 && st.v < -B.BACK) st.v = -B.BACK;
    if (Math.abs(st.v) > .3 || fwd !== 0) {
      const dh = clamp(angDiff(st.h, target), -B.TURN * h, B.TURN * h);
      if (dh !== 0) { st.h = wrapAngle(st.h + dh); st.lat -= st.v * Math.sin(dh) * B.KEEP_LAT; }
    }
    const lt = strafe * B.SCULL;
    st.lat = lt + (st.lat - lt) * slip;
    if (fwd === 0 && strafe === 0 && Math.abs(st.lat) < .01) st.lat = 0;
    const s = Math.sin(st.h), c = Math.cos(st.h); // nose (s, c), right (-c, s)
    st.x += (st.v * s - st.lat * c) * h;
    st.z += (st.v * c + st.lat * s) * h;
  }
  return st;
}

/** Push toward home (m/s) at distance d from the hull. */
export function tether(d) {
  if (!(d > B.TETHER_SOFT)) return 0;
  if (d >= B.TETHER_HARD) return B.TETHER_PUSH;
  const t = (d - B.TETHER_SOFT) / (B.TETHER_HARD - B.TETHER_SOFT);
  return B.TETHER_PUSH * t * t * (3 - 2 * t);
}

/** World velocity of a ride state. */
export function rideVel(st, out) {
  const s = Math.sin(st.h), c = Math.cos(st.h);
  out.x = st.v * s - st.lat * c; out.z = st.v * c + st.lat * s;
  return out;
}

/**
 * One full ride step: stepRide, tether toward home, hard clamp at TETHER_HARD, push out of the hull
 * (removing the velocity into it). info {tug, push, d} (reused). Shared by the module, debug and tests.
 */
const po = { x: 0, z: 0, nx: 0, nz: 0 }, vel = { x: 0, z: 0 };
export function rideTick(st, inp, dt, tiles, info) {
  stepRide(st, inp, dt);
  info.tug = 0; info.push = false;
  dt = Math.min(Math.max(dt, 0), .25);
  nearestTile(tiles, st.x, st.z, nt);
  if (nt.d < Infinity && nt.d > 0) {
    const ux = (nt.px - st.x) / nt.d, uz = (nt.pz - st.z) / nt.d, t = tether(nt.d);
    if (t > 0) { st.x += ux * t * dt; st.z += uz * t * dt; info.tug = t; }
    nearestTile(tiles, st.x, st.z, nt);
    if (nt.d > B.TETHER_HARD) { const k = (nt.d - B.TETHER_HARD) / nt.d; st.x += (nt.px - st.x) * k; st.z += (nt.pz - st.z) * k; nt.d = B.TETHER_HARD; }
  }
  if (pushOut(tiles, st, po)) {
    st.x = po.x; st.z = po.z; info.push = true;
    rideVel(st, vel);
    const vn = vel.x * po.nx + vel.z * po.nz;
    if (vn < 0) {
      vel.x -= vn * po.nx; vel.z -= vn * po.nz;
      const s = Math.sin(st.h), c = Math.cos(st.h);
      st.v = vel.x * s + vel.z * c; st.lat = -vel.x * c + vel.z * s;
    }
    nearestTile(tiles, st.x, st.z, nt);
  }
  info.d = nt.d;
  return info;
}

/** Adrift boards paddle themselves home (HOME m/s) and tie on within AUTO_TIE of the hull. */
const ts = { x: 0, z: 0, h: 0 };
export function homeStep(b, tiles, dt, boards) {
  if (b.s === 'tied') return 'tied';
  if (!(dt > 0) || !Array.isArray(tiles) || !tieSpot(tiles, b.x, b.z, boards, b.id, ts)) return 'adrift';
  nearestTile(tiles, b.x, b.z, nt);
  if (nt.d <= B.AUTO_TIE) return tieAt(b, ts);
  const dx = ts.x - b.x, dz = ts.z - b.z, d = Math.sqrt(dx * dx + dz * dz);
  const step = Math.min(d, B.HOME * dt);
  if (d > 1e-9) { b.x += dx / d * step; b.z += dz / d * step; }
  b.h = wrapAngle(b.h + clamp(angDiff(b.h, parallel(b.h, ts.h)), -.3 * dt, .3 * dt));
  nearestTile(tiles, b.x, b.z, nt);
  return nt.d <= B.AUTO_TIE ? tieAt(b, ts) : 'adrift';
}
/** The edge-parallel heading (h0 or h0 + PI) closest to h. */
export const parallel = (h, h0) => (Math.abs(angDiff(h, h0)) <= PI / 2 ? wrapAngle(h0) : wrapAngle(h0 + PI));
function tieAt(b, s) { b.x = s.x; b.z = s.z; b.h = parallel(b.h, s.h); b.s = 'tied'; return 'tied'; }
