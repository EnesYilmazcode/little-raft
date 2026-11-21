// Regression tests for input findings I1..I5 (round 5): pad look at low fps, held keys through module panels,
// numpad hotbar keys, pad menu-back keeping held keys, toggle sprint armed while idle, invert-Y single owner.
// Run: node --test tests/input-r5.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;

// minimal DOM for build-radial.js
class El extends EventTarget {
  constructor() { super(); this.children = []; this.attrs = {}; const cls = new Set(); this.classList = { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, on) => (on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c), contains: c => cls.has(c) }; }
  setAttribute(k, v) { this.attrs[k] = v; } append(...k) { this.children.push(...k); } appendChild(k) { this.children.push(k); return k; }
  replaceChildren() { this.children = []; } remove() {}
}
const gdoc = new EventTarget();
Object.assign(gdoc, { pointerLockElement: null, visibilityState: 'visible', head: new El(), body: new El(),
  getElementById: () => null, createElement: () => new El(), createElementNS: () => new El() });
globalThis.document = gdoc;
const win = new EventTarget(); win.document = gdoc; globalThis.window = win; // createInput's default key/mouse target
const gpads = [null, null, null, null];
try { globalThis.navigator.getGamepads = () => gpads; } catch { Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => gpads }, configurable: true }); }
globalThis.dispatchEvent = () => true;

const { createInput } = await import(new URL('input.js', base));
const { ActionMap, DEFAULT_BINDINGS } = await import(new URL('input-map.js', base));
const { createControls } = await import(new URL('controls.js', base));
const src = f => readFileSync(fileURLToPath(new URL(f, base)), 'utf8');
const gameSrc = src('game.js');

function fire(target, type, props = {}) {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v, configurable: true });
  target.dispatchEvent(e);
  return e;
}
const btn = (value = 0) => ({ pressed: value > 0.5, touched: value > 0, value });
const makePad = (index = 0) => ({ index, id: `pad${index}`, mapping: 'standard', connected: true, timestamp: 0,
  axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => btn(0)) });
const key = (type, code, extra = {}) => fire(win, type, { code, key: code, target: win, ...extra });
const physics = { grounded: true, swimming: false, vx: 0, vz: 0, vy: 0 };

function inputSetup({ settings, map } = {}) {
  let blocked = false, t = 0;
  const m = map ?? new ActionMap({ settings });
  const input = createInput({ target: win, map: m, doc: gdoc, isBlocked: () => blocked, getGamepads: () => [], now: () => t });
  return { map: m, input, tick(dt = 1 / 60) { t += dt * 1000; input.update(dt); }, block: v => { blocked = v; } };
}

function controlsSetup() {
  let blocked = false;
  const calls = [], looks = [];
  const rec = name => (...a) => calls.push(name);
  const p = makePad(); gpads[0] = p;
  const c = createControls({ canvas: null, isBlocked: () => blocked, look: (dx, dy) => looks.push([dx, dy]), hotbarSize: 8, slot: () => 0,
    selectSlot: rec('selectSlot'), interact: rec('interact'), inventory: rec('inventory'), pause: rec('pause'), menuBack: () => { calls.push('menuBack'); blocked = false; },
    useDown: rec('useDown'), useUp: rec('useUp'), useCancel: rec('useCancel'), reelDown: rec('reelDown'), reelUp: rec('reelUp') });
  return { c, p, calls, looks, block: v => { blocked = v; }, tick: (dt = 1 / 60, lookDt) => c.movement(dt, !blocked, physics, lookDt),
    done() { c.dispose(); gpads[0] = null; } };
}

// ---------------------------------------------------------------- I1 pad look at low frame rates

test('I1: right-stick look turns at the same rad/s at 60, 20 and 8 fps (look uses the real frame dt)', () => {
  const rates = [];
  for (const dt of [1 / 60, .05, .125]) {
    const s = controlsSetup();
    s.p.axes[2] = 1; s.tick(.016); s.looks.length = 0; // wake the pad
    s.tick(Math.min(dt, .05), dt); // as game.js: capped laneDt for feel, real dt for look
    rates.push(s.looks.reduce((a, l) => a + l[0], 0) / dt);
    s.done();
  }
  for (const r of rates) assert.ok(Math.abs(r - rates[0]) < 1e-9 && r > 0, JSON.stringify(rates));
});

test('I1: game.js passes the real frame dt to controls.movement for look, laneDt for movement feel', () => {
  assert.match(gameSrc, /controls\?\.movement\(laneDt, running && input, physics, dt\)/);
  assert.match(src('controls.js'), /function movement\(dt, active, physics, lookDt = dt\)[\s\S]{0,400}input\.update\(lookDt\)/);
});

// ---------------------------------------------------------------- I2 module panels keep held keys

test('I2: ctx.releaseLock (chest, research desk, sign, map table, animals) pauses input without wiping held keys', () => {
  const line = gameSrc.split('\n').find(l => l.includes('releaseLock: () =>'));
  assert.ok(line);
  assert.doesNotMatch(line, /clearInput/);
  assert.match(line, /releaseLock: \(\) => \{ panelInput\(\); releaseLock\(\); \}/);
  const panel = gameSrc.split('\n').find(l => l.includes('function panelInput() {'));
  assert.match(panel, /pauseInput\(\)/);
  assert.match(panel, /fc\?\.releaseInput\(\)/, 'a fishing charge is still dropped');
  assert.doesNotMatch(panel, /keys\s*=|clearInput|controls\?\.clear/);
  assert.doesNotMatch(gameSrc, /pause:clearInput/, 'progression stations open the same way');
});

test('I2: W held through a panel still walks after it closes, even though only repeats arrive', () => {
  const s = inputSetup();
  key('keydown', 'KeyW'); s.tick();
  s.block(true); s.tick(); key('keydown', 'KeyW', { repeat: true }); s.tick();
  s.block(false); s.tick(); key('keydown', 'KeyW', { repeat: true }); s.tick();
  assert.equal(s.input.move().forward, 1);
  key('keyup', 'KeyW'); s.tick();
  assert.equal(s.input.move().forward, 0);
  s.input.dispose();
});

test('I2: a panel opened over the build radial still closes it, and a held RT is cancelled not thrown', () => {
  const s = controlsSetup();
  s.p.buttons[7] = btn(1); s.tick();
  s.block(true); s.tick();
  assert.ok(s.calls.includes('useCancel') && !s.calls.includes('useUp'));
  s.done();
});

// ---------------------------------------------------------------- I4 numpad hotbar

const mem = (data) => { const m = new Map(data ? [['little-raft-controls-v1', JSON.stringify(data)]] : []); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };

test('I4: Numpad1-0 select hotbar slots by default, next to Digit1-0', () => {
  assert.deepEqual(DEFAULT_BINDINGS.hotbar1.keys, ['Digit1', 'Numpad1']);
  assert.deepEqual(DEFAULT_BINDINGS.hotbar0.keys, ['Digit0', 'Numpad0']);
  const s = inputSetup();
  key('keydown', 'Numpad3'); s.tick(); key('keyup', 'Numpad3');
  assert.equal(s.input.hotbarSlot(), 2);
  key('keydown', 'Numpad0'); s.tick(); key('keyup', 'Numpad0');
  assert.equal(s.input.hotbarSlot(), 9);
  s.input.dispose();
});

test('I4: a save from before the numpad defaults gains them; its own numpad bindings win', () => {
  const old = new ActionMap().serialize();
  delete old.rev;
  for (const id of Object.keys(old.bindings)) if (/^hotbar\d$/.test(id)) old.bindings[id].keys = [`Digit${id.slice(6)}`, null];
  old.bindings.jump.keys = ['Space', 'Numpad5'];      // the player put Numpad5 on jump
  old.bindings.hotbar2.keys = ['KeyZ', null];          // and moved slot 2 to Z
  const m = new ActionMap({ storage: mem(old) });
  assert.deepEqual(m.bindingsFor('hotbar1').keys, ['Digit1', 'Numpad1']);
  assert.deepEqual(m.bindingsFor('hotbar2').keys, ['KeyZ', 'Numpad2']);
  assert.deepEqual(m.bindingsFor('hotbar5').keys, ['Digit5', null], 'Numpad5 stays on jump');
  assert.deepEqual(m.actionFor('Numpad5'), ['jump']);
  assert.equal(m.serialize().rev, 2);
});

test('I4: after the migration a deliberately cleared numpad slot stays cleared across reloads', () => {
  const store = mem();
  const m = new ActionMap({ storage: store });
  m.unbind('hotbar4', 1, 'keys');
  const again = new ActionMap({ storage: store });
  assert.deepEqual(again.bindingsFor('hotbar4').keys, ['Digit4', null]);
  assert.deepEqual(again.bindingsFor('hotbar3').keys, ['Digit3', 'Numpad3']);
});

// ---------------------------------------------------------------- I5b pad menu back keeps held keys

test('I5b: closing a menu with pad B keeps a held keyboard W walking', () => {
  const s = controlsSetup();
  key('keydown', 'KeyW'); s.tick();
  s.block(true); s.tick();
  s.p.buttons[1] = btn(1); s.tick(); // B: menuBack (unblocks)
  assert.ok(s.calls.includes('menuBack'));
  s.tick(); s.tick();
  assert.equal(s.c.input.move().forward, 1, 'W still counts');
  assert.equal(s.c.input.down('crouch'), false, 'the held B is suppressed, so it does not crouch');
  key('keyup', 'KeyW'); s.done();
});

// ---------------------------------------------------------------- I5a toggle sprint while idle

test('I5a: toggle sprint pressed while standing still stays armed for the next move', () => {
  const s = inputSetup({ settings: { sprintMode: 'toggle' } });
  key('keydown', 'ShiftLeft'); s.tick(); key('keyup', 'ShiftLeft'); s.tick(); s.tick();
  assert.equal(s.input.sprinting(), true, 'armed while idle');
  key('keydown', 'KeyW'); s.tick();
  assert.equal(s.input.sprinting(), true, 'sprints once moving');
  key('keyup', 'KeyW'); s.tick();
  assert.equal(s.input.sprinting(), false, 'stopping after moving cancels it');
  key('keydown', 'ShiftLeft'); s.tick(); key('keyup', 'ShiftLeft'); s.tick();
  key('keydown', 'ShiftLeft'); s.tick(); key('keyup', 'ShiftLeft'); s.tick();
  assert.equal(s.input.sprinting(), false, 'a second idle press disarms it');
  key('keydown', 'KeyW'); s.tick();
  assert.equal(s.input.sprinting(), false);
  key('keyup', 'KeyW'); s.tick();
  s.input.dispose();
});

// ---------------------------------------------------------------- I3 invert-Y has one owner

test('I3: controls-map invertY is not applied on top of the game option; the tab does not offer it', () => {
  const s = inputSetup({ settings: { invertY: true } });
  gdoc.pointerLockElement = null; // no element: always "locked"
  fire(gdoc, 'mousemove', { movementX: 0, movementY: 4 }); // first sample after (re)lock may be dropped
  fire(gdoc, 'mousemove', { movementX: 0, movementY: 10 }); s.tick();
  assert.ok(s.input.lookDelta().dy > 0, 'input.js leaves mouse Y alone');
  s.input.dispose();
  assert.match(gameSrc, /function look\(dx, dy, k\) \{[^\n]*options\.invertY/, 'game.js applies the settings option');
  const tab = src('controls-tab.js');
  assert.doesNotMatch(tab.match(/const CHECKS = \{[^}]*\}/)[0], /\binvertY\b/);
});

// ---------------------------------------------------------------- I3 the key-binding list is mounted in Settings > Controls

test('I3: game.js hands controls.mountTab to settings, which mounts it in the Controls tab and routes Esc to it', () => {
  assert.match(gameSrc, /createSettings\(\{mountControls:el => controls\?\.mountTab\(el\)/);
  const st = src('settings.js');
  assert.match(st, /export function createSettings\(\{[^}]*mountControls[^}]*\}/);
  assert.match(st, /if \(id === 'controls'\) mountRebind\(\); else cancelRebind\(\);/);
  assert.match(st, /if \(dialog\.open && rebindCapturing\(\)\) \{ cancelRebind\(\); return true; \}/, 'Esc while waiting for a key cancels the capture, not the menu');
  assert.match(st, /function close\(resume = true\) \{\s*if \(!owns\(\)\) return;\s*cancelRebind\(\);/);
  assert.match(st, /#options \.rs-has-rebind \.rs-keys \[data-bindable\]\{display:none\}/, 'rebindable rows are not listed twice');
});

test('I3: a mounted tab handle cancels and, once disposed, no longer blocks input as capturing', () => {
  const c = createControls({ canvas: null, isBlocked: () => false });
  const h = c.mountTab(new El());
  assert.equal(typeof h.cancel, 'function');
  h.cancel();
  h.dispose();
  assert.equal(h.capturing, false);
  c.dispose();
});
