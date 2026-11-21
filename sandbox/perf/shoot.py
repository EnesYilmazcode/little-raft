"""Profile the REAL game headlessly and A/B each perf fix.

Usage: python sandbox/perf/shoot.py [--dist DIR] [--only a,b] [--frames N] [--dsf 1] [--no-cdp] [--out DIR]
  --dist   game directory to serve (default: repo dist/). Point it at a patched copy to verify perf-ADOPT.md.
  --only   comma list of scenario names (default: all)
  --dsf    deviceScaleFactor (2 emulates a hi-dpi laptop: the game then renders at pixelRatio 1.7)
Writes PNGs to sandbox/perf/shots/ and sandbox/perf/results.json, prints the same JSON.
SwiftShader renders on the CPU: compare scenarios to each other, never to a real GPU.
"""
import re, sys, json, threading, functools, http.server, socketserver, argparse, shutil, os
from pathlib import Path
from collections import defaultdict
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ap = argparse.ArgumentParser()
ap.add_argument('--dist', default=str(ROOT / 'dist'))
ap.add_argument('--only', default='')
ap.add_argument('--frames', type=int, default=24)
ap.add_argument('--dsf', type=float, default=1)
ap.add_argument('--no-cdp', action='store_true')
ap.add_argument('--out', default=str(HERE / 'shots'))
ap.add_argument('--json', default=str(HERE / 'results.json'))
ap.add_argument('--tag', default='')
ap.add_argument('--look', type=int, default=0, help='mouse pixels to look down after spawn (pointer lock works headless): 400 = feet')
ap.add_argument('--append', action='store_true', help='keep scenarios already in --json')
ap.add_argument('--freeze', type=int, default=40, help='game clock stops this many frames after Play (deterministic scene); -1 = live clock')
ap.add_argument('--big', action='store_true', help='late-game save: 7x7 deck (49 tiles) with 12 decorations')
args = ap.parse_args()
dist = Path(args.dist).resolve(); out = Path(args.out); out.mkdir(parents=True, exist_ok=True)

# Serve a temp root: /game -> dist dir, /perf -> this sandbox (fixes.js), /vendor-shared not needed.
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def translate_path(self, path):
        p = path.split('?', 1)[0].split('#', 1)[0]
        if p.startswith('/perf/'): return str(HERE / p[len('/perf/'):])
        if p.startswith('/game/'): return str(dist / p[len('/game/'):])
        return str(dist / 'nonexistent')
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
socketserver.ThreadingTCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), Q)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_address[1]}'
PROBE = (HERE / 'probe.js').read_text()

# name -> JS run after the game is running (receives F = fixes module, P = window.__perf)
SCENARIOS = {
    'baseline':        '',
    'shadows-off':     'P.R.renderer.shadowMap.enabled = false;',
    'items-no-shadow': 'F.itemsNoShadow(P);',
    'shadow-fit':      'F.shadowFit(P);',
    'shadow-10hz':     'F.shadowCadence(P, 10);',
    'merge-scenery':   'F.mergeScenery(P);',
    'merge-raft':      'F.mergeRaft(P);',
    'dpr-0.75':        'P.R.renderer.setPixelRatio(0.75);',
    # bisection (diagnostic only, changes looks): hide one owner at a time
    'hide-items':      "P.R.scene.children.filter(o => o.isGroup && o.children.some(c => c.userData?.token)).forEach(o => o.visible = false);",
    'hide-ocean':      "P.R.scene.getObjectByName('ocean').visible = false;",
    'hide-viewmodels': "P.R.camera.children.forEach(o => o.visible = false); P.R.camera.children.forEach(o => Object.defineProperty(o, 'visible', {get: () => false, set() {}}));",
    'hide-raft':       "P.R.scene.children.filter(o => o.isGroup && o.children.some(c => c.name === 'raft-floor')).forEach(o => o.visible = false);",
    'wood-no-bump':    "F.woodMaterials(P).forEach(m => { m.bumpMap = null; m.needsUpdate = true; });",
    'wood-aniso-1':    "F.woodMaterials(P).forEach(m => { m.map.anisotropy = 1; m.map.needsUpdate = true; });",
    'wood-bump-aniso1': "F.woodBumpCheap(P);",
    'raft-no-receive': "P.R.scene.children.filter(o => o.isGroup && o.children.some(c => c.name === 'raft-floor')).forEach(o => o.traverse(c => { c.receiveShadow = false; }));",
    'all-safe':        'F.itemsNoShadow(P); F.shadowFit(P); F.mergeScenery(P); F.mergeRaft(P); F.woodBumpCheap(P);',
    'baseline-2':      '',
}
only = [s for s in args.only.split(',') if s] or list(SCENARIOS)

TICK = os.sysconf('SC_CLK_TCK')
def tree_cpu():
    """CPU seconds used so far by every chrome process under this python process, by --type.
    Wall-clock timings are useless when other agents load the machine (load avg 30 on 4 cores); CPU time is not."""
    kids = defaultdict(list); info = {}
    for d in os.listdir('/proc'):
        if not d.isdigit(): continue
        try:
            st = open(f'/proc/{d}/stat').read(); rest = st[st.rindex(')') + 2:].split()
            ppid, ut, stt = int(rest[1]), int(rest[11]), int(rest[12])
            cmd = open(f'/proc/{d}/cmdline', 'rb').read().replace(b'\0', b' ').decode('latin1')
        except Exception: continue
        mt = re.search(r'--type=(\S+)', cmd)
        typ = mt.group(1) if mt else ('browser' if 'chrome' in cmd.split(' ')[0] else 'other')
        kids[ppid].append(int(d)); info[int(d)] = (typ, (ut + stt) / TICK)
    out = defaultdict(float); stack = [os.getpid()]
    while stack:
        pid = stack.pop()
        for k in kids.get(pid, []):
            stack.append(k); t, c = info[k]
            if t != 'other': out[t] += c
    return out

def measure(page, n):
    c0 = tree_cpu(); r = page.evaluate(f'__perf.measure({n})'); c1 = tree_cpu()
    fr = r['frames'] + 10  # probe warm-up frames are inside the CPU window too
    r['cpuMsPerFrame'] = {k: round(1000 * (c1[k] - c0.get(k, 0)) / fr, 1) for k in c1 if c1[k] - c0.get(k, 0) > 0}
    r['cpuMsPerFrame']['total'] = round(sum(r['cpuMsPerFrame'].values()), 1)
    return r

def start_game(b):
    ctx = b.new_context(viewport={'width': 1280, 'height': 720}, device_scale_factor=args.dsf)
    if args.freeze >= 0: ctx.add_init_script(f'window.__perfFreezeAt = {args.freeze};')
    ctx.add_init_script(PROBE)
    if args.big:
        decor = [{'type': t, 'x': x, 'z': z} for (t, x, z) in [('sail', 0, 2), ('palm', -2, -2), ('lantern', 2, -2), ('net', 3, 3), ('bench', -3, 1), ('crate', 2, 1),
                 ('crate', -1, 3), ('lantern', -3, -3), ('palm', 3, -1), ('bench', 1, -3), ('net', -3, 3), ('sail', -2, 0)]]
        world = {'tiles': [[x, z] for x in range(-3, 4) for z in range(-3, 4)], 'decor': decor, 'stock': {}, 'fish': 0, 'collected': 0}
        ctx.add_init_script("try { localStorage.setItem('little-raft-v1', %s) } catch (e) {}" % json.dumps(json.dumps(world)))
    page = ctx.new_page(); page.set_default_timeout(180000)
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300]))
    page.on('console', lambda m: m.type == 'error' and errs.append(m.text[:300]))
    page.goto(BASE + '/game/index.html'); page.wait_for_function('!!window.raftDebug', timeout=180000)
    page.locator('#solo').click(timeout=180000, no_wait_after=True)
    if args.freeze >= 0: page.evaluate('__perf.startClock()')
    page.wait_for_function('raftDebug.state.running', timeout=180000)
    if args.freeze < 0: page.wait_for_timeout(1200)
    else:
        page.wait_for_function('__perf.frozen()', timeout=600000, polling=500)
    page.evaluate("__perf.install(new URL('vendor/three.module.js', location.href).href)")
    if args.look:
        page.mouse.move(640, 360)
        for k in range(1, 11): page.mouse.move(640, 360 + args.look * k / 10)
        page.wait_for_function('raftDebug.state.camera.pitch < -0.5', timeout=180000, polling=500)
    return ctx, page, errs

def cdp_profile(page, ms=4000):
    s = page.context.new_cdp_session(page)
    s.send('Profiler.enable'); s.send('Profiler.setSamplingInterval', {'interval': 200})
    s.send('HeapProfiler.enable'); s.send('HeapProfiler.startSampling', {'samplingInterval': 4096})
    s.send('Profiler.start'); page.wait_for_timeout(ms)
    prof = s.send('Profiler.stop')['profile']; heap = s.send('HeapProfiler.stopSampling')['profile']
    # self time by function
    nodes = {n['id']: n for n in prof['nodes']}
    dts = prof['timeDeltas']; hits = defaultdict(float)
    for sid, dt in zip(prof['samples'][1:], dts[1:]): hits[sid] += dt / 1000
    total = sum(hits.values()) or 1
    selft = defaultdict(float)
    for nid, t in hits.items():
        cf = nodes[nid]['callFrame']
        key = f"{cf['functionName'] or '(anon)'} {Path(cf['url'].split('?')[0]).name}:{cf['lineNumber'] + 1}" if cf['url'] else cf['functionName'] or '(native)'
        selft[key] += t
    top = sorted(selft.items(), key=lambda kv: -kv[1])[:25]
    # allocations by allocating function (self)
    alloc = defaultdict(int)
    def walk(n):
        cf = n['callFrame']; key = f"{cf['functionName'] or '(anon)'} {Path(cf['url'].split('?')[0]).name}:{cf['lineNumber'] + 1}" if cf['url'] else cf['functionName'] or '(native)'
        alloc[key] += n['selfSize']
        for c in n.get('children', []): walk(c)
    walk(heap['head'])
    atot = sum(alloc.values()) or 1
    atop = sorted(alloc.items(), key=lambda kv: -kv[1])[:20]
    sec = ms / 1000
    return {
        'windowMs': ms, 'sampledMs': round(total, 1),
        'selfTop': [{'fn': k, 'ms': round(v, 1), 'pct': round(100 * v / total, 1)} for k, v in top],
        'allocKBperSec': round(atot / 1024 / sec, 1),
        'allocTop': [{'fn': k, 'KBperSec': round(v / 1024 / sec, 1), 'pct': round(100 * v / atot, 1)} for k, v in atop],
    }

report = {'dist': str(dist), 'dsf': args.dsf, 'frames': args.frames, 'scenarios': {}}
if args.append and Path(args.json).exists(): report['scenarios'] = json.loads(Path(args.json).read_text())['scenarios']
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'])
    for name in only:
      for attempt in (1, 2):  # the shared machine sometimes starves a page; retry once
        try:
            ctx, page, errs = start_game(b)
            js = SCENARIOS[name]
            if js:
                page.evaluate("async () => { const F = await import('/perf/fixes.js'); const P = window.__perf; %s }" % js)
                page.wait_for_timeout(300)
            r = measure(page, args.frames)
            r['census'] = page.evaluate('__perf.census()')
            r['state'] = page.evaluate("(()=>{const s=raftDebug.state;return {pointerLocked:s.pointerLocked,tiles:s.tiles,items:s.items}})()")
            if name == 'baseline' and not args.no_cdp:
                r['mainPassOnly'] = page.evaluate('__perf.mainOnly()')
                if not args.no_cdp: r['cdp'] = cdp_profile(page)
            # the game clock is frozen (--freeze), so every scenario screenshots the same scene state
            shotp = out / f"game-{args.tag + '-' if args.tag else ''}{'big-' if args.big else ''}{'look-' if args.look else ''}{name}{'-dsf' + str(args.dsf) if args.dsf != 1 else ''}.png"
            page.screenshot(path=str(shotp)); r['shot'] = str(shotp.relative_to(ROOT)) if shotp.is_relative_to(ROOT) else str(shotp)
            r['errors'] = errs; r['freezeFrame'] = args.freeze
            report['scenarios'][name] = r
            print(name, json.dumps({k: r[k] for k in ('cpuMsPerFrame', 'submitMs', 'submitMin', 'logicMs', 'calls', 'triangles', 'programs', 'pixelRatio')}), file=sys.stderr, flush=True)
            ctx.close()
            Path(args.json).write_text(json.dumps(report, indent=1))  # partial results survive a crash
            break
        except Exception as e:
            print(name, 'attempt', attempt, 'failed:', str(e).splitlines()[0], file=sys.stderr, flush=True)
            try: ctx.close()
            except Exception: pass
    b.close()
srv.shutdown()
Path(args.json).write_text(json.dumps(report, indent=1))
print(json.dumps(report, indent=1))
