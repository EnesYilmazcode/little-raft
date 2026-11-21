// Unit tests for the bed + sleep content module (dist/sleep.js) and its day/night hooks.
// Run: node --test tests/sleep.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const DN = await import(new URL('daynight.js', base));
const SL = await import(new URL('sleep.js', base));
const { RECIPES, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const { STARTER, learnedFrom } = await import(new URL('storage-research.js', base));
const { CONTENT_DECOR, CONTENT_BLOCK_RADIUS } = await import(new URL('content-items.js', base));
const { buildBed } = await import(new URL('sleep-model.js', base));
const { canSleep, cleanSleep, allInBed, bedPose, getUpSpot, createSleep, TEXT, HOLD, FADE, BLACK } = SL;
const { DAY_SECONDS: DAY, MORNING, phaseAt, skipClock, createDayNight } = DN;

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} expected ${b} got ${a}`);
const DEFAULTS = { v: 1, in: { host: null, guest: null }, fade: 0, skips: 0 };
const night = { phase: .8, optOut: false, ready: true };
const noon = { phase: .3, optOut: false, ready: true };

// ---------------------------------------------------------------- stubs
const grid3 = () => Array.from({ length: 9 }, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]);
function makeSleep({ role = 'solo', decor = [{ type: 'bed', x: 1, z: 0 }], tiles = grid3(), dayRef = { ...night } } = {}) {
  const calls = [], emits = [], notices = [];
  const world = { tiles, decor };
  const ctx = {
    T, world, role, physics: { x: 2, y: 1.8, z: 1, vx: 0, vy: 0, vz: 0, grounded: true }, other: null, camera: null, raft: null,
    deckY: () => .2, uiOpen: () => false, emit: (e, to) => emits.push({ e, to }), notice: s => notices.push(s),
    localBag: () => null,
  };
  const mod = createSleep(ctx, { day: () => dayRef });
  ctx.action = a => { calls.push(a); if (role !== 'guest' && a.kind.startsWith('sleep.')) mod.action(a, 'host'); };
  return { ctx, mod, calls, emits, notices, world, dayRef };
}
const run = (mod, seconds, step = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += step) mod.update(step); };
const skips = calls => calls.filter(a => a.kind === 'daynight.skipTo');

function stubDayNightCtx(role = 'solo') {
  const scene = new T.Scene();
  scene.background = new T.Color('#cbd2c0'); scene.fog = new T.Fog('#cbd2c0', 25, 125);
  const camera = new T.PerspectiveCamera(70, 1, 0.05, 200); scene.add(camera);
  const hemi = new T.HemisphereLight('#f2ead4', '#3d6b6a', 1.8); scene.add(hemi);
  const sun = new T.DirectionalLight('#fff0c7', 2.5); scene.add(sun);
  const raft = new T.Group(); scene.add(raft);
  return { T, scene, camera, hemi, sun, raft, clouds: [], ocean: null, world: { decor: [] }, role, renderer: { toneMappingExposure: 1 }, localBag: () => null, action: () => {} };
}

// ---------------------------------------------------------------- 1. canSleep
test('canSleep: dusk and night ok, day refused, opt-out / missing day-night too bright', () => {
  for (const p of [.70, .99, .66, .01, 0]) assert.equal(canSleep({ phase: p, optOut: false, ready: true }), null, String(p));
  for (const p of [.02, .3, .65, .1]) assert.equal(canSleep({ phase: p, optOut: false, ready: true }), TEXT.notSleepy, String(p));
  assert.equal(canSleep({ phase: .8, optOut: true, ready: true }), TEXT.tooBright);
  assert.equal(canSleep({ phase: .8, optOut: false, ready: false }), TEXT.tooBright);
  for (const bad of [null, undefined, {}, { phase: NaN, ready: true }]) assert.equal(canSleep(bad), TEXT.tooBright);
});

// ---------------------------------------------------------------- 2. skipClock
test('skipClock: night of day 3 -> morning of day 4; small hours stay on the same day', () => {
  const a = 3 * DAY + .8 * DAY, b = 4 * DAY + .01 * DAY;
  near(skipClock(a, MORNING), 4 * DAY + .1 * DAY, 1e-9);
  near(skipClock(b, MORNING), 4 * DAY + .1 * DAY, 1e-9);
  for (let i = 0; i < 200; i++) {
    const c = i * 137.3 + .5, s = skipClock(c, MORNING);
    assert.ok(s > c, `${s} > ${c}`); near(phaseAt(s), .1, 1e-9);
  }
});

// ---------------------------------------------------------------- 3. daynight action + live mirror
test('daynight action: host skipTo at night moves the clock, day / guest actor are no-ops, always claimed', () => {
  const m = createDayNight(stubDayNightCtx());
  m.debug.setPhase(.8); m.update(0);
  assert.equal(DN.DAYNIGHT_LIVE.ready, true); near(DN.DAYNIGHT_LIVE.phase, .8, 1e-6);
  const before = m.serialize().clock;
  assert.equal(m.action({ kind: 'daynight.skipTo', phase: MORNING }, 'guest'), true);
  assert.equal(m.serialize().clock, before);
  assert.equal(m.action({ kind: 'daynight.skipTo', phase: MORNING }, 'host'), true);
  const after = m.serialize().clock;
  assert.ok(after > before); near(phaseAt(after), .1, 1e-6); near(after - before, .3 * DAY, 1e-6);
  // now it is day: a second skip (double message) does nothing
  assert.equal(m.action({ kind: 'daynight.skipTo', phase: MORNING }, 'host'), true);
  assert.equal(m.serialize().clock, after);
  // bad phases ignored, other kinds not claimed
  m.debug.setPhase(.9);
  const c = m.serialize().clock;
  for (const p of [-1, 1, NaN, 'x', undefined]) m.action({ kind: 'daynight.skipTo', phase: p }, 'host');
  assert.equal(m.serialize().clock, c);
  assert.equal(m.action({ kind: 'sleep.lie' }, 'host'), false);
  assert.equal(m.action(null, 'host'), false);
  m.dispose(); assert.equal(DN.DAYNIGHT_LIVE.ready, false);
  // a guest's own module never applies a skip
  const g = createDayNight(stubDayNightCtx('guest'));
  g.load({ v: 1, clock: 3 * DAY + .8 * DAY, seed: 1 }, 'save');
  const gc = g.serialize().clock;
  assert.equal(g.action({ kind: 'daynight.skipTo', phase: MORNING }, 'host'), true);
  assert.equal(g.serialize().clock, gc);
  g.dispose();
});

// ---------------------------------------------------------------- 4. cleanSleep / load
test('cleanSleep + load: junk becomes defaults; a save/restore never leaves anyone in bed', () => {
  for (const junk of [undefined, null, 'x', 5, [], { in: 'no' }, { in: { host: [1.5, 0], guest: ['a', 1] } }, { in: { host: [1] } }, { skips: -1 }, { skips: 1.5 }, { skips: 2e9 }, { fade: 'yes' }]) {
    assert.deepEqual(cleanSleep(junk), DEFAULTS, JSON.stringify(junk));
  }
  assert.deepEqual(cleanSleep({ in: { host: [1, 0], guest: [-2, 3] }, fade: 1, skips: 7 }), { v: 1, in: { host: [1, 0], guest: [-2, 3] }, fade: 1, skips: 7 });
  const { mod } = makeSleep();
  mod.load(undefined, 'save'); assert.deepEqual(mod.serialize(), DEFAULTS);
  for (const from of ['save', 'restore']) {
    mod.load({ v: 1, in: { host: [1, 0], guest: [1, 0] }, fade: 1, skips: 4 }, from);
    assert.deepEqual(mod.serialize(), { ...DEFAULTS, skips: 4 });
    mod.update(1 / 60); assert.equal(mod.debug.state().lying, false);
  }
  for (const g of [null, 42, 'x', [], { in: [] }]) for (const from of ['save', 'net', 'restore']) assert.doesNotThrow(() => mod.load(g, from));
});

// ---------------------------------------------------------------- 5. sleep.lie
test('sleep.lie: refused off-bed, out of reach, daytime, bed taken; accepted otherwise', () => {
  const s = makeSleep({ decor: [{ type: 'bed', x: 1, z: 0 }, { type: 'crate', x: 0, z: 1 }, { type: 'bed', x: -1, z: 0 }] });
  const { mod, ctx, emits, dayRef } = s;
  const last = () => emits[emits.length - 1].e.text;
  mod.action({ kind: 'sleep.lie', x: 0, z: 1 }, 'host'); assert.equal(mod.serialize().in.host, null); assert.equal(last(), TEXT.noBed);
  mod.action({ kind: 'sleep.lie', x: 5, z: 5 }, 'host'); assert.equal(mod.serialize().in.host, null);
  ctx.physics.x = 20; mod.action({ kind: 'sleep.lie', x: 1, z: 0 }, 'host'); assert.equal(mod.serialize().in.host, null); assert.equal(last(), TEXT.reach);
  ctx.physics.x = 2;
  Object.assign(dayRef, noon); mod.action({ kind: 'sleep.lie', x: 1, z: 0 }, 'host'); assert.equal(mod.serialize().in.host, null); assert.equal(last(), TEXT.notSleepy);
  Object.assign(dayRef, night);
  // guest with no pose is refused; guest in reach takes the bed
  mod.action({ kind: 'sleep.lie', x: 1, z: 0 }, 'guest'); assert.equal(mod.serialize().in.guest, null);
  ctx.other = { x: 2.5, z: 0 };
  mod.action({ kind: 'sleep.lie', x: 1, z: 0 }, 'guest'); assert.deepEqual(mod.serialize().in.guest, [1, 0]);
  mod.action({ kind: 'sleep.lie', x: 1, z: 0 }, 'host'); assert.equal(mod.serialize().in.host, null); assert.equal(last(), TEXT.taken);
  ctx.physics.x = -1; mod.action({ kind: 'sleep.lie', x: -1, z: 0 }, 'host'); assert.deepEqual(mod.serialize().in.host, [-1, 0]);
  // claims only sleep.* kinds; junk never throws
  assert.equal(mod.action({ kind: 'build' }, 'host'), false);
  assert.equal(mod.action({ kind: 'sleep.lie', x: 'a' }, 'host'), true);
  assert.equal(mod.action({ kind: 'sleep.up' }, 'guest'), true); assert.equal(mod.serialize().in.guest, null);
});

// ---------------------------------------------------------------- 6. allInBed
test('allInBed: host alone without guest, both with guest', () => {
  assert.equal(allInBed({ host: [1, 0], guest: null }, false), true);
  assert.equal(allInBed({ host: [1, 0], guest: null }, true), false);
  assert.equal(allInBed({ host: [1, 0], guest: [2, 0] }, true), true);
  assert.equal(allInBed({ host: null, guest: [2, 0] }, true), false);
  assert.equal(allInBed({ host: null, guest: null }, false), false);
});

// ---------------------------------------------------------------- 7. the sequence
test('sequence: a solo host sleeps, the clock skips once, everyone wakes beside the bed', () => {
  const { mod, ctx, calls, notices } = makeSleep();
  assert.equal(mod.interact(null), false); // no camera, no aim: nothing targeted
  mod.debug.lie(1, 0); mod.update(1 / 60);
  assert.equal(mod.debug.state().lying, true);
  assert.equal(mod.prompt(null), TEXT.sleeping);
  mod.afterMove(ctx.physics);
  assert.deepEqual([ctx.physics.x, ctx.physics.y, ctx.physics.z], [2, .2 + .8, -.55]);
  run(mod, HOLD + FADE + .05);
  assert.deepEqual(skips(calls), [{ kind: 'daynight.skipTo', phase: .1 }]);
  assert.equal(mod.serialize().skips, 1); assert.equal(mod.serialize().fade, 1);
  assert.ok(mod.debug.state().opacity > .99);
  run(mod, BLACK + .05);
  assert.equal(skips(calls).length, 1);
  assert.deepEqual(mod.serialize().in, { host: null, guest: null }); assert.equal(mod.serialize().fade, 0);
  assert.equal(mod.debug.state().lying, false);
  assert.ok(notices.includes(TEXT.morning));
  assert.deepEqual([ctx.physics.x, ctx.physics.z], [0, 0]); // free neighbour (0,0) beside the bed at (1,0)... (2,0) is off the 3x3 grid
  run(mod, FADE + .1); assert.equal(mod.debug.state().opacity, 0);
});

test('sequence: getting up during the hold cancels; a connected guest out of bed blocks the skip', () => {
  const a = makeSleep();
  a.mod.debug.lie(1, 0); run(a.mod, HOLD * .6);
  a.mod.interact(null); // E while lying gets up
  run(a.mod, 10);
  assert.equal(skips(a.calls).length, 0); assert.equal(a.mod.debug.state().lying, false);

  const b = makeSleep(); b.ctx.other = { x: 0, z: 0 };
  b.mod.debug.lie(1, 0); run(b.mod, 10);
  assert.equal(skips(b.calls).length, 0);
  assert.equal(b.mod.prompt(null), TEXT.waiting);
  // the guest lies down too: both sleep
  b.mod.action({ kind: 'sleep.lie', x: -1, z: 0 }, 'guest'); // no bed there
  b.world.decor.push({ type: 'bed', x: -1, z: 0 });
  b.mod.action({ kind: 'sleep.lie', x: -1, z: 0 }, 'guest');
  assert.equal(b.mod.prompt(null), TEXT.sleeping);
  run(b.mod, HOLD + FADE + BLACK + .1);
  assert.equal(skips(b.calls).length, 1);
  assert.deepEqual(b.mod.serialize().in, { host: null, guest: null });
});

test('sequence: the guest leaving while in bed clears the slot and lets the host sleep', () => {
  const { mod, ctx, calls } = makeSleep();
  ctx.other = { x: -2, z: 0 };
  mod.debug.lie(1, 0);
  ctx.world.decor.push({ type: 'bed', x: -1, z: 0 });
  mod.action({ kind: 'sleep.lie', x: -1, z: 0 }, 'guest');
  run(mod, HOLD + FADE * .5);
  assert.equal(mod.serialize().fade, 1);
  ctx.other = null; mod.update(1 / 60);
  assert.equal(mod.serialize().in.guest, null);
  assert.equal(mod.debug.state().seq, 'hold'); // cancelled and restarted for the host alone
  run(mod, HOLD + FADE + .1);
  assert.equal(skips(calls).length, 1);
});

test('sequence: the bed being removed gets you up; uiOpen while lying sends sleep.up once', () => {
  const s = makeSleep();
  s.mod.debug.lie(1, 0); s.mod.update(1 / 60);
  s.world.decor.length = 0; s.mod.update(1 / 60);
  assert.equal(s.mod.debug.state().lying, false);
  const g = makeSleep({ role: 'guest' });
  g.mod.load({ v: 1, in: { host: null, guest: [1, 0] }, fade: 0, skips: 0 }, 'net'); g.mod.update(1 / 60);
  assert.equal(g.mod.debug.state().lying, true);
  g.ctx.uiOpen = () => true; g.mod.update(1 / 60); g.mod.update(1 / 60);
  assert.equal(g.calls.filter(a => a.kind === 'sleep.up').length, 1);
});

// ---------------------------------------------------------------- 8. guest net loads
test('guest: same net data is a no-op; stuck fade clears after 5 s; skips bump says good morning', () => {
  const { mod, notices, calls } = makeSleep({ role: 'guest' });
  const d = { v: 1, in: { host: [1, 0], guest: null }, fade: 0, skips: 3 };
  mod.load(d, 'net');
  assert.ok(notices.length === 0, 'baseline load says nothing');
  const before = mod.serialize();
  mod.load({ v: 1, in: { host: [1, 0], guest: null }, fade: 0, skips: 3 }, 'net');
  assert.equal(mod.serialize(), before, 'unchanged data keeps the same object');
  mod.update(1 / 60);
  assert.ok(notices.includes(TEXT.otherAsleep));
  mod.load({ ...d, fade: 1 }, 'net');
  run(mod, 2); assert.ok(mod.debug.state().opacity > .99);
  run(mod, 4); assert.equal(mod.debug.state().opacity > 0, true); // fading back in
  run(mod, 2); assert.equal(mod.debug.state().opacity, 0);
  mod.load({ v: 1, in: { host: null, guest: null }, fade: 0, skips: 4 }, 'net');
  assert.ok(notices.includes(TEXT.morning));
  // guests never run the sequence or skip
  assert.equal(mod.action({ kind: 'sleep.lie', x: 1, z: 0 }, 'host'), true);
  assert.equal(skips(calls).length, 0);
});

test('guest aboard an old host: no slice means beds say so', () => {
  const { mod, ctx, notices } = makeSleep({ role: 'guest' });
  mod.load(undefined, 'net');
  assert.equal(mod.debug.state().hostHas, false);
  // aim straight at the bed from beside it
  ctx.camera = { position: new T.Vector3(2, 1.8, 1.5), getWorldDirection: v => v.set(0, -.6, -.4).normalize() };
  assert.equal(mod.prompt(null), TEXT.oldHost);
  assert.equal(mod.interact(null), true); assert.equal(notices.at(-1), TEXT.oldHost);
  mod.load({ v: 1, in: { host: null, guest: null }, fade: 0, skips: 0 }, 'net');
  assert.equal(mod.prompt(null), TEXT.sleep);
});

test('prompts follow the clock, the opt-out and the other sleeper', () => {
  const { mod, ctx, dayRef } = makeSleep();
  ctx.camera = { position: new T.Vector3(2, 1.8, 1.5), getWorldDirection: v => v.set(0, -.6, -.4).normalize() };
  assert.equal(mod.prompt(null), TEXT.sleep);
  Object.assign(dayRef, noon); assert.equal(mod.prompt(null), TEXT.notSleepy);
  Object.assign(dayRef, { ...night, optOut: true }); assert.equal(mod.prompt(null), TEXT.tooBright);
  Object.assign(dayRef, night);
  ctx.other = { x: 2, z: 0 }; mod.action({ kind: 'sleep.lie', x: 1, z: 0 }, 'guest');
  assert.equal(mod.prompt(null), TEXT.taken);
  ctx.camera.getWorldDirection = v => v.set(0, 0, 1); // looking away
  assert.equal(mod.prompt(null), null);
});

// ---------------------------------------------------------------- 9. getUpSpot / bedPose
test('getUpSpot picks a free neighbour tile and falls back when surrounded', () => {
  const tiles = grid3();
  assert.deepEqual(getUpSpot({ tiles, decor: [] }, 0, 0), { x: 2, z: 0 });
  assert.deepEqual(getUpSpot({ tiles, decor: [{ type: 'crate', x: 1, z: 0 }] }, 0, 0), { x: -2, z: 0 });
  assert.deepEqual(getUpSpot({ tiles, decor: [{ type: 'net', x: 1, z: 0 }] }, 0, 0), { x: 2, z: 0 });
  const full = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => ({ type: 'crate', x, z }));
  assert.deepEqual(getUpSpot({ tiles, decor: full }, 0, 0), { x: .8, z: 0 });
  assert.deepEqual(getUpSpot({ tiles: [[0, 0]], decor: [] }, 0, 0), { x: .8, z: 0 });
  assert.deepEqual(getUpSpot(null, 0, 0), { x: .8, z: 0 });
  assert.deepEqual(bedPose(1, 2, .2), { x: 2, y: 1, z: 3.45 });
});

// ---------------------------------------------------------------- 10. content items + model
test('content items: bed costs 6 wood + 4 leaf, is placeable decor, learned at the research table', () => {
  assert.deepEqual({ ...RECIPES.bed.cost }, { wood: 6, leaf: 4 });
  assert.equal(ITEM_INFO.bed.name, 'Bed');
  assert.ok(CONTENT_DECOR.includes('bed')); assert.equal(CONTENT_BLOCK_RADIUS.bed, .55);
  assert.ok(!STARTER.includes('bed'));
  assert.ok(learnedFrom(['wood', 'leaf']).includes('bed'));
});

test('bed model: one shared mesh per instance, survives a dispose by rebuildRaft', () => {
  const m = buildBed(T);
  const a = m.instance(), b = m.instance();
  assert.equal(a.children.length, 1); assert.equal(a.children[0].geometry, b.children[0].geometry);
  assert.equal(a.userData.craftType, 'bed'); assert.equal(a.userData.height, .95);
  a.children[0].geometry.dispose(); // no-op
  assert.ok(m.geometry.attributes.position.count > 0);
  const box = m.geometry.boundingBox;
  assert.ok(box.max.y < 1 && box.min.y >= -1e-6 && box.max.z <= 1 && box.min.z >= -1.02);
  m.dispose();
  const { mod } = makeSleep();
  assert.equal(mod.decorModel('crate'), null);
  assert.equal(mod.decorModel('bed').userData.craftType, 'bed');
  mod.dispose();
});

test('prompts.js provider: plain labels for the visible key prompt, removed on dispose', () => {
  let provider = null, removed = 0;
  globalThis.raftPrompts = { provide: o => { provider = o; return () => { removed++; }; } };
  try {
    const { mod, ctx } = makeSleep();
    ctx.camera = { position: new T.Vector3(2, 1.8, 1.5), getWorldDirection: v => v.set(0, -.6, -.4).normalize() };
    mod.update(1 / 60);
    assert.equal(provider.id, 'sleep');
    assert.deepEqual(provider.prompt(), { key: 'E', label: 'Sleep' });
    mod.debug.lie(1, 0); mod.update(1 / 60);
    assert.deepEqual(provider.prompt().map(p => p.label), ['Sleeping…', 'Get up']);
    mod.dispose(); assert.equal(removed, 1);
  } finally { delete globalThis.raftPrompts; }
});

// ---------------------------------------------------------------- review fixes
test('review: a new world (restore, or the first state from a host) drops the lying pin without a teleport', () => {
  const g = makeSleep({ role: 'guest' });
  g.mod.load({ v: 1, in: { host: null, guest: [1, 0] }, fade: 0, skips: 0 }, 'net'); g.mod.update(1 / 60);
  assert.equal(g.mod.debug.state().lying, true);
  g.mod.load(undefined, 'restore'); // host left: own raft restored with its saved physics
  g.ctx.physics.x = 7; g.ctx.physics.z = -3; g.ctx.role = 'solo';
  g.mod.update(1 / 60);
  assert.equal(g.mod.debug.state().lying, false);
  assert.deepEqual([g.ctx.physics.x, g.ctx.physics.z], [7, -3], 'no standUp at the old raft\'s bed');
  // a solo host lying joins another raft: the first net state must not stand them up at the old bed
  const s = makeSleep();
  s.mod.debug.lie(1, 0); s.mod.update(1 / 60); assert.equal(s.mod.debug.state().lying, true);
  s.ctx.role = 'guest'; s.mod.load({ v: 1, in: { host: null, guest: null }, fade: 0, skips: 0 }, 'net');
  s.ctx.physics.x = 5; s.ctx.physics.z = 5; s.mod.update(1 / 60);
  assert.equal(s.mod.debug.state().lying, false);
  assert.deepEqual([s.ctx.physics.x, s.ctx.physics.z], [5, 5]);
});

test('review: daynight still skips a lie-down made just before the sleep window closed', () => {
  const m = createDayNight(stubDayNightCtx());
  m.debug.setPhase(.021); m.update(0); // lay down at .019, hold + fade took ~2 s
  const before = m.serialize().clock;
  m.action({ kind: 'daynight.skipTo', phase: MORNING }, 'host');
  near(phaseAt(m.serialize().clock), .1, 1e-6); assert.ok(m.serialize().clock > before);
  m.debug.setPhase(.05); m.update(0);
  const c = m.serialize().clock; m.action({ kind: 'daynight.skipTo', phase: MORNING }, 'host');
  assert.equal(m.serialize().clock, c, 'daytime-ish phases stay refused');
  m.dispose();
});

test('review: the sleep provider yields to the pickup and waiting-for-host prompts', () => {
  let provider = null;
  globalThis.raftPrompts = { provide: o => { provider = o; return () => {}; } };
  try {
    const { mod } = makeSleep();
    mod.debug.lie(1, 0); mod.update(1 / 60);
    assert.ok(provider.prompt({ state: { role: 'solo' } }));
    assert.equal(provider.prompt({ state: { role: 'solo', pickup: { type: 'wood' } } }), null);
    assert.equal(provider.prompt({ state: { role: 'guest', networkReady: false } }), null);
    mod.dispose();
  } finally { delete globalThis.raftPrompts; }
});
