// Unit tests for the Map Table content module (dist/maptable.js): pure helpers + host logic, no DOM.
// Run: node --test tests/maptable.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const M = await import(new URL('maptable.js', base));
const { cleanMap, pushTrail, recordIsland, islandName, courseTo, createMapTable, HG, TRAIL_STEP, TRAIL_MAX, ISL_MAX, PIN_MAX, NAME_WORDS, FULL_TEXT } = M;
const L = await import(new URL('islands-layout.js', base));
const { ISLAND, layoutFor } = L;
const SC = await import(new URL('sailing-core.js', base));
const { ITEMS, PLACEABLE_IDS, BLOCK_RADII } = await import(new URL('items.js', base));

// ---------------------------------------------------------------- helpers
function makeCtx({ role = 'host', islands = null, sailing = { gx: 100, gz: -200, heading: 0, anchored: false } } = {}) {
  const emits = [], notices = [], actions = [];
  const peekState = { islands };
  const ctx = {
    T: null, role, running: true, elapsed: 0, physics: { x: 50, z: 50 }, other: null, camera: null, raft: null,
    world: { tiles: [[0, 0]], decor: [], sailing, signal: null },
    emit: (e, to) => emits.push({ e, to }), notice: s => notices.push(s), action: a => actions.push(a), uiOpen: () => false,
  };
  const mod = createMapTable(ctx, { peek: name => peekState[name] });
  return { ctx, mod, emits, notices, actions, peekState };
}
// An islands serialize() snapshot with the island `t` seconds after birth.
function islandsAt(seed, t, { side = 1, off = 20, dock = ISLAND.DOCK, used } = {}) {
  const lay = layoutFor(seed);
  return { v: 1, clock: 1000 + t, next: 9999, isl: { seed, born: 1000, dock, side, off, used: used ?? lay.nodes.map(() => 0) } };
}
const tick = (mod, seconds = 0.5) => mod.update(seconds);

// ---------------------------------------------------------------- 1. cleanMap
test('cleanMap: junk becomes defaults, never throws', () => {
  for (const j of [undefined, null, [], 5, 'x', { v: 2, isl: [{ s: 1, x: 0, z: 0 }] }, { v: '1' }]) {
    assert.deepEqual(cleanMap(j), { v: 1, rev: 0, seq: 1, isl: [], pins: [], trail: [] });
  }
  const hostile = { v: 1, get isl() { throw new Error('boom'); }, pins: [{ get n() { throw new Error('x'); } }], trail: [NaN, 1, 2, 3], rev: NaN };
  assert.doesNotThrow(() => cleanMap(hostile));
  const h = cleanMap(hostile);
  assert.deepEqual(h.isl, []); assert.deepEqual(h.pins, []); assert.equal(h.rev, 0);
  const p = new Proxy({}, { get() { throw new Error('nope'); } });
  assert.deepEqual(cleanMap(p), cleanMap(undefined));
});

test('cleanMap: drops bad entries, dedupes seeds, caps, clamps and round-trips', () => {
  const isl = [{ s: 7, x: 1.4, z: 2.6, f: 3 }, { s: -1, x: 0, z: 0 }, { s: 1.5, x: 0, z: 0 }, { s: 2 ** 32, x: 0, z: 0 }, { s: 8, x: NaN, z: 0 }, null, 'x',
    { s: 9, x: 1e9, z: -1e9, f: 9 }, { s: 7, x: 10, z: 20, f: 1 }];
  const c = cleanMap({ v: 1, rev: 4, isl });
  assert.deepEqual(c.isl, [{ s: 9, x: HG, z: -HG, f: 0 }, { s: 7, x: 10, z: 20, f: 1 }]); // last wins
  assert.equal(c.rev, 4);
  const many = Array.from({ length: 60 }, (_, k) => ({ s: k, x: k, z: 0 }));
  const cm = cleanMap({ v: 1, isl: many });
  assert.equal(cm.isl.length, ISL_MAX); assert.equal(cm.isl[0].s, 20); assert.equal(cm.isl.at(-1).s, 59);
  const pins = [{ n: 3, x: 0, z: 0, i: 1 }, { n: 3, x: 5, z: 5, i: 2 }, { n: -1, x: 0, z: 0 }, { n: 4, x: 0, z: 0, i: 7 }, ...Array.from({ length: 10 }, (_, k) => ({ n: 10 + k, x: k, z: k, i: 0 }))];
  const cp = cleanMap({ v: 1, seq: 2, pins });
  assert.equal(cp.pins.length, PIN_MAX);
  assert.equal(new Set(cp.pins.map(p => p.n)).size, cp.pins.length);
  assert.ok(cp.seq > Math.max(...cp.pins.map(p => p.n)));
  assert.equal(cleanMap({ v: 1, pins: [{ n: 4, x: 0, z: 0, i: 7 }] }).pins[0].i, 0);
  const trail = []; for (let k = 0; k < 300; k++) trail.push(k * 30, -k);
  trail.splice(10, 2, 'a', Infinity);
  const ct = cleanMap({ v: 1, trail });
  assert.ok(ct.trail.length <= TRAIL_MAX && ct.trail.length % 2 === 0);
  assert.deepEqual(ct.trail.slice(-2), [299 * 30, -299]);
  const odd = cleanMap({ v: 1, trail: [1, 2, 3] });
  assert.deepEqual(odd.trail, [1, 2]);
  const full = cleanMap({ v: 1, rev: 3, seq: 9, isl: [{ s: 1, x: 2, z: 3, f: 2 }], pins: [{ n: 4, x: 5, z: 6, i: 3 }], trail: [1, 2, 40, 50] });
  assert.deepEqual(cleanMap(JSON.parse(JSON.stringify(full))), full);
});

// ---------------------------------------------------------------- 2. pushTrail
test('pushTrail: spacing, wrap seam and decimation', () => {
  const t = [];
  assert.equal(pushTrail(t, 0, 0), true);
  assert.equal(pushTrail(t, 10, 10), false); // < 25 m
  assert.equal(pushTrail(t, 0, TRAIL_STEP), true);
  const w = [HG - 5, 0];
  assert.equal(pushTrail(w, -HG + 5, 0), false, 'across the seam it is only 10 m');
  assert.equal(pushTrail(w, -HG + 30, 0), true);
  const big = [];
  for (let k = 0; k < 500; k++) {
    pushTrail(big, k * 30, 0);
    assert.ok(big.length <= TRAIL_MAX && big.length % 2 === 0);
    assert.deepEqual(big.slice(-2), [k * 30, 0]);
    assert.deepEqual(big.slice(0, 2), [0, 0]);
  }
  // older trail is sparser than the newest stretch
  const xs = []; for (let k = 0; k < big.length; k += 2) xs.push(big[k]);
  assert.ok(xs[1] - xs[0] > xs.at(-1) - xs.at(-2));
});

// ---------------------------------------------------------------- 3. discovery
test('discovery: approach records nothing, docked records once at gx + side*off, gz + dockZ', () => {
  const seed = 4242, lay = layoutFor(seed);
  const { mod, peekState, emits } = makeCtx();
  tick(mod); // first tick with no island
  peekState.islands = islandsAt(seed, 5, { side: -1, off: 30 });
  tick(mod);
  assert.equal(mod.serialize().isl.length, 0);
  peekState.islands = islandsAt(seed, ISLAND.APPROACH + 10, { side: -1, off: 30 });
  tick(mod);
  const isl = mod.serialize().isl;
  assert.equal(isl.length, 1);
  assert.deepEqual(isl[0], { s: seed, x: Math.round(100 - 30), z: Math.round(-200 + lay.dockZ), f: 0 });
  assert.ok(emits.some(e => e.e.text === `Charted ${islandName(seed)}`));
  tick(mod); tick(mod);
  assert.equal(mod.serialize().isl.length, 1);
});

test('discovery: an island already showing at the first tick is recorded; gone is not', () => {
  const a = makeCtx({ islands: islandsAt(11, 3) });
  tick(a.mod);
  assert.equal(a.mod.serialize().isl.length, 1);
  const b = makeCtx({ islands: islandsAt(12, ISLAND.APPROACH + ISLAND.DOCK + ISLAND.DEPART + 5) });
  tick(b.mod);
  assert.equal(b.mod.serialize().isl.length, 0);
});

test('discovery: visited and gathered flags', () => {
  const seed = 99, lay = layoutFor(seed);
  const { mod, ctx, peekState } = makeCtx();
  peekState.islands = islandsAt(seed, ISLAND.APPROACH + 1, { side: 1, off: 20 });
  tick(mod);
  assert.equal(mod.serialize().isl[0].f, 0);
  ctx.physics = { x: 20 + lay.R * 0.5, z: lay.dockZ };
  tick(mod);
  assert.equal(mod.serialize().isl[0].f, 1);
  ctx.physics = { x: 500, z: 500 };
  ctx.other = null;
  peekState.islands = islandsAt(seed, ISLAND.APPROACH + 2, { side: 1, off: 20, used: lay.nodes.map(n => n.max) });
  tick(mod);
  assert.equal(mod.serialize().isl[0].f, 3);
  // guest pose counts too
  const g = makeCtx();
  g.peekState.islands = islandsAt(5, ISLAND.APPROACH + 1, { off: 15 });
  g.ctx.physics = { x: 999, z: 999 }; g.ctx.other = { x: 15, z: layoutFor(5).dockZ };
  tick(g.mod);
  assert.equal(g.mod.serialize().isl[0].f & 1, 1);
});

test('discovery: 41 seeds keep 40 (oldest gone); a guest never appends', () => {
  const { mod, peekState } = makeCtx();
  for (let s = 1; s <= 41; s++) { peekState.islands = islandsAt(s, ISLAND.APPROACH + 1); tick(mod); }
  const isl = mod.serialize().isl;
  assert.equal(isl.length, ISL_MAX);
  assert.equal(isl[0].s, 2); assert.equal(isl.at(-1).s, 41);
  const g = makeCtx({ role: 'guest', islands: islandsAt(3, ISLAND.APPROACH + 1) });
  for (let k = 0; k < 5; k++) tick(g.mod);
  assert.equal(g.mod.serialize().isl.length, 0);
  assert.equal(g.mod.serialize().trail.length, 0);
});

test('trail: the host samples world.sailing at 2 Hz', () => {
  const { mod, ctx } = makeCtx();
  tick(mod, 0.2);
  assert.equal(mod.serialize().trail.length, 0, 'not yet half a second');
  tick(mod, 0.4);
  assert.deepEqual(mod.serialize().trail, [100, -200]);
  ctx.world.sailing.gx += 10; tick(mod);
  assert.equal(mod.serialize().trail.length, 2);
  ctx.world.sailing.gx += 30; tick(mod);
  assert.equal(mod.serialize().trail.length, 4);
});

// ---------------------------------------------------------------- 4. names
test('islandName: deterministic, varied, only listed words', () => {
  assert.equal(islandName(1234), islandName(1234));
  const names = new Set();
  for (let s = 0; s < 1000; s++) {
    const n = islandName(s * 7919 + 13);
    const [a, b] = n.split(' ');
    assert.ok(NAME_WORDS.A.includes(a) && NAME_WORDS.B.includes(b), n);
    names.add(n);
  }
  assert.ok(names.size >= 50, `only ${names.size} names`);
});

// ---------------------------------------------------------------- 5. pins
test('pin actions: ids, cap, validation, range, cooldown, unpin, rev and serialize cache', () => {
  const { mod, ctx, emits } = makeCtx();
  const pin = (x, z, i = 0, actor = 'host') => { ctx.elapsed += 1; return mod.action({ kind: 'map', op: 'pin', x, z, i }, actor); };
  assert.equal(mod.action({ kind: 'other' }, 'host'), false);
  const s0 = mod.serialize(); assert.equal(mod.serialize(), s0, 'same object until a change');
  assert.equal(pin(110, -190, 2), true);
  const s1 = mod.serialize(); assert.notEqual(s1, s0); assert.equal(s1.rev, s0.rev + 1);
  assert.deepEqual(s1.pins, [{ n: 1, x: 110, z: -190, i: 2 }]);
  for (const bad of [[NaN, 0, 0], [0, Infinity, 0], [0, 0, 4], [0, 0, 1.5], [0, 0, -1], ['1', 0, 0]]) pin(...bad);
  assert.equal(mod.serialize().pins.length, 1);
  pin(100 + 12001, -200, 0); pin(100, -200 - 12001, 0);
  assert.equal(mod.serialize().pins.length, 1, 'out of range refused');
  pin(100 + 11999, -200, 0);
  assert.equal(mod.serialize().pins.length, 2);
  // cooldown: two pins in the same instant from one actor
  mod.action({ kind: 'map', op: 'pin', x: 1, z: 1, i: 0 }, 'host');
  mod.action({ kind: 'map', op: 'pin', x: 2, z: 2, i: 0 }, 'host');
  assert.equal(mod.serialize().pins.length, 2);
  mod.action({ kind: 'map', op: 'pin', x: 3, z: 3, i: 0 }, 'guest'); // the other actor has its own cooldown
  assert.equal(mod.serialize().pins.length, 3);
  for (let k = 0; k < 10; k++) pin(k * 10, 5, 1);
  assert.equal(mod.serialize().pins.length, PIN_MAX);
  assert.ok(emits.some(e => e.e.text === FULL_TEXT && e.to === 'host'));
  const ids = mod.serialize().pins.map(p => p.n);
  assert.equal(new Set(ids).size, ids.length);
  const r = mod.serialize().rev;
  assert.equal(mod.action({ kind: 'map', op: 'unpin', n: 999 }, 'host'), true);
  assert.equal(mod.serialize().rev, r, 'unknown id is a no-op');
  mod.action({ kind: 'map', op: 'unpin', n: ids[0] }, 'guest');
  assert.equal(mod.serialize().pins.length, PIN_MAX - 1);
  assert.equal(mod.serialize().rev, r + 1);
  pin(7, 7, 3);
  assert.ok(mod.serialize().pins.at(-1).n > Math.max(...ids), 'ids are never reused');
  assert.equal(mod.action({ kind: 'map', op: 'dance' }, 'host'), true);
  assert.equal(mod.action({ kind: 'map', op: 'unpin', n: 'x' }, 'host'), true);
  // guests forward, never apply
  const g = makeCtx({ role: 'guest' });
  assert.equal(g.mod.action({ kind: 'map', op: 'pin', x: 100, z: -200, i: 0 }, 'host'), true);
  assert.equal(g.mod.serialize().pins.length, 0);
});

// ---------------------------------------------------------------- 6. courseTo
test('courseTo: sail heading and compass bearing conventions, wrap-aware', () => {
  const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
  let c = courseTo(0, 0, 0, 100); near(c.heading, 0); near(c.bearing, 180); near(c.dist, 100);
  c = courseTo(0, 0, 100, 0); near(c.heading, Math.PI / 2); near(c.bearing, 90);
  c = courseTo(0, 0, 0, -100); near(Math.abs(c.heading), Math.PI); near(c.bearing, 0);
  c = courseTo(0, 0, -100, 0); near(c.bearing, 270);
  c = courseTo(HG - 10, 0, -HG + 10, 0); near(c.dist, 20); near(c.heading, Math.PI / 2);
  // the sail moves the raft along (sin h, cos h): stepping toward the target closes the distance
  const st = SC.defaultSailing(); st.gx = 0; st.gz = 0;
  const tx = 300, tz = -400, h = courseTo(st.gx, st.gz, tx, tz).heading;
  const d0 = Math.hypot(tx - st.gx, tz - st.gz);
  st.gx += Math.sin(h) * 50; st.gz += Math.cos(h) * 50;
  near(Math.hypot(tx - st.gx, tz - st.gz), d0 - 50, 1e-6);
});

test('course: sends the shared sail heading action and a notice', () => {
  const { mod, actions, notices, ctx } = makeCtx();
  mod.debug.addIsland(77, 100, -540);
  ctx.world.sailing.anchored = true;
  const c = mod.debug.course(0);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'sail'); assert.equal(actions[0].op, 'heading');
  assert.ok(Math.abs(Math.abs(actions[0].heading) - Math.PI) < 1e-9);
  assert.equal(c.bearing, 0);
  assert.match(notices.at(-1), /^Course set: N · 340 m \(wind still decides the speed\) · Anchor is down$/);
});

// ---------------------------------------------------------------- 7. load + items
test('load: net with equal rev is a no-op; saves always clean; old saves give an empty chart', () => {
  const { mod } = makeCtx({ role: 'guest' });
  const data = { v: 1, rev: 5, seq: 3, isl: [{ s: 1, x: 2, z: 3, f: 0 }], pins: [{ n: 2, x: 0, z: 0, i: 1 }], trail: [0, 0] };
  mod.load(data, 'net');
  const s1 = mod.serialize();
  assert.deepEqual(s1.isl, data.isl);
  const before = mod.debug.state();
  mod.load({ ...data, isl: [] }, 'net'); // same rev: ignored (cheap path)
  assert.deepEqual(mod.debug.state(), before);
  assert.equal(mod.serialize(), s1, 'same state object, same cache');
  mod.load({ ...data, rev: 6, isl: [] }, 'net');
  assert.equal(mod.serialize().isl.length, 0);
  // a guest's own save with the same rev as the host still takes the host chart
  const g = makeCtx({ role: 'guest' });
  g.mod.load({ v: 1, rev: 5, isl: [{ s: 9, x: 0, z: 0 }] }, 'save');
  g.mod.load(data, 'net');
  assert.deepEqual(g.mod.serialize().isl, data.isl);
  const h = makeCtx();
  h.mod.load(undefined, 'save');
  assert.deepEqual(h.mod.serialize(), cleanMap(undefined));
  for (const junk of [null, 3, 'x', [], { v: 1, isl: 'no' }]) for (const from of ['save', 'net', 'restore']) assert.doesNotThrow(() => h.mod.load(junk, from));
});

test('items.js: maptable is a placeable decor with a block radius and a dedicated icon', async () => {
  const it = ITEMS.maptable;
  assert.ok(it && it.placeable && it.category === 'decor');
  assert.ok(PLACEABLE_IDS.includes('maptable'));
  assert.equal(BLOCK_RADII.maptable, 0.5);
  assert.deepEqual(it.recipe.cost, { wood: 6, rope: 3, nail: 2, copperingot: 1 });
  assert.deepEqual(it.unlock, { type: 'research', items: ['copperingot'] });
  const { ITEM_ICONS } = await import(new URL('item-svg.js', base));
  assert.ok(typeof ITEM_ICONS.maptable === 'string' && ITEM_ICONS.maptable.includes('<'));
});

test('content registry hands peek(name) to factories and the map table reads islands through it', async () => {
  const { createContent } = await import(new URL('content.js', base));
  let seen = null;
  const a = () => ({ name: 'a', serialize: () => ({ hello: 1 }) });
  const b = (ctx, o) => ({ name: 'b', update() { seen = o.peek('a'); } });
  const c = createContent({}, [a, b]);
  c.update(0);
  assert.deepEqual(seen, { hello: 1 });
  assert.equal(c.mods.length, 2);
});

test('model: shared geometry, at most 8 meshes', async () => {
  const T = await import(new URL('vendor/three.module.js', base));
  const { createMapTableModel } = await import(new URL('maptable-model.js', base));
  const a = createMapTableModel(T), b = createMapTableModel(T);
  let n = 0; a.traverse(o => { if (o.isMesh) n++; });
  assert.ok(n >= 5 && n <= 8, `${n} meshes`);
  assert.equal(a.name, 'maptable');
  assert.equal(a.children[0].geometry, b.children[0].geometry);
  assert.equal(a.children[0].material, b.children[0].material);
  const box = new T.Box3().setFromObject(a);
  assert.ok(box.max.y > 0.8 && box.max.y < 1.0, `height ${box.max.y}`);
  assert.ok(box.max.x - box.min.x <= 1.15 && box.max.z - box.min.z <= 0.85);
});
