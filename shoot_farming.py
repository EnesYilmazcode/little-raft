"""Headless farming probe. Usage: python shoot_farming.py <dist_dir> <out_dir>
Seeds a save with planters in every growth stage, then waters, harvests, replants,
fills a cup at the sea, watches a stage change live and reloads to check the save."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/'

slots = [None] * 28
slots[0] = {'kind': 'hook', 'count': 1, 'durability': 100}
slots[1] = {'kind': 'water', 'count': 2}
slots[2] = {'kind': 'seed', 'count': 2}
slots[3] = {'kind': 'cup', 'count': 1}
bag = {'slots': slots, 'selected': 0}
world = {
    'tiles': [[x, z] for z in (-2, -1, 0, 1) for x in (-1, 0, 1)],
    'decor': [
        {'type': 'palm', 'x': -1, 'z': -2, 'farm': {'s': 1, 'g': 10, 'w': 60}},
        {'type': 'palm', 'x': 0, 'z': -2, 'farm': {'s': 0, 'g': 44, 'w': 60}},  # turns sprout in ~6 s
        {'type': 'palm', 'x': 1, 'z': -2, 'farm': {'s': 2, 'g': 10, 'w': 0}},   # dry young palm
        {'type': 'palm', 'x': -1, 'z': -1},                                  # legacy save: no farm field
        {'type': 'palm', 'x': 0, 'z': -1, 'farm': {'s': 0, 'g': 0, 'w': 0}},  # dry seedling
        {'type': 'palm', 'x': 1, 'z': -1, 'farm': {'s': -1, 'g': 0, 'w': 0}},   # empty planter
    ],
    'stock': {}, 'fish': 0, 'collected': 3, 'hookHealth': 100, 'items': [],
    'hostInventory': bag, 'guestInventory': {'slots': [None] * 28, 'selected': 0},
}
report = {'errors': [], 'console': [], 'shots': [], 'steps': {}}
def shot(page, name):
    p = out / f'{name}.png'; page.screenshot(path=str(p)); report['shots'].append(str(p))
def farm(page): return {f"{d['x']},{d['z']}": [d['s'], round(d['w']), d['shown']] for d in page.evaluate('raftDebug.state.farm')}
def counts(page): s = page.evaluate('raftDebug.state.stock'); return {k: s.get(k, 0) for k in ('water', 'cup', 'seed', 'leaf')}
def aim(page, x, y, z):
    s = page.evaluate(f'raftDebug.project({x},{y},{z})'); page.mouse.move(s['x'], s['y']); page.wait_for_timeout(150)
def click(page, x, y, z): aim(page, x, y, z); page.mouse.down(); page.mouse.up(); page.wait_for_timeout(400)

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type in ('error', 'warning') and report['console'].append(m.text[:300]))
    seed = json.dumps(json.dumps(world))  # init script: lands before the game reads it, and beforeunload saves cannot clobber it
    page.add_init_script(f"if (!sessionStorage.getItem('farmSeeded')) {{ sessionStorage.setItem('farmSeeded', '1'); localStorage.setItem('little-raft-v1', {seed}); }}")
    page.goto(url)
    page.wait_for_function('!!window.raftDebug', timeout=20000)
    page.locator('#solo').click(); page.wait_for_function('raftDebug.state.running', timeout=15000)
    page.wait_for_timeout(1200)
    report['steps']['loaded'] = farm(page)
    shot(page, '01-stages')
    report['me'] = page.evaluate('raftDebug.state.me')
    # water the dry seedling at (0,-2)
    page.keyboard.press('2'); page.wait_for_timeout(200)
    aim(page, 0, .72, -2); page.wait_for_timeout(300); shot(page, '03-aim-dry-seedling')
    report['steps']['prompt'] = page.evaluate("document.querySelector('#contextPrompt')?.textContent")
    click(page, 0, .72, -2)
    report['steps']['watered'] = {'farm': farm(page), 'bag': counts(page)}
    shot(page, '04-watered')
    # harvest the legacy palm at (-1,-2) with E
    page.keyboard.press('1'); aim(page, -2, .9, -2); page.keyboard.press('e'); page.wait_for_timeout(400)
    report['steps']['harvested'] = {'farm': farm(page), 'bag': counts(page)}
    # replant it with a seed
    page.keyboard.press('3'); click(page, -2, .72, -2)
    report['steps']['replanted'] = {'farm': farm(page), 'bag': counts(page)}
    shot(page, '05-replanted')
    # fill the cup at the sea beside the raft
    page.keyboard.press('4'); click(page, 3.6, .22, -2.5)
    report['steps']['filled'] = counts(page)
    page.keyboard.press('1'); page.mouse.move(640, 360)
    page.wait_for_timeout(6500)
    report['steps']['live-growth'] = farm(page)
    shot(page, '06-after-growth')
    page.wait_for_timeout(3500)
    page.reload(); page.wait_for_function('!!window.raftDebug', timeout=20000)
    page.locator('#solo').click(); page.wait_for_function('raftDebug.state.running', timeout=15000); page.wait_for_timeout(800)
    report['steps']['after-reload'] = farm(page)
    b.close()
srv.shutdown()
print(json.dumps(report, indent=1, default=str))
