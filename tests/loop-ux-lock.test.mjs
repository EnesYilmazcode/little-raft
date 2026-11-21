// Regression tests: the cursor must never escape or appear in play (Esc cooldown, drag-look, blur, desktop shell).
// Run: node --test tests/loop-ux-lock.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { lockFailureVerdict, USER_EXIT_COOLDOWN } = await import(new URL('lock-rules.js', base));
const read = f => readFileSync(fileURLToPath(new URL(f, base)), 'utf8');
const dom = name => ({ name, message: name });

test('C1: SecurityError inside the post-Esc cooldown never counts toward drag-look', () => {
  let failures = 0;
  for (let i = 0; i < 10; i++) {
    const v = lockFailureVerdict({ err: dom('SecurityError'), failures, sinceUserExit: 200 + i * 100 });
    assert.equal(v.fallback, false); failures = v.failures;
  }
  assert.equal(failures, 0);
  assert.ok(USER_EXIT_COOLDOWN >= 1000 && USER_EXIT_COOLDOWN <= 2000);
});

test('C1: SecurityError well after a user exit (or with none) still counts, three switch', () => {
  let failures = 0, v;
  for (let i = 0; i < 3; i++) { v = lockFailureVerdict({ err: dom('SecurityError'), failures, sinceUserExit: 5000 }); failures = v.failures; }
  assert.equal(v.fallback, true);
  assert.equal(lockFailureVerdict({ err: dom('SecurityError'), failures: 2 }).fallback, true); // default: no user exit known
  assert.equal(lockFailureVerdict({ err: dom('NotSupportedError'), sinceUserExit: 10 }).fallback, true);
});

test('C1: game.js records user lock losses, resets failures on them, and feeds the cooldown to the verdict', () => {
  const g = read('game.js');
  assert.match(g, /sinceUserExit:performance\.now\(\) - userExitAt/);
  assert.match(g, /userExitAt = now; lockFailures = 0;/);
  assert.match(g, /pageReleaseAt = performance\.now\(\); document\.exitPointerLock/);
});

test('C2: drag-look fallback never hides the cursor waiting for a relock', () => {
  const g = read('game.js'), s = read('settings.js');
  assert.match(g, /b\.toggle\('drag-look', lockFallback\); if \(lockFallback\) b\.remove\('relock'\)/);
  assert.doesNotMatch(s, /body\.relock #world\{cursor:none\}/);
  assert.match(s, /body\.relock:not\(\.drag-look\) #world\{cursor:none\}/);
  assert.match(s, /body\.relock:not\(\.drag-look\) #resumeHint\{display:none!important\}/);
  assert.match(s, /!document\.body\.classList\.contains\('drag-look'\)\) document\.body\.classList\.add\('relock'\)/);
});

const shell = () => readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');

test('C4: desktop window accepts the first click (macOS) and does not relock on focus', () => {
  const m = shell();
  assert.match(m, /new BrowserWindow\(\{[^}]*acceptFirstMouse:true/);
  assert.doesNotMatch(m, /on\('focus'[^\n]*requestPointerLock/);
});

test('C3: window blur drops body.relock so the away resume hint is visible', () => {
  const s = read('settings.js');
  assert.match(s, /window\.addEventListener\('blur', \(\) => document\.body\.classList\.remove\('relock'\)/);
});
