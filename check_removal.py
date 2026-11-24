"""Hammer removal repro: build a wall (and a floor storey), save, reload, then hold X on it and release.
Usage: python check_removal.py [dist_dir]   (default: dist). Starts its own static server, prints JSON, exits 1 on failure.
Covers: same-session wall, wall loaded from a save, an old-format save (pieces without r), and a coop guest
removing a host wall over the loopback link (host-authoritative refund)."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1] if len(sys.argv) > 1 else 'dist').resolve()
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/?fixedres'
# Headless pointer lock: pretend it succeeds so the game aims down the screen centre exactly as a locked player does.
LOCK = """(() => { let el = null;
  Object.defineProperty(Document.prototype, 'pointerLockElement', {configurable:true, get(){ return el; }});
  HTMLCanvasElement.prototype.requestPointerLock = function(){ el = this; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange'))); return Promise.resolve(); };
  Document.prototype.exitPointerLock = function(){ el = null; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange'))); };
})();"""
report = {'steps': [], 'errors': [], 'console': []}
fail = []

def step(name, ok, **info):
    report['steps'].append({'step': name, 'ok': bool(ok), **info})
    if not ok: fail.append(name)

def dom_click(page, sel): page.evaluate('s => document.querySelector(s).click()', sel)  # hidden title buttons: DOM click
def st(page): return page.evaluate('raftDebug.state')
def pieces(page): return page.evaluate('raftDebug.state.pieces.list')
def wood(page): return page.evaluate('raftDebug.state.stock.wood || 0')

def start(page, clear=True):
    page.goto(URL); page.wait_for_function('!!window.raftDebug', timeout=60000)
    page.locator('.ob-item[data-act="continue"]:visible, .ob-item[data-act="new"]:visible, #solo:visible').first.click()
    page.wait_for_function('raftDebug.state.running', timeout=20000); page.wait_for_timeout(600)
    page.mouse.click(640, 360); page.wait_for_timeout(150)  # pointer lock fails once: mouse-ray (fallback) aiming from here on
    page.mouse.move(641, 361); page.mouse.move(640, 360); page.wait_for_timeout(100)

def hold_hammer(page):
    page.evaluate('raftDebug.give("hammer", 1)')
    i = page.evaluate('raftDebug.state.inventory.slots ? raftDebug.state.inventory.slots.findIndex(s => s && s.kind === "hammer") : -1')
    if i is None or i < 0:
        inv = page.evaluate('raftDebug.state.inventory')
        slots = inv['slots'] if isinstance(inv, dict) else inv
        i = next(k for k, s in enumerate(slots) if s and s.get('kind') == 'hammer')
    page.keyboard.press(str((i + 1) % 10)); page.wait_for_timeout(150)
    return page.evaluate('raftDebug.state.heldKind') == 'hammer'

def pick_piece(page, pid):
    page.keyboard.press('q'); page.wait_for_timeout(250)
    idx = page.evaluate(f'[...document.querySelectorAll(".bm-sec")].findIndex(s => (s.textContent || "") .length >= 0 && s.dataset.id === "{pid}")')
    if idx < 0: idx = ['foundation', 'floor', 'wall', 'halfwall', 'window', 'door', 'pillar', 'stairs', 'roof', 'railing', 'hatch', 'ladder', 'gate'].index(pid)
    page.evaluate(f'document.querySelector(".bm-sec[data-i=\\"{idx}\\"]").dispatchEvent(new MouseEvent("click", {{bubbles:true}}))')
    page.wait_for_timeout(150)
    return page.evaluate('raftDebug.state.pieces.piece')

def look_at(page, x, y, z):
    """Aim the camera at world point (x, y, z)."""
    page.evaluate(f'''(() => {{ const c = raftDebug.state.camera; const dx = {x} - c.x, dy = {y} - c.y, dz = {z} - c.z;
      raftDebug.aim(Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(-dx, -dz)); }})()''')
    page.wait_for_timeout(200)

def click(page):
    page.mouse.move(640, 360); page.mouse.down(); page.wait_for_timeout(60); page.mouse.up(); page.wait_for_timeout(300)

def remove_aimed(page):
    """Hold X, read the chip, release X. Returns (chip text while held, removing flag)."""
    page.keyboard.down('x'); page.wait_for_timeout(350)
    chip = page.evaluate('document.querySelector(".bm-status")?.textContent || ""')
    removing = page.evaluate('raftDebug.state.pieces.removing')
    tint = page.evaluate('document.querySelector(".bh-key") ? getComputedStyle(document.querySelector(".bh-hint")).display : null')
    page.keyboard.up('x'); page.wait_for_timeout(400)
    return chip, removing

def wall_point(page, p):
    """Centre of an edge piece record in world space (raft-local == world XZ; y from the camera / deck)."""
    deck = page.evaluate('raftDebug.state.raft.y') + .2
    y = deck + p['l'] * 2.2 + 1.0
    x = p['i'] * 2 - 1 if p['r'] else p['i'] * 2
    z = p['j'] * 2 if p['r'] else p['j'] * 2 - 1
    return x, y, z

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 720})
    ctx.add_init_script(LOCK)
    page = ctx.new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type == 'error' and report['console'].append(m.text[:300]))
    start(page)
    step('hammer held', hold_hammer(page))
    page.evaluate('raftDebug.give("wood", 40)')
    step('wall selected', pick_piece(page, 'wall') == 'wall')
    me = st(page)['me']
    # a wall on the -z side of the cell in front (cell (0,-1) edge r=0 at z = -3)
    look_at(page, 0, st(page)['raft']['y'] + .25, -2.6)
    w0 = wood(page); click(page)
    pl = pieces(page)
    step('wall built (same session)', any(p['t'] == 'wall' for p in pl), pieces=pl, woodSpent=w0 - wood(page), notice=page.evaluate('document.querySelector("#notice")?.textContent || ""'))
    walls = [p for p in pl if p['t'] == 'wall']
    if walls:
        w = walls[0]; look_at(page, *wall_point(page, w))
        w1 = wood(page); chip, removing = remove_aimed(page)
        pl2 = pieces(page)
        step('remove same-session wall', not any(p['t'] == 'wall' for p in pl2), chip=chip, removing=removing, refund=wood(page) - w1, pieces=pl2)
        # rebuild for the save/reload case
        page.keyboard.press('q'); page.wait_for_timeout(100); page.keyboard.press('Escape'); page.wait_for_timeout(100)
        pick_piece(page, 'wall'); look_at(page, 0, st(page)['raft']['y'] + .25, -2.6); click(page)
    pl = pieces(page)
    step('wall present before save', any(p['t'] == 'wall' for p in pl), pieces=pl)
    page.evaluate('window.dispatchEvent(new Event("beforeunload"))'); page.wait_for_timeout(200)
    saved = page.evaluate('JSON.parse(localStorage.getItem("little-raft-v1") || "{}").pieces')
    step('pieces in save', bool(saved), saved=saved)

    # ---- reload ----
    start(page)
    pl = pieces(page)
    step('wall restored after reload', any(p['t'] == 'wall' for p in pl), pieces=pl)
    step('hammer held after reload', hold_hammer(page))
    walls = [p for p in pl if p['t'] == 'wall']
    if walls:
        look_at(page, *wall_point(page, walls[0]))
        w1 = wood(page); chip, removing = remove_aimed(page)
        pl2 = pieces(page)
        step('remove wall after reload', not any(p['t'] == 'wall' for p in pl2), chip=chip, removing=removing, refund=wood(page) - w1, pieces=pl2)

    # ---- old-format save: pieces with no r, a two-storey frame ----
    saved = page.evaluate('localStorage.getItem("little-raft-v1")')
    page.goto(URL.split('?')[0] + 'blank-for-save')  # same origin, no game: nothing re-saves over the edited save
    page.evaluate('''raw => { const s = JSON.parse(raw);
      s.pieces = [{t:"wall", i:0, j:0, l:0}, {t:"wall", i:0, j:1, l:0}, {t:"wall", i:1, j:0, l:0, r:1},
                  {t:"floor", i:0, j:0, l:1}, {t:"pillar", i:1, j:1, l:0, r:0}, {t:"stairs", i:-1, j:-1, l:0}];
      localStorage.setItem("little-raft-v1", JSON.stringify(s)); }''', saved)
    start(page)
    pl = pieces(page)
    step('old save pieces loaded', len(pl) == 6, pieces=pl)
    hold_hammer(page)
    results = []
    for p in sorted(pl, key=lambda q: -q['l']):
        if p['t'] not in ('wall', 'pillar', 'stairs', 'floor'): continue
        cur = pieces(page)
        if not any(q['t'] == p['t'] and q['i'] == p['i'] and q['j'] == p['j'] and q['l'] == p['l'] and q['r'] == p['r'] for q in cur): continue
        if p['t'] == 'wall': x, y, z = wall_point(page, p)
        elif p['t'] == 'pillar': x, y, z = p['i'] * 2 - 1, st(page)['raft']['y'] + 1.0, p['j'] * 2 - 1
        elif p['t'] == 'stairs': x, y, z = p['i'] * 2, st(page)['raft']['y'] + .6, p['j'] * 2
        else: x, y, z = p['i'] * 2 + .5, st(page)['raft']['y'] + .2 + p['l'] * 2.2 - .06, p['j'] * 2 + .5
        look_at(page, x, y, z)
        w1 = wood(page); chip, removing = remove_aimed(page)
        gone = not any(q['t'] == p['t'] and q['i'] == p['i'] and q['j'] == p['j'] and q['l'] == p['l'] and q['r'] == p['r'] for q in pieces(page))
        results.append({'piece': p, 'chip': chip, 'removed': gone, 'refund': wood(page) - w1})
    step('old save: every piece removable top-down', all(r['removed'] for r in results), results=results)

    # ---- corner hint while the hammer is held ----
    hold_hammer(page); page.wait_for_timeout(200)
    hint = page.evaluate('(() => { const h = document.querySelector(".bh-hint"); return h ? {hidden:h.hidden, text:h.textContent.trim()} : null; })()')
    step('corner hint while hammer held', bool(hint) and not hint['hidden'] and 'Remove' in hint['text'], hint=hint)

    # ---- foundation tile (the "planks") ----
    tiles0 = st(page)['tiles']; s0 = st(page)['stock']
    look_at(page, 0, st(page)['raft']['y'] + .2, -2)  # tile (0,-1)
    chip, removing = remove_aimed(page)
    s1 = st(page)
    step('remove foundation tile with hammer X', s1['tiles'] == tiles0 - 1 and [0, -1] not in s1['tileList'], chip=chip, tiles=[tiles0, s1['tiles']],
         refund={k: s1['stock'].get(k, 0) - s0.get(k, 0) for k in ('wood', 'plastic')})

    # ---- lone wall on the deck: removable (support rules must not block it) ----
    pick_piece(page, 'wall'); look_at(page, -2, st(page)['raft']['y'] + .25, .4); click(page)
    lone = [p for p in pieces(page) if p['t'] == 'wall']
    if lone:
        look_at(page, *wall_point(page, lone[0])); chip, removing = remove_aimed(page)
    step('lone wall built and removed', bool(lone) and not any(p['t'] == 'wall' for p in pieces(page)), built=lone, chip=chip if lone else None)

    # ---- axe: hold click on a wall (the Raft way) ----
    pick_piece(page, 'wall'); look_at(page, -2, st(page)['raft']['y'] + .25, .4); click(page)
    walls = [p for p in pieces(page) if p['t'] == 'wall']
    page.evaluate('raftDebug.give("axe", 1)')
    inv = page.evaluate('raftDebug.state.inventory'); slots = inv['slots'] if isinstance(inv, dict) else inv
    ai = next((k for k, q in enumerate(slots) if q and q.get('kind') == 'axe'), -1)
    if ai >= 0: page.keyboard.press(str((ai + 1) % 10)); page.wait_for_timeout(200)
    hint = page.evaluate('(() => { const h = document.querySelector(".bh-hint"); return h ? {hidden:h.hidden, text:h.textContent.trim()} : null; })()')
    step('corner hint while axe held', bool(hint) and not hint['hidden'] and 'Dismantle' in hint['text'], hint=hint, held=page.evaluate('raftDebug.state.heldKind'))
    if walls:
        look_at(page, *wall_point(page, walls[0]))
        page.mouse.move(640, 360); page.mouse.down(); page.wait_for_timeout(300); page.mouse.up(); page.wait_for_timeout(200)
        step('axe: a short hold removes nothing (release resets)', any(p['t'] == 'wall' for p in pieces(page)) and page.evaluate('document.querySelector(".bh-ring")?.hidden !== false'))
        w1 = wood(page); page.mouse.down(); page.wait_for_timeout(500)
        mid = page.evaluate('(() => { const r = document.querySelector(".bh-ring"); return r ? {hidden:r.hidden, p:r.style.getPropertyValue("--p")} : null; })()')
        still = any(p['t'] == 'wall' for p in pieces(page))
        page.wait_for_timeout(1300); page.mouse.up(); page.wait_for_timeout(400)
        step('axe hold-click dismantles wall', still and not any(p['t'] == 'wall' for p in pieces(page)), ringMidway=mid, standingAt05s=still, refund=wood(page) - w1)
    step('axe present', ai >= 0, slot=ai)

    # ---- coop guest (loopback transport): guest removes a host-built wall, host refunds the guest's bag ----
    page.evaluate('raftDebug.give("wood", 6)'); page.evaluate('window.dispatchEvent(new Event("beforeunload"))')
    saved = page.evaluate('localStorage.getItem("little-raft-v1")')
    page.goto(URL.split('?')[0] + 'blank-for-save')
    page.evaluate('''raw => { const s = JSON.parse(raw); s.guestInventory = s.hostInventory;
      s.pieces = [{t:"wall", i:0, j:0, l:0, r:0}, {t:"wall", i:-1, j:-1, l:0, r:0}];
      localStorage.setItem("little-raft-v1", JSON.stringify(s)); }''', saved)
    lb = URL + '&loopback'
    host, guest = page, ctx.new_page()
    guest.on('pageerror', lambda e: report['errors'].append('guest: ' + str(e)))
    for q in (host, guest): q.goto(lb); q.wait_for_function('!!window.raftDebug', timeout=60000)
    dom_click(host, '#welcomeCrew'); host.wait_for_timeout(300); dom_click(host, '#host')
    host.wait_for_function('document.querySelector("#roomCode").textContent.length === 6', timeout=20000)
    code = host.locator('#roomCode').inner_text()
    dom_click(guest, '#welcomeCrew'); guest.wait_for_timeout(300); guest.fill('#roomInput', code); dom_click(guest, '#joinForm button')
    guest.wait_for_function('raftDebug.state.networkReady', timeout=30000); host.wait_for_function('!!raftDebug.state.other', timeout=15000)
    for q in (host, guest):
        q.bring_to_front(); q.mouse.click(640, 360); q.wait_for_timeout(200)
    guest.bring_to_front()
    gp = pieces(guest)
    gw = [p for p in gp if p['t'] == 'wall']
    step('guest sees host walls', len(gw) == 2, pieces=gp)
    inv = guest.evaluate('raftDebug.state.inventory')
    slots = inv['slots'] if isinstance(inv, dict) else inv
    hi = next((k for k, q in enumerate(slots) if q and q.get('kind') == 'hammer'), -1)
    if hi >= 0: guest.keyboard.press(str((hi + 1) % 10)); guest.wait_for_timeout(200)
    step('guest holds hammer', guest.evaluate('raftDebug.state.heldKind') == 'hammer', slot=hi)
    if gw:
        target = min(gw, key=lambda p: (p['i'] * 2 - st(guest)['me']['x']) ** 2 + (p['j'] * 2 - 1 - st(guest)['me']['z']) ** 2)
        look_at(guest, *wall_point(guest, target))
        w1 = wood(guest); chip, removing = remove_aimed(guest)
        try: guest.wait_for_function('n => raftDebug.state.pieces.list.length < n', arg=len(gw), timeout=8000)  # host snapshot reaches the guest
        except Exception: pass
        guest.wait_for_timeout(300)
        hp, gp2 = pieces(host), pieces(guest)
        same = lambda q: q['t'] == target['t'] and q['i'] == target['i'] and q['j'] == target['j'] and q['l'] == target['l'] and q['r'] == target['r']
        step('guest removes wall (host-authoritative)', not any(map(same, hp)) and not any(map(same, gp2)), chip=chip, removing=removing,
             guestRefund=wood(guest) - w1, hostPieces=hp, guestPieces=gp2, me=st(guest)['me'])
        step('guest refunded 2 wood', wood(guest) - w1 == 2, guestRefund=wood(guest) - w1)
        # guest takes a foundation tile (0,0) off: host checks it, the guest's bag gets the refund
        t0 = st(host)['tiles']; p0 = guest.evaluate('raftDebug.state.stock.plastic || 0')
        look_at(guest, .3, st(guest)['raft']['y'] + .2, .9)
        chip, removing = remove_aimed(guest)
        try: guest.wait_for_function('n => raftDebug.state.tiles < n', arg=t0, timeout=8000)
        except Exception: pass
        step('guest removes a foundation tile (host-authoritative)', st(host)['tiles'] == t0 - 1 and st(guest)['tiles'] == t0 - 1 and [0, 0] not in st(host)['tileList'],
             chip=chip, tiles=[t0, st(host)['tiles'], st(guest)['tiles']], guestPlasticRefund=guest.evaluate('raftDebug.state.stock.plastic || 0') - p0)
    b.close()

report['fail'] = fail
print(json.dumps(report, indent=1))
sys.exit(1 if fail else 0)
