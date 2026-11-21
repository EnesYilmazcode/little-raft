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
