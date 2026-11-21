// Unit tests for the Driftwood Game Table (docs/specs/gametable.md §7). Pure rules plus the content module with a fake ctx.
// Run: node --test tests/gametable.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { RECIPES, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const { CONTENT_DECOR, CONTENT_BLOCK_RADIUS } = await import(new URL('content-items.js', base));
const SR = await import(new URL('storage-research.js', base));
const C = await import(new URL('gametable-core.js', base));
const { createGameTable } = await import(new URL('gametable.js', base));
const { GT, keyOf, sqRC, rcSq, newGame, legalMoves, applyMove, outcome, chains, gullMove, applyGameAction, cleanGame, cleanSlice, sliceOf, TEXT } = C;
const read = f => readFileSync(new URL(f, base), 'utf8');

// helpers
const board = (pieces, empty = '.') => { const b = new Array(32).fill(empty); for (const [sq, ch] of Object.entries(pieces)) b[+sq] = ch; return b.join(''); };
const sq = (r, c) => rcSq(r, c);
const game = (b, p = 0, extra = {}) => { const g = { ...newGame(b.length === 9 ? 'n' : 'd', ['host', 'ai'], 0), b, p, ...extra }; g.w = outcome(g); return g; };
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const tableAt = [{ type: 'gametable', x: 1, z: 0 }, { type: 'crate', x: 2, z: 0 }];
const env = (o = {}) => ({ decorAt: (x, z) => (o.decor ?? tableAt).find(d => d.x === x && d.z === z)?.type ?? null, pos: () => o.pos === undefined ? { x: 2, z: 0 } : o.pos, crew: () => o.crew ?? false });
const fresh = () => cleanSlice(undefined);
const act = (st, a, actor = 'host', e = env()) => applyGameAction(st, { x: 1, z: 0, ...a }, actor, e);
const clone = o => JSON.parse(JSON.stringify(o));

// 1
test('recipe, item and decor; research-gated by wood + rope + stone', () => {
  assert.ok(RECIPES.gametable);
  assert.deepEqual({ ...RECIPES.gametable.cost }, { wood: 6, rope: 1, stone: 2 });
  assert.equal(ITEM_INFO.gametable.name, 'Driftwood Game Table');
  assert.ok(CONTENT_DECOR.includes('gametable'));
  assert.equal(CONTENT_BLOCK_RADIUS.gametable, .45);
  assert.ok(!SR.STARTER.includes('gametable'));
  assert.ok(SR.learnedFrom(['wood', 'rope', 'stone']).includes('gametable'));
  assert.ok(!SR.learnedFrom(['wood', 'rope']).includes('gametable'));
  const st = SR.stateFrom({ v: 1, chests: {}, seen: [], learned: [], r: 0 }, 'save', null);
  assert.ok(SR.researchableKinds(st).includes('stone'));
  assert.ok(SR.ingredientKinds().includes('stone'));
});

// 2
test('index helpers and new games', () => {
  for (let i = 0; i < 32; i++) { const [r, c] = sqRC(i); assert.equal((r + c) & 1, 1); assert.equal(rcSq(r, c), i); }
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (((r + c) & 1) === 0) assert.equal(rcSq(r, c), -1);
  assert.equal(rcSq(-1, 0), -1); assert.equal(rcSq(8, 1), -1); assert.equal(rcSq(0, 8), -1);
  const d = newGame('d', ['host', 'ai'], 0);
  assert.equal([...d.b].filter(c => c === 'a').length, 12); assert.equal([...d.b].filter(c => c === 'b').length, 12);
  assert.equal(d.b.slice(0, 12), 'a'.repeat(12)); assert.equal(d.b.slice(20), 'b'.repeat(12));
  assert.equal(d.p, 0); assert.equal(d.n, 0); assert.equal(d.j, -1); assert.equal(d.w, -1); assert.deepEqual(d.last, [-1, -1]);
  const n = newGame('n', ['host', 'guest'], 1, 3);
  assert.equal(n.b, '.........'); assert.equal(n.lv, 1); assert.equal(n.round, 3);
});

// 3
test('draughts: opening, forced capture, direction, kings', () => {
  const g0 = newGame('d', ['host', 'ai'], 0);
  assert.equal(legalMoves(g0).length, 7);
  assert.ok(legalMoves(g0).every(m => m.c === -1 && sqRC(m.t)[0] === 3));
  // capture available filters steps
  const a = sq(2, 1), b = sq(3, 2), land = sq(4, 3);
  const g1 = game(board({ [a]: 'a', [sq(2, 5)]: 'a', [b]: 'b', [sq(7, 0)]: 'b' }));
  const m1 = legalMoves(g1);
  assert.deepEqual(m1, [{ f: a, t: land, c: b }]);
  // plain pieces cannot move or capture backward
  const g2 = game(board({ [sq(4, 3)]: 'a', [sq(3, 2)]: 'b', [sq(7, 6)]: 'b' }));
  const m2 = legalMoves(g2);
  assert.ok(m2.every(m => sqRC(m.t)[0] > 4 && m.c === -1));
  // a king captures backward
  const g3 = game(board({ [sq(4, 3)]: 'A', [sq(3, 2)]: 'b', [sq(7, 6)]: 'b' }));
  assert.deepEqual(legalMoves(g3), [{ f: sq(4, 3), t: sq(2, 1), c: sq(3, 2) }]);
  // pebbles move toward row 0
  const g4 = game(board({ [sq(5, 2)]: 'b', [sq(0, 7)]: 'a' }), 1);
  assert.ok(legalMoves(g4).every(m => sqRC(m.t)[0] === 4));
});

test('draughts: double jump keeps the turn and locks the piece; crowning ends the chain', () => {
  const s0 = sq(1, 0), o1 = sq(2, 1), l1 = sq(3, 2), o2 = sq(4, 3), l2 = sq(5, 4);
  const g = game(board({ [s0]: 'a', [o1]: 'b', [o2]: 'b', [sq(1, 6)]: 'a', [sq(2, 7)]: 'b', [sq(7, 0)]: 'b' }));
  const moves = legalMoves(g);
  assert.ok(moves.some(m => m.f === s0 && m.t === l1));
  const g2 = applyMove(g, moves.find(m => m.f === s0));
  assert.equal(g2.p, 0); assert.equal(g2.j, l1); assert.equal(g2.n, 1); assert.deepEqual(g2.last, [s0, l1]);
  assert.deepEqual(legalMoves(g2), [{ f: l1, t: l2, c: o2 }]); // only the jumping piece
  const g3 = applyMove(g2, legalMoves(g2)[0]);
  assert.equal(g3.j, -1); assert.equal(g3.p, 1); assert.equal(g3.q, 0);
  // crowning mid-chain: a jump onto row 7 ends the turn even when another capture would follow as a king
  const c0 = sq(5, 2), co = sq(6, 3), cl = sq(7, 4), next = sq(6, 5);
  const gc = game(board({ [c0]: 'a', [co]: 'b', [next]: 'b', [sq(0, 1)]: 'b' }));
  const gc2 = applyMove(gc, legalMoves(gc).find(m => m.f === c0 && m.t === cl));
  assert.equal(gc2.b[cl], 'A'); assert.equal(gc2.j, -1); assert.equal(gc2.p, 1);
  assert.equal(chains(gc).find(ch => ch[0].f === c0).length, 1);
});

test('draughts: no pieces / blocked side loses; 40 quiet turns draw; applyMove is pure', () => {
  const g = game(board({ [sq(2, 1)]: 'a', [sq(3, 2)]: 'b' }));
  const after = applyMove(g, legalMoves(g)[0]);
  assert.equal(after.w, 0); assert.equal(outcome(after), 0);
  assert.deepEqual(legalMoves(after), []);
  // blocked: pebble at row 1? use a pebble wedged by two shells it cannot jump
  const blocked = game(board({ [sq(0, 1)]: 'b', [sq(1, 0)]: 'A', [sq(1, 2)]: 'a', [sq(2, 3)]: 'a', [sq(2, 1)]: 'a' }), 0);
  const step = legalMoves(blocked).find(m => m.c === -1 && m.f === sq(2, 3));
  const bl2 = applyMove(blocked, step);
  assert.equal(bl2.p, 1); assert.equal(bl2.w, 0, 'pebble has no move');
  // quiet draw
  let q = game(board({ [sq(0, 1)]: 'A', [sq(7, 6)]: 'B' }), 0, { q: 39 });
  assert.equal(q.w, -1);
  q = applyMove(q, legalMoves(q)[0]);
  assert.equal(q.q, 40); assert.equal(q.w, 2);
  // purity
  const g0 = newGame('d', ['host', 'ai'], 0), snap = clone(g0);
  applyMove(g0, legalMoves(g0)[0]);
  assert.deepEqual(g0, snap);
});

// 4
test('noughts: every line wins, a full board draws, taken cells are illegal', () => {
  const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  for (const L of lines) {
    const b = [...'.........']; for (const i of L) b[i] = 'o';
    assert.equal(outcome(game(b.join(''))), 1, L.join());
    for (const i of L) b[i] = 'x';
    assert.equal(outcome(game(b.join(''))), 0, L.join());
  }
  assert.equal(outcome(game('xoxxoooxx')), 2);
  let g = newGame('n', ['host', 'guest'], 0);
  g = applyMove(g, { f: -1, t: 4, c: -1 });
  assert.equal(g.b[4], 'x'); assert.equal(g.p, 1); assert.deepEqual(g.last, [-1, 4]);
  assert.ok(!legalMoves(g).some(m => m.t === 4));
  const st = fresh(); st.t['1,0'] = { ...g, s: ['host', 'guest'] };
  const r = act(st, { kind: 'gt.move', f: -1, t: 4, n: 1 }, 'guest');
  assert.equal(r.reason, 'illegal');
});

// 5
test('gull: deterministic, captures the biggest chain, avoids hanging a piece, slip path', () => {
  const g0 = newGame('d', ['host', 'ai'], 0);
  const m1 = gullMove(g0, seq(.3, .6), true), m2 = gullMove(g0, seq(.3, .6), true);
  assert.deepEqual(m1, m2);
  // double capture beats a single capture
  const g = game(board({ [sq(1, 0)]: 'a', [sq(2, 1)]: 'b', [sq(4, 3)]: 'b', [sq(1, 4)]: 'a', [sq(2, 5)]: 'b', [sq(7, 0)]: 'b', [sq(7, 2)]: 'b' }));
  const best = gullMove(g, () => .99, true);
  assert.equal(best.length, 2); assert.equal(best[0].f, sq(1, 0));
  // avoid a square that hangs the piece: shell at (2,3); stepping to (3,4) gets jumped by the pebble at (4,5)
  const h = game(board({ [sq(2, 3)]: 'a', [sq(4, 5)]: 'b', [sq(7, 0)]: 'b' }));
  for (const r of [0, .5, .99]) { const mv = gullMove(h, () => r, true); assert.equal(mv[0].t, sq(3, 2)); }
  // easy slip: first rnd < EASY_SLIP -> uniform over the full list (index from the second rnd)
  const all = chains(g0);
  for (let k = 0; k < all.length; k++) assert.deepEqual(gullMove(g0, seq(.1, (k + .5) / all.length), false), all[k]);
  // easy without slip == clever with the same remaining rnd
  assert.deepEqual(gullMove(g0, seq(.9, .2), false), gullMove(g0, seq(.2), true));
  // no move
  assert.deepEqual(gullMove({ ...g0, w: 0 }, Math.random, true), []);
  assert.deepEqual(gullMove(game(board({ [sq(7, 0)]: 'a' })), Math.random, true), []);
});

test('gull noughts: wins before blocking, blocks threats, never loses as clever', () => {
  // gull is 'o' (side 1): o can win at 5, x threatens at 2
  const g = game('xx.oo.x..', 1);
  assert.deepEqual(gullMove(g, () => 0, true), [{ f: -1, t: 5, c: -1 }]);
  assert.equal(gullMove(g, () => .9, false)[0].t, 5); // easy also takes the win
  const blk = game('xx..o....', 1);
  assert.equal(gullMove(blk, () => 0, true)[0].t, 2);
  assert.equal(gullMove(blk, () => .9, false)[0].t, 2);
  // easy: centre, then a free corner
  assert.equal(gullMove(game('x........', 1), () => .9, false)[0].t, 4);
  // exhaustive: every human line vs the clever gull, gull on either side
  let games = 0;
  const play = (gm, aiSide) => {
    if (gm.w !== -1) { games++; assert.notEqual(gm.w, 1 - aiSide, 'gull lost: ' + gm.b); return; }
    if (gm.p === aiSide) { const mv = gullMove(gm, () => .5, true); play(applyMove(gm, mv[0]), aiSide); return; }
    for (const m of legalMoves(gm)) play(applyMove(gm, m), aiSide);
  };
  play(newGame('n', ['host', 'ai'], 1), 1);
  play(newGame('n', ['ai', 'host'], 1), 0);
  assert.ok(games > 100);
});

// 6
test('actions: start, turn, seat, stale, reach, missing, nocrew, busy, bad', () => {
  const st = fresh();
  assert.equal(act(st, { kind: 'gt.start', g: 'd', vs: 'crew' }).reason, 'nocrew');
  assert.equal(act(st, { kind: 'gt.start', g: 'q', vs: 'easy' }).reason, 'bad');
  assert.equal(act(st, { kind: 'gt.start', g: 'd', vs: 'easy', x: 2 }).reason, 'missing');
  assert.equal(act(st, { kind: 'gt.start', g: 'd', vs: 'easy' }, 'host', env({ pos: { x: 9, z: 0 } })).reason, 'reach');
  assert.equal(act(st, { kind: 'gt.start', g: 'd', vs: 'easy' }, 'host', env({ pos: null })).reason, 'reach');
  assert.equal(act(st, { kind: 'gt.start', g: 'd', vs: 'easy', x: 1.5 }).reason, 'bad');
  assert.equal(act(st, { kind: 'gt.start', g: 'd', vs: 'easy', x: 30 }).reason, 'bad');
  assert.equal(act(st, { kind: 'gt.fly', g: 'd' }).reason, 'bad');
  assert.equal(act(st, { kind: 'gt.start', g: 'd', vs: 'easy' }, 'ai').reason, 'bad');
  assert.equal(act(st, { kind: 'gt.move', f: 9, t: 13, n: 0 }).reason, 'bad'); // no game yet
  assert.equal(st.r, 0); assert.deepEqual(st.t, {});
  const ok = act(st, { kind: 'gt.start', g: 'd', vs: 'crew' }, 'host', env({ crew: true }));
  assert.equal(ok.ok, true); assert.equal(ok.text, 'Shells & Pebbles: Shells to move'); assert.equal(st.r, 1);
  assert.deepEqual(st.t['1,0'].s, ['host', 'guest']);
  const crew = env({ crew: true });
  assert.equal(act(st, { kind: 'gt.move', f: 9, t: 13, n: 0 }, 'guest', crew).reason, 'turn');
  assert.equal(act(st, { kind: 'gt.move', f: 9, t: 13, n: 5 }, 'host', crew).reason, 'stale');
  assert.equal(act(st, { kind: 'gt.move', f: 9, t: 20, n: 0 }, 'host', crew).reason, 'illegal');
  assert.equal(act(st, { kind: 'gt.move', f: 9, t: 13, n: 0 }, 'host', crew).ok, true);
  assert.equal(st.r, 2); assert.equal(st.t['1,0'].n, 1);
  // busy: a third party cannot restart while both seated players are here
  const st2 = fresh(); act(st2, { kind: 'gt.start', g: 'n', vs: 'easy' }, 'host');
  assert.equal(act(st2, { kind: 'gt.start', g: 'n', vs: 'easy', n: 0 }, 'guest', crew).reason, 'busy');
  assert.equal(act(st2, { kind: 'gt.resign', n: 0 }, 'guest', crew).reason, 'seat');
  // take the seat: the seated guest left
  const st3 = fresh(); act(st3, { kind: 'gt.start', g: 'd', vs: 'easy' }, 'guest', crew);
  assert.equal(act(st3, { kind: 'gt.start', g: 'd', vs: 'easy', n: 0 }, 'host', crew).reason, 'busy');
  assert.equal(act(st3, { kind: 'gt.start', g: 'd', vs: 'easy', n: 0 }, 'host', env({ crew: false })).ok, true);
  assert.deepEqual(st3.t['1,0'].s, ['host', 'ai']);
  // the seated actor may restart
  assert.equal(act(st3, { kind: 'gt.start', g: 'n', vs: 'clever', n: 0 }, 'host').ok, true);
  assert.equal(st3.t['1,0'].lv, 1); assert.equal(st3.t['1,0'].g, 'n');
  assert.equal(TEXT.reach, 'Step a little closer to the table');
});

test('actions: resign, over, rematch swaps seats, wins tally, refusals change nothing', () => {
  const st = fresh(), crew = env({ crew: true });
  act(st, { kind: 'gt.start', g: 'n', vs: 'crew' }, 'host', crew);
  assert.equal(act(st, { kind: 'gt.rematch', n: 0 }, 'host', crew).reason, 'playing');
  // host x: 0, 1, 2 ; guest o: 3, 4
  const moves = [['host', 0], ['guest', 3], ['host', 1], ['guest', 4]];
  for (const [who, t] of moves) assert.equal(act(st, { kind: 'gt.move', f: -1, t, n: st.t['1,0'].n }, who, crew).ok, true);
  const win = act(st, { kind: 'gt.move', f: -1, t: 2, n: 4 }, 'host', crew);
  assert.deepEqual(win.win, { side: 0, who: 'host' });
  assert.deepEqual(st.wins, { host: 1, guest: 0, ai: 0 });
  assert.equal(act(st, { kind: 'gt.move', f: -1, t: 5, n: 5 }, 'guest', crew).reason, 'over');
  assert.equal(act(st, { kind: 'gt.resign', n: 5 }, 'guest', crew).reason, 'over');
  // refusals change nothing
  const before = clone(st);
  for (const a of [{ kind: 'gt.move', f: -1, t: 5, n: 5 }, { kind: 'gt.resign', n: 5 }, { kind: 'gt.rematch', n: 1 }, { kind: 'gt.start', g: 'z', vs: 'easy', n: 5 }]) act(st, a, 'guest', crew);
  assert.deepEqual(st, before);
  const r0 = st.r;
  assert.equal(act(st, { kind: 'gt.rematch', n: 5 }, 'guest', crew).ok, true);
  assert.equal(st.r, r0 + 1);
  const g = st.t['1,0'];
  assert.deepEqual(g.s, ['guest', 'host']); assert.equal(g.round, 1); assert.equal(g.n, 0); assert.equal(g.p, 0);
  assert.equal(act(st, { kind: 'gt.move', f: -1, t: 4, n: 0 }, 'host', crew).reason, 'turn'); // guest moves first now
  // resign: the other side wins and is tallied
  const res = act(st, { kind: 'gt.resign', n: 0 }, 'host', crew);
  assert.equal(res.ok, true); assert.equal(st.t['1,0'].w, 0); assert.equal(st.t['1,0'].n, 1); assert.deepEqual(st.t['1,0'].last, [-1, -1]);
  assert.deepEqual(st.wins, { host: 1, guest: 1, ai: 0 });
  // a draw adds nothing
  act(st, { kind: 'gt.rematch', n: 1 }, 'host', crew); // host x first
  const draw = [['host', 0], ['guest', 1], ['host', 2], ['guest', 4], ['host', 3], ['guest', 5], ['host', 7], ['guest', 6], ['host', 8]];
  let last;
  for (const [who, t] of draw) last = act(st, { kind: 'gt.move', f: -1, t, n: st.t['1,0'].n }, who, crew);
  assert.equal(st.t['1,0'].w, 2); assert.equal(last.win, undefined);
  assert.deepEqual(st.wins, { host: 1, guest: 1, ai: 0 });
});

test('actions: full cap', () => {
  const st = fresh();
  for (let i = 0; i < GT.MAX_TABLES; i++) st.t[keyOf(i % 20 - 10, Math.floor(i / 20) + 5)] = newGame('n', ['host', 'ai'], 0);
  const r = applyGameAction(st, { kind: 'gt.start', x: 1, z: 0, g: 'd', vs: 'easy' }, 'host', env());
  assert.equal(r.reason, 'full');
});

// 7
test('cleanSlice and cleanGame: garbage in, clean slice out', () => {
  const blank = { v: 1, r: 0, t: {}, wins: { host: 0, guest: 0, ai: 0 } };
  for (const junk of [undefined, null, 5, 'x', [], {}, { v: 2, r: 4 }, { v: 1, t: [] }, { v: 1, r: NaN }, { v: 1, r: -3, wins: 'no' }]) assert.deepEqual(cleanSlice(junk), blank);
  const good = newGame('d', ['host', 'ai'], 0);
  const c = cleanSlice({ v: 1, r: 7, wins: { host: 2, guest: -1, ai: 1.5 }, t: { 'a,b': good, '1,0': good, '99,0': good, '0,-26': good, '01,0': good, '-3,4': good, '2,2': 'x' } });
  assert.equal(c.r, 7); assert.deepEqual(c.wins, { host: 2, guest: 0, ai: 0 });
  assert.deepEqual(Object.keys(c.t).sort(), ['-3,4', '1,0']);
  const bad = [
    { ...good, b: good.b.slice(1) }, { ...good, b: good.b.replace('.', 'z') }, { ...good, g: 'chess' },
    { ...good, b: 'a'.repeat(13) + '.'.repeat(19) }, { ...good, s: ['ai', 'ai'] }, { ...good, s: ['host', 'host'] }, { ...good, s: ['host', 'shark'] }, { ...good, s: ['host'] },
    { ...good, n: NaN }, { ...good, q: 41 }, { ...good, p: 2 }, { ...good, lv: 3 }, { ...good, w: 4 }, { ...good, round: -1 }, { ...good, last: [0] }, { ...good, last: [0, 40] },
    { ...newGame('n', ['host', 'ai'], 0), b: '..........' },
  ];
  for (const b of bad) assert.equal(cleanGame(b), null, JSON.stringify(b));
  assert.equal(cleanGame({ ...good, j: 15 }).j, -1, 'j without a piece');
  assert.equal(cleanGame({ ...good, p: 1, j: 2 }).j, -1, 'j on the wrong side');
  assert.equal(cleanGame({ ...good, j: 2 }).j, 2);
  // a corrupt "playing" board that is actually finished ends cleanly
  assert.equal(cleanGame({ ...newGame('n', ['host', 'ai'], 0), b: 'xxxoo....', p: 1 }).w, 0);
  assert.equal(cleanGame({ ...good, w: 1 }).w, 1); // resigned games keep their result
  // cap and decorAt pruning
  const many = {}; for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) many[keyOf(x, z)] = good;
  assert.equal(Object.keys(cleanSlice({ v: 1, t: many }).t).length, GT.MAX_TABLES);
  const pruned = cleanSlice({ v: 1, t: { '1,0': good, '-3,4': good } }, (x, z) => (x === 1 && z === 0 ? 'gametable' : 'crate'));
  assert.deepEqual(Object.keys(pruned.t), ['1,0']);
  assert.doesNotThrow(() => cleanSlice({ v: 1, t: { get '1,0'() { throw new Error('x'); } } }));
  // JSON round trip
  const st = fresh(); act(st, { kind: 'gt.start', g: 'd', vs: 'easy' }); act(st, { kind: 'gt.move', f: 9, t: 13, n: 0 });
  const s = sliceOf(st);
  assert.deepEqual(cleanSlice(JSON.parse(JSON.stringify(s))), st);
  s.t['1,0'].b = 'x'; assert.notEqual(st.t['1,0'].b, 'x');
});

// 8
function makeCtx(role = 'solo') {
  const raft = new T.Group();
  const world = { tiles: [[0, 0], [1, 0], [2, 0]], decor: [{ type: 'gametable', x: 1, z: 0 }], ext: {} };
  const emits = [], sent = [];
  const ctx = { T, world, role, raft, running: true, physics: { x: 2, z: 0 }, other: null, camera: null, esc: s => String(s).replace(/</g, '&lt;'),
    emit: (e, to) => emits.push({ e, to }), notice() {}, uiOpen: () => false };
  ctx.rebuildRaft = () => { raft.clear(); for (const d of world.decor) { const m = mod.decorModel(d.type); if (m) { m.position.set(d.x * 2, .22, d.z * 2); raft.add(m); } } };
  ctx.action = a => { sent.push(a); if (role !== 'guest') mod.action(a, 'host'); };
  const mod = createGameTable(ctx);
  return { ctx, mod, emits, sent, world, raft };
}

test('module: guest never mutates; net load with the same r is a no-op', () => {
  const { mod, emits } = makeCtx('guest');
  assert.equal(mod.action({ kind: 'kiln.fuel' }, 'host'), false);
  assert.equal(mod.action({ kind: 'gt.start', x: 1, z: 0, g: 'd', vs: 'easy' }, 'host'), true);
  assert.deepEqual(mod.serialize().t, {});
  const data = { v: 1, r: 4, t: { '1,0': newGame('d', ['host', 'ai'], 0) }, wins: { host: 0, guest: 0, ai: 0 } };
  mod.load(data, 'net');
  assert.ok(mod.serialize().t['1,0']);
  mod.load({ v: 1, r: 4, t: {}, wins: {} }, 'net'); // same r: ignored
  assert.ok(mod.serialize().t['1,0']);
  // guest: the AI never moves locally even when it is the gull's turn
  mod.load({ v: 1, r: 5, t: { '1,0': { ...newGame('d', ['ai', 'host'], 0, 1) } }, wins: {} }, 'net');
  for (let i = 0; i < 5; i++) mod.update(1);
  assert.equal(mod.serialize().t['1,0'].n, 0);
  assert.equal(mod.debug.start(1, 0), false); assert.equal(mod.debug.clear(), false);
  mod.load(undefined, 'net');
  assert.deepEqual(mod.serialize().t, {});
  assert.equal(emits.length, 0);
});

test('module: host AI thinks 0.7-1.2 s, prunes removed tables, models and prompt', () => {
  const { mod, emits, world, raft, ctx } = makeCtx('solo');
  mod.load(undefined, 'save');
  assert.strictEqual(mod.serialize(), mod.serialize());
  assert.equal(mod.debug.start(1, 0, 'd', 'easy'), true);
  assert.equal(emits.at(-1).e.text, 'Shells & Pebbles: Shells to move');
  assert.equal(mod.debug.move(1, 0, 9, 13), true);
  assert.equal(mod.serialize().t['1,0'].p, 1);
  mod.update(.5);
  assert.equal(mod.serialize().t['1,0'].n, 1, 'still thinking');
  assert.equal(mod.debug.state().aiKey, '1,0');
  mod.update(.8);
  assert.equal(mod.serialize().t['1,0'].n, 2, 'gull moved');
  assert.equal(mod.serialize().t['1,0'].p, 0);
  // a fresh think window: update(1.3) in one go moves
  mod.debug.move(1, 0, legalMoves(mod.serialize().t['1,0'])[0].f, legalMoves(mod.serialize().t['1,0'])[0].t);
  const n = mod.serialize().t['1,0'].n;
  mod.update(1.3);
  assert.ok(mod.serialize().t['1,0'].n > n);
  // a game the gull wins emits loot to all
  mod.debug.setBoard(1, 0, board({ [sq(4, 3)]: 'b', [sq(3, 2)]: 'a', [sq(7, 0)]: 'b' }), 1);
  mod.update(1.3);
  assert.equal(mod.serialize().t['1,0'].w, 1);
  assert.deepEqual(emits.at(-1), { e: { kind: 'loot', text: 'Pebbles win! Good game' }, to: 'all' });
  assert.equal(mod.serialize().wins.ai, 1);
  // models
  ctx.rebuildRaft();
  const g = raft.children[0];
  assert.equal(g.name, 'game_table');
  let inst = 0; g.traverse(o => { if (o.isInstancedMesh) inst++; });
  assert.equal(inst, 4);
  assert.ok(g.userData.gt.shell && g.userData.gt.pebble && g.userData.gt.knot && g.userData.gt.hoop && g.userData.gt.grid);
  mod.update(.1);
  assert.equal(g.userData.gt.pebble.count, 2); assert.equal(g.userData.gt.shell.count, 0);
  assert.equal(mod.decorModel('crate'), null);
  // prompt: escapes and caches
  ctx.camera = { position: { x: 2, y: 1.8, z: 2 }, getWorldDirection: v => v.set(0, -.3, -1).normalize() };
  const p1 = mod.prompt({ dir: { x: 0, y: -.5, z: -1 } });
  assert.equal(p1, '<kbd>E</kbd>Play at the game table · game over');
  assert.strictEqual(mod.prompt({ dir: { x: 0, y: -.5, z: -1 } }), p1);
  assert.equal(mod.prompt({ dir: { x: 0, y: 0, z: 1 } }), null);
  // pruning after a decor removal
  world.decor.length = 0; mod.update(1.1);
  assert.deepEqual(mod.serialize().t, {});
  mod.dispose();
});

test('module: save load prunes and resumes a gull game', () => {
  const { mod } = makeCtx('host');
  const gm = newGame('n', ['host', 'ai'], 1); const g2 = applyMove(gm, { f: -1, t: 4, c: -1 });
  mod.load({ v: 1, r: 3, t: { '1,0': g2, '2,0': g2 }, wins: { host: 1 } }, 'save');
  assert.deepEqual(Object.keys(mod.serialize().t), ['1,0']);
  mod.update(1.3);
  assert.equal(mod.serialize().t['1,0'].n, 2);
  assert.ok(['0', '2', '6', '8'].includes(String(mod.serialize().t['1,0'].last[1])), 'clever answers a centre opening with a corner');
});

// 9
test('static wiring: sprite, icon, feature list, dialog guards', () => {
  assert.ok(/SPRITES = new Set\([^)]*'gametable'/.test(read('survival-ui.js')));
  assert.ok(read('icons.svg').includes('id="icon-gametable"'));
  const content = read('content.js');
  assert.ok(/FEATURES = \[[^\]]*createGameTable[^\]]*createCookpot\]/.test(content));
  const ui = read('gametable-ui.js');
  assert.ok(ui.includes('stopPropagation') && ui.includes('requestLock'));
  assert.ok(read('craft-book.js').includes("gametable:  { desc: 'A low driftwood table with a board inlay.'"));
});
