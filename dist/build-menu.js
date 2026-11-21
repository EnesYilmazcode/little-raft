// Little Raft build menu: the hammer's radial piece wheel + a small "current piece" HUD chip.
// DOM only (no THREE). createBuildMenu({ pieces, onPick, root }) -> controller (see bottom of file).

const STYLE_ID = 'lr-build-menu-style';
const SPRITE = (() => { try { return new URL('icons.svg', import.meta.url).href; } catch { return 'icons.svg'; } })();
const MAT_SPRITE = { wood: 'wood', leaf: 'leaf', scrap: 'scrap' };
const MAT_NAME = { wood: 'plank', leaf: 'palm leaf', plastic: 'plastic', scrap: 'scrap', rope: 'rope' };

// Original 24x24 line icons (stroke = currentColor).
const ICONS = {
  foundation: '<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M3 9h18M3 13h18M8 5v12M16 5v12" stroke-width="1.2" opacity=".75"/><path d="M2 21c2-1.4 3.5-1.4 5 0s3 1.4 5 0 3.5-1.4 5 0 3 1.4 5 0" stroke-width="1.5"/>',
  floor: '<rect x="2.5" y="6" width="19" height="4.5" rx="1"/><path d="M7.5 6v4.5M12 6v4.5M16.5 6v4.5" stroke-width="1.2" opacity=".75"/><path d="M5 10.5V21M19 10.5V21M5 15.5l14 0" /><path d="M3 21h18" stroke-width="1.4" opacity=".6"/>',
  wall: '<rect x="4" y="3.5" width="16" height="16.5" rx="1"/><path d="M9.3 3.5V20M14.7 3.5V20" stroke-width="1.2" opacity=".75"/><path d="M2.5 21h19" stroke-width="1.4" opacity=".6"/>',
  halfwall: '<rect x="4" y="3.5" width="16" height="7.5" rx="1" stroke-dasharray="2 2.2" stroke-width="1.1" opacity=".4"/><path d="M3 12h18"/><rect x="4" y="12" width="16" height="8"/><path d="M9.3 12v8M14.7 12v8" stroke-width="1.2" opacity=".75"/><path d="M2.5 21h19" stroke-width="1.4" opacity=".6"/>',
  window: '<rect x="4" y="3.5" width="16" height="16.5" rx="1"/><rect x="8" y="7.5" width="8" height="7" rx=".5"/><path d="M12 7.5v7M8 11h8" stroke-width="1.2"/><path d="M7 17.5h10" stroke-width="1.2" opacity=".75"/><path d="M2.5 21h19" stroke-width="1.4" opacity=".6"/>',
  door: '<path d="M4.5 20.5V3.5h15v17"/><path d="M8 20.5V7h8v13.5"/><circle cx="14" cy="14" r=".9" fill="currentColor" stroke="none"/><path d="M2.5 21h19" stroke-width="1.4" opacity=".6"/>',
  pillar: '<rect x="9.5" y="5" width="5" height="14" rx=".6"/><path d="M7 3.5h10M7 20.5h10"/><path d="M9.5 8.5l5 2M9.5 14l5 2" stroke-width="1.2" opacity=".75"/>',
  stairs: '<path d="M3 20.5h4v-4h4v-4h4v-4h4v-4h2"/><path d="M3 20.5h18.5V4.5" stroke-width="1.3" opacity=".55"/>',
  roof: '<path d="M2 15.5L21.5 6v3.4L2 19z"/><path d="M6 13.6v3.6M10 11.6v3.6M14 9.7v3.6M18 7.7v3.6" stroke-width="1.1" opacity=".7"/><path d="M5 18v3M18.5 11v10"/><path d="M3 21h18" stroke-width="1.4" opacity=".6"/>',
};
const FALLBACK_ICON = '<rect x="5" y="5" width="14" height="14" rx="2"/>';

// Wheel geometry (SVG user units; the SVG scales with CSS).
const VB = 200, R_OUT = 192, R_IN = 82, R_ICON = 137, PAD_DEG = 1.4;
const DEAD = 25, CLAMP = 140;

const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";
const CSS = `
.bm-wheel{position:fixed;left:50%;top:50%;z-index:31;width:min(380px,92vw,66vh);aspect-ratio:1;transform:translate(-50%,-50%) scale(.94);
  opacity:0;pointer-events:none;transition:opacity .12s,transform .12s;font:500 13px/1.25 ${FONT};color:#fff2cc;user-select:none;-webkit-user-select:none}
.bm-wheel.bm-open{opacity:1;transform:translate(-50%,-50%);pointer-events:auto}
.bm-wheel>svg{display:block;width:100%;height:100%;overflow:visible;filter:drop-shadow(0 8px 22px #0008)}
.bm-ring{fill:#24170cd9;stroke:#c9a66b;stroke-width:3}
.bm-sec{cursor:pointer;outline:none}
.bm-sec path{fill:#4a3220e6;stroke:#d4b07a40;stroke-width:1.2;transition:fill .08s}
.bm-sec .bm-ic{color:#f3e4c2;transition:color .08s}
.bm-sec .bm-ic svg{overflow:visible}
.bm-sec.bm-cur path{fill:#6a4a2ae6;stroke:#c9a66b99}
.bm-sec.bm-hot path{fill:#b3925a;stroke:#ffe3a6;stroke-width:2.4}
.bm-sec.bm-hot .bm-ic{color:#2a1b0e}
.bm-sec.bm-no .bm-ic{opacity:.5}
.bm-sec.bm-hot.bm-no path{fill:#7a4c37;stroke:#ff9f86}
.bm-sec.bm-hot.bm-no .bm-ic{opacity:.75;color:#ffd9c9}
.bm-hub{fill:#3a2716f2;stroke:#c9a66b;stroke-width:2.5}
.bm-hubin{fill:none;stroke:#b48d5555;stroke-width:1.2}
.bm-pip{fill:#ffbd66;opacity:0;transition:opacity .08s}
.bm-wheel.bm-has .bm-pip{opacity:1}
.bm-mid{position:absolute;left:50%;top:50%;width:36%;transform:translate(-50%,-50%);text-align:center;pointer-events:none}
.bm-mid small{display:block;font:700 9.5px/1 ${FONT};letter-spacing:1.6px;color:#d9c9a6;opacity:.8;text-transform:uppercase}
.bm-mid b{display:block;margin:5px 0 7px;font:700 17px/1.1 ${FONT};color:#fff2cc}
.bm-cost{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 8px}
.bm-req{display:inline-flex;align-items:center;gap:3px;font:700 13px/1 ${FONT};color:#eadcbe;font-variant-numeric:tabular-nums}
.bm-req svg{width:17px;height:17px}
.bm-req em{font-style:normal;font-weight:500;font-size:11px;opacity:.8}
.bm-req.bm-short{color:#ff9f86}
.bm-req.bm-short svg{opacity:.5;filter:grayscale(.7)}
.bm-free{font:600 12px/1 ${FONT};color:#d9c9a6}
.bm-tag{position:absolute;left:50%;top:50%;padding:4px 10px;border-radius:10px;white-space:nowrap;pointer-events:none;background:#24170cf0;border:1.5px solid #ffe3a6;
  color:#fff2cc;font:700 13px/1.2 ${FONT};box-shadow:0 3px 10px #0007;transform:translate(-50%,-50%)}
.bm-tag[hidden]{display:none}
/* the hammer's "Aim at the raft edge" prompt sits under the hub: hide it while the wheel is up */
body.bm-wheel-up #lrPrompt,body.bm-wheel-up #contextPrompt{visibility:hidden}
.bm-chip{position:fixed;left:max(16px,calc(50% - 253px));bottom:var(--bm-chip-bottom,178px);z-index:3;text-align:left;display:flex;align-items:center;gap:10px;
  padding:7px 14px 7px 7px;border-radius:12px;pointer-events:none;max-width:calc(100vw - 32px);
  background:repeating-linear-gradient(90deg,#0000000f 0 2px,transparent 2px 21px),linear-gradient(#5d4129f0,#3d2a19f0);
  border:1.5px solid #c9a66b;box-shadow:0 0 0 1.5px #3e2a17,0 4px 14px #0006;color:#fff2cc;font:500 13px/1.25 ${FONT};transition:opacity .12s}
.bm-chip.bm-dim{opacity:0}
.bm-chip>i{flex:0 0 auto;display:grid;place-items:center;width:38px;height:38px;border-radius:8px;background:#24170caa;box-shadow:inset 0 0 0 1px #d4b07a44;color:#ffe3a6}
.bm-chip>i svg{width:26px;height:26px}
.bm-chip>div{min-width:0}
.bm-row{display:flex;align-items:center;gap:10px}
.bm-row b{font:700 14px/1.1 ${FONT};white-space:nowrap}
.bm-hint{display:block;margin-top:3px;font:500 11px/1.2 ${FONT};color:#d9c9a6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bm-hint kbd{font:700 10px/1 ${FONT};color:#ffdd95;border:1px solid #e0bd7155;border-radius:3px;padding:1px 3px}
.bm-status{display:block;margin-top:3px;font:700 12px/1.2 ${FONT};color:#ffab8f}
.bm-status:empty{display:none}
@media(max-width:760px){.bm-chip{--bm-chip-bottom:118px;gap:8px;padding:5px 10px 5px 5px}.bm-chip>i{width:32px;height:32px}.bm-chip>i svg{width:22px;height:22px}
  .bm-mid b{font-size:14px;margin:3px 0 5px}.bm-req{font-size:12px}.bm-req em{display:none}.bm-mid small{font-size:8.5px}}
@media(prefers-reduced-motion:reduce){.bm-wheel{transition:none}}`;

const NS = 'http://www.w3.org/2000/svg';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const iconSvg = (id, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id] || FALLBACK_ICON}</svg>`;
const pt = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`; };
function sectorPath(a0, a1) {
  const big = a1 - a0 > 180 ? 1 : 0;
  return `M${pt(R_OUT, a0)}A${R_OUT} ${R_OUT} 0 ${big} 1 ${pt(R_OUT, a1)}L${pt(R_IN, a1)}A${R_IN} ${R_IN} 0 ${big} 0 ${pt(R_IN, a0)}Z`;
}

export function createBuildMenu({ pieces, onPick, root = document.body } = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.appendChild(st);
  }
  const list = (pieces || []).map(p => ({ id: String(p.id), name: String(p.name ?? p.id), cost: p.cost || {} }));
  const n = Math.max(1, list.length), step = 360 / n;
  const byId = new Map(list.map((p, i) => [p.id, i]));
  let canAfford = () => true, selected = byId.has('foundation') ? 'foundation' : (list[0]?.id ?? null);
  let open = false, hot = -1, vx = 0, vy = 0, cx = 0, cy = 0, scale = 1;

  const costHtml = cost => {
    const ks = Object.keys(cost).filter(k => cost[k] > 0);
    if (!ks.length) return '<span class="bm-free">Free</span>';
    const ok = canAfford(cost);
    return ks.map(k => `<span class="bm-req${ok ? '' : ' bm-short'}">${MAT_SPRITE[k]
      ? `<svg viewBox="0 0 48 48" aria-hidden="true"><use href="${SPRITE}#icon-${MAT_SPRITE[k]}"/></svg>` : ''}${cost[k]}<em>${esc(MAT_NAME[k] || k)}</em></span>`).join('');
  };

  // ---- wheel ----
  const wheel = document.createElement('div');
  wheel.className = 'bm-wheel'; wheel.setAttribute('role', 'menu'); wheel.setAttribute('aria-label', 'Building pieces'); wheel.hidden = true;
  wheel.innerHTML = `<svg viewBox="${-VB} ${-VB} ${VB * 2} ${VB * 2}"><circle class="bm-ring" r="${R_OUT + 5}"/>${list.map((p, i) => {
    const a0 = i * step - step / 2 + PAD_DEG / 2, a1 = i * step + step / 2 - PAD_DEG / 2;
    const [ix, iy] = pt(R_ICON, i * step).split(' ');
    return `<g class="bm-sec" role="menuitem" tabindex="-1" aria-label="${esc(p.name)}" data-i="${i}"><path d="${sectorPath(a0, a1)}"/>` +
      `<g class="bm-ic" transform="translate(${(ix - 22).toFixed(2)} ${(iy - 22).toFixed(2)})">${iconSvg(p.id, 44)}</g></g>`;
  }).join('')}<circle class="bm-hub" r="${R_IN - 6}"/><circle class="bm-hubin" r="${R_IN - 12}"/>` +
    `<g class="bm-pipg"><path class="bm-pip" d="M-7 ${-(R_IN - 1)}L0 ${-(R_IN + 7)}L7 ${-(R_IN - 1)}Z"/></g></svg>` +
    `<div class="bm-mid" aria-live="polite"><small>Selected</small><b></b><div class="bm-cost"></div></div><span class="bm-tag" aria-hidden="true" hidden></span>`;
  const secs = [...wheel.querySelectorAll('.bm-sec')];
  const pipG = wheel.querySelector('.bm-pipg');
  const tag = wheel.querySelector('.bm-tag');
  const midLabel = wheel.querySelector('.bm-mid small'), midName = wheel.querySelector('.bm-mid b'), midCost = wheel.querySelector('.bm-cost');
  root.appendChild(wheel);

  // ---- chip ----
  const chip = document.createElement('div');
  chip.className = 'bm-chip'; chip.hidden = true; chip.setAttribute('role', 'status');
  chip.innerHTML = '<i></i><div><span class="bm-row"><b></b><span class="bm-cost"></span></span>' +
    '<span class="bm-hint"><kbd>Right-click</kbd> pieces · <kbd>R</kbd> rotate · <kbd>X</kbd> remove</span><span class="bm-status"></span></div>';
  const chipIcon = chip.querySelector('i'), chipName = chip.querySelector('b'), chipCost = chip.querySelector('.bm-cost'), chipStatus = chip.querySelector('.bm-status');
  root.appendChild(chip);
  let chipShown = false, chipText = '';

  function renderChip() {
    const p = list[byId.get(selected)];
    if (!p) return;
    chipIcon.innerHTML = iconSvg(p.id, 26); chipName.textContent = p.name; chipCost.innerHTML = costHtml(p.cost);
  }
  function renderMid() {
    const i = hot >= 0 ? hot : byId.get(selected) ?? -1, p = list[i];
    midLabel.textContent = hot >= 0 ? (canAfford(p.cost) ? 'Build' : 'Need more') : 'Selected';
    midName.textContent = p ? p.name : '';
    midCost.innerHTML = p ? costHtml(p.cost) : '';
  }
  function setHot(i) {
    if (i === hot) return;
    if (hot >= 0) secs[hot].classList.remove('bm-hot');
    hot = i;
    if (hot >= 0) { secs[hot].classList.add('bm-hot'); pipG.setAttribute('transform', `rotate(${hot * step})`); }
    placeTag();
    wheel.classList.toggle('bm-has', hot >= 0);
    renderMid();
  }
  // Name tag just outside the ring at the hovered sector (the icons alone do not say what they are).
  function placeTag() {
    tag.hidden = hot < 0; if (hot < 0) return;
    const [x, y] = pt(R_OUT + 26, hot * step).split(' ').map(Number);
    tag.textContent = list[hot].name;
    tag.style.left = `${50 + x / (VB * 2) * 100}%`; tag.style.top = `${50 + y / (VB * 2) * 100}%`;
  }
  // Sector from an offset (screen px, y down). Dead zone -> -1.
  function pickAt(dx, dy, dead) {
    if (dx * dx + dy * dy < dead * dead) return -1;
    const deg = Math.atan2(dy, dx) * 180 / Math.PI + 90 + step / 2;
    return Math.floor(((deg % 360) + 360) % 360 / step) % n;
  }
  function measure() {
    const r = wheel.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2; scale = r.width / (VB * 2) || 1;
  }
  function refreshAfford() {
    for (let i = 0; i < n; i++) {
      secs[i].classList.toggle('bm-no', !canAfford(list[i].cost));
      secs[i].classList.toggle('bm-cur', list[i].id === selected);
    }
  }

  const onClick = e => {
    const g = e.target.closest?.('.bm-sec'); if (!g || !open) return;
    e.preventDefault(); e.stopPropagation();
    setHot(+g.dataset.i); api.close(true);
  };
  const onCtx = e => { if (open) e.preventDefault(); };
  const onResize = () => { if (open) measure(); };
  wheel.addEventListener('click', onClick);
  wheel.addEventListener('contextmenu', onCtx);
  addEventListener('resize', onResize);

  const api = {
    open() {
      if (open || !list.length) return;
      open = true; vx = vy = 0; wheel.hidden = false;
      refreshAfford(); setHot(-1); renderMid(); chip.classList.add('bm-dim'); document.body.classList.add('bm-wheel-up');
      void wheel.offsetWidth; wheel.classList.add('bm-open'); measure();
    },
    move(dx, dy) {
      if (!open) return;
      vx += dx; vy += dy;
      const d2 = vx * vx + vy * vy;
      if (d2 > CLAMP * CLAMP) { const k = CLAMP / Math.sqrt(d2); vx *= k; vy *= k; }
      setHot(pickAt(vx, vy, DEAD));
    },
    hoverAt(x, y) {
      if (!open) return;
      const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy, ro = (R_OUT + 40) * scale;
      if (d2 > ro * ro) return; // far outside: keep last highlight
      setHot(pickAt(dx, dy, Math.max(DEAD, (R_IN - 6) * scale)));
    },
    close(confirm = true) {
      if (!open) return;
      open = false; wheel.classList.remove('bm-open'); wheel.hidden = true; chip.classList.remove('bm-dim'); document.body.classList.remove('bm-wheel-up');
      const i = hot; setHot(-1);
      if (confirm && i >= 0) { selected = list[i].id; renderChip(); onPick?.(selected); }
    },
    get isOpen() { return open; },
    get selected() { return selected; },
    setSelected(id) { if (byId.has(id) && id !== selected) { selected = id; renderChip(); if (open) { refreshAfford(); renderMid(); } } },
    setAfford(fn) { canAfford = typeof fn === 'function' ? fn : () => true; api.refresh(); },
    refresh() { if (chipShown) renderChip(); if (open) { refreshAfford(); renderMid(); } },
    setVisible(v) { v = !!v; if (v === chipShown) return; chipShown = v; chip.hidden = !v; if (v) renderChip(); },
    setChip(text) { text = text ? String(text) : ''; if (text !== chipText) { chipText = text; chipStatus.textContent = text; } },
    dispose() {
      wheel.removeEventListener('click', onClick); wheel.removeEventListener('contextmenu', onCtx);
      removeEventListener('resize', onResize); wheel.remove(); chip.remove(); open = false; document.body.classList.remove('bm-wheel-up');
    },
  };
  renderChip();
  return api;
}
