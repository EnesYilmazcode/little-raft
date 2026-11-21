// [camera] Photo Frame decor (docs/specs/camera.md, phase 2). Content module 'photoframe'.
// Slice world.ext.photoframe = {v:1, f:{"x,z": {id, owner:'host'|'guest'}}}: only photo ids, never image bytes.
// Each browser draws a frame from its own album (owner is me), from the photo the owner shared over co-op
// (camera.js foreign cache), or the painted placeholder. Top half pure (exported for tests).
import { buildFrameModel, placeholderTexture } from './camera-models.js?build=v3-survival-ae77fa84ac2b';
import { ID_RE, sharedPhotoStore } from './photo-store.js?build=v3-survival-ae77fa84ac2b';
import { photoNet } from './camera.js?build=v3-survival-ae77fa84ac2b';

export const FRAME_CAP = 64, REACH = 2.6;
const KEY_RE = /^-?\d+,-?\d+$/;
const OWNERS = ['host', 'guest'];
export const tileKey = (x, z) => x + ',' + z;
const isKey = k => typeof k === 'string' && k.length <= 24 && KEY_RE.test(k) && (() => { const [x, z] = k.split(',').map(Number); return tileKey(x, z) === k; })();

export function frameKeys(decor) {
  const out = new Set();
  if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'photoframe' && Number.isInteger(d.x) && Number.isInteger(d.z)) out.add(tileKey(d.x, d.z));
  return out;
}

/** Validated slice. decor given -> entries without a photoframe on that tile are dropped. */
export function cleanFrames(data, decor) {
  const out = { v: 1, f: {} };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  const f = data.f && typeof data.f === 'object' && !Array.isArray(data.f) ? data.f : {};
  const have = decor === undefined || decor === null ? null : frameKeys(decor);
  let n = 0;
  for (const k of Object.keys(f)) {
    if (n >= FRAME_CAP) break;
    if (!isKey(k) || (have && !have.has(k))) continue;
    const e = f[k];
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    if (typeof e.id !== 'string' || !ID_RE.test(e.id) || !OWNERS.includes(e.owner)) continue;
    out.f[k] = { id: e.id, owner: e.owner }; n++;
  }
  return out;
}

/** Host rule for {kind:'photoframe:set', key, id}: mutates st; returns true when it changed. */
export function setFrame(st, decor, a, actor) {
  if (!a || !isKey(a.key) || !frameKeys(decor).has(a.key)) return false;
  const owner = actor === 'guest' ? 'guest' : 'host';
  if (a.id === null || a.id === undefined) { if (!st.f[a.key]) return false; delete st.f[a.key]; return true; }
  if (typeof a.id !== 'string' || !ID_RE.test(a.id)) return false;
  if (!st.f[a.key] && Object.keys(st.f).length >= FRAME_CAP) return false;
  st.f[a.key] = { id: a.id, owner };
  return true;
}

// ------------------------------------------------------------------ the content module
export function createPhotoFrame(ctx) {
  const T = ctx.T;
  let st = cleanFrames(undefined), rev = 0, netSig = null, dirty = true, store = null, wasReady = false, disposed = false;
  const frames = [];                    // {g, plane, k}
  let scanLen = -1, scanFirst = null, scanRaft = null;
  const texById = new Map();            // id -> {tex|null, src, loading}
  const v1 = T ? new T.Vector3() : null;
  const me = () => (ctx.role === 'guest' ? 'guest' : 'host');
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);
  const cam = () => photoNet.current;
  const offs = [];

  sharedPhotoStore().then(s => { if (disposed) return; store = s; dirty = true; offs.push(s.onChange(() => { dirty = true; })); }).catch(() => {});
  let offPhoto = null, photoCam = null;
  const watchCam = () => { const c = cam(); if (c && c !== photoCam) { try { offPhoto?.(); } catch {} photoCam = c; offPhoto = c.onPhoto(() => { dirty = true; }); } };

  function target(aim) {
    const w = ctx.world, p = ctx.physics, c = ctx.camera; if (!w || !p || !c || !Array.isArray(w.decor) || !v1) return null;
    let best = null, bestScore = Infinity;
    const ox = c.position.x, oy = c.position.y, oz = c.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; } else { c.getWorldDirection(v1); dx = v1.x; dy = v1.y; dz = v1.z; }
    const cy = (ctx.raft?.position.y ?? 0) + 0.64;
    for (const d of w.decor) {
      if (!d || d.type !== 'photoframe') continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > 0.6) continue;
      const score = off + along * 0.05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best ? { x: best.x, z: best.z, key: tileKey(best.x, best.z) } : null;
  }

  function scan() {
    const raft = ctx.raft; if (!raft) { frames.length = 0; return; }
    const kids = raft.children;
    if (raft === scanRaft && kids.length === scanLen && kids[0] === scanFirst) return;
    scanRaft = raft; scanLen = kids.length; scanFirst = kids[0]; dirty = true;
    frames.length = 0;
    for (const g of kids) {
      if (g.name !== 'craft_photoframe') continue;
      const plane = g.getObjectByName('photoPlane'); if (!plane) continue;
      frames.push({ g, plane, k: tileKey(Math.round(g.position.x / 2), Math.round(g.position.z / 2)) });
    }
  }

  function textureFor(id, src) {
    let e = texById.get(id);
    if (e && e.src === src) return e.tex;
    if (e?.tex) e.tex.dispose();
    e = { tex: null, src, loading: true }; texById.set(id, e);
    if (typeof Image === 'undefined') return null;
    const img = new Image();
    img.onload = () => {
      if (disposed || texById.get(id) !== e) return;
      const t = new T.Texture(img);
      if (T.SRGBColorSpace) t.colorSpace = T.SRGBColorSpace;
      t.needsUpdate = true; e.tex = t; e.loading = false; dirty = true;
    };
    img.onerror = () => { e.loading = false; };
    img.src = src;
    return null;
  }

  const pending = new Set();           // ids whose store url is being looked up
  const ownUrl = new Map();            // id -> url from my album
  function sourceFor(entry) {
    if (!entry) return null;
    if (entry.owner === me() && store?.has(entry.id)) {
      if (ownUrl.has(entry.id)) return ownUrl.get(entry.id);
      if (!pending.has(entry.id)) {
        pending.add(entry.id);
        store.url(entry.id).then(u => { pending.delete(entry.id); if (u) { ownUrl.set(entry.id, u); dirty = true; } }).catch(() => pending.delete(entry.id));
      }
      return null;
    }
    const d = cam()?.foreign(entry.id);
    if (d) return d;
    if (entry.owner !== me()) cam()?.request(entry.id);
    return null;
  }

  function paint() {
    scan();
    if (!dirty) return;
    dirty = false;
    const used = new Set(), ph = placeholderTexture(T);
    for (const f of frames) {
      const e = st.f[f.k], src = sourceFor(e);
      let tex = null;
      if (src) { tex = textureFor(e.id, src); used.add(e.id); }
      const want = tex || ph;
      const m = f.plane.material;
      if (m && m.map !== want) { m.map = want; m.needsUpdate = true; }
    }
    for (const [id, e] of texById) if (!used.has(id)) { e.tex?.dispose(); texById.delete(id); }
    for (const id of [...ownUrl.keys()]) if (!store?.has(id)) ownUrl.delete(id);
  }

  function shareOwned() {
    const c = cam(); if (!c) return;
    for (const k of Object.keys(st.f)) { const e = st.f[k]; if (e.owner === me()) c.share(e.id); }
  }

  function load(data, from) {
    if (from === 'net') {
      const sig = data === undefined ? '' : JSON.stringify(data);
      if (sig === netSig) return;
      netSig = sig;
    } else netSig = null;
    st = cleanFrames(data, ctx.world?.decor); rev++; dirty = true;
  }

  let serCache = null, serRev = -1, serDecor = -1;
  function serialize() {
    const d = decor();
    if (serCache && serRev === rev && serDecor === d.length) return serCache;
    const clean = cleanFrames(st, d);
    if (Object.keys(clean.f).length !== Object.keys(st.f).length) { st = clean; rev++; dirty = true; }
    serCache = JSON.parse(JSON.stringify(st)); serRev = rev; serDecor = d.length;
    return serCache;
  }

  function pick(key) {
    document.dispatchEvent(new CustomEvent('littleraft:open-album', { detail: { pick: true, frameKey: key, onPick: id => {
      ctx.action({ kind: 'photoframe:set', key, id: id ?? null });
      if (id) cam()?.share(id);
      dirty = true;
    } } }));
  }

  function promptFor(c) {
    const s = c?.state;
    if (!s || s.pickup || s.swimming || ctx.uiOpen?.()) return null;
    const t = target(null); if (!t) return null;
    return { key: 'E', label: st.f[t.key] ? 'Change photo' : 'Choose photo' };
  }
  let unprompt = null;
  try { unprompt = globalThis.window?.raftPrompts?.provide?.({ id: 'photoframe', priority: 2, prompt: promptFor }) ?? null; } catch { unprompt = null; }

  return {
    name: 'photoframe',
    load, serialize,
    update() {
      if (!T) return;
      watchCam();
      const c = cam(), ready = !!c?.netReady;
      if (ready && !wasReady) { shareOwned(); dirty = true; }
      if (!ready && wasReady) { c?.clearForeign?.(); dirty = true; }
      wasReady = ready;
      paint();
    },
    interact(aim) {
      const t = target(aim); if (!t) return false;
      if (typeof document === 'undefined') return true;
      try { ctx.releaseLock?.(); } catch {}
      pick(t.key);
      return true;
    },
    action(a, actor) {
      if (!a || a.kind !== 'photoframe:set') return false;
      if (setFrame(st, decor(), a, actor)) { rev++; dirty = true; }
      return true;
    },
    decorModel(type) {
      if (type !== 'photoframe' || !T) return null;
      dirty = true;
      return buildFrameModel(T);
    },
    debug: {
      state: () => JSON.parse(JSON.stringify(st)),
      target: aim => target(aim),
      textures: () => [...texById.entries()].map(([id, e]) => ({ id, ready: !!e.tex })),
      frames: () => frames.map(f => ({ key: f.k, id: st.f[f.k]?.id ?? null, placeholder: f.plane.material?.map === placeholderTexture(T) })),
      pick: key => pick(key),
      /** Host QA: put a photo frame on a free raft tile. */
      place(x, z) {
        const w = ctx.world;
        if (ctx.role === 'guest' || !Number.isInteger(x) || !Number.isInteger(z) || !w) return false;
        if (!w.tiles?.some(t => t[0] === x && t[1] === z) || decor().some(d => d.x === x && d.z === z)) return false;
        w.decor.push({ type: 'photoframe', x, z }); ctx.rebuildRaft?.(); return true;
      },
    },
    dispose() {
      disposed = true;
      try { unprompt?.(); } catch {}
      try { offPhoto?.(); } catch {}
      for (const o of offs) { try { o(); } catch {} }
      for (const e of texById.values()) e.tex?.dispose();
      texById.clear(); frames.length = 0;
    },
  };
}

export default createPhotoFrame;
