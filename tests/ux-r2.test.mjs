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

test('UX-8: after a hold batch the button reports the craft, not "Missing materials"', () => {
  assert.equal(book.craftButtonText('missing', { n: 6, name: 'Rope' }), 'Crafted 6 Rope');
  assert.equal(book.craftButtonText('ready', { n: 1, name: 'Rope' }), 'Crafted 1 Rope');
  assert.equal(book.craftButtonText('missing', null), 'Missing materials');
  assert.equal(book.craftButtonText('ready'), 'Craft');
  assert.equal(book.craftButtonText('full', { n: 0 }), 'Bag is full');
  // The batch hint is computed from the cap taken before the first craft (6), not the 5 left after it.
  assert.equal(book.holdHint(6), 'hold: up to 6');
});
