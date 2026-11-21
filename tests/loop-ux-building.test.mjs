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
