#!/usr/bin/env python3
"""Stage and screenshot the progression lane (inventory, tooltips, research, stations, binoculars).

Usage: python3 tools/shoot-progression.py [out_dir]
Serves dist/ on a random local port, drives a solo game through window.raftDebug.progression
and writes PNGs to docs/cloud/shots/progression/ (default). Prints a JSON log of the run.
"""
import sys, json, math, threading, functools, http.server, socketserver, glob
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / 'docs/cloud/shots/progression'
OUT.mkdir(parents=True, exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(DIST)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/'
LOG = {'errors': [], 'steps': {}}
CHROME = glob.glob('/opt/pw-browsers/chromium-*/chrome-linux*/chrome')[0]
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']


def start(browser, viewport, touch=False):
    ctx = browser.new_context(viewport=viewport, device_scale_factor=1, has_touch=touch)
    page = ctx.new_page()
    page.on('pageerror', lambda e: LOG['errors'].append(str(e)))
    page.on('console', lambda m: m.type == 'error' and LOG['errors'].append('console: ' + m.text[:300]))
    page.goto(URL)
    page.wait_for_function('!!window.raftDebug', timeout=20000)
    page.locator('#solo').click()
    page.wait_for_function('raftDebug.state.running', timeout=15000)
    page.wait_for_timeout(800)
    page.evaluate("document.exitPointerLock && document.exitPointerLock()")
    return ctx, page


def shot(page, name):
    page.wait_for_timeout(250)
    page.screenshot(path=str(OUT / name))
    LOG['steps'].setdefault('shots', []).append(name)


def open_inventory(page):
    if not page.evaluate("raftDebug.state.inventoryOpen"):
        page.keyboard.press('Tab')
    page.wait_for_function("raftDebug.state.inventoryOpen", timeout=3000)
    page.wait_for_timeout(400)


def close_dialogs(page):
    for _ in range(3):
        if page.evaluate("!!document.querySelector('dialog[open]')"):
            page.keyboard.press('Escape'); page.wait_for_timeout(250)
    page.evaluate("document.pointerLockElement && document.exitPointerLock()"); page.wait_for_timeout(150)
    page.mouse.move(5, 5)


def hover(page, sel):
    el = page.locator(sel).first
    el.scroll_into_view_if_needed()
    box = el.bounding_box()
    page.mouse.move(box['x'] + box['width'] * .5 - 4, box['y'] + box['height'] * .5 - 2)
    page.mouse.move(box['x'] + box['width'] * .5, box['y'] + box['height'] * .5)
    page.wait_for_timeout(350)


def drag_look(page, dx, dy):
    """Rotate the camera by dragging on the canvas (non-locked look: 0.005 rad per px)."""
    x0, y0 = 640, 360
    if page.evaluate("raftDebug.state.pointerLocked"):
        page.evaluate("document.exitPointerLock()"); page.wait_for_timeout(150)
    page.mouse.move(x0, y0); page.mouse.down()
    steps = max(4, int(max(abs(dx), abs(dy)) / 20))
    for i in range(1, steps + 1):
        page.mouse.move(x0 + dx * i / steps, y0 + dy * i / steps)
    page.mouse.up(); page.wait_for_timeout(200)


def aim_at(page, wx, wz, wy=None, target_pitch=None):
    """Turn the first-person camera toward world point (wx, wz)."""
    cam = page.evaluate("raftDebug.state.camera")
    want = math.atan2(-(wx - cam['x']), -(wz - cam['z']))
    d = (want - cam['yaw'] + math.pi) % (2 * math.pi) - math.pi
    drag_look(page, -d / .005, 0)
    if wy is not None:
        target_pitch = math.atan2(wy - cam['y'], math.hypot(wx - cam['x'], wz - cam['z']))
    if target_pitch is not None:
        cam = page.evaluate("raftDebug.state.camera")
        drag_look(page, 0, -(target_pitch - cam['pitch']) / .005)


def walk_to(page, x, z, tol=.25, limit=6000):
    """Face (x, z) and hold W until close (first-person walking, real physics)."""
    aim_at(page, x, z)
    page.keyboard.down('KeyW')
    t = 0
    while t < limit:
        me = page.evaluate("raftDebug.state.me")
        if math.hypot(me['x'] - x, me['z'] - z) < tol:
            break
        page.wait_for_timeout(50); t += 50
        if t % 600 == 0:
            page.keyboard.up('KeyW'); aim_at(page, x, z); page.keyboard.down('KeyW')
    page.keyboard.up('KeyW'); page.wait_for_timeout(300)
    LOG['steps'].setdefault('walk', []).append(page.evaluate("raftDebug.state.me"))


def slot_of(page, kind):
    return page.evaluate(f"raftDebug.state.inventory.slots.findIndex(s=>s&&s.kind==={json.dumps(kind)})")


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, headless=True, args=ARGS)

    # ---------------- desktop run ----------------
    ctx, page = start(b, {'width': 1280, 'height': 720})
    ev = page.evaluate
    P = 'raftDebug.progression'

    # 01: starting bag, inventory open
    open_inventory(page)
    LOG['steps']['startGoals'] = ev(f"{P}.state().nextGoals")
    shot(page, '01-start-inventory.png')

    # 02: tooltip over a bag slot holding a tool
    tool = ev("raftDebug.state.inventory.slots.findIndex(s=>s&&['hook','hammer','fishingrod','metalhook'].includes(s.kind))")
    LOG['steps']['toolSlot'] = tool
    hover(page, f'#inventory .sv-slot[data-index="{tool}"]')
    shot(page, '02-tooltip-slot.png')

    # 03: tooltip over a locked recipe row
    locked = ev("""(()=>{const rows=[...document.querySelectorAll('#inventory .sv-recipe')];
      const i=rows.findIndex(r=>/Locked/.test(r.textContent)); return i<0?null:rows[i].dataset.recipe})()""")
    LOG['steps']['lockedRecipe'] = locked
    if locked:
        hover(page, f'#inventory .sv-recipe[data-recipe="{locked}"]')
    shot(page, '03-tooltip-locked-recipe.png')
    close_dialogs(page)

    # Stage a row of stations along the back edge (z = -2, mouths facing +z, toward spawn).
    # place() picks the free tile nearest the player, so walk to a spot before each placement.
    ev(f"""(()=>{{const P={P};P.grant('metalore',4);P.grant('wood',10);P.grant('nail',4);P.grant('stone',2);P.grant('clay',2)}})()""")
    page.keyboard.press('8'); page.wait_for_timeout(200)  # empty hand so canvas drags only look
    keys = {}
    for t, spot in (('smelter', (0, -1.15)), ('researchtable', (-1.3, -1.25)), ('grill', (1.3, -1.25))):
        walk_to(page, *spot)
        keys[t] = ev(f"{P}.place('{t}')"); page.wait_for_timeout(300)
    page.keyboard.press('8'); page.wait_for_timeout(200)
    LOG['steps']['stationKeys'] = keys
    LOG['steps']['decor'] = ev("raftDebug.state.decor")
    walk_to(page, 1.3, -0.4); walk_to(page, -1.3, -0.4)
    page.wait_for_timeout(1200)  # let the progression tick notice the new kinds (discovery)

    # 04: research dialog via the real interact path
    ev(f"{P}.interact()"); page.wait_for_timeout(500)
    LOG['steps']['researchable'] = ev(f"{P}.state().researchable")
    LOG['steps']['researchOpen'] = ev(f"{P}.state().researchOpen")
    shot(page, '04-research-table.png')
    close_dialogs(page)

    # 06: smelter cooking (load via the real panel chips)
    ev(f"{P}.open({json.dumps(keys['smelter'])})"); page.wait_for_timeout(400)
    page.locator('#stationPanel .st-chip[data-role=input]').first.click(modifiers=['Shift']); page.wait_for_timeout(150)
    page.locator('#stationPanel .st-chip[data-role=fuel]').first.click(modifiers=['Shift']); page.wait_for_timeout(150)
    ev(f"{P}.advance(4)"); page.wait_for_timeout(500)
    LOG['steps']['cooking'] = ev(f"{P}.state().stations")
    shot(page, '06-smelter-cooking.png')
    close_dialogs(page)

    # 05: walk to the front edge and look back at the row of stations (smelter lit while cooking)
    walk_to(page, 0, 2.4)
    aim_at(page, 0, -2, target_pitch=-.33)
    page.mouse.click(640, 360); page.wait_for_timeout(400)  # first click only takes pointer lock (hides the look hint)
    page.wait_for_timeout(1200)
    dec = [d for d in ev("raftDebug.state.decor") if d['type'] in ('smelter', 'researchtable', 'grill')]
    LOG['steps']['worldCam'] = ev("raftDebug.state.camera")
    LOG['steps']['stationScreens'] = [dict(d, screen=ev(f"raftDebug.project({d['x']*2},0.6,{d['z']*2})")) for d in dec]
    shot(page, '05-raft-stations.png')
    page.evaluate("document.exitPointerLock()"); page.wait_for_timeout(200)

    # 07: ingot ready
    ev(f"{P}.advance(120)"); page.wait_for_timeout(200)
    ev(f"{P}.open({json.dumps(keys['smelter'])})"); page.wait_for_timeout(500)
    LOG['steps']['done'] = ev(f"{P}.state().stations")
    shot(page, '07-smelter-done.png')
    take = page.locator('#stationPanel [data-act=take]')
    if take.count():
        take.first.click(); page.wait_for_timeout(200)
    close_dialogs(page)

    # 08: mid-game bag
    ev(f"""(()=>{{const P={P};P.grant('metalingot',6);P.grant('bolt',8);P.grant('hinge',4);
      P.grant('metalhook',1);P.grant('binoculars',1);P.grant('nail',12);P.grant('copperingot',2)}})()""")
    open_inventory(page)
    page.mouse.move(5, 5)
    LOG['steps']['midStock'] = ev("raftDebug.state.stock")
    shot(page, '08-midgame-inventory.png')
    s = slot_of(page, 'binoculars')
    if s >= 8:  # move binoculars onto the hotbar (slot 8) with real clicks: pick up, drop (whole-stack swap)
        page.locator(f'#inventory .sv-slot[data-index="{s}"]').click(); page.wait_for_timeout(150)
        page.locator('#inventory .sv-slot[data-index="7"]').click(); page.wait_for_timeout(150)
    close_dialogs(page)

    # 09: binoculars in hand with HUD line
    s = slot_of(page, 'binoculars')
    LOG['steps']['binoSlot'] = s
    if 0 <= s < 8:
        page.keyboard.press(str(s + 1))
    else:
        LOG['steps']['binoNote'] = 'binoculars not on hotbar'
    page.mouse.click(640, 360)  # take pointer lock (first click never acts)
    page.wait_for_timeout(900)
    LOG['steps']['hud'] = ev(f"{P}.state().hud")
    shot(page, '09-binoculars-hud.png')
    LOG['steps']['savedProgression'] = bool(ev("localStorage.getItem('littleRaft.progression.v1')"))
    ctx.close()

    # ---------------- mobile run ----------------
    ctx, page = start(b, {'width': 390, 'height': 844}, touch=True)
    page.evaluate("""(()=>{const P=raftDebug.progression;P.grant('metalingot',3);P.grant('bolt',4);P.grant('binoculars',1)})()""")
    open_inventory(page)
    shot(page, '10-mobile-inventory.png')
    ctx.close()
    b.close()
srv.shutdown()
print(json.dumps(LOG, indent=1, default=str))
