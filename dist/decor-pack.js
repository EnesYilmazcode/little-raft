// Decoration pack + writable signs (see docs/specs/decor-signs.md). Content module 'decorpack'.
// Seven placeable decor pieces that turn in quarter steps on E; the Signboard carries up to 3 short
// lines of text (E opens a small dialog). Slice: world.ext.decorpack = {v, r, s, t, rot}.
// Host-authoritative actions 'decor.turn' / 'decor.write'; guests send them with ctx.action().
// Tiles are updated in place: rebuildRaft is never called for text or rotation.
import { ITEM_INFO } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { buildDecorPack, paintSign } from './decor-pack-models.js?build=v3-survival-ae77fa84ac2b';
import { PACK, MAX_LINES, LINE_MAX, MAX_ROT, MAX_SIGNS, REACH, keyOf, linesKey, faceRot, cleanSlice, applyDecorAction } from './signs-core.js?build=v3-survival-ae77fa84ac2b';

const isInt = Number.isInteger;
const CY = { rug: .1, sign: 1.09 };
const REFUSALS = { far: 'Step a little closer', full: `This raft already has ${MAX_SIGNS} written signs` };

export function createDecorPack(ctx) {
  const T = ctx.T;
  const session = Math.random().toString(36).slice(2, 10);
  let st = cleanSlice(undefined); st.s = session;
  let models = null, dirty = false, cache = null, cacheR = -1, cacheSt = null, netR = -1, netS = null;
  let ui = null, uiLoading = null, disposed = false, seenDecor = null, seenLen = -1; // decor array/length last scanned (removals call no decorModel)
  const live = new Map();   // tile key -> group
  let anim = [];            // { g, swing, type, ph }
  const texts = new Map();  // linesKey -> { tex, mat }
  const scratch = T ? new T.Vector3() : null;
  const realTex = T?.Texture?.prototype.dispose, realMat = T?.Material?.prototype.dispose;
  const noop = () => {};

  const decorAt = (x, z) => { const d = ctx.world?.decor; if (!Array.isArray(d)) return null; for (let i = 0; i < d.length; i++) if (d[i].x === x && d[i].z === z) return d[i].type; return null; };
  const posOf = actor => { if (actor === 'guest') return ctx.other ?? null; const p = ctx.physics; return p ? { x: p.x, z: p.z } : null; };

  // ---------------------------------------------------------------- sign text
  function makeCanvas() {
    try {
      if (typeof document !== 'undefined' && document.createElement) { const c = document.createElement('canvas'); c.width = 256; c.height = 128; return c; }
      if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(256, 128);
    } catch { /* no canvas: the text stays hidden */ }
    return null;
  }
  function textFor(lines) {
    const key = linesKey(lines);
    let e = texts.get(key);
    if (e) return e;
    const canvas = makeCanvas(), g2d = canvas?.getContext?.('2d');
    if (!g2d) return null;
    paintSign(g2d, lines, 256, 128);
    const tex = new T.CanvasTexture(canvas);
    tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new T.MeshLambertMaterial({ map: tex }); mat.name = 'decorSignText';
    tex.dispose = noop; mat.dispose = noop; // disposeGeometry() on rebuild must not free the cache
    e = { tex, mat }; texts.set(key, e);
    return e;
  }
  function applyText(g, lines) {
    const text = g?.userData?.text; if (!text) return;
    const e = Array.isArray(lines) && lines.length ? textFor(lines) : null;
    if (!e) { text.visible = false; return; }
    text.material = e.mat; text.visible = true;
  }
  function freeText(e) { try { realTex?.call(e.tex); realMat?.call(e.mat); } catch { /* ignore */ } }
  function prune() {
    if (!texts.size) return;
    const keep = new Set(); for (const k of Object.keys(st.t)) keep.add(linesKey(st.t[k]));
    for (const [k, e] of texts) if (!keep.has(k)) { freeText(e); texts.delete(k); }
  }

  /** After any state change: update the live groups whose rotation/text changed, then free unused text. */
  function apply(prevT, prevRot) {
    const keys = new Set([...Object.keys(prevT || {}), ...Object.keys(st.t), ...Object.keys(prevRot || {}), ...Object.keys(st.rot)]);
    for (const k of keys) {
      const g = live.get(k); if (!g) continue;
      if ((prevRot?.[k] ?? 0) !== (st.rot[k] ?? 0)) g.rotation.y = (st.rot[k] ?? 0) * Math.PI / 2;
      if (linesKey(prevT?.[k] ?? []) !== linesKey(st.t[k] ?? [])) applyText(g, st.t[k]);
    }
    prune();
  }

  // ---------------------------------------------------------------- aim target
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else { if (!scratch) return null; cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (!PACK.includes(d.type)) continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      const cy = (ctx.raft?.position.y ?? 0) + (CY[d.type] ?? .8);
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > (d.type === 'rug' ? 1 : .85)) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  // ---------------------------------------------------------------- dialog
  const api = {
    ctx,
    lines: (x, z) => (st.t[keyOf(x, z)] ?? []).slice(),
    send: a => { ctx.action(a); },
    maxLines: MAX_LINES, lineMax: LINE_MAX,
  };
  function loadUI() {
    if (ui || uiLoading || typeof document === 'undefined') return uiLoading;
    uiLoading = import('./signs-ui.js?build=v3-survival-ae77fa84ac2b').then(m => { if (disposed) return null; ui = m.createSignUI(api); return ui; }).catch(e => { console.error('sign ui failed', e); uiLoading = null; return null; });
    return uiLoading;
  }
  // The lock is released only once the dialog can open: on a first use the import resolves later, and by then
  // another panel may have opened (it owns the cursor) or the load may have failed (keep the lock: no free cursor).
  function openSign(x, z) {
    const go = u => { if (!u) return; ctx.releaseLock?.(); u.open(x, z); };
    if (ui) go(ui); else loadUI()?.then(u => { if (u && !ctx.uiOpen?.()) go(u); });
    return true;
  }

  // ---------------------------------------------------------------- save / net
  function serialize() {
    if (cache && cacheSt === st && cacheR === st.r) return cache;
    const t = {}, rot = {};
    for (const k of Object.keys(st.t)) t[k] = st.t[k].slice();
    for (const k of Object.keys(st.rot)) rot[k] = st.rot[k];
    cache = { v: 1, r: st.r, s: st.s, t, rot }; cacheSt = st; cacheR = st.r;
    return cache;
  }
  function load(data, from) {
    const prev = st;
    if (from === 'net') {
      if (data?.r === netR && data?.s === netS) return; // unchanged host state
      st = cleanSlice(data); // no decor pruning: the guest's decor may lag, the host is authoritative
      netR = data?.r; netS = data?.s;
    } else {
      st = cleanSlice(data, ctx.world?.decor); st.s = session; st.r++;
      netR = -1; netS = null;
    }
    apply(prev.t, prev.rot);
  }

  // ---------------------------------------------------------------- per frame
  function rescan() {
    dirty = false;
    anim = anim.filter(a => a.g.parent);
    for (const [k, g] of live) if (!g.parent) live.delete(k);
    if (ctx.role === 'guest') return;
    const decor = Array.isArray(ctx.world?.decor) ? ctx.world.decor : [];
    const prevT = { ...st.t }, prevRot = { ...st.rot }, types = new Map();
    let changed = false, nRot = Object.keys(st.rot).length;
    const me = ctx.physics, other = ctx.other;
    for (const d of decor) {
      if (!d || !isInt(d.x) || !isInt(d.z)) continue;
      const k = keyOf(d.x, d.z); types.set(k, d.type);
      if (!PACK.includes(d.type) || st.rot[k] !== undefined || nRot >= MAX_ROT) continue;
      const cx = d.x * 2, cz = d.z * 2;
      let near = null, best = Infinity;
      for (const p of [me, other]) {
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
        const dd = Math.hypot(p.x - cx, p.z - cz); if (dd < best) { best = dd; near = p; }
      }
      st.rot[k] = near ? faceRot(near.x - cx, near.z - cz) : 0; nRot++; changed = true;
    }
    for (const k of Object.keys(st.rot)) if (!PACK.includes(types.get(k))) { delete st.rot[k]; changed = true; }
    for (const k of Object.keys(st.t)) if (types.get(k) !== 'sign') { delete st.t[k]; changed = true; }
    if (changed) { st.r++; apply(prevT, prevRot); }
  }

  function update() {
    const t = ctx.elapsed ?? 0, s = ctx.world?.sailing;
    const wd = Number.isFinite(s?.windDir) ? s.windDir : 0, ws = Number.isFinite(s?.windStr) ? s.windStr : .3;
    for (let i = 0; i < anim.length; i++) {
      const a = anim[i], sw = a.swing, ph = a.ph;
      if (a.type === 'pennant') {
        const amp = .08 + .35 * ws * ws;
        sw.rotation.y = wd - a.g.rotation.y + amp * Math.sin(t * (4 + 4 * ws) + ph);
        sw.rotation.x = .2 * amp * Math.sin(t * 5.1 + ph);
      } else if (a.type === 'fern') {
        sw.rotation.z = .05 * Math.sin(t * 1.1 + ph);
        sw.rotation.x = .03 * Math.sin(t * .8 + ph);
      } else if (a.type === 'chime') {
        sw.rotation.z = .08 * Math.sin(t * 1.9 + ph) + .03 * Math.sin(t * 4.3 + ph);
        sw.rotation.x = .04 * Math.sin(t * 1.3 + ph);
      }
    }
    const dec = ctx.world?.decor;
    if (dec !== seenDecor || (dec && dec.length !== seenLen)) { seenDecor = dec; seenLen = dec ? dec.length : -1; dirty = true; }
    if (dirty) rescan();
  }

  return {
    name: 'decorpack',
    serialize,
    load,
    update,
    action(a, actor) {
      if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('decor.')) return false;
      const prevT = { ...st.t }, prevRot = { ...st.rot };
      const res = applyDecorAction(st, a, actor, { decorAt, pos: posOf });
      if (res.ok && !res.same) apply(prevT, prevRot);
      if (res.ok && !res.same && a.kind === 'decor.write') ctx.emit?.({ kind: 'build', text: res.lines.length ? 'Sign painted!' : 'Sign wiped clean' }, actor);
      else if (!res.ok && REFUSALS[res.reason]) ctx.emit?.({ kind: 'notice', text: REFUSALS[res.reason] }, actor);
      return true;
    },
    interact(aim) {
      if (ctx.uiOpen?.()) return false;
      const d = target(aim); if (!d) return false;
      if (d.type === 'sign') openSign(d.x, d.z); // releases the lock when the dialog opens
      else ctx.action({ kind: 'decor.turn', x: d.x, z: d.z });
      return true;
    },
    prompt(aim) {
      const d = target(aim); if (!d) return null;
      if (d.type === 'sign') {
        const first = st.t[keyOf(d.x, d.z)]?.[0];
        return '<kbd>E</kbd>Write on sign' + (first ? ' · “' + ctx.esc(first) + '”' : '');
      }
      return '<kbd>E</kbd>Turn ' + (ITEM_INFO[d.type]?.name ?? d.type);
    },
    decorModel(type, d) {
      if (!PACK.includes(type) || !T || !d || !isInt(d.x) || !isInt(d.z)) return null;
      models ??= buildDecorPack(T);
      const k = keyOf(d.x, d.z), g = models.instance(type);
      g.rotation.y = (st.rot[k] ?? 0) * Math.PI / 2;
      g.userData.tileKey = k;
      live.set(k, g);
      if (g.userData.swing) anim.push({ g, swing: g.userData.swing, type, ph: d.x * 1.7 + d.z * 2.3 });
      if (type === 'sign') applyText(g, st.t[k]);
      dirty = true;
      return g;
    },
    debug: {
      place(type, x = 0, z = 0) {
        const w = ctx.world;
        if (ctx.role === 'guest' || !PACK.includes(type) || !isInt(x) || !isInt(z) || !w || !Array.isArray(w.decor)) return false;
        if (!w.tiles.some(t => t[0] === x && t[1] === z) || decorAt(x, z)) return false;
        w.decor.push({ type, x, z }); ctx.rebuildRaft();
        return true;
      },
      write(x, z, lines) { ctx.action({ kind: 'decor.write', x, z, lines }); return true; },
      turn(x, z) { ctx.action({ kind: 'decor.turn', x, z }); return true; },
      open(x = 0, z = 0) { return openSign(x, z); },
      close() { ui?.close(); },
      isOpen() { return !!ui?.isOpen; },
      state() { return JSON.parse(JSON.stringify(serialize())); },
      texCount() { return texts.size; },
      anim() { return anim.map(a => ({ type: a.type, ry: a.swing.rotation.y, rz: a.swing.rotation.z })); },
      models() { return models?.stats() ?? null; },
      faceAll() { dirty = true; return true; },
    },
    dispose() {
      disposed = true;
      ui?.destroy(); ui = null; uiLoading = null;
      for (const e of texts.values()) freeText(e);
      texts.clear();
      models?.dispose(); models = null; // also frees the shared textPlane
      live.clear(); anim = [];
    },
  };
}
