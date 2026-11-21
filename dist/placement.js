// Raft-style building rules plus the translucent ghost preview.
// Foundations snap to the 2 m grid next to existing tiles; decorations sit at the exact aimed
// point (raft-local metres, any rotation) as long as they rest on the deck and do not overlap.
// Pure logic needs no THREE, so tests can import it directly. hasTile(tx, tz) takes grid cells.

export const TILE = 2;
export const ROT_STEP = Math.PI / 4, FINE_STEP = Math.PI / 12;
export const DECOR_REACH = 6, FLOOR_REACH = 8;
// [half width, half depth, share of the footprint that must rest on deck (0 = centre only)].
export const FOOTPRINT = Object.freeze({
  sail:[.4, .4, .8], palm:[.42, .42, .8], lantern:[.24, .24, .8], net:[.84, .84, 0], bench:[.72, .2, .8], crate:[.49, .42, .8],
});

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
  const mat = new T.MeshLambertMaterial({color:OK, emissive:OK.clone(), emissiveIntensity:.55, transparent:true, opacity:.5, depthWrite:false});
  const depth = new T.MeshBasicMaterial({colorWrite:false, transparent:true}); // depth pre-pass after the opaque scene: only the ghost's front surface is tinted
  const root = new T.Group(); root.name = 'build-ghost'; scene.add(root);
  const cache = new Map();
  let shown = null, wasOk = true;
  function model(kind) {
    if (cache.has(kind)) return cache.get(kind);
    const g = kind === 'floor' ? floor(() => mat) : craft(kind);
    if (g) {
      const meshes = [];
      g.traverse(o => { if (o.isMesh) meshes.push(o); });
      for (const o of meshes) {
        for (const m of [].concat(o.material)) if (m !== mat) m.dispose();
        o.material = mat; o.castShadow = false; o.receiveShadow = false; o.renderOrder = 6;
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
    if (ok !== wasOk) { wasOk = ok; mat.color.copy(ok ? OK : BAD); mat.emissive.copy(ok ? OK : BAD); }
    mat.opacity = .5 + Math.sin(time * 4) * .06;
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
