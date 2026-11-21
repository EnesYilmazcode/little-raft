// Unit tests for the receiver / antenna / signal-cache logic (dist/signal.js).
// Run: node --test tests/signal.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const S = await import(new URL('signal.js', base));
const { cleanSignal, countAntennas, raftCentre, signalTick, onCacheCollected, cacheLoot, signalReadout, edgePoint, TIERS, CACHE_ID, FIRST_DELAY, STOP_GAP, NEAR_GAP, LIMIT } = S;
const { ITEM_INFO, RECIPES, Bag } = await import(new URL('inventory-state.js', base));

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const grid = () => Array.from({length:9}, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]);
const ANTENNA_SPOTS = [[2, 2], [-2, 2], [2, -2], [-2, -2], [0, 2]];
function makeWorld(antennas = 0, {receiver = true} = {}) {
  const tiles = [];
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) tiles.push([x, z]);
  const decor = receiver ? [{type:'receiver', x:0, z:0}] : [];
  for (let i = 0; i < antennas; i++) decor.push({type:'antenna', x:ANTENNA_SPOTS[i][0], z:ANTENNA_SPOTS[i][1]});
  return {tiles, decor, items:[{id:1, token:'w1', type:'wood', x:3, z:-9, phase:0}], signal:null};
}
const run = (w, seconds, opts, dt = 1) => { const ev = []; for (let t = 0; t < seconds; t += dt) ev.push(...signalTick(w, dt, opts)); return ev; };
const cacheItems = w => w.items.filter(i => i.type === 'cache');
let tokenN = 0; const tok = () => 'tok-' + (++tokenN);

test('items and recipes: receiver and antenna are craftable bag items', () => {
  assert.equal(ITEM_INFO.receiver.icon, 'icon-receiver'); // its own drawing (was the borrowed compass, blank in the bag)
  assert.equal(ITEM_INFO.antenna.icon, 'icon-antenna');
  assert.deepEqual({...RECIPES.receiver.cost}, {wood:8, plastic:6, circuitboard:2, hinge:1}); // Raft's costs (story progression)
  assert.deepEqual({...RECIPES.antenna.cost}, {bolt:1, scrap:4, circuitboard:1});
  assert.equal(ITEM_INFO.cache, undefined);
  const bag = Bag.fromCounts({wood:8, plastic:6, circuitboard:2, hinge:1});
  assert.equal(bag.craft('receiver').ok, true);
  assert.equal(bag.count('receiver'), 1);
});

test('cleanSignal: rejects garbage, clamps cooldown, drops bad caches, copies', () => {
  for (const v of [null, undefined, 3, 'x', [], true]) assert.equal(cleanSignal(v), null);
  assert.deepEqual(cleanSignal({}), {cooldown:0, cache:null});
  assert.equal(cleanSignal({cooldown:9999}).cooldown, 600);
  assert.equal(cleanSignal({cooldown:-5}).cooldown, 0);
  assert.equal(cleanSignal({cooldown:NaN}).cooldown, 0);
  const good = {id:CACHE_ID, token:'abc', x:10, z:-20, phase:2, near:1};
  assert.deepEqual(cleanSignal({cooldown:3, cache:good}).cache, {id:CACHE_ID, token:'abc', x:10, z:-20, phase:2, near:true});
  assert.equal(cleanSignal({cache:{...good, token:'x'.repeat(80)}}).cache, null);
  assert.equal(cleanSignal({cache:{...good, token:''}}).cache, null);
  assert.equal(cleanSignal({cache:{...good, x:80}}).cache, null);
  assert.equal(cleanSignal({cache:{...good, z:-80}}).cache, null);
  assert.equal(cleanSignal({cache:{...good, id:1.5}}).cache, null);
  assert.equal(cleanSignal({cache:{...good, phase:'q'}}).cache.phase, 0);
  const src = {cooldown:5, cache:{...good}}, out = cleanSignal(src);
  assert.notEqual(out, src); assert.notEqual(out.cache, src.cache);
  out.cache.x = 0; assert.equal(src.cache.x, 10);
});

test('countAntennas: needs a receiver and 2+ tiles of spacing, caps at 3', () => {
  assert.equal(countAntennas([{type:'antenna', x:3, z:3}]), 0);
  assert.equal(countAntennas([{type:'receiver', x:0, z:0}, {type:'antenna', x:1, z:0}]), 0);
  assert.equal(countAntennas([{type:'receiver', x:0, z:0}, {type:'antenna', x:1, z:1}]), 0);
  assert.equal(countAntennas([{type:'receiver', x:0, z:0}, {type:'antenna', x:2, z:2}]), 1);
  assert.equal(countAntennas(makeWorld(5).decor), 3);
  assert.equal(countAntennas(null), 0);
});

test('raftCentre: mean of tile centres plus covering radius', () => {
  const c = raftCentre(grid());
  assert.equal(c.x, 0); assert.equal(c.z, 0);
  assert.ok(Math.abs(c.r - (Math.hypot(2, 2) + 1)) < 1e-9);
  const d = raftCentre([[0, 0], [1, 0]]);
  assert.equal(d.x, 1); assert.equal(d.r, 2);
});

test('signalTick: no receiver keeps signal null; receiver starts listening and detects after 20 s', () => {
  const none = makeWorld(0, {receiver:false});
  assert.deepEqual(signalTick(none, 1, {rng:mulberry32(1), token:tok}), []);
  assert.equal(none.signal, null);
  for (let n = 0; n <= 3; n++) {
    const w = makeWorld(n), rng = mulberry32(7);
    assert.deepEqual(signalTick(w, 0, {rng, token:tok}), []);
    assert.deepEqual(w.signal, {cooldown:FIRST_DELAY, cache:null});
    const ev = run(w, 20, {rng, token:tok});
    assert.deepEqual(ev, [{kind:'detected'}]);
    assert.equal(cacheItems(w).length, 1);
    const c = w.signal.cache, C = raftCentre(w.tiles), dist = Math.hypot(c.x - C.x, c.z - C.z);
    assert.equal(c.id, CACHE_ID); assert.equal(c.near, false);
    assert.ok(Math.abs(c.x) <= LIMIT && Math.abs(c.z) <= LIMIT);
    if (Math.abs(c.x) < LIMIT && Math.abs(c.z) < LIMIT) assert.ok(Math.abs(dist - TIERS[n].range) < 1e-9, `tier ${n} dist ${dist}`);
    else assert.ok(dist <= TIERS[n].range + 1e-9);
    assert.deepEqual(cacheItems(w)[0], {id:CACHE_ID, token:c.token, type:'cache', x:c.x, z:c.z, phase:c.phase});
    assert.equal(w.items.length, 2, 'ordinary debris is untouched');
  }
  const a = makeWorld(1), b = makeWorld(1);
  run(a, 20, {rng:mulberry32(42), token:() => 't'}); run(b, 20, {rng:mulberry32(42), token:() => 't'});
  assert.deepEqual(a.signal, b.signal);
  const bad = makeWorld(0); signalTick(bad, NaN, {rng:mulberry32(1)}); signalTick(bad, -50, {rng:mulberry32(1)});
  assert.equal(bad.signal.cooldown, FIRST_DELAY);
  const dflt = makeWorld(0); run(dflt, 20, {rng:mulberry32(3)});
  assert.match(dflt.signal.cache.token, /^sig-/);
});

test('signalTick drift: tier speed, stops at r + 6, near fires once, held cache waits', () => {
  for (let n = 0; n <= 3; n++) {
    const w = makeWorld(n), rng = mulberry32(11 + n);
    run(w, 20, {rng, token:tok});
    const C = raftCentre(w.tiles), c = w.signal.cache, d0 = Math.hypot(c.x - C.x, c.z - C.z);
    signalTick(w, 2, {rng, token:tok});
    const d1 = Math.hypot(c.x - C.x, c.z - C.z);
    assert.ok(Math.abs(d0 - d1 - TIERS[n].speed * 2) < 1e-9, `tier ${n} speed`);
    const ev = run(w, 400, {rng, token:tok}, .5);
    assert.deepEqual(ev, [{kind:'near'}]);
    const d2 = Math.hypot(c.x - C.x, c.z - C.z);
    assert.ok(Math.abs(d2 - (C.r + STOP_GAP)) < 1e-6, `stops at the gap: ${d2}`);
    assert.equal(c.near, true);
    const item = cacheItems(w)[0]; assert.equal(item.x, c.x); assert.equal(item.z, c.z);
  }
  const w = makeWorld(2); run(w, 20, {rng:mulberry32(5), token:() => 'held'});
  const {x, z} = w.signal.cache;
  run(w, 10, {rng:mulberry32(5), held:new Set(['held'])});
  assert.equal(w.signal.cache.x, x); assert.equal(w.signal.cache.z, z);
  const near = makeWorld(0); run(near, 20, {rng:mulberry32(9), token:tok});
  const C = raftCentre(near.tiles);
  Object.assign(near.signal.cache, {x:C.x, z:C.z + C.r + NEAR_GAP - 1});
  assert.deepEqual(signalTick(near, .1, {rng:mulberry32(9)}), [{kind:'near'}]);
});

test('signalTick: mirror item restored after load, stale mirrors removed', () => {
  const w = makeWorld(1); run(w, 20, {rng:mulberry32(2), token:() => 'keep'});
  w.items = [];
  signalTick(w, .1, {rng:mulberry32(2)});
  assert.equal(cacheItems(w).length, 1); assert.equal(cacheItems(w)[0].token, 'keep');
  w.items.push({id:CACHE_ID, token:'old', type:'cache', x:1, z:1, phase:0});
  signalTick(w, .1, {rng:mulberry32(2)});
  assert.deepEqual(cacheItems(w).map(i => i.token), ['keep']);
  const idle = makeWorld(1); idle.signal = {cooldown:50, cache:null}; idle.items.push({id:CACHE_ID, token:'ghost', type:'cache', x:0, z:9, phase:0});
  signalTick(idle, 1, {rng:mulberry32(2)});
  assert.equal(cacheItems(idle).length, 0);
});

test('onCacheCollected: tier cooldown, cache cleared, next spawn after the cooldown', () => {
  const expected = [150, 150, 120, 90];
  for (let n = 0; n <= 3; n++) {
    const w = makeWorld(n), rng = mulberry32(20 + n);
    run(w, 20, {rng, token:tok});
    onCacheCollected(w);
    assert.deepEqual(w.signal, {cooldown:expected[n], cache:null});
    assert.equal(cacheItems(w).length, 0);
    assert.deepEqual(run(w, expected[n] - 1, {rng, token:tok}), []);
    assert.deepEqual(run(w, 1, {rng, token:tok}), [{kind:'detected'}]);
  }
});

test('cacheLoot: base haul, bonus only with 3 antennas', () => {
  const base = {wood:6, plastic:4, scrap:3, rope:2};
  for (const n of [0, 1, 2]) assert.deepEqual(cacheLoot(n, () => .01), base);
  assert.deepEqual(cacheLoot(3, () => .9), base);
  assert.deepEqual(cacheLoot(3, () => .1), {...base, fish:1});
  const seq = [.1, .8]; assert.deepEqual(cacheLoot(3, () => seq.shift()), {...base, leaf:2});
  const a = cacheLoot(0, () => 0); a.wood = 0; assert.equal(cacheLoot(0, () => 0).wood, 6);
});

test('signalReadout: compass point, arrow, distance text, marker and wobble', () => {
  assert.equal(signalReadout(null, {x:0, z:0, yaw:0}, 0, 0), null);
  assert.deepEqual(signalReadout({cooldown:5, cache:null}, {x:0, z:0, yaw:0}, 0, 0), {listening:true, label:'SIGNAL · listening…'});
  const at = (x, z, phase = 0) => ({cooldown:0, cache:{id:CACHE_ID, token:'t', x, z, phase, near:false}});
  let r = signalReadout(at(0, -50), {x:0, z:0, yaw:0}, 2, 3);
  assert.equal(r.point, 'N'); assert.ok(Math.abs(r.arrow) < 1e-9); assert.equal(r.label, 'SIGNAL N · 50 m');
  r = signalReadout(at(50, 0), {x:0, z:0, yaw:0}, 2, 0);
  assert.equal(r.point, 'E'); assert.ok(Math.abs(r.arrow - 90) < 1e-9); assert.ok(Math.abs(r.heading - 90) < 1e-9);
  r = signalReadout(at(-30, 0), {x:0, z:0, yaw:Math.PI / 2}, 3, 0);
  assert.equal(r.point, 'W'); assert.ok(Math.abs(r.arrow) < 1e-9);
  r = signalReadout(at(0, 30), {x:0, z:0, yaw:0}, 3, 0);
  assert.equal(r.point, 'S'); assert.ok(Math.abs(Math.abs(r.arrow) - 180) < 1e-9);
  assert.equal(signalReadout(at(10, 10), {x:0, z:0, yaw:0}, 3, 0).point, 'SE');
  // distance text per tier
  assert.equal(signalReadout(at(0, -50), {x:0, z:0}, 0, 0).distText, 'far');
  assert.equal(signalReadout(at(0, -20), {x:0, z:0}, 0, 0).distText, 'near');
  assert.equal(signalReadout(at(0, -47), {x:0, z:0}, 1, 0).distText, '50 m');
  assert.equal(signalReadout(at(0, -47), {x:0, z:0}, 2, 0).distText, '45 m');
  assert.equal(signalReadout(at(0, -47.4), {x:0, z:0}, 3, 0).distText, '47 m');
  // marker / beam
  assert.equal(signalReadout(at(0, -10), {x:0, z:0}, 0, 0).marker, false);
  assert.equal(signalReadout(at(0, -50), {x:0, z:0}, 1, 0).marker, false);
  assert.equal(signalReadout(at(0, -30), {x:0, z:0}, 1, 0).marker, true);
  assert.equal(signalReadout(at(0, -70), {x:0, z:0}, 2, 0).marker, true);
  assert.equal(signalReadout(at(0, -70), {x:0, z:0}, 2, 0).beam, false);
  assert.equal(signalReadout(at(0, -70), {x:0, z:0}, 3, 0).beam, true);
  // wobble: none at 2+ antennas, bounded by the tier at 0/1
  for (const t of [0, 1.3, 7]) assert.ok(Math.abs(signalReadout(at(0, -50, 1), {x:0, z:0}, 2, t).heading) < 1e-9);
  let maxWob = 0; for (let t = 0; t < 10; t += .1) { const h = signalReadout(at(0, -50, 1), {x:0, z:0}, 0, t).arrow; maxWob = Math.max(maxWob, Math.abs(h)); }
  assert.ok(maxWob > 20 && maxWob <= 25 + 1e-9, `wobble ${maxWob}`);
});

test('edgePoint: passthrough on screen, clamps to the inset edge, flips when behind', () => {
  assert.deepEqual(edgePoint(400, 300, true, 800, 600), {x:400, y:300, edge:false});
  let p = edgePoint(2000, 300, true, 800, 600);
  assert.equal(p.edge, true); assert.equal(p.x, 800 - 24); assert.equal(p.y, 300);
  p = edgePoint(600, 300, false, 800, 600);
  assert.equal(p.edge, true); assert.equal(p.x, 24);
  p = edgePoint(400, 300, false, 800, 600);
  assert.equal(p.edge, true); assert.equal(p.x, 400); assert.equal(p.y, 600 - 24);
  p = edgePoint(10, 10, true, 800, 600, 24);
  assert.equal(p.edge, true); assert.ok(p.x >= 24 - 1e-9 && p.y >= 24 - 1e-9);
});

test('receiver removed mid-drift: the cache keeps coming, then the signal goes quiet', () => {
  const w = makeWorld(1); run(w, 20, {rng:mulberry32(4), token:tok});
  const C = raftCentre(w.tiles), c = w.signal.cache, d0 = Math.hypot(c.x - C.x, c.z - C.z);
  w.decor = w.decor.filter(d => d.type !== 'receiver');
  run(w, 5, {rng:mulberry32(4)});
  assert.ok(w.signal.cache, 'cache survives');
  assert.ok(Math.hypot(c.x - C.x, c.z - C.z) < d0 - 1, 'still drifting');
  onCacheCollected(w);
  assert.deepEqual(signalTick(w, 1, {rng:mulberry32(4)}), []);
  assert.equal(w.signal, null);
  assert.equal(cacheItems(w).length, 0);
});

test('signalTick drift: a long thin raft still pulls the cache within hook reach of the deck', () => {
  const tiles = []; for (let x = -20; x <= 20; x++) tiles.push([x, 0]);
  const w = {tiles, decor:[{type:'receiver', x:0, z:0}], items:[], signal:null};
  run(w, 20, {rng:() => 0, token:tok}); // angle 0: spawns straight off the long side (+z)
  run(w, 600, {rng:() => 0, token:tok}, .5);
  const c = w.signal.cache, C = raftCentre(tiles);
  assert.ok(Math.hypot(c.x - C.x, c.z - C.z) < C.r + STOP_GAP, 'moved past the centre-radius stop');
  const gap = Math.abs(c.z) - 1;
  assert.ok(gap <= STOP_GAP + 2 + 1e-6 && gap > 0, `parked near the deck edge: ${gap}`);
  assert.equal(c.near, true);
});
