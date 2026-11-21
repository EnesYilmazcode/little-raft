// Driftwood Game Table dialog (DOM only, docs/specs/gametable.md §4). One <dialog id="lrGame">. It reads state through
// the small `api` from gametable.js and never changes the shown board itself: every click becomes api.send({kind:'gt.*'}),
// and the board repaints when the host state arrives. tick() runs per frame; it compares numbers and repaints on change.
import { iconSVG } from './survival-ui.js?build=v3-survival-ae77fa84ac2b';
import { rcSq, SIDE_NAMES } from './gametable-core.js';

const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";
const FILES = 'abcdefgh';
const CELL_NAMES = ['top left', 'top', 'top right', 'left', 'centre', 'right', 'bottom left', 'bottom', 'bottom right'];
const PIECE = { a: 'shell', A: 'shell king', b: 'pebble', B: 'pebble king', x: 'knot', o: 'hoop' };

const CSS = `
#lrGame.lr-gt{padding:0;margin:auto;border:0;border-radius:6px;background:transparent;box-shadow:none;color:#fff2cc;width:min(468px,calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:96vh;overflow:visible;font:500 14px/1.35 ${FONT}}
#lrGame.lr-gt::backdrop{background:rgba(12,9,5,.42)}
#lrGame .lr-gt-wrap{display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:6px;outline:none;max-height:calc(96vh - 6px);box-sizing:border-box;overflow:auto;
  background:repeating-linear-gradient(90deg,#00000012 0 2px,transparent 2px 23px),linear-gradient(#b48d55,#8a663a);border:3px solid #3e2a17;box-shadow:0 0 0 2px #d6b67e,0 18px 50px #000a}
#lrGame .lr-gt-head{display:flex;align-items:center;gap:10px;padding:2px 2px 0}
#lrGame .lr-gt-hicon{display:grid;place-items:center;flex:0 0 auto;width:40px;height:40px;border-radius:4px;background:#3a2716eb;box-shadow:inset 0 0 0 2px #24170c,inset 0 0 0 3px #b48d5544}
#lrGame .lr-gt-hicon .sv-icon{width:30px;height:30px;filter:drop-shadow(0 1px 1px #0008)}
#lrGame .lr-gt-title{margin:0;font:800 19px/1.1 ${FONT};letter-spacing:.2px;color:#2a1b0e;text-shadow:0 1px 0 #d6b67e88}
#lrGame .lr-gt-status{display:block;margin-top:2px;font:700 13px/1.2 ${FONT};color:#3e2a17}
#lrGame .lr-gt-x{margin-left:auto;flex:0 0 auto;width:32px;height:32px;padding:0;border:0;border-radius:4px;background:#3a2716eb;color:#fff2cc;font:700 18px/1 ${FONT};box-shadow:inset 0 0 0 1px #d4b07a55;cursor:pointer;transform:none}
#lrGame .lr-gt-x:hover{box-shadow:inset 0 0 0 1px #ffe3a6}
#lrGame .lr-gt-panel{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:4px;background:#3a2716eb;box-shadow:inset 0 0 0 2px #24170c,inset 0 0 0 3px #b48d5544}
#lrGame .lr-gt-panel[hidden],#lrGame [hidden]{display:none!important}
#lrGame .lr-gt-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
#lrGame .lr-gt-lab{flex:0 0 72px;font:700 12px/1.2 ${FONT};color:#d9c9a6}
#lrGame .lr-gt-btn{min-height:34px;padding:6px 10px;border:0;border-radius:4px;background:linear-gradient(#7a5631,#5d4026);color:#fff2cc;font:700 13px/1.15 ${FONT};letter-spacing:.2px;text-transform:none;
  box-shadow:inset 0 0 0 1px #d4b07a77,0 1px 0 #0006;cursor:pointer;transform:none;transition:background .12s,box-shadow .12s}
#lrGame .lr-gt-btn:hover:not(:disabled){box-shadow:inset 0 0 0 1px #ffe3a6,0 1px 0 #0006;background:linear-gradient(#8a6338,#6a4a2b)}
#lrGame .lr-gt-btn[aria-pressed="true"]{background:linear-gradient(#3f8f8c,#2f6f6c);box-shadow:inset 0 0 0 2px #9fe0d6,0 1px 0 #0006}
#lrGame .lr-gt-btn:disabled{opacity:.5;cursor:default}
#lrGame .lr-gt-btn:focus-visible,#lrGame .lr-gt-x:focus-visible{outline:2px solid #ffe3a6;outline-offset:1px}
#lrGame .lr-gt-start{align-self:flex-end;min-width:110px;background:linear-gradient(#c98a3c,#9c6427)}
#lrGame .lr-gt-boardwrap{display:flex;justify-content:center;padding:8px;border-radius:4px;background:#3a2716eb;box-shadow:inset 0 0 0 2px #24170c,inset 0 0 0 3px #b48d5544}
#lrGame .lr-gt-board{display:grid;gap:0;border:3px solid #24170c;border-radius:3px;box-shadow:0 2px 0 #0006;--sq:min(48px,calc((100vw - 72px) / 8));grid-template-columns:repeat(8,var(--sq))}
#lrGame .lr-gt-board.lr-gt-n{--sq:min(96px,calc((100vw - 72px) / 3));grid-template-columns:repeat(3,var(--sq));gap:4px;padding:4px;background:#d9c08a;border-color:#6e4b2c}
#lrGame .lr-gt-c{position:relative;display:grid;place-items:center;width:var(--sq);height:var(--sq);padding:0;margin:0;border:0;border-radius:0;background:#d8bf94;color:#fff2cc;cursor:default;touch-action:manipulation;transform:none;box-shadow:none}
#lrGame .lr-gt-c.lr-gt-dark{background:#4a3423;cursor:pointer}
#lrGame .lr-gt-n .lr-gt-c{background:#6e4b2c;border-radius:3px;cursor:pointer}
#lrGame .lr-gt-c:focus-visible{outline:3px solid #ffe3a6;outline-offset:-3px;z-index:1}
#lrGame .lr-gt-c.lr-gt-last::after{content:'';position:absolute;inset:3px;border-radius:3px;box-shadow:inset 0 0 0 2px #ffe3a666}
#lrGame .lr-gt-c.lr-gt-to::before{content:'';position:absolute;left:33%;top:33%;width:34%;height:34%;border-radius:50%;background:#9fe0d6aa;box-shadow:0 0 6px #9fe0d6}
#lrGame .lr-gt-c.lr-gt-can{box-shadow:inset 0 0 0 2px #ffbd6688}
#lrGame .lr-gt-c.lr-gt-sel{box-shadow:inset 0 0 0 3px #ffbd66;background:#6a4a2b}
#lrGame .lr-gt-pc{position:absolute;left:50%;top:50%;display:block;width:66%;height:66%;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);transition:transform .12s}
#lrGame .lr-gt-pc.lr-gt-shell{background:radial-gradient(circle at 35% 30%,#fffaf0,#fff2cc 45%,#d9c49a);box-shadow:0 2px 0 #8a7650,inset 0 0 0 2px #e8d6ae}
#lrGame .lr-gt-pc.lr-gt-pebble{background:radial-gradient(circle at 35% 30%,#8a979d,#5d6a70 50%,#3f494e);box-shadow:0 2px 0 #222a2e,inset 0 0 0 2px #6f7c82}
#lrGame .lr-gt-pc.lr-gt-king{box-shadow:0 2px 0 #0007,inset 0 0 0 3px #ffbd66,inset 0 0 0 5px #fff2cc44}
#lrGame .lr-gt-pc.lr-gt-px{width:62%;height:62%;border-radius:0;background:linear-gradient(45deg,transparent 41%,#e0a060 41% 59%,transparent 59%),linear-gradient(-45deg,transparent 41%,#e0a060 41% 59%,transparent 59%);filter:drop-shadow(0 2px 0 #0006)}
#lrGame .lr-gt-pc.lr-gt-o{width:58%;height:58%;box-shadow:inset 0 0 0 calc(var(--sq) * .075) #7fd0cd,0 2px 0 #0006}
#lrGame .lr-gt-c.lr-gt-sel .lr-gt-pc{transform:translate(-50%,-50%) translateY(-2px) scale(1.06)}
#lrGame .lr-gt-foot{display:flex;flex-wrap:nowrap;align-items:center;gap:8px;padding:0 2px;font:700 13px/1.2 ${FONT};color:#2a1b0e}
#lrGame .lr-gt-tally{margin-right:auto}
#lrGame .lr-gt-hint{font:600 12px/1.2 ${FONT};color:#3e2a17cc;white-space:nowrap}
#lrGame .lr-gt-hint kbd{display:inline-block;padding:0 4px;border:1px solid #3e2a1788;border-radius:3px;font:inherit}
@media(max-width:560px){#lrGame.lr-gt{width:calc(100vw - 32px)}#lrGame .lr-gt-wrap{padding:10px;gap:8px}#lrGame .lr-gt-foot{flex-wrap:wrap}#lrGame .lr-gt-hint{display:none}
  #lrGame .lr-gt-btn{min-height:40px}#lrGame .lr-gt-x{width:40px;height:40px}#lrGame .lr-gt-lab{flex-basis:100%}#lrGame .lr-gt-boardwrap{padding:4px}}
@media(prefers-reduced-motion:reduce){#lrGame *,#lrGame *::before,#lrGame *::after{animation:none!important;transition:none!important}}
`;

function ensureStyle() {
  let st = document.getElementById('lr-gt-style');
  if (!st) { st = document.createElement('style'); st.id = 'lr-gt-style'; document.head.append(st); }
  if (st.textContent !== CSS) st.textContent = CSS;
}

export function createGameTableUI(api) {
  ensureStyle();
  document.getElementById('lrGame')?.remove();
  const dlg = document.createElement('dialog');
  dlg.id = 'lrGame'; dlg.className = 'lr-gt';
  dlg.setAttribute('aria-label', 'Driftwood Game Table');
  dlg.innerHTML = `<div class="lr-gt-wrap" tabindex="-1">
    <div class="lr-gt-head"><span class="lr-gt-hicon">${iconSVG('gametable')}</span><div><h2 class="lr-gt-title"></h2><span class="lr-gt-status" aria-live="polite"></span></div>
      <button type="button" class="lr-gt-x" aria-label="Close">✕</button></div>
    <div class="lr-gt-panel lr-gt-setup">
      <div class="lr-gt-row" role="group" aria-label="Game"><span class="lr-gt-lab">Game</span>
        <button type="button" class="lr-gt-btn" data-g="d">Shells &amp; Pebbles</button><button type="button" class="lr-gt-btn" data-g="n">Knots &amp; Hoops</button></div>
      <div class="lr-gt-row" role="group" aria-label="Opponent"><span class="lr-gt-lab">Opponent</span>
        <button type="button" class="lr-gt-btn" data-vs="crew">Crewmate</button><button type="button" class="lr-gt-btn" data-vs="easy">Gull · Easy</button><button type="button" class="lr-gt-btn" data-vs="clever">Gull · Clever</button></div>
      <button type="button" class="lr-gt-btn lr-gt-start">Start</button>
    </div>
    <div class="lr-gt-boardwrap" hidden><div class="lr-gt-board" role="group" aria-label="Board"></div></div>
    <div class="lr-gt-foot"><span class="lr-gt-tally"></span><button type="button" class="lr-gt-btn lr-gt-resign" hidden>Shake hands</button><button type="button" class="lr-gt-btn lr-gt-rematch" hidden>Rematch</button>
      <span class="lr-gt-hint"><kbd>E</kbd> or <kbd>Esc</kbd> to close</span></div>
  </div>`;
  document.body.append(dlg);
  const $ = s => dlg.querySelector(s);
  const wrap = $('.lr-gt-wrap'), status = $('.lr-gt-status'), setup = $('.lr-gt-setup'), boardWrap = $('.lr-gt-boardwrap'), board = $('.lr-gt-board');
  const tallyEl = $('.lr-gt-tally'), resignBtn = $('.lr-gt-resign'), rematchBtn = $('.lr-gt-rematch'), startBtn = $('.lr-gt-start');
  const gBtns = [...dlg.querySelectorAll('[data-g]')], vsBtns = [...dlg.querySelectorAll('[data-vs]')], crewBtn = $('[data-vs="crew"]');
  $('.lr-gt-title').textContent = 'Driftwood Game Table';

  let isOpen = false, sel = -1, cursor = 0, setG = 'd', setVs = 'easy';
  let built = null, builtFlip = false, cells = [], pcs = [], dim = 8;
  let lastN = -1, lastRound = -1, lastG = null;

  const gameNow = () => api.game();
  const sideOf = gm => (gm ? gm.s.indexOf(api.me()) : -1);
  const myTurn = gm => !!gm && gm.w === -1 && gm.s[gm.p] === api.me();
  // screen index -> board square (draughts: -1 on light squares) or cell
  function sqAt(si) {
    if (built === 'n') { const sr = (si / 3) | 0, sc = si % 3; return builtFlip ? sr * 3 + (2 - sc) : (2 - sr) * 3 + sc; }
    const sr = si >> 3, sc = si & 7; return builtFlip ? rcSq(sr, 7 - sc) : rcSq(7 - sr, sc);
  }
  function siOf(sq) { for (let i = 0; i < cells.length; i++) if (sqAt(i) === sq) return i; return 0; }
  function build(g, flip) {
    built = g; builtFlip = flip; dim = g === 'n' ? 3 : 8;
    board.classList.toggle('lr-gt-n', g === 'n');
    let html = '';
    for (let i = 0; i < dim * dim; i++) {
      const sq = sqAt(i), dark = g === 'n' || sq >= 0;
      html += `<button type="button" class="lr-gt-c${g === 'd' && dark ? ' lr-gt-dark' : ''}" data-c="${i}" tabindex="-1"${dark ? '' : ' aria-disabled="true"'}><i class="lr-gt-pc"></i></button>`;
    }
    board.innerHTML = html;
    cells = [...board.querySelectorAll('.lr-gt-c')]; pcs = cells.map(c => c.firstElementChild);
    if (cursor >= cells.length) cursor = 0;
  }
  const setupShown = gm => !gm || gm.w !== -1 || (gm.s.some(s => s !== api.me() && s !== 'ai') && !api.crewOn());
  const ownerWord = (gm, side, mine) => (mine < 0 ? '' : side === mine ? 'your ' : gm.s[side] === 'ai' ? 'gull’s ' : 'crewmate’s ');
  function statusText(gm) {
    if (!gm) return 'Pick a game and an opponent';
    if (gm.w === 2) return 'Calm seas: a draw';
    if (gm.w >= 0) return SIDE_NAMES[gm.g][gm.w] + ' win!';
    const who = gm.s[gm.p], me = api.me();
    if (who === me) return gm.j >= 0 ? 'Keep jumping!' : 'Your turn';
    if (who === 'ai') return 'Gull is thinking…';
    if (gm.s.includes(me)) return api.crewOn() ? 'Crewmate’s turn' : 'Your crewmate left: start a new game';
    return 'Watching';
  }
  function tallyText() {
    const w = api.wins(), me = api.me(), them = me === 'host' ? 'guest' : 'host';
    return 'You ' + (w[me] | 0) + ' · Crewmate ' + (w[them] | 0) + ' · Gull ' + (w.ai | 0);
  }
  function paint() {
    const gm = gameNow(), mine = sideOf(gm), turn = myTurn(gm);
    status.textContent = statusText(gm);
    tallyEl.textContent = tallyText();
    const showSetup = setupShown(gm);
    setup.hidden = !showSetup;
    if (gm && gm.w !== -1 && lastG !== gm.g) setG = gm.g;
    for (const b of gBtns) b.setAttribute('aria-pressed', String(b.dataset.g === setG));
    const crew = api.crewOn();
    crewBtn.disabled = !crew;
    if (!crew && setVs === 'crew') setVs = 'easy';
    for (const b of vsBtns) b.setAttribute('aria-pressed', String(b.dataset.vs === setVs));
    resignBtn.hidden = !(gm && gm.w === -1 && mine >= 0);
    rematchBtn.hidden = !(gm && gm.w !== -1);
    boardWrap.hidden = !gm;
    if (!gm) { lastG = null; return; }
    const flip = mine === 1;
    if (built !== gm.g || builtFlip !== flip) build(gm.g, flip);
    const legal = turn ? api.legal(gm) : [];
    if (gm.j >= 0 && turn) sel = gm.j;
    const can = s => legal.some(m => m.f === s), to = s => sel >= 0 && legal.some(m => m.f === sel && m.t === s);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], pc = pcs[i], sq = sqAt(i);
      c.tabIndex = i === cursor ? 0 : -1;
      if (gm.g === 'd') {
        if (sq < 0) { c.setAttribute('aria-label', FILES[builtFlip ? 7 - (i & 7) : i & 7] + (builtFlip ? (i >> 3) + 1 : 8 - (i >> 3)) + ', light square'); pc.className = 'lr-gt-pc'; continue; }
        const ch = gm.b[sq], r = sq >> 2, col = 2 * (sq & 3) + (1 - (r & 1)), side = ch === 'a' || ch === 'A' ? 0 : ch === 'b' || ch === 'B' ? 1 : -1;
        pc.className = 'lr-gt-pc' + (side === 0 ? ' lr-gt-shell' : side === 1 ? ' lr-gt-pebble' : '') + (ch === 'A' || ch === 'B' ? ' lr-gt-king' : '');
        c.classList.toggle('lr-gt-can', turn && sel < 0 && can(sq));
        c.classList.toggle('lr-gt-sel', turn && sq === sel);
        c.classList.toggle('lr-gt-to', turn && to(sq));
        c.classList.toggle('lr-gt-last', sq === gm.last[0] || sq === gm.last[1]);
        const name = FILES[col] + (r + 1);
        c.setAttribute('aria-label', name + ', ' + (side < 0 ? (to(sq) ? 'empty, move here' : 'empty') : ownerWord(gm, side, mine) + PIECE[ch]));
      } else {
        const ch = gm.b[sq], side = ch === 'x' ? 0 : ch === 'o' ? 1 : -1;
        pc.className = 'lr-gt-pc' + (side === 0 ? ' lr-gt-px' : side === 1 ? ' lr-gt-o' : '');
        c.classList.toggle('lr-gt-to', turn && side < 0);
        c.classList.toggle('lr-gt-last', sq === gm.last[1]);
        c.setAttribute('aria-label', CELL_NAMES[i] + ', ' + (side < 0 ? 'empty' : ownerWord(gm, side, mine) + PIECE[ch]));
      }
    }
    lastG = gm.g;
    // keep focus inside the dialog when the focused control disappeared (setup hidden after Start, etc.)
    const a = document.activeElement;
    if (isOpen && a && dlg.contains(a) && a !== wrap && a.offsetParent === null) focusCursor();
  }
  function focusCursor() { const c = cells[cursor]; try { if (c && !boardWrap.hidden) c.focus({ preventScroll: true }); else wrap.focus({ preventScroll: true }); } catch {} }
  function pickCursor() {
    const gm = gameNow(); if (!gm) { cursor = 0; return; }
    if (built !== gm.g || builtFlip !== (sideOf(gm) === 1)) build(gm.g, sideOf(gm) === 1);
    if (myTurn(gm)) {
      const legal = api.legal(gm);
      if (legal.length) { cursor = gm.g === 'n' ? siOf(legal[0].t) : siOf(gm.j >= 0 ? gm.j : legal[0].f); return; }
    }
    if (gm.g === 'd') { for (let i = 0; i < cells.length; i++) if (sqAt(i) >= 0) { cursor = i; return; } }
    cursor = 0;
  }

  let sRev = NaN, sN = NaN, sSel = NaN, sCur = NaN, sCrew = null, sMe = null;
  function tick() {
    if (!isOpen) return;
    const gm = gameNow(), rev = api.rev(), n = gm ? gm.n : -1, crew = api.crewOn(), me = api.me();
    if (gm && (n !== lastN || gm.round !== lastRound)) { sel = myTurn(gm) && gm.j >= 0 ? gm.j : -1; lastN = n; lastRound = gm.round; }
    else if (!gm) { lastN = -1; sel = -1; }
    if (rev === sRev && n === sN && sel === sSel && cursor === sCur && crew === sCrew && me === sMe) return;
    sRev = rev; sN = n; sSel = sel; sCur = cursor; sCrew = crew; sMe = me;
    paint();
  }
  function forcePaint() { sRev = NaN; tick(); }

  function clickCell(si) {
    const gm = gameNow(); if (!gm || si < 0 || si >= cells.length) return;
    cursor = si;
    const sq = sqAt(si);
    if (sq < 0 || !myTurn(gm)) { forcePaint(); return; }
    if (gm.g === 'n') { if (gm.b[sq] === '.') api.send({ kind: 'gt.move', f: -1, t: sq }); forcePaint(); return; }
    const legal = api.legal(gm);
    if (sel >= 0 && legal.some(m => m.f === sel && m.t === sq)) api.send({ kind: 'gt.move', f: sel, t: sq });
    else if (gm.j >= 0) sel = gm.j;
    else if (legal.some(m => m.f === sq)) sel = sel === sq ? -1 : sq;
    else sel = -1;
    forcePaint();
  }

  function open() {
    sel = -1; lastN = -1; lastRound = -1; lastG = null;
    const gm = gameNow(); if (gm) setG = gm.g;
    pickCursor();
    if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
    isOpen = true; forcePaint();
    try { if (!setup.hidden) startBtn.focus({ preventScroll: true }); else focusCursor(); } catch {}
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
  const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  dlg.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.code === 'KeyE' && !e.repeat) { e.preventDefault(); close(); return; }
    const d = ARROWS[e.key];
    if (d && cells.length && !boardWrap.hidden && (e.target === wrap || e.target.classList?.contains('lr-gt-c'))) {
      e.preventDefault();
      const r = Math.max(0, Math.min(dim - 1, ((cursor / dim) | 0) + d[0])), c = Math.max(0, Math.min(dim - 1, (cursor % dim) + d[1]));
      cursor = r * dim + c; forcePaint(); focusCursor();
    }
  }, on);
  dlg.addEventListener('wheel', e => e.stopPropagation(), { passive: true, signal: ac.signal });
  dlg.addEventListener('click', e => {
    if (e.target === dlg) { close(); return; }
    const t = e.target.closest?.('button'); if (!t || !dlg.contains(t)) return;
    if (t.classList.contains('lr-gt-x')) { close(); return; }
    if (t.dataset.c !== undefined) { clickCell(+t.dataset.c); try { cells[cursor]?.focus({ preventScroll: true }); } catch {} return; }
    if (t.disabled) return;
    if (t.dataset.g) setG = t.dataset.g;
    else if (t.dataset.vs) setVs = t.dataset.vs;
    else if (t === startBtn) api.send({ kind: 'gt.start', g: setG, vs: setVs });
    else if (t === resignBtn) api.send({ kind: 'gt.resign' });
    else if (t === rematchBtn) api.send({ kind: 'gt.rematch' });
    forcePaint();
    if (t.offsetParent === null) { t.blur(); try { wrap.focus({ preventScroll: true }); } catch {} } // keys stay in the dialog
  }, on);

  return {
    open, close, tick,
    isOpen: () => isOpen,
    reset() { sel = -1; lastN = -1; sRev = NaN; },
    dispose() {
      isOpen = false; ac.abort(); // no onClosed -> no requestLock while the game is disposing
      if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }
      dlg.remove();
    },
  };
}
