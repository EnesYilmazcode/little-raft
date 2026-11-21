"""Headless perf-lab sweep. Usage: python sandbox/perf/bench.py [out_dir]   (synthetic scene; the real-game profiler is shoot.py)
Note: calls now include the shadow pass (perf-overlay sets renderer.info.autoReset = false).
Serves the repo root, runs each config through window.runBench(), screenshots it, prints JSON lines.
SwiftShader renders on the CPU, so compare configs to each other, not to a real GPU."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
out = Path(sys.argv[1] if len(sys.argv) > 1 else root / 'sandbox' / 'perf' / 'shots'); out.mkdir(parents=True, exist_ok=True)

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=str(root)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{srv.server_address[1]}/sandbox/perf/synthetic.html'

CONFIGS = [
    'mode=naive&shadow=every', 'mode=naive&shadow=cached', 'mode=naive&shadow=off',
    'mode=instanced&shadow=every', 'mode=instanced&shadow=cached', 'mode=instanced&shadow=off',
    'mode=batched&shadow=every', 'mode=batched&shadow=cached', 'mode=batched&shadow=off',
    'mode=instanced&shadow=cached&alloc=1',
    'mode=naive&shadow=every&items=600&tiles=64', 'mode=instanced&shadow=cached&items=600&tiles=64', 'mode=batched&shadow=cached&items=600&tiles=64',
]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'])
    for c in CONFIGS:
        page = b.new_page(viewport={'width': 960, 'height': 540})
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and errs.append(m.text[:200]))
        page.goto(f'{base}?{c}&dpr=1'); page.wait_for_function('window.__ready', timeout=30000)
        r = page.evaluate('runBench(60)')
        page.wait_for_timeout(700)
        name = c.replace('&', '_').replace('=', '-')
        page.screenshot(path=str(out / f'{name}.png'))
        r['errors'] = errs
        print(json.dumps(r), flush=True)
        page.close()
    b.close()
