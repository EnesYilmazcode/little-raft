// Pim's Barge trade dialog (DOM only, docs/specs/trader.md §6). One <dialog id="lrTrader">. It reads state through the
// small `api` from trader.js and changes nothing itself: every Trade click becomes ctx.action({kind:'trader.trade'}).
// tick() runs per frame while open; it compares a few numbers and repaints only on change.
import { iconSVG, itemName } from './survival-ui.js?build=v3-survival-ae77fa84ac2b';

const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";
const mmss = s => { const n = Math.max(0, Math.ceil(s)); const m = Math.floor(n / 60), r = n % 60; return m + ':' + (r < 10 ? '0' : '') + r; };

const CSS = `
#lrTrader.lr-tr{padding:0;margin:auto;border:0;border-radius:6px;background:transparent;box-shadow:none;color:#fff2cc;width:min(520px,calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:94vh;overflow:visible;font:500 14px/1.35 ${FONT}}
#lrTrader.lr-tr::backdrop{background:rgba(12,9,5,.42)}
#lrTrader .lr-tr-wrap{display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:6px;outline:none;max-height:calc(94vh - 6px);box-sizing:border-box;overflow:auto;
  background:repeating-linear-gradient(90deg,#00000012 0 2px,transparent 2px 23px),linear-gradient(#b48d55,#8a663a);border:3px solid #3e2a17;box-shadow:0 0 0 2px #d6b67e,0 18px 50px #000a}
#lrTrader .lr-tr-head{display:flex;align-items:center;gap:10px;padding:2px 2px 0}
#lrTrader .lr-tr-hicon{display:grid;place-items:center;flex:0 0 auto;width:40px;height:40px;border-radius:4px;background:#3a2716eb;box-shadow:inset 0 0 0 2px #24170c,inset 0 0 0 3px #b48d5544}
#lrTrader .lr-tr-hicon .sv-icon{width:30px;height:30px;filter:drop-shadow(0 1px 1px #0008)}
#lrTrader .lr-tr-title{margin:0;font:800 19px/1.1 ${FONT};letter-spacing:.2px;color:#2a1b0e;text-shadow:0 1px 0 #d6b67e88}
#lrTrader .lr-tr-sub{display:block;margin-top:2px;font:700 12px/1.2 ${FONT};color:#3e2a17cc}
#lrTrader .lr-tr-x{margin-left:auto;flex:0 0 auto;width:32px;height:32px;padding:0;border:0;border-radius:4px;background:#3a2716eb;color:#fff2cc;font:700 18px/1 ${FONT};box-shadow:inset 0 0 0 1px #d4b07a55;cursor:pointer;transform:none}
#lrTrader .lr-tr-x:hover{box-shadow:inset 0 0 0 1px #ffe3a6}
#lrTrader .lr-tr-list{display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:4px;background:#3a2716eb;box-shadow:inset 0 0 0 2px #24170c,inset 0 0 0 3px #b48d5544}
#lrTrader .lr-tr-row{display:grid;grid-template-columns:minmax(0,1fr) 18px minmax(0,1fr) auto 118px;gap:8px;align-items:center;padding:6px 8px;border-radius:4px;background:linear-gradient(#4a3220,#3d2a19);box-shadow:inset 0 0 0 1px #d4b07a33}
#lrTrader .lr-tr-row.lr-tr-rare{box-shadow:inset 0 0 0 1px #9fe0d6aa,0 0 8px #9fe0d633}
#lrTrader .lr-tr-row.lr-tr-out{opacity:.62}
#lrTrader .lr-tr-side{display:flex;flex-wrap:wrap;gap:4px;min-width:0}
#lrTrader .lr-tr-chip{display:inline-flex;align-items:center;gap:3px;padding:2px 7px 2px 3px;border-radius:12px;background:#24170caa;box-shadow:inset 0 0 0 1px #d4b07a33;font:700 13px/1 ${FONT};color:#fff2cc;white-space:nowrap}
#lrTrader .lr-tr-chip .sv-icon{width:24px;height:24px;filter:drop-shadow(0 1px 1px #0008)}
#lrTrader .lr-tr-chip.lr-tr-short{color:#ffcf9a;box-shadow:inset 0 0 0 1px #ffbd6666}
#lrTrader .lr-tr-arrow{color:#d9c9a6;font:800 15px/1 ${FONT};text-align:center}
#lrTrader .lr-tr-pips{display:flex;gap:3px}
#lrTrader .lr-tr-pips i{width:7px;height:7px;border-radius:50%;background:#ffd27a;box-shadow:0 0 0 1px #2a1b0e}
#lrTrader .lr-tr-pips i.lr-tr-gone{background:#24170c;box-shadow:inset 0 0 0 1px #d4b07a55}
#lrTrader .lr-tr-btn{width:100%;min-height:32px;padding:6px 8px;border:0;border-radius:4px;background:linear-gradient(#7a5631,#5d4026);color:#fff2cc;font:700 12px/1.15 ${FONT};letter-spacing:.2px;text-transform:none;
  box-shadow:inset 0 0 0 1px #d4b07a77,0 1px 0 #0006;cursor:pointer;transform:none}
#lrTrader .lr-tr-btn:hover:not(:disabled){box-shadow:inset 0 0 0 1px #ffe3a6,0 1px 0 #0006;background:linear-gradient(#8a6338,#6a4a2b)}
#lrTrader .lr-tr-btn:disabled{opacity:.55;cursor:default;font-weight:600}
#lrTrader .lr-tr-btn:focus-visible{outline:2px solid #ffe3a6;outline-offset:1px}
#lrTrader .lr-tr-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 2px;font:700 13px/1.2 ${FONT};color:#2a1b0e}
#lrTrader .lr-tr-foot .lr-tr-shells{display:inline-flex;align-items:center;gap:4px}
#lrTrader .lr-tr-foot .sv-icon{width:22px;height:22px}
#lrTrader .lr-tr-hint{font:600 12px/1.2 ${FONT};color:#3e2a17cc}
#lrTrader .lr-tr-hint kbd{display:inline-block;padding:0 4px;border:1px solid #3e2a1788;border-radius:3px;font:inherit}
#lrTrader .lr-tr-empty{margin:4px 2px;color:#d9c9a6;font-size:13px}
@media(max-width:560px){#lrTrader .lr-tr-row{grid-template-columns:minmax(0,1fr) 16px minmax(0,1fr);row-gap:6px}
  #lrTrader .lr-tr-pips{grid-column:1/2}#lrTrader .lr-tr-btn{grid-column:2/4}#lrTrader .lr-tr-hint{display:none}}
@media(prefers-reduced-motion:reduce){#lrTrader *{animation:none!important;transition:none!important}}
`;

function ensureStyle() {
  let st = document.getElementById('lr-tr-style');
  if (!st) { st = document.createElement('style'); st.id = 'lr-tr-style'; document.head.append(st); }
  if (st.textContent !== CSS) st.textContent = CSS;
}

export function createTraderUI(api) {
  ensureStyle();
  document.getElementById('lrTrader')?.remove();
  const esc = s => api.esc(String(s ?? ''));
  const dlg = document.createElement('dialog');
  dlg.id = 'lrTrader'; dlg.className = 'lr-tr';
  dlg.setAttribute('aria-label', 'Pim’s Barge');
  dlg.innerHTML = `<div class="lr-tr-wrap" tabindex="-1">
    <div class="lr-tr-head"><span class="lr-tr-hicon">${iconSVG('shell')}</span><div><h2 class="lr-tr-title"></h2><span class="lr-tr-sub"></span></div>
      <button type="button" class="lr-tr-x" aria-label="Close">✕</button></div>
    <div class="lr-tr-list" role="list"></div>
    <div class="lr-tr-foot"><span class="lr-tr-shells">${iconSVG('shell')}<span class="lr-tr-count"></span></span><span class="lr-tr-hint"><kbd>E</kbd> or <kbd>Esc</kbd> to close</span></div>
  </div>`;
  document.body.append(dlg);
  const $ = s => dlg.querySelector(s);
  const title = $('.lr-tr-title'), sub = $('.lr-tr-sub'), list = $('.lr-tr-list'), count = $('.lr-tr-count');
  title.textContent = 'Pim’s Barge';
  let isOpen = false, rowsSeed = null, rows = [], sig = '';

  const chip = (k, n, short) => `<span class="lr-tr-chip${short ? ' lr-tr-short' : ''}" title="${esc(itemName(k))}">${iconSVG(k)}${esc(n)}</span>`;
  function build() {
    const offers = api.offers();
    rowsSeed = api.visitSeed();
    if (!offers.length) { list.innerHTML = '<p class="lr-tr-empty">Pim has nothing to trade right now.</p>'; rows = []; return; }
    let html = '';
    offers.forEach((o, i) => {
      const gets = o.plan ? `<span class="lr-tr-chip">${iconSVG(o.plan)}Plan</span>` : Object.entries(o.get).map(([k, n]) => chip(k, n)).join('');
      html += `<div class="lr-tr-row${o.rare ? ' lr-tr-rare' : ''}" role="listitem"><span class="lr-tr-side lr-tr-give"></span><span class="lr-tr-arrow" aria-hidden="true">→</span>
        <span class="lr-tr-side lr-tr-get">${gets}</span><span class="lr-tr-pips"></span><button type="button" class="lr-tr-btn" data-i="${i}">Trade</button></div>`;
    });
    list.innerHTML = html;
    rows = [...list.querySelectorAll('.lr-tr-row')].map(el => ({ el, give: el.querySelector('.lr-tr-give'), pips: el.querySelector('.lr-tr-pips'), btn: el.querySelector('button') }));
  }
  function paint() {
    if (api.visitSeed() !== rowsSeed) build();
    const offers = api.offers(), stock = api.stock(), bag = api.bag();
    sub.textContent = 'casts off in ' + mmss(api.left());
    count.textContent = 'Your shells: ' + (bag ? bag.count('shell') : 0);
    for (let i = 0; i < rows.length && i < offers.length; i++) {
      const o = offers[i], r = rows[i], left = stock[i] | 0;
      r.give.innerHTML = Object.entries(o.give).map(([k, n]) => chip(k, n, bag ? bag.count(k) < n : true)).join('');
      let pips = ''; for (let p = 0; p < o.stock; p++) pips += `<i${p < left ? '' : ' class="lr-tr-gone"'}></i>`;
      r.pips.innerHTML = pips; r.pips.title = left + ' left';
      const c = api.check(i);
      r.btn.disabled = !c.ok;
      r.btn.textContent = c.ok ? 'Trade' : c.text;
      r.el.classList.toggle('lr-tr-out', left <= 0);
    }
  }
  function tick() {
    if (!isOpen) return;
    const bag = api.bag();
    const s = api.rev() + '|' + (bag ? bag.version : -1) + '|' + Math.ceil(api.left()) + '|' + api.visitSeed();
    if (s === sig && bag === tick.bag) return;
    sig = s; tick.bag = bag; paint();
  }
  function open() {
    sig = ''; rowsSeed = undefined; paint(); sig = '';
    if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
    isOpen = true; tick();
    try { $('.lr-tr-wrap').focus({ preventScroll: true }); } catch {}
  }
  function close() { if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); onClosed(); } } else onClosed(); }
  function onClosed() {
    if (!isOpen) return;
    isOpen = false;
    if (api.running()) api.requestLock();
  }
  const ac = new AbortController(), on = { signal: ac.signal };
  dlg.addEventListener('close', onClosed, on);
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); }, on);
  dlg.addEventListener('keydown', e => {
    e.stopPropagation();
    if ((e.code === 'KeyE' || e.code === 'Tab') && !e.repeat) { e.preventDefault(); close(); }
  }, on);
  dlg.addEventListener('wheel', e => e.stopPropagation(), { passive: true, signal: ac.signal });
  dlg.addEventListener('click', e => {
    if (e.target === dlg) { close(); return; }
    const t = e.target.closest?.('button'); if (!t) return;
    if (t.classList.contains('lr-tr-x')) { close(); return; }
    if (t.dataset.i !== undefined && !t.disabled) { api.trade(+t.dataset.i); t.blur(); }
  }, on);

  return {
    open, close, tick,
    isOpen: () => isOpen,
    dispose() {
      isOpen = false; ac.abort(); // no onClosed -> no requestLock while the game is disposing
      if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }
      dlg.remove();
    },
  };
}
