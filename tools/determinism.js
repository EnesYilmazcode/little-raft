// Little Raft determinism hook, opt-in through the page URL.
//   ?seed=<int>   Math.random becomes a seeded mulberry32 stream.
//   ?freeze=1     performance.now, Date.now and requestAnimationFrame run on a virtual clock that only
//                 moves when the harness calls window.__det.step(frames). Each step is exactly 1/60 s.
// With neither param present this file does nothing, so it is safe to ship.
//
// tools/visual-diff.py injects it with Playwright add_init_script, so dist/ needs no change today.
// Integrator note: to make ?seed=/?freeze= work for any browser (not only the harness), copy this file
// to dist/determinism.js and add, as the FIRST script in dist/index.html's <head>:
//   <script src="determinism.js"></script>
// It must run before live.js and game.js. It is a classic (non-module) script on purpose.
(() => {
  if (window.__det) return;
  let q;
  try { q = new URLSearchParams(location.search); } catch { return; }
  const seedRaw = q.get('seed'), freeze = q.get('freeze') === '1';
  if (seedRaw === null && !freeze) return;
  const det = window.__det = {seed: null, frozen: freeze, frame: 0, now: 0};

  if (seedRaw !== null) {
    let s = (parseInt(seedRaw, 10) >>> 0) || 1;
    det.seed = s;
    Math.random = function random() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    if (window.crypto && crypto.randomUUID) {
      let n = 0;
      try { crypto.randomUUID = () => '00000000-0000-4000-8000-' + (++n).toString(16).padStart(12, '0'); } catch {}
    }
  }

  if (freeze) {
    const FRAME = 1000 / 60, T0 = 1000, EPOCH = Date.UTC(2026, 0, 1);
    let queue = new Map(), nextId = 1;
    performance.now = () => T0 + det.now;
    Date.now = () => EPOCH + Math.round(det.now);
    window.requestAnimationFrame = cb => { const id = nextId++; queue.set(id, cb); return id; };
    window.cancelAnimationFrame = id => { queue.delete(id); };
    det.step = (frames = 1) => {
      let errors = 0;
      for (let i = 0; i < frames; i++) {
        det.now += FRAME; det.frame++;
        const run = queue; queue = new Map();
        for (const cb of run.values()) { try { cb(T0 + det.now); } catch (e) { errors++; console.error(e); } }
      }
      return {frame: det.frame, now: det.now, pending: queue.size, errors};
    };
    // Visual noise that a virtual clock cannot reach: CSS motion and the text caret.
    const css = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';
    const inject = () => { const st = document.createElement('style'); st.id = 'detFreezeStyle'; st.textContent = css; (document.head || document.documentElement).appendChild(st); };
    if (document.documentElement) inject(); else document.addEventListener('DOMContentLoaded', inject, {once: true});
  }
})();
