// Little Raft vitals HUD: Raft-style water / food / health icon bars, no numbers (lower left, above the fish-journal chip and below the
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
#lrVitals{position:fixed;left:16px;bottom:44px;z-index:3;pointer-events:none;display:grid;gap:6px;width:clamp(190px,13vw,250px);box-sizing:border-box;font:700 11px/1 ${FONT};color:#fff}
#lrVitals[hidden]{display:none}
@media(max-width:1100px){#lrVitals{bottom:96px}}
#lrVitals .lv-row{display:grid;grid-template-columns:20px 1fr;align-items:center;gap:8px}
#lrVitals svg{display:block;width:20px;height:20px;filter:drop-shadow(0 1px 1.5px #000b)}
#lrVitals .lv-track{position:relative;height:8px;border-radius:2px;overflow:hidden;background:rgba(0,0,0,.5);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22),0 1px 3px rgba(0,0,0,.3)}
#lrVitals .lv-fill{position:absolute;left:0;top:0;bottom:0;width:100%;transform-origin:0 50%;transition:transform .25s linear;box-shadow:inset 0 1px 0 rgba(255,255,255,.28)}
#lrVitals .lv-hp .lv-fill{background:#c8382f}
#lrVitals .lv-food .lv-fill{background:#d9862b}
#lrVitals .lv-water .lv-fill{background:#3a8fd6}
#lrVitals .lv-low .lv-track{animation:lvPulse .9s ease-in-out infinite}
#lrVitals .lv-low svg{animation:lvIcon .9s ease-in-out infinite}
@keyframes lvPulse{0%,100%{box-shadow:inset 0 0 0 1px rgba(255,255,255,.22),0 1px 3px rgba(0,0,0,.3)}50%{box-shadow:inset 0 0 0 1px #ff5a4a,0 0 7px #ff3b2acc}}
@keyframes lvIcon{50%{transform:scale(1.15)}}
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
@media(max-width:760px){#lrVitals{bottom:108px;width:140px;gap:4px}#lrVitals .lv-row{grid-template-columns:15px 1fr;gap:5px}
  #lrVitals svg{width:15px;height:15px}#lrVitals .lv-track{height:6px}}
@media(prefers-reduced-motion:reduce){#lrVitals .lv-fill{transition:none}#lrVitals .lv-low .lv-track,#lrVitals .lv-low svg,#lrVitalsVignette.on{animation:none}#lrVitalsFlash.hit{animation-duration:.2s}}
`;

const ICONS = {
  hp: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14.2 2.3 8.6A3.4 3.4 0 0 1 8 3.9a3.4 3.4 0 0 1 5.7 4.7Z" fill="#e2483d" stroke="#3e1a12" stroke-width="1.3" stroke-linejoin="round"/><path d="M4.4 5.6c.5-.6 1.2-.8 1.8-.6" fill="none" stroke="#ffd2c4" stroke-width="1.1" stroke-linecap="round"/></svg>`,
  food: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8c2.2-3.3 6.4-4.3 9.6-1.2L14.5 4v8l-3.4-2.8C7.9 12.3 3.7 11.3 1.5 8Z" fill="#f0a04b" stroke="#3e2410" stroke-width="1.2" stroke-linejoin="round"/><circle cx="4.6" cy="7.4" r=".9" fill="#3e2410"/><path d="M7.5 6.3c.6.9.6 2.5 0 3.4" fill="none" stroke="#3e2410" stroke-width=".9" stroke-linecap="round"/></svg>`,
  water: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6C6 4.6 3.6 7.2 3.6 10a4.4 4.4 0 0 0 8.8 0C12.4 7.2 10 4.6 8 1.6Z" fill="#4fa8e6" stroke="#10283e" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.9 10.2c0 1.2.8 2.1 1.9 2.3" fill="none" stroke="#d8f0ff" stroke-width="1.1" stroke-linecap="round"/></svg>`,
};
const LABEL = {hp:'Health', food:'Food', water:'Water'};
const KEYS = ['water', 'food', 'hp']; // Raft order, top to bottom: thirst, hunger, health
const LOW = 10;

export function hpColor(hp) { // green (full) -> amber -> red (empty)
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
  const root = make('lrVitals', KEYS.map(k => `<div class="lv-row lv-${k}" title="${LABEL[k]}" role="meter" aria-label="${LABEL[k]}" aria-valuemin="0" aria-valuemax="100">${ICONS[k]}<span class="lv-track"><span class="lv-fill"></span></span></div>`).join('')); // icons and bars only, no numbers
  root.setAttribute('aria-label', 'Health, food and water'); root.hidden = true;
  const vignette = make('lrVitalsVignette'), flashEl = make('lrVitalsFlash');
  const faintEl = make('lrFaint', '<div>You passed out<small>You wake up back on the raft</small></div>'); faintEl.setAttribute('role', 'status');
  const faintSmall = faintEl.querySelector('small'), faintText = {}; // [bed] [drown] "cause|home" -> cached line
  // The onboarding Notes panel is a top-layer popover that no z-index can cover, so the overlay joins the top layer
  // too (shown later = stacked above). Without popover support it stays a plain z-indexed layer.
  const pop = typeof faintEl.showPopover === 'function'; if (pop) faintEl.popover = 'manual';
  let faintHide = 0;
  const rows = {}, shown = {hp:-1, food:-1, water:-1}, low = {hp:null, food:null, water:null};
  for (const k of KEYS) { const r = root.querySelector('.lv-' + k); rows[k] = {row:r, fill:r.querySelector('.lv-fill')}; }
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
      r.fill.style.transform = `scaleX(${n / 100})`; r.row.setAttribute('aria-valuenow', n); // health stays Raft red; low values pulse instead of shifting hue
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
