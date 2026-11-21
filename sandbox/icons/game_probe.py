"""Real game (patched dist copy, booted through index.html / live.js): fresh localStorage -> Solo -> wait for
baked hotbar icons -> screenshot hotbar + bag; then reload and time the cache-hit path in game.
Usage: python sandbox/icons/game_probe.py <patched dist copy, see adopt_patch.py --apply> <out_dir>"""
import sys, json, time, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright
dist = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/'
rep = {'errors': [], 'console': []}
LS = "Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('littleRaft.icons.')).map(k => [k, localStorage.getItem(k).length]))"
# cache-hit cost in the running game: bakeItemIcons with a warm cache never touches the renderer
HIT = """async () => {
  const b = new URL(document.querySelector('script[type=module][src*=live]')?.src || location.href).searchParams.get('build');
  const g = [...performance.getEntriesByType('resource')].map(e => e.name).find(n => n.includes('/item-icons.js'));
  const T = await import('./vendor/three.module.js'); const m = await import('.' + new URL(g).pathname + new URL(g).search);
  const build = new URL(g).searchParams.get('build'); const ms = [];
  for (let i = 0; i < 5; i++) { const t = performance.now(); const u = await m.bakeItemIcons(T, null, () => null, build, null);
    ms.push(+(performance.now() - t).toFixed(1)); for (const v of Object.values(u)) URL.revokeObjectURL(v); }
  return { build, ms };
}"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 720})
    page = ctx.new_page()
    page.on('pageerror', lambda e: rep['errors'].append(str(e)[:300]))
    page.on('console', lambda m: m.type in ('error', 'warning') and 'ReadPixels' not in m.text and rep['console'].append(m.text[:200]))
    page.goto(url); page.evaluate("for (const k of Object.keys(localStorage)) if (k.startsWith('littleRaft.icons.')) localStorage.removeItem(k)")
    page.reload(); page.wait_for_function('!!window.raftDebug', timeout=120000)
    t0 = time.time()
    page.evaluate("document.querySelector('#solo').click()"); page.wait_for_function('raftDebug.state.running', timeout=120000)
    page.wait_for_function("document.querySelectorAll('.tools img.sv-baked').length > 0", timeout=300000, polling=250)
    rep['freshBakedAfterS'] = round(time.time() - t0, 1)
    page.wait_for_timeout(1500)
    rep['ls'] = page.evaluate(LS)
    page.screenshot(path=str(out / 'game-hotbar.png'), timeout=180000)
    bb = page.evaluate("(() => { const r = document.querySelector('.tools').getBoundingClientRect(); return {x: r.x - 4, y: r.y - 4, width: r.width + 8, height: r.height + 8}; })()"); rep['hotbarBox'] = bb
    page.keyboard.press('Tab'); page.wait_for_timeout(1200)
    page.screenshot(path=str(out / 'game-bag.png'), timeout=180000)
    page.keyboard.press('Tab')
    rep['cacheHitInGame'] = page.evaluate(HIT)
    page.reload(); page.wait_for_function('!!window.raftDebug', timeout=120000)
    page.evaluate("document.querySelector('#solo').click()"); page.wait_for_function('raftDebug.state.running', timeout=120000)
    t1 = time.time()
    page.wait_for_function("document.querySelectorAll('.tools img.sv-baked').length > 0", timeout=120000, polling=100)
    rep['reloadHotbarBakedAfterS'] = round(time.time() - t1, 2)
    b.close()
srv.shutdown()
print(json.dumps(rep, indent=1))
