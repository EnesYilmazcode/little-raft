// In-game perf panel for dist/perf-overlay.js. Pure ES module, nothing happens on import.
//   import createPerfOverlay from perf-overlay.js with the same ?build= stamp as game.js' other imports
//   const perf = createPerfOverlay({renderer, quality});   // quality: the quality.js scaler (optional)
//   // in frame(): perf.begin(); ...update + render...; perf.end();
//   // F3 (or ?perf in the URL) toggles the panel. perf.dispose() on unmount.
// Dynamic resolution is NOT done here any more: quality.js owns pixel ratio, shadow map size and shadows
// (its ladder steps down after 2 s over 20 ms and back up after 8 s+ under 17.5 ms). The panel shows its level.
// Cost when hidden: two performance.now() calls and two EMA updates per frame; no DOM writes, no allocations.
// Cost when shown: one textContent write every 500 ms.
//
// Numbers shown:
//   fps / frame / p95: from begin-to-begin gaps (what the player feels, includes GPU stalls and vsync)
//   cpu: begin()->end() time on the main thread (JS + WebGL command submission, not GPU time)
//   calls/tris: renderer.info as game.js leaves it (it resets before render, so the shadow pass and diving's
//              overlay pass are counted too; stock three resets after the shadow pass and hides those)
//   geo/tex/prog: live GPU resources (leak watch: these should stay flat while playing)
//   quality: quality.describe() -> preset, level, pixel ratio, shadow map, frame EMA
export function createPerfOverlay({ renderer, quality = null, key = 'F3', visible = false, parent = document.body } = {}) {
  const el = document.createElement('div');
  el.id = 'perfOverlay';
  el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:50;pointer-events:none;white-space:pre;font:11px/1.35 ui-monospace,Menlo,monospace;color:#eaf2ee;background:rgba(14,26,28,.72);padding:6px 8px;border-radius:6px';
  let shown = visible || /[?&]perf\b/.test(location.search);
  el.hidden = !shown; parent.appendChild(el);
  const onKey = e => { if (e.code === key && !e.repeat) { shown = !shown; el.hidden = !shown; e.preventDefault(); } };
  addEventListener('keydown', onKey);

  const gaps = new Float32Array(120); let gi = 0, filled = 0;
  let last = 0, t0 = 0, cpuEma = 0, gapEma = 16.7, hudClock = 0;

  function begin() {
    const now = performance.now(), gap = last ? now - last : 16.7; last = t0 = now;
    if (gap > 250) return; // tab was hidden / paused: ignore
    gapEma += (gap - gapEma) * 0.05; gaps[gi] = gap; gi = (gi + 1) % gaps.length; filled = Math.min(filled + 1, gaps.length);
    hudClock += gap;
  }
  function end() {
    cpuEma += (performance.now() - t0 - cpuEma) * 0.05;
    if (!shown || hudClock < 500) return;
    hudClock = 0;
    const s = Array.from(gaps.subarray(0, filled)).sort((a, b) => a - b), p95 = s[Math.floor(s.length * 0.95)] ?? 0;
    const i = renderer.info, mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + 'MB' : '-';
    el.textContent = `${(1000 / gapEma).toFixed(0)} fps  ${gapEma.toFixed(1)} ms  p95 ${p95.toFixed(1)}\n`
      + `cpu ${cpuEma.toFixed(2)} ms  heap ${mem}\n`
      + `calls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(1)}k\n`
      + `geo ${i.memory.geometries}  tex ${i.memory.textures}  prog ${i.programs?.length ?? 0}\n`
      + (quality?.describe ? quality.describe() : `dpr ${renderer.getPixelRatio().toFixed(2)}  shadows ${renderer.shadowMap.enabled ? 'on' : 'off'}`);
  }
  return {
    begin, end, el,
    show(v = true) { shown = !!v; el.hidden = !shown; },
    get shown() { return shown; },
    dispose() { removeEventListener('keydown', onKey); el.remove(); },
  };
}
