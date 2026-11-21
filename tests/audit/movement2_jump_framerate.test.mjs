// AUDIT MOVEMENT-2: jump apex depends on frame rate (semi-implicit Euler gravity, player-physics.js ~150-156).
// The game clamps dt to 0.05, so 20 fps is the worst case. Asserts frame-rate consistency (20 vs 144 fps
// within 4%) rather than exact analytic accuracy.
// Run: node --test tests/audit/movement2_jump_framerate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../../dist/', import.meta.url).href;
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));
const tiles = [[0, 0]], deckY = .2, waterY = -.24;
function apex(dt) {
  const p = new PlayerPhysics({x: 0, y: deckY + PC.EYE_OFFSET, z: 0});
  p.update(dt, {tiles, deckY, waterY});
  let max = 0;
  for (let i = 0; i < 2 / dt; i++) {
    p.update(dt, {tiles, deckY, waterY, jump: true});
    max = Math.max(max, p.y - PC.EYE_OFFSET - deckY);
    if (i > 0 && p.grounded) break;
  }
  return max;
}
test('MOVEMENT-2: jump apex at 20 fps is within 4% of the apex at 144 fps', () => {
  const hi = apex(1 / 144), lo = apex(1 / 20);
  assert.ok(Math.abs(hi - lo) / hi < .04, `apex 144 fps = ${hi.toFixed(3)} m, 20 fps = ${lo.toFixed(3)} m (${(100 * (hi - lo) / hi).toFixed(1)}% lower)`);
});
