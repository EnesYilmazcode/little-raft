// Bloatfish (underwater puffer hazard): trigger, burst damage, poison ticks, kill before burst, drops,
// respawn on return, the goo -> blast powder smelter recipe and the shared spear target list.
// Run: node --test tests/puffer.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const STAMP = '?build=v3-survival-ae77fa84ac2b'; // same specifier as the dist modules: one shared instance
const { createPufferSim, PUFFER, PUFF, gooDrop, swell } = await import(new URL('puffer-core.js', base));
const { ITEMS, stationRecipeFor, SPEAR_DAMAGE } = await import(new URL('items.js', base));
const { Bag } = await import(new URL('inventory-state.js', base));
const ST = await import(new URL('spear-targets.js' + STAMP, base));

const R = 10, KEY = 77;
function setup(rand = () => 0.5) {
  const sim = createPufferSim(rand);
  sim.area(KEY, R, 5); // player near the island: spawns at once
  return sim;
}
function hurtLog() { const log = []; const fn = (n, cause) => log.push([n, cause]); fn.log = log; fn.total = () => log.reduce((s, [n]) => s + n, 0); return fn; }
const first = (sim) => sim.fish.find((f) => f.state !== PUFF.DEAD);
// run the sim for `secs` with the player fixed at (x, y, z)
function run(sim, secs, x, y, z, inWater, hurt, dt = 1 / 60) { for (let t = 0; t < secs - 1e-9; t += dt) sim.step(dt, x, y, z, inWater, hurt); }

test('a few Bloatfish spawn around the island, just below the surface', () => {
  for (let s = 0; s < 20; s++) {
    const sim = createPufferSim(); sim.area(s, R, 0);
    const n = sim.alive();
    assert.ok(n >= PUFFER.MIN && n <= PUFFER.MAX, `count ${n}`);
    for (const f of sim.fish) {
      if (f.state === PUFF.DEAD) continue;
      const d = Math.hypot(f.x, f.z);
      assert.ok(d >= R * PUFFER.RING_IN - 1e-6 && d <= R * PUFFER.RING_IN + PUFFER.RING_OUT + 1e-6, `ring ${d}`);
      assert.ok(f.y <= -PUFFER.DEPTH_MIN + 1e-9 && f.y >= -PUFFER.DEPTH_MAX - 1e-9, `depth ${f.y}`);
      assert.equal(f.hp, 8);
    }
  }
  const none = createPufferSim(); none.area(null, 0, 0); assert.equal(none.alive(), 0);
});

test('trigger: a swimmer within 4 m sets it off; a dry player or a far swimmer does not', () => {
  const sim = setup(), f = first(sim), hurt = hurtLog();
  run(sim, 1, f.x + 3.5, f.y, f.z, false, hurt); // close, but on the deck / island
  assert.equal(f.state, PUFF.IDLE);
  run(sim, 1, f.x + 6, f.y, f.z, true, hurt); // swimming, too far
  assert.equal(f.state, PUFF.IDLE);
  sim.step(1 / 60, f.x + 3.5, f.y, f.z, true, hurt);
  assert.equal(f.state, PUFF.INFLATE);
  assert.equal(hurt.log.length, 0);
  // it swims toward the player while it swells
  const px = f.x + 3.5, py = f.y, pz = f.z, d0 = Math.hypot(px - f.x, py - f.y, pz - f.z);
  run(sim, 0.5, px, py, pz, true, hurt);
  assert.ok(Math.hypot(px - f.x, py - f.y, pz - f.z) < d0 - 0.3, 'closes in');
  assert.ok(swell(0.6) > 0.4 && swell(0) === 0 && swell(PUFFER.INFLATE) === 1);
});

test('burst: after 1.2 s it deals 20 within 3 m and leaves a poison cloud', () => {
  const sim = setup(), f = first(sim), hurt = hurtLog();
  const px = f.x + 2, py = f.y, pz = f.z;
  sim.step(1 / 60, px, py, pz, true, hurt);
  run(sim, PUFFER.INFLATE - 0.1, px, py, pz, true, hurt);
  assert.equal(f.state, PUFF.INFLATE); assert.equal(hurt.log.length, 0, 'no damage before the burst');
  run(sim, 0.12, px, py, pz, true, hurt);
  assert.equal(f.state, PUFF.DEAD);
  assert.deepEqual(hurt.log[0], [20, 'bloatfish']);
  assert.equal(sim.bursts, 1);
  assert.equal(sim.clouds.filter((c) => c.on).length, 1);
  // burst out of range: no burst damage (the player swam off after triggering it)
  const sim2 = setup(), g = first(sim2), h2 = hurtLog();
  sim2.step(1 / 60, g.x + 3.9, g.y, g.z, true, h2);
  run(sim2, PUFFER.INFLATE + 0.1, g.x + 40, g.y, g.z, true, h2);
  assert.equal(g.state, PUFF.DEAD); assert.equal(h2.log.length, 0);
});

test('poison cloud: 5 damage per second for 9 s while inside, nothing outside', () => {
  const sim = setup(), f = first(sim), hurt = hurtLog();
  const px = f.x + 1, py = f.y, pz = f.z;
  sim.step(1 / 60, px, py, pz, true, hurt);
  run(sim, PUFFER.INFLATE + 0.05, px, py, pz, true, hurt);
  const c = sim.clouds.find((k) => k.on); assert.ok(c);
  const burst = hurt.total(); assert.equal(burst, 20);
  run(sim, 4, c.x + 1, c.y, c.z, true, hurt); // inside
  assert.ok(sim.inPoison);
  assert.ok(Math.abs(hurt.total() - burst - 20) <= 2.5 + 1e-6, `4 s inside: ${hurt.total() - burst}`);
  const mid = hurt.total();
  run(sim, 2, c.x + 3.5, c.y, c.z, true, hurt); // just outside 3 m
  assert.equal(hurt.total(), mid); assert.ok(!sim.inPoison);
  run(sim, 10, c.x, c.y, c.z, true, hurt); // back in until it fades
  assert.ok(!c.on, 'cloud gone after 9 s');
  for (const [, cause] of hurt.log.slice(1)) assert.equal(cause, 'poison');
  // whole cloud life spent inside: 9 s * 5 = 45
  const s2 = setup(), g = first(s2), h2 = hurtLog();
  s2.step(1 / 60, g.x + 1, g.y, g.z, true, h2);
  run(s2, PUFFER.INFLATE + 0.02, g.x + 1, g.y, g.z, true, h2);
  const c2 = s2.clouds.find((k) => k.on), before = h2.total();
  run(s2, 12, c2.x, c2.y, c2.z, true, h2);
  assert.ok(Math.abs(h2.total() - before - 45) <= 2.5 + 1e-6, `full cloud ${h2.total() - before}`);
});

test('kill before burst: two wooden spear jabs (or one metal) and it never bursts', () => {
  const sim = setup(() => 0.9), f = first(sim), hurt = hurtLog();
  const ox = f.x, oy = f.y, oz = f.z + 2; // 2 m away, looking at it along -z
  assert.equal(sim.spear(ox, oy, oz, 0, 0, 1, 2.8, SPEAR_DAMAGE.spear), -1, 'facing away misses');
  assert.equal(sim.spear(ox + 2, oy, oz, 0, 0, -1, 2.8, SPEAR_DAMAGE.spear), -1, 'off to the side misses');
  assert.equal(sim.spear(ox, oy, oz + 5, 0, 0, -1, 2.8, SPEAR_DAMAGE.spear), -1, 'out of reach misses');
  const i = sim.spear(ox, oy, oz, 0, 0, -1, 2.8, SPEAR_DAMAGE.spear);
  assert.ok(i >= 0); assert.equal(f.hp, 3); assert.equal(f.state, PUFF.INFLATE, 'a poke sets it off'); assert.equal(sim.lastKill, 0);
  run(sim, 0.7, ox, oy, oz, true, hurt); // spear cooldown
  assert.equal(f.state, PUFF.INFLATE);
  assert.ok(sim.spear(ox, oy, f.z + 2, 0, 0, -1, 2.8, SPEAR_DAMAGE.spear) >= 0);
  assert.equal(f.state, PUFF.DEAD); assert.equal(sim.lastKill, 1);
  run(sim, 3, ox, oy, oz, true, hurt);
  assert.equal(hurt.log.length, 0); assert.equal(sim.bursts, 0); assert.ok(sim.clouds.every((c) => !c.on));
  const s2 = setup(() => 0.1), g = first(s2);
  assert.ok(s2.spear(g.x, g.y, g.z + 1.5, 0, 0, -1, 2.8, SPEAR_DAMAGE.metalspear) >= 0);
  assert.equal(g.state, PUFF.DEAD); assert.equal(s2.lastKill, 2);
});

test('drops: 1 Puffer Goo, plus a second one a third of the time', () => {
  assert.equal(gooDrop(0.0), 2); assert.equal(gooDrop(0.32), 2); assert.equal(gooDrop(0.34), 1); assert.equal(gooDrop(0.99), 1);
  let n = 0, two = 0; let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 3000; i++) { const g = gooDrop(rnd()); n += g; if (g === 2) two++; }
  assert.ok(two / 3000 > 0.29 && two / 3000 < 0.37, `extra rate ${two / 3000}`);
  assert.equal(ITEMS.goo.name, 'Puffer Goo'); assert.equal(ITEMS.goo.recipe, null);
  const b = new Bag({ slots: new Array(28).fill(null), selected: 0 });
  assert.equal(b.add('goo', 2), 0); assert.equal(b.count('goo'), 2);
});

test('smelter cooks Puffer Goo into Blast Powder', () => {
  const r = stationRecipeFor('smelter', 'goo');
  assert.equal(r?.id, 'blastpowder'); assert.equal(ITEMS.blastpowder.name, 'Blast Powder');
  assert.deepEqual({ ...ITEMS.blastpowder.recipe.cost }, { goo: 1 });
  assert.deepEqual(ITEMS.blastpowder.unlock, { type: 'station', station: 'smelter' });
});

test('respawn: leaving the island area and coming back brings them back; a new island lays out fresh', () => {
  const sim = setup(), n = sim.alive();
  for (const f of sim.fish) if (f.state !== PUFF.DEAD) sim.spear(f.x, f.y, f.z + 1, 0, 0, -1, 2.8, 10);
  assert.equal(sim.alive(), 0);
  sim.area(KEY, R, R + PUFFER.ENTER - 1); assert.equal(sim.alive(), 0, 'still around: stays cleared');
  sim.area(KEY, R, R + PUFFER.LEAVE - 1); assert.equal(sim.alive(), 0);
  sim.area(KEY, R, R + PUFFER.LEAVE + 1); assert.ok(sim.away);
  sim.area(KEY, R, R + PUFFER.ENTER + 1); assert.equal(sim.alive(), 0, 'not back yet');
  sim.area(KEY, R, R + PUFFER.ENTER - 1); assert.ok(!sim.away); assert.ok(sim.alive() >= PUFFER.MIN, 'respawned');
  sim.area(null, 0, 0); assert.equal(sim.alive(), 0, 'island gone');
  sim.area(KEY + 1, R, 0); assert.ok(sim.alive() >= PUFFER.MIN);
  void n;
});

test('spear target list: registered targets take hits, removed ones do not', () => {
  let got = null;
  const off = ST.addSpearTarget((o, d, reach, dmg) => { got = [o.x, d.z, reach, dmg]; return o.x === 1; });
  assert.equal(ST.trySpearTargets({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 2.8, 5), true);
  assert.deepEqual(got, [1, -1, 2.8, 5]);
  assert.equal(ST.trySpearTargets({ x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 2.8, 5), false);
  off();
  assert.equal(ST.trySpearTargets({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 2.8, 5), false);
  const bad = ST.addSpearTarget(() => { throw new Error('boom'); });
  const orig = console.error; console.error = () => {};
  try { assert.equal(ST.trySpearTargets({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 1, 1), false); } finally { console.error = orig; bad(); }
});

test('spear and melee targets share one list: one jab lands on one creature only', async () => {
  const MT = await import(new URL('melee-targets.js' + STAMP, base));
  const calls = [];
  const offA = ST.addSpearTarget(() => { calls.push('puffer'); return true; });
  const offB = MT.addMeleeTarget(() => { calls.push('boar'); return true; });
  assert.equal(ST.trySpearTargets({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 2.8, 5), true);
  assert.deepEqual(calls, ['puffer'], 'the first hit ends the jab');
  assert.equal(MT.tryMelee, ST.trySpearTargets);
  offA();
  calls.length = 0; ST.trySpearTargets({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 2.8, 5);
  assert.deepEqual(calls, ['boar']);
  offB(); offB();
  assert.equal(ST.trySpearTargets({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 2.8, 5), false, 'disposed targets are gone');
});

test('step ignores bad input', () => {
  const sim = setup(), f = first(sim);
  sim.step(NaN, 0, 0, 0, true, null); sim.step(-1, 0, 0, 0, true, null);
  assert.equal(f.state, PUFF.IDLE);
  sim.step(1 / 60, f.x + 1, f.y, f.z, true, null); // no hurt callback: still runs
  run(sim, 2, f.x + 1, f.y, f.z, true, null);
  assert.equal(f.state, PUFF.DEAD);
});

test('content module: two draw calls, hidden without an island, goo action needs the island', async () => {
  const T = await import(new URL('vendor/three.module.js', base));
  const { createPuffers } = await import(new URL('puffer.js' + STAMP, base));
  const scene = new T.Scene(), camera = new T.PerspectiveCamera();
  const emitted = [];
  const ctx = { T, scene, camera, ocean: { getHeight: () => 0 }, physics: { x: 0, y: -1, z: 0, swimming: true }, running: true, elapsed: 1,
    notice() {}, play() {}, hurtPlayer() { return 0; }, action() {}, emit: (e, to) => emitted.push([e, to]), other: null };
  const mod = createPuffers(ctx);
  assert.equal(mod.name, 'puffer');
  mod.update(1 / 60);
  const g = scene.getObjectByName('bloatfish');
  assert.ok(g && !g.visible, 'hidden with no island');
  const drawables = []; g.traverse((o) => { if (o.isMesh || o.isPoints) drawables.push(o); });
  assert.equal(drawables.length, 2, 'one instanced mesh + one points');
  assert.ok(drawables[0].isInstancedMesh && drawables[0].count === PUFFER.MAX);
  const bag = new Bag({ slots: new Array(28).fill(null), selected: 0 });
  assert.equal(mod.action({ kind: 'nope' }, 'host', bag), false);
  assert.equal(mod.action({ kind: 'puffer:goo', n: 2 }, 'host', bag), true);
  assert.equal(bag.count('goo'), 0, 'no island nearby: no goo');
  mod.dispose();
  assert.ok(!scene.getObjectByName('bloatfish'));
});
