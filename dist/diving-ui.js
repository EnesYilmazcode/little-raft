// Little Raft diving HUD: oxygen pill (bottom-centre, just above the hotbar) and a
// hold-to-gather progress ring around the crosshair. Self-contained: injects
// <style id="divingStyle"> (shared, refcounted) + DOM (classes prefixed 'dive', no ids, so
// several live instances never collide; each dispose removes only its own). update() only touches the DOM
// when a quantised (1 %) value or flag actually changes. Nothing runs at import time.

const CIRC = 2 * Math.PI * 19; // gather ring circumference (r = 19)

const CSS = `
.diveO2{position:fixed;left:50%;bottom:130px;transform:translateX(-50%);z-index:3;pointer-events:none;
  display:flex;flex-direction:column;align-items:center;gap:4px;opacity:0;transition:opacity .5s ease 1s;
  font:600 11px/1.2 var(--ui-font,'Segoe UI',system-ui,sans-serif);color:#fff3cf}
.diveO2.on{opacity:1;transition-delay:0s}
.diveO2Pill{display:flex;align-items:center;gap:7px;width:220px;height:20px;padding:0 9px 0 5px;border-radius:12px;
  background:rgba(9,20,30,.72);box-shadow:0 0 0 1px rgba(201,164,107,.45),0 4px 14px rgba(0,0,0,.35)}
.diveO2Pill svg{width:16px;height:16px;flex:none}
.diveO2Track{flex:1;height:7px;border-radius:5px;background:rgba(0,0,0,.5);overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.6)}
.diveO2Fill{height:100%;width:100%;border-radius:5px;transform-origin:left center;
  background:linear-gradient(180deg,#7ff0e6,#2fc1c4 55%,#096b82);transition:transform .15s linear,background .4s}
.diveO2.low .diveO2Fill{background:linear-gradient(180deg,#ffd58a,#f0aa48 55%,#b8772a)}
.diveO2.low .diveO2Pill{animation:divePulse 1.6s ease-in-out infinite}
.diveO2Cap{height:14px;text-shadow:0 1px 2px rgba(0,0,0,.8);letter-spacing:.4px;visibility:hidden}
.diveO2.rising .diveO2Cap{visibility:visible}
@keyframes divePulse{0%,100%{box-shadow:0 0 0 1px rgba(201,164,107,.45),0 4px 14px rgba(0,0,0,.35)}
  50%{box-shadow:0 0 0 1px #ffc96b,0 0 14px rgba(255,190,90,.55)}}
.diveRing{position:fixed;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;z-index:3;pointer-events:none;display:none}
.diveRing.on,.diveRingLabel.on{display:block}
.diveRing circle{fill:none;stroke-width:3.5}
.diveRingBg{stroke:rgba(255,243,207,.25)}
.diveRingFg{stroke:#7ff0e6;stroke-linecap:round;transform:rotate(-90deg);transform-origin:23px 23px;
  filter:drop-shadow(0 0 2px rgba(9,107,130,.9))}
.diveRing.flash{display:block}
.diveRing.flash circle{stroke:#bff3ea;stroke-dashoffset:0}
.diveRingLabel{position:fixed;left:calc(50% + 34px);top:calc(50% + 52px);transform:none;z-index:3;pointer-events:none;display:none;
  color:#fff3cf;white-space:nowrap;text-align:left;text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 8px rgba(0,0,0,.55);
  font:600 13px/1.25 var(--ui-font,'Segoe UI',system-ui,sans-serif)} /* side prompt column (prompts.css), never a centred panel */
@media(max-width:760px){.diveO2{bottom:110px}.diveO2Pill{width:180px}}
@media(prefers-reduced-motion:reduce){.diveO2,.diveO2Fill{transition:none}.diveO2.low .diveO2Pill{animation:none;
  box-shadow:0 0 0 2px #ffc96b,0 4px 14px rgba(0,0,0,.35)}}
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
  o2.innerHTML = `<div class="diveO2Pill" role="meter" aria-label="Oxygen" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">${BUBBLE}<div class="diveO2Track"><div class="diveO2Fill"></div></div></div><div class="diveO2Cap">Out of breath, floating up</div>`;
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
    label.style.left = `calc(${x} + 34px)`; label.style.top = `calc(${y} + 52px)`; // prompt column, under #lrPrompt
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
    if (--st.refs <= 0) { st.el.remove(); styles.delete(doc); }
  }

  return { update, dispose };
}
