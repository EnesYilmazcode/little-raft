"""First-person held-item screenshots. Usage: python check_held_items.py <dist_dir> <out_dir> [kind ...]
Starts its own static server, plays a fresh solo game, gives the kinds nine at a time (hotbar slots 2-0),
selects each one and screenshots the viewmodel. Prints JSON (shots, held kinds, page errors)."""
import os, sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

DEFAULT = ['hammer', 'axe', 'spear', 'wood', 'plastic', 'stone', 'clay', 'metalingot', 'glass', 'puffegg', 'feather', 'shell',
           'cookedfish', 'meal_stew', 'berries', 'coconutcup', 'paint_coral', 'bucket', 'milk', 'scraper', 'goggles', 'fins',
           'stormshard', 'stormrod', 'kiln', 'bed', 'motor', 'cookpot', 'sharkmeat', 'honey', 'binoculars', 'metalhook']

dist = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)
kinds = sys.argv[3:] or DEFAULT

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{port}/?fixedres'
report = {'errors': [], 'shots': [], 'held': {}}

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    for i in range(0, len(kinds), 9):  # a fresh context per batch: empty bag, no save to continue
        batch = kinds[i:i + 9]
        ctx = b.new_context(viewport={'width': 1280, 'height': 720}, device_scale_factor=float(os.environ.get('HELD_SCALE', '1')))  # HELD_SCALE=2: sharper close-ups
        page = ctx.new_page()
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=60000)
        page.locator('.ob-item[data-act="new"]:visible, #solo:visible').first.click()
        page.wait_for_function('raftDebug.state.running', timeout=15000)
        page.wait_for_timeout(1200)
        for k in batch: page.evaluate('k => raftDebug.give(k, 1)', k)
        slots = page.evaluate('raftDebug.state.inventory.slots.map(s => s && s.kind)')
        for k in batch:
            if k not in slots or slots.index(k) > 9: report['errors'].append(f'{k}: not on the hotbar'); continue
            page.keyboard.press(str((slots.index(k) + 1) % 10))
            page.wait_for_timeout(900)
            report['held'][k] = page.evaluate('raftDebug.state.viewmodel && raftDebug.state.viewmodel.held')
            path = out / f'{k}.png'; page.screenshot(path=str(path)); report['shots'].append(str(path))
            page.screenshot(path=str(out / f'{k}-close.png'), clip={'x': 640, 'y': 300, 'width': 640, 'height': 420})  # the viewmodel corner
        ctx.close()
    b.close()
print(json.dumps(report, indent=1))
