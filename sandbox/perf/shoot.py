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
ap.add_argument('--noaa', action='store_true', help='create the game canvas context without MSAA (what antialias:false in game.js would do)')
ap.add_argument('--multi', action='store_true', help='all --only scenarios in one page (apply, measure, undo)')
ap.add_argument('--pose', default='spawn', help='spawn | island | ashore | night | sailing | underwater (see POSES)')
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
# name -> (JS applied to the running game, JS that undoes it). F = fixes module, P = window.__perf.
# --multi measures them all in ONE page, one after another (apply, measure, screenshot, undo), which is ~8x faster
# on the loaded box and keeps the frozen scene identical; without it every scenario gets a fresh page.
SCENARIOS = {
    'baseline':        ('', ''),
    # fixes and cheaper settings (looks checked with imgdiff.py against baseline)
    'wood-no-bump':    ('P.u = F.woodNoBump(P);', 'F.undo(P.u);'),
    'pool-lights-off': ('P.u = F.poolLightsOff(P);', 'F.undo(P.u);'),
    'shadow-512':      ('P.u = F.shadowMap(P, 512);', 'F.undo(P.u);'),
    'shadows-off':     ('P.R.renderer.shadowMap.enabled = false;', 'P.R.renderer.shadowMap.enabled = true;'),
    'dpr-0.85':        ('P.pr = P.R.renderer.getPixelRatio(); P.R.renderer.setPixelRatio(0.85);', 'P.R.renderer.setPixelRatio(P.pr);'),
    'no-fog':          ('P.fog = P.R.scene.fog; P.R.scene.fog = null;', 'P.R.scene.fog = P.fog;'),
    # bisection (diagnostic only, changes looks): hide one owner at a time
    'hide-raft':       ("P.u = F.hide(P, 'raft');", 'F.undo(P.u);'),
    'hide-ocean':      ("P.u = F.hide(P, 'ocean');", 'F.undo(P.u);'),
    'hide-items':      ("P.u = F.hide(P, 'floating items');", 'F.undo(P.u);'),
    'hide-viewmodels': ("P.u = F.hide(P, 'viewmodels');", 'F.undo(P.u);'),
    'hide-islands':    ("P.u = F.hide(P, 'islands');", 'F.undo(P.u);'),
    'hide-seafloor':   ("P.u = F.hide(P, 'seafloor');", 'F.undo(P.u);'),
    'hide-underwater-fx': ('P.u = F.hideExtraPass(P);', 'F.undo(P.u);'),
    'hide-sky':        ("P.u = F.hide(P, 'clouds (24, baked)').concat(F.hide(P, 'old islands (12, baked)'));", 'F.undo(P.u);'),
    'baseline-2':      ('', ''),
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

# Setup run after the frozen scene is up. Steps that need game time run the clock on for n frames (P.advance) at a
# quarter pixel ratio so SwiftShader gets through them quickly, then freeze it again and restore the pixel ratio.
ADV = "async n => { const r = __perf.R.renderer, pr = r.getPixelRatio(); r.setPixelRatio(.25); await __perf.advance(n); r.setPixelRatio(pr); }"
def advance(page, n): page.evaluate(f'({ADV})({n})')
def pose_island(page):  # a content island docked beside the raft, camera on deck looking at it
    page.evaluate('raftDebug.content.islands.spawnNear(1234)'); advance(page, 3)
    page.evaluate('raftDebug.aim(-0.08, raftDebug.content.islands.yawTo())'); advance(page, 2)
def pose_ashore(page):  # standing on that island among palms, bushes and rocks, looking across it
    pose_island(page); page.evaluate('raftDebug.content.islands.teleportAshore(-4, -3)'); advance(page, 2)
    page.evaluate('raftDebug.aim(-0.15, raftDebug.content.islands.yawTo())'); advance(page, 2)
def pose_night(page):  # midnight, clear sky, stars and moon up; lantern pool lights on when the save has lanterns
    page.evaluate("raftDebug.content.daynight.setPhase(0.85); raftDebug.content.daynight.setWeather('clear'); raftDebug.content.daynight.freeze(true)"); advance(page, 3)
def pose_sailing(page):  # sail raised (save has world.sailing.raised): run 6 s so the world has moved past the raft
    advance(page, 360)
def pose_underwater(page):  # swim off the raft, hold C to dive for 2.5 s, look ahead along the seafloor
    page.evaluate('raftDebug.swimAt(6, 7, -0.1, 0.6)'); advance(page, 20)
    page.keyboard.down('c'); advance(page, 150); page.keyboard.up('c')
    page.evaluate('raftDebug.aim(-0.15, 2.2)'); advance(page, 2)
POSES = {'spawn': None, 'island': pose_island, 'ashore': pose_ashore, 'night': pose_night, 'sailing': pose_sailing, 'underwater': pose_underwater}

def start_game(b):
    ctx = b.new_context(viewport={'width': 1280, 'height': 720}, device_scale_factor=args.dsf)
    if args.freeze >= 0: ctx.add_init_script(f'window.__perfFreezeAt = {args.freeze};')
    ctx.add_init_script(PROBE)
    if args.noaa: ctx.add_init_script("(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, o) { if (this.id === 'world' && /webgl/.test(t)) o = {...(o || {}), antialias: false}; return g.call(this, t, o); }; })()")
    if args.big:
        decor = [{'type': t, 'x': x, 'z': z} for (t, x, z) in [('sail', 0, 2), ('palm', -2, -2), ('lantern', 2, -2), ('net', 3, 3), ('bench', -3, 1), ('crate', 2, 1),
                 ('crate', -1, 3), ('lantern', -3, -3), ('palm', 3, -1), ('bench', 1, -3), ('net', -3, 3), ('sail', -2, 0)]]
        world = {'tiles': [[x, z] for x in range(-3, 4) for z in range(-3, 4)], 'decor': decor, 'stock': {}, 'fish': 0, 'collected': 0}
        if args.pose == 'sailing': world['sailing'] = {'raised': True, 'heading': 0.6, 'windDir': 0.6, 'windTarget': 0.6, 'windStr': 1, 'windStrTarget': 1}
        ctx.add_init_script("try { localStorage.setItem('little-raft-v1', %s) } catch (e) {}" % json.dumps(json.dumps(world)))
    page = ctx.new_page(); page.set_default_timeout(180000)
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300]))
    page.on('console', lambda m: m.type == 'error' and errs.append(m.text[:300]))
    page.goto(BASE + '/game/index.html'); page.wait_for_function('!!window.raftDebug', timeout=180000)
    page.wait_for_function("!!document.querySelector('#solo') && !document.querySelector('#solo').disabled", timeout=180000)
    page.evaluate("document.querySelector('#solo').click()")  # the title menu (onboarding.js) hides #solo and clicks it itself
    if args.freeze >= 0: page.evaluate('__perf.startClock()')
    page.wait_for_function('raftDebug.state.running', timeout=180000)
    if args.freeze < 0: page.wait_for_timeout(1200)
    else:
        page.wait_for_function('__perf.frozen()', timeout=600000, polling=500)
    page.evaluate("__perf.install(new URL('vendor/three.module.js', location.href).href)")
    page.evaluate('__perf.label()')
    if POSES.get(args.pose): POSES[args.pose](page)
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

report = {'dist': str(dist), 'dsf': args.dsf, 'frames': args.frames, 'pose': args.pose, 'big': args.big, 'scenarios': {}}
if args.append and Path(args.json).exists(): report['scenarios'] = json.loads(Path(args.json).read_text())['scenarios']
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'])
    def run(page, errs, name):
        do, undo = SCENARIOS[name]
        if do:
            page.evaluate("async () => { const F = await import('/perf/fixes.js'); const P = window.__perf; %s }" % do)
            page.wait_for_timeout(300)
        r = measure(page, args.frames)
        r['census'] = page.evaluate('__perf.census()')
        r['state'] = page.evaluate("(()=>{const s=raftDebug.state;return {pointerLocked:s.pointerLocked,tiles:s.tiles,items:s.items,dive:s.dive&&{underwater:s.dive.underwater,depth:s.dive.depth}}})()")
        if name == 'baseline' and not args.no_cdp:
            r['mainPassOnly'] = page.evaluate('__perf.mainOnly()')
            r['cdp'] = cdp_profile(page)
        # the game clock is frozen (--freeze), so every scenario screenshots the same scene state
        shotp = out / f"game-{args.tag + '-' if args.tag else ''}{'big-' if args.big else ''}{'noaa-' if args.noaa else ''}{args.pose + '-' if args.pose != 'spawn' else ''}{'look-' if args.look else ''}{name}{'-dsf' + str(args.dsf) if args.dsf != 1 else ''}.png"
        page.screenshot(path=str(shotp)); r['shot'] = str(shotp.relative_to(ROOT)) if shotp.is_relative_to(ROOT) else str(shotp)
        r['errors'] = list(errs); r['freezeFrame'] = args.freeze
        if undo:
            page.evaluate("async () => { const F = await import('/perf/fixes.js'); const P = window.__perf; %s }" % undo)
            page.wait_for_timeout(300)
        report['scenarios'][name] = r
        print(name, json.dumps({k: r[k] for k in ('cpuMsPerFrame', 'submitMs', 'logicMs', 'draws', 'shadowDraws', 'calls', 'triangles', 'programs', 'pixelRatio')}), file=sys.stderr, flush=True)
        Path(args.json).write_text(json.dumps(report, indent=1))  # partial results survive a crash
    for group in ([only] if args.multi else [[n] for n in only]):
      for attempt in (1, 2):  # the shared machine sometimes starves a page; retry once
        try:
            ctx, page, errs = start_game(b)
            for name in group:
                if name not in report['scenarios'] or attempt == 1: run(page, errs, name)
            ctx.close()
            break
        except Exception as e:
            print(group, 'attempt', attempt, 'failed:', str(e).splitlines()[0], file=sys.stderr, flush=True)
            try: ctx.close()
            except Exception: pass
    b.close()
srv.shutdown()
Path(args.json).write_text(json.dumps(report, indent=1))
print(json.dumps(report, indent=1))
