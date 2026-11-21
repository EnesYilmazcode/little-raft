// Little Raft pause menu + tabbed settings. Pure ES module: nothing happens on import.
// createSettings({onChange,onResume,onPause,onQuit}) -> { values, isOpen, open(), close(), destroy() }
// Escape routing lives here: inventory -> sub-menu -> settings panel -> pause -> game.
// In the desktop app the main process claims Escape and calls window.raftEscape() with a user gesture,
// so closing a menu can relock the mouse without a click.

import { createEscGate, relockPending, RELOCK_TIMEOUT } from './lock-rules.js?build=v3-survival-ae77fa84ac2b';
import { restoreGlobal } from './session-rules.js?build=v3-survival-ae77fa84ac2b';

const STORAGE_KEY = 'little-raft-settings';
const DIALOG_ID = 'options';
const STYLE_ID = 'little-raft-settings-style';

const pct = (v) => Math.round(v * 100) + '%';
// type: range | toggle | select. tab: which settings tab shows it.
const SPEC = {
  sensitivity: { tab: 'controls', label: 'Mouse sensitivity', type: 'range', min: 0.2, max: 3, step: 0.05, def: 1, fmt: (v) => v.toFixed(2) + 'x' },
  invertY: { tab: 'controls', label: 'Invert look Y', type: 'toggle', def: false },
  fov: { tab: 'controls', label: 'Field of view', type: 'range', min: 60, max: 100, step: 1, def: 75, fmt: (v) => Math.round(v) + '°' },
  cameraMotion: { tab: 'controls', label: 'Camera sway', type: 'range', min: 0, max: 1, step: 0.05, def: 0.35, fmt: pct },
  graphics: { tab: 'graphics', label: 'Quality preset', type: 'select', options: ['low', 'medium', 'high'], def: 'medium' },
  renderScale: { tab: 'graphics', label: 'Render scale', type: 'range', min: 0.5, max: 1, step: 0.05, def: 1, fmt: pct },
  shadows: { tab: 'graphics', label: 'Shadows', type: 'toggle', def: true },
  volume: { tab: 'audio', label: 'Master volume', type: 'range', min: 0, max: 1, step: 0.05, def: 0.5, fmt: pct },
  effects: { tab: 'audio', label: 'Effects', type: 'range', min: 0, max: 1, step: 0.05, def: 1, fmt: pct },
  ambience: { tab: 'audio', label: 'Ocean ambience', type: 'range', min: 0, max: 1, step: 0.05, def: 0.7, fmt: pct },
};
// Picking a preset also sets the knobs it implies; they stay editable afterwards.
const PRESETS = { low: { renderScale: 0.7, shadows: false }, medium: { renderScale: 0.85, shadows: true }, high: { renderScale: 1, shadows: true } };
const DEFAULTS = Object.freeze(Object.fromEntries(Object.entries(SPEC).map(([k, s]) => [k, s.def])));
const KEYS = Object.keys(SPEC);
const TABS = [['controls', 'Controls'], ['graphics', 'Graphics'], ['audio', 'Audio']];
const KEYMAP = [['W A S D', 'Walk'], ['Space', 'Jump'], ['Shift', 'Sprint'], ['Click', 'Use tool / charge throw'], ['Hold click', 'Reel in'],
  ['1 - 0 / Wheel', 'Pick hotbar slot'], ['Tab / I', 'Inventory'], ['E', 'Interact'], ['R', 'Rotate piece / repair hook'], ['Shift + wheel', 'Fine rotate piece'], ['X', 'Remove piece (Hammer)'], ['L', 'Logbook'], ['Esc', 'Back / pause']];

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
#options{position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;border-radius:0;
  overflow:hidden;background:transparent;box-shadow:none;color:var(--cream,#f1e7d0);font:15px/1.4 var(--ui-font,system-ui,sans-serif)}
#options[open]{display:flex}
#options::backdrop{background:rgba(4,10,16,.42);backdrop-filter:blur(4px) saturate(.8)}
#options .rs-form{display:flex;align-items:stretch;gap:clamp(24px,5vw,72px);width:100%;height:100%;margin:0;padding:0 clamp(16px,5vw,80px) 0 0}
#options .rs-menu{display:flex;flex-direction:column;justify-content:center;align-items:stretch;flex:none;width:clamp(280px,26vw,360px);padding:0 0 0 clamp(28px,4vw,56px);
  background:linear-gradient(90deg,rgba(5,11,17,.94),rgba(5,11,17,.82));box-shadow:1px 0 0 rgba(201,164,107,.28),18px 0 50px rgba(0,0,0,.35)}
#options .rs-panel{align-self:flex-start;margin-top:max(24px,calc(50vh - 236px))} /* top edge stays put across tabs */
#options .rs-foot{margin-top:34px;padding-right:28px;font:600 11px/1 var(--ui-font);letter-spacing:1.6px;text-transform:uppercase;color:var(--muted,#8f9aa0)}
#options .rs-foot kbd{margin-right:8px;padding:3px 7px;border-radius:3px;color:var(--cream,#f1e7d0);background:rgba(0,0,0,.4);box-shadow:inset 0 0 0 1px rgba(201,164,107,.45);font:700 10px/1.3 var(--ui-font)}
#options .rs-eyebrow{font:600 11px/1 var(--ui-font);letter-spacing:3.2px;color:var(--bronze-lt,#c9a46b);margin-bottom:10px}
#options .rs-menu h2{margin:0 0 30px;padding-right:28px;font:600 clamp(34px,4vw,52px)/1 var(--display-font,Georgia,serif);color:var(--cream,#f1e7d0);text-shadow:0 2px 14px rgba(0,0,0,.5)}
#options .rs-menu button{position:relative;display:block;width:100%;text-align:left;cursor:pointer;background:none;border:0;border-radius:0;box-shadow:none;
  padding:11px 0 11px 22px;color:var(--cream-dim,#c9bfa8);font:600 clamp(20px,2vw,26px)/1.15 var(--display-font,Georgia,serif);transition:color .12s,padding .12s}
#options .rs-menu button::before{content:"";position:absolute;left:0;top:50%;width:10px;height:2px;background:var(--amber,#e9a640);opacity:0;transform:translateY(-50%) scaleX(.2);transform-origin:left;transition:.12s}
#options .rs-menu button:hover,#options .rs-menu button:focus-visible,#options .rs-menu button[aria-expanded=true]{color:var(--amber-lt,#ffc96b);padding-left:28px;transform:none;outline:0;
  background:linear-gradient(90deg,rgba(233,166,64,.14),rgba(233,166,64,0) 85%)}
#options .rs-menu button:hover::before,#options .rs-menu button:focus-visible::before,#options .rs-menu button[aria-expanded=true]::before{opacity:1;transform:translateY(-50%) scaleX(1)}
#options .rs-title [data-act=resume],#options .rs-title [data-act=quit]{display:none}
#options .rs-menu .rs-quit{margin-top:22px;border-top:1px solid rgba(201,164,107,.18);padding-top:20px;font-size:clamp(16px,1.5vw,19px);color:var(--muted,#8f9aa0)}
#options .rs-panel{width:min(520px,100%);max-height:calc(100vh - 80px);overflow:auto;padding:22px 24px 24px;border-radius:6px;background:var(--plate-strong,rgba(8,17,26,.92));
  box-shadow:0 0 0 1px var(--bronze-lt,#c9a46b),0 0 0 4px var(--navy-0,#070f17),0 24px 70px rgba(0,0,0,.55)}
#options .rs-tabs{display:flex;gap:4px;margin:0 0 18px;border-bottom:1px solid rgba(201,164,107,.3)}
#options .rs-tabs button{cursor:pointer;background:none;border:0;border-radius:0;box-shadow:none;padding:10px 14px;margin-bottom:-1px;color:var(--muted,#8f9aa0);
  font:700 12px/1 var(--ui-font);letter-spacing:2px;text-transform:uppercase;border-bottom:2px solid transparent}
#options .rs-tabs button[aria-selected=true]{color:var(--amber-lt,#ffc96b);border-bottom-color:var(--amber,#e9a640)}
#options .rs-tabs button:hover{color:var(--cream,#f1e7d0);transform:none}
#options .rs-page{display:grid;gap:14px}
#options .rs-row{display:grid;grid-template-columns:1fr auto;gap:6px 12px;align-items:center}
#options .rs-row label{color:var(--cream,#f1e7d0);font-weight:600}
#options .rs-row output{color:var(--amber-lt,#ffc96b);font-variant-numeric:tabular-nums;min-width:4ch;text-align:right}
#options .rs-row input[type=range]{grid-column:1/-1;width:100%;margin:0;padding:0;border:0;background:none;accent-color:var(--amber,#e9a640)}
#options .rs-row input[type=checkbox]{appearance:none;width:42px;height:22px;margin:0;border:0;border-radius:11px;background:rgba(0,0,0,.5);cursor:pointer;position:relative;
  box-shadow:inset 0 0 0 1px rgba(201,164,107,.55);transition:background .15s;flex:none;padding:0}
#options .rs-row input[type=checkbox]::after{content:"";position:absolute;left:3px;top:3px;width:16px;height:16px;border-radius:50%;background:var(--cream-dim,#c9bfa8);transition:transform .15s}
#options .rs-row input[type=checkbox]:checked{background:var(--amber,#e9a640)}
#options .rs-row input[type=checkbox]:checked::after{transform:translateX(20px);background:#22170a}
#options .rs-row select{grid-column:1/-1;width:100%;padding:8px 10px;border-radius:4px;border:0;box-shadow:inset 0 0 0 1px rgba(201,164,107,.6);
  background:var(--navy-2,#112332);color:var(--cream,#f1e7d0);font:inherit;letter-spacing:0;text-transform:none}
#options .rs-keys{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:8px 12px;align-items:center;margin:0 0 6px;padding:0 0 14px;border-bottom:1px solid rgba(201,164,107,.2);font-size:13px}
#options .rs-keys kbd{justify-self:start;padding:3px 7px;border-radius:3px;font:700 11px/1.3 var(--ui-font);color:var(--cream,#f1e7d0);background:rgba(0,0,0,.4);box-shadow:inset 0 0 0 1px rgba(201,164,107,.45)}
#options .rs-keys span{color:var(--cream-dim,#c9bfa8)}
#options .rs-wide{cursor:pointer;justify-self:start;padding:9px 14px;border-radius:4px;border:0;background:rgba(7,15,23,.6);color:var(--cream,#f1e7d0);
  font:600 12px/1 var(--ui-font);letter-spacing:1.2px;text-transform:uppercase;box-shadow:inset 0 0 0 1px rgba(201,164,107,.6)}
#options .rs-wide:hover{background:rgba(17,35,50,.85);transform:none}
#options :focus-visible{outline:2px solid var(--amber,#e9a640);outline-offset:2px}
@media (max-width:760px){#options .rs-form{flex-direction:column;align-items:stretch;justify-content:center;gap:18px;overflow:auto;padding:24px 16px}
  #options .rs-menu{width:auto;padding:20px 0 20px 20px;border-radius:6px}#options .rs-foot{display:none}
  #options h2{margin-bottom:14px}#options .rs-menu button{padding:6px 0 6px 18px}#options .rs-panel{max-height:none;margin-top:0}#options .rs-keys{grid-template-columns:auto 1fr}}
/* Waiting to relock after a menu closed without a gesture (browser Esc): no cursor, no centred hint. */
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
  if (s.type === 'select') {
    const opts = s.options.map((o) => `<option value="${o}">${o[0].toUpperCase() + o.slice(1)}</option>`).join('');
    return `<div class="rs-row">${head}<select id="rs-${key}" name="${key}">${opts}</select></div>`;
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
  return `<form class="rs-form" method="dialog" data-raft-settings="3">
<nav class="rs-menu"><div class="rs-eyebrow">PAUSED</div><h2>Little Raft</h2>
<button type="button" data-act="resume">Resume</button>
<button type="button" data-act="settings" aria-expanded="false">Settings</button>
<button type="button" data-act="help">How to play</button>
<button type="button" data-act="crew">Play together</button>
<button type="button" data-act="logbook">Raft logbook</button>
<button type="button" class="rs-quit" data-act="quit">Save and quit to title</button>
<div class="rs-foot"><kbd>Esc</kbd>Back</div></nav>
<section class="rs-panel" aria-label="Settings" hidden><div class="rs-tabs" role="tablist">${tabs}</div>${pages}</section></form>`;
}

function ensureDialog() {
  let dialog = document.getElementById(DIALOG_ID);
  let reused = !!dialog;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = DIALOG_ID;
    document.body.appendChild(dialog);
  }
  if (dialog.querySelector('[data-raft-settings]')?.dataset.raftSettings !== '3') { // missing or an older layout
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

export function createSettings({ onChange, onResume, onPause, onQuit } = {}) {
  ensureStyle();
  const { dialog, reused } = ensureDialog();
  const form = dialog.querySelector('[data-raft-settings]');
  const panel = form.querySelector('.rs-panel');
  const ac = new AbortController();
  // Ownership token: only the newest instance reacts, even if an older one is not destroyed yet.
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  dialog.dataset.owner = token;
  let destroyed = false;
  const owns = () => !destroyed && dialog.dataset.owner === token;
  const guard = (fn) => (event) => { if (owns()) fn(event); };
  const sig = { signal: ac.signal };
  const esc = createEscGate(); // Escape keydown/keyup/lock-loss bookkeeping (lock-rules.js)
  let returnToPause = null;     // sub-menu (help/crew) opened from the pause menu

  // Hot creation: the live controls are the freshest truth; otherwise storage.
  let values = reused ? validateSettings({ ...load(), ...readControls(form) }) : load();
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
  const panelOpen = () => !panel.hidden;
  function setPanel(open) {
    panel.hidden = !open;
    const btn = form.querySelector('[data-act="settings"]');
    btn?.setAttribute('aria-expanded', String(open));
    if (open && dialog.contains(document.activeElement) && document.activeElement !== btn) btn?.focus({ preventScroll: true }); // one highlight, not two
    if (open && !form.querySelector('[data-tab][aria-selected=true]')) showTab('controls');
  }

  const gameActive = () => document.body.classList.contains('playing') || document.body.classList.contains('first-person');
  const otherDialogs = () => [...document.querySelectorAll('dialog[open]')].filter((d) => d !== dialog);
  const buildWheelOpen = () => !!document.querySelector?.('.bm-wheel.bm-open'); // hammer piece wheel: Escape just closes it

  function releasePointer() {
    if (document.pointerLockElement) { try { document.exitPointerLock?.(); } catch { /* ignore */ } }
  }

  function open() {
    if (!owns()) return;
    releasePointer();
    document.body.classList.remove('relock');
    syncControls(); syncFullscreen();
    if (!dialog.open) {
      setPanel(false);
      // From the title screen there is no game to resume or quit: show a plain menu.
      const title = !gameActive();
      form.classList.toggle('rs-title', title);
      const eyebrow = form.querySelector('.rs-eyebrow');
      if (eyebrow) eyebrow.textContent = title ? 'MENU' : 'PAUSED';
      dialog.setAttribute('aria-label', title ? 'Menu' : 'Paused');
      try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
      form.querySelector(title ? '[data-act="settings"]' : '[data-act="resume"]')?.focus({ preventScroll: true });
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
    esc.keydown(performance.now(), { handled: true });
    const inv = document.getElementById('inventory');
    if (inv?.open) { inv.dispatchEvent(new Event('cancel', { cancelable: true })); return true; } // survival UI closes and relocks
    if (dialog.open) { if (panelOpen()) { setPanel(false); form.querySelector('[data-act="settings"]')?.focus({ preventScroll: true }); } else close(true); return true; }
    const others = otherDialogs();
    if (others.length) { others[others.length - 1].close(); return true; }
    if (buildWheelOpen()) return false; // the game's own key handler closes the wheel
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
    // Other dialogs (inventory/crew/help) close natively through their own cancel; we only remember it.
    // The build wheel closes through the game's own key handler; that press is still handled, so its keyup never pauses.
    if (dialog.open || !otherDialogs().length) { const wheel = buildWheelOpen(); if (escape()) event.preventDefault(); else esc.keydown(now, { handled: wheel }); }
    else esc.keydown(now, { handled: true });
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

  // A menu closed while playing but the browser refused to relock (Escape is not a user gesture):
  // hide the cursor and the centred hint; the next click relocks.
  document.addEventListener('close', guard((event) => {
    const d = event.target;
    if (!(d instanceof HTMLDialogElement)) return;
    // Help returns to the menu on the title too; crew may close because a game is starting.
    if (d !== dialog && d === returnToPause) { delete d.dataset.fromPause; returnToPause = null; if (gameActive() || d.id === 'help') { open(); return; } }
    if (d.id !== 'inventory' && d !== dialog) return;
    setTimeout(guard(() => {
      if (gameActive() && !document.body.classList.contains('drag-look') && !document.pointerLockElement && !document.querySelector('dialog[open]')) startRelock();
    }), 150);
  }), { capture: true, signal: ac.signal });
  window.addEventListener('pointerdown', () => document.body.classList.remove('relock'), { capture: true, signal: ac.signal });

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
    if (act === 'settings') { setPanel(!panelOpen()); return; }
    if (act === 'quit') { setPanel(false); close(false); call(onQuit); return; }
    if (act === 'fullscreen') {
      const req = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
      Promise.resolve(req).catch(() => {}).finally(syncFullscreen);
      return;
    }
    if (act === 'logbook') { close(false); document.dispatchEvent(new CustomEvent('littleraft:open-logbook')); return; }
    if (act === 'help' || act === 'crew') {
      const target = document.getElementById(act);
      if (!(target instanceof HTMLDialogElement)) return;
      close(false); // stay paused; Escape or close returns to this menu
      returnToPause = target;
      target.dataset.fromPause = '1'; // game.js: do not relock when this closes
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
      // #options, its <style> and window.raftEscape are shared: a newer instance may already own them.
      // If none has, hand raftEscape back to the instance we replaced (a failed hot-swap resumes that engine).
      restoreGlobal(window, 'raftEscape', previousEscape, raftEscape);
    },
  };
}

export { DEFAULTS as SETTINGS_DEFAULTS, STORAGE_KEY as SETTINGS_STORAGE_KEY };
