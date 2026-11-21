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
