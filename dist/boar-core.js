// Tusker: a hostile island boar (pure rules: no THREE, no DOM, no Date, no Math.random).
// One tusker lives on each larger island (R >= BOAR.MIN_R). It wanders; when a player stands on the same island
// within BOAR.AGGRO metres it lowers its head (ALERT), then charges in a straight line locked at the start of the
// run. Contact deals BOAR.DAMAGE through the game's vitals damage path; a side-step makes it overshoot. After
// every charge it trots back for BOAR.TROT seconds before it can charge again. 18 HP; spear hits hurt it.
// It does not respawn for the same island seed (a new island brings a new tusker).
// Positions are island-local (metres from the island centre), so the boar rides along while the island drifts.
import { layoutFor } from './islands-layout.js?build=v3-survival-ae77fa84ac2b';

export const BOAR = Object.freeze({
  MIN_R: 7,            // islands smaller than this have no tusker
  HP: 18,
  AGGRO: 12,           // metres
  ALERT: 0.55,         // seconds of head-down pawing before a charge
  CHARGE_SPEED: 8.5,   // m/s
  OVERSHOOT: 3.5,      // metres it keeps running past where the target stood
  CHARGE_MAX: 14,      // metres
  CONTACT: 0.95,       // horizontal metres between boar centre and player for a hit
  CONTACT_Y: 0.9,      // the player's feet must be within this of the boar's ground (a jump clears it)
  DAMAGE: 20,
  TROT: 1.5,           // seconds trotting back after a charge
  TROT_SPEED: 2.3,
  WALK_SPEED: 1.1,
  TURN: 3.2,           // rad/s while walking
  WALK_U: 0.64,        // stays within this fraction of R (dry sand)
  BODY_R: 0.42,        // obstacle push radius
  LOOT_REACH: 2.6,
  HIT_SLACK: 1.5,      // extra reach for a guest's spear hit (pose lag)
  MAX_DMG: 10,
  MAX_DT: 0.1,
});
export const BOAR_LOOT = Object.freeze({ rawmeat: 2 });
// st.a: life code. st.m: mode code.
export const LIFE = Object.freeze({ none: 0, alive: 1, dead: 2, looted: 3 });
export const MODE = Object.freeze({ walk: 0, idle: 1, alert: 2, charge: 3, trot: 4, dead: 5 });
export const NAME = 'tusker';

const U32 = 4294967296;
const fin = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = v => Math.round(v * 100) / 100;
const TAU = Math.PI * 2;
const wrap = a => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };

/** Deterministic [0,1) from (seed, n). */
export function roll(seed, n) {
  let h = (Math.imul((seed >>> 0) ^ 0x5bd1e995, 0x9E3779B1) ^ Math.imul((n | 0) + 0x27d4eb2f, 0x85EBCA77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / U32;
}

export const defaults = () => ({ v: 1, s: -1, a: LIFE.none, hp: 0, x: 0, z: 0, h: 0, m: MODE.idle, t: 0,
  dx: 0, dz: 1, run: 0, wx: 0, wz: 0, n: 0, tg: -1, hh: 0, hg: 0, R: 0 });

/** Resets st for the island `seed` (radius R): a fresh tusker on a larger island, none on a small one. */
export function spawnFor(st, seed, R) {
  const d = defaults();
  for (const k in d) st[k] = d[k];
  st.s = seed >>> 0; st.R = fin(R) ? R : 0;
  if (!(st.R >= BOAR.MIN_R)) { st.a = LIFE.none; return st; }
  const a = roll(seed, 1) * TAU, u = 0.25 + 0.3 * roll(seed, 2);
  st.a = LIFE.alive; st.hp = BOAR.HP; st.x = Math.cos(a) * u * st.R; st.z = Math.sin(a) * u * st.R;
  st.h = roll(seed, 3) * TAU - Math.PI; st.m = MODE.idle; st.t = 1 + 2 * roll(seed, 4); st.n = 5;
  return st;
}

/** Validates saved/net data into a full state (or defaults). Mode timers survive only for 'net'. */
export function cleanBoar(v, out = defaults()) {
  const d = defaults();
  for (const k in d) out[k] = d[k];
  if (!v || typeof v !== 'object' || !Number.isInteger(v.s) || v.s < 0 || v.s >= U32) return out;
  out.s = v.s;
  out.a = Number.isInteger(v.a) && v.a >= 0 && v.a <= 3 ? v.a : LIFE.none;
  out.R = fin(v.R) ? clamp(v.R, 0, 20) : 0;
  out.hp = fin(v.hp) ? clamp(v.hp, 0, BOAR.HP) : 0;
  const lim = BOAR.WALK_U * out.R;
  out.x = fin(v.x) ? clamp(v.x, -lim, lim) : 0; out.z = fin(v.z) ? clamp(v.z, -lim, lim) : 0;
  out.h = fin(v.h) ? wrap(v.h) : 0;
  out.m = Number.isInteger(v.m) && v.m >= 0 && v.m <= 5 ? v.m : MODE.idle;
  out.tg = Number.isInteger(v.tg) && v.tg >= -1 && v.tg <= 1 ? v.tg : -1;
  out.n = Number.isInteger(v.n) && v.n >= 0 ? v.n % 1e9 : 0;
  out.hh = Number.isInteger(v.hh) && v.hh >= 0 ? v.hh % 1e9 : 0;
  out.hg = Number.isInteger(v.hg) && v.hg >= 0 ? v.hg % 1e9 : 0;
  if (out.a === LIFE.alive && out.hp <= 0) out.hp = BOAR.HP;
  if (out.a !== LIFE.alive) { out.m = MODE.dead; out.hp = 0; }
  return out;
}

// Obstacles (palm trunks, rocks) of an island as a flat [x, z, r, ...] list, cached per seed.
let obsSeed = -1, obs = [];
export function obstaclesFor(seed) {
  if (seed === obsSeed) return obs;
  obsSeed = seed; obs = [];
  for (const n of layoutFor(seed >>> 0).nodes) {
    if (n.kind === 'palm') obs.push(n.x, n.z, 0.28 * n.s + BOAR.BODY_R);
    else if (n.kind === 'rock') obs.push(n.x, n.z, 0.42 * n.s + BOAR.BODY_R);
  }
  return obs;
}

// Push st out of obstacles and keep it on dry sand. Returns true if anything pushed it.
function confine(st) {
  let hit = false;
  const o = st.a === LIFE.alive && st.s >= 0 ? obstaclesFor(st.s) : obs;
  for (let i = 0; i < o.length; i += 3) {
    const dx = st.x - o[i], dz = st.z - o[i + 1], d2 = dx * dx + dz * dz, r = o[i + 2];
    if (d2 >= r * r) continue;
    const d = Math.sqrt(d2) || 1e-4, k = (r - d) / d;
    st.x += dx * k; st.z += dz * k; hit = true;
  }
  const lim = BOAR.WALK_U * st.R, rr = Math.hypot(st.x, st.z);
  if (rr > lim) { st.x *= lim / rr; st.z *= lim / rr; hit = true; }
  return hit;
}

function turnTo(st, tx, tz, rate, dt) {
  const want = Math.atan2(tx - st.x, tz - st.z), d = wrap(want - st.h), step = rate * dt;
  st.h = wrap(st.h + (Math.abs(d) <= step ? d : Math.sign(d) * step));
  return Math.abs(d);
}
function pickWander(st) {
  const a = roll(st.s, st.n++) * TAU, u = Math.sqrt(roll(st.s, st.n++)) * BOAR.WALK_U * 0.9;
  st.wx = Math.cos(a) * u * st.R; st.wz = Math.sin(a) * u * st.R;
}

/**
 * Nearest valid target index in env.players ([{x, z, on}], island-local; on = standing on this island).
 * Returns -1 when nobody is on the island within AGGRO.
 */
export function targetOf(st, players) {
  let best = -1, bd = BOAR.AGGRO * BOAR.AGGRO;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p || !p.on || !fin(p.x) || !fin(p.z)) continue;
    const d = (p.x - st.x) ** 2 + (p.z - st.z) ** 2;
    if (d <= bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * Advances the host simulation by dt. players: [{x, z, on, feet, ground}] in island-local metres (index 0 = host,
 * 1 = guest; feet/ground are world heights, used for the jump-over check). Writes contact events into ev:
 * ev.hit = player index that was gored this step, or -1; ev.alert = true when a charge wind-up started.
 * No allocations.
 */
export function stepBoar(st, dt, players, ev) {
  ev.hit = -1; ev.alert = false;
  if (st.a !== LIFE.alive) { st.m = MODE.dead; return ev; }
  dt = fin(dt) ? clamp(dt, 0, BOAR.MAX_DT) : 0;
  if (dt <= 0) return ev;
  const tgt = targetOf(st, players);
  st.t -= dt;
  switch (st.m) {
    case MODE.walk: case MODE.idle:
      if (tgt >= 0) { st.m = MODE.alert; st.t = BOAR.ALERT; st.tg = tgt; ev.alert = true; break; }
      if (st.m === MODE.idle) { if (st.t <= 0) { pickWander(st); st.m = MODE.walk; st.t = 8; } break; }
      turnTo(st, st.wx, st.wz, BOAR.TURN, dt);
      st.x += Math.sin(st.h) * BOAR.WALK_SPEED * dt; st.z += Math.cos(st.h) * BOAR.WALK_SPEED * dt;
      if ((st.x - st.wx) ** 2 + (st.z - st.wz) ** 2 < 0.25 || st.t <= 0 || confine(st)) { st.m = MODE.idle; st.t = 1.5 + 2.5 * roll(st.s, st.n++); }
      break;
    case MODE.alert: {
      const p = tgt >= 0 ? players[tgt] : null;
      if (!p) { st.m = MODE.idle; st.t = 1; st.tg = -1; break; }
      st.tg = tgt;
      turnTo(st, p.x, p.z, 9, dt);
      if (st.t > 0) break;
      // Lock the run: straight at where the target stands now, plus an overshoot.
      const dx = p.x - st.x, dz = p.z - st.z, d = Math.hypot(dx, dz) || 1e-4;
      st.dx = dx / d; st.dz = dz / d; st.h = Math.atan2(st.dx, st.dz);
      st.run = Math.min(BOAR.CHARGE_MAX, d + BOAR.OVERSHOOT); st.m = MODE.charge; st.t = st.run / BOAR.CHARGE_SPEED + 0.2;
      break;
    }
    case MODE.charge: {
      const step = Math.min(st.run, BOAR.CHARGE_SPEED * dt);
      st.x += st.dx * step; st.z += st.dz * step; st.run -= step;
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        if (!p || !p.on) continue;
        if ((p.x - st.x) ** 2 + (p.z - st.z) ** 2 > BOAR.CONTACT * BOAR.CONTACT) continue;
        if (fin(p.feet) && fin(p.ground) && p.feet - p.ground > BOAR.CONTACT_Y) continue; // jumped over it
        ev.hit = i; break;
      }
      const blocked = confine(st);
      if (ev.hit >= 0 || blocked || st.run <= 1e-6 || st.t <= 0) { st.m = MODE.trot; st.t = BOAR.TROT; }
      break;
    }
    case MODE.trot:
      // Trot back the way it came (facing back along the run), then size the player up again.
      turnTo(st, st.x - st.dx, st.z - st.dz, 6, dt);
      st.x += Math.sin(st.h) * BOAR.TROT_SPEED * dt; st.z += Math.cos(st.h) * BOAR.TROT_SPEED * dt;
      confine(st);
      if (st.t <= 0) {
        if (tgt >= 0) { st.m = MODE.alert; st.t = BOAR.ALERT; st.tg = tgt; }
        else { st.m = MODE.idle; st.t = 1 + roll(st.s, st.n++); st.tg = -1; }
      }
      break;
    default: st.m = MODE.idle; st.t = 1;
  }
  if (st.m !== MODE.charge) confine(st);
  return ev;
}

/** Spear hit: dmg (clamped 0..MAX_DMG). from = island-local attacker position or null. Returns 'hit' | 'killed' | null. */
export function hitBoar(st, dmg, from = null) {
  if (st.a !== LIFE.alive) return null;
  const d = fin(dmg) ? clamp(dmg, 0, BOAR.MAX_DMG) : 0;
  if (d <= 0) return null;
  st.hp = Math.max(0, st.hp - d);
  if (st.hp <= 1e-9) { st.hp = 0; st.a = LIFE.dead; st.m = MODE.dead; st.tg = -1; return 'killed'; }
  if (from && fin(from.x) && fin(from.z)) { // flinch away, then turn to face the attacker
    const dx = st.x - from.x, dz = st.z - from.z, l = Math.hypot(dx, dz) || 1;
    st.x += dx / l * 0.3; st.z += dz / l * 0.3; confine(st);
  }
  if (st.m === MODE.walk || st.m === MODE.idle) { st.m = MODE.alert; st.t = BOAR.ALERT * 0.6; }
  return 'hit';
}

/** True when the body can be butchered. */
export const lootable = st => st.a === LIFE.dead;

/** Compact copy for saves and guests (reuses out). */
export function packBoar(st, out = {}) {
  out.v = 1; out.s = st.s; out.a = st.a; out.R = r2(st.R); out.hp = r2(st.hp); out.x = r2(st.x); out.z = r2(st.z); out.h = r2(st.h);
  out.m = st.m; out.tg = st.tg; out.n = st.n; out.hh = st.hh; out.hg = st.hg;
  return out;
}
