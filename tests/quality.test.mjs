// Unit tests for the adaptive quality controller (dist/quality.js).
// Run: node --test tests/quality.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { createQuality, buildLevels, QUALITY_CONSTANTS: C } = await import(new URL('quality.js', base));

function fakes() {
  const renderer = { pr: null, calls: 0, setPixelRatio(v) { this.pr = v; this.calls++; } };
  const map = { disposed: 0, dispose() { this.disposed++; } };
  const sun = { castShadow: true, shadow: { map, mapSize: { x: 1024, y: 1024, set(x, y) { this.x = x; this.y = y; } } } };
  return { renderer, sun, map };
}
const make = (opts = {}) => {
  const f = fakes(); const changes = [];
  const q = createQuality({ renderer: f.renderer, sun: f.sun, dpr: 2, preset: 'high', onChange: (i) => changes.push(i), ...opts });
  return { ...f, q, changes };
};
const run = (q, ms, totalMs) => { let n = 0; for (let t = 0; t < totalMs; t += ms) if (q.tick(ms)) n++; return n; };

test('ladder per preset, clamped to dpr and cap', () => {
  assert.deepEqual(buildLevels('high', 2).map((l) => [l.pixelRatio, l.shadowMapSize]),
    [[1.5, 1024], [1.15, 1024], [1, 1024], [0.85, 1024], [0.85, 0], [0.7, 0]]);
  assert.deepEqual(buildLevels('medium', 2)[0], { pixelRatio: 1.3, shadows: true, shadowMapSize: 1024 });
  assert.deepEqual(buildLevels('low', 2).map((l) => [l.pixelRatio, l.shadows]), [[1, false], [0.85, false], [0.7, false]]);
  const one = buildLevels('high', 1);
  assert.deepEqual(one.map((l) => [l.pixelRatio, l.shadowMapSize]), [[1, 1024], [0.85, 1024], [0.85, 0], [0.7, 0]]);
  for (const p of ['low', 'medium', 'high']) for (const d of [1, 2, 3]) for (const l of buildLevels(p, d)) assert.ok(l.shadowMapSize === 0 || l.shadowMapSize === C.SHADOW_FULL, 'one shadow map size: no resize hitch');
  for (const p of ['low', 'medium', 'high']) for (const l of buildLevels(p, 3)) assert.ok(l.pixelRatio <= { low: 1, medium: 1.3, high: 1.5 }[p]);
});

test('applies top level on create without notifying', () => {
  const { q, renderer, sun, changes } = make();
  assert.equal(q.level, 0); assert.equal(renderer.pr, 1.5); assert.equal(sun.castShadow, true); assert.equal(changes.length, 0);
});

test('steps down one level under sustained slow frames', () => {
  const { q, renderer, changes } = make();
  run(q, 30, 1900);
  assert.equal(q.level, 0, 'not before 2 s sustained');
  run(q, 30, 300);
  assert.equal(q.level, 1); assert.equal(renderer.pr, 1.15);
  assert.equal(changes.at(-1).reason, 'down');
  run(q, 30, 4000);
  assert.equal(q.level, 1, '5 s cooldown holds');
  run(q, 30, 1500);
  assert.equal(q.level, 2);
});

test('single spike or ignored hitches do not step down', () => {
  const { q } = make();
  run(q, 10, 3000);
  q.tick(240); // one big frame
  run(q, 10, 3000);
  for (let i = 0; i < 40; i++) q.tick(1000); // >250 ms samples ignored
  q.tick(NaN); q.tick(-5); q.tick(0);
  run(q, 10, 1000);
  assert.equal(q.level, 0);
});

test('stepping down keeps the shadow map; the last two levels disable castShadow', () => {
  const { q, sun, map, renderer } = make();
  run(q, 40, 12100); // steps at 2 s, 7 s, 12 s (sustain counters run through the cooldown)
  assert.equal(q.level, 3); assert.equal(map.disposed, 0); assert.equal(sun.shadow.map, map);
  assert.equal(sun.shadow.mapSize.x, 1024); assert.equal(renderer.pr, 0.85); assert.equal(sun.castShadow, true);
  run(q, 40, 5000);
  assert.equal(q.level, 4); assert.equal(sun.castShadow, false); assert.equal(renderer.pr, 0.85);
  run(q, 40, 5000);
  assert.equal(q.level, 5); assert.equal(sun.castShadow, false); assert.equal(renderer.pr, 0.7); assert.equal(map.disposed, 0);
  run(q, 40, 20000);
  assert.equal(q.level, 5, 'stays at the floor');
});

test('steps up with hysteresis (8 s below 17.5 ms)', () => {
  const { q, renderer } = make();
  run(q, 30, 2100); assert.equal(q.level, 1);
  run(q, 18.5, 20000); assert.equal(q.level, 1, 'between thresholds: hold');
  run(q, 10, 7000); assert.equal(q.level, 1, 'not before 8 s');
  run(q, 10, 1500); assert.equal(q.level, 0); assert.equal(renderer.pr, 1.5);
});

test('respects the preset cap', () => {
  const { q, renderer, sun } = make({ preset: 'low' });
  assert.equal(renderer.pr, 1); assert.equal(sun.castShadow, false);
  run(q, 10, 30000); assert.equal(q.level, 0); assert.equal(renderer.pr, 1);
  run(q, 40, 3000); assert.equal(q.level, 1); assert.equal(renderer.pr, 0.85);
  run(q, 40, 5000); assert.equal(q.level, 2); assert.equal(renderer.pr, 0.7);
  run(q, 40, 20000); assert.equal(q.level, 2);
  q.setCap('medium');
  assert.equal(q.level, 0); assert.equal(renderer.pr, 1.3); assert.equal(sun.castShadow, true);
  run(q, 10, 60000); assert.equal(renderer.pr, 1.3, 'never above medium cap');
});

test('reverted step-up doubles the up-wait, capped at 60 s', () => {
  const { q } = make();
  run(q, 30, 2100); assert.equal(q.level, 1);
  const cycle = () => {
    let t = 0; while (q.level !== 0) { q.tick(10); t += 10; if (t > 120000) throw new Error('no step up'); }
    run(q, 40, 7100); // regress right after the cooldown
    assert.equal(q.level, 1);
    return t;
  };
  assert.equal(q.upAfter, C.UP_AFTER_MS);
  cycle(); assert.equal(q.upAfter, 16000);
  const waited = cycle(); assert.equal(q.upAfter, 32000);
  assert.ok(waited >= 16000, `waited ${waited}`);
  cycle(); cycle(); assert.equal(q.upAfter, 60000);
});

test('step-down long after a step-up is not a revert', () => {
  const { q } = make();
  run(q, 30, 2100);
  run(q, 10, 15000); assert.equal(q.level, 0);
  run(q, 10, 30000);
  run(q, 40, 3000); assert.equal(q.level, 1);
  assert.equal(q.upAfter, C.UP_AFTER_MS);
});

test('reset() clears measurements and restarts cooldown; full reset restores top', () => {
  const { q, renderer } = make();
  run(q, 30, 2100); assert.equal(q.level, 1);
  run(q, 30, 4000); // slow long enough to step down once the cooldown ends
  q.reset(); assert.equal(q.ema, null); assert.equal(q.level, 1);
  run(q, 30, 4900); assert.equal(q.level, 1, 'cooldown after reset');
  q.reset({ full: true });
  assert.equal(q.level, 0); assert.equal(renderer.pr, 1.5); assert.equal(q.upAfter, C.UP_AFTER_MS);
  assert.match(q.describe(), /^high 1\/6: pr 1.5, shadows 1024/);
});
