// Little Raft - 3D colliders for placed decor and stations.
// Pure ES module: no DOM, no THREE. Built once per raft rebuild (game.js rebuildRaft), never per frame.
//
// A collider is a PlayerPhysics blocker ({x, z, r} circle or {x, z, hx, hz, rot} rectangle, raft-local metres)
// plus a height range above the deck plane: y0 (bottom) and top. stand: the top is a surface the player can land
// and walk on (crates, tables, beds, stations, planters); otherwise the collider only blocks the body while the
// feet are below its top (lamps, poles, flags, signs). Flat decor (rugs) has no collider at all.
// XZ comes from the placement footprint (placement.js footprintOf: the model's measured below-head bounds), so
// what you bump into is what you see; tops are the model heights above the deck (measured once with
// THREE.Box3 on every model at rot 0, see check_climb.py), kept as a fixed table so host and guest agree.

import { footprintOf } from './placement.js?build=v3-survival-ae77fa84ac2b';
import { decorBlockers } from './coop-rules.js?build=v3-survival-ae77fa84ac2b';
import { openSide } from './fish-trap.js?build=v3-survival-ae77fa84ac2b';

const table = o => Object.assign(Object.create(null), o); // null prototype: 'constructor' from a save is not a type
// Standable tops (m above the deck): the whole footprint is one solid box.
const STAND = table({
  crate: .87, bench: .92, receiver: .97, purifier: .73, rainbarrel: .74, research: 1.39, bed: .75, motor: .95,
  kiln: 1.09, nestbox: .67, cushion: .18, cookpot: .55, glassfloat: .54, gametable: .8, goatpen: .82,
  cropplot: .37, flowerbox: .45, beehive: .81, juicer: .65, battery: .46, shelf: .81, trophystand: .76,
  maptable: .96, researchtable: .96, grill: .53, smelter: 1.29, recycler: .75,
});
// Thin or tall things: block with their true height, never stood on. [top, radius]: a circle round the post, pole
// or pot and its foot plate, so lamp arms, flags and leaves overhead do not shove the body.
const BLOCK = table({
  lantern: [1.25, .12], antenna: [2.33, .1], pennant: [2.51, .15], courseflag: [1.91, .15], stormrod: [2.62, .15],
  stormlamp: [.63, .12], stormglass: [.58, .1], sprinkler: [.59, .12], perch: [1.17, .2], turbine: [2.4, .2],
  lamppost: [2.25, .12], scarecrow: [2.03, .25], glidepost: [3.44, .15], glidestep: [2.44, .15], skyrocket: [.5, .1],
  candle: [.21, .1], photoframe: [.64, .15], shellwreath: [.64, .12], flagpole: [3.51, .2],
});
// Boards and wheels: block with their true height over the whole footprint.
const BLOCK_RECT = table({wheel: 1.27, sign: 1.42, scoreboard: 1.58, taskboard: .98});
// Several parts (decor-local offsets ox / oz and rotation, metres; y0: bottom above the deck, default 0). Each part is
// the solid visible frame of the model at body height (posts, bases, boards, a hanging pot or glass box); cloth,
// leaves and wire overhead are left out. Measured from the models at rot 0 (dist/decor-pack-models.js,
// kiln-model.js, power-model.js, fish-trap-model.js, crafts.js).
const FISH_ARM = Math.atan2(-.34, .67); // fish-trap-model.js: post (.34, .62) to the pivot over the water (0, 1.29)
const PARTS = table({
  palm: [{r: .38, top: .5, stand: true}, {r: .14, top: 2.24, stand: false}],
  hammock: [{hx: .98, hz: .22, rot: -Math.PI / 4, top: .6, stand: true},
    {ox: -.72, oz: -.72, r: .08, top: 1.18, stand: false}, {ox: .72, oz: .72, r: .08, top: 1.18, stand: false}],
  // three pots (x -.57 .. .43, z -.56 .. .43): the flowers on top are the standable height
  pots: [{ox: -.07, oz: -.065, hx: .5, hz: .495, top: .76, stand: true}],
  // post with a foot plate, and the glass box on its bracket at head height
  glasslamp: [{r: .12, top: 1.62}, {ox: .3, hx: .12, hz: .12, y0: 1.1, top: 1.55}],
  // two posts on feet and the cross bar (x +-.41, z +-.15)
  chime: [{hx: .41, hz: .15, top: 1.34}],
  // pot stand at x -.45 (foot .4 x .4, pole to 2.04) and the hanging pot under the arm tip at x .2
  fern: [{ox: -.45, hx: .2, hz: .2, top: 2.04}, {ox: .2, r: .2, y0: 1.38, top: 1.62}],
  // post at x 0 and the anchor peg at x .78 with the bulb wire between them
  stringlights: [{ox: .36, hx: .445, hz: .09, top: 1.14}],
  // post near the tile edge and the arm reaching out over the water (the basket hangs below the deck)
  fishtrap: [{ox: .34, oz: .62, hx: .07, hz: .07, top: .54}, {ox: .17, oz: .955, hx: .03, hz: .41, rot: FISH_ARM, y0: .45, top: .54}],
  // cross of deck planks with braces (+-.75), the mast, and the boom and cloth (x +-.8, z .06 .. .42) from 1 m up
  sail: [{hx: .75, hz: .1, top: .8}, {hx: .1, hz: .75, top: .8}, {r: .08, top: 3.78},
    {oz: .24, hx: .8, hz: .18, y0: 1, top: 3.25}],
});
// Models that keep their default facing whatever the placement rotation (buoycourse.js userData.ownRot).
const OWN_ROT = new Set(['courseflag', 'scoreboard']);
const FLAT = new Set(['rug', 'net']);

export const DECOR_STAND_TOP = Object.freeze({...STAND});
export const DECOR_BLOCK_TOP = Object.freeze({...Object.fromEntries(Object.entries(BLOCK).map(([k, v]) => [k, v[0]])), ...BLOCK_RECT});
export const DECOR_PARTS = PARTS;
export const isFlatDecor = type => FLAT.has(type);
// Every decor type this table decides (others fall back to the old height-less blockers).
export const hasDecorCollider = type => FLAT.has(type) || type in STAND || type in BLOCK || type in BLOCK_RECT || type in PARTS;

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// The rotation the model is drawn with (game.js rebuildRaft): d.rot, except models that keep their own facing, and
// the fish trap, which fish-trap.js turns toward the open water beside its tile (when the tiles are known).
export function modelRot(d, tiles) {
  if (OWN_ROT.has(d.type)) return 0;
  if (d.type === 'fishtrap' && Array.isArray(tiles)) { const s = openSide(tiles, d.x, d.z, num(d.rot, 0)); if (s) return Math.atan2(s[0], s[1]); }
  return num(d.rot, 0);
}

// Colliders for one decor entry (x, z in decor units: tile cells * unit metres). radii: BLOCK_RADIUS (footprint
// fallback for a type placement.js has no table entry for, and the old blockers of unknown types). tiles (optional):
// the raft tiles, for models that face the open water (fish trap).
export function decorColliders(d, radii, unit = 2, tiles = null) {
  if (!d || typeof d.type !== 'string' || !Number.isFinite(d.x) || !Number.isFinite(d.z)) return [];
  const t = d.type, cx = d.x * unit, cz = d.z * unit, rot = modelRot(d, tiles);
  if (FLAT.has(t)) return [];
  if (t in STAND || t in BLOCK_RECT) {
    const f = footprintOf(t, radii), top = t in STAND ? STAND[t] : BLOCK_RECT[t];
    return [{x: cx, z: cz, hx: f[0], hz: f[1], rot, y0: 0, top, stand: t in STAND, lx: 0, lz: 0, lr: 0}];
  }
  if (t in BLOCK) return [{x: cx, z: cz, r: BLOCK[t][1], y0: 0, top: BLOCK[t][0], stand: false, lx: 0, lz: 0, lr: 0}];
  const parts = PARTS[t];
  if (parts) {
    const cs = parts.map(p => (p.r ? {x: cx, z: cz, r: p.r} : {x: cx, z: cz, hx: p.hx, hz: p.hz, rot: 0})); // shape first (same hidden class as the tables above)
    for (let i = 0; i < cs.length; i++) Object.assign(cs[i], {y0: parts[i].y0 || 0, top: parts[i].top, stand: !!parts[i].stand, lx: parts[i].ox || 0, lz: parts[i].oz || 0, lr: parts[i].rot || 0});
    orientColliders(cs, cx, cz, rot);
    return cs;
  }
  return decorBlockers(d, radii, unit); // unknown type: the old full-height column, never stood on
}

// Turn colliders of one decor (from decorColliders) to rotation rot about (cx, cz) in place, no allocation: the
// local offset (lx, lz) and part rotation lr ride with the model. three.js rotation.y: local x -> (c, -s), z -> (s, c).
export function orientColliders(cs, cx, cz, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < cs.length; i++) {
    const b = cs[i];
    if (!Number.isFinite(b.lx)) continue; // an old height-less blocker
    b.x = cx + b.lx * c + b.lz * s; b.z = cz - b.lx * s + b.lz * c;
    if (Number.isFinite(b.hx)) b.rot = rot + b.lr;
  }
}

// game.js: keep colliders on the model as it turns at run time (a sail swinging to the wind, a fish trap facing the
// open water). list: flat [colliders, group, ...] pairs from rebuildRaft. Only a changed rotation costs anything.
export function followModels(list) {
  for (let i = 0; i + 1 < list.length; i += 2) {
    const cs = list[i], g = list[i + 1], r = g && g.rotation ? g.rotation.y : NaN;
    if (cs.r === r || !Number.isFinite(r)) continue;
    cs.r = r; orientColliders(cs, g.position.x, g.position.z, r);
  }
}

export default decorColliders;
