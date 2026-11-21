// Round 2 regression tests for saves across tabs, hot-swap globals and co-op hook claims.
// Run: node --test tests/net-r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const S = await import(new URL('session-rules.js', base));
const src = name => readFileSync(new URL(name, base), 'utf8');
const raw = rev => JSON.stringify({rev, tiles:[]});

test('NET-1: a tab on the title is not save-blocked by another tab, but a playing tab is', () => {
  assert.equal(S.storageBlocks({running:false, role:'solo', newRaw:raw(13), baseRev:5}), false);
  assert.equal(S.storageBlocks({running:true, role:'solo', newRaw:raw(13), baseRev:5}), true);
  assert.equal(S.storageBlocks({running:true, role:'host', newRaw:raw(13), baseRev:5}), true);
  assert.equal(S.storageBlocks({running:true, role:'guest', newRaw:raw(13), baseRev:5}), false);
  assert.equal(S.storageBlocks({running:true, role:'solo', newRaw:raw(5), baseRev:5}), false);
});

test('NET-1: leaving the title adopts a newer stored save; New game writes over it', () => {
  assert.equal(S.adoptOnStart({running:false, role:'solo', storedRev:13, saveRev:5}), true);
  assert.equal(S.adoptOnStart({running:false, role:'host', storedRev:13, saveRev:5}), true);
  assert.equal(S.adoptOnStart({running:false, role:'guest', storedRev:13, saveRev:5}), false);
  assert.equal(S.adoptOnStart({running:true, role:'solo', storedRev:13, saveRev:5}), false);
  assert.equal(S.adoptOnStart({running:false, role:'solo', storedRev:5, saveRev:5}), false);
  // New game takes the stored rev as its base, so its first save is allowed and is newer than tab A's.
  const rev = S.newGameBaseRev(13, 5);
  const plan = S.planSave(raw(13), rev);
  assert.equal(plan.ok, true); assert.equal(plan.rev, 14);
  assert.equal(S.newGameBaseRev(0, 0), 0);
});

test('NET-1: game.js wires the title rules into the storage listener, start() and newGame()', () => {
  const g = src('game.js');
  assert.match(g, /storageBlocks\(\{running, role, newRaw:e\.newValue, baseRev:saveRev\}\)/);
  assert.match(g, /function start\(\) \{\s*if \(adoptOnStart\(/);
  assert.match(g, /saveRev = newGameBaseRev\(storedRev\(\), saveRev\); unblockSave\(\);[^\n]*\n\s*save\(\); start\(\);/);
});

test('Title save status: inline on the title card, never a popup', () => {
  assert.equal(S.titleSaveNote({}), '');
  assert.match(S.titleSaveNote({storedRev:13, saveRev:5}), /another tab/);
  assert.match(S.titleSaveNote({blocked:true, storedRev:5, saveRev:5}), /stopped saving/);
  assert.match(S.titleSaveNote({available:false}), /unavailable/);
  const html = src('index.html');
  const card = html.slice(html.indexOf('<section class="welcome-card">'), html.indexOf('</section>'));
  assert.match(card, /<small id="titleSaveStatus"[^>]*role="status"[^>]*hidden>/);
  const css = src('style.css');
  const rule = /\.title-save\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.ok(rule, '.title-save rule exists');
  assert.doesNotMatch(rule, /position:\s*(fixed|absolute)/);
  assert.match(src('game.js'), /titleSaveNote\(\{available:saveAvailable, blocked:saveBlocked, storedRev:storedRev\(\), saveRev\}\)/);
});

test('NET-2: restoreGlobal puts back what a failed mount replaced, never over a newer owner', () => {
  const oldShell = {hold(){}}, failed = {hold(){}}, newer = {hold(){}};
  const w = {raftShell:oldShell};
  const prev = Object.getOwnPropertyDescriptor(w, 'raftShell');
  w.raftShell = failed; delete w.raftShell; // the failed mount's dispose() deletes its own shellApi
  assert.equal(S.restoreGlobal(w, 'raftShell', prev, failed), true);
  assert.equal(w.raftShell, oldShell);
  w.raftShell = failed;
  assert.equal(S.restoreGlobal(w, 'raftShell', prev, failed), true);
  assert.equal(w.raftShell, oldShell);
  w.raftShell = newer;
  assert.equal(S.restoreGlobal(w, 'raftShell', prev, failed), false);
  assert.equal(w.raftShell, newer);
  const fresh = {raftEscape:() => {}};
  assert.equal(S.restoreGlobal(fresh, 'raftEscape', undefined, fresh.raftEscape), true);
  assert.equal('raftEscape' in fresh, false);
});

test('NET-2: the failed-mount path and settings.destroy() restore raftShell and raftEscape', () => {
  const g = src('game.js'), st = src('settings.js');
  const catchBlock = g.slice(g.indexOf('} catch (e) {\n    console.error(e); dispose();'));
  assert.match(catchBlock, /restoreGlobal\(window, 'raftShell', previousShell, shellApi\)/);
  assert.match(catchBlock, /restoreGlobal\(window, 'raftEscape', previousEscape/);
  assert.ok(g.indexOf("previousShell = Object.getOwnPropertyDescriptor(window, 'raftShell')") < g.indexOf('window.raftShell = shellApi'));
  assert.match(st, /destroy\(\) \{[^]*restoreGlobal\(window, 'raftEscape', previousEscape, raftEscape\)/);
});

const T = await import(new URL('vendor/three.module.js', base));
const { HookCast } = await import(new URL('hook-physics.js', base));
const { hookableItems, cleanHeldTokens } = await import(new URL('coop-rules.js', base));

test('NET-3: hookableItems skips the other player\'s catch but keeps our own', () => {
  const items = [{id:1, token:'a', x:0, z:-4}, {id:2, token:'b', x:0, z:-5}, {id:3, token:'c', x:0, z:-6}];
  const ids = l => l.map(it => it.token).join();
  assert.equal(ids(hookableItems(items, {otherHeld:new Set(['a', 'b']), ownHeld:new Set(['a'])})), 'a,c');
  assert.equal(ids(hookableItems(items, {isPending:it => it.token === 'c'})), 'a,b');
  assert.equal(ids(hookableItems(items)), 'a,b,c');
  assert.deepEqual(cleanHeldTokens(undefined), []); // older hosts send no held list
});

test('NET-3: the host keeps a plank on its hook even when the guest reports holding it too', () => {
  const cast = new HookCast(T, {origin:{x:0, y:1.45, z:0.6}, direction:{x:0, y:0, z:-1}, charge:0.5});
  for (let i = 0; i < 200 && cast.stage === 'flying'; i++) cast.update(1 / 60, {hand:{x:0, y:1.45, z:0.6}, items:[], time:i / 60});
  const plank = {id:7, token:'p7', type:'wood', x:cast.position.x, z:cast.position.z};
  cast.update(1 / 60, {hand:{x:0, y:1.45, z:0.6}, items:[plank], time:4});
  assert.deepEqual(cast.caughtItems.map(c => c.token), ['p7']);
  const own = new Set(cast.caughtItems.map(c => c.token)), guest = new Set(['p7']);
  cast.update(1 / 60, {hand:{x:0, y:1.45, z:0.6}, items:hookableItems([plank], {otherHeld:guest, ownHeld:own}), time:4.1});
  assert.deepEqual(cast.caughtItems.map(c => c.token), ['p7'], 'still on the host hook');
  cast.update(1 / 60, {hand:{x:0, y:1.45, z:0.6}, items:[plank].filter(it => !guest.has(it.token)), time:4.2}); // the old filter
  assert.deepEqual(cast.caughtItems, [], 'the old guest-only filter silently dropped it');
});

test('NET-3: host state carries its held tokens, the guest filters them, and a guest collect of them is refused', () => {
  const g = src('game.js');
  assert.match(g, /type:'state', v:3,[^\n]*held:\[\.\.\.ownHeldTokens\(\)\]/);
  assert.match(g, /hostHeld = new Set\(cleanHeldTokens\(data\.held\)\)/);
  assert.match(g, /otherHeldTokens = \(\) => \(role === 'guest' \? hostHeld :/);
  assert.match(g, /hook\.update\(dt, \{hand:handPos, items:hookableItems\(world\.items, \{isPending, otherHeld:otherHeldTokens\(\), ownHeld:ownHeldTokens\(\)\}\)/);
  assert.match(g, /if \(actor === 'guest' && !a\.net && ownHeldTokens\(\)\.has\(it\.token\)\) return;/);
});

test('NET-4: a guest leaving while the host tab saved newer stays blocked and keeps its old rev', () => {
  assert.deepEqual(S.guestLeavePlan(13, 5), {useBackup:false, block:true, saveRev:5});
  assert.deepEqual(S.guestLeavePlan(5, 5), {useBackup:true, block:false, saveRev:5});
  // With the old rev kept, this tab can never write over the host tab's save, so the host is never blocked by it.
  assert.equal(S.planSave(raw(14), S.guestLeavePlan(13, 5).saveRev).ok, false);
  const g = src('game.js'), body = g.slice(g.indexOf('function restoreOwnRaft()'), g.indexOf('function loadRaft('));
  assert.match(body, /guestLeavePlan\(storedRev\(\), saveRev\)/);
  assert.match(body, /if \(plan\.block\) blockSave\(\);/);
  assert.doesNotMatch(body, /saveBlocked = false|saveRev = storedRev\(\)/);
});

const H = await import(new URL('hud.js', base));

test('NET-5: New game resets the first-run hint chain and its stored copy', () => {
  const mem = {}, storage = {getItem:k => mem[k] ?? null, setItem:(k, v) => { mem[k] = v; }};
  const done = new Set(['throw', 'loot', 'bag', 'slots']); H.saveHints(storage, done);
  assert.equal(H.nextHint(done, {heldKind:'hook', castOut:false}), null);
  assert.equal(H.resetHints(storage, done), true);
  assert.deepEqual([...done].sort(), ['bag', 'slots', 'throw']); // learned control tips survive (r5: no re-teaching on a new raft)
  assert.equal(H.loadHints(storage).size, 3);
  assert.equal(H.nextHint(done, {heldKind:'hook', hasLeaf:true})?.id, 'rope');
  const g = src('game.js'), body = g.slice(g.indexOf('function newGame()'), g.indexOf('const hasSave'));
  assert.match(body, /resetHints\(window\.localStorage, hintsDone\)/);
});
