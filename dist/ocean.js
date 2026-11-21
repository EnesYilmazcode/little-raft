// Procedural Gerstner ocean for Little Raft (THREE r170, ShaderMaterial, no textures).
// Usage:
//   import { createOcean } from './ocean.js?build=v3-survival-ae77fa84ac2b';
//   const ocean = createOcean(T);            // T = THREE namespace
//   scene.add(ocean.mesh);
//   ocean.update(timeSeconds);               // each frame (optionally ocean.update(t, camera))
//   ocean.getHeight(x, z)                    // CPU wave height (world y) for bobbing items/raft

// Shared wave set (dirX, dirZ, amplitude, wavelength, steepness). Sum of amplitudes = .255,
// so with base y -.24 crests peak near y = .015 — well under the raft floor at .2.
const WAVES = [
  [1.0, 0.35, 0.10, 31.0, 0.50],
  [0.7, 0.90, 0.065, 19.0, 0.60],
  [-0.45, 1.0, 0.05, 12.5, 0.60],
  [0.95, -0.55, 0.04, 9.2, 0.50],
];
const SPEED = 0.6;      // slows real deep-water dispersion for a calm sea
const BASE_Y = -0.24;

const glslWaves = WAVES.map(([dx, dz, a, l, q]) => {
  const len = Math.hypot(dx, dz);
  const f = (v) => v.toFixed(5);
  return `wave(vec2(${f(dx / len)}, ${f(dz / len)}), ${f(a)}, ${f(l)}, ${f(q)}, p, disp, tng, bin);`;
}).join('\n    ');

const vertexShader = /* glsl */`
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vHeight;

void wave(vec2 d, float a, float L, float Q, vec2 p, inout vec3 disp, inout vec3 tng, inout vec3 bin) {
  float k = 6.2831853 / L;
  float c = sqrt(9.8 / k) * ${SPEED.toFixed(3)};
  float f = k * (dot(d, p) - c * uTime);
  float s = sin(f), co = cos(f);
  float qa = Q * a;
  disp += vec3(d.x * qa * co, a * s, d.y * qa * co);
  float ka = k * a, kqa = k * qa;
  tng += vec3(-d.x * d.x * kqa * s, d.x * ka * co, -d.x * d.y * kqa * s);
  bin += vec3(-d.x * d.y * kqa * s, d.y * ka * co, -d.y * d.y * kqa * s);
}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p = wp.xz;
  vec3 disp = vec3(0.0);
  vec3 tng = vec3(1.0, 0.0, 0.0);
  vec3 bin = vec3(0.0, 0.0, 1.0);
  ${glslWaves}
  wp.xyz += disp;
  vWorld = wp.xyz;
  vHeight = disp.y;
  vNormalW = normalize(cross(bin, tng));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uZenith;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform float uFadeNear;
uniform float uFadeFar;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vHeight;

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
// Small analytic ripples -> height gradient (dh/dx, dh/dz)
void ripple(vec2 d, float a, float k, float w, vec2 p, inout vec2 g) {
  float f = k * dot(d, p) - w * uTime;
  g += d * (a * k * cos(f));
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam.xz);
  vec3 V = normalize(toCam);
  vec3 L = normalize(uSunDir);

  // Detail ripples fade with distance to avoid shimmering / aliasing.
  float near = 1.0 - smoothstep(8.0, 60.0, dist);
  vec2 g = vec2(0.0);
  vec2 p = vWorld.xz;
  ripple(normalize(vec2(0.8, 0.6)), 0.010, 2.10, 1.30, p, g);
  ripple(normalize(vec2(-0.5, 0.9)), 0.008, 2.90, 1.70, p, g);
  ripple(normalize(vec2(0.95, -0.3)), 0.006, 4.30, 2.10, p, g);
  ripple(normalize(vec2(-0.9, -0.4)), 0.004, 6.70, 2.60, p, g);
  ripple(normalize(vec2(0.2, 1.0)), 0.003, 9.10, 3.10, p, g);
  g *= near;
  vec3 n = normalize(vec3(vNormalW.x - g.x, vNormalW.y, vNormalW.z - g.y));

  float ndv = max(dot(n, V), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  fresnel = min(fresnel, 0.72);

  vec3 R = reflect(-V, n);
  vec3 skyRefl = mix(uSky, uZenith, smoothstep(0.0, 0.6, R.y));

  // Body colour: deep teal in troughs, turquoise on crests and in slow patches.
  float patches = vnoise(p * 0.045 + uTime * 0.01) * 0.6 + vnoise(p * 0.13 - uTime * 0.02) * 0.4;
  float h = clamp(vHeight / 0.2 * 0.5 + 0.5, 0.0, 1.0);
  float shallowMix = clamp(h * 0.55 + patches * 0.35 + (1.0 - ndv) * 0.15, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, shallowMix);
  // Soft subsurface glow where sunlight passes through crests.
  float sss = smoothstep(0.45, 1.0, h) * (0.5 + 0.5 * max(dot(n, L), 0.0)) * 0.35;
  body += uShallow * sss;
  float diff = 0.7 + 0.3 * max(dot(n, L), 0.0);
  vec3 col = mix(body * diff, skyRefl, fresnel);

  // Sun highlights: sharp glint + broad sheen, clamped and faded to avoid flashing.
  vec3 H = normalize(L + V);
  float ndh = max(dot(n, H), 0.0);
  float spec = pow(ndh, 260.0) * 1.6 + pow(ndh, 36.0) * 0.12;
  spec = min(spec, 1.4) * (1.0 - smoothstep(40.0, 120.0, dist) * 0.7);
  col += uSunColor * spec;

  // Thin, sparse lacy foam riding the crests.
  vec2 fp = p + vec2(uTime * 0.35, uTime * 0.12);
  float n1 = vnoise(fp * 0.9);
  float n2 = vnoise(fp * 2.6 + vec2(uTime * -0.2, uTime * 0.15));
  float lace = 1.0 - smoothstep(0.0, 0.035, abs(n1 * 0.7 + n2 * 0.3 - 0.5));
  float crest = smoothstep(0.06, 0.17, vHeight);
  float speck = smoothstep(0.86, 0.93, vnoise(fp * 3.7)) * smoothstep(0.0, 0.12, vHeight);
  float foam = clamp(lace * crest * 0.55 + speck * 0.35, 0.0, 0.6);
  foam *= 1.0 - smoothstep(30.0, 90.0, dist);
  col = mix(col, uFoam, foam);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  // Fade toward the (untonemapped) sky colour after tone mapping so the horizon matches the background.
  float fade = smoothstep(uFadeNear, uFadeFar, dist);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uSky, fade);
  #include <colorspace_fragment>
}
`;

export function createOcean(T, options = {}) {
  const size = options.size ?? 280;
  const segments = options.segments ?? 100;
  const geometry = new T.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const sun = options.sunDirection ?? new T.Vector3(-15, 28, 12);
  const uniforms = {
    uTime: { value: 0 },
    uCamera: { value: new T.Vector3() },
    uSunDir: { value: sun.clone().normalize() },
    uSunColor: { value: new T.Color('#fff3d6') },
    uSky: { value: new T.Color(options.skyColor ?? '#99dfe1') },
    uZenith: { value: new T.Color('#5fb6dc') },
    uDeep: { value: new T.Color('#0a4a5a') },
    uShallow: { value: new T.Color('#1fa9a8') },
    uFoam: { value: new T.Color('#eefbf8') },
    uFadeNear: { value: options.fadeNear ?? 52 },
    uFadeFar: { value: options.fadeFar ?? 135 },
  };

  const material = new T.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    fog: false,
    lights: false,
    toneMapped: true,
  });

  const mesh = new T.Mesh(geometry, material);
  mesh.name = 'ocean';
  mesh.position.y = BASE_Y;
  mesh.frustumCulled = false; // displaced vertices; plane always surrounds the player

  const step = size / segments;
  let time = 0;

  function update(t, camera) {
    time = t;
    uniforms.uTime.value = t;
    if (camera) {
      uniforms.uCamera.value.copy(camera.position);
      if (options.followCamera) {
        // Snap to grid spacing so vertices never swim (waves use world coords).
        mesh.position.x = Math.round(camera.position.x / step) * step;
        mesh.position.z = Math.round(camera.position.z / step) * step;
      }
    }
  }

  // CPU mirror of the vertex shader (inverts horizontal Gerstner shift with 2 iterations).
  const pre = WAVES.map(([dx, dz, a, l, q]) => {
    const len = Math.hypot(dx, dz);
    const k = (Math.PI * 2) / l;
    return { dx: dx / len, dz: dz / len, a, k, c: Math.sqrt(9.8 / k) * SPEED, q };
  });
  function displace(x, z, t, out) {
    let ox = 0, oy = 0, oz = 0;
    for (const w of pre) {
      const f = w.k * (w.dx * x + w.dz * z - w.c * t);
      const co = Math.cos(f);
      ox += w.dx * w.q * w.a * co;
      oz += w.dz * w.q * w.a * co;
      oy += w.a * Math.sin(f);
    }
    out[0] = ox; out[1] = oy; out[2] = oz;
    return out;
  }
  const tmp = [0, 0, 0];
  function getHeight(x, z, t = time) {
    let px = x, pz = z;
    for (let i = 0; i < 2; i++) {
      displace(px, pz, t, tmp);
      px = x - tmp[0];
      pz = z - tmp[2];
    }
    displace(px, pz, t, tmp);
    return mesh.position.y + tmp[1];
  }
  // Approximate surface slope for tilting floating objects: returns {x, z} tilt gradient.
  function getSlope(x, z, t = time, e = 0.6) {
    return {
      x: (getHeight(x + e, z, t) - getHeight(x - e, z, t)) / (2 * e),
      z: (getHeight(x, z + e, t) - getHeight(x, z - e, t)) / (2 * e),
    };
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
  }

  return { mesh, update, getHeight, getSlope, uniforms, material, dispose };
}
