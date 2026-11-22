// Raft-style building rules plus the translucent ghost preview.
// Foundations snap to the 2 m grid next to existing tiles; decorations sit at the exact aimed
// point (raft-local metres, any rotation) as long as they rest on the deck and do not overlap.
// Pure logic needs no THREE, so tests can import it directly. hasTile(tx, tz) takes grid cells.

export const TILE = 2;
export const ROT_STEP = Math.PI / 12, FINE_STEP = Math.PI / 36; // R turns decor 15 degrees, Shift+R / Shift+wheel 5
export const DECOR_REACH = 6, FLOOR_REACH = 8;
// [half width, half depth, share of the footprint that must rest on deck (0 = centre only)].
// Matches each model's below-head bounds; crate, sail and lantern also collide with this rect.
export const FOOTPRINT = Object.freeze({
  sail:[.8, .76, .8], palm:[.42, .42, .8], lantern:[.59, .37, .8], net:[.84, .84, 0], bench:[.72, .2, .8], crate:[.49, .42, .8],
  fishtrap:[.4, .4, 0], // free placement: the deck part only; its basket hangs over the open water beside the tile
});

// Wheel travel in pixels for slot picking and fine rotation. Chromium (and macOS) turn Shift+wheel
// into a horizontal scroll (deltaY 0, deltaX set), so with Shift held deltaX counts too.
export function wheelDelta(e) {
  const d = e.deltaY || (e.shiftKey ? e.deltaX : 0) || 0;
  return e.deltaMode === 1 ? d * 33 : d;
}

const TAU = Math.PI * 2;
export const tileAt = v => Math.round(v / TILE);
export const wrapRot = r => ((r % TAU) + TAU) % TAU;
const round3 = v => Math.round(v * 1000) / 1000;
const ADJ = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const adjacent = (hasTile, x, z) => ADJ.some(([a, b]) => hasTile(x + a, z + b));

// Grid cell for a new foundation aimed at raft-local (x, z). Aiming near the edge of an existing
// tile picks the free neighbour across that edge, like Raft. Returns {x, z} cells or null.
export function floorTarget(hasTile, x, z) {
  let tx = tileAt(x), tz = tileAt(z);
  if (hasTile(tx, tz)) {
    const dx = x - tx * TILE, dz = z - tz * TILE;
    if (Math.max(Math.abs(dx), Math.abs(dz)) < .45) return null;
    if (Math.abs(dx) > Math.abs(dz)) tx += Math.sign(dx); else tz += Math.sign(dz);
    if (hasTile(tx, tz)) return null;
  }
  return adjacent(hasTile, tx, tz) ? {x:tx, z:tz} : null;
}

// Rotated footprint axes: three.js rotation.y = rot maps local x to (cos, -sin) and local z to (sin, cos).
function extent(type, rot, ax, az) {
  const f = FOOTPRINT[type], c = Math.cos(rot), s = Math.sin(rot);
  return f[0] * Math.abs(c * ax - s * az) + f[1] * Math.abs(s * ax + c * az);
}
function overlaps(a, b) { // 2D separating-axis test of two rotated rectangles
  for (let i = 0; i < 4; i++) {
    const r = (i < 2 ? a.rot : b.rot) + (i & 1) * Math.PI / 2, ax = Math.cos(r), az = -Math.sin(r);
    if (Math.abs((a.x - b.x) * ax + (a.z - b.z) * az) >= extent(a.type, a.rot, ax, az) + extent(b.type, b.rot, ax, az) - .02) return false;
  }
  return true;
}

// 'ok' | 'air' (centre or too much of it off the deck) | 'blocked' (overlaps other decor).
export function decorCheck(hasTile, decor, d) {
  const f = FOOTPRINT[d.type]; if (!f) return 'air';
  if (!hasTile(tileAt(d.x), tileAt(d.z))) return 'air';
  if (f[2] > 0) {
    const c = Math.cos(d.rot), s = Math.sin(d.rot), hx = f[0] * f[2], hz = f[1] * f[2];
    for (let k = 0; k < 4; k++) {
      const u = k & 1 ? hx : -hx, w = k & 2 ? hz : -hz;
      if (!hasTile(tileAt(d.x + c * u + s * w), tileAt(d.z - s * u + c * w))) return 'air';
    }
  }
  for (const o of decor) if (o !== d && FOOTPRINT[o.type] && overlaps(d, o)) return 'blocked';
  return 'ok';
}

// ---------- Removal (hammer + X) ----------
// Height of each piece's pick box above its base, in metres (roughly the model's solid part).
export const PICK_HEIGHT = Object.freeze({sail:1.9, palm:.6, lantern:1.9, net:.25, bench:.55, crate:.85});
const DECOR_BASE_Y = .22;

// Nearest decor whose footprint box (rotated, PICK_HEIGHT tall) the raft-local ray o + t*d crosses
// within maxT metres, or null. o and d are {x, y, z}.
export function decorOnRay(decor, o, d, maxT = DECOR_REACH + 2) {
  let best = null, bestT = maxT;
  for (const p of decor) {
    const f = FOOTPRINT[p.type]; if (!f) continue;
    const c = Math.cos(p.rot || 0), s = Math.sin(p.rot || 0), ox = o.x - p.x, oz = o.z - p.z;
    const lo = [ox * c - oz * s, o.y - DECOR_BASE_Y, ox * s + oz * c], ld = [d.x * c - d.z * s, d.y, d.x * s + d.z * c];
    const hi = [f[0], PICK_HEIGHT[p.type] ?? 1, f[1]], low = [-f[0], 0, -f[1]];
    let t0 = 0, t1 = bestT;
    for (let i = 0; i < 3 && t0 <= t1; i++) {
      if (Math.abs(ld[i]) < 1e-9) { if (lo[i] < low[i] || lo[i] > hi[i]) t0 = Infinity; continue; }
      let a = (low[i] - lo[i]) / ld[i], b = (hi[i] - lo[i]) / ld[i]; if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    if (t0 <= t1 && t0 < bestT) { bestT = t0; best = p; }
  }
  return best;
}

// Why floor cell (tx, tz) can't be removed: 'missing' | 'last' (the raft's only tile) | 'decor'
// (something stands on it) | 'split' (the raft would break in two), or null when it can.
export function floorRemoveBlock(tiles, decor, tx, tz) {
  const key = (x, z) => x + ',' + z, all = new Set(tiles.map(t => key(t[0], t[1])));
  if (!all.has(key(tx, tz))) return 'missing';
  if (all.size <= 1) return 'last';
  const rest = new Set(all); rest.delete(key(tx, tz));
  const now = (x, z) => all.has(key(x, z)), after = (x, z) => rest.has(key(x, z));
  for (const d of decor) {
    if (tileAt(d.x) === tx && tileAt(d.z) === tz) return 'decor';
    if (decorCheck(now, [], d) === 'ok' && decorCheck(after, [], d) !== 'ok') return 'decor'; // its footprint rests partly on this tile
  }
  const start = rest.values().next().value, seen = new Set([start]), queue = [start];
  while (queue.length) {
    const [x, z] = queue.pop().split(',').map(Number);
    for (const [a, b] of ADJ) { const k = key(x + a, z + b); if (rest.has(k) && !seen.has(k)) { seen.add(k); queue.push(k); } }
  }
  return seen.size === rest.size ? null : 'split';
}

// About half of a build cost back (at least one of each ingredient).
export const refundOf = cost => Object.fromEntries(Object.entries(cost || {}).map(([k, n]) => [k, Math.max(1, Math.floor(n / 2))]));

// Validates one saved decor entry. Current entries carry rot and raft-local metres; older saves
// stored integer tile cells with no rot and are moved to that tile's centre.
export function normaliseDecor(d, types, hasTile) {
  if (!d || !types.includes(d.type)) return null;
  let x = d.x, z = d.z, rot = d.rot;
  if (!Number.isFinite(rot)) {
    if (!Number.isInteger(x) || !Number.isInteger(z)) return null;
    x *= TILE; z *= TILE; rot = 0;
  }
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 52 || Math.abs(z) > 52 || !hasTile(tileAt(x), tileAt(z))) return null;
  return {type:d.type, x:round3(x), z:round3(z), rot:round3(wrapRot(rot))};
}

// Ghost preview: real models (one cached copy per kind) drawn in one shared see-through
// material that turns red when the spot is invalid. Follows the raft's sway.
export function createGhosts(T, scene, raft, {floor, craft}) {
  const OK = new T.Color('#4dff8f'), BAD = new T.Color('#ff4a3a');
  const mat = new T.MeshLambertMaterial({color:OK, emissive:OK.clone(), emissiveIntensity:.55, transparent:true, opacity:.5, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1});
  const floorMat = mat.clone(); floorMat.emissiveIntensity = 1.3; // over the sea a 50% mint floor reads as shallow water: brighter, more solid
  const depth = new T.MeshBasicMaterial({colorWrite:false, transparent:true, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1}); // offset: a ghost over a coincident placed piece wins cleanly instead of z-fighting // depth pre-pass after the opaque scene: only the ghost's front surface is tinted
  const root = new T.Group(); root.name = 'build-ghost'; scene.add(root);
  const cache = new Map();
  let shown = null, wasOk = true;
  function model(kind) {
    if (cache.has(kind)) return cache.get(kind);
    const m0 = kind === 'floor' ? floorMat : mat;
    const g = kind === 'floor' ? floor(() => floorMat) : craft(kind);
    if (g) {
      const meshes = [];
      g.traverse(o => { if (o.isMesh) meshes.push(o); });
      for (const o of meshes) {
        for (const m of [].concat(o.material)) if (m !== m0 && !m.userData.shared) m.dispose(); // shared: still drawn on the raft
        o.material = m0; o.castShadow = false; o.receiveShadow = false; o.renderOrder = 6;
        const pre = new T.Mesh(o.geometry, depth); pre.renderOrder = 5; o.add(pre);
      }
      g.visible = false; root.add(g);
    }
    cache.set(kind, g);
    return g;
  }
  function hide() { if (shown) shown.visible = false; shown = null; }
  function show(kind, x, y, z, rot, ok, time) {
    const g = model(kind); if (!g) { hide(); return; }
    if (shown !== g) { hide(); shown = g; g.visible = true; }
    root.position.copy(raft.position); root.quaternion.copy(raft.quaternion);
    g.position.set(x, y, z); g.rotation.y = rot;
    if (ok !== wasOk) { wasOk = ok; for (const m of [mat, floorMat]) { m.color.copy(ok ? OK : BAD); m.emissive.copy(ok ? OK : BAD); } }
    const pulse = Math.sin(time * 4) * .06;
    mat.opacity = .5 + pulse; floorMat.opacity = .76 + pulse;
  }
  // Builds ghosts ahead (e.g. for every placeable in the bag) so the first preview does no mesh work.
  function preload(kinds) { for (const k of kinds) model(k); }
  // Runs fn (a shader compile) with every built ghost visible: three's compile skips hidden objects.
  function warm(fn) {
    const hidden = [...cache.values()].filter(g => g && !g.visible);
    for (const g of hidden) g.visible = true;
    try { fn(); } finally { for (const g of hidden) g.visible = false; }
  }
  return {show, hide, preload, warm, model, get visible() { return !!shown; }}; // model(kind): the cached plain ghost (footprint measuring)
}

// ---------- Free placement (every placeable that is not a structural piece) ----------
// Decor entries keep x, z in tile units (raft-local metres / 2) and rot in radians (three.js rotation.y). Since
// free placement they may be fractional; older saves hold integer cells, which are exactly the tile centres, so
// they load where they always were. Structural pieces (floors, walls, pillars, stairs, roofs) stay on the grid.
export const PLACE_EPS = .004; // metres two footprints may overlap: flush neighbours (0 gap) pass after rounding
export const SNAP_GAP = .06;   // edge snap: a gap to a parallel neighbour or wall below this closes to 0
const DECK_SLACK = .03, MIN_HALF = .08, MAX_HALF = 1.4, WALL_HALF = .07, PILLAR_HALF = .11, GRILL_HALF = .45;
const EDGE_T = new Set(['wall', 'halfwall', 'window', 'door', 'railing', 'gate']), CELL_T = new Set(['stairs', 'ladder', 'hatch', 'floor', 'roof']);
// Placeables whose systems live on tile cells (animal homes and walk graph) still sit on a tile centre.
// Fish traps too: the basket hangs off the edge of the tile they sit on.
export const GRID_DECOR = Object.freeze(['nestbox', 'goatpen', 'fishtrap']);
// Flat decor (rugs) lies under everything: it needs deck, but other items may stand on it.
const FLAT = new Set(['rug']);
export const roundCoord = v => Math.round(v * 1000) / 1000 || 0; // tile units (2 mm), never -0
const measured = new Map(), fromRadius = new Map(); // fromRadius: cached squares, so the per-frame checks allocate nothing

// Footprint half sizes [hw, hd] in metres for a decor type: the table above, else a size measured from its
// model (setFootprint / measureFootprint), else a square from the player collision radius, else .3.
export function footprintOf(type, radii) {
  const f = FOOTPRINT[type] ?? measured.get(type); if (f) return f;
  const r = radii?.[type];
  if (Array.isArray(r)) return r;
  const h = Number.isFinite(r) && r > 0 ? Math.max(MIN_HALF, r) : .3;
  let sq = fromRadius.get(h); if (!sq) fromRadius.set(h, sq = Object.freeze([h, h]));
  return sq;
}
export function setFootprint(type, hw, hd) {
  const c = v => Math.round(Math.min(MAX_HALF, Math.max(MIN_HALF, v)) * 100) / 100;
  if (!FOOTPRINT[type]) measured.set(type, Object.freeze([c(hw), c(hd)]));
}
export const hasFootprint = type => !!FOOTPRINT[type] || measured.has(type);
// Measures a model (any object with traverse and THREE-style geometry) below head height (1.8 m), around its origin.
export function measureFootprint(T, type, model) {
  if (!model || hasFootprint(type)) return footprintOf(type);
  model.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(model.matrixWorld).invert(), m = new T.Matrix4(), v = new T.Vector3();
  let hx = 0, hz = 0, any = false;
  model.traverse(o => {
    const p = o.isMesh && o.geometry?.attributes?.position; if (!p) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m); if (v.y > 1.8) continue; any = true; hx = Math.max(hx, Math.abs(v.x)); hz = Math.max(hz, Math.abs(v.z)); }
  });
  if (any) setFootprint(type, hx, hz);
  return footprintOf(type);
}

// Oriented rectangle of a decor entry (x, z tile units) in metres. Writes into out (reused, no allocation).
export function decorRect(d, radii, out = {}) {
  const f = footprintOf(d.type, radii);
  out.x = d.x * TILE; out.z = d.z * TILE; out.rot = Number.isFinite(d.rot) ? d.rot : 0; out.hw = f[0]; out.hd = f[1];
  return out;
}
function rectExtent(r, ax, az) { const c = Math.cos(r.rot), s = Math.sin(r.rot); return r.hw * Math.abs(c * ax - s * az) + r.hd * Math.abs(s * ax + c * az); }
// Overlap depth of two oriented rectangles (> 0 means they intersect), separating-axis test on the 4 axes.
export function rectOverlap(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z, ra = Math.hypot(a.hw, a.hd), rb = Math.hypot(b.hw, b.hd);
  if (dx * dx + dz * dz >= (ra + rb) * (ra + rb)) return -1; // bounding circles apart: cheap reject
  let depth = Infinity;
  for (let i = 0; i < 4; i++) {
    const r = (i < 2 ? a.rot : b.rot) + (i & 1) * Math.PI / 2, ax = Math.cos(r), az = -Math.sin(r);
    const d = rectExtent(a, ax, az) + rectExtent(b, ax, az) - Math.abs(dx * ax + dz * az);
    if (d < depth) depth = d;
    if (depth <= 0) return depth;
  }
  return depth;
}

// Level-0 building pieces as rectangles (metres): edge pieces are thin walls along a cell side, pillars sit
// on a corner, cell pieces (stairs, ladder, hatch) fill their cell. Fills and returns out.
export function pieceRects(pieces, out = []) {
  out.length = 0;
  if (Array.isArray(pieces)) for (const p of pieces) {
    if (!p || p.l !== 0) continue;
    if (EDGE_T.has(p.t)) out.push(p.r ? {x:p.i * TILE - 1, z:p.j * TILE, rot:0, hw:WALL_HALF, hd:1 + PILLAR_HALF} : {x:p.i * TILE, z:p.j * TILE - 1, rot:0, hw:1 + PILLAR_HALF, hd:WALL_HALF});
    else if (p.t === 'pillar') out.push({x:p.i * TILE - 1, z:p.j * TILE - 1, rot:0, hw:PILLAR_HALF, hd:PILLAR_HALF});
    else if (CELL_T.has(p.t)) out.push({x:p.i * TILE, z:p.j * TILE, rot:0, hw:1, hd:1});
  }
  return out;
}
export const grillRect = (x, z) => ({x:x * TILE, z:z * TILE, rot:0, hw:GRILL_HALF, hd:GRILL_HALF});

const tmpA = {}, tmpB = {};
// Is every part of rect r over a raft tile? Samples corners, edge midpoints and the centre (tiles are 2 m and
// footprints at most 2.8 m long, so no missing tile can hide between two samples).
function onDeck(hasTile, r) {
  const c = Math.cos(r.rot), s = Math.sin(r.rot), hw = Math.max(0, r.hw - DECK_SLACK), hd = Math.max(0, r.hd - DECK_SLACK);
  for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) {
    const u = i * hw, w = k * hd, x = r.x + c * u + s * w, z = r.z - s * u + c * w;
    if (!hasTile(Math.round(x / TILE), Math.round(z / TILE))) return false;
  }
  return true;
}

// Why decor d ({type, x, z, rot}, tile units) can't stand there, or null when it can:
// 'nofloor' (part of it off the deck) | 'overlap' (overlaps other decor, a grill, a wall,
// a pillar or stairs). env: {hasTile(tx, tz), decor, pieceRects (from pieceRects), extra (more rects), radii}.
// Linear in the decor count with a bounding-circle reject first, so it is cheap enough to run every frame.
export function freeBlock(env, d) {
  if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.z)) return 'invalid';
  const r = decorRect(d, env.radii, tmpA);
  if (!onDeck(env.hasTile, r)) return 'nofloor';
  for (const o of env.pieceRects || []) if (rectOverlap(r, o) > PLACE_EPS) return 'overlap';
  for (const o of env.extra || []) if (rectOverlap(r, o) > PLACE_EPS) return 'overlap';
  if (FLAT.has(d.type)) return null;
  for (const o of env.decor || []) if (o !== d && o && !FLAT.has(o.type) && rectOverlap(r, decorRect(o, env.radii, tmpB)) > PLACE_EPS) return 'overlap';
  return null;
}

// Edge snap: slides d (in place) so that a small gap or overlap (under SNAP_GAP) with a parallel neighbour, wall or
// pillar becomes exactly 0, one axis at a time: aiming a few cm short of or into a crate puts the new one flush
// against it. Only axis-parallel pairs snap (rot equal mod 90 degrees); there is no grid.
const QUARTER = Math.PI / 2, SNAP0 = {gap:0, sign:0, ax:0, az:0}, SNAP1 = {gap:0, sign:0, ax:0, az:0};
let best0 = null, best1 = null; // per own axis: the smallest gap (scratch objects, no allocation per frame)
function snapConsider(r, o) {
  if (Math.abs(r.x - o.x) > r.hw + r.hd + o.hw + o.hd + SNAP_GAP || Math.abs(r.z - o.z) > r.hw + r.hd + o.hw + o.hd + SNAP_GAP) return;
  let q = (o.rot - r.rot) / QUARTER; q -= Math.round(q); if (Math.abs(q) > .01) return; // not parallel
  for (let i = 0; i < 2; i++) {
    const a = r.rot + i * QUARTER, ax = Math.cos(a), az = -Math.sin(a), bx = -az, bz = ax;
    const dx = o.x - r.x, dz = o.z - r.z, along = dx * ax + dz * az, side = dx * bx + dz * bz;
    const gap = Math.abs(along) - rectExtent(r, ax, az) - rectExtent(o, ax, az);
    if (gap === 0 || Math.abs(gap) >= SNAP_GAP) continue;
    if (Math.abs(side) >= rectExtent(r, bx, bz) + rectExtent(o, bx, bz) - .01) continue; // not facing each other
    const best = i ? best1 : best0;
    if (!best || Math.abs(gap) < Math.abs(best.gap)) { const v = i ? SNAP1 : SNAP0; v.gap = gap; v.sign = Math.sign(along) || 1; v.ax = ax; v.az = az; if (i) best1 = v; else best0 = v; }
  }
}
export function edgeSnap(env, d) {
  const r = decorRect(d, env.radii, tmpA);
  best0 = best1 = null;
  for (const o of env.pieceRects || []) snapConsider(r, o);
  for (const o of env.decor || []) if (o !== d && o && !FLAT.has(o.type)) snapConsider(r, decorRect(o, env.radii, tmpB));
  if (best0 && best1 && best0.gap < 0 && best1.gap < 0) { if (Math.abs(best0.gap) <= Math.abs(best1.gap)) best1 = null; else best0 = null; } // a corner overlap: push out along one axis only
  let x = r.x, z = r.z;
  if (best0) { x += best0.ax * best0.gap * best0.sign; z += best0.az * best0.gap * best0.sign; }
  if (best1) { x += best1.ax * best1.gap * best1.sign; z += best1.az * best1.gap * best1.sign; }
  d.x = roundCoord(x / TILE); d.z = roundCoord(z / TILE);
  return d;
}

// Validates one saved or received decor position: finite tile units within the world bound, rounded to 2 mm.
// Integer cells from old saves come back unchanged (the tile centre).
export function cleanDecorPos(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 26 || Math.abs(z) > 26) return null;
  return [roundCoord(x), roundCoord(z)];
}
// One saved / received decor entry -> {type, x, z, rot?} or null (game.js cleanWorld). types: allowed decor types;
// hasTile(tx, tz): its centre must stand on a raft tile; used: Set of "x,z" already taken (two entries never share
// an exact spot). Old saves (integer cells, maybe no rot) come back exactly as they were: the tile centre.
export function cleanDecor(d, types, hasTile, used) {
  const pos = d && types.includes(d.type) ? cleanDecorPos(d.x, d.z) : null; if (!pos) return null;
  const [x, z] = pos, k = x + ',' + z;
  if (!hasTile(Math.round(x), Math.round(z)) || used?.has(k)) return null;
  used?.add(k);
  const rot = Number.isFinite(d.rot) ? Math.round(wrapRot(d.rot) * 1000) / 1000 : 0;
  return rot ? {type:d.type, x, z, rot} : {type:d.type, x, z};
}
