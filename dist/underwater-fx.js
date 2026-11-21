// Underwater look for Little Raft: depth-tinted fog, surface-from-below ceiling,
// one fullscreen overlay (tint, vignette, light shafts) and rising bubbles.
// THREE r170 is passed in as T (never imported). No render targets, no passes.
// Usage:
//   import { createUnderwaterFx } from './underwater-fx.js?build=v3-survival-ae77fa84ac2b';
//   const fx = createUnderwaterFx(T, { scene, camera, ocean, seafloor });
//   // each frame, after the camera moved:
//   fx.update(dt, { underwater, depth, time, lowOxygen, breath01 });
//   renderer.render(scene, camera); fx.render(renderer);   // overlay on top
//   fx.dispose();
// Above water everything is hidden, render() returns at once, no per-frame allocations.

const SHALLOW = '#2b8a8f', DEEP = '#0f4450';
const FOG_NEAR = 0.5, FOG_FAR = 34, DEEP_AT = 10;
const MAX_BUBBLES = 120, FADE_IN = 0.25;

const CEIL_VS = `varying vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const CEIL_FS = `uniform float uTime; uniform vec3 uFog; uniform vec3 uTint; uniform float uFar;
varying vec3 vW;
void main(){
  vec3 d = vW - cameraPosition; float dist = length(d); float up = d.y / max(dist, 1e-3);
  vec2 p = vW.xz; float t = uTime;
  float r = sin(p.x * 1.3 + t * 1.1) + sin(p.y * 1.7 - t * 0.9) + sin((p.x + p.y) * 0.8 + t * 1.6)
          + 0.5 * sin(p.x * 3.7 - p.y * 2.9 + t * 2.3);
  r = r * 0.125 + 0.5;
  float snell = smoothstep(0.6, 0.75, up);
  vec3 outside = uTint * (0.9 + 0.5 * r);
  vec3 inside = mix(vec3(0.45, 0.85, 0.9), vec3(0.95, 1.0, 0.95), r * r);
  vec3 col = mix(outside, inside * 1.6, snell);
  col = mix(col, uFog, smoothstep(uFar * 0.25, uFar, dist));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const OV_VS = `varying vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const OV_FS = `uniform float uTime, uAlpha, uDeep, uLow; varying vec2 vUv;
void main(){
  vec3 top = mix(vec3(0.36, 0.78, 0.78), vec3(0.16, 0.45, 0.5), uDeep);
  vec3 bot = mix(vec3(0.06, 0.32, 0.38), vec3(0.02, 0.13, 0.18), uDeep);
  vec3 col = mix(bot, top, vUv.y);
  vec2 c = vUv - 0.5; float vig = smoothstep(0.35, 0.85, length(c * vec2(1.15, 1.0)));
  float x = vUv.x + (1.0 - vUv.y) * 0.35;
  float s = sin(x * 9.0 + uTime * 0.35) * sin(x * 23.0 - uTime * 0.6) * sin(x * 4.0 + uTime * 0.21);
  float shafts = max(s, 0.0) * smoothstep(0.15, 1.0, vUv.y) * (1.0 - uDeep * 0.7);
  float a = 0.16 + vig * (0.45 + 0.12 * uLow);
  col = mix(col, vec3(0.02, 0.1, 0.13), vig * 0.7) + vec3(0.6, 0.95, 0.9) * shafts * 0.5;
  a = clamp(a + shafts * 0.12, 0.0, 1.0);
  gl_FragColor = vec4(col, a * uAlpha);
}`;

function bubbleTexture(T) {
  const n = 32, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1, r = Math.hypot(dx, dy);
    const rim = Math.max(0, 1 - Math.abs(r - 0.78) / 0.18), fill = r < 0.8 ? 0.25 : 0;
    const hl = Math.max(0, 1 - Math.hypot(dx + 0.3, dy - 0.3) / 0.25);
    const a = Math.min(1, rim * 0.9 + fill + hl) * (r < 1 ? 1 : 0), i = (y * n + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(a * 255);
  }
  const tex = new T.DataTexture(data, n, n, T.RGBAFormat);
  tex.magFilter = tex.minFilter = T.LinearFilter; tex.needsUpdate = true;
  return tex;
}

export function createUnderwaterFx(T, { scene, camera, ocean, seafloor = null }) {
  const shallow = new T.Color(SHALLOW), deep = new T.Color(DEEP);
  const fogColor = new T.Color(SHALLOW), bgColor = new T.Color(SHALLOW);
  const fog = new T.Fog(fogColor, FOG_NEAR, FOG_FAR); fog.color = fogColor;
  const camPos = new T.Vector3(), camDir = new T.Vector3();
  let active = false, fade = 0, savedFog = null, savedBg = null, spawnAcc = 0, surfaceY = -0.24;

  // Ceiling: the water surface seen from below.
  const ceilUniforms = { uTime: { value: 0 }, uFog: { value: fogColor }, uTint: { value: new T.Color('#3fb7bd') }, uFar: { value: FOG_FAR } };
  const ceilMat = new T.ShaderMaterial({ uniforms: ceilUniforms, vertexShader: CEIL_VS, fragmentShader: CEIL_FS, side: T.DoubleSide, fog: false });
  const ceilGeo = new T.PlaneGeometry(160, 160, 1, 1); ceilGeo.rotateX(-Math.PI / 2);
  const ceiling = new T.Mesh(ceilGeo, ceilMat); ceiling.visible = false; ceiling.frustumCulled = false;
  scene.add(ceiling);

  // Overlay: one fullscreen triangle in its own scene.
  const ovGeo = new T.BufferGeometry();
  ovGeo.setAttribute('position', new T.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const ovUniforms = { uTime: { value: 0 }, uAlpha: { value: 0 }, uDeep: { value: 0 }, uLow: { value: 0 } };
  const ovMat = new T.ShaderMaterial({ uniforms: ovUniforms, vertexShader: OV_VS, fragmentShader: OV_FS, transparent: true,
    depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  const ovMesh = new T.Mesh(ovGeo, ovMat); ovMesh.frustumCulled = false;
  const ovScene = new T.Scene(); ovScene.add(ovMesh);
  const ovCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // Bubbles: fixed pool, dead ones parked far below.
  const pos = new Float32Array(MAX_BUBBLES * 3), life = new Float32Array(MAX_BUBBLES), speed = new Float32Array(MAX_BUBBLES);
  for (let i = 0; i < MAX_BUBBLES; i++) pos[i * 3 + 1] = -1e4;
  const bubGeo = new T.BufferGeometry(), bubAttr = new T.BufferAttribute(pos, 3);
  bubAttr.setUsage(T.DynamicDrawUsage); bubGeo.setAttribute('position', bubAttr);
  const bubTex = bubbleTexture(T);
  const bubMat = new T.PointsMaterial({ size: 0.07, map: bubTex, color: '#d8fbff', transparent: true, depthWrite: false, opacity: 0.85 });
  const bubbles = new T.Points(bubGeo, bubMat); bubbles.visible = false; bubbles.frustumCulled = false;
  scene.add(bubbles);

  function spawn(fromMouth) {
    let i = 0; while (i < MAX_BUBBLES && life[i] > 0) i++;
    if (i === MAX_BUBBLES) return;
    const j = i * 3;
    if (fromMouth) {
      pos[j] = camPos.x + camDir.x * 0.35 + (Math.random() - 0.5) * 0.12;
      pos[j + 1] = camPos.y - 0.18 + (Math.random() - 0.5) * 0.1;
      pos[j + 2] = camPos.z + camDir.z * 0.35 + (Math.random() - 0.5) * 0.12;
    } else {
      const a = Math.random() * Math.PI * 2, r = 0.8 + Math.random() * 3.5;
      pos[j] = camPos.x + Math.cos(a) * r; pos[j + 1] = camPos.y - 1 - Math.random() * 2.5; pos[j + 2] = camPos.z + Math.sin(a) * r;
    }
    life[i] = 3 + Math.random() * 3; speed[i] = 0.5 + Math.random() * 0.7;
  }

  function enter() {
    active = true; fade = 0; spawnAcc = 0;
    savedFog = scene.fog; savedBg = scene.background;
    scene.fog = fog; scene.background = bgColor;
    ceiling.visible = bubbles.visible = true;
    for (let i = 0; i < 36; i++) spawn(i % 3 !== 0); // entry splash burst
  }
  function exit() {
    active = false; fade = 0;
    scene.fog = savedFog; scene.background = savedBg; savedFog = savedBg = null;
    ceiling.visible = bubbles.visible = false;
    for (let i = 0; i < MAX_BUBBLES; i++) { life[i] = 0; pos[i * 3 + 1] = -1e4; }
    bubAttr.needsUpdate = true;
  }

  function update(dt, { underwater = false, depth = 0, time = 0, lowOxygen = false, breath01 = 0 } = {}) {
    if (seafloor?.uniforms) {
      if (seafloor.uniforms.uTime) seafloor.uniforms.uTime.value = time;
      if (seafloor.uniforms.uCaustic) seafloor.uniforms.uCaustic.value = Math.max(0.15, 1 - Math.max(0, depth) / 12);
    }
    if (underwater !== active) underwater ? enter() : exit();
    if (!active) return;
    const k = Math.min(1, Math.max(0, depth / DEEP_AT));
    fogColor.copy(shallow).lerp(deep, k); bgColor.copy(fogColor);
    fog.far = FOG_FAR - k * 8;
    fade = Math.min(1, fade + dt / FADE_IN);
    camera.getWorldPosition(camPos); camera.getWorldDirection(camDir);
    surfaceY = ocean.getHeight(camPos.x, camPos.z);
    ceiling.position.set(camPos.x, surfaceY, camPos.z);
    ceilUniforms.uTime.value = time; ceilUniforms.uFar.value = fog.far;
    ovUniforms.uTime.value = time; ovUniforms.uAlpha.value = fade; ovUniforms.uDeep.value = k;
    ovUniforms.uLow.value = lowOxygen ? 1 : 0;
    // Bubbles: gentle breath puffs, a steady trickle, lots more when low on oxygen.
    spawnAcc += dt * (lowOxygen ? 16 : 2.5 + 6 * Math.max(0, breath01 - 0.85) / 0.15);
    while (spawnAcc >= 1) { spawnAcc -= 1; spawn(Math.random() < 0.7); }
    for (let i = 0; i < MAX_BUBBLES; i++) {
      if (life[i] <= 0) continue;
      const j = i * 3; life[i] -= dt;
      pos[j + 1] += speed[i] * dt;
      pos[j] += Math.sin(time * 3 + i) * 0.08 * dt; pos[j + 2] += Math.cos(time * 2.6 + i * 1.7) * 0.08 * dt;
      if (life[i] <= 0 || pos[j + 1] > surfaceY - 0.03) { life[i] = 0; pos[j + 1] = -1e4; }
    }
    bubAttr.needsUpdate = true;
  }

  function render(renderer) {
    if (!active || fade <= 0) return;
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(ovScene, ovCam);
    renderer.autoClear = ac;
  }

  function dispose() {
    if (active) exit();
    scene.remove(ceiling); scene.remove(bubbles);
    ceilGeo.dispose(); ceilMat.dispose(); ovGeo.dispose(); ovMat.dispose();
    bubGeo.dispose(); bubMat.dispose(); bubTex.dispose();
  }

  return { update, render, dispose };
}
