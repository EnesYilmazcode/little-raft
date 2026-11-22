// Cooking Pot content module (docs/specs/cookpot.md §4). Slice: world.ext.cookpot. Host-authoritative actions 'pot.*'.
// 3 ingredients + 1 wood simmer into 2 servings; a served meal gives ONE timed, gentle buff to the player who ate it.
// Pure rules live in cookpot-core.js. Buffs reach the engine through the live multiplier objects below, which must be
// imported with the SAME specifier as game.js / fishing-cooking.js so only one module instance exists.
import { POT, INGREDIENTS, MEALS, MEAL_IDS, NAMES, keyOf, blank, match, cleanEntry, cleanSlice, sliceOf, stepAll, tickBuffs, buffMods, cooking, progress, applyPotAction } from './cookpot-core.js?build=v3-survival-ae77fa84ac2b';
import { buildCookpot } from './cookpot-model.js?build=v3-survival-ae77fa84ac2b';
import { MOVE_MUL } from './player-physics.js?build=v3-survival-ae77fa84ac2b';
import { HOOK_MUL } from './hook-physics.js?build=v3-survival-ae77fa84ac2b';
import { FISHING_TUNING } from './fishing-v2.js?build=v3-survival-ae77fa84ac2b';

const MAX_SHOWN = 100;
const REEL_BASE = FISHING_TUNING.reelTime; // 3.5, read once at module load
const BUILD = (() => { try { return new URL(import.meta.url).searchParams.get('build') || 'dev'; } catch { return 'dev'; } })();
const SPRITE_URL = (() => {
  try { const u = new URL('icons.svg', import.meta.url); u.search = '?build=' + encodeURIComponent(BUILD); return u.href; }
  catch { return 'icons.svg'; }
})();
const mmss = s => { const t = Math.max(0, Math.ceil(s)); const m = Math.floor(t / 60), r = t % 60; return m + ':' + (r < 10 ? '0' : '') + r; };
const CSS = '.cpBuff{position:fixed;left:16px;bottom:96px;z-index:3;pointer-events:none;display:none;align-items:center;gap:6px;'
  + 'padding:3px 9px 3px 4px;border-radius:14px;background:rgba(9,20,30,.72);color:#fff2cc;font:600 12px system-ui}'
  + '.cpBuff svg{width:20px;height:20px;flex:none}@media(max-width:760px){.cpBuff{bottom:84px}}';

export function createCookpot(ctx) {
  const T = ctx.T;
  let st = { k: {}, b: { host: null, guest: null }, r: 0, br: 0 };
  let cache = null, cacheSt = null, cacheR = -1, cacheBr = -1, cacheS = -1;
  let netR = -1, netBr = -1, gotNet = false;
  let model = null, dirty = false, childCount = -1, shownR = -1, shownSt = null, anyActive = false;
  let clock = 0, pruneClock = 0;
  let nightE = NaN, nightH = NaN, baseE = 1, baseH = 1; // night floor: what we wrote and what it replaced
  let pKey = null, pR = -1, pSel = null, pPct = -1, pSt = null, pBowl = false, pOut = null;
  let lastMeal = null, quiet = true; // quiet: skip the "wore off" toast right after a load
  let chip = null, chipSpan = null, chipSec = -1, chipMeal = null;
  const groups = new Array(MAX_SHOWN).fill(null), gKeys = new Array(MAX_SHOWN).fill(null);
  let shown = 0;
  const scratch = T ? new T.Vector3() : null;
  const BLANK = Object.freeze(blank());
  const mods = buffMods(null, {});

  const decorAt = (x, z) => { const d = ctx.world?.decor; if (!Array.isArray(d)) return null; for (let i = 0; i < d.length; i++) if (d[i].x === x && d[i].z === z) return d[i].type; return null; };
  const posOf = actor => { if (actor === 'guest') return ctx.other ?? null; const p = ctx.physics; return p ? { x: p.x, z: p.z } : null; };
  const env = { decorAt, pos: posOf };
  const host = () => ctx.role !== 'guest';
  const mine = () => (ctx.role === 'guest' ? st.b.guest : st.b.host);
  const onDone = (key, e) => { ctx.emit({ kind: 'loot', text: `The pot is ready: ${e.n} ${MEALS[e.o].name}` }, 'all'); };

  // Nearest pot along the view ray (or the camera forward when no aim), within reach (kiln.js target()).
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else if (scratch) { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    else return null;
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (d.type !== 'cookpot') continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > POT.REACH) continue;
      const cy = (ctx.raft?.position.y ?? 0) + .45;
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > .75) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best;
  }
  const selKind = () => { const b = ctx.localBag?.(); const s = b && b.slots ? b.slots[b.selectedIndex] : null; return s ? s.kind : null; };
  const hasBowl = () => { const b = ctx.localBag?.(); return !!b && typeof b.count === 'function' && b.count('bowl') > 0; };

  function serialize() {
    const s = Math.ceil(st.b.host?.s ?? 0) * 1000 + Math.ceil(st.b.guest?.s ?? 0);
    if (cache && cacheSt === st && cacheR === st.r && cacheBr === st.br && cacheS === s) return cache;
    cache = sliceOf(st); cacheSt = st; cacheR = st.r; cacheBr = st.br; cacheS = s;
    return cache;
  }
  function load(data, from) {
    if (from !== 'net' || !gotNet) quiet = true; // net: only the first state replaces our own buff (a later expiry still toasts)
    if (from === 'net') {
      const ok = data && typeof data === 'object';
      const r = ok ? data.r : -2, br = ok ? data.br : -2; // -2: host without a cookpot slice (older build)
      const gs = ok && data.b && typeof data.b === 'object' && data.b.guest && Number.isFinite(data.b.guest.s) ? data.b.guest.s : 0;
      const ls = st.b.guest ? Math.ceil(st.b.guest.s) : 0;
      let c = null;
      if (r !== netR) { c = cleanSlice(data); st.k = c.k; st.r = c.r; netR = r; dirty = true; }
      if (br !== netBr || Math.abs(gs - ls) > 2) { c ??= cleanSlice(data); st.b = c.b; st.br = c.br; netBr = br; }
      gotNet = true;
      return;
    }
    netR = -1; netBr = -1; gotNet = false;
    st = cleanSlice(data, decorAt, from !== 'save'); dirty = true; // 'save': a past guest's buff is not kept
  }

  // ---- visuals
  function rescan() {
    shown = 0;
    const raft = ctx.raft; if (!raft) return;
    for (let c = 0; c < raft.children.length && shown < MAX_SHOWN; c++) {
      const g = raft.children[c]; if (g.name !== 'cookpot_station' || !g.userData.cookpot) continue;
      groups[shown] = g; gKeys[shown] = keyOf(Math.round(g.position.x * 500) / 1000, Math.round(g.position.z * 500) / 1000); shown++;
    }
    for (let i = shown; i < MAX_SHOWN; i++) { groups[i] = null; gKeys[i] = null; }
  }
  function apply() {
    anyActive = false;
    for (let i = 0; i < shown; i++) {
      const u = groups[i].userData.cookpot, e = st.k[gKeys[i]], on = cooking(e), ready = !!e && e.n > 0;
      u.glow.visible = on; u.steam.visible = on || ready; u.stew.visible = ready;
      if (ready && model.stewMats[e.o]) u.stew.material = model.stewMats[e.o];
      // lid rests on the pot; with servings waiting it slides aside so the stew shows
      u.lid.position.set(ready && !on ? -.12 : -.03, model.LID_Y + (ready && !on ? .02 : 0), -.02);
      u.lid.rotation.z = ready && !on ? .45 : .12;
      if (on || ready) anyActive = true;
    }
  }
  function visuals(dt) {
    const raft = ctx.raft; if (!raft || !model) return;
    let again = false;
    if (dirty || raft.children.length !== childCount) { rescan(); childCount = raft.children.length; dirty = false; again = true; }
    if (again || st.r !== shownR || st !== shownSt) { apply(); shownR = st.r; shownSt = st; }
    if (!anyActive) return;
    clock += dt > 0 ? dt : 0;
    const ph = model.flicker(clock);
    for (let i = 0; i < shown; i++) {
      const u = groups[i].userData.cookpot;
      if (u.steam.visible) { u.steam.position.y = model.STEAM_Y + ph * .28; const s = 1 + ph * .6; u.steam.scale.set(s, s, s); }
      if (u.glow.visible) u.lid.position.y = model.LID_Y + .012 * Math.sin(clock * 7 + i);
    }
  }

  // ---- HUD chip
  function ensureChip() {
    if (chip || typeof document === 'undefined' || !document.body) return chip;
    if (!document.getElementById('cookpotStyle')) {
      const s = document.createElement('style'); s.id = 'cookpotStyle'; s.textContent = CSS; document.head.appendChild(s);
    }
    chip = document.createElement('div'); chip.className = 'cpBuff';
    chip.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><use href="${SPRITE_URL}#icon-meal"></use></svg><span></span>`;
    chipSpan = chip.querySelector('span');
    document.body.appendChild(chip);
    return chip;
  }
  function hud(me) {
    if (!me) {
      if (chip && chipMeal !== null) { chip.style.display = 'none'; chipMeal = null; chipSec = -1; }
      return;
    }
    if (!ensureChip()) return;
    const sec = Math.ceil(me.s);
    if (chipMeal !== me.m) { chip.title = MEALS[me.m].name; chip.style.display = 'flex'; chipMeal = me.m; chipSec = -1; }
    if (sec !== chipSec) { chipSec = sec; chipSpan.textContent = MEALS[me.m].buff + ' ' + mmss(sec); }
  }

  function update(dt) {
    if (host()) {
      if (stepAll(st, dt, onDone)) st.r++;
      pruneClock += dt > 0 ? dt : 0;
      if (pruneClock >= 1) {
        pruneClock = 0;
        let cut = false;
        for (const key in st.k) {
          const c = key.indexOf(','), x = +key.slice(0, c), z = +key.slice(c + 1);
          if (decorAt(x, z) !== 'cookpot') { delete st.k[key]; cut = true; }
        }
        if (cut) st.r++;
      }
      if (tickBuffs(st.b, dt)) st.br++;
    } else tickBuffs(st.b, dt); // cosmetic; the host copy is authoritative
    const me = mine();
    buffMods(me, mods);
    MOVE_MUL.walk = mods.walk; MOVE_MUL.swim = mods.swim; MOVE_MUL.jump = Math.min(mods.jump, 1.15);
    HOOK_MUL.reel = mods.reel;
    FISHING_TUNING.reelTime = REEL_BASE / mods.reel;
    nightFloor(mods.night);
    const m = me ? me.m : null;
    if (lastMeal && !m && !quiet) ctx.notice?.(`${MEALS[lastMeal].buff} wore off`);
    lastMeal = m; quiet = false;
    visuals(dt);
    hud(me);
  }

  // daynight rewrites exposure/hemi every frame; without it (?daynight=off, day-only option, ?art) put back what we raised.
  function nightFloor(on) {
    const r = ctx.renderer, h = ctx.hemi;
    if (on) {
      // the floor is written a hair above 1.0 / 1.25 so it never equals a value daynight wrote itself
      if (r) { const v = r.toneMappingExposure; if (v !== nightE) { if (v < 1.0) { baseE = v; r.toneMappingExposure = nightE = 1.000001; } else nightE = NaN; } }
      if (h) { const v = h.intensity; if (v !== nightH) { if (v < 1.25) { baseH = v; h.intensity = nightH = 1.250001; } else nightH = NaN; } }
      return;
    }
    if (nightE === nightE) { if (r && r.toneMappingExposure === nightE) r.toneMappingExposure = baseE; nightE = NaN; }
    if (nightH === nightH) { if (h && h.intensity === nightH) h.intensity = baseH; nightH = NaN; }
  }

  function prompt(aim) {
    const esc = ctx.esc ?? (s => String(s));
    const d = target(aim), sel = selKind();
    if (!d) {
      if (!MEAL_IDS.includes(sel)) return null;
      const meal = MEALS[sel];
      if (pOut !== null && pKey === null && pSel === sel) return pOut;
      pOut = '<kbd>E</kbd>' + esc(`Eat ${meal.name} · ${meal.buff} ${mmss(meal.secs)}`);
      pKey = null; pSel = sel; pR = -1;
      return pOut;
    }
    const key = keyOf(d.x, d.z), e = st.k[key] ?? BLANK, pct = Math.round(progress(e) * 100), bowl = hasBowl();
    if (pOut !== null && key === pKey && st.r === pR && sel === pSel && pct === pPct && st === pSt && bowl === pBowl) return pOut;
    let verb;
    if (INGREDIENTS.includes(sel)) verb = `Add ${NAMES[sel]}`;
    else if (sel === 'wood') verb = 'Add wood';
    else if (MEAL_IDS.includes(sel)) verb = `Eat ${MEALS[sel].name}`;
    else if (e.n > 0) verb = `Take ${MEALS[e.o].name}` + (bowl ? '' : ' (need a bowl)');
    else if (e.i.length && e.h === 0) verb = `Take back ${NAMES[e.i[e.i.length - 1]]}`;
    else verb = 'Cooking Pot';
    const parts = [];
    if (e.h === 1) parts.push(`${MEALS[e.c].name} simmering ${pct}%`);
    else if (e.i.length === 3) { const m = match(e.i); parts.push('3/3 ' + (m ? MEALS[m].name : 'no recipe')); }
    else parts.push(`${e.i.length}/3`);
    parts.push(`fuel ${e.f}`);
    if (e.n > 0) parts.push(`${e.n} ready`);
    pOut = '<kbd>E</kbd>' + esc(verb) + ' · ' + esc(parts.join(' · '));
    pKey = key; pR = st.r; pSel = sel; pPct = pct; pSt = st; pBowl = bowl;
    return pOut;
  }

  function interact(aim) {
    const d = target(aim), sel = selKind();
    if (!d && !MEAL_IDS.includes(sel)) return false;
    if (ctx.role === 'guest' && !gotNet) { ctx.notice?.('Wait for your raft to connect'); return true; }
    if (!d) { ctx.action({ kind: 'pot.eat', item: sel }); return true; }
    const e = st.k[keyOf(d.x, d.z)];
    if (INGREDIENTS.includes(sel)) ctx.action({ kind: 'pot.add', x: d.x, z: d.z, item: sel });
    else if (sel === 'wood') ctx.action({ kind: 'pot.fuel', x: d.x, z: d.z });
    else if (MEAL_IDS.includes(sel)) ctx.action({ kind: 'pot.eat', item: sel });
    else if (e && e.n > 0) ctx.action({ kind: 'pot.take', x: d.x, z: d.z });
    else if (e && e.i.length && e.h === 0) ctx.action({ kind: 'pot.back', x: d.x, z: d.z });
    else ctx.notice?.('Add 3 ingredients and some wood');
    return true;
  }

  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('pot.')) return false;
    const r = applyPotAction(st, a, actor, bag, env);
    if (r.ok) ctx.emit({ kind: a.kind === 'pot.take' || a.kind === 'pot.eat' ? 'loot' : 'build', text: r.text }, actor);
    else ctx.emit({ kind: r.reason === 'bagfull' ? 'full' : 'notice', text: r.text }, actor);
    return true;
  }

  const bump = () => { st.r++; };
  const debug = {
    state() {
      const s = JSON.parse(JSON.stringify(sliceOf(st)));
      s.cooking = Object.keys(st.k).filter(k => cooking(st.k[k]));
      return s;
    },
    spawn(x = 0, z = 0) {
      if (!host()) return false;
      const w = ctx.world; if (!w || !Array.isArray(w.decor) || !Array.isArray(w.tiles)) return false;
      if (decorAt(x, z) === 'cookpot') return true;
      if (decorAt(x, z) || !w.tiles.some(t => t[0] === x && t[1] === z)) return false;
      w.decor.push({ type: 'cookpot', x, z }); ctx.rebuildRaft?.(); dirty = true;
      return true;
    },
    give(kind, n = 10) { if (!host()) return false; const b = ctx.localBag?.(); return b ? n - b.add(kind, n) : 0; },
    fill(x, z, entry) {
      if (!host()) return false;
      const e = cleanEntry(entry), key = keyOf(x, z);
      if (e) st.k[key] = e; else delete st.k[key];
      bump(); return true;
    },
    finish(x, z) {
      if (!host()) return false;
      const e = st.k[keyOf(x, z)]; if (!e || e.h !== 1) return false;
      e.t = POT.COOK; stepAll(st, 0, onDone);
      bump(); return true;
    },
    run(sec) {
      if (!host()) return false;
      const n = Math.max(0, Math.min(3600, Math.floor(+sec || 0)));
      for (let i = 0; i < n; i++) stepAll(st, 1, onDone);
      bump(); return true;
    },
    feed(meal, actor = 'host') {
      if (!host() || !MEALS[meal] || (actor !== 'host' && actor !== 'guest')) return false;
      st.b[actor] = { m: meal, s: MEALS[meal].secs }; st.br++; return true;
    },
    buff() { const me = mine(); return { entry: me ? { m: me.m, s: me.s } : null, mods: { ...mods }, light: { exposure: ctx.renderer?.toneMappingExposure ?? null, hemi: ctx.hemi?.intensity ?? null } }; },
    clear() { if (!host()) return false; st.k = {}; st.b = { host: null, guest: null }; st.br++; bump(); return true; },
  };

  return {
    name: 'cookpot',
    serialize, load, action, interact, prompt, update, debug,
    diveMods(m) { if (mods.swim !== 1) m.swim *= mods.swim; if (mods.oxy !== 1) m.oxy *= mods.oxy; },
    decorModel(type) {
      if (!T || type !== 'cookpot') return null;
      model ??= buildCookpot(T); dirty = true; return model.instance();
    },
    dispose() {
      chip?.remove(); chip = null; chipSpan = null; chipMeal = null;
      if (typeof document !== 'undefined') document.getElementById('cookpotStyle')?.remove();
      MOVE_MUL.walk = MOVE_MUL.swim = MOVE_MUL.jump = 1; HOOK_MUL.reel = 1; FISHING_TUNING.reelTime = REEL_BASE;
      nightFloor(false);
      model?.dispose(); model = null;
    },
  };
}
