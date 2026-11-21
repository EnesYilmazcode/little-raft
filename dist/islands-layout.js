// Islands: pure logic (no THREE, no DOM). Layout from a uint32 seed, the drift timeline, save
// validation, loot rules, the host gather check and the stand-on-sand step. See docs/features/islands.md.
import { PLAYER_CONSTANTS } from './player-physics.js';

export const ISLAND = Object.freeze({
  FIRST: 90,            // first island in a fresh world (s)
  CALM_MIN: 150, CALM_MAX: 240,
  APPROACH: 25, DOCK: 180, DOCK_CAP: 600, DEPART: 30, WARN: 30,
  START_Z: -60, END_Z: 60,
  RISE: 4, SINK: 3,     // seconds and metres the island rises out of / sinks into the sea at each end
  TOP: 0.9,             // dome top above the group origin (mean water)
  FALL: 1.8,            // TOP - FALL * u^4: shoreline at u ~ 0.84, -0.9 m at the rim
  RIM: 1.15,            // the sand mesh (and ground) stop here, in units of R
  REACH: 3.5,           // gather reach (m)
  COOLDOWN: 0.3,        // host per-actor gather cooldown (s)
  NEAR: 6,              // departure waits while a player is within R + NEAR
  OFF_MIN: 8, OFF_MAX: 60,
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

const easeOut = u => 1 - (1 - u) * (1 - u) * (1 - u);
const easeIn = u => u * u * u;
// Where the island is t seconds after it was born. Writes into out (pass one to avoid allocating).
// out.left: seconds left in this phase. out.sink: metres below its normal height (rising/sinking).
export function pathAt(t, dock, dockZ = 0, out = {}) {
  const A = ISLAND.APPROACH, D = fin(dock) ? Math.max(0, dock) : ISLAND.DOCK, P = ISLAND.DEPART;
  if (!fin(t) || t < 0) t = 0;
  out.sink = 0;
  if (t < A) {
    out.phase = 'approach'; out.left = A - t;
    out.z = ISLAND.START_Z + (dockZ - ISLAND.START_Z) * easeOut(t / A);
    if (t < ISLAND.RISE) { const k = 1 - t / ISLAND.RISE; out.sink = ISLAND.SINK * k * k; }
  } else if (t < A + D) {
    out.phase = 'docked'; out.left = A + D - t; out.z = dockZ;
  } else if (t < A + D + P) {
    const u = (t - A - D) / P;
    out.phase = 'depart'; out.left = A + D + P - t;
    out.z = dockZ + (ISLAND.END_Z - dockZ) * easeIn(u);
    if (out.left < ISLAND.RISE) { const k = 1 - out.left / ISLAND.RISE; out.sink = ISLAND.SINK * k * k; }
  } else {
    out.phase = 'gone'; out.left = 0; out.z = ISLAND.END_Z; out.sink = ISLAND.SINK;
  }
  return out;
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

export const DEFAULTS = () => ({ v: 1, clock: 0, next: ISLAND.FIRST, isl: null });

// Validate a save / net slice. Never throws; always returns a fresh valid object.
export function clean(data, layoutOf = layoutFor) {
  const out = DEFAULTS();
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1) return out;
    if (fin(data.clock) && data.clock >= 0) out.clock = Math.min(data.clock, 1e9);
    if (fin(data.next) && data.next >= 0) out.next = Math.min(data.next, out.clock + ISLAND.DOCK_CAP);
    else out.next = out.clock + ISLAND.FIRST;
    const i = data.isl;
    if (!i || typeof i !== 'object' || Array.isArray(i)) return out;
    if (!isSeed(i.seed) || !fin(i.born) || !fin(i.dock) || !fin(i.off) || (i.side !== 1 && i.side !== -1) || !Array.isArray(i.used)) return out;
    const lay = layoutOf(i.seed);
    const born = clamp(i.born, out.clock - (ISLAND.APPROACH + ISLAND.DOCK_CAP + ISLAND.DEPART), out.clock);
    const dock = clamp(i.dock, 0, ISLAND.DOCK_CAP);
    if (pathAt(out.clock - born, dock, lay.dockZ, {}).phase === 'gone') return out;
    const used = lay.nodes.map((n, k) => { const v = i.used[k]; return Number.isInteger(v) ? clamp(v, 0, n.max) : 0; });
    out.isl = { seed: i.seed, born, dock, side: i.side, off: clamp(i.off, ISLAND.OFF_MIN, ISLAND.OFF_MAX), used };
  } catch { return DEFAULTS(); }
  return out;
}

// What one gather gives: [[kind, count], ...].
export function lootFor(kind, seed, node, used) {
  if (kind === 'palm') return used === NODE_MAX.palm - 1 ? [['wood', 1], ['leaf', 1], ['seed', 1]] : [['wood', 1], ['leaf', 1]];
  if (kind === 'bush') return hash3(seed, node, used) < 0.5 ? [['leaf', 1], ['seed', 1]] : [['leaf', 1]];
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
