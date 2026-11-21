// Drop key + floating dropped items (dist/drop.js), and Raft tool breaking (items.js wearSlot).
// Run: node --test tests/drop.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const D = await import(new URL('drop.js', base));
const { Bag, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const { ITEMS, wearSlot, wearPerUse, repairCost } = await import(new URL('items.js', base));
const gameSrc = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');

const noTiles = () => false;
const raft = (tx, tz) => Math.abs(tx) <= 1 && Math.abs(tz) <= 1; // 3x3 tiles: x,z in [-3,3]
const bagWith = (...slots) => { const b = new Bag(); b.slots.fill(null); slots.forEach((s, i) => { b.slots[i] = s; }); return b; };

test('drop: removes one from the slot and spawns a floating pickup with a 90 s ttl', () => {
  const bag = bagWith({ kind: 'wood', count: 5 });
  const items = [{ id: 3, token: 'a', type: 'wood', x: 0, z: -20, phase: 0 }];
  const r = D.planDrop({ kind: 'drop', slot: 0, x: 0, z: -9 }, bag, { x: 0, z: -8 }, items, noTiles);
  assert.deepEqual(r, { ok: true, slot: 0, n: 1, x: 0, z: -9 });
  const taken = D.takeFromSlot(bag, r.slot, r.n);
  assert.deepEqual(taken, { kind: 'wood', count: 1 });
  assert.equal(bag.slots[0].count, 4);
  const it = D.makeDrop(D.nextDropId(items), 'tok', taken, r.x, r.z, 1);
  assert.equal(it.type, 'drop'); assert.equal(it.ttl, D.DROP_TTL); assert.equal(D.DROP_TTL, 90);
  assert.ok(it.id >= D.DROP_ID_BASE, 'never collides with a debris lane id');
  assert.deepEqual(D.dropLoot(it), { wood: 1 }, 'collecting gives back exactly what fell');
  assert.equal(D.dropLoot(items[0]), null, 'ordinary debris keeps its LOOT row');
});

test('drop: count takes the whole stack; a tool keeps its durability and the slot empties', () => {
  const bag = bagWith({ kind: 'rope', count: 7 }, { kind: 'hook', count: 1, durability: 35 });
  const r = D.planDrop({ kind: 'drop', slot: 0, count: 99 }, bag, { x: 9, z: 0 }, [], noTiles);
  assert.equal(r.n, 7, 'clamped to the stack');
  assert.deepEqual(D.takeFromSlot(bag, 0, r.n), { kind: 'rope', count: 7 }); assert.equal(bag.slots[0], null);
  const t = D.takeFromSlot(bag, 1, 1); assert.deepEqual(t, { kind: 'hook', count: 1, dur: 35 });
  const it = D.makeDrop(D.DROP_ID_BASE, 'x', t, 0, 0); assert.equal(it.dur, 35);
  const back = bagWith(); assert.equal(back.add(it.kind, it.count, { durability: it.dur }), 0);
  assert.equal(back.slots[0].durability, 35, 'picking it up restores the same wear');
});

test('drop: guest validation rejects bad slots, counts, positions and out-of-reach points', () => {
  const bag = bagWith({ kind: 'wood', count: 2 });
  const pose = { x: 10, z: 0 };
  const bad = a => D.planDrop(a, bag, pose, [], noTiles);
  for (const slot of [-1, 28, 1.5, '0', undefined, null]) assert.equal(bad({ slot }).ok, false, `slot ${slot}`);
  assert.equal(bad({ slot: 1 }).reason, 'empty');
  for (const count of [0, -2, 1.5, 'all', NaN]) assert.equal(bad({ slot: 0, count }).reason, 'bad', `count ${count}`);
  assert.equal(bad({ slot: 0, x: NaN, z: 0 }).reason, 'bad');
  assert.equal(bad({ slot: 0, x: 10 }).reason, 'bad', 'x without z');
  assert.equal(bad({ slot: 0, x: 30, z: 0 }).reason, 'reach', 'cannot drop far from the dropper');
  assert.equal(D.planDrop({ slot: 0 }, bag, null, [], noTiles).reason, 'bad', 'unknown guest pose');
  assert.equal(D.planDrop(null, bag, pose, [], noTiles).ok, false);
  assert.equal(bag.slots[0].count, 2, 'planning never mutates the bag');
  const crowd = Array.from({ length: D.MAX_DROPS }, (_, i) => ({ type: 'drop', id: D.DROP_ID_BASE + i }));
  assert.equal(D.planDrop({ slot: 0 }, bag, pose, crowd, noTiles).reason, 'crowded');
});

test('drop: a point on the deck moves out past the raft edge into open water', () => {
  const bag = bagWith({ kind: 'scrap', count: 1 });
  const r = D.planDrop({ slot: 0, x: 1, z: 0 }, bag, { x: 0, z: 0 }, [], raft);
  assert.ok(r.ok); assert.ok(r.x > 3 && Math.abs(r.z) < 1e-9, `walked +x off the planks: ${r.x}`);
  assert.equal(raft(Math.round(r.x / 2), Math.round(r.z / 2)), false);
  assert.equal(D.planDrop({ slot: 0 }, bag, { x: 0, z: 0 }, [], () => true).reason, 'nowater');
});

test('drop: ttl ticks down and expired drops sink; hooked drops wait', () => {
  const items = [{ type: 'wood', token: 'w' }, { type: 'drop', token: 'a', ttl: 1 }, { type: 'drop', token: 'b', ttl: 1 }];
  assert.equal(D.tickDrops(items, 0.5, new Set()), false);
  assert.equal(items[1].ttl, 0.5);
  assert.equal(D.tickDrops(items, 0.6, new Set(['b'])), true);
  assert.deepEqual(items.map(i => i.token), ['w', 'b'], 'the held one survives, debris untouched');
});

test('drop: snapshot cleaner keeps valid drop fields and rejects junk', () => {
  const isKind = k => Object.hasOwn(ITEM_INFO, k);
  assert.deepEqual(D.cleanDropFields({ kind: 'wood', count: 3, ttl: 500 }, isKind), { kind: 'wood', count: 3, ttl: 90 });
  assert.deepEqual(D.cleanDropFields({ kind: 'hook', count: 1, ttl: 4, dur: 140 }, isKind), { kind: 'hook', count: 1, ttl: 4, dur: 100 });
  for (const bad of [{ kind: 'nope', count: 1 }, { kind: 'wood', count: 0 }, { kind: 'wood', count: 1.5 }, { kind: '__proto__', count: 1 }, null])
    assert.equal(D.cleanDropFields(bad, isKind), null);
  assert.equal(D.dropVisual('wood'), 'wood'); assert.equal(D.dropVisual('hammer'), 'scrap'); assert.equal(D.dropVisual('plastic'), 'plastic');
});

test('drop: game.js wires a host-validated action through the debris pickup path', () => {
  const fn = gameSrc.slice(gameSrc.indexOf("if (a.kind === 'drop') {"), gameSrc.indexOf("if (a.kind === 'build') {"));
  assert.match(fn, /const p = actor === 'guest' \? other : physics;/, 'guest drops are checked against the guest pose');
  assert.match(fn, /planDrop\(a, bag, p, world\.items, hasTile\)/);
  assert.match(fn, /world\.items\.push\(makeDrop\(/, 'spawns into world.items: hook + E + snapshot reuse it');
  assert.match(gameSrc, /isDrop \? dropLoot\(it\)/, 'collect gives the dropped stack back');
  assert.match(gameSrc, /else if \(!isDrop\) world\.items\.push\(spawnItem\(a\.id\)\)/, 'a picked-up drop does not respawn a debris lane');
  assert.match(gameSrc, /tickDrops\(world\.items, dt, heldTokens\)/, 'host sinks drops after the ttl');
  assert.match(gameSrc, /item\.type === 'drop' \? dropVisual\(item\.kind\) : item\.type/, 'pooled debris model, no new draw calls');
  const held = gameSrc.slice(gameSrc.indexOf('function dropHeld('), gameSrc.indexOf('function dropHeld(') + 300);
  assert.match(held, /uiBlocked\(\) \|\| building\?\.menu\.isOpen/, 'no drop while a menu is open');
  assert.match(gameSrc, /onDrop:guard\(\(from, amount\) => dropSlot\(from, amount\)\)/, 'inventory drag-out drops');
  const ui = readFileSync(fileURLToPath(new URL('survival-ui.js', base)), 'utf8');
  assert.match(ui, /if \(!el && e\.target === dlg\) \{ dropOut\(from, amt\); return; \}/, 'drag onto the backdrop drops');
});

test('tools: Raft durability numbers; the hammer never wears and has no bar', () => {
  assert.equal(ITEMS.hook.durability, 40);
  assert.equal(ITEMS.metalhook.durability, 100);
  assert.equal(ITEMS.fishingrod.durability, 10); // Raft: 10 catches
  assert.equal(ITEMS.hammer.unbreakable, true); assert.equal(ITEMS.hammer.durability, undefined);
  assert.equal(wearPerUse('hammer'), 0); assert.equal(repairCost('hammer'), null);
  assert.equal(ITEM_INFO.hammer.unbreakable, true);
  assert.doesNotMatch(ITEMS.hammer.tip, /floor tiles \(2 planks/, 'outdated tip text is gone');
  assert.ok(ITEMS.hook.recipe && ITEMS.hook.unlock.type === 'start', 'a broken hook can always be crafted again');
});

test('tools: a hook breaks after exactly 40 catches, a rod after 10, and the slot empties', () => {
  const slots = [{ kind: 'hook', count: 1, durability: 100 }, { kind: 'fishingrod', count: 1, durability: 100 }];
  for (let n = 1; n <= 40; n++) {
    const w = wearSlot(slots, 0, wearPerUse('hook'));
    assert.equal(w.broke, n === 40, `catch ${n}`);
  }
  assert.equal(slots[0], null);
  let broke = 0;
  for (let n = 1; n <= 10; n++) if (wearSlot(slots, 1, wearPerUse('fishingrod')).broke) broke = n;
  assert.equal(broke, 10, 'float dust still breaks on the 10th catch'); assert.equal(slots[1], null);
  assert.equal(wearSlot(slots, 1, 5), null, 'empty slot');
  const legacy = [{ kind: 'hook', count: 1, durability: 0 }];
  assert.equal(wearSlot(legacy, 0, 2.5).broke, false, 'an already-worn legacy hook is not destroyed');
  assert.ok(legacy[0]);
});

test('tools: game.js breaks the hook / rod with a notice and R still repairs a held metal hook or rod', () => {
  const wh = gameSrc.slice(gameSrc.indexOf('function wearHook('), gameSrc.indexOf('function applyAction('));
  assert.match(wh, /wearSlot\(bag\.slots, i,/);
  assert.match(wh, /' broke'/, 'Hook broke notice');
  assert.match(gameSrc, /const rw = wearRod\(bag\.slots\[ri\], wearPerUse\('fishingrod'\)\)/, 'a catch wears the rod');
  assert.match(gameSrc, /text:'Your fishing rod broke!'/);
  assert.match(gameSrc, /REPAIRABLE = Object\.freeze\(\['hook', 'metalhook', 'fishingrod'\]\)/);
});
