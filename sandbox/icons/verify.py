"""Headless check for sandbox/icons. Usage: python sandbox/icons/verify.py <out_dir>
Serves the repo root, opens the page in Chrome (SwiftShader), waits for the bake, prints the JSON report."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
out = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve(); out.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/sandbox/icons/index.html'

errs = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(viewport={'width': 1200, 'height': 900})
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: m.type in ('error', 'warning') and errs.append(m.text[:300]))
    page.goto(url)
    page.wait_for_function('window.__iconReport && window.__iconReport.done', timeout=60000)
    page.wait_for_timeout(300)
    page.screenshot(path=str(out / 'icons.png'), full_page=True)
    rep = page.evaluate('window.__iconReport')
    b.close()
rep['pageErrors'] = errs
print(json.dumps(rep, indent=1))
srv.shutdown()
