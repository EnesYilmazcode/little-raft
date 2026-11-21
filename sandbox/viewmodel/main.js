// Viewmodel lab: the game's real first-person hands (dist/hands.js single controller, held models from held-items.js
// and models.js) on a raft deck, rendered through ./viewmodel.js (proposed dist/viewmodel.js) or through the game's
// current depth-clear marker for comparison.
// URL params:
//   mode=vm|legacy|naive   vm = proposed layer + ./hands.js (default), legacy = dist/game.js today, naive = plain camera child
//   scene=idle|walk|charge|throw|swap|use|look|wall|shade|rod|hammer|rope|reselect|pickup|crate   scripted state (see SCENES)
//   fov=75 (world FOV, the game's options.fov), vmfov=70, motion=.35 (options.cameraMotion), t=<seconds> freeze time
//   auto=0 do not run requestAnimationFrame (shoot.py drives the clock through window.vmLab)
import * as T from '../../dist/vendor/three.module.js';
import { createOcean } from '../../dist/ocean.js';
import { createFloor } from '../../dist/deck.js';
import { createViewmodel } from './viewmodel.js';
import { getModel } from '../../dist/models.js';

const P = new URLSearchParams(location.search);
const MODE = P.get('mode') || 'vm', SCENE = P.get('scene') || 'idle';
const WORLD_FOV = +(P.get('fov') || 75), VM_FOV = +(P.get('vmfov') || 70), MOTION = +(P.get('motion') ?? 0.35);
const AUTO = P.get('auto') !== '0', FREEZE = P.has('t') ? +P.get('t') : null;
const CHARGE_MS = 900;
// vm mode uses the proposed hands.js (prepare hook, hammer strike, long sleeve, re-select fix); legacy/naive use dist/hands.js
const { createHands, isPlaceable } = await import(MODE === 'vm' ? './hands.js' : '../../dist/hands.js');
const modelOf = (k) => { try { return getModel(k); } catch { return null; } };   // same factory as dist/game.js

// ---------- renderer + world, same settings as dist/game.js init() ----------
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7)); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);

const scene = new T.Scene(); scene.background = new T.Color('#cbd2c0'); scene.fog = new T.Fog('#cbd2c0', 25, 125);
const camera = new T.PerspectiveCamera(WORLD_FOV, innerWidth / innerHeight, 0.05, 200); camera.rotation.order = 'YXZ'; scene.add(camera);
scene.add(new T.HemisphereLight('#f2ead4', '#3d6b6a', 1.8));
const sun = new T.DirectionalLight('#fff0c7', 2.5); sun.position.set(-15, 28, 12); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25 }); sun.shadow.bias = -0.001;
scene.add(sun);
const ocean = createOcean(T, { sunDirection: sun.position.clone(), skyColor: '#cbd2c0', fadeNear: 28, fadeFar: 125 });
ocean.uniforms.uDeep.value.set('#14505a'); ocean.uniforms.uShallow.value.set('#3f8c88'); ocean.uniforms.uZenith.value.set('#a9c1c0');
ocean.mesh.receiveShadow = true; if (P.get('ocean') !== '0') scene.add(ocean.mesh); // ocean=0: isolate viewmodel cost
const matCache = new Map();
const mat = (c) => { if (!matCache.has(c)) matCache.set(c, new T.MeshStandardMaterial({ color: c, roughness: 0.85 })); return matCache.get(c); };
const raft = new T.Group(); scene.add(raft);
for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) { const g = createFloor(T, x * 719 + z * 311, mat); g.position.set(x * 2, 0, z * 2); g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; }); raft.add(g); }
for (let i = 0; i < 6; i++) { const g = new T.Group(), a = i * 2.4 + 2.2, d = 60 + i * 6; g.position.set(Math.sin(a) * d, -0.1, Math.cos(a) * d);
  const isl = new T.Mesh(new T.CylinderGeometry(3, 5, 0.8, 16), mat('#e6d7a3')); g.add(isl);
  const top = new T.Mesh(new T.SphereGeometry(3.4, 16, 10), mat('#4f9b72')); top.position.y = 1.4; g.add(top); scene.add(g); }
const crate = new T.Mesh(new T.BoxGeometry(0.7, 0.6, 0.7), mat('#8c6a44')); crate.position.set(1.3, 0.5, -2.4); crate.castShadow = crate.receiveShadow = true; scene.add(crate);

const EYE = new T.Vector3(0, 0.2 + 1.6, 0.6);
if (SCENE === 'wall') { // plank wall + post 0.12 m in front of the eye: closer than any hand or tool tip
  const wall = new T.Mesh(new T.BoxGeometry(3, 2.4, 0.1), mat('#7d5b3a')); wall.position.set(0, 1.4, EYE.z - 0.17); wall.castShadow = wall.receiveShadow = true; scene.add(wall);
  for (let i = -4; i <= 4; i++) { const s = new T.Mesh(new T.BoxGeometry(0.035, 2.4, 0.02), mat('#5a3f27')); s.position.set(i * 0.3, 1.4, EYE.z - 0.11); scene.add(s); }
}
if (SCENE === 'shade') { // sail between the eye and the sun: the hands should fall into its shadow like the deck does
  const dir = sun.position.clone().normalize();
  const sail = new T.Mesh(new T.BoxGeometry(2.6, 0.04, 2.6), new T.MeshStandardMaterial({ color: '#fff3cf', roughness: 1 }));
  sail.position.copy(EYE).addScaledVector(dir, 1.5); sail.castShadow = true; sail.receiveShadow = true; scene.add(sail);
}

// ---------- viewmodels, built exactly like dist/game.js buildViewmodels() (today, or with the ADOPT edits) ----------
let vm = null, hands;
if (MODE === 'vm') {
  vm = createViewmodel(T, { camera, fov: VM_FOV });
  if (P.get('fill') === '0') vm.setFill(0, 0);
  hands = createHands(T, { modelFactory: modelOf, prepare: vm.prepare }); hands.preload(['hook']);
  vm.attach(hands);
} else {
  hands = createHands(T, { modelFactory: modelOf }); hands.preload(['hook']);
  if (MODE === 'legacy') { // verbatim from dist/game.js buildViewmodels()
    const depthClear = new T.Mesh(new T.PlaneGeometry(1e-4, 1e-4), new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, transparent: true }));
    depthClear.frustumCulled = false; depthClear.renderOrder = 999; depthClear.position.set(0, 0, -0.1);
    depthClear.onBeforeRender = (r, _s, cam) => { if (cam !== camera) return; r.state?.buffers?.depth?.setMask?.(true); r.clearDepth(); };
    camera.add(depthClear);
  }
  camera.add(hands.group);
}
// a world crate built from the same models.js factory: its shared materials must stay untouched by the vm patch
const worldCrate = getModel('crate'); if (worldCrate) { worldCrate.position.set(-1.2, 0.2, -1.6); scene.add(worldCrate); }
// world rope from the hand, like dist/game.js setRope(): shows whether the rope start lines up with the fist
const ropeGeo = new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]);
const rope = new T.Line(ropeGeo, new T.LineBasicMaterial({ color: '#e9d39a' })); rope.frustumCulled = false; rope.visible = false; scene.add(rope);

// ---------- scripted scenes: fn(t) -> game-side state for that instant ----------
const SCENES = {
  idle: () => ({ kind: 'hook' }),
  walk: (t) => ({ kind: 'hook', walking: true, yaw: Math.sin(t * 0.8) * 0.12 }),
  charge: (t) => ({ kind: 'hook', charge: t > 0.5 ? Math.min(1, (t - 0.5) * 1000 / CHARGE_MS) : 0 }),
  use: (t) => ({ kind: 'hammer', swing: t > 1 ? Math.max(0, 1 - (t - 1) * 3) : 0 }),          // build: swing = 1
  pickup: (t) => ({ kind: 'hammer', swing: t > 1 ? Math.max(0, 0.6 - (t - 1) * 3) : 0 }),     // pickup tap: swing = .6
  throw: (t) => ({ kind: 'hook', charge: t > 0.5 && t < 1.5 ? Math.min(1, (t - 0.5) * 1000 / CHARGE_MS) : 0, swing: t > 1.5 ? Math.max(0, 1 - (t - 1.5) * 3) : 0 }),
  swap: (t) => ({ kind: t < 1 ? 'hook' : t < 2.2 ? 'hammer' : 'fishingrod' }),
  reselect: (t) => ({ kind: t > 1 && t < 1.07 ? 'hammer' : 'hook' }),                          // back to the hook mid-lower
  look: (t) => ({ kind: 'hook', yaw: t < 1 ? 0 : Math.min(1, (t - 1) / 0.35) * 0.9 }),
  wall: () => ({ kind: 'hook' }),
  shade: () => ({ kind: 'hook' }),
  rod: () => ({ kind: 'fishingrod' }),
  hammer: () => ({ kind: 'hammer' }),
  crate: () => ({ kind: 'crate' }),
  rope: () => ({ kind: 'hook', hookOut: true }),
};
const script = SCENES[SCENE] || SCENES.idle;
let t = 0, walkPhase = 0, lastState = {};
const handPos = new T.Vector3(), ropeEnd = new T.Vector3();
const frameMs = [], updMs = [], px = new Uint8Array(4); let SYNC = false;

// same order as dist/game.js updateCamera()
function step(dt) {
  t += dt;
  const s = { yaw: 0, pitch: -0.12, walking: false, charge: 0, swing: 0, hookOut: false, ...script(t % 4) }; lastState = s;
  if (s.walking) walkPhase += dt * 9;
  ocean.update(t);
  const bob = s.walking ? Math.sin(walkPhase) * 0.025 * MOTION : 0;   // same camera bob as game.js updateCamera()
  camera.position.set(EYE.x, EYE.y + bob, EYE.z); camera.rotation.set(s.pitch, s.yaw, 0);
  const u0 = performance.now();
  hands.setHeld(s.kind);
  hands.setPose(isPlaceable(s.kind) ? 'point' : null);
  hands.update({ dt, time: t, charge: s.charge, casting: s.swing, walking: s.walking, hasHookOut: s.hookOut, motion: MOTION, yaw: s.yaw, pitch: s.pitch });
  vm?.update({ dt, held: hands.state.held, grounded: true, charge: s.charge, swing: s.swing, motion: MOTION });
  camera.updateMatrixWorld(true);
  if (vm) vm.anchor(hands.ropeAnchor(), handPos); else hands.ropeAnchor().getWorldPosition(handPos);
  if (s.hookOut) { ropeEnd.set(3, -0.2, -9); ropeGeo.setFromPoints([handPos, ropeEnd]); rope.visible = true; }
  updMs.push(performance.now() - u0);
}
function render() {
  renderer.info.reset(); const r0 = performance.now();
  renderer.render(scene, camera);
  if (SYNC) renderer.getContext().readPixels(0, 0, 1, 1, 0x1908, 0x1401, px); // wait for the GPU (SwiftShader) so the timing is the whole frame
  frameMs.push(performance.now() - r0);
}
function worldMatsPatched() { // true would mean the vm patch leaked into a material the world also uses
  let bad = false; worldCrate?.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (String(m.customProgramCacheKey?.()).startsWith('vm|')) bad = true; }); return bad;
}
function info() {
  const i = renderer.info, avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const v = hands.state;
  return { mode: MODE, scene: SCENE, t: +t.toFixed(3), held: v.held, dip: +v.dip.toFixed(3), throw: +v.throw.toFixed(3), strike: v.strike === undefined ? null : +v.strike.toFixed(3),
    hand: handPos.toArray().map((x) => +x.toFixed(3)), worldMatPatched: worldMatsPatched(),
    renderAvgMs: +avg(frameMs).toFixed(2), renderWorstMs: +Math.max(0, ...frameMs).toFixed(2), updateAvgMs: +avg(updMs).toFixed(3),
    calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs.length };
}
window.vmLab = {
  advance(seconds, dt = 1 / 60) { const n = Math.round(seconds / dt); for (let i = 0; i < n; i++) step(dt); render(); return info(); },
  // CPU: renderer.render() submit time, no GPU wait (what three.js + the viewmodel cost on the main thread).
  // synced: same plus a 1-pixel readPixels, so it includes SwiftShader raster time (relative only).
  // vmUpdateUs: vm.update() alone, 2000 calls (pure JS: land/kick springs, charge brace).
  bench(frames = 120, dt = 1 / 60) {
    const run = (sync) => { SYNC = sync; frameMs.length = 0; updMs.length = 0; for (let i = 0; i < frames; i++) { step(dt); render(); } SYNC = false; return info(); };
    const cpu = run(false), synced = run(true);
    let vmUpdateUs = null;
    if (vm) { const n = 2000, t0 = performance.now(); for (let i = 0; i < n; i++) vm.update({ dt, held: 'hook', grounded: i % 90 > 10, vy: -2, charge: (i % 120) / 120, swing: i % 60 === 0 ? 1 : 0, motion: MOTION }); vmUpdateUs = +((performance.now() - t0) / n * 1000).toFixed(2); }
    return { ...synced, cpuRenderAvgMs: cpu.renderAvgMs, cpuRenderWorstMs: cpu.renderWorstMs, syncedRenderAvgMs: synced.renderAvgMs, syncedRenderWorstMs: synced.renderWorstMs, stepAvgMs: cpu.updateAvgMs, vmUpdateUs };
  },
  info,
};
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); vm?.setAspect(camera.aspect); });
if (P.get('hud') === '0') document.body.classList.add('nohud');
document.getElementById('hud').textContent = `${MODE} / ${SCENE}  world FOV ${WORLD_FOV}  viewmodel FOV ${vm ? VM_FOV : WORLD_FOV + ' (inherited)'}`;
if (FREEZE !== null) window.vmLab.advance(FREEZE);
else if (AUTO) { let last = performance.now(); const loop = () => { const now = performance.now(); step(Math.min(0.05, (now - last) / 1000)); last = now; render(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
window.vmReady = true;
