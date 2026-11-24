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
  railing: piece('railing', 'Railing', 'edge', {wood: 1, rope: 1}, false, 0.95),
  hatch: piece('hatch', 'Hatch', 'cell', {wood: 3, rope: 1}, false, FLOOR_THICK),
  ladder: piece('ladder', 'Ladder', 'cell', {wood: 3, rope: 1}, false, LEVEL_H),
  gate: piece('gate', 'Gate', 'edge', {wood: 2, rope: 1}, false, 0.95),
});
// New ids are appended: ORDER_OF only sets the load order, so old saves load exactly as before.
export const PIECE_ORDER = Object.freeze(['foundation', 'floor', 'wall', 'halfwall', 'window', 'door', 'pillar', 'stairs', 'roof', 'railing', 'hatch', 'ladder', 'gate']);
// Stateful pieces carry `o: 1` only while open; a closed record is the plain {t,i,j,l,r}.
export const STATEFUL = Object.freeze(Object.assign(Object.create(null), {hatch: 1, gate: 1}));
// Railing/gate height, gate opening, open hatch leaf height, ladder box (u from the
// cell centre along DIR[r], metres) and its half width.
export const RAIL_H = 0.95, GATE_GAP = 1.2, LEAF_H = 1.0, LAD_IN = 0.86, LAD_OUT = 0.96, LAD_HALF = 0.45;
// RAIL_GUARD: railing / gate collision height. It clears the highest jump (PlayerPhysics 2.445 m, x1.3225 with the
// cookpot jump buff capped at x1.15 velocity) plus ~0.25 m of deck bob, so the solid box reaches far above the
// visible rail. Where the storey above has a floor (or stairs) next to the edge, the box stops at LEVEL_H instead:
// that floor is the ceiling for jumps below it, and players walking or jumping up there never touch the box.
export const RAIL_GUARD = 3.5;
const LEAF_T = 0.06, LAD_PIN = LAD_IN - BODY_R - 0.02;

// Null-prototype lookups: `t in SLOT_OF` must not accept 'constructor' / '__proto__' / 'toString' from saves or guests.
const SLOT_OF = Object.assign(Object.create(null), {floor: 0, roof: 0, stairs: 1, wall: 2, halfwall: 2, window: 2, door: 2, pillar: 3,
  railing: 2, hatch: 0, ladder: 1, gate: 2});
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

// Canonical record: {t,i,j,l,r}, plus o:1 only for an open stateful piece (never `o: undefined`).
export function toRec(p) {
  const rec = {t: p.t, i: p.i, j: p.j, l: p.l, r: p.t === 'pillar' || p.r === undefined ? 0 : p.r};
  if (STATEFUL[p.t] && p.o === 1) rec.o = 1;
  return rec;
}

// Slab test scratch: a Float64Array, not module-level `let`s (a double stored to a context slot allocates a HeapNumber).
const TT = new Float64Array(2); // [near, far]
function slab(o, d, lo, hi) {
  if (d > -1e-9 && d < 1e-9) return o >= lo && o <= hi;
  let a = (lo - o) / d, b = (hi - o) / d;
  if (a > b) { const t = a; a = b; b = t; }
  if (a > TT[0]) TT[0] = a;
  if (b < TT[1]) TT[1] = b;
  return TT[0] <= TT[1];
}
// Entry distance of a ray into box b[k..k+5] (y relative to deckY), or -1 (miss, or origin inside).
function rayBox(ox, oy, oz, dx, dy, dz, b, k, dy0) {
  TT[0] = -Infinity; TT[1] = Infinity;
  if (!slab(ox, dx, b[k], b[k + 3]) || !slab(oy, dy, b[k + 1] + dy0, b[k + 4] + dy0) || !slab(oz, dz, b[k + 2], b[k + 5])) return -1;
  return TT[0] >= 0 ? TT[0] : -1;
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
    this._slabs = new Float64Array(64); this._slabN = 0; // floor / roof slabs (solid edges, ceilings)
    this._c = {t: '', i: 0, j: 0, l: 0, r: 0};
    this._aimOut = {ok: false, reason: '', t: '', i: 0, j: 0, l: 0, r: 0, x: 0, y: 0, z: 0};
    this._cells = []; this._lists = [];
    for (let n = 0; n <= 9; n++) { this._cells.push([0, 0]); this._lists.push(new Array(n).fill(null)); }
    this._deck = false; this._grounded = false;
    this._prevHead = Infinity; this._px = 0; this._pz = 0; this._pvy = 0;
    this._refused = null; this._rx = 0; this._rz = 0; this._rvy = 0;
    this._pre = {deckY: 0, tiles: this._tileArr};
    this._cl = null; this._climbing = false; this._lin = {forward: 0, jump: false, y: 0}; this._clTile = [0, 0]; this._clTiles = [this._clTile];
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
        cand.push(toRec({t: p.t, i: p.i, j: p.j, l: p.l, r, o: p.o}));
      }
    }
    // Canonical order so the result does not depend on input order; then place until stable.
    cand.sort((a, b) => a.l - b.l || ORDER_OF[a.t] - ORDER_OF[b.t] || a.i - b.i || a.j - b.j || a.r - b.r);
    const done = new Uint8Array(cand.length);
    for (let progress = true; progress;) {
      progress = false;
      for (let k = 0; k < cand.length; k++) if (!done[k] && this.canPlace(cand[k]) === '') { this.place(cand[k]); done[k] = 1; progress = true; }
    }
    return this.list.map(toRec);
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
    const above = s === 1 ? this._get(0, i, j, l + 1, 0) : null, below = s === 0 ? this._get(1, i, j, l - 1, 0) : null;
    if (above && !(t === 'ladder' && above.t === 'hatch')) return 'Floor above is in the way';
    if (below && !(t === 'hatch' && below.t === 'ladder')) return 'Stairs are in the way';
    if (!this._supported(t, i, j, l, r)) return 'Needs support below';
    return '';
  }

  place(p) {
    if (this.canPlace(p) !== '') return false;
    const rec = toRec(p);
    // A hatch over a ladder hinges on the sides parallel to it, so the ladder side opens: share its rotation.
    if (rec.t === 'hatch') { const b = this._get(1, rec.i, rec.j, rec.l - 1, 0); if (b && b.t === 'ladder') rec.r = b.r; }
    else if (rec.t === 'ladder') { const a = this._get(0, rec.i, rec.j, rec.l + 1, 0); if (a && a.t === 'hatch') a.r = rec.r; }
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

  // Why foundation tile (i, j) can't go: '' when every piece still stands without it (tiles hold up level-0 pieces only).
  canRemoveTile(i, j) {
    if (!isInt(i) || !isInt(j)) return 'Nothing to remove';
    const key = tileKey(i, j);
    if (!this._tiles.has(key)) return 'Nothing to remove';
    this._tiles.delete(key);
    let ok = true;
    for (let k = 0; k < this.list.length && ok; k++) {
      const q = this.list[k];
      if (q.l === 0 && !this._supported(q.t, q.i, q.j, q.l, q.r)) ok = false;
    }
    this._tiles.add(key);
    return ok ? '' : 'Something rests on this';
  }

  // Open/close a stateful piece in place. Support never reads `o`, so removal answers are unchanged.
  toggle(rec) {
    if (!rec || !STATEFUL[rec.t] || this.find(rec) !== rec) return false;
    if (rec.o === 1) delete rec.o; else rec.o = 1;
    this.version++;
    return true;
  }

  // Does a body (eye position x,y,z) overlap the closed box of a hatch or gate? Used to refuse closing on someone.
  occupied(rec, x, y, z, deckY) {
    if (!rec || !STATEFUL[rec.t] || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    const y0 = deckY + rec.l * LEVEL_H, cx = 2 * rec.i, cz = 2 * rec.j;
    let x0, x1, z0, z1, lo, hi;
    if (rec.t === 'hatch') { x0 = cx - 1; x1 = cx + 1; z0 = cz - 1; z1 = cz + 1; lo = y0 - FLOOR_THICK - 0.05; hi = y0 + 0.05; }
    else {
      const a = rec.r, u = a ? cz - 1 : cx - 1, c = a ? cx - 1 : cz - 1;
      if (a) { x0 = c - WALL_HALF; x1 = c + WALL_HALF; z0 = u; z1 = u + 2; } else { x0 = u; x1 = u + 2; z0 = c - WALL_HALF; z1 = c + WALL_HALF; }
      lo = y0; hi = y0 + RAIL_H;
    }
    if (y - EYE > hi || y + HEAD < lo) return false;
    const px = clamp(x, x0, x1) - x, pz = clamp(z, z0, z1) - z;
    return px * px + pz * pz < BODY_R * BODY_R;
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
    if (this._slabs.length < n * 6) this._slabs = new Float64Array(n * 12);
    this._pickRec.length = n; this._pickN = 0; this._solidN = 0; this._slabN = 0;
    for (const p of this.list) {
      const y0 = p.l * LEVEL_H, cx = 2 * p.i, cz = 2 * p.j, s = SLOT_OF[p.t];
      this._pickRec[this._pickN] = p;
      if (p.t === 'hatch') {
        this._box(this._pick, this._pickN++, cx - 1, cx + 1, y0 - FLOOR_THICK, y0, cz - 1, cz + 1, 0);
        if (!p.o) this._box(this._slabs, this._slabN++, cx - 1, cx + 1, y0 - FLOOR_THICK, y0, cz - 1, cz + 1, 0);
        else { // two leaves standing on the hinge edges parallel to DIR[r]; the r side stays open
          const a = p.r & 1; // r 0/2: u runs along z, leaves at x = cx +- (1 - LEAF_T/2)
          for (const sd of [-1, 1]) {
            const w = sd * (1 - LEAF_T / 2);
            if (a) this._box(this._solid, this._solidN++, cx - 1, cx + 1, y0, y0 + LEAF_H, cz + w - LEAF_T / 2, cz + w + LEAF_T / 2, 0);
            else this._box(this._solid, this._solidN++, cx + w - LEAF_T / 2, cx + w + LEAF_T / 2, y0, y0 + LEAF_H, cz - 1, cz + 1, 0);
          }
        }
      } else if (p.t === 'ladder') {
        const dx = DIR[p.r][0], dz = DIR[p.r][1];
        this._cellBox(this._pick, this._pickN++, cx, cz, dx, dz, 0.75, 1, 0.5, y0, y0 + LEVEL_H);
        this._cellBox(this._solid, this._solidN++, cx, cz, dx, dz, LAD_IN, LAD_OUT, LAD_HALF, y0, y0 + LEVEL_H);
      } else if (s === 0 || s === 1) {
        const top = s === 1 ? LEVEL_H : p.t === 'roof' ? ROOF_RISE : 0;
        this._box(this._pick, this._pickN++, cx - 1, cx + 1, y0 - (s === 1 ? 0 : FLOOR_THICK), y0 + top, cz - 1, cz + 1, 0);
        if (s === 0) this._box(this._slabs, this._slabN++, cx - 1, cx + 1, y0 - FLOOR_THICK, y0, cz - 1, cz + 1, 0);
      } else if (s === 3) {
        const x = cx - 1, z = cz - 1, h = PILLAR_HALF;
        this._box(this._pick, this._pickN++, x - h, x + h, y0, y0 + LEVEL_H, z - h, z + h, 0);
        this._box(this._solid, this._solidN++, x - h, x + h, y0, y0 + LEVEL_H, z - h, z + h, 0);
      } else {
        const a = p.r, u = a ? cz - 1 : cx - 1, c = a ? cx - 1 : cz - 1, h = PIECES[p.t].height;
        const guard = p.t === 'railing' || p.t === 'gate' ? this._railTop(p) : h;
        this._box(this._pick, this._pickN++, u, u + 2, y0, y0 + h, c - WALL_HALF, c + WALL_HALF, a);
        if (p.t === 'gate' && p.o) {
          const side = (2 - GATE_GAP) / 2;
          this._box(this._solid, this._solidN++, u, u + side, y0, y0 + guard, c - WALL_HALF, c + WALL_HALF, a);
          this._box(this._solid, this._solidN++, u + 2 - side, u + 2, y0, y0 + guard, c - WALL_HALF, c + WALL_HALF, a);
        } else if (p.t === 'door') {
          const side = (2 - DOOR_W) / 2;
          this._box(this._solid, this._solidN++, u, u + side, y0, y0 + h, c - WALL_HALF, c + WALL_HALF, a);
          this._box(this._solid, this._solidN++, u + 2 - side, u + 2, y0, y0 + h, c - WALL_HALF, c + WALL_HALF, a);
          this._box(this._solid, this._solidN++, u + side, u + 2 - side, y0 + DOOR_H, y0 + h, c - WALL_HALF, c + WALL_HALF, a);
        } else this._box(this._solid, this._solidN++, u, u + 2, y0, y0 + guard, c - WALL_HALF, c + WALL_HALF, a);
      }
    }
  }
  // Railing / gate guard height: LEVEL_H when either cell beside the edge has a floor (not an open hatch) or stairs
  // one storey up, else RAIL_GUARD.
  _railTop(p) {
    const l = p.l + 1, i2 = p.r ? p.i - 1 : p.i, j2 = p.r ? p.j : p.j - 1;
    return this._covers(p.i, p.j, l) || this._covers(i2, j2, l) ? LEVEL_H : RAIL_GUARD;
  }
  _covers(i, j, l) {
    const f = this._get(0, i, j, l, 0);
    return !!(f && !(f.t === 'hatch' && f.o)) || this._get(1, i, j, l, 0) !== undefined;
  }
  // Box in a cell's local frame: u in [u0,u1] along (dx,dz) from the centre, |w| <= half across.
  _cellBox(arr, n, cx, cz, dx, dz, u0, u1, half, y0, y1) {
    const k = n * 6;
    if (dx) { const a = cx + dx * u0, b = cx + dx * u1; arr[k] = Math.min(a, b); arr[k + 3] = Math.max(a, b); arr[k + 2] = cz - half; arr[k + 5] = cz + half; }
    else { const a = cz + dz * u0, b = cz + dz * u1; arr[k + 2] = Math.min(a, b); arr[k + 5] = Math.max(a, b); arr[k] = cx - half; arr[k + 3] = cx + half; }
    arr[k + 1] = y0; arr[k + 4] = y1;
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

  // Distance along a unit ray to the nearest piece box within reach, or Infinity (free placement: a wall, stairs or
  // the floor of a storey hides the deck behind it, so no item is placed through it).
  hitDist(ox, oy, oz, dx, dy, dz, deckY, reach) {
    this._rebuild();
    let best = Infinity;
    for (let n = 0; n < this._pickN; n++) {
      const t = rayBox(ox, oy, oz, dx, dy, dz, this._pick, n * 6, deckY);
      if (t >= 0 && t < best) best = t;
    }
    return best <= reach ? best : Infinity;
  }

  aim(ox, oy, oz, dx, dy, dz, type, rot, deckY, reach, out = this._aimOut) {
    const s = SLOT_OF[type];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
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
  // Walkable surfaces near (x,z). With best = -Infinity: returns the usable surface (step-up STEP_UP;
  // _deck = a tile is in reach). Otherwise: fills _cells with every nearby cell holding a surface
  // within DROP below `best` and returns their count, so physics keeps support while crossing from one raised
  // cell to the next (floor -> stairs, stairs -> stairs) instead of dropping off the single chosen cell.
  _scan(x, z, feet, deckY, best) {
    const collect = best > -Infinity, limit = feet + STEP_UP, ext = 1 + MARGIN;
    const lo = best > feet + 0.04 ? best - 1e-9 : best - DROP; // stepping up: only the target cell(s)
    const ci = Math.round(x / 2), cj = Math.round(z / 2);
    let top = -Infinity, topIn = -Infinity, n = 0;
    for (let i = ci - 1; i <= ci + 1; i++) {
      const ux = x - 2 * i;
      if (ux > ext || ux < -ext) continue;
      for (let j = cj - 1; j <= cj + 1; j++) {
        const uz = z - 2 * j;
        if (uz > ext || uz < -ext) continue;
        const tile = this._tile(i, j);
        const under = ux <= 1 && ux >= -1 && uz <= 1 && uz >= -1; // the cell under the body centre
        if (tile && !collect) { this._deck = true; if (under && deckY <= limit && deckY > topIn) topIn = deckY; }
        let keep = collect && tile && deckY >= lo && deckY <= limit;
        for (let l = 0; l <= MAX_L && !keep; l++) {
          const y = deckY + l * LEVEL_H;
          if (y > limit) break;
          for (let s = 0; s < 2; s++) {
            const p = this._get(s, i, j, l, 0);
            if (!p) continue;
            let h = y;
            if (p.t === 'hatch') { if (p.o) continue; } // closed: flat like a floor; open: a hole
            else if (p.t === 'ladder') { // only the top of the climbing strip is a ledge (landing height)
              if (!this._inStrip(p, x, z) || feet < y + LEVEL_H - 0.04) continue;
              h = y + LEVEL_H;
            } else if (p.t !== 'floor') {
              const u = clamp((ux * DIR[p.r][0] + uz * DIR[p.r][1] + 1) / 2, 0, 1);
              h += u * (p.t === 'stairs' ? LEVEL_H : ROOF_RISE);
            }
            // Stepping up needs the centre inside the cell (physics only lifts a body inside a footprint);
            // a grounded body is snapped anyway, so its centre may be anywhere over the cell.
            if (!(h <= feet + 0.04 || (h <= limit && (inside(ux) && inside(uz) || (under && this._grounded))))) continue;
            if (collect) { if (h >= lo && h <= best + 1e-9) { keep = true; break; } } else { if (h > top) top = h; if (under && h > topIn) topIn = h; }
          }
        }
        if (keep) { const c = this._cells[n++]; c[0] = i; c[1] = j; }
      }
    }
    // Prefer the surface under the centre over a ledge-margin one when it is within DROP (no snap when
    // stepping from a floor down onto stairs); keep the margin surface over a real drop (ledge catch).
    return collect ? n : topIn > -Infinity && top - topIn <= DROP ? topIn : top;
  }

  // Highest walkable surface under the feet, fed to PlayerPhysics.update as {deckY, tiles}.
  // climbing: the result of climb() this frame (undefined = not climbing); while attached the body is held
  // at the ladder height as a grounded body over the ladder cell.
  preStep(phys, deckY, climbing) {
    const feet = phys.y - EYE;
    this._prevHead = phys.y + HEAD; this._px = phys.x; this._pz = phys.z; this._pvy = phys.vy;
    this._climbing = false;
    const cl = this._cl;
    if (cl && climbing !== undefined && cl.phys === phys) {
      const ground = deckY + cl.rec.l * LEVEL_H + cl.h, pre = this._pre, t = this._clTile;
      t[0] = cl.rec.i; t[1] = cl.rec.j; this._clTiles[0] = t;
      pre.deckY = ground; pre.tiles = this._clTiles;
      phys.grounded = true; phys.vy = 0; phys.y = ground + EYE;
      this._climbing = true;
      return pre;
    }
    this._deck = false; this._grounded = phys.grounded;
    const best = this._scan(phys.x, phys.z, feet, deckY, -Infinity);
    const pre = this._pre;
    const deckH = this._deck && deckY <= feet + STEP_UP ? deckY : -Infinity;
    let ground;
    if (best > deckH + 1e-6) {
      const n = this._scan(phys.x, phys.z, feet, deckY, best), list = this._lists[n];
      for (let k = 0; k < n; k++) list[k] = this._cells[k];
      pre.deckY = ground = best; pre.tiles = list;
    } else {
      pre.deckY = deckY; pre.tiles = this._tileArr; ground = deckY;
    }
    // Walked off a ledge: fall instead of snapping down. Stepping up (stairs a frame behind, raft rising): lift
    // now, so physics never sees grounded feet below its deck (its hull push-out would shove us off the cell).
    if (phys.grounded && feet - ground > DROP) phys.grounded = false;
    else if (phys.grounded && ground > feet) phys.y = ground + EYE;
    return pre;
  }

  // Push the body circle out of the XZ box [x0,x1]x[z0,z1] and remove velocity into it.
  _push(phys, x0, x1, z0, z1) {
    const R = BODY_R, x = phys.x, z = phys.z;
    if (x < x0 - R || x > x1 + R || z < z0 - R || z > z1 + R) return;
    const px = clamp(x, x0, x1), pz = clamp(z, z0, z1);
    let nx = x - px, nz = z - pz;
    const d = Math.sqrt(nx * nx + nz * nz);
    if (d >= R) return;
    if (d > 1e-6) {
      nx /= d; nz /= d;
      phys.x = px + nx * R; phys.z = pz + nz * R;
    } else { // centre inside the box: leave by the shallowest side
      const l = x - x0, r = x1 - x, f = z - z0, bk = z1 - z, m = Math.min(l, r, f, bk);
      nx = m === l ? -1 : m === r ? 1 : 0; nz = nx ? 0 : m === f ? -1 : 1;
      if (nx) phys.x = nx < 0 ? x0 - R : x1 + R; else phys.z = nz < 0 ? z0 - R : z1 + R;
    }
    const vn = phys.vx * nx + phys.vz * nz;
    if (vn < 0) { phys.vx -= vn * nx; phys.vz -= vn * nz; }
  }

  // Stairs / roof undersides: the part of a ramp that is too high to step onto but below the head is solid
  // (a band across the cell), so you cannot walk into stairs from the side/back and pop up onto them.
  _ramps(phys, deckY) {
    const R = BODY_R, x = phys.x, z = phys.z, feet = phys.y - EYE, head = phys.y + HEAD;
    const ci = Math.round(x / 2), cj = Math.round(z / 2), L = Math.floor((feet - deckY) / LEVEL_H);
    for (let i = ci - 1; i <= ci + 1; i++) {
      if (Math.abs(x - 2 * i) > 1 + R) continue;
      for (let j = cj - 1; j <= cj + 1; j++) {
        if (Math.abs(z - 2 * j) > 1 + R) continue;
        for (let l = Math.max(0, L - 1); l <= L + 1 && l <= MAX_L; l++) {
          const base = deckY + l * LEVEL_H;
          if (feet < base - 0.5) continue; // a storey above: its slab is a ceiling, not a wall
          for (let s = 0; s < 2; s++) {
            const p = this._get(s, i, j, l, 0);
            if (!p || p.t === 'floor' || p.t === 'hatch' || p.t === 'ladder') continue;
            const rise = s === 1 ? LEVEL_H : ROOF_RISE;
            const u1 = Math.max(0, (feet + STEP_UP - base) / rise), u2 = Math.min(1, (head - base) / rise);
            if (u1 >= u2) continue;
            const dx = DIR[p.r][0], dz = DIR[p.r][1], a0 = 2 * u1 - 1, a1 = 2 * u2 - 1;
            if (dx) this._push(phys, 2 * i + (dx > 0 ? a0 : -a1), 2 * i + (dx > 0 ? a1 : -a0), 2 * j - 1, 2 * j + 1);
            else this._push(phys, 2 * i - 1, 2 * i + 1, 2 * j + (dz > 0 ? a0 : -a1), 2 * j + (dz > 0 ? a1 : -a0));
          }
        }
      }
    }
  }

  // Auto clamber (PlayerPhysics._climb) through a wall standing on the deck is refused (after first retrying
  // towards the tile centre). The physics zeroes the swimmer's velocity when a climb
  // starts, so the refusal waits one frame (the climb's clock then holds dt) and undoes it, swim speed included.
  _clamber(phys, deckY) {
    const c = phys._climb;
    if (!c) return;
    if (c === this._refused) {
      if (!(c.t > 0)) return;
      phys.vx = (c.sx - this._rx) / c.t; phys.vz = (c.sz - this._rz) / c.t; phys.vy = this._rvy;
      phys.x = c.sx + phys.vx * c.t; phys.y = c.sy; phys.z = c.sz + phys.vz * c.t; // the frame the climb took
      phys._climb = null; phys.climbing = false; phys.swimming = true; phys.grounded = false;
      this._refused = null;
      return;
    }
    if (c.t !== 0 || !this._pathHit(c.sx, c.sz, c.tx, c.tz, deckY)) return;
    const tx = Math.round(c.tx / 2) * 2, tz = Math.round(c.tz / 2) * 2;
    if (!this._pathHit(c.sx, c.sz, tx, tz, deckY)) { c.tx = tx; c.tz = tz; return; }
    this._refused = c; this._rx = this._px; this._rz = this._pz; this._rvy = this._pvy;
  }
  _pathHit(sx, sz, tx, tz, deckY) {
    const R = BODY_R, b = this._solid, lo = deckY + 0.05, hi = deckY + EYE + HEAD + 0.12;
    for (let k = 0; k < this._solidN * 6; k += 6) {
      if (b[k + 4] + deckY <= lo || b[k + 1] + deckY >= hi) continue;
      if (b[k + 3] - b[k] < 0.3 && b[k + 5] - b[k + 2] < 0.3) continue; // pillars: brush past (pushed out later)
      TT[0] = 0; TT[1] = 1;
      if (slab(sx, tx - sx, b[k] - R, b[k + 3] + R) && slab(sz, tz - sz, b[k + 2] - R, b[k + 5] + R)) return true;
    }
    return false;
  }

  // Push the body circle out of boxes b[0..6n) whose top is above `lo`; boxes that were above the head before
  // this step (slab bottoms, door lintels, walls upstairs) bonk the head of an airborne body instead.
  _solids(phys, deckY, b, count, lo) {
    const R = BODY_R;
    for (let k = 0; k < count * 6; k += 6) {
      const x = phys.x, z = phys.z;
      if (x < b[k] - R || x > b[k + 3] + R || z < b[k + 2] - R || z > b[k + 5] + R) continue;
      const y0 = b[k + 1] + deckY;
      if (y0 >= phys.y + HEAD) continue;
      // Ceiling first, before the `lo` filter: one long rising frame can carry the feet to within the step-up of
      // a slab top (or past it), and the slab must still stop the head instead of being stepped through.
      if (!phys.grounded && y0 >= this._prevHead - 0.02) {
        const px = clamp(x, b[k], b[k + 3]) - x, pz = clamp(z, b[k + 2], b[k + 5]) - z;
        if (px * px + pz * pz < R * R) { phys.y = y0 - HEAD; if (phys.vy > 0) phys.vy = 0; }
        continue;
      }
      if (b[k + 4] + deckY <= lo) continue;
      this._push(phys, b[k], b[k + 3], b[k + 2], b[k + 5]);
    }
  }

  // A long frame (lag spike: several physics substeps before one postStep) can carry the body more than its
  // radius in one go, so the push-out below could pop it through a thin rail or wall to the far side. Sweep the
  // frame's XZ move against the solids it vertically meets and stop just before the first one it enters.
  // The move stops at the face it hits and keeps sliding along it (a body already touching a wall from the last
  // push-out keeps its tangential motion; it is not frozen in place).
  _sweep(phys, deckY) {
    let sx = this._px, sz = this._pz, dx = phys.x - sx, dz = phys.z - sz;
    if (!(dx * dx + dz * dz > 0.04) || !Number.isFinite(dx + dz)) return;
    const R = BODY_R, b = this._solid, feet = phys.y - EYE, lo = phys.grounded ? feet + STEP_UP : feet + 0.05, hi = phys.y + HEAD;
    for (let it = 0; it < 2; it++) {
      let best = 1, ax = -1;
      for (let k = 0; k < this._solidN * 6; k += 6) {
        if (b[k + 4] + deckY <= lo || b[k + 1] + deckY >= hi) continue;
        const x0 = b[k] - R, x1 = b[k + 3] + R, z0 = b[k + 2] - R, z1 = b[k + 5] + R;
        let ex, lx, ez, lz;
        if (dx > -1e-9 && dx < 1e-9) { if (sx <= x0 || sx >= x1) continue; ex = -Infinity; lx = Infinity; }
        else { const a = (x0 - sx) / dx, c = (x1 - sx) / dx; ex = a < c ? a : c; lx = a < c ? c : a; }
        if (dz > -1e-9 && dz < 1e-9) { if (sz <= z0 || sz >= z1) continue; ez = -Infinity; lz = Infinity; }
        else { const a = (z0 - sz) / dz, c = (z1 - sz) / dz; ez = a < c ? a : c; lz = a < c ? c : a; }
        const enter = ex > ez ? ex : ez, exit = lx < lz ? lx : lz;
        if (enter < -1e-6 || enter >= exit || enter >= best) continue; // started inside (push-out handles it), miss, or later
        best = enter < 0 ? 0 : enter; ax = ex > ez ? 0 : 1; // the axis entered last is the face hit
      }
      if (ax < 0) return;
      const len = Math.sqrt(dx * dx + dz * dz), t = Math.max(0, best - 0.01 / len), rest = 1 - t;
      sx += dx * t; sz += dz * t; // just before the face
      if (ax === 0) { if (phys.vx * dx > 0) phys.vx = 0; dx = 0; dz *= rest; } // x face: keep the z slide
      else { if (phys.vz * dz > 0) phys.vz = 0; dz = 0; dx *= rest; }
      phys.x = sx + dx; phys.z = sz + dz;
      if (!(dx * dx + dz * dz > 1e-8)) return; // the slide itself is checked once more (inside corners)
    }
    phys.x = sx; phys.z = sz; // a second face: stop at it
  }

  // Push the body circle out of walls, slab edges and ramp undersides; keep the head under ceilings.
  postStep(phys, deckY) {
    this._rebuild();
    this._sweep(phys, deckY);
    for (let pass = 0; pass < 2; pass++) {
      const feet = phys.y - EYE;
      // Grounded bodies step over box tops within STEP_UP (e.g. a wall under the top edge of stairs);
      // thin slab edges can always be stepped onto.
      this._solids(phys, deckY, this._slabs, this._slabN, feet + STEP_UP);
      this._solids(phys, deckY, this._solid, this._solidN, phys.grounded ? feet + STEP_UP : feet + 0.05);
      this._ramps(phys, deckY);
    }
    this._clamber(phys, deckY);
    if (this._climbing) this._pin(phys);
  }

  // ---------- ladders ----------
  // Body centre inside a ladder's climbing strip: u in [0.35, 1] along DIR[r] from the cell centre, |w| <= 0.6.
  _inStrip(p, x, z) {
    const dx = DIR[p.r][0], dz = DIR[p.r][1], ox = x - 2 * p.i, oz = z - 2 * p.j;
    const u = ox * dx + oz * dz, w = ox * dz - oz * dx;
    return u >= 0.35 && u <= 1.0 && w <= 0.6 && w >= -0.6;
  }

  // A ladder whose strip holds the body with the feet between just below its foot and its top, or null.
  ladderAt(x, z, feet, deckY) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(feet)) return null;
    const ci = Math.round(x / 2), cj = Math.round(z / 2), L = Math.floor((feet - deckY + 0.3) / LEVEL_H);
    for (let l = L; l >= L - 1; l--) {
      if (l < 0 || l > MAX_L) continue;
      const base = deckY + l * LEVEL_H;
      if (feet < base - 0.3 || feet > base + LEVEL_H + 0.05) continue;
      for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
        const p = this._get(1, i, j, l, 0);
        if (p && p.t === 'ladder' && this._inStrip(p, x, z)) return p;
      }
    }
    return null;
  }

  // Climb height limit: a closed hatch right above stops the head just under its slab.
  _capH(rec) {
    const a = this._get(0, rec.i, rec.j, rec.l + 1, 0);
    return a && !(a.t === 'hatch' && a.o) ? LEVEL_H - FLOOR_THICK - EYE - HEAD - 0.02 : LEVEL_H;
  }

  _release(feel) { if (feel && this._cl) feel.setLadder(null); this._cl = null; }

  // Ladder climbing with MoveFeel (feel injected: pure). inp = {forward, jump, yaw}. Returns this frame's climb dy
  // or undefined when not climbing; pass the result to preStep as its 3rd argument.
  climb(feel, phys, deckY, inp, dt) {
    const fw = inp && Number.isFinite(inp.forward) ? inp.forward : 0, jump = !!(inp && inp.jump);
    let cl = this._cl;
    if (!feel || !phys) { this._cl = null; return undefined; }
    if (cl) {
      // A reload (guest snapshot after any piece change, a toggle of the hatch above) makes new record objects:
      // follow the ladder still standing in the same slot instead of dropping the climber.
      const cur = this.find(cl.rec);
      if (cur && cur !== cl.rec && cur.t === 'ladder' && cur.r === cl.rec.r) cl.rec = cur;
      const rec = cl.rec;
      if (cur !== rec || phys !== cl.phys || phys.swimming || !feel.isOnLadder() || !this._inStrip(rec, phys.x, phys.z)) { this._release(feel); return undefined; }
      const cap = this._capH(rec);
      if (cap !== cl.cap) { // the hatch above was opened / closed mid-climb: new top for MoveFeel
        cl.cap = cap; cl.h = clamp(cl.h, 0, cap);
        const d = DIR[rec.r];
        feel.setLadder({bottomY: 0, topY: cap, x: 2 * rec.i + d[0] * LAD_IN, z: 2 * rec.j + d[1] * LAD_IN, normal: [-d[0], -d[1]]});
      }
      // A long frame (low fps) climbs in <= 0.1 s pieces (MoveFeel clamps dt), so the speed holds; capped at 0.25 s.
      let rem = dt > 0 ? Math.min(dt, 0.25) : 0, dy = 0;
      cl.dt = rem;
      do {
        const st = Math.min(rem, 0.1);
        const li = this._lin; li.forward = fw; li.jump = jump; li.y = cl.h;
        const r = feel.ladderInput(st, li);
        if (r.detach) {
          this._cl = null;
          phys.vx += r.pushX; phys.vz += r.pushZ; phys.vy = r.vy; phys.grounded = false;
          return undefined;
        }
        if (r.atBottom && fw < 0) { this._release(feel); return undefined; }
        const d = r.vy * st, h = clamp(cl.h + d, 0, cl.cap);
        dy += h - cl.h; cl.h = h; rem -= st;
      } while (rem > 1e-9);
      return dy;
    }
    if (phys.swimming || !(fw > 0 || fw < 0)) return undefined;
    const feet = phys.y - EYE, rec = this.ladderAt(phys.x, phys.z, feet, deckY);
    if (!rec) return undefined;
    const yaw = inp && Number.isFinite(inp.yaw) ? inp.yaw : 0, d = DIR[rec.r];
    if (-Math.sin(yaw) * d[0] - Math.cos(yaw) * d[1] < 0.5) return undefined;
    const base = deckY + rec.l * LEVEL_H, cap = this._capH(rec);
    if (fw < 0 && Math.abs(feet - (base + LEVEL_H)) > 0.04) return undefined;
    if (fw > 0 && feet > base + cap - 0.04) return undefined; // at (or above) the top: walking forward steps off
    const x = 2 * rec.i + d[0] * LAD_IN, z = 2 * rec.j + d[1] * LAD_IN;
    if (!feel.setLadder({bottomY: 0, topY: cap, x, z, normal: [-d[0], -d[1]]})) return undefined;
    this._cl = cl = {rec, phys, h: clamp(feet - base, 0, cap), cap, dt: 0};
    return 0;
  }

  // While climbing below the top, hold the body at the pin distance in front of the ladder (strafing stays free).
  _pin(phys) {
    const cl = this._cl; if (!cl) return;
    if (cl.h >= LEVEL_H - 0.04) return; // at the top: free to walk onto the landing
    const p = cl.rec, dx = DIR[p.r][0], dz = DIR[p.r][1], ox = phys.x - 2 * p.i, oz = phys.z - 2 * p.j;
    const u = ox * dx + oz * dz, step = 2.5 * cl.dt, du = clamp(LAD_PIN - u, -step, step); // eased in (getting on from the top)
    if (du > 1e-9 || du < -1e-9) { phys.x += dx * du; phys.z += dz * du; }
    const vu = phys.vx * dx + phys.vz * dz; phys.vx -= vu * dx; phys.vz -= vu * dz;
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
