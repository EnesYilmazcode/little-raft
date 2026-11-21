// Zipline content module (docs/specs/zipline.md): Zipline Posts on the deck or an upper floor, a rope line
// between two of them, and a local ride along it with E (Space lets go). Posts and lines are host-owned in
// world.ext.zipline; riding is local only (the remote avatar just shows the airborne pose).
import { ZIP, ZIP_TEXT, blankZip, cleanZip, applyZip, canPost, canLink, supported, postById, linesOf, hasLine,
  topOf, ropePoint, linePoints, rideStep, riderPose, landSpot, prune, bumpZip, inReach } from './zipline-rules.js?build=v3-survival-ae77fa84ac2b';
import { createZipKit } from './zipline-models.js?build=v3-survival-ae77fa84ac2b';

const AIM_POST = 4, POST_R = .4, PENDING_S = 20;

export function createZipline(ctx, { peek } = {}) {
  const T = ctx.T;
  let state = blankZip(), netRev = -1, builtRev = -1, dirty = true;
  let seenPieces = null, seenTiles = null, seenTilesN = -1;
  let kit = null, group = null, ghost = null, previewLine = null;
  let aimPost = null, aimPostDist = 0, place = null, pending = null, lastHeld = null, ride = null, hold = false;
  const placeTgt = { i: 0, j: 0, l: 0, why: '' };
  const tA = {}, tB = {}, rp = {}, land = {};

  const isGuest = () => ctx.role === 'guest';
  const myRole = () => (isGuest() ? 'guest' : 'host');
  const heldKind = () => { const b = ctx.localBag?.(); return b?.slots?.[b.selectedIndex]?.kind ?? null; };
  const yOff = () => ctx.deckY() - ZIP.FLOOR_Y; // world y = raft-local y + yOff (the raft never moves in x/z)
  const send = a => ctx.action(a);

  function ensureScene() {
    if (group || !ctx.scene) return !!group;
    kit = createZipKit(T);
    group = new T.Group(); group.name = 'zipline'; ctx.scene.add(group);
    ghost = kit.ghost(); previewLine = kit.previewLine();
    return true;
  }
  function clearMeshes() {
    if (!group) return;
    for (const c of [...group.children]) {
      if (c === ghost || c === previewLine) continue;
      group.remove(c); if (c.userData.line) c.geometry.dispose();
    }
  }
  function rebuild() {
    if (!ensureScene()) return;
    clearMeshes();
    if (!ghost.parent) group.add(ghost);
    if (!previewLine.parent) group.add(previewLine);
    for (const p of state.posts) {
      const m = kit.postModel(); m.position.set(2 * p.i, ZIP.FLOOR_Y + p.l * ZIP.LEVEL_H, 2 * p.j);
      const ln = state.lines.find(l => l[0] === p.id || l[1] === p.id), o = ln && postById(state, ln[0] === p.id ? ln[1] : ln[0]);
      if (o) m.rotation.y = -Math.atan2(2 * (o.j - p.j), 2 * (o.i - p.i)); // pulley wheel in the line's plane
      group.add(m);
    }
    for (const [a, b] of state.lines) {
      const A = postById(state, a), B = postById(state, b); if (!A || !B) continue;
      const m = kit.lineMesh(linePoints(topOf(A, {}), topOf(B, {}), 24)); m.userData.line = true; group.add(m);
    }
    builtRev = state.rev; dirty = false;
  }

  // ---------- pruning (host): a post whose deck tile or floor vanished drops, with its lines, refunded ----------
  function doPrune() {
    const w = ctx.world; if (!w) return;
    seenPieces = w.pieces; seenTiles = w.tiles; seenTilesN = Array.isArray(w.tiles) ? w.tiles.length : -1;
    if (isGuest()) return;
    const n = prune(state, w);
    if (!n.posts && !n.lines) return;
    state.rev = state.rev >= ZIP.MAX_REV ? 1 : state.rev + 1; dirty = true;
    // Refund the host; what does not fit goes to the partner's bag, and only then is it lost.
    const bag = ctx.localBag?.(), alt = ctx.other ? ctx.actorBag?.('guest') : null;
    let lost = 0;
    for (const [k, c] of [['zippost', n.posts], ['rope', n.lines]]) {
      let left = c ? (bag ? bag.add(k, c) : c) : 0;
      if (left && alt) left = alt.add(k, left);
      lost += left;
    }
    ctx.notice?.(lost ? 'A zipline post lost its floor (your bag was too full for all of it)' : 'A zipline post lost its floor');
  }

  // ---------- aiming ----------
  // Ray against each post's vertical cylinder (raft-local). Nearest hit within AIM_POST m.
  function pickPost(aim) {
    aimPost = null; aimPostDist = 0;
    const d = aim?.dir, cam = ctx.camera?.position; if (!d || !cam || !state.posts.length) return null;
    const ox = cam.x, oy = cam.y - yOff(), oz = cam.z, a = d.x * d.x + d.z * d.z;
    let best = AIM_POST;
    for (const p of state.posts) {
      const cx = 2 * p.i, cz = 2 * p.j, foot = ZIP.FLOOR_Y + p.l * ZIP.LEVEL_H;
      const fx = ox - cx, fz = oz - cz, c = fx * fx + fz * fz - POST_R * POST_R;
      let t;
      if (c <= 0) t = 0;
      else {
        if (a < 1e-8) continue;
        const b = 2 * (fx * d.x + fz * d.z), disc = b * b - 4 * a * c; if (disc < 0) continue;
        const s = Math.sqrt(disc), t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a);
        if (t2 < 0) continue;
        const y1 = oy + d.y * t1, y2 = oy + d.y * t2, lo = foot, hi = foot + ZIP.POST_H + .15;
        if (t1 >= 0 && y1 >= lo && y1 <= hi) t = t1;
        else if ((y1 < lo && y2 >= lo) || (y1 > hi && y2 <= hi)) t = Math.max(0, d.y > 0 ? (lo - oy) / d.y : (hi - oy) / d.y);
        else continue;
      }
      if (c <= 0 && (oy < foot - .2 || oy > foot + ZIP.POST_H + 1)) continue;
      if (t < best) { best = t; aimPost = p; aimPostDist = t; }
    }
    return aimPost;
  }
  // Walk-surface cast for placing: the deck plane and every upper floor level below the eye; nearest
  // supported surface wins. With none in reach, the deck plane hit (on water) shows the red ghost.
  function pickPlace(aim) {
    place = null;
    const d = aim?.dir, cam = ctx.camera?.position; if (!d || !cam || d.y > -1e-4) return null;
    const oy = cam.y - yOff(); let fallback = null;
    let fi = 0, fj = 0, ft = 0;
    for (let l = 0; l <= ZIP.MAX_L; l++) {
      const h = ZIP.FLOOR_Y + l * ZIP.LEVEL_H; if (oy <= h) break;
      const t = (h - oy) / d.y; if (t > ZIP.PLACE_REACH) continue;
      const i = Math.round((cam.x + d.x * t) / 2), j = Math.round((cam.z + d.z * t) / 2);
      if (supported(ctx.world, i, j, l)) { if (!place || t < place.t) { placeTgt.i = i; placeTgt.j = j; placeTgt.l = l; placeTgt.t = t; place = placeTgt; } }
      else if (l === 0) { fallback = true; fi = i; fj = j; ft = t; }
    }
    if (!place && fallback) { placeTgt.i = fi; placeTgt.j = fj; placeTgt.l = 0; placeTgt.t = ft; place = placeTgt; }
    if (place) place.why = canPost(state, ctx.world, place.i, place.j, place.l);
    return place;
  }

  // A post you can grab: has a line, its top within REACH horizontally and 2.6 m vertically of the eye.
  function nearPost() {
    const ph = ctx.physics; if (!ph) return null;
    const ey = ph.y - yOff(); let best = null, bd = ZIP.REACH;
    for (const p of state.posts) {
      if (!linesOf(state, p.id)) continue;
      const t = topOf(p, tA), h = Math.hypot(t.x - ph.x, t.z - ph.z);
      if (h <= bd && Math.abs(t.y - ey) <= 2.6) { bd = h; best = p; }
    }
    return best;
  }

  // ---------- riding (local) ----------
  function lineEnds(r) {
    const A = postById(state, r.a), B = postById(state, r.b);
    if (!A || !B || !hasLine(state, r.a, r.b)) return false;
    topOf(A, tA); topOf(B, tB); return true;
  }
  function startRide(post, force = false) {
    const ph = ctx.physics; if (!ph) return false;
    if (!force) {
      if (ctx.uiOpen?.()) return false;
      if (ctx.steering?.()) { ctx.notice?.('Let go of the sail first'); return true; }
      if (ph.swimming || !ph.grounded) { ctx.notice?.('Stand by the post to grab the line'); return true; }
      if (peek?.('sleep')?.in?.[myRole()]) return true;
    }
    const mine = state.lines.filter(l => l[0] === post.id || l[1] === post.id); if (!mine.length) return false;
    const f = ctx.aim?.()?.dir; let pick = mine[0], bestDot = -Infinity;
    if (f && mine.length > 1) for (const l of mine) {
      const o = postById(state, l[0] === post.id ? l[1] : l[0]); if (!o) continue;
      const dx = o.i - post.i, dz = o.j - post.j, n = Math.hypot(dx, dz) || 1, dot = (dx * f.x + dz * f.z) / n;
      if (dot > bestDot) { bestDot = dot; pick = l; }
    }
    const r = { a: pick[0], b: pick[1], t: 0, dir: 1, lastT: -1, stall: 0 };
    if (!lineEnds(r)) return false;
    const len = Math.max(1, Math.hypot(tB.x - tA.x, tB.y - tA.y, tB.z - tA.z)), s0 = Math.min(.45, ZIP.START_S / len);
    if (post.id === pick[0]) { r.t = s0; r.dir = 1; } else { r.t = 1 - s0; r.dir = -1; }
    r.jumpWas = !!ph._prevJump; ride = r; pending = null;
    ctx.play?.('reel', .3);
    return true;
  }
  function drop(ph, vy) {
    ride = null;
    if (!ph) return;
    ph.vy = vy; ph.vx = 0; ph.vz = 0; ph.grounded = false; ph._jumpBuffer = 0;
  }
  function pin(ph) {
    riderPose(ctx.world?.pieces, tA, tB, ride.t, ride.dir, rp); // eye beside and below the rope, feet above the floor
    ph.x = rp.x; ph.z = rp.z; ph.y = yOff() + rp.y;
    ph.vx = 0; ph.vz = 0; ph.vy = -.01; ph.grounded = false; ph.swimming = false;
  }
  function afterMove(ph, dt) {
    if (!ride || !ph) return;
    if (!lineEnds(ride) || !ctx.running || ctx.uiOpen?.() || ctx.steering?.() || peek?.('sleep')?.in?.[myRole()]) { drop(ph, 0); return; }
    // Space: let go (gravity + floor snap land us). The jump buffer alone is not enough: at low fps the
    // frame's substeps use it up before this hook runs, so also watch the jump key's rising edge.
    const jumpNow = !!ph._prevJump, jumpEdge = jumpNow && !ride.jumpWas; ride.jumpWas = jumpNow;
    if (jumpEdge || ph._jumpBuffer > 0 || ph.vy > 0) { drop(ph, 2); return; }
    const r = hold ? '' : rideStep(ride, tA, tB, Number.isFinite(dt) ? Math.max(0, Math.min(dt, .1)) : 0);
    if (r === 'bad' || !Number.isFinite(ride.t)) { drop(ph, 0); return; }
    if (!hold) {
      if (ride.t === ride.lastT) { ride.stall += dt || 0; if (ride.stall > .5) { drop(ph, 0); return; } } else ride.stall = 0;
      ride.lastT = ride.t;
    }
    if (r === 'end') {
      const end = postById(state, ride.dir > 0 ? ride.b : ride.a);
      landSpot(ctx.world, end, (tB.x - tA.x) * ride.dir, (tB.z - tA.z) * ride.dir, land, state);
      ph.x = land.x; ph.z = land.z; ph.y = yOff() + land.footY + ZIP.EYE + .02;
      ph.vx = 0; ph.vz = 0; ph.vy = 0; ph.grounded = false; ph._jumpBuffer = 0;
      ride = null; ctx.play?.('reel', .2);
      return;
    }
    pin(ph);
  }

  // ---------- per frame ----------
  function update() {
    const w = ctx.world; if (!w) return;
    if (!isGuest() && (w.pieces !== seenPieces || w.tiles !== seenTiles || (Array.isArray(w.tiles) && w.tiles.length !== seenTilesN))) doPrune();
    if (!ensureScene()) return;
    if (dirty || builtRev !== state.rev) rebuild();
    const raft = ctx.raft; if (raft) { group.position.copy(raft.position); group.quaternion.copy(raft.quaternion); }
    const held = ctx.running && !ctx.uiOpen?.() ? heldKind() : null;
    if (held !== lastHeld) { if (pending) pending = null; lastHeld = held; }
    if (pending && (performance.now() > pending.until || !postById(state, pending.id))) pending = null;
    const aim = ctx.aim?.() ?? null;
    pickPost(held === 'rope' || held === 'zippost' ? aim : null);
    if (held === 'zippost' && !aimPost && !ride) pickPlace(aim); else place = null;
    if (place) {
      ghost.visible = true; kit.setGhost(ghost, !place.why);
      ghost.position.set(2 * place.i, ZIP.FLOOR_Y + place.l * ZIP.LEVEL_H, 2 * place.j);
    } else ghost.visible = false;
    if (pending && aim?.dir && ctx.camera) {
      const P = postById(state, pending.id), cam = ctx.camera.position, d = aim.dir, len = aimPost ? aimPostDist : 3.5, a = previewLine.geometry.attributes.position;
      topOf(P, tA);
      a.setXYZ(0, tA.x, tA.y, tA.z); a.setXYZ(1, cam.x + d.x * len, cam.y - yOff() + d.y * len, cam.z + d.z * len); a.needsUpdate = true;
      previewLine.visible = true;
    } else previewLine.visible = false;
  }

  function interact() {
    if (ride) return true; // E does nothing on the line (Space lets go)
    const held = heldKind();
    if (held === 'rope') {
      const p = aimPost; if (!p) return false;
      if (!pending || pending.id === p.id || !postById(state, pending.id)) {
        pending = { id: p.id, until: performance.now() + PENDING_S * 1000 };
        ctx.notice?.('Now press E on another post');
        return true;
      }
      const a = pending.id; pending = null;
      if (hasLine(state, a, p.id)) { send({ kind: 'zipline.unlink', a, b: p.id }); return true; }
      const why = canLink(state, ctx.world?.pieces, a, p.id);
      if (why) { ctx.notice?.(ZIP_TEXT[why] ?? ''); return true; }
      send({ kind: 'zipline.link', a, b: p.id });
      return true;
    }
    const p = nearPost(); if (!p) return false;
    return startRide(p);
  }

  function prompt() {
    if (ride) return '<kbd>Space</kbd>Let go';
    const held = heldKind();
    if (held === 'rope' && aimPost) {
      if (!pending) return '<kbd>E</kbd>Tie rope here';
      if (pending.id === aimPost.id) return null; // a prompt without <kbd> turns into a feed notice; the E notice already said it
      return hasLine(state, pending.id, aimPost.id) ? '<kbd>E</kbd>Untie line' : '<kbd>E</kbd>Link to this post';
    }
    if (held === 'zippost') {
      if (aimPost) return '<kbd>Right click</kbd>Pick up post';
      if (place) return place.why ? null : '<kbd>Click</kbd>Place post'; // red ghost; the reason comes as a notice on click
      return null;
    }
    if (held !== 'rope' && nearPost()) return '<kbd>E</kbd>Ride the zipline';
    return null;
  }

  // Host reach check: the actor must stand near what they place, tie, untie or pick up (the guest pose lags,
  // so inReach adds slack). The first post of a new line may be far away; the second one was aimed at.
  function farFrom(a, actor) {
    const pose = actor === 'guest' ? ctx.other : ctx.physics;
    if (a.kind === 'zipline.post') return Number.isInteger(a.i) && Number.isInteger(a.j) && !inReach(pose, 2 * a.i, 2 * a.j, ZIP.PLACE_REACH) ? 'far' : '';
    const p = postById(state, a.kind === 'zipline.remove' ? a.id : a.b);
    return p && !inReach(pose, 2 * p.i, 2 * p.j, AIM_POST) ? 'far' : '';
  }
  // QA helpers on the host skip the reach check (the actions still go through the same rules).
  function hostDo(a) {
    if (isGuest()) return send(a);
    const r = applyZip(state, a, ctx.localBag?.(), ctx.world); if (r?.ok) dirty = true;
    if (r?.text) ctx.notice?.(r.text);
    return r;
  }

  return {
    name: 'zipline',
    serialize: () => state,
    load(d, from) {
      if (from === 'net') {
        const r = d && typeof d === 'object' && Number.isInteger(d.rev) ? d.rev : 0;
        if (r === netRev && d) return;
        state = cleanZip(d); netRev = r; dirty = true;
        if (ride && !lineEnds(ride)) drop(ctx.physics, 0);
        return;
      }
      const prevRev = state.rev;
      state = cleanZip(d); netRev = -1; dirty = true; pending = null;
      // Host: never reuse a rev a guest may already hold (it skips same-rev snapshots), e.g. loading an older save.
      if (!isGuest() && state.rev <= prevRev) { state.rev = prevRev; bumpZip(state); }
      if (ride) drop(ctx.physics, 0); // a whole new world (restore / save load)
      seenPieces = null; seenTiles = null; seenTilesN = -1;
      if (!isGuest()) doPrune();
    },
    action(a, actor, bag) {
      if (typeof a?.kind !== 'string' || !a.kind.startsWith('zipline.')) return false;
      const why = farFrom(a, actor);
      if (why) { ctx.emit({ kind: 'notice', text: ZIP_TEXT[why] }, actor); return true; }
      const r = applyZip(state, a, bag, ctx.world);
      if (!r) return true;
      if (r.ok) dirty = true;
      if (r.text) ctx.emit({ kind: 'notice', text: r.text }, actor);
      return true;
    },
    update, afterMove, interact, prompt,
    use(aim, kind) {
      if (kind !== 'zippost') return false;
      if (ride) return true;
      const p = place ?? pickPlace(aim);
      if (!p) { ctx.notice?.('Point at the deck or a floor'); return true; }
      if (p.why) { ctx.notice?.(ZIP_TEXT[p.why] ?? ''); return true; }
      send({ kind: 'zipline.post', i: p.i, j: p.j, l: p.l });
      return true;
    },
    alt(aim, kind) {
      if (kind !== 'zippost' || !aimPost) return false;
      send({ kind: 'zipline.remove', id: aimPost.id });
      return true;
    },
    dispose() {
      ride = null; clearMeshes();
      if (group?.parent) group.parent.remove(group);
      previewLine?.geometry.dispose(); kit?.dispose(); group = null; kit = null;
    },
    debug: {
      state: () => JSON.parse(JSON.stringify(state)),
      get ride() { return ride ? { ...ride } : null; },
      get aimPost() { return aimPost ? { ...aimPost } : null; },
      get target() { return place ? { ...place } : null; },
      get pending() { return pending ? { ...pending } : null; },
      place: (i, j, l = 0) => hostDo({ kind: 'zipline.post', i, j, l }),
      link: (a, b) => hostDo({ kind: 'zipline.link', a, b }),
      remove: id => hostDo({ kind: 'zipline.remove', id }),
      grab(id) { const p = postById(state, id); return p ? startRide(p, true) : false; },
      seek(t) { if (ride && Number.isFinite(t)) { ride.t = Math.max(0, Math.min(1, t)); ride.lastT = -1; } return ride ? ride.t : null; },
      hold(v = true) { hold = !!v; return hold; },
      ropeAt(idx, t) {
        const l = state.lines[idx]; if (!l) return null;
        const A = postById(state, l[0]), B = postById(state, l[1]);
        const p = ropePoint(topOf(A, {}), topOf(B, {}), t, {}); return { x: p.x, y: p.y + yOff(), z: p.z, local: p.y };
      },
      demo() { // QA: a deck strip, an upper floor on pillars at cells (4..5, 0), posts at deck (0,0) and floor (4,0,1), linked
        if (isGuest() || !ctx.building) return null;
        const w = ctx.world, have = new Set(w.tiles.map(t => t[0] + ',' + t[1]));
        for (let i = -1; i <= 6; i++) for (let j = -1; j <= 1; j++) if (!have.has(i + ',' + j)) w.tiles.push([i, j]);
        w.tiles = w.tiles.slice();
        const pieces = (w.pieces || []).filter(p => !(p.l >= 1 && p.i >= 3));
        for (let i = 4; i <= 6; i++) for (let j = 0; j <= 1; j++) pieces.push({ t: 'pillar', i, j, l: 0, r: 0 });
        pieces.push({ t: 'floor', i: 4, j: 0, l: 1, r: 0 }, { t: 'floor', i: 5, j: 0, l: 1, r: 0 });
        w.pieces = pieces; ctx.building.sync(w); ctx.rebuildRaft?.();
        const b = ctx.localBag(); b.add('zippost', 3); b.add('rope', 3);
        const n = state.posts.length;
        hostDo({ kind: 'zipline.post', i: 0, j: 0, l: 0 }); hostDo({ kind: 'zipline.post', i: 4, j: 0, l: 1 });
        const ids = state.posts.slice(n).map(p => p.id); if (ids.length === 2) hostDo({ kind: 'zipline.link', a: ids[0], b: ids[1] });
        return { ids, state: JSON.parse(JSON.stringify(state)) };
      },
      standAt(x, y, z) { const p = ctx.physics; if (!p) return false; p.x = x; p.y = yOff() + y; p.z = z; p.vx = p.vy = p.vz = 0; p.grounded = false; return true; },
      grant(n = 2) { if (isGuest()) return false; const b = ctx.localBag(); b.add('zippost', n); b.add('rope', 2); return true; },
    },
  };
}
