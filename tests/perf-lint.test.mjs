// Static perf lint over dist/*.js. Run: node --test tests/perf-lint.test.mjs
// three r170 draws transparent DoubleSide materials in two passes and flags material.needsUpdate on each,
// re-running WebGLPrograms.getParameters every frame (~7 KB/frame of garbage per material). Require forceSinglePass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
const dir = new URL('../dist/', import.meta.url);

test('transparent DoubleSide materials set forceSinglePass', () => {
  const bad = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/\{[^{}]*\}/g)) {
      const o = m[0];
      if (/transparent\s*:\s*true/.test(o) && /side\s*:\s*(T|THREE)\.DoubleSide/.test(o) && !/forceSinglePass\s*:\s*true/.test(o))
        bad.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(bad, [], 'add forceSinglePass: true (or another side) to these materials');
});

// A module imported both as './x.js' and './x.js?build=…' loads twice (two instances, double download, stale copy
// after a live hot swap). publish_local.py rewrites every specifier to carry the build query, so source must too.
test('relative imports carry the ?build= query', () => {
  const names = new Set(readdirSync(dir).filter(f => f.endsWith('.js')));
  const bad = [];
  for (const f of names) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*)(['"])\.\/([a-z][a-z0-9-]*\.js)(\?[^'"]*)?\1/g))
      if (names.has(m[2]) && !(m[3] || '').startsWith('?build=')) bad.push(`${f}: ${m[2]}`);
  }
  assert.deepEqual(bad, [], 'add ?build=<id> to these imports');
});
