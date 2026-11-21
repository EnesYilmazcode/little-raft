// Raft-style building rules plus the translucent ghost preview.
// Foundations snap to the 2 m grid next to existing tiles; decorations sit at the exact aimed
// point (raft-local metres, any rotation) as long as they rest on the deck and do not overlap.
// Pure logic needs no THREE, so tests can import it directly. hasTile(tx, tz) takes grid cells.

export const TILE = 2;
export const ROT_STEP = Math.PI / 4, FINE_STEP = Math.PI / 12;
export const DECOR_REACH = 6, FLOOR_REACH = 8;
// [half width, half depth, share of the footprint that must rest on deck (0 = centre only)].
// Matches each model's below-head bounds; crate, sail and lantern also collide with this rect.
export const FOOTPRINT = Object.freeze({
  sail:[.8, .76, .8], palm:[.42, .42, .8], lantern:[.59, .37, .8], net:[.84, .84, 0], bench:[.72, .2, .8], crate:[.49, .42, .8],
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
        for (const m of [].concat(o.material)) if (m !== m0) m.dispose();
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
  return {show, hide, preload, warm, get visible() { return !!shown; }};
}
