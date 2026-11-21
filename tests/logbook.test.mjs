// Unit tests for the logbook pure module: notes in bottles and achievements.
// Run: node --test tests/logbook.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const {
  NOTES, NOTE_COUNT, BOTTLE_CHANCE, CRAFT_KINDS, ACHIEVEMENTS, ACHIEVEMENT_IDS,
  cleanProgress, nextNote, shouldSpawnBottle, evaluate, achievementName,
} = await import(new URL('logbook.js', base));

const TABLE = ['floor1', 'tiles25', 'fish1', 'fish10', 'supplies100', 'craft_sail', 'craft_palm', 'craft_lantern', 'craft_net', 'craft_bench', 'craft_crate', 'homestead', 'sit1', 'repair1', 'note1', 'notes_all'];
const tiles = n => Array.from({ length: n }, (_, i) => [i % 5, Math.floor(i / 5)]);
const w = (o = {}) => ({ tiles: tiles(9), decor: [], fish: 0, collected: 0, items: [], notes: [], achievements: [], ...o });
const all12 = Array.from({ length: 12 }, (_, i) => i);

test('constants: 12 notes and 16 achievements in table order', () => {
  assert.equal(NOTE_COUNT, 12);
  assert.equal(NOTES.length, 12);
  for (const n of NOTES) { assert.equal(typeof n, 'string'); assert.ok(n.length > 0 && n.length <= 300); }
  assert.equal(ACHIEVEMENTS.length, 16); // [sit] +sit1
  assert.deepEqual([...ACHIEVEMENT_IDS], TABLE);
  assert.equal(new Set(ACHIEVEMENT_IDS).size, 16);
  for (const a of ACHIEVEMENTS) {
    for (const k of ['name', 'desc', 'icon']) assert.ok(typeof a[k] === 'string' && a[k].length > 0, `${a.id}.${k}`);
    assert.ok(Object.isFrozen(a));
  }
  assert.deepEqual([...CRAFT_KINDS], ['sail', 'palm', 'lantern', 'net', 'bench', 'crate']);
  assert.equal(BOTTLE_CHANCE, 1 / 25);
});

test('cleanProgress sanitises anything', () => {
  for (const v of [undefined, null, 0, 'x', [], { notes: 'a', achievements: 5 }]) assert.deepEqual(cleanProgress(v), { notes: [], achievements: [] });
  assert.deepEqual(cleanProgress({ notes: [3, 1, 3, -1, 12, 2.5, '4', null, 0] }).notes, [3, 1, 0]);
  assert.equal(cleanProgress({ notes: [...all12, ...all12].reverse() }).notes.length, 12);
  assert.deepEqual(cleanProgress({ achievements: ['fish1', 'nope', 'fish1', 3, 'floor1'] }).achievements, ['fish1', 'floor1']);
  const src = { notes: [1, 2], achievements: ['fish1'] }, out = cleanProgress(src);
  assert.notEqual(out.notes, src.notes); assert.notEqual(out.achievements, src.achievements);
});

test('nextNote picks the lowest unfound note', () => {
  assert.equal(nextNote([]), 0);
  assert.equal(nextNote([0, 1, 3]), 2);
  assert.equal(nextNote(all12), -1);
  assert.equal(nextNote('garbage'), 0);
  assert.equal(nextNote(undefined), 0);
});

test('shouldSpawnBottle: one bottle at a time, none after all notes', () => {
  assert.equal(shouldSpawnBottle(w({ notes: all12 }), 1, 0), false);
  assert.equal(shouldSpawnBottle(w({ items: [{ id: 2, type: 'bottle' }] }), 1, 0), false);
  assert.equal(shouldSpawnBottle(w({ items: [{ id: 1, type: 'bottle' }] }), 1, 0), true);
  assert.equal(shouldSpawnBottle(w(), 1, BOTTLE_CHANCE - 1e-9), true);
  assert.equal(shouldSpawnBottle(w(), 1, BOTTLE_CHANCE), false);
  assert.equal(shouldSpawnBottle({}, 1, 0), true);
});

test('evaluate: state rules', () => {
  assert.deepEqual(evaluate(w({ tiles: tiles(9) }), [], { kind: 'build' }), []);
  assert.deepEqual(evaluate(w({ tiles: tiles(10) }), [], { kind: 'build' }), ['floor1']);
  assert.deepEqual(evaluate(w({ tiles: tiles(25) }), [], { kind: 'build' }), ['floor1', 'tiles25']);
  assert.deepEqual(evaluate(w({ fish: 10 }), [], { kind: 'fish' }), ['fish1', 'fish10']);
  assert.deepEqual(evaluate(w({ collected: 100 }), [], { kind: 'collect' }), ['supplies100']);
  assert.deepEqual(evaluate(w({ fish: 10, achievements: ['fish1'] }), [], { kind: 'fish' }), ['fish10']);
  const world = w({ tiles: tiles(25), fish: 3, notes: [0], achievements: ['floor1'], decor: [{ type: 'sail', x: 0, z: 0 }] });
  const before = structuredClone(world);
  evaluate(world, [], { kind: 'retro' });
  assert.deepEqual(world, before);
  assert.deepEqual(evaluate({}, null, null), []);
});

test('evaluate: craft and repair events', () => {
  assert.deepEqual(evaluate(w(), [], { kind: 'craft', crafted: 'sail' }), ['craft_sail']);
  assert.deepEqual(evaluate(w(), [], { kind: 'craft', crafted: 'hook' }), []);
  assert.deepEqual(evaluate(w(), [], { kind: 'repair' }), ['repair1']);
  const decor = CRAFT_KINDS.map((type, x) => ({ type, x, z: 0 }));
  const got = evaluate(w({ decor }), [{ count: () => 5 }], { kind: 'build' });
  assert.ok(!got.some(id => id.startsWith('craft_') || id === 'repair1'), got.join());
});

test('evaluate: retroactive pass', () => {
  const decor = CRAFT_KINDS.map((type, x) => ({ type, x, z: 0 }));
  assert.deepEqual(evaluate(w({ decor }), [], { kind: 'retro' }), [...CRAFT_KINDS.map(k => 'craft_' + k), 'homestead']);
  assert.deepEqual(evaluate(w(), [{ count: k => (k === 'lantern' ? 1 : 0) }], { kind: 'retro' }), ['craft_lantern']);
  assert.deepEqual(evaluate(w(), [null, { count: k => (k === 'net' ? 2 : 0) }, null], { kind: 'retro' }), ['craft_net']);
  assert.ok(!evaluate(w(), [{ count: () => 9 }], { kind: 'retro' }).includes('repair1'));
});

test('evaluate: notes and table order', () => {
  assert.deepEqual(evaluate(w({ notes: [4] }), [], { kind: 'note' }), ['note1']);
  assert.deepEqual(evaluate(w({ notes: all12 }), [], { kind: 'note' }), ['note1', 'notes_all']);
  const mix = evaluate(w({ notes: all12, fish: 1, tiles: tiles(10) }), [], { kind: 'repair' });
  assert.deepEqual(mix, TABLE.filter(id => mix.includes(id)));
  assert.deepEqual(mix, ['floor1', 'fish1', 'repair1', 'note1', 'notes_all']);
});

test('achievementName', () => {
  assert.equal(achievementName('fish1'), 'Splash Hello');
  assert.equal(achievementName('mystery'), 'mystery');
});

test('progress survives a JSON round trip', () => {
  const p = { notes: [5, 0, 11], achievements: ['note1', 'fish1', 'craft_bench'] };
  assert.deepEqual(cleanProgress(JSON.parse(JSON.stringify(p))), p);
});
