// [instruments] Playable held instruments: Tide Drum, Reed Pipes, Bell Bars (spec: docs/specs/instruments.md).
// No world state: a note is local sound + a view-only sprite, plus one transient co-op message {type:'inst', i, n, v}.
// Top half: pure helpers (no DOM, no THREE, no Date), unit-tested in node.
// Bottom half: createInstruments(T, host) -> {use(kind), onNet(msg), update(dt), dispose(), debug}.
//   host = {scene, camera, pitch(), send(msg), netReady(), note(i, n, s), friendPos() -> Vector3|null, now?()}

export const INSTRUMENT_IDS = Object.freeze(['drum', 'pipes', 'bells']);
export const SCALE_HZ = Object.freeze([293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25, 739.99]); // D4 E4 F#4 A4 B4 D5 E5 F#5
export const PITCH_SPAN = 0.9, SEND_GAP_MS = 80, RECV_MAX_PER_S = 16, HEAR_RANGE = 30, TEACH_NOTES = 10;
export const TINTS = Object.freeze({ drum: '#b0805a', pipes: '#8fc3c9', bells: '#c9b26a' }); // = items.js iconTint
const STEPS = SCALE_HZ.length;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export const isInstrument = (k) => typeof k === 'string' && INSTRUMENT_IDS.includes(k);

// Camera pitch (radians, + is looking up) -> scale step 0..7.
export function noteFor(pitch) {
  const p = Number(pitch);
  if (!Number.isFinite(p)) return 3;
  return Math.min(STEPS - 1, Math.max(0, Math.floor((p + PITCH_SPAN) / (2 * PITCH_SPAN) * STEPS)));
}

// Untrusted network message -> {i, n, v} | null.
export function cleanNoteMsg(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const proto = Object.getPrototypeOf(m);
  if (proto !== Object.prototype && proto !== null) return null;
  if (!own(m, 'type') || m.type !== 'inst' || !own(m, 'i') || !own(m, 'n')) return null;
  const { i, n } = m;
  if (!isInstrument(i)) return null;
  if (!Number.isInteger(n) || n < 0 || n >= STEPS) return null;
  let v = 1;
  if (own(m, 'v')) {
    if (typeof m.v !== 'number' || !Number.isFinite(m.v)) return null;
    v = Math.min(1, Math.max(0, m.v));
  }
  return { i, n, v };
}

// (nowMs) => true when at least minGapMs passed since the last true.
export function rateGate(minGapMs) {
  let last = -Infinity;
  return (now) => {
    if (!Number.isFinite(now)) return false;
    if (now - last < minGapMs) return false;
    last = now; return true;
  };
}

// (nowMs) => true for at most `max` passes in any `ms` window.
export function windowGate(max, ms = 1000) {
  const times = [];
  return (now) => {
    if (!Number.isFinite(now)) return false;
    while (times.length && now - times[0] >= ms) times.shift();
    if (times.length >= max) return false;
    times.push(now); return true;
  };
}

// Distance (m) between players -> loudness 0..1: linear falloff, .15 floor inside HEAR_RANGE.
export function distanceGain(d) {
  if (typeof d !== 'number' || !Number.isFinite(d)) return 0;
  if (d >= HEAR_RANGE) return 0;
  return Math.max(0.15, Math.min(1, 1 - Math.max(0, d) / HEAR_RANGE));
}

// ---------------------------------------------------------------- engine half
const FX_MAX = 6, FX_LIFE = 0.9, FX_RISE = 0.35, LOCAL_FX_SCALE = 0.5; // .14 m at .5 m covered a fifth of the screen

function glyphTexture(T, kind) {
  let c = null;
  try {
    if (typeof document !== 'undefined' && document.createElement) c = document.createElement('canvas');
    else if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(64, 64);
  } catch { c = null; }
  const g = c?.getContext?.('2d');
  if (!g) return null;
  c.width = 64; c.height = 64;
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff'; g.lineCap = 'round'; g.lineJoin = 'round';
  if (kind === 'drum') {                       // a ring
    g.lineWidth = 7; g.beginPath(); g.arc(32, 32, 21, 0, Math.PI * 2); g.stroke();
  } else if (kind === 'pipes') {               // an eighth note
    g.beginPath(); g.ellipse(24, 46, 10, 7.5, -0.4, 0, Math.PI * 2); g.fill();
    g.lineWidth = 5; g.beginPath(); g.moveTo(33, 44); g.lineTo(33, 10); g.quadraticCurveTo(38, 22, 50, 26); g.stroke();
  } else {                                     // a four-point sparkle
    g.beginPath(); g.moveTo(32, 4);
    for (const [x, y] of [[38, 26], [60, 32], [38, 38], [32, 60], [26, 38], [4, 32], [26, 26]]) g.lineTo(x, y);
    g.closePath(); g.fill();
  }
  const t = new T.CanvasTexture(c);
  if (T.SRGBColorSpace) t.colorSpace = T.SRGBColorSpace;
  return t;
}

export function createInstruments(T, host) {
  const now = () => (typeof host.now === 'function' ? host.now() : performance.now());
  const sendGate = rateGate(SEND_GAP_MS), recvGate = windowGate(RECV_MAX_PER_S);
  const geo = new T.PlaneGeometry(0.14, 0.14);
  const textures = new Map();
  const fx = [];                               // {mesh, mat, age}
  const free = [];                             // faded sprites, out of the scene, reused by spawn()
  const tmp = new T.Vector3(), off = new T.Vector3(), at = new T.Vector3(), q = new T.Quaternion(), col = new T.Color();
  let played = 0, disposed = false;

  const tex = (kind) => { if (!textures.has(kind)) textures.set(kind, glyphTexture(T, kind)); return textures.get(kind); };

  function spawn(kind, step, pos, size = 1) {
    let f = null;
    if (fx.length >= FX_MAX) { f = fx.shift(); }  // recycle the oldest
    else if (free.length) { f = free.pop(); host.scene?.add(f.mesh); }
    else {
      const mat = new T.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.9, side: T.DoubleSide, forceSinglePass: true });
      const mesh = new T.Mesh(geo, mat);
      mesh.name = 'instrumentFx'; mesh.castShadow = false; mesh.receiveShadow = false; mesh.raycast = () => {};
      mesh.renderOrder = 25; mesh.frustumCulled = false;
      f = { mesh, mat, age: 0 };
      host.scene?.add(mesh);
    }
    const map = tex(kind);
    if (f.mat.map !== map) { f.mat.map = map; f.mat.needsUpdate = true; }
    col.set(TINTS[kind] || '#ffffff').offsetHSL((step / (STEPS - 1) - 0.5) * 0.16, 0, 0.08);
    f.mat.color.copy(col);
    f.mat.opacity = 0.9;
    f.age = 0;
    f.base = (f.base || new T.Vector3()).copy(pos); f.size = size;
    f.mesh.position.copy(pos); f.mesh.scale.setScalar(size); f.mesh.visible = true;
    fx.push(f);
  }

  function camPos(out) { const c = host.camera; if (!c) return null; if (c.getWorldPosition) return c.getWorldPosition(out); return out.copy(c.position); }

  function localFxPos() {
    const c = host.camera;
    if (!c || !camPos(tmp)) return null;
    if (c.getWorldQuaternion) c.getWorldQuaternion(q); else q.copy(c.quaternion);
    return tmp.add(off.set(0.15, -0.15, -0.5).applyQuaternion(q));
  }

  function use(kind) {
    if (disposed || !isInstrument(kind)) return false;
    if (!sendGate(now())) return true;          // consumed, but too fast to play
    const n = noteFor(host.pitch?.());
    try { host.note?.(kind, n, 1); } catch {}
    played++;
    const p = localFxPos(); if (p) spawn(kind, n, p, LOCAL_FX_SCALE);
    try { if (host.netReady?.()) host.send?.({ type: 'inst', i: kind, n, v: 1 }); } catch {}
    return true;
  }

  function onNet(data) {
    if (disposed) return false;
    const m = cleanNoteMsg(data);               // validate first: junk must not use up the receive window
    if (!m || !recvGate(now())) return false;
    const fp = host.friendPos?.();
    const me = camPos(tmp);
    const d = fp && me ? fp.distanceTo(me) : NaN;
    const s = m.v * distanceGain(d);
    if (!(s > 0)) return false;
    try { host.note?.(m.i, m.n, s); } catch {}
    spawn(m.i, m.n, at.set(fp.x, fp.y + 1.5, fp.z));
    return true;
  }

  function update(dt) {
    if (disposed || !fx.length) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    const c = host.camera;
    if (c) { if (c.getWorldQuaternion) c.getWorldQuaternion(q); else q.copy(c.quaternion); }
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.age += step;
      const k = Math.min(1, f.age / FX_LIFE);
      f.mesh.position.set(f.base.x, f.base.y + FX_RISE * k, f.base.z);
      f.mesh.scale.setScalar(f.size * (1 + 0.4 * k));
      f.mat.opacity = 0.9 * (1 - k);
      if (c) f.mesh.quaternion.copy(q);
      if (k >= 1) { f.mesh.visible = false; f.mesh.removeFromParent(); fx.splice(i, 1); free.push(f); }
    }
  }

  function prompt(ctx) {
    const st = ctx?.hud || ctx?.state; // hud: cheap live view with these keys
    if (!isInstrument(st?.heldKind)) return null;
    // priority 1 beats the built-in prompt, so step aside for its higher-value lines (pick up, climb, waiting)
    if (st.pickup || st.swimming || (st.role === 'guest' && !st.networkReady)) return null;
    const out = [{ key: 'LMB', label: 'Play' }];
    if (played < TEACH_NOTES) out.push({ key: '↕', label: 'Look up/down: change note', muted: true });
    return out;
  }
  let unprompt = null;
  try { unprompt = globalThis.window?.raftPrompts?.provide?.({ id: 'instruments', priority: 1, prompt }) ?? null; } catch { unprompt = null; }

  function dispose() {
    if (disposed) return;
    disposed = true;
    try { unprompt?.(); } catch {}
    for (const f of fx) { f.mesh.removeFromParent(); f.mat.dispose(); }
    for (const f of free) f.mat.dispose();
    fx.length = 0; free.length = 0;
    geo.dispose();
    for (const t of textures.values()) t?.dispose?.();
    textures.clear();
  }

  return {
    use, onNet, update, dispose, prompt,
    get debug() { return { played, fx: fx.length }; },
  };
}

export default createInstruments;
