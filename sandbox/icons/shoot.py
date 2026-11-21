"""Headless check for sandbox/icons. Usage: python sandbox/icons/shoot.py
Serves the repo root, bakes the icon atlas in Chromium (SwiftShader) at DPR 1 and 2, screenshots the
icon sheet and the REAL dist/survival-ui.js (patched copy via adopt_patch.py) with the inventory open,
writes PNGs to sandbox/icons/shots/ and prints a JSON report."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from adopt_patch import patched_survival_ui  # noqa: E402

root = HERE.parents[1]
shots = HERE / 'shots'; shots.mkdir(exist_ok=True)
(HERE / '_patched').mkdir(exist_ok=True)
(HERE / '_patched' / 'survival-ui.js').write_text(patched_survival_ui(sandbox_copy=True))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{srv.server_address[1]}/sandbox/icons/index.html'

report = {'runs': {}, 'shots': [], 'pageErrors': []}
def run(p, b, name, query, dpr, vw=1280, vh=900, full=True, elements=()):
    if ONLY and name not in ONLY: return None
    ctx = b.new_context(viewport={'width': vw, 'height': vh}, device_scale_factor=dpr)
    page = ctx.new_page()
    page.on('pageerror', lambda e: report['pageErrors'].append(f'{name}: {e}'))
    page.on('console', lambda m: m.type in ('error', 'warning') and report['pageErrors'].append(f'{name}: {m.text[:300]}'))
    page.goto(base + query)
    page.wait_for_function('window.__iconReport && window.__iconReport.done', timeout=240000)
    page.wait_for_timeout(200)
    out = shots / f'{name}.png'; page.screenshot(path=str(out), full_page=full); report['shots'].append(str(out))
    for sel, suffix in elements:
        o = shots / f'{name}-{suffix}.png'; page.locator(sel).screenshot(path=str(o)); report['shots'].append(str(o))
    rep = page.evaluate('window.__iconReport'); ctx.close()
    report['runs'][name] = rep
    print('done', name, file=sys.stderr, flush=True)
    return rep
ONLY = set(sys.argv[1:])

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    run(p, b, 'sheet-1x', '?mode=sheet', 1)
    run(p, b, 'sheet-2x', '?mode=sheet', 2, elements=[('#native', 'native'), ('#s58', 'hotbar58'), ('#s18', 'chip18'), ('#compare', 'compare')])
    run(p, b, 'ui-inventory-1x', '?mode=ui', 1, vw=1280, vh=720, full=False)
    run(p, b, 'ui-inventory-2x', '?mode=ui', 2, vw=1280, vh=720, full=False, elements=[('#inventory .sv-wrap', 'panel')])
    run(p, b, 'ui-hotbar-2x', '?mode=ui&open=0', 2, vw=1280, vh=720, full=False, elements=[('.tools', 'bar')])
    run(p, b, 'ui-inventory-svg-1x', '?mode=ui&svg=1', 1, vw=1280, vh=720, full=False)
    run(p, b, 'ui-inventory-late-2x', '?mode=ui&late=1', 2, vw=1280, vh=720, full=False, elements=[('#inventory .sv-wrap', 'panel')])
    b.close()
srv.shutdown()

summary = {}
for k in ('sheet-1x', 'sheet-2x'):
    r = report['runs'].get(k, {})
    s = r.get('stats') or {}
    summary[k] = {
        'bakeTotalMs': s.get('totalMs'), 'setupMs': s.get('setupMs'), 'drawMs': s.get('drawMs'), 'readbackMs': s.get('readbackMs'),
        'encodeMs': s.get('encodeMs'), 'perTileMs': [t['ms'] for t in s.get('tiles', [])],
        'bakeRender': s.get('bakeRender'), 'programsCompiled': s.get('programsCompiled'), 'programKeys': s.get('programKeys'),
        'bakeOpts': r.get('bakeOpts'), 'atlasPx': s.get('atlasPx'), 'transientVRAMBytes': s.get('transientVRAMBytes'),
        'dataUrlBytes': s.get('dataUrlBytes'), 'atlasDataUrlBytes': s.get('atlasDataUrlBytes'),
        'cacheHitMs': r.get('cacheHitMs'), 'cacheHit': r.get('cacheHit'),
        'frames': r.get('frames'), 'rendererInfoBefore': r.get('infoBeforeBake'), 'rendererInfoAfter': r.get('infoAfterBake'),
        'errors': r.get('errors'),
    }
for k, r in report['runs'].items():
    if r.get('errors'): summary.setdefault('errors', {})[k] = r['errors']
summary['lateSwap'] = (report['runs'].get('ui-inventory-late-2x') or {}).get('lateSwap')
summary['pageErrors'] = report['pageErrors']
summary['shots'] = report['shots']
print(json.dumps(summary, indent=1))
