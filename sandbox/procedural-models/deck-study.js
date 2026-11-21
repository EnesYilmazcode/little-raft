// Procedural-model approaches side by side on the real raft tile.
// ?mode=a  current game path: dist/deck.js createFloor, one material + canvas texture per timber colour
// ?mode=b  bake & merge: same createFloor output -> vertex colours + grid AO -> one mesh, one material
// ?mode=c  instanced kit: chamfered plank/log prototypes, AO baked once, InstancedMesh with per-instance colour
// Options: n=<tiles per side> ao=0|1 chunk=0|1 (b: one mesh for the whole raft) lod=0|1 view=deck|close|far
import * as T from '../../dist/vendor/three.module.js';
import { createFloor } from '../../dist/deck.js';
import { createWoodMaterial } from '../../dist/wood.js';
import { makeRng, chamferBox, mergeColored, groupToParts, bakeGridAO, greyWoodTexture, boxLOD } from './lowpoly.js';

const q = new URLSearchParams(location.search);
const MODE = q.get('mode') || 'b', N = +(q.get('n') || 5), AO = q.get('ao') !== '0', CHUNK = q.get('chunk') === '1', LODON = q.get('lod') === '1', VIEW = q.get('view') || 'deck';

const renderer = new T.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new T.Scene(); scene.background = new T.Color('#cbd2c0'); scene.fog = new T.Fog('#cbd2c0', 25, 125);
scene.add(new T.HemisphereLight('#f2ead4', '#3d6b6a', 1.8));
const sun = new T.DirectionalLight('#fff0c7', 2.5); sun.position.set(-15, 28, 12); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, {left: -25, right: 25, top: 25, bottom: -25}); sun.shadow.bias = -0.001; scene.add(sun);
const water = new T.Mesh(new T.PlaneGeometry(400, 400), new T.MeshStandardMaterial({color: '#2f7f86', roughness: 0.35}));
water.rotation.x = -Math.PI / 2; water.position.y = 0.035; water.receiveShadow = true; scene.add(water);

const camera = new T.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 300);
const off = (N - 1); // raft centre
if (VIEW === 'close') { camera.position.set(off - 0.3, 0.75, off + 1.3); camera.lookAt(off + 0.4, 0.12, off - 0.2); }
else if (VIEW === 'far') { camera.position.set(off + 30, 9, off + 34); camera.lookAt(off, 0, off); }
else { camera.position.set(off + 3.2, 2.4, off + 5.2); camera.lookAt(off, 0.1, off - 0.8); }

// Game-equivalent material cache (game.js mat()).
const TIMBER = new Set(['#bb8a53', '#c69860', '#ad7c4a', '#5e4029', '#9c7649']);
const cache = new Map();
const gameMat = c => { if (!cache.has(c)) cache.set(c, TIMBER.has(c) ? createWoodMaterial(T, c) : new T.MeshStandardMaterial({color: c, roughness: 0.85})); return cache.get(c); };
const bakedMat = new T.MeshStandardMaterial({map: greyWoodTexture(), bumpMap: greyWoodTexture(), bumpScale: 0.018, vertexColors: true, roughness: 0.86});
const shade = m => { m.castShadow = true; m.receiveShadow = true; return m; };

const raft = new T.Group(); scene.add(raft);
const stats = {mode: MODE, tiles: N * N, ao: AO, chunk: CHUNK, lod: LODON};
const t0 = performance.now();
let bakeInfo = null;

if (MODE === 'a') {
  for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) { const g = createFloor(T, x * 719 + z * 311, gameMat); g.position.set(x * 2, 0, z * 2); raft.add(g); }
} else if (MODE === 'b') {
  const tileGeos = [];
  for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) {
    const src = createFloor(T, x * 719 + z * 311, gameMat);
    const parts = groupToParts(src);
    const geo = mergeColored(parts);
    if (AO) bakeInfo = bakeGridAO(geo, {floorY: 0.03});
    const far = LODON ? boxLOD(parts) : null;
    src.userData.dispose();
    if (CHUNK) { geo.translate(x * 2, 0, z * 2); tileGeos.push(geo); continue; }
    if (LODON) {
      const lod = new T.LOD(); lod.position.set(x * 2, 0, z * 2);
      lod.addLevel(shade(new T.Mesh(geo, bakedMat)), 0);
      lod.addLevel(shade(new T.Mesh(far, bakedMat)), 22);
      raft.add(lod);
    } else { const m = shade(new T.Mesh(geo, bakedMat)); m.position.set(x * 2, 0, z * 2); raft.add(m); }
  }
  if (CHUNK) raft.add(shade(new T.Mesh(mergeColored(tileGeos.map(g => ({geometry: g, color: new T.Color(1, 1, 1)}))), bakedMat)));
} else {
  // Instanced kit: a few prototype pieces, transformed and tinted per instance.
  const rng = makeRng(7);
  const plankProto = [0, 1, 2].map(i => chamferBox(1, 0.052, 1.994, 0.012, {jitter: 0.006, rand: makeRng(11 + i), uvScale: 1}));
  const logProto = new T.CylinderGeometry(0.064, 0.066, 1.97, 9, 1).rotateZ(Math.PI / 2).toNonIndexed();
  // AO baked once per prototype against a canonical neighbourhood (neighbour planks + logs + water).
  const ctx = (main, mainM) => {
    const parts = [{geometry: main, color: new T.Color(1, 1, 1), matrix: mainM}];
    const nb = chamferBox(1, 0.052, 1.994, 0.012);
    for (const dx of [-0.25, 0.25]) parts.push({geometry: nb, color: new T.Color(1, 1, 1), matrix: new T.Matrix4().makeTranslation(dx, 0.17, 0).multiply(new T.Matrix4().makeScale(0.236, 1, 1))});
    for (const z of [-0.78, 0.78]) parts.push({geometry: logProto, color: new T.Color(1, 1, 1), matrix: new T.Matrix4().makeTranslation(0, 0.072, z)});
    return parts;
  };
  const bakeProto = (g, m, count) => {
    const merged = mergeColored(ctx(g, m));
    if (AO) bakeInfo = bakeGridAO(merged, {floorY: 0.03});
    // keep only the first `count` vertices (the prototype itself), back in its local space
    const inv = m.clone().invert(), out = new T.BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'color']) { const at = merged.attributes[name]; out.setAttribute(name, new T.BufferAttribute(at.array.slice(0, count * at.itemSize), at.itemSize)); }
    out.applyMatrix4(inv); merged.dispose(); out.computeBoundingSphere(); return out;
  };
  const plankM = new T.Matrix4().makeTranslation(0, 0.17, 0).multiply(new T.Matrix4().makeScale(0.236, 1, 1));
  const planks = plankProto.map(g => bakeProto(g, plankM, g.attributes.position.count));
  const logM = new T.Matrix4().makeTranslation(0, 0.072, -0.78);
  const log = bakeProto(logProto, logM, logProto.attributes.position.count);
  const per = 8, plankIM = planks.map(g => shade(new T.InstancedMesh(g, bakedMat, Math.ceil(N * N * per / 2) + N * N)));
  const logIM = shade(new T.InstancedMesh(log, bakedMat, N * N * 2));
  const used = [0, 0, 0], colors = ['#bb8a53', '#c69860', '#ad7c4a'].map(c => new T.Color(c));
  const M = new T.Matrix4(), Q = new T.Quaternion(), E = new T.Euler(), P = new T.Vector3(), S = new T.Vector3();
  let li = 0;
  for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) {
    const pitch = 2 / per;
    for (let i = 0; i < per; i++) {
      const v = Math.floor(rng() * 3), w = pitch - 0.012 - rng() * 0.008;
      E.set((rng() - 0.5) * 0.01, (rng() - 0.5) * 0.012, (rng() - 0.5) * 0.016);
      P.set(x * 2 - 1 + pitch * (i + 0.5), 0.17 - rng() * 0.008, z * 2); S.set(w, 1, 1);
      M.compose(P, Q.setFromEuler(E), S);
      plankIM[v].setMatrixAt(used[v], M); plankIM[v].setColorAt(used[v]++, colors[Math.floor(rng() * 3)].clone().multiplyScalar(0.92 + rng() * 0.16));
    }
    for (const lz of [-0.78, 0.78]) { M.makeRotationX(rng() * 6.28).setPosition(x * 2, 0.072, z * 2 + lz); logIM.setMatrixAt(li, M); logIM.setColorAt(li++, new T.Color('#5e4029')); }
  }
  plankIM.forEach((im, v) => { im.count = used[v]; im.computeBoundingSphere(); raft.add(im); });
  logIM.count = li; logIM.computeBoundingSphere(); raft.add(logIM);
}
stats.buildMs = +(performance.now() - t0).toFixed(1);
if (bakeInfo) stats.bake = bakeInfo;

let bytes = 0; const seen = new Set();
raft.traverse(o => { if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); for (const a of Object.values(o.geometry.attributes)) bytes += a.array.byteLength; } if (o.isInstancedMesh) bytes += o.instanceMatrix.array.byteLength + (o.instanceColor?.array.byteLength || 0); });
stats.geometryKB = Math.round(bytes / 1024);
stats.materials = MODE === 'a' ? cache.size : 1;
stats.textures = MODE === 'a' ? [...cache.values()].filter(m => m.map).length : 1;

renderer.render(scene, camera);
stats.drawCalls = renderer.info.render.calls; stats.triangles = renderer.info.render.triangles;
const gl = renderer.getContext(); const f0 = performance.now();
for (let i = 0; i < 20; i++) renderer.render(scene, camera);
gl.finish(); stats.msPerFrame = +((performance.now() - f0) / 20).toFixed(2);
renderer.render(scene, camera);

const hud = document.getElementById('hud');
hud.textContent = `mode ${MODE}${MODE === 'b' ? (AO ? ' +AO' : ' noAO') + (CHUNK ? ' chunk' : '') + (LODON ? ' lod' : '') : MODE === 'c' ? (AO ? ' +AO' : ' noAO') : ''}  tiles ${N * N}\n` +
  `draw calls ${stats.drawCalls}  tris ${stats.triangles}\nbuild ${stats.buildMs} ms  frame ${stats.msPerFrame} ms (swiftshader)\ngeometry ${stats.geometryKB} KB  materials ${stats.materials}  textures ${stats.textures}`;
window.__stats = stats; window.__ready = true;
console.log(JSON.stringify(stats));
