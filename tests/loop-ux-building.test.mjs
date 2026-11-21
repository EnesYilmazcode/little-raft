// Regression tests for build-wheel input bugs: Q auto-repeat, hotbar/interact leaking through an open wheel,
// and R being swallowed for pieces that do not rotate.
// Run: node --test tests/loop-ux-building.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;

// ---- minimal DOM: any unknown property is a no-op function / nested fake ----
const noop = () => {};
function fakeEl() {
  const cls = new Set(), store = { dataset: {}, style: {}, hidden: false, offsetWidth: 0, width: 0, height: 0 };
  const classList = { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, on) => ((on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c)), contains: c => cls.has(c) };
  const el = new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'classList') return classList;
      if (k === 'querySelectorAll') return () => Array.from({ length: 16 }, () => fakeEl());
      if (k === 'querySelector' || k === 'getContext' || k === 'closest') return () => fakeEl();
      if (k === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 100, height: 100 });
      if (k === 'getImageData' || k === 'createImageData') return (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0)) * 4) });
      if (typeof k === 'symbol' || k === 'then') return undefined;
      return () => fakeEl(); // createLinearGradient() etc. hand back another fake
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return el;
}
const win = new EventTarget();
globalThis.window = win;
globalThis.addEventListener = win.addEventListener.bind(win);
globalThis.removeEventListener = win.removeEventListener.bind(win);
const doc = new EventTarget();
Object.assign(doc, { pointerLockElement: null, visibilityState: 'visible', head: fakeEl(), body: fakeEl(),
  getElementById: () => null, createElement: () => fakeEl(), createElementNS: () => fakeEl() });
globalThis.document = doc;
try { globalThis.navigator.getGamepads = () => []; } catch { Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true }); }

const T = await import(new URL('vendor/three.module.js', base));
const { createBuilding } = await import(new URL('building.js', base));
const { createControls } = await import(new URL('controls.js', base));
const { PIECES, PIECE_ORDER } = await import(new URL('building-pieces.js', base));

// Select a piece through the wheel the way a player does: open, highlight its sector, confirm.
function pick(b, id) {
  const i = PIECE_ORDER.indexOf(id), step = 360 / PIECE_ORDER.length, a = (i * step) * Math.PI / 180;
  b.menu.open(); b.menu.move(Math.sin(a) * 200, -Math.cos(a) * 200); b.menu.close(true);
  assert.equal(b.piece, id);
}

// ============================================================ B1: Q auto-repeat

test('B1: holding Q opens the wheel once; auto-repeat neither closes it nor commits a sector', () => {
  const b = createBuilding(T, new T.Scene());
  assert.equal(b.piece, 'foundation');
  assert.equal(b.key('KeyQ', true, true, false), true);
  assert.equal(b.menu.isOpen, true);
  b.menu.move(200, 0); // highlight a sector while still holding Q
  for (let n = 0; n < 6; n++) assert.equal(b.key('KeyQ', true, true, true), true, 'repeat stays consumed');
  assert.equal(b.menu.isOpen, true, 'auto-repeat must not toggle the wheel');
  assert.equal(b.piece, 'foundation', 'no repeat commit');
  b.key('KeyQ', false, true, false);
  b.key('KeyQ', true, true, false); // a fresh press still closes and commits
  assert.equal(b.menu.isOpen, false);
  assert.notEqual(b.piece, 'foundation');
  b.dispose();
});

// ============================================================ B3: R only for rotatable pieces

test('B3: R is consumed only for cell pieces (floor/stairs/roof); others fall through to sail/repair', () => {
  const b = createBuilding(T, new T.Scene());
  for (const id of PIECE_ORDER) {
    if (id === 'foundation') continue;
    pick(b, id);
    const cell = PIECES[id].slot === 'cell';
    const r0 = b.rotation;
    assert.equal(b.key('KeyR', true, true, false), cell, `${id}: consumed=${cell}`);
    assert.equal(b.rotation, cell ? (r0 + 1) % 4 : r0, `${id}: rotation`);
  }
  for (const id of ['wall', 'halfwall', 'window', 'door', 'pillar']) assert.notEqual(PIECES[id].slot, 'cell', id);
  for (const id of ['floor', 'stairs', 'roof']) assert.equal(PIECES[id].slot, 'cell', id);
  pick(b, 'foundation');
  assert.equal(b.key('KeyR', true, true, false), false, 'foundation: R stays hook repair');
  b.dispose();
});

// ============================================================ B2: wheel open blocks hotbar + interact

function key(type, code) { const e = new Event(type); Object.assign(e, { code, key: code, repeat: false }); win.dispatchEvent(e); }
function wheel(deltaY) { const e = new Event('wheel'); Object.assign(e, { deltaY, deltaMode: 0 }); win.dispatchEvent(e); }
const physics = { grounded: true, swimming: false, vx: 0, vz: 0, vy: 0 };

function setupControls() {
  let open = false;
  const calls = [];
  const rec = name => (...a) => calls.push([name, ...a]);
  const c = createControls({ canvas: null, isBlocked: () => false, look: rec('look'), hotbarSize: 10, slot: () => 0,
    selectSlot: rec('selectSlot'), interact: rec('interact'), inventory: rec('inventory'), repair: rec('repair'), pause: rec('pause'),
    useDown: noop, useUp: noop, useCancel: noop, reelDown: noop, reelUp: noop, buildWheelOpen: () => open });
  return { c, calls, tick: () => c.movement(1 / 60, true, physics), setOpen: v => { open = v; } };
}

test('B2: number keys, mouse wheel and E do nothing while the build wheel is open (and do not fire on close)', () => {
  const s = setupControls();
  s.setOpen(true);
  key('keydown', 'Digit3'); s.tick(); key('keyup', 'Digit3');
  wheel(120); s.tick();
  key('keydown', 'KeyE'); s.tick(); key('keyup', 'KeyE'); s.tick();
  assert.deepEqual(s.calls.filter(c => c[0] === 'selectSlot' || c[0] === 'interact'), [], 'nothing leaks while open');
  s.setOpen(false); s.tick(); s.tick();
  assert.deepEqual(s.calls.filter(c => c[0] === 'selectSlot' || c[0] === 'interact'), [], 'drained, not deferred');
  // closed again: the same inputs work normally
  key('keydown', 'Digit3'); s.tick(); key('keyup', 'Digit3');
  key('keydown', 'KeyE'); s.tick(); key('keyup', 'KeyE'); s.tick();
  assert.ok(s.calls.some(c => c[0] === 'selectSlot' && c[1] === 2), 'Digit3 -> slot index 2');
  assert.ok(s.calls.some(c => c[0] === 'interact'));
  s.c.dispose();
});

test('B2: WASD movement still works while the wheel is open (intended, Raft-like)', () => {
  const s = setupControls();
  s.setOpen(true);
  key('keydown', 'KeyW'); for (let n = 0; n < 10; n++) s.tick();
  const m = s.tick();
  key('keyup', 'KeyW');
  assert.ok(m.forward > 0, 'forward input passes through');
  s.c.dispose();
});

test('B2: game.js wiring blocks legacy digits/E/wheel and passes buildWheelOpen to controls', () => {
  const src = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');
  assert.match(src, /buildWheelOpen:\s*\(\)\s*=>\s*!!building\?\.menu\.isOpen/);
  const wheelH = src.slice(src.indexOf("on(window, 'wheel'"), src.indexOf("on($('#resumeHint')"));
  assert.match(wheelH, /if \(building\?\.menu\.isOpen\) return;/);
  assert.ok(wheelH.indexOf('building?.menu.isOpen') < wheelH.indexOf('selectSlot'));
  const kd = src.slice(src.indexOf('const m = /^(?:Digit|Numpad)'), src.indexOf("if (e.code === 'KeyR' && !e.repeat)"));
  assert.match(kd, /selectSlot/);
  assert.match(kd, /wheelOpen/);
  assert.match(kd, /KeyE' && !e\.repeat && !wheelOpen/);
});
