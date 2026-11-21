// Every relative import between dist modules must carry the same ?build= stamp.
// A module imported both with and without the stamp loads twice in the browser:
// two requests, two parses, and two copies of its module-level state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const files = readdirSync(dist).filter(f => f.endsWith('.js'));
const names = new Set(readdirSync(dist));
// Same shape publish_local.py rewrites: './name.js' optionally followed by a query.
const SPEC = /(['"])\.\/([a-z][a-z0-9-]*\.js)(\?[^'"]*)?\1/g;

function specifiers() {
  const out = [];
  for (const f of files) {
    const src = readFileSync(new URL(f, dist), 'utf8');
    for (const m of src.matchAll(SPEC)) {
      if (!names.has(m[2])) continue;
      const line = src.slice(0, m.index).split('\n').length;
      out.push({ at: `${f}:${line}`, target: m[2], query: m[3] || '' });
    }
  }
  return out;
}

test('dist relative imports all use one build stamp', () => {
  const specs = specifiers();
  assert.ok(specs.length > 0, 'no relative imports found in dist');
  const stamps = new Map();
  for (const s of specs) {
    const k = s.query || '(none)';
    if (!stamps.has(k)) stamps.set(k, []);
    stamps.get(k).push(`${s.at} -> ./${s.target}${s.query}`);
  }
  const counts = [...stamps].map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1]);
  const [expected] = counts[0];
  assert.match(expected, /^\?build=[\w.-]+$/, `most common specifier query is not a build stamp: ${expected}`);
  const stray = [...stamps].filter(([k]) => k !== expected).flatMap(([, v]) => v);
  assert.deepEqual(stray, [], `relative imports not stamped with ${expected}`);
});

test('index.html does not preload dist modules under a second specifier', () => {
  const html = readFileSync(new URL('index.html', dist), 'utf8');
  const seen = new Map();
  for (const m of html.matchAll(/<(?:link[^>]*rel="modulepreload"[^>]*href|script[^>]*src)="([^"]+)"/g)) {
    const path = m[1].replace(/^\.\//, '').split('?')[0];
    if (!seen.has(path)) seen.set(path, new Set());
    seen.get(path).add(m[1].replace(/^\.\//, ''));
  }
  const dup = [...seen].filter(([, v]) => v.size > 1).map(([k, v]) => `${k}: ${[...v].join(', ')}`);
  assert.deepEqual(dup, [], 'module referenced by index.html under more than one URL');
  // A preload of a module the JS graph imports stamped would fetch a second, unused copy.
  const stamped = new Set(specifiers().filter(s => s.query).map(s => s.target));
  const wasted = [...seen.keys()].filter(p => stamped.has(p) && [...seen.get(p)].some(u => !u.includes('?build=')));
  assert.deepEqual(wasted, [], 'index.html preloads unstamped copies of modules imported with ?build=');
});
