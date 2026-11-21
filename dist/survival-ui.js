// Little Raft survival UI: shared-play hotbar (.tools) + inventory/crafting dialog (#inventory).
// Pure view layer. It never mutates the Bag; all changes go through the callbacks.
import { RECIPES, ITEM_INFO, HOTBAR_SIZE, STACK_SIZE, SLOT_COUNT, TOOL_DURABILITY } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { iconURL, warmIcons, onIconReady, setModelProvider } from './item-icons.js?build=v3-survival-ae77fa84ac2b';

const VERSION = 'sv3';
const HB = Number(HOTBAR_SIZE) || 8;
const TOTAL = Number(SLOT_COUNT) || 28;
const DUR_MAX = Number(TOOL_DURABILITY) > 0 ? Number(TOOL_DURABILITY) : 0;
const TRANSIENT = ['sv-src', 'sv-over', 'sv-dragging', 'sv-deny'];
const INST_KEY = '__littleRaftSurvivalUI';

const BUILD = (() => { try { return new URL(import.meta.url).searchParams.get('build') || 'dev'; } catch { return 'dev'; } })();
const SPRITE_URL = (() => {
  try { const u = new URL('icons.svg', import.meta.url); u.search = '?build=' + encodeURIComponent(BUILD); return u.href; }
  catch { return 'icons.svg'; }
})();

// Symbols that actually exist in icons.svg.
const SPRITES = new Set(['hook', 'floor', 'fish', 'wood', 'leaf', 'scrap', 'barrel', 'sail', 'palm', 'lantern', 'net', 'crew', 'help', 'sound', 'close', 'repair', 'hammer', 'compass']);
// Item kind (normalised) -> sprite symbol.
const SPRITE_FOR = {
  hook: 'hook', plastichook: 'hook', grapplinghook: 'hook',
  hammer: 'hammer', buildhammer: 'hammer',
  fishingrod: 'fish', rod: 'fish', fish: 'fish', rawfish: 'fish', cookedfish: 'fish',
  wood: 'wood', plank: 'wood', planks: 'wood', log: 'wood',
  floor: 'floor', foundation: 'floor', raft: 'floor',
  leaf: 'leaf', leaves: 'leaf', palmleaf: 'leaf', thatch: 'leaf',
  scrap: 'scrap', metal: 'scrap',
  barrel: 'barrel', net: 'net', collectionnet: 'net', sail: 'sail',
  lantern: 'lantern', compass: 'compass', repair: 'repair', palm: 'palm',
};
// Hand-drawn fallbacks for kinds without a sprite (same palette as icons.svg).
const CUSTOM = {
  plastic: `<g stroke="#153e49" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <rect x="20" y="4" width="8" height="5.5" rx="1" fill="#ffbd66"/>
    <path d="M21 9.5 H27 V13 C33 15 35 19 35 24 V40 C35 42.5 33 44 30.5 44 H17.5 C15 44 13 42.5 13 40 V24 C13 19 15 15 21 13 Z" fill="#9fd6d0"/>
    <rect x="13" y="27" width="22" height="7" fill="#54a6a4"/>
    <path d="M21 9.5 H27 V13 C33 15 35 19 35 24 V40 C35 42.5 33 44 30.5 44 H17.5 C15 44 13 42.5 13 40 V24 C13 19 15 15 21 13 Z" fill="none"/>
    <path d="M28 18 L31 22 M24 37 L27 40" fill="none" stroke-width="1.2" stroke-opacity=".6"/></g>
    <path d="M17 19 C16 23 16 30 17 39" fill="none" stroke="#fff2cc" stroke-width="1.8" stroke-linecap="round" stroke-opacity=".85"/>`,
  rope: `<g fill="none" stroke-linecap="round">
    <ellipse cx="23" cy="25" rx="17" ry="14" stroke="#153e49" stroke-width="7.5"/>
    <ellipse cx="23" cy="25" rx="17" ry="14" stroke="#bb8650" stroke-width="4.2"/>
    <ellipse cx="23" cy="25" rx="17" ry="14" stroke="#153e49" stroke-width="1.1" stroke-dasharray="2 3.5" stroke-opacity=".55"/>
    <ellipse cx="23" cy="25" rx="9.5" ry="7.5" stroke="#153e49" stroke-width="7.5"/>
    <ellipse cx="23" cy="25" rx="9.5" ry="7.5" stroke="#c99560" stroke-width="4.2"/>
    <ellipse cx="23" cy="25" rx="9.5" ry="7.5" stroke="#153e49" stroke-width="1.1" stroke-dasharray="2 3.5" stroke-opacity=".55"/>
    <path d="M35 35 C38 40 42 42 45 41" stroke="#153e49" stroke-width="6"/>
    <path d="M35 35 C38 40 42 42 45 41" stroke="#bb8650" stroke-width="3"/></g>`,
};

const norm = k => String(k ?? '').toLowerCase().replace(/[\s_\-]/g, '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp01 = v => Math.max(0, Math.min(1, v));
const info = kind => (ITEM_INFO && ITEM_INFO[kind]) || null;

function itemName(kind) {
  const i = info(kind);
  if (i && (i.name || i.label)) return String(i.name || i.label);
  return String(kind ?? '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, c => c.toUpperCase());
}
function stackMax(kind) {
  const m = Number(info(kind)?.maxStack);
  if (m > 0) return m;
  if (typeof STACK_SIZE === 'number') return STACK_SIZE;
  const v = (STACK_SIZE && STACK_SIZE[kind]) ?? info(kind)?.stack ?? info(kind)?.stackSize;
  return Number(v) || 0;
}
function durFrac(s) {
  if (!s || s.durability == null) return null;
  const d = Number(s.durability); if (!Number.isFinite(d)) return null;
  const i = info(s.kind);
  let max = Number(i?.maxDurability ?? i?.durability ?? i?.maxDur ?? s.maxDurability);
  if (!(max > 0)) max = DUR_MAX;
  if (max > 0) return clamp01(d / max);
  return d <= 1 ? clamp01(d) : 1;
}
// Rendered 3D icon when ready, flat sprite until then. data-icon lets a late render swap it in place.
function iconHTML(kind) {
  const url = iconURL(kind);
  if (url) return `<img class="sv-icon sv-3d" data-icon="${esc(kind)}" src="${url}" alt="" draggable="false">`;
  return iconSVG(kind).replace('<svg ', `<svg data-icon="${esc(kind)}" `);
}
function iconSVG(kind) {
  const n = norm(kind);
  const meta = info(kind);
  // Placeholder (borrowed) sprite + a dedicated inline drawing -> prefer the drawing.
  const custom = meta?.placeholder && CUSTOM[n];
  // A borrowed sprite would show the wrong item (water as a barrel), so wait on a blank tile instead.
  if (meta?.placeholder && !custom) return '<svg class="sv-icon sv-blank" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><circle cx="24" cy="24" r="8" fill="#ffffff12"/></svg>';
  let id = custom ? null : meta?.icon;
  if (typeof id === 'string') id = id.replace(/^icon-/, ''); else id = null;
  if (!custom && (!id || !SPRITES.has(id))) id = SPRITE_FOR[n];
  if (!custom && id && SPRITES.has(id)) return `<svg class="sv-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><use href="${SPRITE_URL}#icon-${id}"></use></svg>`;
  const body = CUSTOM[n] || `<rect x="7" y="9" width="34" height="30" rx="3" fill="#bb8650" stroke="#153e49" stroke-width="2"/>
    <path d="M7 17 H41 M7 31 H41" stroke="#153e49" stroke-width="1.3" stroke-opacity=".55"/>
    <text x="24" y="29" text-anchor="middle" font-family="Segoe UI,system-ui,sans-serif" font-size="13" font-weight="700" fill="#fff2cc" stroke="#153e49" stroke-width=".7">${esc(itemName(kind).replace(/\s+/g, '').slice(0, 2))}</text>`;
  return `<svg class="sv-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${body}</svg>`;
}

// ---- recipe normalisation (tolerant of a few shapes) ----
function reqsOf(r) {
  const c = r.cost ?? r.inputs ?? r.ingredients ?? r.requires ?? r.needs ?? {};
  if (Array.isArray(c)) return c.map(x => Array.isArray(x) ? { kind: x[0], count: Number(x[1]) || 1 } : { kind: x.kind ?? x.item ?? x.id, count: Number(x.count ?? x.amount) || 1 }).filter(q => q.kind != null);
  return Object.entries(c).map(([kind, count]) => ({ kind, count: Number(count) || 0 })).filter(q => q.count > 0);
}
function outOf(r, id) {
  const o = r.output ?? r.result ?? r.makes ?? r.yields;
  if (o && typeof o === 'object') return { kind: o.kind ?? o.item ?? o.id ?? id, count: Number(o.count ?? o.amount) || 1 };
  if (typeof o === 'string') return { kind: o, count: Number(r.count) || 1 };
  return { kind: r.kind ?? r.item ?? id, count: Number(r.count) || 1 };
}
function recipeList() {
  return Object.entries(RECIPES || {}).map(([key, r]) => {
    if (!r || typeof r !== 'object') return null;
    const id = String(r.id ?? key);
    const out = outOf(r, id);
    return { id, out, name: String(r.name ?? r.label ?? itemName(out.kind)), reqs: reqsOf(r) };
  }).filter(Boolean);
}

// ---- styles ----
const FONT = "var(--ui-font,'Segoe UI',system-ui,sans-serif)";
const CSS = `
.tools.sv-hotbar{--s:52px;--g:6px;--px:0px;--py:0px;position:relative;display:flex;flex-wrap:nowrap;gap:var(--g);padding:0;border:0;border-radius:0;max-width:96vw;overflow:visible;background:none;box-shadow:none}
.tools.sv-hotbar::before,.tools.sv-hotbar::after{content:none;display:none}
.tools.sv-hotbar>button.sv-slot,#inventory.sv-inv button.sv-slot{
  position:relative;display:block;flex:0 0 auto;width:var(--s);height:var(--s);min-width:0;min-height:0;margin:0;padding:0;border:0;border-radius:6px;
  background:linear-gradient(180deg,#20282cb0,#0d1215c4);
  box-shadow:inset 0 0 0 1px #ffffff1c,inset 0 1px 0 #ffffff14,0 2px 8px #0005;
  color:#f4efe2;font:600 14px/1 ${FONT};letter-spacing:0;text-transform:none;cursor:pointer;transform:none;outline:none;
  transition:transform .18s cubic-bezier(.3,1.5,.5,1),background .15s,box-shadow .15s}
.tools.sv-hotbar>button.sv-slot::after{content:none;display:none}
.sv-slot i{font-style:normal;pointer-events:none}
.sv-slot .sv-num{position:absolute;left:5px;top:4px;z-index:1;font:700 10px/1 ${FONT};color:#f4efe2;opacity:.45;text-shadow:0 1px 1px #000}
.sv-slot .sv-art{position:absolute;inset:5px;display:block;transition:scale .2s cubic-bezier(.3,1.5,.5,1)}
.sv-icon{display:block;width:100%;height:100%;object-fit:contain;-webkit-user-drag:none;user-select:none}
.sv-slot .sv-icon{filter:drop-shadow(0 2px 2px #0009)}
.sv-slot svg.sv-icon{scale:.78}
.sv-slot .sv-count{position:absolute;right:5px;bottom:4px;z-index:1;font:800 14px/1 ${FONT};color:#fff;font-variant-numeric:tabular-nums;
  text-shadow:1px 1px 0 #000,-1px 1px 0 #000,1px -1px 0 #000,-1px -1px 0 #000,0 2px 3px #000}
.sv-slot .sv-dur{position:absolute;left:8px;right:8px;bottom:5px;z-index:1;height:3px;border-radius:2px;background:#000a;display:block;overflow:hidden}
.sv-slot .sv-dur[hidden]{display:none}
.sv-slot .sv-dur>i{display:block;height:100%;width:100%;background:#8fd36a;transition:width .3s}
.sv-slot.sv-bumpA .sv-art{animation:svBumpA .34s ease-out}.sv-slot.sv-bumpB .sv-art{animation:svBumpB .34s ease-out}
@keyframes svBumpA{35%{transform:scale(1.22) rotate(-6deg)}}@keyframes svBumpB{35%{transform:scale(1.22) rotate(-6deg)}}
.tools.sv-hotbar>button.sv-slot:hover,#inventory.sv-inv button.sv-slot:hover{background:linear-gradient(180deg,#323d42c0,#151c20d0)}
.tools.sv-hotbar>button.sv-slot.sv-sel{transform:scale(1.06);background:linear-gradient(180deg,#46545ad0,#1c2529dc);box-shadow:inset 0 1px 0 #ffffff26,0 6px 14px #0007}
.tools.sv-hotbar>button.sv-slot.sv-sel .sv-art{scale:1.1}
.tools.sv-hotbar>button.sv-slot.sv-sel .sv-num{opacity:.95}
.tools.sv-hotbar>button.sv-slot:focus-visible,#inventory.sv-inv button.sv-slot:focus-visible{outline:2px solid #fff3d6;outline-offset:1px}
.tools.sv-hotbar>.sv-cursor{position:absolute;left:var(--px);top:var(--py);z-index:2;width:var(--s);height:var(--s);border-radius:6px;pointer-events:none;
  transform:translate(calc(var(--i,0) * (var(--s) + var(--g))),0) scale(1.06);transition:transform .2s cubic-bezier(.3,1.3,.5,1),opacity .2s;
  box-shadow:inset 0 0 0 2px #fff6e0,0 0 0 1px #0008,0 0 14px #fff3d64d}
.tools.sv-hotbar>.sv-cursor.sv-off{opacity:0}
.tools.sv-hotbar>.sv-label{position:absolute;left:calc(var(--px) + var(--s) / 2);bottom:calc(100% + 12px);z-index:2;padding:5px 11px;border-radius:5px;white-space:nowrap;pointer-events:none;
  background:#0c1114d0;color:#f8f3e6;font:700 13px/1.2 ${FONT};box-shadow:inset 0 0 0 1px #ffffff1f,0 4px 10px #0005;opacity:0;
  transform:translate(calc(var(--i,0) * (var(--s) + var(--g)) - 50%),5px);transition:opacity .25s,transform .22s cubic-bezier(.3,1.3,.5,1)}
.tools.sv-hotbar>.sv-label.sv-show{opacity:1;transform:translate(calc(var(--i,0) * (var(--s) + var(--g)) - 50%),0)}
@media(max-width:760px){.tools.sv-hotbar{--s:min(42px,calc((96vw - 27px) / 10));--g:3px}.tools.sv-hotbar .sv-art{inset:3px}.tools.sv-hotbar .sv-count{font-size:12px}}
#inventory.sv-inv{--s:56px;--g:6px;padding:0;margin:auto;border:0;border-radius:12px;background:transparent;box-shadow:none;color:#f4efe2;
  width:max-content;min-width:0;max-width:96vw;max-height:94vh;overflow:visible;font:500 14px/1.35 ${FONT}}
#inventory.sv-inv::backdrop{background:radial-gradient(ellipse at center,#0610144d,#061014a6);-webkit-backdrop-filter:none;backdrop-filter:none}
#inventory .sv-wrap{display:flex;gap:14px;align-items:stretch;padding:14px;outline:none;border-radius:12px;
  background:linear-gradient(180deg,#1a2226e6,#0e1417ee);box-shadow:inset 0 0 0 1px #ffffff17,inset 0 1px 0 #ffffff12,0 20px 60px #000a}
#inventory .sv-craft,#inventory .sv-bag{background:#00000038;border-radius:9px;box-shadow:inset 0 0 0 1px #ffffff0d}
#inventory .sv-craft{flex:0 0 300px;width:300px;min-width:300px;box-sizing:border-box;contain:size;max-height:min(520px,calc(94vh - 30px));overflow:auto;overscroll-behavior:contain;padding:10px;scrollbar-width:thin;scrollbar-color:#ffffff38 transparent}
#inventory .sv-bag{flex:none;min-width:max-content;display:flex;flex-direction:column;align-items:center;gap:9px;padding:10px 12px 12px}
#inventory .sv-grid{display:grid;grid-template-columns:repeat(${HB},var(--s));gap:var(--g)}
#inventory .sv-hotrow{display:grid;grid-template-columns:repeat(${HB},var(--s));gap:var(--g)}
#inventory .sv-h{align-self:stretch;margin:2px 2px 1px;font:800 11px/1 ${FONT};letter-spacing:2.2px;text-transform:uppercase;color:#f4efe2b3}
#inventory .sv-craft>.sv-h{margin:4px 2px 10px}
#inventory .sv-slot.sv-hot{background:linear-gradient(180deg,#26313690,#10171ab0)}
#inventory.sv-inv button.sv-slot.sv-sel{background:linear-gradient(180deg,#46545ad0,#1c2529dc);box-shadow:inset 0 0 0 2px #fff6e0,0 0 12px #fff3d633}
#inventory.sv-inv button.sv-slot.sv-src{background:linear-gradient(180deg,#5d4a2ad0,#2b2214dc);box-shadow:inset 0 0 0 2px #ffc66e,0 0 12px #ffc66e66;transform:translateY(-3px)}
#inventory.sv-inv button.sv-slot.sv-over{box-shadow:inset 0 0 0 2px #9fe0d6,0 0 10px #9fe0d677;transform:scale(1.06)}
#inventory.sv-inv button.sv-slot.sv-deny{box-shadow:inset 0 0 0 2px #e06a4a,0 0 6px #e06a4a88;animation:svShake .26s}
@keyframes svShake{25%{translate:-3px 0}75%{translate:3px 0}}
#inventory .sv-slot.sv-dragging{opacity:.4}
#inventory .sv-slot.sv-src:not([data-pick]) .sv-art,#inventory .sv-slot.sv-src:not([data-pick]) .sv-count{opacity:.3}
#inventory .sv-held{position:fixed;left:0;top:0;z-index:11;width:52px;height:52px;pointer-events:none;filter:drop-shadow(0 6px 6px #000a)}
#inventory .sv-held .sv-art{position:absolute;inset:0;display:block;scale:1.15}
#inventory .sv-held .sv-count{position:absolute;right:0;bottom:0;font:800 14px/1 ${FONT};color:#fff;text-shadow:1px 1px 0 #000,-1px 1px 0 #000,1px -1px 0 #000,-1px -1px 0 #000}
#inventory .sv-slot[data-pick]::after{content:attr(data-pick);position:absolute;right:-5px;top:-6px;z-index:2;min-width:16px;padding:2px 3px;border-radius:8px;
  background:#ffc66e;color:#1d1608;font:700 11px/1 ${FONT};text-align:center;box-shadow:0 1px 2px #0008}
#inventory .sv-rope{width:100%;height:1px;margin:2px 0;background:linear-gradient(90deg,transparent,#ffffff2e 15%,#ffffff2e 85%,transparent)}
#inventory .sv-hint{margin:0;max-width:${HB * 62}px;font:500 12px/1.35 ${FONT};color:#f4efe280;text-align:center}
#inventory .sv-recipe{display:grid;grid-template-columns:48px 1fr;gap:11px;align-items:center;width:100%;height:auto;min-height:0;margin:0 0 6px;padding:7px 9px 7px 7px;
  border:0;border-radius:7px;text-align:left;background:#ffffff0b;box-shadow:inset 0 0 0 1px #ffffff12;
  color:#f4efe2;font:600 14px/1.25 ${FONT};letter-spacing:0;text-transform:none;cursor:pointer;transform:none;transition:background .12s,box-shadow .12s}
#inventory .sv-recipe:last-child{margin-bottom:0}
#inventory .sv-recipe:hover:not(:disabled){background:#ffffff17;box-shadow:inset 0 0 0 1px #fff6e0a8}
#inventory .sv-recipe:active:not(:disabled){background:#ffffff0f}
#inventory .sv-recipe:disabled{cursor:not-allowed}
#inventory .sv-recipe:disabled .sv-rart,#inventory .sv-recipe:disabled .sv-rname{opacity:.55}
#inventory .sv-recipe:focus-visible{outline:2px solid #fff3d6;outline-offset:1px}
#inventory .sv-rart{display:grid;place-items:center;width:48px;height:48px;border-radius:6px;background:linear-gradient(180deg,#20282cb0,#0d1215c4);box-shadow:inset 0 0 0 1px #ffffff1c}
#inventory .sv-rart .sv-icon{width:42px;height:42px;filter:drop-shadow(0 2px 2px #0009)}
#inventory .sv-rart svg.sv-icon{width:32px;height:32px}
#inventory .sv-rbody{display:block;min-width:0}
#inventory .sv-rname{display:block;font:700 14px/1.2 ${FONT};color:#f8f3e6}
#inventory .sv-reqs{display:flex;flex-wrap:wrap;gap:4px 5px;margin-top:5px}
#inventory .sv-req{display:inline-flex;align-items:center;gap:2px;padding:1px 7px 1px 2px;border-radius:12px;background:#0000004d;font:700 12px/1 ${FONT};color:#e9e3d3;font-variant-numeric:tabular-nums}
#inventory .sv-req .sv-icon{width:22px;height:22px}
#inventory .sv-req svg.sv-icon{width:16px;height:16px;margin:3px}
#inventory .sv-req.sv-short{color:#ff9c84;background:#5a1d1240}
#inventory .sv-why{display:block;margin-top:4px;font:600 12px/1.2 ${FONT};color:#ffc98f}
#inventory .sv-why:empty{display:none}
#inventory .sv-empty-list{margin:6px;color:#f4efe299;font-size:14px}
#inventory .sv-tip{position:fixed;left:0;top:0;z-index:10;pointer-events:none;padding:6px 10px;border-radius:6px;white-space:nowrap;
  background:#0b1013f0;box-shadow:inset 0 0 0 1px #ffffff26,0 4px 12px #0008;color:#f8f3e6;font:700 14px/1.3 ${FONT}}
#inventory .sv-tip[hidden]{display:none}
#inventory .sv-tip small{display:block;font:500 12px/1.3 ${FONT};color:#f4efe299}
@media(max-width:860px),(max-height:520px){#inventory.sv-inv{width:auto}#inventory .sv-wrap{flex-direction:column;max-height:94vh;overflow:auto;box-sizing:border-box}#inventory .sv-craft{flex:none;width:auto;min-width:0;max-height:36vh;contain:none}#inventory .sv-bag{min-width:0}
  #inventory.sv-inv{--s:44px;--g:5px}#inventory .sv-slot .sv-art{inset:3px}}
@media(prefers-reduced-motion:reduce){.sv-slot,.sv-recipe,.sv-art,.sv-cursor,.sv-label{transition:none!important;animation:none!important}}
`;

function ensureStyle() {
  let st = document.getElementById('survival-style');
  if (!st) { st = document.createElement('style'); st.id = 'survival-style'; document.head.append(st); }
  if (st.textContent !== CSS) st.textContent = CSS;
}

const slotInner = num => `${num ? `<i class="sv-num">${num}</i>` : ''}<i class="sv-art"></i><i class="sv-count"></i><i class="sv-dur" hidden><i></i></i>`;

function mountDialog() {
  let d = document.getElementById('inventory');
  if (!d || d.tagName !== 'DIALOG') {
    d = document.createElement('dialog'); d.id = 'inventory';
    document.body.append(d);
  }
  d.classList.add('sv-inv');
  d.setAttribute('aria-label', 'Inventory and crafting');
  if (d.dataset.sv !== VERSION || d.querySelectorAll('.sv-slot[data-index]').length !== TOTAL) {
    let grid = '', hot = '';
    for (let i = HB; i < TOTAL; i++) grid += `<button type="button" class="sv-slot" data-index="${i}">${slotInner('')}</button>`;
    for (let i = 0; i < HB; i++) hot += `<button type="button" class="sv-slot sv-hot" data-index="${i}">${slotInner(String((i + 1) % 10))}</button>`;
    d.innerHTML = `<div class="sv-wrap" tabindex="-1">
      <section class="sv-craft" aria-label="Crafting"><h3 class="sv-h">Crafting</h3><div class="sv-rlist"></div></section>
      <section class="sv-bag" aria-label="Inventory">
        <h3 class="sv-h">Backpack</h3>
        <div class="sv-grid" role="group" aria-label="Backpack">${grid}</div>
        <div class="sv-rope" aria-hidden="true"></div>
        <div class="sv-hotrow" role="group" aria-label="Hotbar">${hot}</div>
        <p class="sv-hint">Click to pick up and place · Right-click takes half · Drag to move</p>
      </section>
      <div class="sv-tip" role="tooltip" hidden></div>
      <div class="sv-held" aria-hidden="true" hidden><i class="sv-art"></i><i class="sv-count"></i></div>
    </div>`;
    d.dataset.sv = VERSION;
    delete d.dataset.svRecipes;
  }
  return d;
}

function refs(el) {
  if (!el._svRefs) {
    const dur = el.querySelector('.sv-dur');
    el._svRefs = { art: el.querySelector('.sv-art'), cnt: el.querySelector('.sv-count'), dur, bar: dur && dur.firstElementChild };
  }
  return el._svRefs;
}
function slotSig(s) {
  if (!s || !s.kind || !(s.count > 0)) return '';
  const f = durFrac(s);
  return s.kind + ':' + s.count + ':' + (f == null ? '' : Math.round(f * 100));
}
function paintSlot(el, s, sig, label) {
  if (el._svSig === sig) return false;
  el._svSig = sig;
  const r = refs(el);
  if (!sig) {
    if (el._svKind !== null) { r.art.innerHTML = ''; el._svKind = null; }
    el._svCount = 0;
    r.cnt.textContent = '';
    if (r.dur) r.dur.hidden = true;
    el.classList.add('sv-empty');
    el.setAttribute('aria-label', label + ', empty');
    return true;
  }
  const prev = el._svKind, prevCount = el._svCount;
  if (prev !== s.kind) { r.art.innerHTML = iconHTML(s.kind); el._svKind = s.kind; }
  el._svCount = s.count;
  // Pop the icon when a stack grows or a new item lands (alternating names restart the animation).
  if (prevCount !== undefined && (prev !== s.kind || s.count > prevCount)) {
    const a = el.classList.contains('sv-bumpA');
    el.classList.toggle('sv-bumpA', !a); el.classList.toggle('sv-bumpB', a);
  }
  r.cnt.textContent = s.count > 1 ? String(s.count) : '';
  const f = durFrac(s);
  if (r.dur) {
    r.dur.hidden = f == null;
    if (f != null) { r.bar.style.width = (f * 100).toFixed(0) + '%'; r.bar.style.background = f > 0.5 ? '#8fd36a' : f > 0.25 ? '#ffbd66' : '#e06a4a'; }
  }
  el.classList.remove('sv-empty');
  el.setAttribute('aria-label', `${label}, ${itemName(s.kind)}${s.count > 1 ? ', ' + s.count : ''}${f != null ? ', durability ' + Math.round(f * 100) + ' percent' : ''}`);
  return true;
}

function readSnap(bag) {
  let s;
  try { s = typeof bag.snapshot === 'function' ? bag.snapshot() : bag.snapshot; } catch (e) { return null; }
  return s && Array.isArray(s.slots) ? s : null;
}

// getModel (optional): (kind) -> Object3D, e.g. models.js getModel; icons are rendered from it.
export function createSurvivalUI({ getBag, onSelect, onMove, onCraft, onResume, onPause, getModel } = {}) {
  if (typeof getModel === 'function') setModelProvider(getModel);
  // Hot reload: DOM is adopted, not rebuilt; the previous instance releases its listeners only once
  // this one is fully built (see below), so an early throw leaves the old UI working.
  const prev = window[INST_KEY];

  const ac = new AbortController();
  const opt = { signal: ac.signal };
  let alive = true;

  ensureStyle();
  const dlg = mountDialog();
  const wrap = dlg.querySelector('.sv-wrap');
  const rlist = dlg.querySelector('.sv-rlist');
  const tip = dlg.querySelector('.sv-tip');
  const held = dlg.querySelector('.sv-held'), heldArt = held.firstElementChild, heldCnt = held.lastElementChild;
  let heldKind = null, px = 0, py = 0;
  const invEls = [];
  dlg.querySelectorAll('.sv-slot[data-index]').forEach(el => {
    invEls[+el.dataset.index] = el; el._svSig = undefined;
    // Adopted DOM may carry transient state from a previous (reloaded) instance.
    el.classList.remove(...TRANSIENT); el.removeAttribute('aria-pressed'); delete el.dataset.pick;
  });

  let isOpen = dlg.open;
  let src = null, srcAmt = 0, srcKind = null;
  let denyEl = null, denyTimer = 0;
  let dragging = false, dragFrom = null, dragAmt = 0, overEl = null;
  let hoverIdx = null;
  let lastSig = null;
  let curSlots = [];
  let curSelected = -1;
  let tools = null, hotEls = [];
  let recipes = [], recipeEls = [];

  const safe = (fn, ...a) => { try { return fn?.(...a); } catch (e) { console.error(e); } };
  const bagNow = () => { try { return getBag?.() || null; } catch (e) { console.error(e); return null; } };

  // ---------- recipes ----------
  function buildRecipes() {
    recipes = recipeList();
    const key = recipes.map(r => r.id).join(',');
    if (dlg.dataset.svRecipes !== key || rlist.childElementCount !== recipes.length || !recipes.length) {
      rlist.innerHTML = recipes.length ? recipes.map(r => `<button type="button" class="sv-recipe" data-recipe="${esc(r.id)}">
        <span class="sv-rart" aria-hidden="true">${iconHTML(r.out.kind)}</span>
        <span class="sv-rbody"><span class="sv-rname">${esc(r.name)}${r.out.count > 1 ? ' ×' + r.out.count : ''}</span>
        <span class="sv-reqs">${r.reqs.map(q => `<span class="sv-req" title="${esc(itemName(q.kind))}">${iconHTML(q.kind)}<span class="sv-have">0/${q.count}</span></span>`).join('')}</span>
        <span class="sv-why"></span></span></button>`).join('') : '<p class="sv-empty-list">No recipes known.</p>';
      dlg.dataset.svRecipes = key;
    }
    recipeEls = [...rlist.querySelectorAll('.sv-recipe')].map(el => ({ el, haves: [...el.querySelectorAll('.sv-req')], why: el.querySelector('.sv-why'), sig: null }));
  }
  function countOf(bag, kind) {
    if (typeof bag.count === 'function') { try { return Number(bag.count(kind)) || 0; } catch {} }
    let n = 0; for (const s of curSlots) if (s && s.kind === kind) n += s.count || 0; return n;
  }
  function paintRecipes(bag) {
    recipes.forEach((r, i) => {
      const view = recipeEls[i]; if (!view) return;
      let res = null;
      if (typeof bag.canCraft === 'function') { try { res = bag.canCraft(r.id); } catch (e) { console.error(e); } }
      const owned = r.reqs.map(q => countOf(bag, q.kind));
      if (!res) res = { ok: r.reqs.every((q, k) => owned[k] >= q.count), missing: [], full: false };
      const ok = !!res.ok, full = !!res.full;
      const sig = (ok ? 1 : 0) + (full ? 'f' : '') + owned.join(',');
      if (view.sig === sig) return;
      view.sig = sig;
      r.reqs.forEach((q, k) => {
        const chip = view.haves[k]; if (!chip) return;
        chip.lastElementChild.textContent = `${owned[k]}/${q.count}`;
        chip.classList.toggle('sv-short', owned[k] < q.count);
      });
      view.el.disabled = !ok;
      const lacking = r.reqs.some((q, k) => owned[k] < q.count);
      view.why.textContent = !ok && !lacking && full ? 'No room in inventory' : '';
      view.el.setAttribute('aria-label', `${r.name}${r.out.count > 1 ? ', makes ' + r.out.count : ''}. Needs ${r.reqs.map((q, k) => `${q.count} ${itemName(q.kind)}, have ${owned[k]}`).join('; ') || 'nothing'}.${ok ? ' Craft.' : full && !lacking ? ' Inventory full.' : ' Missing materials.'}`);
    });
  }

  // ---------- hotbar in .tools ----------
  // Hotbar = HB slot buttons + a selection frame that slides between them + a name tag above it.
  let cursor = null, label = null, labelTimer = 0, labelSel = -2, labelKind = null;
  function ensureTools() {
    if (tools && tools.isConnected && tools.dataset.sv === VERSION && hotEls.length === HB && cursor?.parentNode === tools) return tools;
    const t = document.querySelector('.tools');
    if (!t) { tools = null; hotEls = []; return null; }
    if (t.dataset.sv !== VERSION || t.querySelectorAll(':scope>.sv-slot').length !== HB || !t.querySelector(':scope>.sv-cursor')) {
      let html = '';
      for (let i = 0; i < HB; i++) html += `<button type="button" class="sv-slot" data-slot="${i}">${slotInner(String((i + 1) % 10))}</button>`;
      t.innerHTML = html + '<i class="sv-cursor sv-off" aria-hidden="true"></i><b class="sv-label" aria-hidden="true"></b>';
      t.dataset.sv = VERSION;
    }
    t.classList.add('sv-hotbar');
    t.setAttribute('role', 'toolbar');
    t.setAttribute('aria-label', 'Hotbar');
    tools = t;
    cursor = t.querySelector(':scope>.sv-cursor');
    label = t.querySelector(':scope>.sv-label');
    hotEls = [...t.querySelectorAll(':scope>.sv-slot')];
    hotEls.forEach(el => { el._svSig = undefined; el._svCount = undefined; });
    labelSel = -2;
    return t;
  }
  function paintHotbar(slots, sigs, selected) {
    for (let i = 0; i < hotEls.length; i++) {
      const el = hotEls[i];
      paintSlot(el, slots[i], sigs[i], `Hotbar slot ${i + 1}`);
      const sel = i === selected;
      if (el._svSel !== sel) { el._svSel = sel; el.classList.toggle('sv-sel', sel); el.setAttribute('aria-pressed', String(sel)); }
    }
    const kind = selected >= 0 && sigs[selected] ? slots[selected].kind : null;
    if (selected === labelSel && kind === labelKind) return;
    const first = labelSel === -2;
    labelSel = selected; labelKind = kind;
    const on = selected >= 0 && selected < HB;
    tools.style.setProperty('--i', on ? selected : 0);
    cursor.classList.toggle('sv-off', !on);
    // Name tag over the selected slot, then fade (not on the very first paint after spawn).
    clearTimeout(labelTimer);
    if (!kind || first) { label.classList.remove('sv-show'); return; }
    label.textContent = itemName(kind);
    label.classList.add('sv-show');
    labelTimer = setTimeout(() => label.classList.remove('sv-show'), 1400);
  }
  // A late 3D icon render swaps itself in wherever the flat placeholder is showing.
  const offIcons = onIconReady(kind => {
    if (!alive) return;
    const sel = `[data-icon="${kind}"]`;
    for (const root of [tools, dlg]) root?.querySelectorAll(sel).forEach(n => { n.outerHTML = iconHTML(kind); });
  });

  // ---------- inventory grid ----------
  function setSrc(i, amt) {
    clearSrc();
    src = i; srcAmt = amt; srcKind = curSlots[i]?.kind ?? null;
    const el = invEls[i]; if (!el) return;
    el.classList.add('sv-src');
    el.setAttribute('aria-pressed', 'true');
    markPick();
  }
  function markPick() {
    const el = src == null ? null : invEls[src];
    if (!el) return;
    const s = curSlots[src];
    if (s && srcAmt < s.count) el.dataset.pick = String(srcAmt); else delete el.dataset.pick;
    // The picked stack rides under the pointer until it is placed.
    if (heldKind !== srcKind) { heldArt.innerHTML = iconHTML(srcKind); heldKind = srcKind; }
    heldCnt.textContent = srcAmt > 1 ? String(srcAmt) : '';
    held.hidden = false; placeHeld();
  }
  function placeHeld() { held.style.transform = `translate(${px - 26}px,${py - 26}px)`; }
  function clearSrc() {
    if (src != null && invEls[src]) {
      const el = invEls[src];
      el.classList.remove('sv-src'); el.removeAttribute('aria-pressed'); delete el.dataset.pick;
    }
    src = null; srcAmt = 0; srcKind = null;
    held.hidden = true;
  }
  // Brief, subtle red outline on a slot that refused the held stack.
  function clearDeny() {
    if (denyTimer) { clearTimeout(denyTimer); denyTimer = 0; }
    if (denyEl) { denyEl.classList.remove('sv-deny'); denyEl = null; }
  }
  function deny(el) {
    clearDeny();
    if (!alive || !el) return;
    denyEl = el; el.classList.add('sv-deny');
    denyTimer = setTimeout(clearDeny, 280);
  }
  // Predict what Bag.move() will do with the currently known (authoritative) slots.
  // put = how many leave the held stack; ok=false = Bag would refuse.
  function planMove(from, to, amt) {
    const s = curSlots[from], t = curSlots[to];
    if (from === to || !slotSig(s) || !(amt > 0)) return { ok: false, put: 0 };
    const a = Math.min(amt, s.count), whole = a >= s.count;
    if (!slotSig(t)) return { ok: true, put: a };
    const max = stackMax(s.kind);
    if (t.kind === s.kind && max > 1) {
      const space = max - t.count;
      if (space > 0) return { ok: true, put: Math.min(space, a) };
      return whole ? { ok: true, put: a } : { ok: false, put: 0 }; // full/full swap is a no-op
    }
    return whole ? { ok: true, put: a } : { ok: false, put: 0 }; // different kind / tool: whole-stack swap only
  }
  // Network callbacks may return undefined/Promise (pending); only explicit false is a rejection.
  function sendMove(from, to, amt, el) {
    let r;
    try { r = onMove?.(from, to, amt); } catch (e) { console.error(e); r = false; }
    lastSig = null;
    if (r === false) { deny(el); return false; }
    if (r && typeof r.then === 'function') r.then(v => { if (v === false) deny(el); }, e => console.error(e));
    return true;
  }
  function paintInventory(slots, sigs, selected) {
    for (let i = 0; i < TOTAL; i++) {
      const el = invEls[i]; if (!el) continue;
      const changed = paintSlot(el, slots[i], sigs[i], i < HB ? `Hotbar slot ${i + 1}` : `Backpack slot ${i - HB + 1}`);
      el.draggable = !!sigs[i];
      if (i < HB) { const sel = i === selected; if (el._svSel !== sel) { el._svSel = sel; el.classList.toggle('sv-sel', sel); } }
      if (changed && hoverIdx === i) showTip(i);
    }
    if (src != null) {
      const s = slots[src];
      if (!s || !sigs[src] || (srcKind && s.kind !== srcKind)) clearSrc();
      else { srcAmt = Math.max(1, Math.min(srcAmt, s.count)); markPick(); }
    }
  }

  // ---------- tooltip ----------
  function showTip(i) {
    const s = curSlots[i];
    if (!s || !slotSig(s) || dragging) { hideTip(); return; }
    const f = durFrac(s), max = stackMax(s.kind);
    const sub = f != null ? `Durability ${Math.round(f * 100)}%` : s.count > 1 || max > 1 ? (max ? `${s.count} / ${max}` : String(s.count)) : '';
    tip.innerHTML = esc(itemName(s.kind)) + (sub ? `<small>${esc(sub)}</small>` : '');
    tip.hidden = false;
  }
  function hideTip() { if (tip) tip.hidden = true; }
  function placeTip(x, y) {
    if (tip.hidden) return;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const left = Math.min(x + 14, innerWidth - w - 6), top = y + 18 + h > innerHeight - 6 ? y - h - 10 : y + 18;
    tip.style.transform = `translate(${Math.max(6, left)}px,${Math.max(6, top)}px)`;
  }

  // ---------- render ----------
  function render(force) {
    if (!alive) return;
    const bag = bagNow();
    ensureTools();
    const snap = bag && readSnap(bag);
    if (!snap) return;
    const slots = snap.slots;
    const selected = Number.isInteger(snap.selected) ? snap.selected : -1;
    const sigs = new Array(TOTAL);
    let all = '';
    for (let i = 0; i < TOTAL; i++) { sigs[i] = slotSig(slots[i]); all += sigs[i] + '|'; }
    all += selected;
    curSlots = slots; curSelected = selected;
    if (hotEls.length) paintHotbar(slots, sigs, selected);
    if (isOpen && !dragging && (force || all !== lastSig)) {
      lastSig = all;
      paintInventory(slots, sigs, selected);
      paintRecipes(bag);
    }
  }

  // ---------- open / close ----------
  function canOpenNow() {
    if (document.querySelector('dialog[open]:not(#inventory)')) return false;
    return !!document.pointerLockElement || !!document.body?.classList.contains('playing');
  }
  function open() {
    if (!alive || isOpen) return;
    isOpen = true;
    clearSrc();
    safe(onPause);
    if (document.pointerLockElement) { try { document.exitPointerLock(); } catch {} }
    if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
    buildRecipes();
    lastSig = null;
    invEls.forEach(el => { el._svCount = undefined; }); // no pop for changes made while closed
    recipeEls.forEach(v => { v.sig = null; });
    render(true);
    try { wrap.focus({ preventScroll: true }); } catch {}
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    endDrag(false);
    clearSrc(); clearDeny();
    hideTip(); hoverIdx = null;
    if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }
    safe(onResume);
  }

  // ---------- drag & drop ----------
  function endDrag(refresh = true) {
    if (overEl) { overEl.classList.remove('sv-over'); overEl = null; }
    if (dragFrom != null && invEls[dragFrom]) invEls[dragFrom].classList.remove('sv-dragging');
    dragging = false; dragFrom = null; dragAmt = 0;
    if (refresh) lastSig = null;
  }
  const slotFrom = e => e.target?.closest?.('#inventory .sv-slot[data-index]') || null;

  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); }, opt);
  dlg.addEventListener('close', () => {
    if (!isOpen) return;
    isOpen = false; endDrag(false); clearSrc(); clearDeny(); hideTip(); hoverIdx = null;
    safe(onResume);
  }, opt);
  dlg.addEventListener('click', e => {
    if (e.target === dlg) { close(); return; } // backdrop
    const rb = e.target.closest?.('.sv-recipe');
    if (rb) { if (!rb.disabled) { safe(onCraft, rb.dataset.recipe); lastSig = null; } return; }
    const el = slotFrom(e); if (!el) return;
    const i = +el.dataset.index, s = curSlots[i], has = !!slotSig(s);
    if (src == null) { if (has) setSrc(i, s.count); return; }
    if (i === src) { clearSrc(); return; }
    if (!slotSig(curSlots[src])) { clearSrc(); return; }
    const from = src, amt = srcAmt;
    const p = planMove(from, i, amt);
    // Partial stack onto a different kind / full stack: keep holding, flag the slot.
    if (!p.ok) { deny(el); return; }
    if (!sendMove(from, i, amt, el)) return; // sync rejection: selection untouched
    if (src !== from) return;                 // a synchronous update already cleared it
    const left = amt - p.put;
    if (left <= 0) { clearSrc(); return; }
    srcAmt = Math.max(1, Math.min(left, curSlots[from]?.count ?? left));
    markPick();
  }, opt);
  dlg.addEventListener('contextmenu', e => {
    const el = slotFrom(e); if (!el) return;
    e.preventDefault();
    const i = +el.dataset.index, s = curSlots[i], has = !!slotSig(s);
    if (src == null) { if (has) setSrc(i, Math.ceil(s.count / 2)); return; }
    if (i === src) { clearSrc(); return; }
    if (!slotSig(curSlots[src])) { clearSrc(); return; }
    const from = src;
    const hs = curSlots[from];
    // Place a single item; only into an empty slot or a same-kind stack with room.
    const max = stackMax(hs.kind);
    const fits = !slotSig(s) || (s.kind === hs.kind && max > 1 && s.count < max);
    if (!fits) { deny(el); return; }
    if (!sendMove(from, i, 1, el)) return;
    if (src !== from) return;
    const left = srcAmt - 1;
    if (left <= 0) { clearSrc(); return; }
    srcAmt = Math.max(1, Math.min(left, curSlots[from]?.count ?? left));
    markPick();
  }, opt);
  dlg.addEventListener('dragstart', e => {
    const el = slotFrom(e);
    if (!el) { e.preventDefault(); return; }
    const i = +el.dataset.index, s = curSlots[i];
    if (!slotSig(s)) { e.preventDefault(); return; }
    dragging = true; dragFrom = i;
    dragAmt = src === i ? srcAmt : e.shiftKey ? Math.ceil(s.count / 2) : s.count;
    hideTip();
    el.classList.add('sv-dragging');
    held.hidden = true;
    try {
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i));
      const img = el.querySelector('.sv-icon'); if (img) e.dataTransfer.setDragImage(img, img.offsetWidth / 2, img.offsetHeight / 2);
    } catch {}
  }, opt);
  dlg.addEventListener('dragover', e => {
    if (!dragging) return;
    const el = slotFrom(e);
    if (el !== overEl) { overEl?.classList.remove('sv-over'); overEl = el; el?.classList.add('sv-over'); }
    if (el) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch {} }
  }, opt);
  dlg.addEventListener('drop', e => {
    if (!dragging) return;
    e.preventDefault();
    const el = slotFrom(e);
    const from = dragFrom, amt = dragAmt;
    endDrag();
    clearSrc();
    if (el && from != null) {
      const to = +el.dataset.index;
      if (to !== from && amt > 0) { if (planMove(from, to, amt).ok) sendMove(from, to, amt, el); else deny(el); }
    }
  }, opt);
  dlg.addEventListener('dragend', () => { if (dragging) endDrag(); if (src != null) held.hidden = false; }, opt);
  dlg.addEventListener('pointerover', e => {
    const el = slotFrom(e);
    if (!el) { if (hoverIdx != null) { hoverIdx = null; hideTip(); } return; }
    const i = +el.dataset.index;
    if (i !== hoverIdx) { hoverIdx = i; showTip(i); placeTip(e.clientX, e.clientY); }
  }, opt);
  dlg.addEventListener('pointermove', e => {
    px = e.clientX; py = e.clientY;
    if (src != null) placeHeld();
    if (hoverIdx != null) placeTip(px, py);
  }, opt);
  dlg.addEventListener('pointerleave', () => { hoverIdx = null; hideTip(); }, opt);
  // Keep scroll inside the panel from reaching the engine's hotbar wheel handler.
  dlg.addEventListener('wheel', e => e.stopPropagation(), { ...opt, passive: true });

  // Hotbar clicks (delegated so a replaced .tools node needs no rebinding).
  document.addEventListener('click', e => {
    const b = e.target?.closest?.('.tools.sv-hotbar>.sv-slot[data-slot]');
    if (!b || !alive) return;
    e.preventDefault();
    safe(onSelect, +b.dataset.slot);
    if (e.detail > 0) b.blur();
  }, opt);

  // Tab / I toggle while playing; E (which opens the bag from the game) also closes it.
  document.addEventListener('keydown', e => {
    if (!alive || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.code !== 'Tab' && e.code !== 'KeyI' && !(e.code === 'KeyE' && isOpen)) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (isOpen) { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (!canOpenNow()) return;
    e.preventDefault(); e.stopPropagation();
    open();
  }, { ...opt, capture: true });

  buildRecipes();
  if (isOpen) render(true);
  warmIcons(Object.keys(ITEM_INFO || {}));

  const api = {
    update() { render(false); },
    open,
    close,
    destroy() {
      if (!alive) return;
      alive = false;
      ac.abort();
      offIcons();
      clearTimeout(labelTimer);
      endDrag(false);
      clearSrc();
      clearDeny();
      hideTip(); hoverIdx = null;
      if (window[INST_KEY] === api) window[INST_KEY] = null;
    },
    get isOpen() { return isOpen; },
  };
  if (prev && prev !== api && typeof prev.destroy === 'function') { try { prev.destroy(); } catch (e) { console.error(e); } }
  window[INST_KEY] = api;
  render(true);
  return api;
}

export default createSurvivalUI;
