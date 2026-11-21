// Round 5 new-player UX: honest build prompts, no ghost on the player, survival guide, loud low vitals, fewer tips.
// Run: node --test tests/r5-newplayer.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(new URL(f, base), 'utf8');
const P = await import(new URL('prompts.js', base));
const B = await import(new URL('building-pieces.js', base));
const { BLOCK_TEXT } = await import(new URL('build-rules.js', base));
const H = await import(new URL('hud.js', base));
const V = await import(new URL('vitals.js', base));
const VU = await import(new URL('vitals-ui.js', base));

const run = {running:true, pointerLocked:true, me:{x:0, z:0, pitch:0}, stock:{wood:9, plastic:9}};
const rows = s => P.normalizePrompt(P.statePrompt(s));

test('hammer on a wall/stairs never says "Aim at the raft edge"', () => {
  const wall = {piece:'wall', name:'Wall', cost:{wood:2}};
  const ready = rows({...run, heldKind:'hammer', tool:'build', build:{hover:null}, pieces:{...wall, ready:true, chip:''}});
  assert.equal(ready[0].key, 'LMB'); assert.equal(ready[0].label, 'Build Wall'); assert.equal(ready[1].label, '2 plank'); // as the build chip names it
  const refused = rows({...run, heldKind:'hammer', tool:'build', build:{hover:null}, pieces:{...wall, ready:false, chip:B.BODY_TEXT}});
  assert.deepEqual(refused.map(r => r.label), [B.BODY_TEXT]); assert.equal(refused[0].key, '');
  const none = rows({...run, heldKind:'hammer', tool:'build', build:{hover:null}, pieces:{piece:'stairs', name:'Stairs', ready:false, chip:''}});
  assert.doesNotMatch(none[0].label, /raft edge/); assert.equal(none[0].key, '');
  // Foundation keeps the floor flow.
  const f = rows({...run, heldKind:'hammer', tool:'build', build:{hover:null}, pieces:{piece:'foundation'}});
  assert.equal(f[0].label, 'Aim at the raft edge');
});

test('a red ghost says why instead of "Place …" / "Build floor"', () => {
  const crate = rows({...run, heldKind:'crate', tool:'place', build:{hover:{x:1, z:0, blocked:'self'}, affordable:true}});
  assert.equal(crate[0].label, BLOCK_TEXT.self); assert.equal(crate[0].key, '');
  const ok = rows({...run, heldKind:'crate', tool:'place', build:{hover:{x:1, z:0, blocked:null}, affordable:true}});
  assert.equal(ok[0].label, 'Place crate');
  const floor = rows({...run, heldKind:'hammer', tool:'build', build:{hover:{x:3, z:0, blocked:'reach'}, affordable:true}, pieces:{piece:'foundation'}});
  assert.equal(floor[0].label, BLOCK_TEXT.reach);
});

test('building pieces refuse slots overlapping the player capsule', () => {
  const tiles = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) tiles.push([i, j]);
  const g = new B.BuildGrid(); g.setTiles(tiles);
  const stairs = {t:'stairs', i:0, j:0, l:0, r:0};
  assert.equal(g.canPlace(stairs), '');
  g.setBody(0.2, 0.1, 0, 1.75);
  assert.equal(g.bodyHit(stairs, 0), true);
  assert.equal(g.bodyHit({t:'stairs', i:1, j:0, l:0, r:0}, 0), false);
  // Aim straight down at your own feet: the cell you stand in is never the green pick.
  const r = g.aim(0.2, 1.6, 0.1, 0, -1, 0.01, 'stairs', 0, 0, 7);
  assert.ok(r); assert.ok(!(r.ok && r.i === 0 && r.j === 0), 'stairs on the player');
  // A wall on the edge you stand on is refused with the reason.
  g.setBody(0, -0.95, 0, 1.75);
  assert.equal(g.bodyHit({t:'wall', i:0, j:0, l:0, r:0}, 0), true);
  // A floor a storey up clears the head.
  assert.equal(g.bodyHit({t:'floor', i:0, j:0, l:1, r:0}, 0), false);
  g.setBody(NaN, 0, 0, 0); assert.equal(g.bodyHit(stairs, 0), false);
  const bj = src('building.js');
  assert.match(bj, /grid\.setBody\(camPos\.x, camPos\.z/);
  assert.match(bj, /camInside\(ghost\.userData\.rec, camPos, deckY\)\) ghost\.visible = false/);
});

test('How to play mentions eating and drinking and no longer promises safety', () => {
  const html = src('index.html'), g = src('game.js');
  for (const t of [html, g]) { assert.doesNotMatch(t, /Nothing can hurt you/); assert.match(t, /Eat and drink/); }
  assert.match(g, /cooked fish or a cup of fresh water and click/);
});

test('eat prompt rounds; build chip and settings agree on Q', () => {
  assert.equal(V.eatLabel('fish'), 'Eat (+13 food, -10 water)');
  assert.doesNotMatch(V.eatLabel('fish'), /\./);
  assert.match(src('build-menu.js'), /<kbd>Q<\/kbd>\/<kbd>Right-click<\/kbd> pieces/);
  assert.match(src('settings.js'), /'Q or Right-click', 'Build wheel'/);
});

test('critical vitals pulse under 25, carry a word tag and post one feed line per dip', () => {
  assert.equal(VU.LOW, 25);
  assert.deepEqual({...VU.TAG}, {hp:'Hurt', food:'Hungry', water:'Thirsty'});
  const armed = {};
  assert.deepEqual(VU.lowAlerts({hp:100, food:30, water:30}, armed), []);
  assert.deepEqual(VU.lowAlerts({hp:100, food:20, water:30}, armed), ['food']);
  assert.deepEqual(VU.lowAlerts({hp:100, food:10, water:30}, armed), [], 'only once');
  assert.deepEqual(VU.lowAlerts({hp:20, food:10, water:5}, armed), ['hp', 'water']);
  VU.lowAlerts({hp:100, food:50, water:5}, armed); // food climbs back over REARM
  assert.deepEqual(VU.lowAlerts({hp:100, food:20, water:5}, armed), ['food']);
  assert.match(VU.ADVICE.food, /cooked fish.*click/); assert.match(VU.ADVICE.water, /fresh water.*click/);
  const ui = src('vitals-ui.js');
  assert.match(ui, /raftFeed/); assert.match(ui, /lv-tag/);
});

test('tips: no duplicate of the checklist or crosshair, hotbar tip needs 2+ items, learned tips survive New game', () => {
  const throwHint = H.HINTS.find(h => h.id === 'throw');
  assert.equal(H.hintCovered(throwHint, {steps:['look', 'throw'], prompts:[]}), true);
  assert.equal(H.hintCovered(throwHint, {steps:[], prompts:['Throw']}), true);
  assert.equal(H.hintCovered(throwHint, {steps:['walk'], prompts:['Pick up plank']}), false);
  const done = new Set(['throw', 'loot', 'bag']);
  assert.equal(H.nextHint(done, {items:1}), null);
  assert.equal(H.nextHint(done, {items:2})?.id, 'slots');
  assert.equal(H.nextHint(done, {items:1, hasLeaf:true})?.id, 'rope', 'one item: the hotbar tip steps aside');
  const mem = {}, storage = {getItem:k => mem[k] ?? null, setItem:(k, v) => { mem[k] = v; }};
  const all = new Set(['throw', 'loot', 'bag', 'slots', 'rope', 'hammer', 'build']);
  H.resetHints(storage, all);
  assert.deepEqual([...H.loadHints(storage)].sort(), ['bag', 'slots', 'throw']);
  assert.match(src('game.js'), /hintCovered\(hint, hintCover\(\)\)/);
});
