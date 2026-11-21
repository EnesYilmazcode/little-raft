// Little Raft pause menu + tabbed settings. Pure ES module: nothing happens on import.
// createSettings({onChange,onResume,onPause,onQuit,initial}) -> { values, isOpen, open(), close(), escape(), set(raw), destroy() }
// initial: values the caller owns (e.g. sound, saved under its own key) that win over stored settings.
// Escape routing lives here: inventory -> sub-menu -> settings panel -> pause -> game.
// In the desktop app the main process claims Escape and calls window.raftEscape() with a user gesture,
// so closing a menu can relock the mouse without a click.

import { createEscGate, relockPending, RELOCK_TIMEOUT, exitLock } from './lock-rules.js?build=v3-survival-ae77fa84ac2b';
import { restoreGlobal } from './session-rules.js?build=v3-survival-ae77fa84ac2b';

const STORAGE_KEY = 'little-raft-settings';
const DIALOG_ID = 'options';
const STYLE_ID = 'little-raft-settings-style';

const pct = (v) => Math.round(v * 100) + '%';
// Picking a preset also sets the knobs it implies; they stay editable afterwards.
const PRESETS = { low: { renderScale: 0.7, shadows: false }, medium: { renderScale: 0.85, shadows: true }, high: { renderScale: 1, shadows: true } };
// type: range | toggle | select. tab: which settings tab shows it.
const SPEC = {
  sensitivity: { tab: 'controls', label: 'Mouse sensitivity', type: 'range', min: 0.2, max: 3, step: 0.05, def: 1, fmt: (v) => v.toFixed(2) + 'x' },
  invertY: { tab: 'controls', label: 'Invert look Y', type: 'toggle', def: false },
  fov: { tab: 'controls', label: 'Field of view', type: 'range', min: 60, max: 100, step: 1, def: 75, fmt: (v) => Math.round(v) + '°' },
  cameraMotion: { tab: 'controls', label: 'Camera sway', type: 'range', min: 0, max: 1, step: 0.05, def: 0.35, fmt: pct },
  graphics: { tab: 'graphics', label: 'Quality preset', type: 'select', options: ['low', 'medium', 'high'], def: 'medium' },
  renderScale: { tab: 'graphics', label: 'Render scale', type: 'range', min: 0.5, max: 1, step: 0.05, def: PRESETS.medium.renderScale, fmt: pct }, // matches the default 'medium' preset
  shadows: { tab: 'graphics', label: 'Shadows', type: 'toggle', def: true },
  sound: { tab: 'audio', label: 'Sound', type: 'toggle', def: true }, // mirrors #soundButton / little-raft-sound (game.js)
  stormFlash: { tab: 'graphics', label: 'Lightning flashes', type: 'select', options: ['full', 'soft', 'off'], def: 'full' },
  volume: { tab: 'audio', label: 'Master volume', type: 'range', min: 0, max: 1, step: 0.05, def: 0.5, fmt: pct },
  effects: { tab: 'audio', label: 'Effects', type: 'range', min: 0, max: 1, step: 0.05, def: 1, fmt: pct },
  ambience: { tab: 'audio', label: 'Ocean ambience', type: 'range', min: 0, max: 1, step: 0.05, def: 0.7, fmt: pct },
  music: { tab: 'audio', label: 'Music', type: 'range', min: 0, max: 1, step: 0.05, def: 0.7, fmt: pct }, // [musicbox]
};
const DEFAULTS = Object.freeze(Object.fromEntries(Object.entries(SPEC).map(([k, s]) => [k, s.def])));
const KEYS = Object.keys(SPEC);
const TABS = [['controls', 'Controls'], ['graphics', 'Graphics'], ['audio', 'Audio']];
// Bag keys use the same phrasing as hud.js BAG_OPEN_KEYS / BAG_CLOSE_KEYS (checked by tests/ux-layout.test.mjs).
const KEYMAP = [['W A S D', 'Walk'], ['Space', 'Jump'], ['Shift', 'Sprint'], ['Click', 'Use tool / charge throw'], ['Hold click', 'Reel in'],
  ['1 - 0 / Wheel', 'Pick hotbar slot'], ['Q / Right-click', 'Build wheel (hammer)'], ['Tab, I or E', 'Open the bag'], ['Tab, E, I or Esc', 'Close the bag'], ['E', 'Interact'], ['R', 'Rotate piece / repair hook'], ['Shift + wheel', 'Fine rotate piece'], ['X', 'Remove piece (Hammer)'], ['L', 'Logbook'], ['G', 'Place grill'], ['J', 'Fish journal'], ['C', 'Crouch'], ['Esc', 'Back / pause']];

export function validateSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, s] of Object.entries(SPEC)) {
    const v = src[key];
    if (s.type === 'toggle') out[key] = typeof v === 'boolean' ? v : s.def;
    else if (s.type === 'select') out[key] = s.options.includes(v) ? v : s.def;
    else { const n = Number(v); out[key] = v !== null && v !== '' && Number.isFinite(n) ? Math.min(s.max, Math.max(s.min, n)) : s.def; }
  }
  return out;
}

function load() {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    return validateSettings(text ? JSON.parse(text) : null);
  } catch { return validateSettings(null); }
}

function save(values) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch { /* storage unavailable: keep in memory */ }
}

const same = (a, b) => KEYS.every((k) => a[k] === b[k]);

const CSS = `
/* Pause menu: a dark glass rail on the left with its panel (Settings or How to play) attached to its right edge, full height.
   Same look as the bag (survival-ui.js): grey glass, hairline white borders, one sans family, cream selection, warm accent. */
#options{position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;border-radius:0;
  overflow:hidden;background:transparent;box-shadow:none;color:var(--cream,#f4efe2);font:500 15px/1.4 var(--ui-font,system-ui,sans-serif)}
#options[open]{display:flex}
#options::backdrop{background:rgba(6,10,12,.55);-webkit-backdrop-filter:none;backdrop-filter:none} /* no blur: it re-blurs the live canvas every frame */
#options .rs-form{display:flex;align-items:stretch;gap:0;width:100%;height:100%;margin:0;padding:0}
#options .rs-menu{display:flex;flex-direction:column;justify-content:center;align-items:stretch;flex:none;width:clamp(260px,26vw,340px);padding:0 0 0 clamp(24px,3.5vw,48px);
  background:linear-gradient(180deg,#141b1ef2,#0b1012f7);box-shadow:inset -1px 0 0 #ffffff17,18px 0 50px rgba(0,0,0,.3)}
#options .rs-foot{margin-top:30px;padding-right:24px;font:700 11px/1 var(--ui-font);letter-spacing:1.6px;text-transform:uppercase;color:var(--muted,#f4efe280)}
#options .rs-foot kbd,#options .rs-keys kbd{padding:3px 7px;border-radius:4px;color:var(--cream-hi,#fff6e0);background:#0008;box-shadow:inset 0 0 0 1px #ffffff2e;font:700 11px/1.3 var(--ui-font)}
#options .rs-foot kbd{margin-right:8px}
#options .rs-eyebrow{font:800 11px/1 var(--ui-font);letter-spacing:2.4px;text-transform:uppercase;color:var(--accent,#ffc66e);margin-bottom:10px}
#options .rs-menu h2{margin:0 0 26px;padding-right:24px;font:800 clamp(30px,3.4vw,44px)/1.05 var(--display-font,var(--ui-font));letter-spacing:-.5px;color:var(--cream-hi,#fff6e0);text-shadow:0 2px 14px rgba(0,0,0,.5)}
#options .rs-menu button{position:relative;display:block;width:100%;text-align:left;cursor:pointer;background:none;border:0;border-radius:0;box-shadow:none;
  padding:10px 0 10px 20px;color:var(--cream-dim,#f4efe2b3);font:700 clamp(18px,1.8vw,22px)/1.15 var(--ui-font);transition:color .12s,background .12s}
#options .rs-menu button::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:2px;background:var(--cream-hi,#fff6e0);opacity:0;transition:opacity .12s}
/* One highlight at a time: hover wins while the pointer is on the rail, keyboard focus otherwise.
   The button whose panel is open keeps only its edge bar, so it never reads as a second highlight. */
#options .rs-menu button:hover,#options .rs-menu button:focus-visible{color:var(--cream-hi,#fff6e0);outline:0;transform:none;background:linear-gradient(90deg,#ffffff17,#ffffff00 90%)}
#options .rs-menu button:hover::before,#options .rs-menu button:focus-visible::before,#options .rs-menu button[aria-expanded=true]::before{opacity:1}
#options .rs-menu:hover button:focus-visible:not(:hover){background:none;color:var(--cream-dim,#f4efe2b3)}
#options .rs-menu:hover button:focus-visible:not(:hover):not([aria-expanded=true])::before{opacity:0}
#options .rs-menu button[aria-expanded=true]{color:var(--cream-hi,#fff6e0)}
#options .rs-menu button[hidden]{display:none}
#options .rs-title [data-act=resume],#options .rs-title [data-act=quit]{display:none}
#options .rs-menu .rs-quit{margin-top:20px;border-top:1px solid #ffffff17;padding-top:18px;font-size:clamp(15px,1.4vw,17px);color:var(--muted,#f4efe280)}
#options .rs-menu .rs-quit::before{top:20px}
/* The panel hangs off the rail as a framed card: capped height, its own visible scrollbar, and a closed bottom edge,
   so the last control is never cut off by the bottom of the screen. */
#options .rs-panel{flex:0 1 600px;min-width:0;align-self:center;height:auto;max-height:calc(100% - 48px);box-sizing:border-box;overflow:auto;overscroll-behavior:contain;
  padding:24px clamp(20px,3vw,36px) 24px;border-radius:0 10px 10px 0;background:linear-gradient(180deg,#1a2226f0,#0e1417f4);
  box-shadow:inset 0 0 0 1px #ffffff1f,18px 0 50px rgba(0,0,0,.3);scrollbar-width:thin;scrollbar-color:#ffffff52 transparent;scrollbar-gutter:stable}
#options .rs-tabs{display:flex;gap:4px;margin:0 0 18px}
#options .rs-tabs button{flex:1;cursor:pointer;margin:0;padding:9px 10px;border:0;border-radius:6px;background:#ffffff0b;box-shadow:inset 0 0 0 1px #ffffff12;color:var(--cream-dim,#f4efe2b3);
  font:700 13px/1 var(--ui-font);letter-spacing:.2px;text-transform:none}
#options .rs-tabs button:hover{color:var(--cream-hi,#fff6e0);background:#ffffff17;transform:none}
#options .rs-tabs button[aria-selected=true]{color:var(--cream-hi,#fff6e0);background:linear-gradient(180deg,#46545ad0,#1c2529dc);box-shadow:inset 0 0 0 1px #fff6e0a8}
#options .rs-page{display:grid;gap:14px}
#options .rs-row{display:grid;grid-template-columns:1fr auto;gap:6px 12px;align-items:center}
#options .rs-row label,#options .rs-row .rs-label{color:var(--cream,#f4efe2);font-weight:600}
#options .rs-row output{color:var(--accent,#ffc66e);font-variant-numeric:tabular-nums;min-width:4ch;text-align:right;font-weight:700}
#options .rs-row input[type=range]{grid-column:1/-1;width:100%;margin:0;padding:0;border:0;background:none;box-shadow:none;accent-color:var(--accent,#ffc66e)}
#options .rs-row input[type=checkbox]{appearance:none;width:42px;height:22px;margin:0;border:0;border-radius:11px;background:#0008;cursor:pointer;position:relative;
  box-shadow:inset 0 0 0 1px #ffffff38;transition:background .15s;flex:none;padding:0}
#options .rs-row input[type=checkbox]::after{content:"";position:absolute;left:3px;top:3px;width:16px;height:16px;border-radius:50%;background:var(--cream-dim,#f4efe2b3);transition:transform .15s}
#options .rs-row input[type=checkbox]:checked{background:var(--accent,#ffc66e)}
#options .rs-row input[type=checkbox]:checked::after{transform:translateX(20px);background:#1d1608}
/* Quality preset: a segmented control instead of the native (blue) dropdown */
#options .rs-seg{grid-column:1/-1;display:grid;grid-template-columns:repeat(var(--n,3),1fr);gap:4px;padding:3px;border-radius:8px;background:#0006;box-shadow:inset 0 0 0 1px #ffffff17}
#options .rs-seg label{position:relative;display:block;cursor:pointer;font-weight:700}
#options .rs-seg input{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;opacity:0;cursor:pointer}
#options .rs-seg span{display:block;padding:8px 6px;border-radius:6px;text-align:center;color:var(--cream-dim,#f4efe2b3);font:700 13px/1 var(--ui-font)}
#options .rs-seg label:hover span{color:var(--cream-hi,#fff6e0);background:#ffffff12}
#options .rs-seg input:checked+span{color:var(--cream-hi,#fff6e0);background:linear-gradient(180deg,#46545ad0,#1c2529dc);box-shadow:inset 0 0 0 1px #fff6e0a8}
#options .rs-seg input:focus-visible+span{outline:2px solid var(--cream-hi,#fff6e0);outline-offset:1px}
#options .rs-keys{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:8px 12px;align-items:center;margin:0 0 6px;padding:0 0 14px;border-bottom:1px solid #ffffff17;font-size:13px}
#options .rs-keys kbd{justify-self:start;white-space:nowrap}
#options .rs-keys span{color:var(--cream-dim,#f4efe2b3)}
#options .rs-wide{cursor:pointer;justify-self:start;padding:9px 14px;border-radius:6px;border:0;background:#ffffff0b;color:var(--cream,#f4efe2);
  font:700 13px/1 var(--ui-font);letter-spacing:0;text-transform:none;box-shadow:inset 0 0 0 1px #ffffff2e}
#options .rs-wide:hover{background:#ffffff17;transform:none}
/* How to play, in the same attached panel; it starts higher so the whole guide fits at 620px tall */
#options .rs-panel.rs-help{padding-top:24px}
#options .rs-help .eyebrow{margin-bottom:10px}
#options .rs-help h2{margin:0 0 6px;font:800 26px/1.15 var(--display-font,var(--ui-font));color:var(--cream-hi,#fff6e0)}
#options .rs-help .guide{list-style:none;padding:0;margin:14px 0 12px;display:grid;gap:8px}
#options .rs-help .guide li{display:grid;grid-template-columns:64px 1fr;align-items:baseline;gap:12px;font-size:14px;line-height:1.45;color:var(--cream-dim,#f4efe2b3)}
#options .rs-help .guide b{color:var(--cream-hi,#fff6e0)}
#options .rs-help .guide>li>kbd{justify-self:stretch;text-align:center;padding:4px;border-radius:5px;border:0;color:var(--cream-hi,#fff6e0);background:#0008;box-shadow:inset 0 0 0 1px #ffffff2e;font:700 12px/1.2 var(--ui-font)}
#options .rs-help .guide span kbd{display:inline;padding:0 4px;border:0;border-radius:3px;line-height:1;vertical-align:baseline;background:#0008;box-shadow:inset 0 0 0 1px #ffffff2e;font:700 12px/1 var(--ui-font)}
#options .rs-help .guide-note{margin:0 0 8px;font-size:13px;line-height:1.55;color:var(--cream-dim,#f4efe2b3)}
#options .rs-help small{display:block;font-size:12px;line-height:1.5;color:var(--muted,#f4efe280)}
#options :focus-visible{outline:2px solid var(--cream-hi,#fff6e0);outline-offset:2px}
@media (max-width:760px){#options .rs-form{flex-direction:column;align-items:stretch;justify-content:flex-start;overflow:auto;padding:0}
  #options .rs-menu{width:auto;padding:20px 0 16px 20px}#options .rs-foot{display:none}
  #options h2{margin-bottom:14px}#options .rs-menu button{padding:6px 0 6px 18px}#options .rs-panel{flex:none;align-self:stretch;height:auto;max-height:none;overflow:visible;border-radius:0;padding:20px 16px}#options .rs-keys{grid-template-columns:auto 1fr}}
/* Waiting to relock after a menu closed without a gesture (browser Esc): no cursor, no hint beside the crosshair. */
body.relock:not(.drag-look) #world{cursor:none}
body.relock:not(.drag-look) #resumeHint{display:none!important}
`;

function ensureStyle() {
  let style = document.getElementById(STYLE_ID);
  if (!style) { style = document.createElement('style'); style.id = STYLE_ID; document.head.appendChild(style); }
  if (style.textContent !== CSS) style.textContent = CSS; // hot swap may bring new CSS
}

function control(key, s) {
  const head = `<label for="rs-${key}">${s.label}</label>`;
  if (s.type === 'toggle') return `<div class="rs-row">${head}<input id="rs-${key}" name="${key}" type="checkbox" role="switch"></div>`;
  if (s.type === 'select') { // segmented radio group; form.elements[key] is a RadioNodeList with .value
    const opts = s.options.map((o) => `<label><input type="radio" name="${key}" value="${o}"><span>${o[0].toUpperCase() + o.slice(1)}</span></label>`).join('');
    return `<div class="rs-row"><span class="rs-label" id="rs-${key}-label">${s.label}</span>` +
      `<div class="rs-seg" role="radiogroup" aria-labelledby="rs-${key}-label" style="--n:${s.options.length}">${opts}</div></div>`;
  }
  return `<div class="rs-row">${head}<output id="rs-${key}-out" for="rs-${key}"></output>` +
    `<input id="rs-${key}" name="${key}" type="range" min="${s.min}" max="${s.max}" step="${s.step}"></div>`;
}

function markup() {
  const page = (tab) => KEYS.filter((k) => SPEC[k].tab === tab).map((k) => control(k, SPEC[k])).join('');
  const keys = KEYMAP.map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('');
  const tabs = TABS.map(([id, name]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="false">${name}</button>`).join('');
  const pages = TABS.map(([id]) => `<div class="rs-page" role="tabpanel" data-page="${id}" hidden>` +
    (id === 'controls' ? `<div class="rs-keys">${keys}</div>` : '') + page(id) +
    (id === 'graphics' ? '<button type="button" class="rs-wide" data-act="fullscreen">Enter fullscreen</button>' : '') + '</div>').join('');
  return `<form class="rs-form" method="dialog" data-raft-settings="5">
<nav class="rs-menu"><div class="rs-eyebrow">PAUSED</div><h2>Little Raft</h2>
<button type="button" data-act="resume">Resume</button>
<button type="button" data-act="settings" aria-expanded="false">Settings</button>
<button type="button" data-act="help" aria-expanded="false">How to play</button>
<button type="button" data-act="crew">Play together</button>
<button type="button" data-act="logbook">Raft logbook</button>
<button type="button" data-act="look">Change look</button>
<button type="button" data-act="album">Photo album</button>
<button type="button" class="rs-quit" data-act="quit">Save and quit to title</button>
<div class="rs-foot"><kbd>Esc</kbd>Back</div></nav>
<section class="rs-panel" data-panel="settings" aria-label="Settings" hidden><div class="rs-tabs" role="tablist">${tabs}</div>${pages}</section>
<section class="rs-panel rs-help" data-panel="help" aria-label="How to play" hidden></section></form>`;
}

function ensureDialog() {
  let dialog = document.getElementById(DIALOG_ID);
  let reused = !!dialog;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = DIALOG_ID;
    document.body.appendChild(dialog);
  }
  if (dialog.querySelector('[data-raft-settings]')?.dataset.raftSettings !== '5') { // missing or an older layout
    reused = false;
    dialog.replaceChildren();
    dialog.insertAdjacentHTML('beforeend', markup());
  }
  dialog.setAttribute('aria-label', 'Paused');
  return { dialog, reused };
}

function readControls(form) {
  const raw = {};
  for (const key of KEYS) {
    const el = form.elements[key];
    if (!el) continue;
    if (SPEC[key].type === 'toggle') raw[key] = el.checked;
    else if (el.value !== '') raw[key] = SPEC[key].type === 'select' ? el.value : Number(el.value);
  }
  return raw;
}

export function createSettings({ onChange, onResume, onPause, onQuit, initial } = {}) {
  ensureStyle();
  const { dialog, reused } = ensureDialog();
  const form = dialog.querySelector('[data-raft-settings]');
  const panels = [...form.querySelectorAll('.rs-panel[data-panel]')];
  const ac = new AbortController();
  // Ownership token: only the newest instance reacts, even if an older one is not destroyed yet.
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  dialog.dataset.owner = token;
  let destroyed = false;
  const owns = () => !destroyed && dialog.dataset.owner === token;
  const guard = (fn) => (event) => { if (owns()) fn(event); };
  const sig = { signal: ac.signal };
  let returnToPause = null;     // sub-menu (help/crew) opened from the pause menu
  const esc = createEscGate();  // Escape keydown/keyup/lock-loss bookkeeping (lock-rules.js)

  // Hot creation: the live controls are the freshest truth; otherwise storage.
  let values = validateSettings({ ...(reused ? { ...load(), ...readControls(form) } : load()), ...(initial || {}) });
  save(values);

  const call = (fn, ...args) => { if (owns() && typeof fn === 'function') { try { fn(...args); } catch (err) { console.error(err); } } };

  function syncControls() {
    const active = document.activeElement;
    for (const key of KEYS) {
      const el = form.elements[key], s = SPEC[key];
      if (!el || el === active) continue;
      if (s.type === 'toggle') el.checked = values[key];
      else if (el.value !== String(values[key])) el.value = String(values[key]);
    }
    for (const key of KEYS) { const out = SPEC[key].fmt && dialog.querySelector(`#rs-${key}-out`); if (out) out.textContent = SPEC[key].fmt(values[key]); }
  }

  function syncFullscreen() {
    const btn = form.querySelector('[data-act="fullscreen"]');
    if (btn) btn.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen';
  }

  function update(raw) {
    const next = validateSettings({ ...values, ...raw });
    if (same(next, values)) { syncControls(); return; }
    values = next;
    save(values);
    syncControls();
    call(onChange, { ...values });
  }

  function showTab(id) {
    for (const b of form.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === id));
    for (const p of form.querySelectorAll('[data-page]')) p.hidden = p.dataset.page !== id;
  }
  // Settings and How to play share one panel slot attached to the rail; at most one is open.
  const openPanel = () => panels.find((p) => !p.hidden)?.dataset.panel ?? null;
  function fillHelp(host) { // copy of the guide game.js keeps in #help (one source for its text)
    const src = document.getElementById('help');
    const parts = src ? [...src.querySelectorAll(':scope > .eyebrow, :scope > h2, :scope > .guide, :scope > .guide-note, :scope > #saveStatus')] : [];
    host.replaceChildren(...parts.map((el) => { const c = el.cloneNode(true); c.removeAttribute('id'); return c; }));
    if (!parts.length) host.innerHTML = '<h2>How to play</h2><p class="guide-note">Click the sea to look around, W A S D to walk, hold click to throw your hook.</p>';
  }
  function setPanel(open, mode = 'settings') {
    for (const p of panels) {
      const show = open && p.dataset.panel === mode;
      if (show && p.dataset.panel === 'help') fillHelp(p);
      p.hidden = !show;
      form.querySelector(`[data-act="${p.dataset.panel}"]`)?.setAttribute('aria-expanded', String(show));
    }
    const btn = form.querySelector(`[data-act="${mode}"]`);
    if (open && dialog.contains(document.activeElement) && document.activeElement !== btn) btn?.focus({ preventScroll: true }); // one highlight, not two
    if (open && mode === 'settings' && !form.querySelector('[data-tab][aria-selected=true]')) showTab('controls');
  }

  const gameActive = () => document.body.classList.contains('playing') || document.body.classList.contains('first-person');
  const otherDialogs = () => [...document.querySelectorAll('dialog[open]')].filter((d) => d !== dialog);
  const buildWheelOpen = () => !!document.querySelector?.('.bm-wheel.bm-open'); // hammer piece wheel: Escape just closes it

  function releasePointer() {
    exitLock(document); // marked as page-initiated, so game.js does not treat it as a lost lock
  }

  function open() {
    if (!owns()) return;
    releasePointer();
    document.body.classList.remove('relock');
    syncControls(); syncFullscreen();
    // From the title (no game running) only settings/help/crew make sense: hide Resume and Save-and-quit.
    const inGame = gameActive();
    for (const b of form.querySelectorAll('[data-act="resume"],[data-act="quit"]')) b.hidden = !inGame;
    const eyebrow = form.querySelector('.rs-eyebrow'); if (eyebrow) eyebrow.textContent = inGame ? 'PAUSED' : 'MENU';
    if (!dialog.open) {
      setPanel(false);
      // From the title screen there is no game to resume or quit: show a plain menu.
      const title = !gameActive();
      form.classList.toggle('rs-title', title);
      const eyebrow = form.querySelector('.rs-eyebrow');
      if (eyebrow) eyebrow.textContent = title ? 'MENU' : 'PAUSED';
      dialog.setAttribute('aria-label', title ? 'Menu' : 'Paused');
      try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
      form.querySelector(inGame ? '[data-act="resume"]' : '[data-act="settings"]')?.focus({ preventScroll: true });
    }
    call(onPause);
  }

  // Closes the menu. resume=false is used when handing over to another menu.
  function close(resume = true) {
    if (!owns()) return;
    if (dialog.open) dialog.close();
    if (resume) call(onResume);
  }

  // One Escape press. Returns true when something consumed it.
  function escape() {
    if (!owns()) return false;
    esc.keydown(performance.now(), { handled: true }); // this press is consumed: its keyup never pauses
    const inv = document.getElementById('inventory');
    if (inv?.open) { inv.dispatchEvent(new Event('cancel', { cancelable: true })); return true; } // survival UI closes and relocks
    if (dialog.open) { const m = openPanel(); if (m) { setPanel(false); form.querySelector(`[data-act="${m}"]`)?.focus({ preventScroll: true }); } else close(true); return true; }
    const others = otherDialogs();
    if (others.length) { others[others.length - 1].close(); return true; }
    if (buildWheelOpen()) { // desktop app: the shell swallowed the keydown, so close the wheel through the game (lock kept)
      try { if (window.raftShell?.closeBuildWheel?.()) return true; } catch { /* fall through */ }
      return false;
    }
    if (!gameActive()) { // title screen: Escape only leaves fullscreen (the desktop app swallows the native one)
      if (!document.fullscreenElement) return false;
      Promise.resolve(document.exitFullscreen?.()).catch(() => {});
      return true;
    }
    open();
    return true;
  }

  // --- Escape handling -----------------------------------------------------
  // Desktop app: main process claims Escape and calls this with a user gesture.
  const previousEscape = Object.getOwnPropertyDescriptor(window, 'raftEscape'), raftEscape = () => { if (owns()) escape(); };
  window.raftEscape = raftEscape;
  try { window.raftDesktop?.claimEscape?.(true); } catch { /* not in the desktop app */ }

  // Browser: Escape arrives as a normal keydown when the pointer is free.
  window.addEventListener('keydown', guard((event) => {
    if (event.key !== 'Escape') return;
    const now = performance.now();
    // Held Escape: repeats keep this press "handled" so its late keyup never opens the pause menu.
    if (event.repeat) { esc.keydown(now, { repeat: true }); if (dialog.open) event.preventDefault(); return; }
    // Another menu (inventory/crew/help) closes natively through its own cancel; only suppress the keyup pause fallback.
    if (!dialog.open && otherDialogs().length) { esc.keydown(now, { handled: true }); return; }
    // The build wheel closes through the game's own key handler for this keydown (not escape(): no double handling);
    // that press is still handled, so its keyup never pauses.
    if (!dialog.open && buildWheelOpen()) { esc.keydown(now, { handled: true }); return; }
    if (escape()) event.preventDefault(); else esc.keydown(now, { handled: false });
  }), { capture: true, signal: ac.signal });

  // Browsers often swallow the keydown that ends pointer lock; the keyup still arrives.
  window.addEventListener('keyup', guard((event) => {
    if (event.key !== 'Escape') return;
    // Only pause for an unhandled Escape that just released the lock.
    if (!esc.keyupOpensPause(performance.now(), { locked: !!document.pointerLockElement })) return;
    if (!dialog.open && !otherDialogs().length && !buildWheelOpen() && gameActive()) { event.preventDefault(); open(); }
  }), { capture: true, signal: ac.signal });

  // body.relock is a short pending state: a granted-then-revoked or refused relock brings the resume hint back.
  let relockTimer = 0;
  function endRelock(event) {
    const locked = !!document.pointerLockElement;
    if (relockPending({ locked, event, elapsed: event ? 0 : RELOCK_TIMEOUT })) return;
    clearTimeout(relockTimer); relockTimer = 0;
    document.body.classList.remove('relock');
  }
  function startRelock() {
    document.body.classList.add('relock');
    clearTimeout(relockTimer); relockTimer = setTimeout(guard(() => endRelock(null)), RELOCK_TIMEOUT);
  }
  ac.signal.addEventListener('abort', () => clearTimeout(relockTimer));

  // Remember lock loss only; never pause from lock loss alone (build mode, menus release it on purpose).
  document.addEventListener('pointerlockchange', guard(() => {
    if (document.pointerLockElement) endRelock('locked');
    else {
      endRelock('unlocked');
      // A release caused by the page opening a menu (inventory, crew, help) is not an Escape.
      if (gameActive() && !dialog.open) esc.lockLost(performance.now(), { selfCaused: otherDialogs().length > 0 });
    }
  }), sig);
  document.addEventListener('pointerlockerror', guard(() => endRelock('error')), sig);
  // The Escape that ends pointer lock with the build wheel open is swallowed as a keydown, and the game's own
  // lock-loss handler closes the wheel before the keyup. Window capture runs before both, so mark that press
  // handled here while the wheel is still open: its keyup closes the wheel only, never pauses.
  window.addEventListener('pointerlockchange', guard(() => {
    if (!document.pointerLockElement && buildWheelOpen()) esc.keydown(performance.now(), { handled: true });
  }), { capture: true, signal: ac.signal });

  // A menu closed while playing but the browser refused to relock (Escape is not a user gesture):
  // hide the cursor over the sea (the edge hint stays); the next click relocks.
  document.addEventListener('close', guard((event) => {
    const d = event.target;
    if (!(d instanceof HTMLDialogElement)) return;
    // Help returns to the menu on the title too; crew may close because a game is starting.
    if (d !== dialog && d === returnToPause) {
      setTimeout(() => { delete d.dataset.fromPause; }, 0); // game.js reads it on this close
      returnToPause = null; if (gameActive() || d.id === 'help') { open(); return; }
    }
    if (d.id !== 'inventory' && d !== dialog) return;
    setTimeout(guard(() => {
      if (gameActive() && !document.body.classList.contains('drag-look') && !document.pointerLockElement && !document.querySelector('dialog[open]')) startRelock();
    }), 150);
  }), { capture: true, signal: ac.signal });
  window.addEventListener('pointerdown', () => document.body.classList.remove('relock'), { capture: true, signal: ac.signal });
  // Focus lost (alt-tab): show the cursor and the "away" resume hint again; a click on return relocks.
  window.addEventListener('blur', () => document.body.classList.remove('relock'), { signal: ac.signal });

  // Native dialog Escape: route through our escape so the engine resumes.
  dialog.addEventListener('cancel', guard((event) => {
    event.preventDefault();
    if (performance.now() - esc.handledAt < 100) return; // already handled by keydown
    escape();
  }), sig);

  // --- Controls --------------------------------------------------------------
  const onControl = guard((event) => {
    const el = event.target, s = el?.name && SPEC[el.name];
    if (!s) return;
    const v = s.type === 'toggle' ? el.checked : s.type === 'select' ? el.value : Number(el.value);
    update(el.name === 'graphics' ? { graphics: v, ...PRESETS[v] } : { [el.name]: v });
  });
  form.addEventListener('input', onControl, sig);
  form.addEventListener('change', onControl, sig);
  form.addEventListener('submit', (event) => event.preventDefault(), sig);

  dialog.addEventListener('click', guard((event) => {
    const tab = event.target.closest?.('button[data-tab]');
    if (tab) { showTab(tab.dataset.tab); return; }
    const btn = event.target.closest?.('button[data-act]');
    if (!btn || !dialog.contains(btn)) return;
    const act = btn.dataset.act;
    if (act === 'resume') { close(true); return; }
    if (act === 'settings' || act === 'help') { setPanel(openPanel() !== act, act); return; } // help shares the attached panel
    if (act === 'quit') { if (!gameActive()) return; setPanel(false); close(false); call(onQuit); return; }
    if (act === 'fullscreen') {
      const req = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
      Promise.resolve(req).catch(() => {}).finally(syncFullscreen);
      return;
    }
    if (act === 'logbook') {
      close(false); document.dispatchEvent(new CustomEvent('littleraft:open-logbook'));
      const lb = document.getElementById('logbook'); // like Crew/Help: closing it comes back to this menu
      if (lb instanceof HTMLDialogElement && lb.open) { returnToPause = lb; lb.dataset.fromPause = '1'; }
      return;
    }
    if (act === 'look') { close(false); document.dispatchEvent(new CustomEvent('littleraft:open-look')); return; }
    if (act === 'album') { close(false); document.dispatchEvent(new CustomEvent('littleraft:open-album')); return; } // [camera]
    if (act === 'crew') {
      const target = document.getElementById(act);
      if (!(target instanceof HTMLDialogElement)) return;
      close(false); // stay paused; Escape or close returns to this menu
      returnToPause = target;
      target.dataset.fromPause = '1'; // game.js: closing it hands back to the pause menu, not to locked play
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
    escape, // one Escape step (inventory -> panel -> pause -> game); the desktop shell calls this too
    set: (raw) => { if (owns()) update(raw); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ac.abort();
      // #options, its <style> and window.raftEscape are shared: a newer instance may already own them.
      // If none has, hand raftEscape back to the instance we replaced (a failed hot-swap resumes that engine).
      restoreGlobal(window, 'raftEscape', previousEscape, raftEscape);
    },
  };
}

export { DEFAULTS as SETTINGS_DEFAULTS, STORAGE_KEY as SETTINGS_STORAGE_KEY };
