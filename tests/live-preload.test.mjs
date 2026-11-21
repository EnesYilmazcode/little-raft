// live.js injects <link rel=modulepreload> for game.js' static import graph from a hand-kept PRELOAD list.
// These tests keep that list equal to the real graph (exact specifiers, ?build= stamps included) so it
// cannot drift as modules are added, moved, restamped or made lazy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const dir = fileURLToPath(base);
const read = name => readFileSync(join(dir, name), 'utf8');
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1'); // drop comments

// Static imports only: `import x from './a.js?…'`, `import {…} from "./a.js"`, `import './a.js'`, `export … from './a.js'`.
// Dynamic `import('./a.js')` is deliberately not matched: lazy modules stay out of the preload list.
const STATIC = /(?:^|[\s;}])(?:import|export)\s+(?:[^'"();]*?\bfrom\s*)?['"](\.{1,2}\/[^'"?]+\.js)(\?[^'"]*)?['"]/gm;

// Walks the graph the way the browser does: a module instance is keyed by its full URL (path + query).
function staticGraph(entry) {
  const urls = new Map(); // dist-relative path + query -> file path
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    const from = new URL(file, base);
    for (const [, spec, query = ''] of strip(read(file)).matchAll(STATIC)) {
      const u = new URL(spec + query, from);
      const key = u.href.slice(base.length);
      if (urls.has(key)) continue;
      const path = decodeURIComponent(u.pathname).slice(new URL(base).pathname.length);
      urls.set(key, path);
      queue.push(path);
    }
  }
  return urls;
}

function preloadList() {
  const m = read('live.js').match(/const PRELOAD = \[([\s\S]*?)\];/);
  assert.ok(m, 'live.js defines const PRELOAD = [...]');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => new URL(x[1], base).href.slice(base.length));
}

test('live.js PRELOAD equals the static import graph of game.js, stamps included', () => {
  const graph = [...staticGraph('game.js').keys()].sort();
  const list = preloadList();
  assert.equal(new Set(list).size, list.length, 'no duplicates in PRELOAD');
  const missing = graph.filter(n => !list.includes(n)), stale = list.filter(n => !graph.includes(n));
  assert.deepEqual({ missing, stale }, { missing: [], stale: [] }, 'update PRELOAD in dist/live.js');
  for (const n of list) assert.ok(existsSync(join(dir, n.split('?')[0])), n + ' exists in dist');
});

test('no module is imported under two URLs (each URL is a separate instance with its own state)', () => {
  const byFile = new Map();
  for (const [url, file] of staticGraph('game.js')) byFile.set(file, [...(byFile.get(file) || []), url]);
  const dups = [...byFile].filter(([, urls]) => urls.length > 1);
  assert.deepEqual(dups, [], 'import these with one specifier everywhere');
});
