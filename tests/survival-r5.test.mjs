// Round-5 survival regressions: vitals reset on a new/loaded raft, the solo pause freezes the shark and damage,
// cups aimed at a busy purifier/planter say why instead of drinking, the shark never splits the raft,
// a sunk crate is named, and spearing a non-attacking shark keeps the raft-attack timer.
// Run: node --test tests/survival-r5.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = name => readFileSync(fileURLToPath(new URL(name, base)), 'utf8');
const game = src('game.js');
const V = await import(new URL('vitals.js', base));
const S = await import(new URL('shark.js', base));
const T = await import(new URL('vendor/three.module.js', base));
const { Bag } = await import(new URL('inventory-state.js', base));
const SR = await import(new URL('storage-research.js', base));

const fnBody = (name) => {
  const i = game.indexOf(`function ${name}(`); assert.ok(i >= 0, `${name} exists`);
  const j = game.indexOf('\n  }\n', i); return game.slice(i, j);
};

// ---------------------------------------------------------------- S1
test('S1: loadRaft resets the vitals from the new world (and newGame / adoptStoredSave go through it)', () => {
  const load = fnBody('loadRaft');
  assert.match(load, /if \(!keepVitals\) resetVitals\(world\.vitals\)/);
  const reset = fnBody('resetVitals');
  assert.match(reset, /Object\.assign\(vitals, newVitals\(saved\)\)/);
  assert.match(reset, /fainted = -1/);
  assert.match(reset, /eating = null/);
  assert.match(reset, /vitalsUI\?\.faint\(false\)/);
  assert.match(reset, /vitalsUI\?\.update\(vitals, false\)/, 'hiding the HUD for a frame clears the starving vignette');
  assert.match(fnBody('newGame'), /loadRaft\(\{world:w/);
  assert.match(game, /function adoptStoredSave\(\) \{ loadRaft\(savedOwnRaft\(\)\)/);
  assert.match(fnBody('restoreOwnRaft'), /loadRaft\(b, true\)/, 'a guest going home keeps its own bars');
});
test('S1: newVitals(world.vitals) is a full, awake set of bars for a fresh world', () => {
  const old = V.newVitals({ hp: 3, food: 0, water: 0 }); old.starving = true; old.hurtAt = 99; old.clock = 120;
  Object.assign(old, V.newVitals(undefined));
  assert.deepEqual({ hp: old.hp, food: old.food, water: old.water, starving: old.starving, hurtAt: old.hurtAt, clock: old.clock },
    { hp: 100, food: 100, water: 100, starving: false, hurtAt: -Infinity, clock: 0 });
  const saved = V.newVitals({ hp: 40, food: 20, water: 70 });
  assert.equal(saved.hp, 40); assert.equal(saved.food, 20); assert.equal(saved.water, 70);
});

// ---------------------------------------------------------------- S2
test('S2: the solo pause gates the shark, hurtPlayer and the faint countdown; co-op is not paused', () => {
  assert.match(game, /const soloPaused = \(\) => role === 'solo' && dialogOpen\(\);/);
  assert.match(fnBody('hurtPlayer'), /if \(!running \|\| fainted >= 0 \|\| soloPaused\(\)\) return 0;/);
  const uv = fnBody('updateVitals');
  const faintAt = uv.indexOf('if (fainted >= 0)'), gate = uv.indexOf('if (dialog && soloPaused()) return; // paused mid-faint'), tick = uv.indexOf('fainted += dt');
  assert.ok(faintAt >= 0 && gate > faintAt && tick > gate, 'the faint countdown waits while paused');
  assert.match(game, /shark\.update\(dialog && soloPaused\(\) \? 0 : dt, elapsed, running\)/);
});
test('S2: a zero-dt shark step changes nothing (that is how the pause freezes it)', () => {
  const w = { tiles: [[0, 0], [1, 0], [0, 1], [1, 1]], tileHp: {} };
  const s = S.createSharkState(null, () => 0.3); S.forceAttack(s, w, () => 0.3);
  const before = JSON.stringify(s); S.step(s, 0, w, { preys: [] });
  assert.equal(JSON.stringify(s), before);
});

// ---------------------------------------------------------------- S3
test('S3: a cup aimed at a watering target with a why shows it instead of drinking', () => {
  const use = fnBody('useSelected');
  assert.match(use, /if \(w\?\.click\) \{ swing = 1; action\(w\.click\); \} else if \(w\?\.why\) notice\(w\.why\); else startEat\(kind\);/);
  assert.match(game, /function notice\([^)]*\) \{[^\n]*pickupFeed\.note/, 'notice is the side feed, never a centred popup');
  assert.match(fnBody('updateEatTip'), /!\(waterAim\?\.why && CUP_KINDS\.includes\(selectedKind\(\)\)\)/, 'the crosshair prompt shows the why, not "Drink"');
  const wt = fnBody('wateringTarget');
  assert.match(wt, /Purifying… \$\{PURIFY_SECONDS - e\.t\}s`; return \{\.\.\.none, prompt:t, why:t\}/);
});

// ---------------------------------------------------------------- S4
const line = n => Array.from({ length: n }, (_, i) => [i, 0]);
test('S4: a 1-wide bridge tile is never a shark target', () => {
  assert.deepEqual(S.edgeTiles(line(5)), [[0, 0], [4, 0]]);
  // two 2x2 blocks joined by one tile at (2, 0)
  const dumbbell = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [3, 0], [4, 0], [3, 1], [4, 1]];
  const e = S.edgeTiles(dumbbell);
  assert.ok(!e.some(([x, z]) => x === 2 && z === 0), 'the bridge is skipped');
  assert.ok(!e.some(([x, z]) => x === 1 && z === 0) && !e.some(([x, z]) => x === 3 && z === 0), 'the bridge ends are cut tiles too');
  assert.equal(S.splitsRaft(dumbbell, 2, 0), true); assert.equal(S.splitsRaft(dumbbell, 0, 1), false);
  for (let i = 0; i < 40; i++) {
    const t = S.pickTarget(dumbbell, null);
    assert.equal(S.splitsRaft(dumbbell, t.x, t.z), false);
  }
});
test('S4: if every edge tile is a bridge, the old behaviour is kept', () => {
  const w = [[0, 0], [1, 0], [2, 0]];
  assert.deepEqual(S.edgeTiles(w, { '0,0': 1, '2,0': 1 }), [[1, 0]], 'only the armored ends were safe: bite the middle');
  assert.deepEqual(S.edgeTiles(line(4), { '0,0': 1, '3,0': 1 }), [[1, 0], [2, 0]], 'every candidate is a bridge: fall back to all of them');
  assert.deepEqual(S.edgeTiles(grid3()).length, 8, 'a solid 3x3 is unchanged');
});
test('S4: biting a long line raft never splits it', () => {
  const w = { tiles: line(6), tileHp: {} }, s = S.createSharkState(null, () => 0.5), env = { preys: [], rnd: Math.random };
  let broke = 0; env.hooks = { broke: () => broke++ };
  for (let k = 0; k < 4; k++) { S.forceAttack(s, w, env.rnd); for (let t = 0; t < 120 && s.state !== 'flee'; t += 0.05) S.step(s, 0.05, w, env); for (let t = 0; t < 8; t += 0.05) S.step(s, 0.05, w, env); }
  assert.ok(broke >= 2, 'tiles were bitten off');
  const xs = w.tiles.map(t => t[0]).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) assert.equal(xs[i] - xs[i - 1], 1, `raft stays one piece: ${xs}`);
});
function grid3() { const o = []; for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) o.push([x, z]); return o; }

test('S4: a crate torn off with the foundation names the items that sank', () => {
  const world = { tiles: grid3(), decor: [{ type: 'crate', x: 1, z: 0 }], stock: {}, items: [], hostInventory: new Bag().snapshot(), guestInventory: new Bag().snapshot(), ext: {} };
  const ctx = { T, world, role: 'solo', running: true, physics: { x: 0, z: 0 }, other: null, camera: null, raft: null,
    localBag: () => new Bag(), actorBag: () => new Bag(), emit() {}, notice() {}, rebuildRaft() {}, releaseLock() {}, requestLock() {}, action() {} };
  const mod = SR.createStorage(ctx);
  mod.debug.fill(1, 0, [{ kind: 'wood', count: 10 }, { kind: 'leaf', count: 2 }]);
  assert.equal(mod.dropTile(1, 0), 12);
  assert.equal(mod.dropTile(1, 0), 0, 'nothing left there');
  assert.equal(SR.chestCount([null, { kind: 'wood', count: 3 }]), 3);
  assert.match(game, /const sank = Number\(content\?\.mods\?\.find\(m => m\.name === 'storage'\)\?\.dropTile\?\.\(x, z\)\) \|\| 0;/);
  const m = /const sharkBrokeText = (sank => [^\n]+);/.exec(game); assert.ok(m);
  const text = (0, eval)(m[1]);
  assert.equal(text(12), 'The shark tore a foundation off — the crate on it sank with 12 items');
  assert.equal(text(1), 'The shark tore a foundation off — the crate on it sank with 1 item');
  assert.equal(text(0), 'The shark tore a foundation off the raft!');
  assert.ok(text(9999).length <= 90, 'fits the notice cap');
});

// ---------------------------------------------------------------- S5
test('S5: spearing a circling or hunting shark makes it flee but keeps the raft-attack timer', () => {
  const s = S.createSharkState(null, () => 0.3); s.timer = 50;
  for (let i = 0; i < 3; i++) S.hit(s, 5);
  assert.equal(s.state, 'flee'); assert.equal(s.timer, 50);
  const h = S.createSharkState(null, () => 0.3); h.state = 'hunt'; h.timer = 40;
  S.hit(h, 10); S.hit(h, 10);
  assert.equal(h.state, 'flee'); assert.equal(h.timer, 40);
});
test('S5: repelling a raft attack still restarts the timer', () => {
  const w = { tiles: grid3(), tileHp: {} }, s = S.createSharkState(null, () => 0.4);
  S.forceAttack(s, w, () => 0.2); assert.equal(s.state, 'approach');
  S.hit(s, 15); assert.equal(s.state, 'flee'); assert.equal(s.timer, S.SHARK.ATTACK_EVERY);
});

// ---------------------------------------------------------------- page error: compileAsync isReady
test('three compileAsync tolerates a material disposed mid-compile (no "reading isReady" page error)', () => {
  const three = src('vendor/three.module.js');
  assert.match(three, /if \( program === undefined \|\| program\.isReady\(\) \)/);
});
