// Pim's Barge content module (docs/specs/trader.md §4). Slice: world.ext.trader. Host-authoritative action 'trader.trade'.
// Pim, a sea otter, brings a small barge alongside the bow every 10-14 min and swaps surplus goods for Bright Shells,
// and shells for rare goods, the Shell Wreath plan and the Glass Float. Pure rules live in trader-core.js.
import { TRADER as C, offersFor, nextDelay, pathAt, parkAt, cleanTrader, tradeCheck, applyTrade } from './trader-core.js';
import { ITEM_INFO } from './inventory-state.js';
import { buildBarge, buildShellWreath, buildGlassFloat } from './trader-model.js';

const SLEW_RATE = 2, SLEW_SNAP = 1, SINK = 1.2, PARK_SPEED = 1;
const ARRIVE = 'A little trading barge is bobbing this way!', CASTOFF = 'Pim is getting ready to cast off';
const easeOut = u => 1 - (1 - u) * (1 - u), easeIn = u => u * u;
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const mmss = s => { const n = Math.max(0, Math.ceil(s)); const m = Math.floor(n / 60), r = n % 60; return m + ':' + (r < 10 ? '0' : '') + r; };

export function createTrader(ctx) {
  const T = ctx.T;
  const has = k => Object.prototype.hasOwnProperty.call(ITEM_INFO, k);
  const name = k => ITEM_INFO[k]?.name ?? k;
  const host = () => ctx.role !== 'guest';
  let st = cleanTrader(undefined, has);
  let netR = -1, slew = 0, slewHold = 0, warned = false, disposed = false;
  let barge = null, wreath = null, float = null;
  let ui = null, uiLoading = null, uiFailed = false, uiVer = 0, uiSeed = null;
  const path = { phase: 'gone', u: 1, left: 0 };
  const park = { x: 0, z: 0 }, shown = { x: 0, z: 0 }; // target bow spot and the eased one
  let parkTiles = null, parkLen = -1, parkSet = false;
  const pos = { x: 0, y: 0, z: 0 }, stall = { x: 0, y: 0, z: 0 }; // barge centre and stall point (scene = raft-local x/z)
  let pSec = -1, pOut = null;
  const scratch = T ? new T.Vector3() : null;
  // serialize() output, reused (no steady-state allocation)
  const out = { v: 1, r: 0, clock: 0, next: 0, plans: [], visit: null };
  const outVisit = { seed: 0, born: 0, hold: 0, stock: [] };
  let outR = -1, outSt = null;

  const offers = () => (st.visit ? offersFor(st.visit.seed, has) : []);
  const posOf = actor => { if (actor === 'guest') return ctx.other ?? null; const p = ctx.physics; return p ? { x: p.x, z: p.z } : null; };
  const reachOf = actor => C.REACH + (actor === 'guest' ? C.GUEST_SLACK : 0);
  const distToStall = p => (p ? Math.hypot(p.x - stall.x, p.z - stall.z) : Infinity);
  const phaseNow = () => { const v = st.visit; if (!v) { path.phase = 'gone'; path.u = 1; path.left = 0; return path; } return pathAt(st.clock - v.born, v.hold, path); };
  const docked = () => phaseNow().phase === 'docked';
  const localInReach = () => distToStall(ctx.physics) <= C.REACH;
  const recalcWarned = () => { phaseNow(); warned = path.phase === 'depart' || (path.phase === 'docked' && path.left <= C.WARN); };

  // ---- placement (logic + visuals share it)
  function place(dt) {
    const tiles = ctx.world?.tiles;
    if (tiles !== parkTiles || (tiles && tiles.length !== parkLen)) { parkAt(tiles, park); parkTiles = tiles; parkLen = tiles ? tiles.length : -1; if (!parkSet) { shown.x = park.x; shown.z = park.z; parkSet = true; } }
    const step = PARK_SPEED * (dt > 0 ? dt : 0), dx = park.x - shown.x, dz = park.z - shown.z, d = Math.hypot(dx, dz);
    if (d <= step || d > 30) { shown.x = park.x; shown.z = park.z; } else if (d > 0) { shown.x += dx / d * step; shown.z += dz / d * step; }
    phaseNow();
    let x = shown.x, sink = 0;
    if (path.phase === 'approach') { x += C.LANE * (1 - easeOut(path.u)); sink = -SINK * (1 - clamp01((st.clock - st.visit.born) / C.RISE)); }
    else if (path.phase === 'depart') { x -= C.LANE * easeIn(path.u); const td = path.u * C.DEPART; sink = -SINK * clamp01((td - (C.DEPART - C.RISE)) / C.RISE); }
    pos.x = x; pos.z = shown.z;
    const deckY = ctx.deckY ? ctx.deckY() : .2, oc = ctx.ocean;
    const base = oc ? oc.getHeight(0, 0) : 0, h = oc ? oc.getHeight(pos.x, pos.z) : 0;
    pos.y = deckY - .22 + (h - base) * .6 + sink;
    stall.x = pos.x; stall.y = pos.y + .9; stall.z = pos.z + C.HALF_BEAM;
  }
  function visuals() {
    if (!T || !ctx.scene) return;
    if (path.phase === 'gone') { if (barge) barge.group.visible = false; return; }
    if (!barge) { barge = buildBarge(T); ctx.scene.add(barge.group); }
    const g = barge.group, oc = ctx.ocean;
    if (g.parent !== ctx.scene) ctx.scene.add(g);
    g.visible = true;
    g.position.set(pos.x, pos.y, pos.z);
    if (oc) {
      const hx = oc.getHeight(pos.x + 1, pos.z) - oc.getHeight(pos.x - 1, pos.z), hz = oc.getHeight(pos.x, pos.z + 1) - oc.getHeight(pos.x, pos.z - 1);
      g.rotation.z = Math.atan(hx * .5) * .6; g.rotation.x = -Math.atan(hz * .5) * .6;
    }
    const t = ctx.elapsed ?? 0;
    barge.pim.position.y = barge.pimY + Math.sin(t * 2) * .03;
    barge.pennant.rotation.y = Math.sin(t * 1.7) * .3 + Math.sin(t * 4.3) * .08;
  }

  // ---- host rules
  function notify(text, sound) { ctx.emit?.({ kind: 'notice', text, sound }, 'all'); }
  function spawn(seed, born) {
    const s = seed >>> 0, list = offersFor(s, has);
    st.visit = { seed: s, born, hold: 0, stock: list.map(o => o.stock) };
    st.r++; warned = false; uiVer++;
  }
  function someoneNear() {
    if (ui?.isOpen()) return true;
    const p = ctx.physics; if (p && Math.hypot(p.x - stall.x, p.z - stall.z) <= C.NEAR) return true;
    const o = ctx.other; return !!(o && Number.isFinite(o.x) && Math.hypot(o.x - stall.x, o.z - stall.z) <= C.NEAR);
  }
  function step(dt) { // host phase logic; dt 0 just settles phases
    const v = st.visit;
    if (!v) {
      if (st.clock >= st.next) { spawn(Math.random() * 2 ** 32 >>> 0, st.clock); notify(ARRIVE, 'catch'); }
      return;
    }
    pathAt(st.clock - v.born, v.hold, path);
    if (path.phase === 'docked') {
      if (dt > 0 && path.left <= C.WARN + 1 && v.hold < C.HOLD_MAX && someoneNear()) { v.hold = Math.min(C.HOLD_MAX, v.hold + dt); pathAt(st.clock - v.born, v.hold, path); }
      if (!warned && path.left <= C.WARN) { warned = true; notify(CASTOFF); }
    } else if (path.phase === 'depart') warned = true;
    else if (path.phase === 'gone') { st.next = st.clock + nextDelay(v.seed); st.visit = null; st.r++; uiVer++; }
  }

  function update(dt) {
    const d = dt > 0 && Number.isFinite(dt) ? dt : 0;
    if (ctx.running) {
      st.clock = Math.min(C.MAX_CLOCK, st.clock + d);
      if (host()) step(d);
      else {
        if (slew !== 0) { const k = Math.min(1, SLEW_RATE * d), e = slew * k; st.clock += e; slew -= e; if (Math.abs(slew) < 1e-4) { st.clock += slew; slew = 0; } }
        if (slewHold !== 0 && st.visit) { const k = Math.min(1, SLEW_RATE * d), e = slewHold * k; st.visit.hold += e; slewHold -= e; if (Math.abs(slewHold) < 1e-4) { st.visit.hold += slewHold; slewHold = 0; } }
      }
    }
    place(d);
    visuals();
    if (ui && ui.isOpen()) {
      const p = ctx.physics;
      if (path.phase !== 'docked' || uiSeed !== (st.visit ? st.visit.seed : null) || (p && distToStall(p) > C.CLOSE_DIST + C.REACH)) ui.close();
      else ui.tick();
    }
  }

  // ---- save / net
  function serialize() {
    out.r = st.r; out.clock = st.clock; out.next = st.next;
    if (st.r !== outR || st !== outSt) {
      out.plans.length = 0; for (let i = 0; i < st.plans.length; i++) out.plans.push(st.plans[i]);
      if (st.visit) { outVisit.stock.length = 0; for (let i = 0; i < st.visit.stock.length; i++) outVisit.stock.push(st.visit.stock[i]); }
      outR = st.r; outSt = st;
    }
    if (st.visit) { outVisit.seed = st.visit.seed; outVisit.born = st.visit.born; outVisit.hold = st.visit.hold; out.visit = outVisit; }
    else out.visit = null;
    return out;
  }
  function load(data, from) {
    if (from !== 'net') {
      st = cleanTrader(data, has); netR = -1; slew = 0; slewHold = 0; uiVer++; recalcWarned();
      return;
    }
    if (!data || typeof data !== 'object') { // host without the slice (older build)
      if (netR === -2) return;
      st = cleanTrader(undefined, has); netR = -2; slew = slewHold = 0; uiVer++;
      return;
    }
    const mySeed = st.visit ? st.visit.seed : null, myClock = st.clock, myHold = st.visit ? st.visit.hold : 0;
    const hc = Number.isFinite(data.clock) ? Math.min(C.MAX_CLOCK, Math.max(0, data.clock)) : myClock;
    const hSeed = data.visit && typeof data.visit === 'object' ? data.visit.seed : null;
    const hHold = data.visit && Number.isFinite(data.visit.hold) ? Math.min(C.HOLD_MAX, Math.max(0, data.visit.hold)) : 0;
    if (data.r !== netR) { st = cleanTrader(data, has); netR = data.r; uiVer++; }
    else if (Number.isFinite(data.next)) st.next = data.next;
    // Ease the clock and hold toward the host's when it is the same visit and close, else snap.
    const same = mySeed !== null && st.visit && st.visit.seed === mySeed && hSeed === mySeed;
    const err = hc - myClock;
    if ((same || (mySeed === null && !st.visit)) && Math.abs(err) <= SLEW_SNAP) { st.clock = myClock; slew = err; }
    else { st.clock = hc; slew = 0; }
    if (st.visit) {
      const he = hHold - myHold;
      if (same && Math.abs(he) <= SLEW_SNAP) { st.visit.hold = myHold; slewHold = he; }
      else { st.visit.hold = hHold; slewHold = 0; }
    } else slewHold = 0;
  }

  // ---- aim / prompt / interact
  function target(aim) {
    const p = ctx.physics, cam = ctx.camera; if (!p || !cam || !st.visit) return false;
    if (phaseNow().phase === 'gone' || path.phase === 'depart') return false;
    if (Math.hypot(p.x - stall.x, p.z - stall.z) > C.REACH + 4) return false;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else if (scratch) { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    else return false;
    const vx = stall.x - cam.position.x, vy = stall.y - cam.position.y, vz = stall.z - cam.position.z, along = vx * dx + vy * dy + vz * dz;
    if (along <= 0) return false;
    const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along;
    return Math.sqrt(ex * ex + ey * ey + ez * ez) <= 1.6;
  }
  function prompt(aim) {
    if (!target(aim)) return null;
    if (path.phase === 'approach') return 'Pim is still tying up…';
    if (!localInReach()) return 'Move a little closer to Pim';
    const sec = Math.ceil(path.left); // the prompt string changes once a second, not every frame
    if (sec !== pSec || !pOut) { pSec = sec; pOut = '<kbd>E</kbd>Trade with Pim (' + mmss(sec) + ')'; }
    return pOut;
  }
  function interact(aim) {
    if (!target(aim)) return false;
    if (path.phase === 'approach') return true;
    if (!localInReach()) { ctx.notice?.('Move a little closer to Pim'); return true; }
    openUI();
    return true;
  }

  // ---- UI
  const api = {
    offers, stock: () => (st.visit ? st.visit.stock : []), visitSeed: () => (st.visit ? st.visit.seed : null),
    left: () => (phaseNow().phase === 'docked' ? path.left : 0), bag: () => ctx.localBag?.() ?? null, plans: () => st.plans,
    rev: () => st.r * 1000 + (uiVer % 1000), running: () => !!ctx.running,
    check: i => tradeCheck(st, { kind: 'trader.trade', offer: i, visit: st.visit ? st.visit.seed : null }, ctx.localBag?.(), has, name),
    trade: i => { if (st.visit) ctx.action({ kind: 'trader.trade', offer: i, visit: st.visit.seed }); },
    esc: s => (ctx.esc ? ctx.esc(s) : String(s)), requestLock: () => ctx.requestLock?.(),
  };
  const canShow = () => !disposed && docked() && localInReach();
  function openUI() {
    if (disposed || uiFailed || typeof document === 'undefined') return false;
    ctx.releaseLock?.();
    if (ui) { if (canShow()) { uiSeed = st.visit.seed; ui.open(); } return true; }
    uiLoading ??= import('./trader-ui.js').then(m => { ui = m.createTraderUI(api); return ui; })
      .catch(e => { console.error('trader ui failed', e); uiFailed = true; uiLoading = null; return null; });
    uiLoading.then(u => { if (!u || disposed || ctx.uiOpen?.() || !canShow()) return; uiSeed = st.visit.seed; u.open(); });
    return true;
  }

  // ---- host action
  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('trader.')) return false;
    if (a.kind !== 'trader.trade' || !host()) return true;
    if (docked() && distToStall(posOf(actor)) > reachOf(actor)) { ctx.emit?.({ kind: 'notice', text: 'Get a bit closer to Pim' }, actor); return true; }
    const r = applyTrade(st, a, bag, has, name);
    if (r.ok) {
      uiVer++;
      if (r.offer.plan) notify('Shell Wreath plan learned!', 'craft');
      else if (r.offer.id === 'float') notify('Pim hands over a Glass Float', 'craft');
      else ctx.emit?.({ kind: 'loot', text: r.text }, actor);
    } else ctx.emit?.({ kind: r.reason === 'full' ? 'full' : 'notice', text: r.text }, actor);
    return true;
  }

  const debug = {
    state() { const s = JSON.parse(JSON.stringify(serialize())); phaseNow(); s.phase = path.phase; s.left = path.left; s.park = { ...park }; s.stall = { ...stall }; s.open = !!ui?.isOpen(); return s; },
    phase() { return phaseNow().phase; },
    offers() { return offers().map(o => JSON.parse(JSON.stringify(o))); },
    stock() { return st.visit ? [...st.visit.stock] : []; },
    summon(seed, dock = true) {
      if (!host()) return false;
      const s = Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff ? seed : Math.random() * 2 ** 32 >>> 0;
      spawn(s, dock ? Math.max(0, st.clock - C.APPROACH) : st.clock);
      if (dock && st.clock < C.APPROACH) { st.clock = C.APPROACH; st.visit.born = 0; }
      return true;
    },
    skip(sec) {
      if (!host()) return false;
      const n = Math.max(0, Math.min(3600, +sec || 0));
      st.clock = Math.min(C.MAX_CLOCK, st.clock + n); step(0); place(0);
      if (ui?.isOpen() && path.phase !== 'docked') ui.close();
      return true;
    },
    clear() { if (!host()) return false; st.visit = null; st.next = st.clock + C.FIRST; st.r++; uiVer++; return true; },
    give(kind, n = 10, who = 'host') { if (!host()) return false; const b = who === 'guest' ? ctx.actorBag?.('guest') : ctx.localBag?.(); return b ? n - b.add(kind, n) : 0; }, // who 'guest': QA for co-op trades
    trade(i) { if (!st.visit) return false; ctx.action({ kind: 'trader.trade', offer: i, visit: st.visit.seed }); return true; },
    aimAt() {
      const p = ctx.physics; if (!p || !st.visit) return false;
      place(0);
      p.x = shown.x; p.z = shown.z + C.HALF_BEAM + 2; // 2 m from the docked stall, on the bow row
      const dbg = globalThis.raftDebug, eye = (ctx.deckY ? ctx.deckY() : .2) + 1.6;
      dbg?.aim?.(Math.atan2(stall.y - eye, Math.max(.5, Math.hypot(stall.x - p.x, stall.z - p.z))), Math.atan2(-(stall.x - p.x), -(stall.z - p.z))); // yaw 0 looks toward -z
      return true;
    },
    open() { return docked() && localInReach() ? openUI() : false; },
    close() { ui?.close(); return true; },
  };

  return {
    name: 'trader',
    update, serialize, load, action, interact, prompt, debug,
    craftLocked(id) { return id === 'shellwreath' && !st.plans.includes('shellwreath') ? 'Buy the plan from Pim’s barge' : null; },
    decorModel(type) {
      if (!T) return null;
      if (type === 'shellwreath') { wreath ??= buildShellWreath(T); return wreath.instance(); }
      if (type === 'glassfloat') { float ??= buildGlassFloat(T); return float.instance(); }
      return null;
    },
    dispose() {
      disposed = true;
      try { ui?.dispose(); } catch {}
      ui = null;
      barge?.dispose(); wreath?.dispose(); float?.dispose();
      barge = wreath = float = null;
    },
  };
}
