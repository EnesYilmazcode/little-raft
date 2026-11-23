// Regression tests for the CTL-1..CTL-6 input fixes (dist/input.js, controls.js, input-map.js, game.js glue).
// Run: node --test tests/controls-fixes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;

// minimal DOM for build-radial.js / controls-tab.js
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
const events = [];
globalThis.dispatchEvent = e => { events.push(e); return true; };

const { createInput } = await import(new URL('input.js', base));
const { ActionMap } = await import(new URL('input-map.js', base));
const { createControls } = await import(new URL('controls.js', base));
const gameSrc = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');

function fire(target, type, props = {}) {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v, configurable: true });
  target.dispatchEvent(e);
  return e;
}
const btn = (value = 0) => ({ pressed: value > 0.5, touched: value > 0, value });
const makePad = (index = 0) => ({ index, id: `pad${index}`, mapping: 'standard', connected: true, timestamp: 0,
  axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => btn(0)) });

function inputSetup(opts = {}) {
  const doc = new EventTarget(); doc.visibilityState = 'visible';
  const win = new EventTarget(); win.document = doc;
  const canvas = new EventTarget(); doc.pointerLockElement = canvas;
  const pads = [null, null, null, null];
  let blocked = false;
  const actions = [];
  const map = opts.map ?? new ActionMap();
  const input = createInput({ target: win, element: canvas, map, doc, isBlocked: () => blocked,
    onAction: (id, phase) => actions.push(`${id}:${phase}`), getGamepads: () => pads, now: () => 0, ...opts.input });
  const key = (type, code, extra = {}) => fire(win, type, { code, key: code, target: win, ...extra });
  return { win, canvas, pads, map, input, actions, tick: () => input.update(1 / 60),
    down: (c, x) => key('keydown', c, x), up: (c, x) => key('keyup', c, x), block: v => { blocked = v; } };
}

const physics = { grounded: true, swimming: false, vx: 0, vz: 0, vy: 0 };
function controlsSetup(extra = {}) {
  let blocked = false;
  const calls = [];
  const rec = name => (...a) => { calls.push(a.length ? [name, ...a] : name); };
  const p = makePad(); gpads[0] = p;
  const c = createControls({ canvas: null, isBlocked: () => blocked, look: () => {}, hotbarSize: 8, slot: () => 0, selectSlot: rec('selectSlot'),
    interact: rec('interact'), inventory: rec('inventory'), repair: rec('repair'), pause: rec('pause'), menuBack: rec('menuBack'),
    useDown: rec('useDown'), useUp: rec('useUp'), useCancel: rec('useCancel'), reelDown: rec('reelDown'), reelUp: rec('reelUp'), ...extra });
  return { c, p, calls, tick: () => c.movement(1 / 60, !blocked, physics), block: v => { blocked = v; },
    done() { c.dispose(); gpads[0] = null; } };
}

// ---------------------------------------------------------------- CTL-1

test('CTL-1: Shift/Ctrl/Alt + wheel never steps the hotbar; plain wheel still does', () => {
  const s = inputSetup();
  for (const mod of ['shiftKey', 'ctrlKey', 'altKey']) {
    const e = fire(s.canvas, 'wheel', { deltaY: 100, deltaMode: 0, [mod]: true }); s.tick();
    assert.equal(s.input.hotbarStep(), 0, `${mod}+wheel must not change slot`);
    assert.equal(e.defaultPrevented, true, 'still no page scroll / browser zoom');
  }
  fire(s.canvas, 'wheel', { deltaY: 100, deltaMode: 0 }); s.tick();
  assert.equal(s.input.hotbarStep(), 1);
});

test('CTL-1: game.js wheel handler fine-rotates on modifier even while controls own the locked wheel', () => {
  const h = gameSrc.slice(gameSrc.indexOf("on(window, 'wheel'"), gameSrc.indexOf("on($('#resumeHint')")); // the wheel listener moved to window (INPUT-4)
  const fine = h.indexOf('const fine = e.shiftKey || e.ctrlKey || e.altKey');
  const early = h.indexOf('if (controls && isLocked() && !fine) return;');
  assert.ok(fine > 0 && early > fine, 'modifier wheel is not swallowed by the controls early-return');
  assert.match(h, /if \(fine\) \{ if \(DECOR_TYPES\.includes\(heldKind\(\)\)\) rotatePlacement\(step \* FINE_STEP\); return; \}/);
  assert.ok(h.indexOf('selectSlot(') > h.indexOf('if (fine)'), 'slot change only after the modifier branch returned');
});

test('CTL-1: Shift+R rotates backwards through the controls repair callback', () => {
  const s = controlsSetup();
  const target = win;
  fire(target, 'keydown', { code: 'ShiftLeft', target: null }); fire(target, 'keydown', { code: 'KeyR', target: null, shiftKey: true }); s.tick();
  fire(target, 'keyup', { code: 'KeyR' }); fire(target, 'keyup', { code: 'ShiftLeft' }); s.tick();
  fire(target, 'keydown', { code: 'KeyR', target: null }); s.tick(); fire(target, 'keyup', { code: 'KeyR' }); s.tick();
  const reps = s.calls.filter(c => Array.isArray(c) && c[0] === 'repair');
  assert.deepEqual(reps, [['repair', true], ['repair', false]]);
  assert.match(gameSrc, /repair:back => \{ if \(running && DECOR_TYPES\.includes\(heldKind\(\)\)\) rotatePlacement\(back \? -ROT_STEP : ROT_STEP\)/);
  s.done();
});

// ---------------------------------------------------------------- CTL-2

test('CTL-2: while blocked, pad Y / Start / B fire menu edges; the opening press does not close', () => {
  const s = inputSetup({ input: { blockedActions: ['inventory', 'pause'] } });
  const p = makePad(); s.pads[0] = p; fire(s.win, 'gamepadconnected', { gamepad: p });
  const press = (i, ticks = 1) => { p.buttons[i] = btn(1); for (let k = 0; k < ticks; k++) s.tick(); p.buttons[i] = btn(0); s.tick(); };
  p.buttons[3] = btn(1); s.tick();
  assert.deepEqual(s.actions, ['inventory:down']);
  s.block(true); s.actions.length = 0; // inventory opened by that press
  s.tick(); s.tick(); p.buttons[3] = btn(0); s.tick();
  assert.deepEqual(s.actions.filter(a => a.endsWith(':down')), [], 'held opening Y is suppressed while blocked');
  s.actions.length = 0;
  press(3); assert.deepEqual(s.actions, ['inventory:down']); s.actions.length = 0;
  press(9); assert.deepEqual(s.actions, ['pause:down']); s.actions.length = 0;
  press(1, 3); assert.deepEqual(s.actions, ['back:down'], 'B is back, one edge for a held press'); s.actions.length = 0;
  press(0); press(7); p.axes[0] = 1; s.tick(); p.axes[0] = 0; s.tick();
  assert.deepEqual(s.actions, [], 'nothing else reacts while blocked');
  assert.deepEqual(s.input.triggers(), { throw: 0, reel: 0 });
  assert.deepEqual(s.input.move(), { forward: 0, strafe: 0 });
});

test('CTL-2: without blockedActions the pad stays fully ignored while blocked', () => {
  const s = inputSetup();
  const p = makePad(); s.pads[0] = p; fire(s.win, 'gamepadconnected', { gamepad: p });
  s.block(true);
  for (const i of [3, 9, 1]) { p.buttons[i] = btn(1); s.tick(); p.buttons[i] = btn(0); s.tick(); }
  assert.deepEqual(s.actions, []);
});

test('CTL-2: controls routes pad menu presses to menuBack and game.js closes + relocks', () => {
  const s = controlsSetup();
  s.p.buttons[3] = btn(1); s.tick();
  assert.deepEqual(s.calls, ['inventory']);
  s.block(true); s.tick(); s.p.buttons[3] = btn(0); s.tick();
  assert.ok(!s.calls.some(c => c[0] === 'menuBack'), 'opening press must not close');
  s.p.buttons[1] = btn(1); s.tick();
  assert.deepEqual(s.calls.filter(c => c[0] === 'menuBack'), [['menuBack', 'back']]);
  s.block(false); s.tick(); s.tick(); // B still held after the menu closed: no crouch
  assert.equal(s.c.input.down('crouch'), false);
  s.p.buttons[1] = btn(0); s.tick(); s.block(true); s.calls.length = 0;
  s.p.buttons[9] = btn(1); s.tick(); s.p.buttons[9] = btn(0); s.tick();
  assert.deepEqual(s.calls, [['menuBack', 'pause']]);
  s.done();
  const cb = /menuBack:\(\) => \{([^\n]*)\}, \/\//.exec(gameSrc)?.[1] ?? '';
  assert.match(cb, /survivalUI\?\.isOpen\) survivalUI\.close\(\)/);
  assert.match(cb, /settingsController\?\.isOpen\) settingsController\.close\(\)/);
  // those close() calls run the same onResume -> requestLock path the keyboard close uses
  assert.match(gameSrc, /onResume:guard\(\(\) => \{ play\('close'\); requestLock\(\); \}\)/);
  assert.match(gameSrc, /createSettings\(\{[^\n]*onResume:\(\) => \{ quality\?\.reset\(\); requestLock\(\); \}/);
});

// ---------------------------------------------------------------- CTL-3

test('CTL-3: pad RT runs rod fishing v2 (fc.pointerDown/pointerUp) before the legacy use path, like the mouse', () => {
  const down = /\buseDown:\(\) => \{([^\n]*)/.exec(gameSrc)?.[1] ?? '', up = /\buseUp:\(\) => \{([^\n]*?)\}, useCancel/.exec(gameSrc)?.[1] ?? '';
  assert.ok(down.includes('fc?.pointerDown()') && down.indexOf('fc?.pointerDown()') < down.indexOf('useSelected('), 'useDown: fc first');
  assert.ok(down.includes("reelCast('click')") && down.indexOf("reelCast('click')") < down.indexOf('castOut()'));
  assert.ok(up.includes('fc?.pointerUp()') && up.indexOf('fc?.pointerUp()') < up.indexOf('releaseCharge('), 'useUp: fc first');
  const mouse = gameSrc.slice(gameSrc.indexOf("on(canvas, 'pointerdown'"), gameSrc.indexOf("on(canvas, 'pointermove'"));
  assert.ok(mouse.indexOf('fc?.pointerDown()') < mouse.indexOf('useSelected('), 'mouse path is the reference');
});

// ---------------------------------------------------------------- CTL-4

test('CTL-4: pad build radial picks call the host buildPick with the host piece list', () => {
  const picks = [];
  const pieces = [{ id: 'foundation', label: 'Foundation' }, { id: 'floor', label: 'Floor' }, { id: 'wall', label: 'Wall' }, { id: 'halfwall', label: 'Half wall' }];
  let asked = 0;
  const s = controlsSetup({ buildPieces: () => { asked++; return pieces; }, buildPick: id => picks.push(id) });
  events.length = 0;
  s.p.buttons[12] = btn(1); s.tick();
  s.p.axes[2] = 1; for (let i = 0; i < 10; i++) s.tick(); // right = index 1 of 4
  s.p.axes[2] = 0; s.p.buttons[12] = btn(0); s.tick();
  assert.deepEqual(picks, ['floor']);
  assert.equal(asked, 1, 'list read lazily when the radial first opens');
  assert.equal(events.filter(e => e.detail?.id === 'buildPick').length, 0, 'no orphan event when the host handles it');
  s.done();
});

test('CTL-4: game.js wires the radial to the hammer wheel pieces and selects them', () => {
  assert.match(gameSrc, /import \{ PIECES, PIECE_ORDER \} from '\.\/building-pieces\.js\?build=v3-survival-ae77fa84ac2b'/, 'same module instance as building.js');
  assert.match(gameSrc, /buildPieces:\(\) => PIECE_ORDER\.map\(id => \(\{id, label:PIECES\[id\]\.name\}\)\), buildPick:pickBuildPiece/);
  const fn = gameSrc.slice(gameSrc.indexOf('function pickBuildPiece('), gameSrc.indexOf('function openInventory('));
  assert.match(fn, /toolRole\(s\?\.kind \?\? null\) === 'hammer'/, 'finds the hammer on the hotbar');
  assert.ok(fn.indexOf('selectSlot(i)') < fn.indexOf('building.menu.setSelected(id)'), 'holds the hammer, then picks the piece');
});

test('CTL-4: drop is a real action on Q (keyboard only); the hammer keeps Q for its build wheel in game.js', async () => {
  const { ACTIONS, DEFAULT_BINDINGS } = await import(new URL('input-map.js', base));
  assert.ok(ACTIONS.some(a => a.id === 'drop'));
  assert.deepEqual(DEFAULT_BINDINGS.drop, { keys: ['KeyQ'], pad: [] });
  const m = new ActionMap();
  assert.deepEqual(m.actionFor('KeyQ'), ['drop']);
  assert.deepEqual(m.actionFor('Pad8'), [], 'Back stays free');
  assert.match(gameSrc, /!ctrlQ && building\?\.key\(e\.code, true, heldKind\(\) === 'hammer'/, 'plain Q with the hammer still opens its wheel');
});

// ---------------------------------------------------------------- CTL-5

test('CTL-5: crouch defaults to C only, so crouch-walk is never Ctrl+W', () => {
  const s = inputSetup();
  assert.deepEqual(s.map.bindingsFor('crouch'), { keys: ['KeyC', null], pad: ['Pad1'] });
  assert.deepEqual(s.map.actionFor('ControlLeft'), []);
  s.down('ControlLeft', { ctrlKey: true });
  assert.equal(s.down('KeyW', { ctrlKey: true }).defaultPrevented, false, 'Ctrl+W is not a game chord');
  s.tick();
  assert.equal(s.input.down('crouch'), false);
});

test('CTL-5: saved bindings that are exactly the old default migrate; customised ones are kept', () => {
  const store = data => { let raw = JSON.stringify(data); return { getItem: () => raw, setItem: (_, v) => { raw = v; } }; };
  const saved = keys => ({ v: 1, bindings: { crouch: { keys, pad: ['Pad1'] }, jump: { keys: ['KeyJ', null], pad: ['Pad0'] } }, settings: {} });
  const old = new ActionMap({ storage: store(saved(['ControlLeft', 'KeyC'])) });
  assert.deepEqual(old.bindingsFor('crouch').keys, ['KeyC', null]);
  assert.deepEqual(old.bindingsFor('jump').keys, ['KeyJ', null], 'other saved bindings survive');
  for (const keys of [['ControlLeft', null], ['KeyC', 'ControlLeft'], ['ControlRight', 'KeyC']]) {
    assert.deepEqual(new ActionMap({ storage: store(saved(keys)) }).bindingsFor('crouch').keys, keys, `custom ${keys} kept`);
  }
});

// ---------------------------------------------------------------- CTL-6

test('CTL-6: a Space tap shorter than a frame still jumps (and rises while diving)', () => {
  const s = controlsSetup();
  fire(win, 'keydown', { code: 'Space', target: null }); fire(win, 'keyup', { code: 'Space' });
  assert.equal(s.c.movement(1 / 60, true, physics).jump, true, 'sub-frame tap');
  assert.equal(s.c.movement(1 / 60, true, physics).jump, false, 'one frame only');
  fire(win, 'keydown', { code: 'Space', target: null });
  assert.equal(s.c.movement(1 / 60, true, physics).jump, true);
  assert.equal(s.c.movement(1 / 60, true, physics).jump, true, 'held keeps jumping (swim rise)');
  fire(win, 'keyup', { code: 'Space' });
  assert.equal(s.c.movement(1 / 60, true, physics).jump, false);
  s.done();
  assert.match(gameSrc, /diving\?\.move\((?:dt|laneDt), physics, \{[^\n]*up:ci \? ci\.jump :/, 'diving up reads the same jump signal');
});
