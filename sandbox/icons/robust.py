"""Failure paths of the merged item-icons.js in Chromium. Usage: python sandbox/icons/robust.py
Temp tree = dist/ copy patched with adopt_patch.apply + sandbox/icons/. Cases: provider throws, provider
returns an empty model, kind without model, own stand-in model, context loss mid-queue, provider swap,
hot swap (two module copies), failed hot swap (new copy claims then is disposed: old copy owns again), contexts released after the queue drains. Prints JSON; exit 1 on a failed case."""
import sys, json, shutil, tempfile, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright
HERE = Path(__file__).resolve().parent; ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from adopt_patch import check, apply, CHROME, ARGS  # noqa: E402

tmp = Path(tempfile.mkdtemp(prefix='icons-robust-'))
shutil.copytree(ROOT / 'dist', tmp / 'dist')
shutil.copytree(HERE, tmp / 'sandbox' / 'icons', ignore=shutil.ignore_patterns('shots', '__pycache__'))
apply(tmp / 'dist', check(tmp / 'dist')[1])
(tmp / 'sandbox' / 'icons' / 'robust.html').write_text('<!doctype html><meta charset="utf-8"><script type="module" src="./robust.js"></script>')

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(tmp)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, headless=True, args=ARGS)
    pg = b.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
    pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/sandbox/icons/robust.html')
    pg.wait_for_function('window.__robust && window.__robust.done', timeout=600000, polling=500)
    r = pg.evaluate('window.__robust'); r['pageErrors'] = errs
    b.close()
srv.shutdown(); shutil.rmtree(tmp, ignore_errors=True)
print(json.dumps(r, indent=1))
sys.exit(0 if r.get('ok') and not errs else 1)
