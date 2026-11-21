// Sailing lane, THREE side: drives world.sailing each frame, moves scenery relative to the raft, animates sails,
// owns the anchor fixture + wind pennants, and handles aiming (E toggles sail/anchor, hold R steers the sail).
// See docs/cloud/sailing-spec.md. The raft never moves in x/z: the world drifts past it instead.
import { SAIL, cleanSailing, defaultSailing, stepSailing, sailTarget, applySailAction, wrapAxis, placeUpstream, driftedOut, windVector } from './sailing-core.js';
import { createSailingUI } from './sailing-ui.js';

const WRAP = SAIL.ISLAND_WRAP > 0 ? SAIL.ISLAND_WRAP : 150, LEASH = 10, STEER_RATE = 1.6, REACH = 3.2, MAST_H = 3.6, MAST_R = .6, ANCHOR_R = .6, DECK_Y = .22;
const FURL = .12, BASE_FLOW_Z = .22, ITEM_RANGE = 34, ROPE_DOWN = 3.4, ROPE_UP = .22;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function createSailing(T, ctx) {
  const { scene, raft, ocean, camera } = ctx;
  const abort = new AbortController();
  const ui = createSailingUI({ signal: abort.signal });
  const out = { dwx: 0, dwz: 0, dgx: 0, dgz: 0 };
  const flow = { x: 0, z: 0 }, info = { running: false, yaw: 0, windDir: 0, windStr: 0, heading: 0, raised: false, anchored: false, nSails: 0, speed: 0, travelDir: 0 };
  const stepOpts = { nSails: 0, host: true, rng: Math.random, blockers: [] };
  const localAct = { kind: 'sail', op: 'heading', heading: 0 };
  const drifters = [], sails = [], pennants = [];
  const vA = new T.Vector3(), vO = new T.Vector3(), vD = new T.Vector3();
  let state = defaultSailing(), lastDt = 0, speed = 0, travelDir = 0, nSails = 0;
  let steering = false, grabYaw = 0, grabHeading = 0, steerHeading = 0, predicted = 0, predictUntil = 0, sentHeading = NaN, sendClock = 0, clock = 0;
  let aimKind = 0, aimIndex = -1, lastPrompt = undefined, anchorShown = 0, disposed = false;
  const anchorPos = { x: 0, z: 0, ok: false };

  // ---------- shared geometry / materials (created once) ----------
  const M = {
    wood: new T.MeshStandardMaterial({ color: '#906f48', roughness: .9 }),
    woodLight: new T.MeshStandardMaterial({ color: '#b4824b', roughness: .9 }),
    rope: new T.MeshStandardMaterial({ color: '#e9d39a', roughness: 1 }),
    iron: new T.MeshStandardMaterial({ color: '#5e5a52', roughness: .6, metalness: .3 }),
    flag: new T.MeshStandardMaterial({ vertexColors: true, side: T.DoubleSide, roughness: 1 }),
  };
  const ropeGeo = new T.CylinderGeometry(.022, .022, 1, 6); ropeGeo.translate(0, -.5, 0);
  const flagGeo = new T.BufferGeometry();
  flagGeo.setAttribute('position', new T.Float32BufferAttribute([0, .09, 0, 0, -.09, 0, 0, 0, .55, 0, .09, 0, 0, -.09, 0, 0, 0, .55], 3));
  flagGeo.setAttribute('color', new T.Float32BufferAttribute([1, .95, .81, 1, .95, .81, .78, .29, .2, 1, .95, .81, 1, .95, .81, .78, .29, .2], 3));
  flagGeo.setIndex([0, 1, 2]); flagGeo.computeVertexNormals();
  const G = {
    post: new T.CylinderGeometry(.065, .08, 1, 8), drum: new T.CylinderGeometry(.075, .075, .34, 10),
    coil: new T.CylinderGeometry(.08, .08, .24, 10), crank: new T.BoxGeometry(.03, .18, .03), arm: new T.BoxGeometry(.06, .06, .6),
    shank: new T.BoxGeometry(.05, .34, .05), fluke: new T.BoxGeometry(.3, .05, .05), spindle: new T.CylinderGeometry(.012, .012, .3, 5),
    rope: ropeGeo, flag: flagGeo,
  };
  const mesh = (geo, mat, x, y, z, parent) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };

  const fixture = new T.Group(); fixture.name = 'sailingFixture'; scene.add(fixture);
  const anchorRoot = new T.Group(); fixture.add(anchorRoot);
  mesh(G.post, M.wood, 0, .5, 0, anchorRoot);
  mesh(G.drum, M.woodLight, 0, .9, 0, anchorRoot).rotation.z = Math.PI / 2;
  const coil = mesh(G.coil, M.rope, 0, .9, 0, anchorRoot); coil.rotation.z = Math.PI / 2;
  mesh(G.crank, M.wood, .2, .84, 0, anchorRoot);
  mesh(G.arm, M.wood, 0, .97, .3, anchorRoot);
  const anchorRope = mesh(G.rope, M.rope, 0, .95, .57, anchorRoot); anchorRope.castShadow = false;
  const hook = new T.Group(); anchorRoot.add(hook);
  mesh(G.shank, M.iron, 0, -.17, 0, hook); mesh(G.fluke, M.iron, 0, -.32, 0, hook);
  hook.position.set(0, .95 - ROPE_UP, .57);

  function pennant(i) {
    while (pennants.length <= i) {
      const g = new T.Group(); mesh(G.spindle, M.wood, 0, .15, 0, g);
      const f = mesh(G.flag, M.flag, 0, .22, 0, g); f.castShadow = false; g.userData.flag = f;
      fixture.add(g); pennants.push(g);
    }
    return pennants[i];
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
    const s = ensureState();
    const d = { obj, bx: obj.position.x + s.gx, bz: obj.position.z + s.gz, r: radius > 0 ? radius : 0, b: null };
    if (d.r) { d.b = { x: obj.position.x, z: obj.position.z, r: d.r }; stepOpts.blockers.push(d.b); }
    drifters.push(d); return obj;
  }
  function moveDrifters() {
    for (let i = 0; i < drifters.length; i++) {
      const d = drifters[i], p = d.obj.position;
      p.x = wrapAxis(d.bx - state.gx, WRAP); p.z = wrapAxis(d.bz - state.gz, WRAP);
      if (d.b) { d.b.x = p.x; d.b.z = p.z; }
    }
  }

  // ---------- raft rebuild: find sail groups, place anchor ----------
  function onRaftBuilt() {
    restoreSails(); sails.length = 0;
    const w = ctx.getWorld(), decor = Array.isArray(w?.decor) ? w.decor : [], tiles = Array.isArray(w?.tiles) ? w.tiles : [];
    for (const c of raft.children) {
      const ct = c.userData?.craftType;
      if (ct !== undefined && ct !== 'sail') continue;
      if (!decor.some(d => d?.type === 'sail' && d.x === Math.round(c.position.x / 2) && d.z === Math.round(c.position.z / 2))) continue;
      const cloth = [];
      for (const m of c.children) {
        if (!m.isMesh) continue;
        const sailPart = ct === 'sail' ? (m.name.startsWith('sail') && m.name !== 'sailTimber' && m.name !== 'sailRope') : m.geometry?.type === 'PlaneGeometry';
        if (sailPart) cloth.push(m);
      }
      if (!cloth.length) continue;
      let top = -Infinity, zp = Infinity;
      for (const m of cloth) { m.geometry.computeBoundingBox?.(); const b = m.geometry.boundingBox; if (!b) continue; top = Math.max(top, m.position.y + b.max.y); zp = Math.min(zp, m.position.z + b.min.z); }
      if (!Number.isFinite(top)) continue;
      sails.push({ group: c, cloth, py: cloth.map(m => m.position.y), pz: cloth.map(m => m.position.z), top, zp, h: state.heading, s: state.raised ? 1 : FURL, bz: 1 });
    }
    for (let i = 0; i < pennants.length; i++) pennants[i].visible = false;
    for (let i = 0; i < sails.length; i++) { const p = pennant(i), g = sails[i].group.position; p.position.set(g.x, DECK_Y + MAST_H + .02, g.z); p.visible = true; }
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
    }
  }
  function animateSails(dt, elapsed) {
    const target = shownHeading(), raised = state.raised, k = Math.min(1, dt * 3), kf = Math.min(1, dt * 2.2);
    const push = raised ? state.windStr * Math.max(0, Math.cos(target - state.windDir)) : 0;
    for (let i = 0; i < sails.length; i++) {
      const e = sails[i];
      e.h += angDiff(target, e.h) * k; e.group.rotation.y = e.h;
      e.s += ((raised ? 1 : FURL) - e.s) * kf;
      e.bz += ((raised ? .8 + .5 * push + .03 * Math.sin(elapsed * 2.3 + i) * push : 1) - e.bz) * kf;
      for (let j = 0; j < e.cloth.length; j++) {
        const m = e.cloth[j];
        m.scale.y = e.s; m.position.y = e.top - e.s * (e.top - e.py[j]);
        m.scale.z = e.bz; m.position.z = e.zp - e.bz * (e.zp - e.pz[j]);
      }
      const f = pennants[i]?.userData.flag;
      if (f) { const amp = .06 + .4 * state.windStr * state.windStr; f.rotation.y = state.windDir + amp * Math.sin(elapsed * (5 + 4 * state.windStr) + i * 1.7); f.rotation.x = .25 * amp * Math.sin(elapsed * 5.1 + i); }
    }
  }
  function animateAnchor(dt) {
    anchorShown += ((state.anchored ? 1 : 0) - anchorShown) * Math.min(1, dt * 1.6);
    const len = ROPE_UP + (ROPE_DOWN - ROPE_UP) * anchorShown;
    anchorRope.scale.y = len; hook.position.y = .95 - len;
    coil.scale.x = coil.scale.z = 1.6 - .6 * anchorShown;
  }

  // ---------- aiming ----------
  function shownHeading() {
    return (ctx.getRole() === 'guest' && (steering || clock < predictUntil)) ? predicted : state.heading;
  }
  function updateAim() {
    aimKind = 0; aimIndex = -1;
    if (!ctx.canInput()) return;
    raft.updateMatrixWorld();
    camera.getWorldPosition(vO); camera.getWorldDirection(vD);
    let best = Infinity;
    const hh = vD.x * vD.x + vD.z * vD.z;
    for (let i = 0; i < sails.length; i++) {
      const g = sails[i].group.position; raft.localToWorld(vA.set(g.x, DECK_Y, g.z));
      let t = hh > 1e-6 ? ((vA.x - vO.x) * vD.x + (vA.z - vO.z) * vD.z) / hh : 0;
      t = Math.min(REACH, Math.max(0, t));
      const y = vO.y + vD.y * t, dx = vO.x + vD.x * t - vA.x, dz = vO.z + vD.z * t - vA.z;
      if (y >= vA.y && y <= vA.y + MAST_H && dx * dx + dz * dz < MAST_R * MAST_R && t < best) { best = t; aimKind = 1; aimIndex = i; }
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
    if (ctx.isRunning() && ctx.canInput()) {
      if (steering) p = 'Steering the sail — look where to go';
      else if (aimKind === 1) p = '<kbd>E</kbd>' + (state.raised ? 'Lower sail' : 'Raise sail') + ' · hold <kbd>R</kbd> to steer';
      else if (aimKind === 2) p = '<kbd>E</kbd>' + (state.anchored ? 'Raise anchor' : 'Drop anchor');
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
    dt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, .25) : 0; clock += dt; lastDt = dt;
    ensureState(); nSails = countSails();
    stepOpts.nSails = nSails; stepOpts.host = ctx.getRole() !== 'guest';
    steer(dt);
    stepSailing(state, dt, stepOpts, out);
    flow.x = dt > 0 ? -out.dwx / dt : 0; flow.z = dt > 0 ? -out.dwz / dt : 0;
    if (dt > 0) {
      const sp = Math.hypot(out.dgx, out.dgz) / dt; speed += (sp - speed) * Math.min(1, dt * 4);
      if (sp > .01) travelDir = Math.atan2(out.dgx, out.dgz);
    }
    ocean?.uniforms?.uFlow?.value?.set?.(state.wx, state.wz);
    moveDrifters();
    const ph = ctx.getPhysics?.();
    if (ph?.swimming && Math.hypot(ph.x, ph.z) > LEASH) { ph.x -= out.dwx; ph.z -= out.dwz; }
    fixture.position.copy(raft.position); fixture.quaternion.copy(raft.quaternion);
    animateSails(dt, elapsed); animateAnchor(dt);
    updateAim(); updatePrompt();
    info.running = !!ctx.isRunning(); info.yaw = ctx.getYaw(); info.windDir = state.windDir; info.windStr = state.windStr;
    info.heading = shownHeading(); info.raised = state.raised; info.anchored = state.anchored; info.nSails = nSails;
    info.speed = speed; info.travelDir = travelDir;
    ui.update(info);
  }
  function itemFlow(o) { o.x = flow.x; o.z = flow.z; return o; }
  function respawned(it) { placeUpstream(it, flow.x, BASE_FLOW_Z + flow.z); return it; }
  function outOfRange(it) { return driftedOut(it, flow.x, BASE_FLOW_Z + flow.z, ITEM_RANGE); }
  function interact() {
    if (!ctx.canInput()) return false;
    updateAim();
    if (aimKind === 1) { ctx.action({ kind: 'sail', op: 'toggle' }); return true; }
    if (aimKind === 2) { ctx.action({ kind: 'sail', op: 'toggleAnchor' }); return true; }
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
  function apply(a, actor) {
    if (!a || a.kind !== 'sail') return;
    const text = applySailAction(ensureState(), a);
    if (text) ctx.notice(text);
  }
  function debug() {
    const s = ensureState(), t = { x: 0, z: 0 }, w = { x: 0, z: 0 };
    sailTarget(s, nSails, t); windVector(s, w);
    return { ...s, nSails, steering, speed, travelDir, sails: sails.length, flow: { ...flow }, target: t, wind: w,
      anchorPos: anchorPos.ok ? { x: anchorPos.x, z: anchorPos.z } : null, drifters: drifters.length, current: [SAIL.CURRENT_X, SAIL.CURRENT_Z] };
  }
  function dispose() {
    if (disposed) return; disposed = true;
    steering = false; restoreSails(); sails.length = 0;
    scene.remove(fixture); ui.dispose(); abort.abort();
    for (const k in G) G[k].dispose();
    for (const k in M) M[k].dispose();
    drifters.length = 0; stepOpts.blockers.length = 0;
  }
  return { update, onRaftBuilt, addDrifter, itemFlow, respawned, outOfRange, interact, grab, release, apply, debug, dispose,
    get steering() { return steering; } };
}
