// Little Raft procedural texture library (art lane, see docs/cloud/art.md).
// Generates every surface once at startup from texgen/*.js and packs them into two 1024² atlases:
//   map       RGBA8 sRGB : albedo (rgb) + alpha mask (a)
//   normalMap RGBA8 linear: tangent-space normal from height (rgb, OpenGL +Y) + roughness (a)
// 4x4 grid of 256 px cells; each cell holds a 224 px seamless tile plus a 16 px wrapped gutter so
// mipmaps and bilinear taps don't bleed. GPU cost: 2 x 4 MB + mips = ~11.2 MB. materials.js samples a
// cell with fract() + textureGrad, so cells repeat like ordinary textures.
// Pure data build (buildAtlasData) runs in Node, workers or pages; getAtlas(T) wraps it in THREE textures.
import * as N from './texgen/noise.js';
import * as planks from './texgen/planks.js';
import * as plank from './texgen/plank.js';
import * as bark from './texgen/bark.js';
import * as plastic from './texgen/plastic.js';
import * as leaf from './texgen/leaf.js';
import * as rope from './texgen/rope.js';
import * as scrap from './texgen/scrap.js';
import * as sand from './texgen/sand.js';
import * as rock from './texgen/rock.js';
import * as foam from './texgen/foam.js';
import * as cloth from './texgen/cloth.js';

export const ATLAS = 1024, CELL = 256, PAD = 16, TILE = CELL - 2 * PAD, GRID = ATLAS / CELL;
// Generator contract (texgen/<name>.js default export): (S, N) => {albedo, height, rough, alpha?}
//   albedo Float32Array S*S*3 sRGB 0..1, height/rough/alpha Float32Array S*S 0..1, row 0 = bottom (v=0).
//   Optional metal Float32Array S*S (metalness, opaque cells only: it is stored in the albedo alpha).
//   Must tile seamlessly on S. Optional export `normalStrength` (height units -> slope, default 4).
export const GENERATORS = { planks, plank, bark, plastic, leaf, rope, scrap, sand, rock, foam, cloth };

const srgbToLin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const b8 = v => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);
// Byte pattern as a native-endian 32-bit word, so a Uint32Array fill writes these 4 bytes on any CPU.
const word = (r, g, b, a) => new Uint32Array(new Uint8Array([r, g, b, a]).buffer)[0];
const FLAT_NORMAL = word(128, 128, 255, 230), WHITE = word(255, 255, 255, 255);

// Copy a CELL x CELL block's wrapped 16 px gutter from the tile already written at (ox+PAD, oy+PAD).
// Works on 32-bit texels (one RGBA8 texel per word) with copyWithin (memmove), no per-byte loop.
function wrapGutter(P, ox, oy, S) {
  for (let y = 0; y < S; y++) {
    const r = (oy + PAD + y) * ATLAS + ox, t = r + PAD; // row start of the cell, row start of the tile
    P.copyWithin(r, t + S - PAD, t + S);                 // left gutter  <- right edge of the tile
    P.copyWithin(t + S, t, t + PAD);                     // right gutter <- left edge of the tile
  }
  for (let y = 0; y < PAD; y++) {
    const top = (oy + y) * ATLAS + ox, bot = (oy + PAD + S + y) * ATLAS + ox; // gutter rows (full cell width)
    P.copyWithin(top, top + S * ATLAS, top + S * ATLAS + CELL);               // <- tile row S-PAD+y
    P.copyWithin(bot, bot - S * ATLAS, bot - S * ATLAS + CELL);               // <- tile row y
  }
}

export function buildAtlasData(gens = GENERATORS) {
  const t0 = (globalThis.performance ?? Date).now();
  const albedo = new Uint8Array(ATLAS * ATLAS * 4), normal = new Uint8Array(ATLAS * ATLAS * 4), cells = {};
  const A32 = new Uint32Array(albedo.buffer), N32 = new Uint32Array(normal.buffer);
  A32.fill(WHITE); N32.fill(FLAT_NORMAL); // unused cells: white opaque albedo, flat normal, roughness 0.9
  const S = TILE;
  // sRGB -> linear for the coverage-weighted mean, looked up on the stored 8-bit value (what the GPU decodes).
  const LIN = new Float64Array(256); for (let i = 0; i < 256; i++) LIN[i] = srgbToLin(i / 255);
  Object.entries(gens).forEach(([name, gen], index) => {
    if (index >= GRID * GRID) throw new Error('texture atlas full');
    const out = (gen.default ?? gen)(S, N), strength = gen.normalStrength ?? out.normalStrength ?? 4;
    const { albedo: A, height: H, rough: R, alpha: M, metal: MT } = out; // metal: opaque cells only, stored in albedo alpha
    const col = index % GRID, row = (index / GRID) | 0, ox = col * CELL, oy = row * CELL;
    // Normals and roughness once per tile texel (Sobel on wrapped height), written straight into the atlas,
    // then the gutter is wrapped from the tile itself.
    let m0 = 0, m1 = 0, m2 = 0;
    for (let y = 0; y < S; y++) {
      const ym = ((y + S - 1) % S) * S, y0 = y * S, yp = ((y + 1) % S) * S;
      let d = ((oy + PAD + y) * ATLAS + ox + PAD) * 4;
      for (let x = 0; x < S; x++, d += 4) {
        const xm = x === 0 ? S - 1 : x - 1, xp = x === S - 1 ? 0 : x + 1, s = y0 + x;
        const gx = (H[ym + xp] + 2 * H[y0 + xp] + H[yp + xp] - H[ym + xm] - 2 * H[y0 + xm] - H[yp + xm]) / 8;
        const gy = (H[yp + xm] + 2 * H[yp + x] + H[yp + xp] - H[ym + xm] - 2 * H[ym + x] - H[ym + xp]) / 8;
        const nx = -gx * strength, ny = -gy * strength, l = Math.sqrt(nx * nx + ny * ny + 1);
        normal[d] = b8(nx / l * 0.5 + 0.5); normal[d + 1] = b8(ny / l * 0.5 + 0.5); normal[d + 2] = b8(0.5 / l + 0.5); normal[d + 3] = b8(R ? R[s] : 0.8);
        const a = M ? M[s] : 1, r = b8(A[s * 3]), g = b8(A[s * 3 + 1]), b = b8(A[s * 3 + 2]);
        albedo[d] = r; albedo[d + 1] = g; albedo[d + 2] = b; albedo[d + 3] = b8(M ? a : MT ? MT[s] : 1);
        m0 += LIN[r] * a; m1 += LIN[g] * a; m2 += LIN[b] * a;
      }
    }
    wrapGutter(N32, ox, oy, S); wrapGutter(A32, ox, oy, S);
    let cover = S * S; if (M) { cover = 0; for (let i = 0; i < S * S; i++) cover += M[i]; }
    cells[name] = { index, uv: [(ox + PAD) / ATLAS, (oy + PAD) / ATLAS, S / ATLAS, S / ATLAS], mean: [m0, m1, m2].map(v => v / Math.max(1, cover)) };
  });
  N.clearNoiseCache(); // lattice tables are only needed during the build
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
