// Low-poly prop gallery: new kit (lowpoly-props.js) vs current dist builders, same lights as dist/game.js.
// ?view=grid&page=0|1     turntable grid (rows = yaw angles, cols = 6 props), new set
// ?view=compare&page=0|1  current (top row) vs new (bottom row), hero angle
// ?view=scene             raft + crafts + floating debris, current (left) vs new (right), with frame stats
// ?view=stats             per-model triangles, meshes, draw calls (incl. shadow pass), build ms, frame ms
// ?view=spin              live turntable of all new props (interactive check, not used by shoot.py)
import * as T from '../../dist/vendor/three.module.js';
import { createDebris } from '../../dist/debris.js';
import { createPlastic } from '../../dist/plastic.js';
import { createCraft } from '../../dist/crafts.js';
import { createFloor } from '../../dist/deck.js';
import { createWoodMaterial } from '../../dist/wood.js';
import * as LP from './lowpoly-props.js';

const q = new URLSearchParams(location.search);
const VIEW = q.get('view') || 'compare', PAGE = +(q.get('page') || 0);
const NAMES = LP.PROP_NAMES; // plank barrel jug leaf scrap crate | sail palm lantern deck net bench
const pageNames = NAMES.slice(PAGE * 6, PAGE * 6 + 6);

// ---- game-equivalent material cache for the CURRENT models (dist/game.js mat())
const TIMBER = new Set(['#bb8a53', '#c69860', '#ad7c4a', '#5e4029', '#9c7649', '#c8995f', '#d3a368', '#8c6745', '#d5a265', '#a97d4c', '#b4824b', '#906f48', '#725942', '#756a49', '#ad8153']);
const cache = new Map();
const mat = c => { if (!cache.has(c)) cache.set(c, TIMBER.has(c) ? createWoodMaterial(T, c) : new T.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0 })); return cache.get(c); };
function current(name, seed = 7) {
  if (name === 'plank') return createDebris(T, 'wood', mat, { seed });
  if (name === 'leaf' || name === 'scrap' || name === 'barrel') return createDebris(T, name, mat, { seed });
  if (name === 'jug') return createPlastic(T);
  if (name === 'deck') return createFloor(T, seed, mat);
  return createCraft(T, name);
}
const fresh = (name, seed = 7) => LP.createProp(T, name, { seed });
const shade = g => { g.traverse(o => { if (o.isMesh && !o.userData.glass) { o.castShadow = true; o.receiveShadow = true; } }); return g; };

// ---- renderer + stage (lights copied from dist/game.js mount)
const wrap = document.getElementById('wrap');
const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping;
wrap.appendChild(renderer.domElement);
renderer.setScissorTest(true);

function stage({ ground = true } = {}) {
  const s = new T.Scene(); s.background = new T.Color('#cbd2c0');
  s.add(new T.HemisphereLight('#f2ead4', '#3d6b6a', 1.8));
  const sun = new T.DirectionalLight('#fff0c7', 2.5); sun.position.set(-15, 28, 12); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.001; s.add(sun); s.add(sun.target);
  s.userData.sun = sun;
  if (ground) {
    const disc = new T.Mesh(new T.CylinderGeometry(1, 1, 0.02, 40), new T.MeshStandardMaterial({ color: '#b7c2ad', roughness: 1 }));
    disc.receiveShadow = true; disc.name = 'ground'; s.add(disc); s.userData.ground = disc;
  }
  return s;
}
function label(text, x, y) { const d = document.createElement('div'); d.className = 'lbl'; d.textContent = text; d.style.left = x + 'px'; d.style.top = y + 'px'; wrap.appendChild(d); }

// Frame one object in a cell: yaw (deg) turntable, elevation, ground disc under it, shadow camera fitted.
const camera = new T.PerspectiveCamera(30, 1, 0.02, 200);
function shootCell(scene, obj, x, y, w, h, yaw, elev = 24) {
  const holder = new T.Group(); holder.add(obj); scene.add(holder);
  obj.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(obj), sph = box.getBoundingSphere(new T.Sphere());
  holder.rotation.y = yaw * Math.PI / 180;
  const R = sph.radius, c = sph.center;
  const g = scene.userData.ground;
  if (g) { g.scale.set(R * 1.15, 1, R * 1.15); g.position.set(c.x, box.min.y - 0.011, c.z); }
  const sun = scene.userData.sun;
  sun.position.set(c.x - 15, c.y + 28, c.z + 12).normalize().multiplyScalar(R * 4).add(c); sun.target.position.copy(c);
  Object.assign(sun.shadow.camera, { left: -R * 1.4, right: R * 1.4, top: R * 1.4, bottom: -R * 1.4, near: 0.1, far: R * 10 });
  sun.shadow.camera.updateProjectionMatrix();
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const dist = R / Math.sin(camera.fov * Math.PI / 360) * 1.02, e = elev * Math.PI / 180;
  camera.position.set(c.x, c.y + Math.sin(e) * dist, c.z + Math.cos(e) * dist); camera.lookAt(c);
  const H = renderer.domElement.height;
  renderer.setViewport(x, H - y - h, w, h); renderer.setScissor(x, H - y - h, w, h);
  renderer.render(scene, camera);
  const info = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  scene.remove(holder);
  return info;
}

function geoStats(obj) {
  let tris = 0, meshes = 0; const mats = new Set();
  obj.traverse(o => { if (!o.isMesh) return; meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; for (const m of [].concat(o.material)) mats.add(m); });
  return { tris: Math.round(tris), meshes, materials: mats.size };
}
const disposeObj = o => o.traverse(c => { if (c.isMesh) c.geometry.dispose(); });

const stats = { view: VIEW, renderer: 'SwiftShader (relative timings only)' };
const finish = () => { window.__stats = stats; window.__ready = true; console.log(JSON.stringify(stats)); };

// ======================================================================= views
if (VIEW === 'grid' || VIEW === 'compare') {
  const CW = 260, CH = 260, LH = 0;
  const rows = VIEW === 'grid' ? [[30, 'new'], [150, 'new'], [270, 'new']] : [[35, 'current'], [35, 'new']];
  renderer.setSize(CW * 6, CH * rows.length + LH);
  const scene = stage();
  rows.forEach(([yaw, set], ri) => pageNames.forEach((n, ci) => {
    const obj = shade(set === 'new' ? fresh(n) : current(n));
    if (obj) { shootCell(scene, obj, ci * CW, ri * CH, CW, CH, yaw); const s = geoStats(obj); label(`${set === 'new' ? 'NEW' : 'cur'} ${n}  ${s.tris}t ${s.meshes}m${VIEW === 'grid' ? '  ' + yaw + '°' : ''}`, ci * CW + 4, ri * CH + 4); disposeObj(obj); }
  }));
  finish();
} else if (VIEW === 'stats') {
  renderer.setSize(256, 256);
  const scene = stage({ ground: false }), gl = renderer.getContext();
  stats.models = {};
  for (const n of NAMES) for (const set of ['current', 'new']) {
    const make = () => (set === 'new' ? fresh(n, 11) : current(n, 11));
    let o = make(); disposeObj(o);           // warm-up (material/texture creation)
    const t0 = performance.now(); const builds = 5;
    for (let i = 0; i < builds; i++) { o = make(); if (i < builds - 1) disposeObj(o); }
    const buildMs = (performance.now() - t0) / builds;
    shade(o);
    const g = geoStats(o);
    renderer.shadowMap.enabled = false; renderer.shadowMap.needsUpdate = true;
    const noShadow = shootCell(scene, o, 0, 0, 256, 256, 35);
    renderer.shadowMap.enabled = true;
    const withShadow = shootCell(scene, o, 0, 0, 256, 256, 35);
    // frame ms: 30 renders of this model alone (with shadows)
    const hold = new T.Group(); hold.rotation.y = 35 * Math.PI / 180; hold.add(o); scene.add(hold);
    renderer.render(scene, camera); gl.finish();
    const f0 = performance.now(); for (let i = 0; i < 30; i++) renderer.render(scene, camera); gl.finish();
    const frameMs = (performance.now() - f0) / 30; scene.remove(hold);
    stats.models[`${n}:${set}`] = { ...g, drawCalls: noShadow.calls, drawCallsWithShadow: withShadow.calls, renderTris: noShadow.triangles, buildMs: +buildMs.toFixed(2), frameMs: +frameMs.toFixed(2) };
    disposeObj(o);
  }
  stats.renderer_info = { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs.length };
  const pre = document.createElement('pre'); pre.textContent = JSON.stringify(stats, null, 1); wrap.appendChild(pre);
  finish();
} else if (VIEW === 'scene') {
  const W = 800, H = 620; renderer.setSize(W * 2, H);
  const gl = renderer.getContext();
  const tiles = []; for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) tiles.push([x, z]);
  const decor = [['sail', 0, 0], ['palm', -1, -1], ['lantern', 1, -1], ['crate', 1, 1], ['bench', -1, 1], ['net', 0, 1]];
  const items = [['plank', -2.8, 3.6, 0.3], ['barrel', 0.4, 4.4, 0], ['jug', 2.6, 3.4, 1.1], ['leaf', -0.9, 5.6, 2.0], ['scrap', 3.4, 5.4, 0.7], ['plank', 1.6, 6.2, 2.4], ['jug', -3.4, 5.6, 0.4]];
  function build(set) {
    const s = stage({ ground: false }); s.fog = new T.Fog('#cbd2c0', 25, 125);
    const sun = s.userData.sun; Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 80 }); sun.shadow.camera.updateProjectionMatrix();
    const water = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshStandardMaterial({ color: '#2f7f86', roughness: 0.35 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.05; water.receiveShadow = true; s.add(water);
    const raft = new T.Group(); s.add(raft);
    const t0 = performance.now();
    for (const [x, z] of tiles) { const g = set === 'new' ? LP.createFloor(T, x * 719 + z * 311) : createFloor(T, x * 719 + z * 311, mat); g.position.set(x * 2, 0, z * 2); raft.add(g); }
    for (const [n, x, z] of decor) { const g = set === 'new' ? LP.createCraft(T, n) : createCraft(T, n); g.position.set(x * 2, 0.22, z * 2); raft.add(g); }
    let id = 1;
    for (const [n, x, z, yaw] of items) {
      let g;
      const type = n === 'plank' ? 'wood' : n;
      if (n === 'jug') { g = new T.Group(); const jug = set === 'new' ? LP.createPlastic(T) : createPlastic(T); jug.rotation.set(Math.PI / 2, 0, 0.4 + (id % 5) * 0.5); jug.position.y = 0.05; jug.scale.setScalar(0.85); g.add(jug); }
      else g = set === 'new' ? LP.createDebris(T, type, null, { seed: id }) : createDebris(T, type, mat, { seed: id });
      g.position.set(x, 0.1, z); g.rotation.y = yaw; s.add(g); id++;
    }
    const buildMs = performance.now() - t0;
    shade(raft); s.traverse(o => { if (o.isMesh && !o.userData.glass && o !== water) { o.castShadow = true; o.receiveShadow = true; } });
    return { s, buildMs };
  }
  const cam = new T.PerspectiveCamera(50, W / H, 0.05, 300);
  cam.position.set(4.2, 4.6, 10.5); cam.lookAt(0, 0.8, 0.6);
  stats.scene = {};
  ['current', 'new'].forEach((set, i) => {
    const { s, buildMs } = build(set);
    renderer.setViewport(i * W, 0, W, H); renderer.setScissor(i * W, 0, W, H);
    renderer.render(s, cam);
    const info = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    let geos = 0, mats = new Set(); s.traverse(o => { if (o.isMesh) { geos++; for (const m of [].concat(o.material)) mats.add(m); } });
    const f0 = performance.now(); for (let k = 0; k < 20; k++) renderer.render(s, cam); gl.finish();
    stats.scene[set] = { buildMs: +buildMs.toFixed(1), drawCalls: info.calls, triangles: info.triangles, meshes: geos, materials: mats.size, frameMs: +((performance.now() - f0) / 20).toFixed(2), programs: renderer.info.programs.length, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries };
    const st = stats.scene[set];
    label(`${set.toUpperCase()}  calls ${st.drawCalls}  tris ${st.triangles}  meshes ${st.meshes}  mats ${st.materials}\nframe ${st.frameMs} ms  build ${st.buildMs} ms`, i * W + 8, 8);
  });
  finish();
} else if (VIEW === 'spin') {
  const CW = 220, CH = 240; renderer.setSize(CW * 6, CH * 2);
  const scene = stage();
  const objs = NAMES.map(n => shade(fresh(n)));
  NAMES.forEach((n, i) => label(n, (i % 6) * CW + 4, Math.floor(i / 6) * CH + 4));
  let yaw = 0;
  const loop = () => { yaw += 0.6; objs.forEach((o, i) => { const h = o.parent; if (h) h.remove(o); shootCell(scene, o, (i % 6) * CW, Math.floor(i / 6) * CH, CW, CH, yaw); }); requestAnimationFrame(loop); };
  loop(); finish();
}
