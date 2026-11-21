// Shared hand-off between the survival-needs, shark and spear modules, so none of them imports another.
// game.js fills the slots; every reader must cope with a slot still being null.
//   bus.needs : { damage(amount, cause), heal(amount), eat(kind) -> bool, alive, stats() }   (needs.js)
//   bus.shark : { hit(damage, point{x,y,z}, dir?) -> bool, state, position }                 (shark.js)
//   bus.mode  : key of MODES, the current game mode
export const MODES = Object.freeze({
  // Little Raft's original calm sandbox: no needs, no shark, no damage.
  relaxed:  Object.freeze({ name: 'Relaxed',  hunger: 0,   thirst: 0,   damage: 0,   sharkRaft: 0,   sharkBites: false, keepBag: true }),
  peaceful: Object.freeze({ name: 'Peaceful', hunger: 0.6, thirst: 0.6, damage: 1,   sharkRaft: 0,   sharkBites: false, keepBag: true }),
  easy:     Object.freeze({ name: 'Easy',     hunger: 0.6, thirst: 0.6, damage: 0.7, sharkRaft: 480, sharkBites: true,  keepBag: true }),
  normal:   Object.freeze({ name: 'Normal',   hunger: 1,   thirst: 1,   damage: 1,   sharkRaft: 300, sharkBites: true,  keepBag: false }),
  hard:     Object.freeze({ name: 'Hard',     hunger: 1.3, thirst: 1.5, damage: 1.4, sharkRaft: 120, sharkBites: true,  keepBag: false }),
});
export const DEFAULT_MODE = 'normal'; // new games; saves without a mode load as 'relaxed'
export const modeRules = key => MODES[key] || MODES.relaxed;
export const bus = { needs: null, shark: null, mode: 'relaxed' };
