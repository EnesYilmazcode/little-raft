// Unit tests for the Little Motor + Steering Wheel content module (pure logic, no DOM).
// Run: node --test tests/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { Bag, RECIPES, ITEM_INFO, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { CONTENT_DECOR, CONTENT_BLOCK_RADIUS } = await import(new URL('content-items.js', base));
const E = await import(new URL('engine.js', base));
const { ENGINE, cleanEngine, motorKeys, wheelSpots, runningCount, engineSpeed, enginePush, burn, applyEngineAction, fmtFuel, createEngine } = E;
const { defaultSailing } = await import(new URL('sailing-core.js', base));

const near = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, msg || `${a} !~ ${b}`);
const bagFrom = (slots) => { const s = new Array(SLOT_COUNT).fill(null); slots.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected: 0 }); };
const M = (x, z) => ({ type: 'motor', x, z });
const tiles = n => Array.from({ length: n }, (_, i) => [i % 10, Math.floor(i / 10)]);
const slice = motors => ({ v: 1, motors });

test('items, recipes and decor are registered', () => {
  assert.equal(ITEM_INFO.motor.name, 'Little Motor');
  assert.equal(ITEM_INFO.wheel.name, 'Steering Wheel');
  assert.deepEqual({ ...RECIPES.motor.cost }, { wood: 6, scrap: 4, rope: 2 });
  assert.deepEqual({ ...RECIPES.wheel.cost }, { wood: 5, rope: 2 });
  assert.ok(CONTENT_DECOR.includes('motor') && CONTENT_DECOR.includes('wheel'));
  assert.equal(CONTENT_BLOCK_RADIUS.motor, .45); assert.equal(CONTENT_BLOCK_RADIUS.wheel, .4);
});

test('cleanEngine: garbage in, default out', () => {
  for (const v of [undefined, null, 0, 'x', [], [1], { motors: [] }, { motors: 'a' }, { motors: null }]) assert.deepEqual(cleanEngine(v), { v: 1, motors: {} });
});

test('cleanEngine: keys, on, fuel', () => {
  const c = cleanEngine({ v: 7, motors: { '1,0': { on: true, fuel: 12.345 }, 'a,b': { on: true }, '1,0,2': {}, '-2,3': { on: 'yes', fuel: -5 },
    '0,0': { on: 1, fuel: NaN }, '3,3': { fuel: 1e9 }, '4,4': null, '5,5': { fuel: Infinity } } });
  assert.deepEqual(c, { v: 1, motors: { '1,0': { on: true, fuel: 12.3 }, '-2,3': { on: false, fuel: 0 }, '0,0': { on: false, fuel: 0 },
    '3,3': { on: false, fuel: ENGINE.FUEL_CAP }, '4,4': { on: false, fuel: 0 }, '5,5': { on: false, fuel: 0 } } });
  // JSON round trip is stable
  assert.deepEqual(cleanEngine(JSON.parse(JSON.stringify(c))), c);
});

test('cleanEngine: at most 64 entries, deterministic', () => {
  const motors = {}; for (let i = 0; i < 100; i++) motors[i + ',0'] = { on: true, fuel: 1 };
  const c = cleanEngine({ motors });
  assert.equal(Object.keys(c.motors).length, ENGINE.MAX_ENTRIES);
  assert.deepEqual(Object.keys(cleanEngine({ motors }).motors), Object.keys(c.motors));
});

test('cleanEngine: throwing getters never throw', () => {
  const bad = { get motors() { throw new Error('x'); } };
  assert.deepEqual(cleanEngine(bad), { v: 1, motors: {} });
  const m = { '1,1': { get on() { throw new Error('x'); }, get fuel() { throw new Error('y'); } } };
  Object.defineProperty(m, '2,2', { enumerable: true, get() { throw new Error('z'); } });
  assert.deepEqual(cleanEngine({ motors: m }), { v: 1, motors: { '1,1': { on: false, fuel: 0 }, '2,2': { on: false, fuel: 0 } } });
  const px = new Proxy({}, { ownKeys() { throw new Error('k'); } });
  assert.deepEqual(cleanEngine({ motors: px }), { v: 1, motors: {} });
});

test('motorKeys / wheelSpots', () => {
  const decor = [M(2, 0), { type: 'wheel', x: 0, z: 1 }, M(-1, 0), { type: 'crate', x: 3, z: 3 }, { type: 'wheel', x: 1, z: -1 }];
  assert.deepEqual(motorKeys(decor), ['-1,0', '2,0']);
  const out = [];
  const r = wheelSpots(decor, out);
  assert.equal(r, out); assert.deepEqual(out, [{ x: 0, z: 2 }, { x: 2, z: -2 }]);
  const first = out[0];
  wheelSpots(decor, out); assert.equal(out[0], first); // reused objects
  wheelSpots([], out); assert.equal(out.length, 0);
  assert.deepEqual(motorKeys(undefined), []);
});

test('engineSpeed: gain table, size factor, monotonic, capped', () => {
  const want = [0, .7, 1.05, 1.26, 1.4, 1.4, 1.4];
  for (let n = 0; n <= 6; n++) near(engineSpeed(n, 9), want[n], 1e-9, `n=${n}`);
  near(engineSpeed(1, 9), .7); near(engineSpeed(1, 16), .7); near(engineSpeed(1, 100), .7 * .6);
  near(engineSpeed(1, 0), .7);
  let prev = Infinity;
  for (let t = 1; t <= 400; t++) { const s = engineSpeed(1, t); assert.ok(s <= prev + 1e-12); prev = s; }
  for (let n = 0; n < 10; n++) for (const t of [1, 9, 50, 500]) assert.ok(engineSpeed(n, t) <= 1.4 + 1e-12);
  assert.equal(engineSpeed(NaN, 9), 0); assert.equal(engineSpeed(-1, 9), 0);
});

test('enginePush: along the heading; zero when anchored, off, empty or no decor', () => {
  const decor = [M(1, 0)], s = defaultSailing(), out = { x: 9, z: 9 };
  const st = slice({ '1,0': { on: true, fuel: 10 } });
  s.heading = 0;
  assert.equal(enginePush(st, decor, 9, s, out), out); near(out.x, 0); near(out.z, .7);
  s.heading = Math.PI / 2; enginePush(st, decor, 9, s, out); near(out.x, .7); near(out.z, 0, 1e-12);
  s.anchored = true; enginePush(st, decor, 9, s, out); assert.deepEqual(out, { x: 0, z: 0 }); s.anchored = false;
  enginePush(slice({ '1,0': { on: false, fuel: 10 } }), decor, 9, s, out); assert.deepEqual(out, { x: 0, z: 0 });
  enginePush(slice({ '1,0': { on: true, fuel: 0 } }), decor, 9, s, out); assert.deepEqual(out, { x: 0, z: 0 });
  enginePush(slice({ '5,5': { on: true, fuel: 10 } }), decor, 9, s, out); assert.deepEqual(out, { x: 0, z: 0 }); // entry without decor
  enginePush(st, [], 9, s, out); assert.deepEqual(out, { x: 0, z: 0 });
  assert.equal(runningCount(st, decor, true), 0); assert.equal(runningCount(st, decor, false), 1);
});

test('burn: only running motors, clamps dt, reports dry keys, never negative', () => {
  const decor = [M(1, 0), M(2, 0), M(3, 0)];
  const st = slice({ '1,0': { on: true, fuel: 1.5 }, '2,0': { on: false, fuel: 5 }, '3,0': { on: true, fuel: 0 }, '9,9': { on: true, fuel: 5 } });
  assert.deepEqual(burn(st, decor, .5, false), []);
  near(st.motors['1,0'].fuel, 1); assert.equal(st.motors['2,0'].fuel, 5); assert.equal(st.motors['9,9'].fuel, 5);
  assert.deepEqual(burn(st, decor, 100, false), ['1,0']); // dt clamped to MAX_TICK = 1 -> exactly empty
  assert.equal(st.motors['1,0'].fuel, 0); assert.equal(st.motors['1,0'].on, true); // stays on, restarts when fed
  assert.deepEqual(burn(st, decor, 1, false), []);
  st.motors['1,0'].fuel = .3; assert.deepEqual(burn(st, decor, 1, false), ['1,0']); assert.equal(st.motors['1,0'].fuel, 0);
  st.motors['1,0'].fuel = 3; assert.deepEqual(burn(st, decor, 1, true), []); assert.equal(st.motors['1,0'].fuel, 3); // anchored: no burn
  assert.deepEqual(burn(st, decor, -1, false), []); assert.deepEqual(burn(st, decor, NaN, false), []); assert.equal(st.motors['1,0'].fuel, 3);
});

test('applyEngineAction: toggle and all', () => {
  const decor = [M(1, 0), M(2, 0)], st = slice({});
  assert.deepEqual(applyEngineAction(st, { op: 'toggle', x: 1, z: 0 }, decor), { ok: true, text: 'Needs fuel' });
  assert.deepEqual(st.motors['1,0'], { on: true, fuel: 0 });
  assert.deepEqual(applyEngineAction(st, { op: 'toggle', x: 1, z: 0 }, decor), { ok: true, text: 'Motor off' });
  st.motors['1,0'].fuel = 10;
  assert.equal(applyEngineAction(st, { op: 'toggle', x: 1, z: 0 }, decor).text, 'Motor on');
  assert.equal(applyEngineAction(st, { op: 'toggle', x: 5, z: 5 }, decor).ok, false);
  assert.equal(applyEngineAction(st, { op: 'toggle', x: 1.5, z: 0 }, decor).ok, false);
  // all: any on -> all off, else all on
  assert.deepEqual(applyEngineAction(st, { op: 'all' }, decor), { ok: true, text: 'Motors off' });
  assert.equal(st.motors['1,0'].on, false); assert.equal(st.motors['2,0'].on, false);
  assert.deepEqual(applyEngineAction(st, { op: 'all' }, decor), { ok: true, text: 'Motors on' });
  assert.equal(st.motors['1,0'].on, true); assert.equal(st.motors['2,0'].on, true);
  assert.deepEqual(applyEngineAction(slice({}), { op: 'all' }, []), { ok: false, text: 'No motors' });
  assert.equal(applyEngineAction(st, { op: 'nope' }, decor).ok, false);
  assert.equal(applyEngineAction(st, null, decor).ok, false);
});

test('applyEngineAction: fuel takes exactly one item, clamps, refuses cleanly', () => {
  const decor = [M(1, 0)], st = slice({});
  const bag = bagFrom([{ kind: 'wood', count: 3 }, { kind: 'leaf', count: 1 }, { kind: 'plastic', count: 2 }, { kind: 'scrap', count: 2 }]);
  assert.deepEqual(applyEngineAction(st, { op: 'fuel', x: 1, z: 0, item: 'wood', count: 99 }, decor, bag), { ok: true, text: '+45 s fuel' });
  assert.equal(bag.count('wood'), 2); assert.equal(st.motors['1,0'].fuel, 45); assert.equal(st.motors['1,0'].on, false);
  assert.equal(applyEngineAction(st, { op: 'fuel', x: 1, z: 0, item: 'leaf' }, decor, bag).text, '+20 s fuel'); assert.equal(bag.count('leaf'), 0);
  const snap = () => JSON.stringify(bag.snapshot());
  let before = snap();
  assert.deepEqual(applyEngineAction(st, { op: 'fuel', x: 1, z: 0, item: 'scrap' }, decor, bag), { ok: false, text: 'Not fuel' });
  assert.equal(applyEngineAction(st, { op: 'fuel', x: 1, z: 0, item: 'leaf' }, decor, bag).ok, false); // none left
  assert.equal(applyEngineAction(st, { op: 'fuel', x: 2, z: 0, item: 'wood' }, decor, bag).text, 'No motors');
  assert.equal(applyEngineAction(st, { op: 'fuel', x: 1, z: 0, item: 'toString' }, decor, bag).text, 'Not fuel');
  assert.equal(snap(), before);
  st.motors['1,0'].fuel = 280;
  assert.equal(applyEngineAction(st, { op: 'fuel', x: 1, z: 0, item: 'plastic' }, decor, bag).ok, true);
  assert.equal(st.motors['1,0'].fuel, ENGINE.FUEL_CAP); assert.equal(bag.count('plastic'), 1); // overflow clamped
  st.motors['1,0'].fuel = ENGINE.FUEL_CAP - 1; before = snap();
  assert.deepEqual(applyEngineAction(st, { op: 'fuel', x: 1, z: 0, item: 'wood' }, decor, bag), { ok: false, text: 'Tank is full' });
  assert.equal(snap(), before);
  assert.equal(fmtFuel(130), '2:10'); assert.equal(fmtFuel(0), '0:00'); assert.equal(fmtFuel(59.2), '1:00');
});

// ---------------------------------------------------------------- the content module with a fake ctx
function makeCtx(role = 'solo', world) {
  world ??= { tiles: tiles(9), decor: [M(1, 0), { type: 'wheel', x: 0, z: 1 }], sailing: defaultSailing(), ext: {} };
  const emits = [], bags = { host: bagFrom([{ kind: 'wood', count: 5 }]), guest: bagFrom([{ kind: 'plastic', count: 5 }]) };
  const sent = [];
  const ctx = { T: null, world, role, running: true, physics: { x: 0, z: 0 }, camera: null, raft: null,
    localBag: () => bags[role === 'guest' ? 'guest' : 'host'], actorBag: a => bags[a], emit: (e, to) => emits.push({ e, to }), rebuildRaft() {} };
  ctx.action = a => { sent.push(a); if (role !== 'guest') mod.action(a, 'host', bags.host); };
  const mod = createEngine(ctx);
  return { ctx, mod, emits, bags, sent, world };
}

test('createEngine: actions, burn notice, prune, serialize round trip', () => {
  const { mod, emits, bags, world } = makeCtx();
  assert.equal(mod.name, 'engine');
  assert.equal(mod.action({ kind: 'sail', op: 'raise' }, 'host', bags.host), false);
  assert.equal(mod.action({ kind: 'engine', op: 'fuel', x: 1, z: 0, item: 'wood' }, 'host', bags.host), true);
  assert.equal(bags.host.count('wood'), 4);
  assert.equal(emits.at(-1).e.text, '+45 s fuel'); assert.equal(emits.at(-1).to, 'host');
  // guest fuels with its own bag
  assert.equal(mod.action({ kind: 'engine', op: 'fuel', x: 1, z: 0, item: 'plastic' }, 'guest', bags.guest), true);
  assert.equal(bags.guest.count('plastic'), 4); assert.equal(bags.host.count('wood'), 4); assert.equal(emits.at(-1).to, 'guest');
  mod.action({ kind: 'engine', op: 'toggle', x: 1, z: 0 }, 'host', bags.host);
  assert.equal(mod.serialize().motors['1,0'].on, true);
  mod.action({ kind: 'engine', op: 'toggle', x: 1, z: 0 }, 'host', bags.host); // rate limited (OP_GAP)
  assert.equal(mod.serialize().motors['1,0'].on, true);
  const out = { x: 0, z: 0 };
  assert.equal(mod.sailPush(world.sailing, out), true); near(out.z, .7);
  // burn to empty: notice to all, push stops
  mod.debug.fuel(1, 0, .5);
  mod.update(1);
  assert.equal(mod.serialize().motors['1,0'].fuel, 0);
  assert.deepEqual(emits.at(-1), { e: { kind: 'notice', text: 'A motor ran out of fuel' }, to: 'all' });
  assert.equal(mod.sailPush(world.sailing, out), false); assert.deepEqual(out, { x: 0, z: 0 });
  // round trip
  mod.debug.fuel(1, 0, 100);
  const saved = JSON.parse(JSON.stringify(mod.serialize()));
  const b = makeCtx('solo', world); b.mod.load(saved, 'save');
  assert.deepEqual(b.mod.serialize(), saved);
  // prune entries whose decor is gone (host)
  world.decor = [{ type: 'wheel', x: 0, z: 1 }]; mod.update(.01);
  assert.deepEqual(mod.serialize().motors, {});
  assert.deepEqual(mod.steerTargets(), [{ x: 0, z: 2 }]);
});

test('createEngine: old save loads to defaults, no push', () => {
  const { mod, world } = makeCtx();
  mod.load(undefined, 'save');
  assert.deepEqual(mod.serialize(), { v: 1, motors: {} });
  const out = { x: 1, z: 1 };
  assert.equal(mod.sailPush(world.sailing, out), false); assert.deepEqual(out, { x: 0, z: 0 });
});

test('co-op: guest push from synced data equals the host push; guest never burns', () => {
  const host = makeCtx('host');
  host.mod.debug.fuel(1, 0, 60); host.mod.debug.set(1, 0, true);
  host.world.sailing.heading = 1.1;
  const gWorld = JSON.parse(JSON.stringify({ tiles: host.world.tiles, decor: host.world.decor, sailing: host.world.sailing }));
  const guest = makeCtx('guest', gWorld);
  guest.mod.load(JSON.parse(JSON.stringify(host.mod.serialize())), 'net');
  const a = { x: 0, z: 0 }, b = { x: 0, z: 0 };
  host.mod.sailPush(host.world.sailing, a); guest.mod.sailPush(gWorld.sailing, b);
  assert.deepEqual(b, a); near(Math.hypot(a.x, a.z), .7);
  guest.mod.update(1); assert.equal(guest.mod.serialize().motors['1,0'].fuel, 60);
  host.mod.update(1); near(host.mod.serialize().motors['1,0'].fuel, 59);
  // guest E on the motor is sent to the host, not applied locally
  assert.equal(guest.mod.debug.fuel(1, 0, 5), false);
  guest.mod.load({ v: 1, motors: { '1,0': { on: false, fuel: 3 } } }, 'net');
  guest.mod.sailPush(gWorld.sailing, b); assert.deepEqual(b, { x: 0, z: 0 });
});

test('review: keys for negative tiles; rebuild with the same child count is rescanned', () => {
  assert.deepEqual(motorKeys([M(-3, 2), M(0, -1)]), ['-3,2', '0,-1']);
  const st = slice({ '-3,2': { on: true, fuel: 5 } });
  assert.equal(runningCount(st, [M(-3, 2)], false), 1);
  // fake raft: a rebuild swaps a plain decor child for a motor model, child count unchanged
  const prop = { rotation: { z: 0 } }, child = (engine, x) => ({ userData: engine ? { engine } : {}, position: { x, z: 0 },
    getObjectByName: n => (engine && n === 'engineProp' ? prop : null) });
  const raft = { position: { y: 0 }, children: [child(null, 0), child(null, 2)] };
  const { ctx, mod, world } = makeCtx();
  ctx.raft = raft; mod.debug.fuel(1, 0, 60); mod.debug.set(1, 0, true);
  mod.update(.1); assert.equal(prop.rotation.z, 0);
  raft.children = [child(null, 0), child('motor', 2)]; // rebuildRaft recreates every child
  mod.update(.1); assert.ok(prop.rotation.z > 0, 'new motor model found');
  assert.equal(world.decor.length, 2);
});

test('review: a null decor entry never throws (module would be disabled)', () => {
  const { mod, world } = makeCtx();
  world.decor.push(null);
  assert.doesNotThrow(() => { mod.update(.1); mod.sailPush(world.sailing, { x: 0, z: 0 }); mod.steerTargets(); mod.prompt(null); });
});

test('review: prompt rows for prompts.js (the visible prompt) match the HTML prompt', () => {
  const { ctx, mod } = makeCtx();
  ctx.camera = { position: { x: 0, y: 1.6, z: 0 } }; ctx.physics = { x: 0, z: 0 };
  const at = (x, y, z) => { const v = [x, y - 1.6, z], l = Math.hypot(...v); return { dir: { x: v[0] / l, y: v[1] / l, z: v[2] / l } }; };
  const motor = at(2, .65, 0), wheel = at(0, 1.05, 2);
  assert.deepEqual(mod.promptRows(motor), [{ key: 'E', label: 'Add wood (+45 s)' }]); // host holds wood
  mod.debug.fuel(1, 0, 130);
  ctx.localBag = () => bagFrom([]);
  assert.deepEqual(mod.promptRows(motor), [{ key: 'E', label: 'Start motor' }, { label: '2:10 fuel', muted: true }]);
  assert.match(mod.prompt(motor), /Start motor · 2:10 fuel/);
  assert.deepEqual(mod.promptRows(wheel), [{ key: 'E', label: 'Start motors' }, { key: 'R', hold: true, label: 'Steer' }]);
  assert.equal(mod.promptRows(at(0, 1.6, -3)), null);
  ctx.world.decor = [{ type: 'wheel', x: 0, z: 1 }];
  assert.deepEqual(mod.promptRows(wheel)[1], { label: 'No motors yet', muted: true });
});

test('review: the engine provider yields to the pickup and waiting-for-host prompts', async () => {
  const T = await import(new URL('vendor/three.module.js', base));
  let provider = null;
  globalThis.raftPrompts = { provide: o => { provider = o; return () => {}; } };
  try {
    const { ctx } = makeCtx();
    ctx.T = T; const mod = E.createEngine(ctx); // needs T for its camera-forward scratch vector
    const v = new T.Vector3(2, .65 - 1.6, 0).normalize();
    ctx.camera = { position: { x: 0, y: 1.6, z: 0 }, getWorldDirection: o => o.copy(v) };
    mod.update(1 / 60);
    assert.ok(Array.isArray(provider.prompt({ state: { role: 'solo' } })), 'aimed at the motor');
    assert.equal(provider.prompt({ state: { role: 'solo', pickup: { type: 'wood' } } }), null);
    assert.equal(provider.prompt({ state: { role: 'guest', networkReady: false } }), null);
    mod.dispose();
  } finally { delete globalThis.raftPrompts; }
});
