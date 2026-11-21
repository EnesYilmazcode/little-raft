// Fisher's journal: pure catch/dish/basket data + a cosy notebook <dialog> panel.
// The Journal class is pure (Node-safe); `document` is only touched inside createJournalPanel.
// API:
//   BASKET_MAX = 40
//   new Journal(snapshot?)            sanitises any junk, never throws
//     .recordCatch({species,cm,stars}) -> { isNew, isRecord, basketed }  (also puts the raw fish in the basket)
//     .recordDish(speciesId, 'cooked'|'burnt') -> { isNew }
//     .addToBasket(item) -> bool     .takeFromBasket(index) -> item|null
//     .totalCaught  .speciesSeen() -> ids[]  .entry(id) -> {count,bestCm,firstAt}|null
//     .basket [{species,cm,stars,state}]   .dishes {"Grilled Pomfret": n}   .snapshot() -> plain JSON
//   createJournalPanel({ getJournal, onClose }) -> { open(), close(), toggle(), isOpen, refresh(), destroy() }
import { SPECIES, RARITY, speciesById, dishName } from './fish-species.js?build=v3-survival-ae77fa84ac2b';

export const BASKET_MAX = 40;
const STATES = ['raw', 'cooked', 'burnt'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const int = (v, lo, hi, d) => Math.floor(num(v, lo, hi, d));
const cm1 = (v) => Math.round(num(v, 0, 1000, 0) * 10) / 10;

function cleanItem(raw) {
  const sp = isObj(raw) && speciesById(raw.species);
  if (!sp) return null; // cm is kept inside the species range so the grill (which checks it) never rejects a basket fish
  return { species: raw.species, cm: Math.round(num(raw.cm, sp.minCm, sp.maxCm, sp.minCm) * 10) / 10, stars: int(raw.stars, 1, 3, 1),
    state: STATES.includes(raw.state) ? raw.state : 'raw' };
}

export class Journal {
  constructor(snapshot) {
    const s = isObj(snapshot) ? snapshot : {};
    this.species = {};
    if (isObj(s.species)) for (const sp of SPECIES) {
      const e = s.species[sp.id];
      if (!isObj(e)) continue;
      const count = int(e.count, 0, 1e9, 0);
      if (count > 0) this.species[sp.id] = { count, bestCm: cm1(e.bestCm), firstAt: int(e.firstAt, 0, 1e15, 0) };
    }
    this.dishes = {};
    if (isObj(s.dishes)) for (const [k, v] of Object.entries(s.dishes)) {
      const n = int(v, 0, 1e9, 0);
      if (typeof k === 'string' && k.length <= 60 && n > 0) this.dishes[k] = n;
    }
    this.basket = (Array.isArray(s.basket) ? s.basket : []).map(cleanItem).filter(Boolean).slice(0, BASKET_MAX);
  }

  recordCatch(c) {
    const item = cleanItem({ ...(isObj(c) ? c : {}), state: 'raw' });
    if (!item) return { isNew: false, isRecord: false, basketed: false };
    const prev = this.species[item.species];
    const isNew = !prev;
    const isRecord = !isNew && item.cm > prev.bestCm;
    if (isNew) this.species[item.species] = { count: 1, bestCm: item.cm, firstAt: Date.now() };
    else { prev.count++; if (isRecord) prev.bestCm = item.cm; }
    return { isNew, isRecord, basketed: this.addToBasket(item) };
  }

  recordDish(speciesId, state = 'cooked') {
    if (!speciesById(speciesId)) return { isNew: false };
    const name = dishName(speciesId, state === 'burnt' ? 'burnt' : 'cooked');
    const isNew = !this.dishes[name];
    this.dishes[name] = (this.dishes[name] || 0) + 1;
    return { isNew };
  }

  addToBasket(item) {
    const it = cleanItem(item);
    if (!it) return false;
    if (this.basket.length >= BASKET_MAX) { // full: a finished dish (already in the cookbook) makes room, raw fish never do
      const i = this.basket.findIndex((b) => b.state !== 'raw');
      if (i < 0) return false;
      this.basket.splice(i, 1);
    }
    this.basket.push(it);
    return true;
  }

  takeFromBasket(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.basket.length) return null;
    return this.basket.splice(index, 1)[0];
  }

  get totalCaught() { return Object.values(this.species).reduce((a, e) => a + e.count, 0); }
  speciesSeen() { return SPECIES.filter((s) => this.species[s.id]).map((s) => s.id); }
  entry(id) { const e = this.species[id]; return e ? { ...e } : null; }

  snapshot() {
    const species = {};
    for (const [k, e] of Object.entries(this.species)) species[k] = { ...e };
    return { species, dishes: { ...this.dishes }, basket: this.basket.map((b) => ({ ...b })) };
  }
}

// ---------------------------------------------------------------- panel (DOM)

const HEX = /^#[0-9a-f]{3,8}$/i;
const col = (c, d) => (typeof c === 'string' && HEX.test(c) ? c : d);
const BODY = {
  disc:    'M14 30 C22 6 70 4 92 30 C70 56 22 54 14 30 Z',
  torpedo: 'M8 30 C24 14 72 12 96 30 C72 46 24 46 8 30 Z',
  long:    'M6 30 C16 20 74 18 98 30 C74 40 16 40 6 30 Z',
  flat:    'M10 32 C26 20 70 18 96 30 C70 42 26 44 10 32 Z',
  deep:    'M12 30 C20 4 72 2 94 30 C72 58 20 56 12 30 Z',
};

/** Inline SVG silhouette (head at right). look=null -> grey unknown fish. */
export function fishSvg(look, uid = 'x') {
  const L = isObj(look) ? look : {};
  const shape = BODY[L.shape] ? L.shape : 'torpedo';
  const body = col(L.body, '#9aa0a3'), belly = col(L.belly, body), fin = col(L.fin, '#7c8285');
  const id = `fcj-${String(uid).replace(/[^a-z0-9-]/gi, '')}`;
  let marks = '';
  if (col(L.stripes)) for (let x = 30; x < 84; x += 9) marks += `<path d="M${x} 12 q4 9 0 14" stroke="${L.stripes}" stroke-width="3" fill="none"/>`;
  if (col(L.bars)) for (let x = 34; x < 82; x += 11) marks += `<rect x="${x}" y="0" width="4" height="60" fill="${L.bars}" opacity=".55"/>`;
  if (col(L.spots)) for (let i = 0; i < 9; i++) marks += `<circle cx="${30 + (i * 23) % 54}" cy="${17 + (i * 7) % 14}" r="1.8" fill="${L.spots}"/>`;
  const extra = (col(L.whiskers) ? `<path d="M95 32 q8 6 14 4 M95 33 q6 10 12 12" stroke="${L.whiskers}" stroke-width="1.4" fill="none"/>` : '')
    + (col(L.finlets) ? [52, 60, 68].map((x) => `<path d="M${x} 16 l3 -4 l2 4 Z M${x} 44 l3 4 l2 -4 Z" fill="${L.finlets}"/>`).join('') : '');
  return `<svg viewBox="0 0 120 60" aria-hidden="true" focusable="false"><defs>`
    + `<linearGradient id="${id}-g" x1="0" y1="0" x2="0" y2="1"><stop offset=".35" stop-color="${body}"/><stop offset=".8" stop-color="${belly}"/></linearGradient>`
    + `<clipPath id="${id}-c"><path d="${BODY[shape]}"/></clipPath></defs>`
    + `<path d="M14 30 L1 15 L5 30 L1 45 Z" fill="${fin}"/><path d="M44 14 Q56 0 70 13 Z M46 46 Q56 56 64 47 Z" fill="${fin}"/>`
    + `<path d="${BODY[shape]}" fill="url(#${id}-g)"/><g clip-path="url(#${id}-c)">${marks}</g>${extra}`
    + `<circle cx="84" cy="26" r="3.2" fill="#fff"/><circle cx="85" cy="26" r="1.7" fill="#1b1b1b"/></svg>`;
}

// Shared slate palette and --ui-font (graphics.css tokens), like the bag, the logbook and the pause panels.
const F = "var(--ui-font,'Segoe UI',system-ui,sans-serif)";
const CSS = `#fcJournal{padding:0;border:0;background:transparent;width:min(880px,96vw);max-height:92vh;color:var(--cream,#f4efe2);font:500 14px/1.35 ${F}}
#fcJournal::backdrop{background:rgba(6,10,12,.42)}
#fcJournal .fj-book{display:flex;flex-direction:column;max-height:92vh;border-radius:10px;background:var(--glass,#11181bf2);box-shadow:var(--frame,inset 0 0 0 1px #ffffff17,0 10px 28px rgba(0,0,0,.45));overflow:hidden}
#fcJournal .fj-head{display:flex;align-items:center;gap:12px;padding:14px 18px 8px;border-bottom:1px solid var(--line,#ffffff17);flex-wrap:wrap}
#fcJournal h2{margin:0;font:800 22px/1 ${F};letter-spacing:-.2px;flex:1;color:var(--cream-hi,#fff6e0)}
#fcJournal .fj-prog{font-weight:700;color:var(--amber,#ffc66e)}
#fcJournal button{font:inherit;cursor:pointer;border:0;border-radius:6px;transition:background .12s;transform:none}
#fcJournal .fj-x{width:34px;height:34px;background:#ffffff0d;color:var(--cream,#f4efe2);font-size:18px;font-weight:700}
#fcJournal .fj-x:hover{background:#ffffff22}
#fcJournal .fj-tabs{display:flex;gap:4px;padding:10px 18px 0}
#fcJournal .fj-tabs button{padding:8px 14px;background:#ffffff0b;box-shadow:inset 0 0 0 1px #ffffff12;color:var(--cream-dim,#f4efe2b3);font-weight:700}
#fcJournal .fj-tabs button[aria-selected=true]{color:var(--cream-hi,#fff6e0);background:linear-gradient(180deg,#46545ad0,#1c2529dc);box-shadow:inset 0 0 0 1px #fff6e0a8}
#fcJournal button:focus-visible{outline:2px solid var(--cream-hi,#fff6e0);outline-offset:2px}
#fcJournal .fj-body{overflow:auto;padding:14px 18px 18px;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#ffffff52 transparent}
#fcJournal .fj-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
#fcJournal .fj-card{background:#ffffff0a;box-shadow:inset 0 0 0 1px var(--line,#ffffff17);border-radius:8px;padding:10px}
#fcJournal .fj-card.fj-unk{opacity:.6}
#fcJournal .fj-card svg{width:100%;height:64px;display:block}
#fcJournal .fj-card h3{margin:4px 0 2px;font:700 15px/1.2 ${F};color:var(--cream-hi,#fff6e0);display:flex;justify-content:space-between;gap:6px;align-items:center}
#fcJournal .fj-chip{font:800 10px/1 ${F};padding:3px 6px;border-radius:9px;color:#1a1206;letter-spacing:.4px;text-transform:uppercase;white-space:nowrap}
#fcJournal .fj-card p{margin:4px 0 0;font-size:12px;color:var(--cream-dim,#f4efe2b3)}
#fcJournal .fj-stats{display:flex;gap:10px;font-size:12px;font-weight:700;color:var(--amber-lt,#ffd98f)}
#fcJournal ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
#fcJournal li{display:flex;justify-content:space-between;gap:10px;padding:7px 10px;background:#ffffff0a;border-radius:6px}
#fcJournal .fj-empty{text-align:center;color:var(--muted,#f4efe280);font-style:italic;padding:24px}
@media(max-width:560px){#fcJournal .fj-grid{grid-template-columns:repeat(2,1fr);gap:8px}#fcJournal .fj-card p{display:none}#fcJournal h2{font-size:18px}}`;

export function createJournalPanel({ getJournal, onClose } = {}) {
  const doc = document;
  if (!doc.getElementById('fc-style-journal')) {
    const st = doc.createElement('style'); st.id = 'fc-style-journal'; st.textContent = CSS; doc.head.appendChild(st);
  }
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const dlg = el('dialog'); dlg.id = 'fcJournal'; dlg.setAttribute('aria-labelledby', 'fcJournalTitle');
  const book = el('div', 'fj-book');
  const head = el('div', 'fj-head'); // not <header>: the game hides `body.playing header`
  const title = el('h2', null, "Fisher's Notebook"); title.id = 'fcJournalTitle';
  const prog = el('span', 'fj-prog');
  const x = el('button', 'fj-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close journal');
  head.append(title, prog, x);
  const tabs = el('div', 'fj-tabs'); tabs.setAttribute('role', 'tablist');
  const body = el('div', 'fj-body'); body.setAttribute('role', 'tabpanel'); body.id = 'fcJournalBody';
  const TABS = [['fish', 'Fish'], ['cook', 'Cookbook'], ['basket', 'Basket']];
  let tab = 'fish';
  const tabBtns = TABS.map(([id, label]) => {
    const b = el('button', null, label); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', body.id);
    b.addEventListener('click', () => { tab = id; refresh(); });
    tabs.appendChild(b); return b;
  });
  book.append(head, tabs, body); dlg.appendChild(book); doc.body.appendChild(dlg);

  const journal = () => { try { const j = getJournal && getJournal(); return j instanceof Journal ? j : new Journal(j); } catch { return new Journal(); } };
  const empty = (t) => el('div', 'fj-empty', t);

  function fishTab(j) {
    const grid = el('div', 'fj-grid');
    for (const s of SPECIES) {
      const e = j.entry(s.id);
      const card = el('div', 'fj-card' + (e ? '' : ' fj-unk'));
      const art = el('div'); art.innerHTML = fishSvg(e ? s.look : null, s.id); // only validated hex colours inside
      const h = el('h3', null, e ? s.name : '???');
      const r = RARITY[s.rarity];
      const chip = el('span', 'fj-chip', e ? r.label : '?'); chip.style.background = e ? r.color : '#cfcfcf';
      h.appendChild(chip);
      card.append(art, h);
      if (e) {
        const stats = el('div', 'fj-stats');
        stats.append(el('span', null, `Caught ×${e.count}`), el('span', null, `Best ${e.bestCm} cm`));
        card.append(stats, el('p', null, s.blurb));
      } else card.append(el('p', null, 'Not caught yet. Keep casting!'));
      card.setAttribute('aria-label', e ? `${s.name}, ${r.label}, caught ${e.count}, best ${e.bestCm} cm` : 'Unknown species');
      grid.appendChild(card);
    }
    return grid;
  }
  function listTab(rows, none) {
    if (!rows.length) return empty(none);
    const ul = el('ul');
    for (const [a, b] of rows) { const li = el('li'); li.append(el('span', null, a), el('b', null, b)); ul.appendChild(li); }
    return ul;
  }

  function refresh() {
    const j = journal();
    prog.textContent = `${j.speciesSeen().length} / ${SPECIES.length} species`;
    tabBtns.forEach((b, i) => { const on = TABS[i][0] === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    let view;
    if (tab === 'fish') view = fishTab(j);
    else if (tab === 'cook') view = listTab(Object.entries(j.dishes).sort((a, b) => b[1] - a[1]).map(([n, c]) => [n, `×${c}`]), 'No dishes yet. Build a grill and cook your catch!');
    else view = listTab(j.basket.map((it) => {
      const s = speciesById(it.species);
      const label = it.state === 'raw' ? `Raw ${s.name}` : dishName(it.species, it.state);
      return [`${label} · ${it.cm} cm`, '★'.repeat(it.stars)];
    }), 'Your basket is empty.');
    body.replaceChildren(view);
  }

  let closing = false;
  function close() {
    if (!dlg.open || closing) return;
    closing = true; dlg.close(); closing = false;
  }
  dlg.addEventListener('close', () => { try { onClose && onClose(); } catch (e) { console.error(e); } });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.code === 'KeyJ' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }); // backdrop click
  x.addEventListener('click', close);

  function open() {
    if (dlg.open) return refresh();
    refresh();
    try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
    tabBtns.find((b) => b.tabIndex === 0)?.focus();
  }
  return {
    open, close, refresh,
    toggle() { dlg.open ? close() : open(); },
    get isOpen() { return dlg.open; },
    destroy() { close(); dlg.remove(); },
  };
}
