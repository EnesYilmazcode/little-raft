import sys, json, math, threading, functools, http.server, socketserver, os
from pathlib import Path
from playwright.sync_api import sync_playwright
dist = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/'
SAVE = {'tiles': [[x, z] for z in (-1, 0, 1) for x in (-1, 0, 1)] + [[0, 2], [-1, 2]],
        'decor': [{'type': 'sail', 'x': 0, 'z': 0}], 'fish': 0, 'collected': 5,
        'sailing': {'v': 1, 'windDir': 0.5, 'windStr': 0.9, 'windTarget': 0.5, 'windClock': 120, 'heading': 0.5,
                    'raised': True, 'anchored': False, 'vx': 0.9, 'vz': 0.9, 'wx': 0, 'wz': 0, 'gx': 0, 'gz': 0}}
R = {'errors': [], 'log': []}
def shot(page, name):
    page.screenshot(path=str(out / f'{name}.png'))
    s = page.evaluate('(()=>{const s=raftDebug.state;return {me:s.me,sail:{h:s.sailing.heading,raised:s.sailing.raised,anch:s.sailing.anchored,steer:s.sailing.steering,speed:s.sailing.speed,gx:s.sailing.gx,gz:s.sailing.gz,wind:s.sailing.windDir}}})()')
    R['log'].append({name: s}); print(json.dumps({name: s}, default=str), flush=True)
def st(page): return page.evaluate('raftDebug.state.me')
def drag(page, dx, dy):
    page.mouse.move(640, 360); page.mouse.down()
    page.mouse.move(640 + dx/2, 360 + dy/2, steps=4); page.mouse.move(640 + dx, 360 + dy, steps=4); page.mouse.up()
K = [0.0022]; MP = [640.0, 360.0]
def calib(page):
    drag(page, 10, 0); MP[0] = 650; MP[1] = 360
def rel(page, dx, dy):
    n = max(1, int(max(abs(dx), abs(dy)) // 150) + 1)
    for i in range(n):
        MP[0] += dx / n; MP[1] += dy / n
        page.mouse.move(MP[0], MP[1])
def face(page, yaw, pitch):
    for _ in range(3):
        m = st(page)
        dy = math.atan2(math.sin(yaw - m['yaw']), math.cos(yaw - m['yaw'])); dp = pitch - m['pitch']
        if abs(dy) < .02 and abs(dp) < .02: break
        rel(page, -dy / K[0], -dp / K[0])
def yaw_to(page, x, z):
    m = st(page); return math.atan2(-(x - m['x']), -(z - m['z']))
def walk_to(page, x, z, maxt=4000):
    for _ in range(6):
        m = st(page); d = math.hypot(x - m['x'], z - m['z'])
        if d < .25: break
        face(page, yaw_to(page, x, z), -0.1)
        page.keyboard.down('KeyW'); page.wait_for_timeout(min(maxt, int(d * 1300))); page.keyboard.up('KeyW'); page.wait_for_timeout(250)
def aim_at(page, x, y, z):
    m = st(page); eye = m['y']
    h = math.hypot(x - m['x'], z - m['z'])
    face(page, yaw_to(page, x, z), math.atan2(y - eye, h))

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=os.environ.get('CHROME_PATH') or None, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    page.on('pageerror', lambda e: R['errors'].append(str(e)))
    page.add_init_script('localStorage.setItem("little-raft-v1", %s)' % json.dumps(json.dumps(SAVE)))
    page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=20000)
    page.locator('#solo').click(); page.wait_for_function('raftDebug.state.running', timeout=15000)
    page.wait_for_timeout(1200)
    page.keyboard.press('Digit3'); calib(page); R['K'] = K[0]; print(page.evaluate('raftDebug.state.pointerLocked'), flush=True)
    if len(sys.argv) < 4:
     # compass at 4 yaws, horizon
     for i, yw in enumerate([0, math.pi/2, math.pi, -math.pi/2]):
         face(page, yw, -0.05); page.wait_for_timeout(300); shot(page, f'10-compass-yaw{i*90}')
         page.screenshot(path=str(out / f'11-compass-zoom{i*90}.png'), clip={'x': 1140, 'y': 50, 'width': 135, 'height': 130})
     # islands motion 20s apart
     face(page, 0.5 + math.pi, -0.02)  # look downstream-ish? log which shows islands
     page.wait_for_timeout(300); shot(page, '20-islands-t0')
     page.wait_for_timeout(20000); shot(page, '21-islands-t20')
     # debris flow while sailing, look at water
     face(page, math.pi/2, -0.35); shot(page, '22-debris-a'); page.wait_for_timeout(3000); shot(page, '23-debris-b')
    # pennant: walk away from mast and look up at top
    walk_to(page, 1.6, 1.6)
    aim_at(page, 0, 0.22 + 3.6 + 0.2, 0); page.wait_for_timeout(500); shot(page, '30-pennant')
    aim_at(page, 0, 2.2, 0); page.wait_for_timeout(300); shot(page, '31-sail-from-side')
    # steering: aim at mast, hold R, drag
    walk_to(page, 0, 1.4); aim_at(page, 0, 1.6, 0); page.wait_for_timeout(300); shot(page, '40-aim-sail')
    page.keyboard.down('KeyR'); page.wait_for_timeout(200); shot(page, '41-steer-start')
    rel(page, -0.9 / K[0], 0); page.wait_for_timeout(1500); shot(page, '42-steer-turned')
    page.keyboard.up('KeyR'); page.wait_for_timeout(200)
    aim_at(page, 0, 2.0, 0); page.wait_for_timeout(1500); shot(page, '43-sail-rotated')
    # lower sail
    aim_at(page, 0, 1.6, 0); page.keyboard.press('KeyE'); page.wait_for_timeout(2500); shot(page, '50-sail-furled')
    aim_at(page, 0, 3.3, 0); page.wait_for_timeout(300); shot(page, '51-sail-furled-up')
    walk_to(page, 1.8, -1.5); aim_at(page, 0, 2.2, 0); page.wait_for_timeout(300); shot(page, '52-furled-from-side')
    # anchor
    walk_to(page, -1.4, 3.4); aim_at(page, -2.7, 1.15, 4.7); page.wait_for_timeout(400); shot(page, '60-anchor-aim')
    page.keyboard.press('KeyE'); page.wait_for_timeout(3000); shot(page, '61-anchored')
    aim_at(page, -2.7, -0.5, 5.3); page.wait_for_timeout(300); shot(page, '62-anchor-rope-down')
    walk_to(page, 0.5, 2.0); aim_at(page, -2.7, 0.8, 4.7); page.wait_for_timeout(300); shot(page, '63-anchor-wide')
    aim_at(page, -2.7, 1.15, 4.7)
    walk_to(page, -1.4, 3.4); aim_at(page, -2.7, 1.15, 4.7); page.keyboard.press('KeyE'); page.wait_for_timeout(3000); shot(page, '64-anchor-raised')
    # raise sail again, hook in hand, nice hero
    page.keyboard.press('Digit1'); walk_to(page, 0.3, -2.6); aim_at(page, 0, 1.6, 0); page.keyboard.press('KeyE'); page.wait_for_timeout(2500)
    aim_at(page, 0, 1.9, 2.5); shot(page, '70-hero-forward')
    walk_to(page, -2.2, 3.6); aim_at(page, 0, 2.4, 0); page.wait_for_timeout(300); shot(page, '71-hero-sail-up')
    walk_to(page, -2.0, 4.3); aim_at(page, -2.7, 0.75, 5.27); page.wait_for_timeout(300); shot(page, '65-anchor-close')
    page.screenshot(path=str(out / '66-compass-zoom.png'), clip={'x': 1140, 'y': 50, 'width': 135, 'height': 130})
    R['final'] = page.evaluate('raftDebug.state.sailing')
    b.close()
srv.shutdown()
print(json.dumps({'errors':R['errors'],'final':R.get('final')}, default=str))
