// Spear + foundation repair glue for game.js (fidelity lane C). Keeps game.js edits to a few one-line hooks.
// Rules live in spear.js / repair.js (pure, tested); this file owns the viewmodels, thrust animation,
// hit marker, repair prompt and the host-side actions 'spearHit' / 'repairTile'.
//
// ctx (all getters so hot swaps and role changes are picked up):
//   T, camera(), raft(), world(), physics(), other(), localBag(), role(), elapsed(), shark()
//   createHands(T, model), holdable(model, grip, opts), action(a), emit(e, to), notice(text), beep(f), setSwing(v)
import { createSpear } from './spear-model.js';
import { isSpear, spearDamage, canThrust, thrust, wearSpearSlot, SPEAR_REACH } from './spear.js';
import { hasTileAt, repairTile, hpBarText, tileHpOf, TILE_MAX_HP, TILE_REPAIR_COST } from './repair.js';
import { inReach, BUILD_REACH, GUEST_REACH_SLACK } from './build-rules.js?build=v3-survival-ae77fa84ac2b';

const POKE_TIME = 0.32; // seconds of the visible jab (cooldown is longer: SPEAR_COOLDOWN)

export function attachSpearRepair(ctx) {
  const { T } = ctx;
  let woodHands = null, metalHands = null;
  let lastThrust = -Infinity, poke = 0, pinnedPoke = -1, repairAim = null, markerEl = null, markerTimer = 0;
  const camPos = new T.Vector3(), camDir = new T.Vector3(), aimScratch = { x: 0, z: 0, hp: 0, pct: 0 };

  // ---------- viewmodels ----------
  function buildViewmodels() {
    const make = (metal) => {
      const model = createSpear(T, { metal });
      // Held low on the right, point forward and a little up/left, like a ready jab.
      const w = ctx.holdable(model, model.userData.grip, { rx: -1.32, ry: 0.0, rz: 0.16, scale: 0.62 });
      const hands = ctx.createHands(T, w);
      hands.group.userData.spear = model; model.userData.restY = model.position.y; // jab slides the spear along its shaft
      return { hands };
    };
    const a = make(false), b = make(true);
    woodHands = a.hands; metalHands = b.hands;
    handList.length = 0; handList.push(woodHands, metalHands);
    return [woodHands, metalHands];
  }
  const handList = [];
  const hands = () => handList; // cached: game.js spreads it every frame
  const rawKind = () => { const b = ctx.localBag(); return b.slots[b.selectedIndex]?.kind ?? null; };
  /** Viewmodel for the held kind, or null when it is not a spear. */
  function viewmodelFor(kind) {
    if (kind !== 'spear') return null;
    return rawKind() === 'metalspear' ? metalHands : woodHands;
  }
  /** Per-frame viewmodel update (no allocations): the arm lunges a little and the spear slides forward through the fist. */
  function updateViewmodel(vm, vp) {
    if (!vm || (vm !== woodHands && vm !== metalHands)) return false;
    poke = pinnedPoke >= 0 ? pinnedPoke : Math.max(0, poke - vp.dt / POKE_TIME);
    const p = 1 - poke; // 0 -> 1 over the jab
    const jab = poke > 0 ? (p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7) : 0;
    const e = jab * jab * (3 - 2 * jab);
    vm.group.position.set(-0.008 * e, 0.012 * e, -0.035 * e); // slight arm lunge (more reveals the sleeves)
    const spear = vm.group.userData.spear; spear.position.y = spear.userData.restY + 0.5 * e; // spear shoots forward through the grip
    vp.casting = 0; // the hook-cast arm swing would fight the jab
    vm.update(vp);
    return true;
  }

  // ---------- thrust ----------
  function hitMarker() {
    if (typeof document === 'undefined') return;
    if (!markerEl) {
      markerEl = document.createElement('div'); markerEl.id = 'spearHitMarker'; markerEl.setAttribute('aria-hidden', 'true');
      markerEl.style.cssText = 'position:fixed;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;pointer-events:none;z-index:4;opacity:0;transition:opacity .18s ease-out';
      markerEl.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><g stroke="#fff6dc" stroke-width="2.4" stroke-linecap="round"><path d="M3 3 L8 8 M19 3 L14 8 M3 19 L8 14 M19 19 L14 14"/></g></svg>';
      document.body.appendChild(markerEl);
    }
    markerEl.style.transition = 'none'; markerEl.style.opacity = '1';
    clearTimeout(markerTimer);
    markerTimer = setTimeout(() => { if (markerEl) { markerEl.style.transition = 'opacity .18s ease-out'; markerEl.style.opacity = '0'; } }, 220);
  }
  /** LMB with a spear held. Returns true when the click was handled. */
  function use() {
    const bag = ctx.localBag(), idx = bag.selectedIndex, slot = bag.slots[idx];
    if (!slot || !isSpear(slot.kind)) return false;
    const now = ctx.elapsed();
    if (!canThrust(now, lastThrust)) return true;
    if (!(slot.durability > 0)) { ctx.notice('This spear is worn out'); return true; }
    lastThrust = now; poke = 1; ctx.beep(190);
    const cam = ctx.camera();
    cam.getWorldPosition(camPos); cam.getWorldDirection(camDir);
    const shark = ctx.shark();
    const r = thrust(slot, (dmg) => shark?.trySpear?.(camPos, camDir, SPEAR_REACH, dmg) === true);
    if (r.hit) { hitMarker(); ctx.beep(120); ctx.action({ kind: 'spearHit', slot: idx }); }
    return true;
  }

  // ---------- repair ----------
  /** Called once per frame with the held tool role and frame aim; caches the damaged tile under the crosshair. */
  function updateAim(kind, aim) {
    repairAim = null;
    if (kind !== 'hammer' || !aim?.point) return;
    const x = Math.round(aim.point.x / 2), z = Math.round(aim.point.z / 2), ph = ctx.physics();
    const w = ctx.world();
    if (!inReach(ph.x, ph.z, x, z) || !hasTileAt(w, x, z)) return;
    const hp = tileHpOf(w, x, z); if (hp >= TILE_MAX_HP) return;
    aimScratch.x = x; aimScratch.z = z; aimScratch.hp = hp; aimScratch.pct = Math.round(hp); repairAim = aimScratch; // no per-frame allocation
  }
  const aimedRepair = () => repairAim;
  /** Crosshair prompt (dist/prompts.js provider format): repair the aimed damaged tile, or jab with a spear. */
  function prompt(state) {
    if (repairAim) {
      const bag = ctx.localBag(), ok = Object.entries(TILE_REPAIR_COST).every(([k, n]) => bag.count(k) >= n);
      const bar = hpBarText(repairAim.hp);
      return ok ? { key: 'LMB', label: 'Repair (1 plank) ' + bar } : { label: 'Repair needs 1 plank ' + bar, muted: true };
    }
    if (!state?.pickup && isSpear(rawKind())) return { key: 'LMB', label: 'Jab' };
    return null;
  }
  let unprovide = null;
  function providePrompt() { // prompts.js may load after us: retried from tick() until it exists
    if (unprovide || typeof window === 'undefined') return;
    try { const p = window.raftPrompts; if (p?.provide) unprovide = p.provide({ id: 'spear-repair', priority: 1, prompt: (c) => prompt(c?.state) }); } catch {}
  }
  /** LMB with the hammer: repairs the aimed damaged tile. Returns true when handled. */
  function useHammer() {
    if (!repairAim) return false;
    const bag = ctx.localBag();
    if (!Object.entries(TILE_REPAIR_COST).every(([k, n]) => bag.count(k) >= n)) { ctx.notice('Repair needs 1 plank'); return true; }
    ctx.setSwing(1);
    ctx.action({ kind: 'repairTile', x: repairAim.x, z: repairAim.z });
    return true;
  }

  // ---------- host actions ----------
  /** Host side. Returns true when the action was one of ours. */
  function apply(a, actor, bag) {
    if (a.kind === 'spearHit') {
      const i = Number.isInteger(a.slot) && bag.slots[a.slot] && isSpear(bag.slots[a.slot].kind) ? a.slot
        : bag.slots.findIndex((s) => s && isSpear(s.kind));
      if (i < 0) return true;
      const w = wearSpearSlot(bag.slots[i]);
      if (w?.broke) { bag.slots[i] = null; bag.version++; ctx.emit({ kind: 'notice', text: 'Your spear snapped!' }, actor); }
      else if (w) bag.version++;
      return true;
    }
    if (a.kind === 'repairTile') {
      if (!Number.isInteger(a.x) || !Number.isInteger(a.z)) return true;
      if (bag.count('hammer') < 1) { ctx.emit({ kind: 'notice', text: 'Craft a hammer first' }, actor); return true; }
      const who = actor === 'guest' ? ctx.other() : ctx.physics();
      if (who && !inReach(who.x, who.z, a.x, a.z, BUILD_REACH + (actor === 'guest' ? GUEST_REACH_SLACK : 0.01))) return true;
      const r = repairTile(ctx.world(), a.x, a.z, bag);
      if (r.ok) { bag.version++; ctx.emit({ kind: 'build', text: r.hp >= TILE_MAX_HP ? 'Foundation good as new' : `Foundation repaired: ${Math.round(r.hp)}%` }, 'all'); }
      else if (r.reason === 'cost') ctx.emit({ kind: 'notice', text: 'Repair needs 1 plank' }, actor);
      return true;
    }
    return false;
  }

  // The damaged-tile darkening is drawn by the shark module (one instanced draw call, dist/shark.js), not here.
  function tick() { if (!unprovide) providePrompt(); }

  // ---------- debug ----------
  function give(kind, n = 1) {
    if (ctx.role() === 'guest') return 0;
    const bag = ctx.localBag();
    try { return bag.add(String(kind), Math.max(1, Math.floor(Number(n) || 1))); } catch { return -1; }
  }
  function setTileHp(x, z, v) {
    if (ctx.role() === 'guest') return;
    const w = ctx.world(); if (!w.tileHp || typeof w.tileHp !== 'object') w.tileHp = {};
    const h = Number(v); if (!Number.isFinite(h) || h >= TILE_MAX_HP) delete w.tileHp[x + ',' + z]; else w.tileHp[x + ',' + z] = Math.max(1, h); // 0 would be a broken tile that is still there (saves clamp to 1 too)
  }
  /** Test helper: act as if the held spear just landed a hit (marker, sound, host wear). */
  function testHit() {
    const bag = ctx.localBag(), idx = bag.selectedIndex;
    if (!isSpear(bag.slots[idx]?.kind)) return false;
    hitMarker(); ctx.beep(120); ctx.action({ kind: 'spearHit', slot: idx }); return true;
  }
  /** Test helper: hold the jab at phase p (0..1, 1 = start) for screenshots; null releases it. */
  const pinPoke = (p) => { pinnedPoke = p == null ? -1 : Math.min(1, Math.max(0, Number(p) || 0)); };
  const debug = () => ({ lastThrust, poke, repairAim: repairAim ? { ...repairAim } : null, damage: spearDamage(rawKind()) });

  function dispose() {
    clearTimeout(markerTimer); markerEl?.remove(); markerEl = null;
    try { unprovide?.(); } catch {} unprovide = null;
    for (const h of hands()) { try { h.dispose?.(); } catch {} h.group.parent?.remove(h.group); }
  }

  return { buildViewmodels, hands, viewmodelFor, updateViewmodel, use, updateAim, aimedRepair, prompt, useHammer, apply, tick, give, setTileHp, testHit, pinPoke, debug, dispose };
}
