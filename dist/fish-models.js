// Procedural low-poly fish models (original art). ES module, THREE passed in as T, no textures.
//
//   createFishModel(T, speciesId, { cm = 25, state = 'raw', lod = 1 } = {}) -> THREE.Group
//     Length along +X (nose at +X, tail tip at -X), centred on the origin, real scale: length = cm/100 m.
//     The returned group itself is never scaled/rotated by this module (position/rotate it freely);
//     an inner 'fishModel' child carries the scale.
//     state: 'raw' | 'cooked' (golden brown + grill stripes) | 'burnt' (charcoal with embers).
//     lod: 0 low, 1 normal (< 600 triangles for every species, cooked stripes included), 2 high.
//     userData: { speciesId, state, length, tail: Object3D (wag via .rotation.y, pivot at the peduncle),
//                 dispose() }
//   setFishState(group, state)      swap the fish to raw/cooked/burnt (shared geometry + materials, no rebuild)
//   wiggle(group, time, amount = 1) tail wag + slight body bend (only touches rotations)
//   disposeFishCache()              free every cached geometry/material (only when no fish model is in use)
//
// Resource sharing: geometries are cached per (species, lod, state) in a module Map and shared by all fish
// of that kind; materials are shared module-wide per state. group.userData.dispose() therefore does NOT
// dispose GPU resources; it only detaches the group from its parent. Call disposeFishCache() to free them.
//
// Bodies are a loft of cross-section rings along X with per-shape profile functions; colours are per-face
// (flat low-poly look): back -> flank -> belly gradient plus stripes / bars / spots / scales patterns.
// Fins, tail, eyes, catfish barbels, tuna finlets and the Sunscale glow bands are thin double-faced shapes.
import { speciesById } from './fish-species.js';

const STATES = ['raw', 'cooked', 'burnt'];
// Body shapes at unit length. H/W = max half height/width, peak = thickest point (0 tail .. 1 nose),
// ped = peduncle height ratio, nose = nose bluntness exponent (<1 blunt), tail = tail length.
const SHAPES = {
  disc: { H: 0.27, W: 0.07, peak: 0.52, ped: 0.13, wped: 0.35, nose: 0.55, tail: 0.2, belly: 1.0 },
  torpedo: { H: 0.11, W: 0.08, peak: 0.6, ped: 0.24, wped: 0.35, nose: 0.85, tail: 0.2, belly: 1.05 },
  long: { H: 0.085, W: 0.08, peak: 0.78, ped: 0.32, wped: 0.4, nose: 0.38, tail: 0.15, belly: 1.1, flatHead: true },
  flat: { H: 0.24, W: 0.03, peak: 0.5, ped: 0.15, wped: 0.4, nose: 0.6, tail: 0.18, belly: 1.0 },
  deep: { H: 0.2, W: 0.075, peak: 0.58, ped: 0.2, wped: 0.35, nose: 0.62, tail: 0.2, belly: 1.05 },
};
// Fin layouts: f = [from, to] along the body (0 peduncle .. 1 nose), h = height, kind = outline.
const FIN_SETS = {
  disc: { dorsal: [{ f: [0.18, 0.58], h: 0.13, kind: 'sweep' }], anal: [{ f: [0.16, 0.52], h: 0.12, kind: 'sweep' }], pect: 0.11 },
  torpedo: { dorsal: [{ f: [0.45, 0.62], h: 0.06, kind: 'tri' }], anal: [{ f: [0.16, 0.28], h: 0.045, kind: 'tri' }], pelvic: 0.45, pect: 0.07 },
  long: { dorsal: [{ f: [0.55, 0.66], h: 0.07, kind: 'tri' }], anal: [{ f: [0.04, 0.45], h: 0.04, kind: 'low' }], pelvic: 0.5, pect: 0.08 },
  flat: { dorsal: [{ f: [0.05, 0.9], h: 0.07, kind: 'low' }], anal: [{ f: [0.05, 0.75], h: 0.07, kind: 'low' }], pect: 0.06 },
  deep: { dorsal: [{ f: [0.25, 0.7], h: 0.1, kind: 'tri' }], anal: [{ f: [0.14, 0.34], h: 0.08, kind: 'tri' }], pelvic: 0.6, pect: 0.09 },
};
const GENERIC = { shape: 'torpedo', body: '#5f7f96', belly: '#e9eef0', fin: '#7d93a3', pattern: 'none', tailKind: 'fork', eye: 0.03 };
// Per-species flair (the species table's look overrides colours/shape/pattern; flair fields stay).
const LOOKS = {
  pomfret: { shape: 'disc', body: '#9eabb8', mid: '#cfd6dc', belly: '#f3f5f6', fin: '#a6b2bd', shimmer: 0.22, eye: 0.042, tailKind: 'fork', span: 0.2 },
  herring: { shape: 'torpedo', body: '#2f5f8f', mid: '#a9bccb', belly: '#eef3f5', fin: '#90a6b6', slim: 0.82, shimmer: 0.2, eye: 0.034 },
  mackerel: { shape: 'torpedo', body: '#2c8a7e', belly: '#f0f2ec', mid: '#b9c9c2', fin: '#6f8f88', pattern: 'stripes', dark: '#10262b', eye: 0.03,
    fins: { dorsal: [{ f: [0.56, 0.7], h: 0.065, kind: 'tri' }, { f: [0.24, 0.33], h: 0.045, kind: 'tri' }],
      anal: [{ f: [0.22, 0.31], h: 0.04, kind: 'tri' }], pelvic: 0.5, pect: 0.06 }, finlets: { n: 4, f: [0.02, 0.2], color: '#7f9b8f' } },
  tilapia: { shape: 'deep', body: '#5f7262', mid: '#8b9880', belly: '#d3d6bf', fin: '#56645a', pattern: 'bars', dark: '#33403a', tailKind: 'round', eye: 0.036,
    fins: { dorsal: [{ f: [0.12, 0.78], h: 0.1, kind: 'spiny' }], anal: [{ f: [0.12, 0.36], h: 0.085, kind: 'spiny' }], pelvic: 0.62, pect: 0.09 } },
  catfish: { shape: 'long', body: '#4c3f33', mid: '#6e5c48', belly: '#c2ae8c', fin: '#3f342a', pattern: 'mottle', dark: '#2d251f', tailKind: 'round', eye: 0.02, whiskers: true },
  salmon: { shape: 'torpedo', body: '#5c6f80', mid: '#e7a2a0', belly: '#f6e7e2', fin: '#7a7d86', pattern: 'spots', dark: '#1d2228', eye: 0.026, kype: true, H: 0.125, tailKind: 'square',
    fins: { dorsal: [{ f: [0.46, 0.6], h: 0.065, kind: 'tri' }, { f: [0.12, 0.17], h: 0.025, kind: 'nub' }], anal: [{ f: [0.15, 0.26], h: 0.045, kind: 'tri' }], pelvic: 0.42, pect: 0.07 } },
  tuna: { shape: 'torpedo', body: '#16234a', mid: '#7d8aa6', belly: '#e1e5ec', fin: '#243461', H: 0.15, W: 0.115, ped: 0.12, eye: 0.026, tailKind: 'sickle', shimmer: 0.1, span: 0.22,
    fins: { dorsal: [{ f: [0.56, 0.68], h: 0.06, kind: 'tri' }, { f: [0.36, 0.46], h: 0.13, kind: 'sickle' }],
      anal: [{ f: [0.34, 0.44], h: 0.12, kind: 'sickle' }], pelvic: 0.6, pect: 0.15 }, finlets: { n: 6, f: [0.03, 0.3], color: '#f2c230' } },
  sunscale: { shape: 'deep', body: '#d98d0f', mid: '#f2b630', belly: '#fff0b0', fin: '#ff9d2a', pattern: 'scales', glow: '#ffe066', tailKind: 'fan', tail: 0.27, eye: 0.04, span: 0.26,
    H: 0.21, fins: { dorsal: [{ f: [0.14, 0.8], h: 0.15, kind: 'sail' }], anal: [{ f: [0.14, 0.4], h: 0.1, kind: 'sail' }], pelvic: 0.6, pect: 0.11 } },
};

const geoCache = new Map(); // `${id}|${lod}` -> { build, geos: { state: { part: BufferGeometry } } }
const matCache = new Map(); // `${kind}|${state}` -> Material

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
const hash = (n) => { const s = Math.sin(n * 12.9898 + 4.1414) * 43758.5453; return s - Math.floor(s); };
const isCol = (v) => typeof v === 'number' || (typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v));

function resolveLook(id) {
  let sp = null;
  try { sp = speciesById(id); } catch (e) { sp = null; }
  const known = Object.prototype.hasOwnProperty.call(LOOKS, id);
  const ext = (sp && sp.look && typeof sp.look === 'object') ? sp.look : {};
  const L = Object.assign({}, GENERIC, known ? LOOKS[id] : null);
  if (SHAPES[ext.shape]) L.shape = ext.shape;
  for (const k of ['body', 'belly', 'fin', 'mid', 'dark', 'glow']) if (isCol(ext[k])) L[k] = ext[k];
  // Pattern flags may be booleans or colours (colour = the dark pattern tint).
  const pat = ext.pattern || (ext.stripes ? 'stripes' : ext.bars ? 'bars' : ext.spots ? 'spots' : null);
  if (pat && (!known || L.pattern === 'none')) L.pattern = pat;
  for (const k of ['stripes', 'bars', 'spots']) if (isCol(ext[k])) L[k === 'spots' && L.pattern === 'scales' ? 'fleck' : 'dark'] = ext[k];
  if (ext.finlets) L.finlets = Object.assign({ n: 5, f: [0.03, 0.25] }, L.finlets, isCol(ext.finlets) ? { color: ext.finlets } : null);
  if (ext.whiskers) { L.whiskers = true; if (isCol(ext.whiskers)) L.whisker = ext.whiskers; }
  if (!L.fins || (!known && ext.shape)) L.fins = FIN_SETS[L.shape] || FIN_SETS.torpedo;
  if (!known) L.tailKind = { disc: 'fork', deep: 'round', long: 'round', flat: 'round' }[L.shape] || 'fork';
  L.key = known ? id : 'generic:' + L.shape + ':' + L.body + L.belly + L.fin + L.pattern;
  return L;
}

// ---------------------------------------------------------------- geometry build (positions + face tags)
function buildFish(T, L, lod) {
  const S = Object.assign({}, SHAPES[L.shape] || SHAPES.torpedo);
  for (const k of ['H', 'W', 'ped', 'tail']) if (L[k] != null) S[k] = L[k];
  if (L.slim) { S.H *= L.slim; S.W *= L.slim; }
  const M = [8, 12, 12][lod], N = [9, 14, 20][lod];
  const x0 = -0.5 + S.tail, BL = 0.5 - x0;
  const fx = (f) => x0 + f * BL;
  const env = (t, ped, nose) => (t < S.peak ? ped + (1 - ped) * (1 - (1 - t / S.peak) ** 2)
    : Math.pow(Math.max(0, 1 - ((t - S.peak) / (1 - S.peak)) ** 2), nose));
  const prof = (x) => {
    const t = clamp((x - x0) / BL, 0, 1);
    let ht = S.H * env(t, S.ped, S.nose), hb = ht * S.belly, w = S.W * env(t, S.wped, S.nose * 0.8);
    if (S.flatHead) { const k = smooth(0.55, 1, t); ht *= 1 - 0.3 * k; hb *= 1 - 0.15 * k; w *= 1 + 0.3 * k; }
    return { ht, hb, w, t };
  };
  const sec = (x, a) => {
    const p = prof(x), s = Math.sin(a), c = Math.cos(a);
    const y = s >= 0 ? p.ht * s : (S.flatHead ? -p.hb * Math.pow(-s, 0.6) : p.hb * s);
    return [x, y, p.w * spow(c, 0.85)];
  };
  const parts = { body: [], tail: [], glowBody: [], glowTail: [], grill: [] };
  const faceTags = { body: [], tail: [], glowBody: [], glowTail: [], grill: [] };
  const tri = (part, a, b, c, tag) => { parts[part].push(...a, ...b, ...c); faceTags[part].push(tag); };
  const twin = (part, a, b, c, tag) => { tri(part, a, b, c, tag); tri(part, a, c, b, tag); };
  const mz = (p) => [p[0], p[1], -p[2]];
  let fid = 0;
  const tg = (r, o) => Object.assign({ r, k: hash(++fid), i: fid }, o);

  // Body loft: rings from peduncle (i=0) to the nose tip.
  const rings = [];
  for (let i = 0; i < N; i++) {
    const x = x0 + BL * (0.5 - 0.5 * Math.cos(Math.PI * i / N));
    const r = [];
    for (let j = 0; j < M; j++) { const a = j * 2 * Math.PI / M; r.push({ p: sec(x, a), s: Math.sin(a) }); }
    rings.push(r);
  }
  const tip = { p: [0.5, L.kype ? -0.012 : 0, 0], s: 0 };
  const bodyTag = (vs) => {
    const cx = (vs[0].p[0] + vs[1].p[0] + vs[2].p[0]) / 3, cy = (vs[0].p[1] + vs[1].p[1] + vs[2].p[1]) / 3;
    const u = (vs[0].s + vs[1].s + vs[2].s) / 3, pr = prof(cx);
    return tg('body', { x: cx, y: cy, u, f: pr.t });
  };
  const btri = (a, b, c, t) => tri('body', a.p, b.p, c.p, t || bodyTag([a, b, c]));
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const jn = (j + 1) % M, A = rings[i][j], D = rings[i][jn];
    if (i < N - 1) { // one colour per quad
      const B = rings[i + 1][j], C = rings[i + 1][jn], t = bodyTag([A, C, { p: [(B.p[0] + D.p[0]) / 2, (B.p[1] + D.p[1]) / 2, 0], s: (B.s + D.s) / 2 }]);
      btri(A, B, C, t); btri(A, C, D, t);
    } else btri(A, tip, D);
  }
  const cap = { p: [x0, 0, 0], s: 0 };
  for (let j = 0; j < M; j++) btri(cap, rings[0][j], rings[0][(j + 1) % M]);

  // Generic flat fin: outline [[s,q]...] (q 0 at root), map(s,q)->[x,y,z]. Optional glow band on the outer rim.
  const fin = (part, outline, map, { mirror = false, glow = false, color = null, region = 'fin' } = {}) => {
    let pts = outline;
    const gpart = part === 'tail' ? 'glowTail' : 'glowBody';
    if (glow) {
      const inner = outline.map(([s, q]) => [s, q * 0.8]);
      for (let i = 0; i < outline.length - 1; i++) {
        if (outline[i][1] < 0.05 && outline[i + 1][1] < 0.05) continue;
        const a = map(...outline[i]), b = map(...outline[i + 1]), c = map(...inner[i + 1]), d = map(...inner[i]);
        const t1 = tg('glow', {}), t2 = tg('glow', {});
        twin(gpart, a, b, c, t1); twin(gpart, a, c, d, t2);
        if (mirror) { twin(gpart, mz(a), mz(b), mz(c), t1); twin(gpart, mz(a), mz(c), mz(d), t2); }
      }
      pts = inner;
    }
    const v2 = pts.map(([s, q]) => new T.Vector2(s, q));
    const faces = T.ShapeUtils.triangulateShape(v2, []);
    for (const [ia, ib, ic] of faces) {
      const q = (pts[ia][1] + pts[ib][1] + pts[ic][1]) / 3;
      const a = map(...pts[ia]), b = map(...pts[ib]), c = map(...pts[ic]);
      const t = tg(region, { q, color, x: (a[0] + b[0] + c[0]) / 3 });
      twin(part, a, b, c, t);
      if (mirror) twin(part, mz(a), mz(b), mz(c), t);
    }
  };
  const OUT = {
    tri: [[0, 0], [1, 0], [0.86, 0.75], [0.6, 1], [0.32, 0.55], [0.04, 0.16]],
    sweep: [[0, 0], [1, 0], [0.92, 0.8], [0.74, 1], [0.45, 0.6], [0.15, 0.3], [-0.02, 0.18]],
    low: [[0, 0], [1, 0], [0.92, 0.8], [0.6, 1], [0.2, 0.9], [-0.02, 0.4]],
    nub: [[0, 0], [1, 0], [0.5, 1], [0, 0.5]],
    sickle: [[0, 0], [1, 0], [0.75, 0.55], [0.1, 0.95], [-0.45, 1.05], [-0.1, 0.55], [-0.02, 0.15]],
    sail: [[0, 0], [1, 0], [0.97, 0.7], [0.85, 1], [0.6, 0.98], [0.35, 0.85], [0.12, 0.6], [-0.03, 0.3]],
  };
  const spiny = (n) => {
    const o = [[0, 0], [1, 0]];
    for (let k = 0; k < n; k++) {
      const s = 1 - k / n, hgt = 1 - 0.25 * k / n;
      o.push([s - 0.08 / n, hgt], [s - 0.6 / n, hgt * 0.62]);
    }
    o.push([0.02, 0.5]);
    return o;
  };
  const sets = L.fins;
  const fins = (list, up) => (list || []).forEach((d) => {
    const xa = fx(d.f[0]), xb = fx(d.f[1]);
    const outline = d.kind === 'spiny' ? spiny(lod === 0 ? 4 : 6) : (OUT[d.kind] || OUT.tri);
    const map = (s, q) => {
      const xr = xa + (xb - xa) * clamp(s, 0, 1), p = prof(xr), root = up ? p.ht : -p.hb;
      return [xa + (xb - xa) * s - q * d.h * 0.45, root + (up ? 1 : -1) * (q * d.h - 0.006), 0];
    };
    fin('body', outline, map, { glow: !!L.glow });
  });
  fins(sets.dorsal, true);
  fins(sets.anal, false);
  // Pectorals (mirrored) behind the gill, angled back and out.
  if (sets.pect) {
    const xp = fx(0.78) - 0.02, pp = prof(xp), len = sets.pect, y0 = -pp.hb * 0.35, bl = Math.min(0.05, pp.hb * 0.5);
    const map = (s, q) => [xp - q * len * 0.85 + s * 0.01, y0 + s * bl - q * len * 0.3, pp.w * 0.85 + q * len * 0.38];
    fin('body', [[0, 0], [1, 0], [0.85, 0.75], [0.5, 1], [0.1, 0.8]], map, { mirror: true, glow: !!L.glow });
  }
  if (sets.pelvic) {
    const xa = fx(sets.pelvic - 0.07), xb = fx(sets.pelvic), len = 0.045;
    const map = (s, q) => { const x = xa + (xb - xa) * s, p = prof(x); return [x - q * 0.035, -p.hb * 0.92 - q * len, p.w * 0.3 + q * 0.02]; };
    fin('body', [[0, 0], [1, 0], [0.5, 1], [0.1, 0.8]], map, { mirror: true });
  }
  // Finlets (mackerel/tuna): small triangles on the top + bottom ridge in front of the tail.
  if (L.finlets) {
    const { n, f, color } = L.finlets;
    for (let k = 0; k < n; k++) {
      const xa = fx(f[0] + (f[1] - f[0]) * k / n), xb = xa + BL * (f[1] - f[0]) / n * 0.8;
      for (const up of [true, false]) {
        const map = (s, q) => { const x = xa + (xb - xa) * s, p = prof(x); return [x - q * 0.012, (up ? 1 : -1) * ((up ? p.ht : p.hb) - 0.003 + q * 0.024), 0]; };
        fin('body', [[0, 0], [1, 0], [0.2, 1]], map, { color, region: 'finlet' });
      }
    }
  }
  // Tail (local coords: origin at the peduncle, extends to -X).
  {
    const TL = S.tail, pp = prof(x0), ph = Math.max(pp.ht, 0.012), Sp = L.span || Math.max(0.12, S.H * 0.75);
    const kind = L.tailKind;
    let o;
    if (kind === 'round') o = [[0.02, ph], [-TL * 0.55, Sp * 0.85], [-TL * 0.92, Sp * 0.6], [-TL * 1.0, 0], [-TL * 0.92, -Sp * 0.6], [-TL * 0.55, -Sp * 0.85], [0.02, -ph]];
    else if (kind === 'square') o = [[0.02, ph], [-TL * 0.85, Sp * 0.9], [-TL * 1.0, Sp * 0.82], [-TL * 0.84, 0], [-TL * 1.0, -Sp * 0.82], [-TL * 0.85, -Sp * 0.9], [0.02, -ph]];
    else if (kind === 'sickle') o = [[0.02, ph], [-TL * 0.45, Sp * 0.6], [-TL * 1.0, Sp * 1.35], [-TL * 0.62, Sp * 0.5], [-TL * 0.35, 0], [-TL * 0.62, -Sp * 0.5], [-TL * 1.0, -Sp * 1.35], [-TL * 0.45, -Sp * 0.6], [0.02, -ph]];
    else if (kind === 'fan') {
      o = [[0.02, ph]];
      const n = lod === 0 ? 5 : 7;
      for (let k = 0; k <= n; k++) {
        const a = (0.5 - k / n) * 2.2, r = TL * (k % 2 ? 0.84 : 1.0);
        o.push([-Math.cos(a) * r * 0.95 + 0.01, Math.sin(a) * r * 1.25 * Sp / TL * 0.85]);
      }
      o.push([0.02, -ph]);
    } else o = [[0.02, ph], [-TL * 0.6, Sp * 0.75], [-TL * 1.0, Sp * 1.05], [-TL * 0.5, 0], [-TL * 1.0, -Sp * 1.05], [-TL * 0.6, -Sp * 0.75], [0.02, -ph]];
    // tail outline as (s,q): convert to polar-ish q = distance from root for colour + glow inset.
    const maxR = Math.max(...o.map(([x, y]) => Math.hypot(x, y)));
    const sq = o.map(([x, y]) => [x, y, Math.hypot(x, y) / maxR]);
    const outline = sq.map(([x, y, q]) => [x, y]);
    // simple custom fin with radial q
    const glow = !!L.glow;
    let pts = outline;
    if (glow) {
      const inner = outline.map(([x, y]) => [x * 0.8, y * 0.8]);
      for (let i = 1; i < outline.length - 2; i++) {
        const a = [...outline[i], 0], b = [...outline[i + 1], 0], c = [...inner[i + 1], 0], d = [...inner[i], 0];
        const t1 = tg('glow', {}), t2 = tg('glow', {});
        twin('glowTail', a, b, c, t1); twin('glowTail', a, c, d, t2);
      }
      pts = [outline[0], ...inner.slice(1, -1), outline[outline.length - 1]];
    }
    const faces = T.ShapeUtils.triangulateShape(pts.map(([x, y]) => new T.Vector2(x, y)), []);
    for (const [ia, ib, ic] of faces) {
      const a = [...pts[ia], 0], b = [...pts[ib], 0], c = [...pts[ic], 0];
      const q = (Math.hypot(a[0], a[1]) + Math.hypot(b[0], b[1]) + Math.hypot(c[0], c[1])) / 3 / maxR;
      twin('tail', a, b, c, tg('fin', { q, x: x0 + (a[0] + b[0] + c[0]) / 3, tail: true }));
    }
  }
  // Eyes: white disc + black pupil + catchlight, oriented to the head surface (mirrored).
  {
    const xe = 0.5 - BL * (S.flatHead ? 0.1 : 0.13), pe = prof(xe), r = L.eye;
    const ye = S.flatHead ? pe.ht * 0.55 : pe.ht * 0.3, a = Math.asin(clamp(ye / pe.ht, -1, 1));
    const P = sec(xe, a), Px = sec(xe + 0.01, a), Pa = sec(xe, a + 0.05);
    const t1 = new T.Vector3(Px[0] - P[0], Px[1] - P[1], Px[2] - P[2]).normalize();
    const t2 = new T.Vector3(Pa[0] - P[0], Pa[1] - P[1], Pa[2] - P[2]).normalize();
    const n = new T.Vector3().crossVectors(t1, t2).normalize();
    t2.crossVectors(n, t1).normalize();
    const at = (u, v, lift) => [P[0] + t1.x * u + t2.x * v + n.x * lift, P[1] + t1.y * u + t2.y * v + n.y * lift, P[2] + t1.z * u + t2.z * v + n.z * lift];
    const disc = (cu, cv, rad, lift, seg, region) => {
      const c = at(cu, cv, lift);
      for (let k = 0; k < seg; k++) {
        const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2;
        const p0 = at(cu + Math.cos(a0) * rad, cv + Math.sin(a0) * rad, lift), p1 = at(cu + Math.cos(a1) * rad, cv + Math.sin(a1) * rad, lift);
        const t = tg(region, {});
        tri('body', c, p0, p1, t); tri('body', mz(c), mz(p1), mz(p0), t);
      }
    };
    const seg = lod === 0 ? 5 : 7;
    disc(0, 0, r, r * 0.25, seg, 'eye');
    disc(r * 0.15, r * 0.05, r * 0.58, r * 0.3, seg, 'pupil');
    if (lod > 0) disc(r * 0.32, r * 0.25, r * 0.17, r * 0.34, 3, 'eye');
  }
  // Catfish barbels: tapered ribbons from the mouth corners and chin.
  if (L.whiskers) {
    const segs = lod === 0 ? 2 : 3;
    const pn = prof(0.47);
    const barbel = (start, dir, droop, len, w0) => {
      const pts = [];
      for (let k = 0; k <= segs; k++) {
        const s = k / segs;
        pts.push([start[0] + dir[0] * len * s, start[1] + dir[1] * len * s - droop * s * s, start[2] + dir[2] * len * s, w0 * (1 - s * 0.85)]);
      }
      for (let k = 0; k < segs; k++) {
        const [ax, ay, az, aw] = pts[k], [bx, by, bz, bw] = pts[k + 1];
        const A = [ax, ay + aw, az], B = [ax, ay - aw, az], C = [bx, by - bw, bz], D = [bx, by + bw, bz];
        const t = tg('whisker', {});
        twin('body', A, B, C, t); twin('body', A, C, D, t);
        twin('body', mz(A), mz(B), mz(C), t); twin('body', mz(A), mz(C), mz(D), t);
      }
    };
    barbel([0.485, -0.005, pn.w * 0.75], [-0.7, 0.1, 0.7], 0.09, 0.26, 0.009);
    barbel([0.47, -pn.hb * 0.8, pn.w * 0.4], [-0.55, -0.7, 0.45], 0.02, 0.11, 0.006);
  }
  // Salmon kype: hooked lower jaw tip.
  if (L.kype) {
    const pk = prof(0.44);
    const o = [[0.4, -pk.hb * 0.5], [0.5, -0.024], [0.53, 0.01], [0.548, -0.004], [0.535, -0.034], [0.47, -pk.hb * 0.85]];
    const v2 = o.map(([x, y]) => new T.Vector2(x, y));
    for (const [ia, ib, ic] of T.ShapeUtils.triangulateShape(v2, [])) {
      for (const z of [pk.w * 0.35, -pk.w * 0.35]) twin('body', [...o[ia], z], [...o[ib], z], [...o[ic], z], tg('jaw', {}));
    }
  }
  // Pattern overlays hugging the body surface (crisper than per-face colours).
  const lift = (p) => [p[0], p[1] * 1.015, p[2] * 1.015 + (p[2] >= 0 ? 0.0015 : -0.0015)];
  const band = (xAt, a0, a1, half, seg, region) => {
    const t = tg(region, {});
    for (let i = 0; i < seg; i++) {
      const aa = a0 + (a1 - a0) * i / seg, ab = a0 + (a1 - a0) * (i + 1) / seg;
      const P = (dx, a) => lift(sec(xAt(a) + dx, a));
      let A = P(-half, aa), B = P(half, aa), C = P(half, ab), D = P(-half, ab);
      if (ab < aa) [A, B, C, D] = [B, A, D, C];
      tri('body', A, B, C, t); tri('body', A, C, D, t);
      tri('body', mz(A), mz(C), mz(B), t); tri('body', mz(A), mz(D), mz(C), t);
    }
  };
  if (L.pattern === 'stripes') {
    const n = lod === 0 ? 5 : 8;
    for (let k = 0; k < n; k++) {
      const xc = fx(0.14 + 0.66 * k / (n - 1)), ph = k * 1.7;
      band((a) => xc + 0.022 * Math.sin(a * 6 + ph) - (Math.PI / 2 - a) * 0.03, Math.PI / 2, 0.3, 0.011, lod === 0 ? 2 : 3, 'stripe');
    }
  } else if (L.pattern === 'bars') {
    const n = 5;
    for (let k = 0; k < n; k++) { const xc = fx(0.2 + 0.55 * k / (n - 1)); band(() => xc, 1.45, -0.85, 0.02, lod === 0 ? 3 : 4, 'stripe'); }
  }
  if (L.pattern === 'spots' || L.fleck) {
    const n = L.fleck ? (lod === 0 ? 3 : 5) : (lod === 0 ? 7 : 14), r = L.fleck ? 0.013 : 0.009;
    for (let k = 0; k < n; k++) {
      const x = fx(0.08 + 0.75 * hash(k * 3.1 + 7)), a = 0.15 + 1.25 * hash(k * 5.7 + 1), p = prof(x), da = r / Math.max(p.ht, 0.02) * 1.3;
      const P = (dx, d) => lift(sec(x + dx, a + d));
      const A = P(r, 0), B = P(0, da), C = P(-r, 0), D = P(0, -da), t = tg(L.fleck ? 'fleck' : 'spot', {});
      tri('body', D, A, B, t); tri('body', D, B, C, t);
      const x2 = x + 0.03 * (hash(k) - 0.5);
      const A2 = lift(sec(x2 + r, a)), B2 = lift(sec(x2, a + da)), C2 = lift(sec(x2 - r, a)), D2 = lift(sec(x2, a - da));
      tri('body', mz(D2), mz(B2), mz(A2), t); tri('body', mz(D2), mz(C2), mz(B2), t);
    }
  }
  // Grill stripes (cooked/burnt only): slanted bands hugging both flanks.
  {
    const nS = 3, seg = lod === 0 ? 3 : 4, half = 0.016;
    for (let k = 0; k < nS; k++) {
      const xc = fx(0.3 + 0.2 * k);
      const at = (dx, a) => { const p = sec(xc + dx + Math.sin(a) * 0.05, a); const pr = prof(p[0]); return [p[0], p[1] * 1.02, p[2] + 0.0025 + pr.w * 0.02]; };
      for (let i = 0; i < seg; i++) {
        const a0 = -0.9 + 1.8 * i / seg, a1 = -0.9 + 1.8 * (i + 1) / seg;
        const A = at(-half, a0), B = at(half, a0), C = at(half, a1), D = at(-half, a1);
        tri('grill', A, B, C, null); tri('grill', A, C, D, null);
        tri('grill', mz(A), mz(C), mz(B), null); tri('grill', mz(A), mz(D), mz(C), null);
      }
    }
  }
  return { parts, faceTags, x0 };
}

// ---------------------------------------------------------------- colours
function colorFaces(T, L, tags, state) {
  const C = (v) => new T.Color(v);
  const out = new Float32Array(tags.length * 9);
  const body = C(L.body), belly = C(L.belly), mid = L.mid ? C(L.mid) : null, finC = C(L.fin);
  const dark = L.dark ? C(L.dark) : body.clone().multiplyScalar(0.35);
  const glow = C(L.glow || '#ffe066'), white = C('#f4f2ea'), black = C('#101214');
  const cb = C('#8a4f22'), cbel = C('#e2aa5f'), cfin = C('#7a431c'), cchar = C('#3a2110');
  const ash = C('#4a4442'), coal = C('#221d1b'), ember = C('#7a2a14');
  const tmp = new T.Color(), lumC = new T.Color(), shim = L.shimmer || 0.08;
  const grad = (u, c) => {
    if (mid) {
      if (u > 0) c.copy(mid).lerp(body, smooth(0.0, 0.6, u));
      else c.copy(mid).lerp(belly, smooth(-0.05, -0.55, u));
    } else c.copy(belly).lerp(body, smooth(-0.35, 0.5, u));
    return c;
  };
  const raw = (t, c) => {
    switch (t.r) {
      case 'body': {
        grad(t.u, c);
        const p = L.pattern;
        if (p === 'mottle' && t.u > -0.3 && t.k < 0.3) c.lerp(dark, 0.5);
        else if (p === 'scales') {
          if (t.i % 2) c.lerp(C('#fff4c4'), 0.25);
          if (Math.abs(t.u) < 0.18) c.lerp(glow, 0.35);
        }
        if (t.f > 0.8 && t.f < 0.86 && t.u > -0.8) c.multiplyScalar(0.82); // gill line
        if (t.f > 0.985) c.multiplyScalar(0.7); // mouth
        c.multiplyScalar(1 - shim / 2 + shim * t.k);
        return c;
      }
      case 'fin': return c.copy(t.color ? C(t.color) : finC).lerp(t.tail && L.pattern === 'spots' && t.k < 0.25 ? dark : finC.clone().multiplyScalar(0.7), clamp(t.q, 0, 1) * 0.8).multiplyScalar(0.96 + 0.08 * t.k);
      case 'stripe': return c.copy(body).lerp(dark, L.pattern === 'bars' ? 0.6 : 0.9);
      case 'spot': return c.copy(dark);
      case 'fleck': return c.set(L.fleck).lerp(glow, 0.3);
      case 'finlet': return c.copy(t.color ? C(t.color) : finC);
      case 'glow': return c.copy(glow).lerp(white, 0.3 * t.k);
      case 'eye': return c.copy(L.glow ? C('#fff3b8') : white);
      case 'pupil': return c.copy(black);
      case 'whisker': return L.whisker ? c.set(L.whisker) : c.copy(dark).lerp(belly, 0.15);
      case 'jaw': return c.copy(body).multiplyScalar(0.75);
      default: return c.copy(body);
    }
  };
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i], c = tmp;
    raw(t, c);
    if (state === 'cooked') {
      const lum = lumC.setScalar(c.r * 0.3 + c.g * 0.55 + c.b * 0.15);
      if (t.r === 'body' || t.r === 'jaw') c.copy(cbel).lerp(cb, smooth(-0.6, 0.8, t.u ?? 0.3)).lerp(lum, 0.12).multiplyScalar(0.84 + 0.28 * t.k);
      else if (t.r === 'stripe' || t.r === 'spot') c.copy(cb).multiplyScalar(0.55 + 0.2 * t.k);
      else if (t.r === 'fleck') c.copy(cbel).multiplyScalar(0.9);
      else if (t.r === 'eye') c.set('#d8cfbf');
      else if (t.r === 'pupil') c.set('#6b5c4e');
      else c.copy(cfin).lerp(cchar, clamp(t.q ?? 0.6, 0, 1)).multiplyScalar(0.85 + 0.3 * t.k);
    } else if (state === 'burnt') {
      if (t.r === 'body' || t.r === 'jaw' || t.r === 'stripe' || t.r === 'spot' || t.r === 'fleck') c.copy(coal).lerp(ash, t.u > 0.4 ? 0.6 * t.k : 0.15).lerp(ember, t.k > 0.86 ? 0.7 : 0);
      else if (t.r === 'eye' || t.r === 'pupil') c.set('#3b3533');
      else c.copy(coal).multiplyScalar(0.7 + 0.4 * t.k);
    }
    for (let v = 0; v < 3; v++) { out[i * 9 + v * 3] = c.r; out[i * 9 + v * 3 + 1] = c.g; out[i * 9 + v * 3 + 2] = c.b; }
  }
  return out;
}

function entryFor(T, speciesId, lod) {
  const L = resolveLook(speciesId);
  const key = L.key + '|' + lod;
  let e = geoCache.get(key);
  if (!e) {
    const build = buildFish(T, L, lod);
    const base = {};
    for (const part of Object.keys(build.parts)) {
      if (!build.parts[part].length) continue;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(build.parts[part]), 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      base[part] = g;
    }
    e = { L, build, base, geos: {} };
    geoCache.set(key, e);
  }
  return e;
}

function geometry(T, e, part, state) {
  const k = part === 'grill' ? 'raw' : state;
  const g = (e.geos[k] = e.geos[k] || {});
  if (!g[part]) {
    const src = e.base[part];
    if (part === 'grill') g[part] = src;
    else {
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', src.attributes.position);
      geo.setAttribute('normal', src.attributes.normal);
      geo.setAttribute('color', new T.BufferAttribute(colorFaces(T, e.L, e.build.faceTags[part], state), 3));
      geo.boundingSphere = src.boundingSphere.clone();
      g[part] = geo;
    }
  }
  return g[part];
}

function material(T, kind, state) {
  const key = kind + '|' + state;
  let m = matCache.get(key);
  if (!m) {
    if (kind === 'glow' && state === 'raw') m = new T.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false });
    else if (kind === 'grill') m = new T.MeshStandardMaterial({ color: 0x1b0f09, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    else m = new T.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, flatShading: true, metalness: state === 'raw' ? 0.08 : 0,
      roughness: { raw: 0.48, cooked: 0.72, burnt: 0.95 }[state],
    });
    m.name = 'fish:' + key;
    matCache.set(key, m);
  }
  return m;
}

const PART_MAT = { body: 'main', tail: 'main', glowBody: 'glow', glowTail: 'glow', grill: 'grill' };

export function createFishModel(T, speciesId, { cm = 25, state = 'raw', lod = 1 } = {}) {
  const lv = clamp(Math.round(Number(lod) || 0), 0, 2);
  const e = entryFor(T, speciesId, lv);
  const length = Math.max(0.01, (Number(cm) || 25) / 100);
  const group = new T.Group();
  group.name = 'fish:' + speciesId;
  const model = new T.Group();
  model.name = 'fishModel';
  model.scale.setScalar(length);
  group.add(model);
  const meshes = [];
  const mk = (part, parent) => {
    if (!e.base[part]) return null;
    const m = new T.Mesh(e.base[part], material(T, 'main', 'raw'));
    m.name = 'fish-' + part;
    m.userData.part = part;
    m.castShadow = part !== 'grill';
    parent.add(m);
    meshes.push(m);
    return m;
  };
  const body = mk('body', model);
  const tail = new T.Object3D();
  tail.name = 'fishTail';
  tail.position.set(e.build.x0, 0, 0);
  body.add(tail);
  mk('tail', tail);
  mk('glowBody', body);
  mk('glowTail', tail);
  mk('grill', body);
  group.userData = {
    speciesId, state: 'raw', length, tail,
    // Shared cached geometries/materials are NOT disposed here (see disposeFishCache()).
    dispose() { group.removeFromParent(); },
  };
  Object.defineProperty(group.userData, '_fish', { value: { T, e, meshes, body, phase: Math.random() * 6.283 }, enumerable: false });
  setFishState(group, state);
  return group;
}

export function setFishState(group, state) {
  const f = group && group.userData && group.userData._fish;
  if (!f) return;
  const st = STATES.includes(state) ? state : 'raw';
  for (const m of f.meshes) {
    const part = m.userData.part;
    m.geometry = geometry(f.T, f.e, part, st);
    m.material = material(f.T, PART_MAT[part], st);
    if (part === 'grill') m.visible = st !== 'raw';
  }
  group.userData.state = st;
}

export function wiggle(group, time, amount = 1) {
  const f = group && group.userData && group.userData._fish;
  if (!f) return;
  const t = time * 9 + f.phase;
  group.userData.tail.rotation.y = Math.sin(t) * 0.5 * amount;
  f.body.rotation.y = -Math.sin(t - 0.7) * 0.09 * amount;
}

export function disposeFishCache() {
  for (const e of geoCache.values()) {
    for (const st of Object.values(e.geos)) for (const g of Object.values(st)) if (!Object.values(e.base).includes(g)) g.dispose();
    for (const g of Object.values(e.base)) g.dispose();
  }
  geoCache.clear();
  for (const m of matCache.values()) m.dispose();
  matCache.clear();
}
