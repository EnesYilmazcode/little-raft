// Raft animals rename dialog (DOM only): one <dialog id="lrAnimals">. The typed name is read from
// input.value and sent as ctx.action({kind:'animals.name'}); it is never parsed as HTML.
const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";
const CSS = `
#lrAnimals.lr-an{padding:0;margin:auto;border:0;border-radius:6px;background:transparent;box-shadow:none;color:#fff2cc;width:min(340px,92vw);overflow:visible;font:500 14px/1.35 ${FONT}}
#lrAnimals.lr-an::backdrop{background:rgba(12,9,5,.42)}
#lrAnimals .lr-an-wrap{display:flex;flex-direction:column;gap:12px;padding:14px;border-radius:6px;box-sizing:border-box;
  background:repeating-linear-gradient(90deg,#00000012 0 2px,transparent 2px 23px),linear-gradient(#b48d55,#8a663a);border:3px solid #3e2a17;box-shadow:0 0 0 2px #d6b67e,0 18px 50px #000a}
#lrAnimals h2{margin:0;font:800 19px/1.1 ${FONT};color:#2a1b0e;text-shadow:0 1px 0 #d6b67e88}
#lrAnimals input{box-sizing:border-box;text-transform:none;letter-spacing:normal;width:100%;padding:8px 10px;border:0;border-radius:4px;background:#3a2716eb;color:#fff2cc;font:600 16px/1.2 ${FONT};box-shadow:inset 0 0 0 2px #24170c,inset 0 0 0 3px #b48d5544;outline:none}
#lrAnimals input:focus{box-shadow:inset 0 0 0 2px #ffe3a6}
#lrAnimals .lr-an-row{display:flex;gap:8px;justify-content:flex-end}
#lrAnimals button{padding:7px 14px;border:0;border-radius:4px;background:linear-gradient(#7a5631,#5d4026);color:#fff2cc;font:700 13px/1 ${FONT};box-shadow:inset 0 0 0 1px #d4b07a77,0 1px 0 #0006;cursor:pointer;transform:none;text-transform:none}
#lrAnimals button:hover{box-shadow:inset 0 0 0 1px #ffe3a6,0 1px 0 #0006}
`;

export function createAnimalsUI(ctx) {
  let st = document.getElementById('lr-an-style');
  if (!st) { st = document.createElement('style'); st.id = 'lr-an-style'; document.head.append(st); }
  st.textContent = CSS;
  document.getElementById('lrAnimals')?.remove();
  const dlg = document.createElement('dialog');
  dlg.id = 'lrAnimals'; dlg.className = 'lr-an';
  dlg.innerHTML = `<form class="lr-an-wrap" method="dialog">
    <h2>Name your Puffhen</h2>
    <input type="text" maxlength="14" autocomplete="off" spellcheck="false" aria-label="Puffhen name">
    <div class="lr-an-row"><button type="button" class="lr-an-cancel">Cancel</button><button type="button" class="lr-an-save">Save</button></div>
  </form>`;
  document.body.append(dlg);
  const input = dlg.querySelector('input'), heading = dlg.querySelector('h2');
  let id = null;

  const close = () => { if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } } };
  function save() {
    if (id) ctx.action({ kind: 'animals.name', id, name: String(input.value).slice(0, 64) });
    close();
  }
  const stop = e => { e.stopPropagation(); };
  dlg.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); save(); } });
  dlg.addEventListener('keyup', stop);
  dlg.addEventListener('keypress', stop);
  dlg.addEventListener('submit', e => e.preventDefault());
  dlg.querySelector('.lr-an-save').addEventListener('click', save);
  dlg.querySelector('.lr-an-cancel').addEventListener('click', close);
  dlg.addEventListener('close', () => { id = null; if (ctx.running) ctx.requestLock?.(); });

  return {
    open(animalId, name, label = 'Puffhen') {
      id = animalId;
      const l = String(label || 'Puffhen');
      heading.textContent = `Name your ${l}`; input.setAttribute('aria-label', `${l} name`);
      input.value = String(name ?? '');
      ctx.releaseLock?.();
      if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
      input.focus(); input.select();
      return true;
    },
    get isOpen() { return dlg.open; },
    close,
    destroy() { close(); dlg.remove(); },
  };
}
