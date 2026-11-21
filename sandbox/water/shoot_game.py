"""Shoot the real game from a given dist dir (current dist/ or a patched copy) for the water A/B.
Usage: python sandbox/water/shoot_game.py <dist_dir> <out_dir> <prefix>
Writes <prefix>-title.png, <prefix>-spawn.png, <prefix>-down.png (dragged to look at the raft edge), prints JSON."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True); pre = sys.argv[3]

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
report = {'errors': []}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
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
    report['frameMs'] = page.evaluate("""new Promise(r=>{let n=0,t0=performance.now(),worst=0,last=t0;function f(t){worst=Math.max(worst,t-last);last=t;if(++n<40)requestAnimationFrame(f);else r({avg:(t-t0)/n,worst})}requestAnimationFrame(f)})""")
    b.close()
srv.shutdown()
print(json.dumps(report, indent=1))
