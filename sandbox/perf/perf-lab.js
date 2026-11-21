// Perf lab: the same raft + floating supplies drawn three ways, with shadow and DPR controls.
// URL params: mode=naive|instanced|batched  items=240  tiles=25  shadow=off|every|cached
//             dpr=auto|<number>  alloc=1 (per-frame allocations, to show GC pressure)
import * as THREE from '../../dist/vendor/three.module.js';
import { createPerfOverlay } from './perf-overlay.js';

const q = new URLSearchParams(location.search);
const cfg = {
  mode: q.get('mode') || 'instanced',
  items: +(q.get('items') || 240),
  tiles: +(q.get('tiles') || 25),
  shadow: q.get('shadow') || 'cached',
  dpr: q.get('dpr') || 'auto',
  alloc: q.get('alloc') === '1',
};

// ---------- renderer / scene ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const maxDpr = Math.min(devicePixelRatio, 1.7);
renderer.setPixelRatio(cfg.dpr === 'auto' ? maxDpr : +cfg.dpr);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = cfg.shadow !== 'off';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = cfg.shadow === 'every';
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cbd2c0');
scene.fog = new THREE.Fog('#cbd2c0', 25, 125);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 200);
camera.position.set(0, 2.6, 4.5);
camera.lookAt(0, 0.4, -12);
scene.add(new THREE.HemisphereLight('#f2ead4', '#3d6b6a', 1.8));
const sun = new THREE.DirectionalLight('#fff0c7', 2.5);
sun.position.set(-15, 28, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.bias = -0.001;
scene.add(sun, sun.target);

const ocean = new THREE.Mesh(new THREE.PlaneGeometry(260, 260, 1, 1), new THREE.MeshStandardMaterial({ color: '#2f7a7a', roughness: 0.35 }));
ocean.rotation.x = -Math.PI / 2;
ocean.receiveShadow = true;
scene.add(ocean);

// One cached material per colour, like game.js mat().
const mats = new Map();
const mat = c => mats.get(c) ?? mats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 })).get(c);

// ---------- geometry recipes ----------
const M4 = () => new THREE.Matrix4();
const at = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => M4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));
const G = {
  plank: new THREE.BoxGeometry(1.9, 0.08, 0.36),
  beam: new THREE.CylinderGeometry(0.09, 0.09, 1.9, 8),
  board: new THREE.BoxGeometry(1.1, 0.06, 0.22),
  barrel: new THREE.CylinderGeometry(0.28, 0.28, 0.62, 12),
  hoop: new THREE.CylinderGeometry(0.295, 0.295, 0.05, 12),
  bottle: new THREE.CylinderGeometry(0.08, 0.08, 0.32, 8),
  cap: new THREE.CylinderGeometry(0.035, 0.035, 0.06, 6),
  leaf: new THREE.ConeGeometry(0.16, 0.55, 5),
};
// Each supply kind is a few parts: [geometry, colour, local matrix]. Real game items are 2-8 meshes each.
const KINDS = [
  [['board', '#c8955a', at(0, 0, 0)], ['board', '#b98550', at(0, 0, 0.24, 0, 0.1, 0)]],
  [['barrel', '#8a5a32', at(0, 0, 0, Math.PI / 2)], ['hoop', '#4a4a4a', at(0.18, 0, 0, 0, 0, Math.PI / 2)], ['hoop', '#4a4a4a', at(-0.18, 0, 0, 0, 0, Math.PI / 2)]],
  [['bottle', '#cfe3ea', at(0, 0, 0, 0, 0, Math.PI / 2)], ['cap', '#2a6fd0', at(0.19, 0, 0, 0, 0, Math.PI / 2)]],
  [['leaf', '#4f9b3a', at(0, 0, 0, Math.PI / 2)], ['leaf', '#5aa844', at(0.1, 0, 0.08, Math.PI / 2, 0.6)], ['leaf', '#447f33', at(-0.1, 0, -0.06, Math.PI / 2, -0.5)]],
];
const tileParts = () => {
  const out = [];
  for (let i = 0; i < 5; i++) out.push(['plank', i % 2 ? '#d9a868' : '#c99657', at(0, 0.12, -0.76 + i * 0.38)]);
  out.push(['beam', '#7a5532', at(0, 0, -0.6, 0, 0, Math.PI / 2)], ['beam', '#7a5532', at(0, 0, 0.6, 0, 0, Math.PI / 2)]);
  return out;
};

// ---------- tiny mergeGeometries (no addons vendored) ----------
function mergeTransformed(list) { // list: [{geo, matrix}] -> indexed BufferGeometry with position/normal/uv
  let nv = 0, ni = 0;
  for (const { geo } of list) { nv += geo.attributes.position.count; ni += geo.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  let vo = 0, io = 0;
  for (const { geo, matrix } of list) {
    const p = geo.attributes.position, n = geo.attributes.normal, t = geo.attributes.uv;
    nm.getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix); pos.set([v.x, v.y, v.z], (vo + i) * 3);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (vo + i) * 3);
      uv[(vo + i) * 2] = t.getX(i); uv[(vo + i) * 2 + 1] = t.getY(i);
    }
    for (let i = 0; i < geo.index.count; i++) idx[io + i] = geo.index.getX(i) + vo;
    vo += p.count; io += geo.index.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

// ---------- raft ----------
const raft = new THREE.Group();
scene.add(raft);
const side = Math.ceil(Math.sqrt(cfg.tiles));
const tileXZ = [];
for (let i = 0; i < cfg.tiles; i++) tileXZ.push([(i % side - (side - 1) / 2) * 2, (Math.floor(i / side) - (side - 1) / 2) * 2]);
if (cfg.mode === 'naive') {
  for (const [x, z] of tileXZ) for (const [g, c, m] of tileParts()) {
    const mesh = new THREE.Mesh(G[g], mat(c));
    mesh.applyMatrix4(m); mesh.position.x += x; mesh.position.z += z;
    mesh.castShadow = mesh.receiveShadow = true; raft.add(mesh);
  }
} else { // static batching: one merged mesh per colour for the whole raft
  const byColor = new Map();
  for (const [x, z] of tileXZ) for (const [g, c, m] of tileParts()) {
    if (!byColor.has(c)) byColor.set(c, []);
    byColor.get(c).push({ geo: G[g], matrix: at(x, 0, z).multiply(m) });
  }
  for (const [c, list] of byColor) { const mesh = new THREE.Mesh(mergeTransformed(list), mat(c)); mesh.castShadow = mesh.receiveShadow = true; raft.add(mesh); }
}
const raftRadius = side * 1.5 + 1;

// ---------- floating supplies ----------
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const items = [];
for (let i = 0; i < cfg.items; i++) {
  const a = rnd() * Math.PI * 2, d = raftRadius + 2 + rnd() * 55;
  items.push({ kind: i % KINDS.length, x: Math.sin(a) * d, z: Math.cos(a) * d, phase: rnd() * 6.28, yaw: rnd() * 6.28, vx: (rnd() - 0.5) * 0.4 });
}
const itemsCast = cfg.shadow === 'every'; // cached mode: far supplies do not cast
const tmpM = M4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpP = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), partM = M4();
function itemMatrix(it, t, out) {
  if (cfg.alloc) { // the GC-heavy pattern: fresh objects every item every frame
    const p = new THREE.Vector3(it.x, Math.sin(t * 1.3 + it.phase) * 0.08, it.z);
    const e = new THREE.Euler(Math.sin(t + it.phase) * 0.05, it.yaw + t * 0.08, Math.cos(t * 0.9 + it.phase) * 0.05);
    return out.copy(new THREE.Matrix4().compose(p.clone(), new THREE.Quaternion().setFromEuler(e), ONE.clone()));
  }
  tmpP.set(it.x, Math.sin(t * 1.3 + it.phase) * 0.08, it.z);
  tmpE.set(Math.sin(t + it.phase) * 0.05, it.yaw + t * 0.08, Math.cos(t * 0.9 + it.phase) * 0.05);
  return out.compose(tmpP, tmpQ.setFromEuler(tmpE), ONE);
}

let updateItems;
if (cfg.mode === 'naive') {
  const groups = items.map(it => {
    const g = new THREE.Group();
    for (const [geo, c, m] of KINDS[it.kind]) { const mesh = new THREE.Mesh(G[geo], mat(c)); mesh.applyMatrix4(m); mesh.castShadow = itemsCast; g.add(mesh); }
    g.matrixAutoUpdate = false; scene.add(g); return g;
  });
  updateItems = t => { for (let i = 0; i < items.length; i++) itemMatrix(items[i], t, groups[i].matrix); };
} else if (cfg.mode === 'instanced') {
  // One InstancedMesh per (kind, part). 4 kinds -> 10 draw calls for every supply on the sea.
  const parts = [];
  KINDS.forEach((kind, k) => {
    const n = items.filter(it => it.kind === k).length;
    kind.forEach(([geo, c, m]) => {
      const im = new THREE.InstancedMesh(G[geo], mat(c), n);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = itemsCast; im.frustumCulled = false; // instances span the whole sea; bounds would need a recompute per frame
      scene.add(im); parts.push({ k, im, m });
    });
  });
  updateItems = t => {
    const slot = [0, 0, 0, 0];
    for (const it of items) {
      itemMatrix(it, t, tmpM); const s = slot[it.kind]++;
      for (const p of parts) if (p.k === it.kind) p.im.setMatrixAt(s, partM.multiplyMatrices(tmpM, p.m));
    }
    for (const p of parts) p.im.instanceMatrix.needsUpdate = true;
  };
} else { // batched: every part of every supply in ONE BatchedMesh, colour per instance
  const geoIds = {}, list = [];
  let nv = 0, ni = 0, ninst = 0;
  for (const k of KINDS) ninst += k.length * Math.ceil(cfg.items / KINDS.length);
  for (const [name, g] of Object.entries(G)) { nv += g.attributes.position.count; ni += g.index.count; }
  const bm = new THREE.BatchedMesh(ninst, nv, ni, new THREE.MeshStandardMaterial({ roughness: 0.85 }));
  for (const [name, g] of Object.entries(G)) geoIds[name] = bm.addGeometry(g);
  const col = new THREE.Color();
  for (const it of items) for (const [geo, c, m] of KINDS[it.kind]) {
    const id = bm.addInstance(geoIds[geo]); bm.setColorAt(id, col.set(c)); list.push({ it, id, m });
  }
  bm.castShadow = itemsCast;
  bm.sortObjects = false; // opaque: depth sort buys little and costs CPU
  scene.add(bm);
  updateItems = t => {
    let last = null;
    for (const e of list) { if (e.it !== last) { itemMatrix(e.it, t, tmpM); last = e.it; } bm.setMatrixAt(e.id, partM.multiplyMatrices(tmpM, e.m)); }
  };
}

// ---------- shadows ----------
// cached: tight frustum around the raft only, re-rendered at ~10 Hz instead of every frame.
function fitShadow(r) {
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 80 });
  sun.shadow.camera.updateProjectionMatrix();
}
fitShadow(cfg.shadow === 'cached' ? raftRadius + 1 : 25);
let shadowClock = 0;

// ---------- overlay + adaptive DPR (the in-game proposal, perf-overlay.js) ----------
const perf = createPerfOverlay({ renderer, maxPixelRatio: maxDpr, dynamic: cfg.dpr === 'auto' });
perf.el.hidden = false;

// ---------- loop ----------
let t = 0;
function step(dt) {
  t += dt;
  raft.position.y = Math.sin(t * 0.7) * 0.06;
  raft.rotation.set(Math.sin(t * 0.5) * 0.02, 0, Math.cos(t * 0.6) * 0.02);
  updateItems(t);
  if (cfg.shadow === 'cached') { shadowClock += dt; if (shadowClock >= 0.1) { shadowClock = 0; renderer.shadowMap.needsUpdate = true; } }
  renderer.render(scene, camera);
}

const hud = document.getElementById('hud');
const heap = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
let last = performance.now(), hudClock = 0, frames = 0, msAcc = 0;
function animate(now) {
  if (window.__benchRunning) return;
  requestAnimationFrame(animate);
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  perf.begin(); const t0 = performance.now(); step(dt); const cpu = performance.now() - t0; perf.end();
  frames++; msAcc += cpu; hudClock += dt;
  if (hudClock > 0.5) {
    const i = renderer.info;
    hud.textContent = `${cfg.mode} · shadow ${cfg.shadow}${cfg.alloc ? ' · alloc' : ''}\ncalls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(1)}k\ngeometries ${i.memory.geometries}  programs ${i.programs.length}\ncpu ${(msAcc / frames).toFixed(2)} ms  fps ${(frames / hudClock).toFixed(0)}\ndpr ${renderer.getPixelRatio().toFixed(2)}  heap ${(heap() / 1048576).toFixed(1)} MB`;
    hudClock = 0; frames = 0; msAcc = 0;
  }
}
requestAnimationFrame(animate);

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// Deterministic benchmark for headless runs: fixed dt, gl.finish() so GPU work is inside the timing.
window.runBench = (n = 120) => {
  window.__benchRunning = true;
  const gl = renderer.getContext();
  for (let i = 0; i < 10; i++) step(1 / 60); // warm-up: shader compile, first uploads
  gl.finish();
  let calls = 0, tris = 0, frameCalls = [];
  const times = [], h0 = heap();
  for (let i = 0; i < n; i++) {
    renderer.info.reset(); const t0 = performance.now(); step(1 / 60); gl.finish(); times.push(performance.now() - t0);
    calls += renderer.info.render.calls; tris += renderer.info.render.triangles; frameCalls.push(renderer.info.render.calls);
  }
  times.sort((a, b) => a - b);
  window.__benchRunning = false; last = performance.now(); requestAnimationFrame(animate);
  return {
    mode: cfg.mode, shadow: cfg.shadow, alloc: cfg.alloc, items: cfg.items, tiles: cfg.tiles,
    callsAvg: +(calls / n).toFixed(1), callsMin: Math.min(...frameCalls), callsMax: Math.max(...frameCalls),
    trisAvg: Math.round(tris / n), msMedian: +times[n >> 1].toFixed(2), msP95: +times[Math.floor(n * 0.95)].toFixed(2),
    heapDeltaKB: Math.round((heap() - h0) / 1024), multiDraw: !!renderer.extensions.get('WEBGL_multi_draw'),
    sceneObjects: (() => { let c = 0; scene.traverse(() => c++); return c; })(),
  };
};
window.__ready = true;
