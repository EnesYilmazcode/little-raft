// Little Raft survival needs: hunger, thirst and health for ONE player (each co-op player runs its own).
// Pure module: no DOM, no THREE, no clocks. game.js calls tick(dt) with real seconds.
//   createNeeds({mode}) -> needs   (see the object at the bottom for the API; bus.needs in combat-bus.js)
//   FOOD[kind] = {hunger, thirst, returns?}   registerFood(kind, values) lets other lanes add items.
// Mode 'relaxed' is Little Raft's original calm sandbox: nothing ever changes there.
import { MODES, modeRules } from './combat-bus.js';

export const MAX = 100;
export const RESPAWN_VALUE = 50;
export const DRAIN = Object.freeze({ hunger: 0.09, thirst: 0.11 }); // per second on Normal, times MODES[mode].hunger/.thirst
export const STARVE_HP = 0.75; // per second for EACH empty bar (they stack)
export const REGEN_HP = 0.25;  // per second while hunger and thirst are both above 0
export const LOW = 20;         // HUD pulses below this
const STARVE_HIT = 5;          // the HUD flashes once per this much starvation damage

const food = (hunger, thirst, returns = null) => Object.freeze(returns ? { hunger, thirst, returns } : { hunger, thirst });
const FOOD_TABLE = {
  fish: food(12.5, -10),
  cookedfish: food(20, 0),
  freshcup: food(0, 40, 'cup'),
  water: food(0, 40, 'cup'),     // farming.js alias for a cup of fresh water
  saltcup: food(0, -15, 'cup'),
  coconut: food(5, 20), palmfruit: food(5, 20),
  potato: food(10, 0), cookedpotato: food(15, 0),
  beet: food(10, 0), cookedbeet: food(15, 0),
  sharkmeat: food(10, -10),      // spear lane adds these items
  cookedsharkmeat: food(30, 0),
};
export const FOOD = FOOD_TABLE; // read-only by convention; use registerFood to add
export function registerFood(kind, v) {
  if (typeof kind !== 'string' || !kind || !v) return false;
  const h = Number(v.hunger) || 0, t = Number(v.thirst) || 0;
  FOOD_TABLE[kind] = food(h, t, typeof v.returns === 'string' ? v.returns : null); return true;
}
export const isFood = kind => typeof kind === 'string' && Object.prototype.hasOwnProperty.call(FOOD_TABLE, kind);
export const isDrink = kind => isFood(kind) && FOOD_TABLE[kind].thirst !== 0 && FOOD_TABLE[kind].hunger === 0;
export const needsActive = mode => (MODES[mode] ? mode : 'relaxed') !== 'relaxed';

const clamp = v => (v < 0 ? 0 : v > MAX ? MAX : v);
const num = (v, d) => (Number.isFinite(v) ? clamp(v) : d);
// Saved shape: {hunger, thirst, health}. Missing or broken values come back full.
export function cleanNeeds(s) {
  const o = s && typeof s === 'object' ? s : {};
  return { hunger: num(o.hunger, MAX), thirst: num(o.thirst, MAX), health: num(o.health, MAX) };
}

export function createNeeds(opts = {}) {
  let mode = MODES[opts.mode] ? opts.mode : 'relaxed', rules = modeRules(mode);
  let hunger = MAX, thirst = MAX, health = MAX, alive = true;
  let hits = 0, starveAcc = 0, lastCause = null;
  const stats = { hunger: MAX, thirst: MAX, health: MAX, alive: true, mode, active: mode !== 'relaxed' }; // reused (no allocations)

  function die(cause) { health = 0; alive = false; lastCause = cause; }
  const api = {
    get hunger() { return hunger; },
    get thirst() { return thirst; },
    get health() { return health; },
    get alive() { return alive; },
    get mode() { return mode; },
    get active() { return mode !== 'relaxed'; },
    get hits() { return hits; },         // grows on every damage flash (HUD vignette watches it)
    get cause() { return lastCause; },   // 'hunger' | 'thirst' | damage cause of the last death
    setMode(m) { const k = MODES[m] ? m : 'relaxed'; if (k !== mode) { mode = k; rules = modeRules(k); } return mode; },
    // Advances dt real seconds. Returns true on the tick the player dies.
    tick(dt) {
      if (mode === 'relaxed' || !alive || !(dt > 0)) return false;
      hunger = clamp(hunger - DRAIN.hunger * rules.hunger * dt);
      thirst = clamp(thirst - DRAIN.thirst * rules.thirst * dt);
      let loss = 0;
      if (hunger <= 0) loss += STARVE_HP * dt;
      if (thirst <= 0) loss += STARVE_HP * dt;
      if (loss > 0) {
        health -= loss; starveAcc += loss;
        if (starveAcc >= STARVE_HIT) { starveAcc -= STARVE_HIT; hits++; }
        if (health <= 0) { die(thirst <= 0 ? 'thirst' : 'hunger'); hits++; return true; }
      } else if (health < MAX) health = clamp(health + REGEN_HP * dt);
      return false;
    },
    // Scaled by MODES[mode].damage. Returns the HP actually taken.
    damage(amount, cause = 'hurt') {
      const a = Number(amount) * rules.damage;
      if (mode === 'relaxed' || !alive || !(a > 0)) return 0;
      const taken = Math.min(health, a); health -= a; hits++;
      if (health <= 0) die(typeof cause === 'string' ? cause : 'hurt');
      return taken;
    },
    heal(amount) { const a = Number(amount); if (mode === 'relaxed' || !alive || !(a > 0)) return 0; const b = health; health = clamp(health + a); return health - b; },
    // Would eating this do anything? Food with no upside (salt water) is always allowed.
    canEat(kind) {
      if (mode === 'relaxed' || !alive || !isFood(kind)) return false;
      const f = FOOD_TABLE[kind], up = (f.hunger > 0) || (f.thirst > 0);
      return !up || (f.hunger > 0 && hunger < MAX - 0.5) || (f.thirst > 0 && thirst < MAX - 0.5);
    },
    eat(kind) {
      if (mode === 'relaxed' || !alive || !isFood(kind)) return false;
      const f = FOOD_TABLE[kind]; hunger = clamp(hunger + f.hunger); thirst = clamp(thirst + f.thirst); return true;
    },
    respawn(v = RESPAWN_VALUE) { hunger = thirst = health = clamp(v); alive = true; starveAcc = 0; },
    stats() {
      stats.hunger = hunger; stats.thirst = thirst; stats.health = health; stats.alive = alive; stats.mode = mode; stats.active = mode !== 'relaxed';
      return stats;
    },
    snapshot() { // a save taken mid-death loads as the respawn it was about to become
      const r = v => Math.round(v * 100) / 100, R = RESPAWN_VALUE;
      return alive ? { hunger: r(hunger), thirst: r(thirst), health: r(health) } : { hunger: Math.max(R, r(hunger)), thirst: Math.max(R, r(thirst)), health: R };
    },
    restore(s) {
      const c = cleanNeeds(s); hunger = c.hunger; thirst = c.thirst; health = c.health;
      if (health <= 0) { health = RESPAWN_VALUE; hunger = Math.max(hunger, RESPAWN_VALUE); thirst = Math.max(thirst, RESPAWN_VALUE); }
      alive = true; starveAcc = 0; return api;
    },
  };
  if (opts.state) api.restore(opts.state);
  return api;
}
