// Regression tests for input findings INPUT-1..INPUT-4 (round 2).
// Run: node --test tests/input-r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const R = await import(new URL('input-rules.js', base));
const gameSrc = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');
const { createInput } = await import(new URL('input.js', base));
const { ActionMap } = await import(new URL('input-map.js', base));

// Live-path harness: createInput on fake EventTargets, the same code players run (controls.js wraps it).
function fire(t, type, props = {}) { const e = new Event(type, {cancelable:true}); for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, {value:v, configurable:true}); t.dispatchEvent(e); return e; }
function live(opts = {}) {
  const doc = new EventTarget(); doc.pointerLockElement = null; doc.visibilityState = 'visible';
  const win = new EventTarget(); win.document = doc; const canvas = new EventTarget();
  let blocked = false; const actions = [];
  const input = createInput({target:win, element:canvas, map:new ActionMap({}), doc, isBlocked:() => blocked,
    onAction:(id, p) => actions.push(id + ':' + p), getGamepads:() => [], ...opts});
  return {doc, win, canvas, input, actions, block:v => { blocked = v; }, tick:(dt = 1 / 60) => input.update(dt),
    down:(c, x = {}) => fire(win, 'keydown', {code:c, key:c, target:win, ...x}), up:c => fire(win, 'keyup', {code:c, key:c, target:win}),
    lock() { doc.pointerLockElement = canvas; fire(doc, 'pointerlockchange'); },
    move:(x, y = 0) => fire(doc, 'mousemove', {movementX:x, movementY:y}),
    wheel:(props) => fire(canvas, 'wheel', {deltaMode:0, deltaX:0, deltaY:0, ...props})};
}

// ---------------------------------------------------------------- INPUT-1 held keys across panels

test('INPUT-1: keys pressed while a panel is open are recorded but trigger no action', () => {
  assert.deepEqual(R.keyDecision({inField:false, blocked:true}), {record:true, act:false});
  assert.deepEqual(R.keyDecision({inField:false, blocked:false}), {record:true, act:true});
  assert.deepEqual(R.keyDecision({inField:true, blocked:false}), {record:false, act:false});
  assert.deepEqual(R.keyDecision({inField:true, blocked:true}), {record:false, act:false});
});

test('INPUT-1/DESIGN: one input path: game.js has no legacy keys[] or look filter; panels pause, blur clears', () => {
  const fn = name => { const line = gameSrc.split('\n').find(l => l.includes(`function ${name}() {`)); assert.ok(line, name); return line; };
  assert.doesNotMatch(gameSrc, /\bkeys\[e\.code\]|\blet keys\b|const held = \(a, b\)|lookFilter|createLookFilter/);
  assert.match(fn('clearInput'), /controls\?\.clear\(\)/);
  assert.doesNotMatch(fn('pauseInput'), /controls\?\.clear|clearInput/);
  assert.match(fn('openInventory'), /pauseInput\(\)/);
  assert.doesNotMatch(fn('openInventory'), /clearInput/);
  assert.doesNotMatch(gameSrc, /onPause:\s*(guard\()?clearInput/);
  assert.match(gameSrc, /on\(window, 'blur', \(\) => \{ clearInput\(\)/);
  assert.match(gameSrc, /controls lane failed to start', e\); controls = null; notice\(CONTROLS_FAILED/);
  const inputSrc = readFileSync(fileURLToPath(new URL('input.js', base)), 'utf8');
  assert.match(inputSrc, /import \{ keyDecision, createLookFilter \} from '\.\/input-rules\.js'/);
});

test('INPUT3-1: W held through a panel walks on when it closes (createInput, autorepeat firing)', () => {
  const s = live();
  s.down('KeyW'); s.down('ShiftLeft'); s.tick();
  assert.equal(s.input.move().forward, 1);
  s.block(true); s.tick(); s.down('KeyW', {repeat:true}); s.tick();
  assert.equal(s.input.move().forward, 0, 'no movement while the panel is open');
  assert.equal(s.input.down('moveForward'), false);
  s.block(false); s.down('KeyW', {repeat:true}); s.tick();
  assert.equal(s.input.move().forward, 1);
  assert.equal(s.input.sprinting(), true);
  assert.equal(s.input.pressed('moveForward'), false, 'no new edge on close');
  s.up('KeyW'); s.tick();
  assert.equal(s.input.move().forward, 0);
});

test('INPUT3-1: a key pressed while blocked is recorded but fires nothing, even after the panel closes', () => {
  const s = live();
  s.block(true); s.down('KeyI'); s.down('KeyD'); s.tick();
  s.block(false); s.tick();
  assert.ok(!s.actions.includes('inventory:down'), 'the I that closed the bag must not reopen it');
  assert.equal(s.input.pressed('inventory'), false);
  assert.equal(s.input.move().strafe, 1, 'a movement key pressed behind the panel still moves');
  s.up('KeyI'); s.tick(); s.down('KeyI'); s.tick();
  assert.ok(s.actions.includes('inventory:down'), 'a fresh press after release acts again');
});

test('INPUT3-1: blur still forgets held keys', () => {
  const s = live();
  s.down('KeyW'); s.tick(); fire(s.win, 'blur'); s.tick();
  assert.equal(s.input.move().forward, 0);
});

// ---------------------------------------------------------------- INPUT-2 look spike filter

const sum = (f, seq) => seq.reduce((s, d) => s + f.filter(d, 0)[0], 0);
// A 180-degree turn (~1428 counts at sensitivity 1) over 100 ms, coalesced into one event per frame.
const flick = fps => { const n = Math.max(2, Math.round(fps * .1)); const w = [...Array(n)].map((_, i) => Math.sin(Math.PI * (i + .5) / n)); const t = w.reduce((a, b) => a + b); return w.map(x => Math.round(1428 * x / t)); };

test('INPUT-2: a fast flick turns by the full amount at 60, 30 and 20 fps', () => {
  for (const fps of [60, 30, 20, 10]) {
    const seq = [3, 3, ...flick(fps), 2, 1];
    const raw = seq.reduce((a, b) => a + b);
    assert.equal(sum(R.createLookFilter(), seq), raw, `${fps} fps`);
  }
});

test('INPUT-2: one 800-count frame mid-flick turns as far as four 200-count frames', () => {
  assert.equal(sum(R.createLookFilter(), [60, 800, 300, 20]), sum(R.createLookFilter(), [60, 200, 200, 200, 200, 300, 20]));
  assert.equal(sum(R.createLookFilter(), [60, 800, 300, 20]), 1180);
});

test('INPUT-2: isolated pointer-lock spikes are dropped', () => {
  assert.equal(sum(R.createLookFilter(), [2, 2, -1500, 2, 2]), 8);
  assert.equal(sum(R.createLookFilter(), [40, 40, -1800, 40, 40]), 160);
  assert.equal(sum(R.createLookFilter(), [2, 2, 1500, 2, 2]), 8); // same direction but nothing follows it
  const [x, y] = R.createLookFilter().filter(NaN, 5);
  assert.deepEqual([x, y], [0, 5]);
});

test('INPUT-2: the first move after the lock is gained is discarded', () => {
  const f = R.createLookFilter();
  f.reset({dropFirst:true});
  assert.deepEqual(f.filter(300, -40), [0, 0]);
  assert.deepEqual(f.filter(5, 1), [5, 1]);
  f.reset();
  assert.deepEqual(f.filter(5, 1), [5, 1]);
});

test('INPUT3-2: a 20 fps flick with two 714-count frames turns fully through createInput', () => {
  const s = live(); s.lock(); s.move(1, 1); s.tick(); // first move after lock is dropped
  let dx = 0;
  for (const d of [3, 3, 714, 714, 2, 1]) { s.move(d); s.tick(.05); dx += s.input.lookDelta().dx; }
  assert.ok(Math.abs(dx - 1437 * .0022) < 1e-9, `turned ${dx}`);
});

test('INPUT3-2: an isolated spike and the first move after lock are still dropped in createInput', () => {
  const s = live(); s.lock(); s.move(300, 0); s.tick();
  assert.equal(s.input.lookDelta().dx, 0, 'first move after lock');
  let dx = 0;
  for (const d of [2, 2, -1500, 2, 2]) { s.move(d); s.tick(); dx += s.input.lookDelta().dx; }
  assert.ok(Math.abs(dx - 8 * .0022) < 1e-9, `turned ${dx}`);
  assert.doesNotMatch(readFileSync(fileURLToPath(new URL('input.js', base)), 'utf8'), /SPIKE/);
});

test('INPUT-2: game.js no longer clamps movementX and does not ask for unadjustedMovement', () => {
  assert.doesNotMatch(gameSrc, /clamp\(e\.movement[XY]/);
  assert.doesNotMatch(gameSrc, /unadjustedMovement/);
});

// ---------------------------------------------------------------- INPUT-3 frame-rate independent movement

const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));
const raft = () => { const t = []; for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) t.push([x, z]); return t; };
// Mirrors movePlayer: each frame's real dt is split into equal substeps, the same input on each.
function simulate(fps, seconds, input) {
  const p = new PlayerPhysics({x:0, y:.2 + PC.EYE_OFFSET, z:0}), tiles = raft();
  let apex = -Infinity, jumps = 0;
  for (let f = 0; f < Math.round(fps * seconds); f++) {
    const {n, step} = R.splitSteps(1 / fps);
    for (let i = 0; i < n; i++) {
      const wasGrounded = p.grounded || f + i === 0;
      p.update(step, {yaw:0, tiles, deckY:.2, waterY:-.24, ...input(f)});
      if (wasGrounded && !p.grounded && p.vy > 0) jumps++;
      apex = Math.max(apex, p.y - PC.EYE_OFFSET - .2);
    }
  }
  return {p, apex, jumps};
}

test('INPUT-3: splitSteps makes equal steps no longer than 0.05 s and caps long stalls', () => {
  assert.deepEqual(R.splitSteps(1 / 60), {n:1, step:1 / 60});
  assert.deepEqual(R.splitSteps(.05), {n:1, step:.05});
  const s = R.splitSteps(.1); assert.equal(s.n, 2); assert.ok(Math.abs(s.step - .05) < 1e-12);
  const t = R.splitSteps(1 / 3); assert.equal(t.n, 5); assert.ok(Math.abs(t.step * t.n - .25) < 1e-12);
  assert.deepEqual(R.splitSteps(0), {n:0, step:0});
  assert.deepEqual(R.splitSteps(NaN), {n:0, step:0});
  assert.deepEqual(R.splitSteps(-1), {n:0, step:0});
});

test('INPUT-3: walking covers the same real distance at 10, 20, 60 and 144 fps', () => {
  const d = [10, 20, 60, 144].map(fps => -simulate(fps, 1, () => ({forward:1})).p.z);
  for (const x of d) assert.ok(Math.abs(x - d[2]) < .1, `walked ${d.map(v => v.toFixed(3))}`);
  assert.ok(d[0] > 2.2, `10 fps walked ${d[0]}`);
});

test('INPUT-3: jump apex is the same at 30, 60, 144 and 240 fps', () => {
  const ideal = PC.JUMP_IMPULSE ** 2 / (2 * PC.GRAVITY);
  for (const fps of [10, 30, 60, 144, 240]) {
    const {apex, jumps} = simulate(fps, .5, f => ({jump:f === 0}));
    assert.equal(jumps, 1);
    assert.ok(Math.abs(apex - ideal) < .005, `${fps} fps apex ${apex} vs ${ideal}`);
  }
});

test('INPUT-3: holding jump through a slow multi-substep frame jumps once, on the first substep', () => {
  const {jumps} = simulate(4, 2, () => ({jump:true})); // lands and keeps holding: no auto re-jump
  assert.equal(jumps, 1);
  assert.match(gameSrc, /splitSteps\(dt\)/);
  assert.match(gameSrc, /movePlayer\(realDt,/);
});

// ---------------------------------------------------------------- INPUT3-3 sub-frame Space tap (createControls)

const { El } = (() => { class El extends EventTarget {
  constructor() { super(); this.children = []; this.attrs = {}; this.style = {}; this.dataset = {}; const cls = new Set(); this.classList = {add:c => cls.add(c), remove:c => cls.delete(c), toggle:(c, on) => (on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c), contains:c => cls.has(c)}; }
  setAttribute(k, v) { this.attrs[k] = v; } append(...k) { this.children.push(...k); } appendChild(k) { this.children.push(k); return k; }
  replaceChildren() { this.children = []; } remove() {} querySelector() { return new El(); } querySelectorAll() { return Array.from({length:16}, () => new El()); }
  getContext() { const f = new Proxy(() => f, {get:(_, k) => k === 'data' ? new Uint8ClampedArray(16) : f, set:() => true, apply:() => f}); return f; }
  closest() { return null; } getBoundingClientRect() { return {left:0, top:0, width:100, height:100}; } } return {El}; })();
if (!globalThis.document) { const d = new EventTarget(); Object.assign(d, {pointerLockElement:null, visibilityState:'visible', head:new El(), body:new El(), getElementById:() => null, createElement:() => new El(), createElementNS:() => new El()}); globalThis.document = d; }
const { createControls } = await import(new URL('controls.js', base));
function liveControls(g = {}) {
  const win = new EventTarget(); win.document = globalThis.document; globalThis.window = win; // createInput listens on window
  const c = createControls({canvas:null, isBlocked:() => false, look() {}, hotbarSize:8, slot:() => 0, selectSlot() {}, ...g});
  const key = (type, code) => fire(win, type, {code, key:code, target:win});
  delete globalThis.window;
  return {c, win, down:code => key('keydown', code), up:code => key('keyup', code)};
}

test('INPUT3-3: a Space tap inside one 15 fps frame jumps once (createControls -> PlayerPhysics)', () => {
  const {c, down, up} = liveControls();
  const p = new PlayerPhysics({x:0, y:.2 + PC.EYE_OFFSET, z:0}), tiles = raft();
  for (let i = 0; i < 3; i++) p.update(1 / 60, {yaw:0, tiles, deckY:.2, waterY:-.24});
  down('Space'); up('Space');
  const ci = c.movement(1 / 15, true, p);
  assert.equal(ci.jump, true);
  const {n, step} = R.splitSteps(1 / 15);
  let jumps = 0;
  for (let i = 0; i < n; i++) { const g = p.grounded; p.update(step, {yaw:0, tiles, deckY:.2, waterY:-.24, jump:ci.jump}); if (g && !p.grounded && p.vy > 0) jumps++; }
  assert.equal(jumps, 1);
  assert.equal(c.movement(1 / 15, true, p).jump, false, 'the tap is consumed');
  c.dispose();
});

// ---------------------------------------------------------------- INPUT3-5 Shift/Ctrl+wheel fine rotate while locked

test('INPUT3-5: a wheel event the game owns never steps the hotbar (createInput ownsWheel)', () => {
  const s = live({ownsWheel:e => e.shiftKey || e.ctrlKey}); s.lock();
  s.wheel({deltaX:100, shiftKey:true}); s.tick();
  assert.equal(s.input.hotbarStep(), 0, 'Shift+wheel (deltaX in Chromium)');
  s.wheel({deltaY:100, ctrlKey:true}); s.tick();
  assert.equal(s.input.hotbarStep(), 0, 'Ctrl+wheel keeps deltaY but is still the game\'s');
  s.wheel({deltaY:100}); s.tick();
  assert.equal(s.input.hotbarStep(), 1, 'a plain notch still steps the hotbar');
});

test('INPUT3-5: createControls forwards ownsWheel; game.js rotates before the locked-controls return', () => {
  const steps = [];
  const {c, win} = liveControls({ownsWheel:e => e.shiftKey, selectSlot:i => steps.push(i)});
  const p = {grounded:true, swimming:false, vx:0, vy:0, vz:0};
  fire(win, 'wheel', {deltaMode:0, deltaX:100, deltaY:0, shiftKey:true}); c.movement(1 / 60, true, p);
  fire(win, 'wheel', {deltaMode:0, deltaX:0, deltaY:100, shiftKey:true}); c.movement(1 / 60, true, p);
  assert.deepEqual(steps, [], 'owned by the game: no hotbar step');
  fire(win, 'wheel', {deltaMode:0, deltaX:0, deltaY:100}); c.movement(1 / 60, true, p);
  assert.deepEqual(steps, [1]);
  c.dispose();
  const w = gameSrc.slice(gameSrc.indexOf("on(window, 'wheel'"));
  assert.ok(w.indexOf('const fine = wheelRotates(e)') < w.indexOf('if (controls && isLocked() && !fine) return;'));
  assert.match(gameSrc, /ownsWheel:e => running && wheelRotates\(e\)/);
});

// ---------------------------------------------------------------- INPUT3-4 dive speed vs fps

test('INPUT3-4: swimming underwater covers the same distance at 60, 20, 10 and 4 fps', async () => {
  const { DiveBody } = await import(new URL('diving.js', base));
  const run = fps => { const b = new DiveBody({x:0, y:-3, z:0, vx:0, vy:0, vz:0, oxygen:1}); b.grace = 0;
    for (let i = 0; i < fps * 2; i++) b.step(1 / fps, {forward:1, yaw:0, pitch:0}, {waterY:0, floorY:-20, tiles:[[0, 0]], deckY:.2});
    return {d:Math.hypot(b.x, b.z), o:b.oxygen}; };
  const ref = run(60);
  for (const fps of [20, 10, 4]) { const r = run(fps); assert.ok(Math.abs(r.d - ref.d) < .15, `${fps} fps swam ${r.d} vs ${ref.d}`); assert.ok(Math.abs(r.o - ref.o) < .005); }
  const b = new DiveBody({x:0, y:-.1, z:5, vx:0, vy:3, vz:0, oxygen:1}); b.grace = 0;
  const ev = b.step(.25, {up:true}, {waterY:0, floorY:-20, tiles:[], deckY:.2});
  assert.equal(ev.surfaced, true, 'a long frame stops substepping once it surfaces');
});

// ---------------------------------------------------------------- INPUT3-6 X release removes only what was shown

test('INPUT3-6: X release removes only the one shown target, never with the Q wheel open', () => {
  // The shared removal targeter (remove-target.js) picks the one target that the prompt and red ghost show;
  // the keyup removes exactly that, and not while the build wheel is open.
  assert.match(gameSrc, /e\.code === 'KeyX' && building\?\.endRemove\(\) && running && !building\.menu\.isOpen\) removePiece\(removalFor\(currentAim\(\)\)\)/);
  assert.match(gameSrc, /removeTarget = frameAim && hammerOn \? removalFor\(frameAim\) : null/);
});

// ---------------------------------------------------------------- INPUT-4 wheel over the hotbar

const el = (...inside) => ({closest: sel => inside.some(s => sel.split(',').map(x => x.trim()).includes(s)) ? {} : null});

test('INPUT-4: the wheel picks slots over the canvas and the hotbar, never inside panels or scrollers', () => {
  assert.equal(R.wheelForGame(el()), true);              // canvas
  assert.equal(R.wheelForGame(el('.tools')), true);      // hotbar button
  assert.equal(R.wheelForGame(null), true);
  assert.equal(R.wheelForGame(el('dialog')), false);
  assert.equal(R.wheelForGame(el('#recipes')), false);
  assert.equal(R.wheelForGame(el('input')), false);
  assert.match(gameSrc, /on\(window, 'wheel', e => \{/);
  assert.doesNotMatch(gameSrc, /on\(canvas, 'wheel'/);
  assert.match(gameSrc, /!wheelForGame\(e\.target\)/);
});
