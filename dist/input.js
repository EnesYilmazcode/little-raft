// DOM + Gamepad input layer. Turns keyboard / mouse / pointer-lock / Gamepad API state into
// per-frame action state driven by an ActionMap (see input-map.js). Call update(dt) once per
// frame before reading anything; edges (pressed/released), look delta, hotbar step and slot
// are all consumed per frame.
import { ACTIONS, SETTINGS_DEFAULTS, shapeStick, smoothLook } from './input-map.js';

const MOUSE_LOOK = 0.0022;          // radians per pixel at sensitivity 1
const SPIKE = 300;                  // |movementX/Y| above this is a Chrome pointer-lock glitch: drop it
const WHEEL_STEP = 40;              // pixel-mode wheel delta per hotbar notch
const TRIGGER_ON = 0.5, TRIGGER_OFF = 0.4; // analog -> digital hysteresis (triggers, axis codes)
const ACTIVE_AXIS = 0.3;            // stick deflection that marks a pad as "in use"
const FIELD = 'input, textarea, select, [contenteditable], [contenteditable="true"]';
const HOTBAR_IDS = ['hotbar1', 'hotbar2', 'hotbar3', 'hotbar4', 'hotbar5', 'hotbar6', 'hotbar7', 'hotbar8', 'hotbar9', 'hotbar0'];
const MOUSE_CODES = ['Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4'];

const isField = t => !!t && (t.isContentEditable === true || (typeof t.closest === 'function' && !!t.closest(FIELD)));
const len = (x, y) => Math.hypot(x, y);

export function createInput({
  target = globalThis.window, element = null, map, isBlocked = () => false, onAction = null,
  sensitivity = 1, // number or () => number (game's options.sensitivity)
  getGamepads = () => globalThis.navigator?.getGamepads?.() ?? [],
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  doc = target?.document ?? globalThis.document,
} = {}) {
  if (!map) throw new Error('createInput: map (ActionMap) required');
  const ids = ACTIONS.map(a => a.id);
  const ac = new AbortController(), signal = ac.signal;
  const on = (t, type, fn, opts = {}) => t?.addEventListener?.(type, fn, { ...opts, signal });

  const held = new Set();             // keyboard + mouse codes physically down (as far as we know)
  const taps = new Map();             // code -> down-event count since last update (catches sub-frame taps, wheel notches)
  let padHeld = new Set();            // pad codes active this frame
  const padSuppressed = new Set();    // pad codes held through a clear(): ignored until released
  const state = new Map(ids.map(id => [id, { down: false, pressed: false, released: false }]));
  let mouseX = 0, mouseY = 0, skipMove = false, wheelAcc = 0;
  const smooth = {};
  let look = { dx: 0, dy: 0 }, step = 0, slot = -1, moveVec = { forward: 0, strafe: 0 };
  let leftStick = [0, 0], trig = { throw: 0, reel: 0 };
  let sprintOn = false, crouchOn = false;
  const connected = new Set(), lastActive = new Map(), padSig = new Map();
  let activeIndex = -1;
  const api = { activeDevice: 'kbm' };

  const settings = () => ({ ...SETTINGS_DEFAULTS, ...(map.settings || {}) });
  const sens = () => { const s = typeof sensitivity === 'function' ? sensitivity() : sensitivity; return Number.isFinite(s) ? s : 1; };
  const locked = () => !element || doc?.pointerLockElement === element;
  const tap = code => taps.set(code, (taps.get(code) || 0) + 1);

  function press(code) { if (!held.has(code)) { held.add(code); tap(code); } api.activeDevice = 'kbm'; }
  function releaseMouse() { for (const c of MOUSE_CODES) held.delete(c); }
  function clear() {
    held.clear(); taps.clear(); releaseMouse();
    for (const c of padHeld) padSuppressed.add(c);
    padHeld = new Set();
    mouseX = mouseY = wheelAcc = 0; for (const k in smooth) delete smooth[k];
    leftStick = [0, 0]; trig = { throw: 0, reel: 0 }; sprintOn = false; crouchOn = false;
  }

  // ---------- keyboard ----------
  on(target, 'keydown', e => {
    if (isField(e.target) || isBlocked()) return;
    if (e.repeat) return;                       // never an edge; also keeps a cleared key released until re-pressed
    if (e.metaKey && !/^Meta/.test(e.code)) return; // Cmd+X: macOS swallows the keyup, so never record it
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
    if (skipMove) { skipMove = false; return; }  // first sample after lock carries the jump to centre
    const x = e.movementX || 0, y = e.movementY || 0;
    if (Math.abs(x) > SPIKE || Math.abs(y) > SPIKE) return;
    mouseX += x; mouseY += y; api.activeDevice = 'kbm';
  });
  on(element || target, 'wheel', e => {
    if (isBlocked() || !locked()) return;
    if (element) e.preventDefault?.();
    wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    // at most one slot per event: a mouse notch is deltaY 100 (or 3 lines) and must not skip a slot; trackpads accumulate
    if (Math.abs(wheelAcc) >= WHEEL_STEP) { tap(wheelAcc > 0 ? 'WheelDown' : 'WheelUp'); wheelAcc = 0; }
    api.activeDevice = 'kbm';
  }, { passive: false });
  on(doc, 'pointerlockchange', () => {
    if (doc.pointerLockElement && (!element || doc.pointerLockElement === element)) skipMove = true;
    else { releaseMouse(); mouseX = mouseY = 0; }
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
    if (i === activeIndex || connected.size === 0) { activeIndex = -1; padHeld = new Set(); padSuppressed.clear(); leftStick = [0, 0]; trig = { throw: 0, reel: 0 }; }
  });
  const btnValue = b => !b ? 0 : typeof b === 'number' ? b : Number.isFinite(b.value) && (b.value > 0 || !b.pressed) ? b.value : b.pressed ? 1 : 0;

  function pollPad(dt, s) {
    let pads = [];
    try { pads = Array.from(getGamepads() || []); } catch {}
    const t = now();
    for (const p of pads) {                        // re-polled each frame: Chrome hands out snapshots
      if (!p || p.connected === false || p.mapping !== 'standard') continue; // defaults only make sense on the standard layout
      connected.add(p.index);
      // activity = a change while something is engaged, so a pad merely held down does not keep the focus
      const sig = (p.buttons || []).map(b => btnValue(b) > TRIGGER_ON ? 1 : 0).join('') +
        (p.axes || []).map(a => Math.abs(a) > ACTIVE_AXIS ? Math.sign(a) : 0).join(',');
      if (/[1-]/.test(sig) && sig !== padSig.get(p.index)) lastActive.set(p.index, t);
      else if (!lastActive.has(p.index)) lastActive.set(p.index, -Infinity);
      padSig.set(p.index, sig);
    }
    let best = -1, bestT = -Infinity;
    for (const p of pads) if (p && p.mapping === 'standard' && p.connected !== false && lastActive.has(p.index) && (best < 0 || lastActive.get(p.index) > bestT)) { best = p.index; bestT = lastActive.get(p.index); }
    const pad = pads.find(p => p && p.index === best);
    if (!pad) { activeIndex = -1; padHeld = new Set(); leftStick = [0, 0]; trig = { throw: 0, reel: 0 }; return [0, 0]; }
    if (pad.index !== activeIndex) { padHeld = new Set(); activeIndex = pad.index; }
    const next = new Set(), buttons = pad.buttons || [], axes = pad.axes || [];
    buttons.forEach((b, i) => {
      const v = btnValue(b), code = 'Pad' + i;
      if (v > (padHeld.has(code) ? TRIGGER_OFF : TRIGGER_ON) || (i !== 6 && i !== 7 && b?.pressed)) next.add(code);
    });
    axes.forEach((a, i) => {
      for (const [sign, code] of [[-1, `PadAxis${i}-`], [1, `PadAxis${i}+`]])
        if (a * sign > (padHeld.has(code) ? TRIGGER_OFF : TRIGGER_ON)) next.add(code);
    });
    for (const c of padSuppressed) if (!next.has(c)) padSuppressed.delete(c);
    for (const c of padSuppressed) next.delete(c);
    for (const c of next) if (!padHeld.has(c)) tap(c);
    padHeld = next;
    const tv = i => padSuppressed.has('Pad' + i) ? 0 : Math.min(1, Math.max(0, btnValue(buttons[i])));
    trig = { throw: tv(7), reel: tv(6) };
    leftStick = shapeStick(axes[0] || 0, axes[1] || 0, s.padDeadzone, s.padCurve);
    const [rx, ry] = shapeStick(axes[2] || 0, axes[3] || 0, s.padDeadzone, s.padCurve);
    if (next.size || len(...leftStick) || rx || ry) api.activeDevice = 'pad';
    const k = s.padLookSpeed * dt;
    return [rx * k, ry * k * (s.padInvertY ? -1 : 1)];
  }

  // ---------- frame ----------
  const isOn = c => held.has(c) || padHeld.has(c);
  const isHeld = c => held.has(c), isPadHeld = c => padHeld.has(c);
  const tapsOf = list => { let n = 0; for (const c of list) n += taps.get(c) || 0; return n; };
  // Flat code lists per action, rebuilt only when the map's revision changes (every frame for maps without one).
  // padMove drops the left-stick axis codes: the analog stick already covers movement.
  let codeCache = null, codeRev;
  function bound() {
    const rev = map.revision;
    if (codeCache && rev !== undefined && rev === codeRev) return codeCache;
    codeCache = new Map(); codeRev = rev;
    for (const id of ids) {
      const b = map.bindingsFor(id) || {}, keys = (b.keys || []).filter(Boolean), pad = (b.pad || []).filter(Boolean);
      codeCache.set(id, { all: [...keys, ...pad], keys, padMove: pad.filter(c => !/^PadAxis[01]/.test(c)) });
    }
    return codeCache;
  }
  function update(dt = 0) {
    const s = settings(), blocked = isBlocked();
    if (blocked) clear();
    const padLook = !blocked && connected.size ? pollPad(dt, s) : [0, 0];
    const codesOf = bound();
    let stepNow = 0;
    for (const id of ids) {
      const codes = codesOf.get(id).all;
      const st = state.get(id), was = st.down, n = blocked ? 0 : tapsOf(codes);
      st.down = !blocked && codes.some(isOn);
      st.pressed = !was && (st.down || n > 0);
      st.released = (was && !st.down) || (!was && !st.down && n > 0); // a sub-frame tap is pressed+released
      if (id === 'hotbarNext') stepNow += Math.max(st.pressed ? 1 : 0, n);
      if (id === 'hotbarPrev') stepNow -= Math.max(st.pressed ? 1 : 0, n);
    }
    taps.clear();
    step += stepNow;
    for (let i = 0; i < HOTBAR_IDS.length; i++) if (state.get(HOTBAR_IDS[i])?.pressed) slot = i;
    if (onAction) for (const id of ids) {
      const st = state.get(id);
      try { if (st.pressed) onAction(id, 'down'); if (st.released) onAction(id, 'up'); } catch (e) { console.error('onAction', id, e); }
    }
    // movement: digital keys/buttons + shaped left stick, clamped to the unit circle
    // left-stick axis codes are excluded here: the analog stick below already covers them
    const d = id => blocked ? 0 : codesOf.get(id).keys.some(isHeld) || codesOf.get(id).padMove.some(isPadHeld) ? 1 : 0;
    let f = d('moveForward') - d('moveBack') - (leftStick[1] || 0), r = d('moveRight') - d('moveLeft') + (leftStick[0] || 0);
    const m = len(f, r); if (m > 1) { f /= m; r /= m; }
    moveVec = { forward: f, strafe: r };
    if (s.sprintMode === 'toggle') { if (state.get('sprint').pressed) sprintOn = !sprintOn; if (m < 0.1) sprintOn = false; }
    if (s.crouchMode === 'toggle' && state.get('crouch').pressed) crouchOn = !crouchOn;
    // look: mouse (smoothed, sensitivity, invertY) + right stick (already radians)
    const [sx, sy] = smoothLook(smooth, mouseX, mouseY, s.mouseSmoothing || 0);
    mouseX = mouseY = 0;
    const k = MOUSE_LOOK * sens();
    look = { dx: look.dx + sx * k + padLook[0], dy: look.dy + sy * k * (s.invertY ? -1 : 1) + padLook[1] };
  }

  Object.defineProperty(api, 'activePad', { get: () => activeIndex, enumerable: true });
  const take = (get, reset) => { const v = get(); reset(); return v; };
  return Object.assign(api, {
    update, clear,
    down: id => !!state.get(id)?.down,
    pressed: id => !!state.get(id)?.pressed,
    released: id => !!state.get(id)?.released,
    move: () => ({ ...moveVec }),
    lookDelta: () => take(() => look, () => { look = { dx: 0, dy: 0 }; }),
    sprinting: () => settings().sprintMode === 'toggle' ? sprintOn : !!state.get('sprint')?.down,
    crouching: () => settings().crouchMode === 'toggle' ? crouchOn : !!state.get('crouch')?.down,
    triggers: () => ({ ...trig }),
    hotbarStep: () => take(() => step, () => { step = 0; }),
    hotbarSlot: () => take(() => slot, () => { slot = -1; }),
    dispose() { ac.abort(); clear(); connected.clear(); lastActive.clear(); padSig.clear(); },
  });
}
