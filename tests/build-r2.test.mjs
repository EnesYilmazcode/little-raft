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

// ============================================================= round 3: one removal targeter
const { nearestTarget, tileOccupied, targetName, removeWhy, removeAction, removePrompt } = await import(new URL('remove-target.js', base));
const { decorHit, pickBox, PICK_DEFAULT } = await import(new URL('placement.js', base));
const { BuildGrid } = await import(new URL('building-pieces.js', base));
const { PLACEABLE_IDS } = await import(new URL('items.js', base));
const { CONTENT_DECOR } = await import(new URL('content-items.js', base));
const START = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const metres = decor => decor.map(d => ({type:d.type, x:d.x * 2, z:d.z * 2, rot:d.rot || 0, src:d}));
const ctxOf = (o = {}) => {
  const decor = o.decor ?? [], grid = o.grid ?? null;
  if (grid && !o.keepTiles) grid.setTiles(o.tiles ?? START);
  return {tiles:o.tiles ?? START, decor, decorM:metres(decor), grid, players:o.players ?? [{x:-2, z:-2}, null], bodyRadius:PC.BODY_RADIUS, slack:0, ...o.extra};
};

test('BUILD-1 r3: X on the tile a player stands on is refused (self / brother), the prompt says so', () => {
  const me = {x:0, z:2}, far = {x:-2, z:-2}; // spawn: standing on tile (0,1)
  assert.equal(removeWhy({what:'floor', x:1, z:1}, ctxOf({players:[{x:2, z:2}, null]})), BLOCK_TEXT.self);
  assert.equal(removeWhy({what:'floor', x:0, z:1}, ctxOf({players:[me, null]})), BLOCK_TEXT.self);
  assert.equal(removeWhy({what:'floor', x:0, z:1}, ctxOf({players:[far, me]})), BLOCK_TEXT.brother, 'the other player too');
  assert.equal(removeWhy({what:'floor', x:1, z:1}, ctxOf({players:[{x:2, z:1.1}, null]})), BLOCK_TEXT.self, 'on the seam: refused for both tiles');
  assert.equal(removeWhy({what:'floor', x:1, z:0}, ctxOf({players:[{x:2, z:1.1}, null]})), BLOCK_TEXT.self, 'on the seam: refused for both tiles');
  assert.equal(removeWhy({what:'floor', x:1, z:1}, ctxOf({players:[far, null]})), null, 'nobody on it: ok');
  assert.equal(removePrompt('floor', BLOCK_TEXT.self, true), BLOCK_TEXT.self);
});

test('BUILD-2 / CRAFT-4 r3: every placeable decor has a pick box and can be aimed at', () => {
  const types = [...new Set(['sail', 'palm', 'lantern', 'net', 'bench', 'crate', 'receiver', 'antenna', 'purifier', 'rainbarrel', 'sprinkler', ...CONTENT_DECOR, ...PLACEABLE_IDS])];
  for (const type of types) {
    const b = pickBox(type);
    assert.ok(b[0] > 0 && b[1] > 0 && b[2] > 0, type);
    const d = {x:2, y:.22 + Math.min(b[2], .4) / 2 - 1.7, z:0}, n = Math.hypot(d.x, d.y, d.z);
    const hit = decorHit([{type, x:2, z:0, rot:0}], {x:0, y:1.7, z:0}, {x:d.x / n, y:d.y / n, z:d.z / n});
    assert.ok(hit && hit.t > 0, 'aimable: ' + type);
  }
  for (const s of ['smelter', 'grill', 'researchtable', 'research', 'candle', 'beehive']) assert.notEqual(pickBox(s), PICK_DEFAULT, s + ' sized from its model');
});

test('CRAFT-4 r3: a station is removable when empty and refused while it holds items; chests too', () => {
  const smelter = {type:'smelter', x:1, z:0}, crate = {type:'crate', x:-1, z:0};
  let contents = null, chest = false;
  const extra = {stationAt:(x, z) => x === 1 && z === 0 ? contents : null, chestFull:() => chest, nameOf:k => ({smelter:'Smelter'}[k] ?? k)};
  const ctx = () => ctxOf({decor:[smelter, crate], extra});
  const t = {what:'decor', x:1, z:0, type:'smelter'};
  assert.equal(removeWhy(t, ctx()), null, 'no station state: removable');
  contents = {input:null, output:null, fuel:3}; assert.equal(removeWhy(t, ctx()), null, 'fuel cannot be taken out, so it does not block');
  contents = {input:{kind:'sand', count:2}, output:null}; assert.equal(removeWhy(t, ctx()), 'Empty the Smelter first');
  contents = {input:null, output:{kind:'glass', count:1}}; assert.equal(removeWhy(t, ctx()), 'Empty the Smelter first');
  chest = true; assert.equal(removeWhy({what:'decor', x:-1, z:0, type:'crate'}, ctx()), 'Empty the chest first');
  assert.equal(removeWhy({what:'decor', x:0, z:1, type:'crate'}, ctx()), 'Nothing to remove', 'stale target');
  assert.equal(removeWhy({what:'decor', x:1, z:0, type:'smelter'}, ctxOf({decor:[smelter], players:[{x:20, z:0}, null], extra:{...extra, stationAt:() => null}})), BLOCK_TEXT.reach);
  assert.equal(removeWhy({what:'floor', x:1, z:0}, ctx()), BLOCK_TEXT.decor, 'its floor still needs clearing first');
  assert.equal(removeWhy({what:'floor', x:0, z:-1}, ctxOf({extra:{hasGrill:(x, z) => x === 0 && z === -1}})), BLOCK_TEXT.decor, 'a grill tile too');
});

test('BUILD-3 r3: a floor tile holding up an edge wall or corner pillar is refused; a shared edge is not', () => {
  const g = new BuildGrid(); g.setTiles(START);
  assert.ok(g.place({t:'wall', i:1, j:2, l:0, r:0}), 'outer +z edge of corner tile (1,1)');
  assert.equal(g.canRemoveTile(1, 1), 'Something rests on this');
  assert.equal(removeWhy({what:'floor', x:1, z:1}, ctxOf({grid:g, keepTiles:true})), 'Something rests on this');
  const h = new BuildGrid(); h.setTiles(START); h.place({t:'pillar', i:2, j:2, l:0, r:0});
  assert.equal(h.canRemoveTile(1, 1), 'Something rests on this', 'outer corner pillar');
  const k = new BuildGrid(); k.setTiles(START); k.place({t:'wall', i:1, j:1, l:0, r:0}); // edge between (1,1) and (1,0)
  assert.equal(k.canRemoveTile(1, 1), '', 'the neighbour tile still holds it');
  assert.equal(g.canRemoveTile(1, 1), 'Something rests on this', 'the check restores the tile');
  assert.equal(g.canRemoveTile(9, 9), '');
});

test('BUILD-4 / BUILD-6 r3: the nearest of piece, decor and floor is the one target, and X sends only its action', () => {
  const wall = {t:'wall', i:2, j:0, l:0, r:1};
  assert.equal(nearestTarget({what:'piece', rec:wall, t:3}, {what:'decor', x:1, z:0, type:'bench', t:1.6}, {what:'floor', x:1, z:0, t:2.4}).what, 'decor', 'bench in front of the wall (BUILD-6)');
  assert.equal(nearestTarget(null, {what:'decor', t:Infinity}, {what:'floor', x:0, z:0, t:2}).what, 'floor');
  assert.equal(nearestTarget(null, undefined), null);
  // grid.pick reports its distance so it can be compared
  const g = new BuildGrid(); g.setTiles(START); g.place(wall); const out = {};
  assert.equal(g.pick(0, 1.2, 0, 1, 0, 0, .2, 7, out), g.find(wall)); assert.ok(Math.abs(out.t - (3 - .07)) < 1e-6, String(out.t));
  g.pick(0, 1.2, 0, -1, 0, 0, .2, 7, out); assert.equal(out.t, Infinity);
  assert.deepEqual(removeAction({what:'piece', rec:wall}), {kind:'unpiece', t:'wall', i:2, j:0, l:0, r:1});
  assert.deepEqual(removeAction({what:'floor', x:1, z:0, t:2}), {kind:'remove', what:'floor', x:1, z:0});
  assert.deepEqual(removeAction({what:'decor', x:1, z:0, type:'bench'}), {kind:'remove', what:'decor', x:1, z:0});
  assert.equal(removeAction(null), null);
  assert.equal(targetName({what:'piece', rec:wall}, k => k.toUpperCase()), 'WALL');
  assert.equal(removePrompt('Smelter', '', true), 'Release X to remove Smelter');
  assert.equal(removePrompt('Smelter', 'Empty the Smelter first', true), 'Empty the Smelter first');
  assert.equal(removePrompt('', '', true), 'Point at something to remove');
  assert.equal(removePrompt('floor', '', false), '<kbd>X</kbd>Remove floor');
  assert.equal(placePrompt(null, 'hammer', {remove:'floor', removeWhy:BLOCK_TEXT.self}), '<kbd>X</kbd>' + BLOCK_TEXT.self, 'a refused target shows why, not Remove');
  // the piece rule is grid.canRemove, cached per target and world version
  const memo = {}; let calls = 0; const spy = {version:1, canRemove:() => { calls++; return 'Something rests on this'; }, canRemoveTile:() => ''};
  const t = {what:'piece', rec:wall}, none = [];
  for (let n = 0; n < 3; n++) assert.equal(removeWhy(t, {grid:spy, memo, tiles:START, decor:none}), 'Something rests on this');
  assert.equal(calls, 1); spy.version++; removeWhy(t, {grid:spy, memo, tiles:START, decor:none}); assert.equal(calls, 2);
});

test('BUILD-5 r3: one tile-occupied rule keeps stairs and decor off each other', () => {
  const decor = [{type:'crate', x:1, z:0}], pieces = [{t:'stairs', i:-1, j:0, l:0, r:0}, {t:'stairs', i:0, j:1, l:1, r:0}, {t:'wall', i:0, j:0, l:0, r:0}];
  assert.ok(tileOccupied(1, 0, {decor, pieces}), 'crate');
  assert.ok(tileOccupied(-1, 0, {decor, pieces}), 'stairs on the deck');
  assert.ok(!tileOccupied(0, 1, {decor, pieces}), 'upper-floor stairs do not stand on the deck');
  assert.ok(!tileOccupied(0, 0, {decor, pieces}), 'walls sit on edges');
  assert.ok(tileOccupied(0, 0, {hasGrill:(x, z) => x === 0 && z === 0}), 'grill');
  const g = new BuildGrid(); g.setTiles(START); g.blocker = (i, j) => tileOccupied(i, j, {decor});
  assert.equal(g.canPlace({t:'stairs', i:1, j:0, l:0, r:0}), 'Something is in the way', 'stairs over the crate');
  assert.equal(g.canPlace({t:'stairs', i:0, j:0, l:0, r:0}), '');
  assert.equal(g.canPlace({t:'wall', i:1, j:0, l:0, r:0}), '', 'edges are not blocked');
  assert.equal(g.load([{t:'stairs', i:1, j:0, l:0, r:0}]).length, 1, 'an old save keeps what it has');
});

test('BUILD-4 r3: holding X hides the "Aim at the raft edge" hint so only the removal prompt speaks', async () => {
  const P = await import(new URL('prompts.js', base));
  const s = {running:true, heldKind:'hammer', build:{hover:null}, tileList:[[0, 0]], me:{x:0, z:0, pitch:0}};
  assert.equal(P.statePrompt(s).label, 'Aim at the raft edge');
  assert.equal(P.statePrompt({...s, pieces:{removing:true}}), null);
});
