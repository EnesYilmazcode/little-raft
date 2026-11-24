// Little Raft survival UI: shared-play hotbar (.tools) + inventory/crafting dialog (#inventory).
// Pure view layer. It never mutates the Bag; all changes go through the callbacks.
import { exitLock } from './lock-rules.js?build=v3-survival-ae77fa84ac2b';
import { RECIPES, ITEM_INFO, HOTBAR_SIZE, STACK_SIZE, SLOT_COUNT, TOOL_DURABILITY } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { CATEGORIES, ITEM_TEXT, groupRecipes, ingredientRows, craftableTimes, fittingTimes, recipeState, usedIn, haveNeedLine, stackLabel, holdDelay, sortCraftableFirst, sourceOf, trackerView, loadPin, savePin, HOLD, anchorTip, reqChips, reqAmount, setItemGlyph, craftButtonView, anchorVisible, backdropCloses, bagKeyAction, arrowNeighbor, placeRefusal } from './craft-book.js?build=v3-survival-ae77fa84ac2b';
import { ITEM_ICONS } from './item-svg.js?build=v3-survival-ae77fa84ac2b'; // [progression-hook]
import { iconURL, warmIcons, onIconReady, setModelProvider } from './item-icons.js?build=v3-survival-ae77fa84ac2b';
import { GEAR_IDS } from './diving-gear-core.js?build=v3-survival-ae77fa84ac2b'; // the wearables: they work while carried, one of each kind

const VERSION = 'sv7';
const HB = Number(HOTBAR_SIZE) || 8;
const TOTAL = Number(SLOT_COUNT) || 28;
const DUR_MAX = Number(TOOL_DURABILITY) > 0 ? Number(TOOL_DURABILITY) : 0;
const TRANSIENT = ['sv-src', 'sv-over', 'sv-dragging', 'sv-deny'];
const EQUIP = 5; // Raft's 5 generic equipment slots
const INST_KEY = '__littleRaftSurvivalUI';
/** Fired on document whenever the local bag's contents or selection change (item-tooltips.js listens). */
export const BAG_EVENT = 'littleraft:bagchange';

// Same sprite URL as the page's own <use> elements (plain on first load, re-pointed by game.js after a hot swap),
// so icons.svg is fetched once. Read lazily: game.js init() runs after this module is evaluated.
let spriteUrl = null;
const SPRITE_URL = () => spriteUrl ??= (document.querySelector('use[href*="icons.svg"]')?.getAttribute('href') || 'icons.svg').split('#')[0];

// Symbols that actually exist in icons.svg.
const SPRITES = new Set(['hook', 'floor', 'fish', 'wood', 'leaf', 'scrap', 'barrel', 'sail', 'palm', 'lantern', 'net', 'crew', 'help', 'sound', 'close', 'repair', 'hammer', 'compass', 'antenna', 'cup', 'saltcup', 'freshcup', 'purifier', 'rainbarrel', 'sprinkler', 'research', 'receiver',
  'brush', 'paint-seafoam', 'paint-coral', 'paint-sunshell', 'paint-lagoon', 'paint-pebble', 'bed', 'motor', 'wheel', 'kiln', 'ingot', 'glass', 'brick', 'egg', 'feather', 'nest', 'cushion', 'fins', 'airjug', 'goggles', 'scraper', 'cookpot', 'bowl', 'meal', 'shell', 'wreath', 'float', 'gametable', 'buoyflag', 'scoreboard', 'driftboard',
  'hay', 'pail', 'milk', 'stormrod', 'stormshard', 'stormlamp', 'stormglass']); // + rain-sprinkler, research (storage-research); content hook (paint); kiln, animals; goats, storm
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
  antenna: 'antenna', receiver: 'receiver',
  puffegg: 'egg', feather: 'feather', nestbox: 'nest', cushion: 'cushion',
  shell: 'shell', shellwreath: 'wreath', glassfloat: 'float', // trader.js
  goatpen: 'hay', bucket: 'pail', milk: 'milk',
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
// 3D icons need a second WebGL context, so none are requested on the title screen (see liveIcons).
let iconsLive = false;
// Thin, pale 3D renders that read poorly at chip and tile size: these always use the flat drawing.
const FLAT_ICON = new Set(['rope', 'wood']);
const flatIcon = kind => FLAT_ICON.has(norm(kind));
function iconHTML(kind) {
  const url = iconsLive && !FLAT_ICON.has(norm(kind)) ? iconURL(kind) : null;
  if (url) return `<img class="sv-icon sv-3d" data-icon="${esc(kind)}" src="${url}" alt="" draggable="false">`;
  return iconSVG(kind).replace('<svg ', `<svg data-icon="${esc(kind)}" `);
}
function iconSVG(kind) {
  const n = norm(kind);
  const meta = info(kind);
  // Placeholder (borrowed) sprite + a dedicated inline drawing -> prefer the drawing.
  const custom = meta?.placeholder && CUSTOM[n];
  // A borrowed sprite would show the wrong item (water as a barrel), so wait on a blank tile instead.
  // Neutral tile (rounded box + initials) so the slot never looks empty while the 3D icon renders.
  if (meta?.placeholder && !custom) return `<svg class="sv-icon sv-blank" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><rect x="9" y="9" width="30" height="30" rx="6" fill="#3e2a1714" stroke="#3e2a1766" stroke-width="1.5"/><text x="24" y="29" text-anchor="middle" font-family="Segoe UI,system-ui,sans-serif" font-size="13" font-weight="700" fill="#3e2a17b0">${esc(itemName(kind).replace(/\s+/g, '').slice(0, 2))}</text></svg>`;
  let id = custom ? null : meta?.icon;
  if (typeof id === 'string') id = id.replace(/^icon-/, ''); else id = null;
  if (!custom && (!id || !SPRITES.has(id))) id = SPRITE_FOR[n];
  if (!custom && id && SPRITES.has(id)) return `<svg class="sv-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><use href="${SPRITE_URL()}#icon-${id}"></use></svg>`;
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

// Line icons for the panel's own controls (24x24, currentColor): the pin, the craft button and the + on a missing ingredient.
const UI_ICON = {
  pin: '<path class="sv-uifill" d="M8.5 3h7M10 3v5.2L6.5 12.5h11L14 8.2V3"/><path d="M12 12.5V21"/>',
  hammer: '<path d="M13.6 10.4L4.6 19.4"/><rect class="sv-uifill" x="11" y="5.6" width="10" height="4.8" rx="1" transform="rotate(45 16 8)"/>',
  lock: '<rect class="sv-uifill" x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const uiIcon = id => `<svg class="sv-ui" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${UI_ICON[id] || ''}</svg>`;

// Game UI is never selectable or draggable: only real text fields (chat, names, sign text) are.
// Chrome resets user-select to text in the top layer (modal dialogs, popovers), so those are listed too.
const TEXT_FIELD = 'input,textarea,[contenteditable]:not([contenteditable="false"])';
const NO_SELECT = `html,body,dialog,[popover]{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
img,svg,a{-webkit-user-drag:none}
${TEXT_FIELD}{-webkit-user-select:text;user-select:text}`;
const elOf = t => (t && t.nodeType === 1 ? t : t?.parentElement) || null;
const inTextField = t => !!elOf(t)?.closest?.(TEXT_FIELD);

// ---- styles ----
const FONT = "var(--ui-font,'Segoe UI',system-ui,sans-serif)";
const CSS = `
.tools.sv-hotbar{--s:clamp(52px,3.2vw,68px);--g:4px;--px:5px;--py:5px;position:relative;display:flex;flex-wrap:nowrap;gap:var(--g);padding:5px;border-radius:4px;max-width:96vw;overflow:visible;
  background:repeating-linear-gradient(90deg,#00000010 0 1px,transparent 1px 17px),linear-gradient(#a8844f,#9a7748 45%,#8a6a3e);
  border:2px solid #5e4426;box-shadow:inset 0 1px 0 #c9a76f88,0 3px 10px #0004}
.tools.sv-hotbar::before,.tools.sv-hotbar::after{content:none;display:none}
.tools.sv-hotbar>button.sv-slot,#inventory.sv-inv button.sv-slot{
  position:relative;display:block;flex:0 0 auto;width:var(--s);height:var(--s);min-width:0;min-height:0;margin:0;padding:0;border:0;border-radius:3px;
  background:linear-gradient(180deg,#d6c397,#c4ae80);
  box-shadow:inset 0 0 0 1px #7a5a34,inset 0 1px 3px #5e442633;
  color:#3e2a17;font:600 14px/1 ${FONT};letter-spacing:0;text-transform:none;cursor:pointer;transform:none;outline:none;
  transition:transform .18s cubic-bezier(.3,1.5,.5,1),background .15s,box-shadow .15s}
.tools.sv-hotbar>button.sv-slot::after{content:none;display:none}
.sv-slot i{font-style:normal;pointer-events:none}
.sv-slot .sv-num{position:absolute;left:4px;top:3px;z-index:1;font:700 11px/1 ${FONT};color:#3e2a17;opacity:.8}
.sv-slot .sv-art{position:absolute;inset:5px;display:block;transition:scale .2s cubic-bezier(.3,1.5,.5,1)}
.sv-icon{display:block;width:100%;height:100%;object-fit:contain;-webkit-user-drag:none;user-select:none}
.sv-slot .sv-icon{filter:drop-shadow(0 1px 0 #3e2a1799) drop-shadow(0 0 1px #3e2a1766)}
.sv-slot svg.sv-icon{scale:.78}
.sv-slot .sv-count{position:absolute;right:5px;bottom:4px;z-index:1;font:800 14px/1 ${FONT};color:#3e2a17;font-variant-numeric:tabular-nums;
  text-shadow:0 0 2px #e6d6ad,0 0 1px #e6d6ad}
.sv-slot .sv-dur{position:absolute;left:8px;right:8px;bottom:5px;z-index:1;height:3px;border-radius:2px;background:#5e442666;box-shadow:0 0 0 1px #5e442644;display:block;overflow:hidden}
.sv-slot .sv-dur[hidden]{display:none}
.sv-slot .sv-dur>i{display:block;height:100%;width:100%;background:#5f9c3a;transition:width .3s}
.sv-slot.sv-bumpA .sv-art{animation:svBumpA .34s ease-out}.sv-slot.sv-bumpB .sv-art{animation:svBumpB .34s ease-out}
@keyframes svBumpA{35%{transform:scale(1.22) rotate(-6deg)}}@keyframes svBumpB{35%{transform:scale(1.22) rotate(-6deg)}}
.tools.sv-hotbar>button.sv-slot:hover,#inventory.sv-inv button.sv-slot:hover{background:linear-gradient(180deg,#ddcca2,#cbb688);box-shadow:inset 0 0 0 1px #5e4426,inset 0 1px 3px #5e442633}
.tools.sv-hotbar>button.sv-slot.sv-sel{transform:scale(1.06);background:linear-gradient(180deg,#bea676,#b2996a);box-shadow:inset 0 0 0 2px #4a3520,inset 0 2px 4px #4a352055,0 6px 14px #0005}
.tools.sv-hotbar>button.sv-slot.sv-sel .sv-art{scale:1.1}
.tools.sv-hotbar>button.sv-slot.sv-sel .sv-num{opacity:.95}
.tools.sv-hotbar>button.sv-slot:focus-visible,#inventory.sv-inv button.sv-slot:focus-visible{outline:2px solid #3e2a17;outline-offset:1px}
.tools.sv-hotbar>.sv-cursor{position:absolute;left:var(--px);top:var(--py);z-index:2;width:var(--s);height:var(--s);border-radius:3px;pointer-events:none;
  transform:translate(calc(var(--i,0) * (var(--s) + var(--g))),0) scale(1.06);transition:transform .2s cubic-bezier(.3,1.3,.5,1),opacity .2s;
  box-shadow:inset 0 0 0 2px #4a3520,0 0 0 1px #f6e8c6aa,0 0 10px #fff3d64d}
.tools.sv-hotbar>.sv-cursor.sv-off{opacity:0}
.tools.sv-hotbar>.sv-label{position:absolute;left:calc(var(--px) + var(--s) / 2);bottom:calc(100% + 12px);z-index:2;padding:5px 11px;border-radius:5px;white-space:nowrap;pointer-events:none;
  background:#e6d6adf2;color:#3e2a17;font:700 13px/1.2 ${FONT};box-shadow:inset 0 0 0 1px #5e4426,0 4px 10px #0005;opacity:0;
  transform:translate(calc(var(--i,0) * (var(--s) + var(--g)) - 50%),5px);transition:opacity .25s,transform .22s cubic-bezier(.3,1.3,.5,1)}
.tools.sv-hotbar>.sv-label.sv-show{opacity:1;transform:translate(calc(var(--i,0) * (var(--s) + var(--g)) - 50%),0)}
@media(max-width:760px){.tools.sv-hotbar{--s:min(42px,calc((96vw - 41px) / 10));--g:3px}.tools.sv-hotbar .sv-art{inset:3px}.tools.sv-hotbar .sv-count{font-size:12px}}
body:has(#inventory.sv-inv[open]) .tools.sv-hotbar{visibility:hidden} /* the bag has its own hotbar row; the world one peeked out under the modal */
/* The dialog is the full-viewport backdrop and a size container. It is a plain block: the panels are placed
   by .sv-wrap, never by the dialog's own layout, so a card or lane appended to the dialog can not move them. */
#inventory.sv-inv{position:fixed;inset:0;padding:0;margin:0;border:0;border-radius:0;background:transparent;box-shadow:none;color:#3e2a17;container-type:size;
  width:auto;height:auto;min-width:0;max-width:none;max-height:none;overflow:hidden;font:500 14px/1.35 ${FONT}}
#inventory.sv-inv[open]{display:block}
#inventory.sv-inv::backdrop{background:rgba(12,9,5,.42);-webkit-backdrop-filter:none;backdrop-filter:none}
/* Raft layout: crafting on the left edge [category icons | recipe list | recipe detail]; the backpack to its
   right, centred on the screen when there is room, on the bottom edge with the hotbar as its last row.
   The right side of the screen stays clear. All sizes come from the dialog size (cqw), so this is pure CSS. */
#inventory .sv-wrap{--e:14px;--g:5px;--tw:50px;--lw:236px;--dw:256px;--cw:calc(var(--tw) + var(--lw) + var(--dw) + 36px);
  --s:clamp(36px,calc((100cqw - var(--cw) - 3 * var(--e) - 26px - ${HB - 1} * var(--g)) / ${HB}),56px);--bw:calc(${HB} * var(--s) + ${HB - 1} * var(--g) + 26px);
  position:absolute;left:var(--e);top:var(--e);bottom:var(--e);display:flex;align-items:stretch;outline:none;pointer-events:none}
#inventory .sv-craft,#inventory .sv-bag{pointer-events:auto;box-sizing:border-box;border-radius:6px;
  background:repeating-linear-gradient(90deg,#00000010 0 1px,transparent 1px 21px),linear-gradient(#a8844f,#9a7748 45%,#8a6a3e);
  border:2px solid #5e4426;box-shadow:inset 0 1px 0 #c9a76f88,0 10px 30px #0006}
#inventory .sv-sr,#inventory .sv-h,#inventory .sv-dlabel{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
#inventory .sv-craft{flex:none;width:var(--cw);height:min(100%,780px);display:flex;flex-direction:column;padding:8px}
#inventory .sv-cbody{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:var(--tw) var(--lw) var(--dw);grid-template-rows:minmax(0,1fr);gap:8px;align-items:start}
/* categories: a column of icon tabs on the far left; the name is the tab's tooltip and label */
#inventory .sv-tabs{align-self:stretch;display:flex;flex-direction:column;gap:4px;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:none}
#inventory .sv-tab{position:relative;flex:none;display:grid;place-items:center;width:var(--tw);height:var(--tw);min-width:0;margin:0;padding:0;border:0;border-radius:4px;
  background:linear-gradient(#b8a173,#a68e60);box-shadow:inset 0 0 0 1px #7a5a34;color:#3e2a17;font:700 12px/1 ${FONT};text-transform:none;cursor:pointer;transform:none}
#inventory .sv-tab .sv-icon{width:34px;height:34px;opacity:.78;filter:drop-shadow(0 1px 0 #3e2a1766)}
#inventory .sv-tab:hover{background:linear-gradient(#c8b285,#b39b6d);box-shadow:inset 0 0 0 1px #4a3520}
#inventory .sv-tab[aria-selected="true"]{background:linear-gradient(#ead9ae,#d6c397);box-shadow:inset 0 0 0 2px #4a3520,inset 4px 0 0 #5f9c3a}
#inventory .sv-tab[aria-selected="true"] .sv-icon{opacity:1}
#inventory .sv-tab:focus-visible{outline:2px solid #fff3d6;outline-offset:-4px}
#inventory .sv-tbadge{position:absolute;right:2px;top:2px;min-width:15px;padding:2px 3px;border-radius:8px;background:#5f9c3a;color:#f4ffe6;font:800 10px/1 ${FONT};font-style:normal;text-align:center;box-shadow:0 1px 2px #0008}
#inventory .sv-tbadge:empty{display:none}
/* recipe list: fills the column height, visible scrollbar, and a bottom fade while more rows are below */
#inventory .sv-rcol{align-self:stretch;position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;padding:5px;border-radius:4px;background:#7f6039;box-shadow:inset 0 0 0 1px #5e4426,inset 0 2px 5px #3e2a1755}
#inventory .sv-rlist{flex:1 1 auto;min-height:48px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;display:flex;flex-direction:column;gap:4px;padding-right:3px;
  scrollbar-width:thin;scrollbar-color:#e0cfa5 #5e4426}
#inventory .sv-rcol::after{content:"";position:absolute;left:5px;right:17px;bottom:5px;height:30px;border-radius:0 0 4px 4px;pointer-events:none;opacity:0;transition:opacity .15s;
  background:linear-gradient(#7f603900,#7f6039f2 80%)}
#inventory .sv-rcol.sv-more::after{opacity:1}
#inventory .sv-recipe{position:relative;display:grid;grid-template-columns:38px 1fr auto;gap:8px;align-items:center;flex:none;width:100%;height:auto;min-height:46px;margin:0;padding:4px 7px 4px 5px;
  border:0;border-radius:4px;text-align:left;background:linear-gradient(180deg,#d6c397,#c4ae80);box-shadow:inset 0 0 0 1px #7a5a34;
  color:#3e2a17;font:600 13.5px/1.25 ${FONT};letter-spacing:0;text-transform:none;cursor:pointer;transform:none;transition:background .08s,box-shadow .08s}
#inventory .sv-recipe[hidden]{display:none}
#inventory .sv-recipe::before{content:"";position:absolute;left:0;top:5px;bottom:5px;width:3px;border-radius:2px;background:transparent}
#inventory .sv-recipe.sv-ready::before{background:#5f9c3a;box-shadow:0 0 4px #5f9c3a99}
#inventory .sv-recipe.sv-ready{background:linear-gradient(180deg,#ddcca2,#cbb688)}
#inventory .sv-recipe:hover{background:linear-gradient(180deg,#e0cfa5,#cdb88a);box-shadow:inset 0 0 0 2px #4a3520}
#inventory .sv-recipe.sv-pick{background:linear-gradient(180deg,#bea676,#b2996a);box-shadow:inset 0 0 0 2px #4a3520,0 0 0 1px #3e2a17}
#inventory .sv-recipe.sv-locked .sv-rart>*{filter:grayscale(.7);opacity:.8}
#inventory .sv-recipe.sv-locked .sv-rname{color:#6b5638}
#inventory .sv-recipe.sv-gated .sv-rart>*{filter:grayscale(1) brightness(.55)} /* [progression-hook] research-locked */
#inventory .sv-recipe:focus-visible{outline:2px solid #3e2a17;outline-offset:1px}
#inventory .sv-rart{position:relative;display:grid;place-items:center;width:38px;height:38px;border-radius:3px;background:#b89f6e;box-shadow:inset 0 0 0 1px #7a5a34}
#inventory .sv-rart .sv-icon{width:33px;height:33px}
#inventory .sv-rbody{display:block;min-width:0}
#inventory .sv-rname{display:block;font:700 13.5px/1.2 ${FONT};color:#3e2a17;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#inventory .sv-rsub{display:block;margin-top:2px;font:600 12px/1.2 ${FONT};color:#4e3720;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#inventory .sv-rsub:empty{display:none}
#inventory .sv-gated .sv-rsub{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2}
#inventory .sv-ready .sv-rsub{color:#3f6a26}
#inventory .sv-full .sv-rsub{color:#8a4a12}
#inventory .sv-locked .sv-rsub{color:#a3321a}
#inventory .sv-rq{display:inline-flex;align-items:center;gap:2px;margin-right:6px;vertical-align:middle;font:800 12px/1 ${FONT};font-variant-numeric:tabular-nums;color:#a3321a}
#inventory .sv-rq .sv-icon{width:18px;height:18px}
#inventory .sv-rbadge{font:800 12px/1 ${FONT};color:#3f6a26;font-variant-numeric:tabular-nums}
/* detail: chosen by a click and kept open; big icon, name, what it is for, ingredient tiles and the Craft button.
   Its height follows the ingredients (as in Raft) and it sits in its own column, so it never covers the bag. */
#inventory .sv-detail{align-self:start;box-sizing:border-box;max-height:100%;overflow-y:auto;scrollbar-width:thin;display:flex;flex-direction:column;gap:8px;padding:10px 10px 11px;border-radius:4px;
  background:#e6d6adf7;box-shadow:inset 0 0 0 1px #5e4426,inset 0 2px 5px #3e2a1733}
#inventory .sv-detail[hidden]{display:none}
#inventory .sv-dhead{flex:none;display:grid;grid-template-columns:60px 1fr auto;gap:10px;align-items:center}
#inventory .sv-dart{display:grid;place-items:center;width:60px;height:60px;border-radius:4px;background:#b89f6e;box-shadow:inset 0 0 0 1px #7a5a34}
#inventory .sv-dart .sv-icon{width:54px;height:54px}
#inventory .sv-dtext{min-width:0}
#inventory .sv-dname{display:block;font:800 16px/1.2 ${FONT};color:#3e2a17}
#inventory .sv-ddesc{display:block;margin-top:2px;font:500 12.5px/1.3 ${FONT};color:#5e4426}
#inventory .sv-duse{flex:none;margin:0;font:500 12.5px/1.35 ${FONT};color:#4e3720}
#inventory .sv-duse em{font-style:normal;font-weight:700;color:#8a3a12}
#inventory .sv-duse[hidden]{display:none}
#inventory .sv-dstate{flex:none;margin:0;padding:5px 8px;border-radius:3px;background:#a3321a1f;box-shadow:inset 3px 0 0 #a3321a;color:#7a2410;font:700 12.5px/1.3 ${FONT}}
#inventory .sv-dstate[hidden]{display:none}
/* ingredients: one tile each, have/need under the icon (red when short); the name is the hover tooltip */
#inventory .sv-ings{flex:none;list-style:none;margin:0;padding:2px 0 0;display:flex;flex-wrap:wrap;gap:7px}
#inventory .sv-ing{position:relative;flex:none;display:flex;flex-direction:column;align-items:center;gap:3px;width:52px;padding:5px 2px 6px;border-radius:4px;
  background:#d6c397;box-shadow:inset 0 0 0 1px #7a5a34,inset 0 -3px 0 #b0391e}
#inventory .sv-ing.sv-ok{box-shadow:inset 0 0 0 1px #7a5a34,inset 0 -3px 0 #5f9c3a}
#inventory .sv-ing .sv-icon{width:34px;height:34px}
#inventory .sv-ing .sv-icon,#inventory .sv-rq .sv-icon{filter:drop-shadow(0 1px 0 #3e2a1799) drop-shadow(0 0 1px #3e2a1766)}
#inventory .sv-iamt{font:800 13px/1 ${FONT};font-variant-numeric:tabular-nums;color:#a3321a}
#inventory .sv-ok .sv-iamt{color:#3f6a26}
/* + on a missing ingredient that can be crafted right now: makes one in place, the recipe stays open */
#inventory button.sv-iplus{position:absolute;right:-6px;top:-6px;z-index:1;display:grid;place-items:center;width:24px;height:24px;min-width:0;margin:0;padding:0;border:0;border-radius:50%;
  background:linear-gradient(#6c9c46,#3f6a26);box-shadow:0 0 0 1.5px #1f3612,0 2px 4px #0007;color:#f4ffe6;cursor:pointer;opacity:0;transform:scale(.5);transition:opacity .1s,transform .12s cubic-bezier(.3,1.5,.5,1)}
#inventory button.sv-iplus[hidden]{display:none}
#inventory button.sv-iplus .sv-ui{width:15px;height:15px;stroke-width:3}
#inventory .sv-ing:hover>button.sv-iplus,#inventory button.sv-iplus:focus-visible{opacity:1;transform:none}
#inventory button.sv-iplus:hover{background:linear-gradient(#7cb050,#4a7a2e);transform:scale(1.12)}
#inventory button.sv-iplus:focus-visible{outline:2px solid #3e2a17;outline-offset:1px}
#inventory button.sv-iplus.sv-deny{background:linear-gradient(#c05a3a,#8a3a12)}
@media(hover:none){#inventory button.sv-iplus{opacity:1;transform:none}}
#inventory .sv-craftbtn{position:relative;flex:none;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:44px;margin:2px 0 0;padding:0 12px;overflow:hidden;border:0;border-radius:4px;
  background:linear-gradient(#5c8a3a,#3f6a26);box-shadow:inset 0 0 0 1px #c8f0a0aa,0 2px 0 #1f3612;color:#f4ffe6;font:800 15px/1 ${FONT};letter-spacing:.5px;text-transform:none;cursor:pointer;transform:none;
  user-select:none;-webkit-user-select:none;touch-action:none}
#inventory .sv-craftbtn:hover{background:linear-gradient(#6c9c46,#4a7a2e)}
#inventory .sv-craftbtn:focus-visible{outline:2px solid #3e2a17;outline-offset:2px}
#inventory .sv-craftbtn[aria-disabled="true"]{background:linear-gradient(#b39b6d,#a08a5e);box-shadow:inset 0 0 0 1px #7a5a34;color:#4e3720;cursor:not-allowed}
#inventory .sv-craftbtn.sv-deny{box-shadow:inset 0 0 0 2px #e06a4a,0 0 6px #e06a4a88}
#inventory .sv-fill{position:absolute;inset:0;transform-origin:left center;transform:scaleX(var(--fill,0));background:linear-gradient(90deg,#d8f7a040,#f4ffd0b0);box-shadow:inset -3px 0 0 #f4ffd0;pointer-events:none}
#inventory .sv-craftbtn:not(.sv-holding) .sv-fill{transition:transform .25s ease-out}
#inventory .sv-craftbtn.sv-done{background:linear-gradient(#5c8a3a,#3f6a26);box-shadow:inset 0 0 0 1px #c8f0a0aa,0 2px 0 #1f3612;color:#f4ffe6}
#inventory .sv-craftbtn[aria-disabled="true"] .sv-fill{transition:none;transform:scaleX(0)}
#inventory .sv-craftbtn.sv-holding .sv-clabel,#inventory .sv-craftbtn.sv-done .sv-clabel{font-variant-numeric:tabular-nums}
#inventory .sv-craftbtn.sv-done[aria-disabled="true"]{color:#c8f7a0}
#inventory .sv-clabel,#inventory .sv-chint,#inventory .sv-ccount{position:relative;pointer-events:none}
#inventory .sv-clabel .sv-ui{display:block;width:24px;height:24px}
#inventory .sv-clabel .sv-uifill{fill:currentColor}
#inventory .sv-chint{font:800 15px/1 ${FONT};letter-spacing:0;color:#e6f7d4;font-variant-numeric:tabular-nums}
#inventory .sv-chint:empty{display:none}
#inventory .sv-ccount{min-width:26px;padding:3px 5px;border-radius:9px;background:#14270bcc;color:#c8f7a0;font:800 12px/1 ${FONT};font-variant-numeric:tabular-nums}
#inventory .sv-ccount:empty{display:none}
#inventory .sv-empty-list{margin:6px;color:#f6e8c6;font-size:14px}
/* backpack: centred on the screen when there is room, else right beside the crafting column (never under it) */
#inventory .sv-side{flex:none;display:flex;flex-direction:column;justify-content:flex-end;min-height:0;min-width:0;pointer-events:none;
  margin-left:max(var(--e),calc(50cqw - var(--bw) / 2 - var(--cw) - var(--e)))}
#inventory .sv-bag{position:relative;flex:none;width:var(--bw);display:flex;flex-direction:column;align-items:center;gap:7px;padding:10px 11px 11px}
#inventory .sv-grid{display:grid;grid-template-columns:repeat(${HB},var(--s));gap:var(--g);align-self:center}
#inventory .sv-hotrow{display:grid;grid-template-columns:repeat(${HB},var(--s));gap:var(--g)}
/* 5 generic equipment slots (Raft): the diving gear you carry, worn from the bag, one of each kind */
#inventory .sv-equip{display:flex;gap:var(--g);align-self:center;margin-top:2px}
#inventory .sv-eslot{position:relative;display:block;box-sizing:border-box;width:calc(var(--s) * .82);height:calc(var(--s) * .82);border-radius:3px;
  background:#7f6039;box-shadow:inset 0 0 0 1px #5e4426,inset 0 2px 5px #3e2a1766}
#inventory .sv-eslot::before{content:"";position:absolute;inset:28%;border-radius:50%;box-shadow:inset 0 0 0 2px #5e442688;opacity:.8}
#inventory .sv-eslot.sv-worn{background:linear-gradient(180deg,#d6c397,#c4ae80);box-shadow:inset 0 0 0 1px #7a5a34,inset 0 -3px 0 #5f9c3a}
#inventory .sv-eslot.sv-worn::before{content:none}
#inventory .sv-eslot .sv-art{position:absolute;inset:4px;display:block;pointer-events:none}
#inventory .sv-eslot .sv-icon{filter:drop-shadow(0 1px 0 #3e2a1799)}
#inventory .sv-eslot svg.sv-icon{scale:.8}
#inventory .sv-slot.sv-hot{background:linear-gradient(180deg,#d0bc8e,#bea778)}
#inventory.sv-inv button.sv-slot.sv-sel{background:linear-gradient(180deg,#bea676,#b2996a);box-shadow:inset 0 0 0 2px #4a3520,inset 0 2px 4px #4a352055}
#inventory.sv-inv button.sv-slot.sv-src{background:linear-gradient(180deg,#e3c98a,#d2b26e);box-shadow:inset 0 0 0 2px #c46a1c,0 0 8px #ffbd6699;transform:translateY(-3px)}
#inventory.sv-inv button.sv-slot.sv-over{box-shadow:inset 0 0 0 2px #2f7f74,0 0 8px #9fe0d6aa;transform:scale(1.06)}
#inventory.sv-inv button.sv-slot.sv-deny{box-shadow:inset 0 0 0 2px #b0391e,0 0 6px #e06a4a88;animation:svShake .26s}
@keyframes svShake{25%{translate:-3px 0}75%{translate:3px 0}}
#inventory .sv-slot.sv-dragging{opacity:.4}
#inventory .sv-slot.sv-src:not([data-pick]) .sv-art,#inventory .sv-slot.sv-src:not([data-pick]) .sv-count{opacity:.3}
#inventory .sv-held{position:fixed;left:0;top:0;z-index:11;width:52px;height:52px;pointer-events:none;filter:drop-shadow(0 6px 6px #000a)}
#inventory .sv-held[hidden]{display:none}
#inventory .sv-held .sv-art{position:absolute;inset:0;display:block;scale:1.15}
#inventory .sv-held .sv-count{position:absolute;right:0;bottom:0;font:800 14px/1 ${FONT};color:#fff;text-shadow:1px 1px 0 #000,-1px 1px 0 #000,1px -1px 0 #000,-1px -1px 0 #000}
#inventory .sv-slot[data-pick]::after{content:attr(data-pick);position:absolute;right:-5px;top:-6px;z-index:2;min-width:16px;padding:2px 3px;border-radius:8px;
  background:#ffc66e;color:#1d1608;font:700 11px/1 ${FONT};text-align:center;box-shadow:0 1px 2px #0008}
#inventory .sv-rope{width:100%;height:4px;margin:1px 0;border-radius:2px;background:repeating-linear-gradient(115deg,#c99560 0 3px,#6b4a2b 3px 5px);opacity:.85}
/* The controls hint is for screen readers; a refusal ("Can't place that there") shows briefly above the bag. */
#inventory .sv-hint{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
#inventory .sv-hint.sv-warn{left:0;bottom:calc(100% + 8px);width:auto;height:auto;margin:0;padding:5px 10px;clip-path:none;white-space:normal;border-radius:4px;
  background:#2c1d10e8;box-shadow:inset 0 0 0 1px #c9a66b88;font:700 12.5px/1.3 ${FONT};color:#ffcf9a;pointer-events:none}
/* pickup rows (game.js docks #pickupFeed into this lane): out of flow beside the bag, so they never resize it */
#inventory.sv-inv .sv-bag>.feed-lane{position:absolute;left:calc(100% + 14px);bottom:0;width:280px;height:min(45cqh,320px);min-height:0;flex:none;align-self:auto}
@container (max-width:1499px){#inventory.sv-inv .sv-bag>.feed-lane{left:0;bottom:calc(100% + 8px);width:min(100%,300px);height:min(28cqh,180px)}}
/* survival-ui's own card is a fallback: item-tooltips.js draws the item cards while its sheet is in the page */
#inventory .sv-tip{position:fixed;left:0;top:0;z-index:10;pointer-events:none;box-sizing:border-box;width:max-content;max-width:250px;padding:7px 10px;border-radius:4px;white-space:normal;
  background:#e6d6adf7;border:1px solid #5e4426;color:#3e2a17;font:700 14px/1.3 ${FONT};box-shadow:0 4px 12px #0006}
#inventory .sv-tip[hidden]{display:none}
:root:has(style.item-tooltips-style) #inventory .sv-tip{display:none!important}
#inventory .sv-tip small{display:block;margin-top:2px;font:500 12px/1.35 ${FONT};color:#5e4426}
#inventory .sv-tip small em{font-style:normal;font-weight:700;color:#8a3a12}
/* shorter windows: a tighter crafting column; small windows and phones: one scrolling column */
@container (max-width:1229px){#inventory .sv-wrap{--e:10px;--lw:210px;--dw:236px}}
@container (max-height:700px){#inventory .sv-dart{width:52px;height:52px}#inventory .sv-dart .sv-icon{width:46px;height:46px}#inventory .sv-dhead{grid-template-columns:52px 1fr auto}
  #inventory .sv-tab{height:46px}#inventory .sv-recipe{min-height:42px}#inventory .sv-detail{gap:6px}#inventory .sv-craftbtn{height:40px}}
@container (max-width:999px) or (max-height:519px){
  #inventory .sv-wrap{--e:8px;--tw:44px;--lw:auto;--dw:auto;--cw:min(100%,640px);--s:clamp(30px,calc((100cqw - 56px - ${HB - 1} * var(--g)) / ${HB}),48px);
    inset:0;flex-direction:column;align-items:center;gap:8px;padding:8px;overflow:auto;pointer-events:auto}
  #inventory .sv-craft{height:auto;max-height:none}
  #inventory .sv-cbody{grid-template-columns:var(--tw) minmax(0,1fr);grid-template-rows:auto}
  #inventory .sv-detail{grid-column:1 / -1;max-height:none}
  #inventory .sv-rcol{height:min(40cqh,320px)}
  #inventory .sv-side{margin:0}
  #inventory .sv-slot .sv-art{inset:3px}#inventory .sv-slot .sv-count{font-size:12px}
  #inventory.sv-inv .sv-bag>.feed-lane{position:static;width:100%;height:auto;max-height:90px}}
@media(prefers-reduced-motion:reduce){.sv-slot,.sv-art,.sv-cursor,.sv-label,#inventory .sv-recipe,#inventory .sv-craftbtn .sv-fill{transition:none!important;animation:none!important}}
/* pin a recipe to the HUD edge (craft-book.js trackerView) */
#inventory button.sv-pinbtn{align-self:start;display:grid;place-items:center;width:30px;height:30px;min-width:0;margin:0;padding:0;border:0;border-radius:50%;background:#3e2a1712;box-shadow:inset 0 0 0 1px #3e2a1759;color:#3e2a17;
  opacity:.7;cursor:pointer;transform:none;transition:opacity .1s,background .1s}
#inventory button.sv-pinbtn .sv-ui{width:18px;height:18px;rotate:35deg;transition:rotate .15s}
#inventory button.sv-pinbtn[aria-pressed="true"] .sv-ui{rotate:0deg}
#inventory button.sv-pinbtn[aria-pressed="true"] .sv-uifill{fill:currentColor}
#inventory button.sv-pinbtn:hover{background:#3e2a1726;opacity:1}
#inventory button.sv-pinbtn[aria-pressed="true"]{background:#c46a1c2e;box-shadow:inset 0 0 0 1px #c46a1ca0;color:#8a4410;opacity:1}
#inventory button.sv-pinbtn:focus-visible{outline:2px solid #3e2a17;outline-offset:1px}
#inventory .sv-recipe.sv-pinned::after{content:"";position:absolute;right:5px;top:5px;width:13px;height:13px;background:#8a4410;
  -webkit-mask:var(--sv-pin) center/contain no-repeat;mask:var(--sv-pin) center/contain no-repeat}
#inventory{--sv-pin:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M8.5 2h7v1.5H14v4.7l3.5 4.3v1.5h-4.7V22h-1.6v-8H6.5v-1.5L10 8.2V3.5H8.5z'/%3E%3C/svg%3E")}
#craftTracker{position:fixed;right:16px;bottom:24px;z-index:4;width:220px;padding:9px 10px 8px;border-radius:9px;pointer-events:none;
  background:linear-gradient(180deg,#1a2226d9,#0e1417e0);box-shadow:inset 0 0 0 1px #ffffff17,0 6px 18px #0006;color:#f4efe2;font:500 13px/1.25 ${FONT}}
#craftTracker[hidden]{display:none}
#craftTracker .ct-head{display:grid;grid-template-columns:34px 1fr;gap:8px;align-items:center;margin-bottom:6px}
#craftTracker .ct-art{display:grid;place-items:center;width:34px;height:34px;border-radius:5px;background:#0000004d;box-shadow:inset 0 0 0 1px #ffffff1c}
#craftTracker .ct-art .sv-icon{width:30px;height:30px;filter:drop-shadow(0 1px 1px #0009)}
#craftTracker .ct-art svg.sv-icon{width:24px;height:24px}
#craftTracker .ct-name{display:block;font:700 14px/1.15 ${FONT};color:#f8f3e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#craftTracker .ct-state{display:block;margin-top:2px;font:700 10px/1 ${FONT};letter-spacing:1.2px;text-transform:uppercase;color:#f4efe280}
#craftTracker.ct-ready .ct-state{color:#a9e48a}
#craftTracker.ct-ready{box-shadow:inset 0 0 0 1px #8fd36a88,0 0 12px #8fd36a33,0 6px 18px #0006}
#craftTracker.ct-gated .ct-art>*{filter:grayscale(1) brightness(.6)}
#craftTracker.ct-gated .ct-state{color:#e8c27a;line-height:1.2}
#craftTracker .ct-reqs{display:flex;flex-wrap:wrap;gap:4px}
#craftTracker .ct-rq{display:inline-flex;align-items:center;gap:3px;padding:2px 5px 3px 6px;border-radius:4px;background:#ffffff0a;box-shadow:inset 0 -2px 0 #8fd36a;
  font:800 12px/1 ${FONT};font-variant-numeric:tabular-nums;color:#9ee07a}
#craftTracker .ct-rq.ct-rq-short{box-shadow:inset 0 -2px 0 #e06a4a;color:#ff8a73}
#craftTracker .ct-rq .sv-icon{width:22px;height:22px}
#craftTracker .ct-foot{margin-top:6px;font:600 11px/1.3 ${FONT};color:#f4efe299}
#craftTracker .ct-foot kbd{font:800 10px/1 ${FONT};padding:1px 4px;border-radius:3px;box-shadow:inset 0 0 0 1px #ffffff40;color:#fff6e0}
@media(max-width:760px){#craftTracker{bottom:110px;right:10px;width:180px}}
`;

const BAG_HUD = 'body:has(#inventory[open]) :is(#sailBadge,#lrVitals,#fcChip){visibility:hidden}'; // the open bag covers their edges
function ensureStyle() {
  let st = document.getElementById('survival-style');
  if (!st) { st = document.createElement('style'); st.id = 'survival-style'; document.head.append(st); }
  const css = CSS + BAG_HUD + NO_SELECT;
  if (st.textContent !== css) st.textContent = css;
}

const slotInner = num => `${num ? `<i class="sv-num">${num}</i>` : ''}<i class="sv-art"></i><i class="sv-count"></i><i class="sv-dur" hidden><i></i></i>`;

const HINT = 'Click a stack to pick it up, then a slot to place it, or drag it. Right-click a stack to take half; right-click while holding to place one. Arrow keys move between slots; Tab, E, I or Esc closes.';
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
    let eq = '';
    for (let i = 0; i < EQUIP; i++) eq += `<span class="sv-eslot" data-equip="${i}" role="img" aria-label="Equipment slot ${i + 1}, empty"><i class="sv-art"></i></span>`;
    d.innerHTML = `<div class="sv-wrap" tabindex="-1">
      <section class="sv-craft" aria-label="Crafting">
        <h3 class="sv-h">Crafting</h3>
        <div class="sv-cbody">
          <div class="sv-tabs" role="tablist" aria-label="Recipe categories" aria-orientation="vertical"></div>
          <div class="sv-rcol"><div class="sv-rlist" role="tabpanel"></div></div>
          <div class="sv-detail" hidden>
            <div class="sv-dhead"><span class="sv-dart" aria-hidden="true"></span><span class="sv-dtext"><b class="sv-dname"></b><small class="sv-ddesc"></small></span><button type="button" class="sv-pinbtn" aria-pressed="false" aria-label="Pin recipe">${uiIcon('pin')}</button></div>
            <p class="sv-duse" hidden></p>
            <p class="sv-dstate" hidden></p>
            <span class="sv-dlabel">Requires</span>
            <ul class="sv-ings"></ul>
            <button type="button" class="sv-craftbtn"><i class="sv-fill"></i><span class="sv-clabel">${uiIcon('hammer')}</span><small class="sv-chint"></small><b class="sv-ccount" aria-hidden="true"></b></button>
          </div>
        </div>
      </section>
      <div class="sv-side">
        <section class="sv-bag" aria-label="Inventory">
          <h3 class="sv-h">Backpack</h3>
          <div class="sv-grid" role="group" aria-label="Backpack">${grid}</div>
          <div class="sv-equip" role="group" aria-label="Equipment">${eq}</div>
          <div class="sv-rope" aria-hidden="true"></div>
          <div class="sv-hotrow" role="group" aria-label="Hotbar">${hot}</div>
          <p class="sv-hint" role="status" aria-live="polite">${HINT}</p>
        </section>
      </div>
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
  setItemGlyph(kind => art(kind));
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
    hint: detail.querySelector('.sv-chint'), count: detail.querySelector('.sv-ccount'), pin: detail.querySelector('.sv-pinbtn'),
    state: detail.querySelector('.sv-dstate'), use: detail.querySelector('.sv-duse'),
  };
  const rcol = rlist.parentElement;
  // Bottom fade on the recipe list while more rows sit below the fold.
  const paintMore = () => { const more = rlist.scrollHeight - rlist.scrollTop - rlist.clientHeight > 2; if (rcol.classList.contains('sv-more') !== more) rcol.classList.toggle('sv-more', more); };
  const tip = dlg.querySelector('.sv-tip');
  const held = dlg.querySelector('.sv-held'), heldArt = held.firstElementChild, heldCnt = held.lastElementChild;
  let heldKind = null, px = 0, py = 0;
  // graphics.css zooms the dialog (--ui-scale). Pointer and rect px are viewport px; the fixed card and held stack
  // are laid out in zoomed px, so their offsets are divided by it. Read on open and resize, never per frame.
  let zoom = 1;
  const readZoom = () => { const z = Number(dlg.currentCSSZoom); zoom = z > 0 && Number.isFinite(z) ? z : 1; };
  const hintEl = dlg.querySelector('.sv-hint');
  const equipEls = [...dlg.querySelectorAll('.sv-eslot[data-equip]')];
  let equipSig = null;
  const invEls = [];
  dlg.querySelectorAll('.sv-slot[data-index]').forEach(el => {
    invEls[+el.dataset.index] = el; el._svSig = undefined;
    // Adopted DOM may carry transient state from a previous (reloaded) instance.
    el.classList.remove(...TRANSIENT); el.removeAttribute('aria-pressed'); delete el.dataset.pick;
  });

  let isOpen = dlg.open;
  let src = null, srcAmt = 0, srcKind = null;
  let denyEl = null, denyTimer = 0, sayTimer = 0;
  let downOnBackdrop = false, upOnBackdrop = false;
  let dragging = false, dragFrom = null, dragAmt = 0, overEl = null;
  let hoverIdx = null;
  let lastSig = null, bagSig = null;
  let gateSig = null, gateAt = 0; // recipe gates seen by the open bag (goals / unlocks change mid-session)
  const GATE_POLL_MS = 250;
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
  let hold = null, btnDenyTimer = 0, countTimer = 0, flashUntil = 0;
  let pickedByUser = false; // false: pickId is an automatic default, re-chosen on open once states are known
  let tipAnchor = null;
  let pinId = null, trackEl = null, trackSig = null;
  const store = () => { try { return window.localStorage; } catch { return null; } };

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
      tabsEl.innerHTML = groups.map(g => `<button type="button" class="sv-tab" role="tab" data-cat="${esc(g.id)}" aria-selected="false" tabindex="-1" title="${esc(g.name)}">${iconSVG(g.icon)}<span class="sv-sr">${esc(g.name)}</span><i class="sv-tbadge"></i></button>`).join('');
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
    if (!inTab.some(v => v.r.id === pickId)) pickId = (inTab.find(v => v.state === 'ready') || inTab.find(v => v.state !== 'gated') || inTab[0])?.r.id ?? null;
    if (activeTab) dlg.dataset.svTab = activeTab;
    const tabEl = tabsEl.querySelector(`.sv-tab[data-cat="${activeTab}"]`);
    if (tabEl) rlist.setAttribute('aria-label', tabEl.textContent.trim() + ' recipes');
    applyPick();
    paintMore();
  }
  function setTab(id, focus = false) {
    if (!groups.some(g => g.id === id)) return;
    if (id !== activeTab) { stopHold(); hideTip(); flashUntil = 0; activeTab = id; pickId = null; pickedByUser = false; reorderRecipes(); applyTab(); rlist.scrollTop = 0; paintMore(); }
    if (focus) tabsEl.querySelector(`.sv-tab[data-cat="${id}"]`)?.focus();
  }
  function setPick(id) {
    if (id === pickId) return;
    stopHold(); flashUntil = 0; pickId = id; pickedByUser = true; applyPick();
  }
  function applyPick() {
    for (const v of recipeEls) { const on = v.r.id === pickId; v.el.classList.toggle('sv-pick', on); v.el.setAttribute('aria-current', String(on)); }
    if (pickId) dlg.dataset.svPick = pickId;
    paintPin();
    const v = viewOf(pickId);
    detail.hidden = !v;
    if (!v) { shownPick = null; return; }
    if (shownPick !== pickId) {
      shownPick = pickId;
      const t = ITEM_TEXT[v.r.out.kind];
      D.art.innerHTML = art(v.r.out.kind);
      D.art.dataset.tipKind = v.r.out.kind;
      D.name.textContent = v.r.name + (v.r.out.count > 1 ? ' ×' + v.r.out.count : '');
      D.desc.textContent = t?.desc || t?.use || '';
      if (D.use) { D.use.innerHTML = t?.desc && t?.use ? `<em>Used for:</em> ${esc(t.use)}` : ''; D.use.hidden = !D.use.innerHTML; }
      // One tile per ingredient: icon and have/need (the name is its tooltip). A missing one that can be
      // crafted right now gets a + that makes one in place, without leaving this recipe.
      D.ings.innerHTML = v.r.reqs.map(q => {
        const sub = sourceOf(q.kind, recipes, itemName)?.recipe;
        const plus = sub && sub !== v.r.id ? `<button type="button" class="sv-iplus" data-make="${esc(sub)}" aria-label="Craft ${esc(itemName(q.kind))}" hidden>${uiIcon('plus')}</button>` : '';
        return `<li class="sv-ing" data-tip-kind="${esc(q.kind)}">${art(q.kind)}<b class="sv-iamt"></b>${plus}</li>`;
      }).join('');
      ingEls = [...D.ings.querySelectorAll('.sv-ing')].map(el => ({ el, amt: el.querySelector('.sv-iamt'), plus: el.querySelector('.sv-iplus') }));
      D.count.textContent = '';
    }
    paintDetail();
  }
  function paintDetail() {
    const v = viewOf(pickId); if (!v || detail.hidden) return;
    v.rows.forEach((row, k) => {
      const e = ingEls[k]; if (!e) return;
      e.amt.textContent = reqAmount(row);
      e.el.classList.toggle('sv-ok', row.enough);
      const src = row.enough ? null : sourceOf(row.kind, recipes, itemName);
      e.el.setAttribute('aria-label', `${itemName(row.kind)}: have ${row.have}, need ${row.need}${src ? '. ' + src.how : ''}`);
      if (e.plus) {
        const can = !row.enough && viewOf(e.plus.dataset.make)?.state === 'ready';
        if (e.plus.hidden === can) e.plus.hidden = !can;
      }
    });
    const ready = v.state === 'ready';
    // Why it cannot be made, in full (the list row only has room for two lines).
    const why = v.state === 'gated' ? 'Locked: ' + (v.reason || 'not learned yet') : v.state === 'full' ? 'No room in your bag for it' : '';
    if (D.state && D.state.textContent !== why) D.state.textContent = why;
    if (D.state) D.state.hidden = !why;
    D.btn.setAttribute('aria-disabled', String(!ready));
    if (!hold && performance.now() >= flashUntil) {
      D.btn.classList.remove('sv-done');
      paintBtn(craftButtonView(v.state, { times: v.times })); // [progression-hook] gated shows the lock
    }
    D.btn.setAttribute('aria-label', ready ? `Craft ${v.r.name}${v.times > 1 ? `. Hold to craft up to ${Math.min(v.times, HOLD.max)}` : ''}.`
      : `${v.r.name}: ${v.state === 'gated' ? 'locked' : v.state === 'full' ? 'bag is full' : 'missing materials'}`);
  }
  // Craft button face: an icon plus at most a short number (craft-book.js craftButtonView).
  function paintBtn(view) {
    const key = view.icon + '|' + view.text;
    if (D.btn._svFace === key) return;
    D.btn._svFace = key;
    D.label.innerHTML = uiIcon(view.icon);
    D.hint.textContent = view.text;
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
    const state = recipeState(rows, check);
    let times = craftableTimes(rows);
    if (state === 'ready') { const fit = fittingTimes(bag, r.id, Math.min(HOLD.max, times)); if (fit != null) times = fit; } // bag space caps it too
    return { rows, state, reason: '', times };
  }
  function paintRecipes(bag) {
    const readyPer = new Map();
    for (const v of recipeEls) {
      const r = v.r;
      const { rows, state, times, reason } = evaluate(bag, r);
      v.rows = rows; v.state = state; v.times = times; v.reason = reason; // [progression-hook] reason
      if (state === 'ready') readyPer.set(v.cat, (readyPer.get(v.cat) || 0) + 1);
      const sig = state + times + ':' + (v.reason || '') + rows.map(x => x.have).join(','); // [progression-hook] reason
      if (v.sig === sig) continue;
      v.sig = sig;
      v.el.classList.toggle('sv-ready', state === 'ready');
      v.el.classList.toggle('sv-full', state === 'full');
      v.el.classList.toggle('sv-locked', state === 'missing' || state === 'gated');
      v.el.classList.toggle('sv-gated', state === 'gated'); // [progression-hook]
      if (state === 'gated') v.el.dataset.lockReason = v.reason || 'not learned yet'; else delete v.el.dataset.lockReason; // item tooltips show it
      const lacking = rows.filter(x => !x.enough);
      const subText = state === 'gated' ? 'Locked: ' + (v.reason || 'not learned yet') // [progression-hook]
        : state === 'ready' ? 'Ready to craft'
        : state === 'full' ? 'No room in your bag'
        : 'Missing ' + lacking.map(x => `${x.short} ${itemName(x.kind)}`).join(', ');
      // Missing: one chip per short ingredient (have/need and its icon); ready rows rely on the green edge and badge.
      if (state === 'missing') v.sub.innerHTML = reqChips(lacking, { glyph: art, nameOf: itemName, cls: 'sv-rq', title: false });
      else v.sub.textContent = state === 'ready' ? '' : subText;
      v.badge.textContent = state === 'ready' && Number.isFinite(times) && times > 0 ? '×' + Math.min(times, 99) : '';
      v.el.setAttribute('aria-label', `${r.name}${r.out.count > 1 ? ', makes ' + r.out.count : ''}. Needs ${rows.map(x => `${x.need} ${itemName(x.kind)}, have ${x.have}`).join('; ') || 'nothing'}. ${subText}.`);
      if (tipAnchor === v.el) { if (anchorVisible(v.el)) showTipFor(v.el); else hideTip(); }
    }
    paintMore();
    tabsEl.querySelectorAll('.sv-tab').forEach(t => {
      const n = readyPer.get(t.dataset.cat) || 0, b = t.querySelector('.sv-tbadge');
      if (b && b.textContent !== (n ? String(n) : '')) b.textContent = n ? String(n) : '';
      t.setAttribute('aria-label', `${t.querySelector('span')?.textContent || ''}${n ? `, ${n} ready` : ''}`);
    });
    paintDetail();
  }

  // ---------- pinned recipe tracker (HUD edge, shown while the bag is closed) ----------
  function togglePin() {
    if (!pickId) return;
    pinId = pinId === pickId ? null : pickId;
    savePin(store(), pinId);
    trackSig = null;
    paintPin();
  }
  function paintPin() {
    const on = !!pickId && pinId === pickId;
    if (D.pin) {
      D.pin.setAttribute('aria-pressed', String(on));
      D.pin.setAttribute('aria-label', on ? 'Unpin recipe' : 'Pin recipe');
      D.pin.title = on ? 'Unpin' : 'Pin to screen';
    }
    for (const v of recipeEls) v.el.classList.toggle('sv-pinned', v.r.id === pinId);
  }
  function ensureTracker() {
    if (trackEl && trackEl.isConnected) return trackEl;
    let t = document.getElementById('craftTracker');
    if (!t) {
      t = document.createElement('aside');
      t.id = 'craftTracker'; t.hidden = true;
      t.setAttribute('aria-label', 'Pinned recipe');
      (document.getElementById('hud') || document.body).append(t);
    }
    trackEl = t; trackSig = null;
    return t;
  }
  function paintTracker(bag, sig) {
    const t = ensureTracker();
    const r = pinId && !isOpen ? recipes.find(x => x.id === pinId) : null;
    if (!r) { if (!t.hidden) t.hidden = true; trackSig = null; return; }
    const g = gate(r.id); // research / progression lock: never "Ready" while locked
    const key = sig + '|' + pinId + '|' + (g ? (g.hidden ? 'h' : 'l') + (g.reason || '') : '');
    if (key === trackSig) return;
    trackSig = key;
    let check = null;
    if (typeof bag.canCraft === 'function') { try { check = bag.canCraft(r.id); } catch {} }
    const tv = trackerView(r, k => countOf(bag, k), check, g);
    const ready = tv.state === 'ready';
    t.classList.toggle('ct-ready', ready);
    t.classList.toggle('ct-gated', tv.state === 'gated');
    const state = ready ? `Ready${tv.times > 1 ? ' ×' + Math.min(tv.times, 99) : ''}` : tv.state === 'gated' ? 'Locked: ' + (tv.reason || 'not learned yet') : tv.state === 'full' ? 'Bag is full' : `${tv.met} of ${tv.total} gathered`;
    t.innerHTML = `<div class="ct-head"><span class="ct-art" aria-hidden="true">${art(tv.kind)}</span><span><b class="ct-name">${esc(tv.name)}</b><small class="ct-state">${esc(state)}</small></span></div>`
      + `<div class="ct-reqs">${reqChips(tv.rows, { glyph: art, nameOf: itemName, cls: 'ct-rq' })}</div>`
      + (ready ? '<div class="ct-foot">Open your bag with <kbd>Tab</kbd> to craft</div>' : '');
    t.hidden = false;
  }

  // Craftable recipes float to the top of each tab (craft-book.js sortCraftableFirst). The order is
  // only redone when the bag opens or the tab changes: rows never jump under the pointer mid-craft.
  function reorderRecipes() {
    const next = groups.flatMap(g => sortCraftableFirst(recipeEls.filter(v => v.cat === g.id)));
    if (next.length !== recipeEls.length || next.every((v, i) => v === recipeEls[i])) return;
    const focused = document.activeElement;
    for (const v of next) rlist.append(v.el);
    recipeEls = next;
    if (focused && focused !== document.activeElement && rlist.contains(focused)) { try { focused.focus({ preventScroll: true }); } catch {} }
    if (tipAnchor && rlist.contains(tipAnchor)) placeTipAt(tipAnchor);
  }

  // ---------- hold to craft ----------
  // Press: craft one now (a click never makes more). Keep holding: the fill bar sweeps for
  // HOLD.first ms before the next craft, then crafts again each time it fills, faster and faster
  // (holdDelay), until materials or space run out.
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
  // + on a missing ingredient: craft one of it now; the open recipe and the list stay where they are.
  function makeIngredient(btn) {
    if (hold || !btn.dataset.make) return;
    if (craftNow(btn.dataset.make)) return;
    btn.classList.add('sv-deny');
    setTimeout(() => btn.classList.remove('sv-deny'), 280);
  }
  function setFill(p) { D.btn.style.setProperty('--fill', p.toFixed(3)); }
  // While held the label counts up ('Crafting 2 / 4'); on release it says what was made ('Crafted 4').
  function showCount(n) {
    if (!hold) return;
    clearTimeout(countTimer);
    paintBtn(craftButtonView('ready', { holding: true, done: n, cap: hold.cap }));
    D.count.textContent = '';
  }
  function startHold() {
    if (!pickId) return;
    stopHold();
    clearTimeout(countTimer);
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
    const made = hold.done, out = viewOf(hold.id)?.r.out.count || 1;
    hold = null;
    D.btn.classList.remove('sv-holding');
    setFill(0);
    clearTimeout(countTimer);
    flashUntil = performance.now() + 1100;
    paintBtn(craftButtonView('', { flash: true, done: made, out }));
    D.btn.classList.add('sv-done');
    countTimer = setTimeout(() => { flashUntil = 0; paintDetail(); }, 1100);
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
    if (trackEl?.querySelector(sel)) trackSig = null;
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
  function placeHeld() { held.style.transform = `translate(${Math.round(px / zoom - 26)}px,${Math.round(py / zoom - 26)}px)`; }
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
  // The hint line briefly says why a placement was refused, then goes back to the hint.
  function clearSay() {
    if (sayTimer) { clearTimeout(sayTimer); sayTimer = 0; }
    if (hintEl) { hintEl.classList.remove('sv-warn'); if (hintEl.textContent !== HINT) hintEl.textContent = HINT; }
  }
  function deny(el, reason = '') {
    clearDeny();
    if (!alive || !el) return;
    denyEl = el; el.classList.add('sv-deny');
    denyTimer = setTimeout(clearDeny, 280);
    if (reason && hintEl) {
      if (sayTimer) clearTimeout(sayTimer);
      hintEl.textContent = reason; hintEl.classList.add('sv-warn');
      sayTimer = setTimeout(clearSay, 1800);
    }
  }
  const refusal = (from, to) => { const s = curSlots[from]; return s ? placeRefusal(s.kind, curSlots[to], stackMax(s.kind)) : ''; };
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
    if (r === false) { deny(el, 'Can’t place that there'); return false; }
    if (r && typeof r.then === 'function') r.then(v => { if (v === false) deny(el, 'Can’t place that there'); }, e => console.error(e));
    return true;
  }
  // The 5 equipment slots show the wearables in the bag (they work while carried, one of each kind),
  // packed from the left like Raft's generic slots. Painted only when that set changes.
  function paintEquip(slots) {
    if (!equipEls.length) return;
    const worn = (GEAR_IDS || []).filter(k => slots.some(s => s && s.kind === k && s.count > 0)).slice(0, equipEls.length);
    const sig = worn.join(',');
    if (sig === equipSig) return;
    equipSig = sig;
    equipEls.forEach((el, i) => {
      const k = worn[i] || null, a = el.firstElementChild;
      el.classList.toggle('sv-worn', !!k);
      if (k) { a.innerHTML = iconHTML(k); el.dataset.itemKind = k; el.setAttribute('aria-label', `Equipment slot ${i + 1}, ${itemName(k)}`); }
      else { a.innerHTML = ''; delete el.dataset.itemKind; el.setAttribute('aria-label', `Equipment slot ${i + 1}, empty`); }
    });
  }
  function paintInventory(slots, sigs, selected) {
    paintEquip(slots);
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
  function tipHTML(kind, extra = '', withSource = true) {
    const t = ITEM_TEXT[kind];
    const uses = usedIn(kind, recipes);
    const src = withSource ? sourceOf(kind, recipes, itemName) : null;
    return `<b>${esc(itemName(kind))}</b>${extra ? `<small>${esc(extra)}</small>` : ''}`
      + (t?.desc ? `<small>${esc(t.desc)}</small>` : '')
      + (t?.use ? `<small><em>Used for:</em> ${esc(t.use)}</small>` : '')
      + (src ? `<small><em>Get it:</em> ${esc(src.how)}</small>` : '')
      + (uses.length ? `<small><em>Ingredient in:</em> ${esc(uses.join(', '))}</small>` : '');
  }
  // Crafting rows and ingredients anchor beside the whole crafting panel (never over the list or the open recipe) and never cover
  // the Craft button; a hidden or detached anchor hides the tooltip instead of pinning it top-left.
  function placeTipAt(el) {
    if (tip.hidden || !el) return;
    const col = el.closest('.sv-craft');
    const p = el.isConnected && anchorTip(el.getBoundingClientRect(), tip.offsetWidth * zoom, tip.offsetHeight * zoom, innerWidth, innerHeight, 8, 6,
      col ? { beside: col.getBoundingClientRect(), avoid: detail.hidden ? null : D.btn.getBoundingClientRect() } : null);
    if (!p) { hideTip(); return; }
    tip.style.transform = `translate(${Math.round(p.x / zoom)}px,${Math.round(p.y / zoom)}px)`;
    tip.dataset.side = p.side;
  }
  function showTipFor(el) {
    if (!el || dragging || !anchorVisible(el)) { hideTip(); return; }
    const kind = el.dataset.tipKind;
    if (!kind) { hideTip(); return; }
    let extra = '';
    const v = el.classList.contains('sv-recipe') ? viewOf(el.dataset.recipe) : null;
    if (v) extra = v.state === 'gated' ? 'Locked: ' + (v.reason || 'not learned yet') : haveNeedLine(v.rows, itemName);
    tipAnchor = el;
    tip.innerHTML = tipHTML(kind, extra, !v);
    tip.hidden = false;
    placeTipAt(el);
  }
  function showTip(i) {
    const s = curSlots[i], el = invEls[i];
    if (!s || !slotSig(s) || dragging || !el) { hideTip(); return; }
    const f = durFrac(s), max = stackMax(s.kind);
    const sub = f != null ? `Durability ${Math.round(f * 100)}%` : s.count > 1 || max > 1 ? stackLabel(s.count, max) : '';
    tipAnchor = el;
    tip.innerHTML = tipHTML(s.kind, sub);
    tip.hidden = false;
    placeTipAt(el);
  }
  function hideTip() { if (tip) tip.hidden = true; tipAnchor = null; }

  // ---------- render ----------
  // One string for every recipe's gate: '' open, 'h' hidden, 'l<reason>' locked.
  function gateSignature() {
    return recipeList().map(r => { const g = gate(r.id); return r.id + ':' + (g?.hidden ? 'h' : g?.locked ? 'l' + (g.reason || '') : ''); }).join('|');
  }
  // While the bag is open, a recipe that unlocks or becomes a goal shows up (or loses its lock) at once.
  function syncGates(now) {
    if (now < gateAt) return false;
    gateAt = now + GATE_POLL_MS;
    const gs = gateSignature();
    if (gs === gateSig) return false;
    gateSig = gs;
    buildRecipes(); // rebuilds the rows only when the visible set changed
    recipeEls.forEach(v => { v.sig = null; });
    return true;
  }
  function render(force) {
    if (!alive) return;
    if (!iconsLive && document.body?.classList.contains('playing')) liveIcons();
    const bag = bagNow();
    ensureTools();
    if (!bag) return;
    if (isOpen && !dragging && syncGates(performance.now())) { force = true; lastSig = null; }
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
    if (all !== bagSig) { const first = bagSig === null; bagSig = all; if (!first) document.dispatchEvent(new CustomEvent(BAG_EVENT)); } // item-tooltips.js re-reads its open card
    if (hotEls.length) paintHotbar(slots, sigs, selected);
    paintTracker(bag, all);
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
  // Hotbar icons on the first play frame, the rest ~5 s later (or on first open), never at the title.
  let warmTimer = 0;
  function liveIcons() {
    iconsLive = true;
    warmIcons(curSlots.slice(0, HB).map(s => s?.kind).filter(Boolean));
    if (!warmTimer) warmTimer = setTimeout(warmAll, 5000);
  }
  function warmAll() { warmTimer = -1; iconsLive = true; warmIcons(Object.keys(ITEM_INFO || {})); }
  function open() {
    if (!alive || isOpen) return;
    isOpen = true;
    downOnBackdrop = upOnBackdrop = false;
    if (warmTimer >= 0) { clearTimeout(warmTimer); warmAll(); }
    clearSrc(); clearSay();
    safe(onPause);
    exitLock(document); // marked page-initiated (lock-rules.js), so the game does not treat it as a lost lock
    if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
    readZoom();
    if (trackEl) trackEl.hidden = true;
    buildRecipes();
    gateSig = gateSignature(); gateAt = performance.now() + GATE_POLL_MS;
    invalidate();
    invEls.forEach(el => { el._svCount = undefined; }); // no pop for changes made while closed
    recipeEls.forEach(v => { v.sig = null; });
    render(true);
    reorderRecipes();
    if (!pickedByUser && viewOf(pickId)?.state !== 'ready') pickId = null; // default to the first ready recipe
    applyTab();
    try { wrap.focus({ preventScroll: true }); } catch {}
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    stopHold();
    endDrag(false);
    clearSrc(); clearDeny(); clearSay();
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
  // Backdrop: close only when the press started and ended there (Chrome sends a click that
  // starts inside the panel and ends outside it, or the reverse, to the dialog itself).
  dlg.addEventListener('pointerdown', e => { downOnBackdrop = e.target === dlg; upOnBackdrop = false; }, opt);
  dlg.addEventListener('pointerup', e => { upOnBackdrop = e.target === dlg; }, opt);
  dlg.addEventListener('click', e => {
    if (e.target === dlg) { const shut = backdropCloses(downOnBackdrop, upOnBackdrop); downOnBackdrop = upOnBackdrop = false; if (shut) close(); return; }
    downOnBackdrop = upOnBackdrop = false;
    if (e.target.closest?.('.sv-pinbtn')) { togglePin(); return; }
    const tb = e.target.closest?.('.sv-tab');
    if (tb) { setTab(tb.dataset.cat); return; }
    const mk = e.target.closest?.('.sv-iplus');
    if (mk) { makeIngredient(mk); return; }
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
    if (!p.ok) { deny(el, refusal(from, i)); return; }
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
    if (!fits) { deny(el, refusal(from, i)); return; }
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
      if (to !== from && amt > 0) { if (planMove(from, to, amt).ok) sendMove(from, to, amt, el); else deny(el, refusal(from, to)); }
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
  rlist.addEventListener('scroll', () => { paintMore(); if (tipAnchor && rlist.contains(tipAnchor)) placeTipAt(tipAnchor); }, { ...opt, passive: true });
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
    if (e.code === 'ArrowDown' || e.code === 'ArrowRight') n = (i + 1) % ids.length;
    else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') n = (i - 1 + ids.length) % ids.length;
    else if (e.code === 'Home') n = 0; else if (e.code === 'End') n = ids.length - 1;
    if (n < 0) return;
    e.preventDefault(); setTab(ids[n], true);
  }, opt);
  // Arrow keys move focus across the slots (by layout) and up/down the visible recipe list.
  dlg.addEventListener('keydown', e => {
    if (!isOpen || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    const slot = e.target.closest?.('.sv-slot[data-index]'), rec = e.target.closest?.('.sv-recipe');
    let next = null;
    if (slot) {
      const rects = invEls.map(el => el ? el.getBoundingClientRect() : null);
      const n = arrowNeighbor(rects, +slot.dataset.index, e.code);
      if (n >= 0) next = invEls[n];
    } else if (rec && (e.code === 'ArrowDown' || e.code === 'ArrowUp')) {
      // Locked (gated) rows are skipped: arrows walk the recipes you can work towards.
      const vis = recipeEls.filter(v => !v.el.hidden && (v.state !== 'gated' || v.el === rec)).map(v => v.el), i = vis.indexOf(rec);
      next = vis[i + (e.code === 'ArrowDown' ? 1 : -1)] || null;
    }
    if (!next) return;
    e.preventDefault();
    try { next.focus({ preventScroll: false }); } catch {}
  }, opt);
  document.addEventListener('selectstart', e => { if (!inTextField(e.target)) e.preventDefault(); }, opt);
  document.addEventListener('dragstart', e => {
    const el = elOf(e.target);
    if (inTextField(el) || el?.closest?.('[draggable="true"]')) return;
    e.preventDefault();
  }, opt);
  // Keep scroll inside the panel from reaching the engine's hotbar wheel handler.
  dlg.addEventListener('wheel', e => e.stopPropagation(), { ...opt, passive: true });
  window.addEventListener('resize', () => { if (isOpen) readZoom(); }, { ...opt, passive: true });

  // Hotbar clicks (delegated so a replaced .tools node needs no rebinding).
  document.addEventListener('click', e => {
    const b = e.target?.closest?.('.tools.sv-hotbar>.sv-slot[data-slot]');
    if (!b || !alive) return;
    e.preventDefault();
    safe(onSelect, +b.dataset.slot);
    if (e.detail > 0) b.blur();
  }, opt);

  // Tab / I open while playing; Tab / I / E close.
  document.addEventListener('keydown', e => {
    if (!alive || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    const act = bagKeyAction(e.code, isOpen);
    if (!act) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (act === 'close') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (!canOpenNow()) return;
    e.preventDefault(); e.stopPropagation();
    open();
  }, { ...opt, capture: true });

  buildRecipes();
  pinId = loadPin(store(), recipes.map(r => r.id));
  paintPin();
  if (isOpen) render(true);

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
      if (warmTimer > 0) clearTimeout(warmTimer);
      clearTimeout(labelTimer);
      endDrag(false);
      clearSrc();
      clearDeny();
      hideTip(); hoverIdx = null;
      if (trackEl) trackEl.hidden = true;
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
export { iconSVG, slotSig, paintSlot, itemName, flatIcon }; // content hook (storage-research)
