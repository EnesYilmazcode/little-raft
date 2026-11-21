// The Old Beacon Mast: the first story landmark the Receiver leads to. Pure logic (no THREE, no DOM, no clocks).
// A tall lattice mast on a small rock, fixed on the seabed like the islands (moved past the raft by the
// sailing seabed offset). The Receiver finds it once it has 3 antennas, is switched on and a charged battery
// sits within 3 tiles. On top: 3 crates of rare loot and the keeper's board, a logbook note with the code and
// bearing of the next landmark (stored for a later round). Host-authoritative; saved in world.ext.mast.
import { hash3 } from './islands-layout.js?build=v3-survival-ae77fa84ac2b';
import { SAIL, wrapAxis } from './sailing-core.js?build=v3-survival-ae77fa84ac2b';

export const MAST = Object.freeze({
  DIST_MIN: 600, DIST_MAX: 800, // metres ahead of the raft's travel when the receiver first hears it
  SPREAD: 0.6,                  // radians either side of the travel direction
  PLAT_R: 5.2,                  // rock platform radius (wobbly, see rockShape)
  PLAT_Y: 0.95,                 // flat top of the rock above mean water
  EDGE: 1.4,                    // the last metres of the rock slope down into the water (swimmers climb out)
  DECK_Y: 9.2,                  // top of the lookout deck
  DECK_HALF: 2.3,               // deck half size; railings keep you within RAIL
  RAIL: 2.05,
  LAMP_Y: 15.6,                 // beacon lamp height above the group origin
  LADDER_X: 2.5,                // ladder on the +x face, outside the deck edge
  CLIMB_REACH: 1.5,             // E reach to the ladder foot / the top of the ladder
  REACH: 2.4,                   // crate / board reach (m), host check
  GUEST_SLACK: 1.0,
  SHOW: 240,                    // drawn within this range (the camera's far plane is 200 m)
  RX_DRAIN: 3.6,                // battery charge per second while the receiver is on: a full battery (1800) lasts 500 s
  RX_RANGE: 3,                  // battery within this many tiles (Chebyshev) of the receiver
  ANTENNAS: 3,                  // antennas needed for the long-range signal
  LEGS: Object.freeze([1.75, 1.3]), // leg half spread at the rock / at the deck
  LEG_R: 0.16,
});

// Deck-local spots (x, z) of the crates and the keeper's board.
export const CRATES = Object.freeze([
  Object.freeze({ x: -1.45, z: -1.4, loot: Object.freeze([['copperingot', 2], ['circuitboard', 1]]) }),
  Object.freeze({ x: -1.45, z: 1.15, loot: Object.freeze([['circuitboard', 1], ['bolt', 2], ['hinge', 1]]) }),
  Object.freeze({ x: 0.75, z: -1.5, loot: Object.freeze([['battery', 1], ['vinegoo', 2]]) }),
]);
export const BOARD = Object.freeze({ x: 0.45, z: 1.95 });
export const LADDER_FOOT = Object.freeze({ x: MAST.LADDER_X + 0.7, z: 0 }); // where you stand to climb up (rock)
export const LADDER_TOP = Object.freeze({ x: 1.75, z: 0 });                   // where you arrive / stand to climb down (deck)

const U32 = 4294967296;
const HG = SAIL.GROUND_WRAP / 2;
const DEG = 180 / Math.PI;
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const fin = v => typeof v === 'number' && Number.isFinite(v);
const isSeed = s => Number.isInteger(s) && s >= 0 && s < U32;
export const wrapGround = v => wrapAxis(v, HG);

// Shoreline wobble of the rock (theta in the mast's own frame).
export function rockShape(theta) { return 1 + 0.07 * Math.sin(3 * theta + 0.4) + 0.05 * Math.sin(5 * theta + 1.9); }

export const DEFAULTS = () => ({ v: 1, seed: 0, at: null, crates: [0, 0, 0], note: 0, on: 0, live: 0, clue: null });

// Validate a save / net slice. Never throws; old saves (undefined) get the defaults. seed 0 = not chosen yet.
export function cleanMast(data) {
  const out = DEFAULTS();
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1) return out;
  if (isSeed(data.seed)) out.seed = data.seed;
  const a = data.at;
  if (a && typeof a === 'object' && fin(a.bx) && fin(a.bz) && Math.abs(a.bx) <= HG && Math.abs(a.bz) <= HG) out.at = { bx: a.bx, bz: a.bz };
  if (Array.isArray(data.crates)) for (let i = 0; i < CRATES.length; i++) out.crates[i] = data.crates[i] === 1 ? 1 : 0;
  out.note = data.note === 1 ? 1 : 0;
  out.on = data.on === 1 ? 1 : 0;
  out.live = data.live === 1 ? 1 : 0;
  const c = data.clue;
  if (c && typeof c === 'object' && typeof c.code === 'string' && /^\d{4}$/.test(c.code) && Number.isInteger(c.bearing) && c.bearing >= 0 && c.bearing < 360) out.clue = { code: c.code, bearing: c.bearing };
  if (!out.at) { out.crates = [0, 0, 0]; out.note = 0; out.clue = null; } // nothing to have looted yet
  return out;
}

// Where the mast goes relative to the raft: DIST_MIN..DIST_MAX metres along the travel direction (dx, dz),
// turned up to SPREAD either way, all from the seed. Zero travel falls back to +z (the current). No allocation.
export function placeRel(seed, dx, dz, out) {
  let m = fin(dx) && fin(dz) ? Math.sqrt(dx * dx + dz * dz) : 0;
  if (!(m > 1e-6)) { dx = 0; dz = 1; m = 1; }
  dx /= m; dz /= m;
  const a = (hash3(seed >>> 0, 41, 1) * 2 - 1) * MAST.SPREAD, d = MAST.DIST_MIN + (MAST.DIST_MAX - MAST.DIST_MIN) * hash3(seed >>> 0, 41, 2);
  const c = Math.cos(a), s = Math.sin(a);
  out.x = (dx * c + dz * s) * d; out.z = (dz * c - dx * s) * d;
  return out;
}
// Seabed base from a raft-relative spot and the seabed offset (gx, gz) now; and back (islandRel's rule).
export function baseFrom(rx, rz, gx, gz) { return { bx: wrapGround(gx + rx), bz: wrapGround(gz + rz) }; }
export function mastRel(at, gx, gz, out) { out.x = wrapGround(at.bx - gx); out.z = wrapGround(at.bz - gz); return out; }

// The next landmark's code and bearing (degrees), written on the keeper's board. Pure function of the seed.
export function clueFor(seed) {
  const code = String(1000 + Math.floor(hash3(seed >>> 0, 43, 1) * 9000));
  return { code, bearing: Math.floor(hash3(seed >>> 0, 43, 2) * 360) % 360 };
}

// Walkable surface (height above the mast origin) at mast-local (x, z) for feet at height fy, or NaN.
// The deck counts only once the feet are near it (you walk under it on the rock).
export function surfaceAt(x, z, fy) {
  if (fin(fy) && fy > MAST.DECK_Y - 1.2 && Math.abs(x) <= MAST.DECK_HALF && Math.abs(z) <= MAST.DECK_HALF) return MAST.DECK_Y;
  const r = Math.sqrt(x * x + z * z), edge = MAST.PLAT_R * rockShape(Math.atan2(z, x));
  if (r > edge) return NaN;
  if (r <= edge - MAST.EDGE) return MAST.PLAT_Y;
  return MAST.PLAT_Y - (MAST.PLAT_Y + 0.5) * ((r - (edge - MAST.EDGE)) / MAST.EDGE);
}
export const onDeck = (x, z, fy) => fin(fy) && fy > MAST.DECK_Y - 0.5 && Math.abs(x) <= MAST.DECK_HALF + 0.2 && Math.abs(z) <= MAST.DECK_HALF + 0.2;

// Antennas counted for receiver rx: signal.js countAntennas' rule (2+ tiles, Chebyshev, from the receiver; capped
// at 3) without its per-call closure, since mast.js asks every frame.
export function antennaCount(decor, rx) {
  if (!rx || !Array.isArray(decor)) return 0;
  let n = 0;
  for (let i = 0; i < decor.length; i++) {
    const d = decor[i];
    if (d && d.type === 'antenna' && Math.max(Math.abs(d.x - rx.x), Math.abs(d.z - rx.z)) >= 2 && ++n >= MAST.ANTENNAS) return MAST.ANTENNAS;
  }
  return n;
}

// Receiver status from the raft: 'none' (no receiver), 'off', 'antennas' (< 3), 'power' (no charged battery), 'live'.
export function receiverStatus(hasReceiver, on, antennas, charged) {
  if (!hasReceiver) return 'none';
  if (!on) return 'off';
  if (!(antennas >= MAST.ANTENNAS)) return 'antennas';
  if (!charged) return 'power';
  return 'live';
}

// Bearing and range from the player (px, pz, yaw) to the mast at raft-relative (rx, rz). Writes into out
// (heading 0..360 with north = -z, point, arrow in screen degrees, distance). No allocation.
export function bearing(rx, rz, px, pz, yaw, out) {
  const dx = rx - (fin(px) ? px : 0), dz = rz - (fin(pz) ? pz : 0);
  const b = Math.atan2(dx, -dz) * DEG;
  out.heading = ((b % 360) + 360) % 360;
  out.point = POINTS[Math.round(out.heading / 45) % 8];
  const a = b + (fin(yaw) ? yaw : 0) * DEG;
  out.arrow = ((((a + 180) % 360) + 360) % 360) - 180;
  out.distance = Math.sqrt(dx * dx + dz * dz);
  return out;
}
export const rangeText = d => (d >= 995 ? (Math.round(d / 100) / 10).toFixed(1) + ' km' : Math.max(10, Math.round(d / 10) * 10) + ' m');

// Host crate check. st: the mast state, i: crate index, pos: actor pose relative to the mast origin {x, y, z}
// (y = eye height above the mast origin, may be NaN for an old guest pose). Mutates st.crates and bag on success.
export function openCrate(st, i, pos, actor, bag) {
  const no = reason => ({ ok: false, reason, loot: null });
  if (!st || !st.at) return no('none');
  if (!Number.isInteger(i) || i < 0 || i >= CRATES.length) return no('crate');
  if (st.crates[i]) return no('empty');
  if (!reach(pos, CRATES[i], actor)) return no('reach');
  if (!bag || !Array.isArray(bag.slots) || typeof bag.snapshot !== 'function') return no('bag');
  const loot = CRATES[i].loot;
  let scratch;
  try { scratch = new bag.constructor(bag.snapshot()); } catch { return no('bag'); }
  for (const [kind, n] of loot) if (scratch.add(kind, n) > 0) return no('full');
  for (let k = 0; k < bag.slots.length; k++) bag.slots[k] = scratch.slots[k];
  if (typeof bag.version === 'number') bag.version++;
  st.crates[i] = 1;
  return { ok: true, reason: null, loot };
}
// Host board check: the first read stores the clue. Returns {ok, first}.
export function readBoard(st, pos, actor) {
  if (!st || !st.at || !reach(pos, BOARD, actor)) return { ok: false, first: false };
  const first = !st.note;
  st.note = 1; if (!st.clue) st.clue = clueFor(st.seed);
  return { ok: true, first };
}
function reach(pos, spot, actor) {
  if (!pos || !fin(pos.x) || !fin(pos.z)) return false;
  const r = MAST.REACH + (actor === 'guest' ? MAST.GUEST_SLACK : 0), dx = pos.x - spot.x, dz = pos.z - spot.z;
  if (dx * dx + dz * dz > r * r) return false;
  return !fin(pos.y) || pos.y > MAST.DECK_Y - 1; // up on the deck (eye above it)
}
