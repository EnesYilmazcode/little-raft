// Wind Turbine, Battery, String Lights and Lamp Post (see docs/specs/power.md).
// A turbine next to a battery charges it from the daynight wind; String Lights and Lamp Posts within 3 tiles of
// a charged battery glow at night and drain it. Cozy: nothing breaks, an empty battery just rests until the wind
// returns. Slice: world.ext.power = {v:1, s, r, b:{"x,z": e}}, host-authoritative charge only; lit state, pips
// and blade spin are worked out locally on every peer from decor + b. No 'power.*' actions in v1.
// The top half of this file is pure (no DOM, no Date, no Math.random) and exported for tests.
import { createTurbine, createBattery, createStringLights, createLampPost, paintBattery } from './power-model.js?build=v3-survival-ae77fa84ac2b';

export const CAP = 1800, GAIN = 4, DRAIN_STRING = 1, DRAIN_LAMP = 2, NIGHT_ON = 0.15, MAX_TICK = 60, REACH = 2.6;
export const TURBINE_CAP = 2, LIGHT_RANGE = 3, SPIN = 6;
export const HOOK_RANGE = 2, DRAIN_HOOK = 1, BOOST = 2, MAX_CABLES = 64; // [power-hookups] appliance range, charge per powered second, speed-up, cable cap
export const HOOK_TYPES = Object.freeze(['purifier', 'kiln', 'grill']); // [power-hookups] decor a battery within HOOK_RANGE speeds up
export const MAX_BATTERIES = 400; // the raft tile cap
export const OLD_HOST = 'Your friend’s raft doesn’t have power yet';
export const POWER_TYPES = Object.freeze(['turbine', 'battery', 'stringlights', 'lamppost']);
const LIGHT_NAME = { stringlights: 'String Lights', lamppost: 'Lamp Post' };
const DRAIN = { stringlights: DRAIN_STRING, lamppost: DRAIN_LAMP };

const KEY_RE = /^-?\d+,-?\d+$/;
const isInt = Number.isInteger;
export const tileKey = (x, z) => x + ',' + z;
const isKey = k => typeof k === 'string' && k.length <= 24 && KEY_RE.test(k) && (() => { const [x, z] = k.split(',').map(Number); return tileKey(x, z) === k; })();
const isLight = t => t === 'stringlights' || t === 'lamppost';
const cheb = (ax, az, bx, bz) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function batteryKeys(decor) {
  const out = new Set();
  if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'battery' && isInt(d.x) && isInt(d.z)) out.add(tileKey(d.x, d.z));
  return out;
}
const hasBattery = (decor, x, z) => { if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'battery' && d.x === x && d.z === z) return true; return false; };

/** Pips lit for a charge (0..4). */
export const pipsFor = e => (e > 0 ? Math.min(4, Math.ceil(e / CAP * 4)) : 0);
/** Wind word for prompts. */
export const windWord = w => (w < .3 ? 'calm' : w < .6 ? 'gentle wind' : 'breezy');

/** Validated slice. Junk -> defaults; bad keys dropped, e rounded and clamped to 0..CAP, e = 0 and non-battery tiles pruned. */
export function cleanPower(v, decor) {
  const out = { v: 1, s: '', r: 0, b: {} };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  if (typeof v.s === 'string' && v.s.length <= 32) out.s = v.s;
  if (isInt(v.r) && v.r >= 0) out.r = v.r;
  const b = v.b && typeof v.b === 'object' && !Array.isArray(v.b) ? v.b : {};
  const bats = batteryKeys(decor);
  let n = 0;
  for (const k of Object.keys(b)) {
    if (n >= MAX_BATTERIES) break;
    if (!isKey(k) || !bats.has(k)) continue;
    const e = b[k]; if (typeof e !== 'number' || !Number.isFinite(e)) continue;
    const c = Math.min(CAP, Math.max(0, Math.round(e)));
    if (c <= 0) continue;
    out.b[k] = c; n++;
  }
  return out;
}

/** Turbines next to the tile (Chebyshev 1), capped at TURBINE_CAP. */
export function turbinesNear(decor, x, z) {
  let n = 0;
  if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'turbine' && cheb(d.x, d.z, x, z) <= 1) n++;
  return Math.min(n, TURBINE_CAP);
}

// Nearest battery in `range` (LIGHT_RANGE) with charge (or the battery `force`, counted as charged), ties by smallest key string.
function nearest(st, decor, x, z, force, range = LIGHT_RANGE) { // [power-hookups] range
  let best = null, bestD = Infinity;
  if (!Array.isArray(decor)) return null;
  const b = st && st.b ? st.b : {};
  for (const d of decor) {
    if (!d || d.type !== 'battery' || !isInt(d.x) || !isInt(d.z)) continue;
    const dist = cheb(d.x, d.z, x, z); if (dist > range) continue; // [power-hookups]
    const k = tileKey(d.x, d.z);
    if (k !== force && !(b[k] > 0)) continue;
    if (dist < bestD || (dist === bestD && k < best)) { best = k; bestD = dist; }
  }
  return best;
}

/** The key of the battery that powers a light on (x, z), or null. Lit rule: a light is lit iff this is not null. */
export const servingBattery = (st, decor, x, z) => nearest(st, decor, x, z, null);
/** [power-hookups] The key of the charged battery within HOOK_RANGE that powers an appliance on (x, z), or null. */
export const poweringBattery = (st, decor, x, z) => nearest(st, decor, x, z, null, HOOK_RANGE);

/** Host tick: whole seconds only (dt floored, clamped 0..MAX_TICK). Mutates st.b; bumps st.r when some e changed.
 *  [power-hookups] `pending` (optional {batteryKey: float}) is appliance drain owed; after the per-second gain and
 *  light loop its whole part comes off in one lump (the fraction stays). So one 60 s call can differ from sixty 1 s
 *  calls by under one charge. */
export function tickPower(st, decor, dt, wind, night, pending) {
  const emptied = [];
  const bats = batteryKeys(decor);
  const start = {};
  for (const k of Object.keys(st.b)) { start[k] = st.b[k]; if (!bats.has(k)) delete st.b[k]; }
  const n = typeof dt === 'number' && Number.isFinite(dt) ? Math.min(MAX_TICK, Math.max(0, Math.floor(dt))) : 0;
  const w = Math.max(0, fin(wind, 0)), dark = fin(night, 0) >= NIGHT_ON;
  if (n > 0 && bats.size) {
    const gain = [];
    for (const k of bats) { const [x, z] = k.split(',').map(Number); const g = Math.round(turbinesNear(decor, x, z) * w * GAIN); if (g > 0) gain.push(k, g); }
    const lights = [];
    if (dark) for (const d of decor) if (d && isLight(d.type) && isInt(d.x) && isInt(d.z)) lights.push(d);
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < gain.length; i += 2) { const k = gain[i]; st.b[k] = Math.min(CAP, (st.b[k] || 0) + gain[i + 1]); }
      for (const d of lights) {
        const k = servingBattery(st, decor, d.x, d.z); if (!k) continue;
        const e = st.b[k] - DRAIN[d.type];
        if (e <= 0) { delete st.b[k]; if (!emptied.includes(k)) emptied.push(k); } else st.b[k] = e;
      }
    }
  }
  if (n > 0 && pending && typeof pending === 'object') for (const k of Object.keys(pending)) { // [power-hookups] appliance drain
    if (!bats.has(k)) { delete pending[k]; continue; }
    const w = Math.floor(fin(pending[k], 0)); if (!(w > 0)) continue;
    pending[k] -= w;
    const e = (st.b[k] || 0) - w;
    if (e <= 0) { delete st.b[k]; if (!emptied.includes(k)) emptied.push(k); } else st.b[k] = e;
  }
  let changed = false;
  for (const k of Object.keys(st.b)) if (st.b[k] !== start[k]) { changed = true; break; }
  if (!changed) for (const k of Object.keys(start)) if (!(k in st.b)) { changed = true; break; }
  if (changed) st.r++;
  return { emptied };
}

/** {e, pct, turbines, lights} for the battery on that tile (lights = lights it serves once charged), or null. */
export function batteryInfo(st, decor, x, z) {
  if (!hasBattery(decor, x, z)) return null;
  const k = tileKey(x, z), e = st.b[k] || 0;
  let lights = 0;
  for (const d of decor) if (d && isLight(d.type) && nearest(st, decor, d.x, d.z, k) === k) lights++;
  return { e, pct: Math.round(e / CAP * 100), turbines: turbinesNear(decor, x, z), lights };
}

// ------------------------------------------------------------------ the content module

const TARGET_Y = { battery: .3, turbine: 1.1, stringlights: .75, lamppost: 1.1 };

export function createPower(ctx) {
  const T = ctx.T;
  const session = Math.random().toString(36).slice(2, 10);
  let st = cleanPower(undefined, null); st.s = session;
  let cache = null, cacheSt = null, cacheR = -1, netR = -1, netS = null, netUndef = false, hostHasPower = true;
  let env = null, clock = 0;
  const warned = new Set(); // battery keys already announced empty this night
  let pending = {}; // [power-hookups] host: appliance drain owed per battery key, never serialized
  let wasDark = false; const REARM = 60; // [power-hookups] review: "ran out" re-arms at nightfall, or by day once a battery is back to 60
  let cable = null, cableSig = '', cablePairs = 0; // [power-hookups] one LineSegments battery -> appliance
  const groups = []; // {g, x, z, type, k} for every craft_<power type> group in ctx.raft
  let scanLen = -1, scanFirst = null, scanRaft = null;
  let paintR = -1, paintSt = null, paintDecor = -1, paintOld = null, rescanned = false;
  const scratch = T ? new T.Vector3() : null;

  const wind = () => fin(env?.wind?.(), 0.15);
  const night = () => fin(env?.night?.(), 0);
  const oldHost = () => ctx.role === 'guest' && !hostHasPower;
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);
  const powerAtTile = (x, z) => (oldHost() ? 0 : poweringBattery(st, decor(), x, z) ? 1 : 0); // [power-hookups]

  // Nearest power decor along the view ray (or the camera forward when no aim), within reach (bees.js pattern).
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (!d || !POWER_TYPES.includes(d.type)) continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      const cy = (ctx.raft?.position.y ?? 0) + .22 + TARGET_Y[d.type];
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > .85) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best ? { x: best.x, z: best.z, key: tileKey(best.x, best.z), type: best.type } : null;
  }

  function scan() {
    const raft = ctx.raft; if (!raft) { groups.length = 0; return; }
    const kids = raft.children;
    if (raft === scanRaft && kids.length === scanLen && kids[0] === scanFirst) return;
    scanRaft = raft; scanLen = kids.length; scanFirst = kids[0]; rescanned = true;
    groups.length = 0;
    for (let i = 0; i < kids.length; i++) {
      const g = kids[i], n = g.name;
      if (n !== 'craft_turbine' && n !== 'craft_battery' && n !== 'craft_stringlights' && n !== 'craft_lamppost') continue;
      const x = Math.round(g.position.x / 2), z = Math.round(g.position.z / 2);
      groups.push({ g, x, z, type: n.slice(6), k: tileKey(x, z) });
    }
  }

  // [power-hookups] cable: built lazily, shared-flagged so disposeGeometry skips it, never aimable.
  function ensureCable() {
    if (cable || !T) return cable;
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(MAX_CABLES * 6), 3));
    geo.setDrawRange(0, 0);
    const mat = new T.LineBasicMaterial({ color: '#7a4c2e' }); // [power-hookups] review: dark copper, reads on the night deck, subtle by day
    geo.userData.shared = mat.userData.shared = true;
    cable = new T.LineSegments(geo, mat);
    cable.name = 'power_cable'; cable.castShadow = false; cable.frustumCulled = false; cable.visible = false;
    cable.raycast = () => {};
    return cable;
  }
  function attachCable() { // [power-hookups]
    const raft = ctx.raft; if (!cable || !raft || cable.parent === raft) return;
    raft.add(cable); scanFirst = null; // our own child, so force one rescan of the power groups
  }
  function paintCable(d, old) { // [power-hookups] only from inside paint's change gate
    if (!ensureCable()) return;
    let sig = '', pairs = 0; const out = [];
    if (!old) for (const o of d) {
      if (pairs >= MAX_CABLES) break;
      if (!o || !HOOK_TYPES.includes(o.type) || !isInt(o.x) || !isInt(o.z)) continue;
      const k = poweringBattery(st, d, o.x, o.z); if (!k) continue;
      sig += k + '>' + tileKey(o.x, o.z) + ';'; out.push(k, o.x, o.z); pairs++;
    }
    if (sig === cableSig) return;
    cableSig = sig; cablePairs = pairs;
    const pos = cable.geometry.attributes.position, a = pos.array;
    for (let i = 0; i < pairs; i++) {
      const [bx, bz] = out[i * 3].split(',').map(Number), j = i * 6;
      a[j] = bx * 2; a[j + 1] = .47; a[j + 2] = bz * 2; a[j + 3] = out[i * 3 + 1] * 2; a[j + 4] = .47; a[j + 5] = out[i * 3 + 2] * 2;
    }
    cable.geometry.setDrawRange(0, pairs * 2); pos.needsUpdate = true; cable.geometry.computeBoundingSphere();
    cable.visible = pairs > 0;
  }

  function paint(dt) {
    if (ctx.raft && ensureCable() && cable.parent !== ctx.raft) attachCable(); // [power-hookups] first paint / raft identity change
    scan();
    const d = decor(), old = oldHost();
    const changed = rescanned || paintR !== st.r || paintSt !== st || paintDecor !== d.length || paintOld !== old;
    if (changed) { paintCable(d, old); rescanned = false; paintR = st.r; paintSt = st; paintDecor = d.length; paintOld = old; } // [power-hookups] cable before the no-groups return
    if (!groups.length) return;
    const spin = wind() * SPIN * (dt > 0 ? Math.min(dt, .25) : 0);
    for (let i = 0; i < groups.length; i++) { const b = groups[i].g.userData.blades; if (b && spin) b.rotation.z += spin; }
    if (!changed) return;
    for (let i = 0; i < groups.length; i++) {
      const { g, x, z, type, k } = groups[i];
      if (type === 'battery') paintBattery(g, old ? 0 : pipsFor(st.b[k] || 0));
      else if (isLight(type) && g.userData.power) g.userData.power.lit = !old && servingBattery(st, d, x, z) !== null ? 1 : 0;
    }
  }

  function load(data, from) {
    if (from === 'net') {
      if (data && typeof data === 'object' && data.r === netR && data.s === netS) return; // unchanged host state
      if (data === undefined && netUndef) return;
      netUndef = data === undefined; hostHasPower = data !== undefined;
      st = cleanPower(data, ctx.world?.decor);
      netR = data && typeof data === 'object' ? data.r : -1; netS = data && typeof data === 'object' ? data.s : null;
      return;
    }
    netR = -1; netS = null; netUndef = false; hostHasPower = true;
    pending = {}; // [power-hookups]
    st = cleanPower(data, ctx.world?.decor);
    st.s = session; st.r++;
  }

  function serialize() {
    if (cache && cacheSt === st && cacheR === st.r) return cache;
    cache = JSON.parse(JSON.stringify(st)); cacheSt = st; cacheR = st.r;
    return cache;
  }

  function notice(info) {
    const parts = [`Battery ${info.pct}%`, info.turbines ? `${info.turbines} turbine${info.turbines > 1 ? 's' : ''}` : 'no turbine next to it'];
    if (info.turbines) parts.push(windWord(wind()));
    if (info.lights) parts.push(`lights ${info.lights} at night`);
    return parts.join(' · ');
  }

  return {
    name: 'power',
    link(e) { env = e && typeof e === 'object' ? e : null; },
    load,
    /** [power-hookups] 1 when a charged battery within HOOK_RANGE powers an appliance on (x, z). Pure read, every peer. */
    powerAt(x, z) { return oldHost() ? 0 : poweringBattery(st, decor(), x, z) ? 1 : 0; },
    /** [power-hookups] Host only: an appliance on (x, z) worked `sec` seconds powered; owe that drain to its battery. */
    draw(x, z, sec) {
      if (ctx.role === 'guest' || !(sec > 0)) return;
      const k = poweringBattery(st, decor(), x, z);
      if (k) pending[k] = (pending[k] || 0) + sec * DRAIN_HOOK;
    },
    afterRebuild() { attachCable(); }, // [power-hookups] rebuildRaft() removed every child
    serialize,
    update(dt) {
      if (T) paint(dt);
      if (!ctx.running || ctx.role === 'guest') return;
      clock += dt > 0 ? dt : 0;
      if (clock >= 1) {
        const n = Math.floor(clock); clock -= n;
        const nf = night();
        // [power-hookups] review: hookups drain by day too, so a battery hovering at empty (turbine +1, appliances -2)
        // would re-announce every second if day cleared the whole set. By day, re-arm only keys that recharged a little.
        // Each nightfall still re-arms everything, so lights keep their once-per-night notice.
        const dark = nf >= NIGHT_ON; if (dark && !wasDark) warned.clear(); wasDark = dark;
        if (!dark) for (const k of warned) if ((st.b[k] || 0) >= REARM) warned.delete(k);
        const r = tickPower(st, ctx.world?.decor, n, wind(), nf, pending); // [power-hookups] pending
        for (const k of r.emptied) if (!warned.has(k)) { warned.add(k); ctx.emit?.({ kind: 'notice', text: 'A battery ran out of charge' }, 'all'); }
      }
    },
    prompt(aim) {
      const t = target(aim); if (!t) return null;
      const d = decor();
      if (t.type === 'battery') {
        if (oldHost()) return OLD_HOST;
        const info = batteryInfo(st, d, t.x, t.z); if (!info) return null;
        return `<kbd>E</kbd>Check battery · ${info.pct}%`;
      }
      if (t.type === 'turbine') {
        let near = false;
        for (const o of d) if (o && o.type === 'battery' && cheb(o.x, o.z, t.x, t.z) <= 1) { near = true; break; }
        return near ? `Wind Turbine · spinning (${windWord(wind())})` : 'Wind Turbine · place a battery next to it';
      }
      if (oldHost()) return OLD_HOST; // review: an old host has no charge data, so "needs a battery" would mislead
      const lit = servingBattery(st, d, t.x, t.z) !== null;
      return `${LIGHT_NAME[t.type]} · ${lit ? 'powered' : 'needs a charged battery within 3 tiles'}`;
    },
    interact(aim) {
      const t = target(aim); if (!t || t.type !== 'battery') return false;
      if (oldHost()) { ctx.notice?.(OLD_HOST, 2400); return true; }
      const info = batteryInfo(st, decor(), t.x, t.z); if (!info) return false;
      ctx.notice?.(notice(info), 2400);
      return true;
    },
    decorModel(type) {
      if (!T) return null;
      if (type === 'turbine') return createTurbine(T);
      if (type === 'battery') return createBattery(T);
      if (type === 'stringlights') return createStringLights(T);
      if (type === 'lamppost') return createLampPost(T);
      return null;
    },
    debug: {
      state: () => JSON.parse(JSON.stringify(st)),
      lit: () => (oldHost() ? [] : decor().filter(d => d && isLight(d.type) && servingBattery(st, decor(), d.x, d.z) !== null).map(d => tileKey(d.x, d.z))),
      batteries: () => decor().filter(d => d && d.type === 'battery').map(d => ({ x: d.x, z: d.z, key: tileKey(d.x, d.z), ...batteryInfo(st, decor(), d.x, d.z) })),
      env: () => ({ wind: wind(), night: night() }),
      powered: () => decor().filter(d => d && HOOK_TYPES.includes(d.type) && powerAtTile(d.x, d.z)).map(d => tileKey(d.x, d.z)), // [power-hookups]
      pending: () => ({ ...pending }), // [power-hookups]
      cable: () => ({ pairs: cablePairs, visible: !!cable?.visible, attached: !!cable && cable.parent === ctx.raft }), // [power-hookups]
      target: aim => target(aim),
      /** Host QA: put a turbine / battery / string lights / lamp post on a free raft tile. */
      place(type, x, z) {
        const w = ctx.world;
        if (ctx.role === 'guest' || !POWER_TYPES.includes(type) || !isInt(x) || !isInt(z) || !w) return false;
        if (!w.tiles?.some(t => t[0] === x && t[1] === z) || decor().some(d => d.x === x && d.z === z)) return false;
        w.decor.push({ type, x, z }); ctx.rebuildRaft?.(); return true;
      },
      /** Host QA: set a battery's charge (0..CAP). */
      setCharge(x, z, e) {
        if (ctx.role === 'guest' || !hasBattery(decor(), x, z)) return false;
        const k = tileKey(x, z), c = Math.min(CAP, Math.max(0, Math.round(fin(e, 0))));
        if (c > 0) st.b[k] = c; else delete st.b[k];
        st.r++; return true;
      },
      /** Host QA: run the charge/drain rule for `sec` seconds (in MAX_TICK chunks). */
      fastForward(sec = 60, w = .7, nf = 1) {
        if (ctx.role === 'guest') return false;
        let left = Math.max(0, Math.floor(fin(sec, 0)));
        while (left > 0) { const n = Math.min(MAX_TICK, left); tickPower(st, ctx.world?.decor, n, w, nf, pending); left -= n; } // [power-hookups] pending
        return true;
      },
    },
    dispose() {
      groups.length = 0;
      if (cable) { cable.parent?.remove(cable); cable.geometry.dispose(); cable.material.dispose(); cable = null; cableSig = ''; cablePairs = 0; } // [power-hookups]
    },
  };
}
