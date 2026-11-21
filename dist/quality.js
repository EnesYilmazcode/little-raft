// Little Raft adaptive quality. Pure ES module: nothing happens on import, no clock or DOM reads.
// createQuality({cap, shadows, enabled, onChange}) -> { tick(frameMs), setCap(cap, shadows), setEnabled(on), reset(), scale, shadowEvery, info }
// Time is the sum of the frame times passed to tick(), so tests drive it with a fake clock.
// Levels run from the user's render scale (the cap; never exceeded) down in 0.1 steps to MIN_SCALE;
// the last level also renders the shadow map every second frame.

export const QUALITY = Object.freeze({
  ALPHA: 0.08,            // EMA weight of each new frame time
  MAX_SAMPLE_MS: 1000,    // longer frames (tab switch, load hitch) are ignored
  SLOW_MS: 22,            // EMA above this...
  DOWN_AFTER_MS: 2000,    // ...for this long steps down
  FAST_MS: 14,            // EMA below this...
  UP_AFTER_MS: 5000,      // ...for this long steps up (doubles after each up-step that gets reverted)
  MAX_UP_AFTER_MS: 60000,
  COOLDOWN_MS: 1500,      // measurements settle after any change before the next one
  REVERT_MS: 6000,        // a step down this soon after a step up counts as a revert
  STEP: 0.1,
  MIN_SCALE: 0.6,
});
const C = QUALITY;
const round = (v) => Math.round(v * 1000) / 1000;

/** Levels for a render-scale cap: [{scale, shadowEvery}], best first. */
export function buildLevels(cap = 1, shadows = true) {
  const top = Number.isFinite(cap) && cap > 0 ? round(cap) : 1;
  const out = [{ scale: top, shadowEvery: 1 }];
  for (let s = round(top - C.STEP); s >= C.MIN_SCALE - 1e-6; s = round(s - C.STEP)) out.push({ scale: s, shadowEvery: 1 });
  const bottom = out[out.length - 1].scale;
  if (bottom > C.MIN_SCALE) out.push({ scale: C.MIN_SCALE, shadowEvery: 1 }); // cap not a multiple of the step
  if (shadows) out.push({ scale: out[out.length - 1].scale, shadowEvery: 2 });
  return out.map(Object.freeze);
}

export function createQuality({ cap = 1, shadows = true, enabled = true, onChange } = {}) {
  let levels = buildLevels(cap, shadows), level = 0, on = enabled !== false;
  let ema = null, time = 0, slowFor = 0, fastFor = 0, lastChangeAt = 0, lastUpAt = -Infinity, upAfter = C.UP_AFTER_MS;

  const info = (reason) => ({ reason, enabled: on, level, levels: levels.length, scale: levels[level].scale,
    shadowEvery: levels[level].shadowEvery, cap: levels[0].scale, ema: ema == null ? null : round(ema), upAfter });
  function settle() { ema = null; slowFor = 0; fastFor = 0; lastChangeAt = time; }
  function go(next, reason) {
    if (next === level) return false;
    level = next; settle(); onChange?.(info(reason)); return true;
  }

  function tick(rawMs) {
    const ms = Number(rawMs);
    if (!on || !Number.isFinite(ms) || ms <= 0 || ms > C.MAX_SAMPLE_MS) return false;
    time += ms;
    ema = ema == null ? ms : ema + C.ALPHA * (ms - ema);
    slowFor = ema > C.SLOW_MS ? slowFor + ms : 0;
    fastFor = ema < C.FAST_MS ? fastFor + ms : 0;
    if (time - lastChangeAt < C.COOLDOWN_MS) return false;
    if (slowFor >= C.DOWN_AFTER_MS && level < levels.length - 1) {
      if (time - lastUpAt < C.REVERT_MS) upAfter = Math.min(C.MAX_UP_AFTER_MS, upAfter * 2); // the up-step did not hold
      lastUpAt = -Infinity;
      return go(level + 1, 'down');
    }
    if (fastFor >= upAfter && level > 0) { lastUpAt = time; return go(level - 1, 'up'); }
    return false;
  }

  return {
    tick,
    /** New user cap (render scale) or shadow setting: restart at the top. */
    setCap(nextCap, nextShadows = shadows) {
      cap = nextCap; shadows = nextShadows;
      const fresh = buildLevels(cap, shadows), changed = fresh[0].scale !== levels[0].scale || fresh.length !== levels.length || level !== 0;
      levels = fresh; level = 0; upAfter = C.UP_AFTER_MS; lastUpAt = -Infinity; settle();
      if (changed) onChange?.(info('cap'));
    },
    setEnabled(next) {
      next = next !== false; if (next === on) return;
      on = next; upAfter = C.UP_AFTER_MS; lastUpAt = -Infinity; settle();
      if (!on && level !== 0) { level = 0; onChange?.(info('disabled')); }
    },
    /** Forget measurements (pause, tab return); keeps the level. */
    reset: settle,
    get scale() { return levels[level].scale; },
    get shadowEvery() { return levels[level].shadowEvery; },
    get level() { return level; },
    get levels() { return levels; },
    get info() { return info('query'); },
  };
}
