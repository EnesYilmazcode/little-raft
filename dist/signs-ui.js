// Signboard dialog (DOM only, lazy-loaded by decor-pack.js). One <dialog id="lr-sign">, three text
// inputs, Save / Turn / Cancel. It never changes state itself: Save sends one 'decor.write' action and
// Turn sends 'decor.turn'; the host cleans the text again. Values go through .value, never innerHTML.

const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";
const CSS = `
#lr-sign.lr-sign{padding:0;margin:auto;border:0;border-radius:6px;background:transparent;box-shadow:none;color:#fff2cc;width:min(360px,94vw);max-width:94vw;overflow:visible;font:500 14px/1.35 ${FONT}}
#lr-sign.lr-sign::backdrop{background:rgba(12,9,5,.42)}
#lr-sign .lr-sign-wrap{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:6px;outline:none;box-sizing:border-box;
  background:repeating-linear-gradient(90deg,#00000012 0 2px,transparent 2px 23px),linear-gradient(#b48d55,#8a663a);border:3px solid #3e2a17;box-shadow:0 0 0 2px #d6b67e,0 18px 50px #000a}
#lr-sign .lr-sign-title{margin:0;font:800 19px/1.1 ${FONT};letter-spacing:.2px;color:#2a1b0e;text-shadow:0 1px 0 #d6b67e88}
#lr-sign .lr-sign-board{display:flex;flex-direction:column;gap:6px;padding:10px;border-radius:4px;background:linear-gradient(#c39a63,#b48a55);box-shadow:inset 0 0 0 2px #6b4a2b,inset 0 2px 8px #0004}
#lr-sign input{box-sizing:border-box;width:100%;padding:6px 8px;border:0;border-radius:3px;background:#f4e2bfee;color:#3b2a1a;font:600 17px/1.2 "Trebuchet MS",system-ui,sans-serif;text-align:center;text-transform:none;letter-spacing:0;
  box-shadow:inset 0 0 0 1px #6b4a2b88;outline:none}
#lr-sign input:focus{box-shadow:inset 0 0 0 2px #3e2a17,0 0 0 2px #ffe3a6}
#lr-sign .lr-sign-hint{margin:0;font:600 12px/1.3 ${FONT};color:#2a1b0ecc;text-align:center}
#lr-sign .lr-sign-row{display:flex;gap:8px;justify-content:flex-end}
#lr-sign .lr-sign-btn{padding:7px 13px;border:0;border-radius:4px;background:linear-gradient(#7a5631,#5d4026);color:#fff2cc;font:700 13px/1 ${FONT};text-transform:none;letter-spacing:.2px;
  box-shadow:inset 0 0 0 1px #d4b07a77,0 1px 0 #0006;cursor:pointer;transform:none}
#lr-sign .lr-sign-btn:hover{box-shadow:inset 0 0 0 1px #ffe3a6,0 1px 0 #0006;background:linear-gradient(#8a6338,#6a4a2b)}
#lr-sign .lr-sign-btn.lr-sign-save{background:linear-gradient(#5f8f45,#456c31)}
#lr-sign .lr-sign-btn.lr-sign-turn{margin-right:auto}
`;

export function createSignUI(api) {
  const { ctx } = api, maxLines = api.maxLines ?? 3, lineMax = api.lineMax ?? 18;
  let tx = 0, tz = 0, isOpen = false, focusTimer = 0;

  if (!document.getElementById('lr-sign-css')) {
    const style = document.createElement('style'); style.id = 'lr-sign-css'; style.textContent = CSS; document.head.append(style);
  }
  const dlg = document.createElement('dialog'); dlg.id = 'lr-sign'; dlg.className = 'lr-sign';
  dlg.setAttribute('aria-labelledby', 'lr-sign-title');
  const wrap = document.createElement('div'); wrap.className = 'lr-sign-wrap'; wrap.tabIndex = -1; wrap.autofocus = true;
  const form = document.createElement('form'); form.method = 'dialog';
  const title = document.createElement('h2'); title.className = 'lr-sign-title'; title.id = 'lr-sign-title'; title.textContent = 'Signboard';
  const board = document.createElement('div'); board.className = 'lr-sign-board';
  const inputs = [];
  for (let i = 0; i < maxLines; i++) {
    const inp = document.createElement('input');
    inp.type = 'text'; inp.maxLength = lineMax; inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.setAttribute('autocomplete', 'off'); inp.setAttribute('spellcheck', 'false'); inp.setAttribute('aria-label', `Line ${i + 1}`);
    inputs.push(inp); board.append(inp);
  }
  const hint = document.createElement('p'); hint.className = 'lr-sign-hint'; hint.textContent = 'Enter saves · Esc cancels';
  const row = document.createElement('div'); row.className = 'lr-sign-row';
  const mk = (label, type, cls) => { const b = document.createElement('button'); b.type = type; b.className = 'lr-sign-btn ' + cls; b.textContent = label; return b; };
  const turnBtn = mk('Turn', 'button', 'lr-sign-turn'), cancelBtn = mk('Cancel', 'button', 'lr-sign-cancel'), saveBtn = mk('Save', 'submit', 'lr-sign-save');
  row.append(turnBtn, cancelBtn, saveBtn);
  form.append(title, board, hint, row); wrap.append(form); dlg.append(wrap);
  document.body.append(dlg);

  function open(x, z) {
    tx = x; tz = z;
    const lines = api.lines(x, z) || [];
    for (let i = 0; i < inputs.length; i++) inputs[i].value = lines[i] ?? '';
    if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
    isOpen = true;
    try { wrap.focus({ preventScroll: true }); } catch { /* ignore */ }
    // Not synchronous: interact() runs inside the E keydown, and an input focused now would get the 'e'.
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => { if (isOpen) { inputs[0].focus(); inputs[0].select(); } }, 0);
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
  form.addEventListener('submit', e => {
    e.preventDefault();
    api.send({ kind: 'decor.write', x: tx, z: tz, lines: inputs.map(i => i.value) });
    close();
  });
  turnBtn.addEventListener('click', () => api.send({ kind: 'decor.turn', x: tx, z: tz }));
  cancelBtn.addEventListener('click', () => close());

  return {
    open, close,
    get isOpen() { return isOpen; },
    destroy() { close(); dlg.remove(); },
  };
}
