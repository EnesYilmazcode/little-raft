"""Bake-config comparison on the sandbox sheet page (DPR 1, fresh context each). Source of the
unify/env table in docs/tech/icons.md. Usage: python sandbox/icons/variants.py <repo_root> [repeat]"""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(sys.argv[1]).resolve(); rep_n = int(sys.argv[2]) if len(sys.argv) > 2 else 1
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{srv.server_address[1]}/sandbox/icons/index.html?mode=sheet'
CONFIGS = {'old: env + per-model materials': '&unify=0&env=1', 'unify + env': '&unify=1&env=1',
           'new default: unify, no env': '', 'new + precompile': '&precompile=1'}
out = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    for _ in range(rep_n):
        for name, qs in CONFIGS.items():
            ctx = b.new_context(viewport={'width': 1280, 'height': 900}); page = ctx.new_page()
            page.goto(base + qs)
            page.wait_for_function('window.__iconReport && window.__iconReport.done', timeout=400000)
            r = page.evaluate('window.__iconReport'); ctx.close()
            s = r.get('stats') or {}; f = r.get('frames') or {}
            out.setdefault(name, []).append({'totalMs': s.get('totalMs'), 'setupMs': s.get('setupMs'),
                'programs': s.get('programsCompiled'), 'calls': (s.get('bakeRender') or {}).get('calls'),
                'worstFrameMs': (f.get('duringBake') or {}).get('worstMs'), 'avgFrameMs': (f.get('duringBake') or {}).get('avgMs'),
                'steadyAvgMs': (f.get('steady') or {}).get('avgMs'), 'keys': s.get('programKeys'), 'errors': r.get('errors')})
            print(name, out[name][-1], file=sys.stderr, flush=True)
    b.close()
srv.shutdown()
print(json.dumps(out, indent=1))
