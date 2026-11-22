// Trading posts content module (docs/specs/trader.md §4). Slice: world.ext.trader. Host-authoritative action 'trader.trade'.
// Like Raft, trading happens at a small stall on some of the larger islands (trader-core.js isPostIsland / postFor, a
// pure function of the island seed, so host and guest place the same post with no messages). Walk up to the counter
// and press E to swap surplus goods for Bright Shells, and shells for rare goods, the Shell Wreath plan and the
// Glass Float. The island comes from islands.js islandNow(); islands.js itself is not touched.
import { TRADER as C, offersFor, postFor, cleanTrader, openVisit, tradeCheck, applyTrade } from './trader-core.js?build=v3-survival-ae77fa84ac2b';
import { ITEM_INFO } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { islandNow } from './islands.js?build=v3-survival-ae77fa84ac2b'; // same specifier as content.js: one shared instance
import { buildStall, buildShellWreath, buildGlassFloat } from './trader-model.js?build=v3-survival-ae77fa84ac2b';

const PROMPT = '<kbd>E</kbd>Trade', CLOSER = 'Move a little closer to the counter';
const COUNTER_OUT = .7, COUNTER_Y = 1.0; // the aim point: in front of the stall, at counter height

export function createTrader(ctx) {
  const T = ctx.T;
  const has = k => Object.prototype.hasOwnProperty.call(ITEM_INFO, k);
  const name = k => ITEM_INFO[k]?.name ?? k;
  const host = () => ctx.role !== 'guest';
  let st = cleanTrader(undefined, has);
  let netR = -1, disposed = false;
  let stallM = null, wreath = null, float = null;
  let ui = null, uiLoading = null, uiFailed = false, uiVer = 0, uiSeed = null;
  // the post in view: island seed (null when none) and the counter point in scene (raft-local) metres
  let postSeed = null;
  const stall = { x: 0, y: 0, z: 0 };
  const scratch = T ? new T.Vector3() : null;
  // serialize() output, reused (no steady-state allocation)
  const out = { v: 1, r: 0, plans: [], visit: null };
  const outVisit = { seed: 0, stock: [] };
  let outR = -1, outSt = null;

  const offers = () => (st.visit ? offersFor(st.visit.seed, has) : []);
  const posOf = actor => { if (actor === 'guest') return ctx.other ?? null; const p = ctx.physics; return p ? { x: p.x, z: p.z } : null; };
  const reachOf = actor => C.REACH + (actor === 'guest' ? C.GUEST_SLACK : 0);
  const distToStall = p => (p ? Math.hypot(p.x - stall.x, p.z - stall.z) : Infinity);
  const open = () => postSeed !== null && !!st.visit && st.visit.seed === postSeed; // a post in view with its stock
  const localInReach = () => distToStall(ctx.physics) <= C.REACH;
  const liveIsland = () => (ctx.islandNow ? ctx.islandNow() : islandNow()); // ctx.islandNow: a seam for unit tests

  // ---- placement: the post of the island in view, if it has one
  function place() {
    const isl = liveIsland(), post = isl ? postFor(isl.seed) : null;
    if (!post) { postSeed = null; if (stallM) stallM.group.visible = false; return null; }
    postSeed = isl.seed;
    const sx = Math.sin(post.yaw), sz = Math.cos(post.yaw);
    stall.x = isl.cx + post.x + sx * COUNTER_OUT; stall.z = isl.cz + post.z + sz * COUNTER_OUT; stall.y = isl.gy + post.y + COUNTER_Y;
    if (T && ctx.scene) {
      if (!stallM) { stallM = buildStall(T); ctx.scene.add(stallM.group); }
      const g = stallM.group;
      if (g.parent !== ctx.scene) ctx.scene.add(g);
      g.position.set(isl.cx + post.x, isl.gy + post.y - .05, isl.cz + post.z); g.rotation.y = post.yaw;
      g.visible = true;
    }
    return post;
  }

  // ---- host rules: one visit (seeded offers + stock) per post island while it is in view
  function step() {
    if (postSeed === null) { if (st.visit) { st.visit = null; st.r++; uiVer++; } return; }
    if (!st.visit || st.visit.seed !== postSeed) { st.visit = openVisit(postSeed, has); st.r++; uiVer++; }
  }

  function update() {
    place();
    if (ctx.running && host()) step();
    if (ui && ui.isOpen()) {
      const p = ctx.physics;
      if (!open() || uiSeed !== st.visit.seed || (p && distToStall(p) > C.CLOSE_DIST + C.REACH)) ui.close();
      else ui.tick();
    }
  }

  // ---- save / net
  function serialize() {
    out.r = st.r;
    if (st.r !== outR || st !== outSt) {
      out.plans.length = 0; for (let i = 0; i < st.plans.length; i++) out.plans.push(st.plans[i]);
      if (st.visit) { outVisit.stock.length = 0; for (let i = 0; i < st.visit.stock.length; i++) outVisit.stock.push(st.visit.stock[i]); }
      outR = st.r; outSt = st;
    }
    if (st.visit) { outVisit.seed = st.visit.seed; out.visit = outVisit; }
    else out.visit = null;
    return out;
  }
  function load(data, from) {
    if (from !== 'net') { st = cleanTrader(data, has); netR = -1; uiVer++; return; }
    if (!data || typeof data !== 'object') { // host without the slice (older build)
      if (netR === -2) return;
      st = cleanTrader(undefined, has); netR = -2; uiVer++;
      return;
    }
    if (data.r !== netR) { st = cleanTrader(data, has); netR = data.r; uiVer++; }
  }

  // ---- aim / prompt / interact
  function target(aim) {
    const p = ctx.physics, cam = ctx.camera; if (!p || !cam || !open()) return false;
    if (distToStall(p) > C.REACH + 4) return false;
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
    return localInReach() ? PROMPT : CLOSER;
  }
  function interact(aim) {
    if (!target(aim)) return false;
    if (!localInReach()) { ctx.notice?.(CLOSER); return true; }
    openUI();
    return true;
  }

  // ---- UI
  const api = {
    offers, stock: () => (st.visit ? st.visit.stock : []), visitSeed: () => (st.visit ? st.visit.seed : null),
    bag: () => ctx.localBag?.() ?? null, plans: () => st.plans,
    rev: () => st.r * 1000 + (uiVer % 1000), running: () => !!ctx.running,
    check: i => tradeCheck(st, { kind: 'trader.trade', offer: i, visit: st.visit ? st.visit.seed : null }, ctx.localBag?.(), has, name),
    trade: i => { if (st.visit) ctx.action({ kind: 'trader.trade', offer: i, visit: st.visit.seed }); },
    esc: s => (ctx.esc ? ctx.esc(s) : String(s)), requestLock: () => ctx.requestLock?.(),
  };
  const canShow = () => !disposed && open() && localInReach();
  function openUI() {
    if (disposed || uiFailed || typeof document === 'undefined') return false;
    ctx.releaseLock?.();
    if (ui) { if (canShow()) { uiSeed = st.visit.seed; ui.open(); } return true; }
    uiLoading ??= import('./trader-ui.js?build=v3-survival-ae77fa84ac2b').then(m => { ui = m.createTraderUI(api); return ui; })
      .catch(e => { console.error('trader ui failed', e); uiFailed = true; uiLoading = null; return null; });
    uiLoading.then(u => { if (!u || disposed || ctx.uiOpen?.() || !canShow()) return; uiSeed = st.visit.seed; u.open(); });
    return true;
  }

  // ---- host action
  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('trader.')) return false;
    if (a.kind !== 'trader.trade' || !host()) return true;
    if (open() && distToStall(posOf(actor)) > reachOf(actor)) { ctx.emit?.({ kind: 'notice', text: CLOSER }, actor); return true; }
    const r = applyTrade(st, a, bag, has, name);
    if (r.ok) {
      uiVer++;
      ctx.emit?.({ kind: 'loot', text: r.text, sound: r.offer.plan || r.offer.rare ? 'craft' : 'collect' }, actor);
    } else ctx.emit?.({ kind: r.reason === 'full' ? 'full' : 'notice', text: r.text }, actor);
    return true;
  }

  const debug = {
    state() { const s = JSON.parse(JSON.stringify(serialize())); s.post = postSeed; s.stall = { ...stall }; s.open = !!ui?.isOpen(); return s; },
    post() { return postSeed; },
    offers() { return offers().map(o => JSON.parse(JSON.stringify(o))); },
    stock() { return st.visit ? [...st.visit.stock] : []; },
    give(kind, n = 10, who = 'host') { if (!host()) return false; const b = who === 'guest' ? ctx.actorBag?.('guest') : ctx.localBag?.(); return b ? n - b.add(kind, n) : 0; }, // who 'guest': QA for co-op trades
    trade(i) { if (!st.visit) return false; ctx.action({ kind: 'trader.trade', offer: i, visit: st.visit.seed }); return true; },
    aimAt() { // stand 2 m in front of the counter and look at it
      const p = ctx.physics, isl = liveIsland(), post = isl ? postFor(isl.seed) : null; if (!p || !post) return false;
      place();
      const sx = Math.sin(post.yaw), sz = Math.cos(post.yaw);
      p.x = stall.x + sx * 2; p.z = stall.z + sz * 2;
      const dbg = globalThis.raftDebug, g = isl.groundAt ? isl.groundAt(p.x, p.z) : NaN, eye = (g === g ? g : stall.y - COUNTER_Y) + 1.6;
      dbg?.aim?.(Math.atan2(stall.y - eye, 2), Math.atan2(-(stall.x - p.x), -(stall.z - p.z))); // yaw 0 looks toward -z
      return true;
    },
    open() { return canShow() ? openUI() : false; },
    close() { ui?.close(); return true; },
  };

  return {
    name: 'trader',
    update, serialize, load, action, interact, prompt, debug,
    craftLocked(id) { return id === 'shellwreath' && !st.plans.includes('shellwreath') ? 'Buy the plan at a trading post' : null; },
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
      stallM?.dispose(); wreath?.dispose(); float?.dispose();
      stallM = wreath = float = null;
    },
  };
}
