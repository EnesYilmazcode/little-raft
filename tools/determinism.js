// Little Raft determinism hook, opt-in through the page URL.
//   ?seed=<int>   Math.random becomes a seeded mulberry32 stream.
//   ?freeze=1     performance.now, Date, setTimeout/setInterval and requestAnimationFrame run on a virtual
//                 clock that only moves when the harness calls window.__det.step(frames). Each step is
//                 exactly 1/60 s. Pointer lock and Web Audio are removed (see below).
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
    const FRAME = 1000 / 60, T0 = 1000, EPOCH = Date.UTC(2026, 0, 1, 12);
    let queue = new Map(), nextId = 1;
    performance.now = () => T0 + det.now;
    const RealDate = Date;
    const vnow = () => EPOCH + Math.round(det.now);
    // new Date() / Date() / Date.now() all read the virtual clock; explicit arguments behave normally.
    const VDate = function Date(...a) {
      if (!new.target) return new RealDate(vnow()).toString();
      return a.length ? new RealDate(...a) : new RealDate(vnow());
    };
    VDate.prototype = RealDate.prototype;
    VDate.now = vnow; VDate.parse = RealDate.parse; VDate.UTC = RealDate.UTC;
    window.Date = VDate;
    window.requestAnimationFrame = cb => { const id = nextId++; queue.set(id, cb); return id; };
    window.cancelAnimationFrame = id => { queue.delete(id); };

    // Timers run on the same virtual clock: a setTimeout(fn, 2600) toast fires after exactly 156 frames,
    // never because the software renderer happened to be slow. Callbacks fire inside step(), in due order.
    const timers = new Map(); let nextTimer = 1, seqNo = 0;
    const addTimer = (fn, ms, args, every) => {
      const id = nextTimer++, d = Math.max(0, Number(ms) || 0);
      timers.set(id, {fn, args, due: det.now + d, every: every ? Math.max(1, d) : 0, seq: seqNo++});
      return id;
    };
    window.setTimeout = (fn, ms, ...args) => addTimer(fn, ms, args, false);
    window.setInterval = (fn, ms, ...args) => addTimer(fn, ms, args, true);
    window.clearTimeout = window.clearInterval = id => { timers.delete(id); };
    const runTimers = () => {
      let errors = 0;
      for (let guard = 0; guard < 10000; guard++) {
        let pick = null, pickId = 0;
        for (const [id, t] of timers) if (t.due <= det.now && (!pick || t.due < pick.due || (t.due === pick.due && t.seq < pick.seq))) { pick = t; pickId = id; }
        if (!pick) break;
        if (pick.every) { pick.due += pick.every; pick.seq = seqNo++; } else timers.delete(pickId);
        try { typeof pick.fn === 'function' ? pick.fn(...pick.args) : (0, eval)(String(pick.fn)); } catch (e) { errors++; console.error(e); }
      }
      return errors;
    };
    det.timers = () => timers.size;
    // Software GL (swiftshader) spends ~all its time rasterising. Frames stepped only to advance the simulation
    // are not drawn: draw/clear calls are dropped for every frame of a step(n) except the last. The game has no
    // render targets or feedback buffers, so the last frame is complete on its own. ?drawall=1 draws every frame.
    det.skipDraw = false;
    if (q.get('drawall') !== '1') {
      const DRAWS = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'clear'];
      for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!C) continue;
        for (const m of DRAWS) {
          const orig = C.prototype[m];
          if (typeof orig !== 'function') continue;
          C.prototype[m] = function (...a) { if (!det.skipDraw) return orig.apply(this, a); };
        }
      }
    }
    det.step = (frames = 1) => {
      let errors = 0;
      for (let i = 0; i < frames; i++) {
        det.now += FRAME; det.frame++;
        det.skipDraw = i < frames - 1;
        errors += runTimers();
        const run = queue; queue = new Map();
        for (const cb of run.values()) { try { cb(T0 + det.now); } catch (e) { errors++; console.error(e); } }
      }
      det.skipDraw = false;
      return {frame: det.frame, now: det.now, pending: queue.size, timers: timers.size, errors};
    };
    // Pointer lock resolves asynchronously (or not at all) in headless Chromium, which flips the game between
    // locked mouse-look and drag-look at an unpredictable moment. Remove it so the game takes its documented
    // drag-to-look path from the first frame. Audio has no pixels and only adds a realtime thread: remove it too.
    try { delete Element.prototype.requestPointerLock; } catch {}
    try { Element.prototype.requestPointerLock = undefined; } catch {}
    try { window.AudioContext = undefined; window.webkitAudioContext = undefined; } catch {}
    // Visual noise that a virtual clock cannot reach: CSS motion and the text caret.
    const css = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';
    const inject = () => { const st = document.createElement('style'); st.id = 'detFreezeStyle'; st.textContent = css; (document.head || document.documentElement).appendChild(st); };
    if (document.documentElement) inject(); else document.addEventListener('DOMContentLoaded', inject, {once: true});
  }
})();
