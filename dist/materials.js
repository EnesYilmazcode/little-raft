// Little Raft material registry (art lane, see docs/cloud/art.md).
// One shared MeshStandardMaterial per preset (and per tint), all sampling the textures.js atlas, so the
// whole scene answers light the same way. A tiny shader patch makes each material read its own atlas
// cell with fract() + textureGrad (cells tile like normal textures, no mip seams) and take roughness
// from the normal atlas alpha. All patched materials share one program per feature set.
//
//   getMaterial(T, 'planks')                    -> shared preset material
//   getMaterial(T, 'plank', {color:'#bb8a53'})  -> same preset, tinted so its average equals the colour
//   materialForColor(T, '#bb8a53')              -> game palette hex -> textured material (or null)
//   applyLighting(scene, renderer)              -> recommended warm tropical rig (LIGHTING)
//   artEnabled()                                -> true when the page URL has ?art (temporary hook gate)
import { getAtlas } from './textures.js';

// Tuned against the research notes (sandbox/art/notes/research.md). roughness scales the map's roughness.
// repeat = tiles per UV unit. normalScale = strength of the baked normal.
export const PRESETS = {
  planks:  { cell: 'planks',  roughness: 1,    metalness: 0,    normalScale: 1.0, repeat: [1, 1] },
  plank:   { cell: 'plank',   roughness: 1,    metalness: 0,    normalScale: 1.0, repeat: [1, 1] },
  bark:    { cell: 'bark',    roughness: 1,    metalness: 0,    normalScale: 1.2, repeat: [2, 1] },
  plastic: { cell: 'plastic', roughness: 1,    metalness: 0,    normalScale: 1.3, repeat: [1, 1], transparent: true, opacity: 0.95, side: 'double' },
  leaf:    { cell: 'leaf',    roughness: 1,    metalness: 0,    normalScale: 1.0, repeat: [1, 1], alphaTest: 0.5, side: 'double' },
  rope:    { cell: 'rope',    roughness: 1,    metalness: 0,    normalScale: 1.2, repeat: [1, 3] },
  scrap:   { cell: 'scrap',   roughness: 1,    metalness: 1,    normalScale: 1.0, repeat: [1, 1], metalMap: true }, // metalness lives in albedo alpha
  sand:    { cell: 'sand',    roughness: 1,    metalness: 0,    normalScale: 0.8, repeat: [3, 3] },
  rock:    { cell: 'rock',    roughness: 1,    metalness: 0,    normalScale: 1.2, repeat: [2, 2] },
  foam:    { cell: 'foam',    roughness: 1,    metalness: 0,    normalScale: 0.3, repeat: [2, 2], transparent: true, depthWrite: false },
  cloth:   { cell: 'cloth',   roughness: 1,    metalness: 0,    normalScale: 0.7, repeat: [2, 2], side: 'double' },
};

// Recommended rig: sky-blue hemisphere over a sea-teal bounce, warm sun about 3x the fill, fog matching
// the horizon so the sea melts into the sky. Distances in metres.
export const LIGHTING = {
  background: '#cfe3ec', fog: '#cfe3ec', fogNear: 30, fogFar: 150,
  hemiSky: '#bfe3ff', hemiGround: '#3a6e7a', hemiIntensity: 1.25,
  sun: '#fff1d6', sunIntensity: 3.0, exposure: 1.05,
};

// Game palette hex -> preset. Explicit, so avatars, UI ghosts and the hook keep their own materials.
export const COLOR_PRESETS = {
  planks: [],
  plank: ['#bb8a53', '#c69860', '#ad7c4a', '#9c7649', '#c8995f', '#d3a368', '#8c6745', '#d5a265', '#a97d4c', '#b4824b', '#906f48', '#725942', '#756a49', '#ad8153',
    '#a8703f', '#b98148', '#9a6538', '#6b4426'],
  bark: ['#5e4029', '#5e3b20'],
  rope: ['#a8946c', '#b89a64', '#e9d39a'],
  scrap: ['#4b4844', '#8e9aa2', '#6f6964', '#6d757b', '#9a5a32'],
  leaf: ['#4f9b72', '#72ae59', '#519b55', '#6bb84c', '#5fae45', '#7d8a3d'],
  sand: ['#e6d7a3'],
  cloth: ['#fff3cf'],
};
const COLOR_TO_PRESET = new Map(Object.entries(COLOR_PRESETS).flatMap(([p, list]) => list.map(c => [c.toLowerCase(), p])));

export const artEnabled = () => typeof location !== 'undefined' && /[?&]art(=1|&|$)/.test(location.search);

const cache = new Map();
const FRAG_HEAD = `
uniform vec4 lrCell; // atlas cell: xy offset, zw size
uniform vec2 lrScale; // tiles per uv unit
vec4 lrTex(sampler2D s, vec2 uv) {
  uv *= lrScale;
  vec2 dx = dFdx(uv) * lrCell.zw, dy = dFdy(uv) * lrCell.zw;
  return textureGrad(s, lrCell.xy + fract(uv) * lrCell.zw, dx, dy);
}
`;
function patch(T, shader, u) {
  shader.uniforms.lrCell = u.cell; shader.uniforms.lrScale = u.scale;
  const C = T.ShaderChunk;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>' + FRAG_HEAD)
    .replace('#include <map_fragment>', C.map_fragment.replace('texture2D( map, vMapUv )', 'lrTex( map, vMapUv )'))
    .replace('#include <normal_fragment_maps>', C.normal_fragment_maps.replace(/texture2D\( normalMap, vNormalMapUv \)/g, 'lrTex( normalMap, vNormalMapUv )'))
    .replace('#include <roughnessmap_fragment>', C.roughnessmap_fragment.replace('texture2D( roughnessMap, vRoughnessMapUv )', 'lrTex( roughnessMap, vRoughnessMapUv )').replace('texelRoughness.g', 'texelRoughness.a'))
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
    transparent: !!p.transparent, opacity: p.opacity ?? 1, alphaTest: p.alphaTest ?? 0,
    depthWrite: p.depthWrite ?? true, side: p.side === 'double' ? T.DoubleSide : T.FrontSide,
  });
  const [rx, ry] = opts.repeat ?? p.repeat;
  m.userData.lr = { preset: name, uvScale: [rx, ry] };
  if (opts.color) { // tint: per-channel gain so the textured average lands on the requested colour
    const c = new T.Color(opts.color), mean = cell.mean;
    m.color.setRGB(c.r / Math.max(mean[0], 0.02), c.g / Math.max(mean[1], 0.02), c.b / Math.max(mean[2], 0.02), T.LinearSRGBColorSpace);
  }
  const u = { cell: { value: new T.Vector4(...cell.uv) }, scale: { value: new T.Vector2(rx, ry) } };
  m.userData.lr.uniforms = u;
  m.onBeforeCompile = sh => patch(T, sh, u);
  m.customProgramCacheKey = () => 'lr-atlas-1';
  m.name = 'lr-' + name;
  cache.set(key, m);
  return m;
}

// Game palette hook: returns a textured material for known palette colours, else null.
export function materialForColor(T, color) {
  const preset = COLOR_TO_PRESET.get(String(color).toLowerCase());
  return preset ? getMaterial(T, preset, { color }) : null;
}

// Apply LIGHTING to an existing scene (adjusts the first hemisphere/directional light it finds).
export function applyLighting(scene, renderer, L = LIGHTING) {
  if (scene.background?.isColor) scene.background.set(L.background);
  if (scene.fog) { scene.fog.color.set(L.fog); if ('near' in scene.fog) { scene.fog.near = L.fogNear; scene.fog.far = L.fogFar; } }
  let hemi = null, sun = null;
  scene.traverse(o => { if (o.isHemisphereLight && !hemi) hemi = o; if (o.isDirectionalLight && !sun) sun = o; });
  if (hemi) { hemi.color.set(L.hemiSky); hemi.groundColor.set(L.hemiGround); hemi.intensity = L.hemiIntensity; }
  if (sun) { sun.color.set(L.sun); sun.intensity = L.sunIntensity; }
  if (renderer) renderer.toneMappingExposure = L.exposure;
  return { hemi, sun };
}

// Memory/diagnostics for tests and the demo page.
export function artStats(T) { const a = getAtlas(T); return { buildMs: a.ms, gpuBytes: a.gpuBytes, materials: cache.size, cells: Object.keys(a.cells) }; }
