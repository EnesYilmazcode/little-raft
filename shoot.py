"""Headless screenshot + perf probe. Usage: python shoot.py <dist_dir> <out_dir> [port]
Starts its own static server, plays a fresh solo game, captures key states, prints JSON."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)
port = int(sys.argv[3]) if len(sys.argv) > 3 else 0

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', port), functools.partial(Quiet, directory=str(dist)))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{port}/?fixedres'  # pin render scale so shots stay sharp

report = {'errors': [], 'console': [], 'shots': []}
def shot(page, name):
    p = out / f'{name}.png'; page.screenshot(path=str(p)); report['shots'].append(str(p))
def click(page, sel):  # DOM click: locator.click() can hang on some headless builds
    page.evaluate('s => document.querySelector(s).click()', sel)
def title_start(page):  # the title's start button: #newGame on current builds, #solo on older ones
    click(page, '#newGame' if page.locator('#newGame').count() else '#solo')

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 720})
    page = ctx.new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type in ('error', 'warning') and report['console'].append(m.text[:300]))
    page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=20000)
    page.wait_for_timeout(800); shot(page, '01-title')
    title_start(page); page.wait_for_function('raftDebug.state.running', timeout=15000)
    page.wait_for_timeout(1500); shot(page, '02-spawn')
    try: report['spawnState'] = {k: v for k, v in page.evaluate('raftDebug.state').items() if k in ('ownedTools', 'inventory', 'stock', 'heldKind')}
    except Exception as e: report['errors'].append('state: ' + str(e))
    page.mouse.move(640, 360); page.mouse.down(); page.wait_for_timeout(700); shot(page, '03-charging'); page.mouse.up()
    page.wait_for_timeout(900); shot(page, '04-thrown')
    page.keyboard.press('Tab'); page.wait_for_timeout(500); shot(page, '05-inventory')
    page.keyboard.press('Escape'); page.wait_for_timeout(500); shot(page, '06-after-esc-from-inventory')
    report['afterInvEsc'] = page.evaluate("({pause:!!document.querySelector('#options')?.open,inv:!!document.querySelector('#inventory')?.open,locked:!!document.pointerLockElement,relock:document.body.classList.contains('relock')})")
    page.keyboard.press('Escape'); page.wait_for_timeout(500); shot(page, '07-pause')
    if page.locator('#options [data-act=settings]').count():
        click(page, '#options [data-act=settings]'); page.wait_for_timeout(200); shot(page, '07b-settings')
        click(page, '#options [data-tab=graphics]'); page.wait_for_timeout(200); shot(page, '07c-graphics')
        page.keyboard.press('Escape'); page.wait_for_timeout(200)  # closes the panel, pause stays
        report['escClosesPanelFirst'] = page.evaluate("!!document.querySelector('#options')?.open")
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    for k in '2345': page.keyboard.press(k); page.wait_for_timeout(250)
    page.keyboard.press('1')
    page.keyboard.down('w'); page.wait_for_timeout(900); page.keyboard.up('w'); shot(page, '08-walked')
    # pickup feed: drive the game's own feed instance (same module URL the engine loaded)
    feed_js = "(async()=>{const u=performance.getEntriesByType('resource').map(e=>e.name).find(n=>n.includes('/pickup-feed.js'));if(!u)return 'no feed';const {pickupFeed:f}=await import(u);f.add('wood',2);f.add('wood',1);f.add('leaf',1);f.add('scrap',1);f.note('Your bag is full');return f.rows})()"
    try: report['feedRows'] = page.evaluate(feed_js); page.wait_for_timeout(450); shot(page, '09-pickup-feed')
    except Exception as e: report['errors'].append('feed: ' + str(e))
    page.wait_for_timeout(4000); report['feedRowsLater'] = page.evaluate("document.querySelectorAll('#pickupFeed .pf-row').length")
    if page.locator('#options [data-act=quit]').count():
        page.keyboard.press('Escape'); page.wait_for_timeout(300); click(page, '#options [data-act=quit]'); page.wait_for_timeout(800)
        shot(page, '10-quit-title'); click(page, '#solo'); page.wait_for_timeout(500)
    # frame time probe (software GL, so relative numbers only)
    report['frameMs'] = page.evaluate("""new Promise(r=>{let n=0,t0=performance.now(),worst=0,last=t0;function f(t){worst=Math.max(worst,t-last);last=t;if(++n<120)requestAnimationFrame(f);else r({avg:(t-t0)/n,worst})}requestAnimationFrame(f)})""")
    report['heapMB'] = page.evaluate('performance.memory ? performance.memory.usedJSHeapSize/1048576 : null')
    try: report['renderInfo'] = page.evaluate('raftDebug.renderInfo || null')
    except Exception: pass
    # building: a save with a hammer, placeables and an old tile-centred crate (save migration)
    slots = [{'kind': 'hook', 'count': 1, 'durability': 100}, {'kind': 'hammer', 'count': 1, 'durability': 100},
             {'kind': 'crate', 'count': 4}, {'kind': 'bench', 'count': 2}, {'kind': 'wood', 'count': 20}, {'kind': 'plastic', 'count': 20}] + [None] * 22
    save = {'tiles': [[-1, 0], [0, 0], [-1, 1], [0, 1]], 'decor': [{'type': 'crate', 'x': -1, 'z': 0}], 'stock': {}, 'fish': 0, 'collected': 1,
            'hostInventory': {'slots': slots, 'selected': 0}}
    bp = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    bp.on('pageerror', lambda e: report['errors'].append('build: ' + str(e)))
    bp.add_init_script('localStorage.getItem("little-raft-v1")||localStorage.setItem("little-raft-v1",%s)' % json.dumps(json.dumps(save)))
    bp.goto(url); bp.wait_for_function('!!window.raftDebug', timeout=20000)
    click(bp, '#solo'); bp.wait_for_function('raftDebug.state.running', timeout=15000); bp.wait_for_timeout(800)
    look = lambda dx, dy: bp.evaluate(f'document.dispatchEvent(new MouseEvent("mousemove",{{movementX:{dx},movementY:{dy}}}))')  # headless lock gives no movement
    look(0, 55); bp.keyboard.press('2'); bp.wait_for_timeout(400); shot(bp, '11-build-floor-ghost')
    look(-120, 180); bp.keyboard.press('3'); bp.wait_for_timeout(400); shot(bp, '12-place-crate-ghost')
    bp.mouse.down(); bp.mouse.up(); bp.wait_for_timeout(300)
    look(60, -40); bp.keyboard.press('4'); bp.keyboard.press('r'); bp.wait_for_timeout(400); shot(bp, '13-place-bench-rotated')
    report['build'] = bp.evaluate('({decor: raftDebug.state.decor, build: raftDebug.state.build, locked: raftDebug.state.pointerLocked})')
    b.close()
srv.shutdown()
print(json.dumps(report, indent=1, default=str))
