// Dropped items (Q / drag out of the bag): pure host-side rules. No DOM, no Three.js.
// A drop is an ordinary floating supply in world.items with type 'drop', so the hook, E and the
// guest snapshot all use the existing debris path:
//   {id, token, type:'drop', kind, count, dur?, ttl, x, z, phase}
// The host ticks ttl down (seconds) and removes the drop at 0. `dur` keeps a tool's durability.

export const DROP_TTL = 90;          // s a dropped item floats before it sinks (Raft: ~90 s)
export const DROP_AHEAD = 1;         // m in front of the camera
export const DROP_REACH = 3;         // m: the requested drop point must be this close to the dropper
export const MAX_DROPS = 40;         // concurrent drops (snapshot items are capped at 80)
export const DROP_ID_BASE = 100000;  // drop ids never collide with the 0..29 debris lanes
const MAX_WALK = 40;                 // m searched outwards for open water

const VISUAL = { wood: 'wood', plank: 'wood', leaf: 'leaf', palm: 'leaf', seed: 'leaf', scrap: 'scrap', plastic: 'plastic' };
/** Debris model a dropped kind floats as (pooled debris variants; everything else bobs as a little scrap bundle). */
export function dropVisual(kind) { return Object.hasOwn(VISUAL, kind) ? VISUAL[kind] : 'scrap'; }

/** Loot table row for one drop: what collecting it gives back. */
export function dropLoot(it) { return it && it.type === 'drop' && typeof it.kind === 'string' && it.count > 0 ? { [it.kind]: it.count } : null; }

export function nextDropId(items) {
  let id = DROP_ID_BASE;
  for (const it of items) if (it && it.id >= id) id = it.id + 1;
  return id;
}

export function countDrops(items) { let n = 0; for (const it of items) if (it && it.type === 'drop') n++; return n; }

/**
 * First open-water point at or beyond (x,z) walking away from the dropper (px,pz).
 * hasTile(tx,tz) uses 2 m tile cells. Returns {x,z} or null.
 */
export function waterPoint(x, z, px, pz, hasTile) {
  const onTile = (ax, az) => hasTile(Math.round(ax / 2), Math.round(az / 2));
  if (!onTile(x, z)) return { x, z };
  let dx = x - px, dz = z - pz, l = Math.hypot(dx, dz);
  if (!(l > 1e-6)) { dx = 0; dz = -1; l = 1; }
  dx /= l; dz /= l;
  for (let d = 0.5; d <= MAX_WALK; d += 0.5) {
    const ax = x + dx * d, az = z + dz * d;
    if (!onTile(ax, az)) return { x: ax + dx * 0.6, z: az + dz * 0.6 }; // a little past the plank edge
  }
  return null;
}

/**
 * Host validation of a {kind:'drop', slot, count?, x?, z?} action.
 * bag: Bag; pose: actor {x,z} (null = unknown); items: world.items.
 * Returns {ok:true, slot, n, x, z} or {ok:false, reason:'bad'|'empty'|'reach'|'crowded'|'nowater'}.
 */
export function planDrop(a, bag, pose, items, hasTile) {
  const slots = bag?.slots;
  if (!a || !Array.isArray(slots) || !Number.isInteger(a.slot) || a.slot < 0 || a.slot >= slots.length) return { ok: false, reason: 'bad' };
  const s = slots[a.slot];
  if (!s || !(s.count > 0)) return { ok: false, reason: 'empty' };
  if (a.count !== undefined && (!Number.isInteger(a.count) || a.count < 1)) return { ok: false, reason: 'bad' };
  const n = Math.min(a.count ?? 1, s.count);
  if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z)) return { ok: false, reason: 'bad' };
  let x = pose.x, z = pose.z;
  if (a.x !== undefined || a.z !== undefined) {
    if (!Number.isFinite(a.x) || !Number.isFinite(a.z)) return { ok: false, reason: 'bad' };
    if (Math.hypot(a.x - pose.x, a.z - pose.z) > DROP_REACH) return { ok: false, reason: 'reach' };
    x = a.x; z = a.z;
  }
  if (countDrops(items) >= MAX_DROPS) return { ok: false, reason: 'crowded' };
  const w = waterPoint(x, z, pose.x, pose.z, hasTile);
  if (!w || Math.abs(w.x) >= 78 || Math.abs(w.z) >= 78) return { ok: false, reason: 'nowater' };
  return { ok: true, slot: a.slot, n, x: w.x, z: w.z };
}

/** Takes n from bag slot i (whole slot when n == count). Returns the drop payload {kind, count, dur?}. */
export function takeFromSlot(bag, i, n) {
  const s = bag.slots[i];
  const out = { kind: s.kind, count: n };
  if (s.durability !== undefined) out.dur = s.durability;
  if (n >= s.count) bag.slots[i] = null; else s.count -= n;
  bag.version = (bag.version | 0) + 1;
  return out;
}

export function makeDrop(id, token, taken, x, z, phase = 0) {
  const it = { id, token, type: 'drop', kind: taken.kind, count: taken.count, ttl: DROP_TTL, x, z, phase };
  if (taken.dur !== undefined) it.dur = taken.dur;
  return it;
}

/** Ticks drop ttl down; removes expired drops in place (skipping held tokens). Returns true when any sank. */
export function tickDrops(items, dt, held) {
  let gone = false;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.type !== 'drop') continue;
    if (held && held.has(it.token)) continue; // on a hook: it is being reeled in, let it arrive
    it.ttl -= dt;
    if (!(it.ttl > 0)) { items.splice(i, 1); gone = true; }
  }
  return gone;
}

/** Snapshot / save cleaner for the drop fields. isKind(kind) checks the item catalogue. Returns the extra fields or null. */
export function cleanDropFields(it, isKind) {
  if (!it || typeof it.kind !== 'string' || !isKind(it.kind) || !Number.isInteger(it.count) || it.count < 1 || it.count > 999) return null;
  const out = { kind: it.kind, count: it.count, ttl: Number.isFinite(it.ttl) ? Math.max(0, Math.min(DROP_TTL, it.ttl)) : DROP_TTL };
  if (Number.isFinite(it.dur)) out.dur = Math.max(0, Math.min(100, it.dur));
  return out;
}
