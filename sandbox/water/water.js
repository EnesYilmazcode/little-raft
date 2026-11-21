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
const SDF_RES = 64;       // texels per side
const SDF_SPAN = 32;      // metres covered, centred on the raft
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
// Noise-threshold foam: the mask lowers the cutoff, so foam grows from lacy specks to solid.
float foamCut(float mask, float noise) { return smoothstep(1.0 - mask, 1.0 - mask + 0.12, noise) * step(0.001, mask); }

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
  vec2 uv = l / ${SDF_SPAN.toFixed(1)} + 0.5;
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

  vec3 H = normalize(L + V);
  float ndh = max(dot(n, H), 0.0);
  float spec = min(pow(ndh, 260.0) * 1.6 + pow(ndh, 36.0) * 0.12, 1.4) * (1.0 - smoothstep(40.0, 120.0, dist) * 0.7);
  col += uSunColor * spec * shadow;

  vec2 fp = p + vec2(uTime * 0.35, uTime * 0.12);
  float n1 = vnoise(fp * 1.7), n2 = vnoise(fp * 4.3 + vec2(uTime * -0.2, uTime * 0.15));
  float fnoise = n1 * 0.6 + n2 * 0.4;

  // Foam 1: crests where the Gerstner map compresses (1 - J > threshold).
  vec3 jac = vec3(0.0);
  { vec2 p = vBase; ${glslJac} }
  float pinch = 1.0 - ((1.0 + jac.x) * (1.0 + jac.y) - jac.z * jac.z);
  float crest = foamCut(clamp((pinch - uFoamStart) * 9.0, 0.0, 0.9), fnoise);
  // Foam 2: contact band around the raft and floaters, with rings pulsing outward.
  float ring = 0.5 + 0.5 * sin(rd * 6.0 - uTime * 2.0 + n1 * 2.5);
  float raftMask = (1.0 - smoothstep(0.0, 1.1, rd)) * (0.55 + 0.45 * ring);
  float floatMask = 0.0;
  for (int i = 0; i < ${MAX_FLOATERS}; i++) {
    vec3 fl = uFloaters[i];
    if (fl.z <= 0.0) continue;
    float d = length(p - fl.xy) - fl.z;
    floatMask = max(floatMask, 1.0 - smoothstep(0.0, 0.45, d));
  }
  float mask = max(raftMask, floatMask * 0.85);
  mask = max(mask, contact);
  float foam = max(crest, foamCut(mask * 0.95, fnoise));
  foam = max(foam, (1.0 - smoothstep(0.0, 0.1, rd)) * 0.9);   // hard waterline on the logs
  foam *= 1.0 - smoothstep(30.0, 90.0, dist);
  col = mix(col, uFoam * (0.8 + 0.2 * shadow), foam * 0.9);

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

  const sdfData = new Uint8Array(SDF_RES * SDF_RES);
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
    uDeckLift: { value: options.deckLift ?? 0.45 },
    uFloaters: { value: Array.from({ length: MAX_FLOATERS }, () => new T.Vector3()) },
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

  // Bake the raft footprint (2 m tiles at tile*2) into a signed distance texture.
  function setRaft(tiles, x = 0, z = 0, yaw = 0) {
    const texel = SDF_SPAN / SDF_RES;
    for (let j = 0; j < SDF_RES; j++) {
      for (let i = 0; i < SDF_RES; i++) {
        const px = (i + 0.5) * texel - SDF_SPAN / 2, pz = (j + 0.5) * texel - SDF_SPAN / 2;
        let d = 1e9;
        for (const [tx, tz] of tiles) {
          const qx = Math.abs(px - tx * 2) - 1, qz = Math.abs(pz - tz * 2) - 1;
          const out = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)), inside = Math.min(Math.max(qx, qz), 0);
          d = Math.min(d, out + inside);
        }
        sdfData[j * SDF_RES + i] = Math.round(Math.min(Math.max((d + 2) / (SDF_MAX + 2), 0), 1) * 255);
      }
    }
    sdfTex.needsUpdate = true;
    uniforms.uRaft.value.set(x, z, yaw);
  }
  function setRaftPose(x, z, yaw) { uniforms.uRaft.value.set(x, z, yaw); }
  function setFloaters(list) {
    uniforms.uFloaters.value.forEach((v, i) => (list[i] ? v.set(list[i][0], list[i][1], list[i][2]) : v.set(0, 0, 0)));
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
    return BASE_Y + tmp[1];
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
