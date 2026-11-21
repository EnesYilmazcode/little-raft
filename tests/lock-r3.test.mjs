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

// ---- LOCK-R3-4: the Electron harness starts a game and presses Esc once ----
test('LOCK-R3-4: electron_check finds the onboarding start buttons and pause_cycle sends one Esc', async () => {
  const py = await readFile(new URL('./e2e/electron_check.py', import.meta.url), 'utf8');
  assert.match(py, /START_BUTTON = [^\n]*\.ob-item\[data-act="continue"\][^\n]*\.ob-item\[data-act="new"\][^\n]*#solo/);
  const cycle = py.slice(py.indexOf('def pause_cycle'), py.indexOf('ACT_GAP'));
  assert.equal((cycle.match(/self\.key\('Escape'/g) || []).length, 2, 'one Esc to pause, one to resume');
  assert.doesNotMatch(cycle, /Esc again/);
});

