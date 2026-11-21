// Little Raft material registry (art lane, see docs/cloud/art.md).
// One shared MeshStandardMaterial per preset (and per tint), all sampling the textures.js atlas, so the
// whole scene answers light the same way. A tiny shader patch makes each material read its own atlas
// cell with fract() + textureGrad (cells tile like normal textures, no mip seams) and take roughness
// from the normal atlas alpha. All patched materials share one program per feature set.
//
//   getMaterial(T, 'planks')                    -> shared preset material
//   getMaterial(T, 'plank', {color:'#bb8a53'})  -> same preset, tinted toward the colour (TINT, clamped gain)
//   materialForColor(T, '#bb8a53')              -> game palette hex -> textured material (or null)
//   applyLighting(scene, renderer)              -> recommended warm tropical rig (LIGHTING)
//   artEnabled()                                -> true when the page URL has ?art (temporary hook gate)
import { getAtlas } from './textures.js';

// Tuned against the research notes (sandbox/art/notes/research.md). roughness scales the map's roughness.
// repeat = tiles per UV unit. normalScale = strength of the baked normal.
export const PRESETS = {
  planks:  { cell: 'planks',  roughness: 1,    metalness: 0,    normalScale: 1.0, repeat: [1, 1] },
  plank:   { cell: 'plank',   roughness: 1,    metalness: 0,    normalScale: 0.9, repeat: [1, 3] }, // deck board: u across (0.34 m), v along
  bark:    { cell: 'bark',    roughness: 1,    metalness: 0,    normalScale: 1.2, repeat: [2, 4] }, // deck logs ~0.4 m round x 2 m
  plastic: { cell: 'plastic', roughness: 1,    metalness: 0,    normalScale: 0.8, repeat: [1, 1], transparent: true, opacity: 0.95, side: 'double' },
  foliage: { cell: 'leaf',    roughness: 1,    metalness: 0,    normalScale: 0.7, repeat: [14, 7] }, // dense bush/island canopy, opaque
  leaf:    { cell: 'leaf',    roughness: 1,    metalness: 0,    normalScale: 1.0, repeat: [1, 1], cutout: 0.5, side: 'double' },
  rope:    { cell: 'rope',    roughness: 1,    metalness: 0,    normalScale: 1.2, repeat: [3, 3] }, // tuned for deck lashing torus lay (~32 deg)
  scrap:   { cell: 'scrap',   roughness: 1,    metalness: 0.5,  normalScale: 1.0, repeat: [1, 1], metalMap: true }, // x metal mask in albedo alpha; capped: no env map in game
  sand:    { cell: 'sand',    roughness: 1,    metalness: 0,    normalScale: 0.8, repeat: [3, 3] },
  rock:    { cell: 'rock',    roughness: 1,    metalness: 0,    normalScale: 1.2, repeat: [2, 2] },
  foam:    { cell: 'foam',    roughness: 1,    metalness: 0,    normalScale: 0.3, repeat: [1, 1], transparent: true, depthWrite: false },
  cloth:   { cell: 'cloth',   roughness: 1,    metalness: 0,    normalScale: 0.7, repeat: [2, 2], side: 'double' },
};

// Recommended rig: sky-blue hemisphere over a sea-teal bounce, warm sun about 3x the fill, fog matching
// the horizon so the sea melts into the sky. Distances in metres. sky* = optional gradient dome (cheap,
// no clouds of its own: the game's mesh clouds stay the one cloud style),
// ocean* = ocean.js uniforms retinted by applyOceanLook().
export const LIGHTING = {
  background: '#c6e3f0', fog: '#c6e3f0', fogNear: 38, fogFar: 150,
  hemiSky: '#bfe3ff', hemiGround: '#6f9fa4', hemiIntensity: 1.1,
  sun: '#ffe7c2', sunIntensity: 2.8, exposure: 1.0,
  skyDome: true, skyZenith: '#5aa6e0',
  oceanDeep: '#05497a', oceanShallow: '#13a0b0', oceanZenith: '#4f9fd6',
};

// Game palette hex -> preset. Explicit, so avatars, UI ghosts and the hook keep their own materials.
export const COLOR_PRESETS = {
  planks: [],
  plank: ['#bb8a53', '#c69860', '#ad7c4a', '#9c7649', '#c8995f', '#d3a368', '#8c6745', '#d5a265', '#a97d4c', '#b4824b', '#906f48', '#725942', '#756a49', '#ad8153',
    '#a8703f', '#b98148', '#9a6538', '#6b4426', '#ac9466', '#9e8762', '#b49c6c', '#907a57'], // last four: weathered deck boards (deck.js)
  bark: ['#5e4029', '#5e3b20'],
  rope: ['#a8946c', '#b89a64', '#e9d39a'],
  scrap: ['#4b4844', '#8e9aa2', '#6f6964', '#6d757b', '#9a5a32'],
  foliage: ['#4f9b72'],
  plastic: ['#f2f0e6'], // jug body (plastic.js), swapped in by the game hook
  leaf: ['#72ae59', '#519b55', '#6bb84c', '#5fae45', '#7d8a3d'],
  sand: ['#e6d7a3'],
  cloth: ['#fff3cf'],
};
const COLOR_OPTS = { '#f2f0e6': { repeat: [3, 1] } }; // per-colour overrides (jug lathe uv: u around ~1.7 m)
const COLOR_TO_PRESET = new Map(Object.entries(COLOR_PRESETS).flatMap(([p, list]) => list.map(c => [c.toLowerCase(), p])));

export const artEnabled = () => typeof location !== 'undefined' && /[?&]art(=1|&|$)/.test(location.search);

const cache = new Map();
const TINT = 0.8; // how far game palette colours pull a texture's own colour (1 = exact average)
const FRAG_HEAD = `
uniform vec4 lrCell; // atlas cell: xy offset, zw size
uniform float lrCut; // alpha cutout threshold (0 = off). Not material.alphaTest: three's shadow depth
                     // material would copy map+alphaTest and sample the whole atlas with leaf uvs.
uniform vec4 lrScale; // xy tiles per uv unit, zw phase offset
vec4 lrTex(sampler2D s, vec2 uv) {
  uv = uv * lrScale.xy + lrScale.zw;
  vec2 dx = dFdx(uv) * lrCell.zw, dy = dFdy(uv) * lrCell.zw;
  return textureGrad(s, lrCell.xy + fract(uv) * lrCell.zw, dx, dy);
}
`;
function patch(T, shader, u) {
  shader.uniforms.lrCell = u.cell; shader.uniforms.lrScale = u.scale; shader.uniforms.lrCut = u.cut;
  const C = T.ShaderChunk;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>' + FRAG_HEAD)
    .replace('#include <map_fragment>', C.map_fragment.replace('texture2D( map, vMapUv )', 'lrTex( map, vMapUv )') + '\nif (diffuseColor.a < lrCut) discard;')
    .replace('#include <normal_fragment_maps>', C.normal_fragment_maps.replace(/texture2D\( normalMap, vNormalMapUv \)/g, 'lrN'))
    // roughness lives in the normal atlas alpha: fetch that texel once (lrN) for both chunks
    .replace('#include <roughnessmap_fragment>', 'vec4 lrN = lrTex( normalMap, vNormalMapUv );\n' + C.roughnessmap_fragment.replace('texture2D( roughnessMap, vRoughnessMapUv )', 'lrN').replace('texelRoughness.g', 'texelRoughness.a'))
    .replace('#include <metalnessmap_fragment>', C.metalnessmap_fragment.replace('texture2D( metalnessMap, vMetalnessMapUv )', 'lrTex( metalnessMap, vMetalnessMapUv )').replace('texelMetalness.b', 'texelMetalness.a'));
}

const srgbToLin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function getMaterial(T, name, opts = {}) {
  const p = PRESETS[name]; if (!p) throw new Error('unknown material ' + name);
  const key = name + '|' + (opts.color ?? '') + '|' + (opts.repeat ?? '');
  if (cache.has(key)) return cache.get(key);
  const atlas = getAtlas(T), cell = atlas.cells[p.cell];
  const m = new T.MeshStandardMaterial({
    map: atlas.map, normalMap: atlas.normalMap, roughnessMap: atlas.normalMap, metalnessMap: p.metalMap ? atlas.map : null,
    roughness: p.roughness, metalness: p.metalness, normalScale: new T.Vector2(p.normalScale, p.normalScale),
    transparent: !!p.transparent, opacity: p.opacity ?? 1,
    depthWrite: p.depthWrite ?? true, side: p.side === 'double' ? T.DoubleSide : T.FrontSide,
  });
  const [rx, ry] = opts.repeat ?? p.repeat;
  m.userData.lr = { preset: name, uvScale: [rx, ry] };
  if (opts.color) { // tint: move the textured average TINT of the way to the requested colour, gain clamped
    const c = new T.Color(opts.color), g = (want, mean) => Math.min(1.8, Math.max(0.45, (mean + (want - mean) * TINT) / Math.max(mean, 0.02)));
    m.color.setRGB(g(c.r, cell.mean[0]), g(c.g, cell.mean[1]), g(c.b, cell.mean[2]), T.LinearSRGBColorSpace);
  }
  // Per-material uv phase (hash of the key) so differently tinted boards/logs don't line up knots and nails.
  let h = 2166136261; for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const u = { cut: { value: p.cutout ?? 0 }, cell: { value: new T.Vector4(...cell.uv) }, scale: { value: new T.Vector4(rx, ry, (h & 1023) / 1024, ((h >>> 10) & 1023) / 1024) } };
  m.userData.lr.uniforms = u;
  m.onBeforeCompile = sh => patch(T, sh, u);
  m.customProgramCacheKey = () => 'lr-atlas-3'; // bump whenever patch() output changes (programs are shared by key)
  m.name = 'lr-' + name;
  cache.set(key, m);
  return m;
}

// Game palette hook: returns a textured material for known palette colours, else null.
// Clouds are lit spheres in game.js: a soft self-lit white keeps their undersides from going teal.
const SOFT = { '#e7f9eb': { emissive: '#e6f0f5', emissiveIntensity: 0.6 } };
export function materialForColor(T, color) {
  const hex = String(color).toLowerCase(), preset = COLOR_TO_PRESET.get(hex);
  if (preset) return getMaterial(T, preset, { color, ...COLOR_OPTS[hex] });
  if (!SOFT[hex]) return null;
  if (!cache.has(hex)) cache.set(hex, new T.MeshStandardMaterial({ color: hex, roughness: 1, metalness: 0, ...SOFT[hex] }));
  return cache.get(hex);
}

// Apply LIGHTING to an existing scene (adjusts the first hemisphere/directional light it finds). With
// L.skyDome it also adds one gradient dome (horizon = fog colour, untonemapped like the background)
// that follows the camera.
// extra = { ocean, T }: ocean ({uniforms}) is retinted via applyOceanLook; T (three namespace) enables the dome.
// Idempotent, so it can be called again once the ocean exists.
export function applyLighting(scene, renderer, L = LIGHTING, { ocean = null, T = null } = {}) {
  if (scene.background?.isColor) scene.background.set(L.background);
  if (scene.fog) { scene.fog.color.set(L.fog); if ('near' in scene.fog) { scene.fog.near = L.fogNear; scene.fog.far = L.fogFar; } }
  let hemi = null, sun = null;
  scene.traverse(o => { if (o.isHemisphereLight && !hemi) hemi = o; if (o.isDirectionalLight && !sun) sun = o; });
  if (hemi) { hemi.color.set(L.hemiSky); hemi.groundColor.set(L.hemiGround); hemi.intensity = L.hemiIntensity; }
  if (sun) { sun.color.set(L.sun); sun.intensity = L.sunIntensity; }
  if (renderer) renderer.toneMappingExposure = L.exposure;
  let sky = scene.getObjectByName('art-sky');
  if (L.skyDome && T && !sky) {
    const mat = new T.ShaderMaterial({
      uniforms: { uHorizon: { value: new T.Color(L.fog) }, uZenith: { value: new T.Color(L.skyZenith) } },
      vertexShader: 'varying float vY; void main() { vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uHorizon, uZenith; varying float vY; void main() { gl_FragColor = vec4(mix(uHorizon, uZenith, pow(clamp(vY * 1.6, 0.0, 1.0), 0.6)), 1.0);\n#include <colorspace_fragment>\n}',
      side: T.BackSide, depthWrite: false, fog: false, toneMapped: false,
    });
    sky = new T.Mesh(new T.SphereGeometry(150, 24, 12), mat); sky.name = 'art-sky'; sky.frustumCulled = false; sky.renderOrder = -1;
    sky.onBeforeRender = (r, s, cam) => { sky.position.set(cam.position.x, 0, cam.position.z); sky.updateMatrixWorld(); };
    scene.add(sky);
  }
  if (ocean) applyOceanLook(ocean, L);
  return { hemi, sun, sky };
}

// Retint ocean.js uniforms: body colours, overhead reflection, and the distance fade toward the fog colour.
export function applyOceanLook(ocean, L = LIGHTING) {
  const u = ocean?.uniforms; if (!u) return;
  u.uDeep?.value.set(L.oceanDeep); u.uShallow?.value.set(L.oceanShallow); u.uZenith?.value.set(L.oceanZenith);
  u.uSky?.value.set(L.fog); u.uSunColor?.value.set(L.sun);
  if (u.uFadeNear) u.uFadeNear.value = L.fogNear; if (u.uFadeFar) u.uFadeFar.value = L.fogFar;
}

// Memory/diagnostics for tests and the demo page.
export function artStats(T) { const a = getAtlas(T); return { buildMs: a.ms, gpuBytes: a.gpuBytes, materials: cache.size, cells: Object.keys(a.cells) }; }
