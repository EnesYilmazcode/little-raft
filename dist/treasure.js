// Sandy Secrets content module: every visiting island hides 1-2 buried bundles. A held Seashell Finder
// ticks faster as you near one; a held Little Spade digs it up with E. Host-authoritative, saved in
// world.ext.treasure = {v, seed, dug[]}; spots come from the island seed (treasure-rules.js), so they go
// away with the island. Spec: docs/specs/treasure.md.
// Follow-up (not this round): a rare "bottle of notes" find would need a game.js hook into world.notes.
import { islandNow } from './islands.js?build=v3-survival-ae77fa84ac2b'; // same specifier as content.js: one shared instance
import { layoutFor, groundHeight } from './islands-layout.js';
import {
  TREASURE, spotsFor, beepInterval, closeness, warmth, DEFAULTS, clean, nearestSpot, applyDig, applyRepair,
} from './treasure-rules.js';
import { createMoundKit, setFinderGlow } from './treasure-models.js';
import { ITEM_INFO } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { repairCost } from './items.js';

const itemName = k => (ITEM_INFO[k] && ITEM_INFO[k].name) || k;
const COST_TEXT = Object.entries(repairCost('spade') || {}).map(([k, n]) => `${n} ${itemName(k)}`).join(', ');
const RING = 2 * Math.PI * 8, RING_TXT = RING.toFixed(2); // HUD arc circumference (r = 8)
const PUFF_T = 0.4, RISE_T = 0.5, HOLD_T = 1.0, SHRINK_T = 0.3;

export function createTreasure(ctx) {
  const T = ctx.T;
  let st = DEFAULTS();                              // {v, seed, dug[]}
  const out = { v: 1, seed: null, dug: [] };        // cached serialize() object
  const cool = { host: 0, guest: 0 };
  const digSt = { seed: null, cx: 0, cz: 0, clock: 0, cool, dug: null, spots: null, groundAt: null };
  let clock = 0, localCool = 0, acc = 0, pulse = 0, puffT = 0, popK = -1, popT = 0;
  let lastD = null, lastIv = Infinity, unprovide = null;

  // ---------- scene: 2 holes + 2 mounds + chest (2) + puff = 7 meshes ----------
  const kit = createMoundKit(T);
  const group = new T.Group(); group.name = 'treasure'; group.visible = false;
  const holes = [], mounds = [];
  for (let k = 0; k < TREASURE.MAX_SPOTS; k++) {
    const h = kit.hole(), m = kit.mound(); h.visible = m.visible = false;
    holes.push(h); mounds.push(m); group.add(h, m);
  }
  const chest = kit.chest(); chest.visible = false; group.add(chest);
  const puff = kit.puff(); puff.visible = false; group.add(puff);
  if (ctx.scene) ctx.scene.add(group);
  const shownDug = new Int8Array(TREASURE.MAX_SPOTS);
  const UP = new T.Vector3(0, 1, 0), vN = new T.Vector3(), qA = new T.Quaternion();

  const spotsNow = () => (st.seed === null ? [] : spotsFor(st.seed));
  // Lay a mesh flat on the dome at island-local (x, z): its sand height and the slope normal.
  function sit(o, lay, x, z, lift) {
    const g = (px, pz) => groundHeight(Math.hypot(px, pz), lay.R, Math.atan2(pz, px) - lay.rot);
    const e = 0.2, y = g(x, z);
    const gx = (g(x + e, z) - g(x - e, z)) / (2 * e), gz = (g(x, z + e) - g(x, z - e)) / (2 * e);
    vN.set(-gx, 1, -gz); if (vN.x === vN.x && vN.z === vN.z) vN.normalize(); else vN.copy(UP);
    qA.setFromUnitVectors(UP, vN);
    o.quaternion.copy(qA);
    o.position.set(x, (y === y ? y : 0) + lift, z);
  }
  // Show the hole + mound of each dug spot. live: a 0 -> 1 change pops the chest there.
  function syncMounds(live = false) {
    const spots = spotsNow(), lay = st.seed === null ? null : layoutFor(st.seed);
    for (let k = 0; k < TREASURE.MAX_SPOTS; k++) {
      const s = spots[k], dug = !!(s && st.dug[k]);
      if (dug) {
        sit(holes[k], lay, s.x, s.z, 0.02);
        const r = Math.hypot(s.x, s.z) || 1, mx = s.x - (s.x / r) * 0.5, mz = s.z - (s.z / r) * 0.5;
        sit(mounds[k], lay, mx, mz, -0.02);
        if (live && !shownDug[k]) { popK = k; popT = 0; chest.position.set(s.x, s.y, s.z); chest.scale.setScalar(1); chest.visible = true; }
      }
      holes[k].visible = mounds[k].visible = dug;
      shownDug[k] = dug ? 1 : 0;
    }
    if (popK >= 0 && !(spots[popK] && st.dug[popK])) { popK = -1; chest.visible = false; }
  }

  const authority = () => ctx.role !== 'guest';
  // Dig cooldowns run on wall time: a hidden host tab has no frames (clock stops) but still applies guest actions.
  const wallClock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() / 1000 : clock);
  const selectedSlot = () => { const b = ctx.localBag ? ctx.localBag() : null; return b && b.slots ? b.slots[b.selectedIndex] || null : null; };
  const heldKind = () => { const s = selectedSlot(); return s ? s.kind : null; };
  const live = () => { const n = islandNow(); return n && st.seed !== null && n.seed === st.seed ? n : null; };
  // Horizontal distance from the local player to the nearest undug spot, or null.
  function nearestDist(now) {
    const p = ctx.physics; if (!now || !p) return null;
    const spots = spotsFor(st.seed); let best = Infinity;
    for (let k = 0; k < spots.length; k++) {
      if (st.dug[k]) continue;
      const d = Math.hypot(p.x - (now.cx + spots[k].x), p.z - (now.cz + spots[k].z));
      if (d < best) best = d;
    }
    return best === Infinity ? null : best;
  }
  const canDig = now => !!now && now.onSand && now.hover < 0 && !(ctx.physics && ctx.physics.swimming);
  const nearHere = now => { const p = ctx.physics; return p ? nearestSpot(spotsFor(st.seed), st.dug, p.x - now.cx, p.z - now.cz, TREASURE.DIG_REACH) : -1; };

  // ---------- HUD (#treasureHud), built lazily ----------
  let hud = null, hudText = null, hudArc = null, hudDot = null, hudShown = false, hudStr = '', hudDash = -1, hudScale = -1;
  function showHud(on) {
    if (!hud || on === hudShown) return;
    hudShown = on; hud.style.display = on ? 'flex' : 'none';
  }
  function updateHud(d) {
    if (typeof document === 'undefined' || !document.body) return;
    if (!hud) {
      hud = document.createElement('div'); hud.id = 'treasureHud'; hud.setAttribute('role', 'status');
      hud.style.cssText = 'position:fixed;left:50%;top:12%;transform:translateX(-50%);padding:4px 12px;border-radius:8px;background:rgba(8,22,36,.6);color:#f6ecd6;font:700 15px/1.3 system-ui,sans-serif;pointer-events:none;z-index:30;white-space:nowrap;display:flex;gap:8px;align-items:center';
      hud.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="8" fill="none" stroke="rgba(246,236,214,.25)" stroke-width="3"/>'
        + `<circle cx="11" cy="11" r="8" fill="none" stroke="#ffbd66" stroke-width="3" stroke-linecap="round" stroke-dasharray="0 ${RING.toFixed(2)}" transform="rotate(-90 11 11)"/>`
        + '<circle cx="11" cy="11" r="2.8" fill="#ffbd66" style="transform-origin:11px 11px"/></svg><span></span>';
      const c = hud.querySelectorAll('circle'); hudArc = c[1]; hudDot = c[2]; hudText = hud.querySelector('span');
      hudShown = true; document.body.append(hud);
    }
    const text = warmth(d);
    if (text !== hudStr) { hudStr = text; hudText.textContent = text; }
    // compare rounded numbers, build strings only on a change (no per-frame garbage)
    const arc = Math.round(closeness(d === null ? Infinity : d) * RING * 10);
    if (arc !== hudDash) { hudDash = arc; hudArc.setAttribute('stroke-dasharray', `${arc / 10} ${RING_TXT}`); }
    const sc = Math.round(pulse * 50); // scale 1 + .5 * pulse to 2 decimals
    if (sc !== hudScale) { hudScale = sc; hudDot.style.transform = `scale(${1 + sc / 100})`; }
    showHud(true);
  }

  // ---------- raftPrompts provider (the #contextPrompt text is hidden by prompts.css) ----------
  function providerPrompt(c) {
    const s = c && c.state;
    if (!s || !s.running || s.pickup || (s.role === 'guest' && !s.networkReady) || s.swimming || s.heldKind !== 'spade') return null;
    const now = live(); if (!canDig(now)) return null;
    const sel = selectedSlot();
    if (sel && sel.kind === 'spade' && !((sel.durability ?? 100) > 0)) return { label: 'Spade worn out · R fixes it', muted: true };
    return nearHere(now) >= 0 ? { key: 'E', label: 'Dig here!' } : { key: 'E', label: 'Dig in the sand' };
  }
  function ensureProvider() {
    if (unprovide || typeof window === 'undefined') return;
    const rp = window.raftPrompts;
    if (rp && typeof rp.provide === 'function') { try { unprovide = rp.provide({ id: 'treasure', priority: 1, prompt: providerPrompt }); } catch { unprovide = () => {}; } }
  }
  ensureProvider();

  // ---------- module hooks ----------
  function update(dt) {
    if (!(dt > 0)) dt = 0;
    clock += dt; if (localCool > 0) localCool -= dt;
    if (!unprovide) ensureProvider();
    const isl = islandNow();
    if (authority()) {
      const seed = isl ? isl.seed : null;
      if (seed !== st.seed) { st.seed = seed; st.dug = seed === null ? [] : spotsFor(seed).map(() => 0); syncMounds(false); }
    }
    const now = live();
    group.visible = !!now;
    if (now) group.position.set(now.cx, now.gy, now.cz);
    // chest pop: rise, hold, shrink away
    if (popK >= 0) {
      popT += dt;
      const s = spotsNow()[popK];
      if (!s) { popK = -1; chest.visible = false; }
      else if (popT < RISE_T) { const u = popT / RISE_T; chest.position.y = s.y - 0.15 + 0.5 * (1 - (1 - u) * (1 - u)); chest.rotation.y = u * 0.6; }
      else if (popT < RISE_T + HOLD_T) chest.position.y = s.y + 0.35 + 0.02 * Math.sin((popT - RISE_T) * 6);
      else if (popT < RISE_T + HOLD_T + SHRINK_T) chest.scale.setScalar(Math.max(1e-3, 1 - (popT - RISE_T - HOLD_T) / SHRINK_T));
      else { popK = -1; chest.visible = false; chest.scale.setScalar(1); }
    }
    // sand puff at the digger's feet
    if (puffT > 0) {
      puffT -= dt;
      const p = ctx.physics;
      if (puffT <= 0 || !now || !p) { puffT = 0; puff.visible = false; }
      else {
        const u = 1 - puffT / PUFF_T, g = now.groundAt(p.x, p.z);
        const yaw = ctx.camera ? ctx.camera.rotation.y : 0; // half a metre in front of the feet
        puff.position.set(p.x - now.cx - 0.5 * Math.sin(yaw), (g === g ? g : now.gy) - now.gy + 0.1 + 0.25 * u, p.z - now.cz - 0.5 * Math.cos(yaw));
        puff.scale.setScalar(0.4 + 0.9 * u);
        kit.mats.puff.opacity = 0.75 * (1 - u);
        puff.visible = true;
      }
    }
    // finder: local beeps + HUD (never emitted)
    const finder = !!ctx.running && heldKind() === 'finder';
    pulse *= Math.pow(0.85, dt * 60);
    if (!finder) { acc = 0; lastD = null; lastIv = Infinity; showHud(false); return; }
    const d = now ? nearestDist(now) : null;
    const iv = d === null ? Infinity : beepInterval(d);
    lastD = d; lastIv = iv; acc += dt;
    setFinderGlow(0.25 + 1.6 * closeness(d === null ? Infinity : d) + 0.8 * pulse); // held bead glows warmer when near
    if (iv === 0) { if (acc >= 1.2) { acc = 0; pulse = 1; if (ctx.play) ctx.play('chime', 0.8); } }
    else if (iv > 0 && iv !== Infinity && acc >= iv) { acc = 0; pulse = 1; if (ctx.play) ctx.play('detect', closeness(d)); }
    else if (iv === Infinity) acc = 0;
    updateHud(d);
  }

  function serialize() {
    out.seed = st.seed;
    if (out.dug.length !== st.dug.length) out.dug.length = st.dug.length;
    for (let k = 0; k < st.dug.length; k++) out.dug[k] = st.dug[k];
    return out;
  }

  function load(data, from) {
    const c = clean(data);
    let same = c.seed === st.seed && c.dug.length === st.dug.length;
    const sameSeed = c.seed === st.seed;
    if (same) for (let k = 0; k < c.dug.length; k++) if (c.dug[k] !== st.dug[k]) { same = false; break; }
    if (same) return;
    st = c;
    syncMounds(from === 'net' && sameSeed);
  }

  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || a.kind.slice(0, 9) !== 'treasure.') return false;
    if (!authority()) return true;
    if (a.kind === 'treasure.dig') {
      const now = live(), pos = actor === 'guest' ? ctx.other : ctx.physics;
      digSt.seed = now ? st.seed : null; digSt.spots = now ? spotsFor(st.seed) : null; digSt.dug = st.dug;
      digSt.cx = now ? now.cx : 0; digSt.cz = now ? now.cz : 0; digSt.groundAt = now ? now.groundAt : null; digSt.clock = wallClock();
      const r = applyDig(digSt, a, actor, pos, bag);
      if (r.ok) {
        syncMounds(true);
        const loot = {}; for (const [k, n] of r.loot) loot[k] = (loot[k] || 0) + n;
        const rows = r.loot.map(([k, n]) => `+${n} ${itemName(k)}`).join(', ');
        if (r.spot >= 0) ctx.emit({ kind: 'notice', text: 'You dug up a little bundle!', sound: 'chime' }, actor);
        ctx.emit({ kind: 'loot', text: r.spot >= 0 ? 'You dug up a little bundle! ' + rows : rows, loot, sound: r.spot >= 0 ? 'collect' : 'chime' }, actor);
      } else if (r.reason === 'full') ctx.emit({ kind: 'full', text: 'Your bag is full' }, actor);
      else if (r.reason === 'stale' || r.reason === 'none') ctx.emit({ kind: 'notice', text: 'The island drifted off' }, actor);
      else if (r.reason === 'reach') ctx.emit({ kind: 'notice', text: 'Get a little closer' }, actor);
      else if (r.reason === 'worn') ctx.emit({ kind: 'notice', text: `Your spade is worn out. R fixes it (${COST_TEXT})` }, actor);
      else if (r.reason === 'dug') ctx.emit({ kind: 'notice', text: 'Someone already dug here' }, actor);
      // 'cooldown' is ignored quietly
      return true;
    }
    if (a.kind === 'treasure.repair') {
      const r = applyRepair(bag);
      if (r.ok) ctx.emit({ kind: 'build', text: 'Spade repaired!', sound: 'repair' }, actor);
      else if (r.reason === 'fine') ctx.emit({ kind: 'notice', text: 'Your spade is in great shape' }, actor);
      else if (r.reason === 'cost') ctx.emit({ kind: 'notice', text: `Spade repair needs ${COST_TEXT}` }, actor);
      else ctx.emit({ kind: 'notice', text: 'Hold the spade to repair it' }, actor);
      return true;
    }
    return true;
  }

  function startPuff() { puffT = PUFF_T; }
  function interact() {
    if (heldKind() !== 'spade') return false;
    const now = live(); if (!canDig(now)) return false;
    if (localCool > 0) return true;
    const sent = ctx.action({ kind: 'treasure.dig', seed: now.seed, spot: nearHere(now) });
    if (sent === false) return true;
    localCool = TREASURE.COOLDOWN; startPuff();
    return true;
  }
  function prompt() {
    if (heldKind() !== 'spade' || !canDig(live())) return null;
    return '<kbd>E</kbd> Dig';
  }

  function dispose() {
    if (unprovide) { try { unprovide(); } catch {} unprovide = null; }
    if (group.parent) group.parent.remove(group);
    kit.dispose();
    if (hud) { hud.remove(); hud = null; }
  }

  // ---------- QA helpers (raftDebug.content.treasure) ----------
  const debug = {
    spots() {
      const now = islandNow(), sp = spotsNow();
      return sp.map((s, i) => ({ i, kind: s.kind, dug: st.dug[i] || 0, lx: s.x, lz: s.z, x: (now ? now.cx : 0) + s.x, y: (now ? now.gy : 0) + s.y, z: (now ? now.cz : 0) + s.z }));
    },
    kit() {
      if (!authority()) return false;
      const b = ctx.localBag(); if (!b) return false;
      for (const k of ['finder', 'spade']) if (!b.count(k)) b.add(k, 1);
      return debug.select('spade');
    },
    select(kind) {
      const b = ctx.localBag(); if (!b) return false;
      let i = b.slots.findIndex(s => s && s.kind === kind);
      if (i < 0) return false;
      if (i >= 8) { let j = b.slots.findIndex((s, n) => n < 8 && !s); if (j < 0) j = 7; b.move(i, j); i = j; }
      b.select(i); return true;
    },
    standAt(i = 0, off = 1.2) {
      const s = spotsNow()[i], I = typeof window !== 'undefined' ? window.raftDebug?.content?.islands : null;
      if (!s || !I) return false;
      if (!I.teleportAshore(s.x + off, s.z)) return false;
      const p = ctx.physics, now = islandNow();
      return { ok: true, yaw: Math.atan2(-((now.cx + s.x) - p.x), -((now.cz + s.z) - p.z)) };
    },
    dig(i = 0) { const sent = ctx.action({ kind: 'treasure.dig', seed: st.seed, spot: i }); if (sent !== false) startPuff(); return sent; },
    state: () => ({ seed: st.seed, dug: [...st.dug], d: lastD, iv: lastIv, hud: hudShown ? hudStr : null }),
    chestUp: () => chest.visible,
    clear() { st = DEFAULTS(); syncMounds(false); return { seed: st.seed, dug: [...st.dug] }; },
  };

  return { name: 'treasure', update, serialize, load, action, interact, prompt, debug, dispose };
}
