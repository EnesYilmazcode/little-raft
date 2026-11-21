// Little Raft - diving controller. Raft-style breath: 33 s (half when starving or parched); out of air
// you float up and drown at DROWN_HP per second until you surface (onDrown -> game.js hurtPlayer(hp, 'drown')).
// DIVE, DiveBody and stepOxygen are pure (no THREE, no DOM). createDiving wires the
// seafloor, underwater fx and diving UI together; it touches THREE/DOM only when called.
//
// game.js hooks:
//   import { createDiving } from './diving.js?build=v3-survival-ae77fa84ac2b';
//   init:   diving = createDiving({T, scene, camera, ocean, islands, getTiles:() => world.tiles, getDeckY:deckY,
//             onGather:id => action({kind:'gather', id}), restore:savedDiveState, getMods:out => content?.diveMods?.(out),
//             breath:() => 1 | 0.5 (breath multiplier), onDrown:hp => hurtPlayer(hp, 'drown')});
//   getMods(out): fills a {swim, oxy, fog, gather} multiplier object (1 = neutral) each frame; clamped here (docs/specs/diving-gear.md).
//   gather success (host): broadcast so EVERY client (host too) calls diving.markGathered(id).
//   movePlayer: if (!diving?.move(dt, physics, {forward, strafe, yaw, pitch, up, down, fast, gather})) physics.update(...)
//             (replacing `physics` mid-dive drops the dive automatically; diving.cancel() forces it.)
//   frame:  diving?.update(dt, elapsed) after updateCamera(dt); diving?.render(renderer) after renderer.render.
//   beep:   o.connect(g).connect(diving ? diving.audioOut(audio) : audio.destination)
//   hot-swap: const saved = diving?.capture(); diving?.dispose(); ... createDiving({..., restore:saved})
//   'raft:underwater' event / onChange detail: {underwater, depth, mount} (mount = unique per-instance token).
import { createSeafloor } from './seafloor.js?build=v3-survival-ae77fa84ac2b';
import { createUnderwaterFx } from './underwater-fx.js?build=v3-survival-ae77fa84ac2b';
import { createDivingUI } from './diving-ui.js?build=v3-survival-ae77fa84ac2b';

export const DIVE = Object.freeze({ SPEED: 2.4, FAST: 3.4, VERTICAL: 2.2, BUOYANCY: 0.15, OXY_SECONDS: 33,
  REFILL_RATE: 6, STARVED_BREATH: 0.5, DROWN_HP: 3.5, DROWN_TICK: 0.5, GATHER_SECONDS: 1.0, GATHER_SLOW: Object.freeze({ metalore: 1.4 }), REACH: 2.8, EYE_FLOOR_CLEAR: 0.6,
  RAFT_CLEAR: 0.75, SURFACE_EXIT: 0.15, MAX_DISTANCE: 420, /* just past swim-drift LOST 400: losing the raft faints you first */ RISE_SPEED: 3, ACCEL: 4, RAFT_MARGIN: 0.25, ENTRY_GRACE: 0.4,
  GATHER_CONE: 30 * Math.PI / 180, REGROW: 120, DRIFT: 1.5, PENDING: 1.5 });

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

const nearPt = [0, 0];
/** Nearest point on any 2x2 tile footprint to (x, z) (shared scratch array), or null without tiles. */
function nearestTilePoint(tiles, x, z) {
  let best = Infinity;
  for (const t of tiles) {
    if (!Array.isArray(t) || !Number.isFinite(t[0]) || !Number.isFinite(t[1])) continue;
    const px = clamp(x, t[0] * 2 - 1, t[0] * 2 + 1), pz = clamp(z, t[1] * 2 - 1, t[1] * 2 + 1);
    const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d2 < best) { best = d2; nearPt[0] = px; nearPt[1] = pz; }
  }
  return best < Infinity ? nearPt : null;
}

const oxyOut = { oxygen: 1, empty: false };
/** Pure oxygen step: drains over `secs` underwater (OXY_SECONDS times the gear and breath multipliers;
 *  breath is 0.5 while hunger or thirst is empty), refills gradually above at REFILL_RATE times the base drain.
 *  Returns a shared scratch object (copy the fields if you keep them). */
export function stepOxygen(o, dt, underwater, secs = DIVE.OXY_SECONDS) {
  o = clamp(fin(o, 1), 0, 1); dt = Math.max(0, fin(dt, 0));
  o = clamp(underwater ? o - dt / Math.max(1, fin(secs, DIVE.OXY_SECONDS)) : o + dt * DIVE.REFILL_RATE / DIVE.OXY_SECONDS, 0, 1);
  oxyOut.oxygen = o; oxyOut.empty = o <= 0;
  return oxyOut;
}

/** Pure drowning meter: collects per-step drown HP and pays it out in DROWN_TICK-sized chunks
 *  (so the hurt flash pulses about twice a second instead of every frame). */
export class DrownMeter {
  constructor() { this.acc = 0; }
  /** Adds hp (0 = not drowning: resets). Returns the HP to deal now, or 0. */
  add(hp) {
    if (!(hp > 0)) { this.acc = 0; return 0; }
    this.acc += hp;
    if (this.acc < DIVE.DROWN_HP * DIVE.DROWN_TICK - 1e-9) return 0;
    const out = this.acc; this.acc = 0; return out;
  }
  reset() { this.acc = 0; }
}

const DIRS = Array.from({ length: 16 }, (_, i) => [Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)]);

/** Pure submerged swimmer. Position is the EYE. */
export class DiveBody {
  constructor({ x = 0, y = -1, z = 0, vx = 0, vy = 0, vz = 0, oxygen = 1 } = {}) {
    this.x = fin(x, 0); this.y = fin(y, -1); this.z = fin(z, 0);
    this.vx = fin(vx, 0); this.vy = fin(vy, 0); this.vz = fin(vz, 0);
    this.oxygen = clamp(fin(oxygen, 1), 0, 1);
    this.rising = this.oxygen <= 0;
    this.grace = 0;
    this.dx = 0; this.dz = 0; this.driftT = 0;
    this.ev = { surfaced: false, hitFloor: false, drown: 0 };
  }

  /** Unit direction toward the nearest point outside the raft (sampled); falls back to away-from-centroid. */
  exitDir(tiles) {
    let best = Infinity;
    for (const [cx, cz] of DIRS) {
      for (let r = 0.5; r <= 20 && r < best; r += 0.5) {
        if (!underTile(tiles, this.x + cx * r, this.z + cz * r)) { best = r; this.dx = cx; this.dz = cz; break; }
      }
    }
    if (best === Infinity) {
      let sx = 0, sz = 0, n = 0;
      for (const t of tiles) if (Array.isArray(t) && Number.isFinite(t[0]) && Number.isFinite(t[1])) { sx += t[0] * 2; sz += t[1] * 2; n++; }
      const ax = this.x - (n ? sx / n : 0), az = this.z - (n ? sz / n : 0), l = Math.hypot(ax, az) || 1;
      this.dx = l > 1e-6 ? ax / l : 1; this.dz = l > 1e-6 ? az / l : 0;
    }
  }

  // input {forward, strafe, yaw, pitch, up, down, fast, gather}; env {waterY, floorY, tiles, deckY, breath}
  // ev.drown = HP of drowning this step (DROWN_HP * dt while out of air and still under).
  // Returns a scratch event object reused across calls.
  step(dt, input, env) {
    const ev = this.ev; ev.surfaced = false; ev.hitFloor = false; ev.drown = 0;
    dt = clamp(fin(dt, 0), 0, 0.05);
    if (dt <= 0) return ev;
    const inp = input && typeof input === 'object' ? input : {}, e = env && typeof env === 'object' ? env : {};
    const waterY = fin(e.waterY, -0.24), floorY = fin(e.floorY, -11), deckY = fin(e.deckY, 0.2);
    const tiles = Array.isArray(e.tiles) ? e.tiles : [];
    const sm = clamp(fin(e.swimMul, 1), 0.5, 2), om = clamp(fin(e.oxyMul, 1), 0.5, 3);
    if (!(Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z))) { this.x = 0; this.z = 0; this.y = waterY - 1; }
    if (!(Number.isFinite(this.vx) && Number.isFinite(this.vy) && Number.isFinite(this.vz))) this.vx = this.vy = this.vz = 0;

    const ox = stepOxygen(this.oxygen, dt, true, DIVE.OXY_SECONDS * om * clamp(fin(e.breath, 1), 0.05, 1));
    this.oxygen = ox.oxygen;
    if (ox.empty) this.rising = true;
    this.grace = Math.max(0, this.grace - dt);

    let f = clamp(fin(inp.forward, 0), -1, 1), s = clamp(fin(inp.strafe, 0), -1, 1);
    const len = Math.hypot(f, s); if (len > 1) { f /= len; s /= len; }
    const yaw = fin(inp.yaw, 0), pitch = this.rising ? 0 : fin(inp.pitch, 0);
    const sy = Math.sin(yaw), cy = Math.cos(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const speed = (inp.fast ? DIVE.FAST : DIVE.SPEED) * sm;
    let tx = (-sy * cp * f + cy * s) * speed, tz = (-cy * cp * f - sy * s) * speed, ty;
    if (this.rising) ty = DIVE.RISE_SPEED;
    else {
      ty = sp * f * speed + ((inp.up ? 1 : 0) - (inp.down ? 1 : 0)) * DIVE.VERTICAL + (inp.gather ? 0 : DIVE.BUOYANCY);
      const m = Math.hypot(tx, ty, tz);
      if (m > DIVE.FAST * sm) { const c = DIVE.FAST * sm / m; tx *= c; ty *= c; tz *= c; }
    }
    // Under the raft and floating up (out of air, or idle against the underside): drift toward open water.
    const ceil = deckY - DIVE.RAFT_CLEAR;
    const idle = len < 0.1 && !inp.up && !inp.down && !inp.gather && this.y >= ceil - 0.05;
    if ((this.rising || idle) && underTile(tiles, this.x, this.z)) {
      this.driftT -= dt;
      if (this.driftT <= 0) { this.exitDir(tiles); this.driftT = 0.3; }
      tx += this.dx * DIVE.DRIFT; tz += this.dz * DIVE.DRIFT;
    } else this.driftT = 0;

    const k = 1 - Math.exp(-DIVE.ACCEL * dt);
    this.vx += (tx - this.vx) * k; this.vz += (tz - this.vz) * k;
    this.vy += (ty - this.vy) * (this.rising ? 1 - Math.exp(-8 * dt) : k);
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;

    // Leash: MAX_DISTANCE from the nearest raft tile footprint (same rule as PlayerPhysics._safety),
    // or from the origin when there are no tiles.
    const n = nearestTilePoint(tiles, this.x, this.z), ax = n ? n[0] : 0, az = n ? n[1] : 0;
    const rx = this.x - ax, rz = this.z - az, d = Math.hypot(rx, rz);
    if (d > DIVE.MAX_DISTANCE) {
      const ux = rx / d, uz = rz / d, vn = this.vx * ux + this.vz * uz;
      this.x = ax + ux * DIVE.MAX_DISTANCE; this.z = az + uz * DIVE.MAX_DISTANCE;
      if (vn > 0) { this.vx -= vn * ux; this.vz -= vn * uz; }
    }
    const minY = floorY + DIVE.EYE_FLOOR_CLEAR;
    if (this.y < minY) { this.y = minY; if (this.vy < 0) this.vy = 0; ev.hitFloor = true; }
    const covered = underTile(tiles, this.x, this.z);
    if (covered && this.y > ceil) { this.y = ceil; if (this.vy > 0) this.vy = 0; }
    if (this.y > waterY) this.y = waterY;

    if (!covered && this.grace <= 0 && this.vy > 0 && this.y >= waterY - DIVE.SURFACE_EXIT) {
      ev.surfaced = true; this.rising = false;
    } else if (ox.empty) ev.drown = DIVE.DROWN_HP * dt;
    return ev;
  }
}

const NAMES = { sand: 'Sand', clay: 'Clay', scrap: 'Scrap', metalore: 'Metal ore' };
const token = () => `${Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) * 1000).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function createDiving({ T, scene, camera, ocean, islands = [], getTiles = () => [], getDeckY = () => 0.2, onGather, restore, hideAbove = [], getMods = null, breath = null, onDrown = null } = {}) {
  const mount = token();
  let seafloor = null, fx = null, ui = null;
  try {
    seafloor = createSeafloor(T, { islands });
    seafloor.group.visible = false; scene?.add(seafloor.group); // hidden until update() shows it (title screen was black)
    fx = createUnderwaterFx(T, { scene, camera, ocean, seafloor, hideAbove, getTiles, getDeckY });
    ui = typeof document !== 'undefined' ? createDivingUI(document) : null;
  } catch (e) { // partial construction: undo what was built, then rethrow
    try { fx?.dispose(); } catch {}
    if (seafloor) { try { scene?.remove(seafloor.group); } catch {} try { seafloor.dispose(); } catch {} }
    throw e;
  }
  const failed = new Set();
  const fail = (name, e) => { failed.add(name); console.error(`diving ${name} failed`, e); };
  // fx broke: switch its look off for good and give the ocean surface back.
  function killFx(e) {
    fail('fx', e);
    try { fx.update(0, { underwater: false, depth: 0, time: 0, lowOxygen: false, breath01: 1 }); } catch {}
    setOcean(false);
  }

  let body = null, owner = null, oxygen = clamp(fin(restore?.oxygen, 1), 0, 1), rising = false, lastInput = {};
  let underwater = false, depth = 0, floorShown = false, oceanHidden = false, oceanVis = true;
  let gather = 0, targetId = null, targetType = null, needRelease = false, labelId = null, label = '';
  let completed = false, needDownRelease = false;
  const drown = new DrownMeter(); // completed: a gather finished since the last UI update
  const regrow = new Map(), pending = new Map(), listeners = new Set(), filters = new Map();
  const env = { waterY: 0, floorY: 0, tiles: null, deckY: 0, swimMul: 1, oxyMul: 1, breath: 1 };
  const fxState = { underwater: false, depth: 0, time: 0, lowOxygen: false, breath01: 1, fogMul: 1 };
  const uiState = { underwater: false, oxygen01: 1, gather01: 0, rising: false, lowOxygen: false, gatherLabel: '', completed: false };
  const detail = { underwater: false, depth: 0, mount };
  const mods = { swim: 1, oxy: 1, fog: 1, gather: 1 };
  function readMods() { mods.swim = mods.oxy = mods.fog = mods.gather = 1; if (getMods) { try { getMods(mods); } catch (e) { console.error('dive mods failed', e); } }
    mods.swim = clamp(fin(mods.swim, 1), 0.5, 2); mods.oxy = clamp(fin(mods.oxy, 1), 0.5, 3); mods.fog = clamp(fin(mods.fog, 1), 0.5, 2); mods.gather = clamp(fin(mods.gather, 1), 0.25, 2); }

  function resetGather() {
    gather = 0; needRelease = false;
    if (targetId !== null) { targetId = targetType = null; try { seafloor.highlight?.(null); } catch {} }
  }
  function cancel() { body = null; owner = null; rising = false; drown.reset(); resetGather(); }

  function move(dt, physics, input) {
    lastInput = input || {};
    if (body && physics !== owner) { cancel(); return false; }
    if (!body) {
      if (!lastInput.down) needDownRelease = false; // after an out-of-breath surface, C must be released first
      if (needDownRelease || !(physics?.swimming && lastInput.down && !physics.climbing && oxygen >= 0.3)) return false;
      body = new DiveBody({ x: physics.x, y: physics.y, z: physics.z, vx: physics.vx, vy: Math.min(physics.vy, -1.2), vz: physics.vz, oxygen });
      body.grace = DIVE.ENTRY_GRACE; owner = physics;
    } else if (Number.isFinite(physics.x) && Number.isFinite(physics.z)) { body.x = physics.x; body.z = physics.z; } // keep outside pushes since the last step (swim-drift.js: the raft sails away from a diver too)
    env.waterY = ocean.getHeight(body.x, body.z); env.floorY = seafloor.heightAt(body.x, body.z);
    env.tiles = getTiles(); env.deckY = getDeckY(); env.swimMul = mods.swim; env.oxyMul = mods.oxy; env.breath = breathScale();
    const wasRising = body.rising;
    const ev = body.step(dt, lastInput, env);
    oxygen = body.oxygen; rising = body.rising;
    const hp = drown.add(ev.drown);
    if (hp > 0) { try { onDrown?.(hp); } catch (e) { console.error('drown failed', e); } }
    physics.x = body.x; physics.y = body.y; physics.z = body.z;
    physics.vx = body.vx; physics.vy = body.vy; physics.vz = body.vz;
    physics.grounded = false; physics.swimming = true;
    if (ev.surfaced) {
      physics.y = ocean.getHeight(body.x, body.z) + 0.25; physics.vy = 0.5;
      if (wasRising && lastInput.down) needDownRelease = true;
      cancel();
    }
    return true;
  }

  function breathScale() { try { return breath ? fin(breath(), 1) : 1; } catch { return 1; } }

  function setOcean(hide) {
    hide = hide && !failed.has('fx'); // without the fx the ocean surface is the only water cue
    const m = ocean?.mesh; if (!m || hide === oceanHidden) return;
    if (hide) { oceanVis = m.visible; m.visible = false; } else m.visible = oceanVis;
    oceanHidden = hide;
  }

  function setUnderwater(on, d) {
    depth = d;
    if (on === underwater) return;
    underwater = on; setOcean(on);
    for (const [ctx, f] of filters) { try { f.frequency.setTargetAtTime(on ? 600 : 20000, ctx.currentTime, 0.12); } catch {} }
    detail.underwater = underwater; detail.depth = depth;
    for (const fn of listeners) { try { fn(detail); } catch (e) { console.error(e); } }
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent('raft:underwater', { detail: { ...detail } }));
  }

  function updateGather(dt) {
    if (!body) { if (targetId !== null || gather) resetGather(); return; }
    const p = camera.position, yaw = fin(lastInput.yaw, 0), pitch = fin(lastInput.pitch, 0);
    const dx = -Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = -Math.cos(yaw) * Math.cos(pitch);
    let best = null, bestScore = Infinity;
    for (const n of seafloor.nodesNear(p.x, p.y, p.z, DIVE.REACH + 0.5)) {
      if (pending.has(n.id) || regrow.has(n.id) || seafloor.isGathered?.(n.id)) continue;
      const vx = n.x - p.x, vy = n.y + 0.15 - p.y, vz = n.z - p.z, dist = Math.hypot(vx, vy, vz);
      if (dist > DIVE.REACH || dist < 1e-4) continue;
      const ang = Math.acos(clamp((vx * dx + vy * dy + vz * dz) / dist, -1, 1));
      if (ang <= DIVE.GATHER_CONE && ang + dist * 0.05 < bestScore) { bestScore = ang + dist * 0.05; best = n; }
    }
    if (!lastInput.gather) needRelease = false;
    const id = best ? best.id : null;
    if (id !== targetId) {
      gather = 0; targetId = id; targetType = best ? best.type : null;
      try { seafloor.highlight?.(id); } catch {}
    }
    if (id === null || !lastInput.gather || needRelease) { gather = 0; return; }
    gather += dt / ((DIVE.GATHER_SLOW[targetType] ?? DIVE.GATHER_SECONDS) * mods.gather);
    if (gather >= 1) {
      gather = 0; needRelease = true; pending.set(id, DIVE.PENDING);
      targetId = targetType = null; try { seafloor.highlight?.(null); } catch {}
      completed = true;
      try { onGather?.(id); } catch (e) { console.error('gather failed', e); }
    }
  }

  function markGathered(id, secs = DIVE.REGROW) {
    if (typeof id !== 'string') return;
    pending.delete(id);
    regrow.set(id, Math.max(0.1, fin(secs, DIVE.REGROW)));
    try { seafloor.setGathered(id, true); } catch (e) { console.error(e); }
    if (id === targetId) { gather = 0; targetId = targetType = null; try { seafloor.highlight?.(null); } catch {} }
  }
  if (Array.isArray(restore?.regrow)) for (const r of restore.regrow) if (Array.isArray(r)) markGathered(r[0], r[1]);

  function tick(map, dt, onDone) {
    for (const [id, t] of map) { if (t - dt > 0) map.set(id, t - dt); else { map.delete(id); onDone?.(id); } }
  }
  const unGather = id => { try { seafloor.setGathered(id, false); } catch (e) { console.error(e); } };

  function update(dt, time) {
    dt = Math.max(0, fin(dt, 0));
    readMods();
    const p = camera.position, surf = ocean.getHeight(p.x, p.z);
    setUnderwater(p.y < surf - 0.05, Math.max(0, surf - p.y));
    if (!body) { oxygen = stepOxygen(oxygen, dt, false).oxygen; rising = false; }
    updateGather(dt);
    tick(regrow, dt, unGather); tick(pending, dt, null);
    const lowOxygen = !!body && oxygen < 0.25;
    if (!failed.has('fx')) {
      fxState.underwater = underwater; fxState.depth = depth; fxState.time = time; fxState.lowOxygen = lowOxygen; fxState.breath01 = oxygen; fxState.fogMul = mods.fog;
      try { fx.update(dt, fxState); } catch (e) { killFx(e); }
    }
    // The ocean is opaque from above, so the floor only matters once the eye nears the surface: the margin covers the
    // near plane (0.05 m) and mesh-vs-getHeight error, and stays under the 0.45 m swim eye height, so surface
    // swimmers skip the floor's draw calls and recentre rebuilds.
    const show = underwater || p.y < surf + 0.25;
    if (show !== floorShown) { floorShown = show; seafloor.group.visible = show; }
    seafloor.setDecor?.(underwater); // the patch shows from just above the surface; its decor only underwater
    if (show && !failed.has('seafloor')) { try { seafloor.update(dt, camera, time); } catch (e) { fail('seafloor', e); } }
    if (ui && !failed.has('ui')) {
      if (labelId !== targetId) { labelId = targetId; label = targetId ? `Hold E · ${NAMES[targetType] ?? targetType}` : ''; }
      uiState.underwater = underwater; uiState.oxygen01 = oxygen; uiState.gather01 = gather; uiState.rising = rising;
      uiState.lowOxygen = lowOxygen; uiState.gatherLabel = label; uiState.completed = completed;
      try { ui.update(uiState); } catch (e) { fail('ui', e); try { ui.dispose(); } catch {} }
    }
    completed = false;
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
    warm(r) { try { fx.warm?.(r); } catch (e) { console.error('dive warm failed', e); } }, // optional shader pre-compile
    move, update, audioOut, markGathered, cancel, mount,
    reset() { cancel(); oxygen = 1; needDownRelease = false; }, // respawn: end any dive with full lungs
    render(renderer) { if (!failed.has('fx')) { try { fx.render(renderer); } catch (e) { killFx(e); } } },
    onChange(fn) { if (typeof fn === 'function') listeners.add(fn); return () => listeners.delete(fn); },
    capture() { return { oxygen, regrow: [...regrow] }; },
    get state() {
      return { diving: !!body, underwater, depth, oxygen, gather: clamp(gather, 0, 1),
        gatherTarget: targetId ? { id: targetId, type: targetType } : null, rising, mods: { ...mods } };
    },
    seafloor,
    dispose() {
      try { if (underwater) setUnderwater(false, 0); } catch (e) { console.error(e); }
      try { setOcean(false); } catch {}
      listeners.clear(); regrow.clear(); pending.clear(); body = owner = null;
      for (const f of filters.values()) { try { f.disconnect(); } catch {} }
      filters.clear();
      try { fx.update(0, { underwater: false, depth: 0, time: 0, lowOxygen: false, breath01: 1 }); } catch {}
      try { fx.dispose(); } catch (e) { console.error(e); }
      try { ui?.dispose(); } catch (e) { console.error(e); }
      try { scene?.remove(seafloor.group); } catch {}
      try { seafloor.dispose(); } catch (e) { console.error(e); }
    },
  };
}

export default createDiving;
