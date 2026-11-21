// Sailing HUD: a compass badge (wind, sail heading, north, the nearest island) plus a prompt line.
// Touches the DOM only when quantized values change.
const NS = 'http://www.w3.org/2000/svg';
const DEG = 180 / Math.PI;
const CSS = `
#sailBadge{position:fixed;top:64px;right:16px;z-index:30;display:flex;flex-direction:column;align-items:flex-end;/* compass never shifts with the label width */gap:4px;pointer-events:none;
  color:#f6ecd6;font:600 12px/1.3 var(--ui-font,system-ui,sans-serif);user-select:none}
#sailBadge[hidden],#sailPrompt[hidden]{display:none}
#sailBadge svg{width:84px;height:84px;display:block;border-radius:50%;background:rgba(43,30,18,.7);box-shadow:0 0 0 1.5px rgba(246,236,214,.5),0 4px 14px rgba(43,30,18,.3)}
#sailBadge .sail-label{box-sizing:border-box;min-width:84px;text-align:center;padding:2px 8px;border-radius:8px;background:rgba(43,30,18,.7);box-shadow:0 0 0 1px rgba(246,236,214,.5);white-space:nowrap}
#sailBadge .sail-dim{opacity:.3}
#sailPrompt{position:fixed;left:calc(50% + 22px);top:calc(50% + 84px);text-align:left;padding:3px 10px;border-radius:8px;
  background:rgba(43,30,18,.7);box-shadow:0 0 0 1px rgba(246,236,214,.5);color:#f6ecd6;font:600 13px/1.3 var(--ui-font,system-ui,sans-serif);pointer-events:none;z-index:30;white-space:nowrap}
#sailPrompt kbd{display:inline-block;min-width:1.4em;margin-right:6px;padding:0 4px;border:1px solid rgba(246,236,214,.6);border-radius:4px;font:inherit;text-align:center}
.sail-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
`;
const SVG = '<circle cx="0" cy="0" r="38" fill="none" stroke="rgba(246,236,214,.35)" stroke-width="1.5"/>'
  + '<path d="M0-41V-35M41 0H35M0 41V35M-41 0H-35" stroke="rgba(246,236,214,.45)" stroke-width="1.5"/>'
  + '<text data-k="n" x="0" y="-21" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="700" fill="#f6ecd6" font-family="system-ui,sans-serif">N</text>'
  + '<g data-k="w"><path d="M-3 22Q2 10-2 0T2-18" fill="none" stroke="#9fd8e6" stroke-width="3" stroke-linecap="round"/>'
  + '<path d="M2-27L-5-15L8-16Z" fill="#9fd8e6"/></g>'
  + '<g data-k="s"><path d="M0-36L-6-26H6Z" fill="#ffb355" stroke="#473b26" stroke-width=".8" stroke-linejoin="round"/></g>'
  + '<path d="M0-6L4 5L0 3L-4 5Z" fill="#f6ecd6"/>'
  // Island: an upright round marker (sand hump + palm) moved around the ring like N; drawn last so it sits on
  // top of the sail pointer and the ring ticks.
  + '<g data-k="i" visibility="hidden"><circle r="7.4" fill="#2b1e12" stroke="#e8d29a" stroke-width="1.1"/>'
  + '<path d="M-5.6 4.2Q0-.8 5.6 4.2Z" fill="#e8d29a"/>'
  + '<path d="M.6 2.6Q1.6-.8-.2-3.8" fill="none" stroke="#c79a5e" stroke-width="1.3" stroke-linecap="round"/>'
  + '<path d="M-.2-3.8Q-3-5.6-4.9-3M-.2-3.8Q2.6-5.6 4.6-3M-.2-3.8Q-1-6.6-3-6.2" fill="none" stroke="#86d06c" stroke-width="1.5" stroke-linecap="round"/></g>';

// Beacon mast (story target, mast.js): a small amber lattice tower marker, shown while the receiver tracks it.
const BEACON = '<g data-k="b" visibility="hidden"><circle r="7" fill="#2b1e12" stroke="#ffb347" stroke-width="1.1"/>'
  + '<path d="M-3 4.6L-1.1-2.6H1.1L3 4.6M-2.4 2.2H2.4M-1.6-.4H1.6" fill="none" stroke="#f0c9a0" stroke-width="1.1" stroke-linejoin="round"/>'
  + '<circle cy="-4" r="1.5" fill="#ffb347"/></g>';

export function createSailingUI({ signal } = {}) {
  if (typeof document === 'undefined') return { update() {}, setPrompt() {}, dispose() {} };
  // Hot reload mounts the new engine before disposing the old one, so every instance owns its own <style> and
  // elements, removes only those (by reference) on dispose, and clears stale ids at creation.
  const uid = Math.random().toString(36).slice(2, 10);
  const style = document.createElement('style'); style.dataset.sailingUi = uid; style.textContent = CSS;
  document.head.appendChild(style);
  for (const id of ['sailBadge', 'sailPrompt']) document.getElementById(id)?.remove(); // previous instance's elements

  const badge = document.createElement('div');
  badge.id = 'sailBadge'; badge.hidden = true;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-42 -42 84 84'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.innerHTML = SVG + BEACON;
  const north = svg.querySelector('[data-k="n"]'), wind = svg.querySelector('[data-k="w"]'), sail = svg.querySelector('[data-k="s"]'), isle = svg.querySelector('[data-k="i"]'), beacon = svg.querySelector('[data-k="b"]');
  const label = document.createElement('div'); label.className = 'sail-label'; label.setAttribute('aria-hidden', 'true');
  const live = document.createElement('div'); live.className = 'sail-sr'; live.setAttribute('aria-live', 'polite');
  badge.append(svg, label, live);
  const prompt = document.createElement('div');
  prompt.id = 'sailPrompt'; prompt.hidden = true;
  document.body.append(badge, prompt);

  // Last-written quantized values (NaN forces the first write).
  let qN = NaN, qW = NaN, qWs = NaN, qS = NaN, sDim = null, shown = null, labelText = null, liveState = null, promptHtml = null;
  let qSpeed = NaN, mode = '', qI = NaN, iShown = false, qB = NaN, bShown = false;
  const norm = d => ((d % 360) + 360) % 360;
  // World angle a (direction (sin a, cos a)) -> clockwise screen degrees, 0 = camera forward.
  const toScreen = (a, yaw) => norm(Math.round((Math.PI + yaw - a) * DEG));

  function update(info) {
    if (!info) return;
    const show = !!info.running || document.body.classList.contains('playing');
    if (show !== shown) { shown = show; badge.hidden = !show; }
    if (!show) return;
    const yaw = +info.yaw || 0;
    const n = toScreen(Math.PI, yaw); // north = world -z
    if (n !== qN) { // move the glyph around the ring, keep it upright
      qN = n; const r = n / DEG;
      north.setAttribute('x', (21 * Math.sin(r)).toFixed(1)); north.setAttribute('y', (-21 * Math.cos(r)).toFixed(1));
    }
    const w = toScreen(+info.windDir || 0, yaw);
    const ws = Math.round(Math.min(1, Math.max(0.3, +info.windStr || 0)) * 20) / 20;
    if (w !== qW || ws !== qWs) { qW = w; qWs = ws; wind.setAttribute('transform', 'rotate(' + w + ') scale(' + ws + ')'); }
    const s = toScreen(+info.heading || 0, yaw);
    if (s !== qS) { qS = s; sail.setAttribute('transform', 'rotate(' + s + ')'); }
    // Island marker on the ring: the bearing to the live island (islands.js -> sailing.markIsland).
    const iOn = !!info.islandOn;
    if (iOn !== iShown) { iShown = iOn; isle.setAttribute('visibility', iOn ? 'visible' : 'hidden'); }
    if (iOn) { // moved around the ring, kept upright
      const b = toScreen(+info.islandDir || 0, yaw);
      if (b !== qI) { qI = b; const r = b / DEG; isle.setAttribute('transform', 'translate(' + (30 * Math.sin(r)).toFixed(1) + ' ' + (-30 * Math.cos(r)).toFixed(1) + ')'); }
    }
    const bOn = !!info.beaconOn; // story: the beacon mast's bearing while the receiver tracks it
    if (bOn !== bShown) { bShown = bOn; beacon.setAttribute('visibility', bOn ? 'visible' : 'hidden'); }
    if (bOn) {
      const b = toScreen(+info.beaconDir || 0, yaw);
      if (b !== qB) { qB = b; const r = b / DEG; beacon.setAttribute('transform', 'translate(' + (30 * Math.sin(r)).toFixed(1) + ' ' + (-30 * Math.cos(r)).toFixed(1) + ')'); }
    }
    const hasSail = (info.nSails | 0) > 0;
    const motor = !info.anchored && +info.motor > .01; // engine: a running motor pushes along the heading
    const dim = !motor && (!hasSail || !info.raised || !!info.anchored);
    if (dim !== sDim) { sDim = dim; sail.classList.toggle('sail-dim', dim); }

    const m = motor ? (hasSail && info.raised ? 'sailmotor' : 'motor') : info.anchored ? 'anchor' : !hasSail ? 'none' : info.raised ? 'up' : 'drift'; // the anchor works without a sail
    const sp = Math.round(Math.max(0, +info.speed || 0) * 10);
    if (m !== mode || (sp !== qSpeed && m !== 'none' && m !== 'anchor')) {
      mode = m; qSpeed = sp;
      const t = m === 'none' ? 'No sail — craft one' : m === 'anchor' ? 'Anchored'
        : (m === 'up' ? 'Sail up · ' : m === 'motor' ? 'Motor · ' : m === 'sailmotor' ? 'Sail + motor · ' : 'Drifting · ') + (sp / 10).toFixed(1) + ' m/s';
      if (t !== labelText) { labelText = t; label.textContent = t; }
    }
    // "No sail — craft one" only once a sail is something the player can make (info.sailKnown false hides it).
    const quiet = m === 'none' && info.sailKnown === false;
    if (quiet !== label.hidden) label.hidden = quiet;
    const ls = !hasSail ? '' : info.anchored ? 'Anchor dropped' : info.raised ? 'Sail raised' : 'Sail lowered';
    if (ls !== liveState) { if (liveState !== null && ls) live.textContent = ls; liveState = ls; }
  }

  function setPrompt(html) {
    const h = html || null;
    if (h === promptHtml) return;
    promptHtml = h;
    prompt.innerHTML = h || '';
    prompt.hidden = !h;
  }

  let disposed = false;
  function dispose() {
    if (disposed) return; disposed = true;
    badge.remove(); prompt.remove(); style.remove(); // own references only: never a newer instance's nodes
  }
  if (signal) { if (signal.aborted) dispose(); else signal.addEventListener('abort', dispose, { once: true }); }
  return { update, setPrompt, dispose };
}
