// Wooden spear: pure stab timing, hit maths, wear and shark-meat loot. No DOM, no THREE, no timers.
// game.js drives it (see the `// [spear]` blocks there); the viewmodel lives in spear-model.js.
//
//   const st = createStab();
//   startStab(st)            -> true when a stab begins (false while one runs or the cooldown is on)
//   tickStab(st, dt)         -> true on the one frame the thrust reaches its peak (do the hit test then)
//   stabAmount(st)           -> 0..1 forward thrust for the arm (0 = rest, 1 = fully extended)
//   rayHit(o, d, p, out)     -> distance along the ray to the closest approach when p is within
//                               SPEAR.radius of the reach segment, else -1; `out` gets the hit point
//   wearSpear(bag, index)    -> {durability, broke} after one successful hit, or null if no spear there
//   giveSharkMeat(bag, n)    -> {added, lost}
// Every function reuses its arguments: nothing allocates per frame (except the small result objects
// of wearSpear / giveSharkMeat, which only run on a hit or a kill).
import { wearPerUse } from './items.js';

export const SPEAR = Object.freeze({
  kind: 'spear',
  damage: 5,          // per hit (shark.hit(damage, point, dir))
  reach: 2.6,         // metres along the camera direction
  radius: 1.2,        // how far the shark's centre may be from the stab line
  stabTime: 0.35,     // thrust out and back
  peakAt: 0.4,        // fraction of stabTime at which the tip is fully out (the hit frame)
  cooldown: 0.6,      // seconds from one stab's start to the next
  meatDrop: 4,        // raw shark meat per kill
});

export function createStab() { return { t: -1, cd: 0, peaked: false }; }

export function startStab(st) {
  if (!st || st.cd > 0 || st.t >= 0) return false;
  st.t = 0; st.cd = SPEAR.cooldown; st.peaked = false;
  return true;
}

export function tickStab(st, dt) {
  if (!st) return false;
  const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
  st.cd = st.cd > d ? st.cd - d : 0;
  if (st.t < 0) return false;
  st.t += d;
  let fire = false;
  if (!st.peaked && st.t >= SPEAR.stabTime * SPEAR.peakAt) { st.peaked = true; fire = true; }
  if (st.t >= SPEAR.stabTime) st.t = -1;
  return fire;
}

// Fast ease out to the peak, slower ease back.
export function stabAmount(st) {
  if (!st || st.t < 0) return 0;
  const p = st.t / SPEAR.stabTime, k = SPEAR.peakAt;
  if (p <= k) { const u = p / k; return 1 - (1 - u) * (1 - u); }
  const u = Math.min(1, (p - k) / (1 - k));
  return 1 - u * u * (3 - 2 * u);
}

// o, d, p: {x,y,z}; d should be unit length (it is normalised on the fly without allocating).
export function rayHit(o, d, p, out = null, reach = SPEAR.reach, radius = SPEAR.radius) {
  if (!o || !d || !p) return -1;
  const len = Math.hypot(d.x, d.y, d.z);
  if (!(len > 1e-9) || !Number.isFinite(o.x + o.y + o.z + p.x + p.y + p.z)) return -1;
  const dx = d.x / len, dy = d.y / len, dz = d.z / len;
  const vx = p.x - o.x, vy = p.y - o.y, vz = p.z - o.z;
  let t = vx * dx + vy * dy + vz * dz;
  if (t < 0) t = 0; else if (t > reach) t = reach;
  const cx = o.x + dx * t, cy = o.y + dy * t, cz = o.z + dz * t;
  const dist = Math.hypot(p.x - cx, p.y - cy, p.z - cz);
  if (dist > radius) return -1;
  if (out) { out.x = cx; out.y = cy; out.z = cz; }
  return t;
}

// One hit's wear on bag.slots[index] (5% per hit: 20 uses). At 0 the spear snaps and the slot empties.
export function wearSpear(bag, index) {
  const s = bag?.slots?.[index];
  if (!s || s.kind !== SPEAR.kind) return null;
  const before = Number.isFinite(s.durability) ? s.durability : 100;
  const after = Math.max(0, Math.round((before - wearPerUse(SPEAR.kind)) * 1000) / 1000);
  if (after <= 0) bag.slots[index] = null; else s.durability = after;
  if (Number.isFinite(bag.version)) bag.version++;
  return { durability: after, broke: after <= 0 };
}

// Kill loot straight into a bag (Bag.add returns how many did not fit).
export function giveSharkMeat(bag, n = SPEAR.meatDrop) {
  if (!bag || typeof bag.add !== 'function') return { added: 0, lost: n };
  const lost = bag.add('sharkmeat', n) || 0;
  return { added: n - lost, lost };
}
