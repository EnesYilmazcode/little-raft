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

test('D2: E runs the water action (purifier / planter) before the grill, matching the prompt order', () => {
  const fnBody = (name) => { const i = gameSrc.indexOf(`function ${name}(`); assert.ok(i >= 0, name); return gameSrc.slice(i, gameSrc.indexOf('\n  }\n', i)); };
  const ctx = fnBody('updateContext'), act = fnBody('interact');
  // prompt: pick-up, water, content, grill
  const order = (src, marks) => marks.map((m) => { const i = src.indexOf(m); assert.ok(i >= 0, m); return i; });
  const p = order(ctx, ['pickTarget)', 'waterAim?.prompt', 'content?.prompt', 'fc?.prompt']);
  assert.deepEqual([...p].sort((a, b) => a - b), p, 'updateContext prompt order');
  const a = order(act, ['pickupFrom(currentAim());\n', 'wateringTarget(currentAim())', 'content?.interact', 'fc?.interact()', 'prog?.interact']);
  assert.deepEqual([...a].sort((x, y) => x - y), a, 'interact() must try water right after pick-up, before content and the grill');
});

test('D3: gamepad RT drives the fishing-cooking rod (species catch) before the legacy use/charge path', () => {
  const down = gameSrc.match(/useDown:\(\) => \{(.*)/)[1];
  assert.match(down, /^\s*if \(fc\?\.pointerDown\(\)\) return;/, 'fc.pointerDown is tried first');
  const up = gameSrc.match(/useUp:\(\) => \{(.*)/)[1];
  const i = up.indexOf('fc?.pointerUp()');
  assert.ok(i >= 0 && i < up.indexOf('releaseCharge'), 'fc.pointerUp before releaseCharge');
  // the lane takes that press/release pair as a full cast
  const h = mount();
  assert.equal(h.api.pointerDown(), true);
  h.step(0.3);
  assert.equal(h.api.pointerUp(), true);
  assert.equal(h.debug.session.stage, 'flying');
});

test('D4: a click during the escaped linger starts a fresh cast instead of being swallowed', () => {
  const h = mount();
  h.api.pointerDown(); h.step(0.3); h.api.pointerUp(); h.step(1.2);
  assert.equal(h.debug.session.stage, 'waiting');
  h.api.pointerDown(); h.api.pointerUp(); h.step(0.05); // too early: spooked
  assert.equal(h.debug.session.stage, 'escaped');
  h.step(0.2);
  const old = h.debug.session;
  assert.equal(h.api.pointerDown(), true);
  assert.notEqual(h.debug.session, old, 'new session');
  assert.equal(h.debug.session.stage, 'charging');
  h.step(0.3); h.api.pointerUp(); h.step(0.05);
  assert.equal(h.debug.session.stage, 'flying', 'the recast flies');
  h.step(1);
  assert.ok(h.debug.session && h.debug.session.stage !== 'done', 'still fishing after the old linger would have ended');
});

test('D4: a click during the caught linger also recasts', () => {
  const h = mount();
  h.debug.forceBite('pomfret'); h.step(0.05);
  h.api.pointerDown(); // reel and hold until landed
  for (let i = 0; i < 400 && h.debug.session.stage === 'reeling'; i++) {
    // ease off whenever tension runs hot so the line never snaps
    if (h.debug.session.tension > 0.6) { h.api.pointerUp(); h.step(0.05); h.api.pointerDown(); } else h.step(0.05);
  }
  h.api.pointerUp();
  assert.equal(h.debug.session.stage, 'caught');
  assert.equal(h.api.pointerDown(), true);
  assert.equal(h.debug.session.stage, 'charging');
});

test('D5: grills do not cook, burn or use fuel while the game is not running (title screen)', () => {
  const h = mount({ kind: 'hammer' });
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  const g = [...h.api.grills.values()][0], id = g.st.id;
  h.action({ kind: 'fc:fuel', id });
  h.action({ kind: 'fc:cook', id, fish: { species: 'pomfret', cm: 30 } });
  const before = JSON.stringify(g.st.snapshot());
  let flicker = 0; const upd = g.model.userData.update;
  g.model.userData.update = (dt, t) => { if (dt > 0) flicker++; return upd?.(dt, t); };
  h._running = false;
  h.step(120);
  assert.equal(JSON.stringify(g.st.snapshot()), before, 'fish and fuel frozen on the title screen');
  assert.ok(flicker > 0, 'fire visuals keep animating');
  h._running = true;
  h.step(2);
  assert.ok(g.st.fuel < JSON.parse(before).fuel, 'cooking resumes once back in the game');
  assert.ok(g.st.slots.some((f) => f && f.t > 0));
});
