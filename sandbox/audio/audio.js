// audio.js - procedural sound for Little Raft (Web Audio only, no asset files).
// Drop-in replacement for the CURRENT dist/audio.js (the one game.js imports): same factory and options,
// same members, same EVENTS / ALIASES / BUSES exports (as supersets), same return values. Everything else
// is optional.
//
//   import { createOceanAudio } from './audio.js?build=...';
//   const sfx = createOceanAudio({ context: X?.audio ?? null, volume: .5, output: ctx => diving?.audioOut(ctx) ?? null });
//   addEventListener('pointerdown', () => sfx.resume());               // user gesture
//   sfx.play('build', 1);  sfx.play('splash', .55, { x, y, z });       // position optional
//   sfx.tick(dt, { swimming, sail: world.sailing, flow: sailFlow });  // once per frame
//
// dist/audio.js API (kept exactly):
//   createOceanAudio({context=null, volume=.5, ambience=true, music=false, output=null}) ->
//   context (getter) | music (getter) | resume() -> Promise<bool> | setVolume(v) -> v
//   setBus(name, v) -> clamped v | null for an unknown name; getBus(name) -> v | null   (BUSES: master effects ambience music)
//   setMusic(on) -> bool | play(ev, s=1) -> bool (ALIASES resolved, never throws) | tick(dt, st) | destroy()
//   output(ctx) -> AudioNode|null: where the limiter goes instead of ctx.destination (diving's underwater
//   low-pass). It is retried from tick() until it returns a node, so a hot-update mount that builds the
//   engine before diving exists still ends up muffled underwater.
// Added (optional):
//   play(ev, s, {x,y,z})            spatial through a PannerNode; {at} absolute ctx time (offline renders)
//   tick(dt, {swimming, underwater, sail:{raised, anchored, windStr}, flow:{x,z}})
//       swimming: less wind, darker sea. underwater: overrides the 'raft:underwater' window event that
//       diving.js dispatches; plays 'dive'/'surface' on the edges and closes the top end.
//       sail: wind level from windStr, canvas luff loop while raised, 'sail'/'anchor' on the toggles.
//       flow: raft speed through the water (m/s) -> hull wash and creaks.
//   setListener(x,y,z, fx,fy,fz)   camera position + forward, per frame
//   setOcean({swell, wind, speed, creak})   0..1 sea state, smoothed over ~1 s
//   setReel(on, speed=.5, pos?)    looping ratchet + line hiss while reeling
//   duck(amount, hold) | creak(force=.7) | stats()   (stats().nodesCreated: AudioNodes this engine created, cumulative)
//   setBus also takes the round-1 names 'sfx' and 'ui' (sub-buses under 'effects').
//   option mix: 'main' (default, dist/audio.js's in-game levels) | 'engine' (the sandbox balance); see MIX
//
// Graph: voices -> [air lp -> panner -> crossfeed] -> sfx bus ─┐
//        sfx bus -> air send -> convolver ─────────────────────┤
//        UI voices -> ui bus ───────────────────────────────────┤ (sfx + ui bus = 'effects')
//        music pad + plucks -> music bus ──────────────────────┤
//        ocean worklet (or node fallback) -> ambience bus -> duck ┴> mix -> tone -> master(volume) -> limiter -> output|destination
// One-shot cleanup, destroy()'s deferred free and the gull scheduler run off AudioScheduledSourceNode 'ended'
// (audio clock). DOM timers only back up destroy() and delay the volume-0 suspend.
// Hot update: a new engine on the same context takes over the playing ocean (see startAmbience); if that
// mount then fails, its destroy() hands the ocean straight back to the previous engine (see handBack).

// dist/audio.js's EVENTS first, in its order; then the sandbox events; then the feature events.
export const EVENTS = Object.freeze([
  'throw', 'splash', 'collect', 'build', 'place', 'craft', 'repair', 'plant', 'water', 'jump',
  'land', 'step', 'swim', 'reel', 'catch', 'bite', 'ui', 'open', 'close', 'deny',
  'hammer', 'grab', 'error', 'return', 'creak', 'gull', 'hover',
  // cooking (grill), smelter, sailing, diving
  'sizzle', 'stoke', 'clank', 'ingot', 'sail', 'anchor', 'dive', 'surface',
]);
// dist/audio.js's aliases, same targets
export const ALIASES = Object.freeze({ pickup: 'collect', cast: 'throw', hook: 'throw', pour: 'water', click: 'ui' });
export const BUSES = Object.freeze(['master', 'effects', 'ambience', 'music']);
// Shape version of the per-context shared record and of the ocean handle that a hot update takes over.
// A build only takes over / reuses a record with the same version; anything else it leaves to its owner
// and starts fresh, so a future build that changes the shape can never be handed one it misreads.
export const SHARED_VERSION = 2;

const OUTPUT_SCALE = 0.8;
// Ambience mix level. The game's ambience slider defaults to 0.7 (settings.js), and that is the level the
// hierarchy was tuned at (one-shots 6-10 dB over the sea, momentary loudness: calm sea about -30, hammer
// -25, catch -18), so the ambience bus is a plain 0..1 control whose default is 0.7.
const AMB_LEVEL = 1, AMB_DEFAULT = 0.7;
// In-game mix presets (option `mix`), trims in dB on top of the buses.
// 'main' (default): the levels of the dist/audio.js engine this replaces, so an update changes the sound
//   but not the balance players are used to. Measured in the game (same settings, same recorder: the
//   100 ms RMS peak of each of dist/audio.js's 20 events with the sea muted, and the sea bed's median):
//   every one of the 20 lands within 2 dB of main's, and the bed within 1 dB. Events main does not have
//   (stations, sailing, diving, hammer, ...) get `other`, the median shift of main's events, so they keep
//   their place among the ones they sit next to.
// 'engine': no trims, the balance the sandbox's loudness hierarchy was tuned at (sea about 24 dB louder,
//   one-shots 6-10 dB over it, the catch the loudest cue).
const MIX = {
  main: {
    ambience: -24, other: -3,
    events: { splash: -6.5, collect: -4.5, build: -3, place: -2, craft: -3, plant: -2.5, water: 2, jump: -5, land: -2,
      swim: -4, reel: -3.5, catch: -7.5, open: 3.5, deny: -4.5 },
  },
  engine: { ambience: 0, other: 0, events: {} },
};
const MAIN_EVENTS = new Set(EVENTS.slice(0, 20));
const fromDb = (d) => Math.pow(10, d / 20);
const MAX_VOICES = 24;
const SILENT = 0.0001;
const MIN_GAP = {
  throw: 0.08, splash: 0.06, collect: 0.03, build: 0.05, place: 0.06, craft: 0.1, repair: 0.12, plant: 0.12, water: 0.25,
  jump: 0.1, land: 0.12, step: 0.16, swim: 0.11, reel: 0.075, catch: 0.08, bite: 0.2, ui: 0.025, open: 0.08, close: 0.08,
  deny: 0.15, hammer: 0.06, grab: 0.03, error: 0.15, return: 0.1, creak: 0.15, gull: 0.3, hover: 0.04,
  sizzle: 0.25, stoke: 0.2, clank: 0.1, ingot: 0.1, sail: 0.3, anchor: 0.5, dive: 0.4, surface: 0.4, pluck: 0.2,
};
const UI_EVENTS = new Set(['ui', 'hover', 'error', 'deny', 'craft', 'open', 'close']);
const INTERNAL = new Set(['pluck']);           // recipes play() refuses (music bed only)
// metres at which a spatial voice is at full level (inverse model: gain = ref / d beyond it; default 2 m).
// The hook works 8-32 m out, so its cues get large refs: the catch is the reward and must stay one of the
// loudest sounds wherever the hook is (-1.2 dB at 16 m); the hook splash and bite still read as "out there".
const REF_DISTANCE = { gull: 10, creak: 3, catch: 14, splash: 8, bite: 8, sail: 4, anchor: 6, stoke: 3, clank: 3, ingot: 3, sizzle: 3 };
const DUCK = { splash: 0.35, catch: 0.4, hammer: 0.25, build: 0.25, craft: 0.2, jump: 0.15, land: 0.15, anchor: 0.3, dive: 0.5, surface: 0.3 };
// calm D-major-ish pad (dist/audio.js's music bed): Dadd9, Bm7, Gmaj7, A6; D pentatonic plucks
const CHORDS = [[146.83, 220, 329.63], [123.47, 185, 293.66], [98, 196, 246.94], [110, 164.81, 277.18]];
const SCALE = [587.33, 659.25, 739.99, 880, 987.77, 1174.66];

function mulberry32(a) {
  a |= 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp01 = (v, d = 0) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
// Keep this a plain './x.js' literal: publish_local.py stamps it with ?build=<id> like every module import,
// so a hot update loads the new processor file (registerProcessor is guarded for the re-registration).
const workletDefault = (() => {
  try { return new URL('./audio-worklet.js', import.meta.url).href; } catch (_) { return null; }
})();
// Noise buffers, the air IR and the gull wave depend only on the context, so they are built once per
// AudioContext and reused by every engine on it. The WeakMap hangs off a global registry symbol, not a
// module variable: a hot update evaluates a new copy of this module (new ?build=), and it must find the
// buffers the previous build made, so its mount() does no DSP work on the main thread.
const SHARED = (() => {
  const key = Symbol.for('little-raft.audio.shared');
  try { return (globalThis[key] ||= new WeakMap()); } catch (_) { return new WeakMap(); }
})();
// fade times (s): first start after the user gesture / ambience into a context that is already playing
// (hot update) / master fade-out on destroy() before anything is stopped or disconnected
const AMB_FADE_IN = 2.5, AMB_FADE_SWAP = 0.15, DESTROY_FADE = 0.08;

export function createOceanAudio({
  context = null, volume = 0.5, ambience = true, worklet = true, workletUrl = workletDefault,
  hrtf = false, gulls = true, reverb = true, seed = null, music = false, output = null, mix = 'main',
} = {}) {
  let ctx = context && typeof context.createGain === 'function' ? context : null;
  // seeded randomness (render cases are reproducible with a seed); Math.random otherwise
  const rnd = Number.isFinite(seed) ? mulberry32(seed) : Math.random;
  const rand = (a, b) => a + rnd() * (b - a);
  // handed a context that is already playing (hot update): the previous build's ocean is fading out
  // under us, so ours fades in quickly instead of over 2.5 s
  const handover = !!ctx && ctx.state === 'running';
  const mixName = Object.prototype.hasOwnProperty.call(MIX, mix) ? mix : 'main', MIXP = MIX[mixName];
  const ambTrim = fromDb(MIXP.ambience), otherTrim = fromDb(MIXP.other);
  const evTrim = (ev) => (Object.prototype.hasOwnProperty.call(MIXP.events, ev) ? fromDb(MIXP.events[ev]) : MAIN_EVENTS.has(ev) ? 1 : otherTrim);
  let vol = clamp01(volume, 0.5);
  // bus levels as the user sets them (0..1); 'effects' scales the sfx and ui sub-buses together
  const level = { effects: 1, ambience: AMB_DEFAULT, music: 0.7, sfx: 1, ui: 1 };
  let musicOn = !!music;
  let destroyed = false, wantRun = false;
  // this engine, as the previous owner a later build's ocean takeover records (see handBack)
  const self = { alive: true, ambBus: null, reclaim: null };
  let graph = null;          // buses + shared buffers
  let amb = null;            // { kind, node?, sources, nodes, params }
  let ambPromise = null;
  let reel = null;
  let gullClock = null;
  let nodeCount = 0;          // AudioNodes created so far (cumulative; stats().nodesCreated)
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
      const w = rnd() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) * 0.998; d[i] = last; }
      else if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
      } else d[i] = w;
    }
    // crossfade tail into head (click-free loops), then remove the mean (no DC) and normalise
    const xf = Math.min(2048, len >> 2);
    for (let i = 0; i < xf; i++) { const k = i / xf; d[i] = d[i] * k + d[len - xf + i] * (1 - k); }
    let mean = 0; for (let i = 0; i < len; i++) mean += d[i]; mean /= len;
    let peak = 0; for (let i = 0; i < len; i++) { const x = d[i] - mean; d[i] = x; if (x > peak) peak = x; else if (-x > peak) peak = -x; }
    const k = peak > 0 ? 0.95 / peak : 0;
    for (let i = 0; i < len; i++) d[i] *= k;
    return buf;
  }

  // per-context shared buffers (see SHARED); built on first use, then free for every later engine
  function shared() {
    let sh = SHARED.get(ctx);
    if (!sh || sh.v !== SHARED_VERSION) {           // none yet, or another build's shape: start our own
      // white covers the short one-shots, pink the swishes and reel hiss, brown the gull pitch wobble and
      // the fallback bed; noise() loops a buffer when a voice outlasts it (the loop seam is crossfaded)
      sh = { v: SHARED_VERSION, white: makeNoise(1, 'white'), pink: makeNoise(1.5, 'pink'), brown: makeNoise(4, 'brown'), ir: null, gullWave: undefined, ocean: null };
      SHARED.set(ctx, sh);
    }
    return sh;
  }

  function buildGraph() {
    if (graph || !ctx) return !!graph;
    try {
      const sh = shared();
      const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
      const master = g(vol * OUTPUT_SCALE);
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6; limiter.knee.value = 4; limiter.ratio.value = 12;
      limiter.attack.value = 0.002; limiter.release.value = 0.15;
      const tone = ctx.createBiquadFilter();           // gentle top cut: muted, tactile palette
      tone.type = 'lowpass'; tone.frequency.value = 9000; tone.Q.value = 0.5;
      const mix = g(1);
      const ambBus = g(busGain('ambience')), ambDuck = g(1), sfxBus = g(busGain('sfx')), uiBus = g(busGain('ui')), musBus = g(busGain('music'));
      ambBus.connect(ambDuck); ambDuck.connect(mix); sfxBus.connect(mix); uiBus.connect(mix); musBus.connect(mix);
      mix.connect(tone); tone.connect(master); master.connect(limiter);
      graph = { master, limiter, tone, mix, ambBus, ambDuck, sfxBus, uiBus, musBus, sh, white: sh.white, pink: sh.pink, brown: sh.brown, out: null };
      self.ambBus = ambBus;
      if (!routeOutput()) { limiter.connect(ctx.destination); graph.toDest = true; }
      nodeCount += 10;
      // optional stages (a minimal or very old context may lack the node types): spatial voices then go
      // straight to the sfx bus, and the sfx bus stays dry
      try { graph.spatial = buildCrossfeed(sfxBus); } catch (_) { graph.spatial = sfxBus; }
      if (reverb) { try { buildAir(sfxBus, mix); } catch (_) { graph.air = null; } }
      return true;
    } catch (_) { graph = null; return false; }
  }

  function busGain(name) {
    if (name === 'sfx') return level.effects * level.sfx;
    if (name === 'ui') return 0.8 * level.effects * level.ui;
    if (name === 'music') return level.music * 0.6;
    if (name === 'ambience') return level.ambience * ambTrim;
    return 1;
  }

  // dist/audio.js's `output` hook: send the limiter into the node it returns (diving's underwater
  // low-pass) instead of ctx.destination. Returns true once routed. Retried from tick() while it returns
  // nothing: on a hot update game.js builds this engine before the new diving module exists.
  let outRetry = 0;
  function routeOutput() {
    if (!graph || graph.out || typeof output !== 'function') return !!graph?.out;
    let n = null;
    try { n = output(ctx); } catch (_) { n = null; }
    if (!n || typeof n.connect !== 'function' || n === ctx.destination) return false;
    try {
      graph.limiter.connect(n); graph.out = n;
      if (graph.toDest) { graph.toDest = false; try { graph.limiter.disconnect(ctx.destination); } catch (_) {} }
      return true;
    } catch (_) { return false; }
  }

  // Spatial voices pass one shared crossfeed before the sfx bus. An equal-power PannerNode puts a
  // 90-degree source entirely in one ear; this feeds each ear a delayed (0.3 ms), low-passed (1.1 kHz),
  // -8 dB copy of the other, the way a head shadows sound. Far ear: silent -> about -9 dB and dull.
  // 8 nodes for the whole engine, not per voice.
  function buildCrossfeed(dest) {
    const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2), out = ctx.createGain();
    const inp = ctx.createGain();
    inp.channelCount = 2; inp.channelCountMode = 'explicit'; inp.channelInterpretation = 'speakers';
    out.gain.value = 0.85;                               // centred sources gain ~+1.5 dB at low frequency
    inp.connect(split);
    split.connect(merge, 0, 0); split.connect(merge, 1, 1);
    for (const [from, to] of [[0, 1], [1, 0]]) {
      const d = ctx.createDelay(0.01); d.delayTime.value = 0.0003;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.5;
      const k = ctx.createGain(); k.gain.value = 0.4;
      split.connect(d, from); d.connect(lp); lp.connect(k); k.connect(merge, 0, to);
      graph.xf = (graph.xf || []).concat(d, lp, k);
    }
    merge.connect(out); out.connect(dest);
    graph.xf.push(inp, split, merge, out);
    nodeCount += 10;
    return inp;
  }

  // Open-sea "air": no walls, so no room reverb, only a few early reflections (deck planks ~3-5 ms,
  // the water surface ~9-12 ms, barrels/mast/sail 17-40 ms) and a short, dark, diffuse 0.3 s tail.
  // One ConvolverNode fed by a send from the sfx bus (UI and ambience stay dry).
  function buildAir(src, dest) {
    const conv = ctx.createConvolver(); conv.normalize = false; conv.buffer = graph.sh.ir ||= airIR();
    const send = ctx.createGain(); send.gain.value = 0.16;            // about -16 dB wet
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 220; hp.Q.value = 0.6;  // keep lows dry
    src.connect(send); send.connect(hp); hp.connect(conv); conv.connect(dest);
    graph.air = [send, hp, conv];
    nodeCount += 3;
  }
  function airIR() {
    const sr = ctx.sampleRate, len = Math.floor(sr * 0.32), ir = ctx.createBuffer(2, len, sr);
    const taps = [[0.0032, 0.55, 0.35], [0.0047, 0.4, 0.6], [0.0094, 0.5, 0.45], [0.0118, 0.35, 0.5],
      [0.0171, 0.22, 0.3], [0.0236, 0.2, 0.25], [0.0312, 0.14, 0.18], [0.0395, 0.12, 0.1]];  // [s, L, R]
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr, build = Math.min(1, t / 0.012);
        const k = 0.65 - 0.5 * Math.min(1, t / 0.25);                 // one-pole coefficient: tail darkens as it decays
        lp += k * ((rnd() * 2 - 1) - lp);
        d[i] = lp * 0.12 * build * Math.exp(-6.9 * t / 0.3);          // -60 dB at 0.3 s
      }
      for (const tap of taps) { const i = Math.floor(tap[0] * sr * (c ? 1.07 : 1)); if (i < len) d[i] += tap[1 + c]; }
      const f = Math.min(len, Math.floor(sr * 0.004));                 // fade the tail end to exactly 0
      for (let i = 0; i < f; i++) d[len - 1 - i] *= i / f;
    }
    return ir;
  }

  // ---- ambience -------------------------------------------------------------
  async function startAmbience() {
    if (!ambience || amb || ambPromise || !graph || destroyed) return ambPromise;
    const canWorklet = worklet && workletUrl && ctx.audioWorklet && typeof AudioWorkletNode === 'function';
    // Hot update: live.js mounts the new build before it disposes the old one, both on this context.
    // Take over the ocean that is already playing (its node and fade gain move from the old engine's
    // ambience bus to ours in this task) instead of starting a second one: the sea never stops, never
    // doubles, and nothing depends on when a new worklet processor gets its first render quantum (on a
    // busy main thread that took ~2 s in the game, which left a hole). The old engine's destroy() then
    // leaves it alone. The processor is the same code either way: the first registerProcessor() wins.
    // The handle records who had it (`from`): if this mount then fails, destroy() gives it back (handBack).
    const prev = graph.sh.ocean;
    if (prev && prev.v === SHARED_VERSION && !prev.handedOff && !prev.core?.dead && (prev.kind !== 'worklet' || canWorklet)) {
      try {
        prev.fade.disconnect(); prev.fade.connect(graph.ambBus);
        prev.handedOff = true;
        amb = { ...prev, handedOff: false, owner: self, from: prev.owner && prev.owner.alive ? prev.owner : null };
        graph.sh.ocean = amb;
        applyOcean(0.3);
        return null;
      } catch (_) { amb = null; }
    }
    const mkNode = () => new AudioWorkletNode(ctx, 'raft-ocean', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { seed: Number.isFinite(seed) ? seed | 0 : (Math.random() * 2 ** 31) | 0 },
    });
    const attach = (node) => {
      const fade = ctx.createGain(), t = ctx.currentTime;
      fade.gain.setValueAtTime(0, t);
      fade.gain.linearRampToValueAtTime(AMB_LEVEL, t + (handover && ctx.state === 'running' ? AMB_FADE_SWAP : AMB_FADE_IN));  // no pop
      node.connect(fade); fade.connect(graph.ambBus);
      amb = { v: SHARED_VERSION, kind: 'worklet', node, fade, sources: [], nodes: [node, fade], params: node.parameters, core: { dead: false }, owner: self, from: null };
      graph.sh.ocean = amb;
      nodeCount += 2;
      applyOcean(0.01);
    };
    // No ocean to take over, but 'raft-ocean' is already registered on this context (an earlier engine
    // loaded it; the first registration wins anyway): build the node now, no module load. The constructor
    // throws if the processor is not registered yet: then load the module.
    if (canWorklet) { try { attach(mkNode()); return null; } catch (_) { amb = null; } }
    ambPromise = (async () => {
      if (canWorklet) {
        try {
          await ctx.audioWorklet.addModule(workletUrl);
          if (destroyed || !graph) return;
          attach(mkNode());
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
      const fade = mk(ctx.createGain()); fade.gain.setValueAtTime(0, t); fade.gain.linearRampToValueAtTime(AMB_LEVEL, t + (handover && ctx.state === 'running' ? AMB_FADE_SWAP : AMB_FADE_IN));
      fade.connect(graph.ambBus);
      const loop = (buf, dest) => { const s = mk(ctx.createBufferSource()); s.buffer = buf; s.loop = true; s.connect(dest); s.start(t, rnd() * buf.duration); sources.push(s); };
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
      amb = { v: SHARED_VERSION, kind: 'nodes', fade, sources, nodes, params: { bed: bedG.gain, wash: washG.gain, wind: windG.gain, windF: windBp.frequency }, core: { dead: false }, owner: self, from: null };
      graph.sh.ocean = amb;
      nodeCount += nodes.length;
      applyOcean(0.01);
    } catch (_) { amb = null; }
  }

  // The sea the worklet plays: setOcean()'s values, shaped by what tick() reports. Sailing wind (windStr
  // 0.55..1) lifts the wind to at least 0.3..0.85 and raft speed lifts the hull wash; with the head at the
  // waterline the wind drops to a third and the swell darkens; underwater there is no wind at all.
  const eff = { swell: 0.5, wind: 0.3, speed: 0.2, creak: 0.5 };
  const scene = { swimming: false, underwater: false, windStr: null, speed: null };
  function effective() {
    let wind = ocean.wind, speed = ocean.speed, swell = ocean.swell;
    if (scene.windStr != null) wind = Math.max(wind, 0.3 + 0.55 * clamp01((scene.windStr - 0.55) / 0.45, 0));
    if (scene.speed != null) speed = Math.max(speed, clamp01(scene.speed / 1.3, 0));
    if (scene.underwater) { wind = 0; swell *= 0.6; speed *= 0.5; }
    else if (scene.swimming) { wind *= 0.33; swell *= 0.85; }
    eff.swell = swell; eff.wind = wind; eff.speed = speed; eff.creak = ocean.creak;
    return eff;
  }
  function applyOcean(tc = 1) {
    if (!amb || !ctx || amb.handedOff) return;
    const t = ctx.currentTime, p = amb.params, o = effective();
    const set = (param, v) => { try { param.setTargetAtTime(v, t, tc); } catch (_) {} };
    if (amb.kind === 'worklet') {
      for (const k of ['swell', 'wind', 'speed', 'creak']) { const prm = p.get(k); if (prm) set(prm, o[k]); }
    } else {
      set(p.bed, 0.08 + 0.12 * o.swell); set(p.wash, 0.02 + 0.06 * o.swell);
      set(p.wind, 0.005 + 0.08 * o.wind * o.wind); set(p.windF, 300 + 700 * o.wind);
    }
  }

  // Failed hot update: live.js mounts the new build, which takes the ocean over inside mount(); when the
  // rest of that mount() throws, game.js disposes it and live.js keeps the old build running. So when an
  // engine is destroyed while the engine it took the ocean from is still alive, the ocean goes back to it
  // (moved onto its ambience bus in this same task, so it never stops) instead of being stopped.
  function handBack() {
    const to = amb && amb.from;
    if (!to || !to.alive || typeof to.reclaim !== 'function') return false;
    try {
      amb.fade.disconnect();
      if (!to.reclaim(amb)) throw new Error('refused');
      amb.handedOff = true; amb = null;
      return true;
    } catch (_) { try { amb.fade.connect(graph.ambBus); } catch (__) {} return false; }
  }
  // the other side: take back an ocean this engine handed over (called by the newer engine's handBack)
  self.reclaim = (h) => {
    if (destroyed || !graph || !h || h.v !== SHARED_VERSION || (amb && !amb.handedOff)) return false;
    h.fade.connect(graph.ambBus);
    amb = { ...h, handedOff: false, owner: self, from: amb?.from && amb.from.alive ? amb.from : null };
    graph.sh.ocean = amb;
    applyOcean(0.3);
    return true;
  };

  function stopAmbience() {
    if (!amb) return;
    if (amb.handedOff) { amb = null; return; }       // a newer engine on this context owns it now
    if (handBack()) return;
    amb.core.dead = true;
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
      if (rnd() < 0.4 + 0.3 * (1 - ocean.wind)) {
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
  // returns the node a voice connects into: [air low-pass] -> PannerNode -> crossfeed -> sfx bus
  function panner(v, pos, dest, ref = 2) {
    const p = track(v, ctx.createPanner());
    p.panningModel = hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1; p.maxDistance = 80;
    const y = pos.y ?? listener.y;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, y, pos.z);
    p.connect(dest);
    // air absorption (exaggerated for readability): ~10 kHz at 6 m, ~4 kHz at 30 m
    const d = Math.hypot(pos.x - listener.x, y - listener.y, pos.z - listener.z);
    if (!(d > 4)) return p;
    const lp = track(v, ctx.createBiquadFilter());
    lp.type = 'lowpass'; lp.Q.value = 0.5; lp.frequency.value = Math.max(2000, 16000 / (1 + d / 10));
    lp.connect(p);
    return lp;
  }

  // ---- voice helpers ----------------------------------------------------------
  let stepSide = 1;
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
    const room = buf.duration - dur - 0.05;
    if (room > 0) {
      const src = track(v, ctx.createBufferSource());
      src.buffer = buf; src.connect(dest);
      startSource(v, src, t, t + dur + 0.02, rnd() * room);
      return src;
    }
    // longer than the buffer: play it back to back from offset 0 (the buffer's tail is crossfaded into
    // its head, so that is a seamless loop) with plain one-shot sources, so every voice still ends by itself
    const D = buf.duration, end = t + dur + 0.02;
    let first = null;
    for (let t0 = t; t0 < end; t0 += D) {
      const src = track(v, ctx.createBufferSource());
      src.buffer = buf; src.connect(dest);
      startSource(v, src, t0, Math.min(end, t0 + D), 0);
      first ||= src;
    }
    return first;
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

  // filtered noise burst under an attack/decay envelope; returns the filter (for sweeps)
  function burst(v, t, type, freq, q, peak, attack, decay, dest = v.out, buf = graph.white) {
    const g = gain(v, dest);
    const f = filter(v, type, freq, q, g);
    noise(v, t, env(g, t, attack, peak, decay) - t, f, buf);
    return f;
  }
  // enveloped oscillator, optionally gliding to toFreq over the decay; returns the oscillator
  function tone(v, t, type, freq, peak, attack, decay, toFreq = 0, dest = v.out) {
    const g = gain(v, dest);
    const o = osc(v, type, freq, t, env(g, t, attack, peak, decay) - t, g);
    if (toFreq > 0) o.frequency.exponentialRampToValueAtTime(toFreq, t + attack + decay);
    return o;
  }
  // fire / fat crackle: n short high-passed ticks spread over `span` seconds, random level
  function crackles(v, t, n, span, amp, hp, dest = v.out) {
    for (let i = 0; i < n; i++) click(v, t + rnd() * span, amp * rand(0.3, 1), hp * rand(0.8, 1.3), dest, rand(0.002, 0.006));
  }
  // struck metal: inharmonic partials (free-bar ratios) scaled to f, plus the contact tick
  function metal(v, t, s, f, ring, dest = v.out) {
    click(v, t, 0.2 * s, 3500, dest, 0.006);
    modes(v, t, dest, [[f, 0.16 * s, ring], [f * 2.27, 0.09 * s, ring * 0.7], [f * 3.76, 0.05 * s, ring * 0.45], [f * 5.4, 0.025 * s, ring * 0.3]]);
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
  // Gull: one voice = one oscillator for the whole call series (calls never overlap), so the cost is
  // ~17 nodes however many calls. Nasal source (weak fundamental, strong 2nd-4th harmonics) into two
  // formants that track the pitch a little, an irregular pitch wobble from low-passed noise (not a
  // periodic FM sine, which reads as a toy whistle), and a breathy noise layer under the same envelope.
  function gullWave() {
    const sh = graph.sh;
    if (sh.gullWave !== undefined) return sh.gullWave;
    const amp = [0, 0.3, 1, 0.85, 0.6, 0.42, 0.26, 0.16, 0.1, 0.06, 0.035, 0.02];
    const re = new Float32Array(amp.length), im = Float32Array.from(amp);
    try { sh.gullWave = ctx.createPeriodicWave(re, im); } catch (_) { sh.gullWave = null; }
    return sh.gullWave;
  }
  // series: [[start, len, f0, amp, shape], ...]; shape: 'kyow' (rise then long fall), 'ha' (short, flat-ish), 'mew' (slow fall)
  function gullSeries(v, t, series) {
    // Scheduling cost: 8 automation events per call (3 on the pitch, 5 on the envelope); it was 20 when
    // each formant and the breath had their own ramps. One ConstantSource carries the pitch contour and
    // feeds the oscillator and, scaled, both formant frequencies, so the formants track 40 % of every
    // pitch move for free. The breath layer rides the main envelope through a fixed gain.
    const end = series.reduce((m, c) => Math.max(m, c[0] + c[1]), 0) + 0.03;
    const f0 = series[0][2];
    const g = gain(v, v.out);
    const hi = filter(v, 'lowpass', 5200, 0.6, g);
    const f1g = track(v, ctx.createGain()); f1g.gain.value = 1; f1g.connect(hi);
    const f2g = track(v, ctx.createGain()); f2g.gain.value = 0.55; f2g.connect(hi);
    const F1 = filter(v, 'bandpass', 1700 * 0.6, 3, f1g), F2 = filter(v, 'bandpass', 3100 * 0.6, 4, f2g);
    const o = track(v, ctx.createOscillator());
    const wave = gullWave(); if (wave) o.setPeriodicWave(wave); else o.type = 'sawtooth';
    o.connect(F1); o.connect(F2);
    startSource(v, o, t, t + end);
    let F = o.frequency;                                              // no ConstantSource: pitch on the oscillator, fixed formants
    if (typeof ctx.createConstantSource === 'function') {
      o.frequency.value = 0;
      const pitch = track(v, ctx.createConstantSource());            // Hz, drives o + formants
      pitch.offset.value = f0;
      pitch.connect(o.frequency);
      for (const [fl, base] of [[F1, 1700], [F2, 3100]]) {            // formant = base * (0.6 + 0.4 f / 880)
        const k = track(v, ctx.createGain()); k.gain.value = base * 0.4 / 880; pitch.connect(k); k.connect(fl.frequency);
      }
      startSource(v, pitch, t, t + end);
      F = pitch.offset;
    } else { o.frequency.value = f0; F1.frequency.value = 1700; F2.frequency.value = 3100; }
    // pitch wobble: brown noise -> 18 Hz low-pass -> ~3 % of f0 into the frequency (irregular, not periodic)
    const jit = track(v, ctx.createGain()); jit.gain.value = f0 * 0.1;   // low-passed brown noise rms is ~0.3
    jit.connect(o.frequency);
    noise(v, t, end, filter(v, 'lowpass', 18, 0.7, jit), graph.brown);
    // breath: band-passed noise under the same envelope, at the same ratio to the tone as before (0.09 x call amp)
    const bg = track(v, ctx.createGain()); bg.gain.value = 0.09 * series[0][3]; bg.connect(hi);
    noise(v, t, end, filter(v, 'bandpass', 2600, 0.9, bg), graph.white);
    for (const [dt, len, fc, a, shape] of series) {
      const c = t + dt, peak = Math.max(SILENT, a);
      const rise = shape === 'kyow' ? rand(0.14, 0.24) : shape === 'ha' ? rand(0.3, 0.45) : rand(0.06, 0.12);
      const top = shape === 'mew' ? rand(1.04, 1.1) : rand(1.12, 1.25), fall = shape === 'ha' ? rand(0.85, 0.95) : rand(0.62, 0.75);
      F.setValueAtTime(fc * (shape === 'ha' ? 0.92 : rand(0.72, 0.82)), c);
      F.exponentialRampToValueAtTime(fc * top, c + len * rise);
      F.exponentialRampToValueAtTime(fc * fall, c + len);
      const p = g.gain, att = Math.min(0.03, len * 0.2);
      p.setValueAtTime(0, c);
      p.linearRampToValueAtTime(peak, c + att);
      p.linearRampToValueAtTime(peak * rand(0.8, 1), c + len * 0.45);
      p.exponentialRampToValueAtTime(SILENT, c + len);
      p.linearRampToValueAtTime(0, c + len + 0.008);
    }
  }

  const recipes = {
    build(v, t, s) {                    // a floor goes down: two nail strikes, then the plank settles
      v.out = filter(v, 'highpass', 40, 0.7, v.bus);
      hammerHit(v, t, s * 0.9);
      hammerHit(v, t + rand(0.15, 0.19), s * 0.8);
      v.out = filter(v, 'lowpass', 2400, 0.7, v.out);
      knock(v, t + rand(0.3, 0.34), s * 0.55, rand(120, 135));
    },
    place(v, t, s) {                    // set an object down on the deck: wooden knock + scuff
      v.out = filter(v, 'lowpass', 2600, 0.7, v.bus);
      knock(v, t, s * 0.8, rand(140, 165));
      burst(v, t + 0.02, 'bandpass', 1300, 1, 0.08 * s, 0.01, 0.1, v.out, graph.pink);
      knock(v, t + rand(0.07, 0.09), s * 0.3, rand(190, 210));
    },
    plant(v, t, s) {                    // two soft pats of soil + a dull thud
      v.out = filter(v, 'highpass', 40, 0.7, v.bus);
      for (let i = 0; i < 2; i++) {
        burst(v, t + i * 0.11, 'lowpass', rand(380, 460), 0.9, 0.3 * s * (i ? 0.7 : 1), 0.003, 0.08, v.out, graph.pink);
        tone(v, t + i * 0.11, 'sine', rand(80, 95), 0.16 * s, 0.003, 0.07, 60);
      }
    },
    water(v, t, s) {                    // pouring from a cup: band noise with a 9-13 Hz gurgle, then drips
      const g = gain(v, v.out);
      const bp = filter(v, 'bandpass', 1500, 1.4, g);
      const depth = track(v, ctx.createGain()); depth.gain.value = 420; depth.connect(bp.frequency);
      osc(v, 'sine', rand(9, 13), t, 0.75, depth);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22 * s, t + 0.08);
      g.gain.setValueAtTime(0.22 * s, t + 0.5);
      g.gain.exponentialRampToValueAtTime(SILENT, t + 0.75);
      g.gain.linearRampToValueAtTime(0, t + 0.76);
      noise(v, t, 0.77, bp, graph.pink);
      for (let i = 0; i < 3; i++) bubble(v, t + 0.6 + i * rand(0.06, 0.12), rand(900, 1600), 0.05 * s, 0.05, v.out);
    },
    land(v, t, s) {                     // feet hit the deck from a jump
      v.out = filter(v, 'highpass', 40, 0.7, v.bus);
      tone(v, t, 'sine', 90, 0.4 * s, 0.003, 0.14, 50);
      burst(v, t, 'lowpass', 500, 0.7, 0.3 * s, 0.002, 0.1);
      knock(v, t + 0.01, s * 0.4, 130);
    },
    step(v, t, s) {                     // footstep on logs: soft heel thud + small board tick, alternating pitch
      stepSide = -stepSide;
      const f = (stepSide > 0 ? 118 : 104) * rand(0.95, 1.05);
      tone(v, t, 'sine', f, 0.2 * s, 0.003, 0.07, f * 0.7);
      burst(v, t, 'bandpass', rand(700, 900), 1.4, 0.09 * s, 0.002, 0.045);
    },
    open(v, t, s) {                     // canvas bag opening: rising rustle + soft click
      const f = burst(v, t, 'bandpass', 700, 1.2, 0.14 * s, 0.04, 0.12, v.out, graph.pink);
      f.frequency.exponentialRampToValueAtTime(2200, t + 0.15);
      tone(v, t + 0.1, 'sine', 900, 0.04 * s, 0.002, 0.05, 1300);
    },
    close(v, t, s) {
      const f = burst(v, t, 'bandpass', 2000, 1.2, 0.12 * s, 0.02, 0.12, v.out, graph.pink);
      f.frequency.exponentialRampToValueAtTime(650, t + 0.14);
      knock(v, t + 0.09, s * 0.25, 220);
    },
    // ---- cooking / smelter -----------------------------------------------------
    sizzle(v, t, s) {                   // fish onto the hot grill: wet "tss" contact, then fat hiss + crackle
      burst(v, t, 'bandpass', 1800, 1, 0.13 * s, 0.004, 0.14, v.out, graph.pink);
      const g = gain(v, v.out);
      const hp = filter(v, 'highpass', 2600, 0.7, g);
      const bp = filter(v, 'bandpass', 5200, 0.6, hp);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.08 * s, t + 0.06);
      g.gain.setTargetAtTime(0.035 * s, t + 0.12, 0.25);
      g.gain.setTargetAtTime(SILENT, t + 0.9, 0.12);
      g.gain.setValueAtTime(0, t + 1.5);
      noise(v, t, 1.5, bp);
      crackles(v, t + 0.05, 9, 1.1, 0.1 * s, 2500);
    },
    stoke(v, t, s) {                    // fuel into the smelter: log thunk, fire whumpf, crackle
      v.out = filter(v, 'highpass', 40, 0.7, v.bus);
      knock(v, t, s * 0.6, rand(110, 125));
      const f = burst(v, t + 0.04, 'lowpass', 180, 0.8, 0.55 * s, 0.09, 0.6, v.out, graph.pink);
      f.frequency.setValueAtTime(180, t + 0.04);
      f.frequency.exponentialRampToValueAtTime(1400, t + 0.2);
      f.frequency.exponentialRampToValueAtTime(380, t + 0.7);
      tone(v, t + 0.05, 'sine', 70, 0.22 * s, 0.03, 0.3, 45);
      crackles(v, t + 0.15, 6, 0.7, 0.16 * s, 1500);
    },
    clank(v, t, s) {                    // ore into the crucible: heavy knock, iron ring, gravel rattle
      knock(v, t, s * 0.7, rand(105, 120));
      metal(v, t, s * 0.8, rand(500, 560), 0.22);
      for (let i = 0; i < 4; i++) click(v, t + 0.04 + i * rand(0.025, 0.05), 0.12 * s, rand(2000, 3500), v.out, 0.005);
    },
    ingot(v, t, s) {                    // a cast ingot taken out: bright clink, then set down
      metal(v, t, s * 0.7, rand(1700, 1820), 0.5);
      metal(v, t + rand(0.11, 0.14), s * 0.3, rand(1650, 1750), 0.3);
    },
    // ---- sailing ------------------------------------------------------------------
    sail(v, t, s) {                     // raising / lowering the sail: canvas flaps, pulley zip, rope groan
      const g = gain(v, v.out);
      const bp = filter(v, 'bandpass', 420, 0.9, g);
      bp.frequency.setValueAtTime(rand(350, 450), t);
      bp.frequency.exponentialRampToValueAtTime(900, t + 0.35);
      g.gain.setValueAtTime(0, t);
      [[0, 0.55], [rand(0.11, 0.15), 0.4], [rand(0.23, 0.28), 0.25]].forEach(([dt, a]) => {
        g.gain.linearRampToValueAtTime(a * s, t + dt + 0.015);
        g.gain.exponentialRampToValueAtTime(0.02 * s + SILENT, t + dt + 0.1);
      });
      g.gain.exponentialRampToValueAtTime(SILENT, t + 0.5);
      g.gain.linearRampToValueAtTime(0, t + 0.51);
      noise(v, t, 0.52, bp, graph.pink);
      tone(v, t, 'sine', 85, 0.2 * s, 0.005, 0.12, 60);
      const z = burst(v, t + 0.06, 'bandpass', 2600, 4, 0.07 * s, 0.05, 0.3);
      z.frequency.exponentialRampToValueAtTime(1500, t + 0.4);
      const cg = gain(v, v.out);
      const cbp = filter(v, 'bandpass', rand(650, 800), 5, cg);
      const o = osc(v, 'sawtooth', rand(60, 75), t + 0.15, env(cg, t + 0.15, 0.06, 0.05 * s, 0.25) - t - 0.15, cbp);
      o.frequency.linearRampToValueAtTime(rand(95, 120), t + 0.45);
    },
    anchor(v, t, s) {                   // anchor over the side: chain rattle running faster, then the splash
      knock(v, t, s * 0.5, rand(150, 170));
      let dt = 0.04;
      for (let i = 0; i < 6; i++) {
        const tt = t + dt;
        click(v, tt, 0.16 * s, 2200, v.out, 0.005);
        modes(v, tt, v.out, [[rand(1900, 2600), 0.05 * s, 0.05]]);
        dt += 0.08 * Math.pow(0.82, i);
      }
      recipes.splash(v, t + dt + 0.05, Math.min(1, 0.7 * s + 0.1));
    },
    // ---- diving -------------------------------------------------------------------
    dive(v, t, s) {                     // head goes under: muffled plunge, a rush of water, rising bubbles
      v.out = filter(v, 'lowpass', 1400, 0.6, filter(v, 'highpass', 40, 0.7, v.bus));
      tone(v, t, 'sine', 180, 0.3 * s, 0.003, 0.12, 70);
      const g = gain(v, v.out);
      const lp = filter(v, 'lowpass', 900, 0.7, g);
      lp.frequency.setValueAtTime(1200, t);
      lp.frequency.exponentialRampToValueAtTime(260, t + 0.9);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.55 * s, t + 0.05);
      g.gain.exponentialRampToValueAtTime(SILENT, t + 1);
      g.gain.linearRampToValueAtTime(0, t + 1.01);
      noise(v, t, 1.02, lp, graph.pink);
      for (let i = 0; i < 9; i++) bubble(v, t + 0.08 + rnd() * 0.8, rand(280, 800), rand(0.04, 0.09) * s, rand(0.04, 0.09), v.out);
    },
    surface(v, t, s) {                  // head breaks the surface: bright water shed, drips, a breath in
      const f = burst(v, t, 'lowpass', 4200, 0.7, 0.35 * s, 0.006, 0.28, v.out, graph.white);
      f.frequency.exponentialRampToValueAtTime(700, t + 0.3);
      for (let i = 0; i < 3; i++) bubble(v, t + 0.12 + i * rand(0.07, 0.13), rand(1200, 2200), 0.04 * s, 0.04, v.out);
      const b = burst(v, t + 0.18, 'bandpass', 1300, 0.8, 0.1 * s, 0.22, 0.22, v.out, graph.pink);
      b.frequency.linearRampToValueAtTime(1900, t + 0.5);
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
      const n = (big ? 6 : 3) + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) bubble(v, t + rand(0.04, dur * 0.8), rand(700, 1700), rand(0.03, 0.08) * s, rand(0.03, 0.07), v.out);
    },
    reel(v, t, s) {                     // one ratchet tick (setReel() gives the continuous version)
      click(v, t, 0.3 * s, 2800, v.out, 0.008);
      modes(v, t, v.out, [[rand(2200, 2600), 0.05 * s, 0.02]]);
    },
    catch(v, t, s) {
      // pulled out of the water: upward "shloop", drips, then a bright rising pluck arpeggio
      // (root, fifth, octave chime): the most rewarding sound in the game, so also the loudest
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
      [[0.16, 1, 0.3], [0.25, 1.5, 0.42]].forEach(([dt, r, a]) => {
        const tg = t + dt, pg = gain(v, lp);
        osc(v, 'triangle', base * r, tg, env(pg, tg, 0.003, a * s, 0.35) - tg, pg);
        const hg = gain(v, lp);
        osc(v, 'sine', base * r * 2, tg, env(hg, tg, 0.002, a * 0.25 * s, 0.12) - tg, hg);
      });
      const ct = t + 0.34, cg = gain(v, v.out);                        // octave chime with a slow shimmer
      osc(v, 'sine', base * 2, ct, env(cg, ct, 0.002, 0.2 * s, 0.6) - ct, cg);
      const sg = gain(v, v.out);
      osc(v, 'sine', base * 4.01, ct, env(sg, ct, 0.001, 0.05 * s, 0.25) - ct, sg);
    },
    grab(v, t, s) {
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
      // irregular call patterns, never the same twice: a long call ("kyow" then a falling run of "ha"s),
      // one or two plaintive "mew"s, or a couple of clipped "kek"s
      s *= 0.55;                          // a gull 10 m away must not outshout a catch (~-21 vs -17 LUFS momentary)
      const f0 = rand(780, 980), r = rnd(), series = [];
      let tt = 0;
      if (r < 0.45) {
        const l0 = rand(0.34, 0.46); series.push([0, l0, f0, 0.5 * s, 'kyow']); tt = l0 + rand(0.1, 0.22);
        const n = 3 + Math.floor(rnd() * 4); let f = f0 * rand(1.02, 1.1), a = 0.42 * s;
        for (let i = 0; i < n; i++) {
          const len = rand(0.11, 0.2) * (1 - i * 0.05);
          series.push([tt, len, f, a, 'ha']);
          tt += len + rand(0.05, 0.16) + (rnd() < 0.2 ? rand(0.1, 0.25) : 0);   // the odd hesitation
          f *= rand(0.95, 1.01); a *= rand(0.78, 0.95);
        }
      } else if (r < 0.75) {
        const n = 1 + (rnd() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) { const len = rand(0.45, 0.7); series.push([tt, len, f0 * rand(0.97, 1.08), (i ? 0.33 : 0.42) * s, 'mew']); tt += len + rand(0.25, 0.5); }
      } else {
        const n = 2 + (rnd() < 0.4 ? 1 : 0);
        for (let i = 0; i < n; i++) { const len = rand(0.08, 0.13); series.push([tt, len, f0 * rand(1.08, 1.2), 0.38 * s * (i ? rand(0.7, 0.9) : 1), 'ha']); tt += len + rand(0.06, 0.12); }
      }
      gullSeries(v, t, series);
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
        osc(v, 'triangle', f, t + dt, env(g, t + dt, 0.004, 0.12 * s, 0.16) - t - dt, g);   // UI: tell, don't scold
      });
    },
    deny(v, t, s) { recipes.error(v, t, s); },   // dist/audio.js's name for it
    pluck(v, t, s) {                    // music bed: soft pentatonic pluck
      const f = SCALE[Math.floor(rnd() * SCALE.length)];
      const lp = filter(v, 'lowpass', 1800, 0.5, v.out);
      tone(v, t, 'triangle', f, 0.05 * s, 0.01, 1.6, 0, lp);
      tone(v, t, 'sine', f * 2, 0.012 * s, 0.01, 0.9, 0, lp);
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
        if (pos && Number.isFinite(pos.x)) { const fake = { nodes, sources: [] }; dest = panner(fake, pos, graph.spatial); }
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
        sq.start(t); ns.start(t, rnd() * graph.pink.duration);
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

  // ---- music bed (dist/audio.js's): three detuned triangle pads + rare soft plucks -------
  let bed = null, chord = 0, chordIn = 0, pluckIn = 3;
  function startMusic() {
    if (bed || !graph || destroyed) return;
    try {
      const t = ctx.currentTime, nodes = [], sources = [], oscs = [];
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
      const g = ctx.createGain(); g.gain.setValueAtTime(SILENT, t); g.gain.exponentialRampToValueAtTime(0.05, t + 4);
      lp.connect(g); g.connect(graph.musBus); nodes.push(lp, g);
      for (const f of CHORDS[chord]) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = rand(-6, 6);
        const vg = ctx.createGain(); vg.gain.value = 0.33;
        o.connect(vg); vg.connect(lp); nodes.push(o, vg); sources.push(o); oscs.push(o); o.start(t);
      }
      bed = { nodes, sources, oscs, gain: g };
      nodeCount += nodes.length;
    } catch (_) { bed = null; }
  }
  function stopMusic(fade) {
    if (!bed) return;
    const b = bed; bed = null;
    const free = () => { for (const n of b.nodes) { try { n.disconnect(); } catch (_) {} } };
    if (fade && ctx) {
      try {
        const t = ctx.currentTime;
        b.gain.gain.cancelScheduledValues(t); b.gain.gain.setTargetAtTime(SILENT, t, 0.6);
        b.sources[0].onended = free;
        for (const s of b.sources) s.stop(t + 3);
        return;
      } catch (_) {}
    }
    for (const s of b.sources) { s.onended = null; try { s.stop(); } catch (_) {} }
    free();
  }

  // ---- sail luff: canvas flutter while the sail is up, louder with the wind ------------
  // pink noise -> band-pass -> gain whose level a 3-8 Hz triangle LFO shakes (the cloth flapping);
  // 6 nodes while the sail is up, none when it is down
  let luff = null;
  function setLuff(on, wind) {
    if (!graph || destroyed) return;
    try {
      const t = ctx.currentTime, w = clamp01(wind, 0.5);
      if (on && !luff) {
        const nodes = [];
        const mk = (n) => { nodes.push(n); nodeCount++; return n; };
        const out = mk(ctx.createGain()); out.gain.setValueAtTime(0, t); out.connect(graph.sfxBus);
        const am = mk(ctx.createGain()); am.gain.value = 0.6; am.connect(out);
        const bp = mk(ctx.createBiquadFilter()); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.8; bp.connect(am);
        const src = mk(ctx.createBufferSource()); src.buffer = graph.pink; src.loop = true; src.connect(bp);
        const lfo = mk(ctx.createOscillator()); lfo.type = 'triangle'; lfo.frequency.value = 4;
        const depth = mk(ctx.createGain()); depth.gain.value = 0.4; lfo.connect(depth); depth.connect(am.gain);
        src.start(t, rnd() * graph.pink.duration); lfo.start(t);
        luff = { out, bp, lfo, src, nodes, w: -1 };
      }
      if (!luff) return;
      if (on) {
        // re-target only when the wind moved (tick() calls this every frame while the sail is up)
        if (Math.abs(w - luff.w) <= 0.02) return;
        luff.w = w;
        luff.out.gain.setTargetAtTime((0.012 + 0.05 * w * w) * otherTrim, t, 0.4);
        luff.lfo.frequency.setTargetAtTime(3 + 5 * w, t, 0.5);
        luff.bp.frequency.setTargetAtTime(380 + 420 * w, t, 0.5);
      } else {
        const l = luff; luff = null;
        l.out.gain.setTargetAtTime(0, t, 0.15);
        l.lfo.onended = () => { for (const n of l.nodes) { try { n.disconnect(); } catch (_) {} } };
        l.src.stop(t + 0.8); l.lfo.stop(t + 0.8);
      }
    } catch (_) {}
  }

  // ---- underwater ---------------------------------------------------------------------
  // diving.js dispatches 'raft:underwater' {underwater} on every change (and its own low-pass on the
  // output does the muffling); tick(dt, {underwater}) overrides it. The edges play 'dive' / 'surface',
  // the sea shape changes (effective()) and the tone stage closes to ~1 kHz under water.
  let underEv = null, underWas = null;
  const onUnder = (e) => { const u = e?.detail?.underwater; if (typeof u === 'boolean') underEv = u; };
  try { globalThis.addEventListener?.('raft:underwater', onUnder); } catch (_) {}
  function setUnderwater(u) {
    if (u === underWas) return;
    const first = underWas === null;
    underWas = u; scene.underwater = u;
    if (!graph) return;
    try { graph.tone.frequency.setTargetAtTime(u ? 1000 : 9000, ctx.currentTime, 0.08); } catch (_) {}
    applyOcean(0.3);
    if (!first) play(u ? 'dive' : 'surface', 0.9);
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
      // sound off / volume 0: leave the context suspended (setVolume(>0) resumes it and starts the sea)
      if (vol <= 0) { idle(); return false; }
      const r = ctx.state === 'suspended' && typeof ctx.resume === 'function' ? ctx.resume() : null;
      startAmbience();                                 // module load overlaps the resume
      scheduleGulls();
      if (musicOn) startMusic();
      if (r) await r;
      if (destroyed) return false;
      return ctx.state === 'running';
    } catch (_) { return false; }
  }

  function setVolume(v) {
    vol = clamp01(v, vol);
    if (graph && ctx && !destroyed) {
      try { graph.master.gain.setTargetAtTime(vol * OUTPUT_SCALE, ctx.currentTime, 0.03); }
      catch (_) { try { graph.master.gain.value = vol * OUTPUT_SCALE; } catch (__) {} }
    }
    idle();
    return vol;
  }

  // Volume 0 (sound toggled off, slider at 0): once the master has faded, suspend the context so the
  // always-on worklet, convolver and crossfeed stop costing audio-thread CPU. Any volume above 0 resumes it.
  let idleTimer = null;
  function idle() {
    if (!ctx || isOffline() || destroyed || !wantRun) return;
    try { clearTimeout(idleTimer); } catch (_) {}
    idleTimer = null;
    try {
      if (vol <= 0 && ctx.state === 'running' && typeof ctx.suspend === 'function') {
        idleTimer = setTimeout(() => { idleTimer = null; if (vol <= 0 && !destroyed && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 200);
      } else if (vol > 0 && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        ctx.resume().then(() => { if (!destroyed && graph) { startAmbience(); scheduleGulls(); if (musicOn) startMusic(); } }, () => {});
      }
    } catch (_) {}
  }

  function setOcean(p = {}) {
    for (const k of ['swell', 'wind', 'speed', 'creak']) if (p[k] != null) ocean[k] = clamp01(p[k], ocean[k]);
    applyOcean(1);
    return { ...ocean };
  }

  // dist/audio.js: setBus(name, v) -> clamped level, null for an unknown name; 'master' is setVolume.
  // Round-1 names 'sfx' and 'ui' still work (sub-buses under 'effects').
  const BUS_NODES = { effects: ['sfxBus', 'uiBus'], sfx: ['sfxBus'], ui: ['uiBus'], ambience: ['ambBus'], music: ['musBus'] };
  function setBus(name, v) {
    if (name === 'master') return setVolume(v);
    if (!Object.prototype.hasOwnProperty.call(level, name)) return null;
    level[name] = clamp01(v, level[name]);
    if (graph && ctx) {
      for (const k of BUS_NODES[name]) {
        const n = graph[k], val = busGain(k === 'sfxBus' ? 'sfx' : k === 'uiBus' ? 'ui' : name);
        try { n.gain.setTargetAtTime(val, ctx.currentTime, 0.03); } catch (_) { try { n.gain.value = val; } catch (__) {} }
      }
    }
    return level[name];
  }
  const getBus = (name) => (name === 'master' ? vol : Object.prototype.hasOwnProperty.call(level, name) ? level[name] : null);

  function setMusic(on) {
    musicOn = !!on;
    if (destroyed) return musicOn;
    if (musicOn && graph && (ctx?.state === 'running' || isOffline())) startMusic();
    else if (!musicOn) stopMusic(true);
    return musicOn;
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
      if (typeof event !== 'string') return false;
      if (Object.prototype.hasOwnProperty.call(ALIASES, event)) event = ALIASES[event];
      if (INTERNAL.has(event)) return false;
      return voiceOn(event, strength, opts, null);
    } catch (_) { return false; }
  }
  // schedule one recipe; bus defaults to sfx (ui events: ui bus)
  function voiceOn(event, strength, opts, bus) {
    const recipe = Object.prototype.hasOwnProperty.call(recipes, event) ? recipes[event] : null;
    if (!recipe) return false;
    const s = clamp01(strength, 1);
    if (s <= 0.001 || voices.size >= MAX_VOICES) return false;
    const now = Math.max(ctx.currentTime, Number.isFinite(opts?.at) ? opts.at : 0);
    if (now - (lastPlay[event] ?? -1) < MIN_GAP[event]) return false;
    lastPlay[event] = now;
    const v = newVoice(bus || (UI_EVENTS.has(event) ? graph.uiBus : graph.sfxBus));
    if (!bus) { const tr = evTrim(event); if (tr !== 1) v.bus.gain.value = tr; }   // mix preset
    if (opts && Number.isFinite(opts.x) && Number.isFinite(opts.z) && typeof ctx.createPanner === 'function') {
      // re-route: voice bus -> panner -> sfx bus
      v.bus.disconnect();
      v.bus.connect(panner(v, opts, graph.spatial, REF_DISTANCE[event] ?? 2));
    }
    voices.add(v);
    try { recipe(v, now + 0.005, s); }
    catch (_) { killVoice(v); return false; }
    if (v.live === 0) finishVoice(v);
    if (DUCK[event]) duck(DUCK[event] * s, 0.2, now);
    return true;
  }

  // dist/audio.js: tick(dt, {swimming}) once per frame. Allocation-free; the ocean params are only
  // re-targeted when the shaped sea changes by more than 0.02.
  let sail0 = null, anchor0 = null, lastWind = -1, lastSpeed = -1, lastSwim = null;
  function tick(dt, st) {
    if (!(dt > 0) || destroyed) return;
    try {
      // a newer engine took the ocean and then died without handing it back: start our own again
      if (amb && amb.handedOff && amb.core?.dead) { amb = null; if (graph && ctx?.state === 'running') startAmbience(); }
      if (!graph || !ctx || (ctx.state !== 'running' && !isOffline())) return;
      if (typeof output === 'function' && !graph.out && (outRetry -= dt) <= 0) { outRetry = 0.5; routeOutput(); }
      const sw = !!st?.swimming;
      const uw = typeof st?.underwater === 'boolean' ? st.underwater : !!underEv;
      setUnderwater(uw);
      const sail = st?.sail;
      let shaped = sw !== lastSwim;
      lastSwim = sw; scene.swimming = sw;
      if (sail && typeof sail === 'object') {
        const ws = Number.isFinite(sail.windStr) ? sail.windStr : null;
        if (ws !== null && Math.abs(ws - lastWind) > 0.02) { lastWind = ws; scene.windStr = ws; shaped = true; }
        const raised = !!sail.raised, anchored = !!sail.anchored;
        if (sail0 !== null && raised !== sail0) play('sail', raised ? 1 : 0.8);
        if (anchor0 !== null && anchored !== anchor0) play('anchor', anchored ? 1 : 0.6);
        sail0 = raised; anchor0 = anchored;
        const up = raised && !anchored && !uw;
        if (up || luff) setLuff(up, ws === null ? 0.5 : clamp01((ws - 0.55) / 0.45, 0.5));
      }
      const f = st?.flow;
      if (f && Number.isFinite(f.x) && Number.isFinite(f.z)) {
        const sp = Math.hypot(f.x, f.z);
        if (Math.abs(sp - lastSpeed) > 0.03) { lastSpeed = sp; scene.speed = sp; shaped = true; }
      }
      if (shaped) applyOcean(0.6);
      if (bed) {
        if ((chordIn -= dt) <= 0) {
          chordIn = 10;
          chord = (chord + 1) % CHORDS.length;
          const t = ctx.currentTime, c = CHORDS[chord];
          for (let i = 0; i < bed.oscs.length; i++) bed.oscs[i].frequency.setTargetAtTime(c[i], t, 0.8);
        }
        if ((pluckIn -= dt) <= 0) { pluckIn = rand(2.5, 6); if (level.music > 0 && vol > 0) voiceOn('pluck', rand(0.5, 1), null, graph.musBus); }
      }
    } catch (_) {}
  }

  // stop a voice's sources at `when` (ctx time; default now) and free its nodes then
  function killVoice(v, when = 0) {
    for (const src of v.sources) { src.onended = null; try { src.stop(when); } catch (_) {} }
    if (!(when > 0)) finishVoice(v);
  }

  // destroy(): first, if this engine holds an ocean it took from an engine that is still alive (a failed
  // hot-update mount), hand it straight back (handBack). Then silence, then free: the master gain ramps to
  // 0 over DESTROY_FADE (80 ms) and every source is told to stop at the end of the ramp; the nodes are
  // disconnected only once the ramp is over, so a hot update (live.js disposes the old build right after
  // mounting the new one) never clicks. With a context that is not running (suspended, offline, closed)
  // nothing is audible, so it frees everything at once.
  function destroy() {
    if (destroyed) return;
    try { if (amb && !amb.handedOff) handBack(); } catch (_) {}
    destroyed = true;
    self.alive = false; self.reclaim = null;
    try { globalThis.removeEventListener?.('raft:underwater', onUnder); } catch (_) {}
    try { clearTimeout(idleTimer); } catch (_) {}
    if (gullClock) { gullClock.onended = null; try { gullClock.stop(); } catch (_) {} gullClock = null; }
    const live = !!graph && !!ctx && ctx.state === 'running' && !isOffline();
    let end = 0;
    if (live) {
      try {
        const t = ctx.currentTime, p = graph.master.gain;
        p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(0, t + DESTROY_FADE);
        end = t + DESTROY_FADE + 0.01;
      } catch (_) { end = 0; }
    }
    const vs = [...voices], r = reel, g = graph, b = bed, l = luff;
    reel = null; bed = null; luff = null;
    for (const v of vs) killVoice(v, end);
    for (const x of [r && r.sq, r && r.ns, ...(b ? b.sources : []), l && l.src, l && l.lfo]) {
      if (!x) continue; x.onended = null; try { x.stop(end); } catch (_) {}
    }
    let freed = false;
    const free = () => {
      if (freed) return; freed = true;
      for (const v of vs) finishVoice(v);
      voices.clear();
      for (const n of [...(r ? r.nodes : []), ...(b ? b.nodes : []), ...(l ? l.nodes : [])]) { try { n.disconnect(); } catch (_) {} }
      stopAmbience();
      if (g) {
        for (const k of ['ambBus', 'ambDuck', 'sfxBus', 'uiBus', 'musBus', 'mix', 'tone', 'master', 'limiter']) { try { g[k].disconnect(); } catch (_) {} }
        for (const n of [...(g.xf || []), ...(g.air || [])]) { try { n.disconnect(); } catch (_) {} }
      }
      graph = null;
    };
    if (!(end > 0)) { free(); return; }
    // audio-clock timer for the free (a context suspended mid-fade frees on resume); a DOM timer backs it
    // up in case the context is closed before it fires
    try { const c = ctx.createConstantSource(); c.offset.value = 0; c.onended = free; c.start(); c.stop(end + 0.01); } catch (_) { free(); return; }
    try { setTimeout(free, 1000); } catch (_) {}
    // The AudioContext (supplied or lazily created) is intentionally left open so a
    // hot-updated module can reuse it via `instance.context`.
  }

  // the raft was jolted (wave hit, someone landed on it): one creak from the ambience, pitched by force
  function creak(force = 0.7) {
    const f = clamp01(force, 0.7);
    if (amb?.node && !amb.handedOff) { try { amb.node.port.postMessage({ type: 'creak', force: f }); return true; } catch (_) { return false; } }
    return play('creak', 0.4 + 0.5 * f);
  }

  function stats() {
    return { voices: voices.size, worklet: amb?.kind === 'worklet' && !amb.handedOff, ambience: amb && !amb.handedOff ? amb.kind : null,
      nodesCreated: nodeCount, state: ctx?.state ?? null, reel: !!reel, music: !!bed, luff: !!luff, underwater: !!scene.underwater,
      routed: !!graph?.out, version: SHARED_VERSION, mix: mixName };
  }

  return {
    get context() { return ctx; },
    get music() { return musicOn; },
    resume, setVolume, setBus, getBus, setMusic, play, tick, destroy,
    setListener, setOcean, setReel, duck, creak, stats,
  };
}

export default createOceanAudio;
