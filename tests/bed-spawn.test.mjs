// Bed as a respawn point (Raft): sleeping in or using a bed sets spawn[role]; fainting wakes you beside it.
// Run: node --test tests/bed-spawn.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { cleanSleep, defaultSleep, spawnBed, respawnSpot, createSleep, TEXT } = await import(new URL('sleep.js', base));
const { createContent } = await import(new URL('content.js', base));
const { removeTile } = await import(new URL('shark.js', base));

const grid3 = () => Array.from({ length: 9 }, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]);
const night = { phase: .8, optOut: false, ready: true }, noon = { phase: .3, optOut: false, ready: true };
function makeSleep({ role = 'solo', decor = [{ type: 'bed', x: 1, z: 0 }], tiles = grid3(), dayRef = { ...night } } = {}) {
  const emits = [], notices = [], calls = [];
  const world = { tiles, decor };
  const ctx = { T, world, role, physics: { x: 2, y: 1.8, z: 1, vx: 0, vy: 0, vz: 0, grounded: true }, other: null, camera: null, raft: null,
    deckY: () => .2, uiOpen: () => false, emit: (e, to) => emits.push({ e, to }), notice: s => notices.push(s), localBag: () => null };
  const mod = createSleep(ctx, { day: () => dayRef });
  ctx.action = a => { calls.push(a); if (ctx.role !== 'guest' && a.kind.startsWith('sleep.')) mod.action(a, 'host'); };
  return { ctx, mod, emits, notices, calls, world, dayRef };
}
const aimAtBed = ctx => { ctx.camera = { position: new T.Vector3(2, 1.8, 1.5), getWorldDirection: v => v.set(0, -.6, -.4).normalize() }; };

test('cleanSleep keeps valid spawn tiles per role and drops junk', () => {
  assert.deepEqual(defaultSleep().spawn, { host: null, guest: null });
  assert.deepEqual(cleanSleep({ spawn: { host: [1, 0], guest: [-2, 3] } }).spawn, { host: [1, 0], guest: [-2, 3] });
  for (const junk of [null, 'x', [], { host: [1.5, 0] }, { host: [99, 0] }, { guest: ['a', 1] }, { host: [1] }]) {
    assert.deepEqual(cleanSleep({ spawn: junk }).spawn, { host: null, guest: null }, JSON.stringify(junk));
  }
});

test('spawn selection: the bed tile while it still holds a bed, else null (raft centre)', () => {
  const world = { tiles: grid3(), decor: [{ type: 'bed', x: 1, z: 0 }, { type: 'crate', x: -1, z: 0 }] };
  const sl = cleanSleep({ spawn: { host: [1, 0], guest: [-1, 0] } });
  assert.deepEqual(spawnBed(sl, 'host', world), [1, 0]);
  assert.equal(spawnBed(sl, 'guest', world), null, 'a crate is not a bed');
  assert.equal(spawnBed(defaultSleep(), 'host', world), null);
  assert.equal(spawnBed(sl, 'host', { tiles: [[0, 0]], decor: world.decor }), null, 'tile gone');
  assert.equal(spawnBed(sl, 'host', null), null);
  const out = { x: 9, z: 9 };
  assert.equal(respawnSpot(sl, 'host', world, out), true);
  assert.deepEqual(out, { x: 0, z: 0 }, 'free neighbour (0,0) beside the bed at (1,0)');
  assert.equal(respawnSpot(sl, 'guest', world, out), false);
});

test('sleeping in a bed sets the respawn point once and says so; the save keeps it', () => {
  const { mod, emits } = makeSleep();
  mod.action({ kind: 'sleep.lie', x: 1, z: 0 }, 'host');
  assert.deepEqual(mod.serialize().spawn, { host: [1, 0], guest: null });
  assert.deepEqual(emits.map(e => e.e.text), [TEXT.spawnSet]); assert.equal(emits[0].to, 'host');
  mod.action({ kind: 'sleep.up' }, 'host'); mod.action({ kind: 'sleep.lie', x: 1, z: 0 }, 'host');
  assert.equal(emits.length, 1, 'same bed again: no repeat notice');
  const saved = JSON.parse(JSON.stringify(mod.serialize()));
  const b = makeSleep(); b.mod.load(saved, 'save');
  assert.deepEqual(b.mod.serialize().spawn, { host: [1, 0], guest: null });
  assert.deepEqual(b.mod.serialize().in, { host: null, guest: null }, 'nobody starts in bed');
});

test('by day, E on a bed sets the respawn point (no sleeping); a second E says not sleepy', () => {
  const { mod, ctx, notices, emits } = makeSleep({ dayRef: { ...noon } });
  aimAtBed(ctx);
  assert.equal(mod.prompt(null), TEXT.spawn);
  assert.equal(mod.interact(null), true);
  assert.deepEqual(mod.serialize().spawn.host, [1, 0]); assert.equal(mod.serialize().in.host, null);
  assert.equal(emits.at(-1).e.text, TEXT.spawnSet);
  assert.equal(mod.prompt(null), TEXT.notSleepy);
  mod.interact(null); assert.equal(notices.at(-1), TEXT.notSleepy);
});

test('host validates sleep.spawn per role: bed, reach; the guest gets its own spawn', () => {
  const { mod, ctx } = makeSleep({ decor: [{ type: 'bed', x: 1, z: 0 }, { type: 'bed', x: -1, z: 0 }, { type: 'crate', x: 0, z: 1 }] });
  mod.action({ kind: 'sleep.spawn', x: 0, z: 1 }, 'host'); assert.equal(mod.serialize().spawn.host, null);
  mod.action({ kind: 'sleep.spawn', x: 'a', z: 1 }, 'host'); assert.equal(mod.serialize().spawn.host, null);
  mod.action({ kind: 'sleep.spawn', x: -1, z: 0 }, 'guest'); assert.equal(mod.serialize().spawn.guest, null, 'guest pose unknown');
  ctx.other = { x: -2, z: 0 };
  mod.action({ kind: 'sleep.spawn', x: -1, z: 0 }, 'guest'); assert.deepEqual(mod.serialize().spawn.guest, [-1, 0]);
  ctx.physics.x = 20; mod.action({ kind: 'sleep.spawn', x: 1, z: 0 }, 'host'); assert.equal(mod.serialize().spawn.host, null, 'out of reach');
  ctx.physics.x = 2; mod.action({ kind: 'sleep.spawn', x: 1, z: 0 }, 'host'); assert.deepEqual(mod.serialize().spawn.host, [1, 0]);
});

test('removing the bed or losing its tile to the shark clears the spawn', () => {
  const s = makeSleep({ decor: [{ type: 'bed', x: 1, z: 0 }, { type: 'bed', x: -1, z: 0 }] });
  s.ctx.other = { x: -2, z: 0 };
  s.mod.action({ kind: 'sleep.spawn', x: 1, z: 0 }, 'host'); s.mod.action({ kind: 'sleep.spawn', x: -1, z: 0 }, 'guest');
  s.mod.update(1 / 60); assert.deepEqual(s.mod.serialize().spawn, { host: [1, 0], guest: [-1, 0] });
  s.world.decor.splice(0, 1); s.mod.update(1 / 60);
  assert.deepEqual(s.mod.serialize().spawn, { host: null, guest: [-1, 0] });
  assert.equal(removeTile(s.world, -1, 0), true); s.mod.update(1 / 60);
  assert.deepEqual(s.mod.serialize().spawn, { host: null, guest: null });
});

test('guest: respawn reads its own role from the host copy; net changes of spawn alone are picked up', () => {
  const g = makeSleep({ role: 'guest' });
  const st = { v: 1, in: { host: null, guest: null }, fade: 0, skips: 0, spawn: { host: [1, 0], guest: null } };
  g.mod.load(st, 'net');
  const out = { x: 0, z: 0 };
  assert.equal(g.mod.respawn(out), false, 'the host bed is not the guest bed');
  g.mod.load({ ...st, spawn: { host: [1, 0], guest: [1, 0] } }, 'net');
  assert.equal(g.mod.respawn(out), true); assert.deepEqual(out, { x: 0, z: 0 });
});

test('content registry: respawn hook goes to the sleep module; game.js wakes there or at the raft centre', () => {
  const s = makeSleep();
  const reg = createContent(s.ctx, [() => s.mod]);
  const out = { x: 5, z: 5 };
  assert.equal(reg.respawn(out), false);
  s.mod.action({ kind: 'sleep.lie', x: 1, z: 0 }, 'host');
  assert.equal(reg.respawn(out), true); assert.deepEqual(out, { x: 0, z: 0 });
  const src = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');
  assert.ok(src.includes('content?.respawn(wakeSpot)'));
  assert.ok(src.includes("bed ? wakeSpot : spawnPoint(0, 0)"));
});
