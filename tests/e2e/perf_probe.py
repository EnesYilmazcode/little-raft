"""Perf probe: python tests/e2e/perf_probe.py <dist_dir> [runs]
Counts WebGL draw calls / triangles per frame (by wrapping the GL context), frame times,
JS heap allocation rate and GC count while idling and walking in a fresh solo game, and startup times.
Software GL, so frame times are relative only. Prints JSON (median of runs)."""
import sys, json, threading, functools, http.server, socketserver, statistics
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1]).resolve(); runs = int(sys.argv[2]) if len(sys.argv) > 2 else 3
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
url = f'http://127.0.0.1:{srv.server_address[1]}/'
threading.Thread(target=srv.serve_forever, daemon=True).start()

HOOK = r"""
(() => {
  const P = window.__perf = { calls: 0, tris: 0, frames: [] };
  const wrap = (proto) => {
    if (!proto) return;
    const tri = (mode, n, inst) => (mode === 4 ? n / 3 : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0) * (inst || 1);
    const de = proto.drawElements, da = proto.drawArrays, dei = proto.drawElementsInstanced, dai = proto.drawArraysInstanced;
    proto.drawElements = function (m, c, t, o) { P.calls++; P.tris += tri(m, c); return de.call(this, m, c, t, o); };
    proto.drawArrays = function (m, f, c) { P.calls++; P.tris += tri(m, c); return da.call(this, m, f, c); };
    if (dei) proto.drawElementsInstanced = function (m, c, t, o, i) { P.calls++; P.tris += tri(m, c, i); return dei.call(this, m, c, t, o, i); };
    if (dai) proto.drawArraysInstanced = function (m, f, c, i) { P.calls++; P.tris += tri(m, c, i); return dai.call(this, m, f, c, i); };
  };
  wrap(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  wrap(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  P.t0 = performance.now();
})();
"""
SAMPLE = r"""(ms) => new Promise(res => {
  const P = window.__perf, fr = [], calls = [], tris = [], heap = [];
  let last = performance.now(), end = last + ms;
  P.calls = 0; P.tris = 0;
  const hs = setInterval(() => performance.memory && heap.push(performance.memory.usedJSHeapSize), 50);
  function f(t) {
    fr.push(t - last); last = t; calls.push(P.calls); tris.push(P.tris); P.calls = 0; P.tris = 0;
    if (t < end) requestAnimationFrame(f); else {
      clearInterval(hs);
      let alloc = 0, gcs = 0;
      for (let i = 1; i < heap.length; i++) { const d = heap[i] - heap[i - 1]; if (d > 0) alloc += d; else if (d < -65536) gcs++; }
      const s = fr.slice(1).sort((a, b) => a - b), med = a => { const b = a.slice(1).sort((x, y) => x - y); return b[b.length >> 1] || 0; };
      res({ frames: s.length, avgMs: s.reduce((a, b) => a + b, 0) / s.length, p95Ms: s[Math.floor(s.length * .95)], worstMs: s[s.length - 1],
        drawCalls: med(calls), triangles: Math.round(med(tris)), allocMBps: alloc / 1048576 / (ms / 1000), gcCount: gcs,
        heapStartMB: heap[0] / 1048576, heapEndMB: heap[heap.length - 1] / 1048576 });
    }
  }
  requestAnimationFrame(f);
})"""

START = r"""(sel) => new Promise((res, rej) => {
  const el = document.querySelector(sel), t = performance.now(), end = t + 30000;
  el.click();
  // Done when the game reports running and the next animation frame after that has fired.
  (function poll() {
    if (raftDebug.state.running) requestAnimationFrame(() => res(performance.now() - t));
    else if (performance.now() > end) rej(new Error('game did not start'));
    else setTimeout(poll, 0);
  })();
})"""

def one(b):
    ctx = b.new_context(viewport={'width': 1280, 'height': 720}); ctx.add_init_script(HOOK)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=30000)
    r = {'debugReadyMs': page.evaluate('performance.now() - __perf.t0')}
    r['dcl'] = page.evaluate("performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd")
    page.wait_for_timeout(500)
    # Click and time inside the page: Playwright's actionability checks wait on (slow, software GL) frames.
    r['soloToRunningMs'] = page.evaluate(START, '#newGame' if page.locator('#newGame').count() else '#solo')
    page.wait_for_timeout(2500)
    r['idle'] = page.evaluate(SAMPLE, 5000)
    page.keyboard.down('w'); page.keyboard.down('a')
    r['walk'] = page.evaluate(SAMPLE, 3000)
    page.keyboard.up('w'); page.keyboard.up('a')
    r['errors'] = errs
    ctx.close(); return r

def median(rs):
    def m(path):
        vals = [functools.reduce(lambda d, k: d[k], path, r) for r in rs]
        return round(statistics.median(vals), 3)
    out = {'runs': len(rs), 'debugReadyMs': m(['debugReadyMs']), 'soloToRunningMs': m(['soloToRunningMs'])}
    for ph in ('idle', 'walk'):
        out[ph] = {k: m([ph, k]) for k in rs[0][ph]}
    out['errors'] = sorted({e for r in rs for e in r['errors']})
    return out

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True,
        args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'])
    rs = [one(b) for _ in range(runs)]
    b.close()
srv.shutdown()
print(json.dumps(median(rs), indent=1))
