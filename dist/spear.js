// Spear rules (thrust timing, damage, wear). Pure ES module: no DOM, no THREE.
// Numbers: docs/loop/research/fidelity-r1-shark.md (wooden 5 dmg / 20 uses, metal 10 dmg / 40 uses).
import { SPEAR_DAMAGE, wearPerUse, toolRole } from './items.js?build=v3-survival-ae77fa84ac2b';

export const SPEAR_COOLDOWN = 0.7; // seconds between thrusts
export const SPEAR_REACH = 2.8;    // metres

export const isSpear = (kind) => toolRole(kind) === 'spear';
export const spearDamage = (kind) => SPEAR_DAMAGE[kind] ?? 0;

/** True when a thrust may start: lastAt is the time (s) of the previous thrust or -Infinity. */
export const canThrust = (now, lastAt) => !(now - lastAt < SPEAR_COOLDOWN - 1e-6);

/**
 * Apply one landed spear hit to a bag slot (mutates slot.durability, 0..100 scale).
 * Misses must not call this: wear is per hit, not per thrust.
 * Returns {before, after, broke} or null when the slot is not a spear.
 */
export function wearSpearSlot(slot) {
  if (!slot || !isSpear(slot.kind)) return null;
  const before = Math.min(100, Math.max(0, Number.isFinite(slot.durability) ? slot.durability : 100));
  const after = Math.max(0, before - wearPerUse(slot.kind));
  slot.durability = after < 1e-9 ? 0 : after;
  return { before, after: slot.durability, broke: before > 0 && slot.durability === 0 };
}

/**
 * Gate for one thrust: calls tryHit(damage) (e.g. shark.trySpear) only when the held item is a spear
 * with durability left. Does NOT wear the slot: the host applies wearSpearSlot() for a landed hit only.
 * Returns {hit, damage}.
 */
export function thrust(slot, tryHit) {
  const damage = spearDamage(slot?.kind);
  if (!damage || !(slot.durability > 0)) return { hit: false, damage };
  return { hit: typeof tryHit === 'function' && tryHit(damage) === true, damage };
}
