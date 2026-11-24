"""First-person scale capture. Usage: python scripts/shoot-scale.py <dist_dir> <out_dir> <prefix> [fov]
Seeds a 5x5 deck with a row of full walls and a chest, plays solo at 1536x864 with the normal HUD, and shoots
three first-person views: one tile (2 m) from the wall, the open deck, and next to the chest. Also measures where
the wall top lands on screen (raftDebug.project) and the frame time. fov: optional stored setting (else the build's default).
Prints JSON."""
import os, sys, json, math, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)
prefix = sys.argv[3]; fov = float(sys.argv[4]) if len(sys.argv) > 4 else None
W, H = 1536, 864
DECK, LH = 0.2, 2.2
CHROME = os.environ.get('RAFT_CHROME', '/usr/bin/google-chrome')

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/?fixedres'

def P(t, i, j, l, r=0): return {'t': t, 'i': i, 'j': j, 'l': l, 'r': r}
pieces = [P('wall', i, 0, 0, 0) for i in (-2, -1, 0, 1, 2)]  # a row of full walls on z = -1, x in [-5, 5]
slots = [None] * 28
slots[0] = {'kind': 'hook', 'count': 1, 'durability': 100}
slots[1] = {'kind': 'hammer', 'count': 1, 'durability': 100}
for k, kind in enumerate(['wood', 'plastic', 'leaf', 'rope']): slots[2 + k] = {'kind': kind, 'count': 20}
tiles = [[i, j] for i in range(-2, 3) for j in range(-1, 4)]
world = {'tiles': tiles, 'decor': [{'type': 'crate', 'x': 0.5, 'z': 0.75}], 'stock': {}, 'fish': 0, 'collected': 0,
         'hookHealth': 100, 'items': [], 'hostInventory': {'slots': slots, 'selected': 0}, 'guestInventory': None, 'pieces': pieces}
INIT = "try { localStorage.setItem('little-raft-v1', %s); %s } catch (e) {}\n" % (
    json.dumps(json.dumps(world)), ("localStorage.setItem('little-raft-settings', %s);" % json.dumps(json.dumps({'fov': fov}))) if fov else '')
INIT += "(() => { let a = 12345; Math.random = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();\n"  # same weather in both runs
INIT += "HTMLCanvasElement.prototype.requestPointerLock = function(){return Promise.reject(new Error('QA fallback'))};\n"

report = {'errors': [], 'shots': [], 'fov': None}
FRAME_JS = """new Promise(r=>{let n=0,t0=performance.now(),worst=0,last=t0;function f(t){worst=Math.max(worst,t-last);last=t;if(++n<150)requestAnimationFrame(f);else r({avg:(t-t0)/n,worst})}requestAnimationFrame(f)})"""

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': W, 'height': H}); ctx.add_init_script(INIT)
    page = ctx.new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=60000); page.wait_for_timeout(800)
    page.evaluate("document.querySelector('.ob-item[data-act=continue]')?.click() ?? document.querySelector('#solo').click()")
    page.wait_for_function('raftDebug.state.running', timeout=20000); page.wait_for_timeout(1500)
    S = lambda: page.evaluate('raftDebug.state')

    def walk_to(x, z, tol=0.08):
        for _ in range(12):
            me = S()['me']; dx, dz = x - me['x'], z - me['z']; d = math.hypot(dx, dz)
            if d < tol: return True
            page.evaluate(f'raftDebug.aim(0, {math.atan2(-dx, -dz)})')
            page.keyboard.down('KeyW')
            for _ in range(200):
                page.wait_for_timeout(15)
                me = page.evaluate('raftDebug.state.me'); ex, ez = x - me['x'], z - me['z']
                if ex * dx + ez * dz < d * 0.5 * tol: break
            page.keyboard.up('KeyW'); page.wait_for_timeout(400)
        return False

    def shot(name, x, z, pitch, yaw):
        walk_to(x, z); page.evaluate(f'raftDebug.aim({pitch}, {yaw})'); page.wait_for_timeout(1200)
        p = out / f'{prefix}-{name}.png'; page.screenshot(path=str(p))
        st = S(); report['shots'].append({'file': str(p), 'me': st['me'], 'camera': st['camera']})
        return st

    st = shot('wall', 0, 1.0, 0, 0)
    report['fov'] = st['camera']['fov']
    cam = st['camera']; d = cam['z'] - (-1)
    top = page.evaluate(f'raftDebug.project(0, {DECK + LH}, -1)')
    report['wall'] = {'eyeY': cam['y'], 'eyeAboveDeck': cam['y'] - DECK, 'distance': d,
                      'topFromBottom': None if not top else 1 - top['y'] / H,
                      'formula': 0.5 + 0.5 * ((DECK + LH - cam['y']) / d) / math.tan(math.radians(cam['fov']) / 2)}
    report['frameWall'] = page.evaluate(FRAME_JS)
    shot('deck', 0, 1.0, -0.12, math.pi)
    report['frameDeck'] = page.evaluate(FRAME_JS)
    shot('chest', 0, 1.0, -0.45, math.atan2(-1.0, -0.5))  # chest centre at (1.0, 1.5) m, about 1.1 m away
    report['frameChest'] = page.evaluate(FRAME_JS)
    report['decor'] = st.get('decor')
    b.close()
print(json.dumps(report, indent=1))
