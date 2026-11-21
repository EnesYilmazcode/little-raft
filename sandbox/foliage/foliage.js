// Foliage prototype: wind sway + growth unfurl injected into stock materials via onBeforeCompile.
// Works for Mesh and InstancedMesh, and for the shadow pass (customDepthMaterial).
import * as T from '../../dist/vendor/three.module.js';

// Shared uniforms: one object for every foliage material, so one write per frame drives them all.
export const windUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: new T.Vector2(1, 0.3).normalize() }, // world-space xz
  uWindStrength: { value: 0.35 },
  uBendScale: { value: 1 / 2.2 }, // 1 / plant height
};

const PARS = /* glsl */`
uniform float uTime, uWindStrength, uBendScale, uGrow;
uniform vec2 uWindDir;
attribute float aSway;   // 0 at frond base -> 1 at tip (detail flutter weight)
attribute float aPhase;  // per frond random phase
attribute float aGrowT;  // growth value at which this part starts unfurling
attribute vec3 aPivot;   // where the part attaches (unfurl pivot)
#ifdef INST_GROW
attribute float aInstGrow;
#endif
`;

const BODY = /* glsl */`
#include <begin_vertex>
{
  #ifdef INST_GROW
    float G = aInstGrow;
  #else
    float G = uGrow;
  #endif
  // object -> world rotation (uniform scale assumed), so wind stays world-aligned for rotated instances
  mat3 R = mat3(modelMatrix);
  vec3 orig = modelMatrix[3].xyz;
  #ifdef USE_INSTANCING
    R = R * mat3(instanceMatrix);
    orig += (modelMatrix * vec4(instanceMatrix[3].xyz, 0.0)).xyz;
  #endif
  vec3 wObj = transpose(R) * vec3(uWindDir.x, 0.0, uWindDir.y);
  vec2 wd = normalize(wObj.xz + 1e-5);
  float ph = aPhase + dot(orig, vec3(0.37, 0.0, 0.21));

  // 1. growth: each frond starts as a closed spear pointing up, then opens out to full size
  float g = clamp((G - aGrowT) / 0.35, 0.0, 1.0);
  g = g * g * (3.0 - 2.0 * g);
  vec3 rel = transformed - aPivot;
  vec3 spear = vec3(0.0, length(rel) * 0.9, 0.0);
  transformed = aPivot + mix(spear, rel, g) * mix(0.12, 1.0, g);

  // 2. detail bending: frond flutter, two incommensurate sines (cheap Crysis-style "edge" waves)
  float t = uTime * (1.0 + uWindStrength);
  float fl = sin(t * 2.1 + ph + aSway * 2.5) * 0.6 + sin(t * 3.7 + ph * 1.7) * 0.4;
  float amp = aSway * aSway * uWindStrength * g;
  transformed.y += fl * amp * 0.10;
  transformed.xz += wd * amp * (0.10 + 0.05 * fl);

  // 3. main bending: whole plant leans downwind, quadratic in height, gusting; length-preserving
  float h = max(transformed.y, 0.0) * uBendScale;
  float gust = 0.7 + 0.3 * sin(uTime * 0.55 + ph) * sin(uTime * 0.23 + ph * 0.5);
  float L = length(transformed);
  transformed.xz += wd * (uWindStrength * gust * 0.35 * h * h);
  transformed = normalize(transformed + 1e-6) * L;
}
`;

// Patch any built-in material. Every material shares the same function -> one program per variant.
function patch(shader) {
  Object.assign(shader.uniforms, windUniforms, { uGrow: this.userData.uGrow });
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + PARS)
    .replace('#include <begin_vertex>', BODY);
}
export function foliageMaterial(mat, { grow = 1, instancedGrow = false } = {}) {
  mat.userData.uGrow = { value: grow };
  if (instancedGrow) mat.defines = { ...(mat.defines || {}), INST_GROW: '' };
  mat.onBeforeCompile = patch;
  mat.customProgramCacheKey = () => 'foliage' + (instancedGrow ? 'I' : '');
  return mat;
}

// Matching depth material so shadows sway too (also alpha-tested for leaf cards).
export function foliageDepth(src) {
  const d = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, map: src.map || null, alphaTest: src.alphaTest || 0 });
  d.userData.uGrow = src.userData.uGrow;
  if (src.defines && 'INST_GROW' in src.defines) d.defines = { INST_GROW: '' };
  d.onBeforeCompile = patch;
  d.customProgramCacheKey = src.customProgramCacheKey;
  return d;
}

// ---- leaf card texture: pinnate palm frond drawn on a canvas (no image files)
export function frondTexture() {
  const W = 128, H = 512, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const v = 0.04 + i / 48, y = H * (1 - v);
    const len = W * 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.05)), 0.7) * (1 - 0.35 * v);
    for (const s of [-1, 1]) {
      const grd = x.createLinearGradient(W / 2, y, W / 2 + s * len, y - len * 0.5);
      grd.addColorStop(0, '#2f5a22'); grd.addColorStop(0.6, '#4f8a33'); grd.addColorStop(1, '#8fae47');
      x.strokeStyle = grd;
      x.lineWidth = 6 - 3 * v;
      x.beginPath(); x.moveTo(W / 2, y);
      x.quadraticCurveTo(W / 2 + s * len * 0.55, y - len * 0.15, W / 2 + s * len, y - len * 0.55);
      x.stroke();
    }
  }
  x.strokeStyle = '#6f7d38'; x.lineWidth = 5;
  x.beginPath(); x.moveTo(W / 2, H); x.lineTo(W / 2, 6); x.stroke();
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---- geometry
function frondGeo(V, C, ang, L, peak, drop, width, growT, phase, segs = 10) {
  const a = 2 * peak + 2 * Math.sqrt(peak * peak + peak * drop), b = a + drop;
  const dir = V(Math.cos(ang), 0, Math.sin(ang)), side = V(-Math.sin(ang), 0, Math.cos(ang));
  const P = t => C.clone().addScaledVector(dir, L * t).add(V(0, a * t - b * t * t, 0));
  const pos = [], uv = [], sway = [], ph = [], gt = [], piv = [], idx = [];
  for (let k = 0; k <= segs; k++) {
    const t = k / segs, p = P(t), w = width * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)));
    // slight V-fold along the midrib so the card is not perfectly flat
    for (const s of [-1, 1]) {
      const q = p.clone().addScaledVector(side, s * w).add(V(0, -0.06 * w / width, 0));
      pos.push(q.x, q.y, q.z); uv.push(s < 0 ? 0 : 1, t);
      sway.push(t); ph.push(phase); gt.push(growT); piv.push(C.x, C.y, C.z);
    }
    if (k) { const i = 2 * k; idx.push(i - 2, i - 1, i, i - 1, i + 1, i); }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSway', new T.Float32BufferAttribute(sway, 1));
  g.setAttribute('aPhase', new T.Float32BufferAttribute(ph, 1));
  g.setAttribute('aGrowT', new T.Float32BufferAttribute(gt, 1));
  g.setAttribute('aPivot', new T.Float32BufferAttribute(piv, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function merge(geos) {
  const names = Object.keys(geos[0].attributes), out = new T.BufferGeometry(), idx = [];
  let off = 0;
  for (const n of names) {
    const size = geos[0].attributes[n].itemSize, arr = [];
    for (const g of geos) arr.push(...g.attributes[n].array);
    out.setAttribute(n, new T.Float32BufferAttribute(arr, size));
  }
  for (const g of geos) { for (const i of g.index.array) idx.push(i + off); off += g.attributes.position.count; }
  out.setIndex(idx);
  return out;
}

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// Returns { trunk: BufferGeometry, fronds: BufferGeometry } for a palm ~2.2 tall, base at origin.
export function palmGeometry() {
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const curve = new T.CatmullRomCurve3([V(0, 0, 0), V(0.03, 0.6, 0.01), V(0.1, 1.2, 0.03), V(0.16, 1.75, 0.05), V(0.18, 2.0, 0.05)]);
  const trunk = new T.TubeGeometry(curve, 16, 0.07, 8, false);
  const n = trunk.attributes.position.count, col = [];
  const tp = trunk.attributes.position;
  for (let i = 0; i < n; i++) { // taper + ring banding via vertex color
    const y = tp.getY(i), t = y / 2.0, c = curve.getPointAt(Math.min(1, Math.max(0, t)));
    const k = 1.25 - 0.45 * t;
    tp.setX(i, c.x + (tp.getX(i) - c.x) * k); tp.setZ(i, c.z + (tp.getZ(i) - c.z) * k);
    const band = 0.85 + 0.15 * Math.sin(y * 40);
    col.push(0.55 * band, 0.42 * band, 0.28 * band);
  }
  trunk.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  for (const [nm, v] of [['aSway', 0], ['aPhase', 0], ['aGrowT', -1]]) trunk.setAttribute(nm, new T.Float32BufferAttribute(new Array(n).fill(v), 1));
  trunk.setAttribute('aPivot', new T.Float32BufferAttribute(new Array(n * 3).fill(0), 3));
  trunk.computeVertexNormals();

  const top = curve.getPointAt(1), C = top.clone().add(V(0, 0.03, 0)), fr = [];
  const NF = 9;
  for (let f = 0; f < NF; f++) {
    const upper = f % 3 === 0;
    const ang = f * 2.39996 + (rnd() - 0.5) * 0.3; // golden angle: young fronds fill gaps
    const growT = (f / NF) * 0.65; // older (lower) fronds first, crown spear last
    fr.push(frondGeo(V, C, ang, upper ? 0.9 : 1.05, upper ? 0.32 : 0.12, upper ? 0.25 : 0.62, 0.2, growT, rnd() * 6.28));
  }
  return { trunk, fronds: merge(fr) };
}
