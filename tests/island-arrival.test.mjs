// Islands arrive and leave at the draw distance: never rising out of or sinking into the sea in view.
// Run: node --test tests/island-arrival.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { createIslands, ISLAND, layoutFor, pathAt, clean, TIMELINE, oldAge } = await import(new URL('islands.js', base));
const { createIslandModels } = await import(new URL('islands-models.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));

const RAFT3 = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
const BASE_Y = -0.24, FOG_NEAR = 90, FOG_FAR = 260;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

test('the draw distance in islands-layout matches camera.far and fog in game.js', () => {
  const game = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');
  const cam = game.match(/new T\.PerspectiveCamera\([^,]+,[^,]+,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
  assert.ok(cam, 'camera constructor found');
  assert.equal(Number(cam[2]), ISLAND.VIEW, 'ISLAND.VIEW is camera.far');
  const fog = game.match(/new T\.Fog\([^,]+,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
  assert.ok(fog && Number(fog[1]) < ISLAND.VIEW, 'fog starts inside the draw distance');
  // Spawn and removal points clear the draw distance from anywhere on a 10 m raft, island radius included.
  const rMax = 9 * ISLAND.RIM + 6;
  assert.ok(-ISLAND.START_Z - 10 - rMax > ISLAND.VIEW, 'spawns past the draw distance');
  assert.ok(ISLAND.END_Z - 10 - rMax > ISLAND.VIEW, 'removed past the draw distance');
});

test('pathAt: steady drift, no jumps, no vertical term', () => {
  for (const dz of [0, -3, -6]) {
    let last = pathAt(0, ISLAND.DOCK, dz), lastV = NaN, maxV = 0; // already drifting when it spawns (out of view)
    assert.equal(last.z, ISLAND.START_Z);
    assert.equal('sink' in last, false);
    const dt = 0.05;
    for (let t = dt; t <= ISLAND.APPROACH + ISLAND.DOCK + ISLAND.DEPART + 1; t += dt) {
      const p = pathAt(t, ISLAND.DOCK, dz), v = (p.z - last.z) / dt;
      if (p.phase === 'gone') { last = p; break; } // removed out of view, still drifting
      assert.ok(v >= -1e-9, 'always drifts the same way');
      assert.ok(!(Math.abs(v - lastV) >= 0.2), `no speed jump at t=${t.toFixed(2)}`);
      maxV = Math.max(maxV, v); lastV = v; last = p;
    }
    assert.ok(maxV < 3.2, `gentle drift (${maxV.toFixed(2)} m/s)`);
    assert.equal(last.phase, 'gone');
  }
});

test('old saves (no tl) keep their phase; a mid-rise island comes back far out, full height', () => {
  const lay = layoutFor(1234), isl = born => ({ seed: 1234, born, dock: 180, side: 1, off: 20, used: [] });
  const at = (clock, born) => { const c = clean({ v: 1, clock, next: 0, isl: isl(born) }); return c.isl && pathAt(clock - c.isl.born, c.isl.dock, lay.dockZ, {}); };
  // mid-rise (2 s into the old 25 s approach): far out in the fog
  const rise = at(1000, 998);
  assert.equal(rise.phase, 'approach');
  assert.ok(rise.z < -(ISLAND.VIEW - 20), `far away (${rise.z.toFixed(0)} m)`);
  // docked 50 s: still docked with the same time left
  const dock = at(1000, 1000 - 75);
  assert.equal(dock.phase, 'docked'); assert.ok(Math.abs(dock.left - 130) < 1e-6);
  // sinking at the end of the old departure: far downstream, still leaving
  const sink = at(1000, 1000 - (25 + 180 + 28));
  assert.equal(sink.phase, 'depart'); assert.ok(sink.z > ISLAND.VIEW - 20);
  assert.equal(at(1000, 1000 - 400), null, 'long gone');
  // current saves pass through untouched
  const c = clean({ v: 1, clock: 1000, next: 0, isl: { ...isl(990), tl: TIMELINE } });
  assert.equal(c.isl.born, 990); assert.equal(c.isl.tl, TIMELINE);
  assert.equal(oldAge(10, 180), 40);
});

function world() {
  const physics = new PlayerPhysics({ x: 0, y: 0.2 + PC.EYE_OFFSET, z: 0 });
  const scene = new T.Scene(); scene.fog = new T.Fog(0xffffff, FOG_NEAR, FOG_FAR);
  const camera = new T.PerspectiveCamera(70, 16 / 9, 0.05, ISLAND.VIEW);
  const ctx = {
    T, scene, camera, ocean: { mesh: { position: { y: BASE_Y } }, getHeight: () => BASE_Y },
    world: { tiles: RAFT3 }, role: 'solo', running: true, physics, other: null, emit() {}, action: () => true,
  };
  const mod = createIslands(ctx);
  const group = scene.getObjectByName('islands'), veg = group.children.filter(o => o.isInstancedMesh);
  return { ctx, mod, scene, camera, group, veg, lagoon: scene.getObjectByName('islandLagoon') };
}

// Steps one island from spawn to removal with the camera looking straight at it (the worst case: always
// inside the frustum sideways) from eye (ex, ez). Returns what the camera could see on each frame.
function run(ex, ez) {
  const w = world(), frustum = new T.Frustum(), pv = new T.Matrix4(), sphere = new T.Sphere(), tmp = new T.Sphere();
  w.mod.debug.spawnNear(1234, 0);
  const frames = [];
  const dt = 1 / 30, total = ISLAND.APPROACH + ISLAND.DOCK + ISLAND.DEPART + 5;
  for (let i = 0; i <= total / dt; i++) {
    w.mod.afterMove(null, dt); w.mod.update(dt);
    const ph = w.mod.debug.phase(), st = w.mod.debug.state();
    const f = { t: i * dt, phase: ph.phase, shown: st.shown, y: w.group.position.y, scale: w.veg.every(m => m.scale.x === 1 && m.scale.y === 1 && m.scale.z === 1), inView: false, depth: Infinity };
    if (st.shown) {
      w.camera.position.set(ex, 0.2 + PC.EYE_OFFSET, ez); w.camera.lookAt(st.cx, st.gy, st.cz); w.camera.updateMatrixWorld();
      pv.multiplyMatrices(w.camera.projectionMatrix, w.camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pv);
      w.scene.updateMatrixWorld(true);
      let first = true;
      for (const o of [...w.group.children, w.lagoon]) {
        if (o.isInstancedMesh) { if (!o.count) continue; o.computeBoundingSphere(); tmp.copy(o.boundingSphere); }
        else { o.geometry.computeBoundingSphere(); tmp.copy(o.geometry.boundingSphere); }
        tmp.applyMatrix4(o.matrixWorld);
        if (first) { sphere.copy(tmp); first = false; } else sphere.union(tmp);
      }
      f.inView = frustum.intersectsSphere(sphere);
      f.depth = w.camera.position.distanceTo(sphere.center) - sphere.radius; // nearest view depth (looking at the centre)
    }
    frames.push(f);
    if (ph.phase === 'calm' && i * dt > ISLAND.APPROACH) break;
  }
  w.mod.dispose();
  return frames;
}

for (const [ex, ez] of [[0, 0], [5, -5], [-5, 5]]) {
  test(`arrival and departure from the deck at (${ex}, ${ez}): full height whenever in view, fog does the fading`, () => {
    const frames = run(ex, ez);
    const fogEnd = Math.min(FOG_FAR, ISLAND.VIEW * 0.97); // islands-models.js caps island fog here
    const firstIn = frames.findIndex(f => f.inView);
    assert.ok(firstIn > 0, 'starts out of view');
    const a = frames[firstIn];
    assert.equal(a.phase, 'approach');
    assert.equal(a.y, BASE_Y, 'at full height on the first visible frame');
    assert.equal(a.scale, true, 'vegetation at full scale on the first visible frame');
    assert.ok(smooth(FOG_NEAR, fogEnd, a.depth) > 0.999, `fully fogged when it first enters view (depth ${a.depth.toFixed(1)} m)`);
    for (const f of frames) if (f.shown) {
      assert.equal(f.y, BASE_Y, `never moves vertically (t=${f.t.toFixed(1)}, ${f.phase})`);
      assert.equal(f.scale, true, `never scales (t=${f.t.toFixed(1)})`);
    }
    // Departure: visible frames all at full height (checked above); removal only once out of view.
    const lastIn = frames.findLastIndex(f => f.inView);
    assert.equal(frames[lastIn].phase, 'depart');
    assert.ok(smooth(FOG_NEAR, fogEnd, frames[lastIn].depth) > 0.999, 'fully fogged when it leaves view');
    const gone = frames.findIndex((f, i) => i > firstIn && !f.shown);
    assert.ok(gone > lastIn, 'removed only after leaving view');
    assert.ok(frames.slice(firstIn, lastIn).filter(f => f.phase !== 'docked').length > 30, 'in view for a good while while drifting');
  });
}

test('island materials end their fog inside camera.far; lagoon fades out with the far sea', () => {
  const m = createIslandModels(T, null);
  for (const k of ['dome', 'palm', 'palmSpent', 'nuts', 'bush', 'rock', 'sand']) {
    const sh = { uniforms: {}, fragmentShader: '#include <fog_pars_fragment>\nvoid main() {\n#include <fog_fragment>\n}' };
    m.mats[k].onBeforeCompile(sh);
    assert.equal(sh.uniforms.islandFogFar, m.fogClip, k);
    assert.match(sh.fragmentShader, /min\( fogFar, islandFogFar \* 0\.97 \)/, k);
  }
  assert.equal(m.mats.dome.onBeforeCompile, m.mats.rock.onBeforeCompile, 'one shared patch (shared programs)');
  assert.match(m.mats.lagoon.fragmentShader, /gl_FragColor\.a \*= 1\.0 - fade/);
  m.dispose();
});

test('serialize carries the timeline version so peers and saves skip the old-save mapping', () => {
  const w = world();
  w.mod.debug.spawnNear(77, 10);
  const s = JSON.parse(JSON.stringify(w.mod.serialize()));
  assert.equal(s.isl.tl, TIMELINE);
  const g = world(); g.ctx.role = 'guest';
  g.mod.load(s, 'net'); g.mod.update(0);
  assert.ok(Math.abs(g.mod.debug.phase().t - 10) < 1e-6, 'guest sees the same age');
  assert.ok(Math.abs(g.mod.debug.phase().z - w.mod.debug.phase().z) < 1e-9);
  w.mod.dispose(); g.mod.dispose();
});
