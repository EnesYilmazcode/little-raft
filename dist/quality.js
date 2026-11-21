// Little Raft adaptive quality. Pure ES module: nothing happens on import, no clock reads.
// createQuality({renderer, sun, dpr, preset, onChange}) -> { tick(ms), setCap(preset), reset(opts), level, levels, describe() }
// Driven only by the frame times passed to tick(); time is the sum of accepted samples.

export const PRESETS = Object.freeze({
  low: Object.freeze({ pixelRatio: 1, shadows: false }),
  medium: Object.freeze({ pixelRatio: 1.3, shadows: true }),
  high: Object.freeze({ pixelRatio: 1.5, shadows: true }),
});

export const QUALITY_CONSTANTS = Object.freeze({
  ALPHA: 0.05,            // EMA weight of each new sample
  MAX_SAMPLE_MS: 250,     // longer frames (tab switch, GC, load hitch) are ignored
  SLOW_MS: 20,            // EMA above this...
  DOWN_AFTER_MS: 2000,    // ...for this long steps quality down
  FAST_MS: 17.5,          // EMA below this...
  UP_AFTER_MS: 8000,      // ...for this long (base) steps quality up
  MAX_UP_AFTER_MS: 60000, // backoff ceiling for the up-wait
  COOLDOWN_MS: 5000,      // no change of any kind this soon after a change
  REVERT_MS: 5000,        // a step-down within this long after the post-up cooldown ends counts as a revert
  SHADOW_FULL: 1024,
  SHADOW_LOW: 512,
});

const C = QUALITY_CONSTANTS;

// Ladder from best to worst; `null` pixel ratio means "the preset's own value".
const LADDER = [
  { pixelRatio: null, shadows: true, shadowMapSize: C.SHADOW_FULL },
  { pixelRatio: 1.15, shadows: true, shadowMapSize: C.SHADOW_FULL },
  { pixelRatio: 1.0, shadows: true, shadowMapSize: C.SHADOW_FULL },
  { pixelRatio: 1.0, shadows: true, shadowMapSize: C.SHADOW_LOW },
  { pixelRatio: 0.85, shadows: true, shadowMapSize: C.SHADOW_LOW },
  { pixelRatio: 0.85, shadows: false, shadowMapSize: C.SHADOW_LOW },
];

const round = (v) => Math.round(v * 1000) / 1000;

/** Build the level list for a preset cap and device pixel ratio. Never exceeds the cap. */
export function buildLevels(preset = 'medium', dpr = 1) {
  const cap = PRESETS[preset] || PRESETS.medium;
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const capPr = Math.min(d, cap.pixelRatio);
  const out = [];
  for (const step of LADDER) {
    const pixelRatio = round(Math.min(capPr, step.pixelRatio ?? capPr));
    const shadows = cap.shadows && step.shadows;
    const shadowMapSize = shadows ? step.shadowMapSize : 0;
    const prev = out[out.length - 1];
    if (prev && prev.pixelRatio === pixelRatio && prev.shadows === shadows && prev.shadowMapSize === shadowMapSize) continue;
    out.push(Object.freeze({ pixelRatio, shadows, shadowMapSize }));
  }
  return Object.freeze(out);
}

export function createQuality({ renderer, sun, dpr = globalThis.devicePixelRatio ?? 1, preset = 'medium', onChange } = {}) {
  let cap = PRESETS[preset] ? preset : 'medium';
  let levels = buildLevels(cap, dpr);
  let level = 0;
  let ema = null, time = 0, slowFor = 0, fastFor = 0;
  let lastChangeAt = -Infinity, lastUpAt = -Infinity;
  let upAfter = C.UP_AFTER_MS;

  function info(reason) {
    const l = levels[level];
    return { reason, level, count: levels.length, preset: cap, pixelRatio: l.pixelRatio, shadows: l.shadows,
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
        sun.castShadow = true;
      } else {
        sun.castShadow = false;
      }
    }
    if (notify) onChange?.(info(reason));
  }

  function changeTo(next, reason) {
    level = next;
    lastChangeAt = time;
    slowFor = 0; fastFor = 0;
    apply(reason);
  }

  function tick(rawMs) {
    const ms = Number(rawMs);
    if (!Number.isFinite(ms) || ms <= 0 || ms > C.MAX_SAMPLE_MS) return false;
    time += ms;
    ema = ema == null ? ms : ema + C.ALPHA * (ms - ema);
    slowFor = ema > C.SLOW_MS ? slowFor + ms : 0;
    fastFor = ema < C.FAST_MS ? fastFor + ms : 0;
    if (time - lastChangeAt < C.COOLDOWN_MS) return false;
    if (slowFor >= C.DOWN_AFTER_MS && level < levels.length - 1) {
      if (time - lastUpAt < C.COOLDOWN_MS + C.REVERT_MS) upAfter = Math.min(C.MAX_UP_AFTER_MS, upAfter * 2);
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

  /** Clear measurements (use on resume / tab return). {full:true} also restores the top level and base up-wait. */
  function reset({ full = false } = {}) {
    ema = null; slowFor = 0; fastFor = 0;
    lastChangeAt = time; // restart cooldown so the first post-pause frames can't trigger a change
    if (full) {
      upAfter = C.UP_AFTER_MS; lastUpAt = -Infinity;
      if (level !== 0) { level = 0; apply('reset'); }
    }
  }

  /** Switch the user's preset cap; restarts at that preset's top level. */
  function setCap(next) {
    cap = PRESETS[next] ? next : 'medium';
    levels = buildLevels(cap, dpr);
    level = 0;
    ema = null; slowFor = 0; fastFor = 0;
    lastChangeAt = time; lastUpAt = -Infinity;
    upAfter = C.UP_AFTER_MS;
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
    get info() { return info('query'); },
  };
}
