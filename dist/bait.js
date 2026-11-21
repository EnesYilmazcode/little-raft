// [bait] Fishing bait tiers: pure data + helpers (no imports, no DOM). The best bait in the bag goes on the hook when a
// cast is released (fishing-cooking.js pointerUp); it shortens the wait and boosts rarer fish (fishing-v2 / fish-species).
// One bait is used up only when a fish is landed, by the host (game.js applyAction 'fish'). Spec: docs/specs/bait.md.
// API:
//   BAIT_ORDER (low -> high)   BAIT {id: {id,name,short,wait,boost}}   BAIT_FLOOR (s)   PREFS
//   isBait(id) baitWait(sec, id) pickBait(pref, count) nextPref(pref, count) baitLabel(pref, count) -> {text, dim}
//   count(kind) -> number owned (the glue passes host.bagCount)
const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { for (const v of Object.values(o)) deepFreeze(v); Object.freeze(o); }
  return o;
};

export const BAIT_ORDER = Object.freeze(['seaweedbait', 'chumbait', 'goldbait']); // low -> high
export const BAIT = deepFreeze({
  seaweedbait: { id: 'seaweedbait', name: 'Seaweed Bait', short: 'Seaweed', wait: 0.7, boost: { uncommon: 1.3 } },
  chumbait: { id: 'chumbait', name: 'Fish Chum', short: 'Chum', wait: 0.55, boost: { rare: 1.6, legendary: 1.6 } },
  goldbait: { id: 'goldbait', name: 'Golden Bait', short: 'Golden', wait: 0.5, boost: { rare: 2, legendary: 3 } },
});
export const BAIT_FLOOR = 1.5; // seconds: bait never makes a wait shorter than this
export const PREFS = Object.freeze(['auto', ...BAIT_ORDER, 'none']);

export const isBait = (id) => typeof id === 'string' && Object.hasOwn(BAIT, id);

/** No bait: sec unchanged. Bait: shorter, but never below BAIT_FLOOR and never longer than without bait. */
export function baitWait(sec, id) {
  if (!isBait(id)) return sec;
  return Math.min(sec, Math.max(BAIT_FLOOR, sec * BAIT[id].wait));
}

const owned = (count, k) => { try { const n = Number(count?.(k)); return Number.isFinite(n) && n > 0 ? n : 0; } catch { return 0; } };
const bestOwned = (count) => { for (let i = BAIT_ORDER.length - 1; i >= 0; i--) if (owned(count, BAIT_ORDER[i])) return BAIT_ORDER[i]; return null; };

/** 'none' -> null; an owned tier pref -> that tier; anything else -> best owned tier, else null. */
export function pickBait(pref, count) {
  if (pref === 'none') return null;
  if (isBait(pref) && owned(count, pref)) return pref;
  return bestOwned(count);
}

/** Right-click cycle: 'auto' -> each owned tier (low to high) -> 'none' -> 'auto'. A stale pref restarts at 'auto'. */
export function nextPref(pref, count) {
  const list = ['auto', ...BAIT_ORDER.filter((k) => owned(count, k)), 'none'];
  const i = list.indexOf(pref);
  return i < 0 ? 'auto' : list[(i + 1) % list.length];
}

/** HUD chip text for the bait the next cast would use. */
export function baitLabel(pref, count) {
  if (pref === 'none') return { text: 'Bait off', dim: true };
  const id = pickBait(pref, count);
  if (!id) return { text: 'No bait', dim: true };
  return { text: `🪱 ${BAIT[id].name} ×${owned(count, id)}`, dim: false };
}
