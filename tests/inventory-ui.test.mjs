// Inventory panel: close triggers, keyboard keys, arrow navigation and refusal reasons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { backdropCloses, bagKeyAction, arrowNeighbor, placeRefusal } = await import(new URL('craft-book.js', base));

test('INV-1: backdrop closes only when press and release are both on it', () => {
  assert.equal(backdropCloses(true, true), true);
  assert.equal(backdropCloses(false, true), false); // pressed in the panel, released outside
  assert.equal(backdropCloses(true, false), false); // pressed outside, released in the panel
  assert.equal(backdropCloses(false, false), false);
});

test('INV-4/5: key mapping keeps Tab opening, lets Tab move focus while open, E closes only', () => {
  assert.equal(bagKeyAction('Tab', false), 'open');
  assert.equal(bagKeyAction('KeyI', false), 'open');
  assert.equal(bagKeyAction('KeyE', false), null, 'E stays the pick-up key in play');
  assert.equal(bagKeyAction('Tab', true), 'close', 'Tab toggles the bag closed; arrows move focus');
  assert.equal(bagKeyAction('KeyI', true), 'close');
  assert.equal(bagKeyAction('KeyE', true), 'close');
  assert.equal(bagKeyAction('KeyW', true), null);
});

// 20 backpack slots in 7 columns above an 8-slot hotbar, like the panel.
function layout() {
  const rects = [];
  for (let i = 0; i < 8; i++) rects[i] = { left: i * 58, top: 200, width: 52, height: 52 };
  for (let j = 0; j < 20; j++) rects[8 + j] = { left: 29 + (j % 7) * 58, top: Math.floor(j / 7) * 58, width: 52, height: 52 };
  return rects;
}

test('INV-5: arrow keys move across the slot grid by layout', () => {
  const r = layout();
  assert.equal(arrowNeighbor(r, 8, 'ArrowRight'), 9);
  assert.equal(arrowNeighbor(r, 9, 'ArrowLeft'), 8);
  assert.equal(arrowNeighbor(r, 8, 'ArrowLeft'), -1, 'stops at the edge');
  assert.equal(arrowNeighbor(r, 8, 'ArrowDown'), 15);
  assert.equal(arrowNeighbor(r, 15, 'ArrowUp'), 8);
  assert.equal(arrowNeighbor(r, 8, 'ArrowUp'), -1);
  // bottom backpack row goes down into the hotbar and back up
  const down = arrowNeighbor(r, 22, 'ArrowDown');
  assert.ok(down >= 0 && down < 8, 'reaches the hotbar');
  assert.ok(arrowNeighbor(r, down, 'ArrowUp') >= 8);
  assert.equal(arrowNeighbor(r, 0, 'ArrowDown'), -1);
  assert.equal(arrowNeighbor(r, 3, 'Enter'), -1);
  r[9] = null;
  assert.equal(arrowNeighbor(r, 8, 'ArrowRight'), 10, 'skips missing slots');
});

test('INV-6: refused placements give a short reason', () => {
  assert.equal(placeRefusal('wood', null, 20), '');
  assert.equal(placeRefusal('wood', { kind: 'wood', count: 5 }, 20), '');
  assert.equal(placeRefusal('wood', { kind: 'leaf', count: 2 }, 20), 'Different item there');
  assert.equal(placeRefusal('wood', { kind: 'wood', count: 20 }, 20), 'That stack is full');
  assert.match(placeRefusal('hook', { kind: 'hook', count: 1 }, 1), /stack/);
});

test('INV-6: hint text describes right-click and the close keys', () => {
  const src = readFileSync(new URL('survival-ui.js', base), 'utf8');
  const hint = src.match(/const HINT = '([^']*)'/)?.[1] ?? '';
  assert.match(hint, /Right-click a stack to take half/);
  assert.match(hint, /right-click while holding to place one/);
  assert.match(hint, /E, I or Esc closes/);
  assert.doesNotMatch(src, /Right-click takes half/);
});
