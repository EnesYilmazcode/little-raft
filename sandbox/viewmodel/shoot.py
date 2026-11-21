"""Headless check of the viewmodel sandbox. Usage: python sandbox/viewmodel/shoot.py <out_dir>
Serves the repo root, loads each mode, screenshots it, prints per-mode stats as JSON."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
out = Path(sys.argv[1]).resolve(); out.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{srv.server_address[1]}/sandbox/viewmodel/index.html'

cases = [
    ('naive', 'mode=naive&still=1'),
    ('marker', 'mode=marker&still=1'),
    ('twopass', 'mode=twopass&still=1'),
    ('shader', 'mode=shader&still=1'),
    ('twopass-shade', 'mode=twopass&still=1&shade=1&wall=0'),
    ('shader-shade', 'mode=shader&still=1&shade=1&wall=0'),
    ('shader-open', 'mode=shader&still=1&wall=0'),
    ('shader-moving', 'mode=shader'),
]
report = {}
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    for name, q in cases:
        page = b.new_page(viewport={'width': 960, 'height': 540})
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and errs.append(m.text[:300]))
        page.goto(f'{base}?{q}')
        page.wait_for_function('window.vmDebug && vmDebug.frames > 40', timeout=60000)
        page.screenshot(path=str(out / f'{name}.png'))
        report[name] = {**page.evaluate('vmDebug'), 'errors': errs}
        page.close()
    b.close()
srv.shutdown()
print(json.dumps(report, indent=1))
