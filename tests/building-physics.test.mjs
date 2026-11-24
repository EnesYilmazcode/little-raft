// Movement stress tests: building pieces + the real PlayerPhysics, as game.js drives them
// (surf = grid.preStep(physics, deckY); physics.update(dt, {..surf}); grid.postStep(physics, deckY)).
// Every scenario runs at 60 fps and at a 20 fps lag spike, with a still and a bobbing raft (deckY +-0.15).
// Run: node --test tests/building-physics.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { BuildGrid, LEVEL_H, FLOOR_THICK, DIR } = await import(new URL('building-pieces.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));

// ---------------------------------------------------------------- helpers

const EYE = PC.EYE_OFFSET, R = PC.BODY_RADIUS, WATER = -0.24, D0 = 0.2;
const tilesSq = (n) => { const a = []; for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) a.push([i, j]); return a; };
const P = (t, i, j, l, r = 0) => ({ t, i, j, l, r });
const grid = (tiles, pieces) => {
  const g = new BuildGrid();
  g.setTiles(tiles);
  for (const p of pieces) assert.ok(g.place(p), `setup place ${JSON.stringify(p)}: ${g.canPlace(p)}`);
  return g;
};
const yawTo = (dx, dz) => Math.atan2(-dx, -dz); // forward = (-sin yaw, -cos yaw)
const VARIANTS = [
  { dt: 1 / 60, bob: 0 }, { dt: 1 / 20, bob: 0 }, { dt: 1 / 60, bob: 0.15 }, { dt: 1 / 20, bob: 0.15 },
];
const tag = (v) => `dt=1/${Math.round(1 / v.dt)} bob=${v.bob}`;
const eyeAt = (feetAboveDeck) => D0 + feetAboveDeck + EYE;

// Deepest penetration of the body circle into any solid box it vertically overlaps (grounded bodies may stand
// over box tops within the 0.55 step-up, like the walls under a stair landing).
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

// Runs the game's movement loop. Returns per-frame samples; `t` carries the bob phase between calls.
function run(g, ph, seconds, input, v, state = { t: 0 }) {
  const out = [];
  for (let n = 0; n < Math.round(seconds / v.dt); n++) {
    state.t += v.dt;
    const deckY = D0 + v.bob * Math.sin(state.t * 2 * Math.PI / 2.5);
    const inp = typeof input === 'function' ? input(ph, n) : input;
    const y0 = ph.y, d0 = state.deck ?? deckY;
    const surf = g.preStep(ph, deckY);
    ph.update(v.dt, { ...inp, tiles: surf.tiles, deckY: surf.deckY, waterY: WATER });
    g.postStep(ph, deckY);
    state.deck = deckY;
    out.push({ x: ph.x, y: ph.y, z: ph.z, feet: ph.y - EYE - deckY, grounded: ph.grounded, swimming: ph.swimming,
      climbing: ph.climbing, dy: (ph.y - deckY) - (y0 - d0), pen: penetration(g, ph, deckY), deckY });
  }
  return out;
}
const maxOf = (tr, f) => tr.reduce((m, s) => Math.max(m, f(s)), -Infinity);
const minOf = (tr, f) => tr.reduce((m, s) => Math.min(m, f(s)), Infinity);
const noPen = (tr, msg) => assert.ok(maxOf(tr, s => s.pen) < 1e-6, `${msg}: inside a solid by ${maxOf(tr, s => s.pen)}`);
// Ramp height above the deck at a point of a stairs cell (i,j,l,r).
const rampAt = (i, j, l, r, x, z) => l * LEVEL_H + Math.min(1, Math.max(0, ((x - 2 * i) * DIR[r][0] + (z - 2 * j) * DIR[r][1] + 1) / 2)) * LEVEL_H;

// ============================================================ stairs

test('stairs, all 4 rotations at level 0: walk up smoothly, then back down without leaving the ground', () => {
  for (let r = 0; r < 4; r++) for (const v of VARIANTS) {
    const [dx, dz] = DIR[r], msg = `r${r} ${tag(v)}`;
    const g = grid(tilesSq(2), [P('stairs', 0, 0, 0, r), P('floor', dx, dz, 1)]);
    const ph = new PlayerPhysics({ x: -2 * dx, y: eyeAt(0), z: -2 * dz }), st = { t: 0 };
    const up = run(g, ph, 1.6, { forward: 1, yaw: yawTo(dx, dz) }, v, st);
    run(g, ph, 0.3, {}, v, st);
    assert.ok(ph.grounded && Math.abs(ph.y - EYE - st.deck - LEVEL_H) < 1e-6, `${msg}: on the landing (feet ${ph.y - EYE - st.deck})`);
    assert.ok(Math.hypot(ph.x - 2 * dx, ph.z - 2 * dz) < 1.2, `${msg}: in the landing cell`);
    assert.ok(up.every(s => s.grounded), `${msg}: grounded all the way up`);
    assert.ok(maxOf(up, s => Math.abs(s.dy)) < PC.WALK_SPEED * 1.1 * v.dt + 0.02, `${msg}: no snaps going up (${maxOf(up, s => Math.abs(s.dy))})`);
    const down = run(g, ph, 1.6, { forward: 1, yaw: yawTo(-dx, -dz) }, v, st);
    assert.ok(down.every(s => s.grounded), `${msg}: grounded all the way down (${down.filter(s => !s.grounded).length} air frames)`);
    assert.ok(maxOf(down, s => Math.abs(s.dy)) < PC.WALK_SPEED * 1.1 * v.dt + 0.02, `${msg}: no drops going down`);
    assert.ok(Math.abs(ph.y - EYE - st.deck) < 1e-6, `${msg}: back on the deck`);
  }
});

test('stacked stairs level 0 -> 1 -> 2 (every rotation): up to the top floor and down again', () => {
  for (let r = 0; r < 4; r++) for (const v of VARIANTS) {
    const [dx, dz] = DIR[r], msg = `r${r} ${tag(v)}`;
    const g = grid(tilesSq(3), [P('stairs', 0, 0, 0, r), P('floor', dx, dz, 1), P('stairs', dx, dz, 1, r), P('floor', 2 * dx, 2 * dz, 2)]);
    const ph = new PlayerPhysics({ x: -2 * dx, y: eyeAt(0), z: -2 * dz }), st = { t: 0 };
    const up = run(g, ph, 2.6, { forward: 1, yaw: yawTo(dx, dz) }, v, st);
    assert.ok(Math.abs(ph.y - EYE - st.deck - 2 * LEVEL_H) < 1e-6 && ph.grounded, `${msg}: on level 2`);
    assert.ok(up.every(s => s.grounded), `${msg}: grounded up`);
    const down = run(g, ph, 1.6, { forward: 1, yaw: yawTo(-dx, -dz), sprint: true }, v, st);
    assert.ok(down.every(s => s.grounded), `${msg}: sprinting down stays grounded`);
    assert.ok(maxOf(down, s => Math.abs(s.dy)) < PC.SPRINT_SPEED * 1.1 * v.dt + 0.02, `${msg}: no drops sprinting down`);
    assert.ok(Math.abs(ph.y - EYE - st.deck) < 1e-6, `${msg}: back on the deck`);
  }
});

test('sprinting and bunny-hopping on stairs never sinks into the ramp and ends on the landing', () => {
  for (const v of VARIANTS) {
    const g = grid(tilesSq(3), [P('stairs', 0, 0, 0, 0), P('floor', 0, 1, 1), P('wall', 0, 2, 1, 0)]);
    const ph = new PlayerPhysics({ x: 0, y: eyeAt(0), z: -2.5 }), st = { t: 0 };
    // Hops stop before the top of the ramp: a jump from the top step or the landing clears the one-storey wall
    // upstairs (by design; the apex is above LEVEL_H).
    const tr = run(g, ph, 2.5, (p, n) => ({ forward: 1, yaw: yawTo(0, 1), sprint: true, jump: n % 9 < 3 && p.z < 0.5 }), v, st);
    const sink = maxOf(tr.filter(s => Math.abs(s.x) < 1 && s.z > -1 && s.z < 1), s => rampAt(0, 0, 0, 0, s.x, s.z) - s.feet);
    assert.ok(sink < 0.3, `${tag(v)}: feet below the ramp by ${sink}`);
    run(g, ph, 1, {}, v, st);
    assert.ok(ph.grounded && Math.abs(ph.y - EYE - st.deck - LEVEL_H) < 1e-6, `${tag(v)}: on the landing`);
    assert.ok(ph.z <= 3 - 0.07 - R + 1e-6, `${tag(v)}: stopped by the upstairs wall (z ${ph.z})`);
    noPen(tr, tag(v));
    // Hopping back down.
    const dn = run(g, ph, 1.1, (p, n) => ({ forward: 1, yaw: yawTo(0, -1), sprint: true, jump: n % 9 < 3 }), v, st);
    run(g, ph, 1, {}, v, st);
    assert.ok(ph.grounded && Math.abs(ph.y - EYE - st.deck) < 1e-6, `${tag(v)}: back on the deck`);
    noPen(dn, tag(v));
  }
});

test('stairs are solid from behind and from the side: no walking through them, no pop-up', () => {
  for (const v of VARIANTS) {
    // Stairs rise +z; the landing floor above z in [1,3].
    const g = grid(tilesSq(3), [P('stairs', 0, 0, 0, 0), P('floor', 0, 1, 1)]);
    // From behind, under the landing, walking -z into the high end.
    const a = new PlayerPhysics({ x: 0, y: eyeAt(0), z: 2.5 });
    const ta = run(g, a, 2, { forward: 1, yaw: yawTo(0, -1) }, v);
    assert.ok(ta.every(s => s.feet < 0.05), `${tag(v)}: no pop-up onto the ramp from behind`);
    assert.ok(a.z > 0.5, `${tag(v)}: stopped under the high end (z ${a.z})`);
    // From the side at mid height.
    const b = new PlayerPhysics({ x: -2.5, y: eyeAt(0), z: 0.2 });
    const tb = run(g, b, 2, { forward: 1, yaw: yawTo(1, 0) }, v);
    assert.ok(tb.every(s => s.feet < 0.05), `${tag(v)}: no pop-up from the side`);
    assert.ok(b.x < -1, `${tag(v)}: blocked at the stair side (x ${b.x})`);
    // From the side at the low end: a small step up is fine.
    const c = new PlayerPhysics({ x: -2.5, y: eyeAt(0), z: -0.85 });
    run(g, c, 2, { forward: 1, yaw: yawTo(1, 0) }, v);
    assert.ok(c.x > 0.5 && c.y - EYE > D0 - 0.2 + 0.05, `${tag(v)}: stepped onto the low end (x ${c.x})`);
  }
});

test('a wall under the top edge of the stairs does not block the last steps', () => {
  for (const v of VARIANTS) {
    const g = grid(tilesSq(2), [P('stairs', 0, 0, 0, 0), P('wall', 0, 1, 0, 0), P('floor', 0, 1, 1),
      P('wall', 0, 0, 0, 1), P('wall', 1, 0, 0, 1)]);
    const ph = new PlayerPhysics({ x: 0, y: eyeAt(0), z: -2 }), st = { t: 0 };
    run(g, ph, 1.4, { forward: 1, yaw: yawTo(0, 1) }, v, st);
    run(g, ph, 0.3, {}, v, st);
    assert.ok(ph.z > 1.3 && Math.abs(ph.y - EYE - st.deck - LEVEL_H) < 1e-6, `${tag(v)}: on the landing (z ${ph.z})`);
    // Standing on the deck, the same wall still blocks.
    const q = new PlayerPhysics({ x: 0, y: eyeAt(0), z: 2.5 });
    run(g, q, 1.5, { forward: 1, yaw: yawTo(0, -1) }, v);
    assert.ok(q.z >= 1 + 0.07 + R - 1e-6, `${tag(v)}: wall blocks at deck level (z ${q.z})`);
  }
});

// ============================================================ walls

test('doorway lets you through (walking, sprint-jumping, slightly off centre); wall, window and half wall block walking', () => {
  for (const v of VARIANTS) {
    for (const t of ['door', 'window', 'wall', 'halfwall']) {
      const g = grid(tilesSq(2), [P(t, 1, 0, 0, 1)]); // edge at x = 1, z in [-1, 1]
      for (const z0 of [0, 0.2]) {
        for (const mode of ['walk', 'sprint-jump']) {
          const ph = new PlayerPhysics({ x: -1, y: eyeAt(0), z: z0 });
          // Sprint-jumping: a hop whose head meets the lintel is stopped by it (like a wall), so give it time to land and walk on.
          const tr = run(g, ph, mode === 'walk' ? 1.6 : 2.4, (p, n) => ({ forward: 1, yaw: yawTo(1, 0), sprint: mode !== 'walk', jump: mode !== 'walk' && n % 40 < 10 }), v);
          const msg = `${t} z=${z0} ${mode} ${tag(v)}`;
          noPen(tr, msg);
          if (t === 'door') assert.ok(ph.x > 2, `${msg}: passed (x ${ph.x})`);
          else if (mode === 'walk') assert.ok(maxOf(tr, s => s.x) <= 1 - 0.07 - R + 1e-6, `${msg}: blocked (x ${maxOf(tr, s => s.x)})`);
          // A running jump clears or lands on a half wall (the jump apex 1.37 m is above its 1.1 m); noPen covers it.
        }
      }
    }
  }
});

test('jumping in a doorway bonks the head on the lintel instead of being shoved sideways', () => {
  for (const v of VARIANTS) {
    const g = grid(tilesSq(2), [P('door', 1, 0, 0, 1)]);
    const ph = new PlayerPhysics({ x: 1, y: eyeAt(0), z: 0 }), st = { t: 0 };
    const tr = run(g, ph, 1.2, { jump: true }, v, st);
    assert.ok(maxOf(tr, s => s.y + 0.15 - s.deckY) <= 1.95 + 1e-6, `${tag(v)}: head under the lintel`);
    assert.ok(Math.abs(ph.x - 1) < 1e-9 && Math.abs(ph.z) < 1e-9, `${tag(v)}: not shoved`);
    assert.ok(ph.grounded);
  }
});

test('diagonal sliding along a wall run keeps moving; corners and pillars hold without tunnelling', () => {
  for (const v of VARIANTS) {
    const wallRun = grid(tilesSq(3), [P('wall', 1, -1, 0, 1), P('wall', 1, 0, 0, 1), P('wall', 1, 1, 0, 1)]);
    const a = new PlayerPhysics({ x: 0, y: eyeAt(0), z: -2.5 });
    const ta = run(wallRun, a, 1.5, { forward: 1, yaw: yawTo(1, 1), sprint: true }, v);
    noPen(ta, `slide ${tag(v)}`);
    assert.ok(maxOf(ta.filter(s => s.z < 3 - R), s => s.x) <= 1 - 0.07 - R + 1e-6, `slide ${tag(v)}: stays on its side`);
    const slid = ta.slice(10).every((s, k, arr) => k === 0 || s.z > arr[k - 1].z + 0.5 * v.dt);
    assert.ok(slid, `slide ${tag(v)}: keeps sliding along the wall (no stuck frames)`);

    const corner = grid(tilesSq(2), [P('wall', 1, 0, 0, 1), P('wall', 0, 1, 0, 0), P('pillar', 1, 1, 0)]);
    for (const yaw of [yawTo(1, 1), yawTo(1, 0.3), yawTo(0.3, 1)]) {
      const b = new PlayerPhysics({ x: -0.5, y: eyeAt(0), z: -0.5 });
      const tb = run(corner, b, 2, { forward: 1, yaw, sprint: true }, v);
      noPen(tb, `corner ${tag(v)}`);
      assert.ok(Math.abs(b.x - 0.68) < 1e-6 && Math.abs(b.z - 0.68) < 1e-6, `corner ${tag(v)}: wedged at (${b.x}, ${b.z})`);
      assert.ok(maxOf(tb.slice(-10), s => Math.abs(s.x - 0.68) + Math.abs(s.z - 0.68)) < 1e-6, 'no jitter in the corner');
    }

    const pillar = grid(tilesSq(2), [P('pillar', 1, 0, 0)]); // post at (1, -1)
    const c = new PlayerPhysics({ x: -1, y: eyeAt(0), z: -0.8 });
    const tc = run(pillar, c, 2, { forward: 1, yaw: yawTo(1, 0) }, v);
    noPen(tc, `pillar ${tag(v)}`);
    assert.ok(c.x > 2, `pillar ${tag(v)}: slid around it (x ${c.x})`);
  }
});

test('half wall blocks walking; a running jump clears it cleanly', () => {
  for (const v of VARIANTS) {
    const g = grid(tilesSq(2), [P('halfwall', 1, -1, 0, 1), P('halfwall', 1, 0, 0, 1), P('halfwall', 1, 1, 0, 1)]);
    const w = new PlayerPhysics({ x: -1.5, y: eyeAt(0), z: 0 });
    const tw = run(g, w, 2, { forward: 1, yaw: yawTo(1, 0), sprint: true }, v);
    assert.ok(maxOf(tw, s => s.x) <= 1 - 0.07 - R + 1e-6, `${tag(v)}: blocked`);
    noPen(tw, tag(v));
    const ph = new PlayerPhysics({ x: -1.5, y: eyeAt(0), z: 0 });
    const tr = run(g, ph, 2, (p, n) => ({ forward: 1, yaw: yawTo(1, 0), sprint: true, jump: p.x > -0.35 }), v);
    assert.ok(ph.x > 1 + 0.07 + R, `${tag(v)}: jumped over (x ${ph.x})`);
    noPen(tr, tag(v));
  }
});

test('spawning inside a wall, pillar, door jamb or lintel resolves to a clear spot at once', () => {
  for (const v of VARIANTS) {
    for (const [name, pieces, x, z] of [
      ['wall', [P('wall', 1, 0, 0, 1)], 1, 0.3],
      ['wall corner', [P('wall', 1, 0, 0, 1), P('wall', 1, 0, 0, 0)], 1.001, -0.999],
      ['pillar', [P('pillar', 1, 1, 0)], 1.02, 0.99],
      ['jamb', [P('door', 1, 0, 0, 1)], 1, -0.75],
      ['doorway', [P('door', 1, 0, 0, 1)], 1, 0],
    ]) {
      const g = grid(tilesSq(2), pieces);
      const ph = new PlayerPhysics({ x, y: eyeAt(0), z });
      const tr = run(g, ph, 0.5, {}, v);
      assert.ok(tr[0].pen < 1e-6, `${name} ${tag(v)}: out after the first frame`);
      noPen(tr, `${name} ${tag(v)}`);
      assert.ok(ph.grounded && Math.abs(ph.y - EYE - tr.at(-1).deckY) < 1e-6, `${name}: standing on the deck`);
      assert.ok(Math.hypot(ph.x - x, ph.z - z) < 0.5, `${name}: small correction`);
    }
  }
});

// ============================================================ ledges, ceilings

test('walking off an upper floor edge falls and lands; standing under a floor edge bonks the head', () => {
  for (const v of VARIANTS) {
    const g = grid(tilesSq(3), [P('wall', 0, 0, 0, 0), P('floor', 0, 0, 1)]);
    for (const [dx, dz] of DIR) {
      const ph = new PlayerPhysics({ x: 0, y: eyeAt(LEVEL_H), z: 0 }), st = { t: 0 };
      run(g, ph, 0.1, {}, v, st);
      const tr = run(g, ph, 2.5, { forward: 1, yaw: yawTo(dx, dz) }, v, st);
      assert.ok(tr.some(s => !s.grounded), `${tag(v)} dir ${dx},${dz}: fell`);
      assert.ok(ph.grounded && Math.abs(ph.y - EYE - st.deck) < 1e-6, `${tag(v)}: landed on the deck`);
      assert.ok(maxOf(tr, s => -s.dy) < 0.6, `${tag(v)}: no teleport (${maxOf(tr, s => -s.dy)})`);
      noPen(tr, tag(v));
    }
    // Body centre under the slab: the head stops at it.
    for (const x of [0, 0.95]) {
      const ph = new PlayerPhysics({ x, y: eyeAt(0), z: 0 });
      const tr = run(g, ph, 1.2, { jump: true }, v);
      assert.ok(maxOf(tr, s => s.y + 0.15 - s.deckY) <= LEVEL_H - FLOOR_THICK + 1e-6, `${tag(v)} x=${x}: head under the slab`);
      assert.ok(ph.grounded);
    }
    // Body only overlapping the slab edge from outside the cell (x = 1.1, 1.2): pushed out sideways as the head comes
    // up to it, so the jump rises past the edge (no 0.33 m cap) and the head is never inside the slab.
    for (const x of [1.1, 1.2]) {
      const ph = new PlayerPhysics({ x, y: eyeAt(0), z: 0 });
      const tr = run(g, ph, 1.2, { jump: true }, v);
      const inside = tr.filter(s => s.y + 0.15 - s.deckY > LEVEL_H - FLOOR_THICK + 1e-6 && s.feet < LEVEL_H);
      assert.ok(inside.every(s => s.x >= 1 + R - 1e-6), `${tag(v)} x=${x}: beside the slab while the head is above its bottom`);
      assert.ok(maxOf(tr, s => s.feet) > 1.2, `${tag(v)} x=${x}: full jump (${maxOf(tr, s => s.feet)})`);
      assert.ok(ph.grounded);
    }
    // Running jump into the slab edge from the open: no head poking through the floor.
    const ph = new PlayerPhysics({ x: -3, y: eyeAt(0), z: 0 });
    const tr = run(g, ph, 2.5, { forward: 1, yaw: yawTo(1, 0), jump: true, sprint: true }, v);
    // The jump now rises past the slab, so its edge may be met from the side with the feet within the 0.55 m
    // slab step-up (ledge contact, pushed out or lifted on top); lower than that the head stays under it.
    const under = tr.filter(s => Math.abs(s.x) < 1 + R && Math.abs(s.z) < 1 + R && s.feet < LEVEL_H - 0.55);
    assert.ok(maxOf(under, s => s.y + 0.15 - s.deckY) <= LEVEL_H - FLOOR_THICK + 1e-6, `${tag(v)}: head stayed under the floor`);
  }
});

test('roof: walk up from an upper floor, off the high end and off the side (falls, lands, no teleport)', () => {
  for (const v of VARIANTS) {
    const g = grid(tilesSq(2), [P('pillar', 0, 0, 0), P('pillar', 1, 0, 0), P('pillar', 0, 1, 0), P('pillar', 1, 1, 0),
      P('pillar', 0, -1, 0), P('pillar', 1, -1, 0), P('floor', 0, -1, 1), P('roof', 0, 0, 1, 0)]);
    const a = new PlayerPhysics({ x: 0, y: eyeAt(LEVEL_H), z: -2 }), st = { t: 0 };
    const ta = run(g, a, 2.5, { forward: 1, yaw: yawTo(0, 1) }, v, st);
    assert.ok(maxOf(ta, s => s.feet) > LEVEL_H + 0.9, `${tag(v)}: climbed the roof`);
    assert.ok(a.grounded && Math.abs(a.y - EYE - st.deck) < 1e-6 && a.z > 1, `${tag(v)}: fell off the high end onto the deck`);
    // Per-frame drop of a ~3.2 m fall under FALL_GRAVITY is up to ~0.7 m at 20 fps; a teleport is a multi-metre snap.
    assert.ok(maxOf(ta, s => Math.abs(s.dy)) < Math.max(0.6, 16 * v.dt), `${tag(v)}: no teleport (${maxOf(ta, s => Math.abs(s.dy))})`);
    noPen(ta, tag(v));
    const b = new PlayerPhysics({ x: 0, y: eyeAt(LEVEL_H), z: -2 }), sb = { t: 0 };
    run(g, b, 1.1, { forward: 1, yaw: yawTo(0, 1) }, v, sb);
    const tb = run(g, b, 1.8, { forward: 1, yaw: yawTo(1, 0) }, v, sb); // off the side, landing well before the raft edge
    assert.ok(b.grounded && Math.abs(b.y - EYE - sb.deck) < 1e-6 && b.x > 1, `${tag(v)}: fell off the side`);
    noPen(tb, tag(v));
    // Jumping under the roof bonks on its slab.
    const c = new PlayerPhysics({ x: 0, y: eyeAt(0), z: 0 });
    const tc = run(g, c, 1.2, { jump: true }, v);
    assert.ok(maxOf(tc, s => s.y + 0.15 - s.deckY) <= LEVEL_H - FLOOR_THICK + 1e-6, `${tag(v)}: head under the roof`);
  }
});

// ============================================================ water

test('swimming along walls at the raft edge never enters them', () => {
  for (const v of VARIANTS) {
    const g = grid(tilesSq(1), [P('wall', 2, -1, 0, 1), P('wall', 2, 0, 0, 1), P('door', 2, 1, 0, 1), P('pillar', 2, 2, 0)]);
    const ph = new PlayerPhysics({ x: 3.4, y: WATER + 0.45, z: -3.5, swimming: true });
    const tr = run(g, ph, 4, { forward: 1, yaw: yawTo(-0.4, 1) }, v);
    noPen(tr, tag(v));
    assert.ok(tr.every(s => s.swimming), `${tag(v)}: kept swimming`);
    assert.ok(ph.z > 2, `${tag(v)}: swam along (z ${ph.z})`);
  }
});

test('auto clamber: refused through a wall / window / half wall, allowed through a doorway and past a corner pillar', () => {
  for (const v of VARIANTS) {
    for (const t of ['wall', 'window', 'halfwall', 'door']) {
      const g = grid(tilesSq(1), [P(t, 2, -1, 0, 1), P(t, 2, 0, 0, 1), P(t, 2, 1, 0, 1)]); // east raft edge x = 3
      const ph = new PlayerPhysics({ x: 3.5, y: WATER + 0.45, z: 0, swimming: true }), st = { t: 0 };
      const tr = run(g, ph, 2, { jump: true }, v, st);
      noPen(tr, `${t} ${tag(v)}`);
      if (t === 'door') {
        assert.ok(!ph.swimming && ph.grounded && ph.x < 3 - 0.07 - R + 1e-6, `${t} ${tag(v)}: climbed in through the doorway`);
      } else {
        assert.ok(ph.swimming && !ph.climbing && ph.x > 3, `${t} ${tag(v)}: still in the water outside (x ${ph.x})`);
        // ... and can still swim away while holding jump.
        const away = run(g, ph, 1, { jump: true, forward: 1, yaw: yawTo(0, 1) }, v, st);
        assert.ok(ph.z > 1, `${t} ${tag(v)}: swims along while holding jump (z ${ph.z})`);
        noPen(away, `${t} ${tag(v)}`);
      }
    }
    // Open edge with a pillar on the corner: the climb still works and does not end inside the post.
    const g = grid(tilesSq(1), [P('pillar', 2, 2, 0)]); // post at (3, 3)
    const ph = new PlayerPhysics({ x: 3.45, y: WATER + 0.45, z: 2.75, swimming: true });
    const tr = run(g, ph, 2, { jump: true }, v);
    noPen(tr, `pillar ${tag(v)}`);
    assert.ok(!ph.swimming && ph.grounded, `pillar ${tag(v)}: climbed out`);
  }
});

// ============================================================ a whole house

test('two-storey house with roof: in the door, up the stairs, around upstairs, down the stairwell', () => {
  // Cells (0..1, 0..1). Door on the south side of (0,0); stairs in (1,0) rising +z with its foot open to the south.
  const pieces = [
    P('door', 0, 0, 0, 0), P('wall', 0, 0, 0, 1), P('wall', 0, 1, 0, 1), P('wall', 2, 0, 0, 1), P('wall', 2, 1, 0, 1),
    P('wall', 0, 2, 0, 0), P('wall', 1, 2, 0, 0), P('stairs', 1, 0, 0, 0),
    P('floor', 0, 0, 1), P('floor', 0, 1, 1), P('floor', 1, 1, 1),
    P('wall', 0, 0, 1, 0), P('wall', 0, 0, 1, 1), P('wall', 0, 1, 1, 1), P('wall', 2, 0, 1, 1), P('window', 2, 1, 1, 1),
    P('window', 0, 2, 1, 0), P('wall', 1, 2, 1, 0),
    P('roof', 0, 0, 2, 0), P('roof', 1, 0, 2, 0), P('roof', 0, 1, 2, 0), P('roof', 1, 1, 2, 0),
  ];
  for (const v of VARIANTS) {
    const g = grid(tilesSq(3), pieces), st = { t: 0 };
    const ph = new PlayerPhysics({ x: 0, y: eyeAt(0), z: -3 });
    const all = [];
    const go = (sec, input) => { const tr = run(g, ph, sec, input, v, st); all.push(...tr); return tr; };
    go(1.6, { forward: 1, yaw: yawTo(0, 1) }); // through the door
    assert.ok(ph.z > 0 && Math.abs(ph.x) < 0.3, `${tag(v)}: inside (z ${ph.z})`);
    go(1.5, { forward: 1, yaw: yawTo(0, 1) }); // into the north wall
    assert.ok(ph.z <= 3 - 0.07 - R + 1e-6, `${tag(v)}: north wall holds`);
    go(2.2, { forward: 1, yaw: yawTo(0, -1) }); // back out
    assert.ok(ph.z < -1.5, `${tag(v)}: back outside`);
    // Around to the foot of the stairs and up.
    ph.x = 2; ph.z = -2.5;
    go(0.2, {});
    go(2.2, { forward: 1, yaw: yawTo(0, 1) });
    go(0.3, {});
    assert.ok(ph.grounded && Math.abs(ph.y - EYE - st.deck - LEVEL_H) < 1e-6 && ph.z > 1, `${tag(v)}: upstairs`);
    assert.ok(ph.z <= 3 - 0.07 - R + 1e-6, `${tag(v)}: upstairs north wall holds`);
    go(2, { forward: 1, yaw: yawTo(-1, 0) }); // west across the landing to (0,1)
    assert.ok(ph.x <= -1 + 0.07 + R + 1e-6 && ph.grounded && Math.abs(ph.y - EYE - st.deck - LEVEL_H) < 1e-6, `${tag(v)}: upstairs west wall`);
    go(2, { forward: 1, yaw: yawTo(0, -1) }); // south to (0,0) above the door
    assert.ok(ph.z >= -1 + 0.07 + R - 1e-6 && Math.abs(ph.y - EYE - st.deck - LEVEL_H) < 1e-6, `${tag(v)}: upstairs south wall`);
    const jump = go(1.2, { jump: true }); // under the roof
    assert.ok(maxOf(jump, s => s.y + 0.15 - s.deckY) <= 2 * LEVEL_H - FLOOR_THICK + 1e-6, `${tag(v)}: head under the roof`);
    go(0.5, {});
    go(2.5, { forward: 1, yaw: yawTo(1, 0) }); // east into the open stairwell: drop onto the stairs, slide to the wall
    go(0.6, {});
    assert.ok(ph.grounded && ph.x > 1 && ph.x <= 3 - 0.07 - R + 1e-6, `${tag(v)}: in the stairwell (x ${ph.x})`);
    const ramp = rampAt(1, 0, 0, 0, ph.x, ph.z);
    assert.ok(Math.abs(ph.y - EYE - st.deck - ramp) < 0.05, `${tag(v)}: standing on the stairs (feet ${ph.y - EYE - st.deck}, ramp ${ramp})`);
    noPen(all, tag(v));
  }
});
