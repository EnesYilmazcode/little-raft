// ocean-worklet.js - approach B: the whole ambience in one AudioWorkletProcessor.
// Per sample: 1 xorshift noise, a few one-pole / state-variable filters,
// and a small fixed pool of one-shot voices. No allocation inside process().

// Chamberlin state-variable filter; f/q are smoothed outside the inner loop.
class SVF {
  constructor() { this.lp = 0; this.bp = 0; this.f = 0.1; this.q = 1; }
  tune(hz, Q, sr) { this.f = 2 * Math.sin(Math.PI * Math.min(hz, sr / 6) / sr); this.q = 1 / Q; }
  run(x) {
    this.lp += this.f * this.bp;
    const hp = x - this.lp - this.q * this.bp;
    this.bp += this.f * hp;
    return this.bp;
  }
}

const VOICES = 8;

class RaftAmbience extends AudioWorkletProcessor {
  constructor() {
    super();
    this.seed = 0x9e3779b9 | 0;
    this.brown = 0; this.pinkA = 0; this.pinkB = 0; this.pinkC = 0;
    this.bedLp = 0;
    this.wash = new SVF(); this.windF = new SVF();
    this.wind = 0.3; this.windS = 0.3; this.speed = 0.2;
    this.washEnv = 0; this.washTarget = 0; this.nextWave = 0.5; this.waveEnd = 0;
    this.t = 0; this.alive = true;
    // voice pool: kind 0 free, 1 wood, 2 water, 3 creak
    this.v = Array.from({ length: VOICES }, () => ({
      kind: 0, start: 0, age: 0, dur: 0, s: 0, f: 0, phase: 0, rate: 0, a: new SVF(), b: new SVF(), c: new SVF(),
    }));
    this.port.onmessage = (e) => this.onMsg(e.data);
  }
  rnd() { // xorshift32 -> [-1, 1)
    let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x;
    return (x | 0) / 2147483648;
  }
  r(a, b) { return a + (this.rnd() * 0.5 + 0.5) * (b - a); }
  onMsg(m) {
    if (m.type === 'set') { if (m.wind != null) this.wind = m.wind; if (m.speed != null) this.speed = m.speed; }
    else if (m.type === 'stop') this.alive = false;
    else this.spawn(m);
  }
  spawn(m) {
    const v = this.v.find((x) => x.kind === 0) || this.v.reduce((a, b) => (a.age > b.age ? a : b));
    const sr = sampleRate;
    v.start = Math.max(m.t ?? currentTime, currentTime); v.age = -1; v.phase = 0;
    if (m.type === 'creak') {
      v.kind = 3; v.s = m.force ?? 0.6; v.dur = this.r(0.25, 0.6) * (0.6 + v.s * 0.6);
      v.f = 18 + v.s * 40; v.rate = this.r(1.4, 2.2);
      v.a.tune(250 * this.r(0.9, 1.1), 2, sr); v.b.tune(560 * this.r(0.9, 1.1), 3, sr); v.c.tune(790 * this.r(0.9, 1.1), 3, sr);
    } else if (m.surface === 'water') {
      v.kind = 2; v.s = m.s ?? 1; v.dur = 0.3; v.f = this.r(700, 1100); v.a.tune(v.f, 1.2, sr);
    } else {
      v.kind = 1; v.s = m.s ?? 1; v.dur = 0.16; v.rate = this.r(0.045, 0.07);
      v.a.tune(this.r(140, 190), 3, sr); v.b.tune(this.r(1800, 2600), 1.5, sr);
    }
  }
  voice(v, n) {
    const age = v.age;
    if (v.kind === 1) {                       // wood: heel + toe
      let y = 0;
      for (let h = 0; h < 2; h++) {
        const ta = age - (h ? v.rate : 0); if (ta < 0) continue;
        const k = h ? 0.55 : 1;
        y += v.a.run(n * Math.exp(-ta / 0.0175)) * 2.2 * k * v.s * Math.min(1, ta / 0.002);
        y += v.b.run(n * Math.exp(-ta / 0.005)) * 0.35 * k * v.s;
      }
      return y;
    }
    if (v.kind === 2) {                       // water: falling bandpass slap
      const fall = 350 + (v.f - 350) * Math.exp(-age / 0.08);
      if ((this.t & 31) === 0) v.a.tune(fall, 1.2, sampleRate);
      return v.a.run(n) * 0.5 * v.s * Math.min(1, age / 0.01) * Math.exp(-age / 0.0625);
    }
    // creak: sawtooth stick-slip with square-wave jitter, three formants
    const p = age / v.dur;
    const rise = p < 0.6 ? 1 + (v.rate - 1) * (p / 0.6) : v.rate + (1 - v.rate) * ((p - 0.6) / 0.4);
    const jit = (Math.sin(age * 2 * Math.PI * 29) > 0 ? 1 : -1) * 0.25;
    v.phase += (v.f * rise * (1 + jit)) / sampleRate; if (v.phase >= 1) v.phase -= 1;
    const saw = v.phase * 2 - 1;
    const g = 0.12 * v.s * Math.min(1, age / 0.04, (v.dur - age) / 0.08);
    return (v.a.run(saw) + 0.7 * v.b.run(saw) + 0.5 * v.c.run(saw)) * g;
  }
  process(_in, outputs) {
    const out = outputs[0][0], sr = sampleRate, dt = 1 / sr, N = out.length;
    // block-rate control (128 samples): wind smoothing, wave scheduling, filter tuning
    this.windS += (this.wind - this.windS) * 0.002;
    const t0 = currentTime;
    if (t0 >= this.nextWave) {
      this.washTarget = this.r(0.15, 0.35) * (0.6 + this.speed * 0.6);
      this.waveEnd = t0 + this.r(0.6, 1.4);
      this.nextWave = t0 + this.r(3, 7) * (1 - this.speed * 0.4);
    }
    if (t0 >= this.waveEnd) this.washTarget = 0;
    const swell = 0.35 + 0.12 * Math.sin(2 * Math.PI * 0.071 * t0) + 0.08 * Math.sin(2 * Math.PI * 0.127 * t0);
    const bedK = 1 - Math.exp(-2 * Math.PI * (380 + 110 * Math.sin(2 * Math.PI * 0.071 * t0)) / sr);
    this.wash.tune(500 + this.washEnv * 3000, 0.7, sr);
    const wf = 350 + this.windS * 650 + 90 * Math.sin(2 * Math.PI * 0.19 * t0) + 160 * Math.sin(2 * Math.PI * 0.053 * t0);
    this.windF.tune(wf, 8 - this.windS * 5, sr);
    const windG = 0.02 + this.windS * 0.22;
    const live = this.v.filter((v) => v.kind !== 0);
    for (let i = 0; i < N; i++) {
      const w = this.rnd();
      this.brown = (this.brown + 0.02 * w) / 1.02;
      this.pinkA = 0.99765 * this.pinkA + w * 0.099046;
      this.pinkB = 0.963 * this.pinkB + w * 0.2965164;
      this.pinkC = 0.57 * this.pinkC + w * 1.0526913;
      const pink = (this.pinkA + this.pinkB + this.pinkC + w * 0.1848) * 0.25;
      this.bedLp += bedK * (this.brown * 3.5 - this.bedLp);
      this.washEnv += (this.washTarget - this.washEnv) * (this.washTarget > this.washEnv ? 0.00008 : 0.00004);
      let y = this.bedLp * swell + this.wash.run(pink) * this.washEnv + this.windF.run(w) * windG;
      const tNow = t0 + i * dt;
      for (const v of live) {
        if (tNow < v.start) continue;
        v.age = v.age < 0 ? 0 : v.age + dt;
        y += this.voice(v, w);
        if (v.age > v.dur + 0.05) v.kind = 0;
      }
      out[i] = y * 0.8;
    }
    return this.alive;
  }
}

registerProcessor('raft-ambience', RaftAmbience);
