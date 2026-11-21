// Startup module graph: every statically imported module is preloaded from index.html, and every module
// has exactly one URL (a plain './x.js' next to './x.js?build=...' loads and evaluates the file twice,
// with two copies of its module-level state). Fix failures with `python3 publish_local.py --sync`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const DIST = new URL('../dist/', import.meta.url);
const read = (p) => readFileSync(new URL(p, DIST), 'utf8');
const BUILD = JSON.parse(read('version.json')).build;
const html = read('index.html');
// Plain on purpose until the item-icons lane re-stamps survival-ui.js; both importers must stay plain.
const PLAIN_OK = new Set(['./item-svg.js']);

const STATIC = /(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g;
const DYNAMIC = /\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function resolve(fromPath, spec) {
  const [p, q] = spec.split('?');
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), p)) + (q ? '?' + q : '');
}
function staticDeps(url) {
  const file = url.split('?')[0];
  return [...read(file).matchAll(STATIC)].map((m) => resolve(file, m[1] || m[2]));
}
function roots() {
  const scripts = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1]);
  const game = read('live.js').match(/new URL\('\.\/(game\.js[^']*)'/);
  assert.ok(game, 'live.js builds the game.js URL from a literal');
  return [...scripts, game[1]];
}
function graph() {
  const seen = new Set();
  const todo = roots();
  while (todo.length) {
    const u = todo.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    todo.push(...staticDeps(u));
  }
  return seen;
}
const topLevelJs = readdirSync(DIST).filter((f) => f.endsWith('.js'));

test('live.js boots the game.js URL stamped with the current build', () => {
  assert.equal(roots().at(-1), 'game.js?build=' + BUILD);
});

test('index.html modulepreloads exactly the static module graph', () => {
  const pre = new Set([...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]));
  const mods = graph();
  assert.ok(mods.size > 50, 'graph parsed (' + mods.size + ' modules)');
  const missing = [...mods].filter((m) => !pre.has(m));
  const stale = [...pre].filter((m) => !mods.has(m));
  assert.deepEqual(missing, [], 'modules not preloaded (run publish_local.py --sync)');
  assert.deepEqual(stale, [], 'preloads nothing imports (wasted or wrong-URL fetches)');
});

test('each module file is loaded under one URL only', () => {
  const byFile = new Map();
  for (const u of graph()) {
    const f = u.split('?')[0];
    byFile.set(f, [...(byFile.get(f) || []), u]);
  }
  const dup = [...byFile].filter(([, us]) => us.length > 1);
  assert.deepEqual(dup, [], 'files imported under several URLs evaluate twice');
});

test('relative module specifiers carry ?build=<current build>', () => {
  const bad = [];
  for (const f of topLevelJs) {
    const src = read(f);
    for (const re of [STATIC, DYNAMIC]) {
      for (const m of src.matchAll(re)) {
        const spec = m[1] || m[2];
        if (!/^\.\/[a-z][a-z0-9-]*\.js(\?|$)/.test(spec)) continue; // vendor/, subfolders: not stamped
        if (PLAIN_OK.has(spec)) continue;
        if (spec !== spec.split('?')[0] + '?build=' + BUILD) bad.push(f + ': ' + spec);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('the allowed plain specifiers are imported plain everywhere', () => {
  for (const plain of PLAIN_OK) {
    const forms = new Set();
    for (const f of topLevelJs) {
      for (const re of [STATIC, DYNAMIC]) {
        for (const m of read(f).matchAll(re)) {
          const spec = m[1] || m[2];
          if (spec.split('?')[0] === plain) forms.add(spec);
        }
      }
    }
    assert.ok(forms.size <= 1, plain + ' imported as ' + [...forms].join(', '));
  }
});
