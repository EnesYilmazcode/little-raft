// Diving gear: pure logic (no imports, no DOM). docs/specs/diving-gear.md
// Gear works while it is in your bag; each kind counts once. Effects are multipliers on DiveMods
// ({swim, oxy, fog, gather}, neutral 1) and always multiply, so they stack with other contributors.
export const GEAR_IDS = Object.freeze(['fins', 'airjug', 'goggles', 'scraper', 'headlamp']); // bit i = GEAR_IDS[i]; append only
export const GEAR = Object.freeze({ fins: Object.freeze({ swim: 1.3 }), airjug: Object.freeze({ oxy: 75 / 45 }),
  goggles: Object.freeze({ fog: 46 / 30 }), scraper: Object.freeze({ gather: 0.6 }),
  headlamp: Object.freeze({ fog: 1.25 }) }); // headlamp: a lamp beam lifts the murk a little; stacks with goggles
const FIELDS = Object.freeze(['swim', 'oxy', 'fog', 'gather']);
const ALL = (1 << GEAR_IDS.length) - 1;

export function blankMods(out = {}) { out.swim = out.oxy = out.fog = out.gather = 1; return out; }

/** count(kind) -> number. Bit i is set when count(GEAR_IDS[i]) > 0. Never throws. */
export function gearMask(count) {
  if (typeof count !== 'function') return 0;
  let mask = 0;
  for (let i = 0; i < GEAR_IDS.length; i++) {
    let n = 0;
    try { n = count(GEAR_IDS[i]); } catch { n = 0; }
    if (typeof n === 'number' && n > 0) mask |= 1 << i;
  }
  return mask;
}

/** Multiplies out's fields by the gear of each set bit. Bad mask or out -> unchanged. Returns out. */
export function applyGear(mask, out) {
  if (!out || typeof out !== 'object' || !Number.isInteger(mask) || mask <= 0) return out;
  mask &= ALL;
  for (let i = 0; i < GEAR_IDS.length; i++) {
    if (!(mask & (1 << i))) continue;
    const g = GEAR[GEAR_IDS[i]];
    for (let f = 0; f < FIELDS.length; f++) { const k = FIELDS[f]; if (g[k] !== undefined) out[k] *= g[k]; }
  }
  return out;
}

/** Fills (and clears) list with the worn ids in GEAR_IDS order; returns it. */
export function maskIds(mask, list = []) {
  list.length = 0;
  if (!Number.isInteger(mask) || mask <= 0) return list;
  for (let i = 0; i < GEAR_IDS.length; i++) if (mask & (1 << i)) list.push(GEAR_IDS[i]);
  return list;
}
