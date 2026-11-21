// Node preview for the texture atlas (no browser): node sandbox/art/preview.mjs <outdir> [cell]
// Writes atlas-albedo.png, atlas-normal.png, atlas-rough.png, and with [cell] a 2x2 tiled
// albedo|normal|rough strip <cell>.png, so you can check seams and tone by reading the image.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildAtlasData, ATLAS, TILE } from '../../dist/textures.js';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = ~0; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
function png(w, h, rgba) { // rows written top-down from bottom-up texture data (v=0 is the bottom row)
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + (h - 1 - y) * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const out = process.argv[2] || 'previews', only = process.argv[3]; mkdirSync(out, { recursive: true });
const d = buildAtlasData();
console.log(`atlas built in ${d.ms} ms`);
const opaque = (src, f) => { const o = new Uint8Array(src.length); for (let i = 0; i < src.length; i += 4) f(src, i, o); return o; };
const rough = opaque(d.normal, (s, i, o) => { o[i] = o[i + 1] = o[i + 2] = s[i + 3]; o[i + 3] = 255; });
const nrm = opaque(d.normal, (s, i, o) => { o[i] = s[i]; o[i + 1] = s[i + 1]; o[i + 2] = s[i + 2]; o[i + 3] = 255; });
const ALPHA_CELLS = ['leaf', 'foam', 'plastic']; // other cells may keep metalness in alpha
const alphaAt = i => { const x = (i >> 2) % ATLAS, y = ((i >> 2) / ATLAS) | 0, n = Object.keys(d.cells)[(y >> 8) * 4 + (x >> 8)]; return ALPHA_CELLS.includes(n); };
const alb = opaque(d.albedo, (s, i, o) => { const a = alphaAt(i) ? s[i + 3] / 255 : 1, bg = ((i >> 5) ^ (i >> 15)) & 1 ? 40 : 90; for (let c = 0; c < 3; c++) o[i + c] = s[i + c] * a + bg * (1 - a); o[i + 3] = 255; });
if (!only) for (const [n, buf] of [['albedo', alb], ['normal', nrm], ['rough', rough]]) writeFileSync(`${out}/atlas-${n}.png`, png(ATLAS, ATLAS, buf));
for (const [name, c] of Object.entries(d.cells)) {
  if (only && only !== name) continue;
  const x0 = Math.round(c.uv[0] * ATLAS), y0 = Math.round(c.uv[1] * ATLAS), S = TILE, W = S * 2 * 3 + 16, Hh = S * 2;
  const img = new Uint8Array(W * Hh * 4);
  [alb, nrm, rough].forEach((src, k) => { for (let y = 0; y < Hh; y++) for (let x = 0; x < S * 2; x++) {
    const s = ((y0 + y % S) * ATLAS + x0 + x % S) * 4, t = (y * W + k * (S * 2 + 8) + x) * 4; for (let q = 0; q < 4; q++) img[t + q] = src[s + q]; } });
  writeFileSync(`${out}/${name}.png`, png(W, Hh, img));
  console.log(name, 'mean linear rgb', c.mean.map(v => v.toFixed(3)).join(' '));
}
