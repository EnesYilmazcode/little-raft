// Sky Kite content module (docs/specs/kite.md). Slice: world.ext.kite = {v:1, rev, fly:{h,g}, tied:[{k,p,L,s}]}.
// Hold a kite on deck: click to launch, look to steer, right click for line length, click to tug, E to tie it
// to a railing or pillar so it keeps flying on its own. Host-authoritative; cosy, nothing can fail.
import { LINES, MAX_TIED, TUG, PULL_T, PULL_MPS, SPOT_S, TIE_TYPES, KINDS, windOf, kitePose, easeInputs, steerFromYaw,
  anchorOf, pieceKey, cleanKite, spotDue, pickDebris, linePoints, tailPoints, qSteer, angDiff } from './kite-core.js?build=v3-survival-ae77fa84ac2b';
import { createKiteKit, TAIL_Y } from './kite-model.js?build=v3-survival-ae77fa84ac2b';

const REACH = 4, SEND_MS = 250, SPOT_SEED = 7.31, WATER_Y = 0;
const NAMES = { railing: 'railing', pillar: 'pillar', gate: 'gate', halfwall: 'half wall' };

export function createKite(ctx) {
  const T = ctx.T;
  let ext = cleanKite(undefined), netRev = -1;
  let st = null;                 // my hand kite: eased inputs, or null when stowed
  const remote = { on: false, p: 0, L: 6, Lt: 16, steer: 0, steerT: 0, dSteer: 0, launch: 0, tug: 0, landing: 0 };
  let dn = null, windOverride = null, kit = null, sendClock = 0, sentL = 0, sentS = 0, sailHidden = null;
  let spotClock = 0, spotN = 0, pull = null, seenPieces = null, prunedFor = null, flyClock = 0;
  const pieceMap = new Map();
  const slots = [];              // pooled meshes: 0 = mine, 1 = partner, 2.. = tied
  const W = { az: 0, s: 0.5 }, Wt = { az: 0, s: 0.5 }, pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, e: 0, dSteer: 0 };
  const last = { x: 0, y: 0, z: 0, e: 0, ok: false };
  const A = { x: 0, y: 0, z: 0 }, K = { x: 0, y: 0, z: 0 }, B = { x: 0, y: 0, z: 0 };
  const v = T ? new T.Vector3() : null, bottom = T ? new T.Vector3() : null;
  const tgt = { rec: null, key: '' }, TIED = { L: 16, steer: 0, dSteer: 0, tug: 0, launch: 1 };
  const host = () => ctx.role !== 'guest';
  const mySlot = () => (host() ? 'h' : 'g');
  const fail = (text, actor) => { ctx.emit({ kind: 'notice', text }, actor); return true; };
  const bump = () => { ext.rev = ext.rev >= 1e9 ? 1 : ext.rev + 1; };

  // ---------------------------------------------------------------- helpers
  const heldKind = () => { const b = ctx.localBag(); return b?.slots[b.selectedIndex]?.kind ?? null; };
  const kiteIndex = k => (typeof k === 'string' && k.startsWith('kite_') ? KINDS.indexOf(k) : -1);
  function weather() {
    if (!dn || dn.dead) { const m = ctx.content?.mods; dn = Array.isArray(m) ? m.find(x => x.name === 'daynight' && !x.dead) ?? null : null; }
    const w = dn?.wind; return Number.isFinite(w) ? w : 0.5;
  }
  let windInit = false;
  function wind(dt) { // eased: a sailing raft can outrun a light wind and flip the apparent wind; the kites swing round, never jump
    windOf(ctx.world?.sailing, weather(), Wt);
    if (windOverride !== null) Wt.s = windOverride;
    if (!windInit) { W.az = Wt.az; W.s = Wt.s; windInit = true; return W; }
    const k = 1 - Math.exp(-0.8 * dt);
    W.az = angDiff(0, W.az + angDiff(W.az, Wt.az) * k); W.s += (Wt.s - W.s) * k;
    return W;
  }
  function pieces() {
    const list = ctx.world?.pieces;
    if (list !== seenPieces) {
      seenPieces = list; pieceMap.clear();
      if (Array.isArray(list)) for (let i = 0; i < list.length; i++) { const p = list[i]; if (p && TIE_TYPES[p.t] === 1) pieceMap.set(pieceKey(p), p); }
      return true;
    }
    return false;
  }
  const tiedAt = k => { for (let i = 0; i < ext.tied.length; i++) if (ext.tied[i].k === k) return i; return -1; };

  function findTarget(aim) {
    if (!aim?.dir || !ctx.camera) return null;
    const b = ctx.building; if (!b?.grid || typeof b.grid.pick !== 'function') return null;
    const c = ctx.camera.position, d = aim.dir;
    const rec = b.grid.pick(c.x, c.y, c.z, d.x, d.y, d.z, ctx.deckY(), REACH);
    if (!rec || TIE_TYPES[rec.t] !== 1 || rec.t === 'gate') return null; // E on a gate opens it (building.interact runs first)
    tgt.rec = rec; tgt.key = pieceKey(rec); return tgt;
  }

  function slot(i, p) {
    if (!kit) kit = createKiteKit(T);
    let s = slots[i];
    if (!s) {
      s = slots[i] = kit.make(p);
      ctx.scene.add(s.kite); ctx.scene.add(s.line); ctx.scene.add(s.tail);
    }
    kit.setPattern(s, p);
    return s;
  }
  function hideFrom(i) { for (let n = i; n < slots.length; n++) { const s = slots[n]; if (s) s.kite.visible = s.line.visible = s.tail.visible = false; } }
  // Pose + string + tail into pooled slot i. A = anchor, inputs from `inp` ({L, steer, dSteer, tug, launch}).
  function draw(i, p, inp, phase) {
    pose.dSteer = inp.dSteer || 0;
    kitePose(A.x, A.y, A.z, W, inp.L, inp.steer, inp.tug, inp.launch, ctx.elapsed, phase, WATER_Y, pose);
    const s = slot(i, p);
    s.kite.visible = s.line.visible = s.tail.visible = true;
    s.kite.position.set(pose.x, pose.y, pose.z);
    s.kite.rotation.set(-pose.pitch, pose.yaw, pose.roll);
    K.x = pose.x; K.y = pose.y; K.z = pose.z;
    const la = s.line.geometry.attributes.position; linePoints(A, K, inp.L, W.s, la.array); la.needsUpdate = true;
    s.kite.updateMatrix(); bottom.set(0, TAIL_Y, 0).applyMatrix4(s.kite.matrix);
    B.x = bottom.x; B.y = bottom.y; B.z = bottom.z;
    const ta = s.tail.geometry.attributes.position; tailPoints(B, W, ctx.elapsed + phase, ta.array); ta.needsUpdate = true;
    return pose;
  }
  function setSail() { // the folded sail on the held spool hides while my kite is up
    const want = st ? KINDS[st.p] : null;
    if (sailHidden && sailHidden !== want) { const m = ctx.heldModel?.(sailHidden); if (m?.userData?.sail) m.userData.sail.visible = true; sailHidden = null; }
    if (want && sailHidden !== want) { const m = ctx.heldModel?.(want); if (m?.userData?.sail) { m.userData.sail.visible = false; sailHidden = want; } }
  }
  const startLanding = () => { if (st && !st.landing) { st.landing = 1; st.tug = 0; ctx.action({ kind: 'kite.land' }); } };
  function landNow() { if (!st) return; st = null; setSail(); }

  // ---------------------------------------------------------------- local input
  function launch(p, L = 16) {
    st = { p, Lt: L, L: 6, steer: 0, steerT: 0, dSteer: 0, launch: 0, tug: 0, landing: 0 };
    sentL = L; sentS = 0; sendClock = 0;
    ctx.play?.('throw', 0.5);
    ctx.action({ kind: 'kite.fly', p, L, s: 0 });
    setSail();
  }
  function tie(k) {
    if (!st) return false;
    ctx.action({ kind: 'kite.tie', k, p: st.p, L: st.Lt, s: qSteer(st.steer) });
    landNow(); // no reel animation: the kite stays up on the railing
    return true;
  }

  // ---------------------------------------------------------------- host rules
  function action(a, actor, bag) {
    const kind = a?.kind; if (typeof kind !== 'string' || !kind.startsWith('kite.')) return false;
    if (!host()) return true;
    const who = actor === 'host' ? 'h' : 'g';
    if (kind === 'kite.fly') {
      const p = a.p, s = a.s;
      if (!Number.isInteger(p) || p < 0 || p > 2 || !LINES.includes(a.L) || !Number.isFinite(s) || Math.abs(s) > 0.9) return true;
      if (!bag || bag.count(KINDS[p]) < 1) return true;
      ext.fly[who] = { p, L: a.L, s: qSteer(s) };
      return true;
    }
    if (kind === 'kite.land') { ext.fly[who] = null; return true; }
    if (kind === 'kite.tie') {
      const k = a.k, p = a.p; pieces();
      ext.fly[who] = null; // the actor already landed its hand kite locally
      if (typeof k !== 'string' || !pieceMap.has(k) || !Number.isInteger(p) || p < 0 || p > 2) return true;
      if (tiedAt(k) >= 0) return fail('That spot already has a kite', actor);
      if (ext.tied.length >= MAX_TIED) return fail('Six kites is plenty', actor);
      const L = LINES.includes(a.L) ? a.L : 16, s = Number.isFinite(a.s) && Math.abs(a.s) <= 0.9 ? qSteer(a.s) : 0;
      if (!bag || !bag.remove(KINDS[p], 1)) return fail('Hold the kite you want to tie', actor);
      ext.tied.push({ k, p, L, s }); bump();
      ctx.emit({ kind: 'notice', text: 'Kite tied off. It will fly on its own.' }, actor);
      return true;
    }
    if (kind === 'kite.untie') {
      const i = tiedAt(a.k); if (i < 0) return true;
      const e = ext.tied[i];
      if (!bag || bag.add(KINDS[e.p], 1) === 1) return fail('Bag full', actor);
      ext.tied.splice(i, 1); bump();
      ctx.emit({ kind: 'notice', text: 'Kite back in your bag' }, actor);
      return true;
    }
    return true;
  }
  function prune() {
    prunedFor = seenPieces;
    let n = 0;
    for (let i = ext.tied.length - 1; i >= 0; i--) {
      const e = ext.tied[i]; if (pieceMap.has(e.k)) continue;
      ext.tied.splice(i, 1); n++;
      try { if ((ctx.localBag()?.add(KINDS[e.p], 1) ?? 1) > 0 && ctx.other) ctx.actorBag?.('guest')?.add(KINDS[e.p], 1); } catch { /* the kite just vanishes */ }
    }
    if (n) bump();
  }
  function spotTick(dt) {
    let good = W.s > SPOT_S && ((st && !st.landing && st.Lt === 24) || ext.fly.g?.L === 24);
    if (!good && W.s > SPOT_S) for (let i = 0; i < ext.tied.length; i++) if (ext.tied[i].L === 24) { good = true; break; }
    if (good) spotClock += dt;
    const w = ctx.world, items = w?.items;
    if (!pull && spotClock >= spotDue(spotClock, spotN, SPOT_SEED)) {
      const held = ctx.heldTokens?.() ?? null;
      let it = pickDebris(items, held, 0, 0, null);
      if (it && !held) { // no held-token view: keep clear of both players instead
        const me = ctx.physics, o = ctx.other;
        if ((me && Math.hypot(it.x - me.x, it.z - me.z) < 10) || (o && Math.hypot(it.x - o.x, it.z - o.z) < 10)) it = null;
      }
      spotN++;
      if (it) {
        let r = 0; const tiles = w.tiles;
        if (Array.isArray(tiles)) for (let i = 0; i < tiles.length; i++) { const t = tiles[i]; r = Math.max(r, Math.abs(t[0]), Math.abs(t[1])); }
        const d = Math.hypot(it.x, it.z) || 1, R = r * 2 + 1 + 6;
        pull = { token: it.token, t: 0, x: it.x / d * R, z: it.z / d * R };
        ctx.emit({ kind: 'notice', text: 'Your kite spots driftwood off the bow!' }, 'all');
        spotClock = 0;
      }
    }
    if (!pull) return;
    pull.t += dt;
    let it = null;
    if (Array.isArray(items)) for (let i = 0; i < items.length; i++) if (items[i].token === pull.token) { it = items[i]; break; }
    const held = ctx.heldTokens?.();
    if (!it || pull.t > PULL_T || held?.has(pull.token)) { pull = null; return; }
    const dx = pull.x - it.x, dz = pull.z - it.z, d = Math.hypot(dx, dz);
    if (d <= 1) { pull = null; return; }
    const step = Math.min(d, PULL_MPS * dt);
    it.x += dx / d * step; it.z += dz / d * step;
  }

  // ---------------------------------------------------------------- per frame
  function update(dt) {
    if (!T || !ctx.scene) return;
    dt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    wind(dt);
    if (!unprovide) provide();
    pieces();
    // 1. my hand kite
    if (st) {
      const k = heldKind(), ph = ctx.physics;
      if (k !== KINDS[st.p] || ph?.swimming || ctx.content?.riding?.() || (ctx.localBag()?.count(KINDS[st.p]) ?? 0) < 1) startLanding();
      ctx.camera.updateMatrixWorld(); ctx.camera.localToWorld(v.set(0.36, -0.30, -0.72)); // this frame's camera, not last render's
      A.x = v.x; A.y = v.y; A.z = v.z;
      if (!st.landing && !ctx.uiOpen()) st.steerT = steerFromYaw(ctx.camera.rotation.y, W.az, st.steerT);
      if (easeInputs(st, dt)) { st = null; setSail(); ctx.action({ kind: 'kite.land' }); }
      else {
        draw(0, st.p, st, 0.4);
        last.x = pose.x; last.y = pose.y; last.z = pose.z; last.e = pose.e; last.ok = true;
        sendClock += dt * 1000;
        const s = qSteer(st.steer);
        if (!st.landing && sendClock >= SEND_MS && (st.Lt !== sentL || s !== sentS)) {
          sendClock = 0; sentL = st.Lt; sentS = s;
          ctx.action({ kind: 'kite.fly', p: st.p, L: st.Lt, s });
        }
        const mine = ext.fly[mySlot()];
        flyClock = !st.landing && (!mine || mine.p !== st.p || mine.L !== st.Lt) ? flyClock + dt : 0;
        if (flyClock > 2) { flyClock = 0; sendClock = 0; sentL = st.Lt; sentS = s; ctx.action({ kind: 'kite.fly', p: st.p, L: st.Lt, s }); }
      }
    }
    if (!st) { const s = slots[0]; if (s) s.kite.visible = s.line.visible = s.tail.visible = false; }
    setSail();
    // 2. partner's hand kite
    const f = ext.fly[host() ? 'g' : 'h'], o = ctx.other;
    if (o && Number.isFinite(o.x) && (f || (remote.on && remote.launch > 0))) {
      if (f) {
        if (!remote.on) { remote.on = true; remote.L = 6; remote.launch = 0; remote.steer = f.s; }
        remote.p = f.p; remote.Lt = f.L; remote.steerT = f.s; remote.landing = 0;
      } else remote.landing = 1;
      if (easeInputs(remote, dt)) remote.on = false;
      const yaw = Number.isFinite(o.yaw) ? o.yaw : 0, sy = Math.sin(yaw), cy = Math.cos(yaw);
      A.x = o.x + cy * 0.3 - sy * 0.35; A.y = (Number.isFinite(o.y) ? o.y : ctx.deckY() + 1.6) - 0.25; A.z = o.z - sy * 0.3 - cy * 0.35;
      draw(1, remote.p, remote, 2.1);
    } else {
      remote.on = false;
      const s = slots[1]; if (s) s.kite.visible = s.line.visible = s.tail.visible = false;
    }
    // 3. tied kites
    const deck = ctx.deckY(); let n = 2;
    for (let i = 0; i < ext.tied.length; i++) {
      const e = ext.tied[i], rec = pieceMap.get(e.k); if (!rec) continue;
      const a = anchorOf(rec, deck); if (!a) continue;
      A.x = a.x; A.y = a.y; A.z = a.z;
      TIED.L = e.L; TIED.steer = e.s;
      draw(n++, e.p, TIED, i * 1.7);
    }
    hideFrom(n);
    // 4. host housekeeping and the small reward
    if (host()) {
      if (!o && ext.fly.g) ext.fly.g = null;
      if (seenPieces && seenPieces !== prunedFor) prune();
      spotTick(dt);
    }
  }

  // ---------------------------------------------------------------- prompts
  let unprovide = null;
  function rows(aim) {
    const k = heldKind(), p = kiteIndex(k), t = findTarget(aim), tied = t ? tiedAt(t.key) >= 0 : false;
    if (tied) return [{ key: 'E', label: 'Untie kite' }];
    if (p < 0 && !st) return null;
    if (!st) return [{ key: 'LMB', label: 'Launch kite' }];
    const r = [{ key: 'LMB', label: 'Tug · RMB Line ' + st.Lt + ' m' }];
    if (t) r.push({ key: 'E', label: 'Tie to ' + (NAMES[t.rec.t] ?? 'railing') });
    return r;
  }
  function provide() {
    const P = globalThis.raftPrompts; if (unprovide || typeof P?.provide !== 'function') return;
    unprovide = P.provide({ id: 'kite', priority: 1, prompt: pc => {
      if (!ctx.running || ctx.uiOpen()) return null;
      const s = pc?.state; // yield to the built-in pickup / waiting prompts
      if (s?.pickup || (s?.role === 'guest' && !s.networkReady)) return null;
      return rows(ctx.aim?.() ?? null);
    } });
  }

  // ---------------------------------------------------------------- module
  const mod = {
    name: 'kite',
    pulling: () => (pull ? pull.token : null), // [dolphin] the debris token being kited in (the dolphin leaves it alone)
    serialize: () => ext,
    load(d, from) {
      if (from === 'net') {
        const r = d && typeof d === 'object' && Number.isInteger(d.rev) ? d.rev : 0;
        if (r === netRev) { const c = cleanKite({ fly: d?.fly }, 'net'); ext.fly = c.fly; return; }
        ext = cleanKite(d, 'net'); netRev = r;
        return;
      }
      ext = cleanKite(d); netRev = -1; seenPieces = null; prunedFor = null; pull = null; flyClock = 0;
    },
    update,
    action,
    use(aim, kind) {
      const p = kiteIndex(kind); if (p < 0) return false;
      if (st && !st.landing) { st.tug = TUG; ctx.play?.('reel', 0.4); return true; }
      const ph = ctx.physics;
      if (!ph?.grounded || ph.swimming) { ctx.notice('Stand on the deck to launch'); return true; }
      launch(p);
      return true;
    },
    alt(aim, kind) {
      if (kiteIndex(kind) < 0 || !st || st.landing) return false;
      st.Lt = st.Lt === 8 ? 16 : st.Lt === 16 ? 24 : 8;
      sentL = st.Lt; sentS = qSteer(st.steer);
      ctx.action({ kind: 'kite.fly', p: st.p, L: st.Lt, s: sentS });
      ctx.notice('Kite line ' + st.Lt + ' m');
      return true;
    },
    interact(aim) {
      const t = findTarget(aim); if (!t) return false;
      if (tiedAt(t.key) >= 0) { ctx.action({ kind: 'kite.untie', k: t.key }); return true; }
      if (st && !st.landing) return tie(t.key);
      return false;
    },
    prompt(aim) {
      const r = rows(aim); if (!r) return null;
      return r.map(x => '<kbd>' + ctx.esc(x.key) + '</kbd> ' + ctx.esc(x.label)).join(' · ');
    },
    dispose() {
      try { unprovide?.(); } catch { /* ignore */ } unprovide = null;
      for (const s of slots) if (s) { ctx.scene?.remove(s.kite); ctx.scene?.remove(s.line); ctx.scene?.remove(s.tail); }
      if (kit) kit.dispose(slots.filter(Boolean));
      slots.length = 0; kit = null;
      if (sailHidden) { const m = ctx.heldModel?.(sailHidden); if (m?.userData?.sail) m.userData.sail.visible = true; sailHidden = null; }
    },
    debug: {
      fly(p = 0, L = 24, instant = false) {
        const kind = KINDS[p]; if (!kind || !LINES.includes(L)) return false;
        const b = ctx.localBag(); if (!b) return false;
        if (b.count(kind) < 1) { if (!host()) return false; b.add(kind, 1); }
        let i = b.slots.findIndex(s => s?.kind === kind);
        if (i >= 10) { b.move?.(i, b.selectedIndex); i = b.selectedIndex; }
        if (i >= 0 && b.selectedIndex !== i) { if (!host()) b.select(i); ctx.action({ kind: 'selectSlot', index: i }); }
        launch(p, L);
        if (instant) { st.L = L; st.launch = 1; }
        return true;
      },
      give(p = 0, actor) { // QA: put a kite in a bag (host: own, or actor 'guest') and select it locally
        const kind = KINDS[p]; if (!kind) return false;
        if (actor === 'guest') { const gb = host() ? ctx.actorBag?.('guest') : null; if (!gb) return false; if (gb.count(kind) < 1) gb.add(kind, 1); return true; }
        const b = ctx.localBag(); if (!b) return false;
        if (b.count(kind) < 1) { if (!host()) return false; b.add(kind, 1); }
        const i = b.slots.findIndex(s => s?.kind === kind);
        if (i >= 0 && i < 10) { if (!host()) b.select(i); ctx.action({ kind: 'selectSlot', index: i }); }
        return i;
      },
      land() { startLanding(); return !!st; },
      tie(key) {
        pieces();
        let k = key;
        if (!k) for (const [kk, rec] of pieceMap) if ((rec.t === 'railing' || rec.t === 'pillar') && tiedAt(kk) < 0) { k = kk; break; }
        if (!k) return null;
        if (!st) { const b = ctx.localBag(); const p = KINDS.findIndex(x => (b?.count(x) ?? 0) > 0); if (p < 0) return null; st = { p, Lt: 24, L: 24, steer: 0, steerT: 0, dSteer: 0, launch: 1, tug: 0, landing: 0 }; }
        tie(k); return k;
      },
      untie(k) { ctx.action({ kind: 'kite.untie', k }); return true; },
      setWind(s) { windOverride = Number.isFinite(s) ? Math.max(0.3, Math.min(1.25, s)) : null; return windOverride; },
      forceSpot() { spotClock = spotDue(0, spotN, SPOT_SEED); return spotClock; },
      state: () => ({ fly: { h: ext.fly.h && { ...ext.fly.h }, g: ext.fly.g && { ...ext.fly.g } }, tied: ext.tied.map(e => ({ ...e })), rev: ext.rev,
        st: st ? { L: st.L, Lt: st.Lt, steer: st.steer, steerT: st.steerT, launch: st.launch, tug: st.tug, landing: st.landing } : null, spotClock, pull: pull && { ...pull }, wind: { ...W } }),
      pose: () => (last.ok ? { ...last } : null),
      poses: () => slots.map((s, i) => (s?.kite.visible ? { i, x: s.kite.position.x, y: s.kite.position.y, z: s.kite.position.z } : null)).filter(Boolean),
      skip(sec = 3) { if (st) for (let i = 0; i < sec * 20; i++) easeInputs(st, 0.05); return !!st; },
    },
  };
  return mod;
}
