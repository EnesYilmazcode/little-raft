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
const { createGhosts, decorCheck, FOOTPRINT } = await import(new URL('placement.js', base));
const { PlayerPhysics, blockerGap } = await import(new URL('player-physics.js', base));
const { createCraft } = await import(new URL('crafts.js', base));

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

// ------------------------------------------------------------- BUILD-3
const COLLIDE = {palm:.42, bench:.45, crate:FOOTPRINT.crate, sail:FOOTPRINT.sail, lantern:FOOTPRINT.lantern}; // as game.js BLOCK_RADIUS
const deck = () => true;

test('BUILD-3: footprints cover each model below head height, centred on the origin', () => {
  for (const k of ['sail', 'lantern', 'crate']) {
    const g = createCraft(T, k); g.updateMatrixWorld(true);
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; const v = new T.Vector3();
    g.traverse(o => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v.y > 1.8) continue; x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z); } });
    const [hx, hz] = FOOTPRINT[k];
    assert.ok(x0 >= -hx - .02 && x1 <= hx + .02 && z0 >= -hz - .02 && z1 <= hz + .02, `${k} model x ${x0.toFixed(2)}..${x1.toFixed(2)} z ${z0.toFixed(2)}..${z1.toFixed(2)} fits ±${hx}/${hz}`);
    assert.ok(Math.abs(x0 + x1) < .1 && Math.abs(z0 + z1) < .1, `${k} is centred`);
  }
});

test('BUILD-3: overlapping sails and a crate on the lantern feet are refused', () => {
  const sail = {type:'sail', x:0, z:0, rot:0}, lantern = {type:'lantern', x:0, z:0, rot:0};
  assert.equal(decorCheck(deck, [sail], {type:'sail', x:.82, z:0, rot:0}), 'blocked');
  assert.equal(decorCheck(deck, [sail], {type:'sail', x:1.62, z:0, rot:0}), 'ok');
  assert.equal(decorCheck(deck, [lantern], {type:'crate', x:-.75, z:0, rot:0}), 'blocked');
  assert.equal(decorCheck(deck, [lantern], {type:'crate', x:-1.1, z:0, rot:0}), 'ok');
});

test('BUILD-3: rect colliders stop the player at the visible face, and rotate with the prop', () => {
  const tiles = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const walk = (d, dir) => { // walk from 2 m out toward the prop centre along dir; return the stop distance
    const blocked = decorBlockers(d, COLLIDE, 1), [dx, dz] = dir;
    const p = new PlayerPhysics({x:dx * 2, y:.22 + PC.EYE_OFFSET, z:dz * 2}), yaw = Math.atan2(dx, dz);
    for (let i = 0; i < 240; i++) p.update(1 / 60, {forward:1, strafe:0, yaw, jump:false, sprint:false, tiles, deckY:.22, waterY:0, blocked});
    return Math.hypot(p.x, p.z);
  };
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < .05, `${msg}: ${a.toFixed(3)} vs ${b}`);
  near(walk({type:'crate', x:0, z:0, rot:0}, [1, 0]), .49 + PC.BODY_RADIUS, 'crate x face');
  near(walk({type:'crate', x:0, z:0, rot:0}, [0, 1]), .42 + PC.BODY_RADIUS, 'crate z face');
  near(walk({type:'sail', x:0, z:0, rot:0}, [1, 0]), .8 + PC.BODY_RADIUS, 'sail sheet edge');
  near(walk({type:'lantern', x:0, z:0, rot:0}, [-1, 0]), .59 + PC.BODY_RADIUS, 'lantern feet');
  near(walk({type:'crate', x:0, z:0, rot:Math.PI / 2}, [1, 0]), .42 + PC.BODY_RADIUS, 'turned crate');
  // A player already inside a new prop can still walk out.
  const b = decorBlockers({type:'crate', x:0, z:0, rot:0}, COLLIDE, 1);
  assert.ok(blockerGap(b[0], .1, 0) < 0, 'inside reads negative');
  const p = new PlayerPhysics({x:.1, y:.22 + PC.EYE_OFFSET, z:0});
  for (let i = 0; i < 60; i++) p.update(1 / 60, {forward:1, strafe:0, yaw:-Math.PI / 2, jump:false, sprint:false, tiles, deckY:.22, waterY:0, blocked:b});
  assert.ok(p.x > .9, `walked out to ${p.x.toFixed(2)}`);
});
