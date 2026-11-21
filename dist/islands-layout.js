// Islands: pure logic (no THREE, no DOM). Layout from a uint32 seed, world placement (islands are fixed on the
// seabed: they spawn ahead of the raft and it drifts past them), save validation and migration, loot rules,
// the host gather check and the stand-on-sand step. See docs/features/islands.md.
import { PLAYER_CONSTANTS } from './player-physics.js?build=v3-survival-ae77fa84ac2b';
import { SAIL, wrapAxis } from './sailing-core.js?build=v3-survival-ae77fa84ac2b';

export const ISLAND = Object.freeze({
  FIRST: 90,            // first island in a fresh world (s)
  CALM_MIN: 150, CALM_MAX: 240,
  SPAWN_MIN: 120, SPAWN_MAX: 160, // spawn distance ahead of the raft, along its travel over the seabed (m)
  SIDE_MAX: 40,         // seeded side offset from the travel line (m)
  DESPAWN: 150,         // sinks once this far away and behind the raft (m) ...
  FAR: 260,             // ... or this far away in any direction
  BEHIND: 60,           // "falling behind" notice once it is this far behind the raft (m)
  RISE: 4, SINK: 3,     // seconds and metres the island rises out of / sinks into the sea at each end
  TOP: 0.9,             // dome top above the group origin (mean water)
  FALL: 1.8,            // TOP - FALL * u^4: shoreline at u ~ 0.84, -0.9 m at the rim
  RIM: 1.15,            // the sand mesh (and ground) stop here, in units of R
  REACH: 3.5,           // gather reach (m)
  COOLDOWN: 0.3,        // host per-actor gather cooldown (s)
  NEAR: 6,              // never sinks while a player is within R + NEAR (it would drop them in open sea)
  OFF_MIN: 8, OFF_MAX: 60, // spawnNear (QA) lateral offset
  // Legacy v1 timeline (only to migrate old saves): approach, docked, depart.
  APPROACH: 25, DOCK_CAP: 600, DEPART: 30, START_Z: -60, END_Z: 60,
  MAX_NODES: 14,
  WALK_MARGIN: 0.25,    // step onto sand only where it is this far above the local wave...
  STAY_MARGIN: -0.1,    // ...but once standing, stay until a wave covers it by this much (hysteresis)
  GUEST_SLACK: 1.0,     // extra gather reach for the guest (the host sees a pose up to ~0.12 s old)
});

export const NODE_KINDS = Object.freeze(['palm', 'bush', 'rock', 'sand']);
export const NODE_MAX = Object.freeze({ palm: 3, bush: 2, rock: 3, sand: 4 });

const U32 = 4294967296;
const fin = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isSeed = s => Number.isInteger(s) && s >= 0 && s < U32;

// mulberry32
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / U32;
  };
}
// Deterministic [0,1) from a few integers (bush seed rolls).
export function hash3(a, b, c) {
  let h = (Math.imul(a >>> 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x7F4A7C15, 0x85EBCA77) ^ Math.imul((c | 0) + 0x165667B1, 0xC2B2AE3D)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45D9F3B) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45D9F3B) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / U32;
}

// Shoreline wobble so islands are not perfect circles. theta is the angle in the island's own frame.
export function shape(theta) { return 1 + 0.05 * Math.sin(3 * theta + 0.7) + 0.035 * Math.sin(5 * theta + 2.1); }

// Height of the sand above the island origin at normalised radius u = r / R (NaN past the rim).
export function groundHeight(r, R, theta = 0) {
  if (!fin(r) || !fin(R) || R <= 0) return NaN;
  const u = r / (R * shape(theta));
  if (u > ISLAND.RIM) return NaN;
  return heightU(u, theta);
}
// The same at normalised radius u (shared with the dome mesh so the physics matches what you see).
// Low dunes (up to ~0.15 m) ripple the top and fade out before the shoreline.
export function heightU(u, theta = 0) {
  const u2 = u * u, f = 1 - u2;
  const dune = f > 0 ? 0.16 * Math.min(1, 3 * u) * f * f * f * (0.6 * Math.sin(2 * theta + 1.3 + 3 * u) + 0.4 * Math.sin(3 * theta - 5 * u + 0.4)) : 0;
  return ISLAND.TOP - ISLAND.FALL * u2 * u2 + dune;
}
// u where the sand meets mean water.
export const SHORE_U = Math.pow(ISLAND.TOP / ISLAND.FALL, 0.25);

const RANGES = {
  palm: [1, 3, 0.10, 0.50, 1.6], bush: [2, 4, 0.18, 0.62, 1.1],
  rock: [2, 4, 0.30, 0.70, 1.1], sand: [2, 3, 0.15, 0.62, 1.1],
};

const layoutCache = new Map();
// Layout of an island, a pure function of its seed (cached, frozen; treat as read-only).
export function layoutFor(seed) {
  seed = seed >>> 0;
  const hit = layoutCache.get(seed);
  if (hit) return hit;
  const r = rng(seed);
  const R = 6 + r() * 3;
  const rot = r() * Math.PI * 2;
  const dockZ = -r() * 6;
  const gap = 10 + r() * 3;
  const nodes = [];
  for (const kind of NODE_KINDS) {
    const [lo, hi, u0, u1, spacing] = RANGES[kind];
    const want = lo + Math.floor(r() * (hi - lo + 1));
    for (let k = 0; k < want; k++) {
      for (let tries = 0; tries < 80; tries++) {
        const a = r() * Math.PI * 2, u = u0 + (u1 - u0) * Math.sqrt(r());
        const rad = u * R * shape(a - rot);
        const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        let ok = true;
        for (const n of nodes) {
          const need = Math.max(spacing, RANGES[n.kind][4]);
          if ((n.x - x) ** 2 + (n.z - z) ** 2 < need * need) { ok = false; break; }
        }
        if (!ok) continue;
        const y = groundHeight(rad, R, a - rot);
        nodes.push(Object.freeze({ kind, x, z, y, s: 0.8 + r() * 0.45, a: r() * Math.PI * 2, max: NODE_MAX[kind] }));
        break;
      }
    }
  }
  const out = Object.freeze({ seed, R, rot, dockZ, gap, nodes: Object.freeze(nodes) });
  if (layoutCache.size > 64) layoutCache.clear();
  layoutCache.set(seed, out);
  return out;
}

const HG = SAIL.GROUND_WRAP / 2;

// Rise/sink depth (m below normal) and phase of an island t seconds after birth. sinkT: seconds since it
// started to sink, or a negative number while it is not sinking. Writes into out (pass one to avoid allocating).
export function sinkAt(t, sinkT, out = {}) {
  if (!fin(t) || t < 0) t = 0;
  out.sink = 0;
  if (fin(sinkT) && sinkT >= 0) {
    if (sinkT >= ISLAND.RISE) { out.phase = 'gone'; out.sink = ISLAND.SINK; return out; }
    const k = sinkT / ISLAND.RISE; out.phase = 'sinking'; out.sink = ISLAND.SINK * k * k;
    return out;
  }
  if (t < ISLAND.RISE) { const k = 1 - t / ISLAND.RISE; out.phase = 'rising'; out.sink = ISLAND.SINK * k * k; }
  else out.phase = 'adrift';
  return out;
}

// Island centre relative to the raft (scene x/z: the raft stays at the origin) from its seabed position
// (bx, bz) and the seabed offset (gx, gz). Writes out.x, out.z.
export function relPos(bx, bz, gx, gz, out) {
  out.x = wrapAxis(bx - gx, HG); out.z = wrapAxis(bz - gz, HG);
  return out;
}

// Spawn spot relative to the raft: SPAWN_MIN..MAX ahead along the unit travel direction (fx, fz), plus a
// seeded 0..SIDE_MAX side offset. Writes out.x, out.z.
export function spawnSpot(seed, fx, fz, out) {
  const l = Math.hypot(fx, fz);
  if (!(l > 1e-6)) { fx = 0; fz = 1; } else { fx /= l; fz /= l; }
  const d = ISLAND.SPAWN_MIN + (ISLAND.SPAWN_MAX - ISLAND.SPAWN_MIN) * hash3(seed >>> 0, 11, 3);
  const side = ISLAND.SIDE_MAX * hash3(seed >>> 0, 12, 4) * (hash3(seed >>> 0, 13, 5) < 0.5 ? -1 : 1);
  out.x = fx * d + fz * side; out.z = fz * d - fx * side;
  return out;
}

// Raft travel over the seabed (m/s) from the sailing state: water velocity plus current, zero at anchor.
export function travelOf(s, out) {
  out.x = 0; out.z = 0;
  if (!s || s.anchored) return out;
  out.x = (fin(s.vx) ? s.vx : 0) + SAIL.CURRENT_X; out.z = (fin(s.vz) ? s.vz : 0) + SAIL.CURRENT_Z;
  return out;
}

// Where an island at (x, z) relative to the raft stands against the unit travel direction (fx, fz):
// 'out' (despawn: past DESPAWN and behind, or past FAR), 'behind' (more than BEHIND behind) or 'ok'.
export function driftState(x, z, fx, fz) {
  const d2 = x * x + z * z, along = x * fx + z * fz;
  if (d2 > ISLAND.FAR * ISLAND.FAR || (d2 > ISLAND.DESPAWN * ISLAND.DESPAWN && along < 0)) return 'out';
  return along < -ISLAND.BEHIND ? 'behind' : 'ok';
}

// Legacy v1 timeline z (m along the raft) at t seconds, NaN once it was gone. Old saves only.
function legacyZ(t, dock, dockZ) {
  const A = ISLAND.APPROACH, P = ISLAND.DEPART;
  if (t < A) { const u = 1 - t / A; return ISLAND.START_Z + (dockZ - ISLAND.START_Z) * (1 - u * u * u); }
  if (t < A + dock) return dockZ;
  if (t < A + dock + P) { const u = (t - A - dock) / P; return dockZ + (ISLAND.END_Z - dockZ) * u * u * u; }
  return NaN;
}

// Seconds of calm before the next island (seeded so it is reproducible in tests).
export function nextDelay(seed, first = false) {
  if (first) return ISLAND.FIRST;
  return ISLAND.CALM_MIN + (ISLAND.CALM_MAX - ISLAND.CALM_MIN) * hash3(seed >>> 0, 77, 5);
}

// Lateral placement: the clearer x side of the raft, gap metres from its bounding box to the shore.
export function dockOffset(tiles, layout) {
  let lo = 0, hi = 0, any = false;
  if (Array.isArray(tiles)) for (const t of tiles) {
    if (!Array.isArray(t) || !fin(t[0])) continue;
    const x = t[0] * 2;
    if (!any) { lo = x - 1; hi = x + 1; any = true; } else { lo = Math.min(lo, x - 1); hi = Math.max(hi, x + 1); }
  }
  if (!any) { lo = -1; hi = 1; }
  const side = hi < -lo ? 1 : -lo < hi ? -1 : (layout.seed & 1 ? 1 : -1);
  const edge = side > 0 ? hi : -lo;
  const off = clamp(edge + layout.gap + layout.R * SHORE_U, ISLAND.OFF_MIN, ISLAND.OFF_MAX);
  return { side, off };
}

export const DEFAULTS = () => ({ v: 2, clock: 0, next: ISLAND.FIRST, isl: null });

// Validate a save / net slice. Never throws; always returns a fresh valid object. v1 saves (the old
// approach/dock/depart timeline: born, dock, side, off) are migrated onto the seabed at their current spot
// relative to the raft; ground = the sailing seabed offset {gx, gz} at load time (defaults to 0, 0).
export function clean(data, layoutOf = layoutFor, ground = null) {
  const out = DEFAULTS();
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data) || (data.v !== 1 && data.v !== 2)) return out;
    if (fin(data.clock) && data.clock >= 0) out.clock = Math.min(data.clock, 1e9);
    if (fin(data.next) && data.next >= 0) out.next = Math.min(data.next, out.clock + ISLAND.CALM_MAX);
    else out.next = out.clock + ISLAND.FIRST;
    const i = data.isl;
    if (!i || typeof i !== 'object' || Array.isArray(i)) return out;
    if (!isSeed(i.seed) || !fin(i.born) || !Array.isArray(i.used)) return out;
    const lay = layoutOf(i.seed);
    let bx, bz, born = clamp(i.born, -1e9, out.clock), sink = -1;
    if (data.v === 1) {
      if (!fin(i.dock) || !fin(i.off) || (i.side !== 1 && i.side !== -1)) return out;
      const z = legacyZ(out.clock - i.born, clamp(i.dock, 0, ISLAND.DOCK_CAP), lay.dockZ);
      if (!(z === z)) return out; // already gone
      const gx = ground && fin(ground.gx) ? ground.gx : 0, gz = ground && fin(ground.gz) ? ground.gz : 0;
      bx = wrapAxis(gx + i.side * clamp(i.off, ISLAND.OFF_MIN, ISLAND.OFF_MAX), HG); bz = wrapAxis(gz + z, HG);
    } else {
      if (!fin(i.bx) || !fin(i.bz)) return out;
      bx = wrapAxis(i.bx, HG); bz = wrapAxis(i.bz, HG);
      if (fin(i.sink) && i.sink >= 0) {
        sink = clamp(i.sink, born, out.clock);
        if (out.clock - sink >= ISLAND.RISE) return out; // finished sinking
      }
    }
    const used = lay.nodes.map((n, k) => { const v = i.used[k]; return Number.isInteger(v) ? clamp(v, 0, n.max) : 0; });
    out.isl = { seed: i.seed, bx, bz, born, sink, used };
  } catch { return DEFAULTS(); }
  return out;
}

// What one gather gives: [[kind, count], ...].
export function lootFor(kind, seed, node, used) {
  if (kind === 'palm') return used === NODE_MAX.palm - 1 ? [['wood', 1], ['leaf', 1], ['seed', 1]] : [['wood', 1], ['leaf', 1]];
  if (kind === 'bush') { const h = hash3(seed, node, used); return h < 0.2 ? [['leaf', 1], ['flowerseed', 1]] : h < 0.5 ? [['leaf', 1], ['seed', 1]] : h < 0.75 ? [['leaf', 1]] : [['berries', 2]]; } // [bees] flower seeds [juicer] berries
  if (kind === 'rock') return [['stone', 1]];
  if (kind === 'sand') return [['sand', 1]];
  return [];
}

// Host gather check. st: {isl, layout, cx, cz, clock, cool:{host, guest}}. pos: actor {x, z} or null.
// Mutates bag, st.isl.used and st.cool only on success. Returns {ok, reason, loot}.
export function applyGather(st, a, actor, pos, bag) {
  const no = reason => ({ ok: false, reason, loot: null });
  if (!a || a.kind !== 'islands.gather') return no('kind');
  const isl = st && st.isl, lay = st && st.layout;
  if (!isl || !lay) return no('none');
  if (a.seed !== isl.seed) return no('stale');
  const k = a.node;
  if (!Number.isInteger(k) || k < 0 || k >= lay.nodes.length) return no('node');
  const n = lay.nodes[k];
  if (!(isl.used[k] < n.max)) return no('drained');
  if (!pos || !fin(pos.x) || !fin(pos.z)) return no('reach');
  const dx = pos.x - (st.cx + n.x), dz = pos.z - (st.cz + n.z);
  const who = actor === 'guest' ? 'guest' : 'host';
  const reach = ISLAND.REACH + (who === 'guest' ? ISLAND.GUEST_SLACK : 0);
  if (dx * dx + dz * dz > reach * reach) return no('reach');
  if (st.clock < (st.cool[who] || 0)) return no('cooldown');
  if (!bag || !Array.isArray(bag.slots) || typeof bag.snapshot !== 'function') return no('bag');
  const loot = lootFor(n.kind, isl.seed, k, isl.used[k]);
  let scratch;
  try { scratch = new bag.constructor(bag.snapshot()); } catch { return no('bag'); }
  for (const [kind, c] of loot) if (scratch.add(kind, c) > 0) return no('full');
  for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i];
  isl.used[k]++;
  st.cool[who] = st.clock + ISLAND.COOLDOWN;
  return { ok: true, reason: null, loot };
}

// Stand on island sand after PlayerPhysics.update(). g: sand height (world y) under the player or NaN,
// w: wave height there. s: per-player state {onSand, lastJump}. No allocation.
// While standing, the feet are kept DRY above the local wave (a few cm over the sand at most, only in
// the hysteresis band) so PlayerPhysics never sees wet feet and splashes.
const EYE = PLAYER_CONSTANTS.EYE_OFFSET, JUMP = PLAYER_CONSTANTS.JUMP_IMPULSE;
const DRY = PLAYER_CONSTANTS.WATER_ENTER + 0.03;
export function standOnSand(p, g, w, s) {
  if (p.climbing || !fin(g)) { s.onSand = false; s.lastJump = !!p._prevJump; return false; }
  // PlayerPhysics only jumps off raft tiles, so the hook reads its private _prevJump (the jump key as
  // of this frame's update). If a future PlayerPhysics drops that field it reads undefined, jumpEdge
  // stays false and jumping on sand is simply off: nothing breaks.
  const jumpNow = p._prevJump === true;
  const jumpEdge = jumpNow && !s.lastJump; s.lastJump = jumpNow;
  if (!fin(w)) w = g - 1;
  if (g < w + (s.onSand ? ISLAND.STAY_MARGIN : ISLAND.WALK_MARGIN)) {
    const up = g - (p.y - EYE);
    s.onSand = false;
    // Shallows: wade, sand under the feet lifts a swimmer gently instead of letting them sink into it.
    if (p.swimming && up > 0) { p.y = g + EYE; if (p.vy < 0) { p.vy = 0; p.verticalSpeed = 0; } }
    return false;
  }
  if (s.onSand && jumpEdge) {
    p.vy = JUMP; p.verticalSpeed = JUMP; p.grounded = false; s.onSand = false; return false;
  }
  const floor = g > w + DRY ? g : w + DRY, up = floor - (p.y - EYE);
  if (p.vy > 0 && up < 0) { s.onSand = false; return false; } // still rising from a jump
  const stick = s.onSand ? 0.35 : 0.06, step = p.swimming ? 1.6 : 0.6;
  if (up >= -stick && up <= step) {
    p.y = floor + EYE; p.vy = 0; p.verticalSpeed = 0; p.grounded = true; p.swimming = false; s.onSand = true;
    return true;
  }
  s.onSand = false;
  return false;
}
