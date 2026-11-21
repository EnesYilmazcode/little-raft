// audio-worklet.js - Little Raft ocean ambience, one AudioWorkletProcessor ('raft-ocean').
// Loaded by audio.js via ctx.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url)).
//
// Stereo out. Layers, all driven by one swell clock so they move together:
//   bed    brown noise, low-pass breathing with swell height (decorrelated L/R)
//   wash   pink noise band-pass, one envelope per swell crest, panned per wave
//   slap   short low-mid bursts near each trough (water lapping the logs)
//   wind   white noise through two drifting band-passes + faint whistle, gusts
//   creak  stick-slip impulse trains into three wood resonators, fired on the
//          steepest part of the swell (when the raft tilts), panned per creak
// k-rate AudioParams: swell, wind, speed, creak, gain (all 0..1, gain 0..2).
// Per sample: 3 xorshift draws, ~9 TPT state-variable filters, a few one-poles.
// Coefficients are re-tuned once per 128-sample block. No allocation in process().

const TAU = Math.PI * 2;

class SVF { // Zavalishin TPT state-variable filter: stable at any tuning
  constructor() { this.ic1 = 0; this.ic2 = 0; this.a1 = 1; this.a2 = 0; this.a3 = 0; this.k = 1; }
  tune(hz, q, sr) {
    const g = Math.tan(Math.PI * Math.min(Math.max(hz, 10), sr * 0.45) / sr);
    this.k = 1 / q; this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  bp(x) {
    const v3 = x - this.ic2, v1 = this.a1 * this.ic1 + this.a2 * v3, v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    return v1 * this.k; // unity gain at centre
  }
}

const CREAKS = 3;

class RaftOcean extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'swell', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'wind', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'speed', defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'creak', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
    ];
  }
  constructor(opts) {
    super();
    const seed = opts?.processorOptions?.seed;
    this.seed = (Number.isFinite(seed) ? seed : 0x9e3779b9) | 0 || 1;
    this.alive = true;
    // noise state
    this.brL = 0; this.brR = 0; this.p0 = 0; this.p1 = 0; this.p2 = 0;
    this.bedL = 0; this.bedR = 0;
    // swell clock
    this.ph1 = this.r(0, 1); this.ph2 = this.r(0, 1); this.prev1 = this.ph1;
    // wash
    this.wash = new SVF(); this.washEnv = 0; this.washPeak = 0; this.washUp = false; this.washL = 0.7; this.washR = 0.7;
    // slaps (one shared voice, retriggered)
    this.slap = new SVF(); this.slapEnv = 0; this.slapAt = -1; this.slapN = 0; this.slapL = 0.7; this.slapR = 0.7;
    // wind
    this.wL = new SVF(); this.wR = new SVF(); this.whistle = new SVF();
    this.gust = 0.5; this.gustT = 0.5; this.gustNext = 0;
    // creak pool
    this.cv = Array.from({ length: CREAKS }, () => ({
      on: false, age: 0, dur: 0, amp: 0, next: 0, rate: 0, rise: 1, l: 0.7, r: 0.7,
      a: new SVF(), b: new SVF(), c: new SVF(),
    }));
    // DC blockers
    this.dcxL = 0; this.dcyL = 0; this.dcxR = 0; this.dcyR = 0;
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'stop') this.alive = false;
      else if (m.type === 'creak') this.spawnCreak(Math.min(1, Math.max(0, m.force ?? 0.7)));
    };
  }
  rnd() { let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x; return x / 2147483648; } // [-1,1)
  r(a, b) { return a + (this.rnd() * 0.5 + 0.5) * (b - a); }
  pan(p) { const a = (p + 1) * Math.PI / 4; return [Math.cos(a), Math.sin(a)]; }

  spawnCreak(force) {
    let v = null;
    for (const c of this.cv) if (!c.on) { v = c; break; }
    if (!v) return;
    const sr = sampleRate;
    v.on = true; v.age = 0; v.next = 0;
    v.dur = this.r(0.3, 0.8) * (0.7 + force * 0.5);
    v.amp = 0.75 * force;
    v.rate = 25 + force * 45;           // stick-slip pulses per second at start
    v.rise = this.r(1.5, 2.6);          // rate multiplier at 60% of the creak
    [v.l, v.r] = this.pan(this.r(-0.7, 0.7));
    const k = this.r(0.85, 1.15);
    v.a.tune(290 * k, 9, sr); v.b.tune(640 * k, 11, sr); v.c.tune(1210 * k, 12, sr);
  }

  process(_in, outputs, P) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], N = L.length, sr = sampleRate, dt = 1 / sr;
    const swell = P.swell[0], wind = P.wind[0], speed = P.speed[0], creakAmt = P.creak[0], gain = P.gain[0];
    const bt = N * dt;

    // ---- block-rate control ------------------------------------------------
    const f1 = 0.085 + 0.035 * speed;                 // dominant swell period ~8-12 s
    this.ph1 += f1 * bt; if (this.ph1 >= 1) this.ph1 -= 1;
    this.ph2 += 0.157 * bt; if (this.ph2 >= 1) this.ph2 -= 1;
    const h = 0.7 * Math.sin(TAU * this.ph1) + 0.3 * Math.sin(TAU * this.ph2);   // -1..1 swell height
    const p0 = this.prev1, p1 = this.ph1; this.prev1 = p1;
    const crossed = (x) => (p0 < x && p1 >= x) || (p0 > p1 && (p0 < x || p1 >= x));

    // crest -> new wash
    if (crossed(0.22)) {
      this.washPeak = this.r(0.55, 1) * (0.35 + 0.65 * swell) * (0.8 + 0.4 * speed);
      this.washUp = true;
      [this.washL, this.washR] = this.pan(this.r(-0.6, 0.6));
    }
    // trough -> a few slaps on the logs
    if (crossed(0.72)) { this.slapN = 1 + ((this.rnd() * 0.5 + 0.5) * (1 + 3 * swell)) | 0; this.slapAt = 0; }
    // steepest tilt -> maybe creak
    // (calm seas still creak now and then: the raft is loose logs, not a hull)
    if ((crossed(0.0) || crossed(0.5)) && this.r(0, 1) < creakAmt * (0.55 + 0.45 * swell)) this.spawnCreak(this.r(0.5, 1) * (0.7 + 0.3 * swell));

    // gusts: random-walk target every 1-3 s, smoothed
    this.gustNext -= bt;
    if (this.gustNext <= 0) { this.gustT = this.r(0.2, 1); this.gustNext = this.r(1, 3); }
    this.gust += (this.gustT - this.gust) * Math.min(1, bt * 0.6);

    const bedK = 1 - Math.exp(-TAU * (160 + 260 * (0.5 + 0.5 * h) * (0.4 + 0.6 * swell)) / sr);
    const bedG = (0.55 + 0.35 * h * swell) * (0.5 + 0.5 * swell);
    this.wash.tune(450 + 1500 * this.washEnv, 0.8, sr);
    const wc = 260 + 620 * wind + 380 * this.gust * wind;
    this.wL.tune(wc, 0.9 + 1.4 * this.gust, sr); this.wR.tune(wc * 1.13, 0.9 + 1.4 * this.gust, sr);
    this.whistle.tune(1300 + 900 * this.gust, 18, sr);
    const windG = (0.04 + 0.5 * wind) * (0.45 + 0.55 * this.gust) * wind;
    const whistleG = 0.25 * wind * wind * Math.max(0, this.gust - 0.55);
    const washA = Math.exp(-dt / 0.45), washD = Math.exp(-dt / 1.2);
    const slapD = Math.exp(-dt / 0.07);

    // ---- per sample ----------------------------------------------------------
    for (let i = 0; i < N; i++) {
      const w = this.rnd(), wl = this.rnd(), wr = this.rnd();
      // brown (decorrelated) for the bed
      this.brL = (this.brL + 0.02 * wl) / 1.02; this.brR = (this.brR + 0.02 * wr) / 1.02;
      this.bedL += bedK * (this.brL * 3.5 - this.bedL); this.bedR += bedK * (this.brR * 3.5 - this.bedR);
      // pink (shared) for wash and slaps
      this.p0 = 0.99765 * this.p0 + w * 0.099046;
      this.p1 = 0.963 * this.p1 + w * 0.2965164;
      this.p2 = 0.57 * this.p2 + w * 1.0526913;
      const pink = (this.p0 + this.p1 + this.p2 + w * 0.1848) * 0.25;

      // wash envelope: attack towards peak, then release
      if (this.washUp) { this.washEnv = this.washPeak + (this.washEnv - this.washPeak) * washA; if (this.washEnv > this.washPeak * 0.97) this.washUp = false; }
      else this.washEnv *= washD;
      const wash = this.wash.bp(pink) * this.washEnv * 0.9;

      // slaps
      if (this.slapN > 0) {
        this.slapAt -= dt;
        if (this.slapAt <= 0) {
          this.slapEnv = this.r(0.4, 1) * (0.3 + 0.7 * swell);
          this.slap.tune(this.r(260, 620), 2.2, sr);
          [this.slapL, this.slapR] = this.pan(this.r(-0.4, 0.4));
          this.slapAt = this.r(0.12, 0.45); this.slapN--;
        }
      }
      let slap = 0;
      if (this.slapEnv > 1e-4) { slap = this.slap.bp(w) * this.slapEnv * 0.55; this.slapEnv *= slapD; }

      // wind
      const wnL = this.wL.bp(wl) * windG, wnR = this.wR.bp(wr) * windG;
      const wh = this.whistle.bp(w) * whistleG;

      let yl = this.bedL * bedG + wash * this.washL + slap * this.slapL + wnL + wh;
      let yr = this.bedR * bedG + wash * this.washR + slap * this.slapR + wnR + wh;

      // creaks
      for (let c = 0; c < CREAKS; c++) {
        const v = this.cv[c];
        if (!v.on) continue;
        v.age += dt;
        const p = v.age / v.dur;
        if (p >= 1) { v.on = false; continue; }
        let x = 0;
        v.next -= dt;
        if (v.next <= 0) {               // one stick-slip release
          const m = p < 0.6 ? 1 + (v.rise - 1) * (p / 0.6) : v.rise + (1 - v.rise) * ((p - 0.6) / 0.4);
          v.next = (1 / (v.rate * m)) * this.r(0.75, 1.25);
          x = 60;                        // narrow resonators: a unit impulse is ~-50 dB
        }
        const env = Math.min(1, p / 0.08, (1 - p) / 0.25);
        // upper modes weighted up: 290 Hz sits inside the bed, 640 Hz / 1.2 kHz are what cut through it
        const y = (v.a.bp(x) * 0.8 + v.b.bp(x) * 0.85 + v.c.bp(x) * 0.55) * v.amp * env;
        yl += y * v.l; yr += y * v.r;
      }

      // DC block, out
      const ol = yl - this.dcxL + 0.9995 * this.dcyL; this.dcxL = yl; this.dcyL = ol;
      const or = yr - this.dcxR + 0.9995 * this.dcyR; this.dcxR = yr; this.dcyR = or;
      L[i] = ol * gain * 0.5;
      if (R !== L) R[i] = or * gain * 0.5;
    }
    return this.alive;
  }
}

// A hot-updated build may load this module again into the same context; the old class stays valid.
try { registerProcessor('raft-ocean', RaftOcean); } catch (_) { /* already registered */ }
