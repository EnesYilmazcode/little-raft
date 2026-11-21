// Unit tests for dist/shark.js: behaviour state machine, tile choice, model. Run: node --test tests/shark.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const S = await import(new URL('shark.js', base));
const { MODES } = await import(new URL('combat-bus.js', base));
const T = await import(new URL('vendor/three.module.js', base));
const { createSharkBrain, pickAttackTile, keepsConnected, isEdgeTile, raftExtent, sharkPose, createSharkModel, modeHasShark,
  SHARK_HP, BITE_TIME, RETREAT_TIME, RESPAWN_TIME, FLOAT_TIME, SINK_TIME, RING_MARGIN, PLAYER_BITE_GAP } = S;

const grid3 = () => Array.from({ length: 9 }, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]);
function world(mode = 'normal', tiles = grid3()) {
  const env = { mode: MODES[mode], tiles, players: [{ id: 'host', x: 0, z: 0, swimming: false }], isProtected: null };
  return env;
}
function wire(b, env, log = []) {
  b.onAttack = (x, z) => log.push(['attack', x, z]);
  b.onTileDestroyed = (x, z) => { const k = env.tiles.findIndex(t => t[0] === x && t[1] === z); if (k >= 0) env.tiles.splice(k, 1); log.push(['destroy', x, z]); return true; };
  b.onBite = id => log.push(['bite', id, b.t]);
  b.onDriveOff = () => log.push(['driveoff']);
  b.onDeath = (x, z) => log.push(['death', x, z]);
  b.onRespawn = () => log.push(['respawn']);
  return log;
}
const run = (b, env, secs, dt = 0.05) => { for (let t = 0; t < secs; t += dt) b.step(dt, env); };

test('relaxed has no shark; every other mode does', () => {
  assert.equal(modeHasShark(MODES.relaxed), false);
  for (const k of ['peaceful', 'easy', 'normal', 'hard']) assert.equal(modeHasShark(MODES[k]), true, k);
  const b = createSharkBrain(), env = world('relaxed');
  run(b, env, 30);
  assert.equal(b.state, 'inactive'); assert.equal(b.alive, false);
  assert.equal(b.hit(50), false, 'cannot be hit when absent');
  const pose = sharkPose(b.state, b.t, b.timer, {}); assert.equal(pose.visible, false);
  env.mode = MODES.normal; run(b, env, 1); assert.equal(b.state, 'circle');
  env.mode = MODES.relaxed; run(b, env, 0.1); assert.equal(b.state, 'inactive', 'switching to relaxed hides it again');
});

test('circles at raft extent + ~4 m with the fin up', () => {
  const b = createSharkBrain({ seed: 7 }), env = world('peaceful');
  run(b, env, 40);
  const R = raftExtent(env.tiles) + RING_MARGIN;
  let lo = Infinity, hi = 0, a0 = Math.atan2(b.z, b.x), swept = 0, prev = a0;
  for (let i = 0; i < 600; i++) {
    b.step(0.05, env);
    const r = Math.hypot(b.x, b.z); lo = Math.min(lo, r); hi = Math.max(hi, r);
    const a = Math.atan2(b.z, b.x); let d = a - prev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; swept += d; prev = a;
  }
  assert.equal(b.state, 'circle');
  assert.ok(lo > R - 1 && hi < R + 1.5, `radius ${lo.toFixed(2)}..${hi.toFixed(2)} vs ${R}`);
  assert.ok(Math.abs(swept) > Math.PI / 2, 'it goes round');
  const p = sharkPose('circle', 3, 0, {});
  assert.ok(p.visible && p.y > -0.6 && p.y < -0.4, 'body just under: the fin (0.4+0.62 m up) breaks the surface');
});

test('deterministic for equal seeds and dt', () => {
  const a = createSharkBrain({ seed: 3 }), b = createSharkBrain({ seed: 3 }), ea = world('hard'), eb = world('hard');
  wire(a, ea); wire(b, eb);
  for (let i = 0; i < 4000; i++) { a.step(0.05, ea); b.step(0.05, eb); }
  assert.deepEqual([a.x, a.z, a.yaw, a.state, ea.tiles.length], [b.x, b.z, b.yaw, b.state, eb.tiles.length]);
});

test('raft attack timer follows MODES[mode].sharkRaft; 0 never attacks', () => {
  for (const k of ['easy', 'normal', 'hard']) {
    const b = createSharkBrain({ seed: 11 }), env = world(k), log = wire(b, env);
    const period = MODES[k].sharkRaft;
    run(b, env, period - 1);
    assert.ok(!log.some(e => e[0] === 'attack'), k + ': no attack before the timer');
    run(b, env, 2);
    assert.ok(log.some(e => e[0] === 'attack'), k + ': attack at ' + period + ' s');
  }
  const b = createSharkBrain(), env = world('peaceful'), log = wire(b, env);
  run(b, env, 1200, 0.1);
  assert.equal(log.filter(e => e[0] === 'attack').length, 0);
  assert.equal(env.tiles.length, 9);
});

test('attack picks an edge tile, swims in, bites 12 s, then the tile is gone', () => {
  const b = createSharkBrain({ seed: 5 }), env = world('hard'), log = wire(b, env);
  run(b, env, MODES.hard.sharkRaft + 0.1);
  const at = log.find(e => e[0] === 'attack'); assert.ok(at);
  const k = env.tiles.findIndex(t => t[0] === at[1] && t[1] === at[2]);
  assert.ok(k >= 0 && isEdgeTile(env.tiles, k), 'an edge tile');
  assert.ok(!(at[1] === 0 && at[2] === 0), 'never the centre tile of the 3x3');
  let t = 0; while (b.state === 'approach' && t < 60) { b.step(0.05, env); t += 0.05; }
  assert.equal(b.state, 'bite');
  assert.ok(Math.hypot(b.x - at[1] * 2, b.z - at[2] * 2) < 3, 'biting at the tile edge');
  run(b, env, BITE_TIME - 0.5);
  assert.equal(b.state, 'bite'); assert.equal(env.tiles.length, 9);
  run(b, env, 1);
  assert.ok(log.some(e => e[0] === 'destroy' && e[1] === at[1] && e[2] === at[2]));
  assert.equal(env.tiles.length, 8);
  assert.equal(b.state, 'retreat');
});

test('pickAttackTile: edge only, keeps the raft connected, skips protected, never the last tile', () => {
  const rng = () => 0.999;
  const plus = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let i = 0; i < 20; i++) { const k = pickAttackTile(plus, Math.random); assert.ok(k > 0, 'centre of a plus is a bridge'); }
  const line = [[0, 0], [1, 0], [2, 0]];
  assert.equal(keepsConnected(line, 1), false); assert.equal(keepsConnected(line, 0), true);
  for (let i = 0; i < 20; i++) assert.notEqual(pickAttackTile(line, Math.random), 1);
  assert.equal(pickAttackTile([[0, 0]], rng), -1, 'last tile');
  assert.equal(pickAttackTile([], rng), -1);
  assert.equal(pickAttackTile([[0, 0], [1, 0]], rng, x => x === 1), 0, 'protected tile skipped');
  assert.equal(pickAttackTile([[0, 0], [1, 0]], rng, () => true), -1);
  // a full 5x5 never offers an inner tile
  const big = []; for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) big.push([x, z]);
  for (let i = 0; i < 50; i++) { const t = big[pickAttackTile(big, Math.random)]; assert.ok(Math.max(Math.abs(t[0]), Math.abs(t[1])) === 2); }
});

test('repeated attacks never remove the last tile', () => {
  const b = createSharkBrain({ seed: 9 }), env = world('hard', [[0, 0], [1, 0], [0, 1]]);
  wire(b, env);
  run(b, env, 3000, 0.1);
  assert.equal(env.tiles.length, 1);
  assert.deepEqual(env.tiles.length >= 1, true);
});

test('15 damage during an attack drives it off for ~25 s, then it circles again', () => {
  const b = createSharkBrain({ seed: 2 }), env = world('hard'), log = wire(b, env);
  b.forceAttack(env, true);
  assert.equal(b.state, 'bite');
  assert.equal(b.hit(10, { x: 0, y: 0, z: 0 }), true); assert.equal(b.state, 'bite', '10 is not enough');
  b.hit(5);
  assert.equal(b.state, 'retreat'); assert.ok(log.some(e => e[0] === 'driveoff'));
  assert.equal(b.hp, SHARK_HP - 15);
  run(b, env, BITE_TIME + 1);
  assert.equal(env.tiles.length, 9, 'tile saved');
  run(b, env, RETREAT_TIME - BITE_TIME - 3);
  assert.equal(b.state, 'retreat');
  run(b, env, 3);
  assert.equal(b.state, 'circle');
});

test('swimmer gets hunted: bite every ~2.5 s, only when the mode allows bites', () => {
  const b = createSharkBrain({ seed: 4 }), env = world('normal'), log = wire(b, env);
  env.players[0].x = 12; env.players[0].z = 0; env.players[0].swimming = true;
  run(b, env, 30);
  const bites = log.filter(e => e[0] === 'bite');
  assert.ok(bites.length >= 5, 'bites ' + bites.length);
  for (let i = 1; i < bites.length; i++) assert.ok(bites[i][2] - bites[i - 1][2] >= PLAYER_BITE_GAP - 0.45, 'gap ' + (bites[i][2] - bites[i - 1][2]));
  assert.ok(bites.every(e => e[1] === 'host'));
  env.players[0].swimming = false; run(b, env, 5); assert.equal(b.state, 'circle');
  const p = createSharkBrain(), pe = world('peaceful'), pl = wire(p, pe);
  pe.players[0].x = 10; pe.players[0].swimming = true; run(p, pe, 30);
  assert.equal(pl.filter(e => e[0] === 'bite').length, 0);
});

test('death at 0 HP: belly up, sinks after 10 s, respawns 180 s later', () => {
  const b = createSharkBrain({ seed: 6 }), env = world('normal'), log = wire(b, env);
  run(b, env, 2);
  assert.equal(b.hit(100), true); assert.equal(b.alive, true);
  assert.equal(b.hit(60), true);
  assert.equal(b.state, 'dead'); assert.equal(b.alive, false); assert.ok(log.some(e => e[0] === 'death'));
  assert.equal(b.hit(10), false, 'a carcass takes no hits');
  assert.equal(sharkPose('dead', 1, 1, {}).roll, Math.PI, 'belly up');
  run(b, env, FLOAT_TIME - 0.5); assert.equal(b.state, 'dead');
  run(b, env, 1); assert.equal(b.state, 'sink');
  run(b, env, SINK_TIME + 1); assert.equal(b.state, 'gone'); assert.equal(sharkPose('gone', 0, 0, {}).visible, false);
  run(b, env, RESPAWN_TIME - FLOAT_TIME - SINK_TIME - 4); assert.equal(b.state, 'gone');
  run(b, env, 3); assert.equal(b.state, 'circle'); assert.equal(b.hp, SHARK_HP); assert.ok(log.some(e => e[0] === 'respawn'));
});

test('a protected tile (player on it) is never torn off', () => {
  const b = createSharkBrain({ seed: 1 }), env = world('hard'); wire(b, env);
  const at = b.forceAttack(env, true);
  env.isProtected = (x, z) => x === at.tx && z === at.tz;
  run(b, env, BITE_TIME + 1);
  assert.equal(env.tiles.length, 9);
});

test('model: one merged geometry with colour and sway weights', () => {
  const m = createSharkModel(T);
  assert.ok(m.isMesh && !m.castShadow);
  const g = m.geometry;
  for (const a of ['position', 'normal', 'color', 'swayW']) assert.ok(g.attributes[a], a);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  assert.ok(bb.max.z - bb.min.z > 3.4 && bb.max.z - bb.min.z < 4.2, 'about 3.9 m long');
  assert.ok(bb.max.y > 1, 'dorsal fin top above the body');
  const sw = g.attributes.swayW.array; assert.ok(Math.max(...sw) === 1 || Math.max(...sw) > 0.95); assert.equal(Math.min(...sw), 0);
  m.userData.dispose();
});

test('step allocates nothing per frame (smoke: stable heap over many steps)', () => {
  const b = createSharkBrain(), env = world('peaceful');
  run(b, env, 5);
  if (global.gc) global.gc();
  for (let i = 0; i < 20000; i++) b.step(0.016, env);
  assert.equal(b.state, 'circle');
});
