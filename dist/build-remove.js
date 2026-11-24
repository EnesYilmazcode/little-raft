// Little Raft - taking builds apart: building pieces and foundation tiles, with the hammer (X) or the axe (hold click).
// Pure ES module: no DOM, no THREE. building.js runs these on the host (solo counts as host); the guest only aims.
// Refund: the full build cost back into the actor's bag, all or nothing (a full bag refuses the removal). An armored
// foundation also gives its Foundation Armor item back. The axe only takes pieces apart (never foundation tiles).
import { PIECES } from './building-pieces.js?build=v3-survival-ae77fa84ac2b';
import { BLOCK_TEXT } from './build-rules.js?build=v3-survival-ae77fa84ac2b';
import { floorRemoveBlock } from './placement.js?build=v3-survival-ae77fa84ac2b';
import { removeTile } from './shark.js?build=v3-survival-ae77fa84ac2b';
import { ARMOR_ITEM, isArmoredAt } from './armor.js?build=v3-survival-ae77fa84ac2b';

export const REMOVE_TOOLS = Object.freeze(['hammer', 'axe']);
export const toolOf = a => (a && a.tool === 'axe' ? 'axe' : 'hammer'); // old guests send no tool: hammer
const NEED_TOOL = {hammer:'Craft a hammer first', axe:'You need an axe'};
export const REMOVE_TEXT = Object.freeze({standing:'Someone is standing there', worn:'This axe is worn out', oldHost:'Your friend’s raft can’t take that apart yet',
  axeTile:'The axe takes pieces apart; use the hammer (X) on floors'});
const costText = c => Object.entries(c).map(([k, n]) => n + ' ' + (k === ARMOR_ITEM ? 'foundation armor' : k)).join(' + ');
const BODY_R = .25, EYE = 1.6; // player capsule (building-pieces.js): eye height above the feet

// Is a body (eye position {x, y, z}) standing on foundation tile (x, z)? Its feet must be near deck level and its
// footprint must overlap the 2 x 2 tile. A body without y counts by x/z only.
export function standingOn(b, x, z, deckY) {
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.z)) return false;
  if (Number.isFinite(b.y) && Number.isFinite(deckY)) { const feet = b.y - EYE; if (feet < deckY - .5 || feet > deckY + 1.2) return false; }
  return Math.abs(b.x - x * 2) < 1 + BODY_R && Math.abs(b.z - z * 2) < 1 + BODY_R;
}
// What stands on tile (x, z) that is not in world.decor: a grill (opts.hasGrill) or a player (opts.bodies). '' when clear.
export function tileOccupiedWhy(x, z, opts) {
  if (!opts) return '';
  if (typeof opts.hasGrill === 'function' && opts.hasGrill(x, z)) return BLOCK_TEXT.decor;
  if (Array.isArray(opts.bodies)) for (const b of opts.bodies) if (standingOn(b, x, z, opts.deckY)) return REMOVE_TEXT.standing;
  return '';
}

// Why foundation tile (x, z) can't be removed: '' when it can. grid: the BuildGrid synced to world.
// opts (optional): {hasGrill(x, z), bodies:[{x, y, z}], deckY} for what world.decor does not list.
export function tileRemoveWhy(grid, world, x, z, opts) {
  if (!Number.isInteger(x) || !Number.isInteger(z) || !world || !Array.isArray(world.tiles)) return 'Nothing to remove';
  const why = floorRemoveBlock(world.tiles, Array.isArray(world.decor) ? world.decor : [], x, z);
  if (why) return why === 'missing' ? 'Nothing to remove' : BLOCK_TEXT[why] ?? 'Can’t remove that';
  if (Array.isArray(world.nets) && world.nets.some(n => n && n.x === x && n.z === z)) return BLOCK_TEXT.net;
  return grid.canRemoveTile(x, z) || tileOccupiedWhy(x, z, opts);
}
// A usable axe in the bag: one with durability left (the same rule as island chopping).
const liveAxe = bag => bag.slots.some(s => s && s.kind === 'axe' && (s.durability ?? 100) > 0);

// Refund `cost` into a scratch copy of bag; copies back only when everything fits. Returns '' or a reason.
function refund(bag, cost, Bag) {
  const scratch = new Bag(bag.snapshot());
  for (const k in cost) if (scratch.add(k, cost[k]) > 0) return 'Your bag is full';
  for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i];
  return '';
}

// Host: a = {kind:'unpiece', t, i, j, l, r, tool?}. Mutates grid only (the caller rewrites world.pieces). {ok, text, cost}
export function removePiece(grid, a, bag, Bag) {
  const def = a && typeof a.t === 'string' && Object.hasOwn(PIECES, a.t) ? PIECES[a.t] : null;
  if (!def || def.slot === 'tile' || ![a.i, a.j, a.l].every(Number.isInteger)) return {ok:false, text:''};
  const tool = toolOf(a); if (bag.count(tool) < 1) return {ok:false, text:NEED_TOOL[tool]};
  if (tool === 'axe' && !liveAxe(bag)) return {ok:false, text:REMOVE_TEXT.worn};
  const found = grid.find({t:a.t, i:a.i, j:a.j, l:a.l, r:a.r | 0}); if (!found || found.t !== a.t) return {ok:false, text:''}; // refund what is really there
  const why = grid.canRemove(found); if (why) return {ok:false, text:why};
  const full = refund(bag, def.cost, Bag); if (full) return {ok:false, text:full};
  grid.remove(found);
  return {ok:true, text:def.name + ' removed (' + costText(def.cost) + ' back)', cost:def.cost};
}

// Host: a = {kind:'untile', x, z}. Hammer only (an axe action is refused). Removes the tile from world (and its HP /
// armor entries); an armored tile also refunds its Foundation Armor item. opts: see tileRemoveWhy. {ok, text, cost}
export function removeFoundation(grid, a, bag, world, Bag, opts) {
  if (!a || !Number.isInteger(a.x) || !Number.isInteger(a.z)) return {ok:false, text:''};
  if (toolOf(a) === 'axe') return {ok:false, text:REMOVE_TEXT.axeTile};
  if (bag.count('hammer') < 1) return {ok:false, text:NEED_TOOL.hammer};
  const why = tileRemoveWhy(grid, world, a.x, a.z, opts); if (why) return {ok:false, text:why === 'Nothing to remove' ? '' : why};
  const cost = isArmoredAt(world, a.x, a.z) ? {...PIECES.foundation.cost, [ARMOR_ITEM]:1} : PIECES.foundation.cost;
  const full = refund(bag, cost, Bag); if (full) return {ok:false, text:full};
  removeTile(world, a.x, a.z);
  return {ok:true, text:'Foundation removed (' + costText(cost) + ' back)', cost};
}
