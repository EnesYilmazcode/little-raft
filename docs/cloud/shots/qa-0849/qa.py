"""Visual QA for spyglass / goats / storm. Usage: python3 qa.py <dist> <out> [only-viewport e.g. 640x360]"""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright
dist = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)
only = sys.argv[3] if len(sys.argv) > 3 else None
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/?fixedres'
report = {'errors': [], 'console': [], 'shots': [], 'info': {}}

AIM_JS = """([x,y,z]) => { const c = raftDebug.state.camera; const dx = x - c.x, dy = y - c.y, dz = z - c.z;
  raftDebug.aim(Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(-dx, -dz)); return true; }"""
SELECT_JS = """k => { const inv = raftDebug.state.inventory; const s = inv.slots ?? inv; const i = s.findIndex(x => x && x.kind === k); return i; }"""

def start(b, w, h):
    page = b.new_context(viewport={'width': w, 'height': h}).new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type == 'error' and report['console'].append(m.text[:300]))
    page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=60000); page.wait_for_timeout(800)
    page.locator('.ob-item[data-act="new"]:visible, #solo:visible').first.click(); page.wait_for_function('raftDebug.state.running', timeout=15000)
    page.wait_for_timeout(1200)
    return page

def strike(page, arg):  # strike() refuses within 1 s of the last flash (the forced driver strikes every 8 s): retry
    page.evaluate("raftDebug.content.storm.pose(null)")
    for _ in range(30):
        if page.evaluate(f"raftDebug.content.storm.strike({arg})"): return True
        page.wait_for_timeout(200)
    return False

def hold(page, kind):
    i = page.evaluate(SELECT_JS, kind)
    if 0 <= i < 10: page.keyboard.press('1234567890'[i]); page.wait_for_timeout(300)
    return i

def run(b, w, h):
    tag = f'{w}x{h}'
    def shot(name):
        p = out / f'{name}-{tag}.png'; page.screenshot(path=str(p)); report['shots'].append(str(p))
    info = report['info'].setdefault(tag, {})
    page = start(b, w, h)
    ev = page.evaluate
    ev("raftDebug.content.daynight.setPhase(0.3)"); ev("raftDebug.content.daynight.setWeather('clear')"); ev("raftDebug.content.daynight.freeze(true)")
    # (1) goat in front of the player, pen fully in frame, pail held, milk ready
    info['goat'] = ev("raftDebug.content.animals.spawnGoat(0, -1)")
    ev("raftDebug.content.animals.arrive()"); ev("raftDebug.content.animals.ff(5)")
    page.wait_for_timeout(5000)
    ev("raftDebug.content.animals.milkNow()")
    ev("raftDebug.content.animals.give()")
    hold(page, 'bucket')
    pos = None
    for _ in range(120):  # wait for the goat to stand at/near its pen so the shot is from the front
        pos = ev("raftDebug.content.animals.plan(raftDebug.content.animals.list()[0]?.id)?.pos")
        if pos and abs(pos[0]) < 0.9 and -2.8 < pos[2] < -1.2: break
        page.wait_for_timeout(500)
    info['goatPos'] = pos
    if pos: ev(AIM_JS, [pos[0], pos[1] + 0.1, pos[2]])
    page.wait_for_timeout(500)
    info['goatPrompt'] = ev("document.querySelector('#lrPrompt')?.textContent ?? null")
    info['me1'] = ev("raftDebug.state.me"); shot('01-goat-front')
    ev(AIM_JS, [0, 0.2, -2]); page.wait_for_timeout(400); shot('01b-hay-corner')
    # (2) inventory with all the new items
    ev("raftDebug.give('spyglass')"); ev("raftDebug.give('milk', 2)"); ev("raftDebug.give('goatpen', 1)")
    for k in ('stormrod', 'stormshard', 'stormlamp', 'stormglass'): ev(f"raftDebug.content.storm.give('{k}', 2)")
    ev("raftDebug.give('binoculars')")
    info['inv'] = ev("(raftDebug.state.inventory.slots ?? raftDebug.state.inventory).map(s => s && s.kind)")
    page.keyboard.press('Tab'); page.wait_for_timeout(700); shot('02-bag')
    if h < 500:
        ev("(() => { const e = [...document.querySelectorAll('h2,h3,h4,div,section')].find(n => /^backpack$/i.test(n.textContent.trim())); e?.scrollIntoView({block:'start'}); return !!e; })()")
        page.wait_for_timeout(300); shot('02a-bag-scrolled')
    page.keyboard.press('Tab'); page.wait_for_timeout(400)
    if ev("!!raftDebug.state.inventoryOpen"): page.keyboard.press('Escape'); page.wait_for_timeout(400)
    hold(page, 'milk'); ev("raftDebug.aim(-0.2, 0)"); page.wait_for_timeout(500)
    shot('02b-hotbar')
    # (3) spyglass zoomed on an island
    hold(page, 'spyglass'); ev("raftDebug.content.spyglass.equip()")
    ev("raftDebug.content.islands.spawnNear(1234)"); page.wait_for_timeout(600)
    ev("raftDebug.aim(0, raftDebug.content.islands.yawTo())"); page.wait_for_timeout(600)
    ev("raftDebug.content.spyglass.force('spyglass', {snap:true})"); page.wait_for_timeout(500)
    info['spyLabel'] = ev("document.querySelector('#lrSpyLabel')?.textContent ?? null")
    shot('03-spyglass-zoom')
    ev("raftDebug.content.spyglass.force(null)"); page.wait_for_timeout(300)
    hold(page, 'hook')
    # (4) storm sky by day + bolt flash
    ev("raftDebug.content.daynight.setWeather('rain')")
    ev("raftDebug.content.storm.force(1)"); page.wait_for_timeout(3000)
    ev("raftDebug.aim(0.05, 0)"); page.wait_for_timeout(300)
    shot('04-storm-day')
    ev("raftDebug.content.storm.place(1, 0)"); ev("raftDebug.content.storm.fill(1, 0, 2)")
    page.wait_for_timeout(1200)
    strike(page, "{a: Math.PI*1.0, r: 30}"); ev("raftDebug.content.storm.pose(0.05)"); page.wait_for_timeout(100)
    bolt = ev("raftDebug.content.storm.state().bolt ?? null"); info['bolt'] = bolt
    if bolt:
        ev(AIM_JS, [bolt['end'][0], 6, bolt['end'][2]])
        ev("raftDebug.content.storm.pose(0.05)")
    page.wait_for_timeout(250)
    shot('04b-storm-flash'); ev("raftDebug.content.storm.pose(null)"); page.wait_for_timeout(1300)
    # (5) rod with shards + prompt
    ev(AIM_JS, [2, 0.9, 0]); page.wait_for_timeout(600)
    info['rodPrompt'] = ev("document.querySelector('#lrPrompt')?.textContent ?? null")
    shot('05-rod-shards')
    ev(AIM_JS, [2, 2.2, 0]); page.wait_for_timeout(300); strike(page, "{rod: '1,0'}"); ev("raftDebug.content.storm.pose(0.05)"); page.wait_for_timeout(250)
    shot('05b-rod-strike'); ev("raftDebug.content.storm.pose(null)")
    # (6) storm lantern at night
    ev("raftDebug.content.storm.place(-1, 0, 'stormlamp')"); ev("raftDebug.content.storm.place(1, 1, 'stormglass')")
    ev("raftDebug.content.daynight.setPhase(0.95)"); page.wait_for_timeout(1500)
    ev(AIM_JS, [-2, 0.5, 0]); page.wait_for_timeout(600)
    info['lampPrompt'] = ev("document.querySelector('#lrPrompt')?.textContent ?? null")
    info['me6'] = ev("raftDebug.state.me"); shot('06-lantern-night')
    ev(AIM_JS, [2, 0.5, 2]); page.wait_for_timeout(600)
    info['glassPrompt'] = ev("document.querySelector('#lrPrompt')?.textContent ?? null")
    shot('06b-glass-night')
    info['storm'] = ev("(() => { const s = raftDebug.content.storm.state(); return {level: s.level, on: s.on, mode: s.mode}; })()")
    page.context.close()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    for w, h in ((1280, 720), (640, 360)):
        if only and only != f'{w}x{h}': continue
        try: run(b, w, h)
        except Exception as e: report['errors'].append(f'{w}x{h}: {e}'[:500])
    b.close()
print(json.dumps(report, indent=1, default=str))
