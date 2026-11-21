// Shark: circles the raft, bites a random unarmored edge foundation every ATTACK_EVERY seconds, hunts swimmers,
// can be repelled (REPEL damage in one attack) or killed (HP) and harvested with E. Our own take on the survival
// classic; numbers in docs/loop/research/fidelity-r1-shark.md.
//
// Two halves:
//   - pure state machine (no THREE, no DOM): createSharkState, step, hit, loot, removeTile ... (tests/shark.test.mjs)
//   - createShark(T, host): the in-game view (2 draw calls for the body, 1 for the tile-damage overlay, pooled
//     splash), no shadows, no per-frame allocations. Host/solo run the simulation; a co-op guest only shows the
//     pose the host sends (net()/applyNet()) and forwards spear hits / harvests as actions.
//
// World contract:
//   world.tiles     [[x, z], ...] integer tile coords (2 m tiles, raft centred on the origin)
//   world.tileHp    {"x,z": 1..99} foundation HP. Missing key = full (TILE_HP = 100). 0 = the tile is removed.
//   world.tileArmor optional: {"x,z": truthy} | Set of "x,z" | ["x,z", ...]. Armored tiles are never targeted.
//   world.shark     saved {v, hp, timer, dead, looted, respawn} (cleanShark)
import { raftExtent } from './wildlife.js?build=v3-survival-ae77fa84ac2b';
import { cleanPieces } from './building-pieces.js?build=v3-survival-ae77fa84ac2b';
import { sharkBodyGeometry, sharkTailGeometry, SHARK_TAIL_PIVOT, SHARK_LENGTH } from './shark-model.js?build=v3-survival-ae77fa84ac2b';

export const SHARK = Object.freeze({
  HP: 150, SPEED: 3.5, ATTACK_SPEED: 5, FLEE_SPEED: 6.5, TURN: 2.4,
  ATTACK_EVERY: 300, BITE_EVERY: 2, BITE_DMG: 20, TILE_HP: 100, REPEL: 15,
  HUNT_RANGE: 25, HUNT_LOSE: 32, PLAYER_BITE: 30, LUNGE_EVERY: 3.5, LUNGE_RANGE: 1.9,
  RESPAWN: 180, RING_MARGIN: 6, FLEE_TIME: 6, BITE_OFF: 1.75, APPROACH_OFF: 4.5,
  HARVEST_REACH: 4, BODY_R: 0.62,
});
export const SHARK_LOOT = Object.freeze({ sharkmeat: 4, sharkhead: 1 });
export const SHARK_STATES = Object.freeze(['circle', 'approach', 'bite', 'flee', 'hunt', 'dead']);
const TAU = Math.PI * 2, N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const fin = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = a => a - TAU * Math.round(a / TAU);
export const tileKey = (x, z) => x + ',' + z;

// ------------------------------------------------------------------ tiles (pure)

function hasTile(tiles, x, z) { for (let i = 0; i < tiles.length; i++) if (tiles[i][0] === x && tiles[i][1] === z) return true; return false; }
export function isArmored(armor, x, z) {
  if (!armor) return false;
  const k = tileKey(x, z);
  if (armor instanceof Set) return armor.has(k);
  if (Array.isArray(armor)) return armor.includes(k);
  return typeof armor === 'object' && !!armor[k];
}
export function tileHpOf(hp, x, z) { const v = hp ? hp[tileKey(x, z)] : undefined; return fin(v) ? clamp(v, 0, SHARK.TILE_HP) : SHARK.TILE_HP; }
// Edge tiles: at least one of the 4 neighbours missing, and not armored. Sorted for determinism.
export function edgeTiles(tiles, armor) {
  const out = [];
  if (!Array.isArray(tiles)) return out;
  for (const t of tiles) {
    if (!Array.isArray(t)) continue;
    let edge = false;
    for (const [a, b] of N4) if (!hasTile(tiles, t[0] + a, t[1] + b)) { edge = true; break; }
    if (edge && !isArmored(armor, t[0], t[1])) out.push([t[0], t[1]]);
  }
  out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return out;
}
// A random edge tile and one of its open sides (the side the shark bites from): {x, z, nx, nz} or null.
// nets (optional, dist/nets.js {x, z, d}): sides with a collection net hanging off them are only used when no other side
// is open, so the shark does not swim into the net frame.
const NET_SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // = nets.js NET_DIRS
const netted = (nets, x, z, a, b) => Array.isArray(nets) && nets.some(n => n && n.x === x && n.z === z && NET_SIDES[n.d] && NET_SIDES[n.d][0] === a && NET_SIDES[n.d][1] === b);
export function pickTarget(tiles, armor, rnd = Math.random, nets = null) {
  const list = edgeTiles(tiles, armor);
  if (!list.length) return null;
  const [x, z] = list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
  let open = N4.filter(([a, b]) => !hasTile(tiles, x + a, z + b));
  const free = open.filter(([a, b]) => !netted(nets, x, z, a, b)); if (free.length) open = free;
  const [nx, nz] = open[Math.min(open.length - 1, Math.floor(rnd() * open.length))];
  return { x, z, nx, nz };
}
// Removes a tile and everything standing on it: decor, garden/purifier state, its HP and armor entries, collection nets
// hanging from it (with their catch), unsupported pieces.
// Never removes the last tile. Returns true when the tile was removed.
export function removeTile(world, x, z) {
  const tiles = world && world.tiles;
  if (!Array.isArray(tiles) || tiles.length <= 1) return false;
  const i = tiles.findIndex(t => t[0] === x && t[1] === z);
  if (i < 0) return false;
  tiles.splice(i, 1);
  const k = tileKey(x, z);
  if (Array.isArray(world.decor)) world.decor = world.decor.filter(d => !(d && d.x === x && d.z === z));
  if (world.tileHp) delete world.tileHp[k];
  if (world.tileArmor && typeof world.tileArmor === 'object' && !Array.isArray(world.tileArmor) && !(world.tileArmor instanceof Set)) delete world.tileArmor[k]; // the armor goes down with its tile
  if (Array.isArray(world.nets)) world.nets = world.nets.filter(n => !(n && n.x === x && n.z === z)); // a net hanging off it sinks with it
  if (world.garden) delete world.garden[k];
  if (world.purifiers) delete world.purifiers[k];
  if (Array.isArray(world.pieces)) world.pieces = cleanPieces(world.pieces, tiles);
  return true;
}
// Deals dmg to a tile. Returns the HP left (0 = destroyed and removed, or clamped to 1 when it is the last tile).
export function damageTile(world, x, z, dmg) {
  if (!world || !hasTile(world.tiles, x, z)) return -1;
  world.tileHp ??= {};
  let hp = tileHpOf(world.tileHp, x, z) - dmg;
  if (hp <= 0) {
    if (removeTile(world, x, z)) return 0;
    hp = 1; // the last tile never breaks
  }
  world.tileHp[tileKey(x, z)] = Math.round(hp);
  return Math.round(hp);
}
export function cleanTileHp(v, tiles) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v) || !Array.isArray(tiles)) return out;
  for (const t of tiles) {
    const n = v[tileKey(t[0], t[1])];
    if (fin(n) && n < SHARK.TILE_HP) out[tileKey(t[0], t[1])] = clamp(Math.round(n), 1, SHARK.TILE_HP - 1);
  }
  return out;
}

// ------------------------------------------------------------------ state machine (pure)

export function createSharkState(saved = null, rnd = Math.random) {
  const v = cleanShark(saved);
  const a = rnd() * TAU, r = 30;
  const s = {
    state: v.dead ? 'dead' : 'circle', hp: v.dead ? 0 : v.hp, timer: v.timer, looted: v.looted, respawn: v.respawn,
    x: Math.cos(a) * r, z: Math.sin(a) * r, heading: 0, dir: rnd() < 0.5 ? -1 : 1, ring: 0,
    hasTarget: false, tx: 0, tz: 0, nx: 0, nz: 0, leg: 0, biteClock: 0, attackDmg: 0, stateT: 0,
    lunge: 0, prey: -1, warned: false, anim: 0, hurtT: 0, floatSet: false, fx: 0, fz: 0, under: false,
  };
  s.heading = Math.atan2(-Math.sin(a) * s.dir, Math.cos(a) * s.dir);
  return s;
}
export function cleanShark(v) {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const dead = o.dead === true, looted = dead && o.looted === true;
  return {
    v: 1, hp: fin(o.hp) && o.hp > 0 ? clamp(Math.round(o.hp), 1, SHARK.HP) : SHARK.HP,
    timer: fin(o.timer) ? clamp(o.timer, 0, SHARK.ATTACK_EVERY) : SHARK.ATTACK_EVERY,
    dead, looted, respawn: looted && fin(o.respawn) ? clamp(o.respawn, 0, SHARK.RESPAWN) : looted ? SHARK.RESPAWN : 0,
  };
}
export function saveShark(s) {
  return { v: 1, hp: Math.round(s.hp), timer: Math.round(s.timer * 10) / 10, dead: s.state === 'dead', looted: s.state === 'dead' && s.looted, respawn: Math.round(s.respawn * 10) / 10 };
}
const attacking = s => s.state === 'approach' || s.state === 'bite' || (s.state === 'hunt' && s.hasTarget);

function setState(s, st) { s.state = st; s.stateT = 0; }
function endAttack(s) { s.hasTarget = false; s.attackDmg = 0; s.warned = false; s.timer = SHARK.ATTACK_EVERY; }
function flee(s) { endAttack(s); setState(s, 'flee'); }
// Starts an attack now: picks a target, or skips this round (every edge armored). Returns true if it attacks.
export function startAttack(s, world, rnd = Math.random) {
  if (s.state === 'dead') return false;
  const t = pickTarget(world && world.tiles, world && world.tileArmor, rnd, world && world.nets);
  if (!t) { endAttack(s); if (s.state !== 'hunt') setState(s, 'circle'); return false; }
  s.hasTarget = true; s.tx = t.x; s.tz = t.z; s.nx = t.nx; s.nz = t.nz; s.leg = 0; s.attackDmg = 0; s.warned = false;
  const wx = s.tx * 2 + s.nx * (1 + SHARK.APPROACH_OFF), wz = s.tz * 2 + s.nz * (1 + SHARK.APPROACH_OFF);
  s.dir = wrap(Math.atan2(wz, wx) - Math.atan2(s.z, s.x)) >= 0 ? 1 : -1;
  if (s.state !== 'hunt') setState(s, 'approach');
  return true;
}
export function forceAttack(s, world, rnd) { if (s.state === 'dead') return false; s.timer = 0; if (s.state === 'flee') setState(s, 'circle'); return startAttack(s, world, rnd); }

// Deals damage (a spear hit). Returns true if the shark took it. REPEL damage within one attack makes it flee.
export function hit(s, dmg) {
  if (s.state === 'dead' || !(dmg > 0)) return false;
  s.hp = Math.max(0, s.hp - dmg); s.hurtT = 0.35;
  if (s.hp <= 0) { kill(s); return true; }
  s.attackDmg += dmg;
  if (s.attackDmg >= SHARK.REPEL) flee(s);
  return true;
}
export function kill(s) {
  s.hp = 0; s.hasTarget = false; s.attackDmg = 0; s.looted = false; s.respawn = 0; s.floatSet = false; s.prey = -1;
  setState(s, 'dead');
}
// Harvest the body: returns the loot ({kind: n}) once, then the respawn countdown starts.
export function loot(s) {
  if (s.state !== 'dead' || s.looted) return null;
  s.looted = true; s.respawn = SHARK.RESPAWN;
  return SHARK_LOOT;
}
export const lootable = s => s.state === 'dead' && !s.looted;

// Turn toward (tx, tz) at the turn rate and swim forward. Returns the distance that was left.
function steer(s, tx, tz, speed, dt) {
  const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz);
  if (d < 1e-4) return 0;
  const dh = wrap(Math.atan2(dx, dz) - s.heading), turn = SHARK.TURN * dt * (speed > SHARK.SPEED ? 1.3 : 1);
  s.heading = wrap(s.heading + clamp(dh, -turn, turn));
  const v = speed * (0.35 + 0.65 * Math.max(0, Math.cos(dh))), step = Math.min(v * dt, d);
  s.x += Math.sin(s.heading) * step; s.z += Math.cos(s.heading) * step;
  return d;
}
function ringPoint(s, speed, dt, R) { // follow the ring, a little ahead of where we are
  const a = Math.atan2(s.z, s.x) + s.dir * 0.45;
  steer(s, Math.cos(a) * R, Math.sin(a) * R, speed, dt);
}
function nearestPrey(s, env, range) {
  let best = -1, bd = range;
  const ps = env && env.preys;
  if (ps) for (let i = 0; i < ps.length; i++) {
    const p = ps[i]; if (!p || !p.swimming || !fin(p.x) || !fin(p.z)) continue;
    const d = Math.hypot(p.x - s.x, p.z - s.z); if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function overRaft(tiles, x, z, pad) {
  for (let i = 0; i < tiles.length; i++) if (Math.abs(x - tiles[i][0] * 2) < 1 + pad && Math.abs(z - tiles[i][1] * 2) < 1 + pad) return true;
  return false;
}
const NOOP = {};

// Advances the shark by dt. world: {tiles, tileHp, tileArmor, decor, pieces...} (mutated by bites).
// env: {preys: [{x, z, swimming}], ringR?: number, rnd?: fn, hooks?: {bite(x, z, hp), broke(x, z), hurt(i, n), warn(x, z), respawn()}}
export function step(s, dt, world, env = NOOP) {
  if (!(dt > 0)) return s;
  dt = Math.min(dt, 0.1);
  const hooks = env.hooks || NOOP, rnd = env.rnd || Math.random, tiles = world && Array.isArray(world.tiles) ? world.tiles : [];
  const R = fin(env.ringR) ? env.ringR : raftExtent(tiles) + SHARK.RING_MARGIN;
  s.ring = s.ring > 0 ? s.ring + clamp(R - s.ring, -dt, dt) : R;
  s.stateT += dt; s.anim = Math.max(0, s.anim - dt * 2.5); s.hurtT = Math.max(0, s.hurtT - dt); s.lunge = Math.max(0, s.lunge - dt);
  if (s.state === 'dead') {
    if (s.looted) {
      s.respawn -= dt;
      if (s.respawn <= 0) {
        const a = rnd() * TAU;
        s.x = Math.cos(a) * (s.ring + 25); s.z = Math.sin(a) * (s.ring + 25); s.hp = SHARK.HP; s.looted = false; s.respawn = 0;
        endAttack(s); setState(s, 'circle'); if (hooks.respawn) hooks.respawn();
      }
      return s;
    }
    if (!s.floatSet) { // drift to just outside the nearest edge so it can be harvested from the deck
      let bd = Infinity;
      for (const t of tiles) for (const [a, b] of N4) {
        if (hasTile(tiles, t[0] + a, t[1] + b)) continue;
        const px = t[0] * 2 + a * 2.3, pz = t[1] * 2 + b * 2.3, d = Math.hypot(px - s.x, pz - s.z);
        if (d < bd) { bd = d; s.fx = px; s.fz = pz; }
      }
      if (bd === Infinity) { s.fx = s.x; s.fz = s.z; }
      s.floatSet = true;
    }
    const dx = s.fx - s.x, dz = s.fz - s.z, d = Math.hypot(dx, dz);
    if (d > 0.05) { const k = Math.min(1, Math.min(2, 0.5 + 0.25 * d) * dt / d); s.x += dx * k; s.z += dz * k; } // drifts in faster from afar
    return s;
  }
  // a swimmer nearby is more interesting than planks (not while fleeing)
  if (s.state !== 'flee' && s.state !== 'hunt') {
    const p = nearestPrey(s, env, SHARK.HUNT_RANGE);
    if (p >= 0) { s.prey = p; s.lunge = Math.max(s.lunge, 1); setState(s, 'hunt'); }
  }
  switch (s.state) {
    case 'circle': {
      ringPoint(s, SHARK.SPEED, dt, s.ring);
      s.timer -= dt;
      if (s.timer <= 0) startAttack(s, world, rnd);
      break;
    }
    case 'approach': {
      if (!hasTile(tiles, s.tx, s.tz) || hasTile(tiles, s.tx + s.nx, s.tz + s.nz) || isArmored(world.tileArmor, s.tx, s.tz)) { if (!startAttack(s, world, rnd)) break; }
      const cx = s.tx * 2, cz = s.tz * 2;
      const wx = cx + s.nx * (1 + SHARK.APPROACH_OFF), wz = cz + s.nz * (1 + SHARK.APPROACH_OFF);
      if (s.leg === 0) {
        ringPoint(s, SHARK.ATTACK_SPEED, dt, Math.max(s.ring, Math.hypot(wx, wz)));
        if (Math.abs(wrap(Math.atan2(wz, wx) - Math.atan2(s.z, s.x))) < 0.3) s.leg = 1;
      } else if (s.leg === 1) {
        if (steer(s, wx, wz, SHARK.ATTACK_SPEED, dt) < 1) s.leg = 2;
      } else {
        const bx = cx + s.nx * SHARK.BITE_OFF, bz = cz + s.nz * SHARK.BITE_OFF;
        if (steer(s, bx, bz, 2.5, dt) < 0.3) { s.x = bx; s.z = bz; setState(s, 'bite'); s.biteClock = 0.8; }
      }
      break;
    }
    case 'bite': {
      const want = Math.atan2(-s.nx, -s.nz);
      s.heading = wrap(s.heading + clamp(wrap(want - s.heading), -4 * dt, 4 * dt));
      s.biteClock -= dt;
      if (s.biteClock > 0) break;
      s.biteClock += SHARK.BITE_EVERY;
      if (!hasTile(tiles, s.tx, s.tz) || hasTile(tiles, s.tx + s.nx, s.tz + s.nz) || isArmored(world.tileArmor, s.tx, s.tz)) { startAttack(s, world, rnd); break; }
      if (!s.warned) { s.warned = true; if (hooks.warn) hooks.warn(s.tx, s.tz); }
      const hp = damageTile(world, s.tx, s.tz, SHARK.BITE_DMG);
      s.anim = 1;
      if (hooks.bite) hooks.bite(s.tx, s.tz, Math.max(0, hp));
      if (hp === 0) { const bx = s.tx, bz = s.tz; flee(s); if (hooks.broke) hooks.broke(bx, bz); }
      else if (hp <= 1 && tiles.length <= 1) flee(s); // the last tile never breaks: give up
      break;
    }
    case 'hunt': {
      const p = env.preys && env.preys[s.prey];
      const d = p && p.swimming ? Math.hypot(p.x - s.x, p.z - s.z) : Infinity;
      if (!(d < SHARK.HUNT_LOSE)) { s.prey = -1; if (s.hasTarget) { s.leg = 0; setState(s, 'approach'); } else setState(s, 'circle'); break; }
      if (d > 1.1) steer(s, p.x, p.z, SHARK.ATTACK_SPEED, dt);
      else s.heading = wrap(s.heading + clamp(wrap(Math.atan2(p.x - s.x, p.z - s.z) - s.heading), -3 * dt, 3 * dt));
      if (d < SHARK.LUNGE_RANGE && s.lunge <= 0) { s.lunge = SHARK.LUNGE_EVERY; s.anim = 1; if (hooks.hurt) hooks.hurt(s.prey, SHARK.PLAYER_BITE); }
      break;
    }
    case 'flee': {
      const r = Math.hypot(s.x, s.z) || 1;
      steer(s, s.x / r * (s.ring + 12), s.z / r * (s.ring + 12), SHARK.FLEE_SPEED, dt);
      if (s.stateT >= SHARK.FLEE_TIME) { s.dir = rnd() < 0.5 ? -1 : 1; setState(s, 'circle'); }
      break;
    }
  }
  s.under = s.state !== 'bite' && overRaft(tiles, s.x, s.z, 0.4); // dive under the deck so the fin never cuts through planks
  return s;
}

// Closest distance between segments p0-p1 and q0-q1 (flat numbers, no allocation).
export function segSegDist(px, py, pz, ux, uy, uz, qx, qy, qz, vx, vy, vz) {
  // p(s) = p + u*s, q(t) = q + v*t, s,t in [0, 1]
  const wx = px - qx, wy = py - qy, wz = pz - qz;
  const a = ux * ux + uy * uy + uz * uz, b = ux * vx + uy * vy + uz * vz, c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz, e = vx * wx + vy * wy + vz * wz, D = a * c - b * b;
  let sN, sD = D, tN, tD = D;
  if (D < 1e-9) { sN = 0; sD = 1; tN = e; tD = c; }
  else { sN = b * e - c * d; tN = a * e - b * d; if (sN < 0) { sN = 0; tN = e; tD = c; } else if (sN > sD) { sN = sD; tN = e + b; tD = c; } }
  if (tN < 0) { tN = 0; sN = clamp(-d, 0, a); sD = a || 1; } else if (tN > tD) { tN = tD; sN = clamp(b - d, 0, a); sD = a || 1; }
  const sc = Math.abs(sN) < 1e-9 ? 0 : sN / sD, tc = Math.abs(tN) < 1e-9 ? 0 : tN / (tD || 1);
  const dx = wx + ux * sc - vx * tc, dy = wy + uy * sc - vy * tc, dz = wz + uz * sc - vz * tc;
  return Math.hypot(dx, dy, dz);
}
// Does a spear ray (origin o, unit dir d, reach) touch a shark body at (x, y, z) facing heading? Capsule test.
export function spearHits(ox, oy, oz, dx, dy, dz, reach, x, y, z, heading) {
  const half = SHARK_LENGTH / 2, ax = Math.sin(heading), az = Math.cos(heading);
  return segSegDist(ox, oy, oz, dx * reach, dy * reach, dz * reach, x - ax * half, y, z - az * half, ax * 2 * half, 0, az * 2 * half) <= SHARK.BODY_R;
}

// Compact pose for co-op: [x, z, heading, stateCode, depth, anim, hp]
export const STATE_CODE = Object.freeze({ circle: 0, approach: 1, bite: 2, flee: 3, hunt: 4, dead: 5, gone: 6 });

// ------------------------------------------------------------------ view

// host: {scene, ocean, raft(), world(), role(), preys(out) fills [{x,z,swimming}], circler() -> {x,z}|null,
//        onBite(x, z, hp), onBroke(x, z), onHurt(i, n), onWarn(x, z), sendHit(dmg), sendLoot(), waterFx?}
export function createShark(T, host, saved = null) {
  let sim = createSharkState(saved);
  const preys = [{ x: 0, z: 0, swimming: false }, { x: 0, z: 0, swimming: false }];
  const env = { preys, ringR: 0, rnd: Math.random, hooks: {
    bite: (x, z, hp) => host.onBite && host.onBite(x, z, hp),
    broke: (x, z) => host.onBroke && host.onBroke(x, z),
    hurt: (i, n) => host.onHurt && host.onHurt(i, n),
    warn: (x, z) => host.onWarn && host.onWarn(x, z),
  } };
  // shown pose (host: the sim; guest: smoothed toward the last net pose)
  const view = { x: sim.x, z: sim.z, heading: sim.heading, depth: -0.55, roll: 0, pitch: 0, code: STATE_CODE[sim.state], anim: 0, hp: sim.hp, visible: false, swim: 0 };
  const net = { x: 0, z: 0, heading: 0, code: 0, depth: -0.55, anim: 0, hp: SHARK.HP, have: false };
  const pose = [0, 0, 0, 0, 0, 0, 0];
  let extTiles = null, extLen = -1, ext = 0, overlayKey = 0, ovTilesRef = null, bitePulse = 0, biteX = 0, biteZ = 0;

  const group = new T.Group(); group.name = 'shark';
  const material = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const body = new T.Mesh(sharkBodyGeometry(T), material); body.name = 'sharkBody';
  const tail = new T.Mesh(sharkTailGeometry(T), material); tail.name = 'sharkTail';
  tail.position.set(0, SHARK_TAIL_PIVOT[1], SHARK_TAIL_PIVOT[2]); body.add(tail);
  for (const m of [body, tail]) { m.castShadow = false; m.receiveShadow = false; }
  body.visible = false; group.add(body);
  // damaged-tile overlay: multiply-blended dark quads on the deck, one instanced draw call
  const MAX_OV = 64, ovGeo = new T.PlaneGeometry(1.96, 1.96); ovGeo.rotateX(-Math.PI / 2);
  const ovMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: T.MultiplyBlending, premultipliedAlpha: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const overlay = new T.InstancedMesh(ovGeo, ovMat, MAX_OV); overlay.name = 'tileDamage'; overlay.count = 0; overlay.frustumCulled = false;
  overlay.castShadow = false; overlay.receiveShadow = false; overlay.renderOrder = 3; overlay.instanceMatrix.setUsage(T.DynamicDrawUsage);
  const deck = new T.Group(); deck.name = 'sharkDeckFx'; deck.add(overlay);
  host.scene.add(group, deck);
  const m4 = new T.Matrix4(), col = new T.Color(), white = new T.Color(0xffffff), dark = new T.Color(0x3a2a1e);
  const ovTiles = []; // [x, z] of the overlay instances, rebuilt when tileHp keys change

  const isGuest = () => host.role() === 'guest';
  function ringR(tiles) {
    if (tiles !== extTiles || tiles.length !== extLen) { extTiles = tiles; extLen = tiles.length; ext = raftExtent(tiles); }
    const R0 = ext + SHARK.RING_MARGIN, c = host.circler ? host.circler() : null;
    if (!c) return R0;
    const rc = Math.hypot(c.x, c.z); // keep out of the dolphin/turtle lane
    if (Math.abs(rc - R0) >= 3.5) return R0;
    return rc - 3.5 >= ext + 3 ? rc - 3.5 : rc + 3.5;
  }

  function refreshOverlay(world, dt) {
    const hp = world.tileHp || null;
    let key = world.tiles.length | 0; // allocation-free hash of the tileHp entries
    if (hp) for (const k in hp) { for (let c = 0; c < k.length; c++) key = Math.imul(key ^ k.charCodeAt(c), 0x01000193); key = Math.imul(key ^ (hp[k] | 0), 0x01000193); }
    if (key !== overlayKey || world.tiles !== ovTilesRef) {
      ovTilesRef = world.tiles; // rare: only when a bite lands, a tile breaks or a repair happens
      overlayKey = key; ovTiles.length = 0;
      if (hp) for (const k in hp) { const i = k.indexOf(','); const x = +k.slice(0, i), z = +k.slice(i + 1); if (ovTiles.length < MAX_OV && hasTile(world.tiles, x, z)) ovTiles.push([x, z, hp[k]]); }
    }
    bitePulse = Math.max(0, bitePulse - dt * 2.2);
    overlay.count = ovTiles.length;
    for (let i = 0; i < ovTiles.length; i++) {
      const [x, z, h] = ovTiles[i], hit = x === biteX && z === biteZ ? bitePulse : 0;
      const k = clamp((1 - h / SHARK.TILE_HP) * 0.7 + hit * 0.3, 0, 0.9);
      m4.makeTranslation(x * 2 + (hit ? (Math.random() - 0.5) * 0.04 : 0), 0.222, z * 2 + (hit ? (Math.random() - 0.5) * 0.04 : 0));
      overlay.setMatrixAt(i, m4); overlay.setColorAt(i, col.copy(white).lerp(dark, k));
    }
    if (ovTiles.length) { overlay.instanceMatrix.needsUpdate = true; if (overlay.instanceColor) overlay.instanceColor.needsUpdate = true; }
    overlay.visible = ovTiles.length > 0;
  }

  function showPose(dt, t) {
    const v = view, dead = v.code === STATE_CODE.dead, gone = v.code === STATE_CODE.gone;
    body.visible = !gone;
    if (gone) return;
    // depth: fin at the surface, head up while biting, deep under the raft, floating belly-up when dead
    const want = dead ? -0.06 : v.depth;
    v.swim += dt * (dead ? 0 : v.code === STATE_CODE.circle ? 5 : 9);
    const ocean = host.ocean, h = ocean ? ocean.getHeight(v.x, v.z) : 0;
    const bite = v.code === STATE_CODE.bite || v.code === STATE_CODE.hunt ? v.anim : 0;
    v.roll += ((dead ? Math.PI : 0) - v.roll) * Math.min(1, dt * 2);
    v.pitch += ((v.code === STATE_CODE.bite ? 0.2 + 0.25 * bite : 0) - v.pitch) * Math.min(1, dt * 4);
    body.position.set(v.x, h + want + 0.12 * bite, v.z);
    body.rotation.set(-v.pitch, v.heading + (bite ? Math.sin(t * 30) * 0.12 * bite : 0), v.roll, 'YXZ');
    tail.rotation.y = dead ? 0.15 : Math.sin(v.swim) * (0.35 + 0.25 * bite);
  }

  const mod = {
    get sim() { return sim; },
    get visible() { return body.visible; },
    // active = false (title screen): nothing moves and the shark stays hidden, so the attack timer only runs in play.
    update(dt, t, active = true) {
      const world = host.world(); if (!world) return;
      if (!active) { body.visible = false; overlay.visible = false; return; }
      if (!isGuest()) {
        host.preys(preys);
        env.ringR = ringR(world.tiles);
        step(sim, dt, world, env);
        const v = view; v.x = sim.x; v.z = sim.z; v.heading = sim.heading; v.code = sim.state === 'dead' && sim.looted ? STATE_CODE.gone : STATE_CODE[sim.state];
        v.anim = sim.anim; v.hp = sim.hp;
        const target = sim.under ? -1.4 : sim.state === 'bite' ? -0.32 : -0.55;
        v.depth += (target - v.depth) * Math.min(1, dt * 2.5);
      } else if (net.have) {
        const v = view, k = Math.min(1, dt * 8);
        if (Math.hypot(net.x - v.x, net.z - v.z) > 8) { v.x = net.x; v.z = net.z; v.heading = net.heading; }
        v.x += (net.x - v.x) * k; v.z += (net.z - v.z) * k; v.heading = wrap(v.heading + wrap(net.heading - v.heading) * k);
        v.depth += (net.depth - v.depth) * k; v.code = net.code; v.anim = net.anim; v.hp = net.hp;
      } else view.code = STATE_CODE.gone;
      showPose(dt, t);
      const raft = host.raft(); if (raft) { deck.position.copy(raft.position); deck.quaternion.copy(raft.quaternion); }
      refreshOverlay(world, dt);
      host.waterFx?.update(dt);
    },
    // Spear hook: ray from origin along dir (unit), reach in metres. Returns true on a hit (guest: predicted, sent to host).
    trySpear(origin, dir, reach = 2.8, dmg = 5) {
      if (!origin || !dir || !body.visible || view.code === STATE_CODE.dead || view.code === STATE_CODE.gone) return false;
      const c = body.position;
      if (!spearHits(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, reach, c.x, c.y, c.z, view.heading)) return false;
      if (isGuest()) { host.sendHit && host.sendHit(dmg); }
      else hit(sim, dmg);
      mod.fx('hurt', c.x, c.z);
      return true;
    },
    // Host side of a guest spear hit (validated by the caller).
    applyHit(dmg) { return hit(sim, clamp(dmg, 0, 10)); },
    distanceTo(x, z) { return Math.hypot(view.x - x, view.z - z); },
    canHarvest(x, z) { return view.code === STATE_CODE.dead && body.visible && Math.hypot(view.x - x, view.z - z) <= SHARK.HARVEST_REACH; },
    harvest() { return loot(sim); }, // host only
    forceAttack() { return forceAttack(sim, host.world()); },
    kill() { if (sim.state !== 'dead') kill(sim); },
    fx(kind, x, z) {
      const ocean = host.ocean, y = ocean ? ocean.getHeight(x, z) : 0;
      if (kind === 'bite') { bitePulse = 1; host.waterFx?.splash(x, y, z, 1.2); }
      else host.waterFx?.splash(x, y, z, 0.7);
    },
    markBite(tx, tz) { biteX = tx; biteZ = tz; bitePulse = 1; },
    save() { return saveShark(sim); },
    load(saved) { sim = createSharkState(saved); view.x = sim.x; view.z = sim.z; },
    net() { // compact pose for hostState
      const v = view;
      pose[0] = Math.round(v.x * 100) / 100; pose[1] = Math.round(v.z * 100) / 100; pose[2] = Math.round(v.heading * 100) / 100;
      pose[3] = v.code; pose[4] = Math.round(v.depth * 100) / 100; pose[5] = Math.round(v.anim * 10) / 10; pose[6] = Math.round(v.hp);
      return pose;
    },
    applyNet(p) {
      if (!Array.isArray(p) || p.length < 7 || !p.every(fin)) return;
      net.x = clamp(p[0], -200, 200); net.z = clamp(p[1], -200, 200); net.heading = p[2]; net.code = clamp(p[3] | 0, 0, 6);
      net.depth = clamp(p[4], -3, 0.5); net.anim = clamp(p[5], 0, 1); net.hp = clamp(p[6], 0, SHARK.HP);
      if (!net.have) { view.x = net.x; view.z = net.z; view.heading = net.heading; view.depth = net.depth; }
      net.have = true;
    },
    clearNet() { net.have = false; },
    get view() { return view; },
    dispose() {
      group.removeFromParent(); deck.removeFromParent();
      body.geometry.dispose(); tail.geometry.dispose(); material.dispose(); ovGeo.dispose(); ovMat.dispose(); overlay.dispose();
    },
  };
  return mod;
}
