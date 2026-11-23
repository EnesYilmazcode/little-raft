"""Paddle + starter anchor probe. Usage: python check_paddle.py [dist_dir] [shots_dir]
Starts a fresh solo game, gives a paddle, takes single strokes from the raft edge and measures how far the raft
moves relative to the water (sailing wx/wz) per stroke. Also checks the starter raft anchor drops, stops drift and
raises again, and that an old save (no sailing slice) still loads with the anchor. Prints JSON; exits 1 on failure.
Pass a shots_dir to also save a mid-stroke and an anchor screenshot."""
import sys, json, math, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1] if len(sys.argv) > 1 else 'dist').resolve()
shots = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None
if shots: shots.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/?fixedres'

SAIL = 'raftDebug.state.sailing'
def sail(page): return page.evaluate(f'(() => {{ const s = {SAIL}; return {{clock:s.windClock, wx:s.wx, wz:s.wz, gx:s.gx, gz:s.gz, vx:s.vx, vz:s.vz, anchored:s.anchored, anchorPos:s.anchorPos}}; }})()')
def paddle_slot(page): return page.evaluate("raftDebug.state.inventory.slots.findIndex(s => s && s.kind === 'paddle')")

report = {'errors': [], 'strokes': [], 'ok': True}
def fail(msg): report['ok'] = False; report['errors'].append(msg)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': 960, 'height': 540}).new_page()
    page.on('pageerror', lambda e: report['errors'].append('page: ' + str(e)))
    page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=60000)
    page.locator('.ob-item[data-act="new"]:visible, #solo:visible').first.click(); page.wait_for_function('raftDebug.state.running', timeout=15000)
    page.wait_for_timeout(1200)
    st = page.evaluate("({held: raftDebug.state.heldKind, kinds: raftDebug.state.inventory.slots.filter(Boolean).map(s => s.kind)})")
    report['spawn'] = st
    if st['kinds'] != ['hook']: fail('spawn bag is not just the hook: %s' % st['kinds'])
    s0 = sail(page); report['anchorPos'] = s0['anchorPos']
    if not s0['anchorPos']: fail('starter raft has no anchor')
    page.evaluate("raftDebug.give('paddle', 1)")
    i = paddle_slot(page); page.keyboard.press(str(i + 1)); page.wait_for_timeout(300)
    report['durability'] = page.evaluate(f"raftDebug.state.inventory.slots[{i}].durability")
    # Headless frames are slow and the game clamps dt, so game time runs slower than the wall clock: every wait
    # below is in game seconds, read from the sailing wind clock (it counts down by the game's own dt).
    def wait_sim(sec):
        page.wait_for_function(f"(t0 => t0 - {SAIL}.windClock >= {sec} || {SAIL}.windClock > t0)", arg=sail(page)['clock'], timeout=120000, polling=50)
    # yaw 0 looks along -z, so a stroke must push the raft toward -z (water-relative offset wz goes down)
    def stroke():
        page.evaluate("raftDebug.aim(-0.25, 0)"); a = sail(page)
        page.mouse.move(480, 270); page.mouse.down(); page.mouse.up(); i = sail(page)
        return a, round(math.hypot(i['vx'] - a['vx'], i['vz'] - a['vz']), 3)
    # stroke 1 from rest: glide over 6 game seconds
    a, dv = stroke(); wait_sim(6); z = sail(page)
    report['strokes'].append({'impulse': dv, 'glide6s': [round(z['wx'] - a['wx'], 3), round(z['wz'] - a['wz'], 3)]})
    # then a stroke each game second: the speed builds up to the paddle cap
    for n in range(4):
        a, dv = stroke(); wait_sim(1)
        report['strokes'].append({'impulse': dv, 'speedAfter1s': round(math.hypot(sail(page)['vx'], sail(page)['vz']), 3)})
    report['durabilityAfter5'] = page.evaluate(f"raftDebug.state.inventory.slots[{i}]?.durability ?? null")
    d6 = report['strokes'][0]['glide6s']
    report['metresPerStroke'] = round(math.hypot(*d6), 3)
    if not (d6[1] < 0): fail('stroke facing -z did not push the raft toward -z')
    if shots:  # mid-stroke: blade pinned half way through the pull, splash just thrown
        wait_sim(1); page.evaluate("raftDebug.paddlePose(0.5)"); stroke(); page.wait_for_timeout(250)
        page.screenshot(path=str(shots / 'paddle-mid-stroke.png')); page.evaluate("raftDebug.paddlePose(-1)")
    # anchor: look at the starter anchor drum, press E to drop it, check the drift stops, E again to raise it
    page.keyboard.press('1'); page.wait_for_timeout(200)
    def aim_anchor():
        page.evaluate("""(() => { const ap = raftDebug.state.sailing.anchorPos, c = raftDebug.state.camera;
          const dx = ap.x - c.x, dz = ap.z - c.z, h = Math.hypot(dx, dz);
          raftDebug.aim(Math.atan2(1.15 + (raftDebug.state.raft?.y ?? 0) - c.y, h), Math.atan2(-dx, -dz)); })()""")
    aim_anchor(); page.wait_for_timeout(300)
    if shots: page.screenshot(path=str(shots / 'starter-anchor.png'))
    page.keyboard.press('e'); page.wait_for_timeout(2500)
    a = sail(page); page.wait_for_timeout(3000); z = sail(page)
    report['anchorDrop'] = {'anchored': a['anchored'], 'seabedMoveWhileAnchored': round(math.hypot(z['gx'] - a['gx'], z['gz'] - a['gz']), 4)}
    if shots: page.screenshot(path=str(shots / 'starter-anchor-dropped.png'))
    if not a['anchored']: fail('E at the starter anchor did not drop it')
    elif report['anchorDrop']['seabedMoveWhileAnchored'] > 1e-3: fail('raft still drifts while anchored')
    aim_anchor(); page.keyboard.press('e'); page.wait_for_timeout(600)
    report['anchorRaised'] = not sail(page)['anchored']
    if not report['anchorRaised']: fail('E did not raise the anchor')
    # old save: a world saved before sailing existed (no sailing slice) still loads, keeps its bag and has the anchor
    old = {'tiles': [[-1, 0], [0, 0], [-1, 1], [0, 1]], 'decor': [], 'stock': {}, 'fish': 0, 'collected': 1,
           'hostInventory': {'slots': [{'kind': 'hook', 'count': 1, 'durability': 80}] + [None] * 27, 'selected': 0}}
    op = b.new_context(viewport={'width': 640, 'height': 360}).new_page()
    op.on('pageerror', lambda e: report['errors'].append('old save: ' + str(e)))
    op.add_init_script('localStorage.setItem("little-raft-v1",%s)' % json.dumps(json.dumps(old)))
    op.goto(url); op.wait_for_function('!!window.raftDebug', timeout=60000)
    op.evaluate("document.querySelector('#solo').click()"); op.wait_for_function('raftDebug.state.running', timeout=15000); op.wait_for_timeout(800)
    report['oldSave'] = op.evaluate("({tiles: raftDebug.state.tiles, anchorPos: raftDebug.state.sailing.anchorPos, anchored: raftDebug.state.sailing.anchored, hook: raftDebug.state.inventory.slots[0]})")
    o = report['oldSave']
    if not o['anchorPos']: fail('old save has no anchor')
    if o['tiles'] != 4 or o['anchored'] or (o['hook'] or {}).get('durability') != 80: fail('old save did not load as saved: %s' % o)
    b.close()
srv.shutdown()
print(json.dumps(report, indent=1))
sys.exit(0 if report['ok'] else 1)
