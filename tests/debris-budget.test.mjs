// Debris spawn budget: flotsam respawns with raft travel over the water, a trickle when still, none extra when anchored.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEBRIS, debrisSpeed, stepDebrisBudget, spendDebris } from '../dist/debris-budget.js';
import { defaultSailing, stepSailing } from '../dist/sailing-core.js';

const near = (a, b, eps = 1e-9, m) => assert.ok(Math.abs(a - b) <= eps, `${m || ''} ${a} != ${b}`);

/** Seconds until one item is earned at a steady speed. */
function secondsPerItem(speed, dt = 1 / 60) {
  const st = { budget: 0 }; let t = 0;
  while (!spendDebris(st)) { st.budget = stepDebrisBudget(st.budget, dt, speed); t += dt; if (t > 1e4) return Infinity; }
  return t;
}

test('pool and rates', () => {
  assert.equal(DEBRIS.POOL, 30);
  near(DEBRIS.PER_METRE, 0.6); near(DEBRIS.FLOOR, 0.05);
  near(secondsPerItem(0), 20, 0.05, 'still raft: floor only');
  near(secondsPerItem(0.22), 1 / (0.6 * 0.22 + 0.05), 0.05, 'base drift');
  near(secondsPerItem(1.5), 1 / (0.6 * 1.5 + 0.05), 0.05, 'sailing');
  assert.ok(secondsPerItem(1.5) < secondsPerItem(0.22) / 4, 'sailing finds far more debris');
});

test('budget caps, ignores bad input, spending needs a whole item', () => {
  assert.equal(stepDebrisBudget(0, 1e6, 10), DEBRIS.CAP);
  assert.equal(stepDebrisBudget(NaN, 1, 0), DEBRIS.FLOOR);
  assert.equal(stepDebrisBudget(-5, 1, -3), DEBRIS.FLOOR);
  assert.equal(stepDebrisBudget(0.5, NaN, 1), 0.5);
  assert.equal(stepDebrisBudget(0.5, -1, 1), 0.5);
  assert.equal(stepDebrisBudget(0.5, 1, NaN), 0.5 + DEBRIS.FLOOR);
  const st = { budget: 0.99 };
  assert.equal(spendDebris(st), false); near(st.budget, 0.99);
  st.budget = 2.2;
  assert.equal(spendDebris(st), true); assert.equal(spendDebris(st), true); assert.equal(spendDebris(st), false);
  near(st.budget, 0.2, 1e-12);
  assert.equal(spendDebris(null), false);
});

test('debrisSpeed: flow plus base drift', () => {
  near(debrisSpeed(0, 0, 0.22), 0.22);
  near(debrisSpeed(3, 4, 0), 5);
  near(debrisSpeed(0, -0.22, 0.22), 0, 1e-12, 'sailing with the drift cancels it');
  assert.equal(debrisSpeed(NaN, undefined, null), 0);
});

test('anchored raft: no water flow, so debris only gets the floor trickle', () => {
  const s = defaultSailing(); s.anchored = true; s.raised = true; s.heading = s.windDir;
  const o = { dwx: 0, dwz: 0, dgx: 0, dgz: 0 };
  let b = 0;
  for (let i = 0; i < 600; i++) {
    stepSailing(s, 0.1, { nSails: 1, host: true }, o);
    assert.equal(o.dwx, 0); assert.equal(o.dwz, 0);
    const fx = -o.dwx / 0.1, fz = -o.dwz / 0.1; // sailing-world itemFlow; base drift is 0 while anchored
    b = stepDebrisBudget(b, 0.1, debrisSpeed(fx, fz, 0));
  }
  near(b, DEBRIS.CAP, 1e-9, '60 s of floor fills the cap (3 items) and no more');
});
