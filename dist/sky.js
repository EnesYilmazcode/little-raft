// Little Raft - bright tropical sky.
// Usage:
//   import { createSky } from './sky.js?build=v3-survival-ae77fa84ac2b';
//   const sky = createSky(THREE);
//   scene.add(sky.group);
//   // per frame: sky.update(elapsedSeconds);
//
// One inside-out sphere (radius 150, fits camera.far = 200), one draw call,
// no textures. Gradient, sun disk/halo and soft procedural clouds are all
// computed per pixel from the world-space view direction. The dome recentres
// on the rendering camera, ignores fog, and is drawn after other opaques.

const vertexShader = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uMid;
uniform vec3 uZenith;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uTime;
uniform float uCoverage;
varying vec3 vWorldPos;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 3 octaves (+1 warp lookup): cheap enough for one full-screen pass under software GL.
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = rot * p * 2.07 + vec2(17.1, 9.4);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 dir = normalize(vWorldPos - cameraPosition);
  float y = dir.y;

  // Tropical gradient: pale cyan haze only in a thin band at the horizon,
  // saturating quickly into a clear cyan-blue, deeper blue overhead.
  float up = max(y, 0.0);
  float t1 = 1.0 - exp(-up * 9.0);
  float t2 = smoothstep(0.12, 0.85, up);
  vec3 col = mix(mix(uHorizon, uMid, t1), uZenith, t2);

  // Sun: wide warm bloom, tighter glow, bright soft disk.
  float sd = max(dot(dir, uSunDir), 0.0);
  float glow = pow(sd, 8.0) * 0.22 + pow(sd, 64.0) * 0.35 + smoothstep(0.9993, 0.9997, sd);
  col = mix(col, uSunColor, clamp(glow, 0.0, 1.0));

  // Clouds: project onto a high flat layer so they foreshorten toward the
  // horizon; stretch the domain for long, thin, wind-combed wisps.
  if (y > 0.015) {
    vec2 cp = dir.xz / (y + 0.1) * 0.55;
    cp = vec2(cp.x * 0.45 + cp.y * 0.25, cp.y * 1.3 - cp.x * 0.2);
    vec2 drift = vec2(uTime * 0.004, uTime * 0.0015);
    float warp = vnoise(cp * 0.7 - drift);
    float shape = fbm(cp + drift + vec2(warp * 1.4, warp * 0.6));
    float thr = 1.0 - uCoverage;
    float density = smoothstep(thr, thr + 0.32, shape);
    density *= density;                     // soft, feathered edges
    density *= smoothstep(0.015, 0.12, y);    // dissolve into horizon haze
    // Bellies: thick parts go grey-blue, thin edges stay bright white.
    vec3 cloudCol = mix(uCloudLit, uCloudShade, smoothstep(0.25, 0.9, density));
    cloudCol = mix(cloudCol, uSunColor, pow(sd, 16.0) * 0.6);
    col = mix(col, cloudCol, density * 0.9);
  }

  // Below the horizon (behind the ocean fade) match the fog colour exactly.
  col = mix(col, uHorizon, smoothstep(0.0, -0.02, y));

  // Tiny dither against gradient banding.
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSky(T, options = {}) {
  const sunDirection = (options.sunDirection ?? new T.Vector3(-15, 28, 12)).clone().normalize();

  const uniforms = {
    uHorizon: { value: new T.Color(options.horizon ?? '#a6e2ec') },
    uMid: { value: new T.Color(options.mid ?? '#3fb0e4') },
    uZenith: { value: new T.Color(options.zenith ?? '#1f8fcf') },
    uSunColor: { value: new T.Color(options.sunColor ?? '#fff4d6') },
    uSunDir: { value: sunDirection },
    uCloudLit: { value: new T.Color(options.cloudLit ?? '#fbfdff') },
    uCloudShade: { value: new T.Color(options.cloudShade ?? '#c9d6df') },
    uTime: { value: 0 },
    uCoverage: { value: options.coverage ?? 0.5 }, // fbm threshold control
  };

  const geometry = new T.SphereGeometry(150, 48, 24);
  const material = new T.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: T.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    lights: false,
    // Unlit backdrop: keep exact authored colours so the horizon matches
    // scene.background / fog / ocean distance fade (which are not tonemapped).
    toneMapped: false,
  });

  const mesh = new T.Mesh(geometry, material);
  mesh.name = 'sky-dome';
  mesh.frustumCulled = false;
  // Opaque, but drawn after the other opaques so early-z skips covered pixels.
  mesh.renderOrder = 100;
  // Centre on whichever camera renders it, right before drawing (no lag).
  const _tmp = new T.Vector3();
  mesh.onBeforeRender = (renderer, scene, cam) => {
    mesh.matrixWorld.makeTranslation(cam.getWorldPosition(_tmp));
  };

  const group = new T.Group();
  group.name = 'sky';
  group.add(mesh);

  function update(time) {
    uniforms.uTime.value = time || 0;
  }

  function dispose() {
    group.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return {
    group,
    update,
    dispose,
    sunDirection,          // normalized, shared with the shader; reuse for lights
    horizonColor: uniforms.uHorizon.value, // use for scene.background / fog
    uniforms,
  };
}
