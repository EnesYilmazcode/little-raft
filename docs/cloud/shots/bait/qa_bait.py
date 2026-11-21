"""Visual QA for fishing bait. Usage (from the repo root): python3 docs/cloud/shots/bait/qa_bait.py [dist_dir] [out_dir]
Seeds a save (rod in hotbar slot 4, 7 Fish Chum + 12 Seaweed Bait), casts, and shoots the bait chip + waiting prompt,
then cycles the bait with right-click. Chromium path via env PW_CHROMIUM (default /usr/bin/google-chrome)."""
import os, sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

repo = Path(__file__).resolve().parents[4]
dist = Path(sys.argv[1] if len(sys.argv) > 1 else repo / 'dist').resolve()
out = Path(sys.argv[2] if len(sys.argv) > 2 else repo / 'docs/cloud/shots/bait').resolve()
out.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/?fixedres'

slots = [None] * 28
slots[0] = {'kind': 'hook', 'count': 1, 'durability': 100}
slots[1] = {'kind': 'wood', 'count': 20}
slots[3] = {'kind': 'fishingrod', 'count': 1, 'durability': 64}
slots[4] = {'kind': 'chumbait', 'count': 7}
slots[5] = {'kind': 'seaweedbait', 'count': 12}
world = {'tiles': [[i % 3 - 1, i // 3 - 1] for i in range(9)], 'decor': [], 'stock': {'wood': 20, 'leaf': 0, 'scrap': 0, 'plastic': 0},
         'fish': 0, 'collected': 0, 'hookHealth': 100, 'items': [], 'hostInventory': {'slots': slots, 'selected': 3},
         'guestInventory': {'slots': [None] * 28, 'selected': 0}}
SEED = f"""if (!sessionStorage.getItem('qaSeeded')) {{ sessionStorage.setItem('qaSeeded', '1');
  localStorage.clear(); localStorage.setItem('little-raft-v1', {json.dumps(json.dumps(world))}); }}"""

report = {'errors': [], 'console': [], 'shots': [], 'states': {}}
def state(page):
    return page.evaluate("""({stage: raftFC.state.stage, bait: raftFC.session?.bait ?? null, held: raftDebug.state.heldKind,
      prompt: document.querySelector('#contextPrompt')?.textContent,
      chip: (() => { const e = document.getElementById('fcBait'); if (!e) return null; const r = e.getBoundingClientRect();
        const d = document.querySelector('.tools .sv-sel .sv-dur')?.getBoundingClientRect();
        return {text: e.textContent, cls: e.className, hidden: e.hidden, box: [r.left, r.top, r.right, r.bottom].map(Math.round),
          dur: d ? [d.left, d.top, d.right, d.bottom].map(Math.round) : null}; })()})""")
def shot(page, name):
    p = out / f'{name}.png'; page.screenshot(path=str(p)); report['shots'].append(p.name)
    report['states'][name] = state(page)

exe = os.environ.get('PW_CHROMIUM', '/usr/bin/google-chrome')
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=exe, headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 720})
    ctx.add_init_script(SEED)
    page = ctx.new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type in ('error', 'warning') and report['console'].append(m.text[:300]))
    page.goto(url); page.wait_for_function('!!window.raftDebug && !!window.raftFC', timeout=60000)
    page.locator('.ob-item[data-act="continue"]:visible, .ob-item[data-act="new"]:visible, #solo:visible').first.click()
    page.wait_for_function('raftDebug.state.running', timeout=15000)
    page.wait_for_timeout(1500)
    shot(page, '01-rod-chip')
    page.mouse.move(640, 360); page.mouse.down(); page.wait_for_timeout(600); page.mouse.up()
    page.wait_for_function("['waiting','nibble'].includes(raftFC.state.stage)", timeout=20000)
    page.evaluate("raftFC.session._wait = 999; raftFC.session._nibbles.length = 0")  # keep it bobbing for the shot
    page.wait_for_timeout(600); shot(page, '02-waiting-baited')
    report['lrPrompt'] = page.evaluate("document.querySelector('#lrPrompt')?.textContent ?? null")
    page.screenshot(path=str(out / '02b-prompt-chip-zoom.png'), clip={'x': 480, 'y': 380, 'width': 580, 'height': 330}, scale='device')
    page.mouse.click(640, 360, button='right'); page.wait_for_timeout(300)
    report['notice'] = page.evaluate("document.querySelector('#notice, .notice')?.textContent ?? null")
    shot(page, '03-cycle-next-cast')
    report['final'] = state(page)
    b.close()
print(json.dumps(report, indent=1))
