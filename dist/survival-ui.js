// Little Raft survival UI: shared-play hotbar (.tools) + inventory/crafting dialog (#inventory).
// Pure view layer. It never mutates the Bag; all changes go through the callbacks.
import { RECIPES, ITEM_INFO, HOTBAR_SIZE, STACK_SIZE, SLOT_COUNT, TOOL_DURABILITY } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { CATEGORIES, ITEM_TEXT, groupRecipes, ingredientRows, craftableTimes, recipeState, usedIn, amountLabel, holdDelay, HOLD, anchorTip } from './craft-book.js?build=v3-survival-ae77fa84ac2b';
import { ITEM_ICONS } from './item-svg.js'; // [progression-hook]
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
const SPRITES = new Set(['hook', 'floor', 'fish', 'wood', 'leaf', 'scrap', 'barrel', 'sail', 'palm', 'lantern', 'net', 'crew', 'help', 'sound', 'close', 'repair', 'hammer', 'compass', 'antenna', 'cup', 'saltcup', 'freshcup', 'purifier', 'kiln', 'ingot', 'glass', 'brick', 'egg', 'feather', 'nest', 'cushion']);
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
  antenna: 'antenna', receiver: 'compass',
  puffegg: 'egg', feather: 'feather', nestbox: 'nest', cushion: 'cushion',
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
  fishingrod: `<g stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 43 L40 6" stroke="#153e49" stroke-width="6"/>
    <path d="M7 43 L40 6" stroke="#d9b36a" stroke-width="3.4"/>
    <path d="M7 43 L14 35" stroke="#7a4a2a" stroke-width="3.6"/>
    <path d="M19 31.5 L21 29.3 M27 22.5 L29 20.3 M34 14.6 L35.6 12.8" stroke="#153e49" stroke-width="1.3" stroke-opacity=".7"/>
    <circle cx="15.5" cy="37.5" r="4.2" fill="#9ba5a7" stroke="#153e49" stroke-width="2"/>
    <path d="M40 6 C43 14 42 22 38 29" fill="none" stroke="#153e49" stroke-width="1.4"/>
    <circle cx="38" cy="33" r="4.2" fill="#f0e4c6" stroke="#153e49" stroke-width="2"/>
    <path d="M33.8 33 A4.2 4.2 0 0 1 42.2 33 Z" fill="#c8352b" stroke="#153e49" stroke-width="2"/>
    <path d="M38 27.5 V29" stroke="#153e49" stroke-width="1.6"/></g>`,
  // Raw materials (kiln inputs) so Sand / Stone / Clay / Metal Ore no longer share the scrap sprite.
  sand: `<g stroke="#153e49" stroke-width="2" stroke-linejoin="round">
    <path d="M4 40 C10 22 18 14 24 14 C30 14 38 22 44 40 Z" fill="#ecd394"/>
    <path d="M12 30 C16 23 20 19 24 18" fill="none" stroke="#fff2cc" stroke-width="1.8" stroke-linecap="round" stroke-opacity=".9"/></g>
    <g fill="#b8955a"><circle cx="20" cy="30" r="1.3"/><circle cx="28" cy="26" r="1.3"/><circle cx="31" cy="34" r="1.3"/><circle cx="16" cy="36" r="1.3"/><circle cx="24" cy="36" r="1.3"/></g>`,
  stone: `<g stroke="#153e49" stroke-width="2" stroke-linejoin="round">
    <path d="M6 36 C5 27 12 21 20 22 C27 23 30 30 28 37 C26 42 9 42 6 36 Z" fill="#9aa7aa"/>
    <path d="M24 22 C26 13 35 10 41 15 C46 20 44 30 37 31 C31 32 26 29 24 22 Z" fill="#c3cccd"/></g>
    <path d="M11 29 C13 26 16 25 19 25 M29 16 C31 14 34 13 36 14" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-opacity=".7"/>`,
  clay: `<g stroke="#153e49" stroke-width="2" stroke-linejoin="round">
    <path d="M7 34 C5 24 13 15 24 15 C35 15 43 23 41 33 C40 40 33 42 24 42 C15 42 8 40 7 34 Z" fill="#c97a4f"/>
    <path d="M14 27 C19 23 29 23 34 27" fill="none" stroke="#8f4f2e" stroke-width="2.4" stroke-linecap="round"/></g>
    <path d="M13 21 C16 18 20 17 23 17" fill="none" stroke="#f2b48a" stroke-width="2" stroke-linecap="round"/>`,
  metalore: `<g stroke="#153e49" stroke-width="2" stroke-linejoin="round">
    <path d="M5 33 L10 17 L22 9 L36 12 L44 26 L38 40 L18 42 Z" fill="#6d7378"/>
    <path d="M10 17 L22 22 L36 12 M22 22 L18 42 M22 22 L44 26" fill="none" stroke-width="1.2" stroke-opacity=".55"/></g>
    <g stroke="#153e49" stroke-width="1"><path d="M27 27 L32 25 L33 30 L28 32 Z" fill="#e8a04a"/><path d="M12 28 L16 26 L17 30 L13 31 Z" fill="#7fd3cf"/><path d="M24 13 L28 14 L27 17 L23 16 Z" fill="#e8a04a"/></g>`,
  pots: `<g stroke="#153e49" stroke-width="2" stroke-linejoin="round">
    <path d="M17 13 C14 9 12 6 13 4 M17 13 C19 8 22 6 24 6 M33 19 C33 14 36 11 39 11" fill="none" stroke="#5f9e4f" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M6 22 H22 L20 42 H8 Z" fill="#b8653d"/><rect x="5" y="19" width="18" height="5" rx="1" fill="#d59a72"/>
    <path d="M27 28 H41 L39 42 H29 Z" fill="#c9774a"/><rect x="26" y="25" width="16" height="4.5" rx="1" fill="#d59a72"/></g>
    <circle cx="13" cy="4.5" r="2.6" fill="#f2c14e" stroke="#153e49" stroke-width="1"/><circle cx="25" cy="6" r="2.6" fill="#e86f8a" stroke="#153e49" stroke-width="1"/><circle cx="39.5" cy="10.5" r="2.6" fill="#fff4e0" stroke="#153e49" stroke-width="1"/>`,
  chime: `<g stroke="#153e49" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M24 3 V8 M14 12 L24 8 L34 12 M14 12 V16 M21 11 V18 M27 11 V18 M34 12 V16" fill="none" stroke="#d8c89a" stroke-width="1.4"/>
    <rect x="8" y="9" width="32" height="4" rx="1.5" fill="#8a6a45"/>
    <rect x="12" y="16" width="4.5" height="18" rx="2" fill="#c3cccd"/><rect x="19" y="18" width="4.5" height="22" rx="2" fill="#9fd6d0"/>
    <rect x="25.5" y="18" width="4.5" height="16" rx="2" fill="#c3cccd"/><rect x="32" y="16" width="4.5" height="12" rx="2" fill="#9fd6d0"/>
    <path d="M21 40 C16 44 20 47 24 47 C28 47 32 44 27 40 Z" fill="#f6c9b0"/></g>`,
  sign: `<g stroke="#153e49" stroke-width="2" stroke-linejoin="round">
    <rect x="21" y="18" width="6" height="26" fill="#7a5a3a"/>
    <rect x="5" y="6" width="38" height="20" rx="2" fill="#b98a55"/></g>
    <path d="M10 13 H38 M12 19 H34" stroke="#4a2e1a" stroke-width="2.2" stroke-linecap="round"/>`,
};

Object.assign(CUSTOM, ITEM_ICONS); // [progression-hook] dedicated drawings for placeholder kinds
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
const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";
const CSS = `
.tools.sv-hotbar{--s:58px;--g:6px;--px:0px;--py:0px;position:relative;display:flex;flex-wrap:nowrap;gap:var(--g);padding:0;border:0;border-radius:0;max-width:96vw;overflow:visible;background:none;box-shadow:none}
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
.tools.sv-hotbar>button.sv-slot.sv-sel{transform:translateY(-4px);background:linear-gradient(180deg,#46545ad0,#1c2529dc);box-shadow:inset 0 1px 0 #ffffff26,0 6px 14px #0007}
.tools.sv-hotbar>button.sv-slot.sv-sel .sv-art{scale:1.1}
.tools.sv-hotbar>button.sv-slot.sv-sel .sv-num{opacity:.95}
.tools.sv-hotbar>button.sv-slot:focus-visible,#inventory.sv-inv button.sv-slot:focus-visible{outline:2px solid #fff3d6;outline-offset:1px}
.tools.sv-hotbar>.sv-cursor{position:absolute;left:var(--px);top:var(--py);z-index:2;width:var(--s);height:var(--s);border-radius:6px;pointer-events:none;
  transform:translate(calc(var(--i,0) * (var(--s) + var(--g))),-4px);transition:transform .2s cubic-bezier(.3,1.3,.5,1),opacity .2s;
  box-shadow:inset 0 0 0 2px #fff6e0,0 0 0 1px #0008,0 0 14px #fff3d64d}
.tools.sv-hotbar>.sv-cursor.sv-off{opacity:0}
.tools.sv-hotbar>.sv-label{position:absolute;left:calc(var(--px) + var(--s) / 2);bottom:calc(100% + 12px);z-index:2;padding:5px 11px;border-radius:5px;white-space:nowrap;pointer-events:none;
  background:#0c1114d0;color:#f8f3e6;font:700 13px/1.2 ${FONT};box-shadow:inset 0 0 0 1px #ffffff1f,0 4px 10px #0005;opacity:0;
  transform:translate(calc(var(--i,0) * (var(--s) + var(--g)) - 50%),5px);transition:opacity .25s,transform .22s cubic-bezier(.3,1.3,.5,1)}
.tools.sv-hotbar>.sv-label.sv-show{opacity:1;transform:translate(calc(var(--i,0) * (var(--s) + var(--g)) - 50%),0)}
@media(max-width:760px){.tools.sv-hotbar{--s:42px;--g:4px}.tools.sv-hotbar .sv-art{inset:3px}.tools.sv-hotbar .sv-count{font-size:12px}}
#inventory.sv-inv{--s:56px;--g:6px;padding:0;margin:auto;border:0;border-radius:12px;background:transparent;box-shadow:none;color:#f4efe2;
  width:max-content;min-width:0;max-width:96vw;max-height:94vh;overflow:visible;font:500 14px/1.35 ${FONT}}
#inventory.sv-inv::backdrop{background:radial-gradient(ellipse at center,#0610144d,#061014a6);-webkit-backdrop-filter:none;backdrop-filter:none}
#inventory .sv-wrap{display:flex;gap:14px;align-items:stretch;padding:14px;outline:none;border-radius:12px;
  background:linear-gradient(180deg,#1a2226e6,#0e1417ee);box-shadow:inset 0 0 0 1px #ffffff17,inset 0 1px 0 #ffffff12,0 20px 60px #000a}
#inventory .sv-craft,#inventory .sv-bag{background:#00000038;border-radius:9px;box-shadow:inset 0 0 0 1px #ffffff0d}
#inventory .sv-bag{flex:none;min-width:max-content;display:flex;flex-direction:column;align-items:center;gap:9px;padding:10px 12px 12px}
#inventory .sv-grid{display:grid;grid-template-columns:repeat(7,var(--s));gap:var(--g)}
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
#inventory .sv-hint{margin:0;width:${HB * 62 - 6}px;max-width:100%;font:500 12px/1.35 ${FONT};color:#f4efe280;text-align:left}
#inventory .sv-craft{flex:0 0 324px;width:324px;min-width:324px;box-sizing:border-box;max-height:min(560px,calc(94vh - 30px));display:flex;flex-direction:column;gap:8px;padding:9px;overflow:hidden}
#inventory .sv-tabs{display:grid;grid-template-columns:repeat(var(--tabs,4),1fr);gap:4px;flex:none}
#inventory .sv-tab{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0;height:auto;margin:0;padding:6px 2px 5px;border:0;border-radius:4px 4px 2px 2px;
  background:linear-gradient(#1c2427,#141b1e);box-shadow:inset 0 0 0 1px #ffffff33;color:#c9cfd0;font:700 11px/1.1 ${FONT};letter-spacing:.2px;text-transform:none;cursor:pointer;transform:none}
#inventory .sv-tab .sv-icon{width:22px;height:22px;opacity:.8}
#inventory .sv-tab:hover{color:#f8f3e6;box-shadow:inset 0 0 0 1px #fff6e0aa}
#inventory .sv-tab[aria-selected="true"]{background:linear-gradient(#46545a,#1c2529);color:#0b1013;box-shadow:inset 0 0 0 1px #fff6e0,0 2px 0 #fff6e0}
#inventory .sv-tab[aria-selected="true"] .sv-icon{opacity:1}
#inventory .sv-tab:focus-visible{outline:2px solid #fff6e0;outline-offset:1px}
#inventory .sv-tbadge{position:absolute;right:3px;top:3px;min-width:15px;padding:2px 3px;border-radius:8px;background:#6fbf4a;color:#14270b;font:800 10px/1 ${FONT};font-style:normal;text-align:center;box-shadow:0 1px 2px #0008}
#inventory .sv-tbadge:empty{display:none}
#inventory .sv-rlist{flex:1 1 auto;min-height:62px;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:5px;padding-right:2px;scrollbar-color:#46545a #0b1013}
#inventory .sv-recipe{position:relative;display:grid;grid-template-columns:42px 1fr auto;gap:9px;align-items:center;flex:none;width:100%;height:auto;min-height:0;margin:0;padding:5px 8px 5px 6px;
  border:0;border-radius:4px;text-align:left;background:linear-gradient(#232c30,#1c2427);box-shadow:inset 0 0 0 1px #ffffff44;
  color:#f8f3e6;font:600 14px/1.25 ${FONT};letter-spacing:0;text-transform:none;cursor:pointer;transform:none;transition:background .08s,box-shadow .08s}
#inventory .sv-recipe[hidden]{display:none}
#inventory .sv-recipe::before{content:"";position:absolute;left:0;top:5px;bottom:5px;width:3px;border-radius:2px;background:transparent}
#inventory .sv-recipe.sv-ready::before{background:#8fd36a;box-shadow:0 0 6px #8fd36a99}
#inventory .sv-recipe.sv-ready{background:linear-gradient(#2c383d,#263034)}
#inventory .sv-recipe:hover{background:linear-gradient(#343f44,#263034);box-shadow:inset 0 0 0 1px #fff6e0}
#inventory .sv-recipe.sv-pick{background:linear-gradient(#46545a,#1c2529);box-shadow:inset 0 0 0 2px #fff6e0,0 0 0 1px #0b1013}
#inventory .sv-recipe.sv-locked .sv-rart>*{filter:grayscale(.85) brightness(.7);opacity:.75}
#inventory .sv-recipe.sv-locked .sv-rname{color:#a9b0b2}
#inventory .sv-recipe.sv-gated .sv-rart>*{filter:grayscale(1) brightness(.55)} /* [progression-hook] research-locked */
#inventory .sv-recipe:focus-visible{outline:2px solid #fff6e0;outline-offset:1px}
#inventory .sv-rart{display:grid;place-items:center;width:42px;height:42px;border-radius:3px;background:radial-gradient(circle at 50% 40%,#20282c,#0d1215 75%);box-shadow:inset 0 0 0 1px #ffffff55}
#inventory .sv-rart .sv-icon{width:36px;height:36px}
#inventory .sv-rbody{display:block;min-width:0}
#inventory .sv-rname{display:block;font:700 14px/1.2 ${FONT};color:#f8f3e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#inventory .sv-rsub{display:block;margin-top:2px;font:600 12px/1.2 ${FONT};color:#c9cfd0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#inventory .sv-ready .sv-rsub{color:#a9e48a}
#inventory .sv-full .sv-rsub{color:#ffcf9a}
#inventory .sv-locked .sv-rsub{color:#ff9a85}
#inventory .sv-rbadge{font:800 12px/1 ${FONT};color:#a9e48a;font-variant-numeric:tabular-nums}
#inventory .sv-detail{flex:none;display:flex;flex-direction:column;gap:7px;padding:9px;border-radius:4px;background:#0b1013d9;box-shadow:inset 0 0 0 1px #ffffff44}
#inventory .sv-detail[hidden]{display:none}
#inventory .sv-dhead{display:grid;grid-template-columns:60px 1fr;gap:10px;align-items:center}
#inventory .sv-dart{display:grid;place-items:center;width:60px;height:60px;border-radius:4px;background:radial-gradient(circle at 50% 40%,#262f33,#0d1215 75%);box-shadow:inset 0 0 0 1px #ffffff77}
#inventory .sv-dart .sv-icon{width:54px;height:54px}
#inventory .sv-dname{display:block;font:700 16px/1.2 ${FONT};color:#f8f3e6}
#inventory .sv-ddesc{display:block;margin-top:2px;font:500 12px/1.3 ${FONT};color:#c9cfd0}
#inventory .sv-dlabel{font:700 10px/1 ${FONT};letter-spacing:1.5px;text-transform:uppercase;color:#9aa3a6}
#inventory .sv-ings{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}
#inventory .sv-ing{display:grid;grid-template-columns:24px 1fr auto;gap:8px;align-items:center;padding:3px 8px 3px 4px;border-radius:3px;background:#141b1e;box-shadow:inset 3px 0 0 #e06a4a}
#inventory .sv-ing.sv-ok{box-shadow:inset 3px 0 0 #8fd36a}
#inventory .sv-ing .sv-icon{width:24px;height:24px}
#inventory .sv-iname{font:600 13px/1.2 ${FONT};color:#e9e3d3}
#inventory .sv-iamt{font:800 13px/1 ${FONT};font-variant-numeric:tabular-nums;color:#ff8a73}
#inventory .sv-ok .sv-iamt{color:#9ee07a}
#inventory .sv-craftbtn{position:relative;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:42px;margin:0;padding:0 12px;overflow:hidden;border:0;border-radius:4px;
  background:linear-gradient(#5c8a3a,#3f6a26);box-shadow:inset 0 0 0 1px #c8f0a0aa,0 2px 0 #1f3612;color:#f4ffe6;font:800 15px/1 ${FONT};letter-spacing:.5px;text-transform:none;cursor:pointer;transform:none;
  user-select:none;-webkit-user-select:none;touch-action:none}
#inventory .sv-craftbtn:hover{background:linear-gradient(#6c9c46,#4a7a2e)}
#inventory .sv-craftbtn:focus-visible{outline:2px solid #fff6e0;outline-offset:2px}
#inventory .sv-craftbtn[aria-disabled="true"]{background:linear-gradient(#2a3236,#1e2629);box-shadow:inset 0 0 0 1px #ffffff44;color:#8d9598;cursor:not-allowed}
#inventory .sv-craftbtn.sv-deny{box-shadow:inset 0 0 0 2px #e06a4a,0 0 6px #e06a4a88}
#inventory .sv-fill{position:absolute;inset:0;transform-origin:left center;transform:scaleX(var(--fill,0));background:linear-gradient(90deg,#d8f7a066,#f4ffd0aa);pointer-events:none}
#inventory .sv-craftbtn:not(.sv-holding) .sv-fill{transition:transform .25s ease-out}
#inventory .sv-clabel,#inventory .sv-chint,#inventory .sv-ccount{position:relative;pointer-events:none}
#inventory .sv-chint{font:600 11px/1 ${FONT};letter-spacing:0;color:#e6f7d4;opacity:.9}
#inventory .sv-chint:empty{display:none}
#inventory .sv-ccount{min-width:26px;padding:3px 5px;border-radius:9px;background:#14270bcc;color:#c8f7a0;font:800 12px/1 ${FONT};font-variant-numeric:tabular-nums}
#inventory .sv-ccount:empty{display:none}
#inventory .sv-empty-list{margin:6px;color:#c9cfd0;font-size:14px}
#inventory .sv-tip{position:fixed;left:0;top:0;z-index:10;pointer-events:none;box-sizing:border-box;width:max-content;max-width:250px;padding:7px 10px;border-radius:4px;white-space:normal;
  background:#0b1013f5;border:1px solid #ffffff40;color:#f8f3e6;font:700 14px/1.3 ${FONT};box-shadow:0 4px 12px #0008}
#inventory .sv-tip[hidden]{display:none}
#inventory .sv-tip small{display:block;margin-top:2px;font:500 12px/1.35 ${FONT};color:#c9cfd0}
#inventory .sv-tip small em{font-style:normal;font-weight:700;color:#ffcf9a}
@media(max-width:860px),(max-height:520px){#inventory.sv-inv{width:auto}#inventory .sv-wrap{flex-direction:column;max-height:94vh;overflow:auto;box-sizing:border-box}#inventory .sv-craft{flex:none;width:auto;min-width:0;max-height:none;overflow:visible}#inventory .sv-rlist{max-height:30vh}#inventory .sv-bag{min-width:0}
  #inventory.sv-inv{--s:44px;--g:5px}#inventory .sv-slot .sv-art{inset:3px}}
@media(max-width:440px){#inventory.sv-inv{--s:36px;--g:4px}#inventory .sv-slot .sv-art{inset:3px}#inventory .sv-slot .sv-count{font-size:12px}}
@media(prefers-reduced-motion:reduce){.sv-slot,.sv-art,.sv-cursor,.sv-label,#inventory .sv-recipe,#inventory .sv-craftbtn .sv-fill{transition:none!important;animation:none!important}}
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
    for (let i = 0; i < HB; i++) hot += `<button type="button" class="sv-slot sv-hot" data-index="${i}">${slotInner(i + 1)}</button>`;
    d.innerHTML = `<div class="sv-wrap" tabindex="-1">
      <section class="sv-craft" aria-label="Crafting">
        <h3 class="sv-h">Crafting</h3>
        <div class="sv-tabs" role="tablist" aria-label="Recipe categories"></div>
        <div class="sv-rlist" role="tabpanel"></div>
        <div class="sv-detail" hidden>
          <div class="sv-dhead"><span class="sv-dart" aria-hidden="true"></span><span><b class="sv-dname"></b><small class="sv-ddesc"></small></span></div>
          <span class="sv-dlabel">Requires</span>
          <ul class="sv-ings"></ul>
          <button type="button" class="sv-craftbtn"><i class="sv-fill"></i><span class="sv-clabel">Craft</span><small class="sv-chint"></small><b class="sv-ccount" aria-hidden="true"></b></button>
        </div>
      </section>
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
// iconFor (optional): (kind) -> data URL; overrides the rendered icon for that kind.
export function createSurvivalUI({ getBag, onSelect, onMove, onCraft, onResume, onPause, iconFor, recipeGate, getModel } = {}) {
  if (typeof getModel === 'function') setModelProvider(getModel);
  const gate = id => { try { return recipeGate?.(id) || null; } catch { return null; } }; // [progression-hook] {hidden, locked, reason}
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
  const tabsEl = dlg.querySelector('.sv-tabs');
  const detail = dlg.querySelector('.sv-detail');
  const D = {
    art: detail.querySelector('.sv-dart'), name: detail.querySelector('.sv-dname'), desc: detail.querySelector('.sv-ddesc'),
    ings: detail.querySelector('.sv-ings'), btn: detail.querySelector('.sv-craftbtn'), label: detail.querySelector('.sv-clabel'),
    hint: detail.querySelector('.sv-chint'), count: detail.querySelector('.sv-ccount'),
  };
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
  // Per-frame fast path: skip snapshot + string signatures when nothing visible changed.
  // Bag.version catches method mutations; the typed-array shadow catches direct .slots writes
  // (game.js edits counts/durability in place), so the HUD never goes stale.
  let fastBag = null, fastVer = NaN, fastSel = -2, fastMode = -1, fastTools = null;
  const shKind = new Int32Array(TOTAL), shCount = new Float64Array(TOTAL), shDur = new Float64Array(TOTAL);
  const kindIds = new Map();
  const kindId = k => { let id = kindIds.get(k); if (id === undefined) { id = kindIds.size + 1; kindIds.set(k, id); } return id; };
  const invalidate = () => { lastSig = null; fastBag = null; };
  function shadowSame(slots, write) {
    if (!Array.isArray(slots) || slots.length !== TOTAL) return false;
    let same = true;
    for (let i = 0; i < TOTAL; i++) {
      const s = slots[i];
      const k = s ? kindId(s.kind) : 0, c = s ? +s.count : 0, d = s && s.durability != null ? +s.durability : -1;
      if (shKind[i] !== k || shCount[i] !== c || shDur[i] !== d) {
        if (!write) return false;
        same = false; shKind[i] = k; shCount[i] = c; shDur[i] = d;
      }
    }
    return same;
  }
  let curSlots = [];
  let curSelected = -1;
  let tools = null, hotEls = [];
  let recipes = [], recipeEls = [], groups = [];
  let activeTab = dlg.dataset.svTab || null, pickId = dlg.dataset.svPick || null, shownPick = null, ingEls = [];
  let hold = null, btnDenyTimer = 0, countTimer = 0;
  let tipAnchor = null;

  const safe = (fn, ...a) => { try { return fn?.(...a); } catch (e) { console.error(e); } };
  const bagNow = () => { try { return getBag?.() || null; } catch (e) { console.error(e); return null; } };

  // ---------- recipes ----------
  // Host icon override, else the rendered 3D icon (item-icons.js), else the SVG sprite.
  function art(kind) {
    let url = null;
    try { url = iconFor?.(kind); } catch (e) { url = null; }
    if (typeof url === 'string' && /^data:image\//.test(url)) return `<img class="sv-icon sv-3d" src="${esc(url)}" alt="" draggable="false">`;
    return iconHTML(kind);
  }
  const viewOf = id => recipeEls.find(v => v.r.id === id) || null;
  function buildRecipes() {
    recipes = recipeList().filter(r => !gate(r.id)?.hidden); // [progression-hook]
    groups = groupRecipes(recipes, ITEM_INFO);
    const catOf = new Map();
    for (const g of groups) for (const r of g.recipes) catOf.set(r.id, g.id);
    if (!groups.some(g => g.id === activeTab)) activeTab = groups[0]?.id ?? null;
    if (!recipes.some(r => r.id === pickId)) pickId = null;
    const key = recipes.map(r => r.id).join(',') + '|' + (iconFor ? 3 : 2);
    if (dlg.dataset.svRecipes !== key || rlist.childElementCount !== recipes.length || !recipes.length) {
      tabsEl.style.setProperty('--tabs', String(Math.max(1, groups.length)));
      tabsEl.innerHTML = groups.map(g => `<button type="button" class="sv-tab" role="tab" data-cat="${esc(g.id)}" aria-selected="false" tabindex="-1">${iconSVG(g.icon)}<span>${esc(g.name)}</span><i class="sv-tbadge"></i></button>`).join('');
      // Rows in tab order so the list reads naturally inside each category.
      const ordered = groups.flatMap(g => g.recipes);
      rlist.innerHTML = ordered.length ? ordered.map(r => `<button type="button" class="sv-recipe sv-locked" data-recipe="${esc(r.id)}" data-cat="${esc(catOf.get(r.id))}" data-tip-kind="${esc(r.out.kind)}">
        <span class="sv-rart" aria-hidden="true">${art(r.out.kind)}</span>
        <span class="sv-rbody"><span class="sv-rname">${esc(r.name)}${r.out.count > 1 ? ' ×' + r.out.count : ''}</span><span class="sv-rsub"></span></span>
        <span class="sv-rbadge" aria-hidden="true"></span></button>`).join('') : '<p class="sv-empty-list">No recipes known.</p>';
      dlg.dataset.svRecipes = key;
      shownPick = null;
    }
    const byId = new Map(recipes.map(r => [r.id, r]));
    recipeEls = [...rlist.querySelectorAll('.sv-recipe')].map(el => ({
      el, r: byId.get(el.dataset.recipe), cat: el.dataset.cat, sub: el.querySelector('.sv-rsub'), badge: el.querySelector('.sv-rbadge'),
      sig: null, rows: [], state: 'missing', times: 0,
    })).filter(v => v.r);
    applyTab();
  }
  function applyTab() {
    tabsEl.querySelectorAll('.sv-tab').forEach(t => {
      const on = t.dataset.cat === activeTab;
      t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
    });
    for (const v of recipeEls) v.el.hidden = v.cat !== activeTab;
    const inTab = recipeEls.filter(v => v.cat === activeTab);
    if (!inTab.some(v => v.r.id === pickId)) pickId = (inTab.find(v => v.state === 'ready') || inTab[0])?.r.id ?? null;
    if (activeTab) dlg.dataset.svTab = activeTab;
    const tabEl = tabsEl.querySelector(`.sv-tab[data-cat="${activeTab}"]`);
    if (tabEl) rlist.setAttribute('aria-label', tabEl.textContent.trim() + ' recipes');
    applyPick();
  }
  function setTab(id, focus = false) {
    if (!groups.some(g => g.id === id)) return;
    if (id !== activeTab) { stopHold(); activeTab = id; pickId = null; applyTab(); }
    if (focus) tabsEl.querySelector(`.sv-tab[data-cat="${id}"]`)?.focus();
  }
  function setPick(id) {
    if (id === pickId) return;
    stopHold(); pickId = id; applyPick();
  }
  function applyPick() {
    for (const v of recipeEls) { const on = v.r.id === pickId; v.el.classList.toggle('sv-pick', on); v.el.setAttribute('aria-current', String(on)); }
    if (pickId) dlg.dataset.svPick = pickId;
    const v = viewOf(pickId);
    detail.hidden = !v;
    if (!v) { shownPick = null; return; }
    if (shownPick !== pickId) {
      shownPick = pickId;
      const t = ITEM_TEXT[v.r.out.kind];
      D.art.innerHTML = art(v.r.out.kind);
      D.art.dataset.tipKind = v.r.out.kind;
      D.name.textContent = v.r.name + (v.r.out.count > 1 ? ' ×' + v.r.out.count : '');
      D.desc.textContent = t?.use || t?.desc || '';
      D.ings.innerHTML = v.r.reqs.map(q => `<li class="sv-ing" data-tip-kind="${esc(q.kind)}">${art(q.kind)}<span class="sv-iname">${esc(itemName(q.kind))}</span><b class="sv-iamt"></b></li>`).join('') || '<li class="sv-ing sv-ok"><span></span><span class="sv-iname">Nothing</span><b class="sv-iamt"></b></li>';
      ingEls = [...D.ings.querySelectorAll('.sv-ing')].map(el => ({ el, amt: el.querySelector('.sv-iamt') }));
      D.count.textContent = '';
    }
    paintDetail();
  }
  function paintDetail() {
    const v = viewOf(pickId); if (!v || detail.hidden) return;
    v.rows.forEach((row, k) => {
      const e = ingEls[k]; if (!e) return;
      e.amt.textContent = amountLabel(row);
      e.el.classList.toggle('sv-ok', row.enough);
      e.el.setAttribute('aria-label', `${itemName(row.kind)}: have ${row.have}, need ${row.need}`);
    });
    const ready = v.state === 'ready';
    D.btn.setAttribute('aria-disabled', String(!ready));
    if (!hold) {
      D.label.textContent = ready ? 'Craft' : v.state === 'gated' ? 'Locked' : v.state === 'full' ? 'Bag is full' : 'Missing materials'; // [progression-hook]
      D.hint.textContent = ready && v.times > 1 ? 'hold for more' : '';
    }
    D.btn.setAttribute('aria-label', ready ? `Craft ${v.r.name}. Hold to craft several.` : `${v.r.name}: ${D.label.textContent}`);
  }
  function countOf(bag, kind) {
    if (typeof bag.count === 'function') { try { return Number(bag.count(kind)) || 0; } catch {} }
    let n = 0; for (const s of curSlots) if (s && s.kind === kind) n += s.count || 0; return n;
  }
  function evaluate(bag, r) {
    const rows = ingredientRows(r.reqs, k => countOf(bag, k));
    let check = null;
    if (typeof bag.canCraft === 'function') { try { check = bag.canCraft(r.id); } catch (e) { console.error(e); } }
    const g = gate(r.id); // [progression-hook] research/station lock wins over materials
    if (g?.locked) return { rows, state: 'gated', reason: g.reason || '', times: 0 };
    return { rows, state: recipeState(rows, check), reason: '', times: craftableTimes(rows) };
  }
  function paintRecipes(bag) {
    const readyPer = new Map();
    for (const v of recipeEls) {
      const r = v.r;
      const { rows, state, times, reason } = evaluate(bag, r);
      v.rows = rows; v.state = state; v.times = times; v.reason = reason; // [progression-hook] reason
      if (state === 'ready') readyPer.set(v.cat, (readyPer.get(v.cat) || 0) + 1);
      const sig = state + (v.reason || '') + rows.map(x => x.have).join(','); // [progression-hook] reason
      if (v.sig === sig) continue;
      v.sig = sig;
      v.el.classList.toggle('sv-ready', state === 'ready');
      v.el.classList.toggle('sv-full', state === 'full');
      v.el.classList.toggle('sv-locked', state === 'missing' || state === 'gated');
      v.el.classList.toggle('sv-gated', state === 'gated'); // [progression-hook]
      const lacking = rows.filter(x => !x.enough);
      v.sub.textContent = state === 'gated' ? 'Locked: ' + (v.reason || 'not learned yet') // [progression-hook]
        : state === 'ready' ? 'Ready to craft'
        : state === 'full' ? 'No room in your bag'
        : 'Need ' + lacking.map(x => `${x.short} ${itemName(x.kind)}`).join(', ');
      v.badge.textContent = state === 'ready' && Number.isFinite(times) && times > 0 ? '×' + Math.min(times, 99) : '';
      v.el.setAttribute('aria-label', `${r.name}${r.out.count > 1 ? ', makes ' + r.out.count : ''}. Needs ${rows.map(x => `${x.need} ${itemName(x.kind)}, have ${x.have}`).join('; ') || 'nothing'}. ${v.sub.textContent}.`);
      if (tipAnchor === v.el) showTipFor(v.el);
    }
    tabsEl.querySelectorAll('.sv-tab').forEach(t => {
      const n = readyPer.get(t.dataset.cat) || 0, b = t.querySelector('.sv-tbadge');
      if (b && b.textContent !== (n ? String(n) : '')) b.textContent = n ? String(n) : '';
      t.setAttribute('aria-label', `${t.querySelector('span')?.textContent || ''}${n ? `, ${n} ready` : ''}`);
    });
    paintDetail();
  }

  // ---------- hold to craft ----------
  // Press: craft one now. Keep holding: the fill bar sweeps and crafts again each time it fills,
  // faster and faster (holdDelay), until materials or space run out.
  function freshView(id) {
    const v = viewOf(id), bag = bagNow();
    if (!v || !bag) return null;
    Object.assign(v, evaluate(bag, v.r));
    return v;
  }
  function denyBtn() {
    clearTimeout(btnDenyTimer);
    D.btn.classList.add('sv-deny');
    btnDenyTimer = setTimeout(() => D.btn.classList.remove('sv-deny'), 280);
  }
  function craftNow(id) {
    const v = freshView(id);
    if (!v || v.state !== 'ready') return false;
    let r;
    try { r = onCraft?.(id); } catch (e) { console.error(e); r = false; }
    lastSig = null;
    if (r === false) return false;
    render(false);
    return true;
  }
  function setFill(p) { D.btn.style.setProperty('--fill', p.toFixed(3)); }
  function showCount(n) {
    clearTimeout(countTimer);
    D.count.textContent = n > 0 ? '+' + n : '';
  }
  function startHold() {
    if (!pickId) return;
    stopHold();
    const v = freshView(pickId);
    if (!v || v.state !== 'ready') { denyBtn(); paintDetail(); return; }
    // Cap at what the materials on hand cover, so a lagging (networked) bag cannot overshoot.
    const cap = Math.max(1, Math.min(HOLD.max, Number.isFinite(v.times) ? v.times : HOLD.max));
    if (!craftNow(pickId)) { denyBtn(); return; }
    hold = { id: pickId, done: 1, cap, t0: performance.now(), wait: holdDelay(1), raf: 0 };
    D.btn.classList.add('sv-holding');
    showCount(1);
    if (hold.done >= hold.cap) { stopHold(); return; }
    hold.raf = requestAnimationFrame(tick);
  }
  function tick(now) {
    if (!hold || !alive) return;
    const p = clamp01((now - hold.t0) / hold.wait);
    setFill(p);
    if (p >= 1) {
      if (!craftNow(hold.id)) { stopHold(); return; }
      hold.done++; hold.t0 = now; hold.wait = holdDelay(hold.done);
      showCount(hold.done);
      if (hold.done >= hold.cap) { stopHold(); return; }
    }
    hold.raf = requestAnimationFrame(tick);
  }
  function stopHold() {
    if (!hold) return;
    cancelAnimationFrame(hold.raf);
    hold = null;
    D.btn.classList.remove('sv-holding');
    setFill(0);
    clearTimeout(countTimer);
    countTimer = setTimeout(() => { D.count.textContent = ''; }, 1100);
    paintDetail();
  }

  // ---------- hotbar in .tools ----------
  // Hotbar = HB slot buttons + a selection frame that slides between them + a name tag above it.
  let cursor = null, label = null, labelTimer = 0, labelSel = -2, labelKind = null;
  function ensureTools() {
    if (tools && tools.isConnected && tools.dataset.sv === VERSION && hotEls.length === HB && cursor?.parentNode === tools) return tools;
    const t = document.querySelector('.tools');
    if (!t) { tools = null; hotEls = []; return null; }
    invalidate();
    if (t.dataset.sv !== VERSION || t.querySelectorAll(':scope>.sv-slot').length !== HB || !t.querySelector(':scope>.sv-cursor')) {
      let html = '';
      for (let i = 0; i < HB; i++) html += `<button type="button" class="sv-slot" data-slot="${i}">${slotInner(i + 1)}</button>`;
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
    if (!cursor || !label) return;
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
    invalidate();
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
  // Always anchored beside the hovered element (never follows the pointer, never centred).
  function tipHTML(kind, extra = '') {
    const t = ITEM_TEXT[kind];
    const uses = usedIn(kind, recipes);
    return `<b>${esc(itemName(kind))}</b>${extra ? `<small>${esc(extra)}</small>` : ''}`
      + (t?.desc ? `<small>${esc(t.desc)}</small>` : '')
      + (t?.use ? `<small><em>Used for:</em> ${esc(t.use)}</small>` : '')
      + (uses.length ? `<small><em>Ingredient in:</em> ${esc(uses.join(', '))}</small>` : '');
  }
  function placeTipAt(el) {
    if (tip.hidden || !el) return;
    const p = anchorTip(el.getBoundingClientRect(), tip.offsetWidth, tip.offsetHeight, innerWidth, innerHeight);
    tip.style.transform = `translate(${Math.round(p.x)}px,${Math.round(p.y)}px)`;
    tip.dataset.side = p.side;
  }
  function showTipFor(el) {
    if (!el || dragging) { hideTip(); return; }
    const kind = el.dataset.tipKind;
    if (!kind) { hideTip(); return; }
    let extra = '';
    const v = el.classList.contains('sv-recipe') ? viewOf(el.dataset.recipe) : null;
    if (v) extra = v.r.reqs.length ? 'Needs ' + v.r.reqs.map(q => `${q.count} ${itemName(q.kind)}`).join(', ') : '';
    tipAnchor = el;
    tip.innerHTML = tipHTML(kind, extra);
    tip.hidden = false;
    placeTipAt(el);
  }
  function showTip(i) {
    const s = curSlots[i], el = invEls[i];
    if (!s || !slotSig(s) || dragging || !el) { hideTip(); return; }
    const f = durFrac(s), max = stackMax(s.kind);
    const sub = f != null ? `Durability ${Math.round(f * 100)}%` : s.count > 1 || max > 1 ? (max ? `${s.count} / ${max}` : String(s.count)) : '';
    tipAnchor = el;
    tip.innerHTML = tipHTML(s.kind, sub);
    tip.hidden = false;
    placeTipAt(el);
  }
  function hideTip() { if (tip) tip.hidden = true; tipAnchor = null; }

  // ---------- render ----------
  function render(force) {
    if (!alive) return;
    const bag = bagNow();
    ensureTools();
    if (!bag) return;
    const mode = (isOpen ? 1 : 0) | (dragging ? 2 : 0);
    const ver = bag.version, sel0 = bag.selectedIndex;
    if (!force && bag === fastBag && typeof ver === 'number' && ver === fastVer && sel0 === fastSel
      && mode === fastMode && tools === fastTools && shadowSame(bag.slots, false)) return;
    const snap = readSnap(bag);
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
    fastBag = bag; fastVer = ver; fastSel = sel0; fastMode = mode; fastTools = tools;
    shadowSame(bag.slots, true);
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
    invalidate();
    invEls.forEach(el => { el._svCount = undefined; }); // no pop for changes made while closed
    recipeEls.forEach(v => { v.sig = null; });
    render(true);
    applyTab();
    try { wrap.focus({ preventScroll: true }); } catch {}
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    stopHold();
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
    if (refresh) invalidate();
  }
  const slotFrom = e => e.target?.closest?.('#inventory .sv-slot[data-index]') || null;

  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); }, opt);
  dlg.addEventListener('close', () => {
    if (!isOpen) return;
    isOpen = false; stopHold(); endDrag(false); clearSrc(); clearDeny(); hideTip(); hoverIdx = null;
    safe(onResume);
  }, opt);
  dlg.addEventListener('click', e => {
    if (e.target === dlg) { close(); return; } // backdrop
    const tb = e.target.closest?.('.sv-tab');
    if (tb) { setTab(tb.dataset.cat); return; }
    const rb = e.target.closest?.('.sv-recipe');
    if (rb) { setPick(rb.dataset.recipe); return; }
    if (e.target.closest?.('.sv-craftbtn')) {
      // Pointer presses are handled on pointerdown; detail 0 = keyboard / assistive activation.
      if (e.detail === 0 && !hold) { startHold(); stopHold(); }
      return;
    }
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
  dlg.addEventListener('pointermove', e => { px = e.clientX; py = e.clientY; if (src != null) placeHeld(); }, opt); // picked stack follows the pointer
  dlg.addEventListener('pointerover', e => {
    const el = slotFrom(e);
    if (el) {
      const i = +el.dataset.index;
      if (i !== hoverIdx) { hoverIdx = i; showTip(i); }
      return;
    }
    hoverIdx = null;
    const k = e.target?.closest?.('#inventory [data-tip-kind]');
    if (k) { if (k !== tipAnchor) showTipFor(k); return; }
    if (tipAnchor) hideTip();
  }, opt);
  dlg.addEventListener('pointerleave', () => { hoverIdx = null; hideTip(); }, opt);
  rlist.addEventListener('scroll', () => { if (tipAnchor && rlist.contains(tipAnchor)) placeTipAt(tipAnchor); }, { ...opt, passive: true });
  // Hold-to-craft on the craft button (mouse, touch, pen; Enter / Space).
  D.btn.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.isPrimary) return;
    e.preventDefault();
    try { D.btn.setPointerCapture(e.pointerId); } catch {}
    try { D.btn.focus({ preventScroll: true }); } catch {}
    startHold();
  }, opt);
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) D.btn.addEventListener(ev, stopHold, opt);
  D.btn.addEventListener('keydown', e => {
    if (e.code !== 'Enter' && e.code !== 'Space' && e.code !== 'NumpadEnter') return;
    e.preventDefault();
    if (!e.repeat && !hold) startHold();
  }, opt);
  D.btn.addEventListener('keyup', e => { if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') stopHold(); }, opt);
  D.btn.addEventListener('blur', stopHold, opt);
  // Arrow keys move between tabs (roving tabindex).
  tabsEl.addEventListener('keydown', e => {
    const t = e.target.closest?.('.sv-tab'); if (!t) return;
    const ids = groups.map(g => g.id), i = ids.indexOf(t.dataset.cat);
    let n = -1;
    if (e.code === 'ArrowRight') n = (i + 1) % ids.length;
    else if (e.code === 'ArrowLeft') n = (i - 1 + ids.length) % ids.length;
    else if (e.code === 'Home') n = 0; else if (e.code === 'End') n = ids.length - 1;
    if (n < 0) return;
    e.preventDefault(); setTab(ids[n], true);
  }, opt);
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

  // Tab / I toggle while playing.
  document.addEventListener('keydown', e => {
    if (!alive || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.code !== 'Tab' && e.code !== 'KeyI') return;
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
      stopHold();
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
export { iconSVG, slotSig, paintSlot, itemName }; // content hook (storage-research)
