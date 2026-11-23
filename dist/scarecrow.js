// Scarecrow and peckish gulls (see docs/specs/scarecrow.md).
// Now and then a gull lands on the rim of a watered, still-growing palm planter and pecks: that planter's
// growth pauses (never goes back) until the gull leaves or is shooed with E. A scarecrow keeps planters
// within SCARECROW_RADIUS free of gulls, and gulls sit on its hat instead. Host-authoritative; the guest
// only sees ext.scarecrow = {v:1, p:[key]} (net only, never saved). The top half is pure (no DOM, no
// Date, no Math.random) and exported for tests and for wildlife.js (which this file never imports).
import { createScarecrow3D, swayRags, HAT_TOP_Y } from './scarecrow-model.js?build=v3-survival-ae77fa84ac2b';

export const SCARECROW_RADIUS = 4.5, PALM_GULLS = 3, PALM_CHANCE = 0.25, PECK_MAX = 8, COOLDOWN = 90, REACH = 3, HOST_SLACK = 2;
export const PALM_RIM = 0.5, RIM_OFFSET = 0.4, HAT_TOP = HAT_TOP_Y; // local heights above DECOR_Y (hat top 2.0125 m, the model's); rim offset in metres
export const OLD_HOST = 'Your friend’s gulls are not peckish yet';
const GROW_SECONDS = 90, SWAY_DIST = 20;

const KEY_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/; // free placement: decor x/z may be fractional
const isInt = Number.isInteger;
export const tileKey = (x, z) => x + ',' + z;
const isKey = k => typeof k === 'string' && k.length <= 24 && KEY_RE.test(k) && (() => { const [x, z] = k.split(',').map(Number); return tileKey(x, z) === k; })();

/** Set of "x,z" palm keys within SCARECROW_RADIUS (tile centres, metres) of any scarecrow. */
export function protectedPalms(decor) {
  const out = new Set();
  if (!Array.isArray(decor)) return out;
  let any = false;
  for (const d of decor) if (d && d.type === 'scarecrow' && Number.isFinite(d.x) && Number.isFinite(d.z)) { any = true; break; }
  if (!any) return out;
  for (const p of decor) {
    if (!p || p.type !== 'palm' || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    for (const s of decor) {
      if (!s || s.type !== 'scarecrow' || !Number.isFinite(s.x) || !Number.isFinite(s.z)) continue;
      if (Math.hypot((p.x - s.x) * 2, (p.z - s.z) * 2) <= SCARECROW_RADIUS) { out.add(tileKey(p.x, p.z)); break; }
    }
  }
  return out;
}

/** Where on the pot rim a gull stands: RIM_OFFSET m from the centre, at one of 8 angles picked by the tile. */
export function rimSpot(tx, tz) {
  const k = ((((tx | 0) * 7 + (tz | 0) * 13) % 8) + 8) % 8, a = k * Math.PI / 4;
  return { dx: RIM_OFFSET * Math.cos(a), dz: RIM_OFFSET * Math.sin(a) };
}

const palmCount = decor => { let n = 0; if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'palm') n++; return n; };

/** A pecking gull only pauses a watered, still-growing planter, and never the only planter on the raft. */
export function canPeck(garden, key, decor) {
  if (palmCount(decor) < 2) return false;
  const e = garden && typeof garden === 'object' ? garden[key] : undefined;
  if (!e || typeof e !== 'object' || e.water !== 1) return false;
  return typeof e.grow === 'number' && e.grow >= 0 && e.grow < GROW_SECONDS;
}

/** Host, 1 Hz. st = {cur:null|{i,key,since}, cool:{key:until}} (memory only). Returns the pecked keys (0 or 1). */
export function pickPecks(st, onPalm, garden, decor, now) {
  const list = Array.isArray(onPalm) ? onPalm : [];
  if (!st.cool || typeof st.cool !== 'object') st.cool = {};
  if (st.cur) {
    const c = st.cur;
    let still = false;
    for (const e of list) if (e && e.i === c.i && e.key === c.key) { still = true; break; }
    if (!(still && now - c.since < PECK_MAX && canPeck(garden, c.key, decor))) { st.cool[c.key] = now + COOLDOWN; st.cur = null; }
  }
  if (!st.cur) {
    for (const e of list) {
      if (!e || !isKey(e.key) || !canPeck(garden, e.key, decor) || st.cool[e.key] > now) continue;
      st.cur = { i: e.i, key: e.key, since: now }; break;
    }
  }
  for (const k of Object.keys(st.cool)) if (!(st.cool[k] > now)) delete st.cool[k];
  const out = new Set();
  if (st.cur) out.add(st.cur.key);
  return out;
}

/** Validated net slice: {v:1, p:[<=1 valid key]}, or null on junk. */
export function cleanNet(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || !Array.isArray(v.p)) return null;
  const p = [];
  for (const k of v.p) if (isKey(k)) { p.push(k); break; }
  return { v: 1, p };
}

const freshState = () => ({ cur: null, cool: {} });
const sameSet = (a, b) => { if (a.size !== b.size) return false; for (const k of a) if (!b.has(k)) return false; return true; };
const KBD_RE = /^<kbd>[^<]*<\/kbd>/;

// ------------------------------------------------------------------ the content module

export function createScarecrow(ctx, peer) {
  const T = ctx.T;
  const find = name => (typeof peer === 'function' ? peer(name) : null);
  let st = freshState(), pecked = new Set(), r = 0, clock = 0, acc = 0, cache = null, cacheR = -1;
  let netP = [], netSet = new Set(), hostHasScarecrow = true;
  // #contextPrompt is hidden by prompts.css, so the shoo prompt reaches the screen through window.raftPrompts:
  // palmPrompt (game.js updateContext, after update() in the same frame) records the aimed pecked planter.
  let aimKey = null, aimLabel = '', unprompt = null;
  function promptFor(pc) {
    const s = pc && pc.state;
    if (!aimKey || oldHost() || !isPecked(aimKey) || (s && (s.pickup || s.swimming))) return null;
    return aimLabel ? [{ key: 'E', label: 'Shoo the gull' }, { label: aimLabel, muted: true }] : { key: 'E', label: 'Shoo the gull' };
  }
  try { unprompt = globalThis.window?.raftPrompts?.provide?.({ id: 'scarecrow', priority: 1, prompt: promptFor }) ?? null; } catch { unprompt = null; }
  const buf = [], EMPTY = new Set();
  const crows = new Map(); // tile key -> craft_scarecrow group in ctx.raft
  let scanLen = -1, scanFirst = null, scanRaft = null;
  const scratch = T ? new T.Vector3() : null, camPos = T ? new T.Vector3() : null;

  const guest = () => ctx.role === 'guest';
  const oldHost = () => guest() && !hostHasScarecrow;
  const isPecked = key => (guest() ? netSet.has(key) : pecked.has(key));

  // Nearest palm planter along the view ray (or the camera forward when no aim), within reach (from bees.js).
  // A game aim carries `decor` (the planter the watering prompt uses): use exactly that one, so the shoo
  // prompt and E always match the watering aim. The ray pick is only a fallback for aims without it.
  function target(aim) {
    const w = ctx.world, p = ctx.physics; if (!w || !p || !Array.isArray(w.decor)) return null;
    if (aim && typeof aim === 'object' && 'decor' in aim) {
      const d = aim.decor;
      if (!d || d.type !== 'palm' || !Number.isFinite(d.x) || !Number.isFinite(d.z) || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
      if (Math.hypot(p.x - d.x * 2, p.z - d.z * 2) > REACH) return null;
      return { x: d.x, z: d.z, key: tileKey(d.x, d.z) };
    }
    const cam = ctx.camera; if (!cam) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else if (scratch) { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    else return null;
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (!d || d.type !== 'palm') continue;
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

  function scan() {
    const raft = ctx.raft; if (!raft) { crows.clear(); return; }
    const kids = raft.children;
    if (raft === scanRaft && kids.length === scanLen && kids[0] === scanFirst) return;
    scanRaft = raft; scanLen = kids.length; scanFirst = kids[0];
    crows.clear();
    for (let i = 0; i < kids.length; i++) {
      const g = kids[i]; if (g.name !== 'craft_scarecrow') continue;
      crows.set(tileKey(Math.round(g.position.x * 500) / 1000, Math.round(g.position.z * 500) / 1000), g);
    }
  }

  function animate() {
    scan(); if (!crows.size) return;
    const cam = ctx.camera, t = ctx.elapsed ?? 0, rain = find('daynight')?.rain;
    const k = Number.isFinite(rain) && rain > .3 ? 1.8 : 1;
    swayCam = !!(cam && camPos); if (swayCam) cam.getWorldPosition(camPos);
    swayT = t; swayK = k; crows.forEach(swayOne); // forEach with a bound function: no iterator per frame
  }
  let swayCam = false, swayT = 0, swayK = 1;
  function swayOne(g) {
    if (swayCam) { g.getWorldPosition(scratch); if (scratch.distanceToSquared(camPos) > SWAY_DIST * SWAY_DIST) return; }
    swayRags(g, swayT, swayK);
  }

  // Host: one 1 Hz pass of the peck rule. `list` overrides the wildlife read (QA).
  function hostTick(list) {
    const wild = find('wildlife');
    if (!list) { if (wild && typeof wild.onPalm === 'function') wild.onPalm(buf); else buf.length = 0; }
    const next = pickPecks(st, list ?? buf, ctx.world?.garden, ctx.world?.decor, clock);
    if (!sameSet(next, pecked)) { pecked = next; r++; }
  }

  function endPeck(key) {
    if (st.cur?.key !== key) return;
    st.cool[key] = clock + COOLDOWN; st.cur = null; pecked = new Set(); r++;
  }

  function shooKey(key) {
    find('wildlife')?.shoo?.(key);
    ctx.notice?.('Shoo!', 1200);
    const [x, z] = key.split(',').map(Number);
    ctx.action?.({ kind: 'scarecrow.shoo', x, z });
  }

  const mod = {
    name: 'scarecrow',
    get pecked() { return pecked; },
    update(dt) {
      aimKey = null; // set again by this frame's palmPrompt
      if (T) animate();
      if (ctx.running && !guest()) {
        const s = dt > 0 && Number.isFinite(dt) ? Math.min(dt, 1) : 0;
        clock += s; acc += s;
        if (acc >= 1) { acc -= Math.floor(acc); hostTick(null); }
      }
      const wild = find('wildlife');
      if (wild) wild.pecking = guest() ? (hostHasScarecrow ? netSet : EMPTY) : pecked;
    },
    serialize() {
      if (ctx.role !== 'host') return undefined;
      if (cache && cacheR === r) return cache;
      cache = { v: 1, p: [...pecked] }; cacheR = r;
      return cache;
    },
    load(data, from) {
      if (from === 'net') {
        hostHasScarecrow = data !== undefined;
        const p = cleanNet(data)?.p ?? [];
        if (p.length !== netP.length || p[0] !== netP[0]) { netP = p; netSet = new Set(p); }
        return;
      }
      st = freshState(); pecked = new Set(); r++; acc = 0;
      hostHasScarecrow = true; netP = []; netSet = new Set();
    },
    palmPrompt(aim, base) {
      if (oldHost()) return null;
      const t = target(aim); if (!t || !isPecked(t.key)) return null;
      const rest = typeof base === 'string' ? base.replace(KBD_RE, '') : '';
      aimKey = t.key; aimLabel = rest.replace(/<[^>]*>/g, '').trim();
      return '<kbd>E</kbd>Shoo the gull' + (rest ? ' · ' + rest : '');
    },
    interact(aim) {
      if (oldHost()) return false;
      const t = target(aim); if (!t || !isPecked(t.key)) return false;
      shooKey(t.key);
      return true;
    },
    action(a, actor) {
      if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('scarecrow.')) return false;
      if (a.kind !== 'scarecrow.shoo' || !Number.isFinite(a.x) || !Number.isFinite(a.z)) return true;
      const pose = actor === 'guest' ? ctx.other : ctx.physics;
      if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z) || Math.hypot(a.x * 2 - pose.x, a.z * 2 - pose.z) > REACH + HOST_SLACK) return true;
      if (guest()) return true;
      const key = tileKey(a.x, a.z);
      find('wildlife')?.shoo?.(key);
      endPeck(key);
      return true;
    },
    decorModel(type) {
      if (!T || type !== 'scarecrow') return null;
      return createScarecrow3D(T);
    },
    debug: {
      state: () => ({ ...JSON.parse(JSON.stringify(st)), pecked: [...pecked], netP: [...netP], clock }),
      target: aim => target(aim),
      prompt: () => promptFor(null), // what window.raftPrompts shows for the shoo
      /** Host QA: two watered palms by the player and a scarecrow 3 tiles off (or 1 tile with protect). */
      scene({ protect = false } = {}) {
        const w = ctx.world; if (guest() || !w || !Array.isArray(w.tiles) || !Array.isArray(w.decor)) return null;
        const p = ctx.physics ?? { x: 0, z: 0 }, px = Math.round(p.x / 2), pz = Math.round(p.z / 2);
        const has = (x, z) => w.tiles.some(t => t[0] === x && t[1] === z);
        const held = (x, z) => w.decor.some(d => d && d.x === x && d.z === z);
        const free = (x, z) => !held(x, z) && !(x === px && z === pz);
        const claim = (x, z) => { if (!has(x, z)) w.tiles.push([x, z]); };
        // first palm: a free tile next to the player; second: next to the first
        let a = null;
        for (const [dx, dz] of [[0, -1], [1, 0], [-1, 0], [0, 1], [1, -1], [-1, -1]]) if (free(px + dx, pz + dz)) { a = [px + dx, pz + dz]; break; }
        if (!a) return null;
        let b = null;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, -1], [0, 1]]) if (free(a[0] + dx, a[1] + dz)) { b = [a[0] + dx, a[1] + dz]; break; }
        if (!b) return null;
        const sx = b[0] - a[0], sz = b[1] - a[1]; // the scarecrow goes along the palm row
        let c = null;
        const cands = protect ? [[a[0] - sx, a[1] - sz], [a[0] - sz, a[1] - sx], [a[0] + sz, a[1] + sx]] : [[b[0] + 3 * sx, b[1] + 3 * sz], [a[0] - 3 * sx, a[1] - 3 * sz], [a[0] + 3 * sz, a[1] + 3 * sx]];
        for (const [x, z] of cands) if (free(x, z)) { c = [x, z]; break; }
        if (!c) return null;
        for (const t of [a, b, c]) claim(t[0], t[1]);
        w.decor.push({ type: 'palm', x: a[0], z: a[1] }, { type: 'palm', x: b[0], z: b[1] }, { type: 'scarecrow', x: c[0], z: c[1] });
        if (!w.garden || typeof w.garden !== 'object') w.garden = {};
        const palms = [tileKey(a[0], a[1]), tileKey(b[0], b[1])];
        for (const k of palms) w.garden[k] = { water: 1, grow: 30 };
        ctx.rebuildRaft?.();
        const wild = find('wildlife');
        const per = wild?.debug?.perches ?? [];
        let idx = per.findIndex(q => q.kind === 'palm' && q.key === palms[0]);
        if (idx < 0) idx = per.findIndex(q => q.kind === 'palm');
        const hat = per.findIndex(q => q.kind === 'scarecrow');
        const landed = wild?.debug?.landGull?.(0, { perch: idx >= 0 ? idx : hat >= 0 ? hat : undefined, instant: true, stay: 30 }) ?? null;
        st = freshState(); acc = 0;
        hostTick(landed && landed.kind === 'palm' ? [{ i: 0, key: landed.key }] : []);
        return { palms, scarecrow: tileKey(c[0], c[1]), perch: landed ? landed.key : null, pecked: [...pecked] };
      },
      /** Acts as E on the pecked planter. */
      shoo() { const k = guest() ? netP[0] : [...pecked][0]; if (!k) return null; shooKey(k); return k; },
      /** Host QA: run the 1 Hz peck loop `sec` times. */
      fastForward(sec = 10) {
        if (guest()) return false;
        for (let n = Math.max(0, Math.floor(sec)); n > 0; n--) { clock += 1; hostTick(null); }
        return true;
      },
    },
    dispose() {
      crows.clear(); aimKey = null;
      try { unprompt?.(); } catch {} unprompt = null;
      const wild = find('wildlife'); if (wild && (wild.pecking === pecked || wild.pecking === netSet)) wild.pecking = EMPTY; // no stale head-bob
    },
  };
  return mod;
}
