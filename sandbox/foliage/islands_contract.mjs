// Node check of the islands contracts with foliage.js as the vegetation provider (run by adopt_check.py).
//   RAFT_DIST=<patched dist> node sandbox/foliage/islands_contract.mjs  -> prints JSON, exits 1 on a broken contract
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = pathToFileURL(resolve(process.env.RAFT_DIST || 'dist') + '/').href;
const T = await import(new URL('vendor/three.module.js', base));
const { createFoliage } = await import(new URL('foliage.js?build=v3-survival-ae77fa84ac2b', base));
const { createIslands, layoutFor } = await import(new URL('islands.js', base));
const { PALM_H, PALM_BEND } = await import(new URL('islands-models.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));

const out = { ok: true, problems: [] };
const fail = (m) => { out.ok = false; out.problems.push(m); };
const RAFT3 = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

function world(foliage, graphics = 'medium') {
  const scene = new T.Scene(), physics = new PlayerPhysics({ x: 0, y: 0.2 + PC.EYE_OFFSET, z: 0 });
  const ctx = { T, scene, camera: new T.PerspectiveCamera(70, 1, 0.05, 200), foliage, options: { graphics },
    ocean: { mesh: { position: { y: -0.24 } }, getHeight: () => -0.24 }, world: { tiles: RAFT3 }, role: 'host', running: true, physics, other: null,
    emit: () => {}, action: () => true };
  return { ctx, mod: createIslands(ctx), scene };
}

const F = createFoliage(T);
const plain = world(null), fol = world(F);
for (const w of [plain, fol]) { w.mod.debug.spawnNear(1234); w.mod.update(0); }
const byName = (w, n) => w.scene.getObjectByName(n);

// 1. the gatherable meshes keep their names, counts and instance colours; only geometry/material change
for (const n of ['island-palm', 'island-palmSpent', 'island-nuts', 'island-bush', 'island-rock', 'island-sand']) {
  const a = byName(plain, n), b = byName(fol, n);
  if (!a || !b) { fail(`${n} missing`); continue; }
  if (a.count !== b.count) fail(`${n} count ${a.count} vs ${b.count}`);
  if (!b.instanceColor) fail(`${n} lost instanceColor`);
}
out.swapped = ['island-palm', 'island-palmSpent', 'island-nuts', 'island-bush'].map(n => {
  const m = byName(fol, n); return { n, foliage: !!m.material.userData.foliage, depth: !!m.customDepthMaterial, tris: m.geometry.attributes.position.count / 3 };
});
for (const s of out.swapped) if (!s.foliage || !s.depth) fail(`${s.n} not foliage-driven`);

// 2. the palm trunk follows the islands spine, so the pick capsule (radius .25) and SOLID_R (.28) still fit it
{
  const g = byName(fol, 'island-palm').geometry, p = g.attributes.position;
  let worst = 0, n = 0;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i); if (y < 0.3 || y > PALM_H - 0.4) continue;
    const s = y / PALM_H, cx = PALM_BEND * s * s, r = Math.hypot(p.getX(i) - cx, p.getZ(i));
    if (r < 0.4) { worst = Math.max(worst, r); n++; } // trunk vertices (leaflets are farther out)
  }
  out.trunk = { verts: n, maxRadiusFromSpine: +worst.toFixed(3) };
  if (n < 50 || worst > 0.25) fail(`trunk off the pick capsule: ${worst}`);
}
// 3. picks, gather loot and spent swap are unchanged (same results with and without foliage)
for (const w of [plain, fol]) {
  const i = w.mod.debug.nodes().findIndex(n => n.kind === 'palm');
  w.mod.debug.aimAt(i); w.mod.afterMove(w.ctx.physics, 0); w.mod.update(0);
  const n = w.mod.debug.nodes()[i], c = new T.Vector3(); w.ctx.camera.position.set(w.ctx.physics.x, w.ctx.physics.y, w.ctx.physics.z);
  w.ctx.camera.lookAt(n.ax, n.cy, n.az); w.ctx.camera.updateMatrixWorld();
  w.pick = w.mod.debug.pick(); w.palm = i;
  w.mod.debug.drain(); w.mod.update(0);
  w.spent = { palm: byName(w, 'island-palm').instanceMatrix.array[0], spent: byName(w, 'island-palmSpent').instanceMatrix.array[0] };
}
out.pick = { plain: [plain.pick, plain.palm], foliage: [fol.pick, fol.palm] };
if (fol.pick !== fol.palm || plain.pick !== plain.palm) fail('palm pick changed');
if (fol.spent.palm !== 0 || fol.spent.spent === 0) fail('spent swap broken');

// 4. decor: deterministic, inside the island, density follows the preset
const decor = (w) => Object.fromEntries(['fern', 'broadleaf', 'grass', 'beach'].map(k => [k, byName(w, 'island-decor-' + k)?.count ?? 0]));
out.decor = { medium: decor(fol) };
const low = world(F, 'low'), high = world(F, 'high');
for (const w of [low, high]) { w.mod.debug.spawnNear(1234); w.mod.update(0); }
out.decor.low = decor(low); out.decor.high = decor(high);
const again = world(F); again.mod.debug.spawnNear(1234); again.mod.update(0);
const sameA = byName(again, 'island-decor-grass').instanceMatrix.array.slice(0, 64).join(), sameB = byName(fol, 'island-decor-grass').instanceMatrix.array.slice(0, 64).join();
if (sameA !== sameB) fail('decor not deterministic');
if (!(out.decor.low.grass < out.decor.medium.grass && out.decor.medium.grass <= out.decor.high.grass)) fail('density tiers');
const lay = layoutFor(1234);
{
  const m = byName(fol, 'island-decor-grass'), m4 = new T.Matrix4(), v = new T.Vector3();
  let outside = 0;
  for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, m4); v.setFromMatrixPosition(m4); if (Math.hypot(v.x, v.z) > lay.R) outside++; }
  out.decor.grassOutsideR = outside; if (outside) fail('grass off the island');
}
// 5. 300 seeds lay out without throwing
let seeds = 0; for (let s = 0; s < 300; s++) { fol.mod.debug.spawnNear((s * 2654435761) >>> 0); fol.mod.update(0); seeds++; }
out.seeds = seeds;
// 6. dispose frees the depth twins with their materials
let disposedDepth = 0;
const tw = byName(again, 'island-palm').customDepthMaterial; tw.addEventListener('dispose', () => disposedDepth++);
again.mod.dispose(); out.depthTwinDisposed = disposedDepth === 1; if (!out.depthTwinDisposed) fail('depth twin leaked');
console.log(JSON.stringify(out));
process.exit(out.ok ? 0 : 1);
