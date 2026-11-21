"""Interleaved A/B timing of lab variants (the box is shared, so only same-run ratios mean anything).
Usage: [FRAMES=30 ROUNDS=5 VIEW=fp] python sandbox/water/profile.py 'tier=cur' 'tier=a' 'tier=a&prof=NO_GLIT' ...
Each argument is extra query string for sandbox/water/index.html. `prof=A,B` sets shader #defines (term knock-outs),
`src=shots/water-a0.js` loads another water module (e.g. a saved copy of the previous version).
Prints median avg ms per variant, the ratio of medians to the first variant, and the median of per-round ratios."""
import sys, os, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

FRAMES = int(os.environ.get('FRAMES', '30')); ROUNDS = int(os.environ.get('ROUNDS', '5')); VIEW = os.environ.get('VIEW', 'fp')
root = Path(__file__).resolve().parents[2]
variants = sys.argv[1:] or ['tier=cur', 'tier=a']

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
samples = {v: [] for v in variants}; errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(viewport={'width': 1280, 'height': 720})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text[:300]))
    for r in range(ROUNDS):
        order = variants if r % 2 == 0 else variants[::-1]   # alternate order so drift in load cancels
        for v in order:
            page.goto(f'http://127.0.0.1:{port}/sandbox/water/index.html?view={VIEW}&amp=1&t=12.5&{v}')
            page.wait_for_function('window.lab && window.lab.ready', timeout=30000)
            page.evaluate('lab.probe(8)')
            samples[v].append(page.evaluate(f'lab.probe({FRAMES})')['avg'])
        print(f'round {r + 1}/{ROUNDS}', file=sys.stderr, flush=True)
    b.close()
srv.shutdown()
med = lambda xs: sorted(xs)[len(xs) // 2]
base = med(samples[variants[0]])
print(json.dumps({'errors': errors, 'view': VIEW, 'frames': FRAMES, 'rounds': ROUNDS,
                  'variants': {v: {'medianMs': round(med(s), 1), 'xFirst': round(med(s) / base, 3),
                                   'xFirstPaired': round(med([x / y for x, y in zip(s, samples[variants[0]])]), 3), 'samples': [round(x) for x in s]}
                               for v, s in samples.items()}}, indent=1))
