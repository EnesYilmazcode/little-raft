// Little Raft procedural texture library (art lane, see docs/cloud/art.md).
// Generates every surface once at startup from texgen/*.js and packs them into two 1024² atlases:
//   map       RGBA8 sRGB : albedo (rgb) + alpha mask (a)
//   normalMap RGBA8 linear: tangent-space normal from height (rgb, OpenGL +Y) + roughness (a)
// 4x4 grid of 256 px cells; each cell holds a 224 px seamless tile plus a 16 px wrapped gutter so
// mipmaps and bilinear taps don't bleed. GPU cost: 2 x 4 MB + mips = ~11.2 MB. materials.js samples a
// cell with fract() + textureGrad, so cells repeat like ordinary textures.
// Pure data build (buildAtlasData) runs in Node, workers or pages; getAtlas(T) wraps it in THREE textures.
import * as N from './texgen/noise.js';
import planks from './texgen/planks.js';
import plank from './texgen/plank.js';
import bark from './texgen/bark.js';
import plastic from './texgen/plastic.js';
import leaf from './texgen/leaf.js';
import rope from './texgen/rope.js';
import scrap from './texgen/scrap.js';
import sand from './texgen/sand.js';
import rock from './texgen/rock.js';
import foam from './texgen/foam.js';
import cloth from './texgen/cloth.js';

export const ATLAS = 1024, CELL = 256, PAD = 16, TILE = CELL - 2 * PAD, GRID = ATLAS / CELL;
// Generator contract (texgen/<name>.js default export): (S, N) => {albedo, height, rough, alpha?}
//   albedo Float32Array S*S*3 sRGB 0..1, height/rough/alpha Float32Array S*S 0..1, row 0 = bottom (v=0).
//   Must tile seamlessly on S. Optional export `normalStrength` (height units -> slope, default 4).
export const GENERATORS = { planks, plank, bark, plastic, leaf, rope, scrap, sand, rock, foam, cloth };

const srgbToLin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const b8 = v => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);

export function buildAtlasData(gens = GENERATORS) {
  const t0 = (globalThis.performance ?? Date).now();
  const albedo = new Uint8Array(ATLAS * ATLAS * 4), normal = new Uint8Array(ATLAS * ATLAS * 4), cells = {};
  albedo.fill(255); // unused cells: white, opaque
  for (let i = 0; i < ATLAS * ATLAS; i++) { normal[i * 4] = 128; normal[i * 4 + 1] = 128; normal[i * 4 + 2] = 255; normal[i * 4 + 3] = 230; }
  const S = TILE;
  Object.entries(gens).forEach(([name, gen], index) => {
    if (index >= GRID * GRID) throw new Error('texture atlas full');
    const out = (gen.default ?? gen)(S, N), strength = gen.normalStrength ?? out.normalStrength ?? 4;
    const { albedo: A, height: H, rough: R, alpha: M } = out;
    const col = index % GRID, row = (index / GRID) | 0, ox = col * CELL, oy = row * CELL;
    // Normals and roughness once per tile texel (Sobel on wrapped height), then copy with a wrapped gutter.
    const nrm = new Uint8Array(S * S * 4), alb = new Uint8Array(S * S * 4), mean = [0, 0, 0];
    for (let y = 0; y < S; y++) {
      const ym = ((y + S - 1) % S) * S, y0 = y * S, yp = ((y + 1) % S) * S;
      for (let x = 0; x < S; x++) {
        const xm = (x + S - 1) % S, xp = (x + 1) % S, s = y0 + x, d = s * 4;
        const gx = (H[ym + xp] + 2 * H[y0 + xp] + H[yp + xp] - H[ym + xm] - 2 * H[y0 + xm] - H[yp + xm]) / 8;
        const gy = (H[yp + xm] + 2 * H[yp + x] + H[yp + xp] - H[ym + xm] - 2 * H[ym + x] - H[ym + xp]) / 8;
        const nx = -gx * strength, ny = -gy * strength, l = Math.hypot(nx, ny, 1);
        nrm[d] = b8(nx / l * 0.5 + 0.5); nrm[d + 1] = b8(ny / l * 0.5 + 0.5); nrm[d + 2] = b8(0.5 / l + 0.5); nrm[d + 3] = b8(R ? R[s] : 0.8);
        const a = M ? M[s] : 1;
        alb[d] = b8(A[s * 3]); alb[d + 1] = b8(A[s * 3 + 1]); alb[d + 2] = b8(A[s * 3 + 2]); alb[d + 3] = b8(a);
        for (let c = 0; c < 3; c++) mean[c] += srgbToLin(A[s * 3 + c]) * a;
      }
    }
    for (let y = -PAD; y < S + PAD; y++) for (let x = -PAD; x < S + PAD; x++) {
      const s = (((y + S) % S) * S + (x + S) % S) * 4, d = ((oy + PAD + y) * ATLAS + ox + PAD + x) * 4;
      for (let c = 0; c < 4; c++) { normal[d + c] = nrm[s + c]; albedo[d + c] = alb[s + c]; }
    }
    let cover = S * S; if (M) { cover = 0; for (let i = 0; i < S * S; i++) cover += M[i]; }
    cells[name] = { index, uv: [(ox + PAD) / ATLAS, (oy + PAD) / ATLAS, S / ATLAS, S / ATLAS], mean: mean.map(v => v / Math.max(1, cover)) };
  });
  return { albedo, normal, cells, size: ATLAS, ms: Math.round((globalThis.performance ?? Date).now() - t0) };
}

let cached = null;
// THREE wrapper. Builds once; CPU copies are dropped after the first GPU upload.
export function getAtlas(T, data = null) {
  if (cached) return cached;
  const d = data ?? buildAtlasData();
  const make = (buf, srgb) => {
    const t = new T.DataTexture(buf, d.size, d.size, T.RGBAFormat, T.UnsignedByteType);
    t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
    t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
    t.needsUpdate = true; t.onUpdate = () => { t.image.data = null; t.onUpdate = null; };
    return t;
  };
  cached = { map: make(d.albedo, true), normalMap: make(d.normal, false), cells: d.cells, ms: d.ms, gpuBytes: Math.round(2 * d.size * d.size * 4 * 4 / 3) };
  return cached;
}

// Optional off-main-thread build: `await getAtlasAsync(T)` builds in a module worker when available.
export async function getAtlasAsync(T) {
  if (cached || typeof Worker === 'undefined') return getAtlas(T);
  try {
    const w = new Worker(import.meta.url, { type: 'module' });
    const d = await new Promise((res, rej) => { w.onmessage = e => res(e.data); w.onerror = rej; w.postMessage('build'); });
    w.terminate(); return getAtlas(T, d);
  } catch (e) { console.warn('texture worker failed, building inline', e); return getAtlas(T); }
}
if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = () => { const d = buildAtlasData(); globalThis.postMessage(d, [d.albedo.buffer, d.normal.buffer]); };
}
