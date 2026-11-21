// Little Raft survival UI: shared-play hotbar (.tools) + inventory/crafting dialog (#inventory).
// Pure view layer. It never mutates the Bag; all changes go through the callbacks.
import { RECIPES, ITEM_INFO, HOTBAR_SIZE, STACK_SIZE, SLOT_COUNT, TOOL_DURABILITY } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';

const VERSION = 'sv1';
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
.tools.sv-hotbar{display:flex;flex-wrap:nowrap;gap:4px;padding:5px;border-radius:4px;max-width:96vw;overflow:visible;
  background:repeating-linear-gradient(90deg,#0000000d 0 2px,transparent 2px 19px),linear-gradient(#9a7643,#6a4a2a);
  border:2px solid #c9a66b;box-shadow:0 0 0 2px #3e2a17,0 4px 14px #0006}
.tools.sv-hotbar::before,.tools.sv-hotbar::after{content:none;display:none}
.tools.sv-hotbar>button.sv-slot,#inventory.sv-inv button.sv-slot{
  position:relative;display:block;flex:0 0 auto;width:58px;height:58px;min-width:0;min-height:0;margin:0;padding:0;border:0;border-radius:3px;
  background:linear-gradient(180deg,#5a3f28e8,#3d2a19e8);box-shadow:inset 0 0 0 1px #d4b07a55,inset 0 2px 6px #0006;
  color:#fff2cc;font:600 14px/1 ${FONT};letter-spacing:0;text-transform:none;cursor:pointer;transform:none;transition:box-shadow .08s,background .08s;outline:none}
.tools.sv-hotbar>button.sv-slot::after{content:none;display:none}
.sv-slot i{font-style:normal;pointer-events:none}
.sv-slot .sv-num{position:absolute;left:4px;top:3px;font:700 11px/1 ${FONT};color:#f3e4c2;text-shadow:0 1px 1px #000a}
.sv-slot .sv-art{position:absolute;inset:9px;display:block}
.sv-slot .sv-icon{display:block;width:100%;height:100%;filter:drop-shadow(0 1px 1px #0008)}
.sv-slot .sv-count{position:absolute;right:4px;bottom:3px;font:700 14px/1 ${FONT};color:#fff2cc;text-shadow:0 1px 0 #000,0 0 3px #000}
.sv-slot .sv-dur{position:absolute;left:6px;right:6px;bottom:3px;height:3px;border-radius:2px;background:#0009;display:block;overflow:hidden}
.sv-slot .sv-dur[hidden]{display:none}
.sv-slot .sv-dur>i{display:block;height:100%;width:100%;background:#8fd36a}
.tools.sv-hotbar>button.sv-slot:hover,#inventory.sv-inv button.sv-slot:hover{box-shadow:inset 0 0 0 1px #ffe3a6bb,inset 0 2px 6px #0005}
.tools.sv-hotbar>button.sv-slot.sv-sel,#inventory.sv-inv button.sv-slot.sv-sel{background:linear-gradient(180deg,#b3925acc,#8a6a3ccc);box-shadow:inset 0 0 0 2px #ffe3a6,0 0 0 1px #3e2a17}
.tools.sv-hotbar>button.sv-slot:focus-visible,#inventory.sv-inv button.sv-slot:focus-visible{outline:2px solid #ffe3a6;outline-offset:1px}
@media(max-width:760px){.tools.sv-hotbar>button.sv-slot{width:42px;height:42px}.tools.sv-hotbar .sv-art{inset:6px}.tools.sv-hotbar .sv-count{font-size:12px}}
#inventory.sv-inv{padding:0;margin:auto;border:0;border-radius:6px;background:transparent;box-shadow:none;color:#fff2cc;
  width:max-content;min-width:0;max-width:96vw;max-height:94vh;overflow:visible;font:500 14px/1.35 ${FONT}}
#inventory.sv-inv::backdrop{background:rgba(12,9,5,.42);-webkit-backdrop-filter:none;backdrop-filter:none}
#inventory .sv-wrap{display:flex;gap:12px;align-items:stretch;padding:12px;outline:none;border-radius:6px;
  background:repeating-linear-gradient(90deg,#00000012 0 2px,transparent 2px 23px),linear-gradient(#b48d55,#8a663a);
  border:3px solid #3e2a17;box-shadow:0 0 0 2px #d6b67e,0 18px 50px #000a}
#inventory .sv-craft,#inventory .sv-bag{background:#3a2716eb;border-radius:4px;box-shadow:inset 0 0 0 2px #24170c,inset 0 0 0 3px #b48d5544}
#inventory .sv-craft{flex:0 0 300px;width:300px;min-width:300px;box-sizing:border-box;max-height:min(520px,calc(94vh - 30px));overflow:auto;overscroll-behavior:contain;padding:9px;scrollbar-color:#b48d55 #2a1b0e}
#inventory .sv-bag{flex:none;min-width:max-content;display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px}
#inventory .sv-grid{display:grid;grid-template-columns:repeat(7,52px);gap:6px}
#inventory .sv-hotrow{display:grid;grid-template-columns:repeat(${HB},52px);gap:6px}
#inventory.sv-inv button.sv-slot{width:52px;height:52px}
#inventory .sv-slot .sv-art{inset:8px}
#inventory .sv-slot.sv-hot{background:linear-gradient(180deg,#664730e8,#46301ce8)}
#inventory .sv-slot.sv-hot.sv-sel{background:linear-gradient(180deg,#b3925acc,#8a6a3ccc)}
#inventory.sv-inv button.sv-slot.sv-src{background:linear-gradient(180deg,#8a6236,#5e4024);box-shadow:inset 0 0 0 2px #ffbd66,0 0 10px #ffbd6699}
#inventory.sv-inv button.sv-slot.sv-over{box-shadow:inset 0 0 0 2px #9fe0d6,0 0 8px #9fe0d688}
#inventory.sv-inv button.sv-slot.sv-deny{box-shadow:inset 0 0 0 2px #e06a4a,0 0 6px #e06a4a88}
#inventory .sv-slot.sv-dragging{opacity:.45}
#inventory .sv-slot[data-pick]::after{content:attr(data-pick);position:absolute;right:-5px;top:-6px;min-width:16px;padding:2px 3px;border-radius:8px;
  background:#ffbd66;color:#2a1b0e;font:700 11px/1 ${FONT};text-align:center;box-shadow:0 1px 2px #0008}
#inventory .sv-rope{width:100%;height:4px;border-radius:2px;background:repeating-linear-gradient(115deg,#c99560 0 3px,#6b4a2b 3px 5px);opacity:.85}
#inventory .sv-hint{margin:2px 0 0;max-width:${HB * 58}px;font:500 12px/1.35 ${FONT};color:#d9c9a6;text-align:center}
#inventory .sv-recipe{display:grid;grid-template-columns:44px 1fr;gap:10px;align-items:center;width:100%;height:auto;min-height:0;margin:0 0 6px;padding:7px 9px;
  border:0;border-radius:4px;text-align:left;background:linear-gradient(#5d4129,#4a3220);box-shadow:inset 0 0 0 1px #d4b07a44;
  color:#fff2cc;font:600 14px/1.25 ${FONT};letter-spacing:0;text-transform:none;cursor:pointer;transform:none}
#inventory .sv-recipe:last-child{margin-bottom:0}
#inventory .sv-recipe:hover:not(:disabled){background:linear-gradient(#7a5631,#5d4026);box-shadow:inset 0 0 0 1px #ffe3a6}
#inventory .sv-recipe:active:not(:disabled){background:#4a3220}
#inventory .sv-recipe:disabled{cursor:not-allowed;opacity:.6}
#inventory .sv-recipe:focus-visible{outline:2px solid #ffe3a6;outline-offset:1px}
#inventory .sv-rart{display:grid;place-items:center;width:44px;height:44px;border-radius:3px;background:#24170caa;box-shadow:inset 0 0 0 1px #d4b07a33}
#inventory .sv-rart .sv-icon{width:34px;height:34px}
#inventory .sv-rbody{display:block;min-width:0}
#inventory .sv-rname{display:block;font:700 14px/1.2 ${FONT};color:#fff2cc}
#inventory .sv-reqs{display:flex;flex-wrap:wrap;gap:3px 10px;margin-top:4px}
#inventory .sv-req{display:inline-flex;align-items:center;gap:3px;font:600 13px/1 ${FONT};color:#eadcbe;font-variant-numeric:tabular-nums}
#inventory .sv-req .sv-icon{width:18px;height:18px}
#inventory .sv-req.sv-short{color:#ffab8f}
#inventory .sv-why{display:block;margin-top:3px;font:600 12px/1.2 ${FONT};color:#ffcf9a}
#inventory .sv-why:empty{display:none}
#inventory .sv-empty-list{margin:6px;color:#d9c9a6;font-size:14px}
#inventory .sv-tip{position:fixed;left:0;top:0;z-index:10;pointer-events:none;padding:6px 9px;border-radius:3px;white-space:nowrap;
  background:#24170cf2;border:1px solid #c9a66b;color:#fff2cc;font:700 14px/1.3 ${FONT};box-shadow:0 4px 12px #0008}
#inventory .sv-tip[hidden]{display:none}
#inventory .sv-tip small{display:block;font:500 12px/1.3 ${FONT};color:#d9c9a6}
@media(max-width:860px),(max-height:520px){#inventory.sv-inv{width:auto}#inventory .sv-wrap{flex-direction:column;max-height:94vh;overflow:auto;box-sizing:border-box}#inventory .sv-craft{flex:none;width:auto;min-width:0;max-height:36vh}#inventory .sv-bag{min-width:0}
  #inventory .sv-grid{grid-template-columns:repeat(7,44px)}#inventory .sv-hotrow{grid-template-columns:repeat(${HB},44px)}#inventory.sv-inv button.sv-slot{width:44px;height:44px}#inventory .sv-slot .sv-art{inset:6px}}
@media(max-width:440px){#inventory .sv-grid{grid-template-columns:repeat(7,36px);gap:4px}#inventory .sv-hotrow{grid-template-columns:repeat(${HB},36px);gap:4px}#inventory.sv-inv button.sv-slot{width:36px;height:36px}#inventory .sv-slot .sv-art{inset:5px}#inventory .sv-slot .sv-count{font-size:12px}}
@media(prefers-reduced-motion:reduce){.sv-slot,.sv-recipe{transition:none}}
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
      <section class="sv-craft" aria-label="Crafting"><div class="sv-rlist"></div></section>
      <section class="sv-bag" aria-label="Inventory">
        <div class="sv-grid" role="group" aria-label="Backpack">${grid}</div>
        <div class="sv-rope" aria-hidden="true"></div>
        <div class="sv-hotrow" role="group" aria-label="Hotbar">${hot}</div>
        <p class="sv-hint">Click a stack to pick it up, then click a slot to place it. Right-click takes half. Drag to move.</p>
      </section>
      <div class="sv-tip" role="tooltip" hidden></div>
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
    r.cnt.textContent = '';
    if (r.dur) r.dur.hidden = true;
    el.classList.add('sv-empty');
    el.setAttribute('aria-label', label + ', empty');
    return true;
  }
  if (el._svKind !== s.kind) { r.art.innerHTML = iconSVG(s.kind); el._svKind = s.kind; }
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

export function createSurvivalUI({ getBag, onSelect, onMove, onCraft, onResume, onPause } = {}) {
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
        <span class="sv-rart" aria-hidden="true">${iconSVG(r.out.kind)}</span>
        <span class="sv-rbody"><span class="sv-rname">${esc(r.name)}${r.out.count > 1 ? ' ×' + r.out.count : ''}</span>
        <span class="sv-reqs">${r.reqs.map(q => `<span class="sv-req" title="${esc(itemName(q.kind))}">${iconSVG(q.kind)}<span class="sv-have">0/${q.count}</span></span>`).join('')}</span>
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
  function ensureTools() {
    if (tools && tools.isConnected && tools.dataset.sv === VERSION && tools.childElementCount === HB) return tools;
    const t = document.querySelector('.tools');
    if (!t) { tools = null; hotEls = []; return null; }
    if (t.dataset.sv !== VERSION || t.childElementCount !== HB || !t.querySelector(':scope>.sv-slot')) {
      let html = '';
      for (let i = 0; i < HB; i++) html += `<button type="button" class="sv-slot" data-slot="${i}">${slotInner(i + 1)}</button>`;
      t.innerHTML = html;
      t.dataset.sv = VERSION;
    }
    t.classList.add('sv-hotbar');
    t.setAttribute('role', 'toolbar');
    t.setAttribute('aria-label', 'Hotbar');
    tools = t;
    hotEls = [...t.querySelectorAll(':scope>.sv-slot')];
    hotEls.forEach(el => { el._svSig = undefined; });
    return t;
  }
  function paintHotbar(slots, sigs, selected) {
    for (let i = 0; i < hotEls.length; i++) {
      const el = hotEls[i];
      paintSlot(el, slots[i], sigs[i], `Hotbar slot ${i + 1}`);
      const sel = i === selected;
      if (el._svSel !== sel) { el._svSel = sel; el.classList.toggle('sv-sel', sel); el.setAttribute('aria-pressed', String(sel)); }
    }
  }

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
  }
  function clearSrc() {
    if (src != null && invEls[src]) {
      const el = invEls[src];
      el.classList.remove('sv-src'); el.removeAttribute('aria-pressed'); delete el.dataset.pick;
    }
    src = null; srcAmt = 0; srcKind = null;
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
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch {}
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
  dlg.addEventListener('dragend', () => { if (dragging) endDrag(); }, opt);
  dlg.addEventListener('pointerover', e => {
    const el = slotFrom(e);
    if (!el) { if (hoverIdx != null) { hoverIdx = null; hideTip(); } return; }
    const i = +el.dataset.index;
    if (i !== hoverIdx) { hoverIdx = i; showTip(i); placeTip(e.clientX, e.clientY); }
  }, opt);
  dlg.addEventListener('pointermove', e => { if (hoverIdx != null) placeTip(e.clientX, e.clientY); }, opt);
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

  if (isOpen) { buildRecipes(); render(true); }
  else buildRecipes();

  const api = {
    update() { render(false); },
    open,
    close,
    destroy() {
      if (!alive) return;
      alive = false;
      ac.abort();
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
