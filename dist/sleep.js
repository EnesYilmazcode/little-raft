// Simple Bed + sleep through the night (see docs/specs/sleep.md). Content module 'sleep'.
// E on a bed at dusk/night lies you down; when everyone aboard is in bed the screen fades to black,
// the host skips the clock to morning and everyone wakes beside their bed. Nothing happens unless every
// player chose to lie down, and E always gets you up again. No lying down from the water.
// [bed] A slept night costs and heals: +40 health, -20 food, -20 water (SLEEP_FX, ctx.adjustVitals).
// [bed] The bed you last lay down in (or placed) is your home: passing out wakes you beside it with
// 25 health, 50 food, 50 water (BED_RESPAWN). A bed that is gone (picked up, shark-torn tile) clears it,
// and game.js falls back to the raft centre and its own RESPAWN bars.
// Slice world.ext.sleep = { v:1, in:{host:[x,z]|null, guest:[x,z]|null}, home:{host, guest}, fade:0|1, skips }.
// Host-authoritative actions 'sleep.lie' / 'sleep.up'; the skip itself is 'daynight.skipTo'.
import { DAYNIGHT_LIVE, MORNING } from './daynight.js?build=v3-survival-ae77fa84ac2b';
import { buildBed } from './sleep-model.js?build=v3-survival-ae77fa84ac2b';

export const SLEEP_START = .66, SLEEP_END = .02;
export const HOLD = 1, FADE = 1.2, BLACK = .4, REACH = 3.2;
export const SLEEP_FX = Object.freeze({ hp: 40, food: -20, water: -20 });   // [bed] one slept night
export const BED_RESPAWN = Object.freeze({ hp: 25, food: 50, water: 50 });  // [bed] waking up at your bed
const FADE_REDUCED = .5, GUEST_FADE_MAX = 5, EYE_OFFSET = 1.6, MAX_SKIPS = 1e9;
const ROLES = Object.freeze(['host', 'guest']);

export const TEXT = Object.freeze({
  sleep: '<kbd>E</kbd>Sleep',
  notSleepy: 'Not sleepy yet. Come back after sunset',
  tooBright: 'Too bright to sleep',
  taken: 'Your brother is in this bed',
  sleeping: 'Sleeping… <kbd>E</kbd>Get up',
  waiting: 'Waiting for your brother · 1/2 sleeping · <kbd>E</kbd>Get up',
  otherAsleep: 'Your brother is sleeping. Lie down in a bed to skip the night',
  morning: 'Good morning!',
  oldHost: 'Your brother’s raft doesn’t have beds yet',
  noBed: 'Find a bed to lie down',
  reach: 'Step a little closer',
  swimming: 'Climb aboard first', // [bed]
  homeLost: 'Your bed is gone. You will wake on the raft', // [bed]
});

// ------------------------------------------------------------------ pure helpers

const isInt = Number.isInteger;
const isTile = v => Array.isArray(v) && v.length === 2 && isInt(v[0]) && isInt(v[1]) && Math.abs(v[0]) <= 25 && Math.abs(v[1]) <= 25;

/** null when sleeping is allowed, else the refusal text. day: {phase, optOut, ready}. */
export function canSleep(day) {
  if (!day || !day.ready || day.optOut || !Number.isFinite(day.phase)) return TEXT.tooBright;
  return day.phase >= SLEEP_START || day.phase < SLEEP_END ? null : TEXT.notSleepy;
}

export const defaultSleep = () => ({ v: 1, in: { host: null, guest: null }, home: { host: null, guest: null }, fade: 0, skips: 0 });

/** Validate a world.ext.sleep slice. Never throws; junk becomes defaults field by field. */
export function cleanSleep(d) {
  const out = defaultSleep();
  if (!d || typeof d !== 'object' || Array.isArray(d)) return out;
  const inn = d.in && typeof d.in === 'object' && !Array.isArray(d.in) ? d.in : {};
  if (isTile(inn.host)) out.in.host = [inn.host[0], inn.host[1]];
  if (isTile(inn.guest)) out.in.guest = [inn.guest[0], inn.guest[1]];
  const home = d.home && typeof d.home === 'object' && !Array.isArray(d.home) ? d.home : {}; // [bed]
  if (isTile(home.host)) out.home.host = [home.host[0], home.host[1]];
  if (isTile(home.guest)) out.home.guest = [home.guest[0], home.guest[1]];
  out.fade = d.fade === 1 ? 1 : 0;
  out.skips = isInt(d.skips) && d.skips >= 0 && d.skips <= MAX_SKIPS ? d.skips : 0;
  return out;
}

/** Everyone aboard is in bed (the host always counts; the guest only while connected). */
export const allInBed = (inn, guestPresent) => !!(inn && inn.host) && (!guestPresent || !!inn.guest);

/** Lying pose on bed tile (x,z): eye just above the pillow, head toward -z. */
export function bedPose(x, z, deck, out = {}) {
  out.x = x * 2; out.y = deck + .8; out.z = z * 2 - .55; // eye ~.3 m above the blanket (spec said .55: inside the blanket lip)
  return out;
}

/** Where to stand after getting up: a free neighbour tile centre, else just beside the bed. */
export function getUpSpot(world, x, z, out = {}) {
  const tiles = Array.isArray(world?.tiles) ? world.tiles : [], decor = Array.isArray(world?.decor) ? world.decor : [];
  const hasTile = (a, b) => tiles.some(t => t && t[0] === a && t[1] === b);
  const blocked = (a, b) => decor.some(d => d && d.x === a && d.z === b && d.type !== 'net');
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const a = x + dx, b = z + dz;
    if (hasTile(a, b) && !blocked(a, b)) { out.x = a * 2; out.z = b * 2; return out; }
  }
  out.x = x * 2 + .8; out.z = z * 2;
  return out;
}

// ------------------------------------------------------------------ the content module

export function createSleep(ctx, opts = {}) {
  const T = ctx.T;
  const day = typeof opts.day === 'function' ? opts.day : () => DAYNIGHT_LIVE;
  let slice = defaultSleep();
  let seq = 'idle', t = 0, fadeT = 0, seqKey = 0, fadeDur = FADE, motionChecked = false;
  let hostHas = true, netSeen = false, netUndef = false;
  let nHx = NaN, nHz = NaN, nGx = NaN, nGz = NaN, nFade = -1, nSkips = -1; // last net copy (primitives)
  let guestFadeHeld = 0, lastSkips = 0;
  let lying = false, lx = 0, lz = 0, upSent = false, otherWasIn = false;
  let seenSkips = 0, hadHome = false; // [bed] skips counted for the sleep effect; home notice
  let nHHx = NaN, nHHz = NaN, nHGx = NaN, nHGz = NaN; // [bed] last net home copy
  let model = null, veil = null, veilOpacity = -1;
  const pose = {}, spot = {}, scratch = T ? new T.Vector3() : null;

  const isGuest = () => ctx.role === 'guest';
  const myRole = () => (isGuest() ? 'guest' : 'host');
  const otherRole = () => (isGuest() ? 'host' : 'guest');
  const otherPresent = () => (isGuest() ? true : !!ctx.other);
  const decorAt = (x, z) => { const d = ctx.world?.decor; if (!Array.isArray(d)) return null; for (let i = 0; i < d.length; i++) if (d[i].x === x && d[i].z === z) return d[i].type; return null; };
  const posOf = actor => (actor === 'guest' ? ctx.other : ctx.physics) ?? null; // both carry x, z, swimming
  const same = (a, x, z) => !!a && a[0] === x && a[1] === z;
  const deck = () => (typeof ctx.deckY === 'function' ? ctx.deckY() : 0);
  const oldHost = () => isGuest() && !hostHas;

  function checkMotion() {
    if (motionChecked) return; motionChecked = true;
    try { if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) fadeDur = FADE_REDUCED; } catch {}
  }

  // Nearest bed along the view ray (or the camera forward when no aim), within reach. Same test as storage.
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || p.swimming || !Array.isArray(w.decor)) return null; // [bed] not from the water
    let dx, dy, dz, ox, oy, oz;
    if (cam) { ox = cam.position.x; oy = cam.position.y; oz = cam.position.z; } else { ox = p.x; oy = p.y ?? 0; oz = p.z; }
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else if (cam && scratch) { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    else return null;
    let best = null, bestScore = Infinity;
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (d.type !== 'bed') continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      const cy = (ctx.raft?.position.y ?? 0) + .5;
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > .95) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  // ---- host side
  function refuse(text, actor) { ctx.emit?.({ kind: 'notice', text }, actor); }
  function lie(a, actor) {
    if (!isInt(a.x) || !isInt(a.z) || Math.abs(a.x) > 25 || Math.abs(a.z) > 25) return;
    if (decorAt(a.x, a.z) !== 'bed') { refuse(TEXT.noBed, actor); return; }
    const p = posOf(actor);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || Math.hypot(p.x - a.x * 2, p.z - a.z * 2) > REACH) { refuse(TEXT.reach, actor); return; }
    if (p.swimming) { refuse(TEXT.swimming, actor); return; } // [bed] a swimmer would be put on the deck at sea level
    const why = canSleep(day()); if (why) { refuse(why, actor); return; }
    const other = actor === 'host' ? 'guest' : 'host';
    if (same(slice.in[other], a.x, a.z)) { refuse(TEXT.taken, actor); return; }
    slice.in[actor] = [a.x, a.z];
    slice.home[actor] = [a.x, a.z]; // [bed] the last bed you used is where you wake up
  }
  /** [bed] Host: a newly placed bed is its placer's home. */
  function placed(type, x, z, actor) {
    if (isGuest() || type !== 'bed' || (actor !== 'host' && actor !== 'guest') || decorAt(x, z) !== 'bed') return;
    slice.home[actor] = [x, z];
  }

  const keyOf = () => (slice.in.host ? 1 : 0) + (slice.in.guest ? 2 : 0) + (ctx.other ? 4 : 0);
  function hostStep(dt) {
    if (!ctx.other && slice.in.guest) slice.in.guest = null;
    for (const r of ROLES) { const b = slice.in[r]; if (b && decorAt(b[0], b[1]) !== 'bed') slice.in[r] = null; }
    for (const r of ROLES) { const h = slice.home[r]; if (h && decorAt(h[0], h[1]) !== 'bed') slice.home[r] = null; } // [bed] picked up or torn off
    const all = allInBed(slice.in, !!ctx.other), key = keyOf();
    if ((seq === 'hold' || seq === 'out') && (!all || key !== seqKey)) seq = 'idle'; // someone got up or left: fade back in
    if (seq === 'idle') {
      if (all) { seq = 'hold'; t = 0; seqKey = key; }
    } else if (seq === 'hold') {
      t += dt; if (t >= HOLD) { seq = 'out'; checkMotion(); }
    } else if (seq === 'out') {
      fadeT += dt;
      if (fadeT >= fadeDur) {
        fadeT = fadeDur; seq = 'black'; t = 0;
        ctx.action({ kind: 'daynight.skipTo', phase: MORNING });
        slice.skips = Math.min(MAX_SKIPS, slice.skips + 1);
      }
    } else if (seq === 'black') {
      t += dt;
      if (t >= BLACK) { slice.in.host = null; slice.in.guest = null; seq = 'idle'; ctx.notice?.(TEXT.morning, 2600); }
    }
    if (seq === 'idle' || seq === 'hold') fadeT = Math.max(0, fadeT - dt);
    slice.fade = seq === 'out' || seq === 'black' ? 1 : 0;
  }

  // ---- guest side fade
  function guestStep(dt) {
    if (slice.fade === 1) guestFadeHeld += dt; else guestFadeHeld = 0;
    const want = slice.fade === 1 && guestFadeHeld <= GUEST_FADE_MAX;
    if (want) checkMotion();
    fadeT = want ? Math.min(fadeDur, fadeT + dt) : Math.max(0, fadeT - dt);
  }

  // ---- local player (both roles)
  function localStep() {
    if (slice.skips !== seenSkips) { if (lying) ctx.adjustVitals?.(SLEEP_FX.hp, SLEEP_FX.food, SLEEP_FX.water); seenSkips = slice.skips; } // [bed] slept through: before the get-up below
    const home = !!slice.home[myRole()]; if (hadHome && !home) ctx.notice?.(TEXT.homeLost, 2600); hadHome = home; // [bed]
    if (lying && !upSent && ctx.vitals && !(ctx.vitals.hp > 0)) { upSent = true; ctx.action({ kind: 'sleep.up' }); } // [bed] passed out in bed
    const mine = slice.in[myRole()], theirs = slice.in[otherRole()];
    if (mine && !lying) { lying = true; upSent = false; }
    if (mine) { lx = mine[0]; lz = mine[1]; }
    if (!mine && lying) { lying = false; upSent = false; standUp(); }
    if (lying && !upSent && ctx.uiOpen?.()) { upSent = true; ctx.action({ kind: 'sleep.up' }); }
    const theirsIn = !!theirs && otherPresent();
    if (theirsIn && !otherWasIn && !mine) ctx.notice?.(TEXT.otherAsleep, 3200);
    otherWasIn = theirsIn;
  }
  function standUp() {
    const p = ctx.physics; if (!p) return;
    getUpSpot(ctx.world, lx, lz, spot);
    p.x = spot.x; p.z = spot.z; p.y = deck() + EYE_OFFSET; p.vx = 0; p.vy = 0; p.vz = 0; p.grounded = true;
  }

  function opacity() { return fadeDur > 0 ? Math.max(0, Math.min(1, fadeT / fadeDur)) : 0; }
  function paintVeil() {
    const o = opacity();
    if (o === veilOpacity) return;
    if (!veil) {
      if (o <= 0 || typeof document === 'undefined' || !document.body) return;
      veil = document.createElement('div'); veil.id = 'sleepVeil';
      veil.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:31';
      document.body.appendChild(veil);
    }
    veilOpacity = o; veil.style.opacity = String(Math.round(o * 1000) / 1000);
  }

  // A new world (own save restored, or a different raft joined): drop the lying pin without standUp(), whose
  // bed tile belongs to the old world and would teleport the player (often into the sea).
  function forgetLying() { lying = false; upSent = false; otherWasIn = false; }

  function load(data, from) {
    if (from === 'net') {
      if (!netSeen && !netUndef) forgetLying(); // first state from a host
      if (data === undefined) { if (!netUndef) { netUndef = true; hostHas = false; slice = defaultSleep(); } return; }
      const h = data && data.in && data.in.host, g = data && data.in && data.in.guest;
      const hx = Array.isArray(h) ? h[0] : NaN, hz = Array.isArray(h) ? h[1] : NaN, gx = Array.isArray(g) ? g[0] : NaN, gz = Array.isArray(g) ? g[1] : NaN;
      const f = data && data.fade, s = data && data.skips;
      const hh = data && data.home && data.home.host, hg = data && data.home && data.home.guest; // [bed]
      const hhx = Array.isArray(hh) ? hh[0] : NaN, hhz = Array.isArray(hh) ? hh[1] : NaN, hgx = Array.isArray(hg) ? hg[0] : NaN, hgz = Array.isArray(hg) ? hg[1] : NaN;
      if (netSeen && !netUndef && Object.is(hx, nHx) && Object.is(hz, nHz) && Object.is(gx, nGx) && Object.is(gz, nGz) && f === nFade && s === nSkips
        && Object.is(hhx, nHHx) && Object.is(hhz, nHHz) && Object.is(hgx, nHGx) && Object.is(hgz, nHGz)) return;
      nHx = hx; nHz = hz; nGx = gx; nGz = gz; nFade = f; nSkips = s; netUndef = false; hostHas = true;
      nHHx = hhx; nHHz = hhz; nHGx = hgx; nHGz = hgz;
      slice = cleanSleep(data);
      if (netSeen && slice.skips > lastSkips) ctx.notice?.(TEXT.morning, 2600);
      if (!netSeen) { seenSkips = slice.skips; hadHome = !!slice.home[myRole()]; } // [bed] joining: no sleep effect, no "bed gone" notice
      lastSkips = slice.skips; netSeen = true;
      return;
    }
    // save / restore: the counter and the home beds survive; nobody starts a session in bed
    const c = cleanSleep(data);
    slice = defaultSleep(); slice.skips = c.skips; slice.home = c.home; seenSkips = c.skips; hadHome = !!c.home[myRole()]; // [bed]
    nHHx = nHHz = nHGx = nHGz = NaN;
    seq = 'idle'; t = 0; fadeT = 0; netSeen = false; netUndef = false; hostHas = true; nFade = -1; nSkips = -1;
    lastSkips = slice.skips; guestFadeHeld = 0; forgetLying();
  }

  const send = a => ctx.action(a);

  // Which TEXT key the context prompt shows (null = nothing to say).
  function promptKey(aim) {
    if (lying) return otherPresent() && !slice.in[otherRole()] ? 'waiting' : 'sleeping';
    const d = target(aim); if (!d) return null;
    if (oldHost()) return 'oldHost';
    const why = canSleep(day()); if (why) return why === TEXT.tooBright ? 'tooBright' : 'notSleepy';
    if (same(slice.in[otherRole()], d.x, d.z)) return 'taken';
    return 'sleep';
  }
  // The visible key prompt is prompts.js (#contextPrompt is hidden by prompts.css), so feed it plain labels too.
  const GET_UP = Object.freeze({ key: 'E', label: 'Get up' });
  const PROVIDED = Object.freeze({
    sleep: Object.freeze({ key: 'E', label: 'Sleep' }),
    sleeping: Object.freeze([{ label: 'Sleeping…', muted: true }, GET_UP]),
    waiting: Object.freeze([{ label: 'Waiting for your brother · 1/2 sleeping', muted: true }, GET_UP]),
    notSleepy: Object.freeze({ label: TEXT.notSleepy, muted: true }),
    tooBright: Object.freeze({ label: TEXT.tooBright, muted: true }),
    taken: Object.freeze({ label: TEXT.taken, muted: true }),
    oldHost: Object.freeze({ label: TEXT.oldHost, muted: true }),
  });
  let unprovide = null, lastAim = null; // lastAim: game.js passes its frame aim to prompt() every frame
  function provide() {
    const P = globalThis.raftPrompts; if (unprovide || typeof P?.provide !== 'function') return;
    unprovide = P.provide({ id: 'sleep', priority: 1, prompt: pc => {
      const s = pc?.state; // yield to the built-in pickup / waiting prompts (priority 0): pickups win E in game.js
      if (ctx.running === false || s?.pickup || (s?.role === 'guest' && !s.networkReady)) return null;
      return PROVIDED[promptKey(lastAim)] ?? null;
    } });
  }

  // [bed] Where the local player wakes after passing out: beside their home bed, or null (no bed / it is gone).
  function respawnSpot(out = {}) {
    const h = slice.home[myRole()]; if (!h || decorAt(h[0], h[1]) !== 'bed') return null;
    getUpSpot(ctx.world, h[0], h[1], out); out.bed = true;
    return out;
  }

  return {
    name: 'sleep',
    beforeUndecor(d) { return d?.type === 'bed' && (same(slice.in.host, d.x, d.z) || same(slice.in.guest, d.x, d.z)) ? 'Someone is in that bed' : null; }, // [undecor]
    afterUndecor(d) { if (d?.type === 'bed') for (const r of ROLES) if (same(slice.in[r], d.x, d.z)) slice.in[r] = null; }, // [undecor] stale only: beforeUndecor refuses an occupied bed
    serialize() { return slice; },
    placed, respawnSpot, // [bed] content hooks (game.js: a bed was built; where to wake up)
    load,
    action(a, actor) {
      if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('sleep.')) return false;
      if (isGuest() || (actor !== 'host' && actor !== 'guest')) return true;
      if (a.kind === 'sleep.lie') lie(a, actor);
      else if (a.kind === 'sleep.up') slice.in[actor] = null;
      return true;
    },
    interact(aim) {
      if (lying) { upSent = true; send({ kind: 'sleep.up' }); return true; }
      const d = target(aim); if (!d) return false;
      if (oldHost()) { ctx.notice?.(TEXT.oldHost, 2400); return true; }
      const why = canSleep(day()); if (why) { ctx.notice?.(why, 2400); return true; }
      if (same(slice.in[otherRole()], d.x, d.z)) { ctx.notice?.(TEXT.taken, 2400); return true; }
      send({ kind: 'sleep.lie', x: d.x, z: d.z });
      return true;
    },
    prompt(aim) { lastAim = aim ?? null; return TEXT[promptKey(aim)] ?? null; },
    afterMove(physics) {
      if (!lying || !physics) return;
      bedPose(lx, lz, deck(), pose);
      physics.x = pose.x; physics.y = pose.y; physics.z = pose.z;
      physics.vx = 0; physics.vy = 0; physics.vz = 0; physics.grounded = true;
    },
    update(dt) {
      if (!(dt > 0)) dt = 0; else if (dt > .25) dt = .25;
      if (isGuest()) guestStep(dt); else hostStep(dt);
      localStep();
      paintVeil();
      if (!unprovide) provide();
    },
    decorModel(type) {
      if (type !== 'bed' || !T) return null;
      model ??= buildBed(T);
      return model.instance();
    },
    debug: {
      give(n = 1) { try { return ctx.localBag().add('bed', Math.max(1, Math.min(20, n | 0))) === 0; } catch { return false; } },
      place(x = 1, z = 0) { try { if (!ctx.localBag().count('bed')) ctx.localBag().add('bed', 1); ctx.action({ kind: 'build', recipe: 'bed', x: x | 0, z: z | 0 }); return decorAt(x | 0, z | 0) === 'bed'; } catch { return false; } },
      lie(x = 1, z = 0) {
        const p = ctx.physics;
        if (p && Math.hypot(p.x - x * 2, p.z - z * 2) > REACH) { getUpSpot(ctx.world, x, z, spot); p.x = spot.x; p.z = spot.z; }
        send({ kind: 'sleep.lie', x: x | 0, z: z | 0 });
        return true;
      },
      up() { send({ kind: 'sleep.up' }); return true; },
      stand(x, z) { const p = ctx.physics; if (!p || !Number.isFinite(x) || !Number.isFinite(z)) return false; p.x = x; p.z = z; p.vx = 0; p.vz = 0; return true; }, // QA: move the local player (metres, raft frame)
      state() { return { ...JSON.parse(JSON.stringify(slice)), seq, lying, opacity: opacity(), hostHas, fadeDur }; },
      home() { return respawnSpot({}); }, // [bed] QA: the local wake-up spot or null
    },
    dispose() { try { unprovide?.(); } catch {} unprovide = null; veil?.remove(); veil = null; veilOpacity = -1; model?.dispose(); model = null; },
  };
}
