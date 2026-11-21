"""Headless screenshot + perf probe. Usage: python shoot.py <dist_dir> <out_dir> [port]
# Copy of shoot.py for sandboxes without Chrome: uses bundled Chromium (set PW_CHROME to override the binary).
Starts its own static server, plays a fresh solo game, captures key states, prints JSON."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)
port = int(sys.argv[3]) if len(sys.argv) > 3 else 0

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', port), functools.partial(Quiet, directory=str(dist)))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{port}/'

report = {'errors': [], 'console': [], 'shots': []}
def shot(page, name):
    p = out / f'{name}.png'; page.screenshot(path=str(p)); report['shots'].append(str(p))

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=__import__('os').environ.get('PW_CHROME') or None, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 720})
    page = ctx.new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type in ('error', 'warning') and report['console'].append(m.text[:300]))
    page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=20000)
    page.wait_for_timeout(800); shot(page, '01-title')
    page.locator('#solo').click(); page.wait_for_function('raftDebug.state.running', timeout=15000)
    page.wait_for_timeout(1500); shot(page, '02-spawn')
    try: report['spawnState'] = {k: v for k, v in page.evaluate('raftDebug.state').items() if k in ('ownedTools', 'inventory', 'stock', 'heldKind')}
    except Exception as e: report['errors'].append('state: ' + str(e))
    page.mouse.move(640, 360); page.mouse.down(); page.wait_for_timeout(700); shot(page, '03-charging'); page.mouse.up()
    page.wait_for_timeout(900); shot(page, '04-thrown')
    page.keyboard.press('Tab'); page.wait_for_timeout(500); shot(page, '05-inventory')
    page.keyboard.press('Escape'); page.wait_for_timeout(500); shot(page, '06-after-esc-from-inventory')
    report['pauseOpenAfterInvEsc'] = page.evaluate("(()=>{const d=document.querySelector('#options');return !!(d&&d.open)})()")
    page.keyboard.press('Escape'); page.wait_for_timeout(500); shot(page, '07-pause')
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    for k in '2345': page.keyboard.press(k); page.wait_for_timeout(250)
    page.keyboard.press('1')
    page.keyboard.down('w'); page.wait_for_timeout(900); page.keyboard.up('w'); shot(page, '08-walked')
    # frame time probe (software GL, so relative numbers only)
    report['frameMs'] = page.evaluate("""new Promise(r=>{let n=0,t0=performance.now(),worst=0,last=t0;function f(t){worst=Math.max(worst,t-last);last=t;if(++n<120)requestAnimationFrame(f);else r({avg:(t-t0)/n,worst})}requestAnimationFrame(f)})""")
    report['heapMB'] = page.evaluate('performance.memory ? performance.memory.usedJSHeapSize/1048576 : null')
    try: report['renderInfo'] = page.evaluate('raftDebug.renderInfo || null')
    except Exception: pass
    b.close()
srv.shutdown()
print(json.dumps(report, indent=1, default=str))
