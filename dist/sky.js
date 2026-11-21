// Little Raft - bright tropical sky.
// Usage:
//   import { createSky } from './sky.js?build=v3-survival-ae77fa84ac2b';
//   const sky = createSky(THREE);
//   scene.add(sky.group);
//   // per frame: sky.follow(ocean.uniforms, scene.background); sky.update(elapsedSeconds, camera);
//
// One inside-out sphere (radius 150, fits camera.far = 200), one draw call,
// one tiny baked noise texture. Gradient, sun disk/halo and wispy clouds are
// computed per pixel from the world-space view direction.

const vertexShader = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  // Pin to the far plane so the dome sits behind everything and, drawn after
  // the opaque scene, only shades pixels nothing else covered.
  gl_Position.z = gl_Position.w * 0.99999;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uTime;
uniform float uCoverage;
uniform sampler2D uNoise;
varying vec3 vWorldPos;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec3 dir = normalize(vWorldPos - cameraPosition);
  float y = dir.y;

  // Saturated tropical gradient: pale cyan haze at the horizon, bright
  // mid-sky blue, deep blue overhead.
  float up = clamp(y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, up));
  col = mix(col, uZenith, smoothstep(0.05, 0.52, up));

  // Sun: wide soft glow, tighter bloom, crisp bright disk.
  float sd = max(dot(dir, uSunDir), 0.0);
  float glow = pow(sd, 8.0) * 0.22 + pow(sd, 64.0) * 0.38;
  col = mix(col, uSunColor, clamp(glow, 0.0, 1.0));
  col += uSunColor * smoothstep(0.9988, 0.9995, sd) * 1.2;

  // Clouds: thin bright wisps on a high flat layer, stretched along the wind
  // so they read as streaks rather than lumps, fading into the horizon haze.
  if (y > 0.015) {
    vec2 cp = dir.xz / (y + 0.10) * 0.55;
    vec2 drift = vec2(uTime * 0.004, uTime * 0.0015);
    vec2 sp = vec2(cp.x * 0.45 + cp.y * 0.2, cp.y * 1.6 - cp.x * 0.3); // anisotropic stretch
    // One lookup into a tileable fbm texture baked once on the CPU: far
    // cheaper per pixel than evaluating noise octaves in the shader.
    float shape = texture2D(uNoise, (sp + drift) * 0.25).r;
    float thr = 1.0 - uCoverage;
    float density = smoothstep(thr, thr + 0.3, shape);
    density *= smoothstep(0.02, 0.2, y);
    // Bright white everywhere; only a faint cool tint in the thickest cores.
    vec3 cloudCol = mix(uCloudLit, uCloudShade, smoothstep(0.55, 1.0, density) * 0.35);
    cloudCol += uSunColor * pow(sd, 12.0) * 0.25;
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

// Tileable value-noise fbm, baked once into a small single-channel texture.
function bakeNoise(T, size = 256, octaves = 6) {
  const data = new Uint8Array(size * size);
  const hash = (x, y, p) => {
    x = ((x % p) + p) % p; y = ((y % p) + p) % p;
    let h = (x * 374761393 + y * 668265263 + p * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = t => t * t * (3 - 2 * t);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let v = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < octaves; o++) {
      const period = 4 << o, x = (i / size) * period, y = (j / size) * period;
      const xi = Math.floor(x), yi = Math.floor(y), u = smooth(x - xi), w = smooth(y - yi);
      const a = hash(xi, yi, period), b = hash(xi + 1, yi, period), c = hash(xi, yi + 1, period), d = hash(xi + 1, yi + 1, period);
      v += amp * ((a + (b - a) * u) * (1 - w) + (c + (d - c) * u) * w);
      norm += amp; amp *= 0.5;
    }
    data[j * size + i] = Math.round((v / norm) * 255);
  }
  const tex = new T.DataTexture(data, size, size, T.RedFormat, T.UnsignedByteType);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.magFilter = T.LinearFilter;
  tex.minFilter = T.LinearFilter; // no mips: cheaper, and clouds fade out before they would alias
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const lum = c => .2126 * c.r + .7152 * c.g + .0722 * c.b;

export function createSky(T, options = {}) {
  const sunDirection = (options.sunDirection ?? new T.Vector3(-15, 28, 12)).clone().normalize();

  const uniforms = {
    uHorizon: { value: new T.Color(options.horizon ?? '#8fe3ef') },
    uMid: { value: new T.Color(options.mid ?? '#2aa8dc') },
    uZenith: { value: new T.Color(options.zenith ?? '#0b84c6') },
    uSunColor: { value: new T.Color(options.sunColor ?? '#fff6dc') },
    uSunDir: { value: sunDirection },
    uCloudLit: { value: new T.Color('#ffffff') },
    uCloudShade: { value: new T.Color('#d4e6f2') },
    uTime: { value: 0 },
    uNoise: { value: bakeNoise(T) },
    uCoverage: { value: options.coverage ?? 0.56 }, // fbm threshold control
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
  mesh.renderOrder = 1; // after other opaques (0) so depth test culls covered pixels
  mesh.matrixAutoUpdate = true;

  const group = new T.Group();
  group.name = 'sky';
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

  // Follow the live palette (day/night drives the ocean uniforms and scene.background every frame):
  // horizon from the background, zenith from the ocean's sky reflection, sun from the ocean glint
  // (already dimmed at night). Clouds dim with the horizon so they never glow white at night.
  const DAY_LUM = lum(uniforms.uHorizon.value), WHITE = uniforms.uCloudLit.value.clone(), SHADE = uniforms.uCloudShade.value.clone(), MID_DAY = uniforms.uMid.value.clone();
  function follow(oceanUniforms, background) {
    const u = uniforms;
    if (background?.isColor) u.uHorizon.value.copy(background);
    const zen = oceanUniforms?.uZenith?.value;
    if (zen) { u.uZenith.value.copy(zen); u.uMid.value.copy(u.uHorizon.value).lerp(zen, .6).lerp(MID_DAY, Math.min(1, lum(u.uHorizon.value) / DAY_LUM) * .5); }
    if (oceanUniforms?.uSunDir) u.uSunDir.value.copy(oceanUniforms.uSunDir.value).normalize();
    if (oceanUniforms?.uSunColor) u.uSunColor.value.copy(oceanUniforms.uSunColor.value);
    const k = Math.min(1, lum(u.uHorizon.value) / DAY_LUM);
    u.uCloudLit.value.copy(WHITE).lerp(u.uHorizon.value, 1 - k).multiplyScalar(.35 + .65 * k);
    u.uCloudShade.value.copy(SHADE).lerp(u.uHorizon.value, 1 - k).multiplyScalar(.35 + .65 * k);
  }

  function dispose() {
    group.remove(mesh);
    geometry.dispose();
    material.dispose();
    uniforms.uNoise.value.dispose();
  }

  return {
    group,
    update,
    follow,
    dispose,
    sunDirection,          // normalized, shared with the shader; reuse for lights
    horizonColor: uniforms.uHorizon.value, // use for scene.background / fog
    uniforms,
  };
}
