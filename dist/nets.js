// Collection nets: a wooden frame with rope netting that hangs off one side of a raft tile, over the water.
// Debris that drifts into the frame stops there (up to NET_CAPACITY pieces); everything else floats past.
// A player empties it with E: each caught piece is rolled into loot and goes into that player's bag,
// and pieces whose loot does not fit stay in the net.
//
// A net is {x, z, d, items}: (x, z) is the tile cell it hangs from, d the side (index into NET_DIRS,
// pointing out over the water) and items the caught debris types in catch order. Coordinates are
// raft-local metres for positions and integer tile cells (2 m) for x / z, like the rest of game.js.
//
// Old saves: a net used to be deck decor ({type:'net', x, z} on a tile) that pulled nearby debris
// into the host's bag. migrateDeckNets() moves each one to the nearest free edge spot of the raft
// (closest edge midpoint to the old tile, ties broken by side order). A deck net with no free edge
// spot left stays as plain deck decor and does nothing.
//
// The pure helpers need no THREE, so tests import this module directly. createNetModel / createNetView
// take THREE as an argument.

export const NET_CAPACITY = 10;
export const NET_DIRS = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]].map(v => Object.freeze(v)));
export const NET_HALF_W = 0.9;   // half the width along the raft edge (m)
export const NET_DEPTH = 1.05;   // how far the frame sticks out over the water (m)
export const NET_REACH = 2.2;    // metres from the player to the net frame for E
export const NET_CATCH = Object.freeze(['wood', 'leaf', 'scrap', 'plastic', 'barrel']); // never the signal cache or a bottle
const TILE = 2, HALF = TILE / 2, BOUND = 26;
const isInt = Number.isInteger;
const hasTile = (tiles, x, z) => { for (let i = 0; i < tiles.length; i++) if (tiles[i][0] === x && tiles[i][1] === z) return true; return false; };

// The water cell a net covers (the free neighbour of its tile).
export const netCellX = n => n.x + NET_DIRS[n.d][0];
export const netCellZ = n => n.z + NET_DIRS[n.d][1];
// Yaw that turns the model's local +z (outward) to face side d.
export const netYaw = d => Math.atan2(NET_DIRS[d][0], NET_DIRS[d][1]);
// Centre of the tile edge the net hangs from (raft-local metres).
export const netEdgeX = n => n.x * TILE + NET_DIRS[n.d][0] * HALF;
export const netEdgeZ = n => n.z * TILE + NET_DIRS[n.d][1] * HALF;
export const netCenterX = n => netEdgeX(n) + NET_DIRS[n.d][0] * NET_DEPTH / 2;
export const netCenterZ = n => netEdgeZ(n) + NET_DIRS[n.d][1] * NET_DEPTH / 2;

// Axis-aligned catch rectangle {minX, maxX, minZ, maxZ} (written into `out` when given).
export function netRect(n, out = {}) {
  const dx = NET_DIRS[n.d][0], cx = netCenterX(n), cz = netCenterZ(n);
  const hx = dx ? NET_DEPTH / 2 : NET_HALF_W, hz = dx ? NET_HALF_W : NET_DEPTH / 2;
  out.minX = cx - hx; out.maxX = cx + hx; out.minZ = cz - hz; out.maxZ = cz + hz;
  return out;
}

// Does the segment (x0, z0) -> (x1, z1) touch the rectangle? Slab test, no allocation.
export function segmentHitsRect(r, x0, z0, x1, z1) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  if (dx === 0) { if (x0 < r.minX || x0 > r.maxX) return false; }
  else {
    let a = (r.minX - x0) / dx, b = (r.maxX - x0) / dx; if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false;
  }
  if (dz === 0) { if (z0 < r.minZ || z0 > r.maxZ) return false; }
  else {
    let a = (r.minZ - z0) / dz, b = (r.maxZ - z0) / dz; if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false;
  }
  return true;
}

const scratchRect = {minX:0, maxX:0, minZ:0, maxZ:0};
// Index of the first net with room whose rectangle the item's drift step crossed, else -1.
export function catchNet(nets, type, x0, z0, x1, z1) {
  if (!nets || !nets.length || !NET_CATCH.includes(type)) return -1;
  for (let i = 0; i < nets.length; i++) {
    const n = nets[i]; if (n.items.length >= NET_CAPACITY) continue;
    if (segmentHitsRect(netRect(n, scratchRect), x0, z0, x1, z1)) return i;
  }
  return -1;
}

// Resting spot of the k-th caught piece, in the net model's local frame (x along the edge, z outward).
const SLOT_COLS = 5;
export function netSlot(k, out = {}) {
  const col = k % SLOT_COLS, row = Math.floor(k / SLOT_COLS) % 2;
  out.x = (col - (SLOT_COLS - 1) / 2) * 0.33 + (row ? 0.08 : -0.08);
  out.z = row ? 0.72 : 0.36;
  return out;
}

// Net index whose rectangle (grown by `pad` metres) contains (x, z), or -1.
export function netAt(nets, x, z, pad = 0.3) {
  if (!nets || !Number.isFinite(x) || !Number.isFinite(z)) return -1;
  for (let i = 0; i < nets.length; i++) {
    const r = netRect(nets[i], scratchRect);
    if (x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad) return i;
  }
  return -1;
}
// Horizontal distance (m) from (x, z) to the net's frame (0 inside it).
export function netDistance(n, x, z) {
  const r = netRect(n, scratchRect);
  return Math.hypot(Math.max(0, r.minX - x, x - r.maxX), Math.max(0, r.minZ - z, z - r.maxZ));
}
export const findNet = (nets, x, z, d) => (nets || []).findIndex(n => n.x === x && n.z === z && n.d === d);
const cellTaken = (nets, cx, cz) => (nets || []).some(n => netCellX(n) === cx && netCellZ(n) === cz);

// Why a net cannot hang from tile (x, z) on side d: 'invalid' | 'nofloor' | 'water' (the side is not
// open water) | 'bound' | 'net' (that water cell already has a net), or null when it can.
export function netBlock(tiles, nets, x, z, d) {
  if (!isInt(x) || !isInt(z) || !isInt(d) || d < 0 || d > 3) return 'invalid';
  if (!hasTile(tiles, x, z)) return 'nofloor';
  const cx = x + NET_DIRS[d][0], cz = z + NET_DIRS[d][1];
  if (hasTile(tiles, cx, cz)) return 'water';
  if (Math.abs(cx) > BOUND || Math.abs(cz) > BOUND) return 'bound';
  if (cellTaken(nets, cx, cz)) return 'net';
  return null;
}
// Is a water cell (a would-be floor tile) covered by a net?
export const netOnCell = (nets, cx, cz) => cellTaken(nets, cx, cz);

// Placement spot for a net aimed at raft-local (px, pz): {x, z, d} (tile + side) or null.
// Aiming over open water picks the neighbouring tile whose edge is closest; aiming at a tile near
// its edge picks that edge (like floorTarget does for foundations). Blocked spots are returned too
// (with `blocked`) so the ghost can turn red.
export function netSpot(tiles, nets, px, pz) {
  if (!Number.isFinite(px) || !Number.isFinite(pz) || !tiles?.length) return null;
  const cx = Math.round(px / TILE), cz = Math.round(pz / TILE);
  let spot = null;
  if (hasTile(tiles, cx, cz)) {
    const ox = px - cx * TILE, oz = pz - cz * TILE;
    if (Math.max(Math.abs(ox), Math.abs(oz)) < 0.45) return null;
    const d = Math.abs(ox) > Math.abs(oz) ? (ox > 0 ? 0 : 1) : (oz > 0 ? 2 : 3);
    if (hasTile(tiles, cx + NET_DIRS[d][0], cz + NET_DIRS[d][1])) return null;
    spot = {x:cx, z:cz, d};
  } else {
    let best = Infinity;
    for (let d = 0; d < 4; d++) { // tile t = water cell - dir; the shared edge sits half a tile from the water cell centre
      const tx = cx - NET_DIRS[d][0], tz = cz - NET_DIRS[d][1]; if (!hasTile(tiles, tx, tz)) continue;
      const ex = tx * TILE + NET_DIRS[d][0] * HALF, ez = tz * TILE + NET_DIRS[d][1] * HALF, dist = Math.hypot(px - ex, pz - ez);
      if (dist < best) { best = dist; spot = {x:tx, z:tz, d}; }
    }
    if (!spot) return null;
  }
  const why = netBlock(tiles, nets, spot.x, spot.z, spot.d);
  if (why === 'invalid' || why === 'nofloor' || why === 'water') return null;
  if (why) spot.blocked = why;
  return spot;
}

// Validates saved nets against the tiles. Returns a fresh array.
export function cleanNets(v, tiles) {
  const out = [];
  if (!Array.isArray(v)) return out;
  for (const n of v.slice(0, 64)) {
    if (!n || typeof n !== 'object') continue;
    if (netBlock(tiles, out, n.x, n.z, n.d)) continue;
    const items = Array.isArray(n.items) ? n.items.filter(t => NET_CATCH.includes(t)).slice(0, NET_CAPACITY) : [];
    out.push({x:n.x, z:n.z, d:n.d, items});
  }
  return out;
}
export const copyNets = nets => (Array.isArray(nets) ? nets.map(n => ({x:n.x, z:n.z, d:n.d, items:[...n.items]})) : []);

// Old deck nets ({x, z} tile cells) -> edge nets, added to `nets`. Returns the deck nets that found no spot.
export function migrateDeckNets(deckNets, tiles, nets) {
  const left = [];
  for (const old of deckNets) {
    let best = null, bestD = Infinity;
    for (const t of tiles) for (let d = 0; d < 4; d++) {
      if (netBlock(tiles, nets, t[0], t[1], d)) continue;
      const dist = Math.hypot(t[0] * TILE + NET_DIRS[d][0] * HALF - old.x * TILE, t[1] * TILE + NET_DIRS[d][1] * HALF - old.z * TILE);
      if (dist < bestD - 1e-9) { bestD = dist; best = {x:t[0], z:t[1], d, items:[]}; }
    }
    if (best) nets.push(best); else left.push(old);
  }
  return left;
}

// Empties a net into `bag` (a Bag from inventory-state.js). lootFor(type) gives the loot for one piece
// (rolled here, so a barrel only rolls once it is actually taken). Each piece goes in whole or stays.
// Returns {taken, left, loot} and removes the taken pieces from net.items.
export function emptyNet(net, bag, lootFor) {
  const loot = {}, keep = [];
  let taken = 0;
  for (const type of net.items) {
    const l = lootFor(type);
    if (!l || !fits(bag, l)) { keep.push(type); continue; }
    for (const [k, n] of Object.entries(l)) { bag.add(k, n); loot[k] = (loot[k] || 0) + n; }
    taken++;
  }
  net.items = keep;
  return {taken, left:keep.length, loot};
}
function fits(bag, loot) {
  const scratch = new bag.constructor(bag.snapshot());
  for (const [k, n] of Object.entries(loot)) if (scratch.add(k, n) > 0) return false;
  return true;
}

// ---------- Model and view (THREE passed in) ----------
// One net: wood frame + floats in one merged vertex-coloured mesh and the rope netting in another
// (two draw calls). Local frame: x along the raft edge, +z outward, y = 0 at the water line.
// Geometry is shared by every net and flagged userData.shared so game.js's disposeGeometry skips it.
let shared = null;
function netGeometry(T, merge) {
  if (shared && shared.T === T) return shared;
  const wood = [], rope = [];
  const tint = (g, hex) => {
    const c = new T.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(a, 3)); return g;
  };
  const box = (list, w, h, d, x, y, z, hex, ry = 0, rx = 0) => {
    const g = new T.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); g.translate(x, y, z);
    list.push(hex ? tint(g, hex) : g);
  };
  const W = NET_HALF_W, D = NET_DEPTH, TOP = 0.42, BOT = -0.22;
  // frame: a deck beam against the raft, two side arms, the outer beam, four posts and a top rail
  box(wood, 2 * W + 0.1, 0.1, 0.12, 0, 0.12, 0.06, '#7b5735');
  for (const s of [-1, 1]) {
    box(wood, 0.1, 0.09, D, s * W, 0.1, D / 2, s > 0 ? '#8a6640' : '#82603b');
    box(wood, 0.09, TOP - BOT + 0.12, 0.09, s * W, (TOP + BOT) / 2, D - 0.04, '#6f4f30');
    box(wood, 0.08, TOP - BOT + 0.06, 0.08, s * W, (TOP + BOT) / 2 + 0.03, 0.08, '#6f4f30');
    box(wood, 0.07, 0.07, D * 1.04, s * W, TOP, D / 2, '#94704a', 0, 0); // top side rail
    box(wood, 0.04, 0.04, 0.3, s * (W - 0.08), 0.14, D - 0.2, '#5e4029', 0, Math.PI / 4); // corner brace
  }
  box(wood, 2 * W + 0.12, 0.09, 0.1, 0, 0.1, D, '#8d6943');
  box(wood, 2 * W + 0.12, 0.07, 0.07, 0, TOP, D - 0.04, '#9c7649');
  box(wood, 2 * W, 0.06, 0.06, 0, BOT, D - 0.04, '#6a4b2d');
  for (const s of [-1, 1]) box(wood, 0.06, 0.06, D, s * W, BOT, D / 2, '#6a4b2d');
  // two plastic floats lashed under the outer beam
  for (const s of [-0.55, 0.55]) { const g = new T.CylinderGeometry(0.1, 0.1, 0.42, 10); g.rotateZ(Math.PI / 2); g.translate(s, 0.02, D + 0.09); wood.push(tint(g, '#e0703c')); }
  // netting: a sagging floor plus the outer and side walls, thin rope strands
  const R = 0.014, sag = (u, v) => BOT + 0.02 - 0.06 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
  const NX = 8, NZ = 5;
  for (let i = 0; i <= NX; i++) { // floor strands running outward, slightly sagged via two segments
    const x = -W + (2 * W * i) / NX;
    for (let j = 0; j < NZ; j++) { const z0 = 0.1 + (D - 0.14) * j / NZ, z1 = 0.1 + (D - 0.14) * (j + 1) / NZ, y = sag(i / NX, (j + 0.5) / NZ); box(rope, R, R, z1 - z0 + R, x, y, (z0 + z1) / 2); }
  }
  for (let j = 0; j <= NZ; j++) { // floor strands along the edge
    const z = 0.1 + (D - 0.14) * j / NZ;
    for (let i = 0; i < NX; i++) { const x0 = -W + (2 * W * i) / NX, x1 = -W + (2 * W * (i + 1)) / NX, y = sag((i + 0.5) / NX, j / NZ); box(rope, x1 - x0 + R, R, R, (x0 + x1) / 2, y, z); }
  }
  const NY = 4;
  for (let i = 0; i <= NX; i++) box(rope, R, TOP - BOT, R, -W + (2 * W * i) / NX, (TOP + BOT) / 2, D - 0.04); // outer wall
  for (let k = 1; k < NY; k++) box(rope, 2 * W, R, R, 0, BOT + (TOP - BOT) * k / NY, D - 0.04);
  for (const s of [-1, 1]) { // side walls
    for (let j = 1; j < NZ; j++) box(rope, R, TOP - BOT, R, s * W, (TOP + BOT) / 2, 0.1 + (D - 0.14) * j / NZ);
    for (let k = 1; k < NY; k++) box(rope, R, R, D - 0.1, s * W, BOT + (TOP - BOT) * k / NY, D / 2 + 0.02);
  }
  const frame = merge(T, wood), net = merge(T, rope);
  for (const g of wood.concat(rope)) g.dispose();
  frame.userData.shared = true; net.userData.shared = true;
  frame.computeBoundingSphere(); net.computeBoundingSphere();
  const frameMat = new T.MeshStandardMaterial({vertexColors:true, roughness:0.85});
  const ropeMat = new T.MeshStandardMaterial({color:'#cdb27a', roughness:1});
  frameMat.userData.shared = true; ropeMat.userData.shared = true;
  shared = {T, frame, net, frameMat, ropeMat};
  return shared;
}

// A fresh net group (for ghosts too: it may swap the materials, the geometry stays shared).
export function createNetModel(T, merge, {ownMaterials = false} = {}) {
  const s = netGeometry(T, merge), g = new T.Group();
  const a = new T.Mesh(s.frame, ownMaterials ? new T.MeshBasicMaterial() : s.frameMat), b = new T.Mesh(s.net, ownMaterials ? new T.MeshBasicMaterial() : s.ropeMat);
  a.name = 'netFrame'; b.name = 'netRope';
  for (const m of [a, b]) { m.castShadow = false; m.receiveShadow = false; g.add(m); }
  g.name = 'collection-net'; g.userData.craftType = 'net';
  return g;
}

// All nets of the raft plus the debris resting in them. The root follows the raft's sway each frame;
// sync() rebuilds only nets whose spot or contents changed (never per frame).
// itemModel(type, seed) makes a debris model (caller-owned materials / geometry, disposed via dispose(obj)).
export function createNetView(T, {scene, raft, merge, itemModel, dispose}) {
  const root = new T.Group(); root.name = 'nets'; scene.add(root);
  const views = []; // {sig, group, contents}
  const slot = {x:0, z:0};
  function clearContents(v) { for (const c of v.contents) { v.group.remove(c); dispose?.(c); } v.contents.length = 0; }
  function sync(nets) {
    nets = nets || [];
    while (views.length > nets.length) { const v = views.pop(); clearContents(v); root.remove(v.group); }
    for (let i = 0; i < nets.length; i++) {
      const n = nets[i], sig = `${n.x},${n.z},${n.d}:${n.items.join(',')}`;
      let v = views[i];
      if (!v) { v = {sig:'', group:createNetModel(T, merge), contents:[]}; root.add(v.group); views[i] = v; }
      if (v.sig === sig) continue;
      v.sig = sig;
      v.group.position.set(netEdgeX(n), 0, netEdgeZ(n)); v.group.rotation.y = netYaw(n.d);
      clearContents(v);
      n.items.forEach((type, k) => {
        let m = null; try { m = itemModel(type, (n.x * 31 + n.z * 17 + k * 7) & 0xffff); } catch { m = null; }
        if (!m) return;
        netSlot(k, slot);
        m.traverse(o => { o.castShadow = false; });
        m.scale.multiplyScalar(type === 'barrel' ? 0.62 : 0.7);
        m.position.set(slot.x, -0.08, slot.z); m.rotation.y = (k * 1.7) % 3.1;
        v.group.add(m); v.contents.push(m);
      });
    }
  }
  function update(time) { // follow the raft; contents bob a little in the water
    root.position.copy(raft.position); root.quaternion.copy(raft.quaternion);
    for (let i = 0; i < views.length; i++) {
      const c = views[i].contents;
      for (let k = 0; k < c.length; k++) c[k].position.y = -0.08 + Math.sin(time * 1.6 + k * 1.3 + i) * 0.025;
    }
  }
  function dispose_() { for (const v of views) { clearContents(v); root.remove(v.group); } views.length = 0; scene.remove(root); }
  return {root, sync, update, dispose:dispose_, get count() { return views.length; }};
}
