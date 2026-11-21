"""Spyglass screenshots (docs/specs/spyglass.md). Usage: python3 sandbox/spyglass/shoot.py <dist_dir> <out_dir> [port]
Starts its own static server, plays a fresh solo game, holds a spyglass, zooms at an island, prints JSON."""
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
url = f'http://127.0.0.1:{port}/?fixedres'

report = {'errors': [], 'console': [], 'shots': []}
def shot(page, name):
    p = out / f'{name}.png'; page.screenshot(path=str(p)); report['shots'].append(str(p))
def state(page):
    return page.evaluate("""(() => { const s = raftDebug.content.spyglass, c = document.querySelector('#lrSpyLabel');
      return { zoom: s.zoom(), t: s.t(), target: s.target(), label: c && !c.hidden ? c.textContent : null,
        body: document.body.classList.contains('lr-spy'), flag: globalThis.raftSpyglass?.zoomed,
        prompt: document.querySelector('#lrPrompt')?.textContent ?? null }; })()""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type in ('error', 'warning') and report['console'].append(m.text[:300]))
    page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=60000)
    page.wait_for_timeout(800)
    page.locator('.ob-item[data-act="new"]:visible, #solo:visible').first.click(); page.wait_for_function('raftDebug.state.running', timeout=15000)
    page.wait_for_timeout(1200)
    report['give'] = page.evaluate("raftDebug.give('spyglass')")
    page.evaluate("raftDebug.give('binoculars')")
    report['equip'] = page.evaluate("raftDebug.content.spyglass.equip()")
    report['spawn'] = page.evaluate("raftDebug.content.islands.spawnNear(1234)")
    page.wait_for_timeout(600)
    page.evaluate("raftDebug.aim(0, raftDebug.content.islands.yawTo())")
    page.wait_for_timeout(900); shot(page, '01-held'); report['held'] = state(page)
    p2 = out / '01b-held-close.png'; page.screenshot(path=str(p2), clip={'x': 840, 'y': 470, 'width': 440, 'height': 250}); report['shots'].append(str(p2))
    page.evaluate("raftDebug.content.spyglass.force('spyglass', {snap:true})")
    page.wait_for_timeout(300); shot(page, '02-zoom-island'); report['zoom'] = state(page)
    page.evaluate("raftDebug.content.spyglass.force('binoculars', {snap:true})")
    page.wait_for_timeout(300); shot(page, '03-bino'); report['bino'] = state(page)
    page.evaluate("raftDebug.content.spyglass.force(null)")
    page.wait_for_timeout(300); shot(page, '04-restored'); report['restored'] = state(page)
    report['fov'] = page.evaluate("(() => { try { return raftDebug.state.fov ?? null } catch { return null } })()")
    if report['restored']['zoom'] != 1: report['errors'].append('not restored: ' + json.dumps(report['restored']))
    b.close()
print(json.dumps(report, indent=1))
