"""Shared helpers for Python audit tests: static server on a free port and a headless Chromium."""
import os, threading, functools, http.server, socketserver, contextlib
from pathlib import Path

DIST = Path(os.environ.get('RAFT_DIST') or Path(__file__).resolve().parents[2] / 'dist').resolve()
CHROMIUM = os.environ.get('CHROMIUM') or ('/opt/pw-browsers/chromium' if Path('/opt/pw-browsers/chromium').exists() else None)
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']

class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

class _Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True
    def handle_error(self, *a): pass

def serve(directory=DIST):
    srv = _Server(('127.0.0.1', 0), functools.partial(_Quiet, directory=str(directory)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f'http://127.0.0.1:{srv.server_address[1]}/', srv

@contextlib.contextmanager
def launch(viewport=(1280, 720), scale=1, init_script=None):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        kw = {'executable_path': CHROMIUM} if CHROMIUM else {}
        b = p.chromium.launch(headless=True, args=ARGS, **kw)
        ctx = b.new_context(viewport={'width': viewport[0], 'height': viewport[1]}, device_scale_factor=scale)
        ctx.set_default_timeout(120000)
        page = ctx.new_page()
        if init_script: page.add_init_script(init_script)
        try: yield b, page
        finally: b.close()
