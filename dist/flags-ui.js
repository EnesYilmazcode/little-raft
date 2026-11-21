// Flag designer dialog (DOM only, lazy-loaded by flags.js). One <dialog class="flag-dlg">: live preview, five rows of
// buttons (background, pattern, pattern colour, emblem, emblem colour) and Random / Cancel / Save.
// It never changes game state itself: Save sends exactly one 'flag.set' action and the host validates it again.
// Built with createElement/createElementNS only (no innerHTML). Remembers the last saved design in localStorage.

const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";
const LAST_KEY = 'little-raft-flag-last-v1';
const CSS = `
#lr-flag.flag-dlg{padding:0;margin:auto;border:0;border-radius:6px;background:transparent;box-shadow:none;color:#2a1b0e;width:min(452px,94vw);max-width:94vw;max-height:90vh;overflow:visible;font:500 14px/1.35 ${FONT}}
#lr-flag.flag-dlg::backdrop{background:rgba(12,9,5,.42)}
#lr-flag .flag-wrap{display:flex;flex-direction:column;gap:8px;padding:14px;border-radius:6px;outline:none;box-sizing:border-box;max-height:90vh;overflow:auto;
  background:repeating-linear-gradient(90deg,#00000012 0 2px,transparent 2px 23px),linear-gradient(#b48d55,#8a663a);border:3px solid #3e2a17;box-shadow:0 0 0 2px #d6b67e,0 18px 50px #000a}
#lr-flag .flag-title{margin:0;font:800 19px/1.1 ${FONT};letter-spacing:.2px;color:#2a1b0e;text-shadow:0 1px 0 #d6b67e88}
#lr-flag .flag-stage{display:flex;justify-content:center;padding:10px 8px 12px;border-radius:4px;background:linear-gradient(#9fd6d0,#d8efe6);box-shadow:inset 0 0 0 2px #6b4a2b,inset 0 2px 8px #0003}
#lr-flag .flag-pole{width:6px;border-radius:3px 3px 0 0;background:linear-gradient(90deg,#6b4c30,#a5825a,#6b4c30);margin-right:1px;position:relative}
#lr-flag .flag-pole::before{content:'';position:absolute;top:-7px;left:-3px;width:12px;height:12px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#ffe3a6,#d9b25a 60%,#9a7a35)}
#lr-flag .flag-preview{display:block;width:240px;height:120px;max-width:calc(100% - 16px);height:auto;aspect-ratio:2/1;margin-top:4px;margin-bottom:28px;border-radius:0 3px 3px 0;box-shadow:0 2px 6px #0004}
#lr-flag .flag-row{display:flex;flex-direction:column;gap:4px}
#lr-flag .flag-row[hidden]{display:none}
#lr-flag .flag-label{margin:0;font:700 12px/1.2 ${FONT};letter-spacing:.3px;color:#2a1b0ecc;text-transform:uppercase}
#lr-flag .flag-opts{display:flex;flex-wrap:wrap;gap:5px}
#lr-flag .flag-opt{box-sizing:border-box;min-width:40px;height:40px;padding:0;border:0;border-radius:5px;cursor:pointer;display:grid;place-items:center;
  background:#f4e2bf;box-shadow:inset 0 0 0 1px #6b4a2b88,0 1px 0 #0005;transform:none;text-transform:none}
#lr-flag .flag-opt:hover{box-shadow:inset 0 0 0 2px #fff2cc,0 1px 0 #0005}
#lr-flag .flag-opt:focus-visible{outline:2px solid #fff2cc;outline-offset:2px}
#lr-flag .flag-opt[aria-pressed="true"]{box-shadow:inset 0 0 0 3px #2a1b0e,0 0 0 2px #ffe3a6}
#lr-flag .flag-swatch{width:40px;border-radius:50%}
#lr-flag .flag-pat{width:58px}
#lr-flag .flag-pat canvas{display:block;width:48px;height:24px;border-radius:2px;box-shadow:0 0 0 1px #0003}
#lr-flag .flag-emb{width:40px}
#lr-flag .flag-emb svg{display:block;width:30px;height:30px}
#lr-flag .flag-none{display:block;width:22px;height:22px;border:2px dashed #6b4a2b99;border-radius:4px;box-sizing:border-box}
#lr-flag .flag-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:2px}
#lr-flag .flag-btn{padding:9px 14px;border:0;border-radius:4px;background:linear-gradient(#7a5631,#5d4026);color:#fff2cc;font:700 13px/1 ${FONT};text-transform:none;letter-spacing:.2px;
  box-shadow:inset 0 0 0 1px #d4b07a77,0 1px 0 #0006;cursor:pointer;transform:none;min-height:36px}
#lr-flag .flag-btn:hover{box-shadow:inset 0 0 0 1px #ffe3a6,0 1px 0 #0006;background:linear-gradient(#8a6338,#6a4a2b)}
#lr-flag .flag-btn:focus-visible{outline:2px solid #fff2cc;outline-offset:2px}
#lr-flag .flag-btn.flag-save{background:linear-gradient(#5f8f45,#456c31)}
#lr-flag .flag-btn.flag-random{margin-right:auto}
`;
const SVG = 'http://www.w3.org/2000/svg';
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export function createFlagUI(api) {
  const { ctx, PALETTE, COLOR_NAMES, PATTERNS, EMBLEMS, EMBLEM_PATHS, paintFlag, cleanDesign, DEFAULT } = api;
  let tx = 0, tz = 0, isOpen = false, focusTimer = 0;
  let cur = DEFAULT.slice();

  if (!document.getElementById('flag-ui-css')) {
    const style = document.createElement('style'); style.id = 'flag-ui-css'; style.textContent = CSS; document.head.append(style);
  }
  document.getElementById('lr-flag')?.remove(); // a stale dialog from an earlier game instance
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  const dlg = el('dialog', 'flag-dlg'); dlg.id = 'lr-flag';
  dlg.setAttribute('aria-labelledby', 'lr-flag-title');
  const wrap = el('div', 'flag-wrap'); wrap.tabIndex = -1;
  const title = el('h2', 'flag-title', 'Your flag'); title.id = 'lr-flag-title';
  const stage = el('div', 'flag-stage'), pole = el('div', 'flag-pole');
  const preview = el('canvas', 'flag-preview'); preview.width = 256; preview.height = 128;
  preview.setAttribute('role', 'img'); preview.setAttribute('aria-label', 'Flag preview');
  const pg = preview.getContext('2d');
  stage.append(pole, preview);

  // rows: index into the design array -> buttons
  const rows = [];
  function row(label, idx, count, build) {
    const r = el('div', 'flag-row'), lab = el('p', 'flag-label', label), opts = el('div', 'flag-opts');
    const id = 'lr-flag-row-' + idx; lab.id = id; opts.setAttribute('role', 'group'); opts.setAttribute('aria-labelledby', id);
    const btns = [];
    for (let v = 0; v < count; v++) {
      const b = el('button', 'flag-opt'); b.type = 'button';
      const name = build(b, v);
      b.setAttribute('aria-label', name); b.title = name; b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => { cur[idx] = v; refresh(); });
      btns.push(b); opts.append(b);
    }
    r.append(lab, opts);
    rows[idx] = { r, btns };
    return r;
  }
  const swatch = (b, v) => { b.classList.add('flag-swatch'); b.style.background = PALETTE[v]; return COLOR_NAMES[v]; };
  const patCanvases = [];
  const embPaths = [];
  const bodyRows = [
    row('Background', 0, PALETTE.length, swatch),
    row('Pattern', 1, PATTERNS.length, (b, v) => {
      b.classList.add('flag-pat');
      const c = el('canvas'); c.width = 48; c.height = 24; b.append(c); patCanvases[v] = c.getContext('2d');
      return cap(PATTERNS[v]);
    }),
    row('Pattern colour', 2, PALETTE.length, swatch),
    row('Emblem', 3, EMBLEMS.length, (b, v) => {
      b.classList.add('flag-emb');
      if (v === 0) { b.append(el('span', 'flag-none')); return 'No emblem'; }
      const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', EMBLEM_PATHS[EMBLEMS[v]]); p.setAttribute('fill-rule', 'nonzero');
      svg.append(p); b.append(svg); embPaths[v] = p;
      return cap(EMBLEMS[v]);
    }),
    row('Emblem colour', 4, PALETTE.length, swatch),
  ];
  const btnRow = el('div', 'flag-btns');
  const mk = (label, cls) => { const b = el('button', 'flag-btn ' + cls, label); b.type = 'button'; return b; };
  const randomBtn = mk('Random', 'flag-random'), cancelBtn = mk('Cancel', 'flag-cancel'), saveBtn = mk('Save', 'flag-save');
  btnRow.append(randomBtn, cancelBtn, saveBtn);
  wrap.append(title, stage, ...bodyRows, btnRow); dlg.append(wrap);
  document.body.append(dlg);

  function refresh() {
    try { paintFlag(pg, cur, 256, 128); } catch { /* no 2d context */ }
    for (let i = 0; i < rows.length; i++) {
      const { btns } = rows[i];
      for (let v = 0; v < btns.length; v++) btns[v].setAttribute('aria-pressed', v === cur[i] ? 'true' : 'false');
    }
    for (let v = 0; v < patCanvases.length; v++) { const g = patCanvases[v]; if (g) try { paintFlag(g, [cur[0], v, cur[2], 0, cur[4]], 48, 24); } catch { /* ignore */ } }
    for (let v = 1; v < rows[3].btns.length; v++) { rows[3].btns[v].style.background = PALETTE[cur[0]]; embPaths[v]?.setAttribute('fill', PALETTE[cur[4]]); }
    rows[2].r.hidden = cur[1] === 0;
    rows[4].r.hidden = cur[3] === 0;
  }

  function lastSaved() {
    try {
      const raw = globalThis.localStorage?.getItem(LAST_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      return Array.isArray(v) ? cleanDesign(v) : null;
    } catch { return null; }
  }

  function open(x, z) {
    if (!dlg.open && document.querySelector('dialog[open]')) return false; // never over another dialog
    tx = x; tz = z;
    cur = (api.design(x, z) ?? lastSaved() ?? DEFAULT).slice();
    refresh();
    if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
    isOpen = true;
    try { wrap.focus({ preventScroll: true }); } catch { /* ignore */ }
    // Not synchronous: interact() runs inside the E keydown.
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => { if (isOpen) saveBtn.focus({ preventScroll: true }); }, 0);
    return true;
  }
  function close() { clearTimeout(focusTimer); if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); onClosed(); } } else onClosed(); }
  function onClosed() {
    if (!isOpen) return;
    isOpen = false;
    if (ctx?.running) ctx.requestLock?.();
  }
  dlg.addEventListener('close', onClosed);
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dlg.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });
  dlg.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  saveBtn.addEventListener('click', () => {
    try { globalThis.localStorage?.setItem(LAST_KEY, JSON.stringify(cur)); } catch { /* private mode */ }
    api.send({ kind: 'flag.set', x: tx, z: tz, d: cur.slice() });
    close();
  });
  cancelBtn.addEventListener('click', () => close());
  randomBtn.addEventListener('click', () => {
    const r = n => Math.floor(Math.random() * n), n = PALETTE.length;
    const bg = r(n), other = () => (bg + 1 + r(n - 1)) % n; // contrasting: never the background colour
    cur = [bg, r(PATTERNS.length), other(), 1 + r(EMBLEMS.length - 1), other()];
    refresh();
  });

  return {
    open, close,
    get isOpen() { return isOpen; },
    get tile() { return tx + ',' + tz; },
    destroy() { isOpen = false; close(); dlg.remove(); }, // isOpen=false: no requestLock while the game goes away
  };
}
