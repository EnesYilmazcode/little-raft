"""Shoot the real game from a given dist dir (current dist/ or a patched copy) for the water A/B.
Usage: python sandbox/water/shoot_game.py <dist_dir> <out_dir> <prefix>
Writes <prefix>-title.png, <prefix>-spawn.png, <prefix>-down.png (dragged to look at the raft edge), prints JSON.
frameMs is wall time (swings with load); gpuCpuMs is CPU time of the browser's GPU process per frame (SwiftShader
rasterises there), which is the stable number for A/B on a shared box."""
import sys, os, json, threading, functools, http.server, socketserver, uuid
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True); pre = sys.argv[3]

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
report = {'errors': []}
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
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', TAG])
    page = b.new_page(viewport={'width': 1280, 'height': 720})
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type == 'error' and report['errors'].append(m.text[:300]))
    page.goto(f'http://127.0.0.1:{port}/'); page.wait_for_function('!!window.raftDebug', timeout=60000)
    page.wait_for_timeout(1500); page.screenshot(path=str(out / f'{pre}-title.png'))
    page.locator('#solo').click(timeout=180000); page.wait_for_function('raftDebug.state.running', timeout=60000)
    page.wait_for_timeout(2500); page.screenshot(path=str(out / f'{pre}-spawn.png'))
    page.mouse.move(640, 300); page.mouse.down()
    for i in range(1, 11): page.mouse.move(640 + i * 12, 300 + i * 14)
    page.mouse.up(); page.wait_for_timeout(1500); page.screenshot(path=str(out / f'{pre}-down.png'))
    c0 = gpu_cpu_s()
    report['frameMs'] = page.evaluate("""new Promise(r=>{let n=0,t0=performance.now(),worst=0,last=t0;function f(t){worst=Math.max(worst,t-last);last=t;if(++n<40)requestAnimationFrame(f);else r({avg:(t-t0)/n,worst})}requestAnimationFrame(f)})""")
    report['gpuCpuMs'] = round((gpu_cpu_s() - c0) * 1000 / 40, 1)
    b.close()
srv.shutdown()
print(json.dumps(report, indent=1))
