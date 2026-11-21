// Foundation armor: one Foundation Armor item (1 metal ingot + 2 nails, items.js) is fitted to one foundation tile.
// The shark never bites an armored tile (dist/shark.js tileArmor contract). Removing the tile drops its armor.
//
// Two halves:
//   - pure rules (no THREE, no DOM): cleanTileArmor, isArmoredAt, canFitArmor, fitArmor, armorSides (tests/armor.test.mjs)
//   - createArmorView(T, scene): metal trim plates on the open (outer) sides of armored tiles. One instanced draw call,
//     instance matrices rebuilt only when the tiles or the armor change, no shadow casting, no per-frame allocations.
//
// world.tileArmor is a sparse object {"x,z": 1}. Saves and host snapshots carry it; cleanTileArmor drops junk and keys
// for tiles that are gone.

import { mergeGeometries } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';

export const ARMOR_ITEM = 'armor';
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const isInt = Number.isInteger;
const hasOwn = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
export const armorKey = (x, z) => x + ',' + z;

function hasTile(tiles, x, z) {
  if (!Array.isArray(tiles)) return false;
  for (let i = 0; i < tiles.length; i++) { const t = tiles[i]; if (t && t[0] === x && t[1] === z) return true; }
  return false;
}

/** A fresh sparse {"x,z": 1} keeping only armor on tiles that exist. Junk in -> {}. */
export function cleanTileArmor(v, tiles) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v) || !Array.isArray(tiles)) return out;
  for (const t of tiles) {
    if (!Array.isArray(t)) continue;
    const k = armorKey(t[0], t[1]);
    if (hasOwn(v, k) && v[k]) out[k] = 1;
  }
  return out;
}

export function isArmoredAt(world, x, z) {
  const a = world && world.tileArmor;
  return !!(a && typeof a === 'object' && hasOwn(a, armorKey(x, z)) && a[armorKey(x, z)]);
}

/** Why armor cannot be fitted to (x, z): 'tile' (no foundation), 'armored', or null when it can. */
export function canFitArmor(world, x, z) {
  if (!isInt(x) || !isInt(z) || !hasTile(world && world.tiles, x, z)) return 'tile';
  return isArmoredAt(world, x, z) ? 'armored' : null;
}

/**
 * Host side: fits one Foundation Armor from bag to tile (x, z). bag needs count(kind) and remove(kind, n).
 * Returns {ok:true} or {ok:false, reason:'tile'|'armored'|'cost'}.
 */
export function fitArmor(world, x, z, bag) {
  const why = canFitArmor(world, x, z);
  if (why) return { ok: false, reason: why };
  if (!bag || bag.count(ARMOR_ITEM) < 1) return { ok: false, reason: 'cost' };
  bag.remove(ARMOR_ITEM, 1);
  if (!world.tileArmor || typeof world.tileArmor !== 'object' || Array.isArray(world.tileArmor)) world.tileArmor = {};
  world.tileArmor[armorKey(x, z)] = 1;
  return { ok: true };
}

/**
 * Open sides of armored tiles, written into out as flat [x, z, nx, nz, ...] (out is reused; returns the side count).
 * A side is open when the 4-neighbour across it has no tile. Allocation-free when out is big enough already.
 */
export function armorSides(tiles, armor, out) {
  out.length = 0;
  if (!Array.isArray(tiles) || !armor || typeof armor !== 'object') return 0;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]; if (!Array.isArray(t)) continue;
    const k = armorKey(t[0], t[1]); if (!hasOwn(armor, k) || !armor[k]) continue;
    for (let j = 0; j < 4; j++) {
      const nx = N4[j][0], nz = N4[j][1];
      if (!hasTile(tiles, t[0] + nx, t[1] + nz)) out.push(t[0], t[1], nx, nz);
    }
  }
  return out.length / 4;
}

// ------------------------------------------------------------------ view

/** Plate geometry for one side, in side space: +z faces open water, the plate hugs the tile's z = +1 face. */
function plateGeometry(T) {
  const parts = [];
  const add = (w, h, d, x, y, z) => { const g = new T.BoxGeometry(w, h, d); g.translate(x, y, z); parts.push(g); };
  add(1.9, 0.17, 0.035, 0, 0.1, 1.02);          // the plate on the outer face (deck is y 0..0.2)
  add(1.94, 0.022, 0.12, 0, 0.214, 0.975);      // a lip folded over the deck edge
  for (const x of [-0.78, -0.26, 0.26, 0.78]) add(0.05, 0.05, 0.02, x, 0.11, 1.045); // rivet heads
  const g = mergeGeometries(T, parts);
  for (const p of parts) p.dispose();
  return g;
}

/**
 * createArmorView(T, scene) -> {update(world, raft), dispose(), count}
 * update copies the raft group's transform (cheap) and rebuilds the instances only when the layout hash changes.
 */
export function createArmorView(T, scene) {
  const geo = plateGeometry(T);
  const mat = new T.MeshStandardMaterial({ color: 0x8e9aa4, metalness: 0.35, roughness: 0.48 });
  let cap = 0, mesh = null, key = -1;
  const group = new T.Group(); group.name = 'foundationArmor';
  scene.add(group);
  const sides = [], m4 = new T.Matrix4(), rot = new T.Matrix4();
  function ensure(n) {
    if (mesh && n <= cap) return;
    if (mesh) { group.remove(mesh); mesh.dispose(); }
    cap = Math.max(16, cap * 2, n);
    mesh = new T.InstancedMesh(geo, mat, cap); mesh.name = 'armorPlates'; mesh.count = 0;
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
    group.add(mesh); key = -1;
  }
  ensure(0);
  function hash(world) { // allocation-free hash of the tile layout and the armor keys
    const tiles = world.tiles, a = world.tileArmor;
    let h = (tiles ? tiles.length : 0) | 0;
    if (tiles) for (let i = 0; i < tiles.length; i++) { const t = tiles[i]; if (t) h = Math.imul(Math.imul(h ^ (t[0] + 64), 0x01000193) ^ (t[1] + 64), 0x01000193); }
    if (a && typeof a === 'object') for (const k in a) { if (!a[k]) continue; for (let c = 0; c < k.length; c++) h = Math.imul(h ^ k.charCodeAt(c), 0x01000193); h = Math.imul(h ^ 7, 0x01000193); }
    return h;
  }
  function rebuild(world) {
    const n = armorSides(world.tiles, world.tileArmor, sides);
    ensure(n);
    for (let i = 0; i < n; i++) {
      const x = sides[i * 4], z = sides[i * 4 + 1], nx = sides[i * 4 + 2], nz = sides[i * 4 + 3];
      rot.makeRotationY(Math.atan2(nx, nz)); // side space +z -> (nx, nz)
      m4.makeTranslation(x * 2, 0, z * 2).multiply(rot);
      mesh.setMatrixAt(i, m4);
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true; mesh.visible = n > 0;
  }
  function update(world, raft) {
    if (!world) return;
    const h = hash(world);
    if (h !== key) { key = h; rebuild(world); }
    if (raft) { group.position.copy(raft.position); group.quaternion.copy(raft.quaternion); group.scale.copy(raft.scale); }
  }
  function dispose() { scene.remove(group); mesh?.dispose(); geo.dispose(); mat.dispose(); mesh = null; }
  return { update, dispose, get count() { return mesh ? mesh.count : 0; }, group };
}
