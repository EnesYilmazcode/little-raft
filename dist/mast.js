// The Old Beacon Mast content module: the Receiver's first long-range signal and a climbable landmark.
// Switch the receiver on (E) with 3 antennas on the raft and a charged battery within 3 tiles: the host hears the
// mast, places it 600-800 m ahead of the raft's travel on the seabed (like islands.js), and the signal pill and the
// compass show its bearing and range while the receiver stays powered (a full battery lasts ~500 s). Beach the raft
// on its rock (grounding blocker), climb the ladder (E), open the three crates and read the keeper's board: a
// logbook note with the code and bearing of the next landmark (stored for a later round).
// Host-authoritative; saved in world.ext.mast. Pure rules in mast-core.js, the model in mast-model.js.
import {
  MAST, CRATES, BOARD, LADDER_FOOT, LADDER_TOP, cleanMast, placeRel, baseFrom, mastRel, surfaceAt, onDeck,
  receiverStatus, bearing, rangeText, openCrate, readBoard, antennaCount,
} from './mast-core.js?build=v3-survival-ae77fa84ac2b';
import { createMastModel } from './mast-model.js?build=v3-survival-ae77fa84ac2b';
import { standOnSand } from './islands-layout.js?build=v3-survival-ae77fa84ac2b';
import { SAIL } from './sailing-core.js?build=v3-survival-ae77fa84ac2b';
import { ITEM_INFO } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { PLAYER_CONSTANTS } from './player-physics.js?build=v3-survival-ae77fa84ac2b';
import { storyNote } from './logbook.js?build=v3-survival-ae77fa84ac2b';

export * from './mast-core.js?build=v3-survival-ae77fa84ac2b';

const EYE = PLAYER_CONSTANTS.EYE_OFFSET, BODY = PLAYER_CONSTANTS.BODY_RADIUS;
const RX_REACH = 2.6, AIM_OFF = .7, LOCAL_COOLDOWN = .35;
const itemName = k => (ITEM_INFO[k] && ITEM_INFO[k].name) || k;
const NO_NOTES = Object.freeze([]);
const P_CLIMB = '<kbd>E</kbd>Climb the ladder', P_DOWN = '<kbd>E</kbd>Climb down', P_CRATE = '<kbd>E</kbd>Open the crate', P_BOARD = '<kbd>E</kbd>Read the keeper’s board';

export function createMast(ctx, peer = null) {
  const T = ctx.T;
  let st = cleanMast(undefined), rev = 1, netR = -1, out = null, outRev = -1;
  const authority = () => ctx.role !== 'guest';
  let pw = null; // the power module, looked up once it exists (it is created after this one)
  const power = () => { if (pw && !pw.dead) return pw; try { pw = peer ? peer('power') : null; } catch { pw = null; } return pw; };

  // ---------- scene ----------
  const model = T ? createMastModel(T) : null;
  if (model) { model.group.visible = false; ctx.scene?.add(model.group); model.setCrates(st.crates); }
  const vO = T ? new T.Vector3() : null, vD = T ? new T.Vector3() : null;

  // ---------- placement ----------
  const gnd = { x: 0, z: 0 }, rel = { x: 0, z: 0 }, tmp = { x: 0, z: 0 }, read = { heading: 0, point: 'N', arrow: 0, distance: 0 };
  const blocker = { x: 0, z: 0, r: 0 };
  let blockerOwner = null, shown = false, cx = 0, cz = 0, gy = 0, dist = Infinity, clock = 0, drainAcc = 0;
  const baseY = () => (ctx.ocean && ctx.ocean.mesh ? ctx.ocean.mesh.position.y : -0.24);
  function ground(o) {
    const s = ctx.sailing;
    if (s && typeof s.groundOffset === 'function') return s.groundOffset(o);
    const w = ctx.world && ctx.world.sailing;
    o.x = w && Number.isFinite(w.gx) ? w.gx : 0; o.z = w && Number.isFinite(w.gz) ? w.gz : 0;
    return o;
  }
  function place() {
    if (!st.at) { shown = false; dist = Infinity; if (model) model.group.visible = false; return; }
    ground(gnd); mastRel(st.at, gnd.x, gnd.z, rel);
    cx = rel.x; cz = rel.z; gy = baseY(); dist = Math.sqrt(cx * cx + cz * cz);
    shown = dist < MAST.SHOW;
    if (model) { model.group.visible = shown; if (shown) model.group.position.set(cx, gy, cz); }
  }
  function updateBlocker() {
    const s = ctx.sailing;
    if (s && s !== blockerOwner && typeof s.addBlocker === 'function') { s.addBlocker(blocker); blockerOwner = s; }
    if (st.at && dist < MAST.SHOW) { blocker.x = cx; blocker.z = cz; blocker.r = MAST.PLAT_R * 1.07 + (s && typeof s.blockerClear === 'function' ? s.blockerClear() : 6); }
    else blocker.r = 0;
    if (s && typeof s.markBeacon === 'function') s.markBeacon(st.at && st.live ? cx : NaN, cz);
  }

  // ---------- receiver ----------
  const receiver = () => { const d = ctx.world && ctx.world.decor; if (Array.isArray(d)) for (let i = 0; i < d.length; i++) if (d[i] && d[i].type === 'receiver') return d[i]; return null; };
  const charge = r => { const p = power(); try { return r && p && typeof p.servedCharge === 'function' ? p.servedCharge(r.x, r.z) || 0 : 0; } catch { return 0; } };
  function status(r = receiver()) { return receiverStatus(!!r, !!st.on, antennaCount(ctx.world && ctx.world.decor, r), charge(r) > 0); }
  const bump = () => { rev++; };
  function emitAll(text, sound) { try { ctx.emit({ kind: 'notice', text, ...(sound ? { sound } : {}) }, 'all'); } catch {} }

  function hostTick(dt) {
    if (!st.seed) { st.seed = ((Math.random() * 4294967295) >>> 0) || 1; bump(); }
    const r = receiver();
    if (!r && st.on) { st.on = 0; bump(); }
    if (st.on && r) {
      drainAcc += dt;
      if (drainAcc >= 1) { const n = Math.floor(drainAcc); drainAcc -= n; try { power()?.draw?.(r.x, r.z, MAST.RX_DRAIN * n); } catch {} }
    } else drainAcc = 0;
    const live = status(r) === 'live' ? 1 : 0;
    if (live !== st.live) { st.live = live; bump(); }
    if (live && !st.at) {
      const s = ctx.world && ctx.world.sailing;
      const vx = s && Number.isFinite(s.vx) ? s.vx : 0, vz = s && Number.isFinite(s.vz) ? s.vz : 0;
      placeRel(st.seed, vx + SAIL.CURRENT_X, vz + SAIL.CURRENT_Z, tmp);
      ground(gnd); st.at = baseFrom(tmp.x, tmp.z, gnd.x, gnd.z); bump(); place();
      bearing(cx, cz, 0, 0, 0, read);
      emitAll(`The receiver locks on: a steady pulse from the Old Beacon Mast, ${rangeText(read.distance)} ${read.point}`, 'catch');
    }
  }

  // ---------- HUD readout (content.beacon) ----------
  const hud = { label: '', arrow: 0, live: false };
  let hudKey = -1; // numeric so the per-frame check never builds a string
  function updateHud() {
    const r = receiver();
    if (!r || !st.on) { hud.label = ''; return; }
    const p = ctx.physics;
    if (st.live && st.at) {
      bearing(cx, cz, p ? p.x : 0, p ? p.z : 0, 0, read);
      hud.live = true;
      const key = 1e7 + Math.round(read.heading / 45) % 8 * 1e6 + Math.round(read.distance / 10);
      if (key !== hudKey) { hudKey = key; hud.label = `BEACON MAST ${read.point} · ${rangeText(read.distance)}`; }
      return;
    }
    hud.live = false;
    const s = status(r);
    const key = s === 'antennas' ? 10 + antennaCount(ctx.world.decor, r) : s === 'power' ? 2 : 1;
    if (key !== hudKey) { hudKey = key; hud.label = s === 'antennas' ? `RECEIVER · antennas ${antennaCount(ctx.world.decor, r)}/${MAST.ANTENNAS}` : s === 'power' ? 'RECEIVER · no charged battery nearby' : 'RECEIVER · listening…'; }
  }

  // ---------- player on the rock / deck ----------
  const surf = { onSand: false, lastJump: false };
  let carryX = NaN, carryZ = NaN, localCool = 0;
  function afterMove(p, dt) {
    if (!p || !shown) { surf.onSand = false; carryX = NaN; return; }
    if (surf.onSand && carryX === carryX && (cx - carryX) ** 2 + (cz - carryZ) ** 2 < 4) { p.x += cx - carryX; p.z += cz - carryZ; }
    carryX = cx; carryZ = cz;
    let lx = p.x - cx, lz = p.z - cz;
    if (lx * lx + lz * lz > (MAST.PLAT_R * 1.3) ** 2) { surf.onSand = false; return; }
    const fy = p.y - EYE - gy;
    if (onDeck(lx, lz, fy)) { // railings
      const R = MAST.RAIL;
      if (lx > R) lx = R; else if (lx < -R) lx = -R;
      if (lz > R) lz = R; else if (lz < -R) lz = -R;
      p.x = cx + lx; p.z = cz + lz;
    } else if (fy < MAST.DECK_Y - 1) { // walk round the tower legs
      const t = Math.min(1, Math.max(0, (fy - MAST.PLAT_Y) / (MAST.DECK_Y - MAST.PLAT_Y))), s = MAST.LEGS[0] + (MAST.LEGS[1] - MAST.LEGS[0]) * t, r = MAST.LEG_R + BODY;
      for (let k = 0; k < 4; k++) {
        const dx = lx - (k & 1 ? s : -s), dz = lz - (k & 2 ? s : -s), d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2) || 1e-4, push = (r - d) / d; lx += dx * push; lz += dz * push;
      }
      p.x = cx + lx; p.z = cz + lz;
    }
    const g = surfaceAt(lx, lz, fy);
    const wave = ctx.ocean && typeof ctx.ocean.getHeight === 'function' ? ctx.ocean.getHeight(p.x, p.z) : gy;
    standOnSand(p, g === g ? gy + g : NaN, wave, surf);
    void dt;
  }
  // Mast-local pose of the local player (feet height above the origin in .fy).
  const me = { x: 0, z: 0, fy: 0, y: 0 };
  function local(p) { me.x = p.x - cx; me.z = p.z - cz; me.fy = p.y - EYE - gy; me.y = p.y - gy; return me; }
  function teleport(lx, lz, ly) {
    const p = ctx.physics; if (!p) return false;
    p.x = cx + lx; p.z = cz + lz; p.y = gy + ly + EYE; p.vx = p.vy = p.vz = 0; p.verticalSpeed = 0; p.grounded = true; p.swimming = false;
    surf.onSand = true; carryX = cx; carryZ = cz; return true;
  }

  // What the local player can use right now: 'climb' | 'down' | 'crate' (+ index) | 'board' | 'rx' | null.
  let targetCrate = -1;
  function aimScore(aim, x, y, z, reach) { // camera-ray offset to a world point within reach, or Infinity
    if (!ctx.camera || !vO) return Infinity;
    ctx.camera.getWorldPosition(vO);
    if (aim && aim.dir && Number.isFinite(aim.dir.x)) vD.copy(aim.dir).normalize(); else ctx.camera.getWorldDirection(vD);
    const ox = x - vO.x, oy = y - vO.y, oz = z - vO.z, along = ox * vD.x + oy * vD.y + oz * vD.z;
    if (along <= 0 || along > reach) return Infinity;
    const ex = ox - vD.x * along, ey = oy - vD.y * along, ez = oz - vD.z * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
    return off <= AIM_OFF ? off : Infinity;
  }
  function target(aim) {
    targetCrate = -1;
    const p = ctx.physics; if (!p) return null;
    if (shown && dist < 40) {
      const m = local(p);
      if (onDeck(m.x, m.z, m.fy)) {
        let best = Infinity;
        for (let i = 0; i < CRATES.length; i++) {
          if (st.crates[i]) continue;
          const s = aimScore(aim, cx + CRATES[i].x, gy + MAST.DECK_Y + .3, cz + CRATES[i].z, MAST.REACH + .4);
          if (s < best) { best = s; targetCrate = i; }
        }
        if (targetCrate >= 0) return 'crate';
        if (aimScore(aim, cx + BOARD.x, gy + MAST.DECK_Y + 1.45, cz + BOARD.z, MAST.REACH + .4) < Infinity) return 'board';
        if ((m.x - LADDER_TOP.x) ** 2 + (m.z - LADDER_TOP.z) ** 2 < MAST.CLIMB_REACH ** 2) return 'down';
        return null;
      }
      if (surf.onSand && (m.x - LADDER_FOOT.x) ** 2 + (m.z - LADDER_FOOT.z) ** 2 < MAST.CLIMB_REACH ** 2) return 'climb';
    }
    const r = receiver();
    if (r) {
      const y = (ctx.raft?.position.y ?? 0) + .22 + .25;
      if (Math.hypot(p.x - r.x * 2, p.z - r.z * 2) <= RX_REACH && aimScore(aim, r.x * 2, y, r.z * 2, RX_REACH + 1) < Infinity) return 'rx';
    }
    return null;
  }
  let rxKey = -1, rxText = null;
  function rxPrompt() { // cached: rebuilt only when on/antennas/battery % change
    const r = receiver(), e = charge(r), pct = Math.round(e / 1800 * 100), n = antennaCount(ctx.world && ctx.world.decor, r);
    const key = (st.on ? 1000 : 0) + n * 200 + (e > 0 ? pct + 1 : 0);
    if (key === rxKey) return rxText;
    rxKey = key; rxText = rxPromptText(e, pct, n);
    return rxText;
  }
  function rxPromptText(e, pct, n) {
    const bat = e > 0 ? `battery ${pct}%` : 'no charged battery within 3 tiles';
    if (!st.on) return `<kbd>E</kbd>Switch the receiver on · ${bat}`;
    if (n < MAST.ANTENNAS) return `<kbd>E</kbd>Switch the receiver off · antennas ${n}/${MAST.ANTENNAS}`;
    return `<kbd>E</kbd>Switch the receiver off · ${bat}`;
  }
  function prompt(aim) {
    const t = target(aim);
    return t === 'climb' ? P_CLIMB : t === 'down' ? P_DOWN : t === 'crate' ? P_CRATE : t === 'board' ? P_BOARD : t === 'rx' ? rxPrompt() : null;
  }
  function interact(aim) {
    const t = target(aim); if (!t) return false;
    if (t === 'climb') return teleport(LADDER_TOP.x, LADDER_TOP.z, MAST.DECK_Y);
    if (t === 'down') return teleport(LADDER_FOOT.x, LADDER_FOOT.z, MAST.PLAT_Y);
    if (localCool > 0) return true;
    localCool = LOCAL_COOLDOWN;
    if (t === 'crate') ctx.action({ kind: 'mast.crate', i: targetCrate });
    else if (t === 'board') ctx.action({ kind: 'mast.board' });
    else if (t === 'rx') ctx.action({ kind: 'mast.rx' });
    return true;
  }

  // ---------- host actions ----------
  const pose = { x: 0, y: 0, z: 0 };
  function poseOf(actor) {
    const p = actor === 'guest' ? ctx.other : ctx.physics;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || !st.at) return null;
    ground(gnd); mastRel(st.at, gnd.x, gnd.z, tmp);
    pose.x = p.x - tmp.x; pose.z = p.z - tmp.z; pose.y = Number.isFinite(p.y) ? p.y - baseY() : NaN;
    return pose;
  }
  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || a.kind.slice(0, 5) !== 'mast.') return false;
    if (!authority()) return true;
    if (a.kind === 'mast.rx') {
      const r = receiver(); if (!r) return true;
      st.on = st.on ? 0 : 1; bump(); hostTick(0); updateHud();
      const s = status(r);
      ctx.emit({ kind: 'notice', text: !st.on ? 'Receiver off' : s === 'live' ? 'Receiver on · the beacon mast pulses steadily' : s === 'antennas' ? `Receiver on · it needs ${MAST.ANTENNAS} antennas for a long-range signal` : 'Receiver on · it needs a charged battery within 3 tiles', sound: 'place' }, actor);
      return true;
    }
    if (a.kind === 'mast.crate') {
      const r = openCrate(st, a.i, poseOf(actor), actor, bag);
      if (r.ok) {
        bump(); model?.setCrates(st.crates);
        const loot = {}; for (const [k, n] of r.loot) loot[k] = (loot[k] || 0) + n;
        ctx.emit({ kind: 'loot', text: r.loot.map(([k, n]) => `+${n} ${itemName(k)}`).join(', '), loot }, actor);
        ctx.observe?.({ kind: 'gather', loot: r.loot }, actor);
      } else if (r.reason === 'full') ctx.emit({ kind: 'full', text: 'Your bag is full' }, actor);
      else if (r.reason === 'reach') ctx.emit({ kind: 'notice', text: 'Get a little closer' }, actor);
      return true;
    }
    if (a.kind === 'mast.board') {
      const r = readBoard(st, poseOf(actor), actor);
      if (r.ok) { bump(); ctx.emit({ kind: 'notice', text: r.first ? 'Keeper’s board copied into your logbook: a code and a bearing to the next light' : 'The keeper’s board is already in your logbook', sound: 'catch' }, 'all'); }
      else ctx.emit({ kind: 'notice', text: 'Get a little closer' }, actor);
      return true;
    }
    return true;
  }

  // ---------- module hooks ----------
  function update(dt) {
    if (!(dt > 0)) dt = 0;
    clock += dt;
    if (localCool > 0) localCool -= dt;
    if (ctx.running && authority()) hostTick(dt);
    place(); updateBlocker(); updateHud();
    if (model && shown) model.lampMat.emissiveIntensity = st.live ? 1.4 + Math.max(0, Math.sin(clock * 2.4)) * 1.6 : .5;
  }
  function serialize() {
    if (out && outRev === rev) return out;
    out = { v: 1, r: rev, seed: st.seed, at: st.at ? { bx: st.at.bx, bz: st.at.bz } : null, crates: st.crates.slice(), note: st.note, on: st.on, live: st.live, clue: st.clue ? { ...st.clue } : null };
    outRev = rev; return out;
  }
  function load(data, from) {
    if (from === 'net' && data && typeof data === 'object' && data.r === netR && data.seed === st.seed) return; // unchanged host state
    netR = from === 'net' && data && typeof data === 'object' ? data.r : -1;
    st = cleanMast(data); bump(); notesCache = null;
    model?.setCrates(st.crates); place();
  }

  // ---------- logbook (content.storyNotes) ----------
  let notesCache = null, notesFor = -1;
  function storyNotes() {
    if (!st.note) return NO_NOTES;
    if (notesCache && notesFor === rev) return notesCache;
    notesCache = [storyNote('mast1', st.clue)]; notesFor = rev; return notesCache;
  }

  function dispose() {
    blocker.r = 0; try { blockerOwner?.markBeacon?.(NaN, NaN); } catch {}
    if (model) { model.group.parent?.remove(model.group); model.dispose(); }
  }

  // ---------- QA helpers (raftDebug.content.mast) ----------
  const debug = {
    state: () => JSON.parse(JSON.stringify({ ...st, shown, dist, x: cx, z: cz, status: status(), hud: hud.label })),
    // Host QA: put the mast `d` metres away along (sin a, cos a) from the raft.
    spawnAt(d = 30, a = 0) {
      if (!authority()) return false;
      if (!st.seed) st.seed = 1234;
      ground(gnd); st.at = baseFrom(Math.sin(a) * d, Math.cos(a) * d, gnd.x, gnd.z); bump(); place(); updateBlocker(); return debug.state();
    },
    // Host QA: the real placement from the seed (as when the receiver first hears it).
    spawnReal(seed) { if (!authority()) return false; if (Number.isInteger(seed)) st.seed = seed >>> 0; st.at = null; st.on = 1; st.live = 1; hostTick(0); return debug.state(); },
    // Host QA: receiver + 3 antennas + a charged battery on free tiles of the raft, switched on.
    rig() {
      const w = ctx.world; if (!authority() || !w || !Array.isArray(w.tiles)) return false;
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (!w.tiles.some(t => t[0] === x && t[1] === z)) w.tiles.push([x, z]); // room for antennas 2 tiles out
      const free = w.tiles.filter(t => !w.decor.some(d => d.x === t[0] && d.z === t[1]));
      const put = (type, ok) => { const i = free.findIndex(ok); if (i < 0) return null; const [x, z] = free.splice(i, 1)[0]; const d = { type, x, z }; w.decor.push(d); return d; };
      const rx = receiver() || put('receiver', () => true); if (!rx) return false;
      while (antennaCount(w.decor, rx) < 3) if (!put('antenna', t => Math.max(Math.abs(t[0] - rx.x), Math.abs(t[1] - rx.z)) >= 2)) break;
      let bat = w.decor.find(d => d.type === 'battery' && Math.max(Math.abs(d.x - rx.x), Math.abs(d.z - rx.z)) <= MAST.RX_RANGE);
      if (!bat) bat = put('battery', t => Math.max(Math.abs(t[0] - rx.x), Math.abs(t[1] - rx.z)) <= MAST.RX_RANGE);
      ctx.rebuildRaft?.();
      if (bat) power()?.debug?.setCharge?.(bat.x, bat.z, 1800);
      st.on = 1; bump(); hostTick(0); return debug.state();
    },
    teleportTop() { return shown ? teleport(LADDER_TOP.x - .6, 0, MAST.DECK_Y) : false; },
    teleportFoot() { return shown ? teleport(LADDER_FOOT.x, LADDER_FOOT.z, MAST.PLAT_Y) : false; },
    // Yaw that faces the mast centre (or a deck-local point) from the local player.
    yawTo(lx = 0, lz = 0) { const p = ctx.physics; return p && st.at ? Math.atan2(-(cx + lx - p.x), -(cz + lz - p.z)) : null; },
    blocker: () => ({ ...blocker }),
    groundAt: (x, z, feetY) => { const g = shown ? surfaceAt(x - cx, z - cz, feetY - gy) : NaN; return g === g ? gy + g : NaN; },
    surf: () => ({ ...surf }),
    hud: () => ({ ...hud }),
    crates: () => CRATES.map((c, i) => ({ i, x: cx + c.x, y: gy + MAST.DECK_Y, z: cz + c.z, looted: st.crates[i] === 1 })),
    board: () => ({ x: cx + BOARD.x, y: gy + MAST.DECK_Y + 1.45, z: cz + BOARD.z }),
    draws: () => (model ? model.group.children.length : 0),
  };

  return {
    name: 'mast', update, afterMove, serialize, load, action, interact, prompt, debug, dispose,
    // Signal pill text for the local player, with its arrow for camera yaw `yaw` (game.js updateSignalHud). No allocation.
    beacon(yaw) {
      if (!hud.label) return null;
      if (hud.live) { const p = ctx.physics; bearing(cx, cz, p ? p.x : 0, p ? p.z : 0, yaw, read); hud.arrow = Math.round(read.arrow); }
      return hud;
    },
    storyNotes,
  };
}
