// Every dist module must parse. npm test imports only some modules, so a syntax error
// in game.js could ship with a green suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

test('every dist/*.js parses', () => {
  const bad = [];
  for (const f of readdirSync(dist).filter((n) => n.endsWith('.js'))) {
    try { execFileSync(process.execPath, ['--check', join(dist, f)], { stdio: 'pipe' }); }
    catch (e) { bad.push(`${f}: ${String(e.stderr).split('\n').slice(0, 5).join(' ')}`); }
  }
  assert.deepEqual(bad, []);
});
