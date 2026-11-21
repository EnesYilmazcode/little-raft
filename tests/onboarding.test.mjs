// Pure-logic tests for dist/onboarding.js (no DOM). Run: node --test tests/onboarding.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const O = await import(new URL('onboarding.js', base));

const steps = () => O.STEPS.map(s => ({...s}));
const fresh = (over = {}) => ({running:true, role:'solo', tiles:4, fish:0, collected:0, decor:[], stock:{hook:1}, ownedTools:['hook'],
  hookStage:'idle', inventoryOpen:false, hookHealth:100, pickup:null, hookCaughtItems:[], me:{x:0, y:1.8, z:0, yaw:0, pitch:0}, ...over});

test('fresh state shows the first three steps', () => {
  const P = O.createProgress();
  let r = O.evaluate(steps(), P, fresh(), {silent:true});
  assert.deepEqual(r.silentDone, []);
  r = O.evaluate(steps(), P, fresh());
  assert.deepEqual(r.visible, ['look', 'walk', 'throw']);
  assert.equal(r.chapter, 'ch1');
});

test('meeting conditions completes steps and advances', () => {
  const S = steps(), P = O.createProgress();
  O.evaluate(S, P, fresh(), {silent:true});
  O.evaluate(S, P, fresh());
  let r = O.evaluate(S, P, fresh({hookStage:'flying'}));
  assert.deepEqual(r.newly, ['throw']);
  assert.deepEqual(r.visible, ['look', 'walk', 'reel']);
  r = O.evaluate(S, P, fresh({me:{x:0, z:0, yaw:.8}}));
  assert.deepEqual(r.counts.look, [46, 80, '°']); // progress shows while you sweep
  r = O.evaluate(S, P, fresh({me:{x:0, z:0, yaw:1.5}}));
  assert.ok(P.done.look);
  r = O.evaluate(S, P, fresh({me:{x:2, z:0, yaw:1.5}}));
  assert.deepEqual(r.counts.walk, [2, 4, ' m']);
  r = O.evaluate(S, P, fresh({me:{x:0, z:0, yaw:1.5}})); // walked path, not distance from the start
  assert.deepEqual(r.newly, ['walk']);
  r = O.evaluate(S, P, fresh({collected:1, stock:{wood:2}}));
  assert.deepEqual(r.newly, ['reel']);
  assert.deepEqual(r.visible, ['wood', 'leaves', 'bag']);
  assert.deepEqual(r.counts.wood, [2, 6]); // wood already held counts
  r = O.evaluate(S, P, fresh({collected:2, stock:{wood:4}}));
  assert.deepEqual(r.counts.wood, [4, 6]);
  r = O.evaluate(S, P, fresh({collected:2, stock:{wood:1}})); // spending never lowers the count
  assert.deepEqual(r.counts.wood, [4, 6]);
  r = O.evaluate(S, P, fresh({collected:3, stock:{wood:5}}));
  assert.ok(P.done.wood && r.newly.includes('wood')); // 4 gained after the step showed
});

test('returning player with a hammer silently skips the hammer chain', () => {
  const P = O.createProgress();
  const r = O.evaluate(steps(), P, fresh({collected:40, tiles:4, stock:{hammer:1, wood:2}, ownedTools:['hook', 'hammer']}), {silent:true});
  for (const id of ['look', 'walk', 'throw', 'reel', 'wood', 'leaves', 'bag', 'rope', 'hammer']) assert.ok(P.done[id], id);
  assert.deepEqual(r.newly, []);
  assert.deepEqual(r.visible, ['plastic', 'floor']);
  const P2 = O.createProgress();
  O.evaluate(steps(), P2, fresh({collected:90, tiles:14, fish:3, ownedTools:['hook', 'hammer', 'fishingrod']}), {silent:true});
  assert.ok(P2.done.floor && P2.done.grow3 && P2.done.rod && P2.done.fish3 && !P2.done.home);
});

test('register() inserts after a given id and rejects duplicates', () => {
  const S = steps(), C = O.CHAPTERS.map(c => ({...c}));
  O.insertSteps(S, C, {chapter:'ch2', after:'plant', steps:[{id:'water', title:'Water the palm', hint:'', done:() => false}]});
  const i = S.findIndex(s => s.id === 'plant');
  assert.equal(S[i + 1].id, 'water'); assert.equal(S[i + 1].chapter, 'ch2');
  assert.throws(() => O.insertSteps(S, C, {chapter:'ch2', steps:[{id:'water', title:'again'}]}));
  O.insertSteps(S, C, {chapter:'ch9', title:'Extra', steps:[{id:'x9', title:'X'}]});
  assert.equal(S.at(-1).id, 'x9'); assert.ok(C.some(c => c.id === 'ch9'));
  const P = O.createProgress(S.filter(s => s.chapter !== 'ch9').map(s => s.id));
  assert.equal(O.evaluate(S, P, fresh()).chapter, 'ch9'); // registering re-opens a finished game
});

test('bad or partial state objects never throw', () => {
  const S = steps(), P = O.createProgress();
  for (const bad of [null, undefined, 7, 'x', [], {}, {stock:null, me:null, decor:'no', ownedTools:{}}, {me:{yaw:NaN}, collected:'5'}, {hookCaughtItems:[null], decor:[null]}]) {
    assert.doesNotThrow(() => O.evaluate(S, P, bad, {silent:true}));
    assert.doesNotThrow(() => O.evaluate(S, P, bad));
  }
  const thrower = [{chapter:'c', id:'t', title:'T', done:() => { throw new Error('x'); }, start:() => { throw new Error('y'); }, count:() => { throw 1; }}];
  assert.doesNotThrow(() => O.evaluate(thrower, O.createProgress(), fresh()));
  assert.equal(O.saveSummary('{bad'), '');
  assert.equal(O.saveSummary(JSON.stringify({tiles:[[0, 0]], fish:3})), '1 tile · 3 fish');
});

test('a world reset (New Game) clears progress', () => {
  const S = steps(), P = O.createProgress();
  O.evaluate(S, P, fresh({collected:30, tiles:12}), {silent:true});
  assert.ok(P.done.look);
  const r = O.evaluate(S, P, fresh());
  assert.ok(r.reset); assert.deepEqual(r.visible, ['look', 'walk', 'throw']);
});

test('repair appears only after heavy wear and never blocks', () => {
  const S = steps(), done = S.filter(s => s.chapter === 'ch1').map(s => s.id), P = O.createProgress(done);
  assert.ok(!O.evaluate(S, P, fresh({hookHealth:80})).visible.includes('repair'));
  const P2 = O.createProgress([...done, 'grow3', 'grab', 'barrel']);
  assert.ok(O.evaluate(S, P2, fresh({hookHealth:40})).visible.includes('repair'));
  const P3 = O.createProgress(S.filter(s => s.chapter === 'ch2' && !s.optional).map(s => s.id).concat(done));
  assert.equal(O.evaluate(S, P3, fresh()).chapter, 'ch3');
});

test('hint glyphs become keycaps', () => {
  const h = O.hintHTML('Hold [LMB] then [Tab] <b>');
  assert.match(h, /ob-mouse/); assert.match(h, /<kbd class="ob-key">Tab<\/kbd>/); assert.match(h, /&#60;b&#62;/);
});

test('joining or leaving a host world re-baselines instead of reading the jump as progress', () => {
  const S = steps(), done = ['look', 'walk', 'throw', 'reel', 'wood', 'leaves', 'bag', 'rope', 'hammer', 'plastic'], P = O.createProgress(done);
  O.evaluate(S, P, fresh({collected:20, stock:{hook:1, hammer:1}, ownedTools:['hook', 'hammer']}));
  const host = {role:'guest', networkReady:true, collected:300, tiles:30, fish:9, decor:[{type:'palm', x:0, z:0}], stock:{hook:1, wood:20, hammer:1}, ownedTools:['hook', 'hammer']};
  let r = O.evaluate(S, P, fresh(host));
  assert.deepEqual(r.newly, []); assert.ok(!P.done.floor);
  const P2 = O.createProgress(O.STEPS.filter(s => s.chapter !== 'ch3').map(s => s.id).concat('rodwood', 'rope8', 'rod'));
  O.evaluate(S, P2, fresh({tiles:10}));
  r = O.evaluate(S, P2, fresh({...host, fish:9}));
  r = O.evaluate(S, P2, fresh({...host, fish:12})); // host's catches are not ours
  assert.ok(!P2.done.fish1 && !P2.done.home);
  r = O.evaluate(S, P2, fresh({...host, fish:12, stock:{...host.stock, fish:1}}));
  assert.deepEqual(r.newly, ['fish1']);
  r = O.evaluate(S, P2, fresh({collected:5, tiles:10, fish:0})); // back on our own raft: no reset, no completions
  assert.ok(!r.reset && P2.done.fish1); assert.deepEqual(r.newly, []);
});

test('a hammer made before the gather counters caught up still finishes chapter one', () => {
  const S = steps(), P = O.createProgress(['look', 'walk', 'throw', 'reel', 'bag']);
  O.evaluate(S, P, fresh({collected:3, stock:{hook:1, leaf:2}}));
  for (let i = 0; i < 4; i++) O.evaluate(S, P, fresh({collected:9, stock:{hook:1, hammer:1}, ownedTools:['hook', 'hammer']}));
  for (const id of ['wood', 'leaves', 'rope', 'hammer']) assert.ok(P.done[id], id);
});

test('barrel and hand-grab need the real thing', () => {
  const S = steps(), P = O.createProgress(O.STEPS.filter(s => s.chapter === 'ch1').map(s => s.id).concat('grow3'));
  O.evaluate(S, P, fresh({collected:5, hookStage:'reeling'}));
  let r = O.evaluate(S, P, fresh({collected:11, stock:{hook:1, wood:4, leaf:2, scrap:1, plastic:1}})); // a mixed hook bundle
  assert.ok(!P.done.barrel && !P.done.grab);
  O.evaluate(S, P, fresh({collected:11, pickup:{id:3, token:'t', type:'barrel'}, stock:{hook:1, wood:4, leaf:2, scrap:1, plastic:1}}));
  r = O.evaluate(S, P, fresh({collected:12, stock:{hook:1, wood:7, leaf:4, scrap:2, plastic:2}}));
  assert.ok(P.done.barrel && P.done.grab, JSON.stringify(r));
});

test('gather steps count what you already hold', () => {
  const S = steps(), P = O.createProgress(['look', 'walk', 'throw', 'reel', 'wood', 'leaves', 'bag', 'rope', 'hammer']);
  const r = O.evaluate(S, P, fresh({collected:9, stock:{hook:1, hammer:1, plastic:5}, ownedTools:['hook', 'hammer']}));
  assert.ok(P.done.plastic && r.newly.includes('plastic'));
});

test('rope for the rod counts rope held or spent on the rod; the rod comes after a wood top-up', () => {
  const S = steps(), P = O.createProgress(O.STEPS.filter(s => s.chapter !== 'ch3').map(s => s.id));
  let r = O.evaluate(S, P, fresh({collected:50, tiles:12, stock:{hook:1, hammer:1, rope:3}, ownedTools:['hook', 'hammer']}));
  assert.deepEqual(r.visible, ['rodwood', 'rope8', 'seat']);
  assert.deepEqual(r.counts.rope8, [3, 8]);
  for (let i = 0; i < 2; i++) r = O.evaluate(S, P, fresh({collected:60, tiles:12, stock:{hook:1, hammer:1, fishingrod:1}, ownedTools:['hook', 'hammer', 'fishingrod']}));
  for (const id of ['rodwood', 'rope8', 'rod']) assert.ok(P.done[id], id);
  assert.ok(r.visible.includes('fish1'));
});

test('hints name the hotbar key; swimming shows a climb-back step in any chapter', () => {
  const slots = Array(28).fill(null); slots[0] = {kind:'hook', count:1}; slots[5] = {kind:'hammer', count:1};
  const floor = O.STEPS.find(s => s.id === 'floor');
  assert.match(O.hintOf(floor, fresh({inventory:{slots}, selectedIndex:0})), /^2 planks \+ 2 plastic\. Press \[6\] to hold your hammer/);
  assert.doesNotMatch(O.hintOf(floor, fresh({inventory:{slots}, selectedIndex:5})), /Press/);
  assert.match(O.hintOf(floor, fresh()), /Hammer in hand/);
  const S = steps(), P = O.createProgress(O.STEPS.filter(s => s.chapter === 'ch1' && s.id !== 'swim').map(s => s.id));
  O.evaluate(S, P, fresh({collected:9}), {silent:true});
  assert.ok(!P.done.swim);
  let r = O.evaluate(S, P, fresh({collected:9, swimming:true, grounded:false}));
  assert.equal(r.visible[0], 'swim'); assert.equal(r.chapter, 'ch2'); assert.match(r.hints.swim, /\[Space\]/);
  r = O.evaluate(S, P, fresh({collected:9, swimming:false, grounded:true}));
  assert.deepEqual(r.newly, ['swim']);
  assert.ok(!O.evaluate(S, P, fresh({collected:9})).visible.includes('swim'));
});
