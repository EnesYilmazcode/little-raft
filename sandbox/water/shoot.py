"""Headless check for the water lab. Usage: python sandbox/water/shoot.py [out_dir]
Serves the repo root, renders every tier x view at a frozen time, prints frame ms + errors.
SwiftShader timings are only useful relative to each other."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / 'shots').resolve()
out.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
report = {'errors': [], 'runs': []}
tiers = sys.argv[2].split(',') if len(sys.argv) > 2 else ['cur', 'a', 'b', 'c']
cases = [(t, v, 1) for t in tiers for v in ('fp', 'over', 'sun')] + [(t, 'fp', 2.6) for t in tiers if t in ('a', 'c')]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(viewport={'width': 1280, 'height': 720})
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type in ('error', 'warning') and report['errors'].append(m.text[:400]))
    for t, v, a in cases:
        page.goto(f'http://127.0.0.1:{port}/sandbox/water/index.html?tier={t}&view={v}&amp={a}&t=12.5')
        page.wait_for_function('window.lab && window.lab.ready', timeout=20000)
        ms = page.evaluate('lab.probe()')
        name = f'{t}-{v}-amp{a}.png'
        page.screenshot(path=str(out / name))
        report['runs'].append({'tier': t, 'view': v, 'amp': a, 'avgMs': round(ms['avg'], 1), 'worstMs': round(ms['worst'], 1),
                               **{k: ms[k] for k in ('calls', 'triangles', 'geometries', 'textures', 'programs')}, 'shot': name})
    b.close()
srv.shutdown()
print(json.dumps(report, indent=1))
