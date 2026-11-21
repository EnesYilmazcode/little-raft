"""Scripted bug-hunt playthrough. Usage: python3 tests/playtest.py <dist_dir> <out_dir>
Copies dist to a temp dir (so hot-swap can rewrite version.json), seeds a save, plays through
crafting, stacking, splitting, dragging, hooking, swimming, saving and a live swap. Prints JSON;
every entry in "fails" is a bug."""
import os, sys, time, json, shutil, tempfile, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

src = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)
tmp = Path(tempfile.mkdtemp(prefix='raft-play-')); dist = tmp / 'dist'; shutil.copytree(src, dist)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/'

R = {'errors': [], 'fails': [], 'notes': {}}
def check(ok, what):
    if not ok: R['fails'].append(what)
def st(page): return page.evaluate('raftDebug.state')
def counts(page): return st(page)['stock']
def wait_js(page, expr, timeout):  # Python-side poll: in-page rAF/timer polling stalls under software GL
    end = time.monotonic() + timeout / 1000
    while True:
        try:
            if page.evaluate('() => !!(' + expr + ')'): return
        except Exception: pass
        if time.monotonic() > end: raise TimeoutError(expr)
        page.wait_for_timeout(200)
def shot(page, name): page.screenshot(path=str(out / f'{name}.png'))

slots = [None] * 28
slots[0] = {'kind': 'hook', 'count': 1, 'durability': 60}
for i, k in enumerate(['wood', 'wood', 'leaf', 'leaf', 'plastic', 'scrap', 'wood']): slots[8 + i] = {'kind': k, 'count': 20}
slots[15] = {'kind': 'wood', 'count': 7}
SAVE = {'tiles': [[x, z] for z in (-1, 0, 1) for x in (-1, 0, 1)], 'decor': [], 'stock': {}, 'fish': 0, 'collected': 0, 'hookHealth': 60,
        'items': [], 'hostInventory': {'slots': slots, 'selected': 0}, 'guestInventory': None}

with sync_playwright() as p:
    args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage']
    try: b = p.chromium.launch(headless=True, args=args)
    except Exception:  # bundled browser missing: fall back to any installed headless shell / chromium
        root = Path(os.environ.get('PLAYWRIGHT_BROWSERS_PATH', Path.home() / '.cache/ms-playwright'))
        exe = next(iter(sorted(root.glob('chromium-*/chrome-linux64/chrome')) + sorted(root.glob('chromium_headless_shell-*/*/chrome-headless-shell'))), None)
        if not exe: raise
        b = p.chromium.launch(headless=True, args=args, executable_path=str(exe))
    page = b.new_context(viewport={'width': 960, 'height': 540}).new_page()
    page.on('pageerror', lambda e: R['errors'].append(str(e)))
    page.on('console', lambda m: m.type == 'error' and R['errors'].append(m.text[:300]))
    # Seed before the game boots (a reload would let beforeunload save over it).
    page.add_init_script('if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem("little-raft-v1", ' + json.dumps(json.dumps(SAVE)) + ') }')
    page.goto(url); wait_js(page, '!!window.raftDebug', 20000)
    page.evaluate("document.querySelector('#solo').click()"); wait_js(page, 'raftDebug.state.running', 15000); page.wait_for_timeout(600)
    c = counts(page)
    if c['wood'] != 67: print(json.dumps({'seedFailed': c})); sys.exit(1)
    check(c['wood'] == 67 and c['leaf'] == 40 and c['hook'] == 1, f'save load counts {c}')

    # --- crafting every recipe ---
    page.keyboard.press('Tab'); page.wait_for_timeout(300)
    check(st(page)['inventoryOpen'], 'Tab opens inventory')
    for rid in ['rope'] * 16 + ['hammer', 'fishingrod', 'sail', 'palm', 'lantern', 'net', 'bench', 'crate', 'hook']:
        before = counts(page)
        el = page.locator(f'#inventory .sv-recipe[data-recipe="{rid}"]')
        if el.count() == 0: check(False, f'recipe button missing: {rid}'); continue
        el.scroll_into_view_if_needed(); el.click(); page.wait_for_timeout(60)
        after = counts(page)
        check(after[rid] == before[rid] + 1, f'craft {rid}: {before[rid]} -> {after[rid]}')
    shot(page, '01-crafted')
    inv = st(page)['inventory']['slots']
    check(all(s is None or s['count'] <= (1 if s['kind'] in ('hook', 'hammer', 'fishingrod') else 20) for s in inv), 'stack cap 20')
    R['notes']['afterCraft'] = [s and f"{s['kind']}x{s['count']}" for s in inv]

    # --- split (right click) then place into an empty slot ---
    def slot_el(i): return page.locator(f'#inventory .sv-slot[data-index="{i}"]')
    inv = st(page)['inventory']['slots']
    full = next(i for i, s in enumerate(inv) if s and s['count'] == 20)
    empty = next((i for i, s in enumerate(inv) if s is None and i >= 8), None)
    if empty is None: check(False, 'no empty slot for split test')
    else:
        kind = inv[full]['kind']
        slot_el(full).click(button='right'); slot_el(empty).click(); page.wait_for_timeout(100)
        inv2 = st(page)['inventory']['slots']
        check(inv2[empty] and inv2[empty]['count'] == 10 and inv2[full]['count'] == 10, f'right-click split half: {inv2[full]} {inv2[empty]}')
        # merge back by click-click
        slot_el(empty).click(); slot_el(full).click(); page.wait_for_timeout(100)
        inv3 = st(page)['inventory']['slots']
        check(inv3[full] and inv3[full]['count'] == 20 and inv3[empty] is None, f'merge back: {inv3[full]} {inv3[empty]}')
        # drag the full stack to the empty slot (HTML5 dnd)
        slot_el(full).drag_to(slot_el(empty)); page.wait_for_timeout(150)
        inv4 = st(page)['inventory']['slots']
        check(inv4[empty] and inv4[empty]['kind'] == kind and inv4[full] is None, f'drag move: {inv4[full]} {inv4[empty]}')
        check(counts(page)[kind] == counts(page)[kind], 'count stable')

    # --- Escape from inventory ---
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    s = st(page)
    pause_open = page.evaluate("!!document.querySelector('#options')?.open")
    check(not s['inventoryOpen'] and not pause_open, f'Esc closes inventory only (inv={s["inventoryOpen"]} pause={pause_open})')
    page.keyboard.press('KeyI'); page.wait_for_timeout(200); check(st(page)['inventoryOpen'], 'I opens inventory')
    page.keyboard.press('KeyI'); page.wait_for_timeout(200); check(not st(page)['inventoryOpen'], 'I closes inventory')
    R['notes']['openDialogs'] = page.evaluate("[...document.querySelectorAll('dialog[open]')].map(d=>d.id)")
    page.keyboard.press('KeyE'); page.wait_for_timeout(200); R['notes']['E_opensInventory'] = st(page)['inventoryOpen']
    if st(page)['inventoryOpen']: page.keyboard.press('Escape'); page.wait_for_timeout(200)

    # --- hotbar keys and wheel ---
    for k in range(1, 9):
        page.keyboard.press(f'Digit{k}'); page.wait_for_timeout(40)
        if st(page)['selectedIndex'] != k - 1:
            check(False, f'Digit{k} selects slot; open={page.evaluate("[...document.querySelectorAll(`dialog[open]`)].map(d=>d.id)")} inv={st(page)["inventoryOpen"]}')
    page.keyboard.press('Digit1'); page.mouse.move(640, 360)
    page.mouse.wheel(0, 120); page.wait_for_timeout(100); R['notes']['wheelSelected'] = st(page)['selectedIndex']
    page.keyboard.press('Digit1'); page.wait_for_timeout(50)

    # --- hook: throw, reel, collect ---
    page.evaluate('raftDebug.state')
    t = sorted(page.evaluate('raftDebug.targets'), key=lambda t: t['distance'])
    target = next((x for x in t if x['screen'] and x['screen']['visible'] and 4 < x['distance'] < 14), None)
    before = counts(page); collected0 = st(page)['collected']
    if target:
        sx, sy = target['screen']['x'], target['screen']['y'] - 40
        page.mouse.move(sx, sy); page.mouse.down(); page.wait_for_timeout(450); page.mouse.up()
    else:
        page.mouse.move(640, 300); page.mouse.down(); page.wait_for_timeout(600); page.mouse.up()
    page.wait_for_timeout(2500); R['notes']['hookAfterThrow'] = st(page)['hook']
    check(st(page)['hookStage'] in ('floating', 'flying'), f'hook in water: {st(page)["hookStage"]}')
    shot(page, '02-hook-floating')
    page.mouse.down(); page.wait_for_timeout(5000); page.mouse.up(); page.wait_for_timeout(600)
    s = st(page); R['notes']['afterReel'] = {'stage': s['hookStage'], 'collected': s['collected'] - collected0, 'hookHealth': s['hookHealth']}
    check(s['hookStage'] == 'idle', f'hook returns after reel: {s["hookStage"]}')

    # --- placing decor with a placeable selected ---
    inv = st(page)['inventory']['slots']
    # --- swim and climb ---
    page.keyboard.press('Digit1')
    # headless GL runs ~3 fps with dt clamped, so wait on state instead of wall time
    page.keyboard.down('KeyS')
    try: wait_js(page, 'raftDebug.state.swimming', 30000)
    except Exception: pass
    page.keyboard.up('KeyS'); page.wait_for_timeout(300)
    s = st(page); R['notes']['afterWalkOff'] = {'swimming': s['swimming'], 'me': s['me']}
    check(s['swimming'], 'walking off the raft swims')
    shot(page, '03-swimming')
    page.keyboard.down('KeyW'); page.keyboard.down('Space')
    try: wait_js(page, '!raftDebug.state.swimming && raftDebug.state.grounded', 30000)
    except Exception: pass
    page.keyboard.up('Space'); page.keyboard.up('KeyW'); page.wait_for_timeout(300)
    s = st(page); R['notes']['afterClimb'] = {'swimming': s['swimming'], 'grounded': s['grounded'], 'me': s['me']}
    check(not s['swimming'], 'W+Space climbs back aboard')

    # --- pause menu: Esc opens, Esc closes ---
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    R['notes']['escOpensPause'] = page.evaluate("!!document.querySelector('#options')?.open")
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    check(not page.evaluate("!!document.querySelector('dialog[open]')"), 'Esc closes pause')

    # --- repair key ---
    hh = st(page)['hookHealth']; page.keyboard.press('KeyR'); page.wait_for_timeout(200)
    check(st(page)['hookHealth'] == 100, f'R repairs hook ({hh} -> {st(page)["hookHealth"]})')

    # --- save and reload ---
    snap = st(page)['inventory']; page.wait_for_timeout(3500)
    page.reload(); wait_js(page, '!!window.raftDebug', 20000)
    page.evaluate("document.querySelector('#solo').click()"); wait_js(page, 'raftDebug.state.running', 15000)
    check(st(page)['inventory'] == snap, 'inventory survives reload')

    # --- live hot swap ---
    v = json.loads((dist / 'version.json').read_text()); v['build'] = v['build'] + '-swap'
    (dist / 'version.json').write_text(json.dumps(v))
    page.keyboard.press('Digit3'); snap = st(page)['inventory']
    res = page.evaluate('raftLive.check()'); page.wait_for_timeout(800)
    R['notes']['swap'] = res
    check(res.get('status') == 'updated', f'live swap {res}')
    s = st(page); check(s['inventory'] == snap and s['running'], 'swap keeps bag + running')
    shot(page, '04-after-swap')
    b.close()
srv.shutdown(); shutil.rmtree(tmp, ignore_errors=True)
print(json.dumps(R, default=str))
