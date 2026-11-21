// Little Raft - tropical ocean sky (saturated blue dome, pale band at the horizon, wispy clouds).
// Usage:
//   import { createSky } from './sky.js?build=v3-survival-ae77fa84ac2b';
//   const sky = createSky(THREE);
//   scene.add(sky.group);
//   // per frame: sky.update(elapsedSeconds, camera);
//
// One inside-out sphere (radius 150, fits camera.far = 200), one draw call,
// no textures. Gradient, sun disk/halo and soft procedural clouds are all
// computed per pixel from the world-space view direction.

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
uniform vec3 uZenith;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uTime;
uniform float uCoverage;
uniform float uSunAmt;
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

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = rot * p * 2.03 + vec2(17.1, 9.4);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 dir = normalize(vWorldPos - cameraPosition);
  float y = dir.y;

  // Base gradient: pale band hugging the horizon, saturated blue overhead.
  float up = clamp(y, 0.0, 1.0);
  float t = 1.0 - pow(1.0 - up, 4.0);
  vec3 col = mix(uHorizon, uZenith, t);

  // Sun: broad warm halo, softer wide glow, small soft disk.
  float sd = max(dot(dir, uSunDir), 0.0);
  float glow = (pow(sd, 6.0) * 0.16 + pow(sd, 40.0) * 0.32 + pow(sd, 600.0) * 0.6) * uSunAmt;
  col = mix(col, uSunColor, clamp(glow, 0.0, 1.0));
  // Warm the horizon slightly on the sun side.
  float sunAz = max(dot(normalize(vec3(dir.x, 0.0, dir.z) + 1e-5), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
  col = mix(col, uSunColor, pow(sunAz, 4.0) * (1.0 - t) * 0.12 * uSunAmt);

  // Clouds: project the view ray onto a high flat layer so puffs foreshorten
  // naturally toward the horizon, then fade them into the haze.
  if (y > 0.0) {
    vec2 cp = dir.xz / (y + 0.12) * 0.9;
    vec2 drift = vec2(uTime * 0.0035, uTime * 0.0012);
    float n = fbm(cp * vec2(0.55, 1.3) + drift);          // stretched: long wispy streaks
    float detail = fbm(cp * vec2(1.6, 3.4) - drift * 1.6);
    float shape = n * 0.72 + detail * 0.28;
    float thr = 1.0 - uCoverage;           // higher coverage -> lower threshold
    float density = smoothstep(thr, thr + 0.3, shape);
    density *= smoothstep(0.03, 0.22, y);  // dissolve into horizon haze
    density *= 1.0 - smoothstep(0.75, 1.0, y) * 0.5; // thinner straight overhead
    // Cheap self-shading: denser core and away-from-sun side darker.
    // Thin edges stay bright white; thick cores get blue-grey bellies.
    float lit = 0.7 + 0.3 * pow(sd, 3.0);
    vec3 cloudCol = mix(uCloudShade, uCloudLit, clamp(lit * (1.25 - density * 0.7), 0.0, 1.0));
    cloudCol = mix(cloudCol, uSunColor, pow(sd, 24.0) * 0.5 * uSunAmt); // silver lining near the sun
    col = mix(col, cloudCol, density * 0.85);
  }

  // Below the horizon (rarely visible behind the ocean fade) stay hazy.
  col = mix(col, uHorizon * 0.96, smoothstep(0.0, -0.08, y));

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
    uHorizon: { value: new T.Color(options.horizon ?? '#cfe8f2') },
    uZenith: { value: new T.Color(options.zenith ?? '#2f8fe0') },
    uSunColor: { value: new T.Color(options.sunColor ?? '#fff1d6') },
    uSunAmt: { value: 1 }, // 0 hides the sun glow (night)
    uSunDir: { value: sunDirection },
    uCloudLit: { value: new T.Color('#ffffff') },
    uCloudShade: { value: new T.Color('#c9d6e0') },
    uTime: { value: 0 },
    uCoverage: { value: options.coverage ?? 0.5 }, // fbm threshold control (daynight drives it from weather)
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
  mesh.renderOrder = -10;
  mesh.matrixAutoUpdate = true;

  const group = new T.Group();
  group.name = 'sky';
  group.renderOrder = -10;
  group.add(mesh);

  function update(time, camera) {
    uniforms.uTime.value = time || 0;
    if (camera) {
      const p = camera.getWorldPosition ? camera.getWorldPosition(_tmp) : camera.position;
      group.position.x = p.x;
      group.position.z = p.z;
    }
  }

  const _tmp = new T.Vector3();

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
