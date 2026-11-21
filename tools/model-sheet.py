"""Render the model contact sheet headlessly.
Usage: python tools/model-sheet.py <out.png> [query]   e.g. "set=old" or "cell=64&cols=12"
Serves the repo root, opens tools/model-sheet.html, saves a screenshot, prints per-model stats."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]).resolve(); out.parent.mkdir(parents=True, exist_ok=True)
query = sys.argv[2] if len(sys.argv) > 2 else ''

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/tools/model-sheet.html?{query}'
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(viewport={'width': 1600, 'height': 400})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text[:400]))
    page.goto(url)
    try: page.wait_for_function('window.sheetDone', timeout=90000)
    except Exception as e: errors.append('timeout: ' + str(e)[:200])
    page.screenshot(path=str(out), full_page=True)
    stats = page.evaluate('window.sheetStats || []')
    b.close()
srv.shutdown()
print(json.dumps({'errors': errors, 'stats': stats}))
