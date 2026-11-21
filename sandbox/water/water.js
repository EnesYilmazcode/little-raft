// Little Raft ocean (see docs/tech/water.md). Same Gerstner wave set, speed and base height as the
// shipping dist/ocean.js, so getHeight/getSlope are bit-identical (sandbox/water/parity.mjs).
//   tier 'a' (ship this) single pass: crest lace from the Gerstner Jacobian (vertex shader), sky/sun
//            fresnel reflection, twinkling glitter sun path, crest subsurface tint, lacy contact foam + fake
//            deck shadow + under-deck occlusion from a CPU-baked raft distance field, capsule foam around
//            floaters (shaped by each item's size and heading), ripple rings around the hook bobber.
//   tier 'b' a + half-res opaque prepass (colour + depth): intersection foam around any mesh, refraction,
//            depth absorption. Costs ~2x a frame for almost no visible change in this game (see doc).
//   tier 'c' b + quarter-res planar reflection. Same verdict.
// API = dist/ocean.js { mesh, update(t, camera), getHeight, getSlope, uniforms, material, dispose }
//   + setRaft(tiles, x, z, yaw), setRaftPose(x, z, yaw), setFloaters([[x, z, r, hx?, hz?], ...], camX, camZ),
//   + footprint(object3d) -> [x, z, r, hx, hz] capsule for setFloaters, setBobber(position | null),
//   + setAmp(a) (GPU waves + CPU getHeight together), render(renderer, scene, camera) (tiers b/c only).
//   createOcean() = tier 'a' drop-in.
// Cost notes (SwiftShader, where the fragment shader dominates): work that only matters near the raft or an
// item is skipped per pixel with gates computed in the vertex shader (raft SDF and capsule distance at the
// vertex, conservative by one grid diagonal); the foam noise and glitter only run where some foam mask or the
// tight sun lobe is non-zero; the slow body-colour noise runs per vertex; pixels past uFadeFar are sky.

const WAVES = [
  [1.0, 0.35, 0.10, 31.0, 0.50],
  [0.7, 0.90, 0.065, 19.0, 0.60],
  [-0.45, 1.0, 0.05, 12.5, 0.60],
  [0.95, -0.55, 0.04, 9.2, 0.50],
];
const SPEED = 0.6;
const BASE_Y = -0.24;
const SDF_RES = 128;      // texels per side; the covered square fits the raft's bounding box + SDF_MAX margin
const SDF_MAX = 8;        // distance encoded in [-2, SDF_MAX] metres
const MAX_FLOATERS = 16;
const RAFT_REACH = 1.1;   // furthest raft effect (lace rings); shadow and occlusion stay inside it
const FLOAT_REACH = 0.55; // furthest item lace

const f5 = (v) => v.toFixed(5);
const glslWaves = WAVES.map(([dx, dz, a, l, q]) => {
  const n = Math.hypot(dx, dz);
  return `wave(vec2(${f5(dx / n)}, ${f5(dz / n)}), ${f5(a)} * uAmp, ${f5(l)}, ${f5(q)}, p, disp, tng, bin);`;
}).join('\n  ');

const common = /* glsl */`
uniform float uTime;
uniform float uAmp;
uniform sampler2D tRaftSdf;
uniform vec4 uRaft;          // x, z, cos(yaw), sin(yaw)
uniform vec3 uSdfBox;        // raft-local centre x, z and side length (m) of the baked square
uniform vec4 uFloatA[${MAX_FLOATERS}];   // x, z, half-axis x, half-axis z (capsule segment)
uniform vec3 uFloatB[${MAX_FLOATERS}];   // half-axis / |half-axis|^2 (x, z), radius
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), u.x), u.y);
}
// Signed distance (metres) to the raft footprint, from the CPU-baked texture.
float raftDist(vec2 world) {
  vec2 l = world - uRaft.xy;
  l = vec2(uRaft.z * l.x - uRaft.w * l.y, uRaft.w * l.x + uRaft.z * l.y);
  vec2 uv = (l - uSdfBox.xy) / uSdfBox.z + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return ${SDF_MAX.toFixed(1)};
  return texture2D(tRaftSdf, uv).r * ${(SDF_MAX + 2).toFixed(1)} - 2.0;
}
// Distance to floater i's capsule (a circle when the half-axis is zero). Unused slots sit 1e4 m away.
float floatDist(int i, vec2 p) {
  vec2 pa = p - uFloatA[i].xy;
  float t = clamp(dot(pa, uFloatB[i].xy), -1.0, 1.0);
  return length(pa - uFloatA[i].zw * t) - uFloatB[i].z;
}
`;

const vertexShader = /* glsl */`
${common}
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vHeight;
varying float vViewZ;
varying float vPinch;
varying float vPatch;
varying vec2 vGate;          // raft SDF and nearest capsule distance at the vertex (cheap per-pixel early-outs)

// Also accumulates jac = (dDx/dx, dDz/dz, dDx/dz) of the horizontal displacement for crest foam (free: reuses sin).
vec3 jac = vec3(0.0);
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
  jac += vec3(-d.x * d.x, -d.y * d.y, -d.x * d.y) * (kqa * s);
}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p = wp.xz;
  vec3 disp = vec3(0.0);
  vec3 tng = vec3(1.0, 0.0, 0.0), bin = vec3(0.0, 0.0, 1.0);
  ${glslWaves}
  wp.xyz += disp;
  vWorld = wp.xyz;
  vHeight = disp.y;
  vNormalW = normalize(cross(bin, tng));
  vPinch = 1.0 - ((1.0 + jac.x) * (1.0 + jac.y) - jac.z * jac.z);   // 1 - Jacobian: > 0 where crests bunch up
  // Slow body-colour patches (7-22 m features) are smooth enough to interpolate across the 2.8 m grid.
  vPatch = vnoise(wp.xz * 0.045 + uTime * 0.01) * 0.6 + vnoise(wp.xz * 0.13 - uTime * 0.02) * 0.4;
  float fd = 1e4;
  for (int i = 0; i < ${MAX_FLOATERS}; i++) fd = min(fd, floatDist(i, wp.xz));
  vGate = vec2(raftDist(wp.xz), fd);
  vec4 mv = viewMatrix * wp;
  vViewZ = mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */`
#include <packing>
${common}
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uZenith;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform float uFadeNear;
uniform float uFadeFar;
uniform float uFoamStart;    // 1 - J where crest foam begins (absolute, so calm seas stay clean)
uniform int uDebug;          // 1 planar refl, 2 water thickness, 3 crest pinch, 4 raft sdf
uniform float uDeckLift;     // deck height above water for the fake shadow
uniform vec4 uBobber;        // x, z, on (0/1), time it touched the water
#ifdef USE_PREPASS
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
#endif
#ifdef USE_REFLECTION
uniform sampler2D tReflect;
uniform mat4 uReflectMatrix;
#endif
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vHeight;
varying float vViewZ;
varying float vPinch;
varying float vPatch;
varying vec2 vGate;

void ripple(vec2 d, float a, float k, float w, vec2 p, inout vec2 g) { g += d * (a * k * cos(k * dot(d, p) - w * uTime)); }

// Glitter: one random point per ~11 cm cell, each with its own flash cycle (quick on, slower off, then dark),
// so the sun path twinkles point by point instead of showing a fixed pattern. One hash per pixel.
float glitter(vec2 p) {
  vec2 q = p * 9.0 + vec2(uTime * 0.55, uTime * 0.2);
  vec2 ci = floor(q), cf = fract(q) - 0.5;
  float r = hash(ci);
  vec2 o = (vec2(r, fract(r * 37.13)) - 0.5) * 0.45;
  float life = fract(uTime * (0.6 + 0.8 * r) + r * 11.0);
  float flash = smoothstep(0.0, 0.07, life) * (1.0 - smoothstep(0.07, 0.45, life));
  return (1.0 - smoothstep(0.08, 0.34, length(cf - o))) * flash * 5.0;
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam.xz);
  if (dist > uFadeFar && uDebug == 0) {   // fully faded: same result as the fade at the end, minus all the work
    gl_FragColor = vec4(uSky, 1.0);
    #include <colorspace_fragment>
    return;
  }
  vec3 V = normalize(toCam);
  vec3 L = normalize(uSunDir);
  vec2 p = vWorld.xz;

  vec2 g = vec2(0.0);
  if (dist < 60.0) {
    ripple(normalize(vec2(0.8, 0.6)), 0.010, 2.10, 1.30, p, g);
    ripple(normalize(vec2(-0.5, 0.9)), 0.008, 2.90, 1.70, p, g);
    ripple(normalize(vec2(0.95, -0.3)), 0.006, 4.30, 2.10, p, g);
    ripple(normalize(vec2(-0.9, -0.4)), 0.004, 6.70, 2.60, p, g);
    ripple(normalize(vec2(0.2, 1.0)), 0.003, 9.10, 3.10, p, g);
    g *= 1.0 - smoothstep(8.0, 60.0, dist);
  }
  vec3 n = normalize(vec3(vNormalW.x - g.x, vNormalW.y, vNormalW.z - g.y));

  float ndv = max(dot(n, V), 0.0);
  float fr = 1.0 - ndv, fr2 = fr * fr;
  float fresnel = min(0.02 + 0.98 * fr2 * fr2 * fr, 0.75);

  // Reflection: analytic sky gradient + sun, optionally replaced by the planar pass.
  vec3 R = reflect(-V, n);
  vec3 refl = mix(uSky, uZenith, smoothstep(0.0, 0.6, R.y));
#ifdef USE_REFLECTION
  vec4 rc = uReflectMatrix * vec4(vWorld, 1.0);
  vec2 ruv = rc.xy / rc.w + n.xz * 0.06 * (1.0 - smoothstep(8.0, 60.0, dist));
  vec4 planar = texture2D(tReflect, clamp(ruv, 0.001, 0.999));
  refl = mix(refl, planar.rgb, planar.a);
#endif

  // Body colour + Sea of Thieves style subsurface: crest mask x view-against-sun x grazing view.
  float h = clamp(vHeight / 0.2 * 0.5 + 0.5, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, clamp(h * 0.5 + vPatch * 0.3, 0.0, 1.0));
  float bl = clamp(dot(normalize(vec3(-V.x, 0.0, -V.z)), normalize(vec3(L.x, 0.0, L.z))), 0.0, 1.0);
  float sssMask = smoothstep(0.35, 1.0, h) * (0.35 + 0.65 * bl * bl * bl) * (1.0 - ndv * 0.6);
  body += uShallow * sssMask * 0.55;
  body *= 0.75 + 0.25 * max(dot(n, L), 0.0);

  // Raft: SDF, fake deck shadow (SDF sampled toward the sun at deck height). Skipped where the vertex says far.
  float rd = ${SDF_MAX.toFixed(1)}, shadow = 1.0;
  if (vGate.x < ${RAFT_REACH.toFixed(2)} + GATE_SLACK) {
    rd = raftDist(p);
    float sd = raftDist(p + L.xz / max(L.y, 0.2) * uDeckLift);
    shadow = 1.0 - (1.0 - smoothstep(-0.15, 0.35, sd)) * 0.45;
  }

#ifdef USE_PREPASS
  vec2 suv = gl_FragCoord.xy / uResolution;
  float sceneZ = perspectiveDepthToViewZ(texture2D(tDepth, suv).x, uNear, uFar);
  float thick = max(vViewZ - sceneZ, 0.0);           // metres of water in front of the scene
  vec2 off = n.xz * 0.025 * clamp(thick, 0.0, 1.0) * (1.0 - smoothstep(8.0, 60.0, dist));
  float offZ = perspectiveDepthToViewZ(texture2D(tDepth, suv + off).x, uNear, uFar);
  if (offZ > vViewZ) off = vec2(0.0);                 // offset landed above water: no refraction
  vec3 under = texture2D(tScene, suv + off).rgb;
  vec3 trans = exp(-thick * vec3(0.9, 0.28, 0.22));    // red dies first
  body = mix(body, under * mix(uShallow * 1.6, vec3(1.0), 0.35), trans * 0.85);
  float contact = 1.0 - smoothstep(0.0, 0.32, thick);
#else
  float contact = 0.0;
#endif

  vec3 col = mix(body, refl, fresnel) * shadow;

  // Sun: soft sheen that draws the sun path, plus a tight lobe broken into twinkling points. The glitter only
  // runs where the tight lobe is visible at all (pow(.985, 700) ~ 3e-5).
  vec3 H = normalize(L + V);
  float ndh = max(dot(n, H), 0.0);
  float spec = pow(ndh, 70.0) * 0.10;
  if (ndh > 0.985) {
    float far = smoothstep(14.0, 55.0, dist);
    float sparkle = far < 1.0 ? mix(glitter(p), 0.6, far) : 0.6;
    spec += pow(ndh, 700.0) * sparkle;
  }
  col += uSunColor * min(spec, 1.2) * shadow * (1.0 - smoothstep(60.0, 125.0, dist) * 0.6);

  // Foam masks (cheap): where lace may go and how wide it gets.
  // 1: crests where the Gerstner map compresses (1 - J), plus the very top of tall crests.
  float crestMask = clamp((vPinch - uFoamStart) * 7.0 + smoothstep(0.09, 0.2, vHeight / uAmp) * 0.35, 0.0, 1.0);
  // 2: raft wake rings that pulse outward and fade by ~1.1 m (the ragged collar on the logs is added below).
  float raftLace = 0.0;
  if (rd < ${RAFT_REACH.toFixed(2)}) raftLace = (1.0 - smoothstep(0.0, ${RAFT_REACH.toFixed(2)}, rd)) * (0.35 + 0.65 * (0.5 + 0.5 * sin(rd * 5.0 - uTime * 1.8 + vPatch * 6.0)));
  // 3: items, as capsules shaped by their footprint.
  float floatLace = 0.0;
  if (vGate.y < ${FLOAT_REACH.toFixed(2)} + GATE_SLACK) {
    float fd = 1e4;
    for (int i = 0; i < ${MAX_FLOATERS}; i++) fd = min(fd, floatDist(i, p));
    floatLace = 1.0 - smoothstep(-0.1, ${FLOAT_REACH.toFixed(2)}, fd);
  }
  // 4: hook bobber: a tight collar, bobbing ripple rings, and one splash ring when it lands.
  float bobLace = 0.0, bobCore = 0.0;
  float bd = length(p - uBobber.xy);
  if (uBobber.z > 0.0 && bd < 2.2) {
    float age = uTime - uBobber.w;
    float rings = 0.5 + 0.5 * sin(bd * 16.0 - uTime * 5.0);
    bobLace = (1.0 - smoothstep(0.05, 0.75, bd)) * (0.25 + 0.75 * rings);
    bobLace = max(bobLace, (1.0 - smoothstep(0.0, 0.07, abs(bd - 0.15 - age * 1.1))) * (1.0 - smoothstep(0.2, 1.6, age)));
    bobCore = 1.0 - smoothstep(0.1, 0.16, bd);
  }
  float laceMask = max(max(raftLace, floatLace * 0.8), max(bobLace, contact));

  // Lace: thin contour lines of a two-octave noise (scrolled with the swell) that widen as the mask grows.
  // Coverage is anti-aliased by the noise's screen footprint, so far-away lines thin out instead of sparkling.
  // The noise only runs where some mask is on, which is a small part of the screen on a calm sea.
  vec2 dp = fwidth(p);                   // in uniform control flow (derivatives inside the branch are undefined)
  float foam = 0.0;
  if (laceMask > 0.02 || crestMask > 0.0 || rd < 0.3 || bobCore > 0.0) {
    vec2 fp = p + vec2(uTime * 0.35, uTime * 0.12);
    float n1 = vnoise(fp * 2.1), n2 = vnoise(fp * 4.6 + vec2(uTime * -0.2, uTime * 0.15));
    float iso = abs(n1 * 0.6 + n2 * 0.4 - 0.5), isoAA = (dp.x + dp.y) * 0.8 + 1e-4;
    float crest = clamp((0.012 + crestMask * 0.09 - iso) / isoAA + 0.5, 0.0, 1.0) * smoothstep(0.0, 0.08, crestMask);
    float lace = clamp((0.003 + laceMask * 0.017 - iso) / isoAA + 0.5, 0.0, 1.0) * step(0.02, laceMask);
    float raftCore = 1.0 - smoothstep(0.0, 0.05 + 0.1 * n1, rd);   // thin ragged collar where logs meet water
    foam = max(max(crest * 0.85, lace * 0.66), max(raftCore * 0.85, bobCore * 0.8));
    foam *= (1.0 - smoothstep(30.0, 90.0, dist)) * smoothstep(-0.7, -0.3, rd);   // none deep under the deck (plank gaps)
  }
  col *= mix(0.55, 1.0, smoothstep(-1.2, 0.1, rd));                               // occluded water under the raft
  col = mix(col, uFoam * (0.8 + 0.2 * shadow), foam);

  gl_FragColor = vec4(col, 1.0);
  if (uDebug == 3) gl_FragColor = vec4(vec3(clamp(vPinch * 8.0, 0.0, 1.0)), 1.0);
  if (uDebug == 4) gl_FragColor = vec4(vec3(clamp(raftDist(p) / 4.0, 0.0, 1.0)), 1.0);
  if (uDebug == 5) gl_FragColor = vec4(step(0.02, laceMask) + step(0.0001, crestMask), step(${RAFT_REACH.toFixed(2)} + GATE_SLACK, vGate.x), step(${FLOAT_REACH.toFixed(2)} + GATE_SLACK, vGate.y), 1.0);
#ifdef USE_PREPASS
  if (uDebug == 2) gl_FragColor = vec4(vec3(clamp(thick / 3.0, 0.0, 1.0)), 1.0);
#endif
#ifdef USE_REFLECTION
  if (uDebug == 1) gl_FragColor = vec4(planar.rgb * planar.a, 1.0);
#endif
  if (uDebug > 0) return;
  #include <tonemapping_fragment>
  float fade = smoothstep(uFadeNear, uFadeFar, dist);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uSky, fade);
  #include <colorspace_fragment>
}
`;

export function createWater(T, options = {}) {
  const tier = options.tier ?? 'a';
  const size = options.size ?? 280;
  const segments = options.segments ?? 100;
  const geometry = new T.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const sdfData = new Uint8Array(SDF_RES * SDF_RES), sdfDist = new Float32Array(SDF_RES * SDF_RES);
  const sdfTex = new T.DataTexture(sdfData, SDF_RES, SDF_RES, T.RedFormat, T.UnsignedByteType);
  sdfTex.magFilter = sdfTex.minFilter = T.LinearFilter;
  sdfTex.needsUpdate = true;

  const amp = options.amp ?? 1;
  const uniforms = {
    uTime: { value: 0 },
    uAmp: { value: amp },
    uFoamStart: { value: options.foamStart ?? 0.04 },
    uDebug: { value: options.debug ?? 0 },
    uSunDir: { value: (options.sunDirection ?? new T.Vector3(-15, 28, 12)).clone().normalize() },
    uSunColor: { value: new T.Color('#fff3d6') },
    uSky: { value: new T.Color(options.skyColor ?? '#cbd2c0') },
    uZenith: { value: new T.Color(options.zenithColor ?? '#a9c1c0') },
    uDeep: { value: new T.Color('#14505a') },
    uShallow: { value: new T.Color('#3f8c88') },
    uFoam: { value: new T.Color('#eefbf8') },
    uFadeNear: { value: options.fadeNear ?? 28 },
    uFadeFar: { value: options.fadeFar ?? 125 },
    tRaftSdf: { value: sdfTex },
    uRaft: { value: new T.Vector4(0, 0, 1, 0) },
    uSdfBox: { value: new T.Vector3(0, 0, 32) },
    uDeckLift: { value: options.deckLift ?? 0.45 },
    uFloatA: { value: Array.from({ length: MAX_FLOATERS }, () => new T.Vector4(1e4, 1e4, 0, 0)) },
    uFloatB: { value: Array.from({ length: MAX_FLOATERS }, () => new T.Vector3(0, 0, 0)) },
    uBobber: { value: new T.Vector4(1e4, 1e4, 0, -100) },
    tScene: { value: null },
    tDepth: { value: null },
    uResolution: { value: new T.Vector2(1, 1) },
    uNear: { value: 0.1 },
    uFar: { value: 200 },
    tReflect: { value: null },
    uReflectMatrix: { value: new T.Matrix4() },
  };
  const step = size / segments;
  // Per-pixel gates use distances interpolated from the vertices. For a 1-Lipschitz distance the linear
  // interpolant over-estimates by at most half the longest triangle edge (the grid diagonal); add a little for
  // the Gerstner horizontal shift and SDF texel error.
  const defines = { GATE_SLACK: (step * Math.SQRT1_2 + 0.25).toFixed(3) };
  if (tier !== 'a') defines.USE_PREPASS = '';
  if (tier === 'c') defines.USE_REFLECTION = '';
  Object.assign(defines, options.defines);   // lab knock-outs for profiling

  const material = new T.ShaderMaterial({ uniforms, defines, vertexShader, fragmentShader, fog: false, lights: false });
  const mesh = new T.Mesh(geometry, material);
  mesh.name = 'ocean';
  mesh.position.y = BASE_Y;
  mesh.frustumCulled = false;
  let time = 0;

  // ---- tier b: half-res opaque prepass (scene colour + depth) ----
  const prepScale = options.prepassScale ?? 0.5;
  let prepRT = null;
  if (tier !== 'a') {
    prepRT = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType });
    prepRT.depthTexture = new T.DepthTexture(1, 1);
    prepRT.depthTexture.type = T.UnsignedIntType;
    uniforms.tScene.value = prepRT.texture;
    uniforms.tDepth.value = prepRT.depthTexture;
  }

  // ---- tier c: quarter-res planar reflection (tiny local Reflector) ----
  let reflRT = null;
  const reflCam = new T.PerspectiveCamera();
  const clip = new T.Plane(new T.Vector3(0, 1, 0), -BASE_Y);
  const bias = new T.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const tmpV = new T.Vector3(), tmpT = new T.Vector3(), size2 = new T.Vector2();
  if (tier === 'c') {
    reflRT = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType });
    uniforms.tReflect.value = reflRT.texture;
  }

  function update(t, camera) {
    time = t;
    uniforms.uTime.value = t;
    if (camera && options.followCamera !== false) {
      mesh.position.x = Math.round(camera.position.x / step) * step;
      mesh.position.z = Math.round(camera.position.z / step) * step;
    }
  }

  // Replaces renderer.render(scene, camera) for tiers b/c; tier a is a plain render.
  function render(renderer, scene, camera) {
    renderer.getDrawingBufferSize(size2);
    if (reflRT) {
      const w = Math.max(1, Math.floor(size2.x * 0.25)), h = Math.max(1, Math.floor(size2.y * 0.25));
      if (reflRT.width !== w || reflRT.height !== h) reflRT.setSize(w, h);
      const y0 = BASE_Y;
      camera.getWorldPosition(tmpV);
      camera.getWorldDirection(tmpT);
      reflCam.position.set(tmpV.x, 2 * y0 - tmpV.y, tmpV.z);
      reflCam.up.set(0, 1, 0);
      reflCam.lookAt(tmpV.x + tmpT.x, 2 * y0 - (tmpV.y + tmpT.y), tmpV.z + tmpT.z);
      reflCam.fov = camera.fov; reflCam.aspect = camera.aspect; reflCam.near = camera.near; reflCam.far = camera.far;
      reflCam.updateProjectionMatrix();
      reflCam.updateMatrixWorld();
      uniforms.uReflectMatrix.value.copy(bias).multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);
      // Mirror image is flipped vertically relative to the screen; sample with world-space projection.
      mesh.visible = false;
      const prevClip = renderer.clippingPlanes;
      clip.constant = -y0 + 0.05;
      renderer.clippingPlanes = [clip];
      renderer.setRenderTarget(reflRT);
      renderer.setClearColor(uniforms.uSky.value, 0);
      renderer.clear();
      renderer.render(scene, reflCam);
      renderer.clippingPlanes = prevClip;
      mesh.visible = true;
    }
    if (prepRT) {
      const w = Math.max(1, Math.floor(size2.x * prepScale)), h = Math.max(1, Math.floor(size2.y * prepScale));
      if (prepRT.width !== w || prepRT.height !== h) prepRT.setSize(w, h);
      uniforms.uResolution.value.copy(size2);
      uniforms.uNear.value = camera.near;
      uniforms.uFar.value = camera.far;
      mesh.visible = false;
      renderer.setRenderTarget(prepRT);
      renderer.render(scene, camera);
      mesh.visible = true;
    }
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  }

  // Bake the raft footprint (2 m tiles centred at tile*2, raft-local) into a signed distance texture.
  // Runs only when tiles change (see sandbox/water/cpu-cost.mjs for timings).
  function setRaft(tiles, x = 0, z = 0, yaw = 0) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [tx, tz] of tiles) { x0 = Math.min(x0, tx * 2 - 1); x1 = Math.max(x1, tx * 2 + 1); z0 = Math.min(z0, tz * 2 - 1); z1 = Math.max(z1, tz * 2 + 1); }
    if (!tiles.length) { x0 = z0 = -1; x1 = z1 = 1; }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, span = Math.max(x1 - x0, z1 - z0) + SDF_MAX * 2;
    const texel = span / SDF_RES, ox = cx - span / 2, oz = cz - span / 2, reach = 1 + SDF_MAX;
    sdfDist.fill(SDF_MAX);
    // Stamp each tile into the texels within its reach (min-combine), instead of every texel testing every tile.
    for (const [tx, tz] of tiles) {
      const wx = tx * 2, wz = tz * 2;
      const i0 = Math.max(0, Math.floor((wx - reach - ox) / texel)), i1 = Math.min(SDF_RES - 1, Math.ceil((wx + reach - ox) / texel));
      const j0 = Math.max(0, Math.floor((wz - reach - oz) / texel)), j1 = Math.min(SDF_RES - 1, Math.ceil((wz + reach - oz) / texel));
      for (let j = j0; j <= j1; j++) {
        const qz = Math.abs(oz + (j + 0.5) * texel - wz) - 1, mz = qz > 0 ? qz : 0;
        for (let i = i0; i <= i1; i++) {
          const qx = Math.abs(ox + (i + 0.5) * texel - wx) - 1, mx = qx > 0 ? qx : 0;
          const inside = qx > qz ? qx : qz;
          const d = Math.sqrt(mx * mx + mz * mz) + (inside < 0 ? inside : 0);
          const k = j * SDF_RES + i;
          if (d < sdfDist[k]) sdfDist[k] = d;
        }
      }
    }
    for (let k = 0; k < sdfData.length; k++) sdfData[k] = Math.round(Math.min(Math.max((sdfDist[k] + 2) / (SDF_MAX + 2), 0), 1) * 255);
    sdfTex.needsUpdate = true;
    uniforms.uSdfBox.value.set(cx, cz, span);
    setRaftPose(x, z, yaw);
  }
  function setRaftPose(x, z, yaw) { uniforms.uRaft.value.set(x, z, Math.cos(yaw), Math.sin(yaw)); }
  // list: [[x, z, radius, hx, hz], ...]: a capsule around the segment centre +- (hx, hz), or a circle when hx/hz
  // are left out. footprint(object) builds one from a mesh. With (cx, cz) only the MAX_FLOATERS closest to that
  // point get foam.
  const pick = [];
  function setFloaters(list, cx, cz) {
    let src = list;
    if (cx !== undefined && list.length > MAX_FLOATERS) {
      pick.length = 0;
      for (const f of list) pick.push(f);
      pick.sort((a, b) => (a[0] - cx) ** 2 + (a[1] - cz) ** 2 - (b[0] - cx) ** 2 - (b[1] - cz) ** 2);
      src = pick;
    }
    const A = uniforms.uFloatA.value, B = uniforms.uFloatB.value;
    for (let i = 0; i < MAX_FLOATERS; i++) {
      const f = src[i];
      if (!f) { A[i].set(1e4, 1e4, 0, 0); B[i].set(0, 0, 0); continue; }
      const hx = f[3] ?? 0, hz = f[4] ?? 0, l2 = hx * hx + hz * hz;
      A[i].set(f[0], f[1], hx, hz);
      B[i].set(l2 > 1e-6 ? hx / l2 : 0, l2 > 1e-6 ? hz / l2 : 0, f[2]);
    }
  }
  // Capsule footprint of a floating object (Object3D in world space or under an untransformed group), for
  // setFloaters: the local bounding box is measured once and cached, then the current position, heading and
  // uniform scale are applied. The long horizontal side becomes the capsule axis, the short one its radius.
  const fpBox = new T.Box3(), fpPart = new T.Box3(), fpInv = new T.Matrix4(), fpRel = new T.Matrix4(), fpAxis = new T.Vector3();
  function footprint(obj) {
    let fp = obj.userData.waterFootprint;
    if (!fp) {
      obj.updateWorldMatrix(true, true);
      fpInv.copy(obj.matrixWorld).invert();
      fpBox.makeEmpty();
      obj.traverse((c) => {
        if (!c.geometry) return;
        if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
        fpBox.union(fpPart.copy(c.geometry.boundingBox).applyMatrix4(fpRel.multiplyMatrices(fpInv, c.matrixWorld)));
      });
      if (fpBox.isEmpty()) fpBox.set(fpAxis.set(-0.3, 0, -0.3), new T.Vector3(0.3, 0, 0.3));
      const ex = (fpBox.max.x - fpBox.min.x) / 2, ez = (fpBox.max.z - fpBox.min.z) / 2;   // object-local, unscaled
      const r = Math.max(0.08, Math.min(ex, ez)), along = Math.max(0, Math.max(ex, ez) - r);
      fp = obj.userData.waterFootprint = { ax: ex >= ez ? along : 0, az: ex >= ez ? 0 : along, r,
        cx: (fpBox.min.x + fpBox.max.x) / 2, cz: (fpBox.min.z + fpBox.max.z) / 2, out: [0, 0, 0, 0, 0] };
    }
    const s = obj.scale.x, q = obj.quaternion, o = fp.out;
    fpAxis.set(fp.cx, 0, fp.cz).applyQuaternion(q);
    o[0] = obj.position.x + fpAxis.x * s; o[1] = obj.position.z + fpAxis.z * s; o[2] = fp.r * s;
    fpAxis.set(fp.ax, 0, fp.az).applyQuaternion(q);
    o[3] = fpAxis.x * s; o[4] = fpAxis.z * s;
    return o;
  }
  // Hook bobber (Vector3-like or null): foam collar and ripple rings while it sits on the water, plus one
  // splash ring from the moment it lands.
  function setBobber(pos) {
    const b = uniforms.uBobber.value;
    const on = !!pos && pos.y - getHeight(pos.x, pos.z) < 0.25;
    if (on && b.z === 0) b.w = time;
    if (on) b.set(pos.x, pos.z, 1, b.w); else b.z = 0;
  }
  // Wave amplitude scale for weather. Updates the shader and the CPU wave table together, so the raft, the
  // swimmer and floating items stay on the drawn surface. (Never set uniforms.uAmp alone.)
  function setAmp(a) {
    uniforms.uAmp.value = a;
    for (const w of pre) w.a = w.a0 * a;
  }


  const pre = WAVES.map(([dx, dz, a, l, q]) => {
    const len = Math.hypot(dx, dz), k = (Math.PI * 2) / l;
    return { dx: dx / len, dz: dz / len, a0: a, a: a * amp, k, c: Math.sqrt(9.8 / k) * SPEED, q };
  });
  const tmp = [0, 0, 0];
  function displace(x, z, t) {
    let ox = 0, oy = 0, oz = 0;
    for (const w of pre) {
      const f = w.k * (w.dx * x + w.dz * z - w.c * t), co = Math.cos(f);
      ox += w.dx * w.q * w.a * co; oz += w.dz * w.q * w.a * co; oy += w.a * Math.sin(f);
    }
    tmp[0] = ox; tmp[1] = oy; tmp[2] = oz;
  }
  function getHeight(x, z, t = time) {
    let px = x, pz = z;
    for (let i = 0; i < 2; i++) { displace(px, pz, t); px = x - tmp[0]; pz = z - tmp[2]; }
    displace(px, pz, t);
    return mesh.position.y + tmp[1];
  }
  function getSlope(x, z, t = time, e = 0.6) {
    return {
      x: (getHeight(x + e, z, t) - getHeight(x - e, z, t)) / (2 * e),
      z: (getHeight(x, z + e, t) - getHeight(x, z - e, t)) / (2 * e),
    };
  }
  function dispose() {
    geometry.dispose(); material.dispose(); sdfTex.dispose();
    prepRT?.depthTexture?.dispose(); prepRT?.dispose(); reflRT?.dispose();
  }

  return { mesh, tier, update, render, getHeight, getSlope, setRaft, setRaftPose, setFloaters, footprint, setBobber, setAmp,
    uniforms, material, dispose };
}

// Drop-in name for dist/ocean.js: same options, same getHeight/getSlope/update/uniforms/mesh contract,
// tier 'a' (single pass) unless options.tier says otherwise.
export function createOcean(T, options = {}) {
  return createWater(T, { tier: 'a', ...options });
}
