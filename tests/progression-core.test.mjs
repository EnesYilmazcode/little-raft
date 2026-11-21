// Unit tests for dist/progression.js using injected item fixtures.
// Run: node --test tests/progression-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { Progression, canCraft, craft } = await import(new URL('progression.js', base));

// Fixture kinds are ones the Bag already knows so crafting runs end to end.
const it = (id, name, unlock, recipe = null, extra = {}) => ({ id, name, unlock, recipe, tool: false, ...extra });
const START = { type: 'start' };
const FX = Object.freeze({
  wood: it('wood', 'Plank', START),
  leaf: it('leaf', 'Palm Leaf', START),
  plastic: it('plastic', 'Plastic', START),
  scrap: it('scrap', 'Scrap', START),
  rope: it('rope', 'Rope', START, { cost: { leaf: 2 }, count: 1, station: null }),
  hook: it('hook', 'Hook', START, { cost: { wood: 1, plastic: 2 }, count: 1, station: null }, { tool: true }),
  researchtable: it('researchtable', 'Research Table', START),
  lantern: it('lantern', 'Lantern', { type: 'discover', items: ['scrap'] }, { cost: { wood: 2, scrap: 2 }, count: 1, station: null }),
  net: it('net', 'Net', { type: 'research', items: ['rope', 'scrap'] }, { cost: { wood: 3, rope: 3 }, count: 1, station: null }),
  smelter: it('smelter', 'Smelter', { type: 'discover', items: ['scrap', 'plastic'] }),
  sail: it('sail', 'Sail', { type: 'station', station: 'smelter' }, { cost: { wood: 4 }, count: 1, station: null }),
  fishingrod: it('fishingrod', 'Fishing Rod', START, { cost: { wood: 6 }, count: 1, station: 'smelter' }, { tool: true }),
});
const prog = (snap = null) => new Progression(snap, { items: FX });
const bagFrom = (slots) => {
  const s = new Array(SLOT_COUNT).fill(null);
  slots.forEach((v, i) => { s[i] = v; });
  return new Bag({ slots: s, selected: 0 });
};
const OPTS = { items: FX };

test('start items are always unlocked; others are not', () => {
  const p = prog();
  for (const id of ['wood', 'rope', 'hook', 'researchtable', 'fishingrod']) assert.ok(p.isUnlocked(id), id);
  for (const id of ['lantern', 'net', 'smelter', 'sail']) assert.ok(!p.isUnlocked(id), id);
  assert.ok(!p.isUnlocked('nonsense'));
  assert.deepEqual(p.available(), ['wood', 'leaf', 'plastic', 'scrap', 'rope', 'hook', 'researchtable', 'fishingrod']);
});

test('discover unlock fires once all listed items were ever held (counts, arrays, Bag)', () => {
  const p = prog();
  assert.deepEqual(p.noteItems({ scrap: 0, wood: 3 }), []);
  assert.deepEqual(p.noteItems(['scrap', 'bogus']), ['lantern']);
  assert.ok(p.isUnlocked('lantern') && !p.isUnlocked('smelter'));
  assert.deepEqual(p.noteItems(bagFrom([{ kind: 'plastic', count: 1 }])), ['smelter']);
  assert.deepEqual(p.noteItems(['scrap', 'plastic']), [], 'no repeat unlocks');
  assert.ok(!p.discovered.has('bogus'));
});

test('research needs a placed Research Table and ownership, unlocks, never consumes', () => {
  const p = prog();
  const bag = bagFrom([{ kind: 'rope', count: 1 }, { kind: 'scrap', count: 2 }]);
  let r = p.research('rope', { has: bag });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'Build a Research Table first');
  assert.deepEqual(p.notePlaced('researchtable'), []);
  r = p.research('leaf', { has: bag });
  assert.equal(r.ok, false);
  assert.match(r.reason, /need a Palm Leaf/);
  r = p.research('rope', { has: bag });
  assert.deepEqual(r, { ok: true, unlocked: [], reason: '' });
  assert.equal(p.research('rope', { has: bag }).ok, false, 'already researched');
  r = p.research('scrap', bag);
  assert.equal(r.ok, true);
  assert.deepEqual(r.unlocked, ['lantern', 'net'], 'research also discovers');
  assert.equal(bag.count('rope'), 1);
  assert.equal(bag.count('scrap'), 2);
  assert.ok(p.research('wood', { has: (k) => k === 'wood' }).ok, 'predicate form');
});

test('station unlock when the station is placed', () => {
  const p = prog();
  assert.ok(!p.isUnlocked('sail'));
  assert.deepEqual(p.notePlaced('smelter'), ['sail']);
  assert.ok(p.isUnlocked('sail'));
  assert.deepEqual(p.notePlaced('nope'), []);
});

test('whyLocked gives friendly text', () => {
  const p = prog();
  assert.equal(p.whyLocked('lantern'), 'Find Scrap first');
  assert.equal(p.whyLocked('smelter'), 'Find Scrap and Plastic first');
  assert.equal(p.whyLocked('net'), 'Research Rope and Scrap at a Research Table');
  assert.equal(p.whyLocked('sail'), 'Build a Smelter');
  assert.equal(p.whyLocked('wood'), '');
  assert.equal(p.whyLocked('zzz'), 'Unknown item');
  p.notePlaced('researchtable');
  p.research('rope', { has: ['rope'] });
  assert.equal(p.whyLocked('net'), 'Research Scrap at a Research Table');
});

test('nextGoals ranks locked items by fewest missing requirements, then table order', () => {
  const p = prog();
  assert.deepEqual(p.nextGoals(10), ['lantern', 'sail', 'net', 'smelter']);
  p.noteItems(['plastic']);
  assert.deepEqual(p.nextGoals(2), ['lantern', 'smelter']);
  assert.deepEqual(p.nextGoals(0), []);
});

test('researchable lists discovered kinds that feed a locked research item', () => {
  const p = prog();
  p.noteItems(['rope', 'wood', 'scrap']);
  assert.deepEqual(p.researchable(), ['rope', 'scrap']);
  p.notePlaced('researchtable');
  p.research('rope', { has: true });
  assert.deepEqual(p.researchable(), ['scrap']);
  p.research('scrap', { has: true });
  assert.deepEqual(p.researchable(), []);
});

test('snapshot round-trips and junk snapshots load empty', () => {
  const p = prog();
  p.noteItems(['scrap', 'plastic']);
  p.notePlaced('researchtable');
  p.research('rope', { has: true });
  const snap = JSON.parse(JSON.stringify(p.snapshot()));
  const q = prog(snap);
  assert.deepEqual(q.snapshot(), snap);
  assert.ok(q.isUnlocked('lantern') && q.isUnlocked('smelter'));
  for (const junk of [null, 42, 'x', [], { discovered: 'scrap' }, { discovered: [1, null, {}, 'ghost'] }]) {
    const j = prog(junk);
    assert.deepEqual(j.snapshot(), { discovered: [], researched: [], learned: [], stations: [] }, JSON.stringify(junk));
  }
  // learned is sticky even if requirements vanish from a later snapshot.
  assert.ok(prog({ learned: ['net'] }).isUnlocked('net'));
});

test('craft: missing materials changes nothing', () => {
  const bag = bagFrom([{ kind: 'wood', count: 1 }, { kind: 'plastic', count: 1 }]);
  const before = JSON.stringify(bag.snapshot());
  const c = canCraft(bag, 'hook', prog(), OPTS);
  assert.equal(c.ok, false);
  assert.deepEqual(c.missing, [{ kind: 'plastic', count: 1 }]);
  assert.equal(c.reason, 'Need 1 Plastic');
  const r = craft(bag, 'hook', prog(), OPTS);
  assert.equal(r.ok, false);
  assert.equal(r.why, 'missing');
  assert.equal(JSON.stringify(bag.snapshot()), before);
});

test('craft: full bag refuses atomically', () => {
  const slots = new Array(SLOT_COUNT).fill(null).map(() => ({ kind: 'wood', count: 20 }));
  slots[0] = { kind: 'leaf', count: 20 };
  slots[1] = { kind: 'plastic', count: 20 };
  const bag = new Bag({ slots, selected: 0 });
  const before = JSON.stringify(bag.snapshot());
  const r = craft(bag, 'hook', prog(), OPTS);
  assert.equal(r.ok, false);
  assert.equal(r.full, true);
  assert.equal(r.why, 'full');
  assert.equal(JSON.stringify(bag.snapshot()), before);
});

test('craft: locked recipe refused with lock reason', () => {
  const bag = bagFrom([{ kind: 'wood', count: 5 }, { kind: 'scrap', count: 5 }]);
  const r = craft(bag, 'lantern', prog(), OPTS);
  assert.equal(r.ok, false);
  assert.equal(r.locked, true);
  assert.equal(r.why, 'locked');
  assert.equal(r.reason, 'Find Scrap first');
  assert.equal(bag.count('wood'), 5);
  assert.equal(canCraft(bag, 'wood', prog(), OPTS).reason, 'Cannot be crafted');
});

test('craft: success consumes cost in place, gives full-durability tool, notes discovery', () => {
  const bag = bagFrom([{ kind: 'wood', count: 3 }, { kind: 'plastic', count: 2 }]);
  const slotsRef = bag.slots;
  const p = prog();
  const r = craft(bag, 'hook', p, OPTS);
  assert.equal(r.ok, true);
  assert.deepEqual(r.crafted, { kind: 'hook', count: 1 });
  assert.equal(bag.slots, slotsRef, 'slots array kept');
  assert.equal(bag.count('wood'), 2);
  assert.equal(bag.count('plastic'), 0);
  assert.equal(bag.slots.find((s) => s && s.kind === 'hook').durability, 100);
  assert.ok(p.discovered.has('hook'));
  // Without a Progression everything is treated as unlocked.
  bag.add('scrap', 2);
  assert.equal(craft(bag, 'lantern', null, OPTS).ok, true);
});

test('station recipes need opts.near to include that station', () => {
  const bag = bagFrom([{ kind: 'wood', count: 10 }]);
  const p = prog();
  let r = craft(bag, 'fishingrod', p, OPTS);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'Use a Smelter');
  assert.equal(bag.count('wood'), 10);
  assert.equal(craft(bag, 'fishingrod', p, { ...OPTS, near: new Set(['grill']) }).ok, false);
  r = craft(bag, 'fishingrod', p, { ...OPTS, near: new Set(['smelter']) });
  assert.equal(r.ok, true);
  assert.equal(bag.count('wood'), 4);
  assert.equal(bag.count('fishingrod'), 1);
});
