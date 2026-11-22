// Islands arrive and leave at the draw distance: never rising out of or sinking into the sea in view.
// Run: node --test tests/island-arrival.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { createIslands, ISLAND, VIEW, layoutFor, pathAt, clean, TIMELINE, oldAge } = await import(new URL('islands.js', base));
const { createIslandModels } = await import(new URL('islands-models.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));

const RAFT3 = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
const BASE_Y = -0.24, FOG_NEAR = 90, FOG_FAR = 260;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// If this fails, update VIEW in islands-layout.js to the new camera / fog settings.
test('VIEW matches camera.far and the fog in game.js and daynight.js; spawn and removal are out of sight', () => {
  const game = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');
  const day = readFileSync(fileURLToPath(new URL('daynight.js', base)), 'utf8');
  const cam = game.match(/new T\.PerspectiveCamera\([^,]+,[^,]+,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
  assert.ok(cam, 'camera constructor found');
  assert.equal(Number(cam[2]), VIEW.CAMERA_FAR, 'VIEW.CAMERA_FAR is camera.far');
  const fog = game.match(/new T\.Fog\([^,]+,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
  assert.ok(fog, 'fog found');
  assert.equal(Number(fog[2]), VIEW.FOG_FAR, 'VIEW.FOG_FAR is the clear-weather fog far');
  const dayFar = day.match(/scene\.fog\.far = \(([\d.]+) -/);
  assert.ok(dayFar && Number(dayFar[1]) === VIEW.FOG_FAR, 'daynight never pushes the fog past VIEW.FOG_FAR');
  // The nearest sand at spawn and removal is out of sight from any camera within the 50 m safety radius.
  const hide = Math.min(VIEW.CAMERA_FAR, VIEW.FOG_FAR);
  for (let seed = 0; seed < 300; seed++) {
    const rim = layoutFor(seed).R * ISLAND.RIM;
    assert.ok(-ISLAND.START_Z - rim - PC.MAX_RAFT_DISTANCE >= hide, 'spawns out of sight');
    assert.ok(ISLAND.END_Z - rim - PC.MAX_RAFT_DISTANCE >= hide, 'removed out of sight');
  }
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

test('old saves (no tl) keep their spot; a mid-rise island comes back far out, full height', () => {
  const lay = layoutFor(1234), isl = born => ({ seed: 1234, born, dock: 180, side: 1, off: 20, used: [] });
  const at = (clock, born) => { const c = clean({ v: 1, clock, next: 0, isl: isl(born) }); return c.isl && pathAt(clock - c.isl.born, c.isl.dock, lay.dockZ, {}); };
  // mid-rise (2 s into the old 25 s approach): far out in the fog
  const rise = at(1000, 998);
  assert.equal(rise.phase, 'approach');
  assert.equal(rise.z, ISLAND.START_Z, 'back at the spawn point');
  // approaching 15 s into the old cubic path: same z now
  const z15 = -60 + (lay.dockZ + 60) * (1 - (1 - 15 / 25) ** 3), mid = at(1000, 985);
  assert.equal(mid.phase, 'approach'); assert.ok(Math.abs(mid.z - z15) < 1e-6, `${mid.z} vs ${z15}`);
  // docked 50 s: still docked with the same time left
  const dock = at(1000, 1000 - 75);
  assert.equal(dock.phase, 'docked'); assert.ok(Math.abs(dock.left - 130) < 1e-6);
  // sinking at the end of the old departure: far downstream, still leaving
  const sink = at(1000, 1000 - (25 + 180 + 28));
  const zd = lay.dockZ + (60 - lay.dockZ) * (28 / 30) ** 3;
  assert.equal(sink.phase, 'depart'); assert.ok(Math.abs(sink.z - zd) < 1e-6, 'same spot, drifting on at full height');
  assert.equal(at(1000, 1000 - 400), null, 'long gone');
  // current saves pass through untouched
  const c = clean({ v: 1, clock: 1000, next: 0, isl: { ...isl(990), tl: TIMELINE } });
  assert.equal(c.isl.born, 990); assert.equal(c.isl.tl, TIMELINE);
  assert.equal(oldAge(2, 180, lay.dockZ), 0);
  assert.equal(oldAge(NaN, 180, lay.dockZ), 0);
});

function world() {
  const physics = new PlayerPhysics({ x: 0, y: 0.2 + PC.EYE_OFFSET, z: 0 });
  const scene = new T.Scene(); scene.fog = new T.Fog(0xffffff, FOG_NEAR, FOG_FAR);
  const camera = new T.PerspectiveCamera(70, 16 / 9, 0.05, VIEW.CAMERA_FAR);
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
      f.depth = w.camera.position.distanceTo(sphere.center) - sphere.radius; // nearest distance (island fog runs on distance)
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
    const fogEnd = Math.min(FOG_FAR, VIEW.CAMERA_FAR) - VIEW.FOG_MARGIN; // islands-models.js caps island fog here
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
    const sh = { uniforms: {}, vertexShader: T.ShaderLib.standard.vertexShader, fragmentShader: T.ShaderLib.standard.fragmentShader };
    m.mats[k].onBeforeCompile(sh);
    assert.equal(sh.uniforms.islandFogFar, m.fogClip, k);
    assert.match(sh.fragmentShader, /min\( fogFar, islandFogFar \) \), vIslandFogDist \)/, k);
    // straight-line distance, not view depth: off to the side of the view, depth is well short of the
    // distance, so an island past the draw distance would sit inside the far plane only part fogged
    assert.match(sh.vertexShader, /#include <fog_vertex>\n\tvIslandFogDist = length\( mvPosition\.xyz \);/, k);
    assert.ok(!/smoothstep\( fogNear, fogFar, vFogDepth \)/.test(sh.fragmentShader), k);
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

test('island draws after the sky dome; its fog ends FOG_MARGIN short of the (nearer) far plane', () => {
  const w = world();
  assert.equal(w.group.renderOrder, 2, 'after the sky dome (renderOrder 1), which would paint over it past 150 m');
  w.mod.debug.spawnNear(1234, 0); w.mod.update(0);
  assert.equal(w.mod.debug.state().fogFar, Math.min(VIEW.CAMERA_FAR, VIEW.FOG_FAR) - VIEW.FOG_MARGIN);
  w.camera.far = 120; w.mod.update(0);
  assert.equal(w.mod.debug.state().fogFar, 120 - VIEW.FOG_MARGIN, 'follows a nearer far plane');
  w.camera.far = 1000; w.mod.update(0);
  assert.equal(w.mod.debug.state().fogFar, Math.min(VIEW.CAMERA_FAR, VIEW.FOG_FAR) - VIEW.FOG_MARGIN, 'never past VIEW (the spawn distance assumes it)');
  w.mod.dispose();
});

test('the "drifting this way" notice waits until the island can show through the fog', () => {
  const w = world(), said = [];
  w.ctx.emit = e => { if (e && /drifting this way/.test(e.text)) said.push(w.mod.debug.phase().z); };
  w.mod.debug.spawnNear(1234, 0); w.mod.update(0);
  assert.equal(said.length, 0, 'not while it is past the draw distance');
  while (!said.length && w.mod.debug.phase().phase === 'approach') w.mod.update(0.1);
  // a save made mid-approach, after it was said, does not say it again when loaded
  const s = JSON.parse(JSON.stringify(w.mod.serialize()));
  for (let i = 0; i < ISLAND.APPROACH * 10; i++) w.mod.update(0.1);
  assert.equal(said.length, 1, 'once');
  assert.ok(said[0] >= -150 && said[0] < -140, `said at z ${said[0]}`);
  const v = world(); let again = 0; v.ctx.emit = e => { if (e && /drifting this way/.test(e.text)) again++; };
  v.mod.load(s); for (let i = 0; i < 20; i++) v.mod.update(0.1);
  assert.equal(again, 0);
  w.mod.dispose(); v.mod.dispose();
});
