"""AUDIT LIVE-2 (browser): one transient failure fetching a dependency of a new build makes that build un-installable
for the rest of the session. live.js retries with game.js?build=X&retry=N, but game.js's static imports
(hook.js?build=X etc.) keep their URL, so the failed module record is reused forever and hook.js is never
re-requested. Takes ~70s (FAILED_RETRY_MS is 60s). Self-contained; optional env RAFT_DIST."""
import os, sys, json, re, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

def dist_dir():
    if os.environ.get('RAFT_DIST'): return Path(os.environ['RAFT_DIST']).resolve()
    return (Path(__file__).resolve().parents[2] / 'dist').resolve()
DIST = dist_dir()
CHROMIUM = os.environ.get('CHROMIUM') or ('/opt/pw-browsers/chromium' if Path('/opt/pw-browsers/chromium').exists() else None)
VERSION = {'build': json.loads((DIST / 'version.json').read_text())['build'], 'protocol': 1}
NEW = 'nb2'
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, body, ctype):
        b = body.encode(); self.send_response(200); self.send_header('Content-Type', ctype); self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/version.json': return self.send(json.dumps(VERSION), 'application/json')
        if path == '/game.js' and ('build=' + NEW) in self.path:  # simulate a real deploy: imports carry the new build id
            return self.send(re.sub(r"\?build=[\w-]+'", "?build=" + NEW + "'", (DIST / 'game.js').read_text()), 'text/javascript')
        super().do_GET()
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=str(DIST)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/'
hits = {'n': 0}
CHECK = "async () => { for (let i = 0; i < 100; i++) { const r = await raftLive.check(); if (r.status !== 'busy' && r.status !== 'failed-recently') return r; await new Promise(f => setTimeout(f, 500)); } }"
with sync_playwright() as p:
    b = p.chromium.launch(**({'executable_path': CHROMIUM} if CHROMIUM else {}), headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': 800, 'height': 500}).new_page()
    def route(r):
        if '/hook.js' in r.request.url and ('build=' + NEW) in r.request.url:
            hits['n'] += 1
            if hits['n'] == 1: return r.fulfill(status=503, body='deploy in progress')  # one transient error only
        return r.continue_()
    page.route('**/*', route)
    page.goto(url); page.wait_for_function('!!window.raftDebug && window.raftLive && raftLive.build', timeout=90000)
    page.locator('#solo').click(); page.wait_for_function('raftDebug.state.running', timeout=90000)
    VERSION['build'] = NEW
    first = page.evaluate(CHECK); print('first attempt:', first)
    assert first['status'] == 'failed', first
    page.wait_for_timeout(61000)  # FAILED_RETRY_MS
    second = page.evaluate(CHECK); print('retry after 60s:', second, '| hook.js requests:', hits['n'])
    b.close()
srv.shutdown()
if second['status'] != 'updated':
    print(f"FAIL: retry of {NEW} still fails after the server recovered ({second.get('error')}); hook.js?build={NEW} was requested {hits['n']} time(s)"); sys.exit(1)
print('PASS')
