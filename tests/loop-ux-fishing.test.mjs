// Regression tests for rod/grill input UX bugs in the fishing & cooking lane (dist/fishing-cooking.js + game.js wiring).
// Run: node --test tests/loop-ux-fishing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { createFishingCooking } = await import(new URL('fishing-cooking.js', base));
const gameSrc = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');

const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) } });
globalThis.window ??= {};

function mount({ kind = 'fishingrod', tiles = [[0, 0]], bag = { wood: 20, scrap: 6 } } = {}) {
  mem.clear();
  const counts = { ...bag }, notices = [];
  const bagApi = {
    count: (k) => counts[k] || 0,
    remove: (k, n) => ((counts[k] || 0) >= n ? ((counts[k] -= n), true) : false),
    add: (k, n) => ((counts[k] = (counts[k] || 0) + n), 0),
    emit: (t) => notices.push(t),
  };
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(70, 1, 0.05, 200);
  scene.add(camera);
  const h = {
    scene, raft: null, camera, ocean: { getHeight: () => 0 }, rodModel: null,
    role: () => 'solo', netReady: () => false, send() {}, notice: (t) => notices.push(t), beep() {},
    selectedKind: () => h._kind, _kind: kind, aim: () => null, rodTip: () => new T.Vector3(0.3, 1.4, -0.4),
    player: () => ({ x: 0, y: 1, z: 0 }), hasTile: (x, z) => tiles.some(([a, b]) => a === x && b === z), decorAt: () => false,
    bagCount: (k) => counts[k] || 0, running: () => h._running, _running: true, uiBlocked: () => false, busy: () => false, resume() {},
    action(a) { if (a.kind.startsWith('fc:')) h.api.applyAction(a, 'host', bagApi); return true; },
  };
  h.api = createFishingCooking(T, h);
  h.debug = globalThis.window.raftFC;
  h.step = (sec, dt = 0.05) => { for (let t = 0; t < sec - 1e-9; t += dt) h.api.update(dt); };
  return Object.assign(h, { counts, notices, bagApi });
}

test('D1: losing focus mid-charge cancels the cast; the relock click does not fire a stale full-power cast', () => {
  const h = mount();
  assert.equal(h.api.pointerDown(), true);
  h.step(0.1);
  assert.equal(h.debug.session.stage, 'charging');
  assert.equal(h.api.releaseInput(), true, 'reports that a hold was dropped');
  h.step(10); // away
  assert.equal(h.debug.session, null, 'charge cancelled, session ended');
  assert.equal(h.api.pointerUp(), false, 'the relock click pointerup is not consumed (game.js goes on to requestLock)');
  assert.equal(h.debug.state.stage, 'idle');
});

test('D1: losing focus while holding the reel lets go of the line', () => {
  const h = mount();
  h.debug.forceBite('pomfret'); h.step(0.05);
  assert.equal(h.debug.session.stage, 'bite');
  h.api.pointerDown();
  assert.equal(h.debug.session.stage, 'reeling');
  assert.equal(h.api.rodReeling, true);
  h.api.releaseInput();
  assert.equal(h.debug.session.holding, false);
  assert.equal(h.api.rodReeling, false);
  assert.equal(h.api.pointerUp(), false, 'no pending press left');
  assert.equal(h.api.releaseInput(), false, 'idempotent');
});

test('D1: game.js drops the rod hold on blur/clearInput, lock loss (not drag-look) and gamepad cancel', () => {
  assert.match(gameSrc, /function clearInput\(\) \{[^\n]*fc\?\.releaseInput\(\)/);
  const plc = gameSrc.slice(gameSrc.indexOf("'pointerlockchange'"), gameSrc.indexOf("'pointerlockerror'"));
  assert.match(plc, /if \(!lockFallback\) fc\?\.releaseInput\(\)/);
  assert.match(gameSrc, /useCancel:\(\) => \{[^}]*fc\?\.releaseInput\(\)/);
  const blur = gameSrc.match(/on\(window, 'blur', \(\) => \{([^\n]*)/)[1];
  assert.match(blur, /clearInput\(\)/);
});
