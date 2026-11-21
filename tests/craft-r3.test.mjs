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

const { progressionGate } = await import(new URL('progression-hooks.js', base));
const { Progression } = await import(new URL('progression.js', base));
const { RECIPES } = await import(new URL('inventory-state.js', base));

test('CRAFT-3: every locked recipe stays in the book with its reason; the smelter sorts before the bee items', () => {
  const p = new Progression();
  p.noteItems(['wood', 'leaf', 'plastic', 'scrap', 'rope', 'nail', 'fish', 'clay', 'stone']); p.notePlaced('researchtable'); p.notePlaced('grill');
  p.research('clay', { has: true });
  const locked = Object.keys(RECIPES).map(id => [id, progressionGate(p, id)]).filter(([, g]) => g);
  for (const [id, g] of locked) { assert.equal(g.locked, true, id); assert.ok(!g.hidden, id + ' is never hidden'); assert.ok(g.reason, id + ' says why'); }
  const ids = locked.map(([id]) => id);
  for (const id of ['smelter', 'hinge', 'metalhook', 'binoculars', 'bolt', 'beehive', 'candle']) assert.ok(ids.includes(id), id + ' shown greyed');
  assert.match(progressionGate(p, 'smelter').reason, /Research Stone/);
  assert.equal(progressionGate(p, 'rope'), null, 'unlocked: no gate');
  assert.equal(progressionGate(p, 'cup'), null, 'not an items.js recipe');
  // Book order inside a tab: ready, then missing materials, then gated (nearest unlock, then plan order).
  const views = [
    { id: 'beehive', state: 'gated', rank: progressionGate(p, 'beehive').rank },
    { id: 'smelter', state: 'gated', rank: progressionGate(p, 'smelter').rank },
    { id: 'bench', state: 'missing', rows: [{ enough: false, short: 3 }] },
    { id: 'purifier', state: 'gated', rank: SR.studyGate({ seen: [], learned: [], all: false }, 'purifier').rank },
    { id: 'raftpiece', state: 'ready', rows: [] },
  ];
  assert.deepEqual(CB.sortCraftableFirst(views).map(v => v.id), ['raftpiece', 'bench', 'smelter', 'beehive', 'purifier']);
});

const { readFile } = await import('node:fs/promises');
const src = async f => readFile(new URL(f, base), 'utf8');

test('CRAFT-6: the locked section is a real header row, not a ::before squeezed into the 3px ready stripe', async () => {
  const sr = await src('storage-research-ui.js'), sv = await src('survival-ui.js');
  assert.doesNotMatch(sr, /\.sv-recipe[^{]*::before/, 'no pseudo-element header on recipe rows');
  assert.doesNotMatch(sr, /data-locked\]?\{[^}]*pointer-events:none/, 'locked rows stay selectable so the cost and reason can be read');
  assert.match(sv, /className = 'sv-rsection'/);
  assert.match(sv, /#inventory \.sv-recipe::before\{[^}]*width:3px/, 'the ready stripe is untouched');
});

test('CRAFT-5: the Receiver uses its compass sprite instead of a blank placeholder tile', async () => {
  const { ITEM_INFO } = await import(new URL('inventory-state.js', base));
  assert.equal(ITEM_INFO.receiver.placeholder, false);
  assert.match(await src('icons.svg'), new RegExp(`id="${ITEM_INFO.receiver.icon}"`));
});
