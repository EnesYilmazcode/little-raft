// Extra spear targets (besides the shark), so new creatures can take spear hits without game.js edits.
// Import with the same ?build= specifier as spear-repair-hooks.js so both share one registry.
//   const off = addSpearTarget((origin, dir, reach, dmg) => true if hit);   off() removes it.
const targets = new Set();

export function addSpearTarget(fn) {
  if (typeof fn !== 'function') return () => {};
  targets.add(fn);
  return () => targets.delete(fn);
}

/** First registered target that reports a hit wins. origin/dir: {x,y,z} (dir unit length). */
export function trySpearTargets(origin, dir, reach, dmg) {
  for (const fn of targets) {
    try { if (fn(origin, dir, reach, dmg) === true) return true; } catch (e) { console.error('spear target failed', e); }
  }
  return false;
}
