"""Real hot swap through dist/live.js on a patched copy of dist/ (icons ADOPT applied).

  python sandbox/icons/hotswap.py midswap  [out_dir]   # swap to a new build while the first bake runs
  python sandbox/icons/hotswap.py postswap [out_dir]   # swap after the first bake has landed

Builds <out_dir>/dist = current dist/ + adopt_patch.py --apply (default out_dir: a temp dir), boots
index.html (live.js) headless, then makes version.json announce build NEW. live.js imports
game.js?build=NEW; the route handler serves every ?build=NEW file with its build ids rewritten, like a
release. Instrumentation is injected into the served files only:
  - icon-atlas.js pushes '<build>:<kind>' to window.__tiles per baked tile
  - game.js pushes 'DISPOSE:<build>' when an engine is disposed, and exposes window.__lastEngine
  - URL.createObjectURL / revokeObjectURL are counted
Pass: no old-build tile after DISPOSE, 15 blob URLs live at the end, renderer state restored, one
localStorage key (the new build's). Prints JSON."""
import sys, json, shutil, tempfile, threading, functools, http.server, socketserver
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import adopt_patch as ap  # noqa: E402

scen = sys.argv[1] if len(sys.argv) > 1 else 'midswap'
out = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else Path(tempfile.mkdtemp(prefix='icons-hotswap-'))
OLD = ap.build_id(); NEW = 'v3-test-hotswap'
dist = out / 'dist'
if dist.exists(): shutil.rmtree(dist)
shutil.copytree(ap.DIST, dist)
(dist / 'survival-ui.js').write_text(ap.patched_survival_ui())
(dist / 'game.js').write_text(ap.apply((ap.DIST / 'game.js').read_text(), ap.game_patches(OLD), 'game.js'))
(dist / 'icon-atlas.js').write_text((HERE / 'icon-atlas.js').read_text())
(dist / 'item-icons.js').write_text(ap.dist_item_icons(OLD))

def instrument(name, text, build):
    if name == 'icon-atlas.js' and scen == 'midswap' and build == OLD:
        # widen the window so live.js's 6 s poll lands mid-bake: the old build yields 2 s per tile
        text = text.replace("const nextFrame = () =>", "const nextFrame = () => new Promise(q => setTimeout(q, 2000)).then(nextFrame0);\nconst nextFrame0 = () =>", 1)
    if name == 'icon-atlas.js':
        text = text.replace("      tiles.push({ kind: it.kind,",
                            "      (window.__tiles = window.__tiles || []).push(new URL(import.meta.url).searchParams.get('build') + ':' + it.kind); tiles.push({ kind: it.kind,")
    if name == 'game.js':
        text = text.replace("    pause(); disposed = true; ac.abort();\n",
                            "    pause(); disposed = true; ac.abort(); (window.__tiles = window.__tiles || []).push('DISPOSE:' + new URL(import.meta.url).searchParams.get('build'));\n")
        text = text.replace("  return {capture, pause, resume, dispose};\n}", "  window.__lastEngine = {capture}; return {capture, pause, resume, dispose};\n}")
    return text

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{srv.server_address[1]}/'
announced = {'build': OLD}

def route(r):
    u = urlparse(r.request.url); name = u.path.lstrip('/') or 'index.html'
    if name == 'version.json':
        return r.fulfill(status=200, content_type='application/json', body=json.dumps({'build': announced['build'], 'protocol': 1}))
    b = parse_qs(u.query).get('build', [None])[0]
    f = dist / name
    if name.endswith('.js') and f.is_file():
        text = f.read_text()
        if b == NEW: text = text.replace(OLD, NEW)
        return r.fulfill(status=200, content_type='text/javascript', body=instrument(name, text, b or OLD), headers={'Cache-Control': 'no-store'})
    return r.continue_()

INIT = r"""window.__blobs=0; window.__revoked=0; window.__live=new Set();
const oc=URL.createObjectURL, orv=URL.revokeObjectURL;
URL.createObjectURL=function(b){window.__blobs++; const u=oc.call(URL,b); window.__live.add(u); return u};
URL.revokeObjectURL=function(u){if(window.__live.delete(u))window.__revoked++; return orv.call(URL,u)};"""
LS = "Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('littleRaft.icons.')).map(k => [k, localStorage.getItem(k).length]))"
CNT = "({baked: document.querySelectorAll('img.sv-baked').length, blobs: __blobs, revoked: __revoked, liveBlobs: __live.size, tiles: (window.__tiles || []).slice()})"
INFO = "(() => { const r = window.__lastEngine.capture().renderer; return { programs: r.info.programs.length, textures: r.info.memory.textures, geometries: r.info.memory.geometries, autoClear: r.autoClear, renderTarget: !!r.getRenderTarget(), shadowMap: r.shadowMap.enabled }; })()"
R = {'scen': scen, 'old': OLD, 'new': NEW, 'errors': [], 'console': []}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 720}); ctx.add_init_script(INIT)
    page = ctx.new_page(); page.route('**/*', route)
    page.on('pageerror', lambda e: R['errors'].append(str(e)[:300]))
    page.on('console', lambda m: m.type in ('error', 'warning') and 'ReadPixels' not in m.text and R['console'].append(m.text[:200]))
    page.goto(base); page.wait_for_function('!!window.__lastEngine && !!window.raftDebug', timeout=120000)
    page.evaluate("for (const k of Object.keys(localStorage)) if (k.startsWith('littleRaft.icons.')) localStorage.removeItem(k)")
    page.reload(); page.wait_for_function('!!window.__lastEngine && !!window.raftDebug', timeout=120000)
    if scen == 'midswap':
        page.wait_for_function('(window.__tiles || []).length >= 2', timeout=300000, polling=50)
    else:
        page.wait_for_function("document.querySelectorAll('img.sv-baked').length > 0", timeout=300000, polling=100)
        page.wait_for_timeout(500)
    R['before'] = page.evaluate(CNT); R['infoBefore'] = page.evaluate(INFO); R['lsBefore'] = page.evaluate(LS)
    announced['build'] = NEW   # live.js polls version.json every 6 s
    page.wait_for_function("(window.__tiles || []).some(t => t.startsWith('DISPOSE:'))", timeout=120000, polling=50)
    page.wait_for_function(f"document.querySelectorAll('img.sv-baked').length > 0 && __blobs >= {R['before']['blobs'] + 15}", timeout=400000, polling=100)
    page.wait_for_timeout(20000)   # an orphaned old bake would finish in this window
    R['after'] = page.evaluate(CNT); R['infoAfter'] = page.evaluate(INFO); R['lsAfter'] = page.evaluate(LS)
    t = R['after']['tiles']; d = t.index(next(x for x in t if x.startswith('DISPOSE:')))
    R['oldTilesAfterDispose'] = [x for x in t[d:] if x.startswith(OLD + ':')]
    R['newTiles'] = len([x for x in t if x.startswith(NEW + ':')])
    page.screenshot(path=str(out / f'hotswap-{scen}.png'), timeout=180000)
    b.close()
srv.shutdown()
R['pass'] = (not R['oldTilesAfterDispose'] and R['after']['liveBlobs'] == 15 and list(R['lsAfter']) == [f'littleRaft.icons.ia4.{NEW}']
             and R['infoAfter']['autoClear'] and not R['infoAfter']['renderTarget'] and not R['errors'])
print(json.dumps(R, indent=1))
