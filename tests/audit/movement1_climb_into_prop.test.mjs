// AUDIT MOVEMENT-1: holding Space to climb aboard onto an edge tile that has a crate/palm/bench
// puts the player at the prop's exact centre (inside it).
// Run: node --test tests/audit/movement1_climb_into_prop.test.mjs   (optional RAFT_DIST=<dist dir>)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../../dist/', import.meta.url).href;
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));

const tiles = Array.from({length: 9}, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]);
// game.js: blockList = decor.map(d => ({x:d.x*2, z:d.z*2, r:BLOCK_RADIUS[d.type]})), decor sits at tile centre
const PROPS = {crate: .55, palm: .42, bench: .45};

for (const [type, r] of Object.entries(PROPS)) {
  test(`climbing aboard onto an edge tile with a ${type} does not end inside the ${type}`, () => {
    const blocked = [{x: 0, z: 2, r}]; // decor on edge tile [0,1]
    const p = new PlayerPhysics({x: 0, y: -0.24 + PC.SWIM_EYE_ABOVE_WATER, z: 4.5, swimming: true});
    let climbed = false;
    for (let i = 0; i < 600 && !(p.grounded && !p.climbing); i++) {
      p.update(1 / 60, {tiles, deckY: .2, waterY: -.24, forward: 1, yaw: 0, jump: true, blocked});
      climbed ||= p.climbing;
    }
    assert.ok(climbed && p.grounded, 'expected the clamber to finish on deck');
    const d = Math.hypot(p.x - blocked[0].x, p.z - blocked[0].z);
    assert.ok(d >= r + PC.BODY_RADIUS - 1e-6,
      `player ended ${d.toFixed(3)} from ${type} centre (needs >= ${(r + PC.BODY_RADIUS).toFixed(2)}); pos=(${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
  });
}
