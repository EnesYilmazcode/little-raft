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
