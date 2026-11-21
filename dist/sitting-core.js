// Sit on seats: pure helpers (no THREE). See docs/specs/sitting.md. Raft-local metres throughout:
// decor d sits at (d.x*2, .22, d.z*2) with rotation.y = d.rot; d.x/d.z may be fractional (free placement),
// so seats are matched by |delta| < 1e-3, never by ===.

export const SEATS = Object.freeze({
  bench: Object.freeze([Object.freeze([-.36, .04]), Object.freeze([.36, .04])]), // side by side; sitter faces local +z
  cushion: Object.freeze([Object.freeze([0, 0])]),                                // one low floor seat
});
export const EYE = Object.freeze({ bench: 1.25, cushion: .95 }); // above deckY(): hips land on the seat top
export const REACH = 2.5, AWARD_S = 30, YAW_LIM = 100 * Math.PI / 180;
const EPS = 1e-3, STAND_LZ = .59, MAX_POS = 60, MAX_T = 1e9, TAU = Math.PI * 2;

/** World (raft-local) seat point i of decor d, written into out (reused, no allocation). */
export function seatPoint(d, i, out = {}) {
  const r = Number.isFinite(d?.rot) ? d.rot : 0, s = (SEATS[d?.type] ?? SEATS.cushion)[i] ?? [0, 0];
  const c = Math.cos(r), n = Math.sin(r), lx = s[0], lz = s[1];
  out.x = d.x * 2 + lx * c + lz * n; out.z = d.z * 2 - lx * n + lz * c; out.yaw = r + Math.PI;
  return out;
}

const near = (a, b) => Math.abs(a - b) < EPS;

/** The first seat-type world.decor entry at (x, z) (decor units), else null. */
export function findDecor(world, x, z) {
  const list = world?.decor; if (!Array.isArray(list) || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  for (let i = 0; i < list.length; i++) { const d = list[i]; if (d && SEATS[d.type] && near(d.x, x) && near(d.z, z)) return d; }
  return null;
}

/** Copy of sleep.js getUpSpot (importing sleep.js would pull daynight): a free neighbour tile centre, else beside. */
export function getUpSpot(world, x, z, out = {}) {
  const tiles = Array.isArray(world?.tiles) ? world.tiles : [], decor = Array.isArray(world?.decor) ? world.decor : [];
  const hasTile = (a, b) => tiles.some(t => t && t[0] === a && t[1] === b);
  const blocked = (a, b) => decor.some(d => d && d.x === a && d.z === b && d.type !== 'net');
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const a = x + dx, b = z + dz;
    if (hasTile(a, b) && !blocked(a, b)) { out.x = a * 2; out.z = b * 2; return out; }
  }
  out.x = x * 2 + .8; out.z = z * 2;
  return out;
}

/** Where to stand after getting up: .55 m in front of seat i if that tile exists, else a getUpSpot neighbour. */
export function standSpot(world, d, i, out = {}) {
  const r = Number.isFinite(d?.rot) ? d.rot : 0, s = (SEATS[d?.type] ?? SEATS.cushion)[i] ?? [0, 0];
  const c = Math.cos(r), n = Math.sin(r), lx = s[0], lz = STAND_LZ;
  const x = d.x * 2 + lx * c + lz * n, z = d.z * 2 - lx * n + lz * c;
  const tx = Math.round(x / 2), tz = Math.round(z / 2), tiles = world?.tiles;
  if (Array.isArray(tiles)) for (let k = 0; k < tiles.length; k++) { const t = tiles[k]; if (t && t[0] === tx && t[1] === tz) { out.x = x; out.z = z; return out; } }
  return getUpSpot(world, Math.round(d.x), Math.round(d.z), out);
}

/** null while yaw is within lim of the seat facing, else the clamped yaw (seatYaw +- lim). */
export function clampYaw(yaw, seatYaw, lim = YAW_LIM) {
  if (!Number.isFinite(yaw) || !Number.isFinite(seatYaw)) return null;
  let d = (yaw - seatYaw) % TAU;
  if (d > Math.PI) d -= TAU; else if (d <= -Math.PI) d += TAU;
  if (Math.abs(d) <= lim) return null;
  return seatYaw + (d > 0 ? lim : -lim);
}

export const defaultSit = () => ({ v: 1, in: { host: null, guest: null }, t: 0 });

const okPos = v => Number.isFinite(v) && Math.abs(v) <= MAX_POS;
const cleanIn = e => (Array.isArray(e) && okPos(e[0]) && okPos(e[1]) && Number.isInteger(e[2]) && e[2] >= 0 && e[2] <= 1 ? [e[0], e[1], e[2]] : null);

/** Validate a world.ext.sit slice. Never throws; junk becomes defaults field by field. */
export function cleanSit(d) {
  const out = defaultSit();
  if (!d || typeof d !== 'object' || Array.isArray(d)) return out;
  const inn = d.in && typeof d.in === 'object' && !Array.isArray(d.in) ? d.in : {};
  out.in.host = cleanIn(inn.host); out.in.guest = cleanIn(inn.guest);
  out.t = Number.isFinite(d.t) ? Math.min(MAX_T, Math.max(0, d.t)) : 0;
  return out;
}
