// Regression tests for hook fixes: repair picks the worn hook, a hook thrown at the deck stops on it.
// Run: node --test tests/hook-fixes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { HookCast, WATER_Y } = await import(new URL('hook-physics.js', base));
const { repairHookSlot } = await import(new URL('coop-rules.js', base));

const hook = d => ({ kind: 'hook', count: 1, durability: d });
const hammer = { kind: 'hammer', count: 1, durability: 100 };

test('repairHookSlot: a non-hook selection repairs the most worn hook, not the first', () => {
  assert.equal(repairHookSlot([hook(100), hook(40), hammer], 2, 100), 1);
  assert.equal(repairHookSlot([hook(70), null, hook(20), hook(50)], 1, 100), 2);
});

test('repairHookSlot: a selected hook is repaired even if another is more worn', () => {
  assert.equal(repairHookSlot([hook(10), hook(90)], 1, 100), 1);
});

test('repairHookSlot: all hooks full gives the first hook; no hook gives -1', () => {
  assert.equal(repairHookSlot([hammer, hook(100), { kind: 'hook', count: 1 }], 0, 100), 1);
  assert.equal(repairHookSlot([hammer, null], 0, 100), -1);
  assert.equal(repairHookSlot(null, 0, 100), -1);
});

// One 2 m tile at the origin; deck top at 0.2 (FLOOR_Y on a raft at y 0).
const DECK = 0.2;
const deckAt = (x, z) => (Math.round(x / 2) === 0 && Math.round(z / 2) === 0 ? DECK : null);
const run = (cast, seconds = 3) => {
  const events = [];
  for (let t = 0; t < seconds && cast.stage !== 'done'; t += 1 / 60) {
    const ev = cast.update(1 / 60, { hand: { x: 0, y: 1.45, z: 0.6 }, items: [], time: t });
    if (ev) events.push(ev);
  }
  return events;
};

// Merged behaviour (raft-integration deck landing): the hook rests on the planks as a floating hook
// instead of ending the cast at once; reeling brings it home and only then reports 'returned'.
test('HookCast: a throw at your feet stops on the deck instead of sinking under the tiles', () => {
  for (const charge of [0.15, 1]) {
    const cast = new HookCast(T, { origin: { x: 0, y: 1.45, z: 0.6 }, direction: { x: 0, y: -0.95, z: -0.3 }, charge, deckAt });
    const events = run(cast, 1);
    assert.equal(cast.onDeck, true);
    assert.equal(cast.stage, 'floating');
    assert.ok(Math.abs(cast.position.y - DECK) < 1e-9, `hook y ${cast.position.y}`);
    assert.ok(deckAt(cast.position.x, cast.position.z) !== null, 'stopped over the tile');
    assert.deepEqual(events, []);
    const reeled = [];
    for (let i = 0; i < 300 && cast.stage !== 'done'; i++) { const ev = cast.update(1 / 60, { hand: { x: 0, y: 1.45, z: 0.6 }, items: [], reeling: true }); if (ev) reeled.push(ev); }
    assert.equal(cast.stage, 'done');
    assert.deepEqual(reeled, [{ kind: 'returned' }]);
    assert.equal(cast.update(1 / 60, { items: [] }), null);
  }
});

test('HookCast: without deckAt the old behaviour is unchanged (lands in the water)', () => {
  const cast = new HookCast(T, { origin: { x: 0, y: 1.45, z: 0.6 }, direction: { x: 0, y: -0.95, z: -0.3 }, charge: 0.15 });
  for (let i = 0; i < 60 && cast.stage === 'flying'; i++) cast.update(1 / 60, { items: [] });
  assert.equal(cast.onDeck, false);
  assert.equal(cast.stage, 'floating');
  assert.equal(cast.landing.y, WATER_Y);
});

test('HookCast: a level throw clears the raft and splashes in open water', () => {
  const cast = new HookCast(T, { origin: { x: 0, y: 1.45, z: 0.6 }, direction: { x: 0, y: 0, z: -1 }, charge: 0.5, deckAt });
  for (let i = 0; i < 300 && cast.stage === 'flying'; i++) cast.update(1 / 60, { items: [] });
  assert.equal(cast.onDeck, false);
  assert.equal(cast.stage, 'floating');
  assert.equal(deckAt(cast.landing.x, cast.landing.z), null);
});

test('HookCast: packed xz positions give the same casts, catches and rope as reading item objects', () => {
  let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let caughtAny = 0;
  for (let run = 0; run < 60; run++) {
    const items = Array.from({ length: 40 }, (_, i) => ({ id: i, token: 't' + i, type: 'wood', x: (rnd() - .5) * 30, z: -rnd() * 25 }));
    if (run % 4 === 0) { items[3].x = NaN; items[5].z = undefined; items[7] = null; }
    const opts = { origin: { x: 0, y: 1.2, z: 0 }, direction: { x: rnd() - .5, y: rnd() * .8, z: -1 }, charge: rnd(), maxRange: 10 + rnd() * 20, deckAt };
    const a = new HookCast(T, opts), b = new HookCast(T, opts);
    const xz = new Float64Array(items.length * 2);
    const hand = { x: 0, y: 1.2, z: 0 }, ra = [], rb = [];
    for (let f = 0; f < 400; f++) {
      const reeling = f > 150 && f % 90 < 70, dt = 1 / 60 + (f % 7) * .003;
      for (const it of items) if (it && typeof it.x === 'number') { it.z += dt * .22; it.x += Math.sin(f * .01) * dt * .04; }
      items.forEach((it, i) => { xz[2 * i] = it && typeof it.x === 'number' ? it.x : NaN; xz[2 * i + 1] = it && typeof it.z === 'number' ? it.z : NaN; });
      const ea = a.update(dt, { hand, items, reeling, time: f * dt });
      const eb = b.update(dt, { hand, items, xz, reeling, time: f * dt });
      assert.deepEqual(eb, ea);
      assert.deepEqual(b.caughtItems, a.caughtItems);
      assert.deepEqual([b.position.x, b.position.y, b.position.z, b.stage, b.tension], [a.position.x, a.position.y, a.position.z, a.stage, a.tension]);
      const pa = a.ropePoints(hand, 16, ra), pb = b.ropePoints(hand, 16, rb);
      assert.deepEqual(pb.map(v => [v.x, v.y, v.z]), pa.map(v => [v.x, v.y, v.z]));
      if (a.stage === 'done') { caughtAny += a.caughtItems.length; break; }
    }
  }
  assert.ok(caughtAny > 0, 'the scenario actually catches items');
});
