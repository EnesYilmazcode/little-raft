// Cooking Pot: pure rules (docs/specs/cookpot.md §3). No imports, no DOM, THREE, Date or Math.random.
// A pot holds 3 ingredients and some wood; a matched set simmers into 2 servings of one meal, collected into bowls.
// Cosy rules: no hunger, nothing burns, spoils or is lost; an idle pot never uses wood. A meal gives ONE timed buff.

export const POT = Object.freeze({ SLOTS: 3, SERVE: 2, TRAY: 6, FUEL_MAX: 4, COOK: 20, MAX_DT: 1, REACH: 3.2, MAX_POTS: 100, BUFF_MAX: 300 });
export const INGREDIENTS = Object.freeze(['fish', 'cookedfish', 'seaweed', 'leaf', 'seed', 'puffegg', 'freshcup', 'beet', 'potato', 'sharkmeat']);
export const RECIPES = Object.freeze({ // key = sorted ingredients joined by '+'; value = meal id
  'fish+freshcup+seaweed': 'meal_chowder', 'leaf+puffegg+puffegg': 'meal_omelette', 'freshcup+seaweed+seaweed': 'meal_broth',
  'cookedfish+leaf+seed': 'meal_fishbowl', 'freshcup+puffegg+seed': 'meal_custard', 'cookedfish+puffegg+seaweed': 'meal_stew',
  // crop-plot meals (Raft has vegetable, fish and shark pot meals; ours are 3-slot sets with our own names and buffs)
  'beet+freshcup+potato': 'meal_gardensoup', 'beet+fish+potato': 'meal_hotpot', 'beet+potato+sharkmeat': 'meal_sharkroast',
});
export const MEALS = Object.freeze({ // buff fields: neutral 1, night 0|1; secs = buff length
  meal_chowder: Object.freeze({ name: 'Tide Chowder', buff: 'Swift Fins', secs: 180, swim: 1.35 }),
  meal_omelette: Object.freeze({ name: 'Puff Omelette', buff: 'Springy Step', secs: 180, walk: 1.15, jump: 1.15 }),
  meal_broth: Object.freeze({ name: 'Kelp Broth', buff: 'Deep Breath', secs: 180, oxy: 1.6 }),
  meal_fishbowl: Object.freeze({ name: 'Smoky Fish Bowl', buff: 'Steady Reel', secs: 180, reel: 1.3 }),
  meal_custard: Object.freeze({ name: 'Coconut Custard', buff: 'Night Owl', secs: 240, night: 1 }),
  meal_stew: Object.freeze({ name: 'Captain’s Stew', buff: 'Cosy Glow', secs: 300, swim: 1.1, walk: 1.1, oxy: 1.25, reel: 1.1 }),
  meal_gardensoup: Object.freeze({ name: 'Garden Soup', buff: 'Sure Footing', secs: 240, walk: 1.2 }),
  meal_hotpot: Object.freeze({ name: 'Fisher’s Hotpot', buff: 'Steady Reel', secs: 240, reel: 1.35 }),
  meal_sharkroast: Object.freeze({ name: 'Harbour Roast', buff: 'Sea Legs', secs: 300, swim: 1.2, oxy: 1.3 }),
});
export const MEAL_IDS = Object.freeze(Object.keys(MEALS));
export const POT_ACTIONS = Object.freeze(['pot.add', 'pot.fuel', 'pot.take', 'pot.back', 'pot.eat']);
// Names kept here so this file stays import-free.
export const NAMES = Object.freeze({
  fish: 'fish', cookedfish: 'grilled fish', seaweed: 'seaweed', leaf: 'palm leaf', seed: 'palm seed', puffegg: 'puff egg', freshcup: 'fresh water',
  beet: 'beet', potato: 'potato', sharkmeat: 'shark meat',
});
export const keyOf = (x, z) => x + ',' + z;
export const TEXT = Object.freeze({
  reach: 'Step a little closer', missing: 'That spot has no cooking pot', busy: 'The pot is simmering',
  full: 'The pot holds 3 things. Take one back with an empty hand', norecipe: 'No recipe yet. Take one back with an empty hand',
  nowood: 'You need wood for the fire', fuelfull: 'The fire is stoked', empty: 'Nothing in the pot', nobowl: 'You need a bowl',
  nocup: 'Bring an empty cup to scoop the water back', bagfull: 'Your bag is full', nomeal: 'Hold a meal to eat',
  bad: 'That does not work here', nothing: 'You have none of that',
});

const isInt = Number.isInteger;
const intIn = (v, lo, hi) => isInt(v) && v >= lo && v <= hi;
const KEY_RE = /^(-?\d{1,2}(?:\.\d{1,3})?),(-?\d{1,2}(?:\.\d{1,3})?)$/; // free placement: fractional decor spots
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);

export function blank() { return { i: [], f: 0, h: 0, t: 0, c: null, o: null, n: 0 }; }
const idle = e => e.i.length === 0 && e.f === 0 && e.n === 0 && e.h === 0;

/** 3 kinds in any order -> meal id | null. Never mutates the list. */
export function match(list) {
  if (!Array.isArray(list) || list.length !== POT.SLOTS) return null;
  const key = list.slice().sort().join('+');
  return Object.prototype.hasOwnProperty.call(RECIPES, key) ? RECIPES[key] : null;
}

/** Validate one pot entry. Returns a fresh entry, or null when invalid or idle and empty. */
export function cleanEntry(raw) {
  if (!plain(raw)) return null;
  const e = blank();
  if (Array.isArray(raw.i) && raw.i.length <= POT.SLOTS && raw.i.every(k => INGREDIENTS.includes(k))) e.i = raw.i.slice();
  e.f = intIn(raw.f, 0, POT.FUEL_MAX) ? raw.f : 0;
  if (MEAL_IDS.includes(raw.o) && intIn(raw.n, 1, POT.TRAY)) { e.o = raw.o; e.n = raw.n; }
  const m = match(e.i);
  if (raw.h === 1 && e.i.length === POT.SLOTS && m && raw.c === m && e.n + POT.SERVE <= POT.TRAY && (e.n === 0 || e.o === m)) {
    e.h = 1; e.c = m; e.t = Number.isFinite(raw.t) ? Math.min(POT.COOK, Math.max(0, raw.t)) : 0;
  }
  return idle(e) ? null : e;
}

/** {m,s} -> {m,s} | null. s clamped to 0..min(BUFF_MAX, meal secs); an expired (s <= 0) buff is null. */
export function cleanBuff(raw) {
  if (!plain(raw) || !MEAL_IDS.includes(raw.m) || !Number.isFinite(raw.s)) return null;
  const s = Math.min(POT.BUFF_MAX, MEALS[raw.m].secs, Math.max(0, raw.s));
  return s > 0 ? { m: raw.m, s } : null;
}

/** Validate a world.ext.cookpot slice. decorAt(x,z) (optional) drops tiles that no longer hold a pot. Never throws. */
export function cleanSlice(data, decorAt, keepGuest = true) {
  const out = { k: {}, b: { host: null, guest: null }, r: 0, br: 0 };
  try {
    const d = plain(data) ? data : {};
    const cnt = v => (isInt(v) && v >= 0 && v < Number.MAX_SAFE_INTEGER ? v : 0);
    out.r = cnt(d.r); out.br = cnt(d.br);
    const b = plain(d.b) ? d.b : {};
    out.b.host = cleanBuff(b.host);
    out.b.guest = keepGuest ? cleanBuff(b.guest) : null;
    const k = plain(d.k) ? d.k : null;
    if (!k) return out;
    let n = 0;
    for (const key of Object.keys(k)) {
      if (n >= POT.MAX_POTS) break;
      const m = KEY_RE.exec(key); if (!m) continue;
      const x = +m[1], z = +m[2]; if (Math.abs(x) > 25 || Math.abs(z) > 25) continue;
      if (typeof decorAt === 'function' && decorAt(x, z) !== 'cookpot') continue;
      const e = cleanEntry(k[key]); if (!e) continue;
      out.k[keyOf(x, z)] = e; n++;
    }
  } catch { return { k: {}, b: { host: null, guest: null }, r: 0, br: 0 }; }
  return out;
}

const buffOut = x => (x ? { m: x.m, s: Math.ceil(x.s) } : null);
/** JSON-safe deep copy for saves and the network. t to 0.1 s, buff seconds rounded up. */
export function sliceOf(st) {
  const k = {};
  for (const key of Object.keys(st.k)) {
    const e = st.k[key]; if (!e || idle(e)) continue;
    k[key] = { i: e.i.slice(), f: e.f, h: e.h, t: Math.round(e.t * 10) / 10, c: e.c, o: e.o, n: e.n };
  }
  return { v: 1, r: st.r, br: st.br, k, b: { host: buffOut(st.b?.host), guest: buffOut(st.b?.guest) } };
}

/** Advance one pot by dt seconds. Returns 1 when a cook finished, else 0. No allocations. */
export function step(e, dt) {
  const d = dt > 0 ? (dt < POT.MAX_DT ? dt : POT.MAX_DT) : 0; // NaN -> 0
  if (e.h === 0 && e.i.length === POT.SLOTS && e.f > 0) {
    const m = match(e.i);
    if (m && (e.n === 0 || e.o === m) && e.n + POT.SERVE <= POT.TRAY) { e.f--; e.h = 1; e.c = m; e.t = 0; } // the only place fuel is spent
  }
  if (e.h !== 1) return 0;
  e.t += d;
  if (e.t < POT.COOK) return 0;
  e.i.length = 0; e.h = 0; e.t = 0; e.o = e.c; e.c = null; e.n += POT.SERVE;
  return 1;
}

/** Step every pot. onDone(key, e) when a cook finishes. True if anything visible changed. */
export function stepAll(st, dt, onDone) {
  let changed = false;
  for (const key in st.k) {
    const e = st.k[key]; if (!e || e.i.length !== POT.SLOTS) continue;
    const h0 = e.h, t0 = Math.round(e.t * 10);
    const done = step(e, dt);
    if (done || e.h !== h0 || Math.round(e.t * 10) !== t0) changed = true;
    if (done && onDone) onDone(key, e);
  }
  return changed;
}

/** b = {host, guest}. s -= dt (clamped); an entry becomes null at 0. True when one expired. */
export function tickBuffs(b, dt) {
  if (!b) return false;
  const d = dt > 0 ? (dt < POT.MAX_DT ? dt : POT.MAX_DT) : 0;
  let gone = false;
  if (b.host) { b.host.s -= d; if (!(b.host.s > 0)) { b.host = null; gone = true; } }
  if (b.guest) { b.guest.s -= d; if (!(b.guest.s > 0)) { b.guest = null; gone = true; } }
  return gone;
}

/** Writes out.swim/walk/jump/oxy/reel (1 when absent) and out.night (0|1). Returns out. */
export function buffMods(entry, out) {
  const m = entry && MEALS[entry.m];
  out.swim = m && m.swim ? m.swim : 1; out.walk = m && m.walk ? m.walk : 1; out.jump = m && m.jump ? m.jump : 1;
  out.oxy = m && m.oxy ? m.oxy : 1; out.reel = m && m.reel ? m.reel : 1; out.night = m && m.night ? 1 : 0;
  return out;
}

export const cooking = e => !!e && e.h === 1;
export function progress(e) {
  if (!e || e.h !== 1) return 0;
  const p = e.t / POT.COOK;
  return p > 1 ? 1 : p < 0 ? 0 : p;
}

const commit = (bag, scratch) => { for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i]; };
// Remove one `kind`, preferring the selected slot. Mutates b; true on success.
function takeOne(b, kind) {
  const i = b.selectedIndex, s = b.slots[i];
  if (s && s.kind === kind) { s.count--; if (s.count <= 0) b.slots[i] = null; return true; }
  return b.remove(kind, 1);
}

/**
 * Apply one 'pot.*' action. a = {kind, x, z, item?}; env = {decorAt(x,z), pos(actor)}.
 * Everything is checked first; a refusal changes nothing; pot successes bump st.r, eat bumps st.br.
 * Returns {ok, reason?, text, meal?}.
 */
export function applyPotAction(st, a, actor, bag, env) {
  const no = reason => ({ ok: false, reason, text: TEXT[reason] });
  if (!a || typeof a !== 'object' || !POT_ACTIONS.includes(a.kind)) return no('bad');
  if (!bag || !Array.isArray(bag.slots) || bag.slots.length !== 28 || typeof bag.count !== 'function') return no('bad');
  if (actor !== 'host' && actor !== 'guest') return no('bad');
  const verb = a.kind.slice(4);

  if (verb === 'eat') {
    if (!MEAL_IDS.includes(a.item)) return no('bad');
    if (bag.count(a.item) < 1) return no('nomeal');
    const scratch = new bag.constructor(bag.snapshot());
    if (!takeOne(scratch, a.item)) return no('nomeal');
    scratch.add('bowl', 1); // the bowl is optional: a full bag still eats
    commit(bag, scratch);
    const meal = MEALS[a.item];
    if (!st.b) st.b = { host: null, guest: null };
    st.b[actor] = { m: a.item, s: meal.secs };
    st.br++;
    return { ok: true, text: `Tummy full of ${meal.name}: ${meal.buff}`, meal: a.item };
  }

  if (!Number.isFinite(a.x) || !Number.isFinite(a.z) || Math.abs(a.x) > 25 || Math.abs(a.z) > 25) return no('bad');
  if ((env?.decorAt?.(a.x, a.z) ?? null) !== 'cookpot') return no('missing');
  const p = env?.pos?.(actor);
  if (p && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.hypot(p.x - a.x * 2, p.z - a.z * 2) > POT.REACH) return no('reach');
  const key = keyOf(a.x, a.z), e = st.k[key] ?? blank();
  let res;

  if (verb === 'add') {
    if (!INGREDIENTS.includes(a.item)) return no('bad');
    if (e.h === 1) return no('busy');
    if (e.i.length >= POT.SLOTS) return no('full');
    if (bag.count(a.item) < 1) return { ok: false, reason: 'nothing', text: `You have no ${NAMES[a.item]}` };
    const scratch = new bag.constructor(bag.snapshot());
    if (!takeOne(scratch, a.item)) return { ok: false, reason: 'nothing', text: `You have no ${NAMES[a.item]}` };
    if (a.item === 'freshcup' && scratch.add('cup', 1) > 0) return no('bagfull');
    commit(bag, scratch);
    e.i.push(a.item);
    if (e.i.length === POT.SLOTS) {
      const m = match(e.i);
      res = m ? { ok: true, text: `${MEALS[m].name} is ready to simmer${e.f === 0 ? ' · add wood' : ''}` } : { ok: true, text: TEXT.norecipe };
    } else res = { ok: true, text: `Added ${NAMES[a.item]} · ${e.i.length}/3` };
  } else if (verb === 'fuel') {
    if (bag.count('wood') < 1) return no('nowood');
    if (e.f + 1 > POT.FUEL_MAX) return no('fuelfull');
    if (!takeOne(bag, 'wood')) return no('nowood');
    e.f++;
    res = { ok: true, text: `Fire stoked · ${e.f} cooks of fuel` };
  } else if (verb === 'take') {
    if (e.n === 0 || !e.o) return no('empty');
    if (bag.count('bowl') < 1) return no('nobowl');
    const scratch = new bag.constructor(bag.snapshot());
    if (!takeOne(scratch, 'bowl')) return no('nobowl');
    if (scratch.add(e.o, 1) > 0) return no('bagfull');
    commit(bag, scratch);
    const meal = e.o;
    e.n--; if (e.n === 0) e.o = null;
    res = { ok: true, text: `+ 1 ${MEALS[meal].name}`, meal };
  } else { // back
    if (e.h === 1) return no('busy');
    if (e.i.length === 0) return no('empty');
    const kind = e.i[e.i.length - 1];
    const scratch = new bag.constructor(bag.snapshot());
    if (kind === 'freshcup' && !scratch.remove('cup', 1)) return no('nocup');
    if (scratch.add(kind, 1) > 0) return no('bagfull');
    commit(bag, scratch);
    e.i.pop();
    res = { ok: true, text: `Took back ${NAMES[kind]} · ${e.i.length}/3` };
  }
  if (idle(e)) delete st.k[key]; else st.k[key] = e;
  st.r++;
  return res;
}
