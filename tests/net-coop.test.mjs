// Regression tests for nets, guest hook state and the bench collider (dist/coop-rules.js).
// Run: node --test tests/net-coop.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { lootFits, pickNetItem, createGuestHeld, cleanHeldTokens, decorBlockers, NET_RANGE } = await import(new URL('coop-rules.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));

const LOOT = {wood:{wood:2}, leaf:{leaf:1}};
// Every slot full; one Palm Leaf stack has room, nothing else does.
const fullBagWithLeafRoom = () => {
  const slots = new Array(SLOT_COUNT).fill(null).map(() => ({kind:'scrap', count:20}));
  slots[0] = {kind:'hook', count:1, durability:20};
  slots[1] = {kind:'leaf', count:5};
  return new Bag({slots, selected:0});
};

// ------------------------------------------------------------- CRA-3

test('lootFits: false when any loot piece does not fit, and the bag is untouched', () => {
  const bag = fullBagWithLeafRoom(), before = JSON.stringify(bag.snapshot());
  assert.equal(lootFits(bag, LOOT.wood), false);
  assert.equal(lootFits(bag, LOOT.leaf), true);
  assert.equal(JSON.stringify(bag.snapshot()), before);
});

test('pickNetItem: skips a nearer-in-order supply that does not fit and takes one that does', () => {
  const bag = fullBagWithLeafRoom(), net = {x:0, z:-1};
  const items = [
    {id:0, token:'plank', type:'wood', x:0.5, z:-3},
    {id:1, token:'leaf', type:'leaf', x:-0.5, z:-4},
  ];
  const it = pickNetItem(items, net, {fits:i => lootFits(bag, LOOT[i.type])});
  assert.equal(it?.token, 'leaf');
});

test('pickNetItem: respects range, held and pending', () => {
  const net = {x:0, z:0};
  const items = [
    {id:0, token:'far', x:NET_RANGE + .1, z:0},
    {id:1, token:'held', x:1, z:0},
    {id:2, token:'pend', x:1, z:0},
    {id:3, token:'ok', x:0, z:1},
  ];
  const it = pickNetItem(items, net, {held:new Set(['held']), isPending:i => i.token === 'pend'});
  assert.equal(it.token, 'ok');
  assert.equal(pickNetItem(items.slice(0, 3), net, {held:new Set(['held']), isPending:i => i.token === 'pend'}), null);
});

// ------------------------------------------------------------- CRA-4

test('guest held tokens: missing or malformed field means none', () => {
  assert.deepEqual(cleanHeldTokens(undefined), []);
  assert.deepEqual(cleanHeldTokens('abc'), []);
  assert.deepEqual(cleanHeldTokens(['a', '', null, {}, 7, 'b']), ['a', 7, 'b']);
  assert.ok(cleanHeldTokens(new Array(100).fill('x')).length <= 32);
});

test('guest held tokens expire when the guest stops reporting', () => {
  const g = createGuestHeld(1000);
  assert.deepEqual(g.tokens(0), []);
  g.note(['t1'], 100);
  assert.deepEqual(g.tokens(500), ['t1']);
  assert.deepEqual(g.tokens(1200), []);
  g.note(['t2'], 1200); g.note(undefined, 1300); // an old client's move carries no held field
  assert.deepEqual(g.tokens(1400), []);
});

test('a net does not take a supply on the guest hook', () => {
  const g = createGuestHeld(); g.note(['hooked'], 0);
  const items = [{id:0, token:'hooked', x:0, z:1}];
  assert.equal(pickNetItem(items, {x:0, z:0}, {held:new Set(g.tokens(10))}), null);
});

test('game.js sends held tokens on move and feeds them to nets and drift', () => {
  const src = readFileSync(new URL('game.js', base), 'utf8');
  assert.match(src, /type:'move', me:pose\(\), held:/);
  assert.match(src, /guestHeld\.note\(cleanHeldTokens\(data\.held\)/);
  assert.match(src, /function updateItems\(dt\) \{\s*const heldTokens = allHeldTokens\(\)/);
  assert.match(src, /pickNetItem\(world\.items, net, \{held:heldTokens/);
});

// ------------------------------------------------------------- CRA-5

const BLOCK_RADIUS = {palm:.42, crate:.55, bench:.45};
const benchStop = (dir) => {
  // Walk from 2 m away toward the bench center at tile (0,0) along `dir` and return how close the eye gets.
  const blocked = decorBlockers({type:'bench', x:0, z:0}, BLOCK_RADIUS);
  const [dx, dz] = dir, start = 2;
  const p = new PlayerPhysics({x:dx * start, y:.22 + PC.EYE_OFFSET, z:dz * start});
  const yaw = Math.atan2(dx, dz); // forward is -sin(yaw), -cos(yaw)
  const tiles = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  for (let i = 0; i < 240; i++) p.update(1 / 60, {forward:1, strafe:0, yaw, jump:false, sprint:false, tiles, deckY:.22, waterY:0, blocked});
  return Math.abs(dx ? p.x : p.z);
};

test('bench uses three circles along the seat, other decor one circle', () => {
  const b = decorBlockers({type:'bench', x:1, z:-1}, BLOCK_RADIUS);
  assert.deepEqual(b.map(c => [+(c.x).toFixed(3), +(c.z).toFixed(3), c.r]), [[1.5, -2, .22], [2, -2, .22], [2.5, -2, .22]]);
  assert.deepEqual(decorBlockers({type:'crate', x:0, z:1}, BLOCK_RADIUS), [{x:0, z:2, r:.55}]);
  assert.deepEqual(decorBlockers({type:'net', x:0, z:0}, BLOCK_RADIUS), []);
  const r = decorBlockers({type:'bench', x:0, z:0, yaw:Math.PI / 2}, BLOCK_RADIUS);
  assert.ok(r.every(c => Math.abs(c.x) < 1e-9), 'rotated bench lies along z');
});

test('bench collider: no clipping through the seat end, no wide gap in front', () => {
  if (!PC?.EYE_OFFSET) return;
  const BODY = PC.BODY_RADIUS ?? .25;
  const end = benchStop([1, 0]), front = benchStop([0, 1]);
  assert.ok(end - BODY >= .72 - .03, `body overlaps the seat end (stop ${end.toFixed(3)})`);
  assert.ok(front - BODY <= .195 + .08, `invisible wall in front of the seat (stop ${front.toFixed(3)})`);
});
