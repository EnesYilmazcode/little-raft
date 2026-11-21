// Sky Rockets (see docs/specs/fireworks.md). Set a rocket on a deck tile, aim at it and press E: it fizzes, whistles up
// 25-35 m and pops into coloured sparks that briefly light the sky. Cozy: no damage, no fire, only the rocket is used up.
// Slice: world.ext.fireworks = {v:1, n} (a launch counter), host-authoritative, action 'fw.light', effect {kind:'fw'}.
// The top half of this file is pure (no DOM, no Date, no Math.random) and exported for tests.
import { createRocket, createFlight, createSparkPool } from './fireworks-model.js?build=v3-survival-ae77fa84ac2b';

export const FUSE = 1.6, RISE = 1.3, REACH = 2.6, HOST_SLACK = 2, HEAR_RANGE = 80, FLASH_GAP = 0.5, RECV_MAX_PER_S = 6;
export const SHAPES = Object.freeze(['sphere', 'ring', 'willow']);
export const COLORS = Object.freeze(['#ff9a7a', '#ffe08a', '#8fffd6', '#8cc8ff', '#e8e2ff']); // bright night coral, sunshell, seafoam, lagoon, pebble
// c = 0..4: one colour; c = 5: 'mix', where each spark picks COLORS[rnd*5]
export const BUDGET = Object.freeze({
  low: Object.freeze({ slots: 2, sparks: 60, trail: 12 }),
  medium: Object.freeze({ slots: 3, sparks: 120, trail: 24 }),
  high: Object.freeze({ slots: 4, sparks: 160, trail: 24 }),
});
const N_MAX = 2 ** 31 - 1, TILE_MAX = 64, TAU = Math.PI * 2;
const isInt = Number.isInteger;

/** Validated slice: {v:1, n} with n a non-negative int clamped to 2**31-1; junk gives 0. */
export function cleanFw(v) {
  const n = v && typeof v === 'object' && !Array.isArray(v) && isInt(v.n) && v.n >= 0 ? Math.min(v.n, N_MAX) : 0;
  return { v: 1, n };
}

/** Integer mix of three ints (murmur3 finaliser) -> uint32. */
export function hash32(a, b, c) {
  let h = Math.imul((a | 0) ^ 0x2545f491, 0x9e3779b1);
  h = Math.imul(h ^ (b | 0), 0x85ebca77); h ^= h >>> 13;
  h = Math.imul(h ^ (c | 0), 0xc2b2ae3d); h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic show for tile (x, z) on launch n: colour c 0..5 and shape seed s (uint32). */
export function fwRoll(x, z, n) {
  const h = hash32(x, z, n);
  return { c: (h >>> 8) % 6, s: h >>> 0 };
}
export const shapeOf = s => (s >>> 0) % 3;
export const heightOf = s => 25 + (((s >>> 4) & 255) / 255) * 10; // metres above the deck
export const burstLife = shape => (shape === 2 ? 3.2 : 2.0);

/** Validated 'fw' effect -> {x, z, c, s} or null. Extra fields are ignored. */
export function cleanFwMsg(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const { x, z, c, s } = e;
  if (!isInt(x) || !isInt(z) || Math.abs(x) > TILE_MAX || Math.abs(z) > TILE_MAX) return null;
  if (!isInt(c) || c < 0 || c > 5) return null;
  if (!isInt(s) || s < 0 || s > 0xffffffff) return null;
  return { x, z, c, s };
}

// (nowMs) => true for at most `max` passes in any `ms` window. (Copy of instruments.js windowGate.)
export function windowGate(max, ms = 1000) {
  const times = [];
  return (now) => {
    if (!Number.isFinite(now)) return false;
    while (times.length && now - times[0] >= ms) times.shift();
    if (times.length >= max) return false;
    times.push(now); return true;
  };
}

/** Loudness by distance: 1 at the pad, never below .2 inside HEAR_RANGE, silent beyond it. */
export function hearGain(d) {
  if (!Number.isFinite(d) || d >= HEAR_RANGE) return 0;
  return Math.max(0.2, 1 - Math.max(0, d) / HEAR_RANGE);
}

/** Sky flash envelope t s after a peak: 0 -> 1 over .25 s, eased back to 0 by 1.05 s. */
export function flashLevel(t) {
  if (!Number.isFinite(t) || t < 0 || t > 1.05) return 0;
  if (t < 0.25) return t / 0.25;
  const k = 1 - (t - 0.25) / 0.8;
  return k * k;
}

export const budgetFor = graphics => (Object.prototype.hasOwnProperty.call(BUDGET, graphics) ? BUDGET[graphics] : BUDGET.medium);

// ------------------------------------------------------------------ the content module

const S_WHISTLE = 1, S_POP = 2, S_CRACKLE = 4;
const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

export function createFireworks(ctx) {
  const T = ctx.T;
  let st = cleanFw(undefined);
  const budget = budgetFor(ctx.options?.graphics);
  const gate = windowGate(RECV_MAX_PER_S);
  const slots = Array.from({ length: budget.slots }, () => ({ t: -1, x: 0, y: 0, z: 0, shape: 0, h: 25, c: 0, spin: 0, done: 0, frozen: false }));
  let clock = 0, peakAt = -Infinity, gapAt = -Infinity, peaks = 0, owed = 0, wroteI = NaN, debugN = 0;
  let pool = null, flights = null, built = false;
  const v = T ? new T.Vector3() : null, size = T ? new T.Vector2() : null;
  const flashCols = T ? [...COLORS, '#ffe08a'].map(h => new T.Color(h)) : null; // c 0..4, then 'mix'
  const flashCol = T ? new T.Color() : null, prevHemi = T ? new T.Color() : null, wroteCol = T ? new T.Color() : null;

  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);
  const night = () => { const n = ctx.night?.() ?? 0; return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; };
  const play = (ev, s) => { try { ctx.play?.(ev, s); } catch { /* audio is optional */ } };
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : clock * 1000);

  // Spark pool and flight meshes live in ctx.scene (never ctx.raft). Created visible so the start-up shader warm-up
  // compiles them; the first update hides whatever is idle.
  function build() {
    if (built || !T || !ctx.scene) return built;
    pool = createSparkPool(T, budget);
    const cs = pool.uniforms.uColors.value;
    for (let i = 0; i < 5; i++) cs[i].fromArray(rgb(COLORS[i])); // raw sRGB: the shader writes straight to the screen
    ctx.scene.add(pool.points);
    flights = [];
    if (budget !== BUDGET.low) for (let i = 0; i < budget.slots; i++) { const f = createFlight(T); f.visible = true; f.position.set(0, -1000, 0); ctx.scene.add(f); flights.push(f); }
    built = true;
    return true;
  }

  function padDist(sl, p) { return p && Number.isFinite(p.x) ? Math.hypot(sl.x - p.x, sl.y - (Number.isFinite(p.y) ? p.y : sl.y), sl.z - p.z) : Infinity; }

  function launch(x, z, c, s, freezeAt) {
    if (!build()) return false;
    const raft = ctx.raft;
    const deckTop = (ctx.deckY?.() ?? 0.2) - (raft?.position.y ?? 0) + 0.02; // tile-top height in raft space
    v.set(x * 2, deckTop, z * 2);
    if (raft) { raft.updateMatrixWorld(); raft.localToWorld(v); }
    const p = ctx.physics, g = hearGain(p && Number.isFinite(p.x) ? Math.hypot(v.x - p.x, v.y - (p.y ?? v.y), v.z - p.z) : Infinity);
    if (g === 0 && ctx.camera && ctx.camera.position.distanceTo(v) > 200) return false;
    let sl = null, oldest = null;
    for (const q of slots) { if (q.t < 0) { sl = q; break; } if (!oldest || q.t > oldest.t) oldest = q; }
    sl = sl ?? oldest;
    const shape = shapeOf(s);
    sl.x = v.x; sl.y = v.y; sl.z = v.z; sl.shape = shape; sl.h = heightOf(s); sl.c = c;
    sl.spin = (((s >>> 12) & 1023) / 1023) * TAU;
    const frozen = typeof freezeAt === 'number' && Number.isFinite(freezeAt);
    sl.t = frozen ? Math.max(0, freezeAt) : 0; sl.frozen = frozen; sl.done = 0;
    if (frozen) { // skip the sounds of stages already passed
      if (sl.t >= FUSE) sl.done |= S_WHISTLE;
      if (sl.t >= FUSE + RISE) sl.done |= S_POP | S_CRACKLE;
    }
    if (g > 0) play('ui', 0.3 * g); // fuse fizz
    return true;
  }

  function flash(c, n) {
    if (n <= 0 || clock - gapAt < FLASH_GAP) return;
    // a new peak rises from the current level (no drop to 0 and back: no flicker when bursts are chained)
    const cur = flashLevel(clock - peakAt);
    gapAt = clock; peakAt = clock - 0.25 * cur; peaks++;
    flashCol.copy(flashCols[c < 5 ? c : 5]);
  }

  function update(dt) {
    if (!build()) return;
    const d = typeof dt === 'number' && Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    clock += d;
    const p = ctx.physics, nf = night();
    const uS = pool.uniforms.uSlot.value, uH = pool.uniforms.uShape.value;
    let live = false;
    for (let i = 0; i < slots.length; i++) {
      const sl = slots[i];
      if (sl.t >= 0) {
        if (!sl.frozen) sl.t += d;
        const t = sl.t, pop = FUSE + RISE;
        if (t >= FUSE && !(sl.done & S_WHISTLE)) { sl.done |= S_WHISTLE; const g = hearGain(padDist(sl, p)); if (g > 0) play('whistle', g); }
        if (t >= pop && !(sl.done & S_POP)) { sl.done |= S_POP; const g = hearGain(padDist(sl, p)); if (g > 0) play('pop', g); flash(sl.c, nf); }
        if (t >= pop + 0.15 && !(sl.done & S_CRACKLE)) { sl.done |= S_CRACKLE; if (sl.shape !== 1) { const g = hearGain(padDist(sl, p)); if (g > 0) play('crackle', g); } }
        if (t > pop + burstLife(sl.shape) && !sl.frozen) sl.t = -1;
      }
      const on = sl.t >= 0; live = live || on;
      uS[i].set(sl.x, sl.y, sl.z, on ? sl.t : -1);
      uH[i].set(sl.shape, sl.h, sl.spin, sl.c);
      const f = flights[i];
      if (f) {
        const rising = on && sl.t < FUSE + RISE;
        f.visible = rising;
        if (rising) {
          const u = Math.max(0, (sl.t - FUSE) / RISE), y = sl.h * (1 - (1 - u) * (1 - u));
          const wob = u > 0 ? Math.sin(sl.t * 17 + sl.spin) * .05 * (1 - u) : 0;
          f.position.set(sl.x, sl.y + y, sl.z); f.rotation.set(wob, sl.spin, wob * .7);
        }
      }
    }
    pool.points.visible = live;
    // pixel scale for point sizes: drawing-buffer height / 2 / tan(fov / 2)
    const r = ctx.renderer, cam = ctx.camera;
    if (r && typeof r.getDrawingBufferSize === 'function' && cam && cam.fov) {
      r.getDrawingBufferSize(size);
      pool.uniforms.uPx.value = size.y / 2 / Math.tan((cam.fov * Math.PI) / 360);
      pool.uniforms.uMaxPx.value = 24 * (r.getPixelRatio?.() ?? 1);
    }
    // sky flash on the existing hemisphere light, after day/night wrote it this frame (FEATURES order)
    owed = 0;
    const hemi = ctx.hemi;
    if (hemi && nf > 0) {
      const f = flashLevel(clock - peakAt) * nf;
      if (f > 0) { prevHemi.copy(hemi.color); owed = 0.35 * f; hemi.intensity += owed; hemi.color.lerp(flashCol, 0.25 * f); wroteI = hemi.intensity; wroteCol.copy(hemi.color); }
    }
  }

  // Nearest sky rocket along the view ray (or the camera forward when no aim), within reach (copy of bees.js target).
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else { if (!v) return null; cam.getWorldDirection(v); dx = v.x; dy = v.y; dz = v.z; }
    const cy = (ctx.deckY?.() ?? (ctx.raft?.position.y ?? 0) + 0.2) + 0.3;
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (!d || d.type !== 'skyrocket') continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > 0.85) continue;
      const score = off + along * 0.05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best ? { x: best.x, z: best.z } : null;
  }

  function dispose() {
    if (pool) { pool.points.removeFromParent(); pool.points.geometry.dispose(); pool.points.material.dispose(); pool = null; }
    if (flights) { for (const f of flights) { f.removeFromParent(); f.geometry.dispose(); f.material.dispose(); } flights = null; }
    built = false;
    // undo only our own write: if day/night already restored hemi (it is disposed first), leave its values alone
    const hemi = ctx.hemi;
    if (owed && hemi && hemi.intensity === wroteI && hemi.color.equals(wroteCol)) { hemi.intensity -= owed; hemi.color.copy(prevHemi); }
    owed = 0;
  }

  return {
    name: 'fireworks',
    load(data) { st = cleanFw(data); },
    serialize() { return st; },
    update,
    prompt(aim) {
      if (!target(aim)) return null;
      return night() >= 0.3 ? '<kbd>E</kbd>Light the sky rocket' : '<kbd>E</kbd>Light the sky rocket (best after dark)';
    },
    interact(aim) {
      const t = target(aim); if (!t) return false;
      ctx.action({ kind: 'fw.light', x: t.x, z: t.z }); // the guest predicts nothing; an old host ignores it
      play('ui', 0.4);
      return true;
    },
    action(a, actor) {
      if (!a || a.kind !== 'fw.light') return false;
      if (!isInt(a.x) || !isInt(a.z)) return true;
      const pose = actor === 'guest' ? ctx.other : ctx.physics;
      if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z) || Math.hypot(a.x * 2 - pose.x, a.z * 2 - pose.z) > REACH + HOST_SLACK) return true;
      const list = ctx.world?.decor; if (!Array.isArray(list)) return true;
      const i = list.findIndex(d => d && d.type === 'skyrocket' && d.x === a.x && d.z === a.z);
      if (i < 0) return true; // double press, or both players at once: it launches once
      list.splice(i, 1);
      ctx.rebuildRaft?.();
      const { c, s } = fwRoll(a.x, a.z, st.n);
      st.n = (st.n + 1) % 2 ** 31;
      ctx.emit?.({ kind: 'fw', x: a.x, z: a.z, c, s, sound: 'none' }, 'all'); // no text: old peers show no notice; 'none' plays nothing
      ctx.award?.({ kind: 'firework' });
      return true;
    },
    effect(e) {
      if (!e || e.kind !== 'fw') return false;
      const m = cleanFwMsg(e);
      if (!m || !gate(nowMs())) return true;
      launch(m.x, m.z, m.c, m.s);
      return true;
    },
    launch,
    decorModel(type) { return T && type === 'skyrocket' ? createRocket(T) : null; },
    debug: {
      /** Local show with no host action or decor; forced shape; a number t freezes the slot at that age. */
      launch(x = 0, z = 0, shape = 0, t) {
        const sh = isInt(shape) && shape >= 0 && shape <= 2 ? shape : 0;
        const { c, s: s0 } = fwRoll(x | 0, z | 0, 1000 + debugN++);
        const h = s0 >>> 1, s = h - (h % 3) + sh;
        return launch(x | 0, z | 0, c, s, t);
      },
      unfreeze() { for (const sl of slots) sl.frozen = false; },
      state: () => JSON.parse(JSON.stringify(st)),
      slots: () => slots.filter(sl => sl.t >= 0).map(sl => ({ t: sl.t, shape: sl.shape, c: sl.c, frozen: sl.frozen })),
      flash: () => ({ peaks, peakAt, owed }),
      budget: () => ({ ...budget }),
      px: () => (pool ? { px: pool.uniforms.uPx.value, maxPx: pool.uniforms.uMaxPx.value } : null),
      target: aim => target(aim),
    },
    dispose,
  };
}
