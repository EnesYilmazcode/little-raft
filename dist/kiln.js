// Seaside Kiln content module (docs/specs/kiln.md §5). Slice: world.ext.kiln. Host-authoritative actions 'kiln.*'.
// Smelts metal ore -> Metal Ingot, sand -> Glass, clay -> Brick (items.js kinds). Pure rules live in kiln-core.js.
import { KILN, SMELT, INPUTS, NAMES, keyOf, blank, cleanEntry, cleanSlice, sliceOf, stepAll, burning, progress, applyKilnAction } from './kiln-core.js';
import { buildKiln, buildGlassLamp } from './kiln-model.js';

const MAX_SHOWN = 100;

export function createKiln(ctx) {
  const T = ctx.T;
  let st = { k: {}, r: 0 };
  let cache = null, cacheSt = null, cacheR = -1, netR = -1;
  let model = null, lamp = null, dirty = false, childCount = -1, shownR = -1, shownSt = null, anyBurning = false;
  let clock = 0, pruneClock = 0;
  let pKey = null, pR = -1, pSel = null, pPct = -1, pSt = null, pOut = null;
  const groups = new Array(MAX_SHOWN).fill(null), gKeys = new Array(MAX_SHOWN).fill(null);
  let shown = 0;
  const scratch = T ? new T.Vector3() : null;
  const BLANK = Object.freeze(blank());

  const decorAt = (x, z) => { const d = ctx.world?.decor; if (!Array.isArray(d)) return null; for (let i = 0; i < d.length; i++) if (d[i].x === x && d[i].z === z) return d[i].type; return null; };
  const posOf = actor => { if (actor === 'guest') return ctx.other ?? null; const p = ctx.physics; return p ? { x: p.x, z: p.z } : null; };
  const env = { decorAt, pos: posOf };
  const host = () => ctx.role !== 'guest';
  const onDone = (key, e) => { ctx.emit({ kind: 'loot', text: `The kiln is done: ${e.n} ${NAMES[e.o]} ready` }, 'all'); };

  // Nearest kiln along the view ray (or the camera forward when no aim), within reach.
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (d.type !== 'kiln') continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > KILN.REACH) continue;
      const cy = (ctx.raft?.position.y ?? 0) + .5;
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > .85) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best;
  }
  const selKind = () => { const b = ctx.localBag?.(); const s = b && b.slots ? b.slots[b.selectedIndex] : null; return s ? s.kind : null; };

  function serialize() {
    if (cache && cacheSt === st && cacheR === st.r) return cache;
    cache = sliceOf(st); cacheSt = st; cacheR = st.r;
    return cache;
  }
  function load(data, from) {
    if (from === 'net') {
      const r = data && typeof data === 'object' ? data.r : -2; // -2: host without a kiln slice (older build)
      if (r === netR) return; // unchanged host state
      st = cleanSlice(data); netR = r; dirty = true;
      return;
    }
    netR = -1;
    st = cleanSlice(data, decorAt); dirty = true;
  }

  // ---- visuals
  function rescan() {
    shown = 0;
    const raft = ctx.raft; if (!raft) return;
    for (let c = 0; c < raft.children.length && shown < MAX_SHOWN; c++) {
      const g = raft.children[c]; if (g.name !== 'kiln_station' || !g.userData.kiln) continue;
      groups[shown] = g; gKeys[shown] = keyOf(Math.round(g.position.x / 2), Math.round(g.position.z / 2)); shown++;
    }
    for (let i = shown; i < MAX_SHOWN; i++) { groups[i] = null; gKeys[i] = null; }
  }
  function apply() {
    anyBurning = false;
    for (let i = 0; i < shown; i++) {
      const k = groups[i].userData.kiln, e = st.k[gKeys[i]], on = burning(e);
      k.glow.visible = on; k.flame.visible = on; if (on) anyBurning = true;
      const o = e && e.n > 0 ? e.o : null;
      k.tray.ingot.visible = o === 'metalingot'; k.tray.glass.visible = o === 'glass'; k.tray.brick.visible = o === 'brick';
    }
  }
  function visuals(dt) {
    const raft = ctx.raft; if (!raft || !model) return;
    let again = false;
    if (dirty || raft.children.length !== childCount) { rescan(); childCount = raft.children.length; dirty = false; again = true; }
    if (again || st.r !== shownR || st !== shownSt) { apply(); shownR = st.r; shownSt = st; }
    if (!anyBurning) return;
    clock += dt;
    model.flicker(clock);
    for (let i = 0; i < shown; i++) {
      const f = groups[i].userData.kiln.flame;
      if (f.visible) f.scale.y = 1 + .15 * Math.sin(clock * 11 + i);
    }
  }

  function update(dt) {
    if (host()) {
      if (stepAll(st, dt, onDone)) st.r++;
      pruneClock += dt > 0 ? dt : 0;
      if (pruneClock >= 1) {
        pruneClock = 0;
        let cut = false;
        for (const key in st.k) {
          const c = key.indexOf(','), x = +key.slice(0, c), z = +key.slice(c + 1);
          if (decorAt(x, z) !== 'kiln') { delete st.k[key]; cut = true; }
        }
        if (cut) st.r++;
      }
    }
    visuals(dt);
  }

  function prompt(aim) {
    const d = target(aim); if (!d) return null;
    const key = keyOf(d.x, d.z), e = st.k[key] ?? BLANK, sel = selKind(), pct = Math.round(progress(e) * 100);
    if (pOut !== null && key === pKey && st.r === pR && sel === pSel && pct === pPct && st === pSt) return pOut;
    let verb;
    if (INPUTS.includes(sel)) verb = `Load ${SMELT[sel].need} ${NAMES[sel]}`;
    else if (sel === 'wood') verb = 'Add wood';
    else if (e.n > 0) verb = `Take ${e.n} ${NAMES[e.o]}`;
    else verb = 'Seaside Kiln';
    const parts = [];
    if (e.q > 0) parts.push(`${NAMES[SMELT[e.r].out]} ${e.q} queued ${pct}%`);
    if (e.q > 0 && e.h === 0 && e.f === 0) parts.push('needs wood'); else parts.push(`fuel ${e.f}`);
    if (e.n > 0) parts.push(`${e.n} ready`);
    const esc = ctx.esc ?? (s => String(s));
    pOut = '<kbd>E</kbd>' + esc(verb) + ' · ' + esc(parts.join(' · '));
    pKey = key; pR = st.r; pSel = sel; pPct = pct; pSt = st;
    return pOut;
  }

  function interact(aim) {
    const d = target(aim); if (!d) return false;
    const sel = selKind(), e = st.k[keyOf(d.x, d.z)];
    if (INPUTS.includes(sel)) ctx.action({ kind: 'kiln.load', x: d.x, z: d.z, item: sel });
    else if (sel === 'wood') ctx.action({ kind: 'kiln.fuel', x: d.x, z: d.z });
    else if (e && e.n > 0) ctx.action({ kind: 'kiln.take', x: d.x, z: d.z });
    else ctx.notice?.('Hold metal ore, sand or clay to load the kiln');
    return true;
  }

  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('kiln.')) return false;
    const r = applyKilnAction(st, a, actor, bag, env);
    if (r.ok) ctx.emit({ kind: a.kind === 'kiln.take' ? 'loot' : 'build', text: r.text }, actor);
    else ctx.emit({ kind: r.reason === 'bagfull' ? 'full' : 'notice', text: r.text }, actor);
    return true;
  }

  const bump = () => { st.r++; };
  const debug = {
    state() {
      const s = JSON.parse(JSON.stringify(sliceOf(st)));
      s.burning = Object.keys(st.k).filter(k => burning(st.k[k]));
      return s;
    },
    spawn(x = 0, z = 0) {
      if (!host()) return false;
      const w = ctx.world; if (!w || !Array.isArray(w.decor) || !Array.isArray(w.tiles)) return false;
      if (decorAt(x, z) === 'kiln') return true;
      if (decorAt(x, z) || !w.tiles.some(t => t[0] === x && t[1] === z)) return false;
      w.decor.push({ type: 'kiln', x, z }); ctx.rebuildRaft?.(); dirty = true;
      return true;
    },
    give(kind, n = 10) { if (!host()) return false; const b = ctx.localBag?.(); return b ? n - b.add(kind, n) : 0; },
    fill(x, z, entry) {
      if (!host()) return false;
      const e = cleanEntry(entry), key = keyOf(x, z);
      if (e) st.k[key] = e; else delete st.k[key];
      bump(); return true;
    },
    finish(x, z) {
      if (!host()) return false;
      const e = st.k[keyOf(x, z)]; if (!e || e.q === 0) return false;
      e.o = SMELT[e.r].out; e.n += e.q; e.q = 0; e.r = null; e.t = 0; e.h = 0;
      bump(); return true;
    },
    run(sec) {
      if (!host()) return false;
      const n = Math.max(0, Math.min(3600, Math.floor(+sec || 0)));
      for (let i = 0; i < n; i++) stepAll(st, 1, onDone);
      bump(); return true;
    },
    clear() { if (!host()) return false; st.k = {}; bump(); return true; },
  };

  return {
    name: 'kiln',
    serialize, load, action, interact, prompt, update, debug,
    decorModel(type) {
      if (!T) return null;
      if (type === 'kiln') { model ??= buildKiln(T); dirty = true; return model.instance(); }
      if (type === 'glasslamp') { lamp ??= buildGlassLamp(T); return lamp.instance(); }
      return null;
    },
    dispose() { model?.dispose(); lamp?.dispose(); model = null; lamp = null; },
  };
}
