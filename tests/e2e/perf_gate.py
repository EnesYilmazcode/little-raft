"""Perf probe + gate. Usage: python tests/e2e/perf_gate.py <dist_dir> [--json out.json] [--baseline base.json] [--frames N]
Plays a fresh solo game under software GL and reports startup, frame times, render stats,
per-frame JS allocation (sampling heap profiler incl. collected objects), and heap growth.
With --baseline, exits 1 if draw calls/triangles/alloc rate regress by more than the tolerances."""
import sys, json, time, argparse, threading, functools, http.server, socketserver
from collections import defaultdict
from pathlib import Path
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('dist'); ap.add_argument('--json'); ap.add_argument('--baseline'); ap.add_argument('--frames', type=int, default=240)
ap.add_argument('--chrome', default='/usr/bin/google-chrome'); ap.add_argument('--swim', action='store_true', help='also measure swimming off the raft')
a = ap.parse_args()

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *x): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(Path(a.dist).resolve())))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/?pinQuality'

FRAMES = """n=>new Promise(r=>{const d=[];let last=performance.now();function f(t){d.push(t-last);last=t;if(d.length<n)requestAnimationFrame(f);else{d.sort((x,y)=>x-y);r({avg:d.reduce((s,x)=>s+x,0)/d.length,p50:d[d.length>>1],p95:d[Math.floor(d.length*.95)],worst:d[d.length-1]})}}requestAnimationFrame(f)})"""
COUNT = "n=>new Promise(r=>{let k=0;function f(){if(++k<n)requestAnimationFrame(f);else r(k)}requestAnimationFrame(f)})"

def heap(cdp):
    m = {x['name']: x['value'] for x in cdp.send('Performance.getMetrics')['metrics']}
    return m.get('JSHeapUsedSize', 0) / 1048576

def walk(node, acc, path=''):
    cf = node['callFrame']; name = f"{cf['functionName'] or '(anon)'} {Path(cf['url']).name}:{cf['lineNumber']+1}"
    acc[name] += node['selfSize']
    for c in node.get('children', []): walk(c, acc)

def phase(page, cdp, label, frames):
    cdp.send('HeapProfiler.collectGarbage'); h0 = heap(cdp)
    cdp.send('HeapProfiler.startSampling', {'samplingInterval': 4096, 'includeObjectsCollectedByMajorGC': True, 'includeObjectsCollectedByMinorGC': True})
    t0 = time.time(); fr = page.evaluate(FRAMES, frames); secs = time.time() - t0
    prof = cdp.send('HeapProfiler.stopSampling')['profile']
    acc = defaultdict(int); walk(prof['head'], acc); total = sum(acc.values())
    cdp.send('HeapProfiler.collectGarbage'); h1 = heap(cdp)
    top = sorted(acc.items(), key=lambda kv: -kv[1])[:12]
    return {'label': label, 'frames': fr, 'allocKBPerFrame': round(total / 1024 / frames, 2), 'retainedGrowthMB': round(h1 - h0, 3),
            'heapMB': round(h1, 2), 'seconds': round(secs, 1), 'topAlloc': [[k, round(v / 1024 / frames, 2)] for k, v in top],
            'render': page.evaluate('raftDebug.renderInfo')}

rep = {'errors': []}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=a.chrome, headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'])
    page = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    page.on('pageerror', lambda e: rep['errors'].append(str(e)))
    cdp = page.context.new_cdp_session(page); cdp.send('Performance.enable'); cdp.send('HeapProfiler.enable')
    t0 = time.time(); page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=30000)
    rep['startup'] = {'toDebugMs': round((time.time() - t0) * 1000), 'nav': page.evaluate("(()=>{const n=performance.getEntriesByType('navigation')[0];return n?{domContentLoaded:Math.round(n.domContentLoadedEventEnd),load:Math.round(n.loadEventEnd),transferKB:Math.round(performance.getEntriesByType('resource').reduce((s,r)=>s+(r.decodedBodySize||0),0)/1024)}:null})()")}
    page.locator('#solo').wait_for(state='visible')
    rep['startup']['soloToFirstFrameMs'] = page.evaluate("new Promise(r=>{const t=performance.now();document.querySelector('#solo').click();requestAnimationFrame(()=>requestAnimationFrame(()=>r(Math.round(performance.now()-t))))})")
    page.wait_for_function('raftDebug.state.running', timeout=30000)
    page.evaluate(COUNT, 30)
    rep['idle'] = phase(page, cdp, 'idle at spawn', a.frames)
    page.mouse.move(640, 360)
    # walk back and forth on the deck (W/S alternate every 0.6 s) so the phase measures deck walking, not swimming
    page.evaluate("""(()=>{let k='KeyW';const ev=(t,c)=>window.dispatchEvent(new KeyboardEvent(t,{code:c,key:c==='KeyW'?'w':'s',bubbles:true}));
      ev('keydown',k);window.__walkTimer=setInterval(()=>{ev('keyup',k);k=k==='KeyW'?'KeyS':'KeyW';ev('keydown',k)},600);
      window.__walkStop=()=>{clearInterval(window.__walkTimer);ev('keyup',k)}})()""")
    rep['walk'] = phase(page, cdp, 'walking on deck', a.frames // 2)
    page.evaluate('window.__walkStop()')
    rep['walk']['onDeck'] = page.evaluate('raftDebug.state.swimming === false')
    page.mouse.down(); page.wait_for_timeout(600); page.mouse.up()
    rep['hook'] = phase(page, cdp, 'hook thrown', a.frames // 2)
    if a.swim:
        page.keyboard.down('w'); page.wait_for_function('raftDebug.state.swimming', timeout=60000); page.evaluate(COUNT, 20)
        rep['swim'] = phase(page, cdp, 'swimming off the raft', a.frames // 2)
        page.keyboard.up('w')
    b.close()
srv.shutdown()

out = json.dumps(rep, indent=1, default=str)
if a.json: Path(a.json).write_text(out)
print(out)
if a.baseline:
    base = json.loads(Path(a.baseline).read_text()); bad = []
    for ph in [p for p in ('idle', 'walk', 'hook', 'swim') if p in rep and p in base]:
        for k, tol in (('calls', 1.05), ('triangles', 1.05)):
            if rep[ph]['render'][k] > base[ph]['render'][k] * tol + 2: bad.append(f"{ph}.{k} {base[ph]['render'][k]} -> {rep[ph]['render'][k]}")
        if rep[ph]['allocKBPerFrame'] > base[ph]['allocKBPerFrame'] * 1.25 + 1: bad.append(f"{ph}.alloc {base[ph]['allocKBPerFrame']} -> {rep[ph]['allocKBPerFrame']}")
    if rep['errors']: bad.append('page errors: ' + '; '.join(rep['errors'][:3]))
    print('PERF GATE', 'FAIL' if bad else 'PASS', *bad, sep='\n  ')
    sys.exit(1 if bad else 0)
