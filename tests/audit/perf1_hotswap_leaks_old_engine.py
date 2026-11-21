"""AUDIT PERF-1 (browser): every live.js hot swap leaks the previous engine's whole scene graph (JS side).

game.js setHandler() keeps [el, prop, previous, next] in `propertyHandlers` for the engine's lifetime; `previous`
is the old engine's guarded onclick closure, so engine N retains engine N-1's scope (raft, itemsGroup, ocean,
hands ...), which retains N-2, and so on.

Test: start a solo game, hold a WeakRef to the first engine's ocean mesh, trigger 2 hot swaps (version.json build
bump, as live.js polls), force GC, and assert the first engine's ocean mesh was collected.
Exit 0 = pass, 1 = leak. Works from tests/audit/ (dist = parents[2]/dist) or with RAFT_DIST.
"""
import sys, json, threading, functools, http.server, socketserver, os
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(os.environ.get('RAFT_DIST') or Path(__file__).resolve().parents[2] / 'dist').resolve()
CHROMIUM = os.environ.get('CHROMIUM') or ('/opt/pw-browsers/chromium' if Path('/opt/pw-browsers/chromium').exists() else None)
SWAPS = 2

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def main():
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{srv.server_address[1]}/'
    proto = json.loads((dist / 'version.json').read_text()).get('protocol', 0)
    build = {'n': 0}
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(**({'executable_path': CHROMIUM} if CHROMIUM else {}), headless=True,
                                  args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
            ctx = b.new_context(viewport={'width': 480, 'height': 270})
            ctx.route('**/version.json*', lambda r: r.fulfill(status=200, content_type='application/json',
                      body=json.dumps({'build': f'b{build["n"]}', 'protocol': proto})))
            page = ctx.new_page(); cdp = ctx.new_cdp_session(page); cdp.send('HeapProfiler.enable')
            page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=90000)
            page.locator('#solo').click(); page.wait_for_function('raftDebug.state.running', timeout=90000)
            # Weakly remember the first engine's ocean mesh (no strong refs kept by the test).
            page.evaluate("""import('./vendor/three.module.js').then(T => new Promise(res => {
                const orig = T.Mesh.prototype.onBeforeRender;
                T.Mesh.prototype.onBeforeRender = function () { if (this.name === 'ocean' && !window.__oldOcean) { window.__oldOcean = new WeakRef(this); T.Mesh.prototype.onBeforeRender = orig; res(); } };
            }))""")
            for i in range(1, SWAPS + 1):
                build['n'] = i
                page.wait_for_function(f"performance.getEntriesByType('resource').some(e => e.name.includes('game.js?build=b{i}'))", timeout=120000)
                page.wait_for_function('!!window.raftDebug && raftDebug.state.running', timeout=90000)
                page.wait_for_timeout(2000)
            for _ in range(3): cdp.send('HeapProfiler.collectGarbage')
            alive = page.evaluate('!!window.__oldOcean.deref()')
            b.close()
    finally:
        srv.shutdown()
    if alive:
        print(f'FAIL: first engine\'s ocean mesh is still reachable after {SWAPS} hot swaps + GC (old engine scene graph leaked)')
        return 1
    print(f'PASS: first engine collected after {SWAPS} hot swaps')
    return 0

if __name__ == '__main__':
    sys.exit(main())
