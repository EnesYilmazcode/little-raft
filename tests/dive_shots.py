"""Headless dive screenshots. Usage: python tests/dive_shots.py <dist_dir> <out_dir>
Plays a solo game, jumps into the sea, dives with C, captures above/below water shots, prints JSON."""
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
report = {'errors': [], 'console': [], 'shots': [], 'states': {}}
def state(page, name):
    report['states'][name] = page.evaluate('(()=>{const s=raftDebug.state;return {dive:s.dive, me:s.me, swimming:s.swimming, stock:s.stock}})()')
def shot(page, name):
    p = out / f'{name}.png'; page.screenshot(path=str(p)); report['shots'].append(str(p)); state(page, name)

with sync_playwright() as p:
    import os; exe = os.environ.get('CHROME_PATH'); b = p.chromium.launch(headless=True, **({'executable_path': exe} if exe else {}), args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(viewport={'width': 1280, 'height': 720})
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type in ('error', 'warning') and report['console'].append(m.text[:300]))
    page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=20000)
    page.locator('#solo').click(); page.wait_for_function('raftDebug.state.running', timeout=15000)
    page.wait_for_timeout(1200)
    page.evaluate('raftDebug.swimAt(6, 7, -0.1, 0.6)'); page.wait_for_timeout(1200); shot(page, '01-surface-swim')
    page.keyboard.down('c'); page.wait_for_timeout(1500); shot(page, '02-just-under')
    page.wait_for_timeout(2500); page.keyboard.up('c'); page.wait_for_timeout(400); shot(page, '03-deep-forward')
    # look down at the floor
    page.evaluate('raftDebug.state') ; page.keyboard.down('c'); page.wait_for_timeout(1500); page.keyboard.up('c')
    page.wait_for_timeout(300); shot(page, '04-near-floor')
    # aim at nearest node and hold E
    tgt = page.evaluate('''(()=>{const s=raftDebug.state;return s.dive})()''')
    page.keyboard.down('e'); page.wait_for_timeout(600); shot(page, '05-gathering'); page.wait_for_timeout(1200); page.keyboard.up('e')
    page.wait_for_timeout(300); shot(page, '06-after-gather')
    # under the raft looking up
    page.evaluate('raftDebug.swimAt(0, 3.2, 1.2, 0)'); page.wait_for_timeout(300)
    page.keyboard.down('c'); page.wait_for_timeout(2200); page.keyboard.up('c'); page.wait_for_timeout(300)
    page.keyboard.down('w'); page.wait_for_timeout(1200); page.keyboard.up('w'); page.wait_for_timeout(300); shot(page, '07-under-raft-up')
    report['frameMs'] = page.evaluate("""new Promise(r=>{let n=0,t0=performance.now(),worst=0,last=t0;function f(t){worst=Math.max(worst,t-last);last=t;if(++n<90)requestAnimationFrame(f);else r({avg:(t-t0)/n,worst})}requestAnimationFrame(f)})""")
    # oxygen run-out: wait it out (speed up by long wait is too slow; just record oxygen)
    page.wait_for_timeout(3000); shot(page, '08-surfacing')
    b.close()
srv.shutdown()
print(json.dumps(report, indent=1, default=str))
