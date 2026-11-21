// Regression tests for the round-2 build fixes (placement, colliders, removal, prompts).
// Run: node --test tests/build-r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { decorBlockers, playerInWay } = await import(new URL('coop-rules.js', base));
const { PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));
const { BLOCK_TEXT } = await import(new URL('build-rules.js', base));

// ------------------------------------------------------------- BUILD-1
const RADII = {palm:.42, crate:.55, bench:.45, sail:.14, lantern:.12};

test('BUILD-1: a prop dropped on the local player or the brother is refused', () => {
  const crate = decorBlockers({type:'crate', x:.153, z:1.677, rot:0}, RADII, 1);
  const me = {x:0, z:2}, far = {x:4, z:4};
  assert.equal(playerInWay(crate, [me, far], PC.BODY_RADIUS + .05), 0, 'probe from the BUILD-1 repro: crate at my feet');
  assert.equal(playerInWay(crate, [far, me], PC.BODY_RADIUS), 1, 'the other player is checked too');
  assert.equal(playerInWay(crate, [far, null], PC.BODY_RADIUS), -1, 'nobody near: ok; a missing guest pose is skipped');
  assert.equal(playerInWay(crate, [{x:NaN, z:0}], PC.BODY_RADIUS), -1);
  assert.ok(BLOCK_TEXT.self && BLOCK_TEXT.brother, 'both refusals have a reason to show');
});
