// Melee target registry: lets content modules (the island tusker, future creatures) take spear hits without
// game.js wiring. spear-repair-hooks.js calls tryMelee() after the shark misses. A target is
// fn(origin, dir, reach, dmg) -> true when it was hit (it applies or sends the damage itself).
const targets = [];
export function addMeleeTarget(fn) {
  if (typeof fn === 'function' && !targets.includes(fn)) targets.push(fn);
  return () => { const i = targets.indexOf(fn); if (i >= 0) targets.splice(i, 1); };
}
export function tryMelee(origin, dir, reach, dmg) {
  for (let i = 0; i < targets.length; i++) {
    try { if (targets[i](origin, dir, reach, dmg) === true) return true; } catch (e) { console.error('melee target failed', e); }
  }
  return false;
}
