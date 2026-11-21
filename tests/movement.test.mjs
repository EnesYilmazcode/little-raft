// Regression tests for movement and build placement (MOV-1..MOV-4).
// Run: node --test tests/movement.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));
const {
  floorBlock, decorBlock, inReach, BUILD_REACH, GUEST_REACH_SLACK, WORLD_BOUND, MAX_TILES, BLOCK_TEXT,
} = await import(new URL('build-rules.js', base));

const DT = 1 / 60;
const grid3 = () => { const t = []; for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) t.push([x, z]); return t; };

// ---------------------------------------------------------------- MOV-1 clamber beside a prop

test('clambering next to a prop never lands inside it', () => {
  const tiles = grid3();
  for (const r of [0.55, 0.45, 0.42, 0.14]) {
    const blocked = [{ x: 2, z: 0, r }];
    for (let z0 = -1.2; z0 <= 1.2001; z0 += 0.1) {
      const p = new PlayerPhysics({ x: 3.6, y: 0.2, z: z0, swimming: true });
      for (let i = 0; i < 240 && !(p.grounded && !p.climbing); i++) {
        p.update(DT, { tiles, blocked, deckY: 0.2, waterY: -0.24, yaw: Math.PI / 2, forward: 1, jump: true });
      }
      assert.ok(p.grounded, `r=${r} z0=${z0.toFixed(1)} should climb`);
      const d = Math.hypot(p.x - 2, p.z);
      assert.ok(d >= r + PC.BODY_RADIUS - 1e-9, `r=${r} z0=${z0.toFixed(1)} ended ${d.toFixed(3)} from prop`);
      assert.ok(Math.abs(p.x) <= 3 && Math.abs(p.z) <= 3, 'lands on the raft');
    }
  }
});

test('clamber with no prop still targets the near edge', () => {
  const p = new PlayerPhysics({ x: 3.4, y: 0.2, z: 0, swimming: true });
  for (let i = 0; i < 120 && !(p.grounded && !p.climbing); i++) p.update(DT, { tiles: grid3(), deckY: 0.2, waterY: -0.24, jump: true });
  assert.ok(p.grounded);
  assert.ok(Math.abs(p.x - 2.55) < 1e-6 && Math.abs(p.z) < 1e-6, `got ${p.x},${p.z}`);
});

// ---------------------------------------------------------------- MOV-2 jump buffer

// Jump once, then press (and hold) Space `early` seconds before the frame we would land on.
function bufferedJump(earlyFrames) {
  const tiles = [[0, 0]];
  const inp = jump => ({ tiles, deckY: 0.2, waterY: -0.24, jump });
  const probe = new PlayerPhysics({ x: 0, y: 1.8, z: 0 });
  probe.update(DT, inp(false)); probe.update(DT, inp(true));
  let L = 0; while (!probe.update(DT, inp(false)).landed) L++;
  const p = new PlayerPhysics({ x: 0, y: 1.8, z: 0 });
  p.update(DT, inp(false)); p.update(DT, inp(true));
  let rejumped = false;
  for (let i = 0; i <= L + 30; i++) {
    const before = p.vy;
    p.update(DT, inp(i >= L - earlyFrames));
    if (i >= L - earlyFrames && p.vy > 0 && before <= 0) rejumped = true;
  }
  return rejumped;
}

test('a press shortly before landing jumps on landing', () => {
  for (const f of [0, 1, 3, 6]) assert.ok(bufferedJump(f), `${f} frames early`);
});

test('a press well before landing is not buffered', () => {
  assert.equal(bufferedJump(Math.ceil(0.2 / DT)), false);
});

test('holding Space while landing does not bounce forever', () => {
  const tiles = [[0, 0]];
  const p = new PlayerPhysics({ x: 0, y: 1.8, z: 0 });
  p.update(DT, { tiles, jump: false });
  let jumps = 0;
  for (let i = 0; i < 300; i++) { const b = p.vy; p.update(DT, { tiles, jump: true }); if (p.vy > 0 && b <= 0) jumps++; }
  assert.equal(jumps, 1);
  assert.ok(p.grounded);
});

// ---------------------------------------------------------------- MOV-3 world bound and tile cap

test('floor placement refuses the world bound and tile cap with a reason', () => {
  const strip = []; for (let x = 0; x <= WORLD_BOUND; x++) strip.push([x, 0]);
  assert.equal(floorBlock(strip, WORLD_BOUND + 1, 0), 'bound');
  assert.equal(floorBlock(strip, WORLD_BOUND, 1), null);
  assert.equal(floorBlock(strip, 3, 0), 'occupied');
  assert.equal(floorBlock(strip, 3, 5), 'detached');
  const full = []; for (let i = 0; i < MAX_TILES; i++) full.push([i % 20 - 10, Math.floor(i / 20) - 10]);
  assert.equal(floorBlock(full, -11, 0), 'cap');
  assert.ok(BLOCK_TEXT.bound && BLOCK_TEXT.cap);
});

test('decor placement needs an empty floor', () => {
  const tiles = [[0, 0], [1, 0]], decor = [{ type: 'crate', x: 1, z: 0 }];
  assert.equal(decorBlock(tiles, decor, 0, 0), null);
  assert.equal(decorBlock(tiles, decor, 1, 0), 'occupied');
  assert.equal(decorBlock(tiles, decor, 2, 0), 'nofloor');
});

// ---------------------------------------------------------------- MOV-4 reach

test('build reach is measured from the player to the cell centre', () => {
  assert.ok(inReach(0, 0, 3, 0));             // 6 m
  assert.ok(!inReach(0, 0, 4, 0));            // 8 m
  assert.ok(!inReach(0, 0, 15, 1));           // the far-build repro
  assert.ok(inReach(0, 0, 4, 0, BUILD_REACH + GUEST_REACH_SLACK)); // host slack for guests
  assert.ok(!inReach(NaN, 0, 0, 0));
});
