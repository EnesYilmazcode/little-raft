// Little Raft water lab: one Gerstner ocean, three quality tiers (see docs/tech/water.md).
//   tier 'a' single pass: Jacobian crest foam, sky/sun reflection, SoT-style subsurface,
//            analytic contact foam + fake shadow from a raft distance field, no extra passes.
//   tier 'b' a + half-res opaque prepass (color + depth): true intersection foam around
//            anything, see-through shallows, refraction, depth absorption.
//   tier 'c' b + quarter-res planar reflection of the raft and sky.
// API mirrors dist/ocean.js: { mesh, update(t, camera), getHeight, getSlope, uniforms,
// setRaft(tiles, x, z, yaw), setFloaters([[x,z,r],...]), render(renderer, scene, camera), dispose }.

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
const MAX_FLOATERS = 8;

const f5 = (v) => v.toFixed(5);
const glslWaves = WAVES.map(([dx, dz, a, l, q]) => {
  const n = Math.hypot(dx, dz);
  return `wave(vec2(${f5(dx / n)}, ${f5(dz / n)}), ${f5(a)} * uAmp, ${f5(l)}, ${f5(q)}, p, disp, tng, bin);`;
}).join('\n  ');
// Per-pixel Jacobian terms (smooth crest foam; per-vertex looked blocky on the 2.8 m grid).
const glslJac = WAVES.map(([dx, dz, a, l, q]) => {
  const n = Math.hypot(dx, dz);
  return `jacobian(vec2(${f5(dx / n)}, ${f5(dz / n)}), ${f5(a)} * uAmp, ${f5(l)}, ${f5(q)}, p, jac);`;
}).join('\n  ');

const vertexShader = /* glsl */`
uniform float uTime;
uniform float uAmp;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vHeight;
varying vec2 vBase;
varying float vViewZ;

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
  vBase = p;
  vec3 tng = vec3(1.0, 0.0, 0.0), bin = vec3(0.0, 0.0, 1.0);
  ${glslWaves}
  wp.xyz += disp;
  vWorld = wp.xyz;
  vHeight = disp.y;
  vNormalW = normalize(cross(bin, tng));
  vec4 mv = viewMatrix * wp;
  vViewZ = mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */`
#include <packing>
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
uniform float uAmp;
uniform float uFoamStart;    // 1 - J where crest foam begins (absolute, so calm seas stay clean)
uniform int uDebug;          // 1 planar refl, 2 water thickness, 3 crest pinch, 4 raft sdf
uniform sampler2D tRaftSdf;
uniform vec3 uRaft;          // x, z, yaw
uniform vec3 uSdfBox;        // raft-local centre x, z and side length (m) of the baked square
uniform float uDeckLift;     // deck height above water for the fake shadow
uniform vec3 uFloaters[${MAX_FLOATERS}];
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
varying vec2 vBase;
varying float vViewZ;

// jac.xyz accumulates dDx/dx, dDz/dz, dDx/dz of the Gerstner horizontal displacement.
void jacobian(vec2 d, float a, float L, float Q, vec2 p, inout vec3 jac) {
  float k = 6.2831853 / L;
  float f = k * (dot(d, p) - sqrt(9.8 / k) * ${SPEED.toFixed(3)} * uTime);
  jac += vec3(-d.x * d.x, -d.y * d.y, -d.x * d.y) * (k * Q * a * sin(f));
}

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), u.x), u.y);
}
void ripple(vec2 d, float a, float k, float w, vec2 p, inout vec2 g) { g += d * (a * k * cos(k * dot(d, p) - w * uTime)); }

// Signed distance (metres) to the raft footprint, from the CPU-baked texture.
float raftDist(vec2 world) {
  vec2 l = world - uRaft.xy;
  float c = cos(uRaft.z), s = sin(uRaft.z);
  l = vec2(c * l.x - s * l.y, s * l.x + c * l.y);
  vec2 uv = (l - uSdfBox.xy) / uSdfBox.z + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return ${SDF_MAX.toFixed(1)};
  return texture2D(tRaftSdf, uv).r * ${(SDF_MAX + 2).toFixed(1)} - 2.0;
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam.xz);
  vec3 V = normalize(toCam);
  vec3 L = normalize(uSunDir);
  vec2 p = vWorld.xz;

  float near = 1.0 - smoothstep(8.0, 60.0, dist);
  vec2 g = vec2(0.0);
  ripple(normalize(vec2(0.8, 0.6)), 0.010, 2.10, 1.30, p, g);
  ripple(normalize(vec2(-0.5, 0.9)), 0.008, 2.90, 1.70, p, g);
  ripple(normalize(vec2(0.95, -0.3)), 0.006, 4.30, 2.10, p, g);
  ripple(normalize(vec2(-0.9, -0.4)), 0.004, 6.70, 2.60, p, g);
  ripple(normalize(vec2(0.2, 1.0)), 0.003, 9.10, 3.10, p, g);
  g *= near;
  vec3 n = normalize(vec3(vNormalW.x - g.x, vNormalW.y, vNormalW.z - g.y));

  float ndv = max(dot(n, V), 0.0);
  float fresnel = min(0.02 + 0.98 * pow(1.0 - ndv, 5.0), 0.75);

  // Reflection: analytic sky gradient + sun, optionally replaced by the planar pass.
  vec3 R = reflect(-V, n);
  vec3 refl = mix(uSky, uZenith, smoothstep(0.0, 0.6, R.y));
#ifdef USE_REFLECTION
  vec4 rc = uReflectMatrix * vec4(vWorld, 1.0);
  vec2 ruv = rc.xy / rc.w + n.xz * 0.06 * near;
  vec4 planar = texture2D(tReflect, clamp(ruv, 0.001, 0.999));
  refl = mix(refl, planar.rgb, planar.a);
#endif

  // Body colour + Sea of Thieves style subsurface: crest mask x view-against-sun x grazing view.
  float patches = vnoise(p * 0.045 + uTime * 0.01) * 0.6 + vnoise(p * 0.13 - uTime * 0.02) * 0.4;
  float h = clamp(vHeight / 0.2 * 0.5 + 0.5, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, clamp(h * 0.5 + patches * 0.3, 0.0, 1.0));
  float backLit = pow(clamp(dot(normalize(vec3(-V.x, 0.0, -V.z)), normalize(vec3(L.x, 0.0, L.z))), 0.0, 1.0), 3.0);
  float sssMask = smoothstep(0.35, 1.0, h) * (0.35 + 0.65 * backLit) * (1.0 - ndv * 0.6);
  body += uShallow * sssMask * 0.55;
  body *= 0.75 + 0.25 * max(dot(n, L), 0.0);

  // Fake raft shadow: march the SDF toward the sun from the water point to deck height.
  float rd = raftDist(p);
  float sd = raftDist(p + L.xz / max(L.y, 0.2) * uDeckLift);
  float shadow = 1.0 - (1.0 - smoothstep(-0.15, 0.35, sd)) * 0.45;

#ifdef USE_PREPASS
  vec2 suv = gl_FragCoord.xy / uResolution;
  float sceneZ = perspectiveDepthToViewZ(texture2D(tDepth, suv).x, uNear, uFar);
  float thick = max(vViewZ - sceneZ, 0.0);           // metres of water in front of the scene
  vec2 off = n.xz * 0.025 * clamp(thick, 0.0, 1.0) * near;
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

  // Foam / sparkle noise, scrolled with the swell. Two octaves, shared by everything below.
  vec2 fp = p + vec2(uTime * 0.35, uTime * 0.12);
  float n1 = vnoise(fp * 2.1), n2 = vnoise(fp * 4.6 + vec2(uTime * -0.2, uTime * 0.15));
  float fnoise = n1 * 0.6 + n2 * 0.4;

  // Sun: tight lobe broken into sparkles by the noise, plus a soft sheen that draws the sun path.
  vec3 H = normalize(L + V);
  float ndh = max(dot(n, H), 0.0);
  // Glitter: a fine noise cell must line up with the tight lobe, so the glint breaks into points.
  float glit = smoothstep(0.72, 0.9, vnoise(fp * 11.0 + n1 * 3.0));
  float sparkle = mix(glit * 2.5, 0.6, smoothstep(20.0, 70.0, dist));
  float spec = pow(ndh, 700.0) * sparkle + pow(ndh, 70.0) * 0.10;
  col += uSunColor * min(spec, 1.2) * shadow * (1.0 - smoothstep(60.0, 125.0, dist) * 0.6);

  // Lace: thin contour lines of the noise that thicken into patches as a mask grows.
  // Coverage is anti-aliased with fwidth, so far-away lines thin out instead of sparkling.
  float iso = abs(fnoise - 0.5), isoAA = fwidth(fnoise) + 1e-4;

  // Foam 1: crests where the Gerstner map compresses (1 - J), plus the very top of tall crests.
  vec3 jac = vec3(0.0);
  { vec2 p = vBase; ${glslJac} }
  float pinch = 1.0 - ((1.0 + jac.x) * (1.0 + jac.y) - jac.z * jac.z);
  float crestMask = clamp((pinch - uFoamStart) * 7.0 + smoothstep(0.09, 0.2, vHeight / uAmp) * 0.35, 0.0, 1.0);
  float crest = clamp((0.012 + crestMask * 0.09 - iso) / isoAA + 0.5, 0.0, 1.0) * step(0.02, crestMask);

  // Foam 2: hugging band on the logs + lacy wake rings that pulse outward and fade by ~1.3 m.
  float ring = 0.5 + 0.5 * sin(rd * 5.0 - uTime * 1.8 + n1 * 3.0);
  float raftCore = 1.0 - smoothstep(0.02, 0.1 + 0.14 * n1, rd);
  float raftLace = (1.0 - smoothstep(0.0, 1.1, rd)) * (0.35 + 0.65 * ring);
  float floatLace = 0.0;
  for (int i = 0; i < ${MAX_FLOATERS}; i++) {
    vec3 fl = uFloaters[i];                       // unused slots sit 1e4 m away: no branch
    float d = length(p - fl.xy) - fl.z;
    floatLace = max(floatLace, 1.0 - smoothstep(-0.1, 0.55, d));   // circles never match plank shapes: lace only, no solid collar
  }
  float laceMask = max(max(raftLace, floatLace * 0.8), contact);
  float lace = clamp((0.01 + laceMask * 0.055 - iso) / isoAA + 0.5, 0.0, 1.0) * step(0.02, laceMask);
  float foam = max(max(crest * 0.85, lace * 0.9), raftCore * 0.92);
  foam *= (1.0 - smoothstep(30.0, 90.0, dist)) * smoothstep(-0.7, -0.3, rd);   // none deep under the deck (plank gaps)
  col *= mix(0.55, 1.0, smoothstep(-1.2, 0.1, rd));                               // occluded water under the raft
  col = mix(col, uFoam * (0.8 + 0.2 * shadow), foam);

  gl_FragColor = vec4(col, 1.0);
  if (uDebug == 3) gl_FragColor = vec4(vec3(clamp(pinch * 8.0, 0.0, 1.0)), 1.0);
  if (uDebug == 4) gl_FragColor = vec4(vec3(clamp(rd / 4.0, 0.0, 1.0)), 1.0);
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
    uRaft: { value: new T.Vector3() },
    uSdfBox: { value: new T.Vector3(0, 0, 32) },
    uDeckLift: { value: options.deckLift ?? 0.45 },
    uFloaters: { value: Array.from({ length: MAX_FLOATERS }, () => new T.Vector3(1e4, 1e4, 0)) },
    tScene: { value: null },
    tDepth: { value: null },
    uResolution: { value: new T.Vector2(1, 1) },
    uNear: { value: 0.1 },
    uFar: { value: 200 },
    tReflect: { value: null },
    uReflectMatrix: { value: new T.Matrix4() },
  };
  const defines = {};
  if (tier !== 'a') defines.USE_PREPASS = '';
  if (tier === 'c') defines.USE_REFLECTION = '';

  const material = new T.ShaderMaterial({ uniforms, defines, vertexShader, fragmentShader, fog: false, lights: false });
  const mesh = new T.Mesh(geometry, material);
  mesh.name = 'ocean';
  mesh.position.y = BASE_Y;
  mesh.frustumCulled = false;
  const step = size / segments;
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
    uniforms.uRaft.value.set(x, z, yaw);
  }
  function setRaftPose(x, z, yaw) { uniforms.uRaft.value.set(x, z, yaw); }
  // list: [[x, z, radius], ...]. With (cx, cz) only the MAX_FLOATERS closest to that point get foam.
  const pick = [];
  function setFloaters(list, cx, cz) {
    let src = list;
    if (cx !== undefined && list.length > MAX_FLOATERS) {
      pick.length = 0;
      for (const f of list) pick.push(f);
      pick.sort((a, b) => (a[0] - cx) ** 2 + (a[1] - cz) ** 2 - (b[0] - cx) ** 2 - (b[1] - cz) ** 2);
      src = pick;
    }
    uniforms.uFloaters.value.forEach((v, i) => (src[i] ? v.set(src[i][0], src[i][1], src[i][2]) : v.set(1e4, 1e4, 0)));
  }


  const pre = WAVES.map(([dx, dz, a, l, q]) => {
    const len = Math.hypot(dx, dz), k = (Math.PI * 2) / l;
    return { dx: dx / len, dz: dz / len, a: a * amp, k, c: Math.sqrt(9.8 / k) * SPEED, q };
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

  return { mesh, tier, update, render, getHeight, getSlope, setRaft, setRaftPose, setFloaters, uniforms, material, dispose };
}

// Drop-in name for dist/ocean.js: same options, same getHeight/getSlope/update/uniforms/mesh contract,
// tier 'a' (single pass) unless options.tier says otherwise.
export function createOcean(T, options = {}) {
  return createWater(T, { tier: 'a', ...options });
}
