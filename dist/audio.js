// audio.js - original procedural sound for Little Raft (Web Audio only, no files).
// Usage:
//   const audio = createOceanAudio({ context: previous?.context ?? null, volume: 0.5 });
//   addEventListener('pointerdown', () => audio.resume());   // user gesture
//   audio.play('build', 1);  audio.tick(dt, {swimming});   // tick once per frame
//
// API: createOceanAudio({context=null, volume=.5, ambience=true, music=false}={}) ->
//   context          getter, latest AudioContext (null until resume() creates one)
//   resume()         creates (lazily) / resumes the context, starts ambience; Promise<boolean>
//   setVolume(v)     master volume 0..1 (same as setBus('master', v)); returns the clamped value
//   setBus(n, v)     n in BUSES: master | effects | ambience | music; getBus(n) reads it back
//   setMusic(on)     toggles the calm music bed (fades); music getter reports it
//   play(ev, s=1)    ev in EVENTS (or ALIASES, e.g. 'pickup'); s clamped 0..1; true if scheduled (never throws). Repeat calls
//                    inside MIN_GAP are dropped, so 'reel' can be called every frame while reeling.
//   note(i, step, s=1) [instruments] i in drum|pipes|bells, step integer 0..7 (D4..F#5); true if scheduled (never
//                    throws). 50 ms gap per instrument; at most 10 live instrument voices inside MAX_VOICES.
//   tick(dt, st)     drives ambient one-shots (lapping, plank creaks) and music chord changes;
//                    st.swimming muffles the wind and drops creaks. Allocation-free when idle.
//   destroy()        stops + disconnects only this instance's nodes; never closes the context
//
// Notes: no DOM timers. Voices clean themselves up on the sources' 'ended' event.

export const EVENTS = Object.freeze(['throw', 'splash', 'collect', 'build', 'place', 'craft', 'repair', 'plant', 'water', 'jump',
  'land', 'step', 'swim', 'reel', 'catch', 'bite', 'ui', 'open', 'close', 'deny', 'detect', 'chime']);
// friendlier names other modules may use; play() resolves them to a recipe above
export const ALIASES = Object.freeze({ pickup: 'collect', cast: 'throw', hook: 'throw', pour: 'water', click: 'ui' });
export const BUSES = Object.freeze(['master', 'effects', 'ambience', 'music']);

const OUTPUT_SCALE = 0.5;       // keeps full volume comfortable
const MAX_VOICES = 24;
const MIN_GAP = { throw: 0.08, splash: 0.06, collect: 0.04, build: 0.05, place: 0.06, plant: 0.12, water: 0.25, craft: 0.1, repair: 0.12, jump: 0.1, land: 0.12,
  step: 0.16, swim: 0.3, reel: 0.4, catch: 0.06, bite: 0.2, ui: 0.03, open: 0.08, close: 0.08, deny: 0.15,
  detect: 0.05, chime: 0.5 };
const SILENT = 0.0001;
// calm D-major-ish pad: Dadd9, Bm7, Gmaj7, A6 (low register so it sits under the sea)
const CHORDS = [[146.83, 220, 329.63], [123.47, 185, 293.66], [98, 196, 246.94], [110, 164.81, 277.18]];
const SCALE = [587.33, 659.25, 739.99, 880, 987.77, 1174.66]; // D pentatonic for soft plucks
const NOTE_HZ = Object.freeze([293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25, 739.99]); // [instruments] same as SCALE_HZ in instruments.js

const clamp01 = (v, d = 0) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const rand = (a, b) => a + Math.random() * (b - a);

export function createOceanAudio({ context = null, volume = 0.5, ambience = true, music = false, output = null } = {}) {
  let ctx = context && typeof context.createGain === 'function' ? context : null;
  const level = { master: clamp01(volume, 0.5), effects: 1, ambience: 1, music: 0.7 };
  let musicOn = !!music;
  let destroyed = false;
  let graph = null;          // { master, limiter, tone, fx, amb, mus, noise, brown }
  let amb = null;            // { nodes, sources, wind }
  let bed = null;            // music pad { nodes, sources, oscs, gain }
  let lapIn = 1.5, creakIn = 7, chordIn = 0, pluckIn = 3, chord = 0, stepSide = 1, swimming = false;
  const voices = new Set();
  const lastPlay = Object.create(null);

  function getCtor() {
    if (typeof globalThis === 'undefined') return null;
    return globalThis.AudioContext || globalThis.webkitAudioContext || null;
  }

  // Built on the first gesture, before the JIT has warmed up, so each buffer is one short pass with few operations
  // per sample (cold-loop double math boxes every intermediate: the old 6 s, three-pass brown loop made MBs of garbage).
  // Brown: leaky-integrated white noise (leak .998, ~10 ms memory, so it is stationary and needs no drift removal),
  // scaled by a fixed gain that gives the old peak-normalised loudness (RMS ~.24). The integrator runs on for FADE
  // samples past the end and that continuation is equal-power crossfaded into the head: d[0] is then the natural
  // successor of d[len - 1], so the loop seam is click-free.
  const BROWN_GAIN = 1.32, LEAK = 0.998, KICK = 0.04 * LEAK * BROWN_GAIN, FADE_S = 0.05; // x = G*y, y' = (y + .02*(2r-1)) * LEAK
  function makeNoise(seconds, brown) {
    const rate = ctx.sampleRate, len = Math.max(1, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    if (!brown) {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }
    let x = 0;
    for (let i = 0; i < len; i++) { x = x * LEAK + (Math.random() - 0.5) * KICK; d[i] = x; }
    const fade = Math.min(len >> 1, Math.floor(rate * FADE_S)), step = Math.PI / 2 / Math.max(1, fade);
    for (let i = 0; i < fade; i++) {
      x = x * LEAK + (Math.random() - 0.5) * KICK;
      d[i] = d[i] * Math.sin(i * step) + x * Math.cos(i * step);
    }
    return buf;
  }

  function busGain(name) { return name === 'master' ? level.master * OUTPUT_SCALE : name === 'music' ? level.music * 0.6 : level[name]; }
  function buildGraph() {
    if (graph || !ctx) return !!graph;
    try {
      const master = ctx.createGain();
      master.gain.value = busGain('master');
      const tone = ctx.createBiquadFilter();       // gentle top cut: muted, tactile palette
      tone.type = 'lowpass'; tone.frequency.value = 6500; tone.Q.value = 0.5;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -14; limiter.knee.value = 8; limiter.ratio.value = 6;
      limiter.attack.value = 0.004; limiter.release.value = 0.2;
      tone.connect(master); master.connect(limiter);
      let out = null; try { out = typeof output === 'function' ? output(ctx) : null; } catch { out = null; } // e.g. diving's underwater low-pass
      limiter.connect(out || ctx.destination);
      const fx = ctx.createGain(), am = ctx.createGain(), mu = ctx.createGain();
      fx.gain.value = busGain('effects'); am.gain.value = busGain('ambience'); mu.gain.value = busGain('music');
      fx.connect(tone); am.connect(tone); mu.connect(tone);
      graph = { master, tone, limiter, effects: fx, ambience: am, music: mu, noise: makeNoise(1.5, false), brown: makeNoise(2, true) };
      return true;
    } catch (_) { graph = null; return false; }
  }

  // ---- ambience: surf bed + wind, both looping noise with slow LFOs ---------
  function startAmbience() {
    if (!ambience || amb || !graph || destroyed) return;
    try {
      const t = ctx.currentTime, nodes = [], sources = [];
      const node = (n) => { nodes.push(n); return n; };
      const lfo = (f, depth, target) => {
        const o = node(ctx.createOscillator()); o.frequency.value = f;
        const g = node(ctx.createGain()); g.gain.value = depth;
        o.connect(g); g.connect(target); sources.push(o); return o;
      };
      // surf: brown noise, low-passed, breathing with two slow swells
      const surf = node(ctx.createBufferSource()); surf.buffer = graph.brown; surf.loop = true; sources.push(surf);
      const hp = node(ctx.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 60;
      const lp = node(ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 460; lp.Q.value = 0.3;
      const swell = node(ctx.createGain());
      swell.gain.setValueAtTime(0, t); swell.gain.linearRampToValueAtTime(0.022, t + 3);   // fade in, no pop
      lfo(0.071, 0.007, swell.gain); lfo(0.127, 0.005, swell.gain); lfo(0.071, 140, lp.frequency);
      surf.connect(hp); hp.connect(lp); lp.connect(swell); swell.connect(graph.ambience);
      // wind: white noise through a wandering band, gusting slowly
      const wn = node(ctx.createBufferSource()); wn.buffer = graph.noise; wn.loop = true; sources.push(wn);
      const band = node(ctx.createBiquadFilter()); band.type = 'bandpass'; band.frequency.value = 720; band.Q.value = 0.8;
      const wind = node(ctx.createGain());
      wind.gain.setValueAtTime(0, t); wind.gain.linearRampToValueAtTime(0.007, t + 5);
      lfo(0.043, 0.004, wind.gain); lfo(0.031, 260, band.frequency); lfo(0.19, 60, band.frequency);
      wn.connect(band); band.connect(wind); wind.connect(graph.ambience);
      for (const s of sources) s.start(t, s.buffer ? Math.random() * s.buffer.duration * 0.8 : 0);
      amb = { nodes, sources, wind, lp };
    } catch (_) { amb = null; }
  }
  function stopNodes(set) {
    if (!set) return;
    for (const s of set.sources) { try { s.stop(); } catch (_) {} }
    for (const n of set.nodes) { try { n.disconnect(); } catch (_) {} }
  }

  // ---- music bed: three detuned pad voices + rare soft plucks ---------------
  function startMusic() {
    if (bed || !graph || destroyed) return;
    try {
      const t = ctx.currentTime, nodes = [], sources = [], oscs = [];
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
      const g = ctx.createGain(); g.gain.setValueAtTime(SILENT, t); g.gain.exponentialRampToValueAtTime(0.05, t + 4);
      lp.connect(g); g.connect(graph.music); nodes.push(lp, g);
      for (const f of CHORDS[chord]) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = rand(-6, 6);
        const vg = ctx.createGain(); vg.gain.value = 0.33;
        o.connect(vg); vg.connect(lp); nodes.push(o, vg); sources.push(o); oscs.push(o); o.start(t);
      }
      bed = { nodes, sources, oscs, gain: g };
    } catch (_) { bed = null; }
  }
  function stopMusic(fade) {
    if (!bed) return;
    const b = bed; bed = null;
    if (fade && ctx) {
      try {
        const t = ctx.currentTime;
        b.gain.gain.cancelScheduledValues(t); b.gain.gain.setTargetAtTime(SILENT, t, 0.6);
        for (const s of b.sources) s.stop(t + 3);
        b.sources[0].onended = () => { for (const n of b.nodes) { try { n.disconnect(); } catch (_) {} } };
        return;
      } catch (_) {}
    }
    stopNodes(b);
  }

  // ---- voice helpers -------------------------------------------------------
  function newVoice(dest) {
    const bus = ctx.createGain();
    bus.connect(dest);
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
    const room = graph.noise.duration - dur - 0.05;
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
  function burst(v, t, type, freq, q, peak, attack, decay, dest = v.bus) {
    const g = gain(v, dest);
    const f = filter(v, type, freq, q, g);
    noise(v, t, env(g, t, attack, peak, decay) - t, f);
    return f;
  }
  function tone(v, t, type, freq, peak, attack, decay, toFreq, dest = v.bus) {
    const g = gain(v, dest);
    const o = osc(v, type, freq, t, env(g, t, attack, peak, decay) - t, g);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + attack + decay * 0.8);
    return o;
  }

  // ---- sound recipes -------------------------------------------------------
  // muted plank knock: resonant noise tick + short falling body tone
  function knock(v, t, s, f) {
    burst(v, t, 'bandpass', f * 2.3, 3.5, 0.55 * s, 0.001, 0.055);
    tone(v, t, 'sine', f, 0.38 * s, 0.002, 0.11, f * 0.68);
  }
  // hammer on a nail: knock plus a short bright metallic ping
  function nailHit(v, t, s, f) {
    knock(v, t, s, f);
    tone(v, t, 'triangle', rand(2300, 2600), 0.05 * s, 0.001, 0.07);
  }
  function water(v, t, s, dur, from, to) {
    const f = burst(v, t, 'lowpass', from, 0.8, 0.45 * s, 0.006, dur);
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
  }
  function drops(v, t, s, n) {
    for (let i = 0; i < n; i++) {
      const dt = t + rand(0.04, 0.26), f = rand(800, 1500);
      tone(v, dt, 'sine', f, 0.05 * s, 0.002, 0.05, f * 1.7);
    }
  }

  const recipes = {
    place(v, t, s) {
      // decoration set down on the deck: one soft wooden knock with a little scrape
      knock(v, t, s * 0.8, rand(140, 165));
      burst(v, t + 0.02, 'bandpass', 1300, 1, 0.06 * s, 0.01, 0.1);
    },
    plant(v, t, s) {
      // seed pressed into soil: two muffled dirt pats + a short leafy rustle
      for (let i = 0; i < 2; i++) {
        burst(v, t + i * 0.11, 'lowpass', rand(380, 460), 0.9, 0.3 * s * (i ? 0.7 : 1), 0.003, 0.08);
        tone(v, t + i * 0.11, 'sine', rand(80, 95), 0.16 * s, 0.003, 0.07, 60);
      }
      const f = burst(v, t + 0.22, 'bandpass', 2600, 1.2, 0.07 * s, 0.03, 0.16);
      f.frequency.linearRampToValueAtTime(1600, t + 0.4);
    },
    water(v, t, s) {
      // watering a seedling: a trickle of noise with a wobbling band + droplets soaking in
      const g = gain(v, v.bus);
      const bp = filter(v, 'bandpass', 1500, 2.4, g);
      const depth = track(v, ctx.createGain()); depth.gain.value = 450; depth.connect(bp.frequency);
      osc(v, 'sine', rand(9, 13), t, 0.75, depth);
      g.gain.setValueAtTime(SILENT, t);
      g.gain.linearRampToValueAtTime(0.2 * s, t + 0.08);
      g.gain.setValueAtTime(0.2 * s, t + 0.5);
      g.gain.exponentialRampToValueAtTime(SILENT, t + 0.75);
      noise(v, t, 0.75, bp);
      drops(v, t + 0.15, s * 0.8, 3);
    },
    build(v, t, s) {
      // Raft-style placement: three quick hammer knocks, then the plank settles
      const lp = filter(v, 'lowpass', 2800, 0.7, v.bus); v.bus = lp;
      const f = rand(150, 175);
      nailHit(v, t, s, f);
      nailHit(v, t + 0.14, s * 0.85, f * 1.04);
      nailHit(v, t + 0.27, s * 0.95, f * 0.96);
      knock(v, t + 0.36, s * 0.6, f * 0.62);
    },
    craft(v, t, s) {
      // rustle of materials + two light taps
      const f = burst(v, t, 'bandpass', 1800, 0.9, 0.16 * s, 0.03, 0.22);
      f.frequency.linearRampToValueAtTime(900, t + 0.24);
      knock(v, t + 0.2, s * 0.55, rand(200, 230));
      knock(v, t + 0.32, s * 0.45, rand(240, 270));
    },
    throw(v, t, s) {
      // rope swish: band of noise sweeping up then settling, plus the line hissing out
      const g = gain(v, v.bus);
      const bp = filter(v, 'bandpass', 500, 2.2, g);
      const dur = 0.3 + 0.12 * s;
      bp.frequency.setValueAtTime(rand(380, 480), t);
      bp.frequency.exponentialRampToValueAtTime(rand(1900, 2500), t + dur * 0.55);
      bp.frequency.exponentialRampToValueAtTime(1000, t + dur);
      g.gain.setValueAtTime(SILENT, t);
      g.gain.linearRampToValueAtTime(0.25 + 0.2 * s, t + dur * 0.4);
      g.gain.exponentialRampToValueAtTime(SILENT, t + dur);
      noise(v, t, dur, bp);
      burst(v, t + dur * 0.5, 'highpass', 4200, 0.6, 0.05 * s, 0.05, 0.35 + 0.3 * s);
    },
    splash(v, t, s) {
      // bright noise burst closing down, plus a few droplets
      water(v, t, s, 0.4, rand(3200, 4000), 460);
      drops(v, t, s, 2 + Math.floor(Math.random() * 2));
    },
    bite(v, t, s) {
      // bobber plop: hollow falling tone + small splash
      tone(v, t, 'sine', rand(520, 600), 0.18 * s, 0.002, 0.09, 180);
      water(v, t + 0.02, s * 0.5, 0.22, 2400, 500);
    },
    swim(v, t, s) {
      // paddle stroke: wet swirl falling in pitch, faint second wash
      for (let i = 0; i < 2; i++) {
        const st = t + i * rand(0.1, 0.14), k = i ? 0.5 : 1;
        const f = burst(v, st, 'bandpass', 1400, 1.1, 0.24 * s * k, 0.035, 0.24);
        f.frequency.setValueAtTime(rand(1200, 1600) * (i ? 0.8 : 1), st);
        f.frequency.exponentialRampToValueAtTime(rand(420, 560), st + 0.26);
      }
    },
    step(v, t, s) {
      // bare foot on a plank: soft low thud, a little grit, alternating feet
      stepSide = -stepSide;
      const f = rand(95, 115) * (stepSide > 0 ? 1 : 0.92);
      tone(v, t, 'sine', f, 0.22 * s, 0.003, 0.07, f * 0.7);
      burst(v, t, 'bandpass', rand(700, 900), 1.4, 0.1 * s, 0.002, 0.045);
      if (Math.random() < 0.12) recipes.creak(v, t + 0.03, s * 0.35);
    },
    land(v, t, s) {
      tone(v, t, 'sine', 90, 0.4 * s, 0.003, 0.14, 50);
      burst(v, t, 'lowpass', 500, 0.7, 0.3 * s, 0.002, 0.1);
      knock(v, t + 0.01, s * 0.4, 130);
    },
    jump(v, t, s) {
      tone(v, t, 'sine', 120, 0.28 * s, 0.004, 0.14, 60);
      burst(v, t, 'lowpass', 320, 0.7, 0.18 * s, 0.002, 0.08);
    },
    reel(v, t, s) {
      // ratchet click: tight resonant tick with a tiny tonal edge
      burst(v, t, 'bandpass', rand(2900, 3400), 6, 0.6 * s, 0.0008, 0.02);
      tone(v, t, 'square', rand(1500, 1650), 0.04 * s, 0.0008, 0.014);
    },
    catch(v, t, s) {
      // hook bites into debris: wet wooden thunk + slap
      knock(v, t, s * 0.8, rand(200, 240));
      water(v, t, s * 0.55, 0.16, 1800, 400);
    },
    collect(v, t, s) {
      // pickup pop for the bottom-left feed: bubble pop + two soft rising notes
      tone(v, t, 'sine', 380, 0.16 * s, 0.002, 0.06, 980);
      const lp = filter(v, 'lowpass', 3200, 0.5, v.bus);
      const base = rand(840, 880);
      tone(v, t + 0.04, 'triangle', base, 0.1 * s, 0.004, 0.12, 0, lp);
      tone(v, t + 0.1, 'triangle', base * 1.5, 0.09 * s, 0.004, 0.16, 0, lp);
    },
    // Seashell Finder tick (pitch and level rise with closeness s) and the soft lock-on chime (treasure.js)
    detect(v, t, s) { const f = 700 + 500 * s; tone(v, t, 'sine', f, 0.05 + 0.04 * s, 0.002, 0.05); tone(v, t, 'triangle', f * 2, 0.015 * s, 0.001, 0.03); },
    chime(v, t, s) { tone(v, t, 'sine', 880, 0.09 * s, 0.002, 0.4); tone(v, t + 0.07, 'sine', 1318.5, 0.06 * s, 0.002, 0.35); tone(v, t + 0.14, 'sine', 1760, 0.04 * s, 0.002, 0.3); },
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
    ui(v, t, s) {
      burst(v, t, 'highpass', 3000, 0.7, 0.16 * s, 0.001, 0.012);
      tone(v, t, 'sine', 1250, 0.05 * s, 0.002, 0.04);
    },
    open(v, t, s) {
      // canvas bag opening: short rising rustle + soft click
      const f = burst(v, t, 'bandpass', 700, 1.2, 0.14 * s, 0.04, 0.12);
      f.frequency.exponentialRampToValueAtTime(2200, t + 0.15);
      tone(v, t + 0.1, 'sine', 900, 0.04 * s, 0.002, 0.05, 1300);
    },
    close(v, t, s) {
      const f = burst(v, t, 'bandpass', 2000, 1.2, 0.12 * s, 0.02, 0.12);
      f.frequency.exponentialRampToValueAtTime(650, t + 0.14);
      knock(v, t + 0.09, s * 0.25, 220);
    },
    deny(v, t, s) {
      tone(v, t, 'triangle', 330, 0.07 * s, 0.003, 0.08, 300);
      tone(v, t + 0.09, 'triangle', 247, 0.07 * s, 0.003, 0.12, 220);
    },
    // ambience one-shots (played from tick on the ambience bus)
    lap(v, t, s) {
      // wave slapping the raft's underside: slow low swish with a hollow tail
      const f = burst(v, t, 'lowpass', 300, 1.1, 0.07 * s, 0.09, 0.45);
      f.frequency.setValueAtTime(rand(250, 350), t);
      f.frequency.linearRampToValueAtTime(rand(700, 1000), t + 0.12);
      f.frequency.exponentialRampToValueAtTime(220, t + 0.55);
      if (Math.random() < 0.5) drops(v, t + 0.1, s * 0.4, 1);
    },
    creak(v, t, s) {
      // rope lashing / plank creak: buzzy pulse train dragged in pitch
      const dur = rand(0.25, 0.5);
      const g = gain(v, v.bus);
      const bp = filter(v, 'bandpass', rand(600, 900), 4, g);
      const o = osc(v, 'sawtooth', rand(55, 75), t, dur, bp);
      o.frequency.linearRampToValueAtTime(rand(85, 120), t + dur);
      g.gain.setValueAtTime(SILENT, t);
      g.gain.linearRampToValueAtTime(0.06 * s, t + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(SILENT, t + dur);
    },
    pluck(v, t, s) {
      const f = SCALE[Math.floor(Math.random() * SCALE.length)];
      const lp = filter(v, 'lowpass', 1800, 0.5, v.bus);
      tone(v, t, 'triangle', f, 0.05 * s, 0.01, 1.6, 0, lp);
      tone(v, t, 'sine', f * 2, 0.012 * s, 0.01, 0.9, 0, lp);
    },
  };
  const AMBIENT = new Set(['lap', 'creak']);
  // [instruments] note recipes (v, t, s, f): every tail is 1.5 s or less
  const lastNote = Object.create(null);
  const NOTES = Object.freeze({
    drum(v, t, s, f) {
      tone(v, t, 'sine', f / 2, 0.28 * s, 0.002, 0.55, f / 2 * 0.6);
      burst(v, t, 'lowpass', 900, 0.7, 0.35 * s, 0.001, 0.06);
    },
    pipes(v, t, s, f) {
      const o = tone(v, t, 'triangle', f, 0.22 * s, 0.04, 0.5);
      o.frequency.linearRampToValueAtTime(f * 1.008, t + 0.25);
      o.frequency.linearRampToValueAtTime(f, t + 0.5);
      tone(v, t, 'sine', f * 2, 0.05 * s, 0.05, 0.35);
      burst(v, t, 'bandpass', f * 2, 1.2, 0.08 * s, 0.03, 0.25);
    },
    bells(v, t, s, f) {
      tone(v, t, 'sine', f * 2, 0.3 * s, 0.002, 1.2);
      tone(v, t, 'sine', f * 2 * 2.76, 0.12 * s, 0.002, 0.6);
      tone(v, t, 'sine', f * 2 * 5.4, 0.06 * s, 0.002, 0.3);
    },
  });

  function voice(name, s, bus) {
    if (voices.size >= MAX_VOICES) return false;
    const v = newVoice(bus);
    voices.add(v);
    try { recipes[name](v, ctx.currentTime + 0.005, s); }
    catch (_) { killVoice(v); return false; }
    if (v.live === 0) finishVoice(v);
    return true;
  }

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
      if (musicOn) startMusic();
      return ctx.state === 'running';
    } catch (_) { return false; }
  }

  function setBus(name, v) {
    if (!Object.prototype.hasOwnProperty.call(level, name)) return null;
    level[name] = clamp01(v, level[name]);
    const node = graph && graph[name];
    if (node && ctx) {
      try { node.gain.setTargetAtTime(busGain(name), ctx.currentTime, 0.03); }
      catch (_) { try { node.gain.value = busGain(name); } catch (__) {} }
    }
    return level[name];
  }
  const getBus = (name) => (Object.prototype.hasOwnProperty.call(level, name) ? level[name] : null);
  const setVolume = (v) => setBus('master', v);

  function setMusic(on) {
    musicOn = !!on;
    if (destroyed) return musicOn;
    if (musicOn && graph && ctx?.state === 'running') startMusic();
    else if (!musicOn) stopMusic(true);
    return musicOn;
  }

  function ready() { return !destroyed && graph && ctx && ctx.state === 'running' && level.master > 0; }

  function play(event, strength = 1) {
    try {
      if (!ready()) return false;
      event = ALIASES[event] ?? event;
      if (AMBIENT.has(event) || !Object.prototype.hasOwnProperty.call(recipes, event)) return false;
      const s = clamp01(strength, 1);
      if (s <= 0.001) return false;
      const now = ctx.currentTime;
      if (now - (lastPlay[event] ?? -1) < MIN_GAP[event]) return false;
      lastPlay[event] = now;
      return voice(event, s, graph.effects);
    } catch (_) { return false; }
  }

  // [instruments] held instruments: pitched one-shots on the effects bus (see dist/instruments.js)
  function note(instr, step, strength = 1) {
    try {
      if (!ready()) return false;
      if (typeof instr !== 'string' || !Object.prototype.hasOwnProperty.call(NOTES, instr)) return false;
      if (!Number.isInteger(step) || step < 0 || step > 7) return false;
      const s = clamp01(strength, 1);
      if (s <= 0.001) return false;
      const now = ctx.currentTime;
      if (now - (lastNote[instr] ?? -1) < 0.05) return false;
      if (voices.size >= MAX_VOICES) return false;
      let inst = 0;
      for (const v of voices) if (v.inst) inst++;
      if (inst >= 10) return false;
      lastNote[instr] = now;
      const v = newVoice(graph.effects);
      v.inst = true;
      voices.add(v);
      try { NOTES[instr](v, now + 0.005, s, NOTE_HZ[step]); }
      catch (_) { killVoice(v); return false; }
      if (v.live === 0) finishVoice(v);
      return true;
    } catch (_) { return false; }
  }

  function tick(dt, st) {
    if (!(dt > 0) || !ready()) return;
    try {
      const sw = !!st?.swimming;
      if (sw !== swimming && amb) { // head at water level: less wind, darker surf
        swimming = sw;
        const t = ctx.currentTime;
        amb.wind.gain.setTargetAtTime(sw ? 0.002 : 0.007, t, 0.4);
        amb.lp.frequency.setTargetAtTime(sw ? 300 : 460, t, 0.4);
      }
      if (amb && level.ambience > 0) {
        if ((lapIn -= dt) <= 0) { lapIn = rand(1.4, 3.8); voice('lap', rand(0.5, 1), graph.ambience); }
        if ((creakIn -= dt) <= 0) { creakIn = rand(6, 15); if (!sw) voice('creak', rand(0.4, 0.9), graph.ambience); }
      }
      if (bed) {
        if ((chordIn -= dt) <= 0) {
          chordIn = 10;
          chord = (chord + 1) % CHORDS.length;
          const t = ctx.currentTime, c = CHORDS[chord];
          for (let i = 0; i < bed.oscs.length; i++) bed.oscs[i].frequency.setTargetAtTime(c[i], t, 0.8);
        }
        if ((pluckIn -= dt) <= 0) { pluckIn = rand(2.5, 6); if (level.music > 0) voice('pluck', rand(0.5, 1), graph.music); }
      }
    } catch (_) {}
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
    stopNodes(amb); amb = null;
    stopMusic(false);
    if (graph) {
      for (const n of [graph.effects, graph.ambience, graph.music, graph.tone, graph.master, graph.limiter]) { try { n.disconnect(); } catch (_) {} }
      graph = null;
    }
    // The AudioContext (supplied or lazily created) is intentionally left open so a
    // hot-updated module can reuse it via `instance.context`.
  }

  return {
    get context() { return ctx; },
    get music() { return musicOn; },
    resume,
    setVolume,
    setBus,
    getBus,
    setMusic,
    play,
    note, // [instruments]
    tick,
    destroy,
  };
}

export default createOceanAudio;
