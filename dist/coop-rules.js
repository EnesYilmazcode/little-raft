// Small pure helpers for nets, co-op hook state and decor colliders. No DOM, no Three.js.

export const NET_RANGE = 4;
export const GUEST_HELD_TTL = 1500; // ms a guest's reported hook contents stay valid without a fresh move
const MAX_HELD = 32;

// True when every piece of loot fits the bag (tested on a scratch copy, like the collect action).
export function lootFits(bag, loot) {
  if (!bag || !loot) return false;
  const scratch = new bag.constructor(bag.snapshot());
  for (const [k, n] of Object.entries(loot)) if (scratch.add(k, n) > 0) return false;
  return true;
}

// First item near the net (tile coords) that is not held or pending and whose loot fits.
export function pickNetItem(items, net, {held = new Set(), isPending = () => false, fits = () => true} = {}) {
  for (const it of items) {
    if (held.has(it.token) || isPending(it)) continue;
    if (Math.hypot(it.x - net.x * 2, it.z - net.z * 2) >= NET_RANGE) continue;
    if (fits(it)) return it;
  }
  return null;
}

// Cleans the optional `held` field of a guest move message. Missing or malformed means none.
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
// along its seat (x -0.5, 0, 0.5, r 0.22) rotated by the decor's yaw, if it has one.
export const BENCH_CIRCLES = Object.freeze([[-.5, 0], [0, 0], [.5, 0]].map(([x, z]) => Object.freeze({x, z, r:.22})));
export function decorBlockers(d, radii) {
  const cx = d.x * 2, cz = d.z * 2;
  if (d.type === 'bench') {
    const yaw = Number.isFinite(d.yaw) ? d.yaw : 0, c = Math.cos(yaw), s = Math.sin(yaw);
    return BENCH_CIRCLES.map(b => ({x:cx + b.x * c + b.z * s, z:cz - b.x * s + b.z * c, r:b.r}));
  }
  return radii[d.type] ? [{x:cx, z:cz, r:radii[d.type]}] : [];
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
