// Per-player crafting progression: which items are discovered, researched
// and unlocked. Pure ES module: no DOM, no timers, no randomness.
// Every entry point takes an optional `items` table (defaults to ITEMS) so
// tests can inject fixtures.
import { ITEMS } from './items.js';

const hasOwn = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
const nameOf = (items, id) => (hasOwn(items, id) && items[id].name) || id;
const article = (s) => (/^[aeiou]/i.test(s) ? 'an ' : 'a ') + s;
const joinAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const RESEARCH_TABLE = 'researchtable';

function unlockOf(items, id) {
  const u = hasOwn(items, id) && items[id].unlock;
  return u && typeof u === 'object' ? u : { type: 'start' };
}

/** Kinds present (count > 0) in a counts object, kind array, or Bag-like object. */
function kindsIn(src) {
  if (!src) return [];
  if (typeof src === 'string') return [src];
  if (Array.isArray(src)) return strList(src);
  if (Array.isArray(src.slots)) return src.slots.filter((s) => s && typeof s.kind === 'string' && s.count > 0).map((s) => s.kind);
  if (typeof src === 'object') return Object.keys(src).filter((k) => Number(src[k]) > 0);
  return [];
}

/** Does `has` (Bag, counts object, kind array, predicate or boolean) contain kind? */
function owns(has, kind) {
  if (typeof has === 'function') return !!has(kind);
  if (typeof has === 'boolean') return has;
  if (has && typeof has.count === 'function') return has.count(kind) > 0;
  return kindsIn(has).includes(kind);
}

export class Progression {
  constructor(snapshot = null, { items = ITEMS } = {}) {
    this.items = items;
    const s = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {};
    const known = (k) => hasOwn(items, k);
    this.discovered = new Set(strList(s.discovered).filter(known));
    this.researched = new Set(strList(s.researched).filter(known));
    this.stations = new Set(strList(s.stations).filter(known));
    this.learned = new Set(strList(s.learned).filter(known));
    this._refresh();
  }

  snapshot() {
    const arr = (set) => [...set].sort();
    return { discovered: arr(this.discovered), researched: arr(this.researched), learned: arr(this.learned), stations: arr(this.stations) };
  }

  /** Raw unlock-condition check (ignores sticky `learned`). */
  _met(id) {
    const u = unlockOf(this.items, id);
    if (u.type === 'discover') return strList(u.items).every((k) => this.discovered.has(k));
    if (u.type === 'research') return strList(u.items).every((k) => this.researched.has(k));
    if (u.type === 'station') return this.stations.has(u.station);
    return true;
  }

  /** Learn every newly satisfied non-start item. Returns newly unlocked ids. */
  _refresh() {
    const fresh = [];
    for (const id of Object.keys(this.items)) {
      if (unlockOf(this.items, id).type === 'start' || this.learned.has(id)) continue;
      if (this._met(id)) { this.learned.add(id); fresh.push(id); }
    }
    return fresh;
  }

  noteItems(src) {
    for (const k of kindsIn(src)) if (hasOwn(this.items, k)) this.discovered.add(k);
    return this._refresh();
  }

  notePlaced(stationId) {
    if (!hasOwn(this.items, stationId)) return [];
    this.stations.add(stationId);
    this.discovered.add(stationId);
    return this._refresh();
  }

  /** Research a held kind at a placed Research Table. Never consumes it. */
  research(kind, opts = {}) {
    const has = opts && typeof opts === 'object' && !Array.isArray(opts) && 'has' in opts ? opts.has : opts;
    if (!hasOwn(this.items, kind)) return { ok: false, unlocked: [], reason: 'Unknown item' };
    if (!this.stations.has(RESEARCH_TABLE)) {
      return { ok: false, unlocked: [], reason: `Build ${article(nameOf(this.items, RESEARCH_TABLE))} first` };
    }
    if (!owns(has, kind)) return { ok: false, unlocked: [], reason: `You need ${article(nameOf(this.items, kind))} to research` };
    if (this.researched.has(kind)) return { ok: false, unlocked: [], reason: `${nameOf(this.items, kind)} is already researched` };
    this.discovered.add(kind);
    this.researched.add(kind);
    return { ok: true, unlocked: this._refresh(), reason: '' };
  }

  isUnlocked(id) {
    if (!hasOwn(this.items, id)) return false;
    return this.learned.has(id) || this._met(id);
  }

  /** Requirements still missing for id: [{type, kind}]. */
  missingFor(id) {
    if (this.isUnlocked(id)) return [];
    const u = unlockOf(this.items, id);
    if (u.type === 'station') return [{ type: 'station', kind: u.station }];
    const done = u.type === 'research' ? this.researched : this.discovered;
    return strList(u.items).filter((k) => !done.has(k)).map((kind) => ({ type: u.type, kind }));
  }

  whyLocked(id) {
    if (!hasOwn(this.items, id)) return 'Unknown item';
    const miss = this.missingFor(id);
    if (!miss.length) return '';
    const names = joinAnd(miss.map((m) => nameOf(this.items, m.kind)));
    if (miss[0].type === 'station') return `Build ${article(names)}`;
    if (miss[0].type === 'research') return `Research ${names} at ${article(nameOf(this.items, RESEARCH_TABLE))}`;
    return `Find ${names} first`;
  }

  available() {
    return Object.keys(this.items).filter((id) => this.isUnlocked(id));
  }

  /** Locked ids nearest to unlocking (fewest missing requirements, then table order). */
  nextGoals(n = 3) {
    const ids = Object.keys(this.items);
    return ids
      .filter((id) => !this.isUnlocked(id))
      .map((id, i) => ({ id, i, m: this.missingFor(id).length }))
      .sort((a, b) => a.m - b.m || a.i - b.i)
      .slice(0, Math.max(0, n | 0))
      .map((g) => g.id);
  }

  /** Discovered, unresearched kinds that some locked research item needs. */
  researchable() {
    const need = new Set();
    for (const id of Object.keys(this.items)) {
      const u = unlockOf(this.items, id);
      if (u.type === 'research' && !this.isUnlocked(id)) strList(u.items).forEach((k) => need.add(k));
    }
    return [...this.discovered].filter((k) => need.has(k) && !this.researched.has(k)).sort();
  }
}

const nearHas = (near, station) =>
  !!near && (near instanceof Set ? near.has(station) : Array.isArray(near) ? near.includes(station) : near === station);

function check(bag, id, prog, opts) {
  const items = (opts && opts.items) || (prog && prog.items) || ITEMS;
  const item = hasOwn(items, id) ? items[id] : null;
  const r = item && item.recipe;
  const res = { ok: false, missing: [], locked: false, full: false, reason: '' };
  if (!r || !r.cost) return { ...res, reason: 'Cannot be crafted' };
  if (prog && !prog.isUnlocked(id)) return { ...res, locked: true, reason: prog.whyLocked(id) };
  if (r.station && !nearHas(opts && opts.near, r.station)) return { ...res, reason: `Use ${article(nameOf(items, r.station))}` };
  for (const [kind, need] of Object.entries(r.cost)) {
    const have = bag.count(kind);
    if (have < need) res.missing.push({ kind, count: need - have });
  }
  if (res.missing.length) {
    return { ...res, reason: `Need ${joinAnd(res.missing.map((m) => `${m.count} ${nameOf(items, m.kind)}`))}` };
  }
  const scratch = new bag.constructor(bag.snapshot());
  for (const [kind, need] of Object.entries(r.cost)) scratch.remove(kind, need);
  const meta = item.tool ? { durability: 100 } : {};
  if (scratch.add(id, r.count || 1, meta) > 0) return { ...res, full: true, reason: 'Bag is full' };
  return { ...res, ok: true, scratch };
}

/** @returns {{ok, missing:{kind,count}[], locked, full, reason}} */
export function canCraft(bag, id, prog, opts = {}) {
  const { scratch, ...res } = check(bag, id, prog, opts || {});
  return res;
}

/** Atomic craft: changes nothing unless every step succeeds. */
export function craft(bag, id, prog, opts = {}) {
  const { scratch, ...info } = check(bag, id, prog, opts || {});
  if (!info.ok) {
    const why = info.locked ? 'locked' : info.missing.length ? 'missing' : info.full ? 'full' : 'unavailable';
    return { ...info, ok: false, why };
  }
  const items = (opts && opts.items) || (prog && prog.items) || ITEMS;
  // Commit in place so external references to bag.slots stay valid.
  for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i];
  if (prog) prog.noteItems([id]);
  return { ...info, ok: true, crafted: { kind: id, count: items[id].recipe.count || 1 } };
}

export default Progression;
