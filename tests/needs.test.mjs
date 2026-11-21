// Survival needs (dist/needs.js): drain, starvation, regen, food values, mode scaling, relaxed, saves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const N = await import(new URL('needs.js', base));
const { MODES, DEFAULT_MODE } = await import(new URL('combat-bus.js', base));
const { createNeeds, FOOD, cleanNeeds, registerFood, isFood, DRAIN, STARVE_HP, REGEN_HP } = N;

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const run = (n, seconds, step = 0.05) => { for (let t = 0; t < seconds - 1e-9; t += step) n.tick(step); };

test('new needs start full and default mode is normal', () => {
  const n = createNeeds({ mode: DEFAULT_MODE });
  assert.equal(DEFAULT_MODE, 'normal');
  assert.equal(n.hunger, 100); assert.equal(n.thirst, 100); assert.equal(n.health, 100); assert.equal(n.alive, true);
  assert.equal(createNeeds().mode, 'relaxed'); // missing / unknown mode is the old calm game
  assert.equal(createNeeds({ mode: 'bogus' }).mode, 'relaxed');
});

test('drain per second on normal', () => {
  const n = createNeeds({ mode: 'normal' });
  run(n, 100, 0.5);
  near(n.hunger, 100 - DRAIN.hunger * 100, 1e-6); near(n.thirst, 100 - DRAIN.thirst * 100, 1e-6);
  near(DRAIN.hunger, 0.09); near(DRAIN.thirst, 0.11);
  assert.equal(n.health, 100);
});

test('mode scaling of drain and damage', () => {
  for (const key of ['peaceful', 'easy', 'normal', 'hard']) {
    const n = createNeeds({ mode: key }); n.tick(10);
    near(n.hunger, 100 - 0.9 * MODES[key].hunger); near(n.thirst, 100 - 1.1 * MODES[key].thirst);
    const m = createNeeds({ mode: key }); m.damage(10, 'test');
    near(m.health, 100 - 10 * MODES[key].damage);
  }
});

test('relaxed mode never changes anything', () => {
  const n = createNeeds({ mode: 'relaxed' });
  run(n, 5000, 1);
  assert.equal(n.damage(500), 0); assert.equal(n.eat('fish'), false); assert.equal(n.canEat('freshcup'), false);
  assert.deepEqual({ h: n.hunger, t: n.thirst, hp: n.health, alive: n.alive }, { h: 100, t: 100, hp: 100, alive: true });
  assert.equal(n.stats().active, false);
});

test('starvation: each empty bar costs 0.75 HP/s and they stack', () => {
  const n = createNeeds({ mode: 'normal', state: { hunger: 0, thirst: 50, health: 100 } });
  n.tick(4); near(n.health, 100 - STARVE_HP * 4);
  const b = createNeeds({ mode: 'normal', state: { hunger: 0, thirst: 0, health: 100 } });
  b.tick(4); near(b.health, 100 - 2 * STARVE_HP * 4);
  assert.ok(b.hits >= 1, 'starvation flashes the HUD');
});

test('starving to death reports the tick and the cause', () => {
  const n = createNeeds({ mode: 'normal', state: { hunger: 50, thirst: 0, health: 1 } });
  let died = false; for (let i = 0; i < 100 && !died; i++) died = n.tick(0.1);
  assert.equal(died, true); assert.equal(n.alive, false); assert.equal(n.health, 0); assert.equal(n.cause, 'thirst');
  const h = n.hunger; n.tick(10); assert.equal(n.hunger, h, 'the dead do not drain');
  n.respawn();
  assert.deepEqual([n.hunger, n.thirst, n.health, n.alive], [50, 50, 50, true]);
});

test('regen only while hunger and thirst are both above zero', () => {
  const n = createNeeds({ mode: 'normal', state: { hunger: 80, thirst: 80, health: 40 } });
  n.tick(10); near(n.health, 40 + REGEN_HP * 10);
  const m = createNeeds({ mode: 'peaceful', state: { hunger: 0, thirst: 80, health: 40 } });
  m.tick(1); assert.ok(m.health < 40);
  const full = createNeeds({ mode: 'normal' }); full.tick(1); assert.equal(full.health, 100);
});

test('eat values', () => {
  const at = (kind, h = 50, t = 50) => { const n = createNeeds({ mode: 'normal', state: { hunger: h, thirst: t, health: 100 } }); assert.equal(n.eat(kind), true); return [n.hunger, n.thirst]; };
  assert.deepEqual(at('fish'), [62.5, 40]);
  assert.deepEqual(at('cookedfish'), [70, 50]);
  assert.deepEqual(at('freshcup'), [50, 90]);
  assert.deepEqual(at('saltcup'), [50, 35]);
  assert.deepEqual(at('sharkmeat'), [60, 40]);
  assert.deepEqual(at('cookedsharkmeat'), [80, 50]);
  assert.deepEqual(at('cookedfish', 95, 50), [100, 50], 'clamped to 100');
  assert.deepEqual(at('fish', 50, 5), [62.5, 0], 'clamped to 0');
  assert.equal(FOOD.freshcup.returns, 'cup'); assert.equal(FOOD.saltcup.returns, 'cup'); assert.equal(FOOD.fish.returns, undefined);
  const n = createNeeds({ mode: 'normal' });
  assert.equal(n.eat('wood'), false); assert.equal(n.canEat('cookedfish'), false, 'full: no point');
  assert.equal(n.canEat('saltcup'), true, 'salt water is always allowed');
  assert.ok(registerFood('testberry', { hunger: 3, thirst: 1 })); assert.ok(isFood('testberry'));
});

test('dead players cannot eat or take damage', () => {
  const n = createNeeds({ mode: 'hard' });
  n.damage(1000, 'shark'); assert.equal(n.alive, false); assert.equal(n.cause, 'shark');
  assert.equal(n.eat('fish'), false); assert.equal(n.damage(5), 0); assert.equal(n.heal(5), 0);
});

test('snapshot round-trip and cleaning', () => {
  const n = createNeeds({ mode: 'normal', state: { hunger: 33.333, thirst: 12, health: 77 } });
  const s = JSON.parse(JSON.stringify(n.snapshot()));
  const m = createNeeds({ mode: 'normal' }).restore(s);
  assert.deepEqual([m.hunger, m.thirst, m.health], [33.33, 12, 77]);
  assert.deepEqual(cleanNeeds(null), { hunger: 100, thirst: 100, health: 100 });
  assert.deepEqual(cleanNeeds({ hunger: 'x', thirst: -5, health: 900 }), { hunger: 100, thirst: 0, health: 100 });
  const d = createNeeds({ mode: 'normal', state: { hunger: 0, thirst: 0, health: 1 } }); d.damage(10);
  assert.deepEqual(d.snapshot(), { hunger: 50, thirst: 50, health: 50 }, 'a save taken while dead loads respawned');
});

test('stats() reuses one object (no per-frame allocations)', () => {
  const n = createNeeds({ mode: 'easy' });
  assert.equal(n.stats(), n.stats());
  assert.equal(n.setMode('relaxed'), 'relaxed'); assert.equal(n.stats().active, false);
});
