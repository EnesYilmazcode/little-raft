// Little Raft - bright tropical sky: one inside-out sphere, one draw call, no textures.
//   const sky = createSky(THREE, {sunDirection});
//   scene.add(sky.group); scene.background = sky.horizonColor;
//   sky.update(elapsedSeconds, camera);   // per frame
// Gradient, sun disc + halo and drifting cumulus are computed per pixel from the view direction.
// Clouds are lit from the sun side (white tops, pale blue-grey bellies), never dark smudges.

export const SKY = Object.freeze({
  horizon: '#d6ecf2', // pale haze; also scene.background, fog and the ocean's distance fade
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

const fragmentShader = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uCoverage;
varying vec3 vDir;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = rot * p * 2.07 + 13.7; a *= 0.5; }
  return v;
}

void main() {
  vec3 dir = normalize(vDir);
  float y = dir.y;
  float up = clamp(y, 0.0, 1.0);

  // Deep blue overhead easing into a bright hazy band at the horizon.
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 8.0) * 0.22 + pow(sd, 64.0) * 0.35);  // warm halo
  col = mix(col, vec3(1.0, 0.99, 0.95), smoothstep(0.9993, 0.9997, sd)); // crisp disc

  // Cumulus on a flat layer: foreshortened toward the horizon, puffy via a domain warp.
  if (y > 0.0) {
    vec2 cp = dir.xz / (y + 0.22) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
    vec2 warp = vec2(vnoise(cp * 0.5), vnoise(cp * 0.5 + 5.2)) * 0.5;
    float shape = fbm(cp + warp) * (0.75 + 0.25 * vnoise(cp * 0.23)); // fewer, separate puffs
    float thr = 1.0 - uCoverage;
    float d = smoothstep(thr, thr + 0.09, shape);
    d *= smoothstep(0.02, 0.16, y);
    if (d > 0.002) {
      // Self-shadow: denser toward the sun means a brighter rim on that side.
      vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.25;
      float behind = fbm(cp + warp + toSun);
      float shade = clamp(0.5 + (shape - behind) * 4.0, 0.0, 1.0);
      vec3 belly = mix(uHorizon, uZenith, 0.25) * 0.95;
      vec3 cloud = mix(belly, vec3(1.0), shade * 0.75 + 0.25);
      cloud += uSunColor * pow(sd, 12.0) * (1.0 - d) * 0.6;    // silver lining near the sun
      cloud = mix(cloud, uHorizon, smoothstep(0.35, 0.02, y) * 0.6); // aerial haze
      col = mix(col, cloud, d * 0.95);
    }
  }
  col = mix(col, uHorizon, smoothstep(0.02, -0.06, y)); // below the horizon: haze only
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;          // dither against banding

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function createSky(T, options = {}) {
  const sunDirection = (options.sunDirection ?? new T.Vector3(-15, 28, 12)).clone().normalize();
  const uniforms = {
    uHorizon: { value: new T.Color(options.horizon ?? SKY.horizon) },
    uZenith: { value: new T.Color(options.zenith ?? SKY.zenith) },
    uSunColor: { value: new T.Color(options.sunColor ?? SKY.sun) },
    uSunDir: { value: sunDirection },
    uTime: { value: 0 },
    uCoverage: { value: options.coverage ?? 0.5 },
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
  mesh.renderOrder = -10;
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
  }
  return { group, update, dispose, sunDirection, horizonColor: uniforms.uHorizon.value, uniforms };
}
