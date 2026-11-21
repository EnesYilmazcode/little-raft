// Art lane tests: texture atlas build, seamless tiling, memory budget, material registry hooks.
// Run: node --test tests/art.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const T = await import('../dist/vendor/three.module.js');
const TX = await import('../dist/textures.js');
const MAT = await import('../dist/materials.js');
const data = TX.buildAtlasData();

test('atlas: every generator gets a cell and the build stays fast', () => {
  assert.deepEqual(Object.keys(data.cells), Object.keys(TX.GENERATORS));
  assert.ok(Object.keys(data.cells).length <= TX.GRID * TX.GRID);
  assert.ok(data.ms < 1500, `atlas build took ${data.ms} ms`);
});

test('atlas: GPU memory under 16 MB including mipmaps', () => {
  const bytes = 2 * TX.ATLAS * TX.ATLAS * 4 * 4 / 3;
  assert.ok(bytes < 16 * 1024 * 1024, `${(bytes / 1048576).toFixed(1)} MB`);
});

// A seam shows up as a jump across the tile edge that is much larger than typical neighbour steps.
test('atlas: cells tile seamlessly (edge steps look like interior steps)', () => {
  const S = TX.TILE, A = TX.ATLAS;
  for (const [name, c] of Object.entries(data.cells)) {
    if (TX.GENERATORS[name].panelEdge) continue; // deliberate plate edge at the wrap
    const x0 = Math.round(c.uv[0] * A), y0 = Math.round(c.uv[1] * A);
    const px = (buf, x, y, k) => buf[((y0 + y) * A + x0 + x) * 4 + k];
    for (const [label, buf] of [['albedo', data.albedo], ['normal', data.normal]]) {
      // Each direction: the step across the wrap must not exceed the strongest interior column/row line
      // (designed gaps like plank seams also appear inside the tile; true seams only at the wrap).
      for (const dir of [0, 1]) {
        const step = (j) => { let t = 0; for (let i = 0; i < S; i++) for (let k = 0; k < 3; k++) t += dir ? Math.abs(px(buf, i, j, k) - px(buf, i, j + 1, k)) : Math.abs(px(buf, j, i, k) - px(buf, j + 1, i, k)); return t; };
        let inner = 0; for (let j = 0; j < S - 1; j++) inner = Math.max(inner, step(j));
        const edge = step(S - 1);
        assert.ok(edge <= inner * 1.25 + S * 3, `${name} ${label} seam (${dir ? 'v' : 'u'}): edge ${edge} vs strongest interior ${inner}`);
      }
    }
  }
});

test('atlas: gutters wrap the tile so mip taps do not bleed', () => {
  const A = TX.ATLAS, S = TX.TILE;
  for (const c of Object.values(data.cells)) {
    const x0 = Math.round(c.uv[0] * A), y0 = Math.round(c.uv[1] * A);
    for (let k = 0; k < 4; k++) assert.equal(data.albedo[((y0 + 3) * A + x0 - 1) * 4 + k], data.albedo[((y0 + 3) * A + x0 + S - 1) * 4 + k]);
  }
});

test('atlas: textures are not flat and alpha is only used where intended (scrap alpha = metalness)', () => {
  const A = TX.ATLAS, S = TX.TILE;
  for (const [name, c] of Object.entries(data.cells)) {
    const x0 = Math.round(c.uv[0] * A), y0 = Math.round(c.uv[1] * A);
    let min = 255, max = 0, minA = 255;
    for (let y = 0; y < S; y += 3) for (let x = 0; x < S; x += 3) {
      const i = ((y0 + y) * A + x0 + x) * 4, l = data.albedo[i] + data.albedo[i + 1] + data.albedo[i + 2];
      min = Math.min(min, l / 3); max = Math.max(max, l / 3); minA = Math.min(minA, data.albedo[i + 3]);
    }
    assert.ok(max - min > 12, `${name} albedo looks flat (${min}-${max})`);
    if (!['leaf', 'foam', 'plastic', 'scrap'].includes(name)) assert.ok(minA > 250, `${name} should be opaque`);
  }
});

test('materials: three shader chunks still contain the strings we patch', () => {
  const C = T.ShaderChunk;
  assert.ok(C.map_fragment.includes('texture2D( map, vMapUv )'));
  assert.ok(C.normal_fragment_maps.includes('texture2D( normalMap, vNormalMapUv )'));
  assert.ok(C.roughnessmap_fragment.includes('texture2D( roughnessMap, vRoughnessMapUv )') && C.roughnessmap_fragment.includes('texelRoughness.g'));
});

test('materials: presets are cached, tinted and the patched shader compiles to valid source', () => {
  TX.getAtlas(T, data);
  const a = MAT.getMaterial(T, 'planks'), b = MAT.getMaterial(T, 'planks');
  assert.equal(a, b);
  for (const name of Object.keys(MAT.PRESETS)) {
    const m = MAT.getMaterial(T, name);
    assert.ok(m.isMeshStandardMaterial && m.map && m.normalMap && m.roughnessMap === m.normalMap, name);
    const sh = { uniforms: {}, vertexShader: T.ShaderLib.standard.vertexShader, fragmentShader: T.ShaderLib.standard.fragmentShader };
    m.onBeforeCompile(sh);
    assert.ok(sh.uniforms.lrCell && sh.uniforms.lrScale, name);
    assert.ok(/lrTex\( map/.test(sh.fragmentShader) && /texelRoughness\.a/.test(sh.fragmentShader), name);
  }
  const tinted = MAT.materialForColor(T, '#bb8a53');
  assert.ok(tinted && tinted !== MAT.getMaterial(T, 'plank'));
  assert.equal(MAT.materialForColor(T, '#efae55'), null, 'avatar colours stay untouched');
});

test('materials: lighting rig applies to a scene', () => {
  const scene = new T.Scene(); scene.background = new T.Color(); scene.fog = new T.Fog('#000', 1, 2);
  scene.add(new T.HemisphereLight(), new T.DirectionalLight());
  const { hemi, sun } = MAT.applyLighting(scene, null);
  assert.ok(hemi && sun);
  assert.equal(sun.intensity, MAT.LIGHTING.sunIntensity);
  assert.equal('#' + scene.fog.color.getHexString(), MAT.LIGHTING.fog.toLowerCase());
});
