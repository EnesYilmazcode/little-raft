// Round-3 regression tests for pointer lock and Escape (desktop Esc, relock gap, cooldown, logbook from pause).
// Run: node --test tests/lock-r3.test.mjs   (real-app check: tests/e2e/electron_check.py, tests/e2e/esc-relock.py)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const rules = await import(new URL('lock-rules.js', base));
const src = (f) => readFile(new URL(f, base), 'utf8');
const dom = (name) => Object.assign(new Error(name), { name });

// ---- LOCK-R3-2: body.relock follows the lock request for every panel ----
test('LOCK-R3-2: the relock safety timeout is long enough for a slow grant', () => {
  assert.ok(rules.RELOCK_SAFETY_TIMEOUT >= 2000 && rules.RELOCK_SAFETY_TIMEOUT <= 5000);
  assert.equal(rules.relockPending({ elapsed: 1500, timeout: rules.RELOCK_SAFETY_TIMEOUT }), true);
  assert.equal(rules.relockPending({ elapsed: rules.RELOCK_SAFETY_TIMEOUT, timeout: rules.RELOCK_SAFETY_TIMEOUT }), false);
});

test('LOCK-R3-2: requestLock sets body.relock synchronously; settings.js no longer lists dialog ids', async () => {
  const game = await src('game.js'), settings = await src('settings.js');
  const fn = game.slice(game.indexOf('function requestLock()'), game.indexOf('function lockFailed('));
  assert.match(fn, /setRelock\(true\)[\s\S]*canvas\.requestPointerLock\(\)/, 'relock is set before the request');
  assert.match(fn, /escHeld\) \{ relockOnEscUp = true; if \(pending\) setRelock\(true\)/, 'also while waiting for the Escape release');
  assert.doesNotMatch(settings, /d\.id !== 'inventory'/);
  assert.doesNotMatch(settings, /startRelock/);
});

// ---- LOCK-R3-3: the Escape cooldown never switches to drag-look ----
test('LOCK-R3-3: after the first lock, SecurityError never counts as a failure', () => {
  let v = { failures: 0 };
  for (let i = 0; i < 10; i++) {
    v = rules.lockFailureVerdict({ err: dom('SecurityError'), failures: v.failures, everLocked: true });
    assert.equal(v.fallback, false); assert.equal(v.failures, 0);
  }
  // before any lock, a policy denial still falls back after repeated refusals
  v = { failures: 0 };
  for (let i = 0; i < 3; i++) v = rules.lockFailureVerdict({ err: dom('SecurityError'), failures: v.failures });
  assert.equal(v.fallback, true);
  assert.equal(rules.lockFailureVerdict({ err: dom('NotSupportedError'), everLocked: true }).fallback, true);
});

test('LOCK-R3-3: soft drag-look retries the lock on a click, rate-limited; hard fallback never does', () => {
  assert.equal(rules.softRelockTry({ fallback: true, now: 1000 }), true);
  assert.equal(rules.softRelockTry({ fallback: true, now: 1000, lastTry: 0 }), false);
  assert.equal(rules.softRelockTry({ fallback: true, now: 1600, lastTry: 0 }), true);
  assert.equal(rules.softRelockTry({ fallback: true, hard: true, now: 9999 }), false);
  assert.equal(rules.softRelockTry({ fallback: false, now: 9999 }), false);
});

test('LOCK-R3-3: the "Click the ocean" hint is hidden in drag-look', async () => {
  const game = await src('game.js');
  assert.match(game, /resume\.hidden = !\(running && !locked && lockSupported && !lockFallback && !dialog\)/);
});

// ---- LOCK-R3-4: the Electron harness starts a game and presses Esc once ----
test('LOCK-R3-4: electron_check finds the onboarding start buttons and pause_cycle sends one Esc', async () => {
  const py = await readFile(new URL('./e2e/electron_check.py', import.meta.url), 'utf8');
  assert.match(py, /START_BUTTON = [^\n]*\.ob-item\[data-act="continue"\][^\n]*\.ob-item\[data-act="new"\][^\n]*#solo/);
  const cycle = py.slice(py.indexOf('def pause_cycle'), py.indexOf('ACT_GAP'));
  assert.equal((cycle.match(/self\.key\('Escape'/g) || []).length, 2, 'one Esc to pause, one to resume');
  assert.doesNotMatch(cycle, /Esc again/);
});

// ---- LOCK-R3-5: the Logbook opened from pause returns to pause ----
test('LOCK-R3-5: the pause menu hands the logbook a return-to-pause, and its resume skips the relock', async () => {
  const settings = await src('settings.js'), game = await src('game.js');
  const branch = settings.slice(settings.indexOf("if (act === 'logbook')"), settings.indexOf("if (act === 'help'"));
  assert.match(branch, /returnToPause = target; target\.dataset\.fromPause = '1'/);
  assert.ok(branch.indexOf('fromPause') < branch.indexOf('littleraft:open-logbook'), 'handoff set before the logbook opens');
  assert.match(game, /createLogbookUI\(\{[^\n]*onResume:guard\(\(\) => \{ if \(!\$\('#logbook'\)\?\.dataset\.fromPause\) requestLock\(\); \}\)/);
});
