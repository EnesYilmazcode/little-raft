// Night light content module: a held Hand Lantern lights the deck around you at night, the partner's lantern
// lights theirs, and an empty Glass Jar held near an island after dusk catches fireflies (a placeable Firefly Jar).
// No Light objects of its own: carried lights are extra prioritised slots in daynight.js's pool (DAYNIGHT_CARRY).
// No world state (no world.ext slice). Catching is a host action. Spec: docs/specs/nightlight.md.
import { DAYNIGHT_LIVE, DAYNIGHT_CARRY, lightAt } from './daynight.js?build=v3-survival-ae77fa84ac2b';
import { islandNow } from './islands.js?build=v3-survival-ae77fa84ac2b'; // same specifier as content.js: one shared instance
import { createFireflyJar, createSwarm, heldGlowMaterial } from './nightlight-models.js?build=v3-survival-ae77fa84ac2b';

export const CATCH_REACH = 6;          // metres past the island radius
export const CATCH_COOLDOWN = 1.5;     // seconds per actor
export const PARTNER_RANGE = 40;       // the partner's lantern lights the pool only this close to the camera
export const SWARM_POINTS = 40;
const MAX_JARS = 32;

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

export const catchWindow = phase => phase >= 0.64 || phase < 0.03;

// null = can catch, else 'nojar' | 'day' | 'noisland' | 'far' | 'wait'.
export function canCatch({ ready, phase, island, x, z, jars, wait } = {}) {
  if (!(jars > 0)) return 'nojar';
  if (!ready || !catchWindow(phase)) return 'day';
  if (!island || island.phase === 'gone') return 'noisland';
  if (!(Math.hypot(x - island.cx, z - island.cz) <= island.R + CATCH_REACH)) return 'far';
  if (wait) return 'wait';
  return null;
}

// Where the carried lantern's light sits: above the eye and a little ahead (flat), so it never washes out
// the viewmodel hand or the view.
export function carryPoint(cam, out) {
  const p = cam.position, yaw = cam.rotation ? cam.rotation.y : 0;
  out.x = p.x - Math.sin(yaw) * 0.3; out.y = p.y + 0.22; out.z = p.z - Math.cos(yaw) * 0.3;
  return out;
}

export function createNightlight(ctx) {
  const T = ctx.T;
  const L = { sunHeight: 0, nightFactor: 0, light: 1 };
  const glow = T ? heldGlowMaterial(T) : null;
  const wallClock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() / 1000 : time);
  const coolUntil = { host: -1e9, guest: -1e9 };
  let time = 0, nf = 0, wantClock = 1, bagVer = -2, localCool = 0, lastReason = null;

  // ---- swarm: one Points, always in the scene (its program links on the first frame), opacity 0 by day
  const swarm = T ? createSwarm(T, SWARM_POINTS) : null;
  const base = new Float32Array(SWARM_POINTS * 3), seedPh = new Float32Array(SWARM_POINTS);
  let swarmSeed = null, swarmOpacity = 0, swarmLit = false;
  const attachSwarm = () => { const s = ctx.scene; if (swarm && s && swarm.parent !== s) { swarm.removeFromParent(); s.add(swarm); } };
  attachSwarm();
  function seedSwarm(isl) {
    swarmSeed = isl.seed;
    let s = (isl.seed >>> 0) ^ 0x9e3779b9;
    const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = 0; i < SWARM_POINTS; i++) {
      const a = rnd() * Math.PI * 2, r = isl.R * 0.5 + rnd() * (isl.R * 0.5 + 3);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      let g = typeof isl.groundAt === 'function' ? isl.groundAt(isl.cx + x, isl.cz + z) - isl.gy : 0; // hover over the sand, not inside it
      if (!(g > 0)) g = 0;
      base[i * 3] = x; base[i * 3 + 1] = g + 0.4 + rnd() * 2; base[i * 3 + 2] = z;
      seedPh[i] = rnd() * 100;
    }
  }
  function driftSwarm() {
    const a = swarm.geometry.attributes.position, arr = a.array;
    for (let i = 0; i < SWARM_POINTS; i++) {
      const ph = seedPh[i], t = time * (0.35 + (ph % 1) * 0.3);
      arr[i * 3] = base[i * 3] + Math.sin(t + ph) * 0.45;
      arr[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 1.7 + ph * 2) * 0.2;
      arr[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.8 + ph) * 0.45;
    }
    a.needsUpdate = true;
  }

  // ---- placed jars (bugs spin and bob at night)
  const jars = [];
  let jarRaft = null, jarLen = -1, jarFirst = null;
  function scanJars() {
    const raft = ctx.raft;
    jars.length = 0; jarRaft = raft; jarLen = raft ? raft.children.length : -1; jarFirst = jarLen > 0 ? raft.children[0] : null;
    if (!raft) return;
    for (let i = 0; i < raft.children.length && jars.length < MAX_JARS; i++) {
      const g = raft.children[i];
      if (g.userData?.craftType !== 'fireflyjar') continue;
      for (let k = 0; k < g.children.length; k++) if (g.children[k].name === 'jarBugs') { jars.push(g.children[k]); break; }
    }
  }

  // ---- helpers
  const bag = () => { try { return ctx.localBag ? ctx.localBag() : null; } catch { return null; } };
  const heldKind = () => { const b = bag(); const s = b && b.slots ? b.slots[b.selectedIndex] : null; return s ? s.kind : null; };
  const authority = () => ctx.role !== 'guest';
  function localReason() {
    const p = ctx.physics, b = bag();
    return canCatch({ ready: DAYNIGHT_LIVE.ready, phase: DAYNIGHT_LIVE.phase, island: islandNow(), x: p ? p.x : NaN, z: p ? p.z : NaN,
      jars: b ? b.count('jar') : 0, wait: localCool > 0 });
  }

  function update(dt) {
    if (!(dt > 0)) dt = 0; else if (dt > 0.25) dt = 0.25;
    time += dt; if (localCool > 0) localCool -= dt;
    nf = DAYNIGHT_LIVE.ready ? lightAt(DAYNIGHT_LIVE.phase, L).nightFactor : 0;
    const cam = ctx.camera;
    // carried lights
    const loc = DAYNIGHT_CARRY.local, par = DAYNIGHT_CARRY.partner;
    loc.on = !!ctx.running && !!cam && heldKind() === 'handlantern';
    if (loc.on) carryPoint(cam, loc);
    const o = ctx.other;
    par.on = !!o && o.held === 'handlantern' && !!cam && Math.hypot(o.x - cam.position.x, o.z - cam.position.z) <= PARTNER_RANGE;
    if (par.on) { // at the partner's lantern hand, a little ahead of them (above their head it lit only hat and shoulders)
      const yw = Number.isFinite(o.yaw) ? o.yaw : 0;
      par.x = o.x - Math.sin(yw) * 0.35; par.y = (Number.isFinite(o.y) ? o.y : (ctx.deckY ? ctx.deckY() : 0) + 1.6) - 0.45; par.z = o.z - Math.cos(yw) * 0.35;
    }
    // Attach the pool once a lantern is owned: checked every second and at once when the bag changes (a slow
    // first frame after crafting must not leave the pool off until the lantern is equipped at night).
    wantClock += dt;
    if (!DAYNIGHT_CARRY.want) {
      const b = bag(), v = b ? b.version : -1;
      if (wantClock >= 1 || v !== bagVer) {
        wantClock = 0; bagVer = v;
        if ((b && b.count('handlantern') > 0) || par.on) DAYNIGHT_CARRY.want = true;
      }
    }
    if (glow) glow.emissiveIntensity = 0.6 + 2.0 * nf;
    // swarm
    if (swarm) {
      attachSwarm();
      const isl = islandNow();
      const live = !!isl && isl.phase !== 'gone';
      swarmLit = live && nf > 0.2;
      swarmOpacity = swarmLit ? 0.9 * smooth(0.2, 0.6, nf) : 0;
      swarm.material.opacity = swarmOpacity;
      if (live) {
        if (isl.seed !== swarmSeed) seedSwarm(isl);
        swarm.position.set(isl.cx, isl.gy, isl.cz);
        if (swarmOpacity > 0) driftSwarm();
      }
    }
    // jars
    const raft = ctx.raft;
    if (raft !== jarRaft || (raft && (raft.children.length !== jarLen || (jarLen > 0 ? raft.children[0] : null) !== jarFirst))) scanJars();
    if (nf > 0.1) for (let i = 0; i < jars.length; i++) { const m = jars[i]; m.rotation.y += 0.6 * dt; m.position.y = 0.01 * Math.sin(time * 2.2 + i * 1.3); }
  }

  function interact() {
    if (heldKind() !== 'jar') return false;
    const r = localReason(); lastReason = r;
    if (r !== null) return false;
    ctx.action({ kind: 'nightlight.catch' });
    localCool = CATCH_COOLDOWN;
    ctx.notice?.('You scoop up a few fireflies.');
    return true;
  }

  function prompt() {
    if (heldKind() !== 'jar') return null;
    const isl = islandNow();
    if (!isl || isl.phase === 'gone') return null;
    const r = localReason(); lastReason = r;
    if (r === null) return '<kbd>E</kbd>Catch fireflies';
    if (r === 'day') return 'Fireflies come out after dusk';
    return null;
  }

  function action(a, actor, b) {
    if (!a || a.kind !== 'nightlight.catch') return false;
    if (!authority()) return true;
    const who = actor === 'guest' ? 'guest' : 'host';
    const pose = who === 'guest' ? ctx.other : ctx.physics;
    if (!pose || !b) return true;
    const now = wallClock();
    const r = canCatch({ ready: DAYNIGHT_LIVE.ready, phase: DAYNIGHT_LIVE.phase, island: islandNow(), x: pose.x, z: pose.z,
      jars: b.count('jar'), wait: now < coolUntil[who] });
    if (r !== null) return true;
    if (!b.remove('jar', 1)) return true;
    const left = b.add('fireflyjar', 1);
    if (left) b.add('jar', 1);
    else coolUntil[who] = now + CATCH_COOLDOWN;
    return true;
  }

  function decorModel(type) { return type === 'fireflyjar' && T ? createFireflyJar(T) : null; }

  function dispose() {
    if (swarm) { swarm.removeFromParent(); swarm.geometry.dispose(); swarm.material.dispose(); }
    DAYNIGHT_CARRY.want = false; DAYNIGHT_CARRY.local.on = false; DAYNIGHT_CARRY.partner.on = false;
    jars.length = 0;
  }

  const debug = {
    give(kind = 'handlantern', n = 1) { const b = bag(); return b ? b.add(kind, Math.max(1, Math.min(20, n | 0))) === 0 : false; },
    state: () => ({
      nf, local: { ...DAYNIGHT_CARRY.local }, partner: { ...DAYNIGHT_CARRY.partner }, want: DAYNIGHT_CARRY.want,
      swarm: { lit: swarmLit, opacity: swarmOpacity, seed: swarmSeed }, jars: jars.length, reason: localReason(), lastReason,
    }),
    /** Host QA: catch now, ignoring the dusk window and reach (still needs a jar in the local bag). */
    catchNow() {
      if (!authority()) return false;
      const b = bag(); if (!b || !b.remove('jar', 1)) return false;
      if (b.add('fireflyjar', 1)) { b.add('jar', 1); return false; }
      return true;
    },
    /** Host QA: put a Firefly Jar on a free raft tile. */
    placeJar(x = 1, z = 0) {
      const w = ctx.world;
      if (!authority() || !w || !Number.isInteger(x) || !Number.isInteger(z)) return false;
      if (!w.tiles?.some(t => t[0] === x && t[1] === z) || w.decor.some(d => d.x === x && d.z === z)) return false;
      w.decor.push({ type: 'fireflyjar', x, z }); ctx.rebuildRaft?.(); return true;
    },
  };

  return { name: 'nightlight', update, interact, prompt, action, decorModel, serialize: () => undefined, load() {}, afterRebuild: scanJars, dispose, debug };
}
