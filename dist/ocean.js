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
uniform vec2 uFlow; // [sailing] raft travel relative to the water (sailing-world.js)
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
  vec3 pos = position;
  #ifdef OCEAN_SKIRT
  // Stretch the outer vertex ring out to a circle just inside camera.far so the water reaches
  // the horizon instead of ending in a pale band of sky dome below it.
  if (max(abs(pos.x), abs(pos.z)) > OCEAN_HALF - 0.01) pos.xz = normalize(pos.xz) * OCEAN_SKIRT;
  #endif
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vec2 p = wp.xz + uFlow; // [sailing]
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

const MAX_FOAM = 8;      // nearest floating items that leave a foam collar
const FOAM_NEAR = 12, FOAM_FAR = 15; // collars fade out over this camera distance (only readable up close)
const GRID = 128;        // raft foam field: 0.5 m texels covering 64 m, centred on the origin
const TEXEL = 0.5;
const COLLAR = 1.4;      // metres of foam beyond the deck edge

const fragmentShader = /* glsl */`
uniform float uTime;
uniform vec2 uFlow; // [sailing] raft travel relative to the water (sailing-world.js)
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uZenith;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform float uFadeNear;
uniform float uFadeFar;
uniform sampler2D uRaftMask;
uniform vec4 uFoamPts[${MAX_FOAM}];
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
  // Distant water settles to a mid blue (a little sky mixed into the shallow colour, so day/night
  // carries it), with only a thin haze toward the sky colour in the last stretch to the horizon.
  vec3 farCol = mix(uShallow, uSky, 0.1);
  float haze = smoothstep(uFadeFar * 0.82, uFadeFar * 1.02, dist) * 0.55;
  // Beyond uFadeFar the fade below is exactly 1, so the pixel is the far colour: skip all shading.
  if (dist >= uFadeFar) {
    gl_FragColor = vec4(mix(farCol, uSky, haze), 1.0);
    #include <colorspace_fragment>
    return;
  }
  vec3 V = normalize(toCam);
  vec3 L = normalize(uSunDir);

  // Detail ripples fade with distance to avoid shimmering / aliasing.
  float near = 1.0 - smoothstep(8.0, 60.0, dist);
  vec2 g = vec2(0.0);
  vec2 p = vWorld.xz + mod(uFlow, 512.0); // [sailing] fine detail only; mod keeps hash noise precise
  if (dist < 60.0) { // near == 0 from 60 on, so the ripple gradient would be zeroed anyway
    ripple(normalize(vec2(0.8, 0.6)), 0.010, 2.10, 1.30, p, g);
    ripple(normalize(vec2(-0.5, 0.9)), 0.008, 2.90, 1.70, p, g);
    ripple(normalize(vec2(0.95, -0.3)), 0.006, 4.30, 2.10, p, g);
    ripple(normalize(vec2(-0.9, -0.4)), 0.004, 6.70, 2.60, p, g);
    ripple(normalize(vec2(0.2, 1.0)), 0.003, 9.10, 3.10, p, g);
    g *= near;
  }
  vec3 n = normalize(vec3(vNormalW.x - g.x, vNormalW.y, vNormalW.z - g.y));

  float ndv = max(dot(n, V), 0.0);
  float fresnel = min(0.02 + 0.98 * pow(1.0 - ndv, 5.0), 0.5);
  vec3 R = reflect(-V, n);
  vec3 skyRefl = mix(uSky, uZenith, smoothstep(0.0, 0.6, R.y));

  // Body colour: deep ocean blue in troughs, brighter blue on crests and in slow patches.
  float patches = vnoise(p * 0.045 + uTime * 0.01) * 0.6 + vnoise(p * 0.13 - uTime * 0.02) * 0.4;
  float h = clamp(vHeight / 0.2 * 0.5 + 0.5, 0.0, 1.0);
  float shallowMix = clamp(h * 0.55 + patches * 0.35 + (1.0 - ndv) * 0.15, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, shallowMix);
  // Soft subsurface glow where sunlight passes through crests.
  float sss = smoothstep(0.45, 1.0, h) * (0.5 + 0.5 * max(dot(n, L), 0.0)) * 0.35;
  body += uShallow * sss;
  body *= mix(0.75, 1.0, ndv);
  float diff = 0.7 + 0.3 * max(dot(n, L), 0.0);
  vec3 col = mix(body * diff, skyRefl, fresnel);

  // Sun highlights: sharp glint + broad sheen, clamped and faded to avoid flashing.
  vec3 H = normalize(L + V);
  float ndh = max(dot(n, H), 0.0);
  float spec = pow(ndh, 420.0) * 2.6 + pow(ndh, 60.0) * 0.28;
  spec = min(spec, 2.2) * (1.0 - smoothstep(60.0, 130.0, dist) * 0.6);
  col += uSunColor * spec;

  // Foam, near only (nothing from 45 on, so skipped there): faint soft blotches on the highest nearby
  // crests, plus contact collars around the raft edge and floating items.
  if (dist < 45.0) {
    vec2 fp = p + vec2(uTime * 0.35, uTime * 0.12);
    float n1 = vnoise(fp * 0.7);
    float n2 = vnoise(fp * 1.9 + vec2(uTime * -0.2, uTime * 0.15));
    float blot = smoothstep(0.6, 0.85, n1 * 0.65 + n2 * 0.35);
    float crest = smoothstep(0.09, 0.19, vHeight);
    float foam = blot * crest * 0.16 * (1.0 - smoothstep(12.0, 40.0, dist));
    vec2 wp = vWorld.xz; // raft mask and item collars live in world space (no sailing flow)
    // Raft collar: CPU-built falloff field, filtered by hand so it is smooth on every GPU.
    vec2 t = wp / ${TEXEL.toFixed(2)} + ${(GRID / 2 - 0.5).toFixed(1)};
    vec2 i0 = floor(t), fr = t - i0;
    i0 = (i0 + 0.5) / ${GRID.toFixed(1)};
    float k = 1.0 / ${GRID.toFixed(1)};
    float m = mix(mix(texture2D(uRaftMask, i0).r, texture2D(uRaftMask, i0 + vec2(k, 0.0)).r, fr.x),
                  mix(texture2D(uRaftMask, i0 + vec2(0.0, k)).r, texture2D(uRaftMask, i0 + vec2(k)).r, fr.x), fr.y);
    float edge = m * (0.85 + 0.15 * sin(uTime * 1.7 + wp.x * 2.0 + wp.y * 1.3));
    for (int i = 0; i < ${MAX_FOAM}; i++) {
      vec4 f = uFoamPts[i];
      if (f.z <= 0.0) break;  // live points are packed first
      vec2 dv = wp - f.xy;
      if (dot(dv, dv) >= f.z * f.z) continue;  // outside this ring: skip the sqrt and smoothsteps
      float d = length(dv) / f.z;  // thin broken ring hugging the item's waterline
      edge = max(edge, smoothstep(0.35, 0.7, d) * (1.0 - smoothstep(0.7, 1.0, d)) * 0.35 * f.w);
    }
    float cl = vnoise(fp * 1.7) * 0.6 + vnoise(fp * 4.3 - uTime * 0.25) * 0.4;
    float collar = smoothstep(1.0 - edge, 1.0 - edge * 0.55, cl) * min(1.0, edge * 1.4) * 0.85;
    col = mix(col, uFoam, max(foam, collar));
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  // Fade toward the (untonemapped) sky colour after tone mapping so the horizon matches the background.
  float fade = smoothstep(uFadeNear, uFadeFar, dist);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(farCol, uSky, haze), fade);
  #include <colorspace_fragment>
}
`;

export function createOcean(T, options = {}) {
  const size = options.size ?? 280;
  const segments = options.segments ?? 100;
  const geometry = new T.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const sun = options.sunDirection ?? new T.Vector3(-15, 28, 12);
  const maskData = new Uint8Array(GRID * GRID);
  const mask = new T.DataTexture(maskData, GRID, GRID, T.RedFormat, T.UnsignedByteType);
  const foamPts = Array.from({ length: MAX_FOAM }, () => new T.Vector4());
  const foamD2 = new Float64Array(MAX_FOAM); // squared camera distance per packed point, kept sorted
  const uniforms = {
    uTime: { value: 0 },
    uFlow: { value: new T.Vector2() }, // [sailing] wave-field offset written by sailing-world.js
    uSunDir: { value: sun.clone().normalize() },
    uSunColor: { value: new T.Color('#fff3d6') },
    uSky: { value: new T.Color(options.skyColor ?? '#a6e9f2') },
    uZenith: { value: new T.Color(options.zenith ?? '#2a8fd6') },
    uDeep: { value: new T.Color('#08355f') },
    uShallow: { value: new T.Color('#1a78b0') },
    uFoam: { value: new T.Color('#f4fbfc') },
    uFadeNear: { value: options.fadeNear ?? 52 },
    uFadeFar: { value: options.fadeFar ?? 190 },
    uRaftMask: { value: mask },
    uFoamPts: { value: foamPts },
  };

  const material = new T.ShaderMaterial({
    uniforms,
    defines: { OCEAN_HALF: (size / 2).toFixed(2), OCEAN_SKIRT: (options.skirt ?? 190).toFixed(2) },
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
  let foamGroup = null;
  const camPos = new T.Vector3(); // last camera passed to update(); collars beyond 48 m are skipped

  // Raft tiles ([x, z], 2 m squares centred on x*2, z*2) -> foam falloff around the deck edge.
  // Runs only when the raft changes; only texels near the raft are visited.
  function setRaftTiles(tiles) {
    maskData.fill(0);
    if (tiles.length) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of tiles) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const pad = 1 + COLLAR, half = GRID / 2;
      const toI = (w) => Math.max(0, Math.min(GRID - 1, Math.floor(w / TEXEL + half)));
      for (let j = toI(z0 * 2 - pad); j <= toI(z1 * 2 + pad); j++) {
        const wz = (j + 0.5 - half) * TEXEL;
        for (let i = toI(x0 * 2 - pad); i <= toI(x1 * 2 + pad); i++) {
          const wx = (i + 0.5 - half) * TEXEL;
          let d = Infinity;
          for (const [x, z] of tiles) {
            const dx = Math.max(Math.abs(wx - x * 2) - 1, 0), dz = Math.max(Math.abs(wz - z * 2) - 1, 0);
            d = Math.min(d, Math.hypot(dx, dz));
          }
          const f = 1 - d / COLLAR;
          if (f > 0) maskData[j * GRID + i] = Math.round(255 * f * f);
        }
      }
    }
    mask.needsUpdate = true;
  }
  // Children of this group (floating items) each get a foam collar, read every update.
  function trackFoam(group) { foamGroup = group; }
  function syncFoam() {
    const kids = foamGroup ? foamGroup.children : null, cam = camPos;
    let n = 0;
    // Keep the MAX_FOAM nearest within FOAM_FAR by insertion (no allocation): the shader loops only over these.
    if (kids) for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (!c.visible) continue;
      const cx = c.position.x - cam.x, cz = c.position.z - cam.z, d2 = cx * cx + cz * cz;
      if (d2 >= FOAM_FAR * FOAM_FAR || (n === MAX_FOAM && d2 >= foamD2[n - 1])) continue;
      let j = n < MAX_FOAM ? n++ : n - 1;
      const spare = foamPts[j]; // the slot that falls off (or the next free one) is reused
      for (; j > 0 && foamD2[j - 1] > d2; j--) { foamD2[j] = foamD2[j - 1]; foamPts[j] = foamPts[j - 1]; }
      const r = c.userData.foamRadius ?? 0.7, fade = 1 - Math.max(0, Math.min(1, (Math.sqrt(d2) - FOAM_NEAR) / (FOAM_FAR - FOAM_NEAR)));
      foamD2[j] = d2; foamPts[j] = spare.set(c.position.x, c.position.z, r * c.scale.x, fade);
    }
    for (let k = n; k < MAX_FOAM; k++) foamPts[k].z = 0;
  }

  function update(t, camera) {
    time = t;
    uniforms.uTime.value = t;
    if (camera) camPos.copy(camera.position);
    if (camera && options.followCamera) {
      // Snap to grid spacing so vertices never swim (waves use world coords).
      mesh.position.x = Math.round(camera.position.x / step) * step;
      mesh.position.z = Math.round(camera.position.z / step) * step;
    }
    syncFoam();
  }

  // CPU mirror of the vertex shader (inverts horizontal Gerstner shift with 2 iterations).
  // Wave params are flattened into one Float64Array (stride 5: k, dx, dz, c, dx*q*a / dz*q*a / a)
  // and sampled with indexed loops + scalar locals so per-frame calls allocate nothing.
  // Operation order matches the original object-based version exactly (bit-identical results).
  const NW = WAVES.length;
  const W = new Float64Array(NW * 6);
  WAVES.forEach(([dx, dz, a, l, q], i) => {
    const len = Math.hypot(dx, dz);
    const ndx = dx / len, ndz = dz / len;
    const k = (Math.PI * 2) / l;
    const o = i * 6;
    W[o] = k; W[o + 1] = ndx; W[o + 2] = ndz; W[o + 3] = Math.sqrt(9.8 / k) * SPEED;
    W[o + 4] = ndx * q * a; W[o + 5] = ndz * q * a;
  });
  const AMP = new Float64Array(WAVES.map((w) => w[2]));
  function getHeight(x, z, t = time) {
    const fl = uniforms.uFlow.value; x += fl.x; z += fl.y; // [sailing] match shader offset
    let px = x, pz = z;
    for (let it = 0; it < 2; it++) {
      let ox = 0, oz = 0;
      for (let i = 0, o = 0; i < NW; i++, o += 6) {
        const co = Math.cos(W[o] * (W[o + 1] * px + W[o + 2] * pz - W[o + 3] * t));
        ox += W[o + 4] * co;
        oz += W[o + 5] * co;
      }
      px = x - ox;
      pz = z - oz;
    }
    let oy = 0;
    for (let i = 0, o = 0; i < NW; i++, o += 6) {
      oy += AMP[i] * Math.sin(W[o] * (W[o + 1] * px + W[o + 2] * pz - W[o + 3] * t));
    }
    return mesh.position.y + oy;
  }
  // Approximate surface slope for tilting floating objects: returns {x, z} tilt gradient.
  // Pass `out` to reuse an object (its .x/.z are written and it is returned) instead of allocating.
  function getSlope(x, z, t = time, e = 0.6, out) {
    const sx = (getHeight(x + e, z, t) - getHeight(x - e, z, t)) / (2 * e);
    const sz = (getHeight(x, z + e, t) - getHeight(x, z - e, t)) / (2 * e);
    if (!out) return { x: sx, z: sz };
    out.x = sx; out.z = sz;
    return out;
  }
  // Combined query: sample(x, z, out?, t = now, e = 0.6) -> {h, sx, sz} where
  //   h  === getHeight(x, z, t)
  //   sx === getSlope(x, z, t, e).x,  sz === getSlope(x, z, t, e).z  (same central difference)
  // Replaces a getHeight + getSlope pair with one call; pass a reused `out` to avoid allocation.
  function sample(x, z, out, t = time, e = 0.6) {
    const r = out ?? { h: 0, sx: 0, sz: 0 };
    r.h = getHeight(x, z, t);
    r.sx = (getHeight(x + e, z, t) - getHeight(x - e, z, t)) / (2 * e);
    r.sz = (getHeight(x, z + e, t) - getHeight(x, z - e, t)) / (2 * e);
    return r;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    mask.dispose();
  }

  return { mesh, update, getHeight, getSlope, sample, setRaftTiles, trackFoam, uniforms, material, dispose };
}
