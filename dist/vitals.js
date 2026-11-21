// Little Raft vitals: health, food and water (0..100). Pure state + rules, no DOM, no THREE.
// Numbers from docs/loop/research/fidelity-r1-survival.md (Raft "Normal" rates; [G] = our tuning).
//
//   const v = newVitals();               // {hp:100, food:100, water:100, hurtAt:-Infinity, clock:0, starving:false}
//   tickVitals(v, dt, {mult})            // mult: 1 normal, SPRINT_MULT while sprinting/swimming. Returns v.
//   damage(v, n, cause)                  // -> HP actually lost; blocks regen for REGEN_DELAY seconds
//   consume(v, kind)                     // -> {food, water, returns} applied deltas, or null if not edible
//   FOOD[kind] = {food, water, returns?} // other lanes may add entries (addFood helper validates)
//   cleanVitals(raw)                     // save validation: -> {hp, food, water} (missing/invalid -> full)
//   saveVitals(v)                        // -> {hp, food, water} rounded to 0.1 for the save

export const MAX = 100;
export const HUNGER_RATE = 0.09;  // food per second
export const THIRST_RATE = 0.11;  // water per second
export const SPRINT_MULT = 1.5;   // sprinting or swimming [G]
export const STARVE_HP = 0.75;    // HP/s per empty bar (they stack)
export const REGEN_HP = 0.25;     // HP/s while food > 0 and water > 0
export const REGEN_DELAY = 3;     // seconds without damage before regen [G]
export const EAT_SECONDS = 0.8;   // hold-free eat/drink action [G]
export const RESPAWN = Object.freeze({hp:100, food:75, water:75}); // [G]

export const FOOD = {
  fish:            {food:12.5, water:-10},
  cookedfish:      {food:35,   water:0},
  freshcup:        {food:0,    water:40, returns:'cup'},
  saltcup:         {food:0,    water:-5, returns:'cup'},
  sharkmeat:       {food:10,   water:-5},
  cookedsharkmeat: {food:30,   water:0},
};

const num = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const clampBar = x => Math.max(0, Math.min(MAX, x));

/** Registers (or replaces) an edible item. Returns false for bad input. */
export function addFood(kind, entry) {
  if (typeof kind !== 'string' || !kind || !entry || typeof entry !== 'object') return false;
  const e = {food:num(entry.food), water:num(entry.water)};
  if (typeof entry.returns === 'string' && entry.returns) e.returns = entry.returns;
  FOOD[kind] = e; return true;
}
export const isEdible = kind => typeof kind === 'string' && Object.prototype.hasOwnProperty.call(FOOD, kind);

export function newVitals(from = null) {
  const c = cleanVitals(from);
  return {hp:c.hp, food:c.food, water:c.water, hurtAt:-Infinity, clock:0, starving:false};
}

/** Advances vitals by dt seconds. Never allocates. `starving` is true while an empty bar drains HP. */
export function tickVitals(v, dt, opts) {
  dt = num(dt); if (!(dt > 0)) return v;
  const mult = opts && num(opts.mult, 1) > 0 ? num(opts.mult, 1) : 1;
  v.clock = num(v.clock) + dt;
  v.food = clampBar(num(v.food) - HUNGER_RATE * mult * dt);
  v.water = clampBar(num(v.water) - THIRST_RATE * mult * dt);
  const empty = (v.food <= 0 ? 1 : 0) + (v.water <= 0 ? 1 : 0);
  v.starving = empty > 0 && v.hp > 0;
  if (empty) { v.hp = clampBar(num(v.hp) - STARVE_HP * empty * dt); v.hurtAt = v.clock; }
  else if (v.hp > 0 && v.clock - num(v.hurtAt, -Infinity) >= REGEN_DELAY) v.hp = clampBar(num(v.hp) + REGEN_HP * dt);
  return v;
}

/** Deals n damage. Returns HP actually removed. */
export function damage(v, n, cause = 'hit') { // eslint-disable-line no-unused-vars
  n = num(n); if (!(n > 0) || !(v.hp > 0)) return 0;
  const before = v.hp; v.hp = clampBar(v.hp - n); v.hurtAt = num(v.clock);
  return before - v.hp;
}

/** Applies an edible item to the bars. Returns the entry used ({food, water, returns}) or null. */
export function consume(v, kind) {
  if (!isEdible(kind)) return null;
  const e = FOOD[kind];
  v.food = clampBar(num(v.food) + num(e.food));
  v.water = clampBar(num(v.water) + num(e.water));
  return e;
}

/** Short prompt label, e.g. "Eat (+35 food)" / "Drink (+40 water)". */
export function eatLabel(kind) {
  const e = isEdible(kind) ? FOOD[kind] : null; if (!e) return '';
  const drink = !e.food && e.water !== 0 || kind.endsWith('cup');
  const parts = [];
  if (e.food) parts.push(`${e.food > 0 ? '+' : ''}${e.food} food`);
  if (e.water) parts.push(`${e.water > 0 ? '+' : ''}${e.water} water`);
  return `${drink ? 'Drink' : 'Eat'}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

export function cleanVitals(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const bar = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? clampBar(x) : d);
  const hp = bar(r.hp, MAX);
  // A save written at hp 0 (closed mid-faint) wakes up as a respawn would.
  if (hp <= 0) return {...RESPAWN};
  return {hp, food:bar(r.food, MAX), water:bar(r.water, MAX)};
}

export const saveVitals = v => ({hp:Math.round(num(v.hp) * 10) / 10, food:Math.round(num(v.food) * 10) / 10, water:Math.round(num(v.water) * 10) / 10});
