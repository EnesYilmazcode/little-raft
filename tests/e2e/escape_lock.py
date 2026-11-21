"""Escape and pointer-lock regression check in real Chrome (not part of npm test).

Sends Escape through CDP Input.dispatchKeyEvent with windowsVirtualKeyCode and nativeVirtualKeyCode
set, so Chrome treats it like a real key. Playwright's keyboard API leaves the native code out, and
then these bugs never show.

Scenarios:
  inv     open the bag, press Esc: the bag closes and the game stays locked for 3 s.
  locked  locked play, press Esc: the pause menu is open.

Usage: python3 tests/e2e/escape_lock.py [--dist DIST] [--trials N] [--hold MS] [--chrome PATH] [--headful] [inv] [locked]
Needs Python Playwright and Chrome or Chromium. Exits 1 if any trial fails.
"""
import argparse, functools, http.server, json, os, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('scenarios', nargs='*', default=['inv', 'locked'])
ap.add_argument('--dist', default=str(Path(__file__).resolve().parents[2] / 'dist'))
ap.add_argument('--trials', type=int, default=5)
ap.add_argument('--hold', type=int, default=120, help='ms between the Escape keydown and keyup')
ap.add_argument('--chrome', default=os.environ.get('CHROME', '/usr/bin/google-chrome'))
ap.add_argument('--headful', action='store_true')
ap.add_argument('--verbose', action='store_true', help='print the event trace for passing trials too')
args = ap.parse_args()

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=args.dist))
url = f'http://127.0.0.1:{srv.server_address[1]}/'
threading.Thread(target=srv.serve_forever, daemon=True).start()

STATE = """JSON.stringify({locked:!!document.pointerLockElement,
  open:[...document.querySelectorAll('dialog[open]')].map(d=>d.id||d.className),
  bag:!!(window.raftShell&&raftShell.panelOpen()), focus:document.hasFocus()})"""
# nativeVirtualKeyCode is the platform key code: X11 keycode 9 on Linux, VK_ESCAPE elsewhere.
# Event log printed with failing trials: lock requests and results, page exits, lock changes, Escape keys.
TRACE = r"""(()=>{const L=window.__trace=[];const t=()=>performance.now()|0;
const o=HTMLCanvasElement.prototype.requestPointerLock;HTMLCanvasElement.prototype.requestPointerLock=function(...a){
 L.push({t:t(),req:navigator.userActivation&&navigator.userActivation.isActive?'gesture':'plain'});const p=o.apply(this,a);
 p&&p.then(()=>L.push({t:t(),ok:1}),e=>L.push({t:t(),rej:e.name}));return p;};
const ox=Document.prototype.exitPointerLock;Document.prototype.exitPointerLock=function(){L.push({t:t(),exit:1});return ox.call(this);};
document.addEventListener('pointerlockchange',()=>L.push({t:t(),plc:!!document.pointerLockElement}),true);
for(const ty of ['keydown','keyup'])addEventListener(ty,e=>{if(e.key==='Escape')L.push({t:t(),[ty]:e.key})},true);
addEventListener('blur',e=>{if(e.target===window)L.push({t:t(),blur:1})},true);})();"""
ESC = dict(key='Escape', code='Escape', windowsVirtualKeyCode=27, nativeVirtualKeyCode=9 if sys.platform.startswith('linux') else 27)

def trial(p, scenario):
    launch = dict(headless=not args.headful, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800'])
    if args.chrome and Path(args.chrome).exists(): launch['executable_path'] = args.chrome
    b = p.chromium.launch(**launch)
    try:
        ctx = b.new_context(viewport={'width': 1200, 'height': 650}); ctx.add_init_script(TRACE); pg = ctx.new_page()
        pg.goto(url); pg.wait_for_function('!!window.raftDebug', timeout=30000)
        pg.locator('#solo' if pg.locator('#solo').is_visible() else '#newGame').click(no_wait_after=True, timeout=60000)
        pg.wait_for_function('raftDebug.state.running', timeout=20000); pg.wait_for_timeout(1000)
        st = lambda: json.loads(pg.evaluate(STATE))
        trace = lambda: pg.evaluate('window.__trace.splice(0)')
        for _ in range(3):
            if st()['locked']: break
            pg.mouse.click(600, 200); pg.wait_for_timeout(800)
        if not st()['locked']: return False, 'could not lock at start', st(), trace()
        if scenario == 'inv':
            pg.keyboard.press('Tab'); pg.wait_for_timeout(800)
            if not st()['bag']: return False, 'bag did not open', st(), trace()
        else:
            pg.wait_for_timeout(1500)  # well past any relock throttle
        trace()  # only the Escape and what follows
        cdp = ctx.new_cdp_session(pg)
        cdp.send('Input.dispatchKeyEvent', dict(type='rawKeyDown', **ESC)); pg.wait_for_timeout(args.hold)
        cdp.send('Input.dispatchKeyEvent', dict(type='keyUp', **ESC))
        if scenario == 'inv':
            samples = []
            for _ in range(8):  # about 4 s, sampled every 500 ms; the last 3 s must all be locked
                pg.wait_for_timeout(500); samples.append(st())
            s = samples[-1]
            ok = all(x['locked'] for x in samples[2:]) and not s['open'] and not s['bag']
            return ok, 'locked again and held' if ok else 'not locked after closing the bag', {'end': s, 'locked': [x['locked'] for x in samples]}, trace()
        for n in range(1, 11):  # up to 3 s: software GL makes the main thread slow
            pg.wait_for_timeout(300); s = st(); s['ms'] = args.hold + 300 * n
            if 'options' in s['open']: break
        ok = 'options' in s['open'] and not s['locked']
        return ok, 'pause menu open' if ok else 'no pause menu', s, trace()
    finally:
        b.close()

failed = 0
with sync_playwright() as p:
    for sc in args.scenarios:
        passed = 0
        for i in range(args.trials):
            ok, why, info, trace = trial(p, sc)
            passed += ok; failed += not ok
            print(f'{sc} #{i + 1}: {"PASS" if ok else "FAIL"} {why} {json.dumps(info)}', flush=True)
            if not ok or args.verbose: print('   trace:', ' '.join(json.dumps(e, separators=(',', ':')) for e in trace), flush=True)
        print(f'{sc}: {passed}/{args.trials} passed', flush=True)
srv.shutdown()
sys.exit(1 if failed else 0)
