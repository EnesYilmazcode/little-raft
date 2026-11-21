"""Main vs fleet vs merged item icons, side by side. Usage: python sandbox/icons/shoot.py [variants...]  (DEFS=1: log shader defines)
Builds a temp tree (copy of dist/ + sandbox/icons/): dist/item-icons.main.js = main's renderer unchanged,
dist/item-icons.js = sandbox/icons/item-icons.js (merged). Each variant runs cold in a fresh browser, then
warm (reload in the same context, so a persistent cache would hit). Writes shots/compare-sheet.png and
shots/compare.json and prints the numbers."""
import sys, json, shutil, tempfile, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent; ROOT = HERE.parents[1]
CHROME = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
VARIANTS = sys.argv[1:] or ['main', 'fleet', 'merged']

tmp = Path(tempfile.mkdtemp(prefix='icons-cmp-'))
shutil.copytree(ROOT / 'dist', tmp / 'dist')
shutil.copytree(HERE, tmp / 'sandbox' / 'icons', ignore=shutil.ignore_patterns('shots', '_patched', '__pycache__'))
(tmp / 'dist' / 'item-icons.main.js').write_text((ROOT / 'dist' / 'item-icons.js').read_text())
if (HERE / 'item-icons.js').exists():
    (tmp / 'dist' / 'item-icons.js').write_text((HERE / 'item-icons.js').read_text())
    (tmp / 'dist' / 'item-icon-models.js').write_text((HERE / 'item-icon-models.js').read_text())

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(tmp)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{srv.server_address[1]}/sandbox/icons/'
DEFS = bool(__import__('os').environ.get('DEFS'))
KEYS = ('defsOut', 'totalMs', 'worstFrameMs', 'avgFrameMs', 'framesOver100', 'links', 'contexts', 'rendered', 'urlBytes', 'gameInfo', 'ls', 'syncHitMs', 'readyAtMs')

out = {}
with sync_playwright() as p:
    for v in VARIANTS:
        b = p.chromium.launch(executable_path=CHROME, headless=True, args=ARGS)
        ctx = b.new_context(viewport={'width': 640, 'height': 400})
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
        pg.on('console', lambda m: m.type in ('error', 'warning') and errs.append(m.text[:200]))
        runs = []
        for i in range(2):
            pg.goto(base + f'compare.html?v={v}&cache=1' + ('&defs=1' if DEFS else ''))
            pg.wait_for_function('window.__cmp && window.__cmp.done', timeout=600000, polling=500)
            runs.append(pg.evaluate('window.__cmp'))
        b.close()
        cold, warm = runs
        out[v] = {'urls': cold['urls'], 'kinds': cold['kinds'], 'errors': errs + cold['errors'] + warm['errors'],
                  'cold': {k: cold.get(k) for k in KEYS}, 'warm': {k: warm.get(k) for k in KEYS}}
        print(v, json.dumps({'cold': out[v]['cold'], 'warm': out[v]['warm'], 'errors': out[v]['errors'][:5]}), flush=True)
    b = p.chromium.launch(executable_path=CHROME, headless=True, args=ARGS)
    pg = b.new_page(viewport={'width': 1500, 'height': 900}, device_scale_factor=2)
    pg.goto(base + 'sheet.html'); pg.wait_for_function('window.sheetReady')
    kinds = next(iter(out.values()))['kinds']
    pg.evaluate('d => window.drawSheet(d)', {'kinds': kinds, 'variants': {v: out[v]['urls'] for v in VARIANTS}})
    pg.wait_for_timeout(500)
    (HERE / 'shots').mkdir(exist_ok=True)
    name = 'compare-sheet' + ('' if len(sys.argv) < 2 else '-' + '-'.join(VARIANTS))
    pg.screenshot(path=str(HERE / 'shots' / f'{name}.png'), full_page=True)
    b.close()
srv.shutdown()
(HERE / 'shots' / f'{name}.json').write_text(json.dumps({v: {k: out[v][k] for k in ('cold', 'warm', 'errors')} for v in out}, indent=1))
shutil.rmtree(tmp, ignore_errors=True)
