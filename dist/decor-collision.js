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

const table = o => Object.assign(Object.create(null), o); // null prototype: 'constructor' from a save is not a type
// Standable tops (m above the deck): the whole footprint is one solid box.
const STAND = table({
  crate: .87, bench: .92, receiver: .97, purifier: .73, rainbarrel: .74, research: 1.39, bed: .75, motor: .95,
  kiln: 1.09, nestbox: .67, cushion: .18, cookpot: .55, glassfloat: .54, gametable: .8, goatpen: .82,
  cropplot: .37, flowerbox: .45, beehive: .81, juicer: .65, battery: .46, shelf: .81, trophystand: .76,
  maptable: .96, researchtable: .96, grill: .53, smelter: 1.29, recycler: .75, pots: .76,
});
// Thin or tall things: block with their true height, never stood on. [top, radius]: a circle round the post, pole
// or pot (the old block radius), so lamp arms, flags and leaves overhead do not shove the body.
const BLOCK = table({
  sail: [3.78, .14], lantern: [1.25, .12], antenna: [2.33, .1], pennant: [2.51, .1], chime: [1.34, .12],
  glasslamp: [1.62, .12], flagpole: [3.51, .1], courseflag: [1.91, .15], stormrod: [2.62, .15], stormlamp: [.63, .12],
  stormglass: [.58, .1], sprinkler: [.59, .12], perch: [1.17, .2], turbine: [2.4, .2], stringlights: [1.14, .1],
  lamppost: [2.25, .12], scarecrow: [2.03, .25], glidepost: [3.44, .15], glidestep: [2.44, .15], skyrocket: [.5, .1],
  candle: [.21, .1], photoframe: [.64, .15], shellwreath: [.64, .12], fishtrap: [.53, .2], fern: [2.04, .22],
});
// Boards and wheels: block with their true height over the whole footprint.
const BLOCK_RECT = table({wheel: 1.27, sign: 1.42, scoreboard: 1.58, taskboard: .98});
// Several parts (decor-local offsets and rotation, metres): a planter with a trunk on it, a hammock between posts.
const PARTS = table({
  palm: [{r: .38, top: .5, stand: true}, {r: .14, top: 2.24, stand: false}],
  hammock: [{hx: .98, hz: .22, rot: -Math.PI / 4, top: .6, stand: true},
    {ox: -.72, oz: -.72, r: .08, top: 1.18, stand: false}, {ox: .72, oz: .72, r: .08, top: 1.18, stand: false}],
});
const FLAT = new Set(['rug', 'net']);

export const DECOR_STAND_TOP = Object.freeze({...STAND});
export const DECOR_BLOCK_TOP = Object.freeze({...Object.fromEntries(Object.entries(BLOCK).map(([k, v]) => [k, v[0]])), ...BLOCK_RECT});
export const DECOR_PARTS = PARTS;
export const isFlatDecor = type => FLAT.has(type);
// Every decor type this table decides (others fall back to the old height-less blockers).
export const hasDecorCollider = type => FLAT.has(type) || type in STAND || type in BLOCK || type in BLOCK_RECT || type in PARTS;

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// Colliders for one decor entry (x, z in decor units: tile cells * unit metres). radii: BLOCK_RADIUS (footprint
// fallback for a type placement.js has no table entry for, and the old blockers of unknown types).
export function decorColliders(d, radii, unit = 2) {
  if (!d || typeof d.type !== 'string' || !Number.isFinite(d.x) || !Number.isFinite(d.z)) return [];
  const t = d.type, cx = d.x * unit, cz = d.z * unit, rot = num(d.rot, num(d.yaw, 0));
  if (FLAT.has(t)) return [];
  if (t in STAND || t in BLOCK_RECT) {
    const f = footprintOf(t, radii), top = t in STAND ? STAND[t] : BLOCK_RECT[t];
    return [{x: cx, z: cz, hx: f[0], hz: f[1], rot, y0: 0, top, stand: t in STAND}];
  }
  if (t in BLOCK) return [{x: cx, z: cz, r: BLOCK[t][1], y0: 0, top: BLOCK[t][0], stand: false}];
  const parts = PARTS[t];
  if (parts) {
    const c = Math.cos(rot), s = Math.sin(rot); // three.js rotation.y: local x -> (c, -s), local z -> (s, c)
    return parts.map(p => {
      const ox = p.ox || 0, oz = p.oz || 0, x = cx + ox * c + oz * s, z = cz - ox * s + oz * c;
      return p.r ? {x, z, r: p.r, y0: 0, top: p.top, stand: p.stand} : {x, z, hx: p.hx, hz: p.hz, rot: rot + (p.rot || 0), y0: 0, top: p.top, stand: p.stand};
    });
  }
  return decorBlockers(d, radii, unit); // unknown type: the old full-height column, never stood on
}

export default decorColliders;
