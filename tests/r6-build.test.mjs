// Round-6 building regressions: stairs underfoot pickable (K5), host reach for pieces (K4), pieces vs decor
// overlap (K3), hammer chip / R routing (K1), decor rotation steps (K2), pad rotate + remove (P2), and
// X removing decor and bare floor tiles (K6).
// Run: node --test tests/r6-build.test.mjs
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
      if (k === 'getContext' || k === 'closest') return () => fakeEl();
      if (k === 'querySelector') return sel => (store.q ??= {})[sel] ??= fakeEl(); // stable children, so tests can read them
      if (k === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 100, height: 100 });
      if (k === 'getImageData' || k === 'createImageData') return (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0)) * 4) });
      if (typeof k === 'symbol' || k === 'then') return undefined;
      return () => fakeEl();
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
const { BuildGrid, PIECES, PIECE_ORDER } = await import(new URL('building-pieces.js', base));
const gameSrc = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');

const tiles3 = () => { const t = []; for (const x of [-1, 0, 1]) for (const z of [-1, 0, 1]) t.push([x, z]); return t; };
const DECK = 0.2;

// ============================================================ K5: stairs underfoot

test('K5: the stairs you stand on can be picked, but never steal an aim at a piece the ray enters', () => {
  const g = new BuildGrid(); g.setTiles(tiles3());
  assert.ok(g.place({ t: 'stairs', i: 1, j: 1, l: 0, r: 2 }));
  const eye = [2, DECK + 0.4 + 1.6, 2.6]; // on the lower half of the stairs, eye inside its box
  assert.equal(g.pick(eye[0], eye[1], eye[2], 0, -1, -0.3, DECK, 7)?.t, 'stairs', 'looking down at the tread underfoot');
  assert.ok(g.place({ t: 'wall', i: 1, j: 0, l: 0, r: 0 })); // a wall ahead, on the z = -1 edge of cell (1, 0)
  assert.equal(g.pick(eye[0], eye[1], eye[2], 0, -0.2, -1, DECK, 7)?.t, 'wall', 'a box the ray enters wins over the one we are inside');
  const g2 = new BuildGrid(); g2.setTiles(tiles3()); g2.place({ t: 'stairs', i: 1, j: 1, l: 0, r: 2 });
  const out = g2.aim(eye[0], eye[1], eye[2], 0, 0.3, -1, 'floor', 0, DECK, 7, {});
  assert.ok(out && out.t === 'floor' && out.l === 1, 'aiming a floor above from the stairs finds a slot');
});
