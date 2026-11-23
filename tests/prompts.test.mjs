// Unit tests for the pure parts of dist/prompts.js. Run: node --test tests/prompts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const P = await import(new URL('prompts.js', base));

test('imports without window/document and does not auto-start', () => {
  assert.equal(P.raftPrompts, null);
  assert.equal(typeof globalThis.window, 'undefined');
});

test('normalizePrompt: shapes, cap of 2, hold prefix', () => {
  assert.equal(P.normalizePrompt(null), null);
  assert.equal(P.normalizePrompt({key:'E'}), null);
  assert.deepEqual(P.normalizePrompt({key:'E', label:'Pick up'}), [{key:'E', label:'Pick up', hold:false, muted:false}]);
  assert.equal(P.normalizePrompt([{label:'a'}, {label:'b'}, {label:'c'}]).length, 2);
  assert.deepEqual(P.normalizePrompt({key:'Hold LMB', label:'Throw'})[0], {key:'LMB', label:'Throw', hold:true, muted:false});
});

test('pickPrompt: priority, ray beats provider, nearest wins, first wins ties', () => {
  const c = (label, o) => ({prompts:{key:'E', label}, ...o});
  assert.equal(P.pickPrompt([]), null);
  assert.equal(P.pickPrompt([c('x', {prompts:null})]), null);
  assert.equal(P.pickPrompt([c('low', {priority:0, ray:true, distance:1}), c('high', {priority:2})])[0].label, 'high');
  assert.equal(P.pickPrompt([c('prov', {priority:1}), c('ray', {priority:1, ray:true, distance:2})])[0].label, 'ray');
  assert.equal(P.pickPrompt([c('far', {ray:true, distance:2.5}), c('near', {ray:true, distance:1})])[0].label, 'near');
  assert.equal(P.pickPrompt([c('first', {}), c('second', {})])[0].label, 'first');
  assert.equal(P.pickPrompt([c('null', {priority:5, prompts:null}), c('ok', {})])[0].label, 'ok');
});

test('signature changes only with content', () => {
  const a = P.normalizePrompt({key:'E', label:'Pick up plank'}), b = P.normalizePrompt({key:'E', label:'Pick up plank'});
  assert.equal(P.signature(a), P.signature(b));
  assert.notEqual(P.signature(a), P.signature(P.normalizePrompt({key:'E', label:'Pick up scrap'})));
  assert.equal(P.signature(null), '');
});

test('feed helpers: formatting, notice detection, dedupe', () => {
  assert.equal(P.formatFeed('  + 2 plank\n ·  1 leaf '), '+ 2 plank · 1 leaf');
  assert.equal(P.formatFeed('x'.repeat(200)).length, 90);
  assert.equal(P.formatFeed(undefined), '');
  assert.ok(P.isNotice('Crafted Rope', false));
  assert.ok(!P.isNotice('Pick up plank', true));
  assert.ok(!P.isNotice('', false));
  assert.ok(!P.isNotice('Hold click to reel it in', false));
  assert.ok(!P.isNotice('Floor needs 1 wood', false)); // hover prompt, not a notice
  assert.ok(!P.isNotice('Purifying… 0:53 (fuel 1:58)', false)); // ticking hover status, not a notice per second
  assert.ok(!P.shouldPost({text:'a', at:1000}, 'a', 1500));
  assert.ok(P.shouldPost({text:'a', at:1000}, 'a', 1700));
  assert.ok(P.shouldPost({text:'a', at:1000}, 'b', 1100));
  assert.ok(P.shouldPost(null, 'a', 0));
});

test('statePrompt: built-in providers', () => {
  const base = {running:true, role:'host', networkReady:true, hookStage:'idle', me:{pitch:-0.2}, stock:{}, build:{}};
  const s = o => P.normalizePrompt(P.statePrompt({...base, ...o}));
  assert.equal(P.statePrompt({...base, running:false}), null);
  assert.equal(s({pickup:{id:1, type:'leaf'}})[0].label, 'Pick up leaves');
  assert.deepEqual(s({heldKind:'hook'})[0], {key:'LMB', label:'Throw', hold:true, muted:false});
  assert.equal(s({heldKind:'hook', me:{pitch:-0.9}}), null);
  assert.equal(s({heldKind:'hook', hookStage:'floating'})[0].label, 'Reel in');
  assert.equal(s({heldKind:'hammer', build:{hover:{x:1, z:0}, affordable:true}})[0].label, 'Build floor');
  assert.deepEqual(s({heldKind:'hammer', build:{hover:{x:1, z:0}, affordable:true}})[1], {key:'', label:'2 wood · 2 plastic', hold:false, muted:true});
  const need = s({heldKind:'hammer', stock:{wood:1}, build:{hover:{x:1, z:0}, affordable:false}});
  assert.equal(need[0].label, 'Needs 2 wood · 2 plastic'); assert.ok(need[0].muted && need[1].muted);
  assert.equal(need[1].label, 'Missing 1 wood · 2 plastic');
  assert.equal(s({heldKind:'hammer', stock:{}, build:{hover:{x:1, z:0}, affordable:false}}).length, 1); // missing == cost: no duplicate line
  assert.equal(s({heldKind:'hammer', stock:{wood:5, plastic:5}, build:{hover:{x:1, z:0}, affordable:false}}).length, 1); // nothing computably missing
  assert.deepEqual(s({heldKind:'hammer', build:{hover:null}}), [{key:'', label:'Aim at the raft edge', hold:false, muted:true}]);
  assert.equal(s({heldKind:'fishingrod'})[0].label, 'Cast line');
  assert.deepEqual(s({heldKind:'fishingrod', hookStage:'fishing', fishWait:3})[0], {key:'', label:'Waiting for a bite…', hold:false, muted:true});
  assert.deepEqual(s({heldKind:'lantern', tool:'place', build:{hover:{x:0, z:0}}}), [{key:'LMB', label:'', hold:false, muted:false}, {key:'R', label:P.ROTATE_GLYPH, hold:false, muted:false}]); // free placement: icons only
  assert.equal(s({heldKind:'lantern', tool:'place', build:{hover:null}}), null);
  assert.ok(s({role:'guest', networkReady:false})[0].muted);
});

test('statePrompt: Throw tip retires after THROW_TEACH throws; reel always shows', () => {
  const base = {running:true, role:'host', networkReady:true, hookStage:'idle', me:{pitch:-0.2}, heldKind:'hook', build:{}};
  assert.equal(P.statePrompt(base, {throws:P.THROW_TEACH - 1}).label, 'Throw');
  assert.equal(P.statePrompt(base, {throws:P.THROW_TEACH}), null);
  assert.equal(P.statePrompt({...base, hookStage:'reeling'}, {throws:99}).label, 'Reel in');
  assert.equal(P.statePrompt({...base, pickup:{type:'wood'}}, {throws:99}).label, 'Pick up plank');
  assert.ok(P.isThrow('idle', 'flying')); assert.ok(!P.isThrow('flying', 'flying')); assert.ok(!P.isThrow('idle', 'fishing'));
});

test('raftDistance + swimming prompts', () => {
  const tiles = [[0, 0], [1, 0]];
  assert.equal(P.raftDistance(0.5, 0.5, tiles), 0);
  assert.ok(Math.abs(P.raftDistance(4, 0, tiles) - 1) < 1e-9); // tile [1,0] spans x 1..3
  assert.ok(Math.abs(P.raftDistance(0, -2, tiles) - 1) < 1e-9);
  assert.equal(P.raftDistance(0, 0, []), Infinity);
  assert.equal(P.raftDistance(NaN, 0, tiles), Infinity);
  const sw = (x, o = {}) => P.normalizePrompt(P.statePrompt({running:true, role:'host', networkReady:true, hookStage:'idle', swimming:true, tileList:tiles, me:{x, z:0, pitch:0}, build:{}, ...o}));
  assert.deepEqual(sw(3.8)[0], {key:'Space', label:'Climb aboard', hold:true, muted:false});
  assert.deepEqual(sw(8)[0], {key:'', label:'Swim to the raft edge', hold:false, muted:true});
  assert.equal(sw(3.8, {physics:{climbing:true}}), null);
  assert.equal(sw(3.8, {pickup:{type:'scrap'}})[0].label, 'Pick up scrap');
});

test('costText / missingText', () => {
  assert.equal(P.costText({wood:2, plastic:2}), '2 wood · 2 plastic');
  assert.equal(P.missingText({wood:2, plastic:0}, {wood:2, plastic:2}), '2 plastic');
  assert.equal(P.missingText({wood:'x'}, {wood:2}), '2 wood');
  assert.equal(P.missingText({wood:3, plastic:3}, {wood:2, plastic:2}), '');
});

test('promptFromHtml: game.js / content-module prompt strings become prompt rows', () => {
  assert.deepEqual(P.promptFromHtml('<kbd>E</kbd>Collect honeycomb (2)'), {key:'E', label:'Collect honeycomb (2)'});
  assert.deepEqual(P.promptFromHtml('<kbd>E</kbd> Take grilled cod &amp; chips'), {key:'E', label:'Take grilled cod & chips'});
  assert.deepEqual(P.promptFromHtml('<kbd>Click</kbd>Water the planter'), {key:'LMB', label:'Water the planter'});
  assert.deepEqual(P.promptFromHtml('Rain barrel: 4/4 cups · hold a cup'), {label:'Rain barrel: 4/4 cups · hold a cup', muted:true});
  assert.deepEqual(P.promptFromHtml('Bees are busy… 40%'), {label:'Bees are busy… 40%', muted:true});
  assert.equal(P.promptFromHtml(''), null);
  assert.equal(P.promptFromHtml(null), null);
  assert.equal(P.promptFromHtml('<kbd>E</kbd>'), null);
  assert.deepEqual(P.normalizePrompt(P.promptFromHtml('<kbd>E</kbd>Fill cup (4/4)')), [{key:'E', label:'Fill cup (4/4)', hold:false, muted:false}]);
});

test('statePrompt: place mode shows icons (mouse, R rotate), no words, and stacks the aim prompt under them', () => {
  const base = {running:true, role:'host', networkReady:true, hookStage:'idle', me:{pitch:-0.2}, stock:{}, tool:'place'};
  const s = o => P.normalizePrompt(P.statePrompt({...base, ...o}));
  // Holding a crate near a placed crate: storage's proximity "E Open crate" must not hide the placement hint.
  const aimOff = s({heldKind:'crate', build:{hover:null}, aimPrompt:'<kbd>E</kbd>Open crate'});
  assert.deepEqual(aimOff, [{key:'E', label:'Open crate', hold:false, muted:false}]);
  const onFloor = s({heldKind:'bench', build:{hover:{x:1, z:0}}, aimPrompt:'<kbd>E</kbd>Open crate'});
  assert.equal(onFloor[0].label, ''); assert.equal(onFloor[0].key, 'LMB'); assert.equal(onFloor[1].label, 'Open crate');
  assert.equal(s({heldKind:'crate', build:{hover:null}}), null);
  // A red ghost: no click glyph, only the muted rotate icon; the ghost tint says why.
  assert.deepEqual(s({heldKind:'rainbarrel', build:{hover:{x:0, z:0, blocked:'overlap'}}}), [{key:'R', label:P.ROTATE_GLYPH, hold:false, muted:true}]);
  // The placement row wins over a priority-0 provider only because game.js mutes game-aim in place mode;
  // pickPrompt still lets a higher-priority provider through.
  const won = P.pickPrompt([{prompts:P.statePrompt({...base, heldKind:'crate', build:{hover:{x:0, z:0}}, aimPrompt:'<kbd>E</kbd>Open crate'}), priority:0}]);
  assert.equal(won[0].key, 'LMB');
});
