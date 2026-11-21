// Unit tests for the crafting-panel UX helpers in craft-book.js: craftable-first order,
// hold count preview, item sources and the pinned recipe tracker.
// Run: node --test tests/craft-ux.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const CB = await import(new URL('craft-book.js', base));
const { RECIPES, ITEM_INFO, Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));

const normRecipes = () => Object.values(RECIPES).map(r => ({
  id: r.id, name: r.name, out: { ...r.output }, reqs: Object.entries(r.cost).map(([kind, count]) => ({ kind, count })),
}));
const bagWith = counts => {
  const s = new Array(SLOT_COUNT).fill(null);
  Object.entries(counts).forEach(([kind, count], i) => { s[i] = { kind, count }; });
  return new Bag({ slots: s, selected: 0 });
};
const viewsFor = (bag, recipes) => recipes.map(r => {
  const rows = CB.ingredientRows(r.reqs, k => bag.count(k));
  return { id: r.id, rows, state: CB.recipeState(rows, bag.canCraft(r.id)) };
});

test('sortCraftableFirst: ready, then full, then closest-to-done missing', () => {
  const row = (need, have) => ({ need, have, enough: have >= need, short: Math.max(0, need - have) });
  const views = [
    { id: 'far', state: 'missing', rows: [row(4, 0), row(3, 0)] },
    { id: 'near', state: 'missing', rows: [row(4, 3), row(3, 3)] },
    { id: 'full', state: 'full', rows: [row(1, 1)] },
    { id: 'ready1', state: 'ready', rows: [row(1, 5)] },
    { id: 'nearer', state: 'missing', rows: [row(9, 0), row(1, 1)] },
    { id: 'ready2', state: 'ready', rows: [] },
  ];
  const ids = CB.sortCraftableFirst(views).map(v => v.id);
  assert.deepEqual(ids, ['ready1', 'ready2', 'full', 'near', 'nearer', 'far']);
  assert.equal(views[0].id, 'far', 'input array untouched');
  assert.deepEqual(CB.sortCraftableFirst(null), []);
  assert.deepEqual(CB.sortCraftableFirst([{ id: 'x' }, { id: 'y', state: 'ready' }]).map(v => v.id), ['y', 'x']);
});

test('sortCraftableFirst: the building tab puts what wood alone makes above the sail', () => {
  const recipes = CB.groupRecipes(normRecipes(), ITEM_INFO).find(g => g.id === 'building').recipes;
  assert.equal(recipes[0].id, 'sail', 'book order starts with the sail');
  const bag = bagWith({ wood: 9, scrap: 1, leaf: 7, rope: 2 });
  const ids = CB.sortCraftableFirst(viewsFor(bag, recipes)).map(v => v.id);
  assert.deepEqual(ids, ['bench', 'crate', 'sail']);
  // With nothing at all, book order is kept apart from the closest-to-done rule.
  const none = CB.sortCraftableFirst(viewsFor(bagWith({}), recipes)).map(v => v.id);
  assert.deepEqual(none, ['bench', 'crate', 'sail'], 'bench needs 1 kind, crate 2, sail 3');
});

test('holdHint previews how many a hold makes, capped', () => {
  assert.equal(CB.holdHint(0), '');
  assert.equal(CB.holdHint(1), '');
  assert.equal(CB.holdHint(4), 'hold: up to 4');
  assert.equal(CB.holdHint(4.9), 'hold: up to 4');
  assert.equal(CB.holdHint(500), `hold: up to ${CB.HOLD.max}`);
  assert.equal(CB.holdHint(Infinity), `hold: up to ${CB.HOLD.max}`);
  assert.equal(CB.holdHint(7, 5), 'hold: up to 5');
});

test('sourceOf: gathered items say where they float, crafted ones link to their recipe', () => {
  const recipes = normRecipes();
  const name = k => ITEM_INFO[k]?.name ?? k;
  assert.deepEqual(CB.sourceOf('wood', recipes, name), { tag: 'found floating', how: CB.ITEM_SOURCE.wood.how, recipe: null });
  assert.match(CB.sourceOf('leaf', recipes, name).tag, /palm/);
  const rope = CB.sourceOf('rope', recipes, name);
  assert.equal(rope.recipe, 'rope');
  assert.equal(rope.tag, 'craft it');
  assert.equal(rope.how, 'Craft it from 2 Palm Leaf.');
  assert.equal(CB.sourceOf('hammer', recipes, name).how, 'Craft it from 4 Wood + 2 Rope.');
  assert.equal(CB.sourceOf('mystery', recipes, name), null);
  assert.equal(CB.sourceOf('wood', null).recipe, null);
});

const memStore = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m };
};

test('pin storage: round-trips, clears, drops unknown ids and survives broken storage', () => {
  const s = memStore();
  assert.equal(CB.loadPin(s), null);
  assert.equal(CB.savePin(s, 'fishingrod'), true);
  assert.equal(s.m.get(CB.PIN_KEY), 'fishingrod');
  assert.equal(CB.loadPin(s, Object.keys(RECIPES)), 'fishingrod');
  assert.equal(CB.loadPin(s, ['rope']), null, 'a recipe that no longer exists is not pinned');
  assert.equal(CB.savePin(s, null), true);
  assert.equal(CB.loadPin(s), null);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(CB.loadPin(broken), null);
  assert.equal(CB.savePin(broken, 'rope'), false);
  assert.equal(CB.savePin(null, 'rope'), false);
  assert.equal(CB.loadPin(undefined), null);
});

test('trackerView: owned/needed rows, progress and readiness for the pinned recipe', () => {
  const rod = normRecipes().find(r => r.id === 'fishingrod');
  const bag = bagWith({ wood: 9, rope: 2 });
  const tv = CB.trackerView(rod, k => bag.count(k), bag.canCraft('fishingrod'));
  assert.equal(tv.id, 'fishingrod');
  assert.equal(tv.name, 'Fishing Rod');
  assert.equal(tv.kind, 'fishingrod');
  assert.equal(tv.state, 'missing');
  assert.equal(tv.met, 1);
  assert.equal(tv.total, 2);
  assert.equal(tv.times, 0);
  assert.deepEqual(tv.rows.map(r => CB.amountLabel(r)), ['9 / 6', '2 / 8']);
  assert.deepEqual(tv.rows.map(r => r.enough), [true, false]);
  const rich = bagWith({ wood: 20, rope: 17 });
  const ok = CB.trackerView(rod, k => rich.count(k), rich.canCraft('fishingrod'));
  assert.equal(ok.state, 'ready');
  assert.equal(ok.times, 2);
  assert.equal(ok.met, ok.total);
  assert.equal(CB.trackerView(null, () => 0), null);
  assert.equal(CB.trackerView({ id: 'free', name: 'Free', reqs: [] }, () => 0).times, 0, 'no ingredients is not infinite');
});

test('sourceOf: every item and recipe ingredient has a source the player can act on', () => {
  const recipes = normRecipes();
  for (const r of recipes) for (const q of r.reqs) {
    const s = CB.sourceOf(q.kind, recipes);
    assert.ok(s && s.tag && s.how, `${q.kind} (in ${r.id}) has a source`);
  }
  for (const k of Object.keys(ITEM_INFO)) assert.ok(CB.sourceOf(k, recipes), `${k} has a source`);
});
