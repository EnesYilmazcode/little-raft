// Tests for the controls glue (dist/controls.js): gamepad triggers, build radial and dialogs.
// Run: node --test tests/controls.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;

// minimal DOM for build-radial.js / controls-tab.js
class El extends EventTarget {
  constructor() { super(); this.children = []; this.attrs = {}; const cls = new Set(); this.classList = { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, on) => (on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c), contains: c => cls.has(c) }; }
  setAttribute(k, v) { this.attrs[k] = v; } append(...k) { this.children.push(...k); } appendChild(k) { this.children.push(k); return k; }
  replaceChildren() { this.children = []; } remove() {}
}
const doc = new EventTarget();
Object.assign(doc, { pointerLockElement: null, visibilityState: 'visible', head: new El(), body: new El(),
  getElementById: () => null, createElement: () => new El(), createElementNS: () => new El() });
globalThis.document = doc;
const pads = [null, null, null, null];
try { globalThis.navigator.getGamepads = () => pads; } catch { Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true }); }
const events = [];
globalThis.dispatchEvent = e => { events.push(e); return true; };
const { createControls } = await import(new URL('controls.js', base));

const btn = (value = 0) => ({ pressed: value > 0.5, touched: value > 0, value });
const makePad = () => ({ index: 0, id: 'pad', mapping: 'standard', connected: true, timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => btn(0)) });
const physics = { grounded: true, swimming: false, vx: 0, vz: 0, vy: 0 };

function setup() {
  let blocked = false;
  const calls = [];
  const rec = name => (...a) => calls.push(name);
  const p = makePad(); pads[0] = p;
  const c = createControls({ canvas: null, isBlocked: () => blocked, look: rec('look'), hotbarSize: 8, slot: () => 0, selectSlot: rec('selectSlot'),
    interact: rec('interact'), inventory: rec('inventory'), repair: rec('repair'), pause: rec('pause'),
    useDown: rec('useDown'), useUp: rec('useUp'), useCancel: rec('useCancel'), reelDown: rec('reelDown'), reelUp: rec('reelUp') });
  return { c, p, calls, tick: () => c.movement(1 / 60, !blocked, physics), block: v => { blocked = v; } };
}

test('RT held when a dialog opens cancels the charge instead of throwing', () => {
  const s = setup();
  s.p.buttons[7] = btn(1); s.tick();
  assert.deepEqual(s.calls, ['useDown']);
  s.block(true); s.tick();
  assert.ok(!s.calls.includes('useUp'), 'no throw while the dialog opens');
  assert.ok(s.calls.includes('useCancel'));
  s.block(false); s.tick(); // still held after close: suppressed, nothing happens
  s.p.buttons[7] = btn(0); s.tick();
  assert.ok(!s.calls.includes('useUp'));
  s.c.dispose(); pads[0] = null;
});

test('build radial closes when a dialog opens and never picks behind it', () => {
  const s = setup(); events.length = 0;
  s.p.buttons[12] = btn(1); s.tick();
  const radial = () => s.c._radial?.();
  s.p.axes[2] = 1; s.tick(); s.tick(); s.tick(); s.tick(); s.tick(); // steer
  s.block(true); s.tick();
  s.p.buttons[12] = btn(0); s.tick();
  assert.equal(events.filter(e => e.detail?.id === 'buildPick').length, 0);
  s.c.dispose(); pads[0] = null;
});

test('build radial: steering right picks the right-hand piece and emits its id', () => {
  const s = setup(); events.length = 0;
  s.p.buttons[12] = btn(1); s.tick();
  s.p.axes[2] = 1; for (let i = 0; i < 10; i++) s.tick();
  s.p.axes[2] = 0; s.p.buttons[12] = btn(0); s.tick();
  const picks = events.filter(e => e.detail?.id === 'buildPick');
  assert.equal(picks.length, 1);
  assert.equal(picks[0].detail.piece, 'palm'); // 7 pieces clockwise from the top: +x is index 2
  s.c.dispose(); pads[0] = null;
});

test('build radial steering ignores invert-Y settings', () => {
  const s = setup(); events.length = 0;
  s.c.map.setSetting('padInvertY', true);
  s.p.buttons[12] = btn(1); s.tick();
  s.p.axes[3] = -1; for (let i = 0; i < 10; i++) s.tick(); // stick up -> top piece (index 0)
  s.p.axes[3] = 0; s.p.buttons[12] = btn(0); s.tick();
  const picks = events.filter(e => e.detail?.id === 'buildPick');
  assert.equal(picks[0]?.detail.piece, 'floor');
  s.c.dispose(); pads[0] = null;
});

test('bumper presses while the radial is open are not applied after it closes', () => {
  const s = setup();
  s.p.buttons[12] = btn(1); s.tick();
  s.p.buttons[5] = btn(1); s.tick(); s.p.buttons[5] = btn(0); s.tick();
  s.p.buttons[12] = btn(0); s.tick(); s.tick();
  assert.ok(!s.calls.includes('selectSlot'));
  s.c.dispose(); pads[0] = null;
});
