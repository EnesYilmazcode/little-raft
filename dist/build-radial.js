// Little Raft build radial menu. DOM ES module, nothing happens on import.
// createBuildRadial({items:[{id,label,icon?}], onPick, container?}) ->
//   {element, isOpen, selected, open(), close(), update(stickX, stickY), confirm(), setItems(items), dispose()}
// icon: 'icon-floor' / '#icon-floor' / 'icons.svg#icon-floor' renders from the sprite; any other string is drawn as text (emoji).

const STYLE_ID = 'lrr-style';
const NS = 'http://www.w3.org/2000/svg';
const SIZE = 360, C = SIZE / 2, R_OUT = 168, R_IN = 66, STICK_DEAD = 0.35;
const CSS = `
.lrr{position:fixed;inset:0;z-index:30;display:grid;place-items:center;pointer-events:none;opacity:0;transition:opacity .12s}
.lrr.lrr-open{opacity:1;pointer-events:auto;background:radial-gradient(circle,rgba(10,6,2,.35),rgba(10,6,2,0) 60%)}
.lrr svg{width:min(${SIZE}px,86vmin);height:auto;overflow:visible;filter:drop-shadow(0 10px 24px rgba(0,0,0,.5));
  font:600 13px system-ui,-apple-system,"Segoe UI",sans-serif;user-select:none}
.lrr-sec path{fill:url(#lrr-wood);stroke:#b07a3c;stroke-width:2;transition:fill .08s}
.lrr-sec text{fill:#f3e6cc;text-anchor:middle;dominant-baseline:middle;pointer-events:none}
.lrr-sec .lrr-glyph{font-size:28px}
.lrr-sec use{pointer-events:none}
.lrr-sec{cursor:pointer}
.lrr-sec.lrr-on path{fill:#f0b04a;stroke:#ffe0a6}
.lrr-sec.lrr-on text{fill:#1a1206}
.lrr-hub{fill:rgba(26,16,6,.92);stroke:#b07a3c;stroke-width:2}
.lrr-name{fill:#f0b04a;font-size:15px;text-anchor:middle}
.lrr-hint{fill:#c9b28c;font-size:10.5px;text-anchor:middle;letter-spacing:.04em}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID; s.textContent = CSS;
  document.head.appendChild(s);
}

const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const pt = (r, a) => [C + r * Math.cos(a), C + r * Math.sin(a)];
const TAU = Math.PI * 2, TOP = -Math.PI / 2;

function sectorPath(a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pt(R_OUT, a0), [x1, y1] = pt(R_OUT, a1), [x2, y2] = pt(R_IN, a1), [x3, y3] = pt(R_IN, a0);
  return `M${x0} ${y0}A${R_OUT} ${R_OUT} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${R_IN} ${R_IN} 0 ${large} 0 ${x3} ${y3}Z`;
}

export function createBuildRadial({ items = [], onPick = null, container = null } = {}) {
  ensureStyle();
  const root = document.createElement('div');
  root.className = 'lrr';
  root.setAttribute('role', 'menu');
  root.setAttribute('aria-label', 'Build menu');
  root.setAttribute('aria-hidden', 'true');
  const ring = svg('svg', { viewBox: `0 0 ${SIZE} ${SIZE}` });
  root.appendChild(ring);
  let list = [], secs = [], sel = -1, isOpen = false;
  const name = svg('text', { class: 'lrr-name', x: C, y: C - 4 });
  const hint = svg('text', { class: 'lrr-hint', x: C, y: C + 16 });

  function build() {
    ring.replaceChildren();
    const defs = svg('defs');
    const grad = svg('linearGradient', { id: 'lrr-wood', x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(svg('stop', { offset: 0, 'stop-color': '#7a4e28' }), svg('stop', { offset: 1, 'stop-color': '#4a2e17' }));
    defs.append(grad);
    ring.append(defs);
    const n = Math.max(list.length, 1), step = TAU / n, gap = n > 1 ? 0.012 : 0;
    secs = list.map((it, i) => {
      const mid = TOP + i * step, g = svg('g', { class: 'lrr-sec', role: 'menuitem', 'aria-label': it.label, 'data-id': it.id });
      g.append(n === 1 ? svg('path', { d: `M${C} ${C - R_OUT}A${R_OUT} ${R_OUT} 0 1 1 ${C - 0.01} ${C - R_OUT}Z`, 'fill-rule': 'evenodd' }) : svg('path', { d: sectorPath(mid - step / 2 + gap, mid + step / 2 - gap) }));
      const rMid = (R_IN + R_OUT) / 2 + 4, [x, y] = pt(rMid, mid);
      const ic = it.icon ? String(it.icon) : '';
      if (/^(icon-|#)|\.svg#/.test(ic)) {
        const href = ic.includes('#') ? (ic.startsWith('#') ? 'icons.svg' + ic : ic) : 'icons.svg#' + ic;
        g.append(svg('use', { href, x: x - 16, y: y - 26, width: 32, height: 32 }));
      } else if (ic) {
        const t = svg('text', { class: 'lrr-glyph', x, y: y - 10 }); t.textContent = ic; g.append(t);
      }
      const t = svg('text', { x, y: ic ? y + 18 : y }); t.textContent = it.label; g.append(t);
      g.addEventListener('pointerenter', () => select(i));
      g.addEventListener('click', (e) => { e.stopPropagation(); select(i); confirm(); });
      ring.append(g);
      return g;
    });
    const hub = svg('circle', { class: 'lrr-hub', cx: C, cy: C, r: R_IN - 8 });
    hub.addEventListener('pointerenter', () => select(-1));
    hub.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    ring.append(hub, name, hint);
    select(Math.min(sel, list.length - 1));
  }

  function select(i) {
    sel = i;
    secs.forEach((g, j) => g.classList.toggle('lrr-on', j === i));
    name.textContent = i >= 0 ? list[i].label : 'Build';
    hint.textContent = i >= 0 ? 'Release to place' : 'Tilt stick to choose';
  }

  // Stick in gamepad space (+y is down). Inside the center deadzone the last choice is kept.
  function update(x, y) {
    if (!isOpen || !list.length) return sel;
    if (Math.hypot(x, y) < STICK_DEAD) return sel;
    const step = TAU / list.length;
    const a = ((Math.atan2(y, x) - TOP) % TAU + TAU) % TAU;
    const i = Math.round(a / step) % list.length;
    if (i !== sel) select(i);
    return sel;
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    root.classList.add('lrr-open');
    root.setAttribute('aria-hidden', 'false');
    select(-1);
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    root.classList.remove('lrr-open');
    root.setAttribute('aria-hidden', 'true');
  }
  function confirm() {
    const it = isOpen && sel >= 0 ? list[sel] : null;
    close();
    if (it && onPick) onPick(it);
    return it;
  }
  function setItems(next) { list = (next || []).filter((it) => it && it.id != null); build(); }

  root.addEventListener('click', () => close()); // click outside the ring cancels
  setItems(items);
  (container || document.body).appendChild(root);

  return {
    element: root,
    get isOpen() { return isOpen; },
    get selected() { return sel >= 0 ? list[sel] : null; },
    open, close, update, confirm, setItems,
    dispose() { close(); root.remove(); },
  };
}
