// audio-lab.js - three procedural ambience engines with one shared interface,
// so docs/tech/audio.md can compare them on equal terms.
//
//   const eng = await ENGINES.graph(ctx, ctx.destination);   // or .worklet / .baked
//   eng.set({ wind: 0..1, speed: 0..1 });   // weather + raft drift
//   eng.step('wood' | 'water', 0..1);        // one footstep
//   eng.creak(0..1);                         // one plank/rope creak
//   eng.stop();
//
// All three produce ocean bed + wave wash + wind + footsteps + creaks.

const rnd = (a, b) => a + Math.random() * (b - a);

export function noiseBuffer(ctx, seconds, kind = 'white') {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'pink') {                       // Kellet's cheap 3-pole pink
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
    } else if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5;
    } else d[i] = w;
  }
  // crossfade tail into head so the loop point is click-free
  const xf = Math.min(2048, n >> 2);
  for (let i = 0; i < xf; i++) {
    const k = i / xf;
    d[i] = d[i] * k + d[n - xf + i] * (1 - k);
  }
  return buf;
}

// ---------------------------------------------------------------------------
// A. Native node graph: looped noise buffers + BiquadFilters + LFO/automation.
//    All DSP runs in the browser's C++ audio thread. JS only schedules events.
// ---------------------------------------------------------------------------
export async function graph(ctx, out, { ambience = true } = {}) {
  const bus = ctx.createGain(); bus.gain.value = 0.8; bus.connect(out);
  const white = noiseBuffer(ctx, 2, 'white');
  const pink = noiseBuffer(ctx, 4, 'pink');
  const brown = noiseBuffer(ctx, 6, 'brown');
  const t0 = ctx.currentTime;
  const loops = [];
  const loop = (buf, dest) => {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    s.connect(dest); s.start(t0, rnd(0, buf.duration)); loops.push(s); return s;
  };
  const biquad = (type, f, q, dest) => {
    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q;
    b.connect(dest); return b;
  };
  const lfo = (hz, depth, param) => {
    const o = ctx.createOscillator(); o.frequency.value = hz;
    const g = ctx.createGain(); g.gain.value = depth; o.connect(g); g.connect(param);
    o.start(t0); loops.push(o); return g;
  };

  if (ambience) {
  // ocean bed: brown noise, lowpass that breathes with two incommensurate swells
  const bedGain = ctx.createGain(); bedGain.gain.value = 0.35; bedGain.connect(bus);
  const bedLp = biquad('lowpass', 380, 0.4, bedGain);
  lfo(0.071, 110, bedLp.frequency); lfo(0.071, 0.12, bedGain.gain); lfo(0.127, 0.08, bedGain.gain);
  loop(brown, bedLp);

  // wave wash: pink noise through bandpass, gain envelope scheduled per wave
  var washGain = ctx.createGain(); washGain.gain.value = 0; washGain.connect(bus);
  var washBp = biquad('bandpass', 900, 0.7, washGain);
  loop(pink, washBp);

  // wind: white noise, resonant bandpass whose centre and level drift (gusts)
  var windGain = ctx.createGain(); windGain.gain.value = 0; windGain.connect(bus);
  var windBp = biquad('bandpass', 500, 6, windGain);
  const windLp = biquad('lowpass', 2500, 0.5, windBp);
  lfo(0.19, 90, windBp.frequency); lfo(0.053, 160, windBp.frequency);
  loop(white, windLp);

  }
  let wind = 0.3, speed = 0.2, nextWave = t0 + 0.5, alive = ambience;
  function setWind(t) {
    if (!ambience) return;
    windGain.gain.setTargetAtTime(0.02 + wind * 0.22, t, 0.8);
    windBp.frequency.setTargetAtTime(350 + wind * 650, t, 1.2);
    windBp.Q.setTargetAtTime(8 - wind * 5, t, 1.2);
  }
  setWind(t0);

  // JS-side scheduler: a wave every 3-7 s, sooner when the raft moves.
  // Lookahead scheduling so timer jitter never reaches the audio.
  function pump() {
    if (!alive) return;
    const offline = ctx instanceof OfflineAudioContext;   // offline: schedule the whole render
    const ahead = offline ? ctx.length / ctx.sampleRate : ctx.currentTime + 1.0;
    while (nextWave < ahead) {
      const t = nextWave, peak = rnd(0.15, 0.35) * (0.6 + speed * 0.6), rise = rnd(0.6, 1.4);
      washGain.gain.setTargetAtTime(peak, t, rise / 3);
      washGain.gain.setTargetAtTime(0.0, t + rise, rnd(0.5, 1.1));
      washBp.frequency.setTargetAtTime(rnd(1200, 1800), t, rise / 3);
      washBp.frequency.setTargetAtTime(500, t + rise, 0.8);
      nextWave += rnd(3, 7) * (1 - speed * 0.4);
    }
  }
  const timer = typeof setInterval === 'function' && !(ctx instanceof OfflineAudioContext)
    ? setInterval(pump, 250) : null;
  pump();

  // one-shot helpers: every node is garbage once its source ends
  function burst(t, dur, dest, buf = white) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.connect(dest);
    s.start(t, rnd(0, buf.duration - dur - 0.01), dur);
  }
  function envGain(t, a, peak, d, dest = bus) {
    const g = ctx.createGain(); g.connect(dest);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(0, t + a, d / 4); return g;
  }

  function step(surface = 'wood', s = 1, t = ctx.currentTime) {
    if (surface === 'water') {                    // wet slap + drip
      const g = envGain(t, 0.01, 0.5 * s, 0.25);
      const bp = biquad('bandpass', rnd(700, 1100), 1.2, g);
      bp.frequency.setTargetAtTime(350, t + 0.02, 0.08);
      burst(t, 0.3, bp, pink);
      return;
    }
    // wood: heel then toe, each = low body thump + bright contact tick
    for (const [dt, k] of [[0, 1], [rnd(0.045, 0.07), 0.55]]) {
      const tt = t + dt;
      const body = envGain(tt, 0.002, 2.2 * s * k, 0.07);
      burst(tt, 0.08, biquad('bandpass', rnd(140, 190), 3, body));
      const tick = envGain(tt, 0.001, 0.35 * s * k, 0.02);
      burst(tt, 0.03, biquad('bandpass', rnd(1800, 2600), 1.5, tick));
    }
  }

  // creak: stick-slip pulse train (sawtooth with jittered, rising rate) into
  // three wood formants (after Farnell, Designing Sound ch. "Creaking door").
  function creak(force = 0.6, t = ctx.currentTime) {
    const dur = rnd(0.25, 0.6) * (0.6 + force * 0.6);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = 18 + force * 40;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * rnd(1.4, 2.2), t + dur * 0.6);
    o.frequency.linearRampToValueAtTime(f0 * rnd(0.8, 1.1), t + dur);
    const jit = ctx.createOscillator(); jit.type = 'square'; jit.frequency.value = rnd(23, 37);
    const jg = ctx.createGain(); jg.gain.value = f0 * 0.25; jit.connect(jg); jg.connect(o.frequency);
    const g = ctx.createGain(); g.connect(bus);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12 * force, t + 0.04);
    g.gain.setValueAtTime(0.12 * force, t + dur - 0.08);
    g.gain.linearRampToValueAtTime(0, t + dur);
    for (const [f, q, a] of [[250, 2, 1], [560, 3, 0.7], [790, 3, 0.5]]) {
      const a1 = ctx.createGain(); a1.gain.value = a; a1.connect(g);
      const b = biquad('bandpass', f * rnd(0.9, 1.1), q, a1); o.connect(b);
    }
    o.start(t); jit.start(t); o.stop(t + dur + 0.02); jit.stop(t + dur + 0.02);
  }

  return {
    name: 'A. node graph',
    set(p) { if (p.wind != null) wind = p.wind; if (p.speed != null) speed = p.speed; setWind(ctx.currentTime); },
    step, creak, pump,
    stop() { alive = false; if (timer) clearInterval(timer); loops.forEach((s) => { try { s.stop(); } catch (_) {} }); bus.disconnect(); },
  };
}

// ---------------------------------------------------------------------------
// B. One AudioWorkletNode running hand-written per-sample DSP (ocean-worklet.js).
//    JS posts parameters/events; everything else happens on the audio thread.
// ---------------------------------------------------------------------------
export async function worklet(ctx, out) {
  await ctx.audioWorklet.addModule(new URL('./ocean-worklet.js', import.meta.url));
  const node = new AudioWorkletNode(ctx, 'raft-ambience', { numberOfOutputs: 1, outputChannelCount: [1] });
  node.connect(out);
  const post = (m) => node.port.postMessage(m);
  return {
    name: 'B. AudioWorklet',
    set(p) { post({ type: 'set', ...p }); },
    // events carry an absolute time so the processor can sample-accurately start them
    step(surface = 'wood', s = 1, t = ctx.currentTime) { post({ type: 'step', surface, s, t }); },
    creak(force = 0.6, t = ctx.currentTime) { post({ type: 'creak', force, t }); },
    pump() {},
    stop() { node.disconnect(); post({ type: 'stop' }); },
  };
}

// ---------------------------------------------------------------------------
// C. Bake once with OfflineAudioContext (reusing engine A), then play buffers.
//    Runtime cost is a couple of AudioBufferSourceNodes and gains.
// ---------------------------------------------------------------------------
export async function bakeBank(sampleRate = 44100) {
  // each clip is rendered by engine A in its own OfflineAudioContext
  const render = async (seconds, ambience, play) => {
    const oc = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
    const e = await graph(oc, oc.destination, { ambience });
    play(e);
    return oc.startRendering();
  };
  const bank = { wood: [], water: [], creak: [] };
  bank.calm = await render(24, true, (e) => e.set({ wind: 0.1, speed: 0.1 }));
  bank.windy = await render(24, true, (e) => e.set({ wind: 1, speed: 0.6 }));
  for (let i = 0; i < 6; i++) bank.wood.push(await render(0.3, false, (e) => e.step('wood', 1, 0)));
  for (let i = 0; i < 4; i++) bank.water.push(await render(0.5, false, (e) => e.step('water', 1, 0)));
  for (let i = 0; i < 6; i++) bank.creak.push(await render(0.9, false, (e) => e.creak(rnd(0.4, 1), 0)));
  for (const k of ['calm', 'windy']) crossfadeLoop(bank[k], 1.5);
  return bank;
}

function crossfadeLoop(buf, seconds) {
  const d = buf.getChannelData(0), n = d.length, xf = Math.floor(seconds * buf.sampleRate);
  for (let i = 0; i < xf; i++) {
    const k = i / xf;
    d[i] = d[i] * Math.sqrt(k) + d[n - xf + i] * Math.sqrt(1 - k);
  }
}

export async function baked(ctx, out, bank) {
  bank = bank || await bakeBank(ctx.sampleRate);
  const bus = ctx.createGain(); bus.connect(out);
  const t0 = ctx.currentTime;
  const layer = (buf) => {
    const g = ctx.createGain(); g.connect(bus);
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    s.loopStart = 0; s.loopEnd = buf.duration - 1.5;      // tail was folded into head
    s.connect(g); s.start(t0, rnd(0, buf.duration - 2)); return { g, s };
  };
  const calm = layer(bank.calm), windy = layer(bank.windy);
  function set(p) {
    const w = Math.min(1, Math.max(0, p.wind ?? 0.3));
    const t = ctx.currentTime;
    calm.g.gain.setTargetAtTime(Math.cos(w * Math.PI / 2), t, 1);     // equal-power blend
    windy.g.gain.setTargetAtTime(Math.sin(w * Math.PI / 2), t, 1);
  }
  set({ wind: 0.3 });
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  function shot(buf, gain, rate, t) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain; s.connect(g); g.connect(bus); s.start(t);
  }
  return {
    name: 'C. baked buffers',
    set,
    step(surface = 'wood', s = 1, t = ctx.currentTime) { shot(pick(bank[surface] || bank.wood), s, rnd(0.92, 1.08), t); },
    creak(force = 0.6, t = ctx.currentTime) { shot(pick(bank.creak), force, rnd(0.85, 1.15), t); },
    pump() {},
    stop() { calm.s.stop(); windy.s.stop(); bus.disconnect(); },
  };
}

export const ENGINES = { graph, worklet, baked };
