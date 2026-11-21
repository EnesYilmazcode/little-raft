"""Building-pieces visual QA capture. Usage: python scripts/shoot-building.py [dist_dir] [out_dir] [port]
Seeds a 5x5 raft with a pre-built 2-storey house + a hammer and materials, plays solo in drag-look mode
(pointer lock stubbed out), captures the key building states and checks place/remove bookkeeping. Prints JSON.
Chromium: CHROME_CHANNEL=chrome uses an installed channel; otherwise the bundled Playwright build below."""
import os, sys, json, math, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
dist = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'dist').resolve()
out = Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / 'docs/cloud/shots/building-pieces').resolve()
out.mkdir(parents=True, exist_ok=True)
port = int(sys.argv[3]) if len(sys.argv) > 3 else 0
CHROME = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
DECK, LH = 0.2, 2.2

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', port), functools.partial(Quiet, directory=str(dist)))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{port}/'

# ---------- seeded world ----------
def P(t, i, j, l, r=0): return {'t': t, 'i': i, 'j': j, 'l': l, 'r': r}
# House footprint: cells i in {0,1}, j in {-2,-1}  (x in [-1,3], z in [-5,-1]); front faces +z (towards spawn).
pieces = [
    # level 0: closed room, door in front, windows on the sides
    P('door', 0, 0, 0, 0), P('wall', 1, 0, 0, 0),             # front (z=-1)
    P('wall', 0, -2, 0, 0), P('wall', 1, -2, 0, 0),           # back (z=-5)
    P('window', 0, -1, 0, 1), P('wall', 0, -2, 0, 1),         # west (x=-1)
    P('wall', 2, -1, 0, 1), P('window', 2, -2, 0, 1),         # east (x=3)
    P('pillar', 0, 0, 0), P('pillar', 2, 0, 0), P('pillar', 0, -2, 0), P('pillar', 2, -2, 0),
    P('stairs', 1, 0, 0, 2),                                  # outside the front, rising towards -z onto the balcony
    # level 1: floors over the whole footprint
    P('floor', 0, -1, 1), P('floor', 1, -1, 1), P('floor', 0, -2, 1), P('floor', 1, -2, 1),
    # level 1 front half = open balcony with half-wall railing (stair arrival edge (1,0,0) left open)
    P('halfwall', 0, 0, 1, 0), P('halfwall', 0, -1, 1, 1), P('halfwall', 2, -1, 1, 1),
    P('pillar', 0, 0, 1), P('pillar', 2, 0, 1),
    # level 1 back half = small room: door + window towards the balcony, walls elsewhere
    P('door', 0, -1, 1, 0), P('window', 1, -1, 1, 0),
    P('wall', 0, -2, 1, 0), P('wall', 1, -2, 1, 0), P('wall', 0, -2, 1, 1), P('wall', 2, -2, 1, 1),
    # level 2: thatch roof over the back room, rising towards the back
    P('roof', 0, -2, 2, 2), P('roof', 1, -2, 2, 2),
]
slots = [None] * 28
slots[0] = {'kind': 'hammer', 'count': 1, 'durability': 100}
slots[1] = {'kind': 'hook', 'count': 1, 'durability': 100}
for k, kind in enumerate(['wood', 'wood', 'wood', 'leaf', 'plastic', 'rope']): slots[2 + k] = {'kind': kind, 'count': 20}
for k, kind in enumerate(['wood', 'wood', 'leaf', 'plastic']): slots[8 + k] = {'kind': kind, 'count': 20}
tiles = [[i, j] for i in range(-2, 3) for j in range(-2, 3)]
world = {'tiles': tiles, 'decor': [], 'stock': {'wood': 0, 'leaf': 0, 'plastic': 0, 'scrap': 0}, 'fish': 0, 'collected': 0,
         'hookHealth': 100, 'items': [], 'hostInventory': {'slots': slots, 'selected': 0}, 'guestInventory': None, 'pieces': pieces}
INIT = """
try { localStorage.setItem('little-raft-v1', %s); } catch (e) {}
// Force the game's drag-look / screen-aim fallback: headless pointer lock is unreliable.
try { Object.defineProperty(Element.prototype, 'requestPointerLock', {value: undefined, configurable: true}); } catch (e) {}
""" % json.dumps(json.dumps(world))

report = {'errors': [], 'console': [], 'shots': [], 'checks': {}}

def log(*a): print(*a, file=sys.stderr, flush=True)
def shot(page, name, note=''):
    log('shot', name)
    p = out / f'{name}.jpg'; page.screenshot(path=str(p), type='jpeg', quality=80)
    report['shots'].append({'file': str(p), 'note': note})

with sync_playwright() as pw:
    launch = dict(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    if os.environ.get('CHROME_CHANNEL'): launch['channel'] = os.environ['CHROME_CHANNEL']
    else: launch['executable_path'] = CHROME
    b = pw.chromium.launch(**launch)
    ctx = b.new_context(viewport={'width': 1280, 'height': 720})
    ctx.add_init_script(INIT)
    page = ctx.new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type in ('error', 'warning') and report['console'].append(m.text[:300]))
    page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=30000)
    page.wait_for_timeout(800)
    page.locator('#solo').click(); page.wait_for_function('raftDebug.state.running', timeout=20000)
    page.wait_for_timeout(2000)

    S = lambda: page.evaluate('raftDebug.state')
    st = S()
    report['checks']['loadedPieces'] = len(st['pieces']['list'])
    report['checks']['seededPieces'] = len(pieces)
    report['checks']['lockFallback'] = st['lockFallback']
    report['checks']['heldKind'] = st['heldKind']

    def wood(): return S()['stock'].get('wood', 0)

    def drag(dx, dy):
        """Drag-look by (dx, dy) screen px from the screen centre; ends with a real move so it is never a click."""
        x0, y0 = 640, 360
        page.mouse.move(x0, y0); page.mouse.down()
        if abs(dx) < 6 and abs(dy) < 6:  # tiny turn: go out and back so the drag registers as a look
            page.mouse.move(x0 + 30, y0, steps=2); page.mouse.move(x0 + dx, y0 + dy, steps=2)
        else: page.mouse.move(x0 + dx, y0 + dy, steps=max(2, int(math.hypot(dx, dy) / 40)))
        page.mouse.up()

    def look(yaw, pitch):
        for _ in range(4):
            me = S()['me']
            dyaw = (me['yaw'] - yaw + math.pi) % (2 * math.pi) - math.pi  # yaw -= dx*k  ->  dx = (cur - target)/k
            dp = me['pitch'] - pitch
            if abs(dyaw) < 0.01 and abs(dp) < 0.01: return
            dx, dy = dyaw / 0.005, dp / 0.005
            dx, dy = max(-560, min(560, dx)), max(-320, min(320, dy))
            drag(dx, dy)

    def face(x, z, pitch=None):
        me = S()['me']; yaw = math.atan2(-(x - me['x']), -(z - me['z']))
        look(yaw, me['pitch'] if pitch is None else pitch)

    def look_at(x, y, z):
        me = S()['me']; d = math.hypot(x - me['x'], z - me['z'])
        look(math.atan2(-(x - me['x']), -(z - me['z'])), math.atan2(y - me['y'], d))

    def walk_to(x, z, tol=0.25, tries=40):
        for _ in range(tries):
            me = S()['me']; d = math.hypot(x - me['x'], z - me['z'])
            if d < tol: return True
            log('walk', round(me['x'], 2), round(me['z'], 2), '->', x, z)
            face(x, z, 0)
            page.keyboard.down('KeyW'); page.wait_for_timeout(int(min(d / 2.6, 0.6) * 1000 * 0.8) + 40); page.keyboard.up('KeyW')
            page.wait_for_timeout(120)
        return False

    def aim_at(x, y, z):
        s = page.evaluate(f'raftDebug.project({x},{y},{z})')
        page.mouse.move(s['x'], s['y']); page.wait_for_timeout(500)
        return s

    def wheel_pick(idx, n=9, hold_shot=None):
        """Open the wheel with the right mouse (fallback hover mode), hover sector idx, optionally shoot, release to pick."""
        page.mouse.move(640, 360); page.mouse.down(button='right'); page.wait_for_timeout(300)
        r = page.evaluate("(()=>{const e=document.querySelector('.bm-wheel').getBoundingClientRect();return {x:e.left+e.width/2,y:e.top+e.height/2,s:e.width/400}})()")
        a = idx * 2 * math.pi / n
        page.mouse.move(r['x'] + 137 * r['s'] * math.sin(a), r['y'] - 137 * r['s'] * math.cos(a), steps=4); page.wait_for_timeout(300)
        if hold_shot: shot(page, *hold_shot)
        page.mouse.up(button='right'); page.wait_for_timeout(200)

    ORDER = ['foundation', 'floor', 'wall', 'halfwall', 'window', 'door', 'pillar', 'stairs', 'roof']

    # (1) exterior views from the deck
    walk_to(4.4, 4.3); look_at(1, 2.6, -3); page.wait_for_timeout(700)
    shot(page, '01-exterior-corner', 'three-quarter view of the 2-storey house from the front-right deck corner')
    walk_to(-4.2, 3.6); look_at(1, 2.6, -3); page.wait_for_timeout(700)
    shot(page, '01b-exterior-left', 'view from the front-left corner (west window, balcony railing, roof)')

    # (3) radial wheel open, hovering "wall"; release picks it
    walk_to(-2, 3.6); look(0, -0.45); page.wait_for_timeout(400)
    wheel_pick(ORDER.index('wall'), hold_shot=('03-radial-wheel', 'radial build wheel open, hovering Wall'))
    report['checks']['pickedPiece'] = S()['pieces']['piece']

    # (2) ghost: valid wall slot on the deck (edge (-1,1,0): x in [-3,-1], z=1)
    aim_at(-2, DECK + 0.02, 1); page.wait_for_timeout(400)
    shot(page, '02-ghost-valid-wall', 'green ghost wall on an empty deck edge')
    # real placement: click without moving
    before = S(); w0 = before['stock'].get('wood', 0); n0 = len(before['pieces']['list'])
    page.mouse.down(); page.mouse.up(); page.wait_for_timeout(600)
    after = S(); w1 = after['stock'].get('wood', 0); n1 = len(after['pieces']['list'])
    added = [p for p in after['pieces']['list'] if p not in before['pieces']['list']]
    report['checks']['place'] = {'piecesBefore': n0, 'piecesAfter': n1, 'woodBefore': w0, 'woodAfter': w1, 'added': added}
    page.mouse.move(800, 300); page.wait_for_timeout(300)
    shot(page, '02c-wall-placed', 'the wall just placed on the deck')

    # (6) removal highlight: hold X while aiming at the new wall, then release to remove + refund
    page.keyboard.down('KeyX'); aim_at(-2, DECK + 1.1, 1); page.wait_for_timeout(500)
    report['checks']['removingFlag'] = S()['pieces']['removing']
    shot(page, '06-remove-highlight', 'holding X: red highlight on the wall about to be removed')
    page.keyboard.up('KeyX'); page.wait_for_timeout(600)
    rem = S(); report['checks']['remove'] = {'piecesAfter': len(rem['pieces']['list']), 'woodAfter': rem['stock'].get('wood', 0),
        'refunded': rem['stock'].get('wood', 0) - w1, 'stillThere': [p for p in added if p in rem['pieces']['list']]}

    # (2b) ghost: invalid slot out over the water past the west edge
    walk_to(-4.4, 2.0); look(math.pi / 2, -0.25); page.wait_for_timeout(300)
    s = aim_at(-9.8, DECK, 2.0); page.wait_for_timeout(400)
    report['checks']['invalidAimScreen'] = s
    shot(page, '02b-ghost-invalid-wall', 'red ghost: wall slot over the water has no support')
    report['checks']['invalidChip'] = page.evaluate("document.querySelector('.bm-chip .bm-status')?.textContent")

    # (5) interior through the door
    page.mouse.move(640, 600)
    walk_to(0, 2.2); look(0, -0.08); page.wait_for_timeout(600)
    shot(page, '05-door-from-deck', 'front door (open leaf) with the room behind it')
    walk_to(0, 0.6); look(0, -0.12); page.wait_for_timeout(600)
    shot(page, '05b-through-door', 'looking through the doorway into the ground-floor room')
    walk_to(0, -1.6, tries=30); walk_to(0.3, -2.6, tries=20); look_at(2.6, 1.2, -4.6); page.wait_for_timeout(600)
    report['checks']['insidePos'] = S()['me']
    shot(page, '05c-interior', 'inside the ground-floor room: east window, walls, floor joists overhead')

    # (4) walk out and up the stairs onto the balcony
    walk_to(0, -1.4, tries=20); walk_to(0, 1.6, tries=30); walk_to(2, 2.8, tries=30)
    look(0, 0)
    page.keyboard.down('KeyW')
    for _ in range(60):
        page.wait_for_timeout(150)
        me = S()['me']
        if me['z'] < -1.7: break
    page.keyboard.up('KeyW'); page.wait_for_timeout(800)
    me = S()['me']; ph = S()['physics']
    report['checks']['upstairs'] = {'me': me, 'physics': ph, 'expectedEyeY': round(DECK + LH + 1.6, 2)}
    look(0, -0.15); page.wait_for_timeout(400)
    shot(page, '04-upper-floor-room', 'on the balcony after climbing the stairs: upper-room door + window, roof above')
    look(math.pi, -0.35); page.wait_for_timeout(500)
    shot(page, '04b-upper-floor-view', 'looking back from the balcony: railing, stair opening, deck below')

    report['frameMs'] = page.evaluate("""new Promise(r=>{let n=0,t0=performance.now();function f(){if(++n<60)requestAnimationFrame(f);else r((performance.now()-t0)/n)}requestAnimationFrame(f)})""")
    b.close()
srv.shutdown()
print(json.dumps(report, indent=1, default=str))
