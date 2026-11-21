// coop-interp.js — jitter-free interpolation of a remote player's snapshots (pure, no imports).
//
// Snapshots {t:senderMs, x,y,z,yaw,pitch, hook?:{x,y,z}, ...} arrive ~15 Hz while moving and ~4 Hz
// when idle (idle snaps repeat the position). We render the remote at
//   renderT = nowMs - offset - delay        (in sender-clock ms)
// offset = min one-way "recv - t" over a window (network delay is >= its minimum, so jitter only ever
//          adds on top and never drags the estimate around; clock offset of any size cancels out).
// delay  = clamp(interval*1.2 + 2*jitter), jitter = half the p95 spread of latency above that minimum,
//          interval = median spacing of *moving* snaps (idle repeats are ignored, and it is capped),
//          so a 4 Hz idle stretch never inflates the delay.
// Both offset and delay are slewed slowly (<= 15 % of real time combined) so renderT stays monotone.
// Targets are recomputed once per accepted snapshot (push); sample() allocates nothing and reuses one
// hook object per buffer (out.hook is only valid until the next sample()).

const TAU_EXTRAP = 70;     // ms, extrapolated velocity decays with this time constant (bounded overshoot)
const TAU_ERR = 100;       // ms, decay of the visual correction applied when extrapolation was wrong
const RESTART_MS = 1000;   // t jumping back by more than this (twice, consistently) = sender restarted
const MAX_INTERVAL = 125;  // ms, cap on the interval estimate
const EPS = 1e-4;

const TWO_PI = Math.PI * 2;
/** Shortest-arc angle interpolation (result may lie outside [-PI, PI]; callers only use sin/cos/rotation). */
export const lerpAngle = (a, b, t) => {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI; else if (d < -Math.PI) d += TWO_PI;
  return a + d * t;
};

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
const pct = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const H = { v: 0, d: 0 }; // scratch result of hermite()

// Monotone cubic Hermite on one axis between a (time ta) and b (tb); p0/p3 are the outer neighbours
// (null -> one-sided). Catmull-Rom tangents limited per Fritsch-Carlson so the path never doubles back.
function hermite(a, b, p0, p3, ta, tb, t0, t3, u) {
  const h = tb - ta, d = (b - a) / h;
  let ma = p0 == null ? d : (b - p0) / (tb - t0), mb = p3 == null ? d : (p3 - a) / (t3 - ta);
  if (Math.abs(d) < 1e-9) ma = mb = 0;
  else {
    if (ma * d <= 0) ma = 0;
    if (mb * d <= 0) mb = 0;
    const al = ma / d, be = mb / d, s = al * al + be * be;
    if (s > 9) { const k = 3 / Math.sqrt(s); ma *= k; mb *= k; }
  }
  const u2 = u * u, u3 = u2 * u;
  H.v = (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * h * ma + (3 * u2 - 2 * u3) * b + (u3 - u2) * h * mb;
  H.d = ((6 * u2 - 6 * u) * a + (3 * u2 - 4 * u + 1) * h * ma + (6 * u - 6 * u2) * b + (3 * u2 - 2 * u) * h * mb) / h;
  return H;
}

export class SnapshotBuffer {
  constructor({ delayMs = 100, minDelayMs = 50, maxDelayMs = 350, maxExtrapolateMs = 250, snapDistance = 4, size = 32 } = {}) {
    Object.assign(this, { delayMs0: delayMs, minDelayMs, maxDelayMs, maxExtrapolateMs, snapDistance, size });
    this.reset();
  }

  reset() {
    this.snaps = [];          // sorted by t ascending, unique t
    this.lat = [];            // recent (recvMs - t) samples
    this.interval = 1000 / 15; // last good estimate of moving-snap spacing
    this.offset = null; this.delay = this.delayMs0;
    this.lastNow = null; this.lastR = -Infinity; this.tpT = -Infinity; this.pending = null;
    this.prevExtrap = false; this.px = this.py = this.pz = 0; this.ex = this.ey = this.ez = 0;
    this.tLo = 0; this.tJitter = 0; this.tDelay = this.delayMs0;   // cached targets (see _targets)
    if (!this.hk) this.hk = { x: 0, y: 0, z: 0 };                   // reusable sample hook
  }

  /** Add a snapshot received at recvMs (local clock). Returns false for stale/duplicate/invalid snaps. */
  push(snap, recvMs) {
    if (!snap || !Number.isFinite(snap.t) || !Number.isFinite(recvMs)) return false;
    const s = this.snaps, last = s[s.length - 1];
    if (last && snap.t < last.t - RESTART_MS) {
      // Either a very late straggler or a restarted sender: restart only when a second snap confirms it.
      const p = this.pending;
      if (!p || snap.t <= p.snap.t || snap.t > p.snap.t + RESTART_MS) { this.pending = { snap, recvMs }; return false; }
      this.reset(); this.push(p.snap, p.recvMs);
      return this.push(snap, recvMs);
    }
    this.pending = null;
    let i = s.length;
    while (i > 0 && s[i - 1].t > snap.t) i--;
    if (i > 0 && s[i - 1].t === snap.t) return false;              // duplicate
    if (i === 0 && s.length >= this.size) return false;              // older than everything we keep
    s.splice(i, 0, snap);
    if (s.length > this.size) s.shift();
    this.lat.push(recvMs - snap.t); if (this.lat.length > this.size) this.lat.shift();
    if (this.offset === null) this.offset = recvMs - snap.t;
    this._targets();
    return true;
  }

  // Recompute offset/delay targets from lat + snaps (only changed by push/reset) into tLo/tJitter/tDelay.
  _targets() {
    const lo = Math.min(...this.lat);
    const jitter = this.lat.length > 1 ? (pct(this.lat, 0.95) - lo) / 2 : 0;
    // Interval = median spacing of consecutive snaps that actually moved (idle repeats excluded);
    // computed from the sorted buffer so reordering cannot skew it. Kept while fully idle.
    const s = this.snaps, gaps = [];
    for (let k = 1; k < s.length; k++) if (dist(s[k - 1], s[k]) > EPS) gaps.push(s[k].t - s[k - 1].t);
    if (gaps.length >= 3) this.interval = Math.min(MAX_INTERVAL, pct(gaps, 0.5));
    const interval = this.interval;
    const delay = Math.min(this.maxDelayMs, Math.max(this.minDelayMs, interval * 1.2 + 2 * jitter));
    this.tLo = lo; this.tJitter = jitter; this.tDelay = delay;
  }

  get stats() {
    const n = this.snaps.length;
    return { delayMs: this.delay, jitterMs: n ? this.tJitter : 0, offsetMs: this.offset ?? 0, count: n, intervalMs: n ? this.interval : 0 };
  }

  _hook(src) { const h = this.hk; h.x = src.x; h.y = src.y; h.z = src.z; return h; }

  /** Sample the interpolated state at local time nowMs into `out`. Returns null with no data. */
  sample(nowMs, out = {}) {
    const s = this.snaps;
    if (!s.length) return null;
    const dt = this.lastNow === null ? 0 : Math.min(250, Math.max(0, nowMs - this.lastNow));
    this.lastNow = nowMs;
    // Slew offset and delay toward their targets (fast up, slow down for delay).
    const lo = this.tLo;
    if (Math.abs(lo - this.offset) > 500) this.offset = lo;
    else this.offset += Math.max(-0.05 * dt, Math.min(0.05 * dt, lo - this.offset));
    this.delay += Math.max(-0.02 * dt, Math.min(0.1 * dt, this.tDelay - this.delay));
    const r = Math.max(this.lastR, nowMs - this.offset - this.delay);

    const L = s[s.length - 1], snapD = this.snapDistance;
    let teleported = false;
    for (let k = 1; k < s.length; k++) {   // any teleport segment entered/passed since last sample?
      const a = s[k - 1], b = s[k];
      if (a.t < r && b.t > this.lastR && b.t > this.tpT && dist(a, b) > snapD) { teleported = true; this.tpT = b.t; }
    }
    this.lastR = r;

    let x, y, z, vx = 0, vz = 0, yaw, pitch, hook = null, extrap = false;
    if (r >= L.t || s.length === 1) {
      // Out of data: decaying-velocity extrapolation for up to maxExtrapolateMs, then hold.
      const P = s[s.length - 2], e = Math.min(Math.max(0, r - L.t), this.maxExtrapolateMs);
      let wx = 0, wy = 0, wz = 0;
      if (P && L.t - P.t <= 400 && dist(P, L) <= snapD) {
        const h = L.t - P.t; wx = (L.x - P.x) / h; wy = (L.y - P.y) / h; wz = (L.z - P.z) / h;
      }
      const f = TAU_EXTRAP * (1 - Math.exp(-e / TAU_EXTRAP)), g = e >= this.maxExtrapolateMs ? 0 : Math.exp(-e / TAU_EXTRAP);
      x = L.x + wx * f; y = L.y + wy * f; z = L.z + wz * f; vx = wx * g * 1000; vz = wz * g * 1000;
      yaw = L.yaw; pitch = L.pitch; extrap = r > L.t;
      if (L.hook) hook = this._hook(L.hook);
    } else if (r < s[0].t) {
      ({ x, y, z, yaw, pitch } = s[0]); if (s[0].hook) hook = this._hook(s[0].hook);
    } else {
      let i = 0; while (s[i + 1].t <= r) i++;
      const a = s[i], b = s[i + 1], u = (r - a.t) / (b.t - a.t);
      if (dist(a, b) > snapD) {                      // teleport: snap, never slide
        ({ x, y, z, yaw, pitch } = b); if (b.hook) hook = this._hook(b.hook);
        this.ex = this.ey = this.ez = 0;
      } else {
        let p0 = s[i - 1], p3 = s[i + 2];
        if (p0 && dist(p0, a) > snapD) p0 = null;
        if (p3 && dist(b, p3) > snapD) p3 = null;
        const t0 = p0 ? p0.t : 0, t3 = p3 ? p3.t : 0;
        x = hermite(a.x, b.x, p0 ? p0.x : null, p3 ? p3.x : null, a.t, b.t, t0, t3, u).v; vx = H.d * 1000;
        y = hermite(a.y, b.y, p0 ? p0.y : null, p3 ? p3.y : null, a.t, b.t, t0, t3, u).v;
        z = hermite(a.z, b.z, p0 ? p0.z : null, p3 ? p3.z : null, a.t, b.t, t0, t3, u).v; vz = H.d * 1000;
        yaw = lerpAngle(a.yaw ?? 0, b.yaw ?? 0, u);
        pitch = (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * u;
        if (a.hook && b.hook) {
          const h0 = (p0 && p0.hook) || null, h3 = (p3 && p3.hook) || null, ha = a.hook, hb = b.hook;
          hook = this.hk;
          hook.x = hermite(ha.x, hb.x, h0 ? h0.x : null, h3 ? h3.x : null, a.t, b.t, t0, t3, u).v;
          hook.y = hermite(ha.y, hb.y, h0 ? h0.y : null, h3 ? h3.y : null, a.t, b.t, t0, t3, u).v;
          hook.z = hermite(ha.z, hb.z, h0 ? h0.z : null, h3 ? h3.z : null, a.t, b.t, t0, t3, u).v;
        } else if (b.hook) hook = this._hook(b.hook);
      }
    }
    // Hide the error of a wrong extrapolation by blending it out instead of popping.
    if (teleported) this.ex = this.ey = this.ez = 0;
    else if (this.prevExtrap && !extrap) {
      const ex = this.px - x, ey = this.py - y, ez = this.pz - z;
      if (Math.hypot(ex, ey, ez) < snapD) { this.ex = ex; this.ey = ey; this.ez = ez; }
    }
    const k = Math.exp(-dt / TAU_ERR);
    this.ex *= k; this.ey *= k; this.ez *= k;
    if (Math.hypot(this.ex, this.ey, this.ez) < 1e-4) this.ex = this.ey = this.ez = 0;
    this.prevExtrap = extrap;
    out.x = this.px = x + this.ex; out.y = this.py = y + this.ey; out.z = this.pz = z + this.ez;
    out.yaw = yaw ?? 0; out.pitch = pitch ?? 0; out.vx = vx; out.vz = vz; out.speed = Math.hypot(vx, vz);
    out.extrapolating = extrap; out.teleported = teleported; out.hook = hook; out.latest = L;
    return out;
  }
}
