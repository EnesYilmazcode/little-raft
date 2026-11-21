"""Sailing lane headless screenshots. Usage: python shoot_sailing.py <dist_dir> <out_dir>
Seeds a save with a sail on the raft, plays solo, and captures sailing states. Prints JSON (errors, sailing debug)."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/'

SAVE = {'tiles': [[x, z] for z in (-1, 0, 1) for x in (-1, 0, 1)] + [[0, 2], [-1, 2]],
        'decor': [{'type': 'sail', 'x': 0, 'z': 0}], 'fish': 0, 'collected': 5,
        'sailing': {'v': 1, 'windDir': 0.5, 'windStr': 0.9, 'windTarget': 0.5, 'windClock': 120, 'heading': 0.5,
                    'raised': True, 'anchored': False, 'vx': 0.9, 'vz': 0.9, 'wx': 0, 'wz': 0, 'gx': 0, 'gz': 0}}
report = {'errors': [], 'console': [], 'shots': [], 'sailing': {}}

def shot(page, name):
    p = out / f'{name}.png'; page.screenshot(path=str(p)); report['shots'].append(str(p))
def sail(page): return page.evaluate('raftDebug.state.sailing')
def look(page, dx, dy=0):  # drag-to-look fallback (pointer lock is unavailable headless)
    page.mouse.move(640, 360); page.mouse.down(); page.mouse.move(640 + dx, 360 + dy, steps=8); page.mouse.up()

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=__import__('os').environ.get('CHROME_PATH') or None, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type in ('error', 'warning') and report['console'].append(m.text[:300]))
    page.add_init_script('localStorage.setItem("little-raft-v1", %s)' % json.dumps(json.dumps(SAVE)))
    page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=20000)
    page.wait_for_timeout(600); shot(page, '01-title-sail')
    page.locator('#solo').click(); page.wait_for_function('raftDebug.state.running', timeout=15000)
    page.wait_for_timeout(1500); shot(page, '02-spawn-sailing'); report['sailing']['start'] = sail(page)
    look(page, 0, -120); page.wait_for_timeout(400); shot(page, '03-look-up-sail')
    look(page, 0, 160)
    page.wait_for_timeout(6000); report['sailing']['after6s'] = sail(page); shot(page, '04-under-way')
    look(page, 500); page.wait_for_timeout(400); shot(page, '05-look-around')
    look(page, 500); page.wait_for_timeout(400); shot(page, '06-look-back')
    report['frameMs'] = page.evaluate("""new Promise(r=>{let n=0,t0=performance.now(),worst=0,last=t0;function f(t){worst=Math.max(worst,t-last);last=t;if(++n<120)requestAnimationFrame(f);else r({avg:(t-t0)/n,worst})}requestAnimationFrame(f)})""")
    report['state'] = page.evaluate('({me: raftDebug.state.me, grounded: raftDebug.state.grounded, swimming: raftDebug.state.swimming, items: raftDebug.state.items})')
    b.close()
srv.shutdown()
print(json.dumps(report, indent=1, default=str))
