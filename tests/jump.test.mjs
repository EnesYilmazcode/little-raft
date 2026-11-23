// Jump tuning: a jump clears one wall (LEVEL_H) so a player can hop up onto a one-storey structure, with
// stronger gravity falling than rising, and ceilings stop the rise. Drives PlayerPhysics + BuildGrid the way
// game.js does: preStep, PlayerPhysics.update in equal substeps (<= 0.05 s, frame capped at 0.25 s), postStep.
// Run: node --test tests/jump.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { BuildGrid, LEVEL_H, FLOOR_THICK } = await import(new URL('building-pieces.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC, MOVE_MUL } = await import(new URL('player-physics.js', base));
// cookpot.js caps the jump buff (impulse multiplier); read it from the source so a retune cannot slip past.
const COOK_JUMP = +readFileSync(fileURLToPath(new URL('cookpot.js', base)), 'utf8').match(/MOVE_MUL\.jump = Math\.min\(mods\.jump, ([\d.]+)\)/)[1];

const EYE = PC.EYE_OFFSET, HEAD = 0.15, WATER = -0.24, D0 = 0.2;
const tilesSq = (n) => { const a = []; for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) a.push([i, j]); return a; };
const P = (t, i, j, l, r = 0) => ({ t, i, j, l, r });
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const grid = (pieces) => {
  const g = new BuildGrid();
  g.setTiles(tilesSq(3));
  for (const p of pieces) assert.ok(g.place(p), `setup place ${JSON.stringify(p)}: ${g.canPlace(p)}`);
  return g;
};
// One closed one-storey room on cell (0,0): four walls and a floor on top (its top is the wall top).
const ROOM = [P('wall', 0, 0, 0, 0), P('wall', 0, 1, 0, 0), P('wall', 0, 0, 0, 1), P('wall', 1, 0, 0, 1), P('floor', 0, 0, 1)];
const FRAMES = [1 / 144, 1 / 60, 1 / 30, 1 / 20, 0.25]; // 0.25 s = the game's frame cap (5 substeps)
const BOBS = [0, 0.15];
const tag = (dt, bob) => `dt=1/${Math.round(1 / dt)} bob=${bob}`;

// Game movement loop. Returns per-frame samples; feet / head are relative to the moving deck.
function run(g, ph, seconds, input, dt, bob = 0, st = { t: 0 }) {
  const out = [], n = Math.max(1, Math.ceil(dt / 0.05 - 1e-9)), step = dt / n;
  for (let f = 0; f < Math.round(seconds / dt); f++) {
    st.t += dt;
    const deckY = D0 + bob * Math.sin(st.t * 2 * Math.PI / 2.5);
    const inp = typeof input === 'function' ? input(ph, f) : input;
    const surf = g ? g.preStep(ph, deckY) : { tiles: tilesSq(3), deckY };
    for (let i = 0; i < n; i++) ph.update(step, { ...inp, tiles: surf.tiles, deckY: surf.deckY, waterY: WATER });
    if (g) g.postStep(ph, deckY);
    out.push({ x: ph.x, z: ph.z, feet: ph.y - EYE - deckY, head: ph.y + HEAD - deckY, vy: ph.vy, grounded: ph.grounded });
  }
  return out;
}

// Flat-deck jump probe: apex above takeoff, time to apex, total airtime.
function probe(dt) {
  const ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: 0 });
  run(null, ph, dt, {}, dt);
  let t = 0, apex = 0, tApex = 0, air = NaN, left = false;
  const tr = run(null, ph, 2, { jump: true }, dt);
  for (const s of tr) {
    t += dt;
    if (!s.grounded) left = true;
    if (s.feet > apex) { apex = s.feet; tApex = t; }
    if (left && s.grounded && Number.isNaN(air)) air = t;
  }
  return { apex, tApex, air };
}

test('jump probe: apex clears a wall by a margin but not absurdly, airtime about 0.9 s, at any fps', () => {
  const ideal = PC.JUMP_IMPULSE ** 2 / (2 * PC.GRAVITY);
  assert.ok(ideal >= LEVEL_H + 0.15, `apex ${ideal} >= wall ${LEVEL_H} + 0.15`);
  assert.ok(ideal < LEVEL_H + 0.6, `apex ${ideal} < wall ${LEVEL_H} + 0.6`);
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    const { apex, tApex, air } = probe(dt);
    assert.ok(Math.abs(apex - ideal) < 0.01, `${tag(dt, 0)}: apex ${apex} vs ${ideal}`);
    assert.ok(Math.abs(tApex - PC.JUMP_IMPULSE / PC.GRAVITY) < dt + 1e-9, `${tag(dt, 0)}: time to apex ${tApex}`);
    assert.ok(air >= 0.8 && air <= 1.0, `${tag(dt, 0)}: airtime ${air}`);
  }
});

test('falling gravity is stronger than rising gravity (snappy jump)', () => {
  assert.ok(PC.FALL_GRAVITY > PC.GRAVITY, `${PC.FALL_GRAVITY} > ${PC.GRAVITY}`);
  // The step that crosses the apex is split exactly: the fall part uses FALL_GRAVITY.
  const ph = new PlayerPhysics({ x: 0, y: 5, z: 0, vy: 0.1 });
  ph.update(0.05, { tiles: [], deckY: -10, waterY: -20 });
  const t1 = 0.1 / PC.GRAVITY, t2 = 0.05 - t1;
  assert.ok(Math.abs(ph.vy + PC.FALL_GRAVITY * t2) < 1e-9, `vy ${ph.vy}`);
  assert.ok(Math.abs(ph.y - (5 + 0.1 * t1 / 2 - PC.FALL_GRAVITY * t2 * t2 / 2)) < 1e-9, `y ${ph.y}`);
});

test('ceiling: jumping under a floor stops the rise at the slab and the head never enters it', () => {
  const slab = LEVEL_H - FLOOR_THICK;
  for (const dt of FRAMES) for (const bob of BOBS) {
    for (const [name, pieces, x] of [['room', ROOM, 0], ['open floor on pillars', [P('pillar', 0, 0, 0), P('pillar', 1, 1, 0), P('floor', 0, 0, 1)], 0.4]]) {
      const g = grid(pieces), msg = `${name} ${tag(dt, bob)}`;
      const ph = new PlayerPhysics({ x, y: D0 + EYE, z: 0 }), st = { t: 0 };
      run(g, ph, 0.1, {}, dt, bob, st);
      const tr = run(g, ph, 1.5, { jump: true }, dt, bob, st);
      assert.ok(tr.some(s => !s.grounded), `${msg}: jumped`);
      assert.ok(Math.max(...tr.map(s => s.head)) <= slab + 1e-6, `${msg}: head under the slab (${Math.max(...tr.map(s => s.head))})`);
      const hit = tr.findIndex(s => Math.abs(s.head - slab) < 1e-6);
      assert.ok(hit >= 0, `${msg}: reached the ceiling`);
      assert.ok(tr[hit].vy <= 0, `${msg}: upward velocity stopped at the ceiling (vy ${tr[hit].vy})`);
      assert.ok(ph.grounded && Math.abs(tr.at(-1).feet) < 1e-6, `${msg}: back on the deck`);
    }
  }
});

test('a running jump from the deck lands on top of a one-wall-high room', () => {
  for (const dt of [1 / 60, 1 / 30, 1 / 20]) for (const bob of BOBS) for (const sprint of [true, false]) {
    const g = grid(ROOM), msg = `${tag(dt, bob)} ${sprint ? 'sprint' : 'walk'}`;
    // Run up along +x, jump a short way before the -x wall (x = -1).
    const ph = new PlayerPhysics({ x: -5, y: D0 + EYE, z: 0 }), st = { t: 0 };
    const tr = run(g, ph, 2.5, (p) => ({ forward: p.x < 0 ? 1 : 0, yaw: yawTo(1, 0), sprint, jump: p.x > (sprint ? -2.6 : -2.1) }), dt, bob, st);
    const end = run(g, ph, 0.5, {}, dt, bob, st).at(-1);
    assert.ok(ph.grounded, `${msg}: grounded`);
    assert.ok(Math.abs(end.feet - LEVEL_H) < 1e-6, `${msg}: standing on the room's floor top (feet ${end.feet}, x ${ph.x}, max ${Math.max(...tr.map(s => s.feet))})`);
    assert.ok(Math.abs(ph.x) < 1 && Math.abs(ph.z) < 1, `${msg}: over the room cell`);
  }
});

test('the same jump against a two-storey wall is blocked and lands back on the deck', () => {
  for (const dt of [1 / 60, 1 / 20]) for (const bob of BOBS) {
    const g = grid([...ROOM, P('wall', 0, 0, 1, 1)]); // second-storey wall above the -x wall
    const ph = new PlayerPhysics({ x: -5, y: D0 + EYE, z: 0 }), st = { t: 0 };
    run(g, ph, 2.5, (p) => ({ forward: 1, yaw: yawTo(1, 0), sprint: true, jump: p.x > -2.6 }), dt, bob, st);
    run(g, ph, 1, {}, dt, bob, st);
    assert.ok(ph.grounded && ph.x < -1 - 0.07 - PC.BODY_RADIUS + 1e-6, `${tag(dt, bob)}: blocked (x ${ph.x})`);
    assert.ok(ph.y - EYE < D0 + 0.2, `${tag(dt, bob)}: on the deck`);
  }
});

// Railings all round the raft (cells -1..1, outer edges at +-3).
const RING = [];
for (let k = -1; k <= 1; k++) RING.push(P('railing', 2, k, 0, 1), P('railing', -1, k, 0, 1), P('railing', k, 2, 0, 0), P('railing', k, -1, 0, 0));
const ringGrid = () => { const g = new BuildGrid(); g.setTiles(tilesSq(1)); for (const p of RING) assert.ok(g.place(p)); return g; };

test('railings keep sprint jumps on the raft, with the cookpot jump buff too', () => {
  assert.ok(COOK_JUMP >= 1 && COOK_JUMP < 2, `cookpot jump cap ${COOK_JUMP}`);
  try {
    for (const mul of [1, COOK_JUMP]) for (const dt of [1 / 60, 1 / 20]) for (const bob of BOBS) for (const jx of [0.5, 1, 1.5, 2]) for (const t0 of [0, 0.4, 0.8]) {
      MOVE_MUL.jump = mul;
      const g = ringGrid(), ph = new PlayerPhysics({ x: -1, y: D0 + EYE, z: 0 }), st = { t: t0 };
      const tr = run(g, ph, 3, (p) => ({ forward: 1, yaw: yawTo(1, 0), sprint: true, jump: p.x > jx }), dt, bob, st);
      const msg = `mul ${mul} ${tag(dt, bob)} jump at x ${jx} t0 ${t0}`;
      assert.ok(tr.some(s => s.feet > 2), `${msg}: jumped high`);
      assert.ok(Math.max(...tr.map(s => s.x)) <= 3 - 0.07 - PC.BODY_RADIUS + 1e-6 && !ph.swimming, `${msg}: stayed aboard (x ${ph.x})`);
    }
  } finally { MOVE_MUL.jump = 1; }
});

test('a railing under an upper floor does not bump players jumping up there', () => {
  // Pillars hold two floors on cells (0,0) and (1,0); a railing on the deck edge x = 1 below them.
  const sup = [P('pillar', 0, 0, 0), P('pillar', 1, 0, 0), P('pillar', 2, 0, 0), P('pillar', 0, 1, 0), P('pillar', 1, 1, 0), P('pillar', 2, 1, 0)];
  const ups = [P('floor', 0, 0, 1), P('floor', 1, 0, 1)];
  for (const dt of [1 / 60, 1 / 20]) {
    const ends = [];
    for (const rail of [[], [P('railing', 1, 0, 0, 1)]]) {
      const g = grid([...sup, ...rail, ...ups]), e = [];
      for (const [x, input] of [[1.1, (p, n) => ({ jump: n < 2 })], [-0.5, (p, n) => ({ forward: 1, yaw: yawTo(1, 0), jump: n < 2 })]]) {
        const ph = new PlayerPhysics({ x, y: D0 + LEVEL_H + EYE, z: 0.3 }), st = { t: 0 };
        run(g, ph, 0.1, {}, dt, 0, st);
        run(g, ph, 1.2, input, dt, 0, st);
        assert.ok(ph.grounded && Math.abs(ph.y - EYE - D0 - LEVEL_H) < 1e-6, `${tag(dt, 0)}: landed upstairs`);
        e.push(ph.x, ph.z);
      }
      ends.push(e);
    }
    for (let k = 0; k < ends[0].length; k++) assert.ok(Math.abs(ends[0][k] - ends[1][k]) < 1e-9, `${tag(dt, 0)}: same path with the railing below (${ends[0]} vs ${ends[1]})`);
  }
});
