// Dropped item boxes: pure rules (drop-box-core.js) and the content module (drop-box.js) with a fake host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const C = await import(new URL('drop-box-core.js', base));
const { createDropBox } = await import(new URL('drop-box.js', base));
const { Bag } = await import(new URL('inventory-state.js', base));
const { ActionMap } = await import(new URL('input-map.js', base));
const { cleanExt } = await import(new URL('content.js', base));
const T = await import(new URL('vendor/three.module.js', base));
const { DROP } = C;
const TILES = [[-1, -1], [0, -1], [-1, 0], [0, 0]];
const FLOW = { x: 0, z: 0, b: .22 };
const env = (o = {}) => ({ tiles: TILES, ground: () => NaN, water: () => .05, carryX: 0, carryZ: 0, clock: 0, ...o });

function bagWith(...slots) {
  const s = new Array(28).fill(null); slots.forEach((x, i) => { s[i] = x; });
  return new Bag({ slots: s, selected: 0 });
}

// A fake game: host role, a player on the raft looking along -z, effects recorded.
function host({ role = 'host', bag = bagWith({ kind: 'wood', count: 7 }, { kind: 'hook', count: 1, durability: 63 }) } = {}) {
  const scene = new T.Scene(), raft = new T.Group(), camera = new T.PerspectiveCamera();
  scene.add(raft, camera); camera.position.set(0, 1.6, 0);
  const effects = [], sent = [];
  const ctx = {
    T, scene, raft, camera, role, running: true, world: { tiles: TILES }, physics: { x: 0, y: 1.6, z: 0 }, other: { x: 0, y: 1.6, z: 0 },
    ocean: { getHeight: () => 0, sample: (x, z, o) => { o.h = 0; o.sx = 0; o.sz = 0; return o; } },
    sailFlow: FLOW, uiOpen: () => false, localBag: () => bag, deckY: () => .22, esc: s => s, notice: s => effects.push({ notice: s }),
    emit: (e, to) => effects.push({ ...e, to }),
  };
  const m = createDropBox(ctx);
  ctx.action = a => { sent.push(a); if (ctx.role !== 'guest') m.action(a, 'host', bag); return true; };
  return { m, ctx, bag, effects, sent };
}
const step = (h, sec, dt = .1) => { for (let t = 0; t < sec - 1e-9; t += dt) h.m.update(dt); };
const aimDown = h => { const p = h.m.debug.meshes()[0]; const d = new T.Vector3(p.x, p.y + .17, p.z).sub(h.ctx.camera.position).normalize(); return { dir: d }; };

test('core: cleanSlice drops garbage, caps, dedupes ids and fixes n', () => {
  for (const v of [undefined, null, 3, 'x', [], { boxes: 'no' }]) assert.deepEqual(C.cleanSlice(v), { v: 1, n: 1, boxes: [] });
  const s = C.cleanSlice({ n: 2, boxes: [
    { id: 5, x: 1, z: 2, s: 'raft', items: [{ kind: 'wood', count: 3 }, { kind: 'nope', count: 1 }, { kind: 'leaf', count: 0 }] },
    { id: 5, x: 0, z: 0, items: [{ kind: 'wood', count: 1 }] }, // duplicate id
    { id: 6, x: NaN, z: 0, items: [{ kind: 'wood', count: 1 }] },
    { id: 7, x: 999, z: -999, s: 'flying', items: [{ kind: 'hook', count: 1, durability: 40 }], f: .3 }, // clamp, bad state, flight without origin
    { id: 8, x: 0, z: 0, items: [] }, 'junk', null,
  ] });
  assert.equal(s.boxes.length, 2);
  assert.deepEqual(s.boxes[0].items, [{ kind: 'wood', count: 3 }]);
  assert.equal(s.boxes[1].x, DROP.RANGE); assert.equal(s.boxes[1].z, -DROP.RANGE); assert.equal(s.boxes[1].s, 'sea'); assert.equal(s.boxes[1].f, 0);
  assert.equal(s.n, 8);
  const many = C.cleanSlice({ boxes: Array.from({ length: 99 }, (_, i) => ({ id: i + 1, x: 0, z: 0, items: [{ kind: 'wood', count: 1 }] })) });
  assert.equal(many.boxes.length, DROP.MAX_BOXES);
});

test('core: takeFromSlot drops one or the whole stack, keeps durability, guards the kind', () => {
  const bag = bagWith({ kind: 'wood', count: 7 }, { kind: 'hook', count: 1, durability: 63 });
  const v0 = bag.version;
  assert.deepEqual(C.takeFromSlot(bag, 0, false, 'wood'), { kind: 'wood', count: 1 });
  assert.equal(bag.slots[0].count, 6); assert.ok(bag.version > v0);
  assert.equal(C.takeFromSlot(bag, 0, true, 'leaf'), null, 'a lagged guest naming another kind drops nothing');
  assert.deepEqual(C.takeFromSlot(bag, 0, true, 'wood'), { kind: 'wood', count: 6 });
  assert.equal(bag.slots[0], null);
  assert.deepEqual(C.takeFromSlot(bag, 1, false), { kind: 'hook', count: 1, durability: 63 });
  assert.equal(C.takeFromSlot(bag, 1, false), null, 'empty slot');
  assert.equal(C.takeFromSlot(bag, 99, false), null);
});

test('core: landing, classify and drops that merge in time and space', () => {
  const l = C.landing(0, 0, 0, -2);
  assert.ok(Math.abs(l.z + DROP.THROW) < 1e-9 && l.x === 0);
  assert.equal(C.classify(TILES, 0, 0), 'raft');
  assert.equal(C.classify(TILES, 0, -6), 'sea');
  assert.equal(C.classify(TILES, 0, -6, 1.2, .05), 'land');
  const s = C.emptySlice();
  const a = C.dropInto(s, { kind: 'wood', count: 1 }, 0, -1, { tiles: TILES });
  const b = C.dropInto(s, { kind: 'wood', count: 2 }, .5, -1.2, { tiles: TILES });
  const c = C.dropInto(s, { kind: 'hook', count: 1, durability: 50 }, .2, -1, { tiles: TILES });
  assert.equal(a, b); assert.equal(a, c); assert.equal(s.boxes.length, 1);
  assert.deepEqual(a.items, [{ kind: 'wood', count: 3 }, { kind: 'hook', count: 1, durability: 50 }]);
  const far = C.dropInto(s, { kind: 'wood', count: 1 }, 0, -6, { tiles: TILES });
  assert.notEqual(far, a, 'too far: its own box');
  for (let i = 0; i < 60; i++) C.stepBox(a, .1, FLOW, env());
  const late = C.dropInto(s, { kind: 'wood', count: 1 }, 0, -1, { tiles: TILES });
  assert.notEqual(late, a, 'too late: its own box');
  assert.equal(s.boxes.length, 3);
});

test('core: takeInto restores items, leaves what does not fit', () => {
  const box = { items: [{ kind: 'wood', count: 25 }, { kind: 'hook', count: 1, durability: 40 }] };
  const bag = bagWith({ kind: 'leaf', count: 1 });
  const r = C.takeInto(bag, box);
  assert.deepEqual(r.loot, { wood: 25, hook: 1 }); assert.equal(r.empty, true);
  assert.equal(bag.count('wood'), 25); assert.equal(bag.slots.find(s => s?.kind === 'hook').durability, 40);
  const full = new Bag({ slots: new Array(28).fill(null).map(() => ({ kind: 'leaf', count: 20 })), selected: 0 });
  const box2 = { items: [{ kind: 'wood', count: 2 }] };
  const r2 = C.takeInto(full, box2);
  assert.equal(r2.taken, 0); assert.equal(r2.empty, false); assert.deepEqual(box2.items, [{ kind: 'wood', count: 2 }]);
});

test('core: despawn timer in open water only; raft boxes stay; a lost plank drops it in the sea', () => {
  const sea = { id: 1, x: 0, z: -8, s: 'sea', r: 0, age: 0, m: 0, f: 0, items: [{ kind: 'wood', count: 1 }] };
  const deck = { id: 2, x: 0, z: 0, s: 'raft', r: 0, age: 0, m: 0, f: 0, items: [{ kind: 'wood', count: 1 }] };
  let gone = false, t = 0;
  while (!gone && t < DROP.DESPAWN + 5) { gone = C.stepBox(sea, 1, { x: 0, z: 0, b: 0 }, env()); t++; }
  assert.ok(gone && Math.abs(t - DROP.DESPAWN) <= 1, `lost after ~${DROP.DESPAWN}s (t=${t})`);
  for (let i = 0; i < DROP.DESPAWN + 10; i++) assert.equal(C.stepBox(deck, 1, FLOW, env()), false);
  assert.equal(deck.age, 0); assert.equal(deck.s, 'raft');
  C.stepBox(deck, .1, FLOW, env({ tiles: [[5, 5]] }));
  assert.equal(deck.s, 'sea');
  const drift = { id: 3, x: 0, z: -8, s: 'sea', r: 0, age: 0, m: 0, f: 0, items: [{ kind: 'wood', count: 1 }] };
  for (let i = 0; i < 20; i++) C.stepBox(drift, .5, FLOW, env());
  assert.ok(drift.z > -8 + 1.5, 'drifts with the water');
  const ahead = { id: 4, x: 0, z: -3.1, s: 'sea', r: 0, age: 0, m: 0, f: 0, items: [{ kind: 'wood', count: 1 }] };
  const path = [];
  for (let i = 0; i < 200; i++) { C.stepBox(ahead, .1, { x: 0, z: 0, b: .5 }, env()); path.push([ahead.x, ahead.z]); }
  assert.ok(path.every(([x, z]) => !C.hasTile(TILES, x, z)), 'never drifts through the raft');
  assert.ok(ahead.z > 1.5, `slides along the front edge and on past the raft (z=${ahead.z.toFixed(2)})`);
  for (const [x0, flow] of [[-.5, { x: 0, z: 0, b: .4 }], [-1.5, { x: 0, z: 0, b: .4 }], [-.2, { x: 0, z: -.3, b: 0 }]]) { // head-on, either side, sailing the other way
    const b = { id: 5, x: x0, z: flow.b ? -3.1 : 2.9, s: 'sea', r: 0, age: 0, m: 0, f: 0, items: [{ kind: 'wood', count: 1 }] };
    for (let i = 0; i < 400; i++) C.stepBox(b, .1, flow, env());
    assert.ok(flow.b ? b.z > 1.5 : b.z < -3.5, `x0=${x0}: drifts past (z=${b.z.toFixed(2)})`);
  }
  const L = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0]]; // wider raft, a side sideways current
  const side = { id: 6, x: -3.2, z: -.4, s: 'sea', r: 0, age: 0, m: 0, f: 0, items: [{ kind: 'wood', count: 1 }] };
  for (let i = 0; i < 400; i++) C.stepBox(side, .1, { x: .4, z: 0, b: 0 }, env({ tiles: L }));
  assert.ok(side.x > 3.5, `a sideways current carries it past too (x=${side.x.toFixed(2)})`);
  const built = { id: 7, x: 0, z: 0, s: 'sea', r: 0, age: 3, m: 0, f: 0, items: [{ kind: 'wood', count: 1 }] };
  C.stepBox(built, .1, FLOW, env());
  assert.equal(built.s, 'raft', 'a plank built under a floating box lifts it onto the deck');
});

test('core: land boxes ride the island and fall in when it leaves', () => {
  const b = { id: 1, x: 10, z: 0, s: 'land', y: .8, r: 0, age: 0, m: 0, f: 0, items: [{ kind: 'wood', count: 1 }] };
  C.stepBox(b, .1, FLOW, env({ ground: () => .9, carryX: .5 }));
  assert.equal(b.x, 10.5); assert.equal(b.y, .9); assert.equal(b.s, 'land'); assert.equal(b.age, 0);
  C.stepBox(b, .1, FLOW, env());
  assert.equal(b.s, 'sea'); assert.equal(b.y, undefined);
});

test('module: Q drops one, Ctrl+Q the stack, drops merge, E takes it back to the feed', () => {
  const h = host();
  h.camera = h.ctx.camera; h.ctx.camera.lookAt(0, 0, -1.3);
  assert.equal(h.m.drop(false), true);
  assert.equal(h.bag.slots[0].count, 6);
  assert.deepEqual(h.sent[0], { kind: 'dropbox.drop', slot: 0, item: 'wood', all: false, fx: h.sent[0].fx, fz: h.sent[0].fz });
  h.m.drop(true);
  assert.equal(h.bag.slots[0], null);
  let st = h.m.debug.state();
  assert.equal(st.boxes.length, 1, 'two quick drops share one box');
  assert.deepEqual(st.boxes[0].items, [{ kind: 'wood', count: 7 }]);
  assert.equal(st.boxes[0].s, 'raft', 'lands on the deck a step ahead');
  assert.ok(h.effects.some(e => e.sound === 'throw' && e.to === 'host'));
  step(h, 1);
  const before = h.m.debug.meshes()[0];
  assert.ok(Math.abs(before.y - .22) < .01, 'rests on the deck');
  assert.match(h.m.prompt(aimDown(h)), /^<kbd>E<\/kbd>Pick up 7 \w+$/);
  assert.equal(h.m.interact(aimDown(h)), true);
  assert.equal(h.bag.count('wood'), 7, 'all back in the bag');
  assert.equal(h.m.debug.state().boxes.length, 0);
  assert.deepEqual(h.effects.find(e => e.kind === 'loot'), { kind: 'loot', loot: { wood: 7 }, sound: 'collect', to: 'host' });
  step(h, .2);
  assert.equal(h.m.debug.meshes().length, 0, 'mesh removed');
  h.bag.select(5);
  assert.equal(h.m.drop(false), true, 'empty hand: consumed, nothing sent');
  assert.equal(h.sent.filter(a => a.kind === 'dropbox.drop').length, 2);
});

test('module: dropped over the side it floats, drifts, and despawns after a long time adrift', () => {
  const h = host();
  h.ctx.physics.z = -1.8; h.ctx.camera.position.set(0, 1.6, -1.8); h.ctx.camera.lookAt(0, 1.6, -9);
  h.m.drop(true);
  const b = h.m.debug.state().boxes[0];
  assert.equal(b.s, 'sea');
  step(h, 2);
  const m = h.m.debug.meshes()[0];
  assert.ok(m.y < 0 && m.y > -.2, 'floats low in the water');
  assert.ok(h.m.debug.state().boxes[0].z > b.z, 'drifts with the flow');
  h.m.debug.age(DROP.DESPAWN);
  step(h, .2);
  assert.equal(h.m.debug.state().boxes.length, 0, 'lost at sea');
});

test('module: save / load roundtrip, old saves and old hosts', () => {
  const h = host();
  h.ctx.camera.lookAt(0, 1.6, -5);
  h.m.drop(false); h.bag.select(1); h.m.drop(false);
  step(h, 1);
  const saved = JSON.parse(JSON.stringify(cleanExt({ dropbox: h.m.serialize() })));
  const h2 = host({ bag: bagWith() });
  h2.m.load(saved.dropbox, 'save');
  const a = h.m.debug.state().boxes, b = h2.m.debug.state().boxes;
  assert.equal(b.length, 1);
  assert.deepEqual(b[0].items, a[0].items);
  assert.deepEqual(b[0].items[1], { kind: 'hook', count: 1, durability: 63 });
  h2.m.update(.1); h2.ctx.camera.lookAt(b[0].x, .3, b[0].z);
  h2.m.interact(aimDown(h2));
  assert.equal(h2.bag.count('wood'), 1); assert.equal(h2.bag.count('hook'), 1);
  // old save: no slice at all
  const h3 = host(); h3.m.load(undefined, 'save'); h3.m.update(.1);
  assert.deepEqual(h3.m.debug.state(), { hostOld: false, boxes: [] });
  // guest of an older host: no slice in its state, Q says so and sends nothing
  const g = host({ role: 'guest' }); g.m.load(undefined, 'net');
  assert.equal(g.m.drop(false), true);
  assert.equal(g.sent.length, 0); assert.equal(g.bag.slots[0].count, 7);
  assert.ok(g.effects.some(e => /can’t take dropped items/.test(e.notice)));
  // guest of a new host: sends the action, the host decides
  g.m.load({ v: 1, n: 1, boxes: [] }, 'net');
  g.m.drop(false);
  assert.equal(g.sent.length, 1); assert.equal(g.bag.slots[0].count, 7, 'no local prediction: the host bag snapshot is canonical');
  // a host ignores a guest action naming the wrong kind or an out-of-reach take
  h.m.action({ kind: 'dropbox.drop', slot: 0, item: 'leaf', all: true, fx: 0, fz: -1 }, 'guest', h.bag);
  assert.equal(h.m.debug.state().boxes.length, 1);
  h.ctx.other = { x: 40, y: 1, z: 40 };
  assert.equal(h.m.action({ kind: 'dropbox.take', id: a[0].id }, 'guest', bagWith()), true);
  assert.equal(h.m.debug.state().boxes.length, 1, 'too far away');
});

test('wiring: Q action, controls, content registry, help tab', () => {
  const m = new ActionMap();
  assert.deepEqual(m.actionFor('KeyQ'), ['drop']);
  const read = f => readFileSync(new URL(f, base), 'utf8');
  assert.match(read('controls.js'), /id === 'drop'\) call\('drop', input\.ctrlHeld\(\)\)/);
  assert.match(read('content.js'), /createDropBox, createCookpot\]/);
  assert.match(read('content.js'), /drop: all => !!first\('drop', all\)/);
  assert.match(read('settings.js'), /\['Q', 'Drop one item'\], \['Ctrl \+ Q', 'Drop the stack'\]/);
  const game = read('game.js');
  assert.match(game, /drop:all => \{ if \(running && !building\?\.menu\.isOpen\) content\?\.drop\(all\); \}/);
  assert.match(game, /if \(ctrlQ && running\) e\.preventDefault\(\)/);
  assert.match(game, /get sailFlow\(\) \{ return sailFlow; \}/);
});
