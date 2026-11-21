// Unit tests for dist/decor-pickup.js (pick up placed items) and the per-module undecor hooks.
// Run: node --test tests/decor-pickup.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const P = await import(new URL('decor-pickup.js', base));
const { Bag, SLOT_COUNT, TOOL_DURABILITY } = await import(new URL('inventory-state.js', base));
const { GROW_SECONDS, STAGE_SECONDS } = await import(new URL('watering.js', base));
const { createContent } = await import(new URL('content.js', base));
const { createStorage } = await import(new URL('storage-research.js', base));
const { createBees } = await import(new URL('bees.js', base));
const { createEngine } = await import(new URL('engine.js', base));
const { createSleep } = await import(new URL('sleep.js', base));
const { createAnimals } = await import(new URL('animals.js', base));
const { createKiln } = await import(new URL('kiln.js', base));
const { createDecorPack } = await import(new URL('decor-pack.js', base));
const H = await import(new URL('progression-hooks.js', base));

const { UNDECOR_TEXT, decorAt, coreUndecorBlock, normLoot, assembleLoot, tryLoot, clearCoreTile, targetFromAim, hostCanUndecor, tileKey } = P;
const bagWith = (slots, selected = 0) => { const s = new Array(SLOT_COUNT).fill(null); slots.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected }); };
const grid3 = () => Array.from({ length: 9 }, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]);

// 1
test('decorAt / targetFromAim: hit key wins, point maps to round(p/2), empty tile is null', () => {
  const decor = [{ type: 'crate', x: 0, z: 0 }, { type: 'lantern', x: 1, z: 0 }, { type: 'bench', x: -1, z: 1 }];
  assert.equal(decorAt(decor, 1, 0), 1); assert.equal(decorAt(decor, 5, 5), -1); assert.equal(decorAt(null, 0, 0), -1);
  assert.equal(targetFromAim(decor, '1,0', { x: 0, z: 0 }), decor[1], 'hit key beats the aim point');
  assert.equal(targetFromAim(decor, '1,0', null), decor[1], 'cached key path');
  assert.equal(targetFromAim(decor, null, { x: -2.4, z: 1.7 }), decor[2]);
  assert.equal(targetFromAim(decor, null, { x: 0.9, z: -0.9 }), decor[0]);
  assert.equal(targetFromAim(decor, null, { x: 4, z: 4 }), null);
  assert.equal(targetFromAim(decor, '7,7', null), null);
  assert.equal(targetFromAim(decor, 'junk', { x: 2, z: 0 }), decor[1], 'a bad key falls back to the point');
  assert.equal(targetFromAim(decor, null, null), null);
  assert.equal(tileKey(-1, 2), '-1,2');
});

// 2
test('coreUndecorBlock: ripe palm and ready purifier refuse; growing palm, full barrel, crate do not', () => {
  const d = (type) => ({ type, x: 0, z: 0 });
  assert.equal(coreUndecorBlock({ garden: { '0,0': { water: 0, grow: GROW_SECONDS } } }, d('palm')), UNDECOR_TEXT.ripe);
  assert.equal(coreUndecorBlock({ garden: { '0,0': { water: 1, grow: STAGE_SECONDS } } }, d('palm')), null);
  assert.equal(coreUndecorBlock({ garden: {} }, d('palm')), null);
  assert.equal(coreUndecorBlock({ purifiers: { '0,0': { t: 0, ready: true } } }, d('purifier')), UNDECOR_TEXT.water);
  assert.equal(coreUndecorBlock({ purifiers: { '0,0': { t: 3, ready: false } } }, d('purifier')), null);
  assert.equal(coreUndecorBlock({ collectors: { '0,0': { w: 4, f: 0 } } }, d('rainbarrel')), null);
  assert.equal(coreUndecorBlock({}, d('crate')), null);
});

// 3
test('normLoot / assembleLoot: item first, junk dropped, plain duplicates merge, meta stays separate', () => {
  const meta = { durability: 40 };
  const n = normLoot([['wood', 3], ['wood', 2.7], ['nope', 4], ['scrap', 0], ['leaf', -1], 'x', null, ['hook', 1, meta], ['hook', 1, meta], ['hook', 1], ['hook', 1], ['wood', 1, [1]]]);
  assert.deepEqual(n, [['wood', 6], ['hook', 1, { durability: 40 }], ['hook', 1, { durability: 40 }], ['hook', 2]]);
  assert.notEqual(n[1][2], meta, 'meta is copied');
  assert.deepEqual(normLoot(null), []);
  const d = { type: 'crate', x: 0, z: 0 };
  assert.deepEqual(assembleLoot(d), [['crate', 1]]);
  assert.deepEqual(assembleLoot(d, null, [['wood', 2]], undefined, [['wood', 1], ['bad', 1]]), [['crate', 1], ['wood', 3]]);
});

// 4
test('tryLoot: a 12-slot chest that fits keeps durability; a full bag refuses and leaves the snapshot alone', () => {
  const bag = bagWith([{ kind: 'hammer', count: 1, durability: TOOL_DURABILITY }]);
  const slots = [
    { kind: 'wood', count: 20 }, { kind: 'scrap', count: 7 }, { kind: 'hook', count: 1, durability: 12 }, { kind: 'leaf', count: 3 },
    { kind: 'plastic', count: 5 }, { kind: 'fish', count: 2 }, { kind: 'rope', count: 4 }, { kind: 'wood', count: 1 },
    { kind: 'lantern', count: 1 }, { kind: 'cup', count: 2 }, { kind: 'sand', count: 9 }, { kind: 'clay', count: 6 }];
  const loot = assembleLoot({ type: 'crate', x: 0, z: 0 }, slots.map(s => (s.durability !== undefined ? [s.kind, s.count, { durability: s.durability }] : [s.kind, s.count])));
  const snap = bag.snapshot(), r = tryLoot(snap, loot);
  assert.equal(r.ok, true);
  assert.equal(r.scratch.count('crate'), 1); assert.equal(r.scratch.count('wood'), 21); assert.equal(r.scratch.count('clay'), 6);
  assert.ok(r.scratch.slots.some(s => s?.kind === 'hook' && s.durability === 12), 'worn hook comes back worn');
  assert.equal(bag.count('crate'), 0, 'live bag untouched');

  const full = bagWith(Array.from({ length: SLOT_COUNT }, () => ({ kind: 'scrap', count: 20 })));
  const fsnap = full.snapshot(), copy = JSON.parse(JSON.stringify(fsnap));
  const bad = tryLoot(fsnap, [['crate', 1]]);
  assert.equal(bad.ok, false); assert.equal(bad.scratch, null);
  assert.deepEqual(fsnap, copy);
  assert.equal(tryLoot(bag.snapshot(), [['crate', 1], ['notathing', 1]]).ok, false, 'unknown kinds refuse, never vanish');
});

// 5
test('clearCoreTile removes only key k from the four maps', () => {
  const w = { garden: { '0,0': { grow: 1 }, '1,0': { grow: 2 } }, purifiers: { '0,0': { t: 1 } }, collectors: { '0,0': { w: 1 }, '2,0': { w: 1 } }, sprinklers: { '0,0': { w: 0, s: 0 } }, tileHp: { '0,0': 3 } };
  assert.equal(clearCoreTile(w, '0,0'), true);
  assert.deepEqual(w, { garden: { '1,0': { grow: 2 } }, purifiers: {}, collectors: { '2,0': { w: 1 } }, sprinklers: {}, tileHp: { '0,0': 3 } });
  assert.equal(clearCoreTile(w, '0,0'), false);
  assert.equal(clearCoreTile({}, '0,0'), false);
});

// 6
test('module hooks: bees, engine, sleep, animals, kiln, storage, decorpack', () => {
  // bees: comb blocks
  {
    const world = { decor: [{ type: 'beehive', x: 0, z: 0 }], tiles: [[0, 0]] };
    const m = createBees({ T: null, world, role: 'solo', running: true, physics: { x: 0, z: 0 }, emit() {}, notice() {}, action() {} });
    m.load({ v: 1, s: 'x', r: 1, h: { '0,0': { c: 2, t: 0 } } }, 'save');
    const d = world.decor[0];
    assert.equal(m.beforeUndecor(d), 'Collect the honey first');
    m.load({ v: 1, s: 'x', r: 2, h: { '0,0': { c: 0, t: 5 } } }, 'save');
    assert.equal(m.beforeUndecor(d), null);
    const r0 = m.serialize().r; m.afterUndecor(d);
    assert.equal(m.serialize().h['0,0'], undefined); assert.ok(m.serialize().r > r0);
    assert.equal(m.beforeUndecor({ type: 'crate', x: 0, z: 0 }), null);
  }
  // engine: on blocks, fuel alone does not
  {
    const world = { tiles: grid3(), decor: [{ type: 'motor', x: 1, z: 0 }, { type: 'wheel', x: 0, z: 1 }], sailing: {}, ext: {} };
    const m = createEngine({ T: null, world, role: 'solo', running: true, physics: { x: 0, z: 0 }, emit() {}, rebuildRaft() {}, action() {} });
    m.load({ v: 1, motors: { '1,0': { on: true, fuel: 30 } } });
    assert.equal(m.beforeUndecor(world.decor[0]), 'Switch the motor off first');
    m.load({ v: 1, motors: { '1,0': { on: false, fuel: 30 } } });
    assert.equal(m.beforeUndecor(world.decor[0]), null);
    assert.equal(m.beforeUndecor(world.decor[1]), null, 'wheel never refuses');
    m.afterUndecor(world.decor[0]);
    assert.equal(m.serialize().motors['1,0'], undefined);
  }
  // sleep: someone in the bed
  {
    const world = { tiles: grid3(), decor: [{ type: 'bed', x: 1, z: 0 }] };
    const m = createSleep({ T, world, role: 'solo', physics: { x: 2, y: 1.8, z: 1 }, other: null, camera: null, raft: null, deckY: () => .2, uiOpen: () => false, emit() {}, notice() {}, localBag: () => null, action() {} }, { day: () => ({ phase: .8, optOut: false, ready: true }) });
    const d = world.decor[0];
    assert.equal(m.beforeUndecor(d), null);
    m.serialize().in.guest = [1, 0];
    assert.equal(m.beforeUndecor(d), 'Someone is in that bed');
    m.afterUndecor(d); assert.equal(m.serialize().in.guest, null, 'stale seat cleared');
  }
  // animals: a hen home or a lure on the box
  {
    const bag = bagWith([]);
    const ctx = { T, role: 'host', running: true, world: { tiles: grid3(), decor: [{ type: 'nestbox', x: 1, z: 1 }], pieces: [] }, physics: { x: 2, z: 2 }, other: null,
      emit() {}, localBag: () => bag, actorBag: () => bag, action() {}, notice() {}, esc: s => String(s), rebuildRaft() {} };
    const m = createAnimals(ctx), d = ctx.world.decor[0];
    const hen = { id: 'p1', kind: 'puffhen', name: 'Pip', seed: 1, home: [1, 1], born: 0, hearts: 0, content: 0, prod: 0, eggs: 0, feather: 0, bondAt: -1e9, featherAt: -1e9 };
    m.load({ v: 1, r: 1, t: 5, next: 2, list: [hen], lures: [] }, 'save');
    assert.equal(m.beforeUndecor(d), 'Your puffhen lives here');
    m.load({ v: 1, r: 2, t: 5, next: 2, list: [], lures: [{ home: [1, 1], at: 30 }] }, 'save');
    assert.equal(m.beforeUndecor(d), 'Your puffhen lives here');
    m.load({ v: 1, r: 3, t: 5, next: 2, list: [], lures: [] }, 'save');
    assert.equal(m.beforeUndecor(d), null);
  }
  // kiln: firing blocks, an idle tray comes back
  {
    const world = { tiles: [[0, 0], [1, 0]], decor: [{ type: 'kiln', x: 1, z: 0 }], ext: {} };
    const m = createKiln({ T, world, role: 'solo', running: true, physics: { x: 2, z: 0 }, other: null, camera: null, raft: null, esc: s => s, emit() {}, notice() {}, rebuildRaft() {}, action() {} });
    const d = world.decor[0];
    m.debug.fill(1, 0, { r: 'sand', q: 1, h: 1, t: 2, f: 0 });
    assert.equal(m.beforeUndecor(d), 'The kiln is still firing');
    m.debug.fill(1, 0, { o: 'glass', n: 3 });
    assert.equal(m.beforeUndecor(d), null);
    assert.deepEqual(m.undecorLoot(d), [['glass', 3]]);
    m.debug.fill(1, 0, { r: 'sand', q: 2, h: 0, f: 0, o: 'glass', n: 1 });
    assert.deepEqual(m.undecorLoot(d), [['sand', 4], ['glass', 1]], 'queued batches come back as their raw sand');
    m.afterUndecor(d); assert.equal(m.debug.state().k['1,0'], undefined);
  }
  // storage: loot equals the slots, afterUndecor deletes and bumps r
  {
    const world = { tiles: grid3(), decor: [{ type: 'crate', x: 1, z: 0 }], ext: {} };
    const m = createStorage({ T, world, role: 'solo', running: true, physics: { x: 0, z: 0 }, other: null, camera: null, raft: null,
      localBag: () => new Bag(), actorBag: () => new Bag(), emit() {}, notice() {}, rebuildRaft() {}, releaseLock() {}, requestLock() {}, action() {} });
    const d = world.decor[0];
    assert.equal(m.undecorLoot(d), null, 'empty crate: nothing inside');
    m.debug.fill(1, 0, [{ kind: 'wood', count: 4 }, null, { kind: 'hook', count: 1, durability: 9 }]);
    assert.deepEqual(m.undecorLoot(d), [['wood', 4], ['hook', 1, { durability: 9 }]]);
    const r0 = m.debug.state().r; m.afterUndecor(d);
    assert.equal(m.debug.state().chests['1,0'], undefined); assert.ok(m.debug.state().r > r0);
    assert.equal(m.undecorLoot({ type: 'lantern', x: 1, z: 0 }), null);
  }
  // decorpack: sign text and rotation go with the board
  {
    const world = { tiles: grid3(), decor: [{ type: 'sign', x: 0, z: 0 }] };
    const m = createDecorPack({ T: null, world, role: 'solo', physics: { x: 0, z: 0 }, emit() {}, notice() {}, rebuildRaft() {}, action() {} });
    m.load({ v: 1, r: 1, t: { '0,0': ['hi'] }, rot: { '0,0': 1 } }, 'save');
    const r0 = m.serialize().r; m.afterUndecor(world.decor[0]);
    const s = m.serialize(); assert.equal(s.t['0,0'], undefined); assert.equal(s.rot['0,0'], undefined); assert.ok(s.r > r0);
  }
});

test('progression stations: mid-cook refuses, idle returns input + output and forgets the station', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };
  const world = { tiles: [[0, 0]], decor: [{ type: 'smelter', x: 0, z: 0 }], items: [], collected: 1 };
  const bag = new Bag({ slots: Array(SLOT_COUNT).fill(null), selected: 0 });
  const ctx = { T: null, role: () => 'solo', ready: () => false, running: () => false, world: () => world, bag: () => bag, localBag: () => bag, action() {}, emit() {}, notice() {}, pose: () => ({ x: 50, z: 50, yaw: 0 }) };
  store.set(H.PROGRESSION_KEY, JSON.stringify({ v: 1, host: {}, guest: {}, stations: { '0,0': { station: 'smelter', input: { kind: 'metalore', count: 3 }, output: { kind: 'metalingot', count: 2 }, fuel: 4, progress: 5 } } }));
  const a = H.attachProgression(ctx); a.tick(0.016);
  const d = world.decor[0];
  assert.equal(a.beforeUndecor(d, 'host'), "It's still cooking");
  a.dispose();
  store.set(H.PROGRESSION_KEY, JSON.stringify({ v: 1, host: {}, guest: {}, stations: { '0,0': { station: 'smelter', input: { kind: 'metalore', count: 3 }, output: { kind: 'metalingot', count: 2 }, fuel: 0, progress: 0 } } }));
  const b = H.attachProgression(ctx);
  assert.equal(b.beforeUndecor(d, 'host'), null, 'pending (not yet synced) station still answers');
  b.tick(0.016);
  assert.equal(b.beforeUndecor(d, 'host'), null);
  assert.deepEqual(b.undecorLoot(d), [['metalore', 3], ['metalingot', 2]]);
  assert.equal(b.beforeUndecor({ type: 'lantern', x: 0, z: 0 }), null);
  world.decor.length = 0; b.afterUndecor(d, 'host'); b.save();
  assert.equal(JSON.parse(store.get(H.PROGRESSION_KEY)).stations['0,0'], undefined);
  b.dispose();
});

// 7
test('registry: undecorLoot concatenates, beforeUndecor returns the first string, a throwing module is skipped', () => {
  const errs = console.error; console.error = () => {};
  try {
    const boom = () => ({ name: 'boom', beforeUndecor() { throw new Error('x'); }, undecorLoot() { throw new Error('y'); } });
    const a = () => ({ name: 'a', beforeUndecor: () => null, undecorLoot: () => [['wood', 2]] });
    const b = () => ({ name: 'b', beforeUndecor: d => (d.type === 'crate' ? 'busy b' : null), undecorLoot: () => [['scrap', 1, { id: 'q' }]], afterUndecor(d) { this.seen = d; } });
    const c = () => ({ name: 'c', beforeUndecor: () => 'busy c', undecorLoot: () => 'not an array' });
    const reg = createContent({}, [boom, a, b, c]);
    const d = { type: 'crate', x: 0, z: 0 };
    assert.equal(reg.beforeUndecor(d, 'host'), 'busy b');
    assert.equal(reg.beforeUndecor({ type: 'net', x: 0, z: 0 }, 'host'), 'busy c');
    assert.deepEqual(reg.undecorLoot(d), [['wood', 2], ['scrap', 1, { id: 'q' }]]);
    reg.afterUndecor(d, 'host');
    assert.equal(reg.mods.find(m => m.name === 'b').seen, d);
    assert.equal(reg.mods.find(m => m.name === 'boom').dead, true);
  } finally { console.error = errs; }
});

// 8
test('round trip: place a crate, fill it from the bag, pick it up -> the bag counts are back', () => {
  const B = bagWith([{ kind: 'hammer', count: 1, durability: TOOL_DURABILITY }, { kind: 'crate', count: 1 }, { kind: 'wood', count: 13 }, { kind: 'scrap', count: 4 }, { kind: 'hook', count: 1, durability: 33 }]);
  const before = B.counts(), bag = new Bag(B.snapshot());
  assert.ok(bag.remove('crate', 1)); // placed
  const chest = [];
  for (const k of ['wood', 'scrap', 'hook']) { const s = bag.slots.find(x => x?.kind === k); chest.push({ ...s }); bag.slots[bag.slots.indexOf(s)] = null; }
  const world = { tiles: grid3(), decor: [{ type: 'crate', x: 0, z: 0 }], ext: {} };
  const m = createStorage({ T, world, role: 'solo', running: true, physics: { x: 0, z: 0 }, other: null, camera: null, raft: null, localBag: () => bag, actorBag: () => bag, emit() {}, notice() {}, rebuildRaft() {}, releaseLock() {}, requestLock() {}, action() {} });
  m.debug.fill(0, 0, chest);
  const r = tryLoot(bag.snapshot(), assembleLoot(world.decor[0], m.undecorLoot(world.decor[0])));
  assert.equal(r.ok, true);
  assert.deepEqual(r.scratch.counts(), before);
  assert.ok(r.scratch.slots.some(s => s?.kind === 'hook' && s.durability === 33));
});

// 9
test('hostCanUndecor reads top-level caps', () => {
  assert.equal(hostCanUndecor({ caps: { undecor: 1 } }), true);
  assert.equal(hostCanUndecor({}), false);
  assert.equal(hostCanUndecor(undefined), false);
  assert.equal(hostCanUndecor({ caps: null }), false);
});

// Review fixes
test('purifier still purifying: its sea-water cup comes back with the purifier', () => {
  const d = { type: 'purifier', x: 2, z: 0 };
  const w = { purifiers: { '2,0': { t: 5, ready: 0 } } };
  assert.equal(coreUndecorBlock(w, d), null);
  assert.deepEqual(P.coreUndecorLoot(w, d), [['saltcup', 1]]);
  assert.deepEqual(assembleLoot(d, P.coreUndecorLoot(w, d)), [['purifier', 1], ['saltcup', 1]]);
  assert.equal(P.coreUndecorLoot({ purifiers: {} }, d), null, 'empty purifier: just the item');
  assert.equal(P.coreUndecorLoot({ purifiers: { '2,0': { t: 15, ready: 1 } } }, d), null, 'ready is vetoed instead');
  assert.equal(P.coreUndecorLoot(w, { type: 'crate', x: 2, z: 0 }), null);
});

test('game wiring: stale aims at a re-placed item are ignored, and context prompts hide while X is held', async () => {
  const { readFile } = await import('node:fs/promises');
  const g = await readFile(new URL('game.js', base), 'utf8'), pr = await readFile(new URL('prompts.js', base), 'utf8');
  assert.match(g, /undecorAct = \{kind:'undecor', x:d\.x, z:d\.z, t:d\.type\}/);
  assert.match(g, /a\.t !== undefined && a\.t !== world\.decor\[i\]\.type\)\) return;/);
  assert.match(g, /coreUndecorLoot\(world, d\)\), r = tryLoot/);
  assert.match(g, /if \(running && !dialog && !building\?\.removing\)/);
  assert.match(g, /get removing\(\) \{ return !!building\?\.removing; \}/);
  assert.match(pr, /!blocked && !state\?\.build\?\.removing/);
});
