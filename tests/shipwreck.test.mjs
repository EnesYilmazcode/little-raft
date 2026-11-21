// Sunken shipwreck core rules (docs/specs/shipwreck.md §14). Run: node --test tests/shipwreck.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SW, layoutFor, pathAt, nextDelay, candidates, dockZFor, lootFor, applyOpen, clean, DEFAULTS, fillSlotPos, fullMask, raftEdge, offsetFor, SLOT_CENTRE, rng, hash3,
} from '../dist/shipwreck-core.js';
import * as IL from '../dist/islands-layout.js';
import { Bag, ITEM_INFO, SLOT_COUNT, STACK_SIZE } from '../dist/inventory-state.js';

const known = id => !!ITEM_INFO[id];

test('layoutFor: deterministic, frozen, slot rules, kelp clearance, all variants', () => {
  const seen = new Set();
  for (let seed = 0; seed < 120; seed++) {
    const a = layoutFor(seed);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(layoutFor(seed))));
    assert.ok(Object.isFrozen(a) && Object.isFrozen(a.slots) && Object.isFrozen(a.slots[0]) && Object.isFrozen(a.kelp));
    assert.equal(a.slots[0].kind, 'chest');
    assert.ok(a.slots.length >= 4 && a.slots.length <= 7);
    const crates = a.slots.filter(s => s.kind === 'crate').length, barrels = a.slots.filter(s => s.kind === 'barrel').length;
    assert.ok(crates >= 3 && crates <= 4); assert.ok(barrels >= 1 && barrels <= 2);
    assert.equal(a.slots.filter(s => s.kind === 'chest').length, 1);
    assert.ok(a.kelp.length >= 10 && a.kelp.length <= 16, 'kelp ' + a.kelp.length);
    for (const k of a.kelp) {
      assert.ok(Math.hypot(k.x, k.z) <= 6 + 1e-9);
      assert.ok(!(Math.abs(k.x) < 0.6 && Math.abs(k.z) < 4.5));
      for (const s of a.slots) assert.ok(Math.hypot(s.x - k.x, s.z - k.z) >= 0.8 - 1e-9);
    }
    assert.ok(a.fish.length >= 6 && a.fish.length <= 8);
    for (const f of a.fish) { assert.ok(f.orbitR >= 3 && f.orbitR <= 5); assert.ok(f.orbitH >= 1.5 && f.orbitH <= 3); assert.ok(f.speed >= .25 && f.speed <= .4); }
    seen.add(a.variant);
  }
  assert.deepEqual([layoutFor(0).variant, layoutFor(1).variant, layoutFor(2).variant], ['keel', 'listing', 'bow']);
  assert.equal(seen.size, 3);
});

test('pathAt: phase boundaries, marker endpoints, out reused', () => {
  const o = {};
  assert.equal(pathAt(0, SW.DOCK, 2, o), o);
  assert.equal(o.phase, 'approach'); assert.equal(o.mz, SW.START_Z); assert.equal(o.left, SW.APPROACH);
  pathAt(SW.APPROACH - 1e-6, SW.DOCK, 2, o); assert.equal(o.phase, 'approach'); assert.ok(Math.abs(o.mz - 2) < 1e-3);
  pathAt(SW.APPROACH, SW.DOCK, 2, o); assert.equal(o.phase, 'docked'); assert.equal(o.mz, 2); assert.equal(o.left, SW.DOCK);
  pathAt(SW.APPROACH + SW.DOCK, SW.DOCK, 2, o); assert.equal(o.phase, 'depart'); assert.ok(Math.abs(o.mz - 2) < 1e-9);
  pathAt(SW.APPROACH + SW.DOCK + SW.DEPART - 1e-6, SW.DOCK, 2, o); assert.ok(Math.abs(o.mz - SW.END_Z) < 1e-3);
  pathAt(SW.APPROACH + SW.DOCK + SW.DEPART, SW.DOCK, 2, o); assert.equal(o.phase, 'gone'); assert.equal(o.left, 0);
  pathAt(NaN, NaN, NaN, o); assert.equal(o.phase, 'approach');
  pathAt(SW.APPROACH + 300, 400, 0, o); assert.equal(o.phase, 'docked'); // extended dock
});

test('nextDelay: FIRST and the calm range', () => {
  assert.equal(nextDelay(5, true), SW.FIRST);
  for (let s = 0; s < 500; s++) { const d = nextDelay(s); assert.ok(d >= 480 && d <= 720); }
  assert.equal(nextDelay(42), nextDelay(42));
});

test('candidates: 6 points on side, finite, deterministic', () => {
  for (const side of [-1, 1]) for (let seed = 0; seed < 50; seed++) {
    const dz = dockZFor(seed); assert.ok(dz >= -4 && dz <= 4);
    const out = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]], r = candidates(seed, side, 12, dz, out);
    assert.equal(r, out); assert.equal(r.length, 6);
    for (const [x, z] of r) { assert.ok(Number.isFinite(x) && Number.isFinite(z)); assert.ok(Math.sign(x) === side && Math.abs(x) >= 12); }
    assert.deepEqual(candidates(seed, side, 12, dz), r);
    for (let k = 0; k < 3; k++) assert.equal(r[k][1], dz);
  }
  assert.equal(offsetFor(raftEdge([[0, 0]], 1)), 10); // edge 1 + 9 -> OFF_MIN 10
  assert.equal(offsetFor(raftEdge([[0, 0], [3, 0]], 1)), 16);
  assert.equal(offsetFor(raftEdge([[0, 0], [30, 0]], 1)), SW.OFF_MAX);
});

const ranges = {
  crate: { wood: [2, 6], scrap: [2, 6], rope: [1, 4], nail: [2, 6], plastic: [1, 4], glass: [1, 2], metalingot: [1, 2] },
  barrel: { plastic: [1, 1], rope: [2, 2], seaweed: [2, 2], clay: [2, 2], copperore: [1, 1], cup: [1, 1] },
};
test('lootFor: deterministic, known ids only, chest rules, counts', () => {
  for (let seed = 0; seed < 200; seed++) {
    const lay = layoutFor(seed);
    lay.slots.forEach((s, k) => {
      const a = lootFor(seed, k, s.kind, false, known);
      assert.deepEqual(a, lootFor(seed, k, s.kind, false, known));
      assert.ok(a.length > 0);
      for (const [id, n] of a) { assert.ok(known(id), id); assert.ok(Number.isInteger(n) && n > 0); }
      if (s.kind === 'chest') {
        const sh = a.find(e => e[0] === 'shell'); assert.ok(sh && sh[1] >= 3 && sh[1] <= 5);
        assert.equal(a.length, 2);
        const b = lootFor(seed, k, 'chest', true, known);
        assert.deepEqual(b, [sh]); // the note replaces the rare roll
      } else for (const [id, n] of a) { const r = ranges[s.kind][id]; assert.ok(r, s.kind + ' ' + id); assert.ok(n >= r[0] && n <= r[1], `${id} ${n}`); }
      if (s.kind === 'barrel') assert.ok(a.some(e => e[0] === 'plastic'));
    });
  }
  // unknown-id filter drops entries
  for (let seed = 0; seed < 50; seed++) for (const kind of ['crate', 'barrel', 'chest']) {
    const a = lootFor(seed, 1, kind, false, id => id !== 'scrap' && id !== 'rope' && id !== 'shell');
    for (const [id] of a) assert.ok(!['scrap', 'rope', 'shell'].includes(id));
  }
  assert.deepEqual(lootFor(3, 1, 'crate', false, () => false), []);
  assert.deepEqual(lootFor(3, 1, 'crate', false, id => id === 'wood').every(e => e[0] === 'wood'), true);
  assert.deepEqual(lootFor(3, 0, 'chest', true, id => id === 'wood'), [['wood', 1]]);
});

const SEED = 7;
function mkState(opened = 0, t = SW.APPROACH + 10) {
  const site = { seed: SEED, born: 0, dock: SW.DOCK, x: 12, z: 1, y: -10, opened };
  const lay = layoutFor(SEED), slotPos = fillSlotPos(lay, site, () => -10);
  return { site, clock: t, lay, slotPos };
}
const at = (st, k, dx = 0) => ({ x: st.slotPos[k * 3] + dx, y: st.slotPos[k * 3 + 1] + SLOT_CENTRE, z: st.slotPos[k * 3 + 2] });

test('applyOpen: happy path adds loot and sets the bit', () => {
  const st = mkState(), bag = new Bag();
  const kind = st.lay.slots[1].kind, want = lootFor(SEED, 1, kind, false, known);
  const r = applyOpen(st, { kind: 'wreck.open', seed: SEED, slot: 1 }, 'host', at(st, 1, 1), bag, false, known);
  assert.equal(r.ok, true); assert.deepEqual(r.loot, want); assert.equal(r.note, false);
  assert.equal(st.site.opened, 2);
  for (const [id, n] of want) assert.equal(bag.count(id), n);
  const c = applyOpen(st, { kind: 'wreck.open', seed: SEED, slot: 0 }, 'host', at(st, 0), bag, true, known);
  assert.equal(c.ok, true); assert.equal(c.note, true); assert.equal(st.site.opened, 3);
});

test('applyOpen: failures', () => {
  const A = slot => ({ kind: 'wreck.open', seed: SEED, slot });
  let st = mkState(), bag = new Bag();
  assert.equal(applyOpen(st, { kind: 'x' }, 'host', at(st, 1), bag).reason, 'kind');
  assert.equal(applyOpen({ site: null }, A(1), 'host', at(st, 1), bag).reason, 'none');
  assert.equal(applyOpen(st, { ...A(1), seed: 8 }, 'host', at(st, 1), bag).reason, 'stale');
  for (const s of [-1, 1.5, 7, 'a', null]) assert.equal(applyOpen(st, A(s), 'host', at(st, 1), bag).reason, 'slot');
  st = mkState(2); assert.equal(applyOpen(st, A(1), 'host', at(st, 1), bag).reason, 'opened');
  st = mkState(0, 5); assert.equal(applyOpen(st, A(1), 'host', at(st, 1), bag).reason, 'phase');
  st = mkState(0, SW.APPROACH + SW.DOCK + 1); assert.equal(applyOpen(st, A(1), 'host', at(st, 1), bag).reason, 'phase');
  st = mkState();
  assert.equal(applyOpen(st, A(1), 'guest', at(st, 1, SW.REACH + SW.SLACK + 0.1), bag).reason, 'reach');
  assert.equal(applyOpen(st, A(1), 'guest', { x: NaN, y: 0, z: 0 }, bag).reason, 'reach');
  assert.equal(applyOpen(st, A(1), 'guest', null, bag).reason, 'reach');
  assert.equal(applyOpen(st, A(1), 'guest', at(st, 1, SW.REACH + 1), bag).ok, true); // within slack
  st = mkState();
  assert.equal(applyOpen(st, A(1), 'host', at(st, 1), null).reason, 'bag');
  // bag full: unchanged, bit unset
  const full = new Bag({ slots: new Array(SLOT_COUNT).fill(null).map(() => ({ kind: 'plastic', count: STACK_SIZE })), selected: 0 });
  const snap = JSON.stringify(full.snapshot());
  const r = applyOpen(st, A(1), 'host', at(st, 1), full, false, known);
  assert.equal(r.reason, 'full'); assert.equal(st.site.opened, 0); assert.equal(JSON.stringify(full.snapshot()), snap);
});

test('clean: defaults, clamps, gone sites, mask trim, round trip', () => {
  for (const g of [undefined, null, 5, 'x', [], {}, { v: 2 }]) assert.deepEqual(clean(g), DEFAULTS());
  assert.deepEqual(clean({ v: 1, clock: -5 }), { v: 1, clock: 0, next: SW.FIRST, site: null });
  assert.equal(clean({ v: 1, clock: 2e9, next: 0 }).clock, 1e9);
  assert.equal(clean({ v: 1, clock: 100, next: 1e7 }).next, 100 + SW.DOCK_CAP + SW.CALM_MAX);
  assert.equal(clean({ v: 1, clock: 100, next: 5 }).next, 100);
  const site = { seed: 9, born: 90, dock: 240, x: 12, z: 1, y: -10, opened: 0xff };
  const c = clean({ v: 1, clock: 100, next: 200, site });
  assert.equal(c.site.opened, fullMask(layoutFor(9)));
  assert.deepEqual(clean(JSON.parse(JSON.stringify(c))), c);
  assert.equal(clean({ v: 1, clock: 100, next: 200, site: { ...site, dock: 9999 } }).site.dock, SW.DOCK_CAP);
  assert.equal(clean({ v: 1, clock: 100, next: 200, site: { ...site, born: 500 } }).site.born, 100);
  assert.equal(clean({ v: 1, clock: 10000, next: 10100, site: { ...site, born: 0 } }).site, null); // gone
  for (const bad of [{ seed: -1 }, { seed: 1.5 }, { x: 81 }, { z: -90 }, { y: -1 }, { y: -30 }, { born: NaN }, { dock: 'a' }, { x: Infinity }])
    assert.equal(clean({ v: 1, clock: 100, next: 200, site: { ...site, ...bad } }).site, null, JSON.stringify(bad));
  assert.equal(clean({ v: 1, clock: 100, next: 200, site: [] }).site, null);
});

test('hash3/rng match islands-layout (no new RNG)', () => {
  for (let i = 0; i < 20; i++) assert.equal(hash3(i, i * 3, 7), IL.hash3(i, i * 3, 7));
  const a = rng(99), b = IL.rng(99);
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
});
