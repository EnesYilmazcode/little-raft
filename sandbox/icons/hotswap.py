"""Real live.js hot swap of the game with main's or the merged item icons (adapted from the round-3 judge probe).

  python sandbox/icons/hotswap.py [main|merged] [ok|fail]     (defaults: merged ok)

Boots the real game (index.html -> live.js, Solo, seeded save) from a temp copy of dist/ (merged: patched with
adopt_patch.apply), then publishes build B (every build id rewritten, version.json bumped) and calls
raftLive.check().
  ok:   waits for the hotbar to show 8 3D icons before the swap; after the swap counts live 128x128 icon
        contexts until both module copies drain and release, and the peak during the swap.
  fail: swaps early (the old copy still has uncached kinds) and B's game.js mount() throws right after its
        survival UI is created (the new item-icons copy has claimed the queue by then). live.js keeps the old
        engine; the old item-icons copy must finish its uncached kinds (oldCopyRendered rises to its total).
Writes shots/hotswap-<variant>-<mode>.png (bag after the swap) and prints JSON."""
import sys, json, shutil, tempfile, threading, functools, http.server, socketserver, time
from pathlib import Path
from playwright.sync_api import sync_playwright
HERE = Path(__file__).resolve().parent; ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from adopt_patch import check, apply, save_script, CHROME, ARGS  # noqa: E402

V = sys.argv[1] if len(sys.argv) > 1 else 'merged'
MODE = sys.argv[2] if len(sys.argv) > 2 else 'ok'
tmp = Path(tempfile.mkdtemp(prefix='icons-hs-')) / 'dist'
shutil.copytree(ROOT / 'dist', tmp)
if V == 'merged': apply(tmp, check(tmp)[1])
A = 'v3-survival-ae77fa84ac2b'; B = 'v3-survival-hotswapb0001'
FAIL_AT = '    prog.installUI(); // [progression-hook]\n'

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=str(tmp)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/'
INIT = """
window.__gls = []; window.__links = 0;
const gc = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (t, ...a) { const c = gc.call(this, t, ...a); if (/webgl/.test(t) && c && !__gls.includes(c)) __gls.push(c); return c; };
for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) { const L = C.prototype.linkProgram; C.prototype.linkProgram = function (p) { if (this.canvas.width === 128) __links++; return L.call(this, p); }; }
window.__ctx = () => { const icon = __gls.filter(c => c.canvas.width === 128 && c.canvas.height === 128); return { iconCreated: icon.length, iconLive: icon.filter(c => !c.isContextLost()).length, allCreated: __gls.length, allLive: __gls.filter(c => !c.isContextLost()).length, iconLinks: __links }; };
window.__peak = 0; setInterval(() => { const n = __ctx().iconLive; if (n > __peak) __peak = n; }, 50);
"""
# Icons the OLD module copy (build A) has cached. Importing the same URL returns the live instance; getItemIcon on
# a superseded copy returns null without claiming, so asking does not hide a stuck copy.
OLD = """(async () => { const m = await import('./item-icons.js?build=%s'); const { ITEM_INFO } = await import('./inventory-state.js?build=%s');
  const ks = Object.keys(ITEM_INFO); return ks.filter(k => m.getItemIcon(k)).length; })()""" % (A, A)
HOT = "document.querySelectorAll('.tools img.sv-3d').length"
rep = {'variant': V, 'mode': MODE, 'console': []}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, headless=True, args=ARGS)
    ctx = b.new_context(viewport={'width': 1280, 'height': 720}); ctx.set_default_timeout(400000)
    ctx.add_init_script(save_script()); ctx.add_init_script(INIT)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: rep['console'].append('PAGEERR ' + str(e)[:200]))
    pg.on('console', lambda m: m.type in ('error', 'warning') and rep['console'].append(m.type + ' ' + m.text[:200]))
    pg.goto(url); pg.wait_for_function('!!window.raftDebug', timeout=200000)
    pg.evaluate("document.querySelector('#solo').click()"); pg.wait_for_function('raftDebug.state.running', timeout=200000)
    t0 = time.time()
    if MODE == 'ok':
        pg.wait_for_function(HOT + ' >= 8', timeout=400000, polling=250)
        rep['A_hotbar3dS'] = round(time.time() - t0, 1)
        pg.wait_for_timeout(1500)
    else:
        pg.wait_for_timeout(3000)
    rep['A_ctxBeforeSwap'] = pg.evaluate('__ctx()')
    rep['oldCopyRenderedBeforeSwap'] = pg.evaluate(OLD)
    for f in tmp.rglob('*'):   # build B: rewrite every build id, publish version.json
        if f.suffix in ('.js', '.html', '.css', '.json') and 'vendor' not in f.parts:
            s = f.read_text(errors='ignore')
            if A in s: f.write_text(s.replace(A, B))
    if MODE == 'fail':
        g = tmp / 'game.js'; s = g.read_text(); assert s.count(FAIL_AT) == 1
        g.write_text(s.replace(FAIL_AT, "    throw new Error('hotswap probe: mount failed');\n" + FAIL_AT))
    (tmp / 'version.json').write_text(json.dumps({'build': B, 'protocol': 1}))
    pg.evaluate('window.__peak = 0')
    t1 = time.time()
    rep['swap'] = pg.evaluate('raftLive.check()')
    rep['swapS'] = round(time.time() - t1, 1)
    rep['afterSwapCtx'] = pg.evaluate('__ctx()')
    if MODE == 'ok':
        try:
            pg.wait_for_function(HOT + ' >= 8', timeout=400000, polling=250); rep['B_hotbar3dS'] = round(time.time() - t1, 1)
        except Exception: rep['B_hotbar3dS'] = 'timeout'
        rep['B_hotbar'] = pg.evaluate("[...document.querySelectorAll('.tools .sv-slot')].slice(0, 8).map(s => s.querySelector('img.sv-3d') ? 'img' : 'svg')")
    c = None; prev = -1; still = 0
    for i in range(100):   # let the queues drain and release (fail: until the old copy stops gaining icons)
        pg.wait_for_timeout(3000)
        c = pg.evaluate('__ctx()')
        n = pg.evaluate(OLD); still = still + 1 if n == prev else 0; prev = n
        if c['iconLive'] == 0 and (MODE == 'ok' or still >= 3): break
    rep['settledCtx'] = c; rep['settledAfterS'] = round(time.time() - t1, 1)
    rep['oldCopyRenderedAfter'] = prev
    rep['peakIconLiveDuringSwap'] = pg.evaluate('__peak')
    rep['build'] = pg.evaluate('raftLive.build')
    pg.keyboard.press('Tab'); pg.wait_for_timeout(2500)
    rep['bag'] = pg.evaluate("(() => { const d = document.querySelector('#inventory'); return d && { open: d.open, img3d: d.querySelectorAll('img.sv-3d').length, svg: d.querySelectorAll('svg.sv-icon').length }; })()")
    (HERE / 'shots').mkdir(exist_ok=True)
    pg.screenshot(path=str(HERE / 'shots' / f'hotswap-{V}-{MODE}.png'))
    b.close()
srv.shutdown(); shutil.rmtree(tmp.parent, ignore_errors=True)
print(json.dumps(rep, indent=1))
