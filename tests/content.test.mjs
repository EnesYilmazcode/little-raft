// Registry tests: a failing content module is disabled and disposed once; ext validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { createContent, cleanExt } = await import(new URL('content.js', base));

test('a module that throws is disabled and disposed exactly once', () => {
  let disposed = 0, updates = 0;
  const bad = () => ({ name: 'bad', update() { updates++; throw new Error('boom'); }, dispose() { disposed++; } });
  const good = () => ({ name: 'good', n: 0, update() { this.n++; } });
  const errors = console.error; console.error = () => {};
  try {
    const c = createContent({}, [bad, good]);
    c.update(.016); c.update(.016); c.dispose();
    assert.equal(updates, 1); assert.equal(disposed, 1); assert.equal(c.mods[1].n, 2);
  } finally { console.error = errors; }
});

test('serialize/load route slices by module name and tolerate garbage', () => {
  let got;
  const m = () => ({ name: 'm', serialize: () => ({ a: 1 }), load(d) { got = d; } });
  const c = createContent({}, [m]);
  assert.deepEqual(c.serialize(), { m: { a: 1 } });
  c.load({ m: { a: 2 } }); assert.deepEqual(got, { a: 2 });
  c.load('junk'); assert.equal(got, undefined);
});

test('cleanExt keeps plain objects and drops junk', () => {
  assert.deepEqual(cleanExt(null), {}); assert.deepEqual(cleanExt([1]), {});
  assert.deepEqual(cleanExt({ x: { y: 1 } }), { x: { y: 1 } });
  assert.deepEqual(cleanExt({ big: 'x'.repeat(300000) }), {});
});
