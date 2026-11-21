"""Desktop shell check: runs the real desktop/main.cjs in Electron against a candidate dist.

Usage: python tests/e2e/electron_check.py [candidate_dist] [--window hidden|offscreen|show] [--keep]
Candidate dist defaults to $RAFT_DIST, then ./dist. The candidate is copied to a temp dir and served
by desktop/server.py in release mode, so the hot-swap step can publish a new version.json without
touching the candidate. The shell gets a throwaway userData dir, so the real app and its saves
are untouched. Prints one JSON report; exits 0 only when every check passes.

hidden (default) never shows a window or grabs the mouse; pointer lock then cannot engage, so the
lock checks verify the game asked for it with a live user gesture. show/offscreen use a real
focused window and real pointer lock (it will hold your mouse for a few seconds).
"""
from __future__ import annotations

import argparse, json, os, shutil, socket, subprocess, sys, tempfile, threading, time, urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve()
ROOT = HERE.parents[2]
HARNESS = ROOT / 'tools' / 'electron_harness.cjs'

# Installed into the page after boot. Records every lock request with the gesture state at call time,
# and the outcome events, so a hidden window still tells us what the game tried to do.
PROBE = r"""(() => {
  if (window.__lrProbe) return true;
  const P = window.__lrProbe = { calls: [], events: [], exits: 0 };
  const req = HTMLCanvasElement.prototype.requestPointerLock;
  HTMLCanvasElement.prototype.requestPointerLock = function (...a) {
    const c = { t: performance.now(), id: this.id, active: !!navigator.userActivation?.isActive, result: 'pending' };
    P.calls.push(c);
    let r;
    try { r = req.apply(this, a); } catch (e) { c.result = 'threw ' + e.name; throw e; }
    if (r && typeof r.then === 'function') r.then(() => { c.result = 'ok'; }, (e) => { c.result = 'rejected ' + (e && e.name); });
    else c.result = 'no-promise';
    return r;
  };
  const exit = Document.prototype.exitPointerLock;
  Document.prototype.exitPointerLock = function (...a) { P.exits++; return exit.apply(this, a); };
  document.addEventListener('pointerlockchange', () => P.events.push({ t: performance.now(), type: 'change', locked: document.pointerLockElement?.id || null }));
  document.addEventListener('pointerlockerror', () => P.events.push({ t: performance.now(), type: 'error' }));
  return true;
})()"""

SNAP = r"""(() => {
  const q = (s) => document.querySelector(s), c = q('#world'), P = window.__lrProbe || { calls: [], events: [] };
  const vis = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  return {
    locked: document.pointerLockElement ? (document.pointerLockElement.id || document.pointerLockElement.tagName) : null,
    dialogs: [...document.querySelectorAll('dialog[open]')].map((d) => d.id),
    inventory: !!q('#inventory')?.open, options: !!q('#options')?.open,
    resumeHint: vis(q('#resumeHint')), crosshair: vis(q('#crosshair')),
    canvasCursor: c ? getComputedStyle(c).cursor : null,
    body: [...document.body.classList],
    activation: !!navigator.userActivation?.isActive,
    running: !!window.raftDebug?.state?.running,
    engineInventoryOpen: !!window.raftDebug?.state?.inventoryOpen,
    build: window.raftLive?.build ?? null, liveError: window.raftLive?.lastError ?? null,
    nav: performance.getEntriesByType('navigation').length,
    calls: P.calls.length, lastCall: P.calls[P.calls.length - 1] || null, events: P.events.slice(-4),
    focused: document.hasFocus(), visibility: document.visibilityState,
  };
})()"""


def free_port() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); return s.getsockname()[1]


def find_electron() -> Path:
    env = os.environ.get('LR_ELECTRON')
    if env: return Path(env)
    exe = 'electron.exe' if os.name == 'nt' else 'electron'
    for base in [ROOT, *ROOT.parents]:
        p = base / 'node_modules' / 'electron' / 'dist' / exe
        if p.is_file(): return p
    raise SystemExit('electron binary not found; set LR_ELECTRON or npm install in the main checkout')


def http_json(url: str, timeout=1.5):
    with urllib.request.urlopen(url, timeout=timeout) as r: return json.load(r)


class Run:
    def __init__(self, candidate: Path, window: str, keep: bool):
        self.candidate, self.window, self.keep = candidate, window, keep
        self.work = Path(tempfile.mkdtemp(prefix='lr-electron-'))
        self.dist = self.work / 'dist'; self.app = self.work / 'app'; self.user = self.work / 'userData'
        self.server = self.electron = None
        self.harness_log: list[dict] = []
        self.checks: list[dict] = []
        self.notes: list[str] = []
        self.page_errors: list[str] = []

    # ---------- setup ----------
    def publish(self, build: str):
        tmp = self.dist / 'version.json.tmp'
        tmp.write_text(json.dumps({'build': build, 'protocol': 1})); os.replace(tmp, self.dist / 'version.json')

    def start(self):
        shutil.copytree(self.candidate, self.dist, ignore=shutil.ignore_patterns('*.tmp'))
        self.publish('electron-check-a')
        self.port = free_port(); self.origin = f'http://127.0.0.1:{self.port}'
        env = {**os.environ, 'RAFT_DIST': str(self.dist), 'RAFT_PORT': str(self.port), 'RAFT_RELEASE_MODE': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
        self.server = subprocess.Popen([sys.executable, str(ROOT / 'desktop' / 'server.py')], env=env, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.DEVNULL, stderr=open(self.work / 'server.log', 'wb'))
        for _ in range(80):
            try:
                if http_json(self.origin + '/health').get('app') == 'little-raft': break
            except Exception: time.sleep(.1)
        else: raise RuntimeError('server did not start: ' + (self.work / 'server.log').read_text(errors='replace'))
        # Unmodified main.cjs next to a config.json that points it at our server.
        self.app.mkdir(); self.user.mkdir()
        shutil.copy2(ROOT / 'desktop' / 'main.cjs', self.app / 'main.cjs')
        if (ROOT / 'desktop' / 'little-raft.png').is_file(): shutil.copy2(ROOT / 'desktop' / 'little-raft.png', self.app / 'little-raft.png')
        (self.app / 'config.json').write_text(json.dumps({'origin': self.origin}))
        self.cdp_port = free_port()
        env = {**os.environ, 'LR_MAIN': str(self.app / 'main.cjs'), 'LR_USER_DATA': str(self.user), 'LR_WINDOW': self.window,
               'ELECTRON_ENABLE_LOGGING': '0'}
        env.pop('ELECTRON_RUN_AS_NODE', None)
        self.electron = subprocess.Popen([str(find_electron()), str(HARNESS), f'--remote-debugging-port={self.cdp_port}', '--remote-allow-origins=*'],
                                         cwd=str(self.app), env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=open(self.work / 'electron.err', 'wb'))
        threading.Thread(target=self._pump, daemon=True).start()
        for _ in range(150):
            if self.electron.poll() is not None: raise RuntimeError(f'electron exited {self.electron.returncode}: ' + (self.work / 'electron.err').read_text(errors='replace')[-2000:])
            try: http_json(f'http://127.0.0.1:{self.cdp_port}/json/version'); return
            except Exception: time.sleep(.1)
        raise RuntimeError('electron devtools endpoint never came up')

    def _pump(self):
        for line in self.electron.stdout:
            try: self.harness_log.append(json.loads(line))
            except Exception: pass

    def stop(self):
        for p in (self.electron, self.server):
            if p and p.poll() is None:
                p.terminate()
                try: p.wait(5)
                except subprocess.TimeoutExpired: p.kill()
        if not self.keep: shutil.rmtree(self.work, ignore_errors=True)

    # ---------- helpers ----------
    def check(self, name: str, ok: bool, detail=None):
        self.checks.append({'name': name, 'ok': bool(ok), **({'detail': detail} if detail is not None else {})})
        return ok

    def snap(self): return self.page.evaluate(SNAP)

    def settle(self, ms=450): self.page.wait_for_timeout(ms)

    def back_to_play(self):
        """Close any dialog and get the engine running with a fresh gesture on the canvas."""
        for _ in range(3):
            s = self.snap()
            if not s['dialogs']: break
            self.page.keyboard.press('Escape'); self.settle(300)
        self.page.mouse.click(640, 400); self.settle(500)

    # ---------- the run ----------
    def run(self, pw):
        browser = pw.chromium.connect_over_cdp(f'http://127.0.0.1:{self.cdp_port}')
        page = None
        for _ in range(100):
            for ctx in browser.contexts:
                for p in ctx.pages:
                    if p.url.startswith(self.origin): page = p
            if page: break
            time.sleep(.1)
        if not page: raise RuntimeError('no game page in the desktop shell')
        self.page = page
        page.on('pageerror', lambda e: self.page_errors.append(str(e)[:300]))
        page.wait_for_function('!!window.raftDebug && !!window.raftLive', timeout=30000)
        page.evaluate(PROBE)
        vp = page.evaluate('({w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ua: navigator.userAgent})')
        self.notes.append(f"viewport {vp['w']}x{vp['h']} dpr {vp['dpr']}")
        s = self.snap()
        self.check('shell loads the candidate from the configured origin', page.url.startswith(self.origin + '/') and s['build'] == 'electron-check-a', {'url': page.url, 'build': s['build']})
        self.check('shell runs the page sandboxed, no node integration', page.evaluate("typeof require === 'undefined' && typeof process === 'undefined'"))
        self.check('window.open is denied by the shell', page.evaluate("(() => { try { return window.open('about:blank') === null } catch { return true } })()"))

        # Start a solo game with a real click (a trusted gesture).
        page.locator('#solo').click(); page.wait_for_function('raftDebug.state.running', timeout=15000); self.settle(900)
        s = self.snap()
        perm = [h for h in self.harness_log if h.get('harness', '').startswith('permission') and h.get('perm') == 'pointerLock']
        self.check('starting play requests pointer lock with a live gesture', s['calls'] >= 1 and s['lastCall']['active'], s['lastCall'])
        self.check('shell grants the pointerLock permission', all(h['ok'] for h in perm), perm or 'no pointerLock permission query seen')
        real_lock = s['locked'] == 'world'
        self.notes.append(f"real pointer lock {'engaged' if real_lock else 'not engaged'} in {self.window} window (focused={s['focused']}, last call {s['lastCall'] and s['lastCall']['result']})")
        if self.window != 'hidden':
            self.check('pointer lock engages on the canvas in a focused window', real_lock, s)
            self.check('crosshair shown and resume hint hidden while locked', s['crosshair'] and not s['resumeHint'], s)

        self.inventory_cycle('quick', dwell_ms=400, real_lock=real_lock)
        self.back_to_play()
        self.inventory_cycle('after 6 s in the bag', dwell_ms=6000, real_lock=real_lock)
        self.back_to_play()
        self.inventory_cycle('opened with I', dwell_ms=500, real_lock=real_lock, key='i')
        self.back_to_play()
        self.pause_cycle(real_lock)
        self.back_to_play()
        self.hot_swap(real_lock)

        errs = [h for h in self.harness_log if h.get('harness') in ('render-process-gone', 'console-error')]
        navs = [h for h in self.harness_log if h.get('harness') == 'did-navigate']
        self.check('no renderer crash or console error', not errs and not self.page_errors, {'shell': errs[:5], 'page': self.page_errors[:5]})
        self.check('one page load for the whole session', len(navs) <= 1 and self.snap()['nav'] == 1, navs)
        browser.close()

    def inventory_cycle(self, label, dwell_ms, real_lock, key='Tab'):
        page = self.page
        before = self.snap()['calls']
        page.keyboard.press(key); self.settle(400)
        s = self.snap()
        opened = self.check(f'inventory ({label}): {key} opens it and frees the cursor', s['inventory'] and not s['locked'] and not s['options'], s)
        if not opened: return
        page.wait_for_timeout(max(0, dwell_ms - 400))
        page.keyboard.press('Escape'); self.settle(700)
        s = self.snap()
        new_calls = s['calls'] - before
        self.check(f'inventory ({label}): Esc closes it', not s['inventory'] and not s['engineInventoryOpen'], s)
        self.check(f'inventory ({label}): Esc does not open the pause menu', not s['options'] and not s['dialogs'], s['dialogs'])
        relock = new_calls >= 1 and s['lastCall']['active']
        if real_lock:
            self.check(f'inventory ({label}): pointer lock is back after Esc (cursor hidden)', s['locked'] == 'world', s)
        else:
            self.check(f'inventory ({label}): Esc asks for pointer lock again with a usable gesture', relock,
                       {'requests_since_open': new_calls, 'last_request': s['lastCall'], 'activation_now': s['activation']})
        self.check(f'inventory ({label}): no "click the ocean" hint after Esc', not s['resumeHint'], {'resumeHint': s['resumeHint'], 'locked': s['locked']})

    def pause_cycle(self, real_lock):
        page = self.page
        page.keyboard.press('Escape'); self.settle(600)
        s = self.snap()
        self.check('pause: Esc during play opens the pause menu and frees the cursor', s['options'] and not s['locked'], s)
        page.keyboard.press('Escape'); self.settle(600)
        s = self.snap()
        self.check('pause: second Esc closes it', not s['options'] and not s['dialogs'], s['dialogs'])

    def hot_swap(self, real_lock):
        page = self.page
        page.keyboard.press('Tab'); self.settle(400)
        s0 = self.snap()
        state0 = page.evaluate("({tiles: raftDebug.state.tiles, inv: JSON.stringify(raftDebug.state.inventory)})")
        self.publish('electron-check-b')
        try:
            page.wait_for_function("raftLive.build === 'electron-check-b'", timeout=25000); swapped = True
        except Exception: swapped = False
        self.settle(600)
        s = self.snap()
        self.check('hot-swap: new build mounts without navigation', swapped and s['nav'] == 1 and not s['liveError'], {'build': s['build'], 'liveError': s['liveError'], 'nav': s['nav']})
        if not swapped: return
        state1 = page.evaluate("({tiles: raftDebug.state.tiles, inv: JSON.stringify(raftDebug.state.inventory)})")
        self.check('hot-swap: raft and bag carried over', state0 == state1, {'before': state0, 'after': state1})
        self.check('hot-swap: inventory opened before the swap is still open', s0['inventory'] and s['inventory'], {'before': s0['dialogs'], 'after': s['dialogs']})
        before = s['calls']
        page.keyboard.press('Escape'); self.settle(700)
        s = self.snap()
        self.check('hot-swap: Esc closes the carried-over inventory', not s['inventory'] and not s['engineInventoryOpen'], s)
        self.check('hot-swap: that Esc does not open the pause menu', not s['options'], s['dialogs'])
        if real_lock: self.check('hot-swap: pointer lock is back after Esc', s['locked'] == 'world', s)
        else: self.check('hot-swap: new engine asks for pointer lock after Esc', s['calls'] > before and s['lastCall']['active'], s['lastCall'])
        self.back_to_play()
        page.keyboard.press('Tab'); self.settle(400)
        s = self.snap()
        self.check('hot-swap: Tab opens inventory in the new engine', s['inventory'], s['dialogs'])
        page.keyboard.press('Escape'); self.settle(600)
        s = self.snap()
        self.check('hot-swap: Esc closes it again with no pause', not s['inventory'] and not s['options'], s['dialogs'])
        self.back_to_play()
        page.keyboard.press('Escape'); self.settle(600)
        s = self.snap()
        self.check('hot-swap: Esc during play still opens the pause menu (one owner)', s['options'], s['dialogs'])
        page.keyboard.press('Escape'); self.settle(500)
        self.check('hot-swap: pause closes again', not self.snap()['options'])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dist', nargs='?', default=os.environ.get('RAFT_DIST') or str(ROOT / 'dist'))
    ap.add_argument('--window', choices=['hidden', 'offscreen', 'show'], default=os.environ.get('LR_WINDOW', 'hidden'))
    ap.add_argument('--keep', action='store_true', help='keep the temp work dir')
    a = ap.parse_args()
    candidate = Path(a.dist).resolve()
    if not (candidate / 'index.html').is_file(): raise SystemExit(f'not a dist dir: {candidate}')
    run = Run(candidate, a.window, a.keep)
    fatal = None
    try:
        run.start()
        with sync_playwright() as pw: run.run(pw)
    except Exception as e:
        fatal = f'{type(e).__name__}: {e}'
    finally:
        run.stop()
    failed = [c['name'] for c in run.checks if not c['ok']]
    print(json.dumps({'candidate': str(candidate), 'window': a.window, 'passed': not failed and not fatal, 'fatal': fatal,
                      'failed': failed, 'notes': run.notes, 'checks': run.checks,
                      'shell': [h for h in run.harness_log if h.get('harness') not in ('focus', 'blur')][:40],
                      **({'work': str(run.work)} if a.keep else {})}, indent=1, default=str))
    sys.exit(0 if not failed and not fatal else 1)


if __name__ == '__main__':
    main()
