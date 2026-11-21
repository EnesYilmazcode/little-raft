// Little Raft ocean (see docs/tech/water.md). Same Gerstner wave set, speed and base height as the
// shipping dist/ocean.js, so getHeight/getSlope are bit-identical (sandbox/water/parity.mjs).
//   tier 'a' (ship this) single pass: crest lace from the Gerstner Jacobian (vertex shader), sky/sun
//            fresnel reflection, twinkling glitter sun path, crest subsurface tint, lacy contact foam + fake
//            deck shadow + under-deck occlusion from a CPU-baked raft distance field, capsule foam around
//            floaters (shaped by each item's size and heading), ripple rings around the hook bobber.
//   tier 'b' a + half-res opaque prepass (colour + depth): intersection foam around any mesh, refraction,
//            depth absorption. Costs ~2x a frame for almost no visible change in this game (see doc).
//   tier 'c' b + quarter-res planar reflection. Same verdict.
// API = dist/ocean.js { mesh, update(t, camera), getHeight, getSlope(x, z, t, e, out?), sample(x, z, out?, t, e),
//   uniforms (incl. uFlow for sailing), material, dispose }
//   + setRaft(tiles, x, z, yaw), setRaftPose(x, z, yaw) (per frame, cheap), setFloaters([[x, z, r, hx?, hz?], ...], camX, camZ),
//   + footprint(object3d) -> [x, z, r, hx, hz] capsule for setFloaters, setBobber(position | null) (before setFloaters),
//   + setAmp(a) (GPU waves + CPU getHeight together), setQuality('low' | 'medium' | 'high'),
//   + render(renderer, scene, camera) (tiers b/c only).
//   createOcean() = tier 'a' drop-in. The deck shadow follows uSunDir (dist/daynight.js moves it) by re-baking.
//   material.vertexShader stays usable on its own (dist/islands-models.js lagoon), see WATER_OCEAN.
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
const FLOAT_RES = 256;    // floater distance map: texels per side, camera-centred
const FLOAT_SPAN = 64;    // metres covered (0.25 m texels); items further than ~32 m get no foam (it fades by 30-90 m)
const FLOAT_LO = -0.3, FLOAT_HI = 0.9;   // encoded distance range (m)
const BOBBER_R = 0.16;    // hook bobber footprint radius (m): the scrap hook at scale .5 is ~.35 m across
const NOISE_CELLS = 64, NOISE_TEXELS = 8;  // baked lace noise: tiling period (lattice cells), texels per cell

// Value noise baked into a tiling R8 texture (smoothstep-interpolated lattice, sampled NOISE_TEXELS times per
// cell). Bilinear lookups of it match the procedural vnoise closely, at one fetch instead of four hashes.
let noiseData = null;
function bakeNoise() {
  if (noiseData) return noiseData;
  const n = NOISE_CELLS, res = n * NOISE_TEXELS, lat = new Float32Array(n * n);
  let seed = 1234567;
  for (let i = 0; i < lat.length; i++) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; lat[i] = (seed >>> 8) / 16777216; }
  const L = (x, y) => lat[(y % n) * n + (x % n)];
  noiseData = new Uint8Array(res * res);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = (i + 0.5) / NOISE_TEXELS, y = (j + 0.5) / NOISE_TEXELS, xi = Math.floor(x), yi = Math.floor(y);
    let u = x - xi, v = y - yi; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
    const a = L(xi, yi) + (L(xi + 1, yi) - L(xi, yi)) * u, b = L(xi, yi + 1) + (L(xi + 1, yi + 1) - L(xi, yi + 1)) * u;
    noiseData[j * res + i] = Math.round((a + (b - a) * v) * 255);
  }
  return noiseData;
}
const RAFT_REACH = 1.1;   // furthest raft effect (lace rings); shadow and occlusion stay inside it
const FLOAT_REACH = 0.7;  // furthest item lace

const f5 = (v) => v.toFixed(5);
const glslWaves = WAVES.map(([dx, dz, a, l, q]) => {
  const n = Math.hypot(dx, dz);
  return `wave(vec2(${f5(dx / n)}, ${f5(dz / n)}), ${f5(a)} * WAVE_AMP, ${f5(l)}, ${f5(q)}, p, disp, tng, bin);`;
}).join('\n  ');

const common = /* glsl */`
uniform float uTime;
uniform vec2 uFlow;          // [sailing] water travel relative to the raft (written by dist/sailing-world.js)
// WATER_OCEAN is a define of the ocean's own material. dist/islands-models.js reuses material.vertexShader for the
// lagoon with only a few shared uniforms and no defines: there the waves keep amplitude 1 and the vertex skips
// the raft texture, so the lagoon still rides exactly on the default sea.
#ifdef WATER_OCEAN
uniform float uAmp;
#define WAVE_AMP uAmp
#else
#define WAVE_AMP 1.0
#endif
uniform sampler2D tRaftSdf;  // R: raft SDF, G: the SDF one deck height toward the sun (fake deck shadow)
uniform vec4 uRaft;          // x, z, cos(yaw), sin(yaw)
uniform vec3 uSdfBox;        // raft-local centre x, z and 1 / side length (m) of the baked square
uniform sampler2D tFloatMap; // distance to the nearest floating item, CPU-stamped capsules (setFloaters)
uniform sampler2D tNoise;    // baked tiling value noise (lace)
uniform vec3 uFloatBox;      // world corner x, z of the floater map and 1 / side length
// Float-only hash: an integer (uint multiply/xor) hash measured ~2.8x slower for the lace noise in SwiftShader.
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tnoise(vec2 p) { return texture2D(tNoise, p * ${(1 / NOISE_CELLS).toFixed(6)}).r; }   // ~vnoise(p), one fetch
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), u.x), u.y);
}
// Signed distances (metres) to the raft footprint (x) and to it shifted toward the sun (y, shadow), from the
// CPU-baked texture. Its border texels are always >= SDF_MAX away, so clamped lookups outside it read 'far'.
vec2 raftDist(vec2 world) {
  vec2 l = world - uRaft.xy;
  l = vec2(uRaft.z * l.x - uRaft.w * l.y, uRaft.w * l.x + uRaft.z * l.y);
  return texture2D(tRaftSdf, (l - uSdfBox.xy) * uSdfBox.z + 0.5).rg * ${(SDF_MAX + 2).toFixed(1)} - 2.0;
}
// Distance (metres) to the nearest floating item, from the per-frame map: one fetch instead of a loop.
// The map's border texels are never stamped, so clamped lookups outside it read 'far'.
float floatDist(vec2 p) {
  return texture2D(tFloatMap, (p - uFloatBox.xy) * uFloatBox.z).r * ${(FLOAT_HI - FLOAT_LO).toFixed(2)} + ${FLOAT_LO.toFixed(2)};
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
varying float vGate;         // raft SDF at the vertex (per-pixel early-out on GPUs that skip untaken branches)

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
  vec2 p = wp.xz + uFlow;      // [sailing] same offset as getHeight
  vec3 disp = vec3(0.0);
  vec3 tng = vec3(1.0, 0.0, 0.0), bin = vec3(0.0, 0.0, 1.0);
  ${glslWaves}
  wp.xyz += disp;
  vWorld = wp.xyz;
  vHeight = disp.y;
  vNormalW = normalize(cross(bin, tng));
  vPinch = 1.0 - ((1.0 + jac.x) * (1.0 + jac.y) - jac.z * jac.z);   // 1 - Jacobian: > 0 where crests bunch up
  // Slow body-colour patches (7-22 m features) are smooth enough to interpolate across the 2.8 m grid.
  vec2 pf = wp.xz + mod(uFlow, 512.0);   // drifts with the water; mod keeps the hash precise (as dist/ocean.js)
  vPatch = vnoise(pf * 0.045 + uTime * 0.01) * 0.6 + vnoise(pf * 0.13 - uTime * 0.02) * 0.4;
#ifdef WATER_OCEAN
  vGate = raftDist(wp.xz).x;
#else
  vGate = 99.0;
#endif
  vec4 mv = viewMatrix * wp;
  vViewZ = mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */`
#include <packing>
${common}
uniform vec3 uSunDir;        // normalised
uniform vec2 uSunXZ;         // horizontal sun direction, normalised
uniform float uPixelAngle;   // radians per pixel (2 tan(fov / 2) / height), for the lace anti-aliasing
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
varying float vGate;

void ripple(vec2 d, float a, float k, float w, vec2 p, inout vec2 g) { g += d * (a * k * cos(k * dot(d, p) - w * uTime)); }

// Glitter: one random point per ~11 cm cell, each with its own flash cycle (on at once, fades, then dark),
// so the sun path twinkles point by point instead of showing a fixed pattern. One hash per pixel.
float glitter(vec2 p) {
  vec2 q = p * 9.0 + vec2(uTime * 0.55, uTime * 0.2);
  vec2 ci = floor(q), cf = fract(q) - 0.5;
  float r = hash(ci);
  vec2 o = (vec2(r, fract(r * 37.13)) - 0.5) * 0.45;
  float flash = max(1.0 - fract(uTime * (0.6 + 0.8 * r) + r * 11.0) * 2.5, 0.0);   // on at once, off over 40% of its cycle
  vec2 d = cf - o;
  return max(1.0 - dot(d, d) * 14.0, 0.0) * flash * 5.0;
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam.xz);
  vec3 V = normalize(toCam);
  vec3 L = uSunDir;
  vec2 p = vWorld.xz;                         // world: raft and item lookups
  vec2 pf = p + mod(uFlow, 512.0);            // [sailing] ripples, glitter and lace drift with the water

  vec2 g = vec2(0.0);
  if (dist < 60.0) {
    ripple(normalize(vec2(0.8, 0.6)), 0.010, 2.10, 1.30, pf, g);
    ripple(normalize(vec2(-0.5, 0.9)), 0.008, 2.90, 1.70, pf, g);
#ifndef WATER_LOW
    ripple(normalize(vec2(0.95, -0.3)), 0.006, 4.30, 2.10, pf, g);
    ripple(normalize(vec2(-0.9, -0.4)), 0.004, 6.70, 2.60, pf, g);
    ripple(normalize(vec2(0.2, 1.0)), 0.003, 9.10, 3.10, pf, g);
#endif
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
  float bl = clamp(-dot(toCam.xz, uSunXZ) / dist, 0.0, 1.0);
  float sssMask = smoothstep(0.35, 1.0, h) * (0.35 + 0.65 * bl * bl * bl) * (1.0 - ndv * 0.6);
  body += uShallow * sssMask * 0.55;
  body *= 0.75 + 0.25 * max(dot(n, L), 0.0);

  // Raft: SDF, fake deck shadow (SDF sampled toward the sun at deck height). Skipped where the vertex says far.
  float rd = ${SDF_MAX.toFixed(1)}, shadow = 1.0;
  if (vGate < ${RAFT_REACH.toFixed(2)} + GATE_SLACK) {
    vec2 rs = raftDist(p);
    rd = rs.x;
    shadow = 0.55 + 0.45 * smoothstep(-0.15, 0.35, rs.y);
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
  float s70 = pow(ndh, 70.0), spec = s70 * 0.10;
  if (ndh > 0.985) {
    float s140 = s70 * s70, s560 = s140 * s140; s560 *= s560;   // ndh^700 from ndh^70 with 4 multiplies
#ifdef WATER_LOW
    spec += s560 * s140 * 0.6;                // graphics 'low': the far-field constant instead of glitter
#else
    spec += s560 * s140 * mix(glitter(pf), 0.6, smoothstep(14.0, 55.0, dist));
#endif
  }
  col += uSunColor * min(spec, 1.2) * shadow * (1.0 - smoothstep(60.0, 125.0, dist) * 0.6);

  // Foam masks (cheap): where lace may go and how wide it gets.
  // 1: crests where the Gerstner map compresses (1 - J), plus the very top of tall crests.
#ifdef WATER_LOW
  float crestMask = 0.0;                      // graphics 'low': contact foam only
#else
  float crestMask = clamp((vPinch - uFoamStart) * 7.0 + smoothstep(0.09, 0.2, vHeight / uAmp) * 0.35, 0.0, 1.0);
#endif
  // 2: raft wake rings that pulse outward and fade by ~1.1 m (the ragged collar on the logs is added below).
  float raftLace = 0.0;
  if (rd < ${RAFT_REACH.toFixed(2)}) raftLace = (1.0 - smoothstep(0.0, ${RAFT_REACH.toFixed(2)}, rd)) * (0.35 + 1.3 * abs(fract(rd * 0.8 - uTime * 0.29 + vPatch) - 0.5));   // triangle wave: sin costs more
  // 3: items, as capsules shaped by their footprint.
  // Ripple rings run outward from every item (and the hook bobber, which is stamped into the same map).
  float fd = floatDist(p);
  float floatLace = (1.0 - smoothstep(-0.1, ${FLOAT_REACH.toFixed(2)}, fd)) * (0.45 + 1.1 * abs(fract(fd * 2.5 - uTime * 0.8) - 0.5));
  float laceMask = max(max(raftLace, floatLace), contact);

  // Lace: thin contour lines of a two-octave noise (scrolled with the swell) that widen as the mask grows.
  // Coverage is anti-aliased by the noise's screen footprint, so far-away lines thin out instead of sparkling.
  // The noise only runs where some mask is on, which is a small part of the screen on a calm sea.
  // Screen footprint of a pixel on the water, from distance and grazing angle (cheaper than fwidth, and valid
  // inside the branch below).
  float foot = uPixelAngle * dot(toCam, toCam) / max(toCam.y, 0.05 * dist);
  float foam = 0.0;
  if (laceMask > 0.02 || crestMask > 0.0 || rd < 0.3) {
    vec2 fp = pf + vec2(uTime * 0.35, uTime * 0.12);
    float n1 = tnoise(fp * 2.1), n2 = tnoise(fp * 4.6 + vec2(uTime * -0.2, uTime * 0.15));
    float iso = abs(n1 * 0.6 + n2 * 0.4 - 0.5), isoAA = foot * 1.2 + 1e-4;
    // Coverage floor for sub-pixel lines, dropped at grazing views (a swimmer's eye): there the half-covered
    // lines of the whole lace band would merge into a white sheet.
    float floorAA = 0.5 * smoothstep(0.03, 0.15, toCam.y / max(dist, 1e-3));
    // Coverage of a contour band of half-width w: AA'd edges, and lines thinner than a pixel dim instead of
    // staying half-covered, so distant lace thins out rather than turning into soft blobs.
    float wc = 0.012 + crestMask * 0.09, wl = 0.004 + laceMask * 0.022;
#ifdef WATER_LOW
    float crest = 0.0;
#else
    float crest = clamp((wc - iso) / isoAA + 0.5, 0.0, 1.0) * min(wc * 3.0 / isoAA + floorAA, 1.0) * smoothstep(0.0, 0.08, crestMask);
#endif
    float lace = clamp((wl - iso) / isoAA + 0.5, 0.0, 1.0) * min(wl * 3.0 / isoAA + floorAA, 1.0) * smoothstep(0.02, 0.12, laceMask);
    float raftCore = 1.0 - smoothstep(0.0, 0.06 + 0.12 * n1, rd);   // thin ragged collar where logs meet water
    foam = max(max(crest * 0.85, lace * 0.75), raftCore * 0.85);
    foam *= (1.0 - smoothstep(30.0, 90.0, dist)) * smoothstep(-0.7, -0.3, rd);   // none deep under the deck (plank gaps)
  }
  col *= mix(0.55, 1.0, smoothstep(-1.2, 0.1, rd));                               // occluded water under the raft
  col = mix(col, uFoam * (0.8 + 0.2 * shadow), foam);

  gl_FragColor = vec4(col, 1.0);
#ifdef WATER_DEBUG   // compiled in only when created with options.debug
  if (uDebug == 3) gl_FragColor = vec4(vec3(clamp(vPinch * 8.0, 0.0, 1.0)), 1.0);
  if (uDebug == 4) gl_FragColor = vec4(vec3(clamp(rd / 4.0, 0.0, 1.0)), 1.0);
  if (uDebug == 5) gl_FragColor = vec4(step(0.02, laceMask) + step(0.0001, crestMask), step(${RAFT_REACH.toFixed(2)} + GATE_SLACK, vGate), 0.0, 1.0);
#ifdef USE_PREPASS
  if (uDebug == 2) gl_FragColor = vec4(vec3(clamp(thick / 3.0, 0.0, 1.0)), 1.0);
#endif
#ifdef USE_REFLECTION
  if (uDebug == 1) gl_FragColor = vec4(planar.rgb * planar.a, 1.0);
#endif
  if (uDebug > 0) return;
#endif
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

  const sdfData = new Uint8Array(SDF_RES * SDF_RES * 2).fill(255);
  const sdfDist = new Float32Array(SDF_RES * SDF_RES), sdfShadow = new Float32Array(SDF_RES * SDF_RES);
  const sdfTex = new T.DataTexture(sdfData, SDF_RES, SDF_RES, T.RGFormat, T.UnsignedByteType);
  sdfTex.magFilter = sdfTex.minFilter = T.LinearFilter;
  sdfTex.needsUpdate = true;
  const floatData = new Uint8Array(FLOAT_RES * FLOAT_RES).fill(255);
  const floatTex = new T.DataTexture(floatData, FLOAT_RES, FLOAT_RES, T.RedFormat, T.UnsignedByteType);
  floatTex.magFilter = floatTex.minFilter = T.LinearFilter;
  floatTex.needsUpdate = true;
  const noiseTex = new T.DataTexture(bakeNoise(), NOISE_CELLS * NOISE_TEXELS, NOISE_CELLS * NOISE_TEXELS, T.RedFormat, T.UnsignedByteType);
  noiseTex.wrapS = noiseTex.wrapT = T.RepeatWrapping;
  noiseTex.magFilter = noiseTex.minFilter = T.LinearFilter;
  noiseTex.needsUpdate = true;

  const amp = options.amp ?? 1;
  const sunDir = (options.sunDirection ?? new T.Vector3(-15, 28, 12)).clone().normalize();
  const deckLift = options.deckLift ?? 0.45;   // deck height above water for the fake shadow (baked by setRaft)
  const uniforms = {
    uTime: { value: 0 },
    uFlow: { value: new T.Vector2() },   // [sailing] wave-field offset written by dist/sailing-world.js
    uAmp: { value: amp },
    uFoamStart: { value: options.foamStart ?? 0.04 },
    uDebug: { value: options.debug ?? 0 },
    uSunDir: { value: sunDir },
    uSunXZ: { value: new T.Vector2(sunDir.x, sunDir.z).normalize() },
    uPixelAngle: { value: 0.0016 },
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
    uSdfBox: { value: new T.Vector3(0, 0, 1 / 32) },
    tFloatMap: { value: floatTex },
    tNoise: { value: noiseTex },
    uFloatBox: { value: new T.Vector3(-FLOAT_SPAN / 2, -FLOAT_SPAN / 2, 1 / FLOAT_SPAN) },
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
  const defines = { WATER_OCEAN: '', GATE_SLACK: (step * Math.SQRT1_2 + 0.25).toFixed(3) };
  if (options.quality === 'low') defines.WATER_LOW = '';
  if (options.debug) defines.WATER_DEBUG = '';
  if (tier !== 'a') defines.USE_PREPASS = '';
  if (tier === 'c') defines.USE_REFLECTION = '';
  Object.assign(defines, options.defines);   // lab knock-outs for profiling

  const material = new T.ShaderMaterial({ uniforms, defines, vertexShader, fragmentShader, fog: false, lights: false });
  const mesh = new T.Mesh(geometry, material);
  mesh.name = 'ocean';
  mesh.position.y = BASE_Y;
  mesh.frustumCulled = false;
  const bufSize = new T.Vector2();
  // Runs after every system has written its uniforms for the frame (dist/daynight.js moves uSunDir).
  mesh.onBeforeRender = (renderer, scene, camera) => {
    trackSun();
    if (!camera.isPerspectiveCamera) return;   // pixel footprint for the lace anti-aliasing
    renderer.getDrawingBufferSize(bufSize);
    uniforms.uPixelAngle.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / (camera.zoom * Math.max(1, bufSize.y));
  };
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
  // Channel R is the raft SDF; channel G is the same footprint shifted by the deck's shadow offset (sun direction x
  // deck height, turned into raft space), so the shader gets the fake deck shadow from the same fetch.
  let raftTiles = [], raftYaw = 0;
  function stampTiles(tiles, dist, ox, oz, texel, shiftX, shiftZ, reach = 1 + SDF_MAX) {
    dist.fill(SDF_MAX);
    for (const [tx, tz] of tiles) {   // stamp each tile into the texels within its reach (min-combine)
      const wx = tx * 2 - shiftX, wz = tz * 2 - shiftZ;
      const i0 = Math.max(0, Math.floor((wx - reach - ox) / texel)), i1 = Math.min(SDF_RES - 1, Math.ceil((wx + reach - ox) / texel));
      const j0 = Math.max(0, Math.floor((wz - reach - oz) / texel)), j1 = Math.min(SDF_RES - 1, Math.ceil((wz + reach - oz) / texel));
      for (let j = j0; j <= j1; j++) {
        const qz = Math.abs(oz + (j + 0.5) * texel - wz) - 1, mz = qz > 0 ? qz : 0;
        for (let i = i0; i <= i1; i++) {
          const qx = Math.abs(ox + (i + 0.5) * texel - wx) - 1, mx = qx > 0 ? qx : 0;
          const inside = qx > qz ? qx : qz;
          const d = Math.sqrt(mx * mx + mz * mz) + (inside < 0 ? inside : 0);
          const k = j * SDF_RES + i;
          if (d < dist[k]) dist[k] = d;
        }
      }
    }
  }
  const bake = { ox: 0, oz: 0, texel: 1, yaw: 0, sun: new T.Vector3() };   // what the shadow channel was baked with
  const enc = (d) => Math.round(Math.min(Math.max((d + 2) / (SDF_MAX + 2), 0), 1) * 255);
  // Shadow channel only: the footprint shifted by sun.xz / sun.y * deckLift, turned into raft space. The shader
  // reads it through smoothstep(-.15, .35), so stamping within 1.5 m of a tile is enough (cheap to redo).
  function bakeShadow() {
    const { ox, oz, texel } = bake, yaw = bake.yaw = raftYaw;
    bake.sun.copy(sunDir);
    const k = deckLift / Math.max(sunDir.y, 0.2), wx = sunDir.x * k, wz = sunDir.z * k, c = Math.cos(yaw), sn = Math.sin(yaw);
    stampTiles(raftTiles, sdfShadow, ox, oz, texel, c * wx - sn * wz, sn * wx + c * wz, 1.5);
    for (let i = 0; i < sdfShadow.length; i++) sdfData[2 * i + 1] = enc(sdfShadow[i]);
    sdfTex.needsUpdate = true;
  }
  // The sun moves (dist/daynight.js): re-bake the shadow once it has turned by ~1.5 degrees (every few seconds of
  // a 20 minute day, and once when the light swaps to the moon). Renormalises uSunDir and derives uSunXZ.
  const SUN_REBAKE = Math.cos((1.5 * Math.PI) / 180);
  function trackSun() {
    const len = sunDir.length();
    if (!(len > 1e-6)) return;
    if (Math.abs(len - 1) > 1e-6) sunDir.multiplyScalar(1 / len);
    const xz = Math.hypot(sunDir.x, sunDir.z);
    if (xz > 1e-6) uniforms.uSunXZ.value.set(sunDir.x / xz, sunDir.z / xz);
    if (raftTiles.length && sunDir.dot(bake.sun) < SUN_REBAKE) bakeShadow();
  }
  function setRaft(tiles, x = 0, z = 0, yaw = 0) {
    raftTiles = tiles.map((t) => [t[0], t[1]]); raftYaw = yaw;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [tx, tz] of tiles) { x0 = Math.min(x0, tx * 2 - 1); x1 = Math.max(x1, tx * 2 + 1); z0 = Math.min(z0, tz * 2 - 1); z1 = Math.max(z1, tz * 2 + 1); }
    if (!tiles.length) { x0 = z0 = -1; x1 = z1 = 1; }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, span = Math.max(x1 - x0, z1 - z0) + SDF_MAX * 2;
    const texel = span / SDF_RES, ox = cx - span / 2, oz = cz - span / 2;
    bake.ox = ox; bake.oz = oz; bake.texel = texel;
    stampTiles(tiles, sdfDist, ox, oz, texel, 0, 0);
    for (let i = 0; i < sdfDist.length; i++) sdfData[2 * i] = enc(sdfDist[i]);
    bakeShadow();
    uniforms.uSdfBox.value.set(cx, cz, 1 / span);
    uniforms.uRaft.value.set(x, z, Math.cos(yaw), Math.sin(yaw));
  }
  // Move/turn the raft without changing tiles; cheap enough to call every frame (it returns at once when the pose
  // is unchanged). The raft SDF is in raft space, so a move or turn only changes uRaft; the shadow channel (baked
  // in raft space) is re-baked once the heading is ~1 degree off what it was baked with.
  function setRaftPose(x, z, yaw = 0) {
    const r = uniforms.uRaft.value;
    if (r.x === x && r.y === z && yaw === raftYaw) return;
    raftYaw = yaw; r.set(x, z, Math.cos(yaw), Math.sin(yaw));
    if (raftTiles.length && Math.abs(yaw - bake.yaw) > 0.0175) bakeShadow();
  }
  // Graphics preset ('low' | 'medium' | 'high', as dist/quality.js PRESETS / options.graphics). 'low' compiles out
  // the crest lace, glitter and 3 of the 5 ripple normals (contact foam, shadow and colour stay). Changing it
  // recompiles the shader once, so call it on a preset change, not from the adaptive per-frame ladder.
  function setQuality(preset) {
    const low = preset === 'low';
    if (low === ('WATER_LOW' in material.defines)) return;
    if (low) material.defines.WATER_LOW = ''; else delete material.defines.WATER_LOW;
    material.needsUpdate = true;
  }
  // list: [[x, z, radius, hx, hz], ...]: a capsule around the segment centre +- (hx, hz), or a circle when hx/hz
  // are left out (footprint(object) builds one from a mesh). Every item is stamped into a camera-centred
  // distance map (FLOAT_SPAN m, FLOAT_RES texels), so the shader does one fetch however many items float.
  // (cx, cz) centres the map, normally the camera; without it the map stays where it was.
  let floatDirty = [];   // texel rects stamped last time, reset to 'far' before the next stamp
  function setFloaters(list, cx, cz) {
    const box = uniforms.uFloatBox.value, texel = FLOAT_SPAN / FLOAT_RES;
    if (cx !== undefined) box.set(Math.round(cx / texel) * texel - FLOAT_SPAN / 2, Math.round(cz / texel) * texel - FLOAT_SPAN / 2, 1 / FLOAT_SPAN);
    for (const [i0, i1, j0, j1] of floatDirty) for (let j = j0; j <= j1; j++) floatData.fill(255, j * FLOAT_RES + i0, j * FLOAT_RES + i1 + 1);
    floatDirty = [];
    const ox = box.x, oz = box.y, scale = 255 / (FLOAT_HI - FLOAT_LO);
    const n = list.length + (bobberOn ? 1 : 0);
    for (let fi = 0; fi < n; fi++) {
      const f = fi < list.length ? list[fi] : bobber;
      const x = f[0], z = f[1], r = f[2], hx = f[3] ?? 0, hz = f[4] ?? 0, l2 = hx * hx + hz * hz, il2 = l2 > 1e-6 ? 1 / l2 : 0;
      const ex = Math.abs(hx) + r + FLOAT_HI, ez = Math.abs(hz) + r + FLOAT_HI;
      // One texel ring at the border is never stamped, so clamped lookups outside the map read 'far'.
      const i0 = Math.max(1, Math.floor((x - ex - ox) / texel)), i1 = Math.min(FLOAT_RES - 2, Math.ceil((x + ex - ox) / texel));
      const j0 = Math.max(1, Math.floor((z - ez - oz) / texel)), j1 = Math.min(FLOAT_RES - 2, Math.ceil((z + ez - oz) / texel));
      if (i0 > i1 || j0 > j1) continue;
      floatDirty.push([i0, i1, j0, j1]);
      for (let j = j0; j <= j1; j++) {
        const pz = oz + (j + 0.5) * texel - z;
        for (let i = i0; i <= i1; i++) {
          const px = ox + (i + 0.5) * texel - x;
          let t = (px * hx + pz * hz) * il2; t = t < -1 ? -1 : t > 1 ? 1 : t;
          const dx = px - hx * t, dz = pz - hz * t;
          const v = Math.round((Math.sqrt(dx * dx + dz * dz) - r - FLOAT_LO) * scale), k = j * FLOAT_RES + i;
          if (v < floatData[k]) floatData[k] = v < 0 ? 0 : v;
        }
      }
    }
    floatTex.needsUpdate = true;
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
  // Hook bobber (Vector3-like or null): while it sits on the water (within .25 m of the surface) it is stamped
  // into the floater map by the next setFloaters, so it gets the same lace and outward ripple rings as items.
  // Call it before setFloaters each frame.
  const bobber = [0, 0, BOBBER_R];
  let bobberOn = false;
  function setBobber(pos) {
    bobberOn = !!pos && pos.y - getHeight(pos.x, pos.z) < 0.25;
    if (bobberOn) { bobber[0] = pos.x; bobber[1] = pos.z; }
  }
  // Wave amplitude scale for weather. Updates the shader and the CPU wave table together, so the raft, the
  // swimmer and floating items stay on the drawn surface. (Never set uniforms.uAmp alone.)
  function setAmp(a) {
    uniforms.uAmp.value = a;
    WAVES.forEach(([dx, dz, a0, l, q], i) => { const len = Math.hypot(dx, dz), aa = a0 * a; W[i * 6 + 4] = (dx / len) * q * aa; W[i * 6 + 5] = (dz / len) * q * aa; AMP[i] = aa; });
  }

  // CPU mirror of the vertex shader, the same code as dist/ocean.js (flattened table, indexed loops, no
  // allocation; inverts the horizontal Gerstner shift with 2 iterations; uFlow offset for sailing). With amp 1
  // every product is the one dist/ocean.js computes, so results are bit-identical (sandbox/water/parity.mjs).
  const NW = WAVES.length;
  const W = new Float64Array(NW * 6);
  const AMP = new Float64Array(NW);
  WAVES.forEach(([dx, dz, , l], i) => {
    const len = Math.hypot(dx, dz), k = (Math.PI * 2) / l, o = i * 6;
    W[o] = k; W[o + 1] = dx / len; W[o + 2] = dz / len; W[o + 3] = Math.sqrt(9.8 / k) * SPEED;
  });
  setAmp(amp);
  function getHeight(x, z, t = time) {
    const fl = uniforms.uFlow.value; x += fl.x; z += fl.y;   // [sailing] match the shader offset
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
    for (let i = 0, o = 0; i < NW; i++, o += 6) oy += AMP[i] * Math.sin(W[o] * (W[o + 1] * px + W[o + 2] * pz - W[o + 3] * t));
    return mesh.position.y + oy;
  }
  // Surface slope {x, z} for tilting floating objects; pass `out` to reuse an object instead of allocating.
  function getSlope(x, z, t = time, e = 0.6, out) {
    const sx = (getHeight(x + e, z, t) - getHeight(x - e, z, t)) / (2 * e);
    const sz = (getHeight(x, z + e, t) - getHeight(x, z - e, t)) / (2 * e);
    if (!out) return { x: sx, z: sz };
    out.x = sx; out.z = sz;
    return out;
  }
  // sample(x, z, out?, t, e) -> {h, sx, sz}: getHeight plus getSlope in one call (dist/game.js uses it).
  function sample(x, z, out, t = time, e = 0.6) {
    const r = out ?? { h: 0, sx: 0, sz: 0 };
    r.h = getHeight(x, z, t);
    r.sx = (getHeight(x + e, z, t) - getHeight(x - e, z, t)) / (2 * e);
    r.sz = (getHeight(x, z + e, t) - getHeight(x, z - e, t)) / (2 * e);
    return r;
  }
  function dispose() {
    geometry.dispose(); material.dispose(); sdfTex.dispose(); floatTex.dispose(); noiseTex.dispose();
    prepRT?.depthTexture?.dispose(); prepRT?.dispose(); reflRT?.dispose();
  }

  return { mesh, tier, update, render, getHeight, getSlope, sample, setRaft, setRaftPose, setFloaters, footprint, setBobber,
    setAmp, setQuality, uniforms, material, dispose };
}

// Drop-in name for dist/ocean.js: same options, same getHeight/getSlope/update/uniforms/mesh contract,
// tier 'a' (single pass) unless options.tier says otherwise.
export function createOcean(T, options = {}) {
  return createWater(T, { tier: 'a', ...options });
}
