// Little Raft vitals HUD: health / food / water bars (lower left, above the fish-journal chip and below the
// #lrFeed / #coopFeed event feeds, which sit at bottom:132px (184px on narrow screens) to clear it),
// a red vignette while hunger or thirst drains health, a short red flash on any hit, and the
// "You passed out" overlay. DOM is written only when a rounded value or a state flag changes.
//
//   const ui = createVitalsUI();
//   ui.update(v, show)   // v = {hp, food, water, starving}; show = HUD visible (running, not title)
//   ui.flash()           // one damage flash
//   ui.faint(on, cause, home) // passed-out overlay; cause 'drown'|'shark'|'hunger'|'thirst' adds a line, home: wakes in a bed
//   ui.dispose()

const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";
const CSS = `
#lrVitals{position:fixed;left:12px;bottom:40px;z-index:3;pointer-events:none;display:grid;gap:6px;width:168px;padding:6px 8px 6px 4px;box-sizing:border-box;border-radius:14px;
  background:radial-gradient(ellipse at 40% 50%,#0000003d,transparent 72%);font:700 10px/1 ${FONT};color:#f2e6c8}
#lrVitals[hidden]{display:none}
@media(max-width:1100px){#lrVitals{bottom:96px}}
#lrVitals .lv-row{display:grid;grid-template-columns:22px 1fr auto;align-items:center}
#lrVitals .lv-tab{position:relative;z-index:1;display:grid;place-items:center;width:22px;height:22px;margin-right:-6px;border-radius:50%;box-sizing:border-box;
  background:linear-gradient(180deg,#d6c397,#c4ae80);border:2px solid #5e4426;box-shadow:inset 0 1px 0 #f1e4c088,0 1px 3px #0006}
#lrVitals svg{display:block;width:12px;height:12px}
#lrVitals .lv-track{position:relative;height:12px;border-radius:3px;overflow:hidden;box-sizing:border-box;background:#4a3520;border:2px solid #b89a68;
  box-shadow:0 0 0 1px #5e4426,inset 0 1px 3px #000a,0 2px 4px #0005}
#lrVitals .lv-fill{position:absolute;left:0;top:0;bottom:0;width:100%;transform-origin:0 50%;transition:transform .25s linear;box-shadow:inset 0 -1px 0 #0000002a}
#lrVitals .lv-hp .lv-fill{background:linear-gradient(#d46454,#b0402f)}
#lrVitals .lv-food .lv-fill,#lrVitals .lv-water .lv-fill{background:linear-gradient(#f3e8c8,#dccb9c)}
#lrVitals .lv-num{display:none;padding-left:5px;font:800 11px/1 ${FONT};color:#ffb4a4;text-shadow:0 1px 1px #000,0 0 3px #000c;font-variant-numeric:tabular-nums}
#lrVitals .lv-low .lv-track{animation:lvPulse .9s ease-in-out infinite}
#lrVitals .lv-low .lv-tab{background:linear-gradient(180deg,#eea08a,#cf6a52);border-color:#6e2418}
#lrVitals .lv-low .lv-num{display:block}
@keyframes lvPulse{0%,100%{box-shadow:0 0 0 1px #5e4426,inset 0 1px 3px #000a}50%{box-shadow:0 0 0 1px #ff5a4a,0 0 8px #ff3b2acc}}
#lrVitalsVignette,#lrVitalsFlash{position:fixed;inset:0;pointer-events:none;z-index:2;opacity:0;
  background:radial-gradient(ellipse at center,transparent 45%,rgba(150,10,0,.55) 100%)}
#lrVitalsVignette{transition:opacity .6s ease}
#lrVitalsVignette.on{opacity:1;animation:lvVig 1.6s ease-in-out infinite}
@keyframes lvVig{0%,100%{opacity:.75}50%{opacity:1}}
#lrVitalsFlash{background:radial-gradient(ellipse at center,rgba(200,20,0,.12) 30%,rgba(190,15,0,.6) 100%)}
#lrVitalsFlash.hit{animation:lvHit .45s ease-out}
@keyframes lvHit{from{opacity:1}to{opacity:0}}
#lrFaint{position:fixed;inset:0;z-index:2147482000;pointer-events:none;display:grid;place-items:center;background:#0b0604e6;opacity:0;transition:opacity .5s ease;
  margin:0;border:0;padding:0;width:auto;height:auto;max-width:none;max-height:none;overflow:hidden;color:inherit}
#lrFaint[popover]:not(:popover-open){display:none}
#lrFaint.on{opacity:1;animation:lvFaintIn .5s ease}
@keyframes lvFaintIn{from{opacity:0}}
#lrFaint div{font:700 30px/1.2 ${FONT};color:#f6ecd6;letter-spacing:.04em;text-shadow:0 2px 6px #000}
#lrFaint small{display:block;margin-top:8px;font:500 14px/1.3 ${FONT};letter-spacing:0;opacity:.8;text-align:center}
@media(max-width:760px){#lrVitals{bottom:108px;width:134px;padding:4px 6px 4px 3px;gap:4px}#lrVitals .lv-row{grid-template-columns:18px 1fr auto}
  #lrVitals .lv-tab{width:18px;height:18px;margin-right:-5px;border-width:1.5px}#lrVitals svg{width:10px;height:10px}#lrVitals .lv-track{height:10px;border-width:1.5px}}
@media(prefers-reduced-motion:reduce){#lrVitals .lv-fill{transition:none}#lrVitals .lv-low .lv-track,#lrVitalsVignette.on{animation:none}#lrVitals .lv-low .lv-track{box-shadow:0 0 0 1px #ff5a4a}#lrVitalsFlash.hit{animation-duration:.2s}}
`;

const ICONS = {
  hp: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14.2 2.3 8.6A3.4 3.4 0 0 1 8 3.9a3.4 3.4 0 0 1 5.7 4.7Z" fill="#4a3520"/></svg>`,
  food: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8c2.2-3.3 6.4-4.3 9.6-1.2L14.5 4v8l-3.4-2.8C7.9 12.3 3.7 11.3 1.5 8Z" fill="#4a3520"/><circle cx="4.6" cy="7.4" r="1" fill="#d6c397"/></svg>`,
  water: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6C6 4.6 3.6 7.2 3.6 10a4.4 4.4 0 0 0 8.8 0C12.4 7.2 10 4.6 8 1.6Z" fill="#4a3520"/></svg>`,
};
const LABEL = {hp:'Health', food:'Food', water:'Water'};
const KEYS = ['water', 'food', 'hp']; // top to bottom, as in Raft
const LOW = 10;

export function hpColor(hp) { // legacy green -> red ramp; the HUD now uses a fixed muted red fill
  const t = Math.max(0, Math.min(1, hp / 100)), hue = Math.round(t * 105);
  return `hsl(${hue} 62% ${46 + Math.round((1 - t) * 6)}%)`;
}

// [drown] [bed] faint overlay lines by cause
export const FAINT_LINES = Object.freeze({
  drown: 'You stayed down one breath too long',
  shark: 'Something with too many teeth got the last word',
  hunger: 'Your stomach gave up a little before you did',
  thirst: 'All that water, and not a drop to drink',
});

export function createVitalsUI(doc = document) {
  let style = doc.getElementById('lrVitalsStyle');
  if (!style) { style = doc.createElement('style'); style.id = 'lrVitalsStyle'; doc.head.appendChild(style); }
  if (style.textContent !== CSS) style.textContent = CSS;
  // Fresh nodes per instance: on a hot swap the new engine replaces the old nodes, and the old dispose() only
  // removes its own (already detached) ones.
  const make = (id, html = '') => { doc.getElementById(id)?.remove(); const el = doc.createElement('div'); el.id = id; el.innerHTML = html; doc.body.appendChild(el); return el; };
  const root = make('lrVitals', KEYS.map(k => `<div class="lv-row lv-${k}" title="${LABEL[k]}"><span class="lv-tab">${ICONS[k]}</span><span class="lv-track"><span class="lv-fill"></span></span><span class="lv-num"></span></div>`).join(''));
  root.setAttribute('aria-label', 'Water, food and health'); root.hidden = true;
  const vignette = make('lrVitalsVignette'), flashEl = make('lrVitalsFlash');
  const faintEl = make('lrFaint', '<div>You passed out<small>You wake up back on the raft</small></div>'); faintEl.setAttribute('role', 'status');
  const faintSmall = faintEl.querySelector('small'), faintText = {}; // [bed] [drown] "cause|home" -> cached line
  // The onboarding Notes panel is a top-layer popover that no z-index can cover, so the overlay joins the top layer
  // too (shown later = stacked above). Without popover support it stays a plain z-indexed layer.
  const pop = typeof faintEl.showPopover === 'function'; if (pop) faintEl.popover = 'manual';
  let faintHide = 0;
  const rows = {}, shown = {hp:-1, food:-1, water:-1}, low = {hp:null, food:null, water:null};
  for (const k of KEYS) { const r = root.querySelector('.lv-' + k); rows[k] = {row:r, fill:r.querySelector('.lv-fill'), num:r.querySelector('.lv-num')}; }
  let visible = false, starving = false, fainted = false;

  function update(v, show) {
    show = !!show && !!v;
    if (show !== visible) { visible = show; root.hidden = !show; }
    const st = show && !!v.starving;
    if (st !== starving) { starving = st; vignette.classList.toggle('on', st); }
    if (!show) return;
    for (const k of KEYS) {
      const n = Math.max(0, Math.min(100, Math.ceil(v[k] - 1e-6)));
      if (n === shown[k]) continue;
      shown[k] = n; const r = rows[k];
      r.fill.style.transform = `scaleX(${n / 100})`; r.num.textContent = String(n);
      const isLow = n < LOW; if (isLow !== low[k]) { low[k] = isLow; r.row.classList.toggle('lv-low', isLow); }
    }
  }
  function flash() { flashEl.classList.remove('hit'); void flashEl.offsetWidth; flashEl.classList.add('hit'); }
  function faint(on, cause = null, home = false) {
    on = !!on; if (on === fainted) return; fainted = on;
    if (on && faintSmall) { // [bed] [drown] what got you, and where you will wake
      const k = `${cause}|${home ? 1 : 0}`;
      faintSmall.textContent = faintText[k] ??= (FAINT_LINES[cause] ? FAINT_LINES[cause] + '. ' : '') + (home ? 'You wake up in your bed' : 'You wake up back on the raft');
    }
    if (faintHide) { clearTimeout(faintHide); faintHide = 0; }
    if (pop) try { if (on) { if (faintEl.matches(':popover-open')) faintEl.hidePopover(); faintEl.showPopover(); } else faintHide = setTimeout(() => { faintHide = 0; try { if (!fainted) faintEl.hidePopover(); } catch {} }, 520); } catch {}
    faintEl.classList.toggle('on', on);
  }
  function dispose() { if (faintHide) clearTimeout(faintHide); for (const el of [root, vignette, flashEl, faintEl]) el.remove(); }
  return {update, flash, faint, dispose, get shown() { return {...shown}; }};
}
