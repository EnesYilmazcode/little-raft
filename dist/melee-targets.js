// Melee targets share the spear target registry (spear-targets.js): one list, one pass per jab, so a jab
// can never land on two creatures. Kept as an alias so content modules can keep importing addMeleeTarget.
export { addSpearTarget as addMeleeTarget, trySpearTargets as tryMelee } from './spear-targets.js?build=v3-survival-ae77fa84ac2b';
