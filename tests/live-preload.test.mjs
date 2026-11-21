// live.js injects <link rel=modulepreload> for game.js' static import graph from hand-kept PRELOAD lists.
// This keeps those lists equal to the real graph so they cannot drift as modules are added, moved or lazy-loaded.
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
// Dynamic `import('./a.js')` is deliberately not matched: lazy modules must stay out of the preload list.
const HEAD = String.raw`(?:^|[\s;}])(?:import|export)\s+(?:[^'"();]*?\s+from\s+|[^'"();]*?\bfrom\s*)?['"]\./`;
const STATIC = new RegExp(HEAD + String.raw`([a-z][a-z0-9-]*\.js)(?:\?([^'"]*))?['"]`, 'gm');
// Vendored modules (./vendor/x.js) are imported without a build query and preloaded as-is.
const VENDOR = new RegExp(HEAD + String.raw`(vendor/[a-z][a-z0-9.-]*\.js)(\?[^'"]*)?['"]`, 'gm');

function staticGraph(entry) {
  const seen = new Map(); // name -> query strings it was imported with
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    for (const m of strip(read(file)).matchAll(STATIC)) {
      const [, name, query = ''] = m;
      if (!seen.has(name)) { seen.set(name, new Set()); queue.push(name); }
      seen.get(name).add(query);
    }
  }
  return seen;
}

function vendorImports() {
  const out = new Set();
  for (const file of ['game.js', ...staticGraph('game.js').keys()]) {
    for (const m of strip(read(file)).matchAll(VENDOR)) {
      assert.equal(m[2], undefined, file + ' imports ./' + m[1] + ' without a query');
      out.add(m[1]);
    }
  }
  return [...out].sort();
}

function preloadList(name) {
  const m = read('live.js').match(new RegExp('const ' + name + String.raw` = \[([\s\S]*?)\];`));
  assert.ok(m, 'live.js defines const ' + name + ' = [...]');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

test('live.js PRELOAD equals the static import graph of game.js', () => {
  const graph = [...staticGraph('game.js').keys()].sort();
  const list = preloadList('PRELOAD');
  assert.equal(new Set(list).size, list.length, 'no duplicates in PRELOAD');
  const missing = graph.filter(n => !list.includes(n)), stale = list.filter(n => !graph.includes(n));
  assert.deepEqual({missing, stale}, {missing:[], stale:[]}, 'update PRELOAD in dist/live.js');
  for (const n of list) assert.ok(existsSync(join(dir, n)), n + ' exists in dist');
});

test('live.js PRELOAD_VENDOR equals the vendored modules the graph imports', () => {
  const list = preloadList('PRELOAD_VENDOR');
  assert.deepEqual([...list].sort(), vendorImports(), 'update PRELOAD_VENDOR in dist/live.js');
  for (const n of list) assert.ok(existsSync(join(dir, n)), n + ' exists in dist');
});

test('every static import uses the same ?build= id that live.js preloads with', () => {
  const baked = read('live.js').match(/game\.js\?build=([^'"&]+)/)?.[1];
  assert.ok(baked, 'live.js bakes a build id into moduleUrl()');
  for (const [name, queries] of staticGraph('game.js')) {
    assert.deepEqual([...queries], ['build=' + baked], name + ' is imported as ./' + name + '?build=' + baked);
  }
});

test('PeerJS is not a blocking script in index.html', () => {
  assert.ok(!/<script[^>]+peerjs/i.test(read('index.html')), 'game.js loads vendor/peerjs.min.js on first host/join');
});
