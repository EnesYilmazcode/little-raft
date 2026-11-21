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
  const need = s({heldKind:'hammer', stock:{wood:1}, build:{hover:{x:1, z:0}, affordable:false}})[0];
  assert.equal(need.label, 'Needs 1 wood · 2 plastic'); assert.ok(need.muted);
  assert.equal(s({heldKind:'hammer', build:{hover:null}}), null);
  assert.equal(s({heldKind:'fishingrod'})[0].label, 'Cast line');
  assert.equal(s({heldKind:'fishingrod', hookStage:'fishing', fishWait:3}), null);
  assert.equal(s({heldKind:'lantern', tool:'place', build:{hover:{x:0, z:0}}})[0].label, 'Place lantern');
  assert.ok(s({role:'guest', networkReady:false})[0].muted);
});
