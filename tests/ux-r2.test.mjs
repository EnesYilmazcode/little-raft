// UX round 2 regressions (crafting panel content, icons, feed, first-run hints).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const book = await import(new URL('craft-book.js', base));

test('UX-3: recipe tooltip lists owned/needed for every ingredient', () => {
  const rows = book.ingredientRows([{ kind: 'wood', count: 4 }, { kind: 'rope', count: 2 }], k => ({ wood: 20 }[k] || 0));
  const name = k => ({ wood: 'Wood', rope: 'Rope' }[k]);
  assert.equal(book.haveNeedLine(rows, name), 'Have/need: 20/4 Wood · 0/2 Rope');
  assert.equal(book.haveNeedLine([], name), '');
});

test('UX-3: slot tooltip words the stack size so it is not read as have/need', () => {
  assert.equal(book.stackLabel(20, 20), 'stack 20/20');
  assert.equal(book.stackLabel(3, 0), '3');
  assert.doesNotMatch(book.stackLabel(7, 20), /^\d+ \/ \d+$/);
});

test('UX-4: hammer and rod icons are posed side-on (head and reel face the camera) and the rod is thickened', async () => {
  const T = await import(new URL('vendor/three.module.js', base));
  const icons = await import(new URL('item-icons.js', base));
  const view = new T.Vector3(1, 0.85, 1.35).normalize(); // item-icons.js camera direction
  for (const kind of ['hammer', 'fishingrod']) {
    const e = new T.Euler(...icons.POSE[kind]);
    const along = new T.Vector3(0, 1, 0).applyEuler(e).dot(view);  // tool length (local +Y)
    const head = new T.Vector3(0, 0, 1).applyEuler(e).dot(view);   // hammer head / reel side (local Z)
    assert.ok(Math.abs(along) < 0.3, `${kind}: length lies in the picture plane (${along.toFixed(2)})`);
    assert.ok(Math.abs(head) < 0.6, `${kind}: head/reel not seen edge-on (${head.toFixed(2)})`);
  }
  assert.ok(icons.ICON_FATTEN.fishingrod >= 2, 'the rod is thick enough to read at slot size');
  // Locked recipes stay legible: no brightness cut on the icon.
  const { readFile } = await import('node:fs/promises');
  const ui = await readFile(new URL('survival-ui.js', base), 'utf8');
  const rule = ui.match(/\.sv-locked \.sv-rart>\*\{([^}]*)\}/)[1];
  assert.doesNotMatch(rule, /brightness/);
});

test('UX-5: the pickup feed gets the bag\'s 3D icons from the same item-icons module instance', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('game.js', base), 'utf8');
  const q = m => (src.match(new RegExp(`from '\\./${m}\\.js(\\?build=[^']*)'`)) || [])[1];
  assert.ok(q('item-icons'), 'game.js imports item-icons.js');
  assert.equal(q('item-icons'), q('pickup-feed'), 'same ?build= query, so the same module instances');
  assert.match(src, /pickupFeed\.setIconProvider\(\s*k\s*=>\s*iconURL\(k\)\s*\)/);
  assert.match(src, /onIconReady\(\s*k\s*=>\s*pickupFeed\.refresh\(k\)\s*\)/, 'rows made before the render finished get swapped');
  // The feed turns a provider URL into an <img>, and falls back to the sprite while it returns null.
  const { createFeed } = await import(new URL('pickup-feed.js', base));
  const el = tag => ({ tagName: tag.toUpperCase(), nodeType: 1, children: [], classList: { add() {}, remove() {} }, setAttribute() {}, append(...c) { this.children.push(...c); }, appendChild(c) { this.children.push(c); }, replaceChildren(...c) { this.children = c; }, remove() {} });
  const body = el('body'), doc = { body, getElementById: () => null, createElement: el, createElementNS: (_, t) => el(t) };
  const feed = createFeed({ doc, now: () => 0, timer: () => 0, clear() {} });
  let ready = false;
  feed.setIconProvider(() => (ready ? 'data:image/png;base64,AAAA' : null));
  const row = feed.add('plastic', 1);
  assert.equal(row.box.children[0].tagName, 'SVG');
  ready = true; feed.refresh('plastic');
  assert.equal(row.box.children[0].tagName, 'IMG');
  assert.equal(row.box.children[0].src, 'data:image/png;base64,AAAA');
});

test('UX-8: after a hold batch the button reports the craft, not "Missing materials"', () => {
  assert.equal(book.craftButtonText('missing', { n: 6, name: 'Rope' }), 'Crafted 6 Rope');
  assert.equal(book.craftButtonText('ready', { n: 1, name: 'Rope' }), 'Crafted 1 Rope');
  assert.equal(book.craftButtonText('missing', null), 'Missing materials');
  assert.equal(book.craftButtonText('ready'), 'Craft');
  assert.equal(book.craftButtonText('full', { n: 0 }), 'Bag is full');
  // The batch hint is computed from the cap taken before the first craft (6), not the 5 left after it.
  assert.equal(book.holdHint(6), 'hold: up to 6');
});
