// "Your look" dialog: shirt / trousers / skin / hair swatches and a hat picker with a 2D SVG preview.
// createLookUI({getState, onChange, onSend, onPause, onResume}) -> {open, close, isOpen, destroy, refresh}
//   getState() -> {look, unlocked:Set} (game.js owns the state and storage; dist/look.js)
//   onChange(look) runs on every pick (game.js recolours hands/player and saves);
//   onSend() tells the co-op partner, debounced 400 ms and flushed on close.
// Opened by the pause menu ('littleraft:open-look' event) and the welcome card. Spec: docs/specs/customise.md.
import { PALETTE, SLOTS, HATS, cleanLook, lookColors, lookKey, hatAvailable } from './look.js?build=v3-survival-ae77fa84ac2b';
import { ACHIEVEMENTS } from './logbook.js?build=v3-survival-ae77fa84ac2b';

const INST_KEY = '__littleRaftLookUI';
const STYLE_ID = 'little-raft-look-style';
const SEND_MS = 400;
const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";
const BUILD = (() => { try { return new URL(import.meta.url).searchParams.get('build') || 'dev'; } catch { return 'dev'; } })();
const SPRITE_URL = (() => {
  try { const u = new URL('icons.svg', import.meta.url); u.search = '?build=' + encodeURIComponent(BUILD); return u.href; }
  catch { return 'icons.svg'; }
})();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SLOT_LABEL = { shirt: 'Shirt', trousers: 'Trousers', skin: 'Skin', hair: 'Hair' };
const achName = id => ACHIEVEMENTS.find(a => a.id === id)?.name || id;

// sRGB hex scale for the preview's shade colours (the 3D avatar does the same in linear space).
const shade = (hex, k) => '#' + [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k))).toString(16).padStart(2, '0')).join('');

const WOOD = 'repeating-linear-gradient(90deg,#00000012 0 2px,transparent 2px 23px),linear-gradient(#b48d55,#8a663a)';
const CSS = `
#lookDialog.lk{padding:0;margin:auto;border:0;background:transparent;box-shadow:none;color:#fff2cc;width:min(640px,calc(100vw - 32px));max-height:88dvh;overflow:visible;font:500 14px/1.45 ${FONT}}
#lookDialog.lk::backdrop{background:rgba(12,9,5,.42);-webkit-backdrop-filter:none;backdrop-filter:none}
#lookDialog .lk-wrap{display:flex;flex-direction:column;gap:10px;padding:12px;max-height:88dvh;box-sizing:border-box;border-radius:6px;outline:none;
  background:${WOOD};border:3px solid #3e2a17;box-shadow:0 0 0 2px #d6b67e,0 18px 50px #000a}
#lookDialog .lk-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.lk h2{font:700 20px/1.2 ${FONT};margin:0;color:#fff2cc;letter-spacing:0;text-shadow:0 1px 0 #3e2a17}
#lookDialog .lk-close{width:32px;height:32px;min-width:32px;padding:0;display:grid;place-items:center;background:transparent;border:0;border-radius:4px;color:#fff2cc;cursor:pointer;box-shadow:none}
#lookDialog .lk-close:hover{transform:none;background:#00000022}
#lookDialog .lk-close svg{width:22px;height:22px}
.lk button:focus-visible{outline:2px solid #ffe3a6;outline-offset:2px}
#lookDialog .lk-body{display:flex;gap:12px;min-height:0;flex:1}
#lookDialog .lk-preview{flex:0 0 172px;display:grid;place-items:center;background:#3a2716eb;border-radius:4px;box-shadow:inset 0 0 0 2px #24170c,inset 0 0 0 3px #b48d5544}
#lookDialog .lk-preview svg{width:160px;height:220px;display:block}
#lookDialog .lk-rows{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;overflow:auto;overscroll-behavior:contain;scrollbar-color:#b48d55 #2a1b0e;
  background:#3a2716eb;border-radius:4px;box-shadow:inset 0 0 0 2px #24170c,inset 0 0 0 3px #b48d5544;padding:10px}
.lk-row>span{display:block;font:600 12px/1.2 ${FONT};font-variant:small-caps;letter-spacing:.06em;color:#d6b67e;margin-bottom:4px}
.lk-sw{display:flex;flex-wrap:wrap;gap:4px}
.lk-sw button{width:36px;height:36px;min-width:0;padding:0;margin:0;border:0;border-radius:50%;background:transparent;display:grid;place-items:center;cursor:pointer;box-shadow:none;transform:none}
.lk-sw button:hover{transform:none;filter:brightness(1.08)}
.lk-sw button i{display:block;width:28px;height:28px;border-radius:50%;background:var(--c);box-shadow:inset 0 0 0 2px #0000002e,0 1px 0 #24170c}
.lk-sw button[aria-checked=true] i{box-shadow:0 0 0 2px #3a2716,0 0 0 4px #ffe3a6}
.lk-hats{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:6px}
.lk-hats button{position:relative;min-width:0;margin:0;padding:4px 2px 5px;border:0;border-radius:4px;cursor:pointer;transform:none;color:#fff2cc;
  background:linear-gradient(180deg,#664730e8,#46301ce8);box-shadow:inset 0 0 0 1px #d4b07a44;display:flex;flex-direction:column;align-items:center;gap:1px;font:600 11px/1.2 ${FONT}}
.lk-hats button:hover{transform:none;filter:brightness(1.08)}
.lk-hats button[aria-checked=true]{background:linear-gradient(180deg,#b3925acc,#8a6a3ccc);box-shadow:inset 0 0 0 2px #ffe3a6}
.lk-hats svg:not(.lk-lock){width:56px;height:40px;display:block}
.lk-hats small{display:block;font:500 10px/1.15 ${FONT};color:#e8d3a8;text-align:center}
.lk-hats button[aria-disabled=true]{cursor:default}
.lk-hats button[aria-disabled=true] svg:not(.lk-lock){filter:grayscale(1);opacity:.45}
.lk-hats button[aria-disabled=true] b{opacity:.6}
.lk-hats .lk-lock{position:absolute;top:4px;right:5px;width:14px;height:14px;filter:none;opacity:1}
#lookDialog .lk-foot{display:flex;gap:8px;justify-content:flex-end}
.lk-foot button{border:0;border-radius:4px;padding:9px 18px;margin:0;font:600 14px/1.2 ${FONT};cursor:pointer;transform:none;color:#fff2cc;
  background:linear-gradient(180deg,#5a3f28e8,#3d2a19e8);box-shadow:inset 0 0 0 1px #d4b07a55}
.lk-foot button:hover{transform:none;filter:brightness(1.08)}
.lk-foot .lk-done{background:linear-gradient(180deg,#b3925a,#8a6a3c);box-shadow:inset 0 0 0 2px #ffe3a6;color:#2a1b0e}
.lk-fig .lk-hat{display:none}
.lk-fig[data-hat=straw] .lk-hat-straw,.lk-fig[data-hat=beanie] .lk-hat-beanie,.lk-fig[data-hat=bucket] .lk-hat-bucket,.lk-fig[data-hat=flower] .lk-hat-flower{display:inline}
@media (hover:none) and (pointer:coarse){.lk-sw button{width:40px;height:40px}}
@media (max-width:520px){
  #lookDialog .lk-body{flex-direction:column;gap:8px}
  #lookDialog .lk-preview{flex:0 0 140px}
  #lookDialog .lk-preview svg{width:102px;height:140px}
  #lookDialog .lk-rows{padding:8px}
  .lk-sw{display:grid;grid-template-columns:repeat(var(--half),auto);justify-content:start}
  #lookDialog .lk-foot button{flex:1}
}
`;

// Hats drawn in figure coordinates (viewBox 0 0 160 220, head centre 80,70, r 38). Colours come from CSS vars.
const HAT_SVG = {
  straw: `<ellipse cx="80" cy="40" rx="62" ry="11" fill="#ecc96f" stroke="#b8933f" stroke-width="2"/>
    <path d="M52 40 Q54 10 80 9 Q106 10 108 40 Z" fill="#ecc96f" stroke="#b8933f" stroke-width="2"/>
    <rect x="53" y="28" width="54" height="9" rx="2" fill="var(--lk-band)"/>`,
  none: '',
  beanie: `<path d="M41 52 Q40 8 80 6 Q120 8 119 52 Z" fill="var(--lk-knit)"/>
    <path d="M58 14 L58 50 M80 8 L80 50 M102 14 L102 50" stroke="#00000022" stroke-width="3" fill="none"/>
    <rect x="38" y="44" width="84" height="14" rx="7" fill="var(--lk-knit)" stroke="#00000030" stroke-width="2"/>
    <circle cx="80" cy="6" r="9" fill="#fbf7ee"/>`,
  bucket: `<path d="M50 44 L56 12 Q80 6 104 12 L110 44 Z" fill="var(--lk-bucket)" stroke="#00000030" stroke-width="2"/>
    <path d="M30 56 L50 40 L110 40 L130 56 Q80 64 30 56 Z" fill="var(--lk-bucket)" stroke="#00000030" stroke-width="2"/>`,
  flower: `<path d="M44 44 Q80 30 116 44" stroke="#5f9f4f" stroke-width="5" fill="none" stroke-linecap="round"/>
    <circle cx="48" cy="42" r="7" fill="#f59ab8"/><circle cx="64" cy="36" r="7" fill="#ffe27a"/><circle cx="80" cy="34" r="7" fill="#fdfaf2"/>
    <circle cx="96" cy="36" r="7" fill="#f59ab8"/><circle cx="112" cy="42" r="7" fill="#ffe27a"/>
    <circle cx="48" cy="42" r="2.5" fill="#d98a2b"/><circle cx="64" cy="36" r="2.5" fill="#d98a2b"/><circle cx="80" cy="34" r="2.5" fill="#d98a2b"/>
    <circle cx="96" cy="36" r="2.5" fill="#d98a2b"/><circle cx="112" cy="42" r="2.5" fill="#d98a2b"/>`,
};
const FIGURE = `<svg class="lk-fig" viewBox="0 0 160 220" role="img" aria-label="Preview of your sailor">
  <ellipse cx="80" cy="212" rx="40" ry="5" fill="#0000003a"/>
  <rect x="58" y="150" width="17" height="52" rx="7" fill="var(--lk-skin)"/><rect x="85" y="150" width="17" height="52" rx="7" fill="var(--lk-skin)"/>
  <ellipse cx="65" cy="206" rx="13" ry="7" fill="#5a3d2b"/><ellipse cx="95" cy="206" rx="13" ry="7" fill="#5a3d2b"/>
  <path d="M50 136 L110 136 L112 166 L84 166 L80 156 L76 166 L48 166 Z" fill="var(--lk-trousers)"/>
  <rect x="32" y="112" width="13" height="40" rx="6.5" fill="var(--lk-skin)" transform="rotate(8 38 112)"/>
  <rect x="115" y="112" width="13" height="40" rx="6.5" fill="var(--lk-skin)" transform="rotate(-8 122 112)"/>
  <circle cx="36" cy="153" r="8" fill="var(--lk-skin)"/><circle cx="124" cy="153" r="8" fill="var(--lk-skin)"/>
  <path d="M54 104 Q80 96 106 104 L112 142 L48 142 Z" fill="var(--lk-shirt)"/>
  <rect x="49" y="126" width="62" height="6" fill="#fbf7ee"/>
  <ellipse cx="44" cy="112" rx="12" ry="15" fill="var(--lk-shirt)"/><ellipse cx="116" cy="112" rx="12" ry="15" fill="var(--lk-shirt)"/>
  <rect x="73" y="96" width="14" height="10" fill="var(--lk-skin)"/>
  <ellipse cx="42" cy="72" rx="7" ry="9" fill="var(--lk-skin)"/><ellipse cx="118" cy="72" rx="7" ry="9" fill="var(--lk-skin)"/>
  <circle cx="80" cy="70" r="38" fill="var(--lk-skin)"/>
  <path d="M42 68 Q40 30 80 30 Q120 30 118 68 Q112 50 98 46 Q80 54 62 46 Q48 50 42 68 Z" fill="var(--lk-hair)"/>
  <ellipse cx="67" cy="72" rx="5" ry="6.5" fill="#262a33"/><ellipse cx="93" cy="72" rx="5" ry="6.5" fill="#262a33"/>
  <circle cx="69" cy="70" r="1.8" fill="#fff"/><circle cx="95" cy="70" r="1.8" fill="#fff"/>
  <ellipse cx="58" cy="84" rx="6" ry="4" fill="#f39b93" opacity=".8"/><ellipse cx="102" cy="84" rx="6" ry="4" fill="#f39b93" opacity=".8"/>
  <path d="M72 86 Q80 94 88 86" stroke="#a8433a" stroke-width="3" fill="none" stroke-linecap="round"/>
  ${Object.entries(HAT_SVG).filter(([, s]) => s).map(([id, s]) => `<g class="lk-hat lk-hat-${id}">${s}</g>`).join('')}
</svg>`;
const MINI_HEAD = '<circle cx="80" cy="70" r="38" fill="var(--lk-skin)" opacity=".55"/>';
const miniHat = id => `<svg viewBox="26 0 108 78" aria-hidden="true" focusable="false">${MINI_HEAD}${HAT_SVG[id] ||
  '<path d="M52 44 L108 44" stroke="#e8d3a8" stroke-width="3" stroke-dasharray="5 5" stroke-linecap="round"/>'}</svg>`;
const LOCK = `<svg class="lk-lock" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="7" width="10" height="8" rx="1.5" fill="#e8d3a8"/>
  <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="#e8d3a8" stroke-width="2" fill="none"/></svg>`;

function markup() {
  const rows = SLOTS.map(slot => `<div class="lk-row"><span id="lk-l-${slot}">${SLOT_LABEL[slot]}</span>
    <div class="lk-sw" role="radiogroup" aria-labelledby="lk-l-${slot}" data-slot="${slot}" style="--half:${Math.ceil(PALETTE[slot].length / 2)}">${PALETTE[slot].map(([, label, hex], i) =>
      `<button type="button" role="radio" aria-checked="false" tabindex="-1" data-i="${i}" aria-label="${esc(SLOT_LABEL[slot] + ': ' + label)}" title="${esc(label)}" style="--c:${hex}"><i></i></button>`).join('')}</div></div>`).join('');
  const hats = HATS.map(h => `<button type="button" role="radio" aria-checked="false" tabindex="-1" data-hat="${h.id}" aria-label="Hat: ${esc(h.label)}">${miniHat(h.id)}<b>${esc(h.label)}</b><small hidden></small></button>`).join('');
  return `<div class="lk-wrap" tabindex="-1" data-look-ui="1">
  <div class="lk-head"><h2 id="lk-title">Your look</h2>
    <button type="button" class="lk-close" aria-label="Close"><svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><use href="${SPRITE_URL}#icon-close"></use></svg></button></div>
  <div class="lk-body"><div class="lk-preview">${FIGURE}</div>
    <div class="lk-rows">${rows}<div class="lk-row"><span id="lk-l-hat">Hat</span><div class="lk-hats" role="radiogroup" aria-labelledby="lk-l-hat" data-slot="hat">${hats}</div></div></div></div>
  <div class="lk-foot"><button type="button" data-act="shuffle">Shuffle</button><button type="button" class="lk-done" data-act="done">Done</button></div>
</div>`;
}

function ensureStyle() {
  let st = document.getElementById(STYLE_ID);
  if (!st) { st = document.createElement('style'); st.id = STYLE_ID; document.head.append(st); }
  if (st.textContent !== CSS) st.textContent = CSS;
}
function mountDialog() {
  let d = document.getElementById('lookDialog');
  if (!d || d.tagName !== 'DIALOG') { if (d) d.remove(); d = document.createElement('dialog'); d.id = 'lookDialog'; document.body.append(d); }
  d.className = 'lk';
  d.setAttribute('aria-labelledby', 'lk-title');
  d.innerHTML = markup(); // cheap; always the current markup after a hot swap
  return d;
}

export function createLookUI({ getState, onChange, onSend, onPause, onResume } = {}) {
  const prev = globalThis[INST_KEY];
  if (prev) { try { prev.destroy(); } catch {} }
  const ac = new AbortController(), opt = { signal: ac.signal };
  const safe = (fn, ...a) => { try { return typeof fn === 'function' ? fn(...a) : undefined; } catch (err) { console.warn('[look]', err); } };
  let alive = true, isOpen = false, sendTimer = 0, dirty = false;

  ensureStyle();
  const dlg = mountDialog();
  const fig = dlg.querySelector('.lk-fig');
  const state = () => {
    const s = safe(getState) || {};
    return { look: cleanLook(s.look), unlocked: s.unlocked instanceof Set ? s.unlocked : new Set() };
  };

  function paint() {
    const { look, unlocked } = state(), c = lookColors(look);
    const st = dlg.style;
    st.setProperty('--lk-shirt', c.shirt); st.setProperty('--lk-band', shade(c.shirt, 0.8)); st.setProperty('--lk-knit', shade(c.shirt, 0.88));
    st.setProperty('--lk-trousers', c.trousers); st.setProperty('--lk-bucket', shade(c.trousers, 1.08));
    st.setProperty('--lk-skin', c.skin); st.setProperty('--lk-hair', c.hair);
    fig.dataset.hat = look.hat;
    for (const g of dlg.querySelectorAll('.lk-sw')) {
      const v = look[g.dataset.slot];
      for (const b of g.children) { const on = +b.dataset.i === v; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; }
    }
    for (const b of dlg.querySelectorAll('.lk-hats button')) {
      const h = HATS.find(x => x.id === b.dataset.hat), ok = hatAvailable(h.id, unlocked), on = h.id === look.hat;
      b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
      const cap = b.querySelector('small'), lock = b.querySelector('.lk-lock');
      if (ok) { b.removeAttribute('aria-disabled'); b.removeAttribute('title'); cap.hidden = true; lock?.remove(); }
      else {
        const hint = 'Unlock: ' + achName(h.unlock);
        b.setAttribute('aria-disabled', 'true'); b.title = hint; cap.textContent = hint; cap.hidden = false;
        b.setAttribute('aria-label', `Hat: ${h.label} (locked. ${hint})`);
        if (!lock) b.insertAdjacentHTML('afterbegin', LOCK);
      }
      if (ok) b.setAttribute('aria-label', 'Hat: ' + h.label);
    }
  }

  function flushSend() { clearTimeout(sendTimer); sendTimer = 0; if (dirty) { dirty = false; safe(onSend); } }
  function pick(patch) {
    const { look, unlocked } = state();
    const next = cleanLook({ ...look, ...patch });
    if (!hatAvailable(next.hat, unlocked) || lookKey(next) === lookKey(look)) return;
    safe(onChange, next);
    paint();
    dirty = true; clearTimeout(sendTimer); sendTimer = setTimeout(() => { if (alive) flushSend(); }, SEND_MS);
  }
  function shuffle() {
    const { unlocked } = state(), r = n => Math.floor(Math.random() * n);
    const hats = HATS.filter(h => hatAvailable(h.id, unlocked));
    const patch = { hat: hats[r(hats.length)].id };
    for (const s of SLOTS) patch[s] = r(PALETTE[s].length);
    pick(patch);
  }

  function open() {
    if (!alive || isOpen) return;
    isOpen = true;
    safe(onPause);
    if (document.pointerLockElement) { try { document.exitPointerLock(); } catch {} }
    paint();
    if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
    try { dlg.querySelector('.lk-sw [aria-checked=true]')?.focus({ preventScroll: true }); } catch {}
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    flushSend();
    if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }
    safe(onResume);
  }

  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); }, opt);
  dlg.addEventListener('close', () => { if (isOpen) { isOpen = false; flushSend(); safe(onResume); } }, opt);
  dlg.addEventListener('click', e => {
    const t = e.target;
    if (t?.closest?.('.lk-close') || t?.closest?.('[data-act=done]')) { close(); return; }
    if (t?.closest?.('[data-act=shuffle]')) { shuffle(); return; }
    const sw = t?.closest?.('.lk-sw button');
    if (sw) { pick({ [sw.parentElement.dataset.slot]: +sw.dataset.i }); return; }
    const hb = t?.closest?.('.lk-hats button');
    if (hb && hb.getAttribute('aria-disabled') !== 'true') pick({ hat: hb.dataset.hat });
  }, opt);
  dlg.addEventListener('keydown', e => { // arrow keys move (and pick) within one radio row, skipping locked hats
    const b = e.target?.closest?.('[role=radio]');
    if (!b) return;
    const all = [...b.parentElement.children].filter(x => x.getAttribute('aria-disabled') !== 'true');
    let i = all.indexOf(b);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') i = (i + 1) % all.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') i = (i + all.length - 1) % all.length;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = all.length - 1;
    else return;
    e.preventDefault();
    const n = all[i]; if (!n) return;
    n.click(); try { n.focus({ preventScroll: false }); } catch {}
  }, opt);
  dlg.addEventListener('wheel', e => e.stopPropagation(), { ...opt, passive: true });
  document.addEventListener('littleraft:open-look', () => open(), opt);

  const api = {
    open, close, refresh: () => { if (alive) paint(); },
    get isOpen() { return isOpen; },
    destroy() {
      if (!alive) return;
      if (isOpen) { isOpen = false; flushSend(); if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } } }
      alive = false; clearTimeout(sendTimer); ac.abort();
      if (globalThis[INST_KEY] === api) globalThis[INST_KEY] = null;
    },
  };
  if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }
  paint();
  globalThis[INST_KEY] = api;
  return api;
}

export default createLookUI;
