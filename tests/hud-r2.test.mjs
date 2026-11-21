// Regression tests for HUD findings HUD-1..HUD-6 and UX-2/UX-7 (round 2).
// Run: node --test tests/hud-r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = name => readFileSync(fileURLToPath(new URL(name, base)), 'utf8');
const S = await import(new URL('session-rules.js', base));
const gameSrc = src('game.js'), liveSrc = src('live.js');

// ---------------------------------------------------------------- HUD-1 live-update toast

test('HUD-1: routeStatus reports whether a running engine took the notice', () => {
  const bare = new EventTarget();
  assert.equal(S.routeStatus(bare, 'Ocean updated. Keep playing.'), false, 'nobody listening: live.js uses its fallback');
  const engine = new EventTarget(), got = [];
  engine.addEventListener(S.LIVE_STATUS_EVENT, e => { got.push(e.detail.text); e.preventDefault(); });
  assert.equal(S.routeStatus(engine, 'An update is ready for your next session'), true);
  assert.deepEqual(got, ['An update is ready for your next session']);
  assert.equal(S.routeStatus(null, 'x'), false);
});

test('HUD-1: the engine routes live notices into the feed, and the fallback pill is not centred', () => {
  assert.match(gameSrc, /on\(window, LIVE_STATUS_EVENT, e => \{ if \(!running[^\n]*notice\(e\.detail\.text\); e\.preventDefault\(\)/);
  assert.match(liveSrc, /if \(routeStatus\(window, text\)\)/);
  const rule = liveSrc.match(/#updateStatus\{[^}]*\}/)[0];
  assert.doesNotMatch(rule, /left:50%|translate\(-50%/);
  assert.match(rule, /left:22px;bottom:26px/);
  assert.doesNotMatch(liveSrc, /import\(['"]\.\/pickup-feed\.js['"]\)/, 'no second, unversioned feed instance');
});
