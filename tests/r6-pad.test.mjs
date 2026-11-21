// Round-6 pad fixes: gamepad focus layer in panels (P1), controls tab in settings + one Invert Y (P3/P5),
// pad look on real frame time (P4). Drives the real input.js / controls.js with a stubbed navigator.getGamepads.
// Run: node --test tests/r6-pad.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = name => readFileSync(fileURLToPath(new URL(name, base)), 'utf8');

const gdoc = new EventTarget();
Object.assign(gdoc, { pointerLockElement: null, visibilityState: 'visible', getElementById: () => null });
globalThis.document = gdoc;
const gwin = new EventTarget(); gwin.document = gdoc; globalThis.window = gwin;
const gpads = [null, null, null, null];
try { globalThis.navigator.getGamepads = () => gpads; } catch { Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => gpads }, configurable: true }); }
globalThis.dispatchEvent ??= () => true;

const { createInput } = await import(new URL('input.js', base));
const { ActionMap } = await import(new URL('input-map.js', base));
const { createControls } = await import(new URL('controls.js', base));
const { pickNeighbor } = await import(new URL('pad-nav.js', base));

const btn = (v = 0) => ({ pressed: v > 0.5, touched: v > 0, value: v });
const makePad = () => ({ index: 0, id: 'pad', mapping: 'standard', connected: true, timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => btn(0)) });
function fire(target, type, props = {}) {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v, configurable: true });
  target.dispatchEvent(e); return e;
}

function inputSetup(opts = {}) {
  const doc = new EventTarget(); doc.visibilityState = 'visible';
  const win = new EventTarget(); win.document = doc;
  const canvas = new EventTarget(); doc.pointerLockElement = canvas;
  const pads = [null, null, null, null], ev = [];
  let blocked = false;
  const map = opts.map ?? new ActionMap();
  const input = createInput({ target: win, element: canvas, map, doc, isBlocked: () => blocked, getGamepads: () => pads, now: () => 0,
    onAction: (id, phase, info) => ev.push(`${id}:${phase}${info?.nav ? ':nav' : ''}`), blockedActions: ['inventory', 'pause'], menuNav: true, ...opts.input });
  const p = makePad(); pads[0] = p; fire(win, 'gamepadconnected', { gamepad: p });
  return { input, p, ev, map, tick: (dt = 1 / 60, look) => input.update(dt, look), block: v => { blocked = v; },
    navs: () => ev.filter(e => e.endsWith(':nav')).map(e => e.slice(0, -4)) };
}

// ---------------------------------------------------------------- P1: pad focus layer

test('P1: while blocked, D-pad / A / LB / RB emit nav events; the opening press stays suppressed', () => {
  const s = inputSetup();
  s.p.buttons[0] = btn(1); s.tick(); // A held (jumping)...
  s.p.buttons[3] = btn(1); s.tick(); // ...when Y opens the bag
  s.block(true); s.tick(); s.tick();
  s.p.buttons[3] = btn(0); s.p.buttons[0] = btn(0); s.tick();
  assert.deepEqual(s.navs(), [], 'held buttons from play never activate the panel');
  for (const i of [13, 12, 14, 15, 4, 5]) { s.p.buttons[i] = btn(1); s.tick(); s.p.buttons[i] = btn(0); s.tick(); }
  assert.deepEqual(s.navs(), ['navDown:down', 'navUp:down', 'navLeft:down', 'navRight:down', 'tabPrev:down', 'tabNext:down']);
  s.ev.length = 0;
  s.p.buttons[0] = btn(1); s.tick(); s.tick(); s.tick(); s.p.buttons[0] = btn(0); s.tick();
  assert.deepEqual(s.navs(), ['activate:down', 'activate:up'], 'A: one down while held (hold-to-craft), up on release');
});

test('P1: a held direction repeats after a delay; the left stick navigates along its dominant axis', () => {
  const s = inputSetup(); s.block(true); s.tick();
  s.p.buttons[13] = btn(1);
  for (let i = 0; i < 30; i++) s.tick(1 / 60, 1 / 60); // 0.5 s held
  const downs = s.navs().filter(e => e === 'navDown:down').length;
  assert.ok(downs >= 2 && downs <= 3, `first press + repeats after ~0.36 s, got ${downs}`);
  s.p.buttons[13] = btn(0); s.tick(); s.ev.length = 0;
  s.p.axes[0] = 0.6; s.p.axes[1] = -0.9; s.tick(); // up-right, mostly up
  assert.deepEqual(s.navs(), ['navUp:down']);
  s.p.axes[0] = s.p.axes[1] = 0; s.tick(); s.ev.length = 0;
  s.p.axes[0] = 1; s.tick(); s.tick(); s.p.axes[0] = 0; s.tick();
  assert.deepEqual(s.navs(), ['navRight:down']);
});

test('P1: without menuNav (default) the pad still ignores everything but the menu buttons while blocked', () => {
  const s = inputSetup({ input: { menuNav: false } }); s.block(true); s.tick();
  for (const i of [13, 0, 5]) { s.p.buttons[i] = btn(1); s.tick(); s.p.buttons[i] = btn(0); s.tick(); }
  assert.deepEqual(s.ev, []);
});

test('P1: menu buttons never double as nav; B stays back', () => {
  const map = new ActionMap(); map.rebind('inventory', 'Pad0', { device: 'pad' }); // player put the bag on A
  const s = inputSetup({ map }); s.block(true); s.tick();
  s.p.buttons[0] = btn(1); s.tick(); s.p.buttons[0] = btn(0); s.tick();
  s.p.buttons[1] = btn(1); s.tick(); s.p.buttons[1] = btn(0); s.tick();
  assert.deepEqual(s.ev, ['inventory:down', 'back:down']);
});

test('P1: the A press that closes the panel (Resume) does not leak into play as a jump', () => {
  const blockedRef = { v: true }; // the activate callback closes the panel mid-update, like Resume does
  const doc = new EventTarget(); doc.visibilityState = 'visible'; const win = new EventTarget(); win.document = doc;
  const pads = [makePad()];
  const input = createInput({ target: win, element: null, map: new ActionMap(), doc, isBlocked: () => blockedRef.v, getGamepads: () => pads, now: () => 0,
    blockedActions: ['inventory', 'pause'], menuNav: true, onAction: (id, phase) => { if (id === 'activate' && phase === 'down') blockedRef.v = false; } });
  fire(win, 'gamepadconnected', { gamepad: pads[0] });
  input.update(1 / 60);
  pads[0].buttons[0] = btn(1); input.update(1 / 60); // A on Resume: closes the panel inside the callback
  assert.equal(blockedRef.v, false);
  for (let i = 0; i < 5; i++) input.update(1 / 60);
  assert.equal(input.down('jump'), false, 'A still held after Resume is suppressed');
  pads[0].buttons[0] = btn(0); input.update(1 / 60);
  pads[0].buttons[0] = btn(1); input.update(1 / 60);
  assert.equal(input.pressed('jump'), true, 'a fresh A jumps again');
  input.dispose();
});

function controlsSetup(extra = {}) {
  let blocked = false; const calls = [];
  const p = makePad(); gpads[0] = p;
  const c = createControls({ canvas: null, isBlocked: () => blocked, look: () => {}, hotbarSize: 8, slot: () => 0, selectSlot() {},
    menuBack: id => calls.push(['menuBack', id]), menuNav: (id, phase) => calls.push([id, phase]), inventory: () => calls.push(['inventory']), ...extra });
  fire(gwin, 'gamepadconnected', { gamepad: p });
  const phys = { grounded: true, swimming: false, vx: 0, vz: 0, vy: 0 };
  return { c, p, calls, tick: (dt = 1 / 60, look) => c.movement(dt, !blocked, phys, look), block: v => { blocked = v; }, done() { c.dispose(); gpads[0] = null; } };
}

test('P1: controls routes nav events to g.menuNav, back/pause still to menuBack', () => {
  const s = controlsSetup();
  s.block(true); s.tick();
  for (const i of [13, 0, 5, 1]) { s.p.buttons[i] = btn(1); s.tick(); s.p.buttons[i] = btn(0); s.tick(); }
  assert.deepEqual(s.calls, [['navDown', 'down'], ['activate', 'down'], ['activate', 'up'], ['tabNext', 'down'], ['menuBack', 'back']]);
  s.done();
});

test('P1: nothing navigates while a rebind is capturing', async () => {
  const s = controlsSetup();
  const h = s.c.mountTab(null); // module load fails in node (no DOM): the handle still reports capturing
  Object.defineProperty(h, 'capturing', { get: () => true });
  s.block(true); s.tick();
  for (const i of [13, 0, 1]) { s.p.buttons[i] = btn(1); s.tick(); s.p.buttons[i] = btn(0); s.tick(); }
  assert.deepEqual(s.calls, []);
  assert.equal(s.c.capturing, true);
  s.c.unmountTab(h); await h.ready; s.done();
});

test('P1: pickNeighbor moves spatially (cone first, then half-plane) and returns -1 at an edge', () => {
  const r = (left, top, width = 40, height = 40) => ({ left, top, width, height });
  const rects = [r(0, 0), r(100, 0), r(0, 100)];
  assert.equal(pickNeighbor(rects, 0, 'ArrowRight'), 1);
  assert.equal(pickNeighbor(rects, 0, 'ArrowDown'), 2);
  assert.equal(pickNeighbor(rects, 0, 'ArrowUp'), -1);
  assert.equal(pickNeighbor([r(0, 0), r(300, 100)], 0, 'ArrowDown'), 1, 'nothing in the cone: nearest in the half-plane');
  // Pin (top right of the recipe detail) -> Down reaches the wide Craft button below it, not a bag slot off to the side
  assert.equal(pickNeighbor([r(300, 0), r(0, 200, 400, 40), r(420, 120)], 0, 'ArrowDown'), 1);
});

test('P1: game.js wires the focus layer to the open panel; pad-nav reuses panel arrow handlers', () => {
  const game = src('game.js'), nav = src('pad-nav.js');
  assert.match(game, /import \{ createPadNav \} from '\.\/pad-nav\.js\?build=/);
  assert.match(game, /menuNav:\(id, phase\) => padNav\.handle\(id, phase\)/);
  assert.match(game, /createPadNav\(\{doc:document, scope:\(\) => survivalUI\?\.isOpen \? \$\('#inventory'\) : settingsController\?\.isOpen \? \$\('#options'\) : topDialog\(\)\}\)/);
  // B in settings folds the panel first; other dialogs close (their close handlers relock)
  assert.match(game, /menuBack:id => \{[^\n]*id === 'back' && settingsController\?\.back\(\)\) return;[^\n]*settingsController\.close\(\); else topDialog\(\)\?\.close\(\); \}/);
  assert.match(nav, /key\(el, 'keydown', code\); if \(!across\) key\(el, 'keyup', code\)/, 'synthetic arrows always get their keyup');
  assert.match(nav, /stepUp\(\) : el\.stepDown\(\)/, 'range inputs adjust left/right');
  assert.match(nav, /if \(key\(el, 'keydown', 'Enter'\)\) return;/, 'Enter keydown first (craft button hold-to-craft)');
  assert.match(nav, /if \(el\) key\(el, 'keyup', 'Enter'\)/, 'A release ends the hold');
  assert.match(src('survival-ui.js'), /D\.btn\.addEventListener\('keydown', e => \{\n\s*if \(e\.code !== 'Enter'/, 'craft button starts a hold on Enter');
  assert.ok(src('live.js').includes("'pad-nav.js'"), 'live.js preloads pad-nav.js');
});

// ---------------------------------------------------------------- P3 / P5: controls tab in settings, one Invert Y

test('P3: settings mounts the controls tab on the Controls page and unmounts it on close; Esc while capturing cancels only', () => {
  const s = src('settings.js');
  assert.match(s, /rc\.mountTab\(host, \{ hide: \['invertY'\] \}\)/);
  assert.match(s, /'<div class="rs-ctab"><\/div>'/);
  assert.match(s, /function close\(resume = true\) \{\n\s*if \(!owns\(\)\) return;\n\s*unmountControlsTab\(\);/);
  assert.match(s, /dialog\.addEventListener\('close', unmountControlsTab, sig\)/);
  assert.match(s, /if \(dialog\.open && capturing\(\)\) \{ ctab\.cancel\?\.\(\); return true; \}/, 'desktop raftEscape cancels the rebind');
  assert.match(s, /if \(dialog\.open && capturing\(\)\) \{ esc\.keydown\(performance\.now\(\), \{ handled: true \}\); return; \}/, 'browser Esc keydown leaves it to the tab');
  assert.match(s, /if \(capturing\(\)\) return; \/\/ Esc while rebinding/, 'native dialog cancel ignored while capturing');
  const c = src('controls.js');
  assert.match(c, /cancel\(\) \{ tab\?\.cancel\?\.\(\); \}/);
  assert.match(c, /createControlsTab\(\{map, input, hide:opts\.hide\}\)/);
});

test('P5: one mouse Invert Y: settings writes map.settings.invertY, game.js look() does not invert on the controls path', () => {
  const s = src('settings.js'), game = src('game.js'), tab = src('controls-tab.js');
  assert.match(s, /invertY: \{ tab: 'controls', label: 'Invert mouse Y'/);
  assert.match(s, /window\.raftControls\?\.map\?\.setSetting\?\.\('invertY', !!values\.invertY\)/);
  assert.match(s, /save\(values\);\n\s*pushInvert\(\);/, 'every change reaches the input map');
  assert.match(game, /function look\(dx, dy, k, raw = false\) \{[^\n]*!raw && options\.invertY/);
  assert.match(game, /look:\(dx, dy\) => \{ if \(!building\?\.menu\.isOpen\) look\(dx, dy, 1, true\); \}/, 'controls path passes raw');
  assert.match(game, /look\(dx, dy, LOOK_SENSITIVITY \* options\.sensitivity\);/, 'legacy mouse path still inverts in look()');
  assert.match(tab, /if \(hide\?\.includes\?\.\(k\)\) continue;/);
  assert.match(tab, /padInvertY: 'Invert gamepad Y'/, 'pad invert stays, labelled for the controller');

  // behaviour: with invertY set on the map, mouse dy flips exactly once and pad Y is untouched
  const map = new ActionMap(); map.setSetting('invertY', true);
  const doc = new EventTarget(); doc.visibilityState = 'visible'; const win = new EventTarget(); win.document = doc;
  const canvas = new EventTarget(); doc.pointerLockElement = canvas;
  const pads = [makePad()];
  const input = createInput({ target: win, element: canvas, map, doc, getGamepads: () => pads, now: () => 0 });
  fire(win, 'gamepadconnected', { gamepad: pads[0] });
  fire(doc, 'mousemove', { movementX: 0, movementY: 10 }); fire(doc, 'mousemove', { movementX: 0, movementY: 10 }); input.update(1 / 60);
  assert.ok(input.lookDelta().dy < 0, 'mouse down -> look up with Invert mouse Y');
  pads[0].axes[3] = 1; input.update(1 / 60, 1 / 60);
  assert.ok(input.lookDelta().dy > 0, 'pad Y only follows Invert gamepad Y');
  input.dispose();
});

// ---------------------------------------------------------------- P4: pad look on real frame time

test('P4: right-stick turn rate is the same at 10 fps as at 60 fps', () => {
  const rate = fps => {
    let yaw = 0;
    const p = makePad(); gpads[0] = p;
    const c = createControls({ canvas: null, isBlocked: () => false, look: dx => { yaw += dx; }, hotbarSize: 8, slot: () => 0, selectSlot() {} });
    fire(gwin, 'gamepadconnected', { gamepad: p });
    const phys = { grounded: true, swimming: false, vx: 0, vz: 0, vy: 0 };
    p.axes[2] = 1;
    const dt = 1 / fps;
    for (let i = 0; i < fps; i++) c.movement(Math.min(dt, 0.05), true, phys, Math.min(dt, 0.25)); // what game.js passes
    c.dispose(); gpads[0] = null;
    return yaw;
  };
  const r60 = rate(60), r10 = rate(10), r5 = rate(5);
  assert.ok(r60 > 1, 'turns');
  assert.ok(Math.abs(r10 - r60) / r60 < 0.05, `10 fps ${r10} vs 60 fps ${r60}`);
  assert.ok(Math.abs(r5 - r60) / r60 < 0.05, `5 fps ${r5} vs 60 fps ${r60}`);
  assert.match(src('game.js'), /controls\?\.movement\(laneDt, running && input, physics, Math\.min\(dt, \.25\)\)/);
  assert.match(src('input.js'), /function update\(dt = 0, lookDt = dt\)/);
  assert.match(src('input.js'), /pl = pollPad\(lookDt\);/);
});
