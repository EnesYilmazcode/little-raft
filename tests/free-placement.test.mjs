// Free placement of placeables (crates, decor, stations): exact positions, flush neighbours, footprint checks,
// saves and co-op. Structural pieces keep the grid (build-rules.js). Run: node --test tests/free-placement.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const P = await import(new URL('placement.js', base));
const T = await import(new URL('vendor/three.module.js', base));
const { DeltaEncoder, DeltaDecoder, quantize } = await import(new URL('coop-delta.js', base));
const gameSrc = readFileSync(new URL('game.js', base), 'utf8');

const { freeBlock, edgeSnap, pieceRects, cleanDecor, FOOTPRINT, setFootprint, measureFootprint, footprintOf, roundCoord, ROT_STEP } = P;
const TYPES = ['crate', 'candle', 'bench', 'lantern', 'nestbox'];
const grid = (x0, x1, z0, z1) => { const t = []; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) t.push([x, z]); return t; };
const deck = tiles => { const s = new Set(tiles.map(t => t[0] + ',' + t[1])); return (x, z) => s.has(x + ',' + z); };
const env = (decor, pieces = [], tiles = grid(-1, 1, -1, 1)) => ({hasTile:deck(tiles), decor, pieceRects:pieceRects(pieces), extra:[], radii:{}});
const crate = (xm, zm, rot = 0) => ({type:'crate', x:roundCoord(xm / 2), z:roundCoord(zm / 2), rot}); // metres in, tile units stored
const W = FOOTPRINT.crate[0] * 2; // crate width along x (.98 m)

test('two crates placed flush with 0 gap are accepted', () => {
  const a = crate(0, 0), b = crate(W, 0);
  assert.equal(freeBlock(env([a]), b), null, 'exactly touching');
  assert.equal(Math.abs(b.x * 2 - a.x * 2) - W, 0, '0 gap');
  // Aiming 3 cm short of flush: the edge snap closes the gap to exactly 0 (no grid, no tile centre).
  const c = crate(W + .03, 0);
  edgeSnap(env([a]), c);
  assert.ok(Math.abs(c.x * 2 - W) < .0021, `snapped flush: ${c.x * 2}`);
  assert.equal(freeBlock(env([a]), c), null);
  // Aiming 3 cm into it slides it out to flush as well.
  const d = crate(W - .03, 0); edgeSnap(env([a]), d);
  assert.ok(Math.abs(d.x * 2 - W) < .0021, `pushed flush: ${d.x * 2}`);
  // Far away there is nothing to snap to: the crate stays exactly where it was aimed.
  const e = crate(1.234, -.777); edgeSnap(env([a]), e);
  assert.deepEqual([e.x, e.z], [roundCoord(1.234 / 2), roundCoord(-.777 / 2)]);
});

test('a row of crates packs tight across tile borders, off the tile centres', () => {
  const row = [];
  for (let i = 0; i < 5; i++) { const c = crate(-2.4 + i * W + .02, -1.1); edgeSnap(env(row), c); assert.equal(freeBlock(env(row), c), null, `crate ${i}`); row.push(c); }
  for (let i = 1; i < row.length; i++) assert.ok(Math.abs((row[i].x - row[i - 1].x) * 2 - W) < .0021, `gap ${i}`);
  assert.ok(row.some(c => !Number.isInteger(c.x)), 'positions are not tile centres');
});

test('four small items fit on one tile', () => {
  const list = [];
  for (const [x, z] of [[1.6, 1.6], [2.4, 1.6], [1.6, 2.4], [2.4, 2.4]]) {
    const d = {type:'candle', x:x / 2, z:z / 2, rot:0};
    assert.equal(freeBlock(env(list), d), null); list.push(d);
  }
  assert.equal(new Set(list.map(d => Math.round(d.x) + ',' + Math.round(d.z))).size, 1, 'all on tile (1, 1)');
});

test('an overlapping placement is rejected, rotation included', () => {
  const a = crate(0, 0);
  assert.equal(freeBlock(env([a]), crate(W - .05, 0)), 'overlap');
  assert.equal(freeBlock(env([a]), crate(.3, .3)), 'overlap');
  // Turned 45 degrees, a crate at 1.05 m reaches into its neighbour's corner; square to it, it would not.
  assert.equal(freeBlock(env([a]), crate(1.05, 0, Math.PI / 4)), 'overlap');
  assert.equal(freeBlock(env([a]), crate(1.05, 0, 0)), null);
  assert.equal(ROT_STEP, Math.PI / 12, 'R turns placeables in 15 degree steps');
});

test('clipping into a wall or pillar is rejected; flush against it is fine; off the deck is refused', () => {
  const wall = {t:'wall', i:0, j:0, l:0, r:0}; // the -z side of cell (0, 0): along x at z = -1 m, 7 cm half thick
  const hd = FOOTPRINT.crate[1];
  assert.equal(freeBlock(env([], [wall]), crate(0, -1 + .07 + hd - .03)), 'overlap', 'into the wall');
  const flush = crate(0, -1 + .07 + hd + .02); edgeSnap(env([], [wall]), flush);
  assert.ok(Math.abs(flush.z * 2 - (-1 + .07 + hd)) < .0021, 'snapped flush against the wall');
  assert.equal(freeBlock(env([], [wall]), flush), null);
  assert.equal(freeBlock(env([], [{t:'pillar', i:1, j:1, l:0, r:0}]), crate(.6, .6)), 'overlap', 'pillar at (1, 1) m');
  assert.equal(freeBlock(env([], [{t:'wall', i:0, j:0, l:1, r:0}]), crate(0, -1 + .07 + hd - .03)), null, 'upper-level walls do not touch the deck');
  assert.equal(freeBlock(env([], [{t:'stairs', i:1, j:0, l:0, r:0}]), crate(1.6, 0)), 'overlap', 'stairs fill their cell');
  assert.equal(freeBlock(env([]), crate(2.8, 0)), 'nofloor', 'hanging off the raft edge');
  assert.equal(freeBlock(env([]), crate(3 - FOOTPRINT.crate[0], 0)), null, 'flush with the raft edge');
});

test('save/load round trip keeps exact positions and rotation', () => {
  const tiles = grid(-1, 1, -1, 1), has = deck(tiles);
  const placed = [crate(-.51, .27, ROT_STEP * 5), crate(.47, .27), {type:'candle', x:.833, z:-.417, rot:2.618}];
  const saved = JSON.parse(JSON.stringify({tiles, decor:placed}));
  const used = new Set(), back = saved.decor.map(d => cleanDecor(d, TYPES, has, used));
  assert.deepEqual(back, placed.map(d => d.rot ? {type:d.type, x:d.x, z:d.z, rot:Math.round(d.rot * 1000) / 1000} : {type:d.type, x:d.x, z:d.z}));
  assert.equal(cleanDecor({type:'crate', x:back[0].x, z:back[0].z}, TYPES, has, used), null, 'never two entries on one exact spot');
  assert.equal(cleanDecor({type:'crate', x:5.2, z:0}, TYPES, has, new Set()), null, 'centre off the raft');
  assert.equal(cleanDecor({type:'crate', x:NaN, z:0}, TYPES, has, new Set()), null);
  assert.equal(cleanDecor({type:'rocket', x:0, z:0}, TYPES, has, new Set()), null, 'unknown type');
  assert.match(gameSrc, /const e = cleanDecor\(d, DECOR_TYPES, \(x, z\) => seen\.has\(x \+ ',' \+ z\), used\)/, 'cleanWorld uses it');
});

test('an old tile-centred save loads exactly where it was', () => {
  const has = deck(grid(-1, 1, -1, 1)), used = new Set();
  assert.deepEqual(cleanDecor({type:'crate', x:-1, z:1}, TYPES, has, used), {type:'crate', x:-1, z:1}, 'integer cell, no rot: tile centre (-2, 2) m');
  assert.deepEqual(cleanDecor({type:'bench', x:1, z:0, rot:Math.PI / 2}, TYPES, has, used), {type:'bench', x:1, z:0, rot:1.571});
  // Old saves held one item per tile at its centre; those never collide under the footprint test either.
  assert.equal(freeBlock(env([crate(-2, 2)]), crate(0, 2)), null);
});

test('co-op: an exact placement goes guest -> host -> guest unchanged', () => {
  // Guest aims and snaps flush, sends the action; the host re-checks the same footprint test and stores it.
  const host = {tiles:grid(-1, 1, -1, 1), decor:[crate(0, 0)]};
  const aim = crate(W + .02, .123, ROT_STEP * 12); edgeSnap(env(host.decor, [], host.tiles), aim);
  const a = JSON.parse(JSON.stringify({kind:'build', recipe:'crate', x:aim.x, z:aim.z, rot:aim.rot})); // the wire
  const [px, pz] = P.cleanDecorPos(a.x, a.z), spot = {type:a.recipe, x:px, z:pz, rot:a.rot};
  assert.equal(freeBlock(env(host.decor, [], host.tiles), spot), null, 'host accepts it');
  host.decor.push({type:a.recipe, x:px, z:pz, rot:Math.round(a.rot * 1000) / 1000});
  // Host state goes out quantized to 3 decimals and delta-encoded (coop.js); the guest cleans it like a save.
  const enc = new DeltaEncoder(), dec = new DeltaDecoder(), wire = v => JSON.parse(JSON.stringify(v));
  dec.decode(wire(enc.encode(quantize({type:'state', world:{tiles:host.tiles, decor:[host.decor[0]]}}, 3))));
  const got = dec.decode(wire(enc.encode(quantize({type:'state', world:host}, 3))));
  const has = deck(got.world.tiles), used = new Set(), guest = got.world.decor.map(d => cleanDecor(d, TYPES, has, used));
  assert.deepEqual(guest, host.decor.map(d => d.rot ? d : {type:d.type, x:d.x, z:d.z}));
  assert.ok(!Number.isInteger(guest[1].x), 'an exact, off-centre spot');
  // Hosts advertise it; a guest of an old host keeps the old one-per-tile grid that host still accepts.
  assert.match(gameSrc, /HOST_CAPS = Object\.freeze\(\{undecor:1, free:1\}\)/);
  assert.match(gameSrc, /const freePlacement = \(\) => role !== 'guest' \|\| !!hostCaps\?\.free;/);
});

test('footprints are measured from the model below head height', () => {
  const g = new T.Group(), body = new T.Mesh(new T.BoxGeometry(.6, .5, .4)), top = new T.Mesh(new T.BoxGeometry(3, .1, 3));
  body.position.y = .25; top.position.y = 2.5; g.add(body, top); g.position.set(7, 0, 3); g.rotation.y = 1; // placement elsewhere does not matter
  assert.deepEqual(measureFootprint(T, 'testbox', g), [.3, .2]);
  assert.deepEqual(footprintOf('nothing-measured', {['nothing-measured']:.35}), [.35, .35], 'collision radius fallback');
});

test('every placeable has a fixed footprint, the same on host and guest from the first frame', async () => {
  const { PLACEABLE_IDS } = await import(new URL('items.js', base)), { CONTENT_DECOR } = await import(new URL('content-items.js', base));
  const base0 = gameSrc.match(/const DECOR_TYPES = Object\.freeze\(\[\.\.\.new Set\(\[([^\]]*)/)[1].match(/'([a-z]+)'/g).map(s => s.slice(1, -1));
  assert.ok(base0.includes('crate') && base0.includes('purifier'), 'base decor list parsed');
  for (const t of new Set([...base0, ...PLACEABLE_IDS, ...CONTENT_DECOR])) {
    assert.ok(P.hasFootprint(t), `${t} has a fixed footprint`);
    const f = footprintOf(t, {[t]:.05});
    assert.ok(f[0] >= .08 && f[1] >= .08 && f[0] <= 1.4 && f[1] <= 1.4, `${t} footprint in range: ${f}`);
  }
  // A model measured later never changes a listed footprint (a guest that measured differently cannot disagree).
  const before = footprintOf('candle'); setFootprint('candle', .5, .5);
  assert.deepEqual(footprintOf('candle'), before);
  assert.deepEqual(footprintOf('bed'), P.MODEL_FOOTPRINT.bed);
  assert.doesNotMatch(gameSrc, /decorGroups\.push\([^\n]*ensureFootprint/, 'loading a raft builds no ghost models to measure');
});
