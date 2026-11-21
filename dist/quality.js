// Little Raft adaptive quality. Pure ES module: nothing happens on import, no clock reads.
// createQuality({renderer, shadowMap, sun, dpr, preset, tier, onChange}) -> { tick(ms), setCap(preset), reset(opts), level, levels, describe() }
// probeGpu(doc) / classifyGpu(name) pick the device tier ('weak' = software or very weak GL) before the renderer exists.
// Driven only by the frame times passed to tick(); time is the sum of accepted samples.

export const PRESETS = Object.freeze({
  low: Object.freeze({ pixelRatio: 1, shadows: false }),
  medium: Object.freeze({ pixelRatio: 1.3, shadows: true }),
  high: Object.freeze({ pixelRatio: 1.5, shadows: true }),
});

export const QUALITY_CONSTANTS = Object.freeze({
  ALPHA: 0.05,            // EMA weight of each new sample
  MAX_SAMPLE_MS: 250,     // longer frames count as this long (a very slow machine still steps down)
  DROP_SAMPLE_MS: 1000,   // longer than this (tab switch, load hitch) is ignored
  MAX_REVERTS: 3,         // this many reverted step-ups to one level stops stepping up until a full reset
  SLOW_MS: 20,            // EMA above this...
  DOWN_AFTER_MS: 2000,    // ...for this long steps quality down
  FAST_MS: 17.5,          // EMA below this...
  UP_AFTER_MS: 8000,      // ...for this long (base) steps quality up
  MAX_UP_AFTER_MS: 60000, // backoff ceiling for the up-wait
  COOLDOWN_MS: 5000,      // no change of any kind this soon after a change
  REVERT_MS: 5000,        // a step-down within this long after the post-up cooldown ends counts as a revert
  SHADOW_FULL: 1024,
  SHADOW_LOW: 512,
  WEAK_FLOOR_PR: 0.7,     // weak tier only: one more pixel-ratio step below "shadows off"
});

// Software rasterizers and fallback drivers: fill-bound, so no MSAA and a deeper ladder.
const WEAK_GPU = /swiftshader|llvmpipe|softpipe|software|microsoft basic render|basic render driver/i;

/** 'weak' for software / fallback GL renderer strings, else 'normal'. Unknown (masked) names count as normal. */
export function classifyGpu(name) {
  return typeof name === 'string' && WEAK_GPU.test(name) ? 'weak' : 'normal';
}

/**
 * Read the GL renderer string from a throwaway context (the game canvas's own context attributes, antialias
 * included, are fixed at creation, so this must run first). Returns {tier, renderer}.
 */
export function probeGpu(doc = globalThis.document) {
  let name = null;
  try {
    const gl = doc?.createElement?.('canvas')?.getContext?.('webgl2') || null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '') || null;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { name = null; }
  return { tier: classifyGpu(name), renderer: name };
}

/** MSAA only on real GPUs at low dpr (dense screens get their smoothing from pixels). */
export const wantMsaa = (tier, dpr = 1) => tier !== 'weak' && dpr < 1.5;

const C = QUALITY_CONSTANTS;

// Ladder from best to worst; `null` pixel ratio means "the preset's own value".
const LADDER = [
  { pixelRatio: null, shadows: true, shadowMapSize: C.SHADOW_FULL },
  { pixelRatio: 1.15, shadows: true, shadowMapSize: C.SHADOW_FULL },
  { pixelRatio: 1.0, shadows: true, shadowMapSize: C.SHADOW_FULL },
  { pixelRatio: 1.0, shadows: true, shadowMapSize: C.SHADOW_LOW },
  { pixelRatio: 0.85, shadows: true, shadowMapSize: C.SHADOW_LOW },
  { pixelRatio: 0.85, shadows: false, shadowMapSize: C.SHADOW_LOW },
  { pixelRatio: C.WEAK_FLOOR_PR, shadows: false, shadowMapSize: C.SHADOW_LOW, weakOnly: true },
];

const round = (v) => Math.round(v * 1000) / 1000;

/**
 * Turn the sun's shadows on or off without changing any shader program key. sun.castShadow stays true
 * (flipping it changes numDirLightShadows, so every lit material would need a second program); "off"
 * stops the shadow pass (shadowMap.autoUpdate=false: WebGLShadowMap.render returns early, 0 draws) and sets
 * shadow.intensity=0 so the stale map reads as fully lit. "On" restores both and asks for one redraw.
 */
export function setShadows(shadowMap, sun, on) {
  if (sun) {
    sun.castShadow = true;
    if (sun.shadow) sun.shadow.intensity = on ? 1 : 0;
  }
  if (shadowMap) {
    if (on && !shadowMap.autoUpdate) shadowMap.needsUpdate = true;
    if (!on) shadowMap.needsUpdate = false;
    shadowMap.autoUpdate = !!on;
  }
}

/** Build the level list for a preset cap, device pixel ratio and tier. Never exceeds the cap. */
export function buildLevels(preset = 'medium', dpr = 1, tier = 'normal') {
  const cap = PRESETS[preset] || PRESETS.medium;
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const capPr = Math.min(d, cap.pixelRatio);
  const out = [];
  for (const step of LADDER) {
    if (step.weakOnly && tier !== 'weak') continue;
    const pixelRatio = round(Math.min(capPr, step.pixelRatio ?? capPr));
    const shadows = cap.shadows && step.shadows;
    const shadowMapSize = shadows ? step.shadowMapSize : 0;
    const prev = out[out.length - 1];
    if (prev && prev.pixelRatio === pixelRatio && prev.shadows === shadows && prev.shadowMapSize === shadowMapSize) continue;
    out.push(Object.freeze({ pixelRatio, shadows, shadowMapSize }));
  }
  return Object.freeze(out);
}

/** Level to start (and fully reset) at: the top, or on the weak tier the first level with the small shadow map. */
export function startLevel(levels, tier = 'normal') {
  if (tier !== 'weak') return 0;
  const i = levels.findIndex((l) => l.shadows && l.shadowMapSize < C.SHADOW_FULL);
  return i < 0 ? 0 : i; // no shadow levels (low preset): already cheap, start at its top
}

export function createQuality({ renderer, shadowMap = renderer?.shadowMap, sun, dpr = globalThis.devicePixelRatio ?? 1, preset = 'medium', tier = 'normal', onChange } = {}) {
  let cap = PRESETS[preset] ? preset : 'medium';
  let levels = buildLevels(cap, dpr, tier);
  let level = startLevel(levels, tier);
  let ema = null, time = 0, slowFor = 0, fastFor = 0;
  let lastChangeAt = -Infinity, lastUpAt = -Infinity;
  let upAfter = C.UP_AFTER_MS, reverts = [];

  function info(reason) {
    const l = levels[level];
    return { reason, level, count: levels.length, preset: cap, tier, pixelRatio: l.pixelRatio, shadows: l.shadows,
      shadowMapSize: l.shadowMapSize, ema: ema == null ? null : round(ema), upAfter };
  }

  function apply(reason, notify = true) {
    const l = levels[level];
    renderer?.setPixelRatio?.(l.pixelRatio);
    if (sun) {
      if (l.shadows) {
        const shadow = sun.shadow;
        if (shadow && shadow.mapSize && (shadow.mapSize.x !== l.shadowMapSize || shadow.mapSize.y !== l.shadowMapSize)) {
          shadow.map?.dispose?.();
          shadow.map = null;
          shadow.mapSize.set(l.shadowMapSize, l.shadowMapSize);
        }
      }
    }
    if (sun || shadowMap) setShadows(shadowMap, sun, l.shadows);
    if (notify) onChange?.(info(reason));
  }

  function changeTo(next, reason) {
    level = next;
    lastChangeAt = time;
    slowFor = 0; fastFor = 0;
    apply(reason);
  }

  function tick(rawMs) {
    let ms = Number(rawMs);
    if (!Number.isFinite(ms) || ms <= 0 || ms > C.DROP_SAMPLE_MS) return false;
    ms = Math.min(ms, C.MAX_SAMPLE_MS);
    time += ms;
    ema = ema == null ? ms : ema + C.ALPHA * (ms - ema);
    slowFor = ema > C.SLOW_MS ? slowFor + ms : 0;
    fastFor = ema < C.FAST_MS ? fastFor + ms : 0;
    if (time - lastChangeAt < C.COOLDOWN_MS) return false;
    if (slowFor >= C.DOWN_AFTER_MS && level < levels.length - 1) {
      if (time - lastUpAt < C.COOLDOWN_MS + C.REVERT_MS) {
        reverts[level] = (reverts[level] || 0) + 1;
        upAfter = reverts[level] >= C.MAX_REVERTS ? Infinity : Math.min(C.MAX_UP_AFTER_MS, upAfter * 2);
      }
      lastUpAt = -Infinity;
      changeTo(level + 1, 'down');
      return true;
    }
    if (fastFor >= upAfter && level > 0) {
      lastUpAt = time;
      changeTo(level - 1, 'up');
      return true;
    }
    return false;
  }

  /** Clear measurements (use on resume / tab return). {full:true} also restores the start level and base up-wait. */
  function reset({ full = false } = {}) {
    ema = null; slowFor = 0; fastFor = 0;
    lastChangeAt = time; // restart cooldown so the first post-pause frames can't trigger a change
    if (full) {
      upAfter = C.UP_AFTER_MS; lastUpAt = -Infinity; reverts = [];
      const top = startLevel(levels, tier);
      if (level !== top) { level = top; apply('reset'); }
    }
  }

  /** Switch the user's preset cap; restarts at that preset's start level. */
  function setCap(next) {
    cap = PRESETS[next] ? next : 'medium';
    levels = buildLevels(cap, dpr, tier);
    level = startLevel(levels, tier);
    ema = null; slowFor = 0; fastFor = 0;
    lastChangeAt = time; lastUpAt = -Infinity;
    upAfter = C.UP_AFTER_MS; reverts = [];
    apply('cap');
  }

  function describe() {
    const l = levels[level];
    const sh = l.shadows ? `shadows ${l.shadowMapSize}` : 'no shadows';
    return `${cap} ${level + 1}/${levels.length}: pr ${l.pixelRatio}, ${sh}, ema ${ema == null ? '-' : ema.toFixed(1)}ms`;
  }

  apply('init', false);

  return {
    tick, setCap, reset, describe,
    get level() { return level; },
    get levels() { return levels; },
    get ema() { return ema; },
    get upAfter() { return upAfter; },
    get tier() { return tier; },
    get info() { return info('query'); },
  };
}
