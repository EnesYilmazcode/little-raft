// [camera] Photo album storage (docs/specs/camera.md). Pure logic + three backends; no THREE, no DOM beyond
// optional URL.createObjectURL. Photos live only in this browser: never in the save, world state or ext.
//   Backends (all async): {kind, list() -> [meta], put(rec), get(id) -> rec|null, del(id)}
//     idbBackend(indexedDB)    db 'little-raft-photos' v1, store 'photos' (keyPath id), values {id, at, day, blob}
//     localBackend(storage)    one JSON key 'little-raft-photos-v1': [{id, at, day, data:<jpeg dataURL>}]
//     memoryBackend()          a Map, gone when the tab closes
//   openPhotoStore({backends, notice}) -> store {kind, list(), count, add(rec), url(id), dataURL(id), has(id), remove(id), onChange(fn)}
//   sharedPhotoStore({notice}) -> one store promise per page (camera, album and frames share it; survives hot reload)

export const PHOTO_CAP = 24, DB_NAME = 'little-raft-photos', LS_KEY = 'little-raft-photos-v1', MAX_DATA = 24000;
export const ID_RE = /^p[a-z0-9]{6,24}$/, DATA_PREFIX = 'data:image/jpeg;base64,';
export const MEMORY_NOTICE = 'Photos will only last until you close this tab.';
const STORE_NAME = 'photos';
const B64_RE = /^[A-Za-z0-9+/]+=*$/;

/** 'p' + base36 time + 6 random base36 chars (matches ID_RE). */
export function newId(now = Date.now(), rnd = Math.random) {
  const t = Number.isFinite(now) && now >= 0 ? Math.floor(now) : 0;
  let s = 'p' + t.toString(36);
  for (let i = 0; i < 6; i++) s += Math.floor(Math.min(0.999999, Math.max(0, Number(rnd()) || 0)) * 36).toString(36);
  return s.slice(0, 25);
}

export function canAdd(list, cap = PHOTO_CAP) {
  const n = Array.isArray(list) ? list.length : 0;
  return n < cap ? { ok: true } : { ok: false, reason: 'full' };
}

/** Untrusted record -> {id, at, day?} or null. */
export function cleanMeta(rec) {
  if (!rec || typeof rec !== 'object') return null;
  if (typeof rec.id !== 'string' || !ID_RE.test(rec.id)) return null;
  if (typeof rec.at !== 'number' || !Number.isFinite(rec.at)) return null;
  const out = { id: rec.id, at: rec.at };
  if (Number.isInteger(rec.day) && rec.day >= 0 && rec.day < 1e6) out.day = rec.day;
  return out;
}

/** A small JPEG data URL safe to show or cache (also the co-op share format). */
export function validPhotoData(s) {
  if (typeof s !== 'string' || s.length > MAX_DATA || !s.startsWith(DATA_PREFIX)) return false;
  const tail = s.slice(DATA_PREFIX.length);
  return tail.length >= 8 && B64_RE.test(tail);
}

const newestFirst = (a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
export const isQuota = e => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);

export async function blobToDataURL(blob) {
  if (typeof blob === 'string') return blob;
  if (!blob || typeof blob.arrayBuffer !== 'function') return '';
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return DATA_PREFIX + btoa(bin);
}
export function dataURLToBlob(s) {
  if (!validPhotoData(s) || typeof Blob === 'undefined') return null;
  const bin = atob(s.slice(DATA_PREFIX.length)), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type: 'image/jpeg' });
}

// ---------------------------------------------------------------- backends
export function memoryBackend() {
  const m = new Map();
  return {
    kind: 'memory',
    async list() { return [...m.values()].map(cleanMeta).filter(Boolean); },
    async put(rec) { m.set(rec.id, { ...rec }); },
    async get(id) { return m.get(id) ?? null; },
    async del(id) { m.delete(id); },
  };
}

export function localBackend(storage) {
  const read = () => {
    const raw = storage.getItem(LS_KEY);            // a throwing getItem (blocked storage) fails the open
    if (!raw) return [];
    let v; try { v = JSON.parse(raw); } catch { return []; }
    return Array.isArray(v) ? v.filter(r => cleanMeta(r) && validPhotoData(r.data)) : [];
  };
  return {
    kind: 'local',
    async list() { if (!storage) throw new Error('no localStorage'); return read().map(cleanMeta); },
    async put(rec) {
      const data = rec.data ?? await blobToDataURL(rec.blob);
      if (!validPhotoData(data)) throw new Error('photo too big');
      const all = read().filter(r => r.id !== rec.id);
      const m = cleanMeta(rec);
      all.push({ ...m, data });
      storage.setItem(LS_KEY, JSON.stringify(all));
    },
    async get(id) { const r = read().find(r => r.id === id); return r ? { ...cleanMeta(r), data: r.data } : null; },
    async del(id) {
      const all = read(), left = all.filter(r => r.id !== id);
      if (left.length !== all.length) { if (left.length) storage.setItem(LS_KEY, JSON.stringify(left)); else storage.removeItem(LS_KEY); }
    },
  };
}

export function idbBackend(idb) {
  let dbp = null;
  const db = () => {
    if (!dbp) dbp = new Promise((res, rej) => {
      if (!idb || typeof idb.open !== 'function') { rej(new Error('no indexedDB')); return; }
      const rq = idb.open(DB_NAME, 1);
      rq.onupgradeneeded = () => { const d = rq.result; if (!d.objectStoreNames.contains(STORE_NAME)) d.createObjectStore(STORE_NAME, { keyPath: 'id' }); };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error || new Error('indexedDB open failed'));
      rq.onblocked = () => rej(new Error('indexedDB blocked'));
    });
    return dbp;
  };
  const run = async (mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction(STORE_NAME, mode), st = tx.objectStore(STORE_NAME);
      let out;
      const rq = fn(st);
      if (rq) rq.onsuccess = () => { out = rq.result; };
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error || rq?.error || new Error('indexedDB failed'));
      tx.onabort = () => rej(tx.error || new Error('indexedDB aborted'));
    });
  };
  return {
    kind: 'idb',
    async list() { const all = await run('readonly', st => st.getAll()); return (all || []).map(cleanMeta).filter(Boolean); },
    async put(rec) {
      const m = cleanMeta(rec); if (!m) throw new Error('bad photo');
      const blob = rec.blob ?? dataURLToBlob(rec.data);
      if (!blob) throw new Error('no image');
      await run('readwrite', st => st.put({ ...m, blob }));
    },
    async get(id) { const r = await run('readonly', st => st.get(id)); return r ? { ...cleanMeta(r), blob: r.blob } : null; },
    async del(id) { await run('readwrite', st => st.delete(id)); },
  };
}

function defaultBackends() {
  return [
    () => idbBackend(globalThis.indexedDB),
    () => { let s = null; try { s = globalThis.localStorage; } catch { s = null; } if (!s) throw new Error('no localStorage'); return localBackend(s); },
    () => memoryBackend(),
  ];
}

// ---------------------------------------------------------------- the store
export async function openPhotoStore({ backends = defaultBackends(), notice = null } = {}) {
  let be = null, metas = [], noticed = false;
  const older = [];                                  // backends we left mid-session (still read for old photos)
  const urls = new Map(), listeners = new Set();
  let say = typeof notice === 'function' ? notice : null;
  const tell = s => { try { say?.(s); } catch {} };
  const toMemory = () => { if (be) older.push(be); be = memoryBackend(); if (!noticed) { noticed = true; tell(MEMORY_NOTICE); } };
  for (const b of backends) {
    try {
      const cand = typeof b === 'function' ? b() : b;
      if (!cand) continue;
      const got = await cand.list();
      be = cand; metas = (Array.isArray(got) ? got : []).map(cleanMeta).filter(Boolean).sort(newestFirst);
      break;
    } catch { /* next backend */ }
  }
  if (!be) { be = memoryBackend(); metas = []; }
  if (be.kind === 'memory' && !noticed) { noticed = true; tell(MEMORY_NOTICE); }
  const changed = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.warn('[photos]', e); } } };

  async function getRec(id) {
    for (const b of [be, ...older]) { try { const r = await b.get(id); if (r) return r; } catch {} }
    return null;
  }

  const store = {
    get kind() { return be.kind; },
    get count() { return metas.length; },
    set notice(fn) { say = typeof fn === 'function' ? fn : null; },
    list() { return metas.map(m => ({ ...m })); },
    has(id) { return metas.some(m => m.id === id); },
    async add(rec) {
      const m = cleanMeta(rec);
      if (!m || !(rec.blob || rec.data)) return { ok: false, reason: 'bad' };
      const gate = canAdd(metas); if (!gate.ok) return gate;
      const full = { ...m, blob: rec.blob, data: rec.data };
      try { await be.put(full); }
      catch (e) {
        if (isQuota(e)) { tell('No room to keep more photos here.'); return { ok: false, reason: 'quota' }; }
        console.warn('[photos] storage failed, keeping photos in memory', e);
        toMemory();
        try { await be.put(full); } catch { return { ok: false, reason: 'quota' }; }
      }
      metas = [m, ...metas.filter(x => x.id !== m.id)].sort(newestFirst);
      changed();
      return { ok: true, count: metas.length };
    },
    async url(id) {
      if (urls.has(id)) return urls.get(id);
      const r = await getRec(id); if (!r) return null;
      let u = null;
      if (r.data && validPhotoData(r.data)) u = r.data;
      else if (r.blob) { try { u = URL.createObjectURL(r.blob); } catch { u = await blobToDataURL(r.blob); } }
      if (u) urls.set(id, u);
      return u;
    },
    async dataURL(id) {
      const r = await getRec(id); if (!r) return null;
      const d = r.data ?? await blobToDataURL(r.blob);
      return validPhotoData(d) ? d : null;
    },
    async remove(id) {
      for (const b of [be, ...older]) { try { await b.del(id); } catch {} }
      const u = urls.get(id); urls.delete(id);
      if (u && u.startsWith('blob:')) { try { URL.revokeObjectURL(u); } catch {} }
      const n = metas.length; metas = metas.filter(m => m.id !== id);
      if (metas.length !== n) changed();
      return metas.length !== n;
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return store;
}

const SHARED_KEY = '__littleRaftPhotoStore';
/** One store per page; later callers may swap the notice function (hot reload). */
export function sharedPhotoStore({ notice } = {}) {
  const g = globalThis;
  let p = g[SHARED_KEY];
  if (!p) { p = g[SHARED_KEY] = openPhotoStore({ notice }); }
  else if (notice) p.then(s => { s.notice = notice; }).catch(() => {});
  return p;
}
