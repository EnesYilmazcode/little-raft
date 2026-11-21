// Garden Bed crops: Sea Flax, Blushbell and Sweet Tuber (see docs/specs/crops.md). Content module 'crops'.
// Place a Garden Bed, plant a crop seed with E, water it with a fresh cup (E) or let the rain do it, and E harvests
// the ripe crop (the seed always comes back). Crops never wilt: a dry bed just pauses.
// Slice world.ext.crops, host-authoritative, actions 'crops.*'. Rules live in crops-rules.js.
import { CROPS, SEED_TO_CROP, WET_MAX, MAX_TICK, REACH, HOST_SLACK, OLD_HOST, TEXT, tileKey, cleanCrops, tickCrops, bedInfo, stage, plant, water, harvest } from './crops-rules.js?build=v3-survival-ae77fa84ac2b';
import { createGardenBed, paintBed } from './crops-models.js?build=v3-survival-ae77fa84ac2b';
import { addFood } from './vitals.js?build=v3-survival-ae77fa84ac2b';

// A click eats them (game.js useSelected -> startEat); registered at load on host and guest alike.
addFood('tuber', { food: 8, water: 2 });
addFood('roasttuber', { food: 25, water: 0 });

const isInt = Number.isInteger;
const RAIN_WET = .2; // same threshold as rain barrels (game.js wateringTarget)

export function createCrops(ctx) {
  const T = ctx.T;
  const session = Math.random().toString(36).slice(2, 10);
  let st = cleanCrops(undefined, null); st.s = session;
  let cache = null, cacheSt = null, cacheR = -1, netR = -1, netS = null, netUndef = false, hostHasCrops = true;
  let clock = 0;
  const beds = []; // {g, k} for each craft_gardenbed group in ctx.raft
  let scanLen = -1, scanFirst = null, scanRaft = null;
  const scratch = T ? new T.Vector3() : null, view = { c: null, stage: 0, wet: false };

  const isGuest = () => ctx.role === 'guest';
  const oldHost = () => isGuest() && !hostHasCrops;
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);
  const raining = () => { let r = 0; try { r = ctx.rain?.(); } catch { r = 0; } return Number.isFinite(r) && r > RAIN_WET; };
  const heldKind = () => { const b = ctx.localBag?.(); return b?.slots?.[b.selectedIndex]?.kind ?? null; };

  // The garden bed under the aim: the nearest bed along the view ray, else the aim point's tile. Within REACH.
  function target(aim) {
    const w = ctx.world, p = ctx.physics; if (!w || !p || !Array.isArray(w.decor)) return null;
    const near = d => Math.hypot(p.x - d.x * 2, p.z - d.z * 2) <= REACH;
    const cam = ctx.camera;
    if (cam && cam.position) {
      let dx, dy, dz;
      if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
      else if (scratch && typeof cam.getWorldDirection === 'function') { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
      if (dx !== undefined) {
        const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z, cy = (ctx.raft?.position?.y ?? 0) + .45;
        let best = null, bestScore = Infinity;
        for (let i = 0; i < w.decor.length; i++) {
          const d = w.decor[i]; if (!d || d.type !== 'gardenbed' || !near(d)) continue;
          const vx = d.x * 2 - ox, vy = cy - oy, vz = d.z * 2 - oz, along = vx * dx + vy * dy + vz * dz;
          if (along <= 0) continue;
          const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
          if (off > .6) continue;
          const score = off + along * .05;
          if (score < bestScore) { bestScore = score; best = d; }
        }
        if (best) return best;
      }
    }
    const pt = aim && aim.point; if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.z)) return null;
    const x = Math.round(pt.x / 2), z = Math.round(pt.z / 2);
    for (let i = 0; i < w.decor.length; i++) { const d = w.decor[i]; if (d && d.type === 'gardenbed' && d.x === x && d.z === z) return near(d) ? d : null; }
    return null;
  }

  // What E does on the bed `d` with `held`: {prompt, act} (act null = just a notice).
  function plan(d, held) {
    if (oldHost()) return { prompt: OLD_HOST, act: null };
    const info = bedInfo(st, decor(), d.x, d.z); if (!info) return null;
    const at = { x: d.x, z: d.z };
    if (!info.c) {
      const c = held && Object.prototype.hasOwnProperty.call(SEED_TO_CROP, held) ? SEED_TO_CROP[held] : null;
      return c ? { prompt: `<kbd>E</kbd>Plant ${CROPS[c].name}`, act: { kind: 'crops.plant', ...at, seed: held } } : { prompt: TEXT.empty, act: null };
    }
    const name = CROPS[info.c].name;
    if (info.stage === 2) return { prompt: `<kbd>E</kbd>Harvest ${name}`, act: { kind: 'crops.harvest', ...at } };
    if (info.w <= 0) return held === 'freshcup' ? { prompt: '<kbd>E</kbd>Water the bed', act: { kind: 'crops.water', ...at } } : { prompt: `${name} ${info.pct}% · dry, needs fresh water`, act: null };
    return { prompt: `${name} ${info.pct}% · ${raining() ? 'rain' : 'watered'}`, act: null };
  }

  function scanBeds() {
    const raft = ctx.raft; if (!raft) { beds.length = 0; return; }
    const kids = raft.children;
    if (raft === scanRaft && kids.length === scanLen && kids[0] === scanFirst) return;
    scanRaft = raft; scanLen = kids.length; scanFirst = kids[0];
    beds.length = 0;
    for (let i = 0; i < kids.length; i++) {
      const g = kids[i]; if (g.name !== 'craft_gardenbed') continue;
      beds.push({ g, k: tileKey(Math.round(g.position.x / 2), Math.round(g.position.z / 2)) });
    }
  }

  function paint() { // cheap per frame: paintBed returns early unless the bed's signature changed
    scanBeds(); if (!beds.length) return;
    const old = oldHost();
    for (let i = 0; i < beds.length; i++) {
      const e = old ? null : st.b[beds[i].k];
      if (e) { view.c = e.c; view.stage = stage(e); view.wet = e.w > 0; paintBed(beds[i].g, view); }
      else paintBed(beds[i].g, null);
    }
  }

  // raftPrompts provider: content prompts reach #lrPrompt only when no eat tip is showing, and a fresh cup or a
  // tuber in hand always has one. This keeps "E Water the bed" / "E Harvest" visible over the LMB drink tip.
  let unprovide = null;
  function provide() {
    const P = globalThis.raftPrompts; if (unprovide || typeof P?.provide !== 'function') return;
    try {
      unprovide = P.provide({ id: 'crops', priority: 1, prompt: pc => {
        const s = pc?.state; // yield to the built-in pickup / waiting prompts: pickups win E in game.js
        if (ctx.running === false || s?.pickup || (s?.role === 'guest' && !s.networkReady) || s?.swimming || ctx.uiOpen?.()) return null;
        const d = target(ctx.aim?.() ?? null); if (!d) return null;
        const p = plan(d, heldKind()); if (!p) return null;
        return parts(p.prompt);
      } });
    } catch { unprovide = () => {}; }
  }
  const partCache = new Map();
  function parts(html) {
    let v = partCache.get(html); if (v) return v;
    const m = /^<kbd>([^<]*)<\/kbd>(.*)$/.exec(html);
    v = m ? { key: m[1], label: m[2] } : { label: html, muted: true };
    if (partCache.size > 100) partCache.clear(); partCache.set(html, v);
    return v;
  }

  function load(data, from) {
    if (from === 'net') {
      if (data && typeof data === 'object' && data.r === netR && data.s === netS) return; // unchanged host state
      if (data === undefined && netUndef) return;
      netUndef = data === undefined; hostHasCrops = data !== undefined;
      st = cleanCrops(data, ctx.world?.decor);
      netR = data && typeof data === 'object' ? data.r : -1; netS = data && typeof data === 'object' ? data.s : null;
      return;
    }
    netR = -1; netS = null; netUndef = false; hostHasCrops = true;
    st = cleanCrops(data, ctx.world?.decor);
    st.s = session; st.r++;
  }

  function serialize() {
    if (cache && cacheSt === st && cacheR === st.r) return cache;
    cache = JSON.parse(JSON.stringify(st)); cacheSt = st; cacheR = st.r;
    return cache;
  }

  return {
    name: 'crops',
    load,
    serialize,
    update(dt) {
      if (T) paint();
      if (!unprovide) provide();
      if (!ctx.running || isGuest()) return;
      clock += dt > 0 ? dt : 0;
      if (clock >= 1) {
        const n = Math.min(MAX_TICK, Math.floor(clock)); clock -= Math.floor(clock);
        const ripe = tickCrops(st, ctx.world?.decor, n, raining());
        if (ripe.length) ctx.emit?.({ kind: 'notice', text: 'A garden bed is ready to harvest' }, 'all');
      }
    },
    prompt(aim) {
      const d = target(aim); if (!d) return null;
      return plan(d, heldKind())?.prompt ?? null;
    },
    interact(aim) {
      const d = target(aim); if (!d) return false;
      const p = plan(d, heldKind()); if (!p) return false;
      if (!p.act) { ctx.notice?.(p.prompt, 2400); return true; }
      ctx.action(p.act);
      return true;
    },
    action(a, actor, bag) {
      if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('crops.')) return false;
      if (!isInt(a.x) || !isInt(a.z)) return true;
      const pose = actor === 'guest' ? ctx.other : ctx.physics;
      if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z) || Math.hypot(a.x * 2 - pose.x, a.z * 2 - pose.z) > REACH + HOST_SLACK) return true;
      const d = decor();
      let r;
      if (a.kind === 'crops.plant') r = plant(st, d, a.x, a.z, a.seed, bag, raining());
      else if (a.kind === 'crops.water') r = water(st, d, a.x, a.z, bag);
      else if (a.kind === 'crops.harvest') r = harvest(st, d, a.x, a.z, bag);
      else return true;
      if (r.ok && r.kind === 'loot') ctx.emit?.({ kind: 'loot', text: r.text, loot: r.loot }, actor);
      else ctx.emit?.({ kind: 'notice', text: r.text }, actor);
      return true;
    },
    decorModel(type) {
      if (!T || type !== 'gardenbed') return null;
      return createGardenBed(T);
    },
    debug: {
      state: () => JSON.parse(JSON.stringify(st)),
      target: aim => { const d = target(aim); return d ? { x: d.x, z: d.z } : null; },
      list: () => decor().filter(d => d && d.type === 'gardenbed').map(d => ({ x: d.x, z: d.z, ...bedInfo(st, decor(), d.x, d.z) })),
      /** Host QA: put a garden bed on a free raft tile. */
      place(x, z) {
        const w = ctx.world;
        if (isGuest() || !isInt(x) || !isInt(z) || !w) return false;
        if (!w.tiles?.some(t => t[0] === x && t[1] === z) || decor().some(d => d.x === x && d.z === z)) return false;
        w.decor.push({ type: 'gardenbed', x, z }); ctx.rebuildRaft?.(); return true;
      },
      /** Host QA: plant crop c (flax | bell | tuber) in the bed at x,z without a seed. */
      plant(x, z, c) {
        if (isGuest() || !CROPS[c] || !bedInfo(st, decor(), x, z)) return false;
        st.b[tileKey(x, z)] = { c, g: 0, w: 0 }; st.r++; return true;
      },
      /** Host QA: set the grown seconds and water of a planted bed. */
      setGrow(x, z, g, w = 0) {
        const e = st.b[tileKey(x, z)]; if (isGuest() || !e) return false;
        e.g = Math.max(0, Math.min(CROPS[e.c].T, Math.floor(g))); e.w = Math.max(0, Math.min(WET_MAX, Math.floor(w))); st.r++; return true;
      },
      /** Host QA: run the grow rule for `sec` seconds (in MAX_TICK chunks). */
      fastForward(sec = 60, rain = false) {
        if (isGuest()) return false;
        let left = Math.max(0, Math.floor(sec));
        while (left > 0) { const n = Math.min(MAX_TICK, left); tickCrops(st, ctx.world?.decor, n, rain); left -= n; }
        return true;
      },
    },
    dispose() { beds.length = 0; if (unprovide) { try { unprovide(); } catch {} unprovide = null; } },
  };
}
