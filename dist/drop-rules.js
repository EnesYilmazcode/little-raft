// Little Raft - Q drops one of the selected stack into the sea (pure rules, no scene/DOM).
// The host runs these: the item leaves the bag and floats next to the raft as a 'bundle' supply that
// carries exactly what was dropped ({kind, count, dur?}). Hooking or grabbing it gives exactly that back.

export const MAX_DROPS = 24;          // floating bundles at once; more are refused
export const DROP_ID0 = 1000;         // bundle ids start here (0..29 are the respawning debris slots)
export const DROP_GAP = 0.9;          // m beyond the deck edge
const DROP_REACH = 12;                // m, give up looking for open water past this
const STEP = 0.25;

/** Validated drop payload {kind, count, dur?} from a bundle item / message, or null. */
export function cleanDrop(it) {
  if (!it || typeof it.kind !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(it.kind)) return null;
  if (!Number.isInteger(it.count) || it.count < 1 || it.count > 99) return null;
  return Number.isFinite(it.dur) ? {kind:it.kind, count:it.count, dur:Math.min(100, Math.max(0, it.dur))} : {kind:it.kind, count:it.count};
}

/**
 * Take one item off bag.slots[slot]. Returns the payload {kind, count:1, dur?} or null (empty / bad slot).
 * Tools keep their wear in `dur`. Mutates the slot (and bumps bag.version when present).
 */
export function takeOne(bag, slot) {
  const slots = bag?.slots;
  if (!Array.isArray(slots) || !Number.isInteger(slot) || slot < 0 || slot >= slots.length) return null;
  const s = slots[slot];
  if (!s || typeof s.kind !== 'string' || !(s.count >= 1)) return null;
  const out = {kind:s.kind, count:1};
  if (Number.isFinite(s.durability)) out.dur = s.durability;
  s.count -= 1;
  if (s.count <= 0) slots[slot] = null;
  if (typeof bag.version === 'number') bag.version++;
  return out;
}

/**
 * Where a dropped item lands: walk from (px, pz) along the horizontal look (dx, dz) to the first open
 * water at least DROP_GAP past the deck. onTile(x, z) -> true over the raft (world metres). A player
 * already in the water drops it just in front. Falls back to the open water nearest behind/around.
 */
export function dropSpot(px, pz, dx, dz, onTile, out = {x:0, z:0}) {
  let l = Math.sqrt(dx * dx + dz * dz);
  if (!(l > 1e-6) || !Number.isFinite(l)) { dx = 0; dz = -1; l = 1; }
  dx /= l; dz /= l;
  for (let t = 0.6; t <= DROP_REACH; t += STEP) {
    const x = px + dx * t, z = pz + dz * t;
    if (onTile(x, z)) continue;
    const fx = x + dx * DROP_GAP, fz = z + dz * DROP_GAP;
    if (!onTile(fx, fz) && !nearTile(fx, fz, onTile)) { out.x = fx; out.z = fz; return out; }
  }
  // boxed in along the look (e.g. aiming across a long raft): try the other directions
  for (let k = 1; k < 8; k++) {
    const a = Math.atan2(dz, dx) + k * Math.PI / 4, ex = Math.cos(a), ez = Math.sin(a);
    for (let t = 0.6; t <= DROP_REACH * 2; t += STEP * 2) {
      const x = px + ex * t, z = pz + ez * t;
      if (!onTile(x, z) && !nearTile(x, z, onTile)) { out.x = x; out.z = z; return out; }
    }
  }
  out.x = px + dx * DROP_REACH; out.z = pz + dz * DROP_REACH; return out;
}
function nearTile(x, z, onTile) { const r = 0.45; return onTile(x + r, z) || onTile(x - r, z) || onTile(x, z + r) || onTile(x, z - r); }

/** Next free bundle id (ids are ints; debris and bottles use small ones). */
export function nextDropId(items) {
  let id = DROP_ID0 - 1;
  for (const it of items || []) if (it && Number.isInteger(it.id) && it.id > id) id = it.id;
  return Math.max(DROP_ID0, id + 1);
}

/** How many bundles are afloat. */
export function dropCount(items) { let n = 0; for (const it of items || []) if (it?.type === 'bundle') n++; return n; }

/** Bag.add metadata for a bundle payload (tools keep their wear). */
export const dropMeta = d => (Number.isFinite(d?.dur) ? {durability:d.dur} : {});
