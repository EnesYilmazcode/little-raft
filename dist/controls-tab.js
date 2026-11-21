// Little Raft controls tab: rebinding list + input feel settings. DOM ES module, nothing happens on import.
// createControlsTab({map: ActionMap, input?, container?, onChange?}) -> {element, mount(el), refresh(), capturing, dispose()}
import { ACTIONS } from './input-map.js';

const STYLE_ID = 'lrc-style';
const CSS = `
.lrc{--lrc-wood:#6b4423;--lrc-wood2:#4a2e17;--lrc-edge:#b07a3c;--lrc-ink:#f3e6cc;--lrc-dim:#c9b28c;--lrc-acc:#f0b04a;
  position:relative;display:grid;gap:14px;color:var(--lrc-ink);font:14px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;min-width:0}
.lrc *{box-sizing:border-box}
.lrc-panel{border:1px solid var(--lrc-edge);border-radius:10px;padding:12px 14px;
  background:repeating-linear-gradient(90deg,rgba(255,255,255,.025) 0 2px,transparent 2px 9px),linear-gradient(var(--lrc-wood),var(--lrc-wood2));
  box-shadow:0 0 0 1px rgba(232,176,96,.18) inset,0 6px 18px rgba(0,0,0,.35)}
.lrc-panel>h3{margin:0 0 8px;font:600 16px/1.2 Georgia,"Times New Roman",serif;letter-spacing:.05em;color:#f6ead2}
.lrc-head,.lrc-row{display:grid;grid-template-columns:minmax(0,1fr) repeat(3,minmax(64px,112px));gap:6px;align-items:center}
.lrc-head{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--lrc-dim);padding:0 0 4px;text-align:center}
.lrc-head span:first-child{text-align:left}
.lrc-row{padding:3px 0;border-top:1px solid rgba(176,122,60,.28)}
.lrc-row>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lrc button{font:600 13px/1 system-ui,sans-serif;color:var(--lrc-ink);cursor:pointer;border-radius:7px;border:1px solid var(--lrc-edge);
  background:rgba(28,16,6,.45);padding:7px 6px;min-height:30px}
.lrc button:hover{border-color:#d89a50;background:rgba(60,36,14,.7);transform:none}
.lrc button:focus-visible,.lrc input:focus-visible{outline:2px solid var(--lrc-acc);outline-offset:2px}
.lrc-slot{width:100%;font-size:12.5px!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lrc-slot.lrc-empty{color:rgba(243,230,204,.38);font-weight:400}
.lrc .lrc-slot.lrc-wait{background:var(--lrc-acc);color:#1a1206;border-color:#ffd48a;animation:lrc-pulse 1s ease-in-out infinite}
@keyframes lrc-pulse{50%{box-shadow:0 0 0 4px rgba(240,176,74,.3)}}
.lrc-opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px 18px}
.lrc-opt{display:grid;grid-template-columns:1fr auto;gap:4px 10px;align-items:center}
.lrc-opt output{color:var(--lrc-acc);font-variant-numeric:tabular-nums;text-align:right}
.lrc input{flex:none;padding:0;border:0;border-radius:0;background:none;box-shadow:none;color:inherit;font-size:inherit;text-transform:none;letter-spacing:normal}
.lrc-opt input[type=range]{grid-column:1/-1;width:100%;margin:0;accent-color:#e8a23a}
.lrc-check{display:flex;gap:8px;align-items:center;cursor:pointer}
.lrc-check input{accent-color:#e8a23a;width:16px;height:16px;margin:0}
.lrc-seg{display:inline-flex;border:1px solid var(--lrc-edge);border-radius:7px;overflow:hidden}
.lrc-seg button{border:0;border-radius:0;min-height:26px;padding:5px 10px;background:transparent}
.lrc-seg button[aria-pressed=true]{background:var(--lrc-acc);color:#1a1206}
.lrc-bar{position:sticky;top:0;z-index:2;padding:8px 12px;border-radius:10px;border:1px solid var(--lrc-edge);background:rgba(40,24,10,.94);box-shadow:0 6px 14px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.lrc-status{flex:1 1 240px;color:var(--lrc-dim);font-size:13px;min-height:2.7em;display:flex;align-items:center}
.lrc-status b{color:var(--lrc-acc)}
.lrc-reset{padding:9px 14px!important}
.lrc-toast{position:sticky;bottom:8px;justify-self:center;max-width:100%;padding:9px 16px;border-radius:999px;border:1px solid #e8b46a;
  background:rgba(26,16,6,.92);color:var(--lrc-ink);font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.45);opacity:0;transform:translateY(6px);
  transition:opacity .2s,transform .2s;pointer-events:none}
.lrc-toast.lrc-show{opacity:1;transform:none}
@media (max-width:520px){.lrc-head,.lrc-row{grid-template-columns:minmax(0,1fr) repeat(3,minmax(52px,1fr))}
  .lrc-row>span{white-space:normal;line-height:1.15}.lrc-slot{white-space:normal;line-height:1.15;font-size:11.5px!important;padding:5px 3px;overflow-wrap:anywhere}}
`;

const GROUP_ORDER = ['Movement', 'Actions', 'Hotbar', 'Gamepad'];
const SLOTS = [['keys', 0, 'Key 1'], ['keys', 1, 'Key 2'], ['pad', 0, 'Gamepad']];
const SLIDERS = {
  mouseSmoothing: { label: 'Mouse smoothing', min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
  padDeadzone: { label: 'Stick deadzone', min: 0, max: 0.5, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
  padCurve: { label: 'Stick response curve', min: 1, max: 4, step: 0.1, fmt: (v) => v.toFixed(1) },
  padLookSpeed: { label: 'Gamepad look speed', min: 0.5, max: 6, step: 0.1, fmt: (v) => v.toFixed(1) },
};
const CHECKS = { invertY: 'Invert mouse Y', padInvertY: 'Invert gamepad Y' };
const MODES = { sprintMode: 'Sprint', crouchMode: 'Crouch' };
const PRESS = 0.5, AXIS = 0.7;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID; s.textContent = CSS;
  document.head.appendChild(s);
}

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}

function padSnapshot() {
  const out = [];
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads || []) {
    if (!p || !p.connected) continue;
    out.push({ index: p.index, buttons: p.buttons.map((b) => (typeof b === 'object' ? b.pressed || b.value > PRESS : b > PRESS)), axes: [...p.axes] });
  }
  return out;
}

export function createControlsTab({ map, input = null, container = null, onChange = null } = {}) {
  if (!map) throw new Error('createControlsTab: map (ActionMap) is required');
  ensureStyle();
  const settings = () => map.settings || {};
  const actions = ACTIONS.filter((a) => map.bindingsFor(a.id));
  const groups = [...new Set([...GROUP_ORDER, ...actions.map((a) => a.group)])]
    .map((g) => [g, actions.filter((a) => a.group === g)]).filter(([, list]) => list.length);
  const nameOf = (id) => (ACTIONS.find((a) => a.id === id) || { label: id }).label;
  const label = (code) => (map.label ? map.label(code) : code);

  const root = h('div', { class: 'lrc', role: 'region', 'aria-label': 'Controls' });
  const status = h('div', { class: 'lrc-status', 'aria-live': 'polite' });
  const toast = h('div', { class: 'lrc-toast', role: 'status', 'aria-live': 'polite' });
  const slotButtons = []; // {btn, id, device, slot}
  const optionEls = {};
  let cap = null; // {id, device, slot, btn, base, raf}
  let swallowClick = false, toastTimer = 0, tailUntil = 0, disposed = false;

  function changed() {
    if (!map.autoSave && map.save) map.save();
    if (onChange) onChange(map);
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('lrc-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('lrc-show'), 2600);
  }

  // ---- bindings list ----------------------------------------------------
  const lists = groups.map(([g, list]) => {
    const head = h('div', { class: 'lrc-head', 'aria-hidden': 'true' }, h('span', { text: 'Action' }), ...SLOTS.map(([, , t]) => h('span', { text: t })));
    const rows = list.map((a) => {
      const cells = SLOTS.map(([device, slot, t]) => {
        const btn = h('button', { type: 'button', class: 'lrc-slot' });
        btn.addEventListener('click', () => (cap && cap.btn === btn ? stopCapture() : startCapture(a.id, device, slot, btn)));
        slotButtons.push({ btn, id: a.id, device, slot, slotName: t });
        return btn;
      });
      return h('div', { class: 'lrc-row', role: 'group', 'aria-label': a.label }, h('span', { text: a.label, title: a.label }), ...cells);
    });
    return h('section', { class: 'lrc-panel', 'aria-label': g }, h('h3', { text: g }), head, ...rows);
  });

  function paintSlot(s) {
    const code = (map.bindingsFor(s.id)?.[s.device] || [])[s.slot];
    const waiting = cap && cap.btn === s.btn;
    s.btn.classList.toggle('lrc-wait', !!waiting);
    s.btn.classList.toggle('lrc-empty', !waiting && !code);
    s.btn.textContent = waiting ? 'Press…' : code ? label(code) : '—';
    s.btn.title = code ? label(code) : 'Unbound';
    s.btn.setAttribute('aria-label', `${nameOf(s.id)}, ${s.slotName}: ${waiting ? 'waiting for input' : code ? label(code) : 'unbound'}. Activate to rebind.`);
  }

  // ---- options ----------------------------------------------------------
  const optGrid = h('div', { class: 'lrc-opts' });
  for (const [k, text] of Object.entries(CHECKS)) {
    const box = h('input', { type: 'checkbox', id: `lrc-${k}` });
    box.addEventListener('change', () => { map.setSetting(k, box.checked); changed(); refresh(); });
    optionEls[k] = { box };
    optGrid.append(h('label', { class: 'lrc-check', for: `lrc-${k}` }, box, h('span', { text: text })));
  }
  for (const [k, text] of Object.entries(MODES)) {
    const btns = ['hold', 'toggle'].map((m) => {
      const b = h('button', { type: 'button', text: m[0].toUpperCase() + m.slice(1), 'aria-pressed': 'false' });
      b.addEventListener('click', () => { map.setSetting(k, m); changed(); refresh(); });
      return b;
    });
    optionEls[k] = { btns };
    optGrid.append(h('div', { class: 'lrc-opt' }, h('span', { id: `lrc-${k}-l`, text }), h('div', { class: 'lrc-seg', role: 'group', 'aria-labelledby': `lrc-${k}-l` }, ...btns)));
  }
  for (const [k, s] of Object.entries(SLIDERS)) {
    const range = h('input', { type: 'range', id: `lrc-${k}`, min: s.min, max: s.max, step: s.step });
    const out = h('output', { for: `lrc-${k}` });
    range.addEventListener('input', () => { map.setSetting(k, Number(range.value)); out.textContent = s.fmt(Number(settings()[k] ?? range.value)); });
    range.addEventListener('change', () => { changed(); refresh(); });
    optionEls[k] = { range, out, s };
    optGrid.append(h('div', { class: 'lrc-opt' }, h('label', { for: `lrc-${k}`, text: s.label }), out, range));
  }
  const reset = h('button', { type: 'button', class: 'lrc-reset', text: 'Reset all to defaults' });
  reset.addEventListener('click', () => { stopCapture(); map.resetAll(); changed(); refresh(); showToast('Controls reset to defaults'); });

  root.append(
    h('div', { class: 'lrc-bar' }, status, reset),
    h('section', { class: 'lrc-panel', 'aria-label': 'Input options' }, h('h3', { text: 'Feel' }), optGrid),
    ...lists,
    toast,
  );

  function refresh() {
    for (const s of slotButtons) paintSlot(s);
    const st = settings();
    for (const [k, o] of Object.entries(optionEls)) {
      if (o.box) o.box.checked = !!st[k];
      if (o.btns) o.btns.forEach((b, i) => b.setAttribute('aria-pressed', String((st[k] || 'hold') === (i ? 'toggle' : 'hold'))));
      if (o.range && st[k] != null) { o.range.value = st[k]; o.out.textContent = o.s.fmt(Number(st[k])); }
    }
    status.innerHTML = `<span>${cap
      ? `Binding <b>${nameOf(cap.id)}</b>: ${cap.device === 'pad' ? 'press a gamepad button' : 'press a key or mouse button'}… <b>Esc</b> to cancel, <b>Backspace</b> to clear`
      : 'Select a slot to rebind it.'}</span>`;
  }

  // ---- capture ----------------------------------------------------------
  function assign(code) {
    const { id, device, slot } = cap;
    const res = map.rebind(id, code, { slot, device }) || {};
    stopCapture();
    if (res.ok === false) {
      showToast(res.reason === 'reserved' ? 'Esc is reserved for Pause' : `${label(code)} can't be bound here`);
    } else if (!res.unchanged) {
      if (res.swappedWith) {
        const o = nameOf(res.swappedWith);
        showToast(res.swappedCode ? `${label(code)} taken from ${o} — ${o} now uses ${label(res.swappedCode)}` : `${label(code)} taken from ${o} — ${o} is now unbound`);
      }
      changed();
    }
    refresh();
  }

  function clearSlot() {
    const { id, device, slot } = cap;
    stopCapture();
    if (map.unbind(id, slot, device) === false) showToast('Pause must keep Esc');
    else changed();
    refresh();
  }

  const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };

  const inTail = (e) => (e.type === 'keyup' || e.type === 'mouseup') && performance.now() < tailUntil;
  function onKey(e) {
    if (!cap) { if (inTail(e)) swallow(e); return; }
    swallow(e);
    if (e.type !== 'keydown' || e.repeat) return;
    if (e.code === 'Escape') { const b = cap.btn; stopCapture(); refresh(); b.focus(); return; }
    if (e.code === 'Backspace' || e.code === 'Delete') { const b = cap.btn; clearSlot(); b.focus(); return; }
    if (cap.device === 'keys' && e.code) { const b = cap.btn; assign(e.code); b.focus(); }
  }
  function onMouse(e) {
    if (!cap) { if (inTail(e)) swallow(e); return; }
    swallow(e);
    if (e.type !== 'mousedown') return;
    swallowClick = e.button === 0;
    const b = cap.btn;
    if (cap.device === 'keys') assign('Mouse' + e.button);
    else { stopCapture(); refresh(); } // clicking cancels a gamepad capture
    b.focus();
  }
  function onWheel(e) {
    if (!cap || cap.device !== 'keys' || !e.deltaY) return;
    swallow(e);
    assign(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
  }
  function onClick(e) {
    if (cap || (swallowClick && performance.now() < tailUntil)) swallow(e);
    swallowClick = false;
  }
  function onContext(e) { if (cap || performance.now() < tailUntil) swallow(e); }

  function pollPad() {
    if (!cap || cap.device !== 'pad' || disposed) return;
    const now = padSnapshot();
    for (const p of now) {
      const was = cap.base.find((b) => b.index === p.index) || { buttons: [], axes: [] };
      const bi = p.buttons.findIndex((on, i) => on && !was.buttons[i]);
      if (bi >= 0) { assign('Pad' + bi); return; }
      const ai = p.axes.findIndex((v, i) => Math.abs(v) > AXIS && Math.abs(was.axes[i] || 0) < AXIS * 0.5);
      if (ai >= 0) { assign(`PadAxis${ai}${p.axes[ai] < 0 ? '-' : '+'}`); return; }
      // releasing a held control re-arms it, so a button held when capture began can still be chosen
      p.buttons.forEach((on, i) => { if (!on) was.buttons[i] = false; });
      p.axes.forEach((v, i) => { if (Math.abs(v) < AXIS * 0.5) was.axes[i] = 0; });
    }
    for (const p of now) if (!cap.base.some((b) => b.index === p.index)) cap.base.push({ index: p.index, buttons: [...p.buttons], axes: [...p.axes] });
    cap.raf = requestAnimationFrame(pollPad);
  }

  const LISTEN = [['keydown', onKey], ['keyup', onKey], ['keypress', onKey], ['mousedown', onMouse], ['mouseup', onMouse],
    ['wheel', onWheel], ['click', onClick], ['contextmenu', onContext]];
  let listening = false;
  function listen(on) {
    if (on === listening) return;
    listening = on;
    for (const [t, f] of LISTEN) (on ? window.addEventListener : window.removeEventListener).call(window, t, f, { capture: true, passive: false });
  }

  function startCapture(id, device, slot, btn) {
    stopCapture();
    if (input && input.clear) input.clear();
    cap = { id, device, slot, btn, base: device === 'pad' ? padSnapshot() : [], raf: 0 };
    // attach after the activating click/keydown has finished dispatching
    setTimeout(() => { if (cap && cap.btn === btn) listen(true); }, 0);
    if (device === 'pad') cap.raf = requestAnimationFrame(pollPad);
    refresh();
  }

  function stopCapture() {
    if (!cap) return;
    cancelAnimationFrame(cap.raf);
    cap = null;
    tailUntil = performance.now() + 250;
    // keep listening one tick so the matching keyup/mouseup/click is swallowed too
    setTimeout(() => { if (!cap) listen(false); }, 250);
  }

  refresh();
  if (container) container.appendChild(root);

  return {
    element: root,
    mount(el) { el.appendChild(root); refresh(); return this; },
    refresh,
    get capturing() { return !!cap; },
    cancel() { stopCapture(); refresh(); },
    dispose() {
      disposed = true;
      stopCapture(); listen(false);
      clearTimeout(toastTimer);
      root.remove();
    },
  };
}
