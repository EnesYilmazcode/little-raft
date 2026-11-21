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
const T = await import(new URL('vendor/three.module.js', base));
const { createFarmView } = await import(new URL('farming-view.js', base));
const { createGhosts } = await import(new URL('placement.js', base));

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

// ------------------------------------------------------------- BUILD-2
test('BUILD-2: the planter ghost is the empty pot, with its own materials', () => {
  const view = createFarmView(T);
  const ghost = view.ghostModel('planter'), size = new T.Box3().setFromObject(ghost).getSize(new T.Vector3());
  assert.ok(size.y < .7 && size.x < .9, `ghost is a pot, not a palm tree (${size.x.toFixed(2)} x ${size.y.toFixed(2)})`);
  // Placed planters keep working after the ghost has taken (and disposed) its materials.
  const disposed = new Set();
  const real = [];
  view.sync([{type:'palm', x:0, z:0, rot:0, farm:{s:-1, g:0, w:0, h:0}}]);
  view.group.traverse(o => { if (o.isMesh) real.push(o.material); });
  for (const m of real) m.addEventListener('dispose', () => disposed.add(m));
  const scene = new T.Scene(), raft = new T.Group();
  const ghosts = createGhosts(T, scene, raft, {floor:() => null, craft:() => view.ghostModel('planter')});
  ghosts.show('palm', 0, .22, 0, 0, true, 0);
  assert.equal(disposed.size, 0, 'no shared planter material was disposed');
});
