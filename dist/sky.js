// Little Raft - bright tropical sky.
// Usage:
//   import { createSky } from './sky.js?build=v3-survival-ae77fa84ac2b';
//   const sky = createSky(THREE);
//   scene.add(sky.group);
//   // per frame: sky.update(elapsedSeconds, camera);
//
// One inside-out sphere (radius 150, fits camera.far = 200), one draw call,
// one tiny baked noise texture. Gradient, sun disk/halo, high wispy streaks
// and a sparse band of low cumulus near the horizon are computed per pixel
// from the world-space view direction.
//
// Live colours: sky.horizonColor (= uHorizon) is the colour scene.background,
// fog and the ocean's distance fade should use; day/night (daynight.js)
// rewrites it and the other uniforms every frame through sky.uniforms.

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
uniform float uSunVis;
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

  // Saturated tropical gradient: the horizon haze colour exactly at y = 0 (so
  // fog, background and the sea's far fade meet it), then a quick step to a
  // more saturated low sky so sky and sea separate, bright mid blue, deep blue
  // overhead.
  float up = clamp(y, 0.0, 1.0);
  vec3 low = mix(uHorizon, uMid, 0.4);
  vec3 col = mix(uHorizon, low, smoothstep(0.0, 0.035, up));
  col = mix(col, uMid, smoothstep(0.03, 0.24, up));
  col = mix(col, uZenith, smoothstep(0.12, 0.85, up));

  // Sun: wide soft glow, tighter bloom, crisp bright disk (fades out below the horizon).
  float sd = max(dot(dir, uSunDir), 0.0);
  float glow = (pow(sd, 8.0) * 0.22 + pow(sd, 64.0) * 0.38) * uSunVis;
  col = mix(col, uSunColor, clamp(glow, 0.0, 1.0));
  col += uSunColor * smoothstep(0.9988, 0.9995, sd) * 1.2 * uSunVis;

  if (y > 0.002) {
    // High wisps: thin bright streaks on a flat layer, stretched along the
    // wind, fading into the horizon haze. One lookup into a baked fbm tile.
    vec2 cp = dir.xz / (y + 0.10) * 0.55;
    vec2 drift = vec2(uTime * 0.004, uTime * 0.0015);
    vec2 sp = vec2(cp.x * 0.45 + cp.y * 0.2, cp.y * 1.6 - cp.x * 0.3); // anisotropic stretch
    float shape = texture2D(uNoise, (sp + drift) * 0.25).r;
    float thr = 1.0 - uCoverage;
    float density = smoothstep(thr, thr + 0.3, shape);
    density *= smoothstep(0.02, 0.2, y);
    vec3 cloudCol = mix(uCloudLit, uCloudShade, smoothstep(0.55, 1.0, density) * 0.35);
    cloudCol += uSunColor * pow(sd, 12.0) * 0.25 * uSunVis;
    col = mix(col, cloudCol, density * 0.85);

    // Low cumulus: a sparse band of soft puffs sitting on the horizon. The
    // azimuth wraps the noise tile a whole number of times (seamless); two
    // coarse lookups (2 and 3 tiles around) cluster them so most of the
    // horizon stays clear, and the threshold rises with height so each puff
    // heaps up from a flat base.
    if (y < 0.13) {
      float a = atan(dir.z, dir.x) * 0.15915494 + uTime * 0.00015; // 0..1 around the horizon
      float cluster = 0.5 * texture2D(uNoise, vec2(a * 2.0, 0.73)).r + 0.5 * texture2D(uNoise, vec2(a * 3.0, 0.41)).r;
      float puff = texture2D(uNoise, vec2(a * 8.0, y * 1.3 + 0.21)).r;
      float h = y / 0.09;                                  // 0 at the base, 1 near the tallest tops
      float cu = smoothstep(0.0, 0.09, puff + 1.2 * cluster - 1.19 - 0.3 * h * h) * smoothstep(0.002, 0.01, y);
      cu *= 0.7 + 0.5 * uCoverage;                         // a little bolder when it clouds over
      vec3 cuCol = mix(uCloudShade, uCloudLit, 0.3 + 0.7 * smoothstep(0.0, 0.6, h)); // shaded base, bright tops
      cuCol += uSunColor * pow(sd, 6.0) * 0.2 * uSunVis;  // warm rim toward the sun
      cuCol = mix(cuCol, uHorizon, 0.2);                  // distant: a touch of haze
      col = mix(col, cuCol, clamp(cu, 0.0, 0.92));
    }
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

export const SKY_HORIZON = '#a6e9f2'; // midday horizon: scene.background, fog and ocean far fade

export function createSky(T, options = {}) {
  const sunDirection = (options.sunDirection ?? new T.Vector3(-15, 28, 12)).clone().normalize();

  const uniforms = {
    uHorizon: { value: new T.Color(options.horizon ?? SKY_HORIZON) },
    uMid: { value: new T.Color(options.mid ?? '#4fb8e6') },
    uZenith: { value: new T.Color(options.zenith ?? '#1e86d2') },
    uSunColor: { value: new T.Color(options.sunColor ?? '#fff6dc') },
    uSunDir: { value: sunDirection },
    uSunVis: { value: 1 },
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
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.renderOrder = 20; // after the other opaques (0) and the ocean (10), so depth test culls covered pixels

  const group = new T.Group();
  group.name = 'sky';
  group.add(mesh);

  const _tmp = new T.Vector3();
  function update(time, camera) {
    uniforms.uTime.value = time || 0;
    if (camera) {
      const p = camera.getWorldPosition ? camera.getWorldPosition(_tmp) : camera.position;
      group.position.x = p.x;
      group.position.z = p.z;
    }
  }

  function dispose() {
    group.removeFromParent();
    group.remove(mesh);
    geometry.dispose();
    material.dispose();
    uniforms.uNoise.value.dispose();
  }

  return {
    group,
    update,
    dispose,
    sunDirection,          // normalized, shared with the shader; reuse for lights
    horizonColor: uniforms.uHorizon.value, // live: use for scene.background / fog / ocean uSky
    uniforms,
  };
}
