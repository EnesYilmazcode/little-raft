// Driftboard (paddleboard) content module (docs/specs/paddleboard.md). Slice: world.ext.paddleboard.
// Host-authoritative board list ('paddleboard.*' actions); the ride pose itself is owned by the rider
// (game.js movePlayer calls content.ride(), which skips PlayerPhysics while we return true).
// Pure rules live in paddleboard-core.js; the mesh in paddleboard-model.js.
import { BOARD, wrapAngle, angDiff, headingOf, cleanSlice, nearestTile, tieSpot, deckSpot, canLaunch, rideState, rideTick, rideVel, homeStep, parallel } from './paddleboard-core.js?build=v3-survival-ae77fa84ac2b';
import { createDriftboard, disposeDriftboards } from './paddleboard-model.js?build=v3-survival-ae77fa84ac2b';

const C = BOARD, ACTIONS = ['paddleboard.launch', 'paddleboard.ride', 'paddleboard.stow', 'paddleboard.leave'];
const MODES = ['deck', 'swim', 'sand', 'snap'], GUEST_SLACK = 1, HOLD_T = .8, REQ_T = 2, TUG_EVERY = 6, STALE_T = 3;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fin = v => typeof v === 'number' && Number.isFinite(v);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const ZERO_IN = Object.freeze({ forward: 0, strafe: 0, sprint: false, yaw: NaN, jump: false, interact: false });

export function createPaddleboard(ctx) {
  const T = ctx.T;
  let slice = cleanSlice(undefined);
  const R = { on: false, id: 0, phys: null, st: rideState(), hold: { on: false, id: 0, t: 0 }, lp: 0, prevJump: false, jump: false,
    req: { on: false, id: 0, t: 0 }, tugAt: -1e9, info: { tug: 0, push: false, d: 0 } };
  const meshes = new Map(); // id -> {g, x, z, h, rx, rz, seen, clock, side, tx, tz}
  const nt = { d: 0, tx: 0, tz: 0, px: 0, pz: 0 }, spot = { x: 0, z: 0, h: 0 }, vel = { x: 0, z: 0 }, S = { h: 0, sx: 0, sz: 0 };
  const stepIn = { forward: 1, strafe: 0, sprint: false, yaw: 0 }, out = { v: 1, n: 1, boards: [] }, outBoards = [];
  let frame = 0, retie = 0, staleT = 0, clock = 0, group = null, orphanT = 0;
  // Host: a guest's ride goes live once its pose reaches the board (its first ride frame writes the board pose),
  // so the board is not dragged to where the guest stood while the confirmation travels. 6 s without that frees it.
  const GL = { id: 0, live: false, t: 0 };
  const guestLive = b => GL.id === b.id && GL.live;

  const host = () => ctx.role !== 'guest';
  const me = () => (ctx.role === 'guest' ? 'guest' : 'host');
  const peer = () => (ctx.role === 'guest' ? 'host' : 'guest');
  const tiles = () => (Array.isArray(ctx.world?.tiles) ? ctx.world.tiles : []);
  const find = id => { for (const b of slice.boards) if (b.id === id) return b; return null; };
  const posOf = actor => (actor === 'guest' ? ctx.other ?? null : ctx.physics ?? null);
  const water = (x, z) => { try { const h = ctx.ocean?.getHeight(x, z); return fin(h) ? h : 0; } catch { return 0; } };
  const notice = s => { try { ctx.notice(s); } catch {} };
  const tell = (text, actor) => { try { ctx.emit({ kind: 'notice', text }, actor); } catch {} };
  const motion = () => { const m = ctx.options?.cameraMotion; return fin(m) ? m : .35; };
  const onDeck = p => !!(p && p.grounded && nearestTile(tiles(), p.x, p.z, nt).d === 0);

  // ------------------------------------------------------------------ ride (local)
  function startRide(b) {
    const p = ctx.physics; if (!p || !b) return;
    const st = R.st;
    st.x = b.x; st.z = b.z; st.h = b.h; st.lat = 0; st.ph = 0; st.side = 1; st.wraps = 0;
    st.v = fin(p.vx) && fin(p.vz) ? clamp(p.vx * Math.sin(b.h) + p.vz * Math.cos(b.h), -C.BACK, C.SPRINT) : 0;
    R.on = true; R.id = b.id; R.phys = p; R.lp = water(b.x, b.z); R.prevJump = R.jump; R.req.on = false;
    p.mount = 'driftboard';
    writePhysics(p, 0);
  }
  function writePhysics(p, dt) {
    const st = R.st, h = water(st.x, st.z), cm = motion(), m = clamp(.4 + cm * 1.7, 0, 1);
    R.lp += (h - R.lp) * Math.min(1, dt * 1.5);
    p.x = st.x; p.z = st.z;
    p.y = R.lp + (h - R.lp) * m + C.TOP + C.EYE - .015 * Math.sin(Math.PI * st.ph) * cm;
    rideVel(st, vel); p.vx = vel.x; p.vz = vel.z; p.vy = 0;
    p.grounded = false; p.swimming = false;
    if ('climbing' in p) p.climbing = false;
    if ('_climb' in p) p._climb = null;
  }
  function leave(mode) {
    if (!R.on) return;
    if (!MODES.includes(mode)) mode = 'swim';
    const p = R.phys, st = R.st;
    R.on = false;
    try { ctx.action({ kind: 'paddleboard.leave', id: R.id, x: st.x, z: st.z, h: st.h, mode }); } catch {}
    R.id = 0;
    if (!p) return;
    if (p === ctx.physics) {
      if (mode === 'deck' && deckSpot(tiles(), p.x, p.z, spot)) {
        p.x = spot.x; p.z = spot.z; p.y = ctx.deckY() + 1.6; p.vx = p.vy = p.vz = 0; p.grounded = true; p.swimming = false;
      } else if (mode === 'swim' || mode === 'deck') {
        p.swimming = true; p.grounded = false; p.y = water(p.x, p.z) + .45; p.vx *= .5; p.vz *= .5; p.vy = 0;
      }
    }
    delete p.mount;
    if ('_prevJump' in p) p._prevJump = !!R.jump;
    if ('_jumpBuffer' in p) p._jumpBuffer = 0;
  }
  // Silent end (respawn, restore): the board stays adrift where it was.
  function endSilently() { const p = R.phys; R.phys = null; if (!R.on) return; R.on = false; try { ctx.action({ kind: 'paddleboard.leave', id: R.id, x: R.st.x, z: R.st.z, h: R.st.h, mode: 'snap' }); } catch {} R.id = 0; if (p) delete p.mount; }

  function trackHold(dt, inp) {
    const H = R.hold; if (!H.on) return;
    const b = find(H.id);
    if (!b || b.r || R.on) { H.on = false; return; }
    if (ctx.uiOpen?.()) { H.on = false; return; }
    if (inp && inp.interact) {
      H.t += dt;
      if (H.t >= HOLD_T && b.s === 'tied' && onDeck(ctx.physics)) { H.on = false; ctx.action({ kind: 'paddleboard.stow', id: b.id }); }
      return;
    }
    H.on = false;
    if (ctx.action({ kind: 'paddleboard.ride', id: b.id }) !== false && !host()) { R.req.on = true; R.req.id = b.id; R.req.t = 0; }
  }

  function ride(dt, p, inp) {
    if (!(dt >= 0)) dt = 0;
    trackHold(dt, inp);
    if (!R.on) { R.jump = !!inp?.jump; return false; }
    if (p !== R.phys || p !== ctx.physics) { endSilently(); R.jump = !!inp?.jump; return false; }
    const i = ctx.uiOpen?.() || !inp ? ZERO_IN : inp;
    R.jump = !!inp?.jump;
    const press = !!i.jump && !R.prevJump; R.prevJump = R.jump; // raw key: Space held through a closing UI is not a fresh press
    if (press) { leave('swim'); return false; }
    rideTick(R.st, i, dt, tiles(), R.info);
    if (R.info.tug > 0 && clock - R.tugAt > TUG_EVERY) { R.tugAt = clock; notice('The current tugs you back toward the raft'); }
    writePhysics(p, dt);
    if (R.st.wraps) { try { ctx.emit({ kind: 'notice', sound: 'swim' }, 'host'); } catch {} }
    return true;
  }

  function afterMove(p) {
    if (!R.on || p !== R.phys) return;
    if (p.grounded) { // islands sand or a bed snap put us down this frame
      const near = Math.hypot(R.st.x - p.x, R.st.z - p.z) <= 1.5;
      if (near) notice('You hop onto the sand');
      leave(near ? 'sand' : 'snap');
      return;
    }
    R.st.x = p.x; R.st.z = p.z; // island rock push-outs move the rider; the board follows
  }

  // ------------------------------------------------------------------ aiming
  // Ray from the camera along aim.dir against each board's capsule (nose to tail at the deck top, r .5).
  function aimBoard(aim) {
    const cam = ctx.camera; if (!aim || !aim.dir || !cam) return null;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z, dx = aim.dir.x, dy = aim.dir.y, dz = aim.dir.z;
    const max = C.REACH + .5;
    let best = null, bestT = Infinity;
    for (const b of slice.boards) {
      const e = meshes.get(b.id), bx = e ? e.x : b.x, bz = e ? e.z : b.z, bh = e ? e.h : b.h, by = e ? e.g.position.y : water(bx, bz) + C.TOP;
      const ux = Math.sin(bh) * C.HALF_LEN, uz = Math.cos(bh) * C.HALF_LEN;
      const ax = bx - ux, az = bz - uz; // segment A + s*(2u), s in [0,1]
      const vx = 2 * ux, vz = 2 * uz;
      // closest points between ray O + t d and segment A + s v (v has no y)
      const wx = ox - ax, wy = oy - by, wz = oz - az;
      const a = dx * dx + dy * dy + dz * dz, bb = dx * vx + dz * vz, c = vx * vx + vz * vz, d = dx * wx + dy * wy + dz * wz, e2 = vx * wx + vz * wz;
      const den = a * c - bb * bb;
      let s = den > 1e-9 ? clamp((a * e2 - bb * d) / den, 0, 1) : 0;
      let t = (bb * s - d) / a;
      if (t < 0) { t = 0; s = clamp(e2 / c, 0, 1); }
      if (t > max) continue;
      const px = ox + dx * t - (ax + vx * s), py = oy + dy * t - by, pz = oz + dz * t - (az + vz * s);
      if (px * px + py * py + pz * pz > .25) continue;
      if (t < bestT) { bestT = t; best = b; }
    }
    return best;
  }

  function prompt(aim) {
    if (R.on) {
      return nearestTile(tiles(), R.st.x, R.st.z, nt).d <= C.STEP_OFF ? '<kbd>E</kbd>Step onto the raft' : '<kbd>W</kbd>Paddle · E to hop off';
    }
    const b = aimBoard(aim); if (!b || b.r) return null;
    return b.s === 'tied' && onDeck(ctx.physics) ? '<kbd>E</kbd>Board the Driftboard · hold E to pick up' : '<kbd>E</kbd>Board the Driftboard';
  }

  function interact(aim) {
    if (R.on) { leave(nearestTile(tiles(), R.st.x, R.st.z, nt).d <= C.STEP_OFF ? 'deck' : 'swim'); return true; }
    if (ctx.uiOpen?.()) return false;
    const p = ctx.physics; if (!p || !(p.grounded || p.swimming) || p.diving) return false;
    const b = aimBoard(aim); if (!b || b.r) return false;
    if (R.req.on) return true;
    R.hold.on = true; R.hold.id = b.id; R.hold.t = 0;
    return true;
  }

  function use(aim, kind) {
    if (kind !== 'driftboard') return false;
    if (R.on) { notice('You’re already on a board'); return true; }
    const p = ctx.physics, pt = aim?.point;
    const why = pt && p ? canLaunch(tiles(), p.x, p.z, pt.x, pt.z) : 'Point at the water beside the raft';
    if (why) { notice(why); return true; }
    ctx.action({ kind: 'paddleboard.launch', x: pt.x, z: pt.z });
    return true;
  }

  // ------------------------------------------------------------------ host actions
  function riderOf(actor) { for (const b of slice.boards) if (b.r === actor) return b; return null; }
  function reach(actor, b, extra) {
    const p = posOf(actor); if (!p || !fin(p.x) || !fin(p.z)) return false;
    return Math.hypot(p.x - b.x, p.z - b.z) <= C.REACH + extra + (actor === 'guest' ? GUEST_SLACK : 0);
  }
  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || !ACTIONS.includes(a.kind)) return false;
    if (!host()) return true;
    const t = tiles();
    if (a.kind === 'paddleboard.launch') {
      const p = posOf(actor); if (!p || !fin(a.x) || !fin(a.z)) return true;
      let px = p.x, pz = p.z;
      if (actor === 'guest') { const d = Math.hypot(a.x - px, a.z - pz); if (d > 1e-6) { const k = Math.min(1, GUEST_SLACK / d); px += (a.x - px) * k; pz += (a.z - pz) * k; } }
      const why = canLaunch(t, px, pz, a.x, a.z);
      if (why) { tell(why, actor); return true; }
      if (slice.boards.length >= C.MAX_BOARDS) { tell('The sea is crowded with boards', actor); return true; }
      if (!bag || bag.count('driftboard') < 1) { tell('You need a Driftboard', actor); return true; }
      if (!tieSpot(t, a.x, a.z, slice.boards, 0, spot)) return true;
      bag.remove('driftboard', 1);
      slice.boards.push({ id: slice.n++, x: spot.x, z: spot.z, h: spot.h, s: 'tied', r: null });
      try { ctx.emit({ kind: 'notice', sound: 'splash' }, 'all'); } catch {}
      return true;
    }
    const b = Number.isInteger(a.id) ? find(a.id) : null;
    if (!b) return true;
    if (a.kind === 'paddleboard.ride') {
      if (b.r || riderOf(actor) || !reach(actor, b, .5)) { if (actor === 'host') notice('Someone is already on it'); return true; }
      b.r = actor;
      if (actor === 'guest') { GL.id = b.id; GL.live = false; GL.t = 0; }
      if (actor === me()) startRide(b);
      return true;
    }
    if (a.kind === 'paddleboard.stow') {
      if (b.r || !reach(actor, b, .5)) return true;
      if (!bag) return true;
      const left = bag.add('driftboard', 1);
      if (left !== 0) { if (left < 1) bag.remove('driftboard', 1 - left); tell('Your bag is full', actor); return true; }
      slice.boards.splice(slice.boards.indexOf(b), 1);
      try { ctx.emit({ kind: 'notice', text: 'Driftboard packed away', sound: 'collect' }, actor); } catch {}
      return true;
    }
    if (a.kind === 'paddleboard.leave') {
      if (b.r !== actor) return true;
      b.r = null;
      if (fin(a.x) && fin(a.z) && Math.abs(a.x) <= C.CLAMP && Math.abs(a.z) <= C.CLAMP) { b.x = a.x; b.z = a.z; }
      if (fin(a.h)) b.h = wrapAngle(a.h);
      if (a.mode === 'deck' && tieSpot(t, b.x, b.z, slice.boards, b.id, spot)) { b.x = spot.x; b.z = spot.z; b.h = parallel(b.h, spot.h); b.s = 'tied'; }
      else b.s = 'adrift';
      return true;
    }
    return true;
  }

  // ------------------------------------------------------------------ per frame
  function meshFor(b) {
    let e = meshes.get(b.id);
    if (!e) {
      if (!group) { group = new T.Group(); group.name = 'driftboards'; ctx.scene.add(group); }
      const g = createDriftboard(T); group.add(g);
      e = { g, x: b.x, z: b.z, h: b.h, rx: 0, rz: 0, seen: 0, clock: 0, side: 1, tx: NaN, tz: NaN };
      meshes.set(b.id, e);
    }
    return e;
  }
  function update(dt) {
    if (!(dt > 0)) dt = 0;
    clock += dt; frame++;
    const t = tiles(), other = ctx.other, mine = me(), theirs = peer();
    if (R.on) { const b = find(R.id); if (!b || (host() && b.r !== mine)) leave('snap'); }
    if (host()) {
      staleT = other ? 0 : staleT + dt;
      retie += dt; const doTie = retie >= 1; if (doTie) retie = 0;
      for (const b of slice.boards) {
        if (b.r === 'host') { if (R.on && R.id === b.id) { b.x = R.st.x; b.z = R.st.z; b.h = R.st.h; } else if (!R.on) { b.r = null; b.s = 'adrift'; } }
        else if (b.r === 'guest') {
          if (GL.id !== b.id) { GL.id = b.id; GL.live = true; } // e.g. a slice restored with a rider
          if (!GL.live && other && fin(other.x) && fin(other.z) && Math.hypot(other.x - b.x, other.z - b.z) < .3) GL.live = true;
          if (!GL.live) { GL.t += dt; if (GL.t > 6) { b.r = null; GL.id = 0; } }
          else if (other && fin(other.x) && fin(other.z)) {
            b.x = clamp(other.x, -C.CLAMP, C.CLAMP); b.z = clamp(other.z, -C.CLAMP, C.CLAMP);
            if (fin(other.yaw)) b.h = wrapAngle(b.h + clamp(angDiff(b.h, headingOf(other.yaw)), -C.TURN * dt, C.TURN * dt));
          } else if (staleT >= STALE_T) { b.r = null; b.s = 'adrift'; }
        } else if (b.s === 'adrift') homeStep(b, t, dt, slice.boards);
        else if (doTie && nearestTile(t, b.x, b.z, nt).d > C.R + .3) { // its tile is gone
          if (tieSpot(t, b.x, b.z, slice.boards, b.id, spot)) { b.x = spot.x; b.z = spot.z; b.h = parallel(b.h, spot.h); } else b.s = 'adrift';
        }
      }
    } else if (R.req.on) {
      const b = find(R.req.id);
      R.req.t += dt;
      if (b && b.r === 'guest') { R.req.on = false; if (!R.on) startRide(b); }
      else if (R.req.t > REQ_T) { R.req.on = false; notice('Someone is already on it'); }
    }
    if (!host()) { // guest: a board the slice says we ride while we are not (late confirmation, hot swap) is handed back
      let orphan = 0;
      if (!R.on && !R.req.on) for (const b of slice.boards) if (b.r === 'guest') { orphan = b.id; break; }
      orphanT = orphan ? orphanT + dt : 0;
      if (orphanT > 1.5) { orphanT = 0; try { ctx.action({ kind: 'paddleboard.leave', id: orphan, mode: 'swim' }); } catch {} }
    }
    // pose every board
    const ocean = ctx.ocean, k3 = Math.min(1, dt * 3), k6 = Math.min(1, dt * 6), dy = ctx.deckY?.() ?? 0;
    for (const b of slice.boards) {
      const e = meshFor(b), g = e.g; e.seen = frame;
      const local = R.on && R.id === b.id, peerRide = b.r && b.r === theirs && other && fin(other.x) && fin(other.z) && (!host() || guestLive(b));
      const px = e.x, pz = e.z;
      if (local) { e.x = R.st.x; e.z = R.st.z; e.h = R.st.h; }
      else if (peerRide) {
        e.x = damp(e.x, other.x, 10, dt); e.z = damp(e.z, other.z, 10, dt); e.h = wrapAngle(e.h + angDiff(e.h, b.h) * k6);
        if (Math.hypot(e.x - other.x, e.z - other.z) > 5) { e.x = other.x; e.z = other.z; }
      } else if (host() || Math.hypot(e.x - b.x, e.z - b.z) > 5) { e.x = b.x; e.z = b.z; e.h = b.h; }
      else { e.x += (b.x - e.x) * k6; e.z += (b.z - e.z) * k6; e.h = wrapAngle(e.h + angDiff(e.h, b.h) * k6); }
      let y = 0, along = 0, across = 0;
      if (ocean && typeof ocean.sample === 'function') {
        ocean.sample(e.x, e.z, S, undefined, 1.2); y = S.h;
        const s = Math.sin(e.h), c = Math.cos(e.h);
        along = S.sx * s + S.sz * c; across = S.sx * c - S.sz * s;
      } else y = water(e.x, e.z);
      e.rx += (-Math.atan(along) * .7 - e.rx) * k3; e.rz += (Math.atan(across) * .7 - e.rz) * k3;
      g.position.set(e.x, y + C.TOP, e.z); g.rotation.set(e.rx, e.h, e.rz, 'YXZ');
      // paddle
      const ud = g.userData;
      if (local) ud.setStroke(R.st.ph, R.st.side);
      else if (b.r) {
        if (e.clock < 0) e.clock = 0;
        const spd = dt > 0 ? Math.hypot(e.x - px, e.z - pz) / dt : 0;
        if (spd > .4) { e.clock += dt / C.STROKE; if (e.clock >= 1) { e.clock -= 1; e.side = -e.side; } }
        ud.setStroke(e.clock, e.side);
      } else if (e.clock !== -1) { ud.rest(); e.clock = -1; }
      if (b.r && e.clock < 0) e.clock = 0;
      // tie rope from the nose to the closest raft edge
      const tied = b.s === 'tied' && !b.r;
      ud.rope.visible = tied;
      if (tied) {
        const s = Math.sin(e.h), c = Math.cos(e.h);
        nearestTile(t, e.x + s * .9, e.z + c * .9, nt);
        if (nt.d < Infinity) {
          const lx = nt.px - e.x, lz = nt.pz - e.z, x = lx * c - lz * s, z = lx * s + lz * c;
          if (Math.abs(x - e.tx) > .01 || Math.abs(z - e.tz) > .01 || (frame & 15) === 0) { e.tx = x; e.tz = z; ud.setTie(x, z, dy + .02 - g.position.y); }
        } else ud.rope.visible = false;
      }
    }
    if (meshes.size > slice.boards.length) for (const [id, e] of meshes) if (e.seen !== frame) { e.g.removeFromParent(); e.g.userData.dispose?.(); meshes.delete(id); }
  }

  // ------------------------------------------------------------------ save / net
  function serialize() {
    out.n = slice.n;
    const list = slice.boards;
    while (outBoards.length < list.length) outBoards.push({ id: 0, x: 0, z: 0, h: 0, s: 'tied', r: null });
    out.boards.length = list.length;
    for (let i = 0; i < list.length; i++) {
      const b = list[i], o = outBoards[i];
      const live = R.on && R.id === b.id;
      o.id = b.id; o.x = live ? R.st.x : b.x; o.z = live ? R.st.z : b.z; o.h = live ? R.st.h : b.h; o.s = b.s; o.r = b.r;
      out.boards[i] = o;
    }
    return out;
  }
  function load(data, from) {
    slice = cleanSlice(data, from);
    if (R.on) { const b = find(R.id); if (!b || b.r !== me()) leave('snap'); }
    if (from !== 'net') R.req.on = false;
  }

  // ------------------------------------------------------------------ debug (raftDebug.content.paddleboard)
  const debug = {
    give(n = 1) { if (!host()) return 0; const b = ctx.localBag?.(); if (!b) return 0; const k = Math.max(1, Math.floor(n) || 1); return k - b.add('driftboard', k); },
    spawn(x = 0, z = -3) {
      if (!host()) return null;
      if (slice.boards.length >= C.MAX_BOARDS) return null;
      if (!tieSpot(tiles(), x, z, slice.boards, 0, spot)) return null;
      const id = slice.n++; slice.boards.push({ id, x: spot.x, z: spot.z, h: spot.h, s: 'tied', r: null });
      return id;
    },
    mount(id) {
      const b = id === undefined ? slice.boards.find(o => !o.r) : find(id);
      const p = ctx.physics; if (!b || b.r || !p || R.on) return false;
      p.x = b.x; p.z = b.z; p.swimming = true; p.grounded = false; p.vx = p.vz = 0;
      if (host()) { b.r = 'host'; startRide(b); return true; }
      if (ctx.action({ kind: 'paddleboard.ride', id: b.id }) !== false) { R.req.on = true; R.req.id = b.id; R.req.t = 0; }
      return true;
    },
    setPos(x, z, h) {
      if (!R.on || !fin(x) || !fin(z)) return false;
      R.st.x = x; R.st.z = z; if (fin(h)) R.st.h = wrapAngle(h); R.st.v = R.st.lat = 0;
      if (R.phys) writePhysics(R.phys, 0);
      return true;
    },
    leave(mode = 'swim') { if (!R.on) return false; leave(mode); return true; },
    step(sec = 1, inp = { forward: 1 }) {
      if (!R.on) return debug.state();
      stepIn.forward = fin(inp?.forward) ? inp.forward : 0; stepIn.strafe = fin(inp?.strafe) ? inp.strafe : 0; stepIn.sprint = !!inp?.sprint;
      const keepYaw = !fin(inp?.yaw);
      const n = Math.max(0, Math.min(2400, Math.round(sec / .05)));
      for (let i = 0; i < n; i++) {
        stepIn.yaw = keepYaw ? R.st.h - Math.PI : inp.yaw;
        rideTick(R.st, stepIn, .05, tiles(), R.info);
        if (R.phys) writePhysics(R.phys, .05);
      }
      return debug.state();
    },
    home(sec = 1) {
      if (!host()) return debug.state();
      const n = Math.max(0, Math.min(4800, Math.round(sec / .25)));
      for (let i = 0; i < n; i++) for (const b of slice.boards) if (!b.r && b.s === 'adrift') homeStep(b, tiles(), .25, slice.boards);
      return debug.state();
    },
    meshes() { const o = []; for (const [id, e] of meshes) o.push({ id, x: e.g.position.x, y: e.g.position.y, z: e.g.position.z, h: e.h, rope: e.g.userData.rope.visible }); return o; },
    state() {
      const st = R.st;
      return { riding: R.on, id: R.on ? R.id : 0, st: { x: st.x, z: st.z, h: st.h, v: st.v }, boards: slice.boards.map(b => ({ ...b })), info: { ...R.info } };
    },
  };

  function dispose() {
    for (const e of meshes.values()) { e.g.removeFromParent(); e.g.userData.dispose?.(); }
    meshes.clear(); group?.removeFromParent(); group = null;
    disposeDriftboards();
    if (R.phys) delete R.phys.mount;
  }

  return { name: 'paddleboard', update, afterMove, serialize, load, action, interact, prompt, use, ride, riding: () => R.on, debug, dispose };
}
