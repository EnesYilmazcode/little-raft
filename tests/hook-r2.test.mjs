// Round-2 hook regressions: full-bag reel stop, throws while swimming, a catch landing on the deck.
// Run: node --test tests/hook-r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const HP = await import(new URL('hook-physics.js', base));
const { HookCast, WATER_Y, catchLoot, holdForFullBag, FULL_HOLD_DIST, throwOrigin, MIN_THROW_Y } = HP;

const hand = new T.Vector3(0, 1.2, 0);
// A hook already floating 8 m out with one barrel caught.
function floatingCatch() {
  const h = new HookCast(T, { origin: { x: 0, y: WATER_Y, z: -8 }, direction: { x: 0, y: 0, z: -1 }, drift: { x: 0, z: 0 } });
  const items = [{ id: 1, token: 'a', type: 'barrel', x: 0, z: -8 }];
  h.update(0.02, { hand, items, time: 0 });
  assert.equal(h.caughtItems.length, 1);
  return { h, items };
}
function reel(h, items, fits, secs = 5) {
  let ev = null;
  for (let t = 0; t < secs && h.stage !== 'done'; t += 0.05) {
    const hold = holdForFullBag(h, fits);
    ev = h.update(0.05, { hand, items, reeling: !hold, time: t }) ?? ev;
  }
  return ev;
}

test('HOOK-1: catchLoot sums the loot of the whole catch', () => {
  const table = { wood: { wood: 2 }, barrel: { wood: 3, leaf: 2 } };
  assert.deepEqual(catchLoot([{ type: 'wood' }, { type: 'barrel' }, { type: 'nope' }], table), { wood: 5, leaf: 2 });
  assert.deepEqual(catchLoot(null, table), {});
});

test('HOOK-1: with a full bag the reel stops short and keeps the catch on the hook', () => {
  const { h, items } = floatingCatch();
  const ev = reel(h, items, () => false);
  assert.equal(ev, null, 'no collect is sent');
  assert.notEqual(h.stage, 'done');
  assert.equal(h.caughtItems.length, 1, 'catch stays on the hook');
  assert.ok(h.distance > 0.7 && h.distance <= FULL_HOLD_DIST + 0.5, `held near the raft, got ${h.distance}`);
});

test('HOOK-1: once there is room the same reel finishes and collects', () => {
  const { h, items } = floatingCatch();
  reel(h, items, () => false, 3);
  const ev = reel(h, items, () => true);
  assert.equal(ev?.kind, 'collected');
  assert.equal(ev.items[0].token, 'a');
});

test('HOOK-1: no catch or far away never holds the reel', () => {
  assert.equal(holdForFullBag({ caughtItems: [], distance: 1 }, () => false), false);
  assert.equal(holdForFullBag({ caughtItems: [{ type: 'wood' }], distance: 5 }, () => false), false);
  assert.equal(holdForFullBag({ caughtItems: [{ type: 'wood' }], distance: 1 }, () => true), false);
  assert.equal(holdForFullBag(null, () => false), false);
});

test('HOOK-2: a swimmer\'s throw starts above the water and flies', () => {
  assert.ok(MIN_THROW_Y >= WATER_Y + 0.3);
  for (const y of [-0.29, -0.18, 0.04]) {
    const origin = throwOrigin({ x: 1, y, z: 2 }, new T.Vector3());
    assert.deepEqual([origin.x, origin.y, origin.z], [1, MIN_THROW_Y, 2]);
    const h = new HookCast(T, { origin, direction: { x: 0, y: 0.3, z: -1 }, charge: 1 });
    assert.equal(h.stage, 'flying', `hand y ${y} must not splash at the hand`);
    for (let i = 0; i < 200 && h.stage === 'flying'; i++) h.update(0.05, { hand: origin, items: [], time: i * 0.05 });
    assert.ok(h.distance > 5, `throw from y ${y} went ${h.distance} m`);
  }
});

test('HOOK-2: a deck-height hand is left alone', () => {
  const o = throwOrigin({ x: 0, y: 1.2, z: 0 });
  assert.equal(o.y, 1.2);
});

test('HOOK-5: a hook that snags a supply and lands on the far deck keeps the catch', () => {
  // L/U raft: the player's deck at z in (-1,3), a far arm at z in (-13,-9), water between.
  const deckAt = (x, z) => ((z > -1 && z < 3) || (z < -9 && z > -13) ? 0.22 : null);
  const items = [{ id: 1, token: 'a', type: 'barrel', x: 0, z: -8.6 }];
  let found = null;
  for (let up = -0.3; up <= 0.4 && !found; up += 0.01) for (let c = 0; c <= 1 && !found; c += 0.05) {
    const h = new HookCast(T, { origin: { x: 0, y: 1.25, z: 1 }, direction: { x: 0, y: up, z: -1 }, charge: c, deckAt });
    const events = [];
    for (let i = 0; i < 400 && h.stage !== 'done' && h.stage !== 'floating'; i++) { const e = h.update(1 / 60, { hand: { x: 0, y: 1.25, z: 1 }, items }); if (e) events.push(e); }
    if (h.onDeck && h.caughtItems.length) found = events;
  }
  assert.ok(found, 'a throw that snags then lands on the deck exists');
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'collected');
  assert.deepEqual(found[0].items, [{ id: 1, token: 'a', type: 'barrel' }]);
});
