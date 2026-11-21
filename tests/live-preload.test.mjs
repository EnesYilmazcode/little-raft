// live.js injects <link rel=modulepreload> for game.js' static import graph from a hand-kept PRELOAD list.
// This keeps that list equal to the real graph so it cannot drift as modules are added, moved or lazy-loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, join, posix } from 'node:path';

const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const dir = fileURLToPath(base);
const read = name => readFileSync(join(dir, name), 'utf8');
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1'); // drop comments

// Static imports only: `import x from './a.js?…'`, `import {…} from "./a.js"`, `import './a.js'`, `export … from './a.js'`.
// Dynamic `import('./a.js')` is deliberately not matched: lazy modules must stay out of the preload list.
// Also './dir/name.js' (textures.js imports texgen/*.js); names are dist-relative posix paths.
const STATIC = /(?:^|[\s;}])(?:import|export)\s+(?:[^'"();]*?\s+from\s+|[^'"();]*?\bfrom\s*)?['"]\.\/((?:[a-z][a-z0-9-]*\/)*[a-z][a-z0-9-]*\.js)(?:\?([^'"]*))?['"]/gm;

function staticGraph(entry) {
  const seen = new Map(); // name -> query strings it was imported with
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    for (const m of strip(read(file)).matchAll(STATIC)) {
      const [, rel, query = ''] = m;
      const name = posix.normalize(posix.join(posix.dirname(file), rel));
      if (!seen.has(name)) { seen.set(name, new Set()); queue.push(name); }
      seen.get(name).add(query);
    }
  }
  return seen;
}

function preloadList() {
  const m = read('live.js').match(/const PRELOAD = \[([\s\S]*?)\];/);
  assert.ok(m, 'live.js defines const PRELOAD = [...]');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

test('live.js PRELOAD equals the static import graph of game.js', () => {
  const graph = [...staticGraph('game.js').keys()].sort();
  const list = preloadList();
  assert.equal(new Set(list).size, list.length, 'no duplicates in PRELOAD');
  const missing = graph.filter(n => !list.includes(n)), stale = list.filter(n => !graph.includes(n));
  assert.deepEqual({missing, stale}, {missing:[], stale:[]}, 'update PRELOAD in dist/live.js');
  for (const n of list) assert.ok(existsSync(join(dir, n)), n + ' exists in dist');
});

test('every static import uses the same ?build= id that live.js preloads with', () => {
  const baked = read('live.js').match(/game\.js\?build=([^'"&]+)/)?.[1];
  assert.ok(baked, 'live.js bakes a build id into moduleUrl()');
  for (const [name, queries] of staticGraph('game.js')) {
    assert.deepEqual([...queries], ['build=' + baked], name + ' is imported as ./' + name + '?build=' + baked);
  }
});

test('lazy feature modules are not in the startup graph', () => {
  const graph = staticGraph('game.js');
  // Only modules this build actually loads through import(); coop-avatar/coop-fx/underwater-fx/diving-ui are still
  // static imports here (the round-1 lazy hub / lazy dive fx were not carried over), so they are not listed.
  // logbook-ui/look-ui (game.js), build-menu (building.js) and smelter-ui (progression-hooks.js) are fetched right
  // after mount; they must not slip back into the startup graph.
  for (const n of ['coop-hub.js', 'controls-tab.js', 'logbook-ui.js', 'look-ui.js', 'build-menu.js', 'smelter-ui.js']) {
    if (existsSync(join(dir, n))) assert.ok(!graph.has(n), n + ' should only load through import()');
  }
});

test('index.html statically preloads game.js and exactly the PRELOAD list, stamped with the baked build', () => {
  // publish_local.py writes both from the same graph; the static tags start the fetches while the HTML parses.
  const baked = read('live.js').match(/game\.js\?build=([^'"&]+)/)[1];
  const html = read('index.html');
  const block = html.match(/<!-- startup-preload -->([\s\S]*?)<!-- \/startup-preload -->/);
  assert.ok(block, 'index.html has the <!-- startup-preload --> block (python publish_local.py dist --resync)');
  const hrefs = [...block[1].matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(m => m[1]);
  assert.equal(hrefs[0], 'game.js?build=' + baked, 'game.js is preloaded first');
  for (const h of hrefs) assert.ok(h.endsWith('?build=' + baked), h + ' carries ?build=' + baked);
  const names = hrefs.slice(1).map(h => h.split('?')[0]);
  assert.equal(new Set(names).size, names.length, 'no duplicate preloads');
  assert.deepEqual([...names].sort(), [...preloadList()].sort(), 'index.html preloads == live.js PRELOAD');
});
