// audio.js - original procedural sound for Little Raft (Web Audio only, no files).
// Usage:
//   import { createOceanAudio } from './audio.js?build=v3-survival-ae77fa84ac2b';
//   const audio = createOceanAudio({ context: previous?.context ?? null, volume: 0.5 });
//   button.addEventListener('pointerdown', () => audio.resume());   // user gesture
//   audio.play('build', 1);
//
// API: createOceanAudio({context=null, volume=.5, ambience=true}={}) ->
//   context          getter, latest AudioContext (null until resume() creates one)
//   resume()         creates (lazily) / resumes the context, starts quiet surf; Promise<boolean>
//   setVolume(v)     master volume, clamped 0..1; returns the clamped value
//   play(ev, s=1)    ev in EVENTS; s clamped 0..1; returns true if scheduled, else false (never throws)
//   destroy()        stops + disconnects only this instance's nodes; never closes the context
//
// Notes: no DOM timers; cleanup is driven by AudioScheduledSourceNode 'ended'.
// All sound passes one master gain (volume * OUTPUT_SCALE) and a gentle limiter.

export const EVENTS = Object.freeze(['throw', 'splash', 'collect', 'build', 'repair', 'jump', 'swim', 'ui']);

const OUTPUT_SCALE = 0.5;       // keeps full volume comfortable
const AMBIENCE_MAX = 0.025;     // peak surf gain before master
const MAX_VOICES = 18;
const MIN_GAP = { throw: 0.08, splash: 0.06, collect: 0.03, build: 0.05, repair: 0.12, jump: 0.1, swim: 0.11, ui: 0.025 };
const SILENT = 0.0001;

const clamp01 = (v, d = 0) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const rand = (a, b) => a + Math.random() * (b - a);

export function createOceanAudio({ context = null, volume = 0.5, ambience = true } = {}) {
  let ctx = context && typeof context.createGain === 'function' ? context : null;
  let vol = clamp01(volume, 0.5);
  let destroyed = false;
  let graph = null;          // { master, limiter, tone, noise, brown }
  let amb = null;            // { nodes, sources }
  const voices = new Set();
  const lastPlay = Object.create(null);

  function getCtor() {
    if (typeof globalThis === 'undefined') return null;
    return globalThis.AudioContext || globalThis.webkitAudioContext || null;
  }

  function makeNoise(seconds, brown) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (!brown) {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) * 0.998; d[i] = last; }
    // remove drift so the loop point is continuous, then normalise
    const start = d[0], drift = (d[len - 1] - start) / (len - 1);
    let peak = 0;
    for (let i = 0; i < len; i++) { d[i] -= start + drift * i; peak = Math.max(peak, Math.abs(d[i])); }
    const k = peak > 0 ? 0.9 / peak : 0;
    for (let i = 0; i < len; i++) d[i] *= k;
    return buf;
  }

  function buildGraph() {
    if (graph || !ctx) return !!graph;
    try {
      const master = ctx.createGain();
      master.gain.value = vol * OUTPUT_SCALE;
      const tone = ctx.createBiquadFilter();       // gentle top cut: muted, tactile palette
      tone.type = 'lowpass'; tone.frequency.value = 6000; tone.Q.value = 0.5;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -14; limiter.knee.value = 8; limiter.ratio.value = 6;
      limiter.attack.value = 0.004; limiter.release.value = 0.2;
      tone.connect(master); master.connect(limiter); limiter.connect(ctx.destination);
      graph = { master, tone, limiter, noise: makeNoise(1.5, false), brown: makeNoise(6, true) };
      return true;
    } catch (_) { graph = null; return false; }
  }

  function startAmbience() {
    if (!ambience || amb || !graph || destroyed) return;
    try {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = graph.brown; src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.3;
      const swell = ctx.createGain();
      // base + two slow swells; max = .015 + .005 + .004 = .024 <= AMBIENCE_MAX
      const base = Math.min(0.015, AMBIENCE_MAX);
      swell.gain.setValueAtTime(0, t);
      swell.gain.linearRampToValueAtTime(base, t + 3);   // fade in, no pop
      const lfo1 = ctx.createOscillator(); lfo1.frequency.value = 0.071;
      const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.127;
      const d1 = ctx.createGain(); d1.gain.value = 0.005;
      const d2 = ctx.createGain(); d2.gain.value = 0.004;
      const lfoF = ctx.createGain(); lfoF.gain.value = 120;  // filter breathes with the swell
      lfo1.connect(d1); lfo2.connect(d2); d1.connect(swell.gain); d2.connect(swell.gain);
      lfo1.connect(lfoF); lfoF.connect(lp.frequency);
      src.connect(hp); hp.connect(lp); lp.connect(swell); swell.connect(graph.tone);
      src.start(t, Math.random() * 5); lfo1.start(t); lfo2.start(t);
      amb = { sources: [src, lfo1, lfo2], nodes: [src, lfo1, lfo2, hp, lp, swell, d1, d2, lfoF] };
    } catch (_) { amb = null; }
  }

  function stopAmbience() {
    if (!amb) return;
    for (const s of amb.sources) { try { s.stop(); } catch (_) {} }
    for (const n of amb.nodes) { try { n.disconnect(); } catch (_) {} }
    amb = null;
  }

  // ---- voice helpers -------------------------------------------------------
  function newVoice() {
    const bus = ctx.createGain();
    bus.connect(graph.tone);
    return { bus, nodes: [bus], sources: [], live: 0, done: false };
  }
  function finishVoice(v) {
    if (v.done) return;
    v.done = true;
    for (const n of v.nodes) { try { n.disconnect(); } catch (_) {} }
    voices.delete(v);
  }
  function track(v, node) { v.nodes.push(node); return node; }
  function startSource(v, src, t0, t1, offset = 0) {
    v.sources.push(src); v.live++;
    src.onended = () => { if (--v.live <= 0) finishVoice(v); };
    src.start(t0, offset);
    src.stop(t1);
  }
  function gain(v, dest) { const g = track(v, ctx.createGain()); g.gain.value = 0; g.connect(dest); return g; }
  function filter(v, type, freq, q, dest) {
    const f = track(v, ctx.createBiquadFilter());
    f.type = type; f.frequency.value = freq; f.Q.value = q; f.connect(dest); return f;
  }
  // attack/decay envelope; returns end time
  function env(g, t, attack, peak, decay) {
    const p = g.gain;
    p.setValueAtTime(SILENT, t);
    p.linearRampToValueAtTime(Math.max(SILENT, peak), t + attack);
    p.exponentialRampToValueAtTime(SILENT, t + attack + decay);
    return t + attack + decay;
  }
  function noise(v, t, dur, dest) {
    const src = track(v, ctx.createBufferSource());
    src.buffer = graph.noise;
    src.connect(dest);
    startSource(v, src, t, t + dur + 0.02, Math.random() * (graph.noise.duration - dur - 0.05 > 0 ? graph.noise.duration - dur - 0.05 : 0));
    return src;
  }
  function osc(v, type, freq, t, dur, dest) {
    const o = track(v, ctx.createOscillator());
    o.type = type; o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    startSource(v, o, t, t + dur + 0.02);
    return o;
  }

  // ---- sound recipes -------------------------------------------------------
  function knock(v, t, s, f) {
    // muted plank knock: resonant noise tick + short falling body tone
    const g1 = gain(v, v.bus);
    const bp = filter(v, 'bandpass', f * 2.3, 3.5, g1);
    noise(v, t, env(g1, t, 0.001, 0.55 * s, 0.055) - t, bp);
    const g2 = gain(v, v.bus);
    const o = osc(v, 'sine', f, t, env(g2, t, 0.002, 0.38 * s, 0.11) - t, g2);
    o.frequency.exponentialRampToValueAtTime(f * 0.68, t + 0.1);
  }

  const recipes = {
    build(v, t, s) {
      const lp = filter(v, 'lowpass', 2600, 0.7, v.bus); v.bus = lp; // muffle wood
      const f = rand(150, 185);
      knock(v, t, s, f);
      knock(v, t + rand(0.1, 0.13), s * 0.75, f * 0.88);
    },
    throw(v, t, s) {
      // rope swish: band of noise sweeping up then settling
      const g = gain(v, v.bus);
      const bp = filter(v, 'bandpass', 500, 2.2, g);
      const dur = 0.34;
      bp.frequency.setValueAtTime(rand(420, 520), t);
      bp.frequency.exponentialRampToValueAtTime(rand(2100, 2600), t + 0.19);
      bp.frequency.exponentialRampToValueAtTime(1100, t + dur);
      g.gain.setValueAtTime(SILENT, t);
      g.gain.linearRampToValueAtTime(0.4 * s, t + 0.13);
      g.gain.exponentialRampToValueAtTime(SILENT, t + dur);
      noise(v, t, dur, bp);
    },
    splash(v, t, s) {
      // small splash: bright noise burst closing down, plus a few droplets
      const g = gain(v, v.bus);
      const lp = filter(v, 'lowpass', 3600, 0.8, g);
      const hp = filter(v, 'highpass', 260, 0.7, lp);
      lp.frequency.setValueAtTime(rand(3200, 4000), t);
      lp.frequency.exponentialRampToValueAtTime(480, t + 0.4);
      noise(v, t, env(g, t, 0.006, 0.45 * s, 0.4) - t, hp);
      const drops = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < drops; i++) {
        const dt = t + rand(0.05, 0.24), f = rand(850, 1500);
        const dg = gain(v, v.bus);
        const o = osc(v, 'sine', f, dt, env(dg, dt, 0.002, 0.05 * s, 0.05) - dt, dg);
        o.frequency.exponentialRampToValueAtTime(f * 1.7, dt + 0.04);
      }
    },
    swim(v, t, s) {
      // soft paddle stroke: wet swirl falling in pitch, faint second wash
      for (let i = 0; i < 2; i++) {
        const st = t + i * rand(0.1, 0.14), k = i ? 0.5 : 1;
        const g = gain(v, v.bus);
        const bp = filter(v, 'bandpass', 1400, 1.1, g);
        bp.frequency.setValueAtTime(rand(1200, 1600) * (i ? 0.8 : 1), st);
        bp.frequency.exponentialRampToValueAtTime(rand(420, 560), st + 0.26);
        noise(v, st, env(g, st, 0.035, 0.24 * s * k, 0.24) - st, bp);
      }
    },
    collect(v, t, s) {
      // light click + two soft rising notes
      const cg = gain(v, v.bus);
      const hp = filter(v, 'highpass', 2600, 0.7, cg);
      noise(v, t, env(cg, t, 0.001, 0.18 * s, 0.014) - t, hp);
      const lp = filter(v, 'lowpass', 3000, 0.5, v.bus);
      const base = rand(840, 900);
      [[0, 1], [0.07, 1.5]].forEach(([dt, r]) => {
        const g = gain(v, lp);
        osc(v, 'triangle', base * r, t + dt, env(g, t + dt, 0.004, 0.12 * s, 0.13) - (t + dt), g);
      });
    },
    repair(v, t, s) {
      // scrape: grainy band noise with fast tremolo, ending on a soft knock
      const g = gain(v, v.bus);
      const trem = track(v, ctx.createGain()); trem.gain.value = 0.55; trem.connect(g);
      const bp = filter(v, 'bandpass', 1000, 1.8, trem);
      bp.frequency.setValueAtTime(rand(850, 950), t);
      bp.frequency.linearRampToValueAtTime(rand(1300, 1500), t + 0.3);
      const depth = track(v, ctx.createGain()); depth.gain.value = 0.45; depth.connect(trem.gain);
      const lfo = osc(v, 'triangle', rand(18, 24), t, 0.34, depth);
      lfo.frequency.linearRampToValueAtTime(rand(26, 32), t + 0.3);
      g.gain.setValueAtTime(SILENT, t);
      g.gain.linearRampToValueAtTime(0.28 * s, t + 0.04);
      g.gain.setValueAtTime(0.28 * s, t + 0.24);
      g.gain.exponentialRampToValueAtTime(SILENT, t + 0.34);
      noise(v, t, 0.34, bp);
      knock(v, t + 0.36, s * 0.5, rand(165, 185));
    },
    jump(v, t, s) {
      // soft push-off thump
      const g = gain(v, v.bus);
      const o = osc(v, 'sine', 120, t, env(g, t, 0.004, 0.32 * s, 0.16) - t, g);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.15);
      const ng = gain(v, v.bus);
      const lp = filter(v, 'lowpass', 320, 0.7, ng);
      noise(v, t, env(ng, t, 0.002, 0.22 * s, 0.09) - t, lp);
    },
    ui(v, t, s) {
      const cg = gain(v, v.bus);
      const hp = filter(v, 'highpass', 3000, 0.7, cg);
      noise(v, t, env(cg, t, 0.001, 0.1 * s, 0.01) - t, hp);
      const g = gain(v, v.bus);
      osc(v, 'sine', 1250, t, env(g, t, 0.002, 0.05 * s, 0.04) - t, g);
    },
  };

  // ---- public API ----------------------------------------------------------
  async function resume() {
    if (destroyed) return false;
    try {
      if (!ctx) {
        const Ctor = getCtor();
        if (!Ctor) return false;
        ctx = new Ctor({ latencyHint: 'interactive' });
      }
      if (ctx.state === 'closed') return false;
      if (!buildGraph()) return false;
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') await ctx.resume();
      if (destroyed) return false;
      startAmbience();
      return ctx.state === 'running';
    } catch (_) { return false; }
  }

  function setVolume(v) {
    vol = clamp01(v, vol);
    if (graph && ctx) {
      try { graph.master.gain.setTargetAtTime(vol * OUTPUT_SCALE, ctx.currentTime, 0.03); }
      catch (_) { try { graph.master.gain.value = vol * OUTPUT_SCALE; } catch (__) {} }
    }
    return vol;
  }

  function play(event, strength = 1) {
    try {
      if (destroyed || !graph || !ctx || ctx.state !== 'running' || vol <= 0) return false;
      const recipe = Object.prototype.hasOwnProperty.call(recipes, event) ? recipes[event] : null;
      if (!recipe) return false;
      const s = clamp01(strength, 1);
      if (s <= 0.001 || voices.size >= MAX_VOICES) return false;
      const now = ctx.currentTime;
      if (now - (lastPlay[event] ?? -1) < MIN_GAP[event]) return false;
      lastPlay[event] = now;
      const v = newVoice();
      voices.add(v);
      try { recipe(v, now + 0.005, s); }
      catch (_) { killVoice(v); return false; }
      if (v.live === 0) finishVoice(v);
      return true;
    } catch (_) { return false; }
  }

  function killVoice(v) {
    for (const src of v.sources) { src.onended = null; try { src.stop(); } catch (_) {} }
    finishVoice(v);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const v of [...voices]) killVoice(v);
    voices.clear();
    stopAmbience();
    if (graph) {
      for (const n of [graph.tone, graph.master, graph.limiter]) { try { n.disconnect(); } catch (_) {} }
      graph = null;
    }
    // The AudioContext (supplied or lazily created) is intentionally left open so a
    // hot-updated module can reuse it via `instance.context`.
  }

  return {
    get context() { return ctx; },
    resume,
    setVolume,
    play,
    destroy,
  };
}

export default createOceanAudio;
