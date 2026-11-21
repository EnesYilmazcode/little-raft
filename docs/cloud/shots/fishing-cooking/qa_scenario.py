"""Visual QA scenario for fishing & cooking. Usage (from the repo root): python3 docs/cloud/shots/fishing-cooking/qa_scenario.py [dist_dir] [out_dir]
Defaults: <repo>/dist and <repo>/docs/cloud/shots/fishing-cooking. Chromium path via env PW_CHROMIUM
(falls back to Playwright's bundled browser). Seeds a save (3x3 raft, rod selected, wood 20, scrap 10),
then drives cast -> bite -> reel -> catch -> grill -> cook -> journal and prints a JSON report."""
import os, sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

repo = Path(__file__).resolve().parents[4]  # docs/cloud/shots/fishing-cooking/qa_scenario.py -> repo root
dist = Path(sys.argv[1] if len(sys.argv) > 1 else repo / 'dist').resolve()
out = Path(sys.argv[2] if len(sys.argv) > 2 else repo / 'docs/cloud/shots/fishing-cooking').resolve()
out.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/'

slots = [None] * 28
slots[0] = {'kind': 'fishingrod', 'count': 1, 'durability': 100}
slots[1] = {'kind': 'wood', 'count': 20}
slots[2] = {'kind': 'scrap', 'count': 10}
world = {'tiles': [[i % 3 - 1, i // 3 - 1] for i in range(9)], 'decor': [], 'stock': {'wood': 20, 'leaf': 0, 'scrap': 10, 'plastic': 0},
         'fish': 0, 'collected': 0, 'hookHealth': 100, 'items': [], 'hostInventory': {'slots': slots, 'selected': 0},
         'guestInventory': {'slots': [None] * 28, 'selected': 0}}
SEED = f"""if (!sessionStorage.getItem('qaSeeded')) {{ sessionStorage.setItem('qaSeeded', '1');
  localStorage.clear(); localStorage.setItem('little-raft-v1', {json.dumps(json.dumps(world))}); }}"""

report = {'errors': [], 'console': [], 'shots': [], 'states': {}}
def shot(page, name, note=None):
    p = out / f'{name}.png'; page.screenshot(path=str(p)); report['shots'].append(p.name)
    try: report['states'][name] = page.evaluate("({fc: {stage: raftFC.state.stage, tension: raftFC.state.tension, progress: raftFC.state.progress, basket: raftFC.state.basket.length, grills: raftFC.state.grills}, prompt: document.querySelector('#contextPrompt')?.textContent, held: raftDebug.state.heldKind, lock: raftDebug.state.lockFallback, yaw: raftDebug.state.me.yaw, pitch: raftDebug.state.me.pitch})")
    except Exception as e: report['states'][name] = str(e)

exe = os.environ.get('PW_CHROMIUM')
with sync_playwright() as p:
    kw = {'executable_path': exe} if exe else {}
    b = p.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], **kw)
    ctx = b.new_context(viewport={'width': 1280, 'height': 720})
    ctx.add_init_script(SEED)
    page = ctx.new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type in ('error', 'warning') and report['console'].append(m.text[:300]))
    page.goto(url); page.wait_for_function('!!window.raftDebug && !!window.raftFC', timeout=20000)
    page.locator('#solo').click(); page.wait_for_function('raftDebug.state.running', timeout=15000)
    page.wait_for_timeout(1200)
    def look(yaw, pitch):
        """Turn the camera to (yaw, pitch) by synthetic mouse movement (pointer-locked) or drag (fallback)."""
        for _ in range(30):
            me = page.evaluate('raftDebug.state.me')
            dy_, dp = yaw - me['yaw'], pitch - me['pitch']
            if abs(dy_) < 0.01 and abs(dp) < 0.01: return me
            mx, my = max(-150, min(150, -dy_ / 0.0022)), max(-150, min(150, -dp / 0.0022))
            if page.evaluate('raftDebug.state.pointerLocked'):
                page.evaluate(f"document.dispatchEvent(new MouseEvent('mousemove', {{movementX: {mx}, movementY: {my}, bubbles: true}}))")
            else:
                page.mouse.move(640, 360); page.mouse.down(); page.mouse.move(645, 360); page.mouse.move(640 + mx, 360 + my, steps=4); page.mouse.up()
            page.wait_for_timeout(60)
        return page.evaluate('raftDebug.state.me')
    def frames(n=6):
        page.evaluate(f"new Promise(r => {{ let n = {n}; const f = () => --n ? requestAnimationFrame(f) : r(); requestAnimationFrame(f); }})")
    def wait_stage(stages, ms=15000):
        page.wait_for_function(f"{json.dumps(stages)}.includes(raftFC.state.stage)", timeout=ms)
    def key(code, hold=80):
        page.keyboard.down(code); page.wait_for_timeout(hold); page.keyboard.up(code)

    report['lockAtStart'] = page.evaluate('({locked: raftDebug.state.pointerLocked, fallback: raftDebug.state.lockFallback})')
    report['look'] = look(-0.3, -0.12)

    # 01 charging cast (hold ~0.6 s of game time)
    page.mouse.down(); wait_stage(['charging']); page.wait_for_function('raftFC.session && raftFC.session.charge > 0.55', timeout=15000)
    shot(page, '01-charging'); page.mouse.up()
    # 02 bobber floating on waves
    wait_stage(['waiting', 'nibble'], 20000); frames(10)
    page.evaluate("raftFC.session._wait = 999; raftFC.session._nibbles.length = 0")  # keep it bobbing for the shot
    frames(8); shot(page, '02-bobber')
    # 03 bite dunk
    page.evaluate("raftFC.forceBite('mackerel')"); frames(5); shot(page, '03-bite')
    # 04 strike, then hold to reel
    page.mouse.down(); wait_stage(['reeling']); page.wait_for_function('(() => { const s = raftFC.session; if (!s || s.stage !== "reeling") return true; s.tension = Math.min(s.tension, 0.62); return s.progress > 0.3; })()', timeout=30000)
    page.evaluate("raftFC.session.tension = Math.max(raftFC.session.tension, 0.5)"); frames(3)
    shot(page, '04-reeling')
    # let go when it gets hot, hold again otherwise: drive to the catch
    holding = True
    for _ in range(400):
        st = page.evaluate('raftFC.state')
        if st['stage'] != 'reeling': break
        if holding and st['tension'] > 0.7: page.mouse.up(); holding = False
        elif not holding and st['tension'] < 0.35: page.mouse.down(); holding = True
        page.wait_for_timeout(40)
    if holding: page.mouse.up()
    report['reelResult'] = page.evaluate('raftFC.state.stage')
    # the natural catch's caption may have faded on slow software GL; a forced catch shows held fish + caption + toast
    page.evaluate("raftFC.forceCatch('mackerel')"); frames(4); shot(page, '05-caught')
    if page.evaluate('raftFC.state.basket.length') < 2: page.evaluate("raftFC.forceCatch('mackerel')")
    page.wait_for_timeout(3000)

    # 06 grill: aim at the tile ahead (0,-1) and press G, then walk up and light it
    key('Digit5')  # empty hands so the rod does not cover the grill
    look(0, -0.5); frames(3); key('KeyG'); frames(4)
    report['grillPlaced'] = page.evaluate('raftFC.state.grills.length')
    look(0, -0.42)
    page.keyboard.down('KeyW'); page.wait_for_function('raftDebug.state.me.z < 0.0', timeout=10000); page.keyboard.up('KeyW')
    frames(4); key('KeyE'); frames(4); key('KeyE'); frames(4); key('KeyE'); frames(30)
    report['afterCook'] = page.evaluate('raftFC.state.grills')
    look(0.15, -0.55); frames(40); shot(page, '06-grill-cooking')
    # 07 one fish done, one charred
    page.evaluate("""(() => { const g = [...raftFC.grills.values()][0]; if (!g) return;
      const ct = (f) => 22 + 0.4 * f.cm; const [a, b] = g.st.slots;
      if (a) a.t = Math.max(a.t, ct(a) + 0.5); if (b) b.t = Math.max(b.t, ct(b) + 20.5); })()""")
    frames(60); shot(page, '07-cooked-burnt')
    # 10 E prompt near the grill (fresh frame after notices have expired)
    page.wait_for_timeout(2500); frames(4); shot(page, '10-grill-prompt')
    key('KeyE'); frames(6); key('KeyE'); frames(6)  # take the grilled + charred fish so the cookbook has entries
    report['basketAfterTake'] = page.evaluate('raftFC.state.basket')
    page.wait_for_timeout(2500)
    # 08/09 journal
    key('KeyJ'); page.wait_for_timeout(500); shot(page, '08-journal-fish')
    report['lockWithJournal'] = page.evaluate('raftDebug.state.pointerLocked')  # a real player must be able to click the tabs
    tab = page.locator('#fcJournal [role=tab]', has_text='Cookbook')
    if report['lockWithJournal']: tab.evaluate('b => b.click()')
    else: tab.click()
    page.wait_for_timeout(400)
    shot(page, '09-journal-cookbook')
    report['journal'] = page.evaluate('raftFC.state.journalCount')
    b.close()
srv.shutdown()
print(json.dumps(report, indent=1, default=str))
