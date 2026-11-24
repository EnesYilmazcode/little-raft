// Driftwood Game Table content module (docs/specs/gametable.md §3). Slice: world.ext.gametable. Host-authoritative actions 'gt.*'.
// Draughts ("Shells & Pebbles") and noughts and crosses ("Knots & Hoops") against a crewmate or a friendly gull.
// Pure rules live in gametable-core.js; the board dialog (gametable-ui.js) is lazy-loaded on first use.
import { GT, keyOf, legalMoves, applyMove, gullMove, applyGameAction, tally, cleanGame, cleanSlice, sliceOf, newGame, resultText } from './gametable-core.js?build=v3-survival-ae77fa84ac2b';
import { buildGameTable } from './gametable-model.js?build=v3-survival-ae77fa84ac2b';

const MAX_SHOWN = GT.MAX_TABLES, SLIDE = .25;

export function createGameTable(ctx) {
  const T = ctx.T;
  let st = cleanSlice(undefined);
  let cache = null, cacheSt = null, cacheR = -1, netR = -1;
  let model = null, dirty = false, childCount = -1, shownR = -1, shownSt = null, sliding = 0;
  let pruneClock = 0, aiKey = null, aiN = -1, aiWait = 0;
  let pKey = null, pR = -1, pSt = null, pOut = null;
  let ui = null, uiLoading = null, uiFailed = false, disposed = false, uiKey = null, uiX = 0, uiZ = 0;
  const groups = new Array(MAX_SHOWN).fill(null), gKeys = new Array(MAX_SHOWN).fill(null);
  const gN = new Array(MAX_SHOWN).fill(-1), gRound = new Array(MAX_SHOWN).fill(-1), gG = new Array(MAX_SHOWN).fill(null), slideT = new Array(MAX_SHOWN).fill(-1);
  let shown = 0;
  const scratch = T ? new T.Vector3() : null;
  const myId = () => (ctx.role === 'guest' ? 'guest' : 'host');

  const decorAt = (x, z) => { const d = ctx.world?.decor; if (!Array.isArray(d)) return null; for (let i = 0; i < d.length; i++) if (d[i].x === x && d[i].z === z) return d[i].type; return null; };
  const posOf = actor => { if (actor === 'guest') return ctx.other ?? null; const p = ctx.physics; return p ? { x: p.x, z: p.z } : null; };
  const env = { decorAt, pos: posOf, crew: () => ctx.role === 'host' && !!ctx.other };
  const host = () => ctx.role !== 'guest';
  const esc = s => (ctx.esc ? ctx.esc(String(s)) : String(s));
  const inReach = (x, z, slack = 0) => { const p = ctx.physics; return !!p && decorAt(x, z) === 'gametable' && Math.hypot(p.x - 2 * x, p.z - 2 * z) <= GT.REACH + slack; };

  // Nearest table along the view ray (or the camera forward when no aim), within reach.
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (d.type !== 'gametable') continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > GT.REACH) continue;
      const cy = (ctx.raft?.position.y ?? 0) + .8;
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > .85) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  // ---- save / net
  function serialize() {
    if (cache && cacheSt === st && cacheR === st.r) return cache;
    cache = sliceOf(st); cacheSt = st; cacheR = st.r;
    return cache;
  }
  function resetLocal() { aiKey = null; aiN = -1; aiWait = 0; dirty = true; ui?.reset?.(); }
  function load(data, from) {
    if (from === 'net') {
      const r = data && typeof data === 'object' && Number.isFinite(data.r) ? data.r : -2; // -2: host without a game-table slice (older build)
      if (r === netR) return;
      st = cleanSlice(data); netR = r; resetLocal();
      return;
    }
    st = cleanSlice(data, decorAt); netR = -1; resetLocal();
  }

  // ---- host rules
  function report(a, r, actor, gm) {
    if (r.ok) {
      if (r.text) ctx.emit?.({ kind: 'build', text: r.text }, actor);
      if (gm && gm.w !== -1 && a.kind !== 'gt.start' && a.kind !== 'gt.rematch') ctx.emit?.({ kind: 'loot', text: resultText(gm) }, 'all');
    } else if (r.reason !== 'stale') ctx.emit?.({ kind: 'notice', text: r.text }, actor);
  }
  function run(a, actor, e = env) {
    const r = applyGameAction(st, a, actor, e);
    const gm = r.ok ? st.t[keyOf(a.x, a.z)] : null;
    report(a, r, actor, gm);
    return r;
  }
  function action(a, actor) {
    if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('gt.')) return false;
    if (!host()) return true;
    run(a, actor);
    return true;
  }
  function gullNow(key) {
    const gm = st.t[key]; if (!gm || gm.w !== -1 || gm.s[gm.p] !== 'ai') return false;
    const c = key.indexOf(','); if (decorAt(+key.slice(0, c), +key.slice(c + 1)) !== 'gametable') return false; // table removed: prune drops it
    const hops = gullMove(gm, Math.random, gm.lv === 1); if (!hops.length) return false;
    let g = gm;
    for (let i = 0; i < hops.length; i++) {
      const h = hops[i], m = legalMoves(g).find(x => x.f === h.f && x.t === h.t);
      if (!m) break;
      g = applyMove(g, m);
    }
    if (g === gm) return false;
    g.last = [hops[0].f, g.last[1]];
    st.t[key] = g; st.r++;
    if (g.w !== -1) { tally(st, g); ctx.emit?.({ kind: 'loot', text: resultText(g) }, 'all'); }
    return true;
  }
  function think(dt) {
    let fk = null, found = null;
    for (const k in st.t) { const g = st.t[k]; if (g.w === -1 && g.s[g.p] === 'ai') { fk = k; found = g; break; } }
    if (!found) { aiKey = null; aiN = -1; return; }
    if (fk !== aiKey || found.n !== aiN) { aiKey = fk; aiN = found.n; aiWait = GT.THINK_MIN + Math.random() * (GT.THINK_MAX - GT.THINK_MIN); }
    aiWait -= dt;
    if (aiWait <= 0) { aiWait = 0; gullNow(fk); }
  }
  function prune() {
    let cut = false;
    for (const key in st.t) {
      const c = key.indexOf(','), x = +key.slice(0, c), z = +key.slice(c + 1);
      if (decorAt(x, z) !== 'gametable') { delete st.t[key]; cut = true; }
    }
    if (cut) { st.r++; aiKey = null; }
  }

  // ---- visuals
  function rescan() {
    const raft = ctx.raft;
    // groups dropped by rebuildRaft: free their per-instance matrix buffers (disposeGeometry skips InstancedMesh.dispose)
    for (let i = 0; i < shown; i++) { const g = groups[i]; if (g && g.parent !== raft) { const u = g.userData.gt; u.shell.dispose(); u.pebble.dispose(); u.knot.dispose(); u.hoop.dispose(); } }
    shown = 0;
    if (!raft) return;
    for (let c = 0; c < raft.children.length && shown < MAX_SHOWN; c++) {
      const g = raft.children[c]; if (g.name !== 'game_table' || !g.userData.gt) continue;
      groups[shown] = g; gKeys[shown] = keyOf(Math.round(g.position.x * 500) / 1000, Math.round(g.position.z * 500) / 1000); gN[shown] = -1; gRound[shown] = -1; gG[shown] = null; slideT[shown] = -1; shown++;
    }
    for (let i = shown; i < MAX_SHOWN; i++) { groups[i] = null; gKeys[i] = null; }
  }
  function apply(fresh) {
    sliding = 0;
    for (let i = 0; i < shown; i++) {
      const gm = st.t[gKeys[i]] ?? null;
      const n = gm ? gm.n : -1, rd = gm ? gm.round : -1, g = gm ? gm.g : null;
      const moved = !fresh && gm && gN[i] >= 0 && n !== gN[i] && rd === gRound[i] && g === gG[i] && gm.last[1] >= 0;
      if (moved) { slideT[i] = 0; sliding++; model.place(groups[i], gm, 0); }
      else { slideT[i] = -1; model.place(groups[i], gm, 1); }
      gN[i] = n; gRound[i] = rd; gG[i] = g;
    }
  }
  function visuals(dt) {
    const raft = ctx.raft; if (!raft || !model) return;
    let fresh = false;
    if (dirty || raft.children.length !== childCount) { rescan(); childCount = raft.children.length; dirty = false; fresh = true; }
    if (fresh || st.r !== shownR || st !== shownSt) { apply(fresh); shownR = st.r; shownSt = st; }
    if (!sliding) return;
    sliding = 0;
    for (let i = 0; i < shown; i++) {
      if (slideT[i] < 0) continue;
      slideT[i] += dt > 0 ? dt : 0;
      const u = slideT[i] / SLIDE;
      model.slide(groups[i], u);
      if (u >= 1) slideT[i] = -1; else sliding++;
    }
  }

  function update(dt) {
    const d = dt > 0 && Number.isFinite(dt) ? dt : 0;
    if (host()) {
      pruneClock += d;
      if (pruneClock >= 1) { pruneClock = 0; prune(); }
      think(d);
    }
    visuals(d);
    if (ui) {
      ui.tick();
      if (ui.isOpen() && !inReach(uiX, uiZ, .3)) ui.close();
    }
  }

  // ---- prompt / interact / UI
  function status(gm) {
    if (!gm) return 'pick a game';
    if (gm.w !== -1) return 'game over';
    const who = gm.s[gm.p];
    if (who === myId()) return 'your turn';
    if (who === 'ai') return 'gull is thinking';
    return 'crewmate’s turn';
  }
  function prompt(aim) {
    const d = target(aim); if (!d) return null;
    const key = keyOf(d.x, d.z);
    if (pOut !== null && key === pKey && st.r === pR && st === pSt) return pOut;
    pOut = '<kbd>E</kbd>' + esc('Play at the game table') + ' · ' + esc(status(st.t[key] ?? null));
    pKey = key; pR = st.r; pSt = st;
    return pOut;
  }
  function interact(aim) {
    const d = target(aim); if (!d) return false;
    openUI(keyOf(d.x, d.z));
    return true;
  }
  const api = {
    esc,
    game: () => (uiKey !== null ? st.t[uiKey] ?? null : null),
    rev: () => st.r,
    me: () => myId(),
    crewOn: () => ctx.role !== 'solo' && !!ctx.other,
    legal: gm => legalMoves(gm),
    wins: () => st.wins,
    running: () => !!ctx.running,
    requestLock: () => ctx.requestLock?.(),
    send: a => { if (uiKey === null) return; const gm = st.t[uiKey]; ctx.action({ ...a, x: uiX, z: uiZ, n: gm ? gm.n : 0 }); },
  };
  function setKey(key) { uiKey = key; const c = key.indexOf(','); uiX = +key.slice(0, c); uiZ = +key.slice(c + 1); }
  function openUI(key) {
    if (disposed || uiFailed || typeof document === 'undefined') return false;
    ctx.releaseLock?.();
    if (ui) { setKey(key); if (inReach(uiX, uiZ)) ui.open(key); return true; }
    uiLoading ??= import('./gametable-ui.js?build=v3-survival-ae77fa84ac2b').then(m => { if (disposed) return null; ui = m.createGameTableUI(api); return ui; })
      .catch(e => { console.error('game table ui failed', e); uiFailed = true; uiLoading = null; return null; });
    uiLoading.then(u => {
      if (!u || disposed || ctx.uiOpen?.()) return;
      setKey(key);
      if (inReach(uiX, uiZ)) u.open(key);
    });
    return true;
  }

  // ---- QA helpers (raftDebug.content.gametable); mutators are host-only
  const near = (x, z) => ({ decorAt, crew: env.crew, pos: () => ({ x: 2 * x, z: 2 * z }) });
  const debug = {
    spawn(x = 0, z = 0) {
      if (!host()) return false;
      const w = ctx.world; if (!w || !Array.isArray(w.decor) || !Array.isArray(w.tiles)) return false;
      if (decorAt(x, z) === 'gametable') return true;
      if (decorAt(x, z) || !w.tiles.some(t => t[0] === x && t[1] === z)) return false;
      w.decor.push({ type: 'gametable', x, z }); ctx.rebuildRaft?.(); dirty = true;
      return true;
    },
    start(x, z, g = 'd', vs = 'easy') { if (!host()) return false; const gm = st.t[keyOf(x, z)]; return run({ kind: 'gt.start', x, z, g, vs, n: gm ? gm.n : 0 }, 'host', near(x, z)).ok; },
    move(x, z, f, t) { if (!host()) return false; const gm = st.t[keyOf(x, z)]; return run({ kind: 'gt.move', x, z, f, t, n: gm ? gm.n : 0 }, 'host', near(x, z)).ok; },
    gull(x, z) { if (!host()) return false; return gullNow(keyOf(x, z)); },
    setBoard(x, z, b, p = 0) {
      if (!host() || decorAt(x, z) !== 'gametable') return false;
      const key = keyOf(x, z), old = st.t[key];
      const g = typeof b === 'string' && b.length === 9 ? 'n' : 'd';
      const base = old && old.g === g ? old : newGame(g, ['host', 'ai'], 0);
      const gm = cleanGame({ ...base, b, p, j: -1, w: -1, q: 0, last: [-1, -1], n: (old ? old.n : 0) + 1 });
      if (!gm) return false;
      st.t[key] = gm; st.r++;
      return true;
    },
    state() {
      const s = JSON.parse(JSON.stringify(sliceOf(st)));
      s.aiKey = aiKey; s.aiWait = aiWait; s.uiOpen = !!ui?.isOpen(); s.uiKey = uiKey;
      return s;
    },
    open(x = 0, z = 0) { return inReach(x, z) ? openUI(keyOf(x, z)) : false; },
    close() { ui?.close(); return true; },
    clear() { if (!host()) return false; st.t = {}; st.wins = { host: 0, guest: 0, ai: 0 }; st.r++; aiKey = null; return true; },
  };

  return {
    name: 'gametable',
    serialize, load, action, interact, prompt, update, debug,
    decorModel(type) {
      if (!T || type !== 'gametable') return null;
      model ??= buildGameTable(T); dirty = true;
      return model.instance();
    },
    dispose() {
      disposed = true;
      try { ui?.dispose(); } catch {}
      ui = null;
      model?.dispose(); model = null;
    },
  };
}
