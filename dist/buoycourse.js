// Buoy Ring Course content module (docs/specs/buoycourse.md). Slice: world.ext.buoycourse (host-authoritative).
// Place a Start Flag, pick a course on its board, press E on the pole and swim (or paddle) through the rings.
// Nothing can fail: a stopped run just says "Run stopped". Pure rules live in buoycourse-core.js.
import { SHAPES, NAMES, RING, MAX_MS, makeCourse, crossGate, nearestTile, addBest, cleanName, cleanCourse, fmt, gkOf, validFinish } from './buoycourse-core.js';
import { buildCourseModels } from './buoycourse-model.js';

const CSS = '#buoyTimer{position:fixed;top:48px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:999px;'
  + 'background:rgba(8,22,36,.55);color:#f6ecd6;font:600 13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.05em;'
  + 'pointer-events:none;z-index:30;white-space:nowrap;display:none;font-variant-numeric:tabular-nums}'
  + '#buoyTimer.big{font-size:34px;line-height:1.1;padding:4px 22px;letter-spacing:.02em}';
const REACH = 3, AIM_R = .45, SHOW_S = 20, TAIL_S = 3;

const readName = () => { try { return (localStorage.getItem('little-raft-name') || '').trim().slice(0, 16); } catch { return ''; } };

export function createBuoyCourse(ctx) {
  const T = ctx.T;
  let st = cleanCourse(undefined), gk = gkOf(st);
  const run = { phase: 'idle', t: 0, next: 0, gk: '', shape: 'loop', mode: 'swim', deck: 0, cd: 0 };
  const prev = { x: 0, y: 0, z: 0, ok: false };
  let showT = 0, goT = 0, tail = 0, tailText = '', onDeckAll = 0, left = false, cdShown = 0;
  let models = null, modelsFailed = false, added = false, flagClock = 0, paintClock = 0, paintKey = '', tryKey = '';
  let pill = null, pillKey = -1, pillBig = false, pillBestKey = '', pillBest = '';
  let pOut = null, pKey = '';
  const scratch = T ? new T.Vector3() : null;
  const host = () => ctx.role !== 'guest';

  // ---------------------------------------------------------------- helpers
  const moving = () => { const s = ctx.world?.sailing; return !!s && !s.anchored && Math.hypot(+s.vx || 0, +s.vz || 0) > 0.15; };
  const firstFlag = () => { const d = ctx.world?.decor; if (!Array.isArray(d)) return null; for (let i = 0; i < d.length; i++) if (d[i].type === 'courseflag') return d[i]; return null; };
  const flagAt = (x, z) => { const d = ctx.world?.decor; if (!Array.isArray(d)) return false; for (let i = 0; i < d.length; i++) if (d[i].type === 'courseflag' && d[i].x === x && d[i].z === z) return true; return false; };
  const flagOk = () => !!st.f && flagAt(st.f[0], st.f[1]);
  function ridingBoard() {
    try {
      if (ctx.physics?.mount === 'driftboard') return true;
      const mods = ctx.content?.mods; if (!Array.isArray(mods)) return false;
      for (let i = 0; i < mods.length; i++) { const m = mods[i]; if (m?.name === 'paddleboard' && !m.dead) return typeof m.riding === 'function' && !!m.riding(); }
    } catch { /* never throw from here */ }
    return false;
  }
  const chime = k => { if (!ctx.note?.('bells', k, .8)) ctx.emit?.({ kind: 'buoy', sound: 'ui' }, 'host'); };
  const tick = () => ctx.emit?.({ kind: 'buoy', sound: 'ui' }, 'host');
  const myName = () => readName() || (host() ? 'Sailor' : 'Crewmate');
  const listOf = (shape, mode) => st.best[shape + ':' + mode] || null;
  function bestFor(shape, mode) {
    const l = listOf(shape, mode); if (!l || !l.length) return null;
    const me = myName(); for (const r of l) if (r[0] === me) return r;
    return l[0];
  }
  const changed = () => { st.r++; gk = gkOf(st); };

  // ---------------------------------------------------------------- host: the first flag owns the course
  function syncFlag() {
    if (!host()) return;
    const w = ctx.world; if (!w) return;
    const d = firstFlag();
    if (!d) { if (st.f || st.g.length) { st.f = null; st.g = []; changed(); } return; }
    if (!st.f || st.f[0] !== d.x || st.f[1] !== d.z) {
      st.f = [d.x, d.z]; st.g = makeCourse(st.shape, w.tiles, st.f) || []; tryKey = ''; changed(); showT = SHOW_S; return;
    }
    if (!st.g.length) { // bad saved gates, or a raft that was too big: retry when the raft changes
      const k = (w.tiles?.length ?? 0) + ':' + st.shape;
      if (k !== tryKey) { tryKey = k; const g = makeCourse(st.shape, w.tiles, st.f); if (g) { st.g = g; changed(); } }
    }
  }

  // ---------------------------------------------------------------- save / net
  function serialize() { return st; }
  function load(data, from) {
    if (from === 'net' && data && data.r === st.r && sameF(data.f)) return;
    const old = st.shape;
    st = cleanCourse(data); gk = gkOf(st); paintKey = ''; tryKey = ''; pOut = null;
    if (st.shape !== old) showT = SHOW_S;
  }
  const sameF = f => (f == null && st.f == null) || (Array.isArray(f) && !!st.f && f[0] === st.f[0] && f[1] === st.f[1]);

  // ---------------------------------------------------------------- host actions
  function action(a, actor) {
    if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('buoy.')) return false;
    if (a.kind === 'buoy.shape') {
      syncFlag();
      if (!SHAPES.includes(a.shape) || !st.f) return true;
      const g = makeCourse(a.shape, ctx.world?.tiles, st.f);
      if (!g) { ctx.emit({ kind: 'buoy', text: 'The raft is too big for ' + NAMES[a.shape], sound: 'deny' }, actor); return true; }
      st.shape = a.shape; st.g = g; changed(); showT = SHOW_S;
      ctx.emit({ kind: 'buoy', text: 'Course: ' + NAMES[a.shape], sound: 'ui' }, 'all');
      return true;
    }
    if (a.kind === 'buoy.finish') {
      if (!validFinish(st, a)) return true;
      const name = cleanName(a.name, actor === 'host' ? 'Sailor' : 'Crewmate'), key = st.shape + ':' + a.mode;
      const res = addBest(st.best[key], name, a.ms);
      st.best[key] = res.list; st.r++;
      const shape = st.shape;
      ctx.emit({ kind: 'buoy', sound: 'catch', text: `${name} finished ${NAMES[shape]}${a.mode === 'board' ? ' by board' : ''} in ${fmt(a.ms).replace(/^0:/, '')} s${res.best ? ' · new best!' : ''}` }, 'all');
      try { ctx.award?.({ kind: 'race' }, actor); } catch { /* optional */ }
      return true;
    }
    return true;
  }

  // ---------------------------------------------------------------- local run
  function idle() { run.phase = 'idle'; run.cd = 0; prev.ok = false; goT = 0; }
  function stop(text = 'Run stopped') { if (run.phase === 'idle') return; idle(); tail = 0; ctx.notice?.(text); tick(); }
  function start() {
    const s = ctx.world?.sailing;
    if (s && s.raised && !s.anchored) { ctx.notice?.('Lower the sail or drop anchor to race'); return; }
    if (moving()) { ctx.notice?.('Wait for the raft to slow down'); return; }
    run.phase = 'count'; run.cd = 3; cdShown = 3; tail = 0; showT = SHOW_S; tick();
  }
  function go() {
    run.phase = 'go'; run.t = 0; run.next = 0; run.gk = gk; run.shape = st.shape; run.mode = 'swim'; run.deck = 0; run.cd = 0;
    prev.ok = false; onDeckAll = 0; left = false; goT = .8;
  }
  function finish() {
    const ms = Math.min(MAX_MS, Math.max(1, Math.round(run.t * 1000)));
    ctx.action?.({ kind: 'buoy.finish', shape: run.shape, mode: run.mode, ms, name: readName(), gk: run.gk });
    idle(); tail = TAIL_S; tailText = 'Finished ' + fmt(ms); pillKey = -1;
  }
  function step(p1) { // detection for the next gate only; a missed gate stays lit
    const g = st.g[run.next]; if (!g) return false;
    const board = ridingBoard();
    const hit = prev.ok && crossGate(prev, p1, g, ctx.ocean ? ctx.ocean.getHeight(g[0], g[1]) : 0, board ? RING.YHI_BOARD : RING.YHI);
    prev.x = p1.x; prev.y = p1.y; prev.z = p1.z; prev.ok = true;
    if (!hit) return false;
    chime(Math.min(run.next, 7));
    if (board) run.mode = 'board';
    run.next++;
    if (run.next >= st.g.length) finish();
    return true;
  }
  function afterMove(physics, dt) {
    if (run.phase !== 'go' || !physics) return;
    step(physics);
    if (run.phase !== 'go') return;
    const tiles = ctx.world?.tiles;
    const onDeck = !!physics.grounded && !physics.swimming && nearestTile(tiles, physics.x, physics.z) <= .25;
    const d = dt > 0 ? dt : 0;
    if (onDeck && run.next > 0) { run.deck += d; if (run.deck > 2) { stop(); return; } } else run.deck = 0;
    if (!left) { if (onDeck) { onDeckAll += d; if (onDeckAll > 90) stop(); } else left = true; }
  }

  // ---------------------------------------------------------------- aim targets
  const hits = { kind: null, d: null, along: Infinity }; // reused
  function aimAt(cam, dir, cx, cy, cz) {
    const vx = cx - cam.x, vy = cy - cam.y, vz = cz - cam.z, l2 = vx * vx + vy * vy + vz * vz;
    if (l2 > REACH * REACH) return -1;
    const along = vx * dir.x + vy * dir.y + vz * dir.z; if (along <= 0) return -1;
    const off2 = l2 - along * along;
    return off2 <= AIM_R * AIM_R ? along : -1;
  }
  function target() {
    hits.kind = null; hits.d = null; hits.along = Infinity;
    const w = ctx.world, cam = ctx.camera, aim = ctx.aim?.();
    if (!w || !cam || !aim || !aim.dir || !Array.isArray(w.decor)) return hits;
    const Y = ctx.deckY?.() ?? .2, o = cam.position, first = firstFlag();
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i];
      if (d.type !== 'courseflag' && d.type !== 'scoreboard') continue;
      const X = d.x * 2, Z = d.z * 2;
      if (d.type === 'scoreboard') { const a = aimAt(o, aim.dir, X, Y + 1.05, Z); if (a >= 0 && a < hits.along) { hits.kind = 'score'; hits.d = d; hits.along = a; } continue; }
      const own = d === first;
      const a1 = aimAt(o, aim.dir, X - .25, Y + 1.1, Z), a2 = aimAt(o, aim.dir, X + .3, Y + .85, Z);
      if (a1 >= 0 && a1 < hits.along) { hits.kind = own ? 'pole' : 'extra'; hits.d = d; hits.along = a1; }
      if (a2 >= 0 && a2 < hits.along) { hits.kind = own ? 'board' : 'extra'; hits.d = d; hits.along = a2; }
    }
    return hits;
  }
  const nextShape = () => SHAPES[(SHAPES.indexOf(st.shape) + 1) % SHAPES.length];

  function prompt() {
    const h = target(); if (!h.kind) return null;
    if (h.kind === 'pole' && !st.g.length) return null; // no course: board only
    const key = h.kind + '|' + st.shape + '|' + st.r + '|' + run.phase;
    if (pOut !== null && key === pKey) { if (h.kind === 'board') showT = SHOW_S; return pOut; }
    const esc = ctx.esc ?? (s => String(s));
    if (h.kind === 'extra') pOut = 'Another Start Flag runs the course';
    else if (h.kind === 'pole') pOut = run.phase === 'idle' ? '<kbd>E</kbd>' + esc(`Start the ${NAMES[st.shape]} race`) : '<kbd>E</kbd>Stop the run';
    else if (h.kind === 'board') { pOut = '<kbd>E</kbd>' + esc(`Next course · ${NAMES[nextShape()]}`); showT = SHOW_S; }
    else {
      const r = (listOf(st.shape, 'swim') || listOf(st.shape, 'board') || [])[0];
      pOut = esc(r ? `Best ${NAMES[st.shape]}: ${fmt(r[1])} · ${r[0]}` : `No ${NAMES[st.shape]} times yet`);
    }
    pKey = key;
    return pOut;
  }

  function interact() {
    const h = target(); if (!h.kind || h.kind === 'score') return false;
    if (h.kind === 'extra') { ctx.notice?.('Another Start Flag runs the course'); return true; }
    if (h.kind === 'board') { showT = SHOW_S; ctx.action?.({ kind: 'buoy.shape', shape: nextShape() }); return true; }
    if (run.phase !== 'idle') { stop(); return true; }
    if (ctx.uiOpen?.() || !st.g.length) return false;
    start(); return true;
  }

  // ---------------------------------------------------------------- HUD pill
  function ensurePill() {
    if (pill || typeof document === 'undefined' || !document.body) return pill;
    if (!document.getElementById('buoyStyle')) { const s = document.createElement('style'); s.id = 'buoyStyle'; s.textContent = CSS; document.head.appendChild(s); }
    pill = document.createElement('div'); pill.id = 'buoyTimer'; pill.setAttribute('role', 'status');
    document.body.appendChild(pill);
    return pill;
  }
  function setPill(text, big, key) {
    if (!ensurePill()) return;
    if (key === pillKey && big === pillBig) return;
    pillKey = key;
    if (big !== pillBig) { pill.classList.toggle('big', big); pillBig = big; }
    pill.textContent = text; pill.style.display = 'block';
  }
  function hidePill() { if (pill && pillKey !== -2) { pill.style.display = 'none'; pillKey = -2; } }
  function hud() {
    if (run.phase === 'count') { const n = Math.max(1, Math.ceil(run.cd)); setPill(String(n), true, 100 + n); return; }
    if (run.phase === 'go') {
      if (goT > 0) { setPill('Go!', true, 99); return; }
      const ms = Math.round(run.t * 1000), tenth = Math.floor(ms / 100);
      const bk = run.shape + ':' + run.mode + ':' + st.r;
      if (bk !== pillBestKey) { pillBestKey = bk; const b = bestFor(run.shape, run.mode); pillBest = b ? ' · best ' + fmt(b[1]) : ''; pillKey = -1; }
      setPill(`Ring ${run.next}/${st.g.length} · ${fmt(ms)}${pillBest}`, false, 1000 + run.next * 1e7 + tenth);
      return;
    }
    if (tail > 0) { setPill(tailText, false, 50); return; }
    hidePill();
  }

  // ---------------------------------------------------------------- models / visibility
  function ensureModels() {
    if (models || !T || modelsFailed) return models;
    try { models = buildCourseModels(T); } catch (e) { console.error('buoycourse models failed', e); models = null; modelsFailed = true; }
    return models;
  }
  function repaint() {
    if (!models) return;
    const me = myName(), key = st.r + '|' + st.shape + '|' + me;
    if (key === paintKey) return;
    paintKey = key;
    const mine = bestFor(st.shape, 'swim'), mb = bestFor(st.shape, 'board');
    const pick = mine && mine[0] === me ? mine : mb && mb[0] === me ? mb : null;
    models.paintBoard({ title: NAMES[st.shape], sub: pick ? 'Your best ' + fmt(pick[1]) : st.g.length || !st.f ? 'Press E on the pole' : 'Raft too big for this one' });
    const rows = l => (l || []).slice(0, 3).map(r => [r[0], fmt(r[1])]);
    models.paintScore({ title: NAMES[st.shape], swim: rows(listOf(st.shape, 'swim')), board: rows(listOf(st.shape, 'board')) });
  }
  let visible = false;
  function visuals() {
    if (!models && (!ctx.scene || !ensureModels())) return;
    if (!added && ctx.scene) { ctx.scene.add(models.rings.group); added = true; }
    const v = !!st.f && st.g.length > 0 && !moving() && (run.phase !== 'idle' || showT > 0);
    if (v !== visible) { models.show(v); visible = v; }
    if (v) models.pose(st.g, run.phase === 'go' ? run.next : 0, ctx.ocean);
  }

  function update(dt) {
    const d = dt > 0 ? dt : 0;
    flagClock += d;
    if (flagClock >= .05) { flagClock = 0; syncFlag(); }
    if (showT > 0) showT -= d;
    if (tail > 0) tail -= d;
    if (goT > 0) goT -= d;
    if (run.phase === 'count') {
      run.cd -= d;
      const n = Math.ceil(run.cd);
      if (run.cd <= 0) go(); else if (n !== cdShown) { cdShown = n; tick(); }
    } else if (run.phase === 'go') run.t += d;
    if (run.phase !== 'idle') {
      if (moving()) stop();
      else if (!flagOk()) stop();
      else if (run.phase === 'go' && (run.t > 600 || gk !== run.gk)) stop();
      else if (run.phase === 'count' && !st.g.length) stop();
    }
    paintClock += d;
    if (paintClock >= .5) { paintClock = 0; repaint(); }
    visuals();
    hud();
  }

  // ---------------------------------------------------------------- debug
  const debug = {
    place(x = 0, z = 0) {
      if (!host()) return false;
      const w = ctx.world; if (!w || !Array.isArray(w.decor)) return false;
      if (w.decor.some(d => d.x === x && d.z === z)) return flagAt(x, z);
      if (!w.tiles.some(t => t[0] === x && t[1] === z)) return false;
      w.decor.push({ type: 'courseflag', x, z }); ctx.rebuildRaft?.(); syncFlag(); return true;
    },
    placeScore(x = 0, z = 0) {
      if (!host()) return false;
      const w = ctx.world; if (!w || !Array.isArray(w.decor) || w.decor.some(d => d.x === x && d.z === z) || !w.tiles.some(t => t[0] === x && t[1] === z)) return false;
      w.decor.push({ type: 'scoreboard', x, z }); ctx.rebuildRaft?.(); return true;
    },
    shape(name) { showT = SHOW_S; ctx.action?.({ kind: 'buoy.shape', shape: name }); return true; },
    gates() { return st.g.map(g => g.slice()); },
    start() { if (!st.g.length) return false; go(); goT = 0; return true; },
    teleportThrough(i, addS = 8) {
      if (run.phase !== 'go' || i !== run.next) return false;
      const g = st.g[i]; if (!g) return false;
      run.t += addS;
      const w = ctx.ocean ? ctx.ocean.getHeight(g[0], g[1]) : 0, nx = Math.sin(g[2]), nz = Math.cos(g[2]);
      prev.x = g[0] - nx; prev.y = w; prev.z = g[1] - nz; prev.ok = true;
      return step({ x: g[0] + nx, y: w, z: g[1] + nz });
    },
    finish(ms, name, mode = 'swim') { ctx.action?.({ kind: 'buoy.finish', shape: st.shape, mode, ms, name, gk }); return true; },
    stop() { stop(); return true; },
    state() {
      return { phase: run.phase, next: run.next, t: run.t, mode: run.mode, visible, shape: st.shape, gk, best: JSON.parse(JSON.stringify(st.best)), moving: moving(), f: st.f ? st.f.slice() : null, r: st.r, riding: ridingBoard() };
    },
    show(s = SHOW_S) { showT = s; return true; },
  };

  if (ctx.scene) ensureModels(); // rings are built once and live in the scene
  return {
    name: 'buoycourse',
    serialize, load, action, interact, prompt, update, afterMove, debug,
    decorModel(type) {
      if (type !== 'courseflag' && type !== 'scoreboard') return null;
      if (!ensureModels()) return null;
      paintKey = '';
      const g = type === 'courseflag' ? models.flag() : models.scoreboard();
      g.userData.ownRot = true; // no rotation in v1: aim targets assume the default facing
      return g;
    },
    dispose() {
      pill?.remove(); pill = null;
      if (typeof document !== 'undefined') document.getElementById('buoyStyle')?.remove();
      models?.dispose(); models = null; added = false;
    },
  };
}

