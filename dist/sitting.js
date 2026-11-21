// Sit on seats (see docs/specs/sitting.md). Content module 'sit'. Comfort only: sitting costs nothing and never
// traps you; any move key, Jump or E gets you up. Seats: bench (2, side by side) and cushion (1, low).
// Slice world.ext.sit = { v:1, in:{host:[x,z,seat]|null, guest:[x,z,seat]|null}, t:seconds } (host-owned).
// Host-authoritative actions 'sit.down' {x,z,seat} / 'sit.up'. Motion is taken over through the ride() hook.
import { SEATS, EYE, REACH, AWARD_S, seatPoint, findDecor, standSpot, clampYaw, defaultSit, cleanSit } from './sitting-core.js?build=v3-survival-ae77fa84ac2b';

export const TEXT = Object.freeze({
  sit: '<kbd>E</kbd>Sit',
  beside: '<kbd>E</kbd>Sit beside your brother',
  taken: 'Your brother is sitting there',
  seated: 'Sitting · <kbd>WASD</kbd>/<kbd>Space</kbd>/<kbd>E</kbd> Get up',
  reach: 'Step a little closer',
  feet: 'Find your feet first',
  oldHost: 'Your brother’s raft doesn’t have seats yet',
  noSeat: 'Nothing to sit on there',
  occupied: 'Someone is sitting there',
});
const ROLES = Object.freeze(['host', 'guest']);
const STAND_EYE = 1.6, PENDING_UP = 1, SENT_DOWN = .6, OFF_RAY = .6, MOVE = .3;
const SIT_PITCH = -.45, PITCH_EASE = .5; // on sitting, tip the view down so the deck edge shows (once; the mouse wins after). -.22 still showed only sea on an edge bench
const CY = Object.freeze({ bench: .5, cushion: .2 });

export function createSitting(ctx) {
  let slice = defaultSit();
  let pendingUp = 0, sentDown = 0, awarded = false, wasSeated = false;
  let hostHas = true, netSeen = false, netUndef = false;
  let nHx = NaN, nHz = NaN, nHs = NaN, nGx = NaN, nGz = NaN, nGs = NaN, nT = NaN; // last net copy (primitives)
  const last = { type: 'bench', x: 0, z: 0, rot: 0 }; let lastSeat = 0; // last seat (decor may vanish before we stand)
  const pt = { x: 0, z: 0, yaw: 0 }, spot = { x: 0, z: 0 }, dir = { x: 0, y: 0, z: 0 };
  let ease = 0, easeSet = NaN; // pitch ease left (s) and the pitch we last set (a different value = the player looked)
  let hitD = null, hitI = 0, camDir = null, lastYaw = null, inMax = 0; // inMax: QA, largest move input seen while seated

  const isGuest = () => ctx.role === 'guest';
  const me = () => (isGuest() ? 'guest' : 'host');
  const them = () => (isGuest() ? 'host' : 'guest');
  const deck = () => (typeof ctx.deckY === 'function' ? ctx.deckY() : 0);
  const oldHost = () => isGuest() && !hostHas;
  const seated = () => !!slice.in[me()] && !(pendingUp > 0);
  const near = (a, b) => Math.abs(a - b) < 1e-3;
  const isAt = (e, x, z) => !!e && near(e[0], x) && near(e[1], z);
  const holds = (e, d, i) => isAt(e, d.x, d.z) && e[2] === i;
  const send = a => ctx.action(a);

  // ---- targeting: nearest seat point along the view ray (sleep.js target), within reach
  function target(aim) {
    hitD = null; hitI = 0;
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !Array.isArray(w.decor)) return false;
    let ox, oy, oz;
    if (cam) { ox = cam.position.x; oy = cam.position.y; oz = cam.position.z; } else { ox = p.x; oy = p.y ?? 0; oz = p.z; }
    if (aim && aim.dir) { dir.x = aim.dir.x; dir.y = aim.dir.y; dir.z = aim.dir.z; }
    else if (cam && typeof cam.getWorldDirection === 'function' && ctx.T) { camDir ??= new ctx.T.Vector3(); cam.getWorldDirection(camDir); dir.x = camDir.x; dir.y = camDir.y; dir.z = camDir.z; }
    else return false;
    const ry = ctx.raft?.position?.y ?? 0;
    let best = Infinity;
    for (let k = 0; k < w.decor.length; k++) {
      const d = w.decor[k], seats = d && SEATS[d.type]; if (!seats) continue;
      for (let i = 0; i < seats.length; i++) {
        seatPoint(d, i, pt);
        if (Math.hypot(p.x - pt.x, p.z - pt.z) > REACH) continue;
        const vx = pt.x - ox, vy = ry + CY[d.type] - oy, vz = pt.z - oz, along = vx * dir.x + vy * dir.y + vz * dir.z;
        if (along <= 0) continue;
        const ex = vx - dir.x * along, ey = vy - dir.y * along, ez = vz - dir.z * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (off > OFF_RAY) continue;
        const score = off + along * .05;
        if (score < best) { best = score; hitD = d; hitI = i; }
      }
    }
    return !!hitD;
  }

  // ---- host side
  function refuse(text, actor) { ctx.emit?.({ kind: 'notice', text }, actor); }
  function down(a, actor) {
    const d = findDecor(ctx.world, a.x, a.z); if (!d) { refuse(TEXT.noSeat, actor); return; }
    const seats = SEATS[d.type];
    let seat = a.seat; if (!Number.isInteger(seat) || seat < 0 || seat >= seats.length) { refuse(TEXT.noSeat, actor); return; }
    const p = actor === 'guest' ? ctx.other : ctx.physics;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) { refuse(TEXT.reach, actor); return; }
    if (p.swimming) { refuse(TEXT.feet, actor); return; }
    const other = slice.in[actor === 'host' ? 'guest' : 'host'];
    if (holds(other, d, seat)) {
      const free = seats.length > 1 ? 1 - seat : -1;
      if (free < 0 || holds(other, d, free)) { refuse(TEXT.taken, actor); return; }
      seat = free;
    }
    seatPoint(d, seat, pt);
    if (Math.hypot(p.x - pt.x, p.z - pt.z) > REACH) { refuse(TEXT.reach, actor); return; }
    slice.in[actor] = [d.x, d.z, seat];
  }
  function hostStep(dt) {
    if (!ctx.other && slice.in.guest) slice.in.guest = null;
    for (const r of ROLES) {
      const e = slice.in[r]; if (!e) continue;
      const d = findDecor(ctx.world, e[0], e[1]);
      if (!d || e[2] >= SEATS[d.type].length) slice.in[r] = null; // gone (pickup, shark) or a different type now
    }
    if (slice.in.host || slice.in.guest) slice.t = Math.min(1e9, slice.t + dt);
    if (slice.t >= AWARD_S && !awarded) { awarded = true; ctx.award?.({ kind: 'sit' }); }
  }

  // ---- local player (both roles)
  function standUp() {
    const p = ctx.physics;
    pendingUp = PENDING_UP; wasSeated = false; ease = 0;
    if (p) {
      standSpot(ctx.world, findDecor(ctx.world, last.x, last.z) ?? last, lastSeat, spot);
      p.x = spot.x; p.z = spot.z; p.y = deck() + STAND_EYE; p.vx = 0; p.vy = 0; p.vz = 0; p.grounded = true;
    }
    send({ kind: 'sit.up' });
  }
  function remember(e) {
    last.x = e[0]; last.z = e[1]; lastSeat = e[2];
    const d = findDecor(ctx.world, e[0], e[1]); if (d) { last.type = d.type; last.rot = Number.isFinite(d.rot) ? d.rot : 0; }
  }
  function localStep(dt) {
    const mine = slice.in[me()];
    if (sentDown > 0) sentDown = Math.max(0, sentDown - dt);
    if (pendingUp > 0) { pendingUp -= dt; if (!mine || pendingUp <= 0) pendingUp = 0; }
    if (pendingUp > 0) return;
    if (mine) {
      remember(mine);
      if (!wasSeated) {
        wasSeated = true; sentDown = 0;
        const d = findDecor(ctx.world, mine[0], mine[1]); if (d) { seatPoint(d, mine[2], pt); ctx.faceYaw?.(pt.yaw); }
        const p0 = ctx.pitch; if (typeof ctx.facePitch === 'function' && Number.isFinite(p0) && p0 > SIT_PITCH) { ease = PITCH_EASE; easeSet = p0; }
      }
      if (ease > 0) easePitch(dt);
      if ((ctx.vitals?.hp ?? 1) <= 0) standUp(); // fainted: get up
    } else if (wasSeated) standUp(); // the host cleared the seat by itself (decor gone, or a remote sit.up)
  }

  function easePitch(dt) {
    const p0 = ctx.pitch;
    if (!Number.isFinite(p0) || Math.abs(p0 - easeSet) > 1e-4 || p0 <= SIT_PITCH) { ease = 0; return; } // the player looked: stop
    ease = Math.max(0, ease - dt);
    const p1 = ease > 0 ? p0 + (SIT_PITCH - p0) * (1 - Math.exp(-12 * dt)) : SIT_PITCH;
    ctx.facePitch(p1); easeSet = ctx.pitch;
  }

  // A new world (own save restored, or a different raft joined): drop the seat without teleporting.
  function forget() { pendingUp = 0; sentDown = 0; wasSeated = false; ease = 0; }

  function load(data, from) {
    if (from === 'net') {
      if (!netSeen && !netUndef) forget(); // first state from a host
      if (data === undefined) { if (!netUndef) { netUndef = true; hostHas = false; slice = defaultSit(); } return; }
      const h = data?.in?.host, g = data?.in?.guest;
      const hx = Array.isArray(h) ? h[0] : NaN, hz = Array.isArray(h) ? h[1] : NaN, hs = Array.isArray(h) ? h[2] : NaN;
      const gx = Array.isArray(g) ? g[0] : NaN, gz = Array.isArray(g) ? g[1] : NaN, gs = Array.isArray(g) ? g[2] : NaN, t = data?.t;
      if (netSeen && !netUndef && Object.is(hx, nHx) && Object.is(hz, nHz) && Object.is(hs, nHs) && Object.is(gx, nGx) && Object.is(gz, nGz) && Object.is(gs, nGs) && Object.is(t, nT)) return;
      nHx = hx; nHz = hz; nHs = hs; nGx = gx; nGz = gz; nGs = gs; nT = t; netUndef = false; hostHas = true; netSeen = true;
      slice = cleanSit(data);
      return;
    }
    // save / restore: only the total survives; nobody wakes up seated
    const c = cleanSit(data);
    slice = defaultSit(); slice.t = c.t;
    awarded = false; netSeen = false; netUndef = false; hostHas = true; nT = NaN;
    forget();
  }

  function promptKey(aim) {
    if (seated()) return 'seated';
    if (!target(aim)) return null;
    if (oldHost()) return 'oldHost';
    const o = slice.in[them()];
    if (holds(o, hitD, hitI)) return SEATS[hitD.type].length > 1 && !holds(o, hitD, 1 - hitI) ? 'beside' : 'taken';
    if (isAt(o, hitD.x, hitD.z)) return 'beside';
    return 'sit';
  }
  const PROVIDED = Object.freeze({
    sit: Object.freeze({ key: 'E', label: 'Sit' }),
    beside: Object.freeze({ key: 'E', label: 'Sit beside your brother' }),
    taken: Object.freeze({ label: TEXT.taken, muted: true }),
    seated: Object.freeze([{ label: 'Sitting', muted: true }, { key: 'WASD/Space/E', label: 'Get up' }]),
    oldHost: Object.freeze({ label: TEXT.oldHost, muted: true }),
  });
  let unprovide = null, lastAim = null;
  function provide() {
    const P = globalThis.raftPrompts; if (unprovide || typeof P?.provide !== 'function') return;
    unprovide = P.provide({ id: 'sit', priority: 1, prompt: pc => {
      const s = pc?.state; // yield to the built-in pickup / waiting prompts, exactly like sleep
      if (ctx.running === false || (s?.pickup && !seated()) || (s?.role === 'guest' && !s.networkReady)) return null; // seated: E gets you up, even over a pickup
      return PROVIDED[promptKey(lastAim)] ?? null;
    } });
  }

  return {
    name: 'sit',
    serialize() { return slice; },
    load,
    seated,
    action(a, actor) {
      if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('sit.')) return false;
      if (isGuest() || (actor !== 'host' && actor !== 'guest')) return true;
      if (a.kind === 'sit.down') down(a, actor);
      else if (a.kind === 'sit.up') slice.in[actor] = null;
      return true;
    },
    interact(aim) {
      if (seated()) { standUp(); return true; }
      if (!target(aim)) return false;
      if (oldHost()) { ctx.notice?.(TEXT.oldHost, 2400); return true; }
      const p = ctx.physics;
      if (!p || !p.grounded || p.swimming) { ctx.notice?.(TEXT.feet, 2400); return true; }
      if ((ctx.vitals?.hp ?? 1) <= 0) return true;
      const o = slice.in[them()];
      let seat = hitI;
      if (holds(o, hitD, seat)) {
        if (SEATS[hitD.type].length > 1 && !holds(o, hitD, 1 - seat)) seat = 1 - seat;
        else { ctx.notice?.(TEXT.taken, 2400); return true; }
      }
      if (sentDown > 0) return true; // one request in flight
      sentDown = SENT_DOWN;
      send({ kind: 'sit.down', x: hitD.x, z: hitD.z, seat });
      return true;
    },
    prompt(aim) { lastAim = aim ?? null; return TEXT[promptKey(aim)] ?? null; },
    ride(physics, dt, input) {
      if (!physics || !seated()) return false;
      if (input) inMax = Math.max(inMax, Math.abs(input.forward), Math.abs(input.strafe));
      if (input && (Math.abs(input.forward) > MOVE || Math.abs(input.strafe) > MOVE || input.jump)) { standUp(); return false; }
      const e = slice.in[me()], d = findDecor(ctx.world, e[0], e[1]);
      if (!d || e[2] >= SEATS[d.type].length) { standUp(); return false; }
      seatPoint(d, e[2], pt);
      physics.x = pt.x; physics.z = pt.z; physics.y = deck() + EYE[d.type];
      physics.vx = 0; physics.vy = 0; physics.vz = 0; physics.grounded = true;
      lastYaw = input?.yaw ?? null;
      const c = clampYaw(lastYaw, pt.yaw); if (c !== null) { ctx.faceYaw?.(c); lastYaw = c; }
      return true;
    },
    update(dt) {
      if (!(dt > 0)) dt = 0; else if (dt > 1) dt = 1; // t counts real seconds; a stalled tab adds at most 1 s
      if (!isGuest()) hostStep(dt);
      localStep(dt);
      if (!unprovide) provide();
    },
    // decor pickup (docs/specs/decor-pickup.md): an occupied seat can't be picked up; clear stale seats after.
    beforeUndecor(d) {
      if (!d || !SEATS[d.type]) return null;
      return isAt(slice.in.host, d.x, d.z) || isAt(slice.in.guest, d.x, d.z) ? TEXT.occupied : null;
    },
    afterUndecor(d) {
      if (!d) return;
      for (const r of ROLES) if (isAt(slice.in[r], d.x, d.z)) slice.in[r] = null;
    },
    debug: {
      place(type = 'bench', x = 0, z = .5, rot = 0) {
        if (!SEATS[type] || ![x, z, rot].every(Number.isFinite) || !Array.isArray(ctx.world?.decor)) return false;
        const list = ctx.world.decor;
        for (let i = list.length - 1; i >= 0; i--) if (list[i] && near(list[i].x, x) && near(list[i].z, z)) list.splice(i, 1);
        list.push(rot ? { type, x, z, rot } : { type, x, z });
        try { ctx.rebuildRaft?.(); } catch {}
        return true;
      },
      sit(x = 0, z = .5, seat = 0) {
        const p = ctx.physics, d = findDecor(ctx.world, x, z);
        if (p && d) { standSpot(ctx.world, d, seat, spot); if (Math.hypot(p.x - spot.x, p.z - spot.z) > REACH) { p.x = spot.x; p.z = spot.z; } }
        send({ kind: 'sit.down', x, z, seat });
        return true;
      },
      remove(x, z) { // QA (host): drop the seat decor at x,z, as a pickup or shark kill would
        const list = ctx.world?.decor; if (isGuest() || !Array.isArray(list)) return false;
        const i = list.findIndex(d => d && SEATS[d.type] && near(d.x, x) && near(d.z, z)); if (i < 0) return false;
        list.splice(i, 1); try { ctx.rebuildRaft?.(); } catch {} return true;
      },
      up() { if (seated()) standUp(); else send({ kind: 'sit.up' }); return true; },
      stand(x, z) { const p = ctx.physics; if (!p || !Number.isFinite(x) || !Number.isFinite(z)) return false; p.x = x; p.z = z; p.vx = 0; p.vz = 0; return true; },
      state() { return { in: JSON.parse(JSON.stringify(slice.in)), t: slice.t, seated: seated(), pendingUp, yaw: lastYaw, inMax, hostHas }; },
    },
    dispose() { try { unprovide?.(); } catch {} unprovide = null; },
  };
}
