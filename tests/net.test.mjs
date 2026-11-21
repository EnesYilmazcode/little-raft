// Edge collection nets (dist/nets.js): placement, capture geometry, capacity, emptying, migration.
// Run: node --test tests/net.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const N = await import(new URL('nets.js', base));
const { Bag, SLOT_COUNT, RECIPES } = await import(new URL('inventory-state.js', base));
const { ITEMS } = await import(new URL('items.js', base));

const START = Array.from({length:9}, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]); // 3x3 raft, tiles -1..1
const LOOT = {wood:{wood:2}, leaf:{leaf:1}, scrap:{scrap:1}, plastic:{plastic:1}, barrel:{wood:3, leaf:2, scrap:1, plastic:1}};
const lootFor = t => LOOT[t];
const net = (x, z, d, items = []) => ({x, z, d, items});

test('rect: a net on the -z side of tile (0,-1) sticks out over the water, 1.8 m wide', () => {
  const n = net(0, -1, 3), r = N.netRect(n);
  assert.equal(N.netCellX(n), 0); assert.equal(N.netCellZ(n), -2);
  assert.ok(Math.abs(r.maxZ - -3) < 1e-9, 'inner side touches the tile edge at z = -3');
  assert.ok(Math.abs(r.minZ - (-3 - N.NET_DEPTH)) < 1e-9);
  assert.ok(Math.abs(r.maxX - r.minX - 2 * N.NET_HALF_W) < 1e-9);
  const e = N.netRect(net(1, 0, 0)); // +x side: depth along x
  assert.ok(Math.abs(e.minX - 3) < 1e-9 && Math.abs(e.maxX - e.minX - N.NET_DEPTH) < 1e-9 && Math.abs(e.maxZ - e.minZ - 1.8) < 1e-9);
  assert.ok(Math.abs(N.netYaw(2)) < 1e-9 && Math.abs(N.netYaw(0) - Math.PI / 2) < 1e-9);
});

test('placement: open water beside a tile edge, never on a tile, one net per water cell', () => {
  assert.deepEqual(N.netSpot(START, [], 0, -3.6), {x:0, z:-1, d:3}); // just off the front edge
  assert.deepEqual(N.netSpot(START, [], 0, -2.8), {x:0, z:-1, d:3}); // on the tile near its edge
  assert.equal(N.netSpot(START, [], 0, 0), null);                      // tile centre
  assert.equal(N.netSpot(START, [], 0, -1.2), null);                   // edge between two tiles
  assert.equal(N.netSpot(START, [], 20, 20), null);                    // far from the raft
  assert.equal(N.netBlock(START, [], 0, 0, 0), 'water');               // inner side: tile next door
  assert.equal(N.netBlock(START, [], 5, 5, 0), 'nofloor');
  assert.equal(N.netBlock(START, [], 0, -1, 3), null);
  const taken = [net(0, -1, 3)];
  assert.equal(N.netSpot(START, taken, 0, -3.6).blocked, 'net');
  assert.ok(N.netOnCell(taken, 0, -2) && !N.netOnCell(taken, 1, -2));
});

test('capture: a drift step that enters the rectangle is caught; one that passes beside is not', () => {
  const nets = [net(0, -1, 3)]; // rect x -0.9..0.9, z -4.05..-3
  assert.equal(N.catchNet(nets, 'wood', 0, -4.2, 0, -4.0), 0);       // drifting +z into the outer side
  assert.equal(N.catchNet(nets, 'wood', 0.5, -3.5, 0.5, -3.49), 0);  // already inside
  assert.equal(N.catchNet(nets, 'wood', 1.2, -4.2, 1.2, -3.0), -1);  // passes beside
  assert.equal(N.catchNet(nets, 'wood', 0, -6, 0, -5), -1);          // still upstream
  assert.equal(N.catchNet(nets, 'wood', -2, -3.5, 2, -3.5), 0);      // a fast sideways step crossing it
  assert.equal(N.catchNet(nets, 'barrel', 0, -4.2, 0, -4.0), 0);     // barrels too
  assert.equal(N.catchNet(nets, 'cache', 0, -4.2, 0, -4.0), -1);     // never the signal cache
  assert.equal(N.catchNet(nets, 'bottle', 0, -4.2, 0, -4.0), -1);
  assert.equal(N.segmentHitsRect({minX:0, maxX:1, minZ:0, maxZ:1}, 2, 2, 3, 3), false);
});

test('capacity: a net holds 10, then debris floats past (or into the next net)', () => {
  const full = net(0, -1, 3, new Array(N.NET_CAPACITY).fill('wood'));
  assert.equal(N.NET_CAPACITY, 10);
  assert.equal(N.catchNet([full], 'leaf', 0, -4.2, 0, -4.0), -1);
  const both = [full, net(0, -1, 3)]; // overlapping nets (hand-made data): a full one lets it through to the next
  assert.equal(N.catchNet(both, 'leaf', 0, -4.2, 0, -4.0), 1);
  // simulate drift: 15 planks floating straight at the net, one after another
  const nets = [net(0, -1, 3)]; let caught = 0;
  for (let k = 0; k < 15; k++) {
    let z = -10; const x = (k % 3 - 1) * 0.4;
    while (z < -3) { const z1 = z + 0.05; const i = N.catchNet(nets, 'wood', x, z, x, z1); if (i >= 0) { nets[i].items.push('wood'); caught++; break; } z = z1; }
  }
  assert.equal(caught, 10); assert.equal(nets[0].items.length, 10);
  for (let k = 0; k < 10; k++) { const s = N.netSlot(k); assert.ok(Math.abs(s.x) < N.NET_HALF_W && s.z > 0 && s.z < N.NET_DEPTH, 'slot inside the frame'); }
});

test('emptying: every piece goes into the bag, the net is empty after', () => {
  const n = net(0, -1, 3, ['wood', 'wood', 'leaf', 'barrel', 'plastic']), bag = new Bag();
  const r = N.emptyNet(n, bag, lootFor);
  assert.equal(r.taken, 5); assert.equal(r.left, 0); assert.deepEqual(n.items, []);
  assert.deepEqual(r.loot, {wood:7, leaf:3, scrap:1, plastic:2});
  assert.equal(bag.count('wood'), 7); assert.equal(bag.count('leaf'), 3);
  // barrel loot is rolled when taken
  let rolls = 0; const n2 = net(0, -1, 3, ['barrel', 'barrel']);
  N.emptyNet(n2, new Bag(), t => (t === 'barrel' ? (rolls++, {scrap:2}) : null));
  assert.equal(rolls, 2);
});

test('emptying into a full bag: pieces that do not fit stay in the net', () => {
  const slots = new Array(SLOT_COUNT).fill(null).map(() => ({kind:'scrap', count:20}));
  slots[0] = {kind:'hook', count:1, durability:20}; slots[1] = {kind:'leaf', count:18};
  const bag = new Bag({slots, selected:0}), n = net(0, -1, 3, ['wood', 'leaf', 'leaf', 'leaf', 'barrel']);
  const r = N.emptyNet(n, bag, lootFor);
  assert.equal(r.taken, 2, 'two leaves fill the stack'); assert.equal(r.left, 3);
  assert.deepEqual(n.items, ['wood', 'leaf', 'barrel']);
  assert.equal(bag.count('leaf'), 20); assert.equal(bag.count('wood'), 0);
});

test('saves: nets are validated against the tiles; old deck nets move to the nearest free edge', () => {
  const clean = N.cleanNets([net(0, -1, 3, ['wood', 'cache', 'barrel']), net(0, 0, 0), net(9, 9, 1), net(0, -1, 3), {x:'a'}, null], START);
  assert.deepEqual(clean, [{x:0, z:-1, d:3, items:['wood', 'barrel']}]);
  assert.deepEqual(N.cleanNets(undefined, START), []);
  const nets = [], left = N.migrateDeckNets([{type:'net', x:1, z:-1}, {type:'net', x:1, z:-1}], START, nets);
  assert.deepEqual(left, []);
  assert.equal(nets.length, 2);
  for (const m of nets) { assert.equal(N.netBlock(START, nets.filter(o => o !== m), m.x, m.z, m.d), null); assert.equal(m.x, 1); assert.equal(m.z, -1); }
  assert.notEqual(nets[0].d, nets[1].d);
  const one = [[0, 0]], lot = []; // a single tile has four edges: the fifth deck net stays on deck
  assert.equal(N.migrateDeckNets(new Array(5).fill(0).map(() => ({type:'net', x:0, z:0})), one, lot).length, 1);
  assert.equal(lot.length, 4);
});

test('cost: 6 planks + 8 rope + 2 nails', () => {
  assert.deepEqual({...ITEMS.net.recipe.cost}, {wood:6, rope:8, nail:2});
  assert.deepEqual({...RECIPES.net.cost}, {wood:6, rope:8, nail:2});
});

test('game.js: nets catch in the drift step, empty through action(), and the old pull is gone', () => {
  const src = readFileSync(new URL('game.js', base), 'utf8');
  assert.doesNotMatch(src, /pickNetItem|netClock/);
  assert.match(src, /action\(\{kind:'emptyNet', x:n\.x, z:n\.z, d:n\.d\}\)/);
  assert.match(src, /a\.kind === 'emptyNet'/);
  assert.match(src, /nets:world\.nets/); // host snapshot carries the nets to the guest
});

test('shark: a destroyed tile takes the nets hanging from it, other nets stay', async () => {
  const { removeTile } = await import(new URL('shark.js', base));
  const w = {tiles:START.map(t => [...t]), decor:[], tileHp:{}, pieces:[], nets:[{x:1, z:0, d:0, items:['wood']}, {x:1, z:1, d:2, items:[]}, {x:0, z:1, d:2, items:[]}]};
  assert.ok(removeTile(w, 1, 1));
  assert.deepEqual(w.nets.map(n => [n.x, n.z, n.d]), [[1, 0, 0], [0, 1, 2]]);
  assert.deepEqual(N.cleanNets(w.nets, w.tiles), w.nets); // what is left is still valid
});

test('shark: bites from a side without a net when the tile has one', async () => {
  const { pickTarget } = await import(new URL('shark.js', base));
  const tiles = [[0, 0]], nets = [{x:0, z:0, d:0, items:[]}, {x:0, z:0, d:2, items:[]}, {x:0, z:0, d:3, items:[]}];
  for (const r of [0, 0.3, 0.6, 0.99]) assert.deepEqual(pickTarget(tiles, null, () => r, nets), {x:0, z:0, nx:-1, nz:0});
  nets.push({x:0, z:0, d:1, items:[]}); // every side netted: it still bites
  assert.ok(pickTarget(tiles, null, () => 0.5, nets));
});
