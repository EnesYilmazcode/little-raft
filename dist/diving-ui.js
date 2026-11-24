// Little Raft diving HUD: oxygen bar (bottom-left, a fourth row on top of the vitals bars) and a
// hold-to-gather progress ring around the crosshair. Self-contained: injects
// <style id="divingStyle"> (shared, refcounted) + DOM (classes prefixed 'dive', no ids, so
// several live instances never collide; each dispose removes only its own). update() only touches the DOM
// when a quantised (1 %) value or flag actually changes. Nothing runs at import time.

const CIRC = 2 * Math.PI * 19; // gather ring circumference (r = 19)

const CSS = `
.diveO2{position:fixed;left:16px;bottom:126px;z-index:3;pointer-events:none;
  display:flex;flex-direction:column-reverse;align-items:flex-start;gap:4px;opacity:0;transition:opacity .5s ease 1s;
  font:600 11px/1.2 var(--ui-font,'Segoe UI',system-ui,sans-serif);color:#fff}
.diveO2.on{opacity:1;transition-delay:0s}
.diveO2Pill{display:grid;grid-template-columns:20px 1fr;align-items:center;gap:8px;width:clamp(190px,13vw,250px)} /* a fourth vitals row (vitals-ui.js) */
.diveO2Pill svg{width:20px;height:20px;flex:none;filter:drop-shadow(0 1px 1.5px #000b)}
.diveO2Track{height:8px;border-radius:2px;background:rgba(0,0,0,.5);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.22),0 1px 3px rgba(0,0,0,.3)}
.diveO2Fill{height:100%;width:100%;transform-origin:left center;
  background:#6fd3e8;transition:transform .15s linear,background .4s}
.diveO2.low .diveO2Fill{background:#e5493a}
.diveO2.low .diveO2Track{animation:divePulse 1.6s ease-in-out infinite}
.diveO2Cap{height:14px;text-shadow:0 1px 2px rgba(0,0,0,.8);letter-spacing:.4px;visibility:hidden}
.diveO2.rising .diveO2Cap{visibility:visible;color:#ffb3a8}
@keyframes divePulse{0%,100%{box-shadow:inset 0 0 0 1px rgba(255,255,255,.22),0 1px 3px rgba(0,0,0,.3)}
  50%{box-shadow:inset 0 0 0 1px #ff6b5a,0 0 8px rgba(255,80,60,.7)}}
.diveRing{position:fixed;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;z-index:3;pointer-events:none;display:none}
.diveRing.on,.diveRingLabel.on{display:block}
.diveRing circle{fill:none;stroke-width:3.5}
.diveRingBg{stroke:rgba(255,243,207,.25)}
.diveRingFg{stroke:#7ff0e6;stroke-linecap:round;transform:rotate(-90deg);transform-origin:23px 23px;
  filter:drop-shadow(0 0 2px rgba(9,107,130,.9))}
.diveRing.flash{display:block}
.diveRing.flash circle{stroke:#bff3ea;stroke-dashoffset:0}
.diveRingLabel{position:fixed;left:50%;top:calc(50% + 34px);transform:translateX(-50%);z-index:3;pointer-events:none;display:none;
  color:#fff3cf;white-space:nowrap;text-align:center;text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 8px rgba(0,0,0,.55);
  font:600 13px/1.25 var(--ui-font,'Segoe UI',system-ui,sans-serif)} /* centred under the ring, like the #lrPrompt rows (prompts.css) */
@media(max-width:1100px){.diveO2{bottom:178px}}
/* While the oxygen row shows, the bottom-left feeds above the vitals lift by its height (html.dive-o2, set in update()). */
html.dive-o2 #coopFeed{bottom:172px}
html.dive-o2 #pickupFeed{bottom:calc(218px + var(--coop-feed-h, 0px))}
@media(max-width:1100px){html.dive-o2 #coopFeed{bottom:224px}html.dive-o2 #pickupFeed{bottom:calc(232px + var(--coop-feed-h, 0px))}}
@media(max-width:1000px){html.dive-o2 #pickupFeed[popover]{inset:auto auto calc(226px + var(--coop-feed-h, 0px)) 10px}}
@media(max-width:760px){html.dive-o2 #coopFeed{bottom:212px}}
@media(max-width:760px){.diveO2{bottom:172px}.diveO2Pill{width:140px;grid-template-columns:15px 1fr;gap:5px}.diveO2Pill svg{width:15px;height:15px}.diveO2Track{height:6px}}
@media(prefers-reduced-motion:reduce){.diveO2,.diveO2Fill{transition:none}.diveO2.low .diveO2Track{animation:none;
  box-shadow:inset 0 0 0 1px #ff6b5a}}
`;

// Original bubble icon: one big bubble with a highlight and two small companions.
const BUBBLE = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="9" r="5" fill="rgba(127,240,230,.25)" stroke="#7ff0e6" stroke-width="1.4"/>
<path d="M4.6 8.2a2.6 2.6 0 0 1 2-2" fill="none" stroke="#fff3cf" stroke-width="1.2" stroke-linecap="round"/>
<circle cx="13" cy="4.5" r="1.8" fill="none" stroke="#7ff0e6" stroke-width="1.1"/><circle cx="10.5" cy="1.8" r="1" fill="#7ff0e6"/></svg>`;

const styles = new WeakMap(); // doc -> { el, refs }

export function createDivingUI(doc = document) {
  let st = styles.get(doc);
  if (!st || !st.el.isConnected) {
    const el = doc.createElement('style');
    el.id = 'divingStyle';
    el.textContent = CSS;
    doc.head.appendChild(el);
    st = { el, refs: st?.refs ?? 0 };
    styles.set(doc, st);
  }
  st.refs++;

  const o2 = doc.createElement('div');
  o2.className = 'diveO2';
  o2.innerHTML = `<div class="diveO2Pill" role="meter" aria-label="Oxygen" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">${BUBBLE}<div class="diveO2Track"><div class="diveO2Fill"></div></div></div><div class="diveO2Cap">Out of air, drowning! Floating up</div>`;
  const ring = doc.createElement('div');
  ring.className = 'diveRing';
  ring.setAttribute('aria-hidden', 'true');
  ring.innerHTML = `<svg viewBox="0 0 46 46" width="46" height="46"><circle class="diveRingBg" cx="23" cy="23" r="19"/><circle class="diveRingFg" cx="23" cy="23" r="19" stroke-dasharray="${CIRC.toFixed(2)}" stroke-dashoffset="${CIRC.toFixed(2)}"/></svg>`;
  const label = doc.createElement('div');
  label.className = 'diveRingLabel';
  label.setAttribute('role', 'status');
  doc.body.append(o2, ring, label);

  const pill = o2.querySelector('.diveO2Pill');
  const fill = o2.querySelector('.diveO2Fill');
  const fg = ring.querySelector('.diveRingFg');
  const last = { show: false, o2: -1, low: false, rising: false, gather: -1, label: '' };
  const win = doc.defaultView;
  let flashTimer = 0, disposed = false;

  // Centre ring + label on the real crosshair (its CSS may be offset); fall back to 50%/50%.
  function place() {
    const r = doc.querySelector('#crosshair')?.getBoundingClientRect();
    const ok = r && r.width > 0;
    const x = ok ? `${r.left + r.width / 2}px` : '50%', y = ok ? `${r.top + r.height / 2}px` : '50%';
    ring.style.left = x; ring.style.top = y;
    label.style.left = x; label.style.top = `calc(${y} + 34px)`; // centred just under the ring (translateX(-50%) in the CSS)
  }
  const onResize = () => { if (last.label) place(); };
  win?.addEventListener('resize', onResize);
  const pct = (v) => Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 100);
  const flag = (el, cls, key, on) => { if (last[key] !== on) { last[key] = on; el.classList.toggle(cls, on); } };

  // completed: true for the one update right after a gather really finished (drives the flash).
  function update({ underwater = false, oxygen01 = 1, gather01 = 0, gatherLabel = '', lowOxygen, rising = false, completed = false } = {}) {
    if (!disposed && !o2.isConnected) doc.body.append(o2, ring, label); // something wiped the DOM: put ours back
    const o = pct(oxygen01);
    if (o !== last.o2) {
      last.o2 = o;
      fill.style.transform = `scaleX(${o / 100})`;
      pill.setAttribute('aria-valuenow', String(o));
    }
    flag(o2, 'on', 'show', !!underwater || o < 100);
    if (last.lift !== last.show) { last.lift = last.show; doc.documentElement?.classList.toggle('dive-o2', last.show); } // feeds clear the oxygen row
    flag(o2, 'low', 'low', !!(lowOxygen ?? o < 25));
    flag(o2, 'rising', 'rising', !!rising);

    const text = gatherLabel ? String(gatherLabel) : '';
    if (text !== last.label) {
      last.label = text;
      label.textContent = text;
      if (text) place();
      ring.classList.toggle('on', !!text);
      label.classList.toggle('on', !!text);
    }
    if (completed) {   // gather completed: brief flash
      ring.classList.add('flash');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => ring.classList.remove('flash'), 150);
    }
    const g = text ? pct(gather01) : 0;
    if (g !== last.gather) {
      last.gather = g;
      fg.setAttribute('stroke-dashoffset', (CIRC * (1 - g / 100)).toFixed(2));
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(flashTimer);
    win?.removeEventListener('resize', onResize);
    for (const el of [o2, ring, label]) el.remove();
    if (last.lift) doc.documentElement?.classList.remove('dive-o2');
    if (--st.refs <= 0) { st.el.remove(); styles.delete(doc); }
  }

  return { update, dispose };
}
