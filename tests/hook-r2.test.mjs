// Round-2 hook regressions: full-bag reel stop, throws while swimming, a catch landing on the deck.
// Run: node --test tests/hook-r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const HP = await import(new URL('hook-physics.js', base));
const { HookCast, WATER_Y, catchLoot, holdForFullBag, FULL_HOLD_DIST, throwOrigin, MIN_THROW_Y } = HP;
const I = await import(new URL('items.js', base));
const { lootFits } = await import(new URL('coop-rules.js', base));
const { Bag } = await import(new URL('inventory-state.js', base));
const gameSrc = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');

const hand = new T.Vector3(0, 1.2, 0);
// A hook already floating 8 m out with one barrel caught.
function floatingCatch() {
  const h = new HookCast(T, { origin: { x: 0, y: WATER_Y, z: -8 }, direction: { x: 0, y: 0, z: -1 }, drift: { x: 0, z: 0 } });
  const items = [{ id: 1, token: 'a', type: 'barrel', x: 0, z: -8 }];
  h.update(0.02, { hand, items, time: 0 });
  assert.equal(h.caughtItems.length, 1);
  return { h, items };
}
function reel(h, items, fits, secs = 5) {
  let ev = null;
  for (let t = 0; t < secs && h.stage !== 'done'; t += 0.05) {
    const hold = holdForFullBag(h, fits);
    ev = h.update(0.05, { hand, items, reeling: !hold, time: t }) ?? ev;
  }
  return ev;
}

test('HOOK-1: catchLoot sums the loot of the whole catch', () => {
  const table = { wood: { wood: 2 }, barrel: { wood: 3, leaf: 2 } };
  assert.deepEqual(catchLoot([{ type: 'wood' }, { type: 'barrel' }, { type: 'nope' }], table), { wood: 5, leaf: 2 });
  assert.deepEqual(catchLoot(null, table), {});
});

test('HOOK-1: with a full bag the reel stops short and keeps the catch on the hook', () => {
  const { h, items } = floatingCatch();
  const ev = reel(h, items, () => false);
  assert.equal(ev, null, 'no collect is sent');
  assert.notEqual(h.stage, 'done');
  assert.equal(h.caughtItems.length, 1, 'catch stays on the hook');
  assert.ok(h.distance > 0.7 && h.distance <= FULL_HOLD_DIST + 0.5, `held near the raft, got ${h.distance}`);
});

test('HOOK-1: once there is room the same reel finishes and collects', () => {
  const { h, items } = floatingCatch();
  reel(h, items, () => false, 3);
  const ev = reel(h, items, () => true);
  assert.equal(ev?.kind, 'collected');
  assert.equal(ev.items[0].token, 'a');
});

test('HOOK-1: no catch or far away never holds the reel', () => {
  assert.equal(holdForFullBag({ caughtItems: [], distance: 1 }, () => false), false);
  assert.equal(holdForFullBag({ caughtItems: [{ type: 'wood' }], distance: 5 }, () => false), false);
  assert.equal(holdForFullBag({ caughtItems: [{ type: 'wood' }], distance: 1 }, () => true), false);
  assert.equal(holdForFullBag(null, () => false), false);
});

test('HOOK-2: a swimmer\'s throw starts above the water and flies', () => {
  assert.ok(MIN_THROW_Y >= WATER_Y + 0.3);
  for (const y of [-0.29, -0.18, 0.04]) {
    const origin = throwOrigin({ x: 1, y, z: 2 }, new T.Vector3());
    assert.deepEqual([origin.x, origin.y, origin.z], [1, MIN_THROW_Y, 2]);
    const h = new HookCast(T, { origin, direction: { x: 0, y: 0.3, z: -1 }, charge: 1 });
    assert.equal(h.stage, 'flying', `hand y ${y} must not splash at the hand`);
    for (let i = 0; i < 200 && h.stage === 'flying'; i++) h.update(0.05, { hand: origin, items: [], time: i * 0.05 });
    assert.ok(h.distance > 5, `throw from y ${y} went ${h.distance} m`);
  }
});

test('HOOK-2: a deck-height hand is left alone', () => {
  const o = throwOrigin({ x: 0, y: 1.2, z: 0 });
  assert.equal(o.y, 1.2);
});

test('HOOK-5: a hook that snags a supply and lands on the far deck keeps the catch', () => {
  // L/U raft: the player's deck at z in (-1,3), a far arm at z in (-13,-9), water between.
  // raft-master deck model: the hook rests on the planks (stage 'floating', onDeck) holding its catch,
  // and reeling it home reports the catch as collected.
  const deckAt = (x, z) => ((z > -1 && z < 3) || (z < -9 && z > -13) ? 0.22 : null);
  const items = [{ id: 1, token: 'a', type: 'barrel', x: 0, z: -8.6 }];
  let found = null;
  for (let up = -0.3; up <= 0.4 && !found; up += 0.01) for (let c = 0; c <= 1 && !found; c += 0.05) {
    const h = new HookCast(T, { origin: { x: 0, y: 1.25, z: 1 }, direction: { x: 0, y: up, z: -1 }, charge: c, deckAt });
    const events = [];
    for (let i = 0; i < 400 && h.stage === 'flying'; i++) { const e = h.update(1 / 60, { hand: { x: 0, y: 1.25, z: 1 }, items }); if (e) events.push(e); }
    if (h.onDeck && h.caughtItems.length && h.position.z < -9) found = { h, events };
  }
  assert.ok(found, 'a throw that snags then lands on the deck exists');
  assert.deepEqual(found.events, [], 'landing on the deck does not end the cast');
  const { h } = found, reeled = [];
  for (let i = 0; i < 2000 && h.stage !== 'done'; i++) { const e = h.update(1 / 60, { hand: { x: 0, y: 1.25, z: 1 }, items, reeling: true }); if (e) reeled.push(e); }
  assert.equal(reeled.length, 1);
  assert.equal(reeled[0].kind, 'collected');
  assert.deepEqual(reeled[0].items, [{ id: 1, token: 'a', type: 'barrel' }]);
});

// ---------- round 3 ----------
test('HOOK-R3-2: catchLoot takes a per-item loot function (a barrel\'s own roll)', () => {
  const rolled = { a: { clay: 1, wood: 2 } };
  assert.deepEqual(catchLoot([{ token: 'a', type: 'barrel' }, { token: 'b', type: 'wood' }], it => rolled[it.token] ?? { wood: 2 }), { clay: 1, wood: 4 });
});

const lcg = seed => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
test('HOOK-R3-2: rolling on a scratch luck copy leaves the pity counters alone until the barrel is counted', () => {
  const luck = { misses: { clay: 4, stone: 1 } };
  const loot = I.rollBarrel(lcg(7), I.copyBarrelLuck(luck));
  assert.deepEqual(luck.misses, { clay: 4, stone: 1 }, 'a roll alone does not move the real counters');
  assert.ok(loot.clay > 0, 'the overdue clay is still forced on the scratch roll');
  I.countBarrelLuck(luck, loot);
  assert.equal(luck.misses.clay, 0);
  assert.equal(luck.misses.stone, loot.stone > 0 ? 0 : 2);
  // Same rule rollBarrel applies in place.
  const a = { misses: { clay: 1 } }, b = { misses: { clay: 1 } };
  const la = I.rollBarrel(lcg(3), a);
  I.rollBarrel(lcg(3), I.copyBarrelLuck(b)); I.countBarrelLuck(b, la);
  assert.deepEqual(a.misses, b.misses);
});

test('HOOK-R3-2: the full-bag hold sees the barrel\'s real roll, not the fixed estimate', () => {
  const bag = new Bag();
  bag.add('wood', 1); bag.add('leaf', 1); bag.add('scrap', 1); bag.add('plastic', 1);
  for (let i = 0; i < 400 && bag.add('hammer', 1) === 0; i++) {} // fill every other slot
  const estimate = { wood: 3, leaf: 2, scrap: 1, plastic: 1 }, real = { wood: 2, leaf: 1, rope: 1 }; // a treasure kind that needs a new slot
  assert.equal(lootFits(bag, estimate), true, 'the old estimate says it fits');
  assert.equal(lootFits(bag, real), false);
  const { h } = floatingCatch(); h.distance = 1;
  const table = it => it.type === 'barrel' ? real : null;
  assert.equal(holdForFullBag(h, c => lootFits(bag, catchLoot(c, table))), true, 'the real roll does not fit: hold the catch in the water');
});

test('HOOK-R3-2: cleanBarrelLoot keeps a real roll and drops junk', () => {
  for (let i = 0; i < 200; i++) { const l = I.rollBarrel(); assert.deepEqual(I.cleanBarrelLoot(l), l); }
  for (const v of [null, 1, [], {}, { nope: 1 }, { wood: 0 }, { wood: 1.5 }, { wood: 500 }]) assert.equal(I.cleanBarrelLoot(v), null);
});

test('HOOK-R3-2: game.js rolls a barrel once and commits pity only after a successful collect', () => {
  const collect = gameSrc.slice(gameSrc.indexOf("if (a.kind === 'collect') {"), gameSrc.indexOf("if (a.kind === 'build') {"));
  assert.doesNotMatch(collect, /rollBarrel\(/, 'collect never re-rolls');
  assert.ok(collect.indexOf('countBarrelLuck') > collect.indexOf('commit(bag, scratch)'), 'pity advances after commit');
  assert.match(gameSrc, /holdForFullBag\(hook, c => lootFits\(localBag\(\), catchLoot\(c, caughtLoot\)\)\)/);
  assert.match(gameSrc, /lootFits\(actorBag\('host'\), lootOf\(it\)\)/, 'nets use the same roll');
});
