// Unit tests for the storage chest + Research Table content module (pure logic, no DOM).
// Run: node --test tests/storage-research.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { Bag, RECIPES, SLOT_COUNT, TOOL_DURABILITY } = await import(new URL('inventory-state.js', base));
const SR = await import(new URL('storage-research.js', base));
// The tree tests below were written for the pre-progression recipe set; recipes the progression
// catalogue added (nail, bolt, stations, ...) are owned by items.js unlocks, as game.js wires it.
const TABLE_TREE = new Set(['rope', 'hook', 'hammer', 'fishingrod', 'sail', 'palm', 'lantern', 'net', 'bench', 'crate', 'research', 'receiver', 'antenna', 'cup', 'purifier']);
SR.setOwnedElsewhere(id => !TABLE_TREE.has(id));
const { cleanSlice, cleanSlot, isProgressed, learnedFrom, moveStack, putAll, applyStorageAction, stateFrom, sliceOf,
  researchableKinds, ingredientKinds, createStorage, STARTER, CHEST_SLOTS, LOCK_REASON } = SR;

// ---------------------------------------------------------------- helpers
const freshWorld = () => ({ tiles: Array.from({ length: 9 }, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]), decor: [], stock: { wood: 0, leaf: 0, scrap: 0, plastic: 0 },
  fish: 0, collected: 0, items: [], hostInventory: new Bag().snapshot(), guestInventory: new Bag().snapshot(), ext: {} });
const bagFrom = (slots) => { const s = new Array(SLOT_COUNT).fill(null); slots.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected: 0 }); };
const allRecipes = Object.keys(RECIPES);
const nonStarter = allRecipes.filter(id => !STARTER.includes(id) && TABLE_TREE.has(id)); // see setOwnedElsewhere below
// Recipe ids that existed before the content packs; later content recipes join the tree by cost, so compare against these only.
const ORIG = new Set(['rope', 'hook', 'hammer', 'fishingrod', 'sail', 'palm', 'lantern', 'net', 'bench', 'crate', 'research', 'receiver', 'antenna', 'cup', 'purifier']);
const orig = a => a.filter(id => ORIG.has(id));
const ORIG_NAMES = new Set([...ORIG].map(id => `New recipe: ${RECIPES[id]?.name}!`));
const env = (decor, pos = null) => ({ decorAt: (x, z) => decor.find(d => d.x === x && d.z === z)?.type ?? null, pos: () => pos });
const total = (...arrs) => { const out = {}; for (const a of arrs) for (const s of a) if (s) out[s.kind] = (out[s.kind] ?? 0) + s.count; return out; };
const emptyState = () => stateFrom({ v: 1, chests: {}, seen: [], learned: [], r: 0 }, 'save', freshWorld());
const crate = [{ type: 'crate', x: 1, z: 0 }, { type: 'research', x: 0, z: 1 }];

function makeCtx(world, role = 'solo') {
  const emits = [], bags = { host: new Bag(), guest: new Bag() };
  const ctx = { T, world, role, running: true, physics: { x: 0, z: 0 }, other: null, camera: null, raft: null,
    localBag: () => bags.host, actorBag: a => bags[a], emit: (e, to) => emits.push({ e, to }), notice() {}, rebuildRaft() {}, releaseLock() {}, requestLock() {} };
  ctx.action = a => mod.action(a, 'host', bags.host);
  const mod = createStorage(ctx);
  return { ctx, mod, emits, bags };
}

// ---------------------------------------------------------------- slice validation
test('cleanSlice: junk becomes a valid empty slice and never throws', () => {
  for (const junk of [undefined, null, 5, 'x', [], [1, 2], { chests: 'no' }, { chests: [] }, { chests: { 'a,b': [] } }, { seen: 7, learned: {} }, { r: -3 }, { r: 1.5 }]) {
    const c = cleanSlice(junk);
    assert.deepEqual(c.chests, {});
    assert.ok(c.seen === null || Array.isArray(c.seen));
    assert.ok(Number.isInteger(c.r) && c.r >= 0);
  }
});

test('cleanSlice: slots go through Bag rules, tools gain durability, arrays pad/trim to 12', () => {
  const c = cleanSlice({ chests: {
    '1,0': [{ kind: 'wood', count: 5 }, { kind: 'nope', count: 1 }, { kind: 'wood', count: 99 }, { kind: 'hammer', count: 1 }, 'x', null],
    '2,0': new Array(30).fill({ kind: 'leaf', count: 1 }),
    '3,0': [null, null],             // all empty -> dropped
    '99,0': [{ kind: 'wood', count: 1 }], // off the map -> dropped
  } });
  const a = c.chests['1,0'];
  assert.equal(a.length, CHEST_SLOTS);
  assert.deepEqual(a[0], { kind: 'wood', count: 5 });
  assert.equal(a[1], null); assert.equal(a[2], null); assert.equal(a[4], null);
  assert.deepEqual(a[3], { kind: 'hammer', count: 1, durability: TOOL_DURABILITY });
  assert.equal(c.chests['2,0'].length, CHEST_SLOTS);
  assert.ok(!('3,0' in c.chests)); assert.ok(!('99,0' in c.chests));
  assert.equal(cleanSlot({ kind: 'fish', count: 1, durability: 5 }), null);
});

test('cleanSlice: a JSON round trip is stable', () => {
  const st = stateFrom({ chests: { '1,0': [{ kind: 'wood', count: 3 }, { kind: 'hook', count: 1, durability: 40 }] }, seen: ['wood', 'leaf'], learned: ['bench'], r: 9 }, 'save', freshWorld());
  const once = sliceOf(st), twice = sliceOf(stateFrom(JSON.parse(JSON.stringify(once)), 'save', freshWorld()));
  assert.deepEqual(twice, once);
  assert.deepEqual(orig(once.learned), ['bench', 'palm']); // recomputed from seen
});

test('cleanSlice: caps the number of chests at 400', () => {
  const chests = {};
  for (let x = -25; x <= 25; x++) for (let z = -25; z <= 25; z++) chests[x + ',' + z] = [{ kind: 'wood', count: 1 }];
  assert.equal(Object.keys(cleanSlice({ chests }).chests).length, 400);
});

// ---------------------------------------------------------------- backward compatibility
test('old saves: progressed worlds learn everything, brand-new worlds get STARTER only', () => {
  const progressed = [
    w => { w.tiles.push([2, 0]); },
    w => { w.decor.push({ type: 'crate', x: 0, z: 0 }); },
    w => { w.collected = 1; },
    w => { w.fish = 2; },
    w => { w.hostInventory = bagFrom([{ kind: 'hook', count: 1 }, { kind: 'sail', count: 1 }]).snapshot(); },
    w => { w.guestInventory = bagFrom([{ kind: 'lantern', count: 1 }]).snapshot(); },
    w => { w.hostInventory = null; w.stock = { wood: 12, leaf: 0, scrap: 0, plastic: 0 }; }, // legacy stock save
  ];
  for (const f of progressed) {
    const w = freshWorld(); f(w);
    assert.equal(isProgressed(w), true);
    const st = stateFrom(undefined, 'save', w);
    assert.equal(st.legacy, true);
    for (const id of allRecipes) assert.ok(SR.isLearned(st, id), id);
    assert.deepEqual(st.seen, ingredientKinds());
    assert.deepEqual(researchableKinds(st), []);
  }
  const fresh = stateFrom(undefined, 'save', freshWorld());
  assert.equal(isProgressed(freshWorld()), false);
  assert.equal(fresh.legacy, false);
  assert.deepEqual(fresh.learned, []);
  assert.deepEqual(SR.lockedRecipes(fresh).sort(), nonStarter.sort());
  // untouched legacy stock kit is not progressed
  const kit = freshWorld(); kit.hostInventory = null; kit.stock = { wood: 5, leaf: 3, scrap: 1, plastic: 0 };
  assert.equal(isProgressed(kit), false);
});

test('old saves: a bad learned list also falls back to the progressed rule; net undefined locks nothing', () => {
  const w = freshWorld(); w.tiles.push([2, 0]);
  const st = stateFrom({ chests: { '1,0': [{ kind: 'wood', count: 2 }] }, learned: 'garbage', seen: [3] }, 'save', w);
  assert.equal(st.legacy, true);
  assert.deepEqual(st.chests['1,0'][0], { kind: 'wood', count: 2 });
  for (const id of allRecipes) assert.ok(SR.isLearned(st, id));
  const net = stateFrom(undefined, 'net', freshWorld());
  for (const id of allRecipes) assert.ok(SR.isLearned(net, id));
  // a saved slice is never grandfathered again
  const saved = stateFrom({ v: 1, chests: {}, seen: [], learned: [], r: 3 }, 'save', w);
  assert.equal(saved.legacy, false); assert.deepEqual(saved.learned, []);
});

test('module: load(undefined,"save") on an old progressed world learns all; garbage load never throws', () => {
  const w = freshWorld(); w.decor.push({ type: 'crate', x: 1, z: 0 });
  const { mod } = makeCtx(w);
  mod.load(undefined, 'save');
  for (const id of allRecipes) assert.equal(mod.craftLocked(id, 'host'), null);
  assert.equal(mod.serialize().legacy, true);
  for (const g of [null, 42, 'x', [], { chests: { '1,0': 'bad' }, seen: {}, learned: [null] }, { r: 'x' }]) {
    for (const from of ['save', 'net', 'restore']) assert.doesNotThrow(() => mod.load(g, from));
  }
  // learned ids that are not recipes are kept and ignored
  mod.load({ v: 1, chests: {}, seen: [], learned: ['bench', 'flyingcarpet'], r: 1 }, 'save');
  assert.deepEqual(mod.serialize().learned, ['bench', 'flyingcarpet']);
  assert.equal(mod.craftLocked('bench'), null);
  assert.equal(mod.craftLocked('lantern'), LOCK_REASON);
});

// ---------------------------------------------------------------- put / take
test('put merges into partial stacks first, then empty slots; a full chest moves nothing', () => {
  const st = emptyState();
  st.chests['1,0'] = [null, { kind: 'wood', count: 15 }, ...new Array(10).fill(null)];
  const bag = bagFrom([null, null, null, null, null, null, null, null, { kind: 'wood', count: 12 }]);
  const r = applyStorageAction(st, { kind: 'storage.put', x: 1, z: 0, from: 8, expect: { kind: 'wood', count: 12 } }, 'host', bag, env(crate));
  assert.equal(r.ok, true); assert.equal(r.moved, 12);
  assert.deepEqual(st.chests['1,0'][1], { kind: 'wood', count: 20 });
  assert.deepEqual(st.chests['1,0'][0], { kind: 'wood', count: 7 });
  assert.equal(bag.slots[8], null);
  // full chest
  st.chests['1,0'] = new Array(CHEST_SLOTS).fill(0).map(() => ({ kind: 'leaf', count: 20 }));
  const b2 = bagFrom([{ kind: 'wood', count: 3 }]);
  const before = JSON.stringify([st.chests, b2.slots]), r0 = st.r;
  const r2 = applyStorageAction(st, { kind: 'storage.put', x: 1, z: 0, from: 0, expect: { kind: 'wood', count: 3 } }, 'host', b2, env(crate));
  assert.equal(r2.ok, false); assert.equal(r2.reason, 'chestFull');
  assert.equal(JSON.stringify([st.chests, b2.slots]), before); assert.equal(st.r, r0);
});

test('take with amount, half stacks and target slot; durability travels with tools', () => {
  const st = emptyState();
  st.chests['1,0'] = [{ kind: 'wood', count: 9 }, { kind: 'hammer', count: 1, durability: 37 }, ...new Array(10).fill(null)];
  const bag = bagFrom([{ kind: 'hook', count: 1, durability: 100 }]);
  let r = applyStorageAction(st, { kind: 'storage.take', x: 1, z: 0, from: 0, amount: 5, to: 10, expect: { kind: 'wood', count: 9 } }, 'host', bag, env(crate));
  assert.equal(r.moved, 5);
  assert.deepEqual(bag.slots[10], { kind: 'wood', count: 5 });
  assert.deepEqual(st.chests['1,0'][0], { kind: 'wood', count: 4 });
  r = applyStorageAction(st, { kind: 'storage.take', x: 1, z: 0, from: 1, expect: { kind: 'hammer', count: 1 } }, 'host', bag, env(crate));
  assert.equal(r.ok, true);
  assert.deepEqual(bag.slots.find(s => s?.kind === 'hammer'), { kind: 'hammer', count: 1, durability: 37 });
  // a tool cannot be merged into an occupied target
  st.chests['1,0'][2] = { kind: 'hook', count: 1, durability: 50 };
  r = applyStorageAction(st, { kind: 'storage.take', x: 1, z: 0, from: 2, to: 0, expect: { kind: 'hook', count: 1 } }, 'host', bag, env(crate));
  assert.equal(r.ok, false);
  // taking the last item drops the empty chest from the slice
  const st2 = emptyState(); st2.chests['1,0'] = [{ kind: 'leaf', count: 1 }, ...new Array(11).fill(null)];
  applyStorageAction(st2, { kind: 'storage.take', x: 1, z: 0, from: 0, expect: { kind: 'leaf', count: 1 } }, 'host', new Bag(), env(crate));
  assert.ok(!('1,0' in st2.chests));
});

test('refusals leave everything unchanged: expect mismatch, bad slots, bad x, missing crate, out of reach', () => {
  const st = emptyState();
  st.chests['1,0'] = [{ kind: 'wood', count: 4 }, ...new Array(11).fill(null)];
  st.chests['5,5'] = [{ kind: 'scrap', count: 2 }, ...new Array(11).fill(null)]; // orphan: no crate there
  const bag = bagFrom([{ kind: 'wood', count: 3 }]);
  const cases = [
    [{ kind: 'storage.put', x: 1, z: 0, from: 0, expect: { kind: 'wood', count: 2 } }, 'expect'],
    [{ kind: 'storage.put', x: 1, z: 0, from: 0 }, 'expect'],
    [{ kind: 'storage.put', x: 1, z: 0, from: 28, expect: { kind: 'wood', count: 3 } }, 'bad'],
    [{ kind: 'storage.put', x: 1, z: 0, from: 0, to: 12, expect: { kind: 'wood', count: 3 } }, 'bad'],
    [{ kind: 'storage.put', x: 1, z: 0, from: 0, amount: 4, expect: { kind: 'wood', count: 3 } }, 'bad'],
    [{ kind: 'storage.put', x: 1, z: 0, from: 0, amount: 0.5, expect: { kind: 'wood', count: 3 } }, 'bad'],
    [{ kind: 'storage.take', x: 1, z: 0, from: -1, expect: { kind: 'wood', count: 4 } }, 'bad'],
    [{ kind: 'storage.take', x: 1, z: 0, from: 5, expect: { kind: 'wood', count: 4 } }, 'empty'],
    [{ kind: 'storage.take', x: 1.5, z: 0, from: 0, expect: { kind: 'wood', count: 4 } }, 'bad'],
    [{ kind: 'storage.take', x: '1', z: 0, from: 0, expect: { kind: 'wood', count: 4 } }, 'bad'],
    [{ kind: 'storage.take', x: 5, z: 5, from: 0, expect: { kind: 'scrap', count: 2 } }, 'missing'],
    [{ kind: 'storage.take', x: 0, z: 1, from: 0, expect: { kind: 'wood', count: 4 } }, 'missing'], // a research table is not a chest
    [{ kind: 'storage.fly', x: 1, z: 0 }, 'bad'],
  ];
  for (const [a, reason] of cases) {
    const before = JSON.stringify([st, bag.slots]);
    const r = applyStorageAction(st, a, 'guest', bag, env(crate, { x: 1, z: 0.5 }));
    assert.equal(r.ok, false, JSON.stringify(a)); assert.equal(r.reason, reason, JSON.stringify(a));
    assert.equal(JSON.stringify([st, bag.slots]), before);
  }
  const far = applyStorageAction(st, { kind: 'storage.take', x: 1, z: 0, from: 0, expect: { kind: 'wood', count: 4 } }, 'guest', bag, env(crate, { x: 9, z: 9 }));
  assert.equal(far.reason, 'reach');
  const near = applyStorageAction(st, { kind: 'storage.take', x: 1, z: 0, from: 0, expect: { kind: 'wood', count: 4 } }, 'guest', bag, env(crate, { x: 2.5, z: 0.5 }));
  assert.equal(near.ok, true);
});

test('two players clicking the same stack: exactly one gets it', () => {
  const st = emptyState();
  st.chests['1,0'] = [{ kind: 'scrap', count: 6 }, ...new Array(11).fill(null)];
  const host = new Bag(), guest = new Bag();
  const a = { kind: 'storage.take', x: 1, z: 0, from: 0, expect: { kind: 'scrap', count: 6 } };
  const r1 = applyStorageAction(st, { ...a }, 'host', host, env(crate));
  const r2 = applyStorageAction(st, { ...a }, 'guest', guest, env(crate, { x: 2, z: 0 }));
  assert.equal(r1.ok, true); assert.equal(r2.ok, false);
  assert.equal(host.count('scrap') + guest.count('scrap'), 6);
});

test('putAll stores every backpack stack but leaves the hotbar (slots 0-9) alone', () => {
  const st = emptyState();
  const bag = bagFrom([{ kind: 'hook', count: 1 }, { kind: 'wood', count: 2 }]);
  bag.slots[10] = { kind: 'wood', count: 4 }; bag.slots[20] = { kind: 'leaf', count: 7 }; bag.slots[27] = { kind: 'hammer', count: 1, durability: 80 };
  const r = applyStorageAction(st, { kind: 'storage.putAll', x: 1, z: 0 }, 'host', bag, env(crate));
  assert.equal(r.ok, true); assert.equal(r.moved, 12);
  assert.deepEqual(bag.slots.slice(10).filter(Boolean), []);
  assert.equal(bag.slots[1].count, 2);
  assert.deepEqual(total(st.chests['1,0']), { wood: 4, leaf: 7, hammer: 1 });
  const again = applyStorageAction(st, { kind: 'storage.putAll', x: 1, z: 0 }, 'host', bag, env(crate));
  assert.equal(again.reason, 'nothingToPut');
});

test('conservation: 500 random put/take/putAll actions never create or lose an item', () => {
  let seed = 12345; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const kinds = ['wood', 'leaf', 'scrap', 'plastic', 'rope', 'hammer', 'hook'];
  const st = emptyState();
  const bags = { host: new Bag(), guest: new Bag() };
  for (const b of Object.values(bags)) for (let i = 0; i < 18; i++) { const k = kinds[rnd(kinds.length)]; b.add(k, k === 'hammer' || k === 'hook' ? 1 : 1 + rnd(20)); }
  const sum = () => total(bags.host.slots, bags.guest.slots, ...Object.values(st.chests));
  const start = sum();
  const crates = [{ type: 'crate', x: 1, z: 0 }, { type: 'crate', x: -1, z: 0 }];
  for (let n = 0; n < 500; n++) {
    const actor = rnd(2) ? 'host' : 'guest', bag = bags[actor], c = crates[rnd(2)], verb = ['put', 'take', 'putAll'][rnd(3)];
    const chest = st.chests[c.x + ',' + c.z] ?? [];
    const a = { kind: 'storage.' + verb, x: c.x, z: c.z };
    if (verb !== 'putAll') {
      a.from = rnd(verb === 'put' ? SLOT_COUNT : CHEST_SLOTS);
      const s = verb === 'put' ? bag.slots[a.from] : chest[a.from];
      if (s) a.expect = rnd(10) ? { kind: s.kind, count: s.count } : { kind: s.kind, count: s.count + 1 };
      if (rnd(3) === 0) a.to = rnd(verb === 'put' ? CHEST_SLOTS : SLOT_COUNT);
      if (s && rnd(3) === 0) a.amount = 1 + rnd(s.count);
    }
    applyStorageAction(st, a, actor, bag, env(crates, { x: 0, z: 0 }));
    // every stack stays valid by Bag rules
    for (const b of Object.values(bags)) assert.doesNotThrow(() => new Bag(b.snapshot()));
    for (const ch of Object.values(st.chests)) { assert.equal(ch.length, CHEST_SLOTS); for (const s of ch) if (s) assert.deepEqual(cleanSlot(s), s); }
  }
  assert.deepEqual(sum(), start);
});

// ---------------------------------------------------------------- research
test('research: wood unlocks bench, then scrap unlocks lantern; repeats and non-ingredients are refused', () => {
  const st = emptyState();
  const bag = bagFrom([{ kind: 'hook', count: 1 }, { kind: 'wood', count: 3 }, { kind: 'scrap', count: 1 }]);
  const research = (slot, kind) => applyStorageAction(st, { kind: 'storage.research', x: 0, z: 1, slot, expect: { kind } }, 'host', bag, env(crate));
  let r = research(1, 'wood');
  assert.equal(r.ok, true); assert.deepEqual(orig(r.learned), ['bench']);
  assert.equal(bag.count('wood'), 2);
  r = research(2, 'scrap');
  assert.deepEqual(orig(r.learned), ['lantern']); assert.equal(bag.slots[2], null);
  const before = JSON.stringify([st, bag.slots]);
  assert.equal(research(1, 'wood').reason, 'nothing');   // already researched
  assert.equal(research(0, 'hook').reason, 'nothing');   // not an ingredient of a locked recipe
  assert.equal(research(1, 'leaf').reason, 'expect');    // expect mismatch
  assert.equal(applyStorageAction(st, { kind: 'storage.research', x: 1, z: 0, slot: 1, expect: { kind: 'wood' } }, 'host', bag, env(crate)).reason, 'missing'); // a crate is not a table
  assert.equal(JSON.stringify([st, bag.slots]), before);
});

test('research: recipes join the tree from their cost alone (learnedFrom)', () => {
  assert.deepEqual(learnedFrom(['wood']), ['bench']);
  assert.deepEqual(learnedFrom(['wood', 'leaf']), ['bench', 'palm']);
  assert.deepEqual(learnedFrom(['wood', 'rope']), ['bench', 'fishingrod']); // net also needs nails since the progression rebalance
  assert.deepEqual(learnedFrom(['wood', 'rope', 'nail']), ['bench', 'fishingrod', 'net']);
  assert.deepEqual(learnedFrom(['wood', 'rope', 'leaf']), ['bench', 'fishingrod', 'palm', 'sail']);
  assert.deepEqual(learnedFrom(['leaf'], ['lantern']), ['lantern']);
});

test('module: research emits one notice per new recipe to everyone; craftLocked follows', () => {
  const w = freshWorld(); w.decor.push({ type: 'research', x: 0, z: 1 });
  const { mod, emits, bags } = makeCtx(w);
  mod.load({ v: 1, chests: {}, seen: [], learned: [], r: 0 }, 'save');
  assert.equal(mod.craftLocked('sail', 'host'), LOCK_REASON);
  assert.equal(mod.craftLocked('rope', 'host'), null);
  assert.equal(mod.craftLocked('research', 'host'), null);
  assert.equal(mod.craftLocked('not-a-recipe', 'host'), null);
  bags.host.add('wood', 2); bags.host.add('rope', 1); bags.host.add('leaf', 1);
  const slotOf = k => bags.host.slots.findIndex(s => s?.kind === k);
  assert.equal(mod.action({ kind: 'storage.research', x: 0, z: 1, slot: slotOf('rope'), expect: { kind: 'rope' } }, 'host', bags.host), true);
  const own = emits.filter(e => !/^New recipe: /.test(e.e.text)); // a later content recipe may need rope alone
  assert.equal(own.length, 1); // "Researched Rope!" only to the actor
  assert.equal(own[0].to, 'host');
  assert.ok(!emits.some(e => ORIG_NAMES.has(e.e.text))); // no original recipe needs rope alone
  emits.length = 0;
  mod.action({ kind: 'storage.research', x: 0, z: 1, slot: slotOf('wood'), expect: { kind: 'wood' } }, 'host', bags.host);
  assert.deepEqual(emits.map(e => e.e.text).sort(), ['New recipe: Bench!', 'New recipe: Fishing Rod!']); // net also needs nails now
  assert.ok(emits.every(e => e.to === 'all'));
  assert.equal(mod.craftLocked('fishingrod'), null);
  assert.equal(mod.craftLocked('net'), LOCK_REASON);
  assert.equal(mod.craftLocked('sail'), LOCK_REASON);
  emits.length = 0;
  mod.action({ kind: 'storage.research', x: 0, z: 1, slot: slotOf('wood'), expect: { kind: 'wood' } }, 'host', bags.host);
  assert.equal(emits[0].e.text, 'That doesn’t teach anything new');
  assert.equal(mod.action({ kind: 'craft', recipe: 'x' }, 'host', bags.host), false); // not ours
});

test('module: orphan chests survive serialize/load and are hidden from prompts and actions', () => {
  const w = freshWorld();
  const { mod, bags } = makeCtx(w);
  mod.load({ v: 1, chests: { '1,1': [{ kind: 'wood', count: 5 }] }, seen: [], learned: [], r: 2 }, 'save');
  assert.equal(mod.prompt(null), null);
  mod.action({ kind: 'storage.take', x: 1, z: 1, from: 0, expect: { kind: 'wood', count: 5 } }, 'host', bags.host);
  assert.deepEqual(mod.serialize().chests['1,1'][0], { kind: 'wood', count: 5 });
  assert.equal(bags.host.count('wood'), 0);
  w.decor.push({ type: 'crate', x: 1, z: 1 }); // placing a crate there shows it again
  mod.action({ kind: 'storage.take', x: 1, z: 1, from: 0, expect: { kind: 'wood', count: 5 } }, 'host', bags.host);
  assert.equal(bags.host.count('wood'), 5);
});

test('module: serialize returns the same object until something changes; net load is idempotent', () => {
  const w = freshWorld(); w.decor.push({ type: 'crate', x: 1, z: 0 });
  const { mod, bags } = makeCtx(w);
  mod.load(undefined, 'save');
  const a = mod.serialize();
  assert.equal(mod.serialize(), a);
  bags.host.slots[9] = { kind: 'wood', count: 3 };
  mod.action({ kind: 'storage.put', x: 1, z: 0, from: 9, expect: { kind: 'wood', count: 3 } }, 'host', bags.host);
  const b = mod.serialize();
  assert.notEqual(b, a); assert.ok(b.r > a.r);
  assert.equal(mod.serialize(), b);
  // guest side
  const g = makeCtx(freshWorld(), 'guest');
  g.mod.load(b, 'net');
  const seen1 = g.mod.debug.state();
  g.mod.load(b, 'net'); g.mod.load(JSON.parse(JSON.stringify(b)), 'net');
  assert.deepEqual(g.mod.debug.state(), seen1);
  assert.deepEqual(seen1.chests['1,0'][0], { kind: 'wood', count: 3 });
  g.mod.load(undefined, 'net');
  for (const id of allRecipes) assert.equal(g.mod.craftLocked(id), null);
});

test('decorModel: research table geometry and materials are built once and shared', () => {
  const { mod } = makeCtx(freshWorld());
  const a = mod.decorModel('research'), b = mod.decorModel('research');
  assert.ok(a && b && a !== b);
  const meshes = o => { const out = []; o.traverse(c => { if (c.isMesh) out.push(c); }); return out; };
  const ma = meshes(a), mb = meshes(b);
  assert.equal(ma.length, mb.length);
  ma.forEach((m, i) => { assert.equal(m.geometry, mb[i].geometry); assert.equal(m.material, mb[i].material); });
  ma[0].geometry.dispose(); ma[0].material.dispose(); // rebuildRaft's dispose must not free shared resources
  assert.ok(ma[0].geometry.attributes.position.count > 100);
  assert.equal(mod.decorModel('crate'), null);
  assert.doesNotThrow(() => mod.dispose());
});

// ---------------------------------------------------------------- review fixes
const lookAt = ctx => { ctx.camera = { position: { x: 0, y: 0.65, z: 0 }, getWorldDirection: v => v.set(1, 0, 0) }; };

test('guest aboard an old host (no slice): friendly notice instead of a dead panel, no rebuild per state message', () => {
  const w = freshWorld(); w.decor.push({ type: 'crate', x: 1, z: 0 });
  const g = makeCtx(w, 'guest'); lookAt(g.ctx);
  const notes = []; g.ctx.notice = s => notes.push(s);
  assert.match(g.mod.prompt(null), /Open crate/); // before any host state: normal prompt
  g.mod.load(undefined, 'net');
  const rev = g.mod.debug.rev();
  for (let i = 0; i < 20; i++) g.mod.load(undefined, 'net'); // 8 Hz state messages
  assert.equal(g.mod.debug.rev(), rev);
  assert.equal(g.mod.prompt(null), SR.OLD_HOST);
  assert.match(SR.OLD_HOST, /doesn.t have chests yet/);
  assert.equal(g.mod.interact(null), true);
  assert.deepEqual(notes, [SR.OLD_HOST]);
  assert.equal(g.mod.debug.state().open, null);
  assert.equal(g.mod.debug.openChest(2, 0), false); // a guest never pushes decor
  assert.ok(!w.decor.some(d => d.x === 2));
  // the host updates: a real slice brings chests back
  g.mod.load({ v: 1, chests: {}, seen: [], learned: [], r: 1, s: 'abc' }, 'net');
  assert.ok(g.mod.debug.rev() > rev);
  assert.match(g.mod.prompt(null), /Open crate/);
  // the host itself never shows the old-host notice
  const h = makeCtx(w, 'host'); lookAt(h.ctx); h.mod.load(undefined, 'save');
  assert.match(h.mod.prompt(null), /Open crate/);
});

test('guest with no known pose is refused with reach; host without physics is not', () => {
  const st = emptyState();
  st.chests['1,0'] = [{ kind: 'wood', count: 4 }, ...new Array(11).fill(null)];
  const a = { kind: 'storage.take', x: 1, z: 0, from: 0, expect: { kind: 'wood', count: 4 } };
  const bag = new Bag(), before = JSON.stringify([st, bag.slots]);
  assert.equal(applyStorageAction(st, { ...a }, 'guest', bag, env(crate)).reason, 'reach');
  assert.equal(JSON.stringify([st, bag.slots]), before);
  // through the module: ctx.other is null until the guest's first pose arrives
  const w = freshWorld(); w.decor.push({ type: 'crate', x: 1, z: 0 });
  const { ctx, mod, emits, bags } = makeCtx(w, 'host');
  mod.load({ v: 1, chests: { '1,0': [{ kind: 'wood', count: 4 }] }, seen: [], learned: [], r: 0 }, 'save');
  emits.length = 0;
  mod.action({ ...a }, 'guest', bags.guest);
  assert.equal(bags.guest.count('wood'), 0);
  assert.equal(emits[0].e.text, 'Step a little closer'); assert.equal(emits[0].to, 'guest');
  ctx.other = { x: 2, z: 0 };
  mod.action({ ...a }, 'guest', bags.guest);
  assert.equal(bags.guest.count('wood'), 4);
  ctx.physics = null; // the host is never refused for a missing pose
  assert.equal(applyStorageAction(st, { ...a }, 'host', new Bag(), { decorAt: () => 'crate', pos: () => null }).ok, true);
});

test('put and putAll are refused when the slice would grow past MAX_SLICE_CHARS; take still works', () => {
  const chests = {};
  const full = () => Array.from({ length: CHEST_SLOTS }, () => ({ kind: 'hammer', count: 1, durability: 37 }));
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) if (Object.keys(chests).length < 330 && !(x === 1 && z === 0)) chests[x + ',' + z] = full();
  const st = stateFrom({ v: 1, chests, seen: [], learned: [], r: 0 }, 'save', freshWorld());
  assert.ok(SR.sliceChars(st, '1,0', null) > SR.MAX_SLICE_CHARS);
  const anyCrate = { decorAt: () => 'crate', pos: () => null };
  const bag = bagFrom([{ kind: 'wood', count: 3 }]); bag.slots[10] = { kind: 'leaf', count: 2 };
  const before = JSON.stringify([st, bag.slots]);
  const r1 = applyStorageAction(st, { kind: 'storage.put', x: 1, z: 0, from: 0, expect: { kind: 'wood', count: 3 } }, 'host', bag, anyCrate);
  const r2 = applyStorageAction(st, { kind: 'storage.putAll', x: 1, z: 0 }, 'host', bag, anyCrate);
  assert.equal(r1.reason, 'tooBig'); assert.equal(r2.reason, 'tooBig');
  assert.equal(JSON.stringify([st, bag.slots]), before);
  const t = applyStorageAction(st, { kind: 'storage.take', x: -20, z: -20, from: 0, expect: { kind: 'hammer', count: 1 } }, 'host', bag, anyCrate);
  assert.equal(t.ok, true);
  // the module shows a friendly notice and keeps the item in the bag
  const w = freshWorld(); w.decor.push({ type: 'crate', x: 1, z: 0 });
  const { mod, emits, bags } = makeCtx(w);
  mod.load(sliceOf(st), 'save');
  bags.host.slots[9] = { kind: 'wood', count: 2 }; emits.length = 0;
  mod.action({ kind: 'storage.put', x: 1, z: 0, from: 9, expect: { kind: 'wood', count: 2 } }, 'host', bags.host);
  assert.equal(bags.host.count('wood'), 2);
  assert.match(emits[0].e.text, /stuffed/);
});

test('stale clicks get a soft "someone moved that" notice and a repaint; a different kind in the target slot says so', () => {
  const w = freshWorld(); w.decor.push({ type: 'crate', x: 1, z: 0 });
  const { mod, emits, bags } = makeCtx(w);
  mod.load({ v: 1, chests: { '1,0': [{ kind: 'wood', count: 4 }, { kind: 'leaf', count: 1 }] }, seen: [], learned: [], r: 0 }, 'save');
  const rev = mod.debug.rev(); emits.length = 0;
  mod.action({ kind: 'storage.take', x: 1, z: 0, from: 0, expect: { kind: 'wood', count: 9 } }, 'host', bags.host);
  mod.action({ kind: 'storage.take', x: 1, z: 0, from: 5, expect: { kind: 'wood', count: 4 } }, 'host', bags.host);
  assert.deepEqual(emits.map(e => e.e.text), ['Someone moved that — try again', 'Someone moved that — try again']);
  assert.ok(mod.debug.rev() > rev); // the open panel repaints at once
  emits.length = 0;
  bags.host.slots[9] = { kind: 'scrap', count: 1 };
  mod.action({ kind: 'storage.put', x: 1, z: 0, from: 9, to: 1, expect: { kind: 'scrap', count: 1 } }, 'host', bags.host);
  assert.equal(emits[0].e.text, 'That slot already holds something else');
  assert.deepEqual(bags.host.slots[9], { kind: 'scrap', count: 1 });
});

test('the Research Table has its own icon symbol in icons.svg', async () => {
  const { readFile } = await import('node:fs/promises');
  const { ITEM_INFO } = await import(new URL('inventory-state.js', base));
  const svg = await readFile(new URL('icons.svg', base), 'utf8');
  assert.equal(ITEM_INFO.research.icon, 'icon-research');
  assert.ok(svg.includes('<symbol id="icon-research"'));
  assert.notEqual(ITEM_INFO.research.icon, ITEM_INFO.bench?.icon ?? 'icon-repair');
});

test('setOwnedElsewhere: recipes owned by the progression catalogue are never locked by the table', async () => {
  const { ITEMS } = await import(new URL('items.js', base));
  try {
    SR.setOwnedElsewhere(id => !!ITEMS[id]);
    const st = { seen: [], learned: [], all: false };
    const locked = SR.lockedRecipes(st);
    assert.ok(locked.length > 0);
    for (const id of locked) assert.ok(!ITEMS[id], `${id} is a catalogue recipe`);
    assert.equal(SR.isLearned(st, 'sail'), true);
    assert.deepEqual(SR.learnedFrom(['wood', 'rope', 'leaf']), ['bed', 'brush', 'fern', 'flagpole', 'hammock', 'pennant', 'rug', 'sign', 'wheel']); // content recipes (sleep, paint, engine, decor pack) are the table's own
  } finally { SR.setOwnedElsewhere(id => !TABLE_TREE.has(id)); }
});
