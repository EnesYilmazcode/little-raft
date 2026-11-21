// Drying Rack: pure rules (docs/specs/drying-rack.md §3). No imports, no DOM, THREE, Date or Math.random.
// A rack has 4 hooks. A hook is {i:input, t:secs} while drying and {o:output} once done.
// Cosy rules: no fuel, nothing spoils, burns or is lost; a raw item can always be taken back down.

export const RACK = Object.freeze({ HOOKS: 4, DRY_SECS: 150, MAX_DT: 1, REACH: 3.2, MAX_RACKS: 100, RAIN_STOP: .2 });
export const DRY = Object.freeze({
  fish: Object.freeze({ out: 'driedfish', mul: 1 }),
  seaweed: Object.freeze({ out: 'kelpcrisp', mul: .8 }),
  berries: Object.freeze({ out: 'driedberries', mul: .8 }),
  sharkmeat: Object.freeze({ out: 'sharkjerky', mul: 1.5 }),
});
export const INPUTS = Object.freeze(Object.keys(DRY)), OUTPUTS = Object.freeze(INPUTS.map(k => DRY[k].out));
export const RACK_ACTIONS = Object.freeze(['rack.hang', 'rack.take']);
// Names kept here so this file stays import-free (they match items.js / content-items.js).
export const NAMES = Object.freeze({ fish: 'fish', seaweed: 'seaweed', berries: 'berries', sharkmeat: 'shark meat', driedfish: 'Dried Fish', kelpcrisp: 'Kelp Crisps', driedberries: 'Dried Berries', sharkjerky: 'Shark Jerky' });
export const TEXT = Object.freeze({
  bad: 'That didn’t work', missing: 'That spot has no drying rack', reach: 'Step a little closer', nothing: 'You have none to hang',
  full: 'All 4 hooks are full', empty: 'Nothing on the rack', bagfull: 'Your bag is full',
});
export const keyOf = (x, z) => x + ',' + z;
export const secsOf = kind => RACK.DRY_SECS * DRY[kind].mul; // fish 150, seaweed/berries 120, sharkmeat 225 at rate 1

const isInt = Number.isInteger;
const KEY_RE = /^(-?\d{1,2}),(-?\d{1,2})$/;
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Drying speed multiplier: 0 in rain, slower at night, faster in wind. ~.89 calm day, ~1.22 breezy day, ~.27 night. */
export function dryRate(rain, wind, night) {
  const r = fin(rain, 0), w = Math.max(0, Math.min(1, fin(wind, .15))), n = Math.max(0, Math.min(1, fin(night, 0)));
  if (r >= RACK.RAIN_STOP) return 0;
  return (.3 + .7 * (1 - n)) * (.8 + .6 * w);
}
export function rateLabel(rain, wind, night) {
  if (fin(rain, 0) >= RACK.RAIN_STOP) return 'paused (rain)';
  if (fin(night, 0) > .5) return 'slow (night)';
  if (fin(wind, .15) > .45) return 'breezy';
  return 'drying';
}

function cleanHook(h) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return null;
  if (INPUTS.includes(h.i)) {
    const s = secsOf(h.i), t = Number.isFinite(h.t) ? Math.min(s, Math.max(0, h.t)) : 0;
    return t >= s ? { o: DRY[h.i].out } : { i: h.i, t };
  }
  if (OUTPUTS.includes(h.o)) return { o: h.o };
  return null;
}

/** Validate one rack. Returns {h:[hook|null x4]} or null when nothing hangs on it. */
export function cleanEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.h)) return null;
  const h = [null, null, null, null];
  let any = false;
  for (let i = 0; i < RACK.HOOKS && i < raw.h.length; i++) { h[i] = cleanHook(raw.h[i]); if (h[i]) any = true; }
  return any ? { h } : null;
}

/** Validate a world.ext.dryrack slice. decorAt(x,z) (optional) drops tiles that no longer hold a rack. Never throws. */
export function cleanSlice(data, decorAt) {
  const out = { k: {}, r: 0 };
  try {
    const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    out.r = isInt(d.r) && d.r >= 0 && d.r < Number.MAX_SAFE_INTEGER ? d.r : 0;
    const k = d.k && typeof d.k === 'object' && !Array.isArray(d.k) ? d.k : null;
    if (!k) return out;
    let n = 0;
    for (const key of Object.keys(k)) {
      if (n >= RACK.MAX_RACKS) break;
      const m = KEY_RE.exec(key); if (!m) continue;
      const x = +m[1], z = +m[2]; if (Math.abs(x) > 25 || Math.abs(z) > 25) continue;
      if (typeof decorAt === 'function' && decorAt(x, z) !== 'dryrack') continue;
      const e = cleanEntry(k[key]); if (!e) continue;
      out.k[keyOf(x, z)] = e; n++;
    }
  } catch { return { k: {}, r: 0 }; }
  return out;
}

/** JSON-safe deep copy for saves and the network; t rounded to 0.1, empty racks omitted. */
export function sliceOf(st) {
  const k = {};
  for (const key of Object.keys(st.k)) {
    const e = st.k[key]; if (!e || !Array.isArray(e.h)) continue;
    let any = false;
    const h = e.h.map(x => {
      if (!x) return null;
      any = true;
      return x.o ? { o: x.o } : { i: x.i, t: Math.round(x.t * 10) / 10 };
    });
    if (any) k[key] = { h };
  }
  return { v: 1, r: st.r, k };
}

/** 0..1 for one hook (1 when done, 0 for null). */
export function progress(hook) {
  if (!hook) return 0;
  if (hook.o) return 1;
  if (!DRY[hook.i]) return 0;
  const p = hook.t / secsOf(hook.i);
  return p > 1 ? 1 : p < 0 ? 0 : p;
}

/** Step every rack. onDone(key, e) when the last drying hook on a rack finishes. True when a whole percent changed or a hook finished. */
export function stepAll(st, dt, rate, onDone) {
  const d = dt > 0 ? (dt < RACK.MAX_DT ? dt : RACK.MAX_DT) : 0; // NaN -> 0
  const r = rate > 0 ? (rate < 2 ? rate : 2) : 0;
  const add = d * r;
  if (add === 0) return false;
  let changed = false;
  for (const key in st.k) {
    const e = st.k[key]; if (!e || !e.h) continue;
    const h = e.h;
    let finished = false;
    for (let j = 0; j < h.length; j++) {
      const x = h[j]; if (!x || x.o) continue;
      const s = RACK.DRY_SECS * DRY[x.i].mul;
      const before = Math.floor(x.t / s * 100);
      x.t += add;
      if (x.t >= s) { h[j] = { o: DRY[x.i].out }; finished = true; changed = true; }
      else if (Math.floor(x.t / s * 100) !== before) changed = true;
    }
    if (finished && onDone) {
      let left = false;
      for (let j = 0; j < h.length; j++) if (h[j] && !h[j].o) { left = true; break; }
      if (!left) onDone(key, e);
    }
  }
  return changed;
}

const commit = (bag, scratch) => { for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i]; };

/**
 * Apply one 'rack.*' action. a = {kind, x, z, item?}; env = {decorAt(x,z), pos(actor)}.
 * Everything is checked first; a refusal changes nothing; every success bumps st.r.
 * Returns {ok, reason?, text, n?}.
 */
export function applyRackAction(st, a, actor, bag, env) {
  const no = reason => ({ ok: false, reason, text: TEXT[reason] });
  if (!a || typeof a !== 'object' || !RACK_ACTIONS.includes(a.kind)) return no('bad');
  if (!isInt(a.x) || !isInt(a.z) || Math.abs(a.x) > 25 || Math.abs(a.z) > 25) return no('bad');
  if (!bag || !Array.isArray(bag.slots) || (bag.slots.length !== 28 && bag.slots.length !== 40) || typeof bag.count !== 'function') return no('bad');
  if ((env?.decorAt?.(a.x, a.z) ?? null) !== 'dryrack') return no('missing');
  const p = env?.pos?.(actor);
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || Math.hypot(p.x - a.x * 2, p.z - a.z * 2) > RACK.REACH) return no('reach');
  const key = keyOf(a.x, a.z), e = st.k[key] ?? null;

  if (a.kind === 'rack.hang') {
    if (!INPUTS.includes(a.item)) return no('bad');
    if (bag.count(a.item) < 1) return no('nothing');
    const h = e ? e.h : null;
    let free = -1, used = 0;
    if (h) { for (let i = 0; i < RACK.HOOKS; i++) { if (h[i]) used++; else if (free < 0) free = i; } }
    else free = 0;
    if (free < 0) return no('full');
    const scratch = new bag.constructor(bag.snapshot());
    const si = scratch.selectedIndex, sel = Number.isInteger(si) ? scratch.slots[si] : null;
    if (sel && sel.kind === a.item) { sel.count--; if (sel.count <= 0) scratch.slots[si] = null; }
    else if (!scratch.remove(a.item, 1)) return no('nothing');
    commit(bag, scratch);
    const ent = e ?? { h: [null, null, null, null] };
    ent.h[free] = { i: a.item, t: 0 }; st.k[key] = ent; st.r++;
    return { ok: true, text: `Hung up ${NAMES[a.item]} · ${used + 1}/${RACK.HOOKS}`, n: 1 };
  }

  // take: done hooks first; otherwise the drying hooks come back raw (progress lost, nothing consumed)
  if (!e) return no('empty');
  const h = e.h;
  let anyDone = false, anyHung = false;
  for (let i = 0; i < RACK.HOOKS; i++) { if (h[i]) { anyHung = true; if (h[i].o) anyDone = true; } }
  if (!anyHung) return no('empty');
  const scratch = new bag.constructor(bag.snapshot());
  const taken = [];
  for (let i = 0; i < RACK.HOOKS; i++) {
    const x = h[i]; if (!x || (anyDone ? !x.o : !!x.o)) continue;
    const kind = x.o || x.i;
    if (scratch.add(kind, 1) > 0) break;
    taken.push(i);
  }
  if (taken.length === 0) return no('bagfull');
  commit(bag, scratch);
  const first = h[taken[0]].o || h[taken[0]].i;
  let mixed = false;
  for (const i of taken) { if ((h[i].o || h[i].i) !== first) mixed = true; h[i] = null; }
  if (!h.some(Boolean)) delete st.k[key];
  st.r++;
  const n = taken.length;
  return { ok: true, text: mixed ? `+ ${n} snacks` : `+ ${n} ${NAMES[first]}`, n };
}
