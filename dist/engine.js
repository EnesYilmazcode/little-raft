// Little Motor + Steering Wheel content module (spec: docs/specs/engine.md).
// A placed `motor` decor pushes the raft along the shared sail heading while it is on and fuelled; a `wheel`
// decor is a second grab point for the sail steering (sailing-world.js asks steerTargets()) and toggles all motors.
// Slice: world.ext.engine = { v:1, motors: { "x,z": { on, fuel } } }. Host-authoritative actions {kind:'engine'}.
// Host and guest compute the push from the same synced data (ext.engine + world.sailing + world.decor/tiles).
// The top half is pure (no THREE, no DOM) and exported for tests.
import { buildMotor, buildWheel } from './engine-models.js?build=v3-survival-ae77fa84ac2b';

export const ENGINE = Object.freeze({
  ENGINE_SPEED: 0.7,          // m/s, one motor on a small raft
  GAIN: Object.freeze([0, 1, 1.5, 1.8, 2.0]), // diminishing bonus by running motors
  MAX_MOTORS: 4,              // a 5th+ motor still burns but adds nothing
  FUEL: Object.freeze({ leaf: 20, wood: 45, plastic: 60 }), // seconds of fuel per item
  FUEL_CAP: 300,
  MAX_ENTRIES: 64,
  REACH: 2.6, OP_GAP: 250, MAX_TICK: 1, PROP_SPIN: 14,
});
const KEY_RE = /^-?\d+,-?\d+$/;
const NONE = Object.freeze([]);
const isInt = Number.isInteger;
const fin = x => typeof x === 'number' && Number.isFinite(x);
const KEYS = new Map(); // interned "x,z" keys: the per-frame push/burn/animation lookups allocate no strings
const keyOf = (x, z) => {
  if (!isInt(x) || !isInt(z) || Math.abs(x) > 500 || Math.abs(z) > 500) return x + ',' + z;
  const n = (x + 512) * 1024 + z + 512;
  let k = KEYS.get(n);
  if (k === undefined) { k = x + ',' + z; if (KEYS.size < 4096) KEYS.set(n, k); }
  return k;
};
const okXZ = (x, z) => isInt(x) && isInt(z) && Math.abs(x) <= 25 && Math.abs(z) <= 25;
const NAMES = { leaf: 'leaf', wood: 'wood', plastic: 'plastic' };

/** Validator: always a fresh {v:1, motors:{}} with only valid entries. Never throws. */
export function cleanEngine(v) {
  const out = { v: 1, motors: {} };
  let src;
  try { src = v && typeof v === 'object' && !Array.isArray(v) ? v.motors : null; } catch { return out; }
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  let keys;
  try { keys = Object.keys(src).filter(k => KEY_RE.test(k)).sort(); } catch { return out; }
  for (let i = 0, n = 0; i < keys.length && n < ENGINE.MAX_ENTRIES; i++) {
    const k = keys[i], e = { on: false, fuel: 0 };
    let raw;
    try { raw = src[k]; } catch { raw = null; }
    if (raw && typeof raw === 'object') {
      try { if (raw.on === true) e.on = true; } catch { /* ignore */ }
      try { const f = raw.fuel; if (fin(f)) e.fuel = Math.round(Math.min(ENGINE.FUEL_CAP, Math.max(0, f)) * 10) / 10; } catch { /* ignore */ }
    }
    out.motors[k] = e; n++;
  }
  return out;
}

/** Sorted "x,z" keys of the motor decor. */
export function motorKeys(decor) {
  const out = [];
  if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'motor' && isInt(d.x) && isInt(d.z)) out.push(keyOf(d.x, d.z));
  return out.sort();
}

/** Raft-local wheel spots {x,z} (metres), written into `out` (reused objects, no allocation once grown). */
export function wheelSpots(decor, out = []) {
  let n = 0;
  if (Array.isArray(decor)) for (let i = 0; i < decor.length; i++) {
    const d = decor[i];
    if (!d || d.type !== 'wheel' || !isInt(d.x) || !isInt(d.z)) continue;
    const s = out[n] || (out[n] = { x: 0, z: 0 });
    s.x = d.x * 2; s.z = d.z * 2; n++;
  }
  out.length = n;
  return out;
}

const entry = (slice, d) => slice?.motors?.[keyOf(d.x, d.z)];
const runs = e => !!e && e.on === true && e.fuel > 0;

/** Motors that push right now: on, fuelled, present in the decor, raft not anchored. */
export function runningCount(slice, decor, anchored) {
  if (anchored || !Array.isArray(decor)) return 0;
  let n = 0;
  for (let i = 0; i < decor.length; i++) { const d = decor[i]; if (d && d.type === 'motor' && runs(entry(slice, d))) n++; }
  return n;
}

/** Target push speed (m/s) for n running motors on a raft of nTiles floor tiles. */
export function engineSpeed(n, nTiles) {
  if (!fin(n) || n < 1) return 0;
  const g = ENGINE.GAIN[Math.min(Math.floor(n), ENGINE.MAX_MOTORS)];
  const t = fin(nTiles) ? Math.max(1, nTiles) : 1;
  const size = Math.min(1, Math.max(0.6, Math.sqrt(16 / t)));
  return ENGINE.ENGINE_SPEED * g * size;
}

/** Push velocity along the sail heading, written into out.x/out.z. Zero when anchored or nothing runs. */
export function enginePush(slice, decor, nTiles, sailing, out) {
  out.x = 0; out.z = 0;
  if (!sailing || sailing.anchored || !fin(sailing.heading)) return out;
  const sp = engineSpeed(runningCount(slice, decor, false), nTiles);
  if (sp > 0) { out.x = Math.sin(sailing.heading) * sp; out.z = Math.cos(sailing.heading) * sp; }
  return out;
}

/** Host fuel burn: 1 s per second for each running motor. Returns the keys that just ran dry. */
export function burn(slice, decor, dt, anchored) {
  if (anchored || !Array.isArray(decor) || !slice?.motors) return NONE;
  dt = fin(dt) ? Math.min(ENGINE.MAX_TICK, Math.max(0, dt)) : 0;
  if (!(dt > 0)) return NONE;
  let dry = NONE;
  for (let i = 0; i < decor.length; i++) {
    const d = decor[i];
    if (!d || d.type !== 'motor') continue;
    const k = keyOf(d.x, d.z), e = slice.motors[k];
    if (!runs(e)) continue;
    e.fuel = Math.max(0, e.fuel - dt);
    if (e.fuel <= 0) { e.fuel = 0; if (dry === NONE) dry = []; dry.push(k); }
  }
  return dry;
}

const hasMotor = (decor, x, z) => Array.isArray(decor) && decor.some(d => d && d.type === 'motor' && d.x === x && d.z === z);
const anyMotor = decor => { if (Array.isArray(decor)) for (let i = 0; i < decor.length; i++) if (decor[i]?.type === 'motor') return true; return false; };
function slot(slice, k) {
  let e = slice.motors[k];
  if (e) return e;
  if (Object.keys(slice.motors).length >= ENGINE.MAX_ENTRIES) return null;
  return (slice.motors[k] = { on: false, fuel: 0 });
}

/** Host side of {kind:'engine', op}. Ops: toggle {x,z}, all {}, fuel {x,z,item}. Returns {ok, text}. */
export function applyEngineAction(slice, a, decor, bag) {
  const no = text => ({ ok: false, text });
  if (!slice || !slice.motors || !a || typeof a !== 'object') return no('');
  if (a.op === 'all') {
    const keys = motorKeys(decor);
    if (!keys.length) return no('No motors');
    const anyOn = keys.some(k => slice.motors[k]?.on === true);
    let fuelled = false;
    for (const k of keys) { const e = slot(slice, k); if (!e) continue; e.on = !anyOn; if (e.fuel > 0) fuelled = true; }
    return { ok: true, text: anyOn ? 'Motors off' : fuelled ? 'Motors on' : 'Needs fuel' };
  }
  if (a.op !== 'toggle' && a.op !== 'fuel') return no('');
  if (!okXZ(a.x, a.z) || !hasMotor(decor, a.x, a.z)) return no('No motors');
  const k = keyOf(a.x, a.z);
  if (a.op === 'toggle') {
    const e = slot(slice, k); if (!e) return no('Too many motors');
    e.on = !e.on;
    return { ok: true, text: !e.on ? 'Motor off' : e.fuel > 0 ? 'Motor on' : 'Needs fuel' };
  }
  const add = typeof a.item === 'string' && Object.prototype.hasOwnProperty.call(ENGINE.FUEL, a.item) ? ENGINE.FUEL[a.item] : 0;
  if (!add) return no('Not fuel');
  const cur = slice.motors[k]?.fuel ?? 0;
  if (cur >= ENGINE.FUEL_CAP - 1) return no('Tank is full');
  if (Object.keys(slice.motors).length >= ENGINE.MAX_ENTRIES && !slice.motors[k]) return no('Too many motors');
  if (!bag || typeof bag.remove !== 'function' || !bag.remove(a.item, 1)) return no('No ' + NAMES[a.item] + ' in your bag');
  const e = slot(slice, k);
  e.fuel = Math.min(ENGINE.FUEL_CAP, e.fuel + add);
  return { ok: true, text: '+' + add + ' s fuel' };
}

/** "2:10" */
export function fmtFuel(sec) {
  const s = Math.max(0, Math.ceil(fin(sec) ? sec : 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// ------------------------------------------------------------------ the content module

export function createEngine(ctx) {
  const T = ctx.T;
  let st = cleanEngine(undefined);
  const lastOp = new Map(), spots = [], models = [];
  const lastPush = { x: 0, z: 0 };
  let motorModel = null, wheelModel = null, childCount = -1, firstChild = null, decorRef = null, decorLen = -1, clock = 0;
  const scratch = T ? new T.Vector3() : null;

  const world = () => ctx.world;
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : NONE);
  const nTiles = () => (Array.isArray(ctx.world?.tiles) ? ctx.world.tiles.length : 0);
  const anchored = () => !!ctx.world?.sailing?.anchored;
  const fuelOf = (x, z) => st.motors[keyOf(x, z)]?.fuel ?? 0;
  const onOf = (x, z) => st.motors[keyOf(x, z)]?.on === true;
  const anyOn = () => { const a = decor(); for (let i = 0; i < a.length; i++) if (a[i]?.type === 'motor' && onOf(a[i].x, a[i].z)) return true; return false; };
  const heldKind = () => { const b = ctx.localBag?.(); return b?.slots?.[b.selectedIndex]?.kind ?? null; };

  // Nearest motor/wheel along the view ray within reach (same scoring as storage-research.js target()).
  function target(aim) {
    const w = world(), p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (!d || (d.type !== 'motor' && d.type !== 'wheel')) continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > ENGINE.REACH) continue;
      const cy = (ctx.raft?.position.y ?? 0) + (d.type === 'motor' ? .65 : 1.05);
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > .85) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  function rescan() {
    const raft = ctx.raft; if (!raft) return;
    // rebuildRaft() recreates every child, so a new first child means a rebuild even when the count is unchanged
    // (e.g. a crate swapped for a motor in one guest snapshot).
    if (raft.children.length === childCount && raft.children[0] === firstChild) return;
    childCount = raft.children.length; firstChild = raft.children[0] ?? null; models.length = 0;
    for (const c of raft.children) {
      const kind = c.userData?.engine; if (!kind) continue;
      models.push({ obj: c, kind, x: Math.round(c.position.x / 2), z: Math.round(c.position.z / 2),
        prop: c.getObjectByName?.('engineProp') ?? null, housing: c.getObjectByName?.('engineHousing') ?? null, wheel: c.getObjectByName?.('engineWheel') ?? null });
    }
  }
  function prune() {
    const d = decor();
    if (d === decorRef && d.length === decorLen) return;
    decorRef = d; decorLen = d.length;
    const keep = new Set(motorKeys(d));
    for (const k of Object.keys(st.motors)) if (!keep.has(k)) delete st.motors[k];
  }

  function act(op, d, item) {
    const a = { kind: 'engine', op };
    if (d) { a.x = d.x; a.z = d.z; }
    if (item) a.item = item;
    ctx.action(a);
  }

  const MAX_HINT = ' · Max ' + ENGINE.MAX_MOTORS + ' motors help';
  // The visible key prompt is prompts.js (#lrPrompt); game.js's #contextPrompt (fed by prompt() below) is hidden by
  // prompts.css. So the same texts are also provided to window.raftPrompts as {key,label} rows (no HTML).
  function promptRows(aim) {
    const d = target(aim); if (!d) return null;
    const many = runningCount(st, decor(), anchored()) > ENGINE.MAX_MOTORS ? { label: 'Max ' + ENGINE.MAX_MOTORS + ' motors help', muted: true } : null;
    const rows = [];
    if (d.type === 'wheel') {
      if (!anyMotor(decor())) return [{ key: 'R', hold: true, label: 'Steer' }, { label: 'No motors yet', muted: true }];
      rows.push({ key: 'E', label: (anyOn() ? 'Stop' : 'Start') + ' motors' }, many ?? { key: 'R', hold: true, label: 'Steer' });
      return rows;
    }
    const held = heldKind(), fuel = fuelOf(d.x, d.z);
    if (held && ENGINE.FUEL[held] && fuel < ENGINE.FUEL_CAP - 1) return [{ key: 'E', label: 'Add ' + NAMES[held] + ' (+' + ENGINE.FUEL[held] + ' s)' }];
    rows.push({ key: 'E', label: (onOf(d.x, d.z) ? 'Stop' : 'Start') + ' motor' }, many ?? { label: fuel > 0 ? fmtFuel(fuel) + ' fuel' : 'Needs fuel', muted: true });
    return rows;
  }
  let unprovide = null, mod = null;
  function provide() {
    const P = globalThis.raftPrompts; if (unprovide || typeof P?.provide !== 'function') return;
    unprovide = P.provide({ id: 'engine', priority: 1, prompt: pc => {
      const s = pc?.state; // yield to the built-in pickup / waiting prompts (priority 0): pickups win E in game.js
      if (mod?.dead || !ctx.running || s?.pickup || (s?.role === 'guest' && !s.networkReady)) return null;
      return promptRows(null);
    } });
  }
  return (mod = {
    name: 'engine',
    serialize: () => st,
    load(data) { st = cleanEngine(data); }, // cheap (<= 64 entries); never touches meshes
    action(a, actor, bag) {
      if (!a || typeof a !== 'object' || a.kind !== 'engine') return false;
      if (a.op === 'toggle' || a.op === 'all') {
        const now = performance.now(), key = String(actor), t = lastOp.get(key);
        if (t !== undefined && now - t < ENGINE.OP_GAP) return true;
        lastOp.set(key, now);
      }
      const res = applyEngineAction(st, a, decor(), bag ?? ctx.actorBag?.(actor));
      if (res.text) ctx.emit({ kind: 'notice', text: res.text }, actor);
      return true;
    },
    update(dt) {
      dt = fin(dt) && dt > 0 ? dt : 0; clock += dt;
      if (!unprovide) provide();
      const anch = anchored();
      if (ctx.role !== 'guest') {
        prune();
        if (ctx.running && burn(st, decor(), dt, anch).length) ctx.emit({ kind: 'notice', text: 'A motor ran out of fuel' }, 'all');
      }
      rescan();
      const heading = ctx.world?.sailing?.heading;
      for (let i = 0; i < models.length; i++) {
        const m = models[i];
        if (m.kind === 'wheel') { if (m.wheel && fin(heading)) m.wheel.rotation.z = -heading * 2; continue; }
        const run = !anch && runs(st.motors[keyOf(m.x, m.z)]);
        if (run && m.prop) m.prop.rotation.z += ENGINE.PROP_SPIN * dt;
        if (m.housing) m.housing.scale.y = run ? 1 + .02 * Math.sin(clock * 40 + i) : 1;
      }
    },
    interact(aim) {
      const d = target(aim); if (!d) return false;
      if (d.type === 'wheel') { act('all'); return true; }
      const held = heldKind();
      if (held && ENGINE.FUEL[held] && fuelOf(d.x, d.z) < ENGINE.FUEL_CAP - 1) act('fuel', d, held);
      else act('toggle', d);
      return true;
    },
    prompt(aim) {
      const d = target(aim); if (!d) return null;
      const many = runningCount(st, decor(), anchored()) > ENGINE.MAX_MOTORS ? MAX_HINT : '';
      if (d.type === 'wheel') {
        if (!anyMotor(decor())) return 'Hold <kbd>R</kbd> to steer · no motors yet';
        return '<kbd>E</kbd>' + (anyOn() ? 'Stop' : 'Start') + ' motors · hold <kbd>R</kbd> to steer' + many;
      }
      const held = heldKind(), fuel = fuelOf(d.x, d.z);
      if (held && ENGINE.FUEL[held] && fuel < ENGINE.FUEL_CAP - 1) return '<kbd>E</kbd>Add ' + NAMES[held] + ' (+' + ENGINE.FUEL[held] + ' s)';
      return '<kbd>E</kbd>' + (onOf(d.x, d.z) ? 'Stop' : 'Start') + ' motor · ' + (fuel > 0 ? fmtFuel(fuel) + ' fuel' : 'Needs fuel') + many;
    },
    sailPush(sailing, out) {
      enginePush(st, decor(), nTiles(), sailing, out);
      lastPush.x = out.x; lastPush.z = out.z;
      return out.x !== 0 || out.z !== 0;
    },
    steerTargets: () => wheelSpots(decor(), spots),
    decorModel(type) {
      if (!T || (type !== 'motor' && type !== 'wheel')) return null;
      const mat = ctx.mat ?? (c => new T.MeshStandardMaterial({ color: c, roughness: .85 }));
      if (type === 'motor') return (motorModel ??= buildMotor(T, mat)).instance();
      return (wheelModel ??= buildWheel(T, mat)).instance();
    },
    debug: {
      state: () => JSON.parse(JSON.stringify(st)),
      place(type, x = 1, z = 0) {
        const w = world();
        if (ctx.role === 'guest' || (type !== 'motor' && type !== 'wheel') || !okXZ(x, z) || !w) return false;
        if (!w.tiles.some(t => t[0] === x && t[1] === z) || w.decor.some(d => d.x === x && d.z === z)) return false;
        w.decor.push({ type, x, z }); ctx.rebuildRaft(); return true;
      },
      fuel(x, z, sec) {
        if (ctx.role === 'guest' || !hasMotor(decor(), x, z) || !fin(sec)) return false;
        const e = slot(st, keyOf(x, z)); if (!e) return false;
        e.fuel = Math.min(ENGINE.FUEL_CAP, Math.max(0, sec)); return true;
      },
      set(x, z, on) {
        if (ctx.role === 'guest' || !hasMotor(decor(), x, z)) return false;
        const e = slot(st, keyOf(x, z)); if (!e) return false;
        e.on = !!on; return true;
      },
      push() {
        const s = ctx.world?.sailing, n = runningCount(st, decor(), anchored());
        return { x: lastPush.x, z: lastPush.z, speed: Math.hypot(lastPush.x, lastPush.z), running: n, target: engineSpeed(n, nTiles()), heading: s?.heading ?? null };
      },
    },
    promptRows,
    dispose() { try { unprovide?.(); } catch { /* ignore */ } unprovide = null; motorModel?.dispose(); wheelModel?.dispose(); motorModel = wheelModel = null; models.length = 0; lastOp.clear(); },
  });
}
