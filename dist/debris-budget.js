// Debris spawn budget (Raft: flotsam only turns up while the raft moves). Pure ES module: no DOM, no THREE.
// game.js keeps a fixed pool of DEBRIS.POOL floating items. An item that drifts out of range (or bumps the raft)
// only comes back upstream when the budget holds a whole item; the budget fills with the distance the raft
// travels over the water, plus a small floor so a becalmed raft still sees the odd piece.
// Numbers: docs/loop/research/fidelity-r2b-world.md (k about 0.6 items per metre).

export const DEBRIS = Object.freeze({
  POOL: 30,        // fixed pool size (never grows)
  PER_METRE: 0.6,  // items earned per metre of raft travel over the water
  FLOOR: 0.05,     // items per second earned even when the raft is still
  CAP: 3,          // most whole items that can be banked (a burst after a long wait stays small)
});

const fin = (x) => typeof x === 'number' && Number.isFinite(x);

/** Speed of the water past the raft (m/s): sailing flow (fx,fz) plus the base drift along +z. */
export function debrisSpeed(fx, fz, base = 0) {
  const x = fin(fx) ? fx : 0, z = (fin(fz) ? fz : 0) + (fin(base) ? base : 0);
  return Math.sqrt(x * x + z * z);
}

/** Next budget after dt seconds at `speed` m/s over the water. Bad input never makes it NaN. */
export function stepDebrisBudget(budget, dt, speed) {
  const b = fin(budget) && budget > 0 ? budget : 0;
  if (!fin(dt) || dt <= 0) return Math.min(b, DEBRIS.CAP);
  const v = fin(speed) && speed > 0 ? speed : 0;
  return Math.min(DEBRIS.CAP, b + dt * (DEBRIS.PER_METRE * v + DEBRIS.FLOOR));
}

/** Spend one item from st.budget. Returns true (and decrements) when a respawn is allowed. */
export function spendDebris(st) {
  if (!st || !(st.budget >= 1)) return false;
  st.budget -= 1;
  return true;
}
