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
  vec4 wp = modelMatrix * vec4(position, 1.0);
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
const COLLAR = 1.1;      // metres of foam beyond the deck edge

const fragmentShader = /* glsl */`
uniform float uTime;
uniform vec2 uFlow; // [sailing] raft travel relative to the water (sailing-world.js)
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uFarSea; // far water colour: the sea darkens to this at the horizon, under a lighter sky
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
  // Beyond uFadeFar the fade below is exactly 1, so the pixel is pure uFarSea: skip all shading.
  if (dist >= uFadeFar) {
    gl_FragColor = vec4(uFarSea, 1.0);
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
  float fresnel = min(0.02 + 0.98 * pow(1.0 - ndv, 5.0), 0.4); // capped low: mid-distance sea keeps its own saturated blue
  vec3 R = reflect(-V, n);
  vec3 skyRefl = mix(uSky, uZenith, 0.35 + 0.65 * pow(clamp(R.y, 0.0, 1.0), 0.25)); // reflect mostly the blue sky, not the pale horizon

  // Water body: looking steeply down near the raft you see clear turquoise; grazing and far
  // away the light path is long, so it sinks to deep blue. Crests glow where sun passes through.
  float h = clamp(vHeight / 0.2 * 0.5 + 0.5, 0.0, 1.0);
  float clear = pow(ndv, 1.4) * (1.0 - smoothstep(4.0, 45.0, dist));
  float patches = vnoise(p * 0.05 + uTime * 0.01);
  vec3 body = mix(uDeep, uShallow, clamp(clear * 0.85 + h * 0.25 + patches * 0.12, 0.0, 1.0));
  float sss = smoothstep(0.5, 1.0, h) * pow(max(dot(-V, L) * 0.5 + 0.5, 0.0), 2.0) * 0.45;
  body += uShallow * sss;
  body *= mix(0.65, 1.0, ndv); // grazing water darkens toward deep blue
  vec3 col = mix(body * (0.78 + 0.22 * max(dot(n, L), 0.0)), skyRefl, fresnel);

  // Sun: sharp glint + broad sheen.
  vec3 H = normalize(L + V);
  float ndh = max(dot(n, H), 0.0);
  float spec = pow(ndh, 420.0) * 2.6 + pow(ndh, 60.0) * 0.28;
  spec = min(spec, 2.2) * (1.0 - smoothstep(60.0, 130.0, dist) * 0.6);
  col += uSunColor * spec;

  // Foam, near only (nothing from 45 on, so skipped there): faint soft foam on the nearest crests,
  // plus contact collars around the raft edge and floating items.
  if (dist < 45.0) {
    vec2 fp = p + vec2(uTime * 0.35, uTime * 0.12);
    float n1 = vnoise(fp * 0.9);
    float n2 = vnoise(fp * 2.6 + vec2(uTime * -0.2, uTime * 0.15));
    float lace = 1.0 - smoothstep(0.0, 0.06, abs(n1 * 0.7 + n2 * 0.3 - 0.5));
    float crest = smoothstep(0.06, 0.17, vHeight);
    float speck = smoothstep(0.86, 0.93, vnoise(fp * 3.7)) * smoothstep(0.0, 0.12, vHeight);
    float foam = clamp(lace * crest * 0.2 + speck * 0.12, 0.0, 0.3) * (1.0 - smoothstep(12.0, 40.0, dist));
    vec2 wp = vWorld.xz; // raft mask and item collars live in world space (no sailing flow)
    float cl = vnoise(fp * 1.7) * 0.6 + vnoise(fp * 4.3 - uTime * 0.25) * 0.4; // drifting breakup for every collar
    // Raft collar: CPU-built falloff field, filtered by hand so it is smooth on every GPU.
    vec2 t = wp / ${TEXEL.toFixed(2)} + ${(GRID / 2 - 0.5).toFixed(1)};
    vec2 i0 = floor(t), fr = t - i0;
    i0 = (i0 + 0.5) / ${GRID.toFixed(1)};
    float k = 1.0 / ${GRID.toFixed(1)};
    vec2 m = mix(mix(texture2D(uRaftMask, i0).rg, texture2D(uRaftMask, i0 + vec2(k, 0.0)).rg, fr.x),
                 mix(texture2D(uRaftMask, i0 + vec2(0.0, k)).rg, texture2D(uRaftMask, i0 + vec2(k)).rg, fr.x), fr.y);
    // G: shade under and just around the deck. Water seen through the board gaps stays dark navy.
    float under = m.y;
    col *= mix(1.0, 0.35, under);
    foam *= 1.0 - under;
    // R: raft collar, a thin broken line hugging the outside of the deck edge (none underneath).
    float re = m.x * (0.85 + 0.15 * sin(uTime * 1.7 + wp.x * 2.0 + wp.y * 1.3));
    float lacy = cl * 0.7 + vnoise(fp * 9.0 + uTime * 0.3) * 0.3;
    float collar = smoothstep(0.9 - re * 0.45, 0.98 - re * 0.45, lacy) * min(1.0, re * 1.6) * 0.6;
    collar *= 1.0 - smoothstep(0.55, 0.85, under);
    float ring = 0.0;
    // Foam points live within FOAM_FAR (15 m) of the camera, rings are under 1 m: skip the loop beyond.
    if (dist < ${(FOAM_FAR + 2).toFixed(1)}) for (int i = 0; i < ${MAX_FOAM}; i++) {
      vec4 f = uFoamPts[i];
      if (f.z <= 0.0) break;  // live points are packed first
      vec2 dv = wp - f.xy;
      if (dot(dv, dv) >= f.z * f.z) continue;  // outside this ring: skip the sqrt and smoothsteps
      float d = length(dv) / f.z + (cl - 0.5) * 0.3;  // noise-warped radius: wobbly ring at the waterline
      ring = max(ring, smoothstep(0.25, 0.6, d) * (1.0 - smoothstep(0.6, 1.0, d)) * f.w);
    }
    // Items: a faint ring broken up by the same noise.
    collar = max(collar, ring * smoothstep(0.3, 0.75, cl) * 0.4);
    col = mix(col, uFoam, max(foam, collar));
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  // Fade toward the (untonemapped) far-sea colour after tone mapping: a darker sea meets the sky at a crisp horizon.
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFarSea, smoothstep(uFadeNear, uFadeFar, dist));
  #include <colorspace_fragment>
}
`;

// Symmetric axis coordinates: `step` spacing for |v| <= inner, then spacings growing by `grow`
// (rescaled so the last line lands exactly on `half`).
function lodAxis(half, inner, step, grow) {
  const n0 = Math.round(inner / step), rest = half - n0 * step;
  const outer = [];
  for (let s = step * grow, sum = 0; ; s *= grow) {
    if (sum + s / 2 > rest) break; // stop at the count whose total is nearest `rest`
    outer.push(s); sum += s;
  }
  const k = rest / outer.reduce((a, b) => a + b, 0);
  const pos = [];
  for (let i = 0; i <= n0; i++) pos.push(i * step);
  let v = n0 * step;
  for (const s of outer) { v += s * k; pos.push(v); }
  pos[pos.length - 1] = half;
  return [...pos.slice(1).reverse().map((x) => -x), ...pos];
}
// Flat XZ grid (normal +y, upward-facing) from one coordinate list used for both axes.
// Same vertex/uv layout as a PlaneGeometry rotated -90 degrees about X.
function gridGeometry(T, axis, size) {
  const n = axis.length, half = size / 2;
  const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
  for (let j = 0, v = 0; j < n; j++) for (let i = 0; i < n; i++, v++) {
    pos[v * 3] = axis[i]; pos[v * 3 + 2] = axis[j]; nor[v * 3 + 1] = 1;
    uv[v * 2] = (axis[i] + half) / size; uv[v * 2 + 1] = (half - axis[j]) / size;
  }
  const idx = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + n, c = b + 1, d = a + 1;
    idx.push(a, b, d, b, c, d);
  }
  const g = new T.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.BufferAttribute(nor, 3));
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  return g;
}

export function createOcean(T, options = {}) {
  const size = options.size ?? 280;
  // Uniform 2.8 m cells only where the sea is seen up close; beyond the inner square the
  // spacing grows ~1.25x per step out to the edge (same x and z coordinates, so no T-junctions).
  // `segments` forces a uniform grid (tests).
  const step = options.segments ? size / options.segments : (options.step ?? 2.8);
  const axis = options.segments
    ? Array.from({ length: options.segments + 1 }, (_, i) => -size / 2 + i * step)
    : lodAxis(size / 2, options.inner ?? 28, step, options.grow ?? 1.25);
  const geometry = gridGeometry(T, axis, size);

  const sun = options.sunDirection ?? new T.Vector3(-15, 28, 12);
  const maskData = new Uint8Array(GRID * GRID * 2); // RG: collar foam, depth under the deck
  const mask = new T.DataTexture(maskData, GRID, GRID, T.RGFormat, T.UnsignedByteType);
  const foamPts = Array.from({ length: MAX_FOAM }, () => new T.Vector4());
  const foamD2 = new Float64Array(MAX_FOAM); // squared camera distance per packed point, kept sorted
  const uniforms = {
    uTime: { value: 0 },
    uFlow: { value: new T.Vector2() }, // [sailing] wave-field offset written by sailing-world.js
    uSunDir: { value: sun.clone().normalize() },
    uSunColor: { value: new T.Color('#fff3d6') },
    uSky: { value: new T.Color(options.skyColor ?? '#86dcef') },
    uFarSea: { value: new T.Color(options.farSeaColor ?? '#3d97c8') },
    uZenith: { value: new T.Color(options.zenith ?? '#2a8fd6') },
    uDeep: { value: new T.Color('#08355f') },
    uShallow: { value: new T.Color('#1a78b0') },
    uFoam: { value: new T.Color('#eef8f6') },
    uFadeNear: { value: options.fadeNear ?? 75 },
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

  let time = 0;
  let foamGroup = null;
  const camPos = new T.Vector3(); // last camera passed to update(); collars beyond 48 m are skipped

  // Raft tiles ([x, z], 2 m squares centred on x*2, z*2) -> signed distance to the deck edge
  // (negative under the deck). R: foam collar, a thin band hugging the edge outside the raft.
  // G: depth under the deck, used as a cheap contact shadow so board gaps show dark water.
  // Runs only when the raft changes; only texels near the raft are visited.
  function setRaftTiles(tiles) {
    maskData.fill(0);
    if (tiles.length) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      const set = new Set();
      for (const [x, z] of tiles) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
        set.add(x + ',' + z);
      }
      const has = (x, z) => set.has(x + ',' + z);
      const pad = 1 + COLLAR, half = GRID / 2;
      const toI = (w) => Math.max(0, Math.min(GRID - 1, Math.floor(w / TEXEL + half)));
      for (let j = toI(z0 * 2 - pad); j <= toI(z1 * 2 + pad); j++) {
        const wz = (j + 0.5 - half) * TEXEL;
        for (let i = toI(x0 * 2 - pad); i <= toI(x1 * 2 + pad); i++) {
          const wx = (i + 0.5 - half) * TEXEL;
          const tx = Math.round(wx / 2), tz = Math.round(wz / 2);
          let d;
          if (has(tx, tz)) {
            // Inside: distance to the nearest tile edge that is not shared with a neighbour.
            const lx = wx - tx * 2, lz = wz - tz * 2;
            d = Infinity;
            if (!has(tx - 1, tz)) d = Math.min(d, lx + 1);
            if (!has(tx + 1, tz)) d = Math.min(d, 1 - lx);
            if (!has(tx, tz - 1)) d = Math.min(d, lz + 1);
            if (!has(tx, tz + 1)) d = Math.min(d, 1 - lz);
            d = -Math.min(d, 2);
          } else {
            d = Infinity;
            for (const [x, z] of tiles) {
              const dx = Math.max(Math.abs(wx - x * 2) - 1, 0), dz = Math.max(Math.abs(wz - z * 2) - 1, 0);
              d = Math.min(d, Math.hypot(dx, dz));
            }
          }
          const o = (j * GRID + i) * 2;
          const f = 1 - d / COLLAR;
          if (d > 0 && f > 0) maskData[o] = Math.round(255 * f);
          // Shade: full from 0.3 m under the deck, fading out 0.25 m beyond the edge.
          maskData[o + 1] = Math.round(255 * Math.max(0, Math.min(1, (0.25 - d) / 0.55)));
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
