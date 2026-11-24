// Removing what was built: pieces and foundation tiles, hammer (X) or axe (hold click), host-authoritative refunds.
// Run: node --test tests/build-remove.test.mjs   (browser repro: python check_removal.py)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { BuildGrid, PIECES, cleanPieces } = await import(new URL('building-pieces.js', base));
const { removePiece, removeFoundation, tileRemoveWhy, toolOf, standingOn, REMOVE_TEXT } = await import(new URL('build-remove.js', base));
const { BLOCK_TEXT } = await import(new URL('build-rules.js', base));
const { Bag } = await import(new URL('inventory-state.js', base));
const src = f => readFileSync(new URL(f, base), 'utf8');

const TILES = () => [[-1, -1], [0, -1], [-1, 0], [0, 0]]; // the starter raft
const bagWith = (items) => { const b = new Bag(); for (const [k, n] of Object.entries(items)) b.add(k, n); return b; };
const gridOf = (tiles, pieces) => { const g = new BuildGrid(); g.setTiles(tiles); g.load(pieces); return g; };
const has = (g, p) => !!g.find(p);

test('a wall loaded from a save (round trip through JSON and cleanPieces) is removed with a full refund', () => {
  const tiles = TILES(), built = gridOf(tiles, []);
  assert.ok(built.place({t:'wall', i:0, j:0, l:0, r:0}));
  const saved = JSON.parse(JSON.stringify({tiles, pieces:built.list}));
  const loaded = cleanPieces(saved.pieces, saved.tiles); // what game.js cleanWorld does on load
  const g = gridOf(saved.tiles, loaded), bag = bagWith({hammer:1});
  const r = removePiece(g, {kind:'unpiece', t:'wall', i:0, j:0, l:0, r:0}, bag, Bag);
  assert.equal(r.ok, true, r.text);
  assert.equal(bag.count('wood'), PIECES.wall.cost.wood);
  assert.equal(has(g, {t:'wall', i:0, j:0, l:0, r:0}), false);
});

test('old-format records (no r) load and every piece type comes off, top down', () => {
  const g = gridOf(TILES(), [{t:'wall', i:0, j:0, l:0}, {t:'wall', i:0, j:1, l:0}, {t:'floor', i:0, j:0, l:1}, {t:'pillar', i:1, j:1, l:0},
    {t:'stairs', i:-1, j:-1, l:0}, {t:'halfwall', i:-1, j:0, l:0}, {t:'railing', i:0, j:-1, l:0, r:1}]);
  assert.equal(g.list.length, 7);
  const bag = bagWith({hammer:1});
  for (const p of [...g.list].sort((a, b) => b.l - a.l)) {
    const r = removePiece(g, {kind:'unpiece', t:p.t, i:p.i, j:p.j, l:p.l, r:p.r}, bag, Bag);
    assert.equal(r.ok, true, p.t + ': ' + r.text);
  }
  assert.equal(g.list.length, 0);
});

test('refund amounts match each piece cost; a full bag refuses and keeps the piece', () => {
  for (const t of ['wall', 'halfwall', 'window', 'door', 'pillar', 'stairs', 'railing']) {
    const g = gridOf(TILES(), []), slot = PIECES[t].slot;
    const p = slot === 'cell' ? {t, i:0, j:0, l:0, r:0} : slot === 'corner' ? {t, i:0, j:0, l:0, r:0} : {t, i:0, j:0, l:0, r:0};
    assert.ok(g.place(p), t);
    const bag = bagWith({hammer:1}), r = removePiece(g, {kind:'unpiece', ...p}, bag, Bag);
    assert.equal(r.ok, true, t);
    for (const [k, n] of Object.entries(PIECES[t].cost)) assert.equal(bag.count(k), n, t + ' ' + k);
  }
  const g = gridOf(TILES(), [{t:'wall', i:0, j:0, l:0, r:0}]), full = new Bag();
  for (let i = 0; i < full.slots.length; i++) full.slots[i] = {kind:'stone', count:20};
  full.slots[0] = {kind:'hammer', count:1};
  const r = removePiece(g, {kind:'unpiece', t:'wall', i:0, j:0, l:0, r:0}, full, Bag);
  assert.equal(r.ok, false); assert.equal(r.text, 'Your bag is full');
  assert.ok(has(g, {t:'wall', i:0, j:0, l:0, r:0}));
});

test('support rules: a lone wall is removable, a wall holding up a floor is not until the floor is gone', () => {
  const lone = gridOf(TILES(), [{t:'wall', i:-1, j:0, l:0, r:1}]);
  assert.equal(lone.canRemove(lone.list[0]), '');
  const g = gridOf(TILES(), [{t:'wall', i:0, j:0, l:0, r:0}, {t:'floor', i:0, j:0, l:1, r:0}]);
  assert.equal(g.canRemove(g.find({t:'wall', i:0, j:0, l:0, r:0})), 'Something rests on this');
  assert.equal(g.canRemove(g.find({t:'floor', i:0, j:0, l:1})), '');
  // two walls under one floor: either one alone may go
  const two = gridOf(TILES(), [{t:'wall', i:0, j:0, l:0, r:0}, {t:'wall', i:0, j:1, l:0, r:0}, {t:'floor', i:0, j:0, l:1}]);
  assert.equal(two.canRemove(two.find({t:'wall', i:0, j:0, l:0, r:0})), '');
});

test('the axe removes pieces too (tool checked on the host); old guests without a tool mean the hammer', () => {
  const g = gridOf(TILES(), [{t:'wall', i:0, j:0, l:0, r:0}]);
  assert.equal(toolOf({}), 'hammer'); assert.equal(toolOf({tool:'axe'}), 'axe'); assert.equal(toolOf({tool:'spear'}), 'hammer');
  const noAxe = bagWith({hammer:1});
  assert.equal(removePiece(g, {kind:'unpiece', t:'wall', i:0, j:0, l:0, r:0, tool:'axe'}, noAxe, Bag).ok, false);
  const axe = bagWith({axe:1});
  assert.equal(removePiece(g, {kind:'unpiece', t:'wall', i:0, j:0, l:0, r:0}, axe, Bag).ok, false, 'hammer path needs a hammer');
  const r = removePiece(g, {kind:'unpiece', t:'wall', i:0, j:0, l:0, r:0, tool:'axe'}, axe, Bag);
  assert.equal(r.ok, true); assert.equal(axe.count('wood'), 2);
});

test('guest removal is host-authoritative: the actor bag gets the refund, a stale or forged action changes nothing', () => {
  const g = gridOf(TILES(), [{t:'door', i:0, j:0, l:0, r:0}]);
  const hostBag = bagWith({hammer:1}), guestBag = bagWith({hammer:1});
  // guest aimed at a "wall" in that slot, but a door is there now: no refund of the wrong kind
  assert.equal(removePiece(g, {kind:'unpiece', t:'wall', i:0, j:0, l:0, r:0}, guestBag, Bag).ok, false);
  assert.equal(removePiece(g, {kind:'unpiece', t:'constructor', i:0, j:0, l:0}, guestBag, Bag).ok, false);
  const r = removePiece(g, {kind:'unpiece', t:'door', i:0, j:0, l:0, r:0}, guestBag, Bag);
  assert.equal(r.ok, true);
  assert.equal(guestBag.count('wood'), 3); assert.equal(hostBag.count('wood'), 0);
  assert.equal(removePiece(g, {kind:'unpiece', t:'door', i:0, j:0, l:0, r:0}, guestBag, Bag).ok, false, 'second remover gets nothing');
  assert.equal(guestBag.count('wood'), 3);
});

test('foundation tiles come off with a full refund, unless something needs them', () => {
  const world = {tiles:TILES(), decor:[], pieces:[], tileHp:{'0,-1':10}, tileArmor:{'0,-1':1}};
  const g = gridOf(world.tiles, world.pieces), bag = bagWith({hammer:1});
  const r = removeFoundation(g, {kind:'untile', x:0, z:-1}, bag, world, Bag);
  assert.equal(r.ok, true, r.text);
  assert.deepEqual(world.tiles.map(t => t.join()).sort(), ['-1,-1', '-1,0', '0,0']);
  assert.equal(bag.count('wood'), 2); assert.equal(bag.count('plastic'), 2);
  assert.equal(bag.count('armor'), 1, 'the fitted Foundation Armor comes back too'); assert.match(r.text, /foundation armor/);
  assert.equal(world.tileHp['0,-1'], undefined); assert.equal(world.tileArmor['0,-1'], undefined);
  const plain = {tiles:TILES(), decor:[], pieces:[], tileArmor:{}}, pb = bagWith({hammer:1});
  assert.equal(removeFoundation(gridOf(plain.tiles, []), {kind:'untile', x:0, z:-1}, pb, plain, Bag).ok, true);
  assert.equal(pb.count('armor'), 0, 'no armor item from an unarmored tile');
  // the raft would split / the last tile / a placed item / a net / a wall resting only on it
  const line = {tiles:[[0, 0], [1, 0], [2, 0]], decor:[], pieces:[]};
  assert.equal(tileRemoveWhy(gridOf(line.tiles, []), line, 1, 0), BLOCK_TEXT.split);
  const one = {tiles:[[0, 0]], decor:[]};
  assert.equal(tileRemoveWhy(gridOf(one.tiles, []), one, 0, 0), BLOCK_TEXT.last);
  const dec = {tiles:TILES(), decor:[{type:'crate', x:0, z:0, rot:0}]};
  assert.equal(tileRemoveWhy(gridOf(dec.tiles, []), dec, 0, 0), BLOCK_TEXT.decor);
  const net = {tiles:TILES(), decor:[], nets:[{x:0, z:0, d:0}]};
  assert.equal(tileRemoveWhy(gridOf(net.tiles, []), net, 0, 0), BLOCK_TEXT.net);
  const walled = {tiles:TILES(), decor:[]}, wg = gridOf(walled.tiles, [{t:'wall', i:0, j:1, l:0, r:0}]); // outer edge of tile (0,0) only
  assert.equal(tileRemoveWhy(wg, walled, 0, 0), 'Something rests on this');
  const shared = {tiles:TILES(), decor:[]}, sg = gridOf(shared.tiles, [{t:'wall', i:0, j:0, l:0, r:0}]); // between (0,-1) and (0,0): either tile holds it
  assert.equal(tileRemoveWhy(sg, shared, 0, 0), '');
  const noTool = bagWith({});
  assert.equal(removeFoundation(gridOf(TILES(), []), {kind:'untile', x:0, z:0}, noTool, {tiles:TILES(), decor:[]}, Bag).ok, false);
});

test('game.js wires foundation removal and the axe through the host, with reach checks', () => {
  const g = src('game.js');
  const at = g.indexOf("a.kind === 'untile' && building"), apply = g.indexOf('building.applyTile(a, bag, world', at);
  assert.ok(at > 0 && apply > at);
  assert.ok(g.slice(at, apply).includes('inReach('), 'reach checked before the host applies it');
  assert.match(g, /kind === 'axe' && hostHas\('axeRemove'\) && axeLive\(\) && building\?\.chopStart\(/);
  assert.match(g, /building\?\.chop\(running && kind === 'axe'/);
});

test('no per-frame work without a removal tool: chop() returns before any ray, hints only write the DOM on change', () => {
  const b = src('building.js');
  const chop = b.slice(b.indexOf('function chop('), b.indexOf('function chop(') + 400);
  assert.match(chop, /if \(!chopHeld\) return null;/);
  assert.ok(chop.indexOf('if (!chopHeld) return null;') < chop.indexOf('axeTarget('), 'no ray before the early return');
  const h = src('build-hint.js');
  assert.match(h, /if \(m !== mode\)/); assert.match(h, /if \(q === ringP\) return;/);
});

test('an armored tile with no room for its armor item stays (all or nothing)', () => {
  const world = {tiles:TILES(), decor:[], pieces:[], tileArmor:{'0,-1':1}}, full = new Bag();
  for (let i = 0; i < full.slots.length; i++) full.slots[i] = {kind:'stone', count:20};
  full.slots[0] = {kind:'hammer', count:1, durability:100}; full.slots[1] = {kind:'wood', count:1}; full.slots[2] = {kind:'plastic', count:1};
  const r = removeFoundation(gridOf(world.tiles, []), {kind:'untile', x:0, z:-1}, full, world, Bag);
  assert.equal(r.ok, false); assert.equal(r.text, 'Your bag is full');
  assert.equal(world.tiles.length, 4); assert.equal(world.tileArmor['0,-1'], 1);
  assert.equal(full.count('wood'), 1, 'nothing refunded');
});

test('a grill on a tile (not in world.decor) and a player standing on it both refuse the removal', () => {
  const world = () => ({tiles:TILES(), decor:[], pieces:[]});
  const w1 = world(), grill = {hasGrill:(x, z) => x === 0 && z === 0};
  assert.equal(tileRemoveWhy(gridOf(w1.tiles, []), w1, 0, 0, grill), BLOCK_TEXT.decor);
  assert.equal(tileRemoveWhy(gridOf(w1.tiles, []), w1, 0, -1, grill), '', 'other tiles are fine');
  const bag = bagWith({hammer:1});
  assert.equal(removeFoundation(gridOf(w1.tiles, []), {kind:'untile', x:0, z:0}, bag, w1, Bag, grill).text, 'Clear what stands on this floor first');
  assert.equal(w1.tiles.length, 4); assert.equal(bag.count('wood'), 0);
  // a body at eye height 1.6 above the deck on tile (0,0); a guest pose without y counts by x/z
  const deckY = .2, on = {x:.3, y:deckY + 1.6, z:-.4}, near = {x:-1.1, y:deckY + 1.6, z:0}, up = {x:0, y:deckY + 2.2 + 1.6, z:0};
  assert.equal(standingOn(on, 0, 0, deckY), true); assert.equal(standingOn(near, 0, 0, deckY), true, 'overlapping the edge');
  assert.equal(standingOn(up, 0, 0, deckY), false, 'on the storey above'); assert.equal(standingOn({x:4, y:1.8, z:4}, 0, 0, deckY), false);
  assert.equal(standingOn({x:0, y:null, z:0}, 0, 0, deckY), true); assert.equal(standingOn(null, 0, 0, deckY), false);
  const w2 = world();
  assert.equal(tileRemoveWhy(gridOf(w2.tiles, []), w2, 0, 0, {bodies:[null, on], deckY}), REMOVE_TEXT.standing);
  assert.equal(removeFoundation(gridOf(w2.tiles, []), {kind:'untile', x:0, z:0}, bagWith({hammer:1}), w2, Bag, {bodies:[on], deckY}).text, 'Someone is standing there');
  assert.equal(w2.tiles.length, 4);
  assert.equal(removeFoundation(gridOf(w2.tiles, []), {kind:'untile', x:0, z:-1}, bagWith({hammer:1}), w2, Bag, {bodies:[{x:4, y:1.8, z:4}], deckY}).ok, true);
});

test('the axe never removes foundation tiles; a worn-out axe dismantles nothing', () => {
  const w = {tiles:TILES(), decor:[], pieces:[]}, axe = bagWith({axe:1, hammer:1});
  const r = removeFoundation(gridOf(w.tiles, []), {kind:'untile', x:0, z:0, tool:'axe'}, axe, w, Bag);
  assert.equal(r.ok, false); assert.equal(w.tiles.length, 4);
  const g = gridOf(TILES(), [{t:'wall', i:0, j:0, l:0, r:0}]), worn = new Bag(); worn.slots[0] = {kind:'axe', count:1, durability:0};
  const r2 = removePiece(g, {kind:'unpiece', t:'wall', i:0, j:0, l:0, r:0, tool:'axe'}, worn, Bag);
  assert.equal(r2.ok, false); assert.equal(r2.text, REMOVE_TEXT.worn); assert.equal(g.list.length, 1);
});

test('game.js: host caps announce untile + axeRemove; a guest on an old host is told so and the axe path is gated', () => {
  const g = src('game.js'), b = src('building.js');
  assert.match(g, /HOST_CAPS = Object\.freeze\(\{[^}]*untile:1[^}]*axeRemove:1/);
  assert.match(g, /hostHas = cap => role !== 'guest' \|\| !!hostCaps\?\.\[cap\]/);
  assert.match(g, /kind === 'axe' && hostHas\('axeRemove'\) && axeLive\(\) && building\?\.chopStart\(/);
  assert.match(g, /building\.applyTile\(a, bag, world, tileOptsNow\(\)\)/);
  assert.match(b, /if \(tile && capFn && !capFn\('untile'\)\) \{ oldHostFn\?\.\(\); return null; \}/);
  assert.ok(!/kind:'untile'[^}]*tool:'axe'/.test(b), 'the axe never sends untile');
});
