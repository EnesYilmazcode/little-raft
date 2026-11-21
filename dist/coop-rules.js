// Small pure helpers for bag fits, co-op hook state and decor colliders. No DOM, no Three.js.

import { blockerGap } from './player-physics.js?build=v3-survival-ae77fa84ac2b';

export const GUEST_HELD_TTL = 1500; // ms a guest's reported hook contents stay valid without a fresh move
const MAX_HELD = 32;

// True when every piece of loot fits the bag (tested on a scratch copy, like the collect action).
export function lootFits(bag, loot) {
  if (!bag || !loot) return false;
  const scratch = new bag.constructor(bag.snapshot());
  for (const [k, n] of Object.entries(loot)) if (scratch.add(k, n) > 0) return false;
  return true;
}

// Items a hook may sweep or keep: not pending, and not on the other player's hook unless our own hook
// already holds it. The first claimer keeps an item; HookCast drops caught entries missing from this list.
export function hookableItems(items, {isPending = () => false, otherHeld = new Set(), ownHeld = new Set()} = {}) {
  return items.filter(it => !isPending(it) && (!otherHeld.has(it.token) || ownHeld.has(it.token)));
}

// Cleans the optional `held` field of a guest move message (or the host's state). Missing or malformed means none.
export function cleanHeldTokens(v) {
  if (!Array.isArray(v)) return [];
  return v.filter(t => (typeof t === 'string' && t.length > 0 && t.length <= 64) || Number.isFinite(t)).slice(0, MAX_HELD);
}

// Host-side record of the tokens the guest's hook holds, expiring when the guest stops reporting.
export function createGuestHeld(ttl = GUEST_HELD_TTL) {
  let tokens = [], until = 0;
  return {
    note(v, now) { tokens = cleanHeldTokens(v); until = now + ttl; },
    clear() { tokens = []; until = 0; },
    tokens(now) { return now < until ? tokens : []; },
  };
}

// Collision circles for one decor piece. The bench is long and thin, so it gets three small circles
// along its seat (x -0.5, 0, 0.5, r 0.22) rotated by the decor's yaw (or placement rot), if it has one.
// unit: metres per decor coordinate (2 = legacy tile cells, 1 = raft-local metres).
export const BENCH_CIRCLES = Object.freeze([[-.5, 0], [0, 0], [.5, 0]].map(([x, z]) => Object.freeze({x, z, r:.22})));
export function decorBlockers(d, radii, unit = 2) {
  const cx = d.x * unit, cz = d.z * unit;
  if (d.type === 'bench') {
    const yaw = Number.isFinite(d.yaw) ? d.yaw : Number.isFinite(d.rot) ? d.rot : 0, c = Math.cos(yaw), s = Math.sin(yaw);
    return BENCH_CIRCLES.map(b => ({x:cx + b.x * c + b.z * s, z:cz - b.x * s + b.z * c, r:b.r}));
  }
  const r = radii[d.type];
  if (Array.isArray(r)) return [{x:cx, z:cz, hx:r[0], hz:r[1], rot:Number.isFinite(d.rot) ? d.rot : 0}]; // [half width, half depth]: the placement footprint
  return r ? [{x:cx, z:cz, r}] : [];
}

// Index of the first player ({x, z} raft-local; null/stale entries skipped) whose body (radius r)
// a new piece's blockers would overlap, or -1. Shared by the ghost check and the host's build check.
export function playerInWay(blockers, players, r) {
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    if (blockers.some(b => b && Number.isFinite(b.x) && Number.isFinite(b.z) && blockerGap(b, p.x, p.z) < r)) return i;
  }
  return -1;
}

// Which hook slot R repairs: the preferred (selected) slot if it holds a hook, else the most worn
// hook below `max`, else the first hook (already in great shape). -1 when there is no hook.
export function repairHookSlot(slots, prefer, max = 100) {
  if (!Array.isArray(slots)) return -1;
  if (Number.isInteger(prefer) && slots[prefer]?.kind === 'hook') return prefer;
  let best = -1, worst = max;
  slots.forEach((s, i) => {
    if (s?.kind !== 'hook') return;
    const d = Number.isFinite(s.durability) ? s.durability : max;
    if (best < 0 || d < worst) { best = i; worst = d; }
  });
  return best;
}
