import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../dist/shark.js');
const { SHARK, SHARK_LOOT, edgeTiles, pickTarget, removeTile, damageTile, tileHpOf, cleanTileHp, isArmored, createSharkState, cleanShark, saveShark,
  step, hit, kill, loot, lootable, startAttack, forceAttack, spearHits, segSegDist,
  BAIT, SHARK_STATES, STATE_CODE, baitSpot, setBait, clearBait, baitActive } = S;
const { raftExtent } = await import('../dist/wildlife.js');

const grid = (n = 3) => { const t = []; for (let z = -1; z < n - 1; z++) for (let x = -1; x < n - 1; x++) t.push([x, z]); return t; };
const world = (tiles = grid()) => ({ tiles, decor: [], tileHp: {}, pieces: [], garden: {}, purifiers: {} });
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
// Runs the sim in 1/20 s steps until pred(s) or the time limit. Returns the elapsed time (Infinity if never).
function run(s, w, env, secs, pred = () => false) {
  for (let t = 0; t < secs; t += 0.05) { step(s, 0.05, w, env); if (pred(s)) return t; }
  return Infinity;
}

test('edge tiles: tiles with a missing 4-neighbour, armored ones skipped', () => {
  const e = edgeTiles(grid(3)); // 3x3: all but the centre
  assert.equal(e.length, 8);
  assert.ok(!e.some(([x, z]) => x === 0 && z === 0));
  assert.equal(edgeTiles(grid(4)).length, 12); // 4x4 has a 2x2 core
  assert.deepEqual(edgeTiles([[0, 0]]), [[0, 0]]);
  const armor = { '-1,-1': true, '0,-1': true };
  assert.equal(edgeTiles(grid(3), armor).length, 6);
  assert.equal(edgeTiles(grid(3), new Set(['1,1'])).length, 7);
  assert.equal(edgeTiles(grid(3), ['1,1', '1,0']).length, 6);
  assert.ok(isArmored({ '2,3': 1 }, 2, 3) && !isArmored(undefined, 2, 3));
  const all = Object.fromEntries(grid(3).map(([x, z]) => [x + ',' + z, true]));
  assert.equal(pickTarget(grid(3), all), null);
});

test('pickTarget picks an edge tile and an open side', () => {
  for (let k = 0; k < 40; k++) {
    const r = Math.random; const t = pickTarget(grid(3), null, r);
    assert.ok(t && !(t.x === 0 && t.z === 0));
    assert.equal(Math.abs(t.nx) + Math.abs(t.nz), 1);
    assert.ok(!grid(3).some(([x, z]) => x === t.x + t.nx && z === t.z + t.nz), 'side must face open water');
  }
});

test('tile HP: missing = 100, bites deal 20, 5 bites destroy a tile with its decor and pieces', () => {
  const w = world();
  w.decor.push({ type: 'crate', x: 1, z: 1 }, { type: 'bench', x: 0, z: 0 });
  w.garden['1,1'] = { water: 0, grow: 0 };
  w.pieces = [{ t: 'pillar', i: 2, j: 2, l: 0, r: 0 }, { t: 'pillar', i: 0, j: 0, l: 0, r: 0 }]; // corner (2,2) is only on tile (1,1)
  assert.equal(tileHpOf(w.tileHp, 1, 1), 100);
  for (let k = 1; k <= 4; k++) assert.equal(damageTile(w, 1, 1, SHARK.BITE_DMG), 100 - 20 * k);
  assert.equal(w.tileHp['1,1'], 20);
  assert.equal(damageTile(w, 1, 1, SHARK.BITE_DMG), 0);
  assert.equal(w.tiles.length, 8);
  assert.ok(!w.tiles.some(([x, z]) => x === 1 && z === 1));
  assert.deepEqual(w.decor, [{ type: 'bench', x: 0, z: 0 }]);
  assert.equal(w.tileHp['1,1'], undefined);
  assert.equal(w.garden['1,1'], undefined);
  assert.deepEqual(w.pieces, [{ t: 'pillar', i: 0, j: 0, l: 0, r: 0 }]);
  assert.equal(damageTile(w, 5, 5, 20), -1, 'no tile there');
});

test('the last tile is never removed', () => {
  const w = world([[0, 0]]);
  assert.equal(removeTile(w, 0, 0), false);
  for (let k = 0; k < 10; k++) assert.ok(damageTile(w, 0, 0, 20) >= 1);
  assert.equal(w.tiles.length, 1);
  assert.equal(w.tileHp['0,0'], 1);
  // the shark gives up on it instead of biting forever
  const s = createSharkState(null, seq(0.5)); const env = { rnd: seq(0.5), preys: [] };
  assert.ok(forceAttack(s, w, env.rnd));
  assert.notEqual(run(s, w, env, 120, x => x.state === 'flee'), Infinity);
  assert.equal(w.tiles.length, 1);
});

test('attack cycle: circle -> approach -> bite -> tile breaks -> flee -> circle, timer reset', () => {
  const w = world(), s = createSharkState(null, seq(0.3));
  const log = [];
  const env = { rnd: seq(0.1, 0.6, 0.9, 0.3), preys: [], hooks: { bite: (x, z, hp) => log.push(['bite', x, z, hp]), broke: (x, z) => log.push(['broke', x, z]), warn: () => log.push(['warn']) } };
  assert.equal(s.state, 'circle'); assert.equal(s.timer, SHARK.ATTACK_EVERY);
  run(s, w, env, 30);
  assert.equal(s.state, 'circle', 'no attack before the timer');
  assert.ok(Math.abs(Math.hypot(s.x, s.z) - (3 + SHARK.RING_MARGIN)) < 1.5, 'circles at raft extent + 6');
  s.timer = 0.01;
  assert.notEqual(run(s, w, env, 60, x => x.state === 'bite'), Infinity, 'reaches the bite point');
  const tx = s.tx, tz = s.tz;
  assert.ok(Math.hypot(s.x - (tx * 2 + s.nx * SHARK.BITE_OFF), s.z - (tz * 2 + s.nz * SHARK.BITE_OFF)) < 0.01);
  const t = run(s, w, env, 30, x => x.state === 'flee');
  assert.ok(t > 8 && t < 11, 'about 10 s per tile: ' + t);
  assert.deepEqual(log.filter(e => e[0] === 'bite').map(e => e[3]), [80, 60, 40, 20, 0]);
  assert.equal(log.filter(e => e[0] === 'warn').length, 1, 'one warning per attack');
  assert.deepEqual(log.at(-1), ['broke', tx, tz]);
  assert.equal(w.tiles.length, 8);
  assert.equal(s.timer, SHARK.ATTACK_EVERY);
  assert.notEqual(run(s, w, env, 10, x => x.state === 'circle'), Infinity);
});

test('repel: 15 damage within one attack makes it flee and restarts the timer', () => {
  const w = world(), s = createSharkState(null, seq(0.4)); const env = { rnd: seq(0.2, 0.7), preys: [] };
  forceAttack(s, w, env.rnd);
  run(s, w, env, 60, x => x.state === 'bite');
  assert.equal(s.state, 'bite');
  assert.ok(hit(s, 5)); assert.ok(hit(s, 5)); assert.equal(s.state, 'bite');
  assert.ok(hit(s, 5));
  assert.equal(s.state, 'flee'); assert.equal(s.hp, SHARK.HP - 15); assert.equal(s.timer, SHARK.ATTACK_EVERY);
  assert.equal(s.attackDmg, 0);
  assert.equal(w.tiles.length, 9);
});

test('player in the water within range is hunted and bitten every 3.5 s', () => {
  const w = world(), s = createSharkState(null, seq(0.4));
  const hurts = []; const prey = { x: 0, z: 14, swimming: true };
  s.x = 0; s.z = 30;
  const env = { rnd: seq(0.5), preys: [prey], hooks: { hurt: (i, n) => hurts.push([i, n, 0]) } };
  step(s, 0.05, w, env); assert.equal(s.state, 'hunt');
  let t = 0; const times = [];
  for (; t < 20; t += 0.05) { const n = hurts.length; step(s, 0.05, w, env); if (hurts.length > n) times.push(t); }
  assert.ok(hurts.length >= 4, 'bites: ' + hurts.length);
  assert.deepEqual(hurts[0].slice(0, 2), [0, SHARK.PLAYER_BITE]);
  for (let k = 1; k < times.length; k++) assert.ok(Math.abs(times[k] - times[k - 1] - SHARK.LUNGE_EVERY) < 0.11);
  prey.swimming = false; step(s, 0.05, w, env);
  assert.equal(s.state, 'circle', 'back to circling when the player climbs out');
  const far = createSharkState(null, seq(0.4)); far.x = 0; far.z = 60;
  step(far, 0.05, w, { preys: [{ x: 0, z: 14, swimming: true }] });
  assert.equal(far.state, 'circle', 'out of range');
});

test('death, loot once, respawn 180 s later', () => {
  const w = world(), s = createSharkState(null, seq(0.4)); const env = { rnd: seq(0.5), preys: [] };
  let k = 0; while (s.state !== 'dead') { hit(s, 10); k++; if (s.state === 'flee') s.state = 'circle'; }
  assert.equal(k, 15); assert.equal(s.hp, 0);
  assert.equal(hit(s, 10), false);
  assert.ok(lootable(s));
  run(s, w, env, 120);
  assert.equal(s.state, 'dead', 'the body stays until it is harvested');
  const r = Math.hypot(s.x, s.z); assert.ok(r < 6, 'drifts next to the raft: ' + r);
  assert.deepEqual(loot(s), SHARK_LOOT); assert.deepEqual(SHARK_LOOT, { sharkmeat: 4, sharkhead: 1 });
  assert.equal(loot(s), null, 'only once');
  assert.equal(run(s, w, env, SHARK.RESPAWN - 1, x => x.state !== 'dead'), Infinity);
  assert.notEqual(run(s, w, env, 2, x => x.state === 'circle'), Infinity);
  assert.equal(s.hp, SHARK.HP); assert.equal(s.timer, SHARK.ATTACK_EVERY);
});

test('save/load: timer, hp, dead/looted survive; junk is cleaned', () => {
  const s = createSharkState(); s.timer = 42.25; s.hp = 90;
  const v = saveShark(s); assert.deepEqual(v, { v: 1, hp: 90, timer: 42.3, dead: false, looted: false, respawn: 0 });
  const b = createSharkState(JSON.parse(JSON.stringify(v))); assert.equal(b.hp, 90); assert.equal(b.timer, 42.3); assert.equal(b.state, 'circle');
  kill(b); loot(b); b.respawn = 77;
  const c = createSharkState(saveShark(b)); assert.equal(c.state, 'dead'); assert.ok(c.looted); assert.equal(c.respawn, 77);
  assert.deepEqual(cleanShark({ hp: -5, timer: 1e9, dead: 'yes' }), { v: 1, hp: SHARK.HP, timer: SHARK.ATTACK_EVERY, dead: false, looted: false, respawn: 0 });
  assert.deepEqual(cleanShark(undefined).timer, SHARK.ATTACK_EVERY);
  assert.deepEqual(cleanTileHp({ '0,0': 40.4, '1,1': 100, '9,9': 10, '-1,0': 'x', '1,0': -3 }, grid()), { '0,0': 40, '1,0': 1 });
  assert.deepEqual(cleanTileHp(null, grid()), {});
});

test('armored raft: the attack is skipped and the timer restarts', () => {
  const w = world(); w.tileArmor = Object.fromEntries(edgeTiles(w.tiles).map(([x, z]) => [x + ',' + z, true]));
  const s = createSharkState(); s.timer = 0;
  assert.equal(startAttack(s, w), false);
  assert.equal(s.state, 'circle'); assert.equal(s.timer, SHARK.ATTACK_EVERY);
});

test('spear capsule test', () => {
  // shark at origin facing +z, spear from 2 m to the side pointing at it
  assert.ok(spearHits(2, 0, 0, -1, 0, 0, 2.8, 0, 0, 0, 0));
  assert.ok(!spearHits(4, 0, 0, -1, 0, 0, 2.8, 0, 0, 0, 0), 'out of reach');
  assert.ok(!spearHits(2, 0, 0, 1, 0, 0, 2.8, 0, 0, 0, 0), 'pointing away');
  assert.ok(spearHits(1.5, 0, 1.2, -1, 0, 0, 2.8, 0, 0, 0, 0), 'near the head');
  assert.ok(!spearHits(1.5, 0, 1.2, -1, 0, 0, 2.8, 0, 0, 0, Math.PI / 2), 'turned away: that spot is empty water');
  assert.ok(Math.abs(segSegDist(0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1) - 1) < 1e-9);
});

// ------------------------------------------------------------------ Snack Float (docs/specs/snack-float.md section 9)

test('snack float: BAIT constants, snack state appended, STATE_CODE unchanged', () => {
  assert.ok(Object.isFrozen(BAIT));
  assert.equal(BAIT.TIME, 120); assert.equal(BAIT.MAX, 180); assert.equal(BAIT.REACH, 12); assert.equal(BAIT.PAD, 2); assert.equal(BAIT.OUT, 10);
  assert.equal(SHARK_STATES.at(-1), 'snack'); assert.deepEqual(SHARK_STATES.slice(0, 6), ['circle', 'approach', 'bite', 'flee', 'hunt', 'dead']);
  assert.equal(STATE_CODE.gone, 6); assert.equal(Object.keys(STATE_CODE).length, 7); assert.equal(STATE_CODE.snack, undefined);
});

test('snack float: baitSpot keeps the float in the water, clear of the deck and not too far out', () => {
  const t = grid(3);
  assert.equal(baitSpot(t, 0, 0), null); assert.equal(baitSpot(t, 2.5, 0), null, 'on the deck');
  assert.equal(baitSpot(t, NaN, 0), null); assert.equal(baitSpot(t, 500, 0), null); assert.equal(baitSpot(t, 0, Infinity), null);
  const a = baitSpot(t, 3.4, 0); assert.ok(a.x >= 5 && a.z === 0, 'pushed out by PAD: ' + a.x);
  assert.ok(Math.abs(t.reduce((m, [x, z]) => Math.min(m, Math.max(Math.abs(a.x - x * 2), Math.abs(a.z - z * 2))), Infinity) - 1) >= BAIT.PAD - 1e-9);
  const b = baitSpot(t, 40, 0); assert.equal(raftExtent(t), 3); assert.deepEqual(b, { x: 13, z: 0 });
  assert.deepEqual(baitSpot(t, 3.4, 0), a, 'deterministic');
  const out = { x: 0, z: 0 }; assert.equal(baitSpot(t, 8, 0, out), out); assert.deepEqual(out, { x: 8, z: 0 });
});

test('snack float: setBait ok / busy / water, t clamped', () => {
  const t = grid(3), s = createSharkState(null, seq(0.4));
  assert.equal(baitActive(s), false);
  assert.equal(setBait(s, t, 8, 0), 'ok'); assert.equal(s.bt, 120); assert.equal(s.bx, 8); assert.equal(s.bz, 0); assert.ok(baitActive(s));
  assert.equal(setBait(s, t, -8, 3, 50), 'busy'); assert.deepEqual([s.bx, s.bz, s.bt], [8, 0, 120]);
  const w2 = createSharkState(null, seq(0.4));
  assert.equal(setBait(w2, t, 1, 1), 'water'); assert.equal(w2.bt, 0);
  assert.equal(setBait(w2, t, 8, 0, 999), 'ok'); assert.equal(w2.bt, 180);
});

const snackEnv = (log, preys = []) => ({ rnd: seq(0.3, 0.6), preys, hooks: {
  bite: () => log.push('bite'), nibble: (x, z) => log.push(['nibble', x, z]), ate: () => log.push('ate'), hurt: () => log.push('hurt') } });

test('snack float: blocks raft attacks', () => {
  const w = world(), s = createSharkState(null, seq(0.4)), log = [];
  s.timer = 0; assert.equal(setBait(s, w.tiles, 8, 0), 'ok');
  run(s, w, snackEnv(log), 30);
  assert.ok(!log.includes('bite')); assert.deepEqual(w.tileHp, {}); assert.equal(s.state, 'snack'); assert.equal(w.tiles.length, 9);
});

test('snack float: the 120 s drain only at the float', () => {
  const w = world(), s = createSharkState(null, seq(0.4)), log = [], env = snackEnv(log);
  assert.ok(Math.hypot(s.x, s.z) > 25);
  setBait(s, w.tiles, 8, 0);
  run(s, w, env, 1); assert.ok(s.bt > 119.9, 'travel is free: ' + s.bt);
  const t = run(s, w, env, 20, x => x.bitten); assert.ok(t < 20, 'reaches the float');
  const bt0 = s.bt; run(s, w, env, 10);
  assert.ok(Math.abs(bt0 - s.bt - 10) <= 0.1, 'drained ' + (bt0 - s.bt));
  assert.ok(Math.hypot(s.x - 8, s.z) <= BAIT.NIBBLE_R);
});

test('snack float: nibble hook every 2 s at the float', () => {
  const w = world(), s = createSharkState(null, seq(0.4)), log = [], env = snackEnv(log);
  setBait(s, w.tiles, 8, 0); run(s, w, env, 20, x => x.bitten);
  log.length = 0; let maxAnim = 0;
  for (let t = 0; t < 10; t += 0.05) { step(s, 0.05, w, env); maxAnim = Math.max(maxAnim, s.anim); }
  const n = log.filter(e => e[0] === 'nibble');
  assert.ok(Math.abs(n.length - 5) <= 1, 'nibbles: ' + n.length);
  for (const e of n) assert.deepEqual(e, ['nibble', 8, 0]);
  assert.equal(maxAnim, 1);
});

test('snack float: when it is eaten the attack timer starts over from 300 s', () => {
  const w = world(), s = createSharkState(null, seq(0.4)), log = [], env = snackEnv(log);
  s.timer = 5; setBait(s, w.tiles, 8, 0);
  assert.notEqual(run(s, w, env, 200, x => x.bt <= 0), Infinity);
  assert.equal(s.state, 'circle'); assert.ok(Math.abs(s.timer - 300) <= 0.2, 'timer ' + s.timer);
  assert.equal(log.filter(e => e === 'ate').length, 1); assert.equal(s.bitten, false);
  const t = run(s, w, env, 310, x => x.state === 'approach');
  assert.ok(Math.abs(t - 300) <= 0.2, 'next attack after ' + t);
  assert.ok(!log.includes('bite'));
});

test('snack float: a toss mid-attack drops the attack at once', () => {
  const w = world(), s = createSharkState(null, seq(0.4)), env = snackEnv([]);
  assert.ok(forceAttack(s, w, seq(0.2))); assert.equal(s.state, 'approach'); assert.ok(s.hasTarget);
  s.attackDmg = 5; setBait(s, w.tiles, 8, 0); step(s, 0.05, w, env);
  assert.equal(s.state, 'snack'); assert.equal(s.hasTarget, false); assert.equal(s.attackDmg, 0);
});

test('snack float: swimmers are ignored while it snacks, hunted again right after', () => {
  const w = world(), s = createSharkState(null, seq(0.4)), log = [];
  const prey = { x: 9, z: 0, swimming: true }, env = snackEnv(log, [prey]);
  setBait(s, w.tiles, 8, 0); s.bt = BAIT.MAX;
  run(s, w, env, 60);
  assert.ok(!log.includes('hurt')); assert.equal(s.state, 'snack');
  clearBait(s); step(s, 0.05, w, env); assert.equal(s.state, 'circle'); assert.equal(s.bt, 0);
  assert.ok(run(s, w, env, 1, x => x.state === 'hunt') < 1);
});

test('snack float: a spear hit makes it flee, then it comes back to the float', () => {
  const w = world(), s = createSharkState(null, seq(0.4)), env = snackEnv([]);
  setBait(s, w.tiles, 8, 0); run(s, w, env, 20, x => x.bitten);
  assert.ok(hit(s, 15)); assert.equal(s.state, 'flee');
  const bt = s.bt; let t = 0;
  for (; t < 10 && s.state === 'flee'; t += 0.05) { step(s, 0.05, w, env); if (s.state === 'flee') assert.equal(s.bt, bt); }
  assert.ok(Math.abs(t - SHARK.FLEE_TIME) <= 0.1, 'flee ' + t);
  assert.ok(run(s, w, env, 0.2, x => x.state === 'snack') <= 0.2);
});

test('snack float: a dead shark leaves the float waiting; after respawn it goes back to it', () => {
  const w = world(), s = createSharkState(null, seq(0.4)), env = snackEnv([]);
  setBait(s, w.tiles, 8, 0); kill(s);
  run(s, w, env, 60); assert.equal(s.bt, 120); assert.equal(s.state, 'dead');
  assert.ok(loot(s)); run(s, w, env, 181);
  assert.equal(s.state, 'snack'); assert.ok(s.bt > 0);
});

test('snack float: save/load and junk bait', () => {
  const s = createSharkState(); s.timer = 42.25; s.hp = 90;
  const plain = saveShark(s);
  assert.ok(!('bait' in plain)); assert.deepEqual(plain, { v: 1, hp: 90, timer: 42.3, dead: false, looted: false, respawn: 0 });
  setBait(s, grid(3).map(t => t), 8, -2); s.bt = 77.26;
  const v = saveShark(s); assert.deepEqual(v.bait, { x: 8, z: -2, t: 77.3 });
  const b = createSharkState(JSON.parse(JSON.stringify(v))); assert.deepEqual([b.bx, b.bz, b.bt], [8, -2, 77.3]);
  for (const bait of ['x', [1, 2, 3], { x: NaN, z: 0, t: 5 }, { x: 1, z: 1, t: 0 }, { x: 1, z: 1, t: -5 }, { x: 900, z: 0, t: 5 }, null, { x: 1, z: 1 }])
    assert.ok(!('bait' in cleanShark({ v: 1, hp: 50, timer: 10, bait })), JSON.stringify(bait));
  assert.deepEqual(cleanShark({ bait: { x: 1.234, z: -3.456, t: 999 } }).bait, { x: 1.23, z: -3.46, t: 180 });
  const old = { v: 1, hp: 90, timer: 42 };
  assert.deepEqual(cleanShark(old), { v: 1, hp: 90, timer: 42, dead: false, looted: false, respawn: 0 });
  assert.deepEqual(Object.keys(cleanShark(old)), ['v', 'hp', 'timer', 'dead', 'looted', 'respawn']);
});
