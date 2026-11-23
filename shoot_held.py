"""Held-item probe: python shoot_held.py <dist_dir> <out_dir> [kind ...]
Loads a save whose hotbar holds the given kinds (ten per pass), selects each slot and screenshots the first-person
viewmodel to <out_dir>/<kind>.png (the hotbar icon for the same slot is in the shot too). No kinds = every bag kind."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)
kinds = sys.argv[3:]

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
url = f'http://127.0.0.1:{srv.server_address[1]}/?fixedres'
threading.Thread(target=srv.serve_forever, daemon=True).start()
errors = []
exe = next((p for p in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') if Path(p).exists()), None)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=exe, headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    if not kinds:
        pg = b.new_page(); pg.goto(url); pg.wait_for_function('!!window.raftDebug', timeout=60000)
        u = pg.evaluate("performance.getEntriesByType('resource').map(e=>e.name).find(n=>n.includes('/inventory-state.js'))")
        kinds = pg.evaluate(f"import({json.dumps(u)}).then(m=>m.ITEM_KINDS.slice())"); pg.close()
    for i in range(0, len(kinds), 10):
        group = kinds[i:i + 10]
        slots = [{'kind': k, 'count': 1, 'durability': 100} for k in group] + [None] * (28 - len(group))
        save = {'tiles': [[-1, 0], [0, 0], [-1, 1], [0, 1]], 'decor': [], 'stock': {}, 'fish': 0, 'collected': 1,
                'hostInventory': {'slots': slots, 'selected': 0}}
        ctx = b.new_context(viewport={'width': 1280, 'height': 720}); page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.add_init_script('localStorage.setItem("little-raft-v1",%s);localStorage.setItem("lr-onboarded","1")' % json.dumps(json.dumps(save)))
        page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=60000)
        page.evaluate("document.querySelector('#solo, #newGame')?.click()")
        page.wait_for_function('raftDebug.state.running', timeout=20000); page.wait_for_timeout(2500)
        page.evaluate('document.dispatchEvent(new MouseEvent("mousemove",{movementX:0,movementY:-60}))')  # look at the horizon
        for j, k in enumerate(group):
            page.keyboard.press('1234567890'[j]); page.wait_for_timeout(900)
            page.screenshot(path=str(out / f'{k}.png'))
            page.screenshot(path=str(out / f'{k}-zoom.png'), clip={'x': 0, 'y': 400, 'width': 1280, 'height': 320})  # both hands + hotbar
        ctx.close()
    b.close()
srv.shutdown()
print(json.dumps({'kinds': kinds, 'errors': errors[:20]}, indent=1))
