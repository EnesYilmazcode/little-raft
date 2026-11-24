// Little Raft - taking builds apart: building pieces and foundation tiles, with the hammer (X) or the axe (hold click).
// Pure ES module: no DOM, no THREE. building.js runs these on the host (solo counts as host); the guest only aims.
// Refund: the full build cost back into the actor's bag, all or nothing (a full bag refuses the removal).
import { PIECES } from './building-pieces.js?build=v3-survival-ae77fa84ac2b';
import { BLOCK_TEXT } from './build-rules.js?build=v3-survival-ae77fa84ac2b';
import { floorRemoveBlock } from './placement.js?build=v3-survival-ae77fa84ac2b';
import { removeTile } from './shark.js?build=v3-survival-ae77fa84ac2b';

export const REMOVE_TOOLS = Object.freeze(['hammer', 'axe']);
export const toolOf = a => (a && a.tool === 'axe' ? 'axe' : 'hammer'); // old guests send no tool: hammer
const NEED_TOOL = {hammer:'Craft a hammer first', axe:'You need an axe'};
const costText = c => Object.entries(c).map(([k, n]) => n + ' ' + k).join(' + ');

// Why foundation tile (x, z) can't be removed: '' when it can. grid: the BuildGrid synced to world.
export function tileRemoveWhy(grid, world, x, z) {
  if (!Number.isInteger(x) || !Number.isInteger(z) || !world || !Array.isArray(world.tiles)) return 'Nothing to remove';
  const why = floorRemoveBlock(world.tiles, Array.isArray(world.decor) ? world.decor : [], x, z);
  if (why) return why === 'missing' ? 'Nothing to remove' : BLOCK_TEXT[why] ?? 'Can’t remove that';
  if (Array.isArray(world.nets) && world.nets.some(n => n && n.x === x && n.z === z)) return BLOCK_TEXT.net;
  return grid.canRemoveTile(x, z);
}

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
  const found = grid.find({t:a.t, i:a.i, j:a.j, l:a.l, r:a.r | 0}); if (!found || found.t !== a.t) return {ok:false, text:''}; // refund what is really there
  const why = grid.canRemove(found); if (why) return {ok:false, text:why};
  const full = refund(bag, def.cost, Bag); if (full) return {ok:false, text:full};
  grid.remove(found);
  return {ok:true, text:def.name + ' removed (' + costText(def.cost) + ' back)', cost:def.cost};
}

// Host: a = {kind:'untile', x, z, tool?}. Removes the tile from world (and its HP / armor entries). {ok, text, cost}
export function removeFoundation(grid, a, bag, world, Bag) {
  if (!a || !Number.isInteger(a.x) || !Number.isInteger(a.z)) return {ok:false, text:''};
  const tool = toolOf(a); if (bag.count(tool) < 1) return {ok:false, text:NEED_TOOL[tool]};
  const why = tileRemoveWhy(grid, world, a.x, a.z); if (why) return {ok:false, text:why === 'Nothing to remove' ? '' : why};
  const cost = PIECES.foundation.cost;
  const full = refund(bag, cost, Bag); if (full) return {ok:false, text:full};
  removeTile(world, a.x, a.z);
  return {ok:true, text:'Foundation removed (' + costText(cost) + ' back)', cost};
}
