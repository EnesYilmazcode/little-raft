// Sailing lane, THREE side: drives world.sailing each frame, moves scenery relative to the raft, animates sails,
// owns the anchor fixture, points each sail's own pennant downwind, and handles aiming (E toggles sail/anchor, hold R steers the sail).
// See docs/cloud/sailing-spec.md. The raft never moves in x/z: the world drifts past it instead.
import { SAIL, cleanSailing, defaultSailing, stepSailing, sailTarget, applySailAction, wrapAxis, placeUpstream, driftedOut, windVector } from './sailing-core.js';
import { createSailingUI } from './sailing-ui.js';

const WRAP = SAIL.ISLAND_WRAP > 0 ? SAIL.ISLAND_WRAP : 150, LEASH = 10, STEER_RATE = 1.6, REACH = 3.2, MAST_H = 3.6, MAST_R = .25, ANCHOR_R = .35, DECK_Y = .22;
const CLOTH_R = 1.2, CLOTH_Y0 = 1, CLOTH_Y1 = 3.4; // raised cloth hit volume around the mast axis (cheap approximation)
const FURL = .04, FURL_Z = .3, ROLL_AT = .3, ROLL_R = .07, BASE_FLOW_Z = .22, ITEM_MARGIN = 26, ROPE_DOWN = 3.4, ROPE_UP = .07, GROUND_CLEAR = 2.5, OP_GAP = 250, SNAP2 = 36;
const CLOTH_NAMES = new Set(['sailCloth', 'sailSeams', 'sailPatch', 'sailStitches']);
const LIMITED_OPS = new Set(['toggle', 'raise', 'lower', 'anchor', 'unanchor', 'toggleAnchor']);
const P_STEER = 'Steering the sail — look where to go', P_RAISE = '<kbd>E</kbd>Raise sail · hold <kbd>R</kbd> to steer',
  P_LOWER = '<kbd>E</kbd>Lower sail · hold <kbd>R</kbd> to steer', P_DROP = '<kbd>E</kbd>Drop anchor', P_WEIGH = '<kbd>E</kbd>Raise anchor';
const HW = SAIL.WATER_WRAP / 2, HG = SAIL.GROUND_WRAP / 2;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function createSailing(T, ctx) {
  const { scene, raft, ocean, camera } = ctx;
  const abort = new AbortController();
  const ui = createSailingUI({ signal: abort.signal });
  const out = { dwx: 0, dwz: 0, dgx: 0, dgz: 0 };
  const flow = { x: 0, z: 0 }, info = { running: false, yaw: 0, windDir: 0, windStr: 0, heading: 0, raised: false, anchored: false, nSails: 0, speed: 0, travelDir: 0 };
  const stepOpts = { nSails: 0, host: true, rng: Math.random, blockers: [] };
  const localAct = { kind: 'sail', op: 'heading', heading: 0 };
  const drifters = [], sails = [], rolls = [];
  const vA = new T.Vector3(), vO = new T.Vector3(), vD = new T.Vector3(), ndc = new T.Vector2(), caster = new T.Raycaster();
  const disp = { wx: 0, wz: 0, gx: 0, gz: 0 }; // displayed offsets (guest: smoothed toward the host's state)
  const centre = { x: 0, z: 0 }, flowDir = { x: 0, z: 1 }; // raft bbox centre (world units); latched flow direction
  const lastOp = new Map();
  let state = defaultSailing(), speed = 0, travelDir = 0, nSails = 0, raftR = 3.5, halfDiag = 3, dispOk = false;
  let steering = false, grabYaw = 0, grabHeading = 0, steerHeading = 0, predicted = 0, predictUntil = 0, sentHeading = NaN, sendClock = 0, clock = 0;
  let aimKind = 0, aimIndex = -1, lastPrompt = undefined, anchorShown = 0, disposed = false;
  const anchorPos = { x: 0, z: 0, ok: false };

  // ---------- shared geometry / materials (created once) ----------
  const M = {
    wood: new T.MeshStandardMaterial({ color: '#906f48', roughness: .9 }),
    woodLight: new T.MeshStandardMaterial({ color: '#b4824b', roughness: .9 }),
    rope: new T.MeshStandardMaterial({ color: '#b99a62', roughness: 1 }),
    iron: new T.MeshStandardMaterial({ color: '#5e5a52', roughness: .6, metalness: .3 }),
    canvas: new T.MeshStandardMaterial({ color: '#e6dcc1', roughness: .95 }),
    tie: new T.MeshStandardMaterial({ color: '#87683f', roughness: 1 }),
  };
  const ropeGeo = new T.CylinderGeometry(.022, .022, 1, 6); ropeGeo.translate(0, -.5, 0);
  const rollGeo = new T.CylinderGeometry(ROLL_R, ROLL_R, 1, 10); rollGeo.rotateZ(Math.PI / 2); // unit length along x, scaled per sail
  const G = {
    post: new T.CylinderGeometry(.065, .08, 1, 8), drum: new T.CylinderGeometry(.075, .075, .34, 10),
    coil: new T.CylinderGeometry(.08, .08, .24, 10), crank: new T.BoxGeometry(.03, .18, .03), arm: new T.BoxGeometry(.06, .06, .6),
    anchor: anchorGeometry(T), rope: ropeGeo, roll: rollGeo, tie: new T.TorusGeometry(ROLL_R + .004, .009, 5, 12).rotateY(Math.PI / 2),
  };
  const freeze = o => { o.updateMatrix(); o.matrixAutoUpdate = false; }; // local transform never changes again
  const mesh = (geo, mat, x, y, z, parent, shadow = true) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; parent.add(m); return m; };

  const fixture = new T.Group(); fixture.name = 'sailingFixture'; scene.add(fixture);
  const anchorRoot = new T.Group(); fixture.add(anchorRoot);
  const post = mesh(G.post, M.wood, 0, .5, 0, anchorRoot);
  const drum = mesh(G.drum, M.woodLight, 0, .9, 0, anchorRoot); drum.rotation.z = Math.PI / 2;
  const coil = mesh(G.coil, M.rope, 0, .9, 0, anchorRoot); coil.rotation.z = Math.PI / 2;
  const crank = mesh(G.crank, M.wood, .2, .84, 0, anchorRoot, false);
  const arm = mesh(G.arm, M.wood, 0, .97, .3, anchorRoot);
  const anchorRope = mesh(G.rope, M.rope, 0, .95, .57, anchorRoot, false);
  const hook = new T.Group(); anchorRoot.add(hook);
  const anchorMesh = mesh(G.anchor, M.iron, 0, 0, 0, hook, false);
  hook.position.set(0, .95 - ROPE_UP, .57);
  for (const m of [post, drum, crank, arm, anchorMesh]) freeze(m); // rigid parts; coil, rope and hook animate (animateAnchor)

  // Furled-canvas roll (pooled, one per sail): a cream cylinder with two ties, re-parented onto each sail group.
  function roll(i) {
    while (rolls.length <= i) {
      const r = new T.Mesh(G.roll, M.canvas); r.castShadow = true; r.visible = false;
      for (const x of [-.32, .32]) { const t = new T.Mesh(G.tie, M.tie); t.position.x = x; freeze(t); r.add(t); }
      rolls.push(r);
    }
    return rolls[i];
  }

  // ---------- state ----------
  function ensureState() {
    const w = ctx.getWorld();
    if (!w) return state;
    const s = w.sailing;
    if (!s || typeof s !== 'object' || s.v !== 1 || !Number.isFinite(s.gx) || !Number.isFinite(s.wx) || !Number.isFinite(s.heading)) w.sailing = cleanSailing(s);
    return (state = w.sailing);
  }
  function countSails() {
    const d = ctx.getWorld()?.decor; let n = 0;
    if (Array.isArray(d)) for (let i = 0; i < d.length; i++) if (d[i]?.type === 'sail') n++;
    return n;
  }

  // ---------- scenery ----------
  function addDrifter(obj, radius = 0) {
    if (!obj?.position) return obj;
    // base = seabed-absolute position (identical for all peers), displayed at wrap(b - g)
    const d = { obj, bx: obj.position.x, bz: obj.position.z, r: radius > 0 ? radius : 0, b: null };
    if (d.r) { d.b = { x: obj.position.x, z: obj.position.z, r: d.r + GROUND_CLEAR + raftR }; stepOpts.blockers.push(d.b); }
    drifters.push(d); return obj;
  }
  function moveDrifters() {
    for (let i = 0; i < drifters.length; i++) {
      const d = drifters[i], p = d.obj.position;
      p.x = wrapAxis(d.bx - disp.gx, WRAP); p.z = wrapAxis(d.bz - disp.gz, WRAP);
      if (d.b) { d.b.x = p.x; d.b.z = p.z; }
    }
  }

  // ---------- raft rebuild: find sail groups, place anchor ----------
  function onRaftBuilt() {
    restoreSails(); sails.length = 0;
    const w = ctx.getWorld(), decor = Array.isArray(w?.decor) ? w.decor : [], tiles = Array.isArray(w?.tiles) ? w.tiles : [];
    nSails = countSails();
    // Raft footprint: radius about the origin (grounding) and bbox centre / half diagonal (item range).
    let r2 = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const t of tiles) {
      if (!Array.isArray(t) || !Number.isFinite(t[0]) || !Number.isFinite(t[1])) continue;
      r2 = Math.max(r2, 4 * (t[0] * t[0] + t[1] * t[1]));
      x0 = Math.min(x0, t[0]); x1 = Math.max(x1, t[0]); z0 = Math.min(z0, t[1]); z1 = Math.max(z1, t[1]);
    }
    raftR = Math.sqrt(r2) + 1.42;
    if (x0 <= x1) { centre.x = x0 + x1; centre.z = z0 + z1; halfDiag = Math.hypot(x1 - x0 + 1, z1 - z0 + 1); }
    else { centre.x = centre.z = 0; halfDiag = 1.42; }
    for (const d of drifters) if (d.b) d.b.r = d.r + GROUND_CLEAR + raftR;
    for (const c of raft.children) {
      const ct = c.userData?.craftType;
      if (ct !== undefined && ct !== 'sail') continue;
      if (!decor.some(d => d?.type === 'sail' && d.x === Math.round(c.position.x / 2) && d.z === Math.round(c.position.z / 2))) continue;
      const cloth = []; let main = null, flag = null;
      for (const m of c.children) {
        if (!m.isMesh) continue;
        if (ct === 'sail') {
          if (CLOTH_NAMES.has(m.name)) { cloth.push(m); if (m.name === 'sailCloth') main = m; }
          else if (m.name === 'pennant') flag = m;
        } else if (m.geometry?.type === 'PlaneGeometry') cloth.push(m);
      }
      main ??= cloth[0];
      if (!main) continue;
      main.geometry.computeBoundingBox?.(); const bb = main.geometry.boundingBox;
      if (!bb) continue;
      // Furl toward the cloth's top edge (the yard); billow about the cloth's own plane so its edges stay on yard/boom.
      // The model's pennant extends along its local +x from the mast axis (x = z = 0): +x sits a quarter turn
      // clockwise of +z, so 'downwind' in the group frame is windDir - heading - PI/2.
      const top = main.position.y + bb.max.y, zp = main.position.z + bb.min.z;
      const r = roll(sails.length); c.add(r);
      r.position.set((bb.min.x + bb.max.x) / 2 + main.position.x, top - ROLL_R * .8, zp + .01); r.scale.x = bb.max.x - bb.min.x; r.visible = false;
      sails.push({ group: c, cloth, py: cloth.map(m => m.position.y), pz: cloth.map(m => m.position.z), top, zp, roll: r,
        flag, flagRot: flag ? flag.rotation.y : 0, h: state.heading, s: state.raised ? 1 : FURL, bz: state.raised ? 1 : FURL_Z });
    }
    let best = null;
    for (const t of tiles) if (Array.isArray(t) && (!best || t[1] > best[1] || (t[1] === best[1] && t[0] < best[0]))) best = t;
    anchorPos.ok = !!best; anchorRoot.visible = !!best;
    if (best) { anchorPos.x = best[0] * 2 - .7; anchorPos.z = best[1] * 2 + .7; anchorRoot.position.set(anchorPos.x, .2, anchorPos.z); }
    if (!sails.length) steering = false;
  }
  function restoreSails() {
    for (const e of sails) {
      e.group.rotation.y = 0;
      for (let i = 0; i < e.cloth.length; i++) { const m = e.cloth[i]; m.scale.set(1, 1, 1); m.position.y = e.py[i]; m.position.z = e.pz[i]; }
      if (e.flag) e.flag.rotation.y = e.flagRot;
      e.roll.parent?.remove(e.roll); e.roll.visible = false;
    }
  }
  function animateSails(dt, elapsed) {
    const target = shownHeading(), raised = state.raised, k = Math.min(1, dt * 3), kf = Math.min(1, dt * 2.2);
    const push = raised ? state.windStr * Math.max(0, Math.cos(target - state.windDir)) : 0;
    for (let i = 0; i < sails.length; i++) {
      const e = sails[i];
      e.h += angDiff(target, e.h) * k; e.group.rotation.y = e.h;
      e.s += ((raised ? 1 : FURL) - e.s) * kf;
      e.bz += ((raised ? .9 + .25 * push + .03 * Math.sin(elapsed * 2.3 + i) * push : FURL_Z) - e.bz) * kf;
      for (let j = 0; j < e.cloth.length; j++) {
        const m = e.cloth[j];
        m.scale.y = e.s; m.position.y = e.top - e.s * (e.top - e.py[j]);
        m.scale.z = e.bz; m.position.z = e.zp - e.bz * (e.zp - e.pz[j]);
      }
      const rk = (ROLL_AT - e.s) / (ROLL_AT - FURL); // 0 at ROLL_AT, 1 when fully furled
      if (rk > 0) { const q = Math.min(1, rk) * .85 + .15; e.roll.scale.y = e.roll.scale.z = q; e.roll.visible = true; }
      else if (e.roll.visible) e.roll.visible = false;
      if (e.flag) {
        const amp = .08 + .3 * state.windStr * state.windStr;
        e.flag.rotation.y = e.flagRot + state.windDir - e.h - Math.PI / 2 + amp * Math.sin(elapsed * (5 + 4 * state.windStr) + i * 1.7);
      }
    }
  }
  function animateAnchor(dt) {
    anchorShown += ((state.anchored ? 1 : 0) - anchorShown) * Math.min(1, dt * 1.6);
    const len = ROPE_UP + (ROPE_DOWN - ROPE_UP) * anchorShown;
    anchorRope.scale.y = len; hook.position.y = .95 - len;
    coil.scale.x = coil.scale.z = 1.2 - .45 * anchorShown;
  }

  // ---------- aiming ----------
  function shownHeading() {
    return (ctx.getRole() === 'guest' && (steering || clock < predictUntil)) ? predicted : state.heading;
  }
  function aimRay() {
    if (typeof ctx.getAimNdc === 'function') {
      const n = ctx.getAimNdc();
      if (!n || !Number.isFinite(n.x) || !Number.isFinite(n.y)) return false;
      caster.setFromCamera(ndc.set(n.x, n.y), camera); vO.copy(caster.ray.origin); vD.copy(caster.ray.direction);
      return true;
    }
    camera.getWorldPosition(vO); camera.getWorldDirection(vD);
    return true;
  }
  function updateAim() {
    aimKind = 0; aimIndex = -1;
    if (!ctx.canInput() || !aimRay()) return;
    raft.updateWorldMatrix(true, false);
    let best = Infinity;
    const hh = vD.x * vD.x + vD.z * vD.z, raised = state.raised;
    for (let i = 0; i < sails.length; i++) {
      const g = sails[i].group.position; raft.localToWorld(vA.set(g.x, DECK_Y, g.z));
      // Closest approach of the ray to the (vertical) mast axis: mast cylinder, or the raised cloth around it.
      let t = hh > 1e-6 ? ((vA.x - vO.x) * vD.x + (vA.z - vO.z) * vD.z) / hh : 0;
      t = Math.min(REACH, Math.max(0, t));
      const y = vO.y + vD.y * t - vA.y, dx = vO.x + vD.x * t - vA.x, dz = vO.z + vD.z * t - vA.z, d2 = dx * dx + dz * dz;
      const hit = (y >= 0 && y <= MAST_H && d2 < MAST_R * MAST_R) || (raised && y >= CLOTH_Y0 && y <= CLOTH_Y1 && d2 < CLOTH_R * CLOTH_R);
      if (hit && t < best) { best = t; aimKind = 1; aimIndex = i; }
    }
    if (anchorPos.ok) {
      raft.localToWorld(vA.set(anchorPos.x, 1.15, anchorPos.z)); vA.sub(vO);
      const t = Math.min(REACH, Math.max(0, vA.dot(vD)));
      const dx = vD.x * t - vA.x, dy = vD.y * t - vA.y, dz = vD.z * t - vA.z;
      if (dx * dx + dy * dy + dz * dz < ANCHOR_R * ANCHOR_R && t < best) { aimKind = 2; aimIndex = -1; }
    }
  }
  function updatePrompt() {
    let p = null;
    if (ctx.isRunning() && ctx.canInput() && !ctx.isBusy?.()) { // busy: the player's own hook/rope is out
      if (steering) p = P_STEER;
      else if (aimKind === 1) p = state.raised ? P_LOWER : P_RAISE;
      else if (aimKind === 2) p = state.anchored ? P_WEIGH : P_DROP;
    }
    if (p !== lastPrompt) { lastPrompt = p; ui.setPrompt(p); }
  }
  function steer(dt) {
    if (!steering) return;
    if (!ctx.isRunning() || !sails.length) { release(); return; }
    const target = grabHeading + angDiff(ctx.getYaw(), grabYaw), d = angDiff(target, steerHeading), lim = STEER_RATE * dt;
    steerHeading += Math.max(-lim, Math.min(lim, d));
    const h = Math.atan2(Math.sin(steerHeading), Math.cos(steerHeading));
    if (ctx.getRole() !== 'guest') { localAct.heading = h; applySailAction(state, localAct); return; }
    predicted = h; predictUntil = clock + .8; sendClock -= dt;
    if (sendClock <= 0 && !(Math.abs(angDiff(h, sentHeading)) < Math.PI / 180)) sendHeading(h);
  }
  function sendHeading(h) { sentHeading = h; sendClock = 1 / 6; ctx.action({ kind: 'sail', op: 'heading', heading: h }); }

  // ---------- api ----------
  function update(dt, elapsed = 0) {
    if (disposed) return;
    dt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, .25) : 0; clock += dt;
    ensureState();
    const guest = ctx.getRole() === 'guest';
    stepOpts.nSails = nSails; stepOpts.host = !guest;
    steer(dt);
    stepSailing(state, dt, stepOpts, out);
    flow.x = dt > 0 ? -out.dwx / dt : 0; flow.z = dt > 0 ? -out.dwz / dt : 0;
    const fz = BASE_FLOW_Z + flow.z, f2 = flow.x * flow.x + fz * fz;
    if (f2 > .0025) { const f = Math.sqrt(f2); flowDir.x = flow.x / f; flowDir.z = fz / f; } // keep the last clear direction
    if (dt > 0) {
      const sp = Math.sqrt(out.dgx * out.dgx + out.dgz * out.dgz) / dt; speed += (sp - speed) * Math.min(1, dt * 4);
      if (sp > .01) travelDir = Math.atan2(out.dgx, out.dgz);
    }
    smoothDisplay(guest, dt);
    ocean?.uniforms?.uFlow?.value?.set?.(disp.wx, disp.wz);
    moveDrifters();
    const ph = ctx.getPhysics?.();
    if (ph?.swimming && ph.x * ph.x + ph.z * ph.z > LEASH * LEASH) { ph.x -= out.dwx; ph.z -= out.dwz; }
    fixture.position.copy(raft.position); fixture.quaternion.copy(raft.quaternion);
    animateSails(dt, elapsed); animateAnchor(dt);
    updateAim(); updatePrompt();
    info.running = !!ctx.isRunning(); info.yaw = ctx.getYaw(); info.windDir = state.windDir; info.windStr = state.windStr;
    info.heading = shownHeading(); info.raised = state.raised; info.anchored = state.anchored; info.nSails = nSails;
    info.speed = speed; info.travelDir = travelDir;
    ui.update(info);
  }
  // Host/solo show the state directly. The guest advances its display copies by this step's deltas and eases them
  // toward the (dead-reckoned, periodically replaced) state, so host snapshots don't make the world jump.
  function smoothDisplay(guest, dt) {
    if (!guest || !dispOk) { disp.wx = state.wx; disp.wz = state.wz; disp.gx = state.gx; disp.gz = state.gz; dispOk = guest; return; }
    const k = Math.min(1, dt * 3);
    let ex = wrapAxis(state.wx - disp.wx - out.dwx, HW), ez = wrapAxis(state.wz - disp.wz - out.dwz, HW);
    if (ex * ex + ez * ez > SNAP2) { disp.wx = state.wx; disp.wz = state.wz; }
    else { disp.wx = wrapAxis(disp.wx + out.dwx + ex * k, HW); disp.wz = wrapAxis(disp.wz + out.dwz + ez * k, HW); }
    ex = wrapAxis(state.gx - disp.gx - out.dgx, HG); ez = wrapAxis(state.gz - disp.gz - out.dgz, HG);
    if (ex * ex + ez * ez > SNAP2) { disp.gx = state.gx; disp.gz = state.gz; }
    else { disp.gx = wrapAxis(disp.gx + out.dgx + ex * k, HG); disp.gz = wrapAxis(disp.gz + out.dgz + ez * k, HG); }
  }
  function itemFlow(o) { o.x = flow.x; o.z = flow.z; return o; }
  // Items spawn upstream of +z (game makeItem), get rotated about the raft centre onto the flow, and leave once they
  // are past R from the centre moving downstream. Both use the same latched unit direction, so a fresh spawn
  // (centre-relative z < 0 before rotation) always has a negative along-flow component: never instantly out.
  function respawned(it) { placeUpstream(it, flowDir.x, flowDir.z, centre.x, centre.z); return it; }
  function outOfRange(it) { return driftedOut(it, flowDir.x, flowDir.z, halfDiag + ITEM_MARGIN, centre.x, centre.z); }
  function interact() {
    if (!ctx.canInput()) return false;
    updateAim();
    if (aimKind === 1) { ctx.action({ kind: 'sail', op: state.raised ? 'lower' : 'raise' }); return true; }
    if (aimKind === 2) { ctx.action({ kind: 'sail', op: state.anchored ? 'unanchor' : 'anchor' }); return true; }
    return false;
  }
  function grab() {
    if (!ctx.canInput()) return false;
    updateAim();
    if (aimKind !== 1) return false;
    steering = true; grabYaw = ctx.getYaw(); grabHeading = steerHeading = predicted = state.heading; sentHeading = state.heading; sendClock = 0; updatePrompt();
    return true;
  }
  function release() {
    if (!steering) return;
    steering = false;
    if (ctx.getRole() === 'guest' && Math.abs(angDiff(predicted, sentHeading)) > 1e-4) sendHeading(predicted);
    updatePrompt();
  }
  /** Host side of a {kind:'sail'} action. Returns the notice text for the acting player ('' for none). */
  function apply(a, actor = 'host') {
    if (!a || typeof a !== 'object' || a.kind !== 'sail') return '';
    if (LIMITED_OPS.has(a.op)) { // one sail/anchor toggle per actor per OP_GAP ms
      const now = performance.now(), key = String(actor), t = lastOp.get(key);
      if (t !== undefined && now - t < OP_GAP) return '';
      lastOp.set(key, now);
    }
    const s = ensureState(), text = applySailAction(s, a);
    // A guest re-aimed the sail while the host holds it: continue steering from the new heading.
    if (a.op === 'heading' && Number.isFinite(a.heading) && steering && actor !== 'host' && ctx.getRole() !== 'guest') {
      steerHeading = grabHeading = s.heading; grabYaw = ctx.getYaw();
    }
    return text;
  }
  function debug() {
    const s = ensureState(), t = { x: 0, z: 0 }, w = { x: 0, z: 0 };
    sailTarget(s, nSails, t); windVector(s, w);
    return { ...s, nSails, steering, speed, travelDir, sails: sails.length, flow: { ...flow }, flowDir: { ...flowDir }, target: t, wind: w,
      raftR, centre: { ...centre }, halfDiag, itemRange: halfDiag + ITEM_MARGIN, display: { ...disp },
      anchorPos: anchorPos.ok ? { x: anchorPos.x, z: anchorPos.z } : null, drifters: drifters.length, current: [SAIL.CURRENT_X, SAIL.CURRENT_Z] };
  }
  function dispose() {
    if (disposed) return; disposed = true;
    steering = false; restoreSails(); sails.length = 0;
    scene.remove(fixture); ui.dispose(); abort.abort();
    for (const k in G) G[k].dispose();
    for (const k in M) M[k].dispose();
    for (const r of rolls) r.parent?.remove(r);
    rolls.length = 0; lastOp.clear(); drifters.length = 0; stepOpts.blockers.length = 0;
  }
  return { update, onRaftBuilt, addDrifter, itemFlow, respawned, outOfRange, interact, grab, release, apply, debug, dispose,
    get steering() { return steering; } };
}

// Anchor (one merged geometry, ring at the origin, hanging down -y): top ring, stock bar, shank, two flukes in a V.
function anchorGeometry(T) {
  const parts = [
    new T.TorusGeometry(.045, .012, 6, 14),
    new T.CylinderGeometry(.014, .014, .26, 6).rotateX(Math.PI / 2).translate(0, -.08, 0),
    new T.CylinderGeometry(.022, .026, .36, 8).translate(0, -.23, 0),
  ];
  for (const s of [-1, 1]) {
    parts.push(new T.CylinderGeometry(.016, .022, .2, 6).translate(0, .1, 0).rotateZ(s * .95).translate(0, -.4, 0));
    parts.push(new T.ConeGeometry(.034, .08, 4).rotateZ(s * .5).translate(-s * .17, -.27, 0)); // fluke tips
  }
  let n = 0;
  const flat = parts.map(g => { const f = g.index ? g.toNonIndexed() : g; if (f !== g) g.dispose(); n += f.attributes.position.count; return f; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const f of flat) { pos.set(f.attributes.position.array, o); nor.set(f.attributes.normal.array, o); o += f.attributes.position.array.length; f.dispose(); }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3)); out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}
