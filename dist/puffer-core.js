// Bloatfish rules (underwater puffer hazard). Pure ES module: no THREE, no DOM, no allocations per step.
// A few Bloatfish hover just under the surface around the docked island. A swimmer or diver who comes
// within TRIGGER metres makes one swim at them and swell up over INFLATE seconds, then it bursts:
// BURST_DMG within BURST_R plus a poison cloud (CLOUD_R) that hurts CLOUD_DPS per second for CLOUD_TIME.
// A spear kill before the burst stops it and drops Puffer Goo.
//
// Coordinates: x/z are relative to the island centre (the island drifts while sailing), y is world height.
// Local per player, like diving: each client runs its own Bloatfish; only the goo drop goes to the host.
//
//   const sim = createPufferSim(rand?);       // rand() -> [0, 1) (Math.random by default)
//   sim.area(key, R, dist)                     // every frame: island seed (or null), radius, player distance to centre
//   sim.step(dt, px, py, pz, inWater, hurt)    // hurt(n, cause): damage the local player
//   sim.spear(ox, oy, oz, dx, dy, dz, reach, dmg) -> -1 miss | index hit (sim.lastKill = goo count, 0 if alive)

export const PUFFER = Object.freeze({
  MAX: 4, MIN: 2, HP: 8,
  TRIGGER: 4, SWIM: 1.7, STOP: 0.9, INFLATE: 1.2,
  BURST_R: 3, BURST_DMG: 20,
  CLOUD_R: 3, CLOUD_DPS: 5, CLOUD_TIME: 9, CLOUD_TICK: 0.5, MAX_CLOUDS: 4,
  DEPTH_MIN: 1.1, DEPTH_MAX: 2.4, TOP: -0.7,     // hover depth below mean water; never above TOP
  RING_IN: 1.35, RING_OUT: 12,                    // spawn ring: R * RING_IN .. + RING_OUT metres
  ENTER: 30, LEAVE: 45,                           // area hysteresis beyond R (m): leave, come back -> respawn
  RADIUS: 0.32, HIT_SLACK: 0.18,                  // body radius at rest (m), extra spear slack
  GOO_EXTRA: 0.33,
});

export const PUFF = Object.freeze({ DEAD: 0, IDLE: 1, INFLATE: 2 });

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** mulberry32 so layouts are repeatable per (seed, visit). */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 0..1 swell of an inflating Bloatfish (smoothstep over INFLATE seconds). */
export function swell(t) {
  const k = clamp(t / PUFFER.INFLATE, 0, 1);
  return k * k * (3 - 2 * k);
}

/** Goo dropped by one kill: 1, plus a second one with GOO_EXTRA chance. */
export const gooDrop = (r) => 1 + (r < PUFFER.GOO_EXTRA ? 1 : 0);

export function createPufferSim(rand = Math.random) {
  const fish = Array.from({ length: PUFFER.MAX }, () => ({
    state: PUFF.DEAD, x: 0, y: 0, z: 0, hx: 0, hy: 0, hz: 0, hp: 0, t: 0, yaw: 0, phase: 0, hurtT: 0, pin: false, // pin: frozen pose (QA screenshots)
  }));
  const clouds = Array.from({ length: PUFFER.MAX_CLOUDS }, () => ({ on: false, x: 0, y: 0, z: 0, t: 0 }));
  const sim = {
    fish, clouds, key: null, R: 0, away: false, visits: 0, count: 0,
    poisonAcc: 0, inPoison: false, clock: 0,
    bursts: 0, lastKill: 0, lastBurstHit: 0,
    onBurst: null, onTrigger: null, // optional (i, f) callbacks for fx/sound
  };

  function clear() {
    for (const f of fish) f.state = PUFF.DEAD;
    for (const c of clouds) c.on = false;
    sim.count = 0; sim.poisonAcc = 0; sim.inPoison = false;
  }

  /** Lays out MIN..MAX Bloatfish on a ring around the island for (key, visit). */
  function spawn() {
    clear();
    const r = mulberry((Math.imul(sim.key >>> 0, 2654435761) ^ Math.imul(sim.visits + 1, 40503)) >>> 0);
    const n = PUFFER.MIN + Math.floor(r() * (PUFFER.MAX - PUFFER.MIN + 1));
    const a0 = r() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const f = fish[i];
      const a = a0 + (i / n) * Math.PI * 2 + (r() - 0.5) * 0.9;
      const d = sim.R * PUFFER.RING_IN + r() * PUFFER.RING_OUT;
      f.hx = f.x = Math.sin(a) * d; f.hz = f.z = Math.cos(a) * d;
      f.hy = f.y = -(PUFFER.DEPTH_MIN + r() * (PUFFER.DEPTH_MAX - PUFFER.DEPTH_MIN));
      f.hp = PUFFER.HP; f.t = 0; f.yaw = r() * Math.PI * 2; f.phase = r() * 6.283; f.hurtT = 0; f.pin = false;
      f.state = PUFF.IDLE;
    }
    sim.count = n;
  }

  /** Area bookkeeping. key: island seed (integer) or null when no island is shown. */
  sim.area = (key, R, dist) => {
    if (key === null || key === undefined || !Number.isFinite(R) || R <= 0) {
      if (sim.key !== null) { sim.key = null; clear(); }
      return;
    }
    dist = fin(dist, Infinity);
    if (key !== sim.key) { sim.key = key; sim.R = R; sim.visits = 0; sim.away = dist > R + PUFFER.ENTER; spawn(); return; }
    sim.R = R;
    if (!sim.away && dist > R + PUFFER.LEAVE) sim.away = true;
    else if (sim.away && dist < R + PUFFER.ENTER) { sim.away = false; sim.visits++; spawn(); } // came back: fresh Bloatfish
  };

  function burst(i, f, px, py, pz, hurt) {
    f.state = PUFF.DEAD; sim.bursts++;
    const d = Math.hypot(px - f.x, py - f.y, pz - f.z);
    sim.lastBurstHit = 0;
    if (d <= PUFFER.BURST_R) { sim.lastBurstHit = PUFFER.BURST_DMG; hurt?.(PUFFER.BURST_DMG, 'bloatfish'); }
    // reuse the oldest cloud slot when all are busy
    let c = clouds[0];
    for (const k of clouds) { if (!k.on) { c = k; break; } if (k.t > c.t) c = k; }
    c.on = true; c.x = f.x; c.y = f.y; c.z = f.z; c.t = 0;
    sim.onBurst?.(i, f);
  }

  /** One frame. (px, py, pz): local player (x/z island-relative). inWater: swimming or diving. */
  sim.step = (dt, px, py, pz, inWater, hurt) => {
    dt = clamp(fin(dt), 0, 0.1);
    if (!(dt > 0)) return;
    sim.clock += dt;
    if (sim.key !== null) {
      for (let i = 0; i < PUFFER.MAX; i++) {
        const f = fish[i];
        if (f.state === PUFF.DEAD || f.pin) continue;
        f.hurtT = Math.max(0, f.hurtT - dt);
        const dx = px - f.x, dy = py - f.y, dz = pz - f.z, d = Math.hypot(dx, dy, dz);
        if (f.state === PUFF.IDLE) {
          // lazy hover: a slow figure-of-eight around home with a gentle bob
          const w = sim.clock * 0.35 + f.phase;
          const tx = f.hx + Math.sin(w) * 0.8, tz = f.hz + Math.sin(w * 2) * 0.4, ty = f.hy + Math.sin(w * 2.6) * 0.12;
          const k = 1 - Math.exp(-1.5 * dt), mx = (tx - f.x) * k, mz = (tz - f.z) * k;
          f.x += mx; f.y += (ty - f.y) * k; f.z += mz;
          if (mx * mx + mz * mz > 1e-8) f.yaw = Math.atan2(mx, mz);
          if (inWater && d < PUFFER.TRIGGER) { f.state = PUFF.INFLATE; f.t = 0; sim.onTrigger?.(i, f); }
        } else { // INFLATE: swim at the player while swelling, then burst
          f.t += dt;
          if (d > PUFFER.STOP) {
            const s = Math.min(d - PUFFER.STOP, PUFFER.SWIM * dt * (1 - 0.6 * swell(f.t))) / d; // slows as it swells
            f.x += dx * s; f.y += dy * s; f.z += dz * s;
          }
          if (dx * dx + dz * dz > 1e-6) f.yaw = Math.atan2(dx, dz);
          if (f.y > PUFFER.TOP) f.y = PUFFER.TOP;
          if (f.t >= PUFFER.INFLATE) burst(i, f, px, py, pz, hurt);
        }
      }
    }
    // poison clouds (they keep fading out even after the island leaves)
    let inside = false;
    for (let j = 0; j < clouds.length; j++) {
      const c = clouds[j];
      if (!c.on) continue;
      c.t += dt;
      if (c.t >= PUFFER.CLOUD_TIME) { c.on = false; continue; }
      if (Math.hypot(px - c.x, py - c.y, pz - c.z) <= PUFFER.CLOUD_R) inside = true;
    }
    sim.inPoison = inside;
    if (inside) {
      sim.poisonAcc += dt;
      while (sim.poisonAcc >= PUFFER.CLOUD_TICK) { sim.poisonAcc -= PUFFER.CLOUD_TICK; hurt?.(PUFFER.CLOUD_DPS * PUFFER.CLOUD_TICK, 'poison'); }
    }
  };

  /** Ray test from (o) along unit (d). Returns the hit index or -1; a kill sets sim.lastKill to the goo count. */
  sim.spear = (ox, oy, oz, dx, dy, dz, reach, dmg) => {
    sim.lastKill = 0;
    if (sim.key === null || !(dmg > 0)) return -1;
    let best = -1, bestT = Infinity;
    for (let i = 0; i < PUFFER.MAX; i++) {
      const f = fish[i];
      if (f.state === PUFF.DEAD) continue;
      const r = PUFFER.RADIUS * (1 + 0.85 * (f.state === PUFF.INFLATE ? swell(f.t) : 0)) + PUFFER.HIT_SLACK;
      const vx = f.x - ox, vy = f.y - oy, vz = f.z - oz;
      const t = vx * dx + vy * dy + vz * dz;
      if (t < -r || t > reach + r) continue;
      const tc = clamp(t, 0, reach), cx = ox + dx * tc - f.x, cy = oy + dy * tc - f.y, cz = oz + dz * tc - f.z;
      if (cx * cx + cy * cy + cz * cz > r * r) continue;
      if (t < bestT) { bestT = t; best = i; }
    }
    if (best < 0) return -1;
    const f = fish[best];
    f.hp -= dmg; f.hurtT = 0.25;
    if (f.hp <= 0) { f.state = PUFF.DEAD; sim.lastKill = gooDrop(rand()); }
    else if (f.state === PUFF.IDLE) { f.state = PUFF.INFLATE; f.t = 0; sim.onTrigger?.(best, f); } // a poke sets it off
    return best;
  };

  sim.alive = () => { let n = 0; for (let i = 0; i < fish.length; i++) if (fish[i].state !== PUFF.DEAD) n++; return n; };
  sim.clear = clear;
  return sim;
}
