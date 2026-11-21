// Lightweight in-game perf overlay + optional dynamic resolution. Proposal for dist/perf-overlay.js.
//   import { createPerfOverlay } from './perf-overlay.js?build=...';
//   const perf = createPerfOverlay({renderer, maxPixelRatio:1.7, dynamic:false});
//   // in frame(): perf.begin(); ...update + renderer.render(...)...; perf.end();
//   // F3 (or ?perf in the URL) toggles the panel. perf.dispose() on unmount.
// Cost when hidden: two performance.now() calls and an EMA per frame; no DOM writes, no allocations.
// Cost when shown: one textContent write every 500 ms.
//
// Numbers shown:
//   fps / frame: from rAF-to-rAF gaps (what the player feels, includes GPU stalls and vsync)
//   cpu: begin()->end() time on the main thread (JS + WebGL command submission, not GPU time)
//   p95: 95th percentile frame gap over the last 120 frames
//   calls/tris: INCLUDING the shadow pass (three resets renderer.info after the shadow pass by default, which hides
//              about half of the real draw calls); we switch info.autoReset off and reset in begin().
//   geo/tex/prog: live GPU resources (leak watch: these should be flat while playing)
//   dpr: current pixel ratio (moves when dynamic resolution is on)
export function createPerfOverlay({ renderer, maxPixelRatio = 1.7, minPixelRatio = 0.6, dynamic = false, key = 'F3', parent = document.body } = {}) {
  const el = document.createElement('div');
  el.id = 'perfOverlay';
  el.style.cssText = 'position:fixed;right:8px;top:8px;z-index:50;pointer-events:none;white-space:pre;font:11px/1.35 ui-monospace,Menlo,monospace;color:#eaf2ee;background:rgba(14,26,28,.72);padding:6px 8px;border-radius:6px';
  let shown = /[?&]perf\b/.test(location.search);
  el.hidden = !shown; parent.appendChild(el);
  const onKey = e => { if (e.code === key) { shown = !shown; el.hidden = !shown; e.preventDefault(); } };
  addEventListener('keydown', onKey);
  renderer.info.autoReset = false;

  const gaps = new Float32Array(120); let gi = 0, filled = 0;
  let last = 0, t0 = 0, cpuEma = 0, gapEma = 16.7, minGap = 1000, hudClock = 0;
  // dynamic resolution: hysteresis on the frame-gap EMA against the display's own refresh budget
  let over = 0, under = 0, dpr = Math.min(devicePixelRatio, maxPixelRatio);

  function begin() { t0 = performance.now(); renderer.info.reset(); }
  function end() {
    const now = performance.now(), cpu = now - t0;
    const gap = last ? now - last : 16.7; last = now;
    if (gap > 250) return; // tab was hidden / paused: ignore
    cpuEma += (cpu - cpuEma) * 0.05; gapEma += (gap - gapEma) * 0.05;
    minGap = Math.min(minGap * 1.0005, gap); // slowly forget: tracks the display refresh interval
    gaps[gi] = gap; gi = (gi + 1) % gaps.length; filled = Math.min(filled + 1, gaps.length);
    if (dynamic) {
      const budget = Math.max(minGap, 1000 / 144);
      if (gapEma > budget * 1.25) { over += gap; under = 0; } else if (gapEma < budget * 1.08) { under += gap; over = 0; } else over = under = 0;
      let next = dpr;
      if (over > 1000) next = Math.max(minPixelRatio, dpr - 0.15);
      else if (under > 4000) next = Math.min(Math.min(devicePixelRatio, maxPixelRatio), dpr + 0.1);
      if (next !== dpr) { dpr = +next.toFixed(2); renderer.setPixelRatio(dpr); over = under = 0; }
    }
    hudClock += gap;
    if (shown && hudClock > 500) {
      hudClock = 0;
      const s = Array.from(gaps.subarray(0, filled)).sort((a, b) => a - b), p95 = s[Math.floor(s.length * 0.95)] ?? 0;
      const i = renderer.info, mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + 'MB' : '-';
      el.textContent = `${(1000 / gapEma).toFixed(0)} fps  ${gapEma.toFixed(1)} ms  p95 ${p95.toFixed(1)}\n`
        + `cpu ${cpuEma.toFixed(2)} ms  heap ${mem}\n`
        + `calls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(1)}k\n`
        + `geo ${i.memory.geometries}  tex ${i.memory.textures}  prog ${i.programs?.length ?? 0}\n`
        + `dpr ${renderer.getPixelRatio().toFixed(2)}${dynamic ? ' auto' : ''}  shadow ${renderer.shadowMap.enabled ? (renderer.shadowMap.autoUpdate ? 'on' : 'cached') : 'off'}`;
    }
  }
  return {
    begin, end, el,
    setDynamic(v) { dynamic = !!v; if (!v) { dpr = Math.min(devicePixelRatio, maxPixelRatio); renderer.setPixelRatio(dpr); } },
    // call after the game applies its own pixel-ratio cap (settings change); dynamic mode then works under the new cap
    setMaxPixelRatio(v) { maxPixelRatio = v; if (dynamic) { dpr = Math.min(dpr, v, devicePixelRatio); renderer.setPixelRatio(dpr); } else dpr = Math.min(devicePixelRatio, v); },
    get pixelRatio() { return dpr; },
    dispose() { removeEventListener('keydown', onKey); el.remove(); renderer.info.autoReset = true; },
  };
}
