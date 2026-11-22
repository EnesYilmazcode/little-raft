// Building pack: Railing, Hatch, Ladder, Gate (docs/specs/building-pack.md).
// Grid rules, the `o` record field, collision with the real PlayerPhysics, ladder climbing with the real MoveFeel,
// paint keys, the animals walk graph and the piece models.
// Run: node --test tests/building-pack.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { BuildGrid, cleanPieces, toRec, PIECES, PIECE_ORDER, STATEFUL, LEVEL_H, FLOOR_THICK, DIR, RAIL_H, RAIL_GUARD } = await import(new URL('building-pieces.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));
const { MoveFeel } = await import(new URL('move-feel.js', base));
const paint = await import(new URL('paint.js', base));
const AC = await import(new URL('animals-core.js', base));
const T = await import(new URL('vendor/three.module.js', base));
const { createPieceGeometry, pieceBounds, PIECE_TYPES } = await import(new URL('building-models.js', base));

const EYE = PC.EYE_OFFSET, R = PC.BODY_RADIUS, HEAD = 0.15, WATER = -0.24, D0 = 0.2;
const P = (t, i, j, l, r = 0) => ({ t, i, j, l, r });
const tilesSq = (n) => { const a = []; for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) a.push([i, j]); return a; };
const grid = (tiles, pieces) => {
  const g = new BuildGrid();
  g.setTiles(tiles);
  for (const p of pieces) assert.ok(g.place(p), `setup place ${JSON.stringify(p)}: ${g.canPlace(p)}`);
  return g;
};
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const VARIANTS = [{ dt: 1 / 60, bob: 0 }, { dt: 1 / 20, bob: 0 }, { dt: 1 / 60, bob: 0.15 }, { dt: 1 / 20, bob: 0.15 }];
const tag = (v) => `dt=1/${Math.round(1 / v.dt)} bob=${v.bob}`;
const eyeAt = (feet) => D0 + feet + EYE;

function penetration(g, ph, deckY) {
  g._rebuild();
  const b = g._solid, feet = ph.y - EYE, lo = feet + (ph.grounded ? 0.55 : 0.05), hi = ph.y + 0.15;
  let m = 0;
  for (let k = 0; k < g._solidN * 6; k += 6) {
    if (b[k + 4] + deckY <= lo || b[k + 1] + deckY >= hi) continue;
    const px = Math.min(Math.max(ph.x, b[k]), b[k + 3]), pz = Math.min(Math.max(ph.z, b[k + 2]), b[k + 5]);
    m = Math.max(m, R - Math.hypot(ph.x - px, ph.z - pz));
  }
  return m;
}

// The game's movement loop (game.js movePlayer), including the ladder hook when `feel` is given.
function run(g, ph, seconds, input, v, state = { t: 0 }, feel = null) {
  const out = [];
  for (let n = 0; n < Math.round(seconds / v.dt); n++) {
    state.t += v.dt;
    const deckY = D0 + v.bob * Math.sin(state.t * 2 * Math.PI / 2.5);
    const inp = typeof input === 'function' ? input(ph, n) : input;
    const c = feel ? g.climb(feel, state.ph ?? ph, deckY, { forward: inp.forward ?? 0, jump: !!inp.jump, yaw: inp.yaw ?? 0 }, v.dt) : undefined;
    const surf = g.preStep(ph, deckY, c);
    ph.update(v.dt, { ...inp, tiles: surf.tiles, deckY: surf.deckY, waterY: WATER });
    g.postStep(ph, deckY);
    state.deck = deckY;
    out.push({ x: ph.x, y: ph.y, z: ph.z, feet: ph.y - EYE - deckY, grounded: ph.grounded, swimming: ph.swimming,
      climbing: c !== undefined, onLadder: feel ? feel.isOnLadder() : false, pen: penetration(g, ph, deckY), deckY });
  }
  return out;
}
const maxOf = (tr, f) => tr.reduce((m, s) => Math.max(m, f(s)), -Infinity);
const noPen = (tr, msg, tol = 1e-6) => assert.ok(maxOf(tr, s => s.pen) <= tol, `${msg}: inside a solid by ${maxOf(tr, s => s.pen)}`);

// ============================================================ catalogue, records

test('pack pieces: catalogue, appended order, stateful set', () => {
  assert.deepEqual(PIECE_ORDER.slice(-4), ['railing', 'hatch', 'ladder', 'gate']);
  assert.deepEqual(PIECES.railing.cost, { wood: 1, rope: 1 });
  assert.deepEqual(PIECES.hatch.cost, { wood: 3, rope: 1 });
  assert.deepEqual(PIECES.ladder.cost, { wood: 3, rope: 1 });
  assert.deepEqual(PIECES.gate.cost, { wood: 2, rope: 1 });
  assert.equal(PIECES.railing.slot, 'edge'); assert.equal(PIECES.gate.slot, 'edge');
  assert.equal(PIECES.hatch.slot, 'cell'); assert.equal(PIECES.ladder.slot, 'cell');
  for (const t of ['railing', 'hatch', 'ladder', 'gate']) assert.equal(PIECES[t].full, false);
  // The guard box, not the visible rail, stops jumps: it clears the jump apex plus ~0.25 m of deck bob.
  assert.ok(RAIL_GUARD >= PC.JUMP_IMPULSE ** 2 / (2 * PC.GRAVITY) + 0.25, 'railing guard is above the jump height');
  assert.ok(RAIL_GUARD <= LEVEL_H + 0.55, 'guard stays within a step of the storey above');
  assert.deepEqual(Object.keys(STATEFUL).sort(), ['gate', 'hatch']);
});

test('toRec / load keep o:1 only on an open hatch or gate; closed records are the old shape', () => {
  assert.deepEqual(toRec({ t: 'hatch', i: 0, j: 0, l: 1, r: 2, o: 1 }), { t: 'hatch', i: 0, j: 0, l: 1, r: 2, o: 1 });
  for (const o of [2, true, '1', 0, null, undefined]) {
    const r = toRec({ t: 'hatch', i: 0, j: 0, l: 1, r: 0, o });
    assert.deepEqual(r, { t: 'hatch', i: 0, j: 0, l: 1, r: 0 }); assert.equal('o' in r, false);
  }
  assert.equal('o' in toRec({ t: 'floor', i: 0, j: 0, l: 1, r: 0, o: 1 }), false);
  assert.equal(toRec({ t: 'pillar', i: 0, j: 0, l: 0, r: 3 }).r, 0);
  const tiles = tilesSq(2);
  const raw = [P('wall', 0, 0, 0, 0), P('wall', 0, 1, 0, 0), P('wall', 1, 0, 0, 1), P('wall', 0, 0, 0, 1),
    { ...P('hatch', 0, 0, 1), o: 1 }, { ...P('floor', 1, 0, 1), o: 1 }, { ...P('gate', 1, 1, 0, 0), o: true }, { ...P('gate', -1, 1, 0, 0), o: 1 },
    { ...P('railing', 0, 2, 0, 0), o: 1 }];
  const out = cleanPieces(raw, tiles);
  const by = t => out.filter(p => p.t === t);
  assert.equal(by('hatch')[0].o, 1);
  assert.equal('o' in by('floor')[0], false);
  assert.deepEqual(by('gate').map(p => p.o ?? 0).sort(), [0, 1]);
  assert.equal('o' in by('railing')[0], false);
  // A closed / old save round-trips byte-identically.
  const old = [P('wall', 0, 0, 0, 0), P('wall', 0, 1, 0, 0), P('floor', 0, 0, 1), P('railing', 2, 0, 0, 1), P('hatch', 1, 0, 1)];
  const once = cleanPieces(old, tiles);
  assert.equal(JSON.stringify(cleanPieces(once, tiles)), JSON.stringify(once));
  for (const p of once) assert.deepEqual(Object.keys(p), ['t', 'i', 'j', 'l', 'r']);
  // An open hatch reloads open.
  const open = cleanPieces(out, tiles);
  assert.equal(open.find(p => p.t === 'hatch').o, 1);
});

// ============================================================ rules

test('hatch: floor-like support, l >= 1, nothing stands on it', () => {
  const g = grid(tilesSq(2), [P('wall', 0, 0, 0, 0), P('wall', 0, 1, 0, 0)]);
  assert.equal(g.canPlace(P('hatch', 1, 1, 0)), 'Build this above the deck');
  assert.equal(g.canPlace(P('hatch', 2, 2, 1)), 'Needs support below');
  assert.equal(g.canPlace(P('hatch', 0, 0, 1)), '');
  g.place(P('hatch', 0, 0, 1));
  assert.equal(g.canPlace(P('hatch', 1, 0, 1)), '', 'one-cell overhang like a floor');
  assert.equal(g.canPlace(P('floor', 0, 0, 1)), 'Something is already here');
  for (const p of [P('pillar', 1, 1, 1), P('wall', 0, 0, 1, 1), P('ladder', 0, 0, 1, 0), P('stairs', 0, 0, 1, 0), P('railing', 0, 0, 1, 1)])
    assert.equal(g.canPlace(p), 'Needs support below', p.t);
  // A floor-supported edge sits on a floor only.
  g.place(P('floor', 1, 0, 1));
  assert.equal(g.canPlace(P('railing', 1, 0, 1, 0)), '');
});

test('ladder + hatch above is allowed; ladder + floor above and hatch over stairs are refused', () => {
  const tiles = tilesSq(2);
  let g = grid(tiles, [P('ladder', 0, 0, 0, 0), P('floor', 0, 1, 1)]);
  assert.equal(g.canPlace(P('hatch', 0, 0, 1)), '');
  assert.equal(g.canPlace(P('floor', 0, 0, 1)), 'Stairs are in the way');
  g.place(P('hatch', 0, 0, 1, 3));
  assert.equal(g.find(P('hatch', 0, 0, 1)).r, 0, 'a hatch over a ladder takes its rotation (the ladder side opens)');
  const loaded = cleanPieces([P('floor', 1, 0, 1), P('hatch', 0, 0, 1, 2), P('ladder', 0, 0, 0, 1)], tiles);
  assert.equal(loaded.find(p => p.t === 'hatch').r, 1, 'also on load');
  g = grid(tiles, [P('stairs', 0, 0, 0, 0), P('floor', 0, 1, 1)]);
  assert.equal(g.canPlace(P('hatch', 0, 0, 1)), 'Stairs are in the way');
  g = grid(tiles, [P('wall', 0, 0, 0, 0), P('wall', 0, 1, 0, 0), P('floor', 0, 0, 1), P('hatch', 1, 0, 1)]);
  assert.equal(g.canPlace(P('ladder', 0, 0, 0, 1)), 'Floor above is in the way');
  assert.equal(g.canPlace(P('ladder', 1, 0, 0, 0)), '');
  assert.equal(g.canPlace(P('stairs', 1, 0, 0, 0)), 'Floor above is in the way');
});

test('a ladder supports its landing floor; toggle keeps removal answers; open hatch refunds via the grid', () => {
  for (let r = 0; r < 4; r++) {
    const [dx, dz] = DIR[r];
    const g = grid(tilesSq(2), [P('ladder', 0, 0, 0, r)]);
    assert.equal(g.canPlace(P('floor', dx, dz, 1)), '', `r${r}: landing supported`);
    assert.equal(g.canPlace(P('floor', -dx, -dz, 1)), 'Needs support below', `r${r}: the back is not`);
    g.place(P('floor', dx, dz, 1)); g.place(P('hatch', 0, 0, 1));
    assert.equal(g.canRemove(P('ladder', 0, 0, 0, r)), 'Something rests on this');
    const h = g.find(P('hatch', 0, 0, 1)), v0 = g.version;
    const before = [g.canRemove(h), g.canRemove(P('floor', dx, dz, 1)), g.canRemove(P('ladder', 0, 0, 0, r))];
    assert.ok(g.toggle(h)); assert.equal(h.o, 1); assert.ok(g.version > v0);
    assert.deepEqual([g.canRemove(h), g.canRemove(P('floor', dx, dz, 1)), g.canRemove(P('ladder', 0, 0, 0, r))], before);
    assert.ok(g.remove(h), 'an open hatch is removable');
    assert.equal(g.find(P('hatch', 0, 0, 1)), null);
    assert.equal(g.toggle(P('floor', dx, dz, 1)), false, 'a floor does not toggle');
  }
  const g = grid(tilesSq(1), [P('gate', 0, 0, 0, 0)]);
  const gt = g.find(P('gate', 0, 0, 0, 0));
  g.toggle(gt); assert.equal(gt.o, 1); g.toggle(gt); assert.equal('o' in gt, false);
});

test('occupied(): closing on a body is detected; outside bodies are not', () => {
  const g = grid(tilesSq(2), [P('wall', 0, 0, 0, 0), P('wall', 0, 1, 0, 0), P('floor', 0, 0, 1), P('hatch', 1, 0, 1), P('gate', 0, -1, 0, 0)]);
  const h = g.find(P('hatch', 1, 0, 1)), gt = g.find(P('gate', 0, -1, 0, 0));
  const deck = D0, top = deck + LEVEL_H;
  assert.ok(g.occupied(h, 2, top + EYE, 0, deck), 'standing in the hole at floor height');
  assert.ok(g.occupied(h, 2.9, top - FLOOR_THICK - 0.03 - HEAD, 0.5, deck), 'head just under the slab');
  assert.ok(!g.occupied(h, 2, deck + EYE, 0, deck), 'on the deck below');
  assert.ok(!g.occupied(h, 0, top + EYE, 0, deck), 'on the next floor');
  assert.ok(g.occupied(gt, 0.5, deck + EYE, -3.1, deck), 'in the gateway');
  assert.ok(!g.occupied(gt, 0.5, deck + EYE, -2.5, deck), 'beside the gateway');
  assert.ok(!g.occupied(gt, NaN, deck + EYE, -3, deck));
});

// ============================================================ physics

test('railing on the deck edge: walking, a running jump and a swimmer clamber never cross it', () => {
  for (const v of VARIANTS) {
    const g = grid(tilesSq(1), [P('railing', -1, 2, 0, 0), P('railing', 0, 2, 0, 0), P('railing', 1, 2, 0, 0)]); // +z raft edge z = 3
    let ph = new PlayerPhysics({ x: 0.3, y: eyeAt(0), z: 0 });
    let tr = run(g, ph, 2.5, { forward: 1, yaw: yawTo(0.1, 1) }, v);
    noPen(tr, `walk ${tag(v)}`);
    assert.ok(maxOf(tr, s => s.z) < 3 - 0.07 - R + 1e-6, `walk ${tag(v)}: stopped (z ${maxOf(tr, s => s.z)})`);
    ph = new PlayerPhysics({ x: 0.3, y: eyeAt(0), z: -2.5 });
    tr = run(g, ph, 2.5, (p, n) => ({ forward: 1, sprint: true, yaw: yawTo(0, 1), jump: p.z > 1.6 }), v);
    noPen(tr, `jump ${tag(v)}`);
    assert.ok(maxOf(tr, s => s.z) < 3 - 0.07 - R + 1e-6, `jump ${tag(v)}: did not clear it (z ${maxOf(tr, s => s.z)})`);
    ph = new PlayerPhysics({ x: 0, y: WATER + 0.45, z: 3.5, swimming: true });
    tr = run(g, ph, 2, { jump: true }, v);
    noPen(tr, `clamber ${tag(v)}`);
    assert.ok(ph.swimming && ph.z > 3, `clamber ${tag(v)}: refused (z ${ph.z})`);
  }
});

test('hatch: closed is walkable at the floor height; open drops you to the deck', () => {
  for (const v of VARIANTS) {
    const pcs = [P('pillar', 0, 0, 0), P('pillar', 1, 0, 0), P('pillar', 0, 1, 0), P('pillar', 1, 1, 0), P('floor', 0, 0, 1), P('hatch', 0, 1, 1), P('floor', 0, 2, 1)];
    const g = grid(tilesSq(2), pcs);
    let ph = new PlayerPhysics({ x: 0, y: eyeAt(LEVEL_H), z: 0 }), st = { t: 0 };
    const tr = run(g, ph, 1.7, { forward: 1, yaw: yawTo(0, 1) }, v, st);
    assert.ok(ph.z > 3.5, `${tag(v)}: walked across (z ${ph.z})`);
    assert.ok(tr.every(s => s.grounded && Math.abs(s.feet - LEVEL_H) < 1e-6), `${tag(v)}: stayed at floor height`);
    g.toggle(g.find(P('hatch', 0, 1, 1)));
    ph = new PlayerPhysics({ x: 0, y: eyeAt(LEVEL_H), z: 0 }); st = { t: 0 };
    const t2 = run(g, ph, 0.45, { forward: 1, yaw: yawTo(0, 1) }, v, st);
    const t3 = run(g, ph, 1.0, {}, v, st);
    noPen(t2.concat(t3), `open ${tag(v)}`, 0.01);
    assert.ok(ph.grounded && Math.abs(ph.y - EYE - st.deck) < 1e-6, `${tag(v)}: fell to the deck (feet ${ph.y - EYE - st.deck})`);
    assert.ok(Math.abs(ph.z - 2) < 1, `${tag(v)}: in the hatch cell (z ${ph.z})`);
  }
});

test('gate: closed blocks like a railing, open lets you through the 1.2 m gap', () => {
  for (const v of VARIANTS) {
    const g = grid(tilesSq(2), [P('gate', 0, 1, 0, 0)]); // edge z = 1, x -1..1
    let ph = new PlayerPhysics({ x: 0, y: eyeAt(0), z: -1 });
    let tr = run(g, ph, 1.5, { forward: 1, yaw: yawTo(0, 1) }, v);
    noPen(tr, `closed ${tag(v)}`);
    assert.ok(ph.z < 1 - 0.07 - R + 1e-6, `closed ${tag(v)}: blocked (z ${ph.z})`);
    g.toggle(g.find(P('gate', 0, 1, 0, 0)));
    ph = new PlayerPhysics({ x: 0, y: eyeAt(0), z: -1 });
    tr = run(g, ph, 1.5, { forward: 1, yaw: yawTo(0, 1) }, v);
    noPen(tr, `open ${tag(v)}`);
    assert.ok(ph.z > 2, `open ${tag(v)}: walked through (z ${ph.z})`);
  }
});

const ladderRig = (r, extra = []) => {
  const [dx, dz] = DIR[r];
  return grid(tilesSq(2), [P('ladder', 0, 0, 0, r), P('floor', dx, dz, 1), ...extra.map(f => f(dx, dz))]);
};

test('ladder, all 4 rotations: climb up, step onto the landing, climb back down', () => {
  for (let r = 0; r < 4; r++) for (const v of VARIANTS) {
    const [dx, dz] = DIR[r], msg = `r${r} ${tag(v)}`, yaw = yawTo(dx, dz);
    const g = ladderRig(r), feel = new MoveFeel({ motionScale: 1 }), st = { t: 0 };
    const ph = new PlayerPhysics({ x: 0.4 * dx, y: eyeAt(0), z: 0.4 * dz });
    run(g, ph, 0.1, {}, v, st, feel);
    // Up: about 1.1 s at CLIMB_SPEED 2.
    const up = run(g, ph, 1.25, { forward: 1, yaw }, v, st, feel);
    const reached = up.findIndex(s => Math.abs(s.feet - LEVEL_H) < 1e-6);
    assert.ok(reached >= 0 && (reached + 1) * v.dt < 1.25 && (reached + 1) * v.dt > 1.0, `${msg}: reached the top at ${(reached + 1) * v.dt}s`);
    assert.ok(up.slice(2).every(s => s.climbing && s.grounded), `${msg}: on the ladder all the way`);
    noPen(up, `${msg} up`);
    // Forward again: onto the landing, ladder released.
    const off = run(g, ph, 0.6, { forward: 1, yaw }, v, st, feel);
    run(g, ph, 0.3, { yaw }, v, st, feel);
    assert.ok(!feel.isOnLadder() && g._cl === null, `${msg}: released at the landing`);
    assert.ok(ph.grounded && Math.abs(ph.y - EYE - st.deck - LEVEL_H) < 1e-6, `${msg}: on the landing floor`);
    assert.ok((ph.x - 0) * dx + (ph.z - 0) * dz > 1.1, `${msg}: in the landing cell`);
    noPen(off, `${msg} off`);
    // Backward from the landing: re-attach at the top, climb down, detach on the deck.
    const down = run(g, ph, 2.2, { forward: -1, yaw }, v, st, feel);
    assert.ok(down.some(s => s.climbing && s.feet < 1), `${msg}: climbed down the ladder`);
    assert.ok(maxOf(down, s => -s.feet) < 0.05 && down.every(s => s.feet > LEVEL_H - 0.05 || s.climbing || s.feet < 0.05), `${msg}: never fell`);
    assert.ok(!feel.isOnLadder() && ph.grounded && Math.abs(ph.y - EYE - st.deck) < 1e-6, `${msg}: back on the deck, released`);
    noPen(down, `${msg} down`);
  }
});

test('ladder under a closed hatch stops with the head below the slab; open hatch reaches the side floor', () => {
  for (const v of VARIANTS) for (const r of [0, 3]) {
    const [dx, dz] = DIR[r], msg = `r${r} ${tag(v)}`, yaw = yawTo(dx, dz);
    const g = ladderRig(r, [() => P('hatch', 0, 0, 1)]), feel = new MoveFeel({ motionScale: 1 }), st = { t: 0 };
    const ph = new PlayerPhysics({ x: 0.4 * dx, y: eyeAt(0), z: 0.4 * dz });
    const tr = run(g, ph, 1.5, { forward: 1, yaw }, v, st, feel);
    const slabBottom = LEVEL_H - FLOOR_THICK;
    assert.ok(maxOf(tr, s => s.y - s.deckY + HEAD) < slabBottom - 1e-6, `${msg}: head under the slab (${maxOf(tr, s => s.y - s.deckY + HEAD)})`);
    assert.ok(feel.isOnLadder() && maxOf(tr, s => s.feet) > 0.25, `${msg}: climbed to the cap`);
    noPen(tr, msg);
    // Open it (from below) and carry on to the landing beside the hole.
    g.toggle(g.find(P('hatch', 0, 0, 1)));
    run(g, ph, 1.2, { forward: 1, yaw }, v, st, feel);
    run(g, ph, 0.6, { forward: 1, yaw }, v, st, feel);
    run(g, ph, 0.2, { yaw }, v, st, feel);
    assert.ok(!feel.isOnLadder() && ph.grounded && Math.abs(ph.y - EYE - st.deck - LEVEL_H) < 1e-6, `${msg}: on the side floor (feet ${ph.y - EYE - st.deck})`);
    assert.ok(ph.x * dx + ph.z * dz > 1.1, `${msg}: in the landing cell`);
  }
});

test('jumping off a ladder pushes along the normal and releases; a new physics body releases it', () => {
  for (const v of VARIANTS) {
    const r = 1, [dx, dz] = DIR[r], yaw = yawTo(dx, dz), msg = tag(v);
    let g = ladderRig(r), feel = new MoveFeel({ motionScale: 1 }), st = { t: 0 };
    let ph = new PlayerPhysics({ x: 0.4 * dx, y: eyeAt(0), z: 0.4 * dz });
    run(g, ph, 0.6, { forward: 1, yaw }, v, st, feel);
    assert.ok(feel.isOnLadder(), `${msg}: climbing`);
    const x0 = ph.x;
    run(g, ph, v.dt, { yaw, jump: true }, v, st, feel);
    assert.ok(!feel.isOnLadder() && g._cl === null, `${msg}: released by the jump`);
    run(g, ph, 0.3, { yaw, jump: true }, v, st, feel);
    assert.ok(ph.x < x0 - 0.4, `${msg}: pushed away from the ladder (x ${x0} -> ${ph.x})`);
    // Recreated physics mid-climb (respawn / teleport).
    g = ladderRig(r); feel = new MoveFeel({ motionScale: 1 }); st = { t: 0 };
    ph = new PlayerPhysics({ x: 0.4 * dx, y: eyeAt(0), z: 0.4 * dz });
    run(g, ph, 0.6, { forward: 1, yaw }, v, st, feel);
    assert.ok(feel.isOnLadder());
    const fresh = new PlayerPhysics({ x: ph.x, y: ph.y, z: ph.z });
    assert.equal(g.climb(feel, fresh, D0, { forward: 0, yaw }, v.dt), undefined);
    assert.ok(!feel.isOnLadder() && g._cl === null, `${msg}: released on a new body`);
  }
});

test('ladder: no feel = solid but not climbable; the top is a ledge', () => {
  const g = ladderRig(0), v = VARIANTS[0];
  const ph = new PlayerPhysics({ x: 0, y: eyeAt(0), z: 0 });
  const tr = run(g, ph, 1.5, { forward: 1, yaw: yawTo(0, 1) }, v);
  noPen(tr, 'walk into ladder');
  assert.ok(ph.z < 0.86 - R + 1e-6 && Math.abs(ph.y - EYE - D0) < 1e-6, `stopped at the ladder on the deck (z ${ph.z})`);
  const top = new PlayerPhysics({ x: 0, y: eyeAt(LEVEL_H), z: 2.4 });
  run(g, top, 0.6, { forward: -1, yaw: yawTo(0, 1) }, v);
  assert.ok(top.grounded && Math.abs(top.y - EYE - D0 - LEVEL_H) < 1e-6 && top.z < 1.9, `stood on the strip ledge (z ${top.z}, feet ${top.y - EYE - D0})`);
});

// ============================================================ other readers

test('paint keys: new ids match PIECE_RE; a hatch tint key is unchanged by a toggle', () => {
  for (const t of ['railing', 'hatch', 'ladder', 'gate']) assert.equal(paint.keyType(`${t}:1,-2,1,3`), 'piece', t);
  const g = grid(tilesSq(2), [P('wall', 0, 0, 0, 0), P('wall', 0, 1, 0, 0), P('hatch', 0, 0, 1)]);
  const h = g.find(P('hatch', 0, 0, 1)), k = paint.pieceKeyOf(h);
  g.toggle(h); assert.equal(paint.pieceKeyOf(h), k);
  const st = paint.cleanPaint({ rev: 1, m: { [k]: 2 } });
  assert.equal(paint.prunePaint(st, g.list.map(toRec), tilesSq(2)), 0);
});

test('animals graph: a railing edge blocks, a closed gate blocks, an open gate and a ladder cell do not route', () => {
  const tiles = []; for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) tiles.push([x, z]);
  const nb = (g, a, d) => g.nb[g.index.get(a) * 4 + d];
  let g = AC.buildGraph(tiles, [], [P('railing', 0, 1, 0, 0), P('gate', 1, 1, 0, 0), { ...P('gate', 2, 1, 0, 0), o: 1 }, P('ladder', 2, 2, 0, 0)], null);
  assert.equal(nb(g, '0,0', 2), -1, 'railing blocks');
  assert.equal(nb(g, '1,0', 2), -1, 'closed gate blocks');
  assert.equal(nb(g, '2,0', 2), g.index.get('2,1'), 'open gate passes');
  assert.equal(g.index.has('2,2'), false, 'ladder cell is not walkable for animals');
});

test('models: every pack piece and both open variants build inside their bounds', () => {
  for (const t of ['railing', 'hatch', 'ladder', 'gate']) assert.ok(PIECE_TYPES.includes(t));
  for (const [t, open] of [['railing', false], ['hatch', false], ['ladder', false], ['gate', false], ['hatch', true], ['gate', true]]) {
    const g = createPieceGeometry(T, t, open), b = g.boundingBox, B = pieceBounds(open ? t + 'Open' : t);
    assert.ok(B, `${t} bounds`);
    const e = 0.02, name = t + (open ? 'Open' : '');
    assert.ok(b.min.x >= B.minX - e && b.min.y >= B.minY - e && b.min.z >= B.minZ - e, `${name} min ${b.min.toArray()}`);
    assert.ok(b.max.x <= B.maxX + e && b.max.y <= B.maxY + e && b.max.z <= B.maxZ + e, `${name} max ${b.max.toArray()}`);
    assert.ok(g.userData.triangles > 50 && g.userData.triangles < 2000, `${name} triangles ${g.userData.triangles}`);
    const again = createPieceGeometry(T, t, open);
    assert.deepEqual(Array.from(again.attributes.position.array.slice(0, 60)), Array.from(g.attributes.position.array.slice(0, 60)), `${name} deterministic`);
    g.dispose(); again.dispose();
  }
  assert.throws(() => createPieceGeometry(T, 'hatchOpen'));
});

test('lag spike: a 0.25 s frame of physics substeps never carries a body through a railing or wall', () => {
  for (const t of ['railing', 'wall', 'gate']) for (const sprint of [false, true]) {
    const g = grid(tilesSq(2), [P(t, -1, 2, 0, 0), P(t, 0, 2, 0, 0), P(t, 1, 2, 0, 0)]); // z = 3
    const ph = new PlayerPhysics({ x: 0.2, y: eyeAt(0), z: 1.5 });
    let maxZ = -Infinity;
    for (let f = 0; f < 12; f++) {
      const surf = g.preStep(ph, D0);
      for (let k = 0; k < 5; k++) ph.update(0.05, { forward: 1, sprint, yaw: yawTo(0.05, 1), tiles: surf.tiles, deckY: surf.deckY, waterY: WATER });
      g.postStep(ph, D0);
      maxZ = Math.max(maxZ, ph.z);
    }
    assert.ok(maxZ < 3 - 0.07 - R + 1e-6, `${t} sprint=${sprint}: stayed on the near side (z ${maxZ})`);
  }
});

test('lag spike: a body sliding diagonally along a wall keeps its tangential motion (the sweep does not freeze it)', () => {
  for (const t of ['wall', 'railing']) {
    const g = grid(tilesSq(2), [-2, -1, 0, 1, 2].map(i => P(t, i, 2, 0, 0))); // z = 3
    const ph = new PlayerPhysics({ x: -3, y: eyeAt(0), z: 2.6 });
    for (let f = 0; f < 10; f++) {
      const surf = g.preStep(ph, D0);
      for (let k = 0; k < 4; k++) ph.update(0.05, { forward: 1, sprint: true, yaw: yawTo(1, 1), tiles: surf.tiles, deckY: surf.deckY, waterY: WATER });
      g.postStep(ph, D0);
      assert.ok(ph.z < 3 - 0.07 - R + 1e-6, `${t}: stayed on the near side (z ${ph.z})`);
    }
    assert.ok(ph.x > -3 + 3, `${t}: slid along the wall (x ${ph.x})`);
  }
});

test('a reload of the pieces (guest snapshot) mid-climb keeps the climber on the ladder', () => {
  const g = grid(tilesSq(2), [P('pillar', 0, 1, 0), P('pillar', 1, 1, 0), P('pillar', 0, 2, 0), P('pillar', 1, 2, 0), P('ladder', 0, 0, 0, 0), P('floor', 0, 1, 1)]);
  const feel = new MoveFeel(), ph = new PlayerPhysics({ x: 0, y: eyeAt(0), z: 0.55 });
  const out = run(g, ph, 2, (p, n) => { if (n === 30) g.load(g.list.map(q => ({ ...q }))); return { forward: 1, yaw: yawTo(0, 1) }; }, { dt: 1 / 60, bob: 0 }, { t: 0 }, feel);
  assert.ok(out[40].climbing, 'still climbing after the reload');
  assert.ok(Math.abs(out.at(-1).feet - LEVEL_H) < 0.05 && out.at(-1).z > 1, `reached the landing (feet ${out.at(-1).feet}, z ${out.at(-1).z})`);
});
