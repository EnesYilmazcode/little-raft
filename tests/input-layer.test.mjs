// Tests for the DOM + Gamepad input layer (dist/input.js) using fake EventTarget window/document.
// Run: node --test tests/input-layer.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { createInput } = await import(new URL('input.js', base));
const { ActionMap } = await import(new URL('input-map.js', base));

// ---------------------------------------------------------------- fakes

function fire(target, type, props = {}) {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v, configurable: true });
  target.dispatchEvent(e);
  return e;
}
const btn = (value = 0) => ({ pressed: value > 0.5, touched: value > 0, value });
function makePad(index = 0, mapping = 'standard') {
  return { index, id: `pad${index}`, mapping, connected: true, timestamp: 0,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => btn(0)) };
}
function setup(opts = {}) {
  const doc = new EventTarget();
  doc.pointerLockElement = null; doc.visibilityState = 'visible';
  const win = new EventTarget(); win.document = doc;
  const canvas = new EventTarget();
  const pads = [null, null, null, null];
  let t = 0, blocked = false;
  const actions = [];
  const map = new ActionMap({ settings: opts.settings });
  const input = createInput({ target: win, element: opts.noElement ? null : canvas, map, doc,
    isBlocked: () => blocked, onAction: (id, phase) => actions.push(`${id}:${phase}`),
    getGamepads: () => pads, now: () => t });
  const key = (type, code, extra = {}) => fire(win, type, { code, key: code, target: extra.target ?? win, ...extra });
  return {
    doc, win, canvas, pads, map, input, actions,
    tick(dt = 1 / 60) { t += dt * 1000; input.update(dt); },
    key, down: (c, x) => key('keydown', c, x), up: (c, x) => key('keyup', c, x),
    lock() { doc.pointerLockElement = canvas; fire(doc, 'pointerlockchange'); },
    unlock() { doc.pointerLockElement = null; fire(doc, 'pointerlockchange'); },
    connect(p) { pads[p.index] = p; fire(win, 'gamepadconnected', { gamepad: p }); },
    disconnect(p) { pads[p.index] = null; p.connected = false; fire(win, 'gamepaddisconnected', { gamepad: p }); },
    block(v) { blocked = v; },
  };
}

// ---------------------------------------------------------------- keyboard

test('key down/up produces single edges and onAction callbacks', () => {
  const s = setup();
  s.down('KeyW'); s.tick();
  assert.equal(s.input.down('moveForward'), true);
  assert.equal(s.input.pressed('moveForward'), true);
  assert.deepEqual(s.input.move(), { forward: 1, strafe: 0 });
  s.down('KeyW', { repeat: true }); s.tick();
  assert.equal(s.input.pressed('moveForward'), false, 'held + repeat is not a new edge');
  assert.equal(s.input.down('moveForward'), true);
  s.up('KeyW'); s.tick();
  assert.equal(s.input.released('moveForward'), true);
  assert.equal(s.input.down('moveForward'), false);
  s.tick();
  assert.equal(s.input.released('moveForward'), false);
  assert.deepEqual(s.actions, ['moveForward:down', 'moveForward:up']);
});

test('sub-frame tap still registers pressed and released', () => {
  const s = setup();
  s.down('KeyE'); s.up('KeyE'); s.tick();
  assert.equal(s.input.pressed('interact'), true);
  assert.equal(s.input.released('interact'), true);
  assert.deepEqual(s.actions, ['interact:down', 'interact:up']);
});

test('diagonal movement is clamped to length 1', () => {
  const s = setup();
  s.down('KeyW'); s.down('KeyD'); s.tick();
  const m = s.input.move();
  assert.ok(Math.abs(Math.hypot(m.forward, m.strafe) - 1) < 1e-9);
});

test('events from form fields are ignored but their keyups still release', () => {
  const s = setup();
  const field = new EventTarget(); field.closest = sel => (sel.includes('input') ? field : null);
  s.down('KeyW', { target: field }); s.tick();
  assert.equal(s.input.down('moveForward'), false);
  const editable = new EventTarget(); editable.isContentEditable = true;
  s.down('KeyS', { target: editable }); s.tick();
  assert.equal(s.input.down('moveBack'), false);
  s.down('KeyA'); s.tick();
  assert.equal(s.input.down('moveLeft'), true);
  s.up('KeyA', { target: field }); s.tick();
  assert.equal(s.input.down('moveLeft'), false);
});

test('repeat keydown after a clear does not re-press', () => {
  const s = setup();
  s.down('Space'); s.tick();
  fire(s.win, 'blur'); s.tick();
  assert.equal(s.input.down('jump'), false);
  s.down('Space', { repeat: true }); s.tick();
  assert.equal(s.input.down('jump'), false);
});

test('blur and hidden visibility clear held input and fire up', () => {
  const s = setup();
  s.down('KeyW'); s.down('ShiftLeft'); s.tick();
  fire(s.win, 'blur'); s.tick();
  assert.equal(s.input.down('moveForward'), false);
  assert.equal(s.input.released('sprint'), true);
  assert.ok(s.actions.includes('moveForward:up') && s.actions.includes('sprint:up'));
  s.down('KeyD'); s.tick();
  s.doc.visibilityState = 'hidden'; fire(s.doc, 'visibilitychange'); s.tick();
  assert.equal(s.input.down('moveRight'), false);
});

test('Meta keyup clears keys whose keyup macOS swallowed', () => {
  const s = setup();
  s.down('KeyA'); s.down('MetaLeft'); s.down('KeyR', { metaKey: true }); s.tick();
  assert.equal(s.input.down('rotate'), false, 'Cmd+R not recorded');
  s.up('MetaLeft'); s.tick();
  assert.equal(s.input.down('moveLeft'), false);
});

test('isBlocked suppresses actions but keeps held keys (no pressed edge when it ends)', () => {
  const s = setup();
  s.down('KeyW'); s.tick();
  s.block(true); s.tick();
  assert.equal(s.input.down('moveForward'), false);
  assert.deepEqual(s.input.move(), { forward: 0, strafe: 0 });
  s.down('KeyS'); s.tick();
  assert.equal(s.input.down('moveBack'), false);
  s.block(false); s.tick();
  assert.equal(s.input.down('moveForward'), true, 'W held through the block walks on');
  assert.equal(s.input.pressed('moveForward'), false);
  assert.equal(s.input.pressed('moveBack'), false, 'a key pressed while blocked gives no edge');
  assert.ok(!s.actions.includes('moveBack:down'));
});

test('hold vs toggle sprint; toggle auto-clears when movement stops', () => {
  const s = setup();
  s.down('KeyW'); s.down('ShiftLeft'); s.tick();
  assert.equal(s.input.sprinting(), true);
  s.up('ShiftLeft'); s.tick();
  assert.equal(s.input.sprinting(), false);
  s.map.setSetting('sprintMode', 'toggle');
  s.down('ShiftLeft'); s.tick(); s.up('ShiftLeft'); s.tick();
  assert.equal(s.input.sprinting(), true, 'stays on after release');
  s.down('ShiftLeft'); s.tick(); s.up('ShiftLeft'); s.tick();
  assert.equal(s.input.sprinting(), false, 'second press toggles off');
  s.down('ShiftLeft'); s.tick(); s.up('ShiftLeft'); s.tick();
  assert.equal(s.input.sprinting(), true);
  s.up('KeyW'); s.tick();
  assert.equal(s.input.sprinting(), false, 'stopping clears toggle');
});

test('toggle crouch', () => {
  const s = setup({ settings: { crouchMode: 'toggle' } });
  s.down('KeyC'); s.tick(); s.up('KeyC'); s.tick();
  assert.equal(s.input.crouching(), true);
  s.down('KeyC'); s.tick();
  assert.equal(s.input.crouching(), false);
});

test('digit keys select hotbar slots (consumed)', () => {
  const s = setup();
  s.down('Digit3'); s.tick();
  assert.equal(s.input.hotbarSlot(), 2);
  assert.equal(s.input.hotbarSlot(), -1);
  s.down('Digit0'); s.tick();
  assert.equal(s.input.hotbarSlot(), 9);
});

// ---------------------------------------------------------------- mouse

test('mouse look: radians, first-after-lock dropped, spikes dropped, invertY, consumed', () => {
  const s = setup();
  fire(s.doc, 'mousemove', { movementX: 10, movementY: 0 }); s.tick();
  assert.deepEqual(s.input.lookDelta(), { dx: 0, dy: 0 }, 'ignored while unlocked');
  s.lock();
  fire(s.doc, 'mousemove', { movementX: 50, movementY: 50 });
  fire(s.doc, 'mousemove', { movementX: 10, movementY: 5 });
  fire(s.doc, 'mousemove', { movementX: 900, movementY: 0 });
  s.tick();
  const l = s.input.lookDelta();
  assert.ok(Math.abs(l.dx - 10 * 0.0022) < 1e-12 && Math.abs(l.dy - 5 * 0.0022) < 1e-12, JSON.stringify(l));
  assert.deepEqual(s.input.lookDelta(), { dx: 0, dy: 0 });
  s.map.setSetting('invertY', true);
  fire(s.doc, 'mousemove', { movementX: 0, movementY: 10 }); s.tick();
  assert.ok(s.input.lookDelta().dy < 0);
});

test('mouse buttons need lock; lock loss releases them; wheel steps hotbar', () => {
  const s = setup();
  fire(s.canvas, 'mousedown', { button: 0, target: s.canvas }); s.tick();
  assert.equal(s.input.down('use'), false, 'first click only locks');
  s.lock();
  fire(s.canvas, 'mousedown', { button: 0, target: s.canvas }); s.tick();
  assert.equal(s.input.down('use'), true);
  s.unlock(); s.tick();
  assert.equal(s.input.down('use'), false);
  s.lock();
  fire(s.canvas, 'wheel', { deltaY: 100, deltaMode: 0 }); s.tick();
  assert.equal(s.input.hotbarStep(), 1, 'one mouse notch = one slot');
  assert.equal(s.input.hotbarStep(), 0);
  fire(s.canvas, 'wheel', { deltaY: -2, deltaMode: 1 }); s.tick();
  assert.equal(s.input.hotbarStep(), -1);
});

test('regression: wheel notches never skip slots; small trackpad deltas accumulate', () => {
  const s = setup(); s.lock();
  fire(s.canvas, 'wheel', { deltaY: 3, deltaMode: 1 }); s.tick(); // Firefox line-mode notch
  assert.equal(s.input.hotbarStep(), 1);
  fire(s.canvas, 'wheel', { deltaY: 100, deltaMode: 0 }); fire(s.canvas, 'wheel', { deltaY: 100, deltaMode: 0 }); s.tick();
  assert.equal(s.input.hotbarStep(), 2, 'two notches in one frame = two slots');
  for (let i = 0; i < 9; i++) fire(s.canvas, 'wheel', { deltaY: -5, deltaMode: 0 });
  s.tick();
  assert.equal(s.input.hotbarStep(), -1);
});

test('regression: crouch (Ctrl) + S/D/A blocks browser save/bookmark shortcuts; plain Ctrl chords pass', () => {
  const s = setup();
  assert.equal(s.down('KeyR', { ctrlKey: true }).defaultPrevented, false, 'Ctrl+R with Ctrl unheld (e.g. rebound) passes');
  s.up('KeyR');
  s.down('ControlLeft', { ctrlKey: true });
  assert.equal(s.down('KeyD', { ctrlKey: true }).defaultPrevented, true);
  assert.equal(s.down('KeyS', { ctrlKey: true }).defaultPrevented, true);
  assert.equal(s.down('KeyI', { ctrlKey: true, shiftKey: true }).defaultPrevented, false, 'Ctrl+Shift+I devtools passes');
  s.tick();
  assert.equal(s.input.down('crouch'), true);
  assert.equal(s.input.down('moveRight'), true);
});

// ---------------------------------------------------------------- gamepad

test('gamepad left stick moves with deadzone; ignores null entries', () => {
  const s = setup();
  const p = makePad(1); s.connect(p);
  p.axes[1] = -0.1; s.tick();
  assert.deepEqual(s.input.move(), { forward: 0, strafe: 0 }, 'inside deadzone');
  p.axes[1] = -1; s.tick();
  const m = s.input.move();
  assert.ok(Math.abs(m.forward - 1) < 1e-9 && m.strafe === 0, JSON.stringify(m));
  assert.equal(s.input.activeDevice, 'pad');
  p.axes[1] = -0.6; s.tick();
  assert.ok(s.input.move().forward > 0 && s.input.move().forward < 0.6, 'curve applied, no digital double-count');
  s.down('KeyW'); s.tick();
  assert.equal(s.input.move().forward, 1, 'keyboard + stick clamped');
});

test('right stick look scales with padLookSpeed * dt', () => {
  const s = setup();
  const p = makePad(0); s.connect(p);
  p.axes[2] = 1; s.tick(0.5);
  const l = s.input.lookDelta();
  assert.ok(Math.abs(l.dx - 2.6 * 0.5) < 1e-9 && l.dy === 0, JSON.stringify(l));
});

test('bumpers step hotbar once per press', () => {
  const s = setup();
  const p = makePad(0); s.connect(p);
  p.buttons[5] = btn(1); s.tick(); s.tick(); s.tick();
  assert.equal(s.input.hotbarStep(), 1);
  p.buttons[5] = btn(0); s.tick();
  p.buttons[4] = btn(1); s.tick();
  assert.equal(s.input.hotbarStep(), -1);
  assert.ok(s.actions.includes('hotbarNext:down') && s.actions.includes('hotbarNext:up'));
});

test('triggers report analog value; button state uses threshold', () => {
  const s = setup();
  const p = makePad(0); s.connect(p);
  p.buttons[7] = { pressed: true, value: 0.3 }; s.tick();
  assert.deepEqual(s.input.triggers(), { throw: 0.3, reel: 0 });
  assert.equal(s.input.down('use'), false, 'below threshold despite pressed flag');
  p.buttons[7] = btn(0.8); p.buttons[6] = btn(0.45); s.tick();
  assert.equal(s.input.down('use'), true);
  assert.equal(s.input.down('aim'), false);
  p.buttons[7] = btn(0.45); s.tick();
  assert.equal(s.input.down('use'), true, 'hysteresis keeps it held');
  p.buttons[7] = btn(0.2); s.tick();
  assert.equal(s.input.down('use'), false);
});

test('non-standard mapping pads are ignored; most recently active pad wins', () => {
  const s = setup();
  const odd = makePad(0, ''); s.connect(odd);
  odd.buttons[0] = btn(1); s.tick();
  assert.equal(s.input.down('jump'), false);
  const a = makePad(1), b = makePad(2); s.connect(a); s.connect(b);
  a.buttons[0] = btn(1); s.tick();
  assert.equal(s.input.activePad, 1);
  assert.equal(s.input.down('jump'), true);
  b.buttons[3] = btn(1); s.tick();
  assert.equal(s.input.activePad, 2);
  assert.equal(s.input.down('inventory'), true);
});

test('disconnect clears pad state and fires up', () => {
  const s = setup();
  const p = makePad(0); s.connect(p);
  p.buttons[0] = btn(1); p.axes[0] = 1; p.buttons[7] = btn(1); s.tick();
  assert.equal(s.input.down('jump'), true);
  s.disconnect(p); s.tick();
  assert.equal(s.input.down('jump'), false);
  assert.deepEqual(s.input.move(), { forward: 0, strafe: 0 });
  assert.deepEqual(s.input.triggers(), { throw: 0, reel: 0 });
  assert.ok(s.actions.includes('jump:up'));
});

test('pad buttons held through clear() must be released before re-pressing', () => {
  const s = setup();
  const p = makePad(0); s.connect(p);
  p.buttons[0] = btn(1); s.tick();
  s.input.clear(); s.tick();
  assert.equal(s.input.down('jump'), false);
  p.buttons[0] = btn(0); s.tick();
  p.buttons[0] = btn(1); s.tick();
  assert.equal(s.input.pressed('jump'), true);
});

test('dispose removes listeners', () => {
  const s = setup();
  s.input.dispose();
  s.down('KeyW'); s.tick();
  assert.equal(s.input.down('moveForward'), false);
});
