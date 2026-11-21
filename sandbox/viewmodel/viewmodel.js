// Viewmodel rendering sandbox: four ways to draw first-person hands, side by side via ?mode=.
//   naive   hands parented to the world camera, nothing special (clips into walls, inherits world FOV)
//   marker  what dist/game.js does today: depth-clear marker mesh + renderOrder 1000 in one scene
//   twopass separate viewmodel scene + camera, renderer.clearDepth() between two render() calls
//   shader  single pass: hands shrunk toward the eye + own-FOV projection + depth squash in the vertex shader
// Other params: fov (world FOV, default 95), vmfov (default 62), wall=0|1, shade=0|1, still=1 (no motion).
import * as T from '../../dist/vendor/three.module.js';
import { createHands } from '../../dist/hands.js';
import { createHook } from '../../dist/hook.js';

const P = new URLSearchParams(location.search);
const MODE = P.get('mode') || 'shader';
const WORLD_FOV = +(P.get('fov') || 95), VM_FOV = +(P.get('vmfov') || 62);
const WALL = P.get('wall') !== '0', SHADE = P.get('shade') === '1', STILL = P.get('still') === '1';
const SHRINK = 0.3;      // shader mode: viewmodel scale about the eye (image is unchanged, depth shrinks)
const DEPTH_SQUASH = 0.02; // shader mode: viewmodel uses the front 2% of the NDC depth range

// ---------- springs: fixed-step damped springs, so sway/bob/recoil are frame-rate independent ----------
export class Spring3 {
  constructor(stiffness = 120, damping = 14) { this.k = stiffness; this.c = damping; this.x = new T.Vector3(); this.v = new T.Vector3(); this.target = new T.Vector3(); this.acc = 0; }
  impulse(v) { this.v.add(v); return this; }
  update(dt) {
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= 1 / 120) { // semi-implicit Euler at 120 Hz
      const h = 1 / 120; this.acc -= h;
      this.v.x += (this.k * (this.target.x - this.x.x) - this.c * this.v.x) * h;
      this.v.y += (this.k * (this.target.y - this.x.y) - this.c * this.v.y) * h;
      this.v.z += (this.k * (this.target.z - this.x.z) - this.c * this.v.z) * h;
      this.x.addScaledVector(this.v, h);
    }
    return this.x;
  }
}

// ---------- renderer + world ----------
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7)); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new T.Scene(); scene.background = new T.Color('#cbd2c0'); scene.fog = new T.Fog('#cbd2c0', 25, 125);
const camera = new T.PerspectiveCamera(WORLD_FOV, innerWidth / innerHeight, 0.05, 200); camera.rotation.order = 'YXZ';
camera.position.set(0, 1.6, 0); scene.add(camera);
const hemi = new T.HemisphereLight('#f2ead4', '#3d6b6a', 1.8); scene.add(hemi);
const sun = new T.DirectionalLight('#fff0c7', 2.5); sun.position.set(-15, 28, 12); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 }); sun.shadow.bias = -0.001;
scene.add(sun, sun.target);
const std = (color, r = 0.85) => new T.MeshStandardMaterial({ color, roughness: r });
const floor = new T.Mesh(new T.BoxGeometry(12, 0.2, 12), std('#a07a52')); floor.position.y = -0.1; floor.receiveShadow = true; scene.add(floor);
const occluders = [];
if (WALL) { // a plank wall 0.32 m in front of the eye: closer than the hands reach
  const wall = new T.Mesh(new T.BoxGeometry(4, 3, 0.12), std('#7d5b3a')); wall.position.set(0, 1.5, -0.38); wall.castShadow = wall.receiveShadow = true; scene.add(wall); occluders.push(wall);
  for (let i = -3; i <= 3; i++) { const s = new T.Mesh(new T.BoxGeometry(0.03, 3, 0.02), std('#5a3f27')); s.position.set(i * 0.55, 1.5, -0.31); scene.add(s); }
}
if (SHADE) { // overhead sail between the player and the sun, so the eye is in shadow
  const dir = sun.position.clone().normalize();
  const sail = new T.Mesh(new T.BoxGeometry(3, 0.05, 3), std('#fff3cf', 1)); sail.position.copy(camera.position).addScaledVector(dir, 2.6); sail.castShadow = true; scene.add(sail); occluders.push(sail);
}
for (let i = 0; i < 8; i++) { const c = new T.Mesh(new T.BoxGeometry(0.6, 0.6, 0.6), std(i % 2 ? '#4f9b72' : '#e6d7a3')); c.position.set(Math.sin(i) * 4, 0.3, -2 - i * 0.7); c.castShadow = c.receiveShadow = true; scene.add(c); }

// ---------- viewmodel ----------
const hands = createHands(T, createHook(T));
const rig = new T.Group(); rig.add(hands.group); // springs move `rig`; hands.js poses arms inside it
const meshes = []; hands.group.traverse(c => { if (c.isMesh) meshes.push(c); });
for (const m of meshes) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; }

let vmScene = null, vmCam = null, vmSun = null, vmHemi = null, vmProjCam = null, shadeProbe = 1;
const ray = new T.Raycaster(), tmp = new T.Vector3(), q = new T.Quaternion();

if (MODE === 'naive') camera.add(rig);
if (MODE === 'marker') { // the current game: clear depth from a camera-owned marker, then draw hands in the transparent queue
  const marker = new T.Mesh(new T.PlaneGeometry(1e-4, 1e-4), new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, transparent: true }));
  marker.frustumCulled = false; marker.renderOrder = 999; marker.position.z = -0.1;
  marker.onBeforeRender = (r, _s, cam) => { if (cam !== camera) return; r.state.buffers.depth.setMask(true); r.clearDepth(); };
  camera.add(marker);
  for (const m of meshes) { m.renderOrder = 1000; for (const mt of [].concat(m.material)) { mt.transparent = true; mt.needsUpdate = true; } }
  camera.add(rig);
}
if (MODE === 'twopass') { // own scene, own camera, own lights mirrored from the world each frame
  vmScene = new T.Scene(); vmCam = new T.PerspectiveCamera(VM_FOV, innerWidth / innerHeight, 0.01, 10);
  vmHemi = new T.HemisphereLight(); vmSun = new T.DirectionalLight(); vmScene.add(vmHemi, vmSun, vmSun.target, rig);
  renderer.autoClear = false;
}
if (MODE === 'shader') { // one pass: hands live in the world scene but project with their own matrix
  vmProjCam = new T.PerspectiveCamera(VM_FOV, innerWidth / innerHeight, 0.01, 200);
  const uniforms = { vmProj: { value: vmProjCam.projectionMatrix }, vmDepth: { value: DEPTH_SQUASH } };
  for (const m of meshes) {
    m.receiveShadow = true; // real world position (shrunk toward the eye) -> real sun shadows on the hands
    for (const mt of [].concat(m.material)) {
      mt.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, uniforms);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform mat4 vmProj;\nuniform float vmDepth;')
          .replace('#include <project_vertex>', '#include <project_vertex>\n\tgl_Position = vmProj * mvPosition;\n\tgl_Position.z = mix(-gl_Position.w, gl_Position.z, vmDepth);');
      };
      mt.customProgramCacheKey = () => 'viewmodel';
      mt.needsUpdate = true;
    }
  }
  rig.scale.setScalar(SHRINK); // perspective is scale-invariant about the eye: same picture, 0.3x the depth
  camera.add(rig);
}

// ---------- loop ----------
const sway = new Spring3(90, 12), bobS = new Spring3(160, 18), recoil = new Spring3(220, 16);
let t = 0, last = performance.now(), yaw = 0, pitch = -0.05, prevYaw = 0, prevPitch = pitch, nextShot = 1.0, walkPhase = 0;
const frameMs = []; let frames = 0;
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  for (const c of [camera, vmCam, vmProjCam]) if (c) { c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); }
}
addEventListener('resize', resize);

function frame() {
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
  // scripted look + walk so the headless run exercises the springs
  if (!STILL) { yaw = Math.sin(t * 0.9) * 0.35; pitch = -0.05 + Math.sin(t * 1.3) * 0.08; walkPhase += dt * 9; }
  camera.rotation.set(pitch, yaw, 0);
  const dYaw = (yaw - prevYaw) / Math.max(dt, 1e-3), dPitch = (pitch - prevPitch) / Math.max(dt, 1e-3); prevYaw = yaw; prevPitch = pitch;
  sway.target.set(-dYaw * 0.012, dPitch * 0.012, 0);                     // hands lag behind the look
  bobS.target.set(Math.sin(walkPhase * 0.5) * 0.012, -Math.abs(Math.sin(walkPhase * 0.5)) * 0.016, 0); // figure-eight bob
  if (!STILL && t > nextShot) { recoil.impulse(tmp.set(0, 0.6, 1.6)); nextShot = t + 1.4; } // swing/throw kick
  const s = sway.update(dt), b = bobS.update(dt), r = recoil.update(dt);
  rig.position.set(s.x + b.x, s.y + b.y + r.y * 0.02, r.z * 0.04).multiplyScalar(rig.scale.x);
  rig.rotation.set(s.y * 2 + r.y * 0.08, s.x * 2, -s.x * 1.5);
  hands.update({ dt, time: t, walking: !STILL, motion: 1 });

  renderer.info.reset(); const t0 = performance.now();
  if (MODE === 'twopass') {
    // light matching: same colors/intensities, sun direction rotated into camera space, cheap shadow probe
    vmHemi.color.copy(hemi.color); vmHemi.groundColor.copy(hemi.groundColor); vmHemi.intensity = hemi.intensity;
    camera.getWorldQuaternion(q).invert();
    vmSun.position.copy(sun.position).sub(sun.target.position).normalize().applyQuaternion(q); vmSun.target.position.set(0, 0, 0);
    vmSun.color.copy(sun.color);
    if ((frames & 7) === 0) { // every 8th frame: is the eye in the sun's shadow?
      camera.getWorldPosition(tmp); ray.set(tmp, sun.position.clone().normalize()); ray.far = 60;
      shadeProbe = ray.intersectObjects(occluders, false).length ? 0.25 : 1;
    }
    vmSun.intensity += (sun.intensity * shadeProbe - vmSun.intensity) * Math.min(1, dt * 8);
    renderer.clear(); renderer.render(scene, camera); renderer.clearDepth(); renderer.render(vmScene, vmCam);
  } else {
    renderer.render(scene, camera);
  }
  frameMs.push(performance.now() - t0); if (frameMs.length > 120) frameMs.shift();
  frames++;
  window.vmDebug = { mode: MODE, frames, cpuMs: frameMs.reduce((a, b) => a + b, 0) / frameMs.length, calls: renderer.info.render.calls, programs: renderer.info.programs.length };
  requestAnimationFrame(frame);
}
renderer.info.autoReset = false; // count both passes of twopass
document.getElementById('hud').innerHTML = `<b>${MODE}</b> world FOV ${WORLD_FOV}, viewmodel FOV ${MODE === 'twopass' || MODE === 'shader' ? VM_FOV : WORLD_FOV + ' (inherited)'}<br>wall ${WALL ? 'on' : 'off'}, shade ${SHADE ? 'on' : 'off'}. Modes: naive, marker, twopass, shader`;
requestAnimationFrame(frame);
