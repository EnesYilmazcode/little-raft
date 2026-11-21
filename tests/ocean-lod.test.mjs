// Ocean LOD grid: dense near the camera, coarse far out, watertight seams, world-stable vertices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { createOcean } = await import(new URL('ocean.js?build=v3-survival-ae77fa84ac2b', base));

const key = (x, z) => `${Math.round(x * 100)},${Math.round(z * 100)}`;

test('LOD grid: triangle budget, extent and near density', () => {
  const ocean = createOcean(T);
  const g = ocean.mesh.geometry, P = g.attributes.position, idx = g.index.array;
  const tris = idx.length / 3;
  assert.ok(tris >= 4000 && tris <= 8000, `triangles ${tris}`);
  let ext = 0;
  for (let i = 0; i < P.count; i++) ext = Math.max(ext, Math.abs(P.getX(i)), Math.abs(P.getZ(i)));
  assert.ok(ext >= 140, `extent ${ext}`); // at least the old 280 m plane
  // every triangle touching the 44 m square around the centre is no coarser than the old 2.8 m cells
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    if (!v.some(i => Math.max(Math.abs(P.getX(i)), Math.abs(P.getZ(i))) < 44)) continue;
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3];
      const e = Math.max(Math.abs(P.getX(a) - P.getX(b)), Math.abs(P.getZ(a) - P.getZ(b)));
      assert.ok(e <= 2.8 + 1e-4, `edge ${e} near centre`);
    }
  }
  ocean.dispose();
});

test('LOD grid: seam T-junction vertices are stitched onto the coarse edge', () => {
  const ocean = createOcean(T);
  const g = ocean.mesh.geometry, P = g.attributes.position, S = g.attributes.aStitch, idx = g.index.array;
  const verts = new Set();
  for (let i = 0; i < P.count; i++) verts.add(key(P.getX(i), P.getZ(i)));
  // boundary edges (used by one triangle) must only be the outer rim; any vertex lying strictly inside
  // another triangle's edge must carry a stitch offset pointing at that edge's endpoints
  const count = new Map();
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = idx[t + k], b = idx[t + (k + 1) % 3];
    const ka = key(P.getX(a), P.getZ(a)), kb = key(P.getX(b), P.getZ(b));
    const e = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    count.set(e, (count.get(e) ?? 0) + 1);
  }
  let ext = 0;
  for (let i = 0; i < P.count; i++) ext = Math.max(ext, Math.abs(P.getX(i)));
  ext = Math.round(ext * 100) / 100;
  const stitched = new Map();
  for (let i = 0; i < P.count; i++) if (S.getX(i) || S.getY(i)) stitched.set(key(P.getX(i), P.getZ(i)), [S.getX(i), S.getY(i)]);
  assert.ok(stitched.size > 0);
  for (const [e, n] of count) {
    if (n !== 1) continue;
    const [a, b] = e.split('|').map(s => s.split(',').map(Number).map(v => v / 100));
    if (Math.abs(a[0]) === ext && a[0] === b[0] || Math.abs(a[1]) === ext && a[1] === b[1]) continue; // outer rim
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, mk = key(mx, mz);
    if (stitched.has(mk)) {
      const [sx, sz] = stitched.get(mk);
      assert.ok(Math.abs(Math.abs(sx) + Math.abs(sz) - Math.hypot(b[0] - a[0], b[1] - a[1]) / 2) < 1e-3, 'stitch spans the coarse edge');
      continue;
    }
    // otherwise this is a fine edge whose matching half lies on a stitched coarse edge
    const stA = stitched.has(key(a[0], a[1])), stB = stitched.has(key(b[0], b[1]));
    assert.ok(stA !== stB, `open seam edge ${e}`);
  }
  ocean.dispose();
});

test('LOD grid follows the camera on the coarsest lattice, so vertices stay put in world space', () => {
  const ocean = createOcean(T);
  const camera = new T.PerspectiveCamera(), P = ocean.mesh.geometry.attributes.position;
  const world = () => { const s = new Set(); for (let i = 0; i < P.count; i++) s.add(key(P.getX(i) + ocean.mesh.position.x, P.getZ(i) + ocean.mesh.position.z)); return s; };
  camera.position.set(0, 2, 0); ocean.update(0, camera); const w0 = world();
  camera.position.set(3.1, 2, -4.2); ocean.update(0, camera);
  assert.ok(ocean.mesh.position.x === 0 && ocean.mesh.position.z === 0);
  camera.position.set(60, 2, -30); ocean.update(0, camera);
  assert.ok(Math.hypot(ocean.mesh.position.x - 60, ocean.mesh.position.z + 30) < 10);
  // vertices within 40 m of the camera are a subset of the original fine lattice (no swimming)
  const fine = (x, z) => Math.abs(Math.round(x / 2.8) * 2.8 - x) < 1e-3 && Math.abs(Math.round(z / 2.8) * 2.8 - z) < 1e-3;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i) + ocean.mesh.position.x, z = P.getZ(i) + ocean.mesh.position.z;
    if (Math.hypot(x - 60, z + 30) < 40) assert.ok(fine(x, z), `vertex ${x},${z} off lattice`);
  }
  camera.position.set(0, 2, 0); ocean.update(0, camera);
  assert.deepEqual([...world()].sort(), [...w0].sort());
  ocean.dispose();
});

test('raft mask box covers every pixel whose bilinear taps reach a non-zero texel', () => {
  const ocean = createOcean(T);
  const box = ocean.uniforms.uMaskBox.value, tex = ocean.uniforms.uRaftMask.value, G = tex.image.width;
  const empty = () => box.x >= box.z && box.y >= box.w;
  assert.ok(empty(), 'empty before any tiles');
  ocean.setRaftTiles([[0, 0], [1, 0], [-1, 2], [3, -2]]);
  // a pixel taps texel k when floor(w / 0.5 + G/2 - 0.5) is k - 1 or k, i.e. w in [lo(k), hi(k))
  const lo = (k) => (k - 0.5 - G / 2) * 0.5, hi = (k) => (k + 1.5 - G / 2) * 0.5;
  let n = 0;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    if (!tex.image.data[j * G + i]) continue;
    n++;
    assert.ok(box.x < lo(i) && box.y < lo(j) && hi(i) <= box.z && hi(j) <= box.w, `texel ${i},${j}`);
  }
  assert.ok(n > 0);
  ocean.setRaftTiles([]);
  assert.ok(empty(), 'cleared');
  ocean.dispose();
});
