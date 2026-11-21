// Little Raft - diving controller (friendly: no damage, no drowning).
// DIVE, DiveBody and stepOxygen are pure (no THREE, no DOM). createDiving wires the
// seafloor, underwater fx and diving UI together; it touches THREE/DOM only when called.
//
// game.js hooks:
//   import { createDiving } from './diving.js';
//   init:   diving = createDiving({T, scene, camera, ocean, islands, getTiles:() => world.tiles,
//             getDeckY:deckY, onGather:id => applyAction({kind:'gather', id}, role === 'guest' ? 'guest' : 'host')});
//   movePlayer: if (!diving?.move(dt, physics, {forward:fwd, strafe:side, yaw, pitch, up:input && held('Space'),
//             down:input && held('KeyC'), fast:input && held('ShiftLeft','ShiftRight'), gather:input && held('KeyE')}))
//             { ...existing physics.update(...) }
//   frame:  diving?.update(dt, elapsed) after updateCamera(dt); diving?.render(renderer) after renderer.render.
//   beep:   o.connect(g).connect(diving ? diving.audioOut(audio) : audio.destination)
//   dispose: diving?.dispose(); raftDebug state: dive: diving?.state
import { createSeafloor } from './seafloor.js';
import { createUnderwaterFx } from './underwater-fx.js';
import { createDivingUI } from './diving-ui.js';

export const DIVE = Object.freeze({ SPEED: 2.4, FAST: 3.4, VERTICAL: 2.2, BUOYANCY: 0.15, OXY_SECONDS: 45,
  REFILL_RATE: 4, GATHER_SECONDS: 1.0, REACH: 2.8, EYE_FLOOR_CLEAR: 0.6, RAFT_CLEAR: 0.75,
  SURFACE_EXIT: 0.15, MAX_DISTANCE: 50,
  RISE_SPEED: 3, ACCEL: 4, RAFT_MARGIN: 0.25, ENTRY_GRACE: 0.4, GATHER_CONE: 25 * Math.PI / 180, REGROW: 120 });

const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** True when (x, z) is inside any 2x2 tile square expanded by margin. */
export function underTile(tiles, x, z, margin = DIVE.RAFT_MARGIN) {
  if (!Array.isArray(tiles)) return false;
  const h = 1 + margin;
  for (const t of tiles) {
    if (!Array.isArray(t) || !Number.isFinite(t[0]) || !Number.isFinite(t[1])) continue;
    if (Math.abs(x - t[0] * 2) < h && Math.abs(z - t[1] * 2) < h) return true;
  }
  return false;
}

/** Pure oxygen step: drains over OXY_SECONDS underwater, refills REFILL_RATE times faster above. */
export function stepOxygen(o, dt, underwater) {
  o = clamp(fin(o, 1), 0, 1); dt = Math.max(0, fin(dt, 0));
  o = clamp(underwater ? o - dt / DIVE.OXY_SECONDS : o + dt * DIVE.REFILL_RATE / DIVE.OXY_SECONDS, 0, 1);
  return { oxygen: o, empty: o <= 0 };
}

/** Pure submerged swimmer. Position is the EYE. */
export class DiveBody {
  constructor({ x = 0, y = -1, z = 0, vx = 0, vy = 0, vz = 0, oxygen = 1 } = {}) {
    this.x = fin(x, 0); this.y = fin(y, -1); this.z = fin(z, 0);
    this.vx = fin(vx, 0); this.vy = fin(vy, 0); this.vz = fin(vz, 0);
    this.oxygen = clamp(fin(oxygen, 1), 0, 1);
    this.rising = this.oxygen <= 0;
    this.grace = 0;
  }

  // input {forward, strafe, yaw, pitch, up, down, fast}; env {waterY, floorY, tiles, deckY}
  step(dt, input = {}, env = {}) {
    const ev = { surfaced: false, hitFloor: false };
    dt = clamp(fin(dt, 0), 0, 0.05);
    if (dt <= 0) return ev;
    const inp = input && typeof input === 'object' ? input : {};
    const waterY = fin(env.waterY, -0.24), floorY = fin(env.floorY, -11), deckY = fin(env.deckY, 0.2);
    const tiles = Array.isArray(env.tiles) ? env.tiles : [];
    if (![this.x, this.y, this.z].every(Number.isFinite)) { this.x = 0; this.z = 0; this.y = waterY - 1; }
    if (![this.vx, this.vy, this.vz].every(Number.isFinite)) this.vx = this.vy = this.vz = 0;

    const ox = stepOxygen(this.oxygen, dt, true);
    this.oxygen = ox.oxygen;
    if (ox.empty) this.rising = true;
    this.grace = Math.max(0, this.grace - dt);

    let f = clamp(fin(inp.forward, 0), -1, 1), s = clamp(fin(inp.strafe, 0), -1, 1);
    const len = Math.hypot(f, s); if (len > 1) { f /= len; s /= len; }
    const yaw = fin(inp.yaw, 0), pitch = this.rising ? 0 : fin(inp.pitch, 0);
    const sy = Math.sin(yaw), cy = Math.cos(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const speed = inp.fast ? DIVE.FAST : DIVE.SPEED;
    const tx = (-sy * cp * f + cy * s) * speed, tz = (-cy * cp * f - sy * s) * speed;
    let ty;
    if (this.rising) ty = DIVE.RISE_SPEED;
    else ty = sp * f * speed + ((inp.up ? 1 : 0) - (inp.down ? 1 : 0)) * DIVE.VERTICAL + DIVE.BUOYANCY;
    const k = 1 - Math.exp(-DIVE.ACCEL * dt);
    this.vx += (tx - this.vx) * k; this.vz += (tz - this.vz) * k;
    this.vy += (ty - this.vy) * (this.rising ? 1 - Math.exp(-8 * dt) : k);
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;

    const d = Math.hypot(this.x, this.z);
    if (d > DIVE.MAX_DISTANCE) {
      const ux = this.x / d, uz = this.z / d, vn = this.vx * ux + this.vz * uz;
      this.x = ux * DIVE.MAX_DISTANCE; this.z = uz * DIVE.MAX_DISTANCE;
      if (vn > 0) { this.vx -= vn * ux; this.vz -= vn * uz; }
    }
    const minY = floorY + DIVE.EYE_FLOOR_CLEAR;
    if (this.y < minY) { this.y = minY; if (this.vy < 0) this.vy = 0; ev.hitFloor = true; }
    const covered = underTile(tiles, this.x, this.z);
    if (covered && this.y > deckY - DIVE.RAFT_CLEAR) { this.y = deckY - DIVE.RAFT_CLEAR; if (this.vy > 0) this.vy = 0; }
    if (this.y > waterY) this.y = waterY;

    if (!covered && this.grace <= 0 && this.vy > 0 && this.y >= waterY - DIVE.SURFACE_EXIT) {
      ev.surfaced = true; this.rising = false;
    }
    return ev;
  }
}

const NAMES = { sand: 'Sand', clay: 'Clay', scrap: 'Scrap', metalore: 'Metal ore' };

export function createDiving({ T, scene, camera, ocean, islands = [], getTiles = () => [], getDeckY = () => 0.2, onGather } = {}) {
  const seafloor = createSeafloor(T, { islands });
  scene?.add(seafloor.group);
  const fx = createUnderwaterFx(T, { scene, camera, ocean, seafloor });
  const ui = typeof document !== 'undefined' ? createDivingUI(document) : null;
  const failed = new Set();
  const safe = (name, fn) => { if (failed.has(name)) return; try { fn(); } catch (e) { failed.add(name); console.error(`diving ${name} failed`, e); } };

  let body = null, oxygen = 1, rising = false, lastInput = {};
  let underwater = false, depth = 0;
  let gather = 0, target = null, needRelease = false;
  const regrow = new Map(), listeners = new Set(), filters = new Map();

  function move(dt, physics, input = {}) {
    lastInput = input || {};
    if (!body) {
      if (!(physics?.swimming && lastInput.down && !physics.climbing && oxygen > 0.05)) return false;
      body = new DiveBody({ x: physics.x, y: physics.y, z: physics.z, vx: physics.vx, vy: Math.min(physics.vy, -1.2), vz: physics.vz, oxygen });
      body.grace = DIVE.ENTRY_GRACE;
    }
    const ev = body.step(dt, lastInput, { waterY: ocean.getHeight(body.x, body.z), floorY: seafloor.heightAt(body.x, body.z), tiles: getTiles(), deckY: getDeckY() });
    oxygen = body.oxygen; rising = body.rising;
    physics.x = body.x; physics.y = body.y; physics.z = body.z;
    physics.vx = body.vx; physics.vy = body.vy; physics.vz = body.vz;
    physics.grounded = false; physics.swimming = true;
    if (ev.surfaced) {
      physics.y = ocean.getHeight(body.x, body.z) + 0.25; physics.vy = 0.5;
      body = null; rising = false; gather = 0; target = null;
    }
    return true;
  }

  function setUnderwater(on, d) {
    depth = d;
    if (on === underwater) return;
    underwater = on;
    for (const [ctx, f] of filters) { try { f.frequency.setTargetAtTime(on ? 600 : 20000, ctx.currentTime, 0.12); } catch {} }
    const detail = { underwater, depth };
    for (const fn of listeners) { try { fn(detail); } catch (e) { console.error(e); } }
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent('raft:underwater', { detail }));
  }

  function updateGather(dt) {
    if (!body) { gather = 0; target = null; needRelease = false; return; }
    const p = camera.position, yaw = fin(lastInput.yaw, 0), pitch = fin(lastInput.pitch, 0);
    const dx = -Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = -Math.cos(yaw) * Math.cos(pitch);
    let best = null, bestScore = Infinity;
    for (const n of seafloor.nodesNear(p.x, p.y, p.z, DIVE.REACH + 0.5)) {
      const vx = n.x - p.x, vy = n.y + 0.15 - p.y, vz = n.z - p.z, dist = Math.hypot(vx, vy, vz);
      if (dist > DIVE.REACH || dist < 1e-4) continue;
      const ang = Math.acos(clamp((vx * dx + vy * dy + vz * dz) / dist, -1, 1));
      if (ang <= DIVE.GATHER_CONE && ang + dist * 0.05 < bestScore) { bestScore = ang + dist * 0.05; best = n; }
    }
    if (!lastInput.gather) needRelease = false;
    if (!best || best.id !== target?.id) gather = 0;
    target = best ? { id: best.id, type: best.type } : null;
    if (!target || !lastInput.gather || needRelease) { gather = 0; return; }
    gather += dt / DIVE.GATHER_SECONDS;
    if (gather >= 1) {
      const id = target.id;
      gather = 0; target = null; needRelease = true;
      try { onGather?.(id); } catch (e) { console.error('gather failed', e); }
      markGathered(id);
    }
  }

  function markGathered(id) {
    if (typeof id !== 'string') return;
    safe('seafloor', () => seafloor.setGathered(id, true));
    regrow.set(id, DIVE.REGROW);
  }

  function update(dt, time) {
    dt = Math.max(0, fin(dt, 0));
    const p = camera.position, surf = ocean.getHeight(p.x, p.z);
    setUnderwater(p.y < surf - 0.05, Math.max(0, surf - p.y));
    if (!body) { oxygen = stepOxygen(oxygen, dt, false).oxygen; rising = false; }
    updateGather(dt);
    for (const [id, t] of regrow) {
      if (t - dt > 0) regrow.set(id, t - dt);
      else { regrow.delete(id); safe('seafloor', () => seafloor.setGathered(id, false)); }
    }
    const lowOxygen = !!body && oxygen < 0.25;
    safe('fx', () => fx.update(dt, { underwater, depth, time, lowOxygen, breath01: oxygen }));
    safe('seafloor', () => seafloor.update(dt, camera, time));
    safe('ui', () => ui?.update({ underwater, oxygen01: oxygen, gather01: gather, rising, lowOxygen,
      gatherLabel: target ? `Hold E · ${NAMES[target.type] ?? target.type}` : '' }));
  }

  function audioOut(ctx) {
    if (!ctx) return null;
    let f = filters.get(ctx);
    if (!f) {
      f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.7;
      f.frequency.value = underwater ? 600 : 20000;
      f.connect(ctx.destination); filters.set(ctx, f);
    }
    return f;
  }

  return {
    move, update, audioOut, markGathered,
    render(renderer) { safe('fx', () => fx.render(renderer)); },
    onChange(fn) { if (typeof fn === 'function') listeners.add(fn); return () => listeners.delete(fn); },
    get state() {
      return { diving: !!body, underwater, depth, oxygen, gather: clamp(gather, 0, 1), gatherTarget: target ? { ...target } : null, rising };
    },
    seafloor,
    dispose() {
      if (underwater) setUnderwater(false, 0);
      listeners.clear(); regrow.clear(); body = null;
      for (const f of filters.values()) { try { f.disconnect(); } catch {} }
      filters.clear();
      safe('fx', () => fx.dispose()); safe('ui', () => ui?.dispose());
      scene?.remove(seafloor.group); safe('seafloor', () => seafloor.dispose());
    },
  };
}

export default createDiving;
