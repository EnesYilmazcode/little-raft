// Procedural Gerstner ocean for Little Raft (THREE r170, ShaderMaterial, no textures).
// Usage:
//   import { createOcean } from './ocean.js?build=v3-survival-ae77fa84ac2b';
//   const ocean = createOcean(T);            // T = THREE namespace
//   scene.add(ocean.mesh);
//   ocean.update(timeSeconds);               // each frame (optionally ocean.update(t, camera))
//   ocean.getHeight(x, z)                    // CPU wave height (world y) for bobbing items/raft
//   ocean.getSlope(x, z, t?, e?, out?)       // {x, z} gradient (shared object unless `out` is given)
//   ocean.sample(x, z, out?, t?, e?)         // {h, sx, sz}: getHeight + getSlope in one call

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

const MAX_FOAM = 32;     // floating items that leave a foam collar
const GRID = 128;        // raft foam field: 0.5 m texels covering 64 m, centred on the origin
const TEXEL = 0.5;
const COLLAR = 1.4;      // metres of foam beyond the deck edge

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
  vec3 V = normalize(toCam);
  vec3 L = normalize(uSunDir);
  vec2 p = vWorld.xz;

  // Detail ripples fade with distance to avoid shimmering.
  vec2 g = vec2(0.0);
  ripple(vec2(0.8, 0.6), 0.012, 2.10, 1.30, p, g);
  ripple(vec2(-0.48564, 0.87416), 0.009, 2.90, 1.70, p, g);
  ripple(vec2(0.95448, -0.29827), 0.007, 4.30, 2.10, p, g);
  ripple(vec2(-0.91192, -0.41036), 0.005, 6.70, 2.60, p, g);
  ripple(vec2(0.19612, 0.98058), 0.0035, 9.10, 3.10, p, g);
  g *= 1.0 - smoothstep(8.0, 60.0, dist);
  vec3 n = normalize(vec3(vNormalW.x - g.x, vNormalW.y, vNormalW.z - g.y));

  float ndv = max(dot(n, V), 0.0);
  float fresnel = min(0.02 + 0.98 * pow(1.0 - ndv, 5.0), 0.45);
  vec3 R = reflect(-V, n);
  vec3 skyRefl = mix(uSky, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.25));

  // Water body: looking steeply down near the raft you see clear turquoise; grazing and far
  // away the light path is long, so it sinks to deep blue. Crests glow where sun passes through.
  float h = clamp(vHeight / 0.2 * 0.5 + 0.5, 0.0, 1.0);
  float clear = pow(ndv, 1.4) * (1.0 - smoothstep(4.0, 45.0, dist));
  float patches = vnoise(p * 0.05 + uTime * 0.01);
  vec3 body = mix(uDeep, uShallow, clamp(clear * 0.85 + h * 0.25 + patches * 0.12, 0.0, 1.0));
  float sss = smoothstep(0.5, 1.0, h) * pow(max(dot(-V, L) * 0.5 + 0.5, 0.0), 2.0) * 0.45;
  body += uShallow * sss;
  vec3 col = mix(body * (0.78 + 0.22 * max(dot(n, L), 0.0)), skyRefl, fresnel);

  // Sun: sharp glint + broad sheen.
  vec3 H = normalize(L + V);
  float ndh = max(dot(n, H), 0.0);
  float spec = min(pow(ndh, 300.0) * 2.0 + pow(ndh, 40.0) * 0.12, 1.6);
  col += uSunColor * spec * (1.0 - smoothstep(40.0, 120.0, dist) * 0.6);

  // Foam: one lace pattern, revealed by crests, the raft edge and floating items.
  vec2 fp = p + vec2(uTime * 0.3, uTime * 0.1);
  float lace = vnoise(fp * 1.7) * 0.6 + vnoise(fp * 4.3 - uTime * 0.25) * 0.4;
  float crest = smoothstep(0.12, 0.21, vHeight) * 0.45 * (1.0 - smoothstep(12.0, 40.0, dist));
  float edge = 0.0;
  if (dist < 45.0) {
    // Raft collar: CPU-built falloff field, filtered by hand so it is smooth on every GPU.
    vec2 t = p / ${TEXEL.toFixed(2)} + ${(GRID / 2 - 0.5).toFixed(1)};
    vec2 i0 = floor(t), fr = t - i0;
    i0 = (i0 + 0.5) / ${GRID.toFixed(1)};
    float k = 1.0 / ${GRID.toFixed(1)};
    float m = mix(mix(texture2D(uRaftMask, i0).r, texture2D(uRaftMask, i0 + vec2(k, 0.0)).r, fr.x),
                  mix(texture2D(uRaftMask, i0 + vec2(0.0, k)).r, texture2D(uRaftMask, i0 + vec2(k)).r, fr.x), fr.y);
    edge = m * (0.85 + 0.15 * sin(uTime * 1.7 + p.x * 2.0 + p.y * 1.3));
    for (int i = 0; i < ${MAX_FOAM}; i++) {
      vec4 f = uFoamPts[i];
      if (f.z <= 0.0) break;  // live points are packed first
      float d = length(p - f.xy) / f.z;  // thin broken ring hugging the item's waterline
      edge = max(edge, smoothstep(0.35, 0.7, d) * (1.0 - smoothstep(0.7, 1.0, d)) * 0.35);
    }
  }
  float amount = max(crest, edge);
  float foam = smoothstep(1.0 - amount, 1.0 - amount * 0.55, lace) * min(1.0, amount * 1.4);
  foam *= 1.0 - smoothstep(30.0, 90.0, dist);
  col = mix(col, uFoam, foam * 0.85);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  // Fade toward the (untonemapped) sky colour after tone mapping so the horizon matches the background.
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uSky, smoothstep(uFadeNear, uFadeFar, dist));
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
  const uniforms = {
    uTime: { value: 0 },
    uCamera: { value: new T.Vector3() },
    uSunDir: { value: sun.clone().normalize() },
    uSunColor: { value: new T.Color('#fff3d6') },
    uSky: { value: new T.Color(options.skyColor ?? '#c4dfeb') },
    uZenith: { value: new T.Color(options.zenith ?? '#5aa3dc') },
    uDeep: { value: new T.Color('#0d4670') },
    uShallow: { value: new T.Color('#1a8f94') },
    uFoam: { value: new T.Color('#f4fbfb') },
    uFadeNear: { value: options.fadeNear ?? 52 },
    uFadeFar: { value: options.fadeFar ?? 135 },
    uRaftMask: { value: mask },
    uFoamPts: { value: foamPts },
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
  let foamGroup = null;

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
    const kids = foamGroup ? foamGroup.children : null, cam = uniforms.uCamera.value;
    let n = 0;
    if (kids) for (let i = 0; i < kids.length && n < MAX_FOAM; i++) {
      const c = kids[i];
      if (!c.visible) continue;
      const cx = c.position.x - cam.x, cz = c.position.z - cam.z;
      if (cx * cx + cz * cz > 2304) continue; // the shader only draws collars within 45 m
      const r = c.userData.foamRadius ?? 0.7;
      foamPts[n++].set(c.position.x, c.position.z, r * c.scale.x, 0);
    }
    for (; n < MAX_FOAM; n++) foamPts[n].z = 0;
  }

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
    syncFoam();
  }

  // CPU mirror of the vertex shader (inverts horizontal Gerstner shift with 2 iterations).
  // Wave params are flattened into one Float64Array (stride 6: k, dx, dz, c, dx*q*a, dz*q*a; plus
  // AMP) and sampled with indexed loops on scalar locals, so per-frame calls allocate nothing.
  // Operation order matches the old object-based version, so results are bit-identical.
  const NW = WAVES.length;
  const W = new Float64Array(NW * 6);
  const AMP = new Float64Array(NW);
  WAVES.forEach(([dx, dz, a, l, q], i) => {
    const len = Math.hypot(dx, dz);
    const ndx = dx / len, ndz = dz / len;
    const k = (Math.PI * 2) / l;
    const o = i * 6;
    W[o] = k; W[o + 1] = ndx; W[o + 2] = ndz; W[o + 3] = Math.sqrt(9.8 / k) * SPEED;
    W[o + 4] = ndx * q * a; W[o + 5] = ndz * q * a;
    AMP[i] = a;
  });
  // Inputs and results go through Float64Arrays (raw doubles) rather than arguments/returns, so
  // the shared kernel never boxes numbers whether or not V8 decides to inline it.
  // Sample points: 0 = (x, z), 1 = (x+e, z), 2 = (x-e, z), 3 = (x, z+e), 4 = (x, z-e).
  const IN = new Float64Array(4);  // x, z, t, e
  const HS = new Float64Array(5);  // world height at each sample point
  function heights(from, to) {
    const x0 = IN[0], z0 = IN[1], t = IN[2], e = IN[3], base = mesh.position.y;
    for (let s = from; s < to; s++) {
      const x = s === 1 ? x0 + e : s === 2 ? x0 - e : x0;
      const z = s === 3 ? z0 + e : s === 4 ? z0 - e : z0;
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
      HS[s] = base + oy;
    }
  }
  function getHeight(x, z, t = time) {
    IN[0] = x; IN[1] = z; IN[2] = t;
    heights(0, 1);
    return HS[0];
  }
  // Approximate surface slope for tilting floating objects: returns {x, z} tilt gradient.
  // Without `out` the returned object is shared between calls (read it before calling again);
  // with `out` its .x/.z are written and `out` is returned.
  const slope = { x: 0, z: 0 };
  function getSlope(x, z, t = time, e = 0.6, out = slope) {
    IN[0] = x; IN[1] = z; IN[2] = t; IN[3] = e;
    heights(1, 5);
    out.x = (HS[1] - HS[2]) / (2 * e);
    out.z = (HS[3] - HS[4]) / (2 * e);
    return out;
  }
  // Combined query: sample(x, z, out?, t = now, e = 0.6) -> {h, sx, sz} where
  //   h === getHeight(x, z, t), sx/sz === getSlope(x, z, t, e).x/.z (same central difference).
  // Replaces a getHeight + getSlope pair with one call. Without `out` a shared object is returned.
  const sampled = { h: 0, sx: 0, sz: 0 };
  function sample(x, z, out = sampled, t = time, e = 0.6) {
    IN[0] = x; IN[1] = z; IN[2] = t; IN[3] = e;
    heights(0, 5);
    out.h = HS[0];
    out.sx = (HS[1] - HS[2]) / (2 * e);
    out.sz = (HS[3] - HS[4]) / (2 * e);
    return out;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    mask.dispose();
  }

  return { mesh, update, getHeight, getSlope, sample, setRaftTiles, trackFoam, uniforms, material, dispose };
}
