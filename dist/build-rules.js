// Little Raft - build placement rules shared by the ghost preview and the host's applyAction.
// Pure ES module: no DOM, no THREE. Tiles are integer [tx, tz] pairs centred on (tx*2, tz*2).

export const WORLD_BOUND = 25;      // |tx| and |tz| must stay within this
export const MAX_TILES = 400;
export const BUILD_REACH = 6;       // metres from the player to the cell centre
export const GUEST_REACH_SLACK = 2; // extra metres the host allows a guest (pose lag)
export const PIECE_REACH = 8;       // metres to a building piece's centre: building.js aims a 7 m ray, plus half a piece
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
  trapedge: 'Fish traps hang on an edge tile, next to open water', // [fishtrap]
  piece: 'A building piece is in the way',
});
// Building pieces that fill a deck cell (stairs/ladder at level 0; floor/roof only sit higher up, but count them too).
const CELL_PIECES = ['floor', 'stairs', 'roof', 'ladder'];

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

// Is there a level-0 cell piece (stairs, ladder) standing on deck cell (x, z)?
export function deckPieceAt(pieces, x, z) {
  return Array.isArray(pieces) && pieces.some(p => p && p.l === 0 && p.i === x && p.j === z && CELL_PIECES.includes(p.t));
}

// Why decor can't go at (x, z): 'invalid' | 'nofloor' | 'occupied' | 'piece', or null when it can.
export function decorBlock(tiles, decor, x, z, pieces) {
  if (!isInt(x) || !isInt(z)) return 'invalid';
  if (!hasTile(tiles, x, z)) return 'nofloor';
  if (decor.some(d => d.x === x && d.z === z)) return 'occupied';
  if (deckPieceAt(pieces, x, z)) return 'piece';
  return null;
}

// Why a building piece can't go at deck level: 'decor' when a level-0 cell piece would land on a decor tile, else null.
export function pieceBlock(decor, p) {
  if (!p || p.l !== 0 || !CELL_PIECES.includes(p.t)) return null;
  return Array.isArray(decor) && decor.some(d => d.x === p.i && d.z === p.j) ? 'decor' : null;
}

// World XZ centre of a piece record {t, i, j, l, r} (edges sit on a cell side, pillars on a corner), in cell units for inReach.
export function pieceCell(p) {
  if (p.t === 'pillar') return [p.i - .5, p.j - .5];
  if (p.t === 'wall' || p.t === 'halfwall' || p.t === 'window' || p.t === 'door') return p.r ? [p.i - .5, p.j] : [p.i, p.j - .5];
  return [p.i, p.j];
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
