// Crafting round 3 regressions: one gate (progression + Tinker's Desk) for the book, the tracker and the host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const SR = await import(new URL('storage-research.js', base));
const CB = await import(new URL('craft-book.js', base));

test('CRAFT-1: a Tinker’s Desk recipe is gated with what to study, and the gate wins over materials', () => {
  const st = { seen: [], learned: [], all: false };
  const g = SR.studyGate(st, 'cup');
  assert.equal(g.locked, true);
  assert.match(g.reason, /^Study Plastic at a Tinker’s Desk$/);
  assert.equal(SR.studyGate(st, 'hook'), null, 'starter recipes are never gated');
  assert.equal(SR.studyGate(st, 'nope'), null);
  assert.equal(SR.studyGate({ seen: ['plastic'], learned: ['cup'], all: false }, 'cup'), null, 'learned: no gate');
  const rows = CB.ingredientRows([{ kind: 'plastic', count: 1 }], () => 10);
  assert.equal(CB.recipeState(rows, null), 'ready');
  assert.equal(CB.recipeState(rows, null, g), 'gated', 'enough plastic, still locked');
  assert.equal(CB.recipeState(rows, null, null), 'ready');
});

test('CRAFT-2: the pinned tracker shares the book state, so a gated recipe never reads ready', () => {
  const bolt = { id: 'bolt', name: 'Bolt', out: { kind: 'bolt', count: 1 }, reqs: [{ kind: 'metalingot', count: 1 }, { kind: 'scrap', count: 1 }] };
  const count = () => 2, lock = { locked: true, reason: 'Research Metal Ingot at a Research Table' };
  const open = CB.trackerView(bolt, count, null);
  assert.equal(open.state, 'ready');
  assert.equal(open.reason, '');
  const tv = CB.trackerView(bolt, count, null, lock);
  assert.equal(tv.state, 'gated');
  assert.equal(tv.reason, lock.reason);
  assert.equal(tv.met, 2, 'materials still shown');
});
