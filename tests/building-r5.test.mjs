// Regression tests for the round-5 build fixes (repair vs build, floor-blocked ghosts, decor line of sight,
// piece prompts, chip cost refresh, R rotate hint). Own process: a tiny fake DOM is installed before import.
// Run: node --test tests/building-r5.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(fileURLToPath(new URL(f, base)), 'utf8');

// ---- fake DOM: enough for build-menu.js (innerHTML is a string; querySelector returns one stub per selector)
class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.parent = null; this.id = ''; this.style = {}; this.hidden = false; this.textContent = ''; this.dataset = {};
    this._html = ''; this._q = new Map(); const cl = new Set(); this._cl = cl;
    this.classList = {add: c => cl.add(c), remove: c => cl.delete(c), toggle: (c, on) => ((on ?? !cl.has(c)) ? cl.add(c) : cl.delete(c)), contains: c => cl.has(c)};
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this._q.clear(); }
  get offsetWidth() { return 0; }
  querySelector(sel) { if (!this._q.has(sel)) this._q.set(sel, new El(sel)); return this._q.get(sel); }
  querySelectorAll() { return []; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  setAttribute() {} addEventListener() {} removeEventListener() {}
  getContext() { return CTX2D; } // wood.js paints its texture: every call / property is a no-op
  getBoundingClientRect() { return {left:0, top:0, width:0, height:0}; }
}
const CTX2D = new Proxy(function () {}, {get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : CTX2D), apply: () => CTX2D, set: () => true});
const head = new El('head'), body = new El('body');
globalThis.document = {head, body, createElement: t => new El(t), getElementById: () => null};
globalThis.addEventListener ??= () => {}; globalThis.removeEventListener ??= () => {};

const T = await import(new URL('vendor/three.module.js', base));
const { BuildGrid, LEVEL_H } = await import(new URL('building-pieces.js', base));
const { createBuilding, costText } = await import(new URL('building.js', base));
const { pieceBlock, BLOCK_TEXT } = await import(new URL('build-rules.js', base));
const { statePrompt } = await import(new URL('prompts.js', base));
const { attachSpearRepair } = await import(new URL('spear-repair-hooks.js', base));
const { Bag } = await import(new URL('inventory-state.js', base));

const DECK = .2, EYE = DECK + 1.6;
const bagWith = items => { const b = new Bag(); for (const [k, n] of Object.entries(items)) b.add(k, n); return b; };
// A 2x1 raft; the camera stands on tile (0,0) looking at the shared edge x = 1 (a wall slot), or wherever `to` says.
function rig(sel = 'wall', tiles = [[0, 0], [1, 0]]) {
  const scene = new T.Scene(), b = createBuilding(T, scene), raft = new T.Object3D(), world = {tiles, pieces:[]};
  b.sync(world); b.menu.setSelected(sel);
  const cam = new T.Vector3(0, EYE, 0);
  const look = (to, bag) => { const dir = new T.Vector3().subVectors(to, cam).normalize(); b.update(raft, {dir}, cam, true, bag, -Math.PI / 2, DECK); };
  return {b, world, look, scene};
}

// ------------------------------------------------------------- B1: a green piece ghost builds, it does not repair
test('B1: a green piece ghost marks the click as a build; foundation / red ghosts leave repair alone', () => {
  const {b, look} = rig('wall');
  look(new T.Vector3(1, DECK + 1, 0), bagWith({wood:5}));
  assert.equal(b.aim?.t, 'wall'); assert.ok(b.ready, 'valid, affordable wall slot');
  assert.deepEqual(Object.keys(b.use()).sort(), ['i', 'j', 'kind', 'l', 'r', 't']);
  look(new T.Vector3(1, DECK + 1, 0), bagWith({wood:1}));
  assert.ok(!b.ready, 'red ghost (not enough Plank): repair may take the click');
  b.menu.setSelected('foundation'); look(new T.Vector3(1, DECK + 1, 0), bagWith({wood:5}));
  assert.equal(b.aim, null); assert.ok(!b.ready, 'foundation never claims the click');
});

test('B1: updateAim with buildFirst hides the Repair prompt and useHammer passes the click on', () => {
  const world = {tiles:[[0, 0], [1, 0]], tileHp:{'0,0':40}}, bag = bagWith({wood:3, hammer:1}), acts = [];
  const sr = attachSpearRepair({T, world:() => world, physics:() => ({x:0, z:0}), localBag:() => bag, action:a => acts.push(a), setSwing() {}, notice() {}});
  const aim = {point:{x:.2, y:.22, z:.1}};
  sr.updateAim('hammer', aim);
  assert.ok(sr.aimedRepair(), 'damaged tile aimed'); assert.match(sr.prompt({}).label, /Repair \(1 Plank\)/);
  sr.updateAim('hammer', aim, true);
  assert.equal(sr.aimedRepair(), null); assert.equal(sr.prompt({}), null, 'no Repair prompt while the click builds');
  assert.equal(sr.useHammer(), false); assert.equal(acts.length, 0);
  const g = src('game.js');
  assert.match(g, /spearRep\?\.updateAim\(hook \? null : kind, frameAim, !!building\?\.ready\)/);
});

// ------------------------------------------------------------- B2: stairs over decor / a grill: red ghost, host reason
test('B2: pieceBlock covers decor and grills; the stairs ghost turns red with the host reason', () => {
  const st = {t:'stairs', i:1, j:0, l:0, r:0};
  assert.equal(pieceBlock([], st, (x, z) => x === 1 && z === 0), 'decor', 'grill tile');
  assert.equal(pieceBlock([{x:1, z:0}], st), 'decor');
  assert.equal(pieceBlock([], st, () => false), null);
  assert.equal(pieceBlock([], {...st, t:'wall'}, () => true), null, 'edges do not stand on the floor');
  const {b, look} = rig('stairs'), decor = [{x:1, z:0}];
  b.setBlock(p => { const w = pieceBlock(decor, p); return w ? BLOCK_TEXT[w] : ''; });
  look(new T.Vector3(2, DECK, 0), bagWith({wood:5}));
  assert.equal(b.aim?.t, 'stairs');
  assert.equal(b.aim.ok, false); assert.equal(b.aim.reason, BLOCK_TEXT.decor);
  assert.equal(b.use(), null, 'the click does not send what the host refuses');
  decor.length = 0; look(new T.Vector3(2, DECK, 0), bagWith({wood:5}));
  assert.ok(b.aim.ok, 'cleared floor: green'); assert.equal(b.use().i, 1, 'the same cell (1,0) that was red');
  const g = src('game.js');
  assert.match(g, /building\.setBlock\(p => \{ const w = pieceBlock\(world\.decor, p, grillAt\)/, 'client ghost uses the shared rule');
  assert.match(g, /a\.kind === 'piece' && pieceBlock\(world\.decor, a, grillAt\)/, 'host uses the same rule');
});

// ------------------------------------------------------------- B3: decor line of sight
test('B3: walls and upper floors occlude the deck behind them; doorways and open air do not', () => {
  const g = new BuildGrid(); g.setTiles([[0, 0], [1, 0], [0, 1], [1, 1]]);
  const eye = [0, EYE, 0], far = [2.4, .22, 0];
  assert.equal(g.occludes(...eye, ...far, DECK), '', 'nothing built');
  assert.ok(g.place({t:'wall', i:1, j:0, l:0, r:1}));
  assert.equal(g.occludes(...eye, ...far, DECK), 'wall');
  assert.equal(g.occludes(...eye, .4, .22, .3, DECK), '', 'own side of the wall is fine');
  g.remove({t:'wall', i:1, j:0, l:0, r:1}); assert.ok(g.place({t:'door', i:1, j:0, l:0, r:1}));
  assert.equal(g.occludes(...eye, 2.4, .22, 0, DECK), '', 'through the doorway opening');
  // Standing on an upper floor: the slab under the feet hides the deck below.
  for (const [i, j] of [[0, 0], [1, 0]]) for (const c of [[i, j, 0], [i + 1, j, 0]]) g.place({t:'pillar', i:c[0], j:c[1], l:0, r:0});
  g.place({t:'pillar', i:0, j:1, l:0, r:0}); g.place({t:'pillar', i:1, j:1, l:0, r:0}); g.place({t:'pillar', i:2, j:1, l:0, r:0});
  assert.ok(g.place({t:'floor', i:0, j:0, l:1, r:0}), 'upper floor');
  assert.equal(g.occludes(0, DECK + LEVEL_H + 1.6, 0, .3, .22, .2, DECK), 'floor');
  const gs = src('game.js');
  assert.match(gs, /kind !== 'hammer' && building && camera\) why = building\.occludes\(camera\.position, p, deckY\(\)\)/);
  assert.ok(BLOCK_TEXT.wall && BLOCK_TEXT.floor, 'both refusals have a reason to show');
});

// ------------------------------------------------------------- B4: the side prompt says what the piece click does
test('B4: the crosshair prompt shows Build <piece> and its cost, or the red reason', () => {
  const s = {running:true, heldKind:'hammer', build:{hover:null, piece:{ok:true, reason:'', name:'Wall', cost:'2 Plank'}}};
  assert.deepEqual(statePrompt(s), [{key:'LMB', label:'Build Wall'}, {label:'2 Plank', muted:true}]);
  s.build.piece = {ok:false, reason:'Needs support below', name:'Floor', cost:'2 Plank'};
  assert.deepEqual(statePrompt(s), {label:'Needs support below', muted:true});
  s.build.piece = false;
  assert.doesNotMatch(statePrompt(s).label, /raft edge/);
  s.build.piece = null; assert.equal(statePrompt(s).label, 'Aim at the raft edge', 'foundation keeps its own prompt');
  const {b, look} = rig('wall');
  look(new T.Vector3(1, DECK + 1, 0), bagWith({wood:5}));
  assert.deepEqual({...b.aim}, {ok:true, reason:'', t:'wall', name:'Wall', cost:'2 Plank'});
  look(new T.Vector3(1, DECK + 1, 0), bagWith({wood:1}));
  assert.equal(b.aim.reason, 'Wall needs 2 Plank');
  assert.equal(costText({wood:1, leaf:2}), '1 Plank · 2 Palm Leaf');
  assert.match(src('game.js'), /get piece\(\) \{ return heldKind\(\) === 'hammer' && building && building\.piece !== 'foundation' \? building\.aim \?\? false : null; \}/);
});

// ------------------------------------------------------------- B5 + R hint: the chip follows the bag
test('B5: the chip cost colour refreshes when the bag counts change', () => {
  const {b, look} = rig('wall'), bag = bagWith({wood:1});
  look(new T.Vector3(1, DECK + 1, 0), bag);
  const cost = () => [...body.children].reverse().find(e => e.className === 'bm-chip').querySelector('.bm-cost').innerHTML;
  assert.match(cost(), /bm-short/, '1 Plank: wall cost is short');
  assert.match(cost(), /Plank/); assert.doesNotMatch(cost(), />wood|plank</);
  bag.add('wood', 5); look(new T.Vector3(1, DECK + 1, 0), bag);
  assert.doesNotMatch(cost(), /bm-short/, 'cost turns normal without reselecting');
});

test('chip: the R rotate hint shows only for pieces R turns', () => {
  const {b} = rig('wall');
  const chip = [...body.children].reverse().find(e => e.className === 'bm-chip'), rot = chip.querySelector('.bm-rot');
  assert.match(chip.innerHTML, /<span class="bm-rot">/);
  for (const [id, shown] of [['wall', false], ['window', false], ['door', false], ['pillar', false], ['floor', false], ['foundation', false], ['stairs', true], ['roof', true]]) {
    b.menu.setSelected(id); assert.equal(rot.hidden, !shown, id);
  }
});
