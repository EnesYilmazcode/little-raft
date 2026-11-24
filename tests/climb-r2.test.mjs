// Climb round 2: low non-standable decor stays solid, a multi-cell ceiling never shoves a jump sideways, decor
// placement refuses a spot a player stands in (the physics colliders), the ledge pull-up rides a heaving deck,
// no clamber up through an open hatch without its ladder, colliders follow their models, step-up tops are never
// stood inside. Same movement loop as tests/climb.test.mjs.
// Run: node --test tests/climb-r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { BuildGrid, LEVEL_H, RAIL_H } = await import(new URL('building-pieces.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC, blockerGap } = await import(new URL('player-physics.js', base));
const DC = await import(new URL('decor-collision.js', base));
const { playerInWay } = await import(new URL('coop-rules.js', base));
const { CONTENT_DECOR, CONTENT_BLOCK_RADIUS } = await import(new URL('content-items.js', base));
const { PLACEABLE_IDS, BLOCK_RADII } = await import(new URL('items.js', base));

const EYE = PC.EYE_OFFSET, R = PC.BODY_RADIUS, D0 = 0.2, WATER = -0.24;
const RADII = { palm: .42, crate: .55, bench: .45, sail: .14, lantern: .12, receiver: .35, antenna: .1, purifier: .3, rainbarrel: .3, sprinkler: .12, ...CONTENT_BLOCK_RADIUS, ...BLOCK_RADII };
const gameSrc = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');
const BASE_DECOR = [...gameSrc.match(/const DECOR_TYPES = Object\.freeze\(\[\.\.\.new Set\(\[(.*?)\.\.\./)[1].matchAll(/'([a-z0-9]+)'/g)].map(m => m[1]);
const ALL_DECOR = [...new Set([...BASE_DECOR, ...CONTENT_DECOR, ...PLACEABLE_IDS])];
const tilesSq = n => { const a = []; for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) a.push([i, j]); return a; };
const P = (t, i, j, l, r = 0) => ({ t, i, j, l, r });
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const FRAMES = [1 / 144, 1 / 60, 1 / 20];
const near = (a, b, e = 0.03) => Math.abs(a - b) < e;

function world(pieces = [], decor = []) {
  const g = new BuildGrid(); g.setTiles(tilesSq(4));
  for (const p of pieces) assert.ok(g.place(p), `place ${JSON.stringify(p)}: ${g.canPlace(p)}`);
  return { g, blocked: decor.flatMap(d => DC.decorColliders(d, RADII)) };
}
function run(w, ph, seconds, input, dt = 1 / 60, bob = 0, st = { t: 0 }) {
  const out = [], n = Math.max(1, Math.ceil(dt / 0.05 - 1e-9)), step = dt / n;
  for (let f = 0; f < Math.round(seconds / dt); f++) {
    st.t += dt;
    const deckY = D0 + bob * Math.sin(st.t * 2 * Math.PI / 2.5);
    const inp = typeof input === 'function' ? input(ph, f) : input;
    const surf = w.g.preStep(ph, deckY);
    for (let i = 0; i < n; i++) ph.update(step, { ...inp, tiles: surf.tiles, deckY: surf.deckY, waterY: WATER, blocked: w.blocked, baseY: deckY, ledge: w.g });
    w.g.postStep(ph, deckY);
    out.push({ x: ph.x, y: ph.y, z: ph.z, feet: ph.y - EYE - deckY, grounded: ph.grounded, climbing: ph.climbing });
  }
  return out;
}
const pillars = cells => { const s = new Set(), a = []; for (const [i, j] of cells) for (const [u, v] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) { const k = u + ',' + v; if (!s.has(k)) { s.add(k); a.push(P('pillar', u, v, 0)); } } return a; };

test('low decor that cannot be stood on (candle) is solid to a walking body until jumped over', () => {
  const low = ALL_DECOR.flatMap(t => DC.decorColliders({ type: t, x: 0, z: -1 }, RADII).filter(c => !c.stand && Number.isFinite(c.top) && c.top < PC.DECOR_STEP + 0.1).map(c => [t, c]));
  assert.ok(low.some(([t]) => t === 'candle'), 'candle is a low blocker');
  for (const [type, c] of low) for (const dt of FRAMES) for (const x0 of [c.x, c.x + 0.15]) {
    const w = { g: world().g, blocked: [c] };
    const ph = new PlayerPhysics({ x: x0, y: D0 + EYE, z: c.z + 1.2 });
    const tr = run(w, ph, 1.5, { forward: 1, yaw: 0 }, dt);
    const inside = tr.filter(s => s.feet < c.top - PC.PASS_TOL && blockerGap(c, s.x, s.z) < R - 1e-6);
    assert.equal(inside.length, 0, `${type} dt=${dt}: walked into it ${JSON.stringify(inside[0])}`);
    assert.ok(ph.z > c.z, `${type}: stopped in front (z ${ph.z})`);
    // a jump carries the body over it
    const ph2 = new PlayerPhysics({ x: x0, y: D0 + EYE, z: c.z + 0.6 });
    run(w, ph2, 1.2, (p, n) => ({ forward: 1, yaw: 0, jump: n < 2 }), dt);
    assert.ok(ph2.z < c.z - 0.3, `${type}: jumped over (z ${ph2.z})`);
  }
  // A cushion (standable, as low) is still stepped onto.
  const w = world([], [{ type: 'cushion', x: 0, z: -1 }]), ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: 0.5 });
  const tr = run(w, ph, 1.2, p => ({ forward: p.z > -2 ? 1 : 0, yaw: 0 }));
  assert.ok(tr.some(s => s.grounded && near(s.feet, DC.DECOR_STAND_TOP.cushion, 0.01)), 'cushion stepped onto');
});

test('a jump under a ceiling of several floor cells goes straight up (no sideways shove at the seams)', () => {
  const room = [...pillars([[0, 0], [1, 0]]), P('floor', 0, 0, 1), P('floor', 1, 0, 1)];
  const w = world(room);
  for (const dt of FRAMES) for (const bob of [0, 0.15]) for (const x0 of [0.75, 0.8, 0.9, 0.95, 1, 1.05, 1.1, 1.2, 1.25]) for (const z0 of [0, 0.5]) {
    const ph = new PlayerPhysics({ x: x0, y: D0 + EYE, z: z0 });
    const tr = run(w, ph, 1.2, (p, n) => ({ jump: n < 2 }), dt, bob);
    const drift = tr.reduce((m, s) => Math.max(m, Math.hypot(s.x - x0, s.z - z0)), 0);
    assert.ok(drift < 1e-9, `x0 ${x0} z0 ${z0} dt ${dt} bob ${bob}: drift ${drift}`);
    assert.ok(tr.some(s => s.feet > 0.2), 'jumped');
  }
  // A jump beside a floor one storey up (no slab over the centre) still slides past its edge.
  const w2 = world([...pillars([[0, 0]]), P('floor', 0, 0, 1)]);
  const ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: 1 + R - 0.1 });
  const tr = run(w2, ph, 1.2, (p, n) => ({ jump: n < 2 }));
  assert.ok(tr.some(s => s.feet > 0.8) && ph.z >= 1 + R - 1e-6, `edge: pushed out and rose (z ${ph.z})`);
});

test('decor placement refuses a spot that would put a player inside its physics collider (host and ghost alike)', () => {
  // game.js: both checks use the physics colliders, never the old 2D circles.
  assert.equal((gameSrc.match(/playerInWay\(decorColliders\(/g) || []).length, 2, 'ghost and host checks use decorColliders');
  assert.ok(!/playerInWay\(decorBlockers\(/.test(gameSrc), 'no old 2D blocker check left');
  for (const [type, px, pz] of [['cropplot', 0.75, 0], ['smelter', 0.6, 0.6], ['research', 0.75, 0.3], ['hammock', 0.6, 0.6], ['goatpen', 0.75, 0.75], ['kiln', 0.45, 0.45]]) {
    const cs = DC.decorColliders({ type, x: 0, z: 0, rot: 0 }, RADII);
    assert.ok(cs.some(c => blockerGap(c, px, pz) < R), `${type}: the body overlaps it`);
    assert.equal(playerInWay(cs, [{ x: px, z: pz }], R), 0, `${type}: refused on the host`);
    assert.equal(playerInWay(cs, [null, { x: px, z: pz }], R + 0.05), 1, `${type}: refused on the partner`);
  }
  // Every collider of every type: a body it overlaps is in the way (height ignored: a lamp's glass box counts too).
  for (const t of ALL_DECOR) for (const c of DC.decorColliders({ type: t, x: 0, z: 0, rot: 0.6 }, RADII)) {
    const p = { x: c.x + 0.01, z: c.z };
    assert.equal(playerInWay(DC.decorColliders({ type: t, x: 0, z: 0, rot: 0.6 }, RADII), [p], R), 0, t);
  }
});

test('ledge pull-up on a heaving deck ends standing on the top (no sink and pop)', () => {
  const pill = pillars([[0, 0]]);
  for (const [name, pcs, z0] of [['wall', [P('wall', 0, 0, 0, 0)], -1 + 0.07 + R + 0.05], ['floor', [...pill, P('floor', 0, 0, 1)], 1 + R + 0.05]]) {
    for (const dt of FRAMES) for (let t0 = 0; t0 < 2.5; t0 += 0.25) {
      const w = world(pcs), st = { t: t0 };
      const ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: z0 });
      run(w, ph, 0.1, {}, dt, 0.15, st);
      const tr = run(w, ph, 1.5, (p, n) => ({ forward: p.grounded && n > 3 && p.y - EYE - D0 > 1.5 ? 0 : 1, yaw: yawTo(0, -1), jump: n < 3 }), dt, 0.15, st);
      const k1 = tr.findIndex((s, k) => k > 0 && tr[k - 1].climbing && !s.climbing);
      assert.ok(k1 > 0, `${name} dt ${dt} t0 ${t0}: clambered`);
      for (let k = k1; k < tr.length; k++) assert.ok(near(tr[k].feet, LEVEL_H, 0.005), `${name} dt ${dt} t0 ${t0}: frame ${k - k1} after the pull-up feet ${tr[k].feet}`);
    }
  }
});

test('no clamber up through an open hatch without a ladder; with its ladder the opening is allowed', () => {
  const cells = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) cells.push([i, j]);
  const floors = cells.filter(([i, j]) => i || j).map(([i, j]) => P('floor', i, j, 1));
  const w = world([...pillars(cells), ...floors, P('hatch', 0, 0, 1)]);
  const h = w.g.list.find(p => p.t === 'hatch');
  for (const open of [false, true]) {
    if (open !== !!h.o) w.g.toggle(h);
    for (const dt of FRAMES) for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1], [0.7, 0.7]]) {
      const ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: 0 });
      run(w, ph, 0.1, {}, dt);
      const tr = run(w, ph, 2, (p, n) => ({ jump: n < 2, forward: 1, yaw: yawTo(dx, dz) }), dt);
      assert.ok(!tr.some(s => s.climbing) && tr.every(s => s.feet < LEVEL_H - 0.5), `hatch ${open ? 'open' : 'closed'} dir ${dx},${dz} dt ${dt}: stayed downstairs`);
    }
  }
  assert.ok(h.o, 'left open');
  assert.equal(w.g.hatchHole(0, 0, D0 + 1, D0 + LEVEL_H + 0.05, D0), true, 'open hatch, no ladder: a hole');
  assert.equal(w.g.hatchHole(2, 0, D0 + 1, D0 + LEVEL_H + 0.05, D0), false, 'beside it: no hole');
  assert.equal(w.g.hatchHole(0, 0, D0 + LEVEL_H + 0.1, D0 + LEVEL_H + 1, D0), false, 'already above it');
  const w2 = world([...pillars(cells), ...floors, P('ladder', 0, 0, 0, 0), P('hatch', 0, 0, 1)]);
  const h2 = w2.g.list.find(p => p.t === 'hatch'); w2.g.toggle(h2);
  assert.equal(w2.g.hatchHole(0, 0, D0 + 1, D0 + LEVEL_H + 0.05, D0), false, 'over its ladder: the way up');
  // A floor edge outside the building is still a clamber.
  const w3 = world([...pillars([[0, 0]]), P('floor', 0, 0, 1)]);
  const ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: 1 + R + 0.05 });
  const tr = run(w3, ph, 1.5, (p, n) => ({ forward: p.grounded && n > 3 && p.y - EYE - D0 > 1.5 ? 0 : 1, yaw: yawTo(0, -1), jump: n < 3 }));
  assert.ok(tr.some(s => s.climbing) && near(tr.at(-1).feet, LEVEL_H, 0.01), 'floor edge: clambered');
});

test('decor colliders turn exactly like their models', () => {
  // d.rot only (the model ignores d.yaw); courseflag / scoreboard keep their default facing (ownRot).
  const [a] = DC.decorColliders({ type: 'crate', x: 0, z: 0, yaw: 1.2 }, RADII);
  assert.equal(a.rot, 0, 'yaw is not a model rotation');
  for (const t of ['courseflag', 'scoreboard']) for (const c of DC.decorColliders({ type: t, x: 1, z: 1, rot: 1.1 }, RADII)) assert.ok(!c.rot, `${t}: own facing`);
  // The fish trap faces the open water beside its tile (fish-trap.js openSide) when the tiles are known.
  const tiles = [[0, 0], [1, 0], [-1, 0], [0, -1]]; // open side: +z
  const ft = DC.decorColliders({ type: 'fishtrap', x: 0, z: 0, rot: Math.PI / 2 }, RADII, 2, tiles);
  assert.ok(ft[1].z > 0.8 && Math.abs(ft[1].x) < 0.3, `arm over the +z water (${ft[1].x}, ${ft[1].z})`);
  // followModels: a model group turned at run time (sail heading, decor-pack quarter turns) carries its colliders.
  for (const t of ['sail', 'fern', 'glasslamp', 'hammock', 'crate', 'stringlights']) {
    const cs = DC.decorColliders({ type: t, x: 1, z: -1 }, RADII), g = { position: { x: 2, z: -2 }, rotation: { y: 0 } };
    const want = r => DC.decorColliders({ type: t, x: 1, z: -1, rot: r }, RADII);
    for (const r of [0.4, Math.PI / 2, 3]) {
      g.rotation.y = r; DC.followModels([cs, g]);
      want(r).forEach((c, i) => { for (const k of ['x', 'z', 'rot']) if (c[k] !== undefined) assert.ok(near(cs[i][k], c[k], 1e-9), `${t} rot ${r} part ${i} ${k}`); });
    }
  }
  // game.js wires it: colliders built with the tiles, followed every frame before the physics steps.
  assert.ok(/decorColliders\(d, BLOCK_RADIUS, 2, world\.tiles\)/.test(gameSrc) && /followModels\(decorFollow\)/.test(gameSrc));
});

test('thin decor colliders cover the solid visible frame and no more', () => {
  // [type, points inside (model-local, at rot 0, body height), points outside]: measured from the models.
  const cases = [
    ['flagpole', [[0.19, 0], [0, -0.19]], [[0.35, 0.5], [0.3, 0]]],
    ['pennant', [[0.14, 0]], [[0.25, 0]]],
    ['stringlights', [[0, 0], [0.78, 0], [0.4, 0.05]], [[-0.15, 0], [0.9, 0], [0.4, 0.15]]],
    ['chime', [[0.38, 0.12], [-0.38, -0.12]], [[0.5, 0], [0, 0.22]]],
    ['fern', [[-0.6, 0.15], [-0.45, 0], [0.2, 0.15]], [[0.7, 0], [-0.45, 0.3]]],
    ['glasslamp', [[0, 0.1], [0.4, 0.1]], [[0.5, 0], [-0.2, 0]]],
    ['fishtrap', [[0.34, 0.62], [0.1, 1.1]], [[0, 0], [-0.3, 0.3]]],
    ['pots', [[-0.56, -0.05], [0.42, 0.25], [0.05, -0.55]], [[0.5, 0], [-0.62, 0], [0, 0.5]]],
    ['sail', [[0.74, 0], [0, 0.74], [0.79, 0.4], [-0.79, 0.1]], [[0.5, -0.5], [0.5, 0.6], [-0.6, -0.4]]],
  ];
  for (const [t, inn, out] of cases) {
    const cs = DC.decorColliders({ type: t, x: 0, z: 0 }, RADII);
    for (const [x, z] of inn) assert.ok(cs.some(c => blockerGap(c, x, z) <= 0), `${t}: (${x}, ${z}) is solid`);
    for (const [x, z] of out) assert.ok(cs.every(c => blockerGap(c, x, z) > 0), `${t}: (${x}, ${z}) is open`);
  }
  // A raised part (a lamp's glass box at head height) blocks a standing body, not one passing over it.
  const [, glass] = DC.decorColliders({ type: 'glasslamp', x: 0, z: 0 }, RADII);
  assert.ok(glass.y0 > 1 && glass.y0 < EYE + PC.HEAD);
  const w = world([], [{ type: 'glasslamp', x: 0, z: 0 }]);
  const ph = new PlayerPhysics({ x: 1, y: D0 + EYE, z: 0 });
  run(w, ph, 1.5, { forward: 1, yaw: yawTo(-1, 0) });
  assert.ok(ph.x >= 0.42 + R - 1e-6, `stopped at the glass box (x ${ph.x})`);
});

test('a grounded body never stands inside the side of a step-up top: it steps onto it at the touch', () => {
  // Standing on a railing top beside a kiln (0.14 m higher), and on the deck beside a cushion.
  for (const dt of FRAMES) for (const ang of [0, 0.3, 0.8, 1.3]) {
    const w = world([P('railing', -1, 0, 0, 1), P('railing', -1, 1, 0, 1)], [{ type: 'kiln', x: (-3 + 0.07 + 0.46) / 2, z: 0.5 }]);
    const [k] = w.blocked;
    const ph = new PlayerPhysics({ x: -3, y: D0 + RAIL_H + EYE, z: k.z - 0.9 });
    run(w, ph, 0.2, {}, dt);
    assert.ok(ph.grounded && near(ph.y - EYE - D0, RAIL_H, 1e-6), 'on the railing');
    const tr = run(w, ph, 1.5, { forward: 1, yaw: yawTo(Math.sin(ang), Math.cos(ang)) }, dt);
    const bad = tr.filter(s => s.grounded && s.feet < k.top - 0.02 && blockerGap(k, s.x, s.z) < R - 0.01);
    assert.equal(bad.length, 0, `dt ${dt} ang ${ang}: inside the kiln side ${JSON.stringify(bad[0])}`);
    const w2 = world([], [{ type: 'cushion', x: 0, z: 0 }]), [c] = w2.blocked;
    const p2 = new PlayerPhysics({ x: 0.1 - Math.sin(ang) * 1.2, y: D0 + EYE, z: -Math.cos(ang) * 1.2 });
    const t2 = run(w2, p2, 1.2, { forward: 1, yaw: yawTo(Math.sin(ang), Math.cos(ang)) }, dt);
    assert.equal(t2.filter(s => s.grounded && s.feet < c.top - 0.02 && blockerGap(c, s.x, s.z) < R - 0.01).length, 0, `cushion dt ${dt} ang ${ang}`);
    assert.ok(t2.some(s => s.grounded && near(s.feet, c.top, 1e-6)), 'stepped onto the cushion');
  }
});

test('brushing past a step-up top at a grazing angle never drops the body for a frame (no double land sound)', () => {
  // Walking by with the body edge just touching the top: the step-up moves the centre in to the edge margin, which
  // must leave it standing there (not a float hair outside the margin, then a frame of walk off and land).
  for (const type of ['cushion', 'kiln', 'crate']) for (const dt of FRAMES) for (const off of [0.03, 0.08, 0.13, 0.23, 0.38]) {
    const w = world([], [{ type, x: 0, z: 0 }]), [c] = w.blocked;
    const ph = new PlayerPhysics({ x: -3, y: D0 + EYE, z: c.hz + off });
    run(w, ph, 0.2, {}, dt);
    const tr = run(w, ph, 2, { forward: 1, yaw: yawTo(1, 0) }, dt);
    const firstOn = tr.findIndex(s => near(s.feet, c.top, 1e-6));
    const before = firstOn < 0 ? tr : tr.slice(0, firstOn);
    assert.equal(before.filter(s => !s.grounded).length, 0, `${type} dt ${dt} off ${off}: airborne before stepping up`);
  }
});
