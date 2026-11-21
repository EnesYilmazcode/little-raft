# E2E probe: Escape out of a game panel must relock the pointer and keep it locked (LOCK-1/LOCK-2).
# Uses raw CDP Input.dispatchKeyEvent with nativeVirtualKeyCode 27: Playwright's keyboard.press omits the
# native code, so Chrome's browser-side Escape handling never runs and the bug does not reproduce with it.
# Run: python tests/e2e/esc-relock.py [dist_dir]   (exit code 0 = pass)
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / 'dist').resolve()

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
url = f'http://127.0.0.1:{srv.server_address[1]}/'
threading.Thread(target=srv.serve_forever, daemon=True).start()

STATE = """() => ({locked: !!document.pointerLockElement, relock: document.body.classList.contains('relock'),
  dialogs: [...document.querySelectorAll('dialog[open]')].map(d => d.id),
  hint: getComputedStyle(document.querySelector('#resumeHint')).display,
  cursor: getComputedStyle(document.querySelector('#world')).cursor})"""

def key(cdp, typ, name, vk):
    cdp.send('Input.dispatchKeyEvent', {'type': typ, 'key': name, 'code': name,
                                        'windowsVirtualKeyCode': vk, 'nativeVirtualKeyCode': vk})

def press(pg, cdp, name, vk, gap=60):
    key(cdp, 'rawKeyDown', name, vk); pg.wait_for_timeout(gap); key(cdp, 'keyUp', name, vk)

def open_inventory(pg, cdp):
    press(pg, cdp, 'Tab', 9)
    pg.wait_for_function("document.querySelector('#inventory').open", timeout=15000)

def open_pause(pg, cdp):
    # A native Esc in locked play is swallowed by Chrome to exit the lock; its keyup opens pause.
    press(pg, cdp, 'Escape', 27); pg.wait_for_timeout(2000)
    if not pg.evaluate("document.querySelector('#options').open"): press(pg, cdp, 'Escape', 27)
    pg.wait_for_function("document.querySelector('#options').open", timeout=15000)

def open_crew(pg, cdp):
    pg.evaluate("document.querySelector('#crewButton').click()")
    pg.wait_for_function("document.querySelector('#crew').open", timeout=15000)

CASES = {'inventory': open_inventory, 'pause': open_pause, 'crew': open_crew}
results, failed = {}, []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    for name, opener in CASES.items():
        ctx = b.new_context(viewport={'width': 640, 'height': 360}); pg = ctx.new_page()
        errors = []; pg.on('pageerror', lambda e: errors.append(str(e)))
        try:
            pg.goto(url); pg.wait_for_function('!!window.raftDebug', timeout=20000)
            pg.locator('.ob-item[data-act="new"]:visible, #newGame:visible, #solo:visible').first.click()  # onboarding title menu on raft-master
            pg.wait_for_function('raftDebug.state.running', timeout=15000); pg.wait_for_timeout(800)
            if not pg.evaluate('!!document.pointerLockElement'): pg.mouse.click(320, 180); pg.wait_for_timeout(500)
            cdp = ctx.new_cdp_session(pg)
            start = pg.evaluate(STATE)
            opener(pg, cdp); pg.wait_for_timeout(2500)
            press(pg, cdp, 'Escape', 27)
            pg.wait_for_timeout(3000)
            end = pg.evaluate(STATE)
            ok = start['locked'] and end['locked'] and not end['dialogs'] and not errors
            results[name] = {'ok': ok, 'start': start, 'end': end, 'errors': errors}
        except Exception as e:
            results[name] = {'ok': False, 'exc': str(e)}
        if not results[name]['ok']: failed.append(name)
        ctx.close()
    # LOCK-3: holding Esc in locked play for 2.4 s must still open the pause menu on release.
    ctx = b.new_context(viewport={'width': 640, 'height': 360}); pg = ctx.new_page()
    try:
        pg.goto(url); pg.wait_for_function('!!window.raftDebug', timeout=20000)
        pg.locator('.ob-item[data-act="new"]:visible, #newGame:visible, #solo:visible').first.click()  # onboarding title menu on raft-master
        pg.wait_for_function('raftDebug.state.running', timeout=15000); pg.wait_for_timeout(800)
        if not pg.evaluate('!!document.pointerLockElement'): pg.mouse.click(320, 180); pg.wait_for_timeout(500)
        cdp = ctx.new_cdp_session(pg)
        start = pg.evaluate(STATE)
        key(cdp, 'rawKeyDown', 'Escape', 27)
        for _ in range(30):
            pg.wait_for_timeout(80)
            cdp.send('Input.dispatchKeyEvent', {'type': 'rawKeyDown', 'key': 'Escape', 'code': 'Escape', 'autoRepeat': True,
                                                'windowsVirtualKeyCode': 27, 'nativeVirtualKeyCode': 27})
        key(cdp, 'keyUp', 'Escape', 27); pg.wait_for_timeout(1500)
        end = pg.evaluate(STATE)
        results['held_esc_pauses'] = {'ok': start['locked'] and 'options' in end['dialogs'], 'start': start, 'end': end}
    except Exception as e:
        results['held_esc_pauses'] = {'ok': False, 'exc': str(e)}
    if not results['held_esc_pauses']['ok']: failed.append('held_esc_pauses')
    ctx.close()
    b.close()
srv.shutdown()
print(json.dumps(results, indent=1))
print('FAIL: ' + ', '.join(failed) if failed else 'PASS: pointer still locked 3 s after Esc from inventory, pause and crew; held Esc opens pause')
sys.exit(1 if failed else 0)
