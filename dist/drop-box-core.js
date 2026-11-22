// Dropped item boxes: pure rules (no THREE, no DOM). Q drops one of the held item, Ctrl+Q the whole stack;
// the items land in a small floating box a step ahead. Drops close in time and space share one box.
// A box rests on the raft deck (moves with it), on island sand, or floats and drifts away in open water,
// where it sinks after DESPAWN seconds. Slice: world.ext.dropbox = {v:1, n, boxes:[...]}, host-authoritative.
// Unit tested in tests/drop-box.test.mjs.
import { ITEM_INFO } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';

export const DROP = Object.freeze({
  THROW: 1.3,        // metres ahead of the dropper's feet where the box lands
  MERGE_S: 5,        // a drop within this many seconds of the last one into a box joins it...
  MERGE_R: 1.6,      // ...when it lands within this many metres of it
  MAX_BOXES: 40, MAX_STACKS: 28, MAX_COUNT: 9999,
  DESPAWN: 600,      // seconds adrift in open water before a box is lost
  RANGE: 150,        // a box drifting further than this from the raft is lost
  REACH: 3.2,        // pick-up reach from the camera
  GUEST_SLACK: 1,    // extra host-side reach for a guest's lagged pose
  FLY: .45,          // seconds of the throw arc
});

const fin = v => typeof v === 'number' && Number.isFinite(v);
const isKind = k => typeof k === 'string' && Object.prototype.hasOwnProperty.call(ITEM_INFO, k);
const clampAbs = (v, m) => (v < -m ? -m : v > m ? m : v);
const STATES = ['raft', 'sea', 'land'];

export const emptySlice = () => ({ v: 1, n: 1, boxes: [] });

/** One clean stack {kind, count, durability?, id?} or null. */
export function cleanStack(s) {
  if (!s || typeof s !== 'object' || !isKind(s.kind)) return null;
  const count = Number.isInteger(s.count) ? Math.min(s.count, DROP.MAX_COUNT) : 0;
  if (count < 1) return null;
  const out = { kind: s.kind, count };
  if (fin(s.durability)) out.durability = Math.max(0, Math.min(100, s.durability));
  if (typeof s.id === 'string' && s.id && s.id.length < 80) out.id = s.id;
  return out;
}

function cleanBox(b, seen) {
  if (!b || typeof b !== 'object' || !Number.isInteger(b.id) || b.id < 1 || seen.has(b.id)) return null;
  if (!fin(b.x) || !fin(b.z)) return null;
  const items = [];
  if (Array.isArray(b.items)) for (const s of b.items) { const c = cleanStack(s); if (c && items.length < DROP.MAX_STACKS) items.push(c); }
  if (!items.length) return null;
  seen.add(b.id);
  const box = { id: b.id, x: clampAbs(b.x, DROP.RANGE), z: clampAbs(b.z, DROP.RANGE), s: STATES.includes(b.s) ? b.s : 'sea',
    r: fin(b.r) ? b.r : 0, age: fin(b.age) && b.age > 0 ? Math.min(b.age, DROP.DESPAWN) : 0, m: fin(b.m) && b.m > 0 ? Math.min(b.m, DROP.MERGE_S) : 0,
    f: fin(b.f) && b.f > 0 ? Math.min(b.f, DROP.FLY) : 0, items };
  if (box.s === 'land') box.y = fin(b.y) ? b.y : 0;
  if (box.f > 0 && Array.isArray(b.o) && b.o.length === 3 && b.o.every(fin)) box.o = [b.o[0], b.o[1], b.o[2]];
  else box.f = 0;
  return box;
}

/** Validated copy of a saved / received slice. Anything unusable comes back as an empty slice. */
export function cleanSlice(v) {
  const out = emptySlice();
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  const seen = new Set();
  if (Array.isArray(v.boxes)) for (const b of v.boxes) {
    if (out.boxes.length >= DROP.MAX_BOXES) break;
    const c = cleanBox(b, seen); if (c) out.boxes.push(c);
  }
  let n = Number.isInteger(v.n) && v.n >= 1 ? v.n : 1;
  for (const b of out.boxes) if (b.id >= n) n = b.id + 1;
  out.n = n;
  return out;
}

export function hasTile(tiles, x, z) {
  if (!Array.isArray(tiles)) return false;
  const tx = Math.round(x / 2), tz = Math.round(z / 2);
  for (let i = 0; i < tiles.length; i++) { const t = tiles[i]; if (t[0] === tx && t[1] === tz) return true; }
  return false;
}

/** Where a box thrown from (px, pz) along (fx, fz) lands. out = {x, z}. */
export function landing(px, pz, fx, fz, out = { x: 0, z: 0 }) {
  const l = Math.hypot(fx, fz), ux = l > 1e-6 ? fx / l : 0, uz = l > 1e-6 ? fz / l : -1;
  out.x = clampAbs(px + ux * DROP.THROW, DROP.RANGE); out.z = clampAbs(pz + uz * DROP.THROW, DROP.RANGE);
  return out;
}

/** Surface under (x, z): 'raft' on a deck tile, 'land' on island sand above the water, else 'sea'. */
export function classify(tiles, x, z, ground = NaN, water = 0) {
  if (hasTile(tiles, x, z)) return 'raft';
  if (ground === ground && ground > water) return 'land';
  return 'sea';
}

/**
 * Take the stack to drop out of bag slot `slot`: one item, or the whole stack when all.
 * expect (optional) must match the slot's kind, so a lagged guest never drops the wrong thing.
 * Mutates the bag; returns the stack {kind, count, durability?, id?} or null.
 */
export function takeFromSlot(bag, slot, all, expect) {
  if (!bag || !Array.isArray(bag.slots) || !Number.isInteger(slot) || slot < 0 || slot >= bag.slots.length) return null;
  const s = bag.slots[slot];
  if (!s || !isKind(s.kind) || !(s.count >= 1) || (expect !== undefined && expect !== s.kind)) return null;
  const n = all ? s.count : 1;
  const out = { kind: s.kind, count: n };
  if (fin(s.durability)) out.durability = s.durability;
  if (typeof s.id === 'string' && s.id && n === s.count) out.id = s.id; // an id belongs to one slot: it travels only with the whole stack
  s.count -= n;
  if (s.count <= 0) bag.slots[slot] = null;
  if (Number.isInteger(bag.version)) bag.version++;
  return out;
}

/** Put a stack into a box: plain stacks of one kind fold together; tools and id'd items keep their own entry. */
export function addStack(box, stack) {
  const c = cleanStack(stack); if (!c || !box || !Array.isArray(box.items)) return false;
  const plain = c.durability === undefined && c.id === undefined;
  if (plain) for (const e of box.items) if (e.kind === c.kind && e.durability === undefined && e.id === undefined && e.count + c.count <= DROP.MAX_COUNT) { e.count += c.count; return true; }
  if (box.items.length >= DROP.MAX_STACKS) return false;
  box.items.push(c); return true;
}

/** A recent box near (x, z) that a new drop joins, or null. */
export function mergeTarget(boxes, x, z) {
  let best = null, bd = DROP.MERGE_R;
  for (const b of boxes) {
    if (!(b.m > 0) || b.items.length >= DROP.MAX_STACKS) continue;
    const d = Math.hypot(b.x - x, b.z - z);
    if (d <= bd) { bd = d; best = b; }
  }
  return best;
}

/**
 * Host: drop `stack` at (x, z). Joins a recent nearby box or starts a new one.
 * opts: {tiles, ground, water, origin:[x,y,z], r}. -> the box, or null when the sea is full of boxes.
 */
export function dropInto(slice, stack, x, z, opts = {}) {
  const join = mergeTarget(slice.boxes, x, z);
  if (join && addStack(join, stack)) { join.m = DROP.MERGE_S; return join; }
  if (slice.boxes.length >= DROP.MAX_BOXES) return null;
  const s = classify(opts.tiles, x, z, opts.ground, opts.water);
  const box = { id: slice.n++, x, z, s, r: fin(opts.r) ? opts.r : 0, age: 0, m: DROP.MERGE_S, f: 0, items: [] };
  if (s === 'land') box.y = opts.ground;
  if (Array.isArray(opts.origin) && opts.origin.length === 3 && opts.origin.every(fin)) { box.f = DROP.FLY; box.o = opts.origin.slice(); }
  if (!addStack(box, stack)) return null;
  slice.boxes.push(box);
  return box;
}

/**
 * Move every stack that fits into the bag. -> {loot:{kind:n}, taken, empty}. Items that don't fit stay in the box.
 */
export function takeInto(bag, box) {
  const loot = {}; let taken = 0;
  if (!bag || !box || !Array.isArray(box.items)) return { loot, taken, empty: !box?.items?.length };
  const keep = [];
  for (const e of box.items) {
    const meta = {}; if (e.durability !== undefined) meta.durability = e.durability; if (e.id !== undefined) meta.id = e.id;
    const left = bag.add(e.kind, e.count, meta);
    const got = e.count - (Number.isInteger(left) ? left : e.count);
    if (got > 0) { loot[e.kind] = (loot[e.kind] || 0) + got; taken += got; }
    if (got < e.count) { e.count -= got; keep.push(e); }
  }
  box.items = keep;
  return { loot, taken, empty: keep.length === 0 };
}

/**
 * One step of a box. flow = {x, z, b} (sailing water flow past the raft, b = base +z drift).
 * env = {tiles, ground(x, z) -> y | NaN, water(x, z) -> y, carryX, carryZ (island motion this step), clock}.
 * Host and guest both run it (the guest between host snapshots). -> true when the box is lost (despawned).
 */
export function stepBox(b, dt, flow, env) {
  if (!(dt > 0)) return false;
  if (b.m > 0) b.m = Math.max(0, b.m - dt);
  if (b.f > 0) { b.f = Math.max(0, b.f - dt); if (b.f === 0) delete b.o; return false; } // in the air: lands where it was aimed
  const tiles = env?.tiles;
  if (b.s === 'raft') {
    if (!hasTile(tiles, b.x, b.z)) b.s = 'sea'; // its plank is gone: into the water
    else return false;
  }
  if (b.s === 'land') {
    b.x += env?.carryX || 0; b.z += env?.carryZ || 0;
    const g = env?.ground ? env.ground(b.x, b.z) : NaN, w = env?.water ? env.water(b.x, b.z) : 0;
    if (g === g && g > w) { b.y = g; return false; }
    b.s = 'sea'; delete b.y; // the island left or sank
  }
  const fx = (flow?.x || 0) + Math.sin((env?.clock || 0) * .13 + b.id) * .04, fz = (flow?.z || 0) + (flow?.b || 0);
  const nx = b.x + fx * dt, nz = b.z + fz * dt;
  if (!hasTile(tiles, nx, nz)) { b.x = nx; b.z = nz; } // bumps against the raft edge instead of drifting through it
  else if (!hasTile(tiles, nx, b.z)) b.x = nx;
  else if (!hasTile(tiles, b.x, nz)) b.z = nz;
  b.age += dt;
  return b.age >= DROP.DESPAWN || Math.abs(b.x) > DROP.RANGE || Math.abs(b.z) > DROP.RANGE;
}

/** Plain, JSON-safe copy for saves and the network. */
export function serializeSlice(slice) {
  return { v: 1, n: slice.n, boxes: slice.boxes.map(b => {
    const o = { id: b.id, x: Math.round(b.x * 1000) / 1000, z: Math.round(b.z * 1000) / 1000, s: b.s, r: Math.round(b.r * 1000) / 1000,
      age: Math.round(b.age * 10) / 10, m: Math.round(b.m * 100) / 100, f: Math.round(b.f * 100) / 100, items: b.items.map(e => ({ ...e })) };
    if (b.s === 'land') o.y = Math.round(b.y * 1000) / 1000;
    if (b.o) o.o = b.o.slice();
    return o;
  }) };
}
