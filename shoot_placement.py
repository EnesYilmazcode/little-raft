"""Free placement screenshots. Usage: python shoot_placement.py <dist_dir> <out_dir>
Loads a save with crates and small items, packs a row of crates flush through raftDebug.place (the same
placementFor + edge snap a click uses), puts four candles on one tile, then shoots the row and a live ghost
(green beside the row, red over it). Prints JSON with the placed decor."""
import sys, json, math, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
url = f'http://127.0.0.1:{srv.server_address[1]}/?fixedres'
threading.Thread(target=srv.serve_forever, daemon=True).start()

report = {'errors': [], 'shots': [], 'placed': []}
slots = [{'kind': 'crate', 'count': 6}, {'kind': 'candle', 'count': 4}, {'kind': 'hammer', 'count': 1, 'durability': 100}] + [None] * 25
tiles = [[x, z] for x in (-1, 0, 1) for z in (-1, 0, 1)]
save = {'tiles': tiles, 'decor': [{'type': 'crate', 'x': -1, 'z': 1}], 'stock': {}, 'fish': 0, 'collected': 1,
        'hostInventory': {'slots': slots, 'selected': 0}}  # one old tile-centred crate (save migration: stays at (-2, 2) m)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.add_init_script('localStorage.setItem("little-raft-v1",%s)' % json.dumps(json.dumps(save)))
    page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=60000)
    page.evaluate("document.querySelector('#solo').click()"); page.wait_for_function('raftDebug.state.running', timeout=15000); page.wait_for_timeout(800)

    def look_at(x, y, z):  # turn the camera toward raft-local point (x, y, z) with mouse-move deltas
        for _ in range(6):
            s = page.evaluate('raftDebug.state.camera')
            dx, dy, dz = x - s['x'], y - s['y'], z - s['z']
            want_yaw = math.atan2(-dx, -dz); want_pitch = math.atan2(dy, math.hypot(dx, dz))
            dyaw = (want_yaw - s['yaw'] + math.pi) % (2 * math.pi) - math.pi; dpitch = want_pitch - s['pitch']
            if abs(dyaw) < .01 and abs(dpitch) < .01: break
            page.evaluate(f'document.dispatchEvent(new MouseEvent("mousemove",{{movementX:{-dyaw / .0022},movementY:{-dpitch / .0022}}}))')
            page.wait_for_timeout(120)

    page.keyboard.press('1'); page.wait_for_timeout(200)
    # a row of crates along x on z = -1 m, each aimed ~3 cm short of flush: the edge snap closes the gap to 0
    xs = [-2.0, -0.99, -0.01, 0.97, 1.95]
    for x in xs:
        report['placed'].append(page.evaluate(f'raftDebug.place({x}, -1.0, 0)')); page.wait_for_timeout(150)
    page.keyboard.press('2'); page.wait_for_timeout(200)
    for (x, z) in [(1.6, 1.6), (2.4, 1.6), (1.6, 2.4), (2.4, 2.4)]:  # four candles on tile (1, 1)
        report['placed'].append(page.evaluate(f'raftDebug.place({x}, {z}, 0)')); page.wait_for_timeout(150)
    report['decor'] = page.evaluate('raftDebug.state.decor')
    page.keyboard.press('1'); page.wait_for_timeout(200)
    look_at(0, .2, -1.0); page.wait_for_timeout(500)
    p1 = out / '01-crate-row-red-ghost.png'; page.screenshot(path=str(p1)); report['shots'].append(str(p1))
    report['hoverOnRow'] = page.evaluate('raftDebug.state.build.hover')
    report['me'] = page.evaluate('raftDebug.state.me')
    look_at(-1.2, .2, -.13); page.wait_for_timeout(500)  # just behind the row: the ghost slides flush against it
    p2 = out / '02-crate-row-green-ghost.png'; page.screenshot(path=str(p2)); report['shots'].append(str(p2))
    report['hoverFree'] = page.evaluate('raftDebug.state.build.hover')
    report['frameMsWithGhost'] = page.evaluate('new Promise(r=>{let n=0,t0=performance.now();function f(){if(++n<120)requestAnimationFrame(f);else r((performance.now()-t0)/n)}requestAnimationFrame(f)})')  # software GL: relative only
    page.keyboard.press('5'); page.wait_for_timeout(300)  # empty hand, same view: the baseline without placement checks
    report['frameMsEmptyHand'] = page.evaluate('new Promise(r=>{let n=0,t0=performance.now();function f(){if(++n<120)requestAnimationFrame(f);else r((performance.now()-t0)/n)}requestAnimationFrame(f)})')
    page.keyboard.press('1'); page.wait_for_timeout(300)
    look_at(2, .2, 2); page.wait_for_timeout(500)
    p3 = out / '03-four-candles-one-tile.png'; page.screenshot(path=str(p3)); report['shots'].append(str(p3))
    b.close()
srv.shutdown()
print(json.dumps(report, indent=1, default=str))
