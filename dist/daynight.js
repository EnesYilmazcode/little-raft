// Day, night and weather for Little Raft (content module, see docs/features/daynight.md).
// One 20 minute cycle drives the sky, fog, ocean palette, sun/moon light, clouds, stars, moon,
// rain streaks and lantern glow. Weather is a pure function of (seed, clock), so co-op only syncs
// {clock, seed}. Everything is built once in createDayNight; update() allocates nothing.

export const DAY_SECONDS = 1200;
export const NIGHT_FLOOR = 0.38;
export const WEATHERS = Object.freeze(['calm', 'breezy', 'rain']);
export const POOL_LIGHTS = 4;     // most pool lights (graphics 'high')
export const POOL_CAP = Object.freeze({ low: 1, medium: 2, high: 4 });
export const poolCap = graphics => POOL_CAP[graphics] ?? POOL_CAP.medium;
export const MAX_CLOCK = 1.2e9;
export const SEGMENT_STEP = 270;   // mean segment length; real lengths are 180 to 360 s
export const SEGMENT_JITTER = 90;  // start of segment i = i*STEP + (hash - .5) * JITTER
export const BLEND_SECONDS = 25;
export const SNAP_SECONDS = 5;
export const MORNING = 0.10;       // default phase for a new world

// ---------------------------------------------------------------- pure helpers

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// Clock time of the next `toPhase` after `clock` (same day if it is still ahead, else the next day).
export function skipClock(clock, toPhase) {
  const cur = phaseAt(clock);
  const day = Math.floor((Number.isFinite(clock) && clock > 0 ? clock : 0) / DAY_SECONDS) + (cur >= toPhase ? 1 : 0);
  return day * DAY_SECONDS + toPhase * DAY_SECONDS;
}

// Live read-only mirror for other content modules (sleep.js). Written by update(), no allocation.
export const DAYNIGHT_LIVE = { phase: MORNING, optOut: false, ready: false };
// sleep.js SLEEP_START / SLEEP_END plus slack: a lie-down at .019 reaches the skip ~2 s later (after the hold and
// fade). Still well before MORNING (.10), so a second skip right after one stays refused.
const sleepable = p => p >= 0.66 || p < 0.04;

export function phaseAt(clock) {
  if (!Number.isFinite(clock) || clock < 0) return 0;
  const p = (clock % DAY_SECONDS) / DAY_SECONDS;
  return p >= 1 || !(p >= 0) ? 0 : p;
}

// Sun angle along its circle: day half (0 to .70, so dusk still has a low golden sun) above the horizon, night half below.
export function sunAngle(phase) {
  return phase < 0.7 ? (phase / 0.7) * Math.PI : Math.PI + ((phase - 0.7) / 0.3) * Math.PI;
}

export function lightAt(phase, out) {
  const p = phaseAt(phase * DAY_SECONDS);
  const q = p < 0.3 ? p + 1 : p; // unwrap so dawn (0 to .02) continues the night ramp
  const nf = smooth(0.62, 0.72, q) * (1 - smooth(0.92, 1.02, q));
  out.sunHeight = Math.sin(sunAngle(p));
  out.nightFactor = nf;
  out.light = Math.max(NIGHT_FLOOR, 1 - (1 - NIGHT_FLOOR) * nf);
  return out;
}

// uint32 hash of (seed, index, salt) -> [0, 1)
export function hash01(seed, index, salt) {
  let h = ((seed >>> 0) ^ Math.imul(salt | 0, 0x27d4eb2d)) >>> 0;
  h = (h ^ Math.imul(index | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Raw weights are chosen so that after the "no rain after rain" rule the shares are .5/.3/.2:
// rain r(1-r) = .2 -> r = .2764, calm c + r^2 = .5 -> c = .4236.
const RAW_CALM = 0.4236, RAW_BREEZY = 0.3;
function rawWeather(seed, i) {
  const u = hash01(seed, i, 2);
  return u < RAW_CALM ? 0 : u < RAW_CALM + RAW_BREEZY ? 1 : 2;
}
function weatherIndex(seed, i) {
  const w = rawWeather(seed, i);
  return w === 2 && rawWeather(seed, i - 1) === 2 ? 0 : w;
}
export function segmentStart(seed, i) {
  return i * SEGMENT_STEP + (hash01(seed, i, 1) - 0.5) * SEGMENT_JITTER;
}
export function segmentAt(seed, index, out) {
  const s = segmentStart(seed, index);
  out.index = index;
  out.weather = WEATHERS[weatherIndex(seed, index)];
  out.start = s;
  out.length = segmentStart(seed, index + 1) - s;
  return out;
}
export function segmentIndexAt(seed, clock) {
  const c = Number.isFinite(clock) && clock > 0 ? clock : 0;
  let i = Math.floor(c / SEGMENT_STEP);
  if (c < segmentStart(seed, i)) i--;
  else if (c >= segmentStart(seed, i + 1)) i++;
  return i;
}

// rain, wind, cloud for each weather (indexed like WEATHERS)
const W_RAIN = [0, 0, 1], W_WIND = [0.15, 0.7, 0.5], W_CLOUD = [0.25, 0.6, 0.95];
export function weatherParams(index, blendTo, blend, out) {
  out.rain = W_RAIN[index] + (W_RAIN[blendTo] - W_RAIN[index]) * blend;
  out.wind = W_WIND[index] + (W_WIND[blendTo] - W_WIND[index]) * blend;
  out.cloud = W_CLOUD[index] + (W_CLOUD[blendTo] - W_CLOUD[index]) * blend;
  return out;
}
export function weatherAt(seed, clock, out) {
  const c = Number.isFinite(clock) && clock > 0 ? clock : 0;
  const i = segmentIndexAt(seed, c);
  const end = segmentStart(seed, i + 1);
  const a = weatherIndex(seed, i), b = weatherIndex(seed, i + 1);
  const blend = smooth(end - BLEND_SECONDS, end, c);
  out.weather = WEATHERS[a];
  out.weatherNext = WEATHERS[b];
  out.blend = blend;
  return weatherParams(a, b, blend, out);
}

// ---------------------------------------------------------------- palette
// Colours (sRGB 0..1): 0 horizon (background, fog, ocean uSky), 1 ocean zenith, 2 ocean deep,
// 3 ocean shallow, 4 sun/moon light, 5 hemi sky, 6 hemi ground, 7 cloud.
export const N_COLORS = 8;
const hex = s => [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];
const key = (phase, ...colors) => ({ phase, c: new Float32Array(colors.flatMap(hex)) });
export const PALETTE_KEYS = Object.freeze([
  //   phase  horizon    zenith     deep       shallow    sun        hemi sky   hemi gnd   cloud
  key(0.00, '#efc3a4', '#b5bcc8', '#1a4a5c', '#4a8784', '#ffcf9e', '#f3d9c4', '#3f5c66', '#ffdcc8'), // sunrise peach
  key(0.04, '#efc3a4', '#b5bcc8', '#1a4a5c', '#4a8784', '#ffcf9e', '#f3d9c4', '#3f5c66', '#ffdcc8'), // ... held a little
  key(0.13, '#a6e9f2', '#2a8fd6', '#08355f', '#1a78b0', '#ffeccb', '#bfe6ff', '#2f6f7a', '#f4fbfc'), // bright tropical day (visuals loop)
  key(0.54, '#a6e9f2', '#2a8fd6', '#08355f', '#1a78b0', '#ffeccb', '#bfe6ff', '#2f6f7a', '#f4fbfc'),
  key(0.635, '#eaa98e', '#b79fb0', '#1d4a5e', '#4d7f88', '#ffb27e', '#f4c3a6', '#4b5a68', '#ffc9b0'), // dusk coral
  key(0.70, '#6f6f9e', '#58679a', '#173c54', '#2f6276', '#c3b0dc', '#a9a6d2', '#2c3b55', '#8e88b2'), // blue hour
  key(0.77, '#34486f', '#2e4170', '#0f3046', '#1f5066', '#a8bff0', '#9bb4e6', '#1f3044', '#5e6f98'), // cosy blue night
  key(0.91, '#34486f', '#2e4170', '#0f3046', '#1f5066', '#a8bff0', '#9bb4e6', '#1f3044', '#5e6f98'),
  key(0.94, '#6c7299', '#536392', '#163a50', '#2d5e70', '#c6b8da', '#aaaed2', '#2c3c52', '#aaa4c6'), // predawn
]);
// Rain pulls every colour toward a cool grey-green of similar brightness.
export const RAIN_MIX = 0.65;
const RAIN_TINT = new Float32Array([0.9, 0.98, 1.04]);
export function rainBlend(r, g, b, rain, out, o) {
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  const k = rain * RAIN_MIX;
  out[o] = r + (l * 0.9 * RAIN_TINT[0] - r) * k;
  out[o + 1] = g + (l * 0.9 * RAIN_TINT[1] - g) * k;
  out[o + 2] = b + (l * 0.9 * RAIN_TINT[2] - b) * k;
}
export function paletteAt(phase, rain, out) {
  const p = phaseAt(phase * DAY_SECONDS);
  const n = PALETTE_KEYS.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) { if (PALETTE_KEYS[k].phase <= p) i = k; else break; }
  const a = PALETTE_KEYS[i], b = PALETTE_KEYS[(i + 1) % n];
  const span = (i + 1 < n ? b.phase : 1) - a.phase;
  const t = span > 0 ? (p - a.phase) / span : 0;
  const r = clamp01(Number.isFinite(rain) ? rain : 0);
  for (let j = 0; j < N_COLORS * 3; j += 3) {
    rainBlend(a.c[j] + (b.c[j] - a.c[j]) * t, a.c[j + 1] + (b.c[j + 1] - a.c[j + 1]) * t, a.c[j + 2] + (b.c[j + 2] - a.c[j + 2]) * t, r, out, j);
  }
  return out;
}

// ---------------------------------------------------------------- save and sync
export function cleanDayNight(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const ver = v.v; // missing or 0 migrates; any later version is read as long as clock and seed validate
  if (ver !== undefined && ver !== 0 && !(typeof ver === 'number' && ver >= 1 && ver < Infinity)) return null;
  const { clock, seed } = v;
  if (typeof clock !== 'number' || !Number.isFinite(clock) || clock < 0 || clock > MAX_CLOCK) return null;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed >= 4294967296) return null;
  return { v: 1, clock, seed };
}

// Guest clock filter: snap on big errors, otherwise slew at most 10% fast or slow.
// local and target are both taken at the start of the step; the caller then advances target by dt.
export function driftStep(local, target, dt) {
  if (!Number.isFinite(local)) return Number.isFinite(target) ? target : 0;
  if (!(dt > 0)) return local;
  const err = target - local;
  if (!Number.isFinite(err)) return local + dt;
  if (err > SNAP_SECONDS || err < -SNAP_SECONDS) return target;
  let c = err * 0.5 * dt;
  const lim = 0.1 * dt;
  if (c > lim) c = lim; else if (c < -lim) c = -lim;
  return local + dt + c;
}

// ---------------------------------------------------------------- shaders
const STAR_VS = /* glsl */`
attribute float aSeed;
uniform float uTime;
uniform float uOpacity;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 0.65 + 0.35 * sin(uTime * (1.3 + aSeed * 2.7) + aSeed * 40.0);
  float h = smoothstep(-0.02, 0.28, normalize(position).y);
  vAlpha = uOpacity * tw * h * (0.55 + 0.45 * fract(aSeed * 7.13));
  gl_PointSize = 2.0 + 2.6 * fract(aSeed * 3.71);
  gl_Position = projectionMatrix * mv;
}`;
const STAR_FS = /* glsl */`
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = vAlpha * smoothstep(0.5, 0.1, length(d));
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * a, a);
}`;
const MOON_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const MOON_FS = /* glsl */`
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float disc = smoothstep(0.30, 0.28, r);
  float spots = 0.08 * smoothstep(0.12, 0.0, length(p - vec2(0.08, 0.07))) + 0.06 * smoothstep(0.08, 0.0, length(p - vec2(-0.1, -0.06)));
  vec3 moon = vec3(1.0, 0.97, 0.88) - spots;
  float halo = 0.6 * pow(clamp(1.0 - r, 0.0, 1.0), 2.0);
  vec3 col = moon * disc + vec3(0.75, 0.82, 1.0) * halo * (1.0 - disc);
  float a = (disc + halo * (1.0 - disc)) * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * uOpacity, a);
}`;
const RAIN_VS = /* glsl */`
attribute float aTop;
attribute float aIdx;
uniform float uTime;
uniform float uRain;
uniform float uWind;
uniform vec3 uCam;
uniform vec3 uBox;
varying float vFade;
void main() {
  if (aIdx > uRain) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vFade = 0.0; return; }
  vec3 drift = vec3(uWind * 3.0, -9.0, uWind * 1.2) * uTime;
  vec3 p = uCam + mod(position + drift - uCam, uBox) - uBox * 0.5;
  p += vec3(-uWind * 0.25, 0.8, -uWind * 0.1) * aTop;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = length(mv.xyz);
  vFade = smoothstep(1.4, 3.0, d) * (1.0 - smoothstep(6.0, 9.0, d));
  gl_Position = projectionMatrix * mv;
}`;
const RAIN_FS = /* glsl */`
uniform vec3 uColor;
uniform float uAlpha;
varying float vFade;
void main() {
  float a = uAlpha * vFade;
  if (a < 0.005) discard;
  gl_FragColor = vec4(uColor, a);
}`;

// Lantern mesh names and their night multipliers (base intensities are read from the model).
const LANTERN_PARTS = ['lanternGlow', 'flame', 'lanternGlass', 'candle'];
const LANTERN_MULT = [2.4, 2.2, 1.1, 3.0];
const GLASS_NIGHT = '#ffb35c'; // glass emissive is tinted toward this at night so it reads amber, not cream
const MAX_LANTERNS = 64, MAX_PARTS = MAX_LANTERNS * 4;
const STAR_COUNT = 700, STAR_RADIUS = 140, MOON_DIST = 120, RAIN_STREAKS = 600;
const SUN_RADIUS = Math.hypot(-15, 28, 12);
// The one shadow-casting light is the sun by day and the moon by night. Its direction swaps when the
// sun crosses the horizon, so its intensity fades to 0 over this band of |sunHeight| around the swap.
export const SWAP_FADE = 0.12;
export const POOL_PEAK = 2.8, POOL_RANGE = 4.5;
export const HEMI_NIGHT = 0.5, MOON_I = 0.4; // night floors: hemi intensity and moon (directional) intensity

// ---------------------------------------------------------------- opt out
export function dayNightOptedOut() {
  try {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('daynight') : null;
    if (q === 'off') return true;
  } catch {}
  try { if (typeof localStorage !== 'undefined' && localStorage.getItem('little-raft.daynight') === 'day') return true; } catch {}
  return false;
}

// ?daynight=off: a true no-op. It touches no light, colour, ocean or cloud and adds no objects;
// it only keeps the last valid slice so the save (and a host's state) passes through unchanged.
export function createDayNightOff(ctx) {
  let kept = null;
  return {
    name: 'daynight',
    load(data) { const d = cleanDayNight(data); if (d) kept = d; },
    serialize() { return kept ? { v: kept.v, clock: kept.clock, seed: kept.seed } : undefined; },
    debug: { state: () => ({ optOut: true, kept: kept ? { ...kept } : null, role: ctx?.role }) },
  };
}

// ---------------------------------------------------------------- module
export function createDayNight(ctx) {
  if (dayNightOptedOut()) return createDayNightOff(ctx);
  const T = ctx.T;
  const role0 = ctx.role;

  // ---- state
  let clock = MORNING * DAY_SECONDS;
  let seed = (Math.random() * 4294967296) >>> 0;
  let target = clock, hasTarget = false, lastNetClock = NaN, netAge = 0, hostStill = false;
  let time = 0, frozen = false;
  let pinPhase = NaN, pinWeather = -1;
  const L = { sunHeight: 0, nightFactor: 0, light: 1 };
  const W = { weather: 'calm', weatherNext: 'calm', blend: 0, rain: 0, wind: 0.15, cloud: 0.25 };
  const PAL = new Float32Array(N_COLORS * 3);

  // ---- scratch
  const cHorizon = new T.Color(), cZenith = new T.Color(), cDeep = new T.Color(), cShallow = new T.Color();
  const cSun = new T.Color(), cHemiSky = new T.Color(), cHemiGround = new T.Color(), cCloud = new T.Color();
  const cRain = new T.Color(), cRainCool = new T.Color('#a9c4e8'), cGlassNight = new T.Color(GLASS_NIGHT);
  const vDir = new T.Vector3(), vMoon = new T.Vector3(), vTmp = new T.Vector3();
  const AXIS = new T.Vector3(-0.78, 0, 0.62).normalize(), SIDE = new T.Vector3(0.62, 0, 0.78).normalize();
  const setSRGB = (c, o) => c.setRGB(PAL[o], PAL[o + 1], PAL[o + 2], T.SRGBColorSpace);

  // ---- remember what we change, so dispose() can put it back
  const scene0 = ctx.scene, ocean = ctx.ocean, sun = ctx.sun, hemi = ctx.hemi, renderer = ctx.renderer;
  const orig = {
    bg: scene0?.background?.isColor ? scene0.background.clone() : null,
    fogColor: scene0?.fog ? scene0.fog.color.clone() : null, fogNear: scene0?.fog?.near, fogFar: scene0?.fog?.far,
    exposure: renderer ? renderer.toneMappingExposure : 1,
    sunPos: sun ? sun.position.clone() : null, sunColor: sun ? sun.color.clone() : null, sunI: sun ? sun.intensity : 0,
    hemiColor: hemi ? hemi.color.clone() : null, hemiGround: hemi ? hemi.groundColor.clone() : null, hemiI: hemi ? hemi.intensity : 0,
    ocean: {},
  };
  const OCEAN_KEYS = ['uSky', 'uZenith', 'uDeep', 'uShallow', 'uSunDir', 'uSunColor', 'uFadeNear', 'uFadeFar', 'uFoam'];
  const ou = ocean?.uniforms ?? null;
  if (ou) for (const k of OCEAN_KEYS) if (ou[k]) orig.ocean[k] = ou[k].value?.clone ? ou[k].value.clone() : ou[k].value;
  const oceanSunColor = ou?.uSunColor?.value?.clone ? ou.uSunColor.value.clone() : new T.Color('#fff3d6');
  const oceanFoam = ou?.uFoam?.value?.clone ? ou.uFoam.value.clone() : new T.Color('#eefbf8');
  const fadeNear0 = typeof ou?.uFadeNear?.value === 'number' ? ou.uFadeNear.value : 28;

  // ---- clouds: one module-owned material, original materials restored on dispose
  const cloudMat = new T.MeshStandardMaterial({ color: '#e7f9eb', roughness: 0.85, metalness: 0 });
  const cloudMeshes = [], cloudOrig = [], cloudGroups = [], cloudBase = [];
  for (const g of ctx.clouds ?? []) {
    if (!g?.isObject3D) continue;
    cloudGroups.push(g); cloudBase.push(g.position.x, g.scale.x, g.scale.z);
    for (const m of g.children) if (m.isMesh) { cloudMeshes.push(m); cloudOrig.push(m.material); m.material = cloudMat; }
  }

  // ---- stars
  const starGeo = new T.BufferGeometry();
  {
    const pos = new Float32Array(STAR_COUNT * 3), sd = new Float32Array(STAR_COUNT);
    let s = 0x51a7;
    const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = 0; i < STAR_COUNT; i++) {
      const y = 0.02 + 0.98 * Math.pow(rnd(), 0.8), a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * STAR_RADIUS; pos[i * 3 + 1] = y * STAR_RADIUS; pos[i * 3 + 2] = Math.sin(a) * r * STAR_RADIUS;
      sd[i] = rnd();
    }
    starGeo.setAttribute('position', new T.BufferAttribute(pos, 3));
    starGeo.setAttribute('aSeed', new T.BufferAttribute(sd, 1));
  }
  const starUniforms = { uTime: { value: 0 }, uOpacity: { value: 0 } };
  const starMat = new T.ShaderMaterial({ uniforms: starUniforms, vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false, fog: false, toneMapped: false, blending: T.AdditiveBlending });
  const stars = new T.Points(starGeo, starMat);
  stars.name = 'daynight-stars'; stars.frustumCulled = false; stars.renderOrder = -5; stars.visible = false;

  // ---- moon
  const moonGeo = new T.PlaneGeometry(34, 34);
  const moonUniforms = { uOpacity: { value: 0 } };
  const moonMat = new T.ShaderMaterial({ uniforms: moonUniforms, vertexShader: MOON_VS, fragmentShader: MOON_FS, transparent: true, depthWrite: false, fog: false, toneMapped: false });
  const moon = new T.Mesh(moonGeo, moonMat);
  moon.name = 'daynight-moon'; moon.frustumCulled = false; moon.renderOrder = -4; moon.visible = false;

  // ---- rain
  const BOX_X = 14, BOX_Y = 10, BOX_Z = 14;
  const rainGeo = new T.BufferGeometry();
  {
    const pos = new Float32Array(RAIN_STREAKS * 6), top = new Float32Array(RAIN_STREAKS * 2), idx = new Float32Array(RAIN_STREAKS * 2);
    let s = 0x2ad1;
    const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
    for (let i = 0; i < RAIN_STREAKS; i++) {
      const x = rnd() * BOX_X, y = rnd() * BOX_Y, z = rnd() * BOX_Z, f = (i + 0.5) / RAIN_STREAKS;
      for (let k = 0; k < 2; k++) { const o = (i * 2 + k) * 3; pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; top[i * 2 + k] = k; idx[i * 2 + k] = f; }
    }
    rainGeo.setAttribute('position', new T.BufferAttribute(pos, 3));
    rainGeo.setAttribute('aTop', new T.BufferAttribute(top, 1));
    rainGeo.setAttribute('aIdx', new T.BufferAttribute(idx, 1));
  }
  const rainUniforms = { uTime: { value: 0 }, uRain: { value: 0 }, uWind: { value: 0 }, uCam: { value: new T.Vector3() }, uBox: { value: new T.Vector3(BOX_X, BOX_Y, BOX_Z) }, uColor: { value: new T.Color('#d7e2e6') }, uAlpha: { value: 0 } };
  const rainMat = new T.ShaderMaterial({ uniforms: rainUniforms, vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false, fog: false, toneMapped: false });
  const rain = new T.LineSegments(rainGeo, rainMat);
  rain.name = 'daynight-rain'; rain.frustumCulled = false; rain.visible = false; rain.renderOrder = 5;

  // ---- lantern pool lights. Built once, but only added to the scene after the first lantern is found
  // (the first scan runs in the first update, before the first render, so existing lanterns cause no
  // extra shader compile). From then on the count only changes with the graphics setting, never by time.
  const pool = [];
  for (let i = 0; i < POOL_LIGHTS; i++) {
    const l = new T.PointLight('#ffb35c', 0, POOL_RANGE, 2);
    l.castShadow = false; l.name = 'daynight-lantern-light'; pool.push(l);
  }
  const owned = [stars, moon, rain];
  let attached = null, poolOn = 0, poolWanted = false, poolGraphics = '';
  function attach(scene) {
    if (attached === scene) return;
    if (attached) { for (const o of owned) attached.remove(o); for (let i = 0; i < poolOn; i++) attached.remove(pool[i]); }
    attached = scene;
    if (scene) { for (const o of owned) scene.add(o); for (let i = 0; i < poolOn; i++) scene.add(pool[i]); }
  }
  function sizePool() {
    const g = ctx.options?.graphics;
    if (g === poolGraphics && !(poolWanted && poolOn === 0)) return;
    poolGraphics = g;
    const n = poolWanted ? poolCap(g) : 0;
    while (poolOn > n) { poolOn--; pool[poolOn].intensity = 0; attached?.remove(pool[poolOn]); }
    while (poolOn < n) { attached?.add(pool[poolOn]); poolOn++; }
  }
  attach(scene0);

  // ---- lantern cache
  const partMat = new Array(MAX_PARTS).fill(null), partBase = new Float64Array(MAX_PARTS), partMult = new Float64Array(MAX_PARTS);
  const partColor = new Float64Array(MAX_PARTS * 3), partTint = new Uint8Array(MAX_PARTS); // base emissive rgb, 1 = glass (tinted at night)
  const lanternGroups = new Array(MAX_LANTERNS).fill(null), lanternLocal = new Float32Array(MAX_LANTERNS * 3), lanternDist = new Float32Array(MAX_LANTERNS);
  const poolPick = new Int32Array(POOL_LIGHTS).fill(-1);
  let partCount = 0, lanternCount = 0, signature = -1, scanClock = 0, rankClock = 0, poolLit = 0, lastNf = -1, lastGrow = -1;
  let scanRaft = null, scanFirst = null, scanLen = -1, scanRev; // what raft.children looked like at the last scan (rev: game.js raft.userData.rev)
  function lanternSignature(raft, world) {
    let n = raft.children.length * 131;
    const decor = world?.decor;
    if (Array.isArray(decor)) for (let i = 0; i < decor.length; i++) if (decor[i]?.type === 'lantern' || decor[i]?.type === 'candle') n++; // [bees] candles glow too
    return n;
  }
  function restoreParts() {
    for (let i = 0; i < partCount; i++) {
      const m = partMat[i]; if (!m) continue;
      m.emissiveIntensity = partBase[i];
      if (partTint[i]) m.emissive.setRGB(partColor[i * 3], partColor[i * 3 + 1], partColor[i * 3 + 2]);
    }
  }
  function scanLanterns(raft) {
    restoreParts();
    partCount = 0; lanternCount = 0;
    for (let c = 0; c < raft.children.length && lanternCount < MAX_LANTERNS; c++) {
      const g = raft.children[c];
      if (g.name !== 'craft_lantern' && g.name !== 'craft_candle') continue; // [bees]
      let found = false;
      for (let k = 0; k < g.children.length; k++) {
        const m = g.children[k];
        if (!m.isMesh || !m.material || !('emissiveIntensity' in m.material)) continue;
        const pi = LANTERN_PARTS.indexOf(m.name);
        if (pi < 0 || partCount >= MAX_PARTS) continue;
        const e = m.material.emissive;
        partMat[partCount] = m.material; partBase[partCount] = m.material.emissiveIntensity; partMult[partCount] = LANTERN_MULT[pi];
        partTint[partCount] = pi === 2 && e?.isColor ? 1 : 0;
        if (e?.isColor) { partColor[partCount * 3] = e.r; partColor[partCount * 3 + 1] = e.g; partColor[partCount * 3 + 2] = e.b; }
        partCount++;
        if (pi === 0 && m.geometry) {
          if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
          const s = m.geometry.boundingSphere.center;
          lanternLocal[lanternCount * 3] = g.position.x + s.x; lanternLocal[lanternCount * 3 + 1] = g.position.y + s.y; lanternLocal[lanternCount * 3 + 2] = g.position.z + s.z;
          found = true;
        }
      }
      if (!found) { lanternLocal[lanternCount * 3] = g.position.x + 0.3; lanternLocal[lanternCount * 3 + 1] = g.position.y + 1.24; lanternLocal[lanternCount * 3 + 2] = g.position.z; }
      lanternGroups[lanternCount++] = g;
    }
    for (let i = lanternCount; i < MAX_LANTERNS; i++) lanternGroups[i] = null;
    for (let i = partCount; i < MAX_PARTS; i++) partMat[i] = null;
    scanRaft = raft; scanFirst = raft.children.length ? raft.children[0] : null; scanLen = raft.children.length; scanRev = raft.userData?.rev;
    if (lanternCount > 0) poolWanted = true;
    rankClock = 1e9;
  }
  function rankLanterns(raft, cam) {
    for (let i = 0; i < POOL_LIGHTS; i++) poolPick[i] = -1;
    for (let i = 0; i < lanternCount; i++) {
      vTmp.set(lanternLocal[i * 3], lanternLocal[i * 3 + 1], lanternLocal[i * 3 + 2]);
      raft.localToWorld(vTmp);
      lanternDist[i] = cam ? vTmp.distanceToSquared(cam.position) : i;
      // partial selection: insert into the sorted pick list of 4
      let j = POOL_LIGHTS - 1;
      if (poolPick[j] >= 0 && lanternDist[poolPick[j]] <= lanternDist[i]) continue;
      while (j > 0 && (poolPick[j - 1] < 0 || lanternDist[poolPick[j - 1]] > lanternDist[i])) { poolPick[j] = poolPick[j - 1]; j--; }
      poolPick[j] = i;
    }
  }

  // ---- per frame
  // Sky, palette, light and weather move over minutes (a 20 minute day, 25 s weather blends), so refreshSky()
  // recomputes them at most every SKY_STEP seconds of game clock, and at once when something jumps (load, a
  // debug pin or phase, a new seed, scene or ocean). Each frame only does the camera, sun-target, cloud
  // drift, rain, lantern and flicker work. A 0.1 s step turns the sun by under 0.05 degrees: far below a
  // shadow texel, so the shadow never visibly steps.
  const SKY_STEP = 0.1;
  let skyClock = NaN, skyPin = NaN, skyPinW = -2, skySeed = -1, skyScene = null, skyOcean = null, skyDirty = true;
  let nf = 0, wet = 0, poolI = 0;
  const mLook = new T.Matrix4(), ORIGIN = new T.Vector3();
  function refreshSky(phase, scene) {
    lightAt(phase, L);
    if (pinWeather >= 0) { W.weather = W.weatherNext = WEATHERS[pinWeather]; W.blend = 0; weatherParams(pinWeather, pinWeather, 0, W); }
    else weatherAt(seed, clock, W);
    paletteAt(phase, W.rain, PAL);
    nf = L.nightFactor; wet = W.rain;
    setSRGB(cHorizon, 0); setSRGB(cZenith, 3); setSRGB(cDeep, 6); setSRGB(cShallow, 9);
    setSRGB(cSun, 12); setSRGB(cHemiSky, 15); setSRGB(cHemiGround, 18); setSRGB(cCloud, 21);
    const cool = Math.max(0, W.wind - 0.15) * (1 - wet) * 0.15 / 0.55; // breezy: cooler (0.15 at full breeze)
    cHorizon.r *= 1 - cool; cHorizon.g *= 1 - cool * 0.4; cCloud.r *= 1 - cool;

    // sky, fog (nothing else writes these per frame, so they only change here)
    if (scene) {
      if (scene.background?.isColor) scene.background.copy(cHorizon);
      if (scene.fog) { scene.fog.color.copy(cHorizon); scene.fog.near = 60 - 44 * wet; scene.fog.far = 260 - 180 * wet; }
    }
    // sun / moon direction
    const th = sunAngle(phaseAt(phase * DAY_SECONDS));
    const ct = Math.cos(th), st = Math.sin(th);
    const up = L.sunHeight >= 0;
    vMoon.set(-AXIS.x * ct - SIDE.x * 0.6, -st * 0.5, -AXIS.z * ct - SIDE.z * 0.6).normalize(); // the moon rides low, opposite the sun
    if (up) vDir.set(AXIS.x * ct - SIDE.x * 0.32, st, AXIS.z * ct - SIDE.z * 0.32).normalize();
    else vDir.copy(vMoon);
    const dayI = 3.0 * (1 - 0.15 * wet) * smooth(-0.02, 0.2, L.sunHeight);
    const moonI = MOON_I * (1 - 0.3 * wet) * smooth(-0.02, 0.2, -L.sunHeight);
    const swap = smooth(0, SWAP_FADE, Math.abs(L.sunHeight)); // 0 exactly where sun and moon trade places
    if (sun) { sun.color.copy(cSun); sun.intensity = Math.max(dayI + moonI, MOON_I * smooth(0.3, 0.7, nf)) * swap; } // position: per frame in applyVisuals
    if (hemi) {
      hemi.color.copy(cHemiSky); hemi.groundColor.copy(cHemiGround);
      hemi.intensity = HEMI_NIGHT + (1.0 - HEMI_NIGHT) * (L.light - NIGHT_FLOOR) / (1 - NIGHT_FLOOR) * (1 - 0.08 * wet); // day 1.0 (visuals: blue sky fill), dark nights
    }
    if (renderer) renderer.toneMappingExposure = 1.1 - 0.25 * nf;
    // ocean
    const u = ctx.ocean?.uniforms;
    if (u) {
      u.uSky?.value.copy(cHorizon); u.uZenith?.value.copy(cZenith);
      u.uDeep?.value.copy(cDeep).multiplyScalar(1 - 0.3 * wet); u.uShallow?.value.copy(cShallow).multiplyScalar(1 - 0.3 * wet);
      if (u.uFadeFar && scene?.fog) u.uFadeFar.value = Math.min(scene.fog.far, 190); // camera.far is 200
      if (u.uFadeNear) u.uFadeNear.value = fadeNear0 * (1 - 0.55 * Math.max(nf, smooth(0.2, 0, L.sunHeight))); // no light band at the horizon after sunset
      u.uSunDir?.value.copy(vDir);
      if (u.uSunColor) {
        const spec = (up ? smooth(-0.02, 0.15, L.sunHeight) : 0.1 * smooth(-0.02, 0.2, -L.sunHeight)) * (1 - 0.7 * wet) * swap;
        u.uSunColor.value.copy(oceanSunColor).multiply(cSun).multiplyScalar(spec);
      }
      if (u.uFoam) u.uFoam.value.copy(oceanFoam).lerp(cHemiSky, 0.35 * nf).multiplyScalar((1 - 0.6 * nf) * (1 - 0.35 * wet)); // soft moonlit foam
    }
    // clouds
    const low = 1 - smooth(0.1, 0.5, Math.abs(L.sunHeight)); // sun near the horizon: lit from below, not dark
    cloudMat.color.copy(cCloud).multiplyScalar(1 - 0.35 * wet); // rain: darker grey
    cloudMat.emissive.copy(cCloud).multiplyScalar((0.32 + 0.18 * nf + 0.3 * low) * (1 - 0.5 * wet)); // soft self-lit undersides
    const grow = 1 + (W.cloud - 0.25) * 0.8; // drift is per frame in applyVisuals
    if (grow !== lastGrow) {
      lastGrow = grow;
      for (let i = 0; i < cloudGroups.length; i++) { const g = cloudGroups[i]; g.scale.x = cloudBase[i * 3 + 1] * grow; g.scale.z = cloudBase[i * 3 + 2] * grow; }
    }
    // stars and moon (the moon faces the camera from vMoon; its turn depends only on that direction)
    const starA = nf * (1 - 0.85 * W.cloud * W.cloud) * (1 - wet);
    starUniforms.uOpacity.value = starA;
    stars.visible = starA > 0.01;
    const moonA = smooth(0.1, 0.7, nf) * smooth(-0.02, 0.1, vMoon.y) * (1 - 0.75 * wet);
    moonUniforms.uOpacity.value = moonA;
    moon.visible = moonA > 0.01;
    mLook.lookAt(ORIGIN, vMoon, moon.up); moon.quaternion.setFromRotationMatrix(mLook);
    // rain
    rain.visible = wet > 0.01;
    rainUniforms.uRain.value = wet; rainUniforms.uWind.value = W.wind;
    cRain.copy(cHemiSky).lerp(cHorizon, 0.3).lerp(cRainCool, 0.5 * nf).multiplyScalar(0.8 + 0.6 * L.light);
    rainUniforms.uColor.value.copy(cRain); rainUniforms.uAlpha.value = (0.85 + 0.15 * nf) * Math.min(1, wet * 1.5);
    poolI = nf < 0.15 ? 0 : POOL_PEAK * smooth(0.15, 1, nf);
  }

  function applyVisuals(dt) {
    const scene = ctx.scene, cam = ctx.camera, raft = ctx.raft;
    attach(scene);
    if (skyDirty || !(Math.abs(clock - skyClock) < SKY_STEP) || !Object.is(pinPhase, skyPin) || pinWeather !== skyPinW
      || seed !== skySeed || scene !== skyScene || ctx.ocean !== skyOcean) {
      skyDirty = false; skyClock = clock; skyPin = pinPhase; skyPinW = pinWeather; skySeed = seed; skyScene = scene; skyOcean = ctx.ocean;
      refreshSky(Number.isFinite(pinPhase) ? pinPhase : phaseAt(clock), scene);
    }
    // the sun keeps its offset from the shadow-fitted target, which can move between refreshes
    if (sun) sun.position.set(vDir.x * SUN_RADIUS, Math.max(vDir.y, 0.42) * SUN_RADIUS, vDir.z * SUN_RADIUS).add(sun.target.position);
    // clouds drift
    const drift = (W.wind - 0.15) * 0.9 * dt;
    if (drift > 0) for (let i = 0; i < cloudGroups.length; i++) { const g = cloudGroups[i]; g.position.x += drift; if (g.position.x > 85) g.position.x -= 170; }
    // stars and moon follow the camera
    starUniforms.uTime.value = time;
    if (cam) {
      stars.position.copy(cam.position);
      moon.position.copy(cam.position).addScaledVector(vMoon, MOON_DIST);
    }
    // rain
    const oc = ctx.ocean; // no rain streaks around an underwater camera (same test as diving.js setUnderwater)
    rain.visible = wet > 0.01 && !(cam && typeof oc?.getHeight === 'function' && cam.position.y < oc.getHeight(cam.position.x, cam.position.z) - 0.05);
    if (rain.visible) {
      rainUniforms.uTime.value = time;
      if (cam) rainUniforms.uCam.value.copy(cam.position);
    }
    // lanterns
    if (raft) {
      // O(1) every frame: rebuildRaft() bumps raft.userData.rev whenever it adds or removes a child (older hosts replaced every child, so the first child or the child count
      // changed, or our first lantern lost its parent). Rescan at once so new lanterns never show a dim frame.
      const n = raft.children.length;
      if (raft !== scanRaft || n !== scanLen || (n ? raft.children[0] : null) !== scanFirst || raft.userData?.rev !== scanRev || (lanternCount > 0 && lanternGroups[0].parent !== raft)) {
        scanClock = 0; signature = lanternSignature(raft, ctx.world); scanLanterns(raft); lastNf = -1;
      }
      scanClock += dt;
      if (scanClock >= 0.5) { // slow path: decor list changed without touching the raft children
        scanClock = 0;
        let stale = false;
        for (let i = 0; i < lanternCount; i++) if (lanternGroups[i].parent !== raft) { stale = true; break; }
        const sig = lanternSignature(raft, ctx.world);
        if (stale || sig !== signature) { signature = sig; scanLanterns(raft); lastNf = -1; }
      }
      if (nf !== lastNf) {
        lastNf = nf;
        for (let i = 0; i < partCount; i++) {
          const m = partMat[i];
          m.emissiveIntensity = partBase[i] * (1 + (partMult[i] - 1) * nf);
          if (partTint[i]) m.emissive.setRGB(partColor[i * 3], partColor[i * 3 + 1], partColor[i * 3 + 2]).lerp(cGlassNight, 0.7 * nf);
        }
      }
      rankClock += dt;
      if (rankClock >= 0.5) { rankClock = 0; rankLanterns(raft, cam); }
    }
    sizePool();
    poolLit = 0;
    for (let i = 0; i < poolOn; i++) {
      const l = pool[i], k = poolPick[i];
      if (k < 0 || k >= lanternCount || poolI <= 0 || !raft) { l.intensity = 0; continue; }
      l.position.set(lanternLocal[k * 3], lanternLocal[k * 3 + 1], lanternLocal[k * 3 + 2]);
      raft.localToWorld(l.position);
      l.intensity = poolI * (0.94 + 0.06 * Math.sin(time * 7.3 + k * 1.7)); // gentle candle flicker
      poolLit++;
    }
  }

  function update(dt) {
    if (!(dt > 0)) dt = 0; else if (dt > 0.25) dt = 0.25;
    time += dt;
    if (ctx.role === 'guest') {
      netAge += dt;
      if (hostStill) clock = target; // host clock stopped (frozen): hold it, do not run ahead
      else if (hasTarget) { clock = driftStep(clock, target, dt); target += dt; } // both measured at frame start
      else clock += dt;
    } else if (!frozen) clock += dt;
    if (clock > MAX_CLOCK) clock = 0;
    DAYNIGHT_LIVE.phase = Number.isFinite(pinPhase) ? pinPhase : phaseAt(clock); DAYNIGHT_LIVE.ready = true; // the day-only opt-out is a no-op now, so DAYNIGHT_LIVE.optOut stays false
    applyVisuals(dt);
  }

  function load(data, from) {
    skyDirty = true;
    const d = cleanDayNight(data);
    if (!d) {
      // back on our own raft with no usable slice: start a fresh morning instead of keeping the host's sky
      if (from === 'restore') { clock = MORNING * DAY_SECONDS; seed = (Math.random() * 4294967296) >>> 0; resetNet(); }
      return;
    }
    if (from === 'net') {
      if (d.clock === lastNetClock && d.seed === seed) {
        // Same message again. Within one send interval it is a plain duplicate: no-op. If the host keeps
        // sending the same clock for longer, its clock has stopped, so stop advancing the target too.
        if (netAge > 0.2) { hostStill = true; target = d.clock; }
        return;
      }
      lastNetClock = d.clock; netAge = 0; hostStill = false;
      if (!hasTarget || d.seed !== seed || Math.abs(d.clock - clock) > SNAP_SECONDS) { clock = d.clock; seed = d.seed; }
      target = d.clock; hasTarget = true;
      return;
    }
    clock = d.clock; seed = d.seed; resetNet();
  }
  function resetNet() { target = clock; hasTarget = false; lastNetClock = NaN; netAge = 0; hostStill = false; }

  function serialize() {
    return { v: 1, clock: Math.round(clock * 100) / 100, seed };
  }

  // Host only: 'daynight.skipTo' (sleep.js). Claims the kind always; applies only at dusk/night.
  function action(a, actor) {
    if (!a || a.kind !== 'daynight.skipTo') return false;
    if (actor !== 'host' || ctx.role === 'guest') return true;
    const to = a.phase;
    if (typeof to !== 'number' || !Number.isFinite(to) || to < 0 || to >= 1 || !sleepable(phaseAt(clock))) return true;
    clock = skipClock(clock, to); pinPhase = NaN;
    return true;
  }

  function dispose() {
    DAYNIGHT_LIVE.ready = false;
    restoreParts();
    attach(null);
    for (let i = 0; i < cloudMeshes.length; i++) cloudMeshes[i].material = cloudOrig[i];
    for (let i = 0; i < cloudGroups.length; i++) { cloudGroups[i].position.x = cloudBase[i * 3]; cloudGroups[i].scale.x = cloudBase[i * 3 + 1]; cloudGroups[i].scale.z = cloudBase[i * 3 + 2]; }
    if (scene0) {
      if (orig.bg && scene0.background?.isColor) scene0.background.copy(orig.bg);
      if (scene0.fog && orig.fogColor) { scene0.fog.color.copy(orig.fogColor); scene0.fog.near = orig.fogNear; scene0.fog.far = orig.fogFar; }
    }
    if (renderer) renderer.toneMappingExposure = orig.exposure;
    if (sun) { sun.position.copy(orig.sunPos); sun.color.copy(orig.sunColor); sun.intensity = orig.sunI; }
    if (hemi) { hemi.color.copy(orig.hemiColor); hemi.groundColor.copy(orig.hemiGround); hemi.intensity = orig.hemiI; }
    if (ou) for (const k in orig.ocean) { const v = orig.ocean[k]; if (v?.isColor || v?.isVector3) ou[k].value.copy(v); else ou[k].value = v; }
    for (const g of [starGeo, moonGeo, rainGeo]) g.dispose();
    for (const m of [starMat, moonMat, rainMat, cloudMat]) m.dispose();
    for (const l of pool) l.dispose?.();
  }

  const debug = {
    setPhase(p) {
      skyDirty = true;
      if (p === null || p === undefined) { pinPhase = NaN; return; }
      const v = Number(p);
      if (!Number.isFinite(v)) return;
      const ph = ((v % 1) + 1) % 1;
      if (ctx.role === 'guest') { pinPhase = ph; return; }
      clock = Math.floor(clock / DAY_SECONDS) * DAY_SECONDS + ph * DAY_SECONDS;
      pinPhase = NaN;
    },
    setWeather(w) {
      skyDirty = true;
      if (w === null || w === undefined) { pinWeather = -1; return; }
      const i = WEATHERS.indexOf(w);
      if (i >= 0) pinWeather = i;
    },
    freeze(on = true) { frozen = !!on; },
    giveLantern(n = 1) { try { return ctx.localBag().add('lantern', Math.max(1, Math.min(10, n | 0))) === 0; } catch { return false; } },
    placeLantern(x = 1, z = 1) {
      try { ctx.localBag().add('lantern', 1); ctx.action({ kind: 'build', recipe: 'lantern', x: x | 0, z: z | 0 }); return true; } catch { return false; }
    },
    renderInfo() { const r = ctx.renderer?.info?.render; return r ? { calls: r.calls, triangles: r.triangles, points: r.points, lines: r.lines } : null; },
    state() {
      return {
        phase: Number.isFinite(pinPhase) ? pinPhase : phaseAt(clock), day: Math.floor(clock / DAY_SECONDS), clock, seed,
        nightFactor: L.nightFactor, light: L.light, weather: W.weather, weatherNext: W.weatherNext, blend: W.blend,
        rain: W.rain, wind: W.wind, cloud: W.cloud, lanterns: lanternCount, poolLit,
        pinned: { phase: Number.isFinite(pinPhase) ? pinPhase : null, weather: pinWeather >= 0 ? WEATHERS[pinWeather] : null, optOut: false, frozen },
        role: ctx.role ?? role0,
      };
    },
  };

  return { name: 'daynight', update, serialize, load, action, dispose, debug, get wind() { return W.wind; }, get rain() { return W.rain; } };
}
