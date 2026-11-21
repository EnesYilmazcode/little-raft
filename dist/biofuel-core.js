// Biofuel Refiner + Fuel Tank: pure rules (docs/specs/biofuel.md §4). No imports, no DOM, THREE, Date or Math.random.
// A refiner turns organic scraps into Biofuel Jugs (30 s each, no fire); a fuel tank stores jugs and tops up the
// running Little Motors next to it. Cozy rules: nothing spoils, nothing is wasted, a refusal changes nothing.
// Slice world.ext.biofuel = { v:1, r, s, f: {"x,z": {q, t, n}}, k: {"x,z": jugs} }.

export const BIO = Object.freeze({ QUEUE: 6, TRAY: 4, SECS: 30, TANK: 8, MAX_DT: 1, REACH: 3.2, MAX_REFINERS: 100, MAX_TANKS: 64, RANGE: 1, JUG_SEC: 150 });
const MOTOR_CAP = 300; // = ENGINE.FUEL_CAP (engine.js), literal so this file stays import-free
// Items per jug. Cooked food, cups and meals are not listed, so they are refused.
export const ORGANIC = Object.freeze({ leaf: 3, seaweed: 2, seed: 3, berries: 2, coconut: 1, fish: 1, sharkmeat: 1 });
export const BIO_ACTIONS = Object.freeze(['bio.load', 'bio.take', 'bio.fill', 'bio.empty']);
export const keyOf = (x, z) => x + ',' + z;
export const NAMES = Object.freeze({ leaf: 'leaf', seaweed: 'seaweed', seed: 'seed', berries: 'berries', coconut: 'coconut', fish: 'fish', sharkmeat: 'shark meat', biofuel: 'Biofuel Jug' });
export const TEXT = Object.freeze({
  reach: 'Step a little closer', missing: 'That spot has no refiner', notank: 'That spot has no fuel tank',
  refuse: 'That does not go in the refiner', full: 'The refiner is full', empty: 'Nothing ready yet', bagfull: 'Your bag is full',
  nojug: 'Hold a Biofuel Jug', tankfull: 'The tank is full', tankempty: 'The tank is empty', bad: 'That does not work here',
});

const isInt = Number.isInteger;
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const clampInt = (v, lo, hi) => (isInt(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const KEY_RE = /^(-?\d{1,2}),(-?\d{1,2})$/;
const plainObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const jugs = n => n + (n === 1 ? ' jug' : ' jugs');

export const idle = e => !e || (e.q === 0 && e.n === 0);
export const blank = () => ({ q: 0, t: 0, n: 0 });

function cleanRefiner(raw) {
  if (!plainObj(raw)) return null;
  const e = { q: clampInt(raw.q, 0, BIO.QUEUE), t: 0, n: clampInt(raw.n, 0, BIO.TRAY) };
  if (e.q > 0 && typeof raw.t === 'number' && Number.isFinite(raw.t)) e.t = Math.min(BIO.SECS, Math.max(0, raw.t));
  return idle(e) ? null : e;
}

/** Validate a world.ext.biofuel slice. decorAt(x,z) (optional) drops tiles without the matching decor. Never throws. */
export function cleanSlice(data, decorAt) {
  const out = { v: 1, r: 0, s: '', f: {}, k: {} };
  try {
    const d = plainObj(data) ? data : {};
    out.r = isInt(d.r) && d.r >= 0 && d.r < Number.MAX_SAFE_INTEGER ? d.r : 0;
    out.s = typeof d.s === 'string' && d.s.length <= 12 ? d.s : '';
    const each = (src, max, type, fn) => {
      if (!plainObj(src)) return;
      const keys = Object.keys(src).sort();
      let n = 0;
      for (const key of keys) {
        if (n >= max) break;
        const m = KEY_RE.exec(key); if (!m) continue;
        const x = +m[1], z = +m[2]; if (Math.abs(x) > 25 || Math.abs(z) > 25 || keyOf(x, z) !== key) continue; // canonical keys only
        if (typeof decorAt === 'function' && decorAt(x, z) !== type) continue;
        if (fn(keyOf(x, z), src[key])) n++;
      }
    };
    each(d.f, BIO.MAX_REFINERS, 'refiner', (key, raw) => { const e = cleanRefiner(raw); if (e) out.f[key] = e; return !!e; });
    each(d.k, BIO.MAX_TANKS, 'fueltank', (key, raw) => { if (!isInt(raw) || raw < 1) return false; out.k[key] = Math.min(BIO.TANK, raw); return true; });
  } catch { return { v: 1, r: 0, s: '', f: {}, k: {} }; }
  return out;
}

/** JSON-safe deep copy for saves and the network (idle refiners and empty tanks omitted). */
export function sliceOf(st) {
  const f = {}, k = {};
  for (const key of Object.keys(st.f)) { const e = st.f[key]; if (!idle(e)) f[key] = { q: e.q, t: Math.round(e.t * 10) / 10, n: e.n }; }
  for (const key of Object.keys(st.k)) if (st.k[key] > 0) k[key] = st.k[key];
  return { v: 1, r: st.r, s: st.s, f, k };
}

/** Advance one refiner by dt seconds. True if q/n changed. A full tray waits (nothing lost). No allocations. */
export function step(e, dt) {
  const d = dt > 0 ? (dt < BIO.MAX_DT ? dt : BIO.MAX_DT) : 0; // NaN -> 0
  if (e.q <= 0 || e.n >= BIO.TRAY) return false;
  e.t += d;
  if (e.t < BIO.SECS) return false;
  e.q--; e.n++; e.t -= BIO.SECS;
  if (e.q === 0) e.t = 0;
  return true;
}

/** Step every refiner. True when anything visible changed (a jug finished, or a whole second of progress). */
export function stepAll(st, dt) {
  let changed = false;
  for (const key in st.f) {
    const e = st.f[key]; if (!e || e.q === 0) continue;
    const s0 = Math.floor(e.t);
    if (step(e, dt) || Math.floor(e.t) !== s0) changed = true;
  }
  return changed;
}

export function progress(e) {
  if (!e || e.q === 0) return 0;
  const p = e.t / BIO.SECS;
  return p > 1 ? 1 : p < 0 ? 0 : p;
}

const commit = (bag, scratch) => {
  for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i];
  if (typeof bag.version === 'number') bag.version++;
};

/**
 * Apply one 'bio.*' action. a = {kind, x, z, item?}; env = {decorAt(x,z), pos(actor)}.
 * Everything is checked first on a scratch copy of the bag; a refusal changes nothing; every success bumps st.r.
 * Returns {ok, reason?, text, n?}.
 */
export function applyBioAction(st, a, actor, bag, env) {
  const no = reason => ({ ok: false, reason, text: TEXT[reason] });
  if (!a || typeof a !== 'object' || !BIO_ACTIONS.includes(a.kind)) return no('bad');
  if (!isInt(a.x) || !isInt(a.z) || Math.abs(a.x) > 25 || Math.abs(a.z) > 25) return no('bad');
  if (!bag || !Array.isArray(bag.slots) || bag.slots.length !== 28 || typeof bag.count !== 'function' || typeof bag.snapshot !== 'function') return no('bad');
  const verb = a.kind.slice(4), refiner = verb === 'load' || verb === 'take';
  if ((env?.decorAt?.(a.x, a.z) ?? null) !== (refiner ? 'refiner' : 'fueltank')) return no(refiner ? 'missing' : 'notank');
  const p = env?.pos?.(actor);
  if (p && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.hypot(p.x - a.x * 2, p.z - a.z * 2) > BIO.REACH) return no('reach');
  const key = keyOf(a.x, a.z);
  let scratch;
  try { scratch = new bag.constructor(bag.snapshot()); } catch { return no('bad'); }

  if (verb === 'load') {
    if (!own(ORGANIC, a.item)) return no('refuse');
    const need = ORGANIC[a.item], have = bag.count(a.item);
    if (have < need) return { ok: false, reason: 'nothing', text: `Need ${need - have} more ${NAMES[a.item]}` };
    const e = st.f[key] ?? blank();
    if (e.q >= BIO.QUEUE) return no('full');
    if (!scratch.remove(a.item, need)) return { ok: false, reason: 'nothing', text: `Need ${need} more ${NAMES[a.item]}` };
    commit(bag, scratch);
    e.q++; st.f[key] = e; st.r++;
    return { ok: true, text: `Loaded ${need} ${NAMES[a.item]} · ${jugs(e.q)} queued`, n: need };
  }
  if (verb === 'take') {
    const e = st.f[key];
    if (!e || e.n <= 0) return no('empty');
    if (scratch.add('biofuel', e.n) !== 0) return no('bagfull');
    commit(bag, scratch);
    const moved = e.n; e.n = 0;
    if (idle(e)) delete st.f[key];
    st.r++;
    return { ok: true, text: `+ ${moved} Biofuel Jug`, n: moved };
  }
  if (verb === 'fill') {
    const total = bag.count('biofuel');
    if (total < 1) return no('nojug');
    const k = st.k[key] ?? 0;
    if (k >= BIO.TANK) return no('tankfull');
    const sel = bag.slots[bag.selectedIndex], held = sel && sel.kind === 'biofuel' ? sel.count : total;
    const n = Math.min(held, total, BIO.TANK - k);
    if (!scratch.remove('biofuel', n)) return no('nojug');
    commit(bag, scratch);
    st.k[key] = k + n; st.r++;
    return { ok: true, text: `Poured ${jugs(n)} · ${k + n}/${BIO.TANK}`, n };
  }
  // empty
  const k = st.k[key] ?? 0;
  if (k <= 0) return no('tankempty');
  if (scratch.add('biofuel', k) !== 0) return no('bagfull');
  commit(bag, scratch);
  delete st.k[key]; st.r++;
  return { ok: true, text: `+ ${k} Biofuel Jug`, n: k };
}

/** Sorted "x,z" keys of the motor decor (same order as engine.js motorKeys). */
function motorList(decor) {
  const out = [];
  if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'motor' && isInt(d.x) && isInt(d.z)) out.push(keyOf(d.x, d.z));
  return out.sort();
}

/**
 * Host, once per second: each tank with jugs (sorted keys) feeds each motor within RANGE (Chebyshev, sorted keys)
 * that is on and has room for a whole jug. pour(x, z, sec) -> accepted seconds; only a full JUG_SEC uses a jug.
 * At most one jug per motor per call. `motors` = the engine slice (read only). Returns jugs used.
 */
export function topUp(st, decor, motors, pour) {
  const tanks = Object.keys(st.k).filter(k => st.k[k] > 0).sort();
  if (!tanks.length || typeof pour !== 'function') return 0;
  const list = motorList(decor); if (!list.length) return 0;
  const m = plainObj(motors?.motors) ? motors.motors : {};
  const fed = new Set();
  let used = 0;
  for (const tk of tanks) {
    const c = tk.indexOf(','), tx = +tk.slice(0, c), tz = +tk.slice(c + 1);
    for (const mk of list) {
      if (st.k[tk] <= 0) break;
      if (fed.has(mk)) continue;
      const j = mk.indexOf(','), mx = +mk.slice(0, j), mz = +mk.slice(j + 1);
      if (Math.max(Math.abs(mx - tx), Math.abs(mz - tz)) > BIO.RANGE) continue;
      const e = m[mk];
      if (!e || e.on !== true || !(typeof e.fuel === 'number' && e.fuel <= MOTOR_CAP - BIO.JUG_SEC)) continue;
      if (pour(mx, mz, BIO.JUG_SEC) !== BIO.JUG_SEC) continue;
      st.k[tk]--; used++; fed.add(mk);
    }
    if (st.k[tk] <= 0) delete st.k[tk];
  }
  if (used > 0) st.r++;
  return used;
}
