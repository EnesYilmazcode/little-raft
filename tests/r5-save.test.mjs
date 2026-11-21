// R5 save/co-op fixes: vitals reset on world swap, New Game wipe of per-raft stores, no save from an unplayed
// reload, 'leaving' on quit to title, material disposal deferred while a shader warm-up is pending.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const game = readFileSync(new URL('../dist/game.js', import.meta.url), 'utf8');
const onboarding = readFileSync(new URL('../dist/onboarding.js', import.meta.url), 'utf8');
const fnBody = (src, sig) => { const i = src.indexOf(sig); assert.ok(i >= 0, sig); return src.slice(i, src.indexOf('\n  }\n', i) + 4); };
const line = (src, sig) => { const i = src.indexOf(sig); assert.ok(i >= 0, sig); return src.slice(i, src.indexOf('\n', i)); };

test('edited modules parse', () => {
  for (const f of ['game.js', 'onboarding.js', 'fishing-cooking.js', 'progression-hooks.js']) execFileSync(process.execPath, ['--check', new URL(`../dist/${f}`, import.meta.url).pathname]);
});

test('SAVE-1: adoptStoredSave and newGame reset the local vitals from the loaded world; restoreOwnRaft does not', () => {
  assert.match(game, /function resetVitals\(\) \{ Object\.assign\(vitals, newVitals\(world\.vitals\)\); fainted = -1; eating = null; \}/);
  assert.match(line(game, 'function adoptStoredSave()'), /loadRaft\(savedOwnRaft\(\)\); resetVitals\(\);/);
  assert.match(fnBody(game, 'function newGame()'), /loadRaft\([^\n]*\); resetVitals\(\);/);
  assert.doesNotMatch(fnBody(game, 'function restoreOwnRaft()'), /resetVitals/);
});

test('SAVE-1: resetVitals takes the stored bars and clears faint/eat state', async () => {
  const { newVitals } = await import('../dist/vitals.js');
  const vitals = newVitals(null); vitals.hp = 3; vitals.food = 0; vitals.starving = true;
  let fainted = 1.2, eating = {item:'cookedfish'}; const world = {vitals:{hp:80, food:55, water:40}};
  const src = line(game, 'function resetVitals()');
  new Function('vitals', 'newVitals', 'world', 'set', `${src.replace(/\/\/.*$/, '').replace('fainted = -1; eating = null;', 'set(-1, null);')} resetVitals();`)(vitals, newVitals, world, (f, e) => { fainted = f; eating = e; });
  assert.deepEqual([vitals.hp, vitals.food, vitals.water, vitals.starving, fainted, eating], [80, 55, 40, false, -1, null]);
});

test('SAVE-2: the title wipe also clears grills, basket and progression but keeps the fish journal', () => {
  const body = fnBody(onboarding, 'function wipe()');
  assert.match(onboarding, /FC_KEY = 'little-raft-fc-v1'/);
  assert.match(onboarding, /PROGRESSION_KEY = 'littleRaft\.progression\.v1'/);
  assert.match(body, /addEventListener\('beforeunload', clear\); addEventListener\('pagehide', clear\)/, 'runs after the modules\' own unload saves');
  const mem = new Map([['little-raft-v1', '{}'], ['littleRaft.progression.v1', '{"v":1}'],
    ['little-raft-fc-v1', JSON.stringify({v:1, journal:{species:{tuna:{n:2}}, dishes:{'Grilled Tuna':1}, basket:[{species:'tuna'}]}, grills:[{x:1, z:0}]})]]);
  const store = { get: k => mem.has(k) ? mem.get(k) : null, set: (k, v) => mem.set(k, v), del: k => mem.delete(k) };
  const clearSrc = body.slice(body.indexOf('const clear'), body.indexOf('clear(); addEventListener'));
  new Function('store', 'SAVE_KEY', 'KEY', 'FC_KEY', 'PROGRESSION_KEY', `${clearSrc}; clear();`)(store, 'little-raft-v1', 'little-raft-onboarding-v1', 'little-raft-fc-v1', 'littleRaft.progression.v1');
  assert.equal(mem.has('little-raft-v1'), false);
  assert.equal(mem.has('littleRaft.progression.v1'), false);
  const fc = JSON.parse(mem.get('little-raft-fc-v1'));
  assert.deepEqual(fc.grills, []); assert.deepEqual(fc.journal.basket, []);
  assert.deepEqual(fc.journal.species, {tuna:{n:2}}); assert.deepEqual(fc.journal.dishes, {'Grilled Tuna':1});
});

test('SAVE-3: beforeunload only saves while playing', () => {
  assert.match(line(game, "on(window, 'beforeunload'"), /\{ if \(running\) save\(\); send\(\{type:'leaving'\}\);/);
});

test('SAVE-4: quit to title tells the peer it is leaving before closing the connection', () => {
  assert.match(fnBody(game, 'function quitToTitle()'), /if \(role !== 'solo'\) \{ send\(\{type:'leaving'\}\); closeConnection\(\); \}/);
});

test('SAVE-5: every warm-up goes through warmCompile; disposeGeometry disposes through disposeMaterial', () => {
  assert.equal((game.match(/renderer\.compileAsync\(/g) || []).length, 1, 'only warmCompile calls compileAsync');
  assert.match(line(game, 'function disposeGeometry('), /for \(const m of materials\) disposeMaterial\(m\);/);
});

function warmHarness() {
  const start = game.indexOf('  let warming = 0;'), end = game.indexOf('\n  }\n', game.indexOf('function warmCompile()')) + 4;
  const resolvers = [], disposed = [], timers = [];
  const renderer = { compileAsync: () => new Promise(r => resolvers.push(r)) };
  const fakeTimeout = (fn) => { timers.push(fn); return timers.length; };
  const api = new Function('renderer', 'scene', 'camera', 'setTimeout', 'clearTimeout',
    `${game.slice(start, end)}; return {warmCompile, disposeMaterial, get warming() { return warming; }};`)(renderer, {}, {}, fakeTimeout, () => {});
  const mat = n => ({ n, map:null, dispose() { disposed.push(n); } });
  return { api, resolvers, disposed, timers, mat };
}

test('SAVE-5: materials disposed during a pending warm-up wait until every warm-up settles', async () => {
  const { api, resolvers, disposed, mat } = warmHarness();
  api.disposeMaterial(mat('a')); assert.deepEqual(disposed, ['a'], 'no warm-up: immediate');
  const p1 = api.warmCompile(), p2 = api.warmCompile();
  api.disposeMaterial(mat('b')); api.disposeMaterial(mat('c'));
  assert.deepEqual(disposed, ['a']);
  resolvers[0](); await p1; assert.deepEqual(disposed, ['a'], 'one warm-up still pending');
  resolvers[1](); await p2; assert.deepEqual(disposed, ['a', 'b', 'c']);
  assert.equal(api.warming, 0);
});

test('SAVE-5: a warm-up that never settles releases disposal at the cap, once', async () => {
  const { api, disposed, timers, mat } = warmHarness();
  api.warmCompile(); api.disposeMaterial(mat('x'));
  assert.deepEqual(disposed, []);
  timers[0](); timers[0]();
  assert.deepEqual(disposed, ['x']); assert.equal(api.warming, 0);
});

test('SAVE-2: in-game newGame() also resets the fishing and progression stores before loading the fresh world', () => {
  const body = fnBody(game, 'function newGame()');
  assert.ok(body.indexOf('fc?.resetWorld?.()') > 0 && body.indexOf('fc?.resetWorld?.()') < body.indexOf('loadRaft('));
  assert.ok(body.indexOf('prog?.reset?.()') > 0 && body.indexOf('prog?.reset?.()') < body.indexOf('loadRaft('));
  const fcSrc = readFileSync(new URL('../dist/fishing-cooking.js', import.meta.url), 'utf8');
  assert.match(fcSrc, /resetWorld\(\) \{ syncRole\(\); clearGrills\(\); stash = isGuest\(lastRole\) \? \[\] : null; journal\.basket\.length = 0; markChanged\(\); save\(\); \}/);
  const progSrc = readFileSync(new URL('../dist/progression-hooks.js', import.meta.url), 'utf8');
  assert.match(progSrc, /progs\.host = new Progression\(\); progs\.guest = new Progression\(\); stations\.clear\(\);/);
  assert.match(progSrc, /installUI, save, reset, dispose/);
});
