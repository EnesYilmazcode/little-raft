// Unit tests for the building-pieces pure module (grid rules, aiming, walking collision).
// Run: node --test tests/building-pieces.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const {
  BuildGrid, cleanPieces, pieceKey, PIECES, PIECE_ORDER, LEVEL_H, FLOOR_THICK, DIR,
} = await import(new URL('building-pieces.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));

// ---------------------------------------------------------------- helpers

const TILES3 = [];
for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) TILES3.push([i, j]);
const P = (t, i, j, l, r = 0) => ({ t, i, j, l, r });
const grid = (tiles = TILES3, pieces = []) => {
  const g = new BuildGrid();
  g.setTiles(tiles);
  for (const p of pieces) assert.ok(g.place(p), `setup place ${JSON.stringify(p)}: ${g.canPlace(p)}`);
  return g;
};
const keyOf = (p) => `${p.t}:${p.i}:${p.j}:${p.l}:${p.r}`;
const sortedKeys = (arr) => arr.map(keyOf).sort();
const DECK = 0.2;

// ============================================================ constants

test('constants and piece catalogue match the contract', () => {
  assert.equal(LEVEL_H, 2.2);
  assert.equal(FLOOR_THICK, 0.12);
  assert.deepEqual(DIR.map(d => [...d]), [[0, 1], [1, 0], [0, -1], [-1, 0]]);
  assert.deepEqual([...PIECE_ORDER], ['foundation', 'floor', 'wall', 'halfwall', 'window', 'door', 'pillar', 'stairs', 'roof', 'railing', 'hatch', 'ladder', 'gate']);
  for (const id of PIECE_ORDER) assert.equal(PIECES[id].id, id);
  assert.equal(PIECES.foundation.slot, 'tile');
  assert.deepEqual(PIECES.foundation.cost, { wood: 2, plastic: 2 });
  assert.deepEqual(PIECES.roof.cost, { wood: 1, leaf: 2 });
  assert.equal(PIECES.wall.full, true);
  assert.equal(PIECES.halfwall.full, false);
  assert.ok(Object.isFrozen(PIECES) && Object.isFrozen(PIECES.wall));
  assert.equal(typeof pieceKey('wall', 3, -4, 2, 1), 'number');
  assert.notEqual(pieceKey('wall', 0, 0, 0, 0), pieceKey('wall', 0, 0, 0, 1));
  assert.equal(pieceKey('floor', 1, 1, 1), pieceKey('roof', 1, 1, 1));
  assert.notEqual(pieceKey('floor', 1, 1, 1), pieceKey('stairs', 1, 1, 1));
});

// ======================================================== support rules

test('pillars: level 0 needs a touching tile; higher needs a pillar below or a floor', () => {
  const g = grid([[0, 0]]);
  for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) assert.equal(g.canPlace(P('pillar', i, j, 0)), '', `corner ${i},${j}`);
  assert.equal(g.canPlace(P('pillar', 2, 0, 0)), 'Needs support below');
  assert.equal(g.canPlace(P('pillar', 0, 0, 1)), 'Needs support below');
  assert.ok(g.place(P('pillar', 0, 0, 0)));
  assert.equal(g.canPlace(P('pillar', 0, 0, 0)), 'Something is already here');
  assert.equal(g.canPlace(P('pillar', 0, 0, 1)), '');
  assert.ok(g.place(P('floor', 0, 0, 1)));
  assert.equal(g.canPlace(P('pillar', 1, 1, 1)), '', 'floor at level 1 supports its corners');
  assert.equal(g.canPlace(P('pillar', 0, 0, 7)), 'Too high');
  assert.equal(g.canPlace(P('pillar', 0, 0, 0, 2)), 'Bad rotation');
});

test('edge pieces: level 0 needs a touching tile; higher needs a floor or a full-height piece below', () => {
  const g = grid([[0, 0]]);
  for (const t of ['wall', 'halfwall', 'window', 'door']) {
    assert.equal(g.canPlace(P(t, 0, 0, 0, 0)), '', `${t} south`);
    assert.equal(g.canPlace(P(t, 0, 1, 0, 0)), '', `${t} north`);
    assert.equal(g.canPlace(P(t, 1, 0, 0, 1)), '', `${t} east`);
    assert.equal(g.canPlace(P(t, 2, 0, 0, 1)), 'Needs support below', `${t} far`);
    assert.equal(g.canPlace(P(t, 0, 0, 1, 0)), 'Needs support below', `${t} floating`);
  }
  assert.ok(g.place(P('halfwall', 0, 0, 0, 0)));
  assert.equal(g.canPlace(P('wall', 0, 0, 1, 0)), 'Needs support below', 'half walls do not hold walls');
  for (const t of ['wall', 'window', 'door']) {
    const h = grid([[0, 0]], [P(t, 0, 0, 0, 1)]);
    assert.equal(h.canPlace(P('wall', 0, 0, 1, 1)), '', `${t} holds a wall`);
  }
  const f = grid([[0, 0]], [P('pillar', 0, 0, 0), P('floor', 0, 0, 1)]);
  assert.equal(f.canPlace(P('wall', 0, 1, 1, 0)), '', 'floor edge holds a wall');
  assert.equal(f.canPlace(P('wall', 0, 0, 1, 2)), 'Bad rotation');
});

test('floors and roofs: level >= 1, direct support from walls/pillars/stairs, one-cell overhang', () => {
  const g = grid([[0, 0], [1, 0], [2, 0], [3, 0]]);
  assert.equal(g.canPlace(P('floor', 0, 0, 0)), 'Build this above the deck');
  assert.equal(g.canPlace(P('roof', 0, 0, 0)), 'Build this above the deck');
  assert.equal(g.canPlace(P('floor', 0, 0, 1)), 'Needs support below');
  assert.ok(g.place(P('wall', 0, 0, 0, 0)));
  assert.equal(g.canPlace(P('floor', 0, 0, 1)), '', 'wall below an edge');
  assert.equal(g.canPlace(P('floor', 0, -1, 1)), '', 'wall is also the north edge of the cell beyond');
  assert.ok(g.place(P('floor', 0, 0, 1)));
  assert.equal(g.canPlace(P('floor', 1, 0, 1)), '', 'one-cell overhang');
  assert.ok(g.place(P('floor', 1, 0, 1)));
  assert.equal(g.canPlace(P('floor', 2, 0, 1)), 'Needs support below', 'no second overhang');
  assert.equal(g.canPlace(P('roof', 2, 0, 1)), 'Needs support below');
  assert.equal(g.canPlace(P('roof', 1, 0, 1)), 'Something is already here', 'roof shares the floor slot');
  // Pillar support and stairs landing support.
  const h = grid([[0, 0], [1, 0], [2, 0]], [P('pillar', 3, 1, 0)]);
  assert.equal(h.canPlace(P('roof', 2, 0, 1, 3)), '', 'pillar under a corner');
  assert.ok(h.place(P('stairs', 0, 0, 0, 1)));
  assert.equal(h.canPlace(P('floor', 1, 0, 1)), '', 'stairs land into this cell');
  assert.equal(h.canPlace(P('floor', 0, 1, 1)), 'Needs support below', 'stairs point elsewhere');
});

test('stairs: need a walkable bottom and are exclusive with a floor right above', () => {
  const g = grid([[0, 0], [1, 0]]);
  assert.equal(g.canPlace(P('stairs', 2, 0, 0, 0)), 'Needs support below', 'no tile');
  assert.equal(g.canPlace(P('stairs', 0, 0, 1, 0)), 'Needs support below', 'no floor at level 1');
  assert.equal(g.canPlace(P('stairs', 0, 0, 0, 4)), 'Bad rotation');
  assert.ok(g.place(P('stairs', 0, 0, 0, 1)));
  assert.equal(g.canPlace(P('stairs', 0, 0, 0, 2)), 'Something is already here');
  assert.ok(g.place(P('floor', 1, 0, 1)));
  assert.equal(g.canPlace(P('floor', 0, 0, 1)), 'Stairs are in the way');
  assert.equal(g.canPlace(P('roof', 0, 0, 1)), 'Stairs are in the way');
  assert.equal(g.canPlace(P('stairs', 1, 0, 1, 0)), '', 'stairs on an upper floor');
  // Floor first, then stairs below it is refused.
  const h = grid([[0, 0]], [P('wall', 0, 0, 0, 0), P('floor', 0, 0, 1)]);
  assert.equal(h.canPlace(P('stairs', 0, 0, 0, 0)), 'Floor above is in the way');
  assert.equal(h.canPlace(P('stairs', 0, 0, 1, 0)), '', 'stairs can stand on the floor');
  assert.equal(h.canPlace(P('wall', 30, 0, 0, 0)), 'Too far out');
  assert.equal(h.canPlace({ t: 'boat', i: 0, j: 0, l: 0, r: 0 }), 'Unknown piece');
  assert.equal(h.canPlace(P('foundation', 0, 0, 0)), 'Unknown piece');
});

// =============================================================== removal

test('removal is refused while something rests on a piece, then succeeds bottom-up', () => {
  const g = grid([[0, 0]], [P('wall', 0, 0, 0, 0), P('floor', 0, 0, 1), P('pillar', 1, 1, 1), P('wall', 0, 1, 1, 0)]);
  const v = g.version;
  assert.equal(g.canRemove(P('wall', 0, 0, 0, 0)), 'Something rests on this');
  assert.equal(g.remove(P('wall', 0, 0, 0, 0)), false);
  assert.equal(g.canRemove(P('floor', 0, 0, 1)), 'Something rests on this');
  assert.equal(g.version, v, 'failed removals do not change anything');
  assert.equal(g.canRemove(P('wall', 5, 5, 0, 0)), 'Nothing to remove');
  assert.equal(g.canRemove(P('halfwall', 0, 0, 0, 0)), 'Nothing to remove', 'type must match');
  assert.ok(g.remove(P('wall', 0, 1, 1, 0)));
  assert.ok(g.remove(g.find(P('pillar', 1, 1, 1))));
  assert.ok(g.remove(P('floor', 0, 0, 1)));
  assert.ok(g.remove(P('wall', 0, 0, 0, 0)));
  assert.equal(g.list.length, 0);
  assert.ok(g.version > v);
  // A redundant support can go.
  const h = grid([[0, 0]], [P('wall', 0, 0, 0, 0), P('wall', 0, 1, 0, 0), P('floor', 0, 0, 1)]);
  assert.equal(h.canRemove(P('wall', 0, 0, 0, 0)), '');
  assert.ok(h.remove(P('wall', 0, 0, 0, 0)));
  assert.equal(h.canRemove(P('wall', 0, 1, 0, 0)), 'Something rests on this');
});

// ================================================================== load

test('load() sanitises garbage, dedupes, and is independent of input order', () => {
  const good = [
    P('wall', 0, 0, 0, 0), P('wall', 0, 0, 1, 0), P('floor', 0, 0, 1), P('floor', 0, 1, 1),
    P('stairs', 1, 0, 0, 3), P('pillar', 1, 1, 0), P('roof', 0, 0, 2, 2), P('wall', 0, 0, 2, 0),
  ];
  const junk = [
    null, 7, 'wall', {}, { t: 'wall' }, { t: 'wall', i: 0.5, j: 0, l: 0, r: 0 }, { t: 'wall', i: '0', j: 0, l: 0, r: 0 },
    { t: 'laser', i: 0, j: 0, l: 0, r: 0 }, { t: 'foundation', i: 0, j: 0, l: 0, r: 0 }, P('wall', 99, 0, 0, 0),
    P('wall', 0, 0, 9, 0), P('floor', 0, 0, 0), P('floor', 0, 0, -1), P('wall', 0, 0, 0, 3), P('stairs', 0, 0, 0, 9),
    { t: 'wall', i: NaN, j: 0, l: 0, r: 0 }, P('floor', 5, 5, 1), P('wall', 0, 0, 0, 0), P('roof', 0, 1, 1, 0),
    P('floor', 1, 0, 1), { t: 'pillar', i: 0, j: 0, l: 0, r: 7 },
  ];
  const tiles = [[0, 0], [1, 0], [0, 1]];
  const clean = cleanPieces([...junk, ...good], tiles);
  const expected = [
    'floor:0:0:1:0', 'floor:0:1:1:0', 'pillar:0:0:0:0', 'pillar:1:1:0:0', 'roof:0:0:2:2', 'stairs:1:0:0:3',
    'wall:0:0:0:0', 'wall:0:0:1:0', 'wall:0:0:2:0',
  ].sort();
  assert.deepEqual(sortedKeys(clean), expected);
  for (const p of clean) assert.deepEqual(Object.keys(p).sort(), ['i', 'j', 'l', 'r', 't']);
  // Reverse and shuffled orders give the same result.
  const all = [...good, ...junk];
  assert.deepEqual(sortedKeys(cleanPieces([...all].reverse(), tiles)), expected);
  let seed = 7;
  for (let n = 0; n < 5; n++) {
    const sh = [...all].sort(() => ((seed = (seed * 16807) % 2147483647) & 1) - 0.5);
    assert.deepEqual(sortedKeys(cleanPieces(sh, tiles)), expected, `shuffle ${n}`);
  }
  assert.deepEqual(cleanPieces('nope', tiles), []);
  assert.deepEqual(cleanPieces(good, []), [], 'no tiles -> nothing is supported');
  const g = new BuildGrid(); g.setTiles(tiles);
  const v = g.version;
  g.load(good);
  assert.ok(g.version > v);
  assert.equal(g.list.length, good.length);
});

test('load() keeps at most 600 pieces', () => {
  const tiles = [];
  for (let i = -15; i <= 15; i++) for (let j = -15; j <= 15; j++) tiles.push([i, j]);
  const raw = [];
  for (let i = -15; i <= 16; i++) for (let j = -15; j <= 16; j++) raw.push(P('pillar', i, j, 0));
  assert.equal(raw.length, 1024);
  assert.equal(cleanPieces(raw, tiles).length, 600);
});

// ================================================================= aim

test('aim() picks the raft-edge wall slot when looking at the deck near the edge', () => {
  const g = grid();
  const eye = [0, DECK + 1.6, 0];
  const tgt = [2.8, DECK, 0.1];
  const d = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]];
  const out = { ok: false };
  const res = g.aim(...eye, ...d, 'wall', 0, DECK, 6, out);
  assert.equal(res, out);
  assert.equal(out.ok, true, out.reason);
  assert.deepEqual([out.t, out.i, out.j, out.l, out.r], ['wall', 2, 0, 0, 1]);
  assert.deepEqual([out.x, out.y, out.z], [3, DECK, 0]);
  // Same ray toward the south edge of the raft chooses an axis-0 edge.
  const s = g.aim(0, DECK + 1.6, 0, 0.1, -1.6, -2.8, 'wall', 0, DECK, 6);
  assert.deepEqual([s.i, s.j, s.l, s.r, s.ok], [0, -1, 0, 0, true]);
  // Nothing in reach -> null.
  assert.equal(g.aim(0, DECK + 1.6, 0, 1, 0.2, 0, 'wall', 0, DECK, 6), null);
  assert.equal(g.aim(0, DECK + 1.6, 0, 1, -0.3, 0, 'wall', 0, DECK, 1), null);
});

test('aim() picks the ceiling floor slot when looking up at the top of the walls', () => {
  const g = grid(TILES3, [P('wall', 0, 0, 0, 0), P('wall', 0, 1, 0, 0), P('wall', 0, 0, 0, 1), P('wall', 1, 0, 0, 1)]);
  const out = {};
  const res = g.aim(0, DECK + 1.6, 0, 0, 0.5, 0.93, 'floor', 2, DECK, 6, out);
  assert.ok(res);
  assert.equal(out.ok, true, out.reason);
  assert.deepEqual([out.t, out.i, out.j, out.l, out.r], ['floor', 0, 0, 1, 2]);
  assert.ok(Math.abs(out.y - (DECK + LEVEL_H)) < 1e-9);
  // A wall aimed at the top of a wall stacks on it.
  const w = g.aim(0, DECK + 1.6, 0, 0, 0.5, 0.93, 'wall', 0, DECK, 6);
  assert.deepEqual([w.i, w.j, w.l, w.r, w.ok], [0, 1, 1, 0, true]);
  // Occupied slot is reported, not silently accepted.
  g.place(P('floor', 0, 0, 1));
  const again = g.aim(0, DECK + 1.6, 0, 0, 0.5, 0.93, 'floor', 0, DECK, 6);
  assert.ok(again.ok ? !(again.i === 0 && again.j === 0 && again.l === 1) : again.reason);
});

test('pick() returns the first piece hit along the ray', () => {
  const g = grid(TILES3, [P('wall', 1, 0, 0, 1), P('wall', 2, 0, 0, 1)]);
  assert.deepEqual(g.pick(0, DECK + 1.6, 0, 1, 0, 0, DECK, 6), P('wall', 1, 0, 0, 1));
  assert.equal(g.pick(0, DECK + 1.6, 0, -1, 0, 0, DECK, 6), null);
  assert.equal(g.pick(0, DECK + 1.6, 0, 1, 0, 0, DECK, 0.5), null, 'out of reach');
  // Rebuild after removal.
  g.remove(P('wall', 1, 0, 0, 1));
  assert.deepEqual(g.pick(0, DECK + 1.6, 0, 1, 0, 0, DECK, 6), P('wall', 2, 0, 0, 1));
});

// ============================================================= physics

const DT = 1 / 60;
function simulate(g, phys, seconds, input, deckY = DECK, trace) {
  for (let n = 0; n < Math.round(seconds / DT); n++) {
    const prevY = phys.y;
    const surf = g.preStep(phys, deckY);
    phys.update(DT, { ...input, tiles: surf.tiles, deckY: surf.deckY, waterY: -0.24 });
    g.postStep(phys, deckY);
    if (trace) trace(phys, prevY);
  }
}
// 3x3 raft; stairs at (0,0) rise toward +x onto a floor at (1,0,1); pillars, a ground wall and an upper wall at x=3.
const house = () => grid(TILES3, [
  P('stairs', 0, 0, 0, 1), P('pillar', 2, 0, 0), P('pillar', 2, 1, 0), P('wall', 1, 0, 0, 0),
  P('floor', 1, 0, 1), P('wall', 2, 0, 1, 1),
]);

test('physics: walking up the stairs ends on the upper floor, stopped by the upper wall', () => {
  const g = house();
  const phys = new PlayerPhysics({ x: -2, y: DECK + PC.EYE_OFFSET, z: 0 });
  let maxJump = 0;
  simulate(g, phys, 4, { forward: 1, yaw: -Math.PI / 2 }, DECK, (p, prev) => { maxJump = Math.max(maxJump, Math.abs(p.y - prev)); });
  const feet = phys.y - PC.EYE_OFFSET;
  assert.ok(Math.abs(feet - (DECK + LEVEL_H)) < 0.01, `feet ${feet}`);
  assert.ok(phys.grounded);
  assert.ok(phys.x > 1 && phys.x <= 3 - 0.07 - PC.BODY_RADIUS + 1e-6, `x ${phys.x}`);
  assert.ok(maxJump < 0.6, `no big jumps (${maxJump})`);
});

test('physics: walking into a wall does not pass through it', () => {
  const g = house();
  const phys = new PlayerPhysics({ x: 2, y: DECK + PC.EYE_OFFSET, z: -2.2 });
  simulate(g, phys, 3, { forward: 1, yaw: Math.PI }); // forward = +z
  assert.ok(phys.z <= -1 - 0.07 - PC.BODY_RADIUS + 1e-6, `z ${phys.z}`);
  assert.ok(Math.abs(phys.y - PC.EYE_OFFSET - DECK) < 1e-6);
  // Diagonal shove into the stair-side pillar also holds.
  const q = new PlayerPhysics({ x: 1.5, y: DECK + PC.EYE_OFFSET, z: 2.5 });
  simulate(g, q, 3, { forward: 1, yaw: 3 * Math.PI / 4 }); // toward (+x, -z), at pillar corner (3,1)
  assert.ok(Math.hypot(q.x - 3, q.z - 1) >= 0.11 + PC.BODY_RADIUS - 1e-6);
});

test('physics: walking off the upper floor edge falls (no teleport) and lands on the deck', () => {
  const g = house();
  const phys = new PlayerPhysics({ x: 2, y: DECK + LEVEL_H + PC.EYE_OFFSET, z: 0 });
  simulate(g, phys, 0.2, {});
  assert.ok(phys.grounded && Math.abs(phys.y - PC.EYE_OFFSET - DECK - LEVEL_H) < 1e-6, 'stands on the floor');
  let maxDrop = 0, airborne = false;
  const watch = (p, prev) => { maxDrop = Math.max(maxDrop, prev - p.y); if (!p.grounded) airborne = true; };
  simulate(g, phys, 1.0, { forward: 0.6, yaw: Math.PI }, DECK, watch); // stroll toward +z, past the floor edge at z=1
  simulate(g, phys, 1.5, {}, DECK, watch);
  assert.ok(phys.z > 1 && phys.z < 3, `z ${phys.z}`);
  assert.ok(airborne, 'was falling');
  assert.ok(maxDrop < 0.4, `per-frame drop ${maxDrop}`);
  assert.ok(phys.grounded);
  assert.ok(Math.abs(phys.y - PC.EYE_OFFSET - DECK) < 1e-6, `feet ${phys.y - PC.EYE_OFFSET}`);
});

test('physics: jumping under a floor bonks the head instead of passing through', () => {
  const g = grid(TILES3, [P('wall', 0, 0, 0, 0), P('floor', 0, 0, 1)]);
  const phys = new PlayerPhysics({ x: 0, y: DECK + PC.EYE_OFFSET, z: 0 });
  simulate(g, phys, 0.1, {});
  let maxHead = 0;
  simulate(g, phys, 1, { jump: true }, DECK, p => { maxHead = Math.max(maxHead, p.y + 0.15); });
  assert.ok(maxHead <= DECK + LEVEL_H - FLOOR_THICK + 1e-6, `head ${maxHead}`);
  assert.ok(phys.grounded);
});

test('preStep/postStep reuse their scratch objects', () => {
  const g = house();
  const phys = new PlayerPhysics({ x: 2, y: DECK + LEVEL_H + PC.EYE_OFFSET, z: 0 });
  const a = g.preStep(phys, DECK);
  assert.equal(a.deckY, DECK + LEVEL_H);
  assert.deepEqual(a.tiles, [[1, 0]]);
  phys.x = -2; phys.y = DECK + PC.EYE_OFFSET;
  const b = g.preStep(phys, DECK);
  assert.equal(a, b);
  assert.equal(b.deckY, DECK);
  assert.equal(b.tiles, TILES3);
});
