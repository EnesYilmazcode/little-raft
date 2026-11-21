"""Headless check for the foliage lab. Usage: python sandbox/foliage/shoot.py [out_dir] [--quick]
Serves the repo root, renders views x densities x variants at a frozen time, prints JSON with
avg/worst frame ms and renderer.info. SwiftShader timings are only meaningful relative to each other."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
args = [a for a in sys.argv[1:] if not a.startswith('--')]
out = Path(args[0] if args else Path(__file__).parent / 'shots').resolve()
out.mkdir(parents=True, exist_ok=True)
quick = '--quick' in sys.argv

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

T = 7.3
cases = [dict(view=v) for v in ('raft', 'beach', 'canopy', 'over', 'far')]
cases += [dict(view='raft', foliage='0'), dict(view='beach', foliage='0')]  # baselines: same scene, no plants
cases += [dict(view='over', density='sparse'), dict(view='over', density='dense'),
          dict(view='raft', density='dense'), dict(view='beach', density='dense'),
          dict(view='beach', wind='1', t='7.3'), dict(view='beach', wind='1', t='8.1'),
          dict(view='raft', leaves='card'), dict(view='canopy', leaves='card'),
          dict(view='raft', mat='standard'), dict(view='raft', shadows='0'), dict(view='far', density='dense')]
only = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
if quick:
    cases = cases[:5]
if only:
    cases = [c for c in cases if c['view'] in only]

# changed-pixel fraction between t and t+0.6 s in these screen rects (ocean excluded where possible)
MOTION = {'raft': {'craftPalm': [0.7, 0.1, 1.0, 0.55], 'island': [0.3, 0.25, 0.7, 0.6]},
          'beach': {'frame': [0, 0, 1, 1]}, 'canopy': {'frame': [0, 0, 1, 1]}}
report = {'errors': [], 'runs': []}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(viewport={'width': 1280, 'height': 720})
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type in ('error', 'warning') and report['errors'].append(m.text[:400]))
    for c in cases:
        c = dict(c); c.setdefault('t', str(T))
        qs = '&'.join(f'{k}={v}' for k, v in c.items())
        page.goto(f'http://127.0.0.1:{port}/sandbox/foliage/index.html?{qs}')
        page.wait_for_function('window.lab && window.lab.ready', timeout=60000)
        r = page.evaluate('lab.probe(20)')
        name = '-'.join([c['view']] + [f'{k}{v}' for k, v in c.items() if k not in ('view', 't')] + ([f't{c["t"]}'] if 'wind' in c else [])) + '.png'
        page.screenshot(path=str(out / name))
        run = {**c, **r, 'shot': name, 'hero': page.evaluate('lab.counts')}
        if c.get('foliage') != '0':
            run['ab'] = page.evaluate('lab.ab(10)')
            if len(c) == 2:
                run['abShadow'] = page.evaluate("lab.ab(10, 'shadow')")
        if c['view'] in MOTION and (len(c) == 2 or c.get('foliage') == '0'):  # wind motion vs the no-plant baseline
            run['motion'] = {k: page.evaluate(f'lab.motion({T}, {T + 0.6}, {rect})') for k, rect in MOTION[c['view']].items()}
        report['runs'].append(run)
    b.close()
srv.shutdown()
errs = {}
for e in report['errors']:
    if 'GPU stall due to ReadPixels' in e: continue  # caused by the timing probe itself
    errs[e] = errs.get(e, 0) + 1
report['errors'] = [f'{n}x {e}' for e, n in errs.items()]
print(json.dumps(report, indent=1))
