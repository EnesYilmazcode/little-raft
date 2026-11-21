"""AUDIT LIVE-3 (browser): live.js check() tests state.updating before `await fetchManifest()`, but only
swap() sets it, so two overlapping checks (the 6 s poll tick + a visibilitychange schedule(0) or a manual
raftLive.check()) both swap from the same old engine. The first new engine is never disposed and keeps a
second requestAnimationFrame render loop running forever. Contract: after any number of concurrent checks
exactly one `animate` loop is pending. Exit 1 on bug. Usage: python tests/audit/live3_concurrent_checks_double_swap.py"""
import os, sys, json, threading, functools, http.server, socketserver
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import DIST, launch

VERSION = {'build': 'b0', 'protocol': json.loads((DIST / 'version.json').read_text()).get('protocol', 1)}
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.split('?')[0] == '/version.json':
            b = json.dumps(VERSION).encode(); self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b); return
        super().do_GET()
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=str(DIST)))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/'
# Track pending rAF callbacks named `animate` (game.js render loop).
INIT = """(()=>{const raf=requestAnimationFrame.bind(window), caf=cancelAnimationFrame.bind(window); const pend=window.__pend=new Map();
window.requestAnimationFrame=fn=>{const id=raf(t=>{pend.delete(id); return fn(t);}); pend.set(id, fn.name); return id;};
window.cancelAnimationFrame=id=>{pend.delete(id); return caf(id);};})()"""
with launch(init_script=INIT) as (b, page):
    page.goto(url); page.wait_for_function('!!window.raftDebug && window.raftLive && raftLive.build', timeout=90000)
    page.locator('#solo').click(); page.wait_for_function('raftDebug.state.running', timeout=90000)
    VERSION['build'] = 'b1'
    res = page.evaluate("Promise.all([raftLive.check(), raftLive.check()]).then(r => r.map(x => x.status))")
    page.wait_for_timeout(3000)
    loops = page.evaluate("[...__pend.values()].filter(n => n === 'animate').length")
srv.shutdown()
print('check statuses:', res, '| pending animate loops:', loops)
if loops != 1 or res.count('updated') > 1:
    print(f'FAIL: two overlapping checks swapped {res.count("updated")} times and left {loops} render loops running'); sys.exit(1)
print('PASS')
