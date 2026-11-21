// Juicer and fruit smoothies (see docs/specs/juicer.md).
// Press E on a placed juicer with a Cup of Fresh Water and 2 fruit to get a smoothie cup straight away.
// Cozy: nothing spoils, a failed blend changes nothing. Slice: world.ext.juicer (show-only jar colour and
// blend counter, saved and synced so every viewer sees the same jar), host-authoritative, actions 'juicer.*'.
// The top half of this file is pure (no DOM, no Date, no Math.random) and exported for tests.
// Never import vitals.js here: an unstamped copy would carry its own FOOD table. This file reads nothing from it.
import { createJuicerModel, paintJuicer, JAR_COLOR, SPIN_SECONDS } from './juicer-model.js?build=v3-survival-ae77fa84ac2b';

export { JAR_COLOR, SPIN_SECONDS };
export const REACH = 2.6, HOST_SLACK = 2;
export const MAX_JUICERS = 400; // the raft tile cap
export const OLD_HOST = 'Your friend’s raft doesn’t have a juicer yet';
export const MIXES = Object.freeze({
  berry: Object.freeze({ take: Object.freeze({ berries: 2 }), out: 'berrycup' }),
  coconut: Object.freeze({ take: Object.freeze({ coconut: 2 }), out: 'coconutcup' }),
  mixed: Object.freeze({ take: Object.freeze({ berries: 1, coconut: 1 }), out: 'mixcup' }),
});
const OUT_NAME = Object.freeze({ berrycup: 'Berry Smoothie', coconutcup: 'Coconut Smoothie', mixcup: 'Island Smoothie' }); // = items.js names
const ORDER = Object.freeze(['mixed', 'berry', 'coconut']);
export const TEXT = Object.freeze({
  nocup: 'You need a cup of fresh water', nofruit: 'You need 2 fruit', full: 'Your bag is full', bad: 'Nothing to blend',
  hintCup: 'Juicer: needs a cup of fresh water and 2 fruit', hintFruit: 'Juicer: needs 2 fruit (berries or coconut)',
});
const PROMPT = Object.freeze({ berry: '<kbd>E</kbd>Blend a berry smoothie', coconut: '<kbd>E</kbd>Blend a coconut smoothie', mixed: '<kbd>E</kbd>Blend an island smoothie' });

const KEY_RE = /^-?\d+,-?\d+$/;
const isInt = Number.isInteger;
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
export const tileKey = (x, z) => x + ',' + z;
const isKey = k => typeof k === 'string' && k.length <= 24 && KEY_RE.test(k) && (() => { const [x, z] = k.split(',').map(Number); return tileKey(x, z) === k; })();

function juicerKeys(decor) {
  const out = new Set();
  if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'juicer' && isInt(d.x) && isInt(d.z)) out.add(tileKey(d.x, d.z));
  return out;
}
const hasJuicer = (decor, x, z) => { if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'juicer' && d.x === x && d.z === z) return true; return false; };

const affords = (count, id) => { const t = MIXES[id].take; for (const k in t) if (!(count(k) >= t[k])) return false; return true; };

/** count(kind) -> int, held = selected kind. Returns a MIXES id or null (see spec section 3). */
export function pickMix(count, held) {
  if (typeof count !== 'function' || !(count('freshcup') >= 1)) return null;
  if (held === 'berries') { if (affords(count, 'berry')) return 'berry'; if (affords(count, 'mixed')) return 'mixed'; }
  if (held === 'coconut') { if (affords(count, 'coconut')) return 'coconut'; if (affords(count, 'mixed')) return 'mixed'; }
  for (const id of ORDER) if (affords(count, id)) return id;
  return null;
}

/** All-or-nothing: 1 freshcup + the mix's fruit become 1 smoothie cup, or nothing changes. */
export function blend(bag, mix) {
  if (!bag || typeof bag.snapshot !== 'function' || typeof bag.count !== 'function' || !own(MIXES, mix)) return { ok: false, reason: 'bad', text: TEXT.bad };
  const m = MIXES[mix];
  if (!(bag.count('freshcup') >= 1)) return { ok: false, reason: 'nocup', text: TEXT.nocup };
  for (const k in m.take) if (!(bag.count(k) >= m.take[k])) return { ok: false, reason: 'nofruit', text: TEXT.nofruit };
  const s = new bag.constructor(bag.snapshot());
  if (!s.remove('freshcup', 1)) return { ok: false, reason: 'nocup', text: TEXT.nocup };
  for (const k in m.take) if (!s.remove(k, m.take[k])) return { ok: false, reason: 'nofruit', text: TEXT.nofruit };
  if (s.add(m.out, 1) !== 0) return { ok: false, reason: 'full', text: TEXT.full };
  for (let i = 0; i < s.slots.length; i++) bag.slots[i] = s.slots[i];
  if (typeof bag.version === 'number') bag.version++;
  return { ok: true, out: m.out, text: '+ 1 ' + OUT_NAME[m.out] };
}

/** Validated slice. Junk -> defaults; bad keys, unknown mixes, non-int or out-of-range n and non-juicer tiles dropped. */
export function cleanJuicer(v, decor) {
  const out = { v: 1, s: '', r: 0, j: {} };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  if (typeof v.s === 'string' && v.s.length <= 32) out.s = v.s;
  if (isInt(v.r) && v.r >= 0) out.r = v.r;
  const j = v.j && typeof v.j === 'object' && !Array.isArray(v.j) ? v.j : {};
  const keys = juicerKeys(decor);
  let n = 0;
  for (const k of Object.keys(j)) {
    if (n >= MAX_JUICERS) break;
    if (!isKey(k) || !keys.has(k)) continue;
    const e = j[k]; if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    if (!own(MIXES, e.m) || !isInt(e.n) || e.n < 0 || e.n > 9999) continue;
    out.j[k] = { m: e.m, n: e.n }; n++;
  }
  return out;
}

// ------------------------------------------------------------------ the content module

export function createJuicer(ctx) {
  const T = ctx.T;
  const session = Math.random().toString(36).slice(2, 10);
  let st = cleanJuicer(undefined, null); st.s = session;
  let cache = null, cacheSt = null, cacheR = -1, netR = -1, netS = null, netUndef = false, hostHas = true;
  let clock = 0;
  const seen = new Map(), spin = new Map(); // key -> last n seen; key -> seconds since the blend (view only)
  let seenSt = null, seenR = -1, seenLen = -1;
  const groups = []; // {g, k} for each craft_juicer group in ctx.raft
  let scanLen = -1, scanFirst = null, scanRaft = null, scanRev; // scanRev: game.js raft.userData.rev (bumps when rebuildRaft adds or removes a child)
  const scratch = T ? new T.Vector3() : null;

  const oldHost = () => ctx.role === 'guest' && !hostHas;
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);
  const bagCount = bag => k => (bag && typeof bag.count === 'function' ? bag.count(k) : 0);
  const heldKind = bag => { const s = bag && bag.slots ? bag.slots[bag.selectedIndex] : null; return s ? s.kind : null; };
  const hint = count => (count('freshcup') >= 1 ? TEXT.hintFruit : TEXT.hintCup);

  // Nearest juicer along the view ray (or the camera forward when no aim), within reach.
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else if (scratch) { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    else return null;
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (!d || d.type !== 'juicer') continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      const cy = (ctx.raft?.position.y ?? 0) + .5;
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > .85) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best ? { x: best.x, z: best.z, key: tileKey(best.x, best.z) } : null;
  }

  // Start a spin wherever a synced n changed on a juicer we had already seen. Runs only when the slice
  // revision or the decor list changes, so host and guest spin from the same synced data.
  function watch() {
    const d = decor();
    if (st === seenSt && st.r === seenR && d.length === seenLen) return;
    seenSt = st; seenR = st.r; seenLen = d.length;
    for (const k of seen.keys()) if (!hasJuicerKey(d, k)) { seen.delete(k); spin.delete(k); }
    for (let i = 0; i < d.length; i++) {
      const e = d[i]; if (!e || e.type !== 'juicer' || !isInt(e.x) || !isInt(e.z)) continue;
      const k = tileKey(e.x, e.z), j = oldHost() ? null : st.j[k], n = j ? j.n : 0;
      if (seen.has(k) && seen.get(k) !== n) spin.set(k, 0);
      seen.set(k, n);
    }
  }
  const hasJuicerKey = (d, k) => { const [x, z] = k.split(',').map(Number); return hasJuicer(d, x, z); };

  function scan() {
    const raft = ctx.raft; if (!raft) { groups.length = 0; return; }
    const kids = raft.children;
    if (raft === scanRaft && kids.length === scanLen && kids[0] === scanFirst && raft.userData?.rev === scanRev) return;
    scanRaft = raft; scanLen = kids.length; scanFirst = kids[0]; scanRev = raft.userData?.rev;
    groups.length = 0;
    for (let i = 0; i < kids.length; i++) {
      const g = kids[i]; if (g.name !== 'craft_juicer') continue;
      groups.push({ g, k: tileKey(Math.round(g.position.x / 2), Math.round(g.position.z / 2)) });
    }
  }

  function tickSpin(dt) {
    if (!spin.size) return;
    const step = dt > 0 && Number.isFinite(dt) ? dt : 0;
    for (const [k, t] of spin) spin.set(k, t + step);
  }

  function paint() {
    scan();
    const old = oldHost();
    for (let i = 0; i < groups.length; i++) {
      const { g, k } = groups[i];
      const t = spin.get(k) ?? 0;
      paintJuicer(g, old ? null : st.j[k] ?? null, t);
    }
    for (const [k, t] of spin) if (t >= SPIN_SECONDS) spin.delete(k);
  }

  function load(data, from) {
    if (from === 'net') {
      if (data && typeof data === 'object' && data.r === netR && data.s === netS) return; // unchanged host state
      if (data === undefined && netUndef) return;
      netUndef = data === undefined; hostHas = data !== undefined;
      st = cleanJuicer(data, ctx.world?.decor);
      netR = data && typeof data === 'object' ? data.r : -1; netS = data && typeof data === 'object' ? data.s : null;
      return;
    }
    netR = -1; netS = null; netUndef = false; hostHas = true;
    st = cleanJuicer(data, ctx.world?.decor);
    st.s = session; st.r++;
    seen.clear(); spin.clear(); seenSt = null; // a loaded world never spins on its first look
  }

  function serialize() {
    if (cache && cacheSt === st && cacheR === st.r) return cache;
    cache = JSON.parse(JSON.stringify(st)); cacheSt = st; cacheR = st.r;
    return cache;
  }

  return {
    name: 'juicer',
    load,
    serialize,
    update(dt) {
      watch(); tickSpin(dt);
      if (T) paint(); else for (const [k, t] of spin) if (t >= SPIN_SECONDS) spin.delete(k);
      if (ctx.role === 'guest') return;
      clock += dt > 0 ? dt : 0;
      if (clock >= 1) { // host: prune entries whose juicer is gone
        clock -= Math.floor(clock);
        const c = cleanJuicer(st, decor());
        if (Object.keys(c.j).length !== Object.keys(st.j).length) { st.j = c.j; st.r++; }
      }
    },
    prompt(aim) {
      const t = target(aim); if (!t) return null;
      if (oldHost()) return OLD_HOST;
      const bag = ctx.localBag?.(), count = bagCount(bag);
      const m = pickMix(count, heldKind(bag));
      return m ? PROMPT[m] : hint(count);
    },
    interact(aim) {
      const t = target(aim); if (!t) return false;
      if (oldHost()) { ctx.notice?.(OLD_HOST, 2400); return true; }
      const bag = ctx.localBag?.(), count = bagCount(bag);
      const mix = pickMix(count, heldKind(bag));
      if (!mix) { ctx.notice?.(hint(count)); return true; }
      ctx.action({ kind: 'juicer.blend', x: t.x, z: t.z, mix });
      return true;
    },
    action(a, actor, bag) {
      if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('juicer.')) return false;
      if (a.kind !== 'juicer.blend' || !isInt(a.x) || !isInt(a.z) || !own(MIXES, a.mix) || !hasJuicer(decor(), a.x, a.z)) return true;
      const pose = actor === 'guest' ? ctx.other : ctx.physics;
      if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z) || Math.hypot(a.x * 2 - pose.x, a.z * 2 - pose.z) > REACH + HOST_SLACK) return true;
      const r = blend(bag, a.mix);
      if (r.ok) {
        const key = tileKey(a.x, a.z), n = st.j[key] ? st.j[key].n : 0;
        st.j[key] = { m: a.mix, n: (n + 1) % 10000 }; st.r++;
      }
      ctx.emit?.(r.ok ? { kind: 'loot', text: r.text, loot: { [r.out]: 1 } } : { kind: r.reason === 'full' ? 'full' : 'notice', text: r.text }, actor);
      return true;
    },
    decorModel(type) {
      if (!T || type !== 'juicer') return null;
      return createJuicerModel(T);
    },
    debug: {
      state: () => JSON.parse(JSON.stringify(st)),
      target: aim => target(aim),
      spinning: () => Object.fromEntries(spin),
      /** Host QA: put a juicer on a free raft tile. */
      place(x, z) {
        const w = ctx.world;
        if (ctx.role === 'guest' || !isInt(x) || !isInt(z) || !w) return false;
        if (!w.tiles?.some(t => t[0] === x && t[1] === z) || decor().some(d => d.x === x && d.z === z)) return false;
        w.decor.push({ type: 'juicer', x, z }); ctx.rebuildRaft?.(); return true;
      },
    },
    dispose() { groups.length = 0; seen.clear(); spin.clear(); },
  };
}
