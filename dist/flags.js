// Raft flag (see docs/specs/raft-flag.md). Content module 'flags': a craftable Flagpole whose cloth flag each
// player designs in a small dialog (background, pattern, pattern colour, emblem, emblem colour).
// Slice: world.ext.flags = {v, r, s, f:{'x,z':[bg,pat,patCol,emb,embCol]}}. Host-authoritative action 'flag.set';
// guests send it with ctx.action() and wait for the host's ext. A design change swaps the cloth material in
// place: rebuildRaft is never called. The cloth waves in a shader driven by two shared uniforms.
import { DEFAULT, MAX_FLAGS, REACH, PALETTE, COLOR_NAMES, PATTERNS, EMBLEMS, EMBLEM_PATHS, keyOf, designKey, cleanDesign, cleanSlice, pruneSlice, applyFlagAction } from './flags-core.js?build=v3-survival-ae77fa84ac2b';
import { buildFlagModel, paintFlag } from './flags-model.js?build=v3-survival-ae77fa84ac2b';

const isInt = Number.isInteger;
const finite = v => (Number.isFinite(v) ? v : undefined);
const REFUSALS = { far: 'Step a little closer', full: `This raft already flies ${MAX_FLAGS} flags` };
export const OLD_HOST = 'Host’s game is older';
const RESCAN_S = 2;
const POLE_Y0 = .2, POLE_Y1 = 3.5; // aimable span of the mast above the tile top
// windDir is the heading the wind blows toward, world (sin, cos); the cloth runs along local +X, which rotation.y = a
// maps to (cos a, -sin a), so downwind is a = windDir - PI/2 (as the sail pennant in sailing-world.js does).
const QUARTER = Math.PI / 2;

export function createFlags(ctx) {
  const T = ctx.T;
  const session = Math.random().toString(36).slice(2, 10);
  let st = cleanSlice(undefined); st.s = session;
  let models = null, dirty = false, cache = null, cacheR = -1, cacheSt = null, netR = -1, netS = null, hostHasFlags = true;
  let ui = null, uiLoading = null, disposed = false, seenDecor = null, seenLen = -1, scanT = 0, canvasOK = null;
  const live = new Map(); // tile key -> group
  const anim = [];        // { g, pivot, ph } (compacted in place on rescan)
  const texs = new Map(); // design key -> { tex, mat }
  const scratch = T ? new T.Vector3() : null;
  const realTex = T?.Texture?.prototype.dispose, realMat = T?.Material?.prototype.dispose;
  const noop = () => {};
  const oldHost = () => ctx.role === 'guest' && !hostHasFlags;
  const isHost = () => ctx.role !== 'guest';

  const decorAt = (x, z) => { const d = ctx.world?.decor; if (!Array.isArray(d)) return null; for (let i = 0; i < d.length; i++) if (d[i].x === x && d[i].z === z) return d[i].type; return null; };
  const posOf = actor => { if (actor === 'guest') return ctx.other ?? null; const p = ctx.physics; return p ? { x: p.x, z: p.z } : null; };

  // ---------------------------------------------------------------- cloth texture cache
  function makeCanvas() {
    try {
      if (typeof document !== 'undefined' && document.createElement) { const c = document.createElement('canvas'); c.width = 128; c.height = 64; return c; }
      if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(128, 64);
    } catch { /* no canvas: plain coloured cloth */ }
    return null;
  }
  const texKey = d => (canvasOK === false ? 'c' + d[0] : designKey(d));
  function matFor(d) {
    let key = texKey(d), e = texs.get(key);
    if (e) return e;
    let tex = null;
    if (canvasOK !== false) {
      const canvas = makeCanvas(), g2d = canvas?.getContext?.('2d');
      if (g2d) {
        canvasOK = true;
        paintFlag(g2d, d, 128, 64);
        tex = new T.CanvasTexture(canvas);
        tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
        tex.dispose = noop; tex.userData.shared = true;
      } else { canvasOK = false; key = texKey(d); e = texs.get(key); if (e) return e; }
    }
    const mat = models.waveMaterial(tex);
    if (!tex) mat.color.set(PALETTE[d[0]]);
    mat.dispose = noop; mat.userData.shared = true; // disposeGeometry() on rebuild must not free the cache
    e = { tex, mat }; texs.set(key, e);
    return e;
  }
  function freeTex(e) { try { if (e.tex) realTex?.call(e.tex); realMat?.call(e.mat); } catch { /* ignore */ } }
  function prune() {
    if (!texs.size) return;
    const keep = new Set();
    for (const k of Object.keys(st.f)) keep.add(texKey(st.f[k]));
    for (const k of live.keys()) if (!st.f[k]) { keep.add(texKey(DEFAULT)); break; }
    for (const [k, e] of texs) if (!keep.has(k)) { freeTex(e); texs.delete(k); }
  }
  function dress(g, k) {
    const cloth = g?.userData?.cloth; if (!cloth || !models) return;
    cloth.material = matFor(st.f[k] ?? DEFAULT).mat;
  }

  /** After any state change: re-dress the live poles whose design changed, then free unused textures. */
  function apply(prevF) {
    const keys = new Set([...Object.keys(prevF || {}), ...Object.keys(st.f)]);
    for (const k of keys) {
      const g = live.get(k); if (!g) continue;
      if (designKey(prevF?.[k] ?? DEFAULT) !== designKey(st.f[k] ?? DEFAULT)) dress(g, k);
    }
    prune();
  }

  // ---------------------------------------------------------------- aim target
  // Ray vs the vertical mast segment (closest approach), or vs the cloth centre downwind of the masthead.
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else { if (!scratch) return null; cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const top = (ctx.raft?.position.y ?? 0) + .22, s = w.sailing, wd = Number.isFinite(s?.windDir) ? s.windDir : 0;
    const fx = Math.sin(wd), fz = Math.cos(wd); // the cloth streams downwind
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (!d || d.type !== 'flagpole' || !isInt(d.x) || !isInt(d.z)) continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      // mast: segment A=(cx, top+Y0, cz) .. +L along +Y
      const L = POLE_Y1 - POLE_Y0, wx = ox - cx, wy = oy - (top + POLE_Y0), wz = oz - cz;
      const b = dy, dd = dx * wx + dy * wy + dz * wz, den = 1 - b * b;
      let sc, tc;
      if (den < 1e-6) { sc = 0; tc = wy; } else { sc = (b * wy - dd) / den; tc = (wy - b * dd) / den; }
      tc = Math.min(L, Math.max(0, tc)); sc = Math.max(0, b * tc - dd);
      const ex = wx + dx * sc - 0, ey = wy + dy * sc - tc, ez = wz + dz * sc;
      let off = Math.sqrt(ex * ex + ey * ey + ez * ez), along = sc;
      if (off > .4) { // cloth centre
        const vx = cx + fx * .65 - ox, vy = top + 3.0 - oy, vz = cz + fz * .65 - oz, al = vx * dx + vy * dy + vz * dz;
        if (al > 0) {
          const qx = vx - dx * al, qy = vy - dy * al, qz = vz - dz * al, o2 = Math.sqrt(qx * qx + qy * qy + qz * qz);
          if (o2 < .55 && o2 < off) { off = o2; along = al; }
        }
      }
      if (off > .55 || along <= 0) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  // ---------------------------------------------------------------- dialog
  const api = {
    ctx,
    design: (x, z) => st.f[keyOf(x, z)]?.slice() ?? null,
    send: a => { ctx.action(a); },
    PALETTE, COLOR_NAMES, PATTERNS, EMBLEMS, EMBLEM_PATHS, paintFlag, cleanDesign, DEFAULT,
  };
  function loadUI() {
    if (ui || uiLoading || typeof document === 'undefined') return uiLoading;
    uiLoading = import('./flags-ui.js?build=v3-survival-ae77fa84ac2b').then(m => { if (disposed) return null; ui = m.createFlagUI(api); return ui; }).catch(e => { console.error('flag ui failed', e); uiLoading = null; return null; });
    return uiLoading;
  }
  function openFlag(x, z) {
    const go = u => u && u.open(x, z);
    if (ui) go(ui); else loadUI()?.then(u => { if (ctx.running !== false && !ctx.uiOpen?.()) go(u); }); // the game may have paused while the UI loaded
    return true;
  }

  // ---------------------------------------------------------------- save / net
  function hostPrune() { // host only: drop entries whose pole is gone (shark breaks, pick-up)
    const decor = ctx.world?.decor;
    if (!isHost() || !Array.isArray(decor)) return;
    const prevF = { ...st.f };
    if (pruneSlice(st, decor)) { st.r++; apply(prevF); }
  }
  function decorChanged() {
    const dec = ctx.world?.decor;
    if (dec !== seenDecor || (dec && dec.length !== seenLen)) { seenDecor = dec; seenLen = Array.isArray(dec) ? dec.length : -1; return true; }
    return false;
  }
  function serialize() {
    if (isHost() && decorChanged()) rescan(); // a save never stores an orphan entry
    if (cache && cacheSt === st && cacheR === st.r) return cache;
    const f = {};
    for (const k of Object.keys(st.f)) f[k] = st.f[k].slice();
    cache = { v: 1, r: st.r, s: st.s, f }; cacheSt = st; cacheR = st.r;
    return cache;
  }
  function load(data, from) {
    const prev = st;
    if (from === 'net') {
      hostHasFlags = data !== undefined;
      if (data?.r === netR && data?.s === netS) return; // unchanged host state
      st = cleanSlice(data); // no decor pruning: the guest's decor may lag, the host is authoritative
      netR = data?.r; netS = data?.s;
    } else {
      st = cleanSlice(data, ctx.world?.decor); st.s = session; st.r = prev.r + 1; // monotonic in this session (a huge saved r cannot stall r++)
      netR = -1; netS = null; hostHasFlags = true;
    }
    apply(prev.f);
  }

  // ---------------------------------------------------------------- per frame
  function rescan() {
    dirty = false; scanT = 0;
    let n = 0;
    for (let i = 0; i < anim.length; i++) if (anim[i].g.parent) anim[n++] = anim[i];
    anim.length = n;
    let gone = false;
    for (const [k, g] of live) if (!g.parent) { live.delete(k); gone = true; }
    if (ui?.isOpen) { const [x, z] = ui.tile.split(',').map(Number); if (decorAt(x, z) !== 'flagpole') ui.close(); } // pole broke or was picked up
    hostPrune();
    if (gone) prune(); // a dead pole may have held the only DEFAULT cloth
  }

  function update(dt) {
    const s = ctx.world?.sailing, t = ctx.elapsed ?? 0;
    const wd = finite(s?.windDir) ?? 0, ws = finite(s?.windStr) ?? .3;
    if (models) { models.uniforms.uTime.value = t; models.uniforms.uStr.value = ws; }
    for (let i = 0; i < anim.length; i++) {
      const a = anim[i];
      a.pivot.rotation.y = wd - QUARTER - a.g.rotation.y + .06 * Math.sin(t * 1.3 + a.ph);
    }
    if (decorChanged()) dirty = true;
    if (isHost()) { scanT += Number.isFinite(dt) ? dt : 0; if (scanT >= RESCAN_S) dirty = true; }
    if (dirty) rescan();
  }

  function dropTile(x, z) { // a pole was picked up: its design goes with it (like sign text)
    if (!isInt(x) || !isInt(z)) return;
    const k = keyOf(x, z);
    if (ui?.isOpen && ui.tile === k) ui.close();
    if (!isHost() || !st.f[k]) return;
    const prevF = { ...st.f };
    delete st.f[k]; st.r++; live.delete(k); // its group is about to be rebuilt away: do not re-dress it
    apply(prevF);
  }

  return {
    name: 'flags',
    serialize,
    load,
    update,
    action(a, actor) {
      if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('flag.')) return false;
      if (a.kind !== 'flag.set') return true;
      const prevF = { ...st.f };
      const res = applyFlagAction(st, a, actor, { decorAt, pos: posOf });
      if (res.ok && !res.same) { apply(prevF); ctx.emit?.({ kind: 'build', text: 'Flag raised!' }, actor); }
      else if (!res.ok && REFUSALS[res.reason]) ctx.emit?.({ kind: 'notice', text: REFUSALS[res.reason] }, actor);
      return true;
    },
    interact(aim) {
      if (ctx.uiOpen?.()) return false;
      const d = target(aim); if (!d) return false;
      if (oldHost()) { ctx.notice?.(OLD_HOST, 2400); return true; }
      ctx.releaseLock?.(); openFlag(d.x, d.z);
      return true;
    },
    prompt(aim) {
      const d = target(aim); if (!d) return null;
      if (oldHost()) return OLD_HOST;
      return '<kbd>E</kbd>Design flag';
    },
    decorModel(type, d) {
      if (type !== 'flagpole' || !T || !d || !isInt(d.x) || !isInt(d.z)) return null;
      models ??= buildFlagModel(T);
      const k = keyOf(d.x, d.z), g = models.instance();
      g.userData.tileKey = k;
      dress(g, k);
      live.set(k, g);
      anim.push({ g, pivot: g.userData.pivot, ph: d.x * 1.7 + d.z * 2.3 });
      dirty = true;
      return g;
    },
    afterUndecor(d) { if (d && d.type === 'flagpole') dropTile(d.x, d.z); }, // [decor-pickup] hook
    debug: {
      place(x = 0, z = 0) {
        const w = ctx.world;
        if (!isHost() || !isInt(x) || !isInt(z) || !w || !Array.isArray(w.decor) || !Array.isArray(w.tiles)) return false;
        if (!w.tiles.some(t => t[0] === x && t[1] === z) || decorAt(x, z)) return false;
        w.decor.push({ type: 'flagpole', x, z }); ctx.rebuildRaft();
        return true;
      },
      set(x, z, d) { ctx.action({ kind: 'flag.set', x, z, d }); return true; },
      open(x = 0, z = 0) { return openFlag(x, z); },
      close() { ui?.close(); },
      isOpen() { return !!ui?.isOpen; },
      state() { return JSON.parse(JSON.stringify(serialize())); },
      texCount() { return texs.size; },
      wind() { return { uTime: models?.uniforms.uTime.value ?? 0, uStr: models?.uniforms.uStr.value ?? 0, yaw: anim.map(a => a.pivot.rotation.y) }; },
      models() { return models?.stats() ?? null; },
    },
    dispose() {
      disposed = true;
      ui?.destroy(); ui = null; uiLoading = null;
      for (const e of texs.values()) freeTex(e);
      texs.clear();
      models?.dispose(); models = null;
      live.clear(); anim.length = 0;
    },
  };
}
