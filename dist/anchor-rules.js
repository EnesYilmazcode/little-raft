// Anchor as a crafted, placed item (Raft: the Throwable Anchor, 2 planks + 4 rope + 4 stone).
// Pure rules shared by game.js (build / hammer removal / save migration) and sailing-world.js (E toggles).
// No imports, no DOM, no THREE. world.decor entries are {type:'anchor', x, z, rot?} on raft tiles; the
// drop/raise state stays world.sailing.anchored (one flag for the whole raft).

export const ANCHOR = 'anchor';
export const ANCHOR_TEXT = Object.freeze({
  need: 'Build an anchor',
  rim: 'Place it at the raft edge',
  removed: 'Anchor removed',
  raised: 'Anchor raised',
  full: 'No room in your bag for the anchor',
  hammer: 'Hold a hammer to take the anchor up',
});
const N4 = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // +z first: matches the old anchor post at the far +z edge
const TAU = Math.PI * 2;
const isInt = Number.isInteger;

function hasTile(tiles, x, z) {
  for (let i = 0; i < tiles.length; i++) { const t = tiles[i]; if (t && t[0] === x && t[1] === z) return true; }
  return false;
}

/** True when tile (x,z) is on the raft and has at least one open side. No allocations. */
export function isEdgeTile(tiles, x, z) {
  if (!Array.isArray(tiles) || !isInt(x) || !isInt(z) || !hasTile(tiles, x, z)) return false;
  for (let i = 0; i < 4; i++) if (!hasTile(tiles, x + N4[i][0], z + N4[i][1])) return true;
  return false;
}

/** Number of anchors standing on the raft. No allocations. */
export function anchorCount(decor) {
  if (!Array.isArray(decor)) return 0;
  let n = 0;
  for (let i = 0; i < decor.length; i++) if (decor[i]?.type === ANCHOR) n++;
  return n;
}

/** Refusal text for a sail op that needs an anchor on the raft ('' when allowed). Raising always works. */
export function anchorBlock(decor, op, anchored) {
  const drops = op === 'anchor' || (op === 'toggleAnchor' && !anchored);
  return drops && anchorCount(decor) === 0 ? ANCHOR_TEXT.need : '';
}

/**
 * Rotation (radians, about +y) that points the anchor's arm (model +z) out over an open side of tile (x,z).
 * pref: the player's placement rotation; the open side nearest to it wins. 0 when no side is open.
 */
export function outwardRot(tiles, x, z, pref = 0) {
  if (!Array.isArray(tiles)) return 0;
  const p = Number.isFinite(pref) ? ((pref % TAU) + TAU) % TAU : 0;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < 4; i++) {
    const dx = N4[i][0], dz = N4[i][1];
    if (hasTile(tiles, x + dx, z + dz)) continue;
    const r = ((Math.atan2(dx, dz) % TAU) + TAU) % TAU; // model +z rotated by r points along (sin r, cos r)
    const d = Math.abs(Math.atan2(Math.sin(r - p), Math.cos(r - p)));
    if (d < bestD - 1e-9) { bestD = d; best = r; }
  }
  return Math.round(best * 1000) / 1000;
}

/**
 * Old saves: a raft that was anchored with the old free anchor post gets one anchor item placed at an edge so
 * nobody loses it. world = {tiles, decor, sailing, hostInventory?}; mutates it. Prefers the free edge tile the old
 * post stood on (largest z, then smallest x), then any free edge tile, then any free tile; with no free tile the
 * anchor goes into the host's saved bag (and the raft is raised). Returns 'placed' | 'bag' | null (nothing to do).
 */
export function migrateAnchor(world) {
  if (!world || typeof world !== 'object' || !world.sailing || world.sailing.anchored !== true) return null;
  const tiles = Array.isArray(world.tiles) ? world.tiles : [], decor = Array.isArray(world.decor) ? world.decor : (world.decor = []);
  if (anchorCount(decor) > 0) return null;
  const taken = (x, z) => decor.some(d => d && d.x === x && d.z === z);
  const order = tiles.filter(t => Array.isArray(t) && !taken(t[0], t[1])).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const spot = order.find(t => isEdgeTile(tiles, t[0], t[1])) ?? order[0];
  if (spot) {
    const rot = outwardRot(tiles, spot[0], spot[1], 0);
    decor.push(rot ? { type: ANCHOR, x: spot[0], z: spot[1], rot } : { type: ANCHOR, x: spot[0], z: spot[1] });
    return 'placed';
  }
  world.sailing.anchored = false;
  const inv = world.hostInventory;
  if (inv && Array.isArray(inv.slots)) {
    const i = inv.slots.findIndex(s => !s);
    if (i >= 0) inv.slots[i] = { kind: ANCHOR, count: 1 };
    else if (inv.slots.length < 28) inv.slots.push({ kind: ANCHOR, count: 1 });
  }
  return 'bag';
}
