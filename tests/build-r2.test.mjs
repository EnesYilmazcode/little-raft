// Regression tests for the round-2 build fixes (placement, colliders, removal, prompts).
// Run: node --test tests/build-r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { decorBlockers, playerInWay } = await import(new URL('coop-rules.js', base));
const { PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));
const { BLOCK_TEXT, placePrompt } = await import(new URL('build-rules.js', base));
const T = await import(new URL('vendor/three.module.js', base));
const { createFarmView } = await import(new URL('farming-view.js', base));
const { createGhosts, decorCheck, FOOTPRINT, wheelDelta, decorOnRay, floorRemoveBlock, refundOf } = await import(new URL('placement.js', base));
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
  near(walk({type:'lantern', x:0, z:0, rot:0}, [-1, 0]), .38 + PC.BODY_RADIUS, 'lantern feet (raft-master scales the lantern to 0.65)');
  near(walk({type:'crate', x:0, z:0, rot:Math.PI / 2}, [1, 0]), .42 + PC.BODY_RADIUS, 'turned crate');
  // A player already inside a new prop can still walk out.
  const b = decorBlockers({type:'crate', x:0, z:0, rot:0}, COLLIDE, 1);
  assert.ok(blockerGap(b[0], .1, 0) < 0, 'inside reads negative');
  const p = new PlayerPhysics({x:.1, y:.22 + PC.EYE_OFFSET, z:0});
  for (let i = 0; i < 60; i++) p.update(1 / 60, {forward:1, strafe:0, yaw:-Math.PI / 2, jump:false, sprint:false, tiles, deckY:.22, waterY:0, blocked:b});
  assert.ok(p.x > .9, `walked out to ${p.x.toFixed(2)}`);
});

// ------------------------------------------------------------- BUILD-4
test('BUILD-4: Shift+wheel counts the horizontal scroll Chromium turns it into', () => {
  assert.equal(wheelDelta({deltaY:0, deltaX:100, shiftKey:true, deltaMode:0}), 100);
  assert.equal(wheelDelta({deltaY:-3, deltaX:0, shiftKey:false, deltaMode:1}), -99);
  assert.equal(wheelDelta({deltaY:0, deltaX:-2, shiftKey:true, deltaMode:1}), -66);
  assert.equal(wheelDelta({deltaY:0, deltaX:100, shiftKey:false, deltaMode:0}), 0, 'a plain sideways swipe does not change slot');
  assert.equal(wheelDelta({deltaY:50, deltaX:0, ctrlKey:true, deltaMode:0}), 50);
});

// ------------------------------------------------------------- UX-1
test('UX-1: the edge prompt shows what a click builds, its cost, R rotate, and why a red ghost is refused', () => {
  assert.equal(placePrompt({kind:'floor', ok:true, blocked:''}, 'hammer', {cost:'2 wood, 2 plastic'}), '<kbd>Click</kbd>Build floor · 2 wood, 2 plastic');
  assert.equal(placePrompt({kind:'floor', ok:false, blocked:''}, 'hammer', {cost:'2 wood, 2 plastic', missing:'1 more wood'}), 'Floor needs 1 more wood');
  assert.equal(placePrompt({kind:'floor', ok:false, blocked:'cap'}, 'hammer', {}), BLOCK_TEXT.cap);
  assert.equal(placePrompt({kind:'crate', ok:true, blocked:''}, 'crate', {name:'Crate'}), '<kbd>Click</kbd>Place Crate · <kbd>R</kbd>Rotate');
  assert.equal(placePrompt({kind:'crate', ok:false, blocked:'overlap'}, 'crate', {name:'Crate'}), 'Something is in the way · <kbd>R</kbd>Rotate');
  assert.equal(placePrompt({kind:'crate', ok:false, blocked:'edge'}, 'crate', {name:'Crate'}), 'Needs floor underneath · <kbd>R</kbd>Rotate');
  assert.equal(placePrompt({kind:'crate', ok:true, blocked:''}, 'crate', {name:'<b>'}), '<kbd>Click</kbd>Place &lt;b&gt; · <kbd>R</kbd>Rotate', 'names are escaped');
  assert.equal(placePrompt(null, 'crate'), '');
});

// ------------------------------------------------------------- BUILD-5
test('BUILD-5: X picks the decor under the crosshair, nearest first', () => {
  const crate = {type:'crate', x:0, z:-2, rot:0}, bench = {type:'bench', x:0, z:-4, rot:0};
  const eye = {x:0, y:1.8, z:0};
  const toward = (x, y, z) => { const v = {x:x - eye.x, y:y - eye.y, z:z - eye.z}, n = Math.hypot(v.x, v.y, v.z); return {x:v.x / n, y:v.y / n, z:v.z / n}; };
  assert.equal(decorOnRay([bench, crate], eye, toward(0, .6, -2)), crate, 'looking at the crate side');
  assert.equal(decorOnRay([bench, crate], eye, toward(0, .4, -4)), crate, 'the crate in front hides the bench behind it');
  assert.equal(decorOnRay([bench], eye, toward(0, .4, -4)), bench);
  assert.equal(decorOnRay([crate], eye, toward(1.5, .2, -2)), null, 'aiming beside it');
  assert.equal(decorOnRay([crate], eye, toward(.6, .5, -2)), crate, 'grazing the wide side');
  assert.equal(decorOnRay([{type:'crate', x:0, z:-2, rot:Math.PI / 2}], eye, toward(.6, .5, -2)), null, 'turned crate is narrower along x');
});

test('BUILD-5: a floor tile is removable only when bare and the raft stays connected', () => {
  const line = [[0, 0], [1, 0], [2, 0]];
  assert.equal(floorRemoveBlock(line, [], 1, 0), 'split');
  assert.equal(floorRemoveBlock(line, [], 2, 0), null);
  assert.equal(floorRemoveBlock(line, [], 5, 5), 'missing');
  assert.equal(floorRemoveBlock([[0, 0]], [], 0, 0), 'last');
  assert.equal(floorRemoveBlock(line, [{type:'crate', x:4, z:0, rot:0}], 2, 0), 'decor', 'decor centred on it');
  assert.equal(floorRemoveBlock(line, [{type:'bench', x:2.9, z:0, rot:0}], 2, 0), 'decor', 'a bench centred next door overhangs it');
  assert.equal(floorRemoveBlock(line, [{type:'crate', x:2, z:0, rot:0}], 2, 0), null, 'decor on another tile is fine');
  assert.equal(floorRemoveBlock([[0, 0], [1, 0], [0, 1], [1, 1]], [], 0, 0), null, 'a loop survives');
});

test('BUILD-5: removal refunds about half the cost', () => {
  assert.deepEqual(refundOf({wood:2, plastic:2}), {wood:1, plastic:1});
  assert.deepEqual(refundOf({wood:4, scrap:1}), {wood:2, scrap:1});
  assert.deepEqual(refundOf(undefined), {});
});

test('BUILD-5: the hammer prompt offers X Remove', () => {
  assert.equal(placePrompt(null, 'hammer', {remove:'Crate'}), '<kbd>X</kbd>Remove Crate');
  assert.equal(placePrompt({kind:'floor', ok:true, blocked:''}, 'hammer', {cost:'2 wood, 2 plastic', remove:'floor'}), '<kbd>Click</kbd>Build floor · 2 wood, 2 plastic · <kbd>X</kbd>Remove floor');
  assert.equal(placePrompt(null, 'crate', {remove:'Crate'}), '', 'only with the hammer');
});
