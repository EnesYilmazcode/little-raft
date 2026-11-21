import * as T from '../../dist/vendor/three.module.js';
import { createOcean } from '../../dist/ocean.js';

const q = new URLSearchParams(location.search);
const tier = q.get('tier') ?? 'a';
const view = q.get('view') ?? 'fp';
const amp = Number(q.get('amp') ?? 1);
const fixedT = q.has('t') ? Number(q.get('t')) : null;   // freeze time for screenshots
// src=shots/water-a0.js loads another copy of the water module (A/B against a saved version);
// prof=NO_X,NO_Y passes shader #defines (term knock-outs used by profile.py).
const { createWater } = await import(q.get('src') ? './' + q.get('src') : './water.js');
const profDefines = Object.fromEntries((q.get('prof') ?? '').split(',').filter(Boolean).map((k) => [k, '']));

document.querySelectorAll('[data-view],[data-amp]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  if (a.dataset.view) q.set('view', a.dataset.view);
  if (a.dataset.amp) q.set('amp', a.dataset.amp);
  q.set('tier', tier);
  location.search = q.toString();
}));
document.querySelectorAll('a[href^="?tier"]').forEach((a) => {
  const n = new URLSearchParams(q); n.set('tier', new URLSearchParams(a.getAttribute('href')).get('tier')); a.href = '?' + n;
});

const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const HORIZON = '#cbd2c0', ZENITH = '#9ebabb';
const scene = new T.Scene();
scene.background = new T.Color(HORIZON);
scene.fog = new T.Fog(HORIZON, 25, 125);
const camera = new T.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200);

// Minimal sky dome so the planar reflection has something to show.
const skyMat = new T.ShaderMaterial({
  side: T.BackSide, depthWrite: false, fog: false,
  uniforms: { uH: { value: new T.Color(HORIZON) }, uZ: { value: new T.Color(ZENITH) }, uS: { value: new T.Vector3(-15, 28, 12).normalize() } },
  vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform vec3 uH; uniform vec3 uZ; uniform vec3 uS; varying vec3 vD;
    void main(){ vec3 d = normalize(vD); vec3 c = mix(uH, uZ, smoothstep(0.0, 0.5, d.y));
      float s = max(dot(d, normalize(uS)), 0.0); c += vec3(1.0,.95,.8) * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * .15);
      gl_FragColor = vec4(c, 1.0); }`,
});
const sky = new T.Mesh(new T.SphereGeometry(150, 32, 16), skyMat);
sky.renderOrder = -1;
scene.add(sky);

const sun = new T.DirectionalLight('#fff0d0', 2.4);
sun.position.set(-15, 28, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
scene.add(sun, new T.HemisphereLight('#dfe8e4', '#2a4a48', 1.1));

// tier 'cur' = the shipping dist/ocean.js with the exact uniform overrides from dist/game.js init(), for A/B shots.
let water;
if (tier === 'cur') {
  const o = createOcean(T, { sunDirection: sun.position.clone(), skyColor: HORIZON, fadeNear: 28, fadeFar: 125 });
  o.uniforms.uDeep.value.set('#14505a'); o.uniforms.uShallow.value.set('#3f8c88'); o.uniforms.uZenith.value.set('#a9c1c0');
  o.mesh.receiveShadow = true;
  water = Object.assign(o, { setRaft() {}, setFloaters() {}, setBobber() {}, render: (r, s, c) => { r.setRenderTarget(null); r.render(s, c); } });
} else {
  water = createWater(T, { tier, amp, defines: profDefines, debug: Number(q.get('debug') ?? 0), sunDirection: sun.position, skyColor: HORIZON, zenithColor: ZENITH });
}
scene.add(water.mesh);

// 3x2 raft of 2 m tiles plus a few half-sunk barrels and planks.
const TILES = [[-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1], [0, -1]];
water.setRaft(TILES);
const raft = new T.Group();
const plankMat = new T.MeshStandardMaterial({ color: '#9a7350', roughness: .9 });
const darkMat = new T.MeshStandardMaterial({ color: '#5e4430', roughness: .95 });
for (const [x, z] of TILES) {
  for (let i = 0; i < 4; i++) {
    const p = new T.Mesh(new T.BoxGeometry(0.47, 0.14, 1.96), i % 2 ? plankMat : darkMat);
    p.position.set(x * 2 - 0.75 + i * 0.5, 0, z * 2);
    p.castShadow = p.receiveShadow = true;
    raft.add(p);
  }
  const beam = new T.Mesh(new T.BoxGeometry(1.96, 0.18, 0.18), darkMat);
  beam.position.set(x * 2, -0.14, z * 2 - 0.7);
  raft.add(beam);
}
scene.add(raft);

const floaters = [
  { x: 4.6, z: -3.2, yaw: 0.5, kind: 'barrel' },
  { x: -3.8, z: -5.5, yaw: -0.9, kind: 'barrel' },
  { x: 1.2, z: -6.5, yaw: 0.4, kind: 'plank' },
  { x: -6, z: 1.5, yaw: 1.2, kind: 'plank' },
];
const barrelMat = new T.MeshStandardMaterial({ color: '#7b5a3a', roughness: .8 });
for (const f of floaters) {
  f.mesh = f.kind === 'barrel'
    ? new T.Mesh(new T.CylinderGeometry(0.33, 0.33, 0.9, 16), barrelMat)
    : new T.Mesh(new T.BoxGeometry(1.0, 0.08, 0.3), plankMat);
  if (f.kind === 'barrel') f.mesh.rotation.set(Math.PI / 2, 0, f.yaw); else f.mesh.rotation.set(0, f.yaw, 0);
  f.mesh.castShadow = true;
  scene.add(f.mesh);
}
// Hook bobber sitting on the water in front of the deck (fp view).
const bobber = new T.Mesh(new T.SphereGeometry(0.07, 12, 8), new T.MeshStandardMaterial({ color: '#c8402c', roughness: .6 }));
bobber.castShadow = true;
scene.add(bobber);
const BOB = { x: 2.6, z: -6.2 };

const views = {
  fp: { pos: [0.4, 1.55, -1.6], look: [2.2, -0.4, -12] },
  over: { pos: [9, 6.5, -9], look: [0, -0.3, 0] },
  sun: { pos: [-1.4, 1.55, 1.2], look: [-14, -4, 12] },
  low: { pos: [7.5, 0.55, -6.5], look: [0, 0.2, 0] },   // swimmer eye level, best for reflections
};
const v = views[view] ?? views.fp;

const stats = document.getElementById('stats');
let frames = 0, acc = 0, last = performance.now(), msAvg = 0;
const t0 = performance.now();
function frame(now) {
  const t = fixedT ?? (now - t0) / 1000;
  water.update(t, camera);
  const s = water.getSlope(0, 0, t, 2.2);
  raft.position.set(0, water.getHeight(0, 0) + 0.2, 0);
  raft.rotation.set(s.z * 0.6, 0, -s.x * 0.6);
  for (const f of floaters) {
    const y = water.getHeight(f.x, f.z);
    f.mesh.position.set(f.x, y + (f.kind === 'barrel' ? 0.05 : 0.0), f.z);
  }
  if (water.footprint) water.setFloaters(floaters.map((f) => water.footprint(f.mesh).slice()));
  else water.setFloaters(floaters.map((f) => [f.x, f.z, 0.35]));
  bobber.position.set(BOB.x, water.getHeight(BOB.x, BOB.z) + 0.02, BOB.z);
  water.setBobber?.(bobber.position);
  if (fixedT !== null && water.uniforms.uBobber) water.uniforms.uBobber.value.w = fixedT - 0.5;   // frozen shot: landed 0.5 s ago
  camera.position.set(v.pos[0], v.pos[1] + raft.position.y, v.pos[2]);
  camera.lookAt(...v.look);
  sky.position.copy(camera.position);
  water.render(renderer, scene, camera);
  const dt = now - last; last = now; acc += dt; frames++;
  if (acc > 500) { msAvg = acc / frames; acc = 0; frames = 0; }
  stats.innerHTML = `<b>${tier.toUpperCase()}</b> ${msAvg.toFixed(1)} ms/frame, ${renderer.info.render.calls} calls (last pass), amp ${amp}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});

// Probe for headless checks.
window.lab = {
  tier,
  ready: true,
  // Average / worst frame over 60 frames, plus renderer.info for the final (visible) pass and all passes of one frame.
  probe: (frames = 60) => new Promise((r) => {
    let n = 0, worst = 0; const s = performance.now(); let prev = s;
    const f = (now) => {
      worst = Math.max(worst, now - prev); prev = now;
      if (++n < frames) return requestAnimationFrame(f);
      renderer.info.autoReset = false; renderer.info.reset();
      requestAnimationFrame(() => {
        const i = renderer.info; renderer.info.autoReset = true;
        r({ avg: (performance.now() - s) / (n + 1), worst, calls: i.render.calls, triangles: i.render.triangles,
          geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs.length });
      });
    };
    requestAnimationFrame(f);
  }),
};
