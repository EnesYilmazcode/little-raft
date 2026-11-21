// Round-2 hook regressions: full-bag reel stop, throws while swimming, a catch landing on the deck.
// Run: node --test tests/hook-r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const HP = await import(new URL('hook-physics.js', base));
const { HookCast, WATER_Y, catchLoot, holdForFullBag, FULL_HOLD_DIST } = HP;

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
