// Little Raft procedural texture library (art lane, see docs/cloud/art.md).
// Generates every surface once at startup from texgen/*.js and packs them into two 1024² atlases:
//   map       RGBA8 sRGB : albedo (rgb) + alpha mask (a)
//   normalMap RGBA8 linear: tangent-space normal from height (rgb, OpenGL +Y) + roughness (a)
// 4x4 grid of 256 px cells; each cell holds a 224 px seamless tile plus a 16 px wrapped gutter so
// mipmaps and bilinear taps don't bleed. GPU cost: 2 x 4 MB + mips = ~11.2 MB. materials.js samples a
// cell with fract() + textureGrad, so cells repeat like ordinary textures.
// Pure data build (buildAtlasData) runs in Node, workers or pages; getAtlas(T) wraps it in THREE textures.
import * as N from './texgen/noise.js?build=v3-survival-ae77fa84ac2b';
import * as planks from './texgen/planks.js?build=v3-survival-ae77fa84ac2b';
import * as plank from './texgen/plank.js?build=v3-survival-ae77fa84ac2b';
import * as bark from './texgen/bark.js?build=v3-survival-ae77fa84ac2b';
import * as plastic from './texgen/plastic.js?build=v3-survival-ae77fa84ac2b';
import * as leaf from './texgen/leaf.js?build=v3-survival-ae77fa84ac2b';
import * as rope from './texgen/rope.js?build=v3-survival-ae77fa84ac2b';
import * as scrap from './texgen/scrap.js?build=v3-survival-ae77fa84ac2b';
import * as sand from './texgen/sand.js?build=v3-survival-ae77fa84ac2b';
import * as rock from './texgen/rock.js?build=v3-survival-ae77fa84ac2b';
import * as foam from './texgen/foam.js?build=v3-survival-ae77fa84ac2b';
import * as cloth from './texgen/cloth.js?build=v3-survival-ae77fa84ac2b';

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

// sRGB -> linear for the coverage-weighted mean, looked up on the stored 8-bit value (what the GPU decodes).
const LIN = new Float64Array(256); for (let i = 0; i < 256; i++) LIN[i] = srgbToLin(i / 255);

// Copy a CELL x CELL block's wrapped 16 px gutter from the tile already written at (ox+PAD, oy+PAD).
// P: 32-bit texel view (one RGBA8 texel per word), W: row stride in texels. copyWithin = memmove.
function wrapGutter(P, W, ox, oy, S) {
  for (let y = 0; y < S; y++) {
    const r = (oy + PAD + y) * W + ox, t = r + PAD; // row start of the cell, row start of the tile
    P.copyWithin(r, t + S - PAD, t + S);             // left gutter  <- right edge of the tile
    P.copyWithin(t + S, t, t + PAD);                 // right gutter <- left edge of the tile
  }
  for (let y = 0; y < PAD; y++) {
    const top = (oy + y) * W + ox, bot = (oy + PAD + S + y) * W + ox; // gutter rows (full cell width)
    P.copyWithin(top, top + S * W, top + S * W + CELL);               // <- tile row S-PAD+y
    P.copyWithin(bot, bot - S * W, bot - S * W + CELL);               // <- tile row y
  }
}

// Run one generator and write its cell (tile + gutter) into albedo/normal (RGBA8, row stride W texels)
// with the cell's top-left texel at (ox, oy). Returns the coverage-weighted linear mean colour.
function packCell(gen, albedo, normal, W, ox, oy) {
  const S = TILE, out = (gen.default ?? gen)(S, N), strength = gen.normalStrength ?? out.normalStrength ?? 4;
  const { albedo: A, height: H, rough: R, alpha: M, metal: MT } = out; // metal: opaque cells only, stored in albedo alpha
  // Normals and roughness once per tile texel (Sobel on wrapped height), written straight into place,
  // then the gutter is wrapped from the tile itself.
  let m0 = 0, m1 = 0, m2 = 0;
  for (let y = 0; y < S; y++) {
    const ym = ((y + S - 1) % S) * S, y0 = y * S, yp = ((y + 1) % S) * S;
    let d = ((oy + PAD + y) * W + ox + PAD) * 4;
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
  wrapGutter(new Uint32Array(normal.buffer, normal.byteOffset, normal.length >> 2), W, ox, oy, S);
  wrapGutter(new Uint32Array(albedo.buffer, albedo.byteOffset, albedo.length >> 2), W, ox, oy, S);
  let cover = S * S; if (M) { cover = 0; for (let i = 0; i < S * S; i++) cover += M[i]; }
  return [m0, m1, m2].map(v => v / Math.max(1, cover));
}

const cellOrigin = index => [(index % GRID) * CELL, ((index / GRID) | 0) * CELL];
const cellInfo = (index, mean) => { const [ox, oy] = cellOrigin(index); return { index, uv: [(ox + PAD) / ATLAS, (oy + PAD) / ATLAS, TILE / ATLAS, TILE / ATLAS], mean }; };
function emptyAtlas() {
  const albedo = new Uint8Array(ATLAS * ATLAS * 4), normal = new Uint8Array(ATLAS * ATLAS * 4);
  new Uint32Array(albedo.buffer).fill(WHITE); new Uint32Array(normal.buffer).fill(FLAT_NORMAL); // unused cells: white opaque, flat normal, roughness 0.9
  return { albedo, normal };
}

export function buildAtlasData(gens = GENERATORS) {
  const t0 = (globalThis.performance ?? Date).now(), { albedo, normal } = emptyAtlas(), cells = {};
  Object.entries(gens).forEach(([name, gen], index) => {
    if (index >= GRID * GRID) throw new Error('texture atlas full');
    const [ox, oy] = cellOrigin(index);
    cells[name] = cellInfo(index, packCell(gen, albedo, normal, ATLAS, ox, oy));
  });
  N.clearNoiseCache(); // lattice tables are only needed during the build
  return { albedo, normal, cells, size: ATLAS, ms: Math.round((globalThis.performance ?? Date).now() - t0) };
}

// Worker side of getAtlasAsync: build some GENERATORS cells into standalone CELL x CELL buffers.
function buildCells(names) {
  const out = [];
  for (const name of names) {
    const albedo = new Uint8Array(CELL * CELL * 4), normal = new Uint8Array(CELL * CELL * 4);
    out.push({ name, albedo, normal, mean: packCell(GENERATORS[name], albedo, normal, CELL, 0, 0) });
  }
  N.clearNoiseCache();
  return out;
}

let cached = null, pending = null, regen = null;
// CPU pixels for a texture whose copy was dropped: three only asks again on a context restore, a
// texture.clone()/copy() (bumps the shared Source version) or a manual needsUpdate. Rebuild both atlases
// once (synchronous, ~0.3-0.6 s, rare); the unused buffer is dropped after the current task.
function rebuilt(key) {
  if (!regen) {
    regen = buildAtlasData(); console.warn(`texture atlas: CPU data needed again, rebuilt in ${regen.ms} ms`);
    setTimeout(() => { regen = null; }, 0);
  }
  return regen[key];
}
// THREE wrapper. Builds once; CPU copies are dropped after each GPU upload (8 MB of JS memory back).
export function getAtlas(T, data = null) {
  if (cached) return cached;
  const d = data ?? buildAtlasData();
  const make = (key, srgb) => {
    const t = new T.DataTexture(d[key], d.size, d.size, T.RGBAFormat, T.UnsignedByteType);
    let buf = d[key];
    // image.data is read by WebGLTextures.uploadTexture (texSubImage2D); null after release, so it
    // regenerates on demand instead of uploading "no pixels" (black atlas after webglcontextrestored).
    t.image = { width: d.size, height: d.size, get data() { return buf ?? (buf = rebuilt(key)); }, set data(v) { buf = v; } };
    t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
    t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
    t.needsUpdate = true; t.onUpdate = () => { buf = null; };
    return t;
  };
  cached = { map: make('albedo', true), normalMap: make('normal', false), cells: d.cells, ms: d.ms, gpuBytes: Math.round(2 * d.size * d.size * 4 * 4 / 3) };
  return cached;
}

// Off-main-thread build: `await getAtlasAsync(T)` splits the generators over up to `workers` module
// workers (default: cores - 1, max 4); each returns finished CELL x CELL buffers (transferred, no copy)
// and the main thread only blits 11 cells (~2 ms). Falls back to an inline build if workers fail.
// Concurrent calls share one build; a getAtlas(T) call meanwhile builds inline and wins.
export function getAtlasAsync(T, { workers } = {}) {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  if (typeof Worker === 'undefined') return Promise.resolve(getAtlas(T));
  const names = Object.keys(GENERATORS);
  const k = Math.max(1, Math.min(names.length, workers ?? Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1)));
  pending = new Promise(res => {
    const t0 = performance.now(), ws = [], parts = [];
    let left = k, over = false;
    const finish = d => { if (over) return; over = true; ws.forEach(w => w.terminate()); pending = null; res(cached ?? getAtlas(T, d)); };
    const fail = e => { if (!over) console.warn('texture worker failed, building inline', e); finish(null); };
    const assemble = () => {
      if (names.length > GRID * GRID) throw new Error('texture atlas full');
      const { albedo, normal } = emptyAtlas(), cells = {}, byName = new Map(parts.flat().map(c => [c.name, c]));
      names.forEach((name, index) => {
        const c = byName.get(name), [ox, oy] = cellOrigin(index);
        for (let y = 0; y < CELL; y++) {
          const src = y * CELL * 4, dst = ((oy + y) * ATLAS + ox) * 4;
          albedo.set(c.albedo.subarray(src, src + CELL * 4), dst); normal.set(c.normal.subarray(src, src + CELL * 4), dst);
        }
        cells[name] = cellInfo(index, c.mean);
      });
      return { albedo, normal, cells, size: ATLAS, ms: Math.round(performance.now() - t0) };
    };
    try {
      for (let i = 0; i < k; i++) {
        const w = new Worker(import.meta.url, { type: 'module' }); ws.push(w);
        w.onmessage = e => {
          if (!Array.isArray(e.data)) return fail(e.data?.error ?? 'bad message');
          parts.push(e.data);
          if (--left === 0) { try { finish(assemble()); } catch (err) { fail(err); } }
        };
        w.onerror = e => { e.preventDefault?.(); fail(e.message ?? e); };
        w.onmessageerror = fail;
        w.postMessage({ names: names.filter((_, j) => j % k === i) });
      }
    } catch (e) { fail(e); }
  });
  return pending;
}
if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = e => {
    try {
      const out = buildCells(e.data?.names ?? Object.keys(GENERATORS));
      globalThis.postMessage(out, out.flatMap(c => [c.albedo.buffer, c.normal.buffer]));
    } catch (err) { globalThis.postMessage({ error: String(err?.stack ?? err) }); }
  };
}
