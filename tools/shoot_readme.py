"""README media capture (Windows, real GPU via installed Chrome). Usage: python tools/shoot_readme.py dist <outdir> [fresh,built]
Writes PNG shots plus gif-<name>/ frame folders; turn frames into GIFs with ffmpeg palettegen/paletteuse."""
import sys, json, threading, functools, http.server, socketserver, math
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)
only = sys.argv[3].split(',') if len(sys.argv) > 3 else None

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{port}/?fixedres'
log = {'errors': []}

def shot(page, name): page.screenshot(path=str(out / f'{name}.png'))
def frames(page, name, n, step=None, wait=70):
    d = out / f'gif-{name}'; d.mkdir(exist_ok=True)
    for i in range(n):
        if step: step(i)
        page.wait_for_timeout(wait); page.screenshot(path=str(d / f'{i:04d}.png'))
def click(page, sel): page.evaluate('s => document.querySelector(s).click()', sel)
def start(page):
    page.locator('.ob-item[data-act="new"]:visible, #newGame:visible, #solo:visible').first.click()
    page.wait_for_function('raftDebug.state.running', timeout=20000)
def hide_quest(page):  # hide the onboarding checklist so the scene is clean
    page.add_style_tag(content='.ob-panel,#obPanel,[class*="onboard"],[id*="onboard"]{display:none!important}')

T = lambda x, z: [x, z]
tiles = [[x, z] for x in range(-2, 3) for z in range(-1, 3)] + [[3, 0], [3, 1], [-3, 1]]
decor = [{'type': 'sail', 'x': 0, 'z': -1}, {'type': 'palm', 'x': -2, 'z': 2}, {'type': 'palm', 'x': -1, 'z': 2},
         {'type': 'purifier', 'x': 2, 'z': 2}, {'type': 'crate', 'x': 2, 'z': -1}, {'type': 'bench', 'x': -2, 'z': 0},
         {'type': 'lantern', 'x': 1, 'z': 1}, {'type': 'lantern', 'x': -1, 'z': 0}, {'type': 'receiver', 'x': 3, 'z': 1},
         {'type': 'antenna', 'x': -3, 'z': 1}, {'type': 'rainbarrel', 'x': 1, 'z': 2}, {'type': 'net', 'x': 3, 'z': 0},
         {'type': 'hammock', 'x': -2, 'z': 1}, {'type': 'cookpot', 'x': 0, 'z': 2}, {'type': 'flagpole', 'x': 2, 'z': 0}]
slots = [{'kind': 'hook', 'count': 1, 'durability': 100}, {'kind': 'hammer', 'count': 1, 'durability': 100},
         {'kind': 'fishingrod', 'count': 1, 'durability': 100}, {'kind': 'crate', 'count': 3}, {'kind': 'bench', 'count': 2},
         {'kind': 'wood', 'count': 20}, {'kind': 'plastic', 'count': 20}, {'kind': 'leaf', 'count': 14}, {'kind': 'scrap', 'count': 9}, {'kind': 'rope', 'count': 6}] + [None] * 18
SAVE = {'tiles': tiles, 'decor': decor, 'stock': {}, 'fish': 3, 'collected': 40, 'hostInventory': {'slots': slots, 'selected': 0}}

def built(b):
    pg = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    pg.on('pageerror', lambda e: log['errors'].append(str(e)[:200]))
    pg.add_init_script('localStorage.setItem("little-raft-v1",%s);localStorage.setItem("little-raft-onboarding-v1",JSON.stringify({done:true,dismissed:true}))' % json.dumps(json.dumps(SAVE)))
    pg.goto(URL); pg.wait_for_function('!!window.raftDebug', timeout=60000)
    click(pg, '#solo') if pg.locator('#solo').count() else start(pg)
    pg.wait_for_function('raftDebug.state.running', timeout=20000); pg.wait_for_timeout(1500)
    return pg

def want(k): return only is None or k in only

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'])
    if want('fresh'):
        pg = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
        pg.on('pageerror', lambda e: log['errors'].append(str(e)[:200]))
        pg.goto(URL); pg.wait_for_function('!!window.raftDebug', timeout=60000); pg.wait_for_timeout(2500)
        shot(pg, 'title')
        start(pg); pg.wait_for_timeout(2500); shot(pg, 'spawn')
        pg.evaluate('raftDebug.aim(-0.12)'); pg.mouse.move(640, 360)
        st = {'i': 0}
        def throw(i):
            if i == 2: pg.mouse.down()
            if i == 14: pg.mouse.up()
            if i == 34: pg.mouse.down()
        frames(pg, 'hook', 70, throw, 60); pg.mouse.up()
        pg.keyboard.press('Tab'); pg.wait_for_timeout(700); shot(pg, 'inventory')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300); pg.keyboard.press('Escape'); pg.wait_for_timeout(500); shot(pg, 'pause')
    if want('built'):
        pg = built(b)
        pg.add_style_tag(content='#obNotes{display:none!important}')
        dn = 'raftDebug.content.daynight'
        pg.evaluate(f'{dn}?.setPhase(0.3); {dn}?.setWeather("calm"); {dn}?.freeze(true)')
        log['decor'] = len(pg.evaluate('raftDebug.state.decor')); log['me'] = pg.evaluate('raftDebug.state.me')
        frames(pg, 'deck-pan', 64, lambda i: pg.evaluate(f'raftDebug.aim(-0.22, {i * 0.1})'), 50)
        pg.keyboard.press('2'); pg.evaluate('raftDebug.aim(-0.6, 3.4)'); pg.wait_for_timeout(700); shot(pg, 'build-ghost')
        pg.keyboard.press('4'); pg.evaluate('raftDebug.aim(-0.75, 2.4)'); pg.wait_for_timeout(700); shot(pg, 'place-decor')
        pg.keyboard.press('1')
        try:
            pg.evaluate('raftDebug.shark.forceAttack()'); pg.wait_for_timeout(1500)
            def track(i):
                q = pg.evaluate('raftDebug.shark.pose')
                if q: pg.evaluate(f'raftDebug.aim(-0.5, Math.atan2(-({q["x"]}-raftDebug.state.me.x), -({q["z"]}-raftDebug.state.me.z)))')
            frames(pg, 'shark', 60, track, 60); shot(pg, 'shark')
            log['sharkPose'] = pg.evaluate('raftDebug.shark.pose'); log['sharkState'] = pg.evaluate('raftDebug.shark.state')
        except Exception as e: log['errors'].append('shark ' + str(e)[:200])
        pg.evaluate('raftDebug.shark.kill()')
        pg.evaluate('raftDebug.swimAt(7, 10, -0.04, Math.atan2(7, 9))'); pg.evaluate('raftDebug.setVitals({hp:100,food:100,water:100})'); pg.wait_for_timeout(1500); shot(pg, 'raft-from-water')
        frames(pg, 'daynight', 56, lambda i: pg.evaluate(f'{dn}?.setPhase({0.35 + i * 0.011}); raftDebug.setVitals({{hp:100,food:100,water:100}})'), 90)
        pg.evaluate(f'{dn}?.setPhase(0.95)'); pg.wait_for_timeout(1000); shot(pg, 'night')
        pg.evaluate(f'{dn}?.setPhase(0.42); {dn}?.setWeather("rain")'); pg.wait_for_timeout(4000); shot(pg, 'rain')
    b.close()
srv.shutdown()
print(json.dumps(log, indent=1, default=str))
