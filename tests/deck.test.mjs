// Raft deck mesh: cached tile parts, vertex-coloured planks and chunk reuse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { createRaftMesh, createFloor, CHUNK_MIN_TILES } = await import(new URL('deck.js', base));

const grid = (n, extra = []) => { const out = []; for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) out.push([x, z]); return [...out, ...extra].map(([x, z]) => ({index:x * 719 + z * 311, x:x * 2, z:z * 2})); };
const shared = new T.MeshStandardMaterial(), mat = () => shared, planks = new T.MeshStandardMaterial({vertexColors:true});
const meshes = g => { const m = []; g.traverse(o => { if (o.isMesh) m.push(o); }); return m; };
const verts = g => meshes(g).reduce((s, m) => s + m.geometry.attributes.position.count, 0);

test('deck: merged raft matches the per-tile floors (positions offset by the tile origin)', () => {
  const tiles = grid(2), raft = createRaftMesh(T, tiles, mat);
  let want = 0; const box = new T.Box3();
  for (const t of tiles) { const f = createFloor(T, t.index, mat); want += verts(f); f.position.set(t.x, 0, t.z); f.updateMatrixWorld(true); box.expandByObject(f); f.userData.dispose(); }
  assert.equal(verts(raft), want);
  const got = new T.Box3(); raft.updateMatrixWorld(true); got.expandByObject(raft);
  for (const k of ['min', 'max']) for (const a of ['x', 'y', 'z']) assert.ok(Math.abs(got[k][a] - box[k][a]) < 1e-5, `${k}.${a}`);
  raft.userData.dispose();
});

test('deck: timberMaterial folds planks and logs into one vertex-coloured mesh', () => {
  const plain = createRaftMesh(T, grid(2), mat), vc = createRaftMesh(T, grid(2), mat, {timberMaterial:planks});
  const p = meshes(vc).filter(m => m.name === 'floor-timber');
  assert.equal(p.length, 1); assert.equal(p[0].material, planks); assert.ok(p[0].geometry.attributes.color);
  assert.ok(meshes(plain).filter(m => m.name === 'floor-planks').length > 1);
  assert.equal(verts(plain), verts(vc));
  plain.userData.dispose(); vc.userData.dispose();
});

test('deck: big rafts are chunked and an added tile rebuilds only its chunk', () => {
  const a = createRaftMesh(T, grid(7), mat, {timberMaterial:planks});
  assert.ok(grid(7).length >= CHUNK_MIN_TILES);
  assert.equal(a.children.length, 4);
  const before = new Map(a.children.map(c => [c.userData.chunk, c]));
  const b = createRaftMesh(T, grid(7, [[6, 7]]), mat, {prev:a, timberMaterial:planks}); // lands in the +x,+z chunk
  assert.equal(b.children.length, 4);
  assert.equal(b.children.filter(c => before.get(c.userData.chunk) === c).length, 3);
  assert.equal(a.children.length, 1); // only the replaced chunk is left in prev, for its dispose()
  assert.equal(verts(b) > verts(createRaftMesh(T, grid(7), mat, {timberMaterial:planks})), true);
  a.userData.dispose(); b.userData.dispose();
});
