// Zipline rules (docs/specs/zipline.md) plus a small fake-ctx smoke test of the ride pin.
// Run: node --test tests/zipline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { Bag } = await import(new URL('inventory-state.js', base));
const R = await import(new URL('zipline-rules.js', base));
const { createZipline } = await import(new URL('zipline.js', base));
const { ZIP, cleanZip, canPost, canLink, topOf, span, ropePoint, linePoints, rideStep, landSpot, prune, applyZip, riderEye, nextId } = R;

const tiles = (...c) => c.map(([i, j]) => [i, j]);
const floor = (i, j, l) => ({ t: 'floor', i, j, l, r: 0 });
const st = (posts = [], lines = []) => cleanZip({ v: 1, rev: 1, posts, lines });

test('cleanZip: defaults, junk, dedupe, caps', () => {
  assert.deepEqual(cleanZip(undefined), { v: 1, rev: 0, posts: [], lines: [] });
  for (const j of [null, 3, 'x', [], { rev: -1 }, { rev: 1.5, posts: 'no', lines: {} }]) {
    const c = cleanZip(j); assert.equal(c.rev, 0); assert.deepEqual(c.posts, []); assert.deepEqual(c.lines, []);
  }
  const c = cleanZip({ rev: 4, posts: [{ id: 1, i: 0, j: 0, l: 0 }, { id: 1, i: 1, j: 0, l: 0 }, { id: 2, i: 0, j: 0, l: 0 },
    { id: 3, i: 2, j: 0, l: 6 }, { id: 4, i: 2.5, j: 0, l: 0 }, { id: -1, i: 3, j: 0, l: 0 }, { id: 5, i: 28, j: 0, l: 0 }, { id: 6, i: 3, j: 1, l: 2 }],
    lines: [[1, 6], [6, 1], [1, 9], [1, 1], [1.5, 6]] });
  assert.equal(c.rev, 4);
  assert.deepEqual(c.posts.map(p => p.id), [1, 6]);
  assert.deepEqual(c.lines, [[1, 6]]);
  const many = cleanZip({ posts: Array.from({ length: 20 }, (_, k) => ({ id: k + 1, i: k, j: 0, l: 0 })),
    lines: Array.from({ length: 19 }, (_, k) => [k + 1, k + 2]).concat([[1, 3], [1, 5]]) });
  assert.equal(many.posts.length, 16);
  assert.equal(many.lines.length, 12);
  const per = new Map(); for (const [a, b] of many.lines) { per.set(a, (per.get(a) ?? 0) + 1); per.set(b, (per.get(b) ?? 0) + 1); }
  assert.ok([...per.values()].every(n => n <= 2));
  assert.ok(!many.lines.some(([a, b]) => a === 1 && b === 3));
  assert.equal(nextId(c), 7);
});

test('canPost: deck tile, floor at l=2, nosupport, taken, decor (net is fine)', () => {
  const world = { tiles: tiles([0, 0], [1, 0], [2, 0]), pieces: [floor(1, 0, 2), { t: 'roof', i: 2, j: 0, l: 1, r: 0 }],
    decor: [{ type: 'bench', x: 1, z: 0 }, { type: 'net', x: 2, z: 0 }] };
  const s = st([{ id: 1, i: 0, j: 0, l: 0 }]);
  assert.equal(canPost(s, world, 0, 0, 1), 'nosupport');
  assert.equal(canPost(s, world, 1, 0, 2), '');
  assert.equal(canPost(s, world, 2, 0, 1), 'nosupport');
  assert.equal(canPost(s, world, 5, 5, 0), 'nosupport');
  assert.equal(canPost(s, world, 0, 0, 0), 'taken');
  assert.equal(canPost(s, world, 1, 0, 0), 'decor');
  assert.equal(canPost(s, world, 2, 0, 0), '');
  const full = st(Array.from({ length: 16 }, (_, k) => ({ id: k + 1, i: k - 8, j: 5, l: 0 })));
  assert.equal(canPost(full, world, 2, 0, 0), 'full');
});

test('canLink: same, missing, linked, busy, lines, short, long, blocked', () => {
  const s = st([{ id: 1, i: 0, j: 0, l: 0 }, { id: 2, i: 4, j: 0, l: 1 }, { id: 3, i: 0, j: 0, l: 1 }, { id: 4, i: 1, j: 0, l: 0 },
    { id: 5, i: 8, j: 0, l: 0 }, { id: 6, i: -2, j: 0, l: 0 }, { id: 7, i: 0, j: 3, l: 0 }], [[1, 2]]);
  assert.equal(canLink(s, [], 1, 1), 'same');
  assert.equal(canLink(s, [], 1, 99), 'missing');
  assert.equal(canLink(s, [], 1, 2), 'linked');
  assert.equal(canLink(s, [], 2, 1), 'linked');
  assert.equal(canLink(s, [], 1, 3), 'short');
  assert.equal(canLink(s, [], 1, 4), ''); // adjacent cells, exactly 2 m apart
  assert.equal(canLink(s, [], 1, 5), 'long');
  assert.equal(canLink(s, [], 1, 6), '');
  assert.equal(canLink(s, [floor(0, 1, 1)], 1, 7), ''); // a deck-to-deck rope (y~2.2) passes under an l=1 slab (2.4 > ropeY+.1)
  assert.equal(canLink(s, [floor(2, 0, 1)], 1, 2), 'linked');
  const s4 = st([{ id: 1, i: 0, j: 0, l: 0 }, { id: 2, i: 4, j: 0, l: 1 }]);
  assert.equal(canLink(s4, [floor(4, 0, 1), floor(2, 0, 1)], 1, 2), 'blocked'); // slab through the rider's body mid-span
  assert.equal(canLink(s, [floor(4, 0, 1)], 1, 2), 'linked');
  const s2 = st([{ id: 1, i: 0, j: 0, l: 0 }, { id: 2, i: 2, j: 0, l: 0 }, { id: 3, i: 4, j: 0, l: 0 }, { id: 4, i: 0, j: 2, l: 0 }], [[1, 2], [1, 3]]);
  assert.equal(canLink(s2, [], 1, 4), 'busy');
  assert.equal(canLink(s2, [], 4, 1), 'busy');
  const s3 = st(Array.from({ length: 16 }, (_, k) => ({ id: k + 1, i: k - 8, j: 0, l: 0 })),
    Array.from({ length: 12 }, (_, k) => [k + 1, k + 2]));
  assert.equal(s3.lines.length, 12);
  assert.equal(canLink(s3, [], 15, 16), 'lines');
});

test('lineBlocked: end slabs are skipped, a slab mid-span blocks', () => {
  const s = st([{ id: 1, i: 0, j: 0, l: 0 }, { id: 2, i: 4, j: 0, l: 1 }]);
  assert.equal(canLink(s, [floor(4, 0, 1), floor(5, 0, 1)], 1, 2), ''); // the far post's own slab and the one past it
  assert.equal(canLink(s, [floor(4, 0, 1), floor(2, 0, 1)], 1, 2), 'blocked');
});

test('prune: lost floor drops its post and lines, lost tile drops a deck post', () => {
  const world = { tiles: tiles([0, 0], [1, 0], [2, 0]), pieces: [floor(2, 0, 1)] };
  const s = st([{ id: 1, i: 0, j: 0, l: 0 }, { id: 2, i: 2, j: 0, l: 1 }, { id: 3, i: 1, j: 0, l: 0 }, { id: 4, i: -3, j: 0, l: 0 }], [[1, 2], [2, 3]]);
  assert.equal(s.posts.length, 4);
  let n = prune(s, world); assert.deepEqual(n, { posts: 1, lines: 0 }); // id 4 had no tile
  world.pieces = [];
  n = prune(s, world); assert.deepEqual(n, { posts: 1, lines: 2 });
  assert.deepEqual(s.posts.map(p => p.id), [1, 3]); assert.deepEqual(s.lines, []);
  world.tiles = tiles([0, 0]);
  n = prune(s, world); assert.deepEqual(n, { posts: 1, lines: 0 }); assert.deepEqual(s.posts.map(p => p.id), [1]);
});

test('parabola: ends are the tops, the middle sags SAG_K * span, linePoints share it', () => {
  const A = topOf({ i: 0, j: 0, l: 0 }), B = topOf({ i: 4, j: 0, l: 1 });
  assert.deepEqual([A.x, A.y, A.z], [0, 2.2, 0]);
  assert.ok(Math.abs(B.y - 4.4) < 1e-9);
  const p0 = ropePoint(A, B, 0), p1 = ropePoint(A, B, 1), m = ropePoint(A, B, .5);
  assert.ok(Math.abs(p0.y - A.y) < 1e-9 && Math.abs(p1.y - B.y) < 1e-9 && p1.x === 8);
  assert.ok(Math.abs(m.y - ((A.y + B.y) / 2 - .04 * span(A, B))) < 1e-9);
  const pts = linePoints(A, B, 24); assert.equal(pts.length, 25);
  assert.ok(Math.abs(pts[12].y - m.y) < 1e-9 && Math.abs(pts[12].x - m.x) < 1e-9);
});

test('rideStep: duration, downhill faster, never below base speed, dir, end, bad', () => {
  const A = { x: 0, y: 2.2, z: 0 }, B = { x: 10, y: 2.2, z: 0 };
  let r = { t: 0, dir: 1 }, time = 0, res = '';
  while (res !== 'end' && time < 10) { res = rideStep(r, A, B, 1 / 60); time += 1 / 60; }
  assert.equal(r.t, 1);
  assert.ok(Math.abs(time - 10.4 / 4) < 10.4 / 4 * .1, 'level 10 m ride took ' + time);
  const H = { x: 0, y: 6, z: 0 }, L = { x: 10, y: 2.2, z: 0 };
  const dur = (a, b, dir) => { const q = { t: dir > 0 ? 0 : 1, dir }; let s = 0, out = ''; while (out !== 'end' && s < 20) { out = rideStep(q, a, b, 1 / 60); s += 1 / 60; } return s; };
  const down = dur(H, L, 1), up = dur(H, L, -1);
  assert.ok(down < up, `down ${down} up ${up}`);
  const arc = linePoints(H, L, 200).reduce((s, p, k, a) => k ? s + Math.hypot(p.x - a[k - 1].x, p.y - a[k - 1].y, p.z - a[k - 1].z) : 0, 0);
  assert.ok(arc / up >= ZIP.SPEED * .98, 'uphill speed ' + arc / up);
  assert.ok(arc / down <= ZIP.SPEED_MAX * 1.02);
  r = { t: .5, dir: -1 }; assert.equal(rideStep(r, A, B, .1), ''); assert.ok(r.t < .5);
  r = { t: .01, dir: -1 }; assert.equal(rideStep(r, A, B, 1), 'end'); assert.equal(r.t, 0);
  assert.equal(rideStep({ t: NaN, dir: 1 }, A, B, .1), 'bad');
  assert.equal(rideStep({ t: .5, dir: 1 }, A, A, .1), 'bad');
});

test('riderEye: feet never dip below the deck or a floor under the rider', () => {
  const A = topOf({ i: -3, j: 0, l: 0 }), B = topOf({ i: 4, j: 0, l: 0 }); // 14 m level line, sags .56 m
  const m = ropePoint(A, B, .5);
  const eye = riderEye([], m.x, m.z, m.y);
  assert.ok(m.y - ZIP.HANG - ZIP.EYE < ZIP.FLOOR_Y, 'unclamped feet would be under the deck');
  assert.ok(eye - ZIP.EYE >= ZIP.FLOOR_Y + .04);
  assert.equal(riderEye([], 0, 0, 4), 4 - ZIP.HANG); // high rope: plain hang
  const e2 = riderEye([floor(0, 0, 1)], 0, 0, 4.2); // floor at 2.4 under a rope at 4.2
  assert.ok(e2 - ZIP.EYE >= 2.4 + .04);
  assert.equal(riderEye([floor(0, 0, 2)], 0, 0, 4.2), 4.2 - ZIP.HANG); // a slab above the rope is not the floor
});

test('landSpot: ahead first, skips unsupported / decor / posts, floor level, fallback', () => {
  const world = { tiles: tiles([0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]), decor: [], pieces: [floor(4, 0, 1), floor(4, 1, 1)] };
  let o = landSpot(world, { i: 0, j: 0, l: 0 }, 1, 0); assert.deepEqual([o.x, o.z, o.footY], [2, 0, ZIP.FLOOR_Y]);
  world.decor = [{ type: 'bench', x: 1, z: 0 }];
  o = landSpot(world, { i: 0, j: 0, l: 0 }, 1, .2); assert.deepEqual([o.x, o.z], [0, 2]);
  o = landSpot(world, { i: 4, j: 0, l: 1 }, 1, 0); assert.deepEqual([o.x, o.z], [8, 2]); assert.ok(Math.abs(o.footY - 2.4) < 1e-9);
  o = landSpot(world, { i: 4, j: 0, l: 1 }, 1, 0, {}, st([{ id: 1, i: 4, j: 1, l: 1 }]));
  assert.ok(Math.abs(o.x - (8 - .7)) < 1e-9 && o.z === 0);
});

test('applyZip: post, link, unlink, remove with bag costs and refunds', () => {
  const world = { tiles: tiles([0, 0], [1, 0], [2, 0], [3, 0]), pieces: [], decor: [] };
  const s = cleanZip(undefined), bag = new Bag();
  assert.equal(applyZip(s, { kind: 'zipline.post', i: 0, j: 0, l: 0 }, bag, world).text, 'Build a Zipline Post first');
  bag.add('zippost', 2); bag.add('rope', 1);
  assert.ok(applyZip(s, { kind: 'zipline.post', i: 0, j: 0, l: 0 }, bag, world).ok);
  assert.equal(applyZip(s, { kind: 'zipline.post', i: 0, j: 0, l: 0 }, bag, world).text, 'A post already stands here');
  assert.ok(applyZip(s, { kind: 'zipline.post', i: 3, j: 0, l: 0 }, bag, world).ok);
  assert.equal(bag.count('zippost'), 0); assert.equal(s.rev, 2);
  assert.ok(applyZip(s, { kind: 'zipline.link', a: 2, b: 1 }, bag, world).ok);
  assert.deepEqual(s.lines, [[1, 2]]); assert.equal(bag.count('rope'), 0);
  assert.equal(applyZip(s, { kind: 'zipline.link', a: 1, b: 2 }, bag, world).text, 'You need Rope');
  assert.ok(applyZip(s, { kind: 'zipline.unlink', a: 2, b: 1 }, bag, world).ok); assert.equal(bag.count('rope'), 1);
  assert.ok(applyZip(s, { kind: 'zipline.link', a: 1, b: 2 }, bag, world).ok);
  assert.ok(applyZip(s, { kind: 'zipline.remove', id: 1 }, bag, world).ok);
  assert.equal(bag.count('zippost'), 1); assert.equal(bag.count('rope'), 1); assert.deepEqual(s.lines, []);
  assert.equal(applyZip(s, { kind: 'other' }, bag, world), null);
});

test('module: ride pins under the rope, clamps over the deck, lets go on Space, lands beside the far post', () => {
  const world = { tiles: tiles([-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]), pieces: [], decor: [], ext: {} };
  const bag = new Bag(); bag.add('zippost', 2); bag.add('rope', 1);
  const scene = new T.Scene(), raft = new T.Group(); raft.position.y = 0;
  const physics = { x: -6, y: .2 + 1.6, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, swimming: false, _jumpBuffer: 0 };
  const notes = [];
  const ctx = { T, scene, raft, world, role: 'host', running: true, physics, camera: new T.PerspectiveCamera(),
    localBag: () => bag, action: a => mod.action(a, 'host', bag), emit: e => notes.push(e.text), notice: s => notes.push(s),
    esc: s => s, deckY: () => .2, uiOpen: () => false, aim: () => null, steering: () => false, play: () => {} };
  const mod = createZipline(ctx, { peek: () => undefined });
  mod.load(undefined, 'save');
  mod.debug.place(-3, 0, 0); mod.debug.place(4, 0, 0); mod.debug.link(1, 2);
  assert.equal(mod.serialize().lines.length, 1);
  mod.update(1 / 60);
  assert.equal(scene.getObjectByName('zipline').children.filter(c => c.isMesh && c.material.vertexColors).length, 2);
  assert.match(mod.prompt(null), /Ride the zipline/);
  assert.ok(mod.interact(null));
  assert.ok(mod.debug.ride);
  let minFeet = Infinity;
  for (let k = 0; k < 60 && mod.debug.ride; k++) { mod.afterMove(physics, 1 / 60); minFeet = Math.min(minFeet, physics.y - 1.6); }
  assert.ok(mod.debug.ride && physics.grounded === false && physics.x > -6);
  mod.debug.seek(.5); mod.afterMove(physics, 1 / 60); minFeet = Math.min(minFeet, physics.y - 1.6);
  assert.ok(minFeet >= .2 + .04, 'feet at ' + minFeet);
  physics._jumpBuffer = .1; mod.afterMove(physics, 1 / 60);
  assert.equal(mod.debug.ride, null); assert.equal(physics.vy, 2); assert.equal(physics._jumpBuffer, 0);
  // ride again to the end
  Object.assign(physics, { x: -6, y: 1.8, z: 0, grounded: true, vy: 0 });
  assert.ok(mod.interact(null));
  for (let k = 0; k < 600 && mod.debug.ride; k++) mod.afterMove(physics, 1 / 60);
  assert.equal(mod.debug.ride, null);
  assert.deepEqual([physics.x, physics.z], [10, 0]);
  assert.ok(Math.abs(physics.y - (.2 + 1.6 + .02)) < 1e-9);
  // net load with the same rev is a no-op; pruning a tile drops the post and refunds
  world.tiles = world.tiles.filter(t => t[0] !== 4); mod.update(1 / 60);
  assert.equal(mod.serialize().posts.length, 1); assert.equal(bag.count('zippost'), 1); assert.equal(bag.count('rope'), 1);
  assert.ok(notes.includes('A zipline post lost its floor'));
  mod.dispose();
});
