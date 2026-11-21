// Unit tests for dist/wildlife.js pure plan and module (no scene). Run: node --test tests/wildlife.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const W = await import(new URL('wildlife.js', base));
const { WILDLIFE_SEED: SEED, mulberry32, perchesFrom, gullPlan, gullVisit, schoolCenter, fishOffset, circlerAt, createWildlife, GULL_MAX, GULL_SLOT, CIRCLER_MIN_R,
  raftExtent, layoutHash, GULL_MARGIN, FISH_MARGIN, CIRCLER_MARGIN, FOLD_H, WING_LEN, AVOID_RADIUS, DOLPHIN_CYCLE } = W;
const T = await import(new URL('vendor/three.module.js', base));

const TILES = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [-1, 1], [1, -1]];
const DECOR = [{ type: 'sail', x: 1, z: 0 }, { type: 'palm', x: 0, z: 1 }, { type: 'crate', x: 1, z: 1 }];
const fresh = () => ({});

test('mulberry32 is deterministic and in [0,1)', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 100; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
});

test('perchesFrom: free tiles plus raised sail/crate/bench tops and palm rims, sorted, order independent', () => {
  const p = perchesFrom(TILES, DECOR);
  assert.equal(p.length, 9); // [scarecrow] the palm tile is a pot-rim perch now
  const palm = p.find(q => q.key === '0,1');
  assert.equal(palm.kind, 'palm'); assert.ok(Math.abs(palm.y - 0.72) < 1e-9);
  assert.ok(Math.abs(Math.hypot(palm.x - 0, palm.z - 2) - 0.3) < 1e-9, 'rim offset');
  const sail = p.find(q => q.key === '1,0'), crate = p.find(q => q.key === '1,1'), free = p.find(q => q.key === '0,0');
  assert.ok(sail.y > 3.5 && crate.y > 0.9 && crate.y < 1.2 && free.y === 0.2);
  assert.equal(free.kind, 'deck'); assert.equal(sail.kind, 'sail'); assert.equal(crate.kind, 'crate');
  assert.deepEqual(p.map(q => q.key), ['-1,-1', '-1,0', '-1,1', '0,-1', '0,0', '0,1', '1,-1', '1,0', '1,1']);
  // [scarecrow] a scarecrow at 0,0 guards the palm at 0,1 and gives a hat perch
  const q = perchesFrom(TILES, [...DECOR, { type: 'scarecrow', x: 0, z: 0 }]);
  assert.ok(!q.some(e => e.key === '0,1'));
  const hat = q.find(e => e.key === '0,0');
  assert.equal(hat.kind, 'scarecrow'); assert.ok(Math.abs(hat.y - (0.22 + 1.75)) < 1e-9);
  const shuffled = [...TILES].reverse(), d2 = [...DECOR].reverse();
  assert.deepEqual(perchesFrom(shuffled, d2), p);
  assert.deepEqual(perchesFrom([], []), []);
  assert.deepEqual(perchesFrom(undefined, undefined), []);
  assert.deepEqual(perchesFrom([[0, 0], 'junk', [NaN, 1], null], [null, { x: 'a' }]).length, 1);
});

test('plans are deterministic for equal inputs and change with the seed', () => {
  const per = perchesFrom(TILES, DECOR);
  let differ = 0;
  for (let k = 0; k < 50; k++) {
    const t = k * 13.7;
    for (let i = 0; i < GULL_MAX; i++) assert.deepEqual(gullPlan(SEED, i, t, per, fresh()), gullPlan(SEED, i, t, per, fresh()));
    assert.deepEqual(schoolCenter(SEED, 1, t, fresh()), schoolCenter(SEED, 1, t, fresh()));
    assert.deepEqual(circlerAt(SEED, t, fresh()), circlerAt(SEED, t, fresh()));
    const a = gullPlan(SEED, 0, t, per, fresh()), b = gullPlan(SEED + 1, 0, t, per, fresh());
    if (a.x !== b.x || a.z !== b.z) differ++;
  }
  assert.ok(differ > 0);
});

test('gulls move smoothly, stay above water, and both circle and perch', () => {
  const per = perchesFrom(TILES, DECOR);
  for (let i = 0; i < GULL_MAX; i++) {
    const seen = new Set(); let prev = null;
    for (let s = 0; s < 6000; s++) {
      const o = gullPlan(SEED, i, s / 10, per, fresh());
      seen.add(o.state);
      assert.ok(o.y >= 0, `gull ${i} y ${o.y}`);
      assert.ok(Number.isFinite(o.yaw) && Number.isFinite(o.flap));
      if (prev) assert.ok(Math.hypot(o.x - prev.x, o.y - prev.y, o.z - prev.z) < 2, `gull ${i} jumped at ${s / 10}`);
      prev = o;
    }
    assert.ok(seen.has('circle') && seen.has('perched'), `gull ${i} states ${[...seen]}`);
  }
});

test('a perched gull sits on its perch, and two gulls never share a perch', () => {
  const per = perchesFrom(TILES, DECOR);
  let perchedSamples = 0;
  for (let s = 0; s < 3000; s++) {
    const t = s / 5, used = new Set();
    for (let i = 0; i < GULL_MAX; i++) {
      const o = gullPlan(SEED, i, t, per, fresh());
      if (o.state !== 'perched') continue;
      perchedSamples++;
      const p = per[o.perch];
      assert.equal(o.x, p.x); assert.equal(o.z, p.z); assert.ok(o.y >= p.y && o.y < p.y + 0.1);
      assert.ok(!used.has(o.perch), `perch ${o.perch} shared at t=${t}`); used.add(o.perch);
    }
  }
  assert.ok(perchedSamples > 100);
});

test('gulls follow perch changes and keep circling with no perches', () => {
  const per = perchesFrom(TILES, DECOR), fewer = perchesFrom([[0, 0]], []);
  for (let s = 0; s < 2000; s++) {
    const t = s / 2;
    for (let i = 0; i < GULL_MAX; i++) {
      assert.equal(gullPlan(SEED, i, t, [], fresh()).state, 'circle');
      const o = gullPlan(SEED, i, t, fewer, fresh());
      if (o.perch >= 0) { assert.equal(o.px, 0); assert.equal(o.pz, 0); assert.equal(i, 0); }
    }
  }
  const v = gullVisit(SEED, 0, 3, per.length, {});
  assert.ok(v.start >= 3 * GULL_SLOT && v.start + 4 + v.stay + 4 < 4 * GULL_SLOT);
});

test('a scare makes a perched gull leave early', () => {
  const per = perchesFrom(TILES, DECOR);
  for (let t = 0; t < 2000; t += 0.5) {
    const o = gullPlan(SEED, 0, t, per, fresh());
    if (o.state !== 'perched') continue;
    assert.equal(gullPlan(SEED, 0, t + 0.5, per, fresh(), t).state, 'leave');
    assert.ok(gullPlan(SEED, 0, t + 1.5, per, fresh(), t).y > o.y);
    return;
  }
  assert.fail('gull 0 never perched');
});

test('fish schools stay 6-18 m out and 0.4-1.2 m deep', () => {
  for (let i = 0; i < 2; i++) for (let s = 0; s < 6000; s++) {
    const o = schoolCenter(SEED, i, s / 10, fresh());
    const r = Math.hypot(o.x, o.z);
    assert.ok(r >= 6 && r <= 18, `school r ${r}`);
    for (let j = 0; j < 12; j++) { const f = fishOffset(SEED, i, j, fresh()); const y = o.y + f.depth; assert.ok(y >= -1.2 && y <= -0.4, `fish y ${y}`); }
  }
});

test('the circler is absent most of the time, keeps its distance, and is ~70% dolphin', () => {
  let present = 0, dolphins = 0, kinds = 0;
  for (let s = 0; s < 20000; s++) {
    const o = circlerAt(SEED, s * 1.7, fresh());
    if (!o.kind) continue;
    present++;
    assert.ok(Math.hypot(o.x, o.z) >= CIRCLER_MIN_R);
  }
  assert.ok(present / 20000 < 0.5, `present ${present / 20000}`);
  for (let w = 0; w < 2000; w++) { // one sample in the middle of each window's visit
    for (let k = 0; k < 40; k++) { const o = circlerAt(SEED, w * 180 + k * 4.5, fresh()); if (o.kind) { kinds++; if (o.kind === 'dolphin') dolphins++; break; } }
  }
  assert.ok(Math.abs(dolphins / kinds - 0.7) < 0.05, `dolphin share ${dolphins / kinds}`);
});

// ---------------------------------------------------------------- module with a stub ctx

const stub = (over = {}) => ({ role: 'solo', elapsed: 0, options: { graphics: 'medium' }, world: { tiles: TILES, decor: DECOR }, ...over });

test('module: load never throws on garbage, solo serialize is undefined', () => {
  const ctx = stub(), m = createWildlife(ctx);
  assert.equal(m.name, 'wildlife');
  for (const d of [undefined, null, 'junk', 7, [], { t: NaN }, { t: 1e308 }, { t: 'x' }]) for (const f of ['save', 'net', 'restore', undefined]) m.load(d, f);
  assert.equal(m.serialize(), undefined);
  m.update(0.016); // no scene: must not throw or build
  assert.equal(m.debug.snapshot().built, false);
});

test('module: host serialize reuses one object; guest syncs to the host clock', () => {
  const host = stub({ role: 'host', elapsed: 123.456 }), h = createWildlife(host);
  const a = h.serialize(), b = h.serialize();
  assert.equal(a, b); assert.equal(a.t, 123.5);
  const guestCtx = stub({ role: 'guest', elapsed: 5 }), g = createWildlife(guestCtx);
  g.load(JSON.parse(JSON.stringify(a)), 'net');
  assert.equal(g.clock, 123.5);
  const per = perchesFrom(TILES, DECOR);
  assert.deepEqual(gullPlan(SEED, 2, g.clock, per, {}), gullPlan(SEED, 2, a.t, per, {}));
  // drift is eased out at <= 0.5 s/s, a gap over 10 s snaps
  guestCtx.elapsed = 6; g.load({ t: 124.0 }, 'net'); assert.equal(g.offset, 118.5);
  g.update(0.05); assert.ok(Math.abs(g.offset - 118.475) < 1e-9, `offset ${g.offset}`);
  g.update(1); assert.ok(Math.abs(g.offset - 118.425) < 1e-9, 'one step uses at most 0.1 s of dt');
  for (let k = 0; k < 20; k++) g.update(0.05);
  assert.equal(g.offset, 118);
  g.load({ t: 6 + 118 + 9 }, 'net'); assert.equal(g.offset, 118, 'a 9 s gap slews, it does not snap');
  g.load({ t: 500 }, 'net'); assert.equal(g.clock, 500);
  g.load(undefined, 'restore'); assert.equal(g.offset, 0);
});

test('module: host serialize sends its own clock, offset included', () => {
  const host = stub({ role: 'host', elapsed: 10 }), h = createWildlife(host);
  h.debug.setTime(200.04);
  assert.equal(h.serialize().t, 200);
});

test('raftExtent and layoutHash', () => {
  assert.equal(raftExtent(TILES), 3);
  assert.equal(raftExtent([[0, 0], [-6, 2], 'junk']), 13);
  assert.equal(raftExtent([]), 0); assert.equal(raftExtent(undefined), 0);
  const h = layoutHash(TILES, DECOR);
  assert.equal(layoutHash(TILES.map(t => [...t]), DECOR.map(d => ({ ...d }))), h);
  assert.notEqual(layoutHash(TILES, [...DECOR, { type: 'palm', x: 0, z: 0 }]), h);
  assert.notEqual(layoutHash(TILES, [{ ...DECOR[0], type: 'crate' }, ...DECOR.slice(1)]), h);
  assert.notEqual(layoutHash([...TILES, [2, 0]], DECOR), h);
  assert.equal(typeof layoutHash(null, 'x'), 'number');
});

test('module: fresh arrays with the same layout do not rebuild perches', () => {
  const ctx = stub(), m = createWildlife(ctx);
  for (let k = 0; k < 10; k++) { ctx.world = { tiles: TILES.map(t => [...t]), decor: DECOR.map(d => ({ ...d })) }; m.update(0.016); }
  assert.equal(m.debug.snapshot().rebuilds, 1);
  ctx.world = { tiles: TILES.map(t => [...t]), decor: [...DECOR, { type: 'palm', x: 0, z: 0 }] }; m.update(0.016);
  assert.equal(m.debug.snapshot().rebuilds, 2);
  assert.equal(m.debug.snapshot().perches, 9); // [scarecrow] palm planters are rim perches now
});

test('animals keep clear of a big raft', () => {
  const big = []; for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) big.push([x, z]);
  const ext = raftExtent(big), per = perchesFrom(big, []);
  assert.equal(ext, 17);
  for (let s = 0; s < 4000; s++) {
    const t = s * 0.73;
    for (let i = 0; i < GULL_MAX; i++) {
      const o = gullPlan(SEED, i, t, per, fresh(), -Infinity, null, undefined, ext);
      if (o.state === 'circle') assert.ok(Math.hypot(o.x, o.z) >= ext + GULL_MARGIN - 1e-9, `gull r ${Math.hypot(o.x, o.z)}`);
    }
    for (let i = 0; i < 2; i++) { const c = schoolCenter(SEED, i, t, fresh(), ext); assert.ok(Math.hypot(c.x, c.z) >= ext + FISH_MARGIN - 1e-9); }
    const c = circlerAt(SEED, t * 3, fresh(), null, ext);
    if (c.kind) assert.ok(Math.hypot(c.x, c.z) >= ext + CIRCLER_MARGIN - 1e-9);
  }
  // the starter raft is unchanged
  for (let s = 0; s < 200; s++) assert.deepEqual(schoolCenter(SEED, 0, s, fresh(), 3), schoolCenter(SEED, 0, s, fresh()));
  for (let s = 0; s < 200; s++) assert.deepEqual(gullPlan(SEED, 1, s * 3, perchesFrom(TILES, []), fresh(), -Infinity, null, undefined, 3), gullPlan(SEED, 1, s * 3, perchesFrom(TILES, []), fresh()));
});

test('a scare while descending turns the gull back up smoothly', () => {
  const per = perchesFrom(TILES, DECOR);
  for (let t = 0; t < 4000; t += 0.25) {
    const o = gullPlan(SEED, 0, t, per, fresh());
    if (o.state !== 'descend' || o.blend < 0.3 || o.blend > 0.7) continue;
    let prev = o;
    for (let k = 1; k <= 60; k++) {
      const q = gullPlan(SEED, 0, t + k / 10, per, fresh(), t);
      assert.ok(q.state === 'leave' || q.state === 'circle', q.state);
      assert.ok(Math.hypot(q.x - prev.x, q.y - prev.y, q.z - prev.z) < 1, 'no jump');
      prev = q;
    }
    return;
  }
  assert.fail('gull 0 never descended');
});

test('module: setTime and release are safe without a scene', () => {
  const ctx = stub({ elapsed: 10 }), m = createWildlife(ctx);
  assert.equal(m.debug.setTime(77), 77);
  m.debug.release();
  assert.equal(m.debug.summonCircler('turtle').kind, 'turtle');
  m.dispose();
});

// ---------------------------------------------------------------- module with real three and a stub scene

function sceneCtx(over = {}) {
  const scene = new T.Scene(), raft = new T.Group(); scene.add(raft);
  const camera = new T.PerspectiveCamera(70, 1.5, 0.05, 500); camera.position.set(0, 1.8, 3); camera.lookAt(0, 0.2, 0);
  scene.add(camera);
  return { T, scene, raft, camera, ocean: { getHeight: () => 0 }, role: 'solo', elapsed: 0, options: { graphics: 'high' },
    world: { tiles: TILES.map(t => [...t]), decor: DECOR.map(d => ({ ...d })) }, physics: { x: 50, y: 1.8, z: 50 }, other: null, deckY: () => 0.2, ...over };
}
const step = (m, ctx, n = 1, dt = 1 / 60) => { for (let k = 0; k < n; k++) { ctx.elapsed += dt; m.update(dt); } };
const meshes = ctx => ctx.scene.getObjectByName('wildlife').children;

test('smoke: builds with real three, finite matrices, dispose empties the scene', () => {
  const ctx = sceneCtx(), m = createWildlife(ctx);
  const before = ctx.scene.children.length;
  m.debug.summonCircler('dolphin'); m.debug.landGull(0, { instant: true });
  for (let k = 0; k < 300; k++) { ctx.raft.position.y = 0.1 * Math.sin(k / 9); ctx.raft.rotation.z = 0.03 * Math.sin(k / 7); step(m, ctx, 1, 0.05); }
  assert.equal(m.debug.snapshot().built, true);
  assert.equal(ctx.scene.children.length, before + 1);
  let checked = 0;
  for (const mesh of meshes(ctx)) {
    if (mesh.isInstancedMesh) {
      assert.ok(mesh.count > 0 && mesh.count <= mesh.instanceMatrix.count);
      const a = mesh.instanceMatrix.array;
      for (let k = 0; k < mesh.count * 16; k++) assert.ok(Number.isFinite(a[k]), `${mesh.name}[${k}]`);
      checked++;
    } else if (mesh.visible) for (const v of mesh.matrix.elements) assert.ok(Number.isFinite(v));
  }
  assert.equal(checked, 3);
  assert.equal(m.debug.snapshot().circler.kind, 'dolphin');
  ctx.options.graphics = 'low'; step(m, ctx);
  assert.equal(ctx.scene.getObjectByName('gullBody').count, 3);
  assert.equal(ctx.scene.getObjectByName('fish').count, 12);
  m.dispose();
  assert.equal(ctx.scene.children.length, before);
  assert.equal(ctx.scene.getObjectByName('wildlife'), undefined);
  step(m, ctx, 3); // update after dispose does not rebuild
  assert.equal(ctx.scene.children.length, before);
});

test('co-op: the friend walking up scares a perched gull too', () => {
  const ctx = sceneCtx(), m = createWildlife(ctx);
  step(m, ctx);
  const p = m.debug.landGull(0, { instant: true, perch: 0, scare: true });
  step(m, ctx, 3);
  assert.equal(m.debug.snapshot().gulls[0].state, 'perched');
  ctx.other = { x: p.x + 0.5, y: 30, z: p.z }; step(m, ctx, 3); // far above: no
  assert.equal(m.debug.snapshot().gulls[0].state, 'perched');
  ctx.other = { x: p.x + 0.5, y: null, z: p.z }; step(m, ctx, 2); // pose without y: deck height
  assert.equal(m.debug.snapshot().gulls[0].state, 'leave');
});

test('a perched gull stays put when the perch list changes, and takes off when its perch goes', () => {
  const ctx = sceneCtx(), m = createWildlife(ctx);
  const per = perchesFrom(TILES, DECOR);
  let t0 = -1, i0 = -1; // a time when some gull is mid-visit on a perch that is not the first one
  for (let t = 50; t < 5000 && t0 < 0; t += 1) for (let i = 0; i < 6; i++) {
    const o = gullPlan(SEED, i, t, per, fresh());
    if (o.state === 'perched' && o.perch > 0 && gullPlan(SEED, i, t + 3, per, fresh()).state === 'perched') { t0 = t; i0 = i; break; }
  }
  assert.ok(t0 > 0);
  m.debug.setTime(t0 - 0.5); step(m, ctx, 10);
  const snap = () => m.debug.snapshot().gulls[i0];
  const a = snap(); assert.equal(a.state, 'perched');
  // a palm on the first perch shifts every index after it
  const first = per[0].key.split(',').map(Number);
  ctx.world = { tiles: ctx.world.tiles, decor: [...ctx.world.decor, { type: 'palm', x: first[0], z: first[1] }] };
  step(m, ctx);
  const b = snap(); assert.equal(b.state, 'perched');
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1e-6, `jumped ${Math.hypot(a.x - b.x, a.z - b.z)}`);
  // now a palm on its own perch: it takes off, smoothly
  const [kx, kz] = [Math.round(b.x / 2), Math.round(b.z / 2)];
  ctx.world = { tiles: ctx.world.tiles, decor: [...ctx.world.decor, { type: 'palm', x: kx, z: kz }] };
  let prev = snap(); step(m, ctx);
  assert.equal(snap().state, 'leave');
  for (let k = 0; k < 120; k++) { step(m, ctx); const q = snap(); assert.ok(Math.hypot(q.x - prev.x, q.y - prev.y, q.z - prev.z) < 0.3); prev = q; }
});

test('wings fold near the perch and a downstroke never reaches the deck', () => {
  const per = perchesFrom(TILES, DECOR);
  let low = 0;
  for (let i = 0; i < GULL_MAX; i++) for (let s = 0; s < 8000; s++) {
    const o = gullPlan(SEED, i, s / 20, per, fresh());
    if (o.perch < 0 || o.state === 'circle' || o.state === 'perched') continue;
    const hh = o.y - o.py;
    if (hh < FOLD_H) { low++; assert.ok(o.fold > 0.999, `fold ${o.fold} at h ${hh}`); }
    assert.ok(hh + 0.27 + WING_LEN * Math.sin(o.flap) >= 0, `wing tip under the deck at h ${hh}, flap ${o.flap}`);
  }
  assert.ok(low > 50);
});

test('the dolphin leaps every cycle and its back breaks the surface in between', () => {
  let present = 0;
  for (let t = 0; t < 20000 && present < 5; t += 7) {
    const o = circlerAt(SEED, t, fresh()); if (o.kind !== 'dolphin') continue;
    present++;
    let leaps = 0, lastUp = t;
    for (let k = 0; k <= 120; k++) { // 12 s at 10 Hz
      const q = circlerAt(SEED, t + k / 10, fresh()); if (q.kind !== 'dolphin') break;
      if (q.y > 0.5) leaps++;
      if (q.y > -0.1) { assert.ok(t + k / 10 - lastUp <= 2, `under for ${t + k / 10 - lastUp} s`); lastUp = t + k / 10; }
      assert.ok(Number.isFinite(q.pitch) && Math.abs(q.pitch) <= 0.9 + 1e-9);
    }
    assert.ok(leaps >= Math.floor(12 / DOLPHIN_CYCLE) - 1);
  }
  assert.ok(present >= 3);
});

test('landGull never stacks two gulls on one perch', () => {
  const ctx = sceneCtx(), m = createWildlife(ctx);
  step(m, ctx);
  const keys = new Set();
  for (let i = 0; i < 4; i++) keys.add(m.debug.landGull(i, { instant: true }).key);
  assert.equal(keys.size, 4);
});

test('gulls skip perches next to a player and fly away when spooked', () => {
  const ctx = sceneCtx({ physics: { x: -2, y: 1.8, z: -2 } }), m = createWildlife(ctx);
  let perched = 0;
  for (let k = 0; k < 2400; k++) {
    step(m, ctx, 1, 0.25);
    for (const g of m.debug.snapshot().gulls) if (g.state === 'perched') {
      perched++; assert.ok(Math.hypot(g.x + 2, g.z + 2) >= AVOID_RADIUS - 1e-6, `perched ${Math.hypot(g.x + 2, g.z + 2)} m from the player`);
    }
  }
  assert.ok(perched > 20);
  // walk up to a perched gull: it leaves, and moves away from the player while it climbs
  const p = m.debug.landGull(0, { instant: true, perch: 4, scare: true }); step(m, ctx, 3);
  ctx.physics = { x: p.x - 1, y: 1.8, z: p.z }; step(m, ctx, 2);
  assert.equal(m.debug.snapshot().gulls[0].state, 'leave');
  step(m, ctx, 40, 0.05);
  const g = m.debug.snapshot().gulls[0];
  assert.ok(g.x - p.x > 1.5 && g.y > p.y + 1, `gull at ${g.x - p.x}, ${g.y}`);
});
