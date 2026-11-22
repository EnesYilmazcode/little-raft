// Seaside Kiln: pure rules (docs/specs/kiln.md §4). No imports, no DOM, THREE, Date or Math.random.
// A kiln entry fires a queue of batches of one input kind into a tray of one output kind.
// Cozy rules: nothing burns, spoils or is lost; an idle kiln never uses wood.

export const KILN = Object.freeze({ QUEUE: 6, TRAY: 10, FUEL_MAX: 8, PER_WOOD: 2, MAX_DT: 1, REACH: 3.2, MAX_KILNS: 100 });
export const SMELT = Object.freeze({
  metalore: Object.freeze({ out: 'metalingot', need: 2, secs: 18 }),
  sand: Object.freeze({ out: 'glass', need: 2, secs: 12 }),
  clay: Object.freeze({ out: 'brick', need: 1, secs: 10 }),
});
export const INPUTS = Object.freeze(['metalore', 'sand', 'clay']), OUTPUTS = Object.freeze(['metalingot', 'glass', 'brick']);
export const KILN_ACTIONS = Object.freeze(['kiln.load', 'kiln.fuel', 'kiln.take']);
export const keyOf = (x, z) => x + ',' + z;
// Names kept here so this file stays import-free (they match content-items.js / inventory-state.js).
export const NAMES = Object.freeze({ metalore: 'metal ore', sand: 'sand', clay: 'clay', metalingot: 'Metal Ingot', glass: 'Glass', brick: 'Brick' });
export const TEXT = Object.freeze({
  reach: 'Step a little closer', missing: 'That spot has no kiln', kind: 'The kiln is busy with something else. Collect or wait first',
  full: 'The kiln is full', nowood: 'You need wood for the fire', fuelfull: 'The firebox is full', empty: 'Nothing ready yet',
  bagfull: 'Your bag is full', bad: 'That does not work here', nothing: 'Need more',
});

const isInt = Number.isInteger;
const intIn = (v, lo, hi) => isInt(v) && v >= lo && v <= hi;
const KEY_RE = /^(-?\d{1,2}(?:\.\d{1,3})?),(-?\d{1,2}(?:\.\d{1,3})?)$/; // free placement: fractional decor spots

export function blank() { return { r: null, q: 0, t: 0, h: 0, f: 0, o: null, n: 0 }; }
const idle = e => e.q === 0 && e.f === 0 && e.n === 0;

/** Validate one entry. Returns a fresh entry, or null when invalid or idle and empty. */
export function cleanEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const e = blank();
  e.r = INPUTS.includes(raw.r) ? raw.r : null;
  e.q = intIn(raw.q, 0, KILN.QUEUE) ? raw.q : 0;
  if (e.q === 0 || e.r === null) { e.q = 0; e.r = null; }
  e.h = raw.h === 1 && e.q > 0 ? 1 : 0;
  const secs = e.r ? SMELT[e.r].secs : 0;
  e.t = e.h === 1 && Number.isFinite(raw.t) ? Math.min(secs, Math.max(0, raw.t)) : 0;
  e.f = intIn(raw.f, 0, KILN.FUEL_MAX) ? raw.f : 0;
  if (OUTPUTS.includes(raw.o) && intIn(raw.n, 1, KILN.TRAY)) { e.o = raw.o; e.n = raw.n; }
  if (e.q > 0 && e.o !== null && e.o !== SMELT[e.r].out) e.q = 0; // corrupt: keep the tray
  e.q = Math.min(e.q, KILN.TRAY - e.n);
  if (e.q === 0) { e.r = null; e.t = 0; e.h = 0; }
  return idle(e) ? null : e;
}

/** Validate a world.ext.kiln slice. decorAt(x,z) (optional) drops tiles that no longer hold a kiln. Never throws. */
export function cleanSlice(data, decorAt) {
  const out = { k: {}, r: 0 };
  try {
    const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    out.r = isInt(d.r) && d.r >= 0 && d.r < Number.MAX_SAFE_INTEGER ? d.r : 0;
    const k = d.k && typeof d.k === 'object' && !Array.isArray(d.k) ? d.k : null;
    if (!k) return out;
    let n = 0;
    for (const key of Object.keys(k)) {
      if (n >= KILN.MAX_KILNS) break;
      const m = KEY_RE.exec(key); if (!m) continue;
      const x = +m[1], z = +m[2]; if (Math.abs(x) > 25 || Math.abs(z) > 25) continue;
      if (typeof decorAt === 'function' && decorAt(x, z) !== 'kiln') continue;
      const e = cleanEntry(k[key]); if (!e) continue;
      out.k[keyOf(x, z)] = e; n++;
    }
  } catch { return { k: {}, r: 0 }; }
  return out;
}

/** JSON-safe deep copy for saves and the network. */
export function sliceOf(st) {
  const k = {};
  for (const key of Object.keys(st.k)) {
    const e = st.k[key]; if (!e || idle(e)) continue;
    k[key] = { r: e.r, q: e.q, t: Math.round(e.t * 10) / 10, h: e.h, f: e.f, o: e.o, n: e.n };
  }
  return { v: 1, r: st.r, k };
}

/** null when `input` can be queued now, else 'kind' or 'full'. */
export function canLoad(e, input) {
  const x = e || blank(), s = SMELT[input]; if (!s) return 'kind';
  if ((x.q > 0 && x.r !== input) || (x.n > 0 && x.o !== s.out)) return 'kind';
  if (x.q >= KILN.QUEUE || x.q + x.n + 1 > KILN.TRAY) return 'full';
  return null;
}

/** Add one wood worth of fuel. Mutates; true if it fit. */
export function addFuel(e) {
  if (e.f + KILN.PER_WOOD > KILN.FUEL_MAX) return false;
  e.f += KILN.PER_WOOD; return true;
}

/** Advance one entry by dt seconds. Returns batches finished (0|1). No allocations. */
export function step(e, dt) {
  const d = dt > 0 ? (dt < KILN.MAX_DT ? dt : KILN.MAX_DT) : 0; // NaN -> 0
  if (e.q > 0 && e.h === 0 && e.f > 0) { e.f--; e.h = 1; } // the only place fuel is spent
  if (e.h !== 1 || e.r === null) return 0;
  e.t += d;
  const s = SMELT[e.r];
  if (e.t < s.secs) return 0;
  e.t = 0; e.h = 0; e.q--; e.o = s.out; e.n++;
  if (e.q === 0) e.r = null;
  return 1;
}

/** Step every kiln. onDone(key, e) when a queue empties. True if anything visible changed. */
export function stepAll(st, dt, onDone) {
  let changed = false;
  for (const key in st.k) {
    const e = st.k[key]; if (!e || e.q === 0) continue;
    const h0 = e.h, t0 = Math.round(e.t * 10);
    const done = step(e, dt);
    if (done || e.h !== h0 || Math.round(e.t * 10) !== t0) changed = true;
    if (done && e.q === 0 && onDone) onDone(key, e);
  }
  return changed;
}

export const burning = e => !!e && e.h === 1;
export function progress(e) {
  if (!e || e.q === 0 || !e.r) return 0;
  const p = e.t / SMELT[e.r].secs;
  return p > 1 ? 1 : p < 0 ? 0 : p;
}

const commit = (bag, scratch) => { for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i]; };

/**
 * Apply one 'kiln.*' action. a = {kind, x, z, item?}; env = {decorAt(x,z), pos(actor)}.
 * Everything is checked first; a refusal changes nothing; every success bumps st.r.
 * Returns {ok, reason?, text, n?}.
 */
export function applyKilnAction(st, a, actor, bag, env) {
  const no = reason => ({ ok: false, reason, text: TEXT[reason] });
  if (!a || typeof a !== 'object' || !KILN_ACTIONS.includes(a.kind)) return no('bad');
  if (!Number.isFinite(a.x) || !Number.isFinite(a.z) || Math.abs(a.x) > 25 || Math.abs(a.z) > 25) return no('bad');
  if (!bag || !Array.isArray(bag.slots) || bag.slots.length !== 28 || typeof bag.count !== 'function') return no('bad');
  if ((env?.decorAt?.(a.x, a.z) ?? null) !== 'kiln') return no('missing');
  const p = env?.pos?.(actor);
  if (p && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.hypot(p.x - a.x * 2, p.z - a.z * 2) > KILN.REACH) return no('reach');
  const key = keyOf(a.x, a.z), e = st.k[key] ?? blank();
  const verb = a.kind.slice(5);

  if (verb === 'load') {
    const s = SMELT[a.item]; if (!s || !INPUTS.includes(a.item)) return no('bad');
    const have = bag.count(a.item);
    if (have < s.need) return { ok: false, reason: 'nothing', text: `Need ${s.need - have} more ${NAMES[a.item]}` };
    const why = canLoad(e, a.item); if (why) return no(why);
    const scratch = new bag.constructor(bag.snapshot());
    if (!scratch.remove(a.item, s.need)) return { ok: false, reason: 'nothing', text: `Need ${s.need} more ${NAMES[a.item]}` };
    commit(bag, scratch);
    e.q++; e.r = a.item; st.k[key] = e; st.r++;
    return { ok: true, text: `Loaded ${s.need} ${NAMES[a.item]} · ${e.q} in the kiln`, n: s.need };
  }
  if (verb === 'fuel') {
    if (bag.count('wood') < 1) return no('nowood');
    if (e.f + KILN.PER_WOOD > KILN.FUEL_MAX) return no('fuelfull');
    const i = bag.selectedIndex, sel = bag.slots[i];
    if (sel && sel.kind === 'wood') { sel.count--; if (sel.count <= 0) bag.slots[i] = null; }
    else if (!bag.remove('wood', 1)) return no('nowood');
    addFuel(e); st.k[key] = e; st.r++;
    return { ok: true, text: `Fire stoked · ${e.f} batches of fuel`, n: 1 };
  }
  // take
  if (e.n === 0 || !e.o) return no('empty');
  const scratch = new bag.constructor(bag.snapshot());
  const left = scratch.add(e.o, e.n), moved = e.n - left;
  if (moved <= 0) return no('bagfull');
  commit(bag, scratch);
  const kind = e.o;
  e.n -= moved; if (e.n === 0) e.o = null;
  if (idle(e)) delete st.k[key]; else st.k[key] = e;
  st.r++;
  return { ok: true, text: `+ ${moved} ${NAMES[kind]}`, n: moved };
}
