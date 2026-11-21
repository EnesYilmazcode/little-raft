// Islands: pure logic (no THREE, no DOM). Layout from a uint32 seed, where an island spawns and how the
// seabed offset moves it, save validation, loot rules, the host gather check and the stand-on-sand step.
// See docs/features/islands.md.
import { PLAYER_CONSTANTS } from './player-physics.js?build=v3-survival-ae77fa84ac2b';
import { toolRole, wearPerUse } from './items.js?build=v3-survival-ae77fa84ac2b';
import { SAIL, wrapAxis } from './sailing-core.js?build=v3-survival-ae77fa84ac2b';

export const ISLAND = Object.freeze({
  FIRST: 90,            // first island in a fresh world (s)
  CALM_MIN: 150, CALM_MAX: 240,
  NEXT_CAP: 600,        // a saved countdown never waits longer than this
  // Islands stay put on the seabed (Raft): they spawn ahead of the raft's travel, and the world moving
  // past the raft (the sailing seabed offset) is what brings them closer. Anchor or steer, or drift past.
  SPAWN_MIN: 120, SPAWN_MAX: 160, // metres ahead along the travel direction at spawn
  FIRST_MIN: 60, FIRST_MAX: 80,   // ...but the first island of a fresh world comes closer (Raft shows land early)
  LAT_MIN: 20, LAT_MAX: 40,       // metres to the side (side and size seeded)
  DESPAWN: 150,         // gone once this far away and behind the raft's travel...
  FAR: 220,             // ...or this far away in any direction
  RISE: 4, SINK: 3,     // seconds and metres the island rises out of / sinks into the sea at each end
  TOP: 0.9,             // dome top above the group origin (mean water)
  FALL: 1.8,            // TOP - FALL * u^4: shoreline at u ~ 0.84, -0.9 m at the rim
  RIM: 1.15,            // the sand mesh (and ground) stop here, in units of R
  REACH: 3.5,           // gather reach (m)
  COOLDOWN: 0.3,        // host per-actor gather cooldown (s)
  NEAR: 6,              // the island never leaves while a player is within R + NEAR
  OFF_MIN: 8, OFF_MAX: 60,
  MAX_NODES: 14,
  WALK_MARGIN: 0.25,    // step onto sand only where it is this far above the local wave...
  STAY_MARGIN: -0.1,    // ...but once standing, stay until a wave covers it by this much (hysteresis)
  GUEST_SLACK: 1.0,     // extra gather reach for the guest (the host sees a pose up to ~0.12 s old)
});

export const NODE_KINDS = Object.freeze(['palm', 'bush', 'rock', 'sand']);
export const NODE_MAX = Object.freeze({ palm: 5, bush: 2, rock: 3, sand: 4 });
// Palm chopping (Raft numbers, docs/loop/research/fidelity-r2b-world.md): a Stone Axe is needed, 5 chops
// fell a palm, the felling chop gives 5 planks + 2 leaves, and every chop rolls a coconut and a palm seed.
export const CHOP = Object.freeze({
  COOLDOWN: 0.6,        // local swing cooldown (s)
  HOST_COOLDOWN: 0.5,   // host per-actor chop cooldown (a little slack for network jitter)
  COCONUT: 0.176, SEED: 0.118,
  FELL: Object.freeze([['wood', 5], ['leaf', 2]]),
});
export const isAxe = kind => toolRole(kind) === 'axe';

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
export const wrapGround = v => wrapAxis(v, HG);

// Where a new island goes relative to the raft: `ahead` metres along the travel direction (dx, dz) and
// `lat` metres to its side, both seeded. (dx, dz) need not be unit length; zero falls back to +z (the
// current). first: the first island of a fresh world (FIRST_MIN..FIRST_MAX ahead instead of
// SPAWN_MIN..SPAWN_MAX). Writes out.x, out.z (raft-relative, metres). No allocation.
export function spawnRel(seed, dx, dz, out, first = false) {
  let m = fin(dx) && fin(dz) ? Math.sqrt(dx * dx + dz * dz) : 0;
  if (!(m > 1e-6)) { dx = 0; dz = 1; m = 1; }
  dx /= m; dz /= m;
  seed = seed >>> 0;
  const lo = first ? ISLAND.FIRST_MIN : ISLAND.SPAWN_MIN, hi = first ? ISLAND.FIRST_MAX : ISLAND.SPAWN_MAX;
  const ahead = lo + (hi - lo) * hash3(seed, 11, 1);
  const lat = (hash3(seed, 11, 3) < 0.5 ? -1 : 1) * (ISLAND.LAT_MIN + (ISLAND.LAT_MAX - ISLAND.LAT_MIN) * hash3(seed, 11, 2));
  out.x = dx * ahead + dz * lat; out.z = dz * ahead - dx * lat;
  return out;
}
// The island's raft-relative position from its seabed-absolute base (bx, bz) and the sailing seabed
// offset (gx, gz): the same rule that moves the scenery (sailing-world moveDrifters). Writes out.x, out.z.
export function islandRel(isl, gx, gz, out) {
  out.x = wrapGround(isl.bx - gx); out.z = wrapGround(isl.bz - gz);
  return out;
}
// Should an island at raft-relative (rx, rz) go, given this frame's seabed step (dgx, dgz)? It goes once
// it is DESPAWN metres away and behind the raft's travel, or FAR metres away in any direction. An
// anchored raft (no seabed step) never leaves a nearby island behind.
export function shouldDespawn(rx, rz, dgx, dgz) {
  const d2 = rx * rx + rz * rz;
  if (d2 > ISLAND.FAR * ISLAND.FAR) return true;
  return d2 > ISLAND.DESPAWN * ISLAND.DESPAWN && rx * dgx + rz * dgz < 0;
}
// Phase of a live island at `clock`: 'rise' (just spawned), 'here', 'sink' (leaving: isl.end is set) or
// 'gone'. out.sink: metres below its normal height. Writes into out (pass one to avoid allocating).
export function phaseAt(isl, clock, out = {}) {
  out.sink = 0;
  if (!isl) { out.phase = 'gone'; out.sink = ISLAND.SINK; return out; }
  if (fin(isl.end)) {
    const u = (clock - isl.end) / ISLAND.RISE;
    if (u >= 1) { out.phase = 'gone'; out.sink = ISLAND.SINK; }
    else { const k = u > 0 ? u : 0; out.phase = 'sink'; out.sink = ISLAND.SINK * k * k; }
    return out;
  }
  const age = clock - isl.born;
  if (age < ISLAND.RISE) { const k = 1 - (age > 0 ? age : 0) / ISLAND.RISE; out.phase = 'rise'; out.sink = ISLAND.SINK * k * k; }
  else out.phase = 'here';
  return out;
}

// Old (v1) saves: the island sailed in for 25 s, docked for `dock` s and sailed out over 30 s. Only used
// to migrate a saved island to where it was at save time (NaN once it had gone).
function legacyZ(t, dock, dockZ) {
  const A = 25, P = 30, S = -60, E = 60;
  if (!(t >= 0)) t = 0;
  if (t < A) return S + (dockZ - S) * (1 - (1 - t / A) ** 3);
  if (t < A + dock) return dockZ;
  if (t < A + dock + P) return dockZ + (E - dockZ) * ((t - A - dock) / P) ** 3;
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

// Validate a save / net slice. Never throws; always returns a fresh valid object.
// v2 island: {seed, born, bx, bz, used, end?}, with (bx, bz) its seabed-absolute base (see islandRel).
// ground: the sailing seabed offset {gx, gz} at load time, used to migrate a v1 (docking timeline) save:
// its island is placed where it was relative to the raft, and stays there on the seabed from then on.
export function clean(data, layoutOf = layoutFor, ground = null) {
  const out = DEFAULTS();
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data) || (data.v !== 1 && data.v !== 2)) return out;
    if (fin(data.clock) && data.clock >= 0) out.clock = Math.min(data.clock, 1e9);
    if (fin(data.next) && data.next >= 0) out.next = Math.min(data.next, out.clock + ISLAND.NEXT_CAP);
    else out.next = out.clock + ISLAND.FIRST;
    const i = data.isl;
    if (!i || typeof i !== 'object' || Array.isArray(i)) return out;
    if (!isSeed(i.seed) || !fin(i.born) || !Array.isArray(i.used)) return out;
    const lay = layoutOf(i.seed);
    let born = clamp(i.born, out.clock - 1e9, out.clock), bx, bz, end;
    if (data.v === 1) {
      if (!fin(i.dock) || !fin(i.off) || (i.side !== 1 && i.side !== -1)) return out;
      const z = legacyZ(out.clock - born, clamp(i.dock, 0, 600), lay.dockZ);
      if (!fin(z)) return out;
      const gx = ground && fin(ground.gx) ? ground.gx : 0, gz = ground && fin(ground.gz) ? ground.gz : 0;
      bx = wrapGround(gx + i.side * clamp(i.off, ISLAND.OFF_MIN, ISLAND.OFF_MAX)); bz = wrapGround(gz + z);
      born = Math.min(born, out.clock - ISLAND.RISE); // already up: no second rise
    } else {
      if (!fin(i.bx) || !fin(i.bz)) return out;
      bx = wrapGround(i.bx); bz = wrapGround(i.bz);
      if (fin(i.end)) { end = clamp(i.end, born, out.clock); if (out.clock - end >= ISLAND.RISE) return out; }
    }
    const used = lay.nodes.map((n, k) => { const v = i.used[k]; return Number.isInteger(v) ? clamp(v, 0, n.max) : 0; });
    out.isl = { seed: i.seed, born, bx, bz, used };
    if (end !== undefined) out.isl.end = end;
  } catch { return DEFAULTS(); }
  return out;
}

// What one chop of palm `node` gives when `used` chops are already done: per-chop coconut and seed rolls
// (deterministic from the island seed), plus the planks and leaves on the felling chop. Never empty-safe:
// a middle chop usually gives [] (nothing but progress).
export function chopLoot(seed, node, used) {
  const out = [];
  if (used === NODE_MAX.palm - 1) for (const e of CHOP.FELL) out.push([e[0], e[1]]);
  if (hash3(seed, (node | 0) * 8 + 101, used) < CHOP.COCONUT) out.push(['coconut', 1]);
  if (hash3(seed, (node | 0) * 8 + 102, used) < CHOP.SEED) out.push(['seed', 1]);
  return out;
}

// What one gather (or palm chop) gives: [[kind, count], ...].
export function lootFor(kind, seed, node, used) {
  if (kind === 'palm') return chopLoot(seed, node, used);
  if (kind === 'bush') { const h = hash3(seed, node, used); return h < 0.2 ? [['leaf', 1], ['flowerseed', 1]] : h < 0.5 ? [['leaf', 1], ['seed', 1]] : h < 0.75 ? [['leaf', 1]] : [['berries', 2]]; } // [bees] flower seeds [juicer] berries
  if (kind === 'rock') return [['stone', 1]];
  if (kind === 'sand') return [['sand', 1]];
  return [];
}

// Host gather check. st: {isl, layout, cx, cz, clock, cool:{host, guest}}. pos: actor {x, z} or null.
// Mutates bag, st.isl.used and st.cool only on success. Returns {ok, reason, loot}.
// Palms only take 'islands.chop' {seed, node, slot} with an axe in bag slot `slot` (durability left); the
// chop wears the axe by one use and a worn-out axe breaks (r.broke). Other nodes only take 'islands.gather'.
export function applyGather(st, a, actor, pos, bag) {
  const no = reason => ({ ok: false, reason, loot: null });
  if (!a || (a.kind !== 'islands.gather' && a.kind !== 'islands.chop')) return no('kind');
  const chop = a.kind === 'islands.chop';
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
  if ((n.kind === 'palm') !== chop) return no(chop ? 'node' : 'axe');
  if (st.clock < (st.cool[who] || 0)) return no('cooldown');
  if (!bag || !Array.isArray(bag.slots) || typeof bag.snapshot !== 'function') return no('bag');
  const si = a.slot;
  if (chop && !(Number.isInteger(si) && si >= 0 && si < bag.slots.length && bag.slots[si] && isAxe(bag.slots[si].kind) && bag.slots[si].durability > 0)) return no('axe');
  const loot = lootFor(n.kind, isl.seed, k, isl.used[k]);
  let scratch;
  try { scratch = new bag.constructor(bag.snapshot()); } catch { return no('bag'); }
  for (const [kind, c] of loot) if (scratch.add(kind, c) > 0) return no('full');
  for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i];
  isl.used[k]++;
  st.cool[who] = st.clock + (chop ? CHOP.HOST_COOLDOWN : ISLAND.COOLDOWN);
  let broke = false;
  if (chop) {
    const s = bag.slots[si], d = Math.max(0, Math.min(100, s.durability) - wearPerUse(s.kind));
    s.durability = d < 1e-9 ? 0 : d;
    if (s.durability === 0) { bag.slots[si] = null; broke = true; }
  }
  if (typeof bag.version === 'number') bag.version++;
  return { ok: true, reason: null, loot, felled: chop && isl.used[k] >= n.max, broke };
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
