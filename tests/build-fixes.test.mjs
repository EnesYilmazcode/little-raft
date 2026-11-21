// Regression tests for building fixes BLD-1, BLD-2, BLD-4, BLD-5, BLD-6.
// Run: node --test tests/build-fixes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { createContent } = await import(new URL('content.js', base));
const { decorBlock, pieceBlock, pieceCell, deckPieceAt, inReach, BLOCK_TEXT, PIECE_REACH } = await import(new URL('build-rules.js', base));
const src = f => readFileSync(new URL(f, base), 'utf8');
const quiet = fn => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };

// ---------------------------------------------------------------- BLD-4 content serialize keeps failed slices

test('a module that throws in update keeps its loaded slice in serialize', () => quiet(() => {
  const storage = () => ({ name: 'storage', s: null, load(d) { this.s = d; }, update() { throw new Error('boom'); }, serialize() { return this.s; } });
  const other = () => ({ name: 'other', v: 0, load(d) { this.v = d?.v ?? 0; }, update() { this.v++; }, serialize() { return { v: this.v }; } });
  const c = createContent({}, [storage, other]);
  c.load({ storage: { chests: { '0,-1': [{ kind: 'wood', count: 5 }] } }, other: { v: 1 } }, 'save');
  c.update(.016);
  assert.ok(c.mods[0].dead);
  const out = c.serialize();
  assert.deepEqual(out.storage, { chests: { '0,-1': [{ kind: 'wood', count: 5 }] } });
  assert.deepEqual(out.other, { v: 2 });
}));

test('a module that dies after a save keeps its last serialized slice, not the stale loaded one', () => quiet(() => {
  let fail = false;
  const m = () => ({ name: 'research', n: 0, load(d) { this.n = d?.n ?? 0; }, update() { if (fail) throw new Error('x'); this.n++; }, serialize() { return { n: this.n }; } });
  const c = createContent({}, [m]);
  c.load({ research: { n: 1 } });
  c.update(.016); assert.deepEqual(c.serialize().research, { n: 2 });
  fail = true; c.update(.016);
  assert.deepEqual(c.serialize().research, { n: 2 });
}));

test('a module whose factory throws keeps its saved slice', () => quiet(() => {
  const broken = () => { throw new Error('factory'); };
  const ok = () => ({ name: 'ok', serialize: () => ({ a: 1 }) });
  const c = createContent({}, [broken, ok]);
  c.load({ storage: { chests: { k: [] } }, ok: { a: 0 } });
  assert.deepEqual(c.serialize(), { storage: { chests: { k: [] } }, ok: { a: 1 } });
}));

test('a module that throws in serialize keeps its slice; undefined results keep the old slice', () => quiet(() => {
  const thrower = () => ({ name: 't', serialize() { throw new Error('s'); } });
  const quietMod = () => ({ name: 'q', serialize() { return undefined; } });
  const c = createContent({}, [thrower, quietMod]);
  c.load({ t: { keep: 1 }, q: { keep: 2 } });
  assert.deepEqual(c.serialize(), { t: { keep: 1 }, q: { keep: 2 } });
  const s = c.serialize(); s.t = 'mutated'; assert.deepEqual(c.serialize().t, { keep: 1 }); // callers get a copy
}));

// ---------------------------------------------------------------- BLD-6 pieces vs decor

test('decor is refused on a tile with level-0 stairs', () => {
  const tiles = [[0, 0], [1, 0]], pieces = [{ t: 'stairs', i: 0, j: 0, l: 0, r: 0 }];
  assert.equal(decorBlock(tiles, [], 0, 0, pieces), 'piece');
  assert.equal(decorBlock(tiles, [], 1, 0, pieces), null);
  assert.equal(decorBlock(tiles, [], 0, 0, [{ t: 'stairs', i: 0, j: 0, l: 1, r: 0 }]), null); // upper-level stairs do not touch the deck
  assert.equal(decorBlock(tiles, [], 0, 0, [{ t: 'wall', i: 0, j: 0, l: 0, r: 0 }]), null); // edge pieces leave the cell free
  assert.equal(decorBlock(tiles, [], 0, 0), null); // old callers without pieces
  assert.ok(BLOCK_TEXT.piece && BLOCK_TEXT.decor);
  assert.ok(deckPieceAt(pieces, 0, 0)); assert.ok(!deckPieceAt(null, 0, 0));
});

test('level-0 stairs are refused on a decor tile', () => {
  const decor = [{ type: 'crate', x: 0, z: -1 }];
  assert.equal(pieceBlock(decor, { t: 'stairs', i: 0, j: -1, l: 0, r: 0 }), 'decor');
  assert.equal(pieceBlock(decor, { t: 'stairs', i: 1, j: -1, l: 0, r: 0 }), null);
  assert.equal(pieceBlock(decor, { t: 'stairs', i: 0, j: -1, l: 1, r: 0 }), null);
  assert.equal(pieceBlock(decor, { t: 'wall', i: 0, j: -1, l: 0, r: 0 }), null);
  assert.equal(pieceBlock(decor, { t: 'pillar', i: 0, j: -1, l: 0, r: 0 }), null);
});

test('piece reach uses the piece centre', () => {
  assert.deepEqual(pieceCell({ t: 'stairs', i: 2, j: 3 }), [2, 3]);
  assert.deepEqual(pieceCell({ t: 'pillar', i: 2, j: 3 }), [1.5, 2.5]);
  assert.deepEqual(pieceCell({ t: 'wall', i: 2, j: 3, r: 0 }), [2, 2.5]);
  assert.deepEqual(pieceCell({ t: 'door', i: 2, j: 3, r: 1 }), [1.5, 3]);
  assert.ok(inReach(0, 0, 3, 0, PIECE_REACH)); assert.ok(!inReach(0, 0, 10, 0, PIECE_REACH));
});

test('game.js host checks piece/unpiece reach and decor before building.apply', () => {
  const g = src('game.js');
  const at = g.indexOf("(a.kind === 'piece' || a.kind === 'unpiece') && building"), apply = g.indexOf('building.apply(a, bag, world)', at);
  assert.ok(at > 0 && apply > at);
  const branch = g.slice(at, apply);
  assert.match(branch, /inReach\(who\.x, who\.z, ci, cj, PIECE_REACH \+ \(actor === 'guest' \? GUEST_REACH_SLACK/);
  assert.match(branch, /who && !inReach/); // missing guest pose is tolerated like the floor branch
  assert.match(branch, /pieceBlock\(world\.decor, a\)/);
  assert.match(branch, /emit\(\{kind:'notice', text:BLOCK_TEXT\[why\]\}, actor\)/);
  assert.match(g, /decorBlock\(world\.tiles, world\.decor, a\.x, a\.z, world\.pieces\)/); // host decor branch
  assert.match(g, /why = decorBlock\(world\.tiles, world\.decor, x, z, world\.pieces\)/); // client placementFor
});

// ---------------------------------------------------------------- BLD-1 / BLD-5 game.js guards

test('remove mode (X held) returns before any hammer build, foundation included', () => {
  const g = src('game.js'), fn = g.slice(g.indexOf('function useSelected('), g.indexOf("if (kind === 'fishingrod')", g.indexOf('function useSelected(')));
  const guard = fn.indexOf("if (kind === 'hammer' && building?.removing) return;");
  assert.ok(guard > 0, 'guard present');
  assert.ok(guard < fn.indexOf("building.piece !== 'foundation'"), 'guard precedes the pieces branch');
  assert.ok(guard < fn.indexOf("kind === 'hammer' || DECOR_TYPES.includes(kind)"), 'guard precedes the floor branch');
});

test('the floor ghost/prompt is hidden while the build wheel is open', () => {
  const g = src('game.js');
  assert.match(g, /hover = frameAim && [^\n]*!building\?\.menu\.isOpen \? placementFor/);
});

// ---------------------------------------------------------------- BLD-2 crate/desk dialog keyboard

test('crate/desk dialog: Tab no longer closes, first slot gets focus, arrows navigate', () => {
  const s = src('storage-research-ui.js');
  assert.doesNotMatch(s, /e\.code === 'Tab'/);
  assert.match(s, /e\.code === 'KeyE' && !e\.repeat/);
  assert.match(s, /import \{ arrowNeighbor \} from '\.\/craft-book\.js/);
  assert.match(s, /querySelectorAll\('\[data-chest\],\[data-bag\],\[data-study\]'\)/);
  assert.match(s, /function focusFirst\(\)/);
  const open = s.slice(s.indexOf('function open(type'), s.indexOf('function close()'));
  assert.match(open, /focusFirst\(\)/);
  assert.match(s, /e\.code !== 'Tab' \|\| !isOpen/); // Tab wraps inside the dialog
  assert.match(s, /if \(ctx\.running\) ctx\.requestLock\?\.\(\)/); // closing still relocks
});
