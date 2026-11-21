// Unit tests for dist/vitals.js (hunger, thirst, health).
// Run: node --test tests/vitals.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const V = await import(new URL('vitals.js', base));

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const run = (v, seconds, opts, step = 0.05) => { for (let t = 0; t < seconds - 1e-9; t += step) V.tickVitals(v, step, opts); return v; };

test('new vitals start full', () => {
  const v = V.newVitals();
  assert.equal(v.hp, 100); assert.equal(v.food, 100); assert.equal(v.water, 100); assert.equal(v.starving, false);
});

test('hunger 0.09/s and thirst 0.11/s', () => {
  const v = run(V.newVitals(), 100, {mult:1});
  near(v.food, 91, 1e-6); near(v.water, 89, 1e-6); assert.equal(v.hp, 100);
});

test('sprint/swim multiplier is x1.5', () => {
  const v = run(V.newVitals(), 100, {mult:V.SPRINT_MULT});
  near(v.food, 100 - 13.5, 1e-6); near(v.water, 100 - 16.5, 1e-6);
});

test('bad dt and missing opts are harmless', () => {
  const v = V.newVitals();
  V.tickVitals(v, NaN); V.tickVitals(v, -1); V.tickVitals(v, 0);
  assert.equal(v.food, 100);
  V.tickVitals(v, 1); near(v.food, 99.91);
  V.tickVitals(v, 1, {mult:-3}); near(v.food, 99.82); // invalid mult falls back to 1
});

test('each empty bar costs 0.75 HP/s and they stack', () => {
  const a = V.newVitals({hp:50, food:0, water:50});
  run(a, 4, {mult:1}); near(a.hp, 47, 1e-6); assert.equal(a.starving, true);
  const b = V.newVitals({hp:50, food:0, water:0});
  run(b, 4, {mult:1}); near(b.hp, 44, 1e-6);
  run(b, 100, {mult:1}); assert.equal(b.hp, 0); assert.equal(b.starving, false);
});

test('regen 0.25 HP/s only with both bars above 0', () => {
  const v = V.newVitals({hp:50, food:80, water:80});
  run(v, 4, {mult:1}); near(v.hp, 51, 1e-6);
  const w = V.newVitals({hp:50, food:80, water:0});
  run(w, 4, {mult:1}); assert.ok(w.hp < 50);
});

test('damage blocks regen for 3 s', () => {
  const v = V.newVitals({hp:80, food:80, water:80});
  run(v, 1, {mult:1});
  assert.equal(V.damage(v, 10, 'shark'), 10);
  const after = v.hp; near(after, 80 + 0.25 - 10, 1e-6);
  run(v, 2.9, {mult:1}); near(v.hp, after, 1e-6);
  run(v, 1.1, {mult:1}); assert.ok(v.hp > after);
});

test('damage clamps, ignores bad input and dead players', () => {
  const v = V.newVitals({hp:5, food:50, water:50});
  assert.equal(V.damage(v, -3), 0); assert.equal(V.damage(v, NaN), 0);
  assert.equal(V.damage(v, 20, 'fall'), 5); assert.equal(v.hp, 0);
  assert.equal(V.damage(v, 1), 0);
});

test('consume applies the FOOD table', () => {
  const v = V.newVitals({hp:100, food:50, water:50});
  assert.deepEqual(V.consume(v, 'cookedfish'), {food:35, water:0}); assert.equal(v.food, 85); assert.equal(v.water, 50);
  V.consume(v, 'fish'); assert.equal(v.food, 97.5); assert.equal(v.water, 40);
  const r = V.consume(v, 'freshcup'); assert.equal(r.returns, 'cup'); assert.equal(v.water, 80);
  assert.equal(V.consume(v, 'saltcup').returns, 'cup'); assert.equal(v.water, 75);
  V.consume(v, 'cookedfish'); assert.equal(v.food, 100); // clamps at max
  assert.equal(V.consume(v, 'wood'), null); assert.equal(V.consume(v, 'toString'), null);
  V.consume(v, 'sharkmeat'); assert.equal(v.water, 70);
  v.food = 0; V.consume(v, 'cookedsharkmeat'); assert.equal(v.food, 30);
});

test('drinking at full is allowed (no waste guard)', () => {
  const v = V.newVitals();
  assert.ok(V.consume(v, 'freshcup')); assert.equal(v.water, 100);
});

test('addFood lets other lanes register edibles', () => {
  assert.equal(V.addFood('', {}), false); assert.equal(V.addFood('x', null), false);
  assert.equal(V.addFood('testberry', {food:5, water:'bad', returns:''}), true);
  assert.deepEqual(V.FOOD.testberry, {food:5, water:0});
  assert.equal(V.isEdible('testberry'), true);
  assert.equal(V.eatLabel('testberry'), 'Eat (+5 food)');
  delete V.FOOD.testberry;
});

test('eatLabel', () => {
  assert.equal(V.eatLabel('cookedfish'), 'Eat (+35 food)');
  assert.equal(V.eatLabel('fish'), 'Eat (+12.5 food, -10 water)');
  assert.equal(V.eatLabel('freshcup'), 'Drink (+40 water)');
  assert.equal(V.eatLabel('saltcup'), 'Drink (-5 water)');
  assert.equal(V.eatLabel('wood'), '');
});

test('cleanVitals: old saves start full, junk is clamped, a faint wakes as a respawn', () => {
  for (const raw of [undefined, null, 7, 'x', [], {}]) assert.deepEqual(V.cleanVitals(raw), {hp:100, food:100, water:100});
  assert.deepEqual(V.cleanVitals({hp:250, food:-4, water:'9'}), {hp:100, food:0, water:100});
  assert.deepEqual(V.cleanVitals({hp:40.5, food:12, water:NaN}), {hp:40.5, food:12, water:100});
  assert.deepEqual(V.cleanVitals({hp:0, food:0, water:0}), {...V.RESPAWN});
  assert.deepEqual(V.saveVitals({hp:40.04, food:12.36, water:99.99}), {hp:40, food:12.4, water:100});
  assert.deepEqual(V.cleanVitals(JSON.parse(JSON.stringify(V.saveVitals(V.newVitals({hp:3, food:4, water:5}))))), {hp:3, food:4, water:5});
});

test('migrateSnapshot keeps engine-only kinds (cups) when given extraStack', async () => {
  const { migrateSnapshot } = await import(new URL('items.js', base));
  const slots = [{ kind: 'freshcup', count: 7 }, { kind: 'cookedfish', count: 2 }, { kind: 'saltcup', count: 1 }, { kind: 'bogus', count: 1 }];
  const stack = k => ({ freshcup: 5, saltcup: 5, cup: 5 })[k] ?? 0;
  const m = migrateSnapshot({ slots, selected: 0 }, stack);
  assert.deepEqual(m.slots.slice(0, 5), [{ kind: 'freshcup', count: 5 }, { kind: 'cookedfish', count: 2 }, { kind: 'saltcup', count: 1 }, { kind: 'freshcup', count: 2 }, null]);
  assert.equal(migrateSnapshot({ slots, selected: 0 }).slots[0], null); // without it, unknown kinds are still dropped
  assert.equal(migrateSnapshot({ slots, selected: 0 }, () => { throw new Error('x'); }).slots[0], null);
});
