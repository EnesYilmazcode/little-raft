// Little Raft - building pieces: grid rules, aiming and walkable collision.
// Pure ES module: no DOM, no THREE. Raft-local coordinates (== world XZ).
// Cell (i,j) centre (2i,2j); corner (i,j) at (2i-1,2j-1); edge (i,j,0) = -z side of cell, (i,j,1) = -x side.
// base(l) = deckY + l*LEVEL_H. Records: {t, i, j, l, r} (r = rotation for cell pieces, axis for edges, 0 for pillar).

export const LEVEL_H = 2.2;
export const FLOOR_THICK = 0.12;
export const DIR = Object.freeze([[0, 1], [1, 0], [0, -1], [-1, 0]].map(d => Object.freeze(d)));
export const SLOT = Object.freeze({BASE: 0, VOLUME: 1, EDGE: 2, CORNER: 3});

const MAX_IJ = 26, MAX_L = 5, MAX_PIECES = 600;
const WALL_HALF = 0.07, PILLAR_HALF = 0.11, DOOR_W = 1.0, DOOR_H = 1.95, ROOF_RISE = 1.0;
const MARGIN = 0.15, STEP_UP = 0.55, DROP = 0.35, BODY_R = 0.25, EYE = 1.6, HEAD = 0.15;

const piece = (id, name, slot, cost, full, height) => Object.freeze({id, name, slot, cost: Object.freeze(cost), full, height});
export const PIECES = Object.freeze({
  foundation: piece('foundation', 'Foundation', 'tile', {wood: 2, plastic: 2}, false, 0),
  floor: piece('floor', 'Floor', 'cell', {wood: 2}, false, FLOOR_THICK),
  wall: piece('wall', 'Wall', 'edge', {wood: 2}, true, LEVEL_H),
  halfwall: piece('halfwall', 'Half wall', 'edge', {wood: 1}, false, LEVEL_H / 2),
  window: piece('window', 'Window', 'edge', {wood: 2}, true, LEVEL_H),
  door: piece('door', 'Doorway', 'edge', {wood: 3}, true, LEVEL_H),
  pillar: piece('pillar', 'Pillar', 'corner', {wood: 1}, false, LEVEL_H),
  stairs: piece('stairs', 'Stairs', 'cell', {wood: 3}, false, LEVEL_H),
  roof: piece('roof', 'Roof', 'cell', {wood: 1, leaf: 2}, false, ROOF_RISE),
});
export const PIECE_ORDER = Object.freeze(['foundation', 'floor', 'wall', 'halfwall', 'window', 'door', 'pillar', 'stairs', 'roof']);

// Null-prototype lookups: `t in SLOT_OF` must not accept 'constructor' / '__proto__' / 'toString' from saves or guests.
const SLOT_OF = Object.assign(Object.create(null), {floor: 0, roof: 0, stairs: 1, wall: 2, halfwall: 2, window: 2, door: 2, pillar: 3});
const ORDER_OF = Object.create(null);
PIECE_ORDER.forEach((t, k) => { ORDER_OF[t] = k; });

// Integer slot key (no strings). t_or_slot: a piece type or a SLOT code; sub = edge axis (ignored otherwise).
export function pieceKey(tOrSlot, i, j, l, sub = 0) {
  const s = typeof tOrSlot === 'number' ? tOrSlot : SLOT_OF[tOrSlot];
  return (((s * 8 + l) * 64 + (i + 32)) * 64 + (j + 32)) * 2 + (s === 2 ? sub & 1 : 0);
}
const tileKey = (i, j) => (i + 4096) * 8192 + (j + 4096);
const isInt = v => Number.isInteger(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const inside = u => u < 0.98 && u > -0.98;

// Slab test scratch (module level, zero allocation).
let tn = 0, tf = 0;
function slab(o, d, lo, hi) {
  if (d > -1e-9 && d < 1e-9) return o >= lo && o <= hi;
  let a = (lo - o) / d, b = (hi - o) / d;
  if (a > b) { const t = a; a = b; b = t; }
  if (a > tn) tn = a;
  if (b < tf) tf = b;
  return tn <= tf;
}
// Entry distance of a ray into box b[k..k+5] (y relative to deckY), or -1 (miss, or origin inside).
function rayBox(ox, oy, oz, dx, dy, dz, b, k, dy0) {
  tn = -Infinity; tf = Infinity;
  if (!slab(ox, dx, b[k], b[k + 3]) || !slab(oy, dy, b[k + 1] + dy0, b[k + 4] + dy0) || !slab(oz, dz, b[k + 2], b[k + 5])) return -1;
  return tn >= 0 ? tn : -1;
}

export class BuildGrid {
  constructor() {
    this.list = [];
    this.version = 0;
    this._map = new Map();
    this._tiles = new Set();
    this._tileArr = [];
    this._boxVersion = -1;
    this._pick = new Float64Array(64); this._pickRec = []; this._pickN = 0;
    this._solid = new Float64Array(64); this._solidN = 0;
    this._c = {t: '', i: 0, j: 0, l: 0, r: 0};
    this._aimOut = {ok: false, reason: '', t: '', i: 0, j: 0, l: 0, r: 0, x: 0, y: 0, z: 0};
    this._cell = [[0, 0]];
    this._pre = {deckY: 0, tiles: this._tileArr};
  }

  setTiles(tiles) {
    this._tiles.clear();
    this._tileArr = Array.isArray(tiles) ? tiles : [];
    for (const t of this._tileArr) if (Array.isArray(t) && isInt(t[0]) && isInt(t[1])) this._tiles.add(tileKey(t[0], t[1]));
    this.version++;
  }

  load(raw) {
    this.list.length = 0; this._map.clear(); this.version++;
    const cand = [];
    if (Array.isArray(raw)) {
      for (const p of raw) {
        if (!p || typeof p !== 'object' || typeof p.t !== 'string' || !(p.t in SLOT_OF)) continue;
        const r = p.t === 'pillar' ? 0 : p.r === undefined ? 0 : p.r;
        if (!isInt(p.i) || !isInt(p.j) || !isInt(p.l) || !isInt(r)) continue;
        cand.push({t: p.t, i: p.i, j: p.j, l: p.l, r});
      }
    }
    // Canonical order so the result does not depend on input order; then place until stable.
    cand.sort((a, b) => a.l - b.l || ORDER_OF[a.t] - ORDER_OF[b.t] || a.i - b.i || a.j - b.j || a.r - b.r);
    const done = new Uint8Array(cand.length);
    for (let progress = true; progress;) {
      progress = false;
      for (let k = 0; k < cand.length; k++) if (!done[k] && this.canPlace(cand[k]) === '') { this.place(cand[k]); done[k] = 1; progress = true; }
    }
    return this.list.map(p => ({t: p.t, i: p.i, j: p.j, l: p.l, r: p.r}));
  }

  // ---------- lookups ----------
  _get(s, i, j, l, sub) { return l < 0 || l > MAX_L ? undefined : this._map.get(pieceKey(s, i, j, l, sub)); }
  _tile(i, j) { return this._tiles.has(tileKey(i, j)); }
  _floor(i, j, l) { const p = this._get(0, i, j, l, 0); return !!p && p.t === 'floor'; }
  _full(i, j, a, l) { const p = this._get(2, i, j, l, a); return !!p && PIECES[p.t].full; }
  _pillar(i, j, l) { return !!this._get(3, i, j, l, 0); }

  find(p) {
    if (!p || typeof p.t !== 'string' || !(p.t in SLOT_OF) || !isInt(p.i) || !isInt(p.j) || !isInt(p.l)) return null;
    if (Math.abs(p.i) > MAX_IJ + 1 || Math.abs(p.j) > MAX_IJ + 1) return null;
    return this._get(SLOT_OF[p.t], p.i, p.j, p.l, p.r | 0) || null;
  }

  // Floor/roof direct support: full edge or pillar below, or stairs below landing into this cell.
  _direct(i, j, l) {
    const b = l - 1;
    if (this._full(i, j, 0, b) || this._full(i, j + 1, 0, b) || this._full(i, j, 1, b) || this._full(i + 1, j, 1, b)) return true;
    if (this._pillar(i, j, b) || this._pillar(i + 1, j, b) || this._pillar(i, j + 1, b) || this._pillar(i + 1, j + 1, b)) return true;
    for (let r = 0; r < 4; r++) {
      const s = this._get(1, i - DIR[r][0], j - DIR[r][1], b, 0);
      if (s && s.r === r) return true;
    }
    return false;
  }

  _supported(t, i, j, l, r) {
    switch (SLOT_OF[t]) {
      case 3: // pillar
        if (l === 0) return this._tile(i, j) || this._tile(i - 1, j) || this._tile(i, j - 1) || this._tile(i - 1, j - 1);
        return this._pillar(i, j, l - 1) || this._floor(i, j, l) || this._floor(i - 1, j, l) || this._floor(i, j - 1, l) || this._floor(i - 1, j - 1, l);
      case 2: { // edge piece; touching cells (i,j) and (i-1,j) for a=1 or (i,j-1) for a=0
        const pi = r === 1 ? i - 1 : i, pj = r === 1 ? j : j - 1;
        if (l === 0) return this._tile(i, j) || this._tile(pi, pj);
        return this._floor(i, j, l) || this._floor(pi, pj, l) || this._full(i, j, r, l - 1);
      }
      case 1: return l === 0 ? this._tile(i, j) : this._floor(i, j, l);
      default: { // floor / roof
        if (l < 1) return false;
        if (this._direct(i, j, l)) return true;
        for (let r2 = 0; r2 < 4; r2++) {
          const ni = i + DIR[r2][0], nj = j + DIR[r2][1];
          if (this._get(0, ni, nj, l, 0) && this._direct(ni, nj, l)) return true;
        }
        return false;
      }
    }
  }

  // ---------- rules ----------
  canPlace(p) {
    if (!p || typeof p !== 'object' || typeof p.t !== 'string' || !(p.t in SLOT_OF)) return 'Unknown piece';
    const {t, i, j, l} = p, r = p.r === undefined ? 0 : p.r, s = SLOT_OF[t];
    if (!isInt(i) || !isInt(j) || !isInt(l) || !isInt(r) || l < 0) return 'Bad position';
    if (Math.abs(i) > MAX_IJ || Math.abs(j) > MAX_IJ) return 'Too far out';
    if (l > MAX_L) return 'Too high';
    if (s === 3 ? r !== 0 : s === 2 ? r < 0 || r > 1 : r < 0 || r > 3) return 'Bad rotation';
    if (s === 0 && l < 1) return 'Build this above the deck';
    if (this._get(s, i, j, l, r)) return 'Something is already here';
    if (this.list.length >= MAX_PIECES) return 'Too many pieces';
    if (s === 1 && this._get(0, i, j, l + 1, 0)) return 'Floor above is in the way';
    if (s === 0 && this._get(1, i, j, l - 1, 0)) return 'Stairs are in the way';
    if (!this._supported(t, i, j, l, r)) return 'Needs support below';
    return '';
  }

  place(p) {
    if (this.canPlace(p) !== '') return false;
    const rec = {t: p.t, i: p.i, j: p.j, l: p.l, r: p.t === 'pillar' || p.r === undefined ? 0 : p.r};
    this.list.push(rec);
    this._map.set(pieceKey(rec.t, rec.i, rec.j, rec.l, rec.r), rec);
    this.version++;
    return true;
  }

  canRemove(p) {
    const rec = this.find(p);
    if (!rec || (p.t !== rec.t)) return 'Nothing to remove';
    const key = pieceKey(rec.t, rec.i, rec.j, rec.l, rec.r);
    this._map.delete(key);
    let ok = true;
    for (let k = 0; k < this.list.length && ok; k++) {
      const q = this.list[k];
      if (q !== rec && !this._supported(q.t, q.i, q.j, q.l, q.r)) ok = false;
    }
    this._map.set(key, rec);
    return ok ? '' : 'Something rests on this';
  }

  remove(p) {
    if (this.canRemove(p) !== '') return false;
    const rec = this.find(p);
    this._map.delete(pieceKey(rec.t, rec.i, rec.j, rec.l, rec.r));
    this.list.splice(this.list.indexOf(rec), 1);
    this.version++;
    return true;
  }

  // ---------- cached boxes (y relative to deckY) ----------
  _rebuild() {
    if (this._boxVersion === this.version) return;
    this._boxVersion = this.version;
    const n = this.list.length;
    if (this._pick.length < n * 6) this._pick = new Float64Array(n * 12);
    if (this._solid.length < n * 18) this._solid = new Float64Array(n * 36);
    this._pickRec.length = n; this._pickN = 0; this._solidN = 0;
    for (const p of this.list) {
      const y0 = p.l * LEVEL_H, cx = 2 * p.i, cz = 2 * p.j, s = SLOT_OF[p.t];
      this._pickRec[this._pickN] = p;
      if (s === 0 || s === 1) {
        const top = s === 1 ? LEVEL_H : p.t === 'roof' ? ROOF_RISE : 0;
        this._box(this._pick, this._pickN++, cx - 1, cx + 1, y0 - (s === 1 ? 0 : FLOOR_THICK), y0 + top, cz - 1, cz + 1, 0);
      } else if (s === 3) {
        const x = cx - 1, z = cz - 1, h = PILLAR_HALF;
        this._box(this._pick, this._pickN++, x - h, x + h, y0, y0 + LEVEL_H, z - h, z + h, 0);
        this._box(this._solid, this._solidN++, x - h, x + h, y0, y0 + LEVEL_H, z - h, z + h, 0);
      } else {
        const a = p.r, u = a ? cz - 1 : cx - 1, c = a ? cx - 1 : cz - 1, h = PIECES[p.t].height;
        this._box(this._pick, this._pickN++, u, u + 2, y0, y0 + h, c - WALL_HALF, c + WALL_HALF, a);
        if (p.t === 'door') {
          const side = (2 - DOOR_W) / 2;
          this._box(this._solid, this._solidN++, u, u + side, y0, y0 + h, c - WALL_HALF, c + WALL_HALF, a);
          this._box(this._solid, this._solidN++, u + 2 - side, u + 2, y0, y0 + h, c - WALL_HALF, c + WALL_HALF, a);
          this._box(this._solid, this._solidN++, u + side, u + 2 - side, y0 + DOOR_H, y0 + h, c - WALL_HALF, c + WALL_HALF, a);
        } else this._box(this._solid, this._solidN++, u, u + 2, y0, y0 + h, c - WALL_HALF, c + WALL_HALF, a);
      }
    }
  }
  // Box given as (along u, height, across c); swap = edge axis 1 (runs along Z).
  _box(arr, n, u0, u1, y0, y1, c0, c1, swap) {
    const k = n * 6;
    arr[k] = swap ? c0 : u0; arr[k + 1] = y0; arr[k + 2] = swap ? u0 : c0;
    arr[k + 3] = swap ? c1 : u1; arr[k + 4] = y1; arr[k + 5] = swap ? u1 : c1;
  }

  // ---------- aiming ----------
  pick(ox, oy, oz, dx, dy, dz, deckY, reach) {
    this._rebuild();
    let best = reach, rec = null;
    for (let n = 0; n < this._pickN; n++) {
      const t = rayBox(ox, oy, oz, dx, dy, dz, this._pick, n * 6, deckY);
      if (t >= 0 && t <= best) { best = t; rec = this._pickRec[n]; }
    }
    return rec;
  }

  aim(ox, oy, oz, dx, dy, dz, type, rot, deckY, reach, out = this._aimOut) {
    const s = SLOT_OF[type];
    const len = Math.hypot(dx, dy, dz);
    if (s === undefined || !(len > 1e-9)) return null;
    dx /= len; dy /= len; dz /= len;
    this._rebuild();
    // Nearest hit: piece boxes, then the deck plane over tiles (or just past the raft edge as a fallback).
    let hit = Infinity, plane = Infinity;
    for (let n = 0; n < this._pickN; n++) {
      const t = rayBox(ox, oy, oz, dx, dy, dz, this._pick, n * 6, deckY);
      if (t >= 0 && t < hit) hit = t;
    }
    if (dy < -1e-6) {
      const t = (deckY - oy) / dy;
      if (t >= 0 && t <= reach) {
        if (this._tile(Math.round((ox + dx * t) / 2), Math.round((oz + dz * t) / 2))) { if (t < hit) hit = t; } else plane = t;
      }
    }
    if (hit > reach) hit = plane;
    if (hit > reach) return null;
    const hb = hit - 0.02;
    const ci = Math.round((ox + dx * hb) / 2), cj = Math.round((oz + dz * hb) / 2);
    const cl = clamp(Math.floor((oy + dy * hb - deckY) / LEVEL_H), 0, MAX_L);
    const r = ((rot | 0) % 4 + 4) % 4;
    const c = this._c;
    c.t = type;
    let bestV = Infinity, bestA = Infinity, found = false;
    const lo = s === 0 || s === 1 ? 0 : 1; // cells span ci-1..ci+1, edges/corners ci-1..ci+2
    for (let l = Math.max(0, cl - 1); l <= Math.min(MAX_L, cl + 1); l++) {
      const y = deckY + l * LEVEL_H;
      for (let i = ci - 1; i <= ci + 1 + lo; i++) {
        for (let j = cj - 1; j <= cj + 1 + lo; j++) {
          for (let a = 0; a < (s === 2 ? 2 : 1); a++) {
            let ax = 2 * i, az = 2 * j;
            if (s === 3) { ax -= 1; az -= 1; } else if (s === 2) { if (a) ax -= 1; else az -= 1; }
            const vx = ax - ox, vy = y - oy, vz = az - oz, tp = vx * dx + vy * dy + vz * dz;
            if (tp < 0) continue;
            const perp = Math.sqrt(Math.max(0, vx * vx + vy * vy + vz * vz - tp * tp));
            const score = perp + Math.max(0, tp - hit - 0.3) * 0.5;
            if (score >= bestA && score >= bestV) continue;
            c.i = i; c.j = j; c.l = l; c.r = s === 2 ? a : s === 3 ? 0 : r;
            const reason = this.canPlace(c);
            if (reason === '') { if (score >= bestV) continue; bestV = score; } // valid slots beat invalid ones
            else { if (bestV < Infinity || score >= bestA) continue; bestA = score; }
            found = true;
            out.ok = reason === ''; out.reason = reason; out.t = type;
            out.i = i; out.j = j; out.l = l; out.r = c.r; out.x = ax; out.y = y; out.z = az;
          }
        }
      }
    }
    return found ? out : null;
  }

  // ---------- walking ----------
  // Highest walkable surface under the feet (step-up STEP_UP), fed to PlayerPhysics.update as {deckY, tiles}.
  preStep(phys, deckY) {
    const x = phys.x, z = phys.z, feet = phys.y - EYE, limit = feet + STEP_UP, ext = 1 + MARGIN;
    const ci = Math.round(x / 2), cj = Math.round(z / 2);
    let deck = false, best = -Infinity, bi = 0, bj = 0;
    for (let i = ci - 1; i <= ci + 1; i++) {
      const ux = x - 2 * i;
      if (ux > ext || ux < -ext) continue;
      for (let j = cj - 1; j <= cj + 1; j++) {
        const uz = z - 2 * j;
        if (uz > ext || uz < -ext) continue;
        if (!deck && this._tile(i, j)) deck = true;
        for (let l = 0; l <= MAX_L; l++) {
          const y = deckY + l * LEVEL_H;
          if (y > limit) break;
          for (let s = 0; s < 2; s++) {
            const p = this._get(s, i, j, l, 0);
            if (!p) continue;
            let h = y;
            if (p.t !== 'floor') {
              const u = clamp((ux * DIR[p.r][0] + uz * DIR[p.r][1] + 1) / 2, 0, 1);
              h += u * (p.t === 'stairs' ? LEVEL_H : ROOF_RISE);
            }
            // Stepping up needs the centre inside the cell (physics pushes out of a raised footprint otherwise).
            if (h > best && (h <= feet + 0.04 || (h <= limit && inside(ux) && inside(uz)))) { best = h; bi = i; bj = j; }
          }
        }
      }
    }
    const pre = this._pre;
    const deckH = deck && deckY <= limit ? deckY : -Infinity;
    let ground;
    if (best > deckH + 1e-6) {
      this._cell[0][0] = bi; this._cell[0][1] = bj;
      pre.deckY = ground = best; pre.tiles = this._cell;
    } else {
      pre.deckY = deckY; pre.tiles = this._tileArr; ground = deckY;
    }
    // Walked off a ledge: fall instead of snapping down.
    if (phys.grounded && feet - ground > DROP) phys.grounded = false;
    return pre;
  }

  // Push the body circle out of solid boxes and keep the head under ceilings.
  postStep(phys, deckY) {
    this._rebuild();
    const R = BODY_R, b = this._solid;
    for (let pass = 0; pass < 2; pass++) {
      const lo = phys.y - EYE + 0.05, hi = phys.y + HEAD;
      for (let n = 0, k = 0; n < this._solidN; n++, k += 6) {
        const x = phys.x, z = phys.z;
        if (x < b[k] - R || x > b[k + 3] + R || z < b[k + 2] - R || z > b[k + 5] + R) continue;
        if (b[k + 4] + deckY <= lo || b[k + 1] + deckY >= hi) continue;
        const px = clamp(x, b[k], b[k + 3]), pz = clamp(z, b[k + 2], b[k + 5]);
        let nx = x - px, nz = z - pz, d = Math.hypot(nx, nz);
        if (d >= R) continue;
        if (d > 1e-6) {
          nx /= d; nz /= d;
          phys.x = px + nx * R; phys.z = pz + nz * R;
        } else { // centre inside the box: leave by the shallowest side
          const l = x - b[k], r = b[k + 3] - x, f = z - b[k + 2], bk = b[k + 5] - z, m = Math.min(l, r, f, bk);
          nx = m === l ? -1 : m === r ? 1 : 0; nz = nx ? 0 : m === f ? -1 : 1;
          if (nx) phys.x = nx < 0 ? b[k] - R : b[k + 3] + R; else phys.z = nz < 0 ? b[k + 2] - R : b[k + 5] + R;
        }
        const vn = phys.vx * nx + phys.vz * nz;
        if (vn < 0) { phys.vx -= vn * nx; phys.vz -= vn * nz; }
      }
    }
    // Ceiling: lowest floor/roof slab bottom above the feet over the body centre.
    if (phys.vy > 0 || !phys.grounded) {
      const ci = Math.round(phys.x / 2), cj = Math.round(phys.z / 2), feet = phys.y - EYE;
      for (let l = 1; l <= MAX_L; l++) {
        if (!this._get(0, ci, cj, l, 0)) continue;
        const bottom = deckY + l * LEVEL_H - FLOOR_THICK;
        if (bottom < feet + 0.3) continue;
        if (phys.y + HEAD > bottom) { phys.y = bottom - HEAD; if (phys.vy > 0) phys.vy = 0; }
        break;
      }
    }
  }
}

let cleanGrid = null; // reused: the guest cleans every host snapshot
export function cleanPieces(raw, tiles) {
  const g = cleanGrid ??= new BuildGrid();
  g.setTiles(tiles);
  const out = g.load(raw);
  g.setTiles(null); g.load(null); // drop references to the caller's arrays
  return out;
}

export default BuildGrid;
