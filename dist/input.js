// DOM + Gamepad input layer. Turns keyboard / mouse / pointer-lock / Gamepad API state into
// per-frame action state driven by an ActionMap (see input-map.js). Call update(dt) once per
// frame before reading anything; edges (pressed/released), look delta, hotbar step and slot
// are all consumed per frame.
import { ACTIONS, SETTINGS_DEFAULTS, shapeStick, smoothLook } from './input-map.js?build=v3-survival-ae77fa84ac2b';
import { createLookFilter } from './input-rules.js?build=v3-survival-ae77fa84ac2b';

const MOUSE_LOOK = 0.0022;          // radians per pixel at sensitivity 1
const WHEEL_STEP = 40;              // pixel-mode wheel delta per hotbar notch
const TRIGGER_ON = 0.5, TRIGGER_OFF = 0.4; // analog -> digital hysteresis (triggers, axis codes)
const ACTIVE_AXIS = 0.3;            // stick deflection that marks a pad as "in use"
const FIELD = 'input, textarea, select, [contenteditable], [contenteditable="true"]';
const HOTBAR_IDS = ['hotbar1', 'hotbar2', 'hotbar3', 'hotbar4', 'hotbar5', 'hotbar6', 'hotbar7', 'hotbar8', 'hotbar9', 'hotbar0'];
const MOUSE_CODES = ['Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4'];
const PAD_BACK = 'Pad1';            // standard-mapping B / cancel: closes menus while input is blocked
const NO_PADS = [];
// interned pad code strings so polling never builds them per frame
const PAD_CODES = [], AXIS_NEG = [], AXIS_POS = [];
const padCode = i => PAD_CODES[i] ?? (PAD_CODES[i] = 'Pad' + i);
const axisCode = (i, sign) => sign < 0 ? AXIS_NEG[i] ?? (AXIS_NEG[i] = `PadAxis${i}-`) : AXIS_POS[i] ?? (AXIS_POS[i] = `PadAxis${i}+`);
const isLeftStickCode = c => c.startsWith('PadAxis0') || c.startsWith('PadAxis1');

const isField = t => !!t && (t.isContentEditable === true || (typeof t.closest === 'function' && !!t.closest(FIELD)));
const len = (x, y) => Math.hypot(x, y);

export function createInput({
  target = globalThis.window, element = null, map, isBlocked = () => false, onAction = null,
  sensitivity = 1, // number or () => number (game's options.sensitivity)
  getGamepads = () => globalThis.navigator?.getGamepads?.() ?? [],
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  doc = target?.document ?? globalThis.document,
  // action ids whose pad bindings still fire a 'down' edge while blocked (onAction(id, 'down', {blocked:true})),
  // plus PAD_BACK as 'back', so a gamepad can close the menu it opened. Nothing else reacts while blocked.
  blockedActions = [],
} = {}) {
  if (!map) throw new Error('createInput: map (ActionMap) required');
  const ids = ACTIONS.map(a => a.id);
  const menuIds = new Set(blockedActions), menu = [];
  const ac = new AbortController(), signal = ac.signal;
  const on = (t, type, fn, opts = {}) => t?.addEventListener?.(type, fn, { ...opts, signal });

  const held = new Set();             // keyboard + mouse codes physically down (as far as we know)
  const taps = new Map();             // code -> down-event count since last update (catches sub-frame taps, wheel notches)
  let padHeld = new Set();            // pad codes active this frame
  let padNext = new Set();            // double buffer for padHeld (swapped each poll)
  const padSuppressed = new Set();    // pad codes held through a clear(): ignored until released
  const state = new Map(ids.map(id => [id, { down: false, pressed: false, released: false }]));
  const states = ids.map(id => state.get(id)); // indexed like ids
  let mouseX = 0, mouseY = 0, wheelAcc = 0, wasBlocked = false;
  const lookFilter = createLookFilter();
  const smooth = { x: 0, y: 0 }, smoothed = [0, 0];
  // per-frame results are reused in place; the public getters below hand out copies
  let step = 0, slot = -1;
  const look = { dx: 0, dy: 0 }, moveVec = { forward: 0, strafe: 0 }, leftStick = [0, 0], rightStick = [0, 0], padLook = [0, 0], trig = { throw: 0, reel: 0 };
  let sprintOn = false, crouchOn = false;
  const connected = new Set(), lastActive = new Map(), padSig = new Map();
  let activeIndex = -1;
  const api = { activeDevice: 'kbm' };

  const opt = k => map.settings?.[k] ?? SETTINGS_DEFAULTS[k]; // live read, no per-frame merged copy
  const sens = () => { const s = typeof sensitivity === 'function' ? sensitivity() : sensitivity; return Number.isFinite(s) ? s : 1; };
  const locked = () => !element || doc?.pointerLockElement === element;
  const tap = code => taps.set(code, (taps.get(code) || 0) + 1);

  function press(code) { if (!held.has(code)) { held.add(code); tap(code); } api.activeDevice = 'kbm'; }
  function releaseMouse() { for (const c of MOUSE_CODES) held.delete(c); }
  // quiet(): drop everything transient (taps, mouse, wheel, pad, smoothing) but keep held keys, so keys
  // held through a panel still count when it closes (input-rules.js keyDecision). clear() also forgets held keys.
  function quiet() {
    taps.clear(); releaseMouse();
    for (const c of padHeld) padSuppressed.add(c);
    padHeld.clear();
    mouseX = mouseY = wheelAcc = 0; smooth.x = smooth.y = 0; lookFilter.reset();
    resetPadAnalog(); sprintOn = false; crouchOn = false;
  }
  function clear() { held.clear(); quiet(); }
  function resetPadAnalog() { leftStick[0] = leftStick[1] = 0; trig.throw = trig.reel = 0; }

  // ---------- keyboard ----------
  on(target, 'keydown', e => {
    if (isField(e.target)) return;
    if (e.repeat) return;                       // never an edge; also keeps a cleared key released until re-pressed
    if (e.metaKey && !/^Meta/.test(e.code)) return; // Cmd+X: macOS swallows the keyup, so never record it
    if (isBlocked()) { held.add(e.code); return; } // tracked (no tap, no preventDefault) so it counts once the panel closes
    press(e.code);
    // Ctrl chords pass through (Ctrl+R, devtools) unless Ctrl is itself a held binding (crouch): then crouch+S/D/A
    // must not open the browser's save/bookmark/select-all, which also blurs the window mid-move.
    const ctrlBound = e.ctrlKey && !e.shiftKey && ['ControlLeft', 'ControlRight'].some(c => held.has(c) && map.actionFor?.(c)?.length);
    if ((!e.ctrlKey || ctrlBound) && !e.altKey && map.actionFor?.(e.code)?.length && e.code !== 'Escape') e.preventDefault?.();
  });
  on(target, 'keyup', e => {                    // always honoured, even from form fields, so nothing sticks
    if (/^Meta/.test(e.code)) { held.clear(); return; } // mac: keyups for other keys were lost while Meta was down
    held.delete(e.code);
  });

  // ---------- mouse ----------
  on(element || target, 'mousedown', e => {
    if (isBlocked() || isField(e.target) || !locked()) return;
    press('Mouse' + e.button);
  });
  on(target, 'mouseup', e => { held.delete('Mouse' + e.button); });
  on(doc, 'mousemove', e => {
    if (!locked() || isBlocked()) return;
    // spike filter: drops the first sample after lock (the jump to centre) and isolated pointer-lock
    // glitches, but a big fast flick that continues the motion still turns the camera
    const [x, y] = lookFilter.filter(e.movementX || 0, e.movementY || 0);
    mouseX += x; mouseY += y; api.activeDevice = 'kbm';
  });
  on(element || target, 'wheel', e => {
    if (isBlocked() || !locked()) return;
    if (element) e.preventDefault?.();
    if (e.shiftKey || e.ctrlKey || e.altKey) return; // modifier+wheel fine-rotates a held placeable (game.js), never steps the hotbar
    wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    // at most one slot per event: a mouse notch is deltaY 100 (or 3 lines) and must not skip a slot; trackpads accumulate
    if (Math.abs(wheelAcc) >= WHEEL_STEP) { tap(wheelAcc > 0 ? 'WheelDown' : 'WheelUp'); wheelAcc = 0; }
    api.activeDevice = 'kbm';
  }, { passive: false });
  on(doc, 'pointerlockchange', () => {
    if (doc.pointerLockElement && (!element || doc.pointerLockElement === element)) lookFilter.reset({ dropFirst: true });
    else { releaseMouse(); mouseX = mouseY = 0; lookFilter.reset(); }
  });

  // ---------- focus ----------
  on(target, 'blur', clear);
  on(doc, 'visibilitychange', () => { if (doc.visibilityState === 'hidden') clear(); });

  // ---------- gamepad ----------
  const seed = () => { try { for (const p of getGamepads() || []) if (p) connected.add(p.index); } catch {} };
  seed();
  on(target, 'gamepadconnected', e => { if (e.gamepad) connected.add(e.gamepad.index); else seed(); });
  on(target, 'gamepaddisconnected', e => {
    const i = e.gamepad?.index;
    connected.delete(i); lastActive.delete(i); padSig.delete(i);
    if (i === activeIndex || connected.size === 0) { activeIndex = -1; padHeld.clear(); padSuppressed.clear(); resetPadAnalog(); }
  });
  const btnValue = b => !b ? 0 : typeof b === 'number' ? b : Number.isFinite(b.value) && (b.value > 0 || !b.pressed) ? b.value : b.pressed ? 1 : 0;

  // activity = a change while something is engaged, so a pad merely held down does not keep the focus
  function trackActivity(p, t) {
    const buttons = p.buttons || NO_PADS, axes = p.axes || NO_PADS, nb = buttons.length, n = nb + axes.length;
    let sig = padSig.get(p.index), changed = false, engaged = false;
    if (!sig || sig.length !== n) { sig = new Int8Array(n); padSig.set(p.index, sig); changed = true; }
    for (let i = 0; i < n; i++) {
      const v = i < nb ? (btnValue(buttons[i]) > TRIGGER_ON ? 1 : 0) : (Math.abs(axes[i - nb]) > ACTIVE_AXIS ? Math.sign(axes[i - nb]) : 0);
      if (v) engaged = true;
      if (sig[i] !== v) { sig[i] = v; changed = true; }
    }
    if (engaged && changed) lastActive.set(p.index, t);
    else if (!lastActive.has(p.index)) lastActive.set(p.index, -Infinity);
  }
  const usable = p => p && p.mapping === 'standard' && p.connected !== false;

  function pollPad(dt) {
    let pads = NO_PADS;
    try { pads = getGamepads() || NO_PADS; } catch {}
    const t = now(), count = pads.length || 0;
    for (let i = 0; i < count; i++) {             // re-polled each frame: Chrome hands out snapshots
      const p = pads[i];
      if (!usable(p)) continue;                   // defaults only make sense on the standard layout
      connected.add(p.index);
      trackActivity(p, t);
    }
    let pad = null, bestT = -Infinity;
    for (let i = 0; i < count; i++) {
      const p = pads[i];
      if (usable(p) && lastActive.has(p.index) && (!pad || lastActive.get(p.index) > bestT)) { pad = p; bestT = lastActive.get(p.index); }
    }
    if (!pad) { activeIndex = -1; padHeld.clear(); resetPadAnalog(); padLook[0] = padLook[1] = 0; return padLook; }
    if (pad.index !== activeIndex) { padHeld.clear(); activeIndex = pad.index; }
    const next = padNext, buttons = pad.buttons || NO_PADS, axes = pad.axes || NO_PADS;
    next.clear();
    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i], v = btnValue(b), code = padCode(i);
      if (v > (padHeld.has(code) ? TRIGGER_OFF : TRIGGER_ON) || (i !== 6 && i !== 7 && b?.pressed)) next.add(code);
    }
    for (let i = 0; i < axes.length; i++) {
      const a = axes[i], neg = axisCode(i, -1), pos = axisCode(i, 1);
      if (-a > (padHeld.has(neg) ? TRIGGER_OFF : TRIGGER_ON)) next.add(neg);
      if (a > (padHeld.has(pos) ? TRIGGER_OFF : TRIGGER_ON)) next.add(pos);
    }
    for (const c of padSuppressed) if (!next.has(c)) padSuppressed.delete(c);
    for (const c of padSuppressed) next.delete(c);
    for (const c of next) if (!padHeld.has(c)) tap(c);
    padNext = padHeld; padHeld = next;
    const tv = i => padSuppressed.has(padCode(i)) ? 0 : Math.min(1, Math.max(0, btnValue(buttons[i])));
    trig.throw = tv(7); trig.reel = tv(6);
    shapeStick(axes[0] || 0, axes[1] || 0, opt('padDeadzone'), opt('padCurve'), leftStick);
    const [rx, ry] = shapeStick(axes[2] || 0, axes[3] || 0, opt('padDeadzone'), opt('padCurve'), rightStick);
    if (next.size || len(leftStick[0], leftStick[1]) || rx || ry) api.activeDevice = 'pad';
    const k = opt('padLookSpeed') * dt;
    padLook[0] = rx * k; padLook[1] = ry * k * (opt('padInvertY') ? -1 : 1);
    return padLook;
  }

  // ---------- frame ----------
  const bindingOf = id => map.bindings?.[id] ?? map.bindingsFor?.(id) ?? null; // live entry, never mutated here
  function anyOn(list) {
    if (list) for (let i = 0; i < list.length; i++) { const c = list[i]; if (c && (held.has(c) || padHeld.has(c))) return true; }
    return false;
  }
  function tapsIn(list) {
    let n = 0;
    if (list && taps.size) for (let i = 0; i < list.length; i++) { const c = list[i]; if (c) n += taps.get(c) || 0; }
    return n;
  }
  // digital movement: left-stick axis codes are excluded, the analog stick already covers them
  function digital(id) {
    const b = bindingOf(id); if (!b) return 0;
    const keys = b.keys, pad = b.pad;
    if (keys) for (let i = 0; i < keys.length; i++) if (keys[i] && held.has(keys[i])) return 1;
    if (pad) for (let i = 0; i < pad.length; i++) { const c = pad[i]; if (c && padHeld.has(c) && !isLeftStickCode(c)) return 1; }
    return 0;
  }

  function update(dt = 0) {
    const blocked = isBlocked();
    // resuming from a panel: keys still held become down without a pressed edge, so the key that
    // closed the panel (Tab/E/Esc) does not re-fire its action
    const resume = !blocked && wasBlocked;
    wasBlocked = blocked;
    if (blocked) quiet();                          // held pad buttons become suppressed: the opening press never closes
    let pl = null;
    if (connected.size && (!blocked || menuIds.size)) {
      pl = pollPad(dt);
      if (blocked) { pl = null; resetPadAnalog(); }
    }
    menu.length = 0;
    if (blocked && menuIds.size) {
      for (const id of menuIds) if (tapsIn(bindingOf(id)?.pad)) menu.push(id);
      if (taps.get(PAD_BACK) && !menu.length) menu.push('back');
    }
    let stepNow = 0;
    for (let a = 0; a < ids.length; a++) {
      const id = ids[a], st = states[a], was = st.down, b = blocked ? null : bindingOf(id);
      const n = b && !resume ? tapsIn(b.keys) + tapsIn(b.pad) : 0;
      st.down = !!b && (anyOn(b.keys) || anyOn(b.pad));
      st.pressed = !resume && !was && (st.down || n > 0);
      st.released = (was && !st.down) || (!was && !st.down && n > 0); // a sub-frame tap is pressed+released
      if (id === 'hotbarNext') stepNow += Math.max(st.pressed ? 1 : 0, n);
      if (id === 'hotbarPrev') stepNow -= Math.max(st.pressed ? 1 : 0, n);
    }
    taps.clear();
    step += stepNow;
    for (let i = 0; i < HOTBAR_IDS.length; i++) if (state.get(HOTBAR_IDS[i])?.pressed) slot = i;
    if (onAction) for (let i = 0; i < menu.length; i++) { try { onAction(menu[i], 'down', { blocked: true }); } catch (e) { console.error('onAction', menu[i], e); } }
    if (onAction) for (let a = 0; a < ids.length; a++) {
      const id = ids[a], st = states[a];
      try { if (st.pressed) onAction(id, 'down'); if (st.released) onAction(id, 'up'); } catch (e) { console.error('onAction', id, e); }
    }
    // movement: digital keys/buttons + shaped left stick, clamped to the unit circle
    let f = 0 - (leftStick[1] || 0), r = leftStick[0] || 0; // 0 - x: never -0
    if (!blocked) { f += digital('moveForward') - digital('moveBack'); r += digital('moveRight') - digital('moveLeft'); }
    const m = len(f, r); if (m > 1) { f /= m; r /= m; }
    moveVec.forward = f; moveVec.strafe = r;
    if (opt('sprintMode') === 'toggle') { if (state.get('sprint').pressed) sprintOn = !sprintOn; if (m < 0.1) sprintOn = false; }
    if (opt('crouchMode') === 'toggle' && state.get('crouch').pressed) crouchOn = !crouchOn;
    // look: mouse (smoothed, sensitivity, invertY) + right stick (already radians)
    const sm = smoothLook(smooth, mouseX, mouseY, opt('mouseSmoothing') || 0, smoothed);
    mouseX = mouseY = 0;
    const k = MOUSE_LOOK * sens();
    look.dx += sm[0] * k + (pl ? pl[0] : 0);
    look.dy += sm[1] * k * (opt('invertY') ? -1 : 1) + (pl ? pl[1] : 0);
  }

  Object.defineProperty(api, 'activePad', { get: () => activeIndex, enumerable: true });
  const take = (get, reset) => { const v = get(); reset(); return v; };
  const lookDelta = () => { const v = { dx: look.dx, dy: look.dy }; look.dx = look.dy = 0; return v; };
  return Object.assign(api, {
    update, clear,
    down: id => !!state.get(id)?.down,
    shiftHeld: () => held.has('ShiftLeft') || held.has('ShiftRight'),
    altHeld: () => held.has('AltLeft') || held.has('AltRight'),
    pressed: id => !!state.get(id)?.pressed,
    released: id => !!state.get(id)?.released,
    move: () => ({ ...moveVec }),
    lookDelta,
    sprinting: () => opt('sprintMode') === 'toggle' ? sprintOn : !!state.get('sprint')?.down,
    crouching: () => opt('crouchMode') === 'toggle' ? crouchOn : !!state.get('crouch')?.down,
    triggers: () => ({ ...trig }),
    hotbarStep: () => take(() => step, () => { step = 0; }),
    hotbarSlot: () => take(() => slot, () => { slot = -1; }),
    dispose() { ac.abort(); clear(); connected.clear(); lastActive.clear(); padSig.clear(); },
  });
}
