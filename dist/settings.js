// Little Raft pause / settings panel. Pure ES module: nothing happens on import.
// createSettings({onChange,onResume,onPause}) -> { values, isOpen, open(), close(), destroy() }

const STORAGE_KEY = 'little-raft-settings';
const DIALOG_ID = 'options';
const STYLE_ID = 'little-raft-settings-style';

const SPEC = {
  sensitivity: { label: 'Mouse sensitivity', min: 0.4, max: 2, step: 0.05, def: 1, fmt: (v) => v.toFixed(2) + 'x' },
  fov: { label: 'Field of view', min: 60, max: 95, step: 1, def: 75, fmt: (v) => Math.round(v) + '°' },
  cameraMotion: { label: 'Camera motion', min: 0, max: 1, step: 0.05, def: 0.35, fmt: (v) => Math.round(v * 100) + '%' },
  volume: { label: 'Sound volume', min: 0, max: 1, step: 0.05, def: 0.5, fmt: (v) => Math.round(v * 100) + '%' },
};
const GRAPHICS = ['low', 'medium', 'high'];
const DEFAULTS = Object.freeze({ sensitivity: 1, fov: 75, cameraMotion: 0.35, volume: 0.5, graphics: 'medium' });

function validate(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, s] of Object.entries(SPEC)) {
    const n = Number(src[key]);
    out[key] = Number.isFinite(n) ? Math.min(s.max, Math.max(s.min, n)) : s.def;
  }
  out.graphics = GRAPHICS.includes(src.graphics) ? src.graphics : DEFAULTS.graphics;
  return out;
}

function load() {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    return validate(text ? JSON.parse(text) : null);
  } catch { return validate(null); }
}

function save(values) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch { /* storage unavailable: keep in memory */ }
}

const same = (a, b) => Object.keys(DEFAULTS).every((k) => a[k] === b[k]);

const CSS = `
#options{border:2px solid #b07a3c;border-radius:14px;padding:0;color:#f3e6cc;background:rgba(13,29,52,.9);
  box-shadow:0 0 0 1px rgba(232,176,96,.25) inset,0 18px 48px rgba(0,0,0,.55);width:min(440px,92vw);
  font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
#options::backdrop{background:rgba(4,12,24,.55);backdrop-filter:blur(2px)}
#options .rs-form{margin:0;padding:22px 24px 20px;display:grid;gap:14px}
#options h2{margin:0;font:600 26px/1.1 Georgia,"Times New Roman",serif;letter-spacing:.04em;color:#f6ead2;text-align:center}
#options .rs-panel{display:grid;gap:12px;padding:14px 16px;border:1px solid rgba(176,122,60,.6);border-radius:10px;background:rgba(22,44,74,.7)}
#options .rs-row{display:grid;grid-template-columns:1fr auto;gap:4px 10px;align-items:center}
#options .rs-row label{color:#f3e6cc;font-weight:600}
#options .rs-row output{color:#f0b04a;font-variant-numeric:tabular-nums;min-width:4ch;text-align:right}
#options .rs-row input,#options .rs-row select{grid-column:1/-1}
#options input[type=range]{width:100%;accent-color:#e8a23a;margin:0}
#options select{width:100%;padding:6px 8px;border-radius:7px;border:1px solid #b07a3c;background:#0f2442;color:#f3e6cc;font:inherit}
#options select:focus-visible,#options input:focus-visible,#options button:focus-visible{outline:2px solid #f0b04a;outline-offset:2px}
#options .rs-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
#options button{cursor:pointer;font:600 15px/1 system-ui,sans-serif;padding:11px 12px;border-radius:9px;
  border:1px solid #b07a3c;background:rgba(30,58,96,.85);color:#f3e6cc}
#options button:hover{background:rgba(44,78,122,.95);border-color:#d89a50}
#options button.rs-primary{grid-column:1/-1;background:linear-gradient(#f0b04a,#c8812c);color:#1a1206;border-color:#e8b46a;font-size:17px}
#options button.rs-primary:hover{background:linear-gradient(#f6c066,#d48f38)}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function markup() {
  const rows = Object.entries(SPEC).map(([key, s]) =>
    `<div class="rs-row"><label for="rs-${key}">${s.label}</label><output id="rs-${key}-out" for="rs-${key}"></output>` +
    `<input id="rs-${key}" name="${key}" type="range" min="${s.min}" max="${s.max}" step="${s.step}"></div>`).join('');
  const opts = GRAPHICS.map((g) => `<option value="${g}">${g[0].toUpperCase() + g.slice(1)}</option>`).join('');
  return `<form class="rs-form" method="dialog" data-raft-settings>
<h2>Paused</h2>
<div class="rs-actions">
<button type="button" class="rs-primary" data-act="resume">Resume</button>
<button type="button" data-act="fullscreen">Enter fullscreen</button>
<button type="button" data-act="help">How to play</button>
<button type="button" data-act="crew">Play together</button>
</div>
<div class="rs-panel" role="group" aria-label="Options">${rows}
<div class="rs-row"><label for="rs-graphics">Graphics quality</label><output id="rs-graphics-out" for="rs-graphics"></output>
<select id="rs-graphics" name="graphics">${opts}</select></div>
</div></form>`;
}

function ensureDialog() {
  let dialog = document.getElementById(DIALOG_ID);
  let reused = !!dialog;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = DIALOG_ID;
    document.body.appendChild(dialog);
  }
  if (!dialog.querySelector('[data-raft-settings]')) {
    reused = false;
    dialog.insertAdjacentHTML('beforeend', markup());
  }
  dialog.setAttribute('aria-label', 'Paused');
  return { dialog, reused };
}

function readControls(dialog) {
  const form = dialog.querySelector('[data-raft-settings]');
  const raw = {};
  for (const key of Object.keys(DEFAULTS)) {
    const el = form.elements[key];
    if (el && el.value !== '') raw[key] = key === 'graphics' ? el.value : Number(el.value);
  }
  return raw;
}

export function createSettings({ onChange, onResume, onPause } = {}) {
  ensureStyle();
  const { dialog, reused } = ensureDialog();
  const form = dialog.querySelector('[data-raft-settings]');
  const ac = new AbortController();
  // Ownership token: only the newest instance reacts, even if an older one is not destroyed yet.
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  dialog.dataset.owner = token;
  const owns = () => !destroyed && dialog.dataset.owner === token;
  const guard = (fn) => (event) => { if (owns()) fn(event); };
  const sig = { signal: ac.signal };
  let destroyed = false;
  let lockLostAt = -Infinity;   // when pointer lock was released while the game was active
  let escHandledAt = -Infinity; // last time a keydown Escape was handled (to avoid double handling on keyup)

  // Hot creation: the live controls are the freshest truth; otherwise storage.
  let values = reused ? validate({ ...load(), ...readControls(dialog) }) : load();
  save(values);

  const call = (fn, ...args) => { if (owns() && typeof fn === 'function') { try { fn(...args); } catch (err) { console.error(err); } } };

  function syncControls() {
    const active = document.activeElement;
    for (const key of Object.keys(DEFAULTS)) {
      const el = form.elements[key];
      const out = dialog.querySelector(`#rs-${key}-out`);
      if (el && el !== active && el.value !== String(values[key])) el.value = String(values[key]);
      if (out) out.textContent = SPEC[key] ? SPEC[key].fmt(values[key]) : values[key][0].toUpperCase() + values[key].slice(1);
    }
  }

  function syncFullscreen() {
    const btn = form.querySelector('[data-act="fullscreen"]');
    if (btn) btn.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen';
  }

  function update(raw) {
    const next = validate({ ...values, ...raw });
    if (same(next, values)) { syncControls(); return; }
    values = next;
    save(values);
    syncControls();
    call(onChange, { ...values });
  }

  const gameActive = () => document.body.classList.contains('playing') || document.body.classList.contains('first-person');
  const otherDialogOpen = () => [...document.querySelectorAll('dialog[open]')].some((d) => d !== dialog);

  function releasePointer() {
    if (document.pointerLockElement) { try { document.exitPointerLock?.(); } catch { /* ignore */ } }
  }

  function open() {
    if (!owns()) return;
    releasePointer();
    syncControls(); syncFullscreen();
    if (!dialog.open) {
      try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
      form.querySelector('[data-act="resume"]')?.focus({ preventScroll: true });
    }
    call(onPause);
  }

  // Closes the panel. resume=false is used when handing over to another menu.
  function close(resume = true) {
    if (!owns()) return;
    if (dialog.open) dialog.close();
    if (resume) call(onResume);
  }

  function tryOpenFromEscape(event) {
    if (dialog.open || otherDialogOpen() || !gameActive()) return false;
    event.preventDefault();
    open();
    return true;
  }

  // --- Escape handling -----------------------------------------------------
  window.addEventListener('keydown', guard((event) => {
    if (event.key !== 'Escape') return;
    if (event.repeat) { if (dialog.open) event.preventDefault(); return; }
    if (dialog.open) { event.preventDefault(); escHandledAt = performance.now(); close(true); return; }
    // Another menu (inventory/crew/help) owns this Escape; suppress the keyup pause fallback.
    if (otherDialogOpen()) { escHandledAt = performance.now(); return; }
    if (tryOpenFromEscape(event)) escHandledAt = performance.now();
  }), { capture: true, signal: ac.signal });

  // Browsers often swallow the keydown that ends pointer lock; the keyup still arrives.
  window.addEventListener('keyup', guard((event) => {
    if (event.key !== 'Escape') return;
    const now = performance.now();
    if (now - escHandledAt < 600) return;
    if (now - lockLostAt > 1500) return; // only pause for the Escape that just released the lock
    lockLostAt = -Infinity;
    tryOpenFromEscape(event);
  }), { capture: true, signal: ac.signal });

  // Remember lock loss only; never pause from lock loss alone (build mode, menus release it on purpose).
  document.addEventListener('pointerlockchange', guard(() => {
    if (!document.pointerLockElement && gameActive() && !dialog.open) lockLostAt = performance.now();
  }), sig);

  // Native dialog Escape: route through our close so the engine resumes.
  dialog.addEventListener('cancel', guard((event) => {
    event.preventDefault();
    if (performance.now() - escHandledAt < 100) return; // already handled by keydown
    close(true);
  }), sig);

  // --- Controls --------------------------------------------------------------
  const onControl = guard((event) => {
    const el = event.target;
    if (!el?.name || !(el.name in DEFAULTS)) return;
    update({ [el.name]: el.name === 'graphics' ? el.value : Number(el.value) });
  });
  form.addEventListener('input', onControl, sig);
  form.addEventListener('change', onControl, sig);
  form.addEventListener('submit', (event) => event.preventDefault(), sig);

  dialog.addEventListener('click', guard((event) => {
    const btn = event.target.closest?.('button[data-act]');
    if (!btn || !dialog.contains(btn)) return;
    const act = btn.dataset.act;
    if (act === 'resume') { close(true); return; }
    if (act === 'fullscreen') {
      const req = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
      Promise.resolve(req).catch(() => {}).finally(syncFullscreen);
      return;
    }
    if (act === 'help' || act === 'crew') {
      const target = document.getElementById(act);
      if (!(target instanceof HTMLDialogElement)) return;
      close(false); // stay paused; the other menu owns Escape now
      try { target.showModal(); } catch { target.setAttribute('open', ''); }
    }
  }), sig);

  document.addEventListener('fullscreenchange', guard(syncFullscreen), sig);

  // --- Initial state ---------------------------------------------------------
  syncControls(); syncFullscreen();
  call(onChange, { ...values });
  if (dialog.open) call(onPause); // hot creation while paused: tell the new engine it is paused

  return {
    get values() { return { ...values }; },
    get isOpen() { return dialog.open; },
    open,
    close: () => close(true),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ac.abort();
      // #options and its <style> are shared, stable nodes: a newer instance may already own them.
    },
  };
}

export { DEFAULTS as SETTINGS_DEFAULTS, STORAGE_KEY as SETTINGS_STORAGE_KEY };
