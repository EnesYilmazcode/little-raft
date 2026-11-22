// Camera snap regression: pointer-lock spikes, lock/unlock and panel open/close must never throw the
// view to the top or bottom clamp. Drives the real input layer (dist/input.js) with a fake document and
// integrates pitch exactly like game.js look(). Run: node --test tests/camera-snap.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { createInput } = await import(new URL('input.js', base));
const { ActionMap } = await import(new URL('input-map.js', base));
const R = await import(new URL('input-rules.js', base));
const gameSrc = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');
const PITCH_LIMIT = +gameSrc.match(/PITCH_LIMIT = ([\d.]+)/)[1];

function fire(target, type, props = {}) {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v, configurable: true });
  target.dispatchEvent(e);
}
// sensitivity 3 is the settings maximum: the worst case for a spike
function rig(sensitivity = 3) {
  const doc = new EventTarget(); doc.pointerLockElement = null; doc.visibilityState = 'visible';
  const win = new EventTarget(); win.document = doc;
  const canvas = new EventTarget();
  let blocked = false, pitch = 0, maxStep = 0;
  const input = createInput({ target: win, element: canvas, map: new ActionMap({}), doc, sensitivity, isBlocked: () => blocked, getGamepads: () => [] });
  const frame = () => {
    input.update(1 / 60);
    const { dy } = input.lookDelta();
    const next = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch - dy)); // game.js look()
    maxStep = Math.max(maxStep, Math.abs(next - pitch)); pitch = next;
  };
  return {
    move(dy, dx = 0) { fire(doc, 'mousemove', { movementX: dx, movementY: dy }); frame(); },
    moveNoFrame(dy, dx = 0) { fire(doc, 'mousemove', { movementX: dx, movementY: dy }); },
    frame,
    lock({ moveFirst = 0 } = {}) { doc.pointerLockElement = canvas; if (moveFirst) this.moveNoFrame(moveFirst); fire(doc, 'pointerlockchange'); },
    unlock() { doc.pointerLockElement = null; fire(doc, 'pointerlockchange'); },
    block(v) { blocked = v; },
    get pitch() { return pitch; }, get maxStep() { return maxStep; }, resetStep() { maxStep = 0; },
  };
}
// a sane per-frame pitch change: 60 counts of slow aim at sensitivity 3 is about 0.4 rad
const SANE = .45;

test('camera-snap: lock-entry jump is dropped even when it arrives before pointerlockchange', () => {
  for (const early of [false, true]) {
    const r = rig();
    if (early) r.lock({ moveFirst: 300 }); else { r.lock(); r.move(900); }
    for (let i = 0; i < 5; i++) r.move(4);
    assert.ok(r.maxStep < SANE, `early=${early} step ${r.maxStep}`);
    assert.ok(Math.abs(r.pitch) < .2, `early=${early} pitch ${r.pitch}`);
  }
});

test('camera-snap: closing an interaction panel and relocking never snaps the view', () => {
  const r = rig();
  r.lock(); r.move(1); for (let i = 0; i < 10; i++) r.move(3);
  const before = r.pitch;
  r.block(true); r.unlock(); // panel opens and releases the lock
  r.move(300); r.move(-200);  // cursor wanders over the panel: ignored
  r.lock(); r.frame(); r.frame(); // the browser relocks while the panel is still closing (input still blocked)
  r.block(false); r.frame();      // the unblock frame wipes transient input
  r.move(350);                     // the warp back to centre arrives late: must still be dropped
  for (let i = 0; i < 5; i++) r.move(3);
  assert.ok(Math.abs(r.pitch - before) < .2, `pitch moved ${r.pitch - before}`);
  assert.ok(r.maxStep < SANE, `step ${r.maxStep}`);
});

test('camera-snap: mid-size spikes during slow aim are rejected, in either direction', () => {
  for (const spike of [-350, 350, -250, 250, -1500, 1500, -6000]) {
    const r = rig();
    r.lock(); r.move(1);
    for (let i = 0; i < 20; i++) r.move(2);
    const before = r.pitch; r.resetStep();
    r.move(spike); for (let i = 0; i < 5; i++) r.move(2);
    assert.ok(r.maxStep < SANE, `spike ${spike} step ${r.maxStep}`);
    assert.ok(Math.abs(r.pitch - before) < .15, `spike ${spike} moved ${r.pitch - before}`);
  }
});

test('camera-snap: a spike glued to a real flick adds at most about the flick itself', () => {
  const f = R.createLookFilter();
  const seq = [3, 3, 40, 1500, 400, 300, 100, 3];
  const out = seq.reduce((s, d) => s + f.filter(0, d)[1], 0);
  assert.equal(out, 3 + 3 + 40 + 400 + 300 + 100 + 3); // the 1500 spike is dropped, the flick is kept
});

test('camera-snap: real fast flicks still turn by the full amount, with no lag', () => {
  const r = rig(1);
  r.lock(); r.move(1);
  // a 60-degree look-down flick over 100 ms at 60 fps: ~476 counts at sensitivity 1
  const w = [...Array(6)].map((_, i) => Math.sin(Math.PI * (i + .5) / 6)), t = w.reduce((a, b) => a + b);
  const counts = w.map(x => Math.round(476 * x / t));
  for (const c of counts) r.move(c);
  const want = -counts.reduce((a, b) => a + b) * .0022;
  assert.ok(Math.abs(r.pitch - want) < 1e-9, `${r.pitch} vs ${want}`);
  const g = rig(1); g.lock(); g.move(1); g.move(30); // a small move applies on the very same frame
  assert.ok(Math.abs(g.pitch + 30 * .0022) < 1e-9);
});

test('camera-snap: pitch stays inside the clamp, which is short of straight up/down (no Euler flip)', () => {
  assert.ok(PITCH_LIMIT > 1 && PITCH_LIMIT < 89 * Math.PI / 180);
  const r = rig();
  r.lock(); r.move(1);
  for (let i = 0; i < 200; i++) { r.move(i % 2 ? 60 : 50); assert.ok(Math.abs(r.pitch) <= PITCH_LIMIT); }
  for (let i = 0; i < 200; i++) { r.move(-55); assert.ok(Math.abs(r.pitch) <= PITCH_LIMIT); }
  assert.match(gameSrc, /pitch = Number\.isFinite\(X\?\.pitch\) \? clamp\(X\.pitch, -PITCH_LIMIT, PITCH_LIMIT\)/);
  assert.match(gameSrc, /camera\.rotation\.set\(pitch, yaw, [^\n]*'YXZ'\)/);
});

test('camera-snap: only respawn, reload and test helpers assign pitch outside look()', () => {
  const sets = gameSrc.split('\n').filter(l => /[^.\w]pitch = (?!Number\.isFinite\(X)/.test(l));
  for (const l of sets) assert.match(l, /look\(dx|pitch = -\.28|PITCH_LIMIT, PITCH_LIMIT\); (return|yaw)|function look|yaw -= dx/, l.trim().slice(0, 120));
});
