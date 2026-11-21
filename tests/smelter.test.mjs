// Unit tests for the station cooking model (dist/smelter.js) with injected fixtures.
// Run: node --test tests/smelter.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { StationModel } = await import(new URL('smelter.js', base));

const items = {
  wood: { id: 'wood', stack: 20, recipe: null },
  leaf: { id: 'leaf', stack: 20, recipe: null },
  metalore: { id: 'metalore', stack: 20, recipe: null },
  clay: { id: 'clay', stack: 20, recipe: null },
  sand: { id: 'sand', stack: 20, recipe: null },
  fish: { id: 'fish', stack: 10, recipe: null },
  metal: { id: 'metal', stack: 20, recipe: { cost: { metalore: 1 }, count: 1, station: 'smelter', time: 10, fuel: 2 } },
  brick: { id: 'brick', stack: 4, recipe: { cost: { clay: 1 }, count: 1, station: 'smelter', time: 5, fuel: 1 } },
  glass: { id: 'glass', stack: 20, recipe: { cost: { sand: 2 }, count: 1, station: 'smelter', time: 4, fuel: 1 } },
  cookedfish: { id: 'cookedfish', stack: 10, recipe: { cost: { fish: 1 }, count: 1, station: 'grill', time: 3, fuel: 0.5 } },
  rope: { id: 'rope', stack: 20, recipe: { cost: { leaf: 2 }, count: 1, station: null } },
};
const fuelValue = { wood: 2, leaf: 0.5 };
const mk = (id = 'smelter', snap = null) => new StationModel(id, snap, { items, fuelValue });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('recipeFor / accepts / wrong kind rejected', () => {
  const s = mk();
  assert.equal(s.recipeFor('metalore').kind, 'metal');
  assert.equal(s.recipeFor('fish'), null); // grill recipe, not smelter
  assert.equal(s.recipeFor('leaf'), null); // hand recipe
  assert.equal(s.insert('wood', 3), 0);
  assert.equal(s.insert('metalore', 3), 3);
  assert.equal(s.accepts('clay'), false); // different kind already in
  assert.equal(s.insert('clay', 1), 0);
  assert.equal(s.insert('metalore', 50), 17); // capped at stack
  assert.equal(s.addFuel('metalore', 1), 0); // not fuel
  assert.equal(s.addFuel('wood', 9), 5); // 10 unit cap / 2 per wood
  assert.equal(s.fuelUnits, 10);
});

test('cooking timing and fraction', () => {
  const s = mk();
  s.insert('metalore', 2);
  assert.equal(s.cooking, false);
  s.addFuel('wood', 5);
  assert.equal(s.cooking, true);
  assert.deepEqual(s.tick(4), []);
  near(s.fraction, 0.4);
  near(s.fuelUnits, 10 - 0.8);
  assert.deepEqual(s.tick(6), [{ type: 'done', kind: 'metal', count: 1 }]);
  assert.deepEqual(s.output, { kind: 'metal', count: 1 });
  assert.equal(s.input.count, 1);
  near(s.fuelUnits, 8);
  near(s.fraction, 0);
});

test('fuel starvation pauses and resumes without losing progress', () => {
  const s = mk();
  s.insert('metalore', 1);
  s.addFuel('leaf', 1); // 0.5 units -> 2.5 s of burn
  const ev = s.tick(5);
  assert.deepEqual(ev, [{ type: 'starved' }]);
  near(s.progress, 2.5);
  assert.equal(s.fuelUnits, 0);
  assert.equal(s.cooking, false);
  assert.deepEqual(s.tick(100), []); // no repeat event, no progress
  near(s.progress, 2.5);
  s.addFuel('wood', 1);
  assert.deepEqual(s.tick(7.5), [{ type: 'done', kind: 'metal', count: 1 }]);
  near(s.fuelUnits, 0.5);
  assert.equal(s.input, null);
});

test('large dt finishes multiple items exactly and deterministically', () => {
  const run = (steps) => {
    const s = mk();
    s.insert('metalore', 7);
    s.addFuel('wood', 5); // 10 units = 5 items
    const ev = [];
    for (const dt of steps) ev.push(...s.tick(dt));
    return { s, ev };
  };
  const a = run([1000]);
  assert.deepEqual(a.ev, [{ type: 'done', kind: 'metal', count: 5 }, { type: 'starved' }]);
  assert.deepEqual(a.s.output, { kind: 'metal', count: 5 });
  assert.equal(a.s.input.count, 2);
  assert.equal(a.s.fuelUnits, 0);
  near(a.s.progress, 0);
  const b = run(new Array(500).fill(0.1));
  assert.deepEqual(b.s.output, a.s.output);
  assert.equal(b.s.input.count, 2);
  near(b.s.progress, 0);
  assert.deepEqual(run([1000]).s.snapshot(), a.s.snapshot());
});

test('multi-unit input cost (2 sand -> 1 glass) leaves remainder idle', () => {
  const s = mk();
  s.insert('sand', 5);
  s.addFuel('wood', 5);
  assert.deepEqual(s.tick(100), [{ type: 'done', kind: 'glass', count: 2 }]);
  assert.deepEqual(s.input, { kind: 'sand', count: 1 });
  assert.equal(s.cooking, false);
  near(s.fuelUnits, 8);
});

test('output blocked when full or a different kind', () => {
  const s = mk('smelter', { output: { kind: 'brick', count: 3 }, fuel: 10 });
  s.insert('clay', 3);
  assert.deepEqual(s.tick(100), [{ type: 'done', kind: 'brick', count: 1 }, { type: 'blocked' }]);
  assert.equal(s.output.count, 4);
  assert.equal(s.input.count, 2);
  near(s.fuelUnits, 9);
  assert.deepEqual(s.tick(10), []);
  assert.deepEqual(s.takeOutput(), { kind: 'brick', count: 4 });
  assert.equal(s.cooking, true);
  s.tick(5);
  assert.equal(s.output.count, 1);

  const d = mk('smelter', { output: { kind: 'metal', count: 1 }, fuel: 10 });
  d.insert('clay', 1);
  assert.deepEqual(d.tick(10), [{ type: 'blocked' }]);
  assert.equal(d.fuelUnits, 10);
  near(d.progress, 0);
});

test('takeInput returns stack and resets progress', () => {
  const s = mk();
  s.insert('metalore', 2);
  s.addFuel('wood', 1);
  s.tick(3);
  assert.deepEqual(s.takeInput(), { kind: 'metalore', count: 2 });
  assert.equal(s.progress, 0);
  assert.equal(s.input, null);
  assert.equal(s.fraction, 0);
});

test('snapshot round trip and junk tolerance', () => {
  const s = mk();
  s.insert('metalore', 4);
  s.addFuel('wood', 3);
  s.tick(13);
  const snap = JSON.parse(JSON.stringify(s.snapshot()));
  const r = mk('smelter', snap);
  assert.deepEqual(r.snapshot(), s.snapshot());
  assert.deepEqual(r.tick(50), s.tick(50));
  assert.deepEqual(r.snapshot(), s.snapshot());

  for (const junk of [null, 42, 'x', [], { input: 'a', output: 7, fuel: 'z', progress: NaN },
    { input: { kind: 'nope', count: 3 }, output: { kind: 'metal', count: -2 }, fuel: Infinity, progress: -5 }]) {
    const j = mk('smelter', junk);
    assert.equal(j.input, null);
    assert.equal(j.output, null);
    assert.ok(j.fuelUnits >= 0 && j.fuelUnits <= 10);
    assert.equal(j.progress, 0);
    assert.deepEqual(j.tick(1), []);
  }
  const c = mk('smelter', { input: { kind: 'clay', count: 99.7 }, output: { kind: 'brick', count: 50 }, fuel: 99, progress: 99 });
  assert.deepEqual(c.input, { kind: 'clay', count: 20 });
  assert.deepEqual(c.output, { kind: 'brick', count: 4 });
  assert.equal(c.fuelUnits, 10);
  assert.equal(c.progress, 5);
  assert.equal(mk('smelter', { input: { kind: 'fish', count: 2 } }).input, null); // grill input in smelter
});

test('grill works with the same model', () => {
  const g = mk('grill');
  assert.equal(g.insert('metalore', 1), 0);
  assert.equal(g.insert('fish', 3), 3);
  g.addFuel('leaf', 2); // 1 unit -> 2 fish
  assert.deepEqual(g.tick(60), [{ type: 'done', kind: 'cookedfish', count: 2 }, { type: 'starved' }]);
  assert.equal(g.input.count, 1);
  assert.equal(g.output.count, 2);
});

test('the real grill burns planks only, holds 2, and 1 plank cooks 50 s (Raft)', () => {
  const g = new StationModel('grill');
  assert.equal(g.fuelCap, 2);
  assert.equal(g.addFuel('leaf', 1), 0);
  assert.equal(g.addFuel('wood', 5), 2);
  assert.equal(g.insert('drumstick', 5), 5);
  const r = g.recipeFor('drumstick');
  assert.ok(Math.abs(r.fuel / r.time * 50 - 1) < 1e-9, '1 plank = 50 s');
  g.tick(100); // two planks = 100 s = five 20 s drumsticks
  assert.equal(g.output.count, 5);
  assert.ok(g.fuelUnits < 1e-6);
  assert.equal(new StationModel('smelter').fuelCap, 10);
});
