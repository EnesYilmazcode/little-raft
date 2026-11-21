"""Headless check of the viewmodel lab. Usage: python sandbox/viewmodel/shoot.py [out_dir]
Serves the repo root, drives each scripted scene on a fixed 60 Hz clock through window.vmLab, screenshots it,
then renders 120 frames per perf case (CPU submit and GPU-synced) and prints avg/worst frame ms + renderer.info as JSON.
Default out_dir: sandbox/viewmodel/shots/. Env ONLY=substr1,substr2 limits shots and skips perf (quick iteration)."""
import os, sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / 'sandbox/viewmodel/shots'
out.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{srv.server_address[1]}/sandbox/viewmodel/index.html'

# (png name, query, seconds of simulated time before the shot)
shots = [
    ('01-idle', 'scene=idle', 2.3),
    ('02-walk-bob-left', 'scene=walk', 1.40),
    ('03-walk-bob-right', 'scene=walk', 1.75),
    ('04-charge-full', 'scene=charge', 1.6),
    ('04b-charge-full-legacy', 'scene=charge&mode=legacy', 1.6),
    ('05-equip-lowering', 'scene=swap', 1.05),
    ('06-equip-raising', 'scene=swap', 1.30),
    ('07-equip-hammer', 'scene=swap', 2.0),
    ('08-equip-rod', 'scene=swap', 3.0),
    ('09a-hammer-cock', 'scene=use', 1.07),
    ('09-use-hammer-kick', 'scene=use', 1.08),
    ('09c-hammer-impact', 'scene=use', 1.13),
    ('09d-hammer-recover', 'scene=use', 1.22),
    ('09b-use-hammer-kick-legacy', 'scene=use&mode=legacy', 1.08),
    ('10-look-sway', 'scene=look', 1.2),
    ('11-wall-vm', 'scene=wall', 1.0),
    ('12-wall-legacy', 'scene=wall&mode=legacy', 1.0),
    ('13-wall-naive', 'scene=wall&mode=naive', 1.0),
    ('14-shade-vm', 'scene=shade', 1.0),
    ('15-shade-legacy', 'scene=shade&mode=legacy', 1.0),
    ('16-fov95-vm', 'scene=idle&fov=95', 1.0),
    ('17-fov95-legacy', 'scene=idle&fov=95&mode=legacy', 1.0),
    ('18-rope-anchor-vm', 'scene=rope', 1.0),
    ('19-throw-release', 'scene=throw', 1.57),
    ('19b-throw-follow', 'scene=throw', 1.63),
    ('19c-throw-legacy', 'scene=throw&mode=legacy', 1.57),
]
only = [x for x in os.environ.get('ONLY', '').split(',') if x]
if only: shots = [s for s in shots if any(o in s[0] for o in only)]
perf = [] if only else [('vm', 'scene=walk'), ('legacy', 'scene=walk&mode=legacy'), ('naive', 'scene=walk&mode=naive'),
                             ('vm-noocean', 'scene=walk&ocean=0'), ('legacy-noocean', 'scene=walk&mode=legacy&ocean=0'), ('naive-noocean', 'scene=walk&mode=naive&ocean=0')]

report = {'shots': {}, 'perf': {}}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    def open_page(q):
        page = b.new_page(viewport={'width': 960, 'height': 540})
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and errs.append(m.text[:300]))
        page.goto(f'{base}?auto=0&hud=0&{q}')
        page.wait_for_function('window.vmReady === true', timeout=60000)
        return page, errs
    for name, q, secs in shots:
        page, errs = open_page(q)
        r = page.evaluate(f'vmLab.advance({secs})')
        page.screenshot(path=str(out / f'{name}.png'))
        report['shots'][name] = {**r, 'errors': errs}
        page.close()
    for name, q in perf:
        page, errs = open_page(q)
        page.evaluate('vmLab.bench(30)')                    # warm-up: shader compile, shadow map
        r = page.evaluate('vmLab.bench(120)')
        report['perf'][name] = {**r, 'errors': errs}
        page.close()
    b.close()
srv.shutdown()
(out / 'report.json').write_text(json.dumps(report, indent=1))
print(json.dumps(report, indent=1))
