"""Perf budget gate for Little Raft.

Plays a scripted solo session in headless Chrome (SwiftShader) and fails when the game
goes over the budgets in tests/e2e/perf_budget.json.

Measures, per rendered frame: WebGL draw calls, triangles, and script time inside the
requestAnimationFrame callback (performance.mark/measure "raft:frame"). Over the whole
run: long tasks, JS heap growth after forced GC, DOM node / listener growth and live WebGL
object growth (buffers, textures, programs...), all game-agnostic (no game hooks needed).

Usage:
  python tests/e2e/perf_gate.py                      # serves ./dist (or $RAFT_DIST) itself
  python tests/e2e/perf_gate.py --url http://127.0.0.1:41902/
  python tests/e2e/perf_gate.py --duration 30 --out .qa/perf/quick.json

Under release_queue.py it picks up RAFT_QA_URL automatically.
Exit codes: 0 within budget, 1 over budget, 2 harness error (page never booted etc).
SwiftShader numbers are only comparable to other SwiftShader runs, not to real GPUs.
"""
import argparse, functools, http.server, json, os, socketserver, sys, threading, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DEFAULT_BUDGET = HERE / 'perf_budget.json'
MAX_FRAMES = 20000  # ring capacity; preallocated so recording never grows the heap

INIT_JS = r"""
(() => {
  if (window.__perf) return;
  const CAP = %d;
  const P = window.__perf = {
    recording: false, n: 0, cap: CAP,
    ts: new Float64Array(CAP), draws: new Float32Array(CAP), tris: new Float32Array(CAP), script: new Float32Array(CAP),
    curDraws: 0, curTris: 0, curScript: 0, curOff: 0, lastTs: -1, fb: null,
    off: new Float32Array(CAP), snap: 0, snapList: null, lastSnap: null, vendor: null,
    gl: {buffer: 0, texture: 0, program: 0, shader: 0, framebuffer: 0, renderbuffer: 0, vertexArray: 0},
    longCount: 0, longTotal: 0, longMax: 0, loafCount: 0, loafBlockMax: 0, loafBlockTotal: 0,
    contexts: 0,
  };
  const triCount = (mode, count, inst) => {
    const per = mode === 4 ? Math.floor(count / 3) : (mode === 5 || mode === 6) ? Math.max(0, count - 2) : 0;
    return per * inst;
  };
  const add = (mode, count, inst) => {
    const t = triCount(mode, count, inst); P.curDraws++; P.curTris += t; if (P.fb) P.curOff++;
    if (P.snapList) P.snapList.push([t, count, inst, mode, P.fb ? 1 : 0]);
  };
  const wrap = (proto, name, fn) => {
    const orig = proto[name]; if (typeof orig !== 'function') return;
    proto[name] = function (...a) { fn(a); return orig.apply(this, a); };
  };
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue; const p = C.prototype;
    wrap(p, 'drawArrays', a => add(a[0], a[2], 1));
    wrap(p, 'drawElements', a => add(a[0], a[1], 1));
    wrap(p, 'drawArraysInstanced', a => add(a[0], a[2], a[3]));
    wrap(p, 'drawElementsInstanced', a => add(a[0], a[1], a[4]));
    wrap(p, 'drawRangeElements', a => add(a[0], a[3], 1));
    wrap(p, 'bindFramebuffer', a => { P.fb = a[1] || null; });
    for (const k of Object.keys(P.gl)) {
      const K = k[0].toUpperCase() + k.slice(1);
      wrap(p, 'create' + K, () => { P.gl[k]++; });
      wrap(p, 'delete' + K, a => { if (a[0]) P.gl[k]--; });
    }
  }
  const ANGLE = 'ANGLE_instanced_arrays';
  const origGetExt = WebGLRenderingContext.prototype.getExtension;
  WebGLRenderingContext.prototype.getExtension = function (name) {
    const ext = origGetExt.call(this, name);
    if (ext && name === ANGLE && !ext.__perf) {
      ext.__perf = 1;
      const da = ext.drawArraysInstancedANGLE, de = ext.drawElementsInstancedANGLE;
      ext.drawArraysInstancedANGLE = function (m, f, c, i) { add(m, c, i); return da.call(this, m, f, c, i); };
      ext.drawElementsInstancedANGLE = function (m, c, t, o, i) { add(m, c, i); return de.call(this, m, c, t, o, i); };
    }
    return ext;
  };
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = origGetContext.call(this, type, ...rest);
    if (ctx && /webgl/.test(type) && !this.__perfCtx) {
      this.__perfCtx = 1; P.contexts++;
      if (!P.vendor) try { const e = ctx.getExtension('WEBGL_debug_renderer_info'); P.vendor = e ? ctx.getParameter(e.UNMASKED_RENDERER_WEBGL) : null; } catch (e) {}
    }
    return ctx;
  };
  // Frame boundary = a new rAF timestamp. Everything drawn since the previous boundary
  // belongs to the previous frame.
  const flush = () => {
    if (P.recording && P.lastTs >= 0 && P.n < CAP) {
      const i = P.n++; P.ts[i] = P.lastTs; P.draws[i] = P.curDraws; P.tris[i] = P.curTris; P.script[i] = P.curScript; P.off[i] = P.curOff;
    }
    if (P.snapList) { P.lastSnap = P.snapList; P.snapList = null; }
    if (P.snap > 0 && P.lastTs >= 0) { P.snap--; P.snapList = []; }
    P.curDraws = 0; P.curTris = 0; P.curScript = 0; P.curOff = 0;
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return raf(ts => {
      if (ts !== P.lastTs) { flush(); P.lastTs = ts; }
      performance.mark('raft:frame:start');
      try { cb(ts); } finally {
        const m = performance.measure('raft:frame', 'raft:frame:start');
        P.curScript += m ? m.duration : 0;
        performance.clearMarks('raft:frame:start'); performance.clearMeasures('raft:frame');
      }
    });
  };
  try {
    new PerformanceObserver(list => {
      if (!P.recording) return;
      for (const e of list.getEntries()) { P.longCount++; P.longTotal += e.duration; if (e.duration > P.longMax) P.longMax = e.duration; }
    }).observe({type: 'longtask', buffered: false});
  } catch (e) {}
  try {
    new PerformanceObserver(list => {
      if (!P.recording) return;
      for (const e of list.getEntries()) { P.loafCount++; const b = e.blockingDuration || 0; P.loafBlockTotal += b; if (b > P.loafBlockMax) P.loafBlockMax = b; }
    }).observe({type: 'long-animation-frame', buffered: false});
  } catch (e) {}
  P.start = () => { P.n = 0; P.longCount = P.longTotal = P.longMax = 0; P.loafCount = P.loafBlockTotal = P.loafBlockMax = 0; P.recording = true; };
  P.stop = () => { flush(); P.recording = false; };
  P.dump = () => ({
    n: P.n, ts: Array.from(P.ts.subarray(0, P.n)), draws: Array.from(P.draws.subarray(0, P.n)),
    tris: Array.from(P.tris.subarray(0, P.n)), script: Array.from(P.script.subarray(0, P.n)), off: Array.from(P.off.subarray(0, P.n)),
    vendor: P.vendor, snap: P.lastSnap,
    gl: {...P.gl}, contexts: P.contexts,
    long: {count: P.longCount, totalMs: P.longTotal, maxMs: P.longMax},
    loaf: {count: P.loafCount, blockingTotalMs: P.loafBlockTotal, blockingMaxMs: P.loafBlockMax},
  });
  // Pointer lock never works headless; force the drag-to-look fallback deterministically.
  HTMLCanvasElement.prototype.requestPointerLock = function () { return Promise.reject(new Error('perf gate')); };
})();
""" % MAX_FRAMES


def serve(dist: Path):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}/'


def pct(vals, q):
    if not vals: return None
    s = sorted(vals); k = (len(s) - 1) * q; f = int(k); c = min(f + 1, len(s) - 1)
    return s[f] + (s[c] - s[f]) * (k - f)


def stats(vals):
    if not vals: return {'n': 0}
    return {'n': len(vals), 'mean': round(sum(vals) / len(vals), 3), 'p50': round(pct(vals, .5), 3),
            'p95': round(pct(vals, .95), 3), 'p99': round(pct(vals, .99), 3), 'max': round(max(vals), 3)}


def heap(cdp, gc=True):
    if gc:
        cdp.send('HeapProfiler.collectGarbage'); cdp.send('HeapProfiler.collectGarbage')
    h = cdp.send('Runtime.getHeapUsage')
    m = {x['name']: x['value'] for x in cdp.send('Performance.getMetrics')['metrics']}
    return {'usedMB': round(h['usedSize'] / 1048576, 3), 'totalMB': round(h['totalSize'] / 1048576, 3),
            'nodes': m.get('Nodes'), 'listeners': m.get('JSEventListeners'), 'documents': m.get('Documents')}


def close_overlays(page):
    """Back to plain play: close inventory with Tab, any dialog with Escape."""
    for _ in range(3):
        s = page.evaluate("""(() => { const st = window.raftDebug?.state || {};
            const open = [...document.querySelectorAll('dialog')].some(d => d.open);
            return {inv: !!st.inventoryOpen, dlg: open}; })()""")
        if s['inv']: page.keyboard.press('Tab'); page.wait_for_timeout(150)
        elif s['dlg']: page.keyboard.press('Escape'); page.wait_for_timeout(150)
        else: return


def play_cycle(page, i, w, h):
    """One ~7 s slice of normal play. Uses only the hook slot so nothing gets built."""
    page.keyboard.press('1')
    page.keyboard.down('w'); page.wait_for_timeout(900); page.keyboard.up('w')
    page.keyboard.down('a' if i % 2 else 'd'); page.wait_for_timeout(500); page.keyboard.up('a' if i % 2 else 'd')
    # drag-to-look (pointer lock is stubbed off)
    x0, y0 = w // 2, h // 2; dx = (w // 6) if i % 2 else -(w // 6)
    page.mouse.move(x0, y0); page.mouse.down(button='right')
    for s in range(1, 9): page.mouse.move(x0 + dx * s / 8, y0 + (h // 36 if i % 3 else -h // 36) * s / 8); page.wait_for_timeout(40)
    page.mouse.up(button='right')
    # charge and throw the hook, let it fly, reel a bit
    page.mouse.move(x0, y0); page.mouse.down(); page.wait_for_timeout(700); page.mouse.up()
    page.wait_for_timeout(1400)
    page.mouse.down(); page.wait_for_timeout(1200); page.mouse.up()
    for k in '2341': page.keyboard.press(k); page.wait_for_timeout(120)
    if i % 3 == 0:
        page.keyboard.press('Tab'); page.wait_for_timeout(600)
    close_overlays(page)
    page.keyboard.down('s'); page.wait_for_timeout(500); page.keyboard.up('s')
    page.keyboard.press('Space'); page.wait_for_timeout(400)


def breakdown(snap):
    """One captured frame: where the draws and triangles go."""
    if not snap: return None
    on = [x for x in snap if not x[4]]; off = [x for x in snap if x[4]]
    tot = sum(x[0] for x in snap) or 1
    top = sorted(snap, key=lambda x: -x[0])[:10]
    return {'draws': len(snap), 'mainPass': len(on), 'offscreenPass': len(off),
            'trisMain': sum(x[0] for x in on), 'trisOffscreen': sum(x[0] for x in off),
            'tinyDraws(<=12 tris)': sum(1 for x in snap if x[0] <= 12),
            'instancedDraws': sum(1 for x in snap if x[2] > 1),
            'top10': [{'tris': x[0], 'count': x[1], 'instances': x[2], 'offscreen': bool(x[4]), 'shareOfFrame': round(x[0] / tot, 3)} for x in top]}


def check(metrics, budget):
    v = []
    def over(name, val, lim):
        if lim is None or val is None: return
        if val > lim: v.append({'metric': name, 'value': val, 'budget': lim})
    for key in ('drawCalls', 'offscreenDrawCalls', 'triangles', 'scriptMsPerFrame', 'frameIntervalMs'):
        for q, lim in (budget.get(key) or {}).items():
            over(f'{key}.{q}', metrics[key].get(q), lim)
    lt = budget.get('longTasks') or {}
    over('longTasks.count', metrics['longTasks']['count'], lt.get('count'))
    over('longTasks.maxMs', round(metrics['longTasks']['maxMs'], 1), lt.get('maxMs'))
    over('longTasks.perMinute', metrics['longTasks']['perMinute'], lt.get('perMinute'))
    g = metrics['growth']
    for key in ('heapMB', 'domNodes', 'listeners', 'glObjects'):
        over(f'growth.{key}', g[key], (budget.get('growth') or {}).get(key))
    over('webglContexts', metrics['webglContexts'], budget.get('webglContexts'))
    mf = budget.get('minFrames')
    if mf is not None and metrics['frames'] < mf:
        v.append({'metric': 'frames', 'value': metrics['frames'], 'budget': f'>= {mf}', 'note': 'too few frames recorded; render loop stalled or hook missed'})
    return v


def run(args):
    from playwright.sync_api import sync_playwright
    budget = json.loads(Path(args.budget).read_text('utf-8'))
    srv = None
    url = args.url or os.environ.get('RAFT_QA_URL')
    if not url:
        dist = Path(args.dist or os.environ.get('RAFT_DIST') or ROOT / 'dist').resolve()
        if not (dist / 'index.html').is_file(): raise SystemExit(f'no index.html in {dist}')
        srv, url = serve(dist)
    report = {'tool': 'perf_gate', 'url': url, 'durationS': args.duration, 'budgetFile': str(args.budget),
              'renderer': 'swiftshader', 'errors': [], 'console': []}
    t_start = time.time()
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(channel='chrome', headless=True,
                                  args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
            ctx = b.new_context(viewport={'width': args.width, 'height': args.height})
            ctx.add_init_script(INIT_JS)
            page = ctx.new_page()
            page.on('pageerror', lambda e: report['errors'].append(str(e)[:300]))
            page.on('console', lambda m: m.type == 'error' and report['console'].append(m.text[:300]))
            cdp = ctx.new_cdp_session(page)
            cdp.send('Performance.enable'); cdp.send('HeapProfiler.enable')
            page.goto(url); page.wait_for_function('!!window.raftDebug && !!window.__perf', timeout=30000)
            page.locator('#solo').click(); page.wait_for_function('raftDebug.state.running', timeout=20000)
            page.wait_for_timeout(int(args.warmup * 1000))
            close_overlays(page)
            h0 = heap(cdp); gl0 = page.evaluate('({...__perf.gl})')
            samples = [{'t': 0, **heap(cdp, gc=False)}]
            page.evaluate('__perf.start()')
            t0 = time.time(); i = 0; next_sample = 10
            while time.time() - t0 < args.duration:
                play_cycle(page, i, args.width, args.height); i += 1
                el = time.time() - t0
                if el >= next_sample:
                    samples.append({'t': round(el, 1), **heap(cdp, gc=False)}); next_sample += 10
            page.evaluate('__perf.snap = 1'); page.wait_for_timeout(1500)
            page.evaluate('__perf.stop()')
            recorded_s = time.time() - t0
            close_overlays(page); page.wait_for_timeout(500)
            d = page.evaluate('__perf.dump()')
            h1 = heap(cdp); samples.append({'t': round(time.time() - t0, 1), 'gc': True, **h1})
            report['endState'] = page.evaluate("""(() => { const s = raftDebug.state; return {items: s.items, tiles: s.tiles, collected: s.collected, inventoryOpen: s.inventoryOpen}; })()""")
            b.close()
    finally:
        if srv: srv.shutdown()

    report['glRenderer'] = d['vendor']
    ts = d['ts']; intervals = [b - a for a, b in zip(ts, ts[1:])]
    live0 = sum(gl0.values()); live1 = sum(d['gl'].values())
    metrics = {
        'frames': d['n'], 'recordedS': round(recorded_s, 1), 'fps': round(d['n'] / recorded_s, 2) if recorded_s else None,
        'playCycles': i,
        'drawCalls': stats(d['draws']), 'triangles': stats(d['tris']), 'scriptMsPerFrame': stats(d['script']),
        'offscreenDrawCalls': stats(d['off']),
        'frameIntervalMs': stats(intervals),
        'drawBreakdown': breakdown(d['snap']),
        'longTasks': {'count': d['long']['count'], 'totalMs': round(d['long']['totalMs'], 1), 'maxMs': round(d['long']['maxMs'], 1),
                      'perMinute': round(d['long']['count'] / (recorded_s / 60), 2) if recorded_s else None},
        'longAnimationFrames': {k: round(v, 1) for k, v in d['loaf'].items()},
        'heap': {'startMB': h0['usedMB'], 'endMB': h1['usedMB'], 'samples': samples},
        'growth': {'heapMB': round(h1['usedMB'] - h0['usedMB'], 3), 'domNodes': (h1['nodes'] or 0) - (h0['nodes'] or 0),
                   'listeners': (h1['listeners'] or 0) - (h0['listeners'] or 0), 'glObjects': live1 - live0,
                   'glByKind': {k: d['gl'][k] - gl0.get(k, 0) for k in d['gl']}},
        'glLiveObjects': d['gl'], 'webglContexts': d['contexts'],
    }
    report['metrics'] = metrics
    report['violations'] = check(metrics, budget)
    if report['errors']:
        report['violations'].append({'metric': 'pageErrors', 'value': len(report['errors']), 'budget': 0})
    report['ok'] = not report['violations']
    report['wallS'] = round(time.time() - t_start, 1)
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--url'); ap.add_argument('--dist')
    ap.add_argument('--duration', type=float, default=90.0, help='seconds of recorded play (default 90)')
    ap.add_argument('--warmup', type=float, default=4.0)
    ap.add_argument('--budget', default=str(DEFAULT_BUDGET))
    ap.add_argument('--out', default=str(ROOT / '.qa' / 'perf' / 'perf_gate.json'))
    # Small viewport on purpose: SwiftShader is fill-rate bound and draw/triangle/script metrics
    # do not depend on resolution, so this just buys more frames per second of wall time.
    ap.add_argument('--width', type=int, default=640); ap.add_argument('--height', type=int, default=360)
    args = ap.parse_args()
    try:
        report = run(args)
    except SystemExit: raise
    except Exception as e:  # harness failure, not a budget failure
        print(json.dumps({'tool': 'perf_gate', 'ok': False, 'harnessError': f'{type(e).__name__}: {e}'}))
        return 2
    out = Path(args.out); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=1), 'utf-8')
    summary = {k: report[k] for k in ('ok', 'violations', 'url', 'wallS')}
    summary['metrics'] = {k: v for k, v in report['metrics'].items() if k != 'heap'}
    summary['heap'] = {k: v for k, v in report['metrics']['heap'].items() if k != 'samples'}
    summary['out'] = str(out)
    print(json.dumps(summary, indent=1))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
