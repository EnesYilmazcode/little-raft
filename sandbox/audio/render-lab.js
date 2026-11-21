// render-lab.js - offline renders + analysis for the audio sandbox (used by index.html and shoot.py).
//   const r = await renderCase('hammer');  -> { name, seconds, ms, msPerSec, stats, buffer }
//   drawReport(canvas, r)                  waveform (top) + log-frequency spectrogram (bottom)
//   wavBase64(r.buffer)                    16-bit PCM stereo WAV
import { createOceanAudio, EVENTS } from './audio.js';

const SR = 48000;

// name -> { seconds, ambience?, worklet?, run(engine, ctx) }
const one = (ev, s = 1, seconds = 1.2, opts = null) => ({ seconds, run: (e) => e.play(ev, s, { at: 0.05, ...(opts || {}) }) });
export const CASES = {
  throw: one('throw', 1, 1.0),
  'throw-soft': one('throw', 0.3, 1.0),
  splash: one('splash', 0.6, 1.0),
  'splash-big': one('splash', 1, 1.4),
  reel: {
    seconds: 2.0,
    run: (e, ctx) => {
      ctx.suspend(0.05).then(() => { e.setReel(true, 0.3); ctx.resume(); });
      ctx.suspend(0.8).then(() => { e.setReel(true, 1); ctx.resume(); });
      ctx.suspend(1.6).then(() => { e.setReel(false); ctx.resume(); });
    },
  },
  'reel-tick': one('reel', 1, 0.3),
  catch: one('catch', 1, 1.2),
  hammer: one('hammer', 1, 0.6),
  'hammer-left': { seconds: 0.6, run: (e) => { e.setListener(0, 1.6, 0, 0, 0, -1); e.play('hammer', 1, { at: 0.05, x: -6, y: 1, z: 0 }); } },
  'gull-far': { seconds: 4, run: (e) => { e.setListener(0, 1.6, 0, 0, 0, -1); e.play('gull', 0.8, { at: 0.05, x: 18, y: 12, z: -20 }); } },
  gull: one('gull', 1, 4),
  pickup: one('pickup', 1, 0.5),
  collect: one('collect', 1, 0.5),
  build: one('build', 1, 0.6),
  craft: one('craft', 1, 1.0),
  repair: one('repair', 1, 0.9),
  jump: one('jump', 1, 0.5),
  swim: one('swim', 1, 0.8),
  bite: one('bite', 1, 0.4),
  return: one('return', 1, 0.5),
  creak: one('creak', 1, 0.9),
  ui: one('ui', 1, 0.2),
  hover: one('hover', 1, 0.15),
  error: one('error', 1, 0.5),
  'ambience-calm': { seconds: 12, ambience: true, run: (e) => e.setOcean({ swell: 0.3, wind: 0.15, speed: 0.1, creak: 0.4 }) },
  'ambience-rough': { seconds: 12, ambience: true, run: (e) => e.setOcean({ swell: 1, wind: 1, speed: 0.8, creak: 1 }) },
  'ambience-creaky': { seconds: 12, ambience: true, run: (e) => e.setOcean({ swell: 0.7, wind: 0, speed: 1, creak: 1 }) },
  // ducking check: sfx bus muted, so only the ambience dip from play('catch') at 4 s is heard
  'duck-only': { seconds: 7, ambience: true, windows: [[3.5, 3.95], [4.05, 4.3], [5.0, 5.45]], run: (e) => { e.setOcean({ swell: 0, wind: 0, creak: 0 }); e.setBus('sfx', 0); e.play('catch', 1, { at: 4 }); } },
  // creak audibility in a calm sea: random creaks off, one forced creak at 5 s; band RMS 500-1500 Hz before vs during
  'creak-calm': {
    seconds: 8, ambience: true, windows: [[3.6, 4.9, 500, 1500], [5.0, 6.2, 500, 1500]],
    run: (e, ctx) => { e.setOcean({ swell: 0.3, wind: 0.15, speed: 0.1, creak: 0 }); ctx.suspend(5.0).then(() => { e.creak(0.6); ctx.resume(); }); },
  },
  'ambience-mid': { seconds: 16, ambience: true, run: (e) => e.setOcean({ swell: 0.5, wind: 0.3, speed: 0.2, creak: 0.5 }) },
  'gull-left': { seconds: 4, run: (e) => { e.setListener(0, 1.6, 0, 0, 0, -1); e.play('gull', 1, { at: 0.05, x: -12, y: 8, z: -3 }); } },
  'ambience-fallback': { seconds: 12, ambience: true, worklet: false, run: (e) => e.setOcean({ swell: 0.5, wind: 0.4 }) },
  'mix-ducking': {
    seconds: 8, ambience: true,
    run: (e, ctx) => {
      e.setOcean({ swell: 0.5, wind: 0.3 });
      const seq = [[3.0, 'throw', 1], [3.8, 'splash', 0.6], [5.6, 'catch', 1], [6.6, 'hammer', 1], [6.9, 'hammer', 0.8]];
      for (const [t, ev, s] of seq) e.play(ev, s, { at: t });
      ctx.suspend(4.3).then(() => { e.setReel(true, 0.8); ctx.resume(); });
      ctx.suspend(5.5).then(() => { e.setReel(false); ctx.resume(); });
    },
  },
  // budget: every voice slot busy at once on top of the worklet ambience
  'stress-24': {
    seconds: 3, ambience: true,
    run: (e) => {
      const evs = ['splash', 'hammer', 'catch', 'throw', 'gull', 'craft'];
      for (let i = 0; i < 24; i++) e.play(evs[i % evs.length], 0.5, { at: 0.5 + i * 0.012, x: Math.cos(i) * 8, y: 1, z: Math.sin(i) * 8 });
    },
  },
};

export async function renderCase(name, { sampleRate = SR, repeats = 3 } = {}) {
  // short renders are dominated by fixed overhead/GC noise: keep the fastest of a few runs
  let best = null;
  for (let i = 0; i < repeats; i++) { const r = await renderOnce(name, sampleRate); if (!best || r.ms < best.ms) best = r; }
  return best;
}

async function renderOnce(name, sampleRate) {
  const c = CASES[name];
  if (!c) throw new Error('unknown case ' + name);
  const len = Math.ceil(c.seconds * sampleRate);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: len, sampleRate });
  const e = createOceanAudio({ context: ctx, volume: 1, ambience: !!c.ambience, worklet: c.worklet !== false, gulls: false, seed: 1234 });
  const tr0 = performance.now();
  await e.resume();
  const setupMs = performance.now() - tr0;
  const ts = performance.now();
  // MIN_GAP is per instance; play() timing (main-thread cost) measured here
  c.run(e, ctx);
  const scheduleMs = performance.now() - ts;
  const t0 = performance.now();
  const buffer = await ctx.startRendering();
  const ms = performance.now() - t0;
  const st = e.stats();
  e.destroy();
  return {
    name, seconds: c.seconds, ms, msPerSec: ms / c.seconds, setupMs, scheduleMs,
    engine: { ambience: st.ambience, nodes: st.nodes },
    stats: analyse(buffer, !c.ambience, c.windows), buffer,
  };
}

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

// direct-form-1 biquad over a Float32Array (analysis only)
function biquad(x, [b0, b1, b2, a1, a2]) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
function bandpassCoef(lo, hi, sr) {          // RBJ constant-0-dB-peak band-pass
  const f = Math.sqrt(lo * hi), q = f / (hi - lo), w = (2 * Math.PI * f) / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  return [al / a0, 0, -al / a0, (-2 * Math.cos(w)) / a0, (1 - al) / a0];
}
// ITU-R BS.1770 K-weighting at 48 kHz; momentary loudness = max over 400 ms windows (100 ms hop), LUFS-like
const K1 = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
const K2 = [1, -2, 1, -1.99004745483398, 0.99007225036621];
function momentaryMax(buf) {
  const sr = buf.sampleRate, n = buf.length, w = Math.floor(sr * 0.4), hop = Math.floor(sr * 0.1);
  const ks = []; for (let c = 0; c < buf.numberOfChannels; c++) ks.push(biquad(biquad(buf.getChannelData(c), K1), K2));
  let best = 0;
  for (let i = 0; i < Math.max(1, n - w + 1); i += hop) {
    let sum = 0; const e = Math.min(n, i + w);
    for (const k of ks) { let q = 0; for (let j = i; j < e; j++) q += k[j] * k[j]; sum += q / w; }
    if (sum > best) best = sum;
  }
  return best > 0 ? -0.691 + 10 * Math.log10(best) : -Infinity;
}
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : x);

export function analyse(buf, oneShot, windows = null) {
  const sr = buf.sampleRate, n = buf.length, chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    let peak = 0, sum = 0, sq = 0, clip = 0, peakAt = 0;
    for (let i = 0; i < n; i++) {
      const x = d[i], a = Math.abs(x);
      if (a > peak) { peak = a; peakAt = i; }
      sum += x; sq += x * x; if (a >= 0.999) clip++;
    }
    // envelope: 10 ms RMS windows
    const w = Math.floor(sr * 0.01), env = [];
    for (let i = 0; i + w <= n; i += w) { let s = 0; for (let j = 0; j < w; j++) s += d[i + j] * d[i + j]; env.push(Math.sqrt(s / w)); }
    const envPeak = Math.max(...env);
    const first = env.findIndex((v) => v > envPeak * 0.1);
    let lastLoud = env.length - 1; while (lastLoud > 0 && env[lastLoud] < envPeak * 0.001) lastLoud--;   // -60 dB
    chans.push({
      peakDb: r1(db(peak)), rmsDb: r1(db(Math.sqrt(sq / n))), dc: +(sum / n).toExponential(2), clipped: clip,
      peakMs: Math.round((peakAt / sr) * 1000), onsetMs: first * 10,
      tailDb: r1(db(env[env.length - 1]) - db(envPeak)),     // last 10 ms vs loudest 10 ms
      decay60Ms: (lastLoud + 1) * 10,
      firstSample: +Math.abs(d[0]).toExponential(1),
    });
  }
  let corr = null;
  if (buf.numberOfChannels === 2) {
    const a = buf.getChannelData(0), b = buf.getChannelData(1);
    let ab = 0, aa = 0, bb = 0; for (let i = 0; i < n; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
    corr = aa && bb ? +(ab / Math.sqrt(aa * bb)).toFixed(2) : null;
  }
  const peakDb = Math.max(...chans.map((c) => c.peakDb)), rmsDb = Math.max(...chans.map((c) => c.rmsDb));
  const warn = [];
  if (chans.some((c) => c.clipped)) warn.push('clipping');
  if (peakDb > -0.5) warn.push('peak > -0.5 dBFS');
  if (chans.some((c) => Math.abs(c.dc) > 1e-3)) warn.push('DC offset');
  if (oneShot && chans.some((c) => c.tailDb > -40)) warn.push('tail not decayed (truncated?)');
  if (rmsDb < -60) warn.push('nearly silent');
  // windows: [from, to] full-band RMS of L, or [from, to, loHz, hiHz] band RMS of (L+R)/2
  const mono = new Float32Array(n); { const a = buf.getChannelData(0), b = buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0); for (let i = 0; i < n; i++) mono[i] = (a[i] + b[i]) * 0.5; }
  const bands = {};
  const win = windows && windows.map(([a, b, lo, hi]) => {
    const d = lo ? (bands[lo + '-' + hi] ||= biquad(mono, bandpassCoef(lo, hi, sr))) : buf.getChannelData(0);
    const i0 = Math.floor(a * sr), i1 = Math.min(n, Math.floor(b * sr));
    let q = 0; for (let i = i0; i < i1; i++) q += d[i] * d[i];
    return { from: a, to: b, ...(lo ? { band: [lo, hi] } : {}), rmsDb: r1(db(Math.sqrt(q / Math.max(1, i1 - i0)))) };
  });
  return { peakDb, rmsDb, loudMax: r1(momentaryMax(buf)), windows: win, LR: chans.map((c) => c.peakDb), corr, chans, warn };
}

// ---- drawing -----------------------------------------------------------------
function fft(re, im) {                       // in-place radix-2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
function heat(v) {                           // 0..1 -> dark blue / teal / yellow / white
  const stops = [[0, 8, 12, 28], [0.35, 20, 70, 120], [0.6, 40, 160, 150], [0.82, 240, 210, 80], [1, 255, 255, 240]];
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
    const [a, ...c0] = stops[i - 1], [b, ...c1] = stops[i], k = (v - a) / (b - a);
    return c0.map((x, j) => Math.round(x + (c1[j] - x) * k));
  }
  return stops[stops.length - 1].slice(1);
}

export function drawReport(canvas, r) {
  const W = 1000, WH = 170, SH = 220, H = 30 + WH + SH + 24;
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d'), buf = r.buffer, n = buf.length, sr = buf.sampleRate;
  g.fillStyle = '#0d1420'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#e6edf5'; g.font = '14px monospace';
  const s = r.stats;
  g.fillText(`${r.name}  ${r.seconds}s  peak ${s.peakDb} dBFS  rms ${s.rmsDb} dBFS  L/R ${s.LR.join('/')}  corr ${s.corr}  render ${r.msPerSec.toFixed(1)} ms/s`, 8, 19);
  if (s.warn.length) { g.fillStyle = '#ff8a7a'; g.fillText('WARN: ' + s.warn.join(', '), 650, H - 7); }
  // waveform
  const y0 = 30, mid = y0 + WH / 2;
  g.strokeStyle = '#2a3646'; g.beginPath(); g.moveTo(0, mid); g.lineTo(W, mid); g.stroke();
  for (const lvl of [0.5, 1]) { g.strokeStyle = lvl === 1 ? '#7a3b3b' : '#263040'; g.beginPath(); g.moveTo(0, mid - lvl * WH / 2); g.lineTo(W, mid - lvl * WH / 2); g.moveTo(0, mid + lvl * WH / 2); g.lineTo(W, mid + lvl * WH / 2); g.stroke(); }
  const cols = ['rgba(110,200,255,.85)', 'rgba(255,170,90,.6)'];
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c); g.fillStyle = cols[c];
    for (let x = 0; x < W; x++) {
      const a = Math.floor((x * n) / W), b = Math.max(a + 1, Math.floor(((x + 1) * n) / W));
      let lo = 1, hi = -1; for (let i = a; i < b; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      g.fillRect(x, mid - hi * WH / 2, 1, Math.max(1, (hi - lo) * WH / 2));
    }
  }
  // spectrogram (mid channel), log frequency 40 Hz .. 16 kHz
  const sy = y0 + WH + 4, N = 2048, re = new Float32Array(N), im = new Float32Array(N);
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const img = g.createImageData(W, SH), fmin = 40, fmax = 16000;
  const binOf = (row) => (fmin * Math.pow(fmax / fmin, 1 - row / (SH - 1))) / (sr / N);
  for (let x = 0; x < W; x++) {
    const c = Math.floor((x / W) * n) - N / 2;
    for (let i = 0; i < N; i++) { const j = c + i, w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); re[i] = j >= 0 && j < n ? (L[j] + R[j]) * 0.5 * w : 0; im[i] = 0; }
    fft(re, im);
    for (let row = 0; row < SH; row++) {
      const k = Math.min(N / 2 - 1, Math.round(binOf(row)));
      const mag = Math.hypot(re[k], im[k]) / (N / 4);
      const v = Math.min(1, Math.max(0, (db(mag) + 100) / 90));
      const [cr, cg, cb] = heat(v), o = (row * W + x) * 4;
      img.data[o] = cr; img.data[o + 1] = cg; img.data[o + 2] = cb; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, sy);
  g.fillStyle = 'rgba(230,237,245,.75)'; g.font = '11px monospace';
  for (const f of [100, 300, 1000, 3000, 10000]) {
    const row = (1 - Math.log(f / fmin) / Math.log(fmax / fmin)) * (SH - 1);
    g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), 4, sy + row + 4);
  }
  for (let t = 0; t <= r.seconds; t += r.seconds > 4 ? 1 : 0.1) {
    const x = (t / r.seconds) * W; g.fillRect(x, sy + SH, 1, 5);
    if (r.seconds > 4 || Math.round(t * 10) % 2 === 0) g.fillText(t.toFixed(r.seconds > 4 ? 0 : 1), x + 2, sy + SH + 14);
  }
  return canvas;
}

export function wavBase64(buf) {
  const ch = buf.numberOfChannels, n = buf.length, bytes = 44 + n * ch * 2;
  const ab = new ArrayBuffer(bytes), v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const x = Math.max(-1, Math.min(1, data[c][i])); v.setInt16(o, x < 0 ? x * 32768 : x * 32767, true); o += 2; }
  const u8 = new Uint8Array(ab); let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// main-thread cost of play() (JS scheduling only; DSP is on the audio thread) and Web Audio nodes per voice
export async function scheduleCost(reps = 100) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR, sampleRate: SR });
  const out = {};
  for (const ev of EVENTS) {
    const ms = []; let nodes = 0;
    for (let i = 0; i < reps; i++) {
      const e = createOceanAudio({ context: ctx, volume: 1, ambience: false, gulls: false });
      await e.resume();
      const base = e.stats().nodes, t = performance.now();
      e.play(ev, 1);
      ms.push(performance.now() - t); nodes = e.stats().nodes - base;
      e.destroy();
    }
    ms.sort((a, b) => a - b);
    out[ev] = { medianMs: +ms[ms.length >> 1].toFixed(3), p95Ms: +ms[Math.floor(ms.length * 0.95)].toFixed(3), nodes };
  }
  return out;
}
