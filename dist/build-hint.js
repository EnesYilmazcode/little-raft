// Little Raft - removal hints owned by building.js: a corner key-cap hint while a removal tool is held
// ("[X] Remove" with the hammer, "[Hold click] Dismantle" with the axe) and a thin fill ring around the crosshair
// while the axe takes a piece apart. DOM writes only happen when the shown state changes, never per frame.
const STYLE_ID = 'build-hint-css';
const CSS = `
.bh-hint{position:fixed;right:16px;bottom:24px;z-index:3;display:flex;flex-direction:column;align-items:flex-end;gap:6px;pointer-events:none;
  font:600 13px/1.2 var(--ui-font,system-ui,sans-serif);color:#fff;text-shadow:0 1px 2px #000a;transition:opacity .15s}
.bh-hint[hidden]{display:none}
.bh-row{display:flex;align-items:center;gap:8px;padding:5px 10px 5px 6px;border-radius:8px;background:rgba(0,0,0,.5);box-shadow:0 0 0 1px rgba(255,255,255,.16)}
.bh-key{display:inline-grid;place-items:center;min-width:26px;height:26px;padding:0 6px;box-sizing:border-box;border-radius:6px;
  font:700 13px/1 var(--ui-font,system-ui,sans-serif);color:#fff;background:rgba(0,0,0,.3);text-shadow:none;
  border:1px solid rgba(255,255,255,.85);border-bottom-width:2px;box-shadow:0 1px 3px rgba(0,0,0,.35)}
.bh-key.bh-wide{font-size:11px;letter-spacing:.2px}
.bh-hint.bh-on .bh-key{color:#fff;background:#d8402f;border-color:#ffb3a6;box-shadow:0 1px 3px rgba(0,0,0,.35);transform:translateY(1px)}
.bh-why{max-width:260px;padding:3px 8px;border-radius:6px;background:#3a0f0acc;color:#ffd3c9;font-weight:500;font-size:12px}
.bh-why:empty{display:none}
.bh-ring{position:fixed;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;pointer-events:none;z-index:4;
  background:conic-gradient(#ff6b57 calc(var(--p,0) * 360deg),#ffffff33 0);
  -webkit-mask:radial-gradient(closest-side,transparent calc(100% - 3.5px),#000 calc(100% - 3px));mask:radial-gradient(closest-side,transparent calc(100% - 3.5px),#000 calc(100% - 3px))}
.bh-ring[hidden]{display:none}
@media(max-width:760px){.bh-hint{bottom:96px;right:10px;font-size:12px}} /* above the hotbar, clear of the Notes tracker (top right) */
body.bm-wheel-up .bh-hint{opacity:0}
`;

// mode: '' (hidden) | 'hammer' | 'removing' (X held) | 'axe' | 'chopping'
const ROWS = {
  hammer:['X', 'Remove', false], removing:['X', 'Release to remove', false],
  axe:['Hold click', 'Dismantle', true], chopping:['Hold click', 'Dismantle', true],
};

export function createBuildHint(root = document.body) {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.appendChild(st);
  }
  const box = document.createElement('div');
  box.className = 'bh-hint'; box.hidden = true; box.setAttribute('aria-hidden', 'true');
  box.innerHTML = '<div class="bh-why"></div><div class="bh-row"><span class="bh-key"></span><span class="bh-label"></span></div>';
  const key = box.querySelector('.bh-key'), label = box.querySelector('.bh-label'), whyEl = box.querySelector('.bh-why');
  const ring = document.createElement('div'); ring.className = 'bh-ring'; ring.hidden = true;
  root.appendChild(box); root.appendChild(ring);
  let mode = '', why = '', ringP = -1;

  return {
    // Cheap to call every frame: compares, then touches the DOM only on change.
    set(m, reason = '') {
      m = Object.hasOwn(ROWS, m) ? m : '';
      reason = m === 'removing' || m === 'chopping' ? String(reason || '') : '';
      if (m !== mode) {
        mode = m; box.hidden = !m;
        if (m) { const [k, l, wide] = ROWS[m]; key.textContent = k; key.classList.toggle('bh-wide', wide); label.textContent = l; box.classList.toggle('bh-on', m === 'removing' || m === 'chopping'); }
      }
      if (reason !== why) { why = reason; whyEl.textContent = reason; }
    },
    // p in [0, 1] shows the ring; a negative p hides it. Quantised so the style is written at most ~40 times per fill.
    ring(p) {
      const q = p < 0 ? -1 : Math.round(Math.min(1, p) * 40) / 40;
      if (q === ringP) return;
      ringP = q; ring.hidden = q < 0;
      if (q >= 0) ring.style.setProperty('--p', q);
    },
    get mode() { return mode; },
    dispose() { box.remove(); ring.remove(); },
  };
}
