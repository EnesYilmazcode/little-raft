// Friendly storms + Lightning Rod (content module, docs/specs/storm.md). Nothing is ever hurt, broken or lost to weather:
// this module never calls ctx.hurtPlayer, never removes tiles or decor, and bolts only land on open sea (20 m or more
// from the raft) or on a Lightning Rod. Storms and strikes are pure functions of the daynight (seed, clock) that co-op
// already syncs, so every client draws the same bolts. Only the rod reward goes through the host (world.ext.storm).
import { STORM_LIVE, isStormSegment, segmentStart, segmentIndexAt, hash01 } from './daynight.js?build=v3-survival-ae77fa84ac2b';
import { stormMaterials, buildRod, buildLamp, buildStormGlass, buildBolt } from './storm-model.js?build=v3-survival-ae77fa84ac2b';

export const STRIKE = Object.freeze({ LEAD: 30, END: 45, GAP_MIN: 6, GAP_SPAN: 12, MAX_K: 62, R_MIN: 20, R_SPAN: 60, ROD_PULL: 32, TOP: 70 });
export const STORM_AMP = 0.3, ROD_MAX = 3, REACH = 3.2, MAX_RODS = 256, FORECAST_SEGMENTS = 24;
const KEY_RE = /^-?\d{1,6},-?\d{1,6}$/;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------- pure strike schedule (salts 4-7)
export const strikeId = (i, k) => i * 64 + k; // k 0..62; 63 is reserved and never scheduled
const gapOf = (seed, i, j) => STRIKE.GAP_MIN + STRIKE.GAP_SPAN * hash01(seed, strikeId(i, j), 4);
export function strikeTime(seed, i, k) {
  let t = segmentStart(seed, i) + STRIKE.LEAD;
  for (let j = 0; j <= k; j++) t += gapOf(seed, i, j);
  return t;
}
export const strikeEnd = (seed, i) => segmentStart(seed, i + 1) - STRIKE.END;
export function strikeValid(seed, i, k, t = strikeTime(seed, i, k)) { return k >= 0 && k <= STRIKE.MAX_K && t < strikeEnd(seed, i); }
// Every strike of storm segment i as [{k, id, t}] (tests and debug only; allocates).
export function strikeList(seed, i) {
  const out = [], end = strikeEnd(seed, i);
  let t = segmentStart(seed, i) + STRIKE.LEAD;
  for (let k = 0; k <= STRIKE.MAX_K; k++) { t += gapOf(seed, i, k); if (t >= end) break; out.push({ k, id: strikeId(i, k), t }); }
  return out;
}
export function strikePos(seed, id, out) {
  out.a = 2 * Math.PI * hash01(seed, id, 5);
  out.r = STRIKE.R_MIN + STRIKE.R_SPAN * hash01(seed, id, 6);
  return out;
}
export function rodFor(seed, id, r, rodKeys) {
  return r < STRIKE.ROD_PULL && rodKeys && rodKeys.length ? rodKeys[Math.floor(hash01(seed, id, 7) * rodKeys.length)] : null;
}

// ---------------------------------------------------------------- strike driver (pure state machine, no allocation)
export function makeDriver() { return { seed: -1, seg: NaN, k: 0, tNext: Infinity, end: -Infinity, last: NaN }; }
function resync(d, seed, i, clock) {
  d.seed = seed; d.seg = i; d.end = strikeEnd(seed, i); d.k = STRIKE.MAX_K + 1; d.tNext = Infinity;
  let t = segmentStart(seed, i) + STRIKE.LEAD;
  for (let k = 0; k <= STRIKE.MAX_K; k++) {
    t += gapOf(seed, i, k);
    if (t >= d.end) break;
    if (t > clock) { d.k = k; d.tNext = t; break; }
  }
}
// Fires fire(k, id, t) for every strike with last < t <= clock. A clock that went backwards or jumped > 2 s
// (guest snap, sleep skip, load) or a new segment/seed resyncs to the first strike after clock without firing.
export function stepDriver(d, seed, clock, on, i, fire) {
  if (!on || !Number.isFinite(clock)) { d.seg = NaN; d.last = clock; return 0; }
  if (seed !== d.seed || i !== d.seg || !(clock >= d.last) || clock - d.last > 2) { resync(d, seed, i, clock); d.last = clock; return 0; }
  let n = 0;
  while (d.tNext <= clock) {
    fire(d.k, strikeId(i, d.k), d.tNext); n++;
    d.k++;
    if (d.k > STRIKE.MAX_K) { d.tNext = Infinity; break; }
    const t = d.tNext + gapOf(seed, i, d.k);
    d.tNext = t < d.end ? t : Infinity;
  }
  d.last = clock;
  return n;
}

// ---------------------------------------------------------------- flash (WCAG 2.3.1: strikes are >= 6 s apart)
export function flashAt(t, mode) {
  if (!(t >= 0) || mode === 'off') return 0;
  if (mode === 'soft') return t < 0.6 ? 0.25 * Math.sin(Math.PI * t / 0.6) : 0;
  if (t <= 0.06) return 1;
  if (t < 0.11) return 1 - 0.8 * (t - 0.06) / 0.05;
  if (t < 0.16) return 0.2 + 0.5 * (t - 0.11) / 0.05;
  if (t <= 0.2) return 0.7;
  if (t < 0.32) return 0.7 * (1 - (t - 0.2) / 0.12);
  return 0;
}
export const flashScale = r => clamp(1.15 - r / 100, 0.4, 1);
export const thunderDelay = (r, rod) => (rod ? 0.35 : 0.6 + 2.4 * clamp((r - 20) / 60, 0, 1));
export const thunderStrength = r => clamp(1.1 - r / 90, 0.3, 1);

// ---------------------------------------------------------------- slice (world.ext.storm)
export const keyOf = (x, z) => x + ',' + z;
export function cleanSlice(v, decorAt) {
  const out = { v: 1, r: 0, rods: {} };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  out.r = Number.isInteger(v.r) && v.r >= 0 ? v.r : 0;
  const rods = v.rods;
  if (!rods || typeof rods !== 'object' || Array.isArray(rods)) return out;
  let count = 0;
  for (const key of Object.keys(rods)) {
    if (count >= MAX_RODS) break;
    if (!KEY_RE.test(key)) continue;
    const c = key.indexOf(','), x = +key.slice(0, c), z = +key.slice(c + 1);
    if (keyOf(x, z) !== key) continue; // "01,1" or "-0,1" would shadow the real "1,1" / "0,1" entry and never be paid or pruned
    const e = rods[key];
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    if (decorAt && decorAt(x, z) !== 'stormrod') continue;
    const n = Number.isInteger(e.n) ? clamp(e.n, 0, ROD_MAX) : 0;
    const last = Number.isInteger(e.last) && e.last >= -1 ? e.last : -1;
    if (n === 0 && last === -1) continue;
    out.rods[key] = { n, last };
    count++;
  }
  return out;
}
export function sliceOf(st) {
  const rods = {};
  for (const k in st.rods) rods[k] = { n: st.rods[k].n, last: st.rods[k].last };
  return { v: 1, r: st.r, rods };
}
// Host only. Once-per-strike guard keyed by the strike id (survives a clock resync). -> false | 'full' | 'grew'
export function award(st, key, id) {
  const e = st.rods[key] ?? { n: 0, last: -1 };
  if (!Number.isInteger(id) || id <= e.last) return false;
  e.last = id;
  const grew = e.n < ROD_MAX;
  if (grew) e.n++;
  st.rods[key] = e; st.r++;
  return grew ? 'grew' : 'full';
}
// Next storm segment after the current one, within FORECAST_SEGMENTS. Writes out {index, start, inSec}; index -1 = none.
export function nextStorm(seed, clock, out) {
  const i0 = segmentIndexAt(seed, clock);
  out.index = -1; out.start = 0; out.inSec = Infinity;
  for (let j = i0 + 1; j <= i0 + FORECAST_SEGMENTS; j++) {
    if (isStormSegment(seed, j)) { out.index = j; out.start = segmentStart(seed, j); out.inSec = out.start - clock; break; }
  }
  return out;
}

// ---------------------------------------------------------------- module
export function createStorm(ctx, { peek } = {}) {
  const T = ctx.T;
  const L = STORM_LIVE;
  let st = { v: 1, r: 0, rods: {} };
  let cache = null, cacheSt = null, cacheR = -1, netR = -1;
  let M = null, rodModel = null, lampModel = null, glassModel = null, bolt = null, boltScene = null;
  let time = 0, scanClock = 0, pruneClock = 0, foreClock = 1, childCount = -1, dirty = true, shownR = -1, shownSt = null;
  let amp = 1, lampI = -1, crystalS = 0.3, decorSig = NaN;
  const drv = makeDriver();
  const SP = { a: 0, r: 0 };
  const FC = { index: -1, start: 0, inSec: Infinity };
  // the last strike shown on this client (visual + thunder, local only)
  let flashT0 = -1e9, flashR = 50, flashOn = false, thunderAt = -1, thunderS = 0, strikes = 0;
  let forced = false, forceNext = 0, forceN = 0, poseT = NaN; // poseT: debug pin of the flash time (screenshots)
  let noticedIndex = null, hinted = false;
  const MAX_SHOWN = 64;
  const rodG = new Array(MAX_SHOWN).fill(null), rodK = new Array(MAX_SHOWN).fill(null), lampG = new Array(MAX_SHOWN).fill(null), glassG = new Array(MAX_SHOWN).fill(null);
  let nRod = 0, nLamp = 0, nGlass = 0;
  const rodKeys = []; // sorted "x,z" of every stormrod decor (same on both peers); rebuilt only when the decor changes
  const vA = T ? new T.Vector3() : null, vB = T ? new T.Vector3() : null, vC = T ? new T.Vector3() : null;
  let reduced = null;
  try { reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null; } catch { reduced = null; }

  const host = () => ctx.role !== 'guest';
  const decorAt = (x, z) => { const d = ctx.world?.decor; if (!Array.isArray(d)) return null; for (let i = 0; i < d.length; i++) if (d[i].x === x && d[i].z === z) return d[i].type; return null; };
  const posOf = actor => { if (actor === 'guest') return ctx.other ?? null; const p = ctx.physics; return p ? { x: p.x, z: p.z } : null; };
  const esc = s => (ctx.esc ? ctx.esc(s) : String(s));
  const flashMode = () => { const m = ctx.options?.stormFlash ?? 'full'; return m === 'full' && reduced?.matches ? 'soft' : m === 'soft' || m === 'off' ? m : 'full'; };
  const now = () => (Number.isFinite(ctx.elapsed) ? ctx.elapsed : time);

  // ---- save / net
  function serialize() {
    if (cache && cacheSt === st && cacheR === st.r) return cache;
    cache = sliceOf(st); cacheSt = st; cacheR = st.r;
    return cache;
  }
  function load(data, from) {
    if (from === 'net') {
      const r = data && typeof data === 'object' ? data.r : -2; // -2: host without a storm slice (older build)
      if (r === netR) return; // unchanged host state
      st = cleanSlice(data); netR = r; dirty = true;
      return;
    }
    netR = -1;
    st = cleanSlice(data, ctx.world ? decorAt : undefined); dirty = true;
  }

  // ---- decor: rod keys for strike picks, model groups for visuals
  function decorSignature() {
    const d = ctx.world?.decor; if (!Array.isArray(d)) return 0;
    let s = d.length * 31;
    for (let i = 0; i < d.length; i++) if (d[i].type === 'stormrod') s = (s + 1 + Math.imul(d[i].x | 0, 73856093) ^ Math.imul(d[i].z | 0, 19349663)) | 0;
    return s;
  }
  function rebuildRodKeys() {
    rodKeys.length = 0;
    const d = ctx.world?.decor;
    if (Array.isArray(d)) for (let i = 0; i < d.length; i++) if (d[i].type === 'stormrod' && Number.isInteger(d[i].x) && Number.isInteger(d[i].z)) rodKeys.push(keyOf(d[i].x, d[i].z));
    rodKeys.sort();
  }
  function rescanModels() {
    nRod = nLamp = nGlass = 0;
    const raft = ctx.raft;
    if (raft) for (let c = 0; c < raft.children.length; c++) {
      const g = raft.children[c];
      if (g.name === 'storm_rod' && g.userData.rod && nRod < MAX_SHOWN) { rodG[nRod] = g; rodK[nRod] = keyOf(Math.round(g.position.x / 2), Math.round(g.position.z / 2)); nRod++; }
      else if (g.name === 'storm_lamp' && nLamp < MAX_SHOWN) lampG[nLamp++] = g;
      else if (g.name === 'storm_glass' && g.userData.crystals && nGlass < MAX_SHOWN) glassG[nGlass++] = g;
    }
    for (let i = nRod; i < MAX_SHOWN; i++) { rodG[i] = null; rodK[i] = null; }
    for (let i = nLamp; i < MAX_SHOWN; i++) lampG[i] = null;
    for (let i = nGlass; i < MAX_SHOWN; i++) glassG[i] = null;
    if (nGlass) for (let i = 0; i < nGlass; i++) glassG[i].userData.crystals.scale.y = crystalS;
  }
  function applySlots() {
    for (let i = 0; i < nRod; i++) {
      const e = st.rods[rodK[i]], n = e ? e.n : 0, s = rodG[i].userData.rod.slots;
      for (let j = 0; j < s.length; j++) s[j].visible = j < n;
    }
  }

  // ---- strikes
  function strikeVisual(a, r, rodKey, id, seed) {
    strikes++;
    const t0 = now();
    flashT0 = t0; flashR = rodKey ? 3 : r; flashOn = true;
    thunderAt = t0 + thunderDelay(r, !!rodKey); thunderS = rodKey ? 1 : thunderStrength(r);
    const mode = flashMode();
    if (mode !== 'full' || !T || !ctx.scene) { if (bolt) bolt.mesh.visible = false; return; }
    if (!bolt) bolt = buildBolt(T);
    if (boltScene !== ctx.scene) { if (boltScene) boltScene.remove(bolt.mesh); boltScene = ctx.scene; boltScene.add(bolt.mesh); }
    const raft = ctx.raft;
    // target: the rod tip, else the open sea r metres from the raft (world axes)
    let found = false;
    if (rodKey) {
      for (let i = 0; i < nRod; i++) if (rodK[i] === rodKey) { const tp = rodG[i].userData.rod.tip; vB.set(tp[0], tp[1], tp[2]); rodG[i].localToWorld(vB); found = true; break; }
      if (!found && raft) { const c = rodKey.indexOf(','); vB.set(+rodKey.slice(0, c) * 2, 0.22 + 2.6, +rodKey.slice(c + 1) * 2); raft.localToWorld(vB); found = true; }
    }
    if (!found) {
      if (raft) raft.getWorldPosition(vC); else vC.set(0, 0, 0);
      vB.set(vC.x + Math.cos(a) * r, 0, vC.z + Math.sin(a) * r);
    }
    const ja = 2 * Math.PI * hash01(seed, id, 30), jr = 4 + 10 * hash01(seed, id, 31);
    vA.set(vB.x + Math.cos(ja) * jr, STRIKE.TOP, vB.z + Math.sin(ja) * jr);
    bolt.write(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, seed, id, hash01, rodKey ? 0.035 : 0.32);
    bolt.mesh.material.opacity = 1;
    bolt.mesh.visible = true;
  }
  // Fired by the schedule driver on every client. Rewards are host only.
  const onStrike = (k, id) => {
    const seed = L.seed;
    strikePos(seed, id, SP);
    const rod = rodFor(seed, id, SP.r, rodKeys);
    strikeVisual(SP.a, SP.r, rod, id, seed);
    if (rod && host()) {
      const c = rod.indexOf(',');
      if (decorAt(+rod.slice(0, c), +rod.slice(c + 1)) === 'stormrod' && award(st, rod, id) === 'grew') {
        ctx.emit?.({ kind: 'loot', text: `Zap! The Lightning Rod caught a Storm Shard (${st.rods[rod].n}/${ROD_MAX})` }, 'all');
      }
    }
  };

  function visuals(dt) {
    const mode = flashMode();
    const t = Number.isFinite(poseT) ? poseT : now() - flashT0;
    if (flashOn) {
      const f = flashAt(t, mode) * flashScale(flashR);
      L.flash = f > 0 ? Math.min(1, f) : 0;
      if (bolt && bolt.mesh.visible) {
        if (t >= 0.3 || mode !== 'full') bolt.mesh.visible = false;
        else bolt.mesh.material.opacity = Math.max(0.2, flashAt(t, 'full'));
      }
      if (t > 0.7) { flashOn = false; L.flash = 0; if (bolt) bolt.mesh.visible = false; }
    } else if (L.flash !== 0) L.flash = 0;
    if (thunderAt >= 0 && now() >= thunderAt) { thunderAt = -1; ctx.play?.('thunder', thunderS); }
    // lantern glow (shared materials; only when the value changes)
    if (M && nLamp > 0) {
      const v = Math.round((0.35 + 1.25 * L.nf + (L.level > 0.5 ? 0.3 : 0)) * 100) / 100;
      if (v !== lampI) { lampI = v; M.shard.emissiveIntensity = v; M.lampGlass.emissiveIntensity = v; }
    }
    if (nGlass > 0) {
      const target = L.level > 0.05 || (FC.index >= 0 && FC.inSec <= 300) ? 1 : 0.3;
      if (Math.abs(target - crystalS) > 0.002) {
        crystalS += (target - crystalS) * Math.min(1, dt * 0.6);
        for (let i = 0; i < nGlass; i++) glassG[i].userData.crystals.scale.y = crystalS;
      }
    }
  }

  function update(dt) {
    if (!(dt > 0)) dt = 0; else if (dt > 0.25) dt = 0.25;
    time += dt;
    const raft = ctx.raft;
    // 0.5 s rescan (kiln childCount pattern)
    scanClock += dt;
    if (dirty || (raft && raft.children.length !== childCount) || scanClock >= 0.5) {
      const sig = decorSignature();
      if (sig !== decorSig) { decorSig = sig; rebuildRodKeys(); }
      if (dirty || (raft && raft.children.length !== childCount)) { rescanModels(); childCount = raft ? raft.children.length : -1; shownR = -1; }
      scanClock = 0; dirty = false;
    }
    if (st.r !== shownR || st !== shownSt) { applySlots(); shownR = st.r; shownSt = st; }
    // host: forget rods whose tile no longer holds a Lightning Rod
    if (host() && Array.isArray(ctx.world?.decor)) { // no world yet (or mid-swap): never mistake it for "every rod removed"
      pruneClock += dt;
      if (pruneClock >= 1) {
        pruneClock = 0;
        let cut = false;
        for (const key in st.rods) { const c = key.indexOf(','); if (decorAt(+key.slice(0, c), +key.slice(c + 1)) !== 'stormrod') { delete st.rods[key]; cut = true; } }
        if (cut) st.r++;
      }
    }
    if (!L.ready) { // ?daynight=off or not started: always calm
      if (amp !== 1) { amp = 1; ctx.ocean?.setAmp?.(1); }
      if (L.flash !== 0) L.flash = 0;
      if (bolt) bolt.mesh.visible = false;
      flashOn = false;
      return;
    }
    const level = L.level;
    // waves: level is a 40 s ease, so this never jumps
    const a = 1 + STORM_AMP * level;
    if (Math.abs(a - amp) > 0.002 || (level === 0 && amp !== 1)) { amp = level === 0 ? 1 : a; ctx.ocean?.setAmp?.(amp); }
    // forecast (storm glass prompt and crystals), once a second
    foreClock += dt;
    if (foreClock >= 1) { foreClock = 0; nextStorm(L.seed, L.clock, FC); }
    // real strikes from the schedule (not the debug pin)
    stepDriver(drv, L.seed, L.clock, L.on, L.index, onStrike);
    // debug force: local strikes every ~8 s while no real storm runs (visual + thunder only, never rewards)
    if (forced && !L.on && time >= forceNext) {
      forceN++;
      const id = 0x7fff0000 + forceN;
      strikePos(L.seed, id, SP);
      strikeVisual(SP.a, SP.r, rodFor(L.seed, id, SP.r, rodKeys), id, L.seed);
      forceNext = time + 8 * (0.75 + 0.5 * hash01(L.seed, forceN, 8));
    }
    visuals(dt);
    // HUD hint (pickup feed, bottom-left, never centred)
    if (L.on && level > 0.05 && L.index !== noticedIndex) {
      noticedIndex = L.index;
      ctx.notice?.('A storm is rolling in', 4000);
      if (!hinted && rodKeys.length === 0) {
        let learned = false;
        try { const s = peek?.('storage'); learned = !!(s && Array.isArray(s.learned) && s.learned.includes('stormrod')); } catch { learned = false; }
        if (learned) { hinted = true; ctx.notice?.('Lightning Rods catch Storm Shards'); }
      }
    }
  }

  // ---- aim target: closest rod / storm glass to the view ray (vertical-segment test), within reach
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else { cam.getWorldDirection(vC); dx = vC.x; dy = vC.y; dz = vC.z; }
    const hh = dx * dx + dz * dz; if (hh < 1e-6) return null;
    const base = (ctx.raft?.position.y ?? 0) + 0.22;
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i];
      const tall = d.type === 'stormrod' ? 2.6 : d.type === 'stormglass' ? 0.55 : 0; if (!tall) continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      const tt = ((cx - ox) * dx + (cz - oz) * dz) / hh; if (tt <= 0) continue;
      const hx = ox + dx * tt - cx, hz = oz + dz * tt - cz, off = Math.sqrt(hx * hx + hz * hz);
      if (off > (tall > 1 ? 0.45 : 0.35)) continue;
      const y = oy + dy * tt; if (y < base - 0.15 || y > base + tall + 0.15) continue;
      const score = off + tt * 0.05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  // Info-only prompts start with an empty <kbd>: content.promptParts makes them a muted row in #lrPrompt, and
  // prompts.js does not echo them into the event feed every time the player looks at the rod.
  const INFO = '<kbd></kbd>';
  let pKey = null, pR = -1, pB = -1, pSt = null, pOut = null;
  function prompt(aim) {
    const d = target(aim); if (!d) return null;
    const key = keyOf(d.x, d.z);
    const stormNow = L.ready && L.level > 0.05;
    const bucket = d.type === 'stormglass' ? (stormNow ? -1 : FC.index < 0 ? -2 : Math.max(1, Math.round(FC.inSec / 60))) : (L.ready && L.level > 0.05 ? 1 : 0);
    if (pOut !== null && key === pKey && st.r === pR && st === pSt && bucket === pB) return pOut;
    let html;
    if (d.type === 'stormglass') {
      html = 'Storm Glass · ' + (bucket === -1 ? 'Storm now!' : bucket === -2 ? 'Fair skies for a good while' : `A storm in about ${bucket} min`);
      html = INFO + esc(html);
    } else {
      const n = st.rods[key]?.n ?? 0;
      if (n > 0) html = '<kbd>E</kbd>' + esc(`Collect ${n} Storm Shard${n === 1 ? '' : 's'}`);
      else html = INFO + esc(bucket ? 'Lightning Rod · waiting for a strike' : 'Lightning Rod · catches lightning in storms');
    }
    pOut = html; pKey = key; pR = st.r; pSt = st; pB = bucket;
    return pOut;
  }

  function interact(aim) {
    const d = target(aim); if (!d || d.type !== 'stormrod') return false;
    const e = st.rods[keyOf(d.x, d.z)];
    if (!e || e.n <= 0) return false;
    ctx.action({ kind: 'storm.collect', x: d.x, z: d.z });
    return true;
  }

  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('storm.')) return false;
    if (!host()) return true; // guest-sent actions are only applied by the host
    if (a.kind !== 'storm.collect') return true;
    const x = a.x, z = a.z;
    if (!Number.isInteger(x) || !Number.isInteger(z) || decorAt(x, z) !== 'stormrod') return true;
    const p = posOf(actor);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || Math.hypot(p.x - x * 2, p.z - z * 2) > REACH) return true;
    const key = keyOf(x, z), e = st.rods[key];
    if (!e || e.n <= 0) { ctx.emit?.({ kind: 'notice', text: 'No shards yet. Wait for a storm' }, actor); return true; }
    if (!bag || typeof bag.add !== 'function') return true;
    const left = bag.add('stormshard', e.n), got = e.n - (Number.isInteger(left) ? left : e.n);
    if (got <= 0) { ctx.emit?.({ kind: 'full', text: 'Your bag is full' }, actor); return true; }
    e.n -= got; st.r++;
    ctx.emit?.({ kind: 'loot', text: `+${got} Storm Shard${got === 1 ? '' : 's'}` }, actor);
    return true;
  }

  function decorModel(type) {
    if (!T) return null;
    if (type !== 'stormrod' && type !== 'stormlamp' && type !== 'stormglass') return null;
    M ??= stormMaterials(T);
    dirty = true; lampI = -1;
    if (type === 'stormrod') { rodModel ??= buildRod(T, M); return rodModel.instance(); }
    if (type === 'stormlamp') { lampModel ??= buildLamp(T, M); return lampModel.instance(); }
    glassModel ??= buildStormGlass(T, M); return glassModel.instance();
  }

  function dispose() {
    ctx.ocean?.setAmp?.(1); amp = 1;
    L.flash = 0; L.pin = -1; L.dirty = true;
    if (bolt) { boltScene?.remove(bolt.mesh); bolt.dispose(); bolt = null; boltScene = null; }
    rodModel?.dispose(); lampModel?.dispose(); glassModel?.dispose(); M?.dispose();
    rodModel = lampModel = glassModel = M = null;
  }

  const debug = {
    state() {
      const out = { slice: JSON.parse(JSON.stringify(sliceOf(st))), level: L.level, on: L.on, index: L.index, ready: L.ready, flash: L.flash, mode: flashMode(), forced, strikes, rodKeys: rodKeys.slice(), next: null };
      if (L.ready && L.on && Number.isFinite(drv.tNext)) {
        const id = strikeId(L.index, drv.k), p = strikePos(L.seed, id, { a: 0, r: 0 });
        out.next = { k: drv.k, t: drv.tNext, inSec: drv.tNext - L.clock, r: p.r, rod: rodFor(L.seed, id, p.r, rodKeys) };
      }
      if (bolt) { const q = bolt.mesh.geometry.attributes.position.array, e = 12 * 12; out.bolt = { visible: bolt.mesh.visible, opacity: bolt.mesh.material.opacity, top: [q[0] + 0.25, q[1], q[2]], end: [q[e] + 0.25 * 0.65, q[e + 1], q[e + 2]] }; }
      return out;
    },
    slice: () => st,
    force(level = 1) {
      if (level === null || level === undefined || level === false) { forced = false; L.pin = -1; L.dirty = true; return true; }
      const v = Number(level); if (!Number.isFinite(v)) return false;
      forced = v > 0; L.pin = clamp(v, 0, 1); L.dirty = true; forceNext = time + 1.5;
      return true;
    },
    strike(o = {}) {
      if (now() - flashT0 < 1 && !Number.isFinite(poseT)) return false;
      const id = 0x7ffe0000 + (strikes & 0xffff);
      if (o && typeof o.rod === 'string') { strikeVisual(0, 3, o.rod, id, L.seed); return true; }
      const a = Number.isFinite(o?.a) ? o.a : 2 * Math.PI * hash01(L.seed, id, 5);
      const r = Number.isFinite(o?.r) ? clamp(o.r, STRIKE.R_MIN, STRIKE.R_MIN + STRIKE.R_SPAN) : 40;
      strikeVisual(a, r, null, id, L.seed);
      return true;
    },
    place(x = 0, z = 1, type = 'stormrod') {
      if (!host()) return false;
      if (type !== 'stormrod' && type !== 'stormlamp' && type !== 'stormglass') return false;
      const w = ctx.world; if (!w || !Array.isArray(w.decor) || !Array.isArray(w.tiles)) return false;
      if (decorAt(x, z) === type) return true;
      if (decorAt(x, z) || !w.tiles.some(t => t[0] === x && t[1] === z)) return false;
      w.decor.push({ type, x, z }); ctx.rebuildRaft?.(); dirty = true;
      return true;
    },
    fill(x, z, n = ROD_MAX) {
      if (!host() || decorAt(x, z) !== 'stormrod') return false;
      const key = keyOf(x, z), e = st.rods[key] ?? { n: 0, last: -1 };
      e.n = clamp(Math.floor(+n) || 0, 0, ROD_MAX); st.rods[key] = e; st.r++;
      return true;
    },
    give(kind = 'stormshard', n = 3) { if (!host()) return 0; const b = ctx.localBag?.(); return b ? n - b.add(kind, n) : 0; },
    next() { if (!L.ready) return null; const o = nextStorm(L.seed, L.clock, { index: -1, start: 0, inSec: Infinity }); return o.index < 0 ? null : { index: o.index, start: o.start, inSec: o.inSec }; },
    // pose(t): hold the last strike's flash and bolt at t seconds (screenshot helper); pose(null) lets it finish
    pose(t = 0.03) { if (t === null || t === undefined) { poseT = NaN; return true; } const v = Number(t); if (!Number.isFinite(v)) return false; poseT = clamp(v, 0, 0.29); flashOn = true; if (bolt && flashMode() === 'full') bolt.mesh.visible = true; return true; },
    renderInfo() { const r = ctx.renderer?.info?.render; return r ? { calls: r.calls, triangles: r.triangles, points: r.points, lines: r.lines } : null; },
  };

  return { name: 'storm', serialize, load, action, interact, prompt, update, decorModel, dispose, debug };
}
