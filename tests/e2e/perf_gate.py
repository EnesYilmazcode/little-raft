"""Perf budget gate for Little Raft.

Plays a scripted solo session in headless Chromium (SwiftShader, via tests/e2e/harness.py) and
fails when the game goes over the budgets in tests/e2e/perf_budget.json.

Measured:
  * draw calls per frame: raftDebug.renderInfo (three.js renderer.info) when the game exposes it,
    otherwise every WebGL drawArrays/drawElements(/Instanced) call wrapped by an init script and
    bucketed per requestAnimationFrame. Triangles and offscreen-pass draws come from the wrapper.
  * JS heap growth: Runtime.getHeapUsage (+ performance.memory with --enable-precise-memory-info)
    sampled right after CDP HeapProfiler.collectGarbage at start, middle and end of the session.
    Those raw figures include V8 compiled code, which keeps growing for minutes (idle too) with no
    JS leak, so each of the three points also takes a heap snapshot (~2.5 s) and the late-half
    budget is on its JS-object total with 'code' and 'native' node types excluded (jsHeapMB*).
  * DOM element, listener and live WebGL object (create* minus delete*) growth. GL objects are
    counted per context; a lost context (loseContext()/forceContextLoss(), 'webglcontextlost')
    drops its objects. Growth sums the contexts live at the later sample (a lost one adds 0) and
    each post-GC point is the median of 7 reads over ~2 s (floating-item respawns swing VAOs).
    The late-half GL figure is min(mid->end, 3/4->end scaled to the half): steady growth only.
    Contexts: total created is reported; the budget is on the most live at once (webglContextsPeak).
  * long tasks (PerformanceObserver 'longtask') after warmup. Budgeted only as "hitches": tasks
    above max(hitchMinMs, hitchFactor x median long task), because on SwiftShader every frame is
    itself a long task and absolute frame times depend entirely on the box.
Hardware-independent metrics (draws, triangles, heap/DOM/GL growth) get strict-ish budgets;
time-based ones are reported (scriptMsPerFrame, frameIntervalMs, fps) but not budgeted.

Stability (so the gate does not flip on a loaded box):
  * Math.random and crypto.randomUUID are seeded (tests/e2e/seed_random.js, --seed, default 1), so
    the floating-supply mix and therefore draw calls repeat to within ~2% (unseeded: ~+-12%).
  * Warmup lasts until at least session.warmupFrames frames; recording is extended (up to
    session.maxExtendS) until minFrames frames are in. Still short: a gap > stallS with no frame is
    a game stall (exit 1), otherwise the box is just too slow (exit 2, infra).
  * Post-GC heap = lowest of three GC+read rounds.
  * Hitches are the one load-sensitive budget: if they are the only failure, one fresh session
    confirms it (--retries, default 1); a real hitch repeats, a CPU-steal spike does not.

Usage:
  python3.13 tests/e2e/perf_gate.py --dist <dist_dir> [--budget tests/e2e/perf_budget.json] [--out <dir>]
         [--duration S] [--warmup S] [--width W --height H]

Prints one JSON object as the last stdout line: {"tool","pass","failures","metrics","artifacts"}.
--out writes <dir>/perf_gate.json with the full report (heap samples, draw breakdown, budget).
Exit codes: 0 within budget, 1 over budget (game perf bug), 2 harness error (could not run).
See perf_budget.json "_calibration" for how the budgets were derived.
"""
import argparse, json, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DEFAULT_BUDGET = HERE / 'perf_budget.json'
MAX_FRAMES = 20000  # ring capacity; preallocated so recording never grows the heap
SEED_JS = (HERE / 'seed_random.js').read_text('utf-8')

INIT_JS = r"""
(() => {
  if (window.__perf) return;
  const CAP = %d;
  const P = window.__perf = {
    recording: false, n: 0, cap: CAP, total: 0,
    ts: new Float64Array(CAP), draws: new Float32Array(CAP), tris: new Float32Array(CAP), script: new Float32Array(CAP),
    curDraws: 0, curTris: 0, curScript: 0, curOff: 0, lastTs: -1, fb: null,
    off: new Float32Array(CAP), snap: 0, snapList: null, lastSnap: null, vendor: null,
    gl: {buffer: 0, texture: 0, program: 0, shader: 0, framebuffer: 0, renderbuffer: 0, vertexArray: 0},
    longCount: 0, longTotal: 0, longMax: 0, loafCount: 0, loafBlockMax: 0, loafBlockTotal: 0,
    contexts: 0, liveContexts: 0, contextsPeak: 0, lostContexts: 0, ctxList: [], longList: [], riCalls: new Float32Array(CAP), riSeen: 0, curRi: -1,
  };
  const ctxs = new WeakMap();
  const ctxRec = ctx => {
    let c = ctxs.get(ctx);
    if (!c) {
      c = {id: P.ctxList.length, size: ctx.canvas ? ctx.canvas.width + 'x' + ctx.canvas.height : '?', lost: false, gl: {}};
      for (const k of Object.keys(P.gl)) c.gl[k] = 0;
      ctxs.set(ctx, c); P.ctxList.push(c);
    }
    return c;
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
    proto[name] = function (...a) { fn.call(this, a); return orig.apply(this, a); };
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
      wrap(p, 'create' + K, function () { const c = ctxRec(this); if (c.lost) return; P.gl[k]++; c.gl[k]++; });
      wrap(p, 'delete' + K, function (a) { const c = ctxRec(this); if (!a[0] || c.lost) return; P.gl[k]--; c.gl[k]--; });
    }
  }
  // Live GL objects are kept per context. A lost context (WEBGL_lose_context.loseContext(), e.g.
  // three's forceContextLoss() on the item-icon renderer, or a 'webglcontextlost' event) frees all
  // of its objects without delete* calls, so its remaining count is subtracted from the live total.
  const lose = ctx => {
    const c = ctxRec(ctx); if (c.lost) return;
    c.lost = true; P.liveContexts--; P.lostContexts++;
    for (const k of Object.keys(c.gl)) { P.gl[k] -= c.gl[k]; c.gl[k] = 0; }
  };
  const ANGLE = 'ANGLE_instanced_arrays';
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    const origGetExt = C.prototype.getExtension;
    C.prototype.getExtension = function (name) {
      const ext = origGetExt.call(this, name);
      if (ext && name === ANGLE && !ext.__perf) {
        ext.__perf = 1;
        const da = ext.drawArraysInstancedANGLE, de = ext.drawElementsInstancedANGLE;
        ext.drawArraysInstancedANGLE = function (m, f, c, i) { add(m, c, i); return da.call(this, m, f, c, i); };
        ext.drawElementsInstancedANGLE = function (m, c, t, o, i) { add(m, c, i); return de.call(this, m, c, t, o, i); };
      }
      if (ext && name === 'WEBGL_lose_context' && !ext.__perf) {
        ext.__perf = 1; const gctx = this;
        const lc = ext.loseContext;
        ext.loseContext = function () { const r = lc.call(this); lose(gctx); return r; };
      }
      return ext;
    };
  }
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = origGetContext.call(this, type, ...rest);
    if (ctx && /webgl/.test(type) && !this.__perfCtx) {
      this.__perfCtx = 1; P.contexts++; P.liveContexts++; if (P.liveContexts > P.contextsPeak) P.contextsPeak = P.liveContexts;
      ctxRec(ctx);
      this.addEventListener('webglcontextlost', () => lose(ctx));
      this.addEventListener('webglcontextrestored', () => {
        const c = ctxRec(ctx); if (!c.lost) return;
        c.lost = false; P.liveContexts++; if (P.liveContexts > P.contextsPeak) P.contextsPeak = P.liveContexts;
      });
      if (!P.vendor) try { const e = ctx.getExtension('WEBGL_debug_renderer_info'); P.vendor = e ? ctx.getParameter(e.UNMASKED_RENDERER_WEBGL) : null; } catch (e) {}
    }
    return ctx;
  };
  // Frame boundary = a new rAF timestamp. Everything drawn since the previous boundary
  // belongs to the previous frame.
  const flush = () => {
    if (P.lastTs >= 0) P.total++;
    if (P.recording && P.lastTs >= 0 && P.n < CAP) {
      const i = P.n++; P.ts[i] = P.lastTs; P.draws[i] = P.curDraws; P.tris[i] = P.curTris; P.script[i] = P.curScript; P.off[i] = P.curOff; P.riCalls[i] = P.curRi;
    }
    if (P.snapList) { P.lastSnap = P.snapList; P.snapList = null; }
    if (P.snap > 0 && P.lastTs >= 0) { P.snap--; P.snapList = []; }
    P.curDraws = 0; P.curTris = 0; P.curScript = 0; P.curOff = 0; P.curRi = -1;
  };
  // Optional game hook: raftDebug.renderInfo (three.js renderer.info). Read after each rAF callback.
  const readRi = () => {
    try {
      const ri = window.raftDebug && window.raftDebug.renderInfo; if (!ri) return;
      const r = ri.render || ri; const c = +r.calls;
      if (Number.isFinite(c)) { P.riSeen = 1; P.curRi = Math.max(P.curRi, c); }
    } catch (e) {}
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return raf(ts => {
      if (ts !== P.lastTs) { flush(); P.lastTs = ts; }
      performance.mark('raft:frame:start');
      try { cb(ts); } finally {
        const m = performance.measure('raft:frame', 'raft:frame:start');
        P.curScript += m ? m.duration : 0;
        if (P.recording) readRi();
        performance.clearMarks('raft:frame:start'); performance.clearMeasures('raft:frame');
      }
    });
  };
  try {
    new PerformanceObserver(list => {
      if (!P.recording) return;
      for (const e of list.getEntries()) { if (P.longList.length < 5000) P.longList.push([e.startTime, e.duration]); }
    }).observe({type: 'longtask', buffered: false});
  } catch (e) {}
  try {
    new PerformanceObserver(list => {
      if (!P.recording) return;
      for (const e of list.getEntries()) { P.loafCount++; const b = e.blockingDuration || 0; P.loafBlockTotal += b; if (b > P.loafBlockMax) P.loafBlockMax = b; }
    }).observe({type: 'long-animation-frame', buffered: false});
  } catch (e) {}
  P.start = () => { P.n = 0; P.longList = []; P.t0 = performance.now(); P.loafCount = P.loafBlockTotal = P.loafBlockMax = 0; P.recording = true; };
  P.stop = () => { flush(); P.recording = false; };
  P.dump = () => ({
    n: P.n, ts: Array.from(P.ts.subarray(0, P.n)), draws: Array.from(P.draws.subarray(0, P.n)),
    tris: Array.from(P.tris.subarray(0, P.n)), script: Array.from(P.script.subarray(0, P.n)), off: Array.from(P.off.subarray(0, P.n)),
    vendor: P.vendor, snap: P.lastSnap,
    gl: {...P.gl}, contexts: P.contexts, contextsPeak: P.contextsPeak, liveContexts: P.liveContexts, lostContexts: P.lostContexts,
    glByContext: P.ctxList.map(c => ({id: c.id, size: c.size, lost: c.lost, live: Object.values(c.gl).reduce((a, b) => a + b, 0), gl: {...c.gl}})),
    long: P.longList.slice(), t0: P.t0, now: performance.now(),
    riSeen: P.riSeen, riCalls: P.riSeen ? Array.from(P.riCalls.subarray(0, P.n)) : null,
    loaf: {count: P.loafCount, blockingTotalMs: P.loafBlockTotal, blockingMaxMs: P.loafBlockMax},
  });
  // Pointer lock never works headless; force the drag-to-look fallback deterministically.
  HTMLCanvasElement.prototype.requestPointerLock = function () { return Promise.reject(new Error('perf gate')); };
})();
""" % MAX_FRAMES


def pct(vals, q):
    if not vals: return None
    s = sorted(vals); k = (len(s) - 1) * q; f = int(k); c = min(f + 1, len(s) - 1)
    return s[f] + (s[c] - s[f]) * (k - f)


def stats(vals):
    if not vals: return {'n': 0}
    return {'n': len(vals), 'mean': round(sum(vals) / len(vals), 3), 'p50': round(pct(vals, .5), 3),
            'p95': round(pct(vals, .95), 3), 'p99': round(pct(vals, .99), 3), 'max': round(max(vals), 3)}


GL_WINDOW = (7, 300)  # live-GL reads per post-GC sample point and ms between them; the median is used
SNAPSHOT_EXCLUDE = ('code', 'native')


def snapshot_sizes(cdp, chunks):
    """Full V8 heap snapshot (it collects garbage first), summed self_size per node type in MB.
    ~2 s capture + ~0.5 s parse for the game's ~35 MB snapshot on SwiftShader."""
    chunks.clear(); t = time.time()
    cdp.send('HeapProfiler.takeHeapSnapshot', {'reportProgress': False})
    s = json.loads(''.join(chunks)); chunks.clear()
    meta = s['snapshot']['meta']; nf = meta['node_fields']; names = meta['node_types'][0]
    w, ti, si, n = len(nf), nf.index('type'), nf.index('self_size'), s['nodes']
    sums = [0] * len(names)
    for i in range(0, len(n), w): sums[n[i + ti]] += n[i + si]
    out = {names[k]: round(v / 1048576, 3) for k, v in enumerate(sums) if v}
    return out, round(time.time() - t, 2)


GL_READ = '__perf.ctxList.filter(c => !c.lost).map(c => [c.id, {...c.gl}])'


def gl_window(page, n=1, ms=0):
    """Live GL objects per live context {ctxId: {kind: n}}, each the median of n reads ms apart:
    floating-item respawns swing live buffers/VAOs by tens within seconds, so a single read lands
    on a random high or low point."""
    reads = []
    for j in range(n):
        if j: page.wait_for_timeout(ms)
        reads.append({str(i): g for i, g in page.evaluate(GL_READ)})
    tot = [sum(sum(g.values()) for g in r.values()) for r in reads]
    last = reads[-1]  # a context lost mid-window is gone
    med = {i: {k: round(pct([r[i][k] for r in reads if i in r], .5)) for k in g} for i, g in last.items()}
    return med, [min(tot), max(tot)]


def gl_growth(a, b):
    """Live GL growth from sample a to b, per context: a context lost in between freed its objects
    with the context, so it adds 0 (not minus its count, which would hide growth elsewhere); a
    context created in between adds all it holds."""
    kinds = {}
    for i, g in b.items():
        for k, v in g.items(): kinds[k] = kinds.get(k, 0) + v - a.get(i, {}).get(k, 0)
    return sum(kinds.values()), kinds


def heap(page, cdp, gc=True, chunks=None):
    """Heap sample. With gc=True, forces two full GCs over CDP first and returns the page-clock
    window the GC took so long tasks it caused can be excluded; live GL objects are then the
    median of a short window (gl_window). With chunks (a list receiving
    HeapProfiler.addHeapSnapshotChunk), also takes a heap snapshot and reports jsObjMB: the heap
    without V8 compiled code ('code': bytecode, feedback, optimised code, which keeps growing for
    minutes of play, idle included, with no JS leak) and 'native' (backing stores/embedder)."""
    w0 = page.evaluate('performance.now()')
    if gc:
        # The game keeps rendering between CDP calls, so a frame's garbage can land between the
        # GC and the read. Take the lowest of three GC+read rounds: that is the retained heap.
        h = None
        for _ in range(3):
            cdp.send('HeapProfiler.collectGarbage')
            x = cdp.send('Runtime.getHeapUsage')
            if h is None or x['usedSize'] < h['usedSize']: h = x
    else:
        h = cdp.send('Runtime.getHeapUsage')
    snap = snap_s = None
    if chunks is not None: snap, snap_s = snapshot_sizes(cdp, chunks)
    w1 = page.evaluate('performance.now()')
    glCtx, glRange = gl_window(page, *GL_WINDOW) if gc else gl_window(page)
    pm, domNow = page.evaluate('[performance.memory ? performance.memory.usedJSHeapSize : null, document.getElementsByTagName("*").length]')
    m = {x['name']: x['value'] for x in cdp.send('Performance.getMetrics')['metrics']}
    r = {'usedMB': round(h['usedSize'] / 1048576, 3), 'totalMB': round(h['totalSize'] / 1048576, 3),
         'perfMemoryMB': round(pm / 1048576, 3) if pm else None,
         'glLive': sum(sum(g.values()) for g in glCtx.values()), 'glByCtx': glCtx, 'glLiveRange': glRange if gc else None, 'domInTree': domNow, 'nodes': m.get('Nodes'), 'listeners': m.get('JSEventListeners'), 'documents': m.get('Documents'),
         'gc': gc, '_win': (w0, w1 + 50)}
    if snap is not None:
        r['jsObjMB'] = round(sum(v for k, v in snap.items() if k not in SNAPSHOT_EXCLUDE), 3)
        r['codeMB'] = snap.get('code', 0); r['nativeMB'] = snap.get('native', 0)
        r['snapshotMB'] = snap; r['snapshotS'] = snap_s
    return r


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


SESSION = ('open {url}, click #solo, wait {warmup:g}s warmup, then for {duration:g}s repeat a ~8s cycle: '
           'press 1 (hook), hold W 0.9s, hold A/D 0.5s, right-drag to look, hold LMB 0.7s to throw the hook, wait 1.4s, '
           'hold LMB 1.2s to reel, press 2,3,4,1, every 3rd cycle Tab (inventory) then Tab to close, hold S 0.5s, Space; '
           'viewport {width}x{height}, SwiftShader Chromium, {seedtxt}. '
           'Rerun: python3.13 tests/e2e/perf_gate.py --dist {dist}{seedarg} --out <dir> (full samples in <dir>/perf_gate.json)')


def get(d, path):
    for k in path.split('.'):
        if not isinstance(d, dict) or k not in d: return None
        d = d[k]
    return d


# (metric path in metrics, budget path in budget json, human explanation)
CHECKS = [
    ('drawCalls.p50', 'drawCalls.p50', 'median WebGL draw calls per frame'),
    ('drawCalls.p95', 'drawCalls.p95', '95th percentile WebGL draw calls per frame'),
    ('drawCalls.max', 'drawCalls.max', 'worst-frame WebGL draw calls'),
    ('triangles.p95', 'triangles.p95', '95th percentile triangles per frame'),
    ('growth.heapMB', 'growth.heapMB', 'JS heap growth (post-GC end minus post-GC start)'),
    ('growth.heapMBLateHalf', 'growth.heapMBLateHalf', 'raw JS heap growth over the second half (post-GC mid to end; includes V8 compiled code)'),
    ('growth.jsHeapMBLateHalf', 'growth.jsHeapMBLateHalf', 'heap-snapshot JS object growth over the second half (V8 code and native excluded); steady growth here is a leak'),
    ('growth.domNodes', 'growth.domNodes', 'growth of elements in the document tree'),
    ('growth.listeners', 'growth.listeners', 'JS event listener growth after GC'),
    ('growth.glObjects', 'growth.glObjects', 'live WebGL object growth (create* minus delete*)'),
    ('growth.glObjectsLateHalf', 'growth.glObjectsLateHalf', 'steady live WebGL object growth over the second half: min(mid->end, 3/4->end scaled to the half), so one-off first-use steps are excluded; steady growth is a GPU leak'),
    ('webglContexts', 'webglContexts', 'WebGL contexts created in total'),
    ('webglContextsPeak', 'webglContextsPeak', 'most WebGL contexts live at once (lost contexts excluded)'),
    ('longTasks.hitches', 'longTasks.hitches', 'main-thread hitches after warmup: tasks longer than max(hitchMinMs, hitchFactor x median long task) (forced-GC windows excluded)'),
]


LOAD_SENSITIVE = {'budget.longTasks.hitches'}


def check(metrics, budget, repro):
    fails = []
    for mpath, bpath, what in CHECKS:
        val, lim = get(metrics, mpath), get(budget, bpath)
        if lim is None or val is None: continue
        if val > lim:
            fid = 'budget.' + mpath
            extra = ''
            if mpath.startswith('growth.heap'):
                extra = ' heap samples (t s: MB): ' + ', '.join(f"{x['t']}:{x['usedMB']}{'*' if x['gc'] else ''}" for x in metrics['heap']['samples']) + ' (* = after forced GC)'
            if mpath.startswith('growth.jsHeap'):
                extra = ' snapshot JS objects (t s: MB, code MB): ' + ', '.join(f"{x['t']}:{x['jsObjMB']} ({x['codeMB']})" for x in metrics['heap']['samples'] if 'jsObjMB' in x) + '; by node type in <out>/perf_gate.json heap.samples[].snapshotMB'
            if mpath.startswith('longTasks'):
                extra = ' worst tasks (start s after warmup, ms): ' + ', '.join(f'{t}:{d}' for t, d in metrics['longTasks']['worst'])
            if mpath.startswith(('drawCalls', 'triangles')) and metrics.get('drawBreakdown'):
                bd = metrics['drawBreakdown']
                extra = f" last-frame split: {bd['mainPass']} main-pass + {bd['offscreenPass']} offscreen-pass draws, {bd['tinyDraws(<=12 tris)']} draws of <=12 tris."
            if mpath.startswith('growth.glObjects'):
                extra = ' by kind: ' + json.dumps(metrics['growth']['glByKind']) + ' by context at end: ' + json.dumps([{k: c[k] for k in ('id', 'size', 'lost', 'live')} for c in metrics['glByContext']])
            fails.append({'id': fid, 'detail': f'{what}: {val} > budget {lim}.{extra}', 'repro': repro})
    mf = budget.get('minFrames')
    if mf is not None and metrics['frames'] < mf:
        # Too few frames even after extending the session. A real stall shows up as a long gap
        # with no frame at all; uniformly slow frames just mean the box is overloaded (infra).
        gap = max((metrics['frameIntervalMs'].get('max') or 0) / 1000, metrics.get('tailGapS') or 0)
        stall_s = budget.get('stallS', 20)
        if metrics['frames'] < 2 or gap > stall_s:
            fails.append({'id': 'frames', 'detail': f"only {metrics['frames']} frames recorded (< {mf}) in {metrics['recordedS']} s, longest gap between frames {gap:.1f} s (> {stall_s} s): render loop stalled", 'repro': repro})
        else:
            raise InsufficientFrames(f"only {metrics['frames']} frames in {metrics['recordedS']} s (< minFrames {mf}) with no stall (longest gap {gap:.1f} s): box too slow for stable percentiles; rerun when it is less loaded")
    return fails


class InsufficientFrames(RuntimeError):
    pass


class GameBootFailure(RuntimeError):
    """The game threw while booting/starting: a game bug (exit 1), not infra."""
    def __init__(self, failure):
        super().__init__(failure['detail']); self.failure = failure


def boot(page, url, report, repro):
    """Load the page and start a solo game. Raises GameBootFailure (exit 1) when the game threw
    uncaught errors on the way, otherwise RuntimeError with the step that failed (exit 2)."""
    steps = [
        ('load page', lambda: page.goto(url, timeout=120000)),
        ('wait for window.raftDebug', lambda: page.wait_for_function('!!window.raftDebug && !!window.__perf', timeout=120000)),
        ('click start', lambda: page.locator('.ob-item[data-act="new"]:visible, #newGame:visible, #solo:visible').first.click(timeout=60000)),
        ('wait for raftDebug.state.running', lambda: page.wait_for_function('!!(window.raftDebug && raftDebug.state && raftDebug.state.running)', timeout=120000)),
    ]
    for name, fn in steps:
        try:
            fn()
        except Exception as e:
            msg = f'boot step "{name}" failed: {type(e).__name__}: {str(e).splitlines()[0][:200] if str(e) else ""}'
            try: err = page.evaluate("(document.getElementById('loadError') || {}).textContent || ''")
            except Exception: err = ''
            if err: msg += f'; #loadError says: {err[:200]}'
            # The live.js loader catches game.js errors and console.error()s them, so console errors
            # count too. They (or #loadError) only blame the game when WebGL itself works here;
            # no WebGL on the box is infra.
            try: webgl = page.evaluate("(() => { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); })()")
            except Exception: webgl = False
            errs = report['errors'] + report['console']
            if errs or err: msg += f"; {len(report['errors'])} uncaught page error(s), {len(report['console'])} console error(s), first: {(errs or [err])[0]}"
            if webgl and (errs or err):
                raise GameBootFailure({'id': 'boot', 'detail': msg + ' (WebGL works in this browser, so the game failed to start)', 'repro': repro})
            if not webgl: msg += ' (WebGL unavailable in this browser)'
            raise RuntimeError(msg + ' (no page errors: harness/timeout, or this build lacks the hook the gate drives)')


def run(args, budget):
    sys.path.insert(0, str(HERE))
    from harness import StaticServer, launch_chromium
    from playwright.sync_api import sync_playwright
    dist = Path(args.dist).resolve()
    if not (dist / 'index.html').is_file(): raise RuntimeError(f'no index.html in {dist}')
    report = {'errors': [], 'console': []}
    sess = budget.get('session') or {}
    with StaticServer(dist) as srv, sync_playwright() as p:
        repro = SESSION.format(dist=dist, url=f'{dist}/index.html (served over http)', warmup=args.warmup, duration=args.duration, width=args.width, height=args.height,
                               seedtxt=f'Math.random seeded with {args.seed} (mulberry32, tests/e2e/seed_random.js)' if args.seed is not None else 'unseeded Math.random',
                               seedarg='' if args.seed == 1 else (' --no-seed' if args.seed is None else f' --seed {args.seed}'))
        b = launch_chromium(p, extra_args=['--enable-precise-memory-info'])
        try:
            ctx = b.new_context(viewport={'width': args.width, 'height': args.height})
            if args.seed is not None:
                ctx.add_init_script(SEED_JS.replace('__SEED__', str(int(args.seed))))
            ctx.add_init_script(INIT_JS)
            page = ctx.new_page()
            page.on('pageerror', lambda e: report['errors'].append(str(e)[:300]))
            page.on('console', lambda m: m.type == 'error' and report['console'].append(m.text[:300]))
            cdp = ctx.new_cdp_session(page)
            cdp.send('Performance.enable'); cdp.send('HeapProfiler.enable')
            chunks = []; cdp.on('HeapProfiler.addHeapSnapshotChunk', lambda e: chunks.append(e['chunk']))
            boot(page, srv.url, report, repro)
            page.wait_for_timeout(int(args.warmup * 1000))
            # On a very loaded box 6 s can be only a handful of frames; make sure first-frame
            # shader compiles and buffer uploads are done before the baseline heap/GL sample.
            warm_frames = int(sess.get('warmupFrames', 15)); tw = time.time()
            while page.evaluate('__perf.total') < warm_frames and time.time() - tw < 90:
                page.wait_for_timeout(500)
            close_overlays(page)
            page.evaluate('__perf.start()')
            t0 = time.time()
            h0 = heap(page, cdp, chunks=chunks); h0['t'] = 0.0
            samples = [h0]; i = 0; next_sample = 10; mid = q3 = None
            # Record for --duration, and keep playing (up to maxExtendS more) while fewer than
            # minFrames frames are in, so a slow box yields enough samples instead of a flaky fail.
            min_frames = int(budget.get('minFrames') or 0); extend_s = float(sess.get('maxExtendS', 120))
            el = 0.0
            while el < args.duration or (page.evaluate('__perf.n') < min_frames and el < args.duration + extend_s):
                play_cycle(page, i, args.width, args.height); i += 1
                el = time.time() - t0
                if mid is None and el >= args.duration / 2:
                    close_overlays(page); mid = heap(page, cdp, chunks=chunks); mid['t'] = round(el, 1); samples.append(mid)
                elif mid is not None and q3 is None and el >= args.duration * .75:
                    close_overlays(page); q3 = heap(page, cdp); q3['t'] = round(el, 1); samples.append(q3)
                elif el >= next_sample:
                    x = heap(page, cdp, gc=False); x['t'] = round(el, 1); samples.append(x)
                if el >= next_sample: next_sample += 10
            page.evaluate('__perf.snap = 1'); page.wait_for_timeout(1500)
            close_overlays(page); page.wait_for_timeout(500)
            h1 = heap(page, cdp, chunks=chunks); h1['t'] = round(time.time() - t0, 1); samples.append(h1)
            page.evaluate('__perf.stop()')
            d = page.evaluate('__perf.dump()')
            report['endState'] = page.evaluate("""(() => { const s = window.raftDebug?.state || {}; return {running: s.running, items: s.items, tiles: s.tiles, collected: s.collected, inventoryOpen: s.inventoryOpen, stock: s.stock}; })()""")
        finally:
            b.close()

    recorded_s = (d['now'] - d['t0']) / 1000
    gcwins = [x['_win'] for x in samples if x['gc']]
    for x in samples: x.pop('_win', None)
    longs = [(st, du) for st, du in d['long'] if not any(st < w1 and st + du > w0 for w0, w1 in gcwins)]
    ts = d['ts']; intervals = [b - a for a, b in zip(ts, ts[1:])]
    # GL growth from the windowed medians at the post-GC sample points (start, mid, end).
    gl_all, gl_kinds = gl_growth(h0['glByCtx'], h1['glByCtx'])
    # Late-half GL growth is meant to catch steady growth (a leak). A one-off first-use step in the
    # third quarter (first catch of an item kind builds its meshes/shader variant; whether the hook
    # catches anything depends on box timing) is not one, so it is also measured from the 3/4
    # point and scaled to the half: a steady leak scores the same both ways, a step only once.
    gl_late = gl_q3 = gl_q3_scaled = None
    if mid:
        gl_late = gl_growth(mid['glByCtx'], h1['glByCtx'])[0]
        span, tail = h1['t'] - mid['t'], h1['t'] - (q3['t'] if q3 else h1['t'])
        if q3 and span > 0 and tail >= .3 * span:
            gl_q3 = gl_growth(q3['glByCtx'], h1['glByCtx'])[0]; gl_q3_scaled = round(gl_q3 * span / tail)
    # SwiftShader rasterises on the CPU and the main thread waits for it, so on a slow box every
    # frame is itself a 200-300 ms "long task". A hitch is a task far above that baseline.
    lt = budget.get('longTasks') or {}
    med = pct([x for _, x in longs], .5) or 0
    hitch_ms = round(max(lt.get('hitchMinMs', 500), lt.get('hitchFactor', 4) * med), 1)
    # Budgets are calibrated on the WebGL wrapper count (every real draw, all passes). A branch
    # that starts exposing raftDebug.renderInfo must not silently switch the budgeted metric
    # (three.js info only covers the last render() and may not auto-reset), so it is info only.
    draws = d['draws']
    metrics = {
        'frames': d['n'], 'recordedS': round(recorded_s, 1), 'fps': round(d['n'] / recorded_s, 2) if recorded_s else None,
        'playCycles': i, 'drawCallSource': 'webgl-wrap',
        'renderInfoCalls': stats(d['riCalls']) if d['riSeen'] else None,
        'drawCalls': stats(draws), 'webglDrawCalls': stats(d['draws']), 'triangles': stats(d['tris']),
        'offscreenDrawCalls': stats(d['off']),
        'scriptMsPerFrame': stats(d['script']), 'frameIntervalMs': stats(intervals),
        'tailGapS': round((d['now'] - (ts[-1] if ts else d['t0'])) / 1000, 1),
        'drawBreakdown': breakdown(d['snap']),
        'longTasks': {'count': len(longs), 'hitchThresholdMs': hitch_ms, 'hitches': sum(1 for _, x in longs if x > hitch_ms), 'over200ms': sum(1 for _, x in longs if x > 200), 'over500ms': sum(1 for _, x in longs if x > 500),
                      'maxMs': round(max((x for _, x in longs), default=0), 1), 'totalMs': round(sum(x for _, x in longs), 1),
                      'blockedShare': round(sum(x for _, x in longs) / (recorded_s * 1000), 3) if recorded_s else None,
                      'excludedGcTasks': len(d['long']) - len(longs),
                      'worst': [[round((st - d['t0']) / 1000, 1), round(du)] for st, du in sorted(longs, key=lambda e: -e[1])[:5]]},
        'longAnimationFrames': {k: round(v, 1) for k, v in d['loaf'].items()},
        'heap': {'startMB': h0['usedMB'], 'midMB': mid['usedMB'] if mid else None, 'endMB': h1['usedMB'],
                 'jsObjStartMB': h0['jsObjMB'], 'jsObjMidMB': mid['jsObjMB'] if mid else None, 'jsObjEndMB': h1['jsObjMB'],
                 'codeStartMB': h0['codeMB'], 'codeEndMB': h1['codeMB'], 'nativeStartMB': h0['nativeMB'], 'nativeEndMB': h1['nativeMB'],
                 'snapshotS': [x['snapshotS'] for x in samples if 'snapshotS' in x],
                 'perfMemoryStartMB': h0['perfMemoryMB'], 'perfMemoryEndMB': h1['perfMemoryMB'], 'samples': samples},
        'growth': {'heapMB': round(h1['usedMB'] - h0['usedMB'], 3),
                   'heapMBLateHalf': round(h1['usedMB'] - mid['usedMB'], 3) if mid else None,
                   'jsHeapMB': round(h1['jsObjMB'] - h0['jsObjMB'], 3),
                   'jsHeapMBLateHalf': round(h1['jsObjMB'] - mid['jsObjMB'], 3) if mid else None,
                   'codeMB': round(h1['codeMB'] - h0['codeMB'], 3), 'nativeMB': round(h1['nativeMB'] - h0['nativeMB'], 3),
                   'glObjectsLateHalf': min(gl_late, gl_q3_scaled) if gl_q3_scaled is not None else gl_late,
                   'glObjectsMidToEnd': gl_late, 'glObjectsQ3ToEnd': gl_q3, 'glObjectsQ3ToEndScaled': gl_q3_scaled,
                   'domNodes': h1['domInTree'] - h0['domInTree'],
                   'allNodes': (h1['nodes'] or 0) - (h0['nodes'] or 0), 'documents': (h1['documents'] or 0) - (h0['documents'] or 0),
                   'listeners': (h1['listeners'] or 0) - (h0['listeners'] or 0), 'glObjects': gl_all, 'glByKind': gl_kinds},
        'glLiveObjects': d['gl'], 'glByContext': d['glByContext'],
        'webglContexts': d['contexts'], 'webglContextsPeak': d['contextsPeak'], 'webglContextsLost': d['lostContexts'], 'glRenderer': d['vendor'],
        'endState': report['endState'],
    }
    fails = check(metrics, budget, repro)
    if report['errors']:
        fails.append({'id': 'pageErrors', 'detail': f"{len(report['errors'])} uncaught page error(s), first: {report['errors'][0]}", 'repro': repro})
    return metrics, fails, report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dist', default=str(ROOT / 'dist'), help='built game folder containing index.html (any path)')
    ap.add_argument('--budget', default=str(DEFAULT_BUDGET))
    ap.add_argument('--out', help='artifact dir; writes perf_gate.json (full report with per-sample heap) there')
    ap.add_argument('--duration', type=float, default=None, help='seconds of recorded play (default from budget, else 90)')
    ap.add_argument('--warmup', type=float, default=None, help='seconds of idle play before recording (default from budget, else 6)')
    # Small viewport on purpose: SwiftShader is fill-rate bound and draw/triangle/heap metrics
    # do not depend on resolution, so this just buys more frames per second of wall time.
    ap.add_argument('--seed', type=int, default=1, help='seed for Math.random/crypto.randomUUID (makes the floating-supply mix repeatable); --no-seed for the real RNG')
    ap.add_argument('--no-seed', dest='seed', action='store_const', const=None)
    ap.add_argument('--retries', type=int, default=1, help='fresh sessions to confirm a failure that is only in load-sensitive budgets (hitches); 0 = report attempt 1')
    ap.add_argument('--width', type=int, default=640); ap.add_argument('--height', type=int, default=360)
    args = ap.parse_args()
    t_start = time.time()
    out = {'tool': 'perf_gate', 'pass': False, 'failures': [], 'metrics': {}, 'artifacts': []}
    try:
        budget = json.loads(Path(args.budget).read_text('utf-8'))
        if args.duration is None: args.duration = float(budget.get('session', {}).get('durationS', 90))
        if args.warmup is None: args.warmup = float(budget.get('session', {}).get('warmupS', 6))
        metrics, fails, report = run(args, budget)
        # Hitches are the only budget that host load can move (another process stealing the CPU
        # for 2-3 s looks exactly like a game hitch). When they are the only failure, confirm with
        # one fresh session: a game hitch repeats, a load spike usually does not.
        if fails and all(f['id'] in LOAD_SENSITIVE for f in fails) and args.retries > 0:
            first = {'failures': fails, 'longTasks': metrics['longTasks'], 'frames': metrics['frames']}
            metrics, fails, report = run(args, budget)
            metrics['retry'] = {'reason': 'only load-sensitive budgets failed on attempt 1; attempt 2 is the result', 'attempt1': first}
            for f in fails:
                if f['id'] in LOAD_SENSITIVE: f['detail'] += f" (reproduced on a second session; attempt 1: {first['longTasks']['hitches']} hitches over {first['longTasks']['hitchThresholdMs']} ms)"
        metrics['wallS'] = round(time.time() - t_start, 1)
        out['pass'] = not fails; out['failures'] = fails
        if args.out:
            od = Path(args.out); od.mkdir(parents=True, exist_ok=True)
            f = od / 'perf_gate.json'
            f.write_text(json.dumps({**out, 'metrics': metrics, 'budget': budget, 'errors': report['errors'], 'console': report['console']}, indent=1), 'utf-8')
            out['artifacts'].append(str(f))
        slim = {k: v for k, v in metrics.items() if k not in ('heap', 'drawBreakdown', 'longAnimationFrames', 'glLiveObjects', 'glByContext')}
        slim['heap'] = {k: v for k, v in metrics['heap'].items() if k != 'samples'}
        out['metrics'] = slim
    except GameBootFailure as e:  # the game itself broke before it could be measured
        out['pass'] = False; out['failures'] = [e.failure]
        out['metrics'] = {'wallS': round(time.time() - t_start, 1)}
        print(json.dumps(out)); return 1
    except Exception as e:  # harness failure, not a budget failure
        out['pass'] = False
        out['failures'] = [{'id': 'harness', 'detail': f'{type(e).__name__}: {str(e)[:500]}', 'repro': f'python3.13 tests/e2e/perf_gate.py --dist {args.dist}'}]
        out['metrics'] = {'wallS': round(time.time() - t_start, 1)}
        print(json.dumps(out)); return 2
    print(json.dumps(out))
    return 0 if out['pass'] else 1


if __name__ == '__main__':
    sys.exit(main())
