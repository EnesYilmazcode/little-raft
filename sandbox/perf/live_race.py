"""live.js double-mount race, on the current title screen (tests/audit/live3_concurrent_checks_double_swap.py clicks
#solo with a Playwright locator, which the onboarding title menu now hides, so that audit times out before it tests).
Two overlapping raftLive.check() calls after a new build appears: count builds swapped and render loops left running.
Usage: python sandbox/perf/live_race.py [--dist DIR] [--checks 2]   Exit 1 when more than one engine is left rendering."""
import argparse, json, sys, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser(); ap.add_argument('--dist', default=str(Path(__file__).resolve().parents[2] / 'dist')); ap.add_argument('--checks', type=int, default=2)
a = ap.parse_args(); DIST = Path(a.dist).resolve()
VERSION = {'build': 'b0', 'protocol': json.loads((DIST / 'version.json').read_text()).get('protocol', 1)}
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *x): pass
    def do_GET(self):
        if self.path.split('?')[0] == '/version.json':
            b = json.dumps(VERSION).encode(); self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b); return
        super().do_GET()
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=str(DIST))); srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
# Track pending rAF callbacks named `animate` (game.js render loop).
INIT = """(()=>{const raf=requestAnimationFrame.bind(window), caf=cancelAnimationFrame.bind(window); const pend=window.__pend=new Map();
window.requestAnimationFrame=fn=>{const id=raf(t=>{pend.delete(id); return fn(t);}); pend.set(id, fn.name); return id;};
window.cancelAnimationFrame=id=>{pend.delete(id); return caf(id);};})()"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(viewport={'width': 640, 'height': 360}); page.set_default_timeout(300000); page.add_init_script(INIT)
    page.goto(f'http://127.0.0.1:{srv.server_address[1]}/')
    page.wait_for_function("!!window.raftDebug && window.raftLive && raftLive.build && !!document.querySelector('#solo') && !document.querySelector('#solo').disabled")
    page.evaluate("document.querySelector('#solo').click()"); page.wait_for_function('raftDebug.state.running')
    VERSION['build'] = 'b1'
    res = page.evaluate(f"Promise.all(Array.from({{length: {a.checks}}}, () => raftLive.check())).then(r => r.map(x => x.status))")
    page.wait_for_timeout(3000)
    loops = page.evaluate("[...__pend.values()].filter(n => n === 'animate').length")
    b.close()
srv.shutdown()
ok = loops == 1 and res.count('updated') == 1
print(json.dumps({'dist': str(DIST), 'checkStatuses': res, 'renderLoopsRunning': loops, 'pass': ok}))
sys.exit(0 if ok else 1)
