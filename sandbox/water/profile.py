"""Interleaved A/B timing of lab variants (the box is shared, so only same-run ratios mean anything).
Usage: [FRAMES=30 ROUNDS=5 VIEW=fp] python sandbox/water/profile.py 'tier=cur' 'tier=a' 'tier=a&prof=NO_GLIT' ...
Each argument is extra query string for sandbox/water/index.html. `prof=A,B` sets shader #defines (term knock-outs),
`src=shots/water-a0.js` loads another water module (e.g. a saved copy of the previous version).
Prints median avg ms per variant, the ratio of medians to the first variant, and the median of per-round ratios.
Wall-clock ms swing 2-4x on a loaded box, so it also reports `cpuMs`: CPU time (user + sys, all threads) the
browser's GPU process spent per frame. SwiftShader rasterises there, so this is the fragment/vertex work itself and
barely moves with load from other processes. Prefer cpuMs ratios."""
import sys, os, json, threading, functools, http.server, socketserver, uuid
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
samples = {v: [] for v in variants}; cpu = {v: [] for v in variants}; errors = []
TAG = f'--water-prof-{uuid.uuid4().hex[:8]}'
TICK = os.sysconf('SC_CLK_TCK')

def procs():
    for d in os.listdir('/proc'):
        if d.isdigit():
            try:
                yield int(d), open(f'/proc/{d}/cmdline', 'rb').read().replace(b'\0', b' '), open(f'/proc/{d}/stat').read()
            except OSError:
                pass

def gpu_pid():
    # Our browser carries TAG; its GPU process shares its --user-data-dir (parent pids go through a zygote).
    cmd = next(cmd for _, cmd, _ in procs() if TAG.encode() in cmd)
    udd = next(w for w in cmd.split() if w.startswith(b'--user-data-dir='))
    return next(pid for pid, c, _ in procs() if b'--type=gpu-process' in c and udd in c.split())

def cpu_s(pid):
    f = open(f'/proc/{pid}/stat').read().rsplit(')', 1)[1].split()
    return (int(f[11]) + int(f[12])) / TICK
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', TAG])
    page = b.new_page(viewport={'width': 1280, 'height': 720})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text[:300]))
    for r in range(ROUNDS):
        order = variants if r % 2 == 0 else variants[::-1]   # alternate order so drift in load cancels
        for v in order:
            page.goto(f'http://127.0.0.1:{port}/sandbox/water/index.html?view={VIEW}&amp=1&t=12.5&{v}')
            page.wait_for_function('window.lab && window.lab.ready', timeout=30000)
            page.evaluate('lab.probe(8)')
            gpu = gpu_pid(); c0 = cpu_s(gpu)
            samples[v].append(page.evaluate(f'lab.probe({FRAMES})')['avg'])
            cpu[v].append((cpu_s(gpu) - c0) * 1000 / (FRAMES + 1))
        print(f'round {r + 1}/{ROUNDS}', file=sys.stderr, flush=True)
    b.close()
srv.shutdown()
med = lambda xs: sorted(xs)[len(xs) // 2]
base = med(samples[variants[0]])
print(json.dumps({'errors': errors, 'view': VIEW, 'frames': FRAMES, 'rounds': ROUNDS,
                  'variants': {v: {'medianMs': round(med(s), 1), 'xFirst': round(med(s) / base, 3),
                                   'xFirstPaired': round(med([x / y for x, y in zip(s, samples[variants[0]])]), 3), 'samples': [round(x) for x in s],
                                   'cpuMs': round(med(cpu[v]), 1), 'cpuX': round(med(cpu[v]) / med(cpu[variants[0]]), 3),
                                   'cpuSamples': [round(x) for x in cpu[v]]}
                               for v, s in samples.items()}}, indent=1))
