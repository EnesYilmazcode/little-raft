// Little Raft item tooltips: one floating card for hotbar/inventory slots, crafting rows and any
// [data-item-kind] element. Read-only view over ITEMS + bag + progression; never mutates anything.
import { ITEMS } from './items.js';

const STYLE_ID = 'item-tooltips-style';
const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";
const CATS = { material: 'Material', refined: 'Refined', tool: 'Tool', station: 'Station', build: 'Building', food: 'Food', decor: 'Decor' };
const CSS = `
.it-tip{position:fixed;left:0;top:0;z-index:2147483000;pointer-events:none;box-sizing:border-box;width:max-content;max-width:min(270px,calc(100vw - 12px));
  padding:8px 10px 9px;border-radius:4px;background:linear-gradient(#2c1d10f5,#24170cf5);border:1px solid #c9a66b;
  box-shadow:0 0 0 1px #3e2a17,0 6px 18px #000a;color:#fff2cc;font:500 13px/1.35 ${FONT};opacity:0;transition:opacity .12s}
.it-tip.it-on{opacity:1}.it-tip[hidden]{display:none}
.it-tip .it-head{display:flex;align-items:center;gap:8px;justify-content:space-between}
.it-tip .it-name{font:700 15px/1.2 ${FONT};color:#fff2cc}
.it-tip .it-cat{flex:none;padding:2px 6px;border-radius:8px;background:#b48d55;color:#2a1b0e;font:700 10px/1.2 ${FONT};letter-spacing:.04em;text-transform:uppercase}
.it-tip .it-cat[data-cat=tool]{background:#9fd6d0}.it-tip .it-cat[data-cat=station]{background:#ffbd66}.it-tip .it-cat[data-cat=food]{background:#8fd36a}
.it-tip .it-meta{margin-top:2px;font:600 12px/1.3 ${FONT};color:#d9c9a6;font-variant-numeric:tabular-nums}
.it-tip .it-meta b{color:#8fd36a;font-weight:700}.it-tip .it-meta b.it-mid{color:#ffbd66}.it-tip .it-meta b.it-low{color:#e06a4a}
.it-tip .it-txt{margin:6px 0 0;color:#eadcbe;white-space:normal}
.it-tip .it-cost{margin-top:6px;padding-top:6px;border-top:1px solid #c9a66b55;font:600 12px/1.45 ${FONT};color:#eadcbe;font-variant-numeric:tabular-nums}
.it-tip .it-cost span{white-space:nowrap}.it-tip .it-cost .it-short{color:#ffab8f}
.it-tip .it-st{display:block;color:#ffcf9a}
.it-tip .it-lock{margin-top:6px;padding:4px 6px;border-radius:3px;background:#5a2a1a99;color:#ffcf9a;font:600 12px/1.3 ${FONT}}
#inventory .sv-tip{display:none!important}
@media(prefers-reduced-motion:reduce){.it-tip{transition:none}}
`;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const title = k => String(k ?? '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const SEL = '.sv-slot[data-index],.sv-slot[data-slot],.sv-recipe[data-recipe],[data-item-kind]';

export function installItemTooltips({ getBag, getProgression, items, root = document } = {}) {
  const table = items || ITEMS || {};
  const doc = root.ownerDocument || root;
  const ac = new AbortController();
  const on = (t, ev, fn, o) => t.addEventListener(ev, fn, { signal: ac.signal, ...o });
  if (!doc.getElementById(STYLE_ID)) {
    const st = doc.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; doc.head.append(st);
  }
  const tip = doc.createElement('div');
  tip.className = 'it-tip'; tip.id = 'it-tip-' + Math.random().toString(36).slice(2, 8);
  tip.setAttribute('role', 'tooltip'); tip.hidden = true;
  let cur = null, px = 0, py = 0, prevDesc = null;

  const call = fn => { try { return fn?.() ?? null; } catch (e) { console.error(e); return null; } };
  const slotsOf = bag => {
    if (!bag) return [];
    if (Array.isArray(bag.slots)) return bag.slots;
    const s = typeof bag.snapshot === 'function' ? call(() => bag.snapshot()) : null;
    return Array.isArray(s?.slots) ? s.slots : [];
  };
  const countOf = (bag, kind) => {
    if (typeof bag?.count === 'function') { const n = call(() => bag.count(kind)); if (n != null) return Number(n) || 0; }
    return slotsOf(bag).reduce((n, s) => n + (s && s.kind === kind ? s.count || 0 : 0), 0);
  };
  const nameOf = k => table[k]?.name || title(k);

  // Element -> { kind, slot } (slot only for bag slots, so live durability/count can be shown).
  function resolve(el) {
    if (el.dataset.itemKind) return { kind: el.dataset.itemKind, slot: null, el };
    if (el.dataset.recipe != null) {
      const id = el.dataset.recipe;
      const kind = table[id] ? id : (Object.values(table).find(it => it?.recipe && it.recipeId === id)?.id ?? id);
      return { kind, slot: null, el, recipe: true };
    }
    const i = Number(el.dataset.index ?? el.dataset.slot);
    const s = Number.isInteger(i) ? slotsOf(call(getBag))[i] : null;
    return s && s.kind && s.count > 0 ? { kind: s.kind, slot: s, el } : null;
  }

  function html({ kind, slot, recipe }) {
    const it = table[kind] || {};
    const bag = call(getBag), prog = call(getProgression);
    const cat = it.category || (it.tool ? 'tool' : '');
    let meta = '';
    if (it.tool && it.durability > 0 && !slot) meta = `Lasts <b>${esc(it.durability)}</b> uses`;
    else if (it.tool && it.durability > 0) {
      const pct = slot && slot.durability != null ? Math.max(0, Math.min(100, Number(slot.durability) || 0)) : 100;
      const uses = Math.round(pct / 100 * it.durability);
      meta = `Durability <b class="${pct > 50 ? '' : pct > 25 ? 'it-mid' : 'it-low'}">${uses}/${it.durability}</b> uses`;
    } else if (it.stack > 0) meta = slot && slot.count > 1 ? `${slot.count} / ${it.stack} in stack` : `Stack ${it.stack}`;
    let out = `<div class="it-head"><span class="it-name">${esc(nameOf(kind))}</span>${cat ? `<span class="it-cat" data-cat="${esc(cat)}">${esc(CATS[cat] || title(cat))}</span>` : ''}</div>`;
    if (meta) out += `<div class="it-meta">${meta}</div>`;
    if (it.tip) out += `<p class="it-txt">${esc(it.tip)}</p>`;
    const r = it.recipe;
    if (r && r.cost && (recipe || !slot)) {
      const parts = Object.entries(r.cost).map(([k, n]) => {
        const have = countOf(bag, k);
        return `<span class="${have < n ? 'it-short' : ''}">${esc(nameOf(k))} ${have}/${n}</span>`;
      });
      const made = r.count > 1 ? ` <span>(makes ${r.count})</span>` : '';
      const st = r.station ? `<span class="it-st">${esc(nameOf(r.station))}${r.time ? ` · ${esc(r.time)}s each` : ''}${r.fuel ? ` · ${esc(r.fuel)} fuel` : ''}</span>` : '';
      out += `<div class="it-cost">${st}Needs ${parts.join(', ') || 'nothing'}${made}</div>`;
    }
    if (prog && typeof prog.isUnlocked === 'function' && call(() => prog.isUnlocked(kind)) === false) {
      const why = call(() => prog.whyLocked?.(kind));
      out += `<div class="it-lock">Locked${why ? ': ' + esc(why) : ''}</div>`;
    }
    return out;
  }

  function place() {
    if (tip.hidden || !cur) return;
    const w = tip.offsetWidth, h = tip.offsetHeight, vw = innerWidth, vh = innerHeight;
    let x = px + 16, y = py + 20;
    if (x + w > vw - 6) x = px - w - 12;
    if (y + h > vh - 6) y = py - h - 12;
    tip.style.transform = `translate(${Math.round(Math.max(6, Math.min(x, vw - w - 6)))}px,${Math.round(Math.max(6, Math.min(y, vh - h - 6)))}px)`;
  }

  function show(el, x, y) {
    const res = resolve(el);
    if (!res) { hide(); return; }
    const host = el.closest('dialog[open]') || doc.body;
    if (tip.parentNode !== host) host.append(tip);
    if (cur && cur.el !== el) restoreDesc();
    if (!cur || cur.el !== el) { prevDesc = el.getAttribute('aria-describedby'); el.setAttribute('aria-describedby', tip.id); }
    cur = res; px = x; py = y;
    tip.innerHTML = html(res);
    tip.hidden = false; place();
    requestAnimationFrame(() => { if (cur) tip.classList.add('it-on'); });
  }
  function restoreDesc() {
    if (!cur) return;
    if (prevDesc) cur.el.setAttribute('aria-describedby', prevDesc); else cur.el.removeAttribute('aria-describedby');
    prevDesc = null;
  }
  function hide() {
    restoreDesc(); cur = null;
    tip.hidden = true; tip.classList.remove('it-on');
  }
  const target = e => e.target?.closest?.(SEL) || null;

  on(root, 'pointerover', e => { const el = target(e); if (el) show(el, e.clientX, e.clientY); else if (cur) hide(); });
  on(root, 'pointerout', e => { if (cur && !cur.el.contains(e.relatedTarget)) hide(); });
  on(root, 'pointermove', e => { if (cur) { px = e.clientX; py = e.clientY; place(); } }, { passive: true });
  on(root, 'pointerdown', () => { if (cur) requestAnimationFrame(refresh); });
  on(root, 'dragstart', hide);
  on(root, 'focusin', e => {
    const el = target(e); if (!el || !el.matches(':focus-visible')) return;
    const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.bottom - 8);
  });
  on(root, 'focusout', () => { if (cur) hide(); });
  on(root, 'close', hide, { capture: true });
  on(doc, 'scroll', () => { if (cur) hide(); }, { capture: true, passive: true });
  on(doc, 'keydown', e => { if (e.key === 'Escape' && cur) hide(); }, { capture: true });
  on(doc.defaultView || window, 'blur', hide);

  // Re-render the open card (e.g. after a craft/move changes counts); hides if the slot emptied.
  function refresh() { if (cur && cur.el.isConnected) show(cur.el, px, py); else if (cur) hide(); }
  return {
    refresh,
    dispose() { hide(); ac.abort(); tip.remove(); if (!doc.querySelector('.it-tip')) doc.getElementById(STYLE_ID)?.remove(); },
  };
}

export default installItemTooltips;
