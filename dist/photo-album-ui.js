// [camera] Photo album dialog (docs/specs/camera.md), logbook-ui.js pattern.
// createPhotoAlbumUI({store, onPause, onResume, onPick}) -> {open(opts), close, toggle, destroy, isOpen}
//   store: a photo-store.js store or a promise of one. open({pick:true, frameKey, onPick}) is the frame's pick mode:
//   choosing a thumb calls detail.onPick(id) (or the onPick option) with the photo id, "Empty frame" with null.
// Opens with KeyP (only while playing and no other dialog is open), or the 'littleraft:open-album' event.
import { PHOTO_CAP } from './photo-store.js?build=v3-survival-ae77fa84ac2b';

const INST_KEY = '__littleRaftPhotoAlbumUI';
const STYLE_ID = 'little-raft-album-style';
const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";
const BUILD = (() => { try { return new URL(import.meta.url).searchParams.get('build') || 'dev'; } catch { return 'dev'; } })();
const SPRITE_URL = (() => { try { const u = new URL('icons.svg', import.meta.url); u.search = '?build=' + encodeURIComponent(BUILD); return u.href; } catch { return 'icons.svg'; } })();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const WOOD = 'repeating-linear-gradient(90deg,#00000012 0 2px,transparent 2px 23px),linear-gradient(#b48d55,#8a663a)';
const CONFIRM_MS = 3000;

const CSS = `
#photoAlbum.pa{padding:0;margin:auto;border:0;background:transparent;box-shadow:none;color:#fff2cc;width:min(820px,calc(100vw - 32px));max-height:90dvh;overflow:visible;font:500 14px/1.45 ${FONT}}
#photoAlbum.pa::backdrop{background:rgba(12,9,5,.42);-webkit-backdrop-filter:none;backdrop-filter:none}
#photoAlbum .pa-wrap{display:flex;flex-direction:column;gap:10px;padding:12px;max-height:90dvh;box-sizing:border-box;border-radius:6px;outline:none;
  background:${WOOD};border:3px solid #3e2a17;box-shadow:0 0 0 2px #d6b67e,0 18px 50px #000a}
#photoAlbum .pa-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
#photoAlbum h2{font:700 20px/1.2 ${FONT};margin:0;color:#fff2cc;letter-spacing:0;text-shadow:0 1px 0 #3e2a17}
#photoAlbum .pa-close{width:32px;height:32px;min-width:32px;padding:0;display:grid;place-items:center;background:transparent;border:0;border-radius:4px;color:#fff2cc;cursor:pointer;box-shadow:none}
#photoAlbum .pa-close:hover{transform:none;background:#00000022}
#photoAlbum .pa-close svg{width:22px;height:22px}
#photoAlbum .pa-body{background:#3a2716eb;border-radius:4px;box-shadow:inset 0 0 0 2px #24170c,inset 0 0 0 3px #b48d5544;padding:10px;overflow:auto;overscroll-behavior:contain;scrollbar-color:#b48d55 #2a1b0e;min-height:0;flex:1}
#photoAlbum .pa-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0;padding:0;list-style:none}
#photoAlbum .pa-thumb{display:flex;flex-direction:column;gap:4px;padding:5px 5px 4px;background:#f3e6c4;border:0;border-radius:3px;box-shadow:0 2px 0 #24170c;cursor:pointer;color:#5b4126;font:600 11px/1.2 ${FONT};text-align:left;transform:none;min-width:0;width:100%;box-sizing:border-box}
#photoAlbum .pa-thumb:hover{transform:none;filter:brightness(1.05)}
#photoAlbum .pa-thumb:focus-visible,#photoAlbum .pa-btn:focus-visible,#photoAlbum .pa-close:focus-visible{outline:2px solid #ffe3a6;outline-offset:2px}
#photoAlbum .pa-thumb img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#1f6f86;border-radius:2px}
#photoAlbum .pa-thumb span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#photoAlbum .pa-empty{margin:24px 8px;text-align:center;color:#e8d3a8}
#photoAlbum .pa-hint{margin:0 0 8px;color:#e8d3a8;font-size:13px}
#photoAlbum .pa-large{display:flex;flex-direction:column;gap:10px;align-items:center}
#photoAlbum .pa-large img{display:block;width:100%;height:auto;aspect-ratio:16/9;max-width:min(768px,calc(min(432px,58dvh) * 16 / 9));object-fit:cover;background:#1f2a2e;border:6px solid #f3e6c4;border-radius:3px;box-shadow:0 3px 0 #24170c;box-sizing:border-box}
#photoAlbum .pa-cap{color:#e8d3a8;font-size:13px}
#photoAlbum .pa-row{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
#photoAlbum .pa-btn{background:linear-gradient(180deg,#5a3f28e8,#3d2a19e8);box-shadow:inset 0 0 0 1px #d4b07a55;border:0;border-radius:4px;padding:8px 14px;color:#fff2cc;font:600 14px/1.2 ${FONT};cursor:pointer;transform:none;text-decoration:none;min-height:36px;box-sizing:border-box;display:inline-flex;align-items:center}
#photoAlbum .pa-btn:hover{transform:none;filter:brightness(1.1)}
#photoAlbum .pa-btn[disabled]{opacity:.45;cursor:default}
#photoAlbum .pa-btn.pa-warn{background:linear-gradient(180deg,#a34c2ce8,#7a3519e8)}
#photoAlbum .pa-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;color:#e8d3a8;font-size:12px}
#photoAlbum [hidden]{display:none !important}
@media (max-width:520px){#photoAlbum .pa-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}#photoAlbum .pa-body{padding:6px}#photoAlbum .pa-thumb{padding:3px}#photoAlbum .pa-btn{padding:8px 10px}}
`;

const MARKUP = `<div class="pa-wrap" tabindex="-1">
  <div class="pa-head"><h2 id="pa-title">Photo album</h2>
    <button type="button" class="pa-close" aria-label="Close photo album"><svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><use href="${SPRITE_URL}#icon-close"></use></svg></button></div>
  <section class="pa-body" aria-labelledby="pa-title">
    <div class="pa-gridview"><p class="pa-hint" hidden></p><ul class="pa-grid"></ul><p class="pa-empty" hidden>No photos yet. Craft a Little Camera and click to snap.</p></div>
    <div class="pa-large" hidden><img alt=""><div class="pa-cap"></div>
      <div class="pa-row"><button type="button" class="pa-btn" data-act="prev" aria-label="Previous photo">‹ Prev</button><button type="button" class="pa-btn" data-act="next" aria-label="Next photo">Next ›</button>
        <a class="pa-btn" data-act="download" href="#" download>Download</a><button type="button" class="pa-btn" data-act="delete">Delete</button><button type="button" class="pa-btn" data-act="back">Back</button></div></div>
  </section>
  <div class="pa-foot"><span class="pa-where"></span><button type="button" class="pa-btn" data-act="empty" hidden>Empty frame</button></div>
</div>`;

function ensureStyle() {
  let st = document.getElementById(STYLE_ID);
  if (!st) { st = document.createElement('style'); st.id = STYLE_ID; document.head.append(st); }
  if (st.textContent !== CSS) st.textContent = CSS;
}
function mountDialog() {
  let d = document.getElementById('photoAlbum');
  if (!d || d.tagName !== 'DIALOG') { if (d) d.remove(); d = document.createElement('dialog'); d.id = 'photoAlbum'; document.body.append(d); }
  d.className = 'pa';
  d.setAttribute('aria-labelledby', 'pa-title');
  d.innerHTML = MARKUP;
  return d;
}

export function photoDate(m, short = false) {
  let s = '';
  try { s = new Date(m.at).toLocaleString(undefined, short ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { s = ''; }
  return Number.isInteger(m.day) ? `Day ${m.day + 1} · ${s}` : s;
}

export function createPhotoAlbumUI({ store, onPause, onResume, onPick } = {}) {
  const prev = window[INST_KEY];
  const ac = new AbortController(), opt = { signal: ac.signal };
  const safe = (fn, ...a) => { try { return typeof fn === 'function' ? fn(...a) : undefined; } catch (err) { console.warn('[album]', err); } };
  let alive = true, isOpen = false, st = null, view = -1, pick = null, confirmAt = 0, renderToken = 0, offChange = null;
  const storeP = Promise.resolve(store).then(s => { st = s; if (alive && s?.onChange) offChange = s.onChange(() => { if (isOpen) render(); }); return s; }).catch(() => null);

  ensureStyle();
  const dlg = mountDialog();
  const $ = s => dlg.querySelector(s);
  const title = $('#pa-title'), grid = $('.pa-grid'), empty = $('.pa-empty'), hint = $('.pa-hint'), gridView = $('.pa-gridview');
  const large = $('.pa-large'), img = $('.pa-large img'), cap = $('.pa-cap'), dl = $('[data-act=download]'), del = $('[data-act=delete]');
  const where = $('.pa-where'), emptyBtn = $('[data-act=empty]');
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const list = () => (st ? st.list() : []);

  async function render() {
    const token = ++renderToken;
    const photos = list();
    title.textContent = pick ? 'Choose a photo for this frame' : `Photo album ${photos.length}/${PHOTO_CAP}`;
    where.textContent = st?.kind === 'memory' ? 'Photos stay until you close this tab.' : 'Photos stay in this browser only.';
    emptyBtn.hidden = !pick;
    hint.hidden = !pick; hint.textContent = pick ? 'Click a photo to hang it in the frame.' : '';
    if (view >= photos.length) view = photos.length - 1;
    gridView.hidden = view >= 0; large.hidden = view < 0;
    if (view >= 0) { await showLarge(photos, token); return; }
    empty.hidden = photos.length > 0;
    grid.innerHTML = photos.map((m, i) => `<li><button type="button" class="pa-thumb" data-i="${i}" aria-label="Photo ${i + 1}, ${esc(photoDate(m))}"><img alt="" data-id="${esc(m.id)}"><span>${esc(photoDate(m, true))}</span></button></li>`).join('');
    await Promise.all([...grid.querySelectorAll('img[data-id]')].map(async el => {
      const u = await st?.url(el.dataset.id).catch(() => null);
      if (u && token === renderToken) el.src = u;
    }));
  }

  async function showLarge(photos, token) {
    const m = photos[view];
    cap.textContent = `${view + 1} / ${photos.length} · ${photoDate(m)}`;
    $('[data-act=prev]').disabled = view <= 0; $('[data-act=next]').disabled = view >= photos.length - 1;
    resetConfirm();
    const u = await st?.url(m.id).catch(() => null);
    if (token !== renderToken) return;
    img.src = u || ''; img.alt = `Photo from ${photoDate(m)}`;
    dl.href = u || '#'; dl.setAttribute('download', `little-raft-${m.id}.jpg`);
    if (iOS) { dl.removeAttribute('download'); dl.target = '_blank'; dl.rel = 'noopener'; }
  }

  function resetConfirm() { confirmAt = 0; del.textContent = 'Delete'; del.classList.remove('pa-warn'); }

  function setView(i, focus = false) {
    view = i; render();
    if (focus) { try { (view >= 0 ? $('[data-act=back]') : grid.querySelector('.pa-thumb'))?.focus({ preventScroll: true }); } catch {} }
  }

  function open(o = {}) {
    if (!alive) return;
    pick = o && o.pick ? { frameKey: o.frameKey ?? null, onPick: typeof o.onPick === 'function' ? o.onPick : null } : null;
    view = -1;
    if (!isOpen) {
      isOpen = true;
      safe(onPause);
      if (document.pointerLockElement) { try { document.exitPointerLock(); } catch {} }
      if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
    }
    storeP.then(() => { if (isOpen) render().then(() => { try { (grid.querySelector('.pa-thumb') || $('.pa-close')).focus({ preventScroll: true }); } catch {} }); });
  }
  function close() {
    if (!isOpen) return;
    isOpen = false; pick = null; view = -1;
    if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }
    safe(onResume);
  }
  const toggle = () => (isOpen ? close() : open());

  function choose(id) {
    const p = pick; if (!p) return;
    close();
    if (p.onPick) safe(p.onPick, id, p.frameKey); else safe(onPick, id, p.frameKey);
  }

  dlg.addEventListener('cancel', e => { e.preventDefault(); if (view >= 0 && !pick) setView(-1, true); else close(); }, opt);
  dlg.addEventListener('close', () => { if (isOpen) { isOpen = false; pick = null; view = -1; safe(onResume); } }, opt);
  dlg.addEventListener('click', e => {
    const t = e.target;
    if (t?.closest?.('.pa-close')) { close(); return; }
    const th = t?.closest?.('.pa-thumb');
    if (th) { const i = Number(th.dataset.i), m = list()[i]; if (!m) return; if (pick) choose(m.id); else setView(i, true); return; }
    const b = t?.closest?.('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'empty') { choose(null); return; }
    if (act === 'back') { setView(-1, true); return; }
    if (act === 'prev' && view > 0) { setView(view - 1); return; }
    if (act === 'next' && view < list().length - 1) { setView(view + 1); return; }
    if (act === 'download') { if (!b.getAttribute('href') || b.getAttribute('href') === '#') e.preventDefault(); return; }
    if (act === 'delete') {
      const m = list()[view]; if (!m) return;
      const t0 = performance.now();
      if (!confirmAt || t0 - confirmAt > CONFIRM_MS) { confirmAt = t0; del.textContent = 'Tap again to delete'; del.classList.add('pa-warn'); return; }
      resetConfirm();
      st?.remove(m.id).then(() => { const n = list().length; if (!n) setView(-1, true); else setView(Math.min(view, n - 1)); });
    }
  }, opt);
  dlg.addEventListener('keydown', e => {
    if (view < 0 || pick) return;
    if (e.key === 'ArrowLeft' && view > 0) { e.preventDefault(); setView(view - 1); }
    else if (e.key === 'ArrowRight' && view < list().length - 1) { e.preventDefault(); setView(view + 1); }
  }, opt);
  dlg.addEventListener('wheel', e => e.stopPropagation(), { ...opt, passive: true });

  document.addEventListener('keydown', e => {
    if (!alive || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.code !== 'KeyP') return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (isOpen) { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (!(document.body?.classList.contains('playing') || document.pointerLockElement)) return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault(); e.stopPropagation();
    open();
  }, { ...opt, capture: true });
  document.addEventListener('littleraft:open-album', e => open(e?.detail || {}), opt);

  const api = {
    open, close, toggle,
    destroy() {
      if (!alive) return;
      alive = false; ac.abort(); try { offChange?.(); } catch {}
      if (isOpen) { isOpen = false; if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } } }
      if (window[INST_KEY] === api) window[INST_KEY] = null;
    },
    get isOpen() { return isOpen; },
    get view() { return view; },
  };
  if (prev && prev !== api) { try { prev.destroy(); } catch {} }
  window[INST_KEY] = api;
  return api;
}

export default createPhotoAlbumUI;
