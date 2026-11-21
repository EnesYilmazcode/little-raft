// Little Raft - bright tropical sky: one inside-out sphere, one draw call, no textures.
//   const sky = createSky(THREE, {sunDirection});
//   scene.add(sky.group); scene.background = sky.horizonColor;
//   sky.update(elapsedSeconds, camera);   // per frame
// Gradient and sun disc + halo are computed per pixel; drifting cumulus come from a baked texture.
// Clouds are lit from the sun side (white tops, pale blue-grey bellies), never dark smudges.

export const SKY = Object.freeze({
  horizon: '#c4dfeb', // soft haze; also scene.background, fog and the ocean's distance fade
  zenith: '#3d8fd6',
  sun: '#fff6df',
});

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;                 // sphere is centred on the camera, so local pos = view dir
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w;   // pin to the far plane: never clipped, never covers geometry
}
`;

// Clouds are baked once into a small tileable texture (R = density, G = sun-side lighting), so the
// dome costs one texture fetch per pixel instead of a per-pixel fbm.
const fragmentShader = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uCoverage;
uniform sampler2D uClouds;
varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);
  float y = dir.y;
  float up = clamp(y, 0.0, 1.0);

  // Deep blue overhead easing into a bright hazy band at the horizon.
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  float sd = max(dot(dir, uSunDir), 0.0);
  float sd8 = sd * sd; sd8 *= sd8; sd8 *= sd8;
  col += uSunColor * (sd8 * 0.22 + pow(sd, 64.0) * 0.35);              // warm halo
  col = mix(col, vec3(1.0, 0.99, 0.95), smoothstep(0.9993, 0.9997, sd)); // crisp disc

  // Cumulus on a flat layer, foreshortened toward the horizon.
  if (y > 0.015) {
    vec2 cp = dir.xz / (y + 0.22) * 0.2 + vec2(uTime * 0.0015, uTime * 0.0005);
    vec2 c = texture2D(uClouds, cp).rg;
    c.r += (texture2D(uClouds, cp * 4.0 + 0.37).r - 0.5) * 0.16;     // finer billows on the edges
    float thr = 1.0 - uCoverage;
    float d = smoothstep(thr, thr + 0.07, c.r) * smoothstep(0.015, 0.16, y);
    vec3 belly = mix(uHorizon, uZenith, 0.3) * 0.92;
    vec3 cloud = mix(belly, vec3(1.0), c.g * 0.75 + 0.25);
    cloud += uSunColor * sd8 * sd * (1.0 - d) * 0.6;                    // silver lining near the sun
    cloud = mix(cloud, uHorizon, smoothstep(0.35, 0.02, y) * 0.6);      // aerial haze
    col = mix(col, cloud, d * 0.95);
  }
  col = mix(col, uHorizon, smoothstep(0.02, -0.06, y)); // below the horizon: haze only
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0; // dither

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

// Tileable value-noise fbm, baked on the CPU. Period P lattice cells at the base octave.
const TEX = 256, P = 8;
function bakeClouds(T, sunDirection) {
  const hash = (x, z, p) => {
    x = ((x % p) + p) % p; z = ((z % p) + p) % p;
    let h = Math.imul(x + 101 * p, 374761393) ^ Math.imul(z + 7 * p, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const noise = (x, z, p) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz, p), b = hash(ix + 1, iz, p), c = hash(ix, iz + 1, p), d = hash(ix + 1, iz + 1, p);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  };
  // x, z in base-lattice units (0..P wraps).
  const shape = (x, z) => {
    const wx = noise(x * 0.5, z * 0.5, P / 2) * 0.5, wz = noise(x * 0.5 + 2.5, z * 0.5 + 1.5, P / 2) * 0.5;
    let v = 0, a = 0.5, f = 1;
    for (let o = 0; o < 4; o++) { v += a * noise((x + wx) * f, (z + wz) * f, P * f); f *= 2; a *= 0.5; }
    return v * (0.75 + 0.25 * noise(x * 0.25, z * 0.25, P / 4)); // fewer, separate puffs
  };
  const len = Math.hypot(sunDirection.x, sunDirection.z) || 1;
  const sx = sunDirection.x / len * 0.25, sz = sunDirection.z / len * 0.25;
  const data = new Uint8Array(TEX * TEX * 4), k = P / TEX;
  for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) {
    const x = i * k, z = j * k, s = shape(x, z);
    const lit = Math.min(1, Math.max(0, 0.5 + (s - shape(x + sx, z + sz)) * 4)); // denser toward the sun: brighter rim
    const o = (j * TEX + i) * 4;
    data[o] = s * 255; data[o + 1] = lit * 255; data[o + 3] = 255;
  }
  const tex = new T.DataTexture(data, TEX, TEX, T.RGBAFormat, T.UnsignedByteType);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.magFilter = T.LinearFilter;
  tex.minFilter = T.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function createSky(T, options = {}) {
  const sunDirection = (options.sunDirection ?? new T.Vector3(-15, 28, 12)).clone().normalize();
  const uniforms = {
    uHorizon: { value: new T.Color(options.horizon ?? SKY.horizon) },
    uZenith: { value: new T.Color(options.zenith ?? SKY.zenith) },
    uSunColor: { value: new T.Color(options.sunColor ?? SKY.sun) },
    uSunDir: { value: sunDirection },
    uTime: { value: 0 },
    uCoverage: { value: options.coverage ?? 0.5 },
    uClouds: { value: bakeClouds(T, sunDirection) },
  };
  const geometry = new T.SphereGeometry(100, 32, 16);
  const material = new T.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    side: T.BackSide, depthWrite: false, fog: false, lights: false,
    toneMapped: false, // exact authored colours so the horizon matches background, fog and ocean fade
  });
  const mesh = new T.Mesh(geometry, material);
  mesh.name = 'sky-dome';
  mesh.frustumCulled = false;
  // Depth sits on the far plane, so drawing after the opaques (depth test on) lets early-z skip every pixel the
  // ocean, raft and islands already cover; transparents still sort after it.
  mesh.renderOrder = 1;
  const group = new T.Group();
  group.name = 'sky';
  group.add(mesh);

  function update(time, camera) {
    uniforms.uTime.value = time || 0;
    if (camera) group.position.copy(camera.position);
  }
  function dispose() {
    group.remove(mesh);
    geometry.dispose();
    material.dispose();
    uniforms.uClouds.value.dispose();
  }
  return { group, update, dispose, sunDirection, horizonColor: uniforms.uHorizon.value, uniforms };
}
