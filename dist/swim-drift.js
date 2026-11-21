// Little Raft - swimmer drift and the raft leash (pure JS: no THREE, no DOM).
// The raft frame never moves; the world moves past it. A swimmer floats in the WATER, so in raft space the
// swimmer slides back by the raft's water-relative motion (sail, paddle, engine). The current moves raft and
// swimmer alike and cancels out; an anchored raft has no water-relative motion, so nothing drifts.
// Raft: nothing teleports you home. Past WARN the HUD warns and points at the raft; past LOST the raft is
// gone and you pass out (game.js faint -> bed / raft respawn). HARD is only the PlayerPhysics out-of-world guard.
// Unit tests: tests/swim-drift.test.mjs.

export const SWIM = Object.freeze({
  WARN: 120,          // m from the nearest raft tile: "Your raft is drifting away!" + raft marker
  LOST: 400,          // m: the raft is lost, faint
  HARD: 2000,         // m: PlayerPhysics hard safety (out-of-world), never reached in play
  WARN_REPEAT: 8,     // s between repeated warning notices
});

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/** True when p floats free in the water (swimming or diving, not clambering, not riding something). */
export function adrift(p) {
  return !!p && p.swimming === true && !p.climbing && !p.mount;
}

/**
 * Shift a free swimmer by minus this step's water-relative raft displacement (stepSailing out.dwx, out.dwz).
 * Returns true when the swimmer was moved. No allocation.
 */
export function driftSwimmer(p, dwx, dwz) {
  if (!adrift(p) || !fin(dwx) || !fin(dwz) || (dwx === 0 && dwz === 0)) return false;
  if (!fin(p.x) || !fin(p.z)) return false;
  p.x -= dwx; p.z -= dwz;
  return true;
}

/**
 * Distance from (x, z) to the nearest raft tile footprint (2x2 squares centred on (2tx, 2tz)); 0 inside.
 * Writes the nearest footprint point to out.x, out.z (origin and distance to it when there are no tiles).
 */
export function raftDistance(tiles, x, z, out) {
  let best = Infinity, bx = 0, bz = 0;
  if (Array.isArray(tiles)) {
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (!Array.isArray(t) || !fin(t[0]) || !fin(t[1])) continue;
      const cx = t[0] * 2, cz = t[1] * 2;
      const px = x < cx - 1 ? cx - 1 : x > cx + 1 ? cx + 1 : x, pz = z < cz - 1 ? cz - 1 : z > cz + 1 ? cz + 1 : z;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < best) { best = d2; bx = px; bz = pz; }
    }
  }
  if (best === Infinity) best = x * x + z * z;
  if (out) { out.x = bx; out.z = bz; }
  return Math.sqrt(best);
}

/** 0 = fine, 1 = drifting away (warn + marker), 2 = lost (faint). NaN counts as lost. */
export function leashLevel(d) {
  if (!(d >= 0)) return 2;
  return d >= SWIM.LOST ? 2 : d >= SWIM.WARN ? 1 : 0;
}

/**
 * Bearing of (tx, tz) seen from (px, pz) facing yaw (game.js: forward = (-sin yaw, -cos yaw)).
 * Returns radians in (-PI, PI]: 0 straight ahead, positive to the right.
 */
export function bearingTo(px, pz, yaw, tx, tz) {
  const dx = tx - px, dz = tz - pz, s = Math.sin(yaw), c = Math.cos(yaw);
  const f = -dx * s - dz * c, r = dx * c - dz * s;
  return Math.atan2(r, f);
}

/**
 * Screen spot for the raft marker: on an ellipse inset from the viewport edge, in the bearing's direction
 * (ahead = top). Writes out.x, out.y (px), out.rot (deg, for an up-pointing arrow). No allocation.
 */
export function markerSpot(bearing, w, h, out, margin = 56) {
  const b = fin(bearing) ? bearing : 0, rx = Math.max(0, w / 2 - margin), ry = Math.max(0, h / 2 - margin);
  out.x = w / 2 + Math.sin(b) * rx; out.y = h / 2 - Math.cos(b) * ry; out.rot = b * 180 / Math.PI;
  return out;
}
