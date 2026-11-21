// Every item that claims its own sprite (placeholder:false) must have that symbol in icons.svg
// and be allow-listed in survival-ui.js, or the bag draws a two-letter placeholder box instead.
// Run: node --test tests/item-icons.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { ITEM_INFO } = await import(new URL('inventory-state.js', base));
const read = f => readFileSync(fileURLToPath(new URL(f, base)), 'utf8');

test('own-sprite items have a symbol and are allow-listed', () => {
  const svg = read('icons.svg'), ui = read('survival-ui.js');
  const list = ui.match(/const SPRITES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? '';
  const allowed = new Set([...list.matchAll(/'([^']+)'/g)].map(m => m[1]));
  assert.ok(allowed.size > 0, 'SPRITES list found');
  for (const [k, it] of Object.entries(ITEM_INFO)) {
    if (it.placeholder) continue;
    assert.ok(svg.includes(`id="${it.icon}"`), `${k}: ${it.icon} in icons.svg`);
    assert.ok(allowed.has(it.icon.replace(/^icon-/, '')), `${k}: ${it.icon} allow-listed in survival-ui.js`);
  }
});

test('bed, motor and wheel have their own icons', () => {
  for (const k of ['bed', 'motor', 'wheel']) {
    assert.equal(ITEM_INFO[k].icon, `icon-${k}`);
    assert.equal(ITEM_INFO[k].placeholder, false);
  }
});
