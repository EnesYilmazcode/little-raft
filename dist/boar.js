// Tusker content module: the hostile island boar (rules in boar-core.js, model in boar-model.js).
// Slice world.ext.tusker, host-authoritative. The host simulates and sends a compact pose; guests only draw it.
// Damage goes through ctx.hurtPlayer (the game's vitals path): the host hurts itself directly and counts goring
// the guest in st.hg, which the guest turns into its own hurtPlayer when the count goes up.
// Actions: 'boar.hit' (a guest's spear hit), 'boar.loot' (E on the body: 2 Raw Meat).
import { BOAR, BOAR_LOOT, LIFE, MODE, defaults, spawnFor, cleanBoar, stepBoar, hitBoar, lootable, packBoar } from './boar-core.js?build=v3-survival-ae77fa84ac2b';
import { boarBodyGeometry, boarLegGeometry, boarMaterial, LEG_HIPS } from './boar-model.js?build=v3-survival-ae77fa84ac2b';
import { islandNow } from './islands.js?build=v3-survival-ae77fa84ac2b';
import { addMeleeTarget } from './melee-targets.js?build=v3-survival-ae77fa84ac2b';
import { Bag } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { PLAYER_CONSTANTS } from './player-physics.js?build=v3-survival-ae77fa84ac2b';

export * from './boar-core.js?build=v3-survival-ae77fa84ac2b';

const EYE = PLAYER_CONSTANTS.EYE_OFFSET;
const SPEAR_REACH = 2.8, GUEST_HIT_MS = 250;
const LOOT_TEXT = '+2 Raw Meat';
const TEXT = Object.freeze({
  alert: 'A tusker lowers its tusks and snorts. Side-step when it charges!',
  dead: 'The tusker is down. Press E on it for meat.',
  full: 'Your bag is full',
  prompt: '<kbd>E</kbd>Butcher the tusker (2 Raw Meat)',
});
const SPEED = [BOAR.WALK_SPEED, 0, 0, BOAR.CHARGE_SPEED, BOAR.TROT_SPEED, 0]; // by MODE, for the leg cycle
const AMP = [0.42, 0, 0, 0.85, 0.55, 0];

export function createBoar(ctx) {
  const T = ctx.T;
  const st = defaults(), ev = { hit: -1, alert: false }, out = {};
  const players = [{ x: 0, z: 0, on: false, feet: NaN, ground: NaN }, { x: 0, z: 0, on: false, feet: NaN, ground: NaN }];
  const isHost = () => ctx.role !== 'guest';
  let frozen = false, alertSeed = -1, seenHg = -1, seenSeed = -1, flash = 0, phase = 0, clock = 0;
  const hitAt = { host: -1e9, guest: -1e9 };

  // ---------- scene: 2 draw calls (body + 4 instanced legs, one material) ----------
  const mat = boarMaterial(T), bodyGeo = boarBodyGeometry(T), legGeo = boarLegGeometry(T);
  const root = new T.Group(); root.name = 'tusker'; root.visible = false;
  const pose = new T.Group();
  const body = new T.Mesh(bodyGeo, mat); body.name = 'tusker-body'; body.castShadow = true; body.receiveShadow = true;
  const legs = new T.InstancedMesh(legGeo, mat, 4); legs.name = 'tusker-legs'; legs.castShadow = true; legs.frustumCulled = false;
  legs.instanceMatrix.setUsage(T.DynamicDrawUsage);
  pose.add(body, legs); root.add(pose);
  if (ctx.scene) ctx.scene.add(root);

  // scratch (no per-frame allocation)
  const vP = new T.Vector3(), vS = new T.Vector3(1, 1, 1), qL = new T.Quaternion(), eL = new T.Euler(), mL = new T.Matrix4();
  const camO = new T.Vector3(), camD = new T.Vector3();
  const view = { x: 0, z: 0, h: 0, ok: false };
  const local = { x: 0, z: 0 };

  function writeLegs(angles0, angles1, angles2, angles3) {
    for (let i = 0; i < 4; i++) {
      const a = i === 0 ? angles0 : i === 1 ? angles1 : i === 2 ? angles2 : angles3, hp = LEG_HIPS[i];
      eL.set(a, 0, st.a === LIFE.alive ? 0 : (i & 1 ? -0.25 : 0.25)); qL.setFromEuler(eL);
      vP.set(hp[0], hp[1], hp[2]); mL.compose(vP, qL, vS); legs.setMatrixAt(i, mL);
    }
    legs.instanceMatrix.needsUpdate = true;
  }
  writeLegs(0, 0, 0, 0);

  // ---------- host sim ----------
  function fillPlayer(slot, p, isl, swimming) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) { slot.on = false; return; }
    slot.x = p.x - isl.cx; slot.z = p.z - isl.cz;
    const g = isl.groundAt(p.x, p.z), feet = Number.isFinite(p.y) ? p.y - EYE : NaN;
    slot.ground = g; slot.feet = feet;
    slot.on = !swimming && g === g && feet === feet && feet - g > -0.4 && feet - g < 2;
  }
  function simulate(dt, isl) {
    fillPlayer(players[0], ctx.physics, isl, !!ctx.physics?.swimming);
    const o = ctx.role === 'host' ? ctx.other : null;
    if (o && o.y !== null) fillPlayer(players[1], o, isl, false); else players[1].on = false;
    stepBoar(st, dt, players, ev);
    if (ev.alert && alertSeed !== st.s) { alertSeed = st.s; emit({ kind: 'notice', text: TEXT.alert }, 'all'); }
    if (ev.hit === 0) { st.hh++; gored(); }
    else if (ev.hit === 1) st.hg++;
  }
  function gored() { try { ctx.hurtPlayer?.(BOAR.DAMAGE, 'boar'); } catch {} try { ctx.play?.('bite', 1); } catch {} }
  function emit(e, to) { try { ctx.emit(e, to); } catch {} }

  // ---------- per frame ----------
  function update(dt) {
    if (!(dt > 0)) dt = 0;
    clock += dt;
    const isl = islandNow();
    if (isHost() && isl && isl.seed !== st.s) spawnFor(st, isl.seed, isl.R);
    if (isHost() && isl && ctx.running && !frozen && st.a === LIFE.alive && st.s === isl.seed) simulate(dt, isl);
    draw(dt, isl);
  }

  function draw(dt, isl) {
    const show = !!isl && st.s === isl.seed && (st.a === LIFE.alive || st.a === LIFE.dead);
    if (!show) { root.visible = false; view.ok = false; return; }
    // Guests ease toward the ~8 Hz host pose; the host draws the sim directly.
    if (!view.ok || isHost()) { view.x = st.x; view.z = st.z; view.h = st.h; view.ok = true; }
    else {
      const k = 1 - Math.exp(-12 * dt);
      view.x += (st.x - view.x) * k; view.z += (st.z - view.z) * k;
      let d = st.h - view.h; d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2; view.h += d * k;
    }
    const wx = isl.cx + view.x, wz = isl.cz + view.z, g = isl.groundAt(wx, wz);
    if (!(g === g)) { root.visible = false; return; }
    root.visible = true;
    const sh = Math.sin(view.h), ch = Math.cos(view.h);
    const gf = isl.groundAt(wx + sh * 0.4, wz + ch * 0.4), gb = isl.groundAt(wx - sh * 0.4, wz - ch * 0.4);
    const pitch = gf === gf && gb === gb ? Math.atan2(gb - gf, 0.8) : 0; // nose up a slope
    root.position.set(wx, g, wz); root.rotation.set(0, view.h, 0);
    const m = st.a === LIFE.alive ? st.m : MODE.dead;
    if (m === MODE.dead) {
      pose.rotation.set(0, 0, 1.45); pose.position.set(0.3, 0.06, 0); writeLegs(0.35, -0.2, 0.25, -0.35);
    } else {
      phase += dt * SPEED[m] * 7;
      const s = Math.sin(phase), amp = AMP[m];
      const bob = m === MODE.charge ? Math.abs(s) * 0.05 : m === MODE.walk || m === MODE.trot ? Math.abs(s) * 0.015 : 0;
      pose.position.set(0, bob, 0);
      const headDown = m === MODE.alert ? 0.14 : m === MODE.charge ? 0.08 : 0;
      pose.rotation.set(pitch + headDown, 0, 0);
      if (m === MODE.alert) { const paw = Math.max(0, Math.sin(clock * 13)) * 0.6; writeLegs(0, -paw, 0, 0); }
      else if (amp > 0) writeLegs(s * amp, -s * amp, -s * amp, s * amp); // diagonal trot pairs
      else if (phase !== 0) { phase = 0; writeLegs(0, 0, 0, 0); }
    }
    if (flash > 0) { flash = Math.max(0, flash - dt * 5); mat.emissive.setRGB(flash * 0.55, flash * 0.08, flash * 0.05); }
  }

  // ---------- spear (melee registry) ----------
  // Two spheres: torso and head. Ray from origin along unit dir within reach.
  function rayHits(o, d, reach, cx, cy, cz, r) {
    const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
    const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - c;
    if (disc < 0) return false;
    const t = -b - Math.sqrt(disc);
    return t <= reach && (t >= 0 || c <= 0);
  }
  function aimedAt(o, d, reach, rBody, rHead) {
    if (!root.visible) return false;
    const p = root.position, sh = Math.sin(view.h), ch = Math.cos(view.h);
    if (st.a === LIFE.dead) return rayHits(o, d, reach, p.x, p.y + 0.3, p.z, rBody + 0.15);
    return rayHits(o, d, reach, p.x + sh * 0.05, p.y + 0.5, p.z + ch * 0.05, rBody) || rayHits(o, d, reach, p.x + sh * 0.58, p.y + 0.42, p.z + ch * 0.58, rHead);
  }
  function spearTarget(origin, dir, reach, dmg) {
    if (st.a !== LIFE.alive || !aimedAt(origin, dir, reach, 0.42, 0.26)) return false;
    flash = 1;
    if (isHost()) applyHit(dmg, ctx.physics, 'host');
    else ctx.action({ kind: 'boar.hit', s: st.s, dmg });
    return true;
  }
  const offMelee = addMeleeTarget(spearTarget);

  function applyHit(dmg, who, actor) {
    const isl = islandNow();
    if (isl && who) { local.x = who.x - isl.cx; local.z = who.z - isl.cz; }
    const r = hitBoar(st, dmg, isl && who ? local : null);
    if (r === 'killed') emit({ kind: 'notice', text: TEXT.dead }, 'all');
    return r;
  }
  const distTo = (p, isl) => Math.hypot(p.x - (isl.cx + st.x), p.z - (isl.cz + st.z));

  // ---------- host actions ----------
  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || a.kind.slice(0, 5) !== 'boar.') return false;
    if (!isHost()) return true;
    const isl = islandNow(), p = actor === 'guest' ? ctx.other : ctx.physics;
    if (!isl || !p || a.s !== st.s || st.s !== isl.seed) return true;
    if (a.kind === 'boar.hit') {
      const now = ctx.elapsed * 1000;
      if (!(now - hitAt[actor] >= GUEST_HIT_MS) || !Number.isFinite(a.dmg)) return true;
      if (distTo(p, isl) > SPEAR_REACH + BOAR.HIT_SLACK + 0.6) return true;
      hitAt[actor] = now; applyHit(a.dmg, p, actor);
      return true;
    }
    if (a.kind === 'boar.loot') {
      if (!lootable(st) || distTo(p, isl) > BOAR.LOOT_REACH + (actor === 'guest' ? 1.5 : 0.01)) return true;
      const scratch = new Bag(bag.snapshot());
      for (const k in BOAR_LOOT) if (scratch.add(k, BOAR_LOOT[k]) > 0) { emit({ kind: 'full', text: TEXT.full }, actor); return true; }
      for (const k in BOAR_LOOT) bag.add(k, BOAR_LOOT[k]);
      st.a = LIFE.looted;
      emit({ kind: 'loot', text: LOOT_TEXT, loot: BOAR_LOOT }, actor);
      return true;
    }
    return true;
  }

  // ---------- E on the body ----------
  function canButcher() {
    if (st.a !== LIFE.dead || !root.visible || !ctx.camera || !ctx.physics) return false;
    const p = ctx.physics;
    if (Math.hypot(p.x - root.position.x, p.z - root.position.z) > BOAR.LOOT_REACH) return false;
    ctx.camera.getWorldPosition(camO); ctx.camera.getWorldDirection(camD);
    return aimedAt(camO, camD, BOAR.LOOT_REACH + 1.2, 0.55, 0);
  }
  function prompt() { return canButcher() ? TEXT.prompt : null; }
  function interact() {
    if (!canButcher()) return false;
    ctx.action({ kind: 'boar.loot', s: st.s });
    return true;
  }

  // ---------- save / net ----------
  function serialize() { return packBoar(st, out); }
  function load(data, from) {
    const prevSeed = st.s;
    cleanBoar(data, st);
    if (from === 'net') {
      // Guest: a rising gore count for this tusker means the host saw it hit us.
      if (seenSeed === st.s && st.hg > seenHg) gored();
      seenSeed = st.s; seenHg = st.hg;
      if (st.s !== prevSeed) view.ok = false; // a new tusker snaps; the same one keeps easing toward each ~8 Hz pose
    } else {
      if (st.a === LIFE.alive) { st.m = MODE.idle; st.t = 1; }
      view.ok = false; seenSeed = -1; // our own world again: a later join starts a fresh gore count
    }
  }

  function dispose() {
    offMelee();
    if (root.parent) root.parent.remove(root);
    legs.dispose?.(); bodyGeo.dispose(); legGeo.dispose(); mat.dispose();
  }

  // ---------- QA helpers (raftDebug.content.tusker) ----------
  const debug = {
    state: () => ({ ...packBoar(st, {}), t: st.t, run: st.run, visible: root.visible, wx: root.position.x, wy: root.position.y, wz: root.position.z, drawCalls: 2 }),
    // Force a tusker onto the current island (any size) at island-local x, z.
    spawn(x = 2, z = 0, h = 0) {
      const isl = islandNow(); if (!isHost() || !isl) return false;
      spawnFor(st, isl.seed, Math.max(isl.R, BOAR.MIN_R)); st.R = isl.R; st.x = x; st.z = z; st.h = h; st.m = MODE.idle; st.t = 1;
      return debug.state();
    },
    set(fields) { if (isHost() && fields && typeof fields === 'object') for (const k in fields) if (k in st) st[k] = fields[k]; return debug.state(); },
    hit(dmg = 5) { if (!isHost()) return null; flash = 1; return applyHit(dmg, ctx.physics, 'host'); },
    kill() { if (!isHost()) return null; let r = null; while (st.a === LIFE.alive) r = hitBoar(st, BOAR.MAX_DMG); if (r === 'killed') emit({ kind: 'notice', text: TEXT.dead }, 'all'); return debug.state(); },
    canButcher,
    freeze(on = true) { frozen = !!on; return frozen; }, // QA: hold the pose (screenshots)
  };

  return { name: 'tusker', update, serialize, load, action, prompt, interact, debug, dispose };
}
