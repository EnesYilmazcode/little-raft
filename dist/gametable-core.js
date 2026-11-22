// Driftwood Game Table rules (docs/specs/gametable.md §2). Pure: no imports, no DOM/THREE/Date/Math.random.
// Two games: draughts "Shells & Pebbles" (32 dark squares) and noughts and crosses "Knots & Hoops" (9 cells),
// a friendly gull AI (deterministic given `rnd`), the host-authoritative action checks and the slice cleaner.

export const GT = Object.freeze({ REACH: 3.2, MAX_TABLES: 100, QUIET_DRAW: 40, EASY_SLIP: .35, THINK_MIN: .7, THINK_MAX: 1.2 });
export const keyOf = (x, z) => x + ',' + z;
export const sqRC = i => [i >> 2, 2 * (i & 3) + (1 - ((i >> 2) & 1))]; // draughts square 0..31 -> [row, col]; dark squares have (r+c) odd
export const rcSq = (r, c) => (r < 0 || r > 7 || c < 0 || c > 7 || ((r + c) & 1) === 0) ? -1 : r * 4 + (c >> 1);

export const KINDS = Object.freeze(['gt.start', 'gt.move', 'gt.resign', 'gt.rematch']);
export const SIDE_NAMES = Object.freeze({ d: Object.freeze(['Shells', 'Pebbles']), n: Object.freeze(['Knots', 'Hoops']) });
export const GAME_NAMES = Object.freeze({ d: 'Shells & Pebbles', n: 'Knots & Hoops' });
export const TEXT = Object.freeze({
  busy: 'A game is under way here', nocrew: 'Your crewmate is not aboard', turn: 'Not your turn yet', illegal: 'That piece can\'t go there',
  over: 'This game is over: press Rematch', seat: 'You are watching this game', playing: 'Finish or resign this game first', stale: 'The board just changed',
  reach: 'Step a little closer to the table', missing: 'That spot has no game table', full: 'Too many game tables', bad: 'That move made no sense',
});
export const startText = g => GAME_NAMES[g] + ': ' + SIDE_NAMES[g][0] + ' to move';
export const resultText = gm => (gm.w === 2 ? 'Calm seas: a draw' : SIDE_NAMES[gm.g][gm.w] + ' win! Good game');

const SEATS = ['host', 'guest', 'ai'];
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const DIRS = [[1, -1], [1, 1], [-1, -1], [-1, 1]];
const isInt = v => typeof v === 'number' && Number.isInteger(v);
const sideOf = ch => (ch === 'a' || ch === 'A' ? 0 : ch === 'b' || ch === 'B' ? 1 : -1);
const isKing = ch => ch === 'A' || ch === 'B';
const other = s => (s === 'host' ? 'guest' : 'host');

export function newGame(g, seats, lv, round = 0) {
  const b = g === 'n' ? '.........' : 'aaaaaaaaaaaa' + '........' + 'bbbbbbbbbbbb';
  return { g: g === 'n' ? 'n' : 'd', b, p: 0, s: [seats[0], seats[1]], lv: lv === 1 ? 1 : 0, j: -1, w: -1, q: 0, n: 0, last: [-1, -1], round };
}

// ---- draughts move generation (ignores gm.w)
function jumpsFrom(b, i, out) {
  const ch = b[i], side = sideOf(ch); if (side < 0) return out;
  const [r, c] = sqRC(i), fwd = side === 0 ? 1 : -1, king = isKing(ch);
  for (const [dr, dc] of DIRS) {
    if (!king && dr !== fwd) continue;
    const over = rcSq(r + dr, c + dc), land = rcSq(r + 2 * dr, c + 2 * dc);
    if (over < 0 || land < 0) continue;
    if (sideOf(b[over]) === 1 - side && b[land] === '.') out.push({ f: i, t: land, c: over });
  }
  return out;
}
function stepsFrom(b, i, out) {
  const ch = b[i], side = sideOf(ch); if (side < 0) return out;
  const [r, c] = sqRC(i), fwd = side === 0 ? 1 : -1, king = isKing(ch);
  for (const [dr, dc] of DIRS) {
    if (!king && dr !== fwd) continue;
    const t = rcSq(r + dr, c + dc);
    if (t >= 0 && b[t] === '.') out.push({ f: i, t, c: -1 });
  }
  return out;
}
function draughtsMoves(gm) {
  const b = gm.b, out = [];
  if (gm.j >= 0) return jumpsFrom(b, gm.j, out);
  for (let i = 0; i < 32; i++) if (sideOf(b[i]) === gm.p) jumpsFrom(b, i, out);
  if (out.length) return out;
  for (let i = 0; i < 32; i++) if (sideOf(b[i]) === gm.p) stepsFrom(b, i, out);
  return out;
}
function movesOf(gm) {
  if (gm.g === 'n') { const out = []; if (lineWinner(gm.b) >= 0) return out; for (let i = 0; i < 9; i++) if (gm.b[i] === '.') out.push({ f: -1, t: i, c: -1 }); return out; }
  return draughtsMoves(gm);
}
function lineWinner(b) {
  for (const [a, c, d] of LINES) if (b[a] !== '.' && b[a] === b[c] && b[a] === b[d]) return b[a] === 'x' ? 0 : 1;
  return -1;
}

export function legalMoves(gm) { return gm && gm.w === -1 ? movesOf(gm) : []; }

export function outcome(gm) {
  if (gm.g === 'n') {
    const lw = lineWinner(gm.b); if (lw >= 0) return lw;
    return gm.b.includes('.') ? -1 : 2;
  }
  let has = false;
  for (let i = 0; i < 32; i++) if (sideOf(gm.b[i]) === gm.p) { has = true; break; }
  if (!has || draughtsMoves(gm).length === 0) return 1 - gm.p;
  return gm.q >= GT.QUIET_DRAW ? 2 : -1;
}

export function applyMove(gm, m) {
  const next = { ...gm, s: [gm.s[0], gm.s[1]], last: [m.f, m.t] };
  if (gm.g === 'n') {
    next.b = gm.b.slice(0, m.t) + (gm.p === 0 ? 'x' : 'o') + gm.b.slice(m.t + 1);
    next.p = 1 - gm.p; next.j = -1;
  } else {
    const b = gm.b.split('');
    let ch = b[m.f]; b[m.f] = '.';
    if (m.c >= 0) b[m.c] = '.';
    const row = m.t >> 2; let crowned = false;
    if (ch === 'a' && row === 7) { ch = 'A'; crowned = true; } else if (ch === 'b' && row === 0) { ch = 'B'; crowned = true; }
    b[m.t] = ch;
    next.b = b.join('');
    let again = false;
    if (m.c >= 0 && !crowned) again = jumpsFrom(next.b, m.t, []).length > 0;
    if (again) next.j = m.t;
    else { next.j = -1; next.p = 1 - gm.p; }
    if (m.c >= 0 || crowned) next.q = 0; else if (!again) next.q = gm.q + 1;
  }
  next.n = gm.n + 1;
  next.w = -1;
  next.w = outcome(next);
  return next;
}

// Every full draughts turn as a list of hops (DFS over jump chains). Noughts: each placement as a one-hop chain.
export function chains(gm) {
  const out = [];
  if (!gm || gm.w !== -1) return out;
  const walk = (g, prefix) => {
    for (const m of movesOf(g)) {
      const path = prefix.concat([m]);
      if (g.g === 'd' && m.c >= 0) {
        const nx = applyMove(g, m);
        if (nx.j >= 0 && nx.w === -1) { walk(nx, path); continue; }
      }
      out.push(path);
    }
  };
  walk(gm, []);
  return out;
}

function scoreChain(gm, ch) {
  let g = gm, s = 0;
  const startCh = gm.b[ch[0].f], side = gm.p;
  for (const h of ch) { if (h.c >= 0) s += 10; g = applyMove(g, h); }
  const end = ch[ch.length - 1].t, endCh = g.b[end];
  if (!isKing(startCh) && isKing(endCh)) s += 6;
  if (g.w === -1 && g.p !== side && movesOf(g).some(m => m.c >= 0)) s -= 8;
  const [r0] = sqRC(ch[0].f), [r1, c1] = sqRC(end);
  if ((c1 >= 2 && c1 <= 5) || (side === 0 ? r1 > r0 : r1 < r0)) s += 1;
  return s;
}
function bestChain(gm, list, rnd) {
  let best = -Infinity; const tied = [];
  for (const ch of list) {
    const s = scoreChain(gm, ch);
    if (s > best) { best = s; tied.length = 0; tied.push(ch); } else if (s === best) tied.push(ch);
  }
  return tied[Math.min(tied.length - 1, Math.floor(rnd() * tied.length))];
}

// Noughts minimax with a module memo (pure; scores are from the side to move, win sooner = better).
const memo = new Map();
function nValue(b) {
  const hit = memo.get(b); if (hit !== undefined) return hit;
  let filled = 0; for (let i = 0; i < 9; i++) if (b[i] !== '.') filled++;
  let v;
  if (lineWinner(b) >= 0) v = -(20 - filled); // the previous mover just won
  else if (filled === 9) v = 0;
  else {
    const mark = filled % 2 === 0 ? 'x' : 'o';
    v = -Infinity;
    for (let i = 0; i < 9; i++) if (b[i] === '.') { const c = -nValue(b.slice(0, i) + mark + b.slice(i + 1)); if (c > v) v = c; }
  }
  memo.set(b, v);
  return v;
}
function winningCell(b, mark) {
  for (let i = 0; i < 9; i++) if (b[i] === '.') { const nb = b.slice(0, i) + mark + b.slice(i + 1); if (lineWinner(nb) >= 0) return i; }
  return -1;
}
function noughtsMove(gm, rnd, clever) {
  const b = gm.b, mine = gm.p === 0 ? 'x' : 'o', theirs = gm.p === 0 ? 'o' : 'x';
  const free = []; for (let i = 0; i < 9; i++) if (b[i] === '.') free.push(i);
  if (!free.length) return -1;
  const pick = list => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
  if (clever) {
    let best = -Infinity; const tied = [];
    for (const i of free) {
      const v = -nValue(b.slice(0, i) + mine + b.slice(i + 1));
      if (v > best) { best = v; tied.length = 0; tied.push(i); } else if (v === best) tied.push(i);
    }
    return pick(tied);
  }
  const win = winningCell(b, mine); if (win >= 0) return win;
  if (rnd() < GT.EASY_SLIP) return pick(free);
  const block = winningCell(b, theirs); if (block >= 0) return block;
  if (b[4] === '.') return 4;
  const corners = [0, 2, 6, 8].filter(i => b[i] === '.');
  if (corners.length) return pick(corners);
  return free[0];
}

export function gullMove(gm, rnd, clever) {
  if (!gm || gm.w !== -1) return [];
  if (gm.g === 'n') { const t = noughtsMove(gm, rnd, clever); return t < 0 ? [] : [{ f: -1, t, c: -1 }]; }
  const list = chains(gm); if (!list.length) return [];
  if (!clever && rnd() < GT.EASY_SLIP) return list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
  return bestChain(gm, list, rnd);
}

/** Bump the win tally for a game that just ended with a winner. Returns {side, who} or null. */
export function tally(st, gm) {
  if (gm.w !== 0 && gm.w !== 1) return null;
  const who = gm.s[gm.w];
  st.wins[who] = (st.wins[who] | 0) + 1;
  return { side: gm.w, who };
}

const no = reason => ({ ok: false, reason, text: TEXT[reason] });

export function applyGameAction(st, a, actor, env) {
  if (!a || typeof a !== 'object' || !KINDS.includes(a.kind) || !Number.isFinite(a.x) || !Number.isFinite(a.z) || Math.abs(a.x) > 25 || Math.abs(a.z) > 25 || (actor !== 'host' && actor !== 'guest')) return no('bad');
  if (!st || typeof st !== 'object' || !st.t || !st.wins) return no('bad');
  if (env.decorAt(a.x, a.z) !== 'gametable') return no('missing');
  const p = env.pos(actor);
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || Math.hypot(p.x - 2 * a.x, p.z - 2 * a.z) > GT.REACH) return no('reach');
  const key = keyOf(a.x, a.z), gm = Object.prototype.hasOwnProperty.call(st.t, key) ? st.t[key] : null;
  if (gm && a.n !== gm.n) return no('stale');
  const crew = !!env.crew?.();
  let next, text = '';
  if (a.kind === 'gt.start') {
    if (a.g !== 'd' && a.g !== 'n') return no('bad');
    if (a.vs !== 'crew' && a.vs !== 'easy' && a.vs !== 'clever') return no('bad');
    if (gm && gm.w === -1 && !gm.s.includes(actor) && !gm.s.some(s => s !== actor && s !== 'ai' && !crew)) return no('busy');
    if (a.vs === 'crew' && !crew) return no('nocrew');
    if (!gm && Object.keys(st.t).length >= GT.MAX_TABLES) return no('full');
    next = newGame(a.g, [actor, a.vs === 'crew' ? other(actor) : 'ai'], a.vs === 'clever' ? 1 : 0, 0);
    text = startText(a.g);
  } else {
    if (!gm) return no('bad');
    if (a.kind === 'gt.move') {
      if (gm.w !== -1) return no('over');
      if (gm.s[gm.p] !== actor) return no('turn');
      const m = isInt(a.f) && isInt(a.t) ? legalMoves(gm).find(x => x.f === a.f && x.t === a.t) : null;
      if (!m) return no('illegal');
      next = applyMove(gm, m);
    } else if (a.kind === 'gt.resign') {
      if (gm.w !== -1) return no('over');
      const side = gm.s.indexOf(actor); if (side < 0) return no('seat');
      next = { ...gm, s: [gm.s[0], gm.s[1]], last: [gm.last[0], gm.last[1]], w: 1 - side, n: gm.n + 1 };
      text = 'You shook hands: good game';
    } else { // gt.rematch
      if (gm.w === -1) return no('playing');
      next = newGame(gm.g, [gm.s[1], gm.s[0]], gm.lv, Math.min(1e6, gm.round + 1));
      text = startText(gm.g);
    }
  }
  st.t[key] = next;
  st.r++;
  const res = { ok: true, text, over: next.w };
  if (gm && gm.w === -1 && next.w !== -1) { const win = tally(st, next); if (win) res.win = win; } // this action ended the game
  return res;
}

// ---- save / net cleaning
const CHARS = { d: /^[.aAbB]{32}$/, n: /^[.xo]{9}$/ };
const intIn = (v, lo, hi) => isInt(v) && v >= lo && v <= hi;
export function cleanGame(raw) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const g = raw.g; if (g !== 'd' && g !== 'n') return null;
    const b = raw.b; if (typeof b !== 'string' || !CHARS[g].test(b)) return null;
    if (g === 'd') { let na = 0, nb = 0; for (let i = 0; i < 32; i++) { const s = sideOf(b[i]); if (s === 0) na++; else if (s === 1) nb++; } if (na > 12 || nb > 12) return null; }
    else { let nx = 0, no = 0; for (let i = 0; i < 9; i++) { if (b[i] === 'x') nx++; else if (b[i] === 'o') no++; } if (nx - no !== 0 && nx - no !== 1) return null; if (raw.p !== nx - no) return null; } // Knots move first; keeps marks <= 5 each (model capacity)
    const s = raw.s;
    if (!Array.isArray(s) || s.length !== 2 || !SEATS.includes(s[0]) || !SEATS.includes(s[1]) || s[0] === s[1] || (s[0] === 'ai' && s[1] === 'ai')) return null;
    if (!intIn(raw.lv, 0, 1) || !intIn(raw.p, 0, 1) || !intIn(raw.w, -1, 2) || !intIn(raw.q, 0, GT.QUIET_DRAW) || !intIn(raw.n, 0, 1e6) || !intIn(raw.round, 0, 1e6)) return null;
    const last = raw.last; if (!Array.isArray(last) || last.length !== 2 || !intIn(last[0], -1, 31) || !intIn(last[1], -1, 31)) return null;
    let j = intIn(raw.j, -1, 31) ? raw.j : -1;
    if (g === 'n' || (j >= 0 && (sideOf(b[j]) !== raw.p || !jumpsFrom(b, j, []).length))) j = -1; // a chain piece with no jump left would lose on the spot
    const gm = { g, b, p: raw.p, s: [s[0], s[1]], lv: raw.lv, j, w: raw.w, q: raw.q, n: raw.n, last: [last[0], last[1]], round: raw.round };
    if (gm.w === -1) gm.w = outcome(gm);
    return gm;
  } catch { return null; }
}
const KEY_RE = /^(-?\d{1,2}(?:\.\d{1,3})?),(-?\d{1,2}(?:\.\d{1,3})?)$/; // free placement: fractional decor spots
const blankSlice = () => ({ v: 1, r: 0, t: {}, wins: { host: 0, guest: 0, ai: 0 } });
const count = v => (isInt(v) && v >= 0 ? v : 0);
export function cleanSlice(data, decorAt) {
  const out = blankSlice();
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1) return out;
    out.r = count(data.r);
    const w = data.wins;
    if (w && typeof w === 'object' && !Array.isArray(w)) for (const k of SEATS) out.wins[k] = count(w[k]);
    const t = data.t;
    if (t && typeof t === 'object' && !Array.isArray(t)) {
      let n = 0;
      for (const key of Object.keys(t)) {
        if (n >= GT.MAX_TABLES) break;
        const m = KEY_RE.exec(key); if (!m) continue;
        const x = +m[1], z = +m[2];
        if (Math.abs(x) > 25 || Math.abs(z) > 25 || keyOf(x, z) !== key) continue;
        if (decorAt && decorAt(x, z) !== 'gametable') continue;
        let gm = null; try { gm = cleanGame(t[key]); } catch { gm = null; }
        if (!gm) continue;
        out.t[key] = gm; n++;
      }
    }
  } catch { /* keep what was cleaned so far */ }
  return out;
}
export const sliceOf = st => JSON.parse(JSON.stringify({ v: 1, r: st.r, t: st.t, wins: st.wins }));
