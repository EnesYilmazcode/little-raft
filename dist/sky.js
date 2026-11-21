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

// Everything that varies smoothly over the dome (gradient, sun glow and
// bloom, cloud colours, the cumulus cluster mask and the azimuth, read from
// the sphere's seamless u) is evaluated per vertex on a dome with fine rings.
// Per pixel that leaves two texture reads, a little ALU and the sun disk:
// the sky covers a big share of the screen, and software GL pays per pixel.
const vertexShader = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uCoverage;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uSunVis;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
varying vec3 vWorldPos;
varying vec3 vSky;
varying vec3 vWisp;
varying vec3 vCuCol;
varying vec3 vCu;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  // Pin to the far plane so the dome sits behind everything and, drawn after
  // the opaque scene, only shades pixels nothing else covered.
  gl_Position.z = gl_Position.w * 0.99999;

  // Saturated tropical gradient: the horizon haze colour exactly at y = 0 (so
  // fog, background and the sea's far fade meet it), then a quick step to a
  // more saturated low sky so sky and sea separate, bright mid blue, deep blue
  // overhead. Below the horizon (rarely visible behind the ocean) stay hazy.
  vec3 dir = normalize(wp.xyz - cameraPosition);
  float up = clamp(dir.y, 0.0, 1.0);
  vec3 low = mix(uHorizon, uMid, 0.4);
  vec3 col = mix(uHorizon, low, smoothstep(0.0, 0.035, up));
  col = mix(col, uMid, smoothstep(0.03, 0.24, up));
  col = mix(col, uZenith, smoothstep(0.12, 0.85, up));
  // Sun: wide soft glow and tighter bloom (the crisp disk is per pixel).
  float sd = max(dot(dir, uSunDir), 0.0);
  float s2 = sd * sd, s4 = s2 * s2, s8 = s4 * s4, s16 = s8 * s8, s64 = s16 * s16; s64 *= s64;
  col = mix(col, uSunColor, clamp((s8 * 0.22 + s64 * 0.38) * uSunVis, 0.0, 1.0));
  vSky = mix(col, uHorizon * 0.96, smoothstep(0.0, -0.08, dir.y));

  // High wisps: bright white with a warm sheen toward the sun.
  vWisp = uCloudLit + uSunColor * (s8 * s4) * 0.25 * uSunVis;

  // Low cumulus: shaded flat base, bright heaped tops, warm rim toward the
  // sun, a touch of distance haze. vCu = (azimuth 0..1, cluster threshold
  // bias, opacity). u has a duplicated seam column, so no wrap jump; the
  // cluster mask is 3 tiles around against 8 for the puffs, so the pattern
  // only repeats once a full turn.
  float h = dir.y / 0.09;
  vec3 cu = mix(uCloudShade, uCloudLit, 0.3 + 0.7 * smoothstep(0.0, 0.6, h));
  vCuCol = mix(cu + uSunColor * (s4 * s2) * 0.2 * uSunVis, uHorizon, 0.2);
  float a = uv.x + uTime * 0.00015;
  vCu = vec3(a, 5.0 * texture2D(uNoise, vec2(a * 3.0, 0.41)).r - 3.03, 0.7 + 0.5 * uCoverage);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uCloudShade;
uniform float uTime;
uniform float uCoverage;
uniform float uSunVis;
uniform sampler2D uNoise;
varying vec3 vWorldPos;
varying vec3 vSky;
varying vec3 vWisp;
varying vec3 vCuCol;
varying vec3 vCu;

// Interleaved gradient noise: a few ALU ops of dither against banding.
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec3 dir = normalize(vWorldPos - cameraPosition);
  float y = dir.y;

  vec3 col = vSky;
  col += uSunColor * (clamp((dot(dir, uSunDir) - 0.9988) * 1428.6, 0.0, 1.0) * 1.2 * uSunVis); // crisp sun disk

  if (y > 0.02) {
    // High wisps: thin bright streaks on a flat layer, stretched along the
    // wind, fading into the horizon haze. One lookup into a baked fbm tile.
    vec2 cp = dir.xz / (y + 0.10) * 0.55;
    vec2 sp = vec2(cp.x * 0.45 + cp.y * 0.2, cp.y * 1.6 - cp.x * 0.3) + vec2(uTime * 0.004, uTime * 0.0015); // anisotropic stretch + drift
    float shape = texture2D(uNoise, sp * 0.25).r;
    float thr = 1.0 - uCoverage;
    float density = smoothstep(thr, thr + 0.3, shape) * clamp((y - 0.02) * 5.56, 0.0, 1.0);
    vec3 cloudCol = mix(vWisp, uCloudShade, max(density - 0.55, 0.0) * 0.78); // faint cool tint in the thickest cores
    col = mix(col, cloudCol, density * 0.85);
  }

  // Low cumulus: a sparse band of soft puffs sitting on the horizon; the
  // threshold rises with height so each heaps up from a flat base. The puff
  // noise never exceeds ~0.74, so where the cluster bias is below -0.74
  // nothing can show (most of the horizon) and tops stay under y ~ 0.09.
  if (y > 0.002 && y < 0.095 && vCu.y > -0.74) {
    float puff = texture2D(uNoise, vec2(vCu.x * 8.0, y * 1.3 + 0.21)).r;
    float h = y * 11.1; // 0 at the base, 1 near the tallest tops
    float cu = clamp((puff + vCu.y - 0.3 * h * h) * 11.1, 0.0, 1.0) * clamp((y - 0.002) * 125.0, 0.0, 1.0) * vCu.z;
    col = mix(col, vCuCol, min(cu, 0.92));
  }

  // Tiny dither against gradient banding.
  col += (ign(gl_FragCoord.xy) - 0.5) / 255.0;

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

  const geometry = new T.SphereGeometry(150, 96, 64);
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
