// Regression tests for round-6 controls fixes: pad look uses the real frame dt, one mouse invert source,
// Numpad hotbar keys. Run: node --test tests/controls-r6.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;

class El extends EventTarget {
  constructor() { super(); this.children = []; this.attrs = {}; const cls = new Set(); this.classList = { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, on) => (on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c), contains: c => cls.has(c) }; }
  setAttribute(k, v) { this.attrs[k] = v; } append(...k) { this.children.push(...k); } appendChild(k) { this.children.push(k); return k; }
  replaceChildren() { this.children = []; } remove() {}
}
const gdoc = new EventTarget();
Object.assign(gdoc, { pointerLockElement: null, visibilityState: 'visible', head: new El(), body: new El(),
  getElementById: () => null, createElement: () => new El(), createElementNS: () => new El() });
globalThis.document = gdoc;
const win = new EventTarget(); win.document = gdoc; globalThis.window = win;
const gpads = [null, null, null, null];
try { globalThis.navigator.getGamepads = () => gpads; } catch { Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => gpads }, configurable: true }); }
globalThis.dispatchEvent = () => true;

const { ActionMap, DEFAULT_BINDINGS } = await import(new URL('input-map.js', base));
const { createControls } = await import(new URL('controls.js', base));
const gameSrc = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');

function fire(target, type, props = {}) {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v, configurable: true });
  target.dispatchEvent(e);
  return e;
}
const btn = (value = 0) => ({ pressed: value > 0.5, touched: value > 0, value });
const makePad = () => ({ index: 0, id: 'pad0', mapping: 'standard', connected: true, timestamp: 0,
  axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => btn(0)) });
const physics = { grounded: true, swimming: false, vx: 0, vz: 0, vy: 0 };

function setup() {
  const looks = [], slots = [];
  const p = makePad(); gpads[0] = p;
  const c = createControls({ canvas: null, isBlocked: () => false, look: (dx, dy) => looks.push([dx, dy]), hotbarSize: 10,
    slot: () => 0, selectSlot: i => slots.push(i) });
  c.map.resetAll();
  fire(win, 'gamepadconnected', { gamepad: p });
  return { c, p, looks, slots, done() { c.dispose(); gpads[0] = null; } };
}

test('pad look scales with the real frame dt, not the capped lane dt', () => {
  const s = setup();
  try {
    s.p.axes[2] = 1;
    s.c.movement(0.05, true, physics, 0.05); const fast = s.looks.pop()[0];
    s.c.movement(0.05, true, physics, 0.2); const slow = s.looks.pop()[0];
    assert.ok(fast > 0 && Math.abs(slow / fast - 4) < 1e-9, `5fps frame turns 4x a 20fps frame (${fast}, ${slow})`);
    s.c.movement(0.05, true, physics); assert.ok(Math.abs(s.looks.pop()[0] - fast) < 1e-12, 'lookDt defaults to dt');
  } finally { s.done(); }
  assert.match(gameSrc, /controls\?\.movement\(laneDt, running && input, physics, dt\)/, 'game.js passes the real frame dt');
});

test('mouse invertY never inverts the gamepad; padInvertY does', () => {
  const s = setup();
  try {
    s.p.axes[3] = 1;
    s.c.movement(1 / 60, true, physics); const dy = s.looks.pop()[1];
    assert.ok(dy > 0);
    s.c.map.setSetting('invertY', true);
    s.c.movement(1 / 60, true, physics); assert.equal(s.looks.pop()[1], dy, 'mouse invert leaves the stick alone');
    s.c.map.setSetting('padInvertY', true);
    s.c.movement(1 / 60, true, physics); assert.equal(s.looks.pop()[1], -dy);
  } finally { s.done(); }
});

test('game.js look() has no invert of its own; Settings invertY syncs into the action map', () => {
  const look = gameSrc.slice(gameSrc.indexOf('function look(dx, dy, k)'), gameSrc.indexOf('function clearInput('));
  assert.doesNotMatch(look, /\? -dy : dy/, 'look() must not flip dy (it would also flip the pad)');
  assert.match(gameSrc, /controls\.map\.setSetting\('invertY', v\)/);
  assert.match(gameSrc, /function applyOptions\(next\) \{[\s\S]{0,80}syncInvert\(\)/);
  assert.match(gameSrc, /look\(dx, invertDy\(dy\), dragLookScale/, 'drag look keeps the Settings invert');
});

test('build radial cursor stays screen space with mouse invert on', () => {
  const s = setup();
  try {
    s.c.map.setSetting('invertY', true);
    gdoc.pointerLockElement = {}; // any lock: canvas is null
    fire(gdoc, 'mousemove', { movementX: 0, movementY: 1 }); // first after lock: dropped
    s.c.movement(1 / 60, true, physics); s.looks.length = 0;
    // open the radial with the pad build button (D-pad up), then move the mouse down
    s.p.buttons[12] = btn(1); s.c.movement(1 / 60, true, physics);
    assert.ok(s.c.radialOpen);
    fire(gdoc, 'mousemove', { movementX: 0, movementY: 30 });
    s.c.input.activeDevice = 'mouse';
    s.c.input.update(1 / 60); const { dy } = s.c.input.lookDelta();
    assert.ok(dy < 0, 'input.js applied the mouse invert');
    const inv = s.c.map.settings.invertY ? -1 : 1;
    assert.ok(dy * inv > 0, 'radial un-flips it: mouse down moves the cursor down');
  } finally { gdoc.pointerLockElement = null; s.done(); }
});

test('Numpad keys select hotbar slots through the action map', () => {
  for (let n = 0; n < 10; n++) assert.deepEqual(DEFAULT_BINDINGS[`hotbar${n}`].keys, [`Digit${n}`, `Numpad${n}`]);
  const s = setup();
  try {
    fire(win, 'keydown', { code: 'Numpad3', key: '3', target: win });
    s.c.movement(1 / 60, true, physics);
    fire(win, 'keyup', { code: 'Numpad3', key: '3', target: win });
    assert.deepEqual(s.slots, [2]);
    fire(win, 'keydown', { code: 'Numpad0', key: '0', target: win });
    s.c.movement(1 / 60, true, physics);
    fire(win, 'keyup', { code: 'Numpad0', key: '0', target: win });
    assert.deepEqual(s.slots, [2, 9], 'Numpad0 = slot 10');
  } finally { s.done(); }
  assert.ok(gameSrc.includes('/^(?:Digit|Numpad)([0-9])$/'), 'legacy keydown path is kept');
});

test('old saves (hotbar [DigitN, null]) gain the Numpad default; later saves keep a cleared slot', () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const old = { v: 1, bindings: { hotbar1: { keys: ['Digit1', null], pad: [null] }, hotbar2: { keys: ['KeyZ', null], pad: [null] },
    hotbarNext: { keys: ['Numpad3', null], pad: ['Pad5'] } }, settings: {} };
  store.set('little-raft-controls-v1', JSON.stringify(old));
  const m = new ActionMap({ storage });
  assert.deepEqual(m.bindingsFor('hotbar1').keys, ['Digit1', 'Numpad1']);
  assert.deepEqual(m.bindingsFor('hotbar2').keys, ['KeyZ', 'Numpad2']);
  assert.deepEqual(m.bindingsFor('hotbar3').keys, ['Digit3', null], 'Numpad3 stays with the action that owns it');
  assert.deepEqual(m.bindingsFor('hotbarNext').keys, ['Numpad3', null]);
  assert.deepEqual(m.bindingsFor('hotbar4').keys, ['Digit4', 'Numpad4'], 'absent entry: defaults');
  m.bindings.hotbar5.keys[1] = null; m.save();
  assert.deepEqual(new ActionMap({ storage }).bindingsFor('hotbar5').keys, ['Digit5', null], 'a cleared slot stays cleared');
});
