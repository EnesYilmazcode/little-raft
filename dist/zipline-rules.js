// Zipline rules (docs/specs/zipline.md). Pure: no THREE, no DOM. Raft-local coordinates: cell (i,j) is
// centred at (2i, 2j); the deck walk surface is y = FLOOR_Y, an upper floor at level l is FLOOR_Y + l*LEVEL_H.
// Slice: world.ext.zipline = {v:1, rev, posts:[{id,i,j,l}], lines:[[a,b]]} (a < b, post ids).
import { LEVEL_H } from './building-pieces.js?build=v3-survival-ae77fa84ac2b';

export const ZIP = Object.freeze({
  MAX_POSTS: 16, MAX_LINES: 12, MAX_PER_POST: 2, SPAN_MIN: 2, SPAN_MAX: 14, POST_H: 2.0, LEVEL_H, FLOOR_Y: .2,
  SAG_K: .04, HANG: .3, SPEED: 4, DOWN_BONUS: 1.2, SPEED_MAX: 5.2, REACH: 2.2, PLACE_REACH: 6, START_S: .5,
  EYE: 1.6, FOOT_CLEAR: .05, MAX_IJ: 27, MAX_L: 5, MAX_REV: 1e9,
});

export const ZIP_TEXT = Object.freeze({
  full: 'Sixteen posts is plenty', taken: 'A post already stands here', nosupport: 'Posts need a deck tile or a floor',
  decor: 'Clear this tile first', linked: 'These two are already linked', busy: 'A post holds two lines',
  lines: 'Twelve lines is plenty', short: 'Too close for a line', long: 'Too far for one rope',
  blocked: 'Something is in the way', norope: 'You need Rope', nopost: 'Build a Zipline Post first',
  missing: 'That post is gone', same: 'Pick a different post',
});

const isInt = v => Number.isInteger(v);
export const blankZip = () => ({ v: 1, rev: 0, posts: [], lines: [] });

/** Validated copy of a slice. Never throws; anything odd becomes the defaults. */
export function cleanZip(d) {
  const out = blankZip();
  try {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return out;
    out.rev = isInt(d.rev) && d.rev >= 0 && d.rev <= ZIP.MAX_REV ? d.rev : 0;
    const ids = new Set(), cells = new Set();
    if (Array.isArray(d.posts)) for (const p of d.posts) {
      if (out.posts.length >= ZIP.MAX_POSTS) break;
      if (!p || typeof p !== 'object') continue;
      const { id, i, j, l } = p;
      if (!isInt(id) || id < 1 || id > 1e6 || !isInt(i) || !isInt(j) || Math.abs(i) > ZIP.MAX_IJ || Math.abs(j) > ZIP.MAX_IJ) continue;
      if (!isInt(l) || l < 0 || l > ZIP.MAX_L) continue;
      const c = i + ',' + j + ',' + l;
      if (ids.has(id) || cells.has(c)) continue;
      ids.add(id); cells.add(c); out.posts.push({ id, i, j, l });
    }
    const pairs = new Set(), per = new Map();
    if (Array.isArray(d.lines)) for (const ln of d.lines) {
      if (out.lines.length >= ZIP.MAX_LINES) break;
      if (!Array.isArray(ln) || ln.length !== 2) continue;
      const [x, y] = ln;
      if (!isInt(x) || !isInt(y) || x === y || !ids.has(x) || !ids.has(y)) continue;
      const a = Math.min(x, y), b = Math.max(x, y), k = a + ':' + b;
      if (pairs.has(k) || (per.get(a) ?? 0) >= ZIP.MAX_PER_POST || (per.get(b) ?? 0) >= ZIP.MAX_PER_POST) continue;
      pairs.add(k); per.set(a, (per.get(a) ?? 0) + 1); per.set(b, (per.get(b) ?? 0) + 1);
      out.lines.push([a, b]);
    }
  } catch { return blankZip(); }
  return out;
}

export const bumpZip = s => { s.rev = s.rev >= ZIP.MAX_REV ? 1 : s.rev + 1; };
export function nextId(state) { let m = 0; for (const p of state.posts) if (p.id > m) m = p.id; return m + 1; }
export const postById = (state, id) => { for (const p of state.posts) if (p.id === id) return p; return null; };
export const linesOf = (state, id) => { let n = 0; for (const l of state.lines) if (l[0] === id || l[1] === id) n++; return n; };
export const hasLine = (state, a, b) => { const x = Math.min(a, b), y = Math.max(a, b); return state.lines.some(l => l[0] === x && l[1] === y); };

const hasTile = (world, i, j) => Array.isArray(world?.tiles) && world.tiles.some(t => Array.isArray(t) && t[0] === i && t[1] === j);
const hasFloor = (pieces, i, j, l) => Array.isArray(pieces) && pieces.some(p => p && p.t === 'floor' && p.i === i && p.j === j && p.l === l);
const decorOn = (world, i, j) => Array.isArray(world?.decor) && world.decor.some(d => d && d.x === i && d.z === j && d.type !== 'net');

/** A walk surface exists under (i,j,l): a deck tile at l=0, a floor piece at l>=1. */
export function supported(world, i, j, l) {
  return l === 0 ? hasTile(world, i, j) : l >= 1 && l <= ZIP.MAX_L && hasFloor(world?.pieces, i, j, l);
}

/** '' or a reason key for a new post at (i,j,l). */
export function canPost(state, world, i, j, l) {
  if (state.posts.length >= ZIP.MAX_POSTS) return 'full';
  if (state.posts.some(p => p.i === i && p.j === j && p.l === l)) return 'taken';
  if (!isInt(i) || !isInt(j) || !isInt(l) || Math.abs(i) > ZIP.MAX_IJ || Math.abs(j) > ZIP.MAX_IJ || !supported(world, i, j, l)) return 'nosupport';
  if (l === 0 && decorOn(world, i, j)) return 'decor';
  return '';
}

/** Raft-local top of a post (the rope's anchor). */
export function topOf(p, out = {}) {
  out.x = 2 * p.i; out.y = ZIP.FLOOR_Y + p.l * ZIP.LEVEL_H + ZIP.POST_H; out.z = 2 * p.j;
  return out;
}
const _A = {}, _B = {}, _P = {};
export const span = (A, B) => Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z);

/** Parabolic sag: the drawn rope and the ride share this exact curve. */
export function ropePoint(A, B, t, out = {}) {
  const S = ZIP.SAG_K * span(A, B);
  out.x = A.x + (B.x - A.x) * t; out.z = A.z + (B.z - A.z) * t;
  out.y = A.y + (B.y - A.y) * t - 4 * S * t * (1 - t);
  return out;
}
export function linePoints(A, B, n = 24) {
  const pts = [];
  for (let k = 0; k <= n; k++) pts.push(ropePoint(A, B, k / n, {}));
  return pts;
}

/** True if a floor/roof slab at level >= 1 crosses the rider's body somewhere along the line. */
export function lineBlocked(pieces, A, B, skip = null) {
  if (!Array.isArray(pieces) || !pieces.length) return false;
  for (let k = 1; k <= 9; k++) {
    const q = ropePoint(A, B, k / 10, _P), ci = Math.round(q.x / 2), cj = Math.round(q.z / 2);
    for (const p of pieces) {
      if (!p || (p.t !== 'floor' && p.t !== 'roof') || p.i !== ci || p.j !== cj || !(p.l >= 1)) continue;
      if (skip && skip.some(s => s.i === p.i && s.j === p.j && s.l === p.l)) continue;
      const h = ZIP.FLOOR_Y + p.l * ZIP.LEVEL_H;
      if (q.y - 2.0 < h && h < q.y + .1) return true;
    }
  }
  return false;
}

/** '' or a reason key for a line between posts a and b. */
export function canLink(state, pieces, a, b) {
  const A = postById(state, a), B = postById(state, b);
  if (!A || !B) return 'missing';
  if (a === b) return 'same';
  if (hasLine(state, a, b)) return 'linked';
  if (linesOf(state, a) >= ZIP.MAX_PER_POST || linesOf(state, b) >= ZIP.MAX_PER_POST) return 'busy';
  if (state.lines.length >= ZIP.MAX_LINES) return 'lines';
  const ta = topOf(A, _A), tb = topOf(B, _B);
  if (Math.hypot(tb.x - ta.x, tb.z - ta.z) < ZIP.SPAN_MIN - 1e-9) return 'short';
  if (span(ta, tb) > ZIP.SPAN_MAX) return 'long';
  if (lineBlocked(pieces, ta, tb, [A, B])) return 'blocked';
  return '';
}

/**
 * Advance r = {t, dir} along the line A->B by dt seconds. Returns '' | 'end' (t clamped to 0/1) | 'bad'.
 * Speed is SPEED m/s plus a downhill bonus (capped); uphill never drops below SPEED, so nobody gets stuck.
 */
export function rideStep(r, A, B, dt) {
  if (!r || !Number.isFinite(r.t) || !Number.isFinite(dt) || (r.dir !== 1 && r.dir !== -1)) return 'bad';
  const dxz = Math.hypot(B.x - A.x, B.z - A.z), dyA = B.y - A.y, S = ZIP.SAG_K * span(A, B);
  const dy = dyA + S * 4 * (2 * r.t - 1), arc = Math.hypot(dxz, dy);
  if (!Number.isFinite(arc) || arc < 1e-6) return 'bad';
  const slope = r.dir * dy / arc; // vertical rise per metre travelled
  const v = Math.min(ZIP.SPEED_MAX, ZIP.SPEED + ZIP.DOWN_BONUS * Math.max(0, -slope));
  r.t += r.dir * v * dt / arc;
  if (!Number.isFinite(r.t)) return 'bad';
  if (r.t >= 1) { r.t = 1; return 'end'; }
  if (r.t <= 0) { r.t = 0; return 'end'; }
  return '';
}

/**
 * Rider eye height (raft-local) at (x,z) under rope height ropeY. Hangs HANG below the rope, but the feet
 * never go below the walk surface under them (the deck plane, or a floor slab below the rope) plus a small
 * clearance. Build note: a long level line sags up to ~.56 m, which put the feet .46 m into the deck.
 */
export function riderEye(pieces, x, z, ropeY) {
  let surf = ZIP.FLOOR_Y;
  if (Array.isArray(pieces) && pieces.length) {
    const ci = Math.round(x / 2), cj = Math.round(z / 2);
    for (const p of pieces) {
      if (!p || p.t !== 'floor' || p.i !== ci || p.j !== cj || !(p.l >= 1)) continue;
      const h = ZIP.FLOOR_Y + p.l * ZIP.LEVEL_H;
      if (h < ropeY && h > surf) surf = h;
    }
  }
  return Math.max(ropeY - ZIP.HANG, surf + ZIP.EYE + ZIP.FOOT_CLEAR);
}

/** Where to set the rider down beside `post` after riding in direction (dirX, dirZ). Raft-local {x, z, footY}. */
export function landSpot(world, post, dirX, dirZ, out = {}, state = null) {
  const { i, j, l } = post;
  out.footY = ZIP.FLOOR_Y + l * ZIP.LEVEL_H;
  const len = Math.hypot(dirX, dirZ) || 1, ux = dirX / len, uz = dirZ / len;
  const cand = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => ({ a, b, d: a * ux + b * uz })).sort((p, q) => q.d - p.d);
  for (const c of cand) {
    const a = i + c.a, b = j + c.b;
    if (!supported(world, a, b, l)) continue;
    if (l === 0 && decorOn(world, a, b)) continue;
    if (state && state.posts.some(p => p.i === a && p.j === b && p.l === l)) continue; // never land inside another post
    out.x = 2 * a; out.z = 2 * b; return out;
  }
  out.x = 2 * i - ux * .7; out.z = 2 * j - uz * .7;
  return out;
}

/** Drop posts that lost their surface, then lines touching them. Returns the removed counts. */
export function prune(state, world) {
  const before = state.posts.length;
  state.posts = state.posts.filter(p => supported(world, p.i, p.j, p.l));
  const live = new Set(state.posts.map(p => p.id)), nl = state.lines.length;
  state.lines = state.lines.filter(([a, b]) => live.has(a) && live.has(b));
  return { posts: before - state.posts.length, lines: nl - state.lines.length };
}

/** Host rules for the four zipline actions. Mutates state and bag. Returns {ok, text}. */
export function applyZip(state, a, bag, world) {
  const k = a?.kind, fail = r => ({ ok: false, text: ZIP_TEXT[r] ?? '' });
  if (k === 'zipline.post') {
    if (!bag || bag.count('zippost') < 1) return fail('nopost');
    const { i, j, l } = a; if (!isInt(i) || !isInt(j) || !isInt(l)) return fail('nosupport');
    const r = canPost(state, world, i, j, l); if (r) return fail(r);
    if (!bag.remove('zippost', 1)) return fail('nopost');
    state.posts.push({ id: nextId(state), i, j, l }); bumpZip(state);
    return { ok: true, text: state.posts.length === 1 ? 'Post up. Build a second one, then tie Rope between them' : 'Post up' };
  }
  if (k === 'zipline.link') {
    if (!bag || bag.count('rope') < 1) return fail('norope');
    const r = canLink(state, world?.pieces, a.a, a.b); if (r) return fail(r);
    if (!bag.remove('rope', 1)) return fail('norope');
    state.lines.push([Math.min(a.a, a.b), Math.max(a.a, a.b)]); bumpZip(state);
    return { ok: true, text: 'Line tied. Press E by a post to ride' };
  }
  if (k === 'zipline.unlink') {
    if (!isInt(a.a) || !isInt(a.b) || !hasLine(state, a.a, a.b)) return fail('');
    const x = Math.min(a.a, a.b), y = Math.max(a.a, a.b);
    state.lines = state.lines.filter(l => !(l[0] === x && l[1] === y)); bumpZip(state);
    bag?.add('rope', 1);
    return { ok: true, text: 'Line untied' };
  }
  if (k === 'zipline.remove') {
    if (!postById(state, a.id)) return fail('');
    const n = linesOf(state, a.id);
    state.posts = state.posts.filter(p => p.id !== a.id);
    state.lines = state.lines.filter(l => l[0] !== a.id && l[1] !== a.id); bumpZip(state);
    bag?.add('zippost', 1); if (n) bag?.add('rope', n);
    return { ok: true, text: 'Post picked up' };
  }
  return null;
}
