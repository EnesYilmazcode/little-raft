// Kelp Line rules (see docs/specs/kelp.md sections 3-4). Pure: no DOM, no THREE, no clocks, no Math.random.
// A float line hung off a raft edge tile grows seaweed in 3 stages (Bare, Leafy, Lush) and stays Lush until
// harvested with E. Cozy: the line never breaks, rots or drifts; a line that floor later closes in freezes.
// Slice: world.ext.kelpline = {v:1, s, r, t:{"x,z": g}}, g = growth points 1..LUSH_AT (missing key = Bare).
import { isEdgeTile, openSide, tileKey } from './fish-trap.js?build=v3-survival-ae77fa84ac2b';

export { isEdgeTile, openSide, tileKey };
export const GROW_PTS = 4, SUN_PTS = 5, LEAFY_AT = 240, LUSH_AT = 720, YIELD = 2, TRAP_BONUS = 1, MAX_TICK = 60;
export const REACH = 2.6, HOST_SLACK = 2, OVERHANG = 1.2, MAX_LINES = 400;
export const STAGES = Object.freeze(['Bare', 'Leafy', 'Lush']);
export const TEXT = Object.freeze({ notarget: 'Nothing to harvest', notripe: 'Still growing', full: 'Your bag is full' });
export const OLD_HOST = 'Your friend’s raft doesn’t have kelp lines yet';
export const NOT_EDGE = 'Kelp line: it needs open water beside it';
const SIDES = [[0, 1], [1, 0], [0, -1], [-1, 0]];

const KEY_RE = /^-?\d+,-?\d+$/;
const isInt = Number.isInteger;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
export const isKey = k => typeof k === 'string' && k.length <= 24 && KEY_RE.test(k) && (() => { const [x, z] = k.split(',').map(Number); return tileKey(x, z) === k; })();

export const stageOf = g => (g >= LUSH_AT ? 2 : g >= LEAFY_AT ? 1 : 0);

/** The kelpline decor entry on tile (x, z), or null. */
export const lineAt = (decor, x, z) => { if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'kelpline' && d.x === x && d.z === z) return d; return null; };

function lineList(decor) { // kelpline decor in decor order, one per tile
  const out = [], seen = new Set();
  if (Array.isArray(decor)) for (const d of decor) {
    if (!d || d.type !== 'kelpline' || !isInt(d.x) || !isInt(d.z)) continue;
    const k = tileKey(d.x, d.z); if (seen.has(k)) continue;
    seen.add(k); out.push({ k, x: d.x, z: d.z });
  }
  return out;
}

/** Validated slice. Junk -> defaults; bad keys and values dropped or clamped; tiles without a line pruned. */
export function cleanKelp(v, decor) {
  const out = { v: 1, s: '', r: 0, t: {} };
  if (!isObj(v)) return out;
  if (typeof v.s === 'string' && v.s.length <= 32) out.s = v.s;
  if (isInt(v.r) && v.r >= 0) out.r = v.r;
  const t = isObj(v.t) ? v.t : {};
  const lines = new Set(lineList(decor).map(e => e.k));
  let n = 0;
  for (const k of Object.keys(t)) {
    if (n >= MAX_LINES) break;
    if (!isKey(k) || !lines.has(k)) continue;
    const g = t[k];
    if (typeof g !== 'number' || !Number.isFinite(g)) continue;
    const c = Math.min(LUSH_AT, Math.max(0, Math.floor(g)));
    if (c <= 0) continue;
    out.t[k] = c; n++;
  }
  return out;
}

const tileSet = tiles => { const s = new Set(); if (Array.isArray(tiles)) for (const t of tiles) if (t) s.add(tileKey(t[0], t[1])); return s; };
const edgeIn = (set, x, z) => set.has(tileKey(x, z)) && SIDES.some(([dx, dz]) => !set.has(tileKey(x + dx, z + dz)));

/** Host tick: whole seconds (dt floored, clamped 0..MAX_TICK), lines in decor order. Bumps st.r only on a stage
 *  change or a prune. Returns {ripe: keys that just reached Lush, grew: any g changed}. */
export function tickKelp(st, tiles, decor, dt, sunny = false) {
  const ripe = [];
  const list = lineList(decor), keys = new Set(list.map(e => e.k));
  let bump = false, grew = false;
  for (const k of Object.keys(st.t)) if (!keys.has(k)) { delete st.t[k]; bump = true; grew = true; } // line gone: prune
  const n = typeof dt === 'number' && Number.isFinite(dt) ? Math.min(MAX_TICK, Math.max(0, Math.floor(dt))) : 0;
  if (n > 0 && list.length) {
    const set = tileSet(tiles), pts = n * (sunny ? SUN_PTS : GROW_PTS);
    let count = Object.keys(st.t).length;
    for (const { k, x, z } of list) {
      if (!edgeIn(set, x, z)) continue; // closed in by floor: frozen, never lost
      const g = st.t[k] ?? 0;
      if (g >= LUSH_AT) continue;
      if (!(k in st.t)) { if (count >= MAX_LINES) continue; count++; }
      const ng = Math.min(LUSH_AT, g + pts);
      st.t[k] = ng; grew = true;
      if (stageOf(ng) !== stageOf(g)) { bump = true; if (ng >= LUSH_AT) ripe.push(k); }
    }
  }
  if (bump) st.r++;
  return { ripe, grew };
}

/** A fishtrap decor within one tile (Chebyshev, not the same tile). */
export function trapNear(decor, x, z) {
  if (Array.isArray(decor)) for (const d of decor) {
    if (!d || d.type !== 'fishtrap' || !isInt(d.x) || !isInt(d.z)) continue;
    const dx = Math.abs(d.x - x), dz = Math.abs(d.z - z);
    if (Math.max(dx, dz) <= 1 && (dx || dz)) return true;
  }
  return false;
}
export const yieldFor = (decor, x, z) => YIELD + (trapNear(decor, x, z) ? TRAP_BONUS : 0);

/** {g, stage, pct, edge, bonus} for the line on that tile, or null. */
export function kelpInfo(st, tiles, decor, x, z) {
  if (!lineAt(decor, x, z)) return null;
  const g = st.t[tileKey(x, z)] ?? 0, stage = stageOf(g);
  return { g, stage, pct: stage === 2 ? 100 : Math.min(99, Math.floor(g / LUSH_AT * 100)), edge: isEdgeTile(tiles, x, z), bonus: trapNear(decor, x, z) };
}

/** All or nothing: every strand fits in the bag, or nothing changes and the line stays Lush. */
export function harvest(st, decor, key, bag) {
  if (!isKey(key)) return { ok: false, reason: 'notarget', text: TEXT.notarget };
  const [x, z] = key.split(',').map(Number);
  if (!lineAt(decor, x, z)) return { ok: false, reason: 'notarget', text: TEXT.notarget };
  if (stageOf(st.t[key] ?? 0) < 2) return { ok: false, reason: 'notripe', text: TEXT.notripe };
  if (!bag || typeof bag.snapshot !== 'function') return { ok: false, reason: 'full', text: TEXT.full };
  const n = yieldFor(decor, x, z), s = new bag.constructor(bag.snapshot());
  if (s.add('seaweed', n) !== 0) return { ok: false, reason: 'full', text: TEXT.full };
  for (let i = 0; i < s.slots.length; i++) bag.slots[i] = s.slots[i];
  if (typeof bag.version === 'number') bag.version++;
  delete st.t[key];
  return { ok: true, n, text: `+ ${n} seaweed from the kelp line` };
}
