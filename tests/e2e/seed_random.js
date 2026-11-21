// Seeding-only subset of tools/determinism.js (visual worktree): makes Math.random and
// crypto.randomUUID deterministic so the floating-supply mix (and so draw calls) repeats
// run to run. Clocks, timers and rAF are left real. perf_gate.py injects this with
// add_init_script, replacing __SEED__ with the --seed value; dist/ is untouched.
(() => {
  if (window.__perfSeed !== undefined) return;
  let s = (__SEED__ >>> 0) || 1;
  window.__perfSeed = s;
  Math.random = function random() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  if (window.crypto && crypto.randomUUID) {
    let n = 0;
    try { crypto.randomUUID = () => '00000000-0000-4000-8000-' + (++n).toString(16).padStart(12, '0'); } catch (e) {}
  }
})();
