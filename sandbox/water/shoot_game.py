"""Shoot the real game for the water A/B: the current dist/, or a temp copy patched with the tier A water.
Usage: python sandbox/water/shoot_game.py <cur|new|dist_dir> <out_dir> [prefix]
  cur       serve dist/ as it is
  new       copy dist/ to a temp dir, cp sandbox/water/water.js -> ocean.js, git apply sandbox/water/adopt-game.diff
  dist_dir  serve that directory as it is
Shots (<prefix>-*.png): title, spawn, down (dragged to look at the raft edge), cast (hook thrown and floating),
noon / dusk / night (raftDebug.content.daynight.setPhase + freeze), under / under-up (swimAt + hold C to dive),
sail (a seeded save with a raised sail and a far-out water offset, so uFlow is large).
frameMs is wall time (swings with load); gpuCpuMs is CPU time of the browser's GPU process per frame (SwiftShader
rasterises there), which is the stable number for A/B on a shared box. Prints JSON."""
import sys, os, json, threading, functools, http.server, socketserver, uuid, shutil, subprocess, tempfile, time
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
mode = sys.argv[1]; out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)
pre = sys.argv[3] if len(sys.argv) > 3 else mode
tmp = None
if mode == 'cur': dist = root / 'dist'
elif mode == 'new':
    tmp = Path(tempfile.mkdtemp(prefix='water-game-'))
    shutil.copytree(root / 'dist', tmp / 'dist')
    shutil.copy(root / 'sandbox/water/water.js', tmp / 'dist/ocean.js')
    subprocess.run(['git', 'apply', str(root / 'sandbox/water/adopt-game.diff')], cwd=tmp, check=True)
    dist = tmp / 'dist'
else: dist = Path(mode).resolve()

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{port}/'
report = {'dist': str(dist), 'errors': []}
TAG = f'--water-game-{uuid.uuid4().hex[:8]}'

def procs():
    for d in os.listdir('/proc'):
        if d.isdigit():
            try:
                yield int(d), open(f'/proc/{d}/cmdline', 'rb').read().replace(b'\0', b' ')
            except OSError:
                pass

def gpu_cpu_s():
    cmd = next(c for _, c in procs() if TAG.encode() in c)
    udd = next(w for w in cmd.split() if w.startswith(b'--user-data-dir='))
    pid = next(p for p, c in procs() if b'--type=gpu-process' in c and udd in c.split())
    f = open(f'/proc/{pid}/stat').read().rsplit(')', 1)[1].split()
    return (int(f[11]) + int(f[12])) / os.sysconf('SC_CLK_TCK')

def wait_js(page, expr, timeout=120):  # Python-side poll: in-page polling stalls under software GL
    end = time.monotonic() + timeout
    while True:
        try:
            if page.evaluate('() => !!(' + expr + ')'): return
        except Exception: pass
        if time.monotonic() > end: raise TimeoutError(expr)
        page.wait_for_timeout(250)

def shot(page, name): page.screenshot(path=str(out / f'{pre}-{name}.png'), timeout=180000)

def measure(page, n=40):
    c0 = gpu_cpu_s()
    fm = page.evaluate("""n=>new Promise(r=>{let k=0,t0=performance.now(),worst=0,last=t0;function f(t){worst=Math.max(worst,t-last);last=t;if(++k<n)requestAnimationFrame(f);else r({avg:Math.round((t-t0)/k),worst:Math.round(worst)})}requestAnimationFrame(f)})""", n)
    return {'frameMs': fm, 'gpuCpuMs': round((gpu_cpu_s() - c0) * 1000 / n, 1)}

def boot(page, save=None):
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type == 'error' and report['errors'].append(m.text[:300]))
    if save is not None:
        page.add_init_script('if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem("little-raft-v1", ' + json.dumps(json.dumps(save)) + ') }')
    page.goto(url); wait_js(page, 'window.raftDebug')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', TAG])
    page = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    boot(page)
    page.wait_for_timeout(1500); shot(page, 'title')
    page.evaluate("document.querySelector('#solo').click()"); wait_js(page, 'raftDebug.state.running')
    page.evaluate('raftDebug.content.daynight?.freeze?.(true)')
    page.wait_for_timeout(2500); shot(page, 'spawn')
    page.mouse.move(640, 300); page.mouse.down()
    for i in range(1, 11): page.mouse.move(640 + i * 12, 300 + i * 14)
    page.mouse.up(); page.wait_for_timeout(1500); shot(page, 'down')
    report['down'] = measure(page)
    report['renderInfo'] = page.evaluate('(()=>{const r=raftDebug.renderInfo;return r&&{calls:r.calls,triangles:r.triangles,geometries:r.geometries,textures:r.textures,programs:r.programs}})()')
    # Charge and throw the hook, then look at it floating (bobber contact foam).
    page.mouse.down(); page.wait_for_timeout(900); page.mouse.up(); page.wait_for_timeout(3000)
    report['hook'] = page.evaluate('raftDebug.state.hook')
    shot(page, 'cast')
    # Day / night: the sun moves (shadow re-bake) and the palette changes.
    for name, ph in (('noon', 0.35), ('dusk', 0.64), ('night', 0.85)):
        page.evaluate(f'raftDebug.content.daynight?.setPhase?.({ph})'); page.wait_for_timeout(1500); shot(page, name)
    report['night'] = measure(page, 20)
    page.evaluate('raftDebug.content.daynight?.setPhase?.(0.2)'); page.wait_for_timeout(800)
    # Diving: swim, hold C to go under, look up at the surface from below.
    page.evaluate('raftDebug.swimAt(6, 7, -0.1, 0.6)'); page.wait_for_timeout(1200); shot(page, 'swim')
    page.keyboard.down('c'); page.wait_for_timeout(2500); page.keyboard.up('c'); shot(page, 'under')
    page.evaluate('raftDebug.aim(0.9, 0.6)'); page.wait_for_timeout(600); shot(page, 'under-up')
    report['dive'] = page.evaluate('(()=>{const d=raftDebug.state.dive;return d&&{underwater:d.underwater,depth:d.depth}})()')
    report['under'] = measure(page, 20)
    # Sailing: seed a raft with a raised sail and a far-out water offset (uFlow), let it sail.
    slots = [None] * 28; slots[0] = {'kind': 'hook', 'count': 1, 'durability': 60}
    save = {'tiles': [[x, z] for z in (-1, 0, 1) for x in (-1, 0, 1)], 'decor': [{'type': 'sail', 'x': 0, 'z': 0, 'rot': 0}],
            'stock': {}, 'fish': 0, 'collected': 0, 'hookHealth': 60, 'items': [], 'hostInventory': {'slots': slots, 'selected': 0},
            'guestInventory': None, 'sailing': {'v': 1, 'raised': True, 'windDir': 0.6, 'windStr': 1, 'windTarget': 0.6, 'windStrTarget': 1,
            'heading': 0.6, 'wx': 1234.5, 'wz': -987.25, 'gx': 40, 'gz': -30}}
    page2 = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    boot(page2, save)
    page2.evaluate("document.querySelector('#solo').click()"); wait_js(page2, 'raftDebug.state.running')
    page2.wait_for_timeout(4000)
    page2.mouse.move(640, 300); page2.mouse.down()
    for i in range(1, 11): page2.mouse.move(640 - i * 10, 300 + i * 12)
    page2.mouse.up(); page2.wait_for_timeout(1500); shot(page2, 'sail')
    report['sailing'] = page2.evaluate('(()=>{const s=raftDebug.state.sailing;return s&&{raised:s.raised,speed:s.speed,display:s.display,flow:s.flow}})()')
    b.close()
srv.shutdown()
if tmp: shutil.rmtree(tmp, ignore_errors=True)
print(json.dumps(report, indent=1))
