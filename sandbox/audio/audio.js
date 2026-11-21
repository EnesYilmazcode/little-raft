// audio.js - procedural sound for Little Raft (Web Audio only, no asset files).
// Drop-in replacement for dist/audio.js: same factory, same five members, same events;
// everything new is optional.
//
//   import { createOceanAudio } from './audio.js?build=...';
//   const audio = createOceanAudio({ context: previous?.context ?? null, volume: 0.5 });
//   canvas.addEventListener('pointerdown', () => audio.resume());     // user gesture
//   audio.play('hammer', 1, { x, y, z });                              // position optional
//
// Kept API: context (getter), resume() -> Promise<bool>, setVolume(v) -> v, play(ev, s=1, opts?) -> bool, destroy()
// New (optional):
//   setListener(x,y,z, fx,fy,fz)   camera position + forward, call per frame (PannerNode listener)
//   setOcean({swell, wind, speed, creak})   0..1 sea state, smoothed over ~1 s
//   setReel(on, speed=.5, pos?)    looping ratchet + line hiss while reeling
//   setBus(name, v)                'ambience' | 'sfx' | 'ui' gain 0..1
//   duck(amount, hold)             dip ambience (play() does this for big events)
//   stats()                        {voices, worklet, nodes, state}
// opts for play(): {x,y,z} spatialises through a PannerNode; {at} absolute ctx time (offline renders).
//
// Graph: voices -> [panner] -> sfx/ui bus ─┐
//        ocean worklet (or node fallback) -> ambience bus -> duck ─┴> mix -> master(volume) -> limiter -> out
// No DOM timers: one-shot cleanup and the gull scheduler both run off AudioScheduledSourceNode 'ended'.

export const EVENTS = Object.freeze([
  // original events (dist/audio.js v1)
  'throw', 'splash', 'collect', 'build', 'repair', 'jump', 'swim', 'ui',
  // added
  'reel', 'catch', 'hammer', 'pickup', 'craft', 'error', 'bite', 'return', 'creak', 'gull', 'hover',
]);

const OUTPUT_SCALE = 0.8;
const MAX_VOICES = 24;
const SILENT = 0.0001;
const MIN_GAP = {
  throw: 0.08, splash: 0.06, collect: 0.03, build: 0.05, repair: 0.12, jump: 0.1, swim: 0.11, ui: 0.025,
  reel: 0.03, catch: 0.08, hammer: 0.06, pickup: 0.03, craft: 0.1, error: 0.15, bite: 0.2, return: 0.1,
  creak: 0.15, gull: 0.3, hover: 0.04,
};
const UI_EVENTS = new Set(['ui', 'hover', 'error', 'craft']);
const REF_DISTANCE = { gull: 10, creak: 3 };       // metres at which a spatial voice is at full level
const DUCK = { splash: 0.35, catch: 0.4, hammer: 0.25, build: 0.25, craft: 0.2, jump: 0.15 };

const clamp01 = (v, d = 0) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const rand = (a, b) => a + Math.random() * (b - a);
const workletDefault = (() => {
  try { const u = new URL(import.meta.url); return new URL('./audio-worklet.js' + u.search, u).href; } catch (_) { return null; }
})();

export function createOceanAudio({
  context = null, volume = 0.5, ambience = true, worklet = true, workletUrl = workletDefault,
  hrtf = false, gulls = true,
} = {}) {
  let ctx = context && typeof context.createGain === 'function' ? context : null;
  let vol = clamp01(volume, 0.5);
  let destroyed = false, wantRun = false;
  let graph = null;          // buses + shared buffers
  let amb = null;            // { kind, node?, sources, nodes, params }
  let ambPromise = null;
  let reel = null;
  let gullClock = null;
  let nodeCount = 0;
  const ocean = { swell: 0.5, wind: 0.3, speed: 0.2, creak: 0.5 };
  const voices = new Set();
  const lastPlay = Object.create(null);
  const isOffline = () => !!ctx && typeof ctx.startRendering === 'function';

  function getCtor() {
    if (typeof globalThis === 'undefined') return null;
    return globalThis.AudioContext || globalThis.webkitAudioContext || null;
  }

  function makeNoise(seconds, kind) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) * 0.998; d[i] = last; }
      else if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
      } else d[i] = w;
    }
    // remove mean (no DC), crossfade tail into head for click-free loops, normalise
    let mean = 0; for (let i = 0; i < len; i++) mean += d[i]; mean /= len;
    for (let i = 0; i < len; i++) d[i] -= mean;
    const xf = Math.min(2048, len >> 2);
    for (let i = 0; i < xf; i++) { const k = i / xf; d[i] = d[i] * k + d[len - xf + i] * (1 - k); }
    let peak = 0; for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    const k = peak > 0 ? 0.95 / peak : 0;
    for (let i = 0; i < len; i++) d[i] *= k;
    return buf;
  }

  function buildGraph() {
    if (graph || !ctx) return !!graph;
    try {
      const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
      const master = g(vol * OUTPUT_SCALE);
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6; limiter.knee.value = 4; limiter.ratio.value = 12;
      limiter.attack.value = 0.002; limiter.release.value = 0.15;
      const tone = ctx.createBiquadFilter();           // gentle top cut: muted, tactile palette
      tone.type = 'lowpass'; tone.frequency.value = 9000; tone.Q.value = 0.5;
      const mix = g(1);
      const ambBus = g(1), ambDuck = g(1), sfxBus = g(1), uiBus = g(0.8);
      ambBus.connect(ambDuck); ambDuck.connect(mix); sfxBus.connect(mix); uiBus.connect(mix);
      mix.connect(tone); tone.connect(master); master.connect(limiter); limiter.connect(ctx.destination);
      graph = {
        master, limiter, tone, mix, ambBus, ambDuck, sfxBus, uiBus,
        white: makeNoise(2, 'white'), pink: makeNoise(3, 'pink'), brown: makeNoise(6, 'brown'),
      };
      nodeCount += 9;
      return true;
    } catch (_) { graph = null; return false; }
  }

  // ---- ambience -------------------------------------------------------------
  async function startAmbience() {
    if (!ambience || amb || ambPromise || !graph || destroyed) return ambPromise;
    ambPromise = (async () => {
      if (worklet && workletUrl && ctx.audioWorklet && typeof AudioWorkletNode === 'function') {
        try {
          await ctx.audioWorklet.addModule(workletUrl);
          if (destroyed || !graph) return;
          const node = new AudioWorkletNode(ctx, 'raft-ocean', {
            numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
            processorOptions: { seed: (Math.random() * 2 ** 31) | 0 },
          });
          const fade = ctx.createGain(); fade.gain.setValueAtTime(0, ctx.currentTime);
          fade.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5);    // fade in, no pop
          node.connect(fade); fade.connect(graph.ambBus);
          amb = { kind: 'worklet', node, sources: [], nodes: [node, fade], params: node.parameters };
          nodeCount += 2;
          applyOcean(0.01);
          return;
        } catch (e) { /* fall through to the node graph */ amb = null; }
      }
      startNodeAmbience();
    })();
    try { await ambPromise; } finally { ambPromise = null; }
  }

  // Fallback (no AudioWorklet, e.g. insecure http origin): looped noise + biquads + LFOs.
  function startNodeAmbience() {
    try {
      const t = ctx.currentTime, nodes = [], sources = [];
      const mk = (n) => { nodes.push(n); return n; };
      const fade = mk(ctx.createGain()); fade.gain.setValueAtTime(0, t); fade.gain.linearRampToValueAtTime(1, t + 2.5);
      fade.connect(graph.ambBus);
      const loop = (buf, dest) => { const s = mk(ctx.createBufferSource()); s.buffer = buf; s.loop = true; s.connect(dest); s.start(t, Math.random() * buf.duration); sources.push(s); };
      const lfo = (hz, depth, param) => { const o = mk(ctx.createOscillator()); o.frequency.value = hz; const d = mk(ctx.createGain()); d.gain.value = depth; o.connect(d); d.connect(param); o.start(t); sources.push(o); };
      const bq = (type, f, q, dest) => { const b = mk(ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q; b.connect(dest); return b; };
      const bedG = mk(ctx.createGain()); bedG.gain.value = 0.16; bedG.connect(fade);
      const bedLp = bq('lowpass', 380, 0.4, bedG); const bedHp = bq('highpass', 40, 0.7, bedLp);
      lfo(0.1, 140, bedLp.frequency); lfo(0.1, 0.06, bedG.gain); lfo(0.157, 0.04, bedG.gain);
      loop(graph.brown, bedHp);
      const washG = mk(ctx.createGain()); washG.gain.value = 0.05; washG.connect(fade);
      const washBp = bq('bandpass', 900, 0.8, washG);
      lfo(0.1, 0.045, washG.gain); lfo(0.1, 500, washBp.frequency);
      loop(graph.pink, washBp);
      const windG = mk(ctx.createGain()); windG.gain.value = 0.03; windG.connect(fade);
      const windBp = bq('bandpass', 500, 3, windG);
      lfo(0.19, 120, windBp.frequency); lfo(0.053, 200, windBp.frequency); lfo(0.07, 0.015, windG.gain);
      loop(graph.white, windBp);
      amb = { kind: 'nodes', sources, nodes, params: { bed: bedG.gain, wash: washG.gain, wind: windG.gain, windF: windBp.frequency } };
      nodeCount += nodes.length;
      applyOcean(0.01);
    } catch (_) { amb = null; }
  }

  function applyOcean(tc = 1) {
    if (!amb || !ctx) return;
    const t = ctx.currentTime, p = amb.params;
    const set = (param, v) => { try { param.setTargetAtTime(v, t, tc); } catch (_) {} };
    if (amb.kind === 'worklet') {
      for (const k of ['swell', 'wind', 'speed', 'creak']) { const prm = p.get(k); if (prm) set(prm, ocean[k]); }
    } else {
      set(p.bed, 0.08 + 0.12 * ocean.swell); set(p.wash, 0.02 + 0.06 * ocean.swell);
      set(p.wind, 0.005 + 0.08 * ocean.wind * ocean.wind); set(p.windF, 300 + 700 * ocean.wind);
    }
  }

  function stopAmbience() {
    if (!amb) return;
    if (amb.node) { try { amb.node.port.postMessage({ type: 'stop' }); } catch (_) {} }
    for (const s of amb.sources) { try { s.stop(); } catch (_) {} }
    for (const n of amb.nodes) { try { n.disconnect(); } catch (_) {} }
    amb = null;
  }

  // Audio-clock scheduler for ambient gulls: a silent ConstantSource whose 'ended' schedules the next call.
  function scheduleGulls() {
    if (!gulls || gullClock || destroyed || !graph || isOffline() || typeof ctx.createConstantSource !== 'function') return;
    const tick = () => {
      gullClock = null;
      if (destroyed || !graph) return;
      if (Math.random() < 0.4 + 0.3 * (1 - ocean.wind)) {
        const a = rand(0, Math.PI * 2), d = rand(14, 40);
        play('gull', rand(0.4, 0.9), { x: listener.x + Math.cos(a) * d, y: listener.y + rand(6, 16), z: listener.z + Math.sin(a) * d });
      }
      arm(rand(9, 30));
    };
    const arm = (sec) => {
      try {
        const c = ctx.createConstantSource(); c.offset.value = 0;
        c.onended = tick; c.start(); c.stop(ctx.currentTime + sec); gullClock = c;
      } catch (_) { gullClock = null; }
    };
    arm(rand(4, 12));
  }

  // ---- spatial ------------------------------------------------------------------
  const listener = { x: 0, y: 0, z: 0 };
  function setListener(x, y, z, fx = 0, fy = 0, fz = -1) {
    if (![x, y, z, fx, fy, fz].every(Number.isFinite)) return;
    listener.x = x; listener.y = y; listener.z = z;
    if (!ctx) return;
    const L = ctx.listener, t = ctx.currentTime;
    try {
      if (L.positionX) {
        L.positionX.setTargetAtTime(x, t, 0.015); L.positionY.setTargetAtTime(y, t, 0.015); L.positionZ.setTargetAtTime(z, t, 0.015);
        L.forwardX.setTargetAtTime(fx, t, 0.015); L.forwardY.setTargetAtTime(fy, t, 0.015); L.forwardZ.setTargetAtTime(fz, t, 0.015);
        L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
      } else { L.setPosition(x, y, z); L.setOrientation(fx, fy, fz, 0, 1, 0); }
    } catch (_) {}
  }
  function panner(v, pos, dest, ref = 2) {
    const p = track(v, ctx.createPanner());
    p.panningModel = hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1; p.maxDistance = 80;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y ?? listener.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y ?? listener.y, pos.z);
    p.connect(dest);
    return p;
  }

  // ---- voice helpers ----------------------------------------------------------
  function newVoice(dest) {
    const bus = ctx.createGain(); nodeCount++;
    bus.connect(dest);
    return { bus, out: bus, nodes: [bus], sources: [], live: 0, done: false };
  }
  function finishVoice(v) {
    if (v.done) return;
    v.done = true;
    for (const n of v.nodes) { try { n.disconnect(); } catch (_) {} }
    voices.delete(v);
  }
  function track(v, node) { v.nodes.push(node); nodeCount++; return node; }
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
  function env(g, t, attack, peak, decay) {   // attack/decay envelope; returns end time
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(Math.max(SILENT, peak), t + attack);
    p.exponentialRampToValueAtTime(SILENT, t + attack + decay);
    p.linearRampToValueAtTime(0, t + attack + decay + 0.01);
    return t + attack + decay + 0.01;
  }
  function noise(v, t, dur, dest, buf = graph.white) {
    const src = track(v, ctx.createBufferSource());
    src.buffer = buf;
    src.connect(dest);
    const room = buf.duration - dur - 0.05;
    startSource(v, src, t, t + dur + 0.02, room > 0 ? Math.random() * room : 0);
    return src;
  }
  function osc(v, type, freq, t, dur, dest) {
    const o = track(v, ctx.createOscillator());
    o.type = type; o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    startSource(v, o, t, t + dur + 0.02);
    return o;
  }
  // decaying sine partials: [[hz, amp, decaySeconds], ...]
  function modes(v, t, dest, list, bend = 1) {
    for (const [f, a, d] of list) {
      const g = gain(v, dest);
      const o = osc(v, 'sine', f, t, env(g, t, 0.0015, a, d) - t, g);
      if (bend !== 1) o.frequency.exponentialRampToValueAtTime(f * bend, t + d);
    }
  }
  // Minnaert-style bubble: short sine whose pitch rises as it decays
  function bubble(v, t, f, amp, dur, dest) {
    const g = gain(v, dest);
    const o = osc(v, 'sine', f, t, env(g, t, 0.002, amp, dur) - t, g);
    o.frequency.exponentialRampToValueAtTime(f * rand(1.4, 2), t + dur);
  }
  function click(v, t, amp, hp, dest, len = 0.012) {
    const g = gain(v, dest);
    const f = filter(v, 'highpass', hp, 0.7, g);
    noise(v, t, env(g, t, 0.0007, amp, len) - t, f);
  }

  // ---- sound recipes ----------------------------------------------------------
  function knock(v, t, s, f) {    // muted plank knock: resonant noise tick + short falling body tone
    const g1 = gain(v, v.out);
    const bp = filter(v, 'bandpass', f * 2.3, 3.5, g1);
    noise(v, t, env(g1, t, 0.001, 0.55 * s, 0.055) - t, bp);
    const g2 = gain(v, v.out);
    const o = osc(v, 'sine', f, t, env(g2, t, 0.002, 0.38 * s, 0.11) - t, g2);
    o.frequency.exponentialRampToValueAtTime(f * 0.68, t + 0.1);
  }
  function hammerHit(v, t, s) {
    // steel face on a nail/plank: bright contact crack, wood body modes, brief head ping
    const g = gain(v, v.out);
    const bp = filter(v, 'bandpass', rand(1800, 2600), 1.4, g);
    noise(v, t, env(g, t, 0.0005, 0.7 * s, 0.03) - t, bp);
    const k = rand(0.93, 1.07);
    modes(v, t, v.out, [[165 * k, 0.42 * s, 0.13], [395 * k, 0.26 * s, 0.08], [720 * k, 0.15 * s, 0.05], [1130 * k, 0.07 * s, 0.035]], 0.92);
    const pg = gain(v, v.out);
    osc(v, 'sine', rand(3100, 3500), t, env(pg, t, 0.0005, 0.05 * s, 0.09) - t, pg);
  }
  function gullCall(v, t, s, f0, len) {
    // nasal "kyow": sawtooth through a formant, fast up-glide then a slow fall, rough FM
    const g = gain(v, v.out);
    const lp = filter(v, 'lowpass', 4200, 0.7, g);
    const bp = filter(v, 'bandpass', 2300, 2.5, lp);
    const o = osc(v, 'sawtooth', f0, t, len + 0.02, bp);
    o.frequency.setValueAtTime(f0 * 0.8, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.25, t + len * 0.18);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.72, t + len);
    const fmg = gain(v, o.frequency); fmg.gain.value = f0 * 0.05;   // roughness
    osc(v, 'sine', rand(38, 55), t, len + 0.02, fmg);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * s, t + 0.025);
    g.gain.setValueAtTime(0.5 * s, t + len * 0.35);
    g.gain.exponentialRampToValueAtTime(SILENT, t + len);
    g.gain.linearRampToValueAtTime(0, t + len + 0.01);
  }

  const recipes = {
    build(v, t, s) {                    // legacy two-knock build (kept for old callers)
      v.out = filter(v, 'lowpass', 2600, 0.7, v.bus);
      const f = rand(150, 185);
      knock(v, t, s, f);
      knock(v, t + rand(0.1, 0.13), s * 0.75, f * 0.88);
    },
    hammer(v, t, s) { hammerHit(v, t, s); },
    throw(v, t, s) {
      // swing whoosh + rope paying out (higher, thinner zip that falls as the hook flies off)
      const dur = 0.25 + 0.15 * s;
      const g = gain(v, v.out);
      const bp = filter(v, 'bandpass', 500, 1.6, g);
      bp.frequency.setValueAtTime(rand(380, 460), t);
      bp.frequency.exponentialRampToValueAtTime(rand(1700, 2200) * (0.8 + 0.4 * s), t + dur * 0.45);
      bp.frequency.exponentialRampToValueAtTime(700, t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.55 * (0.5 + 0.5 * s), t + dur * 0.4);
      g.gain.exponentialRampToValueAtTime(SILENT, t + dur);
      g.gain.linearRampToValueAtTime(0, t + dur + 0.01);
      noise(v, t, dur + 0.02, bp, graph.pink);
      const zg = gain(v, v.out);
      const zbp = filter(v, 'bandpass', 4000, 6, zg);
      const zt = t + dur * 0.3, zd = 0.35 + 0.25 * s;
      zbp.frequency.setValueAtTime(5200, zt);
      zbp.frequency.exponentialRampToValueAtTime(2400, zt + zd);
      noise(v, zt, env(zg, zt, 0.03, 0.12 * s, zd) - zt, zbp);
    },
    splash(v, t, s) {
      // plop (cavity) + noise burst closing down + bubbles; bigger strength = bigger body
      const big = s > 0.75;
      const pg = gain(v, v.out);
      const po = osc(v, 'sine', big ? 260 : rand(420, 520), t, env(pg, t, 0.002, 0.35 * s, 0.07) - t, pg);
      po.frequency.exponentialRampToValueAtTime(big ? 90 : 170, t + 0.06);
      const g = gain(v, v.out);
      const lp = filter(v, 'lowpass', 3600, 0.8, g);
      const hp = filter(v, 'highpass', 220, 0.7, lp);
      const dur = big ? 0.75 : 0.42;
      lp.frequency.setValueAtTime(rand(4500, 6000), t);
      lp.frequency.exponentialRampToValueAtTime(420, t + dur);
      noise(v, t, env(g, t, 0.004, 0.5 * s, dur) - t, hp);
      const n = (big ? 6 : 3) + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) bubble(v, t + rand(0.04, dur * 0.8), rand(700, 1700), rand(0.03, 0.08) * s, rand(0.03, 0.07), v.out);
    },
    reel(v, t, s) {                     // one ratchet tick (setReel() gives the continuous version)
      click(v, t, 0.3 * s, 2800, v.out, 0.008);
      modes(v, t, v.out, [[rand(2200, 2600), 0.05 * s, 0.02]]);
    },
    catch(v, t, s) {
      // pulled out of the water: upward "shloop", drips, then a bright little two-note pluck
      const g = gain(v, v.out);
      const bp = filter(v, 'bandpass', 400, 2, g);
      bp.frequency.setValueAtTime(320, t);
      bp.frequency.exponentialRampToValueAtTime(2400, t + 0.18);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.9 * s, t + 0.06);
      g.gain.exponentialRampToValueAtTime(SILENT, t + 0.24);
      g.gain.linearRampToValueAtTime(0, t + 0.25);
      noise(v, t, 0.26, bp, graph.pink);
      for (let i = 0; i < 4; i++) bubble(v, t + 0.12 + i * rand(0.05, 0.09), rand(1100, 2000), 0.05 * s, 0.04, v.out);
      const lp = filter(v, 'lowpass', 3500, 0.5, v.out);
      const base = rand(620, 660);
      [[0.16, 1, 0.28], [0.25, 1.5, 0.4]].forEach(([dt, r, a]) => {
        const tg = t + dt, pg = gain(v, lp);
        osc(v, 'triangle', base * r, tg, env(pg, tg, 0.003, a * s, 0.35) - tg, pg);
        const hg = gain(v, lp);
        osc(v, 'sine', base * r * 2, tg, env(hg, tg, 0.002, a * 0.25 * s, 0.12) - tg, hg);
      });
    },
    pickup(v, t, s) {
      // grab: soft cloth/wood rustle + a quick rising pop
      const g = gain(v, v.out);
      const bp = filter(v, 'bandpass', 1500, 0.9, g);
      noise(v, t, env(g, t, 0.006, 0.22 * s, 0.07) - t, bp, graph.pink);
      const pg = gain(v, v.out);
      const o = osc(v, 'sine', 420, t + 0.02, env(pg, t + 0.02, 0.003, 0.3 * s, 0.09) - t - 0.02, pg);
      o.frequency.exponentialRampToValueAtTime(880, t + 0.08);
    },
    collect(v, t, s) {                  // legacy: light click + two soft rising notes
      click(v, t, 0.18 * s, 2600, v.out, 0.014);
      const lp = filter(v, 'lowpass', 3000, 0.5, v.out);
      const base = rand(840, 900);
      [[0, 1], [0.07, 1.5]].forEach(([dt, r]) => {
        const g = gain(v, lp);
        osc(v, 'triangle', base * r, t + dt, env(g, t + dt, 0.004, 0.16 * s, 0.13) - (t + dt), g);
      });
    },
    craft(v, t, s) {                    // three quick knocks then a soft resolve
      v.out = filter(v, 'lowpass', 3000, 0.7, v.bus);
      const f = rand(170, 190);
      knock(v, t, s * 0.7, f); knock(v, t + 0.09, s * 0.6, f * 1.12); knock(v, t + 0.18, s * 0.8, f * 0.9);
      const g = gain(v, v.out);
      osc(v, 'triangle', 784, t + 0.3, env(g, t + 0.3, 0.004, 0.14 * s, 0.4) - t - 0.3, g);
    },
    repair(v, t, s) {                   // scrape: grainy band noise with tremolo, ending on a knock
      const g = gain(v, v.out);
      const trem = track(v, ctx.createGain()); trem.gain.value = 0.55; trem.connect(g);
      const bp = filter(v, 'bandpass', 1000, 1.8, trem);
      bp.frequency.setValueAtTime(rand(850, 950), t);
      bp.frequency.linearRampToValueAtTime(rand(1300, 1500), t + 0.3);
      const depth = track(v, ctx.createGain()); depth.gain.value = 0.45; depth.connect(trem.gain);
      const lfo = osc(v, 'triangle', rand(18, 24), t, 0.34, depth);
      lfo.frequency.linearRampToValueAtTime(rand(26, 32), t + 0.3);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.32 * s, t + 0.04);
      g.gain.setValueAtTime(0.32 * s, t + 0.24);
      g.gain.exponentialRampToValueAtTime(SILENT, t + 0.34);
      g.gain.linearRampToValueAtTime(0, t + 0.35);
      noise(v, t, 0.36, bp);
      knock(v, t + 0.36, s * 0.5, rand(165, 185));
    },
    jump(v, t, s) {
      const g = gain(v, v.out);
      const o = osc(v, 'sine', 120, t, env(g, t, 0.004, 0.4 * s, 0.16) - t, g);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.15);
      const ng = gain(v, v.out);
      const lp = filter(v, 'lowpass', 320, 0.7, ng);
      noise(v, t, env(ng, t, 0.002, 0.3 * s, 0.09) - t, lp);
    },
    swim(v, t, s) {
      for (let i = 0; i < 2; i++) {
        const st = t + i * rand(0.1, 0.14), k = i ? 0.5 : 1;
        const g = gain(v, v.out);
        const bp = filter(v, 'bandpass', 1400, 1.1, g);
        bp.frequency.setValueAtTime(rand(1200, 1600) * (i ? 0.8 : 1), st);
        bp.frequency.exponentialRampToValueAtTime(rand(420, 560), st + 0.26);
        noise(v, st, env(g, st, 0.035, 0.6 * s * k, 0.24) - st, bp, graph.pink);
        bubble(v, st + 0.1, rand(600, 1000), 0.04 * s * k, 0.05, v.out);
      }
    },
    bite(v, t, s) {                     // bobber dips: small plip + one bubble
      const g = gain(v, v.out);
      const o = osc(v, 'sine', 900, t, env(g, t, 0.002, 0.25 * s, 0.05) - t, g);
      o.frequency.exponentialRampToValueAtTime(350, t + 0.04);
      bubble(v, t + 0.06, rand(1200, 1500), 0.08 * s, 0.06, v.out);
    },
    return(v, t, s) {                   // hook lands back on the deck: wood thunk + metal tink
      knock(v, t, s * 0.8, rand(190, 210));
      modes(v, t + 0.004, v.out, [[rand(2900, 3200), 0.07 * s, 0.12], [rand(4700, 5100), 0.03 * s, 0.06]]);
    },
    creak(v, t, s) {                    // one-shot plank creak (e.g. stepping onto a loose log)
      const dur = rand(0.25, 0.55) * (0.6 + s * 0.6);
      const g = gain(v, v.out);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.35 * s, t + 0.04);
      g.gain.setValueAtTime(0.35 * s, t + dur - 0.08);
      g.gain.linearRampToValueAtTime(0, t + dur);
      const f0 = 18 + s * 40;
      const split = track(v, ctx.createGain());
      const o = osc(v, 'sawtooth', f0, t, dur, split);
      o.frequency.linearRampToValueAtTime(f0 * rand(1.4, 2.2), t + dur * 0.6);
      o.frequency.linearRampToValueAtTime(f0 * rand(0.8, 1.1), t + dur);
      for (const [f, q, a] of [[260, 4, 1], [580, 5, 0.6], [1150, 6, 0.3]]) {
        const ag = track(v, ctx.createGain()); ag.gain.value = a; ag.connect(g);
        split.connect(filter(v, 'bandpass', f * rand(0.9, 1.1), q, ag));
      }
    },
    gull(v, t, s) {
      const n = 2 + Math.floor(Math.random() * 3), f0 = rand(1050, 1350);
      let tt = t;
      for (let i = 0; i < n; i++) {
        const len = i === 0 ? rand(0.32, 0.42) : rand(0.18, 0.26);
        gullCall(v, tt, s * (i === 0 ? 1 : rand(0.6, 0.85)), f0 * (i === 0 ? 1 : rand(1.02, 1.12)), len);
        tt += len + rand(0.06, 0.12);
      }
    },
    ui(v, t, s) {
      click(v, t, 0.12 * s, 3000, v.out, 0.01);
      const g = gain(v, v.out);
      osc(v, 'sine', 1250, t, env(g, t, 0.002, 0.08 * s, 0.04) - t, g);
    },
    hover(v, t, s) {
      const g = gain(v, v.out);
      osc(v, 'sine', 1800, t, env(g, t, 0.002, 0.03 * s, 0.025) - t, g);
    },
    error(v, t, s) {                    // soft descending bonk, never harsh
      const lp = filter(v, 'lowpass', 1800, 0.5, v.out);
      [[0, 330], [0.11, 247]].forEach(([dt, f]) => {
        const g = gain(v, lp);
        osc(v, 'triangle', f, t + dt, env(g, t + dt, 0.004, 0.22 * s, 0.16) - t - dt, g);
      });
    },
  };

  // ---- continuous reel --------------------------------------------------------
  function setReel(on, speed = 0.5, pos = null) {
    try {
      if (!graph || !ctx || destroyed) return false;
      const t = ctx.currentTime, sp = clamp01(speed, 0.5);
      if (on && !reel) {
        const nodes = [];
        const mk = (n) => { nodes.push(n); nodeCount++; return n; };
        const out = mk(ctx.createGain()); out.gain.setValueAtTime(0, t);
        let dest = graph.sfxBus;
        if (pos && Number.isFinite(pos.x)) { const fake = { nodes, sources: [] }; dest = panner(fake, pos, dest); }
        out.connect(dest);
        // ratchet: band-limited square edges -> high-pass -> resonant band = clicky pawl
        const sq = mk(ctx.createOscillator()); sq.type = 'square'; sq.frequency.value = 7 + sp * 18;
        const hp = mk(ctx.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 2500; hp.Q.value = 0.7;
        const bp = mk(ctx.createBiquadFilter()); bp.type = 'bandpass'; bp.frequency.value = 3300; bp.Q.value = 3;
        const cg = mk(ctx.createGain()); cg.gain.value = 1.4;
        sq.connect(hp); hp.connect(bp); bp.connect(cg); cg.connect(out);
        // line hiss through the guides
        const ns = mk(ctx.createBufferSource()); ns.buffer = graph.pink; ns.loop = true;
        const nb = mk(ctx.createBiquadFilter()); nb.type = 'bandpass'; nb.frequency.value = 2000; nb.Q.value = 1.2;
        const ng = mk(ctx.createGain()); ng.gain.value = 0.08;
        ns.connect(nb); nb.connect(ng); ng.connect(out);
        sq.start(t); ns.start(t, Math.random() * 2);
        reel = { out, sq, ns, ng, nodes };
      }
      if (!reel) return false;
      if (on) {
        reel.sq.frequency.setTargetAtTime(7 + sp * 18, t, 0.05);
        reel.ng.gain.setTargetAtTime(0.03 + 0.1 * sp, t, 0.05);
        reel.out.gain.setTargetAtTime(0.5, t, 0.03);
        const p = reel.nodes.find((n) => n.positionX);
        if (p && pos && Number.isFinite(pos.x)) { p.positionX.setTargetAtTime(pos.x, t, 0.03); p.positionZ.setTargetAtTime(pos.z, t, 0.03); }
      } else {
        const r = reel; reel = null;
        r.out.gain.setTargetAtTime(0, t, 0.03);
        r.sq.onended = () => { for (const n of r.nodes) { try { n.disconnect(); } catch (_) {} } };
        r.sq.stop(t + 0.2); r.ns.stop(t + 0.2);
      }
      return true;
    } catch (_) { return false; }
  }

  // ---- public API ---------------------------------------------------------------
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
      wantRun = true;
      if (isOffline()) { await startAmbience(); return !destroyed; }
      const r = ctx.state === 'suspended' && typeof ctx.resume === 'function' ? ctx.resume() : null;
      startAmbience();                                 // module load overlaps the resume
      scheduleGulls();
      if (r) await r;
      if (destroyed) return false;
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

  function setOcean(p = {}) {
    for (const k of ['swell', 'wind', 'speed', 'creak']) if (p[k] != null) ocean[k] = clamp01(p[k], ocean[k]);
    applyOcean(1);
    return { ...ocean };
  }

  function setBus(name, v) {
    if (!graph) return false;
    const n = { ambience: graph.ambBus, sfx: graph.sfxBus, ui: graph.uiBus }[name];
    if (!n) return false;
    try { n.gain.setTargetAtTime(clamp01(v, 1), ctx.currentTime, 0.05); return true; } catch (_) { return false; }
  }

  function duck(amount = 0.4, hold = 0.25, at = null) {
    if (!graph) return;
    const t = Math.max(ctx.currentTime, at ?? 0), p = graph.ambDuck.gain;
    try {
      p.cancelScheduledValues(t);
      p.setTargetAtTime(1 - clamp01(amount, 0.4), t, 0.02);
      p.setTargetAtTime(1, t + hold, 0.25);
    } catch (_) {}
  }

  function play(event, strength = 1, opts = null) {
    try {
      if (destroyed || !graph || !ctx || vol <= 0) return false;
      if (ctx.state === 'closed' || (ctx.state !== 'running' && !wantRun)) return false;
      const recipe = Object.prototype.hasOwnProperty.call(recipes, event) ? recipes[event] : null;
      if (!recipe) return false;
      const s = clamp01(strength, 1);
      if (s <= 0.001 || voices.size >= MAX_VOICES) return false;
      const now = Math.max(ctx.currentTime, Number.isFinite(opts?.at) ? opts.at : 0);
      if (now - (lastPlay[event] ?? -1) < MIN_GAP[event]) return false;
      lastPlay[event] = now;
      const v = newVoice(UI_EVENTS.has(event) ? graph.uiBus : graph.sfxBus);
      if (opts && Number.isFinite(opts.x) && Number.isFinite(opts.z)) {
        // re-route: voice bus -> panner -> sfx bus
        v.bus.disconnect();
        v.bus.connect(panner(v, opts, graph.sfxBus, REF_DISTANCE[event] ?? 2));
      }
      voices.add(v);
      try { recipe(v, now + 0.005, s); }
      catch (_) { killVoice(v); return false; }
      if (v.live === 0) finishVoice(v);
      if (DUCK[event]) duck(DUCK[event] * s, 0.2, now);
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
    if (reel) { const r = reel; reel = null; try { r.sq.stop(); r.ns.stop(); } catch (_) {} for (const n of r.nodes) { try { n.disconnect(); } catch (_) {} } }
    if (gullClock) { gullClock.onended = null; try { gullClock.stop(); } catch (_) {} gullClock = null; }
    stopAmbience();
    if (graph) {
      for (const k of ['ambBus', 'ambDuck', 'sfxBus', 'uiBus', 'mix', 'tone', 'master', 'limiter']) { try { graph[k].disconnect(); } catch (_) {} }
      graph = null;
    }
    // The AudioContext (supplied or lazily created) is intentionally left open so a
    // hot-updated module can reuse it via `instance.context`.
  }

  function stats() {
    return { voices: voices.size, worklet: amb?.kind === 'worklet', ambience: amb?.kind ?? null, nodes: nodeCount, state: ctx?.state ?? null, reel: !!reel };
  }

  return {
    get context() { return ctx; },
    resume, setVolume, play, destroy,
    setListener, setOcean, setReel, setBus, duck, stats,
  };
}

export default createOceanAudio;
