// [camera] Little Camera held-tool runtime (docs/specs/camera.md).
// Top: pure helpers (no DOM, no THREE), unit-tested in node. Bottom: createCamera(T, host) ->
//   {use(kind), update(dt), onNet(msg), share(id), request(id), foreign(id), onPhoto(fn), dispose(), debug, store}
//   host = {scene, camera, renderer, hands(), ghosts(), quality(), diving(), sfx, notice(s), send(msg), netReady(), role(), running(), now?()}
// Capture: hide the viewmodel + build ghost, render once more, copy the WebGL canvas into a 256x144 2D canvas in the
// same task (no preserveDrawingBuffer), restore, then encode a JPEG asynchronously and store it (photo-store.js).
// Co-op: {type:'photo', id, data} shares one framed photo; {type:'photo', id, want:1} asks for one. Foreign photos
// are kept in memory only (LRU 32), never in the album or the save.
import { sharedPhotoStore, newId, ID_RE, validPhotoData, PHOTO_CAP } from './photo-store.js?build=v3-survival-ae77fa84ac2b';

export const SHOT_GAP = 0.6, PHOTO_W = 256, PHOTO_H = 144, SHARE_GAP_MS = 10000, WANT_GAP_MS = 15000, REPLY_GAP_MS = 3000, FOREIGN_CAP = 32;
export const STUCK_S = 12;   // a save still "in flight" after this long is treated as lost (hung storage), so the camera never locks up
export const JPEG_BYTES = 17000; // re-encode above this so the data URL stays under MAX_DATA (24000 chars)

/** True when a new shot may start: not busy (or busy for longer than STUCK_S) and at least SHOT_GAP seconds since the last one. */
export function shotGate(now, last, busy) {
  if (!Number.isFinite(now)) return false;
  if (busy) return Number.isFinite(last) && now - last >= STUCK_S;
  return !Number.isFinite(last) || now - last >= SHOT_GAP;
}

/** Centre crop of a w x h buffer to the aspect (default 16:9) -> {sx, sy, sw, sh}. */
export function centerCrop(w, h, aspect = PHOTO_W / PHOTO_H) {
  if (!(w > 0) || !(h > 0)) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  let sw = w, sh = w / aspect;
  if (sh > h) { sh = h; sw = h * aspect; }
  return { sx: Math.floor((w - sw) / 2), sy: Math.floor((h - sh) / 2), sw: Math.floor(sw), sh: Math.floor(sh) };
}

/** Untrusted photo message -> {id, want:true} | {id, data} | null. */
export function cleanPhotoMsg(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.type !== 'photo') return null;
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) return null;
  if (m.want === 1) return { id: m.id, want: true };
  if (validPhotoData(m.data)) return { id: m.id, data: m.data };
  return null;
}

/** Small LRU map (id -> data URL). */
export function createForeignCache(cap = FOREIGN_CAP) {
  const m = new Map();
  return {
    get(id) { if (!m.has(id)) return undefined; const v = m.get(id); m.delete(id); m.set(id, v); return v; },
    has: id => m.has(id),
    set(id, v) { m.delete(id); m.set(id, v); while (m.size > cap) m.delete(m.keys().next().value); },
    get size() { return m.size; },
    keys: () => [...m.keys()],
    clear: () => m.clear(),
  };
}

/** Per-id gate: true at most once per gapMs for each id. */
export function idGate(gapMs) {
  const last = new Map();
  return (id, now) => {
    const t = last.get(id);
    if (t !== undefined && now - t < gapMs) return false;
    last.set(id, now); if (last.size > 256) last.delete(last.keys().next().value);
    return true;
  };
}

/** Page-wide handle so the photo frame content module can reach the live camera runtime. */
export const photoNet = { current: null };

// ---------------------------------------------------------------- engine half
const FLASH_ID = 'cameraFlash', FLASH_STYLE = 'little-raft-camera-style';
const FLASH_CSS = `#${FLASH_ID}{position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:60;transition:opacity .32s ease-out}
#${FLASH_ID}.cf-on{transition:none;opacity:.95}
@media (prefers-reduced-motion:reduce){#${FLASH_ID}.cf-on{opacity:.4}}`;

function flashEl() {
  if (typeof document === 'undefined') return null;
  if (!document.getElementById(FLASH_STYLE)) { const s = document.createElement('style'); s.id = FLASH_STYLE; s.textContent = FLASH_CSS; document.head.append(s); }
  let el = document.getElementById(FLASH_ID);
  if (!el) { el = document.createElement('div'); el.id = FLASH_ID; el.setAttribute('aria-hidden', 'true'); document.body.append(el); }
  return el;
}

const toBlob = (c, q) => new Promise(res => { try { c.toBlob(b => res(b), 'image/jpeg', q); } catch { res(null); } });

export function createCamera(T, host = {}) {
  const now = () => (typeof host.now === 'function' ? host.now() : performance.now());
  const get = f => { try { return typeof f === 'function' ? f() : f; } catch { return null; } };
  const notice = (s, ms) => { try { host.notice?.(s, ms); } catch {} };
  const foreignCache = createForeignCache(), shareGate = idGate(SHARE_GAP_MS), wantGate = idGate(WANT_GAP_MS), replyGate = idGate(REPLY_GAP_MS);
  let flashTimer = 0, shotSeq = 0;
  const listeners = new Set();
  let disposed = false, busy = false, lastShot = -Infinity, shots = 0, lastBytes = 0, lastId = null, canvas = null, ctx2d = null;
  let store = null;
  const storeP = sharedPhotoStore({ notice: s => notice(s, 3200) }).then(s => { store = s; return s; }).catch(e => { console.warn('[camera] photo store failed', e); return null; });

  function snapCanvas() {
    if (!canvas) {
      canvas = document.createElement('canvas'); canvas.width = PHOTO_W; canvas.height = PHOTO_H;
      ctx2d = canvas.getContext('2d');
    }
    return ctx2d;
  }

  // Synchronous: must run in the same task as the render, or the drawing buffer is already cleared.
  function grab() {
    const r = host.renderer, scene = host.scene, cam = host.camera;
    if (!r || !scene || !cam) throw new Error('no renderer');
    const hands = get(host.hands), ghosts = get(host.ghosts), depth = cam.getObjectByName?.('viewmodelDepthClear');
    const hv = hands?.group?.visible, dv = depth?.visible;
    const g = snapCanvas(); if (!g) throw new Error('no 2d canvas');
    try {
      if (hands?.group) hands.group.visible = false;
      if (depth) depth.visible = false;
      ghosts?.hide?.();
      r.render(scene, cam);
      get(host.diving)?.render?.(r);
      const el = r.domElement, { sx, sy, sw, sh } = centerCrop(el.width, el.height);
      g.fillStyle = '#000'; g.fillRect(0, 0, PHOTO_W, PHOTO_H);
      g.drawImage(el, sx, sy, sw, sh, 0, 0, PHOTO_W, PHOTO_H);
    } finally {
      if (hands?.group && hv !== undefined) hands.group.visible = hv;
      if (depth && dv !== undefined) depth.visible = dv;
      try { get(host.quality)?.reset?.(); } catch {}
    }
  }

  function flash() {
    const el = flashEl(); if (!el) return;
    el.classList.add('cf-on');
    void el.offsetWidth;                              // hold the bright frame a moment (one rAF was too faint to notice), then fade
    clearTimeout(flashTimer); flashTimer = setTimeout(() => el.classList.remove('cf-on'), 70);
  }

  function dayNow() {
    try { const d = globalThis.window?.raftDebug?.content?.daynight?.state?.()?.day; return Number.isInteger(d) && d >= 0 ? d : undefined; } catch { return undefined; }
  }

  async function encode() {
    let blob = await toBlob(canvas, 0.75);
    if (blob && blob.size > JPEG_BYTES) blob = (await toBlob(canvas, 0.6)) || blob;
    if (blob && blob.size > JPEG_BYTES) blob = (await toBlob(canvas, 0.45)) || blob;
    return blob;
  }

  async function save(at, day, seq) {
    try {
      const blob = await encode();
      if (!blob) throw new Error('encode failed');
      lastBytes = blob.size;
      const s = store || await storeP;
      if (!s) throw new Error('no store');
      if (s.count >= PHOTO_CAP) { notice(`Album full (${PHOTO_CAP}). Press P to make room.`, 3200); return; }
      const id = newId(at);
      const r = await s.add({ id, at, day, blob });
      if (r.ok) { shots++; lastId = id; notice(`Photo saved (${r.count}/${PHOTO_CAP}). P opens your album.`, 2600); }
      else if (r.reason === 'full') notice(`Album full (${PHOTO_CAP}). Press P to make room.`, 3200);
      // 'quota': the store already said "No room to keep more photos here."
    } catch (e) {
      console.warn('[camera] save failed', e);
      notice('The camera jammed. Try again.');
    } finally { if (seq === shotSeq) busy = false; }   // a stale (hung) save never unlocks a newer shot
  }

  function capture() {
    if (busy) console.warn('[camera] previous save never finished; starting a new shot');
    busy = true; lastShot = now() / 1000; const seq = ++shotSeq;
    try { grab(); }
    catch (e) { busy = false; console.warn('[camera] capture failed', e); notice('The camera jammed. Try again.'); return false; }
    try { flash(); } catch {}
    try { host.sfx?.play?.('shutter'); } catch {}
    save(Date.now(), dayNow(), seq);
    return true;
  }

  function use(kind) {
    if (disposed || kind !== 'camera') return false;
    if (!shotGate(now() / 1000, lastShot, busy)) return true;  // consumed: too soon or still saving
    capture();
    return true;
  }

  // ---------- co-op sharing ----------
  const netOk = () => { try { return !!host.netReady?.(); } catch { return false; } };
  async function share(id, force = false) {
    if (disposed || !ID_RE.test(id || '') || !netOk()) return false;
    if (!(force ? replyGate(id, now()) : shareGate(id, now()))) return false;
    const s = store || await storeP; if (!s || !s.has(id)) return false;
    const data = await s.dataURL(id);
    if (!validPhotoData(data) || !netOk()) return false;
    try { host.send?.({ type: 'photo', id, data }); } catch { return false; }
    return true;
  }
  function request(id) {
    if (disposed || !ID_RE.test(id || '') || foreignCache.has(id) || !netOk()) return false;
    if (!wantGate(id, now())) return false;
    try { host.send?.({ type: 'photo', id, want: 1 }); } catch { return false; }
    return true;
  }
  function onNet(data) {
    if (disposed) return false;
    const m = cleanPhotoMsg(data); if (!m) return false;
    if (m.want) { share(m.id, true); return true; }   // an explicit ask: own gate, so a recent broadcast (that missed them) can't block it
    if (store?.has(m.id)) return true;               // our own photo coming back: the album already has it
    foreignCache.set(m.id, m.data);
    for (const fn of listeners) { try { fn(m.id); } catch (e) { console.warn('[camera]', e); } }
    return true;
  }
  const foreign = id => foreignCache.get(id);
  const onPhoto = fn => { listeners.add(fn); return () => listeners.delete(fn); };

  // ---------- prompt ----------
  function prompt(ctx) {
    const st = ctx?.state;
    if (st?.heldKind !== 'camera') return null;
    if (st.pickup || st.swimming || (st.role === 'guest' && !st.networkReady)) return null;
    return [{ key: 'LMB', label: 'Snap' }, { key: 'P', label: 'Album', muted: true }];
  }
  let unprompt = null;
  try { unprompt = globalThis.window?.raftPrompts?.provide?.({ id: 'camera', priority: 1, prompt }) ?? null; } catch { unprompt = null; }

  function update() { /* nothing per frame yet: capture happens in the click task */ }

  function dispose() {
    if (disposed) return;
    disposed = true;
    try { unprompt?.(); } catch {}
    listeners.clear(); foreignCache.clear();
    if (photoNet.current === api) photoNet.current = null;
  }

  const api = {
    use, update, onNet, share, request, foreign, onPhoto, dispose, prompt, capture,
    get netReady() { return netOk(); }, clearForeign: () => foreignCache.clear(),
    get store() { return store; }, storeReady: storeP,
    get debug() {
      return { shots, busy, lastShot, lastBytes, lastId, foreign: foreignCache.keys(), store: store?.kind ?? null, count: store?.count ?? 0,
        snap: () => (shotGate(now() / 1000, lastShot, busy) ? capture() : false),
        list: () => store?.list() ?? [], dataURL: id => store?.dataURL(id) ?? null, remove: id => store?.remove(id) };
    },
  };
  photoNet.current = api;
  return api;
}

export default createCamera;
