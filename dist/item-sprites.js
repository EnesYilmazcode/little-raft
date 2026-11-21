// Little Raft flat item icons: the SVG fallback shown while (or instead of) the rendered 3D icon.
// Shared by the bag/hotbar (survival-ui.js) and the pickup feed so both show the same picture.
// iconParts(kind) -> {href} for an icons.svg symbol or {body} for an inline drawing (viewBox 0 0 48 48).
import { ITEM_INFO } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { ITEM_ICONS } from './item-svg.js?build=v3-survival-ae77fa84ac2b'; // [progression-hook] drawings for placeholder kinds

const BUILD = (() => { try { return new URL(import.meta.url).searchParams.get('build') || 'dev'; } catch { return 'dev'; } })();
export const SPRITE_URL = (() => {
  try { const u = new URL('icons.svg', import.meta.url); u.search = '?build=' + encodeURIComponent(BUILD); return u.href; }
  catch { return 'icons.svg'; }
})();

// Symbols that actually exist in icons.svg.
const SPRITES = new Set(['hook', 'floor', 'fish', 'wood', 'leaf', 'scrap', 'barrel', 'sail', 'palm', 'lantern', 'net', 'crew', 'help', 'sound', 'close', 'repair', 'hammer', 'compass', 'antenna', 'bottle', 'cup', 'saltcup', 'freshcup', 'purifier', 'rainbarrel', 'sprinkler', 'research']);
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
};
// Hand-drawn drawings for kinds whose icons.svg symbol is only a borrowed placeholder (same palette).
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
  bench: `<g stroke="#153e49" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M11 26 L9 41 M37 26 L39 41 M14 26 L15 37 M34 26 L33 37" fill="none" stroke-width="3.2"/>
    <path d="M11 26 L9 41 M37 26 L39 41" fill="none" stroke="#a7743f" stroke-width="1.4"/>
    <rect x="5" y="19" width="38" height="7.5" rx="1.5" fill="#c99560"/>
    <path d="M5 22.8 H43" fill="none" stroke-width="1.1" stroke-opacity=".5"/>
    <path d="M12 21 L13 21 M35 21 L36 21" fill="none" stroke-width="1.6"/></g>`,
  crate: `<g stroke="#153e49" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M6 16 L24 9 L42 16 L24 23 Z" fill="#d7aa6c"/>
    <path d="M6 16 V35 L24 42 V23 Z" fill="#bb8650"/>
    <path d="M42 16 V35 L24 42 V23 Z" fill="#9c6c3c"/>
    <path d="M6 16 L24 42 M42 16 L24 42 M6 25.5 L24 32.5 L42 25.5" fill="none" stroke-width="1.3" stroke-opacity=".6"/>
    <circle cx="10" cy="20" r=".9" fill="#153e49"/><circle cx="38" cy="20" r=".9" fill="#153e49"/></g>`,
};
Object.assign(CUSTOM, ITEM_ICONS); // [progression-hook] dedicated drawings for placeholder kinds

const norm = k => String(k ?? '').toLowerCase().replace(/[\s_\-]/g, '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BLANK = '<circle cx="24" cy="24" r="8" fill="#ffffff12"/>';
const info = kind => (ITEM_INFO && ITEM_INFO[kind]) || null;

export function itemName(kind) {
  const i = info(kind);
  if (i && (i.name || i.label)) return String(i.name || i.label);
  return String(kind ?? '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, c => c.toUpperCase());
}

/** {href} (an icons.svg symbol URL) or {body} (inline drawing markup) for an item kind; never empty. */
export function iconParts(kind) {
  const n = norm(kind);
  const meta = info(kind);
  // A dedicated drawing beats a borrowed (placeholder) sprite and any guess from the name.
  if (CUSTOM[n] && (meta?.placeholder || !meta?.icon)) return { body: CUSTOM[n] };
  // A borrowed sprite would show the wrong item (water as a barrel): a known placeholder kind without
  // its own drawing gets a blank tile until its 3D icon renders.
  if (meta?.placeholder) return { body: BLANK, blank: true };
  let id = typeof meta?.icon === 'string' ? meta.icon.replace(/^icon-/, '') : null;
  if (!id || !SPRITES.has(id)) id = SPRITE_FOR[n];
  if (id && SPRITES.has(id)) return { href: `${SPRITE_URL}#icon-${id}` };
  if (CUSTOM[n]) return { body: CUSTOM[n] };
  // Unknown kind: a plain crate label with its initials.
  return { body: `<rect x="7" y="9" width="34" height="30" rx="3" fill="#bb8650" stroke="#153e49" stroke-width="2"/>
    <path d="M7 17 H41 M7 31 H41" stroke="#153e49" stroke-width="1.3" stroke-opacity=".55"/>
    <text x="24" y="29" text-anchor="middle" font-family="Segoe UI,system-ui,sans-serif" font-size="13" font-weight="700" fill="#fff2cc" stroke="#153e49" stroke-width=".7">${esc(itemName(kind).replace(/\s+/g, '').slice(0, 2))}</text>` };
}

/** Inline <svg class="sv-icon"> markup for an item kind (or a raw icons.svg symbol id such as 'hammer'). */
export function iconSVG(kind) {
  const p = SPRITES.has(String(kind)) && !info(kind) ? { href: `${SPRITE_URL}#icon-${kind}` } : iconParts(kind);
  const inner = p.href ? `<use href="${p.href}"></use>` : p.body;
  return `<svg class="sv-icon${p.blank ? ' sv-blank' : ''}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${inner}</svg>`;
}
