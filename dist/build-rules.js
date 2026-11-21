// Little Raft - build placement rules shared by the ghost preview and the host's applyAction.
// Pure ES module: no DOM, no THREE. Tiles are integer [tx, tz] pairs centred on (tx*2, tz*2).

export const WORLD_BOUND = 25;      // |tx| and |tz| must stay within this
export const MAX_TILES = 400;
export const BUILD_REACH = 6;       // metres from the player to the cell centre
export const GUEST_REACH_SLACK = 2; // extra metres the host allows a guest (pose lag)
export const BLOCK_TEXT = Object.freeze({
  bound: 'Raft can’t grow further this way',
  cap: 'Raft can’t grow further this way',
  reach: 'Too far away: step closer',
  overlap: 'Something is in the way',
  edge: 'Needs floor underneath',
  self: 'Too close: step back',
  last: 'You can’t remove your last floor',
  decor: 'Clear what stands on this floor first',
  split: 'That would split the raft in two',
  brother: 'Your brother is in the way',
  nofloor: 'Place it on the raft floor',
  net: 'A collection net hangs there',
});

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const isInt = Number.isInteger;
const hasTile = (tiles, x, z) => tiles.some(t => t[0] === x && t[1] === z);

// Why a floor can't go at (x, z): 'invalid' | 'occupied' | 'detached' | 'bound' | 'cap', or null when it can.
export function floorBlock(tiles, x, z) {
  if (!isInt(x) || !isInt(z)) return 'invalid';
  if (hasTile(tiles, x, z)) return 'occupied';
  if (!NEIGHBOURS.some(([a, b]) => hasTile(tiles, x + a, z + b))) return 'detached';
  if (Math.abs(x) > WORLD_BOUND || Math.abs(z) > WORLD_BOUND) return 'bound';
  if (tiles.length >= MAX_TILES) return 'cap';
  return null;
}

// Why decor can't go at (x, z): 'invalid' | 'nofloor' | 'occupied', or null when it can.
export function decorBlock(tiles, decor, x, z) {
  if (!isInt(x) || !isInt(z)) return 'invalid';
  if (!hasTile(tiles, x, z)) return 'nofloor';
  if (decor.some(d => d.x === x && d.z === z)) return 'occupied';
  return null;
}

// Is cell (x, z) within reach of a player standing at world (px, pz)?
export function inReach(px, pz, x, z, reach = BUILD_REACH) {
  if (!Number.isFinite(px) || !Number.isFinite(pz)) return false;
  return Math.hypot(x * 2 - px, z * 2 - pz) <= reach;
}

const escHtml = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
// Context-prompt HTML while a build tool is held. hover: the placement result ({kind, ok, blocked}) or
// null; held: 'hammer' or a decor kind; name: the decor's display name; cost: 'n item, n item';
// missing: what the floor still needs ('' when affordable). Plain-text inputs are escaped here.
// remove: the display name of what X would remove with the hammer ('' for nothing).
export function placePrompt(hover, held, {name = '', cost = '', missing = '', remove = ''} = {}) {
  const rm = held === 'hammer' && remove ? '<kbd>X</kbd>Remove ' + escHtml(remove) : '';
  if (!hover) return rm;
  if (rm) return placePrompt(hover, held, {name, cost, missing}) + ' · ' + rm;
  const rot = held === 'hammer' ? '' : '<kbd>R</kbd>Rotate';
  if (hover.blocked) return escHtml(BLOCK_TEXT[hover.blocked] ?? '') + (rot && ' · ' + rot);
  if (held === 'hammer') return missing ? 'Floor needs ' + escHtml(missing) : '<kbd>Click</kbd>Build floor · ' + escHtml(cost);
  return hover.ok ? `<kbd>Click</kbd>Place ${escHtml(name)} · ${rot}` : rot;
}
